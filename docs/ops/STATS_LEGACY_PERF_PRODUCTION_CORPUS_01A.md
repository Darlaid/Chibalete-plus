# Corpus productivo y contrato de aceptación del canary — CHP-STATS-LEGACY-PERF-CORPUS-01A

```
CORPUS:              FROZEN
ACCEPTANCE CONTRACT: VERSIONED 1.0.0
ROOT-ONLY ARTIFACT:  PRODUCTION-CANARY-CORPUS.json
OBSERVABILITY CODE:  LOCAL ON bba2a4e ANCESTRY
PRODUCTION:          UNCHANGED ON 4c407af
FLAGS:               api_1 off · api_2 off
```

Esta unidad **no activa el flag, no construye imagen y no despliega**. Congela
qué se va a medir, contra qué, con cuántas muestras y con qué criterio de
aceptación — antes de que exista la posibilidad de mirar un resultado.

- Rama: `chp/stats-legacy-perf-corpus-01a`, desde `bba2a4e`.
- Contrato de aceptación: `1.0.0`,
  `sha256 = 344117208e63ec4f1a3ba6e105e6dc05c3b234f56d41c3486da009a0b7ef4dae`.
- Descriptor sanitizado: `docs/ops/stats-legacy-perf-corpus.sanitized.json`.
- Esquema: `docs/ops/stats-legacy-perf-corpus.schema.json`.
- Fuente única del contrato: `scripts/perf/productionCanaryCorpus.mjs`.

---

## 1. Por qué el corpus del banco no se reutiliza

El banco de `-01E-R1` corría contra una **copia** del snapshot `ace687e6` dentro
de contenedores efímeros. Sus identificadores eran los de aquella copia, no los
de producción, y su manifiesto vivía en `/root/chp-legacy-perf/env/`, fuera de
todo control de versiones.

Reutilizarlos tendría tres problemas, y ninguno es de estilo:

1. **No describen la producción de hoy.** Entre aquel snapshot y ahora hubo
   reparación de mediadores, saneamiento de `organizationId` y altas. El grupo
   más poblado del banco tenía 90 miembros; el de producción tiene 80.
2. **El criterio era otro.** El banco elegía el grupo por `max(miembros)`. Aquí
   el orden es por lectores con actividad atribuible, con un rango operativo
   declarado de antemano — porque lo que el canary necesita no es el grupo más
   grande, sino uno donde el índice tenga efecto observable a coste acotado.
3. **No eran reproducibles.** Se generaban con un script `.py` root-only. Este
   corpus se regenera con `scripts/perf/buildProductionCanaryCorpus.mjs`, que
   está versionado y produce el mismo fichero byte a byte.

Lo que sí se conserva del banco, íntegro y sin reinterpretar, es el **contrato**:
las clases de ruta, los gates, la normalización y la evidencia algorítmica.

---

## 2. Contrato histórico recuperado

Recuperado de `docs/ADR-CHP-STATS-LEGACY-PERF-01A.md`,
`docs/CHP-STATS-LEGACY-PERF-01E-R1-GATES.md`, `scripts/perf/http-equivalence.mjs`
y la evidencia archivada de `-01E-R1` en el VPS.

| ID | clase histórica | endpoint | usa context | gate original |
|----|-----------------|----------|-------------|---------------|
| R1 | `UNCHANGED_NO_CONTEXT` | `GET /api/metrics/schools` | no | estructural |
| R2 | `SCHOOL_AGGREGATION_MEMOIZED` | `GET /api/metrics/school/:schoolId` | sí | p50 ≤ ×0,50 · p95 ≤ ×0,50 |
| R3 | `SCHOOL_AGGREGATION_MEMOIZED` | `GET /api/metrics/school/:schoolId` | sí | p50 ≤ ×0,50 · p95 ≤ ×0,50 |
| R4 | `SCHOOL_AGGREGATION_MEMOIZED` | `GET /api/metrics/school/:schoolId` | sí | p50 ≤ ×0,50 · p95 ≤ ×0,50 |
| R5 | `UNCHANGED_NO_CONTEXT` | `GET /api/metrics/school/:schoolId` → 404 | no | estructural |
| R6 | `UNCHANGED_NO_CONTEXT` | `GET /api/metrics/student/:userId` | no | estructural |
| R7 | `COURSE_AGGREGATION_INDEXED` | `GET /api/metrics/course/:courseId` | sí | p50 ≤ ×0,65 · p95 ≤ ×0,60 |

