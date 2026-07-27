# Contrato canónico de métricas

**Unidades:** CHP-METRICS-CONTRACT-01A + **01B** · **Contrato v2, D1–D10
`HUMAN_APPROVED`** · **Estado:** `APPROVED CONTRACT — READY FOR API INTEGRATION`

Este documento define qué significa cada número visible de Chibalete+ y cómo se
calcula. El motor de referencia (`engines/metrics/`) lo implementa en puro,
read-only, y sirve de verdad de contraste: **no sustituye todavía a ninguna API**.

---

## 1. Fuentes

| Fuente | Papel | Autoridad |
|---|---|---|
| `data-critical/events.db` | actividad | **canónica** |
| `data/analytics_db.json` | sink legacy (1.854 registros, 39 usuarios) | solo comparación histórica |
| `data-critical/insights.db` | proyección reconstruible (22 tablas, 0 filas) | **nunca** autoridad |
| `data/schools_db.json` + `organizationId` | institución | **canónica** |

---

## 2. El hallazgo que gobierna el contrato: `elapsed_ms` no es aditivo

Todos los productores lo calculan igual — `Date.now() - sessionStartTs`
(`useBackboneReadingSession`, `useA11yAnalytics`, `useLuAnalytics`,
`analyticsSeam`): es **acumulado desde el inicio de la sesión**, no la duración
del evento.

Verificación empírica sobre 349 sesiones productivas:

| Comprobación | Resultado |
|---|---|
| Monótono no decreciente dentro de la sesión | 349/349 por extremos; **1 violación en 2.659 pares** |
| El rango de `elapsed_ms` coincide con la ventana temporal | 216/349 (62 %) |
| **La suma supera el doble de la ventana real** | **290/349 (83 %)** |
| Factor de inflación de la suma | mediana **3,67×**, p90 **17,8×**, máx **815×** |

> **Prohibido sumar `elapsed_ms`.** La lectura válida es el valor del evento de
> cierre, o el máximo por sesión. `engines/metrics/eventContract.mjs` lo impone.

---

## 3. `session_id` tampoco es una sesión

De 11.190 `session_id` distintos, **10.669 (95 %) tienen duración cero**: varios
emisores generan un id por evento (`immersive.chunk_audio_reuse`: 2.235 eventos /
2.235 "sesiones"). Solo 264 agrupaciones tienen inicio **y** cierre explícitos;
493 quedan sin cierre y 248 sin inicio.

---

## 4. Estrategias de sesión medidas

| Estrategia | Sesiones | Duración p50 | Duración p99 | Problema |
|---|---:|---:|---:|---|
| S1 · límites explícitos | 264 | 35 s | 1,8 h | 32 % de sesiones nunca cierran; máx 50 h |
| S2 · por `session_id` | 11.190 | **0 s** | 4,7 min | 95 % con duración 0: no son sesiones |
| **S3 · ventana de inactividad** | 5 min: 222 · **15 min: 172** · 30 min: 156 | 96 s / 218 s / 312 s | 82 min / 119 min / 119 min | requiere elegir umbral |

Sensibilidad sobre Villas de Aranjuez: 5 min → 128 sesiones / 25,2 h · 15 min →
99 / 22,8 h · 30 min → 92 / 20,6 h. La curva se aplana tras 15 min.

**Propuesta:** principal `INACTIVITY_WINDOW` con idle de **15 min**; fallback
`EXPLICIT_BOUNDARIES` cuando existan ambos extremos. `HUMAN_APPROVAL_REQUIRED`.

---

## 5. Definiciones aprobadas

| # | Métrica | Definición | Exclusiones | Sin cobertura |
|---|---|---|---|---|
| A | `registeredUsers` | pertenecen a la organización por `organizationId` declarado **o** por pertenencia a uno de sus grupos. **No depende de eventos.** | sintéticos | `NO_DATA` si 0 |
| B | `registeredReaders` | los anteriores con rol `lector` — conteo real, no se asume | — | — |
| C | `eligibleReaders` | `registeredReaders` en ≥1 grupo `ACTIVE_REAL` de la misma organización | — | denominador de cobertura |
| D1 | `usersWithActivity` | `registeredUsers` con ≥1 evento atribuible **no sistémico** | históricos, sintéticos, no atribuibles | `NO_ACTIVITY` |
| D2 | `activeReaders` | `eligibleReaders` con ≥1 evento `READING_ACTIVITY` | telemetría y sistema | `NO_ACTIVITY` |
| E | `entries` | inicio de una sesión reconstruida | — | `NO_ACTIVITY` |
| F | `sessions` | ventana de inactividad 15 min; `session_end` cierra antes; un evento de sistema no abre sesión | — | `NO_ACTIVITY` |
| G | `platformTimeMs` | Σ `min(última − primera actividad atribuible, 4 h)`; **nunca** Σ `elapsed_ms` | — | `NO_ACTIVITY` |
| H | `readingTimeMs` | **`NOT_DEFINED`** — exige separar lectura efectiva de pestaña abierta | — | `NOT_DEFINED` |
| I | `contentsOpened` | `contentId` distinto en un modo de lectura | modo `lu` | `NO_ACTIVITY` |
| J | Libro consultado | = I mientras `contentId` no distinga libro de fragmento | — | `NOT_DEFINED` si se exige "libro" |
| K | Progreso | `progress_fraction` del último evento de progreso | — | `NO_DATA` |
| L | Actividad institucional | agregación por `organizationId` **registrado** | históricos, sintéticos | ver estados |
| M | `coverage` | `activeReaders / eligibleReaders`, con numerador y denominador explícitos | — | `null` si denominador 0 |

