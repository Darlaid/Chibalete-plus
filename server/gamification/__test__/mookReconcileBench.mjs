/**
 * mookReconcileBench.mjs — CHP-GAMIFICACION-G4-PERF-01B. Banco de medición, no es una prueba.
 *
 * Mide un barrido MOOK sobre datos sintéticos: duración, pausas del event loop
 * (temporizador de 1 ms y monitorEventLoopDelay) y latencia HTTP vista desde OTRO
 * proceso que consulta sin parar un `/api/health` servido en este proceso. Barre
 * dos veces: la primera escribe, la segunda reevalúa todo lo ya registrado.
 *
 *   CHP_BENCH_N=20000 CHP_BENCH_MODE=batched|sync [CHP_BENCH_ROOT=<raíz con server/>] \
 *     node server/gamification/__test__/mookReconcileBench.mjs
 *
 * `CHP_BENCH_ROOT` permite medir otra versión del motor (p. ej. 01A) con el mismo
 * documento. Libera `mook_review` solo en este proceso. Bases temporales; nunca
 * toca data/ ni data-critical/.
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { buildSweepDoc, freshLedger, isSyntheticUser, isUserActive, ledgerDigest } from './helpers/mookSweepFixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.CHP_BENCH_ROOT || path.resolve(HERE, '..', '..', '..'));
const N = Number(process.env.CHP_BENCH_N || 2000);
const MODE = process.env.CHP_BENCH_MODE || 'batched';
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const Store = await mod('server/lib/experienceStore.js');
const D = await mod('server/gamification/db.mjs');
const L = await mod('server/gamification/ledger.mjs');
const M = await mod('server/gamification/mookSource.mjs');
const S = await mod('server/gamification/subjects.mjs');
(await mod('server/gamification/subjectKey.mjs')).installSubjectKey(process.env.CHP_TEST_SUBJECT_KEY);
if (MODE === 'batched' && typeof M.runMookReconcileBatched !== 'function') throw new Error('esta raíz no tiene barrido por lotes');

const SINCE = Date.now() - 6 * 3_600_000;
const t0 = performance.now();
const { doc, users } = buildSweepDoc(Store, { n: N, experiences: 20, users: 200, reviewers: 10, sinceMs: SINCE });
const fixtureMs = performance.now() - t0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_bench_'));
const env = freshLedger(D, L, tmp, SINCE);
const deps = { readMook: () => doc, readUsers: () => users, isUserActive, isSyntheticUser, workRefOf: Store.productionWorkRef, readRights: () => () => false, env };

// `/api/health` en este proceso: responde solo cuando el event loop está libre.
const server = http.createServer((req, res) => {
    if (req.url === '/api/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', t: Date.now() })); return; }
    res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const PROBE = `
const url = process.argv[1]; const out = []; let stop = false;
process.stdin.on('data', () => { stop = true; });
(async () => { while (!stop) { const s = Date.now(); const p0 = performance.now();
  try { await (await fetch(url)).text(); out.push([s, performance.now() - p0]); } catch { out.push([s, -1]); }
  await new Promise((r) => setTimeout(r, 5)); }
  process.stdout.write(JSON.stringify(out), () => process.exit(0)); })();`;
const probe = spawn(process.execPath, ['-e', PROBE, `http://127.0.0.1:${port}/api/health`], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, NODE_OPTIONS: '' } });
let probeOut = ''; probe.stdout.on('data', (d) => { probeOut += d; });
const probeDone = new Promise((r) => probe.on('close', r));

let gaps = [];
let last = performance.now();
const ticker = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 1);
const hist = monitorEventLoopDelay({ resolution: 1 });
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500); // la sonda ya consulta en régimen

async function measure(label) {
    gaps = []; last = performance.now(); hist.reset(); hist.enable();
    const w0 = Date.now(); const p0 = performance.now();
    const r = MODE === 'batched' ? await M.runMookReconcileBatched(deps) : await new Promise((resolve) => setImmediate(() => resolve(M.runMookReconcileOnce(deps))));
    const durationMs = performance.now() - p0; const w1 = Date.now();
    await sleep(50); // una consulta encolada durante el barrido termina aquí
    hist.disable();
    return { label, w0, w1, durationMs: +durationMs.toFixed(0), loopGapP95: pct(gaps, 0.95), loopGapMax: pct(gaps, 1), elDelayP95: +(hist.percentile(95) / 1e6).toFixed(1),
        elDelayMax: +(hist.max / 1e6).toFixed(1), result: r };
}

const first = await measure('primer barrido (escribe)');
const second = await measure('barrido repetido');
clearInterval(ticker);
probe.stdin.write('stop');
await probeDone;
server.close();
const samples = JSON.parse(probeOut || '[]');
const inWindow = (m) => samples.filter(([s, l]) => s >= m.w0 - 2 && s <= m.w1 && l >= 0).map(([, l]) => l);
for (const m of [first, second]) {
    const lat = inWindow(m);
    m.health = { requests: lat.length, p95: pct(lat, 0.95), max: pct(lat, 1), failed: samples.filter(([s, l]) => s >= m.w0 && s <= m.w1 && l < 0).length };
    delete m.w0; delete m.w1;
}
const ro = new Database(env.GAMIFICATION_DB, { readonly: true });
const digest = ledgerDigest(L, S, ro, users);
ro.close();
const strip = ({ slices, ...r }) => ({ ...r, slices });
const report = { n: N, mode: MODE, root: path.basename(ROOT), node: process.version, platform: `${os.platform()} ${os.release()}`, fixtureMs: +fixtureMs.toFixed(0),
    first: { ...first, result: strip(first.result) }, second: { ...second, result: strip(second.result) }, ledger: digest };
console.log(JSON.stringify(report));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
