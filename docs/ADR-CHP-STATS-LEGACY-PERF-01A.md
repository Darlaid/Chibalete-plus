# ADR CHP-STATS-LEGACY-PERF-01A — Coste de las rutas legacy de métricas

**Estado:** decidido, **no implementado**. Rama `chp/stats-legacy-perf`, creada
desde `5475f26` (rama desplegable), **no** desde `chp/stats-shadow-perf`.
Producción intacta en `5703ebb` con `METRICS_ENGINE=legacy`.

```
DECISION: REUSO POR PETICIÓN (índices + memoización)
REJECTED: caché read-through entre peticiones del padrón canónico
```

## La hipótesis de partida era falsa

Esta unidad se abrió para diseñar una **caché read-through del padrón y del
progreso**, sobre la premisa de que el coste dominante era reparsear los 333 KB
del padrón (que está deliberadamente sin cachear) y releer los 2,9 MB de
progreso en cada petición.

La medición la refuta. Sobre el snapshot `ace687e6` (647 usuarios, 20 grupos,
7215 registros de progreso, 1854 eventos), en el contenedor productivo:

| Componente | Coste p50 | Peso en una petición institucional |
|---|---|---|
| **Recomputación por alumno** | **~1280-1870 ms** | **80-93 %** |
| `getAllProgressAsMap()` (1×) | 89,6 ms | 6 % |
| `analytics_db.json` leer+parsear | 4,4 ms | 0,3 % |
| `users_db.json` leer+parsear | 3,8 ms | 0,25 % |
| **padrón canónico leer+parsear** | **2,9 ms** | **0,2 %** |
| `groups_db.json` leer+parsear | 0,34 ms | 0,02 % |

**Cachear el padrón ahorraría 2,9 ms de una petición de ~1455 ms.** Cachear
*toda* la E/S de ficheros ahorraría el 6,5 %. No es ahí donde está el problema.

## Dónde está realmente el coste

`computeSchoolMetrics` llama a `computeStudentMetrics` **dos veces por alumno**:
una para `allStudents` y otra dentro de `courseBreakdown`. Para una institución
de 90 alumnos son **180 llamadas** por petición.

Y cada una de esas llamadas vuelve a recorrer el mundo entero:

| Dentro de `computeStudentMetrics` (1 alumno) | p50 | Peso |
|---|---|---|
| `Object.values(_progress.progressMap).filter(...)` | 4,2-9,3 ms | **73-90 %** |
| `parseSessions(_events)` — **todos** los eventos | 1,9-2,2 ms | 21-32 % |
| `_events.filter(...)` | 0,1 ms | 1 % |
| `Object.entries(_leoMemory.memoryMap).filter(...)` | 0,04-0,12 ms | <2 % |
| `_leoInteractions.filter(...)` | 0,002 ms | ~0 % |

El peor de todos es el progreso: `Object.values()` materializa un array de 7215
elementos **en cada llamada**, y a continuación se descarta todo menos las
entradas de un usuario. `parseSessions` hace lo mismo con los eventos: reconstruye
las sesiones de *toda* la plataforma para quedarse con las de uno.

El coste es **O(alumnos × (progreso + eventos))**. No es E/S: es recomputación
cuadrática.

## Medición de referencia

Indexar una sola vez por `userId` frente a escanear por alumno, sobre los 647
usuarios del padrón:

```
índice construido una vez :   4,33 ms
escaneo para 647 usuarios : 139,35 ms
factor                    :     32x
```

Proyección para una institución de 90 alumnos (180 llamadas medidas):

| Estrategia | Coste | Ahorro |
|---|---|---|
| Hoy | ~1868 ms | — |
| **A** — memoización por petición (90 distintas) | ~934 ms | **−50 %** |
| **B** — memoización + índices precalculados | ~8 ms + residuo | **hasta −99 %** |

