# CHP-BACKUP-01A — Diseño Propuesto de Backup de Aplicación (para CHP-BACKUP-01B)

> **Diseño, no implementación.** Idempotente, ejecutable sin detener la aplicación.
> RPO/RTO propuestos están **PENDIENTES DE APROBACIÓN HUMANA** — no son decisiones aceptadas.

## 1. Objetivo y capas

Chibalete+ necesita **dos capas** de recuperación:

- **Capa A — Infraestructura (ya existe):** backup semanal de disco de Hostinger (off-site, crash-consistent). Sirve como *disaster recovery* de todo el host. **No es app-consistent para SQLite** ni granular.
- **Capa B — Aplicación granular (a implementar en 01B):** backup consistente, cifrado, con manifiesto y off-site independiente, restaurable por store y por fecha. **Es la brecha que cierra SEC-01.**

Este diseño especifica la Capa B y cómo se apoya en la Capa A.

## 2. Herramienta recomendada

**`restic`** (destino off-site) como motor principal:
- Deduplicación + incrementalidad nativas (uploads de 5.1 GB se respaldan una vez y luego solo deltas).
- Cifrado autenticado del lado cliente (AES-256) → los datos salen cifrados hacia el off-site.
- Snapshots con retención declarativa (`forget --keep-*`), verificación (`check`) y restauración granular.
- Backends S3-compatibles (Backblaze B2 / AWS S3 / etc.) vía `rclone` si el proveedor lo requiere.

Alternativa equivalente: `borg` + `rclone`. **Decisión de proveedor/credenciales = HUMANA** (ver `BLOCKED — OFF-SITE DESTINATION REQUIRES HUMAN SELECTION`).

## 3. Captura consistente por tipo de store

### 3.1 SQLite (events.db, progress.db, offline_assignments.db, insights.db, y futuro identity.db)

- **Nunca** `cp`/`tar` del `.db` vivo. Para cada base:
  1. Abrir **read-only** (`readonly:true`) desde un proceso de backup dedicado.
  2. Emitir `VACUUM INTO '/staging/<db>.bak'` **o** usar la **Online Backup API** de SQLite → produce un archivo único, coherente, **con el WAL ya integrado**, sin tocar el `.db` productivo ni forzar checkpoint sobre él.
  3. `PRAGMA integrity_check` sobre la copia de staging antes de aceptarla.
- `insights.db` es **PROJ** (reconstruible): incluir por comodidad, pero marcado como no crítico (puede regenerarse desde `events.db`).

### 3.2 JSON canónicos

- Copia **atómica** por store: leer → escribir a temporal en el mismo filesystem → `rename(2)` a staging. Validar `JSON.parse` de la copia antes de aceptarla.
- Cubre: `usuarios_colegios_oro.json`, `groups_db.json`, `access_db.json`, `schools_db.json`, `sections.json`, `school_configs.json`, `content.json`, `content_db.json`, `user_audit_log.json`, `leo_*` (PII de menores → **cifrado obligatorio**).
- `analytics_db.json` (**PROJ**): incluir como conveniencia, marcado reconstruible.

### 3.3 Uploads (5.1 G, 3 137 archivos, content-addressed)

- **Incremental** vía restic (dedup): primer snapshot completo, luego solo archivos nuevos.
- Verificación de integridad por hash del propio restic; adicionalmente un **manifiesto** (ruta relativa + tamaño + sha256) para reconciliación independiente en restore.

### 3.4 Exclusiones

- `*.bak.*`, `*.pre-*`, `*.corrupt.*`, `server.old-*`, `node_modules/`, `.claude/`, `studio-editor-bi/` (otra app), volúmenes de observabilidad (reconstruibles), y **secretos** (`.env`, `secrets/`) → **NO** en el backup de datos ordinario.

## 4. Manifiesto, hashes y verificación

