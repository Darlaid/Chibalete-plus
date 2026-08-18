# CHP-MOOK-PRODUCT-UX-01 — Runtime + Studio + Review (UX freeze)

Fecha: 2026-08-18 · Estado: **CONGELADO**. Contrato visual implementable para `RUNTIME-01`, `STUDIO-01` y `REVIEW-01` — sin backend nuevo, sin deploy, sin reabrir decisiones GREEN. Wireframes textuales embebidos (un solo documento, sin fragmentar).

Principios de la unidad: el Runtime se siente **Experiencia Chibalete+**, no LMS. Studio se siente **extensión de Subir**, no otro CMS. Review permite **mediar**, no calificar. Un catálogo, una identidad, una autorización, una cadena de evidencia.

---

## A. Arquitectura de información (congelada)

```text
Biblioteca (página existente)
   └─ pestaña «Experiencias»
        ├─ Descubrimiento  (destacada + otras)
        ├─ Landing         (/experiencias/:experienceId — antes de iniciar)
        └─ Runtime         (misma ruta — ruta de módulos + shell de nodo)

Subir — «Gestor de Contenido y Ecosistemas» (página existente)
   └─ acción de primer nivel «Crear / editar Experiencia» (uploadMode: 'experiencia')
        ├─ Información
        ├─ Ruta            (módulos → nodos, superficie principal)
        ├─ Vista previa    (Runtime real en modo preview)
        └─ Publicación     (borrador → publicada → nueva versión)

Aula Viva (página existente, rol mediador)
   └─ pestaña «Producciones»  (Review/Mediación)
        ├─ Pendientes
        ├─ Detalle de producción
        └─ Feedback
```

Ninguna superficie adicional en el MVP. La actual pestaña técnica de revisión en `/experiencias` se retira cuando REVIEW-01 la reubique en Aula Viva.

---

## B. Runtime

Flujo congelado: `DESCUBRIR → COMPRENDER → INICIAR → RECORRER → INTERACTUAR → PRODUCIR → REANUDAR → COMPLETAR` — cada transición con acción y estado visibles.

### B1. Biblioteca → Experiencias (descubrimiento)

```text
┌─ Biblioteca ─ [Libros] [Experiencias•] [Selección] [Álbum] … ────────────┐
│ ┌───────────────────────────────────────────────────────────────────────┐│
│ │ [ilustración editorial]     EXPERIENCIA DESTACADA                     ││
│ │ Título grande                                                         ││
│ │ Descripción corta (1–2 líneas) · ~2–3 sesiones · 2 módulos · 5 pasos  ││
│ │ ▓▓▓▓▓░░░░░ 2/4 completados   ← solo si ya fue iniciada                ││
│ │ [ Continuar ruta → ]         ← o «Iniciar ruta» si no hay run         ││
│ │ Módulos: ● Leer y conversar (Completado) ○ Pensar y producir (Por     ││
│ │          iniciar)            ← nombre + estado con texto, no solo color││
│ └───────────────────────────────────────────────────────────────────────┘│
│ Otras Experiencias — grilla simple de cards (título, descripción, CTA)   │
└──────────────────────────────────────────────────────────────────────────┘
```

- Destacada = primera publicada con run activo del usuario; si no hay, la más reciente (regla simple, sin motor de recomendación).
- Estados de módulo SIEMPRE con etiqueta textual (`Completado / En curso / Por iniciar`) + color como refuerzo, nunca única señal.
- Grilla, no carrusel.

### B2. Landing (antes de iniciar)

Muestra: título, ilustración, **qué propone** (descripción + objetivo), **para quién** (audiencia), **duración aproximada**, número de módulos y pasos, tipos de interacción como chips (Lectura · Conversación con Leo · Actividad · Producción), y el aviso honesto cuando existe producción: *"Incluye una producción que revisará tu mediador."* CTA único: `Iniciar experiencia` / `Continuar experiencia`. Si un recurso requerido no tiene acceso: card del recurso con candado + *"Sin acceso a este contenido — pídelo a tu mediador"* (patrón Biblioteca; jamás mensaje genérico, jamás concesión de acceso).

### B3. Ruta visual (secuencia lineal de módulos)

```text
← Biblioteca                     Tu ruta                    2/4 completados
▓▓▓▓▓▓▓▓░░░░░░░░  (barra de Experiencia, derivada de nodos requeridos)

MÓDULO 1 · Leer y conversar                       [Completado]
  ✓ 1. Leer: existencia vs. aparición             Completado
  ✓ 2. Conversar con Leo                          Completado
MÓDULO 2 · Pensar y producir                      [En curso]
  ● 3. Las tres tensiones (actividad)             Estás aquí
  ○ 4. Tu posición (producción)                   Bloqueado
  ○ 5. Cierre (opcional)                          Opcional
```

