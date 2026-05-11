# Invariantes del Modo Inmersivo — Chibalete+

> **Estado:** vigente desde 2026-05-11 — Sprint hardening tras incidentes 1 y 2.
> **Owner:** equipo Chibalete+. **Última revisión:** 2026-05-11.
> **Pre-build gate:** `npm run verify:immersive` (test + lint estático).

Este documento es la fuente única de verdad sobre el comportamiento garantizado
del Visor Inmersivo. Las invariantes están materializadas en código (helpers
puros + guards) y respaldadas por tests automatizados que fallan si alguien
reintroduce las regresiones.

**NO MERGEAR cambios al Visor Inmersivo sin leer este documento.**

---

## 1. Incidentes que motivaron este hardening

### Incidente 1 — Salto automático entre libros (2026-05-11)

El usuario abría `/leer/inmersivo/content-1773325007384` (Alicia en el País de
las Maravillas). Al reproducir, tras ~40 segundos el visor cambiaba automáticamente
a `/leer/inmersivo/content-1775664683377` (El Libro de la Selva).

**Causa raíz:** `BlockEngine.complete` (a los 40 s del bloque de nivel novato)
invocaba el subscriber del visor, que llamaba `triggerTransitionRef.current()`,
que ejecutaba `navigate('/leer/inmersivo/${nextContent.id}')`. `nextContent`
provenía de `ContentQueue.getNextContent`, una sugerencia heurística que no
implica intención del usuario.

**Síntoma idéntico** existía en el path `onSessionEnd` (audio termina la última
frase): también navegaba a `nextContent.id` sin intervención del usuario.

### Incidente 2 — Avance prematuro de frases cortas (2026-05-11)

En `content-1773089901847` (Alicia), frases como `"(Dinah era su gata)."`,
`"Abajo, abajo, abajo."` o `"¡Querida Dinah!"` avanzaban con `durationMs` de
173-338 ms. Imposible que un humano lea esas frases en ese tiempo.

**Causa raíz probable:** blob de audio cacheado en el browser cliente con
duración corrupta (network glitch en primera fetch, o TTS que devolvió audio
truncado de forma intermitente). El endpoint `/api/tts` devuelve audio correcto
(~28 KB / ~3 s) cuando se invoca limpio. `audio.onended` disparaba a 182 ms,
correspondiente a la duración real del blob defectuoso almacenado.

---

## 2. Las 12 invariantes definitivas

### INV-1 — La URL gobierna el contenido activo

`routeContentId` (extraído de `useParams().id`) es la fuente de verdad. Ninguna
fuente puede reemplazarlo:

- progreso remoto/local
- "último libro leído" / "primer contenido disponible"
- `ContentQueue.getNextContent`
- `nextContentRef.current`
- fallback raw text
- audio manifest / anchors.json
- eventos `play_start` / `playback_paused`
- `reloadUsers`
- cache restore
- `sessionStorage` / `localStorage`

Si una fuente trae un `contentId` distinto al de la ruta, debe ser ignorada y
logueada como `[IMMERSIVE_GUARD] content_mismatch`.

**Materializado en:** `utils/immersiveSession.js::assertImmersiveSessionActive`
**Test:** `utils/__tests__/immersiveSession.test.js`

### INV-2 — No hay navegación automática entre libros

`navigate('/leer/inmersivo/<id>')` con `<id>` distinto al activo está prohibido
salvo por una de tres razones whitelisted:

- `user_click_next` — banner "Próximo →" del visor inmersivo
- `user_click_book_card` — tarjeta de libro en Biblioteca/Home
- `user_explicit_navigation` — botón Volver, breadcrumb, etc.

Toda transición pasa por `assertManualNavigation`. Cualquier otra razón:
- En dev/test: lanza `[IMMERSIVE_FATAL_AUTONAV_BLOCKED]` para que tests fallen.
- En prod: bloquea y loguea fatal.

**Materializado en:** `utils/immersiveNavigation.js`
**Test:** `utils/__tests__/immersiveNavigation.test.js`
**Lint:** `scripts/lint-immersive-guards.mjs` regla `NAV_WITHOUT_GUARD`

### INV-3 — La sesión se define por (userId, contentId)

`sessionKey = "${userId}__${contentId}"`. Todo storage namespaced:

```
immersive:${userId}:${contentId}:progress
immersive:${userId}:${contentId}:playback
immersive:${userId}:${contentId}:leo_session
immersive:${userId}:${contentId}:audio_cache_meta
```

