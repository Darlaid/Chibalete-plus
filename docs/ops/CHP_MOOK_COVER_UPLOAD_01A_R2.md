# CHP-MOOK-COVER-UPLOAD-01A-R2 — FUENTES HASTA 50 MiB

**Veredicto:** 🟢 **`GREEN-MOOK-COVER-50MIB-SOURCE-READY`** — la capacidad está lista y verificada.
**Rama:** `chp/mook-contract-00` · **Base:** `2aaac42` · **Cero producción, cero deploy.**

🔴 **PERO el activo vinculante NO pasa su verificación editorial: sigue diciendo «¿Estás ahí?».**
**01B continúa bloqueada.** Ver §4.

---

## 1. EL CAMBIO

Exactamente uno, más el arrastre honesto de un número escrito a mano:

| Elemento | Antes | Ahora |
|---|---|---|
| `COVER_SOURCE_MAX_BYTES` | 20 MiB | **50 MiB** |
| `COVER_HELP_TEXT` | «hasta 20 MB» | **«hasta 50 MB»** |
| Mensaje de `SOURCE_TOO_LARGE` | «20 MB» **literal** | **derivado de la constante** |

Ese tercer punto no estaba en el encargo pero es la misma línea de trabajo: el mensaje llevaba el
número escrito a mano y **mentía en cuanto el tope cambiaba**. Ahora se calcula, así que no puede
volver a divergir.

### Lo que NO se movió

| Invariante | Estado |
|---|---|
| `COVER_UPLOAD_MAX_BYTES` | ✅ **5 MiB**, intacto |
| `COVER_MAX_PIXELS` | ✅ **40 MP**, intacto |
| Formato, ratio, dimensiones mínimas | ✅ sin cambios |
| Escalera `0.90 → 0.85 → 0.80` | ✅ sin cambios |
| Fallback JPEG | ✅ sin cambios |
| Autenticación y autorización | ✅ sin cambios |
| Cero overwrite | ✅ sin cambios |
| Backend 413 para > 5 MiB | ✅ sin cambios |

**El tope de selección es de comodidad**: solo gobierna qué puede elegir el operador. Lo que protege
a la red, a los lectores y al servidor es el de **transmisión**, y sigue en 5 MiB. Lo que acota la
memoria del canvas al decodificar es **40 MP**, y también sigue igual — por eso subir el peso no
abre la puerta a una bomba de descompresión.

---

## 2. EL ACTIVO VINCULANTE — VERIFICACIÓN TÉCNICA

`…\ESTÁS AQUÍ - …\Cubierta estás aquí - Final corregida.png`, **leído sin copiarlo**.

| Criterio | Resultado |
|---|---|
| PNG válido | ✅ magic `89 50 4e 47 0d 0a 1a 0a` |
| Peso < 50 MiB | ✅ **34 285 674 B = 32,70 MiB** (y **superaba** el tope viejo de 20 MiB) |
| Dimensiones | ✅ **6667 × 3750** |
| Ratio | ✅ **1.7779** — desvío **0.00009** del 16:9 |
| < 40 MP | ✅ **25,00 MP** |
| **Fuente byte-idéntica antes/después** | ✅ SHA-256 `585539b8…cd8bb9a1` **sin cambios** |
| Derivación 1600 × 900 | ✅ confirmado **decodificando de vuelta** |
| Salida < 5 MiB | ✅ **277 264 B = 0,264 MiB** — **124× más pequeña** |
| MIME real de la salida | ✅ `RIFF`/`WEBP`/`VP8X`, calidad 0.90, 1021 ms |
| Calidad y legibilidad | ✅ ilustración nítida, tipografía limpia |
| Subtítulo | ✅ «Pensar, elegir y atender en la era del scroll» |
| **El arte dice «¿Estás aquí?»** | 🔴 **NO — dice «¿Estás ahí?»** |

---

## 3. PRUEBAS

**50 aserciones GREEN** en Windows y en **Docker Linux local**. Las 9 suites mook restantes, GREEN.
Gate bloqueante `test:content-rmw`, GREEN (29 + 27 + 26). Typecheck sin regresiones. Build compila.

