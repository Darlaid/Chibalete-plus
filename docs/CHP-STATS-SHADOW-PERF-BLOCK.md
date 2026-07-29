# CHP-STATS-SHADOW — Ejecutor canónico enlazado, bloqueado por rendimiento

```
CANONICAL_EXECUTOR_BOUND
PERFORMANCE_BLOCKED
NOT_DEPLOYABLE
NOT_READY_FOR_IMAGE_BUILD
```

> Rama: `chp/stats-shadow-perf` (checkpoint desde `5475f26`).
> La rama desplegable sigue siendo `hotfix/immersive-tts-resume-progress`, en
> `5475f26`, con `canonicalExecutor: null`. Producción permanece en la imagen
> `5703ebb` con `METRICS_ENGINE=legacy`.

## 1. Qué SÍ funciona

La funcionalidad está completa y verificada. Esto no es un prototipo a medias:

- `computeCanonicalMetrics` extraído a `server/metrics/canonicalMetricsService.mjs`:
  sin `req`/`res`, sin autenticar ni autorizar, con `provider` y `clock`
  inyectables. HTTP y shadow comparten el **mismo** motor; el shadow no lo duplica.
- `metricsRouterV2` quedó como capa fina (−133/+37). Las **121 aserciones** del
  contrato v2 pasan sin modificarlas: paridad de status, body, errores,
  autorización, periodos, `includeQuality` y `readingTimeMs=NOT_DEFINED`.
- Los **cuatro** `canonicalExecutor` están enlazados al motor real (0 `null`).
- El trabajo canónico se encola en `res.once('finish'|'close')`, no en el mismo
  turno; invariante `canonicalStartedAt >= responseFinishedAt` instrumentada.
- Una respuesta 4xx **no** genera trabajo shadow (`shadow_skipped_unauthorized`).
- `engineReadiness()` falla cerrada: `shadow` sin ejecutor → `SHADOW_NOT_CONFIGURED`.
- Sobre el snapshot productivo (**19.465 eventos**): 155 comparaciones reales,
  stores byte a byte sin cambio, **cero archivos nuevos**, `insights.db` no creada.
- Poblaciones correctas: Villas 90/80 · Nuevo Bosque 90/80 `NO_ACTIVITY` ·
  FilBo 47/46/44/2 · Externado 2/0/0 `NO_DATA`.

## 2. Qué NO es aceptable

El criterio `p95_shadow ≤ max(p95_legacy × 1,10 ; p95_legacy + 15 ms)` **se
incumple en 5 de 6 rutas**, con 25 iteraciones y 6 de warm-up separadas,
`maxConcurrency=1`, en el VPS:

| Ruta | p95 legacy | límite | shadow 1.0 | shadow 0.1 |
|---|---|---|---|---|
| `schools` | 18 ms | 33 ms | **278 ms** | **325 ms** |
| `school/villas` | 270 ms | 297 ms | **519 ms** | **549 ms** |
| `school/nuevo-bosque` | 24 ms | 39 ms | **133 ms** | **129 ms** |
| `school/filbo` | 21 ms | 36 ms | **116 ms** | **115 ms** |
| `school/externado` | 14 ms | 29 ms | 16 ms ✓ | 17 ms ✓ |
| `student` | 40 ms | 55 ms | **131 ms** | **136 ms** |

`externado` cumple solo porque su población es de 2 usuarios.

### Causa

Cada petición shadow **reconstruye el mundo entero**: carga los 19.465 eventos y
rehace el índice sobre 647 usuarios y 20 grupos, en el **mismo hilo del event
loop**. Aunque se encole tras `finish`, la CPU que consume retrasa las
peticiones siguientes.

`captureLegacy` agrava el problema: reejecuta el handler legacy completo para
capturar su body, duplicando ese coste dentro del shadow.

### Por qué el sample rate NO lo resuelve

`p95` captura precisamente las peticiones muestreadas. Con 10 % de muestreo,
2-3 de cada 25 peticiones hacen el trabajo pesado y caen en la cola de la
distribución — por eso `shadow 0.1` sale **igual o peor** que `shadow 1.0`.
**No existe un sample rate recomendable con el diseño actual.** El arreglo es
arquitectónico, no de configuración.

## 3. Alternativas a evaluar (ninguna elegida aún)

Requieren medición comparativa antes de decidir:

1. **Índice reutilizable con invalidación segura.** Cachear directorio e índice
   entre peticiones. Riesgo: una invalidación incorrecta serviría métricas
   obsoletas tras un cambio de membership.
