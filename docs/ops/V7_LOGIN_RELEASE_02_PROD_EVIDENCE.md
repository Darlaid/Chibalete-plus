# V7-LOGIN-RELEASE-02 — Evidencia de despliegue (limitadores de login y `/api`)

**Fecha:** 2026-11-05, 15:38–15:56Z; observación posterior hasta 2026-11-06 00:28Z.
**Veredicto:** `GREEN_PROD_LOGIN`.

## Release

| | Antes | Después |
|---|---|---|
| `api_1`, `api_2` | `chibalete/api:g4inert-cf27126` = `sha256:e19c1283d5e7ce306696ea9e0a2bcf6c132decaaea2fe145b332e4a0d69b8605` | `chibalete/api:ratelimit-f11fecd` = `sha256:c97588570eaf9cfe4963d4336f27ef9e7cbfc397a86b5c79d5a8b9e72399c1d4` |
| `front` | `chibalete/front:uxfix-b18f6f0` = `d3a4dd648181…` | sin tocar |
| Override | `4fc289cc…` | `0b745ed7…` (solo líneas 40 y 85) |

- **Commit:** `f11fecd539456fa1b995957723be6172f5c19d38`. Contiene `601ca03` (login), `d60d85a` (limitador general) y `f11fecd` (copia de 5 s de las claves para elegir el cubo).
- **CI:** 10/10 jobs en verde.
- **Imagen:** linux/amd64, construida con `git -c core.autocrlf=false archive`, con `GIT_SHA` y `RELEASE_TAG` pasados como argumentos. Trivy 0 HIGH/CRITICAL.
- **Frente a `g4inert-cf27126`:**
  - 433 dependencias idénticas.
  - Solo difieren `server.js`, `package.json` (scripts de test), `server/lib/loginRateLimits.mjs`, `server/lib/apiRateLimit.mjs` y dos archivos de `utils/` que el servidor no carga.
- **Artefacto:** `.tar` con SHA-256 `23607251611d00f824946df2d8f3e57ba308c57945d7f8375cdfd35092777439`. Verificado en el VPS con `sha256sum -c` antes de `docker load`; el ID cargado coincide completo.

## Preflight

- **Contenedores:** los cuatro healthy, RestartCount 0, digests esperados.
- **Configuración:** `docker compose config --images` coincide con el override. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno --> El upstream del edge es igual en host y contenedor.
- **Respaldo:** `structured-backup` del 2026-11-05 a las 12:02Z, ok. Snapshot `2668f146`, 32 stores, `gamification.db` = `absent_optional`. Ningún respaldo en curso; el siguiente era a las 18:03Z.
- **Montajes:** 7 por réplica. `.deploy-info` sigue montado de `release/2945fa8`.
- **Gamificación:** 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`, sin clave de sujeto y sin `gamification.db`.
- **Rollback preparado:**
  - Imagen `chibalete/api:rollback-pre-ratelimit` = `e19c1283`.
  - Override `docker-compose.override.yml.bak-pre-ratelimit-20261105T154012Z` (byte-idéntico al vivo).
  - Instrucciones en `/root/chp-ratelimit/ROLLBACK.txt`.
- **Huellas previas:** `/root/chp-ratelimit/stores-pre.txt`, con SHA-256 completo.
- **Defecto observado en vivo, antes del cambio:** `RateLimit-Remaining` congelado en 1499, tanto anónimo como con sesión.

## Ventanas

| Réplica | Drain | Recreate | Healthy | Rejoin |
|---|---|---|---|---|
| `api_1` | 15:46:52Z | 15:47:59Z | 15:48:17Z | 15:49:04Z |
| `api_2` | 15:53:12Z | 15:54:18Z | 15:54:30Z | 15:55:07Z |

**Gate dentro del contenedor (réplica fuera del pool), en cada réplica:**
- ID aprobado y RestartCount 0.
- Los mismos 7 montajes y los mismos nombres de entorno. `ARCHIVE_ROTATION_ENABLED` sigue solo en `api_1`.
- `GIT_SHA` = `f11fecd…` y 0 errores en el log.
- El cupo anónimo de una IP de prueba baja de uno en uno.
- `x-user-id` rotado y una cookie basura caen en el mismo cubo de la IP.

**Gate autenticado** (sesión del administrador, solo GET, vía edge), tras el rejoin de cada réplica:
- `/api/auth/me` → 200, y `RateLimit-Remaining` de la cuenta baja en la réplica nueva.
- `x-user-id` ajeno junto a la sesión → 401 (`subject_mismatch`, comportamiento previo), y se descuenta del cubo de la misma cuenta.
- `/api/me/progress` → 404.
- Biblioteca (editorial e institucional), `my-catalog`, Experiencias, Studio (`admin/list`, `review/queue`), grupos y Aula Viva → 200 en las dos réplicas.

El gate de `api_1` se leyó en un paso propio antes de tocar `api_2`: 0 errores, 0 5xx y 0 429 en el edge.

## Después

- **Imagen:** las dos réplicas corren `c9758857…`, RestartCount 0. El pool reparte 20/20 en 40 sondas.
- **Login autorizado con la imagen nueva:** logout y login del operador → 200 en ambas réplicas. La sesión nueva conserva el cupo de la cuenta.
- **Observación hasta las 00:28Z:**
  - APIs: 3191 peticiones, 0 5xx, 0 429, 0 errores y 0 líneas de gamificación, ledger o reconciliación.
  - Edge: 0 5xx de upstream y 0 `[error]`.
- **Stores:** idénticos al preflight (MOOK, catálogo, grupos, accesos, entregas, progreso, 3524 uploads, 0 `.tmp`/`.lock`), salvo el padrón. Su `lastLoginAt` cambió por los logins del operador (15:46:16Z, `POST /api/auth/login 200` con la imagen antigua, y 00:27:20Z con la nueva).
- **Respaldos posteriores:** snapshots `c8311ff9` (18:03Z) y `9a0ce959` (00:01Z), ok, 32 stores, `gamification.db` = `absent_optional`.
- **Bitácora:** entrada `20261106T002830Z` en `/root/deploys.log`.

## Deudas (diferibles)

- `.deploy-info` montado de `release/2945fa8`: `/api/health` informa `commit 2945fa8`. La imagen sí lleva `GIT_SHA` = `f11fecd…`. No se corrigió porque no hay un procedimiento validado.
- Carrera keepalive edge (60 s) frente a Node (5 s): 502 esporádicos ya conocidos. No apareció en esta ventana.
- Contadores en memoria por réplica: el techo real es 2× y se reinicia con el contenedor. Un anónimo detrás del NAT de un colegio puede agotar el cubo de esa IP durante 15 min. Las APK antiguas que solo mandan `x-user-id` comparten el cubo de la IP.
