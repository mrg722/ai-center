import type { ProjectRow } from '../types';
import { env } from '../env';
import { BadRequest } from '../orchestrator/repo';

/**
 * GitHub REST integration (server-side only, GITHUB_TOKEN never leaves the
 * server). GitHub is the source of truth for code; we only read status and,
 * after approval, open/merge PRs. Reads are cached briefly to keep API usage low.
 */
const API = 'https://api.github.com';
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 30_000;

function repoOf(p: ProjectRow): string {
  if (!p.repo_owner || !p.repo_name) throw new BadRequest('Project has no GitHub repository configured (Settings → Project).');
  return `${encodeURIComponent(p.repo_owner)}/${encodeURIComponent(p.repo_name)}`;
}

async function gh<T>(path: string, init: RequestInit = {}, useCache = true): Promise<T> {
  const token = env.githubToken;
  if (!token) throw new BadRequest('GITHUB_TOKEN is not configured on the server.');
  const key = `${init.method ?? 'GET'} ${path}`;
  const hit = cache.get(key);
  if (useCache && (!init.method || init.method === 'GET') && hit && Date.now() - hit.at < TTL) return hit.data as T;
  const res = await fetch(API + path, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'ai-command-center',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text).message ?? msg;
    } catch {
      /* raw */
    }
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!init.method || init.method === 'GET') cache.set(key, { at: Date.now(), data });
  return data;
}

export interface RepoStatus {
  configured: boolean;
  token: boolean;
  repo: string | null;
  error?: string;
  default_branch?: string;
  head_commit?: { sha: string; message: string; author: string; date: string };
  open_prs?: { number: number; title: string; head: string; url: string; draft: boolean; author: string }[];
  open_issues?: number;
  branches?: string[];
}

export async function repoStatus(p: ProjectRow): Promise<RepoStatus> {
  const token = Boolean(env.githubToken);
  const repo = p.repo_owner && p.repo_name ? `${p.repo_owner}/${p.repo_name}` : null;
  if (!repo) return { configured: false, token, repo };
  if (!token) return { configured: true, token, repo, error: 'GITHUB_TOKEN not set' };
  try {
    const r = repoOf(p);
    type Repo = { default_branch: string; open_issues_count: number };
    type Commit = { sha: string; commit: { message: string; author: { name: string; date: string } } };
    type Pr = { number: number; title: string; head: { ref: string }; html_url: string; draft: boolean; user: { login: string } };
    const info = await gh<Repo>(`/repos/${r}`);
    const branch = p.default_branch || info.default_branch;
    const [commit, prs, branches] = await Promise.all([
      gh<Commit>(`/repos/${r}/commits/${encodeURIComponent(branch)}`),
      gh<Pr[]>(`/repos/${r}/pulls?state=open&per_page=10`),
      gh<{ name: string }[]>(`/repos/${r}/branches?per_page=30`),
    ]);
    return {
      configured: true,
      token,
      repo,
      default_branch: branch,
      head_commit: {
        sha: commit.sha,
        message: commit.commit.message.split('\n')[0],
        author: commit.commit.author.name,
        date: commit.commit.author.date,
      },
      open_prs: prs.map((x) => ({ number: x.number, title: x.title, head: x.head.ref, url: x.html_url, draft: x.draft, author: x.user.login })),
      open_issues: info.open_issues_count - prs.length,
      branches: branches.map((b) => b.name),
    };
  } catch (e) {
    return { configured: true, token, repo, error: (e as Error).message };
  }
}

export async function createPullRequest(p: ProjectRow, i: { head: string; base: string; title: string; body: string }) {
  const r = await gh<{ number: number; html_url: string; title: string }>(
    `/repos/${repoOf(p)}/pulls`,
    { method: 'POST', body: JSON.stringify({ head: i.head, base: i.base, title: i.title.slice(0, 250), body: i.body.slice(0, 60_000) }) },
    false,
  );
  cache.clear();
  return { number: r.number, url: r.html_url, title: r.title };
}

export async function mergePullRequest(p: ProjectRow, number: number) {
  const r = await gh<{ sha: string; merged: boolean }>(
    `/repos/${repoOf(p)}/pulls/${number}/merge`,
    { method: 'PUT', body: JSON.stringify({ merge_method: 'merge' }) },
    false,
  );
  cache.clear();
  if (!r.merged) throw new Error('GitHub did not merge the PR');
  return r;
}

/** Triggers a GitHub Actions workflow (used by approved `deploy` requests). */
export async function dispatchWorkflow(p: ProjectRow, workflowFile: string, ref: string, inputs: Record<string, string>) {
  if (!/^[\w.-]+\.ya?ml$/.test(workflowFile)) throw new BadRequest('invalid workflow file name');
  await gh(
    `/repos/${repoOf(p)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
    { method: 'POST', body: JSON.stringify({ ref, inputs }) },
    false,
  );
}

export function clearGithubCache() {
  cache.clear();
}
