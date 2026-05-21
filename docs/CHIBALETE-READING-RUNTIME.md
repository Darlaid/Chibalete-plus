# Chibalete Reading Runtime (CRR) — Manifiesto canónico

> **Estado:** Fase 1 — consolidación documental. El CRR **no es nuevo código**: es el
> nombre canónico del runtime V2 que ya existe en `/engines/` y `/utils/immersiveV2/`,
> ahora extendido para servir a todos los modos de lectura (no solo inmersivo).
>
> Este documento es el contrato de referencia. Si el código y este documento divergen,
> el código gana — pero ese drift es un bug que hay que cerrar.

---

## 1. ¿Por qué este documento existe?

El prompt arquitectónico v4 ("CHIBALETE READING RUNTIME / Phase 1") pedía construir
desde cero un `src/runtime/` con `ReadingSessionRuntime`, `AudioRuntime`,
`VisibilityRuntime`, etc. **Casi todo eso ya existía** como Inmersivo V2, hardened a
lo largo de los sprints M-1 → M-5.4.14:

- 8 estados legales con tabla de transiciones explícita.
- LifecycleToken monotónico anti-stale-callback.
- OpenLock promise-chain anti-starvation.
- Visibility invertida (viewer reporta, runtime espera).
- Diagnostics ring-buffer con `exportTrace(sessionId)`.
- Feature flag canary determinista (FNV-1a) coherente front↔back.
- 8 adapters de producción + tests integración + isolation audit.

Crear un tercer runtime paralelo violaría las restricciones del propio prompt
("no sobreingeniería", "no microservicios", "convivir con v1 actual") y las del
`CLAUDE.md` ("cambios mínimos y localizados").

Por eso esta Fase 1 hace lo opuesto a "construir": **consolida** el V2 como CRR
canónico y agrega la capa mínima que falta para extenderlo a los demás modos
(accesible, guiado, PDF, álbum) **sin tocar los visores ni el V2 existente**.

---

## 2. Mapa: prompt v4 → archivos reales

| Pedido prompt v4                              | Archivo real (CRR)                                       |
|-----------------------------------------------|----------------------------------------------------------|
| `runtime/core/ReadingSessionRuntime.ts`       | `engines/ImmersiveSession.mjs` + `engines/ImmersiveRuntime.mjs` |
| `runtime/core/AudioRuntime.ts`                | `engines/AudioRuntime.mjs`                               |
| `runtime/core/VisibilityRuntime.ts`           | `engines/VisibilityCoordinator.mjs`                      |
| `runtime/core/SnapshotRuntime.ts`             | `engines/RuntimeStore.mjs` + `utils/runtimeMemorySnapshot.mjs` |
| `runtime/core/EventRuntime.ts`                | `engines/Diagnostics.mjs`                                |
| `runtime/core/RuntimeCoordinator.ts`          | `engines/ImmersiveRuntime.mjs` (factory + openLock)      |
| `runtime/core/RuntimeTypes.ts`                | `engines/immersiveRuntimeTypes.d.ts`                     |
| `runtime/hooks/useReadingRuntime.ts`          | `utils/immersiveRuntimeV2Bridge.mjs` + bridge en `pages/VisorInmersivoV2.tsx` |
| `runtime/hooks/useRuntimeVisibility.ts`       | Inverso: `reportFromViewer` en `VisibilityCoordinator`   |
| `runtime/hooks/useRuntimeRecovery.ts`         | `recover.start`/`done`/`fail` diagnostics + audio failure memoization en `AudioRuntime` |
| `runtime/diagnostics/runtimeMetrics.ts`       | `engines/metricsEngine.ts` + counters en `ImmersiveRuntime` |
| `runtime/diagnostics/driftDetector.ts`        | **Eliminado a propósito en M-5.4.6 phase 1.a.** Ver §6.  |
| `runtime/diagnostics/recoveryMetrics.ts`      | `Diagnostics` events `recover.*` + `audio.acquire.*`     |
| `runtime/adapters/immersiveAdapter.ts`        | `utils/immersiveV2/*` (8 adapters)                       |
| `runtime/adapters/{accessible,guided,pdf,album}Adapter.ts` | `engines/readingAdapters/*` (esta fase)         |
| `runtime_v2_enabled` flag                     | `utils/immersiveRuntimeFlag.ts` (immersive) + `utils/readingRuntimeFlag.ts` (multi-modo) |

---

## 3. Estados legales (canónico)

