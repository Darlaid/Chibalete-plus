# CHP-MOOK-ESTAS-AQUI-04E — QA FINAL DEL BORRADOR v1 EN PRODUCCIÓN

**Estado:** 🟢 **CERRADO — `GREEN-MOOK-V1-DRAFT-QA-PASSED`**
**Alcance del GREEN:** el borrador v1 productivo queda **verificado y apto para publicación**.
**Este GREEN no publica nada y no levanta el bloqueador de audiencia.**
**Rama:** `chp/mook-contract-00`
**Fecha:** 2026-08-27
**Operador humano:** **Nicolás Jiménez** — director/editor de Chibalete Editores
**Unidad previa:** 04D — `GREEN-MOOK-V1-DRAFT-READY-FOR-FINAL-QA` (`cacf8b8`)

> **Regla vinculante de esta unidad.** La automatización solo puede afirmar lo que mide:
> que un nodo **monta**, que la consola **no emite errores de aplicación**, que la red **no falla**,
> que **no hay autoplay** y que el preview **no muta el store**. Que un audio *suene bien*, que un
> extracto *lea bien* y que una consigna *diga la verdad* es **decisión del operador humano**.
> Las dos mitades de este documento no son intercambiables.

---

## 1. QUÉ ES ESTA UNIDAD

04B definió **04E · `PRODUCTION-CANARY`** y lo dejó **bloqueado**: un canario por grupo no es
implementable con el código actual, y la única verificación productiva posible sin liberar era la
**opción D** — validar el DRAFT vía Studio y preview.

Esta unidad ejecuta esa opción D **en su variante mínima**: verificación del borrador con la cuenta
de administración ya existente, **sin crear ni retirar cuenta QA productiva** y **sin exponer la
experiencia a ningún participante**. Es la «unidad final de QA» que 04D dejó como única acción
habilitada.

**No es 04F.** La publicación sigue sin autorizar (§6).

---

## 2. OBJETO VERIFICADO — BASELINE DE 04D

| Elemento | Valor |
|---|---|
| Experiencia | `exp-1787709803882-9ym4tt` — `draft`, `currentVersionId: null` |
| Versión única | `expv-1787787648329-ooo21e` — **v1 `draft`**, sin `publishedAt` |
| Nodos | **56** en 7 movimientos |
| Composición | **16 AUDIO · 25 READING · 15 ACTIVITY** · 15/15 bitácoras privadas · 0 `PRODUCTION` |
| Catálogo | 108 registros · **41/41 recursos** del mook · 10/10 páginas con `parentId` resoluble |
| TTS | 25 textuales en `listo` · 16 podcasts en `no_iniciado` · **0 en `generando`** |
| Runs / evidencias | **0 / 0** |
| Visibilidad | invisible para participantes por **doble condición**: experiencia `draft` **y** `currentVersionId: null` |
| Backend productivo | `910c735` en `api_1` y `api_2` |

La QA se ejecutó **contra este borrador productivo**, no contra la copia local. La v4 local de 04A
comparte estructura (56 nodos, 16/25/15) pero **no es el objeto de esta unidad** y no se tocó.

---

## 3. RESULTADOS — AUTOMÁTICO

| # | Verificación | Resultado |
|---|---|---|
| A-1 | **56/56 nodos montan** | ✅ **PASS** |
| A-2 | Consola **sin errores de aplicación** | ✅ **PASS** |
| A-3 | Red **sin peticiones fallidas** | ✅ **PASS** |
| A-4 | **Sin autoplay** en ninguna pieza de audio | ✅ **PASS** |
| A-5 | **Sin scroll horizontal** en desktop y móvil | ✅ **PASS** |
| A-6 | **Preview sin runs ni evidencias** — cero mutaciones | ✅ **PASS** |

**A-1** es el check que 04D no podía dar por hecho: los 41 recursos fueron reconstruidos tras la
pérdida por `CHP-CONTENT-STORE-RMW-01` y los 14 estados TTS fueron reconciliados por upsert
canónico. Que los 56 nodos monten y que la red no falle es la confirmación **funcional** de que la
recuperación quedó completa —no solo consistente en el store—.

**A-4** confirma en producción lo que 04A verificó estructuralmente: el reproductor no arranca solo.

**A-6** es la garantía de que la propia QA no contaminó el estado: el preview de administración
recorre la experiencia **sin crear run ni evidencia**, así que los contadores `0/0` de 04D siguen
siendo ciertos después de la verificación.

---

## 4. RESULTADOS — HUMANO

Diez sondeos elegidos por riesgo, no por muestreo. Cada uno cubre un punto donde una unidad anterior
detectó o reparó algo, o donde el recorrido tiene un borde.

