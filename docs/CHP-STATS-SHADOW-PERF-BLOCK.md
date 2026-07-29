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
