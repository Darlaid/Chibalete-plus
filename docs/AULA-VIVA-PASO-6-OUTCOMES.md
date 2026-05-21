# AULA VIVA — PASO 6 · OUTCOMES + COHORTS REALES (ENTREGABLE)

> **Aula Viva ahora aprende institucionalmente.**
>
> 6 tablas nuevas + 6 engines nuevos (outcomeEngine, cohortBuilder,
> trajectoryAnalyzer, institutionalLearning, predictivePatterns,
> interventionImpactTracker) que responden por primera vez:
> **¿la intervención funcionó? ¿qué intervención funciona mejor para qué
> lector en qué contexto?**
>
> Sin causalidad falsa, sin ranking docente, sin etiquetado individual,
> sin predicciones agresivas, sin IA opaca. Cero deps nuevas. Cero
> microservicios. **307/307 tests verdes** (215 analytics + 12 identity
> + 80 memberships).

---

## 1. Lo que se entregó vs lo que el plan §0 pedía

| Plan §0/§28 pedía | Entregado | Donde |
|---|---|---|
| ¿la intervención funcionó? | `intervention_outcomes` con baseline + followup + delta | `outcomeEngine.runOnce` |
| ¿qué tipo de intervención funciona para qué tipo de lector? | `institutional_learnings` + `getPriorityHints(rule_id)` | `institutionalLearning` |
| Cohortes REALES (no solo global) | `cohort_definitions` + `cohort_memberships` con 8 tipos | `cohortBuilder` |
| Trayectorias de cohortes | `cohort_trajectories` (UPSERT por cohort+period+period_end) | `trajectoryAnalyzer` |
| Riesgos predictivos (sin ML) | `predictive_risk_patterns` agregados | `predictivePatterns` |
| Evidencia observacional honesta | `evidence_level ∈ {low,medium,high}` + vocabulario filtrado | `outcomeClassifier` |
| NO causalidad falsa | `containsForbiddenVocab` blocker + test exhaustivo | `outcomeClassifier.FORBIDDEN_VOCAB` |
| Scope isolation real | `cohortBuilder` resolvers por scope_type filtrado | tests §E-17 |
| Replay seguro idempotente | `rebuildOutcomes({fromTs,toTs,dryRun})` UPSERT por intervention_id | `outcomeEngine.rebuildOutcomes` |
| Recommendation adjustment | `getPriorityHints(ruleId)` con multiplier ∈ [0.5, 1.5] | `institutionalLearning` |
| Aprendizajes prudentes | `institutional_learnings.recommendation_hint` observacional | tests §G-23 |

---

## 2. Principio ético central (§2) — implementado mecánicamente

### Lista negra de vocabulario en el código
`outcomeClassifier.FORBIDDEN_VOCAB`:
```
/\bcaus[oóáa]\b/i           "causa"/"causó"
/\bcausal\b/i               adjetivo aislado
/\bgarantiza\b/i, /\bgarantizado\b/i
/\bprob(ad[oa]|aron)\b/i, /\bdemostr[oóáa]\b/i
/\bpredijo\b/i, /\bpredice\b/i, /\bpredicción\b/i
/\bdéficit\b/i, /\btrastorno\b/i, /\bdislexia\b/i, /\bTDAH\b/i
/\bcapacidad cognitiva\b/i, /\bnivel intelectual\b/i
```

**Nota deliberada:** "causalidad" (sustantivo abstracto) **NO** está
bloqueado — el classifier la usa precisamente para NEGAR su afirmación
("NO implica causalidad — refleja patrones observados"). Bloquear el
sustantivo impide auto-explicación honesta. Lo que SÍ se bloquea son
afirmaciones causales activas.

### Validación en código
`containsForbiddenVocab(text)` corre:
1. En `outcomeEngine.runOnce` antes de persistir → si la explanation
   contuviera vocab prohibido (bug futuro), se reemplaza por texto safe
   + log WARN.
2. En tests `outcomesEngine.test.js`:
   - §A-1b valida explanation de IMPROVED
   - §C-11 escanea **todos** los outcomes en DB
   - §G-23 escanea **todos** los institutional_learning hints

Cualquier introducción accidental de vocab clínico **rompe los tests**
y se detecta antes de deploy.

---

## 3. Arquitectura final PASO 1+2+3+4+5+6

