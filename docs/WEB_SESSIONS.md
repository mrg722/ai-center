# Sesiones Web

## Propósito

El Command Center puede ofrecer un modo opcional para interactuar con sesiones web de ChatGPT, Claude y Gemini que ya estén abiertas/autenticadas en el ordenador del usuario.

## Limitación fundamental

Una página web alojada normalmente no puede incrustar y controlar libremente otra aplicación web autenticada en un iframe debido a aislamiento de origen, políticas de contenido y autenticación. El Command Center no debe intentar copiar ni almacenar credenciales de estos servicios.

## Mecanismo recomendado

Usar un **Web Session Bridge local**:

```text
Command Center Cloud
        |
        | conexión saliente segura
        v
Web Session Bridge
        |
        v
navegador local
   +--> ChatGPT
   +--> Claude
   +--> Gemini
```

El bridge puede utilizar automatización de navegador, por ejemplo Playwright, cuando la automatización sea técnicamente posible y compatible con las condiciones del servicio.

## Seguridad

- No enviar contraseñas al servidor.
- No almacenar cookies de sesión en Supabase.
- No exponer el perfil del navegador a Internet.
- Mantener las sesiones autenticadas localmente.
- Permitir al usuario iniciar/cerrar la automatización.
- Mostrar claramente qué sesión y qué acción está ejecutando el bridge.
- Requerir aprobación humana para acciones sensibles.

## Estado

El agente debe reportar:

OFFLINE
BROWSER_CONNECTED
LOGIN_REQUIRED
IDLE
WORKING
WAITING_USER
ERROR

## Prioridad de integración

1. API/SDK oficial.
2. App-server/CLI oficial.
3. MCP oficial.
4. Automatización de sesión web como último recurso.

Esto mantiene el núcleo estable aunque una interfaz web cambie.
