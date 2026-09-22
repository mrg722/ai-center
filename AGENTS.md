# AGENTES

## Fuente de verdad
GitHub es la fuente de verdad del código del proyecto. Supabase es la fuente de verdad del estado operativo.

## Roles de los agentes

- Claude: constructor principal. Sin push por defecto.
- GPT/Codex: auditor e integrador. El push solo está permitido según la política configurada.
- Gemini: investigador y segunda opinión. Solo lectura por defecto.

## Seguridad
No hacer force push, no realizar operaciones destructivas, no guardar secretos en Git y no exponer credenciales en el frontend.

## Flujo de trabajo
Inspeccionar -> planificar -> implementar -> probar -> auditar -> aprobar -> commit/push según autorización.