Las clases **no se dedujeron**: las fijaron los contadores del servidor. R1 se
clasificó mal al principio —deriva de `groups` y nunca calcula métricas por
alumno— y lo corrigió la telemetría, no una suposición.

Tres contratos distintos, que esta unidad mantiene separados:

- **A. Contrato algorítmico del banco aislado** — 252 muestras por ruta y brazo,
  topologías individual y dual, concurrencias 1 y 4. Ya ejecutado. No se repite.
- **B. Contrato del canary productivo** — lo que sigue en §7 y §8.
- **C. Controles estructurales** — contadores de ciclo de vida y exactitud
  contractual, que aplican a las tres clases.

---

## 3. Instituciones

Las cuatro instituciones registradas en `schools_db.json` siguen siendo cuatro y
todas se verificaron: identidad válida, grupos, membresías, cobertura en el
padrón canónico, ruta resoluble y respuesta estable.

| alias | institución | idHash8 | slug | direccionable | grupos | miembros en padrón | lectores activos | estado |
|-------|-------------|---------|------|---------------|--------|--------------------|------------------|--------|
| `ORG_A` | Villas de Aranjuez | `2622acf7` | `villas-de-aranjuez` | sí | 1 | 80 | 36 | `ACTIVE` |
| `ORG_B` | Nuevo Bosque | `f1dd1828` | `nuevo-bosque` | sí | 1 | 80 | **0** | `NO_ACTIVITY` |
| `ORG_C` | Chibalete Club FilBo 2026 | `8cbb4a2b` | `chibalete-club-filbo-2026` | sí | 2 | 45 | 9 | `ACTIVE` |
| `ORG_D` | Externado | `91457406` | `externado` | **no** | 0 | 0 | 0 | `NOT_ADDRESSABLE` |

El nombre institucional aparece porque ya es público dentro del producto y sin él
el documento no se puede leer. El identificador interno **no** aparece: no aporta
nada al lector y amplía superficie. Ante la duda, alias y hash.

Cada alias cumple un papel del contrato histórico, y por eso se asigna por papel
y no por posición en el fichero:

- `ORG_A` alto volumen → **R2**, la ruta donde la memoización tiene más margen.
- `ORG_B` sin actividad → **R3**. Cero lectores activos y aun así ~817 ms por
  petición: recorre los 80 alumnos igual. Es el control que separa «no hay
  actividad» de «no hay datos», y `NO_ACTIVITY` **no** se colapsa a `0`.
- `ORG_C` FilBo → **R4**, población menor y estructura distinta (2 grupos).
- `ORG_D` registrada sin grupos → **R5**. `resolveSchoolRecord` no la resuelve,
  así que el 404 sale **antes** de cualquier cálculo. Es un control de camino
  corto, no un error.

---

## 4. Grupo `GROUP_R7`

`idHash8 = 3328c000` · organización `ORG_A` · tipo `course` · 80 miembros en el
padrón · 36 lectores con actividad atribuible.

**El rango operativo se declaró antes de mirar la distribución**, y está en el
código (`GROUP_SELECTION_CRITERIA`), no solo en esta prosa:

- **mínimo 20 miembros en el padrón.** Con ~8 ms de recomputación por alumno
  (`-01A`: 4,2–9,3 ms de escaneo de progreso + 1,9–2,2 ms de `parseSessions`)
  más los ~100 ms fijos de `loadAndInitMetrics`, veinte alumnos sitúan `p95_off`
  por encima de los **250 ms** que exige el criterio absoluto de la clase B. Por
  debajo de ese censo el gate histórico no es ejercitable y el canary no probaría
  nada.
- **máximo 120.** `p50_off` histórico con 90 alumnos fue 696–1444 ms. A 120 la
  petición se mantiene por debajo de ~2 s, de modo que con concurrencia 1 y ritmo
  de 2500 ms el canary queda por debajo del 100 % de un core.