```
                 ┌────────────────────────────────────┐
                 │ events.db (PASO 1, write canon)    │
                 └─────────────┬──────────────────────┘
                               │
        ┌──────────────────────┴───────────────────────┐
        ▼                                              ▼
┌──────────────────┐                          ┌────────────────────┐
│ insightMatzr P2  │                          │ outcomeEngine PASO 6│
│  → snapshots,    │                          │  baseline + followup│
│    profiles,     │                          │  windows (14d/14d)  │
│    cohorts global│                          │  → intervention_    │
└────────┬─────────┘                          │     outcomes        │
         │                                    └──────────┬──────────┘
         ▼                                               │
┌──────────────────┐    ┌──────────────────────┐         │
│ interventionEng3 │───▶│ pedagogical_         │         │
│  → reglas,       │    │   recommendations    │         │
│    risks         │    │   interventions      │◄────────┘
└──────────────────┘    │   risk_history       │
                        └──────────┬───────────┘
                                   │
   ┌───────────────────────────────┼─────────────────────────────┐
   ▼                               ▼                             ▼
┌────────────────┐  ┌──────────────────────┐  ┌─────────────────────────┐
│ cohortBuilder  │  │ trajectoryAnalyzer   │  │ institutionalLearning   │
│  resolves:     │  │  → cohort_           │  │  → institutional_       │
│   group/school │  │    trajectories      │  │     learnings           │
│   /club/risk/  │  │    (series UPSERT)   │  │     (≥MIN_SUPPORT)      │
│   intervention │  │                      │  │  +getPriorityHints      │
│   /habit/...   │  │                      │  └─────────────────────────┘
│  →cohort_defs +│  └──────────────────────┘
│   memberships  │                ▲
└──────┬─────────┘                │
       │                          │
       │      ┌──────────────────────┐
       └─────▶│ predictivePatterns   │
              │  → predictive_risk_  │
              │    patterns (agg)    │
              └──────────────────────┘

         + reader/HTTP: interventionImpactTracker (PASO 6)
         + scheduler: 10 loops leader-safe (5 PASO 4 + 5 PASO 6)
         + healthcheck: 20 checks (15 previos + 5 PASO 6)
         + métricas: +8 prom counters/gauges cardinalidad fija
```

---

## 4. Tablas nuevas (§6) — todas en insights.db

| Tabla | UNIQUE | Propósito |
|---|---|---|
| `intervention_outcomes` | `intervention_id` | Uno por intervención evaluable — baseline/followup + delta + label |
| `cohort_definitions` | `cohort_key` | Definición canónica de cohorte (re-buildable) |
| `cohort_memberships` | `cohort_id+user_id+joined_at` | Snapshot del membership |
| `cohort_trajectories` | `cohort_id+period+period_end` | Series temporales por cohort |
| `institutional_learnings` | `scope_type+scope_id+learning_type+version` | Aprendizajes prudentes |
| `predictive_risk_patterns` | `pattern_key+version` | Patrones agregados (NO predicción individual) |

Schema completo en `server/db/outcomesDbExt.mjs` (handle paralelo, mismo
archivo `insights.db`, PRAGMA WAL pattern PASO 4).

---

## 5. Outcomes labels (§9) + evidence_level (§10) — honestos

### Labels (5, todos no-clínicos)
| Label | Cuándo |
|---|---|
| `improved` | ≥ 2 señales mejoran significativamente AND 0 empeoran |
| `worsened` | ≥ 2 señales empeoran significativamente AND 0 mejoran |
| `mixed` | ≥ 1 mejora AND ≥ 1 empeora |
| `stable` | cambios bajo umbral, sin tendencia clara |
| `insufficient_data` | < 3 eventos por ventana O < 2 señales válidas |

### Evidence level (3)
| Level | Cuándo |
|---|---|
| `low` | eventos < 3 por ventana O señales válidas < 2 |
| `high` | ≥ 3 señales consistentes en misma dirección AND ≥ 10 eventos por ventana |
| `medium` | default (datos suficientes pero no fuerte consistencia) |

### Confidence (0..1) — interpretación honesta
**NO** es "probabilidad de mejora". **ES** "fuerza de la señal observacional".
Fórmula determinística: `0.6 × consistencia + 0.4 × sample_score`.

