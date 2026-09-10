# CHP-WCAG-FIVE-SURFACES-01A — Auditoría local reproducible (WCAG 2.2 AA)

**Fecha:** 2026-09-10 · **Rama:** `chp/mook-contract-00` · **Baseline auditada:** `c6d823946807e4aa34113d37b1ac282555858ae1`

| Campo | Valor |
|---|---|
| `AUDIT_EXECUTION` | **COMPLETE** — las cinco superficies se renderizaron en local y se probaron con teclado, inspección estructural y comprobación visual |
| `WCAG_STATUS` | **REMEDIATION_REQUIRED** |
| Alcance | Biblioteca · Runtime MOOK · Studio · Review · Aula Viva (cinco interfaces web; no se auditan PDF/EPUB/audio ni materiales editoriales) |
| Efecto sobre código | Ninguno. Esta unidad solo documenta. |

Este documento certifica que la auditoría quedó **completa**, no que las superficies sean conformes. No declara M5 GREEN: es un insumo.

---

## 1. Baseline

- HEAD exacto `c6d823946807e4aa34113d37b1ac282555858ae1`, igual a `origin/chp/mook-contract-00` por `git ls-remote` (sin fetch).
- Tracked limpio; tres stashes intactos; cinco untracked preservados sin abrir (`ESTÁS AQUÍ - …/`, `Programa integral/`, tres `__pycache__/` bajo `ops/backup/CHP-BACKUP-01B/`).
- Único cambio tracked de la unidad: este documento.

## 2. Metodología

### 2.1 Entorno local hermético (mecanismos existentes, cero stores reales)

- Backend real (`server/server.js`) arrancado con la misma receta que el harness hermético de `server/__test__/contentStoreRmwConcurrency.test.mjs`: `NODE_ENV=test`, `PORT=3010`, `SESSION_AUTH_MODE=off`, `CHP_DATA_DIR`, `USERS_DB`, `GROUPS_DB`, `SCHOOLS_DB`, `ACCESS_DB`, `CONTENT_DB`, `UPLOADS_ROOT`, `USER_AUDIT_DB`, `EVENTS_SQLITE_PATH`, `INSIGHTS_SQLITE_PATH`, `ARCHIVE_SQLITE_PATH`, `PROGRESS_SQLITE_PATH` apuntando a un directorio del scratchpad de sesión. Sin claves de IA. `data/`, `data-critical/` y `uploads/` reales no se leyeron ni modificaron (mtimes verificados antes y después).
- Fixtures sintéticos generados con los módulos existentes `server/lib/experienceStore.js` (experiencia publicada v1 con nodos ACTIVITY + PRODUCTION, run de una lectora sin envíos, run de un lector con dos evidencias) y `server/db/insightsDbExt.mjs` (perfil y `signal_snapshots` de la lectora, incluidas tres de las cinco señales de Experiencias). Padrón sintético: `ADM` (administrador), `MED1` (mediador), `P1`/`P2` (lectores) en el grupo `G1` de la organización `org-fx`. Un contenido `libro` de texto plano.
- Identidad en el navegador: el frontend es cookie-only y en Windows la emisión de sesión firmada no es posible (`server/lib/secretFile.js` exige `O_NOFOLLOW`/`getuid`). Se usó el contrato dev histórico `x-user-id` con `SESSION_AUTH_MODE=off` mediante un micro-proxy de scratchpad (`:3000 → :3010`) conmutable por actor; Vite (`:5173`) proxya `/api` y `/uploads` a `:3000` según `vite.config.ts`. Nada de esto entró al repositorio.
- Navegador: Chrome (extensión Claude in Chrome) sobre `http://localhost:5173`, ventana 958×944 (luego 958×888). Sin instalar extensiones ni scanners.
- Entorno apagado al terminar; artefactos (fixtures, logs, notas) permanecen en el scratchpad.

### 2.2 Procedimiento por superficie

1. **Estructura y nombres** (script de inspección ejecutado en la página, sin dependencias): `title`, `lang`, landmarks, jerarquía de encabezados, controles sin nombre accesible, campos sin label programático, objetivos < 24×24 CSS px, `tabindex` positivos, diálogos (`role=dialog`/`aria-modal`), regiones vivas, animaciones activas, reglas `prefers-reduced-motion` en las hojas de estilo, contraste de nodos de texto sobre fondos sólidos (los fondos con gradiente se evaluaron visualmente).
2. **Teclado real**: `Tab`/`Shift+Tab` con lectura del elemento activo y de su indicador de foco (outline/box-shadow computados) en cada paso, `Enter`/`Space` sobre controles, `Escape` en overlays, retorno de foco tras cerrar, ausencia de trampas, acceso a todas las acciones esenciales del flujo.
3. **Percepción y presentación**: capturas a 958 px; reflow a **320 CSS px** y a **479 CSS px** (equivalente a zoom 200 % sobre la ventana de 958 px) mediante un `iframe` same-origin de la misma SPA (media queries reales); comprobación complementaria de "solo texto" al 200 % (`font-size` raíz al 200 %). Comprobación de `hScroll`, solapamientos y recortes.
4. **Flujo representativo** ejecutado de extremo a extremo con teclado (ver §3).