- **al menos 1 lector con actividad atribuible**, para que el grupo no sea un
  cascarón.

La clave del rango es el **censo**, no los lectores activos, porque
`computeStudentMetrics` escanea el mapa de progreso completo tenga o no el alumno
actividad: el coste lo fija cuánta gente hay, no cuánta leyó. Los lectores
activos **ordenan**; el censo **acota**.

Orden: `activeReaders DESC`, empates por `id ASC`. Nunca por preferencia humana.

Exclusiones aplicadas sobre los 20 grupos productivos: `SCHOOL_NOT_REGISTERED`
(que descarta por construcción los grupos sintéticos y de prueba, incluidos los
once `Chibalete Club Filbo 20XX` de texto libre y un grupo de 400 miembros sin
campo `school`), `ARCHIVED`, `EMPTY`, `NO_ORO_COVERAGE`, `OUT_OF_RANGE`,
`NO_ATTRIBUTABLE_ACTIVITY`.

Quedaron **2 elegibles**. El ganador tiene 36 lectores activos frente a 6 del
segundo: no hay empate que resolver y la selección no es marginal.

---

## 5. Usuario `USER_R6`

`idHash8 = 04280644`. Es necesario porque R6 direcciona un alumno concreto.

Criterio: pertenece al padrón canónico, tiene rol `lector`, es miembro de
`GROUP_R7`, y se toma **el primero por hash sha-256 ascendente de su
identificador** dentro de un pool de 80. El orden por hash evita que la elección
dependa del orden del padrón, de la antigüedad o de una preferencia.

No requiere login, no pasa por ninguna ruta de autenticación y **no modifica
`lastLoginAt`** — verificado por huella byte a byte del padrón antes y después
de dos rondas de sondas. Su respuesta se comprobó dos veces, con status y
esquema idénticos.

No existe ninguna tabla reversible alias ↔ identidad fuera del VPS.

---

## 6. Rutas negativas y controles

| id | descripción | credencial | status |
|----|-------------|-----------|--------|
| `NEG_401` | sin identidad | ninguna | 401 |
| `NEG_403` | principal sintético fuera de scope | `x-user-id` sintético | 403 |
| `NEG_404` | scope inexistente | admin secret | 404 |
| `ROUTE_5` | institución registrada sin grupos | admin secret | 404 |

El 403 se produce con un principal **sintético**, no con un lector real de otra
institución. `resolveRequester` devuelve `null` ante un `x-user-id` desconocido y
el handler de alumno responde 403 en cuanto `selfAccess` es falso: el status es
el mismo y no se expone ningún cruce entre poblaciones.

Los identificadores sintéticos son estables, cumplen el formato de la ruta y se
verifica en cada validación que **no colisionan** con producción; si alguno
existiera de verdad, el veredicto es `UNSAFE`.

---

## 7. Periodos

**Las cuatro rutas legacy no admiten un solo parámetro de query**: los cuatro
handlers leen exclusivamente `req.params`. No existe, por tanto, un periodo que
el corpus pueda fijar como parámetro de petición, y afirmar lo contrario sería
inventar una superficie que el código no tiene.

Lo que sí se congela son las tres ventanas que gobiernan de verdad la
comparación:

| ventana | papel | valor |
|---------|-------|-------|
| cobertura de datos | **principal** | progreso `2026-03-16T21:51:07.928Z` → `2026-07-25T23:17:51.927Z`; eventos `2026-05-08T01:24:12Z` → `2026-07-25T23:17:59Z` |
| ventana rodante del backbone | control secundario | `windowDays: 30`, **fijada en código**, relativa al instante de la petición |
| ventana de ejecución del canary | declarada por corrida | absoluta, anterior a la expiración del corpus |

Zona horaria: UTC. Prohibidos `now`, «últimos 30 días» recalculados por petición
y cualquier timestamp móvil como parámetro.

La ventana rodante no es configurable, así que no se fija: se **normaliza**. Sus
campos `windowFrom`, `windowTo` y `generatedAt` ya estaban en la whitelist de
sellos técnicos derivada de la evidencia, de modo que su deriva queda
neutralizada, no ignorada. Ambos brazos de un mismo bloque comparten la ventana
de reloj, que es lo que la hace comparable.