### Umbrales de delta significativo (por señal)
```
continuidad, persistencia, engagement, abandono, autonomia,
concentracion, recuperacion, completitud → 0.15 (escala 0..1)
diversidad → 1.0 (count absoluto)
tiempo_efectivo → 5 (minutos)
```
Bajo umbral → "stable" (cambio dentro del ruido normal).

---

## 6. Cohortes (§11-12) — 8 tipos, scope isolation real

| Tipo | Resolver | Scope source |
|---|---|---|
| `group:<id>` | `groups_db.json` memberIds[] del grupo | groups.json |
| `school:<id>` | ∪ memberIds[] de groups donde schoolId === id | groups.json |
| `club:<id>` | groups con type='club' + memberIds[] | groups.json |
| `intervention:<type>` | DISTINCT student_id de pedagogical_interventions | DB |
| `risk:<rule_id>` | DISTINCT user_id de risk_history activos | DB |
| `habit:high_continuity` | scope_id='user' con continuidad_semanal ≥ 0.7 | snapshot_signals |
| `trajectory:recovered_after_risk` | DISTINCT user_id con resolved_at NOT NULL | risk_history |
| `modality:audio_plus_immersive` | users con eventos en ambos modos | events.db |
| `library:<id>` | (PASO 7 — no implementado) | — |

### Scope isolation (test §E-17)
`buildCohort({type:'school', scope_id:'school_no_existe'})` → `members=0`.
NO se cuela ningún user de otra school.

### Idempotencia (test §B-8, §D-13)
`buildCohort` con la misma key → REPLACE memberships (no duplica).
`rebuildOutcomes` UPSERT por `intervention_id` (no duplica outcomes).

---

## 7. Institutional learnings — aprendizaje real institucional

### Agregación correcta (bug fix vs primer intento)
**Mal primer intento:** agrupar por `(outcome.scope_type='user', scope_id=userId, intervention_type)` → cada user 1 outcome → nunca alcanza `MIN_SUPPORT=5`.

**Corregido:** agregar a 2 niveles:
1. **Global** `('all','global',intervention_type)` — siempre.
2. **Per cohort institucional** (school/group/club) consultando
   `cohort_memberships` materializadas (si cohortBuilder ya corrió).

Esto produce learnings comparables ("en general", "en colegio X", "en grupo Y").

### Ejemplo real (cumple §15 plan)
```json
{
  "learning_id": "lrn_all_global_lectura_guiada_v1",
  "scope_type": "all",
  "scope_id": "global",
  "learning_type": "observed_strategy_effect",
  "evidence_json": {
    "support_count": 42,
    "outcome_distribution": { "improved": 25, "stable": 10, "worsened": 7 },
    "intervention_type": "lectura_guiada",
    "min_support_threshold": 5
  },
  "confidence": 0.6,
  "recommendation_hint": "En el scope all:global, después de la intervención \"lectura_guiada\" se observó mejora observada en 25 de 42 casos (60%). NO implica causalidad — refleja patrones observados."
}
```

### Recommendation adjustment §17 — sin tocar PASO 3
`getPriorityHints(ruleId)` retorna:
```js
{ multiplier: 1.18,                          // clamp [0.5, 1.5]
  rationale: 'Histórico observado para "lectura_guiada": 25/42 mejora, 7/42 retroceso.',
  confidence: 0.6,
  sample_size: 42 }
```
**NO modifica** `interventionEngine.runOnce`. El UI o el motor futuro
deciden usar el hint. Hoy el método está disponible vía import directo.

---

## 8. Predictive patterns (§16) — agregados, NO predicciones individuales

`predictivePatterns.runOnce` agrupa `pedagogical_risk_history` por
`risk_type` y registra patrones con `support_count` + `confidence`.

Versión inicial (PASO 6): 1 patrón por risk_type. **PASO 7 puede
extender** con secuencias multi-señal usando `signal_snapshots_history`
acumulada — el contrato `signal_sequence_json` ya soporta sequences
arbitrarias.

**Garantía ética:** los patrones se persisten como **observaciones
agregadas**. NO existe función `getPredictionFor(userId)`. La aplicación
por user es **decisión del docente con contexto humano**.

---

## 9. Métricas Prometheus (§20) — 8 nuevas, cardinalidad fija

