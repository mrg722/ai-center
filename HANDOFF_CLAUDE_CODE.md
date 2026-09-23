# Handoff para Claude Code — AI Command Center (`mrg722/ai-center`)

> Prompt consolidado para pegar en una sesión nueva de Claude Code. Junta el handoff de Claude (Cowork), el de GPT/Codex y una verificación directa del repo, CI y PRs hecha el **2026-09-23**. Donde los handoffs anteriores no coinciden con el repo, manda lo verificado (sección 3).

Vas a continuar el proyecto **AI Command Center** en `mrg722/ai-center` (rama `main`, HEAD `59a4885`). Antes trabajaron en él Claude (arquitectura e implementación) y GPT/Codex (despliegue en Vercel y "modo smoke test"). No tienes acceso a la memoria de esas sesiones: **todo el contexto está aquí**. La primera tarea es guardarlo en el repo para que no se pierda otra vez.

Responde y documenta en español. Usa commits claros (`fix:`, `feat:`, `docs:`, `security:`) y trabaja en ramas con PR hacia `main`. Nunca hagas `push --force`, no borres ramas, no reescribas historia publicada y no pongas secretos en el código, los commits, los logs ni los prompts. No declares nada "terminado" si fallan lint, typecheck, tests, build o e2e. **No hagas push directo a `main`.** GPT lo hizo con 7 commits y así se coló el problema de seguridad.

---

## 1. Qué es el proyecto

Es un centro de mando multiagente donde el usuario es el **moderador**:
- Claude es PRIMARY_BUILDER (`claude-code`, `local-bridge`): read, write y commit, sin push ni merge.
- GPT/Codex es AUDITOR_INTEGRATOR (`codex`, `local-bridge`): puede hacer push y abrir PRs, pero no merge.
- Gemini es RESEARCHER (`antigravity`, `local-bridge`): solo lectura.

Los agentes colaboran **solo a través del orquestador** (A → Orquestador → B, nunca de forma directa). La plataforma incluye:
- sala de conversación en tiempo real;
- tareas, aprobaciones y permisos;
- **STOP ALL**;
- modos DEMO, MODERATED, SUPERVISED y AUTONOMOUS;
- una **AI Office** en pixel art que refleja el estado real de los agentes. La oficina nunca decide el estado.

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind 4 · Postgres/Supabase (PGlite embebido si `DATABASE_URL` está vacío) · Vercel · Agent Bridge en Node sin dependencias · MCP · Vitest, Playwright y ESLint 9.

### Principios de arquitectura (no romper)
- **Una sola fuente de verdad del estado.** `AgentState` (ONLINE, OFFLINE, WORKING, THINKING, WAITING, REVIEWING, ERROR, BLOCKED) lo calcula `deriveStatus()` en `orchestrator/repo.ts`. El flujo es: Orquestador → Postgres `events` → SSE → frontend → Office. El estado global lo calcula `systemState()` en `state.ts`.
- **Agent, Provider, Runtime, Transport, Capabilities y Permissions son conceptos distintos.** No escribas `if (agent.slug === 'claude')` en el núcleo; ramifica por `transport` o por las capacidades del registro (`src/server/providers/registry.ts`).
- **Toda acción sensible pasa por el Policy Engine.** Commit, push, merge, deploy, comando local, API de pago y modificación de archivos pasan por `authorize()`/`decide()` y quedan en el audit log (`policy.decision`).
- **Transporte (ADR-03).** SSE `/api/stream` es el único canal hacia el navegador y se reanuda con `Last-Event-ID`. Los bridges hacen long-poll a `/api/bridge/inbox`. Los webhooks de GitHub son solo de entrada. **No se usa Supabase Realtime.**
- **Nada simulado fuera de DEMO.** Lo que no está configurado se muestra como no configurado.
- **Los secretos viven solo en el servidor.** `src/server/env.ts` es `server-only`; nunca uses `NEXT_PUBLIC_*` para claves.
- **Otros límites:** hay un límite de saltos IA→IA (`max_auto_hops`), el contenido externo va envuelto en `<untrusted_data>` y la cola `deliveries` usa lease + `FOR UPDATE SKIP LOCKED`.