Los 8 estados del CRR están definidos en `engines/immersiveRuntimeTypes.d.ts`
como `SessionStatus`:

```
idle → opening → ready → playing ⇄ paused → closing → closed
                  ↓        ↓         ↓
                error → closing → closed
```

Transiciones explícitas en `engines/ImmersiveSession.mjs` (`TRANSITIONS`). Cualquier
intento de transición fuera de la tabla lanza `invalid_transition`. Estados ambiguos
y flags sueltos están **prohibidos** — el snapshot inmutable de `RuntimeStore` es la
única superficie pública.

Equivalencia con los estados pedidos por el prompt v4:

| Prompt v4   | CRR canónico                                           |
|-------------|--------------------------------------------------------|
| opening     | `opening`                                              |
| ready       | `ready`                                                |
| playing     | `playing`                                              |
| paused      | `paused`                                               |
| background  | derivado de `visibility.timeout` + status preservado   |
| recovering  | derivado de `recover.start` → `recover.done\|fail`     |
| closing     | `closing`                                              |
| closed      | `closed`                                               |
| error       | `error`                                                |

`background` y `recovering` **no son estados separados** — son trayectorias del state
machine reportadas vía Diagnostics. Esto evita la combinatoria de estados simultáneos
que el prompt explícitamente prohíbe.

---

## 4. Familia de eventos (autoridad única)

Todos los eventos del runtime viven en `Diagnostics` y están enumerados en
`DiagnosticEventKind` (`engines/immersiveRuntimeTypes.d.ts`). El prompt v4 pedía
eventos canónicos; los nuestros son:

| Prompt v4 (sugerido)        | CRR (real)                                              |
|-----------------------------|----------------------------------------------------------|
| reading_started             | `session.ready` (+ primera `state.transition` → playing) |
| reading_resumed             | `state.transition` paused → playing                      |
| reading_paused              | `state.transition` playing → paused + `audio.pause`      |
| reading_completed           | `session.closed` con `reason: 'completed'`               |
| paragraph_completed         | `progress.scheduled` / `progress.flushed`                |
| focus_lost                  | `visibility.timeout` + report `{ visible: false }`       |
| focus_recovered             | `visibility.report` `{ visible: true }`                  |
| recovery_executed           | `recover.start` → `recover.done`                         |
| drift_detected              | **N/A** — ver §6                                         |
| audio_reconciled            | `audio.acquire.canplay` + `audio.acquire.play_resolved`  |
| session_restored            | `session.opened` + viewer.openSession.done               |

No introducir nombres nuevos. Si necesitás semántica adicional, agregá un
`DiagnosticEventKind` y un test que lo cubra.

---

## 5. Snapshot inmutable

Definido en `RuntimeSnapshot` (`engines/immersiveRuntimeTypes.d.ts`).
`getSnapshot()` devuelve un objeto **frozen**. Esta es la única forma legítima de
leer el estado del runtime desde un viewer o tool de debugging. Campos clave:

- `sessionId`, `contentId`, `userId`, `lifecycleToken` (identidad).
- `status` (8 estados).
- `currentIndex`, `totalIndices`.
- `visualReady` (¿el viewer confirmó visibilidad del current?).
- `isPlaying`, `audioState`, `audioUrlLoaded` (diagnostic enrichments M-4.2).
- `pendingTransition`, `playbackGeneration` (observabilidad).

`subscribe(listener)` notifica tras cada `replace`. Listeners aislados — un throw
no rompe la difusión.

---

## 6. Por qué NO hay drift detector

El prompt v4 pide `driftDetector.ts`. **Hubo uno y se eliminó intencionalmente en
M-5.4.6 phase 1.a.** Los motivos están comentados in-situ en
`hooks/useImmersivePlayback.ts:616` y archivados en
`docs/M5.4.10-perceptual-stabilization.md`:

1. El drift detector mezclaba dos señales distintas (drift visual real vs. avance
   intra-chunk legítimo) y disparaba `hard_resync` sobre lecturas válidas.
2. Las grace windows que lo acompañaban (`lastAdvanceWithinChunkAt`,
   `lastManualNavAt`) crecían como código defensivo no testeable.
3. La fuente real de drift (active-sentence-buffer corrupto) se cubrió en su lugar
   con el contract validator (`utils/__tests__/activeSentenceContract.test.js`) y
   `validateActiveSentenceVisibility`.

