-- Imported verbatim from the user-provided "AI_Center_Security_Skills_v2"
-- package (AgentSkills format — https://github.com/agentskills/agentskills).
-- Per explicit instruction, the `instructions` column below is each skill's
-- full SKILL.md file content, byte-for-byte, unmodified — only the
-- catalogue metadata (slug/name/description/category/security_level/
-- required_tools) is our own classification, since that metadata does not
-- exist in the source format.
--
-- Not imported: `john-the-ripper-hash-audit` — the source package only
-- contains its references/SOURCES.md, with no SKILL.md and no supporting
-- files, so there is nothing to insert verbatim without fabricating content.
insert into skill_definitions (slug, name, description, category, instructions, version, source, required_tools, security_level, metadata)
values
  ('feroxbuster-content-discovery', 'feroxbuster-content-discovery',
   'Descubrimiento de contenido web autorizado con feroxbuster, recursion, filtros y limites.',
   'security',
$ferox$---
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
$ferox$,
   '1.0.0', 'custom', array['feroxbuster'], 'elevated',
   '{"package":"AI_Center_Security_Skills_v2","format":"agentskills-v2","source_path":"skills/feroxbuster-content-discovery/SKILL.md"}'::jsonb),

  ('ffuf-web-fuzzing', 'ffuf-web-fuzzing',
   'Fuzzing web/API autorizado con ffuf, wordlists, FUZZ, matchers, filtros y configuracion.',
   'security',
$ffuf$---
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
$ffuf$,
   '1.0.0', 'custom', array['ffuf'], 'elevated',
   '{"package":"AI_Center_Security_Skills_v2","format":"agentskills-v2","source_path":"skills/ffuf-web-fuzzing/SKILL.md"}'::jsonb),

  ('hashcat-password-audit', 'hashcat-password-audit',
   'Auditoria offline de hashes con Hashcat, modos de ataque, benchmark, sesiones y restore.',
   'security',
$hashcat$---
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
$hashcat$,
   '1.0.0', 'custom', array['hashcat'], 'standard',
   '{"package":"AI_Center_Security_Skills_v2","format":"agentskills-v2","source_path":"skills/hashcat-password-audit/SKILL.md"}'::jsonb),

  ('impacket-windows-ad-audit', 'impacket-windows-ad-audit',
   'Auditoria autorizada de SMB, Kerberos, LDAP, MSRPC y Active Directory mediante Impacket.',
   'security',
$impacket$---
name: impacket-windows-ad-audit
description: Auditoria autorizada de SMB, Kerberos, LDAP, MSRPC y Active Directory mediante Impacket.
---

# impacket-windows-ad-audit

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

## Binario / runtime

La dependencia principal se valida mediante Python (`import impacket` o `import scapy`); no basta con comprobar que exista `python3`.

## Fuente de verdad

El README oficial indica que Impacket es una coleccion de clases/protocolos y que las herramientas de `examples/` muestran usos practicos. No existe un unico manual exhaustivo: cada ejemplo define su propia CLI.

## Preflight

```bash
python3 -m pip show impacket
python3 examples/smbclient.py -h
python3 examples/GetUserSPNs.py -h
```

La release estable publicada por el proyecto debe preferirse a `master` para trabajos reproducibles; registrar version real.

## SMB

Usar `smbclient.py -h` para descubrir argumentos de la instancia instalada. La herramienta soporta autenticacion por password y, segun opciones, Kerberos/hashes.

## Kerberos / SPNs

`GetUserSPNs.py` sirve para enumerar SPNs y documenta opciones de consulta y salida. Antes de usarlo, confirmar dominio/identidad y que el objetivo este dentro del scope.

## LDAP/RPC/WMI

Impacket incluye implementaciones de LDAP y multiples interfaces MSRPC, DCOM y WMI. En AI Center, la enumeracion minima es el default. La ejecucion remota, relay, dumping de secretos, tickets y otras capacidades de alto impacto requieren una approval separada y sandbox/lab.

## No copiar secretos a comandos

AI Center debe inyectar credenciales como secret refs y borrar stdout sensible de los artefactos publicables.

## Diagnostico Kerberos

Registrar por separado: DNS/resolucion, realm/dominio, SPN, hora/clock skew, transporte, identidad y respuesta del KDC. No concluir que la autenticacion fallo por una sola linea sin contexto.

## Evidencia

Para cada objeto: host, puerto, protocolo, identidad/realm, metodo de autenticacion, recurso consultado, resultado y timestamp.
$impacket$,
   '1.0.0', 'custom', array['python3','impacket'], 'restricted',
   '{"package":"AI_Center_Security_Skills_v2","format":"agentskills-v2","source_path":"skills/impacket-windows-ad-audit/SKILL.md"}'::jsonb),

  ('metasploit-controlled-validation', 'metasploit-controlled-validation',
   'Descubrimiento, documentacion y validacion controlada de modulos de Metasploit en targets autorizados.',
   'security',
$msf$---
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
$msf$,
   '1.0.0', 'custom', array['msfconsole'], 'restricted',
   '{"package":"AI_Center_Security_Skills_v2","format":"agentskills-v2","source_path":"skills/metasploit-controlled-validation/SKILL.md"}'::jsonb)
on conflict (slug) do nothing;
