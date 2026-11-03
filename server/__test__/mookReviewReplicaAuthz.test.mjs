/**
 * mookReviewReplicaAuthz.test.mjs — SEC-MOOK-REVIEW-AUTHZ-01.
 *
 * Dos réplicas REALES (dos procesos server.js) sobre los mismos stores, como
 * api_1/api_2 en producción. Cada réplica cachea los JSON 30 s; antes de esta
 * unidad `requireReviewScope` autorizaba con esa caché y, si la entrega aún no
 * estaba en ella, dejaba pasar: la escritura (que relee del disco bajo lock) la
 * encontraba y aplicaba la revisión de un mediador ajeno.
 *
 * Casos (todas las entregas se crean por la réplica 1, con la caché de la 2
 * ya caliente):
 *   R1 mediador ajeno en la réplica 2 al instante → 403 en review, feedback y
 *      request-changes, store byte-idéntico
 *   R2 misma réplica → 403          R3 réplica 2 tras 31 s → 403
 *   R4 mediador del grupo en la réplica 2 al instante → 200
 *   R5 administrador en la réplica 2 al instante → 200
 *   R6 lector, mediador sin grupos y anónimo → denegados, sin escrituras
 *   R7 revisiones simultáneas desde ambas réplicas → exactamente una 200,
 *      el resto 409 o 403, una sola transición `reviewed`
 *   R8 el mediador pierde la membership entre la caché y la escritura → 403
 *
 * POSIX-only: la clave de firma se lee con O_NOFOLLOW y uid (igual que
 * mookReviewIdentity01a). Corre en CI (identity-preflight → test:mook).
 *   node server/__test__/mookReviewReplicaAuthz.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { emptyMookStore, createExperience, createDraftVersion, publishVersion } from '../lib/experienceStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (process.platform === 'win32') {
    console.log('mookReviewReplicaAuthz: SKIP en win32 (sesión firmada POSIX-only); corre en CI y en Linux');
    process.exit(0);
}

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { passed++; console.log(`  ok — ${name}`); }
    else { failed++; console.log(`  FAIL — ${name} ${extra}`); }
};

// ─────────────────────────────── fixtures ────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_review_replica_'));
const P = {
    data: path.join(tmp, 'data'), uploads: path.join(tmp, 'uploads'),
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'), key: path.join(tmp, 'session_signing_key'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });

const PW = 'fixture-pass-replica';
const HASH = bcrypt.hashSync(PW, 4);
const u = (id, roles, extra = {}) => ({ id, email: `${id.toLowerCase()}@fx.test`, password: HASH, nombre: `Nombre ${id}`,
    roles, accountStatus: 'active', organizationId: 'org-a', ...extra });
const PARTS = ['P1', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
const USERS = [
    u('ADM', ['administrador']),
    ...PARTS.map(id => u(id, ['lector'])),
    u('LECT', ['lector']),
    u('MED1', ['mediador']),   // mediador de G1 (todos los participantes)
    u('MED2', ['mediador']),   // misma institución, solo G2
    u('MED0', ['mediador']),   // sin grupos
];
const G1 = { id: 'G1', name: 'Grado 5', type: 'course', organizationId: 'org-a', mediatorIds: ['MED1'], memberIds: [...PARTS, 'LECT'] };
const G2 = { id: 'G2', name: 'Club', type: 'club', organizationId: 'org-a', mediatorIds: ['MED2'], memberIds: ['LECT'] };

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const doc = emptyMookStore();
const EXP = createExperience(doc, { slug: 'replica', title: 'Revisable' });
const V = createDraftVersion(doc, EXP.id, { objectives: ['o'], modules: [{ id: 'm1', title: 'Uno', nodes: [
    { id: 'n1', type: 'PRODUCTION', title: 'Producir', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 40 } },
] }] }, () => true);
publishVersion(doc, V.id);
const MOOK = path.join(P.data, 'mook_db.json');
fs.writeFileSync(MOOK, JSON.stringify(doc, null, 2));
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify([G1, G2], null, 2));
for (const f of ['schools', 'access', 'content']) fs.writeFileSync(P[f], '[]');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

// ───────────────────────────── dos réplicas ──────────────────────────────────
const basePort = 5100 + (process.pid % 300) * 2;
const replicas = [0, 1].map((i) => {
    const port = basePort + i;
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, `offline${i}.db`),
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            IDENTITY_DB: path.join(tmp, 'identity.db'),
            SESSIONS_DB: path.join(tmp, 'sessions.db'), SESSION_KEY_CURRENT_PATH: P.key,
            SESSION_AUTH_MODE: 'enforce',
            SESSION_ALLOWED_ORIGINS: 'https://app.test', ALLOWED_ORIGINS: 'https://app.test',
            EVENTS_SQLITE_PATH: path.join(tmp, 'events.db'), INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'),
            PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'),
        },
    });
    const r = { base: `http://127.0.0.1:${port}`, child, log: '' };
    child.stdout.on('data', d => { r.log += d; });
    child.stderr.on('data', d => { r.log += d; });
    return r;
});
const [A1, A2] = replicas;

async function waitHealthy(r) {
    for (let i = 0; i < 200; i++) {
        if (r.child.exitCode !== null) throw new Error(`server rc=${r.child.exitCode}\n${r.log.slice(-2000)}`);
        try { const x = await fetch(`${r.base}/api/health`); if (x.ok) return; } catch { /* aún no escucha */ }
        await sleep(300);
    }
    throw new Error(`server nunca healthy\n${r.log.slice(-2000)}`);
}
const cookieOf = (res) => { const m = (res.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
async function login(id) {
    const r = await fetch(`${A1.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${id.toLowerCase()}@fx.test`, password: PW }) });
    const c = cookieOf(r);
    if (r.status !== 200 || !c) throw new Error(`login ${id} → ${r.status}`);
    return c;
}
async function call(rep, method, p, cookie, body) {
    const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) };
    if (method !== 'GET') headers['sec-fetch-site'] = 'same-origin';
    const r = await fetch(`${rep.base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: json };
}
const storeHash = () => crypto.createHash('sha256').update(fs.readFileSync(MOOK)).digest('hex');
const storeEv = (id) => JSON.parse(fs.readFileSync(MOOK, 'utf8')).evidence.find(e => e.id === id);
const Q = '/api/experiences/review/queue';
const decide = (id) => `/api/experiences/review/${id}`;
const S = {};

/** Entrega nueva por la RÉPLICA 1, con la caché de la 2 ya caliente. */
async function submitViaA1(pid) {
    await call(A2, 'GET', Q, S.ADM); await call(A2, 'GET', Q, S.MED2); // la réplica 2 cachea mook y grupos
    const run = await call(A1, 'POST', `/api/experiences/${EXP.id}/run`, S[pid]);
    const runId = run.body?.runId;
    const ev = await call(A1, 'POST', `/api/experiences/runs/${runId}/nodes/n1/evidence`, S[pid], { text: words(10) });
    if (ev.status !== 201 || !ev.body?.evidenceId) throw new Error(`entrega ${pid} → ${run.status}/${ev.status} ${JSON.stringify(ev.body)}`);
    const q2 = await call(A2, 'GET', Q, S.ADM); // el admin ve toda la bandeja de la réplica 2
    return { id: ev.body.evidenceId, staleOnA2: Array.isArray(q2.body) && !q2.body.some(x => x.id === ev.body.evidenceId) };
}
const untouched = (id, before) => {
    const e = storeEv(id);
    return e.review?.status === before.review?.status && e.history.length === before.history.length && JSON.stringify(e) === JSON.stringify(before);
};

try {
    await Promise.all(replicas.map(waitHealthy));
    for (const id of ['ADM', 'LECT', 'MED1', 'MED2', 'MED0', ...PARTS]) S[id] = await login(id);

    console.log('\n[R1] mediador ajeno en la réplica 2, al instante');
    const e1 = await submitViaA1('P1');
    ok('R1.0 la réplica 2 aún NO ve la entrega en su caché (condición de la carrera)', e1.staleOnA2);
    const h1 = storeHash(); const b1 = storeEv(e1.id);
    const r1a = await call(A2, 'POST', decide(e1.id), S.MED2, { decision: 'aprobado', feedback: 'x' });
    const r1b = await call(A2, 'POST', `${decide(e1.id)}/feedback`, S.MED2, { comment: 'x' });
    const r1c = await call(A2, 'POST', `${decide(e1.id)}/request-changes`, S.MED2, { comment: 'x' });
    ok('R1. review, feedback y request-changes → 403 REVIEW_FORBIDDEN',
        [r1a, r1b, r1c].every(r => r.status === 403 && r.body?.code === 'REVIEW_FORBIDDEN'), `→ ${r1a.status}/${r1b.status}/${r1c.status} ${JSON.stringify(r1a.body)}`);
    ok('R1b. el store queda byte-idéntico y la evidencia sin revisión', storeHash() === h1 && untouched(e1.id, b1) && b1.review?.status !== 'REVIEWED');
    ok('R1c. el mensaje es el contrato existente', r1a.body?.error === 'Esta producción no pertenece a un grupo donde tengas membership activa de mediador');

    console.log('\n[R2] misma réplica');
    const e2 = await submitViaA1('P3');
    const h2 = storeHash();
    const r2 = await call(A1, 'POST', decide(e2.id), S.MED2, { decision: 'aprobado' });
    ok('R2. mediador ajeno en la réplica 1 → 403, sin escritura', r2.status === 403 && r2.body?.code === 'REVIEW_FORBIDDEN' && storeHash() === h2);

    console.log('\n[R4] mediador del grupo, réplica 2 al instante');
    const e4 = await submitViaA1('P5');
    const r4 = await call(A2, 'POST', decide(e4.id), S.MED1, { decision: 'aprobado', feedback: 'bien' });
    ok('R4. MED1 (G1) revisa → 200 y la evidencia queda revisada por MED1',
        r4.status === 200 && storeEv(e4.id).review?.status === 'REVIEWED' && storeEv(e4.id).review?.reviewerId === 'MED1', `→ ${r4.status} ${JSON.stringify(r4.body)?.slice(0, 160)}`);

    console.log('\n[R5] administrador, réplica 2 al instante');
    const e5 = await submitViaA1('P6');
    const r5 = await call(A2, 'POST', decide(e5.id), S.ADM, { decision: 'con_comentarios', feedback: 'ok' });
    ok('R5. ADM revisa → 200', r5.status === 200 && storeEv(e5.id).review?.decision === 'con_comentarios', `→ ${r5.status}`);

    console.log('\n[R6] lector, mediador sin grupo y anónimo');
    const h6 = storeHash();
    const r6a = await call(A2, 'POST', decide(e1.id), S.LECT, { decision: 'aprobado' });
    const r6b = await call(A2, 'POST', decide(e1.id), S.MED0, { decision: 'aprobado' });
    const r6c = await call(A2, 'POST', decide(e1.id), null, { decision: 'aprobado' });
    const r6d = await call(A2, 'POST', decide(e1.id), S.P1, { decision: 'aprobado' });
    ok('R6. lector 403 REVIEW_FORBIDDEN, sin grupo 403 MEDIATOR_SCOPE_GATED, anónimo 401, dueño 403',
        r6a.status === 403 && r6a.body?.code === 'REVIEW_FORBIDDEN' && r6b.status === 403 && r6b.body?.code === 'MEDIATOR_SCOPE_GATED'
        && r6c.status === 401 && r6d.status === 403, `→ ${r6a.status}/${r6b.status}/${r6c.status}/${r6d.status}`);
    ok('R6b. ninguna denegación escribió', storeHash() === h6 && untouched(e1.id, b1));

    console.log('\n[R7] revisiones simultáneas desde ambas réplicas');
    const e7 = await submitViaA1('P7');
    const shots = await Promise.all([
        call(A1, 'POST', decide(e7.id), S.MED1, { decision: 'aprobado' }),
        call(A2, 'POST', decide(e7.id), S.MED1, { decision: 'con_comentarios' }),
        call(A2, 'POST', decide(e7.id), S.ADM, { decision: 'aprobado' }),
        call(A2, 'POST', decide(e7.id), S.MED2, { decision: 'aprobado' }),
        call(A1, 'POST', decide(e7.id), S.MED2, { decision: 'aprobado' }),
    ]);
    const st = shots.map(s => s.status);
    const final7 = storeEv(e7.id);
    ok('R7. exactamente una 200; el resto 409 ALREADY_REVIEWED o 403; MED2 jamás 200',
        st.filter(s => s === 200).length === 1 && shots.every(s => s.status === 200 || s.status === 409 || s.status === 403)
        && shots.slice(3).every(s => s.status === 403), `→ ${st.join(',')}`);
    ok('R7b. una sola transición reviewed y el revisor es MED1 o ADM',
        final7.history.filter(h => h.type === 'reviewed').length === 1 && ['MED1', 'ADM'].includes(final7.review?.reviewerId), `→ ${final7.review?.reviewerId}`);

    console.log('\n[R8] el mediador pierde la membership entre la caché y la escritura');
    const e8 = await submitViaA1('P8');
    await call(A2, 'GET', Q, S.MED1); // la réplica 2 cachea los grupos CON MED1 en G1
    fs.writeFileSync(P.groups, JSON.stringify([{ ...G1, mediatorIds: [] }, G2], null, 2));
    const h8 = storeHash();
    const r8 = await call(A2, 'POST', decide(e8.id), S.MED1, { decision: 'aprobado' });
    ok('R8. MED1 ya sin grupo → 403 aunque la caché de la réplica 2 lo tuviera', r8.status === 403 && storeHash() === h8, `→ ${r8.status} ${JSON.stringify(r8.body)}`);
    fs.writeFileSync(P.groups, JSON.stringify([G1, G2], null, 2)); // restaura para R3

    console.log('\n[R3] réplica 2 tras 31 s (caché caducada)');
    const e3 = await submitViaA1('P4');
    await sleep(31_000);
    const h3 = storeHash();
    const r3 = await call(A2, 'POST', decide(e3.id), S.MED2, { decision: 'aprobado' });
    ok('R3. mediador ajeno → 403 sin escritura', r3.status === 403 && r3.body?.code === 'REVIEW_FORBIDDEN' && storeHash() === h3);
    const r3b = await call(A2, 'POST', decide(e3.id), S.MED1, { decision: 'aprobado' });
    ok('R3b. y el mediador del grupo sí → 200', r3b.status === 200, `→ ${r3b.status}`);
} catch (e) {
    failed++;
    console.log(`  FAIL — excepción: ${e.message}`);
} finally {
    for (const r of replicas) r.child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nmookReviewReplicaAuthz: ${passed} ok, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