Reintroducir un drift detector sería **regresión arquitectónica**. Si encontrás un
caso de drift no cubierto por el contract validator, agregar test al validator —
no resucitar el detector.

---

## 7. Feature flags — el flag actual y su extensión

### Flag inmersivo (legacy de esta capa)

`utils/immersiveRuntimeFlag.ts` resuelve `'v1' | 'v2'` para el visor inmersivo
con precedencia:

1. `killSwitch` → siempre V1.
2. `localStorage['IMMERSIVE_RUNTIME']` → override ops/QA.
3. `cohortPct + userId` → FNV-1a determinista, coherente con
   `server/lib/flags.js`.
4. Default → V1.

### Flag multi-modo (Fase 1, esta entrega)

`utils/readingRuntimeFlag.ts` extiende el resolver a todos los modos del CRR
(`immersive | accessible | guided | pdf | album`) con la misma precedencia y
default `'v1'` por modo. Cohortas separadas por modo permiten activar accesible
sin afectar inmersivo, etc. **Default OFF para los modos nuevos**: ningún visor
en producción cambia su comportamiento hasta que el operador suba la cohorte de
ese modo explícitamente.

### Adopción

Los visores **no** importan `readingRuntimeFlag` todavía. La adopción real
(cablear `VisorTexto`, `VisorPDF`, etc. al CRR) se decide visor-por-visor en
fases siguientes. Esta fase deja la infra lista.

---

## 8. Adapters por modo — esta entrega

`engines/readingAdapters/` contiene adapters thinly-wrapping `createImmersiveRuntime`
para cada modo no-inmersivo:

- `accessibleAdapter.mjs` — **sin audio** (corregido en Fase 2). VisorAccesible es
  un lector pure-text para tecnologías asistivas; no usa TTS. Mismo wiring que
  pdf/album (audioFactory NULL).
- `guidedAdapter.mjs` — TTS por frase, sin manifest pre-generado. VisorTexto
  (Modo Guiado) usa /api/tts on-demand.
- `pdfAdapter.mjs` — sin audio. Sesión + visibility por página.
- `albumAdapter.mjs` — sin audio per-sentence. Sesión + visibility por lámina.

Mapeo canónico UI ↔ adapter ↔ visor ↔ modo interno:

| Etiqueta UI       | Adapter            | Visor file              | Mode interno |
|-------------------|--------------------|-------------------------|--------------|
| Modo Inmersivo    | (usa V2 directo)   | VisorInmersivoV2.tsx    | `immersive`  |
| Modo Guiado       | `guidedAdapter`    | VisorTexto.tsx          | `text` (legacy alias `accessible`) |
| Modo Accesible    | `accessibleAdapter`| VisorAccesible.tsx      | `a11y`       |
| Modo Visual (PDF) | `pdfAdapter`       | VisorPDF.tsx            | `pdf`        |
| Modo Álbum        | `albumAdapter`     | VisorAlbum.tsx          | `album`      |

Cada adapter exporta un factory `createXxxAdapter(deps)` que retorna una instancia
de runtime con la configuración correcta del modo. **No tienen side effects a
import-time** — son factories puras.

El inmersivo sigue usando los adapters históricos en `utils/immersiveV2/`. Los
nuevos adapters NO los reemplazan; los complementan para los modos restantes.

---

## 9. Lo que esta Fase 1 NO toca

Para cumplir "convivir con v1 actual" y "no romper producción":

- `App.tsx` — routing intacto.
- `pages/VisorInmersivo.tsx` (V1) — sigue siendo el camino productivo.
- `pages/VisorInmersivoV2.tsx` (V2 inmersivo) — intacto.
- `pages/VisorTexto.tsx`, `VisorPDF.tsx`, `VisorAlbum.tsx` — intactos.
- `hooks/useImmersivePlayback.ts` — intacto.
- `utils/immersivePlaybackMachine.js` — intacto.
- Todos los archivos en `/engines/` previos a esta fase — intactos.
- `package.json` — solo se agrega un script standalone `test:reading-runtime`.
- `npm run verify` y `test:immersive-v2` — sin cambios de comportamiento.
- Aula Viva, Leo, backend longitudinal — intactos.

---

## 10. Próximas fases (no implementadas)

Esta lista es para orientar el trabajo futuro; **no es un compromiso**. Cada fase
debe abrirse con su propio prompt y validación.

### Fase 2 — adopción del CRR en visor accesible