Cobertura en la ventana rodante a fecha de congelación: **6132 eventos**,
suficiente para las rutas A y B.

---

## 8. Matriz R1–R7

Ninguna ruta admite «seleccionar en ejecución». Todas son `GET`, todas devuelven
`application/json; charset=utf-8`, y todas declaran su status y su conjunto de
claves de primer nivel.

| id | endpoint | alias | periodo | auth | clase | crea contexto |
|----|----------|-------|---------|------|-------|---------------|
| `ROUTE_1` | `/api/metrics/schools` | — | ventana rodante | admin secret | C | no |
| `ROUTE_2` | `/api/metrics/school/{slug}` | `ORG_A` | ventana rodante | admin secret | A | **sí** |
| `ROUTE_3` | `/api/metrics/school/{slug}` | `ORG_B` | ventana rodante | admin secret | A | **sí** |
| `ROUTE_4` | `/api/metrics/school/{slug}` | `ORG_C` | ventana rodante | admin secret | A | **sí** |
| `ROUTE_5` | `/api/metrics/school/{slug}` | `ORG_D` | — (404 previo) | admin secret | C | no |
| `ROUTE_6` | `/api/metrics/student/{id}` | `USER_R6` | ventana rodante | admin secret | C | no |
| `ROUTE_7` | `/api/metrics/course/{id}` | `GROUP_R7` | ventana rodante | admin secret | B | **sí** |
| `NEG_401` | `/api/metrics/schools` | — | — | ninguna | C | no |
| `NEG_403` | `/api/metrics/student/{id}` | `USER_R6` | — | sintética | C | no |
| `NEG_404` | `/api/metrics/school/{sintético}` | — | — | admin secret | C | no |

Clases: **A** `SCHOOL_AGGREGATION_MEMOIZED` · **B** `COURSE_AGGREGATION_INDEXED`
· **C** `UNCHANGED_NO_CONTEXT`.

Contadores que **deben** moverse en A y B: `createdTotal`, `disposedTotal`,
`memoMissesTotal`, `progressUsersIndexedTotal`, `eventUsersIndexedTotal`; en A
además `memoHitsTotal`. Contadores que **no deben** moverse en C: todos ellos.

Las cabeceras se declaran por nombre. **Ningún valor de credencial aparece aquí
ni en el corpus root-only**: el admin secret se lee del fichero canónico
`0400 root:root` en el momento de la sonda.

---

## 9. Exactitud y normalización

Se congela la normalización derivada en `-01E`, y **solo** esa. Los diez nombres
admisibles como sello técnico son:

```
computedAt  generatedAt  createdAt  timestamp  windowFrom
windowTo    from         to         fromTs     toTs
```

`lastActivityAt` y `lastLoginAt` **no están**, aunque el enunciado los mencionaba
como candidatos: la evidencia histórica no los excluyó, y añadirlos por intuición
sería ampliar la whitelist para tapar una diferencia real.

Un campo solo se excluye si además **varía dentro del propio brazo**. La lista
acota, no autoriza por sí sola. Reproduciendo la derivación sobre las capturas
archivadas de `-01E` salen exactamente **nueve** rutas volátiles, y **cero**
campos no técnicos variando:

```
backboneMetrics.funnels.generatedAt        backboneMetrics.insights.generatedAt
backboneMetrics.funnels.windowFrom         backboneMetrics.insights.insights[].createdAt
backboneMetrics.funnels.windowTo           backboneMetrics.windowFrom
backboneMetrics.generatedAt                backboneMetrics.windowTo
computedAt
```

Reglas de comparación: **no** se ordenan claves (el orden es contractual), **no**
se ordenan arrays, y se comparan valores, denominadores, estados de datos,
`null`, cobertura, status y content-type. `0`, `NO_ACTIVITY`, `NO_DATA` y
`DATA_INCOMPLETE` siguen siendo cuatro cosas distintas.

---

## 10. Diseño muestral

### Nivel 1 — evidencia algorítmica previa, no se repite

