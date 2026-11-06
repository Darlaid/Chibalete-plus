# V8-ACTIVATE-PREP-02 — Evidencia del despliegue de F1 con G4 inerte

**Fecha:** 2026-11-06, 22:16–22:40Z. **Veredicto:** `GREEN_PROD_F1_INERT`.

F1 es el desbloqueo técnico de `mook_review` (V8-ACTIVATE-PREP-01): sale de `XP_LOCKED_SOURCES` y solo puede dar XP por el reconocimiento aprobado. **No activa nada.** Producción sigue sin flags, sin clave, sin registro, sin reglas y sin experiencia publicada, así que ninguna réplica puede conceder XP.

## Release

| | Antes | Después |
|---|---|---|
| `api_1`, `api_2` | `chibalete/api:v8inert-0665c16` = `sha256:020d90e3c75b547b1d4e03ff4969feb35062b90768689f93f53c7e46932591ac` | `chibalete/api:f1prep-84372c2` = `sha256:0fffb57998c09e8eebb2dfdf82a05aca07b908ec580579eb3e496d5d0c2d3fe3` |
| `front` | `chibalete/front:v8inert-0d2ef7b` = `a7fd0ccf…` | sin tocar |
| Override | `14452c49…` | `ccdf69d1…` (solo líneas 40 y 85) |

- **Commit:** `84372c237ad01395b30c8a56e695f448f0a4e52a`. CI `security`, `content-rmw` e `identity-preflight` en verde. En el log de G3 aparecen `mookReviewUnlock` 53/0, `xpPilotEmission` 71/0 y `platformIntegration` 58/0.
- **Cambio de código en ejecución:** `server/gamification/policy.mjs`.
  - `XP_LOCKED_SOURCES` = `reading_completion`, `offline_validation`.
  - Nuevos `XP_RECOGNITION_ONLY_SOURCES = ['mook_review']` e `isXpLockedForFacts`: la vía genérica de `facts` sigue sin poder pagar la revisión.
  - PM sigue bloqueado para toda fuente.
  - `ledger.mjs` solo cambia un comentario.
- **Imagen:** `linux/amd64`, construida desde `git archive 84372c2` con `GIT_SHA` y `RELEASE_TAG`.
  - Trivy 0.69.3, repetido el día del despliegue: 0 HIGH/CRITICAL.
  - `verify-image-integrity.mjs`: 51 ok, 0 fallos.
  - musl y musl-utils `1.2.5-r24`, zlib `1.4-r0`.
  - Frente a `v8inert-0665c16`, en `/app` solo cambian `policy.mjs`, `ledger.mjs`, tests y `package.json`.
- **Artefacto:** `api-f1prep-84372c2.tar.gz`, SHA-256 `77a0db555afcff116b652a123c58388434fc95e1265d0081af42aae2f5a63042` (151 938 083 B). Verificado con `sha256sum -c` en el VPS antes de `docker load`. El ID cargado coincide completo.

## Preflight

