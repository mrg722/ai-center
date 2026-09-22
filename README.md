# AI Command Center

Centro de mando multiagente para coordinar Claude, GPT/Codex, Gemini y futuros agentes cloud, locales o basados en sesiones web desde una sola interfaz.

## Objetivo

Construir una plataforma real donde el usuario actúe como moderador y pueda crear tareas, observar conversaciones agente↔agente, intervenir, aprobar acciones y seguir cambios de GitHub.

El sistema debe soportar tres formas de ejecutar un agente:

1. **API/Cloud** — la aplicación llama a una API oficial.
2. **Local/CLI** — el agente corre en la máquina del usuario, por ejemplo Claude Code, Codex o Antigravity CLI.
3. **Sesión Web** — un puente local controla un navegador ya autenticado mediante automatización del navegador cuando sea técnicamente y contractualmente apropiado.

Las sesiones web no deben considerarse el mecanismo central de integración: son un modo opcional y más frágil que los SDK/APIs oficiales.

## Arquitectura

```text
WEB (Next.js)
    |
    v
ORQUESTADOR
    |
    +--> Supabase/PostgreSQL + Realtime
    |
    +--> GitHub
    |
    +--> Agent Bridge local
    |       +--> Claude Code
    |       +--> Codex
    |       +--> Antigravity CLI
    |       +--> IAs locales
    |       +--> Sesiones Web (opcional)
    |
    +--> Proveedores/API
            +--> OpenAI
            +--> Anthropic
            +--> Gemini
            +--> Perplexity
            +--> otros
    |
    +--> MCP
            +--> Playwright
            +--> Firecrawl
            +--> Perplexity
            +--> futuros
```

## Reparto inicial

| Agente | Rol | Leer | Escribir | Commit | Push | Merge |
|---|---|---:|---:|---:|---:|---:|
| Claude | Constructor principal | ✅ | ✅ | ✅ | ❌ | ❌ |
| GPT/Codex | Auditor + Integrador | ✅ | ✅ | ✅ | ✅* | ❌ |
| Gemini | Investigación + Segunda opinión | ✅ | ❌ | ❌ | ❌ | ❌ |

`*` El push debe seguir la política de aprobación configurada por el usuario.

## Fuentes de verdad

- **GitHub:** código, assets, documentación, branches, commits y PRs.
- **Supabase:** tareas, mensajes, sesiones, permisos, eventos, contexto operativo y presencia.
- **Agent Bridge:** ejecución local y acceso controlado al workspace.
- **Proveedores externos:** respuestas de modelos y herramientas, nunca la fuente de verdad del proyecto.

## Modos de interacción

### Panel unificado

La web muestra a todos los agentes, su estado, conversación, tareas y actividad.

### API/Cloud

Ideal cuando se requiere ejecución completamente remota y programática. Requiere las credenciales y facturación del proveedor correspondiente.

### Local/CLI

Ideal para aprovechar entornos locales y suscripciones compatibles. Claude Code, Codex y Antigravity CLI pueden ejecutarse en el ordenador y reportar eventos al Command Center.

### Sesión Web

Permite, cuando sea apropiado, abrir/controlar una sesión autenticada de ChatGPT, Claude o Gemini mediante el navegador local. No se deben almacenar contraseñas ni tokens de sesión en el servidor. La sesión permanece en el entorno del usuario y el puente solo transmite tareas/eventos.

## Documentación

- `docs/ARCHITECTURE.md`
- `docs/ORCHESTRATOR.md`
- `docs/AGENT_PROTOCOL.md`
- `docs/AGENT_BRIDGE.md`
- `docs/WEB_SESSIONS.md`
- `docs/DATABASE.md`
- `docs/OFFICE.md`
- `docs/MCP.md`
- `docs/SECURITY.md`
- `docs/DEPLOYMENT.md`
- `docs/NEXT_STEPS.md`
- `docs/PROMPT_CLAUDE.md`
- `docs/PROMPT_CODEX.md`

## Principio

La aplicación no debe fingir que un agente está conectado. Si un agente está offline, se muestra offline. Si una acción requiere aprobación, se muestra. Si un proveedor no está configurado, aparece como no disponible.

No acoplar el núcleo a Claude, OpenAI, Gemini ni a ningún proveedor único.
