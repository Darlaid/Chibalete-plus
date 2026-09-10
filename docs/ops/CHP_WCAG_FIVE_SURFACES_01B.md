# CHP-WCAG-FIVE-SURFACES-01B — Cierre de los 13 P1

**Fecha:** 2026-09-10 · **Rama:** `chp/mook-contract-00` · **Baseline:** `deffc9828fca6f69f9827c5e86908836b0d4bde1` (informe 01A: `docs/ops/CHP_WCAG_FIVE_SURFACES_01A.md`)

| Campo | Valor |
|---|---|
| Veredicto | **GREEN-WCAG-FIVE-SURFACES-P1-CLOSED-AND-PUBLISHED** |
| P1 | 13 `CLOSED` · 0 `OPEN` · 0 `REGRESSED` |
| Despliegue | **Ninguno.** Cambio local publicado en la rama; producción y flags intactos. |
| M5 | No se declara GREEN: quedan P2 (§6). |

## 1. Allowlist exacta

Productivos (12 del informe 01A §10): `components/Layout.tsx`, `components/Navbar.tsx`, `components/Chatbot.tsx`, `App.tsx`, `pages/Biblioteca.tsx`, `components/ContentCard.tsx`, `pages/VisorInmersivo.tsx`, `pages/VisorTexto.tsx`, `components/LeoCompanion.tsx`, `components/studio/ExperienceStudio.tsx`, `pages/SubirContenido.tsx`, `components/review/ProduccionesTab.tsx`.

Tests existentes extendidos (3): `hooks/__tests__/useReducedMotion.structural.test.mjs` (sección 11: lock-in transversal y de Biblioteca), `server/__test__/mookAudioA11y.test.mjs` (Studio), `server/__test__/mookReview01.test.mjs` (Review).

Nuevo: este documento. Sin cambios en `package.json`, workflows, configuración, rutas, permisos, datos ni stores.

## 2. Matriz de los 13 P1 — antes / después / prueba de cierre