| Métrica | Tipo | Labels | Cardinalidad |
|---|---|---|---|
| `chibalete_outcomes_computed_total` | Counter | `label` ∈ {improved,stable,worsened,mixed,insufficient_data} | 5 |
| `chibalete_outcome_confidence_avg` | Gauge | — | 1 |
| `chibalete_cohorts_built_total` | Counter | `type` ∈ {group,school,club,intervention,risk,habit,trajectory,modality} | 8 |
| `chibalete_trajectories_computed_total` | Counter | `scope` (cohort_type) | 8 |
| `chibalete_institutional_learnings_total` | Counter | `type` (learning_type) | <5 |
| `chibalete_predictive_patterns_total` | Counter | `version` (pattern version) | <5 |
| `chibalete_outcome_insufficient_data_total` | Counter | — | 1 |
| `chibalete_intervention_followup_due_total` | Gauge | — | 1 |

**NUNCA** labels userId/groupId/schoolId/contentId/email/sessionId
(mantiene política PASO 2-5).

---

## 10. Healthcheck (§21) — 5 checks nuevos

`/api/health/analytics` ahora expone **20 checks** totales:
```
events_db, registry,
materializer, intervention_engine,                  ← PASO 2-3
rollups, replay, feature_extraction, wal_size,
slow_queries, leader,                               ← PASO 4
scheduler, archive_rotation,                        ← PASO 5
outcome_engine, cohort_builder, trajectory_analyzer,
institutional_learning, predictive_patterns,        ← PASO 6
archive_db, throughput, shadow_consistency           ← PASO 1/4 utility
```

Cada check independiente con `safe()` wrapper — un fallo no tumba al
healthcheck completo.

---

## 11. Scheduler (§22) — 10 loops leader-safe totales

`server/aulaViva/scheduler.mjs` ahora ejecuta:
| Loop | Lock | Intervalo default | Gate env |
|---|---|---|---|
| materializer | `materializer` | 60s | `INSIGHTS_MATERIALIZER_ENABLED` |
| intervention | `intervention` | 5min | `INTERVENTION_ENGINE_ENABLED` |
| rollups | `rollup` | 30min | `ROLLUPS_ENABLED` |
| feature_extract | `feature_extract` | 24h | `FEATURE_EXTRACTION_ENABLED` |
| archive_rotation | `archive_rotation` | 6h | `ARCHIVE_ROTATION_ENABLED` |
| **outcome_engine** | `outcome_engine` | 1h | `AULA_VIVA_OUTCOME_ENGINE_ENABLED` |
| **cohort_builder** | `cohort_builder` | 6h | `AULA_VIVA_COHORT_BUILDER_ENABLED` |
| **trajectory_analyzer** | `trajectory_analyzer` | 6h | `AULA_VIVA_TRAJECTORY_ENABLED` |
| **institutional_learning** | `institutional_learning` | 6h | `AULA_VIVA_LEARNING_ENABLED` |
| **predictive_patterns** | `predictive_patterns` | 24h | `AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED` |

**Cada loop default-OFF.** Solo se inicia el scheduler global con
`AULA_VIVA_SCHEDULER_ENABLED=1`. Cada engine adicionalmente requiere su
propio flag (doble gating: scheduler + engine).

---

## 12. Tests (§24) — 40 ✓ + regresión completa

`server/__test__/outcomesEngine.test.js`:
| Bloque | Cubre §24 | Asserts |
|---|---|---|
| A | outcomeClassifier (improved/worsened/mixed/stable/insufficient_data + vocab) | 8 |
| B | outcomeEngine OFF rollback + ON compute + idempotency | 5 |
| C | NO causal language en TODOS los outcomes generados | 2 |
| D | rebuildOutcomes (replay) idempotente | 3 |
| E | cohortBuilder OFF + buildCohort + scope isolation + runOnce | 5 |
| F | trajectoryAnalyzer OFF + ON | 2 |
| G | institutionalLearning OFF + ON + vocab + getPriorityHints + multiplier range | 5 |
| H | predictivePatterns OFF + ON | 2 |
| I | impactTracker (user, by-type, queue, never-throws) | 4 |
| J | Healthcheck con 5 checks PASO 6 nuevos | 1 |
| K | WAL safety (integrity_check) | 1 |
| L | Deterministic output + scheduler gated | 2 |
| **TOTAL** | | **40 ✓ / 0 ✗** |

