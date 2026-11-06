# SEC-ZLIB-2026-DEPLOY — Evidencia de despliegue (CVE-2026-85091, zlib)

**Fecha:** 2026-11-06, 14:42–15:03Z. **Veredicto:** `GREEN_PROD_ZLIB`.

## Release

| | Antes | Después |
|---|---|---|
| `api_1`, `api_2` | `chibalete/api:ratelimit-f11fecd` = `sha256:c97588570eaf9cfe4963d4336f27ef9e7cbfc397a86b5c79d5a8b9e72399c1d4` | `chibalete/api:zlib-6d09d47` = `sha256:2dd5ed8dc2b5e53c06d4bee40b45a1302d354b727bd1cfad4caa1b8b07dbfc48` |
| `front` | `chibalete/front:uxfix-b18f6f0` = `d3a4dd648181…` | sin tocar |
| Override | `0b745ed7…` | `391d2ce0…` (solo líneas 40 y 85) |

- **Commit:** `6d09d472fd5979493c5dd090919e59a2a6cc4b0c`. Solo cambia `Dockerfile.api`: añade `'zlib>=1.3.2-r1'` al `apk add` del runtime, con el mismo criterio de piso que `libssl3`/`libcrypto3` (la base `node:20-alpine` está fijada por digest y no se republica).
- **CI sobre ese SHA:** `security` 8/8 (incluido `trivy-image (api)`), `content-rmw` e `identity-preflight` en verde.
- **Vulnerabilidad:** CVE-2026-85091 (HIGH), desbordamiento en `gz_vacate()`. Alpine la corrige en `zlib 1.3.2-r1`. En producción había `1.3.2-r0`. Solo `apk`/`libapk` enlazan la libz del sistema: `node` lleva su zlib embebido (`process.versions.zlib` = `1.3.1-e00f703`) y los addons nativos (`better_sqlite3.node`, `skia.*.node`) no enlazan libz.
- **Imagen:** `linux/amd64`, construida con `git -c core.autocrlf=false archive 6d09d47`, con `GIT_SHA` y `RELEASE_TAG` como argumentos.
  - Trivy 0.69.3 con la configuración de CI: la productiva reproduce la CVE; la candidata da 0 HIGH/CRITICAL.
  - `verify-image-integrity.mjs`: 51 ok, 0 fallos.
- **Frente a `ratelimit-f11fecd`:** `/app` idéntico en sus 31 952 archivos. Solo difieren `/usr/lib/libz.so.1.3.2` y los metadatos de apk (`/etc/apk/world`, `/lib/apk/db/installed`, `/var/log/apk.log`). Entorno, entrypoint, comando, puertos y healthcheck iguales, salvo etiqueta y SHA.
- **Pruebas dentro de la imagen** (sin red, sin datos montados, con la productiva como control): mismos resultados en las dos. Pasan salud, limitadores de login y `/api`, atomicidad del login, sesiones, permisos, MOOK, Studio, progreso, EPUB, descargas protegidas y «Mi progreso». Las 5 suites que fallan en ambas son comprobaciones estructurales que leen `components/`, `pages/`, `services/` u `ops/`, que la imagen no incluye; CI las ejecuta en el repositorio.
- **Artefacto:** `.tar.gz` con SHA-256 `93a2590892eb4dffb5565c9ef7df9119f0336bf2633ba1b6d27e5893dbf7a5e9`. Verificado en el VPS con `sha256sum -c` antes de `docker load`; el ID cargado coincide completo.

## Preflight

