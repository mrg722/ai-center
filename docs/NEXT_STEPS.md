# Próximos pasos

## GitHub

El repositorio de la plataforma ya existe como `mrg722/ai-center`. Este repositorio será la fuente de verdad de la aplicación.

Desde la raíz del repositorio local:

```bash
git remote add origin https://github.com/mrg722/ai-center.git
git push -u origin main
```

## Supabase

1. Crear un proyecto Free.
2. Ejecutar `supabase/schema.sql` en el editor SQL.
3. Configurar las variables de PostgreSQL/Auth según `docs/ENVIRONMENT.md`. El navegador recibe eventos por SSE; no se requiere Supabase Realtime.

## Vercel

Importar el repositorio de GitHub como un proyecto nuevo de Vercel y configurar las variables de entorno de `.env.example`.

## Agentes locales

Instalar Agent Bridge después de que la aplicación cloud pueda autenticar y emitir una tarea de prueba. Después conectar Claude Code y Codex localmente.

## MCP

Configurar los servidores MCP disponibles (Playwright, Firecrawl, Perplexity y herramientas futuras) mediante el entorno de agentes. La aplicación debe representar honestamente las herramientas no disponibles en vez de fingir que están conectadas.
