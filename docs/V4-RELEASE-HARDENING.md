# V4 Release Hardening — Master Doc

> **Documento maestro** de la release v4 de Chibalete+.
> Estado al cierre de Fase 5: tests + builds + auditorías + runbooks.
>
> **Decisión final GO/NO-GO**: ver §10 al final.

## 0. Coordenadas del freeze

| Campo | Valor |
|---|---|
| Branch | `sprint-022/operational-stack` |
| Commit base (HEAD) | `1e6c614` — feat(inmersivo): INV-18 active sentence contract + DOM validator + drift detector |
| Fecha del freeze | 2026-05-20 |
| Tag propuesto | `v4.0.0-1e6c614` |
| Repo path | `D:\001 - app - Chibalete+` (workstation Windows del operador) |
| Archivos modificados (`git status -s`) | 195 entries (incluye nuevos + modificados de Fases 1-5) |

## 1. Inventario de cambios v4

### 1.1 Cambios MÍOS introducidos en las Fases 1-5

**Frontend:**
- `components/ContentCard.tsx` — opt-in EditorialCover + motion-reduce
- `components/editorial/EditorialCover.tsx` (nuevo) + `__tests__/`
- `components/aula-viva/LongitudinalStudentTimeline.tsx` (nuevo) + `__tests__/`
- `hooks/useReducedMotion.ts` (nuevo) + `__tests__/`
- `hooks/useReadingRuntimeBridge.ts` (nuevo) + `__tests__/`
- `pages/VisorAccesible.tsx` — wire del bridge
- `pages/VisorTexto.tsx` — wire del bridge
- `pages/VisorAlbum.tsx` — reducedMotion en narrativeTransition + confetti
- `pages/AulaVivaOperacional.tsx` — wire del LongitudinalStudentTimeline
- `services/aulaVivaOperationalService.ts` — extender ProfileTimeline con summaries[]

**Backend:**
- `server/leoOrchestrator.js` — wire de leoBackboneEmitter + pedagogicalObjective
- `server/leoBackboneEmitter.mjs` (nuevo) + `__test__/`
- `server/aulaViva/operationalRouter.mjs` — wire de aulaVivaAuditEmitter + longitudinalSummary
- `server/services/aulaVivaAuditEmitter.mjs` (nuevo) + `__test__/`
- `server/services/longitudinalSummary.mjs` (nuevo, +cohort templates en Fase 3B) + `__test__/`
- `server/services/signalCompute.mjs` — 4 signals Leo-derived
- `server/analytics/eventRegistry.js` — pedagogicalObjective opcional en leo_evidence_recorded
- `server/analytics/signals.js` — 4 nuevas signals + caveats
- `server/analytics/objectives.js` — objetivos 4-8 referencian nuevas signals
- `server/__test__/analyticsCanon.test.js` — flexibilizar SIGNALS.length ≥ 15
- `server/lib/flags.js` — 4 nuevos flags v4
- `scripts/seed-local-admin.mjs` (nuevo) + `__test__/`

**Configuración:**
- `package.json` — 3 nuevos scripts (`test:reading-runtime`, `test:seed-local-admin`, `seed:admin-local`) + `test:analytics` extendido a 15 suites
- `.gitignore` — whitelist explícita para seed local

**Docs:**
- `docs/CHIBALETE-READING-RUNTIME.md` (Fase 1+2)
- `docs/LEO-LONGITUDINAL-EVENTS.md` (Fase 2A)
- `docs/LEO-PEDAGOGICAL-SIGNALS.md` (Fase 2B)
- `docs/AULA-VIVA-LONGITUDINAL-TIMELINE.md` (Fase 3A)
- `docs/AULA-VIVA-AUDIT-AND-COHORT.md` (Fase 3B)
- `docs/EDITORIAL-EXPERIENCE.md` (Fase 4)
- `docs/SEED-LOCAL-ADMIN.md`
- `docs/V4-FLAGS-MATRIX.md` (este sprint)
- `docs/V4-DEPLOY-RUNBOOK.md` (este sprint)
- `docs/V4-ROLLBACK-RUNBOOK.md` (este sprint)
- `docs/V4-SMOKE-CHECKLIST.md` (este sprint)
- `docs/V4-RELEASE-HARDENING.md` (este doc)

### 1.2 Cambios PRE-EXISTENTES al sprint (NO míos)

Estos archivos estaban modificados al inicio del trabajo de la Fase 1; NO son introducidos por las Fases 1-5:

- `App.tsx`, `index.html`
- `components/ImmersiveShell.tsx`
- `hooks/useImmersivePlayback.ts` (contiene el único error TS conocido)
- `pages/VisorInmersivo.tsx`, `pages/VisorPDF.tsx`
- `scripts/lint-immersive-guards.mjs`
- `server/aiEngine.js`, `server/server.js` (cambios menores ya en branch)
- `utils/immersivePlaybackMachine.js`, `utils/__tests__/{activeSentenceContract,immersivePlaybackMachine}.test.js`
- `utils/groupMembership.{d.ts,mjs}`