### Mapa del código
- **`supabase/migrations/0001_init.sql`:** 18 tablas, RLS activado sin políticas, `_acc_migrations` y `acc_gen_random_uuid()`.
- **`0002_finalize_connections.sql`:** `provider_session_id` y Gemini pasa a `antigravity`/`local-bridge`. OJO: `0001` ya contiene también ese bloque (líneas ~390+).
- **`src/server/orchestrator/`:**
  - router (`postMessage`), políticas, aprobaciones, máquina de estados de tareas;
  - Context Manager;
  - `hosted.ts` (runtimes http-api) y `simulator.ts` (DEMO);
  - `setup.ts` y el presence sweeper.
- **`src/server/providers/`:**
  - local-bridge: claude-code, codex, antigravity, local-command;
  - API: anthropic, openai, gemini, perplexity, openrouter, deepseek, mistral, qwen, vercel-ai-gateway, ollama, lmstudio, openai-compatible, generic-http, generic-mcp;
  - in-process: simulator.
- **Sesión y entorno:** `src/server/auth/session.ts` maneja la cookie firmada `acc_session`; `src/server/env.ts`, las variables de entorno.
- **Cliente:** `src/lib/client/live.tsx` es el proveedor SSE; `src/components/office/` es la AI Office (canvas procedural).
- **`bridge/`:**
  - worker local con runners claude-code, codex, antigravity, command y echo;
  - servidor MCP stdio `acc` con: acc_send_message, handoff, request_review, record_review, request_approval, update_task, git_request, create_subtask, propose_decision, get_context, list_agents;
  - el git lo ejecuta solo el bridge por orden del orquestador; las ramas `main`/`master` están protegidas;
  - el token (`acc_<agent>_<secret>`) va en un archivo 0600, nunca en `acc-bridge.json`.
- **Docs:** `README.md`, `docs/ARCHITECTURE.md` (ADR-01..05), `SETUP.md`, `ENVIRONMENT.md`, `AGENTS.md`, `DEPLOYMENT.md`, `NEXT_STEPS.md`, `PROMPT_CLAUDE.md`, `WEB_SESSIONS.md` y `CONTRIBUTING.md`. `docs/index.html` es una **maqueta estática** para GitHub Pages, no la app.
- **Calidad:** `npm run lint`, `typecheck`, `test`, `test:bridge`, `build` y `test:e2e` (Playwright + bridge real con runner echo). La CI (`.github/workflows/ci.yml`, Node 24) los ejecuta todos.

### Infraestructura
- **Vercel:**
  - proyecto `ai-center` (`prj_An5plOjudTITqQVrE08v3KdZcSiw`, team `team_S6VudGhAbZTVMYf2XnTcWbAV`);
  - último deployment READY: `dpl_Hxjwriw5XXbevEQvFGAoCNe1wHWJ` sobre `59a4885`, en https://ai-center-iqvculy9y-mrg722.vercel.app;
  - solo está comprobado que `/login` responde 200. **El flujo setup → login → dashboard no está verificado.**
- **Supabase:**
  - proyecto `ai-command-center` (ref `tmdrxhsjpthhaixsbfmg`, sa-east-1, ACTIVE_HEALTHY);
  - esquema comprobado en solo lectura: las 18 tablas de `0001`, con `agents.id uuid`, y `0001`/`0002` en el historial de Supabase;
  - **no existe `_acc_migrations`**, la tabla del migrador de la app;
  - **Vercel todavía no tiene `DATABASE_URL`**, así que la app desplegada corre sobre PGlite **en memoria**.

---

## 2. Historia reciente (22 y 23 de septiembre de 2026)
1. **`682cec2`, "feat: finalize AI Command Center platform":** Antigravity, sesiones persistentes de proveedor, AI Office fullscreen, panel de readiness, preview en GitHub Pages y migración `0002`.
2. **`8b3fbab`, Vercel AI Gateway:** runtime HTTP con modelos `creator/model`, `AI_GATEWAY_API_KEY` y `VERCEL_AI_GATEWAY_MODEL`.
3. **`2ff4782`, migraciones en el trace de Vercel:** `outputFileTracingIncludes` con `/*` → `./supabase/migrations/**/*`. **Es un buen arreglo; se mantiene.**
4. **`72dd0bf` → `59a4885`, 7 commits directos a `main` de GPT** para el "modo smoke test":
   - PGlite `memory` en producción;
   - setup sin `SETUP_TOKEN`;
   - `SESSION_SECRET` derivado;
   - identidad del usuario en la cookie;
   - salto de la redirección a `/setup`.

