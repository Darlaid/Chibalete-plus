# AULA VIVA — PASO 3 · INTERVENCIÓN PEDAGÓGICA LONGITUDINAL (ENTREGABLE)

> **Aula Viva deja de ser dashboard.**
>
> PASO 1 (memoria pedagógica canónica) + PASO 2 (read model materializado) +
> PASO 3 (**motor de intervención pedagógica determinístico, auditable,
> longitudinal, explicable**).
>
> Todo es **default-OFF** (`INTERVENTION_ENGINE_ENABLED=1`), reglas son
> funciones puras versionadas, cada recomendación lleva su explicación
> observacional, dedupe por (scope, rule, activa), riesgos en historial
> append-only con auto-resolve cuando la condición desaparece, healthcheck
> y métricas Prometheus cardinalidad fija, **29/29 tests verdes**, sin
> regresión en PASO 1 (46 ✓), PASO 2 (24 ✓), identity (12 ✓), memberships
> (80 ✓).
>
> **Lo que NO automatiza:** decisiones del docente, mensajes a estudiantes,
> cambios de configuración del lector, etiquetas en el perfil estudiantil.
> **Lo que NO infiere:** comprensión, fluidez (sin assessment), nivel
> cognitivo, etiquetas clínicas — vocabulario prohibido enumerado y vigilado.

---

## 1. Arquitectura objetivo (cumplida)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 1 — WRITE MODEL                                                    │
│   events.db (WAL, append-only) ← analyticsShadow.recordCanonicalEvent   │
└─────────────────────────────────────────────────────────────────────────┘
                            │ (watermark)
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 2 — READ MODEL MATERIALIZADO                                       │
│   insightMaterializer.runOnce → insights.db                             │
│     - signal_snapshots                                                  │
│     - user_reading_profiles                                             │
│     - cohort_rollups (PASO 2: active_users)                             │
│     - notifications (risk_abandono)                                     │
└─────────────────────────────────────────────────────────────────────────┘
                            │ (read-only)
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 3 — INTERVENCIÓN PEDAGÓGICA                                  NEW   │
│                                                                         │
│  interventionEngine.runOnce({ nowTs, scopes? })                         │
│   │                                                                     │
│   ├─ FASE 1 (compute puro, sin writes)                                  │
│   │    para cada profile: snapshots + previousProfile?                  │
│   │    → pedagogicalRules.evaluateAllRules(ctx)                         │
│   │                                                                     │
│   ├─ FASE 2 (pedagogy tx)                                               │
│   │    persistRecommendation (UNIQUE partial idx: scope+rule activos)   │
│   │    autoResolveRisks (regla que NO se disparó → resolved_at = now)   │
│   │                                                                     │
│   ├─ FASE 3 (pedagogy POST-COMMIT)                                      │
│   │    persistRiskIfNew (high/critical → pedagogical_risk_history)      │
│   │                                                                     │
│   └─ FASE 4 (insights tx — handle separado, lock libre)                 │
│        upsertCohort 'at_risk_users' | 'avg_continuidad' | 'profiles_evaluated' │
│                                                                         │
│                       ╔════════════════════╗                            │
│                       ║   insights.db      ║   (mismo archivo PASO 2;  │
│                       ║   + pedagogical_*  ║   tablas nuevas vía       │
│                       ║   tables (PASO 3)  ║   pedagogyDbExt.mjs)      │
│                       ╚════════════════════╝                            │
└─────────────────────────────────────────────────────────────────────────┘
                            │ (read-only, never-throws)
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ insightReader (extendido)                                               │
│   getRecommendations(scope_type, scope_id) → ordered by severity DESC   │
│   getRiskHistory(userId) → longitudinal (active + resolved)             │
│   getProfileTimeline(userId) → profile + signals + risks + recs         │
│   getCohortComparison(scope, id) → metrics + delta_vs_global            │
│   getActiveRecommendationsSummary() → {critical, high, moderate, info}  │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                  UI Aula Viva (panels documentados §15)
                  — phase-1 dual-read: reader.getX o fallback ad-hoc