`-01E-R1`: 252 muestras por ruta y brazo, topologías individual y dual,
concurrencias 1 y 4, diseño ABBA. Ya ejecutada en banco aislado. **No se
reproduce en producción.**

### Nivel 2 — canary productivo de las rutas con efecto grande

Aplica a `SCHOOL_AGGREGATION_MEMOIZED` y `COURSE_AGGREGATION_INDEXED`.

| parámetro | valor |
|-----------|-------|
| bloques por brazo | 4 (8 en total) |
| patrón | `off on on off off on on off` (ABBA + BAAB) |
| observaciones por bloque y brazo | 16 |
| **total por brazo y ruta** | **64** |
| concurrencia | 1 |
| bucle | abierto, ritmo de llegada igualado |
| ritmo agregaciones | 2500 ms |
| ritmo rutas sin contexto | 1000 ms |
| warm-up por bloque | 4 olas, descartadas |
| pausa entre bloques | 30 s |
| reglas de descarte | error de transporte o timeout · contador contaminado al inicio · menos de 16 observaciones válidas |
| reintentos | 1 por bloque, 2 por corrida, máximo 1 bloque descartado por brazo |
| aborto | `load1 > 3,0` · CPU de la API > 1,2 cores · cualquier reinicio |

**Por qué 64 y no el mínimo de 40.** Con 10 observaciones por bloque el
estimador de p95 *es* el máximo del bloque (`ceil(0,95·10)−1 = 9`, el último de
diez) — justamente el estadístico inestable que produjo el falso negativo de
`-01E`. Con 64 agregadas el p95 cae en el 61.º estadístico de orden de 64, una
cuantila de cola de verdad, y los 16 por bloque bastan para que el p50 por bloque
(8.º–9.º de 16) sea estable en el control de consistencia por bloques.

**Por qué no 250.** En banco aislado saturar no costaba nada. En producción cada
petición de agregación cuesta ~0,7–1,1 s de CPU sobre 2 vCPU compartidos con
tráfico real. 252 por brazo y ruta multiplicarían por ~4 la duración y la carga
sin mover el veredicto: el efecto medido (62–88 % de reducción) está muy por
encima de los gates (40–50 %). Elevarlo exigiría autorización nueva.

Ninguno de estos parámetros puede modificarse tras ver resultados. El validador
compara el diseño muestral incrustado en el corpus contra el del código y emite
`DRIFTED` si difieren.

### Nivel 3 — rutas sin contexto

Exactitud contractual, `created delta = 0`, `active delta = 0`, `memo delta = 0`,
fallback conforme a semántica y latencia **solo descriptiva**.

**El gate del ±5 % sobre p95 no se usa como criterio productivo bloqueante.**
`-01E-R1` lo demostró con un control nulo: comparando el brazo `off` **consigo
mismo** (mitades de sus propios bloques, mismo código y misma configuración),
ROUTE_5 y ROUTE_6 lo incumplen —268,91 vs 354,83 ms, un +32 % dentro de un mismo
brazo—. Un umbral que la condición de control no supera no puede discriminar
nada. La dispersión intra-brazo entre bloques es del 35 % al 108 %, mientras que
las diferencias entre brazos son ≤20 % y cambian de signo según la topología.
Eso es ruido, no efecto.

La evidencia robusta de que no hay regresión no es estadística sino estructural:
estas rutas ejecutan **el mismo camino de código** en ambos brazos, y los
contadores lo demuestran.

---

## 11. Gates productivos

### Clase A — `SCHOOL_AGGREGATION_MEMOIZED` · R2, R3, R4

Gates históricos exactos de `-01E-R1`, sin reescribir:

- `p50_on ≤ p50_off × 0,50`
- `p95_on ≤ p95_off × 0,50`
- reducción absoluta de p95 **≥ 100 ms** cuando `p95_off ≥ 200 ms`
- contextos creados = liberados
- **memo hits > 0**
- un solo escaneo de progreso y un solo procesamiento de eventos por petición
- **≥ 3 de 4 bloques** y también el agregado

### Clase B — `COURSE_AGGREGATION_INDEXED` · R7