| # | Nodo | Por qué está en la lista | Resultado |
|---|---|---|---|
| H-1 | **A01** «Son las once de la noche» | primer audio del mook: si algo falla en la cadena de activos, falla aquí | ✅ **PASS** |
| H-2 | **Prólogo** «Me desconecto, luego existo» | primer extracto del libro; borde inicial de la cadena de custodia | ✅ **PASS** |
| H-3 | **Extracto intermedio** | control del cuerpo de los 10 extractos, no solo de sus extremos | ✅ **PASS** |
| H-4 | **Epílogo** «Una ética de la presencia» | último extracto; borde final de la cadena | ✅ **PASS** |
| H-5 | **A07.3** «La elección de empezar a elegir» | tercer corte del A07 dividido — observación técnica abierta en 04A §2.6 | ✅ **PASS** |
| H-6 | **A15** «Una ética de la presencia» | **H-02 de 04A**: el audio prometía grabar; hubo que **regrabar el MP3** | ✅ **PASS** |
| H-7 | **B00** | bitácora corregida en 03B; la corrección que obligó a crear v3 | ✅ **PASS** |
| H-8 | **B03** | segunda bitácora corregida en 03B | ✅ **PASS** |
| H-9 | **B07** | penúltima bitácora del recorrido del reto | ✅ **PASS** |
| H-10 | **T08** «Mi manera de estar» | **H-01 de 04A**: prometía grabar/compartir/galería; corregido quirúrgicamente | ✅ **PASS** |

| Verificación transversal | Resultado |
|---|---|
| **Biblioteca, Aula Viva, Producciones y Studio sin regresiones** | ✅ **PASS** |

**Lo que cierra H-6 y H-10.** Los dos hallazgos editoriales bloqueantes de 04A eran promesas
funcionales falsas —la experiencia ofrecía grabar voz, compartir y ver una galería que no existen—.
T08 se corrigió por texto; A15 exigió **regrabar el audio**, porque la promesa estaba en la voz y no
es editable. Que ambos pasen **en producción** confirma que las correcciones viajaron enteras a
través de la recarga de 04D y no se perdieron en el camino.

**Lo que cierra la fila transversal.** 04D reescribió 41 recursos del catálogo productivo compartido.
Que Biblioteca, Aula Viva, Producciones y Studio no muestren regresiones es la contraprueba de que la
reconstrucción no dañó contenido ajeno al mook.

---

## 5. QUÉ **NO** CUBRE ESTA QA

Se registra explícitamente para que nadie lea el GREEN como más de lo que es.

- **No hay recorrido de participante real.** La experiencia es invisible por doble condición; no
  existe cuenta de participante que pueda verla. El E2E de participante es materia de **04F**.
- **No se validaron los 16 podcasts en `no_iniciado`.** No tienen audio TTS generado y **no deben
  tenerlo**: su audio es MP3 editorial, ya verificado en 04A. `no_iniciado` es su estado correcto.
- **El muestreo humano es de 10 nodos, no de 56.** Los 56 se verificaron **automáticamente**
  (montaje, red, consola); la escucha y lectura humana completa se hizo en **04A sobre v4 local**,
  que comparte estructura y activos. Esta unidad verifica que esa aprobación **sobrevivió** a la
  recarga; no la repite.
- **No se midió rendimiento ni tiempo de lectura.** O-1 y O-2 de 04B siguen siendo observaciones no
  bloqueantes.

---

## 6. VEREDICTO Y ALCANCE

**Veredicto:** 🟢 **`GREEN-MOOK-V1-DRAFT-QA-PASSED`**

**Qué autoriza:** declarar el borrador v1 productivo **apto para publicación**. Nada más.

**Qué NO autoriza:**

- ❌ **Publicar.** 04F sigue **no autorizada**.
- ❌ Crear una **v2** o editar v1.
- ❌ Iniciar **runs** o **evidencias**.
- ❌ Crear cuentas de participante o de QA en producción.

---

## 7. BLOQUEADORES VIGENTES

| # | Bloqueador | Estado |
|---|---|---|
| **B-1** | **`YELLOW-AUDIENCE-DECISION`** — publicar equivale a **liberación general**, sin gate de audiencia | 🟡 **ABIERTO** — bloquea 04F |
| **Portada** | qué imagen usa «¿Estás aquí?» en producción | 🟡 decisión humana pendiente |
| **Riesgo heredado** | `ACCESS_FALLBACK_MODE=open` con 20/20 grupos sin `availableContentIds`: hoy **todo el catálogo productivo es accesible a cualquier cuenta autenticada** | 🟡 abierto — **no lo introduce el MOOK**; merece unidad propia |

B-1 no es un defecto del mook: es la razón de fondo por la que publicar no admite media tinta.
Mientras siga abierto, la decisión de publicar es **editorial y de negocio**, no técnica.

---

## 8. DEUDA ABIERTA (no bloqueante)

- **`CHP-TTS-RETRY-STUCK-STATE-DEADLOCK-01`** — el guard `ttsStatus === 'generando' ⇒ 409` impide
  reparar por la vía canónica un registro atascado en ese estado. No afecta a cargas nuevas desde
  `Subir → Studio` con `910c735`.
- **`CHP-TELEMETRY-STORE-RMW-01`** — heredada de la familia RMW.
- **~19 uploads huérfanos** en producción: ⛔ **no limpiar**, son los MP3/TXT de los recursos
  destruidos y reutilizados por hash en la recuperación.

---

## 9. SIGUIENTE UNIDAD

**04F · `PUBLICATION-AND-CLOSURE`** — **bloqueada por B-1**.

Requiere, en este orden:

1. **Decisión humana de audiencia** (B-1) y **decisión de portada**.
2. Publicar **una sola vez** · verificar `currentVersionId` · E2E con participante real · confirmar
   0 en Producciones y 403 de mediador · capturar evidencia · cerrar.
3. **Rollback disponible:** `POST /api/experiences/:id/archive` — no destructivo.

Hasta que B-1 se resuelva, el estado estable y correcto del mook es **borrador productivo verificado**.
