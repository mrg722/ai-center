---
name: ffuf-web-fuzzing
description: Fuzzing web/API autorizado con ffuf, wordlists, FUZZ, matchers, filtros y configuracion.
---

# ffuf-web-fuzzing

## Contrato operacional

Esta Skill esta disenada para agentes de AI Center. No sustituye la Policy Engine. Antes de cualquier operacion remota, el agente necesita `target`, `scope`, `approval_id` cuando corresponda y un `output_dir` aislado.

### Estados

- `DEPENDENCY_MISSING`: la herramienta no esta instalada.
- `READY`: preflight correcto.
- `BLOCKED_SCOPE`: target fuera de allowlist.
- `NEEDS_APPROVAL`: accion activa/invasiva.
- `RUNNING`: proceso controlado en curso.
- `PARTIAL`: resultado incompleto por timeout, rate limit o error recuperable.
- `COMPLETED`: ejecucion terminada y artefactos guardados.

### Exactitud

- `DOC_VERIFIED`: sintaxis respaldada por fuente oficial consultada.
- `RUNTIME_DISCOVERED`: comprobada contra `--help`, `--version` o la interfaz real instalada.
- `VERSION_DEPENDENT`: puede variar entre releases.
- `NOT_VERIFIED`: no usar como instruccion operacional.

### Regla de version

La documentación oficial es la referencia general, pero la instancia instalada manda para flags y defaults. Ejecuta el preflight incluido y, ante una discrepancia, consulta la ayuda de la versión instalada en vez de inventar una correccion.

## Preflight

Ejecutar:

    ./scripts/preflight.sh

No continuar si el estado es `DEPENDENCY_MISSING`.

## Evidencia minima

Registrar version, target, scope, timestamp, comando ejecutado (con secretos redactados), stdout/stderr relevante, exit code y paths/IDs de artefactos.

## Seguridad de AI Center

No saltar `Policy Engine -> approval -> Bridge/sandbox -> tool -> audit log`. No introducir secretos en `SKILL.md`, prompts o logs.

## Binario

Comando esperado: `ffuf`

## Version y fuente

El README/wiki actuales describen `FUZZ` en URL, headers o body, multiples wordlists, matchers/filters, recursion y configuracion. La CLI cambia entre releases; fijar version real con `ffuf -V`.

## Preflight

```bash
ffuf -V
ffuf -h
```

## URL/content discovery

```bash
ffuf -w WORDLIST -u 'https://AUTHORIZED_TARGET/FUZZ'
```

## Parametro

```bash
ffuf -w WORDLIST -u 'https://AUTHORIZED_TARGET/?FUZZ=value'
```

## POST body

```bash
ffuf -w WORDLIST -u 'https://AUTHORIZED_TARGET/' -X POST -d 'param=FUZZ'
```

## Headers

`-H` admite headers; usar solo identidades/headers autorizados.

## Matchers / filters

La CLI actual documenta matchers `-mc/-ml/-mr/-ms/-mt/-mw` y filtros `-fc/-fl/-fr/-fs/-ft/-fw`. Primero medir baseline y despues filtrar.

## Recursion

`-recursion` existe en la CLI actual; usar solo con URL terminada en el punto requerido por la version y con limites de scope/tiempo. Usar `-sf` como proteccion cuando el comportamiento indica respuestas masivas 403.

## Configuracion

El wiki actual documenta `-config` y configuracion TOML en XDG, con ruta heredada compatible en ciertas instalaciones. No copiar configuraciones de otra version sin revisar help.

## Rate / concurrency

Mantener threads moderados. En produccion usar rate limit y time limit si el engagement lo exige. Un 429/503 creciente puede ser señal de sobrecarga o control defensivo: bajar ritmo.

## Salida

Guardar JSON/CSV/normal segun capacidades de la version instalada. Asociar output a task y scope exactos.
