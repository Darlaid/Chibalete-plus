# CHP-MOOK-ESTAS-AQUI-04B — PRODUCTION RELEASE PREFLIGHT

**Veredicto:** 🟡 **`YELLOW-OPERATOR-DECISION`** — causa específica: **`YELLOW-AUDIENCE-DECISION`**
**Rama:** `chp/mook-contract-00` · **HEAD:** `340df30`
**Fecha:** 2026-08-25 · **Operador:** Nicolás Jiménez
**Naturaleza:** preflight y preparación. **Cero mutaciones productivas ejecutadas.**

> **El código puede desplegarse. La publicación de la experiencia NO está autorizada** hasta que el
> operador resuelva la decisión de audiencia documentada en §F. Ver §N.

---

## A. VEREDICTO

| Fase | Resultado |
|---|---|
| A · Convergencia Git | 🟢 fast-forward limpio, 20 commits |
| B · Inventario funcional | 🟢 aditivo, sin regresión detectada |
| C · Compatibilidad de stores | 🟢 verificado empíricamente |
| D · Manifest editorial | 🟢 con **corrección crítica de id** |
| E · Estrategia de materialización | 🟢 **las rutas canónicas bastan** — no hace falta loader |
| F · Audiencia y exposición | 🟡 **`YELLOW-AUDIENCE-DECISION`** |
| G · Backup y rollback | 🟢 226 snapshots, tres timers en exit 0 |
| H · Release candidate | 🟢 suites y build · ⚠️ **build de imágenes NO verificado** (ver §J) |
| I · Runbook 04C–04F | 🟢 entregado |

**No se emite `GREEN-READY-FOR-STAGED-PRODUCTION-RELEASE`** porque §F no lo permite: publicar hace
la experiencia visible para **toda la base autenticada** sin gate previo verificable.

**No se emite `STOP-RELEASE-CONVERGENCE`** (la rama converge) ni **`STOP-BACKUP-GATE`** (cobertura
demostrada) ni **`YELLOW-IMPORT-PATH`** (las rutas canónicas bastan) ni **`RED-RELEASE-REGRESSION`**
(sin regresión detectada).

---

## B. BASELINE GIT Y PRODUCTIVO

### Local

| Elemento | Valor |
|---|---|
| Rama | `chp/mook-contract-00` |
| HEAD local = `origin/chp/mook-contract-00` | `340df300ed80629f5d49dd4e60a9f691db1eadbe` |
| Working tree | limpio salvo 2 carpetas **untracked** (editorial + `Programa integral/`) |
| `origin/main` | `7767c4f21ae8303ffdab2a45a97908ac7e3f44aa` |
| Divergencia | **167 commits por delante de main, 0 por detrás** |

### Producción (inspección read-only vía SSH, `srv1179443`)

| Container | Imagen | Estado | Restarts | StartedAt |
|---|---|---|---|---|
| `chibalete_api_1` | `chibalete/api:679b036` | healthy | **0** | 2026-08-18T19:13:44Z |
| `chibalete_api_2` | `chibalete/api:679b036` | healthy | **0** | 2026-08-18T19:12:24Z |
| `chibalete_front` | `chibalete/front:lib01-679b036` | healthy | **0** | 2026-08-18T19:15:52Z |
| `chibalete_edge` | `nginx:alpine` | healthy | **0** | 2026-08-11T01:33:31Z |

Coexisten `studio_bi_*` (**app SEPARADA**, fuera de alcance) y el stack de observabilidad
(prometheus, grafana, cadvisor, alertmanager, node_exporter).

**HEAD productivo = `679b036`.** Imágenes de rollback presentes en el host: `api:8ed4e5e`,
`api:c9f323e`, `api:0ff76b6`, `api:cf36852`, `api:rollback-current`, `front:m1a-0ff76b6`.

### ⚠️ Corrección al `CLAUDE.md`

`CLAUDE.md` describe el deploy backend como «swap atómico de bind mount `/var/www/chibalete/server`».
**Eso ya no es cierto.** El `docker inspect` de `api_1` muestra los mounts reales:

```
/var/www/chibalete/secrets                     -> /app/secrets            (ro)
/var/www/chibalete/release/2945fa8/.deploy-info-> /app/server/.deploy-info (ro)
/var/www/chibalete/identity                    -> /app/identity           (rw)
/var/www/chibalete/sessions                    -> /app/sessions           (rw)
/var/www/chibalete/data-critical               -> /app/data-critical      (rw)
/var/www/chibalete/data                        -> /app/data              (rw)
/var/www/chibalete/public/uploads              -> /app/public/uploads     (rw)
```

