# AI Command Center

Centro de mando multiagente. Claude, GPT/Codex, Gemini y cualquier otra IA
trabajan sobre el mismo proyecto, **se comunican solo a través de un
orquestador** y tú, como moderador, lo ves y controlas todo desde una página.

```
TÚ ──► tarea ──► ORQUESTADOR ──► Claude (bridge local)  implementa, pide revisión
                    │   ▲        GPT/Codex (bridge local) audita, corrige, push/PR
                    │   └──────  Gemini (API)            segunda opinión
                    ▼
        Command Center · AI Office · aprobaciones · STOP ALL
```

## Qué incluye

- **Command Center**: agentes con estado real, tareas, sala de conversación en tiempo real, aprobaciones, actividad, estado de GitHub, modo de operación y **DETENER TODO**.
- **AI Office**: oficina pixel art top-down (canvas procedural, sin imágenes) con zoom/pan/pinch, selección de agente y panel de detalle. Representa el `AgentState` real: nunca inventa actividad.
- **Orquestador**: motor de tareas, router de mensajes con cola de entregas, **Policy Engine** (permisos, modos, aprobaciones, límite de saltos IA→IA, presupuesto de APIs de pago), Context Manager con presupuesto y memoria por capas.
- **Agent Bridge** (`bridge/`, sin dependencias): worker local para Claude Code, Codex CLI o cualquier CLI + servidor **MCP `acc`** para que los agentes hablen con el orquestador. Git lo ejecuta el bridge tras la decisión del orquestador (sin `--force`, ramas protegidas).
- **Runtimes** intercambiables: Claude Code, Codex, Anthropic API, OpenAI API, Gemini, Perplexity, OpenRouter, DeepSeek, Mistral, Qwen, Ollama, LM Studio, OpenAI-compatible, HTTP genérico, MCP genérico — y un **simulador** para el modo DEMO.
- **Modos**: Demo (simulado) · Moderado · Supervisado · Autónomo.
- Seguridad: secretos solo en el servidor, tokens de agente hasheados, CSRF, CSP, rate limiting, validación estricta, webhook firmado, defensa contra prompt injection.

## Arranque rápido (local, sin instalar base de datos)

```bash
npm install
npm run setup:env          # crea .env.local con secretos aleatorios y te muestra el SETUP_TOKEN
npm run dev                # http://localhost:3000 → /setup
npm run bridge:build       # compila el Agent Bridge
```

1. En `/setup` crea tu usuario moderador y el proyecto (usa el SETUP_TOKEN).
2. Cambia a modo **Demo** para ver el flujo completo con agentes simulados.
3. Para agentes reales: **Agentes → Emitir token del bridge** y arranca el bridge en tu repo (ver [docs/AGENTS.md](docs/AGENTS.md)).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | arquitectura, ADRs, flujo, modos, memoria, seguridad |
| [docs/SETUP.md](docs/SETUP.md) | ejecutar, desplegar en Vercel, Supabase, GitHub |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | todas las variables de entorno |
| [docs/AGENTS.md](docs/AGENTS.md) | conectar agentes y workers locales, MCP, añadir una IA nueva |
| [CONTRIBUTING.md](CONTRIBUTING.md) | convenciones, pruebas, flujo git |

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` · `typecheck` | calidad |
| `npm test` | unitarias + integración (Postgres embebido real) |
| `npm run test:bridge` | pruebas del Agent Bridge (git real en repos temporales, MCP stdio) |
| `npm run test:e2e` | Playwright contra el servidor real + un bridge real |
| `npm run db:migrate` | aplica migraciones a `DATABASE_URL` |
| `npm run bridge:build` | compila `bridge/` |
