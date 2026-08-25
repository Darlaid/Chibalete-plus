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

---

## 16. V4 REALIGN (2026-08-18 — CHP-MOOK-V4-REALIGN-01, vinculante por CHP-ROADMAP-2026-04)

Decisiones de este ADR **superseded** por producto V4 (el resto del ADR permanece vigente):

| Decisión anterior | Estado | Decisión V4 |
|---|---|---|
| §Piloto: "Me desconecto, luego existo" como contenido del primer MOOK | **SUPERSEDED** | El piloto queda SOLO como fixture/seed de dev y suite de tests. El runtime es genérico sobre `ExperienceVersion` (demostrado con segunda fixture sintética); el contenido del primer MOOK real se decidirá en `CHP-MOOK-PILOT-01`. |
| §3: nodos como lista plana en la versión | **SUPERSEDED** | `ExperienceVersion.modules[] → nodes[]` (módulos EMBEBIDOS con id/title/description?; sin tabla Module). La secuencia global = módulos en orden; la versión sigue inmutable al publicar; compat trivial: shape plano se envuelve en un módulo único al leer. Estado de módulo **DERIVADO** (COMPLETED/IN_PROGRESS/NOT_STARTED), jamás persistido. |
| §12 UX: entrada propia "Experiencias" | **SUPERSEDED** | La entrada de producto es **Biblioteca → pestaña Experiencias** (sin nueva isla en el nav principal). Se conserva la ruta técnica `/experiencias/:experienceId` para landing/runtime; `/experiencias` queda como listado técnico + cola de revisión. |
| (nuevo) Autoría | **DECIDIDO V4** | **MOOK Studio vive dentro de `Subir`** (Gestor de Contenido) — sin CMS MOOK independiente. Flujo: crear Experiencia → info → objetivos → módulos → nodos → seleccionar contenido canónico → configurar → ordenar → preview → DRAFT → publicar. Las rutas/dominio actuales (create/draft/update/publish con admin canónico) son el backend que `CHP-MOOK-STUDIO-01` consume — prohibido backend paralelo. El selector de contenido muestra standalone y no-standalone; "Crear contenido" reutiliza `Subir` (sin uploader en Studio). |
| (nuevo) Contenido no autónomo | **DECIDIDO V4** | Campo **`standalone: boolean`** en el contenido canónico (ausente ⇒ `true`, cero migración; no existía propiedad equivalente — `hiddenContentIds` es ocultamiento por colegio y `tipo` decide visor). `standalone:false` = pieza destinada a Experiencias que NO se descubre como obra independiente en Biblioteca (catálogo y vista editorial la ocultan) pero sigue siendo contenido canónico, referenciable por nodos, con su publication state y su entitlement intactos. La opción en `Subir` ("Contenido para una Experiencia") se implementa en STUDIO-01. |
| §9 telemetría | **EXTENDIDO** | `moduleId` OPCIONAL añadido a `node_started/node_completed/evidence_submitted` (mejora reconstrucción por módulo; compatible — payloads sin moduleId siguen validando). Sin eventos `module_*`. |
| (nuevo) Colisión `/admin/experiencias` | **DECIDIDO V4** | La superficie legacy de bundles se renombra visualmente a **"Paquetes (legacy)"** (ruta técnica intacta, sin migración ni borrado de datos; deprecación futura exigiría unidad explícita con evidencia de consumidores). |

Tres superficies de producto congeladas: **Runtime** (participante) · **Studio dentro de Subir** (autoría) · **Review/Mediación**. Las cierra visualmente `CHP-MOOK-PRODUCT-UX-01`; después `CHP-MOOK-RUNTIME-01`, `CHP-MOOK-STUDIO-01`, `CHP-MOOK-REVIEW-01`, `CHP-MOOK-PILOT-01`.

---

## 17. CLOSURE (2026-08-19 — CHP-MOOK-CONTRACT-00-CLOSURE, vinculante)

