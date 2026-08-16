# CHP-STATS-INSTRUMENTATION-00 — Auditoría de cobertura de eventos de lectura

**Veredicto:** `GREEN — CURRENT READER INSTRUMENTATION MAPPED AND MINIMUM CANONICAL REPAIR PLAN READY` · `INSTRUMENTATION_DESIGN_READY=true`

- 2026-08-16, **read-only / audit-only**. No se modificó código, ni producción, ni `events.db`/`insights.db`/materializer. Todas las citas son `archivo:línea` del árbol `9fbe7e0` (rama `chp/stats-event-contract-01`).
- Referencia semántica: contrato canónico dormido `9fbe7e0` (`server/analytics/*.mjs` + `eventRegistry.js`), **NO integrado**.
- M1 productivo intacto: api_1/api_2 `0ff76b6` COMPAT/json, front `m1a-0ff76b6`, healthy, restarts=0 (verificado por inspect, sin generar tráfico).

---

## 0. Los 5 canales de emisión (todos coexisten hoy)

| Canal | Endpoint | Emisor | Durable ante fallo de red |
|---|---|---|---|
| Backbone v1 (→events.db) | `POST /api/v1/events` | `useBackboneReadingSession`, `useA11yAnalytics`, `useLuAnalytics` | **Solo a11y** (cola localStorage); backbone/lu = silent drop |
| Legacy analytics | `POST /api/analytics/events` | `services/analyticsService.ts` | No (silent drop) |
| Playback rhythm | `POST /api/playback-events` | `usePlaybackAnalytics` | No (silent drop) |
| Playback error (warn) | `POST /api/events` | `useImmersivePlayback` `pbLog` | No (silent drop; dedup por tag en memoria) |
| Progress | `POST /api/progress/:u/:c/sync` + `/complete` | `services/dataService.ts` | `/sync` tiene cola `failedSyncs`; `/complete` = silent drop |

Los cuatro endpoints de ingestión hacen **dual-write best-effort a `events.db`** (`server.js:9061-9234`). El validador **vivo** del backbone (`eventsService.validateBackboneEvent`, nombre `{mode}.{action}`, 6 modos) **no consulta `eventRegistry`**; el validador **canónico** (66 tipos + allowlist + PII) está **dormido, no importado por runtime** (confirmado por grep).

---

## 1. Inventario de superficies activas (FASE 1)

| # | Componente | Ruta / dispatch | Modo | Emisor(es) | Progress writer | Offline/retry |
|---|---|---|---|---|---|---|
| 1 | `VisorPDF` | `/leer/pdf/:id` (`App.tsx:418`) | pdf | backbone `pdf.*` + legacy + heartbeat legacy | `updateProgreso`→`/sync` | dataService `failedSyncs` |
| 2 | `VisorTexto` (Guiado) | `/leer/texto/:id` (`App.tsx:421`) | text | backbone `text.*` + legacy `block_complete` | `updateProgreso`→`/sync` | dataService `failedSyncs` |
| 3 | `VisorInmersivo` | `/leer/inmersivo/:id` (`App.tsx:424`) | immersive | **4 canales** (backbone+legacy+playback+pbLog) | `updateProgreso`→`/sync` | dataService `failedSyncs` |
| 4 | `VisorAlbum` | `/ver/album/:id` (`App.tsx:437`) | album | backbone `album.*` + legacy album-emitter | `updateProgreso`→`/sync` **+ `marcarComoTerminado`→`/complete`** | dataService `failedSyncs` |
| 5 | `VisorAccesible` | **`/leer/accesible/:id` (`App.tsx:434`) — ACTIVO** | a11y | `useA11yAnalytics` `a11y.*` (solo events.db) | **NINGUNO** (no toca `/sync`/`/complete`) | **Cola offline (única)** |
| 6 | `VisorAudio` | `ContentRouter` `tipo==='podcast'` (`:67`) | audio | **AUSENTE (0 eventos, 0 progreso)** | ninguno | ninguno |
| 7 | `VisorVideo` | `ContentRouter` `tipo==='video'` (`:69`) | video | **AUSENTE (0 eventos, 0 progreso)** | ninguno | ninguno |
| 8 | `LeoCompanion` | montado por Texto (`:1236`) + Inmersivo (`:2902`) | leo | legacy `leo_interaction` (sin texto) | perfil vía dataService | no |
| 8b | `Chatbot` (Leo de Álbum) | montado por Álbum (`:2450`) | leo | **NO emite nada** | — | — |
| 9 | `ChibaleteLU` | `/chibalete-lu` (`App.tsx:368`) | lu | `useLuAnalytics` `lu.*` | ninguno | no |
| 10 | `OralityModal` | montado por Texto (`:1215`) | (prod.) | no emite directo; persiste vía dataService | dataService | no |

