# CHIBALETE+ — SEC-DEPS-02: diagnóstico de los cinco controles de seguridad

**Fecha:** 2026-10-23 · **Rama:** `chp/epub-mainfile-r1-release` · **Modo:** solo diagnóstico; no se aplicó ninguna corrección ni se tocó producción.
**Veredicto:** **GO** para F3-A2 con `ECONOMIC_INGEST_MODE=off`. Ningún hallazgo es P0; todos son anteriores a F3-A2.

> Nota de contexto: el encargo describe F3-A2 como «sin desplegar». F3-A2 ya está en producción desde 2026-10-23 01:48Z (`145934b`, ingesta apagada; ver `docs/royalties/F3A2_PROD_EVIDENCE.md`). El veredicto evalúa ese estado.

## 1. Evidencia

- Workflow `security`, run `39864663368`, **intento 4**, commit `0f24e56` (2026-10-23 01:33Z). Logs leídos paso a paso desde GitHub; los runs de `145934b` y `93f7021` dan el mismo resultado `RRRRR`.
- Reproducción local: `npm run lint:evidence` (mismas 3 violaciones), detalle de advisories vía `api.osv.dev`, rutas de dependencia desde `package-lock.json`, inspección de la imagen desplegada `royalties-f3a2-145934b`.
- Secretos: los valores históricos se compararon **solo por huella SHA-256** (12 hex) contra los secretos vivos; ningún valor se imprimió ni se guardó.
- F3-A2 no modificó `package-lock.json`, Dockerfiles, `.trivyignore`, `osv-scanner.toml`, `.gitleaks.toml` ni workflows (único cambio en `package.json`: la lista de `test:royalties`). El lockfile no cambia desde `52d949e` (2026-08-10).

### Cronología (último intento de cada run de `security`)

| Desde | Commit | gitleaks-history | evidence-hardening | osv-scanner | trivy | trivy-image |
|---|---|---|---|---|---|---|
| ≤ 2026-09-18 (más antiguo visible) | `258c8b3` | R | G | R | R | R |
| 2026-10-16 | `f116248` | R | **G** | R | R | R |
| 2026-10-19 | `a34c695` | R | **R** | R | R | R |
| 2026-10-23 | `0f24e56` / `145934b` / `93f7021` | R | R | R | R | R |

Bloqueantes: `evidence-hardening`, `osv-scanner`, `trivy`. Informativos (`continue-on-error`): `gitleaks-history`, `trivy-image`.

## 2. Matriz

### 2.1 gitleaks-history — 10 hallazgos históricos (435 commits)

| Regla | Archivo:línea | Commit | Estado del valor |
|---|---|---|---|
| `chibalete-admin-secret` ×5 | `ecosystem.config.cjs:8` (comentario, 16 c.), `server/simulate_novelty.js:7`, `server/test_user_flow.js:5`, `server/test_persistence_flow.js:11`, `verify_pipeline.cjs:9` (mismo valor, 28 c.) | `f7f0c5c` (2026-03-20) | **No vigente.** No coincide con `/var/www/chibalete/secrets/admin_secret` ni con ninguna variable de las APIs ni de Studio BI. El valor de 28 c. sigue en 3 `.env.bak` antiguos de `/opt/chibaleteplus` (`0600 root`). |
| `chibalete-gemini-key` + `gcp-api-key` | `studio-editor-bi/assets/index-CqLdlylq.js:1120` (bundle minificado) | `f7f0c5c` | **No vigente en nuestros sistemas:** no coincide con `GEMINI_API_KEY` de api_1/api_2 ni con `VITE_GEMINI_API_KEY` de Studio BI. La revocación en la consola de Google no se puede verificar desde aquí. |
| `generic-api-key` ×3 | `server/__test__/adminSecretFile.test.js:44-46` | `376f6dd` (2026-07-24) | Fixtures sintéticas de prueba; desde `70f88fd` se generan en tiempo de ejecución. |

