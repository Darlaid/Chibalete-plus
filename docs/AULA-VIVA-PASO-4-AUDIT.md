# AULA VIVA — PASO 4 · AUDITORÍA DE ESCALABILIDAD (PRE-IMPLEMENTACIÓN)

> Mandato §2 del plan PASO 4. Antes de tocar código, mapeo del stack real
> (no hipotético) y juicio de cuellos reales vs. teóricos. Cada decisión
> técnica posterior debe poder apoyarse en algo de este documento.

---

## 1. Topología actual (verificada en repo)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  HOT WRITE PATH                                                          │
│  events.db (data-critical/events.db)                                     │
│   - WAL, synchronous=NORMAL, busy_timeout=5000, wal_autocheckpoint=100,  │
│     cache_size=-2000 (2 MB), temp_store=MEMORY                           │
│   - Índices: idx_user_content, idx_session, idx_event_ts, idx_mode_ts    │
│   - UNIQUE(event_id) — dedupe atómico                                    │
│   - 2 handles paralelos:                                                 │
│       (A) eventsService.js          → INSERT (1 writer)                  │
│       (B) insightMaterializer.mjs   → SELECT raw readonly (1 reader)     │
│                                                                          │
│  WARM READ MODEL                                                         │
│  insights.db (data-critical/insights.db)                                 │
│   - Mismos PRAGMA WAL (4 handles al mismo archivo):                      │
│       (1) insightsStore.js          → notifications + alerts             │
│       (2) insightsDbExt.mjs         → signal_snapshots, profiles, cohorts│
│       (3) pedagogyDbExt.mjs         → recommendations, interventions,    │
│                                       risk_history                       │
│       (4) materializer raw reader   → (vía insightsDbExt internamente)   │
│                                                                          │
│  COLD ARCHIVE                                                            │
│  events.archive.db (data-critical/events.archive.db)                     │
│   - Existe ARCHIVE_DB en healthcheck (presence + size)                   │
│   - Rotación: lazy, eventos viejos NO se mueven automáticamente aún      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Multi-API:** `chibalete_api_1` + `chibalete_api_2` (Docker Compose, mismo
bind-mount `/var/www/chibalete/data-critical/`). Ambos abren TODOS los
handles arriba. **Hoy ningún coordinador evita doble corrida** de materializer
o intervention engine si ambos están habilitados — PASO 4 debe resolver esto.

---

## 2. PRAGMAs vigentes — auditoría

| PRAGMA | Valor actual | Justificación heredada | Veredicto PASO 4 |
|---|---|---|---|
| `journal_mode` | WAL | multi-reader + 1 writer sin bloqueo | ✅ mantener |
| `synchronous` | NORMAL | fsync solo en checkpoint, seguro con WAL | ✅ mantener |
| `busy_timeout` | 5000 (5 s) | espera ante write lock | ⚠ subir para insights.db a 10000 (mayor contention con 3 escritores) |
| `wal_autocheckpoint` | 100 (≈400 KB) | checkpoint automático | ⚠ subir a 1000 para events.db (hot path) — menos checkpoints, menos pausas |
| `cache_size` | -2000 (2 MB) | cache de páginas | ⚠ subir insights.db a -8000 (8 MB) para perfiles+rollups+features |
| `temp_store` | MEMORY | tablas temporales en RAM | ✅ mantener |
| `foreign_keys` | ON (insights), OFF (events) | events no tiene FKs | ✅ mantener |
| `mmap_size` | **no seteado** | — | ➕ AGREGAR `268435456` (256 MB) en insights/events — reads zero-copy |
| `page_size` | 4096 (default) | locked al crear DB | ✅ aceptar — cambiarlo requiere VACUUM full |

**Decisiones a aplicar (todas reversibles):**
- `events.db`: `wal_autocheckpoint=1000`, `mmap_size=268435456`
- `insights.db`: `busy_timeout=10000`, `cache_size=-8000`, `mmap_size=268435456`
- Cambios gated por env `PRAGMA_TUNING_ENABLED=1` (default ON; rollback = `=0` → vuelve a defaults heredados)

---

## 3. Lock contention — análisis de write paths

