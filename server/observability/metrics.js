/**
 * metrics.js — P2-B Prometheus (prom-client). Señal alta, cardinalidad
 * CONTROLADA: NUNCA labels userId/contentId/email (cardinalidad ilimitada).
 * Solo labels acotados y enumerables. INERTE si METRICS_ENABLED!=1.
 *
 * Métricas accionables (no vanity): latencia/errores por ruta normalizada,
 * sesiones inmersivas, drift, recovery, shadow consistency, SQLite busy,
 * login failures, runtime crashes, + default Node (event-loop lag, mem, cpu, gc).
 */
import client from 'prom-client';

export const METRICS_ENABLED = process.env.METRICS_ENABLED === '1';
export const registry = new client.Registry();

if (METRICS_ENABLED) {
    client.collectDefaultMetrics({
        register: registry,
        prefix: 'chibalete_',
        eventLoopMonitoringPrecision: 10, // event loop lag (señal SRE clave)
    });
}

// ── Ruta normalizada a un set ACOTADO (anti-cardinalidad) ───────────────────
// Reemplaza ids por :param y limita a prefijos conocidos; resto → "other".
export function normalizeRoute(p = '') {
    const s = String(p).split('?')[0];
    if (s === '/api/health' || s === '/api/health/ready' || s === '/metrics') return s;
    return ('/' + s.split('/').slice(1, 4).join('/'))
        .replace(/\/[0-9a-fA-F-]{8,}/g, '/:id')
        .replace(/\/content-\d+/g, '/:contentId')
        .replace(/\/[^/]*@[^/]*/g, '/:email')
        .slice(0, 60) || 'other';
}
const statusClass = (c) => `${Math.floor((c || 0) / 100)}xx`;

const M = (make) => (METRICS_ENABLED ? make() : { inc(){}, dec(){}, observe(){}, set(){}, labels(){return this;} });

