# Auditoría de accesibilidad — Modo Accesible (`/leer/accesible/:id`)

Esta carpeta hospeda los baselines (`baseline-YYYY-MM-DD.json` y `baseline-YYYY-MM-DD.md`) y artefactos de error de la auditoría axe-core sobre el visor accesible.

El runner es `scripts/a11y-baseline.mjs`. Se invoca desde npm.

---

## TL;DR

```bash
# Setup único en la máquina
npm install --no-save playwright @axe-core/playwright
npx playwright install chromium

# En 3 terminales
npm run server         # backend Express :3000
npm run dev            # frontend Vite   :5173
USER_ID=u-001 CONTENT_ID=libro-quijote npm run a11y:test
```

Resultado: `docs/a11y/baseline-{fecha}.json` + `baseline-{fecha}.md` archivados, resumen en consola.

---

## Modos disponibles

| Comando | Comportamiento ante violations critical/serious | Cuándo usar |
|---|---|---|
| `npm run a11y:test` | ⚠ **Warning** (exit 0). El archivo se guarda igual. | Local, exploratorio, post-merge informativo |
| `npm run a11y:ci`   | ❌ **Falla** (exit 1) con `--strict`.            | Pipelines CI cuando se quiera enforce |

Hoy ningún build/CI bloquea. El gate es **opcional**: `a11y:ci` se incorpora a un job de CI solo cuando el equipo decida elevar el nivel.

---

## Pre-requisitos

### Dependencias

`playwright` y `@axe-core/playwright` son **devDeps opt-in** del operador. **No** están en `package.json` para no engordar instalación de quien no audita.

```bash
npm install --no-save playwright @axe-core/playwright
npx playwright install chromium
```

`--no-save` evita modificar `package.json`. Para uso recurrente, agregarlas explícitamente a `devDependencies`.

### Servidores arriba

El visor real depende de:
- **Vite dev server** en `:5173` (`npm run dev`).
- **Backend Express** en `:3000` (`npm run server`).

Sin alguno, el script falla con timeout en `article > h1` y guarda screenshot diagnóstico.

### `USER_ID` y `CONTENT_ID` reales

| Variable | Origen |
|---|---|
| `USER_ID` | Un ID que exista en `data/users_db.json` (mock del login vía localStorage) |
| `CONTENT_ID` | Un Content del catálogo con `texto_plano_url` no vacía |

Si el `USER_ID` no existe, `AuthContext` limpia storage y redirige a `/`. Si el `CONTENT_ID` no existe o el user no tiene acceso, `AccessWrapper` muestra `AccessDeniedView`. En ambos casos el script falla con timeout.

---

## Variables de entorno

| Var | Default | Notas |
|---|---|---|
| `USER_ID` | _(requerida)_ | id en `data/users_db.json` |
| `CONTENT_ID` | _(requerida)_ | id en catálogo con `texto_plano_url` |
| `BASE_URL` | `http://localhost:5173` | dev server Vite |
| `OUT_DIR` | `docs/a11y` | se crea con `mkdir -p` |
| `TIMEOUT_MS` | `60000` | espera total de `article > h1` |
| `HEADLESS` | `true` | `false` para ver el browser durante la corrida |
| `A11Y_STRICT` | `false` | equivalente a flag `--strict` |
| `A11Y_SUMMARY` | `true`  | `false` para suprimir el `.md` |

Los flags CLI **prevalecen** sobre las env vars (más portables en Windows):
- `--strict`     → falla con critical/serious
- `--no-summary` → suprime el `.md`

---

## Output

Cada corrida produce hasta 3 archivos en `docs/a11y/`:

| Archivo | Cuándo |
|---|---|
| `baseline-YYYY-MM-DD.json` | Siempre (resultado axe completo + meta de la corrida) |
| `baseline-YYYY-MM-DD.md`   | Default. Suprimible con `--no-summary` |
| `baseline-YYYY-MM-DD-error.png` | Solo si timeout esperando el documento |

Los archivos del día se **sobrescriben** si se corre múltiples veces. Es deliberado — son "el baseline del día". Si se requiere histórico intra-día, ajustar el formato del nombre en el script.

### Shape del JSON