2. **Consulta SQL acotada al scope.** Traer solo los eventos de la organización
   y el periodo, en vez de los 19.465. Riesgo: mover lógica de filtrado al SQL
   puede divergir del motor de referencia.
3. **Worker thread.** Sacar el cómputo del event loop principal. Riesgo:
   coste de serialización y complejidad de ciclo de vida.
4. **Eliminar la segunda ejecución legacy.** Capturar el body durante la
   respuesta real en vez de reejecutar el handler. Reduce el coste a la mitad,
   pero no ataca la causa principal.
5. **Combinación** de las anteriores.

La opción 4 es la más barata y de menor riesgo; 1 y 2 son las que realmente
mueven la aguja. Deben medirse contra la misma línea base de este documento.

## 4. Criterio de salida

Este bloqueo se levanta cuando, con la misma metodología, las **seis** rutas
cumplan el umbral con un sample rate declarado, y las suites funcionales sigan
verdes. Hasta entonces:

- no construir imagen con este código;
- no desplegar;
- no activar `METRICS_ENGINE=shadow` en producción;
- no fusionar `chp/stats-shadow-perf` a la rama desplegable.

---

## Actualización — CHP-STATS-SHADOW-PERF-01B (implementación local)

```
IMPLEMENTED_LOCALLY
EQUIVALENCE_PENDING
BENCHMARK_ACCEPTANCE_PENDING
NOT_DEPLOYABLE
```

**El bloqueo de rendimiento NO se declara resuelto todavía**: falta el benchmark
HTTP de aceptación (`-01D`) y la equivalencia sobre el snapshot completo (`-01C`).

### Qué se implementó

- **Captura única del body legacy.** `attachLegacyCapture` envuelve `res.json` /
  `res.send` y toma el body que el handler ya está enviando. Se eliminó
  `buildCaptureLegacy`, que reejecutaba el handler completo (y con él la
  autorización). Verificado: `legacy_handler_execution_count = 1` en legacy y
  en shadow.
- **Proyección mínima.** Del body legacy solo se conserva `sessions` y
  `distinctContents`; del canónico, esas dos métricas más estados y agregados
  poblacionales. Nunca cruzan bodies HTTP, eventos, padrón ni PII.
- **Worker persistente** (`shadowWorker.mjs`): importa el mismo
  `computeCanonicalMetrics` y el mismo provider; SQLite read-only; sin
  `CREATE TABLE`, sin `journal_mode`, sin `insights.db`, sin `analytics_db.json`.
- **Pool acotado** (`shadowWorkerPool.mjs`): estados
  `STARTING/READY/DEGRADED/STOPPING/STOPPED`, cola acotada, timeout, descarte de
  respuestas tardías, crash + respawn con **backoff exponencial acotado**,
  circuit breaker y shutdown limpio. `METRICS_SHADOW_WORKERS` default **1**,
  máximo duro **4**; un valor inválido es error explícito, y el tamaño **nunca**
  se deriva del número de CPU.

### Protocolo del worker

Hacia el worker: `jobId`, `protocolVersion`, `scopeKind`, identificadores
mínimos, `period`, `idleMs`, `includeQuality`, `nowTs`.
De vuelta: `jobId`, `ok`, `status`, proyección agregada, `durationMs` y error
**sanitizado** (solo código). Los identificadores viven en memoria durante el job
y no se registran en logs, métricas ni errores.

### Verificación funcional (fixtures del snapshot)

| Institución | Resultado del worker |
|---|---|
| Villas de Aranjuez | 90/80/80/0 · `MEASURED` · sessions 60 |
| Nuevo Bosque | 90/80/80/0 · `NO_ACTIVITY` |
| FilBo 2026 | **47/46/44/2** · `NO_ACTIVITY` |
| Externado | 2/0/0 · `NO_DATA` · **sessions `null`, no 0** |

También `group`, `user` y el listado responden 200. 7 jobs enviados, 7
completados, 0 fallos, 0 crashes, shutdown limpio.

### Sobre WAL/SHM

`events.db` está en **modo WAL**: cualquier lector —incluida la API productiva
actual— necesita el archivo `-shm`. Con un fixture fiel (que incluye
`events.db-wal` y `events.db-shm`, como producción, donde existen desde el
25 y el 28 de julio) el worker **no crea ningún archivo nuevo** y `events.db`
queda byte a byte igual. Un fixture que copie solo `events.db` sí verá aparecer
los compañeros: es comportamiento estándar de SQLite, no una escritura del
shadow.