### 2.3 Límites del método

- El zoom del navegador no puede dispararse desde la automatización; se emula con viewport equivalente (479 px ≙ 200 %, 320 px ≙ 400 % sobre 1280 px), que es la equivalencia que usa 1.4.10.
- El contraste sobre gradientes (ficha de contenido, tarjeta destacada) se juzgó visualmente; los valores numéricos del informe corresponden a fondos sólidos.
- No se usó lector de pantalla; los nombres/roles se verificaron por atributos y árbol DOM.
- `prefers-reduced-motion` se verificó por presencia de reglas CSS y por ausencia de animaciones activas en las páginas; no se emuló la preferencia del sistema.

## 3. Matriz de superficies y flujos

| Superficie | Ruta local (hash router) | Componente raíz | Rol usado | Flujo ejecutado | Fixture |
|---|---|---|---|---|---|
| Biblioteca | `#/biblioteca` → `#/contenido/:id` → `#/leer/inmersivo/:id` y `#/leer/texto/:id` | `pages/Biblioteca.tsx` → `components/ContentRouter.tsx` (`pages/PaginaDetalleLibro.tsx`) → `pages/VisorInmersivo.tsx` / `pages/VisorTexto.tsx` | `ADM` (acceso `authenticated`) | Localizar el libro en el catálogo, abrir la ficha, abrir Modo Inmersivo y Modo Guiado, volver | contenido `fx-libro-01` (texto plano) |
| Runtime MOOK | `#/biblioteca` (chip Experiencias) → `#/experiencias/:experienceId` | `pages/Experiencias.tsx` (NodeShell) | `P1` lector (`authenticated`) | Abrir la destacada, responder las dos preguntas del nodo ACTIVITY con teclado, enviar, llegar al nodo PRODUCTION | experiencia publicada v1, run activa de P1 |
| Studio | `#/subir-contenido` → tarjeta «Crear / editar Experiencia» → Editar | `pages/SubirContenido.tsx` → `components/studio/ExperienceStudio.tsx` | `ADM` (acceso `admin`) | Abrir Studio, entrar a la edición de la experiencia, recorrer pestañas Información y Ruta | misma experiencia |
| Review | `#/aula-viva` → pestaña Producciones → Revisar | `pages/AulaViva.tsx` → `components/review/ProduccionesTab.tsx` | `ADM` (mediador queda gateado por M1-B) | Abrir la entrega de P2 y sus controles (comentario, Enviar retroalimentación, Solicitar ajustes, Marcar como revisada), cerrar | evidencias de P2 |
| Aula Viva | `#/aula-viva/operacional` | `pages/AulaVivaOperacional.tsx` → `components/aula-viva/LongitudinalStudentTimeline.tsx` | `MED1` mediador (`authenticated` + scope CIS) | Seleccionar a P1 en la cola de atención, abrir el timeline y la sección Experiencias | perfil + snapshots de P1 |

Elementos compartidos evaluados en cada superficie: barra lateral/`Navbar` (`components/Navbar.tsx`), barra inferior móvil, botón flotante de Leo (`components/Chatbot.tsx`), compañero Leo en visores (`components/LeoCompanion.tsx`).

## 4. Resultados de teclado

| Superficie | Acceso Tab/Shift+Tab | Orden de foco | Foco visible | Enter/Space | Escape | Trampas | Retorno de foco | Acciones esenciales sin ratón |
|---|---|---|---|---|---|---|---|---|
| Biblioteca | Sí | Coherente; 17 enlaces de nav antes del `main` sin enlace de salto; cada tarjeta = 2 paradas (portada sin nombre + título) | Nav: anillo índigo. Chips y botones de la ficha: `outline: auto 3px` **blanco** (sobre fondo blanco en chips → indicador no perceptible; sobre fondo oscuro en la ficha → visible). Tarjeta y visores: outline por defecto 1 px | Sí | Panel «Ajustes de Lectura» (Guiado) y modal de Leo por inactividad **no cierran con Escape** | No hay trampa, pero el modal de Leo no captura el foco | Al volver del visor a la ficha el foco cae a `body` | Sí |
| Runtime | Sí | Coherente | Anillo índigo en el H4 del nodo; outline por defecto en textareas y botones | Sí (Enviar respuestas) | n/a (sin overlays) | No | Tras enviar, el foco pasa al encabezado del siguiente nodo (correcto) | Sí |
| Studio | Sí | Coherente; tras «Editar» el foco cae a `body` | Outline por defecto | Space/Enter activan pestañas; flechas no navegan el `tablist` | n/a | No | Ver orden | Sí (Información editable; Ruta exige nueva versión — comportamiento de dominio) |
| Review | Sí | Coherente hasta abrir el modal | Outline por defecto; «Cerrar detalle» con nombre | Sí | **Escape no cierra el modal** (con foco dentro o fuera) | **El foco sale del modal** hacia la navegación cubierta (12 Tab llegan a «Multimedia»); fondo sin `inert`/`aria-hidden` | No verificable (cierre solo por botón) | Sí |
| Aula Viva | Sí | Coherente; `tablist` Operativo/Institucional con `aria-selected` | Outline por defecto sobre la tarjeta de P1 | Sí | n/a | No | El foco permanece en la tarjeta seleccionada (aceptable) | Sí |

