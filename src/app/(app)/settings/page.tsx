'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLive } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { RuntimeInfo } from '@/lib/client/types';
import type { ToolServerConfig } from '@/shared/protocol';
import { Button, cx, Empty, Field, inputCls, Panel } from '@/components/ui';
import { Markdown } from '@/components/Markdown';

interface Doc {
  id: string;
  kind: string;
  title: string;
  content: string;
  pinned: boolean;
}
interface Decision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  status: string;
  proposed_by_name: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const { snap } = useLive();
  if (!snap) return <Empty>Cargando…</Empty>;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <h1 className="text-lg font-semibold">Ajustes</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectForm />
        <ProvidersPanel />
      </div>
      <ToolServers />
      <Memory />
    </div>
  );
}

function ProjectForm() {
  const { snap } = useLive();
  const p = snap!.project;
  const [f, setF] = useState({
    name: p.name,
    description: p.description,
    repo: p.repo ?? '',
    default_branch: p.default_branch,
    max_auto_hops: p.max_auto_hops,
    default_reviewer: p.default_reviewer ?? '',
    daily_token_budget: p.daily_token_budget ?? 500000,
    deploy_workflow: p.deploy_workflow ?? '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/project', { method: 'PATCH', body: { ...f, max_auto_hops: Number(f.max_auto_hops), daily_token_budget: Number(f.daily_token_budget) } });
      setMsg('Guardado ✓');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <Panel title="Proyecto">
      <form onSubmit={save} className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Repositorio GitHub" hint="owner/name — GitHub es la fuente de verdad del código">
            <input className={inputCls} value={f.repo} onChange={(e) => setF({ ...f, repo: e.target.value })} placeholder="acme/web" />
          </Field>
          <Field label="Rama por defecto">
            <input className={inputCls} value={f.default_branch} onChange={(e) => setF({ ...f, default_branch: e.target.value })} />
          </Field>
          <Field label="Máx. saltos IA→IA sin humano" hint="Al llegar al límite la cadena se pausa y te pide aprobación.">
            <input className={inputCls} type="number" min={1} max={200} value={f.max_auto_hops} onChange={(e) => setF({ ...f, max_auto_hops: Number(e.target.value) })} />
          </Field>
          <Field label="Presupuesto diario de tokens por agente (APIs de pago)" hint="Política paid_api: al superarlo, las llamadas se deniegan hasta mañana o hasta que lo subas.">
            <input className={inputCls} type="number" min={0} value={f.daily_token_budget} onChange={(e) => setF({ ...f, daily_token_budget: Number(e.target.value) })} />
          </Field>
          <Field label="Workflow de deploy (GitHub Actions)" hint="p. ej. deploy.yml — un deploy SIEMPRE requiere tu aprobación.">
            <input className={inputCls} value={f.deploy_workflow} onChange={(e) => setF({ ...f, deploy_workflow: e.target.value })} placeholder="deploy.yml" />
          </Field>
          <Field label="Revisor por defecto">
            <select className={inputCls} value={f.default_reviewer} onChange={(e) => setF({ ...f, default_reviewer: e.target.value })}>
              <option value="">(auditor por rol)</option>
              {snap!.agents.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Descripción">
          <textarea className={inputCls} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">
            Guardar
          </Button>
          {msg && <span className="text-xs text-fg-muted">{msg}</span>}
        </div>
      </form>
    </Panel>
  );
}

function ProvidersPanel() {
  const [providers, setProviders] = useState<RuntimeInfo[]>([]);
  useEffect(() => {
    api<{ runtimes: RuntimeInfo[] }>('/api/providers').then((r) => setProviders(r.runtimes)).catch(() => undefined);
  }, []);
  return (
    <Panel title="Runtimes de IA (proveedor · runtime · transporte)" bodyClass="overflow-y-auto max-h-[420px]">
      <p className="px-3 pt-3 text-[11px] text-fg-dim">Las claves viven en variables de entorno del servidor; aquí solo se muestra si están presentes. Los agentes bridge usan la autenticación de su CLI local.</p>
      <table className="mt-2 w-full text-left text-[12px]">
        <tbody>
          {providers.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="px-3 py-1.5">
                <div>{p.label}</div>
                <div className="text-[10px] text-fg-dim">
                  {p.provider.name} · {p.runtime} · <span className="font-mono">{p.transport}</span>
                  {p.paid ? ' · de pago' : ''}
                </div>
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px] text-fg-dim">{p.apiKeyEnv ?? (p.transport === 'local-bridge' ? 'CLI login' : 'opcional')}</td>
              <td className="px-3 py-1.5 text-right">
                {p.transport === 'local-bridge' ? (
                  <span className="text-[11px] text-fg-dim">vía token</span>
                ) : p.apiKeyPresent ? (
                  <span className="text-[11px] text-st-online">configurado</span>
                ) : p.apiKeyOptional ? (
                  <span className="text-[11px] text-fg-dim">sin clave</span>
                ) : (
                  <span className="text-[11px] text-st-blocked">falta clave</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ToolServers() {
  const { snap } = useLive();
  const [servers, setServers] = useState<ToolServerConfig[]>(snap!.project.tool_servers);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (next: ToolServerConfig[]) => {
    setServers(next);
    try {
      await api('/api/project', { method: 'PATCH', body: { tool_servers: next } });
      setMsg('Guardado ✓');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Panel title="Herramientas MCP para agentes bridge">
      <div className="space-y-2 p-3">
        <p className="text-[11px] text-fg-dim">
          Se inyectan en Claude Code / Codex a través del bridge. Las variables (p. ej. FIRECRAWL_API_KEY) se leen del entorno de TU máquina; el servidor nunca las
          ve. Perplexity y Firecrawl son opcionales: solo se usan si los habilitas.
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          {servers.map((s, i) => (
            <div key={s.name} className={cx('rounded-md border p-2.5', s.enabled ? 'border-st-online/30 bg-st-online/5' : 'border-line bg-ink-850')}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{s.name}</span>
                <button
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label={`Habilitar ${s.name}`}
                  onClick={() => save(servers.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}
                  className={cx('relative h-4 w-7 rounded-full', s.enabled ? 'bg-st-online/70' : 'bg-ink-700')}
                >
                  <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-fg transition-all', s.enabled ? 'left-3.5' : 'left-0.5')} />
                </button>
              </div>
              <p className="mt-1 text-[11px] text-fg-muted">{s.description}</p>
              <p className="mt-1 break-all font-mono text-[10px] text-fg-dim">
                {s.transport === 'stdio' ? `${s.command} ${(s.args ?? []).join(' ')}` : s.url}
              </p>
              {s.env_vars && s.env_vars.length > 0 && <p className="mt-0.5 font-mono text-[10px] text-fg-dim">env: {s.env_vars.join(', ')}</p>}
            </div>
          ))}
        </div>
        {msg && <p className="text-xs text-fg-muted">{msg}</p>}
      </div>
    </Panel>
  );
}

function Memory() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [draft, setDraft] = useState({ kind: 'rule', title: '', content: '', pinned: true });
  const load = useCallback(() => {
    api<{ docs: Doc[]; decisions: Decision[] }>('/api/context').then((r) => {
      setDocs(r.docs);
      setDecisions(r.decisions);
    });
  }, []);
  useEffect(() => load(), [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api('/api/context', { body: draft }).catch((e) => alert(e.message));
    setDraft({ ...draft, title: '', content: '' });
    load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Memoria permanente · reglas y arquitectura">
        <div className="space-y-2 p-3">
          <p className="text-[11px] text-fg-dim">Se envía (resumida y con presupuesto) a cada agente. Mantén aquí reglas, arquitectura y resultados importantes.</p>
          {docs.map((d) => (
            <details key={d.id} className="rounded-md border border-line bg-ink-850 p-2">
              <summary className="cursor-pointer text-[12px]">
                <span className="mr-2 rounded bg-ink-800 px-1 font-mono text-[10px] text-fg-dim">{d.kind}</span>
                {d.title}
                {d.pinned && <span className="ml-2 text-[10px] text-accent">fijado</span>}
              </summary>
              <div className="mt-2">
                <Markdown text={d.content} />
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 text-st-error"
                  onClick={async () => {
                    if (!confirm('¿Eliminar?')) return;
                    await api(`/api/context/${d.id}`, { method: 'DELETE' });
                    load();
                  }}
                >
                  eliminar
                </Button>
              </div>
            </details>
          ))}
          <form onSubmit={add} className="space-y-2 border-t border-line pt-3">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select className={inputCls} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {['rule', 'architecture', 'documentation', 'glossary', 'note', 'result'].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <input className={inputCls} placeholder="Título" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
            </div>
            <textarea className={inputCls} rows={3} placeholder="Contenido" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} required />
            <Button type="submit" size="sm" variant="accent">
              Añadir a la memoria
            </Button>
          </form>
        </div>
      </Panel>
      <Panel title="Decisiones">
        <div className="space-y-2 p-3">
          {!decisions.length && <p className="text-xs text-fg-dim">Las decisiones que propongan los agentes aparecerán aquí para que las aceptes.</p>}
          {decisions.map((d) => (
            <div key={d.id} className="rounded-md border border-line bg-ink-850 p-2.5 text-[12px]">
              <div className="flex items-center gap-2">
                <span className={cx('font-mono text-[10px] uppercase', d.status === 'accepted' ? 'text-st-online' : d.status === 'proposed' ? 'text-accent' : 'text-fg-dim')}>{d.status}</span>
                <span className="font-medium">{d.title}</span>
                {d.proposed_by_name && <span className="ml-auto text-[10px] text-fg-dim">por {d.proposed_by_name}</span>}
              </div>
              <p className="mt-1 text-fg-muted">{d.decision}</p>
              {d.rationale && <p className="mt-1 text-[11px] text-fg-dim">{d.rationale}</p>}
              <div className="mt-2 flex gap-2">
                {d.status !== 'accepted' && (
                  <Button size="sm" variant="accent" onClick={() => api(`/api/decisions/${d.id}`, { method: 'PATCH', body: { status: 'accepted' } }).then(load)}>
                    Aceptar
                  </Button>
                )}
                {d.status !== 'superseded' && (
                  <Button size="sm" variant="ghost" onClick={() => api(`/api/decisions/${d.id}`, { method: 'PATCH', body: { status: 'superseded' } }).then(load)}>
                    Descartar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