**Correcciones a documentación previa (findings):**
- **`readerMode.ts` está DESACTUALIZADO:** declara `a11y` como "RESERVADO — ruta NO registrada" (`readerMode.ts:19-23`), pero `/leer/accesible/:id` **sí está registrada** y `VisorAccesible` **está vivo** (`App.tsx:434-436`, `:86`). Deuda de documentación `CHP-STATS-READERMODE-DOC-DRIFT` (P3, no bloquea ingestión).
- **`/complete` lo llama exactamente UN visor: VisorAlbum** (`:1096`). PDF/Texto/Inmersivo solo alcanzan 100% vía `/sync`; audio/video no escriben nada.

**No cableados / dead / reservados:** `VisorInmersivoV2` (dev-only, `localStorage.IMMERSIVE_RUNTIME`), `GaleriaIlustraciones` (`/galeria/:id`, fuera de alcance), modo legacy `accessible`→VisorTexto, `useReadingRuntimeBridge` (inerte salvo flag).

---

## 2. Matriz de eventos por lector (FASE 2)

`EXPLICIT` = hecho emitido; `INFERRED` = derivable de otros hechos; `ABSENT`; `N/A`; `DUP` = duplicado entre canales.

| Evento | PDF | Texto | Inmersivo | Álbum | Accesible | Audio | Video |
|---|---|---|---|---|---|---|---|
| START | EXPLICIT (`pdf.session_start` + legacy `session_start`) **DUP** | EXPLICIT (`text.session_start` + legacy) **DUP** | EXPLICIT (backbone + legacy) **DUP** | EXPLICIT (backbone + album-emitter) **DUP** | EXPLICIT (`a11y.session_start` on book-ready) | ABSENT | ABSENT |
| RESUME | INFERRED (fetch progreso + toast, sin evento) | INFERRED | INFERRED (gating resume, toast) | INFERRED (resume page/recap) | ABSENT | ABSENT | ABSENT |
| PROGRESS/CHECKPOINT | EXPLICIT `pdf.progress` (debounce 1s) | INFERRED (heartbeat `progressFraction`; legacy `block_complete`) | INFERRED (fraction en heartbeat; legacy `block_complete`) | EXPLICIT `album.progress` | EXPLICIT `a11y.progress` (párrafo ≥60%) | ABSENT | ABSENT |
| PAGE/LOCATION | EXPLICIT (legacy `page_change`; `pdf.progress` page) | N/A (scroll %) | N/A (sentence index) | EXPLICIT (`album.progress` page) | INFERRED (párrafo) | ABSENT | ABSENT |
| MEDIA PLAY | N/A | ABSENT (TTS sin evento) | EXPLICIT `immersive.audio_play` | N/A (audio región álbum: legacy) | ABSENT (TTS a11y sin evento play) | ABSENT | ABSENT |
| MEDIA PAUSE | N/A | ABSENT | EXPLICIT `immersive.audio_pause` | N/A | ABSENT | ABSENT | ABSENT |
| MEDIA ENDED | N/A | ABSENT | INFERRED (`session_completed` playback) | N/A | ABSENT | ABSENT | ABSENT |
| COMPLETE | ABSENT | ABSENT | INFERRED (legacy `session_end` source=completion; sin `/complete`) | **EXPLICIT** (`/complete` + `album_completed`) | ABSENT | ABSENT | ABSENT |
| CLOSE | EXPLICIT best-effort (`session_end` unmount + `pdf.session_end`) | EXPLICIT best-effort | EXPLICIT best-effort (+ `transition_to_next_content`) | best-effort (backbone cleanup; legacy vía 60s/beforeunload) | EXPLICIT best-effort (`a11y.session_end`) | ABSENT | ABSENT |

