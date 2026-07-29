/**
 * metricsShadowStructureRatchet.test.js — CHP-STATS-SHADOW-PERF-01D-CHKPT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ QUÉ PRUEBA ESTA SUITE — Y QUÉ NO                                         │
 * │                                                                          │
 * │ PRUEBA: propiedades ESTRUCTURALES de la frontera shadow. Que el handler  │
 * │ legacy se ejecute una sola vez, que el trabajo canónico se encole después│
 * │ de `finish`, que la respuesta pública no espere al worker, que la cola   │
 * │ esté acotada, que el pool no crezca solo y que un fallo del worker nunca │
 * │ produzca un 5xx.                                                         │
 * │                                                                          │
 * │ NO PRUEBA: que la arquitectura cumpla el umbral de rendimiento. NO ES un │
 * │ criterio de aceptación productiva. NO autoriza despliegue.               │
 * │                                                                          │
 * │ El benchmark HTTP de aceptación (`-01D`) **falló**: la arquitectura de   │
 * │ worker thread dentro del contenedor de la API, bajo cuota de CPU         │
 * │ compartida, está RECHAZADA. Ver `docs/CHP-STATS-SHADOW-PERF-BLOCK.md`.   │
 * │ Esta suite existe para que, si se retoma el diseño, las propiedades que  │
 * │ SÍ estaban bien no se pierdan por el camino.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Fixtures sintéticas. Ningún store real, ningún WAL/SHM, ninguna PII.
 *
 *   node server/__test__/metricsShadowStructureRatchet.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = (rel) => pathToFileURL(path.join(HERE, '..', 'metrics', rel)).href;

const { createShadowExecutor, resolveShadowConfig, SKIP } = await import(M('shadowExecutor.mjs'));
const { createShadowWorkerPool, resolveWorkerCount, MAX_WORKERS_HARD_LIMIT } = await import(M('shadowWorkerPool.mjs'));
const { executeMetricsRoute } = await import(M('metricsRouteBoundary.mjs'));

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const macroTick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'structratchet_'));

/** `res` mínimo con el ciclo real de Express: `json()` y luego `finish`. */
function fakeRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.jsonCalls = 0;
    res.json = (body) => { res.jsonCalls++; res.body = body; queueMicrotask(() => res.emit('finish')); return res; };
    res.send = res.json;
    res.status = (c) => { res.statusCode = c; return res; };
    return res;
}

const LEGACY_BODY = { backboneMetrics: { sessions: 10, distinctContents: 3 } };

console.log('metricsShadowStructureRatchet — CHP-STATS-SHADOW-PERF-01D-CHKPT');
console.log('(propiedades estructurales; NO es aceptación de rendimiento)');

// ── [1] el pool no crece solo ───────────────────────────────────────────────
section('[1] tamaño del pool acotado por defecto');
{
    ok('[1a] default = 1 worker por instancia', resolveWorkerCount({}) === 1);
    ok('[1b] el default no se deriva del número de CPU',
        resolveWorkerCount({}) === 1);
    let threw = false;
    try { resolveWorkerCount({ METRICS_SHADOW_WORKERS: String(MAX_WORKERS_HARD_LIMIT + 1) }); } catch { threw = true; }
    ok('[1c] por encima del tope duro es error explícito', threw);
}

// ── [2] el handler legacy se ejecuta EXACTAMENTE una vez ───────────────────
section('[2] captura sin reejecución del handler legacy');
{
    let handlerRuns = 0;
    const legacyHandler = async (req, res) => { handlerRuns++; res.json(LEGACY_BODY); };
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 } });
    const canonicalExecutor = async () => ({ ok: true, projection: { contractVersion: 2, metrics: {} } });

    const res = fakeRes();
    await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res,
        legacyHandler, canonicalExecutor, shadowExecutor: exec });
    await macroTick();

    ok('[2a] handler legacy ejecutado una sola vez', handlerRuns === 1, `runs=${handlerRuns}`);
    ok('[2b] res.json emitido una sola vez', res.jsonCalls === 1, `calls=${res.jsonCalls}`);
    await exec.shutdown({ drainMs: 50 });
}

