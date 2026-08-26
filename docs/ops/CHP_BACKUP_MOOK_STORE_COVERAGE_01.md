# CHP-BACKUP-MOOK-STORE-COVERAGE-01 — Cobertura canónica y restaurabilidad de `mook_db.json`

**Veredicto: `GREEN-BACKUP-MOOK-STORE-COVERAGE`**

Fecha de la ventana: 2026-08-26, 11:50Z–12:35Z.
Commit del cambio: `4b13d2e`. Baseline: `29e8e8e`.
Snapshot nuevo: `2be3ecb1` (structured).

Este GREEN cierra únicamente la cobertura y la restaurabilidad de
`mook_db.json`. **No autoriza bridges, carga de recursos, creación de v1 ni
publicación.**

---

## 1. Causa del hueco

El inventario de backup es una lista declarativa
(`ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py`) redactada en
CHP-BACKUP-01A, **antes de que el MOOK existiera**. `data/mook_db.json` —el
store canónico de `experiences`, `versions`, `runs` y `evidence`— nunca se
añadió.

No fue una exclusión deliberada: los runners no llevan rutas hardcodeadas, así
que un store que no está en la lista sencillamente no se respalda, sin emitir
ninguna advertencia. El snapshot previo `3606e841` capturó **25 stores** y
ninguno era el del MOOK (demostrado en §3).

La copia local aditiva tomada durante CHP-CONTENT-STORE-RMW-02 mitigaba el
riesgo de aquella ventana concreta; no era cobertura canónica: vive en el mismo
host, no está cifrada, no entra en la rotación ni en la verificación.

---

## 2. Auditoría del mecanismo productivo

| Elemento | Valor |
|---|---|
| Script | `/opt/chibalete-backup/runners/structured_backup.py` |
| Allowlist | `/opt/chibalete-backup/runners/chibalete_backup/stores.py` (`JSON_STORES`) |
| Unidad | `structured-backup.service` (`Type=oneshot`) |
| Disparador | `structured-backup.timer` — cada 6 h |
| `ExecStart` | `/usr/bin/python3 /opt/chibalete-backup/runners/structured_backup.py` |
| Base de rutas | `DEFAULT_BASE_DIR = /var/www/chibalete` |
| Ruta canónica del store | `data/mook_db.json` → `/var/www/chibalete/data/mook_db.json` |
| Tag del snapshot | `structured` + `run_id` |
| Retención | **ninguna operación destructiva**: cero `forget`, cero `prune` (prohibición estructural de 01B) |
| Manifiesto | `/var/backups/chibalete-backup/manifests/<run_id>.json`, modo 0400 |

### Copia realmente ejecutada frente al repositorio

El job productivo **no se actualiza solo** al editar el repositorio: ejecuta la
copia instalada en `/opt`. Se compararon las dos antes de tocar nada:

- `json_capture.py`, `manifest.py`, `config.py`, `structured_backup.py`:
  hash idéntico;
- `stores.py`: hash distinto **solo por finales de línea** — el checkout de
  Windows es CRLF y la copia instalada es LF. Normalizado a LF, el hash coincide
  exactamente (`6626ddaa…`).

Es decir: sin deriva semántica, el repositorio es la fuente del script
productivo, pero **el despliegue es manual** (§5).

### Comportamiento con un archivo permitido que aún no existe

`resolve_sources` distingue por `required`:

- `required=True` y ausente → `SourceMissingError`, exit 19, el backup falla;
- `required=False` y ausente → se omite y **antes desaparecía del manifiesto sin
  dejar rastro**;
- presente pero JSON inválido → `JsonInvalidError`, exit 15, aborta **antes** de
  invocar restic;
- presente pero no es archivo regular o es symlink → `PreflightError`, exit 11.

Ese segundo caso era el problema de fondo para un store opcional: «todavía no se
ha creado» y «se perdió» producían manifiestos idénticos. Se corrige en §3.

---

## 3. El hueco, demostrado sobre el snapshot `3606e841`

El manifiesto de la ejecución previa lista 25 stores y `data/mook_db.json` no
está entre ellos:

```text
sqlite: events.db, progress.db, offline_assignments.db, insights.db, identity.db
json  : usuarios_colegios_oro, groups_db, access_db, schools_db, sections,
        school_configs, content, content_db, user_audit_log, analytics_db,
        leo_memory_db, leo_evidence_db, leo_interactions_db, users_db,
        progress_db, lu_config, leo_profile_db, interventions_db,
        submissions_db, users_db.backup.1773870779
```

