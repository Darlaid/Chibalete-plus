/**
 * backboneInsights.test.js — Sprint Data Backbone Fase 6B
 *
 * Cubre las 10 reglas del agregador de insights. Fixtures en memoria.
 * Ejecutar:
 *   node server/__test__/backboneInsights.test.js
 */

const { computeBackboneInsights, emptyBackboneInsights } =
    await import('../backboneInsights.js');

let pass = 0;
let fail = 0;
function assert(cond, label, detail = '') {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else      { fail += 1; console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── Helpers de fixture ───────────────────────────────────────────────────────
//
// Construyen shapes mínimos compatibles con backboneMetrics y backboneFunnels.

function emptyMetrics() {
    return {
        sourceBreakdown: {
            native: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
            legacy: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
        },
        usageByMode:       {},
        progressByMode:    {},
        heartbeatCoverage: {},
    };
}

function withNativeData(m, totalEvents = 100) {
    m.sourceBreakdown.native.totalEvents = totalEvents;
    return m;
}

function fnFunnel(stepCounts, extras = {}) {
    const stepDefs = Object.keys(stepCounts);
    const steps = stepDefs.map((k, i) => ({
        key: k, label: k, count: stepCounts[k], uniqueUsers: stepCounts[k],
        conversionFromPrevious: i === 0 ? null : (stepCounts[stepDefs[i - 1]] > 0 ? stepCounts[k] / stepCounts[stepDefs[i - 1]] : 0),
        conversionFromStart:    i === 0 ? (stepCounts[k] > 0 ? 1 : 0) : (stepCounts[stepDefs[0]] > 0 ? stepCounts[k] / stepCounts[stepDefs[0]] : 0),
    }));
    const summary = {
        starts:         stepCounts[stepDefs[0]] ?? 0,
        completions:    stepCounts[stepDefs[stepDefs.length - 1]] ?? 0,
        completionRate: 0,
        biggestDropoff: null,
    };
    return { id: 'x', label: 'x', steps, dropoffs: [], summary, ...extras };
}

function fnAll(funnelsByKey) {
    return {
        sourceFilter: 'native',
        funnels: funnelsByKey,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 1 — Sin datos native → solo insight info "no_native_data"
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 1] Sin datos native → info "no_native_data"');
{
    const m = emptyMetrics();
    const f = fnAll({});
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    assert(r.insights.length === 1,                              'exactamente 1 insight');
    assert(r.insights[0].id === 'insight.global.no_native_data', 'id correcto');
    assert(r.insights[0].severity === 'info',                    'severidad info');
    assert(r.insights[0].type === 'technical',                   'type technical');
    assert(r.severitySummary.info === 1,                         'severitySummary.info = 1');
    assert(r.severitySummary.critical === 0,                     'no críticos');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 2 — Reading early dropoff (start 20, heartbeat 5)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 2] Reading early dropoff: 20/5 → warning');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        reading: fnFunnel({
            session_start: 20, session_heartbeat: 5, progress: 5, session_end: 5,
        }),
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.reading.early_dropoff.global');
    assert(!!ins,                                  'insight emitido');
    assert(ins.severity === 'warning',             'warning');
    assert(ins.type === 'retention',               'type retention');
    assert(Math.abs(ins.evidence.value - 0.25) < 1e-9, 'value = 5/20 = 0.25');
    assert(ins.evidence.threshold === 0.5,         'threshold 0.5');
    assert(ins.evidence.sampleSize === 20,         'sampleSize 20');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 3 — LU download dropoff (page_view 20, download_start 3)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 3] LU download dropoff: 20/3 → warning');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        lu: { ...fnFunnel({
            page_view: 20, version_check: 15, download_start: 3, download_success: 2,
        }), errors: { total: 0, byType: {} } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.lu.download_dropoff.global');
    assert(!!ins,                                  'insight emitido');
    assert(ins.severity === 'warning',             'warning');
    assert(Math.abs(ins.evidence.value - 0.15) < 1e-9, 'value = 3/20');
    assert(ins.evidence.sampleSize === 20,         'sampleSize 20');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 4 — LU high errors (20 page_view, 6 errors → 30% → critical)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 4] LU errors 6/20 = 30% → critical');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        lu: { ...fnFunnel({
            page_view: 20, version_check: 18, download_start: 14, download_success: 14,
        }), errors: { total: 6, byType: { apk_url_missing: 4, version_fetch_failed: 2 } } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.lu.errors_high.global');
    assert(!!ins,                       'insight emitido');
    assert(ins.severity === 'critical', 'severidad critical (30% > 25%)');
    assert(ins.type === 'error',        'type error');
    assert(Math.abs(ins.evidence.value - 0.3) < 1e-9, 'value = 6/20');
    assert(ins.evidence.threshold === 0.25, 'threshold critical = 0.25');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 4b — LU errors moderate (3/20 = 15%) → warning, no critical
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 4b] LU errors 3/20 = 15% → warning');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        lu: { ...fnFunnel({ page_view: 20, version_check: 18, download_start: 14, download_success: 14 }),
              errors: { total: 3, byType: { apk_url_missing: 3 } } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.lu.errors_high.global');
    assert(!!ins && ins.severity === 'warning',         'warning (15% > 10% pero <= 25%)');
    assert(ins.evidence.threshold === 0.1,              'threshold warning = 0.10');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 5 — Inmersivo sin audio (start 10, plays 2 → 20%)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 5] Inmersivo: 10 starts / 2 plays → warning');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        immersive: { ...fnFunnel({ session_start: 10, audio_play: 2, session_heartbeat: 2, session_end: 2 }),
                     audio: { playSessions: 2, pauseSessions: 0, playPauseRatio: 1 } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.immersive.no_audio.global');
    assert(!!ins,                                  'insight emitido');
    assert(ins.severity === 'warning',             'warning');
    assert(ins.type === 'dropoff',                 'type dropoff');
    assert(Math.abs(ins.evidence.value - 0.2) < 1e-9, 'value = 2/10');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 6 — A11y content errors (3 ocurrencias → critical)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 6] A11y content errors (text_unavailable=2, doc_empty=1) → critical');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        a11y: { ...fnFunnel({ session_start: 10, progress: 8, session_end: 6 }),
                errors: { total: 5, byType: { text_unavailable: 2, doc_empty: 1, other: 2 } } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.a11y.content_errors.global');
    assert(!!ins,                                                 'insight emitido');
    assert(ins.severity === 'critical',                           'critical (>= 3 ocurrencias)');
    assert(ins.evidence.value === 3,                              'value = 3 (text_unavailable+doc_empty)');
}

