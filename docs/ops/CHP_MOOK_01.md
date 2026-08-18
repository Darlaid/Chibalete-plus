# CHP-MOOK-01 — Vertical slice del piloto "Me desconecto, luego existo"

Fecha: 2026-08-18 · Implementación y validación LOCAL del contrato GREEN-MOOK-CONTRACT. **Sin deploy a producción** (el release será una unidad separada).

---

## A. Veredicto

**GREEN-MOOK-01** — los 16 criterios del gate se cumplen en local: piloto de 5 nodos implementado, Experience/Version/Run operativos, versionado demostrado, contenido canónico referenciado sin duplicación, access engine intacto como autoridad, Leo reutilizado, actividad y producción funcionales con evidencia, revisión humana mínima operativa, progreso derivado, eventos exclusivamente por la cadena canónica, identidad solo de sesión, tests A–M GREEN, fronteras M1-A/M1-B respetadas, cero deploy.

## B. Preflight

Repo limpio en `chp/mook-contract-00` (`fbf4c06`); contratos GREEN releídos; capacidades reutilizadas confirmadas (catálogo canónico, visores vía `/contenido/:id`, preflight de acceso, pipeline Leo + `leo_interactions_db`, `eventRegistry` + `recordCanonicalEvent`, roles existentes, admin-secret, patrón candado de Biblioteca). Sin implementación equivalente previa (los "Experiencias"/bundles de Fase 7 son otra cosa — ver §K).

## C. Dominio y versionado

`server/lib/experienceStore.js` — dominio **puro** (test estructural prohíbe `readJSON/fs./access_db/x-user-id` en su código): las 4 entidades congeladas, **nodos EMBEBIDOS** en la versión (sin tabla propia), validación por tipo de nodo (READING/VIDEO/AUDIO exigen `resourceRef` existente en el catálogo; LEO exige objetivo + `minIntercambios`; ACTIVITY exige preguntas; PRODUCTION exige consigna + límites de palabras). **Versionado demostrado por test A**: publish congela nodos (draft-only edits, `VERSION_IMMUTABLE`), publicar V2 no muta V1 ni mueve runs existentes; `startRun` fija `experienceVersionId` y es idempotente por (usuario, experiencia).

## D. Runtime y ruta

Secuencia ordenada: nodo disponible cuando los requeridos anteriores están completados (`NODE_LOCKED` si no); progreso = requeridos completados/requeridos (derivado, test D); `completed` derivado al cerrar el 4º requerido (test M — el cierre opcional no bloquea). Rutas HTTP aditivas en `server.js` (bloque `CHP-MOOK-01`): admin (`requireAdminAccess`): crear experiencia/draft, editar draft, publicar; usuario (`requireUserAuth`): listar publicadas, iniciar/continuar run (vista de ruta + resumen de evidencias propias), completar nodo, enviar evidencia; revisión: cola + registrar revisión (rol mediador/administrador existente vía `isMediatorRole`).

## E. Contenido y acceso

READING referencia `contentId` canónico; la vista proyecta metadata en el join y el store MOOK **no persiste ni un título** (test B: catálogo byte-idéntico, store sin metadata). Abrir el recurso navega al detalle/visor existentes → **el preflight canónico sigue siendo la única autoridad**; si el catálogo no expone el libro, la card muestra el candado (patrón Biblioteca) y MOOK jamás lo abre. La vista no emite ningún campo de autorización (test C).

## F. Leo y actividad

LEO = nodo que reutiliza el pipeline existente: la UI muestra la semilla y envía al lector (donde vive Leo); la **completitud se valida SERVER-SIDE contando `leo_interactions_db`** (usuario + contentId del nodo + timestamp ≥ inicio del run) — el cliente no puede fabricar intercambios; `<min` → `LEO_MIN_INTERCHANGES` 409 (test F). La evidencia Leo se **referencia por id** en `nodeStates.evidenceIds`, jamás se copia (test F: `doc.evidence` queda vacío tras la conversación). ACTIVITY: exactamente las 3 preguntas del piloto, respuestas obligatorias y conservadas (test G), sin form builder.

