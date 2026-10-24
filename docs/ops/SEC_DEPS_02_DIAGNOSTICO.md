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

**Producción, verificado en solo lectura con nombres de variables y sin valores** (`safeOperationalEvidence.mjs environment-names` con `--from-file -`, sin persistir el JSON del contenedor): `api_1` tiene 32 variables, ninguna `OTEL_*`, `SENTRY_*`, `GLITCHTIP_*` ni `NODE_OPTIONS`. El comando del contenedor es `["node","server/server.js"]`, sin `--import otel.mjs`. OTel no se carga y Sentry se importa pero queda inerte.

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

## 8. Lote E ejecutado (2026-10-23, local + CI, sin despliegue)

**Resultado:** las dos imágenes candidatas pasan Trivy image con **0 HIGH/CRITICAL**, con y sin `.trivyignore` (0 corregibles y 0 sin corrección). Antes: API 4 HIGH; front **59 HIGH/CRITICAL (2 CRITICAL)** que nunca se habían evaluado.

### 8.1 Hallazgos de partida (imágenes de producción `secusers-a-2ec37f7`, Trivy 0.70.0)

| Imagen | Base | Hallazgos | Causa |
|---|---|---|---|
| API | `node:20-alpine@fb4cd12c…` (Alpine 3.23.4) | `libssl3`/`libcrypto3` 3.5.6-r0: CVE-2026-14456 (fix 3.5.8-r0) y CVE-2026-45447 (fix 3.5.7-r0), HIGH | **Node 20 está en EOL upstream:** `node:20-alpine` no se republica desde 2026-04-15, así que no existe un digest corregido de esa familia |
| front | `nginx:1.27-alpine` (Alpine 3.21.3, 2025-04-16) | 59: OpenSSL 3.3.3 (2 CRITICAL), libxml2, pcre2, curl, libexpat, libpng, musl, zlib, tiff, nghttp2, c-ares | la rama 1.27 de nginx está cerrada; `1.28-alpine` también quedó congelada (2026-03-24, OpenSSL 3.5.5) |

El front no se evaluaba porque el job único escaneaba la API primero: si la API fallaba, el paso del front no corría. Además, el job tenía `continue-on-error`.

### 8.2 Corrección

- **`Dockerfile.api`:** misma base pinneada en builder y runtime (el ABI musl no cambia; `musl` sigue en 1.2.5-r23). El runtime exige `libssl3>=3.5.8-r0` y `libcrypto3>=3.5.8-r0` del repositorio de Alpine 3.23, que hoy instala 3.5.9-r0; si el repositorio no lo ofrece, el build falla. `node` no usa estas librerías: enlaza OpenSSL 3.0.19 de forma estática.
- **`Dockerfile.front`:** `nginx:1.30-alpine@sha256:47928bf6…`, la rama estable vigente de la misma imagen oficial (nginx 1.30.6, Alpine 3.24.3, OpenSSL 3.5.9). El builder no se toca.
- **`security.yml`:** `trivy-image` pasa a ser una matriz `[api, front]` con `fail-fast: false` y sin `continue-on-error`. Cada imagen se construye y se escanea en su propio job, y los dos resultados bloquean.
- **No se migra a Node 22.** Es un cambio de versión mayor de runtime; queda registrado como deuda (§8.5).

### 8.3 Verificación (local, Docker 29.4)

