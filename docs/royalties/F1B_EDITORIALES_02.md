# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-B / EDITORIALES-02

## Administración editorial y atribución obligatoria de libros

**Fecha:** 2026-10-26 · **Rama:** `chp/epub-mainfile-r1-release` · **Base:** `84d7b30` · **Plan:** `PLAN_GENERAL_V1_1.md` (sin cambios)
**Alcance:** implementación local y CI. **Sin despliegue**, sin cambios productivos, sin tocar `data/`, `data-critical/`, uploads ni Studio Editor BI.

**Veredicto:** **GREEN_LOCAL+CI** para el alcance F1-B (§J). `security` en rojo por un CVE de la imagen base nginx, ajeno a F1-B (§J.2).

---

## A. Baseline

| Elemento | Estado |
|---|---|
| HEAD = origin | `84d7b30` (docs F3-A3 ECON-FOCUS-05 CI green), árbol limpio salvo carpetas no versionadas ajenas (`EPUB test/`, `ESTÁS AQUÍ…`, `Programa integral/`, `__pycache__`) |
| Producción (F1A_PROD_EVIDENCE §7) | 109 fichas, **todas** con `publisherId = pub-chibalete-editores` (43 libro —10 capítulos MOOK—, 9 libro_album, 23 articulo_pedagogico, 17 podcast, 10 guia, 5 video, 2 contexto_pedagogico); `royalties.db` con `0001`, `0002` |
| Copia local `data/content.json` | 61 fichas de desarrollo, ninguna con `publisherId` (no es el padrón productivo; **no se modificó**) |
| Vías de escritura del catálogo | Solo `POST /api/content` crea o reemplaza fichas (reemplazo completo). `POST /api/content/:id/epub-edition`, `/retry` y la auditoría de arranque modifican campos concretos con *spread* del registro (conservan `publisherId`). `DELETE /api/content/:id` borra. No hay importador masivo en el servidor; `SubirContenido.tsx` es el único cliente que guarda fichas |
| Comportamiento F1-A de `publisherId` | Ausente ⇒ se arrastra el guardado (dentro del lock); `null`/`''` ⇒ se quitaba; id ⇒ debe existir y, si cambia, estar activo. Ninguna exigencia por tipo y sin historial de cambios |

## B. Clasificación de contenidos sujetos a editorial obligatoria

**Libro** = `tipo ∈ {libro, libro_album}`, en cualquier formato (PDF, TXT/Modo Guiado, EPUB —texto o ilustrado—, álbum). Incluye capítulos (`parentId`) y colecciones de tipo libro.

| Categoría | ¿Libro? | Editorial |
|---|---|---|
| `libro` (PDF, TXT, EPUB), capítulos MOOK, colecciones `libro` | Sí | **Obligatoria** |
| `libro_album` | Sí | **Obligatoria** |
| `guia`, `actividad`, `articulo_pedagogico`, `contexto_pedagogico` (aunque lleguen en EPUB) | No — recurso pedagógico | Opcional (contrato F1-A) |
| `video`, `podcast` | No — recurso multimedia | Opcional (contrato F1-A) |
| `memoria_club` | No (publicación de comunidad, no pasa por el catálogo) | — |

- El EPUB no define el tipo: un EPUB de libro ya es `tipo: 'libro'` en los tres flujos del gestor; una guía en EPUB sigue siendo recurso (decisión tomada tras auditar los fixtures de `canonicalBookEpubIngestion`).
- La obligación es de **trazabilidad** y es más amplia que la liquidabilidad: `isEconomicContentType` (F2-A) excluye capítulos y MOOK; todo tipo liquidable es libro (probado).
- Un libro lo es si lo es la ficha nueva **o** la guardada: cambiar el tipo no sirve para retirar la editorial.
- En producción, 52 libros (43 + 9) y 57 recursos; los 109 ya tienen editorial.

## C. Interfaz administrativa

- **`/admin/editoriales`** (`pages/AdminEditoriales.tsx`): ruta con `ProtectedRoute` `admin`, comprobación de rol en la página y entrada «Editoriales» solo en el bloque de administración (escritorio y móvil).
- Reutiliza `/api/admin/publishers` (F1-A): alta (`POST`), edición (`PUT`), **activación/desactivación** por `status`. **Sin borrado** desde la interfaz.
- Campos: tipo de titular, razón social, nombre comercial, NIT, sellos, contacto (persona, correo, teléfono), notas. Sin datos bancarios.
- **Libros asociados** por editorial (`GET /api/admin/publishers?withCounts=1`, aditivo: sin el parámetro la respuesta es la de F1-A) y recursos adicionales.
- **Navegación al catálogo filtrado**: `/subir-contenido?editorial=<id>` abre «Gestión de Contenidos» filtrada, con chip «Quitar filtro»; `?editorial=__sin_editorial__` lista los libros por regularizar.
- Banner de cumplimiento con el censo del servidor (`GET /api/admin/publisher-audit`).
- Texto explícito: la editorial responsable no acredita por sí sola derechos económicos ni la condición de beneficiario.