> B es una **cota superior** del ahorro. Los componentes se cronometran por
> separado y su suma supera el total de la llamada, así que el residuo por
> alumno (aritmética de `computeBehavioral`, `computeReadingLevels`,
> `computeICDLI`) queda por debajo del ruido y se acota a 0. El coste real de B
> será mayor que 8 ms; la cifra exacta se medirá en `-01C`, cuando el código
> esté reestructurado.

## Exactitud verificada antes de decidir

Una optimización incorrecta no sirve por rápida que sea. Se comprobaron las dos
precondiciones sobre el snapshot completo:

1. **Determinismo.** 120 usuarios, dos llamadas consecutivas a
   `computeStudentMetrics`: **idénticas** salvo `computedAt`. La memoización por
   petición es exacta por construcción.
2. **Indexación.** Para los **647** usuarios del padrón, agrupar una vez por
   `userId` produce exactamente las mismas rebanadas que el escaneo actual,
   **incluido el orden** de los registros.
3. **Ausencia bien representada.** Los **217** usuarios sin progreso devuelven
   lista vacía por ambos caminos. El índice devuelve `undefined` y se normaliza
   a `[]` — nunca a `0` ni a `null`, que es la confusión que el contrato
   canónico prohíbe.

## Contrato de frescura, y por qué mata la caché del padrón

`writeJSON` escribe a `.tmp` y hace `renameSync` — **atómico**, con cambio de
inodo en cada escritura. Invalida `_jsonCache`, pero **solo en el proceso que
escribe**.

Por eso `USERS_DB` está en `UNCACHED_JSON_FILES`, y el propio código lo explica:
con `api_1` y `api_2` detrás de nginx, cada proceso tiene su caché; un alta que
entra por `api_1` dejaría a `api_2` sirviendo una lista obsoleta. El contrato es
**lectura fresca en cada petición, coherencia read-after-write entre
instancias**.

Una caché entre peticiones del padrón obligaría a:

- un `stat` por petición para el fingerprint (dev+inodo+tamaño+mtime), y
- aceptar la ventana en la que dos instancias divergen.

A cambio de **2,9 ms sobre ~1455 ms**. Es un mal negocio: pone en riesgo una
garantía de identidad que costó unidades enteras establecer, para ganar un 0,2 %.

## Decisión

**Reuso por petición. Cero caché entre peticiones.**

Dos componentes:

### 1. `MetricsRequestContext` — índices construidos una vez por petición

Al inicio del handler, y **solo** para las rutas de métricas:

- `sessionsByUser` — `parseSessions` ejecutado **una vez**, agrupado por usuario;
- `progressByUser` — `progressMap` agrupado **una vez** por `userId`;
- `eventsByUser` — eventos agrupados **una vez** por `userId`;
- `leoByUser` — entradas de memoria e interacciones agrupadas **una vez**.

Ownership: el contexto **vive y muere con la petición**. No hay estado entre
peticiones, así que no hay invalidación, ni fingerprint, ni TTL, ni divergencia
multiinstancia, ni riesgo de servir datos obsoletos. Es la propiedad que hace
esta opción defendible frente a cualquier caché.

### 2. Memoización de `computeStudentMetrics` dentro del contexto

`Map<userId, resultado>` de vida igual a la petición. Elimina la segunda pasada
de `courseBreakdown` (180 → 90 llamadas) sin tocar la semántica.

Memoria: acotada por definición al número de alumnos de la petición y liberada
al terminar. No hay crecimiento entre peticiones.

## Alternativas rechazadas

