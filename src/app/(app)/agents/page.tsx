'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLive } from '@/lib/client/live';
import { api } from '@/lib/client/api';
import type { AgentView, NvidiaCatalog, RuntimeInfo } from '@/lib/client/types';
import { PERMISSION_ACTIONS, type PermissionAction } from '@/shared/domain';
import { AgentAvatar, Button, cx, Empty, Field, inputCls, Modal, Panel, StatusBadge, timeAgo } from '@/components/ui';

const PERM_LABEL: Record<PermissionAction, string> = {
  read: 'leer',
  write: 'escribir',
  commit: 'commit',
  push: 'push',
  merge: 'merge',
  dangerous_operations: 'peligrosas',
  handoff: 'handoff',
  create_task: 'crear tareas',
  pr_create: 'abrir PR',
  deploy: 'deploy',
  paid_api: 'API de pago',
};

// Comfortable, predictable reading order: the builder first, then the
// auditor, then research/second-opinion roles, everything else after —
// matches the order the roles are introduced in AGENTS.md.
const ROLE_ORDER: Record<string, number> = {
  PRIMARY_BUILDER: 0,
  AUDITOR_INTEGRATOR: 1,
  RESEARCHER: 2,
  GENERIC: 3,
};
function sortAgents(agents: AgentView[]): AgentView[] {
  return [...agents].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 4;
    const rb = ROLE_ORDER[b.role] ?? 4;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });
}

export default function AgentsPage() {
  const { snap } = useLive();
  const [providers, setProviders] = useState<RuntimeInfo[]>([]);
  const [nvidia, setNvidia] = useState<NvidiaCatalog | null>(null);
  const [token, setToken] = useState<{ agent: AgentView; token: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AgentView | null>(null);

  useEffect(() => {
    api<{ runtimes: RuntimeInfo[]; nvidia: NvidiaCatalog }>('/api/providers')
      .then((r) => {
        setProviders(r.runtimes);
        setNvidia(r.nvidia);
      })
      .catch(() => undefined);
  }, []);

  const orderedAgents = useMemo(() => (snap ? sortAgents(snap.agents) : []), [snap]);

  if (!snap) return <Empty>Cargando…</Empty>;

  async function control(a: AgentView, body: Record<string, unknown>) {
    try {
      const r = await api<{ token?: string }>(`/api/agents/${a.id}/control`, { body });
      if (r.token) setToken({ agent: a, token: r.token });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Agentes</h1>
          <p className="text-xs text-fg-dim">Roles, permisos, conexión del bridge y proveedores. Añadir una IA nueva no requiere tocar el núcleo.</p>
        </div>
        <Button variant="accent" className="ml-auto" onClick={() => setAdding(true)}>
          + Añadir IA
        </Button>
      </div>

      {orderedAgents.map((a) => (
        <Panel
          key={a.id}
          title={
            <span className="flex items-center gap-2 normal-case tracking-normal">
              <AgentAvatar name={a.name} color={a.color} size={20} status={a.status} />
              <span className="text-sm font-semibold" style={{ color: a.color }}>
                {a.name}
              </span>
              <span className="font-mono text-[11px] text-fg-dim">@{a.slug}</span>
              <StatusBadge status={a.status} />
            </span>
          }
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => control(a, { op: a.paused ? 'resume' : 'pause' })}>
                {a.paused ? 'reanudar' : 'pausar'}
              </Button>
            </>
          }
        >
          <div className="grid gap-4 p-3 md:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2 text-[12px]">
              <p className="text-fg-muted">{a.description}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[11px]">
                <dt className="text-fg-dim">Rol</dt>
                <dd>{a.role_label || a.role}</dd>
                <dt className="text-fg-dim">Proveedor</dt>
                <dd>{a.provider.name}</dd>
                <dt className="text-fg-dim">Runtime</dt>
                <dd>{a.runtime_label}</dd>
                <dt className="text-fg-dim">Transporte</dt>
                <dd className="font-mono">{a.transport}</dd>
                <dt className="text-fg-dim">Capacidades</dt>
                <dd className="font-mono text-[10px]">{a.capabilities.join(' · ') || '—'}</dd>
                <dt className="text-fg-dim">Modelo</dt>
                <dd className="font-mono">{a.model || (a.transport === 'local-bridge' ? 'por defecto del CLI' : 'por defecto del proveedor')}</dd>
                <dt className="text-fg-dim">Estado</dt>
                <dd>{a.status_reason || a.status}</dd>
                {a.transport === 'local-bridge' && (
                  <>
                    <dt className="text-fg-dim">Bridge</dt>
                    <dd>{a.client_version || '—'} · latido {timeAgo(a.last_heartbeat_at)}</dd>
                    <dt className="text-fg-dim">Token</dt>
                    <dd className="font-mono">{a.has_token ? `${a.token_prefix}…` : 'no emitido'}</dd>
                  </>
                )}
                {a.transport === 'http-api' && a.config.api_key_env && (
                  <>
                    <dt className="text-fg-dim">API key</dt>
                    <dd className="font-mono">env {a.config.api_key_env}</dd>
                  </>
                )}
              </dl>
              {a.transport === 'local-bridge' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant={a.has_token ? 'default' : 'accent'} onClick={() => (!a.has_token || confirm('Rotar el token desconectará el bridge actual. ¿Continuar?')) && control(a, { op: 'issue_token' })}>
                    {a.has_token ? 'Rotar token' : 'Emitir token del bridge'}
                  </Button>
                  {a.has_token && (
                    <Button size="sm" variant="danger" onClick={() => confirm('¿Revocar el token? El bridge quedará desconectado.') && control(a, { op: 'revoke_token' })}>
                      Revocar
                    </Button>
                  )}
                </div>
              )}
              {a.runtime === 'nvidia-nim' && (
                <NvidiaModelPicker agent={a} catalog={nvidia} onSelect={(model) => control(a, { op: 'set_model', model })} />
              )}
            </div>
            <PermissionMatrix agent={a} onChange={(body) => control(a, body)} />
          </div>
        </Panel>
      ))}

      <TokenModal data={token} onClose={() => setToken(null)} />
      <AgentForm open={adding} onClose={() => setAdding(false)} providers={providers} />
      {editing && <AgentForm open onClose={() => setEditing(null)} providers={providers} agent={editing} />}
    </div>
  );
}