### Pendientes

- `-01C`: equivalencia de cifras sobre el snapshot productivo completo.
- `-01D`: benchmark HTTP de aceptación de las 6 rutas contra el umbral.
- Escalabilidad 5×/10×.

---

## Actualización — CHP-STATS-SHADOW-PERF-01C (equivalencia verificada)

```
WORKER_EQUIVALENCE_VERIFIED
HTTP_BENCHMARK_PENDING
SCALABILITY_PENDING
NOT_DEPLOYABLE
```

### Metodología

`REFERENCE` (`computeCanonicalMetrics` en el hilo principal) frente a `WORKER`
(mismo request lógico por el pool real), ambos con **idénticos** `scopeKind`,
identificadores, `period`, `idleMs`, `includeQuality`, stores y configuración.
`TZ=UTC` y un `nowTs` fijo (`1800000000000`) para toda la batería.

Snapshot `ace687e6`: **19.465 eventos**, `quick_check=ok`, 9.011.200 bytes,
sha `03fe95e0…`, rango `1778203452389..1785021479763`, 647 usuarios, 20 grupos,
4 instituciones. Copiado con sus compañeros `-wal`/`-shm`.

### Corrección de protocolo (autorizada por Fase 14)

El worker devolvía **solo una proyección**, lo que hacía imposible verificar la
equivalencia contractual. Se elevó el protocolo a **v2**: ahora devuelve el
**sobre completo** (que contiene solo agregados: `contractVersion`, `period`,
`metrics`, `population` como conteos, `coverage`, `quality` — ningún
identificador) y añade un **handshake sanitizado** con `protocolVersion`,
`contractVersion`, módulo del motor y major de Node. Un protocolo incompatible
falla **antes** de ejecutar jobs.

No se tocó `referenceEngine`, ni definiciones poblacionales, ni sesiones, ni
periodos, ni quality buckets, ni estados.

### Normalización

Se excluyen de la comparación **solo** metadata propia del worker: `durationMs`,
`jobId` y `handshake`. Todo lo contractual —incluido `generatedAt`, que es
determinista bajo `nowTs` fijo— se compara byte a byte.

### Resultados

| | |
|---|---|
| Casos ejecutados | **824** |
| `EXACT_MATCH` | **824 (100 %)** |
| Divergencias | **0** |
| Jobs completados | 825 (824 + handshake) |
| Fallos · timeouts · crashes · tardías | 0 · 0 · 0 · 0 |
| Determinismo RUN_1 vs RUN_2 | **byte a byte idéntico** |
| Duración orientativa | ~85 s por corrida |

Matriz: listado (30d, all, sin quality) · las 4 instituciones (30d y all) ·
los **20 grupos** (30d y all, incluyendo históricos y `lt-org`) · los **647
usuarios** (30d) más 120 con `all` · scopes inexistentes · periodo personalizado
con actividad, sin actividad y cruzando el límite UTC.

### Anclas institucionales (vía worker)

| Institución | Población | Estado |
|---|---|---|
| Villas de Aranjuez | 90 / 80 / 80 / 0 | `NO_ACTIVITY` en el periodo fijado |
| Nuevo Bosque | 90 / 80 / 80 / 0 | `NO_ACTIVITY` |
| FilBo 2026 | **47 / 46 / 44 / 2** | `NO_ACTIVITY` |
| Externado | 2 / 0 / 0 / 0 | **`NO_DATA` con valores `null`** |

`readingTimeMs = NOT_DEFINED` y `value = null` en las cuatro. Sin diagnósticos,
rankings ni recomendaciones.

**Distinción clave, verificada:** `NO_ACTIVITY` lleva `value: 0` —población
medible, cero actividad observada— mientras `NO_DATA` lleva `value: null`. El
cero significa cero observado; la ausencia tiene estado propio.

### Integridad

Cero archivos nuevos, hashes sin cambio y `quick_check=ok` antes y después de
ambas corridas. Sin PII en la evidencia (las únicas coincidencias de «@» son el
banner de dotenv).

### Pendiente

El bloqueo de rendimiento **sigue vigente**: falta `-01D`, el benchmark HTTP de
aceptación de las 6 rutas, y la escalabilidad 5×/10×.

---

## Actualización — CHP-STATS-SHADOW-PERF-01D (benchmark HTTP de aceptación)

```
HTTP_ACCEPTANCE_FAILED
POST_RESPONSE_CONTENTION_FAILED
PERFORMANCE_BLOCKED
NOT_DEPLOYABLE
```

