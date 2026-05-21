# AULA VIVA — PASO 2 (ENTREGABLE FINAL)

> **Materializer Engine** activado.
> `events.db` (log canónico, PASO 1) → `insightMaterializer` (proceso incremental
> watermark-based) → `insights.db` (read model materializado: snapshots, perfiles,
> cohortes, notifications) → `insightReader` (API de lectura limpia para Aula Viva).
> **Default-OFF** (`INSIGHTS_MATERIALIZER_ENABLED=1` para activar).
> **Recovery-first**: nunca pierde memoria pedagógica; cualquier fallo degrada sin tumbar.
> **24/24 tests verdes** + identity (12 ✓) + memberships (80 ✓) sin regresión.

---

## 1. Arquitectura completa (PASO 1 + PASO 2)

```
┌─────────────────────────────────────────────────────────────────────┐
│ CAPA INGEST (PASO 1)                                                │
│                                                                     │
│  cliente ──► POST /api/analytics/events                             │
│                  │                                                  │
│                  ├─► analytics_db.json     (legacy queue)           │
│                  └─► analyticsShadow.recordCanonicalEvent()         │
│                            │                                        │
│                            ├─ validateEvent (eventRegistry, 74)     │
│                            ├─ recovery-first: __validation_failed   │
│                            └─► eventsService.insertEvent            │
│                                    │                                │
│                                    ▼                                │
│                              ╔════════════╗                         │
│                              ║ events.db  ║   LOG CANÓNICO          │
│                              ║   (WAL)    ║   inmutable, append-only│
│                              ╚════════════╝                         │
└─────────────────────────────────────────────────────────────────────┘
              │
              │   (watermark: last_event_id)
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CAPA MATERIALIZE (PASO 2)                                           │
│                                                                     │
│  insightMaterializer.runOnce({ batchLimit })                        │
│   │                                                                 │
│   ├─ leer events WHERE id > last_event_id LIMIT 5000  (raw bb-sqlite│
│   │                                                    bypassa el   │
│   │                                                    transformer  │
│   │                                                    camelCase)   │
│   │                                                                 │
│   ├─ agrupar por user → signalCompute.computeUserProfile            │
│   │     ├─ continuidad_semanal                                      │
│   │     ├─ tiempo_efectivo_lectura                                  │
│   │     ├─ abandono_temprano                                        │
│   │     ├─ diversidad_lectora                                       │
│   │     ├─ persistencia                                             │
│   │     └─ abandono_risk = min(1, abandono·0.7 + (1-continuidad)·0.3│
│   │                                                                 │
│   ├─ tx(insights.db):                                               │
│   │    ├─ INSERT signal_snapshots  (UNIQUE scope,signal,period)     │
│   │    ├─ UPSERT user_reading_profiles                              │
│   │    ├─ UPSERT cohort_rollups   (all/global)                      │
│   │    ├─ acumular pendingNotifs[] (NO insertar dentro de tx)       │
│   │    └─ UPDATE materializer_state {last_event_id, lag, …}         │
│   │                                                                 │
│   └─ POST-COMMIT: flush pendingNotifs → insightsStore.insertNotif   │
│         (handle separado; tx ya cerrada → no SQLITE_BUSY)           │
│                                                                     │
│                    ╔════════════════╗                               │
│                    ║  insights.db   ║  READ MODEL                   │
│                    ║   (WAL)        ║  materializado, derivable     │
│                    ╚════════════════╝  desde events.db              │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CAPA READ (PASO 2 — para Aula Viva Phase-1)                         │
│                                                                     │
│  insightReader.getUserProfile(userId)                               │
│  insightReader.getCohortRollup(scope, id)                           │
│  insightReader.getScopeSignals(scope, id)                           │
│  insightReader.isReady()                                            │
│                                                                     │
│   → never-throws: error → null/[] → caller hace fallback ad-hoc     │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
         Aula Viva (PASO 3 — futuro)
         dual-read: primero insightReader, fallback ad-hoc analytics_db.json
```

---

## 2. `insightMaterializer` — implementado

**Archivo:** `server/services/insightMaterializer.mjs`

### API pública
```js
runOnce({ nowTs?, batchLimit?, log? })
    → { ok, processed, watermarkFrom, watermarkTo,
        durationMs, lagEvents,
        profilesUpserted, snapshotsUpserted, cohortsUpserted,
        notifications, skippedCorrupted, error? }

rebuildInsights({ fromTs, toTs, dryRun?, scopes? })
    → { ok, scanned, wouldUpsert, upserted, scopes? }

getStatus()
    → { materializer, enabled, last_event_id, last_ts, updated_at,
        lag_events, lag_seconds, degraded, last_error,
        tables: { signal_snapshots, user_reading_profiles,
                  cohort_rollups, materializer_state }, ok }

closeMaterializerEventsDb()  // solo tests
```

