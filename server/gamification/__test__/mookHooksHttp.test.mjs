/**
 * mookHooksHttp.test.mjs — CHP-GAMIFICACION-G3-03.
 *
 * server.js REAL por HTTP, con stores temporales, en tres modos:
 *   OFF     sin flags (producción hoy);
 *   BROKEN  GAMIFICATION_ENABLED=1 con gamification.db corrupta;
 *   ON      GAMIFICATION_ENABLED=1 con base sana, reglas y corte de activación.
 * El mismo flujo MOOK (iniciar ruta → entregar producción que completa la
 * experiencia → revisión `aprobado` por un administrador) debe dar respuestas
 * y escrituras MOOK equivalentes en los tres; en ON, además, exactamente un
 * hecho de revisión y uno de experiencia. Ningún otro store cambia.
 * Nunca toca data/ ni data-critical/: cada store con ruta configurable se
 * redirige a un temporal y una huella de los stores reales lo verifica. Los que
 * tienen ruta fija (memoria de Leo, LU) quedan cubiertos solo por la huella.
 *
 *   node server/gamification/__test__/mookHooksHttp.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'gamification.db');
const realBefore = fs.existsSync(REAL_DB);

/** Huella de los stores reales: contenido en data*, tamaño y fecha en uploads (1 GB). */
function realStoresFingerprint() {
    const out = {};
    const walk = (dir, hash) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p, hash);
            else if (e.isFile()) {
                const st = fs.statSync(p);
                out[path.relative(REPO, p)] = `${st.size}:${st.mtimeMs}:${hash ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : '-'}`;
            }
        }
    };
    walk(path.join(REPO, 'data'), true);
    walk(path.join(REPO, 'data-critical'), true);
    walk(path.join(REPO, 'public', 'uploads'), false);
    return out;
}
const fingerprintDiff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
const realFingerprintBefore = realStoresFingerprint();
/** Rutas SQLite que el servidor anunció en su log y caen dentro del repo. */
const sqlitePathsInRepo = (logs) => [...logs.matchAll(/SQLite path: (.+)/g)].map((m) => m[1].trim())
    .filter((p) => path.resolve(p).toLowerCase().startsWith(REPO.toLowerCase() + path.sep));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_http_'));
const SINCE_ISO = new Date(Date.now() - 60_000).toISOString();

const EXP_ID = 'exp-gam-http';
const VER_ID = 'expv-gam-http';
const MOOK_FIXTURE = {
    experiences: [{ id: EXP_ID, slug: 'gam-http', title: 'Gam HTTP', description: 'd', status: 'published', currentVersionId: VER_ID,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    versions: [{ id: VER_ID, experienceId: EXP_ID, status: 'published', publishedAt: '2026-01-02T00:00:00.000Z', objectives: ['o'],
        modules: [{ id: 'm1', title: 'M1', nodes: [{ id: 'n1', type: 'PRODUCTION', title: 'Producir', required: true, resourceRef: null,
            config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 40 } }] }] }],
    runs: [], evidence: [],
};
const USERS = [
    { id: 'u-admin', email: 'a@t.test', nombre_completo: 'Admin', roles: ['administrador'], accountStatus: 'active', password: 'x' },
    { id: 'u-lector', email: 'l@t.test', nombre_completo: 'Lector', roles: ['lector'], accountStatus: 'active', password: 'x' },
];

function makeEnvDir(name) {
    const dir = path.join(tmp, name);
    const data = path.join(dir, 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(path.join(dir, 'uploads'));
    fs.writeFileSync(path.join(data, 'mook_db.json'), JSON.stringify(MOOK_FIXTURE, null, 2));
    fs.writeFileSync(path.join(data, 'content.json'), '[]');
    fs.writeFileSync(path.join(data, 'progress_db.json'), '[]');
    fs.writeFileSync(path.join(data, 'groups_db.json'), '[]');
    fs.writeFileSync(path.join(data, 'schools_db.json'), '[]');
    fs.writeFileSync(path.join(data, 'leo_evidence_db.json'), '[]');
    fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(USERS));
    return { dir, data };
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function snapshot(dir, skip) {
    const out = {};
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (!skip(p)) out[path.relative(dir, p)] = sha(p); } };
    walk(dir);
    return out;
}

