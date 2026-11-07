# V8-UNIFIED-XP-02 — Evidencia del despliegue inerte del sistema único XP

**Fecha:** 2026-11-07, 14:57–15:14Z. **Veredicto:** `GREEN_PROD_UNIFIED_XP_INERT`.

XP es la única escala: los Puntos de Magia y la gamificación heredada están retirados y los mediadores tienen una consulta de progreso individual de su propio grupo (V8-UNIFIED-XP-01). **No se activa nada:** producción sigue sin flags, sin clave, sin registro, sin reglas y sin experiencia publicada; la consulta individual responde 404.

## Release

| | Antes | Después |
|---|---|---|
| `api_1`, `api_2` | `chibalete/api:f1prep-84372c2` = `sha256:0fffb57998c09e8eebb2dfdf82a05aca07b908ec580579eb3e496d5d0c2d3fe3` | `chibalete/api:unifiedxp-13b8045` = `sha256:c3361ee004a0d00fa36a1d79ffec25a57c27329f01cf584169c33b10caf04d5e` |
| `front` | `chibalete/front:v8inert-0d2ef7b` = `sha256:a7fd0ccf04f2e1fc2945d311914e813c23d27b717d60765935b3f1d92d1bd821` | `chibalete/front:unifiedxp-13b8045` = `sha256:26a0a3f4cb9a0007fd593b846c0e68c07a4169f51760d0dcbff52ef005c665f0` |
| Override | `ccdf69d1…` | `464ff15d…` (solo líneas 40, 85 y 130) |

- **Commit:** `13b8045e0a9bc089e27a17cfac3d47eb5eca8a4f`, sobre `865024b` por avance normal (`d3eb3d6`, `447dc73`, `13b8045`). B1 (`67a544e`) fuera de la historia.
- **CI** del commit: `security`, `content-rmw` e `identity-preflight` en verde. En el log de Linux: `platformIntegration` 58/0, `mookReviewReplicaAuthz` 14/0, `sessionIdentityIntegration` 34/0, `studentProgressHttp` 34/0, `StudentProgressMediator` 33/0, núcleo G3 148/0, `workRecognition` 120/0, `mookReviewUnlock` 53/0, `xpPilotEmission` 71/0, `mookReconcileBatched` 50/0, `mookReconcileLock` 42/0, `platformScale` 17/0. Únicos SKIP: dos suites de regalías que requieren `/app/secrets` escribible.

## Imágenes y artefactos

- `linux/amd64`, desde `git -c core.autocrlf=false archive 13b8045`. API con `GIT_SHA` y `RELEASE_TAG`; front con el commit en sus etiquetas OCI.
- **Trivy 0.69.3:** API y front, 0 HIGH/CRITICAL. **`verify-image-integrity.mjs`:** 51 ok, 0 fallos.
- **`/app` frente a `f1prep-84372c2`:** solo cambian `policy.mjs`, `ledger.mjs`, `recognition.mjs`, `db.mjs`, `erasure.mjs`, `progress.mjs`, `mookSource.mjs`, `server.js`, `package.json`, `utils/studentProgressView.mjs` (nuevo) y tests. `node_modules` idéntico. musl y musl-utils `1.2.5-r24`, zlib `1.4-r0`. Mismas 3 migraciones.
- **Dentro de la imagen:** F1 conservada (`mook_review` solo por reconocimiento); sin `PM_LOCKED_SOURCES`, sin primitivas de saldo/ajuste, sin flag de PM; endpoint individual con `via: mediator_of_group`; sin B1; sin `data/`, `data-critical/`, `.env` ni secretos.
- **Front:** bundle `index-BRTwCV5K.js`; 0 apariciones de «Puntos de Magia», `/admin/recompensas`, Trivia o `redeemCoupon`.
- **Artefactos:** `api-unifiedxp-13b8045.tar.gz` SHA-256 `cdfb886d20ed080be3c708b8042ff007aa73d83d7b3a20909afb87dae3d7106c` (151 937 193 B); `front-unifiedxp-13b8045.tar.gz` `f60276770c00f1ade2cc269ed11646e2ec1720c333cd2350ef0e86994410d74b` (28 663 194 B). `sha256sum -c` correcto en el VPS antes de `docker load`; los IDs cargados coinciden completos.

## Laboratorio (dos réplicas API + front definitivos, datos solo sintéticos)

