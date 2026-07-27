# API v2 de métricas

**Unidad:** CHP-API-METRICS-01A · **Estado:** `API V2 READY FOR CONTROLLED
SHADOW DEPLOYMENT — NOT DEPLOYED`

Expone el motor canónico aprobado (contrato v2, D1–D10) detrás de rutas
versionadas nuevas. **No modifica ninguna ruta legacy ni el frontend.**

---

## 1. Rutas

```
GET /api/v2/metrics/organizations
GET /api/v2/metrics/organizations/:organizationId
GET /api/v2/metrics/groups/:groupId
GET /api/v2/metrics/users/:userId
```

### Parámetros

| Parámetro | Default | Notas |
|---|---|---|
| `from` / `to` | — | epoch ms; si se dan, mandan sobre `period` |
| `period` | `30d` | `<n>d` o `all` para el histórico |
| `sessionIdleMinutes` | 15 | **override administrativo**: 403 para no-admin, máx 240 |
| `includeQuality` | `true` | `false` omite el bloque `quality` |

Errores de parámetro → **400** con el código exacto (`INVALID_PERIOD`,
`PERIOD_INVERTED`, `IDLE_OVERRIDE_FORBIDDEN`, `INVALID_IDLE`).

---

## 2. Sobre de respuesta

```jsonc
{
  "contractVersion": 2,
  "generatedAt": 1800000000000,
  "period": { "fromTs": 1797408000000, "toTs": 1800000000000, "days": 30 },
  "sessionStrategy": "INACTIVITY_WINDOW_15MIN",
  "sessionCapMs": 14400000,
  "organizationId": "org-…",
  "metrics": { "activeReaders": { /* sobre de métrica */ } },
  "population": {
    "registeredUsers": 90, "registeredReaders": 80, "eligibleReaders": 80,
    "readersWithoutGroup": 0, "usersWithActivity": 37, "activeReaders": 21,
    "readersWithEvents": 37
  },
  "coverage": { "numerator": 21, "denominator": 80, "ratio": 0.2625 },
  "quality": { "unattributedEvents": 0, "unknownEvents": 5,
               "cappedSessions": 0, "orphanSessionEnds": 0 }
}
```

Cada métrica viaja en su propio sobre con `metric`, `value`, `measured`,
`status`, `label`, `reason`, `period`, `population`, `coverage` y `quality`.

### Métricas publicadas

`registeredUsers` · `registeredReaders` · `eligibleReaders` ·
`readersWithoutGroup` · `usersWithActivity` · `activeReaders` · `entries` ·
`sessions` · `platformTimeMs` · `distinctContents` · `readingTimeMs`

> `distinctContents` es el nombre publicado de la métrica que el motor llama
> `contentsOpened`. Es un alias de presentación, no un cambio de contrato.

`readingTimeMs` responde siempre:

```json
{ "metric": "readingTimeMs", "value": null, "measured": false,
  "status": "NOT_DEFINED", "label": "Métrica aún no disponible" }
```

No se publica ninguna aproximación.

---

## 3. Estados

| Estado | `value` | Etiqueta |
|---|---|---|
| `MEASURED` | número | — |
| `NO_ACTIVITY` | **0** | Sin actividad registrada |
| `NO_DATA` | `null` | Sin datos suficientes |
| `NOT_MATERIALIZED` | `null` | Pendiente de cálculo |
| `NOT_DEFINED` | `null` | Métrica aún no disponible |
| `ERROR` | `null` | Error al calcular |

**Un error jamás se convierte en ceros.** Fuente caída → `503
metrics_source_unavailable`; identidad indecidible → `503`; fallo inesperado →
`500 metrics_internal_error`. Ninguno devuelve `metrics`.

---

## 4. Autorización

Exclusivamente por `organizationId` a través del CIS. **Ningún slug, nombre de
colegio ni texto libre autoriza.**

| Situación | Respuesta |
|---|---|
| Sin identidad | 401 |
| Organización no registrada | **404** (también para administradores) |
| Fuera del scope del caller | 403 con `cause` |
| Grupo histórico o sintético | 403 (`GROUP_HISTORICAL` / `GROUP_SYNTHETIC`) |
| Canónico indisponible | 503 |