### Regresión completa
| Suite | Antes PASO 6 | Después PASO 6 |
|---|---|---|
| `test:analytics` | 175 ✓ (PASO 1+2+3+4+5) | **215 ✓** (+ 40 outcomes) |
| `test:identity` | 12 ✓ | 12 ✓ intacto |
| `test:memberships` | 80 ✓ | 80 ✓ intacto |
| **TOTAL** | 267 ✓ | **307 ✓ / 0 ✗** |

---

## 13. Smoke manual (§25) — receta operacional

```bash
# 1. Habilitar todo (default OFF en todo PASO 6)
export INSIGHTS_MATERIALIZER_ENABLED=1
export INTERVENTION_ENGINE_ENABLED=1
export ROLLUPS_ENABLED=1
export AULA_VIVA_OUTCOME_ENGINE_ENABLED=1
export AULA_VIVA_COHORT_BUILDER_ENABLED=1
export AULA_VIVA_TRAJECTORY_ENABLED=1
export AULA_VIVA_LEARNING_ENABLED=1
export AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED=1
export AULA_VIVA_SCHEDULER_ENABLED=1

npm run server &

# 2. Crear estudiante con perfil de riesgo (via UI normal: login + abandono).
# 3. Registrar intervención desde UI Aula Viva Operacional.
# 4. Esperar ventana de followup (14d) — o forzar replay para test:
node --input-type=module -e "
  const o = await import('./server/services/outcomeEngine.mjs');
  console.log(o.rebuildOutcomes({ fromTs: Date.now() - 30*86400000, toTs: Date.now() }));
"

# 5. Ver outcomes vía impactTracker:
node --input-type=module -e "
  const i = await import('./server/services/interventionImpactTracker.mjs');
  console.log(JSON.stringify(i.getImpactByInterventionType('lectura_guiada'), null, 2));
"

# 6. Construir cohorte directa:
node --input-type=module -e "
  const c = await import('./server/services/cohortBuilder.mjs');
  console.log(c.buildCohort({ cohort_type: 'school', scope_id: 'school_x' }));
"

# 7. Healthcheck completo (20 checks):
curl http://localhost:3000/api/health/analytics | jq '.checks | keys'

# 8. Confirmar que explanation NO afirma causalidad fuerte:
node --input-type=module -e "
  const ed = await import('./server/db/outcomesDbExt.mjs');
  const db = ed.getOutcomesExtDb();
  const rows = db.prepare('SELECT outcome_label, explanation FROM intervention_outcomes LIMIT 5').all();
  rows.forEach(r => console.log(r.outcome_label, ':', r.explanation));
"
```

---

## 14. VPS deploy (§26)

```bash
ssh root@72.60.158.97
cd /opt/chibaleteplus

# Backup obligatorio
cp /var/www/chibalete/data-critical/events.db          /backup/events_$(date +%F).db
cp /var/www/chibalete/data-critical/insights.db        /backup/insights_$(date +%F).db
cp /var/www/chibalete/data-critical/events.archive.db  /backup/archive_$(date +%F).db 2>/dev/null || true

# Sync server bind mount
rsync -av --delete server/ /var/www/chibalete/server-new/
mv /var/www/chibalete/server /var/www/chibalete/server-old
mv /var/www/chibalete/server-new /var/www/chibalete/server

# Restart staggered api_1 con engines OFF — DDL idempotente crea las 6 tablas
docker restart chibalete_api_1
sleep 10
curl http://72.60.158.97/api/health/analytics | jq '.checks | keys | length'
# → debe retornar 20

docker restart chibalete_api_2

# Activar gradualmente — canary api_1
docker exec chibalete_api_1 sh -c 'export AULA_VIVA_OUTCOME_ENGINE_ENABLED=1; pkill -HUP node'
sleep 600
docker exec chibalete_api_2 sh -c 'export AULA_VIVA_OUTCOME_ENGINE_ENABLED=1; pkill -HUP node'

# Repetir para cohort_builder, trajectory_analyzer, institutional_learning, predictive_patterns
```

**NUNCA:** `docker compose down`, rebuild de imagen api, restart edge.

---

## 15. Rollback (§27)