Cierre contractual auditado contra el código real de la rama (`16232a3`) y producción `679b036`. Este ADR es la **única fuente contractual**; `CHP_MOOK_PILOT_DESIGN_00` (fixture dev), `CHP_MOOK_PRODUCT_UX_01` (UX freeze) y los docs de unidad (`CHP_MOOK_01/V4_REALIGN/RUNTIME_01`) son subordinados y no lo contradicen (lo superseded está en §16). En interfaz el nombre es **Experiencias**; `MOOK`/`Experience` son vocabulario interno.

### 17.1 Estado real (auditado contra código)

| Elemento | Realidad | Clasificación |
|---|---|---|
| Dominio `server/lib/experienceStore.js` (4 entidades §3, módulos embebidos §16, publish congela, run fija versión, evidencia con review embebido) | implementado + 31 tests `test:mook` en CI | **PRESERVAR** |
| Rutas `/api/experiences*` (autoría/publicación `requireAdminAccess`; runtime `requireUserAuth` con actor solo-sesión; review guard mediador/admin; completitud LEO contada server-side) | implementado | **PRESERVAR** |
| Runtime participante (Biblioteca→pestaña Experiencias, landing sin crear run, NodeShell, reanudación, cierre) validado visualmente incl. mobile | implementado | **PRESERVAR** |
| Registry canónico +6 eventos `experience` + emisor `experienceBackboneEmitter` (flag `EXPERIENCE_EVENTS_BACKBONE_ENABLED` OFF = dormant) | implementado, sin activar | **PRESERVAR** (activación = unidad de release) |
| Campos `Experience.imageUrl/durationLabel/audience` + `myRun{status,progress}` + `experienceDetail` | implementado (únicos backend nuevos autorizados por UX-01) | **PRESERVAR** |
| Formulario actual de creación (superficie legacy de bundles) | existe como página admin | **ADAPTAR** → pestaña **Información general** del Studio (UX-01 §C4), mismo backend admin |
| Selector de contenidos actual | existe en la superficie legacy | **ADAPTAR** → **bandeja de recursos** del Studio (selector canónico, standalone-aware) |
| Bundles Fase 7 / página `/admin/experiencias` ("Paquetes (legacy)") | sin datos productivos, ruta intacta | **DEPRECAR** (eventual; exige unidad explícita con evidencia de consumidores; sin fecha) |
| Studio dentro de Subir | — | **NO EXISTE** → `CHP-MOOK-STUDIO-01` (handoff C1–C13 confirmado suficiente) |
| Review en Aula Viva ("Producciones"; hoy cola técnica en `/experiencias`) | — | **NO EXISTE** → `CHP-MOOK-REVIEW-01` |
| Asignación dirigida por grupo/audiencia | — | **NO EXISTE** → gate M1-B + modelo groups (MVP: inscripción abierta a autenticados, ver 17.2) |
| Estado `ARCHIVED` en runtime | — | **NO EXISTE** → se materializa en STUDIO-01 (contractual desde ya, 17.3) |

### 17.2 Alcance MVP (congelado) y no objetivos

Un docente/participante puede: **(1)** descubrir una experiencia publicada (Biblioteca→Experiencias) ✅ · **(2)** inscribirse iniciándola (el run ES la inscripción; asignación dirigida = gate) ✅ · **(3)** recorrer módulos en secuencia ✅ · **(4)** reanudar ✅ · **(5)** conversar con Leo ✅ · **(6)** realizar una actividad ✅ · **(7)** entregar una producción ✅ · **(8)** recibir revisión humana ✅ · **(9)** terminar por regla transparente (todos los requeridos; progreso = requeridos/requeridos) ✅.

**Fuera del MVP (congelado):** motor adaptativo · LMS genérico · SCORM/LTI · certificados · pagos · marketplace · colaboración en tiempo real · gamificación · rankings · cursos de idiomas · branching complejo · **MOOK offline en LU** (LU sigue limitado al libro asignado) · nueva plataforma de analytics. Sin calificación numérica, sin ranking, sin diagnóstico ni adaptación algorítmica opaca.

### 17.3 Lifecycle contractual (congelado)

Estados de versión: `DRAFT → IN_REVIEW → APPROVED → PUBLISHED → ARCHIVED`.

