/**
 * insightsStateEngine.test.js — Sprint Data Backbone Fase 6C
 *
 * Cubre el motor de estados + la persistencia. DB temporal aislada.
 * Ejecutar:
 *   node server/__test__/insightsStateEngine.test.js
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, '../../.tmp-insights-engine-test.db');
process.env.INSIGHTS_SQLITE_PATH = TMP_DB;
for (const ext of ['', '-shm', '-wal']) {
    const f = TMP_DB + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

const { processInsightsSnapshot } = await import('../insightsStateEngine.js');
const {
    getStateByKey,
    listStates,
    listNotifications,
    acknowledgeState,
    dismissState,
    getScopeSummary,
    closeDb,
} = await import('../insightsStore.js');

let pass = 0;
let fail = 0;
function assert(cond, label, detail = '') {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else      { fail += 1; console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── Helpers de fixture ───────────────────────────────────────────────────────

function fixtureInsight({
    id = 'insight.lu.errors_high.global',
    type = 'error',
    severity = 'warning',
    title = 'Errores LU',
    value = 0.15,
    threshold = 0.1,
    sampleSize = 30,
} = {}) {
    return {
        id, type, severity, title,
        description: 'desc',
        evidence: { metric: 'm', value, threshold, sampleSize },
        recommendation: 'rec',
        scope: { level: 'global' },
        createdAt: Date.now(),
    };
}

function snapshot(insightsArr) {
    return {
        generatedAt: Date.now(),
        windowDays:  30,
        severitySummary: { critical: 0, warning: 0, info: 0, total: insightsArr.length },
        insights: insightsArr,
    };
}

const SCOPE = { level: 'global', id: null };

// ──────────────────────────────────────────────────────────────────────────
// TEST 1 — Primer snapshot crea state nuevo, occurrences=1
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 1] Primer snapshot: state nuevo, occurrences=1, no previous_value');
{
    const ins = fixtureInsight({ severity: 'warning', value: 0.15 });
    const r = processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    assert(r.statesNew === 1,                          'statesNew = 1');
    assert(r.statesUpdated === 0,                      'statesUpdated = 0');
    assert(r.statesResolved === 0,                     'statesResolved = 0');
    assert(r.insightsPersisted === 1,                  'insightsPersisted = 1');
    const state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(!!state,                                    'state existe');
    assert(state.occurrences === 1,                    'occurrences = 1');
    assert(state.status === 'active',                  'status = active');
    assert(state.last_value === 0.15,                  'last_value = 0.15');
    assert(state.previous_value === null,              'previous_value = null');
    assert(state.delta_value === null,                 'delta_value = null');
    assert(state.first_seen_at === state.last_seen_at, 'first_seen = last_seen');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 2 — Segundo snapshot igual: occurrences=2, delta=0
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 2] Segundo snapshot idéntico: occurrences=2, delta=0');
{
    const ins = fixtureInsight({ severity: 'warning', value: 0.15 });
    const r = processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    assert(r.statesUpdated === 1,                      'statesUpdated = 1');
    assert(r.statesNew === 0,                          'statesNew = 0');
    const state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(state.occurrences === 2,                    'occurrences = 2');
    assert(state.previous_value === 0.15,              'previous_value = 0.15');
    assert(state.last_value === 0.15,                  'last_value = 0.15');
    assert(state.delta_value === 0,                    'delta_value = 0');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 3 — Insight empeora (delta positivo, severity sube)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 3] Insight empeora: delta_value > 0, severity actualiza');
{
    const ins = fixtureInsight({ severity: 'critical', value: 0.32, threshold: 0.25 });
    const r = processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    assert(r.statesUpdated === 1,                      'statesUpdated = 1');
    const state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(state.severity === 'critical',              'severity = critical');
    assert(Math.abs(state.delta_value - 0.17) < 1e-9,  `delta = 0.17 (got ${state.delta_value})`);
    assert(state.last_value === 0.32,                  'last_value = 0.32');
    assert(state.occurrences === 3,                    'occurrences = 3');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 4 — Insight desaparece → status resolved
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 4] Snapshot vacío → state previo se marca resolved');
{
    const r = processInsightsSnapshot({ insights: snapshot([]), scope: SCOPE, windowDays: 30 });
    assert(r.statesResolved === 1,                     'statesResolved = 1');
    const state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(state.status === 'resolved',                'status = resolved');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 5 — Acknowledged: status acknowledged + actor seteado
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 5] Ack: state pasa a acknowledged');
{
    // Reactivamos: emitir el insight para que vuelva a active.
    const ins = fixtureInsight({ severity: 'warning', value: 0.18 });
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    const ackOk = acknowledgeState('insight.lu.errors_high.global::global::_', 'mediator-42', Date.now());
    assert(ackOk,                                      'ack devolvió true');
    const state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(state.status === 'acknowledged',            'status = acknowledged');
    assert(state.acknowledged_by === 'mediator-42',    'acknowledged_by = mediator-42');
    assert(typeof state.acknowledged_at === 'number',  'acknowledged_at numérico');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 6 — Dismiss 7 días: dismissed_until futuro, no se reactiva
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 6] Dismiss 7 días: state se mantiene dismissed en snapshot siguiente');
{
    const dismissUntil = Date.now() + 7 * 86_400_000;
    const ok = dismissState('insight.lu.errors_high.global::global::_', dismissUntil, Date.now());
    assert(ok, 'dismiss devolvió true');
    let state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(state.status === 'dismissed',           'status = dismissed');
    assert(state.dismissed_until === dismissUntil, 'dismissed_until correcto');

    // Snapshot siguiente con la condición todavía activa NO debería reactivar.
    const ins = fixtureInsight({ severity: 'warning', value: 0.20 });
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    state = getStateByKey('insight.lu.errors_high.global::global::_');
    assert(state.status === 'dismissed',           'sigue dismissed tras snapshot');
    assert(state.last_value === 0.20,              'last_value sí actualiza (last_seen sigue vivo)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 7 — Critical reactivates: si acknowledged y vuelve critical → active
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 7] Escalación a critical reactiva un state acknowledged');
{
    // Nueva fixture en otro id para no chocar con el dismissed previo.
    const id = 'insight.reading.early_dropoff.global';
    const key = `${id}::global::_`;
    const insWarning = fixtureInsight({ id, severity: 'warning', value: 0.40, threshold: 0.5 });
    processInsightsSnapshot({ insights: snapshot([insWarning]), scope: SCOPE, windowDays: 30 });
    acknowledgeState(key, 'mediator-99', Date.now());
    let state = getStateByKey(key);
    assert(state.status === 'acknowledged',  'inicialmente acknowledged');

    const insCritical = fixtureInsight({ id, severity: 'critical', value: 0.10, threshold: 0.5 });
    processInsightsSnapshot({ insights: snapshot([insCritical]), scope: SCOPE, windowDays: 30 });
    state = getStateByKey(key);
    assert(state.status === 'active',                'reactivado a active');
    assert(state.severity === 'critical',            'severity = critical');
    assert(state.acknowledged_at === null,           'ack limpiado');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 8 — Notification: critical nuevo crea pending notification
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 8] Insight critical nuevo crea notification pending');
{
    const id = 'insight.a11y.content_errors.global';
    const ins = fixtureInsight({ id, severity: 'critical', value: 5, threshold: 3, sampleSize: 20 });
    const r = processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    assert(r.notificationsCreated >= 1,             'notificationsCreated >= 1');
    const notifs = listNotifications({ status: 'pending' });
    const newCrit = notifs.find(n => {
        const p = JSON.parse(n.payload_json);
        return p.type === 'new_critical' && n.insight_key.startsWith(id);
    });
    assert(!!newCrit,                                'notification new_critical encontrada');
    assert(newCrit.severity === 'critical',          'severity = critical');
    assert(newCrit.channel === 'dashboard',          'channel = dashboard');
    assert(newCrit.status === 'pending',             'status = pending');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 9 — Persistent warning: 3 snapshots seguidos → notification
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 9] Warning con 3 occurrencias seguidas → notification persistent_warning');
{
    const id = 'insight.lu.download_dropoff.global';
    const key = `${id}::global::_`;
    // Snapshots 1 y 2 ya generaron occurrences si el insight se emitió, pero
    // empezamos limpio: insertamos por primera vez.
    const ins = fixtureInsight({ id, severity: 'warning', value: 0.10, threshold: 0.3, sampleSize: 50 });
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 }); // occ=1
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 }); // occ=2
    let notifs = listNotifications({ status: 'pending' }).filter(n => n.insight_key === key);
    assert(notifs.length === 0,                     'sin notifications aún en occ=2');

    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 }); // occ=3
    notifs = listNotifications({ status: 'pending' }).filter(n => {
        const p = JSON.parse(n.payload_json);
        return n.insight_key === key && p.type === 'persistent_warning';
    });
    assert(notifs.length === 1,                     'notification persistent_warning creada');

    // 4to snapshot: no duplica
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    notifs = listNotifications({ status: 'pending' }).filter(n => {
        const p = JSON.parse(n.payload_json);
        return n.insight_key === key && p.type === 'persistent_warning';
    });
    assert(notifs.length === 1,                     'no se duplica notification (dedup)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 10 — Worsening: warning con delta > 0.15 (ratio) crea notification
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 10] Warning empeora ratio +0.20 → notification worsening');
{
    const id = 'insight.immersive.no_audio.global';
    const key = `${id}::global::_`;
    // Estado base: warning con value=0.20.
    let ins = fixtureInsight({ id, severity: 'warning', value: 0.20, threshold: 0.5, sampleSize: 30 });
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    // Empeora: value baja (más alto delta es peor para una métrica positiva,
    // pero el spec dice "delta_value > 0.15": tomo el caso ratio en aumento
    // para una métrica negativa). Como nuestra heurística es genérica,
    // simulamos un delta positivo.
    ins = fixtureInsight({ id, severity: 'warning', value: 0.42, threshold: 0.5, sampleSize: 30 });
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    const notifs = listNotifications({ status: 'pending' }).filter(n => {
        const p = JSON.parse(n.payload_json);
        return n.insight_key === key && p.type === 'worsening';
    });
    assert(notifs.length === 1,                     'notification worsening creada (delta = +0.22)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 11 — Critical reaparece tras resolved → notification critical_reappears
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 11] Critical reaparece tras resolved → notification critical_reappears');
{
    const id = 'insight.mode.low_progress.text.global';
    const key = `${id}::global::_`;
    const insCrit = fixtureInsight({ id, severity: 'critical', value: 0.05, threshold: 0.15, sampleSize: 30 });
    processInsightsSnapshot({ insights: snapshot([insCrit]), scope: SCOPE, windowDays: 30 });
    // Snapshot vacío: el insight desaparece → resolved
    processInsightsSnapshot({ insights: snapshot([]), scope: SCOPE, windowDays: 30 });
    const stateMid = getStateByKey(key);
    assert(stateMid && stateMid.status === 'resolved', 'state pasó a resolved');

    // Reaparece critical
    processInsightsSnapshot({ insights: snapshot([insCrit]), scope: SCOPE, windowDays: 30 });
    const stateAfter = getStateByKey(key);
    assert(stateAfter.status === 'active',          'reactivado active');
    const notifs = listNotifications({ status: 'pending' }).filter(n => {
        const p = JSON.parse(n.payload_json);
        return n.insight_key === key && p.type === 'critical_reappears';
    });
    assert(notifs.length === 1,                     'notification critical_reappears creada');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 12 — listStates filtros + getScopeSummary
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 12] listStates / getScopeSummary');
{
    const allActive    = listStates({ status: 'active' });
    const allResolved  = listStates({ status: 'resolved' });
    const allDismissed = listStates({ status: 'dismissed' });
    assert(allActive.length    >= 1,                'al menos 1 state active');
    assert(allResolved.length  >= 0,                'lista de resolved sana');
    assert(allDismissed.length >= 1,                'al menos 1 dismissed (TEST 6)');

    const summary = getScopeSummary('global', null);
    assert(typeof summary.activeCount === 'number',   'summary.activeCount numérico');
    assert(typeof summary.criticalCount === 'number', 'summary.criticalCount numérico');
    assert(typeof summary.warningCount === 'number',  'summary.warningCount numérico');
    assert(typeof summary.lastSnapshotAt === 'number','summary.lastSnapshotAt numérico');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 13 — Value no numérico no rompe (delta = null)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 13] evidence.value no numérico no rompe — last_value/delta = null');
{
    const id = 'insight.test.non_numeric.global';
    const ins = fixtureInsight({ id, severity: 'warning' });
    ins.evidence.value = 'abc'; // no numérico
    processInsightsSnapshot({ insights: snapshot([ins]), scope: SCOPE, windowDays: 30 });
    const state = getStateByKey(`${id}::global::_`);
    assert(state.last_value === null,               'last_value = null');
    assert(state.delta_value === null,              'delta_value = null');
}

// ──────────────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────`);
console.log(`Resultado: ${pass} pass / ${fail} fail`);
console.log(`──────────────────────────────────────────────`);

closeDb();
for (const ext of ['', '-shm', '-wal']) {
    const f = TMP_DB + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

process.exit(fail === 0 ? 0 : 1);
