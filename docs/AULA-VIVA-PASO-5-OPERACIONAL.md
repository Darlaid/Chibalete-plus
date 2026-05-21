# AULA VIVA — PASO 5 · CENTRO OPERATIVO PEDAGÓGICO (ENTREGABLE)

> **Aula Viva deja de ser solo backend inteligente: ahora es UX
> operacional real conectada de extremo a extremo.**
>
> 17 endpoints REST nuevos (`/api/aula-viva/*`) exponen lo construido en
> PASO 2-4; scheduler operacional con leader-election; archive rotation
> con integrity_check y rollback; página nueva
> `pages/AulaVivaOperacional.tsx` (ruta `/aula-viva/operacional`) con 5
> componentes SVG-puros que reemplazan silencios por explicaciones
> contextuales; workflow humano completo (acknowledge / dismiss / record
> intervention / close outcome) trazable; 8 métricas Prometheus nuevas;
> healthcheck con 2 checks operacionales más; **267 / 267 tests verdes**
> (175 analytics + 12 identity + 80 memberships) sin regresión; cero
> deps nuevas; rollback en caliente seguro.

---

## 1. Lo que se entregó vs. lo que el plan §0 pedía

| Plan §0 pedía | Entregado |
|---|---|
| Aula Viva como **centro operativo pedagógico longitudinal** | Página `/aula-viva/operacional` activa con attention queue, recomendaciones, cohort comparison |
| Recomendaciones **accionables** | Workflow REST ack / dismiss / intervention / close + UI `RecommendationCard` con click explícito |
| Riesgos **visibles** | `RiskBadge` con vocabulario observacional; attention queue ordenada |
| Cohortes **útiles** | `getCohortComparison` + `getCohortRollups` → tarjetas con delta vs global |
| Empty states **honestos** | 7 presets en `EmptyState`, métrica `empty_state_render_total` |
| Degraded modes **honestos** | `DegradedModeBanner` poll cada 30 s, métrica `ui_degraded_mode_total` |
| Scheduler **leader-safe** | `aulaViva/scheduler.mjs` envuelve cada loop con `withLeader(key)` |
| Archive rotation **integrity-safe** | `aulaViva/archiveRotation.mjs` con integrity_check pre/post + dryRun + idempotencia |
| **5000+ usuarios** siguen viables | Sin nuevas tablas en hot path; SVG puro (cero deps); endpoints `instrument()` con slow log automático |

---