---

## 3. Estado verificado (2026-09-23) y correcciones a los handoffs previos
- **PRs #1, #2 y #3:** GitHub los muestra **cerrados sin merge**, aunque su contenido está en `main` como commits (`682cec2`, `8b3fbab`, `2ff4782`). El handoff de GPT dice "merged": no es exacto.
- **🔴 La CI de `main` está roja desde el run #56 (`f18584e`) hasta HEAD `59a4885`:**
  - lint, typecheck, unit, bridge y build pasan;
  - falla el e2e `e2e/command-center.spec.ts:42` ("first-run setup creates the moderator and the team"): espera `/setup` y recibe `/login`;
  - la causa es el bypass del modo smoke en `src/app/(app)/layout.tsx`, porque la CI corre en producción sin `DATABASE_URL`;
  - los runs #51–#55 estaban verdes.
- **PR #4 (`feat/office-habbo-pixel-pass`, de GPT):** está abierto. Es cosmético, solo toca `src/components/office/scene.ts` (avatares). Tiene como base un `main` rojo. **No lo fusiones hasta cerrar el P0**; después, rebásalo o haz merge de `main` en él, revísalo y valida la AI Office con captura.
- **El handoff de GPT no menciona el hueco de seguridad (sección 4).** El token de setup que se usó en esas pruebas se compartió en chats y no protegía nada, porque el servidor aceptaba cualquier texto. Descártalo y no lo reutilices.
- **Confirmado en el código:**
  - `supabase/schema.sql` existe y lo citan `docs/DEPLOYMENT.md:17` y `docs/NEXT_STEPS.md:17`;
  - `live.tsx:95` usa `.slice(0, 80)`;
  - `AppShell.tsx:48` depende de `snap`;
  - hay `policy.decision` en `hosted.ts:176` y en `actions.ts:51`;
  - `config/agent-defaults.json` y `protocols/agent-message.schema.json` no se importan en ningún sitio;
  - no hay `package-lock.json`.
- **Ya resuelto, no rehacer:** el login **ya tiene** `autoComplete="username"` y `"current-password"`. La casilla "Recordar mi correo" **no** está implementada.

---

## 4. Problemas

### 🔴 P0: hueco de seguridad en el despliegue público (modo smoke)
En producción sin `DATABASE_URL`:
1. **Clave de sesión predecible.** `env.sessionSecret` usa `sha256("ai-center-smoke-session|" + APP_URL)` si falta `SESSION_SECRET`. La semilla es pública (el repo y la URL son públicos), así que **cualquiera puede firmar cookies**.
2. **La cookie no se valida contra la BD.** `getSessionUser` confía en el uid, el email y el role de la cookie sin consultar la BD. Una cookie falsificada da acceso de moderador (owner).
3. **Setup sin token real.** `POST /api/setup` sin `SETUP_TOKEN` acepta cualquier texto.
4. **Sin redirección ni persistencia.** `(app)/layout.tsx` se salta la redirección a `/setup`, y `pgliteDir` pasa a `memory`.

Consecuencia: cualquiera puede tomar la instancia y usar las claves que haya en Vercel (`GITHUB_TOKEN`, claves de API, AI Gateway). **Pídele al usuario que revise qué variables tiene hoy el proyecto de Vercel. Si hay claves configuradas, recomiéndale activar Deployment Protection o pausar el proyecto ya, y rotar esas claves.** Esto se corrige antes que cualquier otra cosa.

