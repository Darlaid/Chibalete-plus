# CHP-MOOK-V4-REALIGN-01 — Realineamiento de producto V4

Fecha: 2026-08-18 · Realinea GREEN-MOOK-01 con CHP-ROADMAP-2026-04. **Sin deploy.** Backbone técnico conservado; solo se corrigieron las diferencias con el producto V4. Decisiones superseded registradas en `docs/adr/CHP_ADR_MOOK.md §16`.

---

## A. Veredicto

**GREEN-MOOK-V4-REALIGN** — los 13 criterios cumplidos: backbone preservado (los 15 tests de MOOK-01 pasan sin cambios), el piloto dejó de ser dependencia estructural (runtime probado con segunda fixture sintética + guard estructural anti-hardcodes), módulos embebidos operativos, Biblioteca es la entrada, Studio queda definido dentro de Subir sin backend paralelo, contenido no-standalone modelado, no-duplicación intacta, Review reutilizable, eventos canónicos (con `moduleId` opcional compatible), 11 tests V4 nuevos GREEN, cero deploy.

## B. Cambios estructurales

1. **Módulos** (`experienceStore.js`): `ExperienceVersion.modules[] → nodes[]` embebidos (id/title/description?; unicidad de ids global); secuencia global = `versionNodes()` (módulos en orden); `moduleState()` **derivado** (COMPLETED/IN_PROGRESS/NOT_STARTED, jamás persistido); publish congela módulos+nodos; compat trivial: `normalizeMookStore` envuelve el shape plano pre-V4 en un módulo único (datos solo de dev, sin maquinaria de migración); `createDraftVersion/updateDraftVersion` aceptan `modules` o `nodes` (wrap). `computeRouteView` devuelve `modules[]` con estado + lista plana de conveniencia.
2. **Runtime genérico**: cero literales del piloto en dominio/rutas (guard estructural en test A); fixture sintética 2 (otra experiencia, 2 módulos, tipos distintos) completa end-to-end.
3. **Navegación V4**: pestaña **Experiencias en Biblioteca** (destacada + otras, CTA "Iniciar ruta") → `/experiencias/:experienceId` (ruta técnica conservada, nueva, mismo componente con `useParams`); **entrada propia eliminada del navbar de usuario**; `/experiencias` queda como listado técnico + cola de revisión (acceso de mediadores; su ubicación definitiva la decide REVIEW-01). La ruta del runtime agrupa por módulos con chips de estado.
4. **Contenido no-standalone**: campo nuevo `standalone` (ausente ⇒ true; decisión documentada: no existía semántica equivalente — `hiddenContentIds` es per-colegio y `tipo` decide visor). Enforcement: vista editorial de Biblioteca (`libraryStore.computeEditorialView`) y catálogo de Biblioteca (filtro frontend) lo ocultan como obra independiente; los nodos MOOK lo referencian y proyectan con normalidad (tests E/F/G). Dimensión separada de publication/entitlement/membership — access engine intacto. Las superficies admin (Subir) siguen viendo todo. Checkbox en Subir → STUDIO-01 (contrato en ADR §16).
5. **Telemetría**: `moduleId` opcional en 3 schemas del registry + emisores lo propagan (server-derivado); compatible hacia atrás (test J). Sin eventos nuevos.
6. **Colisión legacy**: `/admin/experiencias` (bundles Fase 7) renombrada visualmente a **"Paquetes (legacy)"** en ambos navs admin; ruta y datos intactos.
7. **Seed piloto**: reorganizado en 2 módulos ("Leer y conversar" / "Pensar y producir") como fixture de dev; re-sembrado local verificado.

## C. Studio en Subir (definición, no implementación)

Congelado en ADR §16: operación "Crear/editar Experiencia" dentro de `Subir`, flujo completo hasta publicar versión, selector sobre el catálogo canónico (standalone y no-standalone), "Crear contenido" reutiliza Subir. **El backend YA existe** (rutas admin create/draft/update/publish) — `CHP-MOOK-STUDIO-01` consume, no re-crea.

## D. Review

Flujo técnico intacto (`SUBMITTED → REVIEWED`); la cola ahora expone `moduleTitle` (contexto completo Experience/Version/Module/Node/prompt/evidence/review para la futura superficie). Scoping institucional sigue en M1-B, sin workaround.

## E. Tests y validación

11 escenarios nuevos (`mookV4Realign.test.mjs`, casos A–J + compat) encadenados en `test:mook`; los 15 de MOOK-01 y los 17 de Biblioteca pasan sin modificar; guard browserNoXUserId (128 archivos), sintaxis server, typecheck 14=baseline exacto, `vite build` GREEN.

## F. Incidente de proceso (registrado)

Una edición masiva vía PowerShell `Get-Content/Set-Content` corrompió el UTF-8 de `experienceStore.js` (mojibake) — trampa ya conocida y reincidente; se restauró desde git y se re-aplicó todo con la herramienta de edición segura. Regla reafirmada: jamás editar fuentes con roundtrips de PowerShell.

## G. Límites y próximo paso

Sin deploy; sin piloto real; Studio/Review UX pendientes. **Siguiente: `CHP-MOOK-PRODUCT-UX-01`** (cerrar visualmente Runtime, Studio-en-Subir y Review), luego RUNTIME-01/STUDIO-01/REVIEW-01/PILOT-01. No avanzar automáticamente.
