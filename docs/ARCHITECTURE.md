# Arquitectura — AI Command Center

> Centro de mando multiagente: varias IAs trabajan sobre el mismo proyecto, se
> comunican **solo a través del orquestador** y un humano (el moderador) puede
> observar e intervenir en todo momento.

## 1. Vista general

```
┌────────────────────────── NAVEGADOR (moderador) ──────────────────────────┐
│ Command Center · AI Office (canvas pixel art) · Tareas · Agentes · Ajustes │
│        fetch /api/*  (cookie de sesión)      EventSource /api/stream        │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ nunca recibe API keys ni tokens
┌───────────────────────────────▼────────────────────────────────────────────┐
│ NEXT.JS (App Router) — BACKEND / ORQUESTADOR                              │
│  http/route.ts   auth · CSRF · rate limit · validación (zod)               │
│  orchestrator/   policy · router · tasks · actions · approvals · context   │
│                  bridge protocol · hosted runner · moderator ops · state   │
│  providers/      registro de runtimes (provider · runtime · transport)     │
│  github/         REST (estado, PR, merge) + webhook firmado                │
│  events/bus      eventos durables (tabla events) + efímeros (memoria)      │
└──────┬─────────────────────────┬───────────────────────────┬──────────────┘
       │ SQL                     │ HTTPS (Bearer agent token) │ HTTPS (API keys del servidor)
┌──────▼───────┐        ┌────────▼─────────┐        ┌────────▼──────────────┐
│ PostgreSQL   │        │ AGENT BRIDGE     │        │ PROVEEDORES HOSTED    │
│ (Supabase)   │        │ (tu máquina)     │        │ Gemini · OpenAI API · │
│ estado       │        │ worker + MCP acc │        │ Anthropic API ·       │
│ operacional  │        │  ├ Claude Code   │        │ Perplexity · Ollama · │
└──────────────┘        │  ├ Codex CLI     │        │ OpenRouter · …        │
                        │  └ comando local │        └───────────────────────┘
                        │ MCP tools:       │
                        │ Firecrawl ·      │        ┌───────────────────────┐
                        │ Playwright ·     │───git──▶ GITHUB (fuente de     │
                        │ Perplexity       │        │ verdad del código)    │
                        └──────────────────┘        └───────────────────────┘
```

## 2. Decisiones de arquitectura (ADR)

### ADR-01 · Una sola fuente de verdad para el estado

```
AgentState  (ONLINE · OFFLINE · WORKING · THINKING · WAITING · REVIEWING · ERROR · BLOCKED)
     ↓  calculado SOLO por el orquestador: deriveStatus() en orchestrator/repo.ts
Orchestrator  ← señales reales: heartbeats del bridge, sesiones de runtimes, flags del moderador, tareas
     ↓
Postgres (agent_sessions + tabla events)
     ↓
SSE /api/stream
     ↓
Frontend (store LiveProvider)
     ↓
Vistas: roster · barra de estado · oficina · panel del agente
```

- Ninguna vista calcula estados. La oficina **representa** `agent.status`; nunca decide que Claude está trabajando. Sus animaciones son una función pura del estado (WORKING → teclea y hay código en pantalla; OFFLINE → silla vacía y monitor apagado).
- El estado global del sistema (`HALTED · NEEDS_YOU · DEMO · ACTIVE · IDLE · NO_AGENTS`) también lo calcula el servidor (`systemState()` en `state.ts`).
- No hay vocabularios paralelos ("Office: ANIMATING", "Conversation: ACTIVE", "Bridge: ONLINE"…): existen solo `AgentState`, `TaskStatus` (máquina de estados de tareas), el estado de entrega de cada mensaje y `SystemState`, cada uno con un único dueño.
- Los cambios que dependen del **paso del tiempo** (un bridge deja de latir, una ejecución se cuelga) los convierte en eventos el *presence sweeper* (`sweepPresence`), que corre en el bucle SSE, en el cron y en el worker. El navegador no hace polling.

### ADR-02 · Agent ≠ Provider ≠ Runtime ≠ Transport ≠ Capabilities

