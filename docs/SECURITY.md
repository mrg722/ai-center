# Seguridad

## Nunca exponer en el frontend

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `PERPLEXITY_API_KEY`
- `FIRECRAWL_API_KEY`
- `GITHUB_TOKEN`

## Controles

- autenticación;
- autorización por proyecto;
- RLS en Supabase;
- permisos por agente;
- aprobación humana para acciones sensibles;
- rate limiting;
- validación de entradas;
- protección de webhooks;
- logs de auditoría;
- aislamiento del Agent Bridge;
- defensa contra prompt injection;
- nunca ejecutar comandos provenientes de texto remoto sin política explícita.

## Push/Merge

Push puede estar habilitado para Codex, pero debe estar sometido a reglas de aprobación. Merge permanece bloqueado por defecto.