**Regla respetada:** no se convierte estado derivado (`progressPercentage`, `session_completed` inferido) en hecho factual. COMPLETE explícito solo en Álbum.

---

## 3. Trazado de emisores: eventId / timestamp / sesión / red (FASE 3)

| Canal | eventId | Momento de creación | Retry conserva id | occurredAt | Fallo de red |
|---|---|---|---|---|---|
| Backbone v1 | **ULID** (`useA11yAnalytics:291`, `useBackboneReadingSession:229`, `useLuAnalytics:139`) | **al OCURRIR** (enqueue) | **SÍ** (a11y persiste verbatim; backbone/lu no reintentan) | `clientTs=Date.now()` al enqueue, **preservado** | a11y=cola; backbone/lu=**silent drop** |
| Legacy analytics | **NINGUNO** (`analyticsService.ts:19-28`) | — | N/A (no reintenta) | `timestamp` al emit | **silent drop** |
| Playback rhythm | **NINGUNO** | — | N/A | `ts` en payload | **silent drop** |
| Playback error | **NINGUNO** (dedup por tag en `Set` de vida-de-tab) | — | N/A | `ts` al emit | **silent drop** |
| Progress `/sync` | key `userId__contentId` (no es evento) | — | reintenta con estado más nuevo (overwrite) | `updatedAt` | cola `failedSyncs` (TTL) |

**Ciclo de vida crítico:** el backbone genera el ULID **en el momento del hecho** y lo preserva en retry → idempotente contra `UNIQUE(event_id)` de `events.db`. Los canales legacy/playback **no tienen identidad de evento** → un reenvío sería duplicado no controlado (hoy no reenvían, pero tampoco son ingeribles canónicamente sin reparación).

**Sesiones (4 esquemas no relacionados):**
- Backbone: `interactionSessionId=ulid()` **por apertura de lector** (`[user,content,mode]`), estable dentro de la apertura.
- Playback: `ses_${Date.now}_${Math.random}` (no ULID), por montaje del hook.
- **dataService `currentSessionId`: UUID de VIDA-DE-APP que NUNCA se resetea** (`dataService.ts:100`); `durationSec` crece sin límite a través de todos los libros abiertos desde la carga de página. **Confirma la trampa de `metrics_contract_01a`: `session_id` NO es una sesión.**
- Legacy álbum: `sessionId` pasado por VisorAlbum (Math.random+Date.now).

---

## 4. START / RESUME / CLOSE (FASE 4)

- **START:** ocurre al montar el lector tras hidratación de contenido/progreso. Explícito y duplicado (backbone + legacy) en los 4 modos con emisor. **Recomendación: no crear un tercer START; unificar sobre el backbone.**
- **RESUME:** hoy **ausente como hecho** en todos los modos; se maneja como estado (fetch de progreso + toast). El registry canónico ya tiene `reading_resumed`/`reading_reopened`/`session_recovered`. **Decisión: RESUME puede DERIVARSE en el materializador** de `session_started` + progreso previo + gap temporal (no requiere un evento nuevo salvo que se quiera medir la acción explícita de "reanudar"). **NO crear trabajo de RESUME explícito para P0/P1.**
- **CLOSE:** depende de `unmount` / `visibilitychange→hidden` / `beforeunload` → **best-effort** (el navegador no lo garantiza). La cadena de métricas **NO debe depender de un CLOSE perfecto**: la duración/finalización deben poder derivarse de START + heartbeats + progreso + (para álbum) COMPLETE explícito. Esto ya está alineado con el diseño (heartbeats con `elapsedMs`).

---

## 5. Progress por modo (FASE 5)

`updateProgreso` (`dataService.ts:2365-2434`) envía `{canonicalProgress, session, updatedAt}`:
- **Factual checkpoint:** `sentenceIndex` (inmersivo/texto), `anchor` (`{type:'text'|'sentence'|'page', value}`), `viewportHint` (fracción de scroll full-precision, solo Texto). PDF: página. Álbum: página.
- **Derivado (NO factual):** `globalPercentage = round(page/totalPages*100)` (`:2381`). No debe tratarse como hecho.
- **Duplicación de progreso:** `progress state` (`/sync`) ∥ legacy `block_complete` (25/50/75/100%) ∥ backbone `*.progress`/heartbeat `progressFraction`. Tres representaciones del mismo avance.

---