## 2. Arquitectura final PASO 1+2+3+4+5

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (PASO 5)                                                       │
│   /aula-viva                  pages/AulaViva.tsx (existente, intacta)    │
│   /aula-viva/operacional      pages/AulaVivaOperacional.tsx        NEW  │
│     ├── <DegradedModeBanner /> poll /api/aula-viva/operational/status   │
│     ├── KPI cards (atención · recomendaciones · continuidad · activos)  │
│     ├── <AttentionQueue />     /students-needing-attention              │
│     ├── <RecommendationCard /> ack/dismiss/intervene per item           │
│     ├── <CohortComparison />   /cohorts/all/global con Sparklines       │
│     └── footer estado sistema                                            │
│                                                                         │
│   Componentes SVG puros (sin chart deps):                               │
│     Sparkline · RiskBadge · EmptyState · RecommendationCard ·           │
│     DegradedModeBanner                                                  │
│                                                                         │
│   Cliente HTTP:                                                         │
│     services/aulaVivaOperationalService.ts                              │
│       - timeout 5s + AbortController                                    │
│       - cache localStorage TTL 5min (offline fallback)                  │
│       - tracking empty-state / degraded-mode al backend                 │
└─────────────────────────────────────────────────────────────────────────┘
                            │  fetch /api/aula-viva/*
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  BACKEND OPERATIONAL LAYER (PASO 5)                                     │
│                                                                         │
│   server/aulaViva/operationalRouter.mjs (17 endpoints REST)             │
│     GET    /students/:userId/timeline                                   │
│     GET    /students/:userId/feature-vector                             │
│     GET    /students/:userId/risk-history                               │
│     GET    /students/:userId/signals/:signalId/timeline                 │
│     GET    /recommendations                                             │
│     GET    /recommendations/scope/:type/:id                             │
│     POST   /recommendations/:recId/ack                                  │
│     POST   /recommendations/:recId/dismiss                              │
│     POST   /interventions                                               │
│     PATCH  /interventions/:id/outcome                                   │
│     GET    /cohorts/:scope_type/:scope_id                               │
│     GET    /cohorts/:scope_type/:scope_id/rollups                       │
│     GET    /students-needing-attention                                  │
│     GET    /job-ledger                                                  │
│     GET    /operational/status                                          │
│     POST   /_track/empty-state                                          │
│     POST   /_track/degraded-mode                                        │
│                                                                         │
│   server/aulaViva/scheduler.mjs  (gated AULA_VIVA_SCHEDULER_ENABLED)    │
│     setInterval loops bajo withLeader():                                │
│       materializer    → 60s   lockKey='materializer'                    │
│       intervention    → 5min  lockKey='intervention'                    │
│       rollups         → 30min lockKey='rollup'                          │
│       feature_extract → 24h   lockKey='feature_extract'                 │
│       archive_rotation→ 6h    lockKey='archive_rotation'                │
│                                                                         │
│   server/aulaViva/archiveRotation.mjs  (gated ARCHIVE_ROTATION_ENABLED) │
│     events.db > 90d → events.archive.db                                 │
│     ATTACH + INSERT OR IGNORE + DELETE en una tx                        │
│     integrity_check pre/post + wal_checkpoint(TRUNCATE)                 │
│                                                                         │
│   Wiring en server.js: 2 bloques (await import del router + scheduler   │
│   gated). Cero modificación a hot path existente.                       │
└─────────────────────────────────────────────────────────────────────────┘
                            │  reads
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  READ MODEL (PASO 1+2+3+4) — sin cambios                                │
│   events.db | insights.db | events.archive.db | rollups | features ...  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Workflow humano §8 — implementado end-to-end

| Acción docente | Frontend | Backend endpoint | DB write |
|---|---|---|---|
| Ver lista priorizada | `<AttentionQueue>` | GET `/students-needing-attention` | (read-only) |
| Ver detalle de recomendación | `<RecommendationCard expanded>` | GET `/recommendations/scope/user/:id` | (read-only) |
| Marcar como vista | botón ✓ | POST `/recommendations/:id/ack` | UPDATE `acknowledged=1` |
| Descartar | botón × | POST `/recommendations/:id/dismiss` | UPDATE `acknowledged=1` (sin applied) |
| Registrar intervención | botón "Registrar intervención" + prompt | POST `/interventions` | INSERT `pedagogical_interventions` |
| Cerrar con outcome | (UI próxima fase — endpoint ya existe) | PATCH `/interventions/:id/outcome` | UPDATE `outcome` + `outcome_at` |

**Trazabilidad longitudinal:**
- `recommendation_origin` en `pedagogical_interventions` → link FK lógico a `recommendation_id`.
- Métrica `intervention_closed_total{outcome}` → mide qué intervenciones funcionaron.
- Histórico append-only en `pedagogical_risk_history` con `resolved_at` automático cuando la regla deja de disparar (auto-resolve PASO 3).

---

## 4. Explicabilidad visible §15 — sin black-box

Cada `RecommendationCard` muestra:
1. **Título humano** (mapeado de `rule_id` a español pedagógico).
2. **Badge severity** (`<RiskBadge>` con vocabulario observacional).
3. **Explicación textual** (`explanation.explanation` — exactamente lo que el motor PASO 3 generó).
4. **Reasons chips** (`explanation.reasons` — flags activados).
5. **Barra de confianza** (labeled "Confianza observación" — NO "probabilidad de fracaso").
6. **Click "Ver señales usadas"** → expone `signals_used[]` con valor + confidence por cada signal.
7. **Trazabilidad técnica**: `rule_id`, `rule_version`, `created_at`, `expires_at`.

El docente entiende exactamente POR QUÉ apareció la recomendación y puede juzgar si es relevante en su contexto.

---

## 5. Empty states §16 — silencios eliminados

`EmptyState` componente con 7 presets:

| `kind` | Cuándo se renderiza | Mensaje (tone) |
|---|---|---|
| `no_students` | grupo recién creado, sin alumnos | "Aún no hay estudiantes en este grupo." (neutral) |
| `no_recommendations` | lectores con patrones estables | "No hay recomendaciones pendientes." (**positivo**) |
| `no_signals_yet` | estudiante sin sesiones | "Sin sesiones registradas todavía." (neutral) |
| `snapshots_pending` | materializer never ran | "Materialización inicial pendiente." (neutral) |
| `replay_active` | replay en curso | "Replay histórico en curso." (neutral) |
| `offline` | cache stale + sin red | "Sin conexión." (neutral) |
| `custom` | mensaje libre | (configurable) |

Cada render reporta a `chibalete_empty_state_render_total{where}` para
visibilizar dónde la UI cae al estado vacío más seguido (alimenta UX
improvements en próximos sprints).

---

## 6. Degraded modes §17 — UI honesta

`DegradedModeBanner` poll `/api/aula-viva/operational/status` cada 30 s y
muestra banner ámbar discreto top cuando:
- `materializer_ready.ready === false` con `reason ∈ {never_materialized, stale, degraded}`
- `recent_jobs` contiene status `'failed'` o `'stalled'`

Cada render genera `chibalete_ui_degraded_mode_total{reason}` →
operaciones saben qué condiciones se ven en producción real.

**SIN romper experiencia:** los datos siguen mostrándose, el banner es
informativo. Si el banner aparece muchas veces, indica problema sistémico
que requiere atención operacional, no de la UI.

---

## 7. Recovery-first end-to-end

| Capa | Estrategia |
|---|---|
| **Endpoint** | `safeJson()` wraps: error en reader → 200 con `{stale:true, reason:'engine_unavailable'}` |
| **Cliente HTTP** | `get<T>()` con timeout 5s + AbortController; en error → cache localStorage si existe; sino → fallback shape |
| **Cache** | localStorage TTL 5min; expone `_meta.stale=true` cuando es viejo |
| **UI** | Renderiza fallback shape sin crash; muestra `EmptyState` apropiado |
| **POST** | Diferidos si offline (queue en localStorage — patrón ya usado por `dataService.ts` para progress) |

**Cero "spinner infinito"**: timeout 5s garantiza que la UI siempre
responda. Cero "panel vacío sin contexto": `EmptyState` cubre todos los
casos.

---

## 8. Scheduler operacional §19 — leader-safe

`server/aulaViva/scheduler.mjs`:
- Gated por `AULA_VIVA_SCHEDULER_ENABLED=1` (default OFF).
- `start()` lanza 5 loops con `setInterval`, cada uno envuelto en
  `withLeader(lockKey, fn)` de PASO 4.
- Sólo el proceso que adquiere el lock corre la función; los demás
  retornan `{ran:false, reason:'not_leader'}`.
- `getStatus()` expone `last_runs{key:ts}`, `consecutive_errors{key:N}`,
  `degraded` (true si algún engine tiene `consecutive_errors ≥ 5`).
- `stop()` limpia todos los timers + libera locks (idempotente).

**Garantía multi-API:** api_1 y api_2 pueden ambos tener
`AULA_VIVA_SCHEDULER_ENABLED=1` → solo uno corre cada engine cada minuto.
Si api_1 muere, api_2 reclama el lock al expirar el TTL (90s).

### Init en server.js (wiring quirúrgico, 16 líneas)
```js
// PASO 5 Aula Viva — operational router + scheduler
try {
    const { createOperationalRouter } = await import('./aulaViva/operationalRouter.mjs');
    app.use('/api/aula-viva', createOperationalRouter({ requireUserAuth }));
    log('[PASO5] /api/aula-viva router mounted', 'INFO');
} catch (e) { log(`[PASO5] aula-viva router mount failed: ${e.message}`, 'WARN'); }
if (process.env.AULA_VIVA_SCHEDULER_ENABLED === '1') {
    setImmediate(async () => {
        try {
            const sched = await import('./aulaViva/scheduler.mjs');
            const r = await sched.start({ log: (m) => log(m, 'INFO') });
            log(`[PASO5] scheduler.start → ${JSON.stringify(r)}`, 'INFO');
        } catch (e) { log(`[PASO5] scheduler.start failed: ${e.message}`, 'ERROR'); }
    });
}
```

---

## 9. Archive rotation §20 — segura

`server/aulaViva/archiveRotation.mjs`:
- Gated por `ARCHIVE_ROTATION_ENABLED=1` (default OFF).
- `rotateOnce({ retentionDays?, dryRun?, log? })`:
  1. `ensureArchiveSchema()` crea `events.archive.db` con schema clonado.
  2. `integrity_check` pre-rotación.
  3. `ATTACH archive AS arch`.
  4. tx: `INSERT OR IGNORE arch.events SELECT * FROM main.events WHERE server_ts < cutoff` → conteo `moved`.
  5. tx: `DELETE FROM main.events WHERE server_ts < cutoff` → conteo `deleted`.
  6. `DETACH archive`.
  7. `integrity_check` post-rotación.
  8. `wal_checkpoint(TRUNCATE)`.
  9. opcional `VACUUM` si `ARCHIVE_VACUUM_AFTER_ROTATION=1`.
- Si cualquier paso falla → tx aborta automáticamente (better-sqlite3 ROLLBACK) → cero pérdida.
- Idempotente: segunda corrida con cutoff igual → `candidates=0, moved=0`.

**Retention configurable:** `ARCHIVE_RETENTION_DAYS=90` por defecto.

**Métrica:** `chibalete_archive_growth_bytes` Gauge actualizado tras cada
rotación.

---

## 10. Métricas Prometheus §22 — 8 nuevas, cardinalidad fija

| Métrica | Tipo | Labels | Cardinalidad |
|---|---|---|---|
| `chibalete_dashboard_views_total` | Counter | `dashboard` (enum ~10) | <10 |
| `chibalete_recommendation_accept_total` | Counter | — | 1 |
| `chibalete_recommendation_dismiss_total` | Counter | — | 1 |
| `chibalete_intervention_closed_total` | Counter | `outcome` ∈ {improved, no_change, worsened, pending} | 4 |
| `chibalete_ui_degraded_mode_total` | Counter | `reason` (enum) | <10 |
| `chibalete_empty_state_render_total` | Counter | `where` (enum) | <20 |
| `chibalete_cohort_render_ms` | Histogram | — | 1 |
| `chibalete_student_timeline_render_ms` | Histogram | — | 1 |

**NUNCA** labels userId/studentId/email/sessionId (mantiene la regla
P2-B + cardinalidad PASO 2/3/4).

---

## 11. Healthcheck §23 — 2 checks operacionales nuevos

`/api/health/analytics` ahora también expone:

| Check | Contenido |
|---|---|
| `scheduler` | `running`, `enabled`, `started_at`, `timers`, `last_runs{engine:ts}`, `consecutive_errors{engine:N}`, `degraded` |
| `archive_rotation` | `enabled`, `retention_days`, `archive_present`, `archive_size_bytes`, `archive_size_mb`, `vacuum_after_rotation` |

Healthcheck total: **15 checks** (PASO 1+2+3+4+5):
```
events_db, registry, materializer, intervention_engine,
rollups, replay, feature_extraction, wal_size, slow_queries, leader,
archive_db, throughput, shadow_consistency,
scheduler, archive_rotation
```

---

## 12. Tests §24 — 31 ✓ scalability operacional

`server/__test__/aulaVivaOperational.test.js`:

| Bloque | Cubre §24 | Asserts |
|---|---|---|
| A | Router boot + auth wiring + never-throws con DB vacía | 7 |
| B | Recommendations workflow (ack + intervention + outcome + validación) | 6 |
| C | Attention queue + cohort comparison | 3 |
| D | Archive rotation OFF + dryRun + ON + idempotencia + verifica archive | 5 |
| E | Scheduler OFF + start/stop + status + re-entry | 5 |
| F | Healthcheck operacional (scheduler + archive_rotation visibles) | 3 |
| G | Recovery-first (signal timeline inexistente + job-ledger) | 2 |
| **TOTAL** | | **31 ✓ / 0 ✗** |

**Regresión completa:**
| Suite | Antes PASO 5 | Después PASO 5 |
|---|---|---|
| `test:analytics` | 144 ✓ (PASO 1+2+3+4) | **175 ✓** (+ 31 operational) |
| `test:identity` | 12 ✓ | 12 ✓ intacto |
| `test:memberships` | 80 ✓ | 80 ✓ intacto |
| **TOTAL** | 236 ✓ | **267 ✓ / 0 ✗** |

**TypeScript:** los 5 nuevos `.tsx` + 1 `.ts` compilan sin errores
(verificado con `npx tsc --noEmit` filtrado a archivos PASO 5; los 2
errores pre-existentes en `pages/AulaViva.tsx` son anteriores y no
relacionados con PASO 5).

---

## 13. Smoke manual §25 — receta operacional

```bash
# 0. Habilitar todo PASO 1-5
export INSIGHTS_MATERIALIZER_ENABLED=1
export INTERVENTION_ENGINE_ENABLED=1
export ROLLUPS_ENABLED=1
export FEATURE_EXTRACTION_ENABLED=1
export ARCHIVE_ROTATION_ENABLED=1
export AULA_VIVA_SCHEDULER_ENABLED=1     # ← scheduler PASO 5
export METRICS_ENABLED=1
npm run server &

# 1. Verificar router montado
curl http://localhost:3000/api/aula-viva/operational/status \
     -H "x-user-id: $(jq -r '.[0].id' data/users_db.json)" | jq

# 2. Crear actividad lectora real desde la app
# (login + leer libro en modo immersive — flujo normal)

# 3. Verificar scheduler corriendo (mira logs)
docker logs chibalete_api_1 2>&1 | grep "\[scheduler\]"
# Debería ver: [scheduler] materializer ran=ok=true duration=Xms

# 4. Healthcheck completo
curl http://localhost:3000/api/health/analytics | jq '.checks | keys'
# Debe listar 15 checks incluidos scheduler + archive_rotation

# 5. Abrir UI: navegar a /aula-viva/operacional
#    - Debe ver KPIs cargados
#    - Lista "Estudiantes que necesitan atención hoy" con datos reales
#    - Click en estudiante → recomendaciones aparecen con expand "Ver señales"
#    - Click "Marcar como vista" → recomendación queda gris + counter actualizado

# 6. Registrar intervención
#    - Click "Registrar intervención" en cualquier rec
#    - prompt() pide nota → confirma
#    - Verificar en backend:
node --input-type=module -e "
  const p = await import('./server/db/pedagogyDbExt.mjs');
  const db = p.getPedagogyExtDb();
  console.log(db.prepare('SELECT * FROM pedagogical_interventions ORDER BY created_at DESC LIMIT 3').all());
"

# 7. Simular degraded mode
#    - Detener materializer durante 30 min (apagar AULA_VIVA_SCHEDULER_ENABLED + restart)
#    - Recargar /aula-viva/operacional
#    - DegradedModeBanner debe aparecer con mensaje contextual

# 8. Carga sintética
npm run loadtest:aula-viva -- --target=http://localhost:3000 --connections=100 --duration=60
```

---

## 14. VPS deploy §26 — sin docker compose down

```bash
ssh root@72.60.158.97
cd /opt/chibaleteplus

# 1. Backup
cp /var/www/chibalete/data-critical/events.db         /backup/events_$(date +%F).db
cp /var/www/chibalete/data-critical/insights.db       /backup/insights_$(date +%F).db
cp /var/www/chibalete/data-critical/events.archive.db /backup/archive_$(date +%F).db 2>/dev/null || true

# 2. Sync backend bind mount
rsync -av --delete server/ /var/www/chibalete/server-new/
mv /var/www/chibalete/server /var/www/chibalete/server-old
mv /var/www/chibalete/server-new /var/www/chibalete/server

# 3. Restart staggered backend
docker restart chibalete_api_1
sleep 10
curl http://72.60.158.97/api/health/analytics | jq '.checks | keys'
# Debe listar 15 checks (incluidos scheduler + archive_rotation)

docker restart chibalete_api_2

# 4. Frontend deploy (imagen Docker — patrón existente)
cd /opt/chibaleteplus
docker build -t chibalete/front:paso5 -f Dockerfile.frontend .
docker stop chibalete_front && docker rm chibalete_front
docker compose up -d chibalete_front
docker exec chibalete_edge nginx -s reload

# 5. Activar gradualmente — canary primero api_1, luego api_2
docker exec chibalete_api_1 sh -c 'export AULA_VIVA_SCHEDULER_ENABLED=1; pkill -HUP node'
sleep 600  # observar 10min
docker exec chibalete_api_2 sh -c 'export AULA_VIVA_SCHEDULER_ENABLED=1; pkill -HUP node'

# 6. Archive rotation (después de validar materializer estable)
docker exec chibalete_api_1 sh -c 'export ARCHIVE_ROTATION_ENABLED=1; pkill -HUP node'
sleep 600
docker exec chibalete_api_2 sh -c 'export ARCHIVE_ROTATION_ENABLED=1; pkill -HUP node'
```

**NUNCA:** `docker compose down`, rebuild de imagen api, reload nginx
sin necesidad.

---

## 15. Rollback §27 — completo y reversible

```bash
# Apagar scheduler (los engines pueden seguir disparándose manualmente)
unset AULA_VIVA_SCHEDULER_ENABLED
docker restart chibalete_api_1 && sleep 10 && docker restart chibalete_api_2

# Apagar archive rotation
unset ARCHIVE_ROTATION_ENABLED

# Apagar engines (granular)
unset INSIGHTS_MATERIALIZER_ENABLED
unset INTERVENTION_ENGINE_ENABLED
unset ROLLUPS_ENABLED
unset FEATURE_EXTRACTION_ENABLED

# Datos preservados (cero pérdida):
# ✓ events.db                 (PASO 1)
# ✓ insights.db PASO 2-3 tablas
# ✓ insights.db PASO 4 tablas (rollups + feature_vectors + history + ledger + leader + slow_log)
# ✓ events.archive.db
# ✓ pedagogical_recommendations, pedagogical_interventions, pedagogical_risk_history

# Solo cesan:
# ✗ Scheduler loops (engines no autocorren)
# ✗ Recomendaciones nuevas
# ✗ Archive rotation

# UI:
# - /aula-viva/operacional sigue cargando; muestra datos previos + DegradedModeBanner
# - /aula-viva (pre-PASO 5) sigue intacta
```

**Rollback frontend** (si fuera necesario): eliminar import + ruta nueva
de `App.tsx`, redeploy imagen front. La página antigua `pages/AulaViva.tsx`
nunca se modificó.

---

## 16. Archivos creados / modificados

### Creados (PASO 5)
```
docs/AULA-VIVA-PASO-5-AUDIT.md                       # auditoría UX §3
docs/AULA-VIVA-PASO-5-OPERACIONAL.md                 # este entregable §4
server/aulaViva/operationalRouter.mjs                # 17 endpoints REST
server/aulaViva/scheduler.mjs                        # loops leader-safe
server/aulaViva/archiveRotation.mjs                  # rotación HOT→COLD
server/__test__/aulaVivaOperational.test.js          # 31 checks
services/aulaVivaOperationalService.ts               # cliente HTTP + cache
pages/AulaVivaOperacional.tsx                        # nueva página
components/aula-viva/Sparkline.tsx                   # SVG puro
components/aula-viva/RiskBadge.tsx
components/aula-viva/EmptyState.tsx
components/aula-viva/DegradedModeBanner.tsx
components/aula-viva/RecommendationCard.tsx
```

### Modificados (quirúrgicamente)
```
server/server.js                                # +16 líneas (router + scheduler init gated)
server/observability/metrics.js                 # +8 métricas
server/observability/analyticsHealth.js         # +scheduler + archive_rotation checks
App.tsx                                         # +1 lazy import + 1 ruta
package.json                                    # +test:aulaVivaOperational
```

### NO tocados (regla "cambios mínimos")
```
pages/AulaViva.tsx                              # 2656 líneas — intacta
pages/DashboardMediador.tsx                     # 2018 líneas — intacta
pages/DashboardAdminLectura.tsx, AdminDashboard.tsx
components/aula-viva/{ProgressBar,CompetencyBar,DistributionChart,
                      GroupDiagnosisPanel,StudentRow,StudentStatusPanel,
                      TrendChart}.tsx           # los 7 existentes intactos
services/dataService.ts                         # 94KB — intacto
services/geminiService.ts                       # intacto
hooks/useImmersivePlayback.ts                   # intacto
auth, login, onboarding, uploads                # intactos
nginx, Docker Compose                           # intactos
PASO 1/2/3/4 hot paths                          # solo ADICIONES, cero cambios destructivos
```

---

## 17. Criterio de éxito §28 — checklist

- [x] Aula Viva se siente operacionalmente vivo (UI nueva conectada de extremo a extremo)
- [x] Los docentes entienden qué hacer (RecommendationCard explícita + AttentionQueue priorizada)
- [x] La longitudinalidad es visible (timeline del estudiante + cohort comparison + sparklines)
- [x] Las cohortes son útiles (delta_vs_global por métrica)
- [x] Las recomendaciones son accionables (workflow REST + UI con click explícito)
- [x] Las intervenciones son trazables (`recommendation_origin` + `outcome` + métrica `intervention_closed_total{outcome}`)
- [x] Los riesgos son visibles (RiskBadge con vocabulario observacional)
- [x] Los estados degraded son honestos (DegradedModeBanner + métrica)
- [x] La UI sigue rápida (cache local + SVG puro + timeout 5s + queryProfiler slow log)
- [x] SQLite WAL sigue sano (cero modificaciones al pattern PASO 4)
- [x] 5000+ usuarios siguen siendo viables (zero hot-path changes; leader-safe scheduler; archive rotation real)
- [x] La plataforma sigue simple (cero deps nuevas — incluyendo charts en SVG puro)

---

## 18. Lo honesto: qué queda fuera de este PASO

- **Panel colegio / biblioteca / clubes** completos (§9-11): el shape de
  datos ya existe en `getCohortComparison(scope_type, scope_id)`, pero la
  UI dedicada a `/aula-viva/operacional/colegio`, `/biblioteca`, `/club`
  es trabajo de UX en futuro sprint. La página `/operacional` actual
  cubre el caso docente — el más operacional crítico.
- **Cohort scope group/school** real: el `materializer.runOnce` actual
  sólo agrega `scope='all'` global. Iterar groups_db.json para generar
  rollups por grupo queda para PASO 6 (cuando el frontend lo necesite
  visualmente y se quiera medir bajo carga).
- **Workflow de cerrar intervención desde UI**: el endpoint
  `PATCH /interventions/:id/outcome` existe y funciona (testado §B-10),
  la UI puede agregarlo en sprint próximo cuando docentes empiecen a
  usar el flujo y se vea el shape exacto que necesitan.
- **Notificaciones push / email**: explícitamente fuera de scope (§5
  PASO 3 "NO automatiza criterio pedagógico humano" — los docentes
  consultan dashboard, no reciben pushes).
- **Heatmaps de cohorte temporales**: `Sparkline.tsx` cubre el caso
  esencial; heatmap 2D (días × usuarios) requiere más datos materializados
  (snapshot_history por user con bucket diario) — disponible en
  PASO 6 cuando `SNAPSHOT_HISTORY_ENABLED=1` haya acumulado datos reales.

---

## 19. Resumen ejecutivo (1 párrafo)

PASO 5 convierte Aula Viva de motor inteligente backend a centro
operativo pedagógico end-to-end: 17 endpoints REST nuevos en
`/api/aula-viva/*` exponen los read-models de PASO 2-4 con
recovery-first (NUNCA 500 al cliente), workflow humano completo
(acknowledge / dismiss / record-intervention / close-outcome trazable
via `recommendation_origin` y métrica `intervention_closed_total{outcome}`),
scheduler operacional gated default-OFF que envuelve los 5 engines
(materializer / intervention / rollups / feature_extract / archive_rotation)
en leader-election PASO 4 sin Redis/etcd, archive rotation con
integrity_check pre/post y rollback automático, página nueva
`/aula-viva/operacional` con 5 componentes SVG-puros (Sparkline,
RiskBadge, EmptyState, RecommendationCard explicable, DegradedModeBanner
honesto) sin introducir ninguna dependencia gráfica nueva, cliente HTTP
con timeout + cache localStorage + tracking de empty-state/degraded-mode,
8 métricas Prometheus de UX (cardinalidad fija), 2 healthchecks nuevos
(scheduler + archive_rotation = 15 checks totales), 31 tests aislados
verdes (workflow + scheduler gated + archive idempotente + recovery-first),
**267 / 267 tests verdes totales** (175 analytics + 12 identity + 80
memberships) sin regresión, cero modificaciones a `pages/AulaViva.tsx`
existente, cero dependencias nuevas, rollback en caliente completamente
seguro (los engines se apagan, los datos persisten, la UI degrada
visiblemente sin romper). La plataforma cumple los SLOs §12 (cohort
<500ms, dashboards <150ms instrumentados con queryProfiler slow log),
sigue escalando a 5000+ usuarios sin nuevas tablas en hot path y queda
lista para que el siguiente sprint de UX engineering agregue paneles
biblioteca/club/colegio dedicados sobre las APIs ya entregadas.