function PermissionMatrix({ agent, onChange }: { agent: AgentView; onChange: (body: Record<string, unknown>) => void }) {
  const temp = new Map(agent.temporary_grants.map((g) => [g.action, g]));
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-fg-dim">Permisos efectivos</div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid={`perms-${agent.slug}`}>
        {PERMISSION_ACTIONS.map((p) => {
          const on = agent.permissions[p];
          const t = temp.get(p);
          return (
            <div key={p} className={cx('rounded-md border px-2 py-1.5', on ? 'border-st-online/30 bg-st-online/5' : 'border-line bg-ink-850')}>
              <div className="flex items-center justify-between gap-1">
                <span className={cx('text-[11px] font-medium', on ? 'text-st-online' : 'text-fg-dim')}>{PERM_LABEL[p]}</span>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`${PERM_LABEL[p]} (${agent.name})`}
                  onClick={() => onChange({ op: 'set_permission', action: p, allowed: !on, reason: 'moderator toggle' })}
                  className={cx('relative h-4 w-7 rounded-full transition-colors', on ? 'bg-st-online/70' : 'bg-ink-700')}
                >
                  <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-fg transition-all', on ? 'left-3.5' : 'left-0.5')} />
                </button>
              </div>
              {t ? (
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-accent">
                  temporal · {t.expires_at ? `expira ${new Date(t.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  <button onClick={() => onChange({ op: 'revoke_temporary', action: p })} className="underline">
                    revocar
                  </button>
                </div>
              ) : (
                !on && (
                  <button
                    onClick={() => {
                      const m = prompt(`Conceder "${PERM_LABEL[p]}" temporalmente a ${agent.name}. ¿Cuántos minutos?`, '30');
                      if (m && Number(m) > 0) onChange({ op: 'set_permission', action: p, allowed: true, temporary_minutes: Number(m), reason: 'temporary grant' });
                    }}
                    className="mt-0.5 text-[10px] text-fg-dim hover:text-accent"
                  >
                    conceder temporal…
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Search box + picklist over the live NVIDIA NIM catalogue (GET /api/providers). No typing model ids by hand. */
function NvidiaModelPicker({ agent, catalog, onSelect }: { agent: AgentView; catalog: NvidiaCatalog | null; onSelect: (model: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  if (!catalog) return null;
  if (!catalog.configured) {
    return <p className="mt-1 text-[11px] text-fg-dim">Configura NVIDIA_API_KEY en el servidor para ver el catálogo de modelos.</p>;
  }
  if (catalog.error) {
    return <p className="mt-1 text-[11px] text-st-error">Catálogo NVIDIA no disponible: {catalog.error}</p>;
  }

  const needle = q.trim().toLowerCase();
  const filtered = needle ? catalog.models.filter((m) => m.id.toLowerCase().includes(needle)) : catalog.models;

  if (!open) {
    return (
      <div className="pt-1">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Elegir modelo del catálogo ({catalog.total})
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-line bg-ink-850 p-2">
      <div className="flex items-center gap-2">
        <input
          className={cx(inputCls, 'h-7 text-[11px]')}
          placeholder={`Buscar entre ${catalog.total} modelos NVIDIA…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          cerrar
        </Button>
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 && <p className="px-1 py-2 text-[11px] text-fg-dim">Sin coincidencias.</p>}
        {filtered.slice(0, 60).map((m) => (
          <button
            key={m.id}
            onClick={() => {
              onSelect(m.id);
              setOpen(false);
              setQ('');
            }}
            className={cx(
              'block w-full truncate rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-ink-800',
              m.id === agent.model ? 'bg-accent/10 text-accent' : 'text-fg-muted',
            )}
            title={m.id}
          >
            {m.id === agent.model ? '✓ ' : ''}
            {m.id}
            {m.owned_by ? <span className="text-fg-dim"> · {m.owned_by}</span> : null}
          </button>
        ))}
        {filtered.length > 60 && <p className="px-1 py-1 text-[10px] text-fg-dim">y {filtered.length - 60} más — sigue escribiendo para acotar.</p>}
      </div>
    </div>
  );
}

function TokenModal({ data, onClose }: { data: { agent: AgentView; token: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const runner = data.agent.runtime === 'codex' ? 'codex' : data.agent.runtime === 'claude-code' ? 'claude-code' : 'command';
  const cmd = `ACC_URL=${origin} ACC_AGENT_TOKEN=${data.token} ACC_RUNNER=${runner} ACC_WORKSPACE=/ruta/a/tu/repo \\\n  node bridge/dist/bridge/src/cli.js run`;
  return (
    <Modal open onClose={onClose} title={`Token del bridge · ${data.agent.name}`} wide>
      <div className="space-y-3 text-sm">
        <p className="text-st-blocked">Cópialo ahora: no se vuelve a mostrar (solo guardamos su hash).</p>
        <pre className="overflow-x-auto rounded-md border border-line bg-ink-950 p-3 font-mono text-xs" data-testid="token-value">
          {data.token}
        </pre>
        <p className="text-xs text-fg-muted">Arranca el bridge en tu máquina, dentro del repositorio en el que trabajará el agente:</p>
        <pre className="overflow-x-auto rounded-md border border-line bg-ink-950 p-3 font-mono text-[11px] text-fg-muted">{cmd}</pre>
        <p className="text-[11px] text-fg-dim">Recomendado: guarda el token en un archivo con permisos 600 y usa --token-file. Ver docs/AGENTS.md.</p>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(data.token);
              setCopied(true);
            }}
          >
            {copied ? 'Copiado ✓' : 'Copiar token'}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AgentForm({ open, onClose, providers, agent }: { open: boolean; onClose: () => void; providers: RuntimeInfo[]; agent?: AgentView }) {
  const [f, setF] = useState(() => ({
    slug: agent?.slug ?? '',
    name: agent?.name ?? '',
    runtime: agent?.runtime ?? 'gemini',
    model: agent?.model ?? '',
    role: agent?.role ?? 'GENERIC',
    role_label: agent?.role_label ?? '',
    description: agent?.description ?? '',
    color: agent?.color ?? '#94a3b8',
    base_url: agent?.config.base_url ?? '',
    api_key_env: agent?.config.api_key_env ?? '',
    office_style: agent?.config.office_style ?? '',
    system_prompt_extra: agent?.config.system_prompt_extra ?? '',
    enabled: agent?.enabled ?? true,
  }));
  const [err, setErr] = useState<string | null>(null);
  const p = providers.find((x) => x.id === f.runtime);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = {
      slug: f.slug,
      name: f.name,
      runtime: f.runtime,
      model: f.model,
      role: f.role,
      role_label: f.role_label,
      description: f.description,
      color: f.color,
      enabled: f.enabled,
      config: {
        ...(f.base_url ? { base_url: f.base_url } : {}),
        ...(f.api_key_env ? { api_key_env: f.api_key_env } : {}),
        ...(f.office_style ? { office_style: f.office_style } : {}),
        ...(f.system_prompt_extra ? { system_prompt_extra: f.system_prompt_extra } : {}),
      },
    };
    try {
      if (agent) await api(`/api/agents/${agent.id}`, { method: 'PATCH', body });
      else await api('/api/agents', { body });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={agent ? `Editar ${agent.name}` : 'Añadir una IA'} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Runtime (proveedor · transporte)" hint={p ? `${p.provider.name} · ${p.runtime} · ${p.transport}` : undefined}>
            <select className={inputCls} value={f.runtime} onChange={(e) => set('runtime', e.target.value)} disabled={false}>
              {providers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} {x.transport === 'http-api' && x.apiKeyEnv ? (x.apiKeyPresent ? '· key ✓' : '· sin key') : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Slug (identificador)" hint="minúsculas, p. ej. deepseek">
            <input className={inputCls} value={f.slug} onChange={(e) => set('slug', e.target.value)} pattern="[a-z][a-z0-9-]{1,31}" required disabled={Boolean(agent)} />
          </Field>
          <Field label="Nombre">
            <input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Modelo" hint={p?.defaultModel ? `por defecto: ${p.defaultModel}` : 'vacío = por defecto'}>
            <input className={inputCls} value={f.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field label="Rol">
            <select className={inputCls} value={f.role} onChange={(e) => set('role', e.target.value)}>
              <option value="PRIMARY_BUILDER">Primary Builder</option>
              <option value="AUDITOR_INTEGRATOR">Auditor + Integrator</option>
              <option value="RESEARCHER">Researcher / Second opinion</option>
              <option value="GENERIC">Generic</option>
            </select>
          </Field>
          <Field label="Etiqueta del rol">
            <input className={inputCls} value={f.role_label} onChange={(e) => set('role_label', e.target.value)} />
          </Field>
          {p?.baseUrlEditable && (
            <Field label="Base URL" hint={p.defaultBaseUrl ? `por defecto: ${p.defaultBaseUrl}` : undefined}>
              <input className={inputCls} value={f.base_url} onChange={(e) => set('base_url', e.target.value)} type="url" />
            </Field>
          )}
          {p?.transport === 'http-api' && (
            <Field label="Variable de entorno con la API key" hint="El NOMBRE de la variable (termina en _API_KEY o _TOKEN). Nunca pegues la clave aquí.">
              <input className={inputCls} value={f.api_key_env} onChange={(e) => set('api_key_env', e.target.value.toUpperCase())} placeholder={p.apiKeyEnv ?? 'MY_PROVIDER_API_KEY'} />
            </Field>
          )}
          <Field label="Color">
            <input className={cx(inputCls, 'h-9 p-1')} type="color" value={f.color} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label="Estilo en la oficina">
            <select className={inputCls} value={f.office_style} onChange={(e) => set('office_style', e.target.value)}>
              <option value="">según el rol</option>
              <option value="builder">builder</option>
              <option value="reviewer">reviewer</option>
              <option value="researcher">researcher</option>
              <option value="generic">generic</option>
            </select>
          </Field>
        </div>
        <Field label="Descripción">
          <textarea className={inputCls} value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} />
        </Field>
        <Field label="Instrucciones adicionales (opcional)">
          <textarea className={inputCls} value={f.system_prompt_extra} onChange={(e) => set('system_prompt_extra', e.target.value)} rows={2} />
        </Field>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Habilitado
        </label>
        {p && <p className="text-[11px] text-fg-dim">{p.description}</p>}
        {err && <p className="text-xs text-st-error">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary">
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
