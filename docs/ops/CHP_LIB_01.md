# CHP-LIB-01 — Modelo + lecturas + capa EDITORIAL

Fecha: 2026-08-18 · Implementación LOCAL sobre el contrato GREEN (`docs/adr/CHP_ADR_BIBLIOTECA.md`, `docs/product/CHP_LIB_UX_00.md`, `docs/ops/CHP_LIB_MIG_00.md`).
Sin deploy a producción en esta unidad (la unidad no lo exige; el mecanismo de deploy existente queda disponible para una unidad de release).

---

## A. Veredicto

**GREEN-LIB-01** — los 12 criterios del gate se cumplen en local: modelo mínimo implementado, capa Editorial operativa (lecturas + administración canónica), UI funcional, no-duplicación y no-autorización demostradas por test, migración editorial aplicada e idempotente, escrituras INSTITUTIONAL/PERSONAL inexistentes, producción intacta (no hubo deploy).

## B. Modelo implementado

`server/lib/libraryStore.js` — dominio **puro** (sin I/O; test §8-E verifica estructuralmente que el código no contiene `readJSON/writeJSON/fs./access_db`): exactamente las 2 entidades del ADR. `LibraryReference {id, bookId, layer, contextId, collectionId?, position, createdAt, updatedAt}` con unicidad `(layer, contextId, collectionId, bookId)` (re-añadir = no-op idempotente) e integridad `bookId ∈ catálogo canónico` y `collectionId ∈ colecciones`. `LibraryCollection {id, layer, contextId, name, description, published(false), position, timestamps}`. Sin `state` por referencia, sin `addedBy`, sin metadata de presentación por referencia, sin ACL/entitlement propio (todo rechazado por el ADR). Persistencia: `data/library_db.json` vía los helpers canónicos (`readJSON`/`writeJSON`/`withFileLock`, patrón espejo de `mutateBundles`).

## C. Capa Editorial

Rutas nuevas en `server.js` (bloque `CHP-LIB-01`, aditivo):

- `GET /api/library/editorial` — lectura (misma política pública de metadata que `GET /api/content`).
- `POST /api/library/editorial/collections` · `PUT …/collections/:id` (name/description/**published**/position) · `POST …/references` (bookId, collectionId?, position) · `PUT …/references/:id` (ordenar) · `DELETE …/references/:id` — todas con **`requireAdminAccess`** (mecanismo administrativo canónico existente; cero sistema admin nuevo, cero CMS).

Escrituras `INSTITUTIONAL`/`PERSONAL`: **no existen rutas** (STOP boundary del §10; bloqueadas por M1-A enforce + M1-B — sin workarounds ni placeholders de escritura).

## D. Lecturas

`computeEditorialView(doc, contentList)` aplica los componentes de la fórmula propios de la capa: `reference` (solo lo referenciado aparece), `publication_state` (libros `status ≠ disponible` = referencias dormidas invisibles — Caso G; colecciones `published=false` ocultas salvo vista admin). `entitlement` **no se calcula en la vista** — deliberado: la vista no emite ningún campo de autorización (test §8-B lo prohíbe) y el candado/apertura los decide el preflight canónico. `membership` no aplica a EDITORIAL (no se inventó membership artificial). La metadata del libro se **proyecta en el join** desde `content.json` — nunca se copia a disco.

## E. Autorización

La autoridad sigue siendo el access engine E6/E7, intacto: el diff no toca `/api/content/:id/access` ni `access_db.json`; el dominio de Biblioteca no los conoce (test estructural §8-E). En UI, el candado por card usa el **hook existente `useAccessCheck`** (mismo preflight del visor) y abrir contenido sigue pasando por `AccessWrapper`/preflight — Caso E del ADR se sostiene sin código nuevo de autorización.

## F. No duplicación (gate §7 — test obligatorio)

Demostrado en `libraryStore.test.mjs`: añadir referencia no muta el catálogo (comparación byte a byte del catálogo congelado), la referencia solo contiene punteros (assert sobre el set EXACTO de claves, sin titulo/portada/url), apunta al mismo `bookId`, eliminarla no elimina el contenido, y re-añadir no duplica (unicidad). Mismo libro en 3 contextos = 3 referencias, 1 entidad (Caso D).

## G. Migración

`scripts/library/migrateEditorialBundles.mjs` (dry-run por defecto; `--apply` aborta si hay huérfanos/conflictos → YELLOW-LIB-MIGRATION automático; no muta bundles ni content; rollback = borrar `library_db.json`). Ejecutado sobre los datos locales de dev:

- **Dry-run limpio**: 3 bundles detectados → 3 colecciones (publicadas — hoy están expuestas) + 7 referencias propuestas, 0 huérfanos, 0 conflictos, 0 duplicados.
- **Apply local**: `data/library_db.json` creado (3 colecciones / 7 referencias).
- **Idempotencia verificada en vivo**: re-ejecución → 0 creadas, 7 deduplicadas.
- Los registros `isCollection:true` de `content.json` NO se migraron ni tocaron (decisión del ADR).
- La aplicación en producción queda lista para la futura unidad de release (mismo script, `--data-dir` productivo, tras dry-run allí).

## H. Tests

`server/__test__/libraryStore.test.mjs` — **17 escenarios GREEN**: capas congeladas, constraints (layer/book/collection inválidos), unicidad e idempotencia, Caso D, gate §7 completo, gates §8 A–E (visibilidad, cero campos de autorización, unpublished oculto con vista admin, no-referenciado ausente, estructural anti-access-engine), proyección/orden de vista, referencia huérfana tolerada, normalización, y mapping de migración (incl. huérfanos reportados e idempotencia). Cableado al pipeline: script `test:library` añadido a `test:identity-preflight` (el CI existente lo ejecuta; sin framework nuevo). Además: `node --check server.js` OK, typecheck 14 errores = exactamente el baseline preexistente (0 nuevos), `vite build` GREEN.

## I. Producción/deploy

Sin deploy. Producción permanece en `chibalete/api:8ed4e5e` COMPAT/COMPAT, intacta. Cualquier release futuro usa el mecanismo existente (imagen inmutable por SHA + override + rolling, ya ensayado).

## J. Límites

- Candado por card = N preflights (12 libros hoy; trivial a esta escala — revisar solo si el catálogo crece en órdenes de magnitud).
- La administración editorial es API-first (x-admin-secret); no hay UI de gestión (por diseño: no CMS).
- La pestaña Editorial muestra proyección de metadata; búsqueda/filtros avanzados fuera de alcance.
- `INSTITUTIONAL`/`PERSONAL` sin lecturas ni escrituras (ni placeholders — YAGNI).

## K. Próximo paso

DETENER (mandato de la unidad). Listo para después:

- **LIB-02 (institucional)**: el modelo ya soporta `layer=INSTITUTIONAL` + `contextId=organizationId` (probado en tests); faltan SOLO rutas + authz por organización → **bloqueado por M1-A enforce** (identidad no falsificable; hoy compat, drain Android pendiente) **+ M1-B** (aislamiento tenant; construido, no desplegado).
- **LIB-03 (personal)**: modelo listo (`PERSONAL` + `userId`); rutas de escritura → **bloqueado por M1-A enforce** (el actor debe salir de la sesión firmada, no de headers).
- Migración institucional (school_configs → referencias): plan en CHP_LIB_MIG_00; ejecutable tras esos mismos gates.
- Release de LIB-01 a producción: unidad separada con el mecanismo de deploy existente (incluye migración editorial productiva con dry-run previo).