## 6. Reading time / heartbeat (FASE 6)

| Canal | Intervalo | Tab oculto | Idle | Riesgo doble conteo |
|---|---|---|---|---|
| Legacy `analyticsService` heartbeat | **60s** (`:37`) | **cuenta** (sin gating) | **cuenta** | alto (inflado) |
| Backbone a11y | 15s (`:92`) | NO (gate `visible`) | NO (idle >20s) | bajo |
| Backbone base | 15s | NO (gate `visible`) | NO (idle >20s) | bajo |
| useLuAnalytics | sin heartbeat | — | — | — |
| Playback | flush 5s (no heartbeat) | — | — | — |

- **`elapsedMs`/`totalTimeMs` — inflación PARCIALMENTE viva:** `updateProgreso` **suma** `elapsedMs` a `totalTimeMs` en cada llamada (`:2415`). **Corregido SOLO en VisorInmersivo** (envía deltas incrementales `deltaMs`, QW-3, `:1605,1631-1646`). **Texto/PDF/Álbum siguen enviando `elapsedMs` acumulado-desde-inicio-de-sesión** (`VisorTexto:426`, `VisorPDF:292`, `VisorAlbum:599`) hacia un campo servidor acumulador → **inflación de tiempo de lectura** (la trampa histórica 3,67× persiste en 3 de 4 modos).
- **Multi-tab:** cada tab corre su propio heartbeat/flush; la cola a11y comparte una única clave `localStorage` sin lock (RMW race en dispositivos de colegio compartidos). Doble conteo de heartbeats por tab.

---

## 7. Completion (FASE 7)

| Modo | ¿Hecho explícito de finalización? | Evidencia suficiente para que el materializador derive completion |
|---|---|---|
| Álbum | **SÍ** (`/complete` + `album_completed`) | Fiable (hecho directo) |
| Inmersivo | No (`session_end` source=completion es estado, no `/complete`) | Derivable de `session_end(completion)` + `session_completed` playback + progreso=100% |
| Texto | No | Derivable de progreso=100% + `session_end` (menos fiable; scroll) |
| PDF | No | Derivable de última página + progreso=100% (menos fiable) |
| Accesible | No | Débil (solo `a11y.progress`; sin señal de fin) |
| Audio/Video | No (sin instrumentación) | **Imposible** |

**Regla respetada:** NO inferir completion automáticamente de "última página"/"progress≥threshold"/"media play". Solo Álbum tiene hecho fiable; el resto necesita el evento canónico `reading_completed` explícito o una derivación documentada con umbral.

---

## 8. Offline / retry (FASE 8)

| Canal | eventId reuse | occurredAt preservado | Cola persistente | Retry | Dedupe | Network restore |
|---|---|---|---|---|---|---|
| a11y (`useA11yAnalytics`) | **SÍ** | **SÍ** | **SÍ** (`a11y_events_queue`, cap 200, drop-oldest) | mount+`online`+5s+visibility+beacon | server `UNIQUE(event_id)` | **SÍ** (`online`) |
| backbone base | N/A (no cola) | — | **NO** (fail-silent) | no | — | no |
| useLuAnalytics | N/A | — | **NO** | no | — | no |
| playback rhythm/error | N/A | — | **NO** | no | tag en memoria (error) | no |
| legacy analytics | N/A | — | **NO** | no | — | no |
| progress `/sync` | N/A | — | **SÍ** (`failedSyncs` TTL) | visibility+online+focus | overwrite por key | SÍ |

**Conclusión:** el patrón "emitir-offline→sincronizar" solo existe en a11y. `useA11yAnalytics` es la **plantilla probada** (ULID en el hecho, persist-before-send, clear-on-2xx, idempotencia server). Los demás lectores emiten fire-and-forget y **pierden eventos sin red** → una **capa de transporte compartida** los nivelaría (ver FASE 13).

---

## 9. Matriz de duplicación / doble conteo (FASE 9)

