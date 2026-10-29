# GAMIFICACION-G4-01: validador de lectura en observación

**Fecha:** 2026-10-29 · **Base:** `bae5c2e` (G3-03 publicado; CI 3/3 en verde tras volver a ejecutar los dos jobs que fallaron de forma intermitente, §7) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** un validador **en observación**, puro y de solo lectura. No concede XP, PM, niveles ni logros. **No persiste nada**, no está enganchado a ninguna ruta y no toca `progress.db`, regalías, derechos ni acceso.

## 1. Inventario de evidencia por modalidad (verificado en el código)

| Modalidad (visor) | Cómo se «termina» | Qué recibe `progress.db` | Telemetría en `events.db` (columna `mode`) | Declaración explícita de fin |
|---|---|---|---|---|
| **Inmersivo** (`VisorInmersivo`) | Guardar la última oración da 100 % | `/sync` cada 15 s: `sentenceIndex`, `totalSentences`, `globalPercentage` y la sesión `{sessionId, startedAt, durationSec}` | `immersive`: `reading_started`, `session_heartbeat` con `progressFraction`, `session_ended` | No. El fin del audio es solo UI, y el corte por temporizador **no** es fin (G0) |
| **Guiado** (`VisorTexto`, id `text`) | Scroll al fondo da 100 % | `/sync` con `globalPercentage` del scroll | `text`: sesión y heartbeat con fracción de scroll; `block_complete` al 25/50/75/100 → `reading_progress` | No |
| **Accesible** (`VisorAccesible`, `/leer/accesible/:id`) | — | **Nada**: no persiste progreso | `a11y`: progreso por párrafo (≥ 60 % visible), heartbeat y sesión | **No existe** |
| **PDF** (`VisorPDF`) | Última página da 100 % | `/sync` con página / total | `pdf`: sesión, heartbeat y `pdf.progress` por página | No |
| **EPUB** (`EpubReaderApp`, entrada propia) | `fraction × 100` | `/sync` con `canonicalProgress.epub` (CFI, fracción) | **Ninguna** | No |
| **Álbum / novela gráfica** (`VisorAlbum`) | Pasar la última página **de la ruta activa**, aunque la ruta no cubra todas | `/sync` con página / total (el modo llega como `text`: el servidor solo admite `pdf`, `text`, `accessible` e `immersive`) | `album`: sesión, heartbeat y `album.progress`; además `album_completed` por la vía legacy (`text.album_completed` → `reading_completed`) | **Sí: el único visor que llama `/complete`** |
| **Audio / Video** | — | Nada | Nada | No |
| **Manual** (`ProgressUpdater`, Home) | El usuario escribe la página | `/sync` | — | Es manual |

## 2. Confianza de cada señal

| Señal | Origen | Confianza |
|---|---|---|
| `isCompleted`, `globalPercentage` y `totalSentences` en `progress.db` | **Cliente** | Es la declaración que se contrasta, **no** evidencia. `/complete` fuerza el 100 % sin validar |
| `history[]` de `progress.db` (`startedAt`, `durationSec`) | **Cliente** | Solo guarda las 20 sesiones más recientes. `updated_at` se sobrescribe en cada `sync`. **No se guarda el instante de finalización**: se pierde al siguiente guardado |
| `server_ts` en `events.db` | **Servidor** | Hora de **llegada** (`insertEvent` → `Date.now()`), no de ocurrencia. El cliente agrupa hasta 10 eventos o 5 s, y un envío diferido comprime los intervalos |
| `progress_fraction`, `elapsed_ms` y `client_ts` en `events.db` | **Cliente** | Telemetría canónica validada por schema, pero los valores los declara el cliente |
| `user_id` y `mode` en `events.db` | Sesión o cabecera, y visor | El usuario sale de la autenticación de ingesta; el modo es el del visor |
| Retención de `events.db` | — | 90 días (después pasa al archivo frío si la rotación está activa) |
| Heartbeat del hook nativo | — | Solo con la pestaña visible y actividad en los últimos 20 s. Las sesiones en segundo plano no dejan rastro |