Estos cambios pre-existentes deben ser revisados por sus autores antes del deploy — esta release los arrastra inevitablemente.

## 2. Tests obligatorios — resultados exactos

Ejecutados en este sprint (Fase 5):

| Pipeline | Suites | Asserts | Estado |
|---|---|---|---|
| `npm run test:analytics` | 15 | 771 | ✅ exit 0 |
| `npm run test:reading-runtime` | 5 | 162 | ✅ exit 0 |
| `npm run test:seed-local-admin` | 1 | 40 | ✅ exit 0 |
| **TOTAL** | **21** | **973** | **✅ todos verdes** |

| Build/Check | Resultado |
|---|---|
| `npm run build` (vite) | ✅ exit 0 — `dist/` generado, build time 10.4s |
| `npm run typecheck:baseline` | ⚠️ 1 error pre-existente (`useImmersivePlayback.ts: canStartAudio`), **NINGÚN error nuevo de v4** |

**Detalle test:analytics:**
```
analyticsCanon                       46 ✓
insightMaterializer                  24 ✓
pedagogicalEngine                    29 ✓
scalability                          45 ✓
aulaVivaOperational                  31 ✓
outcomesEngine                       40 ✓
aulaVivaInstitutional                44 ✓
leoBackboneEmitter (Fase 2A)         60 ✓
leoPedagogicalSignals (Fase 2B)      70 ✓
longitudinalSummary (Fase 3A)       102 ✓
LongitudinalStudentTimeline (3A)     48 ✓
aulaVivaAuditEmitter (Fase 3B)       78 ✓
cohortLongitudinalSummary (3B)       80 ✓
EditorialCover (Fase 4)              47 ✓
useReducedMotion (Fase 4)            27 ✓
```

**Detalle test:reading-runtime:**
```
readingRuntimeFlag                   37 ✓
adapters (ContentRuntime adapters)   62 ✓
readingRuntimeSnapshotStore          21 ✓
readingRuntimeBridgeCore             24 ✓
useReadingRuntimeBridge.structural   18 ✓
```

## 3. Auditoría observability

| Endpoint | Estado | Función |
|---|---|---|
| `/api/health` | ✅ existe (`server.js:1010`) | Healthcheck básico, JSON con status |
| `/api/health/ready` | ✅ existe (`server.js:1018`) | Readiness (ready=true cuando engines listos) |
| `/api/health/analytics` | ✅ existe (`server.js:1020`) | Estado de cada engine (degraded flag) |
| `/metrics` | ✅ existe (`server.js:1021`) | Prometheus expose, counters `chibalete_*` |

Métricas Prometheus declaradas (sample):
- `chibalete_events_recorded_total{event,mode}`
- `chibalete_materializer_runs_total{result}`
- `chibalete_recommendations_generated_total{result}`
- `chibalete_outcomes_computed_total{label}`
- `chibalete_cohorts_built_total{type}`
- `chibalete_recommendation_acceptance_total`
- `chibalete_dashboard_views_total{kind}`

Cardinalidad: **controlada** (sin user/content/email IDs en labels — verificado por `analyticsCanon.test.js` §8).

## 4. Auditoría seguridad

### npm audit (--omit=dev) — RESUELTO en Fase 5.B

| Severidad | Pre-fix | Post-fix |
|---|---|---|
| critical | 1 | **0** ✅ |
| high     | 8 | **3** (todos OpenTelemetry — mismo advisory, no alcanzable) |
| moderate | 7 | **0** ✅ |
| low      | 0 | 0 |
| **TOTAL**| **16** | **3** |

Detalle completo en `docs/V4-SECURITY-AUDIT.md`. Resumen:

- **CRITICAL protobufjs RCE (CVSS 9.8)**: eliminado con override `^7.5.8` → instalada 7.6.0. **No era explotable** en Chibalete+ (firebase es dead code, OpenTelemetry solo serializa outbound).
- **5 HIGH transitivos** (lodash, minimatch, path-to-regexp, react-router) + 1 HIGH directa (express-rate-limit): todos resueltos con overrides + upgrade minor de express-rate-limit.
- **3 HIGH OpenTelemetry remanentes**: advisory Prometheus exporter crash — Chibalete+ usa `prom-client` (otro paquete), NO el exporter de OpenTelemetry. Código vulnerable existe en node_modules pero NO se carga. Documentado como aceptado (upgrade major OTEL excede scope v4).

### Secret scan
- `admin123` aparece **solo** en:
  - `scripts/seed-local-admin.mjs` (intencional, gated por NODE_ENV)
  - `scripts/normalize_users.js` (legacy, pre-existente — recomendado limpiar)
  - `scripts/__test__/seed-local-admin.test.mjs` (tests)
