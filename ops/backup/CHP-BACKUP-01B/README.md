# CHP-BACKUP-01B — Runners de backup granular (implementación local)

> **Estado:** implementado y validado **localmente** contra restic real en el
> toolchain Linux aislado. **NO instalado, NO activado, NO ejecutado contra
> producción.** La provisión de credenciales, el `restic init` contra Backblaze
> B2 y la activación de timers pertenecen a unidades posteriores.
>
> Autoridad: `CHP-BACKUP-01A/BACKUP_INVENTORY.md`, `BACKUP_DESIGN.md`,
> `DEST_DECISION.md` y `BACKUP_01B_DESIGN.md`. Ante discrepancia, prevalecen las
> aclaraciones más recientes de los dos últimos.

## 1. Qué hay aquí

```
CHP-BACKUP-01B/
├── BACKUP_01B_DESIGN.md         diseño vinculante (previo, no modificado)
├── README.md                    este documento
├── config/
│   └── backup.env.example       plantilla SIN valores reales
├── runners/
│   ├── structured_backup.py     runner A — SQLite + JSON + manifiesto
│   ├── uploads_backup.py        runner B — uploads incrementales directos
│   ├── verify_backup.py         runner C — verificación no destructiva
│   └── chibalete_backup/        paquete (stdlib de Python 3.12, sin deps)
│       ├── config.py            contrato de configuración y secretos
│       ├── preflight.py         espacio, inodos, herramientas, rutas
│       ├── locking.py           lock compartido + staging + señales
│       ├── sqlite_capture.py    Online Backup API
│       ├── json_capture.py      copia atómica + validación
│       ├── manifest.py          manifiesto versionado y auditado
│       ├── restic.py            allowlist NO destructiva + contrato de estados
│       ├── s3_preflight.py      preflight S3 firmado (SigV4) y fail-closed
│       ├── safelog.py           logging con redacción obligatoria
│       ├── stores.py            inventario declarativo de stores
│       └── errors.py            errores tipados y códigos de salida
├── systemd/                     6 units (no instaladas, no activadas)
└── tests/
    ├── fixtures.py              generadores 100% sintéticos
    ├── test_suite.py            66 casos (24 obligatorios + integración restic
    │                            + 28 de preflight S3 + 8 de cierre del init)
    └── run_all.sh               orquestador de validación
```

Sin dependencias nuevas: solo la stdlib de Python 3.12. **No** usa el
`node_modules` de la aplicación ni toca su código.

## 2. Cómo validar (única forma soportada)

Siempre dentro del toolchain Linux aprobado en CHP-BACKUP-01B-0, **offline** y
con el repositorio montado en solo lectura:

```bash
export MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1   # solo en Git Bash/MSYS

docker run --rm \
  --pull never --network none --read-only \
  --security-opt no-new-privileges --pids-limit 256 --cpus 2 --memory 1g \
  --env-file /ruta/a/un/archivo/vacio.env \
  -v "/ruta/al/repo:/repo:ro" \
  --tmpfs /tmp:rw,size=64m \
  --tmpfs /work:rw,size=400m \
  --tmpfs /lowspace:rw,size=1m \
  --tmpfs /lowino:rw,size=8m,nr_inodes=20 \
  --tmpfs /fullfs:rw,size=1m \
  --tmpfs /opt/chibalete-backup:rw,size=32m \
  --workdir /work \
  sha256:f6429abca40d53d40b8feab764a91d2f766635016b98cdfc692b072e8f2656b8 \
  bash /repo/ops/backup/CHP-BACKUP-01B/tests/run_all.sh
```

Los tmpfs auxiliares no son decorativos: `/lowspace` y `/fullfs` producen
**ENOSPC real** y `/lowino` (`nr_inodes=20`) produce **agotamiento real de
inodos**. Esos dos casos no se simulan con dobles.

Resultado esperado: `VALIDACION GLOBAL: GREEN` y `SUITE_RESULT=GREEN`.

## 3. Contrato de configuración

Dos archivos, ambos **`root:root 0400`**, fuera de Git y del árbol web:

| Archivo | Contenido |
|---|---|
| `/etc/chibalete-backup/backup.env` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` |
| `/etc/chibalete-backup/restic-password` | **solo** la passphrase |

El runner falla cerrado si: falta un archivo, el modo no es `0400`, el
propietario no es `root:root`, hay un symlink, falta una variable obligatoria,
aparece una clave no permitida (`RESTIC_PASSWORD`, `B2_ACCOUNT_ID`,
`B2_ACCOUNT_KEY`, cualquier otra), o `RESTIC_PASSWORD_FILE` no apunta
exactamente a `<config_dir>/restic-password`.

No lee el `.env` del proyecto. No acepta la passphrase por argumento. No tiene
fallbacks. No imprime ningún valor.

Los flags `--config-dir`, `--base-dir`, `--work-dir` y `--lock-path` existen
para ejercitar el contrato con rutas sintéticas en las pruebas; **las units no
los pasan** y quedan ocultos de la ayuda.

## 4. Códigos de salida

| Código | Significado |
|---|---|
| 0 | correcto |
| 10 | configuración/secretos inválidos o con permisos inseguros |
| 11 | preflight fallido |
| 12 | espacio o inodos insuficientes en staging |
| 13 | otra ejecución tiene el lock (aborto limpio) |
| 14 | integridad de SQLite no demostrada |
| 15 | JSON inválido |
| 16 | error de restic |
| 17 | subcomando destructivo rechazado |
| 18 | destino no vacío que no es un repositorio restic |
| 19 | ruta fuente obligatoria ausente |
| 21 | verificación: RPO excedido o sin snapshots |
| 22 | verificación: manifiesto inválido |
| 23 | prefijo aprobado vacío y **primer init no autorizado** (estado normal de los timers) |
| 24 | preflight S3 bloqueado (acceso, bucket, endpoint/región, red/TLS, estado desconocido) |
| 25 | la credencial puede listar fuera del prefijo aprobado, o su alcance no se pudo demostrar |
| 130 | interrumpido (SIGTERM/SIGINT), con limpieza completada |

## 4-bis. Preflight S3 y primer `restic init` (CHP-BACKUP-01B-1-R3)

`restic cat config` contra un backend remoto no distingue «prefijo vacío» de
«acceso denegado», «bucket inexistente» o «endpoint equivocado». Con esa
ambigüedad el destino quedaba siempre en `unknown` y **un prefijo S3 vacío no
podía inicializarse nunca**. Se resuelve con evidencia positiva, no con texto.

### Contrato de estados (`s3_preflight.RemoteState`)

| Estado | Cómo se determina | Efecto |
|---|---|---|
| `EXISTING_REPOSITORY` | `restic cat config` termina con rc 0 | continúa, sin init |
| `EMPTY_APPROVED_PREFIX` | **solo** ListObjectsV2 firmado con `KeyCount == 0` bajo `restic-prod/` | init **si** hay autorización manual |
| `FOREIGN_OBJECTS_PRESENT` | hay ≥1 objeto y no hay repositorio legible (incluye restos de init parcial) | bloquea (18) |
| `ACCESS_DENIED` | 401/403 o `AccessDenied`/`InvalidAccessKeyId`/`SignatureDoesNotMatch` | bloquea (24) |
| `BUCKET_NOT_FOUND` | 404 o `NoSuchBucket` | bloquea (24) |
| `ENDPOINT_OR_REGION_MISMATCH` | 3xx, `PermanentRedirect`, `AuthorizationHeaderMalformed`… | bloquea (24) |
| `NETWORK_OR_TLS_ERROR` | timeout, conexión rechazada, fallo TLS | bloquea (24) |
| `INVALID_LOCAL_CONFIGURATION` | endpoint/región/bucket/prefijo no coinciden con el destino aprobado | bloquea (10) |
| `UNKNOWN_REMOTE_STATE` | XML ilegible o incoherente, 5xx, otro backend remoto, contradicción con restic | bloquea (24) |
| `EMPTY_LOCAL_DIRECTORY` | backend de **filesystem** vacío o inexistente | init **si** hay autorización manual |

Reglas duras:

- `EMPTY_APPROVED_PREFIX` **solo** puede proceder del listado S3 autenticado.
  Ningún mensaje de `stderr` de restic puede producirlo. El `stderr` se reduce a
  una etiqueta de un conjunto cerrado (`wrong_password`, `config_absent`,
  `access_denied`, …) y se usa únicamente para **contradecir** un «vacío»
  sospechoso, nunca para afirmarlo.
- Cualquier anomalía de autorización, bucket, endpoint, red, TLS, XML o 5xx es
  bloqueante. No hay ruta que la convierta en «vacío».
- El preflight valida **antes de tocar la red**: HTTPS obligatorio (el texto
  plano solo se admite contra loopback literal, para el servidor sintético de
  las pruebas), endpoint S3-compatible de la región declarada, bucket exacto y
  prefijo exactamente `restic-prod`.
- Solo stdlib (`hashlib`, `hmac`, `http.client`, `ssl`, `urllib`, `xml`). Sin
  boto3, awscli, rclone, s3cmd ni mc. Las credenciales viajan únicamente en la
  cabecera `Authorization` (AWS Signature V4): nunca en argv, nunca en archivos
  temporales, nunca en logs. Del preflight solo sale una estructura sanitizada
  (estado, status HTTP y un `<Code>` con forma validada): jamás el cuerpo.
- El preflight emite **un solo GET** (`ListObjectsV2`). No escribe, no borra y
  no crea objetos, tampoco en la sonda de alcance.

### Autorización de primer init (uniforme para S3 y filesystem)

**Ningún backend se autoinicializa.** La autorización manual
`--initialize-empty-repository` es obligatoria tanto para
`EMPTY_APPROVED_PREFIX` como para `EMPTY_LOCAL_DIRECTORY`: no existe ninguna
ruta —ni de configuración accidental de filesystem en producción— que permita
un `init` sin ella.

El primer `restic init` exige, **simultáneamente**:

1. configuración local que coincide exactamente con el destino aprobado;
2. destino demostrablemente vacío (para S3, `EMPTY_APPROVED_PREFIX` probado por
   el listado firmado);
3. ausencia de objetos ajenos;
4. **solo S3**: credencial que **no** puede listar fuera de `restic-prod/`
   (sonda de listado contra un prefijo de control inexistente: 401/403 ⇒ PASS;
   200 ⇒ BLOCK; cualquier otra cosa ⇒ BLOCK);
5. la autorización manual `--initialize-empty-repository`;
6. ejecución desde la orden manual de provisión, nunca desde un timer.

Tras el init se vuelve a ejecutar `restic cat config` y se exige
`EXISTING_REPOSITORY`. **La autorización no se persiste en ningún sitio y no se
lee del entorno**: es un flag `store_true` y nada más. Una segunda ejecución
encuentra el repositorio existente y no reinicializa.

Solo `structured_backup.py` expone el flag. `uploads_backup.py` y
`verify_backup.py` no pueden inicializar nada y rechazan el flag con código 2.
Las tres units systemd invocan su `ExecStart` **sin flags** y no declaran
`Environment=`, `EnvironmentFile=` ni `PassEnvironment=` (verificado por
prueba).

### Comandos exactos de la futura unidad de provisión

```bash
# 1. Provisión manual, UNA sola vez, con /etc/chibalete-backup ya instalado:
/usr/bin/python3 /opt/chibalete-backup/runners/structured_backup.py \
    --initialize-empty-repository

