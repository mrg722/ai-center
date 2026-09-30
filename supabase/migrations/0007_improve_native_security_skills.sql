-- Brings the 6 native security skills seeded in 0005 up to the same
-- explicit operational contract the imported AgentSkills pack uses
-- (states, accuracy tags, minimum evidence, Policy Engine reminder). The
-- old instructions were single vague paragraphs; agents following them had
-- no explicit stop/ask conditions and no evidence-logging requirement. This
-- only updates `instructions` — slug/category/security_level/source are
-- untouched, so nothing that links to these skills (agent_definition_skills,
-- chat skill selections by slug) is affected.
update skill_definitions set instructions =
$sk$## Contrato operacional

Esta Skill es para agentes de AI Center. No sustituye la Policy Engine: cualquier prueba contra un target real necesita `target`, `scope` y `approval_id` cuando corresponda.

### Estados
- `BLOCKED_SCOPE`: el target/endpoint declarado no está en el scope autorizado.
- `NEEDS_APPROVAL`: la prueba modificaría datos o requiere una cuenta con privilegios que el agente no tiene concedidos.
- `RUNNING`: revisión en curso.
- `PARTIAL`: no se pudo cubrir todo el checklist (rate limit, endpoint no disponible, cuenta de prueba insuficiente).
- `COMPLETED`: checklist recorrido y hallazgos (o su ausencia) registrados.

## Checklist
1. Autenticación requerida en toda ruta salvo que esté explícitamente marcada pública.
2. Autorización evaluada por RECURSO (no solo "está logueado"): el dueño del recurso, no cualquier usuario autenticado.
3. Validación server-side de cualquier ID/rol enviado por el cliente — nunca confiar en el valor recibido.
4. Rate limiting en endpoints de escritura y autenticación.
5. La respuesta no expone más campos de los que el caller debería ver.

## Evidencia mínima
Por cada endpoint probado: método, ruta, request/response relevantes (con secretos redactados), cuenta de prueba usada, resultado esperado vs observado, timestamp.

## Seguridad de AI Center
No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. Usar únicamente las cuentas de prueba provistas; nunca datos de usuarios reales. No introducir secretos en logs ni en el reporte.
$sk$
where slug = 'api-security';

update skill_definitions set instructions =
$sk$## Contrato operacional

Esta Skill es para agentes de AI Center. No sustituye la Policy Engine: cualquier prueba contra un target real necesita `target`, `scope` y `approval_id` cuando corresponda.

### Estados
- `BLOCKED_SCOPE`: una categoría no aplica o el target está fuera de scope.
- `NEEDS_APPROVAL`: la categoría requiere una acción invasiva (ej. probar SSRF contra infraestructura interna).
- `PARTIAL`: alguna categoría no pudo probarse (dependencia externa, falta de cuenta de prueba).
- `COMPLETED`: las 10 categorías fueron recorridas y documentadas.

## Categorías (recorrer todas, en orden)
Access control, cryptographic failures, injection, insecure design, misconfiguration, vulnerable/outdated components, identification/authentication failures, software/data integrity failures, logging/monitoring failures, SSRF.

Para cada categoría: `tested: true/false`, resultado, evidencia (si aplica), severidad.

## Evidencia mínima
Tabla final con las 10 categorías, su estado y hallazgos asociados (o "sin hallazgos"). No marcar una categoría como probada sin evidencia concreta.

## Seguridad de AI Center
No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. No probar categorías fuera del scope autorizado aunque el target parezca vulnerable.
$sk$
where slug = 'owasp';

update skill_definitions set instructions =
$sk$## Contrato operacional

Esta Skill es para agentes de AI Center. No sustituye la Policy Engine. Usar EXCLUSIVAMENTE las cuentas de prueba provistas — nunca credenciales ni cuentas reales.

### Estados
- `BLOCKED_SCOPE`: no hay cuentas de prueba provistas para el flujo a auditar.
- `NEEDS_APPROVAL`: la prueba requeriría bloquear/deshabilitar una cuenta real o generar spam de emails.
- `PARTIAL`: un sub-check no se pudo completar (ej. MFA no configurable en el entorno de prueba).
- `COMPLETED`: checklist completo con resultado por ítem.