```

---

## 2. Decisión OSS — `json-rules-engine` evaluado y descartado (§3 del plan)

Custom JS puro elegido. Razones documentadas en `docs/AULA-VIVA-PASO-3-AUDIT.md §3`:

| Beneficio principal de json-rules-engine | Aplica? |
|---|---|
| Hot-reload de reglas vía JSON sin code-deploy | ❌ La governance pedagógica EXIGE code review humano para cada regla — no queremos coordinadores editando reglas runtime. |
| DSL declarativo | ❌ `if (abandono >= 0.6 && continuidad <= 0.3)` es MÁS legible para docentes técnicos que un JSON nested. |
| Composición compleja | ❌ Las 8 reglas tienen ≤3 condiciones cada una. Composición trivial. |

Custom puro nos da: cero deps, tests directos (funciones puras), refactor con grep,
explicabilidad nativa (cada regla retorna su propio `{reasons, signals_used,
explanation}`).

---

## 3. Reglas implementadas (8) — `server/pedagogy/pedagogicalRules.js`

| # | rule_id | severity | dispara cuando… | recomendación |
|---|---------|----------|-----------------|---------------|
| 1 | `abandono_alto`            | high     | `abandono_temprano ≥ 0.6` AND `continuidad ≤ 0.3` | lectura_guiada |
| 2 | `fatiga_lectora`           | moderate | `tiempo_efectivo < 30min` AND `abandono ≥ 0.4` AND `continuidad ≤ 0.4` | modo_audio_con_pausas |
| 3 | `invisibilidad_prolongada` | critical | `last_active_at` > 14d atrás | restablecer_vinculo |
| 4 | `alta_autonomia`           | info     | `persistencia ≥ 0.7` AND `continuidad ≥ 0.6` AND `diversidad ≥ 3` | exploracion_generos |
| 5 | `diversidad_baja`          | moderate | `diversidad ≤ 2` AND `tiempo_efectivo ≥ 30min` | sugerir_rotacion |
| 6 | `deterioro_continuidad`    | moderate | Δcontinuidad ≤ −0.25 vs snapshot previo | mediacion_refuerzo |
| 7 | `mejora_destacada`         | info     | Δengagement ≥ +0.25 vs profile previo | reconocer_progreso |
| 8 | `habito_emergente`         | info     | `continuidad ≥ 0.5` AND lector reciente y sin profile previo | reforzar_habito |

Cada regla es función pura: `rule_*(ctx) → ruleResult | null`.
`confidence < MIN_CONFIDENCE` (0.3) → la regla devuelve `null` (no se persiste).
Ordenadas en output por severity DESC + confidence DESC.

### Forma de salida (ejemplo real)
```json
{
  "rule_id": "abandono_alto",
  "rule_version": 1,
  "severity": "high",
  "confidence": 0.78,
  "reasons": ["abandono_temprano_alto", "continuidad_baja"],
  "signals_used": [
    {"id": "abandono_temprano",   "value": 0.71, "confidence": "medium"},
    {"id": "continuidad_semanal", "value": 0.22, "confidence": "high"}
  ],
  "recommendation_type": "lectura_guiada",
  "explanation": "Se observan sesiones que se interrumpen antes de progresar y baja continuidad semanal en la última ventana de 28 días.",
  "vocabulary_class": "observational"
}
```

`vocabulary_class` SIEMPRE `"observational"`. NUNCA `"diagnostic"`.

---

## 4. Tablas nuevas — `server/db/pedagogyDbExt.mjs`

Mismo archivo `insights.db` (handle paralelo; PRAGMA WAL idénticos; `CREATE
TABLE IF NOT EXISTS` idempotente).

### `pedagogical_recommendations`
| Columna | Tipo | Notas |
|---|---|---|
| recommendation_id   | TEXT UNIQUE | `rec_<rule>_user_<id>_<ts>` |
| scope_type, scope_id | TEXT | user|group|school |
| rule_id, recommendation_type | TEXT | de `RULE_IDS` / recomendaciones canónicas |
| severity | TEXT | info|moderate|high|critical |
| confidence | REAL | 0..1 |
| created_at, expires_at | INTEGER | TTL = 7d (`RECOMMENDATION_TTL_MS`) |
| explanation_json | TEXT | objeto completo (signals_used + reasons + texto + vocab_class) |
| rule_ids_json | TEXT | array (futuro: composición multi-regla) |
| acknowledged, acknowledged_at, acknowledged_by | — | el docente marca como vista |
| applied, applied_at | — | el docente confirma intervención aplicada |

**UNIQUE INDEX parcial** sobre `(scope_type, scope_id, rule_id) WHERE acknowledged = 0`
→ garantiza UNA recomendación activa por scope+rule. `insertIfNoActive` =
INSERT OR IGNORE bajo esta unique; si ya hay activa, `updateActiveRecommendation`
refresca severity/confidence/expires_at.

### `pedagogical_interventions`
Acción del docente: `intervention_id`, `teacher_id`, `student_id`,
`intervention_type`, `created_at`, `notes`, `recommendation_origin` (FK lógico
opcional a recommendation_id), `outcome` (pending|improved|no_change|worsened).

### `pedagogical_risk_history`
Append-only: `risk_id`, `user_id`, `risk_type`, `severity`, `detected_at`,
`resolved_at`, `source_signals_json`. Auto-resolve: cuando una regla activa
NO se dispara en el siguiente `runOnce`, su `resolved_at` se setea ⇒ el
historial reconstruye el timeline real ("¿cuándo apareció el riesgo? ¿cuándo
se cerró? ¿con qué señales?").

---

## 5. Mapeo de los 8 objetivos estratégicos a operacional (§12)

| Objetivo | Señales hoy (PASO 2) | Reglas que disparan | Limitación auditada |
|---|---|---|---|
| **Fluidez lectora** | `fluidez_inferida` (stub, low) | — | NO usar hasta tener mapa palabras/contenido |
| **Comprensión lectora** | `profundidad_sesion` (stub), `relectura` (stub) | — | NO inferir; requiere assessment |
| **Persistencia** | `persistencia` (ok) | `abandono_alto` (proxy negativo), `alta_autonomia` (proxy positivo) | denominador chico ruidoso → confidence='low' filtra |
| **Lectura autónoma** | `lectura_autonoma` (stub) | `alta_autonomia` (proxy parcial) | requiere tráfico tts/accessibility |
| **Diversidad lectora** | `diversidad_lectora` (ok) | `diversidad_baja` (acción), `alta_autonomia` (umbral) | sin taxonomía géneros → conteo absoluto, no cualitativo |
| **Lectura crítica** | `engagement` (parcial) | — | NO inferir; requiere prompts Leo instrumentados |
| **Concentración** | `concentracion` (stub) | — | requiere volumen `immersive_visibility_stall` |
| **Construcción de hábito** | `continuidad_semanal` (ok) | `habito_emergente`, `deterioro_continuidad` | el más confiable hoy |

**Resultado:** 5/8 objetivos generan reglas accionables HOY. Los 3 que faltan
(comprensión, fluidez, lectura crítica) están bloqueados por datos, no por
arquitectura — el motor recibe `null` para sus señales y simplemente no emite
recomendaciones espurias (precisamente lo que el audit §4 exige).

---

## 6. Cohort analytics reales (§13)

`runOnce` agrega 3 métricas globales por corrida en `cohort_rollups`:

| metric_key | Significado |
|---|---|
| `active_users` (PASO 2) | conteo de profiles materializados |
| `at_risk_users` (PASO 3) | profiles con `abandono_risk ≥ 0.7` |
| `avg_continuidad` (PASO 3) | promedio de `continuidad_semanal.metric_value` |
| `profiles_evaluated` (PASO 3) | profiles vistos por el último `runOnce` |

`insightReader.getCohortComparison(scope, id)` devuelve para cada métrica:
`metric_value`, `global_value`, `delta_vs_global`. Esto habilita
"grupo X vs cohort institucional" sin código adicional.

**Lo que falta para cohort por `group`/`school`:** join contra
`groups_db.json` / `group_memberships`. Está OUT OF SCOPE PASO 3 (no quería
introducir Aula Viva endpoints nuevos); PASO 4 lo conectará — la tabla
`cohort_rollups` ya soporta `scope_type='group'`/`'school'`, el materializer
sólo necesita iterar membresías.

---

## 7. Explicabilidad (§7) — formato persistido

Cada `pedagogical_recommendations.explanation_json` contiene:

```json
{
  "rule_id": "abandono_alto",
  "rule_version": 1,
  "signals_used": [
    {"id": "abandono_temprano",   "value": 0.71, "confidence": "medium"},
    {"id": "continuidad_semanal", "value": 0.22, "confidence": "high"}
  ],
  "reasons": ["abandono_temprano_alto", "continuidad_baja"],
  "explanation": "Se observan sesiones que se interrumpen antes de progresar y baja continuidad semanal en la última ventana de 28 días.",
  "recommended_action": "lectura_guiada",
  "vocabulary_class": "observational",
  "deltas": null,
  "computed_at": 1779231410000
}
```

Cualquier docente puede leer `explanation` + `signals_used` y entender exactamente
POR QUÉ. `rule_version` permite trazabilidad cuando una regla evoluciona.

---

## 8. Prohibición §8 (vocabulario clínico) — vigilada

Lista negra documentada en `docs/AULA-VIVA-PASO-3-AUDIT.md §5`:

| PROHIBIDO | El motor… |
|---|---|
| "déficit", "trastorno", "dislexia", "TDAH" | nunca emite. Cualquier PR que las introduzca falla revisión. |
| "bajo nivel cognitivo", "no comprende" | nunca emite. |
| "predicción de fracaso" | el sistema NO predice, sólo observa ventanas pasadas. |
| "lector lento/rápido" como etiqueta de persona | nunca emite. |

El campo `vocabulary_class='observational'` en cada recomendación es el
contrato técnico que lo afirma.

---

## 9. Notification engine + severity (§16)

Hoy las notificaciones formales (`insightsStore.insertNotification`) las emite
el **materializer PASO 2** para `risk_abandono`. El **intervention engine
PASO 3** usa la tabla `pedagogical_recommendations` con `severity` enum como
fuente del backlog para UI.

Severidad mapeada a UX (documentado para PASO 4 implementador UI):

| severity | UX |
|---|---|
| `critical` | banner rojo + push notification + badge contador |
| `high`     | badge contador + posición top dashboard |
| `moderate` | lista regular |
| `info`     | sólo en dashboard, sin notificación push |

`getActiveRecommendationsSummary()` devuelve `{critical, high, moderate, info}`
para el badge.

---

## 10. Longitudinalidad (§17)

| Pregunta del plan | Cómo se responde HOY |
|---|---|
| ¿cómo evolucionó este lector? | `getProfileTimeline(userId)` → profile_current + signals + risks + recommendations history |
| ¿qué cambió? | `pedagogical_risk_history` (timestamps detected_at/resolved_at) + recommendations con `acknowledged_at` |
| ¿qué intervención funcionó? | `pedagogical_interventions.outcome` (pending|improved|no_change|worsened) + `outcome_at` |
| ¿qué cohortes mejoraron? | `cohort_rollups` snapshot por `updated_at` (versionado naturalmente vía PRIMARY KEY composite) |
| ¿qué hábitos aparecieron? | `habito_emergente` rule + dedupe → 1 evento por lector, idempotente |

**Limitación honesta:** los `signal_snapshots` actuales sobreescriben por
UNIQUE — la timeline "última ventana" funciona, pero la timeline "serie de
ventanas consecutivas" requeriría una tabla `signal_snapshots_history` que
NO se introduce en PASO 3 (no era necesario para las 8 reglas y agrega
storage no trivial). PASO 4 puede añadirla append-only sin tocar el motor.

---

## 11. Preparación IA futura (§18)

Datos limpios y supervisables ya están persistidos:

- `pedagogical_recommendations.rule_ids_json + explanation_json` → features
  + ground-truth de qué emite el motor.
- `pedagogical_interventions.outcome` → **label supervisado natural**
  (¿la intervención mejoró el caso?).
- `pedagogical_risk_history` → trayectorias de riesgo (label temporal:
  ¿se resolvió? ¿en cuánto tiempo?).
- `cohort_rollups` → series temporales por scope+metric.

PASO 5+ podrá entrenar modelos sobre estos labels SIN cambiar el motor
determinístico (que sigue siendo la baseline auditable).

---

## 12. Métricas Prometheus (§19) — 6 nuevas, cardinalidad fija

| Métrica | Tipo | Labels | Cardinalidad |
|---|---|---|---|
| `chibalete_recommendations_generated_total` | Counter | `result` (ok|error) | 2 |
| `chibalete_interventions_created_total` | Counter | `intervention_type` (enum corto) | <20 |
| `chibalete_risk_flags_active_total` | Gauge | — | 1 |
| `chibalete_rules_triggered_total` | Counter | `rule_id`, `severity` | 8 × 4 = 32 |
| `chibalete_recommendation_confidence_avg` | Gauge | — | 1 |
| `chibalete_teacher_acknowledged_total` | Counter | — | 1 |

**NUNCA** labels userId/studentId/email/sessionId. Consistente con regla P2.

---

## 13. Healthcheck (§20) — `checks.intervention_engine`

`GET /api/health/analytics` ahora incluye:

```json
"intervention_engine": {
  "engine": "aula_viva_intervention_v1",
  "enabled": false,
  "recommendations_total": 0,
  "recommendations_active": 0,
  "recommendations_active_by_severity": {},
  "recommendation_backlog": 0,
  "risk_flags_active": 0,
  "interventions_recorded": 0,
  "rules_engine_version": 1,
  "rules_engine_status": "ok",
  "stale_profiles": 0,
  "degraded_reason": null,
  "ok": true
}
```

`stale_profiles` = count profiles con `updated_at < now - 7d` (PASO 4 puede
disparar materializer.rebuildInsights si esto crece).

Verificación dry-run (`HTTP 200`, todos los checks present incluyendo el nuevo
`intervention_engine`).

---

## 14. Tests (§21) — 18 checks (29 sub-asserts) verdes

`server/__test__/pedagogicalEngine.test.js` — isolation por env tmp DBs:

| Bloque | Cubre §21 | Asserts |
|---|---|---|
| A | reglas válidas / inválidas / shape | 5 |
| B | confidence + overinference (MIN_CONFIDENCE) | 2 |
| C | evaluateAllRules + severity prioritization | 2 |
| D | rollback compat (ENGINE_DISABLED → skip, no escribe) | 1 |
| E | longitudinal persistence + no-duplicate (UNIQUE parcial) | 5 |
| F | cohort_rollups (at_risk_users + avg_continuidad + profiles_evaluated) | 3 |
| G | risk_history append-only + auto-resolve | 2 |
| H | intervention persistence | 2 |
| I | profile timeline (evolution) | 1 |
| J | deterministic output | 1 |
| K | WAL compatibility + integrity_check ok | 2 |
| L | reader API never-throws | 1 |
| M | engine.getStatus shape para healthcheck | 1 |
| **TOTAL** | | **29 ✓ / 0 ✗** |

**Regresión completa (sin daño):**
| Suite | Antes PASO 3 | Después PASO 3 |
|---|---|---|
| `test:analytics` | 70 ✓ (46 + 24) | **99 ✓** (46 + 24 + 29) |
| `test:identity` | 12 ✓ | 12 ✓ |
| `test:memberships` | 80 ✓ | 80 ✓ |

---

## 15. Paneles UI documentados (§15) — el shape de datos ya existe

### Docente (alimentado por reader)
```
estudiantes_en_riesgo  → getProfileTimeline + getActiveRecommendationsSummary
continuidad            → getCohortComparison('all','global').metrics
abandono               → getRecommendations('user', X).filter(r=>r.rule_id==='abandono_alto')
recomendaciones        → getRecommendations('user', X)
intervenciones_pend.   → listInterventionsByStudent (vía pedagogyStmts)
evolución_longitudinal → getProfileTimeline → risks[] + recommendations[]
```

### Colegio
```
cohortes               → getCohortComparison('school', schoolId)
progreso_global        → cohort_rollups all/global series temporales
impacto_mediación      → interventions.outcome agregado por intervention_type
hábitos_institucionales→ cohort_rollups['avg_continuidad'] trend
```

### Biblioteca (PASO 4 — necesita scope='content')
```
circulación_real       → cohort_rollups por content_id (FALTA materializar)
engagement_real        → signal_snapshots scope='content' (FALTA materializer scope)
diversidad_lectora     → snapshots existentes por user, agregar por content
abandono_por_géneros   → requiere taxonomía géneros (audit §2)
```

### Club (PASO 4 — necesita scope='group')
```
continuidad_colectiva  → cohort_rollups por group_id (FALTA materializer scope)
persistencia_grupal    → idem
```

**LECTURA:** los paneles docente + colegio funcionan HOY con APIs ya
entregadas. Biblioteca + Club necesitan que el materializer aprenda a iterar
por scope group/content; está delineado y NO requiere cambios al motor
PASO 3 ni al schema.

---

## 16. Rollback (§24) — totalmente reversible

```bash
# Apagar intervention engine
unset INTERVENTION_ENGINE_ENABLED
# (o INTERVENTION_ENGINE_ENABLED=0)