- Bridge real para `accessibleAdapter` en `VisorTexto.tsx` (gated por flag a 1%).
- Tests de integración accesible + smoke browser.
- Sunset progresivo del path `'accessible'` legacy (`utils/readerMode.ts`).

### Fase 3 — adopción en guiado

- Similar a Fase 2 para Modo Guiado.

### Fase 4 — adopción en PDF + álbum

- Conectar `pdfAdapter` y `albumAdapter`. Acá la ganancia es solo lifecycle +
  progress unificado (no hay audio).

### Fase 5 — sunset del V1 inmersivo

- Cuando el V2 esté en cohorte 100% durante N semanas sin regresión, eliminar
  `pages/VisorInmersivo.tsx` y `hooks/useImmersivePlayback.ts`.

### Fase 6 — Media Session API

- Integrar `navigator.mediaSession` (metadata + playbackState + handlers) en
  `AudioRuntime`. Es aditivo y no rompe contratos. Se posterga porque introducirlo
  ahora exigiría tests en mobile real (Chrome Android, Safari iOS), fuera del
  alcance de Fase 1.

---

## 11. Cómo trabajar contra este documento

Si tenés que tocar el CRR:

1. **Leé este doc + el `.d.ts` de tipos** antes que el `.mjs`. Los tipos son el contrato.
2. **No agregues estados** a `SessionStatus`. Agregá eventos a `DiagnosticEventKind`
   si necesitás semántica nueva.
3. **No reintroduzcas drift detector**. Cubrí el caso real con un test de contrato.
4. **No mezcles modos** en un mismo adapter. Cada modo tiene su factory.
5. **Tests con `node` directo**, sin frameworks. Patrón en
   `utils/__tests__/immersiveRuntimeFlag.test.mjs`.
6. **Cualquier cambio al flag debe quedar coherente con `server/lib/flags.js`**
   (mismo FNV-1a, misma precedencia). Hay un test estructural que lo verifica.

---

## 12. Riesgos conocidos

| Riesgo                                                    | Mitigación actual                           |
|-----------------------------------------------------------|---------------------------------------------|
| Triple runtime (V1 + V2 + nuevo) drift                    | Esta fase NO crea triple stack. CRR = V2.   |
| Adopción incompleta de adapters → modos sin lifecycle     | Default OFF + roadmap explícito en §10      |
| Eventos del Diagnostics consumidos por código viejo       | `Diagnostics.subscribe` es opt-in           |
| Tests del flag rotos si server/lib/flags.js cambia        | Test estructural valida el espejo FNV-1a    |
| Adapters PDF/álbum reciben audioFactory por error         | Factory NULL_FACTORY explícito en cada uno  |

---

## 13. Fase 2 — Adopción en VisorAccesible + VisorTexto (observation mode)

Fase 2 incorpora el CRR a los dos visores de lectura no-inmersivos en **modo
observación**: el bridge corre en paralelo a los lifecycles existentes pero
NO toca audio, focus, screen readers ni navegación. Default OFF; rollback
instantáneo vía `localStorage.removeItem` o killswitch.

### 13.1 Qué se cableó

| Pieza nueva                            | Ubicación                                          | Función |
|----------------------------------------|----------------------------------------------------|---------|
| Núcleo del bridge (puro JS)            | `utils/readingRuntimeBridgeCore.mjs`               | Factory `createBridgeSession` — runtime con audio NULL, abre sesión, persiste snapshot, reporta visibility. Testeable en node sin React. |
| Hook React (wrapper fino)              | `hooks/useReadingRuntimeBridge.ts`                 | Delegación al core + ciclo React. Sin lógica propia. |
| Persistencia snapshot                  | `utils/readingRuntimeSnapshotStore.{mjs,d.ts}`     | localStorage con clave `crr_snap__<mode>__<userId>__<contentId>`; TTL 30 días; versión 1. |
| Resolver multi-modo (split .mjs+.d.ts) | `utils/readingRuntimeFlag.{mjs,d.ts}`              | Migración del .ts de Phase 1A al patrón `groupMembership` para tests node-only. |
| Fix `accessibleAdapter`                | `engines/readingAdapters/accessibleAdapter.mjs`    | **Audio NULL** (era TTS por error). VisorAccesible no tiene audio. |
| Wire VisorAccesible                    | `pages/VisorAccesible.tsx` (+1 import +5 líneas)   | `useReadingRuntimeBridge({ mode: 'accessible', ... })`. |
| Wire VisorTexto                        | `pages/VisorTexto.tsx` (+1 import +9 líneas)       | `useReadingRuntimeBridge({ mode: 'guided', enabled: !loading && sentences.length > 0, ... })`. |

