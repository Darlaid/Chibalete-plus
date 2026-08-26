# CHP-BACKUP-TEST-SANDBOX-GUARD-01 — Harness de backup fail-closed

**Veredicto: `GREEN-BACKUP-TEST-SANDBOX-GUARD`**

Fecha de la ventana: 2026-08-26, 12:38Z–14:10Z.
Baseline: `19deb19`. Snapshot posterior al guard: `d84e2979`.

> ## ⛔ La suite de backup nunca se ejecuta directamente en un VPS productivo.
>
> Desde esta unidad, eso deja de depender de que alguien se acuerde: el harness
> **se niega a arrancar** si detecta marcadores de Chibalete+ en el host, y **no
> existe flag para saltárselo**.

Este GREEN no autoriza cargar recursos MOOK, crear v1 ni publicar.

---

## 1. Incidente que lo motiva

El 2026-08-26, durante CHP-BACKUP-MOOK-STORE-COVERAGE-01, la suite se ejecutó
fuera de su contenedor sobre el VPS productivo:

- el caso 19 escribió lastre en la ruta **absoluta y hardcodeada `/fullfs`**
  hasta agotar el dispositivo: **48,4 GB**, disco raíz al 100 %;
- los 4 containers de la aplicación quedaron `unhealthy` (ninguno se reinició);
- la ejecución **programada** de `structured-backup` de las 12:01:59Z falló con
  exit 1 (ENOSPC al crear el staging) — falló **cerrada**, sin snapshot parcial;
- se resolvió borrando el lastre; **cero pérdida de datos**.

Y había una segunda bomba que no llegó a estallar: `run_all.sh` copiaba los
runners a `$INSTALL_DIR`, cuyo valor por defecto era **`/opt/chibalete-backup`**
— la instalación real del runner en el VPS.

### Causa

Cuatro rutas absolutas hardcodeadas en el harness, más una variable de entorno
que permitía redirigirlo a cualquier sitio:

| Constante | Valor | Qué pasaba fuera del contenedor |
|---|---|---|
| `FULLFS` | `/fullfs` | tmpfs de 1 MB en el sandbox; **el disco real** fuera de él |
| `LOWSPACE` | `/lowspace` | ídem; fuera del sandbox el caso ni siquiera medía lo que decía medir |
| `LOWINO` | `/lowino` | ídem |
| `WORK_ROOT` | `/work/tests`, redirigible con `CHP_TEST_ROOT` | escribía donde le dijeran |
| `INSTALL_DIR` | `/opt/chibalete-backup` | **sobrescribía la instalación productiva** |

`CHP_TEST_ROOT` no protegía nada: apuntarla a otro sitio no movía `/fullfs`,
`/lowspace`, `/lowino` ni `INSTALL_DIR`, que seguían siendo absolutas.

---

## 2. Superficies peligrosas auditadas

| Ruta / operación | Riesgo | Guard aplicado |
|---|---|---|
| `/fullfs` + `fill_filesystem()` | llenar el disco del host | **retirados**; ENOSPC por inyección determinista |
| `/lowspace`, `/lowino` | resultados falsos y escritura fuera de caja | **retirados**; `os.statvfs` parcheado en el hijo |
| `CHP_TEST_ROOT` | redirección a ruta arbitraria | **eliminada**: su sola presencia aborta |
| `WORK_ROOT` absoluto | escritura fuera de caja | deriva del sandbox creado por el runner |
| `INSTALL_DIR=/opt/chibalete-backup` | sobrescribir el runner productivo | `<SANDBOX>/opt/chibalete-backup` |
| `UNITS_TMP=/work/units-standalone` | escritura fuera de caja | `<SANDBOX>/units-standalone` |
| `shutil.rmtree` en `fresh()` | borrado con ruta no validada | `safe_rmtree` + `assert_path_allowed` |
| `rm -rf "$VAR"` en `run_all.sh` | borrado con variable vacía | prefijo + marcador comprobados antes |
| `cp -r` sobre instalación real | pisar runners productivos | destino dentro del sandbox |
| Ejecutar runners productivos | efectos sobre `/var/www/chibalete` | el guard de host aborta antes |
| `/var/www/chibalete`, `data/`, `data-critical/`, uploads, repos restic reales | pérdida de datos | marcadores de host + lista de rechazo |

`test_capacity.py` ya usaba `tempfile.TemporaryDirectory()`: no requería cambios.

---

## 3. Diseño del guard

Todo vive en `ops/backup/CHP-BACKUP-01B/tests/sandbox.py`. **El código de
producción no se tocó**: el guard es del harness, no del runner.