| Transición | Quién | Validaciones / efecto |
|---|---|---|
| DRAFT → IN_REVIEW | autor | ≥1 módulo, ≥1 nodo requerido, `resourceRef` resolubles, alternativa accesible declarada por nodo (17.5) |
| IN_REVIEW → DRAFT (rechazo) | revisor pedagógico/editorial o accesibilidad | vuelve con observaciones; nada se borra |
| IN_REVIEW → APPROVED | revisor(es) | checklist pedagógica + accesibilidad |
| APPROVED → PUBLISHED | administrador autorizado | congela `objectives+modules+nodes` byte a byte (código: `VERSION_IMMUTABLE`) |
| PUBLISHED → (edición) | autor | **jamás muta la publicada**: crea `version+1` en DRAFT (§4) |
| PUBLISHED → ARCHIVED | administrador | no descubrible ni iniciable; **runs activos terminan su recorrido** (pin §4); sin borrado |

**Colapso MVP explícito (no contradice código):** hoy autor = aprobador = administrador (admin-secret), por lo que el código implementa el camino colapsado `draft → published` permitido cuando autor y aprobador coinciden. `IN_REVIEW`/`APPROVED` se materializan cuando autor ≠ aprobador (STUDIO-01+). **Rollback:** republicar la versión anterior como `version+1` copiada (§4) y/o apagar el flag del emisor; los runs en curso quedan intactos por el pin. Una versión publicada **nunca cambia silenciosamente**.

### 17.4 Roles y permisos (matriz mínima — cero roles globales nuevos)

| Capacidad | Autor | Rev. pedagógico/editorial | Rev. accesibilidad | Facilitador | Participante | Admin |
|---|---|---|---|---|---|---|
| Crear/editar DRAFT | ✅ | — | — | — | — | ✅ |
| Enviar a revisión / aprobar | ✅ enviar | ✅ aprobar/rechazar | ✅ aprobar/rechazar | — | — | ✅ |
| Publicar / archivar | — | — | — | — | — | ✅ |
| Iniciar run / completar nodos / enviar evidencia | — | — | — | — | ✅ | ✅ (pruebas) |
| Revisar producciones (cola) | — | — | — | ✅ | — | ✅ |

Mapeo a lo existente: autor y ambos revisores = equipo editorial vía canal admin canónico (MVP; **mediador-autor sería decisión nueva**, resuelta como scope sobre la experiencia, no rol global); facilitador = **mediador** canónico de los grupos del participante; participante = usuario autenticado por sesión. Aislamiento institucional de la cola = gate M1-B (§10).

### 17.5 Contrato de nodos — cierre (complementa §5)

Por tipo: **alternativa accesible** y **datos que NO se conservan** (lo demás en §5):

| Tipo | Alternativa accesible | NO conservar |
|---|---|---|
| READING | modos de lectura existentes de los visores (Guiado/TTS/OpenDyslexic/alto contraste) | nada adicional a la marca de completitud |
| VIDEO/AUDIO | `config.transcripcionRef?`/texto alternativo (contractual, opcional en MVP; obligatorio para publicar el piloto) | telemetría fina de reproducción |
| LEO | la conversación ya es texto; navegable por teclado | **transcripciones completas en events.db**; razonamientos del modelo |
| ACTIVITY | text_short accesible por teclado; estados siempre con texto | borradores no enviados |
| PRODUCTION | ídem | versiones intermedias no enviadas |

Estados de UI siempre con texto (no solo color, UX-01). **`Leer → Conversar → Producir` es una plantilla de autoría del Studio, NO un séptimo tipo de nodo ni otro runtime.**

### 17.6 Leo — cierre (complementa §7)

**Propósito/rol:** mediador de conversación del nodo; jamás evaluador final, terapeuta ni docente autónomo. **Fuentes:** solo el contexto del nodo (título/objetivo de la experiencia + semilla + `contentId`, vía `leoContextBuilder`). **Pregunta inicial:** la `semilla` del nodo. **Límites:** conoce solo su nodo. **Prohibido:** calificar, diagnosticar, aconsejar clínicamente, pedir datos personales, guardar razonamiento interno. **Criterio de cierre transparente:** `≥ minIntercambios`, visible para el participante (ya se muestra en el NodeShell). **Evidencia mínima:** referencias a `leo_evidence` clasificada + conteo server-side. **Aviso de IA:** el nodo LEO debe mostrar un aviso visible de que se conversa con una IA — **pendiente en UI, requisito de PILOT-01**. **Escalamiento humano:** toda PRODUCTION pasa por mediador; el participante puede solicitar mediación humana por los canales de su grupo.