## 5. Resultados visuales, contraste y reflow

| Superficie | 320 px | 479 px (≙ 200 %) | Solo texto 200 % | Contraste (fondos sólidos) | Objetivos < 24 px | Movimiento |
|---|---|---|---|---|---|---|
| Biblioteca | Sin scroll horizontal; barra inferior móvil; fila de chips con scroll interno | Sin pérdida | Las tarjetas colapsan (portada reducida, título recortado a una letra) — observación, no equivalente a zoom de navegador | «Gestión» 2.54:1 (12 px); «Para ti» 2.54:1 (10 px, Guiado) | Enlace de título de tarjeta 136×19 | 0 animaciones activas; reglas `prefers-reduced-motion` presentes |
| Runtime | Sin scroll horizontal; **el FAB de Leo tapa «Enviar producción» y la fila Atrás/Adelantar** | Sin pérdida | Sin recortes | Migas «Experiencia · Módulo» 2.54:1; contador «0 palabras (5–60)» 2.54:1 | «← Biblioteca» 76×20 | 0 |
| Studio | Sin scroll horizontal; pestañas envuelven; **el FAB tapa «Quitar objetivo 2»** | — | — | «Crear nueva versión» blanco sobre ámbar 3.19:1 (12 px, negrita); «Actividad/Producción» 2.43:1; «Plantilla sugerida…» 2.54:1; «Sin cubierta» 4.39:1; «Archivar» 4.39:1 | «Añadir objetivo» 120×20; checkboxes de Subir 19×20 | 0 |
| Review | Modal 316 px con `overflow:auto`, sin scroll horizontal; **el FAB tapa la textarea del comentario**; la barra inferior móvil se superpone al pie del modal | — | — | Fecha/«Versión 1»/«· vigente»/nota final 2.54:1; «Inst.» 4.39:1 | — | 0 |
| Aula Viva | Sin scroll horizontal; tarjetas apiladas; el FAB tapa el pie de estado | — | — | Pie «Estado del sistema…» 2.43:1; «operacional» 3.61:1 | — | 0 |

Orientación: ninguna superficie bloquea la orientación (no hay `orientation` en media queries ni bloqueo por script). Imágenes: no se detectaron `<img>` sin `alt`; los iconos SVG dentro de botones o enlaces heredan el nombre del control (cuando lo hay).

## 6. Hallazgos por superficie

Formato: **ID** · criterio WCAG 2.2 (nivel) · severidad · reproducción · observado · esperado · responsable · corrección mínima.

### 6.1 Transversales (Layout, Navbar, Leo)

- **WCAG-LAYOUT-01** · 2.4.1 Evitar bloques (A) · **P1** · Cargar cualquier ruta con `Tab` desde el inicio · 17 enlaces de la barra lateral (más «Cerrar sesión») preceden al contenido; no existe enlace de salto · Un primer tab-stop «Saltar al contenido» que enfoque `main` · `components/Navbar.tsx`, `components/Layout.tsx` · Añadir un enlace visible al recibir foco que apunte a `#main`/`main[tabindex=-1]`.
- **WCAG-LAYOUT-02** · 2.4.2 Título de página (A) · **P1** · Navegar entre `#/biblioteca`, `#/experiencias/:id`, `#/subir-contenido`, `#/aula-viva/operacional` · `document.title` es siempre «Chibalete+» · Título por vista («Biblioteca — Chibalete+», etc.) · `App.tsx` o cada página · Actualizar `document.title` en un efecto por ruta.
- **WCAG-LAYOUT-03** · 4.1.2 Nombre, rol, valor (A) · **P1** · Tab hasta el botón flotante de Leo (último control) · `<button>` sin nombre accesible (solo icono) · Nombre «Abrir a Leo» · `components/Chatbot.tsx` · `aria-label` en el botón.
- **WCAG-LAYOUT-04** · 1.4.10 Reflow (AA) + 2.4.11 Foco no oscurecido (AA) · **P1** · Cualquier superficie a 320 px con controles al pie (Runtime «Enviar producción», Studio «Quitar objetivo», Review textarea) · El FAB de Leo (fijo, ~60 px) cubre controles y su indicador de foco · El FAB no debe solapar controles interactivos · `components/Chatbot.tsx` · Reservar espacio inferior (`padding-bottom` en `main` ≥ alto del FAB) o reposicionar el FAB por encima de la barra inferior móvil.
- **WCAG-LAYOUT-05** · 1.4.3 Contraste mínimo (AA) · **P2** · Barra lateral · Rótulo «Gestión» `#9ca3af` sobre blanco, 12 px, 2.54:1 · ≥ 4.5:1 · `components/Navbar.tsx` · Usar `text-gray-600` o superior.
- **WCAG-LAYOUT-06** · 2.4.7 Foco visible (AA) + 1.4.11 Contraste no textual (AA) · **P1** · Biblioteca: Tab hasta los chips de filtro · Indicador `outline: auto 3px rgb(255,255,255)` (blanco) sobre fondo blanco/claro: el foco no es perceptible · Indicador con ≥ 3:1 contra el fondo · `pages/Biblioteca.tsx` (clases `focus:` de los chips) y regla global de foco si existe · `focus-visible:ring-2 ring-indigo-500 ring-offset-2` o `outline-color` oscuro.

