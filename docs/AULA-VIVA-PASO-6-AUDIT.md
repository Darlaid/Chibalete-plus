# AULA VIVA — PASO 6 · AUDITORÍA DE OUTCOMES (PRE-IMPLEMENTACIÓN)

> Mandato §4. Antes de programar, juzgar honestamente qué outcomes son
> realmente medibles HOY, qué cohortes son reales y qué requiere honestidad
> estadística adicional.

---

## 1. Mapa de datos disponibles HOY (verificado en repo)

### 1.1 Intervenciones registradas (PASO 3)
`pedagogical_interventions`:
| Columna | Útil para outcome? |
|---|---|
| `intervention_id` (UNIQUE) | sí — clave para join con outcome |
| `student_id` | sí — scope de análisis |
| `intervention_type` | sí — agrupador para learnings |
| `created_at` | sí — pivote del baseline/follow-up |
| `recommendation_origin` (FK lógico a recommendation_id) | sí — link a la regla que originó |
| `outcome` (pending/improved/no_change/worsened) | manual del docente; PASO 6 lo computa automáticamente desde señales |
| `outcome_at` | timestamp del cierre manual |

**Estado real:** `recordIntervention` se llama desde el UI PASO 5 con
`outcome='pending'` por defecto. `PATCH /interventions/:id/outcome` existe
pero la UI no lo expone aún (documentado PASO 5 §18). PASO 6 calcula
outcome **automáticamente** desde señales (no espera a que el docente lo
marque).

### 1.2 Recomendaciones (PASO 3)
`pedagogical_recommendations`:
- `rule_id`, `recommendation_type`, `severity`, `confidence`, `created_at`,
  `expires_at`, `acknowledged`, `applied`.
- Permite saber **qué regla generó qué recomendación** y si el docente la
  aceptó. Insumo crítico para `institutional_learnings`.

### 1.3 Profiles + Snapshots + Rollups (PASO 2 + 4)
- `user_reading_profiles`: estado actual (UPSERT, snapshot único).
- `signal_snapshots`: estado actual por (user, signal, period=28d) — UNIQUE,
  se sobrescribe.
- `signal_snapshots_history`: **append-only, gated `SNAPSHOT_HISTORY_ENABLED`**.
  Si no estuvo encendido → series temporales incompletas → outcomes degradan
  a `insufficient_data` o caen a fallback (computar baseline desde events.db).
- `daily/weekly/monthly_rollups`: agregaciones globales (scope='all') —
  útiles para institutional learnings agregadas, NO para outcomes individuales.

### 1.4 Riesgos (PASO 3)
`pedagogical_risk_history`:
- `detected_at`, `resolved_at`, `source_signals_json`.
- **Auto-resolve PASO 3** ya cierra riesgos cuando la regla deja de disparar.
  Esto ya es un **proto-outcome**: "riesgo X resuelto N días después de
  intervención Y". PASO 6 lo formaliza con baseline/follow-up medidos.

### 1.5 Memberships institucionales
`groups_db.json` (no SQLite aún): contiene `groups[].memberIds[]`,
`groups[].type` ∈ {course, club}, `groups[].schoolId`. Suficiente para
construir cohortes reales `group:*`, `school:*`, `club:*`. Para `library:*`
no hay scope dedicado en DB (PASO 7 si se requiere).

---

## 2. Respuestas a §4 (obligatorias)

### ¿Qué datos permiten medir outcomes HOY?
- **Intervenciones con `created_at`** → pivote temporal.
- **Eventos en events.db** entre baseline/follow-up windows → ground truth.
- **Profile delta** entre snapshot anterior vs actual (si snapshot_history ON).
- **Signal_snapshots actual** vs **rollups daily/weekly** del scope.
- **Risk history** (auto-resolve_at) → señal binaria de cierre.

### ¿Qué datos faltan?
- **Snapshot history continuo:** sin `SNAPSHOT_HISTORY_ENABLED=1` durante
  el período baseline → caemos a recomputar desde events (más lento + sólo
  para señales que se reconstruyen, no para scores compuestos).
- **Library scope dedicado:** no hay tabla; PASO 7 si llega.
- **Mediator → Group join** denormalizado: groups.mediadores[] existe pero
  para cohortes mediator necesitamos join al revés (mediator_id → users
  bajo su tutela).
- **Tipo de contenido / género:** sigue faltando taxonomía → cohortes
  `modality:` se limitan a `audio_plus_immersive` / `text_only`, no a género.

### ¿Qué intervenciones tienen trazabilidad suficiente?
- Las que tienen `recommendation_origin` (link a regla disparada).
- Las que se registraron con `intervention_type` válido enum corto.
- Las que tienen ≥ 7 días de actividad ANTES y DESPUÉS (window mínima).

### ¿Qué recomendaciones pueden compararse?
- Las del mismo `rule_id` (mismo umbral → contexto comparable).
- Mismo `recommendation_type` con baseline similar (señales iniciales en
  rango ±15%).