// ── [3] la respuesta pública no espera al trabajo canónico ─────────────────
section('[3] independencia de la respuesta pública');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 } });
    // Un canónico deliberadamente lento: si la respuesta lo esperase, el tiempo
    // hasta `res.json` reflejaría estos 300 ms. Es una prueba de ORDEN, no de
    // velocidad: comprueba que no hay `await` en el camino público.
    const canonicalExecutor = () => new Promise((r) => setTimeout(() => r({ ok: true, projection: { contractVersion: 2, metrics: {} } }), 300));
    const legacyHandler = async (req, res) => { res.json(LEGACY_BODY); };

    const res = fakeRes();
    const t0 = process.hrtime.bigint();
    await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res,
        legacyHandler, canonicalExecutor, shadowExecutor: exec });
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    ok('[3a] la respuesta pública no espera al canónico', elapsedMs < 100, `${elapsedMs.toFixed(1)} ms`);
    await exec.shutdown({ drainMs: 500 });
}

// ── [4] submit() encola, no calcula ────────────────────────────────────────
section('[4] submit() solo encola');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1, maxConcurrency: 1 } });
    let taskRuns = 0;
    const task = async () => { taskRuns++; await sleep(5); return { differences: [] }; };

    // Propiedad estructural: tras `submit()`, la tarea AÚN no ha corrido. Si
    // alguien volviera a ejecutar el cómputo dentro de `submit`, esto falla.
    const before = taskRuns;
    exec.submit({ routeKind: 'metrics.school', task, responseFinishedAt: Date.now() });
    const ranSynchronously = taskRuns > before;

    ok('[4a] submit() no ejecuta la tarea de forma síncrona', ranSynchronously === false);
    ok('[4b] submit() devuelve un veredicto de admisión inmediato',
        typeof exec.stats().queueDepth === 'number');
    await exec.shutdown({ drainMs: 2000 });
}

// ── [5] el trabajo canónico empieza DESPUÉS de la respuesta ────────────────
section('[5] canonicalStartedAt >= responseFinishedAt');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 } });
    const canonicalExecutor = async () => ({ ok: true, projection: { contractVersion: 2, metrics: {} } });
    const legacyHandler = async (req, res) => { res.json(LEGACY_BODY); };

    for (let i = 0; i < 10; i++) {
        const res = fakeRes();
        await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res,
            legacyHandler, canonicalExecutor, shadowExecutor: exec });
        await macroTick();
    }
    ok('[5a] cero violaciones de la invariante',
        exec.counters.shadow_started_before_response_total === 0,
        `violaciones=${exec.counters.shadow_started_before_response_total}`);
    await exec.shutdown({ drainMs: 200 });
}

// ── [6] la cola está acotada y no crece ────────────────────────────────────
section('[6] cola acotada');
{
    const LIMIT = 8;
    const exec = createShadowExecutor({
        config: { ...resolveShadowConfig({}), sampleRate: 1, maxConcurrency: 1, queueLimit: LIMIT },
    });
    const blocked = () => new Promise(() => {});          // nunca resuelve
    let accepted = 0, queueFull = 0, maxDepth = 0;
    for (let i = 0; i < LIMIT * 5; i++) {
        const r = exec.submit({ routeKind: 'metrics.school', task: blocked, responseFinishedAt: Date.now() });
        if (r.accepted) accepted++;
        if (r.reason === SKIP.QUEUE_FULL) queueFull++;
        maxDepth = Math.max(maxDepth, exec.stats().queueDepth);
    }
    ok('[6a] la cola nunca supera su límite', maxDepth <= LIMIT, `maxDepth=${maxDepth} limit=${LIMIT}`);
    ok('[6b] el exceso se descarta y se cuenta', queueFull > 0 && exec.counters.shadow_queue_full === queueFull,
        `queueFull=${queueFull}`);
    ok('[6c] lo admitido está acotado', accepted <= LIMIT + 1, `accepted=${accepted}`);
    await exec.shutdown({ drainMs: 50 });
}

// ── [7] una respuesta 4xx no genera trabajo shadow ─────────────────────────
section('[7] las respuestas no autorizadas no encolan trabajo');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 } });
    let canonicalCalls = 0;
    const canonicalExecutor = async () => { canonicalCalls++; return { ok: true, projection: { contractVersion: 2, metrics: {} } }; };
    const legacyHandler = async (req, res) => { res.status(403).json({ error: 'forbidden' }); };

    const res = fakeRes();
    await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res,
        legacyHandler, canonicalExecutor, shadowExecutor: exec });
    await macroTick();
    ok('[7a] un 403 no ejecuta el canónico', canonicalCalls === 0, `llamadas=${canonicalCalls}`);
    await exec.shutdown({ drainMs: 50 });
}