async function runMode(name, port, extraEnv, prepare) {
    const { dir, data } = makeEnvDir(name);
    const sqlite = path.join(tmp, `${name}_sqlite`); // fuera de `dir`: el WAL no cuenta como cambio de store
    fs.mkdirSync(sqlite);
    prepare?.(dir);
    const child = spawn(process.execPath, [path.join(REPO, 'server', 'server.js')], {
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), USERS_DB: path.join(dir, 'users.json'), CHP_DATA_DIR: data,
            UPLOADS_ROOT: path.join(dir, 'uploads'), GAMIFICATION_ENABLED: '', PM_EARNING_ENABLED: '', GAMIFICATION_DB: path.join(dir, 'gam', 'gamification.db'),
            GAMIFICATION_MOOK_SINCE: '', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
            EVENTS_SQLITE_PATH: path.join(sqlite, 'events.db'), ARCHIVE_SQLITE_PATH: path.join(sqlite, 'events.archive.db'),
            INSIGHTS_SQLITE_PATH: path.join(sqlite, 'insights.db'), PROGRESS_SQLITE_PATH: path.join(sqlite, 'progress.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(sqlite, 'offline_assignments.db'), ROYALTIES_DB: path.join(sqlite, 'royalties.db'),
            IDENTITY_DB: path.join(sqlite, 'identity.db'), SESSIONS_DB: path.join(sqlite, 'sessions.db'),
            GROUPS_DB: path.join(data, 'groups_db.json'), SCHOOLS_DB: path.join(data, 'schools_db.json'),
            LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json'), ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    const BASE = `http://127.0.0.1:${port}`;
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
            if (i > 120) throw new Error(`no arrancó ${name}:\n${logs.slice(-1500)}`);
            await sleep(500);
        }
        const before = snapshot(dir, (p) => /mook_db\.json$|[\\/]gam[\\/]|\.lock$/.test(p));
        const call = async (method, url, user, body) => {
            const t = performance.now();
            const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user-id': user }, body: body ? JSON.stringify(body) : undefined });
            return { status: r.status, body: await r.json().catch(() => null), ms: performance.now() - t };
        };
        const start = await call('POST', `/api/experiences/${EXP_ID}/run`, 'u-lector');
        const runId = start.body?.run?.id ?? JSON.parse(fs.readFileSync(path.join(data, 'mook_db.json'), 'utf8')).runs[0]?.id;
        const submit = await call('POST', `/api/experiences/runs/${runId}/nodes/n1/evidence`, 'u-lector', { text: 'uno dos tres cuatro cinco seis siete' });
        const review = await call('POST', `/api/experiences/review/${submit.body?.evidenceId}`, 'u-admin', { decision: 'aprobado', feedback: 'bien' });
        await sleep(800); // margen para los ganchos post-respuesta
        const after = snapshot(dir, (p) => /mook_db\.json$|[\\/]gam[\\/]|\.lock$/.test(p));
        const mook = JSON.parse(fs.readFileSync(path.join(data, 'mook_db.json'), 'utf8'));
        return { name, dir, logs, start, submit, review, otherStoresUnchanged: JSON.stringify(before) === JSON.stringify(after), mook };
    } finally {
        child.kill();
        await new Promise((r) => child.on('close', r));
    }
}

// Normaliza ids y tiempos para comparar modos.
const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => {
    if (/(^id$|Id$|At$|^at$)/.test(k) && typeof x === 'string') return `<${k}>`;
    if (/Ids$/.test(k) && Array.isArray(x)) return x.map(() => `<${k}>`); // arrays de ids aleatorios (evidenceIds)
    return x;
}));
const shape = (r) => ({ start: [r.start.status, norm(r.start.body)], submit: [r.submit.status, norm(r.submit.body)], review: [r.review.status, norm(r.review.body)] });

