# AULA VIVA — PASO 7 · AUDITORÍA PRODUCTO / UX / PEDAGÓGICA (PRE-IMPLEMENTACIÓN)

> Mandato §3. Mapeo honesto de qué inteligencia ya existe HOY (PASO 1-6),
> qué de eso aparece en la UI actual, y qué falta exponer para que la
> institución pueda **usar** lo que ya está construido.

---

## 1. Inventario backend HOY (PASO 1-6) — qué inteligencia ya existe

| Capa | Engine / DB | Estado |
|---|---|---|
| Eventos canónicos | `events.db`, `eventsService`, `analyticsShadow` | ✅ activo PASO 1 |
| Read-model insights | `insights.db` + `insightMaterializer` | ✅ activo PASO 2 |
| Recomendaciones / Riesgos | `interventionEngine` + `pedagogical_*` tablas | ✅ activo PASO 3 |
| Rollups + Features + Replay + Leader | `rollupsEngine`, `featureExtractor`, `replayEngine`, `leaderElection` | ✅ activo PASO 4 |
| Centro operativo UI | `pages/AulaVivaOperacional.tsx` + `services/aulaVivaOperationalService.ts` | ✅ activo PASO 5 (17 endpoints REST) |
| Outcomes / Cohorts / Trajectories / Learnings / Patterns | `outcomeEngine`, `cohortBuilder`, `trajectoryAnalyzer`, `institutionalLearning`, `predictivePatterns`, `interventionImpactTracker` | ✅ activo PASO 6 — **NO expuestos vía REST** |

---

## 2. Frontend existente — qué muestra HOY

### Componentes en `components/aula-viva/` (12 totales)
```
Pre-PASO 5: CompetencyBar, DistributionChart, GroupDiagnosisPanel,
            ProgressBar, StudentRow, StudentStatusPanel, TrendChart
PASO 5:     DegradedModeBanner, EmptyState, RecommendationCard,
            RiskBadge, Sparkline
```

### Páginas
- `pages/AulaViva.tsx` — 2656 líneas, intacta desde PASO 5
- `pages/AulaVivaOperacional.tsx` — PASO 5, ~400 líneas; muestra:
  - KPIs (estudiantes en atención, recomendaciones activas, continuidad, lectores activos)
  - Lista "Estudiantes que necesitan atención hoy"
  - Detalle de recomendaciones por estudiante seleccionado
  - Cohort comparison `all/global` (4 métricas con sparklines mínimos)
  - Footer estado del sistema

### Endpoints `/api/aula-viva/*` activos (PASO 5)
17 endpoints en `operationalRouter.mjs`:
- /students/:id/timeline, /feature-vector, /risk-history, /signals/.../timeline
- /recommendations, /recommendations/scope/..., POST ack/dismiss
- /interventions, PATCH /interventions/:id/outcome
- /cohorts/:type/:id (comparison existente)
- /cohorts/:type/:id/rollups (daily/weekly/monthly)
- /students-needing-attention
- /job-ledger, /operational/status
- /_track/empty-state, /_track/degraded-mode

---

## 3. Gaps críticos — inteligencia que existe backend pero NO aparece en UI

| Servicio PASO 6 | API HTTP | UI |
|---|---|---|
| `outcomeEngine` (intervention_outcomes) | ❌ no expuesto | ❌ invisible |
| `cohortBuilder` (cohort_definitions + memberships) | ❌ no expuesto (solo cohort_rollups via PASO 2) | ❌ invisible |
| `trajectoryAnalyzer` (cohort_trajectories) | ❌ no expuesto | ❌ invisible |
| `institutionalLearning` (institutional_learnings) | ❌ no expuesto | ❌ invisible |
| `predictivePatterns` (predictive_risk_patterns) | ❌ no expuesto | ❌ invisible |
| `interventionImpactTracker.getImpactByInterventionType` | ❌ no expuesto | ❌ invisible |
| `interventionImpactTracker.getFollowupQueue` | ❌ no expuesto | ❌ invisible |
| `institutionalLearning.getPriorityHints` | ❌ no expuesto | ❌ invisible |

**Diagnóstico:** PASO 6 generó datos potentes que NUNCA viajan al frontend. PASO 7
debe construir el **bridge REST + UI** sobre esos datasets.

---

## 4. Respuestas a las preguntas obligatorias §3

### ¿Qué inteligencia ya existe backend pero NO aparece frontend?
- TODA la capa PASO 6 (outcomes, cohort trajectories, institutional learnings,
  predictive patterns, intervention impact).
- `feature_vectors` (PASO 4) — IA-ready pero sin lectura UI.
- `snapshot_history` (PASO 4) — append-only timelines invisibles.
- `job_ledger` se expone pero no se renderiza.