### Decisiones críticas
| Decisión | Por qué |
|---|---|
| **Raw handle a events.db** (`_eventsRawDb` con prepared stmts) | `eventsService.getEventsSince` aplica `rowToBackboneEvent` (camelCase) y descarta `id` → sin `id` no hay watermark. |
| **`insightsStore.ensureDbOpen()` ANTES de abrir tx** | Lazy init de `insightsStore.getDb` dentro de tx → DDL en handle paralelo → SQLITE_BUSY → `_db` queda set pero `_stmt` null → TypeError en siguiente call. |
| **`pendingNotifs[]` acumulados en tx + flush POST-COMMIT** | SQLite WAL: 1 writer concurrente por archivo. `insightsStore.insertNotification` usa OTRO handle al MISMO `insights.db` → si se invoca dentro de nuestra tx → SQLITE_BUSY silente (caught por try/catch) → notifications=0. |
| **`MATERIALIZER_NAME='aula_viva_pedagogical_v1'`** singleton en `materializer_state` | Permite versionar el materializador (v2 futuro convive con v1, watermarks independientes). |
| **`DEFAULT_BATCH=5000`** | Suficientemente grande para alcanzar al log en horas con 10⁴ events/h sin congestionar; `getStatus().lag_events` lo monitorea. |
| **`PERIOD_DAYS=28`** | Ventana móvil estándar para señales pedagógicas (4 semanas — captura continuidad, evita ruido de fin de semana). |
| **Risk trigger formal:** `abandono_risk >= 0.7` | Umbral en PASO 2 §17. Dedupe por `hasPendingNotification(insight_key, 'risk_abandono')` → no spam. |
| **`degraded:true` + `last_error` en state** tras fallo de `runOnce` | El healthcheck refleja sin sacar al server. Próxima corrida ok → vuelve a `degraded:false`. |

---

## 3. `insights.db` activo (read model materializado)

**Archivo schema:** `server/db/insightsDbExt.mjs` (extiende `insightsStore.js` sin tocarlo).

### Tablas nuevas (CREATE TABLE IF NOT EXISTS)

```sql
materializer_state (
    materializer_name TEXT PRIMARY KEY,
    last_event_id     INTEGER,
    last_ts           INTEGER,
    lag_events        INTEGER,
    lag_seconds       INTEGER,
    degraded          INTEGER (boolean),
    last_error        TEXT,
    updated_at        INTEGER
)

signal_snapshots (
    id              INTEGER PK AUTOINCREMENT,
    scope_type      TEXT (user|group|content|all),
    scope_id        TEXT,
    signal_id       TEXT,   -- de signals.js (15 contratos)
    period          TEXT,   -- '28d'
    metric_value    REAL,
    confidence      REAL,
    trend           REAL,
    source_watermark INTEGER,
    metadata_json   TEXT,
    computed_at     INTEGER,
    UNIQUE(scope_type, scope_id, signal_id, period)
)

user_reading_profiles (
    user_id            TEXT PRIMARY KEY,
    fluidez_score      REAL,
    persistencia_score REAL,
    autonomia_score    REAL,
    concentracion_score REAL,
    diversidad_score   REAL,
    engagement_score   REAL,
    abandono_risk      REAL,  -- 0..1
    last_active_at     INTEGER,
    source_watermark   INTEGER,
    updated_at         INTEGER
)

cohort_rollups (
    scope_type   TEXT,
    scope_id     TEXT,
    period       TEXT,
    metric_key   TEXT,
    metric_value REAL,
    trend        REAL,
    updated_at   INTEGER,
    PRIMARY KEY (scope_type, scope_id, period, metric_key)
)
```

### Compatibilidad
- Singleton compartido con `insightsStore.js` por **path** (`INSIGHTS_SQLITE_PATH` env override).
- PRAGMAs ya aplicados por `insightsStore.getDb`: WAL, `busy_timeout=5000`, `synchronous=NORMAL`, `wal_autocheckpoint=100`, `foreign_keys=ON`, `cache_size=-2000`, `temp_store=MEMORY`.
- `insightsDbExt` solo agrega tablas + stmts; NUNCA toca tablas existentes de `insightsStore`.

---

## 4. Snapshots / cohortes / perfiles / risk / notifications — funcionando