20 JSON declarados, ninguno es el del MOOK. El nuevo snapshot trae **26**.

---

## 4. Corrección aplicada

Cambio mínimo en cuatro archivos. Sin globs, sin ampliar directorios, sin tocar
retención, cifrado, repositorio ni credenciales, sin mover ni copiar el store
fuente, y sin tocar el runner de uploads ni ningún otro store.

**`stores.py`** — una entrada con la ruta exacta:

```python
JsonStore(
    "data/mook_db.json",
    "CANON",
    count_adapter=None,
    sensitivity=SENSITIVITY_MINORS,
    retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    required=False,
),
```

Tres decisiones que merecen justificación:

- **Sin adaptador de conteo.** La raíz es un objeto de 4 claves fijas, así que
  `root_len` emitiría siempre `4`: un número constante que en el manifiesto se
  leería como un conteo real de experiencias. `bytes` y `sha256` ya detectan
  truncamiento; vale más no emitir conteo que emitir uno engañoso.
- **`minors` + `NEEDS_LEGAL_REVIEW`.** `runs` y `evidence` acumulan trabajo de
  participantes menores de edad. Es la misma clasificación que ya tienen los
  stores `leo_*` y `submissions_db.json` (design §8).
- **`required=False`.** Un entorno donde el MOOK aún no se ha usado no tiene el
  archivo, y esa ausencia no debe tumbar el backup de los demás stores. Cuando
  el archivo existe —como en producción— su respaldo es obligatorio.

**`preflight.py`, `manifest.py`, `structured_backup.py`** — para que
`required=False` no vuelva a significar «ausencia invisible», el manifiesto
ahora distingue los tres estados que exige el contrato:

| Estado | Dónde aparece |
|---|---|
| incluido | `stores[]`, con `status: "included"`, `bytes` y `sha256` |
| ausente legítimamente | `stores_absent[]`, con `status: "absent_optional"`, sin bytes ni hash |
| error de lectura | **no hay manifiesto**: la ejecución aborta antes de escribirlo |

Los ausentes van en **lista aparte** a propósito: `stores` significa «respaldado
en este snapshot» y esa semántica no cambia, así que ningún conteo existente se
altera y los **202 manifiestos históricos siguen validando** bajo
`schema_version: 1` (confirmado en §6: 203 verificados, 0 problemas). Un store
ausente tampoco tiene bytes ni hash que ofrecer.

---

## 5. Aplicación al job productivo

El artefacto desplegado corresponde inequívocamente al commit `4b13d2e`: se
generó con `git archive` de ese commit y, tras normalizar a LF, **los cuatro
archivos instalados tienen exactamente el hash del blob correspondiente**.

| Archivo instalado | SHA-256 (= blob de `4b13d2e`) |
|---|---|
| `chibalete_backup/stores.py` | `d25bb6a957685758c6c85be5f71812782055e0ba22b32a7d27c0a783c58a5561` |
| `chibalete_backup/manifest.py` | `9083de0ea490f90a70e60a190a39fc281906175b4717b0e7f0571b6b78ade539` |
| `chibalete_backup/preflight.py` | `d85c542e34236031fdd51f24dd69a65d0e5a884fda07da2892d3295e2f0c87db` |
| `structured_backup.py` | `0117729ebd64cfdcbb3f7ef9af0b61471f1e2127db94cba7da1ffc2dd6eb9973` |

Los **14 archivos restantes del runner quedaron byte-idénticos** a la copia de
rollback. No se reinició ningún container de la aplicación.

Comprobación de que el runtime instalado ve el cambio: 21 JSON declarados,
`data/mook_db.json` resuelto a `/var/www/chibalete/data/mook_db.json`, presente
en producción. El `ExecStart` del timer apunta a ese mismo script, de modo que
**las ejecuciones programadas ya usan la allowlist corregida**.

### Congelamiento y captura

`mook_db.json` estable antes del snapshot: 1396 bytes, `mtime`
`2026-08-26 02:03:23Z`, sha `d69a8f34…`, hash repetido con 3 s de separación.
Experience intacta, 0 versiones nuevas. Ninguna escritura MOOK durante la
ventana.

Ejecución en serie, sin `uploads-backup` en paralelo y sin borrar snapshots:

| # | Paso | Resultado |
|---|---|---|
| 1 | `structured-backup.service` | exit 0 — snapshot `2be3ecb1`, **26 stores**, 37 ficheros |
| 2 | Manifiesto | `result: ok`, entrada MOOK `status: included`, `sha256` = el de la fuente |
| 3 | `backup-verify.service` | exit 0 — `restic check` ok, 237 snapshots, **203 manifiestos, 0 problemas** |