| Alternativa | Estado | Razón |
|---|---|---|
| Caché read-through del padrón con fingerprint | **REJECTED** | Ahorra 0,2 %. Introduce riesgo de incoherencia entre instancias en la fuente canónica de identidad. |
| Caché read-through del progreso entre peticiones | **DEFERRED** | Ahorraría el ~6 % de `getAllProgressAsMap`. Solo tiene sentido *después* de eliminar la recomputación; hoy quedaría oculta por el 90 %. |
| TTL ciego sobre el padrón | **REJECTED** | Incompatible con el contrato read-after-write declarado en el código. |
| File watcher como único mecanismo | **REJECTED** | Bind mounts de Docker pierden eventos; no se demostró fiable en esta topología. |
| Subir `cpus` de las API | **REJECTED** | Cambia la topología productiva; en 2 vCPU con dos instancias no hay margen. |
| Materializador incremental | **DEFERRED** | Es el destino a medio plazo, y sustituirá al componente 1. No bloquea esta mejora. |

## Riesgos

- Tocar `metricsService.js` toca el cálculo que alimenta Aula Viva. La
  equivalencia debe verificarse alumno a alumno, institución a institución,
  antes de desplegar (`-01D`).
- `computeStudentMetrics` es exportada y la usan otros call sites; el contexto
  debe ser opcional para no romperlos.
- El residuo real de B no está medido end-to-end. Si resultara alto, el ahorro
  sería menor que la cota; seguiría siendo muy superior a cualquier caché de
  ficheros.

## Plan

| Unidad | Alcance |
|---|---|
| `-01B` | `MetricsRequestContext` + memoización, tras flag, sin cambiar contratos. |
| `-01C` | Índices de progreso y sesiones dentro del contexto; medición del residuo real. |
| `-01D` | Equivalencia completa legacy sin contexto vs con contexto. |
| `-01E` | Benchmark HTTP de las siete rutas y aceptación. |
| `-01F` | Imagen inmutable y canary en `legacy`. |
| `-01G` | Despliegue de la optimización legacy. |

Después, y no antes: rebase de `chp/stats-shadow-perf` sobre la mejora
desplegada, corrección del comparador y nuevo benchmark del shadow.

---

## Actualización — `CHP-STATS-LEGACY-PERF-01B` (implementación local)

```
NO CROSS-REQUEST CACHE
REQUEST-SCOPED COMPUTATION CONTEXT

IMPLEMENTED_LOCALLY
UNIT_EQUIVALENCE_GREEN
SERVICE_BENCHMARK_GREEN
FULL_SNAPSHOT_EQUIVALENCE_PENDING
HTTP_ACCEPTANCE_PENDING
NOT_DEPLOYABLE
```

### Qué se implementó

`server/metricsService.js`, tras flag y **apagado por defecto**:

- **`createMetricsRequestContext()`** — índices construidos una vez por cálculo
  de nivel superior: `progressByUser`, `eventsByUser`, `sessionsByUser`. Se
  indexa **solo donde está el coste**; la memoria de Leo (0,04-0,12 ms) y las
  interacciones (0,002 ms) se dejan intactas: indexarlas no compensaría el
  riesgo semántico de tocar el prefijo `userId__`.
- **`parseSessions` se ejecuta una sola vez**, y es la función de siempre. Como
  agrupa por usuario antes de procesar, cada usuario se reconstruye de forma
  independiente: indexar su salida es idéntico a filtrarla. **No hay un segundo
  algoritmo de sesiones.**
- **Memoización** `Map<userId, resultado>` con vida de contexto.
- `computeStudentMetrics(userId, options)`, `computeCourseMetrics(courseId,
  options)`, `computeSchoolMetrics(schoolId, options)` — el parámetro es
  **opcional**: sin él, el camino es exactamente el de antes.

### Clave de memoización

`userId`, y la razón por la que basta: esta función **no admite periodo,
filtros ni opciones**. Su único parámetro funcional es el usuario; el resto de
sus entradas es el estado de módulo que fija `init()`.

De eso se ocupa **`generation`**: `init()` incrementa un contador y el contexto
guarda el valor con el que se construyó. Un contexto usado después de otro
`init()` **lanza** en vez de devolver cifras de datos que ya no son los
vigentes. Por eso `userId` es una clave completa *dentro* de un contexto, y no
lo sería fuera de él.