- **Severidad / riesgo productivo:** bajo. No hay exposición activa demostrada.
- **Causa raíz:** secretos versionados antes de marzo de 2026, que siguen en el historial público. HEAD está limpio (`gitleaks-head` verde).
- **Corrección mínima:**
  1. El titular confirma en la consola de GCP que la clave del bundle de Studio BI está revocada.
  2. Añadir a `.gitleaksignore` los 10 fingerprints exactos, con su justificación (mismo mecanismo y precedente que `CHP-MOOK-COVER-UPLOAD-01A`). Esto no silencia la regla: cualquier aparición nueva vuelve a fallar.
  3. Destruir de forma segura los 3 `.env.bak` con el ADMIN_SECRET muerto, en una unidad operativa aparte y autorizada.
  4. No reescribir el historial.
- **Pruebas:** `gitleaks detect` completo en verde y `gitleaks dir` en verde; comprobar que un secreto sintético nuevo sigue fallando.
- **Prioridad:** P2. **Impacto en F3-A2:** ninguno.

### 2.2 evidence-hardening — 3 violaciones del ratchet

| Archivo:línea | Regla | Origen |
|---|---|---|
| `docs/ops/CHP_CONTENT_PROTECTION_AUDIT_2026_01.md:424` | `docker-inspect-raw` | `d42ee0e`, 2026-10-17 |
| `docs/ops/CHP_CONTENT_PROTECTION_CP2.md:139` | `compose-config-persisted` | `093d6d0`, 2026-10-17 |
| `docs/ops/CHP_CONTENT_PROTECTION_CP3_ROLLOUT_PREP.md:35` | `docker-inspect-raw` | `7040eb8`, 2026-10-18 |

- **Evidencia:** las tres son frases de documentación que describen comandos (un inspect de contenedor sin plantilla de formato; el nombre del archivo override de compose seguido, más adelante en la línea, de la palabra que activa la regla de configuración efectiva). No hay valores de secreto en esas líneas, y en `/root/chp-cp*` no hay volcados de inspect ni de configuración efectiva. `gitleaks-head` está en verde.
- **Severidad / riesgo productivo:** nulo. El control está diseñado para fallar por patrón aunque no haya fuga.
- **Causa raíz:** documentación de CP2/CP3 escrita sin la forma segura. Pasó de verde a rojo entre el 16 y el 19 de octubre, antes de F3-A2.
- **Corrección mínima:** reescribir las 3 frases con la forma segura (`docker inspect --format …` o `safeOperationalEvidence.mjs container-summary`; nombrar el override sin activar la regla de `compose config`). Sin marcadores `allow` y sin tocar el ratchet.
- **Pruebas:** `npm run lint:evidence` (0 violaciones), `npm run test:evidence` y `gitleaks dir`.
- **Prioridad:** P2. **Impacto en F3-A2:** ninguno.

### 2.3 osv-scanner — 30 advisories / 44 filas sobre 631 paquetes