try {
    section('[1] los tres modos');
    const off = await runMode('off', 3991, {});
    let corruptPath;
    const broken = await runMode('broken', 3992, { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_MOOK_SINCE: SINCE_ISO,
        GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: '200' }, (dir) => {
        corruptPath = path.join(dir, 'gam', 'gamification.db');
        fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
        fs.writeFileSync(corruptPath, Buffer.alloc(8192, 0x5a));
    });
    const on = await runMode('on', 3993, { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_MOOK_SINCE: SINCE_ISO,
        GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: '200' }, (dir) => {
        const env = { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: path.join(dir, 'gam', 'gamification.db') };
        const prev = { ...process.env };
        Object.assign(process.env, env);
        return import('../db.mjs').then(async (D) => {
            const L = await import('../ledger.mjs');
            const db = D.getGamificationDb({ env });
            L.createRuleSet(db, { ruleVersion: 'gm-http-v1', createdBy: 'migration', now: Date.now() - 5000, rules: { schema: 1, caps: { pmPerDay: 500, pmPerWeek: 1000 },
                facts: { 'mook_review/evidence_reviewed': { xp: 30, pm: 20, emitWhen: { decision: ['aprobado'] } }, 'mook_experience/experience_completed': { xp: 20, pm: 10 } } } });
            D.closeGamificationDb({ resetBackoff: true });
            process.env = prev;
        });
    });

    section('[2] MOOK responde y escribe igual con el motor OFF, roto o activo');
    ok('OFF: iniciar 201, entregar 201 (experiencia completada), revisar 200', off.start.status === 201 && off.submit.status === 201 && off.submit.body?.status === 'completed' && off.review.status === 200, JSON.stringify(shape(off)).slice(0, 400));
    ok('BROKEN: respuestas idénticas a OFF (estado y cuerpo normalizado)', JSON.stringify(shape(broken)) === JSON.stringify(shape(off)), JSON.stringify([shape(broken), shape(off)]).slice(0, 600));
    ok('ON: respuestas idénticas a OFF', JSON.stringify(shape(on)) === JSON.stringify(shape(off)), JSON.stringify([shape(on), shape(off)]).slice(0, 600));
    { const a = JSON.stringify(norm(off.mook)), b = JSON.stringify(norm(broken.mook)), c = JSON.stringify(norm(on.mook)); const at = (x) => { let i = 0; while (i < a.length && a[i] === x[i]) i++; return `…${a.slice(Math.max(0, i - 80), i + 60)} ≠ ${x.slice(Math.max(0, i - 80), i + 60)}`; }; ok('mook_db.json final equivalente en los tres modos', b === a && c === a, b !== a ? at(b) : at(c)); }
    ok('la evidencia quedó REVIEWED/aprobado en los tres', [off, broken, on].every((r) => r.mook.evidence[0]?.review?.status === 'REVIEWED' && r.mook.evidence[0].review.decision === 'aprobado'));
    ok('ningún otro store (usuarios, contenido, progreso, uploads) cambió en ningún modo', off.otherStoresUnchanged && broken.otherStoresUnchanged && on.otherStoresUnchanged);
    ok('el servidor anunció sus rutas SQLite y ninguna cae en el repo', [off, broken, on].every((r) => /SQLite path: /.test(r.logs) && sqlitePathsInRepo(r.logs).length === 0), sqlitePathsInRepo(off.logs + broken.logs + on.logs).join());
    ok('control: una ruta real sí se detectaría', sqlitePathsInRepo(`[x] SQLite path: ${path.join(REPO, 'data-critical', 'events.db')}
`).length === 1);
    ok('BROKEN: la base corrupta sigue intacta', fs.readFileSync(corruptPath).every((b) => b === 0x5a));
    ok('BROKEN: el motor desistió sin errores 5xx', !/\s5\d\d\s/.test(broken.logs) && /gamification/.test(broken.logs), broken.logs.slice(-600));

    section('[3] ON: exactamente los hechos esperados');
    process.env.GAMIFICATION_ENABLED = '1';
    const D = await import('../db.mjs');
    const L = await import('../ledger.mjs');
    const env = { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: path.join(on.dir, 'gam', 'gamification.db') };
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    const f = db.prepare('SELECT source, source_event_id, decision, user_id, actor_id FROM gm_source_facts ORDER BY source').all();
    ok('2 hechos: mook_experience (u-lector:versión) y mook_review (id de evidencia)', f.length === 2
        && f[0].source === 'mook_experience' && f[0].source_event_id === `u-lector:${VER_ID}`
        && f[1].source === 'mook_review' && f[1].source_event_id === on.mook.evidence[0].id, JSON.stringify(f));
    ok('ambos awarded para el lector; el revisor queda como actor', f.every((x) => x.decision === 'awarded' && x.user_id === 'u-lector') && f[1].actor_id === 'u-admin');
    ok('saldo 30 PM y 50 XP (montos de la regla)', L.getBalance(db, 'u-lector').available === 30 && L.getXp(db, 'u-lector') === 50);
    ok('el reconciliador de arranque no duplicó nada', db.prepare('SELECT COUNT(*) n FROM gm_pm_movements').get().n === 2 && L.verifyLedger(db).ok);
    D.closeGamificationDb({ resetBackoff: true });
    ok('OFF: no se creó gamification.db', !fs.existsSync(path.join(off.dir, 'gam', 'gamification.db')));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    const touched = fingerprintDiff(realFingerprintBefore, realStoresFingerprint());
    ok('huella de data/, data-critical/ y public/uploads/ idéntica', touched.length === 0, touched.join());
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nCHP-GAMIFICACION-G3-03 (MOOK por HTTP) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
