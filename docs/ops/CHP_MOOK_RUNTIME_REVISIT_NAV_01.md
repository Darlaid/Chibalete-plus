# CHP-MOOK-RUNTIME-REVISIT-NAV-01 — ATRÁS Y ADELANTAR

**Veredicto:** 🟢 **`GREEN-MOOK-RUNTIME-REVISIT-NAV-PRODUCTION`**
**Rama:** `chp/mook-contract-00` · **Commit:** `356f2fe` · **Fecha:** 2026-08-28
**Release:** frontend `chibalete/front:nav-356f2fe` · APIs **sin tocar** en `chibalete/api:e70c0f1` ×2

⏸️ **Pendiente: la comprobación interactiva en producción es de Nicolás.** Ver §7.

---

## 1. LA IDEA: DOS CONCEPTOS, NO UNO

```text
FRONTERA         el punto del recorrido. Lo decide el SERVIDOR.
ELEMENTO VISIBLE qué tarjeta está expandida ahora.
```

Confundirlos habría sido el error de esta unidad. Revisar hacia atrás cambia **solo lo segundo**.

**La frontera no se recalcula en cliente.** `computeRouteView` ya devuelve un `state` por nodo
—`completed` / `current` / `available` / `locked`— y la navegación **lee** ese estado. Reimplementar
el desbloqueo en el navegador habría creado una segunda fuente de verdad sobre quién puede ver qué;
la autoridad sigue siendo el backend.

Por eso esta unidad **no necesitó backend, migración ni contrato nuevo**.

---

## 2. COMPORTAMIENTO

**Atrás** abre el nodo accesible anterior, cruza módulos y puede abrir nodos ya completados. Se
desactiva en el primer nodo accesible.

**Adelantar** está visible pero **inerte mientras estás en tu frontera**. Se activa solo tras
retroceder, avanza de uno en uno y **nunca supera la frontera ni abre un nodo bloqueado**.

Ejemplo obligatorio de la unidad, verificado en navegador:

```text
Carta de entrada           (Adelantar deshabilitado — estás en tu frontera)
→ Atrás     → A01. Son las once de la noche   (Atrás deshabilitado — primer accesible)
→ Adelantar → Carta de entrada                (Adelantar vuelve a deshabilitarse)
```

**Sin persistencia.** No hay pila de navegación, no se toca la URL ni el historial del navegador, y
**al recargar se vuelve al punto canónico del recorrido**, no al último nodo revisado.

---

## 3. LO QUE HUBO QUE CERRAR: REVISAR ES SOLO LECTURA

Una consecuencia real del cambio, que la QA visual destapó y que **no estaba en el encargo**.

Antes, un nodo completado **nunca** se renderizaba expandido: solo el `current` se mostraba como
tarjeta con acciones. Al permitir revisarlo, su acción de finalización quedaba a un clic — y
`completeNode` **no es idempotente**:

```js
run.nodeStates[nodeId] = { ...(run.nodeStates[nodeId] || {}), status: 'completed',
                           completedAt: nowIso(), … };   // reescribe completedAt
```

Es decir: «mirar atrás» habría dejado una escritura al alcance de un clic. Se cerró haciendo que la
tarjeta revisada sea **de solo lectura**: se ocultan «Terminé esta lectura / de verlo-escucharlo», el
envío de ACTIVITY y el de PRODUCTION.

Y el distintivo dejó de mentir: mientras se revisa dice **«Revisando»**, no «Estás aquí». El punto
del recorrido no se movió, y la interfaz no puede afirmar lo contrario.

---

## 4. ACCESIBILIDAD Y RESPONSIVE

- Botones **HTML reales** con `disabled` verdadero en ambos extremos del recorrido.
- Nombres accesibles: «Ver el paso anterior» y «Volver al paso siguiente ya alcanzado».
- Van en **su propia fila**, con separador: la acción de finalización conserva su **jerarquía
  primaria** (sólida, indigo) y la navegación es **secundaria** (outline).
- A **390 px**: Atrás 80 px y Adelantar 111 px, ambos dentro del viewport, `flex-wrap` para apilar,
  y **`scrollWidth 390 == clientWidth 390`** — cero desbordamiento.

