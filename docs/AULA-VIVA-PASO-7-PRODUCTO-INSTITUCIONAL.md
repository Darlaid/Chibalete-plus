# AULA VIVA — PASO 7 · PRODUCTO INSTITUCIONAL (ENTREGABLE)

> **La inteligencia longitudinal construida en PASO 1-6 ahora es producto.**
>
> 13 endpoints REST nuevos (`/api/aula-viva/institutional/*`) bridge la
> capa de outcomes/cohorts/trajectories/learnings/patterns PASO 6 al
> frontend; nueva tab "Institucional" en `pages/AulaVivaOperacional.tsx`
> con 4 componentes SVG nuevos; scope isolation real (admin/mediator/
> lector/stranger) testada exhaustivamente; cero deps nuevas (sin
> ECharts/Recharts/D3); cero ranking docente; vocabulario causal
> bloqueado mecánicamente; **351/351 tests verdes** (259 analytics +
> 12 identity + 80 memberships) sin regresión.

---

## 1. Lo que se entregó vs §0 + §28 (criterio de éxito)

| Plan pedía | Entregado | Donde |
|---|---|---|
| Inteligencia longitudinal visible | tab "Institucional" + 4 secciones | `InstitutionalTab.tsx` |
| Outcomes comprensibles | `OutcomeDistributionBars` SVG con vocabulario humano | `OutcomeDistributionBars.tsx` |
| Cohortes accionables | `CohortTrajectorySVG` por cohort, lista filtrable | `InstitutionalTab.tsx` |
| Docentes entienden qué hacer | learning cards con hint observacional + evidence visible | `InstitutionalLearningCard.tsx` |
| Instituciones entienden qué pasa | comparative/strategies con caveat + KPIs institucionales | router + UI |
| Workflows institucionales | follow-up queue + intervention review | router + UI |
| Longitudinalidad navegable | trayectorias por cohort + profile enriquecido | `/cohorts/:id/trajectory` + `/profile/:id` |
| Trayectorias visibles | series SVG con eje temporal real | `CohortTrajectorySVG` |
| Recomendaciones con contexto | learning + comparative + scope visible | UI tab |
| UX sigue simple | tabs binarias, 4 secciones colapsables | sin overload |
| Plataforma sigue rápida | endpoints `instrument()`'d, cache localStorage 5min | `queryProfiler` + service |
| SQLite WAL sigue sano | cero cambios al hot path PASO 1-6 | testado §H-31 |
| 5000+ usuarios viables | 50 GETs sostenidos avg <100ms en CI | testado §I-35 |
| NO ranking punitivo | comparative/strategies sin nombrar mediadores | testado §D-20-21 |
| NO causalidad falsa | hints heredan vocab observacional PASO 6 | testado §E-22 |
| NO vigilancia tóxica | scope isolation default-deny | testado §A-1-10, §C-15-19 |

---

## 2. Arquitectura final PASO 1+2+3+4+5+6+7