- **Contenedores:** los cuatro healthy, RestartCount 0, IDs esperados.
- **Configuración:** `docker compose config --images` coincide con el override. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno --> Upstream del edge igual en host y contenedor.
- **Respaldo:** `structured-backup` del 2026-11-06 a las 12:01Z, `Result=success`. Snapshot `075567ba`, 32 stores, `gamification.db` = `absent_optional`. Ninguno en curso; el siguiente, a las 18:04Z.
- **Montajes:** 7 por réplica. `.deploy-info` sigue montado de `release/2945fa8`.
- **Gamificación:** 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`, sin clave de sujeto y sin `gamification.db`.
- **Disco:** 58 GB libres.
- **Línea base de la última hora:** 0 5xx, 0 429 y 0 errores en las APIs; 0 5xx de upstream en el edge.
- **Rollback preparado:**
  - Imagen `chibalete/api:rollback-pre-zlib` = `c9758857`.
  - Override `docker-compose.override.yml.bak-pre-zlib-20261106T144347Z` (byte-idéntico al vivo).
  - Instrucciones en `/root/chp-zlib/ROLLBACK.txt`.
- **Huellas previas:** `/root/chp-zlib/stores-pre.txt`, con SHA-256 completo.

## Ventanas

| Réplica | Drain | Recreate | Healthy | Rejoin |
|---|---|---|---|---|
| `api_1` | 14:45:24Z | 14:46:30Z | 14:46:42Z | 14:47:34Z |
| `api_2` | 14:49:33Z | 14:50:39Z | 14:50:51Z | 14:51:30Z |

**Gate dentro del contenedor (réplica fuera del pool), en cada réplica:**
- ID aprobado y RestartCount 0.
- Los mismos 7 montajes.
- Entorno igual entre réplicas, comparando nombres y huella de los valores sin imprimirlos. `ARCHIVE_ROTATION_ENABLED` sigue solo en `api_1`.
- `GIT_SHA` = `6d09d47…`, zlib `1.3.2-r1`, 0 errores en el log.
- El cupo anónimo de una IP de prueba baja de uno en uno, y `x-user-id` rotado más una cookie basura caen en el mismo cubo.

**Gate autenticado** (sesión del administrador en el navegador, solo GET, vía edge), tras el rejoin de cada réplica:
- `/api/auth/me` → 200; el cupo de la cuenta baja en ambas réplicas.
- `x-user-id` ajeno junto a la sesión → 401.
- `/api/me/progress` → 404.
- Biblioteca (editorial e institucional), `my-catalog`, Experiencias, Studio (`admin/list`, `review/queue`), grupos y Aula Viva (`analytics-summary`) → 200 en las dos réplicas.

El gate de `api_1` se leyó en un paso propio antes de tocar `api_2`: 0 errores, 0 5xx y 0 429 en las APIs y el edge. Los avisos de nivel 40 eran las respuestas 401/404 de las propias sondas.

## Después

- **Imagen:** las dos réplicas corren `2dd5ed8d…`, RestartCount 0, zlib `1.3.2-r1`. El pool reparte 20/20 en 40 sondas.
- **Limitador de login:** un login ficticio desde una IP de prueba, en cada réplica → 401 con `ratelimit-limit=5`.
- **Observación hasta las 15:02Z:** 147 peticiones en las APIs, 0 5xx, 0 429, 0 errores y 0 líneas de gamificación, ledger o reconciliación. Edge: 0 5xx de upstream y 0 `[error]`.
- **Stores:** idénticos byte a byte al preflight (padrón, MOOK, catálogo, grupos, accesos, entregas, progreso; 3524 uploads; 0 `.tmp`/`.lock`).
- **Front y edge:** sin recrear.
- **Bitácora:** entrada `20261106T150259Z` en `/root/deploys.log`.

## No verificado

- Un login real con contraseña después del cambio. Durante la ventana no hubo logins de usuarios, y el operador no introduce contraseñas. Las sesiones firmadas existentes sí funcionan en las dos réplicas.

## Deudas (diferibles)

- La base `node:20-alpine` está fuera de soporte: seguirán apareciendo vulnerabilidades del sistema hasta migrar de versión de Node.
- `.deploy-info` montado de `release/2945fa8`: `/api/health` informa `commit 2945fa8`. No se corrigió porque no hay un procedimiento validado.
