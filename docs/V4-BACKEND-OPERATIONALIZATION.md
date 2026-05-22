# V4 Backend Operationalization — Fase 0

> Auditoría operacional real + diseño de snapshot / staging / swap / rollback
> para el deploy integral del backend Chibalete+ v4.0.2.
>
> **Estado:** diseño y auditoría. **NADA ejecutado en producción.**
> Auditoría VPS: read-only (`docker ps/inspect`, `ls`, `du`, `stat`, `curl`).
> Fecha: 2026-05-22.

## 1. Topología VPS real (FASE 1)

**Host:** VPS `srv1179443` (`72.60.158.97`), single-host. Disco `/dev/sda1`
106 GB — **51 GB usados, 56 GB libres (48 %)**. Todo en una partición.

**Docker Compose:** `/opt/chibaleteplus/docker-compose.yml` (1711 B, proyecto
`chibaleteplus`). 1 red `chibalete_net` (bridge). 4 servicios, todos
`restart: unless-stopped`, **ningún `healthcheck`**.

| Servicio | Container | Imagen | Estado | Puertos | Mounts |
|---|---|---|---|---|---|
| edge | `chibalete_edge` | `nginx:alpine` (`582c496ccf79`) | Up 3 sem, RC=0 | **80, 443 publicados** | `nginx.conf`(ro), `certbot/conf`(ro), `public/uploads`→`/var/uploads`(ro) |
| front | `chibalete_front` | `chibalete/front:sprint-022-e73b9cf` (`4b17e2e0a5c3`, **2.3 GB**) | Up 2 sem, RC=0 | — | ninguno (estático) |
| api_1 | `chibalete_api_1` | `chibalete/api:latest` (`0001a71be10a`, **1.99 GB**, 4 sem) | Up, RC=0 | `3000/tcp` **no publicado** | data,uploads,data-critical (rw); server,utils (ro) |
| api_2 | `chibalete_api_2` | `chibalete/api:latest` (idem) | Up, RC=0 | `3000/tcp` **no publicado** | idem api_1 |

**Versión desplegada:** `server/.deploy-info` → release `rel-2026-05-09-smoke-001`,
`git_sha e73b9cf7bbc6…`, desplegado `2026-05-08T01:15:58Z`. `/api/health`
confirma `version: rel-2026-05-09-smoke-001`.
⚠️ `server/.release-marker` declara `git_sha=7ef157a…` — **inconsistente** con
`.deploy-info` (`e73b9cf…`). El tag de la imagen front (`…-e73b9cf`) concuerda
con `.deploy-info`; el marker es trazabilidad poco fiable.

### Runtime filesystem — `/var/www/chibalete/`

| Dir | Tamaño | Archivos | Owner | mtime | Mount |
|---|---|---|---|---|---|
| `server/` | 756 K | 36 (plano, sin subdirs) | `197609:197121` | 2026-05-08 | →`/app/server` **ro** |
| `utils/` | 272 K | 24 (`.mjs` backend + `.ts` frontend) | `197609:197121` | 2026-05-07 | →`/app/utils` **ro** |
| `data/` | 5.1 M | 27 | `root:root` | 2026-05-22 | →`/app/data` **rw** |
| `data-critical/` | 4.0 M | 11 | `root:root` | 2026-05-22 | →`/app/data-critical` **rw** |
| `public/uploads/` | **5.0 G** | 1484 | `root:root` | 2026-05-20 | →`/app/public/uploads` **rw** |

- `server/server.js` = 302 KB. **`server/` desplegado es PLANO** (36 `.js`, sin
  subdirectorios) — v4.0.2 (`6dc5efb`) trae estructura anidada
  (`server/leo/`, `server/aulaViva/`, `server/services/`, …) → el swap cambia
  estructura, no solo archivos.
- ⚠️ Owner `197609:197121` en `server/`+`utils/` = UID/GID de Windows
  (sincronizado desde el workstation). Archivos `-rw-r--r--` → legibles por
  cualquier UID, así que el container (ro) los lee sin problema.
- **Precedente de swap:** ya existen `server.bak.*`, `server.failed-*`,
  `server.old-*`, `utils.failed-*`, `utils.old-*` → el swap atómico
  rename-based ya se practicó de forma ad-hoc; esta doc lo formaliza.