## D. Validación del servidor y del formulario

**Servidor** (`server/royalties/publisherAssignment.mjs`, decisión pura, aplicada antes del lock como *fail-fast* y de nuevo **dentro** del lock contra el registro vigente):

| Caso | Resultado |
|---|---|
| Libro nuevo sin `publisherId`, con `null` o `''` | 400 `publisher_required` |
| Editorial inexistente / inactiva (si cambia) | 400 `unknown_publisher` / `inactive_publisher` (F1-A) |
| Edición sin la clave `publisherId` | se conserva la guardada (F1-A) |
| Quitar (`null`/`''`) la editorial de un libro, también cambiando el tipo | 400 `publisher_removal_forbidden` |
| Cambiar la editorial de una ficha que ya tiene una | 409 `publisher_reassign_unconfirmed` salvo `publisherReassignConfirmed: true` (booleano estricto; no se persiste) |
| Libro histórico sin editorial: asignarla | permitido sin confirmación (regularización) |
| Libro histórico sin editorial: editarlo sin asignarla | 400 `publisher_required`; la ficha queda intacta |
| `POST /api/content/:id/epub-edition` sobre un libro sin editorial | 400 `publisher_required` |
| Recursos no bibliográficos | contrato F1-A sin cambios (pueden no tener editorial o retirarla); el cambio entre editoriales también exige confirmación |

La validación no depende del formulario: se probó por HTTP directo.

**Formulario** (`pages/SubirContenido.tsx` + regla espejo `utils/publisherRequirement.mjs`):
- Etiqueta «Editorial responsable» (sin «(Opcional)») y `required` para libros; para libros la opción vacía es un marcador deshabilitado («Selecciona una editorial…»), sin «Sin editorial asignada». Los recursos conservan la opción.
- Bloqueo **antes** de subir archivos: libro sin editorial, retirada en edición o reasignación sin confirmar.
- Reasignación: casilla de confirmación expresa con editorial anterior y nueva; cambiar la selección anula la confirmación; la petición lleva `publisherReassignConfirmed: true`.
- **Falla al cargar la lista de editoriales**: no se envía `publisherId` (el servidor conserva la guardada al editar); un libro nuevo no puede publicarse y se muestra un aviso. Nunca se borra ni reemplaza una asociación existente.
- Los materiales hijos (guías, vídeos…) no cambian de contrato.

## E. Auditoría de cambios

- Nueva migración `server/royalties/migrations/0003_content_publisher_history.sql` en `royalties.db`: tabla `content_publisher_history` (`content_id`, `from_publisher_id`, `to_publisher_id`, `actor`, `changed_at`), **solo inserciones** (triggers), sin claves foráneas, sin filas sin cambio real. Justificación: el registro exigido (obra, actor, anterior, nueva, fecha) y la resolución de la editorial por periodo para F3-B/F4. Idempotente; viaja en el respaldo existente de `royalties.db` (sin cambios en `stores.py`).
- Cada cambio **efectivo** (alta con editorial, reasignación, retirada en recursos, regularización) inserta una fila **en la misma transacción SQLite que envuelve la escritura de `content.json`**: si el catálogo no se escribe, no queda fila (probado).
- Además, `user_audit` recibe `content_publisher_change` con `contentId`, `from`, `to`, `changedAt`, `historyId` y actor.
- Consulta: `GET /api/admin/publisher-audit/:contentId/history` (solo administración, `no-store`).
- Un titular con historial no se borra (`publisher_referenced`), aunque ya no esté en ninguna ficha.
- Las versiones de derechos no se tocan: siguen inmutables (triggers F2-A); una reasignación no crea ni altera versiones.
- `PUBLISHER_MISMATCH` se conserva: reasignar una obra con versión vigente de otra editorial la deja no elegible (probado). No hay traslado retroactivo: la versión y su matriz siguen a nombre de la editorial original.
- Sin cambios en contratos, alfa, elegibilidad, liquidación, 25 %, 30/70 ni tiempos.

## F. Compatibilidad con el catálogo existente

- **Sin migración ni reasignación automática.** Ningún script toca `content.json`.
- Producción: los 109 registros tienen editorial válida ⇒ 0 excepciones previstas. El censo `GET /api/admin/publisher-audit` lo confirmará tras el despliegue (`missing = []`, `unknown = []`, `booksWithPublisher = 52`).
- Si aparecieran excepciones: se listan (id, título, tipo) en el censo y en `/subir-contenido?editorial=__sin_editorial__`, se conservan sin pérdida (lectura, catálogo y acceso intactos) y **no** se inventa editorial.

