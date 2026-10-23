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

## 5. Lote B ejecutado (2026-10-23, `4d3a035`)

Solo `package-lock.json`; `package.json`, los `overrides` y la entrada raíz del lockfile no cambian. Se eligió la **versión mínima que corrige** cada advisory. La excepción son `@grpc/grpc-js` y `brace-expansion`: los fija un `override` de rango (`^1.14.4`, `^5.0.9`), así que solo pueden avanzar con `npm update` y quedan en la última versión del rango.

| Paquete | Antes → después | Advisories resueltos |
|---|---|---|
| `proxy-addr` | 2.0.7 → 2.0.8 | jqcg (CRITICAL) |
| `multer` | 2.2.0 → 2.4.0 (2.5.0 se descartó: publicado el 2026-10-22) | 535w, qfvm, wc9g, 3pph, qvfw |
| `qs` | 6.15.2 → 6.16.0 (+ `side-channel` 1.1.1, `side-channel-list` 1.0.1) | 4mjr, x5fp |
| `ip-address` | 10.5.0 → 10.7.4 (mínima para rxp7) | 2vr4, h3mg, j6r3, rpw4, rxp7 |
| `brace-expansion` | 5.0.9 → 5.0.12 | 6j4f, qhr7, q2hr |
| `@grpc/grpc-js` | 1.14.4 → 1.14.6 | m9gg, f596 |
| retirados con multer 2.4.0 | `concat-stream`, `buffer-from`, `typedarray`, `readable-stream@3` anidado | — |

**Pruebas.** Se ejecutaron baseline (`9c65438`) y lote B en paralelo, en `node:20-bookworm` con `npm ci` y repositorio git:

- `npm ci` y `npm ls` limpios.
- Suites con **resultados idénticos** entre los dos árboles: identity-preflight, b2c, royalties, content-rmw, store, auth-reset, session-browser, evidence (`lint` y `test`), `typecheck:baseline`, `build`, las 26 suites de analytics, 9 suites de subida y 4 de authz/sesión.
- Fallas preexistentes, iguales en la baseline:
  - `test:analytics`: `analyticsCanon` y `AulaVivaGroupAnalytics`.
  - `test:library`: la aserción «`/api/content` no es no-store» está desactualizada; esa suite no corre en CI.
- **Prueba de comportamiento** (express + rate limit + multer):
  - Sin cambios en `req.ip` con `trust proxy 1`, en las claves de `ipKeyGenerator` (IPv4, mapeadas, /56), en el parseo de query, en los 429 por IP ni en los códigos de error de multer.
  - **Única diferencia:** 20 subidas abortadas dejaban 18 descriptores abiertos con multer 2.2.0 y ninguno con 2.4.0 (qfvm corregido).
- **OSV reproducido** (API osv.dev + `osv-scanner.toml`): la baseline da 30 advisories / 44 filas, igual que el CI. El lote B da **12 advisories / 26 filas, ninguno nuevo**.

**CI de `4d3a035`:**
- En verde: `trivy` (fs **y config**, que se ejecutó por primera vez), `image-integrity`, `content-rmw`, `evidence-hardening` y `gitleaks-head`.
- `trivy-image` sin hallazgos de Node; quedan los 4 de OpenSSL de Alpine (lote E).
- `osv-scanner` con 26 filas: lotes C y D.
- `gitleaks-history`: lote F.

**Pendientes por lote:**
- **C:** `vite` 6.4.3 (587h, 698v, 9jrq, r825, rq7h) y `source-map-js` 1.2.1 (68fv), solo desarrollo.
- **D:** OTel (q7rr, 45rx, 8988, qqmp), `uuid` (w5hq) y `react-router` (qwww). Todos requieren un cambio de versión mayor o una decisión sobre sus excepciones.

**Hueco de CI detectado (sin corregir, fuera del lote):** `identity-preflight.yml` no incluye `package-lock.json` en `paths`, de modo que un cambio solo de dependencias no ejecuta esa suite. Para este lote se cubrió con la ejecución local equivalente.

**Imagen productiva:** al reconstruir la API, `node_modules` llevaría estas seis versiones. No hay cambio de código, Dockerfile ni imagen base. Hasta que se apruebe un despliegue, producción sigue con `royalties-f3a2-145934b` y las versiones anteriores.

## 6. Lote C ejecutado (2026-10-23, `8eb03c7` + `e7daf66`)

Solo `package-lock.json` (2 paquetes × version/resolved/integrity); `package.json` y `overrides` no cambian. Versión mínima que corrige; `vite` 6.4.5 se descartó (publicada el 2026-10-21).

| Paquete | Directa / transitiva | Antes → después | Advisories resueltos |
|---|---|---|---|
| `vite` | directa (devDependency; también vía `@vitejs/plugin-react`) | 6.4.3 → 6.4.4 | 587h, 698v, 9jrq, r825, rq7h |
| `source-map-js` | transitiva (`vite` → `postcss` 8.5.23, rango `^1.2.1`) | 1.2.1 → 1.2.2 | 68fv |

