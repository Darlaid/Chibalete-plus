# CHP-MOOK-COVER-UPLOAD-01A-R1 — OPTIMIZACIÓN AUTOMÁTICA DE CUBIERTAS

**Veredicto:** 🟢 **`GREEN-MOOK-COVER-AUTO-OPTIMIZATION-READY`**
**Autoriza reanudar el preflight de deploy con el nuevo HEAD. NO autoriza desplegar.**
**Rama:** `chp/mook-contract-00` · **Base:** `b1297f6` · **Cero producción, cero deploy.**

✅ **Hallazgo editorial RESUELTO** por decisión vinculante del operador: el MOOK conserva
«¿Estás aquí?» y el arte se corrige. Ver §6.

---

## 1. EL PROBLEMA QUE RESUELVE

01A-CLOSURE-GATES paró porque el activo definitivo pesaba 9,56 MB contra un tope de 5 MB. El tope no
era arbitrario —no queremos servir cabeceras pesadas a los lectores— pero convertía un límite técnico
en **trabajo humano**: alguien tenía que recomprimir a mano, fuera del sistema, cada vez.

La solución no es subir el límite: es **dejar de subir el original**.

---

## 2. EL NUEVO CONTRATO

Dos límites distintos, y la distinción es todo:

| Constante | Valor | Qué gobierna |
|---|---|---|
| `COVER_SOURCE_MAX_BYTES` | **20 MiB** | lo que el operador puede **seleccionar** |
| `COVER_UPLOAD_MAX_BYTES` | **5 MiB** | lo que **viaja por la red y se sirve** |

El Studio deriva, antes de subir: **1600 × 900**, WebP de alta calidad, objetivo < 2 MB, tope duro
5 MB. **El backend conserva su límite de 5 MB sin tocar**, porque un cliente puede mentir y el
servidor no delega su frontera a nadie.

**El archivo original nunca se modifica.** Se decodifica en memoria y se descarta.

### Escalera de calidad

`0.90 → 0.85 → 0.80`, recorrida **en orden y sin búsqueda binaria**: la misma imagen produce siempre
exactamente el mismo archivo. Si ni a 0.80 baja de 5 MB, se avisa y **no se envía nada** —subir algo
que el servidor rechazaría sería gastar la red del operador para nada—.

Si el navegador no soporta WebP, cae a **JPEG** de alta calidad.

### Ratio y mínimo se juzgan sobre el ORIGINAL

Deliberado: redibujar a 1600 × 900 haría pasar por válida cualquier proporción. Comprobar después
sería **deformar en silencio**. Un 4:3 se rechaza **antes** de tocar el canvas.

---

## 3. IMPLEMENTACIÓN

| Archivo | Papel |
|---|---|
| `server/lib/coverContract.js` | los dos límites, el objetivo, la escalera y el texto de ayuda. Sin dependencias de Node ⇒ lo importan backend **y** Studio |
| `utils/coverOptimizer.mjs` | **nuevo** — la derivación. Primitivas del navegador **inyectadas** |
| `components/studio/ExperienceStudio.tsx` | estados `optimizing`/`uploading`, resumen «original → optimizada», guard `coverBusy` |
| `server/lib/coverPolicy.js`, `server/server.js` | solo el renombrado de la constante. **El tope del servidor no se movió** |

**Sin dependencias nuevas:** `createImageBitmap` + `<canvas>` + `toBlob` bastan.

`.mjs` y no `.ts` a propósito: así las pruebas de Node ejercitan la escalera de decisión sin
navegador. **Los tests prueban las decisiones; el navegador prueba los píxeles.**

Un detalle que evita un fallo silencioso: `canvas.toBlob` **ignora sin avisar** un tipo no soportado
y devuelve PNG. Si el tipo del Blob no coincide con el pedido, se trata como fallo de códec.

---

## 4. VALIDACIÓN VINCULANTE — ACTIVO REAL