**Conclusión:** no existe evidencia **verificada** de lectura. Lo que hay es plausibilidad: la coherencia entre la declaración del cliente y la telemetría canónica, también del cliente, ordenada con la hora del servidor.

## 3. Contrato del validador (`server/gamification/readingValidator.mjs`)

**Firma.** `evaluateReadingCompletion({ claim, progress, events }, rules?)` devuelve `{ verdict, reasons[], ruleVersion, features, evidenceRefs }`. Es una función **pura y determinista**.

- `claim = { userId, contentId, at, source }` es la declaración que se contrasta (`at` = hora del servidor).
- `features` coincide con la lista permitida de `reading_completion` (G3): `mode`, `sessions`, `distinctDays`, `maxProgressPct`, `monotonic` y `lengthUnits`.
- `evidenceRefs = { firstEventId, lastEventId, observations, rereadSegments, otherModes }`.

**Funciones auxiliares.**
- `observeReadingCompletion(claim, { getEventsSince, getProgressItem })` recolecta la evidencia con lectores inyectados, en **solo lectura** (`eventsService.getEventsSince` y `progressService.getProgressItem`). **Nunca lanza.** Devuelve el registro con `observationKey`, sin `userId`.
- `observationKey` es un sha256 de usuario, obra, primer evento del recorrido y versión de regla: los reintentos sobre la misma lectura dan la misma clave.

**Regla `rv-reading-observe-v1`** (CONFIGURABLE; **ningún umbral es de tiempo**):

| Condición | Veredicto | Motivo |
|---|---|---|
| EPUB, modo `a11y`, audio o video | `insufficient_data` | `mode_not_instrumented` |
| `events.db` no disponible | `insufficient_data` | `events_unavailable` |
| Sin eventos de esa obra y ese usuario en 90 días | `insufficient_data` | `no_reading_events` (lectura sin conexión, bloqueadores, retención) |
| Progreso observado solo en **otro** modo | `insufficient_data` | `progress_in_other_mode_only`. **Sin equivalencias entre modos**: el modo evaluado es el de la sesión **observada** más reciente |
| Último recorrido con máximo < 50 % | **`implausible`** | `completion_far_beyond_observed_progress` |
| Máximo entre 50 y 95 % | `insufficient_data` | `end_not_observed` |
| Final observado sin ningún avance intermedio y obra de ≥ 6 unidades | **`implausible`** | `jump_to_end` |
| Ídem, pero en una obra corta o de longitud desconocida | `insufficient_data` | `no_intermediate_progress` |
| Final observado con avance intermedio | `plausible` | `end_observed`, `intermediate_progress_observed` |

**Relectura.** Se evalúa el **último recorrido**: lo que sigue a volver por debajo del 10 % después de haber llegado al final. Se marca `reread_segment` y no hereda la lectura anterior. Volver atrás dentro de una misma lectura no cuenta como relectura ni penaliza.

**Principio rector:** ante la duda, `insufficient_data`. `implausible` solo aparece ante una **contradicción estructural** entre la declaración y la telemetría del propio cliente. Nunca por ritmo, duración, pausas, discapacidad ni herramientas como TTS o el avance automático: la prueba [5] verifica que la misma lectura en 30 s o en 60 h da el mismo veredicto.

## 4. Limitaciones de confianza

1. **Todo lo observado lo declara el cliente.** Un cliente manipulado puede fabricar telemetría coherente. El validador solo detecta incoherencias y no prueba que se haya leído. Por eso la lectura sigue **bloqueada para emitir** (G3: `READING_EMISSION_LOCKED`).
2. **`server_ts` es la hora de llegada.** Con envíos agrupados o diferidos se pierde la cronología fina. El validador no usa intervalos, así que no le afecta.
3. **Heartbeats sin `contentId`.** Si existen, no se asocian a la obra.
4. **Modalidades sin cobertura:**
   - **Accesible:** ni progreso persistido ni declaración de fin.
   - **EPUB:** sin telemetría.
   - **Audio y video:** nada.
   
   Siempre dan `insufficient_data`, y eso **no las penaliza**: simplemente no hay evidencia.