- `p50_on ≤ p50_off × 0,65`
- `p95_on ≤ p95_off × 0,60`
- reducción absoluta de p95 **≥ 100 ms** cuando `p95_off ≥ 250 ms`
- **cero memo hits es el resultado esperado, no un fallo**
- un solo escaneo de progreso, un solo procesamiento de eventos
- cero regresión contractual
- **≥ 3 de 4 bloques** y también el agregado

> **Carve-out declarado, no silenciado.** `-01E-R1` exigía cumplir en topología
> individual **y** dual. El canary productivo es de **una sola API** por
> construcción: la topología dual solo se reproduciría poniendo el flag en ambas
> instancias, que es exactamente lo que el canary existe para evitar. El
> subcriterio dual se da por satisfecho con la evidencia de nivel 1 (58,1 %,
> 4/4 bloques) y **no se vuelve a medir**.

### Clase C — `UNCHANGED_NO_CONTEXT` · R1, R5, R6, 401, 403, 404

- diferencias contractuales = 0
- diferencias de valor = 0
- `created delta` = 0 · `disposed delta` = 0 · `active final` = 0
- `memo hits delta` = 0 · `memo misses delta` = 0
- latencia informativa, **no bloqueante** salvo regresión extrema

**«Regresión extrema», definida antes del canary:**

- aparece un status de error que no estaba en el brazo `off`; **o**
- cualquier timeout (> 30 s); **o**
- `p95_on > 2 × p95_off` **y** además el aumento absoluto supera **250 ms**.

Las dos condiciones cuantitativas son conjuntas a propósito: una ruta que pase de
20 a 45 ms dobla su p95 sin que eso signifique nada.

### Ciclo de vida — global

- `created delta = disposed delta`
- `active final = 0`
- ningún contexto vivo 60 s después de la última petición
- contadores monotónicos salvo `active`
- el endpoint operacional no modifica contadores

La señal viene de `GET /api/admin/system/metrics/request-context`, la ruta
secret-only introducida en `bba2a4e`. **No existe reset**: los contadores solo
vuelven a cero al reiniciar el proceso, y por eso todo se evalúa por **delta**
entre dos lecturas, nunca por valor absoluto.

---

## 12. Relación con el corpus root-only

| | root-only (VPS) | versionado (repo) |
|---|---|---|
| ruta | `/root/stats-legacy-perf-corpus-01a/PRODUCTION-CANARY-CORPUS.json` | `docs/ops/stats-legacy-perf-corpus.sanitized.json` |
| modo | `0600 root:root` | `0644` |
| identificadores exactos | **sí** | **no** |
| rutas resueltas (`path`) | sí | no |
| hashes de fichero de población | sí | no |
| `production.imageId` | sí | no |
| alias, gates, muestra, normalización, periodos | sí | sí |

El artefacto root-only es el único lugar donde existe la relación alias ↔
identidad. `sha256 = e4f792e98dceded395049ff38bb7287f9620cc788ef6001c2119591f19a90049`.

Ninguno de los dos contiene nombres de personas, correos, respuestas completas,
secretos ni cabeceras administrativas.

---

## 13. Reproducción

```bash
# 1. Regenerar el corpus (dentro del contenedor de la API: necesita better-sqlite3).
#    El script debe residir bajo /app para resolver node_modules.
docker run --rm --network none \
  -v /root/stats-legacy-perf-corpus-01a/code:/app/corpus-code:ro \
  -v /var/www/chibalete/data:/app/data:ro \
  -v /var/www/chibalete/data-critical:/app/data-critical:ro \
  -v /root/stats-legacy-perf-corpus-01a:/out:rw \
  --entrypoint node chibalete/api:4c407af \
  /app/corpus-code/buildProductionCanaryCorpus.mjs \
    --data /app/data --dataCritical /app/data-critical \
    --out /out/PRODUCTION-CANARY-CORPUS.json \
    --sanitizedOut /out/stats-legacy-perf-corpus.sanitized.json \
    --generatedAt <iso> --expiresAt <iso> --reviewBy <iso> \
    --commit <sha40> --imageRef <ref> --imageId <sha256:...> \
    --observabilityCommit <sha40>

# 2. Validar el drift, sin ejecutar benchmark.
node scripts/perf/validateProductionCanaryCorpus.mjs \
  --corpus /root/stats-legacy-perf-corpus-01a/PRODUCTION-CANARY-CORPUS.json \
  --sanitized docs/ops/stats-legacy-perf-corpus.sanitized.json \
  --data /var/www/chibalete/data --dataCritical /var/www/chibalete/data-critical \
  --probe --host <ip-api> --port 3000 \
  --secretFile /var/www/chibalete/secrets/admin_secret \
  --allowRemote --iUnderstandThisGeneratesLoad
```