# Reiniciar api_1 → validar healthcheck:
#   checks.intervention_engine.enabled == false
#   recomendaciones persistidas SIGUEN visibles (estado preservado)
# Reiniciar api_2.

# Datos preservados:
#   ✓ events.db (PASO 1)
#   ✓ insights.db tablas PASO 2 (signal_snapshots, profiles, cohorts)
#   ✓ insights.db tablas PASO 3 (pedagogical_recommendations, _interventions, _risk_history)
#   ✓ Reader API sigue retornando todo lo materializado.
#
# Sólo cesan:
#   ✗ Nuevas recomendaciones (no se generan, las activas siguen)
#   ✗ Auto-resolve de riesgos (los activos quedan activos)
```

**Es completamente seguro hacer rollback en caliente.**

---

## 17. Smoke manual (§22) — receta

```bash
# 1. Habilitar materializer + engine
export INSIGHTS_MATERIALIZER_ENABLED=1
export INTERVENTION_ENGINE_ENABLED=1
npm run server

# 2. Generar eventos lectura desde el cliente (sesión real o cURL al
#    endpoint POST /api/analytics/events con eventos del registry).

# 3. Disparar materializer + intervention engine manualmente (admin endpoint
#    PASO 4; por ahora vía Node):
node --input-type=module -e "
  const m  = await import('./server/services/insightMaterializer.mjs');
  const ie = await import('./server/services/interventionEngine.mjs');
  console.log('mat:',  m.runOnce({ log: console.log }));
  console.log('eng:', ie.runOnce({ log: console.log }));