### Guard de host — sin bypass

Antes de la primera escritura se comprueban los marcadores canónicos:

```text
/var/www/chibalete   /opt/chibalete-backup   /etc/chibalete-backup
/opt/chibaleteplus   /var/backups/chibalete-backup
```

Si **cualquiera** existe, el harness aborta (exit 2) sin crear nada. No se
consulta ninguna variable de entorno para decidirlo — el caso GS02 verifica por
inspección del propio código fuente que la función no lee `environ`, para que
nadie añada un bypass sin romper un test.

### Sandbox obligatorio

`create_sandbox()` produce `/tmp/chp-backup-tests.<aleatorio>` con `mkdtemp`,
resuelto con `realpath`, no symlink, con marcador único `.chp-backup-sandbox`
(UUID), fuera del repo y de `/opt`, `/var`, `/root`, `/etc`, `/usr`.

`assert_path_allowed()` valida **todo** destino y rechaza: rutas vacías, no
textuales, relativas, prohibidas, ascendientes de prohibidas, traversal con
`..`, symlinks que escapen y cualquier cosa fuera del root.

> Detalle que costó un intento: `/` está en la lista de prohibidas, pero **toda**
> ruta absoluta cuelga de la raíz. Compararla como prefijo rechazaba también el
> sandbox. De `/` solo se prohíbe la coincidencia exacta.

`CHP_TEST_ROOT` deja de existir: definida —aunque sea vacía— aborta.

### Instalación simulada

`simulated_install_dir()` materializa `<SANDBOX>/opt/chibalete-backup` con una
copia de los runners, que es lo que `systemd-analyze` necesita para resolver el
`ExecStart` de las units. La ruta real nunca se toca.

### Cleanup con doble llave

`destroy_sandbox()` exige **prefijo correcto Y marcador presente**, y vuelve a
pasar la lista de rechazo. `safe_rmtree()` valida igual antes de borrar. Nunca
se usa una variable suelta como destino destructivo, ni en Python ni en Bash.

---

## 4. ENOSPC sin lastre

El escenario de disco lleno se reproduce ahora por **inyección de fallos
determinista**, sin escribir un solo byte:

| Escenario | Antes | Ahora |
|---|---|---|
| Espacio insuficiente (caso 05) | tmpfs `/lowspace` de 1 MB | `sitecustomize` inyectado por `PYTHONPATH` que parchea `os.statvfs` en el **proceso hijo** y reporta 1 bloque libre |
| Inodos agotados (caso 06) | tmpfs `/lowino` (`nr_inodes=20`) | ídem, con `f_favail` mínimo y espacio de sobra |
| ENOSPC de restic (caso 19) | llenar `/fullfs` con lastre | `restic` de pega primero en el `PATH`, que responde a `version` y falla en todo lo demás con *no space left on device* |

El camino de código ejercitado es el mismo: `check_capacity` sigue leyendo
`os.statvfs` de verdad y `Restic.run` sigue clasificando un fallo real del
subproceso. Lo que desaparece es el lastre.

Se aceptó un matiz de fidelidad en el caso 19: el binario es de pega, así que se
prueba la propagación del error, no restic contra un dispositivo lleno de
verdad. A cambio es determinista y no puede volver a tocar el disco del host.

### Presupuesto de disco

`DISK_BUDGET_BYTES = 100 MB`, medido con `tree_bytes()` al terminar y reportado
siempre. Si se supera, **la suite falla**.

Consumo real medido: **47,7 MB** (de 100 MB), estable en ejecuciones repetidas.

---

## 5. Pruebas

Suite completa en contenedor efímero, sin mounts productivos:

```text
=== RESUMEN: 105/105 PASS ===
SUITE_RESULT=GREEN
disco usado por la suite: 50053268 B (47.7 MB de 100 MB)
```