### Lifecycle

Una instancia por cálculo de nivel superior, pasada **explícitamente** (sin
`AsyncLocalStorage`). Quien la crea la libera; si viene del caller, el caller
decide. `dispose()` vacía los índices y la memo, y un contexto liberado ya no se
puede usar. Cero estado entre peticiones: sin invalidación, sin TTL, sin
fingerprint, sin divergencia entre instancias.

### La ruta de un solo alumno NO crea contexto

Medido: para un único alumno, construir los índices cuesta **+47 %**
(4,06 → 5,98 ms). Indexar todo el progreso y todos los eventos para ahorrar un
solo cálculo es coste puro. El contexto lo crean **solo** las agregaciones de
varios alumnos, que es donde estaba el problema.

### Resultado del microbenchmark de servicio

Diseño intercalado OFF/ON/ON/OFF sobre copia del snapshot, en el contenedor
productivo:

| Objetivo | off p50 | on p50 | mejora | off p95 | on p95 |
|---|---|---|---|---|---|
| `ANCHOR_1` institución alta | 736,1 ms | **9,0 ms** | **−98,8 %** | 2080,3 ms | **14,3 ms** |
| `ANCHOR_2` sin actividad | 641,6 ms | **8,1 ms** | **−98,7 %** | 1476,9 ms | 16,8 ms |
| `ANCHOR_3` institución | 356,1 ms | **8,4 ms** | **−97,6 %** | 447,1 ms | 12,8 ms |
| `GROUP_1` grupo | 369,2 ms | **8,3 ms** | **−97,8 %** | 447,5 ms | 14,2 ms |
| `USER_1` alumno | 4,0 ms | 4,9 ms | — | 6,8 ms | 5,7 ms |

`USER_1` ejecuta **el mismo código** en ambos brazos (no se crea contexto), así
que su diferencia es ruido de medición sobre una operación de 4 ms, no una
regresión.

Trabajo repetido eliminado en `ANCHOR_1`: **180 llamadas → 90 cálculos reales +
90 aciertos de memo**. Escaneo completo de progreso por petición: **1**. De
eventos: **1**.

### Exactitud

40 aserciones en `server/__test__/metricsRequestContext.test.js`, comparación
byte a byte salvo `computedAt`: alumno con y sin progreso, con y sin eventos,
duplicados, eventos huérfanos, sesión incompleta, tipo de evento desconocido,
usuario fuera del padrón, usuario inexistente, grupo sin actividad, institución
sin grupos (mismo error), 50 contextos concurrentes.

En el microbenchmark, las cinco dianas dan **idéntico** con flag on y off.

### Observabilidad

Contadores agregados en `metricsContextCounters`: creados, liberados, registros
indexados, hits, misses, llamadas legacy y duración de construcción. **Cero
identificadores**, cero claves de memo, cero PII — verificado por test.

### Rollback

`LEGACY_METRICS_REQUEST_CONTEXT` ausente o `off` devuelve el comportamiento
anterior sin desplegar nada. Un valor no reconocido es error explícito, no un
default silencioso.

### Pendiente

- Equivalencia sobre los **647** usuarios del snapshot completo (`-01D`).
- Benchmark HTTP de aceptación de las siete rutas (`-01E`).
- El gemelo TypeScript `engines/metricsEngine.ts` tiene el **mismo patrón
  cuadrático** y no se ha tocado: queda fuera del alcance de esta rama.

---

## Alcance de lo medido

Las cifras salen de la capa de servicio (`metricsService`, `progressService`)
sobre una **copia** del snapshot `ace687e6`, en el contenedor
`chibalete/api:5703ebb` con los límites productivos. **No** son medidas HTTP de
extremo a extremo: eso es trabajo de `-01E`. El snapshot original se verificó
byte a byte antes y después.
