# CHP-MOOK — CUBIERTA DEFINITIVA Y OBJETIVOS EN PRODUCCIÓN

**Veredicto:** 🟢 **`GREEN-MOOK-OBJECTIVES-AND-COVER-PRODUCTION`**
**Rama:** `chp/mook-contract-00` · **Fecha:** 2026-08-27
**Release productivo:** API `chibalete/api:e70c0f1` ×2 · frontend `chibalete/front:obj-ab380ed`
**Experience:** `exp-1787709803882-9ym4tt` — «¿Estás aquí?»

Cierra tres unidades: **`CHP-MOOK-COVER-UPLOAD-01B`**,
**`CHP-STUDIO-OBJECTIVES-COLLAPSE-ON-SAVE-01`** y **`CHP-STUDIO-OBJECTIVES-MULTI-01`**.

---

## A. QUÉ QUEDA EN PRODUCCIÓN

| Elemento | Estado |
|---|---|
| Cubierta | **propia, 16:9**, `/uploads/experience-covers/cubierta-1787868051452-502805430.webp` |
| Arte | **«¿Estás aquí?»** + «Pensar, elegir y atender en la era del scroll» |
| Formato servido | WebP real · **1600 × 900** · **276 976 B (0,264 MiB)** · HTTP 200 |
| Versión vigente | **v4** `expv-1787874438930-b9g1fc`, publicada, con **los 3 objetivos exactos** |
| Estructura | 7 módulos / 56 nodos · 16 AUDIO, 25 READING, 15 ACTIVITY · **15/15 privadas** |
| Uploader | fuentes hasta **50 MiB**, derivación automática a 1600 × 900 WebP, backend firme en **5 MiB** |
| Fuente original | **nunca se subió ni se modificó** — se deriva en el navegador y se descarta |

---

## B. CRONOLOGÍA DE VERSIONES — CUATRO, Y NINGUNA MUTADA

| Versión | Publicada | Objetivos | Qué es |
|---|---|---|---|
| **v1** `…-ooo21e` | 17:28:32Z | **3** | versión original correcta |
| **v2** `…-9wnuad` | 22:01:26Z | **1** | **el incidente**: el Studio anterior colapsó los objetivos al guardar |
| **v3** `…-ujpx3h` | 23:44:54Z | **1** | publicación intermedia durante la corrección |
| **v4** `…-b9g1fc` | 23:48:21Z | **3** | **correctiva y vigente** |

**Las cuatro comparten `modhash 63216bb8e5536f2e`**: módulos y nodos idénticos. La única diferencia
entre ellas fue siempre la lista de objetivos.

**Ninguna versión histórica fue mutada, borrada ni archivada.** v1, v2 y v3 siguen exactamente como
quedaron. **Ningún run ni participante quedó vinculado a v2 o v3**: el único run existente
(`run-1787851759374-6n8ziy`, del administrador) sigue pineado a **v1**, con 0 evidencias.

### La cuarta versión: desviación histórica aceptada

El guion esperaba tres versiones. Hay cuatro porque la v3 se publicó antes de completar los campos.
**Se acepta por decisión del operador**, y es la salida correcta: v3 es historia inmutable, no es la
vigente, nadie la tiene pineada, no afecta a lo que ve ningún participante, y **eliminarla exigiría
una escritura directa al store, que está prohibida**. No es deuda abierta ni estado degradado: es el
registro honesto de lo que ocurrió.

---

## C. LA CAUSA — Y POR QUÉ ERA INVISIBLE

El contrato **siempre** admitió `objectives: string[]`. El Studio lo editaba con **un solo textarea**:

```js
setObjetivo(working?.objectives?.[0] ?? '')            // cargaba solo el primero
objectives: objetivo.trim() ? [objetivo.trim()] : []   // guardaba uno
```

Cualquier versión creada desde el Studio **colapsaba N objetivos a 1, en silencio**. No hacía falta
tocar los objetivos: bastaba con guardar. El defecto llevaba ahí desde STUDIO-01 y **solo se
manifestaba en una experiencia con más de un objetivo** — «¿Estás aquí?» era la primera.

Saltó al aplicar la cubierta, porque aplicarla obliga a guardar Información.

---

## D. LA CORRECCIÓN — `ab380ed`

Acotada a **2 archivos**: `components/studio/ExperienceStudio.tsx` y su suite.
**Cero cambios** en backend, stores, esquemas, Runtime, uploader o APIs: la auditoría confirmó que el
contrato ya servía y que no hacía falta migración.

- **Lista, no textarea.** Carga todos los objetivos, un campo por objetivo, añadir y quitar con
  acciones etiquetadas, orden preservado, `trim`, descarte de vacíos. Sin máximos inventados.
- **Instantánea de la ruta al cargar** (`routeBaseline`): la versión solo se escribe si la ruta
  **cambió**. Guardar únicamente metadata —la cubierta, por ejemplo— ya no arrastra una versión.