Keys prohibidas detectadas en lint estático (regla `STORAGE_KEY_NOT_NAMESPACED`):
`immersiveProgress`, `currentContent`, `activeBook`, `lastPlayback`,
`currentSentenceIndex`, `playbackState`, `selectedContent`, `lastReadContent`,
`leo_session_${contentId}` (legacy sin userId — migración silenciosa en VisorInmersivo).

**Materializado en:** `utils/immersiveSession.js::buildNamespacedStorageKey`
**Test:** `utils/__tests__/immersiveSession.test.js`

### INV-4 — Todo callback async valida sesión activa antes de mutar

Antes de `setState`, `setIdx`, `setStatus`, `setSentences`, `setProgress`,
`navigate`, `load(nextIdx)`, `play`, `pause`, `saveProgress`, `restoreProgress`:

```js
if (!assertImmersiveSessionActive({...}).ok) return;
```

Validaciones del guard:
- `sourceContentId === activeContentIdRef.current`
- `sourceSessionKey === activeSessionKeyRef.current`
- `!abortSignal.aborted`
- `!unmountedRef.current`
- `routeContentId === activeContentId` (FATAL si diverge)

**Materializado en:** `utils/immersiveSession.js::assertImmersiveSessionActive`

### INV-5 — StartupEngine y loaders son abortables

`StartupEngine` acepta `AbortSignal` opcional en su constructor y propaga a los
tres fetches (manifest / anchors / text). `run()` chequea `signal.aborted`
antes de emitir `'ready'`.

Al cambiar `contentId`:
1. Detener audio actual (`pb.reset()`).
2. Abortar StartupEngine anterior (`ac.abort()`).
3. Cancelar timers.
4. Remover listeners.
5. Invalidar tokens (`++loadToken.current`).
6. Limpiar standby player.
7. Crear nueva sessionKey.
8. Arrancar sólo el nuevo contentId.

**Materializado en:** `engines/StartupEngine.ts`, `pages/VisorInmersivo.tsx` (useEffect de content.id)

### INV-6 — Fallback nunca cambia de libro

Si `/uploads/audio/${contentId}/anchors.json` da 404, o si manifest está vacío,
el fallback raw text opera EXCLUSIVAMENTE sobre `content.texto_plano_url` del
mismo `contentId`. Prohibido:

- buscar otro libro
- usar "primer contenido disponible" / "último contenido leído"
- consultar `ContentQueue`
- cambiar la ruta
- hidratar frases desde caché de otro `contentId`

Log esperado: `[RAW_FALLBACK] contentId=<X> rawLen=<N>` (mismo `contentId`).

**Materializado en:** `engines/StartupEngine.ts::buildSentences`

### INV-7 — Timing mínimo humano por frase

Toda frase visible cumple piso de duración VISUAL:

| Palabras | Piso a 1x |
|---|---|
| 1 | 900 ms |
| 2-4 | 1400 ms |
| 5-8 | 2000 ms |
| >8 | `max(2000, words*250)` ms |

Bonus: puntuación fuerte final / cierre paren/comilla → `+250 ms`.
Velocidad >1: escala inversa; piso absoluto irreductible 450 ms.

**Materializado en:** `utils/immersiveTiming.js::estimateMinSentenceMs`
**Aplicado en:** `hooks/useImmersivePlayback.ts::handleEnded` — el `setIdx(nextIdx)` vive dentro de `doAdvance`, ejecutado tras `max(rhythmDelay, floorRemaining)`.
**Test:** `utils/__tests__/immersiveTiming.test.js`

### INV-8 — Separar displayText, spokenText, timingText

Cada sentence puede tener tres representaciones distintas:

- `displayText`: lo que se ve en pantalla.
- `spokenText`: lo que se manda a TTS/audio.
- `timingText`: lo que se usa para estimar duración.

`normalizeSentenceForSpeech` quita decoración (comillas curvas, paréntesis
envolventes) PERO **nunca reduce contenido léxico**. La regla "Dinah era su
gata" no puede colapsar a "Dinah".

**Materializado en:** `utils/immersiveTiming.js::normalizeSentenceForSpeech`
**Test:** `utils/__tests__/immersiveTiming.test.js`

### INV-9 — Audio cache se valida contra texto visible

`validateAudioDuration({ displayText, duration, blobSize, cached, speed })`
retorna `{ status: 'valid' | 'suspicious' | 'invalid' | 'pending', reason, minExpectedMs, wordCount }`.

Reglas:
- `duration` null/NaN/Infinity → `pending` (esperar metadata).
- `duration <= 0` → `invalid`.
- `wordCount >= 3 && duration < 0.8 s` → `invalid` (incidente Dinah).
- `durationMs < minExpectedMs * 0.5 && wordCount >= 2` → `suspicious`.
- `blobSize > 0 && < 1024 && wordCount >= 3` → `suspicious`.