| ID | Antes (01A) | Cambio mínimo | Prueba de cierre (Chrome real + estructural) | Estado |
|---|---|---|---|---|
| LAYOUT-01 (2.4.1) | 17 enlaces de nav antes del contenido, sin salto | `Layout.tsx`: `<a href="#contenido-principal">Saltar al contenido principal</a>` como primer control, `sr-only` hasta recibir foco, `onClick` que enfoca `<main id="contenido-principal" tabIndex={-1}>` (HashRouter no navega) | Primer Tab desde el inicio = el enlace, visible (fijo arriba-izquierda, blanco sobre índigo-700); Enter → foco en `main`; siguiente Tab = primer control del contenido («CREAR CLUB» en Inicio). Estructural §11. | CLOSED |
| LAYOUT-02 (2.4.2) | `document.title` siempre «Chibalete+» | `App.tsx`: `RouteTitle` (`useLocation` + `useEffect`) con tabla `ROUTE_TITLES` | Títulos observados: «Inicio», «Biblioteca», «Ficha de contenido», «Lectura», «Experiencia», «Gestor de contenido», «Aula Viva», «Aula Viva — Centro operativo», todos con sufijo «— Chibalete+». Estructural: cinco rutas → cinco títulos distintos. | CLOSED |
| LAYOUT-03 (4.1.2) | FAB de Leo con nombre «crab» (span `role=img`) | `Chatbot.tsx`: `aria-label="Abrir chat con Leo"`, imagen decorativa (`alt=""`, span `aria-hidden`) | Nombre computado «Abrir chat con Leo» en las cinco superficies. | CLOSED |
| LAYOUT-04 (1.4.10 / 2.4.11) | FAB tapa controles al pie a 320 px | `Layout.tsx`: `main` con `pb-40 md:pb-24` (reserva el alto del FAB); `ProduccionesTab.tsx`: overlay del modal con `pb-28 sm:pb-4` | A 320 px, con el contenido desplazado al final: Runtime («Enviar producción», Atrás/Adelantar), Studio («Quitar objetivo 2» llevado al borde inferior), Review (textarea y tres botones del modal), Aula Viva (pie de estado) sin intersección con el rectángulo del FAB. Sin scroll horizontal. | CLOSED |
| LAYOUT-06 (2.4.7 / 1.4.11) | Foco de chips `outline` blanco sobre blanco | `Biblioteca.tsx`: `focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2` | Tab a «Libros» y «Experiencias»: `box-shadow` = offset blanco 2 px + anillo `rgb(67,56,202)` 4 px, visible en captura; 8,4:1 sobre blanco. | CLOSED |
| BIBLIOTECA-01 (4.1.2 / 1.4.1) | Chips sin estado | `Biblioteca.tsx`: `type="button"` + `aria-pressed={activeTab === tab}` | «Libros=true», los demás `false`. | CLOSED |
| BIBLIOTECA-02 (2.4.4 / 4.1.2) | Portada = enlace sin nombre duplicado | `ContentCard.tsx`: enlace de portada `tabIndex={-1} aria-hidden="true"`; el título conserva el enlace nombrado | Tabulación: un solo paso por tarjeta («La luciérnaga y el río»). | CLOSED |
| BIBLIOTECA-06 (4.1.2) | 5 botones sin nombre en Inmersivo | `VisorInmersivo.tsx`: `aria-label` «Ajustes de lectura» (+`aria-expanded`), «Frase anterior», «Frase siguiente», «Aumentar velocidad», «Reducir velocidad» | Inmersivo: 0 botones sin nombre. | CLOSED |
| BIBLIOTECA-08 (4.1.2 / 2.1.1 / 2.4.3) | Panel de ajustes sin diálogo, sin foco, sin Escape, botones +/− sin nombre | `VisorTexto.tsx`: panel `role="dialog" aria-label="Ajustes de lectura"` con `tabIndex={-1}`, foco al abrir, ciclo Tab/Shift+Tab, Escape cierra y devuelve el foco al disparador (`aria-expanded`/`aria-controls`); `aria-label` en tamaño de fuente y velocidad de voz | Enter en «Ajustes de lectura» → foco en el diálogo; 25 Tab siguen dentro; Shift+Tab desde el primero va al último («Visualizador Galería»); Escape cierra y el foco vuelve a «Ajustes de lectura»; 0 botones sin nombre dentro. | CLOSED |
| BIBLIOTECA-09 (4.1.2 / 2.4.3 / 2.2.1) | Modal de Leo sin diálogo, sin foco, sin Escape, cierre sin nombre | `LeoCompanion.tsx`: `role="dialog" aria-modal="true" aria-labelledby="leo-companion-title"`, foco inicial, ciclo Tab/Shift+Tab, Escape → `onClose`, «Cerrar» nombrado, restauración del foco al disparador capturado en el primer render (si el botón se re-monta, se localiza por `title`/`aria-label` tras el commit) | Abierto por teclado desde «Pregúntale a Leo»: foco en el diálogo; 9 Tab / 12 Shift+Tab dentro; Escape cierra y el foco vuelve a «Pregúntale a Leo» (también al cerrar con el botón «Cerrar»). Modal por inactividad («Llevo un rato en la misma parte…»): mismo diálogo, foco dentro, Escape cierra; sin disparador → el foco queda en `body` (no hay control de origen). | CLOSED |
| STUDIO-01 (1.4.3) | «Crear nueva versión» 3,19:1 | `ExperienceStudio.tsx`: `bg-amber-600` → `bg-amber-700` en ambos botones | Computado `rgb(180,83,9)` con texto blanco = 5,0:1. Estructural en `mookAudioA11y`. | CLOSED |
| STUDIO-06 (1.3.1 / 3.3.2) | Formulario de Subir sin `label` asociado | `SubirContenido.tsx`: 12 pares `htmlFor`/`id` (`sc-tipo`, `sc-titulo`, `sc-autor`, `sc-descripcion`, `sc-etiquetas`, `sc-biografia`, `sc-portada`, `sc-recurso`, `sc-texto-es`, `sc-texto-en`, `sc-texto-pt`, `sc-ilustraciones`) | 14 controles visibles, 0 sin etiqueta; los 12 `for` resuelven a su `id`. | CLOSED |
| REVIEW-01 (2.4.3 / 1.3.2) | El foco salía del modal a la nav cubierta | `ProduccionesTab.tsx`: `onKeyDown` en el diálogo con ciclo Tab/Shift+Tab y Escape → `closeDetail()` (que ya devolvía el foco a «Revisar») | 14 Tab y 16 Shift+Tab permanecen dentro; Escape cierra y el foco vuelve a «Revisar». Estructural en `mookReview01`. | CLOSED |

## 3. Navegación, títulos y foco

- Enlace de salto único, primer control enfocable, oculto fuera de foco, destino `main` existente (`tabIndex=-1`, sin outline). Verificado en Inicio y Biblioteca.
- Títulos estables por ruta con el enrutamiento existente (`useLocation`), sin librería.
- Foco de chips con anillo índigo-700 y offset blanco (≥ 3:1). Nota de método: `transition-all` retrasa el `box-shadow` ~200 ms; las lecturas se toman tras esperar.
- Foco tras «Editar» en Studio: al pasar a `view === 'editor'` el `h2` «Editar: …» (`tabIndex=-1`) recibe el foco (contrato §2, cierra también STUDIO-03).

## 4. Modales y restauración de foco

- Review, panel de ajustes del Modo Guiado y modal de Leo: semántica de diálogo, nombre, foco inicial en el contenedor, contención Tab/Shift+Tab, Escape y retorno al disparador. Sin gestor global: tres implementaciones locales de ~12 líneas.
- Retorno desde los visores a la ficha (BIBLIOTECA-10, P2 en 01A): **no abordado**. El control que abre el visor vive en `pages/PaginaDetalleLibro.tsx` / `components/ContentRouter.tsx`, fuera de la allowlist congelada; aplicar el contrato de §2 «Restauración del foco» para este caso habría exigido un archivo productivo adicional. Queda como P2 para la unidad siguiente.

