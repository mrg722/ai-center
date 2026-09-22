# Despliegue

## Infraestructura objetivo

- Frontend/backend web: Vercel + Next.js.
- Base de datos y PostgreSQL gestionado: Supabase. Tiempo real hacia el navegador: SSE del backend.
- Código del proyecto: GitHub.
- Agentes locales: Agent Bridge en la máquina del usuario.

## Variables de entorno

Usar `.env.example` como referencia. Nunca subir `.env.local` ni secretos.

## Orden de despliegue

1. Crear proyecto Supabase.
2. Ejecutar `supabase/schema.sql`.
3. Usar el repositorio GitHub del Command Center.
4. Desplegar la aplicación en Vercel.
5. Configurar las variables de entorno en Vercel.
6. Crear el usuario administrador inicial.
7. Instalar Agent Bridge local.
8. Registrar Claude, Codex y Gemini.
9. Activar los MCP disponibles.
10. Probar el flujo tarea -> handoff -> revisión -> aprobación -> GitHub.
