# CHP-WCAG-FIVE-SURFACES-01C — Cierre de los 22 P2

**Fecha:** 2026-09-10 · **Rama:** `chp/mook-contract-00` · **Baseline:** `6a10e38612bc7f84ce12a574337c10d05d7bce8e` (informes 01A y 01B en `docs/ops/`)

| Campo | Valor |
|---|---|
| Veredicto | **GREEN-WCAG-FIVE-SURFACES-REMEDIATION-COMPLETE-AND-PUBLISHED** |
| P2 | 22 `CLOSED` · 0 `OPEN` · 0 `NOT_APPLICABLE` |
| P1 (01B) | 13 siguen `CLOSED` · 0 regresiones · 0 P0 |
| `WCAG_STATUS` | **CONFORMANT_WITHIN_AUDITED_FIVE-SURFACE-SCOPE** (§7, con los límites de §8) |
| Despliegue | **Ninguno.** M5 no se declara GREEN. |

## 1. Allowlist exacta

Productivos (12, todos responsables de al menos un P2): `pages/Biblioteca.tsx`, `pages/PaginaDetalleLibro.tsx`, `pages/VisorInmersivo.tsx`, `pages/VisorTexto.tsx`, `components/LeoCompanion.tsx`, `components/ContentCard.tsx`, `pages/Experiencias.tsx`, `components/studio/ExperienceStudio.tsx`, `pages/SubirContenido.tsx`, `pages/AulaViva.tsx`, `components/review/ProduccionesTab.tsx`, `pages/AulaVivaOperacional.tsx`.

Tests existentes extendidos (4): `hooks/__tests__/useReducedMotion.structural.test.mjs` (§12), `server/__test__/mookAudioA11y.test.mjs` (Runtime/Studio), `server/__test__/mookReview01.test.mjs` (Review/Aula Viva), `server/__test__/mookContextualReturn01.test.mjs` (el encabezado del nodo pasa de `h4` a `h3`). Ningún test nuevo.

Nuevo: este documento. Sin cambios en `package.json`, workflows, configuración, rutas, permisos, contratos API ni stores.

## 2. Matriz de los 22 P2 — antes / cambio mínimo / prueba de cierre