Añadidas o actualizadas, sin duplicar lo que ya cubría la optimización:

| Caso | Cubierto |
|---|---|
| Los dos topes fijados **por valor** (50 MiB / 5 MiB), no solo por constante | ✅ |
| Fuente de **exactamente 50 MiB** aceptada | ✅ |
| Fuente de **50 MiB + 1 byte** rechazada **antes de decodificar** | ✅ |
| El mensaje de rechazo anuncia **50 MB**, no un número viejo | ✅ |
| Activo vinculante (32,7 MiB, 6667 × 3750) aceptado y derivado | ✅ |
| **Subir el peso no relajó los 40 MP**: 25 MP entra, 506 MP no | ✅ |
| La ayuda anuncia **50 MB** y ya no menciona 20 MB | ✅ |
| Backend sigue rechazando > 5 MiB | ✅ (caso previo, sin duplicar) |

---

## 4. 🔴 EL ACTIVO NO ESTÁ CORREGIDO

La decisión vinculante del operador fue: **el MOOK conserva «¿Estás aquí?» y el arte se corrige.**

El archivo entregado se llama **«Final corregida»** y **es un export nuevo** —6667 × 3750 y 32,7 MiB,
frente a los 2912 × 1632 y 9,56 MiB del anterior—, así que sí se volvió a exportar. **Pero el texto
sigue diciendo «¿Estás ahí?».** Verificado con zoom sobre la derivación real.

En la carpeta editorial hay **tres** imágenes y ninguna otra es candidata:

| Archivo | Peso | Título del arte |
|---|---|---|
| `Cubierta estás ahí - Final.png` | 10 021 061 B | «¿Estás ahí?» |
| `Cubierta estás aquí - Web 1600x900.webp` | 7 069 200 B | «¿Estás ahí?» |
| **`Cubierta estás aquí - Final corregida.png`** | **34 285 674 B** | **«¿Estás ahí?»** |

Los nombres dicen «aquí» desde el segundo archivo; **el arte nunca lo ha dicho**. La hipótesis más
simple es que se reexportó a mayor resolución sin tocar la capa de texto.

**No se corrige por nuestra cuenta:** modificar el arte no es competencia de esta unidad, y el
límite explícito era no tocar el archivo fuente.

**01B sigue bloqueada por el mismo motivo de siempre.** Lo único que falta es un export cuyo texto
diga «¿Estás aquí?».

---

## 5. ALCANCE DEL GREEN

`GREEN-MOOK-COVER-50MIB-SOURCE-READY` afirma que **la capacidad** está lista: fuentes de hasta
50 MiB entran, se derivan a 1600 × 900 y el servidor conserva su frontera. Eso está verificado con
el activo real, de punta a punta.

**No afirma que el activo sea publicable.** El GREEN permite reanudar 01B con el nuevo HEAD; lo que
01B necesita para arrancar es el arte con el título correcto.

**No desplegar todavía.**

---

## 6. DEUDA REGISTRADA, NO TRABAJADA

`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01` y «`test:mook` fuera de CI» siguen registradas y **fuera de
esta liberación**, por decisión explícita del operador.


---

**Continuación y cierre:** el arco terminó en `CHP_MOOK_OBJECTIVES_AND_COVER_PRODUCTION.md` —
🟢 `GREEN-MOOK-OBJECTIVES-AND-COVER-PRODUCTION`. El arte corregido (32,7 MiB, 6667 × 3750, con el
título ya en «¿Estás aquí?») se derivó a **276 976 B** y está aplicado en producción sobre
`api:e70c0f1` ×2 y `front:obj-ab380ed`. Por el camino, aplicar la cubierta destapó
`CHP-STUDIO-OBJECTIVES-COLLAPSE-ON-SAVE-01` —el Studio colapsaba N objetivos a 1 al guardar—,
corregido en `ab380ed`. Vigente: **v4 con los 3 objetivos exactos**; v1, v2 y v3 conservadas intactas.