- **Clutter** (no montado, housekeeping): `node_modules/`, `pages/`, `public/`,
  `scripts/`, `services/`, `src/`, `types/`, `uploads/` a nivel raíz; varios
  dirs `drwxrwxrwx` (777) — smell de seguridad legacy, fuera del path de deploy.

## 2. Mapa de dependencias backend (FASE 2)

**Código (bind mount `ro` — se swappea):**
- `server/` — todo el backend: `server.js` + 35 módulos (leo*, backbone*,
  insights*, events, metrics, tts*, health, …).
- `utils/` — el backend importa solo los `.mjs`: `groupMembership.mjs`,
  `groupDiagnosis.mjs`, `studentStatus.mjs`. Los `.ts` de `utils/` son del
  frontend — montados pero **no importados** por el backend (inertes).

**Estado / persistencia (bind mount `rw` — NO se swappea, NO se toca):**
- `data/` — 13+ JSON flat-file (`content.json`, `groups_db.json`,
  `analytics_db.json`, `leo_memory_db.json`, …) + **`progress.db`** (SQLite WAL,
  2.9 M) + `playback_events.log`.
- `data-critical/` — **`events.db`** (SQLite WAL; `events.db-wal` = 515 K sin
  checkpoint reciente) + **`usuarios_colegios_oro.json`** (555 K, = `USERS_DB`).
- `public/uploads/` — 5 GB de contenido subido.

**Paths — hardcodeados / asumidos / relativos:**
- Todas las DB flat-file: `path.resolve(__dirname, '../data/<x>.json')` —
  **relativas a `server/`**. El código ASUME `/app/data` hermano de
  `/app/server` dentro del container. El compose lo garantiza.
- `USERS_DB`, `UPLOADS_ROOT`: vía env (`config.js`) — absolutos
  (`/data-critical/usuarios_colegios_oro.json`, `/app/public/uploads`).
- `.env`: `dotenv.config({ path: __dirname/../.env })` → `/app/.env` (fallback;
  en runtime las vars las inyecta compose vía `env_file`).
- Env leídas por `server.js`: `ACCESS_FALLBACK_MODE`, `ADMIN_SECRET`,
  `ALLOWED_ORIGINS`, `NODE_ENV`, `PORT`. Otros módulos: `GEMINI_API_KEY`,
  `OPENAI_API_KEY`, `AI_MODE`, `TTS_MODE`, `UV_THREADPOOL_SIZE`.

**Qué sobrevive reinicios y qué no:**
- ✅ Sobrevive: `data/`, `data-critical/`, `public/uploads/` (bind mounts on-host).
- ❌ Efímero: capa writable del container, `/tmp`. `node_modules` vive en la
  **imagen** `chibalete/api` — sobrevive restart pero se reemplaza al
  rebuild/cambio de imagen.

> 🔑 **Implicación clave:** el código (`server/`+`utils/`) está limpiamente
> separado del estado (`data*`/`uploads`). El swap atómico toca SOLO código —
> nunca datos. Buena arquitectura para deploy reversible. **Pero** `node_modules`
> vive en la imagen → ver §8 blocker B2.

## 3. Snapshot plan (FASE 3) — diseño, NO ejecutar

**A. Snapshot de código** (`server/` + `utils/`, ~1 MB total):
```bash
cd /var/www/chibalete
TS=$(date -u +%Y%m%dT%H%M%SZ)
tar czf /opt/chibaleteplus/snapshots/server-pre-v4.0.2-$TS.tar.gz   server/
tar czf /opt/chibaleteplus/snapshots/utils-pre-v4.0.2-$TS.tar.gz    utils/
```
Trivial (<1 s). Es el rollback primario del código.

**B. Backup crítico** (`data/`, `data-critical/`, `public/uploads/`):
- **SQLite — NO usar `cp`/`tar` crudo sobre DB viva** (el `-wal` sin checkpoint
  daría un backup inconsistente). Usar la API de backup online:
  ```bash
  sqlite3 /var/www/chibalete/data-critical/events.db ".backup '/opt/chibaleteplus/snapshots/events-$TS.db'"
  sqlite3 /var/www/chibalete/data/progress.db        ".backup '/opt/chibaleteplus/snapshots/progress-$TS.db'"
  sqlite3 /opt/chibaleteplus/snapshots/events-$TS.db  'PRAGMA integrity_check;'
  ```
