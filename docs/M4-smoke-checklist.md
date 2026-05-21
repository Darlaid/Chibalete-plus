# M-4 — Smoke Local Manual del Runtime Inmersivo V2

**Estado**: PLANTILLA — para llenar durante el smoke real.
**Quién ejecuta**: Nicolas (humano, en navegador real).
**Cuándo cerrar M-4**: cuando esta plantilla esté completa con resultados, browsers probados y decisión final.

---

## 0 · Setup (preparación local)

Verificar antes de empezar:

- [ ] Branch actual: `sprint-022/operational-stack` (o donde vivan los commits M-3.5).
- [ ] `git status` limpio salvo el bloque `// DEV ONLY — NO PROD ROUTE` en `App.tsx`.
- [ ] `npm install` completado.
- [ ] `npm run test:immersive-v2` → 690 ✓ / 0 ✗.
- [ ] `npm run typecheck:baseline` → ✅ sin regresiones.
- [ ] `npm run dev` arranca Vite en `localhost:5173`.

Activación del viewer V2 desde DevTools del navegador:

```js
localStorage.setItem('IMMERSIVE_RUNTIME', 'v2-local')
window.__IMMERSIVE_V2_DEBUG__ = true   // habilita panel + console group + window.__immersiveV2Stack
location.reload()
```

Visitar: `http://localhost:5173/#/visor-v2-local/<contentId>` con `<contentId>` real (Alicia, Guerra de los mundos, etc.).

Si el viewer dice **"Visor V2 — bloqueado (DEV ONLY)"** → el flag no está activo. Corre los comandos de arriba.

---

## 1 · Login

Login con un usuario que tenga acceso a los contenidos de prueba. Confirmar:

- [ ] V1 funciona: `/leer/inmersivo/<contentId>` muestra visor V1 normal.
- [ ] V2 está GATED: visitar `/visor-v2-local/<id>` SIN flag muestra mensaje "bloqueado".

---

## 2 · Escenarios obligatorios

### Escenario 1 — Alicia restore

Pre-condición: el usuario tiene progreso guardado en Alicia (>0 frases).

Pasos:
1. `/visor-v2-local/<alicia-id>`.
2. Esperar "Cargando…" → ver lista de oraciones aparecer.
3. Verificar header: `currentIndex` ≠ 0 (restored).
4. Click "Reproducir".
5. Reproducir 10 frases (manualmente o autoavance).

Validar:
- [ ] no divergence (frase activa coincide con audio)
- [ ] no stale visibility (panel: visualReady true alineado con currentIndex)
- [ ] no duplicate play (panel events: 1 audio.start por frase, no 2)
- [ ] no audio overlap (escuchar)
- [ ] preload estable (panel: preloadReady > 0)
- [ ] currentIndex correcto al final (esperado = restored + 10)

Resultado: `____` (PASS / FAIL — anotar bugs en sección 4)

---

### Escenario 2 — Guerra de los mundos desde 0

Pasos:
1. `/visor-v2-local/<guerra-id>`.
2. (Si tiene progreso, primero limpiar via dataService o usar otro usuario.)
3. Verificar `currentIndex=0`.
4. Click "Reproducir".
5. Reproducir 5 frases (autoavance).

Validar:
- [ ] autoavance continuo (sin clicks intermedios)
- [ ] preload hits (panel events: `preload.hit` aparece)
- [ ] cleanup correcto (panel: `audios=1` durante todo el ciclo)

Resultado: `____`

---

### Escenario 3 — Tercer libro distinto

Pasos:
1. `/visor-v2-local/<otro-id>` (libro sin manifest TTS pre-generado, si lo hay).
2. Reproducir 5 frases.

