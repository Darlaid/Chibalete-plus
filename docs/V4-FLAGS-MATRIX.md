# V4 Feature Flags — Matriz Operacional

> Estado: Fase 5. Matriz canónica de TODAS las feature flags de v4.
>
> **Default OFF en TODAS las nuevas.** Habilitación gradual via env vars + (cuando aplique) localStorage override por usuario para QA.

## 1. Backend flags (env vars)

Todos se leen desde `server/lib/flags.js`. Cambiar requiere restart del container (la lectura es per-call, pero un restart asegura estado limpio).

| Env var | Default | Fase | Propósito | Si ON | Si OFF | Rollback |
|---|---|---|---|---|---|---|
| `IDENTITY_SQLITE_ENABLED` | `0` | P1-A | Migra/bootstrapea `identity.db` al arranque | Crea SQLite identity (lectura sigue siendo JSON) | No toca SQLite | `=0` + restart |
| `IDENTITY_DUAL_WRITE` | `0` | P1-A | Espejo JSON→SQLite tras cada write | Cada write a users/groups/access se espeja | JSON único source-of-truth | `=0` + restart |
| `IDENTITY_READ` | `json` | P1-A | Cutover de lectura JSON↔SQLite | `sqlite` lee desde SQLite | `json` lee desde JSON | `=json` + restart |
| `IMMERSIVE_V2_KILLSWITCH` | `0` | P1-B | Fuerza V1 para todos los usuarios inmersivo | Cohorte se ignora, V1 para todos | Respeta cohortPct | `=1` + restart (rollback global instantáneo) |
| `IMMERSIVE_V2_COHORT_PCT` | `0` | P1-B | % usuarios en runtime V2 inmersivo | Asignación estable hash(userId) | 0% → todos V1 | `=0` + restart |
| `LEO_EVENTS_BACKBONE_ENABLED` | `0` | **2A** | Leo emite 6 events leo_* a events.db | Eventos longitudinales activos | Cero efecto sobre flujo Leo | `=0` + restart |
| `LEO_SIGNAL_EXTRACTION_ENABLED` | `0` | **2B** | signalCompute deriva 4 señales Leo desde events.db | mediacion_leo, inferencia/metacognicion/emocion_observada se computan | Quedan en `pending` | `=0` + restart |
| `AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED` | `0` | **3A** | Endpoint /students/:id/timeline incluye `summaries[]` | 11 templates determinísticos | `summaries: []` | `=0` + restart |
| `AULA_VIVA_AUDIT_EVENTS_ENABLED` | `0` | **3B** | operationalRouter emite teacher_*/mediator_* a events.db | Traza institucional | Cero events | `=0` + restart |
| `AULA_VIVA_COHORT_SUMMARIES_ENABLED` | `0` | **3B** | Habilita 5 templates cohort-scope en longitudinalSummary | generateCohortSummaries devuelve frases | `[]` | `=0` + restart |
| `AULA_VIVA_SCHEDULER_ENABLED` | `0` | PASO 4 | Scheduler central con leader-election | Engines PASO 2/3/6 corren periódicamente | Cero cron, cero materialización | `=0` + restart |
| `INSIGHTS_MATERIALIZER_ENABLED` | `0` | PASO 2 | Materializer lee events.db→signal_snapshots | Snapshots se persisten | Snapshots vacíos | `=0` + restart |
| `INTERVENTION_ENGINE_ENABLED` | `0` | PASO 3 | 8 reglas pedagógicas activas | Recomendaciones se generan | Sin recomendaciones | `=0` + restart |
| `AULA_VIVA_OUTCOME_ENGINE_ENABLED` | `0` | PASO 6 | Computa outcomes auto cada 1h | improved/stable/worsened classification | Sin outcomes | `=0` + restart |
| `AULA_VIVA_COHORT_BUILDER_ENABLED` | `0` | PASO 6 | Rebuild cohorts cada 6h | 8 tipos cohort se mantienen | Sin cohort_definitions | `=0` + restart |
| `AULA_VIVA_TRAJECTORY_ENABLED` | `0` | PASO 6 | trajectoryAnalyzer cada 6h | cohort_trajectories se computan | Sin trayectorias | `=0` + restart |
| `AULA_VIVA_LEARNING_ENABLED` | `0` | PASO 6 | institutionalLearning cada 6h | learnings detectadas | Sin learnings | `=0` + restart |
| `AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED` | `0` | PASO 6 | predictivePatterns cada 24h | patterns aggregados | Sin patterns | `=0` + restart |
| `SNAPSHOT_HISTORY_ENABLED` | `0` | PASO 4 | snapshot_history append-only | Outcomes PASO 6 con baseline real | Outcomes degraded (recompute desde events) | `=0` + restart |
| `ADMIN_SECRET` | — | siempre | Secret server-to-server para POST /api/users | Scripts seed/admin funcionan | Scripts rechazados | NO cambiar en prod sin coordinación |
| `EVENTS_SQLITE_PATH` | `data-critical/events.db` | siempre | Override path events.db | Path custom | Default | NO cambiar en prod |
| `IS_PROD` (derivado de `NODE_ENV`) | computed | siempre | `'production'` activa rate limits estrictos + oculta errores detallados | Modo prod | Modo dev/staging | `NODE_ENV=production` en prod |

