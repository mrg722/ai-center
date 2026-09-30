---
name: hashcat-password-audit
description: Auditoria offline de hashes con Hashcat, modos de ataque, benchmark, sesiones y restore.
---

# hashcat-password-audit

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

Comando esperado: `hashcat`

## Alcance

Solo hashes autorizados y offline. No usar contra cuentas, endpoints o credenciales en tiempo real.

## Preflight

```bash
hashcat --version
hashcat --help
hashcat --benchmark
```

No usar `--force` para resolver errores normales; la documentacion oficial lo reserva para necesidades especificas/desarrollo.

## Modos de ataque principales

La documentacion oficial actual describe:

- `-a 0` straight/wordlist
- `-a 1` combination
- `-a 3` brute-force/mask
- `-a 6` hybrid wordlist + mask
- `-a 7` hybrid mask + wordlist

Versiones nuevas pueden introducir otras variantes; confirmar con `hashcat --help`.

## Forma base

```bash
hashcat -m HASH_MODE -a 0 HASHFILE WORDLIST
```

Mask:

```bash
hashcat -m HASH_MODE -a 3 HASHFILE MASK
```

No inventar numeros de `-m`: usar la tabla/modo de la version instalada.

## Rules

Usar reglas disponibles en la instalacion y registrar el archivo exacto. No confiar en un nombre de ruleset copiado desde otra version.

## Sessions / restore

```bash
hashcat --session SESSION -m HASH_MODE -a 0 HASHFILE WORDLIST
hashcat --session SESSION --restore
```

La wiki documenta que restore depende del estado del trabajo original.

## Status

Usar `--status`, `--status-json` y `--status-timer` cuando la release instalada los soporte.

## Hardware

Descubrir backend/device y registrar benchmark. Vigilar temperatura y limites de energia en ejecuciones largas.

## Datos sensibles

Hashes, potfiles y plaintexts se consideran secretos. Mantenerlos dentro del sandbox y registrar solo metadatos necesarios.