**Audio:** los reproductores viven dentro de `NodeShell`, que **se desmonta** al cambiar de nodo
visible. El audio anterior se detiene por el ciclo de vida existente, sin código nuevo. Verificado:
tras navegar solo queda **una** tarjeta expandida en el DOM.

---

## 5. PRUEBAS

**19 aserciones** en `server/__test__/mookRevisitNav01.test.mjs`, GREEN en Windows y **Docker Linux**.

La capa de semántica no usa maquetas: construye rutas **reales** con `createDraftVersion`,
`publishVersion`, `startRun`, `completeNode` y `computeRouteView`, sobre un recorrido de **dos
módulos**. Cubre el ejemplo obligatorio, el cruce de módulos en ambos sentidos, los dos bordes, y la
prueba de que navegar deja **run, estados y progreso idénticos**.

La capa de invariantes acota el corte a **lo que se ejecuta al pulsar** —los manejadores
`onBack`/`onForward` y su derivación—, no a los efectos de carga: ampliarlo daría un falso positivo,
porque esos sí llaman a la red y deben hacerlo.

**QA en navegador**, fixture de dos módulos con A01 completado, «Carta de entrada» como frontera y
B00 + Movimiento 1 bloqueados:

| Comprobación | Resultado |
|---|---|
| Ejemplo obligatorio completo | ✅ con `disabled` correctos en ambos extremos |
| Pulsar «Adelantar» deshabilitado en la frontera | ✅ no hace nada |
| Nodo bloqueado | ✅ sigue bloqueado y colapsado |
| Progreso | ✅ **1/4**, sin cambios |
| URL | ✅ sin tocar |
| Recarga tras retroceder | ✅ vuelve a «Carta de entrada», el punto canónico |
| Tarjeta revisada | ✅ «Revisando» y **cero acciones de finalización** |
| Store del fixture tras toda la navegación | ✅ **byte-idéntico** |

También GREEN: `test:mook` completo, `test:content-rmw`, typecheck sin regresiones, `npm run build`
y **el build real con `Dockerfile.front`**.

---

## 6. DEPLOY E INVARIANTES PRODUCTIVOS

**Solo frontend.** El diff se limita al Runtime, su suite y el enganche en `test:mook`; las APIs no
se reiniciaron.

Comparación **antes y después** del deploy — todo idéntico:

| | Valor |
|---|---|
| `mook_db.json` | `5c838328…4c0ba341` **byte-idéntico** |
| Cubierta | `61184179…3eff384b` **byte-idéntica** |
| uploads | 3329 |
| versiones / `currentVersionId` | 4 / v4 |
| runs / evidencias | **1 / 0**, pineado a v1 |
| nodos / privacidad / `modhash` | 56 / 15 / `63216bb8e5536f2e` |
| Servicios | 4 healthy, `RestartCount=0` |
| 5xx / ERROR / SECURITY | **0 / 0 / 0** |

**Código verificado en el servidor**: el chunk `Experiencias-DK1DARyW.js` que sirve el edge contiene
«Adelantar», «Revisando» y los dos nombres accesibles.

**Rollback:** `chibalete/front:obj-ab380ed`. Override respaldado en `.bak-pre-nav-20260828T003342Z`.
Deploy registrado en `/root/deploys.log`.

---

## 7. ⏸️ QA PRODUCTIVA INTERACTIVA — PENDIENTE, Y POR QUÉ

La unidad pide probarlo «con una cuenta lectora autorizada **sin completar nuevos nodos**» y, a la
vez, confirmar que **run/evidencias siguen `1/0`**. En producción **ninguna cuenta lectora tiene
run**: abrir el recorrido con una crearía un segundo run y rompería justamente esa invariante.

El único run existente es el del **administrador** —A01 completado, «Carta de entrada» como
frontera—, que es exactamente el escenario del ejemplo. Y la sesión es **cookie-only**: no puedo
autenticarme como él.

Así que la comprobación interactiva le corresponde a Nicolás. Todo lo demás está verificado, y el
código está confirmado en el bundle servido.

---

## 8. ALCANCE

No se tocó Studio, contratos, APIs, stores, contenido editorial, versiones ni uploader.
**No se cierra `CHP-CI-FRONT-IMAGE-BUILD-COVERAGE-01`**, que sigue abierta junto a
`CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01` y «`test:mook` fuera de CI».