### 17.7 Integraciones e invariantes (congelados)

Referencias a Biblioteca **solo por contentId canónico** · acceso/licencias se verifican fuera del recurso (preflight `/api/content/:id/access`, §11) · progreso de lectura único (§8) · identidad y membership del sistema canónico (sesión; actor jamás del cliente) · eventos **solo** al registry + `/api/v1/events` — **ningún nuevo events.db** ni pipeline paralelo (§9) · revisión humana explícita (§10) · accesibilidad desde el modelo (17.5) · datos personales minimizados (payloads con ids, sin PII, sin transcripciones).

**Gates documentados (no se resuelven aquí):** anti-spoofing duro = **M1-A enforce** (bloqueado en field migration) · scoping institucional review = **M1-B** · producción audio/archivo = decisión almacenamiento/moderación UGC · insights = cadena STATS · asignación dirigida = M1-B + groups.

### 17.8 Piloto contractual (decidido en este cierre)

**Primer piloto = inducción docente, 3 módulos** (audiencia: mediadores/docentes; sustituye al "por decidir" de §16 — la fixture "Me desconecto, luego existo" permanece como seed/tests de dev):

1. **Bienvenida y fundamentos** — READING + VIDEO/AUDIO + ACTIVITY.
2. **Competencias, trayectorias y mediación con Leo** — READING + LEO + ACTIVITY.
3. **Seguimiento, evidencia y responsabilidad institucional** — READING o VIDEO + PRODUCTION (revisión humana).

Cada módulo combina lectura, medio audiovisual, conversación, actividad o producción; los contenidos completos se redactan en `CHP-MOOK-PILOT-01`, no aquí. Los recursos del piloto se crean como contenido canónico (marcados no-standalone si no son obra independiente).

### 17.9 Migración compatible (aditiva; cero big-bang, cero datos productivos en esta unidad)

| Elemento actual | Destino Experiencias | Tratamiento | Riesgo | Gate |
|---|---|---|---|---|
| Formulario de creación legacy | Información general (Studio, tab C4) | evolución sobre el mismo backend admin | bajo | STUDIO-01 |
| Selector de contenidos legacy | Bandeja de recursos (Studio) | evolución; selector canónico standalone-aware | bajo | STUDIO-01 |
| Bundles Fase 7 "Paquetes (legacy)" | sin destino MOOK (colecciones Biblioteca los absorben) | conservar intactos; deprecación futura con unidad explícita | bajo (sin datos prod) | evidencia de consumidores |
| URL `/admin/experiencias` | permanece (renombrada visualmente) | sin cambio de URL | nulo | — |
| Cola técnica en `/experiencias` | Aula Viva → pestaña Producciones | la cola migra; la ruta técnica se retira después | bajo | REVIEW-01 (+M1-B scoping) |
| Contenido canónico | referenciado por nodos (`standalone` ausente⇒true) | aditivo, cero migración | nulo | — |

### 17.10 Criterios de aceptación (gate GREEN de este cierre)

✅ no contradice código ni datos (auditado contra `16232a3`; el colapso MVP del lifecycle está declarado) · ✅ preserva funcionalidad útil (nada implementado se descarta; legacy se adapta o convive) · ✅ cero duplicación de Biblioteca/progreso/telemetría · ✅ MVP y no-objetivos definidos · ✅ lifecycle y permisos inequívocos · ✅ versión publicada inmutable (garantizado en código) · ✅ 6 nodos con contrato mínimo + accesibilidad + retención · ✅ Leo con límites, aviso de IA y revisión humana · ✅ migración aditiva · ✅ el siguiente slice no exige rediseñar el contrato.

### 17.11 Siguiente unidad

El candidato `CHP-MOOK-01A-MINIMUM-VERSIONED-MODEL` está **ya satisfecho por el código existente** (store versionado + runs con pin + evidencia + 31 tests). El siguiente paso real bajo orden explícita es **`CHP-MOOK-STUDIO-01`** (secuencia congelada STUDIO→REVIEW→PILOT), que consume este contrato sin cambios.

