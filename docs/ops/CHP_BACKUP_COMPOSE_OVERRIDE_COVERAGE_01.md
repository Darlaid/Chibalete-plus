# CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01

Fecha: 2026-09-03. Tipo: **cobertura de backup + evidencia de restore**.
Operación / infraestructura.

Cierra el gap que abrió `01A` (preflight read-only):
`YELLOW-COMPOSE-OVERRIDE-BACKUP-COVERAGE-GAP-CONFIRMED`.

```text
ESTADO: PENDIENTE DE EJECUCIÓN
```

Este documento se crea con la implementación y se completa tras el backup
controlado y el restore aislado. Mientras diga «pendiente de ejecución», la
cobertura está **escrita y probada en CI, pero no demostrada en producción**.

---

## 1. El gap que se cierra

El archivo que gobierna qué imágenes corren en producción —`front`, `api_1` y
`api_2`— es `/opt/chibaleteplus/docker-compose.override.yml`. `docker compose`
carga base y override juntos, y el override gana.

`01A` demostró, por lectura de código y no por inferencia, que **ninguno** de
los tres mecanismos de backup del VPS lo capturaba:

| Mecanismo | Qué Compose selecciona |
|---|---|
| `structured-backup` (canónico, restic → B2, diario) | **ninguno**: restic sólo recibe el staging, y el staging sólo se poblaba desde stores bajo `/var/www/chibalete` |
| `scripts/backup-vps.sh` (manual, pre-deploy) | sólo la base, por variable explícita |
| `/opt/chibaleteplus/scripts/backup.sh` (manual, sin timer) | sólo la base, y con `\|\| true`: su ausencia sería silenciosa |

Matriz del gate en `01A` — el override puntuaba **0 de 5**: no seleccionado, no
presente en snapshot, sin origen del que recuperar, sin restore documentado y
sin ensayo. Sus únicas copias eran `*.bak-pre-*` en el mismo directorio, el
mismo disco y el mismo host que el archivo que protegen: sirven para revertir un
deploy, no para sobrevivir a la pérdida de la máquina.

RPO sobre la topología efectiva: **infinito**.

## 2. Qué se implementó

Inventario fijo de dos archivos, con resolución fail-closed, en el mecanismo
**canónico** (el que corre a diario y va offsite cifrado).

```text
origen    /opt/chibaleteplus/            (constante, no parametrizable en prod)
archivos  docker-compose.yml
          docker-compose.override.yml
destino   <snapshot>/topology/<nombre>
método    copia byte a byte, atómica (temporal + rename), sha256 sobre la copia
```

Decisiones y sus porqués:

- **Ambos obligatorios.** Un backup sin la topología efectiva no cumple su
  propósito, así que la ausencia de cualquiera de los dos **aborta el backup de
  forma visible** y no produce snapshot. No se anota como `absent_optional`:
  esa semántica es para stores que aún no existen, y aquí la ausencia siempre
  significa pérdida.
- **Por nombre exacto, sin recorrer el directorio.** `/opt/chibaleteplus`
  contiene el `.env` con los secretos de la aplicación y decenas de copias
  ad-hoc. Recorrerlo habría metido el `.env` en el backup. Copiar dos nombres
  declarados lo hace estructuralmente imposible.
- **No es un mecanismo genérico para rutas absolutas.** El resolver rechaza
  nombres no declarados, nombres con separadores, `..`, rutas absolutas,
  symlinks, no-regulares, y todo lo alcanzado por `EXCLUDED_NAME_PATTERNS`.
- **Resolución antes del lock.** Si falta un archivo, se aborta antes de tomar
  el lock y antes de tocar el repositorio: sin efectos laterales.
- **No se parsea el YAML.** Se preservan bytes; el runner nunca lee claves ni
  valores. El log emite nombre, tamaño y método, nunca contenido.
- **No se tocó el cálculo de espacio.** Unos pocos KB quedan absorbidos por
  `MANIFEST_RESERVE_BYTES` (256 KB) del preflight.

## 3. Gate de secretos (previo a incorporarlos)

Ambos archivos se auditaron sin mostrar valores, emitiendo sólo nombres de
clave, conteos y resultado:

```text
docker-compose.yml            claves: METRICS_ENGINE, LEGACY_METRICS_REQUEST_CONTEXT
                              env_file: 2    secretos literales: 0    → SEGURO
docker-compose.override.yml   claves: LEGACY_METRICS_REQUEST_CONTEXT, IDENTITY_DB,
                              IDENTITY_SQLITE_ENABLED, IDENTITY_DUAL_WRITE,
                              IDENTITY_READ, IDENTITY_SHADOW_COMPARE,
                              SESSION_AUTH_MODE, SESSIONS_DB
                              env_file: 0    secretos literales: 0    → SEGURO
```

Son flags y rutas. Los secretos viven en `.env` (referenciado por `env_file`) y
en el mount de sólo lectura `secrets`, y **ninguno de los dos entra** en el
backup: `.env` está en `EXCLUDED_NAME_PATTERNS` y, además, nunca se recorre el
directorio.

## 4. Pruebas

Ocho casos dirigidos, `TP01`–`TP08`, además de los 105 existentes:

| Caso | Qué fija |
|---|---|
| TP01 | ambos Compose se copian y quedan en el manifiesto con `kind=topology` |
| TP02 | bytes preservados: `sha256` del manifiesto == `sha256` de la fuente |
| TP03 | base y override son distinguibles entre sí |
| TP04 | falta el override → fallo visible, sin snapshot, staging limpio |
| TP05 | symlink rechazado fail-closed |
| TP06 | `.env` y copias ad-hoc **nunca** entran |
| TP07 | no se recorre el directorio padre |
| TP08 | el resolver rechaza nombres no declarados y el inventario es de dos |

El entorno de prueba usa un directorio de topología **sintético** con ruido
deliberado (`.env`, `*.bak-pre-*`, `*.bak.*`): si el mecanismo recorriera el
directorio en lugar de copiar por nombre, TP06 y TP07 lo detectarían.

La suite completa sólo se ejecuta en su sandbox: el harness es fail-closed y
**aborta en un host productivo** sin flag de bypass. En este proyecto ese
sandbox es el contenedor efímero de CI, con restic y systemd reales.

```text
PENDIENTE: resultado de CI (suite canónica, 113 casos)
```

## 5. Backup controlado

```text
PENDIENTE DE EJECUCIÓN
```

- snapshot:
- timestamp:
- duración:
- resultado:
- `topology/docker-compose.yml` en el manifiesto:
- `topology/docker-compose.override.yml` en el manifiesto:

## 6. Restore aislado y comparación por hash

```text
PENDIENTE DE EJECUCIÓN
```

- directorio temporal:
- `sha256` vivo / restaurado — base:
- `sha256` vivo / restaurado — override:
- permisos del archivo vivo sin modificar:
- nada aplicado a `/opt/chibaleteplus`:
- ningún contenedor recreado:

## 7. Límites y rollback del runner

Esta unidad **no** modifica timers, units, credenciales, repositorio restic ni
política de retención. No ejecuta `check`, `forget`, `prune`, `unlock` ni
`restic init`. No toca `data/`, `data-critical/`, `public/uploads/`, el deploy
backend, los mounts del frontend ni los dos scripts manuales de backup, que
siguen respaldando sólo la base.

Rollback del runner: se respaldan los archivos que se reemplazan, con sus
hashes, y ante divergencia o fallo se restaura la versión anterior de
inmediato.

```text
PENDIENTE: archivos respaldados y hashes
```

## 8. Lo que esto no resuelve

- Los dos mecanismos manuales (`backup-vps.sh` y `scripts/backup.sh`) siguen
  copiando sólo la base. No se tocaron: quedan como deuda separada.
- El flujo de deploy **backend** de `deployment_guide.md` §12 sigue apuntando al
  compose base para respaldar antes de editar, con el mismo defecto que se
  corrigió en el flujo frontend. Fuera de alcance, registrado aparte.
- `deployment_guide.md` §3 sigue describiendo `chibalete_front` sin mounts,
  cuando tiene seis de sólo lectura. Fuera de alcance.

## 9. Único siguiente paso

```text
PENDIENTE
```