Toda lectura es read-only: los JSON se leen y no se reescriben; SQLite se abre
con `readonly` y `PRAGMA query_only=ON` **respetando el WAL** (nada de
`immutable`, que ignoraría el WAL y devolvería datos obsoletos); `insights.db`
**no se abre** en ningún momento y solo se comprueba que su inodo no cambió.

Sustituir el corpus **no es cherry-picking manual**: se vuelve a ejecutar el
generador, se comparan los hashes de población y se ve exactamente qué criterio
cambió la selección.

---

## 14. Detección de drift

`scripts/perf/validateProductionCanaryCorpus.mjs` verifica, sin ejecutar
benchmark y con **una petición por ruta como mucho**: corpus parseable y en modo
`0600`; versión; commit e `ImageID` esperados; instituciones, grupo y usuario
existentes; membresías por hash; periodos absolutos; rutas respondiendo con
status, content-type y esquema esperados; campos de normalización conocidos;
ausencia de PII y de secretos; flags `off`/`legacy` en ambas API; contenedores
`healthy`; e `insights.db` intacto.

Verdictos y códigos de salida:

| veredicto | código | significado |
|-----------|--------|-------------|
| `VALID` | 0 | el corpus describe la producción actual |
| `DRIFTED` | 10 | cambió población, identidades, rutas o contrato |
| `EXPIRED` | 11 | la ventana de datos que el corpus asume ya no existe |
| `UNSAFE` | 12 | no es seguro medir: flags encendidos, secretos, PII, destino |

Es **fail-closed**: cualquier excepción no prevista imprime `UNSAFE`, y el peor
veredicto gana. **Nunca actualiza el corpus**; ante drift emite las diferencias y
se detiene, porque regenerarlo es una unidad nueva, no un efecto secundario de
validarlo.

El hash almacenado no basta por sí solo —es un campo del propio corpus, y quien
relajara un gate podría dejarlo intacto—, así que el validador compara además el
contrato **incrustado** contra el del código, subárbol a subárbol.

### Expiración

- `expiresAt = 2026-08-24T23:17:59Z` — instante en que la ventana rodante de 30
  días deja de contener la última actividad registrada (`2026-07-25T23:17:59Z`).
  Pasado ese punto, `backboneMetrics` cambia de forma en las rutas A, B y R6, y
  el corpus dejaría de describir lo que mide.
- `reviewBy = 2026-08-15T00:00:00Z` — fuerza revalidación con margen.

---

## 15. Privacidad

- Cero nombres de personas, cero correos, cero respuestas completas, cero
  secretos y cero cabeceras administrativas en material versionado.
- Los identificadores de usuario **no se versionan en ninguna forma completa**.
- Los identificadores de organización y grupo tampoco: la revisión de privacidad
  concluyó que no aportan al lector y sí amplían superficie. Se usan alias y
  hash truncado.
- La sonda no guarda bodies: solo status, content-type, `sha256` del cuerpo,
  tamaño, latencia y una huella de **esquema** (conjunto de rutas de clave, sin
  valores).
- El detector de fugas está en el propio validador y en las pruebas, no en una
  revisión manual.

---

## 16. Verificación read-only

Sonda de bajo volumen, **una sola petición por ruta**, contra producción con el
flag `off`:

| id | status | latencia | tamaño |
|----|--------|----------|--------|
| `ROUTE_1` | 200 | 309 ms | 1,1 KB |
| `ROUTE_2` | 200 | 1142 ms | 16,4 KB |
| `ROUTE_3` | 200 | 817 ms | 12,3 KB |
| `ROUTE_4` | 200 | 450 ms | 13,2 KB |
| `ROUTE_5` | 404 | 98 ms | 52 B |
| `ROUTE_6` | 200 | 121 ms | 13,0 KB |
| `ROUTE_7` | 200 | 669 ms | 72,7 KB |
| `NEG_401` | 401 | 116 ms | 26 B |
| `NEG_403` | 403 | 117 ms | 27 B |
| `NEG_404` | 404 | 103 ms | 74 B |