Cada snapshot produce `manifest.json` (sin PII): por store → `{ruta_lógica, bytes, sha256, filas/entidades_agregadas, timestamp_captura, integrity_result}`. El manifiesto se cifra junto al snapshot y se conserva una copia de sus **hashes** localmente para verificación rápida.

## 5. Secretos (estrategia separada)

- **Fuera** del backup de datos. `.env` y el futuro `admin_secret` file-only requieren un backup **cifrado separado** (p. ej. un `restic` repo distinto con passphrase gestionada por el operador, o un gestor de secretos).
- **Nunca** aparecen en manifiestos, logs ni en este repositorio.

## 6. Cifrado, compresión, retención, rotación

- **Cifrado:** del lado cliente (restic), passphrase **no** almacenada en el repo ni en el VPS en claro.
- **Compresión:** restic (zstd) — beneficia JSON/SQLite; uploads ya densos.
- **Retención (PROPUESTA, pendiente de aprobación):** `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`. La capa Hostinger cubre ≤7 días de infra en paralelo.

## 7. Operación: locks, concurrencia, reintentos, limpieza, observabilidad

- **Lock exclusivo** (`flock` no bloqueante) → una sola ejecución simultánea; segunda ejecución aborta limpio.
- **Idempotente:** staging con `mktemp` y `rename` atómico; `restic backup` reanudable; `restic forget --prune` para rotación.
- **Reintentos** con backoff en la fase off-site (fallo de red no debe perder el snapshot local de staging).
- **Fallo parcial:** si un store falla su `integrity_check`, se marca el snapshot como PARCIAL y se **alerta**, sin sobrescribir el último snapshot válido.
- **Limpieza segura:** borrar el staging solo tras confirmar el snapshot off-site + `restic check` del snapshot.
- **Observabilidad:** cada corrida emite métricas (duración, bytes, stores ok/fail, edad del snapshot) a stdout/log estructurado; alerta si `edad_último_snapshot > RPO` o si `check` falla. Integrable con el stack Prometheus/Alertmanager ya presente.

## 8. Programación y RPO/RTO propuestos (PENDIENTES DE APROBACIÓN)

| Métrica | Propuesta | Nota |
|---|---|---|
| Frecuencia | Diaria (SQLite+JSON) + incremental de uploads | Ajustable a la criticidad de events/progreso |
| **RPO objetivo** | ≤ 24 h (Capa B) · ≤ 7 días (Capa A Hostinger) | events.db crece rápido → considerar 2×/día |
| **RTO objetivo** | ≤ 2 h restore granular · ~2 h 21 m disco completo (Hostinger) | medir real en 01C |
| Espacio local staging | ~15 GB pico (SQLite copias + JSON; uploads van directo a restic) | disco al 81% → vigilar; preferir stream a off-site |

> RPO/RTO **no** están aceptados; son punto de partida para decisión humana.

## 9. Estimación de espacio

- Primer snapshot off-site ≈ tamaño lógico comprimido de data+data-critical+uploads ≈ **~4–5 GB** (uploads domina; dedup reduce futuros).
- Staging local temporal SQLite+JSON ≈ **~15 MB** por snapshot (bases pequeñas) — el pico real es la copia de events.db (~9 MB) + progress (~3 MB).
- El disco del VPS (21 GB libres) soporta staging temporal; **el destino off-site NO consume disco del VPS**.

## 10. Relación con la Capa A (Hostinger)

- Hostinger = *disaster recovery* del host (rebuild total). Se **conserva** como capa complementaria.
- La Capa B aporta lo que Hostinger no demuestra: **consistencia SQLite, granularidad por store/fecha, restore probado, independencia de proveedor**.
- Ambas juntas aproximan 3-2-1 **solo si** la Capa B tiene destino off-site independiente de la cuenta Hostinger.

## 11. `identity.db` (futuro)

Incluido en el diseño desde ahora: cuando `identity_sqlite` pase a `enabled`, entra en §3.1 (captura consistente SQLite) y en la matriz como **CANON no reconstruible** de máxima criticidad (identidad).