| # | Requisito | Caso | Resultado |
|---|---|---|---|
| 1 | Ejecución normal en sandbox | GS01 | ✅ root marcado, resuelto, fuera del repo y de rutas del sistema |
| 2 | Host productivo → aborta antes de escribir | GS02 + prueba de `run_all.sh` | ✅ exit 2, **0 entradas creadas en `/opt`, 0 sandboxes** |
| 3 | `CHP_TEST_ROOT=/` | GS03 | ✅ rechazado en Python y en Bash |
| 4 | `CHP_TEST_ROOT=/opt/chibalete-backup` | GS04 | ✅ rechazado |
| 5 | Symlink a ruta prohibida | GS05 | ✅ rechazado por `realpath`; el symlink no se borra |
| 6 | Traversal `../` | GS06 | ✅ rechazado; un `..` que se queda dentro sigue siendo válido |
| 7 | Variable vacía | GS07 | ✅ `""`, espacios, `None`, `0` y rutas relativas rechazadas |
| 8 | Cleanup sin marcador | GS08 | ✅ no borra; el testigo sobrevive |
| 9 | Cleanup con prefijo incorrecto | GS09 | ✅ no borra; ninguna ruta crítica declarada es borrable |
| 10 | ENOSPC sin lastre | GS10 | ✅ crecimiento < 8 MB, **0 ficheros de lastre** |
| 11 | Consumo dentro del límite | `[DISK]` | ✅ 47,7 MB de 100 MB |
| 12 | `/opt/chibalete-backup` real intacto | GS11 + verificación en VPS | ✅ hashes = blobs de `4b13d2e` |
| 13 | Stores y fuentes byte-idénticos | verificación en VPS | ✅ |
| 14 | Cobertura funcional mantenida | suite completa | ✅ 105/105 (antes 83/86 con 3 rojos) |
| 15 | Segunda ejecución sin residuos | dos runs seguidos | ✅ `/tmp` con **0 entradas** tras cada uno |

Control de regresión **GS12**: falla si la ruta de lastre vuelve como literal
operativo. Analiza el **AST**, no el texto, de modo que los comentarios y
docstrings que explican el incidente no cuentan (no existen para el AST) y solo
se detecta la ruta usada como dato. Las únicas apariciones toleradas son las
listas de rechazo del propio guard.

### Rojos preexistentes: resueltos

Los 3 rojos que arrastraba la suite (`L07`, `P24`, `S1`) tenían una causa común:
tres comprobaciones iteraban `systemd/` tratando cada entrada como archivo y
reventaban con `IsADirectoryError` desde que existe `systemd/dropins/`. Se
añadió `systemd_unit_files()`, que salta subdirectorios. La suite pasa de
**83/86 con 3 rojos** a **105/105**.

### Nota sobre el usuario no root

§8 pedía «preferiblemente como usuario no root». **No es alcanzable sin
debilitar el contrato de seguridad**: el runner exige que `backup.env` y
`restic-password` sean `root:root 0400`, así que los fixtures tienen que hacer
`chown` a root. Ejecutada como usuario normal, la suite da 32/105 con
`PermissionError` en cada `chown` — comprobado, no supuesto.

La alternativa elegida es el aislamiento, que era el objetivo real: contenedor
efímero, sin mounts productivos, que muere con el job.

---

## 6. Aplicación operativa

**La suite NO se ejecutó en el VPS.** Todas las pruebas corrieron en containers
desechables (`python:3.12-slim` y `ubuntu:24.04`) con el repositorio montado en
solo lectura y sin ningún mount productivo.

En `/opt/chibalete-backup` **no hay copia del harness** — solo `runners/`,
`config/`, `rollback/` y `README.md` —, así que no había nada que reinstalar.
Los runners productivos **no se modificaron** en esta unidad: el guard vive
íntegramente en `tests/`.

Verificado en el VPS, read-only:

| Comprobación | Resultado |
|---|---|
| `stores.py`, `manifest.py`, `preflight.py`, `structured_backup.py` | hashes = blobs de `4b13d2e` |
| Resto del runner (14 ficheros) | byte-idéntico a la copia de rollback |
| `ExecStart` del timer | `/opt/chibalete-backup/runners/structured_backup.py` |
| Containers | 4/4 healthy, `RestartCount=0`, ninguno reiniciado |

### Backup canónico posterior (no la suite)

| Paso | Resultado |
|---|---|
| `structured-backup.service` | exit 0 — snapshot **`d84e2979`**, **26 stores**, 37 ficheros |
| `mook_db.json` | incluido, 1396 B, `integrity_result: ok`, `sensitivity: minors` |
| `backup-verify.service` | exit 0 — `restic check` ok, 238 snapshots, **204 manifiestos, 0 problemas** |
| Disco | 45 GB libres, estable |
| Stores | `content.json` `082a971c…` y `mook_db.json` `d69a8f34…` sin cambio |
| Uploads | 95 |
| Edge | 12/12 respuestas 200 |

El backup programado vuelve a estar sano: la única ejecución fallida fue la de
las 12:01:59Z durante el disco lleno; las posteriores son exit 0. Próximo
disparo del timer sin cambios.

---

## 7. CI

