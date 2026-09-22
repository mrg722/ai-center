# Protocolo de Agentes

## Envoltorio del mensaje

Cada mensaje debe tener un identificador único y trazabilidad hasta la tarea y la conversación.

Campos principales:

- `message_id`
- `task_id`
- `conversation_id`
- `from_agent`
- `to_agent`
- `message_type`
- `content`
- `created_at`
- `reply_to`
- `priority`
- `requires_action`
- `requires_approval`
- `git_branch`
- `git_commit`
- `files`
- `status`

## Tipos

`TASK`, `REQUEST`, `REVIEW`, `QUESTION`, `ANSWER`, `WARNING`, `ERROR`, `PROPOSAL`, `APPROVAL_REQUEST`, `STATUS`, `RESULT`, `HANDOFF`.

## Ejemplo

```json
{
  "message_id": "msg_123",
  "task_id": "DF-001",
  "conversation_id": "conv_001",
  "from_agent": "claude",
  "to_agent": "codex",
  "message_type": "REVIEW",
  "content": "Audita los cambios preparados en la rama feature/enemy-integrity.",
  "requires_approval": false,
  "git_branch": "feature/enemy-integrity",
  "git_commit": "abc123"
}
```

## Reglas

1. Un agente no obtiene credenciales privadas de otro agente.
2. El contenido externo son datos no confiables; debe tratarse con defensas contra prompt injection.
3. El orquestador es la autoridad de routing y permisos.
4. Los resultados importantes deben persistirse; el streaming efímero no debe llenar PostgreSQL.