### 13.2 Qué NO se tocó (intencional)

- `useA11yAnalytics` (telemetría existente del visor accesible) — sigue emitiendo a `/api/v1/events` idéntico.
- `useBackboneReadingSession` (telemetría del Modo Guiado) — sigue emitiendo eventos `text.*` idéntico.
- TTS de VisorTexto (`audioRef`, `/api/tts`, `setIsPlaying`, etc.) — sigue 100% en el path legacy. Migrarlo es Fase 3.
- `useA11yReaderNavigation` y los `IntersectionObserver` — siguen siendo la autoridad de visibilidad por párrafo.
- Settings, focus management, screen readers, navegación por teclado — sin cambios.
- `pages/VisorPDF.tsx` y `pages/VisorAlbum.tsx` — pendientes (Fase 4).

### 13.3 Cómo activar el flag (QA / smoke)

```js
// Antes de navegar al visor, en consola browser:
localStorage.setItem('READING_RUNTIME__accessible', 'v2');  // Modo Accesible
localStorage.setItem('READING_RUNTIME__guided', 'v2');      // Modo Guiado

// Rollback:
localStorage.removeItem('READING_RUNTIME__accessible');
localStorage.removeItem('READING_RUNTIME__guided');
```

Cohortes por backend siguen 0% (default). El bridge respeta el killswitch
(env var futura) sobre cualquier override.

### 13.4 Qué bugs reales aparecen visibles (con flag ON)

Observation mode NO arregla comportamiento — pero expone vía `Diagnostics`
eventos que hoy NO existen para visores no-inmersivo: `session.opened`,
`state.transition`, `visibility.report`, `session.closed`. Permite:

1. Detectar visibility races invisibles (foco perdido vs. usuario pausa).
2. Detectar cleanup faltante — desmonte sin `dispose` queda registrado.
3. Validar recovery local: snapshot persiste `currentIndex` y al reabrir
   el libro el bridge arranca con `startIndex` heredado.

Estas señales NO modifican comportamiento; alimentan decisiones de Fase 3.

### 13.5 Tests añadidos en Fase 2

```
npm run test:reading-runtime
```

| Suite                                                 | Asserts |
|-------------------------------------------------------|---------|
| `readingRuntimeFlag.test.mjs`                         | 37      |
| `engines/readingAdapters/__tests__/adapters.test.mjs` | 62      |
| `readingRuntimeSnapshotStore.test.mjs`                | 21      |
| `readingRuntimeBridgeCore.test.mjs`                   | 24      |
| `useReadingRuntimeBridge.structural.test.mjs`         | 18      |
| **Total Fase 2**                                      | **162** |

Sin regresión en `npm run test:immersive-v2` (V2 isolation VERDE, 25
archivos visitados, ninguno V2 importa V1).

### 13.6 Riesgos restantes

| Riesgo                                                                | Severidad | Mitigación                                                  |
|-----------------------------------------------------------------------|-----------|-------------------------------------------------------------|
| Doble sesión observable (backbone + CRR observation)                  | Bajo      | Ambas señales son aditivas; documentado en §13.2            |
| Snapshot localStorage compite con sessionStorage de Leo               | Bajo      | Claves prefijadas distinto (`crr_snap__` vs `leo_session_`) |
| Hook se llama incondicionalmente; effect cuesta cuando v1             | Muy bajo  | Effect early-return; cero side effects con flag OFF         |
| Sentence count de VisorTexto cambia tras montar (regex async)         | Bajo      | `enabled` guard espera `text` y `sentences.length > 0`      |
| Vite no resuelve el .mjs core desde el .ts hook                       | Bajo      | `allowJs: true` + bundler resolution ya configurados        |

### 13.7 Próximas fases

- **Fase 3 — Migrar TTS de VisorTexto al `AudioRuntime`**: reemplaza
  `audioRef` + `/api/tts` manual por `AudioRuntime` del CRR. Alto riesgo
  funcional; requiere PR dedicado + smoke browser.
- **Fase 4 — Adopción en VisorPDF + VisorAlbum**: igual patrón que Fase 2
  pero con adapters NULL audio. Bajo riesgo.
- **Fase 5 — Sunset V1 inmersivo**: cuando V2 inmersivo esté en cohorte
  100% durante N semanas sin regresión.
