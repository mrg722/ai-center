# Setup

## Requisitos

- Node.js 20+ (22 recomendado) y git.
- Para agentes locales: Claude Code CLI y/o Codex CLI instalados y con sesión iniciada en tu máquina.

## 1. Local

```bash
npm install
npm run setup:env        # .env.local con SESSION_SECRET, SETUP_TOKEN y CRON_SECRET aleatorios
npm run dev
```

Sin `DATABASE_URL`, los datos van a un Postgres embebido (PGlite) en `.data/pglite`. Las migraciones se aplican solas.

Abre http://localhost:3000 → `/setup` → introduce el SETUP_TOKEN que imprimió el script → crea tu usuario y el proyecto. Se crean Claude (builder, bridge), GPT/Codex (auditor, bridge) y Gemini (investigador, API) con sus permisos por defecto.

**Primer recorrido sin conectar nada:** selecciona el modo **Demo** en la barra superior, crea una tarea asignada a Claude y observa el flujo completo simulado (implementa → revisión → cambios → aprobado → push pendiente de tu aprobación) en la sala y en la AI Office.

## 2. Supabase (base de datos de producción)

1. Crea un proyecto en Supabase.
2. **Project Settings → Database → Connection string (URI)**:
   - servidor de larga duración: conexión directa (puerto 5432);
   - Vercel / serverless: *transaction pooler* (puerto 6543) y `DATABASE_POOL_MAX=1`.
3. Pon la URI en `DATABASE_URL`. Las migraciones se aplican solas al arrancar (o `npm run db:migrate`, o `supabase db push` con `supabase/migrations/`).
4. Todas las tablas tienen **RLS activado sin políticas**: la API REST de Supabase con la anon key no puede leer nada. El servidor usa la conexión directa. No expongas la anon key: la app no la necesita.
5. No se usa Supabase Realtime (ver ADR-03): el tiempo real va por SSE desde el orquestador.

## 3. GitHub

- `GITHUB_TOKEN`: *fine-grained PAT* del repositorio con **Contents: read**, **Pull requests: read/write**, **Metadata: read** (+ Issues: read; **Actions: read/write** si usarás deploy). Solo lo usa el servidor.
- Configura el repo en **Ajustes → Proyecto** (`owner/name`).
- Webhook (opcional, para ver pushes/PRs al instante): *Settings → Webhooks* → `https://TU-APP/api/webhooks/github`, content type `application/json`, secreto = `GITHUB_WEBHOOK_SECRET`, eventos push / pull_request / issues.
- **Protege tu rama principal** (branch protection: PR obligatorio, sin force-push). Es la barrera real; la app añade las suyas encima.
- Los *push* los ejecuta el bridge con las credenciales git de tu máquina (no con `GITHUB_TOKEN`).

## 4. Despliegue en Vercel

1. Importa el repo en Vercel (framework Next.js).
2. Variables: `DATABASE_URL` (pooler), `DATABASE_POOL_MAX=1`, `SESSION_SECRET`, `SETUP_TOKEN`, `CRON_SECRET`, `APP_URL`, y las claves que uses (`GEMINI_API_KEY`, `GITHUB_TOKEN`…).
3. `vercel.json` programa `/api/cron/tick` una vez al día (compatible con el plan Hobby). En Pro puedes subirlo a cada 5–10 min; no es imprescindible: los agentes por API se ejecutan en `after()` de cada petición.
4. SSE: las funciones reconectan cada ~4 min de forma transparente (el navegador reanuda por `Last-Event-ID`).
5. Tras el primer despliegue entra en `/setup`. Después puedes quitar `SETUP_TOKEN`.

Servidor propio (Docker, VM): `npm run build && npm start` con `ACC_INPROCESS_WORKER=true` para ejecutar la cola en proceso.

## 5. Conectar agentes

Ver [AGENTS.md](AGENTS.md).