### 6.2 Biblioteca

- **WCAG-BIBLIOTECA-01** · 4.1.2 (A) + 1.4.1 Uso del color (A) · **P1** · Chips Libros/Experiencias/… · `<button>` sin `aria-pressed`; la selección solo se distingue por color de fondo · `aria-pressed="true"` en el chip activo (o `role=tab`/`aria-selected`) · `pages/Biblioteca.tsx` · Añadir `aria-pressed`.
- **WCAG-BIBLIOTECA-02** · 2.4.4 Propósito del enlace (A) + 4.1.2 (A) · **P1** · Tab hasta la tarjeta · El enlace de la portada (`a.block.group.relative`) no tiene nombre accesible y duplica la parada del enlace del título · Un solo enlace nombrado por tarjeta (o portada con `aria-hidden`/`tabindex=-1`) · `components/ContentCard.tsx` · `aria-label={titulo}` en el enlace de portada o `tabIndex={-1} aria-hidden` en él.
- **WCAG-BIBLIOTECA-03** · 3.3.2 Etiquetas o instrucciones (A) + 1.3.1 (A) · **P2** · Campo de búsqueda · Solo `placeholder`, sin `label`/`aria-label` · Etiqueta programática · `pages/Biblioteca.tsx` · `aria-label="Buscar título, autor o tema"`.
- **WCAG-BIBLIOTECA-04** · 3.3.2 (A) · **P2** · Ficha: textarea de reseña · Solo `placeholder` · `label` o `aria-label` · `pages/PaginaDetalleLibro.tsx` · `aria-label="Tu reseña"`.
- **WCAG-BIBLIOTECA-05** · 1.3.1 Información y relaciones (A) · **P2** · Ficha de contenido y Modo Inmersivo · Sin landmarks (`main`) ni encabezados en el visor inmersivo · `main` y `h1` (título del libro) · `pages/PaginaDetalleLibro.tsx`, `pages/VisorInmersivo.tsx` · Envolver en `<main>` y titular.
- **WCAG-BIBLIOTECA-06** · 4.1.2 (A) · **P1** · Modo Inmersivo · Cinco botones solo-icono sin nombre: ajustes, anterior, siguiente, velocidad +, velocidad − · Nombres accesibles · `pages/VisorInmersivo.tsx` (≈ líneas 2776–3000) · `aria-label` en cada botón.
- **WCAG-BIBLIOTECA-07** · 4.1.2 (A) · **P2** · Modo Guiado · Botones «Leer en voz alta», «Laboratorio de oralidad» y «Ajustes de Lectura» solo con `title`; el segundo expone como texto únicamente «BETA» · `aria-label` explícito (el `title` no es fiable en todos los AT) · `pages/VisorTexto.tsx` (≈ 965–987) · Añadir `aria-label`.
- **WCAG-BIBLIOTECA-08** · 4.1.2 (A) + 2.1.1 Teclado (A) + 2.4.3 Orden del foco (A) · **P1** · Modo Guiado → Enter en «Ajustes de Lectura» · Se abre un panel sin `role=dialog`, el foco no entra, `Escape` no lo cierra y sus botones +/− de tamaño no tienen nombre · Panel con `role=dialog`/`aria-expanded`, foco dentro, `Escape` cierra y devuelve el foco, botones nombrados · `pages/VisorTexto.tsx` · Marcar el disparador con `aria-expanded`/`aria-controls`, mover el foco al panel, manejar `Escape`, `aria-label` en +/−.
- **WCAG-BIBLIOTECA-09** · 2.4.3 (A) + 4.1.2 (A) + 2.2.1 Tiempo ajustable (A) · **P1** · Modo Guiado, permanecer ~1 min sin interactuar · Leo abre un modal («Llevo un rato en la misma parte…») sin `role=dialog`/`aria-modal`, sin mover el foco, sin cierre por `Escape` y con botón de cierre sin nombre; cubre el texto · Interrupción anunciable y descartable con teclado, foco gestionado, o preferencia para posponer · `components/LeoCompanion.tsx` · `role=dialog`, `aria-labelledby` (H2 «Leo»), foco al abrir, `Escape` y retorno de foco, `aria-label="Cerrar"`.
- **WCAG-BIBLIOTECA-10** · 2.4.3 (A) · **P2** · Volver del visor a la ficha con «Volver a la ficha del contenido» · El foco queda en `body` · Foco al `h1` de la ficha o al botón de origen · `components/ContentRouter.tsx` / `pages/PaginaDetalleLibro.tsx` · `useEffect` que enfoque el encabezado al montar.
- **WCAG-BIBLIOTECA-11** · 1.4.3 (AA) · **P2** · Modo Guiado (panel Leo) · «Para ti» 10 px 2.54:1 · ≥ 4.5:1 · `components/LeoCompanion.tsx` · Subir color/tamaño.
- **WCAG-BIBLIOTECA-12** · 2.5.8 Tamaño del objetivo (mínimo) (AA) · **P2** · Tarjeta del catálogo · Enlace del título 136×19 (alto < 24) · ≥ 24 px de alto o separación suficiente · `components/ContentCard.tsx` · `py-1` / `min-h-6`.

