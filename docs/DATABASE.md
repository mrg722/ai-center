# Base de datos

## Supabase/PostgreSQL

La base de datos almacena el estado operativo, no el repositorio entero.

### Tablas iniciales

- `users`
- `projects`
- `agents`
- `agent_capabilities`
- `agent_sessions`
- `tasks`
- `task_steps`
- `messages`
- `conversations`
- `approvals`
- `permissions`
- `events`
- `agent_runs`
- `project_context`
- `decisions`
- `reviews`
- `git_refs`

## Persistencia por capas

### Permanente
Decisiones, reglas, documentación, resúmenes y resultados importantes.

### De tarea
Objetivo, mensajes, archivos, cambios, revisiones y commits asociados.

### De sesión
Presencia, heartbeat, streaming y actividad temporal.

## Reglas de capacidad

No guardar sprites, vídeos, builds ni ZIPs en PostgreSQL. Usar GitHub/Storage según corresponda.
