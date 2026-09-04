# CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01

Fecha: 2026-09-03. Tipo: **cobertura de backup + evidencia de restore**.
Operación / infraestructura.

Cierra el gap que abrió `01A` (preflight read-only):
`YELLOW-COMPOSE-OVERRIDE-BACKUP-COVERAGE-GAP-CONFIRMED`.

```text
GREEN-COMPOSE-TOPOLOGY-BACKUP-AND-RESTORE-VERIFIED
```

La topología Compose efectiva entra en el backup canónico offsite y se
demostró recuperable byte a byte desde un snapshot real, en un directorio
aislado, sin aplicar nada a producción.

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

Resultado de CI, `backup-suite-sandboxed` sobre `1201c51`:

```text
=== RESUMEN: 113/113 PASS ===
SUITE_RESULT=GREEN
```

TP01–TP08 en verde, y los 105 casos previos también.

**Regresión detectada y corregida en el camino.** El primer intento
(`dccf610`) dejó la suite en `104/113`: nueve casos preexistentes —D01, D12,
D13, I4, ID02, ID03, ID04, MK02, MK03— fijaban por número cuántos stores trae
el manifiesto (24, 25, 23) y que el conjunto de `kind` era `{sqlite, json}`.
Las dos entradas de topología desplazan todos esos conteos, así que fallaban
sobre código correcto: la aserción codificaba el contrato anterior.

Se corrigió en `1201c51` expresándolos como `<datos> + TOPOLOGY_STORE_COUNT`
en lugar de un número nuevo, para que siga leyéndose que la cifra de stores de
**datos** no cambió y que el único delta es la topología. Un store de datos
perdido en silencio sigue rompiendo la aserción, que es exactamente para lo que
existe. `D12` ganó además la comprobación que faltaba: que la topología
sobrevive a un **restore real de restic** y vuelve byte-idéntica, no sólo que
aparece en el manifiesto.

## 5. Backup controlado

Una sola corrida del mecanismo canónico, lanzada por su propia unit systemd y
con su lock normal. Ni una segunda «para confirmar».

```text
run_id     structured-20260903T235012Z-2a314fe0
snapshot   02e66630
inicio     2026-09-03T23:50:12Z
fin        2026-09-03T23:50:25Z   (13 s)
resultado  ok  (ExecMainStatus=0)
stores     28  ->  sqlite: 5 | json: 21 | topology: 2
```

Entradas de topología en el manifiesto:

| `logical_path` | bytes | `sha256` | método |
|---|---|---|---|
| `topology/docker-compose.yml` | 4981 | `3765c4e7…21156` | `file_copy` |
| `topology/docker-compose.override.yml` | 4493 | `5a6f3d7a…b9f778` | `file_copy` |

Ambas con `integrity_result: ok`, `category: CFG`, `status: included`. Los
tamaños coinciden exactamente con los archivos vivos.

Control negativo sobre el manifiesto real: **cero** entradas que contengan
`.env` o `bak-pre-`.

### 5.1 Confirmación desatendida (cadencia normal, no provocada)

Once minutos después, el timer disparó su corrida ordinaria. **No la lancé yo**:
es la cadencia de siempre, ejecutando ya el runner nuevo sin supervisión.

```text
run_id     structured-20260904T000132Z-ea67545a
inicio     2026-09-04T00:01:32Z
fin        2026-09-04T00:01:45Z   (13 s)
resultado  ok  (ExecMainStatus=0)
stores     28, con topology/docker-compose.yml y topology/docker-compose.override.yml
```

Importa porque el despliegue del runner puso código nuevo en la ruta que un
timer ejecuta sin nadie mirando. Que la primera corrida automática saliera
`ok` cierra ese riesgo con evidencia, no con confianza.

## 6. Restore aislado y comparación por hash

Directorio temporal creado con `mktemp -d`, y restore acotado con
`--include '*/topology/*'`: **sólo los dos Compose**, ningún store, ningún
upload.

```text
restic restore 02e66630 --target <mktemp -d> --include '*/topology/*'
rc=0   restaurados: 2 archivos
```