- **NO** comparar entre `rule_id` distintos sin normalizar — distorsión.

### ¿Qué señales son confiables para medir mejora?
**ALTA confianza:**
- `continuidad_semanal` (cómputo robusto, distinct days)
- `tiempo_efectivo_lectura` (sum elapsed_ms, sin proxy)
- `abandono_temprano` con `starts ≥ 5` en la ventana

**MEDIA confianza:**
- `persistencia` (denominador chico hasta volumen alto)
- `diversidad_lectora` (depende de catálogo, sesgo de tamaño)

**BAJA confianza (NO usar para outcomes):**
- `fluidez_inferida` (proxy con map palabras incompleto)
- `dificultad_probable` (ponderación sin calibrar)

### ¿Qué señales son débiles?
Mismo set marcado low en PASO 3 audit + PASO 4 audit. No regresamos sobre eso.

### ¿Qué scopes institucionales ya son reales?
- `user:<id>` — siempre.
- `group:<id>` — sí (vía groups_db.json memberIds).
- `school:<id>` — sí (vía groups.schoolId → memberIds).
- `club:<id>` — sí (vía groups.type='club' + memberIds).
- `intervention:<type>` — sí (vía pedagogical_interventions.intervention_type).
- `risk:<rule_id>` — sí (vía pedagogical_risk_history.risk_type).
- `trajectory:recovered_after_risk` — sí (resolved_at IS NOT NULL).
- `habit:high_continuity` — sí (snapshot.continuidad ≥ threshold).
- `modality:audio_plus_immersive` — sí (events.mode events).

### ¿Qué cohortes son solo globales?
Las de `cohort_rollups` PASO 2 (`active_users`, `at_risk_users`, etc.) sólo
tienen scope='all'. PASO 6 introduce `cohort_definitions` con scope real
(user_ids o criteria que filtra).

### ¿Qué cohortes necesitan membership join real?
Todas las "por grupo / colegio / club / biblioteca" requieren join contra
`groups_db.json`. Hoy no hay tabla SQLite intermedia; PASO 6 introduce
`cohort_memberships` que **resuelve este join en cohort builder** y persiste
el resultado (snapshot del membership al momento del build).

### ¿Qué riesgos éticos existen?
1. **Causalidad falsa:** decir "la lectura guiada mejoró X" sin
   contrafactual → PASO 6 usa vocabulario "se observó que después de…".
2. **Ranking docente:** comparar mediators podría ser punitivo → PASO 6
   NO produce ranking de mediator (lista negra de cohort tipo `mediator:`
   con orden).
3. **Etiquetado estudiante:** outcomes son por intervención, NO por
   estudiante. No se persiste "estudiante problemático".
4. **Predicción individual sin validación:** `predictive_risk_patterns`
   guarda patrones AGREGADOS, NO predicciones per-user.
5. **Insufficient_data confundido con resultado positivo:** label
   explícito `insufficient_data` previene falsos positivos.
6. **Leakage entre instituciones:** cohort_memberships valida scope
   isolation (scope_type='school' nunca cruza schoolId).

---

## 3. Decisiones de diseño (constraints reales)

### 3.1 Una sola extensión schema nueva: `server/db/outcomesDbExt.mjs`
Mismo patrón insightsDbExt/pedagogyDbExt/rollupsDbExt: handle paralelo al
MISMO `insights.db`, mismas PRAGMAs, idempotente.

### 3.2 Outcome engine NO espera al docente
Cuando una intervención cumple `now > created_at + OUTCOME_FOLLOWUP_DAYS`,
el engine computa automáticamente:
- baseline desde signal_snapshots_history o fallback events.db
- follow-up desde signal_snapshots actual + events recientes
- delta + classification

`pedagogical_interventions.outcome` queda como **input docente opcional**;
`intervention_outcomes.outcome_label` es el **cómputo automático auditable**.
**Coexisten** — el docente puede ver "el sistema observó IMPROVED, el
docente reportó IMPROVED" o discordancias → input para institutional learning.

### 3.3 Confidence + evidence_level honesto
Cada outcome computa `evidence_level ∈ {low, medium, high}` derivado de:
- volumen de actividad (events count en baseline + follow-up)
- número de señales que mostraron delta consistente (≥ 3 = high)
- ausencia de eventos atípicos (sin replay activo en la ventana)
**NUNCA** "proven" / "causal" / "guaranteed".

### 3.4 Cohort_builder PURO sin scheduler init invasivo
Builder es función pura `buildCohort({criteria}) → membership[]`.
Persistencia separada. Idempotente: re-build sobre la misma definición
+ memberships reemplaza, no acumula.

### 3.5 Predictive patterns NO predicen individuos
Solo registran "secuencia X se ha observado N veces, con resultado
distribuido Y". El uso individual lo decide el docente (PASO 7+ UI).

