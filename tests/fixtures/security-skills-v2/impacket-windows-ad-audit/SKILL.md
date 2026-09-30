---
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
