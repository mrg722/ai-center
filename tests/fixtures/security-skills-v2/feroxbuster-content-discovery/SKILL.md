---
name: feroxbuster-content-discovery
description: Descubrimiento de contenido web autorizado con feroxbuster, recursion, filtros y limites.
---

# feroxbuster-content-discovery

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

Comando esperado: `feroxbuster`

## Fuente actual

La documentacion oficial se movio a GitHub Pages. El proyecto tambien mantiene shell completions actuales que exponen una lista detallada de flags.

## Preflight

```bash
feroxbuster --version
feroxbuster --help
```

## Flujo base

```bash
feroxbuster -u https://AUTHORIZED_TARGET -w WORDLIST
```

## Recursion

La CLI actual expone `-d/--depth`. La ayuda publicada define la profundidad maxima y permite evitar recursion ilimitada. Para AI Center comenzar con profundidad pequena.

```bash
feroxbuster -u https://AUTHORIZED_TARGET -w WORDLIST --depth 2
```

## Filtros

La CLI actual expone filtros por status, size, words, lines, regex y similitud:

```text
--filter-status
--filter-size
--filter-words
--filter-lines
--filter-regex
--filter-similar-to
```

Primero crea baseline y despues ajusta filtros.

## Scope / exclusion

La CLI actual expone `--scope` y `--dont-scan`; usarlos para prevenir recursion fuera del dominio o URL autorizada.

## Rendimiento y resiliencia

La CLI actual expone `--threads`, `--scan-limit`, `--rate-limit`, `--timeout` y `--time-limit`. AI Center debe imponer limites aun cuando el operador no los indique.

## Resultados y reanudacion

Usar `--output` y `--json` cuando la version instalada lo soporte. Si existe state/resume, asociarlo al task y no reutilizarlo en otro scope.

## Señales para detener

Muchos 429/403, 5xx, timeouts o degradacion del servicio -> `PARTIAL` y pausa.
