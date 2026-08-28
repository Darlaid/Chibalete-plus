# CHP-MOOK-CONTEXTUAL-READING-RETURN-01 — VOLVER AL NODO EXACTO

**Veredicto:** 🟢 **`GREEN-MOOK-CONTEXTUAL-RETURN-PRODUCTION`**
**Rama:** `chp/mook-contract-00` · **Commit:** `162c3e6` · **Fecha:** 2026-08-28
**Release:** frontend `chibalete/front:ret-162c3e6` · APIs **sin tocar** en `chibalete/api:e70c0f1` ×2

✅ **QA humana en producción GREEN.** Ver §5.
⚠️ **Hallazgo ajeno a la unidad, encontrado al verificar:** en producción hay una **v5** publicada
por el operador que cambia los requeridos de **42 a 48**. Ver §6.

---

## 1. EL DEFECTO: DOS ROTURAS, NO UNA

Quien leía desde un nodo del MOOK terminaba en **Biblioteca**, fuera del recorrido pedagógico.
No había un solo punto roto:

1. `Experiencias.tsx` abría la lectura con un `Link` a `/contenido/:id` **sin llevar el origen**.
2. `PaginaDetalleLibro.tsx` tenía su «Volver» **fijo** a `/biblioteca`.

Cualquiera de las dos bastaba para romper el recorrido: arreglar solo una habría dejado el defecto
vivo por el otro camino.

---

## 2. LA DECISIÓN DE DISEÑO: EL ORIGEN VIAJA POR LA URL

El origen se transporta como `?exp=&node=`, **no** en `location.state`, para que sobreviva a
recargar la ficha o el lector. Sin `document.referrer`, sin `localStorage`/`sessionStorage` y **sin
aceptar una URL de retorno arbitraria**: son dos ids de forma acotada y **el destino lo construye el
helper** (`utils/mookReturn.mjs`), así que el parámetro no puede convertirse en un *open redirect*.

Es una **pista de navegación, no una autorización**: el Runtime sigue validando pertenencia y
accesibilidad contra `route.nodes`, que ya calcula el servidor. Un `node` inventado o bloqueado no
abre nada. Por eso la unidad es **frontend puro**: cero backend, cero stores, cero contratos nuevos.

Dos consecuencias que valió la pena descubrir antes de escribir código:

- **`Leer Ahora` no era un cuarto runtime**, sino un alias condicional (inmersivo si hay texto
  plano, PDF si no). No se duplicó implementación.
- Los cinco lectores volvían de **tres maneras distintas** (dos con `navigate(-1)`, tres con ruta
  absoluta). Se unificaron en un helper compartido; el botón «Volver al MOOK» se renderiza **solo si
  hay origen válido**, de modo que desde Biblioteca no aparece.

Al volver, el Runtime valida el nodo, lo expande, hace scroll, **lleva el foco al encabezado** y
consume el parámetro con `replace`: no queda ciclo en el botón Atrás del navegador y una recarga
posterior devuelve al punto canónico. Un nodo completado vuelve como **«Revisando»** y en solo
lectura —el invariante que fijó `CHP-MOOK-RUNTIME-REVISIT-NAV-01`—; la frontera, como «Estás aquí».

---

## 3. DEPLOY PRODUCTIVO

| | Valor |
|---|---|
| Imagen | `chibalete/front:ret-162c3e6`, construida `2026-08-28T02:59:56Z` |
| Container | `chibalete_front` arrancado `2026-08-28T03:00:44Z`, `RestartCount=0`, healthy |
| Pin | `docker-compose.override.yml` → `chibalete/front:ret-162c3e6` (sobrevive a un restart) |
| Respaldo del override | `docker-compose.override.yml.bak-ret-162c3e6` |
| Rollback | `chibalete/front:nav-356f2fe`, presente en el host |
| APIs | **sin tocar**: `chibalete/api:e70c0f1` ×2, arrancadas el 27/08 21:56–21:57Z |
| Código vivo verificado | el chunk `MookReturn-ePMLu9gM.js` que sirve el edge contiene «Volver al MOOK» |

**Deuda de trazabilidad corregida:** el deploy se hizo sin dejar línea en `/root/deploys.log`
(el respaldo del override sí quedó). Se añadió la entrada al cerrar esta unidad.

**CI en el sha desplegado** (`162c3e647506f82b70266293cf089ee20f4da9f0`): `content-rmw`,
`security` e `identity-preflight` **success**. Es el primer release que pasa por los gates que cerró
`CHP_CI_MOOK_RELEASE_GATES_01.md`: la imagen real de `Dockerfile.front` se construye como gate
bloqueante y `test:mook` corre automáticamente.

---

## 4. PRUEBAS

17 aserciones nuevas en `server/__test__/mookContextualReturn01.test.mjs`: contrato de navegación,
resolución contra **rutas reales** de `computeRouteView` —completado y frontera se abren; bloqueado,
ajeno e inexistente **no**— y cableado de las tres superficies. Quedan dos `navigate(-1)` en
`VisorInmersivo` (overlay de acceso denegado y salida del bloqueo de reproducción), ajenos a la
cabecera y fuera de alcance; **su número queda fijado por test** para que nadie los reintroduzca sin
verlo. En Linux: `test:mook` 57+19+17 GREEN y `test:content-rmw` GREEN.

---

## 5. ✅ QA PRODUCTIVA HUMANA — GREEN

Ejecutada por **Nicolás** sobre el recorrido productivo real (28/08, 12:27–12:31Z):

> Ficha y lectores regresan al nodo MOOK exacto; origen Biblioteca intacto; progreso 3/42 y
> bloqueos sin cambios.

### Verificación independiente

