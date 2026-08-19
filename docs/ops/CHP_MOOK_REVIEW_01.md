# CHP-MOOK-REVIEW-01 — Revisión humana de producciones (local, sin deploy)

Fecha: 2026-08-19. Tipo: implementación full-stack de la pestaña **Producciones** en Aula Viva (UX congelada §D1–D4) y del ciclo de revisión humana sobre `ExperienceEvidence`. Contrato: `docs/adr/CHP_ADR_MOOK.md` §17. Cero cambios productivos; eventos dormant intactos.

---

## A. Veredicto

**GREEN-MOOK-REVIEW** — circuito completo demostrado end-to-end en local con tres actores reales (participante `demo-lector`, mediador `demo-profesor` fail-closed, administrador `admin-super-1`): entrega → pendiente → retroalimentación → ajustes solicitados → reenvío (historial conservado) → revisión confirmada → participante ve el resultado. 73/73 tests MOOK+review, typecheck baseline, build GREEN.

## B. Modelo de estados (mínimo, sobre la evidencia existente)

```text
SUBMITTED → REVISION_REQUESTED → RESUBMITTED → REVIEWED
                 ↑______________________|            (REVIEWED alcanzable desde
                                                      cualquier estado no terminal)
```

- `review.status` se extiende con `REVISION_REQUESTED` (el nombre YA definido por el ADR §3 — esta unidad lo activa, decisión de producto del operador) y `RESUBMITTED`.
- **`versions[]` append-only**: la entrega original es `versions[0]` y NUNCA se sobrescribe; cada reenvío agrega; `payload.text` apunta a la vigente (compat con lectores previos).
- **`history[]` append-only**: `submitted | feedback | revision_requested | resubmitted | reviewed`, cada entrada con timestamp de SERVIDOR y `reviewerId` cuando aplica; nada se borra jamás.
- Compat: evidencia pre-REVIEW-01 sin `versions/history` se normaliza al leer (`ensureReviewShape`), sin migración (verificado con la entrega histórica del store dev).
- **Sin calificaciones**: `REVIEWED` = «revisión humana realizada». La decisión `aprobado|con_comentarios` es el cierre de mediación YA congelado por UX-D3/ADR — no se añadió ninguna escala, score, ranking ni comparación.
- Transiciones inválidas rechazadas: reenviar sin ajustes pedidos, pedir ajustes dos veces, tocar una REVIEWED (`INVALID_TRANSITION`/`ALREADY_REVIEWED`, 409); doble «marcar revisada» no duplica historial.

## C. Autorización y scoping (gate M1-B)

Regla implementada **fail-closed** en `requireReviewAccess` (server-side, actor SIEMPRE derivado de la sesión — jamás `institutionId/groupId/userId` del cliente):

| Actor | Cola/detalle/mutaciones de revisión |
|---|---|
| Administrador | ✅ (único alcance que el contrato actual reconoce) |
| Mediador (cualquier variante `isMediatorRole`) | ❌ **403 `MEDIATOR_SCOPE_GATED`** — el sistema aún no puede demostrar su scope institucional; sin cola global, sin fallback inventado. Activación = M1-B |
| Lector | ❌ 403 `REVIEW_FORBIDDEN` |
| Participante sobre SU evidencia | solo `resubmit` (dueño verificado server-side, `NOT_EVIDENCE_OWNER` 403) y su propia proyección vía la ruta de SU run |

Identificación mínima del participante en la bandeja: `nombre_completo` del padrón canónico resuelto server-side (sin userId crudo en la lista, sin correo, sin colegio). La proyección del participante **no** incluye `reviewerId`. Verificado en vivo: mediador → 403 gated; lector intruso → 403 en resubmit ajeno y en la cola.

## D. APIs (aditivas; mismo store MOOK, cero bases nuevas)

- `GET /api/experiences/review/queue` — ENDURECIDA (antes mediador veía cola global de SUBMITTED; ahora admin-only y devuelve TODAS las producciones con estado, nombre, versión, actividad) — su único consumidor (pestaña técnica) se retiró en esta misma unidad.
- `GET /api/experiences/review/:evidenceId/detail` — contexto D3 completo (consigna, criterio, objetivos, versiones, historial, respuestas de actividad del run, estado del recorrido).
- `POST /api/experiences/review/:evidenceId/feedback` — comentario sin cambio de estado (obligatorio no vacío).
- `POST /api/experiences/review/:evidenceId/request-changes` — comentario OBLIGATORIO (`COMMENT_REQUIRED`).
- `POST /api/experiences/review/:evidenceId` — marcar revisada (existente, transición extendida) + `emitEvidenceReviewed` (tipo existente, flag OFF).
- `POST /api/experiences/evidence/:evidenceId/resubmit` — dueño por sesión; valida rango de palabras del nodo; `emitEvidenceSubmitted` (tipo existente, flag OFF).
- `GET /api/experiences/:id/route` — el `evidence[]` del dueño ahora proyecta `participantEvidenceView` (estado, comentarios, versiones, canResubmit, cierre).

Errores estructurados `{error, code}`; mapa: 404/403/409/400 en `mookErrStatus`.

## E. UI

