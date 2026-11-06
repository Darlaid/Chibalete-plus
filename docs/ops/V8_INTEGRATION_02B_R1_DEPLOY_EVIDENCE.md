# V8-INTEGRATION-02B-R1 — Evidencia del despliegue inerte de V8 (con musl corregido)

**Fecha:** 2026-11-06, 20:28–21:10Z. **Veredicto:** `GREEN_PROD_V8_INERT`.

## Release

| | Antes | Después |
|---|---|---|
| `api_1`, `api_2` | `chibalete/api:zlib-6d09d47` = `sha256:2dd5ed8dc2b5e53c06d4bee40b45a1302d354b727bd1cfad4caa1b8b07dbfc48` | `chibalete/api:v8inert-0665c16` = `sha256:020d90e3c75b547b1d4e03ff4969feb35062b90768689f93f53c7e46932591ac` |
| `front` | `chibalete/front:uxfix-b18f6f0` = `sha256:d3a4dd64818165cac79619f5dd67d1e35887205e4cec5929fe81b38021cc3c50` | `chibalete/front:v8inert-0d2ef7b` = `sha256:a7fd0ccf04f2e1fc2945d311914e813c23d27b717d60765935b3f1d92d1bd821` |
| Override | `391d2ce0…` | `14452c49…` (solo líneas 40, 85 y 130) |

- **Commit:** `0665c1669ae9f96944ad7e976c57e3d86bdaeb8b` (SEC-MUSL-2026-01), encima de `0d2ef7b` (V8). Publicado por avance normal.
- **Cambio de musl:** solo `Dockerfile.api`. El `apk add` del runtime exige `'musl>=1.2.5-r24'` y `'musl-utils>=1.2.5-r24'`.
  - Con solo `musl`, `musl-utils` (del base) se quedaba en `1.2.5-r23` y Trivy seguía marcando la CVE. Se exigió también, en la misma línea.
  - Es la misma versión 1.2.5, así que el ABI con el que se compilaron los addons nativos no cambia. `better-sqlite3` y `@napi-rs/canvas` cargan.
- **zlib:** el piso `>=1.3.2-r1` hoy lo resuelve Alpine con `zlib 1.4-r0`. Solo `apk`/`libapk` enlazan esa libz; `node` lleva la suya embebida (`1.3.1-e00f703`).
- **Vulnerabilidad:** CVE-2026-107891 (HIGH, desbordamiento de entero en `regcomp`), en `musl` y `musl-utils` `1.2.5-r23`. Corregida en `1.2.5-r24`. La imagen productiva anterior la tenía.
- **CI de `0665c16`:** `security` (incluido `trivy-image (api)`, bloqueante), `content-rmw` e `identity-preflight` en verde.
- **Front:** se reutiliza la imagen ya construida desde `0d2ef7b`. Entre `0d2ef7b` y `0665c16` solo cambia `Dockerfile.api`, que el front no usa. Frente a `uxfix-b18f6f0`, el front solo difiere en `MiProgreso.tsx` y `myProgressView.mjs`, que no se muestran con las flags apagadas.

## Imágenes y artefactos

- Construidas con `git -c core.autocrlf=false archive` del commit, para `linux/amd64`. La API lleva `GIT_SHA` y `RELEASE_TAG`; el front, el commit en sus etiquetas OCI.
- **Trivy 0.69.3** (base de datos del día, configuración de CI): API 0 HIGH/CRITICAL y front 0 HIGH/CRITICAL.
- **`verify-image-integrity.mjs`:** 51 ok, 0 fallos.
- **`/app` frente a `zlib-6d09d47`:** solo difieren los 8 archivos de V8 (`progress.mjs`, `mookSource.mjs`, `server.js`, `myProgressView.mjs`, `package.json` y tres tests). `node_modules` idéntico.
- **Sin stores ni secretos:** no hay `data/`, `data-critical/`, `.env` ni bases `.db`, y `secrets/` está vacío.
- **Artefactos:** verificados en el VPS con `sha256sum -c` antes de `docker load`. Los IDs cargados coinciden completos.
  - `api-v8inert-0665c16.tar.gz`: `0c6f195e6ffcc8509e74b8746e37c0b9385c36c6a4b4b32da5784960cd65318d` (151 930 595 B).
  - `front-v8inert-0d2ef7b.tar.gz`: `b48b1d65cb82fed0e902bdf94f42449349c4c6a166ec2a419f6c4f79e1595cf6` (28 663 576 B).