export const httpDuration = M(() => new client.Histogram({
    name: 'chibalete_http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['route', 'method', 'status_class'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [registry],
}));
export const httpTotal = M(() => new client.Counter({
    name: 'chibalete_http_requests_total', help: 'HTTP requests',
    labelNames: ['route', 'method', 'status_class'], registers: [registry],
}));
export const immersiveSessions = M(() => new client.Gauge({
    name: 'chibalete_immersive_sessions_active', help: 'Active immersive sessions',
    labelNames: ['runtime'], registers: [registry],
}));
export const immersiveDrift = M(() => new client.Counter({
    name: 'chibalete_immersive_drift_total', help: 'Drift incidents',
    labelNames: ['runtime', 'mode'], registers: [registry],
}));
export const immersiveAudioRecovery = M(() => new client.Counter({
    name: 'chibalete_immersive_audio_recovery_total', help: 'Audio recovery events',
    labelNames: ['runtime'], registers: [registry],
}));
export const immersiveStall = M(() => new client.Counter({
    name: 'chibalete_immersive_stall_total', help: 'Runtime stalls/re-syncs',
    labelNames: ['runtime', 'kind'], registers: [registry],
}));
export const immersiveVaDelta = M(() => new client.Histogram({
    name: 'chibalete_immersive_visual_audio_delta_ms', help: 'Visual↔audio delta (ms)',
    labelNames: ['runtime'], buckets: [-200, -40, 0, 40, 120, 300, 800], registers: [registry],
}));
export const shadowConsistency = M(() => new client.Gauge({
    name: 'chibalete_shadow_consistency_ok', help: '1=last shadow audit ok, 0=mismatch',
    labelNames: ['domain'], registers: [registry],
}));
export const sqliteBusy = M(() => new client.Counter({
    name: 'chibalete_sqlite_busy_total', help: 'SQLITE_BUSY contention events',
    labelNames: ['db'], registers: [registry],
}));
export const loginFailures = M(() => new client.Counter({
    name: 'chibalete_login_failures_total', help: 'Failed logins', registers: [registry],
}));
export const runtimeCrash = M(() => new client.Counter({
    name: 'chibalete_runtime_crash_total', help: 'Unhandled runtime crashes',
    labelNames: ['source'], registers: [registry],
}));
// P4-A — origen real de cada lectura de identidad + fallbacks (cardinalidad
// fija: domain∈3, source∈2, reason∈enum). Mide el avance del cutover.
export const identityReadSource = M(() => new client.Counter({
    name: 'chibalete_identity_read_source_total', help: 'Identity reads by source',
    labelNames: ['domain', 'source'], registers: [registry],
}));
export const identityReadFallback = M(() => new client.Counter({
    name: 'chibalete_identity_read_fallback_total', help: 'SQLite→JSON read fallbacks',
    labelNames: ['domain', 'reason'], registers: [registry],
}));
// CHP-IDDB-02C-B — comparación runtime JSON↔SQLite en modo sombra. JSON sigue
// siendo la respuesta oficial: estas series solo describen al observador.
// Cardinalidad fija: domain∈5, surface∈2, result∈5, gap∈enum corto.
export const identityShadowCompareTotal = M(() => new client.Counter({
    name: 'chibalete_identity_shadow_compare_total',
    help: 'Shadow JSON/SQLite read comparisons by classification',
    labelNames: ['domain', 'surface', 'result'], registers: [registry],
}));
export const identityShadowCompareEntities = M(() => new client.Counter({
    name: 'chibalete_identity_shadow_compare_entities_total',
    help: 'Entities classified as an expected coverage gap, by gap class',
    labelNames: ['domain', 'gap'], registers: [registry],
}));
export const identityShadowCompareDuration = M(() => new client.Histogram({
    name: 'chibalete_identity_shadow_compare_duration_seconds',
    help: 'Shadow comparison overhead per eligible read',
    labelNames: ['domain'], buckets: [0.00005, 0.0002, 0.001, 0.005, 0.02, 0.1],
    registers: [registry],
}));
// P5 — canonicalización analítica (eventRegistry + shadow). Cardinalidad fija:
// `event` ∈ EVENT_NAMES (~30), `mode` ∈ {immersive,guided,pdf,album,accessible,
// audio,unknown}, `code` ∈ codes del registry, `version` int corta. NUNCA
// labels libres (userId/contentId quedan FUERA — explosion-safe).
export const eventsRecorded = M(() => new client.Counter({
    name: 'chibalete_events_recorded_total', help: 'Canonical events inserted',
    labelNames: ['event', 'mode'], registers: [registry],
}));
export const eventValidationFailures = M(() => new client.Counter({
    name: 'chibalete_event_validation_failures_total', help: 'Event validation failures',
    labelNames: ['code'], registers: [registry],
}));
export const analyticsShadowConsistency = M(() => new client.Gauge({
    name: 'chibalete_analytics_shadow_consistency_ok', help: '1=last shadow consistency ok, 0=divergence',
    registers: [registry],
}));
export const analyticsShadowDivergence = M(() => new client.Counter({
    name: 'chibalete_analytics_shadow_divergence_total', help: 'Shadow divergence incidents',
    registers: [registry],
}));
export const archiveRotations = M(() => new client.Counter({
    name: 'chibalete_archive_rotations_total', help: 'events.db → archive rotations',
    labelNames: ['result'], registers: [registry],
}));
export const payloadSchemaVersion = M(() => new client.Counter({
    name: 'chibalete_payload_schema_version_total', help: 'Events seen by (event, schema_version)',
    labelNames: ['event', 'version'], registers: [registry],
}));
export const unsupportedEventTypes = M(() => new client.Counter({
    name: 'chibalete_unsupported_event_types_total',
    help: 'Eventos con tipo desconocido (no registrados) recibidos',
    registers: [registry],
}));
// PASO 2 — materializer (cardinalidad fija: result enum, table enum, severity enum).
export const materializerRuns = M(() => new client.Counter({
    name: 'chibalete_materializer_runs_total', help: 'Corridas del materializer',
    labelNames: ['result'], registers: [registry],
}));
export const materializerDuration = M(() => new client.Histogram({
    name: 'chibalete_materializer_duration_ms', help: 'Duración de corrida (ms)',
    buckets: [10, 50, 100, 300, 800, 2000, 5000, 15000], registers: [registry],
}));
export const materializerLagEvents = M(() => new client.Gauge({
    name: 'chibalete_materializer_lag_events', help: 'Eventos pendientes vs canon',
    registers: [registry],
}));
export const materializerLagSeconds = M(() => new client.Gauge({
    name: 'chibalete_materializer_lag_seconds', help: 'Segundos desde el último evento procesado',
    registers: [registry],
}));
export const snapshotUpdates = M(() => new client.Counter({
    name: 'chibalete_snapshot_updates_total', help: 'Upserts a tablas materializadas',
    labelNames: ['table'], registers: [registry],
}));
export const cohortUpdates = M(() => new client.Counter({
    name: 'chibalete_cohort_updates_total', help: 'Upserts a cohort_rollups',
    registers: [registry],
}));
export const riskFlags = M(() => new client.Counter({
    name: 'chibalete_risk_flags_total', help: 'Risk flags determinísticos disparados',
    labelNames: ['rule'], registers: [registry],
}));
export const insightNotifications = M(() => new client.Counter({
    name: 'chibalete_insight_notifications_total', help: 'Notificaciones persistidas (channel=dashboard)',
    labelNames: ['severity'], registers: [registry],
}));
// PASO 3 — intervention engine (cardinalidad fija: result enum, rule_id ∈ RULE_IDS
// estable, severity enum, intervention_type ∈ enum corto). NUNCA user/student IDs.
export const recommendationsGenerated = M(() => new client.Counter({
    name: 'chibalete_recommendations_generated_total',
    help: 'Recomendaciones pedagógicas generadas/refrescadas por el intervention engine',
    labelNames: ['result'], registers: [registry],   // ok | error
}));
export const interventionsCreated = M(() => new client.Counter({
    name: 'chibalete_interventions_created_total',
    help: 'Intervenciones registradas por docentes',
    labelNames: ['intervention_type'], registers: [registry],
}));
export const riskFlagsActive = M(() => new client.Gauge({
    name: 'chibalete_risk_flags_active_total',
    help: 'Riesgos pedagógicos activos (no resueltos)',
    registers: [registry],
}));
export const rulesTriggered = M(() => new client.Counter({
    name: 'chibalete_rules_triggered_total',
    help: 'Reglas pedagógicas disparadas',
    labelNames: ['rule_id', 'severity'], registers: [registry],
}));
export const recommendationConfidenceAvg = M(() => new client.Gauge({
    name: 'chibalete_recommendation_confidence_avg',
    help: 'Confianza promedio de recomendaciones del último runOnce',
    registers: [registry],
}));
export const teacherAcknowledged = M(() => new client.Counter({
    name: 'chibalete_teacher_acknowledged_total',
    help: 'Recomendaciones aceptadas/vistas por el docente',
    registers: [registry],
}));
// PASO 4 — escalabilidad / longitudinalidad / observabilidad avanzada (§14).
// Cardinalidad estrictamente acotada: granularity∈3, query_id∈enum corto,
// run_type∈5, label∈enum. NUNCA user/student/content IDs.
//
// (sqliteBusy ya existe desde P2-B — se reutiliza vía sqliteBusy.labels(db).inc()
// en los engines que detecten SQLITE_BUSY; no se duplica aquí.)
export const materializerReplay = M(() => new client.Counter({
    name: 'chibalete_materializer_replay_total',
    help: 'Replays completados/fallados/cancelados',
    labelNames: ['result'], registers: [registry],   // completed | failed | canceled | stalled
}));
export const rollupUpdates = M(() => new client.Counter({
    name: 'chibalete_rollup_updates_total',
    help: 'Upserts a rollups temporales',
    labelNames: ['granularity'], registers: [registry],  // daily | weekly | monthly
}));
export const snapshotHistoryTotal = M(() => new client.Counter({
    name: 'chibalete_snapshot_history_total',
    help: 'Filas append-only en signal_snapshots_history',
    registers: [registry],
}));
export const featureVectorsComputed = M(() => new client.Counter({
    name: 'chibalete_feature_vectors_total',
    help: 'Feature vectors upserted (IA-ready)',
    registers: [registry],
}));
export const dashboardLatency = M(() => new client.Histogram({
    name: 'chibalete_dashboard_latency_ms',
    help: 'Latencia de queries de dashboard (instrumentadas con queryProfiler)',
    labelNames: ['endpoint'],
    buckets: [10, 25, 50, 100, 150, 250, 500, 1000, 2500, 5000],
    registers: [registry],
}));
export const querySlow = M(() => new client.Counter({
    name: 'chibalete_query_slow_total',
    help: 'Queries que superan SLOW_THRESHOLD_MS (default 250ms)',
    labelNames: ['query_id'], registers: [registry],
}));
export const archiveGrowthBytes = M(() => new client.Gauge({
    name: 'chibalete_archive_growth_bytes',
    help: 'Tamaño actual del archivo events.archive.db en bytes',
    registers: [registry],
}));
export const walSizeBytes = M(() => new client.Gauge({
    name: 'chibalete_wal_size_bytes',
    help: 'Tamaño actual del WAL (.-wal) por db',
    labelNames: ['db'], registers: [registry],   // events | insights
}));
export const leaderStatus = M(() => new client.Gauge({
    name: 'chibalete_leader_status',
    help: '1 si este proceso es líder para el lock_key, 0 en caso contrario',
    labelNames: ['lock_key'], registers: [registry],
}));
// PASO 5 — observabilidad operacional UI (§22). Cardinalidad fija:
// dashboard∈enum (~10 paneles), where∈enum (~20), reason∈enum (~10),
// outcome∈{improved,no_change,worsened,pending}. NUNCA user/student IDs.
export const dashboardViewsTotal = M(() => new client.Counter({
    name: 'chibalete_dashboard_views_total',
    help: 'Vistas de paneles Aula Viva operacionales',
    labelNames: ['dashboard'], registers: [registry],
}));
export const recommendationAcceptTotal = M(() => new client.Counter({
    name: 'chibalete_recommendation_accept_total',
    help: 'Recomendaciones aceptadas (acknowledged+applied) por docentes',
    registers: [registry],
}));
export const recommendationDismissTotal = M(() => new client.Counter({
    name: 'chibalete_recommendation_dismiss_total',
    help: 'Recomendaciones descartadas por docentes',
    registers: [registry],
}));
export const interventionClosedTotal = M(() => new client.Counter({
    name: 'chibalete_intervention_closed_total',
    help: 'Intervenciones cerradas con outcome',
    labelNames: ['outcome'], registers: [registry],
}));
export const uiDegradedModeTotal = M(() => new client.Counter({
    name: 'chibalete_ui_degraded_mode_total',
    help: 'Renders de degraded mode banner en UI',
    labelNames: ['reason'], registers: [registry],
}));
export const emptyStateRenderTotal = M(() => new client.Counter({
    name: 'chibalete_empty_state_render_total',
    help: 'Renders de empty state en UI (where=identificador del panel)',
    labelNames: ['where'], registers: [registry],
}));
export const cohortRenderMs = M(() => new client.Histogram({
    name: 'chibalete_cohort_render_ms',
    help: 'Tiempo de render del panel de cohortes',
    buckets: [10, 50, 100, 250, 500, 1000, 2500], registers: [registry],
}));
export const studentTimelineRenderMs = M(() => new client.Histogram({
    name: 'chibalete_student_timeline_render_ms',
    help: 'Tiempo de render del timeline del estudiante',
    buckets: [10, 50, 100, 250, 500, 1000, 2500], registers: [registry],
}));
// PASO 6 — outcomes + cohorts + trajectories + learnings + predictive (§20).
// Cardinalidad estrictamente acotada: label∈5, type∈enum corto, scope∈enum,
// version∈corto. NUNCA userId/groupId/schoolId/contentId/email/sessionId.
export const outcomesComputed = M(() => new client.Counter({
    name: 'chibalete_outcomes_computed_total',
    help: 'Outcomes evaluados por outcomeEngine',
    labelNames: ['label'], registers: [registry],  // improved|stable|worsened|mixed|insufficient_data
}));
export const outcomeConfidenceAvg = M(() => new client.Gauge({
    name: 'chibalete_outcome_confidence_avg',
    help: 'Confianza promedio del último runOnce de outcomeEngine',
    registers: [registry],
}));
export const cohortsBuilt = M(() => new client.Counter({
    name: 'chibalete_cohorts_built_total',
    help: 'Cohortes construidas/refrescadas por cohortBuilder',
    labelNames: ['type'], registers: [registry],
}));
export const trajectoriesComputed = M(() => new client.Counter({
    name: 'chibalete_trajectories_computed_total',
    help: 'Trayectorias por cohort_type',
    labelNames: ['scope'], registers: [registry],
}));
export const institutionalLearningsTotal = M(() => new client.Counter({
    name: 'chibalete_institutional_learnings_total',
    help: 'Aprendizajes institucionales generados',
    labelNames: ['type'], registers: [registry],
}));
export const predictivePatternsTotal = M(() => new client.Counter({
    name: 'chibalete_predictive_patterns_total',
    help: 'Patrones predictivos registrados (versión)',
    labelNames: ['version'], registers: [registry],
}));
export const outcomeInsufficientData = M(() => new client.Counter({
    name: 'chibalete_outcome_insufficient_data_total',
    help: 'Outcomes clasificados como insufficient_data',
    registers: [registry],
}));
export const interventionFollowupDue = M(() => new client.Gauge({
    name: 'chibalete_intervention_followup_due_total',
    help: 'Intervenciones cuya ventana de follow-up venció y aún no se evaluaron',
    registers: [registry],
}));
// PASO 7 — observabilidad institucional (§19). Cardinalidad estrictamente
// acotada: view∈enum corto, scope∈enum, where∈enum. NUNCA userId/groupId/
// schoolId/contentId/email/sessionId.
export const outcomesViewsTotal = M(() => new client.Counter({
    name: 'chibalete_outcomes_views_total',
    help: 'Vistas de paneles de outcomes',
    labelNames: ['view'], registers: [registry],
}));
export const cohortViewsTotal = M(() => new client.Counter({
    name: 'chibalete_cohort_views_total',
    help: 'Vistas de paneles de cohortes',
    labelNames: ['view'], registers: [registry],
}));
export const trajectoryViewsTotal = M(() => new client.Counter({
    name: 'chibalete_trajectory_views_total',
    help: 'Vistas de trayectorias',
    labelNames: ['view'], registers: [registry],
}));
export const learningViewsTotal = M(() => new client.Counter({
    name: 'chibalete_learning_views_total',
    help: 'Vistas de aprendizajes institucionales',
    labelNames: ['view'], registers: [registry],
}));
export const comparativeQueriesTotal = M(() => new client.Counter({
    name: 'chibalete_comparative_queries_total',
    help: 'Queries de comparative intelligence',
    labelNames: ['view'], registers: [registry],
}));
export const followupCompletedTotal = M(() => new client.Counter({
    name: 'chibalete_followup_completed_total',
    help: 'Follow-ups de intervención cerrados por el docente',
    registers: [registry],
}));
export const scopeSwitchTotal = M(() => new client.Counter({
    name: 'chibalete_scope_switch_total',
    help: 'Cambios de scope en la UI institucional',
    labelNames: ['to'], registers: [registry],
}));
export const uiLatencyMs = M(() => new client.Histogram({
    name: 'chibalete_ui_latency_ms',
    help: 'Latencia auto-reportada por la UI (donde el cliente mide)',
    labelNames: ['where'],
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [registry],
}));

/** Middleware de latencia. Overhead ~0 si METRICS_ENABLED off. */
export function metricsMiddleware(req, res, next) {
    if (!METRICS_ENABLED) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        try {
            const route = normalizeRoute(req.baseUrl ? req.baseUrl + req.path : req.path);
            const labels = { route, method: req.method, status_class: statusClass(res.statusCode) };
            const sec = Number(process.hrtime.bigint() - start) / 1e9;
            httpDuration.labels(labels.route, labels.method, labels.status_class).observe(sec);
            httpTotal.labels(labels.route, labels.method, labels.status_class).inc();
        } catch { /* métrica jamás rompe la request */ }
    });
    next();
}

/** Handler de /metrics. Devuelve 404 si deshabilitado (no expone superficie). */
export async function metricsHandler(_req, res) {
    if (!METRICS_ENABLED) return res.status(404).end();
    try {
        res.set('Content-Type', registry.contentType);
        res.end(await registry.metrics());
    } catch (e) {
        res.status(500).end(`# metrics error: ${e.message}`);
    }
}
