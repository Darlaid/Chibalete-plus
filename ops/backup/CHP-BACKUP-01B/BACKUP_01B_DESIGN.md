# CHP-BACKUP-01B — Diseño Implementable de la Capa Granular (BORRADOR R1)

> **Estado:** BORRADOR de diseño, revisión R1 (correcciones vinculantes de
> `CHP-BACKUP-01B-DESIGN-R1`). Autorizado por `CHP-BACKUP-DEST-01`. **NO implementado.**
> Define exactamente qué hará la unidad de ejecución CHP-BACKUP-01B, sus prerrequisitos
> humanos y sus guardarraíles. **No contiene credenciales ni las crea.**
> Basado en `../CHP-BACKUP-01A/BACKUP_INVENTORY.md`.

## 0. Alcance y no-alcance

**01B implementará** (cuando se autorice su ejecución): el motor de backup granular restic → Backblaze B2, su programación **no destructiva**, verificación y observabilidad.
**01B NO hará:** crear cuenta/bucket/app-key B2 (paso humano), guardar credenciales en el repo, ejecutar/programar `restic forget`/`prune`/eliminación de snapshots (§5), desplegar `376f6dd`, provisionar `admin_secret`, tocar CI, ni restaurar (eso es 01C).

## 1. Prerrequisitos humanos (fuera de automatización)

Antes de ejecutar 01B, el operador debe (manualmente):

1. Crear una **cuenta Backblaze B2 independiente de Hostinger**.
2. Crear un **bucket privado, exclusivo de Chibalete+** (p. ej. `chibalete-backups`), **sin acceso público**.
3. Crear una **Application Key limitada exclusivamente al bucket aprobado** (no master key, sin administración de cuenta, sin acceso a otros buckets), con capacidad de **listar, leer, escribir y eliminar** los objetos necesarios para la operación normal del repositorio restic —incluida la **eliminación de sus archivos de lock**. Una credencial sin capacidad de borrado puede dejar **locks persistentes** o impedir operaciones normales. La protección contra borrado prematuro de snapshots **NO** se apoya en los permisos del bucket, sino en controles del runner (§5).
4. Generar la **passphrase del repositorio restic** (alta entropía) y guardar una **copia de recuperación independiente en un gestor de contraseñas, fuera del VPS** (sin ella el backup es irrecuperable por diseño).
5. Registrar los valores en el VPS con la **separación de secretos** de §4.

> Ningún valor entra en el repositorio Git ni en este documento.

## 2. Arquitectura

```
[VPS srv1179443]                                   [Backblaze B2 — cuenta independiente]
 API rw  ──lee── data/, data-critical/, uploads/
                       │
   backup runner (systemd timers, con flock)          bucket PRIVADO: chibalete-backups
     ├─ SQLite: Online Backup API → staging/*.bak         (repo restic cifrado cliente, AES-256)
     ├─ JSON: copia atómica → staging/*.json          ◄── restic backup (dedup)
     ├─ manifest.json (hashes, conteos, sin PII)      ◄──
     ├─ uploads: restic backup DIRECTO (incremental)  ◄──
     └─ verificación: restic check                    ◄── (retención destructiva DESHABILITADA)
```

- **Capa A (Hostinger):** *disaster recovery* de infra (semanal). 01B no la toca.
- **Capa B (esta):** granular, cifrada, off-site independiente, restaurable por store/fecha.

## 3. Política de bucket (Corrección 3)

Requisitos verificables antes de operar:

- Bucket **privado**, **dedicado exclusivamente** a Chibalete+.
- **Cuenta independiente de Hostinger**.
- Application Key **limitada exclusivamente al bucket** (no master, sin otros buckets, sin admin de cuenta; con permiso de borrado para la operación de restic — §1.3, §5).
- **Endpoint S3 y región explícitos** y **prefijo exclusivo** en `RESTIC_REPOSITORY` (§4).
- **Cifrado de restic** activo (cliente).
- **Ausencia de acceso público** (verificar configuración del bucket).

### 3.1 Preflight remoto — antes de `restic init` (Corrección 4)