Se añade el job `backup-suite-sandboxed` a `.github/workflows/backup-capacity.yml`:

- corre **dentro de un contenedor efímero** (`ubuntu:24.04`), sin mounts
  productivos, que muere con el job;
- comprueba explícitamente que el entorno de CI **no** tiene marcadores de
  Chibalete+ ni `CHP_TEST_ROOT`, antes de ejecutar nada;
- ejecuta la suite completa, que aplica su propio guard, su presupuesto de
  100 MB y su cleanup;
- verifica al final (`if: always()`) que **no queda ningún sandbox** en `/tmp`.

Validado primero en una imagen equivalente a la del runner (`ubuntu:24.04` con
`restic` y `systemd`) y después **en CI de verdad** (`dc38f04`):

```text
entorno limpio
sandbox: /tmp/chp-backup-tests.97fvk8st
=== RESUMEN: 105/105 PASS ===
SUITE_RESULT=GREEN
disco usado por la suite: 50151233 B (47.8 MB de 100 MB)
sandboxes restantes: 0
```

`test:content-rmw` **no** se mezcla aquí: es el gate siguiente.

### CI estaba en rojo y no lo vi

`backup-capacity` llevaba fallando desde `19deb19`, el commit que cerró la
unidad anterior. Causa: el ratchet `PROTECTED_DATA_SCOPE_UNCHANGED` de
`test_capacity.py` fija a mano el número de stores del scope protegido, y añadir
`data/mook_db.json` lo subió de 25 a 26 sin actualizar el literal.

Lo pasé por alto porque en aquella unidad ejecuté `test_suite.py` pero **no**
`test_capacity.py`, y consulté el CI solo del commit de deploy, no del de
backup. Corregido en `dc38f04`: se sube el contador **y** se añade
`mook_db.json` a la lista de rutas que el guard exige cubrir — subir el número
sin lo segundo dejaría el ratchet contando cajas vacías.

Que el job nuevo ejecute la suite completa en CI cierra justamente ese hueco:
a partir de ahora un cambio en `ops/backup/**` no puede quedarse rojo sin que se
vea.

---

## 8. Rollback

El cambio es de harness y de CI; no toca datos, runners productivos ni
containers.

- Revertir `ops/backup/CHP-BACKUP-01B/tests/` y el job de CI al estado de
  `19deb19` devuelve el comportamiento anterior.
- **No es recomendable**: revertir reintroduce las rutas absolutas y la
  posibilidad de volver a llenar el disco del VPS.
- Todos los snapshots se conservan (`3606e841`, `0549ee9d`, `2be3ecb1`,
  `d84e2979`). No se restauran datos. La copia de emergencia de
  `/root/chp-content-rmw-02/pre-deploy/` y el rollback del runner en
  `/root/chp-backup-mook-01/rollback-pre-4b13d2e/` siguen intactos.

---

## 9. Riesgo residual conocido

En el VPS hay **~22 árboles de build históricos** bajo `/root/` (y uno en
`/tmp/integ`) de unidades anteriores, cada uno con una copia **sin proteger**
del harness: `/root/chp-build-ffc90a1/…`, `/root/chp-iddb-*/…`,
`/root/chp-content-rmw-02/build/src/…`, etc.

Son fotos congeladas del repositorio en su momento, y por tanto siguen
conteniendo el `fill_filesystem` original y el `INSTALL_DIR` apuntando a la
instalación real. **Ejecutar cualquiera de ellas reproduce el incidente.**

No se han borrado en esta unidad: son evidencia de despliegues anteriores y
eliminarlos no está autorizado aquí. Queda como
**CHP-BACKUP-STALE-BUILD-TREES-01**: revisar y retirar los árboles de build que
ya no sirvan de evidencia. Mientras tanto, la regla operativa es la del
encabezado: la suite se ejecuta en contenedor, nunca en el VPS.

---

## 10. Estado del MOOK

Sin cambios. Experience `exp-1787709803882-9ym4tt` en DRAFT, `currentVersionId`
nulo, 22 recursos, 0 versiones/runs/evidencias/publicaciones, 95 uploads con los
13 activos editoriales huérfanos preservados. Este GREEN **no autoriza** cargar
recursos, crear v1 ni publicar.

---

## 11. Próximo paso

El gate siguiente es `test:content-rmw`, que hoy **no corre en ningún
workflow**: la prueba de concurrencia de dos réplicas solo existe si alguien la
ejecuta a mano en Linux. Llevarla a CI con el mismo criterio de aislamiento es
la continuación natural de esta unidad.