`…\ESTÁS AQUÍ - …\Cubierta estás aquí - Web 1600x900.webp`, **leído sin copiarlo** (servido por
stream desde su ruta original).

> El nombre dice «1600x900» pero el archivo mide **3334 × 1875**. Es justo el caso de uso.

| Criterio | Resultado |
|---|---|
| Fuente ≈ 6,74 MB aceptada | ✅ **7 069 200 B**, 3334 × 1875, ratio 1.7781 |
| **Original byte-idéntico antes/después** | ✅ SHA-256 `af873e56…b344acb4f3` **sin cambios** |
| Salida 1600 × 900 | ✅ verificado **decodificando de vuelta**, no por lo declarado |
| Ratio 16:9 | ✅ 1.7778 |
| MIME real | ✅ `RIFF`/`WEBP`/`VP8X` — WebP de verdad |
| Salida < 5 MB, idealmente < 2 MB | ✅ **289 480 B (0,28 MB)** — **24× más pequeña** |
| Calidad | ✅ 0.90, el primer peldaño; 517 ms |
| Legibilidad visual | ✅ ilustración nítida, tipografía limpia |
| Subtítulo | ✅ «Pensar, elegir y atender en la era del scroll» |
| **Título** | ❌ decía **«¿Estás ahí?»**, no «¿Estás aquí?» → **error del arte, se corrige** (§6). Este activo queda descartado como cubierta definitiva |

### Por la UI autenticada

| Comprobación | Resultado |
|---|---|
| Subida completa desde `Studio → Información` | ✅ `imageUrl` = `/uploads/experience-covers/cubierta-1787863552516-657762011.webp` |
| Extensión | ✅ `.webp`, fijada por el **MIME real** |
| Avisos al operador | ✅ «Cubierta lista. Guarda Información para aplicarla.» + «Original 6.7 MB → optimizada 0.3 MB (1600 × 900, calidad 0.9).» |
| **Doble clic** | ✅ botón en «Optimizando…» y `disabled=true`; el **segundo disparo se ignoró** |
| Archivos creados | ✅ **exactamente uno**, pese al doble disparo |
| **Store intacto hasta guardar** | ✅ `imageUrl` y `updatedAt` **sin mover**, 1 versión, 0 runs, 0 evidencias |
| Cero overwrite | ✅ las dos cubiertas anteriores siguen en disco |

### Hero con la cubierta derivada

| Viewport | Caja | Ratio | Visible | Scroll horizontal |
|---|---|---|---|---|
| **1440** | 1088 × 612 | 1.7778 | **100 %** | no |
| **390** | 358 × 201 | 1.7778 | **100 %** | no |

**Cero recorte.** El contrato 16:9 funciona como se diseñó.

### El backend no se debilitó

Payload de **6 291 530 B** enviado **directamente** al endpoint, saltándose la interfaz:

```
HTTP 413 · {"error":"La imagen supera el máximo de 5 MB."}
```

Subir el límite del cliente **no movió** el del servidor.

---

## 5. PRUEBAS

**47 aserciones GREEN**, en Windows y en **Docker Linux local** (`node:20-bookworm`, `linux/amd64`).
`test:mook` completo: **10/10 suites GREEN** en Linux contra este árbol.

Capa **D** nueva, con primitivas falsas y deterministas:

| Caso | Cubierto |
|---|---|
| Fuente 6,74 MB → 1600 × 900 WebP en un intento | ✅ |
| Escalera baja a 0.85 solo si 0.90 no cabe, **y se detiene ahí** | ✅ |
| Ni a 0.80 baja de 5 MB → error y **no se envía** | ✅ |
| Fuente de **exactamente 20 MB** aceptada | ✅ |
| Fuente **> 20 MB** rechazada **antes de decodificar** | ✅ |
| Navegador sin WebP → **fallback JPEG** | ✅ |
| Fallo de decodificación / de códec | ✅ sin lanzar |
| Formato inválido | ✅ antes del decodificador |
| **4:3 rechazado ANTES de redibujar** | ✅ optimizar no puede tapar deformar |
| Original bajo el mínimo no se «arregla» ampliándolo | ✅ |
| **Reproducibilidad**: misma entrada = misma salida | ✅ |
| Se reportan tamaño original y optimizado | ✅ |

