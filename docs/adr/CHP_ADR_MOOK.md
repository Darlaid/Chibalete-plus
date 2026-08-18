# CHP-ADR-MOOK — Experiencias como rutas pedagógicas versionadas que articulan, no copian

Fecha: 2026-08-18 · Estado: **ACEPTADO (contrato congelado; runtime NO implementado)** · Unidad: CHP-ADR-MOOK + CHP-MOOK-PILOT-DESIGN-00
Incluye el contrato de integración (eventos/evidencia/autorización) — se prefirió 2 documentos sobre 3.

---

## 1. Definición (congelada)

Una **Experiencia (MOOK)** es *una ruta pedagógica versionada que articula contenidos, interacción, actividades, producción, evidencia y revisión alrededor de objetivos definidos*.

NO es: un libro, una copia de contenido, un LMS, una carpeta, una playlist lineal, un sistema de permisos, ni una segunda plataforma de analytics.

Columna vertebral mínima que el piloto debe demostrar de forma reconocible: **LEER → CONVERSAR → PRODUCIR → REVISAR** (sin exigir exactamente tres nodos).

**Desambiguación de nombre:** los "bundles/Experiencias" comerciales de Fase 7 son otra cosa (listas de contenido, ya absorbidas conceptualmente por las colecciones de Biblioteca; sin datos en producción). En dominio, esta entidad se llama `Experience`; el nombre de cara al usuario se decide en UX sin ambigüedad técnica.

## 2. Principio heredado de Biblioteca

**El contenido canónico se REFERENCIA, jamás se duplica.** Un nodo que usa un libro/video/podcast apunta a su `contentId` de `content.json` — sin copiar metadata, archivos ni portadas, sin crear entitlement y sin tocar publication state. Verificado contra el catálogo: los tipos canónicos ya incluyen `libro | podcast | video | guia | actividad | libro_album | …` → **no existe hueco de media para el MVP** (video y audio ya son contenido canónico con visores propios `VisorVideo`/`VisorAudio`). No se construye DAM/media-service.

## 3. Modelo de dominio mínimo (congelado)

Cuatro entidades — y una decisión de recorte clave: **los nodos NO son entidad independiente**; viven embebidos como lista ordenada dentro de la versión (no tienen ciclo de vida propio y quedan inmutables al publicar — una tabla de nodos sería sobreingeniería).

```
Experience        { id, slug, title, description, status: draft|published|archived,
                    currentVersionId, createdAt, updatedAt }

ExperienceVersion { id, experienceId, version (entero incremental),
                    status: draft|published|retired,
                    objectives: [string],           // objetivos pedagógicos
                    nodes: [ExperienceNode],        // lista ORDENADA embebida
                    publishedAt?, createdAt }

ExperienceNode    { id, type: READING|VIDEO|AUDIO|LEO|ACTIVITY|PRODUCTION,
                    title, required: bool,
                    resourceRef?: contentId,        // canónico, cuando aplica
                    config: objeto mínimo por tipo (ver §5) }

ExperienceRun     { id, userId, experienceId,
                    experienceVersionId,            // ← PIN inmutable (ver §4)
                    status: active|completed|abandoned,
                    currentNodeIndex,
                    nodeStates: { [nodeId]: { status: pending|completed,
                                              completedAt?, evidenceIds: [] } },
                    startedAt, completedAt? }

ExperienceEvidence{ id, runId, userId, experienceId, experienceVersionId, nodeId,
                    type: text (MVP) | audio | file (post-MVP),
                    payload: texto inline (MVP) | ref de almacenamiento (post-MVP),
                    submittedAt,
                    review: { status: SUBMITTED|REVIEWED,   // REVISION_REQUESTED definido, no implementado en MVP
                              reviewerId?, decision?: aprobado|con_comentarios,
                              feedback?, reviewedAt? } }
```

`ExperienceEvidence` existe SOLO para **envíos del usuario** (ACTIVITY/PRODUCTION). La evidencia de interacción con Leo **ya tiene representación canónica** (`leo_evidence_db.json`: pedagogicalObjective, pedagogicalStage, evidenceType, previews — gestionada por `leoEvidenceService`) y se **referencia por id** desde `nodeStates.evidenceIds`, jamás se copia ni se re-modela.

## 4. Versionado — invariante clave (congelado)