- **JSON flat-file:** `writeJSON` del backend escribe con lock + rename atómico
  → un `cp` lee un archivo íntegro. `tar czf data-$TS.tar.gz data/` (excluyendo
  los `.db*` ya respaldados aparte). Consistencia *cross-file* no garantizada
  (aceptable para un backup de seguridad, no es un dump transaccional).
- **uploads (5 GB):** `tar cf uploads-$TS.tar public/uploads/` **sin gzip** (son
  imágenes/audio ya comprimidos — gzip añade minutos sin reducir tamaño).

**C. Naming + checksums:**
`<artefacto>-pre-v4.0.2-<UTC: YYYYMMDDTHHMMSSZ>[-<git_sha>].tar.gz` + `.sha256`
por archivo (`sha256sum … > ….sha256`).

**D. Ubicación + retención:**
- VPS: `/opt/chibaleteplus/snapshots/` (56 GB libres → +5 GB cabe).
- Off-host: traer al workstation **solo** los snapshots de código (~1 MB) y los
  `.db` (~3 MB) vía `scp`. uploads (5 GB) queda on-host (DR off-host = deuda §8).
- Retención: últimos 3 snapshots de código; el backup de `uploads` se hace 1×
  (cambia poco) — no re-snapshotear 5 GB en cada deploy.

**E. Tiempo estimado:** código <1 s · `.db` (`.backup`) ~1-3 s · `data/` tar
~2 s · `uploads/` tar ~1-3 min. **Total ~2-5 min.**

**F. Riesgos:**
| Riesgo | Mitigación |
|---|---|
| WAL SQLite sin checkpoint → backup inconsistente | usar `sqlite3 .backup` (online), no `cp` |
| Escritura concurrente a JSON | confiar en el rename atómico de `writeJSON`; idealmente snapshot en ventana de bajo tráfico |
| Corrupción del backup | `PRAGMA integrity_check` en los `.db` + verificación `sha256 -c` |
| Espacio en disco | 56 GB libres; retención limitada; no acumular backups de 5 GB |

## 4. Staging backend strategy (FASE 4) — diseño

**Objetivo:** dejar el backend v4.0.2 listo en el VPS **sin** reemplazar el
runtime activo.

- **Directorios staging** (junto a los vivos, NO los reemplazan):
  `/var/www/chibalete/server.v4.0.2` y `/var/www/chibalete/utils.v4.0.2`.
- **Sincronización — tarball + checksum** (reproducible, consistente con el
  artefacto frontend):
  1. En el workstation, desde el commit `6dc5efb`: `tar czf server-v4.0.2.tar.gz server/` y `utils-v4.0.2.tar.gz utils/`, generar `.sha256`.
  2. `scp` al VPS; verificar `sha256sum -c`.
  3. Extraer en `server.v4.0.2/` y `utils.v4.0.2/`.
- **Validación:**
  - `diff -rq /var/www/chibalete/server /var/www/chibalete/server.v4.0.2` →
    revisar el delta (será grande: estructura plana → anidada).
  - Conteo de archivos, permisos `644`/dirs `755`, manifest `sha256`.
  - Confirmar que `server.v4.0.2/server.js` corresponde a `6dc5efb`.
- **Confirmación de no-impacto:** `server.v4.0.2`/`utils.v4.0.2` son
  directorios **nuevos**, no montados por ningún container (el compose monta
  exactamente `server`/`utils`). Hasta el swap, el runtime activo **no los ve**.

## 5. Swap atómico plan (FASE 5) — diseño, NO ejecutar

**Pre-requisitos:** snapshot §3 hecho · staging §4 validado · imagen api
rebuildeada y tageada (§8 blocker B2).