## G. Producción y evidencia

PRODUCTION valida 150–300 palabras (409 fuera de rango) y crea `ExperienceEvidence` vinculada a usuario+versión+nodo con `review.status=SUBMITTED` y `requiresReview=true` (test H). El texto vive SOLO en la evidencia — **jamás viaja en telemetría**. `REVISION_REQUESTED` no implementado (fuera del MVP por contrato).

## H. Revisión humana

`SUBMITTED → REVIEWED` con `decision: aprobado|con_comentarios` + feedback, reviewer de sesión, no re-revisable (test I). El revisor ve consigna + criterio + objetivos + texto. **Frontera documentada:** la cola lista todas las producciones pendientes (roles mediador/admin); el scoping institucional estricto = M1-B — sin bypass ni workaround, piloto pensado para el grupo controlado.

## I. Eventos canónicos

6 entradas nuevas en el **`eventRegistry` canónico** (categoría `experience`, peso pedagógico 2–3, retención warm/cold, payloads mínimos sin PII — test J valida los 6 y rechaza payloads incompletos). Emisión server-side por `server/experienceBackboneEmitter.mjs` — espejo exacto del patrón `leoBackboneEmitter` (NUNCA throw, fire-and-forget, `mode='experience'`, `recordCanonicalEvent` → events.db): **flag `EXPERIENCE_EVENTS_BACKBONE_ENABLED` OFF por default** (dormant, disciplina del proyecto). `node_started` se emite para el nodo que pasa a "current" (server-derivado). Cero pipeline/endpoint/transport nuevo.

## J. UI y tests

`pages/Experiencias.tsx` (una sola página): descubrimiento → landing/ruta con progreso y 5 estados de nodo → interacción por tipo (Abrir recurso / validar Leo / responder / producir con contador de palabras) → estado de revisión visible para el estudiante; pestaña **Revisión** solo para mediadores/admin (cola + decisión + feedback). Ruta `/experiencias` + permiso `authenticated` + entrada en Navbar. Seed del piloto: `scripts/mook/seedPilotExperience.mjs` (dry-run/apply, idempotente por slug, `--book` para dev cuyo catálogo no tiene el libro productivo — **el guard de integridad rechazó correctamente el contentId productivo ausente en dev**, validación en condiciones reales). Tests: **15 escenarios (casos A–M completos + 2 extra)** en `test:mook`, cableado a `test:identity-preflight` (CI). Verificaciones: guards estructurales GREEN (browserNoXUserId 128 archivos, eventsRoutes, drop guard), cadena `test:metric-contract` completa GREEN (los consumidores del registry no se rompieron), typecheck 0 errores nuevos (14 = baseline), `vite build` GREEN.

## K. Límites y próximo paso

- **Colisión de nombre en UI (conocida, del ADR):** el nav admin ya tiene `/admin/experiencias` (bundles Fase 7). Conviven sin ambigüedad técnica; la decisión de renombrar la superficie admin queda para producto.
- Garantía anti-spoofing dura de atribución = M1-A enforce (funcional hoy con cookie); cola de revisión institucional = M1-B; producción audio/archivo = decisión de almacenamiento/moderación.
- Piloto NO sembrado en producción; emisor de eventos dormant por flag; sin QA visual con sesión real en esta unidad (cubierto por tests + reutilización de superficies ya productivas).
- **Bloqueo real para publicar: ninguno técnico** — `CHP-MOOK-01-RELEASE` (unidad separada, NO iniciada) sería: imagen por SHA + rolling (mecanismo ensayado), seed productivo del piloto (dry-run + apply con el contentId real, que SÍ existe en prod), decisión del flag del emisor, smoke con el grupo piloto y su mediador.