### 6.3 Runtime MOOK

- **WCAG-RUNTIME-01** · 4.1.3 Mensajes de estado (AA) · **P2** · Enviar respuestas del nodo ACTIVITY · El chip «Completado» y el cambio «Por iniciar → En curso» no se anuncian (sin región viva) · `role=status` con «Paso completado» · `pages/Experiencias.tsx` (NodeShell) · Región `aria-live="polite"` que reciba el mensaje de éxito.
- **WCAG-RUNTIME-02** · 1.4.3 (AA) · **P2** · Encabezado del nodo y contador de palabras · Migas «Experiencia · Módulo» y «0 palabras (5–60)» en `text-gray-400` 2.54:1 (12 px) · ≥ 4.5:1 · `pages/Experiencias.tsx` (≈ 246, 352) · `text-gray-600`.
- **WCAG-RUNTIME-03** · 2.5.8 (AA) · **P2** · Enlace «← Biblioteca» 76×20 · Alto ≥ 24 px · `pages/Experiencias.tsx` · `inline-flex min-h-6 items-center`.
- **WCAG-RUNTIME-04** · 1.3.1 (A) · **P2** · Página de la experiencia · Jerarquía empieza en H2 (no hay H1) · Un H1 por vista · `pages/Experiencias.tsx` · Promover el título a `h1` y ajustar niveles.
- Conformes verificados: textareas con `label for`; `progressbar` con `aria-valuenow` y `aria-label`; foco gestionado al encabezado del nodo con anillo visible; `role=note` con `aria-describedby` en la nota de envío; reflow 320/479 sin pérdida (salvo LAYOUT-04).

### 6.4 Studio

- **WCAG-STUDIO-01** · 1.4.3 (AA) · **P1** · Pestaña Ruta de una versión publicada · Botón «Crear nueva versión» texto blanco sobre ámbar `#d97706`, 12 px, 3.19:1 · ≥ 4.5:1 (o ≥ 3:1 con ≥ 18.66 px negrita) · `components/studio/ExperienceStudio.tsx` · Ámbar más oscuro (`bg-amber-700`) o texto oscuro.
- **WCAG-STUDIO-02** · 1.4.3 (AA) · **P2** · Lista de nodos · Etiquetas de tipo «Actividad/Producción» 2.43:1; «Plantilla sugerida…» 2.54:1; «Sin cubierta» y «Archivar» 4.39:1 · ≥ 4.5:1 · `components/studio/ExperienceStudio.tsx` · `text-gray-600`.
- **WCAG-STUDIO-03** · 2.4.3 (A) · **P2** · Pulsar «Editar» en el listado · El foco cae a `body` porque el listado se desmonta · Foco al encabezado «Editar: …» · `components/studio/ExperienceStudio.tsx` · Enfocar el `h2` del editor al montar.
- **WCAG-STUDIO-04** · 2.5.8 (AA) · **P2** · «Añadir objetivo» 120×20 · Alto ≥ 24 px · `components/studio/ExperienceStudio.tsx` · `min-h-6`.
- **WCAG-STUDIO-05** · 4.1.2 (A) + 1.4.1 (A) · **P2** · Tarjetas de modo de `Subir` («Crear Nueva Obra», «Añadir a Existente», «Gestionar Biblioteca», «Crear / editar Experiencia») · `<button>` sin `aria-pressed`; el modo activo solo se distingue por borde/fondo · `aria-pressed` · `pages/SubirContenido.tsx` · Añadir `aria-pressed={uploadMode === …}`.
- **WCAG-STUDIO-06** · 1.3.1 (A) + 3.3.2 (A) · **P1** · Formulario principal de `Subir` (entrada a Studio) · `select` de tipo, inputs de título, autor, etiquetas, textareas de sinopsis y biografía y seis `input[file]` sin `label` asociado (texto visual no vinculado) · `label for`/`id` · `pages/SubirContenido.tsx` · Añadir `id` a cada control y `htmlFor` en su etiqueta.
- **WCAG-STUDIO-07** · 2.1.1 (A) — patrón ARIA · **P2** · `tablist` del editor · Cada pestaña es tab-stop y las flechas no mueven la selección (funciona con Tab+Enter/Space, por lo que no bloquea) · Navegación por flechas con `tabindex` gestionado · `components/studio/ExperienceStudio.tsx` · Opcional; documentar si se conserva el patrón actual.
- Conformes verificados: `role=tablist/tab` con `aria-selected`; todos los campos del editor con `label` («Título», «Descripción», «Objetivo pedagógico N»); botones «Quitar objetivo N», «Archivar <título>» nombrados; `role=note` `st-info-scope-note`; `aria-live` presente; tabla con `th`; reflow 320 sin pérdida (salvo LAYOUT-04).

