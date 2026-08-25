# CHP-MOOK-ESTAS-AQUI-02 — Cierre de audio, accesibilidad y promesa editorial

**Fecha:** 2026-08-24 · **Rama:** `chp/mook-contract-00` · **Baseline:** `37ea76c`
**Alcance:** cerrar las capacidades de audio pendientes y corregir la promesa editorial
incompatible con el MVP privado. **NO se carga el MOOK. No se despliega. Cero producción.**

## Veredicto

> ## 🟢 GREEN-AUDIO-A11Y-COPY
>
> La promesa de `T00` quedó corregida (localización **inequívoca**, una sola ocurrencia), y las
> tres capacidades de audio están cerradas y **verificadas con un audio real** en escritorio y
> 390 px: duración real desde `loadedmetadata`, estados anunciados por `aria-live` sin confundir
> pausa con final, y descarga real de la transcripción. Cero regresiones.

---

## A. Corrección editorial de T00

Localización **inequívoca**: la promesa aparecía **exactamente una vez**. No hizo falta improvisar
ninguna otra edición, de modo que no aplica `YELLOW-EDITORIAL-COPY`.

| Antes | Después |
|---|---|
| «Algunas respuestas podrán compartirse; otras serán privadas. Tú decides.» | «Todo lo que escribas en las bitácoras será privado. Solo tú podrás leerlo dentro de este recorrido. Nada se publicará automáticamente.» |

| Verificación | Resultado |
|---|---|
| SHA-256 **antes** | `344e09ce6124af5cf5a06814a11bef56444af8c67f5e63136bc080dc66e1a686` |
| SHA-256 **después** | `71ce37b29d1ab29fd8225ee56b2a5164b1d4c394dfbce672b3476c59d0bb1d16` |
| Tamaño | 2 951 → 3 016 bytes |
| Codificación | **UTF-8** sin BOM (releído y decodificado tras escribir) |
| Fin de línea | 12 CRLF conservados |
| Resto del texto | **intacto** — verificado revirtiendo el reemplazo y comparando con el original |
| Backup dentro de la carpeta | **ninguno** (la copia de seguridad vive en el scratchpad de sesión) |
| T00 en Git | **NO** — la carpeta editorial sigue untracked |

El párrafo corregido conserva su contexto: «Es una experiencia para leer y escuchar. Encontrarás
fragmentos del libro, audioensayos, una ficción sonora, preguntas y siete prácticas pequeñas.
**Todo lo que escribas en las bitácoras será privado…** No habrá una puntuación capaz de decirte
si estás suficientemente presente.»

---

## B. Duración real del audio

`NodeMediaPlayer` (nuevo, en `pages/Experiencias.tsx`) monta un `<audio>` **nativo** y lee la
duración del evento `loadedmetadata`.

| Requisito | Cómo se cumple |
|---|---|
| Duración desde el elemento nativo | `el.addEventListener('loadedmetadata', …)`; también `readyState >= 1` si ya estaba lista |
| **Sin duración duplicada** | No se persiste en `Experience`, `ExperienceVersion`, nodo ni catálogo. Cero cambios de esquema y cero escrituras |
| Formato legible | `formatAudioDuration`: `4 min 32 s`, `2 min`, `45 s`; `59,6 s` → `1 min` (el redondeo no produce «0 min 60 s») |
| Estado neutro previo | «Preparando la duración… Si puedes, escucha una sola pieza a la vez.» — **ninguna cifra** |
| Microcopia | `Este audio dura {duración}. Si puedes, escucha una sola pieza a la vez.` |
| Runtime **y** preview | Ambos montan `NodeShell`, que delega en `NodeMediaPlayer`. Un solo `<audio>` en todo el runtime MOOK; el Studio no define uno propio |

**Prohibiciones respetadas:** la duración **no** sale del filename, ni de un manifest, ni de una
estimación por número de palabras. Sale del archivo, medida por el navegador.

**Verificado con audio real:** un WAV del piloto (81,7 s) muestra **«Este audio dura 1 min 22 s»**
— coincide con la duración registrada para ese archivo en `CHP_MOOK_PILOT_01`.

---

## C. Estados de reproducción

Controles **nativos** (`controls`), `preload="metadata"`, **cero `autoplay`** y **cero playlist**.
Los estados se anuncian en una región `role="status" aria-live="polite"`.

| Momento | Anuncio |
|---|---|
| Pausa voluntaria (ya empezó y no terminó) | `Puedes continuar después. La pausa también forma parte del recorrido.` |
| Fin de la pieza | `No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.` |
| Carga inicial, navegación, final, desmontaje | **nada** |