### 🔴 P0: esquema y migrador
- `supabase/schema.sql` es un esquema **antiguo e incompatible**: `agents.id text`, otras columnas de permisos y pgcrypto. Hay que borrarlo y corregir las docs que lo citan.
- Como Supabase no tiene `_acc_migrations`, al conectar Vercel el auto-migrador intentará aplicar `0001` y `0002` de nuevo. Antes de conectar:
  - demuestra con un test PGlite que ambas son idempotentes (aplicarlas dos veces sobre una BD que ya las tiene), **o**
  - implementa un *baseline* que registre como aplicadas las que ya existen.
- No borres ni recrees tablas. **No edites `0001` ni `0002`**: todo cambio de esquema va en una migración nueva e idempotente.

### 🟠 P1: bugs
- **`src/lib/client/live.tsx:95`:** `setLiveEvents((prev) => [e, ...prev].slice(0, 80))`. Los ticks de refresco que se derivan de esa lista dejan de cambiar en sesiones largas: `ConversationRoom` (statusTick), `tasks/[key]/page.tsx` (tick) y `AppShell` (gitTick). Solución: contadores monótonos por tipo de evento en el provider.
- **`src/components/AppShell.tsx:48`:** `useGithub` depende de `snap` completo y llama a `/api/github` con cada snapshot. Debe depender solo de `repo` + `gitTick`.
- **Posible `policy.decision` duplicado** en las denegaciones de `paid_api` (`hosted.ts:176` y `authorize()` en `actions.ts:51`): confírmalo con un test y deja un solo evento.

### 🟡 P2: deuda
- **Instalaciones y CI:** falta `package-lock.json` (las instalaciones no son reproducibles), la CI no sube el `playwright-report` y hay vulnerabilidades de `npm audit` sin analizar.
- **Archivos sin uso:** `config/agent-defaults.json` y `protocols/agent-message.schema.json` no se usan y son inconsistentes (id `codex` frente al slug `gpt`). Bórralos o alinéalos.
- **Docs contradictorias:**
  - `PROMPT_CLAUDE.md` menciona Supabase Realtime;
  - `WEB_SESSIONS.md` usa su propio vocabulario de estados;
  - `AGENTS.md` está duplicado en la raíz y en `docs/`;
  - las docs aún describen Gemini como API, aunque ahora es Antigravity.
- **Servidor propio:** falta `output: 'standalone'` + Dockerfile para correr fuera de Vercel (con `ACC_INPROCESS_WORKER=true`).
- **Node 20 en Actions:** `actions/checkout@v4` y `setup-node@v4` avisan de la deprecación de Node 20.

---

## 5. Plan de trabajo (en orden)

**Paso 0: contexto persistente.** Crea `CLAUDE.md` en la raíz con:
- los principios;
- el mapa del código;
- los comandos de calidad;
- las reglas de git y seguridad;
- "no editar migraciones aplicadas";
- "nada de push directo a `main`".

Crea también `docs/HANDOFF.md` con este documento resumido y el estado actual. Todo va en la rama `docs/handoff-context` con su PR.

**Paso 1: cerrar el hueco de seguridad (rama `security/remove-smoke-mode` + PR). Con esto la CI vuelve a verde.**
- `SESSION_SECRET` es obligatorio siempre (≥32 caracteres), sin fallback derivado. Si falta, el servidor da un error claro al arrancar.
- `getSessionUser` valida siempre contra la BD (`session_version`). El payload vuelve a ser solo `uid`, `v` y `exp`.
- `/api/setup` exige siempre `SETUP_TOKEN`: 503 si no existe, 403 si no coincide, con comparación en tiempo constante (`safeEqual`). Restaura el texto original de la UI de `/setup`.
- Quita el bypass de `(app)/layout.tsx`. En producción sin `DATABASE_URL`, falla de forma explícita con una página "BD no configurada".
  - Excepción: un flag opt-in explícito (p. ej. `ACC_ALLOW_EPHEMERAL_DB=true`), documentado como solo para pruebas y **sin** debilitar la autenticación.
  - La CI e2e debe seguir funcionando con su propio setup, que usa `e2e-setup-token`; revisa `playwright.config.ts` y `ci.yml`.
- Conserva los buenos arreglos:
  - `outputFileTracingIncludes`;
  - la externalización de los drivers pg;
  - los imports de builtins;
  - `createSession` con el usuario leído de la BD.