### 6.5 Review

- **WCAG-REVIEW-01** · 2.4.3 Orden del foco (A) + 1.3.2 (A) · **P1** · Producciones → Revisar → pulsar Tab repetidamente · El foco abandona el `role=dialog aria-modal=true` y recorre la barra lateral cubierta por el fondo oscuro; el fondo no tiene `inert` ni `aria-hidden` · Foco contenido en el modal mientras está abierto · `components/review/ProduccionesTab.tsx` (≈ 211) · Ciclar el foco entre el primer y el último control del modal (o `inert` en el resto del documento).
- **WCAG-REVIEW-02** · 2.1.1 (A) — patrón de diálogo · **P2** · Con el modal abierto, `Escape` · No cierra (existe «Cerrar detalle» accesible, por lo que no bloquea) · `Escape` cierra y devuelve el foco a «Revisar» · `components/review/ProduccionesTab.tsx` · `onKeyDown` en el diálogo + restaurar foco al cerrar.
- **WCAG-REVIEW-03** · 4.1.2 (A) + 1.4.1 (A) · **P2** · Pestañas de Aula Viva (Analítica / Gestión de Tareas / Producciones) · `<button>` sin `aria-pressed`/`aria-current`; estado por color · `role=tab`+`aria-selected` o `aria-current` · `pages/AulaViva.tsx` (≈ 1521) · Añadir estado ARIA.
- **WCAG-REVIEW-04** · 3.3.2 (A) · **P2** · Cabecera de Aula Viva · Dos `select` (institución, grupo) sin `label` · Etiquetas programáticas · `pages/AulaViva.tsx` · `aria-label="Institución"` / «Grupo».
- **WCAG-REVIEW-05** · 1.4.3 (AA) · **P2** · Tarjeta y modal · «Entregada», fecha, «Versión 1», «· vigente», nota final «Revisar = confirmar…» 2.54:1 (12 px); «Inst.» 4.39:1 · ≥ 4.5:1 · `components/review/ProduccionesTab.tsx`, `pages/AulaViva.tsx` · `text-gray-600`.
- Conformes verificados: `role=dialog`, `aria-modal`, `aria-label`, encabezado H3 del modal, botón «Cerrar detalle», textarea «Comentario de mediación» etiquetada, filtros con `label for`, `aria-live` presente, modal con scroll interno a 320 px.

### 6.6 Aula Viva (operacional + Experiencias)

- **WCAG-AULAVIVA-01** · 4.1.2 (A) · **P2** · Cola «Estudiantes que necesitan atención hoy» · El botón del estudiante no expone estado seleccionado (`aria-pressed`) · `aria-pressed` o `aria-current="true"` · `pages/AulaVivaOperacional.tsx` (≈ 239) · Añadir `aria-pressed={selectedStudent === item.user_id}`.
- **WCAG-AULAVIVA-02** · 4.1.3 (AA) · **P2** · Seleccionar un estudiante · Aparecen «Recomendaciones: P1» y «Timeline longitudinal: P1» sin anuncio (solo `role=status` durante la carga) · Anuncio del cambio de contexto o foco al nuevo encabezado · `pages/AulaVivaOperacional.tsx` · Enfocar el `h2` del timeline al cargar o `aria-live` con «Timeline de <id> cargado».
- **WCAG-AULAVIVA-03** · 1.4.3 (AA) · **P2** · Pie de página · «Estado del sistema … última actualización» 2.43:1 (12 px); «operacional» 3.61:1 · ≥ 4.5:1 · `pages/AulaVivaOperacional.tsx` · `text-gray-600` / `text-emerald-700`.
- Conformes verificados: landmarks completos (`nav`, `main`, `header`, `footer`, `article{Timeline longitudinal del lector}`, `section{Experiencias del lector}`); H1→H2→H3; `tablist` con `aria-selected`; sección Experiencias como `ul/li` con los cinco rótulos, valores «0»/«Sin datos» y desglose por versión con `aria-label`; foco visible en la tarjeta; reflow 320 sin pérdida (salvo LAYOUT-04).