## Laboratorio

**Suites dentro de la imagen** (sin red, sin datos), con la productiva como control:
- Pasan salud, limitadores, atomicidad del login, sesiones, permisos, MOOK, Studio, revisión entre réplicas, progreso, EPUB y uploads estrictos.
- También el núcleo completo de gamificación: ledger, concurrencia, aislamiento, reconocimiento, bloqueos de emisión, reconciliadores por lotes y con lock, «Mi progreso» 71/71, agregados de grupo 34/34, `platformIntegration` 58/58 (dos réplicas reales, 30/20/50, k ≥ 5, coherencia transaccional) y `platformScale` 17/17 (cuatro reconciliadores concurrentes sin duplicados).
- Las 6 suites que fallan lo hacen igual en la imagen productiva: leen `components/` u `ops/`, que la imagen no incluye. En el repositorio pasan.

**Laboratorio integral** (dos réplicas API y front candidatos, datos solo sintéticos, flags apagadas). Es la secuencia de G3B (`setup`, `create`, `publish`, `flows`, `flows2`) más un gate inerte de 31 comprobaciones.
- Resultados idénticos con las imágenes candidatas y con las productivas. `flows` da 40/6, con los mismos 6 fallos de secuencia del script registrados en G3B, y `flows2` da 13/0.
- Gate inerte 31/0: sesiones, rutas, limitador, acceso explícito por grupo, recurso protegido, `/api/me/progress` en 404 para los cuatro roles, sin campo `recognition`, sin variables ni archivos de gamificación y sin líneas de reconciliación o ledger.
- **Navegador:** lector y administrador en escritorio y móvil, sin desbordamiento horizontal, visor de texto, `/mi-progreso` redirige a Inicio y no hay XP, niveles, logros ni enlace a «Mi progreso».

## Preflight

