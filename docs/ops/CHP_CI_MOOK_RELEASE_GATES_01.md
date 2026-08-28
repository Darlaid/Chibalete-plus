# CHP-CI-MOOK-RELEASE-GATES-01 — CIERRE DE VERIFICACIÓN AUTOMÁTICA

**Veredicto:** 🟢 **`GREEN-CI-MOOK-RELEASE-GATES`**
**Rama:** `chp/mook-contract-00` · **Commit:** `5f6fc64` · **Base:** `609aac5` · **Fecha:** 2026-08-28
**Cero producto, cero producción, cero deploy.** Diff: **3 archivos**, dos workflows y un test.

Cierra **`CHP-CI-FRONT-IMAGE-BUILD-COVERAGE-01`**, **`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01`** y
**«`test:mook` fuera de CI»**.

---

## 1. LA IMAGEN DE FRONTEND: EL DIAGNÓSTICO ERA IMPRECISO

La deuda decía «CI no construye `Dockerfile.front`». **La auditoría lo desmintió: sí lo construye**
—`security.yml:189`— pero dentro del job `trivy-image`, que:

- lleva **`continue-on-error: true`** («reporta CVEs de imagen base sin bloquear»), y
- **falla antes** de llegar a ese paso, porque escanea primero la imagen de API con
  `exit-code: "1"` sobre CVEs HIGH/CRITICAL.

Es decir: el build existía y **su señal era inalcanzable**. Por eso 01B llegó a producción con un
import que resolvía en el árbol completo pero no en la imagen — `Dockerfile.front` no copia `server/`.

### La corrección

El build de frontend se añade a **`image-integrity`**, que **sí bloquea** y que **ya es el job de
imágenes**… pero hasta ahora solo cubría la de **API**. Cerrar esa laguna es una ampliación honesta
del propósito declarado del propio job, no un injerto.

```yaml
- name: Build front image (Dockerfile.front real, gate bloqueante)
  run: docker build -f Dockerfile.front -t chibalete/front:integrity .
```

Mismo `Dockerfile.front`, mismo contexto, mismos argumentos no secretos que producción. Sin registry,
sin publicar, sin desplegar, sin secretos, con `permissions: contents: read`.

**Un `npm run build` no sustituye a esto**: solo el build real con el mismo Dockerfile reproduce la
frontera de qué archivos entran en la imagen.

---

## 2. `test:mook` EN CI

Se añade a **`identity-preflight`**, el preflight bloqueante de despliegue. La elección es honesta:
ese job **ya ejecuta suites de producto ajenas a identidad** —`test:memberships`,
`test:metric-contract`, `test:ai-model-compat`— y ya corría `typecheck` y `npm run build`. Es el gate
de release, no un job de identidad puro.

```yaml
- name: Suites MOOK (Experiencias, Studio, Runtime, cubierta y navegación)
  run: npm run test:mook
```

Es la suite **real y completa** —10 suites—, no una reducida ni duplicada. Un fallo produce exit
distinto de cero y bloquea.

**Filtros de ruta ampliados** con `pages/**`, `components/**`, `utils/**`, `engines/**`, `index.tsx`,
`App.tsx`, `vite.config.ts`, `nginx.prod.conf` y `.dockerignore`. Ampliar un filtro solo hace que el
job corra **más** veces, nunca menos: era justo la laguna por la que el arreglo de una regresión TS
en `components/` no disparaba el job que la había detectado.

---

## 3. EL FALSO FALLO EOL

`server/__test__/mookReview01.test.mjs:88` comprobaba «el mediador jamás pasa» así:

```js
assert.ok(!guardBody.includes('return true;\n    if (isMediatorRole'), 'el mediador jamás pasa');
```

**Ese literal es exactamente la forma del código CORRECTO** —`if (admin) return true;` seguido del
gate de mediador—. La aserción solo pasaba porque en Windows el archivo tiene **CRLF** y el patrón
con `\n` no casaba. **El blob en git está en LF**, así que **cualquier clon Linux la veía fallar
sobre código correcto**.

No era una diferencia funcional: el guard es idéntico en ambos casos. Reproducido en clon limpio a
`609aac5` con `server.js` en **LF (0 CRLF, 10 108 LF)** → **ROJO**.

### La corrección, mínima y más estricta

Se normalizan **CRLF, CR y LF** en el límite de comparación —**sin `trim`, sin colapsar espacios,
sin tocar orden ni contenido**— y la aserción pasa a expresar el invariante real, independiente del
terminador:

- existe **un solo** `return true` en el guard;
- es el del **administrador**, y está **antes** del gate de mediador;
- la rama del mediador cae en `MEDIATOR_SCOPE_GATED` y **devuelve `false`**.

**No se tocó código de producto** para satisfacer el test, ni se reescribieron fixtures, ni se
introdujo política global de fines de línea.

### Cobertura del propio arreglo

Dos casos nuevos demuestran las dos mitades — sin esto, «normalizar» podría ser un atajo para dejar
de comprobar:

| Caso | Resultado |
|---|---|
| Mismo guard con **LF**, **CRLF** y **CR** sueltos | ✅ pasa en los tres |
| Mediador que **devuelve `true`** (con LF y con CRLF) | ✅ **sigue fallando** |
| Gate renombrado (`MEDIATOR_SCOPE_GATED` → otra cosa) | ✅ sigue fallando |
| Sin ningún `return false` | ✅ sigue fallando |
| **Orden invertido** (el `return true` después del gate) | ✅ sigue fallando |

---

## 4. DEMOSTRACIÓN LOCAL — CLON LIMPIO LINUX

Clon con `core.autocrlf=false` (finales **LF**, como CI) y **`npm ci` real** dentro del contenedor:

| Comprobación | Resultado |
|---|---|
| `mookReview01` en `609aac5` (antes) | 🔴 **ROJO** — el falso fallo |
| `mookReview01` con el arreglo | ✅ **15 tests OK** + los 2 nuevos |
| `test:mook` completo | ✅ **EXIT=0** — 76 aserciones (57 cubierta + 19 navegación) y 34 tests de las otras ocho suites |
| `typecheck:baseline` | ✅ sin regresiones |
| Build real `Dockerfile.front` | ✅ GREEN |

### Control negativo del gate Docker

En una copia **temporal**, ya eliminada, se inyectó la **familia exacta** del defecto histórico: un
módulo en `server/lib/` importado desde el frontend.

| Comprobación | Resultado |
|---|---|
| `npm run build` sobre el **árbol completo** | ✅ **PASA** — el árbol sí resuelve `server/lib/` |
| Build real con **`Dockerfile.front`** | 🔴 **FALLA**, exit 1 |

```
error during build:
Could not resolve "../../server/lib/canaryContract.js" from "components/studio/ExperienceStudio.tsx"
```

Es literalmente el mensaje que tumbó el deploy de 01B. **El gate caza lo que CI dejó pasar.**

Nada del canary llegó al árbol ni al commit: `server/lib/canaryContract.js` no existe y
`ExperienceStudio.tsx` tiene **cero** ocurrencias de `CANARY_LIMIT`.

---

## 5. CI REAL — EJECUTADO, NO OMITIDO

Un job *skipped* por filtros no cuenta como GREEN, así que se comprobó paso a paso:

```
JOB identity-preflight -> success
   Suites MOOK (Experiencias, Studio, Runtime, cubierta y navegación)   completed / success
JOB image-integrity -> success
   Build front image (Dockerfile.front real, gate bloqueante)           completed / success
```

Checks en `5f6fc64`: `content-rmw`, `evidence-hardening`, `gitleaks-head`, **`identity-preflight`**,
**`image-integrity`**, `osv-scanner` y `trivy` en **verde**. **Ningún rojo nuevo.**

**Rojos heredados, intactos y fuera de alcance:** `gitleaks-history` y `trivy-image`. No se tocaron.

---

## 6. INVARIANTES

Esta unidad **solo modifica verificación y tests**. No se desplegó nada: producción sigue en
`chibalete/api:e70c0f1` ×2 y `chibalete/front:nav-356f2fe`, con sus stores, uploads, versiones MOOK,
runs/evidencias, contenido editorial y contratos de Runtime y Studio **sin tocar**.

---

## 7. DEUDAS CERRADAS

| Deuda | Estado |
|---|---|
| **`CHP-CI-FRONT-IMAGE-BUILD-COVERAGE-01`** | ✅ **CERRADA** — build real y **bloqueante** en `image-integrity`, con control negativo que reproduce el incidente |
| **`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01`** | ✅ **CERRADA** — normalización EOL + invariante correcto + cobertura de las dos mitades |
| **«`test:mook` fuera de CI»** | ✅ **CERRADA** — corre automáticamente en `identity-preflight`, con filtros ampliados |

### Sigue abierto, deliberadamente

`gitleaks-history` y `trivy-image`: rojos heredados, **explícitamente fuera de esta unidad**.