`DRAFT → publish` congela `objectives + nodes` (inmutables byte a byte); **toda edición posterior crea `version+1` en DRAFT**. `currentVersionId` apunta a la última publicada; los runs fijan `experienceVersionId` al iniciarse y **nunca cambian de versión** (Caso B: publicar una versión nueva no altera retrospectivamente rutas en curso ni completadas). Republicar contenido viejo = nueva versión copiada. Sin branching/merge/version-control sofisticado: versionado editorial simple.

## 5. Tipos de nodo MVP

| Tipo | Propósito | Ref/config mínima | Completitud | Evidencia | Eventos |
|---|---|---|---|---|---|
| READING | encuentro con el texto | `resourceRef=contentId` (+ `fragmento?` descriptivo) | el usuario marca "completado" tras abrir el visor (explícita — NO se deriva del % del libro, ver §8) | ninguna | node_started/completed |
| VIDEO / AUDIO | encuentro audiovisual | `resourceRef=contentId` (tipo video/podcast) | marca explícita | ninguna | ídem |
| LEO | conversar/procesar | `objetivo` + `semilla` de conversación + `minIntercambios` (default 3) | ≥ minIntercambios | entradas de `leo_evidence` REFERENCIADAS | ídem |
| ACTIVITY | actividad breve | `instruccion` + `preguntas: [{texto, tipo: text_short}]` + `required` | responder todas | submission (ExperienceEvidence, sin revisión obligatoria) | ídem + evidence_submitted |
| PRODUCTION | producción significativa | `consigna` + `tipo: text` (MVP) + `criterioRevision` | enviar | submission → **revisión humana obligatoria** | ídem + evidence_submitted/reviewed |

Solo estos 6; ACTIVITY se limita a respuesta corta de texto (sin motor universal de formularios — un solo tipo de pregunta congelado para el MVP).

## 6. Rutas y transiciones (congelado)

**Secuencia ordenada** — sin motor de grafos, sin branching (ningún caso del piloto lo exige), sin DSL/BPM. Nodo inicial = índice 0; un nodo está disponible cuando todos los `required` anteriores están completados; los opcionales se pueden saltar. Finalización de la Experiencia = todos los `required` completados (derivada, Caso H). **Progreso = requeridos completados / requeridos** — derivado de `nodeStates`, nunca un porcentaje mutable independiente.

## 7. Leo dentro de la Experiencia (congelado)

Leo es **un tipo de nodo**, no un sistema paralelo. Contexto que recibe: título/objetivo de la Experiencia + objetivo y semilla del nodo + el `contentId` referenciado (reutilizando `leoContextBuilder` existente, que ya arma contexto por contenido y perfil). Leo conoce SOLO su nodo, no la ruta completa. Registro: interacciones y evidencia siguen el pipeline Leo existente (`leo_interactions`, `leo_evidence`); **no toda conversación es evaluación** — solo las entradas que el servicio de evidencia Leo ya clasifica (evidenceType) se referencian pedagógicamente (Caso E). Prohibido: guardar razonamientos internos del modelo; y Leo **jamás es autoridad de evaluación final** donde el flujo exige revisión humana (PRODUCTION siempre pasa por mediador).

## 8. Progreso vs progreso de lectura

El progreso de lectura del libro (progress engine existente) y la **completitud del nodo READING** son cosas distintas y no se duplican: el libro sigue registrando su progreso canónico como siempre (el visor no cambia); el nodo se completa por marca explícita del usuario dentro de la ruta. Nada del progress engine se copia ni se re-emite.

## 9. Evidencia y telemetría — frontera crítica (congelada)

**MOOK no crea una segunda cadena de telemetría.** Separación:

- **TELEMETRÍA** → nuevas entradas en el **`eventRegistry` canónico existente** (`server/analytics/eventRegistry.js`, zod + pedagogical_weight + privacy_level + retention_class): `experience_started`, `node_started`, `node_completed`, `experience_completed`, `evidence_submitted`, `evidence_reviewed` (payloads mínimos: experienceId, experienceVersionId, nodeId/type, runId). Emisión por el canal canónico ya vivo `/api/v1/events` (guard de sesión desplegado y probado cookie-only end-to-end) usando el transporte durable existente (`utils/eventTransport.mjs`). Cero pipeline paralelo, cero contadores propios.
- **EVIDENCIA PEDAGÓGICA** → `ExperienceEvidence` (envíos) + referencias a `leo_evidence` (interacción). La revisión (decisión+feedback) vive DENTRO de la evidencia, no en telemetría.