**Cómo se evita el falso «pausa»** — los navegadores emiten `pause` también al terminar y al
descartar el elemento:

- `if (el.ended || el.currentTime <= 0) return;` descarta el final y el «nunca empezó».
- Al desmontar, los listeners se retiran **antes** de que el navegador pause el elemento.
- `play` limpia el aviso, así que no se acumulan mensajes repetidos.

**No se implementó** playlist, reproducción siguiente ni seguimiento fino de segundos: `onEnded`
solo anuncia — no llama a `play()`, no cambia `src` y no abre nada.

---

## D. Descarga real de la transcripción

| Requisito | Implementación |
|---|---|
| Reutiliza exactamente `config.transcripcion` | `downloadTranscript(node.config.transcripcion, node.title)` |
| Archivo cliente UTF-8 `text/plain` | `new Blob([texto], { type: 'text/plain;charset=utf-8' })` |
| Nombre derivado del título y saneado | `transcriptFilename`: sin diacríticos, sin separadores de ruta, minúsculas, acotado a 80 |
| Extensión `.txt` | siempre; respaldo `transcripcion.txt` si el título no deja alfanuméricos |
| Saltos de línea y voces | el texto va **tal cual**, sin transformar |
| Sin endpoint / sin copia en uploads | todo ocurre en el navegador |
| Sin analytics ni texto en eventos | la utilidad no importa transporte alguno (verificado por test) |
| Object URL liberado | `revokeObjectURL` en `finally` — se libera **incluso si la descarga falla** |

Controles visibles: **`Ver transcripción`** (dentro de `<details>`) y **`Descargar transcripción`**
(un `<button>` nativo situado **fuera** del `<details>`, para funcionar con la transcripción
contraída). El gate **`TRANSCRIPTION_REQUIRED` permanece intacto** (probado en ambos sentidos).

**Verificado en la app real, con la transcripción CONTRAÍDA:** 1 Object URL creado y 1 revocado,
`a06-me-estas-escuchando.txt`, MIME `text/plain;charset=utf-8`, **321 caracteres exactamente
iguales a `config.transcripcion`**, marcas `VOZ 1:` / `NARRACIÓN:` y saltos de línea conservados.

---

## E. Accesibilidad

| Criterio | Resultado |
|---|---|
| Botones nativos y operables por teclado | `<audio>`, `<summary>` y `<button>`: los tres enfocables (`tabIndex 0`) |
| Nombre accesible suficiente | `aria-label="Audio: {título del nodo}"`, «Ver transcripción», «Descargar transcripción» |
| Foco visible | se conservan los anillos de foco por defecto (no se suprimen outlines) |
| Estados anunciados sin repetición excesiva | una sola región `aria-live="polite"`; `play` limpia el mensaje anterior |
| Transcripción legible sin depender del audio | `<details>` con el texto completo, independiente de la reproducción |
| Descarga con nombre comprensible | `a06-me-estas-escuchando.txt` |
| Usable a 390 px | reproductor 286 px dentro de un viewport de 386 px |
| Sin scroll horizontal de página | `scrollWidth == clientWidth` (386/386) |

**No se declara conformidad WCAG completa**: no se probaron lectores de pantalla reales ni zoom
al 200 %.

---

## F. Nota de arquitectura — el acceso sigue siendo canónico

El nodo pasó de «solo enlazar al visor» a «reproducir en el propio nodo», así que el reproductor
se monta **únicamente cuando el preflight canónico `/api/content/:id/access` responde `allowed`**
(hook `useAccessCheck` existente). MOOK sigue sin conceder acceso (ADR §11): sin permiso no hay
reproductor, y el participante conserva la ruta canónica «Abrir audio» hacia el visor.

El `contentId` se toma de `node.resource.id` — el campo que la proyección `computeRouteView`
ya expone. **Cero cambios de backend en esta unidad.** La URL del medio se resuelve del catálogo
que el cliente ya tiene (`dataService.getContenidoById`), sin ampliar ninguna proyección.

---

## G. Tests — 14/14 nuevos, 5 suites GREEN

`server/__test__/mookAudioA11y.test.mjs`, encadenado en `test:mook`. Las funciones puras se
extraen del `.tsx` y se evalúan; la conducta del reproductor se ejerce con un doble de
`HTMLAudioElement` que reproduce **el mismo cableado de listeners** del componente.