```
Claude                      Qwen (mañana)               Gemini
 ├─ Provider: Anthropic      ├─ Provider: Ollama         ├─ Provider: Google
 ├─ Runtime: Claude Code CLI ├─ Runtime: Ollama server   ├─ Runtime: Gemini API
 ├─ Transport: local-bridge  ├─ Transport: http-api      ├─ Transport: http-api
 └─ Capabilities: read,      └─ Capabilities: analysis   └─ Capabilities: research…
    write, tests, shell…
Permisos (lo que se le PERMITE) viven aparte y los aplica el Policy Engine.
```

- `agents.runtime` es la clave del **registro de runtimes** (`src/server/providers/registry.ts`). El registro resuelve proveedor, transporte, capacidades, env var de la clave, modelo por defecto y si es de pago.
- El núcleo nunca hace `if claude… if codex… if gemini`. Lo único que ramifica es el **transporte**: `local-bridge` (worker en tu máquina), `http-api` (el orquestador llama la API) o `in-process` (simulador DEMO).
- Añadir una IA = una entrada en el registro, o solo configuración si es compatible con OpenAI (Ollama, LM Studio, vLLM, OpenRouter, DeepSeek, Qwen…).

### ADR-03 · Transportes en tiempo real: qué lleva cada canal

| Canal | Qué transporta | Dirección |
|---|---|---|
| **Postgres** | estado persistente (tareas, mensajes, entregas, sesiones, aprobaciones…) | — |
| **Tabla `events`** | log durable y ordenado de todo cambio (auditoría + cursor de sincronización) | orquestador → |
| **SSE `/api/stream`** | **único** canal hacia el navegador: eventos durables (seguidos por id, reanudables con `Last-Event-ID`) + actividad efímera (lo que teclea/ejecuta un agente, nunca persistida) | orquestador → navegador |
| **HTTP long-poll `/api/bridge/inbox`** | único canal hacia los bridges locales (conexión saliente, sin puertos abiertos en tu máquina) | bridge ↔ orquestador |
| **Webhooks** | solo entrada desde GitHub (push, PR, issues) con firma HMAC | GitHub → orquestador |
| **Polling** | solo *dentro del servidor*: el bucle SSE sigue la tabla `events` cada 1,5 s (despierta al instante con el bus en memoria en la misma instancia). El cliente **no** hace polling. | interno |

**Decisión: no se usa Supabase Realtime.** Motivos: (1) el frontend no necesita clave de Supabase ni políticas RLS de lectura; (2) SSE funciona igual con Supabase, con Postgres propio o con PGlite local; (3) un único canal evita estados divergentes. Supabase se usa como Postgres gestionado. Si en el futuro se quisiera Realtime, reemplazaría solo el transporte SSE (la tabla `events` ya es la fuente).

### ADR-04 · Seguridad y aprobación desde el núcleo

```
Action → Policy Engine (decide) → ¿permitido? → ¿requiere aprobación? → Execute
                                 └ deny → auditado (evento policy.decision) y explicado al agente
```

Pasan por la política **antes** de ocurrir: conversar/handoff/revisión, crear tareas, **ejecutar un agente en una máquina local** (`local_run`, requiere `read`; `write` decide si el CLI puede modificar archivos y usar la shell), **commit**, **push**, **PR**, **merge**, **deploy** (siempre con aprobación; dispara un workflow de GitHub Actions), **llamar a una API de pago** (`paid_api` + presupuesto diario de tokens por agente), completar tareas y operaciones peligrosas.

### ADR-05 · Modo DEMO

Un runtime `in-process` (**simulador**) interpreta a todos los agentes cuando el proyecto está en modo DEMO: comportamiento guionado por rol (builder implementa y pide revisión, auditor pide cambios y luego aprueba y pide push, investigador da segunda opinión). Todo lo que produce va marcado `[SIMULADO]`, la UI muestra un banner DEMO y los agentes aparecen como `simulated`. Su estado fluye por el **mismo camino** (sesiones → orquestador → eventos → UI) y sus acciones por la **misma política** (reglas de SUPERVISADO), pero la ejecución de git/GitHub/APIs se simula: nada real se toca. Sirve para desarrollar y probar la interfaz sin conectar agentes.

