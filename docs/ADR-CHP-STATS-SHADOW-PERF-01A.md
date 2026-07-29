# ADR CHP-STATS-SHADOW-PERF-01A — Arquitectura de ejecución del shadow canónico

**Estado:** implementado y **REFUTADO por medición**. Rama `chp/stats-shadow-perf`.
Producción intacta en `5703ebb` con `METRICS_ENGINE=legacy`.

> ## ⚠️ Corrección — `CHP-STATS-SHADOW-PERF-01D`
>
> ```
> DECISION_STATUS: SUPERSEDED_BY_MEASUREMENT
>
> REJECTED:
>   worker thread dentro del mismo contenedor/API
>   bajo cuota de CPU compartida (cpus:1.0)
>
> CAUSA:
>   · el worker thread aísla el EVENT LOOP;
>   · el worker thread NO aísla la cuota CFS de CPU;
>   · API y worker compiten dentro del mismo cgroup de cpus:1.0;
>   · la contención degrada incluso peticiones que NO generan trabajo shadow.
> ```
>
> **La decisión A + D2-pool no cumple el umbral.** El benchmark HTTP de
> aceptación mide **+12 % a +73 % de p95 en las siete rutas**, con la petición
> mediana casi duplicada. Detalle en `docs/CHP-STATS-SHADOW-PERF-BLOCK.md`.
>
> La evidencia original de este ADR **se conserva íntegra** más abajo. La
> secuencia hipótesis → experimento → refutación es el registro: la
> descomposición de coste y el descarte de las opciones B y C siguen siendo
> válidos; lo que se refuta es la conclusión de que D2-pool bastaba.
>
> **Dónde falla el razonamiento de este ADR:** la tabla de «coste main-thread
> previsto < 1 ms» es correcta y se confirmó (p95 0,74 ms), pero es la métrica
> equivocada. Sacar el cómputo del event loop **no lo saca de la cuota de CPU
> del contenedor**: el worker es un hilo del mismo cgroup, limitado a
> `cpus: 1.0`. El modo legacy ya consume 0,88 de esa cuota, así que el worker no
> encuentra CPU libre — la toma del hilo principal.
>
> Consecuencias medidas que este ADR no anticipó:
> - el job canónico previsto en **p95 206 ms** dura **1973 ms de media** bajo
>   carga real, porque el worker también está estrangulado;
> - el RSS sube ~100 MB, no los ~20 MB estimados;
> - una ruta 404 que **no encola ningún job** se degrada un +60 %, lo que prueba
>   que el coste es contención entre peticiones, no sobrecoste por petición;
> - **ningún sample rate lo evita**: al 10 % incumplen las 7 rutas.
>
> Lo que este ADR sí acertó: el worker elimina el bloqueo del event loop, no
> duplica el motor, preserva la exactitud y la respuesta pública queda
> **idéntica** (cero diferencias). El diagnóstico de dónde se va el tiempo
> (`loadEvents` 53 %, `computeOrganization` 42 %) sigue siendo válido.
>
> El siguiente intento debe atacar el **consumo total de CPU por petición**, no
> su ubicación. La vía más barata es abaratar el legacy —`USERS_DB` sin cachear
> y `getAllProgressAsMap()` completo en cada petición—, que además ya es un
> problema en producción hoy, sin shadow alguno.

## Contexto

`CHP-STATS-SHADOW-01A-R1` dejó el ejecutor canónico funcionalmente completo pero
bloqueado: el umbral `p95_shadow ≤ max(p95_legacy×1,10 ; p95_legacy+15 ms)` se
incumplía en 5 de 6 rutas. Este ADR mide las alternativas y elige una.

## Evidencia: dónde se va el tiempo

Descomposición sobre el snapshot productivo (**19.465 eventos**, 9.435 en la
ventana de 30 d, 647 usuarios; VPS 2 vCPU, Node v20.20.2, media de 5 corridas):

| Componente | Coste | Peso |
|---|---|---|
| `loadEvents(30d)` | **134,0 ms** | 53 % |
| `computeOrganization` | **105,2 ms** | 42 % |
| `loadDirectory` | 9,5 ms | 4 % |
| `buildIndex` | **3,8 ms** | 1,5 % |
| **Total (1 organización)** | **252,5 ms** | |
| Listado de 4 organizaciones | 407,3 ms | |

Este reparto es el que decide el ADR: **el índice no es el problema**.

## Alternativas medidas

### A — Eliminar la doble ejecución legacy · **RECOMMENDED**

`captureLegacy` reejecuta el handler legacy completo para capturar su body. Ese
coste es **main-thread puro** y proporcional al coste legacy de la ruta: en
`school/villas` son ~270 ms añadidos por petición muestreada.

Sustituirlo por captura del body durante la respuesta real elimina ese coste sin
tocar contratos. Barato, reversible, sin riesgo de exactitud.

### B — Consulta SQL acotada por scope · **REJECTED**

Medido sobre el snapshot: acotar por `server_ts` **y** por los `user_id` de la
organización devuelve **8.911 filas de 9.435 — apenas un 5 % menos**, en
**109,7 ms**. Villas concentra casi todos los eventos, así que el filtro no
reduce nada donde duele, y el coste dominante es materializar filas, no
filtrarlas. Índices existentes (`idx_event_ts`, `idx_user_content`,
`idx_session`, `idx_mode_ts`) ya cubren el acceso; añadir índices no cambia el
diagnóstico.

Se conserva como **DEFERRED** para el materializador, donde sí tiene sentido
leer incrementalmente por checkpoint.

### C — Índice canónico reutilizable · **REJECTED**