| Paquete@versión | Advisories (CVSS) | Fix | Prod/dev | Alcanzabilidad en Chibalete+ |
|---|---|---|---|---|
| `proxy-addr@2.0.7` (vía express) | GHSA-jqcg-44mw-7w3h **CRITICAL 9.1** (spoofing de IP con *trust subnet* IPv4-mapped) | 2.0.8 | prod | **No alcanzable hoy:** `app.set('trust proxy', 1)` es un recuento de saltos, no una subred. Se volvería alcanzable si alguien configura subredes. |
| `multer@2.2.0` (directa) | 535w, qfvm, wc9g (HIGH 7.5); 3pph (5.3); qvfw (3.7): DoS y bypass de límite | 2.4.0 | prod | Las 3 rutas (`/api/upload*`, `/api/leo/ingest`, `/api/experiences/:id/cover`) exigen **admin** antes de que multer procese. DoS solo para un actor autenticado como admin. |
| `ip-address@10.5.0` (vía express-rate-limit) | 2vr4, h3mg, j6r3, rpw4, rxp7 (5.3–6.9) | 10.7.4 | prod | Baja: recibe `req.ip`, que con `trust proxy 1` es la dirección que añade nginx, no texto del cliente. |
| `qs@6.15.2` (express/body-parser) | 4mjr, x5fp (6.3) | 6.16.0 | prod | No alcanzable: Express 5.2.1 usa el parser de query `simple` y no hay `express.urlencoded`. |
| `brace-expansion@5.0.9` (archiver→readdir-glob→minimatch) | 6j4f, qhr7 (7.5); q2hr (5.3) | 5.0.12 | prod | No alcanzable: `archiver` se usa sin `.glob()`; los patrones no vienen del usuario. |
| `@grpc/grpc-js@1.14.4` (firebase, exportadores OTel grpc) | m9gg (7.4), f596 (3.7) | 1.14.5 | prod | No alcanzable: no hay servidor gRPC; OTel exporta por HTTP. |
| `@opentelemetry/*` (12 paquetes de instrumentación) | qqmp (5.8, `db.user` en spans) | OTel 0.66+ / v2 | prod | No aplica: no hay pg/mysql/mongo/cassandra/knex. |
| `@opentelemetry/*` | **q7rr (7.5), 45rx (7.5), 8988 (5.3) — ignores CADUCADOS** (2026-08-31 / 2026-10-21) | OTel v2 + Sentry v10 | prod | Su justificación de no alcanzabilidad sigue siendo cierta, pero ya no se honra. |
| `uuid@9.0.1` / `8.3.2 (dev)` | **w5hq (7.5) — ignore CADUCADO** 2026-08-31 | — | prod/dev | Igual que la razón registrada. |
| `react-router@7.18.1` | **qwww (7.1) — ignore CADUCADO** 2026-09-30 | 8.3.0 | prod (front) | No alcanzable: SPA sin RSC. |
| `vite@6.4.3`, `source-map-js@1.2.1` | 587h (7.5), 698v (6.3), 9jrq (2.1), r825 (6.3), rq7h (6.3); 68fv (8.7) | 6.4.4 / 1.2.2 | **dev** | Solo build y servidor de desarrollo; no forman parte de la imagen API (`npm ci --omit=dev`). |

- **Causa raíz:** base de advisories viva. 25 advisories se publicaron entre el 2 de septiembre y el 22 de octubre, y los 5 ignores auditados caducaron por diseño. El lockfile no cambia desde el 10 de agosto.
- **Corrección mínima:** ver lotes B, C y D (§3).
- **Prioridad:** P1 (lote B y decisión del lote D); P2 (lote C).
- **Impacto en F3-A2:** ninguno. Producción ya llevaba estas versiones antes de F3-A2.

### 2.4 trivy (fs) — 7 hallazgos en `package-lock.json` (1 CRITICAL, 6 HIGH)

`proxy-addr` CVE-2026-90711 (CRITICAL); `multer` CVE-2026-77037/77078/82333; `brace-expansion` CVE-2026-102276/102278; `@grpc/grpc-js` CVE-2026-101916. Son los mismos paquetes que §2.3 y tienen el mismo análisis de alcanzabilidad.

- Sin hallazgos de secretos ni de *misconfig* en fs.
- **El paso «Trivy config» no se ejecutó** (se salta porque fs falla): su estado actual es desconocido. `AVD-DS-0002` (sin `USER`) sigue en `.trivyignore`, con revisión documental vencida el 2026-08-31.
- **Corrección mínima:** el lote B lo deja en 0. Después, la primera ejecución real de «Trivy config» dirá si hace falta algo más.
- **Prioridad:** P1. **Impacto en F3-A2:** ninguno.

### 2.5 trivy-image — imagen API (el front no llegó a escanearse)