| Escenario | Resultado |
|---|---|
| Flags apagadas (`create`, `flows`, `flows2`, gate inerte) | 6/0, 40/6, 13/0, 35/0. Los 6 de `flows` y el 1 de `publish` son idénticos, aserción por aserción, a los de las imágenes productivas anteriores (secuencia del script). El gate incluye la consulta individual en 404 para cuatro roles |
| XP encendido, regla nueva solo XP (`on`) | 44/0. `caps`, `pm` en facts y `amounts.pm` ⇒ `PM_RETIRED`. 30 → +20 → techo 50 con una tercera aprobación sobre la misma obra; 7 hechos y 200 XP; 0 filas de PM. Progreso individual correcto; 404 idénticos fuera de cohorte o con ids manipulados; 403 a mediador ajeno, otro grupo, lector y administrador; 401 anónimo; dos reconciliadores sin duplicados |
| Regla histórica con `pm`/`caps` (`hist`) | 44/0: mismo XP, 0 PM |
| G4 sin XP (`off`) | 34/0: todo 404, ledger vacío |
| Navegador | Aula Viva del mediador: bloque agregado con texto nuevo y bloque individual (50 XP, Brote, 1 obra, dos logros), región etiquetada, `dl`, sin desbordamiento; disposición móvil activa; `/trivia` redirige; Tienda sin PM |

## Preflight

- Cuatro contenedores healthy, RestartCount 0; override `ccdf69d1` = `config --images`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno --> 7 montajes por réplica.
- 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`; sin `gamification.db`, clave ni registro. MOOK «La tortuga…» en borrador, 0 recorridos, 0 entregas.
- Respaldo estructurado 12:01Z `result=ok` (snapshot `31d0105e`); ninguno en curso. 57 GB libres, 6,7 GB de memoria. Última hora: 0 5xx, 0 429, 0 errores.
- Rollback: `chibalete/api:rollback-pre-unifiedxp` (= `0fffb579`), `chibalete/front:rollback-pre-unifiedxp` (= `a7fd0ccf`), override `.bak-pre-unifiedxp-20261107T145734Z` (byte-idéntico), instrucciones en `/root/chp-unifiedxp/ROLLBACK.txt`.

## Ventanas

| Servicio | Drain | Recreate | Healthy | Rejoin |
|---|---|---|---|---|
| `api_1` | 14:59:47Z | 15:00:53Z | 15:01:18Z | 15:01:55Z |
| `api_2` | 15:06:17Z | 15:07:23Z | 15:07:34Z | 15:08:11Z |
| `front` | — | 15:11:20Z | 15:11:28Z | reload del edge 15:11:28Z |

**Gate por réplica** (dentro del contenedor, réplica fuera del pool; el de `api_1` se leyó en un paso propio antes de tocar `api_2`): ID exacto; mismos 7 montajes; entorno igual salvo `GIT_SHA`/`CHIBALETE_RELEASE`; 0 variables de gamificación; F1 presente y PM retirado; `readMyProgress` 404, agregado y reconciliador `null`, `isStudentProgressReadable` false y `readStudentProgress` 404; salud 200; anónimo y `x-user-id` → 401 con limitador; 0 5xx, 0 errores, 0 líneas de G4; sin archivos de gamificación.

**Reparto:** 12/13 peticiones por réplica a través del edge. **Front:** `nginx -t` correcto en front y edge; `default.conf` productivo intacto (mismo SHA-256); 56 assets referenciados en 200, `epub-reader.html`, `sw.js` y `manifest.json` en 200; sin errores de consola; `/trivia` redirige a Bienvenida.

## Después

- Las dos réplicas en `c3361ee0…` y el front en `26a0a3f4…`, todos healthy con RestartCount 0. Override `464ff15d…`; `config --images` muestra 2× `unifiedxp-13b8045` y 1× front `unifiedxp-13b8045`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno -->
- Ventana 14:59–15:13Z: 0 5xx, 0 errores de nivel 50+, 0 `[ERROR]` y 0 líneas de reconciliación o ledger en las réplicas y el front; edge sin 5xx de upstream.
- **Stores:** MOOK, catálogo, grupos, accesos, entregas y progreso idénticos byte a byte al preflight; 3524 uploads; 0 `.tmp`/`.lock`; 0 archivos de gamificación. El padrón cambió por un login real a las 15:07:29Z (servido por `api_1` ya actualizado), que persiste `lastLoginAt`; esa sesión hizo después GET autenticados en 200 (usuarios, contenido, grupos, colegios, asignaciones). No es efecto del despliegue.
- Bitácora: entrada `V8-UNIFIED-XP-02` en `/root/deploys.log`.

## No verificado

- Un recorrido autenticado del operador en producción (el operador no introduce contraseñas). Se cubrió con el login real observado y con el laboratorio de la misma imagen en modo de sesión `enforce`.
- La vista móvil a 390 px: la ventana del navegador no bajó de 657 px; la disposición móvil sí estaba activa, sin desbordamiento.

## Riesgo residual

Las barreras para conceder XP siguen siendo las flags, la clave de sujeto, el registro de exclusiones, las reglas aprobadas y la publicación posterior al corte; hoy no existe ninguna. El acta O1 debe fijar el bloque de reglas en su forma solo XP (sin `amounts.pm`, `reread.pmFactors` ni `caps`). Las tablas de PM siguen en el esquema sin filas.