| ID (criterio) | Antes (01A) | Cambio mínimo | Prueba (Chrome real + estructural) | Estado |
|---|---|---|---|---|
| BIBLIOTECA-03 (3.3.2) | Buscador solo con placeholder | `aria-label="Buscar título, autor o tema"` | Nombre computado presente; §12 | CLOSED |
| BIBLIOTECA-04 (3.3.2) | Textarea de reseña sin nombre | `aria-label="Tu reseña"` | Ficha: `textareaLabel = "Tu reseña"` | CLOSED |
| BIBLIOTECA-05 (1.3.1) | Ficha e Inmersivo sin landmark ni encabezado | Ficha: raíz `<main>`; Inmersivo: `role="main"` con nombre del título + `<h1 class="sr-only">` | Ficha: 1 `main`, `h1` = título; Inmersivo: `role=main` «La luciérnaga y el río», `h1` presente | CLOSED |
| BIBLIOTECA-07 (4.1.2) | Voz/oralidad/ajustes solo con `title` | `aria-label` explícitos («Leer en voz alta» / «Pausar lectura» / «Generando audio» con `aria-pressed`, «Laboratorio de oralidad (beta)») | Nombres de cabecera del Guiado: Volver, Leer en voz alta, Laboratorio de oralidad (beta), Ajustes de lectura | CLOSED |
| BIBLIOTECA-10 (2.4.3) | Al volver del visor el foco caía a `body` | La ficha envía `state.returnFocus` al abrir cada visor (`data-return-focus` en Leer ahora / Inmersivo / Guiado / Accesible); los visores lo devuelven en «Volver» (con fallback por visor); la ficha enfoca ese control al montar, una sola vez | Inmersivo → Volver: foco en «Inmersivo» `[rf=inmersivo]`; Guiado → Volver: foco en «Guiado» `[rf=guiado]` | CLOSED |
| BIBLIOTECA-11 (1.4.3) | «Para ti» 2,54:1 | `text-gray-600 dark:text-gray-300` | Computado `rgb(75,85,99)` = 7,0:1 | CLOSED |
| BIBLIOTECA-12 (2.5.8) | Enlace del título 136×19 | `block truncate min-h-6 leading-6` | Alto medido 24 px; la portada sigue fuera del tab order (P1 intacto) | CLOSED |
| RUNTIME-01 (4.1.3) | Paso completado sin anuncio | Región `role="status" aria-live="polite"` (sr-only) que recibe «Paso completado. N de M pasos requeridos completados.» solo cuando el conteo sube | Envío del nodo PRODUCTION por teclado: «Paso completado. 2 de 2 pasos requeridos completados.» | CLOSED |
| RUNTIME-02 (1.4.3) | Migas y contador 2,54:1 | `text-gray-600 dark:text-gray-400` (contador válido `text-emerald-700`) | Computados `rgb(75,85,99)` | CLOSED |
| RUNTIME-03 (2.5.8) | «← Biblioteca» 76×20 | `inline-flex items-center min-h-6` (3 ocurrencias) | Alto medido 24 px | CLOSED |
| RUNTIME-04 (1.3.1) | Sin H1; H2→H3→H4 | Título de ruta/landing/cierre `h1`, módulo `h2`, nodo `h3` (sigue enfocable; selector de foco actualizado) | Encabezados: H1 «Experiencia de prueba…», H2 «Módulo único», H3 «Escribe tu propio final»; cierre H1 | CLOSED |
| STUDIO-02 (1.4.3) | Tipo de nodo 2,43:1; «Plantilla sugerida» 2,54:1; «Sin cubierta» y «Archivar» 4,39:1 | `text-gray-600` (tipo, plantilla, sin cubierta) y `text-gray-700` (Archivar del listado) | Computados `rgb(75,85,99)` y Archivar `rgb(55,65,81)` sobre `rgb(243,244,246)` = 8,6:1 | CLOSED |
| STUDIO-04 (2.5.8) | «Añadir objetivo» 120×20 | `min-h-6` | Alto medido 24 px | CLOSED |
| STUDIO-05 (4.1.2 / 1.4.1) | Tarjetas de modo sin estado | `aria-pressed={uploadMode === …}` en las 4 | «Crear Nueva Obra=true» al inicio; «Crear / editar=true» tras seleccionar Studio | CLOSED |
| STUDIO-07 (2.1.1, patrón tablist) | Flechas no navegaban; cada pestaña era tab-stop | `tabIndex` itinerante (solo la activa es 0) + `onKeyDown` en el `tablist`: ←/→ circulares, Inicio, Fin mueven foco y selección | ArrowRight: foco y selección en «Ruta»; End/Home/ArrowLeft: «Publicación»; Tab sale del tablist al primer control del panel | CLOSED |
| REVIEW-02 (2.1.1) | Escape no cerraba | Ya resuelto por REVIEW-01 en 01B; se verifica formalmente | Escape cierra y el foco vuelve a «Revisar»; aserción estructural en `mookReview01` | CLOSED |
| REVIEW-03 (4.1.2 / 1.4.1) | Pestañas de Aula Viva sin estado | `type="button"` + `aria-pressed={activeTab === …}` | «Analítica=true» al cargar; «Producciones=true» tras activar | CLOSED |
| REVIEW-04 (3.3.2) | Selectores de institución y grupo sin nombre | `aria-label="Institución"` / `"Grupo"` | Nombres computados presentes | CLOSED |
| REVIEW-05 (1.4.3) | «Entregada», fecha, «Versión N · vigente», historial, nota final 2,54:1; «Inst.» 4,39:1 | `text-gray-600 dark:text-gray-400` en Producciones; «Inst.» `text-gray-600 dark:text-gray-300` | Computados `rgb(75,85,99)`; sin `text-xs text-gray-400` restante en el componente | CLOSED |
| AULAVIVA-01 (4.1.2) | Lector seleccionado sin estado | `aria-pressed={selectedStudent === item.user_id}` | `false` → `true` tras Enter | CLOSED |
| AULAVIVA-02 (4.1.3) | Cambio de lector sin anuncio | Región `role="status"` (sr-only) alimentada al cargar el timeline | «Lector P1 seleccionado. Recomendaciones y timeline cargados.»; sección Experiencias presente | CLOSED |
| AULAVIVA-03 (1.4.3) | Pie 2,43:1; «operacional» 3,61:1 | `text-gray-600` y `text-emerald-700` | Computados `rgb(75,85,99)` y `rgb(4,120,87)` | CLOSED |

## 3. Retorno de foco desde los visores (BIBLIOTECA-10)

Sin gestor global: el estado de navegación de React Router lleva `returnFocus` desde la ficha al visor y de vuelta. La ficha marca sus cuatro controles con `data-return-focus` y, al montar con el contenido cargado, enfoca el que coincide (una sola vez, `useRef`). Si un visor se abre por otro camino (deep link, MOOK), el fallback devuelve el foco al botón del propio visor («Inmersivo» o «Guiado»). Verificado por teclado en ambos visores.

## 4. Semántica, contraste y targets

- HTML nativo antes que ARIA: `<main>` en la ficha; `h1/h2/h3` reales en Runtime; `aria-pressed` solo donde el botón nativo no expresa estado; `role="main"` en el Inmersivo únicamente porque su raíz de 3.200 líneas no podía cambiar de etiqueta con seguridad.
- Contrastes verificados por cálculo (Tailwind v3) en §12 del test estructural y por color computado en Chrome: gray-600 sobre blanco/gray-50/indigo-50 ≥ 7:1, gray-700 sobre gray-100 8,6:1, emerald-700 sobre gray-50 5,3:1.
- Targets: enlace de título de tarjeta, «← Biblioteca» y «Añadir objetivo» a 24 px sin cambiar su apariencia.

## 5. Permanencia de los 13 P1 (01B)