Validar:
- [ ] manifest fallback (Network tab: `/uploads/audio/<id>/manifest.json` puede 404)
- [ ] TTS fallback funciona (Network tab: `/api/tts` POST con audio/* response)
- [ ] no contaminación cross-content (frases mostradas son del libro nuevo)

Resultado: `____`

---

### Escenario 4 — Cambio rápido entre libros

Pasos:
1. Abrir libro A.
2. Click play, esperar 2s.
3. Inmediatamente: `/visor-v2-local/<B-id>` (cambio sin pausar).
4. Inmediatamente: `/visor-v2-local/<C-id>`.
5. Inmediatamente: volver a `/visor-v2-local/<A-id>`.

Validar:
- [ ] no audio fantasma (silencio entre cambios; sin audio del libro anterior sonando)
- [ ] no listeners huérfanos (panel: `audios=1` o 0 entre cambios)
- [ ] no stale callbacks (panel: trace muestra `binder.release.session` para A, B, C anteriores)
- [ ] no preload residual (panel: `preload=0` justo después de cada switch)
- [ ] currentIndex correcto al volver a A (restore)

Resultado: `____`

---

### Escenario 5 — Timer complete

Pasos:
1. Asegurar nivel ≠ 5 (usar nivel 1 = 40s para prueba rápida).
2. Reproducir.
3. Esperar el complete del timer (40s en nivel 1).

Validar:
- [ ] header muestra "Sesión completada"
- [ ] audio se detiene (no autoplay zombie)
- [ ] botón "+5 minutos" aparece
- [ ] no loop audio (audio NO reinicia solo)
- [ ] UI coherente (panel: status='paused')

Resultado: `____`

---

### Escenario 6 — +5 minutos

Pasos:
1. Tras escenario 5, click "+5 minutos".
2. Reproducir 1 frase.

Validar:
- [ ] timer reset (no completa de nuevo en 0s)
- [ ] no doble timer (panel: NO ver setTimeout overlapping)
- [ ] playback intacto (audio reanuda desde currentIndex)

Resultado: `____`

---

### Escenario 7 — Pause/resume spam

Pasos:
1. Reproducir.
2. Click play/pause/resume rápido (>10 clicks en <2s).

Validar:
- [ ] no promises colgadas (DevTools console sin unhandled rejection)
- [ ] no race visible (snapshot.status final coherente con último click)
- [ ] no double audio (escuchar)
- [ ] no stale status (panel: trace muestra `queue.start` por cada dispatch, FIFO)

Resultado: `____`

---

### Escenario 8 — goTo spam (anterior/siguiente rápido)

Pasos:
1. Reproducir.
2. Click anterior/siguiente rápido (>20 clicks).

Validar:
- [ ] preload cancel correcto (panel: `preload.abort` aparece)
- [ ] no overlap audio (escuchar)
- [ ] no stale play (audio coincide con currentIndex final)
- [ ] índice estable (header coherente)

Resultado: `____`

---

### Escenario 9 — TTS fail simulado

Setup: usar Network tab DevTools → "Block request URL" para `*/api/tts*`.

Pasos:
1. Abrir libro sin manifest pre-generado (cae a TTS).
2. Reproducir.

Validar:
- [ ] `audio_unavailable` o `tts_fetch_failed` explícito (panel: trace o snapshot.lastError)
- [ ] viewer NO colapsa (sigue mostrando frase, status=error o paused según mapping)
- [ ] click "Reintentar" → recover ejecuta (panel: `recover.start`/`done`)

Resultado: `____`

---

### Escenario 10 — Autoplay blocked real

Setup: Chrome → Settings → Privacy → Site Settings → Sound → "Allow sites to play sound": **Disable** para localhost.

(O abrir nueva tab incognito, ir directo a `/visor-v2-local/<id>` SIN haber tenido user gesture previo.)

Pasos:
1. Visitar la ruta tras habilitar el block.
2. Click play (sí, contradictorio — algunos browsers bloquean igual).

Validar:
- [ ] `snapshot.lastError.kind === 'audio_autoplay_blocked'`
- [ ] banner "El navegador bloqueó la reproducción automática" aparece
- [ ] botón "Reintentar" visible
- [ ] click "Reintentar" → recover, status='ready'
- [ ] click play (con flag de Chrome restablecido) → audio funciona

Resultado: `____`

---

### Escenario 11 — Network throttling

Setup: Chrome DevTools → Network → Throttling → "Slow 3G".

Pasos:
1. Abrir un libro nuevo.
2. Esperar hidratación (puede ser 5-15s).
3. Reproducir.
4. Mientras carga, click prev/next.
5. Mientras carga, navegar a otro libro.

Validar:
- [ ] hydration lenta NO rompe runtime (no exception en console)
- [ ] preload abort correcto (panel: `preload.abort` al cambiar de libro)
- [ ] no freeze UI (botones siguen respondiendo)
- [ ] no stale session (al volver, sesión correcta)

Resultado: `____`

---

### Escenario 12 — Memory observation

Pasos:
1. Chrome DevTools → Memory → Take heap snapshot. Anotar "baseline" en MB.
2. Hacer 20 cambios de contenido (cycling A → B → C → A → B...).
3. Hacer 10 recoveries (forzar autoplay block + recover, repetir).
4. Hacer 10 play/pause loops por libro.
5. Forzar GC (Memory tab → trash icon).
6. Take heap snapshot. Anotar "post-stress".

Validar:
- [ ] heap NO crece linealmente (post-stress - baseline < 50% del baseline)
- [ ] objectURLs liberados (`__immersiveV2Stack._state().adapterState.totalUrls` ≈ 0)
- [ ] listeners estables (`audiosTracked` ≈ 0 después de unmount)
- [ ] no runaway diagnostics (`diagnostics.getRecentEvents().length` ≤ 5000 cap)

Resultado: `____`

---

## 3 · Browser matrix

Mínimo:

| Browser | Versión | Probado | Notas |
|---|---|---|---|
| Chrome desktop | `___` | `___` | `___` |
| Firefox desktop | `___` | `___` | `___` |
| Safari desktop | `___` | `___` | `___` |
| Android Chrome | `___` | `___` | `___` |

Por browser, anotar:
- Autoplay behavior (¿bloquea inmediato o solo en user-not-active?)
- Audio events behavior (¿`canplay` antes o después de `play().then()`?)
- Timing weirdness (lag visual vs audio)
- Recover behavior (¿re-play funciona tras recover?)

---

## 4 · Bug report

Llenar UNA fila por bug observado. Si todo pasa, dejar tabla vacía y anotar "ninguno".

| ID | Severidad | Browser | Escenario | Pasos | Esperado | Observado | Hipótesis | Fix mínimo |
|---|---|---|---|---|---|---|---|---|
| BUG-001 | `blocker\|high\|medium\|low\|cosmetic` | `Chrome 120` | `2` | ... | ... | ... | ... | ... |

---

## 5 · Runtime health summary

Marcar cada item con `sí` / `no` / `n/a` tras smoke completo:

| Invariante | Estado | Evidencia |
|---|---|---|
| stale callback corruption | `___` | `___` |
| hardResync loops | `___` | `___` |
| orphan listeners | `___` | `___` |
| leaked objectURLs | `___` | `___` |
| duplicate audio | `___` | `___` |
| cross-session contamination | `___` | `___` |
| recover reliability | `___` | `___` |
| autoplay reliability | `___` | `___` |
| preload reliability | `___` | `___` |
| cleanup reliability | `___` | `___` |

---

## 6 · Decisión final

Marcar UNA opción:

- [ ] **LISTO PARA M-5** — runtime sobrevivió la realidad del navegador sin colapsar arquitectónicamente. Bugs encontrados son ≤ medium y no tocan invariantes core.
- [ ] **NO LISTO** — volver al runtime para fix de blocker(s). Detallar en sección 4.

Firma + fecha:
- Operador: `Nicolas`
- Fecha: `____`
- Browsers cubiertos: `____`
- Total escenarios PASS: `___ / 12`
- Total bugs encontrados: `___` (`___` blocker, `___` high, `___` medium, `___` low, `___` cosmetic)

---

## 7 · Limpieza tras smoke (CRÍTICO)

Cuando M-4 cierre y se decida pasar a M-5 (o volver al runtime):

```bash
# Si se NO va a producción todavía: dejar el bloque DEV ONLY como está.
# Si se va a producción con V1 (sin V2 rollout): revertir el bloque local.
git diff App.tsx                # confirmar que solo está el bloque DEV ONLY
# Eliminar manualmente el bloque marcado y la <Route> /visor-v2-local
```

Y desactivar localStorage:

```js
localStorage.removeItem('IMMERSIVE_RUNTIME')
delete window.__IMMERSIVE_V2_DEBUG__
delete window.__immersiveV2Stack
```