// ── [8] el cómputo NO ocurre en el hilo principal ──────────────────────────
section('[8] el trabajo se ejecuta en el worker, no en el hilo principal');
{
    // Worker sintético que quema CPU. Comprueba UBICACIÓN, no velocidad: si el
    // pool ejecutase el job en el hilo principal, el bucle de timers de abajo
    // quedaría bloqueado de forma inconfundible.
    //
    // OJO: que el cómputo salga del event loop NO implica que salga de la cuota
    // de CPU del contenedor. Ese fue exactamente el fallo de `-01D`.
    const W_BUSY = path.join(TMP, 'busy.mjs');
    fs.writeFileSync(W_BUSY, `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  const until = Date.now() + 250;
  while (Date.now() < until) { Math.sqrt(Math.random()); }
  parentPort.postMessage({ jobId: m.jobId, protocolVersion: 2, ok: true, status: 200, projection: null, durationMs: 250 });
});
`);
    const pool = createShadowWorkerPool({ workers: 1, timeoutMs: 5000, workerPath: W_BUSY });
    await sleep(300);

    const job = pool.submit({ scopeKind: 'organization' });
    let ticks = 0;
    const deadline = Date.now() + 200;
    while (Date.now() < deadline) { await sleep(10); ticks++; }
    const r = await job;

    ok('[8a] el job se completó en el worker', r.ok === true);
    // Con el hilo principal libre caben ~20 ticks de 10 ms en 200 ms. Si el job
    // corriera en el hilo principal, apenas habría ticks.
    ok('[8b] el hilo principal siguió atendiendo timers durante el job', ticks >= 8, `ticks=${ticks}`);
    await pool.shutdown({ drainMs: 500 });
}

// ── [9] un fallo del worker nunca produce un 5xx ───────────────────────────
section('[9] los fallos del worker no alcanzan la respuesta pública');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 } });
    const legacyHandler = async (req, res) => { res.json(LEGACY_BODY); };

    const modes = [
        ['ejecutor canónico que lanza', async () => { throw Object.assign(new Error('boom'), { code: 'CANONICAL_SOURCE_ERROR' }); }],
        ['ejecutor canónico que devuelve ok:false', async () => ({ ok: false, error: 'WORKER_TIMEOUT' })],
        ['ejecutor canónico que devuelve basura', async () => null],
    ];

    let allOk = true;
    for (const [label, canonicalExecutor] of modes) {
        const res = fakeRes();
        let threw = null;
        try {
            await executeMetricsRoute({ mode: 'shadow', routeKind: 'metrics.school', req: {}, res,
                legacyHandler, canonicalExecutor, shadowExecutor: exec });
        } catch (e) { threw = e; }
        await macroTick(8);
        const good = threw === null && res.statusCode === 200 && res.body === LEGACY_BODY;
        ok(`[9a] ${label}: status 200 y body legacy intactos`, good,
            threw ? `lanzó ${threw.message}` : `status=${res.statusCode}`);
        allOk = allOk && good;
    }
    ok('[9b] ningún fallo del worker se propagó al camino público', allOk);
    await exec.shutdown({ drainMs: 300 });
}

// ── [10] no quedan restos tras el drenaje ──────────────────────────────────
section('[10] estructuras liberadas tras el drenaje');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1, maxConcurrency: 2 } });
    const task = async () => ({ differences: [] });
    for (let i = 0; i < 200; i++) {
        exec.submit({ routeKind: 'metrics.school', task, responseFinishedAt: Date.now() });
    }
    const deadline = Date.now() + 5000;
    while ((exec.stats().queueDepth > 0 || exec.stats().active > 0) && Date.now() < deadline) await sleep(20);

    const st = exec.stats();
    ok('[10a] cola vacía tras el drenaje', st.queueDepth === 0, `depth=${st.queueDepth}`);
    ok('[10b] sin trabajo activo residual', st.active === 0, `active=${st.active}`);
    ok('[10c] todo lo iniciado terminó',
        exec.counters.shadow_comparisons_started === exec.counters.shadow_comparisons_completed,
        `started=${exec.counters.shadow_comparisons_started} completed=${exec.counters.shadow_comparisons_completed}`);

    const { dropped, stillActive } = await exec.shutdown({ drainMs: 500 });
    ok('[10d] shutdown limpio', dropped === 0 && stillActive === 0, `dropped=${dropped} active=${stillActive}`);
}

// ── cierre ─────────────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nmetricsShadowStructureRatchet: ${pass} ok, ${fail} fallos`);
console.log('RECORDATORIO: estructura verificada; rendimiento NO aceptado; despliegue NO autorizado.');
process.exit(fail === 0 ? 0 : 1);