| Path | Handle | Tabla(s) | Escritor concurrente potencial |
|---|---|---|---|
| eventsService.insertEvent | A | events | api_1 + api_2 escriben (al mismo archivo, mismo writer-lock) |
| insightMaterializer.runOnce  FASE materialize | (2) | signal_snapshots, profiles, cohort_rollups, materializer_state | api_1 + api_2 si ambos habilitan flag |
| insightMaterializer flush notif (POST-COMMIT) | (1) insightsStore | insight_notifications | sí, handle distinto MISMO archivo |
| interventionEngine FASE 2 (pedagogy tx) | (3) | pedagogical_* | api_1 + api_2 si ambos habilitan flag |
| interventionEngine FASE 4 (insights tx) | (2) | cohort_rollups | secuencial al pedagogy tx, sin contención inter-fase (lección PASO 3) |

**Conclusión:**
1. **Cross-handle dentro de un proceso** — ya resuelto por patrón 4-fase
   (compute puro → tx pedagogy → POST-COMMIT pedagogy → tx insights).
2. **Cross-process (api_1 ⇄ api_2)** — NO resuelto. Si ambos corren
   `materializer.runOnce` al mismo segundo, ambos:
   (a) leen el mismo `watermark`, (b) procesan el mismo batch, (c) intentan
   UPSERT con UNIQUE en `signal_snapshots` → uno gana, el otro recibe
   constraint violation → tx aborta. Es **safe** (datos correctos) pero
   **ruidoso** (errores, métrica `sqlite_busy_total` sube).
3. **Doble-cómputo de recomendaciones** — más grave: ambos podrían generar
   `pedagogical_recommendations` distintas porque `recommendation_id`
   incluye `nowTs` (timestamp distinto en cada api). La UNIQUE partial
   `(scope+rule WHERE acknowledged=0)` evita duplicado activo, pero
   se desperdicia cómputo y se genera ruido.

**Decisión PASO 4:** leader election simple por **advisory lock SQLite-based**
con TTL+heartbeat (NO Redis, NO etcd). El proceso que NO obtiene el lock
hace `runOnce` con `forceRun=false` y retorna `skipped`. Heartbeat cada 30 s;
TTL de 90 s (un proceso muerto libera el lock automáticamente).

---

## 4. Replay actual (`materializer.rebuildInsights`) — gaps

| Capacidad requerida §9 | Estado hoy | Acción PASO 4 |
|---|---|---|
| replay parcial por scope | ✅ `scopes.userIds` ya soportado | mantener |
| replay parcial por rango | ✅ `fromTs/toTs` | mantener |
| replay seguro (recovery) | ✅ try/catch + `out.error` | mantener |
| replay idempotente | ✅ probado en PASO 2 test §5 | mantener |
| replay **resumible** | ❌ falla → empieza de cero | ➕ JOB LEDGER + checkpoint por chunk |
| replay **cancelable** | ❌ no hay flag | ➕ JOB LEDGER `cancel_requested` chequeado por chunk |
| progreso observable | ⚠ devuelve sólo al final | ➕ tabla `materializer_runs` con progress_n/progress_total |

---

## 5. Snapshots — limitación auditada PASO 3 §17

`signal_snapshots` tiene `UNIQUE(scope_type, scope_id, signal_id, period)` →
cada `runOnce` MACHACA el snapshot anterior. Esto implica:

- Reglas longitudinales (deterioro_continuidad, mejora_destacada) sólo
  pueden disparar comparando `profile.updated_at` previo vs actual del
  mismo row, no series reales.
- Cohort timelines = puntos aislados (no trayectorias).
- IA futura: features series-temporales no reconstruibles.

**Decisión PASO 4:** tabla `signal_snapshots_history` APPEND-ONLY:
- gated por `SNAPSHOT_HISTORY_ENABLED=1` (default OFF — opt-in; sólo prende
  cuando se quiera retener historia. Esto duplica escritos y crece tabla).
- Cada `runOnce` que persiste un snapshot también inserta una fila history
  con `recorded_at` distinto al `updated_at` (recorded_at = momento real
  del insert; updated_at = period_end de la ventana).
- Reten ción: PASO 5 puede VACUUM > 365 d.

---

## 6. Rollups — diseño (§6, §7)

Hoy `cohort_rollups` tiene 4 métricas globales (PASO 2 + 3). No hay
agregación temporal — todo es "ahora" para ventana 28d. Para dashboards
docente/colegio que necesitan **tendencias** debemos rollar por:

| Granularidad | Bucket | Use case |
|---|---|---|
| **daily** | `period_start = floor(ts / 86400_000) * 86400_000` | sparkline 30 últimos días |
| **weekly** | bucket ISO-week (Mon 00:00 UTC) | tendencia trimestral |
| **monthly** | primer día del mes UTC | comparativa anual |

Tablas `daily_rollups`, `weekly_rollups`, `monthly_rollups` — shape
idéntico al `cohort_rollups` actual + `period_start` como discriminador
temporal en la UNIQUE.

**Fuente de datos:** events.db (cuenta de sesiones, abandonos, completados
por día/scope). Cómputo gated por `ROLLUPS_ENABLED=1` (default OFF).
Idempotente: re-correr = re-UPSERT por (period_start, scope, metric).

**Beneficio operacional:** dashboards leen N filas (N=30 para sparkline)
en lugar de scanear miles de eventos. Esto es lo que hace que se cumplan
los SLOs §12 sin caché aplicativa.

---

## 7. Feature extraction — diseño (§8)

Tabla `feature_vectors` versionada para IA futura sin entrenar IA hoy.

Shape:
```
user_id           TEXT
period            TEXT  ('28d')
vector_version    INTEGER  (FEATURE_VECTOR_VERSION en código)
period_start      INTEGER
period_end        INTEGER
features_json     TEXT  (todos los features serializados)
computed_at       INTEGER
source_watermark  INTEGER
PRIMARY KEY (user_id, period, vector_version, period_end)
```

Features extraídos (todos del read model PASO 2 + rollups PASO 4):
`continuidad`, `persistencia`, `abandono`, `engagement`, `concentracion`,
`diversidad`, `autonomia`, `recuperacion`, `audio_usage`, `accessibility_usage`,
`relectura`, `progression_slope` (PASO 4: pendiente de continuidad sobre
últimos 4 weekly_rollups).

**Reproducible:** `vector_version` permite que IA futura entrene sobre v1
y compare con v2 cuando cambien las features. Cada feature_vector tiene
`source_watermark` = `last_event_id` al momento de cómputo → trazabilidad
exacta.

---

## 8. Multi-api consistency — diseño

Tabla `process_leader`:
```
lock_key      TEXT PRIMARY KEY  ('materializer' | 'intervention' | 'rollup')
holder_id     TEXT              (hostname + pid + random suffix)
acquired_at   INTEGER
heartbeat_at  INTEGER
expires_at    INTEGER
```

`acquireLock(key, ttlMs=90000)`:
1. INSERT OR IGNORE → si éxito, somos líderes.
2. Si fallo (ya hay líder), UPDATE WHERE expires_at < now → reclamar lock huérfano.
3. Si UPDATE actualiza 0 filas → no somos líderes esta vuelta, return false.

`heartbeat(key)`:
- UPDATE expires_at = now + ttlMs WHERE holder_id = self AND lock_key = key.
- Setear cada `ttlMs/3` (≈30s para TTL 90s).

`releaseLock(key)`:
- DELETE WHERE holder_id = self AND lock_key = key.

**Beneficio:** dos APIs en mismo host, sin red, sin Redis. SQLite WAL es
suficiente porque las operaciones de lock son inserts/updates atómicos sobre
una tabla pequeña.

---

## 9. Cuellos previstos a 5000 usuarios (estimación)

> NO he medido bajo carga real. Estimaciones derivadas del shape de los
> queries más caros + tamaño de tabla esperado. PASO 4 incluye **harness
> de medición** para validar en staging antes de prod.

| Carga estimada (5000 users, ~10 sesiones/user/semana) | Estimación |
|---|---|
| events.db crecimiento | ~80 eventos/sesión × 50K sesiones/semana = ~4M eventos/semana = ~520 MB/semana (sin archive) |
| insights.db crecimiento | 5000 profiles + 75K snapshots (15 sigs × 5K) ≈ 30 MB; rollups +20 MB/mes |
| WAL file events.db en pico | ~10-50 MB entre checkpoints (con autocheckpoint=1000 = 4MB threshold) |
| `materializer.runOnce` batch=5000 | ~3-8 s estimado por batch (lookup events + tx insights) — **debe correr cada 60 s con buffer** |
| `interventionEngine.runOnce` con 5000 profiles | ~5-15 s estimado (8 reglas × 5000 = 40K evals) — **cada 5 min** |
| Dashboard docente típico | hoy ~20-100 ms (4 prepared lookups) — **target §12: <150 ms** ✓ |
| Cohort comparison institucional | hoy ~50-200 ms (5 lookups) — **target §12: <500 ms** ✓ ya |