**No hay bind mount de `/app/server`: el código viaja EN LA IMAGEN.** El deploy backend es
`git archive → build en VPS → tag SHA → override → up escalonado`. El runbook §L asume esto.

---

## C. CONVERGENCIA DEL RELEASE

**`679b036` ES ancestro de `340df30`.** El release es un **fast-forward limpio de 20 commits**.

```
9f4f892 docs(ops): CHP-LIB-01-RELEASE — GREEN-LIB-01-PROD     ← primero tras la imagen productiva
fbf4c06 docs(product): CHP-ADR-MOOK + CHP-MOOK-PILOT-DESIGN-00
6bde36c feat(mook): CHP-MOOK-01 — vertical slice
7b15e2b feat(mook): CHP-MOOK-V4-REALIGN-01
fa5ef62 docs(product): CHP-MOOK-PRODUCT-UX-01
16232a3 feat(mook): CHP-MOOK-RUNTIME-01
073358d docs(mook): close Experiences MVP contract
3b8509c feat(mook): add Experiences authoring studio
5150ee3 feat(mook): add human production review
53c47dd docs(mook): pilot content sources inventory
a665780 feat(mook): add teacher induction pilot
d35f6ed docs(mook): prototype-02
c2c11cb docs(mook): prototype-03
4794604 feat(mook): freeze MVP scope with ADR §18
523bc37 docs(mook): estas-aqui preflight
37ea76c feat(mook): private journal primitive
be16d83 feat(mook): audio a11y + transcript download
5beee8d docs(mook): estas-aqui canonical load
36b1e75 docs(mook): estas-aqui book excerpts + v3
340df30 docs(mook): close Estas Aqui human editorial QA          ← HEAD
```

**46 archivos, 10 332 inserciones, 20 supresiones.** La proporción confirma que el release es
**aditivo**: 18 docs · 14 server · 4 pages · 3 components · `App.tsx` · `types` · `dataService.ts` ·
`routePermissions.ts` · `package.json` · `.gitignore` · 1 script.

**`package.json` cambia SOLO scripts** (añade `test:mook` y lo encadena a `test:identity-preflight`).
**Cero cambios en `dependencies`/`devDependencies`** → el `npm ci` de la imagen no cambia.
**Ni `Dockerfile.api`, ni `Dockerfile.front`, ni `docker-compose`, ni `nginx` se tocan.**

**Sin cambios productivos posteriores al baseline** que solapen con estos archivos: producción
corre `679b036` sin restarts desde el 18/Ago y sus mounts de datos no contienen artefactos MOOK.

→ **No se emite `STOP-RELEASE-CONVERGENCE`.**

---

## D. INVENTARIO FUNCIONAL

| Frente | Backend | Frontend | Datos/config | Gate tras el deploy |
|---|---|---|---|---|
| **Runtime y descubrimiento** | `GET /api/experiences`, `/:id`, `POST /:id/run`, `GET /:id/route`, `POST …/nodes/:nodeId/complete` · `experienceStore.js` | `pages/Experiencias.tsx`, `App.tsx`, `routePermissions.ts` | `data/mook_db.json` (**no existe aún**) | **ACTIVO** — pero inerte sin experiencias publicadas |
| **Lectores/visores** | sin cambios | `pages/Biblioteca.tsx` (destacada V4) | catálogo | **ACTIVO**, aditivo |
| **Audio/transcripciones** | sirve `/uploads` (ya existente) | `NodeMediaPlayer` + `downloadTranscript` en `Experiencias.tsx` | MP3 en uploads; transcripción en `config.transcripcion` | **ACTIVO**; el player solo monta con preflight `allowed` |
| **Bitácora privada** | `POST …/nodes/:nodeId/evidence`, `myEvidenceView`, `isPrivateActivityNode` | panel privado en `Experiencias.tsx` | `mook_db.evidence` | **ACTIVO fail-closed** |
| **Studio** | `POST /api/experiences`, `/:id/versions`, `PUT /versions/:vid`, `POST /versions/:vid/publish`, `PUT /:id`, `POST /:id/archive`, `GET /admin/list`, `/admin/:id` | `components/studio/ExperienceStudio.tsx`, `pages/SubirContenido.tsx` | `mook_db` | **ADMIN ONLY** |
| **Bandeja de recursos** | `/api/upload` + `/api/content` (**preexistentes**, sin cambio) | `SubirContenido.tsx` | catálogo + uploads | **ACTIVO**, ya productivo hoy |
| **Versionado/preview** | `createDraftVersion`, `updateDraftVersion`, `publishVersion` | preview en el Studio (`NodeShell`, run sintético) | `mook_db.versions` | **ADMIN ONLY**; preview **0 llamadas de red** |
| **Producciones/Review** | `GET /review/queue`, `/review/:id/detail`, `POST …/feedback`, `/request-changes`, `/review/:id`, `/evidence/:id/resubmit` | `components/review/ProduccionesTab.tsx`, `pages/AulaViva.tsx` | `mook_db.evidence` | **ADMIN**; **mediador 403 `MEDIATOR_SCOPE_GATED`** |
| **Telemetría dormant** | `experienceBackboneEmitter.mjs` + 6 esquemas en `eventRegistry.js` | — | `events.db` | **DORMANT** — ver abajo |
| **MOOK «¿Estás aquí?»** | — | — | 41 recursos a crear + experiencia | **NO EXISTE en producción** |