- **Aula Viva → pestaña «Producciones»** (`components/review/ProduccionesTab.tsx`; AulaViva solo suma la pestaña): contador descriptivo («n producciones · m pendientes»), filtros con label (experiencia/estado/fecha), lista de cards accesible (nombre, experiencia·versión·módulo·nodo, fecha, estado con texto, «Revisar»), y CUATRO vacíos diferenciados: sin producciones / sin coincidencias del filtro (con «Limpiar filtros») / **error con Reintentar que dice explícitamente que el conteo no está disponible (jamás un 0 falso)** / acceso gateado (mensaje del 403 de mediadores).
- **Detalle** (modal `role=dialog`, foco al abrir, retorno de foco al cerrar, Escape no nativo — botón Cerrar): contexto completo, entregas con TODAS las versiones (vigente resaltada), historial con comentarios, textarea de mediación, acciones «Enviar retroalimentación» / «Solicitar ajustes» (deshabilitada si ya solicitados) / «Marcar como revisada…» con confirmación en dos pasos (Aprobar/Con comentarios/Cancelar), guard de doble submit (`busy`), errores `role=alert` asociados, éxito `role=status`, y **cola+detalle refrescados sin recarga completa**. Nota permanente: «Revisar = confirmar la mediación humana. No es una calificación…».
- **Participante** (`Experiencias.tsx`): pestaña técnica de revisión RETIRADA (D1 cumplido); panel «Tu producción» bajo la ruta + estado en el cierre: `Enviado — pendiente` / `Tu mediador te pidió ajustes` (+comentarios con fecha, textarea de reenvío con contador de palabras) / `Reenviada — pendiente` / `Revisada el <fecha> — decisión: feedback`; historial de versiones visible («todas se conservan»). El participante no puede ver entregas ajenas, editar lo histórico, cambiar estado ni elegir revisor.

## F. Historial y eventos

El estado de dominio persiste completo aunque la telemetría esté apagada. Flag `EXPERIENCE_EVENTS_BACKBONE_ENABLED` **OFF intacto**; solo se emiten los tipos EXISTENTES (`evidence_submitted` en reenvío, `evidence_reviewed` al cerrar) — cero tipos nuevos, cero telemetría paralela. Payloads = ids + decision; el schema zod `.strip()` descarta cualquier campo no declarado (test 14 lo demuestra inyectando texto/PII). Nada del contenido de la producción ni nombres viaja a events.db.

## G. Tests (15 nuevos en `server/__test__/mookReview01.test.mjs`; suite MOOK = 73)

Los 15 del mandato: entrega→SUBMITTED con versión e historial · bandeja autorizada con nombre y sin userId/contenido · intruso rechazado + proyección sin reviewerId · mediador fail-closed (estructural sobre el guard y las 4 rutas) · detalle completo con contexto de actividad · feedback atribuido con timestamp · ajustes exigen comentario · participante ve feedback · reenvío append-only + rango de palabras · transiciones inválidas · doble review sin duplicar · REVIEWED conserva todo el ciclo · fallo≠cero (estructural del tab) · eventos sin PII (validados contra el registry real) · bundles/Studio/pestaña-técnica-retirada. Vecindad: `test:library` 17/17, `test:metric-contract` 16/16, `test:memberships` 51/51 (autorización), `typecheck:baseline` sin regresiones, `npm run build` GREEN.

## H. QA visual local

Workaround habitual (backend OFF :3010 con `USERS_DB` explícito al fixture, micro-proxy :3000 con `x-user-id` CONMUTABLE entre actores, Vite :5173; cero datos productivos; el `.env` tracked no se tocó). Validado con Chrome real: seed de experiencia mínima READING+PRODUCTION vía Studio API · entrega del lector real por UI · mediador → API 403 `MEDIATOR_SCOPE_GATED` (su Aula Viva de fixture sin grupos cae a vista estudiante, así que el gate se demostró a nivel API, donde vive la garantía) · admin: bandeja con contador/filtros/nombres (incl. compat con una entrega histórica pre-REVIEW-01) → detalle → ajustes sin comentario = error asociado → ajustes con comentario = estado+historial+cola actualizados sin recarga → botón «Ajustes ya solicitados» deshabilitado · lector: cierre avisa, panel «Tu producción» muestra feedback y reenvía (contador de palabras) → «Reenviada» + historial de 2 versiones · admin: detalle con 2 versiones (vigente resaltada) e historial completo → confirmación en dos pasos → «Revisada el … — Aprobada» · lector: proyección final con decision+feedback+2 versiones, `canResubmit=false` · **móvil 390px** (iframe): bandeja en cards apiladas y filtros con label, sin scroll horizontal de página · teclado: labels/roles/foco del modal verificados en las superficies nuevas. No probado: lectores de pantalla reales, `prefers-reduced-motion` (no se añadió ninguna animación nueva), zoom 200%.

## I. Límites y gates

- Activación de mediadores = **M1-B** (el 403 gated es la frontera; sin workaround).
- Sin asignación institucional, sin contenidos del piloto, sin uploads UGC, sin `IN_REVIEW/APPROVED` del Studio (lifecycle editorial ≠ revisión de producciones).
- Peculiaridad de navegación preexistente (no de esta unidad): la carga directa de una URL profunda redirige a Inicio durante el bootstrap de sesión del entorno dev; la navegación interna funciona.
- La cola de admin es global por diseño ACTUAL del contrato (admin = único rol con alcance reconocido); el particionado institucional llega con M1-B.

## J. Rollback local

`git revert` del commit único de la unidad. Datos: los campos nuevos (`versions/history`, estados intermedios) son aditivos y tolerados por los lectores previos (el shape antiguo se normaliza al leer; el nuevo conserva `payload`+`review` compatibles); una evidencia en `REVISION_REQUESTED/RESUBMITTED` volvería a mostrarse como pendiente en el código anterior, sin pérdida.

## K. Próximo paso

`CHP-MOOK-PILOT-01` (contenidos del piloto de inducción docente), bajo orden explícita.
