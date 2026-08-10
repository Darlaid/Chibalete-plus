# CHP-IDDB-02B-B-H2 — `identity.db` en WAL bajo el sandbox de backup

**Cambio:** una línea en `structured-backup.service`.

```diff
+ReadWritePaths=/var/www/chibalete/identity
```

**Por qué:** sin ella, la captura de `identity.db` falla en un escenario
concreto y alcanzable en cuanto la base empiece a operar en WAL.

---

## 1. El mecanismo

`structured-backup.service` corre con `ProtectSystem=strict`: todo el
filesystem queda montado de solo lectura salvo lo declarado en
`ReadWritePaths`. Es el kernel quien lo aplica, así que **ser root no lo
esquiva** — `CAP_DAC_READ_SEARCH` permite leer lo que sea, no escribir sobre
un montaje de solo lectura.

Un lector de una base SQLite en WAL necesita el índice de memoria compartida
`<db>-shm`. Este servicio ya declaraba `data/` y `data-critical/` en
`ReadWritePaths` justamente por eso (README §6 de CHP-BACKUP-01B). `identity/`
no estaba en la lista porque, cuando se escribió el unit, la base no existía.

Hoy existe y está en `journal_mode=delete`, así que la captura funciona sin
sidecars. Pero `server/db/identityDb.js:47` fija `journal_mode = WAL` al abrir
la base: **en cuanto `IDENTITY_SQLITE_ENABLED` pase a `on`, identity.db estará
en WAL** y la captura pasará a depender del `-shm`.

## 2. Cuándo falla exactamente

La suposición inicial era que cualquier base en WAL rompería la captura bajo la
política antigua. **No es así.** Medido sobre copias de la base real, con el
confinamiento efectivo del servicio reproducido en units transitorias:

| Caso | Estado en disco | Política antigua | Política nueva |
|---|---|---|---|
| A | escritor vivo; `-wal` y `-shm` presentes | **PASS** | PASS |
| B | escritor caído; `-wal` y `-shm` huérfanos | **PASS** | PASS |
| C | `-wal` presente, **`-shm` ausente** | **FAIL** — `unable to open database file` | **PASS** |

La diferencia es si el lector puede **reutilizar** un `-shm` existente o tiene
que **crearlo**. Reutilizarlo no requiere permiso de escritura sobre el
directorio; crearlo, sí.

El caso C no es hipotético: aparece cuando queda un `-wal` sin su `-shm`, algo
que puede producirse tras una parada no limpia seguida de limpieza parcial de
sidecars, o al restaurar una base desde backup. Y cuando aparece, la captura
falla **precisamente cuando la base ya contiene escrituras que solo viven en el
WAL** — es decir, en el peor momento posible.

En el caso C bajo la política nueva se comprobó que el `-shm` se crea dentro del
directorio autorizado, y que la copia resultante es válida.

## 3. Alcance de la autorización

Solo el directorio dedicado de identidad:

```
ReadWritePaths=/var/backups/chibalete-backup
ReadWritePaths=/var/www/chibalete/data
ReadWritePaths=/var/www/chibalete/data-critical
ReadWritePaths=/var/www/chibalete/identity      ← nuevo
ReadOnlyPaths=/var/www/chibalete/public/uploads
```

**Nunca `/var/www/chibalete`.** Autorizar el árbol web completo pondría en
escritura `uploads/`, `server/`, `public/` y todo lo demás para un proceso cuyo
único trabajo es leer stores. El caso IW01 de la suite lo prohíbe explícitamente
y fija la allowlist exacta.

Lo que **no** cambia: `ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`,
`PrivateDevices`, `ProtectHome`, `CapabilityBoundingSet`, `AmbientCapabilities`
vacío, `SystemCallFilter`, usuario y grupo, `ExecStart`, destino del backup,
retención y rutas de los demás stores. El caso IW02 verifica que el hardening
sigue intacto: el arreglo no se consiguió aflojando el sandbox.

Tampoco cambian los permisos de filesystem: el directorio sigue en `0700
root:root` y la base en `0600 root:root`. Esto es política de sandbox, no de
filesystem.

## 4. Control negativo

Dentro del sandbox con la política nueva, los tres intentos de escritura fuera
de la allowlist fueron **denegados** con `EROFS`:

```
/var/www/chibalete/server-h2-escape        DENIED
/var/www/chibalete/public/uploads/h2-escape DENIED
/etc/h2-escape                              DENIED
```

Ampliar la allowlist a `identity/` no abrió ninguna otra ruta.

## 5. Cómo se probó

Sobre una copia en `/var/www/chibalete/identity/.h2-wal-test/` (root-only,
`0700`, temporal, fuera del inventario de stores). **La `identity.db` productiva
no se abrió en ningún momento**: hash y mtime idénticos antes y después, cero
`-wal`, cero `-shm`, cero descriptores.

La captura se ejecutó con el código real (`capture_sqlite` del runner
instalado), no con un doble. Sobre la copia producida bajo sandbox:

```
quick_check ok · integrity_check ok · foreign_key_check 0 violaciones
users 247 · institutions 4 · groups 4 · memberships 227 · tombstones 11
DOMAIN_LOGICAL_HASH 4237f6d2…  (idéntico al de H1)
```

La tabla sintética de sondeo aparece en la copia, lo que confirma que se
capturó el estado **con el WAL aplicado** y no solo el `.db` base.

## 6. Rollback

```bash
cp /root/chp-iddb-02b-b-h2/rollback/structured-backup.service.pre-h2 \
   /etc/systemd/system/structured-backup.service
systemctl daemon-reload
```

No reinicia nada: el servicio es `oneshot` y lo dispara un timer. Revertir
devuelve el fallo del caso C en cuanto la base pase a WAL.

## 7. Relación con 02B-C

Esta unidad era el último bloqueo operativo antes del shadow-write. Con la
allowlist en su sitio, `CHP-IDDB-02B-C` puede activar el canary de escritura en
espejo sobre `api_1` sabiendo que el backup seguirá capturando `identity.db`
cuando pase a WAL.

Lo que H2 **no** hace: no activa ningún flag, no escribe en `identity.db`, no
inicia shadow-write. La base sigue `PRESENT AND INERT` y la autoridad de lectura
sigue siendo JSON.