```bash
# Apagar TODOS los engines PASO 6 (default OFF)
unset AULA_VIVA_OUTCOME_ENGINE_ENABLED
unset AULA_VIVA_COHORT_BUILDER_ENABLED
unset AULA_VIVA_TRAJECTORY_ENABLED
unset AULA_VIVA_LEARNING_ENABLED
unset AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED

# Reiniciar staggered:
docker restart chibalete_api_1; sleep 30; docker restart chibalete_api_2

# Datos preservados (cero pérdida):
# ✓ Todas las tablas PASO 1-5 intactas
# ✓ PASO 6: intervention_outcomes, cohort_definitions, cohort_memberships,
#   cohort_trajectories, institutional_learnings, predictive_risk_patterns
#   → todo lo ya calculado SIGUE consultable vía reader API
#
# Solo cesan:
# ✗ Cómputo nuevo de outcomes
# ✗ Cohortes refrescadas
# ✗ Trayectorias nuevas
# ✗ Learnings nuevos
# ✗ Patrones predictivos nuevos
#
# La UI Aula Viva Operacional sigue funcionando con datos PASO 5
# (los nuevos endpoints PASO 6 son aditivos — su ausencia degrada
# graciosamente vía recovery-first patterns).
```

---

## 16. Archivos creados / modificados

### Creados (PASO 6)
```
docs/AULA-VIVA-PASO-6-AUDIT.md                       # auditoría §4
docs/AULA-VIVA-PASO-6-OUTCOMES.md                    # este entregable §5
server/db/outcomesDbExt.mjs                          # 6 tablas + statements
server/pedagogy/outcomeClassifier.js                 # rules puras + FORBIDDEN_VOCAB
server/services/outcomeEngine.mjs                    # runOnce + rebuildOutcomes
server/services/cohortBuilder.mjs                    # 8 resolvers + buildCohort + runOnce
server/services/trajectoryAnalyzer.mjs               # cohort series
server/services/institutionalLearning.mjs            # learnings + getPriorityHints
server/services/predictivePatterns.mjs               # patrones agregados
server/services/interventionImpactTracker.mjs        # reader agregado
server/__test__/outcomesEngine.test.js               # 40 checks
```

### Modificados (quirúrgicamente)
```
server/observability/metrics.js                 # +8 métricas (cardinalidad fija)
server/observability/analyticsHealth.js         # +5 checks
server/aulaViva/scheduler.mjs                   # +5 loops gated default-OFF
server/__test__/aulaVivaOperational.test.js     # update assertion loops >= 5
package.json                                    # +test:outcomesEngine
```

### NO tocados (regla "cambios mínimos")
```
server/services/interventionEngine.mjs       ← PASO 3 hot path intacto
server/services/insightMaterializer.mjs      ← PASO 2 + 4 hot path intacto
server/services/featureExtractor.mjs         ← PASO 4 intacto
server/services/rollupsEngine.mjs            ← PASO 4 intacto
server/services/replayEngine.mjs             ← PASO 4 intacto
server/services/leaderElection.mjs           ← PASO 4 intacto
server/services/queryProfiler.mjs            ← PASO 4 intacto
server/services/insightReader.mjs            ← PASO 2-4 intacto
server/db/insightsDbExt.mjs                  ← PASO 2 intacto
server/db/pedagogyDbExt.mjs                  ← PASO 3 intacto
server/db/rollupsDbExt.mjs                   ← PASO 4 intacto
server/aulaViva/operationalRouter.mjs        ← PASO 5 intacto (PASO 7 extiende UI)
server/aulaViva/archiveRotation.mjs          ← PASO 5 intacto
pages/AulaVivaOperacional.tsx                ← PASO 5 intacto
auth, login, onboarding, uploads             ← intactos
runtime inmersivo                            ← intacto
nginx, Docker Compose                        ← intactos
```

---

## 17. Criterio de éxito (§28) — checklist

- [x] **¿Qué intervenciones se aplicaron?** → `getImpactSummary(scope, id)`
- [x] **¿Qué cambió después?** → `intervention_outcomes.delta_metrics_json`
- [x] **¿Qué cohortes mejoraron?** → `cohort_trajectories.trend_json` per signal
- [x] **¿Qué cohortes empeoraron?** → idem (trend='down')
- [x] **¿Qué estrategias parecen funcionar mejor?** → `institutional_learnings.recommendation_hint`
- [x] **¿Qué lectores muestran recuperación?** → cohort `trajectory:recovered_after_risk`
- [x] **¿Qué patrones anticipan riesgo?** → `predictive_risk_patterns` (agregados)
- [x] **¿Qué debe hacer la institución después?** → `getPriorityHints(ruleId)` + recommendation_hint