| Acción de usuario | progress state | legacy analytics | canonical/backbone event | playback log | Clasificación |
|---|---|---|---|---|---|
| Abrir libro (START) | — | `session_start` | `{mode}.session_start` | — | **SAFE_COMPAT** (nombres/canales distintos; una sola verdad por materializador) |
| Avance de página/scroll | `/sync` (page/%) | `page_change`/`block_complete` | `{mode}.progress`/heartbeat | (inmersivo) rhythm | **DOUBLE_COUNT_RISK** si el materializador suma tiempo de >1 canal |
| Tiempo de lectura (heartbeat) | `session.durationSec` (vida-de-app, inflado) | heartbeat 60s (sin gating) | heartbeat 15s (gated) | — | **DOUBLE_COUNT_RISK** (3 relojes; `elapsedMs` acumulado en Texto/PDF/Álbum) |
| Finalizar (Álbum) | `/complete` | `album_completed` | `album.session_end` | — | **DOUBLE_COUNT_RISK** (3 señales de fin; deduplicar por eventId/materializador) |
| Play/pause (Inmersivo) | — | — | `immersive.audio_play/pause` | `playback_paused` | **DOUBLE_COUNT_RISK** (dos representaciones de pausa) |
| Interacción Leo (Texto/Inmersivo) | perfil | `leo_interaction` | (server `leo.*`, flag off) | — | **SAFE_COMPAT** (metadata, flag off) |

**Regla P0:** el riesgo de doble conteo vive en **tiempo de lectura** y **completion**, porque el materializador podría sumar señales de canales paralelos. La reparación P0 es **una sola fuente de verdad por hecho** (eventId estable) + `elapsedMs` incremental en todos los modos.

---

## 10. Privacidad / semántica vs contrato `9fbe7e0` (FASE 10)

| Payload actual | Contenido | Clasificación |
|---|---|---|
| Backbone `{mode}.*` | contentId, sessionId, sentenceIndex, page, elapsedMs, progressFraction | **SAFE** (sin PII; ya bounded ≤4KB) |
| Backbone con **derived state** | streak/level/xp/blocksCompleted embebidos en algunos eventos legacy→backbone | **MUST_FIX_BEFORE_CANONICAL** (el canónico rechaza derived: `UNKNOWN_PAYLOAD_KEY`) |
| Legacy `session_*`/`block_complete` | `streak`, `level`, `sessionDuration` derivados | **MUST_FIX_BEFORE_CANONICAL** (fact-only) |
| Leo `leo_interaction` (cliente) | type + surface, **sin texto** | **SAFE** |
| Leo server `leo.*` (flag off) | metadata estructurada, keys clamped | **SAFE** |
| `leo_evidence_db.json` | `userInputPreview` (80ch) + `answerPreview` (150ch) truncados | **LEGACY_ONLY** (sink pedagógico separado; **NUNCA** debe entrar al event store — el canónico lo rechazaría por `FORBIDDEN_FIELD` rawprompt/rawresponse) |
| Playback rhythm/error | sentence timings, códigos de error | **SAFE** (sin PII) pero **sin eventId** → **MUST_FIX** para ingestión |
| dataService `session.durationSec` | tiempo de vida-de-app | **MUST_FIX_BEFORE_CANONICAL** (semántica de sesión incorrecta) |

**No hay PII cruda camino al event store hoy.** El único texto de estudiante/Leo vive en `leo_evidence_db.json` (separado). El contrato canónico ya bloquea email/ip/user_agent/rawprompt/rawresponse/token/etc. (`FORBIDDEN_PII_KEYS`). **No se borró ningún dato.**

---

## 11. Mapeo al registry canónico (FASE 11)

| Evento actual | Canónico | Clasificación |
|---|---|---|
| `{mode}.session_start` / `session_start` | `session_started` / `reading_started` | **COMPAT_ALIAS** (alias ya en `CANONICAL_ALIASES`) |
| `{mode}.session_end` / `session_end` | `session_ended` / `reading_completed`(si completion) | **COMPAT_ALIAS** |
| `{mode}.progress` / `progress` | `reading_progress` | **COMPAT_ALIAS** |
| `pdf page_change` | `pdf_page_changed` | **COMPAT_ALIAS** |
| `album.progress` (page) | `album_page_changed` | **COMPAT_ALIAS** |
| `immersive.audio_play/pause` | `audio_started`/`audio_paused` | **CANONICAL_DIRECT** (semántica coincide) |
| `a11y.progress` | `reading_progress` (mode accessible) | **COMPAT_ALIAS** |
| `a11y.error` | `immersive_runtime_error`? | **SEMANTIC_MISMATCH** (no hay `reading_error` genérico; no forzar) |
| Playback `sentence_time`/`sentence_rhythm` | `immersive_sentence_committed`/`sync_drift` (aprox) | **SEMANTIC_MISMATCH** (granularidad rítmica ≠ tipos canónicos; requiere decisión de diseño) |
| `block_complete`, `page_view`, `streak_break`, `level_up`, `transition_to_next_content` | — | **NO_CANONICAL_MAPPING** (ya marcados `null` en adapters — gap deliberado / derived state) |
| `leo_interaction` (cliente legacy) | `leo_interaction_started`/`_completed` | **COMPAT_ALIAS** (pero hoy va a legacy, no backbone) |
| Audio/Video standalone | `audio_started/...` / (no hay tipo video) | **NO_CANONICAL_MAPPING** (sin emisor; **falta tipo `video_*` en registry**) |