### ¿Qué paneles siguen siendo demasiado técnicos?
- Footer "Estado del sistema: operacional · última actualización XX:XX"
  no explica al docente qué significa.
- DegradedModeBanner muestra texto técnico ("Job stalled") cuando
  debería decir "Algunos datos pueden estar atrasados".
  → en realidad ya lo hace correctamente; documentado.

### ¿Qué datos abruman?
- Lista "Estudiantes que necesitan atención" con `abandono_risk` numérico
  (0.85) — más claro como "alto riesgo". Necesita visualización
  cualitativa.
- Cohort comparison muestra 4 métricas sin contexto temporal — necesita
  trend (no solo delta_vs_global).

### ¿Qué visualizaciones son débiles?
- Sparkline de 2 puntos (PASO 5) — necesita ≥ 7 puntos para ser informativo.
  Solución: usar `daily_rollups` PASO 4 → 7-30 puntos reales.
- Falta heatmap de continuidad por día (clásico)
- Falta curva de recuperación cohort
- Falta gráfico de distribución de outcomes (improved/stable/worsened)

### ¿Qué workflows están incompletos?
- **Cerrar intervención con outcome** — endpoint existe (PATCH
  `/interventions/:id/outcome`), UI no expone el botón.
- **Revisar outcomes pasados de un estudiante** — endpoint nuevo
  necesario; sin él la docente no sabe si la intervención previa funcionó.
- **Comparar estrategias institucionalmente** — `institutional_learnings`
  existe pero sin UI.

### ¿Qué comparativas faltan?
- Group vs school baseline
- Intervention type performance ranking (cuidado: no es ranking docente)
- Cohort recovery curves over time

### ¿Qué outcomes son invisibles?
- TODOS los `intervention_outcomes`. La UI PASO 5 no los conoce.

### ¿Qué longitudinalidad sigue enterrada?
- Snapshot_history (gated, opcional)
- Cohort trajectories (no expuestas)
- Outcomes (no expuestas)
- Risk_history resolved/active timeline visual

### ¿Qué experiencias no escalan institucionalmente?
- Hoy solo hay vista `attention queue` global. Falta:
  - Vista por grupo (mediador ve solo SU grupo)
  - Vista por colegio (coordinador ve agregado school)
  - Vista por biblioteca (bibliotecario ve circulación/género/horario)
  - Vista por club (líder de club ve continuidad colectiva)

---

## 5. Decisiones críticas (constraints respetando reglas)

### 5.1 NO añadir librería de charts
PASO 5 ya estableció SVG puro. Continuamos. Añado primitivas SVG nuevas:
- `CohortTrajectorySVG.tsx` — línea longitudinal con eje temporal
- `OutcomeDistributionBars.tsx` — barras horizontales improved/stable/worsened
- `ContinuityHeatmap.tsx` — grid 7-días × N-semanas
- `RecoveryCurveSVG.tsx` — % cohort recuperándose vs días post-intervención

### 5.2 NO reescribir `AulaVivaOperacional.tsx`
La extiendo con un **tab switcher** mínimo: "Operativo" (existente) +
"Institucional" (nuevo). Cero rewrite, solo aditivo.

### 5.3 NO crear páginas nuevas separadas
Una sola página con tabs preserva navegación y reduce mental load.

### 5.4 NO añadir nuevos middleware auth
Reuso `requireUserAuth` ya inyectado por server.js.

### 5.5 NO modificar `operationalRouter.mjs`
Creo `institutionalRouter.mjs` en paralelo. Express monta ambos al
mismo prefijo `/api/aula-viva/*`; sus paths no se solapan (institutional
usa `/institutional/*` como sub-prefijo).

### 5.6 Scope isolation reforzada
Cada endpoint nuevo recibe `x-user-id` + valida que el caller tiene
permiso sobre el scope solicitado (lookup en `users_db.json` para
role + `groups_db.json` para membership). Implementación: helper
`checkScopeAccess(userId, scope_type, scope_id)` que retorna boolean.
Default-deny.

---

## 6. Arquitectura UI objetivo (extensión PASO 7)

```
/aula-viva/operacional (existente PASO 5)
│
├── Tab: "Operativo" (PASO 5 — intacto)
│    └── KPIs + Attention Queue + Recommendations + Cohort Comparison
│
└── Tab: "Institucional" (PASO 7 — nuevo) ← scope switcher visible aquí
     ├── ScopeSwitcher: student | group | school | library | club
     ├── Sección "Outcomes recientes"
     │    └── OutcomeDistributionBars (improved/stable/worsened)
     │    └── lista clickable de outcomes detallados
     ├── Sección "Trayectorias de cohorte"
     │    └── CohortTrajectorySVG por scope
     ├── Sección "Aprendizajes institucionales"
     │    └── InstitutionalLearningCard (con confidence + evidence)
     ├── Sección "Seguimiento pendiente"
     │    └── lista de intervenciones con followup vencido (impact tracker)
     └── Sección "Patrones observados"
          └── PredictivePatternsList (read-only, no per-user)
```

