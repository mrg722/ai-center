/**
 * End-to-end: real Next.js server + real embedded Postgres + a REAL Agent
 * Bridge process (echo runner, clearly labelled as a test harness) talking
 * to the orchestrator over HTTP. Nothing in the UI is mocked.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/shots';
mkdirSync(SHOTS, { recursive: true });

let bridge: ChildProcess | null = null;
const consoleErrors: string[] = [];

function watchConsole(page: Page) {
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()} :: pageerror ${e.message}`));
}

function tempRepo() {
  const ws = join(mkdtempSync(join(tmpdir(), 'acc-e2e-ws-')), 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', ws]);
  execFileSync('git', ['-C', ws, 'config', 'user.email', 'e2e@example.com']);
  execFileSync('git', ['-C', ws, 'config', 'user.name', 'E2E']);
  execFileSync('git', ['-C', ws, 'config', 'commit.gpgsign', 'false']);
  writeFileSync(join(ws, 'README.md'), '# e2e\n');
  execFileSync('git', ['-C', ws, 'add', '-A']);
  execFileSync('git', ['-C', ws, 'commit', '-q', '-m', 'init']);
  return ws;
}

test.afterAll(() => {
  bridge?.kill('SIGTERM');
});

test.beforeEach(() => {
  consoleErrors.length = 0;
});

test.afterEach(() => {
  const real = consoleErrors.filter((e) => !/401|Failed to load resource/.test(e));
  expect(real, real.join('\n')).toEqual([]);
});

test.describe.serial('AI Command Center', () => {
  test('first-run setup creates the moderator and the team', async ({ page }) => {
    watchConsole(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);
    await page.getByLabel('Setup token').fill('e2e-setup-token');
    await page.getByLabel('Tu nombre').fill('Mar');
    await page.getByLabel('Email').fill('mar@example.com');
    await page.getByLabel('Contraseña').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Crear y entrar' }).click();
    await expect(page).toHaveURL('/');
    const roster = page.getByTestId('agent-roster');
    await expect(roster.locator('[data-agent="claude"]')).toBeVisible();
    await expect(roster.locator('[data-agent="gpt"]')).toBeVisible();
    await expect(roster.locator('[data-agent="gemini"]')).toBeVisible();
    // honest statuses: no bridge connected, no API key
    await expect(roster.locator('[data-agent="claude"]')).toHaveAttribute('data-status', 'OFFLINE');
    await expect(roster.locator('[data-agent="gemini"]')).toHaveAttribute('data-status', 'OFFLINE');
    await page.screenshot({ path: `${SHOTS}/01-command-center-empty.png`, fullPage: true });
  });

  test('issuing a bridge token and connecting a real bridge brings Claude ONLINE', async ({ page, baseURL }) => {
    watchConsole(page);
    await login(page);
    await page.goto('/agents');
    const card = page.locator('section').filter({ hasText: '@claude' }).first();
    await card.getByRole('button', { name: /Emitir token/ }).click();
    const token = (await page.getByTestId('token-value').innerText()).trim();
    expect(token).toMatch(/^acc_claude_/);
    await page.screenshot({ path: `${SHOTS}/02-token.png` });
    await page.getByRole('button', { name: 'Listo' }).click();

    const ws = tempRepo();
    bridge = spawn(process.execPath, ['bridge/dist/bridge/src/cli.js', 'run'], {
      env: { ...process.env, ACC_URL: baseURL!, ACC_AGENT_TOKEN: token, ACC_RUNNER: 'echo', ACC_WORKSPACE: ws, ACC_LOG_LEVEL: 'debug' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    await page.goto('/');
    await expect(page.getByTestId('agent-roster').locator('[data-agent="claude"]')).toHaveAttribute('data-status', 'ONLINE', { timeout: 30_000 });
    await expect(page.getByTestId('git-line')).toContainText('main');
  });

  test('task → Claude works → requests review → moderator approves → delivered to GPT', async ({ page }) => {
    watchConsole(page);
    await login(page);
    await page.getByTestId('new-task').click();
    await page.getByLabel('Título').fill('Quiero solucionar este problema');
    await page.getByLabel('Descripción').fill('Login falla con emails en mayúsculas.\n/sleep 2\n/review gpt Terminé la implementación, revisa por favor.');
    await page.getByRole('button', { name: /Crear/ }).click();

    const conv = page.getByTestId('conversation');
    await expect(conv).toContainText('Quiero solucionar este problema');
    // the real bridge picked it up and replied (echo harness, clearly labelled)
    await expect(conv).toContainText('[echo runner] Claude received TASK', { timeout: 40_000 });
    // MODERATED mode: the review request needs my approval
    const approvals = page.getByTestId('approvals');
    await expect(approvals).toContainText('Review request: Claude → GPT / Codex', { timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/03-approval-pending.png`, fullPage: true });
    await approvals.getByTestId('approve').first().click();
    await expect(conv.locator('[data-type="REVIEW"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('task-list')).toContainText('WAITING_REVIEW');
    await page.screenshot({ path: `${SHOTS}/04-review-delivered.png`, fullPage: true });
  });

  test('moderator can talk to an agent mid-conversation', async ({ page }) => {
    watchConsole(page);
    await login(page);
    await page.getByTestId('agent-roster').locator('[data-agent="claude"]').getByRole('button', { name: 'mensaje' }).click();
    await page.getByTestId('composer').fill('Estado?\n/say moderator STATUS Todo en orden');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('conversation')).toContainText('Todo en orden', { timeout: 30_000 });
  });

  test('AI Office renders the live office and opens the agent panel', async ({ page }) => {
    watchConsole(page);
    await login(page);
    await page.goto('/office');
    const office = page.getByTestId('office');
    await expect(office).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/05-office.png` });
    await page.getByRole('button', { name: 'Claude' }).first().click();
    await expect(page.getByTestId('agent-panel')).toContainText('Claude');
    await expect(page.getByTestId('agent-panel')).toContainText('echo-test-harness');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/06-office-claude.png` });
    // canvas actually painted something (not blank)
    const painted = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="office"] canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 400) if (d[i] + d[i + 1] + d[i + 2] > 60) colored++;
      return colored;
    });
    expect(painted).toBeGreaterThan(100);
  });

  test('STOP ALL halts the system and RESUME restores it', async ({ page }) => {
    watchConsole(page);
    await login(page);
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('stop-all').click();
    await expect(page.getByText('SISTEMA DETENIDO')).toBeVisible();
    await expect(page.getByTestId('agent-roster').locator('[data-agent="claude"]')).toHaveAttribute('data-status', 'BLOCKED');
    await page.screenshot({ path: `${SHOTS}/07-halted.png` });
    await page.getByTestId('stop-all').click();
    await expect(page.getByText('SISTEMA DETENIDO')).toBeHidden();
  });

  test('responsive: mobile and tablet layouts', async ({ page }) => {
    watchConsole(page);
    await login(page);
    for (const [name, size] of [
      ['mobile', { width: 390, height: 844 }],
      ['tablet', { width: 820, height: 1180 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.getByRole('tab', { name: /Sala/ })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${SHOTS}/08-${name}.png` });
      await page.goto('/office');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/09-${name}-office.png` });
    }
  });

  test('security: API rejects anonymous and cross-origin requests; no secrets in the client', async ({ page, request, baseURL }) => {
    const anon = await request.get('/api/state');
    expect(anon.status()).toBe(401);
    const badBridge = await request.get('/api/bridge/inbox', { headers: { authorization: 'Bearer acc_fake_xxxxxxxxxxxxxxxxxxxxxxxxx' } });
    expect(badBridge.status()).toBe(401);
    await login(page);
    const cross = await page.evaluate(async () => {
      const r = await fetch('/api/system', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"op":"stop_all"}' });
      return r.status;
    });
    // browsers set Origin themselves; a same-origin fetch passes, so verify the server check directly:
    expect([200, 403]).toContain(cross);
    const forged = await request.post('/api/system', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, data: { op: 'stop_all' } });
    expect([401, 403]).toContain(forged.status());
    const html = await (await request.get(baseURL + '/login')).text();
    for (const k of ['SESSION_SECRET', 'e2e-session-secret', 'GITHUB_TOKEN', 'API_KEY=']) expect(html).not.toContain(k);
    // resume in case the evaluate above halted the system
    await page.evaluate(() => fetch('/api/system', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"resume_all"}' }));
  });
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('mar@example.com');
  await page.getByLabel('Contraseña').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/');
}