Re-verificados en Chrome durante esta unidad: enlace de salto como primer control (Biblioteca), títulos por ruta (todas las vistas recorridas), diálogo de Leo (semántica, foco, Escape), modal de Review (foco contenido, Escape, retorno a «Revisar»), nombres de los botones del Inmersivo y del Guiado, labels de Subir (14 controles, 0 sin etiqueta), foco al `h2` tras Editar (implícito al recorrer el editor por teclado). Cubiertos por lock-in estructural (§11 y §12, `mookAudioA11y`, `mookReview01`): anillo de foco de chips, `aria-pressed` de chips, portada fuera del tab order, FAB nombrado, relleno bajo el FAB, panel de ajustes del Guiado, contraste de «Crear nueva versión». Resultado: 13/13 `CLOSED`, 0 regresiones.

## 6. Cinco flujos en Chrome (entorno hermético de 01A: stores, fixtures y micro-proxy solo en scratchpad; roles ADM / P1 / MED1; apagado al terminar)

| Superficie | Flujo | Teclado | Foco (visible, orden, retorno) | Nombre/rol/estado | Encabezados/landmarks | Contraste/targets | Funcional |
|---|---|---|---|---|---|---|---|
| Biblioteca | catálogo → ficha → Inmersivo → Volver → Guiado → Volver → Leo | ✔ | ✔ retorno al control de origen en ambos visores | ✔ | ✔ `main` + `h1` en ficha e Inmersivo | ✔ | ✔ |
| Runtime | recorrido y envío del nodo PRODUCTION por teclado hasta el cierre | ✔ | ✔ | ✔ anuncio de avance | ✔ h1→h2→h3 | ✔ | ✔ (experiencia completada) |
| Studio | Subir → Studio → Editar → Información → Ruta por flechas | ✔ | ✔ | ✔ `aria-pressed` en tarjetas; tablist itinerante | ✔ | ✔ | ✔ |
| Review | Producciones → Revisar → Escape | ✔ | ✔ retorno a «Revisar» | ✔ pestañas y selectores nombrados | ✔ | ✔ | ✔ |
| Aula Viva | operacional → P1 → timeline → Experiencias | ✔ | ✔ | ✔ `aria-pressed` + anuncio | ✔ | ✔ | ✔ |

Reflow 320/479 px y zoom 200 %: los cambios de esta unidad no alteran layout (clases de color, atributos ARIA, alturas mínimas de 24 px y regiones `sr-only`); se conservan los resultados de 01B (sin scroll horizontal, sin superposición del FAB). Observación no incluida en los informes previos y no tratada (baranda 8): al completar la experiencia el foco cae a `body` cuando el nodo se desmonta y aparece el cierre.

## 7. Estado WCAG

Con los 35 hallazgos de 01A cerrados (13 P1 en 01B, 22 P2 aquí) y sin otros incumplimientos observados dentro de los 37 criterios auditados en 01A sobre los cinco flujos, se registra:

`WCAG_STATUS: CONFORMANT_WITHIN_AUDITED_FIVE-SURFACE-SCOPE`

Matriz final por criterio: los 15 criterios que 01A marcaba con incumplimiento (1.3.1, 1.3.2, 1.4.1, 1.4.3, 1.4.10, 1.4.11, 2.1.1, 2.2.1, 2.4.1, 2.4.2, 2.4.3, 2.4.4, 2.4.7, 2.4.11, 2.5.8, 3.3.2, 4.1.2, 4.1.3) pasan a ✔ en las cinco superficies; los 14 sin incumplimiento se mantienen; los 8 no aplicables siguen sin observarse (1.3.5, 1.4.12, 1.4.13, 3.3.1 fuera de Studio, 3.3.7, 3.3.8, 2.5.7 fuera de Studio).

## 8. Límites explícitos del alcance

No cubre: PDF/EPUB ni Modo Álbum/Accesible; contenidos editoriales; Android LU; cumplimiento integral EN 301 549; privacidad, seguridad o AI Act; M5 completo; login/registro; pestaña Institucional de Aula Viva; ContentPicker de Studio; lector de pantalla real (verificación por DOM/ARIA y teclado); zoom del navegador emulado por viewport equivalente; contraste sobre gradientes juzgado visualmente.

## 9. Pruebas

| Suite | Resultado |
|---|---|
| `useReducedMotion.structural` (§11 + §12) | 104/104 |
| `mookAudioA11y` (+2 P2) · `mookReview01` (+1 P2) · `mookContextualReturn01` (regex h3) · `npm run test:mook` completo · `npm run test:library` | verde |
| `aulaVivaOperational` 51/51 · `aulaVivaInstitutional` 44/44 · `LongitudinalStudentTimeline.structural` 71/71 · `insightMaterializer` 62/62 · `longitudinalSummary` 102/102 · `VisorInmersivoV2` | verde |
| `npm run build` · `npm run typecheck:baseline` · `npm run lint:evidence` · `git diff --check` | verde |

## 10. Cero producción

Sin SSH, Docker, deploy, flags ni stores reales (mtimes intactos). Untracked y stashes preservados. Fixtures, proxy, logs y capturas solo en el scratchpad. Router institucional cookie-only no tocado.
