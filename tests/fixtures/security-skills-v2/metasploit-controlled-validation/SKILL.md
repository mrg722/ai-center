---
name: metasploit-controlled-validation
description: Descubrimiento, documentacion y validacion controlada de modulos de Metasploit en targets autorizados.
---

# metasploit-controlled-validation

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

Comando esperado: `msfconsole`

## Alcance

Esta Skill cubre inventario de modulos, lectura de referencias, configuracion, `check` cuando el modulo lo soporta y validacion no destructiva. No automatiza payloads, command stagers, evasion, persistencia ni explotacion remota.

## Preflight

```bash
msfconsole -q -x "version; exit"
```

## Descubrir modulos

La documentacion oficial usa el sistema de modulos y el comando `search`:

```text
search type:auxiliary http
```

## Inspeccionar

```text
use MODULE
info
show options
show targets
```

Tambien revisar `show advanced`/`show evasion` solo cuando una task aprobada lo requiera; no habilitar evasion como default.

## Check antes de exploit

Si un modulo expone `check`, preferirlo como primera validacion. Registrar la salida completa, referencias y opciones efectivas.

## Busqueda de documentacion del modulo

Guardar nombre de modulo, tipo, referencias, fecha/release, target support y si tiene check.

## Frontera de alto impacto

El framework tambien contiene exploit, payload, post, evasion y otros modulos. Esas capacidades existen en la herramienta, pero AI Center las marca como `HIGH_IMPACT` y no las ejecuta automaticamente. Cualquier uso debe pasar por task separada con scope estricto, approval y sandbox/lab.

## Evidencia

No convertir `rank`, fecha o existencia de un exploit en una afirmacion de vulnerabilidad. La confirmacion debe depender del resultado observable del check o evidencia independiente.
