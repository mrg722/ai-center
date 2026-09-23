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


## Producción: secretos y egress

- El repositorio puede ser público: secretos, contraseñas, tokens, sesiones y `DATABASE_URL` no se almacenan en Git.
- `.env*`, tokens del bridge, `.data/`, builds y logs están excluidos mediante `.gitignore`.
- En producción son obligatorios `DATABASE_URL`, `SESSION_SECRET` y `APP_URL`; no existen fallbacks de memoria ni secretos deterministas.
- `SETUP_TOKEN` es obligatorio para habilitar el primer setup en producción.
- Las API keys de proveedores se leen exclusivamente desde el servidor.
- El runtime guard fija la API key de cada proveedor a su variable conocida y valida el origen HTTPS antes de realizar la llamada.
- Los runtimes HTTP/MCP personalizados no reciben secretos del servidor. Sus hosts deben estar en `ACC_ALLOWED_CUSTOM_HOSTS`.
- Ollama/LM Studio se consideran runtimes locales y quedan deshabilitados en producción Vercel.
- El endpoint público de proveedores solo informa metadatos y presencia de claves; nunca devuelve el valor de una clave.
- Las contraseñas de usuarios se almacenan como hashes scrypt con salt aleatorio; no se guarda la contraseña en texto plano.
- Las sesiones usan cookies `httpOnly`, `sameSite=strict`, `secure` en producción y expiración.
- Las mutaciones autenticadas comprueban `Origin` contra el host de la solicitud y aplican rate limiting.
- GitHub webhooks requieren HMAC SHA-256.
- El CI ejecuta un escaneo de secretos de alta confianza, una auditoría de dependencias de producción y CodeQL.
- El Agent Bridge elimina del entorno heredado del proceso las variables que parecen contener claves, tokens, contraseñas, credenciales o URLs de base de datos antes de lanzar un CLI. Las credenciales almacenadas por el propio CLI siguen siendo responsabilidad del entorno local y deben usar cuentas/tokens con permisos mínimos.

## GitHub

Para un repositorio público, GitHub ofrece secret scanning automáticamente; también conviene habilitar Push Protection para bloquear secretos antes de que entren al repositorio. Secret scanning cubre el historial completo y GitHub recomienda revocar inmediatamente cualquier secreto real que haya sido expuesto.