## 18. MVP SCOPE FREEZE (2026-08-19 — CHP-MOOK-MVP-SCOPE-FREEZE-01, vinculante)

Congelación del alcance real del MVP, fundamentada en la evidencia empírica de los prototipos A (inducción docente: 3 módulos, 10 nodos, producción revisable — `CHP_MOOK_PROTOTYPE_02`) y B (club de lectura breve: 1 módulo, 3 nodos, sin producción — `CHP_MOOK_PROTOTYPE_03`), ambos GREEN sobre el mismo modelo sin condiciones especiales.

### 18.1 Alcance congelado (contrato MVP)

1. Una Experiencia puede tener **uno o varios módulos**.
2. Una versión puede usar **cualquier subconjunto** de los seis tipos de nodo (`READING/VIDEO/AUDIO/LEO/ACTIVITY/PRODUCTION`).
3. **`Leer → Conversar → Producir` es plantilla de autoría, no validación**: el Studio la sugiere, el dominio no la exige (demostrado: B publica y completa con READING+LEO+ACTIVITY opcional).
4. **PRODUCTION y la revisión humana son opcionales**: existen solo cuando el diseño pedagógico requiere una entrega. Una experiencia sin PRODUCTION se completa con sus nodos requeridos y no genera entradas en Producciones.
5. **Las versiones publicadas y los runs permanecen inmutables y pineados** (verificado byte a byte en ambos prototipos).
6. **Los recursos se referencian por `contentId`** del catálogo canónico; jamás se copian ni conceden acceso.
7. **Preview no persiste**: cero runs, cero evidencia, cero eventos (verificado por hash de store y auditoría de red).
8. **No existen calificaciones, diagnóstico, rankings ni comparación entre participantes** en ninguna superficie MOOK.

### 18.2 F1 decidido — Información general NO versionada en el MVP

`title/description/imageUrl/durationLabel/audience` son **metadata global de `Experience`**: editable de inmediato, no versionada, visible al instante también sobre la versión publicada. Es la decisión de STUDIO-01 ahora elevada a contrato MVP. Mitigación de interfaz (implementada en esta unidad): la pestaña Información del Studio muestra un aviso persistente y accesible (`role="note"`, ligado por `aria-describedby`, visible antes de editar) que lo declara. Evolución futura registrada (NO deuda MVP): **`VERSIONED-EXPERIENCE-METADATA`**.

### 18.3 M4 decidido — Actividades con registro técnico, sin circuito de revisión

Comportamiento congelado tal como está en código: una ACTIVITY respondida persiste su envío como `ExperienceEvidence` con `requiresReview:false` (registro técnico del recorrido); **no aparece en Producciones ni crea circuito de revisión**; una actividad `required:false` puede omitirse y el run completa igual. **No existe reflexión efímera en el MVP** (si se respondió, quedó en el recorrido). Mitigación de interfaz (implementada): junto al envío de ACTIVITY el runtime muestra un texto accesible que lo declara al participante.

### 18.4 Transcripción — gate técnico de publicación

`publishVersion` **rechaza** toda versión que contenga un nodo `VIDEO` o `AUDIO` sin `config.transcripcion` no vacía: error estructurado HTTP 400 con código estable **`TRANSCRIPTION_REQUIRED`** que identifica módulo y nodo. El **borrador sí puede guardarse incompleto** (la validación de guardado no cambia). La calidad lingüística y la correspondencia audio↔transcripción siguen siendo responsabilidad editorial humana, no del código. READING/LEO/ACTIVITY/PRODUCTION no se ven afectados.

### 18.5 Fuera del MVP (explícito)

Versionado de Información general (`VERSIONED-EXPERIENCE-METADATA`) · reflexión efímera · F2 sugerencia de título al cambiar recurso · F3 guardado sticky · F4/M3 pulido móvil · M2 drafts estructuralmente incompletos · nuevos tipos de nodo · cambios de telemetría. Todo permanece como backlog documentado en `CHP_MOOK_PROTOTYPE_02/03`.