| # | Prueba exigida | Resultado |
|---|---|---|
| 1 | el audio nunca tiene `autoplay` | ✓ (ni atributo ni llamada a `play()`) |
| 2 | la duración aparece tras `loadedmetadata` | ✓ + formatos de borde |
| 3 | duración desconocida no muestra valor falso | ✓ (`null`, `NaN`, `Infinity`, `0`, negativos) |
| 4 | pausa válida muestra la microcopia | ✓ |
| 5 | la carga inicial no anuncia pausa | ✓ (+ navegación y desmontaje) |
| 6 | la finalización muestra la microcopia correcta | ✓ y **nunca** la de pausa |
| 7 | no se inicia otra pieza | ✓ (sin playlist, cola ni cambio de `src`) |
| 8 | la descarga contiene exactamente la transcripción | ✓ voces y saltos incluidos |
| 9 | filename saneado y terminado en `.txt` | ✓ incluye intentos de travesía de ruta |
| 10 | el Object URL se revoca | ✓ incluso si el click lanza |
| 11 | la preview usa el mismo renderer | ✓ un solo `<audio>` en todo el runtime |
| 12 | los eventos no reciben texto | ✓ sin telemetría en audio/descarga |
| 13 | `TRANSCRIPTION_REQUIRED` sigue activo | ✓ en ambos sentidos |
| + 14 | microcopias exactas y controles accesibles | ✓ |

| Comando | Resultado |
|---|---|
| `test:mook` | ✅ GREEN (9 archivos, **108** pruebas) |
| `test:library` | ✅ GREEN (17 escenarios) |
| `test:metric-contract` | ✅ GREEN |
| `typecheck:baseline` | ✅ **Sin regresiones TS** |
| `npm run build` | ✅ built |

### Ajuste de un test existente (no es regresión)

`mookPilot01` fijaba la etiqueta literal «Ver transcripción (alternativa textual)». El §4 de esta
unidad **renombra el control a «Ver transcripción»** y añade «Descargar transcripción», así que la
aserción se actualizó al contrato nuevo conservando su intención (ADR §17.4: alternativa textual
accesible desde el nodo). Es un cambio de copia **exigido por la especificación**, no una pérdida
de cobertura.

---

## H. QA visual local

Backend + Vite locales, con un **audio real del catálogo** (WAV del piloto, 81,7 s). Experiencia
de QA sembrada solo en el store de dev (`data/` está gitignored) y **retirada al terminar**: el
store quedó restaurado (6 experiencias, 8 versiones, 5 runs, 7 evidencias) con **los prototipos
intactos** y **sin credenciales temporales**.

| Comprobación | Escritorio | 390 px |
|---|---|---|
| Reproductor nativo, `autoplay=false`, `preload=metadata` | ✓ | ✓ |
| Duración real: «Este audio dura 1 min 22 s…» | ✓ | ✓ |
| Reproducción en curso: sin anuncio | ✓ | — |
| Pausa voluntaria: microcopia exacta | ✓ | — |
| Final: microcopia de final (no la de pausa) | ✓ | — |
| «Ver transcripción» / «Descargar transcripción» | ✓ | ✓ |
| Descarga con la transcripción contraída | ✓ | — |
| Sin scroll horizontal | ✓ | ✓ (386/386) |

Un detalle valioso del QA: `play()` por script fue **rechazado por la política de autoplay del
navegador** («play() failed because the user didn't interact with the document first»). Es una
confirmación independiente de que la pieza no puede sonar sin gesto del participante.

---

## I. Fuera de alcance (respetado)

No se implementó compartir, grupos, galería, edición/eliminación de bitácoras, playlists,
autoplay, duración persistida, importador, carga de los 49 activos, extractos del libro ni deploy.

**Hallazgo residual mantenido:** la distinción **404 `EVIDENCE_NOT_FOUND` / 409 `NOT_REVIEWABLE`**
revela existencia (nunca contenido) a quien ya conozca un `evidenceId`. Sigue documentada y **no
se cambió la semántica global de errores**.

**Alcance deliberadamente no tocado:** el botón de descarga de `VisorAudio` (`pages/VisorAudio.tsx`)
sigue siendo un `alert()` stub. Descarga el **archivo de audio** del visor genérico —otra función,
fuera de MOOK— y no la transcripción de un nodo. Queda registrado como pendiente ajeno a esta unidad.

---

## J. Próximo paso

Carga canónica de recursos, creación de los extractos del libro y ensamblaje editable de los siete
movimientos sobre la matriz ratificada.