### Confirmaciones de seguridad exigidas

| Requisito | Evidencia |
|---|---|
| Studio solo administrador | `requireAdminAccess` en las 8 rutas de autoría; `GET /admin/list` exige `isAdminSession`. **Smoke aislado: lector → 403.** |
| Identidad derivada de sesión | `requireUserAuth` resuelve `req.user`; `myEvidenceView` exige `run.userId === userId`, **jamás el cliente**. |
| Bitácoras privadas fail-closed | `isPrivateActivityNode` devuelve `true` si el nodo **no se resuelve** en la versión fijada. Sin bypass por rol. |
| Review de mediadores en 403 | **Smoke aislado y productivo-equivalente: `demo-profesor` → HTTP 403 `MEDIATOR_SCOPE_GATED`.** |
| Eventos MOOK OFF | `EXPERIENCE_EVENTS_BACKBONE_ENABLED` **ausente del entorno de `api_1`** → default OFF = NO-OP. Verificado por `docker inspect`. |
| Android LU y lectores sin regresión | El release **no toca** rutas de progreso, offline, analytics, sesión ni `lu_config.json`. Smoke aislado: `/api/content`, `/api/groups`, `/api/users`, `/api/health` → **200**; sin sesión → **401**. |
| Ninguna ACTIVITY privada en Producciones | `reviewListView` filtra `e.requiresReview`; una ACTIVITY nunca lo activa. Verificado en 04A con sentinels: **0 fugas**. |
| «Paquetes (legacy)» preservado | Sin cambios en esas rutas ni en su entrada de menú. |

---

## E. SEGURIDAD, SESIONES Y PRIVACIDAD

- **`SESSION_AUTH_MODE=compat`** en producción: el navegador usa cookie firmada; `x-user-id` sigue
  admitido para server-to-server. El MOOK **no introduce un canal de identidad nuevo**: consume
  `requireUserAuth` / `requireAdminAccess` existentes.
- El MOOK **no toca** M1-A ENFORCE, M1-B, STATS ni la migración identity SQLite. `IDENTITY_READ=json`,
  `IDENTITY_DUAL_WRITE=1`, `IDENTITY_SHADOW_COMPARE=1` permanecen como están.
- **Riesgo residual heredado (no del MOOK):** `ACCESS_FALLBACK_MODE=open` en producción. Ver §I.

---

## F. COMPATIBILIDAD DE STORES Y PERSISTENCIA

### Ubicación y formato productivos

| Store | Ruta productiva | Estado |
|---|---|---|
| Catálogo | `/var/www/chibalete/data/content.json` | **67 entradas** (402 KB, 29/May) |
| Uploads | `/var/www/chibalete/public/uploads` | **5,1 GB**, 64 entradas, 3 163 archivos |
| **`mook_db`** | `/var/www/chibalete/data/mook_db.json` | 🔵 **NO EXISTE** |
| Grupos/entitlement | `/var/www/chibalete/data/groups_db.json` | 20 grupos |
| Usuarios | `/var/www/chibalete/data-critical/usuarios_colegios_oro.json` | 334 KB |
| Eventos | `/var/www/chibalete/data-critical/events.db` | 9,06 MB + WAL 2,47 MB |
| Reglas de acceso | `/var/www/chibalete/data/access_db.json` | **1 regla**, scope `group`, solo `lt-test-group-v2` |

