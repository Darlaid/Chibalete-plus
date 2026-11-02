/**
 * mookReconcileHttpBench.mjs — CHP-GAMIFICACION-G4-PERF-01B. Banco de medición, no es una prueba.
 *
 * `server.js` real, sin arnés (`mook_review` sigue bloqueada como en producción),
 * con un store MOOK sintético de N evidencias en disco. Una sonda en este proceso
 * consulta `/api/health` cada 5 ms mientras corre el barrido programado; el
 * barrido termina cuando el servidor registra los hechos recuperados.
 *
 *   CHP_BENCH_N=20000 [CHP_BENCH_ROOT=<raíz con server/>] node server/gamification/__test__/mookReconcileHttpBench.mjs
 *
 * Solo datos sintéticos y directorios temporales.
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSweepDoc } from './helpers/mookSweepFixture.mjs';
import { freePort } from '../../__test__/helpers/freePort.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.CHP_BENCH_ROOT || path.resolve(HERE, '..', '..', '..'));
const N = Number(process.env.CHP_BENCH_N || 2000);
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_httpbench_'));
const data = path.join(dir, 'data'); const sqlite = path.join(dir, 'sqlite');
for (const d of [data, sqlite, path.join(dir, 'uploads'), path.join(dir, 'reg'), path.join(dir, 'gam'), path.join(dir, 'roy')]) fs.mkdirSync(d, { recursive: true });
const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
const gamDb = path.join(dir, 'gam', 'gamification.db');
const roy = path.join(dir, 'roy', 'royalties.db');
process.env.GAMIFICATION_DB = gamDb; process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg; process.env.ROYALTIES_DB = roy;

const Store = await mod('server/lib/experienceStore.js');
const D = await mod('server/gamification/db.mjs');
const L = await mod('server/gamification/ledger.mjs');
const Pub = await mod('server/royalties/publishersStore.mjs');
(await mod('server/gamification/subjectKey.mjs')).installSubjectKey(process.env.CHP_TEST_SUBJECT_KEY);

const SINCE = Date.now() - 6 * 3_600_000;
const { doc, users } = buildSweepDoc(Store, { n: N, experiences: 20, users: 200, reviewers: 10, sinceMs: SINCE });
fs.writeFileSync(path.join(data, 'mook_db.json'), JSON.stringify(doc));
const mookBytes = fs.statSync(path.join(data, 'mook_db.json')).size;
fs.writeFileSync(path.join(data, 'content.json'), JSON.stringify(Array.from({ length: 20 }, (_, k) => ({ id: `obra-${k}`, titulo: `Obra ${k}`, tipo: 'libro', status: 'disponible' }))));
fs.writeFileSync(path.join(data, 'access_db.json'), '[]');
for (const f of ['progress_db.json', 'groups_db.json', 'schools_db.json', 'school_configs.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(data, f), '[]');
fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(users.map((u) => ({ ...u, email: `${u.id}@t.test`, nombre_completo: u.id, roles: [u.id.startsWith('m-') ? 'mediador' : 'lector'], password: 'x' }))));
Pub.getRoyaltiesDb(); Pub.closeRoyaltiesDb();
const db = D.getGamificationDb({ env: { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: gamDb, GAMIFICATION_EXCLUSION_REGISTRY: reg } });
L.createRuleSet(db, { ruleVersion: 'gm-http-v1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
    rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: { 'mook_experience/experience_completed': { xp: 5 } } } });
D.closeGamificationDb({ resetBackoff: true });

const port = await freePort();
const db_ = (n) => path.join(sqlite, n);
const DELAY = 4000;
// La clave de prueba se instala en el subjectKey.mjs de la raíz medida, no en el de este árbol.
const keyHelper = pathToFileURL(path.join(ROOT, 'server', '__test__', 'helpers', 'testSubjectKey.mjs')).href;
const nodeOptions = (process.env.NODE_OPTIONS ?? '').split(' ').filter((x, i, a) => !x.includes('testSubjectKey') && !(x === '--import' && (a[i + 1] ?? '').includes('testSubjectKey'))).join(' ');
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, NODE_OPTIONS: `${nodeOptions} --import ${keyHelper}`.trim(), NODE_ENV: 'test', SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: 'restricted', PORT: String(port), USERS_DB: path.join(dir, 'users.json'), CHP_DATA_DIR: data,
        UPLOADS_ROOT: path.join(dir, 'uploads'), ACCESS_DB: path.join(data, 'access_db.json'), GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '',
        GAMIFICATION_DB: gamDb, GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString(), GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: String(DELAY),
        EXPERIENCE_EVENTS_BACKBONE_ENABLED: '', EVENTS_SQLITE_PATH: db_('events.db'), ARCHIVE_SQLITE_PATH: db_('events.archive.db'), INSIGHTS_SQLITE_PATH: db_('insights.db'),
        PROGRESS_SQLITE_PATH: db_('progress.db'), OFFLINE_ASSIGNMENT_DB_PATH: db_('offline.db'), ROYALTIES_DB: roy, IDENTITY_DB: db_('identity.db'), SESSIONS_DB: db_('sessions.db'),
        GROUPS_DB: path.join(data, 'groups_db.json'), SCHOOLS_DB: path.join(data, 'schools_db.json'), LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; let doneAt = null; let abortedAt = null;
const onLog = (d) => { logs += d; if (doneAt === null && /reconciliación MOOK: \d+ hechos recuperados/.test(logs)) doneAt = Date.now(); if (abortedAt === null && /reconciliación MOOK abortada/.test(logs)) abortedAt = Date.now(); };
child.stdout.on('data', onLog); child.stderr.on('data', onLog);
const URL_ = `http://127.0.0.1:${port}/api/health`;
let readyAt = null;
for (let i = 0; i < 240; i++) {
    try { if ((await fetch(URL_)).ok) { readyAt = Date.now(); break; } } catch { /* arrancando */ }
    await sleep(250);
}
if (!readyAt) { console.error(logs.slice(-2000)); child.kill('SIGKILL'); process.exit(2); }