```jsonc
{
  "meta": {
    "generatedAt": "...",
    "baseUrl":     "...",
    "targetUrl":   "...",
    "userId":      "...",
    "contentId":   "...",
    "playwright": {
      "browser":       "chromium",
      "headless":      true,
      "reducedMotion": "reduce",
      "viewport":      { "width": 1280, "height": 800 }
    },
    "axeTags":   ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
    "durationMs": 4823
  },
  "results": { /* shape estándar de axe-core */ }
}
```

### Shape del summary.md

- **Resultado** (PASS/WARN/FAIL).
- Tabla por severidad.
- Tabla de violations con link a la documentación de Deque.
- Detalle con primeros 3 selectores por regla.
- Lista de reglas incompletas (revisar a mano — típicamente contraste).
- Metadata de la corrida embebida.

Útil como *artifact* de PR o pegado directamente en un comentario.

---

## Cómo interpretar resultados

### Severidades (impact axe)

| Impact | Significado | Acción |
|---|---|---|
| **critical** | Hace inaccesible para usuarios con AT (lector de pantalla o sólo teclado). | **Corregir antes de merge** |
| **serious** | Reduce significativamente la accesibilidad. | Corregir en sprint actual |
| **moderate** | Problemas notorios pero el contenido sigue accesible. | Backlog priorizado |
| **minor** | Mejoras menores / best practices. | Backlog general |

### "Reglas incompletas"

axe no puede juzgar automáticamente algunos SC (típicamente contraste con fondos transparentes / con gradientes / con imágenes). Aparecen en `incomplete[]`. **Hay que revisarlas a mano** con devtools o un picker.

### "Reglas pasadas" / "no aplicables"

`passes` son verificaciones que el DOM cumplió. `inapplicable` son reglas que no aplican (ej. `image-alt` cuando no hay `<img>`). No requieren acción.

### Diagnóstico de fallas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Timeout en `article > h1`, redirect a `/#/` | `USER_ID` inválido | Verificar `data/users_db.json` |
| `AccessDeniedView` (locked icon en screenshot) | User sin acceso al contenido | Cambiar `CONTENT_ID` o ajustar reglas en `access_db.json` |
| Timeout, console errors `Failed to fetch` | Backend `:3000` caído | `npm run server` |
| Timeout, página en blanco | Vite `:5173` caído | `npm run dev` |
| `[a11y-baseline] ✗ Falta 'playwright'` | Deps no instaladas | `npm install --no-save playwright @axe-core/playwright` |
| violations explosivas en `color-contrast` | Modo dark-mode o variable CSS sin computar | Revisar tokens, especialmente outlines en hover |

---

## Cuándo usar cada modo

### `a11y:test` (warning, default) — usos típicos

- **Exploración local** mientras se desarrolla el visor accesible.
- **Post-merge informativo** en CI (solo loguea, no bloquea).
- **Triaging**: ver qué violations existen sin presionar el flujo.

### `a11y:ci` (strict) — usos típicos

- **Job dedicado en CI** para impedir regresiones en ramas que tocan visor accesible.
- **Manual antes de release** para confirmar que no hubo regresión.

---

## Limitaciones honestas

1. **axe encuentra ~30% de los issues reales**. NVDA/VoiceOver/JAWS detectan el resto. Este runner es **complementario** a las pruebas con AT humanas.
2. Audita solo el estado **"documento cargado"**. Loading, error y `AccessDeniedView` no se cubren — sprint aparte.
3. Una sola URL por corrida. Para auditar varios libros, hacer un loop en bash.
4. Sobrescribe el archivo del día. Cambiar el formato del nombre si se requiere histórico intra-día.
5. `USER_ID` / `CONTENT_ID` quedan en logs y archivos. Usar IDs de fixture, no IDs de producción sensibles.
6. El runner **no levanta servidores**. Si están abajo, falla con timeout y screenshot.

---

## Roadmap (no implementado todavía)

- Auditar también estados `loading` / `error` / `AccessDeniedView`.
- Loop sobre múltiples libros con un manifest opcional.
- Histórico intra-día (timestamp en filename).
- Integración con Lighthouse para complementar (sólo para SC perceptual).
- Auditoría manual con NVDA/VoiceOver — checklist en `docs/a11y/manual-checklist.md` (pendiente).