## 7. Matriz consolidada por criterio

Leyenda: ✔ cumple · ✖ incumple (ID) · — no aplicable / no observado en el flujo.

| Criterio (nivel) | Biblioteca | Runtime | Studio | Review | Aula Viva |
|---|---|---|---|---|---|
| 1.1.1 Contenido no textual (A) | ✔ (iconos en controles nombrados salvo 4.1.2) | ✔ | ✔ | ✔ | ✔ |
| 1.3.1 Información y relaciones (A) | ✖ BIBLIOTECA-05 | ✖ RUNTIME-04 | ✖ STUDIO-06 | ✔ | ✔ |
| 1.3.2 Secuencia significativa (A) | ✔ | ✔ | ✔ | ✖ REVIEW-01 | ✔ |
| 1.3.4 Orientación (AA) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 1.3.5 Identificar propósito de entrada (AA) | — | — | — | — | — |
| 1.4.1 Uso del color (A) | ✖ BIBLIOTECA-01 | ✔ | ✖ STUDIO-05 | ✖ REVIEW-03 | ✔ |
| 1.4.3 Contraste mínimo (AA) | ✖ LAYOUT-05, BIBLIOTECA-11 | ✖ RUNTIME-02 | ✖ STUDIO-01, STUDIO-02 | ✖ REVIEW-05 | ✖ AULAVIVA-03 |
| 1.4.4 Cambio de tamaño del texto (AA) | ✔ (479 px) — observación solo-texto | ✔ | ✔ | ✔ | ✔ |
| 1.4.10 Reflow (AA) | ✔ | ✖ LAYOUT-04 | ✖ LAYOUT-04 | ✖ LAYOUT-04 | ✖ LAYOUT-04 |
| 1.4.11 Contraste no textual (AA) | ✖ LAYOUT-06 | ✔ | ✔ | ✔ | ✔ |
| 1.4.12 Espaciado del texto (AA) | — | — | — | — | — |
| 1.4.13 Contenido al pasar el cursor o enfocar (AA) | — | — | — | — | — |
| 2.1.1 Teclado (A) | ✖ BIBLIOTECA-08 | ✔ | ✔ (STUDIO-07 patrón) | ✔ (REVIEW-02 patrón) | ✔ |
| 2.1.2 Sin trampas de teclado (A) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 2.2.1 Tiempo ajustable (A) | ✖ BIBLIOTECA-09 | ✔ | ✔ | ✔ | ✔ |
| 2.3.1 Umbral de destellos (A) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 2.3.3 Animación por interacción (AAA, informativo) | ✔ reglas `prefers-reduced-motion` | ✔ | ✔ | ✔ | ✔ |
| 2.4.1 Evitar bloques (A) | ✖ LAYOUT-01 | ✖ LAYOUT-01 | ✖ LAYOUT-01 | ✖ LAYOUT-01 | ✖ LAYOUT-01 |
| 2.4.2 Título de página (A) | ✖ LAYOUT-02 | ✖ LAYOUT-02 | ✖ LAYOUT-02 | ✖ LAYOUT-02 | ✖ LAYOUT-02 |
| 2.4.3 Orden del foco (A) | ✖ BIBLIOTECA-08/09/10 | ✔ | ✖ STUDIO-03 | ✖ REVIEW-01 | ✔ |
| 2.4.4 Propósito del enlace (A) | ✖ BIBLIOTECA-02 | ✔ | ✔ | ✔ | ✔ |
| 2.4.6 Encabezados y etiquetas (AA) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 2.4.7 Foco visible (AA) | ✖ LAYOUT-06 | ✔ | ✔ | ✔ | ✔ |
| 2.4.11 Foco no oscurecido (mínimo) (AA) | ✔ | ✖ LAYOUT-04 | ✖ LAYOUT-04 | ✖ LAYOUT-04 | ✖ LAYOUT-04 |
| 2.5.3 Etiqueta en el nombre (A) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 2.5.7 Movimientos de arrastre (AA) | — | — | ✔ (↑/↓ por botón) | — | — |
| 2.5.8 Tamaño del objetivo (mínimo) (AA) | ✖ BIBLIOTECA-12 | ✖ RUNTIME-03 | ✖ STUDIO-04 | ✔ | ✔ |
| 3.1.1 Idioma de la página (A) | ✔ `lang="es"` | ✔ | ✔ | ✔ | ✔ |
| 3.2.1 Al recibir el foco (A) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 3.2.2 Al introducir datos (A) | ✔ | ✔ | ✔ | ✔ | ✔ |
| 3.2.6 Ayuda consistente (A) | ✔ (FAB en posición constante) | ✔ | ✔ | ✔ | ✔ |
| 3.3.1 Identificación de errores (A) | — | — | ✔ (validación por campo) | — | — |
| 3.3.2 Etiquetas o instrucciones (A) | ✖ BIBLIOTECA-03/04 | ✔ | ✖ STUDIO-06 | ✖ REVIEW-04 | ✔ |
| 3.3.7 Entrada redundante (A) | — | — | — | — | — |
| 3.3.8 Autenticación accesible (AA) | — (login fuera del alcance) | — | — | — | — |
| 4.1.2 Nombre, rol, valor (A) | ✖ LAYOUT-03, BIBLIOTECA-01/02/06/07/08/09 | ✔ | ✖ STUDIO-05 | ✖ REVIEW-03 | ✖ AULAVIVA-01 |
| 4.1.3 Mensajes de estado (AA) | ✔ | ✖ RUNTIME-01 | ✔ | ✔ | ✖ AULAVIVA-02 |