### Otras decisiones

| # | Decisión | Motivo |
|---|----------|--------|
| 06 | Las IAs nunca se llaman entre sí: `executeAgentAction → authorize → router.postMessage`. | Control, auditoría y parada centralizados. |
| 07 | Cola de entregas en Postgres (`deliveries`, lease + `FOR UPDATE SKIP LOCKED`). | Igual en serverless que en servidor; reintentos si un bridge muere. |
| 08 | MCP `acc` expuesto por el bridge a Claude Code / Codex; token en archivo 0600. | Herramientas nativas (`acc_handoff`, `acc_request_review`, `acc_git_request`…) en vez de parsear texto. |
| 09 | Git lo ejecuta el bridge tras la decisión del orquestador; `git commit/push` están vetados en las herramientas del CLI. | Commits/push trazables, sin `--force`, ramas protegidas. La barrera real sigue siendo *branch protection* + token mínimo. |
| 10 | Postgres (Supabase) = estado; GitHub = código. RLS activado sin políticas. | La API anónima de Supabase no puede leer nada. |
| 11 | PGlite cuando `DATABASE_URL` está vacío. | Arranque local sin instalar nada, mismo SQL. |
| 12 | Auth propia mínima (scrypt + cookie HMAC, versión revocable) y `/setup` con `SETUP_TOKEN`. | Sin dependencia externa; migrable a Supabase Auth/Auth0 detrás de `auth/session.ts`. |

## 3. Flujo típico (TASK DF-001)

1. El moderador crea la tarea y la asigna a Claude → `tasks` + conversación + mensaje `TASK` → entrega `PENDING`.
2. El bridge de Claude (long-poll `/api/bridge/inbox`) la reclama → la tarea pasa a `IN_PROGRESS`; el **Context Manager** construye el prompt mínimo.
3. Claude Code trabaja en tu repo y, vía MCP, llama `acc_request_review(to: "gpt")`.
4. Política: en **MODERADO** → aprobación pendiente (`approvals`), visible en la UI. En **SUPERVISADO/AUTÓNOMO** → se entrega directamente.
5. GPT/Codex recibe `REVIEW`, audita, `acc_record_review(CHANGES_REQUESTED)` → vuelve a Claude automáticamente (limitado por saltos).
6. Gemini puede dar segunda opinión (`send_message` a quien corresponda).
7. GPT pide `acc_git_request(push)` → aprobación (moderado/supervisado) → `COMMAND git_push` al bridge de GPT → resultado registrado (`git_refs`, tarea, mensaje).
8. El moderador aprueba o rechaza la tarea.

Si el agente termina su turno sin pasar el trabajo, la tarea queda en `WAITING_USER`: nunca hay bucles silenciosos.

## 4. Modos

| Acción | DEMO (simulado) | MODERADO | SUPERVISADO | AUTÓNOMO |
|---|---|---|---|---|
| Conversar (mensajes) | ✓ | ✓ | ✓ | ✓ |
| Handoff / pedir revisión | ✓ | aprobación | ✓ | ✓ |
| Crear subtareas | ✓ | aprobación | ✓ | ✓ |
| Commit | ✓ (simulado) | aprobación | ✓ | ✓ |
| Push / abrir PR | aprobación (simulado) | aprobación | aprobación | ✓ |
| Merge / deploy / operaciones peligrosas | aprobación | aprobación | aprobación | aprobación |
| Completar tarea con `requires_human_approval` | aprobación | aprobación | aprobación | aprobación |
| Ejecutar en máquina local | nunca | con `read` | con `read` | con `read` |
| API de pago | nunca | `paid_api` + presupuesto | ídem | ídem |

Siempre: permisos del agente (si no lo tiene → denegado), **STOP ALL**, pausa de agente/tarea y **límite de saltos IA→IA** (`max_auto_hops`, por defecto 10; cualquier mensaje humano lo reinicia).

## 5. Memoria por capas

