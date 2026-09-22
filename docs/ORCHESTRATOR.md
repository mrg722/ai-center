# Orquestador

## Responsabilidades

- crear y actualizar tareas;
- enrutar mensajes;
- controlar estados y transiciones;
- construir el contexto mínimo necesario;
- validar permisos;
- registrar eventos importantes;
- coordinar handoffs;
- gestionar reintentos, tiempos de espera y cancelación;
- solicitar aprobación humana;
- asociar el trabajo con rama, commit y PR;
- mantener trazabilidad.

## Estados de tarea

`OPEN`, `PLANNING`, `IN_PROGRESS`, `WAITING_AGENT`, `WAITING_REVIEW`, `WAITING_USER`, `APPROVED`, `REJECTED`, `BLOCKED`, `FAILED`, `COMPLETED`, `CANCELLED`.

## Principio de idempotencia

Un `handoff_id` o `message_id` debe poder procesarse más de una vez sin duplicar efectos críticos.

## Acciones sensibles

Requieren autorización o política explícita:

- push;
- merge;
- modificar permisos;
- cambiar secretos;
- operaciones destructivas;
- ejecutar comandos de alto riesgo.

## Gestor de contexto

El contexto se construye por capas:

- proyecto;
- tarea;
- sesión;
- agente;
- Git;
- archivos relevantes;
- decisiones anteriores;
- resultados recientes.

No enviar el repositorio completo por defecto.