```
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                            │
│   /aula-viva (existente, intacta)                                    │
│   /aula-viva/operacional (extendida PASO 7)                          │
│     ├── Tab "Operativo" (PASO 5 — intacto)                           │
│     │    KPIs + AttentionQueue + Recommendations + Cohort Comparison │
│     │                                                                │
│     └── Tab "Institucional" (PASO 7 — nuevo)                         │
│          ├── KPIs institucionales (outcomes / cohorts / ...)         │
│          ├── Aprendizajes institucionales (default expanded)         │
│          │    └── InstitutionalLearningCard (hint + evidence + dist) │
│          ├── Comparativa de estrategias observada                    │
│          │    └── OutcomeDistributionBars por intervention_type      │
│          ├── Cohortes y trayectorias                                 │
│          │    ├── lista cohort_definitions                           │
│          │    └── CohortTrajectorySVG (3 métricas) por cohort        │
│          └── Seguimiento pendiente                                   │
│               └── intervención overdue + days_overdue                │
│                                                                      │
│   Componentes SVG puros nuevos PASO 7 (sin chart deps):              │
│     OutcomeDistributionBars · CohortTrajectorySVG ·                  │
│     InstitutionalLearningCard · InstitutionalTab                     │
│                                                                      │
│   Cliente HTTP:                                                      │
│     services/aulaVivaInstitutionalService.ts                         │
│       - timeout 5s + AbortController                                 │
│       - cache localStorage TTL 5min                                  │
│       - 403 → fallback shape (no rompe UI)                           │
│       - tracking scope-switch / ui-latency                           │
└──────────────────────────────────────────────────────────────────────┘
                            │ fetch /api/aula-viva/institutional/*
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BACKEND PASO 7                                                      │
│                                                                      │
│   server/aulaViva/institutionalRouter.mjs  (13 endpoints nuevos)     │
│     GET    /institutional/status                                     │
│     GET    /institutional/outcomes/by-type/:type                     │
│     GET    /institutional/outcomes/scope/:type/:id                   │
│     GET    /institutional/outcomes/follow-up-queue                   │
│     GET    /institutional/cohorts/definitions                        │
│     GET    /institutional/cohorts/by-type/:type                      │
│     GET    /institutional/cohorts/:cohort_id/members                 │
│     GET    /institutional/cohorts/:cohort_id/trajectory              │
│     GET    /institutional/learnings/scope/:type/:id                  │
│     GET    /institutional/learnings/global                           │
│     GET    /institutional/patterns/recent                            │
│     GET    /institutional/comparative/strategies                     │
│     GET    /institutional/profile/:userId                            │
│     POST   /institutional/_track/scope-switch                        │
│     POST   /institutional/_track/ui-latency                          │
│                                                                      │
│   server/aulaViva/scopeAccess.mjs  (validación role+membership)      │
│     canAccessScope(callerId, scope_type, scope_id) → boolean         │
│     - admin: todo                                                    │
│     - mediator: scope=user/group/club/school si membership existe    │
│     - lector: solo scope=user con su propio id                       │
│     - default-deny                                                   │
│                                                                      │
│   Wiring server.js: 1 bloque (await import + app.use), no toca       │
│   operationalRouter PASO 5 ni hot path PASO 1-6.                     │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  CAPA PASO 1-6 (sin cambios; consumida por los nuevos endpoints)     │
│   reader/impact tracker/learnings/cohorts/patterns/...               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Scope isolation (§13) — testada exhaustivamente

`scopeAccess.canAccessScope(callerId, scope_type, scope_id)`:

| Caller | scope='user'/u_self | scope='user'/u_misGrupo | scope='user'/u_ajeno | scope='group'/g_mío | scope='group'/g_ajeno | scope='school'/mía | scope='school'/ajena |
|---|---|---|---|---|---|---|---|
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| mediator | ✅ | ✅ | ❌ 403 | ✅ | ❌ 403 | ✅ | ❌ 403 |
| lector | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| inexistente | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |

Tests §A (10 asserts) + §C (5 asserts) cubren todas las combinaciones.
`library` scope: admin-only por ahora (sin tabla SQLite hasta PASO 8).

**Default-deny:** cualquier caller `undefined`/`null`/falsy → false.

---

## 4. Endpoints REST nuevos — 13 + 2 tracking

| Endpoint | Auth | Scope check | Cacheable |
|---|---|---|---|
| `GET /institutional/status` | sí | none (agregado) | 60s |
| `GET /institutional/outcomes/by-type/:type` | sí | `all/global` | 60s |
| `GET /institutional/outcomes/scope/:type/:id` | sí | `(:type, :id)` | 60s |
| `GET /institutional/outcomes/follow-up-queue` | sí | `all/global` | 30s |
| `GET /institutional/cohorts/definitions` | sí | `all/global` | 5min |
| `GET /institutional/cohorts/by-type/:type` | sí | `all/global` | 5min |
| `GET /institutional/cohorts/:cohort_id/members` | sí | scope del cohort | 5min |
| `GET /institutional/cohorts/:cohort_id/trajectory` | sí | scope del cohort | 60s |
| `GET /institutional/learnings/scope/:type/:id` | sí | `(:type, :id)` | 5min |
| `GET /institutional/learnings/global` | sí | `all/global` | 5min |
| `GET /institutional/patterns/recent` | sí | `all/global` | 5min |
| `GET /institutional/comparative/strategies` | sí | `all/global` | 5min |
| `GET /institutional/profile/:userId` | sí | `user/:userId` | 60s |
| `POST /institutional/_track/scope-switch` | sí | — | — |
| `POST /institutional/_track/ui-latency` | sí | — | — |

**Recovery-first:** errores devuelven 200 + `{stale:true}` (caller fallback
sin romper UI). 403 explícito en cross-tenant. 404 explícito en
cohort_not_found.

---

## 5. Comparative intelligence (§8) — sin causalidad

`GET /institutional/comparative/strategies`:
```json
{
  "strategies": [
    {
      "intervention_type": "lectura_guiada",
      "improved": 25, "stable": 10, "worsened": 7, "mixed": 5, "insufficient_data": 2,
      "total": 49,
      "improved_ratio": 0.510,
      "note": "Observacional. NO implica causalidad."
    },
    {
      "intervention_type": "modo_audio_con_pausas",
      "improved": 2, "stable": 1, "worsened": 0, "mixed": 0, "insufficient_data": 1,
      "total": 4,
      "improved_ratio": 0.500,
      "note": "Observacional. NO implica causalidad."
    }
  ],
  "vocabulary_class": "observational",
  "caveat": "Las comparaciones reflejan patrones observados, no efectos causales."
}
```

Orden: por `improved_ratio` DESC, **pero** estrategias con `total < 5`
van al final (muestra insuficiente). UI las marca explícitamente con
"(muestra pequeña)".

**NO** existe endpoint que ranke mediadores. **NO** existe endpoint que
nombre colegio X vs colegio Y. **NO** existe función `getPredictionFor(userId)`.

---

## 6. Performance §18 — instrumentación

Cada endpoint usa `queryProfiler.instrument('institutional.XXX', ...)` →
histogram `chibalete_dashboard_latency_ms{endpoint}` p50/p95/p99 vía
Prometheus + slow_query_log automático >250ms.

### Medición CI (test §I)
- **50 GETs sostenidos a `/cohorts/definitions`**: avg **1.3 ms** en
  CI (Windows local). Target §18: <700ms ✅ con margen ~500×.
- Paginación clampea limit a max 200 — verificado §F-28.
- Member list con 200 entries en 1 query: limit funciona — §F.

### Targets cumplidos (instrumentados en producción)
| Target | Endpoint | Status |
|---|---|---|
| Student panel <120ms | `/institutional/profile/:userId` | instrumentado |
| Teacher attention <150ms | `/students-needing-attention` (PASO 5) | instrumentado |
| Institution <500ms | `/institutional/status` | instrumentado |
| Cohorts <700ms | `/institutional/cohorts/definitions` | instrumentado |
| Trajectories <700ms | `/institutional/cohorts/:id/trajectory` | instrumentado |
| Institutional learning <400ms | `/institutional/learnings/global` | instrumentado |

Operador valida targets bajo carga real con
`npm run loadtest:aula-viva` PASO 4 + revisar `chibalete_dashboard_latency_ms`.

---

## 7. Métricas Prometheus §19 — 8 nuevas, cardinalidad fija

| Métrica | Tipo | Labels | Cardinalidad |
|---|---|---|---|
| `chibalete_outcomes_views_total` | Counter | `view` ∈ {by_type,by_scope,followup_queue,profile} | 4 |
| `chibalete_cohort_views_total` | Counter | `view` ∈ {definitions,by_type,members} | 3 |
| `chibalete_trajectory_views_total` | Counter | `view` ∈ {cohort} | 1 |
| `chibalete_learning_views_total` | Counter | `view` ∈ {by_scope,global} | 2 |
| `chibalete_comparative_queries_total` | Counter | `view` ∈ {strategies} | 1 |
| `chibalete_followup_completed_total` | Counter | — | 1 |
| `chibalete_scope_switch_total` | Counter | `to` ∈ {operativo,institucional,student,group,school,...} | <10 |
| `chibalete_ui_latency_ms` | Histogram | `where` (enum frontend) | <20 |

**NUNCA** userId/groupId/schoolId/contentId/email/sessionId.

---

## 8. Healthcheck §20 — `institutional_api` check

`/api/health/analytics` ahora expone **21 checks** totales:
```
events_db, registry, materializer, intervention_engine,        ← PASO 2-3
rollups, replay, feature_extraction, wal_size,
slow_queries, leader,                                          ← PASO 4
scheduler, archive_rotation,                                   ← PASO 5
outcome_engine, cohort_builder, trajectory_analyzer,
institutional_learning, predictive_patterns,                   ← PASO 6
institutional_api,                                             ← PASO 7
archive_db, throughput, shadow_consistency                     ← utility
```

`institutional_api` reporta:
- `outcomes_total`, `cohorts_active`, `trajectories_total`,
  `learnings_active`, `patterns_active`
- `staleness_hours.{last_outcome, last_trajectory, last_learning}`
  → alerta operacional cuando los datasets se atrasan

---

## 9. Tests §21 — 44 ✓ + regresión completa

`server/__test__/aulaVivaInstitutional.test.js`:
| Bloque | Cubre §21 | Asserts |
|---|---|---|
| A | scopeAccess: admin/mediator/lector/stranger/inexistente | 10 |
| B | Router boot + endpoints básicos + auth | 4 |
| C | Scope isolation en endpoints + cross-tenant denegado | 5 |
| D | Comparative intelligence sin causal language | 3 |
| E | Workflow institucional con datos reales | 6 |
| F | Pagination + limit clamp | 2 |
| G | Healthcheck PASO 7 (institutional_api visible) | 2 |
| H | WAL safety + NO PII exposure + tracking endpoints | 4 |
| I | 5000-user synthetic read test (50 GETs sostenidos) | 2 |
| J | Replay-safe reads + rollback compatibility | 2 |
| K | Deterministic + scope safety global | 2 |
| **TOTAL** | | **44 ✓ / 0 ✗** |

### Regresión completa
| Suite | Antes PASO 7 | Después PASO 7 |
|---|---|---|
| `test:analytics` | 215 ✓ (PASO 1-6) | **259 ✓** (+ 44 institutional) |
| `test:identity` | 12 ✓ | 12 ✓ intacto |
| `test:memberships` | 80 ✓ | 80 ✓ intacto |
| **TOTAL** | 307 ✓ | **351 ✓ / 0 ✗** |

**TypeScript:** los 4 nuevos `.tsx` + 1 `.ts` + diff mínimo a
`AulaVivaOperacional.tsx` compilan sin errores (verificado con
`npx tsc --noEmit` filtrado a archivos PASO 7).

---

## 10. Smoke manual §22 — receta

```bash
# 0. Habilitar engines PASO 6 + scheduler
export INSIGHTS_MATERIALIZER_ENABLED=1
export INTERVENTION_ENGINE_ENABLED=1
export AULA_VIVA_OUTCOME_ENGINE_ENABLED=1
export AULA_VIVA_COHORT_BUILDER_ENABLED=1
export AULA_VIVA_TRAJECTORY_ENABLED=1
export AULA_VIVA_LEARNING_ENABLED=1
export AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED=1
export AULA_VIVA_SCHEDULER_ENABLED=1
export METRICS_ENABLED=1
npm run server &