Los cinco directorios de datos son **bind mounts `rw`** → **persisten entre recreates**.
Propietario `root:root`, modo `755`; el proceso del container corre como `uid=0` → **sin problema de
permisos** al crear `mook_db.json`. Espacio libre: **51 GB** (el MOOK añade ~58 MB).

### Creación del store MOOK — verificado empíricamente

Levanté un servidor **en un sandbox aislado sin `mook_db.json`** (`CHP_DATA_DIR` propio, padrón
canónico, puerto 3020):

| Prueba | Resultado |
|---|---|
| Arranque del servidor sin el store | ✅ **`Server running on port 3020`**, sin error |
| `GET /api/experiences` (participante) | ✅ **HTTP 200 `[]`** — no crashea, lista vacía |
| `GET /api/experiences/admin/list` (admin) | ✅ **HTTP 200 `[]`** |
| ¿Se crea el archivo al leer? | ✅ **NO** — sigue ausente |
| `POST /api/experiences` (primera escritura) | ✅ **HTTP 200**, y el store **se materializa solo** |
| Forma del store creado | ✅ `{experiences, versions, runs, evidence}`, 454 bytes |

→ **Creación automática en la primera escritura de autoría. No requiere paso manual, ni `touch`, ni
seed.** `normalizeMookStore` tolera archivo ausente, `null`, array o basura.

**Rollback del código con datos MOOK ya presentes:** los datos son **aditivos** —un archivo nuevo
más entradas nuevas en catálogo/uploads—. Volver a la imagen `679b036` simplemente deja de leer
`mook_db.json`; nada del código antiguo lo interpreta ni lo borra. **El rollback de código es
seguro con datos MOOK presentes.**

El sandbox se retiró al terminar y **el `mook_db.json` local quedó byte-idéntico** a su backup previo.

---

## G. MANIFEST EDITORIAL

### 🔴 Corrección crítica de identificador

La unidad 03B registró `content-1765751139919` como «el id productivo» del libro. **Es incorrecto.**

| Id | Título productivo real |
|---|---|
| `content-1765751139919` | **«La metamorfosis», Franz Kafka** ❌ |
| **`content-1774362922886`** | **«Me desconecto, luego existo », N. Caballero, M. Pérez M., N. Castiblanco C., M. López S., Romero C., M. Díaz** ✅ |

El id equivocado también aparece como `imageUrl` de la experiencia local *Me desconecto, luego
existo* (`/uploads/content-1765751139919/la_metamorfosis_esp-cover.jpg`) — **una portada de Kafka
usada como marcador**. Debe corregirse antes de cualquier carga productiva.

### El libro productivo SÍ sirve como `parentId`, sin modificarlo

| Comprobación | Resultado |
|---|---|
| `texto_plano_url` productivo | `/uploads/content-1774362922886/me_desconecto-1774362924884-516843797.txt` |
| Bytes | **148 647** |
| SHA-256 | `6a9734e4193056358bef8324b63162885c8385af1fec37b3ba374083535c5ce7` |
| Máster local del operador | **148 647 bytes, mismo SHA-256** |
| Veredicto | ✅ **ES EL MISMO ARCHIVO** |

→ **Los 10 extractos pueden crearse en producción con `parentId: content-1774362922886` sin tocar
el libro.** Sus offsets y límites, verificados en 04A contra ese mismo texto, son válidos tal cual.
`tipo=libro`, `status=disponible`, `isCollection=false`, `parentId=null`, `editorial=Chibalete`;
hoy tiene **0 hijos**.

### Clasificación de los 42 recursos de v4 (comparación por hash contra 3 163 archivos productivos)

| Clase | N.º | Detalle |
|---|---|---|
| **`REUSE-PROD`** | **1** | El libro `content-1774362922886` — su TXT es el único hash del MOOK que ya existe en producción |
| **`CREATE-PROD`** | **41** | 16 `podcast` (MP3, 57,6 MB) + 15 `articulo_pedagogico` (8 «Texto del mook ·» + 7 «Transición ·») + 10 `libro` (extractos) |
| **`NOT-REFERENCED`** | **2** | El **padre local** `content-1787627190805-00` (lo sustituye el productivo) y el **recurso READING de T08** `content-1787621720131-24` (v4 ya no lo referencia) |
| **`SOURCE-ONLY`** | 50 archivos | La carpeta editorial completa, incluido el máster del libro. **Jamás entra a Git ni se copia a producción como tal** |
| **`CONFLICT`** | **0** | Ningún hash del MOOK colisiona con un recurso productivo distinto |