El runner de inicialización comprueba, **sin imprimir credenciales ni nombres sensibles innecesarios**:

1. **Conectividad** al endpoint S3 de la región.
2. **Identidad del bucket** (el bucket resuelto es el aprobado).
3. **Acceso limitado** al bucket esperado (la key no lista otros buckets).
4. **Listado del prefijo aprobado** bajo ese bucket.
5. Destino **vacío** *o* **repositorio restic inequívocamente identificable** bajo el prefijo (`restic cat config` válido con la passphrase).
6. **Ausencia de objetos desconocidos** bajo el prefijo.

Si existen objetos **ambiguos/desconocidos** bajo el prefijo:

> `STOP — BACKUP-01B REMOTE DESTINATION NOT EMPTY`

No inicializar encima de contenido preexistente ambiguo.

## 4. Separación de secretos (Corrección 1)

Dos archivos distintos, ambos **`root:root 0400`**, **fuera del repo Git** y del árbol web, **nunca impresos en logs**:

| Archivo | Contenido |
|---|---|
| `/etc/chibalete-backup/backup.env` | **Contrato S3-compatible** (Corrección 1): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE=/etc/chibalete-backup/restic-password`. **NO** contiene la passphrase en sí. |
| `/etc/chibalete-backup/restic-password` | **Solo** la passphrase del repositorio restic. Referenciada por `RESTIC_PASSWORD_FILE`. |

**Contrato S3 (Corrección 1):** el `keyID`/`applicationKey` de Backblaze B2 se usan como **`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`** directamente (B2 expone una API S3-compatible). **No** se usan `B2_ACCOUNT_ID`/`B2_ACCOUNT_KEY` para la invocación S3 (evita depender de una transformación no probada). `AWS_DEFAULT_REGION` fija la región del endpoint.

`RESTIC_REPOSITORY` debe usar **endpoint S3-compatible explícito de la región + bucket privado dedicado + prefijo exclusivo de Chibalete+**, con la forma:
```
RESTIC_REPOSITORY=s3:https://s3.<region>.backblazeb2.com/<bucket-privado>/<prefijo-chibalete>
```
(valores reales `<region>`/`<bucket-privado>`/`<prefijo-chibalete>` los aporta el operador; **no** figuran en este documento).

- La passphrase tiene además una **copia de recuperación independiente fuera del VPS** (gestor de contraseñas del operador).
- `EnvironmentFile=/etc/chibalete-backup/backup.env` en los units; `RESTIC_PASSWORD_FILE=/etc/chibalete-backup/restic-password`.
- Redacción obligatoria en todo log; el runner nunca imprime estos valores.

## 5. Retención — NO destructiva en 01B (Corrección 2)

**Política objetivo aprobada** (`CHP-BACKUP-DEST-01`): **7 diarios · 4 semanales · 6 mensuales**.

En 01B se permite **únicamente**:
- generar snapshots;
- listarlos (`restic snapshots`);
- verificar integridad (`restic check`);
- **simular** la retención con `restic forget --dry-run` (si la versión lo soporta **sin mutación**) para validar la política.

**01B NO ejecuta ni programa** `restic forget` (sin `--dry-run`), `restic prune`, ni ninguna eliminación de snapshots. La **eliminación real queda BLOQUEADA hasta CHP-BACKUP-01C GREEN y una unidad posterior explícita** que la habilite. (Coherente con la Decisión 10: un backup exitoso no cierra el gate.)

### 5.1 Cómo se implementa la protección (Corrección 3)

La Application Key **sí** tiene permiso de borrado (restic lo necesita para sus **locks** y operación normal, §1.3). Por tanto la protección contra borrado prematuro de snapshots **NO** se apoya en la falta de permisos del bucket, sino en **controles del runner**:

- **Ausencia de comandos destructivos** (`forget` sin `--dry-run`, `prune`) en los runners y units de 01B.
- **systemd units separadas**: los jobs de backup/verify no contienen retención; no existe unit destructiva.
- **Allowlist de subcomandos** restic permitidos en 01B: `init`, `backup`, `snapshots`, `check`, `cat config`, `forget --dry-run`, `unlock` (solo locks propios). Cualquier otro subcomando destructivo está fuera de la allowlist.
- **Revisión estática** del runner (grep de `forget[^-]`, `prune`, `--prune`) como gate previo a instalar.
- **Logs de comandos sin secretos** (se registra el subcomando ejecutado, nunca credenciales/passphrase).
- **Aprobación humana posterior a 01C** + **unidad explícita** para activar la retención destructiva.

`restic unlock` se limita a **locks stale propios** del repo (operación normal, no destructiva de snapshots) y queda registrado.

## 6. Método SQLite (Corrección 6)

**Principal:** SQLite **Online Backup API** (`better-sqlite3 db.backup()` desde el runtime del contenedor, o `sqlite3 .backup` si 01B instala el CLI) → copia única, coherente, con el WAL integrado, sin forzar checkpoint destructivo sobre el `.db` productivo.
`PRAGMA integrity_check` sobre la copia de staging antes de aceptarla.

**Fallback `VACUUM INTO`** — solo si el principal falla, y exige: **preflight de espacio** (§7) · **lock controlado** · **integridad posterior** · **justificación registrada** en el log.

Cubre `events.db`, `progress.db`, `offline_assignments.db`, `insights.db` (PROJ, marcado reconstruible) y el futuro `identity.db`.

## 7. Espacio y caché — cálculo dinámico (Corrección 5)

**Prohibido** tarball completo y **duplicar uploads localmente** (Decisión 8). Uploads van **directo** a restic por stream.

El preflight **calcula en ejecución** el espacio requerido (sin cifras fijas):

```
requerido = Σ(tamaño .db activos) + Σ(WAL/SHM relevantes)
          + Σ(tamaño JSON canónicos) + tamaño(manifiestos)
          + margen_online_backup_api            (copia SQLite coherente)
          + caché_temporal_restic (estimada)
          + margen_seguridad_filesystem