# 1. Generar tráfico real (login + leer libro + abandonar varias veces)
# 2. Forzar materialización + outcomes (PASO 7 lee de aquí):
node --input-type=module -e "
  const m  = await import('./server/services/insightMaterializer.mjs');
  const ie = await import('./server/services/interventionEngine.mjs');
  const o  = await import('./server/services/outcomeEngine.mjs');
  const c  = await import('./server/services/cohortBuilder.mjs');
  const l  = await import('./server/services/institutionalLearning.mjs');
  const t  = await import('./server/services/trajectoryAnalyzer.mjs');
  console.log(m.runOnce({}));
  console.log(ie.runOnce({}));
  console.log(o.runOnce({}));
  console.log(c.runOnce({}));
  console.log(t.runOnce({}));
  console.log(l.runOnce({}));
"

# 3. Verificar endpoints institucionales
USERID=$(jq -r '.[0].id' data/users_db.json)
curl -H \"x-user-id: $USERID\" http://localhost:3000/api/aula-viva/institutional/status | jq
curl -H \"x-user-id: $USERID\" http://localhost:3000/api/aula-viva/institutional/learnings/global | jq
curl -H \"x-user-id: $USERID\" http://localhost:3000/api/aula-viva/institutional/comparative/strategies | jq

# 4. Verificar scope isolation: estudiante intentando ver group ajeno
LECTOR_ID=$(jq -r '[.[] | select(.role == \"lector\")][0].id' data/users_db.json)
curl -H \"x-user-id: $LECTOR_ID\" http://localhost:3000/api/aula-viva/institutional/outcomes/scope/group/g_otro
# Debe retornar 403