**Alcance comprobado, no supuesto:**
- `npm ls --omit=dev` no contiene `vite`, `postcss` ni `source-map-js`; el árbol productivo (517 entradas) es idéntico entre baseline y lote C, así que la imagen API (`npm ci --omit=dev`) no cambia.
- Ningún archivo de `server/`, `utils/` o `engines/` importa estos paquetes; solo `vite.config.ts`.
- `vite` 6.4.4 declara `node ^18 || ^20 || >=22`; `source-map-js` 1.2.2, `>=0.10`. Sin dependencias nuevas.
- El build del front (`Dockerfile.front`) usa vite, pero el `dist/` resultante es **idéntico byte a byte** (76 archivos, SHA-256) entre los dos árboles.

**Pruebas** (Windows, Node 20.18, dos worktrees limpios con `npm ci`, baseline `bbee011` y lote C):
- `npm ci` y `npm ls` limpios en ambos (619 paquetes). El aviso EBADENGINE de `@vitejs/plugin-react` (pide Node ≥ 20.19) es local y previo.
- Resultados iguales en verde: typecheck:baseline, build, b2c, memberships, content-rmw, session-browser, auth-reset, metric-contract, mook, store, evidence (`test` y `lint`), verify:deploy-config, image-integrity (test y contrato estático), 5 suites de subida y 7 de sesión/authz/eventos.
- `royalties`: el arnés HTTP de `commercialClassHttp` es inestable en Windows en **los dos** árboles (baseline 1/5 «nunca healthy»; lote C 2/5: «nunca healthy» y la aserción de reloj `since >= t0`). Las demás ejecuciones dan 36 ✓ / 0 ✗ en ambos. El servidor no carga ningún paquete modificado.
- `test:identity` y `verify-test-store-isolation`: una aserción falla igual en los dos árboles («ruta persistente fuera de temp → aborta»), porque los worktrees estaban dentro de `%TEMP%`. Es un artefacto del entorno local, no una regresión.
- **OSV** (API osv.dev; todos los ignores de `osv-scanner.toml` están caducados): baseline 12 advisories / 26 filas → lote C **6 / 20**. Desaparecen exactamente los seis previstos y no aparece ninguno nuevo. Los restantes son del lote D: OTel (q7rr, 45rx, 8988, qqmp), `uuid` (w5hq) y `react-router` (qwww).

**Hueco de CI corregido (`e7daf66`):** `identity-preflight.yml` añade `package-lock.json` a `paths` en `push` y `pull_request`. Solo cambia el filtro; los pasos y las condiciones de éxito quedan iguales.

**Sin despliegue.** Producción sigue con `royalties-f3a2-145934b`.

## 7. Lote D ejecutado (2026-10-23, `8cf2e83`)

**Resultado:** OSV pasa de 6 advisories / 20 filas a **0 / 0**. No se renueva ninguna excepción; los cinco ignores caducados de `osv-scanner.toml` quedan sin efecto, porque ya no hay hallazgo que ignorar.

### 7.1 Matriz

| Advisory | Paquete / versión | Ruta | Mínima corregida | ¿Producción? | ¿Alcanzable? | Corrección aplicada |
|---|---|---|---|---|---|---|
| qwww (HIGH) | `react-router` 7.18.1 | `react-router-dom` → `react-router` (+ override) | **7.18.2** (línea 7.x) | bundle SPA | No: solo modo RSC; la SPA usa HashRouter sin RSC/SSR | parche 7.18.2; suelo del override `^7.18.2` |
| q7rr (HIGH) | `exporter-prometheus` 0.57.2, `sdk-node` 0.57.2, `auto-instrumentations-node` 0.55.3 | `sdk-node` / directa | 0.217.0 / 0.75.0 | imagen API | No: el PrometheusExporter nunca se crea; OTel no se carga | OTel 2.10.0 / 0.221.0 |
| 45rx (HIGH) | `propagator-jaeger` 1.30.1 | `sdk-node` → `sdk-trace-node` | 2.9.0 | imagen API | No: textMapPropagator fijado a W3C y OTel no se carga | → 2.10.0 |
| 8988 (MOD) | `@opentelemetry/core` 1.30.1 | directa + `@sentry/node` v8 | 2.8.0 | imagen API | No: OTel off, Sentry sin DSN y extracción ya acotada en `otel.mjs` | → 2.10.0 |
| qqmp (MOD) | `instrumentation-{pg,mongoose,mysql,mysql2,knex,tedious,cassandra-driver}` | `auto-instrumentations-node` y `@sentry/node` v8 | pg 0.73, mongoose/mysql/mysql2 0.67, knex 0.65, tedious 0.40, cassandra 0.66, oracledb 0.46 | imagen API | No: Chibalete+ no usa ninguna de esas bases de datos | `auto-instrumentations-node` 0.79.0, la primera que trae las mínimas corregidas |
| w5hq (MOD) | `uuid` 9.0.1 y 8.3.2 | `auto-instr` → `resource-detector-gcp` → `gaxios@6`; `autocannon` → `hyperid` (dev) | 11.1.1 | 9.0.1 sí; 8.3.2 solo dev | No: sin `buf` en v3/v5/v6; hyperid usa `crypto.randomUUID` en Node 20 | `uuid@9` desaparece con OTel 2.x; override `hyperid → uuid ^11.1.1` |