| Capa | Dónde | Qué | Vida |
|---|---|---|---|
| Permanente | `project_context`, `decisions` | reglas, arquitectura, documentación, decisiones aceptadas | hasta que la cambies |
| Tarea | `tasks`, `task_steps`, `messages`, `reviews`, `git_refs`, `agent_runs` | objetivo, archivos, cambios, conversación, revisiones | la de la tarea |
| Sesión | `agent_sessions` (una fila por bridge, actualizada in situ) + bus en memoria | presencia, estado, actividad, streaming | efímera; el streaming **no se persiste** |

El **Context Manager** (`orchestrator/context.ts` + `context-render.ts`) combina capas con un presupuesto de caracteres (`CONTEXT_BUDGET_CHARS`, 24k por defecto): identidad y reglas nunca se recortan; la conversación se recorta desde lo más antiguo (resumen extractivo); el mensaje a atender va al final.

## 6. Seguridad

- Secretos solo en variables de entorno del servidor (`src/server/env.ts` es `server-only`: importarlo desde el cliente rompe el build).
- Los agentes hosted solo pueden referenciar variables `*_API_KEY`/`*_TOKEN` (no `SESSION_SECRET`, `DATABASE_URL`, `GITHUB_TOKEN`).
- Tokens de agente: aleatorios de 256 bits, solo se guarda su SHA-256, se muestran una vez, rotables/revocables.
- CSRF: `SameSite=Strict` + verificación de `Origin` en mutaciones. CSP estricta, `X-Frame-Options: DENY`.
- Rate limiting por usuario, agente e IP (en memoria; sustituible por Redis).
- Validación zod con límites de tamaño en toda entrada; ramas validadas (`--force`, `;` → rechazados).
- **Prompt injection**: contenido de otros agentes, webhooks, web o herramientas se envuelve en `<untrusted_data>` (con escape de etiquetas); los permisos los decide la política, no el prompt; los tipos `COMMAND`/`TASK` no pueden emitirlos agentes.
- Webhook de GitHub con HMAC SHA-256 en tiempo constante.
- Nada de ejecución arbitraria desde el navegador: la UI solo llama endpoints tipados.
- Git: sin `--force`, sin borrar ramas, ramas protegidas en el bridge, trailers `ACC-Task`/`ACC-Agent` en commits.

## 7. Estructura del código

```
src/shared/            vocabulario y protocolo (compartido con el bridge)
src/server/db/         driver pg/PGlite + migrador
src/server/orchestrator/
  policy.ts            decisiones allow / approval / deny
  router.ts            mensajes, entregas, retenciones, cancelaciones
  tasks.ts             motor de tareas
  actions.ts           ejecución de acciones de agentes
  moderator.ts         operaciones humanas (STOP ALL, permisos, aprobaciones…)
  context*.ts          Context Manager
  bridge.ts / runs.ts  protocolo del bridge y ciclo de vida de ejecuciones
  hosted.ts            runner de agentes por API
  state.ts             modelos de lectura para la UI
src/server/providers/  adaptadores de IA
src/server/github/     integración GitHub
src/app/api/           endpoints (finos: validan y delegan)
src/app/(app)/         páginas protegidas
src/components/        UI + office/ (escena pixel art)
bridge/                worker local + servidor MCP (sin dependencias)
supabase/migrations/   esquema SQL
```

## 8. Estado por fases

| Fase | Estado |
|---|---|
| DEMO (agentes simulados) | ✅ |
| 1 Web, dashboard, proyecto, agentes, tareas, mensajes, BD, auth, realtime | ✅ implementado y probado |
| 2 Agent Bridge, Claude Code local, Codex local, estado real | ✅ implementado (runners probados con el harness; los CLIs reales requieren tu máquina) |
| 3 Oficina pixel art, animaciones, selección, panel | ✅ |
| 4 Gemini, Perplexity, Firecrawl, Playwright, adaptadores MCP | ✅ adaptadores y configuración; se activan con tus claves / en tu bridge |
| 5 Automatización, handoffs, aprobaciones, revisiones, GitHub avanzado | ✅ handoffs/revisiones/aprobaciones/push/PR/merge/deploy; pendientes: checks de CI en la UI, multi-proyecto en la UI |
