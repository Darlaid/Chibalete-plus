# CHP-MOOK-PROTOTYPE-03 — Prueba de amplitud del modelo (Prototipo B)

**Fecha:** 2026-08-19 · **Rama:** `chp/mook-contract-00` · **Baseline:** `d35f6ed`
**Veredicto:** `GREEN-PROTOTYPE-BREADTH` — el modelo admite el prototipo mínimo sin
producción, sin condiciones especiales y sin tocar código.
**Alcance:** experimento local; cero cambios productivos; cero cambios de código;
todos los textos del Prototipo B están marcados `[PROTOTIPO]` / «no definitivo».

## 1. Qué se construyó

**Prototipo B — Club de lectura breve** (`exp-1787190351575-1sr1xq`, v1 =
`expv-1787190351837-gsm6qf`), creado **desde cero** en el Studio (no clonado de A):
un único módulo «Club de lectura breve [prototipo]» con exactamente 3 nodos:

1. `READING` (requerido) → **La guerra de los mundos** (`content-1778097541576`,
   catálogo canónico general — no material del Programa Integral).
2. `LEO` (requerido, **mínimo 2 intercambios**) — lectura asociada al mismo
   contentId; objetivo acotado (una decisión del narrador, tomar posición propia;
   sin diagnóstico, calificación ni comparación; cierre transparente declarado);
   semilla ligada al texto; el aviso de IA fijo del runtime se muestra al
   participante (verificado en pantalla).
3. `ACTIVITY` (**opcional**, `required:false`) — 1 pregunta de reflexión, consigna
   explícita «no se revisa ni se evalúa».

Sin AUDIO/VIDEO, sin PRODUCTION, sin evidencia entregable, sin revisión humana,
sin segundo módulo, sin contenido del Programa Integral. La plantilla
Leer→Conversar→Producir aparece en el Studio solo como «guía de autoría, no un
requisito técnico» — y efectivamente no se impuso.

## 2. Validaciones (todas ✔)

| Validación | Evidencia |
|---|---|
| Creación desde cero | «Nueva Experiencia» → ruta vacía → módulo y nodos añadidos uno a uno |
| Recurso por `contentId` | `resourceRef=content-1778097541576` en READING y como lectura asociada del LEO; picker = Bandeja de recursos canónica |
| Guardado y recarga del borrador | Recarga completa del navegador → borrador v1 de B reaparece íntegro (persistencia server-side) |
| Preview sin mutaciones | Interacción en preview (marcar lectura + **enviar respuestas de la actividad**) rechazada con texto «Vista previa — nada de lo que hagas aquí se guarda»; red = 2 GET de imagen, cero `/api`; hash de `mook_db.json` idéntico pre/post |
| Publicación local | «Publicar v1» con confirmación → Publicada. **No exigió PRODUCTION ni los 6 tipos** (la validación estructural exige solo: recurso válido en READING/AUDIO/VIDEO, objetivo en LEO, preguntas en ACTIVITY, consigna en PRODUCTION si existe) |
| Descubrimiento por participante | demo-lector: Biblioteca → pestaña Experiencias → «Otras Experiencias» muestra la card de B con su descripción [PROTOTIPO] |
| Recorrido completo | Landing (1 módulo · 3 pasos, chips por tipo) → Iniciar → lectura con marca explícita → LEO → «🎉 Experiencia completada» |
| Enforcement del mínimo de Leo | Validar sin conversar → error textual «el nodo LEO exige ≥2 intercambios (lleva 0)» (409 server-side, conteo desde `leo_interactions_db` filtrado por contentId y por inicio del run); tras 2 interacciones reales (`/api/leo/ask`, fallback seguro con claves dev inválidas) → validado |
| Finalización sin PRODUCTION | Progreso 2/2 (solo requeridos); run `run-1787190787439-cj92fn` → `completed`; la actividad opcional queda disponible sin bloquear el cierre |
| Ausencia de ExperienceEvidence | 0 registros de evidencia con `experienceId` de B; conteo global 7 → 7 (y `requiresReview` 4 → 4) |
| Ausencia de entrada en Producciones | Cola de revisión (admin) = 4 entradas, todas previas (A/QA); ninguna de B |
| Versión pineada | El run fija `experienceVersionId=expv-1787190351837-gsm6qf` |
| Eventos dormant intactos | `events.db` 2350 → 2350 filas durante toda la unidad (flag OFF) |

**Anti-regresión (RED-REGRESSION descartado):** snapshots SHA-256 de los registros
del Prototipo A (`Experience`, versión v1 publicada, borrador v2, run pineado y
sus 4 evidencias) **byte-idénticos** antes y después de todo el experimento.