### Snapshots (señales por scope)
Cada `runOnce` que afecta a un user genera ≥1 `signal_snapshots` con UNIQUE(scope,signal,period) → INSERT OR REPLACE garantiza idempotencia.

### Cohortes
`cohort_rollups['all','global','28d','active_users']` se actualiza en cada batch con el conteo de usuarios distintos en ventana → métrica institucional mínima viable.

### Perfiles (6 scores + risk)
`computeUserProfile` deriva 6 scores normalizados [0..1] + `abandono_risk`. UPSERT por `user_id`.

### Risk → notification
- u3 con 3 `reading_abandoned` consecutivos → `abandono_risk=1.0` → `insertNotification({severity:'warning', channel:'dashboard', status:'pending'})`.
- **Re-run NO duplica** (`hasPendingNotification` dedupe).
- **Inserción POST-COMMIT** (ver §2: evita SQLITE_BUSY con tx del materializer).
- `payload_json` contiene `{type:'risk_abandono', score, window_days}`.

### Tolerancia a corruptos
Event con `user_id=''` insertado raw bypassando shadow → `skippedCorrupted++`, batch sigue procesando el resto. NO tumba.

---

## 5. Aula Viva — `insightReader` (API limpia para Phase-1 dual-read)

**Archivo:** `server/services/insightReader.mjs`

```js
getUserProfile(userId)            // PSCustomObject o null
getCohortRollup(scope_type, scope_id)   // array o []
getScopeSignals(scope_type, scope_id)   // array o []
isReady()                         // { ready:boolean, status:string, error? }
```

**Contrato:** NUNCA lanza. Error interno → null/[] → caller hace fallback ad-hoc a `analytics_db.json` (PASO 3 cutover).

**Uso esperado en Aula Viva (PASO 3):**
```js
// pseudo: pageGroupDashboard
const profile = insightReader.getUserProfile(studentId);
if (profile && profile.engagement_score != null) {
    // usar profile materializado → respuesta sub-ms
} else {
    // fallback: scan analytics_db.json en vivo
}
```

---

## 6. Métricas nuevas (PASO 2)

**Archivo:** `server/observability/metrics.js` — 8 métricas Prometheus añadidas, cardinalidad controlada:

| Métrica | Tipo | Labels | Uso |
|---|---|---|---|
| `materializer_runs_total` | Counter | `result` (ok / degraded / error) | Tasa de éxito |
| `materializer_duration_seconds` | Histogram | — | p50/p95/p99 latencia |
| `materializer_lag_events` | Gauge | — | Eventos sin materializar |
| `materializer_lag_seconds` | Gauge | — | Edad del último evento materializado |
| `snapshot_updates_total` | Counter | `table` (signal_snapshots / user_reading_profiles) | Throughput de upserts |
| `cohort_updates_total` | Counter | — | Rollups recalculados |
| `risk_flags_total` | Counter | `rule` (risk_abandono) | Detección de riesgo |
| `insight_notifications_total` | Counter | `severity` (warning / info) | Notificaciones generadas |

**Cardinalidad:** NUNCA usa userId/contentId/email/sessionId como label (consistente con regla P2).

---

## 7. Healthcheck nuevo (`/api/health/analytics`)

**Archivo:** `server/observability/analyticsHealth.js`

`checks.materializer` ahora añadido al payload:
```json
{
  "status": "ok",
  "checks": {
    "events_db":           { "ok": true, "count": N },
    "registry":            { "ok": true, "version": 2, "event_names": 74 },
    "materializer": {
      "materializer": "aula_viva_pedagogical_v1",
      "enabled": false,            // ← gate INSIGHTS_MATERIALIZER_ENABLED
      "last_event_id": 0, "last_ts": null,
      "lag_events": 0, "lag_seconds": 0,
      "degraded": false, "last_error": null,
      "tables": { "signal_snapshots":0, "user_reading_profiles":0,
                  "cohort_rollups":0, "materializer_state":0 },
      "ok": true
    },
    "archive_db":          { "ok": true, "present": false, "size_mb": null },
    "throughput":          { ... },
    "shadow_consistency":  { "ok": true, ... }
  }
}
```

**Verificación dry-run (sin bootear server):**
```
HTTP status: 200
overall status: ok
checks present: [ events_db, registry, materializer, archive_db, throughput, shadow_consistency ]
checks.materializer present: true
materializer keys: [ materializer, enabled, last_event_id, last_ts, updated_at,
                     lag_events, lag_seconds, degraded, last_error, tables, ok ]
```