Entrada del MOOK en el manifiesto nuevo:

```json
{
  "logical_path": "data/mook_db.json",
  "kind": "json",
  "category": "CANON",
  "status": "included",
  "bytes": 1396,
  "sha256": "d69a8f34676e6dcddbd19da4747d0acee88cdd4e9594d8021ab663dc3d0fab41",
  "capture_method": "atomic_copy_validated",
  "integrity_result": "ok",
  "sensitivity": "minors",
  "retention_status": "NEEDS_LEGAL_REVIEW"
}
```

`stores_absent` quedó vacío: en producción existen todos los stores opcionales.

---

## 6. Pruebas aisladas

Siete casos nuevos (`MK01`–`MK07`) con fixtures **100 % sintéticos**; ninguno
usa stores productivos.

| # | Escenario exigido | Caso | Resultado |
|---|---|---|---|
| 1 | Existente → incluido | MK02 | ✅ 25 stores, `status: included`, sha = fuente, fuente intacta |
| 2 | Ausente → controlado | MK03 | ✅ `result: ok`, 24 stores, anotado en `stores_absent` |
| 3 | Vacío válido → incluido | MK04 | ✅ las 4 claves vacías se respaldan |
| 4 | Experience + versión → restauración exacta | MK05 | ✅ byte a byte, ids/slug/nodos conservados |
| 5 | Error de lectura → falla visible | MK06 | ✅ corrupto exit 15; directorio y symlink exit 11; **sin snapshot** |
| 6 | Nada fuera de la allowlist | MK07 | ✅ 5 señuelos vecinos rechazados |
| 7 | Fuentes nunca borradas/movidas/truncadas | MK02, MK07 | ✅ `assert_sources_untouched`, uploads intactos |

Además `MK01` fija el inventario: una sola declaración, sin globs, bajo `data/`,
opcional, `minors`, sin conteo.

**Suite: 90/93 PASS.** Los 3 rojos (`L07`, `P24`, `S1` — los tres por
`systemd/dropins`, que es un directorio) son **preexistentes**: el árbol
pristino de `29e8e8e` da 83/86 con exactamente los mismos tres. El cambio no
introduce ningún rojo nuevo.

### ⚠️ La suite solo puede correrse en su sandbox

`run_all.sh` y el README exigen ejecutarla en un contenedor con `/fullfs`,
`/lowspace`, `/lowino`, `/work` y `/opt/chibalete-backup` montados como **tmpfs
pequeños**. No es decorativo:

- el caso 19 llena `/fullfs` **a propósito** para provocar un ENOSPC real;
- `run_all.sh` copia los runners a `/opt/chibalete-backup`, que en producción es
  **la instalación real**.

Ejecutarla fuera de ese sandbox llenó el disco raíz del VPS durante esta ventana
(incidente en §9).

---

## 7. Restore rehearsal

Restauración de **exclusivamente** `mook_db.json` desde el snapshot `2be3ecb1`
hacia un directorio creado con `mktemp -d`. Nunca sobre la ruta productiva.

```text
ruta en el snapshot : …/staging-z_yvqks4/json/mook_db.json
destino             : /tmp/chp-mook-restore-OTwtqP  (mktemp)
restaurados         : 1 fichero, 1.363 KiB
```

| Comparación | Fuente | Restaurado |
|---|---|---|
| Tamaño | 1396 B | 1396 B |
| SHA-256 | `d69a8f34…` | `d69a8f34…` |
| `cmp` byte a byte | **idénticos** | |
| JSON parseable | sí | sí |
| Experience id | `exp-1787709803882-9ym4tt` | igual |
| slug | `estas-aqui` | igual |
| status | `draft` | igual |
| `currentVersionId` | `null` | igual |
| versions / runs / evidence | 0 / 0 / 0 | 0 / 0 / 0 |

Documento completo idéntico a la fuente. Se eliminó **solo** el directorio
temporal del ensayo.

---

## 8. Verificación productiva final