**Riesgos reales:**
- `events.db` 500 MB/semana se acumula → necesita ARCHIVE rotation (no es PASO 4 implementarlo completo, pero PASO 4 expone `wal_size_bytes` + `archive_growth_bytes` para alertar antes).
- `wal_size_bytes` puede crecer si checkpoint se atrasa bajo carga → métrica + healthcheck WARN > 100 MB.
- `sqlite_busy_total` puede explotar si materializer y archive corren a la vez → degraded mode §17.

---

## 10. Degraded modes — diseño (§17)

| Condición | Acción automática |
|---|---|
| `materializer_lag_events > 50_000` | log WARN; dashboards muestran "snapshots: 12 min de atraso"; engine reduce batch a 1000 |
| `materializer_lag_seconds > 900` (15 min) | healthcheck retorna 503; alerta operacional |
| `sqlite_busy_total / minuto > 10` | reducir `replay batch` a 500; pausar `archive_rotate` si corre |
| `wal_size_bytes > 100 MB` | log WARN; engine fuerza `PRAGMA wal_checkpoint(TRUNCATE)` después del próximo tx |
| `replay_running` > 1h sin progreso | job ledger marca status='stalled'; healthcheck WARN |
| `feature_extraction_failed_total > 0` | healthcheck WARN; feature_vectors viejos siguen sirviendo IA |

Todas las acciones son **observables** (métrica + healthcheck), NUNCA
silenciosas. El log siempre dice POR QUÉ.

---

## 11. Lo que NO hay que tocar (consistente con regla del proyecto)

- ❌ `server.js` hot path (no añadir handlers nuevos en este paso; sólo gated init)
- ❌ Auth, login, onboarding, uploads
- ❌ Runtime inmersivo V1/V2, executor, continuity guard
- ❌ nginx edge, Docker Compose
- ❌ Migración a otro DB engine — SQLite con tuning serio es lo correcto
- ❌ Microservicios, Kubernetes, Kafka, Redis obligatorio
- ❌ Cambiar `page_size` (requiere VACUUM full destructivo)
- ❌ Modificar PASO 1/2/3 hot paths (sólo adiciones)
- ❌ Introducir deps nuevas

---

## 12. Conclusión del audit → roadmap implementable PASO 4

1. **schema**: 1 archivo `server/db/rollupsDbExt.mjs` con 5 tablas nuevas
   (`daily/weekly/monthly_rollups`, `signal_snapshots_history`, `feature_vectors`,
   `materializer_runs` job ledger, `process_leader` leader lock).
2. **engines**: `rollupsEngine.mjs`, `featureExtractor.mjs`, `replayEngine.mjs`
   (wrapper resumable/cancelable sobre rebuildInsights), `leaderElection.mjs`,
   `queryProfiler.mjs` (envoltorio de slow log).
3. **reader API**: extender `insightReader.mjs` con `getDailyRollups`,
   `getFeatureVector`, `getJobLedger`.
4. **healthcheck**: extender con `wal_size_bytes`, `replay`, `rollups`,
   `snapshot_history`, `feature_extraction`, `leader`, `slow_queries_recent`.
5. **metrics**: 9 nuevas, cardinalidad fija (§14).
6. **PRAGMA tuning**: aplicar gated por env (§2).
7. **load harness**: extender `loadtest/` con scenario Aula Viva (autocannon).
8. **tests**: `server/__test__/scalability.test.js` — cobertura §23.
9. **doc final**: `docs/AULA-VIVA-PASO-4-ESCALABILIDAD.md`.

Todo ADITIVO, todo DEFAULT-OFF (excepto PRAGMA tuning que es ON con
rollback inmediato), todo ROLLBACK quirúrgico, todo COMPATIBLE con
identity+memberships+immersive existentes.