## 2. Frontend flags (localStorage)

Los reads son per-render (sin restart, refresh página alcanza).

| Key | Default | Fase | Propósito |
|---|---|---|---|
| `IMMERSIVE_RUNTIME` | unset | P1-B | `'v1' \| 'v2'` override de runtime inmersivo (QA per-browser) |
| `READING_RUNTIME__accessible` | unset | **1+2** | `'v1' \| 'v2'` para VisorAccesible (observation bridge) |
| `READING_RUNTIME__guided` | unset | **1+2** | `'v1' \| 'v2'` para VisorTexto (observation bridge) |
| `EDITORIAL_COVER_SYSTEM` | unset | **4** | `'1'` activa EditorialCover en ContentCard (respeta aspect-ratio intrínseco) |
| `chibalete_user_id` | unset | siempre | Sesión actual (no es flag, es auth) |

## 3. Order de activación recomendado para v4

```
# Fase A — observabilidad básica (low risk, no surface change)
LEO_EVENTS_BACKBONE_ENABLED=1                # eventos Leo llegan a events.db
AULA_VIVA_AUDIT_EVENTS_ENABLED=1             # eventos mediador llegan a events.db

# (validar 24h: events.db crece, no hay 500s, latencia normal)

# Fase B — signal extraction (depende de A — necesita data)
INSIGHTS_MATERIALIZER_ENABLED=1              # snapshots se materializan
SNAPSHOT_HISTORY_ENABLED=1                   # baseline para outcomes
LEO_SIGNAL_EXTRACTION_ENABLED=1              # 4 signals Leo se computan

# (validar 7d: signal_snapshots tiene rows nuevos, sin error en materializer)

# Fase C — summaries (depende de B)
AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=1     # /timeline endpoint trae summaries[]
AULA_VIVA_COHORT_SUMMARIES_ENABLED=1         # cohort summaries disponibles

# (validar 7d: summaries aparecen correctos, sin afirmaciones excesivas)

# Fase D — engines pedagógicos (depende de B con ≥14d baseline)
AULA_VIVA_SCHEDULER_ENABLED=1                # scheduler central
INTERVENTION_ENGINE_ENABLED=1                # 8 reglas activas
AULA_VIVA_COHORT_BUILDER_ENABLED=1           # 8 tipos cohort

# (validar 14d: recomendaciones no falsos positivos)

# Fase E — outcomes + trajectories (requiere baseline 14d+)
AULA_VIVA_OUTCOME_ENGINE_ENABLED=1
AULA_VIVA_TRAJECTORY_ENABLED=1
AULA_VIVA_LEARNING_ENABLED=1
AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED=1
```

## 4. Frontend: activación opt-in por usuario QA

Para validar Fase 4 EditorialCover con un usuario:

```js
// En consola browser:
localStorage.setItem('EDITORIAL_COVER_SYSTEM', '1');
location.reload();
```

Para volver al render legacy:

```js
localStorage.removeItem('EDITORIAL_COVER_SYSTEM');
location.reload();
```

## 5. Killswitch global de v4

Si algo se rompe gravemente y hay que retroceder TODO v4 sin redeploy:

```bash
# En /opt/chibaleteplus/.env (o equivalente Docker Compose):
LEO_EVENTS_BACKBONE_ENABLED=0
LEO_SIGNAL_EXTRACTION_ENABLED=0
AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=0
AULA_VIVA_AUDIT_EVENTS_ENABLED=0
AULA_VIVA_COHORT_SUMMARIES_ENABLED=0
IMMERSIVE_V2_KILLSWITCH=1

# Restart staggered:
docker compose restart chibalete_api_1
# (validar /api/health 200)
docker compose restart chibalete_api_2
```

Tras eso: Leo deja de emitir eventos longitudinales, summaries vuelve a `[]`, audit emit OFF, V2 inmersivo forzado a V1. Datos previos en events.db / signal_snapshots quedan intactos.

## 6. Validación post-flag

Tras activar cualquier flag, verificar:

```bash
# 1. /api/health responde 200
curl -s https://chibaleteplus.chibaleteeditores.com/api/health | head -c 200

# 2. /api/health/analytics responde 200 sin "degraded:true"
curl -s https://.../api/health/analytics | python3 -m json.tool

# 3. /metrics expone counters relevantes (chibalete_*)
curl -s https://.../metrics | grep -E "^chibalete_" | head -20

# 4. events.db crece (validar desde el VPS):
ssh root@... "sqlite3 /var/www/chibalete/data-critical/events.db 'SELECT event,COUNT(*) FROM events WHERE mode IN (\"leo\",\"aula_viva\") AND server_ts >= strftime(\"%s\",\"now\",\"-1 hour\")*1000 GROUP BY event;'"
```