No se modificó el registry. No se inventaron mappings donde la semántica no coincide (playback rhythm, a11y.error).

---

## 12. Priorización de gaps (FASE 12)

**P0 — integridad / doble conteo:**
- `elapsedMs` acumulado en Texto/PDF/Álbum (inflación de tiempo) → migrar a deltas incrementales como Inmersivo.
- Tiempo de lectura contado por ≥2 canales paralelos (heartbeat legacy 60s sin gating + backbone 15s) → una sola fuente.
- `dataService.currentSessionId` de vida-de-app (semántica de sesión rota) → sesión por apertura de lector.

**P1 — bloquea ingestión canónica:**
- Canales sin `eventId` (legacy, playback rhythm/error) → sin identidad estable ⇒ no ingeribles idempotentemente. Requieren ULID-en-el-hecho o ser retirados del camino canónico.
- Derived state en payloads (streak/level/…) → el canónico los rechaza; deben salir del evento (fact-only).
- Sin transporte offline salvo a11y → eventos perdidos sin red = huecos en la serie canónica.

**P2 — calidad analítica:**
- COMPLETE explícito (`reading_completed`) en Inmersivo/Texto/PDF (hoy solo Álbum).
- Instrumentar VisorAudio/VisorVideo (0 cobertura) + añadir tipo `video_*` al registry.

**P3 — enriquecimiento opcional:**
- RESUME explícito (derivable; solo si se quiere medir la acción).
- Corregir doc `readerMode.ts` (drift a11y).
- Unificar playback rhythm a tipos canónicos (`immersive_*`).

**NOT_REQUIRED:** reescribir Leo (ya PII-safe), tocar `leo_evidence_db.json`, materializer/insights (fuera de esta línea).

**La implementación debe limitarse a P0/P1.**

---

## 13. Decisión sobre transporte compartido (FASE 13)

**SÍ conviene una capa de transporte compartida de eventos.** Justificación: hoy hay 4 esquemas de identidad/tiempo/retry distintos y solo a11y es durable; unificar sobre la plantilla ya probada de `useA11yAnalytics` cierra P0 (identidad estable) y P1 (offline) de una vez y evita reimplementar retry por lector.

**Responsabilidades mínimas (y SOLO estas):**
- generar/preservar `eventId` (ULID en el momento del hecho);
- sellar `occurredAt` en el hecho y preservarlo en retry;
- cola persistente (localStorage, cap, drop-oldest, multi-user aware);
- reuso del MISMO evento en reintento (idempotencia server);
- envío a `/api/v1/events` (beacon/keepalive);
- payload bounded (≤4KB) fact-only.

**NO debe incluir:** analytics/agregación, materialización, inferencia pedagógica, derived state. (El playback rhythm y el progress `/sync` pueden quedar como canales especializados fuera del transporte canónico, o converger después — no es P0.)

---

## 14. Plan mínimo de implementación (FASE 14)

**Dos unidades** (ambas realmente necesarias; el transporte es prerequisito de los emisores):

- **CHP-STATS-INSTRUMENTATION-01A — Shared event transport / idempotency / retry.** Extraer la plantilla de `useA11yAnalytics` a un cliente compartido (`useCanonicalEventTransport` o similar): ULID-en-el-hecho, `occurredAt` preservado, cola persistente multi-user, idempotencia, bounded payload. Sin cambiar semántica de negocio. Offline/dormant-friendly.
- **CHP-STATS-INSTRUMENTATION-01B — Critical reader emitters (P0/P1).** Cablear PDF/Texto/Inmersivo/Álbum al transporte compartido con: `elapsedMs` incremental en todos los modos, sesión por apertura de lector, fact-only payloads (retirar derived state), y `reading_completed` explícito. Audio/Video quedan para P2 (unidad posterior).

