# Puente de Agentes (Agent Bridge)

## Objetivo

Conectar el Command Center alojado en la nube con agentes locales sin exponer directamente la máquina del usuario a Internet.

## Arquitectura

```text
Web -> Orquestador -> conexión saliente segura -> Agent Bridge -> agente local
```

El puente:

- autentica la instancia;
- anuncia presencia;
- mantiene heartbeat;
- recibe tareas;
- ejecuta el adaptador local;
- devuelve eventos y resultados;
- gestiona la reconexión;
- no entrega credenciales al frontend.

## Agentes iniciales

- Claude Code local
- Codex local
- Gemini y otros adaptadores posteriores

## Seguridad

La conexión debe ser saliente desde la máquina local. Evitar abrir puertos públicos al workspace.
