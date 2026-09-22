# AI Office

## Concepto

Escena interactiva top-down en pixel art que representa el estado REAL de cada agente.

## Estaciones

Cada agente tiene un puesto con:

- escritorio;
- ordenador/monitor;
- silla;
- papeles;
- taza;
- archivadores;
- estanterías;
- plantas;
- pizarras;
- lámparas;
- cables;
- detalles de desarrollo de videojuegos;
- objetos distintivos por agente.

## Estados visuales

- `ONLINE`
- `WORKING`
- `THINKING`
- `WAITING`
- `REVIEWING`
- `ERROR`
- `OFFLINE`
- `BLOCKED`

La escena no debe simular actividad. Debe consumir el estado real del sistema.

## Interacción

- zoom;
- desplazamiento (pan);
- selección de agente;
- panel del agente;
- cámara adaptativa para móvil.

Al seleccionar un agente, mostrar nombre, modelo, rol, estado, tarea, último evento, último mensaje, archivos, rama, commit y herramientas activas.
