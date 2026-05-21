# Aula Viva — Audit Emitter + Cohort Summaries (Fase 3B)

> **Estado:** Fase 3B — institucionalización mínima de Aula Viva.
> Cierra los 3 gaps reales identificados en auditoría de 3B (los 5+ que pedía
> el prompt v4 ya estaban construidos de fases anteriores).

## 1. Por qué este documento existe

El prompt 3B pedía 9 áreas (governance, audit trail, follow-up workflow,
cohort operationalization, mobile mediator runtime, longitudinal cases,
library scope, privacy ethics, operational summaries) + 5 flags + 17 tests.

La auditoría reveló que **organizationId propagation, scopeAccess (7 scopes),
recommendation/intervention lifecycle, cohort builder (8 tipos),
trajectory analyzer, AulaVivaOperacional, longitudinalSummary per-user,
RecommendationCard, EmptyState, RiskBadge — todo eso ya existía**.

Los 3 únicos gaps reales eran:

1. **Audit emitter `teacher_*`** — los 6 schemas existían en `eventRegistry.js`
   pero NINGÚN endpoint los emitía. Trazabilidad institucional inexistente.
2. **Cohort-scope summaries** — `longitudinalSummary.mjs` (Fase 3A) solo
   producía frases per-user, no agregados de grupo.
3. **Cableo del `LongitudinalStudentTimeline`** — el componente (Fase 3A)
   existía pero nunca se renderizaba en AulaVivaOperacional.

Esta fase cierra esos 3 gaps sin tocar engines, sin nueva página, sin
nuevas tablas SQLite.

## 2. Qué se agregó

| Pieza | Ubicación | Función |
|---|---|---|
| Audit emitter | `server/services/aulaVivaAuditEmitter.mjs` (220 líneas) | 4 emisores (`emitTeacherViewedStudent`, `emitTeacherReviewedRecommendation`, `emitTeacherCreatedIntervention`, `emitMediatorReviewedCohort`). Mismo patrón defensivo que `leoBackboneEmitter` de Fase 2A. |
| Cohort summaries | `server/services/longitudinalSummary.mjs` (+200 líneas) | 5 templates cohort-aware: `insufficient_cohort_data`, `cohort_low_persistence`, `cohort_persistence_growing`, `cohort_recovery_collective`, `cohort_help_seeking_concentrated`. Función pública `generateCohortSummaries()`. |
| Wire en operationalRouter | `server/aulaViva/operationalRouter.mjs` (+25 líneas) | 4 emit calls fire-and-forget en handlers existentes (timeline, ack, dismiss, intervene, cohort). Cero cambio a lógica/return. |
| Wire en AulaVivaOperacional | `pages/AulaVivaOperacional.tsx` (+30 líneas) | Sección "Timeline longitudinal" debajo de Recommendations cuando hay estudiante seleccionado. Reusa el componente LongitudinalStudentTimeline existente. |
| Service interface | `services/aulaVivaOperationalService.ts` (+15 líneas) | Extiende `ProfileTimeline` con `summaries?` (alineado al payload del backend). |
| Feature flags | `server/lib/flags.js` (+2 entries + doc) | `AULA_VIVA_AUDIT_EVENTS_ENABLED`, `AULA_VIVA_COHORT_SUMMARIES_ENABLED`. Default OFF. |
| Tests audit emitter | `server/__test__/aulaVivaAuditEmitter.test.js` (220 líneas) | 78 asserts |
| Tests cohort summaries | `server/__test__/cohortLongitudinalSummary.test.js` (210 líneas) | 80 asserts |

## 3. Los 4 eventos audit emitidos

Schemas ya definidos en `server/analytics/eventRegistry.js`. El emitter
construye payloads exactos y los pasa por `recordCanonicalEvent`.