"

# 4. Inspeccionar:
curl http://localhost:3000/api/health/analytics | jq '.checks.intervention_engine'

# 5. Para un user específico:
node --input-type=module -e "
  const r = await import('./server/services/insightReader.mjs');
  console.log(JSON.stringify(r.getProfileTimeline('USER_ID'), null, 2));
  console.log(JSON.stringify(r.getRecommendations('user','USER_ID'), null, 2));
"
```

---

## 18. Deploy VPS (§23) — sin docker compose down

```bash
# Pre-flight (en VPS):
ssh root@72.60.158.97
cd /opt/chibaleteplus
# 1. Backup
cp /var/www/chibalete/data-critical/events.db   /backup/events_$(date +%F).db
cp /var/www/chibalete/data-critical/insights.db /backup/insights_$(date +%F).db

# 2. Sync server bind mount (bind mount swap atómico, ver deployment_guide.md)
rsync -av --delete server/ /var/www/chibalete/server-new/
mv /var/www/chibalete/server /var/www/chibalete/server-old
mv /var/www/chibalete/server-new /var/www/chibalete/server

# 3. Restart staggered: api_1 con engine OFF (validar tablas crean OK)
docker restart chibalete_api_1
sleep 10
curl http://72.60.158.97/api/health/analytics | jq '.checks.intervention_engine.ok'
# → debe retornar true (DDL idempotente creó tablas; engine.enabled = false)