### 3.6 Recommendation adjustment (§17)
NO modifico interventionEngine. Expongo
`institutionalLearning.getPriorityHints(ruleId)` que retorna multipliers.
El UI o el next-gen interventionEngine pueden consumir; el actual sigue
funcionando idéntico.

---

## 4. Tablas nuevas en `insights.db` (PASO 6 §6)

| Tabla | Propósito |
|---|---|
| `intervention_outcomes` | uno por intervención evaluable; baseline/follow-up + delta + label |
| `cohort_definitions` | definición canónica (cohort_key UNIQUE; criteria_json) |
| `cohort_memberships` | snapshot del membership por cohort + user; idempotente |
| `cohort_trajectories` | series temporales agregadas por cohort + period |
| `institutional_learnings` | aprendizajes prudentes ("observed strategy effect") |
| `predictive_risk_patterns` | secuencias de señales observadas + support_count |

UNIQUE constraints estrictos para idempotencia. Append-only en
`predictive_risk_patterns` (versionado por `version`).

---

## 5. Vocabulario PERMITIDO vs PROHIBIDO (PASO 6)

### PERMITIDO (observacional + estadísticamente honesto)
- "después de esta intervención se observó…"
- "en cohortes comparables se asocia con…"
- "no se observaron cambios significativos"
- "datos insuficientes para evaluar"
- "patrón observado N veces"
- "evidencia baja/media/alta"

### **PROHIBIDO** (causalidad / clínica / inferencia fuerte)
- "esta intervención causó"
- "esta intervención garantiza"
- "este estudiante mejorará"
- "este docente es mejor que"
- "esta estrategia es probada"
- "este patrón predice"
- Cualquier diagnóstico clínico/psicológico (heredado PASO 3 §5).

El motor `outcomeClassifier` jamás emite estas cadenas. El test
`no_causal_language` valida el output.

---

## 6. Estrategia 5000+ usuarios

- **Outcome compute:** O(intervenciones evaluables) — no recorre todos
  los users. Para 5000 users con ~1 intervención/mes → ~5000 outcomes/mes
  computados = ~170/día. Cada uno requiere ~10 queries → ~1.7K queries/día
  manejables con prepared statements + WAL.
- **Cohort build:** O(scopes) — por iteración. Builds cada 6h por
  scheduler.
- **Trajectory analysis:** O(cohorts × periods) — los trajectories quedan
  precomputados para consumo rápido.
- **Predictive patterns:** O(sequences observed) — escaneo en background
  cada 24h.

Bajo carga real, el cuello potencial es la rotación entre snapshot_history
queries (si está ON) y outcomes. Mitigación: outcomes corren en su propio
lock (`outcome_engine`), no compiten con materializer.

---

## 7. Lo que NO se toca (regla del proyecto)

- ❌ Hot path PASO 1/2/3/4/5 (sólo adiciones)
- ❌ Auth, login, onboarding, uploads, runtime inmersivo
- ❌ nginx, Docker
- ❌ Migrar a otro DB (SQLite + WAL + handles paralelos sigue siendo correcto)
- ❌ Deps nuevas
- ❌ `interventionEngine.runOnce` (PASO 6 expone hints PARA su uso futuro;
  no lo modifica)
- ❌ UI `pages/AulaVivaOperacional.tsx` se mantiene; las nuevas secciones
  se agregan por composición de endpoints (PASO 7 UI dedicada)

---

## 8. Roadmap implementable PASO 6

1. **Audit doc** ← este (§4 mandate).
2. **`server/db/outcomesDbExt.mjs`** — 6 tablas + statements.
3. **`server/pedagogy/outcomeClassifier.js`** — pure rules de clasificación.
4. **Engines**:
   - `server/services/outcomeEngine.mjs` — main runner.
   - `server/services/cohortBuilder.mjs` — builds cohort definitions + memberships.
   - `server/services/trajectoryAnalyzer.mjs` — series temporales por cohort.
   - `server/services/institutionalLearning.mjs` — learnings prudentes.
   - `server/services/predictivePatterns.mjs` — secuencias observadas.
   - `server/services/interventionImpactTracker.mjs` — reader API agregado.
5. **Métricas** — +8 en `metrics.js`, cardinalidad fija.
6. **Healthcheck** — +5 checks en `analyticsHealth.js`.
7. **Scheduler** — +5 loops gated en `scheduler.mjs`.
8. **Operational router** — endpoints `/api/aula-viva/outcomes/*` y
   `/cohorts/definitions` (extender existente sin reemplazar nada).
9. **Insight reader** — funciones `getOutcomesForUser`,
   `getCohortTrajectory`, `getInstitutionalLearnings`.
10. **Tests** — `server/__test__/outcomesEngine.test.js` (25+ checks).
11. **Doc final** — `docs/AULA-VIVA-PASO-6-OUTCOMES.md`.

Todo aditivo, default-OFF, reversible, cero deps.