---

## Integración con CI (GitHub Actions)

El workflow `.github/workflows/a11y-baseline.yml` ejecuta `a11y:ci` automáticamente en:

- **`pull_request`**: PRs que tocan paths sensibles del visor accesible o el runner.
- **`push`** a `main`: snapshot informativo después de cada merge.
- **`workflow_dispatch`**: invocación manual desde la UI de GitHub, opcionalmente con `USER_ID`, `CONTENT_ID` y `strict` como inputs.

### Qué hace el job

1. Checkout + Node 20 + `npm ci`.
2. Instala `playwright` y `@axe-core/playwright` con `--no-save` (no tocan el lock).
3. Resuelve `USER_ID` y `CONTENT_ID` dinámicamente desde `data/users_db.json` y `data/content.json` (primer user con rol `lector` + primer Content con `texto_plano_url`). Los inputs de `workflow_dispatch` los sobrescriben si se pasan.
4. Levanta backend (`:3000`) y frontend (`:5173`) en background.
5. Espera a ambos con `curl` polling (sin instalar `wait-on`).
6. Ejecuta `npm run a11y:ci` con las env vars resueltas.
7. Postea el `summary.md` en el **GitHub Job Summary** (visible en la UI del run).
8. Sube **artifact** `a11y-baseline-${run_id}` con `baseline-*.json`, `baseline-*.md`, `baseline-*-error.png` y logs de servicios. Retención 30 días.
9. Mata procesos en background con `if: always()`.

### Estado actual: NO bloquea merges

El workflow puede fallar (job rojo) cuando hay violations critical/serious — esa es la señal real. **Pero no es un required check**: GitHub no bloquea merge a `main` por un job que no esté marcado como obligatorio en *branch protection*.

Hoy:
- Job rojo = revisar el artifact y arreglar antes de mergear (criterio del equipo).
- Merge no se impide automáticamente.

### Activación de bloqueo en CI (cómo elevarlo)

Cuando el equipo decida que `a11y:ci` debe **impedir** merge ante violations critical/serious:

1. **Confirmar baseline limpio**: hacer un run del workflow contra `main` y archivar el `summary.md` como referencia.
2. **Configurar branch protection** en el repo de GitHub (Settings → Branches → branch protection rule sobre `main`):
   - Activar "Require status checks to pass before merging".
   - En la lista de checks requeridos, marcar **`Audit /leer/accesible/:id`** (nombre del job declarado en el YAML).
3. **(Opcional)** elevar la cobertura a más rutas/libros: extender el workflow con una matriz de `CONTENT_ID` y declarar varios jobs.
4. **(Opcional)** integrar en un workflow más amplio: cuando exista un workflow `build` global, este job puede convertirse en un step dentro o quedar como workflow paralelo. Ambos válidos.

**Lo que NO hay que hacer al activar**:
- No quitar el flag `--strict` del comando `a11y:ci`. El gate vive ahí.
- No agregar `continue-on-error: true` al step de auditoría — eso anula el gate.
- No usar `a11y:test` en CI. Está pensado para uso local exploratorio.

### Flujo de vida del workflow rojo

| Cuándo | Qué hacer |
|---|---|
| Job rojo en PR de feature relacionada al visor accesible | Revisar artifact `summary.md`, corregir violations, push otra vez |
| Job rojo en PR de feature **no relacionada** al visor accesible | Es regresión accidental. Revisar diff, ver qué cambio desencadenó la violation, corregir |
| Job rojo en `push` a `main` | Hubo un merge que no corrió el workflow (path no sensible) y rompió accesibilidad. Issue inmediato + revertir o arreglar |
| Job timeout en `Wait for services` | Backend o frontend no levantó (revisar `.ci-logs/*.log` en artifact) |
| Job timeout en `Run axe baseline` | El visor no renderizó el documento. Revisar screenshot `baseline-*-error.png` en artifact |

### Costo estimado en minutos de CI