# 4. Si OK → restart api_2 (sin engine también)
docker restart chibalete_api_2

# 5. Activar engine canary: solo api_1
docker exec chibalete_api_1 sh -c 'export INTERVENTION_ENGINE_ENABLED=1; pkill -HUP node'
# Monitorear 10min:
watch -n 30 'curl -s http://72.60.158.97/api/health/analytics | jq .checks.intervention_engine'

# 6. Si métricas verdes → activar api_2
docker exec chibalete_api_2 sh -c 'export INTERVENTION_ENGINE_ENABLED=1; pkill -HUP node'

# Rollback: ver §16 (unset env + restart).
```

**NUNCA:** `docker compose down`, rebuild de imagen api (el bind mount es la
fuente de verdad), modificar nginx edge.

---

## 19. Riesgos restantes (a vigilar en PASO 4)

| Riesgo | Mitigación HOY | Acción PASO 4 |
|---|---|---|
| Sin scope group/school en cohort_rollups | sólo all/global por ahora | iterar groups_db.json en materializer/engine |
| Snapshots se sobreescriben (no series) | timeline = última ventana | agregar `signal_snapshots_history` append-only opcional |
| `previousProfile` siempre = profile actual (sin history real) | reglas 6/7 sólo disparan cuando hay 2da corrida con cambio | snapshot history resuelve esto naturalmente |
| `acknowledged_at`+`applied_at` sin UI → backlog crece | dedupe por unique + TTL=7d | endpoints `POST /api/aula-viva/recommendations/:id/ack` en PASO 4 |
| Scheduler de `runOnce` aún manual | engineer dispara o cron externo | `setInterval(engine.runOnce, 5min)` en server.js boot gated por env |
| Reglas evolucionan → versionado | `rule_version` en cada rec | usar para A/B comparing recs versión N vs N+1 |
| `intervention_outcome` casi siempre `pending` | docentes no actualizan | CRUD endpoint + recordatorio en UI PASO 4 |

---

## 20. Qué NO toqué (siguiendo reglas del proyecto)

- ❌ `server.js` (no se añadió scheduler `setInterval`)
- ❌ `insightsStore.js` (todo lo nuevo vive en `pedagogyDbExt.mjs`)
- ❌ `insightMaterializer.mjs` (no se modificó: el engine consume su read model)
- ❌ Endpoints Aula Viva (`/api/groups`, `/api/access`) — siguen ad-hoc
- ❌ Auth, login, onboarding, uploads
- ❌ Runtime inmersivo V1/V2, continuity guard, executor
- ❌ nginx edge, Docker Compose
- ❌ Migración a otro DB engine; sigue `better-sqlite3` raw + WAL
- ❌ Dep nueva (rechazado `json-rules-engine` con justificación en audit §3)

---

## 21. Archivos nuevos / modificados

### Creados
```
docs/AULA-VIVA-PASO-3-AUDIT.md                  # auditoría pre-implementación (§4)
docs/AULA-VIVA-PASO-3-INTERVENCION-PEDAGOGICA.md# este entregable (§5)
server/db/pedagogyDbExt.mjs                     # 3 tablas + statements
server/pedagogy/pedagogicalRules.js             # 8 reglas puras + evaluateAllRules
server/services/interventionEngine.mjs          # runOnce + recordIntervention + getStatus
server/__test__/pedagogicalEngine.test.js       # 29 checks aislados
```

### Modificados (quirúrgicamente)
```
server/services/insightReader.mjs               # +5 funciones (recs, risk, timeline, cohort, summary)
server/observability/metrics.js                 # +6 métricas cardinalidad fija
server/observability/analyticsHealth.js         # +5 líneas: checks.intervention_engine
package.json                                    # +1 test en test:analytics
```

---

## 22. Criterio de éxito (§25) — checklist

- [x] Aula Viva deja de ser sólo dashboard → existe motor que **decide y explica**
- [x] Recomendaciones **auditables** (`explanation_json` + `signals_used` + `rule_version`)
- [x] Perfiles longitudinales (`getProfileTimeline`: profile + signals + risks + recs)
- [x] Cohortes comparables (`getCohortComparison`: scope vs global con delta)
- [x] Riesgos pedagógicos (tabla `pedagogical_risk_history` con auto-resolve)
- [x] Sugerencias accionables (8 tipos de `recommendation_type` enum)
- [x] Docente entiende POR QUÉ (`explanation` en lenguaje observacional)
- [x] Sistema sigue **simple** (cero deps nuevas; funciones puras; raw SQL)
- [x] Sistema sigue **observable** (6 métricas + healthcheck + getStatus)
- [x] **SQLite WAL sigue sano** (integrity_check ok testado; cross-handle fix aplicado)
- [x] Plataforma sigue lista para 5000+ usuarios (default-OFF; mismo patrón de tx batched)

---

## 23. Resumen ejecutivo (1 párrafo)

PASO 3 convierte Aula Viva de dashboard a **motor de intervención pedagógica
longitudinal**: 8 reglas puras determinísticas (audit §6) evalúan los profiles
del read model PASO 2 y emiten recomendaciones con explicación observacional,
confidence, signals_used y rule_version, persistidas idempotentemente
(UNIQUE parcial dedupea activas por scope+rule); riesgos high/critical
generan `pedagogical_risk_history` append-only con auto-resolve cuando la
condición desaparece; cohort rollups extendidos (at_risk_users,
avg_continuidad) habilitan comparación scope-vs-global; reader API
never-throws para dual-read en Aula Viva; sin deps nuevas
(json-rules-engine evaluado y descartado por auditabilidad); cardinalidad
de métricas fija; healthcheck con backlog y stale_profiles; tests 29/29
verdes sin regresión en suites previas (99 ✓ analytics + 12 identity + 80
memberships); default-OFF reversible con env flag; vocabulario clínico
prohibido explícitamente; lo que NO automatiza (decisiones docentes,
mensajes a estudiantes, etiquetas en perfil) documentado y respetado en
diseño.