- **Publicar sigue separado de guardar**: `save()` no llama a `publishStudioVersion`.
- La versión publicada sigue siendo **inmutable desde el formulario** (`<fieldset disabled>`
  verificado como `:disabled` real: los botones no actúan y el foco no entra).

Lo que cierra el círculo: **«Crear nueva versión» ahora copia los tres objetivos**, no uno. Con el
código anterior copiaba uno — que es exactamente cómo nació la v2.

---

## E. VERIFICACIÓN INDEPENDIENTE

### Lo que ve el participante

Landing real consultada con una **cuenta lectora activa**:

```
version: 4 · title: «¿Estás aquí?» · objectives (3): los tres, en orden
imageUrl: /uploads/experience-covers/cubierta-1787868051452-502805430.webp
```

### Invariantes

| Comprobación | Resultado |
|---|---|
| v1 y v2 intactas | ✅ 3 y 1 objetivos, sin mutar |
| Runs pineados a v2 o v3 | ✅ **0** |
| run / evidencias | ✅ **1 / 0**, pineado a v1 |
| Producciones nuevas | ✅ **0** |
| `book.portada_url` | ✅ intacta y sirviendo |
| uploads | ✅ 3329, sin borrados |
| Servicios | ✅ 4 healthy, `RestartCount=0` |
| 5xx / ERROR / SECURITY | ✅ **0 / 0 / 0** |

---

## F. BACKUP Y RESTORE

| Momento | structured | uploads | verify |
|---|---|---|---|
| Previo al upload (01B) | `724a2e77` | — | — |
| Snapshot de seguridad (Fase A) | `b94f7e97` | `e114f842` (**1 archivo nuevo** = la cubierta) | 256 snapshots · 218 manifiestos · **0 problemas** |
| **Cierre (Fase G)** | **`d44cb67d`** (26 stores) | **`353915d7`** (3329 sin cambios) | **259 snapshots · 220 manifiestos · 0 problemas** · RPO en rango |

### Restore rehearsal — byte a byte

```
mook_db.json   prod = restored   435 502 B   sha256 5c838328…4c0ba341
cubierta.webp  prod = restored   276 976 B   sha256 61184179…3eff384b
```

Verificado **sobre la copia restaurada**: 4 versiones · `currentVersionId` = v4 · v4 publicada ·
**los 3 objetivos exactos y ordenados** · 7 módulos / 56 nodos · `modhash 63216bb8e5536f2e` ·
**15/15 privadas** · runs/evidencias **1/0** · run pineado a v1 · `imageUrl` correcto.

**Nunca se restauró sobre producción.** Sin `forget`, sin `prune`, sin limpieza. Se eliminó
únicamente el temporal del ensayo.

---

## G. DEUDAS CERRADAS

| Deuda | Estado |
|---|---|
| **`CHP-STUDIO-OBJECTIVES-COLLAPSE-ON-SAVE-01`** | ✅ **CERRADA** — el Studio conserva listas completas |
| **`CHP-STUDIO-OBJECTIVES-MULTI-01`** | ✅ **CERRADA** — implementada, probada y desplegada |
| **`CHP-MOOK-COVER-UPLOAD-01B`** | ✅ **CERRADA** — cubierta definitiva aplicada y verificada |

### Deudas que siguen abiertas y NO se trabajaron

- **`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01`** — `mookReview01:88` compara un literal con `\n`; con LF
  falla sobre código correcto. Demostrado en un clon limpio, sin cambios propios.
- **`test:mook` fuera de CI** — ningún workflow lo ejecuta.
- **`CHP-CI-FRONT-IMAGE-BUILD-COVERAGE-01`** — CI construye sobre el árbol completo pero **no
  reproduce `Dockerfile.front`**. Por eso no detectó el import imposible que sí destapó el deploy real
  de 01B (`Could not resolve "../../server/lib/coverContract.js"`), corregido en `e70c0f1` moviendo el
  contrato compartido a `utils/`.

---

## H. RELEASE Y ROLLBACK

| Servicio | Imagen | Rollback disponible |
|---|---|---|
| `chibalete_api_1` / `api_2` | `chibalete/api:e70c0f1` | `chibalete/api:910c735` |
| `chibalete_front` | `chibalete/front:obj-ab380ed` | `chibalete/front:cover-e70c0f1`, `lib01-ffc90a1` |

Overrides respaldados: `.bak-pre-e70c0f1-20260827T215619Z` y `.bak-pre-ab380ed-20260827T233258Z`.
Deploys registrados en `/root/deploys.log`. El deploy del frontend **no tocó las APIs**: el diff de
`ab380ed` se limita al Studio.

---

## I. ALCANCE

Este GREEN cierra el arco de cubierta y objetivos. **No autoriza** crear más versiones, tocar v1/v2/v3,
re-subir la cubierta, migrar el run, ni iniciar `Atrás/Adelantar`, V5, identidad, eventos o Aula Viva.