Cuando `status === 'invalid'` para un blob CACHEADO, se evicta del
`audioCache` (URL.revokeObjectURL + delete) y se emite
`[PB] audio_cache_invalidated`. El siguiente acceso re-fetch.

**Materializado en:** `utils/immersiveTiming.js::validateAudioDuration`
**Aplicado en:** `hooks/useImmersivePlayback.ts::load` (en el `.then` del `play`)
**Test:** `utils/__tests__/immersiveTiming.test.js`

### INV-10 — Eventos nunca controlan playback

`/api/v1/events` es canal de telemetría. Si falla con 401/500/timeout/network:
- NO reiniciar motor.
- NO cambiar usuario, contenido, index, route.
- NO pausar ni reproducir.

`useBackboneReadingSession.flush()` usa `fetch + keepalive` con header
`x-user-id`. `sendBeacon` eliminado (no soporta headers → causaba 401 en
session_end). El `.catch()` es silencioso: no muta state.

**Materializado en:** `hooks/useBackboneReadingSession.ts::flush`
**Lint:** `scripts/lint-immersive-guards.mjs` regla `EVENT_CATCH_MUTATES_PLAYBACK`

### INV-11 — Progreso no puede cambiar contentId

`fetchAndMergeRemoteProgress(userId, contentId)` está aislada por contentId.
En `useEffect([content.id])`, el `.then` captura `reqContentId = content.id`
en una closure local y compara contra `analyticsContentIdRef.current` antes
de mutar `fromRemoteProgressRef`. Si difieren → `[IMMERSIVE_GUARD]
GUARD_STALE_PROGRESS` y se descarta.

**Materializado en:** `pages/VisorInmersivo.tsx` (useEffect de content.id)

### INV-13 — visualIndex y playbackIndex no divergen sin estado pending explícito

`setIdx(nextIdx)` y `log('sentence_advanced')` viven **dentro** de `doAdvance` (el
callback del setTimeout/canplaythrough), NO en el cuerpo síncrono de `handleEnded`.
Mientras el timer corre, el visual permanece en `currentIdx`. Cuando `doAdvance`
ejecuta y pasa los guards (`capturedToken`, `unmountedRef`, `statusRef`), commitea.

**Materializado en:** `hooks/useImmersivePlayback.ts::handleEnded::doAdvance/goLoad`
**Test:** `hooks/__tests__/playbackStateMachine.test.js`

### INV-14 — Progreso sólo se guarda tras commit visual

`PROGRESS_SAVE` se dispara desde el `useEffect([currentIndex, ...])` de
`VisorInmersivo`. Como `setIdx(nextIdx)` ahora vive dentro de `doAdvance`,
`currentIndex` sólo se actualiza tras el commit — el efecto del progreso
nunca ve un índice "futuro pendiente".

**Materializado en:** `pages/VisorInmersivo.tsx` (useEffect de save)

### INV-15 — Block complete / pause / skip cancelan avances pendientes

Los setTimeout y listeners canplaythrough se asignan a refs explícitos
(`pendingAdvanceTimerRef`, `pendingFallbackTimerRef`,
`pendingCanplaythroughCleanupRef`). `cancelPendingAdvance(reason)` los limpia
y emite `[PB] pending_advance_cancelled`. Se invoca en:

- `pause()` → reason `'pause'`
- `load()` (que llama `skip()`) → `'skip_or_load'`
- `reset()` (cambio de contenido) → `'content_reset'`
- cleanup useEffect del unmount → `'unmount'`
- inicio de `handleEnded` (defensa anti double-fire) → `'new_handleEnded'`
- `BlockEngine.complete` subscriber del visor → llama `pb.pause()` que cancela transitivamente

**Materializado en:** `hooks/useImmersivePlayback.ts::cancelPendingAdvance`
**Test:** `hooks/__tests__/playbackStateMachine.test.js`

### INV-16 — Skip manual hace hard resync

`skip(target)` → `load(target, true)`. `load` cancela pending, incrementa
`loadToken`, pausa ambos players, resetea `sentenceStartTimeRef` (al entrar
en `play().then`), llama `setIdx(target)` y arranca audio de `target`. El
índice de progreso se actualiza vía el effect de currentIndex.

**Materializado en:** `hooks/useImmersivePlayback.ts::skip` → `::load`

### INV-17 — Logs separan "scheduled" de "committed"