const samples = [];
const deadline = Date.now() + 15 * 60_000;
while (doneAt === null && abortedAt === null && Date.now() < deadline) {
    const s = Date.now(); const p0 = performance.now();
    try { const r = await fetch(URL_, { signal: AbortSignal.timeout(30_000) }); await r.text(); samples.push([s, performance.now() - p0, r.status]); } catch (e) { samples.push([s, performance.now() - p0, e?.cause?.code || e?.name || 'ERR']); }
    await sleep(5);
}
for (let i = 0; i < 100; i++) { const s = Date.now(); const p0 = performance.now(); try { await (await fetch(URL_)).text(); samples.push([s, performance.now() - p0, 200]); } catch { /* noop */ } await sleep(5); }
child.kill('SIGTERM');
await new Promise((r) => child.on('close', r));

// Ventana del barrido: desde poco antes del arranque programado hasta el registro de su fin.
const lat = samples.filter(([s]) => s >= readyAt + DELAY - 500 && s <= (doneAt ?? abortedAt ?? Infinity));
const slow = lat.filter(([, l]) => l > 100);
const ok200 = (x) => x[2] === 200;
const report = {
    n: N, root: path.basename(ROOT), mookBytes, node: process.version, platform: `${os.platform()} ${os.release()}`,
    sweepEndedMsAfterReady: doneAt ? doneAt - readyAt : null, aborted: abortedAt !== null,
    health: { requests: lat.length, ok: lat.filter(ok200).length, failed: lat.filter((x) => !ok200(x)).map((x) => x[2]),
        p50: pct(lat.map((x) => x[1]), 0.5), p95: pct(lat.map((x) => x[1]), 0.95), p99: pct(lat.map((x) => x[1]), 0.99), max: pct(lat.map((x) => x[1]), 1), over100ms: slow.length },
    logs: logs.split('\n').filter((l) => /gamification/.test(l)).slice(-5),
};
console.log(JSON.stringify(report));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