Un administrador de plataforma pasa el gate del CIS para cualquier scope, así
que la **existencia** se comprueba aparte: un `organizationId` inventado
devuelve 404, no un 200 con `NO_DATA`.

`GET /organizations` devuelve **solo** las organizaciones que el caller puede
ver: un mediador ve la suya, el administrador ve todas.

---

## 5. Feature flag y compatibilidad legacy

```
METRICS_ENGINE = legacy | canonical | shadow      (default: legacy)
```

| Modo | Comportamiento de las rutas legacy |
|---|---|
| `legacy` | **default** — responden exactamente como hoy; el motor nuevo no interviene |
| `shadow` | responden legacy y se registra **solo** la diferencia agregada sanitizada |
| `canonical` | responde el motor nuevo, con cabeceras `Deprecation`, `Link` y `Warning` |

Las rutas v2 son **siempre aditivas** y no dependen del flag.

El slug (`villas-de-aranjuez`) se admite **únicamente como compatibilidad de
entrada** en el adaptador legacy: se resuelve contra el registro institucional
—nunca contra el texto libre de los grupos— y a partir de ahí todo usa el
`organizationId`. Un nombre o slug ambiguo devuelve `null`: **jamás se toma la
primera coincidencia**. En v2 el slug no resuelve nada: es 404.

### Modo shadow

Compara poblaciones legacy y canónicas y emite diferencias con su razón
(`CONTRACT_DIFFERS_READING_VS_PRESENCE`, `CONTRACT_DIFFERS_POPULATION_SCOPE`).
**Una diferencia no es un fallo**: los contratos son distintos a propósito. Lo
que sí alerta es `ENGINE_ERROR`, `USER_OUT_OF_SCOPE`, `MISSING_METRIC`,
`NON_DETERMINISTIC` o `INVALID_CANONICAL_SHAPE`. El umbral relativo es
configurable (`ratioDelta`, 0,25 por defecto). Los logs no llevan PII ni
payloads.

---

## 6. Provider read-only

`server/metrics/metricsProvider.mjs`: rutas desde `server/config.js`,
`events.db` siempre en `readonly: true`, filtrado por periodo **en SQL** (un
request de 30 días no arrastra el histórico), orden estable por `server_ts` y
`event_id`. No escribe nada; `analytics_db.json` solo se abre si se pide
comparación legacy explícita. Es inyectable, así que los tests corren con
fixtures sintéticas sin abrir SQLite.

---

## 7. Rendimiento medido (snapshot read-only de producción)

19.465 eventos históricos · 11.984 en 30 días.

| Escenario | p50 | p95 | Respuesta |
|---|---:|---:|---:|
| `organizations` · 30 d | 319 ms | 647 ms | 19 KB |
| `organizations` · histórico | 378 ms | 720 ms | 17 KB |
| Una organización · 30 d | 62 ms | 74 ms | 6 KB |
| Un grupo · 30 d | 50 ms | 66 ms | 6 KB |
| Un usuario · 30 d | 2 ms | 3 ms | 6 KB |
| Solo carga de eventos · 30 d | 145 ms | 316 ms | 3,1 MB en memoria |

El listado es el más caro y **crece linealmente con el volumen de eventos**.
Cuando incomode, en este orden: caché en memoria con TTL corto → agregación
acotada en SQL por organización → preagregación → materialización. **Nada de
esto se implementó aquí**, y no se escribe `insights.db`.

---

## 8. Despliegue previsto (no ejecutado)

1. Desplegar con `METRICS_ENGINE=legacy`: solo aparecen las rutas v2.
2. Contrastar v2 contra las cifras reconstruidas.
3. Pasar a `shadow` y observar las diferencias agregadas.
4. Migrar consumidores a v2.
5. `canonical` para las rutas legacy, ya con cabeceras de deprecación.
6. Retirar las rutas legacy cuando no queden consumidores.