---

## 7. Endpoints REST nuevos (§5) — diseño

Todos bajo `/api/aula-viva/institutional/*`:

| Método | Path | Service |
|---|---|---|
| GET | `/institutional/outcomes/by-type/:type` | `impactTracker.getImpactByInterventionType` |
| GET | `/institutional/outcomes/scope/:scope_type/:scope_id` | `impactTracker.getImpactSummary` |
| GET | `/institutional/outcomes/follow-up-queue` | `impactTracker.getFollowupQueue` |
| GET | `/institutional/cohorts/definitions` | listado cohort_definitions activas |
| GET | `/institutional/cohorts/by-type/:type` | filtrado por cohort_type |
| GET | `/institutional/cohorts/:cohort_id/members` | `cohort_memberships` |
| GET | `/institutional/cohorts/:cohort_id/trajectory` | `cohort_trajectories` series |
| GET | `/institutional/learnings/scope/:type/:id` | `institutional_learnings` por scope |
| GET | `/institutional/learnings/global` | scope=('all','global') |
| GET | `/institutional/patterns/recent` | `predictive_risk_patterns` activos |
| GET | `/institutional/comparative/strategies` | comparativa por intervention_type (agregado) |
| GET | `/institutional/profile/:userId` | wrapper enriquecido (timeline + outcomes + features) |
| GET | `/institutional/status` | status agregado para UI tab |

### Garantías por endpoint
- Recovery-first (200 con `{stale:true}` en error)
- Scope isolation (`x-user-id` + role check)
- Cacheables (TTL header 60s en GETs no críticos)
- Paginados con `limit` (default 50, max 200)
- Instrumentados con `queryProfiler.instrument(endpoint_id, ...)`

---

## 8. Performance targets §18 — instrumentación

| Endpoint | Target | Cómo se mide |
|---|---|---|
| Student profile | <120ms | `chibalete_dashboard_latency_ms{endpoint='student_profile'}` p95 |
| Teacher attention queue | <150ms | idem `attention_queue` |
| Institution (institutional/status) | <500ms | idem `institutional_status` |
| Cohorts (institutional/cohorts/definitions) | <700ms | idem `cohort_definitions` |
| Trajectories (institutional/cohorts/:id/trajectory) | <700ms | idem `cohort_trajectory` |
| Institutional learnings | <400ms | idem `learnings_scope` |

Cada uno envuelto en `instrument()` de `queryProfiler.mjs` PASO 4. Slow
queries se persisten en `slow_query_log` automáticamente.

---

## 9. Riesgos a vigilar (§3)

### Riesgos UX
- Tab "Institucional" puede saturar si muestra todo a la vez → cada
  sección colapsable, default expanded solo "Outcomes recientes".
- Mobile: tabla de outcomes con muchas columnas no cabe → priorizar
  3 columnas en mobile (intervention_type, label, days_ago).
- Latencia visible: usar skeleton loaders pequeños, NUNCA spinner infinito.

### Riesgos institucionales
- Ranking docente: NUNCA endpoint `/institutional/mediators/ranking`.
- Comparativa entre colegios: solo "vs línea base global anónima",
  NUNCA nombrando otros colegios.
- Datos de estudiantes individuales visibles solo si caller tiene
  membership en el scope. `scope_type='user'` requiere ser mediator
  del grupo del user o admin.

### Riesgos overload visual
- Max 3 secciones expandidas por defecto.
- Sparklines, NO gauges grandes.
- 3 colores accent únicos (verde mejora, ámbar moderate, rojo crítico).

### Riesgos éticos
- Vocabulario observacional heredado de PASO 6 (`containsForbiddenVocab`).
- UI NUNCA construye su propia explicación — solo renderiza el campo
  `explanation` que viene del backend.

---

## 10. Qué NO mostrar (vigilado en código)

- Listas que ranken docente vs docente.
- Listas que comparen colegio X vs colegio Y nombrado.
- Etiquetas clínicas heredadas del backend (bloqueadas mecánicamente).
- Recomendaciones cuya `confidence < MIN_DISPLAY` (futuro: 0.4).
- Outcomes `insufficient_data` mezclados con outcomes con evidencia
  alta — UI los separa visualmente.
- Predicciones per-user (`predictive_risk_patterns` se muestra como
  agregado, no per-student).

---

## 11. Qué NO automatizar (cumple §10)

