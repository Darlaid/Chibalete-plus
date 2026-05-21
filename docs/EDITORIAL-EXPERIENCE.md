# Editorial Experience — Fase 4

> **Estado:** Fase 4 — primera capa de "experiencia total".
> Cierra los 2 gaps visuales/UX de mayor leverage identificados en auditoría:
> portadas editoriales + `prefers-reduced-motion`. Los 15 sub-temas del prompt
> en su mayoría ya estaban resueltos en fases anteriores.

## 1. Por qué este documento existe

La auditoría 4 confirmó algo consistente con cada fase previa: el sistema ya
tiene mucho más cuidado del que el prompt asume. VisorAlbum es
cinematográfico, VisorTexto editorial, VisorInmersivo con line-spacing,
AulaVivaOperacional con severity semantics, Leo contextual no invasivo.

Los 2 gaps reales eran:

1. **Crop destructivo de portadas non-portrait.** `ContentCard.tsx` hacía
   `object-cover` que recortaba covers landscape, square o panorámicas para
   forzar formato vertical. El prompt explícitamente lo marca como CRÍTICO:
   "RESPETAR EL FORMATO REAL DE LAS CUBIERTAS".

2. **`prefers-reduced-motion` no respetado.** Cero implementación en toda la
   plataforma. VisorAlbum dispara confetti y orquesta easing asimétrico
   (50/80/130ms) sin chequear la preferencia del SO.

Esta fase cierra ambos sin reescribir nada existente.

## 2. Qué se agregó

| Pieza | Ubicación | Función |
|---|---|---|
| `EditorialCover` component | `components/editorial/EditorialCover.tsx` (138 líneas) | Detecta aspect-ratio intrínseco via `img.onLoad`, aplica framing respetuoso (portrait/landscape/square), skeleton mientras carga, fallback chain idéntico al legacy. `object-contain` siempre — NUNCA `object-cover`. |
| Opt-in en `ContentCard` | `components/ContentCard.tsx` (+30 líneas) | Helper `_editorialCoverEnabled()` lee `localStorage['EDITORIAL_COVER_SYSTEM']`. Si ON, reemplaza `<img>` por `<EditorialCover>`. Si OFF (default), código legacy intacto. Agrega `motion-reduce:` Tailwind classes a transitions. |
| `useReducedMotion` hook | `hooks/useReducedMotion.ts` (84 líneas) | `matchMedia('(prefers-reduced-motion: reduce)')` + listener. SSR-safe, defensivo (try/catch en initial + suscripción). Compat moderna (`addEventListener`) + legacy (Safari <14 `addListener`). |
| Integración en `VisorAlbum` | `pages/VisorAlbum.tsx` (+10 líneas, 3 spots) | (a) `narrativeTransition` → `'none'` cuando ON, preservando el easing 50/80/130ms cuando OFF. (b) Confetti del challenge_hit gated por `!reducedMotion`. (c) Confetti del completion gated por `!reducedMotion`. |
| Tests EditorialCover | `components/editorial/__tests__/EditorialCover.structural.test.mjs` | 47 asserts |
| Tests useReducedMotion | `hooks/__tests__/useReducedMotion.structural.test.mjs` | 27 asserts |

## 3. Cómo funciona EditorialCover

### 3.1 Detección de shape
Cuando la imagen carga, `<img>.onLoad` lee `naturalWidth` y `naturalHeight`.
La función pura `classifyAspectRatio(w, h)` clasifica:

- `ratio < 0.85` → `portrait` (libro tradicional, vertical)
- `ratio ∈ [0.85, 1.15]` → `square` (single, cómic cuadrado)
- `ratio > 1.15` → `landscape` (álbum apaisado, panorámico)
- inválido (NaN, 0, negativos, Infinity) → `unknown` (fallback a portrait)

El contenedor `<div>` lleva `style={{ aspectRatio: '2/3' | '3/2' | '1/1' }}`
según el shape detectado. La imagen usa `object-contain` siempre. El
resultado: el cover se ve TAL CUAL es, sin crop, dentro de un contenedor
que se adapta a su forma real.

### 3.2 Loading skeleton
Mientras `loaded === false`, un overlay con `animate-pulse` cubre el
contenedor. Cuando la imagen carga (o falla), `loaded` se vuelve `true` y
la imagen fade-in con `opacity-0 → opacity-100` en 300ms. Cero flash blanco.

### 3.3 Fallback chain
Idéntico al legacy:
1. URL original
2. Si contiene `maxresdefault.jpg` falla → reemplaza con `hqdefault.jpg`
3. Si sigue fallando → `ui-avatars.com` con el título
4. Si TODO falla → `loaded=true` (skeleton se va) y vemos el alt-text

### 3.4 Activación

```js
// QA / smoke local:
localStorage.setItem('EDITORIAL_COVER_SYSTEM', '1');
// reload página
```

Rollback:
```js
localStorage.removeItem('EDITORIAL_COVER_SYSTEM');
// o
localStorage.setItem('EDITORIAL_COVER_SYSTEM', '0');
```

Sin restart de servidor. Sin redeploy. El componente lee el flag por
render (no por session start).

## 4. Cómo funciona `useReducedMotion`

### 4.1 API
```ts
const reducedMotion = useReducedMotion(); // boolean
```

Devuelve `true` si el usuario tiene activado:
- macOS: System Preferences → Accessibility → Display → Reduce motion
- iOS: Settings → Accessibility → Motion → Reduce Motion
- Windows: Settings → Ease of Access → Display → Show animations
- Android: Settings → Accessibility → Remove animations
- DevTools: Rendering panel → Emulate CSS prefers-reduced-motion → reduce