Clasificación: definir las entradas del registry = **CONTRACT-READY** (este ADR); cablear la emisión = **IMPLEMENTATION-READY** (canal e infraestructura ya productivos); la materialización a insights (mat_*) pertenece a la cadena STATS y sigue su propio plan (no bloquea el piloto).

## 10. Revisión humana (congelado, mínimo)

`SUBMITTED → REVIEWED` (con `decision: aprobado|con_comentarios` + `feedback` de texto libre). `REVISION_REQUESTED` queda **definido en el contrato pero fuera del MVP** (se activa solo si el piloto demuestra la necesidad). Revisor: **mediador** (rol canónico existente) de los grupos del estudiante, o administrador — sin roles nuevos. Ve: consigna + contexto del nodo + la producción + objetivos de la Experiencia. Sin rúbricas universales, sin gradebook, sin aprobación multinivel. El scoping institucional de la cola de revisión (que un mediador vea SOLO su institución) = **IMPLEMENTATION-BLOCKED por M1-B**.

## 11. Autorización (congelada)

MOOK **no concede acceso** a nada:

```
node_visibility = experience_reference ∩ experience_publication
                ∩ resource_entitlement ∩ membership/role ∩ resource_publication_state
```

Cada recurso conserva su autoridad canónica: abrir el libro/video del nodo pasa por el preflight `/api/content/:id/access` y los visores existentes (Caso D: sin entitlement → nodo en estado candado, mismo patrón validado en Biblioteca; MOOK nunca lo abre). Sin ACL nueva, sin roles nuevos. La atribución **anti-spoofing** de runs/evidencia exige identidad de sesión no falsificable → los navegadores ya son cookie-only en producción (funcional HOY en compat), pero la **garantía dura** llega con M1-A enforce.

## 12. UX mínima (congelada — detalles en CHP_MOOK_PILOT_DESIGN_00)

Descubrimiento: entrada propia "Experiencias" listando publicadas (la integración como referencias dentro de Biblioteca queda para después — exigiría targets de referencia más allá de bookId y no la necesita el piloto). Landing: título, propósito, descripción, progreso, CTA comenzar/continuar. Ruta: lista vertical de nodos con estados completado/actual/bloqueado/opcional. Nodo: **reutiliza los visores y la UI de Leo existentes** (nada se reconstruye). Producción: textarea + enviar + estado del envío. Revisión: lista de envíos pendientes del mediador + detalle + decisión/feedback. Sin LMS.

## 13. Casos obligatorios (validados contra el contrato)

A: run fija `experienceVersionId` ✓ · B: nueva publicación = versión nueva; runs en curso intactos ✓ · C: READING referencia contentId, cero duplicación ✓ · D: sin entitlement → candado; MOOK no concede ✓ · E: conversación Leo → completitud por intercambios + evidencia solo la clasificada; no toda conversación evalúa ✓ · F: producción → ExperienceEvidence{userId, experienceVersionId, nodeId} ✓ · G: revisión → decision+feedback trazables en la evidencia ✓ · H: completed derivado de requeridos de la versión fijada ✓.

## 14. Dependencias

| Pieza | Clase |
|---|---|
| Definición, dominio, versionado, nodos, transiciones, progreso, Leo-como-nodo, actividades(text), producción(text), evidencia/telemetría, revisión 2-estados, autorización, UX, piloto | **CONTRACT-READY** |
| Entidades como stores JSON (convención vigente), endpoints editoriales con admin-secret canónico, runtime de ruta + runs + submissions de texto + eventos al registry/canal canónico, UI de piloto reutilizando visores/Leo | **IMPLEMENTATION-READY** (infraestructura actual GREEN) |
| Garantía anti-spoofing de atribución de runs/evidencia | **IMPLEMENTATION-BLOCKED → M1-A enforce** (funcional hoy con cookie; garantía dura pendiente) |
| Scoping institucional de la cola de revisión y cualquier superficie institucional | **IMPLEMENTATION-BLOCKED → M1-B** |
| PRODUCTION tipo audio/archivo | **IMPLEMENTATION-BLOCKED → decisión de almacenamiento/moderación de UGC** (hueco documentado; no se construye media-service aquí) |
| Materialización a insights | cadena STATS (plan propio; no bloquea el piloto) |

## 15. Qué NO es esta decisión

No implementa runtime, no crea tablas productivas, no migra, no toca auth/entitlements/Biblioteca productiva, no crea pipeline de analytics/LMS/workflow-engine/motor de grafos/rúbricas/CMS/microservicio, no abstrae casos hipotéticos.