El usuario sabe de un vistazo: dónde está (`Estás aquí`), qué terminó (✓), qué sigue (primer no-completado disponible). Sin grafo, sin branching visual, sin gamificación.

### B4. Shell de nodo (común a todos los tipos)

```text
┌ Experiencia · Módulo 2 · Pensar y producir ──────────── 2/4 ─┐
│ ◄ Anterior     ▲ Volver a la ruta        Siguiente ►         │
│ TÍTULO DEL NODO                                              │
│ Propósito / instrucción (1–3 líneas)                         │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │            CONTENIDO PRINCIPAL DEL NODO                  │ │
│ │  (visor/Leo/formulario EXISTENTES, sin re-envolver       │ │
│ │   hasta perder su identidad)                             │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [acción de completitud del tipo]                             │
└──────────────────────────────────────────────────────────────┘
```

`Siguiente` habilitado solo cuando el nodo actual está completado (o es opcional). `Volver a la ruta` siempre disponible.

### B5. UX por tipo de nodo

| Tipo | Contenido principal | Completitud | Notas |
|---|---|---|---|
| READING | card del libro (portada+título proyectados del canónico) + `Abrir lectura` → visor existente | botón explícito `Terminé esta lectura` al volver | el progreso DEL LIBRO sigue siendo del progress engine; el nodo no lo infiere |
| VIDEO / AUDIO | reproductor existente (VisorVideo/VisorAudio); subtítulos/transcripción cuando el contenido los tenga | `Terminé de ver/escuchar` | — |
| LEO | semilla en cursiva + `Conversar con Leo` (interfaz Leo existente dentro del lector) + contador discreto "intercambios: n/3" | `Ya conversé — validar` (validación server-side) | si <mínimo: mensaje claro "El nodo pide al menos 3 intercambios (llevas n)" |
| ACTIVITY | consigna + preguntas con textarea | `Enviar respuestas` → estado `Respuestas enviadas` | — |
| PRODUCTION | consigna + criterio visible + editor textual con contador "n palabras (150–300)" en verde al entrar en rango | `Enviar producción` → estado `Enviado — pendiente de revisión` | sin autosave complejo en MVP: aviso al salir con texto sin enviar |

### B6. Progreso (3 niveles, todo derivado)

Experiencia: barra + "n/m completados" (nodos requeridos). Módulo: `Completado / En curso / Por iniciar`. Nodo: `Pendiente / Estás aquí / Completado / Bloqueado / Opcional`. **Nunca** calificaciones ni lenguaje de desempeño.

### B7. Salida y reanudación

Abandonar un nodo no pierde nada persistido (los envíos son explícitos). Al volver (mismo día u otro): Biblioteca→Experiencias muestra la destacada con `Continuar ruta` → aterriza directo en la ruta con el nodo `Estás aquí` marcado — cero reconstrucción manual. El run existente se reutiliza (idempotente, ya implementado).

### B8. Cierre

```text
🎉 Experiencia completada
Módulos: ✓ Leer y conversar   ✓ Pensar y producir
Tu producción: «Tu posición» — Pendiente de revisión | Revisada (feedback)
[ Volver a Biblioteca ]  [ Revisar mi recorrido ]  [ Otra Experiencia → ]
```

Sin badges ni certificados. "Otra Experiencia" solo si existe alguna más publicada.

---

## C. Studio (dentro de Subir)

### C1. Ubicación

`Subir` ("Gestor de Contenido y Ecosistemas") ya abre con **"¿Qué deseas hacer?"** y `uploadMode: 'new' | 'existing' | 'manage'`. Studio = **cuarta acción de primer nivel**: `'experiencia'` — card "Crear / editar Experiencia" con el mismo patrón visual de las tres existentes. Sin navbar nuevo, sin aplicación aparte.

### C2. Home/listado

Tabla/lista mínima: título · estado (`Borrador`/`Publicada`) · versión (v1, v2…) · última edición · acciones `Editar · Previsualizar · Publicar` (o `Crear nueva versión` si está publicada). Botón `+ Nueva Experiencia`. Sin dashboard editorial.

### C3. Flujo principal — tabs (no wizard: la edición es recurrente)

`[Información] [Ruta] [Vista previa] [Publicación]`

### C4. Información

Campos EXACTOS: título · descripción · imagen (ilustración editorial) · objetivo · audiencia · duración estimada. Nada más (sin tags/SEO/settings).

### C5. Ruta (superficie principal del editor)