| Archivo | `sha256` vivo | `sha256` restaurado | |
|---|---|---|---|
| `docker-compose.yml` | `3765c4e7…21156` | `3765c4e7…21156` | **byte-idéntico** |
| `docker-compose.override.yml` | `5a6f3d7a…b9f778` | `5a6f3d7a…b9f778` | **byte-idéntico** |

Los dos hashes coinciden además con los del manifiesto: manifiesto, snapshot y
archivo vivo son consistentes entre sí.

Invariantes verificados **después** del restore:

```text
permisos vivos sin modificar    docker-compose.yml           600 root:root
                                docker-compose.override.yml  644 root:root
mtime de ambos vivos            sin cambio
aplicado a /opt/chibaleteplus   NADA
contenedores recreados          NINGUNO (4/4 healthy, RestartCount=0)
snapshots borrados              NINGUNO
```

El directorio temporal se eliminó validando antes su ruta exacta: `realpath`,
comprobación de que es un directorio, de que no es un symlink y de que coincide
con el patrón `/tmp/chp-topology-restore-??????` de esta unidad. Sin esa
validación no se borra nada.

## 7. Límites y rollback del runner

Esta unidad **no** modifica timers, units, credenciales, repositorio restic ni
política de retención. No ejecuta `check`, `forget`, `prune`, `unlock` ni
`restic init`. No toca `data/`, `data-critical/`, `public/uploads/`, el deploy
backend, los mounts del frontend ni los dos scripts manuales de backup, que
siguen respaldando sólo la base.

Rollback del runner: se respaldan los archivos que se reemplazan, con sus
hashes, y ante divergencia o fallo se restaura la versión anterior de
inmediato.

Se desplegaron **dos módulos** bajo `/opt/chibalete-backup/runners/`,
extraídos del commit exacto `1201c51` con `git show`, de modo que lo que corre
en producción es literalmente el contenido de ese commit:

| Archivo | `sha256` anterior (respaldado) | `sha256` desplegado = commit |
|---|---|---|
| `chibalete_backup/stores.py` | `d25bb6a9…a5561` | `3bdad9ef…d31c6` |
| `structured_backup.py` | `0117729e…b9973` | `30049b83…21b9c` |

Respaldo de la versión anterior:
`/root/chp-backup-topology-01b/runner-rollback-20260903T234942Z/`

Rollback: copiar esos dos archivos de vuelta. No requiere reconstruir nada, no
toca el repositorio restic y no depende de este commit.

Permisos y propietario sin cambio (`644 root:root`), sintaxis validada en el
propio VPS con `python3 -m py_compile`.

## 8. Lo que esto no resuelve

- Los dos mecanismos manuales (`backup-vps.sh` y `scripts/backup.sh`) siguen
  copiando sólo la base. No se tocaron: quedan como deuda separada.
- El flujo de deploy **backend** de `deployment_guide.md` §12 sigue apuntando al
  compose base para respaldar antes de editar, con el mismo defecto que se
  corrigió en el flujo frontend. Fuera de alcance, registrado aparte.
- `deployment_guide.md` §3 sigue describiendo `chibalete_front` sin mounts,
  cuando tiene seis de sólo lectura. Fuera de alcance.

## 9. Estado de la cobertura

La matriz que `01A` dejó en **0 de 5** para el override queda así:

| Componente | Base | Override |
|---|---|---|
| Selección de backup | **sí**, canónico | **sí**, canónico |
| Presencia en último snapshot | **sí** (`02e66630`) | **sí** (`02e66630`) |
| Recuperación legible | **sí**, byte-idéntica | **sí**, byte-idéntica |
| Restore documentado | **sí** (`deployment_guide.md` §7.1.8) | **sí** |
| Restore ensayado | **sí** (esta unidad + `D12` en CI) | **sí** |

RPO de la topología efectiva: pasa de **infinito** a la cadencia del backup
canónico (~24 h, con corridas cada 6 h).

## 10. Único siguiente paso

Volver al objetivo principal de campaña: **designar responsables concretos por
institución y aprobar fechas reales**, para poder construir el inventario
físico. Es una decisión humana. La campaña sigue
`AMBER-CAMPAIGN-NOT-YET-AUTHORIZED`.