- Alpine 3.23.4: `libcrypto3`/`libssl3` 3.5.6-r0 → CVE-2026-14456 (DoS en servidor QUIC, fix 3.5.8-r0) y CVE-2026-45447 (UAF en `PKCS7_verify`, fix 3.5.7-r0), ambas HIGH.
- Node-pkg: los mismos 7 de §2.4.
- **Alcanzabilidad:** baja. La imagen desplegada usa Node 20.20.2 con **OpenSSL 3.0.19 enlazado estáticamente**: `node` no carga la `libssl`/`libcrypto` del sistema, que solo usan utilidades de la imagen. La API no sirve QUIC ni verifica PKCS7.
- **El escaneo de la imagen front se salta** porque el paso de la API falla antes: nginx base sin evaluar.
- **Causa raíz:** base `node:20-alpine` fijada por digest; los paquetes del SO no se actualizan sin cambiar el digest.
- **Corrección mínima:**
  - Lote E: evaluar un digest nuevo de `node:20-alpine` con OpenSSL ≥ 3.5.8-r0, con compatibilidad verificada (`better-sqlite3` nativo, `canvas`, tests completos).
  - Como mantenimiento del workflow, sin debilitarlo: `if: always()` en los pasos del front, para que se escaneen aunque falle la API.
- **Prioridad:** P2. **Impacto en F3-A2:** ninguno.

## 3. Plan de lotes (propuesta, sin ejecutar)

Cada lote va en su propio commit, con su gate y su rollback (`git revert` y reconstruir la imagen anterior). En ningún lote se tocan regalías, visores, `data/`, `data-critical/` ni uploads.

| Lote | Contenido | Prioridad | Gate previo/posterior | Rollback |
|---|---|---|---|---|
| A | Reescritura de 3 frases de docs | P2 | `lint:evidence`, `test:evidence`, `gitleaks dir` | revert docs |
| B | Lockfile, solo parches dentro de los rangos ya declarados: `proxy-addr` 2.0.8, `multer` 2.4.0, `qs` 6.16.0, `ip-address` 10.7.4, `brace-expansion` 5.0.12, `@grpc/grpc-js` 1.14.5. `package.json` sin cambios. | **P1** | `npm ci`; todas las suites (`test:royalties`, `test:identity`, `test:b2c`, `test:memberships`, `test:content-rmw`, `test:analytics` contra su baseline de 2 fallas preexistentes, `typecheck`); `image-integrity`; prueba de upload admin y de límites de multer (archivo de 2 GiB, abortado); rate-limit con IPv4/IPv6 y `x-forwarded-for`; `osv`/`trivy fs` sin estos IDs; despliegue por réplica con gate y smoke | revert lockfile + imagen `rollback-pre-*` |
| C | Dev: `vite` 6.4.4, `source-map-js` 1.2.2 | P2 | `npm run build`; comparar hashes del bundle; `image-integrity` (build front real) | revert lockfile |
| D | Ignores caducados (q7rr, w5hq, 45rx, 8988, qwww) + qqmp nuevo | P1 (decisión humana) | (a) renovar cada uno con evidencia actualizada y una fecha nueva corta, revisada por el Release Security Reviewer; o (b) unidad dedicada de migración Sentry v10 + OTel v2 y react-router 8.3.0. Nunca un ignore sin fecha. | revert config |
| E | Digest nuevo de `node:20-alpine` + escaneo del front con `if: always()` | P2 | build de las dos imágenes, tests nativos (`better-sqlite3`), `trivy-image` de API y front, smoke completo | imagen `rollback-pre-*` |
| F | `.gitleaksignore` con los 10 fingerprints + confirmación de revocación GCP + destrucción segura de 3 `.env.bak` (unidad operativa aparte) | P2 | `gitleaks detect` verde; secreto sintético nuevo sigue fallando | revert ignore |

Orden sugerido: A y B primero (dejan `evidence-hardening` y `trivy` en verde), luego D (deja `osv-scanner` en verde), y después C, E y F.

## 4. Veredicto

**GO.** Ningún hallazgo demostrado compromete F3-A2 con la ingesta apagada:

- no hay secretos vigentes expuestos;
- la única vulnerabilidad CRITICAL (`proxy-addr`) no es alcanzable con `trust proxy = 1`;
- los DoS de `multer` exigen sesión de administrador;
- F3-A2 no cambió dependencias, imágenes base, configuración de escáneres ni workflows.

Quedan **sin evaluar** dos subcontroles que el CI se salta: «Trivy config» y `trivy-image` del front. No afectan a F3-A2, que no tocó Dockerfiles, compose ni frontend, pero deben revisarse cuando se ejecute el lote B o el E.