## 3. Matiz de contrato encontrado (no es rigidez)

En el modelo congelado, **una ACTIVITY respondida siempre persiste el envío como
`ExperienceEvidence`** (`experienceStore.submitEvidence`), con
`requiresReview:false` — nunca entra a Producciones ni al ciclo de revisión, pero
el registro existe. La única forma de «cero evidencia» es que la actividad quede
sin responder; por eso B la declara **opcional**, y el flujo de responderla se
demostró en preview (cero persistencia). Esto NO bloquea publicar ni completar —
no configura `YELLOW-CONTRACT-RIGIDITY` — pero es una decisión a congelar en el
MVP: si se quiere una «reflexión efímera» que no persista ni como registro
técnico, hoy no existe (registrado como M4 en §6).

## 4. Comparación A/B

| Dimensión | Prototipo A — Inducción docente | Prototipo B — Club de lectura breve |
|---|---|---|
| Propósito | Inducción institucional al Programa Integral (docentes/mediadores) | Club de lectura recreativo mínimo (lectores) |
| Módulos | 3 | 1 |
| Nodos | 10 (READING×3, AUDIO×2, LEO×2, ACTIVITY×2, PRODUCTION×1) | 3 (READING, LEO, ACTIVITY opcional) |
| Recursos | 5 piezas ad-hoc `standalone:false` (3 textos + 2 audios con transcripción) | 1 libro del catálogo general, reutilizado tal cual |
| Duración declarada | 3–4 sesiones largas | 1 sesión corta (~40 min) |
| Producción final | Sí (120–350 palabras, criterio de revisión) | No |
| Evidencia | 4 registros (actividades + producción con versiones/historial) | 0 |
| Revisión humana | Sí (ciclo SUBMITTED→…→REVIEWED en Aula Viva→Producciones) | No (nada entra a la cola) |
| Recorrido del participante | 10 pasos, 2 conversaciones Leo (mín. 3), producción revisable | 3 pasos, 1 conversación Leo (mín. 2), cierre inmediato |
| Esfuerzo de autoría | Alto: corpus fuente + alta de 5 contenidos + 3 módulos (PILOT-01 completo) | ~15 min en el Studio, sin subir contenido nuevo |
| Reutilización del catálogo | Contenido creado para la experiencia | 100% catálogo existente |

**Convivencia:** A (v1 publicada + v2 draft) y B (v1 publicada) coexisten en el
mismo store, el mismo listado, la misma pestaña de Biblioteca y el mismo runtime
**sin condiciones especiales ni ramas de código**: el mismo modelo de 4 entidades
cubre ambos extremos. La amplitud pedida queda demostrada.

## 5. F1 — registro formal

`DECISIÓN PENDIENTE — alcance del versionado de Información general`
(title/description/durationLabel/audience/imageUrl viven en `Experience`, no en la
versión; guardar un borrador los publica de facto — observado de nuevo en esta
unidad: la card pública de A muestra «[…BORRADOR v2 DE PRUEBA DE EDITABILIDAD]»
en Biblioteca). **No se corrigió.** El paso posterior decidirá con evidencia si
F1 exige versionado o solo una advertencia de interfaz.

## 6. Backlog UX (sin implementación, de PROTOTYPE-02 + esta unidad)

F2 (título del paso no se sugiere al cambiar recurso) · F3 (Guardar borrador fuera
de vista) · F4 (acciones de tabla móvil tras scroll horizontal) · M1 (transcripción
no es gate técnico de publish) · M2 (drafts exigen completitud estructural al
guardar) · M3 (recortes menores 390px) · **M4 (nuevo):** decidir si el MVP necesita
una actividad «efímera» que no persista registro técnico al responderse (§3).
Nota de herramienta (no del producto): el checkbox «Paso requerido» ignoró el set
programático del harness de QA y exigió clic real — sin impacto para usuarios.

## 7. Estado final y próximo paso

Local: B publicada (v1) con 1 run completed de demo-lector; A intacta con v1
publicada + v2 DRAFT. Sin deploy, sin aprobación editorial, sin preflight. Smoke
de autor y participante ejecutado; suites no repetidas (cero cambios de código,
árbol git limpio).

**Siguiente sugerido:** comparar A y B para congelar el alcance real del MVP MOOK
(esta tabla es el insumo) y decidir F1 (versionado vs. advertencia de UI) y M4
(evidencia técnica de actividades) como parte de ese congelamiento.