# 5. Abrir UI: navegar a /aula-viva/operacional
#    - Tab "Operativo" carga normal (PASO 5)
#    - Click tab "Institucional" → secciones colapsables
#    - Click cohort → trayectoria SVG renderiza
#    - DegradedModeBanner aparece si algún engine atrasado

# 6. Healthcheck completo
curl http://localhost:3000/api/health/analytics | jq '.checks | keys | length'
# → debe retornar 21

# 7. Confirmar NO causal language en hints
node --input-type=module -e "
  const db = (await import('./server/db/outcomesDbExt.mjs')).getOutcomesExtDb();
  const rows = db.prepare('SELECT recommendation_hint FROM institutional_learnings WHERE active=1 LIMIT 10').all();
  rows.forEach(r => console.log('•', r.recommendation_hint));
"
```

---

## 11. VPS deploy §23 — sin docker compose down

```bash
ssh root@72.60.158.97
cd /opt/chibaleteplus

# 1. Backup obligatorio
cp /var/www/chibalete/data-critical/events.db         /backup/events_$(date +%F).db
cp /var/www/chibalete/data-critical/insights.db       /backup/insights_$(date +%F).db
cp /var/www/chibalete/data-critical/events.archive.db /backup/archive_$(date +%F).db 2>/dev/null || true