**Ningún id local es reutilizable en producción.** Todos los `content-1787…` se generan de nuevo por
las rutas canónicas; la deduplicación por hash de `/api/upload` evita duplicar bytes.

---

## H. MAPPING LOCAL → PRODUCCIÓN

| Elemento local | Acción productiva |
|---|---|
| `content-1787627190805-00` (padre local del libro) | **NO crear** → usar `content-1774362922886` |
| 10 extractos `content-17876271910xx-xx` | **CREAR** con `parentId` productivo; cuerpo byte-idéntico |
| 16 MP3 `content-1787621719xxx` | **CARGAR** por `/api/upload` (dedup por hash) + `/api/content` |
| 15 textos y transiciones | **CREAR** |
| `content-1787621720131-24` (T08 READING) | **NO crear** |
| `content-1787675737067-a15r2` (A15 corregido) | **CREAR** con el MP3 `3c75004673056890…`, 7 375 973 B |
| `expv-1787666606847-5uytdu` (v4, 56 nodos) | **NO copiar.** Ensamblar como **v1 DRAFT productiva** |
| `run-*`, `evidence-*` locales | **NO migrar.** Trazabilidad local únicamente |
| `group-pilot-induccion` | **NO existe en producción.** Ver §I |
| `imageUrl` con portada de Kafka | **Corregir** antes de crear la experiencia |

**La experiencia productiva nace completa en v1 DRAFT.** No se recrea la secuencia local v1→v4:
v4 es el resultado editorial, y su contenido es el que se ensambla de una vez.

### §E — Estrategia mínima: las rutas canónicas BASTAN

Las 04A demostraron en vivo **cada** ruta necesaria, con éxito:

| Paso | Ruta | Demostrada en 04A |
|---|---|---|
| Cargar binario | `POST /api/upload` | ✅ A15 corregido, 7,03 MB, dedup por hash |
| Registrar en catálogo | `POST /api/content` | ✅ `content-1787675737067-a15r2` |
| Crear experiencia | `POST /api/experiences` | ✅ smoke en sandbox |
| Crear versión | `POST /api/experiences/:id/versions` | ✅ v4 con 56 nodos de una sola llamada |
| Editar borrador | `PUT /api/experiences/versions/:vid` | ✅ cableado de A15 y título del Epílogo |
| Publicar | `POST /api/experiences/versions/:vid/publish` | ✅ una sola vez |
| Entitlement | `PUT /api/groups/:id` | ✅ 48 → 49 ids |

→ **No se emite `YELLOW-IMPORT-PATH`. No se construye herramienta nueva.** El procedimiento es
manual asistido por API/Studio, con el orden del runbook §L.

⚠️ **Trampa de entorno para el operador:** `curl -F` falla (HTTP 000) con rutas de archivo
acentuadas en Windows. Copiar a ruta ASCII y pasar `;filename=` con el nombre editorial.

---

## I. AUDIENCIA Y EXPOSICIÓN — 🟡 `YELLOW-AUDIENCE-DECISION`

### El hallazgo

**Publicar la experiencia la hace visible para TODA la base autenticada, de inmediato y sin gate.**

Dos hechos independientes lo determinan:

**1 · El descubrimiento no filtra por audiencia.** En `server/lib/experienceStore.js`:

```js
export function listPublishedFor(doc, userId) {
    return listPublished(doc).map(e => ({ ...e, myRun: myRunSummary(doc, userId, e.id) }));
}
export function listPublished(doc) {
    return doc.experiences.filter(e => e.status === 'published' && e.currentVersionId)…
}
```

El único filtro es `status === 'published'`. **El store no consulta grupos, entitlements ni
organización en ningún punto del descubrimiento.**

**2 · El acceso a los recursos tampoco gatea hoy.** En producción:

- `ACCESS_FALLBACK_MODE=open`;
- los **20 grupos productivos tienen `availableContentIds` = 0** — sin excepción;
- `access_db.json` contiene **una sola regla**, para `lt-test-group-v2` (grupo de load-test).

→ El acceso a contenido productivo se resuelve **por el fallback abierto**. No hay hoy una capa de
entitlement operativa que pueda restringir el MOOK.

**Consecuencia:** con 625 membresías y ~647 cuentas en el padrón, publicar significa **liberación
general inmediata**. Un canario no es alcanzable con el código actual.

### Opciones reales, con sus consecuencias