5. **El fin del álbum es el fin de la ruta activa,** que puede no cubrir todas las páginas. Con una ruta parcial, el máximo observado puede quedar por debajo del 95 % y el veredicto será `end_not_observed`.
6. **Retención de 90 días.** Una lectura más antigua no tiene evidencia (`no_reading_events`).
7. **No hay un instante de finalización canónico.** La relectura se reconstruye desde la telemetría, no desde un registro de completados.

## 5. Pruebas (`readingValidator.test.mjs`: 43 ✓)

Cubren:
- finalización prematura y artificial;
- finalización legítima en los cuatro modos instrumentados y en dos sesiones y dos días;
- obra corta o de longitud desconocida, que no se acusa;
- relectura completa, con salto o abandonada, y vuelta atrás que no penaliza;
- evidencia insuficiente: sin eventos, EPUB, `a11y`, otro modo, sin progreso, store caído, fuera de la ventana u otro usuario;
- **ritmo indiferente** (30 s frente a 60 h);
- determinismo e idempotencia de la clave;
- fallos y evidencia corrupta sin excepciones;
- **`events.db` y `progress.db` reales** (temporales): veredicto correcto, archivos **byte a byte idénticos** antes y después de observar, y finalización canónica intacta;
- de forma estructural: el validador no importa el ledger ni la política, no escribe, no toca regalías, nada del producto lo llama y el registro no trae XP, PM, nivel ni logro.

## 6. Requiere autorización separada (propuesta mínima, no implementada)

1. **Persistir las observaciones.** Se conservarían datos personales nuevos: métricas de lectura por alumno.
   - **Propuesta mínima:** registrar cada observación como `gm_source_facts` con `source='reading_completion'` y `decision='observed'`. **No cambia el esquema**: la tabla y la lista permitida existen desde G3.
   - Clave de idempotencia: `observationKey`. Solo las `features` permitidas, más el veredicto y los motivos.
   - **Retención** propuesta de 90 días, igual que `events.db`, **pendiente de la DPIA**.
   - Disparador: un gancho después de responder en `/sync` cuando `globalPercentage` pasa a 100, y en `/complete`.
2. **Ganchos en `/sync` y `/complete`.** Llaman al validador después de la respuesta, igual que MOOK. Dependen del punto 1.
3. **Hacer recuperable la lectura terminada** (G3-02 §2). Habría que guardar el instante de finalización, lo que **cambia la estructura o la semántica de `progress.db`**.
4. **Pasar a `enforce`** (emitir por lectura): calibración con datos reales y aprobación de Producto y Pedagogía (G4 STOP).
5. **Fuera del alcance de gamificación, encontrado de paso:**
   - el hook `useBackboneReadingSession` documenta que necesita `x-user-id`, pero su `fetch` no lo envía;
   - `VisorPDF` avanza de 2 en 2 páginas y puede pasar de 100 % con un número impar de páginas;
   - el modo `album` llega a `progress.db` como `text`.
   
   Ninguno se tocó.

## 7. CI de G3-03 (`bae5c2e`)

- **Intento 1:** `content-rmw` e `identity-preflight` fallaron. Alguien los volvió a ejecutar (intento 2) y los dos pasaron. `security` pasó.
- **`content-rmw`: causa identificada y anterior a G3-03.** `contentGlobalReadOnlyPolicy.test.mjs` elige el puerto como `6600 + pid % 80`. Cuando cae en 6665–6669 o 6679, puertos que la especificación Fetch bloquea, undici rechaza la conexión (`cause: bad port`) aunque el servidor esté sano.
  - Probabilidad aproximada: 7,5 % por ejecución, según el PID.
  - Lo reproduje en Linux volcando la salida de los servidores: 2 de 20 ejecuciones, en los puertos 6679 y 6669.
  - **Otras ~20 suites** usan el mismo esquema `pid % N`. Corregirlo es una unidad separada.
- **`identity-preflight` (`userCredentialReset`):** no se reproduce. Pasó 15 de 15 veces en Linux sobre `bae5c2e` y en el intento 2 de la CI. Se trata como un fallo transitorio del runner.
