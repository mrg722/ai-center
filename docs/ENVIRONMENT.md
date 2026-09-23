# Variables de entorno

Todas son **solo de servidor**. Ninguna usa el prefijo `NEXT_PUBLIC_`, así que nunca llegan al navegador; `src/server/env.ts` está marcado `server-only` (importarlo desde un componente cliente rompe el build). Nunca las subas a git (`.env*` está en `.gitignore`).

## Núcleo

| Variable | Obligatoria | Descripción |
|---|---|---|
| `SESSION_SECRET` | sí | ≥32 caracteres aleatorios. Firma las cookies de sesión. Cambiarla cierra todas las sesiones. |
| `SETUP_TOKEN` | primer arranque | Necesario en `/setup` para crear el primer moderador. Puedes quitarlo después. |
| `APP_URL` | recomendado | URL pública (se muestra en las instrucciones del bridge). |
| `DATABASE_URL` | producción | Postgres/Supabase. Vacío → PGlite embebido. |
| `DATABASE_POOL_MAX` | no | Conexiones del pool (5; usa 1 en serverless con pooler). |
| `PGLITE_DIR` | no | Carpeta de PGlite (`.data/pglite`; `memory` = en memoria). |
| `ACC_AUTO_MIGRATE` | no | `false` para no migrar al arrancar. |
| `CRON_SECRET` | recomendado | Protege `/api/cron/tick` (Vercel Cron lo envía como Bearer). |
| `ACC_INPROCESS_WORKER` | no | Worker en proceso para runtimes del orquestador y el *presence sweeper* (por defecto `true` en dev, `false` en prod). |
| `CONTEXT_BUDGET_CHARS` | no | Presupuesto de contexto por ejecución (24000). |
| `ACC_SIM_DELAY_FACTOR` | no | Velocidad del simulador DEMO (1 = normal, 0 = instantáneo). |
| `ACC_ALLOWED_CUSTOM_HOSTS` | no | Lista separada por comas de hosts HTTPS exactos permitidos para runtimes HTTP/MCP personalizados. Nunca contiene secretos. |

## GitHub

| Variable | Descripción |
|---|---|
| `GITHUB_TOKEN` | PAT fine-grained (ver SETUP). Estado del repo, PRs, merge y deploy aprobados. |
| `GITHUB_WEBHOOK_SECRET` | Secreto HMAC del webhook. |

## Runtimes por API (solo los que uses)

`AI_GATEWAY_API_KEY` habilita el runtime **Vercel AI Gateway**. El agente puede usar cualquier modelo del catálogo de Gateway indicando su identificador `creator/model` (por ejemplo `openai/gpt-5.6-luna`). `VERCEL_AI_GATEWAY_MODEL` puede definir el modelo por defecto. Gateway es de pago según el uso del modelo; el presupuesto diario del proyecto sigue aplicándose antes de cada llamada.

| Variable | Runtime | Modelo por defecto (`*_MODEL`) |
|---|---|---|
| `GEMINI_API_KEY` | Gemini | `GEMINI_MODEL` (por defecto `gemini-3.8-flash`) |
| `OPENAI_API_KEY` | OpenAI API | `OPENAI_MODEL` |
| `ANTHROPIC_API_KEY` | Anthropic API | `ANTHROPIC_MODEL` |
| `PERPLEXITY_API_KEY` | Perplexity | `PERPLEXITY_MODEL` (`sonar-pro`) |
| `OPENROUTER_API_KEY` | OpenRouter | `OPENROUTER_MODEL` |
| `DEEPSEEK_API_KEY` | DeepSeek | `DEEPSEEK_MODEL` (`deepseek-chat`) |
| `MISTRAL_API_KEY` | Mistral | `MISTRAL_MODEL` |
| `DASHSCOPE_API_KEY` | Qwen (DashScope) | `QWEN_MODEL` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | `VERCEL_AI_GATEWAY_MODEL` (`openai/gpt-5.6-luna`) |
| — | Ollama / LM Studio | `OLLAMA_MODEL` / `LMSTUDIO_MODEL` (sin clave) |

Los runtimes integrados ya no pueden elegir otra variable de secreto desde la base de datos: cada proveedor usa exclusivamente su propia variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.). Los hosts de proveedores integrados están fijados a una lista de orígenes HTTPS confiables. Los runtimes HTTP/MCP personalizados no reciben ninguna API key del servidor y solo funcionan contra hosts HTTPS explícitamente incluidos en `ACC_ALLOWED_CUSTOM_HOSTS`.

## En tu máquina (Agent Bridge)

| Variable | Descripción |
|---|---|
| `ACC_URL` | URL del orquestador (https obligatorio salvo localhost). |
| `ACC_AGENT_TOKEN` / `ACC_AGENT_TOKEN_FILE` | Token del agente (mejor en archivo con permisos 600). |
| `ACC_RUNNER` | `claude-code` · `codex` · `command` · `echo` (arnés de pruebas). |
| `ACC_WORKSPACE` | Repositorio donde trabaja el agente (idealmente un `git worktree` propio). |
| `ACC_RUNNER_BIN`, `ACC_RUNNER_ARGS` | Ruta del CLI y argumentos extra. |
| `ACC_COMMAND` | Para `runner=command`, p. ej. `ollama run qwen2.5-coder`. |
| `ACC_PROTECTED_BRANCHES` | Ramas a las que el bridge nunca hace push (`main master`). |
| `ACC_INSTALL_PUSH_GUARD` | `true` instala un hook `pre-push` (no sobrescribe hooks existentes). |
| `ACC_MAX_RUN_SECONDS` | Tiempo máximo por ejecución (1800). |
| `FIRECRAWL_API_KEY`, `PERPLEXITY_API_KEY` | Solo si habilitas esos servidores MCP; se leen de TU entorno, nunca pasan por el servidor. |