## Checklist
1. Brute-force / lockout: intentos fallidos limitados y con backoff.
2. Password reset: token de un solo uso, entropía suficiente, expira en tiempo razonable.
3. Session fixation: el session id cambia tras login.
4. Invalidación de sesión al logout y al cambiar contraseña.
5. Rutas de bypass de MFA (recovery codes, fallback SMS mal implementado).
6. Cookies de sesión: `HttpOnly`, `Secure`, `SameSite` correctos.

## Evidencia mínima
Por ítem: pasos de reproducción, resultado observado, captura/log relevante (secretos redactados).

## Seguridad de AI Center
No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. Nunca registrar contraseñas, tokens o códigos MFA en claro.
$sk$
where slug = 'authentication';

update skill_definitions set instructions =
$sk$## Contrato operacional

Esta Skill es para agentes de AI Center. No sustituye la Policy Engine. Requiere exactamente el número de cuentas de prueba provisto — nunca cuentas reales.

### Estados
- `BLOCKED_SCOPE`: no hay al menos 2 cuentas de prueba con roles distintos disponibles.
- `NEEDS_APPROVAL`: la escalada probaría una acción destructiva/irreversible (ej. borrar un recurso).
- `PARTIAL`: solo se pudo probar vertical O horizontal, no ambas.
- `COMPLETED`: ambas direcciones probadas y documentadas.

## Checklist
1. Vertical: cuenta de rol bajo intentando una acción de rol alto — debe ser rechazada server-side.
2. Horizontal: cuenta A intentando leer/modificar un recurso de cuenta B — debe ser rechazada por dueño, no solo por rol.
3. Confirmar que el control vive en el servidor (no solo oculto en la UI).

## Evidencia mínima
Por cada intento: acción, cuenta usada, recurso objetivo, respuesta del servidor (código + body relevante, secretos redactados), veredicto (bloqueado/permitido).

## Seguridad de AI Center
No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. Usar solo las cuentas de prueba provistas y un único recurso sintético por tipo de objeto.
$sk$
where slug = 'authorization';

update skill_definitions set instructions =
$sk$## Contrato operacional

Esta Skill es para agentes de AI Center. No sustituye la Policy Engine. Usar solo cuentas de prueba y datos sintéticos — nunca enumerar ni acceder a datos de usuarios reales.

### Estados
- `BLOCKED_SCOPE`: no hay un registro sintético por tipo de objeto disponible para probar.
- `NEEDS_APPROVAL`: la prueba requeriría enumerar un rango amplio de IDs reales.
- `PARTIAL`: algunos tipos de objeto no pudieron probarse.
- `COMPLETED`: todos los tipos de objeto identificados fueron probados.

## Checklist
1. Enumerar los identificadores de objeto referenciados en las requests (IDs secuenciales, UUIDs, slugs).
2. Con la cuenta de prueba A, intentar acceder a un objeto perteneciente a la cuenta de prueba B.
3. Confirmar que el servidor rechaza el acceso por dueño, no solo por autenticación.
4. Repetir para cada tipo de objeto relevante, usando exactamente un registro sintético por tipo.

## Evidencia mínima
Por objeto probado: tipo, identificador (redactado si es sensible), cuenta usada, resultado esperado vs observado.

## Seguridad de AI Center
No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. Nunca enumerar ni acceder a datos reales de usuarios.
$sk$
where slug = 'idor';

update skill_definitions set instructions =
$sk$## Contrato operacional

Esta Skill convierte hallazgos YA VERIFICADOS de otras skills en un reporte. No ejecuta pruebas ni reabre hallazgos no reproducidos.

### Estados
- `BLOCKED_SCOPE`: el hallazgo recibido no tiene evidencia de reproducción — se rechaza, no se reporta.
- `PARTIAL`: falta severidad o remediación para algún hallazgo.
- `COMPLETED`: todos los hallazgos tienen los campos requeridos.

## Campos obligatorios por hallazgo
Título, severidad, confianza, componente/endpoint afectado, pasos mínimos de reproducción, evidencia redactada (nunca cookies/tokens/API keys/contraseñas/PII en claro — reemplazar por `<REDACTED>`), impacto de negocio, remediación.

## Regla de inclusión
Nunca incluir un hallazgo que no fue reproducido independientemente por el agente que lo reporta. Agrupar por severidad, de mayor a menor.

## Seguridad de AI Center
No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. El reporte es el artefacto público del engagement: revisar dos veces que no contenga secretos antes de entregarlo.
$sk$
where slug = 'reporting';