**`usersWithActivity` ≠ `activeReaders`** (D4). Estar presente no es leer: en
Villas son **37 frente a 21**. Publicar una sola cifra inflaría la lectura un 76 %.

**«Registrados» nunca significa «miembros de grupos».** Esa confusión hacía
desaparecer 2 lectores en FilBo y los 2 usuarios de Externado.

---

## 6. Estados de medición

```
{ value, measured, coverage, status, reason, period }
```

| Estado | Significado | `value` |
|---|---|---|
| `MEASURED` | hay datos y el valor es real | número |
| `NO_ACTIVITY` | población conocida, actividad medida = 0 | **0** (cero legítimo) |
| `NO_DATA` | no hay población ni medición posible | `null` |
| `NOT_MATERIALIZED` | depende de `insights.db`, aún vacía | `null` |
| `UNATTRIBUTED` | hay actividad, no atribuible a este scope | `null` |
| `NOT_DEFINED` | contrato no aprobado | `null` |
| `ERROR` | fallo real | `null` |

`metric()` impone la regla por construcción: fuera de `MEASURED`/`NO_ACTIVITY`,
`value` es `null`. **Un error jamás se convierte en 0.**

---

## 7. Poblaciones institucionales — cinco listas, no una

1. registradas · 2. con grupos `ACTIVE_REAL` · 3. con lectores · 4. con lectores
con eventos · 5. con actividad en el periodo (depende del periodo).

Foto actual: **3 registradas · 3 con grupos activos · 3 con lectores · 2 con
lectores con eventos**. Tras el manifiesto: **4 registradas**, Externado sin
grupo → `NO_DATA`, no 0.

---

## 8. Eventos no atribuibles — se conservan, nunca se reparten

| Bucket | Eventos | Usuarios |
|---|---:|---:|
| `UNATTRIBUTED_GROUP` | 2.565 | 1 |
| `UNATTRIBUTED_IDENTITY` | 188 | 2 |
| `UNKNOWN_EVENT_TYPE` | 5 | 4 |
| `HISTORICAL_SCOPE` | 0 | 0 |
| `SYNTHETIC_SCOPE` | 0 | 0 |

19.465 totales · **16.712 atribuibles (85,9 %)**. Los 2.565 son de **un único
usuario sin institución**: el segundo mayor productor de actividad del sistema.

---

## 9. Shadow institucional — contrato v2, vista post-manifiesto, idle 15 min

Todo el histórico:

| Organización | Registrados | Lectores | Elegibles | Sin grupo | Con actividad | **Lectores activos** | Cobertura | Sesiones | Tiempo | Estado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Villas de Aranjuez | 90 | 80 | 80 | 0 | 37 | **21** | 26 % | 227 | 16,4 h | `MEASURED` |
| Nuevo Bosque | 90 | 80 | 80 | 0 | 0 | **0** | 0 % | 0 | 0 h | `NO_ACTIVITY` |
| FilBo 2026 | **46** | 46 | 44 | **2** | 5 | **5** | 11 % | 27 | 0,9 h | `MEASURED` |
| Externado | **2** | 0 | 0 | 0 | 0 | — | — | — | — | `NO_DATA` |

Últimos 30 días (D7, periodo por defecto): Villas cae a 13 lectores activos y
FilBo pasa a `NO_ACTIVITY` — toda su actividad es anterior al periodo.

**Comparación de las tres lecturas para Villas de Aranjuez:**

| | Registrados | Activos | Sesiones | Tiempo |
|---|---:|---:|---:|---:|
| Sink legacy (`analytics_db.json`, lo que se muestra hoy) | 80 | 24 | 2 | — |
| Motor v1 | 90 | 37 | 99 | 22,8 h |
| **Motor v2 (aprobado)** | **90** | **21** *(lectores)* / 37 *(actividad)* | **227** | **16,4 h** |

v2 baja los lectores activos (exige `READING_ACTIVITY`, no telemetría), sube las
sesiones (`session_end` corta antes del idle) y baja el tiempo (ventana de
actividad en vez del acumulado, y sin cierres huérfanos inflando).

No se presenta tiempo de lectura: permanece `NOT_DEFINED`.

---

## 10. Contrato de endpoints (diseño, sin conectar)

```
GET /api/metrics/organizations                  → lista + poblaciones (5 listas)
GET /api/metrics/organization/:organizationId   → métricas de la organización
GET /api/metrics/group/:groupId                 → métricas del grupo
GET /api/metrics/user/:userId                   → métricas del usuario
```

- Toda respuesta lleva `contractVersion`, `period` y `sessionStrategy`.
- Cada métrica es un objeto `{value, measured, coverage, status, reason, period}`.
- **El slug** puede resolverse a `organizationId` **en la entrada**; nunca
  autoriza, nunca participa en joins. `/api/metrics/school/:schoolId` queda
  `deprecated` y devuelve `Deprecation`/`Sunset`.
- Un scope sin datos responde **200 con `NO_DATA`**, no 404 ni 0.

---

## 11. Motor de referencia

`engines/metrics/eventContract.mjs` (taxonomía, tiempo, sesiones) y
`engines/metrics/referenceEngine.mjs` (poblaciones, atribución, métricas).

Puros: no abren archivos, no conocen rutas productivas, no usan reloj ni
aleatoriedad, no escriben nada. Los padrones y los eventos se **inyectan**, igual
que el clasificador de grupos. Salida determinística y sanitizada.