---

## 8. Tests ejecutados (sin regresión)

### `test:analytics` → **24 ✓ / 0 ✗**
Cubre §26.1-15 + reader API:
- (A) Incremental processing + watermark updates ✓
- (B) Replay (dry-run + real + idempotente) ✓
- (C) Cohort rollups + user profiles + **notifications + dedupe** ✓
- (D) Lag metrics + WAL compatibility (`integrity_check=ok`) ✓
- (E) Rebuild parcial + tolerancia a corrupto + status.degraded boolean ✓
- (F) Shadow compare + performance baseline (idle <200ms) ✓
- (G) Reader API never-throws con inputs inexistentes ✓

**Isolation:** env override `EVENTS_SQLITE_PATH` + `INSIGHTS_SQLITE_PATH` en `tmpdir` → NUNCA toca `/data-critical/` ni prod.

### `test:identity` → **12 ✓ / 0 ✗**  (cohort hash + flag precedence)
### `test:memberships` → **80 ✓ / 0 ✗** (governance + endpoints)

---

## 9. Benchmark inicial

| Escenario | Latencia | Notas |
|---|---|---|
| `runOnce` idle (0 nuevos events) | **<1 ms** (test §15: `0ms`) | Solo lee watermark, lookup en `materializer_state`. |
| `runOnce` con 5 events / 2 users | **~2 ms** (test debug: `durationMs:2`) | Incluye perfiles, snapshots, cohort. |
| `runOnce` con 4 events / 1 user (u3 con risk) | **<5 ms** | Incluye POST-COMMIT notification flush. |
| `rebuildInsights` ventana 7d, ~9 events, dryRun | **~3 ms** | Solo escanea + cuenta, no escribe. |

**Proyección operacional** (no validada bajo carga; números estimados, NO fabricados):
- A 10 events/s sostenidos, `runOnce` cada 60s procesa lotes de 600 → coste por lote ~30-50ms → headroom ≥ 100× antes de saturar.
- Lag esperado en régimen: <30s.
- **NO HE HECHO LOAD TEST REAL** — el harness existe (`loadtest:autocannon`) pero requiere boot productivo + tráfico simulado; queda para validación operacional.

---

## 10. Activación productiva (paso a paso)

```bash
# 1. Verificar que insights.db existe + es escribible
ls -la data-critical/insights.db

# 2. Activar materializer (default OFF)
export INSIGHTS_MATERIALIZER_ENABLED=1

# 3. Boot server normal
npm run server

# 4. Disparar primera materialización via REST (futuro PASO 3):
#    En PASO 2 el materializer NO tiene scheduler interno aún
#    → llamar manualmente por instrumentación (cron / setInterval / endpoint admin)
#    Patrón recomendado en server.js boot:
#
#    if (process.env.INSIGHTS_MATERIALIZER_ENABLED === '1') {
#      const { runOnce } = await import('./services/insightMaterializer.mjs');
#      setInterval(() => runOnce({ log: console.log }), 60_000);
#    }

# 5. Verificar healthcheck
curl http://localhost:3000/api/health/analytics | jq '.checks.materializer'

# 6. Rollback: simplemente unset INSIGHTS_MATERIALIZER_ENABLED + restart.
#    insights.db queda con datos materializados; reactivar continúa desde watermark.
```

**NO HE TOCADO** `server.js` para añadir el scheduler de `setInterval`. Es el paso explícito que queda manual para mantener PASO 2 quirúrgico:
- Materializer existe, validado, healthcheck lo refleja
- Scheduler se conecta en PASO 3 (junto con dual-read en Aula Viva)

---

## 11. Riesgos restantes (a vigilar)

| Riesgo | Severidad | Mitigación implementada | Acción residual |
|---|---|---|---|
| `runOnce` corre dentro del event loop principal → bloquea ingest si batch grande | M | `DEFAULT_BATCH=5000` + lag metrics + `getStatus().degraded` | PASO 3: mover a worker_thread o cron externo. |
| Schema migration en `signal_snapshots` (cambiar formula) invalida snapshots viejos | M | `MATERIALIZER_NAME` versionable → v2 con watermark propio | PASO 3: doc de migración. |
| `analytics_db.json` (legacy) + `events.db` (canon) divergencia silenciosa | L | `shadow_consistency` en healthcheck + `event_validation_failures_total` métrica | PASO 4: cutover read después de N días sin divergencia. |
| Notifications acumulan sin consumidor (`status=pending` infinito) | L | dedupe por insight_key | PASO 3: dashboard en Aula Viva + acción "marcar como vista". |
| `signalCompute` solo cubre 5 señales (10 son stubs) | M | stubs retornan `null` → no contaminan perfiles | PASO 3-4: implementar las 10 restantes con tests pareados. |
| Cardinalidad `signal_snapshots` crece O(usuarios × señales × period) | L | UNIQUE constraint → no duplica; VACUUM periódico | PASO 3: cron weekly `VACUUM insights.db`. |
| Lag spike no alerta automáticamente | M | Métrica `materializer_lag_events` Gauge expuesta | PASO 3: alert rule en Prometheus (`> 50000 for 5m`). |