Typecheck sin regresiones · `npm run build` compila.

### ⚠️ Deuda ajena descubierta (NO tocada)

`server/__test__/mookReview01.test.mjs:88` afirma que el mediador nunca pasa así:

```js
assert.ok(!guardBody.includes('return true;\n    if (isMediatorRole'), 'el mediador jamás pasa');
```

El código **correcto** es exactamente `…return true;` + salto + `if (isMediatorRole) { 403 }`. Con
**LF** el patrón coincide y la aserción **falla sobre código correcto**; con **CRLF** no coincide y
pasa. El blob en git tiene **LF**, así que **cualquier clon Linux la ve fallar**.

**Demostrado en `b1297f6`, sin ninguno de mis cambios**, en un clon limpio dentro de un contenedor.

No se ve porque **ningún workflow de CI ejecuta `test:mook`** —el script `test:identity-preflight` lo
incluye, pero el workflow corre pasos sueltos y ese no está—. Dos deudas reales:
`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01` y **`test:mook` fuera de CI**. No se trabajan aquí.

---

## 6. ✅ HALLAZGO EDITORIAL — RESUELTO

La validación pedía «título exacto **¿Estás aquí?**». El arte decía **«¿Estás ahí?»** — verificado
con zoom sobre la derivación. El subtítulo sí era correcto.

### Decisión vinculante del operador (2026-08-27)

> El MOOK conserva su título canónico **«¿Estás aquí?»**.
> **«¿Estás ahí?» es un error del arte y será corregido.**
> No renombrar la Experience ni modificar código.

De las tres salidas planteadas, se elige la **segunda**: se corrige el arte.

**Consecuencias operativas:**

- ❌ **No se renombra** la Experience. `title` sigue siendo «¿Estás aquí?» en producción, intacto.
- ❌ **No se toca código.** El uploader ya sirve para cualquier archivo que cumpla el contrato; el
  título del arte no es una variable del sistema.
- ⏸️ **01B queda BLOQUEADA** hasta que el operador entregue la ruta del archivo corregido.
- El activo validado en esta unidad —`Cubierta estás aquí - Web 1600x900.webp`— **queda descartado
  como cubierta definitiva**: sirvió para probar la derivación, no para publicarse.

**Lo único que falta para reanudar 01B es la ruta del nuevo archivo.** Todo lo demás está verificado.

---

## 7. LÍMITES RESPETADOS

Cero producción · cero deploy · el archivo fuente **no se tocó** (hash idéntico) · nginx y el tope
del backend **sin mover** · sin v2 ni cambios en la Experience productiva · sin borrar ni reemplazar
uploads · sin trabajar deudas ajenas.

---

## 8. SIGUIENTE PASO

Este GREEN **autoriza reanudar el preflight de deploy con el nuevo HEAD**; no autoriza desplegar.

**01B permanece bloqueada por decisión del operador**, a la espera de la ruta del arte corregido.
No hay ninguna pregunta técnica abierta.

`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01` y «`test:mook` fuera de CI» quedan **registradas y NO se
trabajan dentro de esta liberación**, por decisión explícita del operador.


---

**Continuación:** el tope de selección subió a **50 MiB** en `CHP_MOOK_COVER_UPLOAD_01A_R2.md` —
🟢 `GREEN-MOOK-COVER-50MIB-SOURCE-READY`— para admitir el arte definitivo de 32,7 MiB.
🔴 **El activo entregado como «Final corregida» sigue diciendo «¿Estás ahí?»**: es un export nuevo
(6667 × 3750) pero sin el texto corregido. **01B sigue bloqueada** por el mismo motivo.