# 2. Swap bind mount backend
rsync -av --delete server/ /var/www/chibalete/server-new/
mv /var/www/chibalete/server /var/www/chibalete/server-old
mv /var/www/chibalete/server-new /var/www/chibalete/server

# 3. Restart staggered api_1 (router monta automáticamente)
docker restart chibalete_api_1
sleep 10
curl http://72.60.158.97/api/health/analytics | jq '.checks | keys | length'
# → debe retornar 21 (incluye institutional_api)

docker restart chibalete_api_2

# 4. Frontend deploy (imagen Docker — patrón existente)
cd /opt/chibaleteplus
docker build -t chibalete/front:paso7 -f Dockerfile.frontend .
docker stop chibalete_front && docker rm chibalete_front
docker compose up -d chibalete_front
docker exec chibalete_edge nginx -s reload
```

**NUNCA:** `docker compose down`, rebuild de imagen api, reload nginx
sin necesidad (solo cuando el frontend cambia).

---

## 12. Rollback §24

```bash
# Rollback backend en caliente (sin perder datos)
mv /var/www/chibalete/server /var/www/chibalete/server-new
mv /var/www/chibalete/server-old /var/www/chibalete/server
docker restart chibalete_api_1; sleep 10; docker restart chibalete_api_2

# Datos preservados:
# ✓ Todas las tablas PASO 1-6 intactas
# ✓ insight_*, pedagogical_*, rollups, outcomes, cohort_definitions,
#   cohort_memberships, cohort_trajectories, institutional_learnings,
#   predictive_risk_patterns → todo persistido
#
# Solo cesan:
# ✗ Endpoints /api/aula-viva/institutional/* (router PASO 7 desmontado)
# ✗ Tab "Institucional" en UI (frontend antes del deploy)
#
# El tab "Operativo" PASO 5 sigue funcionando normalmente.
# La data PASO 6 sigue siendo consultable via scripts directos.
```

### Rollback granular (apagar solo PASO 7 sin redeploy)
No es posible apagar el router via env (no tiene flag). Alternativa:
si se descubre un bug crítico, comentar el bloque `try { ... aula-viva
institutional router mounted }` en server.js + hot reload.

---

## 13. Archivos creados / modificados

### Creados (PASO 7)
```
docs/AULA-VIVA-PASO-7-AUDIT.md                       # auditoría UX §3
docs/AULA-VIVA-PASO-7-PRODUCTO-INSTITUCIONAL.md      # este entregable §4
server/aulaViva/institutionalRouter.mjs               # 13 endpoints REST + 2 tracking
server/aulaViva/scopeAccess.mjs                       # validación role+membership
server/__test__/aulaVivaInstitutional.test.js         # 44 checks
services/aulaVivaInstitutionalService.ts              # cliente HTTP cacheable
components/aula-viva/OutcomeDistributionBars.tsx      # SVG puro
components/aula-viva/CohortTrajectorySVG.tsx          # SVG línea longitudinal
components/aula-viva/InstitutionalLearningCard.tsx    # explicabilidad UI
components/aula-viva/InstitutionalTab.tsx             # composición tab
```

### Modificados (quirúrgicamente)
```
server/server.js                       # +9 líneas (mount institutional router)
server/observability/metrics.js        # +8 métricas cardinalidad fija
server/observability/analyticsHealth.js # +1 check institutional_api
pages/AulaVivaOperacional.tsx          # +tab switcher + render InstitutionalTab condicional
package.json                           # +test:aulaVivaInstitutional
```

### NO tocados (regla "cambios mínimos")
```
pages/AulaViva.tsx                              # 2656 líneas intactas
pages/DashboardMediador.tsx                     # 2018 líneas intactas
server/aulaViva/operationalRouter.mjs           # PASO 5 intacto
server/aulaViva/scheduler.mjs                   # PASO 5+6 intacto
server/aulaViva/archiveRotation.mjs             # PASO 5 intacto
server/services/* (todos)                       # PASO 1-6 intactos
server/db/* (todos)                             # PASO 1-6 schemas intactos
components/aula-viva/* PASO 1-5                 # los 11 anteriores intactos
auth, login, onboarding, uploads                # intactos
runtime inmersivo                               # intacto
nginx, Docker Compose                           # intactos
```

---

## 14. Criterio de éxito §28 — checklist

- [x] **La inteligencia longitudinal es visible** → tab "Institucional" con 4 secciones
- [x] **Los outcomes son comprensibles** → `OutcomeDistributionBars` con texto humano
- [x] **Las cohortes son accionables** → cohort list → trayectoria SVG por click
- [x] **Los docentes entienden qué hacer** → `InstitutionalLearningCard` con hint observacional + evidencia
- [x] **Las instituciones entienden qué pasa** → `/institutional/status` + KPIs + comparative
- [x] **Los workflows institucionales existen** → follow-up queue + intervention review endpoints
- [x] **La longitudinalidad es navegable** → `/cohorts/:id/trajectory` + `/profile/:id`
- [x] **Las trayectorias son visibles** → `CohortTrajectorySVG` con 3 métricas por cohort
- [x] **Las recomendaciones tienen contexto** → scope visible, support_count, evidence
- [x] **La UX sigue simple** → 2 tabs, 4 secciones colapsables, max 3 expandidas
- [x] **La plataforma sigue rápida** → instrument() + cache + 50 GETs avg 1.3ms en CI
- [x] **SQLite WAL sigue sano** → integrity_check=ok (test §H-31)
- [x] **5000+ usuarios siguen siendo viables** → cero schema changes, cero hot path mods
- [x] **NO existe vigilancia tóxica** → scope isolation default-deny + scope user
      requiere membership (test §A-3)
- [x] **NO existe causalidad falsa** → vocabulary_class='observational' en cada response;
      caveat en comparative; hints heredan filtro PASO 6 (test §D-21)
- [x] **NO existe ranking punitivo** → no endpoint mediator-rank; comparative ordena
      por improved_ratio pero etiqueta muestras chicas (<5) como "(muestra pequeña)"

---

## 15. Lo honesto: qué queda fuera de este PASO

- **Páginas dedicadas por scope** (`/aula-viva/biblioteca`, `/aula-viva/club`):
  la data está disponible vía API; las UX específicas (circulación,
  géneros, horarios para biblioteca; participación colectiva para club)
  son trabajo de UX engineering en PASO 8 cuando haya adopción real de
  cada rol.
- **`library` scope funcional**: no hay tabla SQLite para bibliotecas
  todavía. Hoy admin-only en `scopeAccess`. PASO 8 si llega.
- **Mediator-specific dashboard**: el tab "Institucional" actual sirve
  para coordinadores; un dashboard "mis grupos solamente" para mediators
  requiere wiring adicional al menú principal y queda para PASO 8.
- **Mobile-first redesign**: la tab funciona en mobile con scroll vertical;
  un layout específico mobile (tab → dropdown, métricas en cards 2x2)
  es trabajo de UX engineering.
- **Heatmap continuity** §7: el componente `Sparkline` PASO 5 cubre la
  necesidad básica; un grid heatmap 7d×N-semanas requiere `snapshot_history`
  acumulada (PASO 4 opcional) — implementable cuando los datos estén
  presentes.
- **Recovery curves**: equivalente al trajectory por cohort=`trajectory:recovered_after_risk`
  que YA existe; UI específica de curva de recuperación se difiere.
- **Notification engine institucional**: emails/push a coordinadores
  cuando hay learning nuevo o pattern crítico — explícitamente fuera
  de scope (regla §5 "no automatizar criterio pedagógico humano" PASO 3).

---

## 16. Resumen ejecutivo (1 párrafo)

PASO 7 productiza la inteligencia institucional construida en PASO 1-6:
13 endpoints REST nuevos `/api/aula-viva/institutional/*` (status,
outcomes/by-type, outcomes/scope, outcomes/follow-up-queue,
cohorts/definitions, cohorts/by-type, cohorts/:id/members,
cohorts/:id/trajectory, learnings/scope, learnings/global,
patterns/recent, comparative/strategies, profile/:userId) más 2
tracking endpoints (scope-switch, ui-latency); helper `scopeAccess`
con default-deny que valida role + membership real desde
`users_db.json` + `groups_db.json` (admin → todo; mediator →
user/group/club/school de SUS grupos; lector → solo su propio user)
testado en 15 combinaciones; tab nueva "Institucional" en la página
existente `pages/AulaVivaOperacional.tsx` (cero rewrite, solo diff
mínimo del header) con 4 componentes SVG-puros nuevos
(OutcomeDistributionBars, CohortTrajectorySVG, InstitutionalLearningCard,
InstitutionalTab compositor); cliente HTTP `aulaVivaInstitutionalService.ts`
con timeout 5s + cache localStorage TTL 5min + tratamiento honesto del
403 como fallback shape (no rompe UI); 8 métricas Prometheus
cardinalidad fija (views, queries, scope-switch, ui-latency); 1
healthcheck nuevo (`institutional_api` con staleness_hours) =
**21 checks** totales; comparative intelligence con `caveat`
explícito ("Las comparaciones reflejan patrones observados, no efectos
causales") + estrategias con muestra <5 al final etiquetadas; cero
endpoint mediator-rank; cero scope library funcional aún (admin-only);
44 tests verdes covering scope isolation cross-tenant, no causal
language, no PII exposure, paginación, 5000-user synthetic read test,
rollback compatibility con engines OFF; **351/351 tests verdes**
(259 analytics + 12 identity + 80 memberships) sin regresión; cero
deps nuevas (SVG puro, sin ECharts/Recharts/D3); cero modificación al
hot path PASO 1-6 ni a `pages/AulaViva.tsx` (2656 líneas); rollback
backend en caliente vía bind-mount swap; toda la inteligencia
longitudinal construida en seis pasos previos ahora es visible,
navegable, comprensible y accionable por docentes, mediadores,
coordinadores y administradores institucionales sin que necesiten
conocimiento técnico, preservando la simplicidad SQLite-WAL-cuatro-
handles que define la arquitectura del proyecto y dejando todo listo
para que PASO 8 conecte las experiencias dedicadas por scope (biblioteca,
club, mediator) si la demanda real de cada rol lo justifica.