| Evento | Schema | Disparo | Caveat |
|---|---|---|---|
| `teacher_viewed_student` | `{groupId, studentId, at}` | GET /students/:userId/timeline | groupId via lookup en groups_db.json; `_unscoped` si no se encuentra |
| `teacher_reviewed_recommendation` | `{recommendationId, accepted}` | POST /recommendations/:id/ack \| /dismiss | accepted=true en ack, false en dismiss |
| `teacher_created_intervention` | `{scopeLevel, scopeId, kind, note?}` | POST /interventions | **note libre OMITIDA por decisión de privacidad** (el schema lo permitiría) |
| `mediator_reviewed_cohort` | `{scopeLevel, scopeId, cohortKey?}` | GET /cohorts/:scope_type/:scope_id | scope_type del path → SCOPE_LEVEL enum mapping defensivo |

Cada payload viaja con `mode='aula_viva'`, ULID único, `clientTs=Date.now()`,
`sessionId='audit_<event>_<scope>'`.

## 4. Los 5 cohort templates

| Template ID | Kind | Disparo | Caveat |
|---|---|---|---|
| `insufficient_cohort_data` | `insufficient_data` | sample_size < 5 | "Con cohortes pequeñas, métricas individuales tienen más peso..." |
| `cohort_low_persistence` | `attention` | persistencia < 0.4 + sample ≥ 5 | "NO identifica estudiantes específicos. Revisar timelines individuales." |
| `cohort_persistence_growing` | `positive` | persistencia ≥ 0.6 + trend=up + sample ≥ 5 | "NO implica medición de comprensión colectiva." |
| `cohort_recovery_collective` | `positive` | recovery o persistence en trend=up + sample ≥ 5 | "Tendencia agregada — puede ocultar variación individual." |
| `cohort_help_seeking_concentrated` | `observation` | mediacion_leo ≥ 5 + sample ≥ 5 | "Alta mediación NO implica baja autonomía colectiva." |

## 5. Activación

### 5.1 Pre-requisitos

| Pre-check | Cómo |
|---|---|
| Fase 2A activa (events.db escribible) | `ls -la data-critical/events.db` |
| `recordCanonicalEvent` operativo | Cubierto por `test:analytics` |
| Fase 3A activa (summaries per-user) | `AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=1` |

### 5.2 Activación

```bash
# /opt/chibaleteplus/.env (Docker Compose)
AULA_VIVA_AUDIT_EVENTS_ENABLED=1
AULA_VIVA_COHORT_SUMMARIES_ENABLED=1
```

Restart staggered:

```bash
docker compose restart chibalete_api_1   # validar logs
docker compose restart chibalete_api_2
```

### 5.3 Verificación

```sql
-- Audit events llegando a events.db (esperado tras ~5 acciones de mediador):
SELECT event, COUNT(*) FROM events
WHERE mode='aula_viva'
  AND server_ts >= strftime('%s','now','-1 hour')*1000
GROUP BY event;
```

Esperado: rows de los 4 eventos según la actividad real.

### 5.4 Rollback

```bash
AULA_VIVA_AUDIT_EVENTS_ENABLED=0
AULA_VIVA_COHORT_SUMMARIES_ENABLED=0
docker compose restart chibalete_api_1 chibalete_api_2
```

Cero impacto: emisores devuelven `{ok:false, reason:'disabled'}`, cohort
summaries devuelve `[]`. UI sigue funcionando idéntico.

## 6. Garantías

### Trazabilidad institucional, NO vigilancia
- Los 4 eventos audit solo registran: actor (callerId), action (event name),
  target (studentId/groupId/recommendationId), timestamp, scope.
- Cero notas libres, cero texto del estudiante, cero contenido de chat Leo.
- Test `[7]` valida ausencia explícita de `note`, `text`, `answer`, `message`,
  `prompt`, `response`, `body`, `email`, `name` en payloads.
- Política institucional: estos eventos son para reconstrucción longitudinal
  del proceso pedagógico, NO para rankear o castigar mediadores.

### Sin scoring mágico, sin afirmaciones
- Cohort summaries usan templates determinísticos (mismo patrón que Fase 3A).
- Cada template lleva `caveat` explícito.
- Test `[12]` valida ausencia de "ranking", "fracasa", "mejor grupo",
  "peor grupo", "es un mal grupo", etc.
- Vocabulario observacional: "Se observa una tendencia colectiva..." NO
  "La cohorte mejoró".