Cada run consume aproximadamente:
- Setup Node + `npm ci`: ~30s
- Instalación de Playwright + Chromium con `--with-deps`: ~60–90s
- Levantar servicios + esperarlos: ~10–30s
- Auditoría axe: ~5–10s
- Cleanup + artifact upload: ~10s

**Total típico: 2–3 minutos por run.** En PR el `concurrency.cancel-in-progress` reemplaza runs anteriores cuando llega un push nuevo, así no se acumulan.

---

## Backlog — Fases 2+ del Modo Accesible

Este sprint cerró Fase 1 (presets, TOC sync, scroll natural, refinamientos UX, sidebar). Las siguientes fases requieren validación humana, decisiones de producto, o coordinación con backend. Quedan documentadas para cuando sus dependencias estén resueltas — **NO se implementan unilateralmente**.

### Fase 2 — alta prioridad

#### Validación NVDA / VoiceOver (sección #4 del ticket original)

- **Qué falta**: checklist formal de prueba manual con resultados archivados. Cubre: navegación por headings, landmarks, lectura de párrafos, cambio ES/EN, menú Lectura, presets, regla focal, botón Volver, TOC, estados loading/error/access denied.
- **Dependencias**: humano con NVDA + Firefox (Windows) y VoiceOver + Safari (macOS). axe no detecta el ~70% de los issues que solo se ven con AT real.
- **Riesgos**: declarar conformidad WCAG 2.2 AA sin esta validación es deshonesto. Bloquea VPAT/ACR (Fase 4) y `a11y:ci` como required check.
- **Entregable**: `docs/a11y/manual-screen-reader-checklist.md` con matriz de resultados y issues detectados.

#### Dataset editorial accesible (sección #5)

- **Qué falta**: 5 fixtures representativos (prosa larga, diálogo, poesía, bilingüe ES/EN, texto corto) con `texto_plano_url` (y `texto_ingles_url` en al menos uno).
- **Dependencias**: decisión editorial (qué textos usar — dominio público / propios / sintéticos). NO usar copyright sin autorización.
- **Riesgos**: hoy solo 2 contents tienen `texto_plano_url` y 1 tiene inglés. Sin fixtures variados no se puede validar parser, regla focal y bilingüe en condiciones reales. Tampoco la matriz de `a11y-baseline.yml` cubre la diversidad esperada.
- **Entregable**: `data/content.json` extendido + `public/uploads/...` + `docs/a11y/fixtures.md`.

### Fase 3 — media prioridad

#### Mejorar fallback de idioma (sección #7)

- **Qué falta**: cuando user pidió `'en'` pero el libro no tiene traducción y el visor cae a español, anunciar visiblemente / vía aria-live: "Este libro aún no tiene versión en inglés. Se cargó en español." Sin loop, sin cambiar la preferencia global.
- **Dependencias**: ninguna técnica. Decisión de UX sobre dónde y cómo anunciar (inline en el panel de orientación, o solo polite live region, o ambos).
- **Riesgos**: bajo. Mejora UX honesta sin cambios estructurales.

#### Auditoría de hooks `return { ... }` sin `useMemo` (sección #9)

- **Qué falta**: grep en `hooks/` por `return {`. Para cada hook, evaluar si causa el bug clásico de "re-render por nueva ref del objeto retornado". Solo aplicar fixes seguros (envolver en `useMemo` con deps correctas).
- **Dependencias**: ninguna. Sprint puramente técnico.
- **Riesgos**: medios. Si se cambia un hook usado en muchos lugares, hay que revisar consumers que dependieran del comportamiento de "nueva ref por render" (poco probable, pero posible).
- **Hooks ya verificados**: `useA11yReadingSettings`, `useA11yReaderNavigation`, `useA11yReadingSettings` (todos memoizados). Pendiente: `useBackboneReadingSession`, `useLuAnalytics`, `useAccessCheck`, otros del repo.

#### Progreso persistente (sección #6)

- **Qué falta**: persistir por usuario+contenido el último párrafo leído + idioma + ajustes + preset activo. Al reabrir, ofrecer continuar.
- **Dependencias**: decisión de scope. localStorage simple cubre el caso single-device pero no funciona cross-device. Backend (`progress_db.json` extendido) sí, pero requiere coordinación.
- **Riesgos**: forzar salto automático al último párrafo puede desorientar. Requiere UX explícito ("¿Continuar desde el párrafo X?" antes de saltar). No tocar `progress_db` sin decisión explícita del equipo de backend.