- **Builds:** las dos imágenes se construyen desde un worktree limpio de `da916e9` con los cambios: API 860 MB, front 98,6 MB.
- **Integridad:** `verify-image-integrity` da 51/0 sobre la imagen candidata y 28/0 en el contrato estático.
- **Módulos nativos** (imagen de producción frente a candidata, resultados idénticos): `better-sqlite3` (SQLite 3.49.2 y WAL), `@napi-rs/canvas` (musl, PNG), `bcryptjs`, `crypto` y `tls`. Node v20.20.2 en los dos casos.
- **Arranque en producción** con datos sintéticos en volúmenes temporales (`NODE_ENV=production`, `SESSION_AUTH_MODE=enforce`, secretos file-only 0400): `ready` 200 y `ECON ingest=off`. El smoke de credenciales de A-PROD da **25/25 en las dos imágenes**: sesión firmada, desactivar, reinvitar, política de contraseñas, `accept-invite` y protección 409 de la cuenta principal. 0 errores y 0 secretos en los logs.
- **Front** (producción frente a candidata): `nginx -t` correcto. `nginx -T` es idéntico; el árbol servido tiene la misma huella SHA-256 (76 archivos). `/`, una ruta SPA, un asset y el proxy `/api/health/ready` hacia la API candidata responden 200.
- **Batería de 45 suites** en `node:20-bookworm`, con `npm ci`, sobre la candidata y sobre `da916e9`: mismo código de salida en todas, y el bundle `dist/` es idéntico (76 archivos).
  - **`royalties`** falló una vez en el baseline por el arnés («nunca healthy»). Después dio 3/3 en verde en los dos árboles.
  - **`evidence`** e **`identity-preflight`** necesitan `git ls-files`. Se repitieron con un índice reconstruido (1341 archivos versionados, igual que el worktree real): `evidence` en verde; `identity-preflight` con 3207 ✓ en los dos árboles y el mismo único ✗ previo («/api/content general NO cambia su política no-store», ya registrado en §7.3).
  - **Fallos previos idénticos en los dos árboles:** `analytics`, `verify:immersive` e `immersive-v2`.
- **Trivy fs y config:** 0. Dockerfiles: 0 misconfiguraciones.

### 8.4 Hallazgo nuevo fuera del lote — OSV en rojo

- **Hallazgo:** `zod` 3.25.76 (dependencia directa y de `openai`), GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404 (8.2), publicado en OSV el 2026-10-01. Es un agotamiento de memoria al validar arrays sin tope. La única corrección es `zod` 4.6.6, un cambio de versión mayor que toca los esquemas de validación del servidor, incluidos los de autenticación.
- **No lo causa este lote:** el lockfile no cambia, y el baseline `da916e9` falla igual.
- **Alcanzabilidad: baja.** Los tres `z.array` del servidor tienen tope (`.max(20/50/500)`), y `express.json` limita el cuerpo a 100 kB por defecto.
- **Decisión pendiente:** migrar a `zod` 4 en una unidad propia, o una excepción con fecha y evidencia. No se añadió ninguna excepción.

### 8.5 Deudas registradas

- **Node 20 en EOL:** no habrá más digests de `node:20-alpine`. El próximo CVE de Node o de la base solo se podrá corregir migrando a Node 22 LTS (`node:22-alpine` existe, Alpine 3.24.3 y OpenSSL 3.5.9). Hay que probar `better-sqlite3` y `canvas`.
- **Ignores obsoletos en `.trivyignore`:** CVE-2026-44902 y CVE-2026-59892 ya no aparecen en ningún escaneo tras el Lote D. Se pueden retirar en el Lote F o en una limpieza de configuración.
- **Escaneo semanal bloqueante:** con `trivy-image` bloqueante, el cron semanal pondrá el gate en rojo cuando aparezca un CVE nuevo de la base. Es la señal buscada.

### 8.6 Despliegue posterior (no ejecutado)

- **Espacio:** la API candidata comparte con la de producción solo las 4 capas base. En el VPS costará unos 0,85 GB (≈0,7 GB descomprimidos + 0,15 GB de blob), más unos 0,1 GB del front y 0,17 GB de tars en `/root/chp-*`: **≈1,1 GB en total**. Disponible: 11,16 GB.
- **Procedimiento** (el mismo de A-PROD):
  1. Build local con tag `lote-e-<sha>`, `docker save | gzip`, sha256, `scp` y `docker load` en el VPS, con IDs verificados.
  2. Tags `rollback-pre-lote-e` sobre `f2a3e5118108` (API) y `055537dbbdd1` (front), y backup del override.
  3. Cambiar la línea 40 y recrear `api_1`, con gate. Después la línea 85 y `api_2`, con gate. Después la línea 130, `front` y reload del edge.
- **Rollback:** volver a `rollback-pre-lote-e` por componente, o restaurar el `.bak` del override, y recrear solo ese servicio. No se tocan datos.