| Evento | Cuándo | Significado |
|---|---|---|
| `sentence_time` | onEnded fires | duración real reproducida |
| `sentence_floor_applied` | floorRemaining > 0 | piso retrasará el avance |
| `sentence_rhythm` | scheduling | rhythm calc para el avance |
| `index_scheduled` | scheduling | doAdvance agendado con reason/finalDelay |
| `pending_advance_cancelled` | cancelPendingAdvance | timer pendiente cancelado |
| `index_commit` | dentro de doAdvance | setIdx ya ejecutó |
| `sentence_advanced` | dentro de doAdvance | commit del avance |
| `play_start` | play() resuelve | audio empezó |

**Test:** `hooks/__tests__/playbackStateMachine.test.js`

### INV-12 — ContentQueue no gobierna reproducción

`getNextContent` y `preloadContentText` son funciones puras. NO pueden:
- llamar `navigate` ni `useNavigate`
- tocar `window.location` / `window.history`
- escribir `sessionStorage` / `localStorage`
- usar `setTimeout` / `setInterval`
- registrar event listeners
- importar React / hooks

`preloadContentText` es la ÚNICA función con side effect permitido (un
`fetch` para calentar cache HTTP). El test `engines/__tests__/contentQueue.test.js`
verifica que `fetch` sólo aparece dentro de `preloadContentText`.

**Materializado en:** `engines/ContentQueue.ts`
**Test:** `engines/__tests__/contentQueue.test.js`

---

## 3. Flujo permitido de reproducción

```
ROUTE /leer/inmersivo/:id
  → ImmersiveWrapper (App.tsx)
  → dataService.getContenidoById(id)   ← INV-1: id es la única fuente
  → <VisorInmersivo content={...} />
     ├── useEffect([content.id])
     │   ├── new StartupEngine(content.id, content.texto_plano_url, ac.signal)  ← INV-5
     │   ├── engine.subscribe(state => {                                         ← INV-4
     │   │     if (engine !== engineRef.current) GUARD_STALE_ENGINE
     │   │     ... setSentences, setAnchorsMap ...
     │   │   })
     │   ├── engine.start()
     │   └── return () => ac.abort()   ← INV-5
     ├── post-hydration:
     │   ├── pb.load(targetIndex, isAutoTransition)
     │   └── log [IMMERSIVE_PLAY] { contentId, targetIndex }
     ├── handleEnded() en useImmersivePlayback:                                   ← INV-7
     │   ├── rawDuration = Date.now() - sentenceStartTimeRef
     │   ├── floorRemaining = max(0, estimateMinSentenceMs(text) - rawDuration)
     │   ├── doAdvance:
     │   │   ├── setIdx(nextIdx)                                                  ← visual avanza aquí
     │   │   ├── play(nextEl)                                                     ← audio del próximo
     │   ├── schedule(doAdvance, max(rhythmDelay, floorRemaining))
     ├── BlockEngine.complete → setSessionComplete(true) + pb.pause()             ← INV-2 ✓ no navega
     ├── onSessionEnd → setSessionComplete(true)                                  ← INV-2 ✓ no navega
     └── banner "Próximo →" onClick:
         └── triggerTransitionRef.current('user_click_next', 'banner_proximo')
             └── assertManualNavigation({...}).ok → navigate(...)                 ← INV-2 ✓ manual
```

---

## 4. Flujo PROHIBIDO

```
✗ BlockEngine.complete → navigate(...)
✗ onSessionEnd        → navigate(...)
✗ triggerTransitionRef.current()  // sin reason
✗ ContentQueue.getNextContent     → navigate(...)
✗ StartupEngine.fallback          → buscar otro contentId
✗ /api/v1/events 401 catch        → setStatus / pause / load
✗ fetchAndMergeRemoteProgress     → mutar visor de otro contentId
✗ sessionStorage.setItem('leo_session_${contentId}', ...)  // sin userId
✗ sessionStorage.setItem('immersiveProgress', ...)         // sin namespace
✗ setTimeout(() => setIdx(N), …)  // sin guard de capturedToken/statusRef
```

---

## 5. Checklist antes de tocar el modo inmersivo

Antes de modificar cualquiera de:
- `pages/VisorInmersivo.tsx`
- `hooks/useImmersivePlayback.ts`
- `hooks/useBackboneReadingSession.ts`
- `engines/StartupEngine.ts`
- `engines/BlockEngine.ts`
- `engines/ContentQueue.ts`
- `utils/immersiveTiming.js`
- `utils/immersiveSession.js`
- `utils/immersiveNavigation.js`

Ejecutar:

```bash
npm run test:immersive            # 98 tests unitarios — todos verdes
npm run lint:immersive-guards     # 0 violaciones
npm run build                     # Vite verde
```

