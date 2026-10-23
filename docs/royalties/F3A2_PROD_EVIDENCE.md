# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A2 en producción (evidencia de cierre)

**Fecha:** 2026-10-23 (UTC) · **Commit desplegado:** `145934b38d7c3defba1d5a684a07124969967187` · **Plan:** `PLAN_GENERAL_V1_1.md` (sin cambios)
**Veredicto:** GREEN. Infraestructura de ingesta económica instalada con `ECONOMIC_INGEST_MODE` apagado; `econ_events` existe vacía; eventos tradicionales, progreso, accesos y métricas sin cambios.
**Implementación y pruebas:** `F3A2_ECON_INGEST.md`.

## 1. Commit desplegado

La unidad aprobó `0f24e56`. En el preflight se vio que en ese commit `econ_events` solo se creaba en la primera ingesta o lectura económica; con el flag apagado la tabla no habría existido en producción y el paso 6 («confirmar la creación de `econ_events` con sus restricciones») no se podía verificar. Con aprobación del usuario se añadió `145934b`:

- `ensureEconSchemaAtBoot` (`server/royalties/econEvents.mjs`): en `NODE_ENV=production` crea al arrancar la tabla, sus índices y los triggers append-only, sea cual sea el flag. Fuera de producción la creación sigue siendo perezosa.
- `server/server.js`: una llamada junto a la apertura de `royalties.db`, con el mismo patrón (un fallo se registra y no impide arrancar).
- Prueba `[10] esquema al arranque` en `econEvents.test.mjs` (67/0; antes 62/0).

La ingesta sigue gobernada por `ECONOMIC_INGEST_MODE` (off por defecto); el modo off no escribe en `econ_events`.

## 2. Gate de CI

- `145934b`: `content-rmw` e `identity-preflight` (incluye `test:royalties`) en **verde** al primer intento; image-integrity y gitleaks-head en verde. Los 5 jobs de `security` fallan igual que antes (deuda independiente).
- `0f24e56`: `content-rmw` verde; `identity-preflight` verde en `c650b5e` (mismo código de servidor).
- Linux (imagen API): `test:royalties` completo en verde (`economicEpisodes` 95, `econEvents` 67, `econIngestHttp` 23, resto sin cambios).

## 3. Despliegue

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Preflight | 01:34 | api_1/api_2 `royalties-f2b-ffc563b` (`54c9e489`) healthy; override `af0b7a43…`; 8,0 GB libres; `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` ausentes (= off); `SESSION_AUTH_MODE=enforce`, `UPLOADS_AUTHZ_MODE=strict`, `ACCESS_FALLBACK_MODE=restricted` |
| Respaldo previo | 01:34–01:35 | `structured-20261023T013451Z-08803451` (snapshot `38621afb`, 32 stores; `events.db` y `royalties.db` por SQLite online backup, `integrity ok`) |
| Imagen | 01:40 | `chibalete/api:royalties-f3a2-145934b` = `921fd77f39e9…`, `GIT_SHA=145934b`. Tarball sha256 `3e34154d…` verificado en el VPS (`sha256sum -c` OK); el ID coincide en local y en el VPS |
| Rollback preparado | 01:45 | tag `rollback-pre-f3a2` (= `54c9e489`), override `.bak-pre-f3a2-20261023T014503Z` (`af0b7a43…`), `/root/chp-f3a2/ROLLBACK.txt` |
| api_1 | 01:45:14 | solo la línea 40 del override; healthy |
| Gate api_1 (paso independiente) | 01:45–01:48 | ver §4 → GREEN |
| api_2 | 01:48:16 | solo la línea 85; healthy. Override final `c7d2e403…`; front sin tocar (`royalties-f1a-a3b704d`) |
| Respaldo posterior | 01:51 | `structured-20261023T015103Z-bae4b9e8` (snapshot `a9597d2d`) |
| Restauración aislada | 01:52 | ver §6 |

## 4. Gate por réplica

Ambas réplicas (api_1 antes de tocar api_2, en pasos separados):

- Imagen `921fd77f`, `GIT_SHA=145934b`, `NODE_ENV=production`, 0 reinicios, mismos bind mounts que antes.
- Arranque: `[PUBLISHERS] royalties.db ready` → `[ECON] econ_events schema ready (ingest=off)` → `Server running`. 0 líneas `ERROR`/`FATAL`.
- `/api/health` y `/api/health/ready` 200.
- Anónimo: `/api/content` 401, `/api/admin/publishers` 401, `POST /api/v1/events` 401; `POST /api/v1/events` con `x-user-id` y sin sesión 401 (enforce).

