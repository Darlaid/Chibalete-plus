# CHP-STATS-LEGACY-PERF-01E-R1 — Gates preinscritos por clase de ruta

**Registrados ANTES de ejecutar la medición confirmatoria.** Existen para que el
criterio no pueda ajustarse al resultado: si la medición no los alcanza, el
veredicto es STOP, no un umbral reescrito.

## Por qué gates por clase y no uno homogéneo

`-01E` aplicó un único gate del 50 % a todas las rutas que crean contexto. La
medición demostró que esas rutas **no hacen el mismo trabajo**:

| Ruta | memo hits | memo misses | Motivo |
|---|---|---|---|
| ROUTE_2 institución | **90** | 90 | `computeSchoolMetrics` calcula cada alumno dos veces (`allStudents` + `courseBreakdown`) |
| ROUTE_7 grupo | **0** | 90 | `computeCourseMetrics` lo calcula una sola vez |

Una institución se beneficia de **indexación + memoización**; un grupo solo de
**indexación**. Pedirle al grupo la misma reducción es pedirle un ahorro que su
código no puede producir. Los gates de abajo reflejan el trabajo real de cada
clase — y siguen exigiendo una mejora sustancial, no una rebaja de conveniencia.

## A — `SCHOOL_AGGREGATION_MEMOIZED` · ROUTE_2, ROUTE_3, ROUTE_4

- `p50_on ≤ p50_off × 0,50`
- `p95_on ≤ p95_off × 0,50`
- reducción absoluta de p95 **≥ 100 ms** cuando `p95_off ≥ 200 ms`
- contextos creados = liberados
- **memo hits > 0**
- un solo scan de progreso por petición
- un solo procesamiento de eventos por petición

## B — `COURSE_AGGREGATION_INDEXED` · ROUTE_7

- `p50_on ≤ p50_off × 0,65` (≥ 35 % de mejora)
- `p95_on ≤ p95_off × 0,60` (≥ 40 % de mejora)
- reducción absoluta de p95 **≥ 100 ms** cuando `p95_off ≥ 250 ms`
- **cero memo hits es el resultado esperado, no un fallo**
- un solo scan de progreso, un solo procesamiento de eventos
- cero regresión contractual
- individual **y** dual deben cumplir
- **≥ 3 de 4 bloques** deben cumplir, y también el agregado

## C — `UNCHANGED_NO_CONTEXT` · ROUTE_1, ROUTE_5, ROUTE_6, 401, 403, 404

- `p95_on ≤ max(p95_off × 1,05 ; p95_off + 15 ms)`
- **cero contextos creados**
- cero scans adicionales
- mismo status y mismo body
- se exige en el agregado y en **≥ 3 de 4 bloques**

Una diferencia por debajo de la resolución práctica del experimento no se
declara FAIL: se reporta con su margen y su dispersión por bloque.

## Metodología obligatoria

- **Solo ritmo de llegada igualado** (bucle abierto). El bucle cerrado no vale
  como veredicto para rutas baratas: hace que el brazo rápido reciba más carga.
- Diseño **ABBA**, 4 bloques por brazo.
- **≥ 250 muestras por ruta y brazo.**
- Topología individual y dual; concurrencia 1 y 4.
- Warm-up separado, cooldown entre bloques, orden con semilla fija.
- Resultados **por bloque** además del agregado: un p95 combinado no puede
  ocultar bloques inestables.

## Salidas posibles

- **GREEN** — `LEGACY REQUEST-CONTEXT HTTP PERFORMANCE ACCEPTED BY ROUTE CLASS`
- **STOP** — `LEGACY COURSE ROUTE REQUIRES ADDITIONAL DATA-LOAD OPTIMIZATION`,
  si ROUTE_7 no alcanza el 40 % de p95 o el criterio absoluto.

Solo tras un STOP quedaría autorizada una unidad de caché o proyección
adicional. Antes, no.