## 19. BITÁCORA PRIVADA (2026-08-24 — CHP-MOOK-ESTAS-AQUI-01, vinculante)

Sección **aditiva**: no modifica §5, §17 ni §18. Cierra el `PRIVACY-BLOCKER` demostrado en
`CHP_MOOK_ESTAS_AQUI_00_ASSET_CAPABILITY_PREFLIGHT`, donde se probó que `activityContext`
proyectaba las respuestas ACTIVITY íntegras al revisor administrador.

### 19.1 Definición

Una **bitácora privada** es un nodo `ACTIVITY` con `config.privado: true`. Su texto se proyecta
**únicamente al participante que lo escribió**. No es un tipo de nodo nuevo, ni un store nuevo,
ni una entidad nueva: es una propiedad opcional de la configuración de ACTIVITY.

**Privada significa:** el contenido no sale del servidor hacia nadie que no sea su autor.
Administradores, revisores, mediadores y otros participantes **no lo reciben por API**, y **no
existe bypass por rol**. Es una garantía de **autorización y proyección**, no de criptografía:
**no se promete cifrado en reposo** (el texto vive en el store JSON como el resto de la evidencia).

### 19.2 Reglas congeladas

1. **`config.privado` ausente o `false` ⇒ comportamiento actual EXACTO.** Solo el booleano `true`
   activa; cualquier otro valor deja el campo ausente en la versión congelada. En nodos que no son
   ACTIVITY el campo se descarta.
2. **Se congela con la versión** (§4): una versión publicada no cambia su carácter privado.
3. **La respuesta sigue siendo append-only** (§18.3): cada envío añade una evidencia; nada se
   sobrescribe. Sirve para registros repetidos (p. ej. un reto de varios días).
4. **El dueño puede releerla** — antes y después de completar el paso, desde el mismo run.
5. **Sin edición, sin eliminación, sin compartir, sin grupo y sin galería** en el MVP.
   La respuesta es **read-only** una vez guardada.
6. **`reviewDetailView.activityContext` omite por completo** pregunta, respuesta y título de todo
   nodo privado. Una `PRODUCTION` del mismo run **sigue siendo revisable con normalidad**.
7. **FAIL-CLOSED:** si el nodo no se puede resolver en la versión fijada del run, se trata como
   privado y no se proyecta a terceros.
8. **Los eventos siguen llevando solo ids** (§9): jamás texto de la bitácora.

### 19.3 Superficie

| Superficie | Contrato |
|---|---|
| Studio (autoría) | Control accesible en ACTIVITY: «Bitácora privada — solo el participante podrá leer su respuesta», con nota descriptiva ligada por `aria-describedby`. Persiste con la versión y sigue editable en borradores futuros. |
| Runtime (participante) | Antes de guardar: «Privada. Solo tú puedes leerla.», botón «Guardar para mí», «Nada se publicará automáticamente». Después: «Guardada para ti» + relectura del texto. **Sin controles de compartir** (no existen). |
| Salida sin guardar | Confirmación accesible (`role="alertdialog"`): «Tu respuesta todavía no está guardada. ¿Quieres conservarla o salir sin guardar?» → «Conservar solo para mí» / «Salir sin guardar». |
| Preview | Conserva los mensajes y **nunca persiste** (§18.1.7 intacto). |
| Revisión | La bitácora no aparece en la cola ni en el detalle. |

### 19.4 Evolución futura — `MOOK-JOURNAL-SHARING`

Compartir una bitácora (elegir con quién, compartir con el grupo, proponer para una galería,
y **retirar lo compartido**) queda **fuera del MVP** y **bloqueado** hasta contar con: scoping
institucional (**M1-B**), consentimiento explícito del autor y retiro reversible con persistencia
real. Las microcopias correspondientes quedan marcadas `FUTURE — MOOK-JOURNAL-SHARING` en el
diseño editorial; **no se simulan controles sin backend**.

### 19.5 Límite explícito del MVP

Sin cifrado en reposo · sin edición ni borrado · sin compartir/galería · sin exportación ·
sin bitácora privada en PRODUCTION (que es revisable por definición) · sin borradores no enviados
(§17.5 se mantiene: lo no enviado no se conserva).