### 4.2 Cobertura
- **VisorAlbum** (Fase 4): `narrativeTransition`, confetti hit, confetti completion.
- **ContentCard** (Fase 4): usa Tailwind `motion-reduce:` classes (no necesita el hook).
- **Otros visores**: NO refactorizado todavía. Tailwind `motion-reduce:` ya está
  parcialmente cubriendo via las clases CSS. El hook está disponible para
  refactor futuro de cualquier animación JS-driven.

### 4.3 Defensa
- SSR (window undefined) → `false` (default permisivo).
- `matchMedia` no existe → `false`.
- Subscription throw → estado inicial se mantiene, log silencioso.
- Cleanup robusto (`removeEventListener` moderno + `removeListener` legacy).

## 5. Garantías

### Sin crop destructivo
- `<img className="object-contain">` siempre. Test `[2]` confirma ausencia
  de `object-cover` en código activo.
- Contenedor con `aspectRatio` dinámico que se adapta al shape real.
- Test `[3]` valida los thresholds (0.85 / 1.15) con 7 casos canónicos.

### Sin breaking change en producción
- ContentCard mantiene el `<img object-cover>` legacy intacto en la rama
  `else` (test `[11]` confirma). Default OFF: cero cambio visual hasta
  que QA active el flag.

### Sin librerías nuevas
- Cero dependencias agregadas a `package.json`.
- Solo React + Tailwind + el `matchMedia` nativo del browser.
- `canvas-confetti` ya estaba — Fase 4 solo la condiciona, no reemplaza.

### Accessibility honrada
- `alt` obligatorio en `EditorialCoverProps` (test `[5]`).
- Skeleton `aria-hidden="true"`.
- `motion-reduce:` Tailwind classes en transitions.
- `useReducedMotion` para animaciones JS-driven.
- VisorAlbum confetti opt-out cuando preferencia activa.

### Defensivo
- `EditorialCover`: fallback chain de 3 pasos, `onError` con flag interno
  para no caer en loop infinito.
- `useReducedMotion`: try/catch en initial state + subscription, cleanup
  defensivo en unmount.

### Determinístico
- `classifyAspectRatio` es pura — mismos inputs producen misma clasificación.
- Test `[3]` valida con 7 casos de input fijos.

## 6. Lo que NO se hizo (defer)

| Cosa | Por qué se difirió |
|---|---|
| Cablear EditorialCover en Biblioteca/Búsqueda/PaginaDetalleLibro directamente | Por seguridad. ContentCard ya es opt-in via flag — esas páginas heredan automáticamente cuando se activa el flag. Wrapper extra sería redundante. |
| Refactor de los visores para `useReducedMotion` | VisorTexto, VisorInmersivo, VisorPDF ya usan principalmente Tailwind classes (motion-reduce: las cubre parcialmente). Refactor selectivo cuando se prioricen casos específicos. |
| Design tokens system (`tokens.ts`) | El repo usa Tailwind CDN deliberadamente; crear tokens TS sería cambio arquitectónico no pedido. |
| Onboarding completo | Prompt prohíbe "tours eternos". Requiere diseño UX con usuarios reales. |
| Route transitions con framer-motion | El prompt prohíbe librerías de animación pesadas; el jump abrupto es aceptable con Suspense spinner. |
| Leo focus-trap | Gap menor de a11y; el modal cierra con click + close button. Mejor abordarlo en sprint dedicado de a11y. |
| Editorial covers en visores grandes (VisorAlbum, VisorTexto gallery) | Esos visores ya usan `object-contain` correctamente. Solo afectados covers en ContentCard. |

## 7. Tests

```bash
node components/editorial/__tests__/EditorialCover.structural.test.mjs   # 47 ✓ / 0 ✗
node hooks/__tests__/useReducedMotion.structural.test.mjs                # 27 ✓ / 0 ✗
npm run test:analytics                                                   # 15 suites:
#   analyticsCanon                       46 ✓
#   insightMaterializer                  24 ✓
#   pedagogicalEngine                    29 ✓
#   scalability                          45 ✓
#   aulaVivaOperational                  31 ✓
#   outcomesEngine                       40 ✓
#   aulaVivaInstitutional                44 ✓
#   leoBackboneEmitter (Fase 2A)         60 ✓
#   leoPedagogicalSignals (Fase 2B)      70 ✓
#   longitudinalSummary (Fase 3A)       102 ✓
#   LongitudinalStudentTimeline (3A)     48 ✓
#   aulaVivaAuditEmitter (Fase 3B)       78 ✓
#   cohortLongitudinalSummary (3B)       80 ✓
#   EditorialCover (Fase 4)              47 ✓
#   useReducedMotion (Fase 4)            27 ✓
#                                      ───────
#                                       771 ✓ / 0 ✗
```

Sin regresión en `test:reading-runtime` (162/162). TS baseline: solo el
error pre-existente de `useImmersivePlayback.ts` (`canStartAudio`, viene
de cambios previos al sprint).

## 8. Próximas fases

- **Fase 4B (cuando se priorice)**: refactor selectivo de VisorTexto +
  VisorInmersivo para `useReducedMotion` JS-driven (resume toasts, route
  transitions ligeras).
- **Fase 5 (UX dedicada)**: Leo focus-trap + onboarding + tokens si se
  considera necesario tras observación con usuarios reales.
- **Fase 6 (performance)**: list virtualization en Biblioteca si la
  cantidad de libros crece, mejora de cover loading con IntersectionObserver
  custom si lazy nativo no es suficiente.
