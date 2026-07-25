# CHP-BACKUP-01A — Inventario Canónico de Backup/Restore (Chibalete+)

> **Unidad:** CHP-BACKUP-01A-R1 · **Naturaleza:** inspección read-only + diseño.
> **Fecha de inventario:** 2026-07-25 (UTC). **Host:** `srv1179443` (Ubuntu 24.04.4 LTS, kernel 6.8).
> **Sin mutaciones de producción.** Ningún secreto, PII ni contenido de archivo aparece en este documento.

## 0. Contexto y bloqueos

| Aspecto | Estado |
|---|---|
| Código file-only (`376f6dd`) | Publicado, **NO desplegado** |
| Producción (imagen API) | `chibalete/api:af319ca` (predecesora del file-only) |
| `/var/www/chibalete/secrets/admin_secret` | **NO provisionado** (dir `0500 root:root`, 0 entradas) |
| `security.yml` del commit `376f6dd` | **FAILURE** — causa exacta NO determinada (logs 403 sin `actions:read`) |
| **Deploy / provisión** | **BLOQUEADOS** (independientes de esta auditoría read-only) |

## 1. Baseline de producción (read-only)

- 2× API `chibalete_api_1/2` **healthy** (8h uptime), edge/front/obs stack up ~2 semanas, `/api/health/ready` → **200**.
- App version `2.1.4`; healthcheck reporta `mounts.events_db=present`, `progress_db=present`, `identity_sqlite.state=disabled`.
- **Disco `/` (ext4, `/dev/sda1`): 106G total, 86G usados (81%), 21G libres.** Inodos 26% usados. → margen para backup local limitado; el respaldo granular debe considerarlo.

### Mounts de datos (bind, desde `chibalete_api_1`)

| Host | Contenedor | RW |
|---|---|---|
| `/var/www/chibalete/data` | `/app/data` | rw |
| `/var/www/chibalete/data-critical` | `/app/data-critical` | rw |
| `/var/www/chibalete/public/uploads` | `/app/public/uploads` | rw |
| `/var/www/chibalete/server` | `/app/server` | ro |
| `/var/www/chibalete/utils` | `/app/utils` | ro |
| `/var/www/chibalete/secrets` | `/app/secrets` | ro (vacío) |

Volúmenes Docker nombrados: solo del stack de observabilidad (`chibalete-obs_{prometheus,grafana,alertmanager}-data`) — reconstruibles/no críticos para datos de negocio.

## 2. Inventario canónico de stores

Leyenda de autoridad: **CANON** = fuente de verdad no reconstruible · **PROJ** = proyección reconstruible · **CFG** = configuración recuperable · **UP** = contenido subido no reconstruible · **LOG** = log/efímero · **SECRET** = secreto (fuera de backup ordinario).

### 2.1 SQLite (`better-sqlite3`, todas WAL, `quick_check=ok`, page_size 4096)

| Store lógico | Ruta host | Ruta contenedor | Cat. | Filas | Writer | Reconstruible | Captura segura |
|---|---|---|---|---|---|---|---|
| Eventos/telemetría | `data-critical/events.db` (+ -wal 2.5M, -shm) | `/app/data-critical/events.db` | **CANON** | events **19 443** | API (native backbone) | **NO** | `VACUUM INTO` o SQLite backup API (checkpoint-safe) |
| Progreso lectura | `data/progress.db` (+ -wal 424K, -shm) | `/app/data/progress.db` | **CANON** | progress **7 215** | API | **NO** | idem |
| Asignaciones offline | `data/offline_assignments.db` (+ -wal 284K, -shm) | `/app/data/offline_assignments.db` | **CANON** | offline_book_assignments **12** | API | **NO** | idem |
| Insights/rollups | `data-critical/insights.db` (+ -wal, -shm) | `/app/data-critical/insights.db` | **PROJ** | 21 tablas, **todas 0 filas** | materializer | **SÍ** (deriva de events.db) | opcional / rebuild |