El bloqueo **NO se levanta**. El worker resuelve el problema que atacaba —
sacar el cómputo del event loop— pero no el que decide el umbral.

### El error del ADR, en una frase

El ADR midió el coste del worker **en el hilo principal** (p95 0,74 ms) y
concluyó que cabía en el margen de +15 ms. Pero *fuera del event loop no es
fuera de la cuota de CPU*: el worker es un hilo del **mismo contenedor**, que en
producción está limitado a `cpus: 1.0` sobre un host de 2 vCPU.

Medido: el modo legacy ya consume **0,88 de esa cuota de 1,0**. El worker pide
~0,2-0,25 más. La suma supera el límite, el CFS estrangula a los dos, y el
resultado lo paga la respuesta pública.

### Metodología

Entorno HTTP aislado sobre `chibalete/api:5703ebb`, red Docker interna sin
puertos publicados, código de la rama montado en solo lectura, `cpus: 1.0` y
`mem 1g` por API —los mismos límites que producción—, snapshot `ace687e6`
copiado a una fixture de trabajo. Cliente HTTP en contenedor aparte,
concurrencia 1, orden de rutas barajado con semilla.

**Diseño pareado ABBA** (`L S S L L S S L`, 4 bloques por brazo, 25 olas por
bloque, 100 mediciones por ruta y brazo). Es la corrección clave: en una matriz
secuencial el brazo legacy se mide primero y los shadow horas después, así que
cualquier deriva del host se confunde con el efecto del motor. Intercalando, una
deriva lineal afecta por igual a ambos brazos y se cancela.

**La deriva quedó descartada con datos**: el p95 de `ROUTE_3` en los cuatro
bloques legacy, repartidos por toda la ventana, es estable —2005, 1926, 2196,
2232 ms— mientras los cuatro bloques shadow están sistemáticamente por encima
—2792, 4118, 2728, 2541 ms—.

### Resultado — las siete rutas incumplen

Umbral `p95_shadow ≤ max(p95_legacy × 1,10 ; p95_legacy + 15 ms)`, muestreo
100 %, instancia única, muestras agrupadas (100 por ruta y brazo):

| Ruta | p95 legacy | umbral | p95 shadow | dif | p50 legacy → shadow |
|---|---|---|---|---|---|
| `ROUTE_1` listado | 439 ms | 483 ms | **760 ms** | **+73,0 %** | 180 → 366 ms |
| `ROUTE_2` Villas | 2300 ms | 2530 ms | **3322 ms** | **+44,5 %** | 1696 → 1963 ms |
| `ROUTE_3` Nuevo Bosque | 2078 ms | 2285 ms | **2792 ms** | **+34,4 %** | 1302 → 1553 ms |
| `ROUTE_4` FilBo | 1532 ms | 1685 ms | **2095 ms** | **+36,8 %** | 861 → 1097 ms |
| `ROUTE_5` Externado (404) | 485 ms | 533 ms | **777 ms** | **+60,2 %** | 171 → 358 ms |
| `ROUTE_6` usuario | 452 ms | 497 ms | **742 ms** | **+64,3 %** | 164 → 400 ms |
| `ROUTE_7` grupo | 1946 ms | 2141 ms | **2188 ms** | **+12,4 %** | 986 → 1427 ms |

No es un efecto de cola: **la petición mediana casi se duplica** (`ROUTE_6`
+143 %). La distribución entera se desplaza.

### La prueba de que es contención, no sobrecoste por petición

`ROUTE_5` es un **404**. Por diseño, una respuesta 4xx no encola trabajo shadow
(`shadow_skipped_unauthorized`), y así se verificó. Aun así se degrada un
**+60,2 %**, y su p50 se duplica.

Una petición que no genera ni un solo job es un 60 % más lenta solo porque
*otras* peticiones tienen un worker calculando. Eso es competencia de CPU entre
hilos del mismo contenedor, no coste de la petición muestreada. Es exactamente
el fenómeno que la Fase 8 existe para detectar, y el que el ADR no modeló.

### Por qué bajar el sample rate tampoco sirve

Estas cifras vienen de la **matriz secuencial** (3 repeticiones por escenario,
cada escenario medido en su propia ventana temporal), no del diseño ABBA. Esa
matriz tiene el sesgo de deriva ya descrito —el brazo legacy se midió primero—,
así que se leen como **direccionales**, no como veredicto:

| Tasa (matriz secuencial) | Jobs ejecutados | Rutas que incumplen |
|---|---|---|
| 100 % | 4320 | 6 de 7 |
| 25 % | 1070 | 6 de 7 |
| 10 % | 387 | **7 de 7** |

El veredicto formal al 100 % es el de la tabla ABBA de arriba: **7 de 7**. La
matriz secuencial daba 6 de 7 al 100 % precisamente porque el sesgo de deriva la
hacía *menos* sensible en la ruta que quedaba dentro del umbral, no más.

Lo que las tres tasas sí muestran de forma consistente es lo relevante: con 387
jobs en 4320 peticiones —una novena parte de la carga canónica— la degradación
**no desaparece**. Reducir el muestreo reduce el número de jobs, pero no libera
cuota de CPU suficiente para devolver las rutas por debajo del umbral.

La conclusión del `-01A` se mantiene, aunque por una causa distinta: entonces el
cómputo bloqueaba el hilo principal; ahora satura la cuota del contenedor. **No
existe un sample rate recomendable.** No se declara ninguno.

> Las tasas 25 % y 10 % **no se remidieron con diseño ABBA**. Sostener un
> veredicto formal por tasa exigiría repetirlas pareadas; aquí solo se afirma lo
> que la evidencia soporta: que bajar la tasa no elimina la degradación.

### Coste real del worker

| | legacy | shadow 100 % |
|---|---|---|
| CPU del contenedor (cuota 1,0) | 0,878-0,884 | 0,885-0,896 |
| CPU del hilo worker | — | 121-230 s por corrida |
| Duración media del job canónico | — | **1973 ms** (máx 8160 ms) |
| RSS | 155-176 MB | 195-277 MB |
| Duración de la corrida | ~655 s | ~835 s (**+27 %**) |
| Crashes · queue-full · breaker | 0 · 0 · 0 | 0 · 0 · 0 |
| Timeouts | 0 | 3 por corrida (de 1440) |

El job canónico previsto por el ADR era **p95 206 ms**; el medido bajo carga
real es **1973 ms de media**. El worker también está estrangulado. El RSS sube
~100 MB, no los ~20 MB previstos.

### Lo que SÍ quedó demostrado

- **La respuesta pública es idéntica.** Comparación legacy contra shadow en las
  7 rutas más 401/403/404: **cero diferencias** de status, content-type, JSON,
  orden de claves y nulls (normalizando solo sellos de generación). El fallo es
  de latencia, no de contrato.
- **Cero escrituras.** `events.db`, `insights.db`, `progress.db`,
  `offline_assignments.db`, `analytics_db.json` y el padrón quedan byte a byte
  idénticos; `quick_check=ok` después. Ninguna `insights.db` nueva, ningún
  `CREATE TABLE`, ningún `PRAGMA journal_mode`.
- **El pool se comporta.** 1 worker por instancia, cero crashes, cero
  queue-full, breaker nunca abierto, cola siempre a 0, shutdown limpio.
- **Un 4xx no encola trabajo canónico.**
- **Producción intacta** durante todo el benchmark: ambas API healthy,
  `restarts=0`, sin 5xx nuevos.

### Hallazgo aparte: el shadow no compara nada

`projectLegacy` lee `backboneMetrics.sessions` y `backboneMetrics.distinctContents`,
y el contrato los declara así en `METRIC_MATRIX`. Pero el cuerpo legacy real
expone **`totalSessions`** y **no tiene** `distinctContents`. Las dos
proyecciones salen `null`, las dos únicas métricas comparables se descartan por
`METRIC_NOT_COMPARABLE` y `shadow_differences_by_reason` queda **vacío** tras
4320 peticiones muestreadas.

Es decir: hoy el shadow paga el coste completo del cálculo canónico y **no
obtiene ni una sola comparación**. No se corrige aquí porque esta unidad no está
autorizada a cambiar definiciones de métricas ni el contrato; queda como
requisito de la siguiente unidad.

### Límites de esta medición

- La línea base absoluta del `-01A` (18-270 ms) **no es reproducible por HTTP**.
  Las rutas legacy cuestan 0,4-2,3 s de p95 porque `USERS_DB` está en
  `UNCACHED_JSON_FILES` —cada petición reparsea los 333 KB del padrón— y
  `getAllProgressAsMap()` reescanea los 2,9 MB de `progress.db`. Es
  comportamiento que producción comparte. El umbral se aplica contra la línea
  base remedida en el mismo banco.