**Procedimiento administrativo de regularización**
1. Administración abre `/admin/editoriales`; el banner indica cuántos libros hay por regularizar.
2. «Ver libros sin editorial» abre la gestión filtrada.
3. Para cada libro se identifica la editorial responsable **con soporte documental** (Convenio marco / Acta de incorporación). Si no existe soporte, el libro queda en la lista: no se asigna «por defecto».
4. Si la editorial no existe en el registro, se da de alta en `/admin/editoriales` (datos verificados; nunca inventados).
5. Se edita el libro y se selecciona la editorial. La asignación no exige confirmación (no hay anterior) y queda en el historial.
6. Una editorial `unknown` (id que ya no existe en el registro) se trata igual, como reasignación confirmada.
7. Mientras no se regularice, el libro sigue consultable y legible; solo su edición exige asignar editorial.

## G. Pruebas y CI

**Local (Windows, 2026-10-26):**

| Batería | Resultado |
|---|---|
| `npm run test:royalties` | rc 0 — publishersStore 32/32, publishersHttp 36/36, **publisherAssignment 62/62**, **publisherMandatoryHttp 62/62**, **AdminEditoriales.structural 21/21**, rightsStore 77/77, rightsHttp 50/50, commercialClass 58/58, commercialClassHttp 36/36 (+1 SKIP), econEvents 67/67, economicTick 120/120; `accessB2cPreservation` y `econIngestHttp` se omiten en Windows (POSIX) y corren en CI |
| `npm run test:content-rmw` (32 suites) | todas en verde tras alinear el piloto de `contentCreationDefaults` con producción (ya tiene editorial desde F1-A); p. ej. canonicalBookIngestion 70/70, canonicalBookEpubIngestion 90/90, contentGlobalReadOnlyPolicy 39/39, adminEpubAttach 43/43, adminEpubUpload 13/13, contentCreationDefaults 18/18 |
| `npm run typecheck:baseline` | sin regresiones (current == baseline) |
| `npm run build` | OK |
| `data-critical/royalties.db` real | no creada por ninguna suite |

**CI sobre `eb21fee`:** `content-rmw` ✅ (run 40336410665) · `identity-preflight` ✅ (run 40336410529: `test:royalties` en Linux, incluidas las suites POSIX, typecheck, `test:mook`, build) · `security` ❌ (run 40336410776) solo en `trivy-image (front)`; ver §J.2.

| Suite | Cubre |
|---|---|
| `server/royalties/__test__/publisherAssignment.test.mjs` (nueva) | clasificación libros/recursos; decisión pura (alta, null, '', edición parcial, retirada, cambio de tipo, reasignación con/sin confirmación, regularización, recursos); historial transaccional y append-only; editorial por periodo; censo; regla espejo del formulario |
| `server/royalties/__test__/publisherMandatoryHttp.test.mjs` (nueva) | servidor real con censo de producción (109) + 2 libros históricos: permisos 401/403, conteos, censo, alta válida/inválida/inexistente/inactiva, recursos sin regresión, edición parcial, reasignación + historial + `user_audit`, regularización, `epub-edition`, derechos inmutables y `PUBLISHER_MISMATCH`, protección de borrado, integridad 105/105 fichas no tocadas byte a byte, accesos/progreso/eventos intactos, lector sin datos del titular |
| `pages/__tests__/AdminEditoriales.structural.test.mjs` (nueva) | ruta/permiso/menú, sin borrado, campos, conteos, filtro, etiqueta obligatoria, sin «Sin editorial asignada» en libros, validación antes de subir, confirmación, lista no cargada |
| `publishersHttp`, `publishersStore`, `rightsStore` (actualizadas) | contrato F1-B (antes: libro sin editorial admitido «en transición») y migración 0003 |
| `content-rmw`: `adminEpubUpload`, `adminEpubAttach`, `canonicalBookIngestion`, `canonicalBookEpubIngestion`, `contentCreationDefaults`, `contentFingerprint`, `contentGlobalReadOnlyPolicy` (actualizadas) | guardan sus libros con `pub-chibalete-editores` en una `royalties.db` temporal (`ROYALTIES_DB`); sin otro cambio de aserciones |

## H. Brechas pendientes para atribución histórica y liquidaciones (F3-B / F4)

Medición transversal verificada:

| Capa | Fuente | Relación con obra | Relación con editorial |
|---|---|---|---|
| Lectura y utilización observada | `events.db` (`events`), progreso | `contentId` en cada evento/registro | vía ficha (vigente) + historial (por periodo) |
| Sesiones cualificadas | motor F3-A1 sobre `econ_events` (`econ_tick`) | `content_id NOT NULL` | idem |
| Sesiones económicamente elegibles | F3-A1 + `eligibilityFor` (F2-A) + clase comercial F2-B | idem | `PUBLISHER_MISMATCH` compara la ficha **vigente** con la versión |
| Atribución contractual | `rights_versions` (`publisher_id`, `shares`) vigente en el instante | idem | **la matriz**, nunca `content.publisherId` |