| Comprobación | Resultado |
|---|---|
| El botón vive en producción | ✅ el edge sirvió `MookReturn-ePMLu9gM.js` durante la sesión de QA, y el chunk dentro del container contiene «Volver al MOOK» |
| El contador `3/42` es correcto | ✅ el run está **pineado a v1**, que tiene **56 nodos / 42 requeridos**, y hay **3** nodos completados |
| Los 3 completados son **previos** a la QA | ✅ `n-a01` 27/08 17:30:15Z · `n-t00` 28/08 02:30:43Z · `n-libro-ex01` 28/08 02:31:07Z — todos anteriores a la ventana de QA |
| La QA no movió el progreso | ✅ **ningún timestamp del store es posterior a `2026-08-28T02:36:25Z`**, mientras la QA ocurrió a las 12:27–12:31Z |
| runs / evidencias | ✅ **1 / 0**, run `active` |
| Servicios | ✅ 4 healthy, `RestartCount=0` |
| 5xx desde el deploy (10 h) | ✅ **0** |

### Un matiz honesto: esta vez **no** puedo afirmar «store byte-idéntico»

La QA anterior se cerró con `mook_db.json` byte-idéntico. Aquí no aplica, y conviene decir por qué
en lugar de repetir la fórmula: `POST /api/experiences/:id/run` —el arranque/reanudación que el
Runtime dispara **en cada montaje**— pasa siempre por `mutateMook`, aunque el run ya exista y no
cambie nada. Durante la QA se registraron **cinco** de esas peticiones y el archivo quedó reescrito
a las **12:29:15Z**.

Lo que sí está demostrado es lo que importa: **el contenido no cambió**. Ningún campo del store
lleva una marca de tiempo dentro de la ventana de QA, y las escrituras semánticas
—`.../nodes/:nodeId/complete`— no aparecen en el log del edge durante esa ventana.

`mutateMook` **invalida la caché dentro del lock** y vuelve a leer antes de escribir, así que esto
**no** es una repetición de `CHP-CONTENT-STORE-RMW-01`: no hay riesgo de pérdida de escrituras entre
réplicas. Es solo una escritura innecesaria de un archivo de 544 KB en una ruta de lectura, y ahora
se dispara algo más seguido porque volver al nodo remonta el Runtime. Se anota como deuda menor
—**`CHP-MOOK-RUN-RESUME-WRITE-ON-READ-01`**— y **no se toca en esta unidad**.

---

## 6. ⚠️ HALLAZGO FUERA DE ALCANCE: v5 EN PRODUCCIÓN, 42 → 48 REQUERIDOS

Al verificar el `3/42` apareció algo que **no está documentado en ninguna unidad**: producción ya no
tiene 4 versiones sino **5**, y la vigente es `expv-1787884365439-msj4ub` (**v5**), publicada el
**2026-08-28T02:36:25Z**.

La publicó el operador desde el Studio, en su sesión de navegador habitual, por la ruta canónica y
**una sola vez** (`POST .../versions` 02:32:45Z → dos `PUT` de edición → `POST .../publish` 02:36:25Z).
No hay rastro de proceso automático ni de doble publicación.

Contiene **dos cambios**:

1. **Copia editorial (esperable):** se retira el prefijo «Ve a tu Bitácora y:» de 9 nodos ACTIVITY
   (`n-b00`…`n-b05`, `n-b06-dia-1/2/3`, `n-b07`), coherente con que la bitácora ahora vive **dentro**
   del nodo.
2. **Requeridos (a confirmar):** `required` pasa de `false` a `true` en **6 nodos** —`n-a08`,
   `n-a09`, `n-a10`, `n-b06-dia-1`, `n-b06-dia-2`, `n-b06-dia-3`—, es decir los **días 1, 2 y 3** del
   reto de siete días. El total de requeridos sube de **42 a 48** y los opcionales bajan de 14 a 8;
   los días 4 a 7 siguen opcionales.

Un reto de siete días con los tres primeros obligatorios y los cuatro últimos opcionales es una
asimetría que **puede ser deliberada o accidental**; el `modhash` de módulos cambió
(`63216bb8e5536f2e` → `ff11928269f3c52e`). **Queda pendiente de confirmación editorial.**

Nada de esto afecta a la QA de esta unidad: el único run está **pineado a v1**, así que su contador
sigue siendo sobre 42. Pero **para las 247 cuentas activas que empiecen ahora**, el recorrido exige
48 nodos.

Historia de versiones en producción, para que quede en un solo sitio:

| | id | publicada | requeridos | objetivos | `modhash` |
|---|---|---|---|---|---|
| v1 | `expv-1787787648329-ooo21e` | 27/08 17:28:32Z | 42 | 3 | `63216bb8e5536f2e` |
| v2 | `expv-1787868063647-9wnuad` | 27/08 22:01:26Z | 42 | 1 | `63216bb8e5536f2e` |
| v3 | `expv-1787874287320-ujpx3h` | 27/08 23:44:54Z | 42 | 1 | `63216bb8e5536f2e` |
| v4 | `expv-1787874438930-b9g1fc` | 27/08 23:48:21Z | 42 | 3 | `63216bb8e5536f2e` |
| **v5** | `expv-1787884365439-msj4ub` | **28/08 02:36:25Z** | **48** | 3 | **`ff11928269f3c52e`** |

Las cinco siguen publicadas e **inmutables**; ninguna versión previa fue modificada.

---

## 7. ALCANCE

No se tocó Studio, contratos, APIs, stores, contenido editorial, versiones ni uploader. El diff se
limita al Runtime, la ficha, los cinco visores, el helper compartido y su suite.

Deudas que **siguen abiertas**: `CHP-MOOK-RUN-RESUME-WRITE-ON-READ-01` (§5) y la confirmación
editorial de la v5 (§6).