### Fase 4 — estratégico

#### Metadata EPUB Accessibility 1.1 (sección #12)

- **Qué falta**: extender shape `Content` con `a11yMetadata: { accessMode[], accessibilityFeature[], accessibilitySummary, accessModeSufficient[][], accessibilityHazard, conformsTo, certifiedBy }`. Mostrar resumen visible en el visor.
- **Dependencias**: backend coordinado para añadir el campo al shape. Editorial coordinado para auditar libros existentes y declarar metadata real (NO inventar).
- **Riesgos**: declarar metadata falsa rompe la conformidad EPUB. Es preferible omitir el campo a inventar valores.
- **Entregable**: `types/a11y.ts` extendido, `utils/accessibilityMetadata.ts` (nuevo), `components/accesible/A11yAccessibilitySummary.tsx` (nuevo).

#### VPAT / ACR draft (sección #10)

- **Qué falta**: documentación formal de conformancia. WCAG 2.2 AA / EPUB Accessibility 1.1 / EN 301 549. Estado por SC: supports / partially supports / does not support / not applicable + evidencia.
- **Dependencias**: validación NVDA/VoiceOver completa (Fase 2). Sin esa validación no hay evidencia honesta para declarar "supports".
- **Riesgos**: alto si se redacta antes. Un VPAT defensivo escrito al final del proyecto sin evidencia del proceso es debilidad legal. Hacerlo continuo a partir de Fase 2 es la única manera honesta.
- **Entregable**: `docs/a11y/VPAT-draft.md` y `docs/a11y/ACR-draft.md`.

#### Posicionamiento comercial (sección #11)

- **Qué falta**: copy institucional explicando qué es el Modo Accesible, para quién, qué lo diferencia (dislexia, baja visión, fatiga cognitiva, concentración, lectura bilingüe), y aclarando que NO reemplaza tecnologías asistivas.
- **Dependencias**: decisión de marketing y producto.
- **Riesgos**: bajo si se redacta con honestidad sobre limitaciones. Alto si se promete cumplimiento total prematuramente.
- **Entregable**: `docs/product/a11y-reader-positioning.md`.

#### Activar `a11y:ci` como required check (sección #8)

- **Qué falta**: configurar branch protection en GitHub para que el job `Audit /leer/accesible/:id` sea required. Ya documentado el procedimiento exacto en este README, sección "Activación de bloqueo en CI".
- **Dependencias**: baseline limpio (cero violations critical/serious sostenidas). Hoy el workflow corre con fixtures limitados (1 libro con inglés, 2 con texto plano).
- **Riesgos**: si se activa antes de tener baseline limpio, bloquea merges legítimos. Si se activa con fixtures pobres, da falsa sensación de cobertura. Esperar a Fase 2 (dataset editorial) y Fase 3 (validación AT real).

### Resumen de dependencias

```
Fase 1 (HOY)             → cerrada
   ↓
Fase 2 — NVDA/VoiceOver  → requiere humano
Fase 2 — dataset         → requiere producto/editorial
   ↓
Fase 3 — fallback idioma → estándar
Fase 3 — auditoría hooks → estándar
Fase 3 — progreso        → requiere decisión scope (local vs backend)
   ↓
Fase 4 — metadata EPUB   → requiere backend + editorial
Fase 4 — VPAT/ACR        → requiere Fase 2 completa
Fase 4 — posicionamiento → requiere marketing
Fase 4 — required check  → requiere baseline limpio (post Fase 2-3)
```

---

## Cambios recientes

- **CI integration**: workflow `.github/workflows/a11y-baseline.yml` con `pull_request`, `push` a main y `workflow_dispatch`. Job separado, no required check, sube artifacts always.
- **G1 cierre**: integración como gate opcional. `a11y:test` (warning) y `a11y:ci` (strict). Generación opt-in de `summary.md`. Documentación.
- **Sprint anterior**: creación del runner `scripts/a11y-baseline.mjs` con auth mock vía localStorage y diagnóstico al fallar.