Brechas (documentadas, no resueltas en esta unidad):
1. **Sin historial antes de F1-B.** La asignación masiva de F1-A (2026-10-22T14:10:07Z) y cualquier cambio entre ese momento y el despliegue de F1-B no tienen fila en `content_publisher_history`. `publisherAt()` devuelve la editorial vigente cuando no hay filas, correcto solo si no hubo cambios en esa ventana. Propuesta para la unidad de despliegue: verificar en `user_audit`/logs que no hubo cambios y, si se autoriza, registrar una línea base administrativa explícita (no automática).
2. **`eligibilityFor` usa la ficha vigente.** Para un periodo pasado, F3-B/F4 deben comparar la versión con `publisherAt(history, …, t)` y no con `content.publisherId` actual; si no, una reasignación posterior alteraría retroactivamente `PUBLISHER_MISMATCH`.
3. **`econ_events` no fotografía la editorial ni la versión de derechos** en `econ.session_start`; la atribución debe resolverse a posteriori con historial + `rights_versions` (diseño F3-A2 vigente; decidir en F3-B si se fotografía).
4. **Libros sin editorial previos a su regularización:** sus lecturas existen pero no tienen editorial en el periodo; F3-B debe excluirlos de la atribución hasta la fecha de la fila de regularización (nunca retroactiva).
5. El historial registra el actor de la sesión; con `admin-secret` el actor es `admin-secret` (sin persona). Igual que F1-A.

## I. Commits publicados

| Commit | Contenido |
|---|---|
| `f43e231` | servidor: regla obligatoria, historial (migración 0003), rutas de censo/historial, `withCounts`, `epub-edition`, suites nuevas y actualizadas |
| `639ea4d` | front: `/admin/editoriales`, formulario obligatorio, filtro por editorial, registro de suites en `test:royalties` |
| `eb21fee` | este informe (pendiente de CI) y seguimiento |
| (siguiente) | cierre del informe con CI |

Rama `chp/epub-mainfile-r1-release`, publicada en `origin`. Sin despliegue.

## J. Veredicto

### J.1 GREEN_LOCAL+CI (alcance F1-B)

- Todo libro nuevo exige una editorial válida y activa; el servidor lo valida sin depender del formulario.
- Las asociaciones existentes se preservan: edición parcial conserva, retirada rechazada, reasignación solo confirmada; 105/105 fichas no tocadas idénticas byte a byte en el censo reproducido de producción.
- Sin regresiones de derechos (versiones inmutables, `PUBLISHER_MISMATCH` conservado, sin traslado retroactivo) ni del catálogo (recursos con contrato F1-A, accesos/progreso/eventos intactos, lector sin datos del titular).
- Gates funcionales de CI en verde: `content-rmw` e `identity-preflight`.

### J.2 `security` rojo, ajeno a F1-B

- `trivy-image (front)` falla por **CVE-2026-92392 (HIGH) en `curl`/`libcurl` 8.22.0-r0 → 8.23.0-r0** del Alpine 3.24 de la base `nginx:1.30-alpine@sha256:47928bf6…`.
- Reproducido en local con Trivy 0.69.3 y la misma configuración (`HIGH,CRITICAL`, `--ignore-unfixed`, `.trivyignore`): la **imagen base sola** ya lo contiene; el job estaba verde en `84d7b30` (2026-10-25T01:03Z) porque el fix aún no figuraba en la base de datos de Trivy. F1-B no toca Dockerfiles, dependencias ni lockfile.
- Bloquea cualquier despliegue del front, con o sin F1-B. Corrección propuesta para una unidad de seguridad aparte (mismo patrón que `brotli-libs` en SEC-ACCOUNT-01): `apk add --no-cache 'curl>=8.23.0-r0' 'libcurl>=8.23.0-r0'` en `Dockerfile.front` (y revisar `Dockerfile.api`). No aplicada aquí por el límite de alcance.
- Imágenes locales creadas para la verificación (sin limpiar, por la regla de no hacer limpiezas Docker): `chibalete/front:f1b-local`, `aquasec/trivy:0.69.3`.

### J.3 STOP

Implementación local y CI terminadas. **No se despliega** ni se hace ningún cambio productivo: sin editoriales reales en producción, sin ingesta económica, sin F3-B, sin tocar parámetros (25 %, 30/70, tiempos, elegibilidad) ni Studio Editor BI. Tras desplegar (unidad autorizada aparte) hay que verificar en producción `GET /api/admin/publisher-audit` → `missing = []`, `unknown = []`, `booksWithPublisher = 52`, y que la migración 0003 se aplicó una sola vez en ambas réplicas.