| Opción | Cómo | Consecuencia | Riesgo |
|---|---|---|---|
| **A · DRAFT indefinido** | Cargar todo y dejar la experiencia en `draft` | **Invisible para participantes** (verificado en 04A: el borrador v4 no fue descubrible mientras `currentVersionId` apuntaba a v3). Solo admin la ve en el Studio | **Ninguno.** Es el gate real disponible |
| **B · Publicar = liberación general** | `POST …/publish` | Los ~647 usuarios la ven al instante | **Alto**: sin vuelta atrás salvo archivar |
| **C · Canario por grupo** | — | ❌ **NO IMPLEMENTABLE** con el código actual: el descubrimiento ignora grupos | Requiere código nuevo (fuera de alcance) |
| **D · Cuenta QA productiva** | Crear una cuenta y validar en DRAFT vía Studio/preview | Permite verificación productiva real **sin publicar** | Bajo; exige crear y luego retirar credenciales |

**No elegí ni alteré ningún grupo.** Ninguno de los 20 grupos productivos tiene nombre ni
composición que sugiera un canario editorial; el mayor (`lt-test-group-v2`, 400 miembros) es de
load-test y es el único con una regla de acceso.

### Decisión que corresponde al operador

1. ¿Se acepta que **publicar = liberación general** para toda la base?
2. Si no: ¿se detiene en **DRAFT** (opción A) hasta que exista gate de audiencia por código?
3. ¿Se autoriza una **cuenta QA productiva temporal** (opción D) para la verificación de 04E?

**Hasta que esto se resuelva, 04F (publicación) queda sin autorizar.** 04C y 04D sí pueden
ejecutarse: el código es aditivo e inerte, y la carga en DRAFT no expone nada.

---

## J. TESTS, BUILDS Y SMOKE AISLADO

### Suites — adoptadas del preflight de 04A

`git diff --stat` entre el preflight de 04A y ahora, sobre `*.ts *.tsx *.js *.mjs *.json`: **vacío**.
**El árbol de código no cambió**, así que las suites se adoptan conforme a la instrucción.

| Comando | Resultado |
|---|---|
| `npm run test:mook` | ✅ EXIT 0 — 9 suites (privateJournal 14/14, audioA11y 14/14, review01 15, studio01 12, mvpFreeze 7) |
| `npm run test:library` | ✅ EXIT 0 — 17 escenarios |
| `npm run test:metric-contract` | ✅ EXIT 0 — 16 ok |
| `npm run test:memberships` | ✅ EXIT 0 — 51 ok |
| `npm run typecheck:baseline` | ✅ EXIT 0 — sin regresiones |
| `npm run build` (frontend) | ✅ EXIT 0 — 1 m 19 s |

**No se modificó ningún test.**

### Smoke en entorno aislado (nuevo en esta unidad)

| Prueba | Resultado |
|---|---|
| Arranque con `mook_db` ausente | ✅ |
| MOOK sin datos: participante y admin | ✅ `[]` / `[]`, HTTP 200 |
| Materialización del store en la 1.ª escritura | ✅ |
| Legacy: `/api/content`, `/api/groups`, `/api/users`, `/api/health` | ✅ 200 |
| Sin sesión: `/api/content` | ✅ **401** |
| Lector → `/api/experiences/admin/list` | ✅ **403** |
| Mediador → `/api/experiences/review/queue` | ✅ **403 `MEDIATOR_SCOPE_GATED`** |

### ⚠️ Limitación honesta: build de imágenes NO verificado

**No pude construir las imágenes que realmente se desplegarían.** Docker Desktop no está corriendo
en la máquina local (`failed to connect to the docker API at npipe://…`), y construir en el VPS es
una mutación productiva prohibida en esta unidad.

Mitigantes: `Dockerfile.api` y `Dockerfile.front` **no cambian** en el release, y `package.json`
**no altera dependencias**, de modo que el build es una recompilación en el SHA nuevo sin cambio de
capa de dependencias. Aun así, **el build de imágenes queda como precondición explícita y
verificable de 04C**, con su propio gate — no se declara GREEN aquí.

---

## K. BACKUP Y ROLLBACK — 🟢

### Cobertura demostrada

| Timer systemd | Última ejecución | Exit |
|---|---|---|
| `structured-backup` (SQLite + JSON → restic) | **2026-08-25 18:02:34 UTC** | **0** |
| `uploads-backup` (incremental → restic) | 2026-08-25 03:38:55 UTC | **0** |
| `backup-verify` (verificación no destructiva) | 2026-08-23 05:13:37 UTC | **0** |