```bash
cd /var/www/chibalete
TS=$(date -u +%Y%m%dT%H%M%SZ)

# 1. Swap atómico — 4 renames (cada mv es atómico en el mismo filesystem)
mv server  server.pre-v4.0.2-$TS
mv utils   utils.pre-v4.0.2-$TS
mv server.v4.0.2  server
mv utils.v4.0.2   utils
#  Los containers EN EJECUCIÓN siguen ligados al inode viejo — el path
#  `/var/www/chibalete/server` deja de existir microsegundos entre mv#1 y mv#3,
#  pero eso NO afecta a los containers vivos (no re-resuelven el path).

# 2. Recreate escalonado — FORCE-RECREATE obligatorio:
#    un bind mount se liga al inode en la CREACIÓN del container; `restart`
#    NO re-resuelve el path swappeado. Hay que recrear.
cd /opt/chibaleteplus
docker compose up -d --no-deps --force-recreate api_1
#    → validar (ver §7): health 200 + auth + smoke
docker compose up -d --no-deps --force-recreate api_2
#    → validar
```

**Rollback del swap** (si api_1 falla — DETENER antes de tocar api_2):
```bash
cd /var/www/chibalete
mv server server.failed-v4.0.2-$TS
mv server.pre-v4.0.2-$TS server
mv utils  utils.failed-v4.0.2-$TS
mv utils.pre-v4.0.2-$TS  utils
cd /opt/chibaleteplus && docker compose up -d --no-deps --force-recreate api_1 api_2
```

**Reglas:** `--no-deps` (no toca front/edge) · **nunca `docker compose down`** ·
`front`/`edge` intactos · `data*`/`uploads` jamás se mueven.

## 6. Rollback real (FASE 6) — diseño

Cobertura completa, en orden de menor a mayor invasividad:

| Capa | Cómo revertir | Tiempo |
|---|---|---|
| **env** | restaurar `.env` desde backup timestamped → `up -d --force-recreate api_1,api_2` | ~1 min |
| **compose** | `docker-compose.yml.bak-<ts>` → `mv` de vuelta | ~10 s |
| **server/utils** | swap inverso §5 (`mv pre-v4.0.2 → server`) + `--force-recreate` escalonado | ~2-3 min |
| **api image** | `docker compose` apuntando al tag inmutable previo + `--force-recreate` | ~1-2 min |
| **frontend** | recrear `chibalete_front` con tag previo — ver `RELEASE-v4.0.2.md §7` | ~1-2 min |

**Orden de rollback integral:** env → compose → server/utils → api image →
front. Cada paso: `--force-recreate` escalonado `api_1`→validar→`api_2`.

⚠️ **Pre-condición de rollback de imagen:** la imagen api actual usa el tag
**mutable `:latest`**. Antes de cualquier rebuild hay que **tagear la imagen
viva con un tag inmutable** (`chibalete/api:pre-v4.0.2` ó `:e73b9cf`) — si no,
el rollback de imagen no tiene destino. Ver §8 blocker B3.

**Validación post-rollback:** `/api/health` 200 · login admin real · escritura
admin (`x-admin-secret`) → 200 · `docker logs --since 5m` sin 5xx · `events.db`
sigue creciendo.

## 7. Health contract real (FASE 7)

Auditado contra producción (vía edge):

| Endpoint | Prod actual | v4.0.2 (`6dc5efb`) | Notas |
|---|---|---|---|
| `/api/health` | ✅ 200 (`status`, `version`, `uptime`, `instance`) | ✅ | público; `server.js:898` |
| `/api/system/metrics` | ✅ existe (admin-gated) | ✅ | `requireAdminAccess`; `server.js:901` |
| `/api/health/ready` | ❌ **404** | ✅ existe | readiness — solo en v4.0.2 |
| `/api/health/analytics` | ❌ **404** | ✅ existe | estado engines — solo en v4.0.2 |
| `/metrics` (Prometheus) | ❌ 200 pero devuelve **HTML del SPA** (edge rutea al front) | ❌ 404 local | no hay endpoint Prometheus real |
| Docker `healthcheck` | ❌ ninguno en los 4 containers | — | deuda operacional |

**Conclusión:** el contrato de health desplegado es **mínimo** (`/api/health` +
`/api/system/metrics`). El deploy de v4.0.2 **mejora** el contrato (añade
`ready` + `analytics`). `/metrics` Prometheus sigue siendo deuda (ausente / no
cableado incluso en v4.0.2 local). Recomendado **antes** del deploy integral:
añadir `healthcheck:` a `api_1`/`api_2` en el compose para que el restart
escalonado se valide solo en vez de depender de `curl` manual.

## 8. Readiness assessment (FASE 8)

