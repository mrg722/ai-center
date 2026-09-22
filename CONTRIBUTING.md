# Contribuir

## Principios

1. **Una sola fuente de verdad.** `AgentState` lo calcula `deriveStatus()`; `SystemState`, `systemState()`. Las vistas renderizan, no deciden.
2. **Toda acción sensible pasa por `authorize()` / `decide()`** antes de ejecutarse. Nunca añadas un atajo que ejecute git, llame a una API de pago o entregue trabajo sin pasar por la política.
3. **Sin nombres de proveedor en el núcleo.** Nada de `if (agent.slug === 'claude')`. Ramifica por `transport` o por capacidades del registro.
4. **Nada simulado fuera del modo DEMO.** Si una integración no está configurada, se muestra como no configurada.
5. **Secretos solo en el servidor** (`src/server/env.ts`). Nunca `NEXT_PUBLIC_*` para claves.

## Estructura

Ver `docs/ARCHITECTURE.md § 7`. Los endpoints en `src/app/api` son finos: validan con zod (`src/server/validation.ts`) y delegan en `src/server/orchestrator`.

## Calidad

```bash
npm run lint
npm run typecheck
npm test               # vitest: unidad + integración con Postgres embebido
npm run test:bridge    # node:test: git real, MCP stdio
npm run build
npm run test:e2e       # Playwright + bridge real (runner echo)
```

Un cambio no está terminado si el build falla. Cambios de esquema: nueva migración `supabase/migrations/NNNN_descripcion.sql` idempotente (no edites migraciones ya desplegadas).

## Git

- Ramas por tarea: `acc-123-descripcion-corta`.
- Commits claros (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`), referencia a la tarea si existe.
- Nunca `push --force`, nunca borrar ramas ajenas, PR hacia la rama principal protegida.