Repo restic en Backblaze B2 (`s3:https://s3.us-east-005.backblazeb2…`): **226 snapshots**.
`structured` corre cada 6 h; los últimos cuatro del día son visibles y consistentes.
Cubre `data/` (catálogo, grupos, y el futuro `mook_db.json`), `data-critical/` (usuarios, eventos) y
`uploads/`.

**Código:** las imágenes anteriores están en el host (`api:679b036` es la productiva actual;
además `8ed4e5e`, `c9f323e`, `0ff76b6`, `cf36852`, `rollback-current`). **`docker image prune -af`
sigue prohibido.**

→ **No se emite `STOP-BACKUP-GATE`.**

### Rollback por capas — **nunca «borrar datos»**

| Capa | Rollback |
|---|---|
| **Código** | `docker compose` con override a `chibalete/api:679b036` y `front:lib01-679b036` + up escalonado. Los datos MOOK aditivos quedan en disco y **el código antiguo simplemente los ignora** |
| **Carga editorial** | **Conservar** los activos. Si molestan, marcar los registros de catálogo como no disponibles — **jamás borrar archivos de `uploads/`** |
| **Experiencia en DRAFT** | No hacer nada: ya es **no descubrible** |
| **Experiencia publicada** | `POST /api/experiences/:id/archive` — **archivo NO destructivo** (ADR §17.3): deja de descubrirse e iniciarse; versiones, runs, progreso y evidencia quedan **intactos** y los runs activos pueden terminar |
| **Runs** | **Siempre preservados y pineados** a su versión. Ninguna operación de rollback los toca |

---

## L. RUNBOOK 04C–04F

### 04C · `CODE-DEPLOY`

**Precondiciones:** HEAD `340df30` pusheado · backup `structured` < 12 h en exit 0 · imágenes
`679b036` presentes para rollback · **build de imágenes verificado** (gate propio, ver §J).

**Mutaciones autorizadas:** construir y etiquetar imágenes; recrear `chibalete_api_1` y
`chibalete_api_2`. **NO recrear `chibalete_front` ni `chibalete_edge` si sus imágenes no cambian** —
pero el release **sí toca el frontend** (`Experiencias.tsx`, `ExperienceStudio.tsx`,
`ProduccionesTab.tsx`, `App.tsx`, `Navbar.tsx`, `Biblioteca.tsx`, `AulaViva.tsx`,
`SubirContenido.tsx`, `dataService.ts`, `routePermissions.ts`, `types`), de modo que **front sí debe
reconstruirse**. `edge` **no**.

**Orden exacto:**
1. `git archive 340df30` → build `chibalete/api:340df30` en el VPS.
2. Build `chibalete/front:mook-340df30`.
3. **API rolling, una réplica por vez:** recrear `api_1` → health `healthy` + smoke → recrear `api_2`.
4. Recrear `front`.
5. `nginx -s reload` en `edge` (sin recrear).

**Health checks:** `docker inspect` health de las 4 · restarts sin incremento · `/api/health` 200.

**Smoke (sin datos MOOK):** `GET /api/experiences` → `[]` 200 · `/api/content` 200 con sesión y 401
sin ella · lector → `/admin/list` 403 · mediador → `/review/queue` 403 · un visor y un libro
existentes abren · Android LU: login y apertura de libro sin regresión.

**Stop conditions:** cualquier health distinto de `healthy`, restart inesperado, 5xx en `/api/health`
o `/api/content`, regresión en visores o LU. **Rollback:** override a `679b036` / `lib01-679b036` y
up escalonado.

**Evidencia:** digests de imagen, `docker ps`, salidas de health y smoke, timestamps.
**Autorización humana:** explícita antes de recrear `api_1`.

### 04D · `CONTENT-LOAD-AND-DRAFT`

**Precondiciones:** 04C GREEN · backup reciente · **corregido el `imageUrl` de Kafka**.

**Mutaciones autorizadas:** `POST /api/upload` (41 activos), `POST /api/content` (41 registros),
`POST /api/experiences` + `/:id/versions`. **Prohibido publicar.**

**Orden:** (1) smoke admin sin datos MOOK · (2) cargar los 16 MP3 y verificar dedup por hash ·
(3) cargar los 15 textos y transiciones · (4) crear los 10 extractos **con
`parentId: content-1774362922886`**, verificando que cada cuerpo es subcadena literal del TXT
productivo · (5) crear la experiencia **DRAFT** · (6) ensamblar los 7 movimientos y 56 nodos en una
sola llamada de versión · (7) **preview productivo sin mutaciones** · (8) verificación editorial y
de privacidad.