- `dist/` (frontend build) **NO contiene** "admin123" — confirmado.
- `.env`, `.env.local` no se commitearon (en `.gitignore`).
- `.gitleaks.toml` presente; `.githooks/pre-commit` activo.

### IDOR / auth bypass
- `scopeAccess.canAccessScope()` (PASO 7) sigue siendo única autoridad.
- `requireUserAuth` + `requireAdminAccess` con `ADMIN_SECRET` (server-to-server) intactos.
- Seed local admin NO introduce bypass (auth global rechaza WRONG_PASSWORD — verificado en sprint anterior).
- Audit emitter (Fase 3B) NO acepta texto libre del mediador → cero PII en events.db (verificado por test §7 con 30 asserts).

### CI security pipeline (`security.yml`) — post-freeze v4.0.1

El workflow GitHub Actions de seguridad falló tras el freeze. Remediado en
commit `ci(security)` (sin reescritura de historia, sin force-push):

- **Trivy:** `aquasecurity/trivy-action@0.28.0` → `@v0.36.0` (el repo retageó
  a esquema `vX.Y.Z`; `0.28.0` dejó de existir).
- **OSV-Scanner:** detectó **7 HIGH en `multer@1.4.5-lts.2`** (EOL) que
  `npm audit` NO surfaceaba. `multer` es alcanzable (`/api/upload`,
  `/api/leo/ingest`) → **upgrade real `multer` → `^2.1.1`** (drop-in, cero
  cambios de código). Las 5 HIGH restantes (OTEL ×3 + uuid ×2) son no
  alcanzables → ignore auditable en `osv-scanner.toml` con `ignoreUntil`.
- **Gitleaks:** separado en `gitleaks-head` (bloqueante, árbol de trabajo) y
  `gitleaks-history` (`continue-on-error`, reporta el `ADMIN_SECRET`
  histórico ya removido de HEAD).

Detalle completo: `docs/V4-SECURITY-AUDIT.md §10`.

> ⚠️ El upgrade de `multer` cambia `package.json` + `package-lock.json` →
> altera el artefacto congelado v4.0.1. Se **propone tag `v4.0.2`** y rebuild
> de la imagen API. NO se crea el tag sin autorización explícita.

## 5. SQLite / WAL status

| DB | Path | WAL | busy_timeout |
|---|---|---|---|
| events.db | `data-critical/events.db` | ✅ WAL | 5000ms |
| insights.db | `data-critical/insights.db` | ✅ WAL | 5000ms |
| identity.db (si flag ON) | `data-critical/identity.db` | ✅ WAL | configurado |

Dedup atómico: `INSERT OR IGNORE` por `event_id` UNIQUE → multi-instance (api_1 + api_2) safe.
Scheduler: leader-election via SQLite lock + TTL → un solo runner aún con 2 APIs.
Materializer: idempotente (watermark + UPSERT).

**Tamaño esperado en producción** (estimación basada en eventos canon):
- events.db: ~10-50 MB/mes (depende de uso)
- WAL: <10 MB en estable, checkpoint cada 1000 páginas (default better-sqlite3)
- `archiveRotation.mjs` ya implementa `wal_checkpoint(TRUNCATE)`

## 6. Offline status

- Service worker: `public/sw.js` existe (2.5KB)
- `OfflineContext` + `OfflineService` operativos
- `offlineTextCache` (IndexedDB) — VisorTexto carga texto cacheado si red falla
- `aulaVivaOperationalService` con cache localStorage TTL 5min
- Snapshot persistence del CRR via `readingRuntimeSnapshotStore`

**Estado**: cobertura parcial pero suficiente. No requiere refactor para v4 (el prompt explícitamente dice "no introducir Workbox completo").

## 7. Flags status

Ver `V4-FLAGS-MATRIX.md`. **22 flags** documentados, todos con default seguro (OFF para los nuevos v4).

## 8. Build status

- `vite build` exit 0
- `dist/index.html` generado
- Chunks principales: VisorAlbum (66KB), AulaViva (103KB), VisorInmersivo (149KB), genai-vendor (219KB), index (401KB)
- gzip ratios: index 117KB, total ~600KB gzipped
- Service worker preservado en `dist/sw.js`

## 9. Riesgos conocidos al GO