```text
MÓDULO 1 — Leer y conversar                    [✎ editar] [↑] [↓]
  1. Lectura — «Leer: existencia…»   requerido  [✎] [↑] [↓] [🗑]
  2. Leo — «Conversar con Leo»       requerido  [✎] [↑] [↓] [🗑]
  + Añadir nodo
MÓDULO 2 — Pensar y producir                   [✎ editar] [↑] [↓]
  3. Actividad …
  + Añadir nodo
+ Añadir módulo
```

Acciones: añadir/editar/reordenar/eliminar módulo y nodo. Drag-and-drop OPCIONAL; los botones `↑/↓` son la alternativa accesible OBLIGATORIA (y suficiente para el MVP). Sin canvas.

### C6. Añadir nodo

Selector de EXACTAMENTE 6 tipos: `Lectura · Video · Audio · Leo · Actividad · Producción` → abre la configuración del tipo.

### C7. Selector de contenido (nodos con recurso)

Modal/panel sobre el **catálogo canónico único**: búsqueda por título + filtro por tipo. Muestra contenido autónomo Y no-autónomo; las piezas marcadas para Experiencias llevan chip **"Para Experiencias"** (sin catálogo aparte). Seleccionar guarda SOLO la referencia (`contentId`).

### C8. Crear contenido faltante

Botón `Crear contenido` dentro del selector → navega al flujo `new` existente de Subir (con la opción de §C9 visible); al publicar, retorno al editor con el selector reabierto y la pieza nueva arriba ("recién creado"). Sin uploader modal MOOK.

### C9. Checkbox en Subir (flujo `new`, sección de visibilidad/metadata)

`☐ Contenido para una Experiencia` — helper: *"Esta pieza puede utilizarse dentro de una Experiencia y no se mostrará normalmente como contenido independiente en Biblioteca."* Default: **desmarcado** (standalone). En el gestor (`manage`), la pieza muestra el chip "Para Experiencias". La palabra `standalone` NO aparece en UI.

### C10. Configuración por nodo (campos mínimos)

Lectura/Video/Audio: contenido (selector) · título/contexto opcional · instrucciones · requerido/opcional. Leo: objetivo conversacional · semilla/instrucción · mínimo de intercambios (default 3) · requerido/opcional. Actividad: consigna · preguntas (lista de textos, respuesta corta) · requerido/opcional. Producción: consigna · criterio de revisión · mín/máx palabras · requerido/opcional. Sin schema builder.

### C11. Vista previa

`Vista previa como participante` = **el Runtime real** (mismo componente/ruta render) con banner fijo superior `▲ Vista previa — nada de lo que hagas aquí se guarda`. Reglas duras: no crea run, no emite eventos, no genera evidencia (render de la versión con run virtual vacío, sin llamadas de mutación). Sin renderer paralelo.

### C12. Borrador y publicación

`BORRADOR` editable ↔ `PUBLICADA` inmutable (invariante ya implementada). Editar una publicada ofrece únicamente `Crear nueva versión` (copia editable v+1). Confirmación de publicar: *"Publicar v2 — los participantes nuevos entrarán a esta versión; quienes están en curso terminan la suya."* Sin workflow multinivel.

### C13. Protección de referencias

Al intentar eliminar contenido canónico usado por una Experiencia publicada: *"Este contenido está siendo utilizado en una Experiencia publicada."* + `Cancelar` / `Ver dónde se usa` (lista simple de Experiencias/nodos — consulta trivial sobre las versiones). Sin dependency manager.

---

## D. Review / Mediación

### D1. Ubicación (decidida)

**Aula Viva → pestaña "Producciones"** — el hogar natural del mediador (Aula Viva ya adapta su vista por rol). Consume los endpoints de cola/revisión existentes. El scoping institucional estricto de la cola sigue gateado por M1-B: hasta entonces la pestaña es visible para roles mediador/administrador con la frontera documentada (no exige M1-B para existir). La pestaña técnica actual en `/experiencias` se retira en REVIEW-01.

### D2. Bandeja

Lista: participante · Experiencia · módulo · nodo (producción) · fecha · estado (`Pendiente`/`Revisada`). Orden: pendientes primero, más antiguas arriba. Sin filtros avanzados. Vacío: *"No hay producciones pendientes. Las nuevas aparecerán aquí."*

### D3. Detalle

Contexto completo: participante, Experiencia+versión, módulo, nodo, **consigna**, **criterio de revisión**, objetivos, texto de la producción (blockquote legible), y las respuestas de la actividad previa como contexto si existen. Acciones: textarea de feedback + `Marcar como revisada` con decisión `Aprobar` / `Con comentarios`. Sin nota numérica, sin ranking, sin rúbrica.