No se justifica una sola unidad (el transporte debe existir y probarse antes de recablear los emisores) ni microfases adicionales.

---

## 15. Tests futuros (definición, NO implementar) (FASE 15)

- **start:** montar lector ⇒ exactamente 1 `*_started` con ULID + `occurredAt`.
- **progress:** avance ⇒ checkpoint factual (sin derived percentage como hecho).
- **reload:** recargar ⇒ no duplica START (mismo hecho ⇒ mismo eventId si aplica; o START nuevo con sesión nueva bien delimitada).
- **resume semantics:** START + progreso previo ⇒ el materializador deriva resume (o `reading_resumed` explícito) sin doble START.
- **offline:** emitir sin red ⇒ evento persiste en cola con eventId+occurredAt originales.
- **retry same eventId:** flush tras `online` ⇒ mismo eventId ⇒ server dedup (una fila).
- **network failure:** POST falla ⇒ no se pierde (queda en cola), no silent drop.
- **hidden/idle heartbeat:** tab oculto/idle ⇒ 0 heartbeats (gating), sin inflar tiempo.
- **completion:** Álbum ⇒ `reading_completed` explícito; otros ⇒ derivación documentada, no auto-inferida.
- **duplicate suppression:** dos tabs / doble flush ⇒ una sola persistencia por eventId.

---

## 16. Handoff a ingestión (FASE 16)

Tras reparar instrumentación, **CHP-STATS-INGEST-01** podrá asumir:
- `eventId` **estable** (ULID en el hecho, no en el envío).
- `occurredAt` **estable** (preservado en retry).
- `eventType` **conocido** (mapeable a los 66 del registry vía `CANONICAL_ALIASES`; sin derived state).
- `payload` **bounded** (≤4KB, fact-only, allowlist por tipo).
- `interactionSessionId` **consistente** (por apertura de lector, no vida-de-app).
- retry **conserva identidad** (idempotencia `UNIQUE(event_id)`).

Con M1-A (actor confiable `req.auth.userId`) y M1-B (tenant server-verified) ya desplegados/en progreso, el `normalizeCanonicalEvent(raw, verifiedContext)` dormido puede cablearse en modo shadow. **Esta unidad no implementa ingestión.**

---

## 17. No interferencia con M1 (FASE 17)

Verificado read-only al cierre: api_1 `0ff76b6` COMPAT/json, api_2 `0ff76b6` COMPAT/json, front `m1a-0ff76b6`, los tres healthy, restarts=0. La auditoría leyó solo archivos del repo local; **no se generó tráfico M1**.

---

## Condiciones STOP — ninguna disparada

- ACTOR CANNOT BE ATTRIBUTED SAFELY → **NO** (M1-A da `req.auth.userId`; el contrato ya rechaza x-user-id).
- UNBOUNDED DUPLICATE EVENT RISK → **NO** (riesgo de doble conteo identificado y **acotado** a tiempo/completion, con plan P0; idempotencia por eventId existe).
- RETRY CANNOT PRESERVE EVENT ID → **NO** (a11y ya lo preserva; el plan lo extiende).
- CANONICAL EVENT WOULD REQUIRE RAW PII → **NO** (sin PII camino al store; texto Leo aislado en sink separado).
- AUDIT REQUIRES PRODUCTION MUTATION → **NO** (read-only).
- M1 STATE MODIFIED → **NO**.

## Veredicto

`GREEN — CURRENT READER INSTRUMENTATION MAPPED AND MINIMUM CANONICAL REPAIR PLAN READY`. `INSTRUMENTATION_DESIGN_READY=true`. Superficies activas conocidas; emisores trazados; ciclo de vida eventId/timestamp conocido; offline/retry conocido; riesgos de duplicación conocidos; mapeo canónico completo; gaps P0/P1 aislados; decisión de transporte compartido tomada (SÍ); unidades mínimas definidas (01A transporte + 01B emisores); handoff a ingestión claro; M1 intacto.