---

## 12. Qué NO toqué (consistente con reglas del proyecto)

- ❌ `insightsStore.js` (no se modificó; las nuevas tablas viven en `insightsDbExt.mjs`)
- ❌ `eventsService.js` (solo lectura; el handle raw vive en el materializer)
- ❌ `server.js` (no se añadió scheduler de `setInterval` — PASO 3)
- ❌ Auth, login, onboarding, uploads
- ❌ Aula Viva endpoints (`/api/groups`, `/api/access`) — siguen ad-hoc; cutover en PASO 3
- ❌ Runtime inmersivo V1/V2, executor, continuity guard
- ❌ nginx edge, Docker Compose
- ❌ Migración a otro DB engine; sigue `better-sqlite3` raw + WAL

---

## 13. Archivos creados/modificados

### Creados
```
server/db/insightsDbExt.mjs                    # +120  schema extensión + handle
server/services/signalCompute.mjs              # +280  5 señales puras + computeUserProfile
server/services/insightMaterializer.mjs        # +440  engine completo (runOnce, rebuild, getStatus)
server/services/insightReader.mjs              # +75   API lectura never-throws para Aula Viva
server/__test__/insightMaterializer.test.js    # +200  24 checks aislados
docs/AULA-VIVA-PASO-2-MATERIALIZER.md          # +500  audit pre-PASO 2 (PRE)
docs/AULA-VIVA-PASO-2-ENTREGABLE.md            # este  doc final
```

### Modificados (quirúrgicamente)
```
server/services/analyticsShadow.mjs            # snake→camel + setInserterForTest (bugfix PASO 1)
server/observability/analyticsHealth.js        # +6 líneas: checks.materializer
server/observability/metrics.js                # +8 contadores/gauges
```

---

## 14. Qué queda para PASO 3 (no implementar sin instrucción)

1. **Scheduler en `server.js`**: `setInterval(runOnce, 60_000)` gated por env flag. Pattern propuesto en §10.
2. **Aula Viva dual-read**: en `/api/groups/:id/dashboard` (o equivalente) llamar `insightReader.getUserProfile` con fallback a scan ad-hoc.
3. **Endpoint admin** `POST /api/admin/insights/runOnce` (gated por `x-admin-secret`) → manual force.
4. **Endpoint admin** `POST /api/admin/insights/rebuild?fromTs=&toTs=` → replay para reparación.
5. **Notification consumer**: UI en Aula Viva que liste pendings + marque `status=sent`.
6. **10 señales restantes** en `signalCompute.mjs` (stubs vigentes: comprension_lectora, fluidez_lectura, lectura_critica, concentracion, autonomia_lectora, construccion_habito, etc.).
7. **Alerting rules** Prometheus: `materializer_lag_events > 50_000 for 5m` → warn; `degraded=true for 10m` → crit.
8. **Backup automation** insights.db (puede reconstruirse desde events.db en cualquier momento via `rebuildInsights`).

---

## 15. Resumen ejecutivo (1 párrafo)

PASO 2 introduce un materializador incremental watermark-based (`insightMaterializer`) que transforma el log canónico de eventos (`events.db`, PASO 1) en un read model materializado (`insights.db`) con snapshots de señales, perfiles de lector, rollups de cohorte y notificaciones de riesgo pedagógico. Es default-OFF (`INSIGHTS_MATERIALIZER_ENABLED`), recovery-first (degrada sin tumbar; nunca pierde memoria pedagógica; cualquier fallo queda reflejado en `materializer_state.degraded` + healthcheck), idempotente (replay del mismo rango produce el mismo resultado), y compatible con el resto del stack (raw `better-sqlite3` + WAL, sin nuevas dependencias, sin tocar `insightsStore.js` ni el auth path). Validado con 24/24 tests aislados + identity y memberships sin regresión. Listo para que PASO 3 conecte el scheduler en `server.js` y Aula Viva consuma `insightReader` con fallback ad-hoc.