### D4. Vista del participante

En el nodo/cierre: `Enviado — pendiente de revisión` → al revisarse: `Revisada — Aprobada` o `Revisada — Con comentarios: "…feedback…"`. El feedback es texto de mediación, nunca nota.

---

## E. Estados transversales (una familia coherente)

| Estado | Patrón único |
|---|---|
| Loading | skeleton existente (AccessLoadingSkeleton y variantes) |
| Empty | ícono tenue + frase + siguiente paso ("Pronto habrá Experiencias…", "No hay producciones pendientes…") |
| Error | mensaje corto + `Reintentar` (patrón useAccessCheck 'error') |
| Sin entitlement | candado + "Pídelo a tu mediador" (patrón Biblioteca, textual) |
| Contenido no disponible | card atenuada "Este contenido ya no está disponible" (referencia dormida) |
| Offline | banner informativo; lectura del visor sigue su propio contrato offline |
| Sin progreso | CTA `Iniciar ruta` (el cero no se disfraza) |
| Revisión pendiente / revisada | chips ámbar/verde CON texto |

---

## F. Responsive

Desktop: Runtime = contenido principal + progreso no invasivo (header del shell); Studio = ruta con espacio de edición cómodo (dos columnas opcionales: lista + editor del nodo). Tablet: acciones completas. Mobile: **Runtime plenamente funcional** (ruta vertical ya lineal, shell apilado, textarea cómodo); Studio funcional con `↑/↓` (drag no requerido); Review usable (bandeja en cards, detalle apilado). Reflow sin scroll horizontal.

---

## G. Accesibilidad (WCAG 2.2 AA desde diseño)

Teclado completo y foco visible en toda superficie; orden lógico = orden visual; landmarks (`main/nav`), headings jerárquicos; labels reales en cada campo (las preguntas de actividad son `<label>` de su textarea); botones con nombre comprensible ("Terminé esta lectura", nunca solo un ícono); estados con texto+forma, no solo color; barra de progreso con `role="progressbar"` + `aria-valuenow` y texto "2 de 4"; **alternativa a drag-and-drop = botones Subir/Bajar** (obligatoria); contraste AA (los gradientes de card destacada con texto blanco verificados); reflow/zoom 200% sin pérdida; errores de envío asociados al campo (`aria-describedby`) y anunciados (`aria-live`); subtítulos/transcripciones cuando el contenido los tenga (el nodo los expone, no los inventa); modales del selector con focus-trap y retorno de foco; banner de Vista previa perceptible también por lectores de pantalla.

---

## H. Componentes

**Reutilizar** (existen): tabs de Biblioteca (TabButton), cards/ContentCard, botones/inputs Tailwind del sistema, barras de progreso, VisorTexto/VisorVideo/VisorAudio, interfaz Leo, AccessWrapper/useAccessCheck (candado), skeletons, patrones de Subir (action chooser, formularios, tablas de manage), estructura de pestañas de Aula Viva.

**Crear** (mínimos, sin design system MOOK): `FeaturedExperienceCard` · `ExperienceCard` · `ModuleRoute` (lista de módulos+nodos con estados) · `NodeShell` · `StudioExperienceList` · `StudioModuleEditor` · `StudioNodeEditor` (con `ContentPicker`) · `ReviewInbox` + `ReviewDetail`. Los NodeCard/route render actuales de `Experiencias.tsx` son la base evolutiva de `ModuleRoute`/`NodeShell`.

---

## I. Contrato de datos por superficie

**Runtime** — ya servido por la API actual: `GET /api/experiences` (id, slug, title, description, version, nodeCount, moduleCount, moduleTitles) · `POST /api/experiences/:id/run` y `GET /api/experiences/:id/route` → `{runId, status, progress{completedRequired,totalRequired,completed}, modules[{id,title,state,nodes[{id,type,title,required,state,config,resource?,evidenceIds}]}], nodes(plana), evidence[{nodeId,requiresReview,review{status,decision,feedback}}]}`.
**Datos que FALTAN y se declaran** (añadir en RUNTIME-01/STUDIO-01, mínimos): `Experience.imageUrl` (ilustración), `Experience.durationLabel` (texto libre "2–3 sesiones"), `Experience.audience`, `Experience.objective` (para landing; hoy los objectives viven en la versión — la landing puede leerlos de ahí y solo faltan imagen/duración/audiencia) · el LISTADO debe incluir `myRun {exists, status, progress}` para el CTA/progreso de la destacada · chips de tipos de interacción = derivables de `moduleTitles`+tipos (el listado puede exponer `nodeTypes[]` agregado).

