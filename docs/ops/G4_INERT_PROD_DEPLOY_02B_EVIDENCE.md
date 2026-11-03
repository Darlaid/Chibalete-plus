# G4-RELEASE-GATE-02B — Evidencia de despliegue (G4 inerte)

**Fecha:** 2026-11-03, 21:45–21:59Z. **Veredicto:** `GREEN_PROD_G4_INERT`.
Plan seguido: `docs/ops/G4_INERT_RELEASE_PLAN.md`.

## Release

| | Antes | Después |
|---|---|---|
| `api_1`, `api_2` | `chibalete/api:secdeps-0a606c0` = `12460b15e61a…` | `chibalete/api:g4inert-cf27126` = `e19c1283d5e7…` |
| `front` | `chibalete/front:g0-f4836d1` = `805ab8289273…` | `chibalete/front:g4inert-cf27126` = `d4c12a327360…` |
| Bundle | `index-ChR_mnBe.js` | `index-DHf-fgYI.js` |
| Override | `b7ddcc3f…` | `a30c2934…` (solo líneas 40, 85 y 130) |

Commit de las imágenes: `cf27126` (CI 10/10). Artefactos verificados por SHA-256 en el VPS antes de `docker load`.

## Preflight

- Cuatro contenedores healthy, RestartCount 0, digests esperados; edge host == contenedor.
- Sin variables `GAMIFICATION_*`/`XP_*`/`PM_*`, sin clave de sujeto, sin `gamification.db`.
- 61 GB libres; sin procesos de respaldo.
- Respaldo previo: `structured-backup` snapshot `b257b74e` (32 entradas, `gamification.db` = `absent_optional`).
- Rollback: `chibalete/api:rollback-pre-g4inert`, `chibalete/front:rollback-pre-g4inert`, `docker-compose.override.yml.bak-pre-g4inert-20261103T214711Z`, `/root/chp-g4inert/ROLLBACK.txt`.

## Ventana 1 — API

| Réplica | Drain | Recreate | Healthy | Gate |
|---|---|---|---|---|
| `api_1` | 21:47:54Z | 21:49:03Z | 21:49:19Z | Mounts iguales; 0 errores y 0 5xx; anónimo y `x-user-id` → 401; `readMyProgress` → 404, reconocimiento y reconciliador → `null`; sin ledger |
| `api_2` | 21:52:04Z | tras 65 s de drain | 21:53:22Z | Mismo gate |

Pool tras cada rejoin: 20/20 por instancia. 5xx del edge desde 21:47Z: 0.

Gate autenticado (sesión de administrador existente, solo GET): `/api/me/progress` → 404;
catálogo 110; acceso a un libro permitido; Studio y experiencias listan; cola vacía;
resumen del grupo de 400 miembros en 370 ms **sin** `recognition`. Permisos de mediador
y lector verificados en laboratorio con la misma imagen (`e19c1283`).

## Ventana 2 — front

Recreado con el `default.conf` endurecido de `front-m1` intacto; `nginx -t` y reload del edge.
`/`, `robots.txt`, `sitemap.xml`, `epub-reader.html` y los chunks de los visores → 200;
`/.env` y `/wp-admin` → 404. Escritorio: Inicio, Biblioteca, Experiencias, Aula Viva, Studio
y Perfil sin errores, sin XP, nivel, racha ni «Puntos de Magia», sin «Mi progreso» ni bloque
de reconocimiento y sin ninguna petición de escritura. Móvil (360 px): Biblioteca sin
desbordamiento horizontal. Los visores no se abrieron con la cuenta real (envían progreso);
su bundle es byte-idéntico al validado en laboratorio.

## Después

- Cuatro contenedores healthy, RestartCount 0; 0 errores, 0 5xx y 0 líneas de gamificación en logs.
- Stores críticos (padrón, MOOK, catálogo, grupos, accesos, entregas, progreso) y conteo de uploads
  **idénticos** al preflight; sin `.tmp` ni `.lock`.
- Respaldo posterior: snapshot `5b114230`, 32 entradas, `gamification.db` = `absent_optional`.
- Bitácora: entrada `20261103T215912Z` en `/root/deploys.log`.

## Deudas

- `.deploy-info` montado desde `release/2945fa8` sigue informando una release antigua; no corregido (sin procedimiento validado).
- La imagen API se construyó sin `--build-arg GIT_SHA`/`RELEASE_TAG`: `GIT_SHA` y `CHIBALETE_RELEASE` valen `unknown`. Solo afecta a la versión que informan el health y la observabilidad. Las próximas construcciones deben pasar ambos argumentos.