### Cero impacto cuando flags OFF
- Emisores: `_enabled()` retorna false → función devuelve inmediato sin
  construir envelope ni llamar recordCanonicalEvent.
- Cohort summaries: lectura del flag → return [] inmediato.
- Endpoint extensions: try/catch alrededor de cada emit. NUNCA bloquean la
  respuesta. La latencia agregada en flag OFF es ~1 lookup function call (~1µs).

### Defensivo
- Emisor: try/catch doble (validación args + safeEmit del `recordCanonicalEvent`).
- Lookup defensivo de groupId: si `groups_db.json` no existe / parse falla / studentId
  no aparece, devuelve `_unscoped`. Test `[5]` cubre el caso.
- Cohort templates: try/catch por template — uno malformado NO afecta los otros.
- Endpoints: try/catch envolvente alrededor de cada emit. Una falla del audit
  JAMÁS degrada el response al mediador.

### Determinístico
- Cohort summaries: mismo cohortData → mismo output (test `[8]`).

## 7. Lo que NO se hizo (defer)

| Cosa | Por qué se difirió |
|---|---|
| Library scope operacional | El prompt mismo dice "library scope foundation mínima, no modelo institucional completo". Hoy es placeholder admin-only en scopeAccess. Implementar requiere modelo de biblioteca formal (Fase 4). |
| Longitudinal cases formal | El concepto "caso" puede emerger de las 3 tablas existentes (recommendations + interventions + outcomes); crear schema dedicado es overkill para Fase 3B. |
| organizationId enforcement explícito en endpoints | `scopeAccess.canAccessScope()` cubre el caso de uso real. Filtros extra serían defensa en profundidad para Fase 4. |
| Mobile E2E framework (Playwright/Cypress) | El prompt prohíbe "responsive cosmetic" pero pide "validar". Tailwind responsive ya existe. Crear E2E framework excede scope. |
| 5 flags que pedía el prompt (CASES, COHORT_OPERATIONAL, AUDIT_EVENTS, LIBRARY_SCOPE, MEDIATOR_MOBILE_RUNTIME) | Implementé solo 2 (AUDIT + COHORT) porque los otros cubrirían funcionalidad inexistente o ya existente. |
| Mediator-scoped follow-up queue | El endpoint `/institutional/outcomes/follow-up-queue` existe (scope global). Filtrarlo por mediator scope requiere tocar institutionalRouter y el reader; defer a Fase 4. |

## 8. Tests

```bash
# Nuevos tests Fase 3B:
node server/__test__/aulaVivaAuditEmitter.test.js               # 78 ✓ / 0 ✗
node server/__test__/cohortLongitudinalSummary.test.js          # 80 ✓ / 0 ✗

# Pipeline completo (13 suites):
npm run test:analytics                                          # exit=0, 697 ✓ / 0 ✗
```

Suite breakdown:

| Suite | Asserts |
|---|---|
| analyticsCanon | 46 |
| insightMaterializer | 24 |
| pedagogicalEngine | 29 |
| scalability | 45 |
| aulaVivaOperational | 31 |
| outcomesEngine | 40 |
| aulaVivaInstitutional | 44 |
| leoBackboneEmitter (Fase 2A) | 60 |
| leoPedagogicalSignals (Fase 2B) | 70 |
| longitudinalSummary (Fase 3A) | 102 |
| LongitudinalStudentTimeline.structural (Fase 3A) | 48 |
| **aulaVivaAuditEmitter (Fase 3B)** | **78** |
| **cohortLongitudinalSummary (Fase 3B)** | **80** |
| **TOTAL** | **697** |

Sin regresión en `test:reading-runtime` (162/162). TS baseline: solo el
error pre-existente de `useImmersivePlayback.ts` que viene de cambios
previos al sprint — no introducido por Fase 3B.

## 9. Próximas fases

- **Fase 3C**: library scope operacional + tabla audit_log dedicated (si
  events.db crece demasiado para queries específicas de audit).
- **Fase 4**: governance institucional completa — `requireMediator()`
  middleware, organizationId enforcement explícito, RBAC formal.
- **Fase 5**: mobile E2E + cases longitudinales formales.