## 9. ZOD-01 — evaluación de GHSA-mrhx-c7xc-m3w5 y excepción temporal (2026-10-23)

**Decisión: GO para la excepción.** La mitigación es efectiva y queda fijada por una prueba de regresión que bloquea en CI. Caduca el **2026-11-23**.

### 9.1 Alcance real del advisory

- **Defecto:** un array inválido genera un issue por elemento, sin tope; con esquemas de elementos anchos se multiplica (PR #6475). En **zod 3, `.max()` no corta la validación:** registra `too_big` y sigue recorriendo (`v3/types.js`, `ZodArray._parse`). Medido: `z.array(z.string().max(40)).max(50)` con 51 000 números da 51 001 issues, ~207 ms y ~35 MB de heap por llamada.
- **Corrección upstream:** solo en 4.6.6 (PR #6652, 2026-10-09). Aplica solo a **v4**, solo a colecciones **con** tope («Unbounded containers are unchanged»), y no existe ninguna 3.x corregida (3.25.76 es la última). Migrar a zod 4 manteniendo la API v3 no lo corregiría.
- **Datos de origen:** OSV y GitHub coinciden: `< 4.6.6`; advisory actualizado el 2026-10-23 a las 18:26 UTC.

### 9.2 Rutas y esquemas auditados

| Módulo | Esquemas | Entrada | Colecciones |
|---|---|---|---|
| `schemas/auth.schema.js` | login, reset-request (×2 rutas), reset-confirm (×2) | pública, con rate limit **antes** de validar | ninguna; strings con `.max()` y `.strip()` |
| `schemas/offline.schema.js` | `POST /api/offline/assignment` | autenticada | ninguna |
| `observability/rum.js` | `POST /api/rum` | pública (`METRICS_ENABLED=1` en producción) | ninguna; enum, string y número |
| `analytics/eventRegistry.js` | 79 eventos | **solo** desde el servidor | 4 `z.array` con `.max(20/500/50/50)` |

- **Los 4 arrays no reciben entrada externa:**
  - `group_updated` y `membership_moved` no tienen emisor.
  - `leo_memory_updated` y `leo_profile_updated` solo los emite `leoBackboneEmitter`, que recorta a 50 strings de ≤ 40 caracteres antes de validar.
  - Los eventos de lectura del cliente se mapean a nombres de lectura cerrados y se reconstruyen con escalares.
- **Transitivas:** `openai` solo usa zod en helpers que el servidor no llama y en un conversor de esquemas. El front no usa zod.
- **Cuerpo HTTP:** el único parser es `express.json` (global y 8 rutas de Aula Viva, autenticadas), con el límite por defecto de 100 kB **después de descomprimir**. El edge permite 100 MB, pero Express corta antes.

### 9.3 Verificación

- **Prueba de regresión** `server/__test__/zodAdvisoryExposure.test.mjs` (`npm run test:zod-exposure`, paso bloqueante de `identity-preflight`): **34/34**. Comprueba:
  - el inventario de importadores;
  - las colecciones y sus topes;
  - los emisores y el recorte de Leo;
  - los parsers sin `limit` propio, y 413 con 101 kB, con gzip que se expande a 10 MB y con deflate que se expande a 1 MB;
  - el peor caso de los esquemas alcanzables con 100 kB adversariales: ≤ 2 issues y < 200 ms; medido, < 2 ms;
  - la excepción: solo este id, caducidad ≤ 2026-11-23 y zod 3.25.76.

  Si cambia cualquiera de esas condiciones, el CI se pone en rojo.
- **Servidor real** (sandbox en modo producción con datos sintéticos, código idéntico a HEAD): **23/23**.
  - Login válido, inválido, con tipos erróneos (400 con ≤ 20 detalles), con un array de 51 000 elementos no declarado (200, descartado), con 101 kB (413) y con gzip de 10 MB (413).
  - Las 4 rutas de reset, incluido `email` como array de 51 000 elementos (400).
  - Offline: sin sesión 401; inválidos 400; válido llega al handler.
  - RUM: 204.
  - Ráfaga de 40 cuerpos de ~100 kB: sin 5xx y `ready` sigue en 200. Memoria del contenedor estable (127 → 120 MiB), 0 errores y 0 secretos en los logs.
  - El rate limit de login y reset devolvió 429 en una repetición: actúa antes de `zod`.
- **Suites** (`node:20-bookworm`, `npm ci`): session-browser, auth-reset, credential-reset, b2c, evidence (test y lint), 2 de sesión, 3 de authz, uploads, Leo ownership, login `lastLoginAt` y 2 de eventos, todas en verde.
  - `identity-preflight`: 3207 ✓, con el único fallo previo de `test:library`.
  - `analyticsCanon`: el fallo previo de `scripts/events-archive.mjs`, que no está versionado.
- **OSV:** con la excepción, 0 («Filtered 1»). **Sin ninguna configuración**, el único hallazgo del lockfile es este zod: la excepción no oculta nada más, y las excepciones caducadas no se renuevan.
- **Trivy fs:** 0. Su base de datos aún no incluye este advisory; si lo incorpora, el job `trivy` se pondrá en rojo y habrá que tomar una decisión explícita en `.trivyignore`.

### 9.4 Riesgo residual y revisión anticipada

- **Riesgo residual:** CPU y heap proporcionales a 100 kB por petición en las rutas alcanzables, sin amplificación por issues.
- **Revisar antes de la caducidad** si:
  - cambia el advisory o aparece una 3.x corregida;
  - un esquema añade colecciones;
  - un emisor de esos 4 eventos pasa a recibir datos del cliente;
  - se sube el límite de cuerpo;
  - se expone una ruta pública nueva con zod.
- **Responsable:** seguridad técnica de Chibalete+.
- **Corrección definitiva** (unidad propia): migrar a zod ≥ 4.6.6 **y** a la API v4 en los 4 módulos, manteniendo los `.max()`.

## 10. Lote F — secretos históricos de Gitleaks (2026-10-24)

`gitleaks-history` reportaba 10 hallazgos, todos del historial y ninguno en el árbol (`gitleaks-head` en verde). Verificación dentro del proceso: valores por stdin, solo recuentos; nunca en argumentos ni en salidas.

| # | Huella (commit:archivo:regla:línea) | Qué es | Decisión |
|---|---|---|---|
| 1–3 | `376f6dd…:server/__test__/adminSecretFile.test.js:generic-api-key:44-46` | fixtures sintéticas del test del lector de secretos | **ignorada por huella exacta** |
| 4–8 | `f7f0c5c…:{ecosystem.config.cjs:8, server/simulate_novelty.js:7, server/test_persistence_flow.js:11, server/test_user_flow.js:5, verify_pipeline.cjs:9}:chibalete-admin-secret` | secreto de máquina anterior (2 valores) | **revocado** (≠ secreto vivo y ≠ entorno de los contenedores; 401 en ambas réplicas; re-confirmado hoy) → **ignorada por huella exacta** |
| 9–10 | `f7f0c5c…:studio-editor-bi/assets/index-CqLdlylq.js:{gcp-api-key, chibalete-gemini-key}:1120` | clave de la config web de Firebase de Studio Editor BI | **NO ignorada** (ver 10.2) |

### 10.1 Las ocho excepciones

- Aplicadas en `.gitleaksignore` con justificación individual; sin reglas, rutas ni regex.
- Tras aplicarlas, el historial deja exactamente los 2 hallazgos de Firebase. El árbol versionado da 0 hallazgos.
- **Detección intacta:** en un repositorio aislado con estos `.gitleaks.toml` y `.gitleaksignore`, cinco secretos sintéticos nuevos se detectan tanto en `detect` como en `dir` (rc=1):
  - uno en `ecosystem.config.cjs` línea 8, el mismo archivo y línea que una huella ignorada;
  - uno en `adminSecretFile.test.js` línea 44, ídem;
  - dos en el bundle de Studio línea 1120;
  - uno de OpenAI en un archivo nuevo.

  La huella incluye el commit, así que no abre huecos.

### 10.2 Clave web de Firebase — evaluación (solo lectura)

- **Proyecto:** `studio-editor-bi` (número de proyecto 515623025414).
- **Qué es:** es la configuración web de Firebase (`apiKey` de `firebaseConfig`), pública por diseño. Es la misma clave que sirve hoy el bundle de Studio y aparece una sola vez en él. El SDK de Gemini del bundle usa un valor de relleno, así que no hay ninguna clave de IA expuesta. El backend de Studio no usa esta clave: trabaja con la cuenta de servicio vía Admin SDK.
- **Datos:** las reglas del repositorio de Studio niegan todo por defecto; Storage niega todo al cliente; los datos van por `orgId` y scopes en los claims.
- **En vivo, sin autenticación** (Firestore REST con la clave):
  - `directory`, `editorials`, `orgs`, `users`, `sector_views_stub`, `contracts` y `monthlyPL` → 403;
  - el listado de Storage (Firebase y GCS, bucket por defecto y `studio-editor-bi-documents`) → 403/401/400.
- **Restricciones de la clave: AUSENTES.**
  - Sin restricción de aplicación: Identity Toolkit responde 200 sin Referer y con un Referer ajeno.
  - Sin restricción de API: una API ajena a Firebase (YouTube Data) responde `SERVICE_DISABLED`, no `API_KEY_SERVICE_BLOCKED`. Lo mismo ocurre con Gemini.
  - Cualquier API que se habilite en el proyecto quedaría usable con esta clave desde cualquier origen.
- **Riesgos:**
  - Consumo no autorizado de cualquier API habilitada hoy o en el futuro (por ejemplo, si se activa Generative Language para Studio).
  - Si el alta libre de cuentas (sign-up) está habilitada en Firebase Auth, cualquiera podría crear una cuenta y leer `directory`, `editorials`, `orgs` y `sector_views_stub`, que solo exigen `isLoggedIn()`. El estado del sign-up no es observable sin credenciales y no se probó, porque crearía cuentas.
- **Conclusión:** identificador público sin las restricciones mínimas → **no se añade excepción** (gate YELLOW para estos 2 hallazgos).
- **Corrección mínima** (consola de GCP/Firebase, por el titular del proyecto; sin cambios de código):
  1. **Restricción de aplicación** — referentes HTTP: `https://studio.chibaleteeditores.com/*`, `https://studio-editor-bi.firebaseapp.com/*`, `https://studio-editor-bi.web.app/*` (más `http://localhost:*` solo si se desarrolla contra producción).
  2. **Restricción de API** — solo Identity Toolkit API, Token Service API, Cloud Firestore API y, si se usan, Firebase Installations y Firebase App Check.
  3. **Firebase Auth** → desactivar «crear cuentas (sign-up)» si las altas son solo administrativas.
  4. Tras aplicarlo, re-sondear: Referer ajeno → `API_KEY_HTTP_REFERRER_BLOCKED`, API ajena → `API_KEY_SERVICE_BLOCKED`. Entonces se añaden las 2 huellas exactas como identificador público restringido.

### 10.3 Hallazgo de CI fuera del lote

`trivy` (fs) y `trivy-image (api)` pasaron a rojo el 2026-10-24 con la base de Trivy de las 01:18 UTC. La causa es **CVE-2023-54404**: es la alias CVE de GHSA-mrhx-c7xc-m3w5, la misma vulnerabilidad de zod aceptada en ZOD-01. Esa excepción solo cubre OSV. Extenderla a `.trivyignore` (misma caducidad, 2026-11-23) es decisión de Dirección y no se aplica en este lote.

Los demás hallazgos locales de Trivy vienen de `deployment_package/` y `_prod_snapshot_/`, copias no versionadas que no están en el repositorio ni en el CI.

## 11. F1 — cierre de Trivy y clasificación de los 2 hallazgos de Firebase (2026-10-24)

**Base:** `30f7d28`. **Alcance:** solo el repositorio de Chibalete+. No se accedió a Firebase, Google Cloud ni Studio Editor BI; no se tocaron claves, permisos, historial, producción ni datos.

### 11.1 Zod en Trivy — `CVE-2023-54404`

- Es la alias CVE de GHSA-mrhx-c7xc-m3w5 (zod 3.25.76), ya aceptada en ZOD-01 (§9). Se añade a `.trivyignore` con la misma justificación y la misma caducidad: `CVE-2023-54404 exp:2026-11-23`.
- A diferencia de las demás entradas del archivo, esta caducidad **es ejecutable**: con `exp:2026-10-01` Trivy 0.70.0 vuelve a reportarla (rc=1).
- **Sin ocultar otras vulnerabilidades** (base de Trivy del 2026-10-24 13:07 UTC, archivos versionados):
  - con el `.trivyignore` de `30f7d28`: rc=1 y un único hallazgo (`CVE-2023-54404`, zod 3.25.76, HIGH, `package-lock.json`);
  - con el de F1: rc=0 y 0 hallazgos (vuln, misconfig y secret). `trivy config` también da rc=0.

### 11.2 Clasificación de los dos hallazgos de Firebase

Huellas: `f7f0c5c…:studio-editor-bi/assets/index-CqLdlylq.js:{gcp-api-key, chibalete-gemini-key}:1120`. Verificación dentro del proceso con `git show`; solo se imprimieron recuentos, nombres de propiedades y una huella SHA-256 truncada (`614ce8afb582`).

| Comprobación | Evidencia del repositorio | Resultado |
|---|---|---|
| Mismo identificador | La línea 1120 tiene una sola cadena con forma de clave Google, que además es la única en todo el archivo. Las dos reglas disparan sobre ella. | ✅ un solo valor |
| Configuración web de Firebase | La cadena es el `apiKey` de un objeto literal con `authDomain` (`studio-editor-bi.firebaseapp.com`), `projectId` (`studio-editor-bi`), `storageBucket`, `messagingSenderId`, `appId` y `measurementId`. El bundle lo pasa a la inicialización de la app de Firebase (`getApps().length>0 ? getApp() : initializeApp(cfg)`, minificado). | ✅ config web de cliente |
| Origen | Bundle minificado de Studio Editor BI (`studio-editor-bi/assets/`), introducido en el commit inicial `f7f0c5c` y retirado en `91c6c64`. `studio-editor-bi/` está en `.gitignore`. Solo lo referencia el `docker-compose.yml` heredado de `f7f0c5c` (servicio `apps-spa-nginx`, montaje estático), que no es la topología de producción. | ✅ producto ajeno, histórico |
| No es credencial privada ni administrativa | El archivo no contiene `private_key`, `BEGIN PRIVATE KEY`, `BEGIN RSA`, `client_email`, `service_account` ni `gserviceaccount.com`. El SDK de IA del bundle se inicializa con un valor de relleno de 18 caracteres (`dummy_key_for_init`), no con esta cadena. | ✅ identificador público |
| Chibalete+ no depende de ella | Aparece en 0 de 1347 archivos versionados en HEAD, y en `dist/` y en los `.env*` locales tampoco. Hay 0 imports del SDK `firebase`: el paquete figura en `package.json`, pero no se usa. `Dockerfile.front` no declara `ARG`/`ENV`, y `.dockerignore` excluye `.env*`, así que el build de producción no recibe `VITE_FIREBASE_API_KEY`. La única mención en el código (`services/geminiService.ts:40`) es una comparación de diagnóstico. | ✅ sin dependencia |

**Clasificación:** configuración pública de cliente de un producto ajeno (Studio Editor BI), en un bundle histórico. **No es** una credencial privada de servicio ni administrativa. No aplica el STOP.

**Alcance de esta clasificación:**
- No declara segura la configuración de Studio Editor BI.
- Las restricciones de la clave y los permisos de Firebase **no han sido auditados ni aprobados en este proyecto**.
- El sondeo de solo lectura de Lote F (§10.2) observó la clave sin restricción de aplicación ni de API. La corrección en consola que propone §10.2 sigue pendiente y pasa a una unidad independiente de Studio Editor BI.

**Cambio de criterio respecto de §10.2:**
- Lote F condicionaba la excepción a que la clave estuviera restringida.
- F1 la condiciona a la **naturaleza** del valor (identificador público de un producto ajeno, sin dependencia de Chibalete+), por decisión de Dirección.
- El riesgo de Studio BI no desaparece: sale del gate de Chibalete+.

### 11.3 Excepciones aplicadas

- En `.gitleaksignore` se añaden 2 huellas exactas, con la justificación anterior y sin reglas, rutas ni regex:
  - `f7f0c5c98ea7531a4e9ecd7d91f0ca3015b975e7:studio-editor-bi/assets/index-CqLdlylq.js:gcp-api-key:1120`
  - `f7f0c5c98ea7531a4e9ecd7d91f0ca3015b975e7:studio-editor-bi/assets/index-CqLdlylq.js:chibalete-gemini-key:1120`
- En `.trivyignore`: `CVE-2023-54404 exp:2026-11-23`.

### 11.4 Verificación local (gitleaks 8.21.2 y Trivy 0.70.0, las versiones del CI)

- **gitleaks-history:**
  - en un clon aislado con el `.gitleaksignore` de `30f7d28`: rc=1, con exactamente las 2 huellas anteriores;
  - con el de F1: rc=0 y 0 hallazgos;
  - en el repositorio de trabajo (466 commits): rc=0.
- **gitleaks-head:** `gitleaks dir` sobre la exportación de los archivos versionados no da hallazgos fuera de `docs/**/*.md`. Los 18 que da están todos en `docs/**/*.md`, que la allowlist excluye con `/`; en Windows gitleaks informa las rutas con `\` y la allowlist no casa. Es un artefacto local y el gate autoritativo es el job Linux del CI.
- **Detección de secretos nuevos:** se creó un repositorio aislado con los `.gitleaks.toml` y `.gitleaksignore` de F1 y valores aleatorios generados en ejecución (no se versionan). `detect` y `dir` dan rc=1 y detectan **7/7**:
  - una config Firebase sintética en `studio-editor-bi/assets/index-CqLdlylq.js` **línea 1120**, el mismo archivo y línea que las huellas F1 (`gcp-api-key` y `chibalete-gemini-key`);
  - otra clave en la línea 1121 del mismo archivo (las dos reglas);
  - un secreto de administración en `ecosystem.config.cjs:8`;
  - un `generic-api-key` en `adminSecretFile.test.js:44`;
  - una clave OpenAI en un archivo nuevo.

  La huella incluye el commit, así que la excepción no abre ningún hueco.
- **Trivy fs y config:** ver 11.1.
- **OSV, trivy-image (api/front), image-integrity, evidence-hardening y el resto del CI:** ver 11.5.

### 11.5 CI

Run del commit `f351f9a` (2026-10-24): **9/9 en verde** por primera vez en SEC-DEPS-02.

| Job | Resultado |
|---|---|
| gitleaks-head | ✅ success |
| gitleaks-history | ✅ success (antes en rojo desde el inicio de SEC-DEPS-02) |
| evidence-hardening | ✅ success |
| osv-scanner | ✅ success |
| trivy (fs + config) | ✅ success |
| trivy-image (api) | ✅ success |
| trivy-image (front) | ✅ success |
| image-integrity | ✅ success |
| content-rmw | ✅ success |

`identity-preflight` no se dispara, porque sus rutas no cambian en F1.

Local: OSV 2.0.0 sin hallazgos (solo filtra GHSA-mrhx por ZOD-01), `lint:evidence` sin violaciones en 1110 archivos y `test:evidence` 41/0. Docker local no estaba disponible, así que trivy-image e image-integrity solo se verificaron en el CI.

### 11.6 Veredicto

**GREEN** para Chibalete+. Los gates de SEC-DEPS-02 están cerrados.

Quedan dos pendientes, ambos fuera de este gate:
- **Excepción zod (OSV + Trivy):** caduca el **2026-11-23** y hay que revisarla antes de esa fecha.
- **Clave web de Studio Editor BI:** sigue **sin restricciones** (§10.2). Se registra para tratarla en una unidad independiente de Studio Editor BI. F1 no la declara segura.