console.log('\n[TEST 6b] A11y content errors leve (1 doc_empty, 1 sesión) → warning');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        a11y: { ...fnFunnel({ session_start: 20, progress: 18, session_end: 16 }),
                errors: { total: 1, byType: { doc_empty: 1 } } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.a11y.content_errors.global');
    assert(!!ins,                       'insight emitido');
    assert(ins.severity === 'warning',  'warning (solo 1 ocurrencia, baja tasa)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 7 — Bajo progreso modo text (avg 0.10, 20 sesiones)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 7] Bajo progreso text (0.10, 20 sesiones) → warning');
{
    const m = withNativeData(emptyMetrics());
    m.usageByMode.text       = { sessionStarts: 20, sessionEnds: 18, heartbeats: 20, activeUsers: 15, activeContents: 5 };
    m.progressByMode.text    = { averageProgressFraction: 0.10, maxProgressFraction: 0.4, completedCount: 0 };
    m.heartbeatCoverage.text = { sessionsWithHeartbeat: 20, sessionsWithoutHeartbeat: 0, coveragePercent: 100 };
    const f = fnAll({});
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.mode.low_progress.text.global');
    assert(!!ins,                       'insight emitido');
    assert(ins.severity === 'warning',  'warning');
    assert(ins.type === 'progress',     'type progress');
    assert(ins.mode === 'text',         'mode text');
    assert(Math.abs(ins.evidence.value - 0.1) < 1e-9, 'value 0.1');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 8 — Heartbeat coverage bajo
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 8] Heartbeat coverage 30% en album → warning');
{
    const m = withNativeData(emptyMetrics());
    m.usageByMode.album       = { sessionStarts: 12, sessionEnds: 10, heartbeats: 5, activeUsers: 8, activeContents: 3 };
    m.progressByMode.album    = { averageProgressFraction: 0.5, maxProgressFraction: 1.0, completedCount: 5 };
    m.heartbeatCoverage.album = { sessionsWithHeartbeat: 4, sessionsWithoutHeartbeat: 8, coveragePercent: 30 };
    const f = fnAll({});
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.mode.low_heartbeat.album.global');
    assert(!!ins,                              'insight emitido');
    assert(ins.severity === 'warning',         'warning');
    assert(ins.type === 'technical',           'type technical');
    assert(ins.evidence.value === 30,          'coveragePercent = 30');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 9 — Sin duplicados: misma regla no emite dos veces
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 9] Sin duplicados (mismo id ocurre una vez)');
{
    const m = withNativeData(emptyMetrics());
    const f = fnAll({
        reading: fnFunnel({ session_start: 30, session_heartbeat: 5, progress: 3, session_end: 2 }),
        // condiciones que dispararían múltiples reglas distintas — pero
        // ningún id se duplica.
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ids = r.insights.map(i => i.id);
    const uniqueIds = [...new Set(ids)];
    assert(ids.length === uniqueIds.length, 'sin ids duplicados');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 10 — Orden: critical antes que warning antes que info
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 10] Orden por severidad (critical → warning → info)');
{
    const m = withNativeData(emptyMetrics());
    // Modo dominante (info) + LU errors crítico + reading dropoff (warning).
    m.usageByMode.text  = { sessionStarts: 15, sessionEnds: 14, heartbeats: 15, activeUsers: 30, activeContents: 5 };
    m.usageByMode.album = { sessionStarts: 5,  sessionEnds: 5,  heartbeats: 5,  activeUsers: 5,  activeContents: 1 };
    const f = fnAll({
        reading: fnFunnel({ session_start: 30, session_heartbeat: 5, progress: 3, session_end: 2 }),
        lu: { ...fnFunnel({ page_view: 20, version_check: 18, download_start: 14, download_success: 14 }),
              errors: { total: 8, byType: { apk_url_missing: 8 } } },
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    // Esperamos: critical (lu.errors), warning (reading.early_dropoff y reading.low_close), info (modo dominante text)
    assert(r.insights.length >= 3, `>= 3 insights (got ${r.insights.length})`);
    assert(r.insights[0].severity === 'critical',                  'primer insight es critical');
    const lastInsight = r.insights[r.insights.length - 1];
    assert(lastInsight.severity === 'info',                        'último insight es info');
    // Severitysummary contiene los conteos correctos.
    assert(r.severitySummary.critical >= 1, 'al menos 1 critical');
    assert(r.severitySummary.warning  >= 1, 'al menos 1 warning');
    assert(r.severitySummary.info     >= 1, 'al menos 1 info');
    assert(r.severitySummary.total === r.insights.length, 'total = length');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 11 — Modo dominante por adopción
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 11] Modo text concentra > 50% adopción → info');
{
    const m = withNativeData(emptyMetrics());
    m.usageByMode.text  = { sessionStarts: 10, sessionEnds: 8, heartbeats: 10, activeUsers: 30, activeContents: 5 };
    m.usageByMode.album = { sessionStarts: 5,  sessionEnds: 5, heartbeats: 5,  activeUsers: 5,  activeContents: 1 };
    m.usageByMode.pdf   = { sessionStarts: 3,  sessionEnds: 3, heartbeats: 3,  activeUsers: 3,  activeContents: 1 };
    const f = fnAll({});
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.mode.dominant_adoption.text.global');
    assert(!!ins,                  'insight emitido');
    assert(ins.severity === 'info','severity info');
    assert(ins.mode === 'text',    'mode text');
    // share = 30 / 38 ≈ 0.789
    assert(ins.evidence.value > 0.7, 'share > 0.7');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 12 — Sample mínimo: reglas no aplican con pocos datos
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 12] Sample mínimo: reglas con sample < umbral no emiten');
{
    const m = withNativeData(emptyMetrics());
    // 5 sesiones reading con dropoff brutal — debajo del umbral mínimo de 10
    const f = fnAll({
        reading: fnFunnel({ session_start: 5, session_heartbeat: 0, progress: 0, session_end: 0 }),
    });
    const r = computeBackboneInsights({ metrics: m, funnels: f, windowDays: 30 });
    const ins = r.insights.find(i => i.id === 'insight.reading.early_dropoff.global');
    assert(!ins, 'reading.early_dropoff NO emitido (sample = 5 < 10)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 13 — emptyBackboneInsights shape válido
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 13] emptyBackboneInsights shape');
{
    const e = emptyBackboneInsights({ windowDays: 30 });
    assert(Array.isArray(e.insights),                  'insights es array');
    assert(e.insights.length === 0,                    'array vacío');
    assert(e.severitySummary.total === 0,              'total 0');
    assert(typeof e.generatedAt === 'number',          'generatedAt presente');
}

// ──────────────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────`);
console.log(`Resultado: ${pass} pass / ${fail} fail`);
console.log(`──────────────────────────────────────────────`);
process.exit(fail === 0 ? 0 : 1);
