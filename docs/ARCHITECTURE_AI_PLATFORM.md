# AI Platform — mapa técnico (Agent/Skill Registry, Memory, Knowledge, Model Router, Strix)

> Complemento corto a `docs/ARCHITECTURE.md`. No repite lo que ya está documentado allí;
> solo mapea qué se reutiliza y qué se añade para agents/skills/memory/knowledge/Strix.

## 0. Qué ya existe (reutilizar, no rehacer)

| Necesidad del prompt | Ya implementado como | Dónde |
|---|---|---|
| Model Adapter / Model Router | Registro de runtimes (`Runtime`/`RuntimeDescriptor`): provider, runtime, transport, capabilities, api key env, base URL allowlist | `src/server/providers/registry.ts`, `adapters.ts`, `types.ts` |
| Agent (instancia ejecutable) | Tabla `agents` (project-scoped): slug, runtime, transport, model, role, config, permisos | `supabase/migrations/0001_init.sql`, `src/server/orchestrator/repo.ts` |
| Permisos por agente/acción | Tabla `permissions` (base + temporales, con expiración) + `policy.ts` (Policy Engine) | `0001_init.sql`, `orchestrator/policy.ts` |
| Memoria de proyecto (hechos, decisiones, arquitectura) | Tablas `project_context` (kind: rule/architecture/documentation/glossary/note/result) y `decisions` | `0001_init.sql`, usadas por `orchestrator/context.ts` |
| Context Engine (selección + budget) | `buildContext()` + `renderContext()` — arma system prompt con roster, tarea, historial resumido, `project_context`, `decisions`, revisiones, presupuesto de caracteres | `orchestrator/context.ts`, `context-render.ts` |
| Bridge autenticado Vercel → máquina local | Protocolo `hello/heartbeat/inbox/command-result` con Bearer token por agente; runners `claude-code`, `codex`, `antigravity`, `command` | `orchestrator/bridge.ts`, `bridge/src/*`, `docs/AGENT_BRIDGE.md` |
| Ollama/local models sin exponer secretos | `trustedBaseUrl()` bloquea `ollama`/`lmstudio` en producción (Vercel); solo corren vía runner `command` del bridge o loopback explícito en dev | `providers/registry.ts` |
| Auditoría / eventos | Tabla `events` (append-only) + bus (`events/bus.ts`) | ya cubre Fase 25 (Observability) en su mayoría |
| Runbook self-hosted de seguridad de la propia app | `docs/SECURITY.md`, `tests/security.test.ts` | base para el Security Test Runner |

**Conclusión:** el Model Router, el Bridge y buena parte de "memoria de proyecto" del prompt original
**ya existen**. Las Fases 4, 5, 8 (Ollama, Model Adapter/Router, Bridge) del prompt maestro son mayormente
trabajo de **extensión**, no de creación. Lo que falta de verdad: **Agent Registry como catálogo
reutilizable** (hoy `agents` es una instancia por proyecto, no una plantilla de identidad/misión
importable), **Skill Registry**, **Memory Store granular por tipo** (hoy es un cajón `project_context`
sin `scope`/`type`/`importance`), **Knowledge Store con chunking/embeddings**, y **Strix/Security Lab**.

## 1. Agent Registry (catálogo) vs. `agents` (instancia)

No se reemplaza `agents`. Se añade una capa de **plantillas** encima:

```
agent_definitions (catálogo, global, versionado, con origen)
        │ agent_definition_skills (N:M)
        ▼
skill_definitions (catálogo, global)

agents.agent_definition_id  →  opcional, referencia a la plantilla que le dio
                                identidad/misión/instrucciones/skills.
agents.runtime/model/config →  sigue decidiendo el Model Router (sin cambios).
```

Un `agent_definition` importado de Agency Agents (o creado a mano) NO es el agente final.
El agente final = `agent_definitions` (identidad + misión + skills) + `skills` seleccionadas +
memoria + `agents.runtime`/`model` (Model Router). Esto es exactamente el patrón
`Security Engineer + api-security skill + owasp skill + memory + modelo` del prompt.

## 2. Import / Sync de Agency Agents

Fuente: `https://github.com/msitarzewski/agency-agents` (MIT). No se vendoriza el repo completo
dentro de AI Center: el importador (`src/server/registry/import-agency.ts` +
`scripts/import-agency-agents.mjs`) lee un checkout local (clonado aparte, fuera del repo) y
normaliza cada `division/slug.md` (frontmatter YAML + secciones Markdown) a `AgentDefinition`.
Cada fila guarda `source`, `source_repo`, `source_path`, `source_version` (commit corto) y
`source_hash` (sha256 del archivo) para poder diffear versiones futuras sin pisar
personalizaciones locales (`customized = true` se respeta y no se sobrescribe en un re-import).

## 3. Memory vs. Knowledge (bloques 5/6, siguientes)

- **Memory** (bloque 5): nueva tabla `memories` con `scope` (global/project/agent/task/conversation),
  `type` (episodic/semantic/project/decision/preference/fact/lesson/security_finding/task_state),
  extracción explícita (no cada mensaje). Vive junto a `project_context`/`decisions` (no las
  duplica: `decisions` sigue siendo la fuente de decisiones formales; `memories` cubre lo demás).
- **Knowledge** (bloque 6): tabla `knowledge_documents` con chunking + `embedding` opcional +
  `embedding_model`, retrieval con fallback estructurado/texto cuando no hay embeddings.

## 4. Strix (bloque 9, más adelante)

Se integra como un `bridgeRunner` adicional en `bridge/src/runners/` (patrón idéntico a
`claude-code.ts`/`codex.ts`), invocado únicamente vía Local Bridge, nunca desde Vercel. Un
`StrixRuntime` adapter en el orquestador traduce una tarea de seguridad en comandos controlados
(start/status/output/findings/stop) con `TEST_TARGET_ALLOWLIST`.

## 5. Orden de trabajo real (difiere del prompt maestro donde ya hay reuso)

1. ✅ Bloque 0 — este documento.
2. Bloque 1 — Agent Registry (`agent_definitions`, sin tocar `agents`).
3. Bloque 2 — Skill Registry (`skill_definitions`, `agent_definition_skills`).
4. Bloque 3 — Importador Agency Agents (usa 1+2).
5. Bloque 4 — lint/typecheck/test/build.
6. Bloques 5+ — Memory, Knowledge, Strix, Security Lab, Findings, UI (según prompt maestro,
   reusando lo listado en la sección 0).