### 🔴 Blockers reales

- **B1 — GET-bypass de auth en el backend desplegado.** `requireAdminAccess`
  hace `if (req.method==='GET') return next()` → todo GET admin pasa sin
  credencial. Es la razón del NO-GO. v4.0.2 (`6dc5efb`) **lo corrige** (fix P0)
  → desplegar v4.0.2 *resuelve* B1; es el motor del deploy, no un impedimento.
- **B2 — Rebuild de imagen api.** ✅ **RESUELTO (release v4.0.3).** Imagen
  `chibalete/api:v4.0.3` (= `v4.0.2-hardened`) construida: `multer 2.1.1`,
  multi-stage, 853 MB, `better-sqlite3` nativo validado. El deploy integral =
  swap de `server/`+`utils/` **+** `docker load` de esta imagen. Ver
  `V4-API-IMAGE-v4.0.2.md` + `V4-API-HARDENING.md`.
- **B3 — Tag de imagen mutable.** ✅ **RESUELTO.** `chibalete/api:pre-v4.0.2`
  (rollback inmutable) creado en el VPS; el release usa el tag inmutable
  `chibalete/api:v4.0.3`, no `:latest`.

### 🟡 Requiere trabajo

- Docker `healthcheck`: ✅ horneado en la imagen api `v4.0.3`
  (`/api/health/ready`); pendiente `edge`/`front` (menor — el de `api` es el
  crítico para el restart escalonado).
- Contrato de health incompleto en prod (`ready`/`analytics` ausentes hasta
  v4.0.2; `/metrics` Prometheus inexistente).
- Markers de deploy inconsistentes (`.deploy-info` vs `.release-marker`).
- `events.db-wal` 515 K sin checkpoint — checkpointar antes del snapshot.
- Snapshot/swap/rollback nunca formalizados — **esta doc los formaliza** (diseño;
  falta ejecutarlos en la ventana).

### 🟢 Listo / favorable

- Topología simple y limpia: 4 containers, 1 red, single-host.
- `server/`+`utils/` = ~1 MB → snapshot/staging/swap triviales.
- Código (`server`/`utils`) limpiamente separado del estado (`data*`/`uploads`)
  → el swap atómico nunca toca datos.
- Precedente de swap rename-based ya presente en el VPS.
- 56 GB de disco libre — espacio de snapshot holgado.
- `ADMIN_SECRET` rotado; frontend v4.0.2 listo y reproducible.

### Deuda conocida aceptable (no bloquea)

- Dirs `777` y clutter legacy en `/var/www/chibalete/` (`node_modules`, `src/`,
  `pages/`, `server.failed-*`, …) — housekeeping, fuera del path de deploy.
- `.ts` de frontend montados en el container api — inertes.
- DR off-host inexistente para los 5 GB de `uploads`.

### Riesgos operacionales

- Bind mounts vivos: el swap exige `--force-recreate` (un `restart` NO
  re-resuelve el path) — documentado en §5.
- Ventana de drift entre `api_1` (nuevo) y `api_2` (viejo) durante el restart
  escalonado — aceptable y transitorio; estado final consistente.
- Escrituras concurrentes durante el snapshot — mitigado en §3.F.

### Follow-ups

1. Rebuild + tag inmutable de la imagen `chibalete/api` para v4.0.2 (B2+B3).
2. Añadir `healthcheck:` a `api_1`/`api_2` en el compose.
3. Reconciliar los markers de deploy; un solo `.deploy-info` canónico.
4. Checkpoint de `events.db` WAL.
5. DR off-host para `uploads`.
6. Housekeeping de `/var/www/chibalete/` (clutter + perms 777).

## Veredicto

El deploy integral del backend está **completamente diseñado** (snapshot,
staging, swap atómico, rollback, health) y **consolidado en el release
`v4.0.3`**. **Topología 🟢 · Diseño 🟢 · B2 + B3 🟢 RESUELTOS** (imagen
hardened `chibalete/api:v4.0.3` + tag inmutable de rollback). Ejecución
pendiente de la ventana snapshot → staging → swap — secuencia exacta en
`RELEASE-v4.0.3.md §9`. B1 (GET-bypass) lo *resuelve* este mismo deploy.
Nada se ejecutó: esta fase es diseño y auditoría.