```

El preflight:
- registra **solo tamaños agregados** (sin nombres de usuario ni contenido);
- comprueba **espacio libre e inodos** del filesystem de staging;
- **se detiene antes de copiar** si el margen es insuficiente (`STOP — BACKUP-01B INSUFFICIENT STAGING SPACE`);
- **no duplica uploads**;
- usa un **directorio temporal dedicado** (`mktemp -d` bajo un `WorkingDirectory` acotado, no en `/var/www/chibalete`);
- **limpia temporales solo después de verificar** el estado del snapshot;
- **nunca elimina archivos productivos**.

## 8. Datos `leo_*` y menores (Corrección 4)

Se **incluyen** los stores `leo_*` clasificados como canónicos/no reconstruibles: `leo_memory_db.json`, `leo_evidence_db.json`, `leo_interactions_db.json`, y cualquier memoria vinculada a menores.

Tratamiento **provisional**:
- **cifrado por restic** (repo cifrado, bucket privado);
- **mismos snapshots** que los JSON canónicos (no un flujo aparte);
- **acceso restringido** (solo quien posea la passphrase restic);
- **no inspección de contenido**; **no** inclusión en logs ni en manifiestos detallados (el manifiesto solo registra ruta lógica + bytes + sha256 + conteo agregado, nunca valores);
- **retención inicial = política general** (7/4/6), sin retención indefinida;
- **`NEEDS_LEGAL_REVIEW`**: la minimización/retención definitiva de datos de menores requiere criterio legal antes de habilitar prune (post-01C).
- **No** excluirlos silenciosamente ni crear retención indefinida.

## 9. Manifiesto, hashes, verificación

- `manifest.json` por snapshot (**sin PII**): por store `{ruta_lógica, bytes, sha256, entidades_agregadas, ts_captura, integrity}`.
- Cifrado junto al snapshot; copia de hashes local `0400` para verificación rápida.
- `restic check` periódico (§10) + `--read-data-subset` para detectar bit-rot en B2.

## 10. Temporizadores systemd (Corrección 7)

Servicios/timers **independientes**, cada uno con **`flock`** para impedir concurrencia; `OnFailure=` → alerta:

| Unit | Cadencia | Acción | Destructivo |
|---|---|---|---|
| `chibalete-backup-structured.timer` | **cada 6 h** (`00,06,12,18:00`) | SQLite (Online Backup API) + JSON atómico + manifest → restic | **No** |
| `chibalete-backup-uploads.timer` | **diario** (`03:30`) | uploads incremental directo → restic | **No** |
| `chibalete-backup-verify.timer` | semanal | `restic check` (+ subset) | **No** |
| ~~retención destructiva~~ | — | **DESHABILITADA hasta post-01C** (§5) | — |

systemd (no cron): logs en `journald`, `OnFailure=`, `Nice`/`IOSchedulingClass` para no competir con la app.

## 11. Observabilidad y fallo parcial

- Métricas (duración, bytes, stores ok/fail, edad snapshot) a `journald`/textfile-collector → **Prometheus/Alertmanager ya presentes**.
- Alertar si `edad_último_snapshot > RPO` (6 h estructurado / 24 h uploads) o si `restic check` falla.
- **Fallo parcial:** un store que falla `integrity_check` marca el snapshot PARCIAL + alerta, **sin** sobrescribir el último snapshot válido.

## 12. RPO/RTO objetivo (a validar en 01C)

| Métrica | Objetivo |
|---|---|
| RPO estructurado (SQLite+JSON) | 6 h |
| RPO uploads | 24 h |
| RTO aplicación (restore granular) | 4 h |
| RTO recuperación completa | 8 h |

Ninguno se declara cumplido hasta medirlo en el ensayo aislado de **01C**.

## 13. STOP conditions de 01B

- `STOP — BACKUP-01B REMOTE DESTINATION NOT EMPTY` (§3).
- `STOP — BACKUP-01B INSUFFICIENT STAGING SPACE` (§7).
- `STOP — BACKUP-01B SECRETS FILE PERMISSIONS UNSAFE` (backup.env / restic-password ≠ `0400 root:root`).
- `STOP — BACKUP-01B SQLITE CONSISTENCY NOT PROVEN` (ni Online Backup API ni fallback superan `integrity_check`).
- `STOP — BACKUP-01B PRODUCTION MUTATION DETECTED` (cualquier escritura/borrado en `/var/www/chibalete/**` productivo).

## 14. Rollback de 01B

01B es **aditivo y no destructivo**; su rollback es:
- deshabilitar/detener los timers y services (`systemctl disable --now`);
- eliminar los units y el runner instalados por 01B;
- borrar el directorio de staging temporal (vacío tras verificación);
- **no** borrar snapshots del repo restic (retención destructiva bloqueada);
- **no** tocar datos productivos (nunca se modificaron);
- los secretos `/etc/chibalete-backup/*` se conservan o se eliminan según decisión del operador.
Ningún paso de rollback toca producción ni el bucket de forma destructiva.

## 15. Criterios de éxito de 01B (GREEN de la unidad de ejecución)

- Prerrequisitos humanos §1 completados; secretos §4 con `0400 root:root`.
- `restic init` idempotente sobre destino vacío o repo esperado (§3).
- Primer `structured` + `uploads` OK, con `manifest.json` (sin PII) y `restic check` verde.
- `forget --dry-run` confirma que la política 7/4/6 se aplicaría correctamente, **sin ejecutar** borrado.
- Timers instalados (no cron), con `flock`; alertas activas.
- Preflight de espacio dinámico operativo; sin duplicación de uploads.
- Evidencia no sensible registrada; **cero** deploy/provisión/CI/restore/mutación productiva.

## 16. Dependencia explícita de 01C (Decisión 10)

La ejecución exitosa de 01B **no cierra CHP-BACKUP-01**. El gate solo será **GREEN** tras **CHP-BACKUP-01C** (restauración aislada satisfactoria + verificación de consistencia del punto Hostinger). La **retención destructiva** (`forget`/`prune`) permanece **bloqueada** hasta 01C GREEN y una unidad posterior explícita que la habilite.

## 17. `identity.db` (futuro)

Cuando `identity_sqlite` → `enabled`, entra en §6 (Online Backup API) como CANON no reconstruible de máxima criticidad; ya contemplado en manifest y en el orden de restore de 01C.