- Los cuatro contenedores healthy, RestartCount 0, IDs esperados. El override (`391d2ce0`) coincide con `docker compose config --images`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno -->
- **Respaldo:** `structured-backup` del 2026-11-06 a las 18:05Z, `result=ok`, snapshot `d6f864a2`, 32 stores.
- **Disco y recursos:** 58 GB libres, 6,7 GB de memoria disponible.
- **Gamificación:** 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`, sin clave de sujeto, sin registro y sin `gamification.db`.
- **MOOK:** «La tortuga…» en `draft`, 0 recorridos y 0 entregas.
- **Línea base de la última hora:** 0 5xx y 0 errores.
- **Rollback preparado:**
  - Imágenes `chibalete/api:rollback-pre-v8inert` (= `2dd5ed8d`) y `chibalete/front:rollback-pre-v8inert` (= `d3a4dd64`).
  - Override `docker-compose.override.yml.bak-pre-v8inert-20261106T204810Z` (byte-idéntico).
  - Instrucciones en `/root/chp-v8inert/ROLLBACK.txt`.

## Ventanas

| Réplica | Drain | Recreate | Healthy | Rejoin |
|---|---|---|---|---|
| `api_1` | 20:49:43Z | 20:50:24Z | 20:50:34Z | 20:51:18Z |
| `api_2` | 20:54:17Z | 20:55:23Z | 20:55:36Z | 20:56:13Z |
| `front` | — | 20:57:11Z | 20:57:20Z | reload del edge 20:57:21Z |

La primera orden de recreate de `api_1` (20:49:44Z) usó el nombre del contenedor en vez del servicio (`api_1`). Compose la rechazó sin tocar nada, y la réplica siguió drenada hasta el recreate correcto.

**Gate dentro del contenedor (réplica fuera del pool), en cada réplica:**
- ID aprobado, RestartCount 0 y los mismos 7 montajes.
- Entorno igual al previo salvo `GIT_SHA` y `CHIBALETE_RELEASE`, que vienen de la imagen. `ARCHIVE_ROTATION_ENABLED` sigue solo en `api_1`.
- Paquetes `musl`/`musl-utils` `1.2.5-r24`.
- Código V8 presente y `mook_review` en `XP_LOCKED_SOURCES`.
- G4 en proceso: `readMyProgress` → `{status:404}`, sin leer MOOK. `readGroupRecognition` y `startMookReconciler` → `null`.
- Salud 200 y 0 errores en el log.

**Gate autenticado** (sesión del administrador en el navegador, solo GET, vía edge), con ráfagas paralelas para cubrir las dos réplicas:
- Biblioteca (editorial, institucional y personal), `my-catalog`, Experiencias, Studio (`admin/list`, `review/queue`), grupos y `analytics-summary` → 200, sin campo `recognition`.
- `/api/me/progress` → 404, 12 de 12 en `api_1` y 14 de 14 en cada réplica tras `api_2`.
- `x-user-id` ajeno → 401.
- Pool 10/10.
- Login ficticio con IP de prueba en cada réplica → 401 con `ratelimit-limit=5`.

El gate de `api_1` se leyó en un paso propio antes de tocar `api_2`.

**Front:**
- `nginx -t` correcto en el front y en el edge. `default.conf` productivo intacto (mismo SHA-256).
- Bundle `index-s36cyGLd.js`. Los 74 assets responden 200, igual que `epub-reader.html`, `sw.js` y los estáticos montados.
- Inicio, Biblioteca, Experiencias, Aula Viva, Panel Admin, Usuarios, Perfil, Multimedia y Bitácora cargan sin errores de la aplicación en consola.
- No hay XP, niveles, logros ni enlace a «Mi progreso», y `/mi-progreso` redirige a Inicio.

## Después

- **Imágenes:** las dos réplicas corren `020d90e3…` y el front `a7fd0ccf…`, todos healthy con RestartCount 0. El override es `14452c49…`.
- **Stores:** idénticos byte a byte al preflight (padrón, MOOK, catálogo, grupos, accesos, entregas, progreso; 3524 uploads; 0 `.tmp`/`.lock`). Sin archivos de gamificación. MOOK «La tortuga…» sigue en borrador, con 0 recorridos y 0 entregas.
- **Observación:** ver la sección «Observación» al final.

## No verificado

- Un login real con contraseña después del cambio, y los visores abiertos con una cuenta real (envían progreso por POST). Los dos se probaron en el laboratorio con la misma imagen.
- La vista móvil en producción: la ventana del navegador no aceptó el cambio de tamaño. Se comprobó en el laboratorio con la misma imagen del front.

## Deudas (diferibles)

- La base `node:20-alpine` está fuera de soporte: seguirán apareciendo vulnerabilidades del sistema hasta migrar de versión de Node.
- `.deploy-info` sigue montado de `release/2945fa8`.

## Observación (20:49–21:07Z)

- **APIs:** `api_1` atendió 189 peticiones y `api_2` 91 (sin contar `/metrics`). 0 5xx, 0 429, 0 errores de nivel 50+, 0 `[ERROR]` y 0 líneas de reconciliación, ledger o reconocimiento. RestartCount 0.
- **Edge:** 465 líneas, 0 5xx de upstream y 0 `[error]`. Front healthy, RestartCount 0, 0 `[error]`.
- **Stores:** idénticos al preflight a las 21:07Z.
- **Bitácora:** entrada `V8-INTEGRATION-02B-R1` en `/root/deploys.log`.