## 5. Estado de `events.db`

| | Antes | Después del deploy | Tras los smokes |
|---|---|---|---|
| `quick_check` | ok | ok | ok |
| `events` (n / maxId) | 2707 / 22194 | 2707 / 22194 | 2714 / 22201 |
| `econ_tick` en `events` | 0 | 0 | 0 |
| `econ_events` | no existe | existe, 0 filas | 0 filas |

- Objetos creados: `econ_events`, `ux_econ_session_event_ts`, `idx_econ_user_server_ts`, `idx_econ_server_ts`, autoíndice de `event_id UNIQUE`, triggers `econ_events_no_update` y `econ_events_no_delete` (`RAISE(ABORT, 'econ_events is append-only')`); `CHECK (event IN ('econ_tick','econ.session_start'))`.
- api_1 y api_2 abren el mismo archivo (`/app/data-critical/events.db`, inodo 786804) y ven el mismo esquema (hash de DDL `2c57f0afeeab` en ambas).
- La verificación de los triggers en producción es por DDL; no se ejecutaron escrituras de prueba en la base real. Su comportamiento está cubierto por `econEvents.test.mjs` [2].

## 6. Respaldos y restauración

- `events.db` capturado en ambos respaldos (9 269 248 bytes, `integrity_result ok`).
- Restauración aislada de `a9597d2d` en `/root/chp-f3a2/restore-5TsE/` y lectura en un contenedor desechable sin red: `integrity ok`, 2707 eventos, `maxId` 22194, `econ_events` presente con 0 filas y los 7 objetos. Coincide con el vivo en el momento del respaldo.

## 7. Invariantes

Idénticas antes y después del despliegue y tras los smokes: `RIGHTS_ENFORCEMENT_MODE` off; `access_db.json` sha `d4182a1d1152…`, 22 reglas, 0 con campos comerciales; b2c `f40a7988…` / `055afc8f…`; `content.json` `9faaf685…`, 109 registros con `publisherId`; `royalties.db` integrity ok, 0 versiones de derechos, titular `pub-chibalete-editores` activo.

## 8. Smokes productivos

Sesiones abiertas por el usuario en Chrome; solo lecturas, salvo la navegación normal del lector.

- **Lector** (`-092`): catálogo `bfef49de05bd`, 89 obras, 8/8 iguales (igual que F2-B); acceso 200/true en 8 obras; rutas de admin 403; sin campos comerciales ni económicos en el catálogo. Biblioteca (96 tarjetas) y visor PDF de *La metamorfosis* operativos: `POST /api/v1/events` y `progress/.../sync` 200 en ambas réplicas. Se registraron 7 eventos tradicionales (`reading_started`, `pdf.page_change` ×2, `reading_progress` ×2, `session_heartbeat`, `session_ended`) y ningún tick económico.
- **Mediador** (`-172`): catálogo `111c38243d5a`, 109 obras, 8/8 (igual que F2-B); acceso 200/true; grupo con `analytics-summary` 200 estable 4/4; rutas de admin 403; `/api/metrics/*` 403 como antes (F3-A2 no toca esas rutas).
- **Admin** (`1774362611303`): matriz comercial 22/22 `unclassified`, 0 elegibles, 0 con historial (6/6 iguales); derechos `mode=off`, 0 versiones; titular activo; 21 grupos con `analytics-summary` 200 estable; `/api/health/analytics` ok en las dos réplicas, con el mismo recuento (2714) y el materializador de Aula Viva al día (`last_event_id` 22201, lag 0).
- **Resultado:** ninguna atribución ni liquidación económica generada (`econ_events` 0 filas, 0 líneas `econ_tick accepted` en los logs); 0 errores nuevos en las dos réplicas.

## 9. Rollback

No fue necesario. Procedimiento: restaurar `docker-compose.override.yml.bak-pre-f3a2-20261023T014503Z`, `docker compose up -d --no-deps api_1`, validar y repetir con api_2 (`/root/chp-f3a2/ROLLBACK.txt`). `econ_events` puede quedarse en `events.db`: la imagen previa no la lee y la rotación no la toca.

## 10. Pendiente

- F3-A3 (emisión de ticks desde los visores) no iniciada. La ingesta debe seguir apagada hasta entonces.
- Decisiones abiertas: P7 (cuentas internas; `ROYALTIES_INTERNAL_USER_IDS` vacía), P9 (clasificación regla por regla), política de conservación de `econ_events`.
- El directorio de restauración `/root/chp-f3a2/restore-5TsE/` y el tarball quedan en el VPS para auditoría; se pueden retirar cuando el usuario lo indique.