**Verificaciones:** 56 nodos · 16/25/15 · 15/15 privadas · 0 PRODUCTION · A04 ausente ·
`currentVersionId` **null** · `GET /api/experiences` con una cuenta de participante → **la
experiencia NO aparece**.

**Stop conditions:** cualquier conteo distinto, `CONFLICT` de hash, extracto que no sea subcadena
literal, o la experiencia visible para un participante. **Rollback:** dejar en DRAFT; conservar
activos.

### 04E · `PRODUCTION-CANARY`

⚠️ **BLOQUEADA por §I.** Un canario por grupo **no es implementable** con el código actual. La única
verificación productiva posible sin liberar es la **opción D**: cuenta QA temporal validando el
DRAFT vía Studio y preview. **Requiere autorización explícita del operador** y retirar la credencial
al terminar.

### 04F · `PUBLICATION-AND-CLOSURE`

⚠️ **NO AUTORIZADA.** Depende de la decisión de audiencia de §I. Cuando se autorice:
publicar **una sola vez** · verificar `currentVersionId` · E2E con participante real · confirmar
0 en Producciones y 403 de mediador · capturar evidencia · cerrar.
**Rollback:** `POST /api/experiences/:id/archive` (no destructivo).

---

## M. OBSERVACIONES O-1…O-5

| # | Observación | ¿Bloquea código? | ¿Carga? | ¿Canario? | ¿Liberación general? |
|---|---|---|---|---|---|
| **O-1** | Tiempo de lectura del Movimiento 1 | No | No | No | **No** — el operador la declaró no bloqueante y las 3 634 palabras son deliberadas |
| **O-2** | Movimiento 4 como recorrido de varias sesiones | No | No | No | **No** — mismo criterio |
| **O-3** | Enlace directo para releer B00 | No | No | No | **No** — la relectura ya funciona por navegación y T08 la indica |
| **O-4** | Metadata MP3 en navegador automatizado | No | No | No | **No** — límite del entorno de QA, no del activo |
| **O-5** | `404`/`409` revela existencia sin contenido | No | No | No | **No** — residual conocido; jamás expone contenido |

**Ninguna bloquea. Confirmado, no asumido.** O-1 y O-2 son de copy/UX y podrían atenderse en
cualquier versión posterior sin afectar los activos.

---

## N. BLOQUEADORES, DECISIONES Y SIGUIENTE UNIDAD

### Bloqueadores

| # | Bloqueador | Efecto |
|---|---|---|
| **B-1** | **`YELLOW-AUDIENCE-DECISION`** — publicar = liberación general, sin gate | **04F bloqueada.** 04E solo viable en variante «cuenta QA» |
| **B-2** | Build de imágenes no verificado (Docker local caído) | **Precondición con gate propio de 04C** |
| **B-3** | `imageUrl` de la experiencia local apunta a una portada de **Kafka** | Corregir **antes** de 04D |

### Decisiones humanas pendientes

1. **Audiencia:** ¿DRAFT indefinido, cuenta QA productiva, o aceptar liberación general?
2. **Portada:** qué imagen usa «¿Estás aquí?» en producción.
3. ¿Se autoriza crear y luego retirar una **cuenta QA productiva** para 04E?

### Riesgo heredado que conviene registrar

`ACCESS_FALLBACK_MODE=open` con **20/20 grupos sin `availableContentIds`** significa que hoy
**todo el catálogo productivo es accesible a cualquier cuenta autenticada**. No lo introduce el
MOOK y no se toca aquí, pero es la razón de fondo por la que no existe gate de audiencia. Merece
unidad propia.

### Siguiente unidad exacta

**`CHP-MOOK-ESTAS-AQUI-04C-CODE-DEPLOY`**, y solo después de que el operador:
(a) resuelva la decisión de audiencia de §I —que no bloquea 04C pero sí define el destino final—, y
(b) verifique el build de imágenes como precondición.

**Este preflight no ejecuta 04C ni modifica producción.**

---

## TRAZA

| Fecha | Operador | Acción |
|---|---|---|
| 2026-08-25 | Nicolás Jiménez | Preflight 04B completo: convergencia Git, inspección read-only de producción, smoke en sandbox aislado, manifest por hash contra 3 163 archivos productivos, auditoría de audiencia y backup. **Cero mutaciones productivas.** Veredicto `YELLOW-OPERATOR-DECISION` / `YELLOW-AUDIENCE-DECISION`. |