## 5. Leo en viewport estrecho y contraste

- LAYOUT-04 resuelto con CSS mínimo: relleno inferior de `main` (160 px móvil / 96 px escritorio) y del overlay del modal de Review (112 px < 640 px). El FAB no cambia de posición ni de tamaño; en escritorio el comportamiento es el mismo con 96 px de margen final.
- Contraste corregido: `bg-amber-700` (5,0:1 con blanco), anillo `indigo-700` (8,4:1), enlace de salto blanco sobre `indigo-700`. Incidental: rótulo «Gestión» de la barra lateral `text-gray-400` → `text-gray-600 dark:text-gray-300` (LAYOUT-05, P2), una sola clase en un archivo de la allowlist.

## 6. P2 incidentales y P2 restantes

Cerrados de forma incidental por la misma línea o clase: **STUDIO-03** (foco tras Editar) y **LAYOUT-05** («Gestión»).

Restantes (22): BIBLIOTECA-03, 04, 05, 07, 10, 11, 12 · RUNTIME-01, 02, 03, 04 · STUDIO-02, 04, 05, 07 · REVIEW-02 (cerrado de hecho por REVIEW-01: Escape ya cierra; se mantiene listado hasta su verificación formal), 03, 04, 05 · AULAVIVA-01, 02, 03. Ninguno bloquea un flujo esencial.

## 7. Revalidación de las cinco superficies (Chrome real, entorno hermético de 01A)

| Superficie | Rol | Teclado completo | Foco visible | 320 px | 479 px (≙ 200 %) | Leo sin superposición | Regresiones |
|---|---|---|---|---|---|---|---|
| Biblioteca (catálogo → ficha → Inmersivo → Guiado) | ADM | ✔ salto, chips, tarjeta, ficha, visores, panel de ajustes, modal de Leo | ✔ | ✔ sin hScroll | ✔ | ✔ | ninguna |
| Runtime MOOK | P1 | ✔ (nodo PRODUCTION alcanzable; título «Experiencia — Chibalete+») | ✔ | ✔ sin hScroll; «Enviar producción» y Atrás/Adelantar libres | ✔ | ✔ | ninguna |
| Studio (Subir → Studio → Editar → Ruta) | ADM | ✔ Editar por teclado, foco al `h2`, pestañas | ✔ | ✔ sin hScroll; «Quitar objetivo 2» libre al borde inferior | — (probado en 01A) | ✔ | ninguna (labels no alteran el estado del formulario) |
| Review (Producciones → Revisar) | ADM | ✔ modal contenido, Escape, retorno a «Revisar» | ✔ | ✔ modal con scroll interno; textarea y tres botones libres | — | ✔ | ninguna |
| Aula Viva operacional (P1 → timeline → Experiencias) | MED1 | ✔ selección por Enter; sección Experiencias con 5 filas | ✔ | ✔ sin hScroll; pie de estado libre | — | ✔ | ninguna |

Zoom 200 %: emulado con viewport de 479 px (misma equivalencia que en 01A) en Biblioteca y Runtime, sin pérdida ni scroll horizontal.

## 8. Pruebas ejecutadas

| Suite | Resultado |
|---|---|
| `useReducedMotion.structural` (+§11, 43 comprobaciones nuevas) | 79/79 |
| `mookAudioA11y` (+2) · `mookReview01` (+1) · `npm run test:mook` completo | verde |
| `aulaVivaOperational` 51/51 · `aulaVivaInstitutional` 44/44 · `LongitudinalStudentTimeline.structural` 71/71 · `insightMaterializer` 62/62 · `longitudinalSummary` 102/102 · `VisorInmersivoV2` · `test:library` | verde |
| `npm run build` · `npm run typecheck:baseline` · `npm run lint:evidence` · `git diff --check` | verde |

Cobertura de los 13 puntos obligatorios de §4 del brief: 1–2 (salto y destino: §11 + Chrome), 3 (títulos: §11 + Chrome), 4 (foco de chips: §11 + captura), 5–8 (tres diálogos: §11, `mookReview01`, Chrome), 9 (retorno desde visores: **no cubierto**, ver §4), 10 (Editar: `mookAudioA11y` + Chrome), 11 (Leo a 320 px: Chrome en cuatro superficies), 12 (contraste: cálculo en §11), 13 (permisos y flujos: suites funcionales intactas).

## 9. Efectos fuera de alcance

Ninguno. Sin SSH, Docker, deploy ni flags. Stores reales con mtimes intactos. Untracked y stashes preservados. Capturas y fixtures solo en el scratchpad. El router institucional cookie-only no se tocó.
