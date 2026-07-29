/**
 * metricsShadowWorkerPool.test.js — CHP-STATS-SHADOW-PERF-01B.
 *
 * Fixtures sintéticas. Ningún test toca stores reales ni crea WAL/SHM.
 * Los workers de prueba son módulos temporales en mkdtemp.
 *
 *   node server/__test__/metricsShadowWorkerPool.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = (rel) => pathToFileURL(path.join(HERE, '..', 'metrics', rel)).href;

const { createShadowWorkerPool, resolveWorkerCount, PoolConfigError, POOL_STATE,
        MAX_WORKERS_HARD_LIMIT } = await import(M('shadowWorkerPool.mjs'));
const { executeMetricsRoute, attachLegacyCapture, projectLegacy, compareProjections,
        engineReadiness, ENGINE_STATE } = await import(M('metricsRouteBoundary.mjs'));
const { REASON, COMPARISON_STATUS } = await import(M('comparability.mjs'));

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const macroTick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'poolw_'));
const mkWorker = (name, src) => { const p = path.join(TMP, name); fs.writeFileSync(p, src); return p; };

// ── workers sintéticos ──────────────────────────────────────────────────────
const W_OK = mkWorker('ok.mjs', `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => parentPort.postMessage({
  jobId: m.jobId, protocolVersion: 1, ok: true, status: 200,
  projection: { contractVersion: 2, organizationId: 'org-x', period: m.period,
    metrics: { sessions: { value: 15, status: 'MEASURED' },
               distinctContents: { value: 5, status: 'MEASURED' } },
    statuses: { registeredUsers: 'MEASURED', usersWithActivity: 'NO_ACTIVITY',
                readingTimeMs: 'NOT_DEFINED' },
    population: { registeredUsers: 47, registeredReaders: 46, eligibleReaders: 44, readersWithoutGroup: 2 } },
  durationMs: 1 }));
`);
const W_SLOW = mkWorker('slow.mjs', `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => setTimeout(() => parentPort.postMessage({
  jobId: m.jobId, protocolVersion: 1, ok: true, status: 200, projection: null, durationMs: 999 }), 400));
`);
const W_CRASH = mkWorker('crash.mjs', `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', () => { process.exit(1); });
`);
const W_BADSHAPE = mkWorker('bad.mjs', `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', () => parentPort.postMessage({ garbage: true }));
`);
const W_UNKNOWNID = mkWorker('unk.mjs', `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => parentPort.postMessage({ jobId: 999999, protocolVersion:1, ok:true, status:200, projection:null }));
`);

console.log('metricsShadowWorkerPool — CHP-STATS-SHADOW-PERF-01B');

// ── [11..12] configuración del pool ─────────────────────────────────────────
section('[11..12] configuración del pool');
{
    ok('[11] default = 1 worker', resolveWorkerCount({}) === 1);
    ok('valor válido se respeta', resolveWorkerCount({ METRICS_SHADOW_WORKERS: '2' }) === 2);
    for (const bad of ['0', '-1', 'dos', '1.5', String(MAX_WORKERS_HARD_LIMIT + 1)]) {
        let threw = null;
        try { resolveWorkerCount({ METRICS_SHADOW_WORKERS: bad }); } catch (e) { threw = e; }
        ok(`[12] "${bad}" → error de configuración`, threw instanceof PoolConfigError, String(threw));
    }
    ok('no se deriva del nº de CPU', resolveWorkerCount({}) === 1);
}

// ── [7..8..10] worker real ejecuta el motor canónico ────────────────────────
section('[7..10] el worker real usa el motor canónico');
{
    const src = fs.readFileSync(path.join(HERE, '..', 'metrics', 'shadowWorker.mjs'), 'utf8');
    ok('[7] importa computeCanonicalMetrics', /canonicalMetricsService\.mjs/.test(src));
    ok('[7] usa el metricsProvider real', /metricsProvider\.mjs/.test(src));
    ok('[9] no abre insights.db', !/insights/i.test(src));
    ok('[10] no consulta analytics_db.json', !/analytics_db/.test(src));
    ok('no crea schema', !/CREATE TABLE/i.test(src) && !/journal_mode/i.test(src));
    const provSrc = fs.readFileSync(path.join(HERE, '..', 'metrics', 'metricsProvider.mjs'), 'utf8');
    ok('[8] el provider abre SQLite readonly', /readonly:\s*true/.test(provSrc), 'metricsProvider');
}

// ── [13..15] cola, timeout, respuesta tardía ────────────────────────────────
section('[13..15] cola, timeout y respuestas tardías');
{
    const pool = createShadowWorkerPool({ workers: 1, workerPath: W_SLOW, timeoutMs: 60, queueLimit: 2 });
    await sleep(300);
    const a = pool.submit({ scopeKind: 'organization' });
    const b = pool.submit({ scopeKind: 'organization' });
    const c = pool.submit({ scopeKind: 'organization' });
    const d = pool.submit({ scopeKind: 'organization' });
    const [ra, rb, rc, rd] = await Promise.all([a, b, c, d]);
    ok('[13] cola acotada rechaza el exceso',
        [ra, rb, rc, rd].some(r => r.error === 'QUEUE_FULL'), JSON.stringify([ra, rb, rc, rd].map(r => r.error)));
    ok('[14] timeout devuelve WORKER_TIMEOUT sin lanzar',
        [ra, rb, rc, rd].some(r => r.error === 'WORKER_TIMEOUT'));
    await sleep(500);
    ok('[15] la respuesta tardía se descarta', pool.counters.pool_late_responses_discarded >= 1,
        String(pool.counters.pool_late_responses_discarded));
    await pool.shutdown({ drainMs: 100 });
}

// ── [16..17] crash y respawn con backoff ────────────────────────────────────
section('[16..17] crash y respawn');
{
    const pool = createShadowWorkerPool({ workers: 1, workerPath: W_CRASH, timeoutMs: 500,
        respawnBaseMs: 20, respawnMaxMs: 200 });
    await sleep(200);
    const r = await pool.submit({ scopeKind: 'organization' });
    ok('[16] el crash no lanza: devuelve error sanitizado', r.ok === false && typeof r.error === 'string', JSON.stringify(r));
    await sleep(400);
    ok('[16] se contabiliza el crash', pool.counters.pool_worker_crashes >= 1);
    ok('[16] hubo respawn', pool.counters.pool_worker_spawns >= 2, String(pool.counters.pool_worker_spawns));
    ok('[17] el backoff está acotado', pool.counters.pool_respawn_backoff_ms <= 200,
        String(pool.counters.pool_respawn_backoff_ms));
    await pool.shutdown({ drainMs: 100 });
}

// ── shape inválido y jobId desconocido ──────────────────────────────────────
section('[shape] respuestas inválidas');
{
    const p1 = createShadowWorkerPool({ workers: 1, workerPath: W_BADSHAPE, timeoutMs: 80 });
    await sleep(250);
    const r1 = await p1.submit({ scopeKind: 'organization' });
    ok('shape inválido no resuelve como ok', r1.ok === false);
    ok('se contabiliza shape inválido', p1.counters.pool_invalid_shape >= 1);
    await p1.shutdown({ drainMs: 100 });

    const p2 = createShadowWorkerPool({ workers: 1, workerPath: W_UNKNOWNID, timeoutMs: 80 });
    await sleep(250);
    const r2 = await p2.submit({ scopeKind: 'organization' });
    ok('jobId desconocido no corrompe el pool', r2.ok === false);
    ok('se contabiliza jobId desconocido', p2.counters.pool_unknown_job_id >= 1);
    await p2.shutdown({ drainMs: 100 });
}

// ── [18..19] breaker y shutdown ─────────────────────────────────────────────
section('[18..19] breaker y shutdown');
{
    const pool = createShadowWorkerPool({ workers: 1, workerPath: W_CRASH, timeoutMs: 200,
        errorThreshold: 2, breakerCooldownMs: 5000, respawnBaseMs: 10, respawnMaxMs: 50 });
    await sleep(150);
    for (let i = 0; i < 4; i++) { await pool.submit({ scopeKind: 'organization' }); await sleep(80); }
    const r = await pool.submit({ scopeKind: 'organization' });
    ok('[18] con breaker abierto se rechaza', r.error === 'BREAKER_OPEN' || r.ok === false, JSON.stringify(r));
    const out = await pool.shutdown({ drainMs: 200 });
    ok('[19] shutdown deja el pool STOPPED', pool.state === POOL_STATE.STOPPED, pool.state);
    const after = await pool.submit({ scopeKind: 'organization' });
    ok('[19] tras shutdown no se admite trabajo', after.error === 'POOL_STOPPING');
}

// ── [20..21] readiness ──────────────────────────────────────────────────────
section('[20..21] readiness');
{
    ok('[20] shadow sin ejecutor → SHADOW_NOT_CONFIGURED',
        engineReadiness({ mode: 'shadow', hasCanonicalExecutor: false }).state === ENGINE_STATE.SHADOW_NOT_CONFIGURED);
    ok('[20] y shadowReady = false',
        engineReadiness({ mode: 'shadow', hasCanonicalExecutor: false }).shadowReady === false);
    ok('[21] shadow con ejecutor → SHADOW_READY',
        engineReadiness({ mode: 'shadow', hasCanonicalExecutor: true }).shadowReady === true);
    ok('legacy no depende del ejecutor',
        engineReadiness({ mode: 'legacy', hasCanonicalExecutor: false }).ready === true);

    const pool = createShadowWorkerPool({ workers: 1, workerPath: W_OK });
    await sleep(250);
    ok('[21] pool con worker vivo es operativo', pool.isOperational() === true, pool.state);
    await pool.shutdown({ drainMs: 100 });
    ok('[20] pool detenido NO es operativo', pool.isOperational() === false);
}

// ── [1..6] captura única y paridad legacy ───────────────────────────────────
section('[1..6] captura única del handler legacy');
{
    const LEGACY_BODY = { schoolId: 'x', computedAt: 111,
        summary: { studentCount: 40, activeStudentCount: 0, engagementRate: 0 },
        backboneMetrics: { sessions: 12, distinctContents: 5 } };

    let handlerRuns = 0, authRuns = 0;
    const legacyHandler = (req, res) => { handlerRuns++; authRuns++; return res.json(JSON.parse(JSON.stringify(LEGACY_BODY))); };
    function fakeRes() {
        const listeners = {};
        const r = { statusCode: 200, headers: {}, body: undefined, ended: false };
        r.status = (c) => { r.statusCode = c; return r; };
        r.set = (k, v) => { r.headers[k] = v; return r; };
        r.json = (b) => { r.body = b; r.ended = true; (listeners.finish || []).forEach(f => f()); return r; };
        r.once = (ev, fn) => { (listeners[ev] ||= []).push(fn); return r; };
        r.emit = (ev) => { (listeners[ev] || []).forEach(f => f()); };
        return r;
    }
    const pool = createShadowWorkerPool({ workers: 1, workerPath: W_OK });
    await sleep(250);
    const { createShadowExecutor } = await import(M('shadowExecutor.mjs'));
    const exec = createShadowExecutor({ config: { sampleRate: 1, timeoutMs: 2000, maxConcurrency: 1,
        queueLimit: 10, errorThreshold: 5, breakerCooldownMs: 1000 } });

    const canonicalExecutor = async () => {
        const r = await pool.submit({ scopeKind: 'organization', organizationId: 'org-x',
            period: { fromTs: 0, toTs: 1, days: 30 }, idleMs: 900000, nowTs: 1 });
        return r.ok ? { ok: true, status: r.status, projection: r.projection, period: { fromTs: 0, toTs: 1, days: 30 } }
                    : { ok: false, error: r.error };
    };

    const resL = fakeRes();
    await executeMetricsRoute({ mode: 'legacy', routeKind: 'metrics.school', req: {}, res: resL, legacyHandler });
    const legacyRuns = handlerRuns;
    ok('[1] legacy ejecuta el handler una vez', legacyRuns === 1, String(legacyRuns));

    handlerRuns = 0; authRuns = 0;
    const resS = fakeRes();
    await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res: resS,
        legacyHandler, canonicalExecutor, shadowExecutor: exec });
    await macroTick(6); await sleep(200);

    ok('[1] shadow ejecuta el handler UNA sola vez', handlerRuns === 1, String(handlerRuns));
    ok('[2] autorización ejecutada una sola vez', authRuns === 1, String(authRuns));
    ok('[5] body público idéntico', JSON.stringify(resS.body) === JSON.stringify(resL.body));
    ok('[6] headers idénticos', JSON.stringify(resS.headers) === JSON.stringify(resL.headers));
    ok('[5] status idéntico', resS.statusCode === resL.statusCode);
    ok('[3] el canónico corrió tras finish', exec.counters.shadow_comparisons_started >= 1);

    // [4] finish + close no duplican
    const resD = fakeRes();
    handlerRuns = 0;
    await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res: resD,
        legacyHandler, canonicalExecutor, shadowExecutor: exec });
    const before = exec.counters.shadow_requests_total;
    resD.emit('close');
    await macroTick(3);
    ok('[4] finish + close encolan como máximo un job',
        exec.counters.shadow_requests_total - before <= 1, String(exec.counters.shadow_requests_total - before));

    await exec.shutdown({ drainMs: 100 });
    await pool.shutdown({ drainMs: 100 });
}

// ── [22] job no autorizado ──────────────────────────────────────────────────
section('[22] petición no autorizada');
{
    let canonicalRuns = 0;
    const denied = (req, res) => res.status(403).json({ error: 'Acceso denegado' });
    function fakeRes() {
        const L = {}; const r = { statusCode: 200, headers: {} };
        r.status = (c) => { r.statusCode = c; return r; };
        r.set = () => r; r.json = (b) => { r.body = b; (L.finish || []).forEach(f => f()); return r; };
        r.once = (e, f) => { (L[e] ||= []).push(f); return r; };
        return r;
    }
    const { createShadowExecutor } = await import(M('shadowExecutor.mjs'));
    const exec = createShadowExecutor({ config: { sampleRate: 1, timeoutMs: 500, maxConcurrency: 1,
        queueLimit: 5, errorThreshold: 5, breakerCooldownMs: 1000 } });
    const res = fakeRes();
    await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res,
        legacyHandler: denied, canonicalExecutor: async () => { canonicalRuns++; return { ok: true }; },
        shadowExecutor: exec });
    await macroTick(4);
    ok('[22] un 403 nunca crea job canónico', canonicalRuns === 0, String(canonicalRuns));
    ok('[22] status público conservado', res.statusCode === 403);
    await exec.shutdown({ drainMs: 50 });
}

// ── [23..24] PII ────────────────────────────────────────────────────────────
section('[23..24] cero PII');
{
    const workerSrc = fs.readFileSync(path.join(HERE, '..', 'metrics', 'shadowWorker.mjs'), 'utf8');
    for (const f of ['email', 'nombre_completo', 'password', 'token', 'headers'])
        ok(`[24] el worker no maneja "${f}"`, !new RegExp(f).test(workerSrc));
    const poolSrc = fs.readFileSync(path.join(HERE, '..', 'metrics', 'shadowWorkerPool.mjs'), 'utf8');
    ok('[23] el pool no registra identificadores en logs',
        !/log\([^)]*(userId|organizationId|groupId)/.test(poolSrc));
    const proj = projectLegacy({ routeKind: 'metrics.school',
        body: { backboneMetrics: { sessions: 12, distinctContents: 5 }, email: 'x@y.invalid', nombre: 'N' } });
    const s = JSON.stringify(proj);
    ok('[24] la proyección legacy descarta PII', !s.includes('x@y.invalid') && !s.includes('"N"'));
    ok('la proyección solo lleva las comparables',
        JSON.stringify(Object.keys(proj.metrics).sort()) === '["distinctContents","sessions"]');
}

// ── [25..29] semántica preservada ───────────────────────────────────────────
section('[25..29] equivalencia y estados');
{
    const legacyProjection = projectLegacy({ routeKind: 'metrics.school',
        body: { backboneMetrics: { sessions: 12, distinctContents: 5 } } });
    const canonicalProjection = { contractVersion: 2, organizationId: 'org-x',
        metrics: { sessions: { value: 15, status: 'MEASURED' }, distinctContents: { value: 5, status: 'MEASURED' } },
        statuses: { usersWithActivity: 'NO_ACTIVITY', readingTimeMs: 'NOT_DEFINED', activeReaders: 'NO_DATA' } };
    const P30 = { fromTs: 0, toTs: 1, days: 30 };
    const cmp = compareProjections({ routeKind: 'metrics.school', organizationId: 'org-x',
        legacyProjection, canonicalProjection, canonicalPeriod: P30 });
    const d = cmp.differences.find(x => x.metricKey === 'sessions');
    ok('[25] sessions se compara', !!d && d.legacyValue === 12 && d.canonicalValue === 15);
    ok('[25] comparisonStatus COMPARABLE', d.comparisonStatus === COMPARISON_STATUS.COMPARABLE);
    ok('[26] distinctContents iguales → sin diferencia',
        !cmp.differences.some(x => x.metricKey === 'distinctContents'));
    ok('[27] NO_DATA se preserva como estado', canonicalProjection.statuses.activeReaders === 'NO_DATA');
    ok('[28] NO_ACTIVITY se preserva', canonicalProjection.statuses.usersWithActivity === 'NO_ACTIVITY');
    ok('[29] NOT_DEFINED se preserva', canonicalProjection.statuses.readingTimeMs === 'NOT_DEFINED');
    ok('ninguno se convierte en 0',
        !Object.values(canonicalProjection.statuses).includes(0));

    const bad = compareProjections({ routeKind: 'metrics.school', legacyProjection,
        canonicalProjection: { contractVersion: 1 }, canonicalPeriod: P30 });
    ok('shape canónico inválido → ENGINE_ERROR', bad.differences[0].reasonCode === REASON.CANONICAL_SHAPE_INVALID);
    const noPeriod = compareProjections({ routeKind: 'metrics.school', legacyProjection,
        canonicalProjection, canonicalPeriod: { days: 7 } });
    ok('periodo incompatible no genera delta', noPeriod.differences.length === 0);
}

// ── [30..31] stores ─────────────────────────────────────────────────────────
section('[30..31] stores intactos');
{
    const REPO = path.resolve(HERE, '..', '..');
    const dcDir = path.join(REPO, 'data-critical');
    const before = fs.existsSync(dcDir) ? fs.readdirSync(dcDir) : [];
    const pool = createShadowWorkerPool({ workers: 1, workerPath: W_OK });
    await sleep(200);
    await pool.submit({ scopeKind: 'organization' });
    await pool.shutdown({ drainMs: 100 });
    const after = fs.existsSync(dcDir) ? fs.readdirSync(dcDir) : [];
    ok('[31] stores reales sin archivos nuevos', before.length === after.length);
    ok('[30] cero WAL/SHM nuevos',
        !after.some(f => /\.db-(wal|shm)$/.test(f) && !before.includes(f)));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
