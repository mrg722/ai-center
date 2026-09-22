# Agentes

## Modelo

Cada agente se define por separado en cinco dimensiones (ver ADR-02):

| Dimensión | Ejemplo Claude | Ejemplo Gemini | Dónde vive |
|---|---|---|---|
| **Agent** (miembro del equipo, rol, color) | Claude · Primary Builder | Gemini · Researcher | tabla `agents` |
| **Provider** | Anthropic | Google | registro de runtimes |
| **Runtime** | Claude Code CLI | Gemini API | `agents.runtime` → registro |
| **Transport** | `local-bridge` | `http-api` | registro (copiado en `agents.transport`) |
| **Capabilities** (lo que *puede* hacer) | read, write, tests, shell, mcp… | research, analysis | `agent_capabilities` |
| **Permissions** (lo que se le *permite*) | read, write, commit | read | `permissions` + Policy Engine |

Permisos por defecto: Claude `read/write/commit` (sin push/merge), GPT/Codex `read/write/commit/push/PR` (sin merge), Gemini solo `read`. `deploy` desactivado para todos; `dangerous_operations` desactivado. Todo editable en **Agentes**, con concesiones temporales que caducan solas.

## Cómo hablan entre sí

Nunca directamente. Un agente hace una **acción** y el orquestador decide:

| Acción (MCP `acc_*` o bloque `acc-actions`) | Efecto |
|---|---|
| `send_message(to, type, content)` | mensaje a otro agente, a `moderator` o a `all` |
| `handoff(to, content)` | reasigna la tarea |
| `request_review(to?, content)` | pide revisión (por defecto al auditor) |
| `record_review(verdict, summary, findings)` | registra la revisión; `CHANGES_REQUESTED` devuelve el trabajo al autor |
| `request_approval(approval, title, detail)` | te pide permiso explícitamente |
| `update_task(status, summary, files…)` | progreso de la tarea |
| `git_request(op: commit/push/pr_create/merge/deploy)` | el orquestador decide; commit/push los ejecuta el bridge |
| `create_subtask`, `propose_decision` | subtareas y decisiones para la memoria permanente |

## Agentes locales (Agent Bridge)

El bridge es un worker **sin dependencias** que corre en tu máquina: se autentica con un token, anuncia su presencia, late cada 15 s, recibe trabajo por long-poll (conexión saliente, sin abrir puertos), ejecuta el CLI en tu repo, envía actividad y resultados, y ejecuta git solo cuando el orquestador lo ordena.

```bash
npm run bridge:build
# 1) En la web: Agentes → Claude → "Emitir token del bridge" (se muestra una sola vez)
printf '%s' 'acc_claude_…' > ~/.acc-claude.token && chmod 600 ~/.acc-claude.token

# 2) Recomendado: un worktree por agente para que no se pisen
git -C ~/code/mi-repo worktree add ../mi-repo-claude

# 3) Arrancar
ACC_URL=https://tu-app.vercel.app ACC_RUNNER=claude-code \
  node bridge/dist/bridge/src/cli.js run --token-file ~/.acc-claude.token --workspace ~/code/mi-repo-claude

# Codex (auditor), igual con su token y su worktree:
ACC_URL=… ACC_RUNNER=codex node bridge/dist/bridge/src/cli.js run --token-file ~/.acc-gpt.token --workspace ~/code/mi-repo-gpt

# Validar configuración y CLI
node bridge/dist/bridge/src/cli.js check --token-file ~/.acc-claude.token
```

También puedes usar un `acc-bridge.json` (sin token dentro — el bridge se niega a leerlo):

```json
{ "url": "https://tu-app.vercel.app", "runner": "claude-code", "workspace": "/home/yo/code/mi-repo-claude",
  "protectedBranches": ["main"], "installPushGuard": true }
```

### Qué hace cada runner

| Runner | Comando | Permisos → herramientas |
|---|---|---|
| `claude-code` | `claude -p --output-format stream-json --mcp-config <tmp>` | `write` → Edit/Write/Bash; siempre vetados `git push/commit/merge/rebase/reset --hard/branch -D/clean`; sin `dangerous_operations` → vetados `rm -rf`, `sudo`, `curl`, `wget` |
| `codex` | `codex exec --json --sandbox workspace-write|read-only -o <tmp> -` | `write` decide el sandbox; MCP `acc` inyectado con `-c mcp_servers.acc.*` |
| `command` | cualquier CLI que lea stdin (`ollama run …`, `aider`…) | sin herramientas extra |
| `echo` | arnés de pruebas (no es una IA; todo va etiquetado `[echo runner]`) | entiende `/handoff`, `/review`, `/say`, `/commit`, `/push`, `/status`, `/sleep` |

El token nunca va en la línea de comandos: el MCP `acc` lo lee de un archivo temporal 0600 que se borra al terminar la ejecución.

## Herramientas MCP (Firecrawl, Playwright, Perplexity)

En **Ajustes → Herramientas MCP** habilitas servidores que el bridge inyecta en Claude Code/Codex junto al MCP `acc`:

- **Firecrawl** (`npx -y firecrawl-mcp`, requiere `FIRECRAWL_API_KEY` en tu máquina): scraping, crawling, búsqueda, extracción.
- **Playwright** (`npx -y @playwright/mcp@latest`): navegar y verificar la app real.
- **Perplexity** (`npx -y @perplexity-ai/mcp-server`, requiere `PERPLEXITY_API_KEY`): investigación actualizada. Opcional.

Si falta la variable en tu máquina, ese servidor se omite (se avisa en el log del bridge). Las claves nunca pasan por el servidor.

## Añadir una IA nueva

**Sin código** (runtimes ya registrados): **Agentes → Añadir IA** → elige runtime (p. ej. *Ollama*, *OpenRouter*, *DeepSeek*, *OpenAI-compatible*), slug, rol, modelo, base URL si aplica y el **nombre** de la variable de entorno con su clave. Aparece en el roster, en la oficina (con su escritorio) y ya puede recibir mensajes.

**Un runtime nuevo** (otra API):
1. Implementa un `HttpRuntime` en `src/server/providers/adapters.ts` (`generate(req, cfg) → { text, tokensIn, tokensOut }`), con `provider`, `runtime`, `transport: 'http-api'`, `capabilities`, `apiKeyEnv`, `paid`.
2. Regístralo en `ALL` de `src/server/providers/registry.ts`.
3. Añade la variable a `.env.example` y `docs/ENVIRONMENT.md`.
4. Añade un test con un servidor HTTP falso (ver `tests/orchestrator.test.ts`, bloque "hosted provider round-trip").

No hace falta tocar el orquestador, la política, la UI ni la oficina.

**Un agente local nuevo**: si lee stdin → `runner=command`. Si necesitas parsear su salida en streaming, añade un `Runner` en `bridge/src/runners/` y regístralo en `makeRunner()`.

## Modo DEMO

Con el modo **Demo** todos los agentes los interpreta el simulador (`src/server/orchestrator/simulator.ts`): guiones por rol, etiquetados `[SIMULADO]`, sin tocar git, workspaces ni APIs de pago. Los bridges reales conectados quedan en espera.
