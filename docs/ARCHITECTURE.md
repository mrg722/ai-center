# Arquitectura

## Capas

1. **Frontend** — Next.js/React/TypeScript. Dashboard, chat, tareas, agentes, GitHub, configuración y AI Office.
2. **Orquestador** — autoridad central para tareas, handoffs, permisos, contexto, aprobaciones, reintentos y estado.
3. **Persistencia** — Supabase/PostgreSQL para el estado operativo; Realtime para eventos en vivo.
4. **Fuente del proyecto** — GitHub como fuente de verdad del código.
5. **Agent Bridge** — trabajador local que conecta la nube con Claude Code, Codex y futuras IAs locales.
6. **Adaptadores de proveedores** — abstracciones desacopladas por proveedor.
7. **Herramientas MCP** — herramientas externas; el núcleo no debe depender de una sola herramienta.

## Regla de comunicación

Los agentes nunca se llaman directamente entre sí.

```text
Agente A -> Orquestador -> Agente B
```

El orquestador valida identidad, tarea, permisos, contexto y destino antes de entregar el mensaje.

## Flujo de una tarea

```text
USUARIO
  -> CREAR TAREA
  -> CLAUDE: PLANIFICAR/IMPLEMENTAR
  -> CLAUDE: SOLICITAR REVISIÓN
  -> CODEX: AUDITAR/CORREGIR
  -> GEMINI: SEGUNDA OPINIÓN OPCIONAL
  -> CODEX: VERIFICAR
  -> APROBACIÓN HUMANA
  -> COMMIT/PUSH
  -> GITHUB
```

## Modos

### Moderado
Las IAs pueden analizar y conversar. Los cambios sensibles requieren aprobación.

### Supervisado
Los handoffs pueden continuar automáticamente, con visibilidad completa para el usuario.

### Autónomo
Los agentes ejecutan una cadena dentro de permisos previamente definidos. Debe existir `STOP ALL`.

## No guardar secretos en el frontend

Todas las credenciales deben permanecer en variables de entorno/secret manager del backend o en el entorno local del agente.