- Tests:
  - una cookie forjada con la clave derivada → 401 o redirección;
  - setup sin token → 503;
  - setup con token incorrecto → 403;
  - el e2e de primer arranque vuelve a pasar.
- Avisa al usuario de que, al desplegar esto, la instancia actual deja de funcionar hasta que configure las variables. Es lo esperado.

**Paso 2: esquema y docs de despliegue.**
- Borra `supabase/schema.sql` y corrige `DEPLOYMENT.md` y `NEXT_STEPS.md`: las migraciones se aplican solas o con `npm run db:migrate`.
- Resuelve la idempotencia o el baseline de las migraciones (sección 4).
- Si aparece algo del esquema viejo en Supabase, propón un plan de limpieza y **pide aprobación antes de ejecutar nada destructivo**.

**Paso 3: conectar Vercel ↔ Supabase.** Lo hace el usuario; tú le das los pasos exactos.
- Variables obligatorias:
  - `DATABASE_URL` (transaction pooler, puerto 6543) y `DATABASE_POOL_MAX=1`;
  - `SESSION_SECRET` (`openssl rand -hex 32`) y `SETUP_TOKEN` (aleatorio, nuevo);
  - `APP_URL` y `CRON_SECRET`.
- Variables opcionales: `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `AI_GATEWAY_API_KEY`, `VERCEL_AI_GATEWAY_MODEL` y las `*_API_KEY` que se usen.
- Luego: redeploy → `/setup` → login → dashboard → Office → DEMO. En DEMO, una tarea asignada a Claude debe recorrer: implementa → revisión → cambios → aprobado → push pendiente de aprobación. Verifícalo con Playwright contra la URL real si es posible.

**Paso 4: bugs P1**, con tests.

**Paso 5: PR #4.** Actualízalo con `main` en verde, revísalo y valida la AI Office con captura.

**Paso 6: higiene.**
- `package-lock.json` y `npm ci` en la CI;
- subir el reporte de Playwright como artefacto;
- `npm audit`;
- archivos de config sin uso;
- unificar docs (Gemini = Antigravity, sin Realtime, un solo AGENTS.md);
- actualizar las actions a versiones con Node 24.

**Paso 7: servidor propio.** `output: 'standalone'`, `Dockerfile` multi-stage, `docker-compose.yml` opcional con Postgres y su sección en SETUP.md.

**Paso 8: agentes reales.** Guía y prueba de conexión del bridge con Claude Code, Codex y Antigravity contra el despliegue real:
- tokens emitidos desde la UI;
- un `git worktree` por agente;
- ramas protegidas y pre-push guard.

**Paso 9: auditoría final.**
- Capturas en desktop, tablet y móvil de: dashboard, sala, tareas, aprobaciones, agentes, ajustes y Office.
- Revisión de seguridad: CSP, CSRF, rate limit y headers.
- Actualizar `docs/NEXT_STEPS.md`.

Al terminar cada paso: lint, typecheck, tests, build y e2e en verde, y un PR con un resumen claro. Si el paso toca variables o acciones en Vercel o Supabase, incluye instrucciones concretas para el usuario.

## 6. Qué NO hacer
- No reviertas las correcciones de build y tracing de Vercel.
- No vuelvas a PGlite en disco (`.data`) en Vercel.
- No dejes ningún fallback de `SESSION_SECRET` ni de `SETUP_TOKEN` en producción, ni sesiones que confíen en datos de la cookie sin consultar la BD.
- No edites `0001_init.sql` ni `0002` (ya aplicadas).
- No uses Supabase Realtime, no dejes que los agentes se llamen directamente y no te saltes el Policy Engine.
- No hagas force push, no borres ramas y no hagas push a `main` sin PR.
- No guardes contraseñas en localStorage ni secretos en el repo.

**Empieza por el Paso 0 y el Paso 1.** Antes de tocar código, confirma que el problema sigue presente en `main` leyendo `src/server/env.ts`, `src/server/auth/session.ts`, `src/app/api/setup/route.ts` y `src/app/(app)/layout.tsx`.