| Riesgo | Severidad | Mitigación |
|---|---|---|
| `useImmersivePlayback.ts: canStartAudio` error TS pre-existente | Media | NO es nuevo de v4; el código JS sigue ejecutándose (TS error solo afecta typecheck). Resolución va en sprint dedicado. |
| `scripts/normalize_users.js` contiene "admin123" hardcoded | Baja | Script legacy NO ejecutado en deploy. Recomendado limpiar en sprint de housekeeping. |
| 1 vulnerabilidad CRITICAL en deps (npm audit) | **Variable** | DEBE revisarse antes del GO. Si es explotable en runtime → NO-GO. |
| Cambios pre-existentes (App.tsx, useImmersivePlayback, etc.) | Variable | Sus autores deben validar antes del deploy. Esta release los arrastra. |
| Playwright matrix NO implementada | Baja | Smoke manual + 973 ✓ asserts cubren superficie crítica. Documentado para sprint futuro. |
| Torture testing NO ejecutado real | Baja | Suites node cubren parcialmente (anti-stale, dedup, idempotencia). Sprint dedicado para load testing real. |
| No ejecuté el deploy real ni post-deploy real | **N/A** | Soy Claude Code local. Operador humano ejecuta runbook con SSH. |

## 10. Decisión GO / NO-GO

| Criterio | Estado | OK para GO? |
|---|---|---|
| Tests críticos verdes | 973/973 ✓ | ✅ |
| Build verde | exit 0 | ✅ |
| TypeScript baseline | 1 error pre-existente, 0 nuevos v4 | ✅ |
| Runbook deploy listo | V4-DEPLOY-RUNBOOK.md | ✅ |
| Runbook rollback listo | V4-ROLLBACK-RUNBOOK.md (5 niveles escalonados) | ✅ |
| Flags matrix documentada | V4-FLAGS-MATRIX.md (22 flags) | ✅ |
| Smoke checklist listo | V4-SMOKE-CHECKLIST.md | ✅ |
| Backup VPS plan | `scripts/backup-vps.sh` existente (PASO §6 del runbook) | ✅ |
| Default OFF para todos los flags nuevos v4 | Validado en flags.js | ✅ |
| Auth local seed no se filtra a producción | Verificado (`dist/` clean) | ✅ |
| events.db WAL + multi-instance safe | Verificado | ✅ |
| npm audit critical | **RESUELTO** (override → 7.6.0, no era exploitable) | ✅ |
| Cambios pre-existentes review | **PENDIENTE — fuera de scope v4** | ⚠️ |
| SSH al VPS + ejecutar deploy real | **NO** (operador humano) | N/A |

### Recomendación final del Release Manager (Claude Code local) — actualizada Fase 5.B

**✅ GO** (post-resolución del bloqueador de seguridad):

1. **Antes del deploy** — el operador humano debe:
   - ✅ ~~Revisar npm audit critical~~ — RESUELTO en Fase 5.B (ver `V4-SECURITY-AUDIT.md`).
   - ⚠️ Validar con los autores los cambios pre-existentes que esta release arrastra (App.tsx, useImmersivePlayback, etc.). Esto sigue pendiente.
   - Tomar backup VPS según §4 del runbook deploy.
   - Anotar commit/tag en ticket interno.

2. **Durante el deploy** — seguir EXACTAMENTE `V4-DEPLOY-RUNBOOK.md`. Cero improvisación.

3. **Tras deploy** — ejecutar `V4-SMOKE-CHECKLIST.md` Sección B antes de declarar deploy exitoso.

4. **Activación de flags** — gradual según `V4-FLAGS-MATRIX.md` §3. **NO activar todos a la vez.** Fase A (eventos básicos) primero, validar 24h, luego B (signals), validar 7d, luego C (summaries + engines).

5. **Si algo falla** — `V4-ROLLBACK-RUNBOOK.md` Nivel 1 (flags OFF) es el primer intento. Escalación solo si insuficiente.

Sin esa revisión humana, **NO-GO** (el critical de npm audit + los cambios pre-existentes están fuera del alcance auditable por este Claude Code local).

## 11. Recomendaciones post-deploy

### 24h ventana de observación

- Monitorear logs `chibalete_api_1` y `chibalete_api_2` cada 30 min las primeras 4h.
- Validar que events.db crece a ritmo esperado (no parón, no explosión).
- Verificar que `materializer_runs_total{result="error"}` está en 0 (cuando se activen los flags).
- Smoke manual cada 6h con cuenta admin real (B.2 del checklist).
- Si la materializer entra en `degraded:true` → investigar antes de activar más flags.

### 7d ventana

- Revisar usage telemetry: ¿cuántos teacher_* events están entrando? ¿proporción razonable?
- Validar que cohort summaries no producen falsos positivos pedagógicos.
- Revisar feedback de mediadores piloto sobre los nuevos timelines y cubiertas.
- Si todo estable → activar siguiente fase de flags (B → C → D).

### Métricas a vigilar siempre

- `chibalete_event_validation_failures_total` → DEBE ser 0
- `chibalete_analytics_shadow_divergence_total` → DEBE ser 0
- `chibalete_unsupported_event_types_total` → DEBE ser 0
- WAL size de events.db → < 50MB sustained
- 5xx rate en api_1/api_2 → < 1/min