- `NO_DATA` **no es alcanzable** por la ruta legacy de institución: el handler
  resuelve contra `group.school` y Externado no tiene grupos, así que responde
  404. Coherente con que `CANONICAL_COMPATIBILITY` marque `metrics.school` como
  `CANONICAL_BLOCKED` precisamente porque el shape legacy no sabe expresar
  `NO_DATA`.
- Por un fallo del script de fixture, tres JSON pequeños
  (`leo_memory_db`, `leo_interactions_db`, `submissions_db`, ~47 KB) se
  levantaron vacíos en vez de con datos del snapshot. Afecta por igual a ambos
  brazos, así que no altera la comparación; hace las cifras absolutas
  marginalmente optimistas.
- **5× y 10× no se ejecutaron**: están condicionadas a que 1× cumpla el umbral.
  El generador sintético determinista queda listo en
  `scripts/perf/synthetic-store-gen.mjs`.

## Hallazgos derivados de `-01D`

Tres frentes distintos, ninguno abordado en esta unidad.

### A — El coste del legacy es el verdadero cuello de botella

Antes de que exista shadow alguno, cada petición a una ruta legacy de métricas:

- **reparsea el padrón canónico completo** (~333 KB, 647 usuarios). `USERS_DB`
  está en `UNCACHED_JSON_FILES` por una razón deliberada y correcta —el gestor de
  usuarios debe reflejar altas al instante en `api_1` y `api_2`—, pero el precio
  se paga en **todas** las rutas, no solo en las de identidad;
- **reescanea el store de progreso entero** vía `getAllProgressAsMap()`
  (~2,9 MB de SQLite) y reconstruye los índices con `initMetrics()`.

Resultado medido en el banco, **sin shadow**: p50 de 1,7 s y p95 de 2,3 s en la
institución de mayor volumen; 0,88 de la cuota de `cpus:1.0` consumida.

Optimizar esto no es una tarea de apoyo al shadow: **es una mejora de producción
por derecho propio**, y además es lo que liberaría la cuota de CPU que el shadow
necesitaría para caber.

### B — El comparador está inoperante

`projectLegacy` proyecta dos métricas, y ninguna de las dos existe en el cuerpo
que la ruta legacy publica:

| Métrica | Ruta declarada en `METRIC_MATRIX` | Qué publica el body legacy |
|---|---|---|
| `sessions` | `backboneMetrics.sessions` | `backboneMetrics.totalSessions` |
| `distinctContents` | `backboneMetrics.distinctContents` | **no existe** |

Ambas proyecciones salen `null`, las dos únicas métricas comparables se
descartan como `METRIC_NOT_COMPARABLE` y, tras **4320 peticiones muestreadas**,
`shadow_differences_by_reason` queda **vacío**.

Consecuencia operativa: activar shadow en este estado pagaría el coste completo
del cálculo canónico **sin producir una sola comparación clasificada**. El
rendimiento no es el único motivo por el que hoy no serviría de nada activarlo.

`totalSessions` **no se ha demostrado equivalente** a `sessions`, y
`distinctContents` no tiene contraparte legacy identificada. Establecer esa
equivalencia es trabajo de contrato, no un renombrado: por eso no se corrige
aquí.

### C — Alternativas para el siguiente frente

```
RECOMMENDED NEXT
  · cache read-through del padrón con invalidación por fingerprint de archivo
    (mtime + tamaño + inodo), preservando la garantía multi-instancia actual;
  · cache o proyección del progreso con invalidación segura;
  · single-flight: una sola reconstrucción concurrente por clave;
  · memoria acotada y explícita;
  · paridad contractual verificada antes y después.

DEFERRED
  · proceso shadow separado, con cuota de CPU propia y prioridad baja;
  · materializador incremental por checkpoint;
  · preagregación;
  · consulta SQL especializada por scope.

REJECTED
  · resolver bajando el sample rate  → medido: al 10 % incumplen 7 de 7;
  · añadir más workers               → agrava la contención sobre la misma cuota;
  · ampliar la cola                  → la cola nunca se llenó; no es el límite;
  · relajar el umbral p95            → el umbral es el contrato, no la variable.
```

### Qué haría falta para levantar el bloqueo

El problema ya no es *dónde* se ejecuta el cálculo, sino *cuánta CPU cuesta* en
un contenedor que ya va al 88 % de su cuota. La vía más barata es el frente A:
es la única que, además de abrir espacio para el shadow, arregla un problema que
ya existe hoy en producción sin shadow ninguno.

**Subir la cuota de CPU** de las API se descarta como salida: cambia la
topología productiva y en un host de 2 vCPU con dos instancias no hay margen
real.
