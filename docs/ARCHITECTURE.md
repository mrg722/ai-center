# Arquitectura

## Principio general

El AI Command Center es una aplicación de coordinación. La interfaz que tú ves es una capa central; los agentes pueden ejecutarse en la nube, como procesos locales o mediante sesiones web locales.

## Capas

1. **Frontend** — Next.js/React/TypeScript. Dashboard, chat, tareas, agentes, GitHub, configuración y AI Office.
2. **Orquestador** — autoridad central para tareas, handoffs, permisos, contexto, aprobaciones, reintentos y estado.
3. **Persistencia** — Supabase/PostgreSQL para estado operativo y Realtime para eventos en vivo.
4. **Fuente del proyecto** — GitHub como fuente de verdad del código.
5. **Agent Bridge** — trabajador local que conecta la nube con agentes y herramientas locales.
6. **Adaptadores de proveedores** — abstraen OpenAI, Anthropic, Google, Perplexity y otros.
7. **Sesiones web** — modo opcional para controlar, desde el equipo del usuario, sesiones autenticadas de aplicaciones web mediante automatización del navegador.

## Modos de agente

### API/Cloud
El orquestador llama a una API oficial del proveedor.

### Local/CLI
El Agent Bridge ejecuta el programa local del agente, por ejemplo Claude Code, Codex o Antigravity CLI.

### Sesión Web
El Agent Bridge controla una sesión del navegador local cuando se necesite utilizar la experiencia web del proveedor y la automatización sea compatible. Las credenciales permanecen locales.

## Comunicación

Los agentes nunca se llaman directamente entre sí.

```text
Agente A -> Orquestador -> Agente B
```

El orquestador valida identidad, tarea, permisos, contexto y destino.

## Flujo de trabajo

```text
USUARIO
  -> CREA TAREA
  -> CLAUDE: PLANIFICA / IMPLEMENTA
  -> CLAUDE: SOLICITA REVISIÓN
  -> CODEX: AUDITA / CORRIGE
  -> GEMINI: SEGUNDA OPINIÓN OPCIONAL
  -> CODEX: VERIFICA
  -> APROBACIÓN HUMANA
  -> COMMIT / PUSH
  -> GITHUB
```

## Centro de mando

La web debe mostrar en un mismo lugar:

- estado de los agentes;
- conversaciones;
- tareas;
- handoffs;
- aprobaciones;
- GitHub;
- actividad;
- conexión local;
- disponibilidad de herramientas.

## AI Office

La AI Office es una visualización top-down pixel art del estado real de cada agente. No debe inventar actividad: sus animaciones deben derivarse de los eventos y estados del orquestador.

## Regla de infraestructura

GitHub no es el servidor de la aplicación. GitHub almacena el código y el historial.

La aplicación web debe alojarse en un servicio de ejecución web. La arquitectura inicial recomendada es:

```text
GitHub -> código
Vercel -> aplicación web
Supabase -> base de datos + Realtime
Agent Bridge -> agentes locales / sesiones web
```

Si el orquestador requiere procesos persistentes o workers incompatibles con la plataforma web elegida, se debe separar el frontend del backend/worker y desplegar este último en un servicio de ejecución adecuado.

## Seguridad

No exponer credenciales del proveedor al navegador. No almacenar contraseñas o cookies de sesiones web. Mantener aprobaciones humanas para operaciones sensibles.