Diez de diez con el status, el content-type y el esquema esperados. `p95_off` de
R2 y R7 queda por encima de los umbrales que activan el criterio absoluto de sus
clases (200 y 250 ms), así que el gate es ejercitable.

**`UNEXPECTED_PRODUCTION_STORE_DELTA = 0`** en dos rondas independientes,
comparando `sha256`, tamaño y `mtime` de todos los JSON de `data/` y
`data-critical/`, de `progress.db` y `events.db` (con sus `-wal`/`-shm`), y los
metadatos de `insights.db`. Sin cambios en identidad, progreso, eventos, memoria
de Leo ni `lastLoginAt`. El materializador no se ejecutó y `insights.db` no se
consultó.

Control adicional: `GET /api/admin/system/metrics/request-context` responde
**404 en ambas API**, lo que confirma que la observabilidad de `bba2a4e` **no
está desplegada** y que producción sigue intacta en `4c407af`.

---

## 17. Decisiones registradas

1. **El corpus de banco no se reutiliza** — §1.
2. **Los IDs se congelan antes del canary** porque elegirlos durante la medición
   permitiría, aun sin querer, escoger el caso que confirma la hipótesis.
   Congelados, la única variable libre es el flag.
3. **No se usan 250 muestras en producción** — §10: coste real sobre 2 vCPU
   compartidos, sin efecto sobre un veredicto cuyo margen es de 20 puntos.
4. **Las clases A y B mantienen gates de rendimiento** porque ejecutan un camino
   de código distinto en cada brazo: hay un efecto que medir y un umbral que
   puede fallar.
5. **La clase C se verifica estructuralmente** porque ejecuta el mismo camino de
   código en ambos brazos: no existe mecanismo por el que pueda regresar, y el
   umbral porcentual quedó por debajo del ruido con un control nulo.
6. **Los contadores se evalúan por delta** porque no hay reset: son de proceso y
   solo vuelven a cero al reiniciar el contenedor. Un valor absoluto mezclaría el
   tráfico real anterior con el del canary.
7. **El corpus expira** porque la ventana rodante de 30 días se vacía el
   `2026-08-24T23:17:59Z` y cambiaría la forma de la respuesta que el corpus
   describe.
8. **Se reemplaza reejecutando el generador versionado**, no editando a mano
   — §13.

---

## 18. Riesgos residuales

- **La ventana rodante camina.** Si el canary se ejecuta cerca de `expiresAt`,
  `backboneMetrics` tendrá menos datos que en la congelación. El validador lo
  detecta, pero conviene medir bastante antes de la fecha.
- **`ORG_C` tiene 45 miembros en dos grupos**, menos que `ORG_A`. Su `p95_off`
  (~450 ms) supera el umbral de 200 ms de la clase A, así que el criterio
  absoluto sigue siendo ejercitable, pero con menos margen que R2.
- **El subcriterio de topología dual de la clase B no se remide** — §11.
- **`engines/metricsEngine.ts` conserva el mismo patrón cuadrático** y sigue sin
  tocar. Fuera del alcance de esta rama.
- **Un grupo productivo de 400 miembros sin campo `school`** queda excluido del
  corpus por no pertenecer a institución registrada. No es direccionable por
  ninguna ruta institucional, así que no afecta al canary, pero es una anomalía
  de datos que merece su propia unidad.

---

## 19. Qué sigue

| unidad | alcance |
|--------|---------|
| `CHP-STATS-LEGACY-PERF-OBS-01B` | imagen inmutable, canary aislado y despliegue de la observabilidad |
| `CHP-STATS-LEGACY-PERF-01H-R2` | canary productivo medible de una sola API |
| `CHP-STATS-LEGACY-PERF-01I` | rollout completo y cierre |

Antes de cualquiera de ellas: `validateProductionCanaryCorpus.mjs` debe devolver
`VALID`.