# 2. Confirmar idempotencia: la segunda ejecución NO reinicializa.
/usr/bin/python3 /opt/chibalete-backup/runners/structured_backup.py

# 3. Solo después: habilitar los timers.
```

Salidas esperadas del paso 1: `0` (init hecho y verificado) · `23` (falta la
autorización) · `24` (preflight bloqueado) · `25` (credencial demasiado amplia)
· `18` (objetos ajenos) · `10` (destino no aprobado).

### Rollback local

Los cambios de esta unidad son locales y no están commiteados:

```bash
git checkout -- ops/backup/CHP-BACKUP-01B/
rm -f ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/s3_preflight.py
```

## 5. Prohibiciones implementadas (no solo documentadas)

- **Cero retención destructiva.** `restic.py` mantiene una allowlist
  (`version`, `init`, `backup`, `snapshots`, `check`, `cat`, `stats`) y rechaza
  `forget` — incluso con `--dry-run` —, `prune`, `rm`, `remove`, `delete`,
  `unlock`, `repair`, `rewrite`, `migrate`, `recover` y las flags `--prune` /
  `--forget`. Verificado ejecutando los rechazos, no leyendo el código.
- **Cero duplicación de uploads.** El runner B pasa la ruta fuente a restic; el
  staging solo alberga el manifiesto. Comprobado midiendo el tamaño real del
  directorio de trabajo frente al volumen de uploads.
- **Cero tarball.**
- **Cero mutación de datos fuente.** Los `.db`, los JSON y los uploads quedan
  byte-idénticos (ver §6).
- **Cero secretos en logs, manifiestos o stdout/stderr.**
- **Cero init automático, para cualquier backend.** Ver §4-bis.

## 6. Hallazgo relevante: SQLite en WAL y `ReadOnlyPaths`

Un lector de una base SQLite en WAL **necesita crear o actualizar el índice de
memoria compartida `<db>-shm`** (y un `<db>-wal` de longitud cero si no
existe). Es comportamiento normal de SQLite y **no modifica el contenido**: los
`.db` quedan byte-idénticos, y así se verifica en cada ejecución de la suite.

Consecuencia operativa: `structured-backup.service` **no puede** declarar
`ReadOnlyPaths=/var/www/chibalete`. `ReadOnlyPaths` monta en solo lectura a
nivel de VFS y el kernel lo aplica aunque el proceso sea root, de modo que la
captura fallaría con `SQLITE_CANTOPEN`. Por eso esa unit declara
`ReadWritePaths` sobre `data/` y `data-critical/`, y mantiene
`public/uploads` en solo lectura. Las units de uploads y de verificación sí
usan `ReadOnlyPaths=/var/www/chibalete`: no abren ninguna base SQLite.

## 7. systemd

Seis units en `systemd/`, **no instaladas y no activadas**:

| Unit | Cadencia | Acción | Destructiva |
|---|---|---|---|
| `structured-backup.timer` | cada 6 h (`00,06,12,18:00`) | SQLite + JSON + manifiesto | no |
| `uploads-backup.timer` | diaria (`03:30`) | uploads incrementales | no |
| `backup-verify.timer` | semanal (dom. `05:00`) | `snapshots` + `check` | no |

Notas de instalación, para la unidad futura que las despliegue:

- Instalar con modo **0644** (`systemd-analyze` advierte si son ejecutables).
- El lock compartido `/run/chibalete-backup/lock` lo toma el propio runner con
  `flock(2)`. **No** envolver `ExecStart` con `flock(1)`: tomaría el mismo
  archivo desde otro proceso y el runner se bloquearía contra sí mismo.
- `BACKUP_01B_DESIGN.md` §10 nombra las units `chibalete-backup-*`. Aquí se usan
  los nombres literales del prompt de ejecución (`structured-backup.*`,
  `uploads-backup.*`, `backup-verify.*`). Si se prefiere el prefijo del diseño,
  renombrar al instalar y ajustar `Unit=` en los tres timers.
- No existe ninguna unit de retención, y no debe crearse hasta que
  CHP-BACKUP-01C esté GREEN y una unidad explícita lo habilite.

## 8. Lo que esta unidad NO hace

No crea cuentas ni buckets, no provisiona credenciales, no contacta Backblaze
ni el VPS, no despliega, no toca CI, no instala ni activa timers, no ejecuta
backups productivos y no restaura nada. La restauración aislada es
CHP-BACKUP-01C, y **el gate CHP-BACKUP-01 solo cierra tras ese ensayo**.