| Comprobación | Resultado |
|---|---|
| `mook_db.json` byte-idéntico antes/después | ✅ `d69a8f34…`, `mtime` sin cambio (`02:03:23Z`) |
| Catálogo | ✅ 89 |
| Recursos MOOK | ✅ 22 |
| Uploads | ✅ 95 |
| ~19 uploads huérfanos | ✅ 20 huérfanos, 13 activos editoriales MP3/TXT preservados |
| Experience | ✅ intacta, `draft`, `currentVersionId:null` |
| Publicaciones / versiones / runs / evidencias | ✅ 0 / 0 / 0 / 0 |
| `content.json` | ✅ `082a971c…` sin cambio |
| Containers | ✅ 4/4 healthy, `RestartCount=0`, ninguno reiniciado |
| 5xx atribuibles | ✅ 0 en edge y en ambas API |
| Snapshot nuevo localizable | ✅ `2be3ecb1`, tag `structured` |
| Ejecuciones futuras | ✅ el timer ejecuta el script instalado, cuyo `stores.py` es el de `4b13d2e` |

El backup **leyó** el store sin tocarlo: el `mtime` de la fuente no cambió.

---

## 9. Incidente durante la ventana: disco lleno del VPS

Honestidad operativa: la suite se ejecutó primero **fuera de su sandbox**, con
`CHP_TEST_ROOT` apuntando a una ruta del disco real. El caso 19 escribe lastre
en la ruta **hardcodeada `/fullfs`** hasta agotar el sistema de archivos, y en el
sandbox eso es un tmpfs de 1 MB. Sin él, escribió **48,4 GB** en `/fullfs` del
VPS y llenó la raíz al 100 %.

Consecuencias observadas y resolución:

- los 4 containers pasaron a `unhealthy` (ninguno se reinició: `RestartCount=0`);
- la ejecución **programada** de `structured-backup` de las 12:01:59Z falló con
  exit 1 — ENOSPC al crear el staging, **antes** de tocar fuente alguna o
  restic: falló cerrada, sin snapshot parcial;
- se eliminó `/fullfs/ballast` → 45 GB libres; los 4 containers volvieron a
  `healthy` por sí solos y el sweep dio 20/20 respuestas 200;
- **cero pérdida de datos**: `content.json`, `mook_db.json` y los 95 uploads
  conservaron su hash exacto durante todo el episodio.

La suite se reejecutó después dentro de un contenedor con los tmpfs
documentados, y de ahí salen los 90/93 de §6.

Lección para el runbook: `test_suite.py` **no** debe ejecutarse directamente en
un host con datos; `CHP_TEST_ROOT` no protege las rutas absolutas hardcodeadas
(`/fullfs`, `/lowspace`, `/lowino`, `/opt/chibalete-backup`).

---

## 10. Rollback

Aditivo: añadir cobertura no puede hacer perder nada. **No retirar
`mook_db.json` salvo que el backup falle por su causa y quede demostrado.**

- Copia íntegra del runner previo:
  `/root/chp-backup-mook-01/rollback-pre-4b13d2e/runners/` (35 ficheros).
- Procedimiento: restaurar esos 4 archivos sobre
  `/opt/chibalete-backup/runners/`. No requiere reiniciar nada: la unidad es
  `oneshot` y lee el script en cada ejecución.
- **Todos los snapshots se conservan**, incluidos `3606e841`, `0549ee9d` y el
  nuevo `2be3ecb1`. No se restauran datos. No se borra la copia de emergencia de
  `/root/chp-content-rmw-02/pre-deploy/`. No se tocan containers.

---

## 11. Estado protegido del MOOK

Sin cambios. La carga sigue **parcial y congelada**:

- Experience `exp-1787709803882-9ym4tt` en DRAFT, sin versión actual;
- 22 recursos MOOK de los 39 previstos;
- 0 versiones, runs, evidencias, publicaciones y eventos.

### ⛔ Los uploads huérfanos NO deben limpiarse

Los 13 MP3/TXT sin referencia en `content.json` son los activos editoriales de
los recursos destruidos por el defecto que corrigió `acc2227`. Siguen íntegros y
respaldados. No se tocaron.

---

## 12. Próximo paso

`mook_db.json` ya tiene cobertura canónica y restaurabilidad demostrada, que era
la dependencia declarada en `CHP_CONTENT_STORE_RMW_02_PRODUCTION_DEPLOY.md` §10.

La reanudación de la carga MOOK —bridges R1–R3, recreación de los 19 recursos
faltantes, creación de v1 y publicación— sigue siendo una **unidad posterior que
requiere autorización explícita**. Este documento no la habilita.

Deuda menor abierta: los 3 rojos preexistentes `L07`/`P24`/`S1` de la suite de
backup (`systemd/dropins` tratado como archivo). No afectan al respaldo; se
corrigen cuando se toque esa suite.