## 8. Prioridades

| Superficie | P0 | P1 | P2 |
|---|---|---|---|
| Transversal (Layout/Leo) | 0 | 5 (LAYOUT-01, 02, 03, 04, 06) | 1 (LAYOUT-05) |
| Biblioteca | 0 | 5 (BIBLIOTECA-01, 02, 06, 08, 09) | 7 (03, 04, 05, 07, 10, 11, 12) |
| Runtime | 0 | 0 | 4 (RUNTIME-01–04) |
| Studio | 0 | 2 (STUDIO-01, 06) | 5 (02, 03, 04, 05, 07) |
| Review | 0 | 1 (REVIEW-01) | 4 (02, 03, 04, 05) |
| Aula Viva | 0 | 0 | 3 (AULAVIVA-01–03) |
| **Total** | **0** | **13** | **24** |

No hay P0: todos los flujos esenciales se completaron sin ratón. Los P1 son incumplimientos claros que dificultan seriamente el uso (nombres ausentes en controles esenciales, foco que escapa de un modal, interrupción no descartable, foco invisible, contraste de una acción primaria, ausencia de salto de bloques y de títulos de página).

Criterios evaluados: 37 · con al menos un incumplimiento: 15 · sin incumplimiento en las cinco superficies: 14 · no aplicables/no observados: 8.

## 9. Límites de la auditoría

- Sin lector de pantalla ni tecnología de asistencia real; verificación por DOM/ARIA y teclado.
- Zoom del navegador emulado por viewport equivalente (§2.3). La comprobación «solo texto 200 %» es complementaria y más estricta que 1.4.4.
- Contraste sobre gradientes y superposiciones translúcidas juzgado visualmente.
- Flujos acotados a los declarados en §3; no se auditaron el login, la pestaña Institucional de Aula Viva, la ContentPicker de Studio, «Solicitar ajustes» hasta el final (para no mutar el fixture más de lo necesario), el Modo Álbum/PDF/Accesible ni el chat de Leo.
- Entorno Windows con identidad por header dev; el comportamiento de sesión con cookie firmada no altera la accesibilidad de la UI auditada.
- La deuda del router institucional cookie-only no impidió reproducir Aula Viva (la ruta auditada es la operacional, guardada por `requireScopeAccess` con identidad de sesión) y no se registra como hallazgo WCAG.

## 10. Allowlist mínima propuesta para `CHP-WCAG-FIVE-SURFACES-01B` (P0/P1 demostrados)

| Archivo | Hallazgos que resuelve |
|---|---|
| `components/Navbar.tsx` | LAYOUT-01 (enlace de salto), LAYOUT-05 opcional |
| `components/Layout.tsx` | LAYOUT-01 (`id="main"`/`tabindex=-1` en `main`), LAYOUT-04 (espacio inferior) |
| `components/Chatbot.tsx` | LAYOUT-03 (nombre del FAB), LAYOUT-04 (posición) |
| `App.tsx` | LAYOUT-02 (`document.title` por ruta) |
| `pages/Biblioteca.tsx` | LAYOUT-06 (indicador de foco de chips), BIBLIOTECA-01 (`aria-pressed`), BIBLIOTECA-03 opcional |
| `components/ContentCard.tsx` | BIBLIOTECA-02 |
| `pages/VisorInmersivo.tsx` | BIBLIOTECA-06 |
| `pages/VisorTexto.tsx` | BIBLIOTECA-08 |
| `components/LeoCompanion.tsx` | BIBLIOTECA-09 |
| `components/studio/ExperienceStudio.tsx` | STUDIO-01 |
| `pages/SubirContenido.tsx` | STUDIO-06 |
| `components/review/ProduccionesTab.tsx` | REVIEW-01 (+ REVIEW-02 si se aprovecha el mismo cambio) |

Doce archivos para trece P1; los P2 quedan para una unidad posterior. Ninguna corrección exige dependencias, design system ni componentes generales: son atributos ARIA, `document.title`, un enlace de salto, un anillo de foco, un ciclo de foco en un modal y ajustes de color Tailwind.