**Producción, verificado en solo lectura con nombres de variables y sin valores** (`safeOperationalEvidence.mjs environment-names` sobre `docker inspect`): `api_1` tiene 32 variables, ninguna `OTEL_*`, `SENTRY_*`, `GLITCHTIP_*` ni `NODE_OPTIONS`. El comando del contenedor es `["node","server/server.js"]`, sin `--import otel.mjs`. OTel no se carga y Sentry se importa pero queda inerte.

### 7.2 Estrategia

1. **Parche dentro de rango:** `react-router` 7.18.2. La excepción caducada afirmaba que solo había corrección en 8.3.0; desde el 2026-07-28 existe en la línea 7.x.
2. **No hay parche en OTel 1.x** para q7rr, 45rx, 8988 ni qqmp. Además, `@sentry/node` v8 fija OTel 1.x (`core` 1.30.1 e instrumentaciones propias), así que retirar solo el OTel directo no basta.
3. **Eliminar dependencias se descartó:** OTel (P2-A) y Sentry/GlitchTip (P2-D) son capacidades documentadas y activables, no código muerto.
4. **Versión mayor delimitada:** `@sentry/node` 10.76.2 (publicada el 2026-10-08) ya no arrastra la colección de instrumentaciones 1.x; OTel queda en la línea 2.10.0 / 0.221.0 con `auto-instrumentations-node` 0.79.0. Se eligieron las versiones mínimas que corrigen y se descartaron OTel 3.0 / 0.300 (publicadas el 2026-10-20). El impacto se limita a dos módulos inertes en producción y a un cambio de API: `new Resource()` → `resourceFromAttributes()`.
5. **`uuid` de desarrollo:** `autocannon` 8 sigue exigiendo `hyperid ^3`, que depende de `uuid ^8`. Se aplicó un override acotado a `hyperid` en vez de un override global.

### 7.3 Pruebas

Se ejecutaron en Windows con Node 20.18, en dos worktrees limpios **fuera de `%TEMP%`** con `npm ci`, en secuencia: baseline `4aa449c` (619 paquetes) y lote D (575).
- **Mismo código de salida en las 43 suites:** typecheck, build, `test:identity-preflight` (3130 ✓ en ambos), session-browser, auth-reset, ai-model-compat, request-context, royalties, b2c, memberships, content-rmw, analytics, metrics-api, explicit-access, store, reading-runtime, a11y-reader, verify:immersive, immersive-v2, executor-semantic, evidence (`test` y `lint`), image-integrity (test y estático), realStoreGuard, 4 de Aula Viva, 3 de authz, 5 de eventos, 2 de sesión, 3 de subida y `otelPropagation` (26/0).
- **Fallos previos, con aserciones idénticas en los dos árboles:**
  - `test:library`: «/api/content general NO cambia su política no-store».
  - `test:analytics`: 7 ✗ por un módulo ausente en el worktree.
  - `verify:immersive`: `fetch /api/events incluye header x-user-id`.
  - `immersive-v2`: un módulo ausente.
- **Flaky:** `retireSyntheticCohort` dio una vez `server rc=0` en el lote D. Tras 3 repeticiones por árbol queda en 3/3 en verde en ambos, y la repetición completa de `identity-preflight` es idéntica al baseline.
- **Bundle:** mismos 76 archivos y mismos bytes de JS. Solo cambian 2 caracteres, la versión `7.18.1` → `7.18.2` en `react-vendor`.
- **Comportamiento**, con colectores locales falsos y sin red externa:
  - Sentry v8 y v10 capturan el error de Express y redactan `authorization`, `cookie` y `x-admin-secret` en `request.headers`.
  - OTel ON con ratio 1 exporta `/v1/traces` con el span HTTP en los dos árboles. Con `OTEL_PROPAGATORS=jaeger`, un `uber-trace-id` malformado y un baggage de 10 KB, la app responde 200.
  - `hyperid` y `autocannon` con `uuid` 11.1.1: 8550 peticiones, 0 errores.
- **Hallazgo previo (no es regresión, fuera del lote):** con DSN configurado, Sentry (v8 y v10) envía `request.cookies` ya parseado, y `beforeSend` solo redacta `request.headers.cookie`. Hoy no tiene efecto, porque producción no tiene DSN. Recomendación: redactar también `event.request.cookies` antes de activar GlitchTip.

**Dependencias nuevas de producción** (transitivas de OTel 2.x): `systeminformation`, `yaml`, `es-module-lexer` y `@types/oracledb`. Ninguna tiene advisories en OSV. Se retiran `uuid@9`, `shimmer`, `require-in-the-middle` 7, `resolve`, `acorn` y `whatwg-url@5`, entre otras.

**Sin despliegue.** Producción sigue con `royalties-f3a2-145934b` (Sentry 8 / OTel 1.x, ambos inertes).