**Studio** — ya servido: rutas admin create/draft/update/publish + shape completo de versión (modules/nodes/config). FALTA solo: los campos nuevos de Experience (imagen/duración/audiencia) y el modo preview (render sin run — frontend puro con la versión draft; cero backend nuevo). Selector: `GET /api/content` existente + campo `standalone` (chip).

**Review** — ya servido: `GET /api/experiences/review/queue` (id, submittedAt, userId, experience, version, **moduleTitle**, nodeTitle, consigna, criterioRevision, objectives, text) + `POST /api/experiences/review/:evidenceId`. FALTA solo: nombre legible del participante en la cola (hoy userId; REVIEW-01 lo resuelve con el padrón existente, sin PII extra) y las respuestas de actividad como contexto opcional.

Ningún otro campo backend "por si acaso".

## J. Casos UX obligatorios (validados contra este diseño)

A nuevo descubre (B1→B2→iniciar) ✅ · B continúa (B7, run idempotente) ✅ · C experiencia de 6 módulos (B3 escala: lista vertical por módulo, colapso opcional en RUNTIME-01 si supera ~4 módulos) ✅ · D libro standalone en MOOK (B5 READING, visor+preflight) ✅ · E microvideo no-autónomo (C7 chip "Para Experiencias"; invisible en Biblioteca, proyectado en el nodo) ✅ · F sin entitlement (candado honesto B2/B5) ✅ · G editor crea sin JSON (C3–C10) ✅ · H crea contenido MOOK desde Subir (C8+C9) ✅ · I reordena sin drag (↑/↓) ✅ · J publica y edita (C12: nueva versión) ✅ · K mediador recibe (D2–D3) ✅ · L participante recibe feedback (D4) ✅ · M sin pendientes (E empty) ✅ · N eliminar contenido referenciado (C13) ✅.

## K. Límites y handoff

Fuera del MVP: badges/certificados, adaptive/recomendación, quiz builder, gradebook, branching visual, carruseles, autosave sofisticado, colaboración en Studio, filtros avanzados de Review. Pixel-perfect final se ejecuta en las unidades de implementación siguiendo este contrato (no existe tooling de diseño dedicado; los wireframes textuales + patrones existentes de Chibalete+ son la referencia).

### Handoff `CHP-MOOK-RUNTIME-01`
Implementar B1–B8 sobre la API existente: evolucionar la pestaña Experiencias de Biblioteca a la gramática B1 (destacada con progreso → exige `myRun` en el listado + `imageUrl/durationLabel/audience` en Experience, únicos añadidos backend), landing B2, `ModuleRoute`+`NodeShell` (evolución de los componentes actuales), completitud por tipo B5, reanudación B7, cierre B8, estados E, accesibilidad G. Sin tocar visores/Leo/preflight.

### Handoff `CHP-MOOK-STUDIO-01`
Implementar C1–C13 consumiendo las rutas admin EXISTENTES (create/draft/update/publish): acción 'experiencia' en Subir, listado C2, tabs C3, formulario C4 (+campos nuevos de Experience), editor de ruta C5–C6 con ↑/↓, `ContentPicker` C7 sobre `GET /api/content` (chip standalone), retorno C8, checkbox C9 (persistir `standalone:false` en el create de contenido), configs C10, preview C11 (frontend puro, cero eventos/runs), publish C12, guard C13 (consulta trivial sobre versiones publicadas). La autorización de Studio = mecanismo admin canónico; si producto exige mediadores-autores, eso es decisión nueva (hoy: admin).

### Handoff `CHP-MOOK-REVIEW-01`
Implementar D1–D4: pestaña "Producciones" en Aula Viva consumiendo queue/review existentes, nombre legible del participante (padrón existente), respuestas de actividad como contexto, vista del participante D4 (ya parcialmente servida por `evidence[]` de la ruta), retiro de la pestaña técnica de `/experiencias`. Scoping institucional = M1-B (frontera; sin workaround).

---

## Veredicto

**GREEN-MOOK-PRODUCT-UX** — los 14 criterios del gate se cumplen: Runtime definido de descubrimiento a cierre, integración Biblioteca cerrada, ruta/módulos/estados/progreso definidos, Studio integrado en Subir con selector sobre el catálogo canónico y contenido para Experiencias sin catálogo paralelo, preview definido sin renderer paralelo, versionado/publish UX cerrado, Review definido (ubicación: Aula Viva), responsive y accesibilidad incorporadas, contratos de datos exactos (con los 4 faltantes declarados explícitamente), y cada unidad posterior puede implementar sin inventar decisiones UX mayores.