Y revisar mentalmente:

- [ ] ¿Tu cambio NO añade un `navigate('/leer/inmersivo/<id>')` sin `assertManualNavigation`?
- [ ] ¿Tu cambio NO introduce una `sessionStorage.setItem` con key globalmente única (sin user+content)?
- [ ] ¿Tu cambio respeta el piso `estimateMinSentenceMs` para frases visibles?
- [ ] ¿Tu cambio NO hace que `BlockEngine.complete` o `onSessionEnd` cambien de libro?
- [ ] ¿Tu cambio NO hace que un `.catch()` de `/api/v1/events` mute playback?
- [ ] Si añadiste un `setTimeout` que llama `setIdx`/`navigate`/`load`, ¿valida `capturedToken`, `statusRef`, `unmountedRef`?

Si modificas las invariantes (relajas un piso, añades un caller permitido,
etc.), **DEBES**:
1. Actualizar este documento.
2. Actualizar los tests correspondientes.
3. Mencionar en el commit por qué es seguro relajar.

---

## 6. Cómo debuggear

### Anchors faltantes (404)

```bash
# El log lo dice todo. Si ves esto en consola:
[ANCHORS_404] contentId=content-XYZ

# Verificar archivo en disco (local):
ls public/uploads/audio/content-XYZ/

# Si falta: regenerar TTS (UI: SubirContenido → "regenerar audio")
# El visor sigue funcionando con fallback raw text — anchors es opcional.
```

### Audio cacheado defectuoso

```bash
# Si ves en consola:
[PB] audio_cache_invalidated { index, duration: 0.18, ... }

# Significa que INV-9 detectó un blob cacheado con duración imposible.
# Ya se evictó del cache; el siguiente play re-fetch al endpoint.
# Verificar que /api/tts devuelve audio correcto:
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -H "x-user-id: <tu-user>" \
  -H "Origin: http://localhost:5173" \
  --output /tmp/test.mp3 \
  --data-raw '{"text":"texto a sintetizar"}'

# Verificar tamaño del archivo. ~10 KB/seg de audio normal.
```

### Guard stale callbacks

```bash
# Si ves logs como:
[IMMERSIVE_GUARD] StartupEngine.subscribe_content_mismatch_source=A_active=B

# Es comportamiento esperado: la sessionKey activa cambió mientras un
# callback async esperaba. NO es bug — es la defensa funcionando.
```

### Activar logs en producción sin redeploy

```js
// En DevTools console:
localStorage.setItem('immersive_debug', '1')
// Reload. Verás todos los logs [IMM HH:MM:SS][TAG] {...}
// Para apagar: localStorage.removeItem('immersive_debug')
```

---

## 7. Pre-build / pre-deploy

```bash
# Verificación local antes de cualquier deploy frontend:
npm run verify:immersive          # ejecuta test:immersive + lint:immersive-guards
npm run build                     # Vite build determinístico

# Validación manual mínima (smoke):
# 1. Abrir /leer/inmersivo/<libro corto>, play 60s, confirmar NO salto.
# 2. Frase "(Dinah era su gata)." → permanece ≥1.4s.
# 3. Network panel: cero 401 en /api/v1/events.
```

Si alguna prueba falla, el deploy se aborta. No hay excepciones.

---

## 8. Mapa de archivos

| Archivo | Rol | Tests |
|---|---|---|
| `utils/immersiveTiming.js` | INV 7/8/9 — pure helpers | `__tests__/immersiveTiming.test.js` |
| `utils/immersiveSession.js` | INV 1/3/4 — sessionKey + guards | `__tests__/immersiveSession.test.js` |
| `utils/immersiveNavigation.js` | INV 2 — assertManualNavigation | `__tests__/immersiveNavigation.test.js` |
| `utils/immersiveLogger.ts` | logs estructurados [IMM][TAG] | — |
| `engines/ContentQueue.ts` | INV 12 — pure | `engines/__tests__/contentQueue.test.js` |
| `engines/StartupEngine.ts` | INV 5/6 — abortable, fallback aislado | — |
| `engines/BlockEngine.ts` | comentario anti-regresión INV-2 | — |
| `hooks/useImmersivePlayback.ts` | INV 7/9 — floor + cache invalidation | — |
| `hooks/useBackboneReadingSession.ts` | INV 10 — eventos no bloqueantes | — |
| `pages/VisorInmersivo.tsx` | orquestador; gateway INV-2 vía triggerTransitionRef | — |
| `scripts/lint-immersive-guards.mjs` | static check INV 2/3/4/10/12 | — |
| `docs/immersive-mode-invariants.md` | este documento | — |