- Sugerencias automáticas de intervención sin confirmar docente.
- Cambio automático de plan del estudiante.
- Email/push a familia.
- Cierre automático de intervención sin revisión humana.
- Aplicar `getPriorityHints` automáticamente al UI sin que el docente
  lo vea — el hint se muestra como sugerencia visible, no como filtro
  invisible.

---

## 12. Estrategia multi-scope §12

| Scope | Quién accede | KPIs visibles |
|---|---|---|
| student | docente del estudiante, admin | timeline + outcomes + recs activas |
| group | mediator del grupo, admin | attention queue del grupo + cohort traj |
| school | coordinador del school, admin | aggregate by-type outcomes + cohort traj |
| library | bibliotecario (rol futuro) | circulación + diversidad + horarios |
| club | líder de club, admin | continuidad colectiva + persistencia grupal |
| mediator | el propio mediator | sus grupos + sus intervenciones registradas |
| institution | admin | learnings + patterns recientes |

Implementación: scope switcher en UI + endpoints aceptan `scope_type`/
`scope_id` param. Auth check: `requireUserAuth` valida user; el
endpoint additionalmente valida que el user tenga el rol/membership
necesario para ese scope.

---

## 13. Estrategia mobile §16

- Layout: 1 columna en mobile, 2 en tablet, 3 en desktop.
- Tabs en mobile: dropdown selector (no tabs horizontales que se cortan).
- Sparklines: redimensionan vía CSS `width:100%` con `aspect-ratio`.
- Tablas largas: scroll horizontal con sombra-pista (gradient overlay).
- Heatmap continuidad: en mobile reduce a 7d × 4-semanas; en desktop
  amplía a 7d × 12-semanas.

---

## 14. Estrategia institucional §15-16

PASO 7 entrega:
1. Endpoints REST (datos disponibles para cualquier UI futura).
2. UI tab "Institucional" en `AulaVivaOperacional` con scope switcher.
3. Componentes SVG composables reutilizables.

NO entrega (queda para PASO 8 si hay demanda):
- Páginas dedicadas `/aula-viva/biblioteca`, `/aula-viva/club` con UX
  específica de cada experiencia institucional.
- App mobile nativa.
- Exportes PDF/CSV.
- Notifications push institucionales.

Razón: el riesgo de fragmentar la UI en N páginas dispersas es mayor
que el beneficio si no hay todavía adopción real de cada rol.

---

## 15. Roadmap implementable PASO 7

1. **Audit doc** ← este (§3 obligatorio).
2. **Backend institutional layer**:
   - `server/aulaViva/institutionalRouter.mjs` — 13 endpoints nuevos
     (no toca `operationalRouter`).
   - Helper `scopeAccess.mjs` para validación role/membership por scope.
3. **Wiring en server.js**: 1 línea `app.use('/api/aula-viva',
   createInstitutionalRouter(...))` — mismo prefijo, paths no solapan.
4. **Métricas (§19)**: +8 en `metrics.js`, cardinalidad fija.
5. **Healthcheck (§20)**: +1 check `institutional_api` (estados
   agregados de los engines ya cubren el resto: outcome_engine,
   cohort_builder, etc.).
6. **Tests backend**: `server/__test__/aulaVivaInstitutional.test.js`
   con scope isolation testada exhaustivamente + 5000-user synthetic
   read load.
7. **Frontend extension**:
   - `services/aulaVivaInstitutionalService.ts` (cliente HTTP cacheable).
   - 4 componentes SVG nuevos en `components/aula-viva/`:
     `CohortTrajectorySVG`, `OutcomeDistributionBars`,
     `ContinuityHeatmap`, `InstitutionalLearningCard`.
   - `ScopeSwitcher.tsx` (dropdown/tabs).
   - `pages/AulaVivaOperacional.tsx` — diff mínimo: agregar tab
     selector y render condicional `<InstitutionalTab>`.
8. **Doc final** — `docs/AULA-VIVA-PASO-7-PRODUCTO-INSTITUCIONAL.md`.

Todo ADITIVO, DEFAULT-OFF cuando aplica, REVERSIBLE.

---

## 16. Lo que NO se toca

- ❌ `pages/AulaViva.tsx` (2656 líneas — intacta desde PASO 5)
- ❌ Hot path PASO 1-6 (sólo adiciones)
- ❌ `operationalRouter.mjs` (router paralelo nuevo)
- ❌ Auth middleware (reuso `requireUserAuth`)
- ❌ Runtime inmersivo, nginx, Docker
- ❌ Engines PASO 1-6 (solo se consumen vía import o reader API)
- ❌ Schema DB (cero migraciones — todo via imports de las 4 ext
  existentes: insights, pedagogy, rollups, outcomes)