- **Contenedores:** los cuatro healthy, RestartCount 0. El override (`14452c49`) coincide con `docker compose config --images`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno --> Edge con las dos réplicas en el pool.
- **Réplicas:** 7 montajes cada una. 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`, sin `gamification_subject_key`.
- **Host:** ningún archivo de gamificación ni de exclusiones en `data/`, `data-critical/`, `secrets/` ni `identity/`.
  - Una búsqueda amplia en `/var/www/chibalete` encontró solo `node_modules/caniuse-lite/data/features/css-exclusions.js`, un archivo de npm antiguo sin relación y no montado.
- **G4 en proceso**, en las dos réplicas: `readMyProgress` → `{status:404}`, `readGroupRecognition` → `null`, `startMookReconciler` → `null`, y 0 líneas de reconciliación en el log.
- **Respaldo:** `structured-backup` del 2026-11-06 a las 18:05Z, `result=ok`, snapshot `d6f864a2`. Ninguno en curso durante la ventana.
- **Recursos:** 57 GB libres en disco y 6,7 GB de memoria disponible.
- **Línea base de la última hora:** 0 5xx, 0 429 y 0 errores.
- **MOOK** «La tortuga…»: en `draft`, 0 recorridos y 0 entregas.
- **Rollback preparado:**
  - Imagen `chibalete/api:rollback-pre-f1prep` = `020d90e3` (`v8inert-0665c16`).
  - Override `docker-compose.override.yml.bak-pre-f1prep-20261106T222447Z` (byte-idéntico al vivo).
  - Instrucciones en `/root/chp-f1prep/ROLLBACK.txt`.
- **Huellas previas:** `/root/chp-f1prep/stores-pre.txt`.

## Ventanas

| Réplica | Drain | Recreate | Healthy | Rejoin |
|---|---|---|---|---|
| `api_1` | 22:25:38Z | 22:26:44Z | 22:26:57Z | 22:27:31Z |
| `api_2` | 22:28:20Z | 22:29:26Z | 22:29:38Z | 22:30:07Z |

**Gate dentro del contenedor (réplica fuera del pool), en cada réplica:**
- ID `0fffb579…` y RestartCount 0. Los mismos 7 montajes.
- Entorno igual al previo salvo `GIT_SHA` y `CHIBALETE_RELEASE`, que vienen de la imagen. `ARCHIVE_ROTATION_ENABLED` sigue solo en `api_1`.
- Política F1 presente: `mook_review` fuera de `XP_LOCKED_SOURCES`, en `XP_RECOGNITION_ONLY_SOURCES` y en `PM_LOCKED_SOURCES`.
- G4 en proceso: `readMyProgress` → 404, sin leer MOOK. Agregado y reconciliador → `null`.
- Salud 200 y 0 errores en el log. Sin `gamification.db` ni clave.

**Gate autenticado** (sesión del administrador en el navegador, solo GET, vía edge), con ráfagas paralelas para cubrir las dos réplicas:
- `/api/auth/me` → 200.
- Biblioteca (editorial, institucional y personal), `my-catalog`, Experiencias, Studio (`admin/list`, `review/queue`), grupos y `analytics-summary` → 200, sin campo `recognition`.
- `/api/me/progress` → 404: 14 en `api_1` tras su ventana; 13 y 15 en cada réplica tras la de `api_2`.
- `x-user-id` ajeno → 401.
- Pool 11/9.
- Login ficticio con IP de prueba en cada réplica → 401 con `ratelimit-limit=5`.

El gate de `api_1`, logs incluidos, se leyó en un paso propio antes de tocar `api_2`.

## Después

- **Imágenes:** las dos réplicas corren `0fffb579…`, healthy, RestartCount 0. El override es `ccdf69d1…` y `config --images` muestra 2× `f1prep-84372c2`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno -->
- **Front y edge:** sin recrear. El front sigue en `a7fd0ccf…`, iniciado a las 20:57Z; el edge, desde el 2026-10-28.
- **Observación 22:25–22:39Z:** `api_1` atendió 127 peticiones y `api_2` 58 (sin contar `/metrics`). 0 5xx, 0 429, 0 errores de nivel 50+, 0 `[ERROR]` y 0 líneas de reconciliación, ledger, clave o registro. Edge: 232 líneas, 0 5xx de upstream y 0 `[error]`.
- **Stores:** idénticos byte a byte al preflight (padrón, MOOK, catálogo, grupos, accesos, entregas, progreso; 3524 uploads; 0 `.tmp`/`.lock`). 0 archivos de gamificación en `data-critical/`. MOOK «La tortuga…» en borrador, con 0 recorridos y 0 entregas.
- **Bitácora:** entrada `V8-ACTIVATE-PREP-02` en `/root/deploys.log`.

## No verificado

- Un login real con contraseña después del cambio (el operador no introduce contraseñas). Las sesiones firmadas existentes funcionan en las dos réplicas.
- Una concesión de XP en producción: **está prohibida** en esta unidad. La concesión con todos los requisitos se probó solo en laboratorio, con dos réplicas de esta misma imagen (V8-ACTIVATE-PREP-01: 27/0 con XP, 24/0 sin XP, 31/0 inerte).

## Riesgo residual

Con F1 desplegada, el bloqueo por código ya no protege `mook_review`. Las barreras vigentes son las flags, la clave de sujeto, el registro de exclusiones, las reglas aprobadas y la publicación posterior al corte. Hoy no existe ninguna y cada una basta por sí sola. Su activación sigue el procedimiento de [activación operativa V8](../gamificacion/GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md) (F2–F8), sujeto al gate jurídico.