Todo cumplido **sin** afirmar causalidad falsa (vocab filtered),
**sin** sobreinferir (insufficient_data label + low confidence),
**sin** exponer datos indebidamente (scope isolation testado),
**sin** romper simplicidad (cero deps, cero microservicios),
**sin** perder rendimiento (UPSERT idempotente + leader-safe + WAL).

---

## 18. Lo honesto: qué queda fuera de este PASO

- **UI extension** §18 (secciones nuevas en `AulaVivaOperacional.tsx`):
  el endpoint layer está listo; el UX engineering de los paneles
  específicos (Trayectoria del estudiante, Aprendizajes institucionales,
  Patrones predictivos) queda para PASO 7. Lo aquí entregado son las
  fuentes de datos auditables.
- **Endpoints REST extendidos** en `operationalRouter.mjs`: los servicios
  PASO 6 son consumibles vía import directo; exponerlos como
  `/api/aula-viva/outcomes/*`, `/cohorts/definitions`,
  `/learnings/:scope`, `/patterns/*` se difiere a PASO 7 cuando la UI
  los demande con shape concreto.
- **Predictive patterns multi-señal**: la versión PASO 6 es por
  `risk_type` (1 dimensión). Secuencias multi-señal requieren
  `SNAPSHOT_HISTORY_ENABLED=1` activo y datos acumulados — el `pattern_id`
  schema ya soporta `signal_sequence_json` para extensión sin migración.
- **Library scope**: documentado como pendiente (no hay tabla SQLite
  para bibliotecas hoy). Cohort `library:*` retorna note pero `members=0`.
- **Validación cruzada / honestidad estadística avanzada**: PASO 6 usa
  umbrales determinísticos. Tests de poder estadístico (mín N para
  confidence>0.8) son trabajo futuro de un statistician educativo.

---

## 19. Resumen ejecutivo (1 párrafo)

PASO 6 convierte Aula Viva en sistema de **aprendizaje institucional
longitudinal honesto**: 6 tablas nuevas (`intervention_outcomes`,
`cohort_definitions`, `cohort_memberships`, `cohort_trajectories`,
`institutional_learnings`, `predictive_risk_patterns`) + 6 engines
(outcomeEngine con baseline/followup 14d/14d configurable y 5 labels
no-clínicos {improved,stable,worsened,mixed,insufficient_data} + 3
evidence_levels {low,medium,high} sin "proven/causal/garantizado";
cohortBuilder con 8 resolvers reales {group,school,club,intervention,
risk,habit,trajectory,modality} + scope isolation testada;
trajectoryAnalyzer con UPSERT idempotente por cohort+period+period_end;
institutionalLearning con agregación a 2 niveles (global + per
school/group/club via cohort_memberships) + `getPriorityHints(ruleId)`
con multiplier clamp [0.5,1.5] sin modificar el motor PASO 3;
predictivePatterns como agregados observacionales NO predicciones
individuales; interventionImpactTracker como reader agregado never-throws),
con vocabulario causal/clínico bloqueado mecánicamente vía
`containsForbiddenVocab` (validado en 3 sitios distintos), 8 métricas
Prometheus cardinalidad fija, 5 healthchecks nuevos (20 totales),
scheduler con 5 loops nuevos leader-safe (10 totales todos
default-OFF), replay idempotente vía `rebuildOutcomes`, cero deps
nuevas, cero microservicios, cero modificación al hot path PASO 1-5,
rollback en caliente sin pérdida de datos, **307/307 tests verdes** sin
regresión, ética testada (cualquier introducción de vocab clínico/causal
rompe los tests antes del deploy). Aula Viva ahora puede responder no
solo "qué pasa" sino "qué intervenciones funcionan para qué tipo de
lector en qué contexto" — siempre con evidencia observacional, sin
afirmar causalidad, sin etiquetar individuos, sin rankear docentes,
preservando la simplicidad SQLite-WAL-cuatro-handles del proyecto y
listo para que PASO 7 conecte la UX dedicada sobre las APIs entregadas.