> ⚠️ **Todas en WAL activo.** Un `cp`/`tar` naíf del `.db` sin el `-wal` (o durante escritura) produce imagen **inconsistente** (Principio #3). El backup debe usar la API de respaldo de SQLite o `VACUUM INTO` sobre apertura read-only.

### 2.2 JSON canónicos (todos `parse=OK`)

| Store | Ruta host (`data/` o `data-critical/`) | Cat. | Conteo agregado | PII | sha256[:16] |
|---|---|---|---|---|---|
| Usuarios (USERS_DB) | `data-critical/usuarios_colegios_oro.json` | **CANON** | 646 usuarios | **SÍ** (bcrypt) | `a83f12e0c99af7da` |
| Grupos/memberships | `data/groups_db.json` | **CANON** | 20 grupos | parcial | `870b4bfbe0f35ed0` |
| Access grants | `data/access_db.json` | **CANON** | 1 | no | `8b427d32933b7ce8` |
| Escuelas | `data/schools_db.json` | **CFG** | 3 | no | `7b7f269ff50e320e` |
| Secciones | `data/sections.json` | **CFG** | 7 | no | `6ab786f3700a3627` |
| Config escuelas | `data/school_configs.json` | **CFG** | 1 | no | `de83151ce295288f` |
| Catálogo contenido | `data/content.json` | **CANON/CFG** | 67 ítems | no | `889629ee24a1d0ca` |
| Catálogo (legacy) | `data/content_db.json` | **CANON/CFG** | 3 | no | `5bf7c732c1cfcc56` |
| Audit log usuarios | `data/user_audit_log.json` | **CANON** | 211 entradas | parcial | `b50659ebea9f437d` |
| Leo memoria | `data/leo_memory_db.json` | **CANON** | obj (1 clave raíz) | **SÍ** (menores) | `8b30075b0079b3c0` |
| Leo evidencia | `data/leo_evidence_db.json` | **CANON** | obj (2 claves) | **SÍ** (menores) | `cad60c5e8b77d2cb` |
| Leo interacciones | `data/leo_interactions_db.json` | **CANON** | 15 | **SÍ** (menores) | `17285cac9e661bd0` |
| Analytics | `data/analytics_db.json` | **PROJ** | 1848 | agregado | `9184781a3ddcb99f` |

> Existen además numerosos `*.json.bak.*` / `*.pre-*` / `*.corrupt.*` (snapshots manuales antiguos). **No cuentan como backup** (sin fecha/fuente/retención/off-site/restore verificado — Principio #1).

### 2.3 Uploads (contenido no reconstruible)

| Ruta | Volumen | Archivos | Notas |
|---|---|---|---|
| `data/public/uploads` (`/app/public/uploads`) | **5.1 G** | **3 137** | Sin extensión (content-addressed). 0 symlinks rotos. **UP — no reconstruible.** |
| `uploads/` (dir aparte) | 76 K | 8 | secundario |

### 2.4 `identity.db` (futuro)

`identity_sqlite.state=disabled`; **no existe físicamente**. Se registra como **store obligatorio del backup desde su introducción futura**; el diseño ya lo contempla.

### 2.5 Secretos (solo existencia)

- `/var/www/chibalete/secrets/` (`0500 root:root`, **vacío**) — destino del futuro `admin_secret` file-only, aún no provisionado.
- `.env` de Compose (`/opt/chibaleteplus/.env`) contiene `ADMIN_SECRET`, claves IA — **fuera del backup de datos ordinario**; requieren estrategia cifrada separada (no inventariado por contenido).

## 3. Backups existentes

### 3.A Hostinger — backup de infraestructura (evidencia humana del decisor)

| Atributo | Valor (según capturas del proveedor) |
|---|---|
| Tipo | Backup automático **semanal** de la VPS (imagen de disco completa) |
| Puntos visibles | **2026-07-17** y **2026-07-24** |
| Tamaño | ~84–85 GB |
| Localización declarada | Brasil (separado del servidor principal, según proveedor) |
| RTO estimado | ~2 h 21 min |
| Retención | Sustitución automática de puntos antiguos (retención exacta NO confirmada) |
| Restauración de aplicación | **NOT TESTED** |
| Consistencia SQLite | **NO demostrada** (captura de disco vivo con WAL activo ⇒ crash-consistent, no app-consistent) |
| Independencia de cuenta/proveedor | NO demostrada (atado a la cuenta Hostinger) |

**Clasificación:** *BACKUP DE INFRAESTRUCTURA EXISTENTE — RESTAURABILIDAD DE APLICACIÓN NO DEMOSTRADA.*

### 3.B Backups de aplicación (en el VPS)

| Mecanismo | Cobertura | Destino | Programado | Última ejecución | Off-site | Restore probado |
|---|---|---|---|---|---|---|
| `/root/scripts/backup-vps.sh` (19 KB) | `data/`, `data-critical/`, `server/` → tar.gz; uploads = **solo manifiesto**; retención `RETENTION_DAYS=7` | **LOCAL** `/root/backups/chibalete/$TS/` | **NO** (root crontab vacío, sin timer) | **2026-05-08** (~78 días) | **NO** | **NO** |
| `/opt/chibaleteplus/scripts/backup.sh` (846 B) | Solo **config** (nginx.conf, compose, .env, docker ps/images/inspect) | LOCAL `$BASE/backups/$TS` | NO | — | NO | NO |
| `/root/backups/chibalete/backup_total_*.tar.gz` | Tarball manual total (2.3 GB) | LOCAL | — | **2026-04-12** (~104 días) | NO | NO |
| `chibalete-audit` cron (01:00, 13:00) | **Auditoría**, no backup | — | sí | diario | — | — |

> ⚠️ `backup-vps.sh` respalda SQLite con `tar -czf` naíf (data-critical incluye events.db + WAL) → **riesgo de imagen inconsistente**. **No es sustituto** de un backup consistente y granular.

### 3.C Herramientas / destinos off-site de aplicación

- `restic`, `borg`, `rclone`, `duplicity`, `rsnapshot`: **todos ausentes**.
- Sin configs remotas (`~/.config/rclone`, `~/.aws/credentials`, `~/.restic*`, `~/.borg*`): **ninguna**.
- **No existe destino off-site configurado para backups de aplicación.**

## 4. Estado off-site y 3-2-1

| Regla 3-2-1 | Estado |
|---|---|
| 3 copias | ❌ (1 copia viva + snapshots locales stale; Hostinger es 1 copia de infra) |
| 2 medios | Parcial (disco VPS + imagen Hostinger) |
| 1 off-site | **Solo Hostinger** (infra, restore de app no probado); **sin off-site granular de aplicación** |

> **`BLOCKED — OFF-SITE DESTINATION REQUIRES HUMAN SELECTION`** para el backup **granular de aplicación**: no hay proveedor/credenciales configurados. Hostinger cubre la capa de infra pero no sustituye la capa granular. Esto **no invalida el inventario**, pero **impide autorizar CHP-BACKUP-01B** hasta que un humano seleccione destino off-site.

## 5. Salud e integridad (resumen read-only)

- SQLite: `events.db`, `progress.db`, `offline_assignments.db`, `insights.db` → `quick_check=ok`, WAL. **Sin corrupción activa.**
- JSON canónicos: 13/13 `parse=OK`.
- Uploads: 3 137 archivos, 0 symlinks rotos.
- **No se detectó corrupción activa** → no procede `STOP — ACTIVE DATA CORRUPTION`.

## 6. Confirmación read-only

Solo lecturas: SSH read-only (`inspect`, `ls`, `stat`, `du`, `find`, `df`), SQLite abierto `readonly:true` (sin checkpoint/VACUUM), `python3 json.load` sin imprimir valores, `sha256`. **Cero** `restart`/`up`/`down`/`cp`/`mv`/`rm`/`chmod`/`chown`/`pull`/`prune`/escritura/edición. Ningún secreto, PII ni contenido impreso.