`buildIndex` cuesta **3,8 ms de 252,5** (1,5 %). Una caché con invalidación
segura añadiría riesgo de datos obsoletos y complejidad multi-instancia para
ahorrar ~13 ms contando `loadDirectory`. **No compensa.**

### D — Worker thread · **RECOMMENDED (variante pool)**

- **D2 spawn por petición:** p95 canónico 406 ms (el arranque del worker domina),
  `lag_p95`=2,2 ms. Funciona pero desperdicia ~200 ms cargando módulos.
- **D2-pool, worker persistente:** el worker carga módulos y crea el provider
  **una sola vez**.

| Métrica | Valor |
|---|---|
| **Coste en el hilo principal** | **p50 0,05 ms · p95 0,74 ms** |
| Latencia canónica total (off-thread) | p50 125 ms · p95 206 ms |
| `event_loop_lag_p95` | 1,7 ms |
| Con 6 trabajos en vuelo | turno de loop p95 0,20 ms · lag 3,3 ms |
| RSS del worker | ~20 MB |
| Cierre | limpio |

## Decisión: **A + D2-pool** — `SUPERSEDED_BY_MEASUREMENT` (`-01D`)

> Lo que sigue es el razonamiento **original**, conservado sin editar. Su
> conclusión quedó refutada por el benchmark HTTP: ver la corrección al inicio
> del documento. El fallo está en la premisa de la tabla siguiente —«coste
> main-thread previsto»—, que es la magnitud equivocada para decidir: mide dónde
> se ejecuta el cómputo, no cuánta CPU del contenedor consume.

El hilo principal pasa a pagar **menos de 1 ms** por petición muestreada. El
margen mínimo del umbral es **+15 ms** en las seis rutas, así que cabe con
holgura incluso sumando el lag bajo carga.

| Ruta | p95 legacy | límite | coste main-thread previsto |
|---|---|---|---|
| `schools` | 18 ms | 33 ms | < 1 ms |
| `school/villas` | 270 ms | 297 ms | < 1 ms |
| `school/nuevo-bosque` | 24 ms | 39 ms | < 1 ms |
| `school/filbo` | 21 ms | 36 ms | < 1 ms |
| `school/externado` | 14 ms | 29 ms | < 1 ms |
| `student` | 40 ms | 55 ms | < 1 ms |

**Por qué D es estructural y no un parche:** B y C solo *acortan* el bloqueo del
event loop; D lo *elimina*. Con B+C optimistas el cómputo seguiría costando
~100 ms de hilo principal, que no cabe en 15 ms de margen. Ninguna combinación
sin worker cumple el umbral.

### Exactitud

El worker invoca **el mismo `computeCanonicalMetrics`**, así que la exactitud se
preserva por construcción: no hay una segunda implementación del motor. Solo
cruzan el límite del worker **agregados** (`metrics`, `population`): cero PII,
cero eventos crudos.

> **Pendiente de verificación explícita:** la equivalencia de cifras bajo el
> worker (Villas 90/80 · Nuevo Bosque 90/80 `NO_ACTIVITY` · FilBo 47/46/44/2 ·
> Externado 2/0/0 `NO_DATA`) **no se re-ejecutó** en esta unidad. Es requisito
> de GREEN de la unidad de implementación.

## Operación

- **Multi-instancia:** cada API tiene su propio pool; no hay estado compartido
  ni coherencia que mantener. Es la ventaja de no cachear.
- **Rolling deploy y reinicio:** el pool se levanta con el proceso; sin estado
  que migrar.
- **Crash del worker:** se respawnea; el circuit breaker ya existente cubre los
  fallos repetidos.
- **`events.db` rotado o restaurado:** el worker lo abre **read-only** en cada
  job mediante el provider; no mantiene descriptor cacheado.
- **Rollback:** `METRICS_ENGINE=legacy` desactiva todo; el pool ni se usa.
- **Observabilidad:** los contadores del ejecutor ya existen; se añaden
  `shadow_worker_spawns`, `shadow_worker_crashes` y `shadow_worker_queue_depth`.

## Seguridad

SQL parametrizado (ya lo está), apertura read-only, sin WAL/SHM nuevos
(verificado), mensajes del worker solo con agregados, timeout y breaker
heredados, memoria acotada por el tamaño del pool.

## Plan de implementación

1. **`CHP-STATS-SHADOW-PERF-01B` — implementación.** Pool de workers acotado
   (`METRICS_SHADOW_WORKERS`, default 1) + captura del body legacy sin
   reejecutar. Archivos previstos: `server/metrics/shadowWorkerPool.mjs` (nuevo),
   `shadowExecutor.mjs`, `metricsRouteBoundary.mjs`, `server.js`.
2. **`-01C` — pruebas.** Equivalencia de cifras en las 4 instituciones bajo el
   worker, crash y respawn, timeout, cola llena, shutdown, cero PII en mensajes.
3. **`-01D` — benchmark de aceptación.** Misma metodología; las 6 rutas deben
   cumplir el umbral con un sample rate declarado.
4. **`-01E` — imagen y canary.**
5. **`-01F` — despliegue en `legacy`** (el pool queda inerte).
6. **`-01G` — activación de shadow** con sample rate bajo y observación.

**Riesgos:** el pool añade un modo de fallo nuevo (worker muerto); la memoria
crece ~20 MB por worker; `better-sqlite3` es nativo y debe funcionar en el
worker (verificado en este prototipo).

**Criterio de GREEN de `-01D`:** las seis rutas dentro del umbral, cifras
idénticas en las cuatro instituciones, cero PII, stores intactos.
