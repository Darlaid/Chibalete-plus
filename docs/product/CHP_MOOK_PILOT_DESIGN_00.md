# CHP-MOOK-PILOT-DESIGN-00 — Piloto "Me desconecto, luego existo"

Fecha: 2026-08-18 · Estado: **CONGELADO** junto con CHP-ADR-MOOK. Especificación implementable sin rediseño.

---

## 1. Por qué este título

`content-1765751139919` — **"Me desconecto, luego existo"** (Latitud Cero Pensamiento Sur): existe en el catálogo productivo con texto plano disponible, Leo ya tiene contexto construido para él (sesiones reales lo usaron), y su tema —existir en la hiperconexión, con Descartes, Kierkegaard y Simone Weil— es ideal para demostrar LEER → CONVERSAR → PRODUCIR → REVISAR con adolescentes. No exige video/audio: **no se añaden nodos para exhibir features**.

## 2. Ficha del piloto

- **Objetivo pedagógico:** que el estudiante tome una posición argumentada sobre su propia relación con la hiperconexión, apoyándose en las tres tensiones del libro (existencia vs. aparición, multitud vs. elección, ruido vs. atención).
- **Audiencia:** secundaria (12–16).
- **Duración estimada:** 2–3 sesiones de ~25 min (lectura del fragmento + conversación + actividad; producción puede ser tarea).
- **Resultado esperado:** un texto argumentativo breve revisado por el mediador.
- **Evidencia final:** la producción del nodo 4, con decisión y feedback humanos.
- **Versión:** el piloto nace como `Experience v1` (draft → published); cualquier ajuste posterior = v2.

## 3. Especificación nodo por nodo (5 nodos: 4 requeridos + 1 opcional)

| Orden | Tipo | Requerido | Propósito | Recurso/Config | Completitud | Evidencia |
|---|---|---|---|---|---|---|
| 1 | READING | sí | Encuentro con el texto: leer la introducción y la primera tensión ("existencia vs. aparición") | `resourceRef=content-1765751139919`, fragmento descriptivo "Introducción + tensión 1"; abre en el visor existente (Modo Guiado) | marca explícita "terminé esta lectura" (el progreso del libro sigue siendo del progress engine, aparte) | — |
| 2 | LEO | sí | Conversar: procesar la lectura y conectarla con la vida propia | objetivo="comprensión + conexión personal", semilla="¿Qué significa para ti 'desconectarse para existir'? ¿Cuándo sientes que apareces más de lo que existes?", `minIntercambios=3` | ≥3 intercambios | entradas de `leo_evidence` referenciadas (solo las clasificadas por el servicio Leo) |
| 3 | ACTIVITY | sí | Fijar comprensión de las tres tensiones | instrucción="Responde con tus palabras (2–4 líneas cada una)"; preguntas: (a) "¿Qué diferencia hay entre existir y aparecer?", (b) "¿Qué te quita la multitud cuando decides con ella?", (c) "¿Qué te permite la atención que el ruido no?" — tipo `text_short` | responder las 3 | submission (sin revisión obligatoria; visible para el mediador como contexto) |
| 4 | PRODUCTION | sí | Producir: posición argumentada | consigna="Escribe un texto de 150–300 palabras: ¿Somos lo que mostramos o lo que somos cuando nadie nos ve? Toma posición, da al menos 2 razones y usa al menos 1 idea del libro."; tipo `text`; criterioRevision="posición clara + ≥2 razones + ≥1 referencia al libro" | enviar | **submission → revisión humana obligatoria** |
| 5 | ACTIVITY | no (opcional) | Cierre metacognitivo | 1 pregunta: "¿Qué cambió (o no) en tu forma de ver la desconexión después de esta ruta?" — `text_short` | responder | submission |

Progreso = requeridos completados / 4. Experiencia completada al cerrar el nodo 4 (el 5 no bloquea).

## 4. Flujo de revisión del piloto

El mediador del grupo del estudiante ve la cola de producciones `SUBMITTED` → abre una → ve consigna + criterio + texto del estudiante (+ respuestas del nodo 3 como contexto) → registra `decision: aprobado | con_comentarios` + feedback breve → `REVIEWED`. El estudiante ve la decisión y el feedback en su landing de la Experiencia. (Scoping institucional estricto de la cola = M1-B; en piloto controlado, el mediador designado del grupo piloto.)

## 5. Recorrido UX del piloto

1. **Descubrimiento:** entrada "Experiencias" → card del piloto (título, objetivo en una línea, duración).
2. **Landing:** título + propósito + progreso (0/4) + CTA "Comenzar".
3. **Ruta:** lista vertical de los 5 nodos con estados (actual/completado/bloqueado/opcional); el nodo 1 muestra la portada del libro proyectada del catálogo (referencia, no copia); si el estudiante no tiene entitlement del libro → candado con "Pídelo a tu mediador" (patrón Biblioteca) y la ruta no avanza por ese nodo.
4. **Nodo lectura:** botón "Leer" → visor existente; al volver, "terminé esta lectura".
5. **Nodo Leo:** UI de Leo existente con la semilla del nodo; contador discreto de intercambios.
6. **Actividad/Producción:** formulario mínimo (preguntas/consigna + textarea + enviar); estado del envío visible.
7. **Cierre:** al completar el nodo 4 → "Experiencia completada" + estado de revisión de la producción.

## 6. Telemetría del piloto (cadena canónica, sin pipeline nuevo)

`experience_started` (al crear el run) · `node_started`/`node_completed` por nodo · `evidence_submitted` (nodos 3/4/5) · `evidence_reviewed` (nodo 4) · `experience_completed`. Todas como entradas nuevas del `eventRegistry` canónico, emitidas por `/api/v1/events` con el transporte durable existente. La conversación de Leo sigue emitiendo por su pipeline propio ya existente — no se duplica.

## 7. Qué demuestra el piloto (mapeo a casos del ADR)

LEER (nodo 1, referencia canónica — C, D) → CONVERSAR (nodo 2, Leo como nodo — E) → PRODUCIR (nodos 3–4, evidencia ligada a usuario+versión+nodo — F) → REVISAR (mediador, decisión+feedback — G), con versión fijada por run (A, B) y completitud derivada (H).

## 8. Fuera del piloto

Video/audio (no aportan a este título), producción en audio/archivo (bloqueada por decisión de almacenamiento/moderación), branching, calificaciones numéricas, cola de revisión multi-institución (M1-B), integración de Experiencias dentro de Biblioteca, materialización a insights.
