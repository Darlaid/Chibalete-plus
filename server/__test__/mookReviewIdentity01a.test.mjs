/**
 * mookReviewIdentity01a.test.mjs — CHP-MOOK-REVIEW-IDENTITY-INTEGRATION-01A.
 *
 * El Review se integra con la identidad canónica EXISTENTE:
 *   sesión firmada → usuario canónico activo → membership de mediador
 *   (group.mediatorIds) → grupo → institución (organizationId).
 *
 * Servidor real en modo compat con stores temporales, dos capas:
 *   A. Identidad legacy (x-user-id) y estructura — corre en todas las
 *      plataformas: participante, otro participante, lector, cuenta inactiva,
 *      inexistente, mediador gateado sin sesión canónica, admin intacto,
 *      store byte-idéntico tras denegaciones.
 *   B. Sesión firmada — POSIX-only (la clave de firma se lee con O_NOFOLLOW y
 *      uid, como en sessionIdentityIntegration.test.mjs): aislamiento positivo
 *      y negativo por membership e institución, datos falsificados, revisión
 *      válida con transición conservada y `evidence_reviewed` emitido una vez.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, submitEvidence,
} from '../lib/experienceStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const POSIX = process.platform !== 'win32';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { passed++; console.log(`  ok — ${name}`); }
    else { failed++; console.log(`  FAIL — ${name} ${extra}`); }
};

// ─────────────────────────────── fixtures ────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_review_id_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads'),
    key: path.join(tmp, 'session_signing_key'), events: path.join(tmp, 'events.db'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });

const PW = 'fixture-pass-01a';
const u = (id, roles, extra = {}) => ({
    id, email: `${id.toLowerCase()}@fx.test`, password: bcrypt.hashSync(PW, 4),
    nombre: `Nombre ${id}`, roles, accountStatus: 'active', ...extra,
});
const USERS = [
    u('ADM', ['administrador']),
    u('P1', ['lector'], { organizationId: 'org-a' }),
    u('P2', ['lector'], { organizationId: 'org-a' }),
    u('MED1', ['mediador'], { organizationId: 'org-a' }),   // mediador de G1 (P1, P2)
    u('MED2', ['mediador'], { organizationId: 'org-a' }),   // misma institución, solo G2 (P2)
    u('MED3', ['mediador'], { organizationId: 'org-b' }),   // otra institución; G3 declara a P1
    u('MED4', ['mediador'], { organizationId: 'org-b' }),   // otra institución listado en G1
    u('MEDX', ['mediador'], { organizationId: 'org-a', accountStatus: 'disabled' }), // inactivo, en G1
    u('MED0', ['mediador'], { organizationId: 'org-a' }),   // sin ningún grupo
];
const GROUPS = [
    { id: 'G1', name: 'Grado 5', type: 'course', organizationId: 'org-a', mediatorIds: ['MED1', 'MED4', 'MEDX'], memberIds: ['P1', 'P2'] },
    { id: 'G2', name: 'Club', type: 'club', organizationId: 'org-a', mediatorIds: ['MED2'], memberIds: ['P2'] },
    { id: 'G3', name: 'Ajeno', type: 'course', organizationId: 'org-b', mediatorIds: ['MED3'], memberIds: ['P1'] },
];

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const doc = emptyMookStore();
const EXP = createExperience(doc, { slug: 'rev-id', title: 'Revisable' });
const V = createDraftVersion(doc, EXP.id, {
    objectives: ['objetivo'],
    modules: [{ id: 'm1', title: 'Uno', nodes: [
        { id: 'n1', type: 'ACTIVITY', title: 'Actividad', config: { preguntas: [{ texto: 'p1', tipo: 'text_short' }] } },
        { id: 'n2', type: 'PRODUCTION', title: 'Producir', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 40 } },
    ] }],
}, () => true);
publishVersion(doc, V.id);
const EV = {};
for (const pid of ['P1', 'P2']) {
    const { run } = startRun(doc, { userId: pid, experienceId: EXP.id });
    submitEvidence(doc, { runId: run.id, nodeId: 'n1', userId: pid, payload: { answers: ['r'] } });
    EV[pid] = submitEvidence(doc, { runId: run.id, nodeId: 'n2', userId: pid, payload: { text: words(10) } }).evidence;
}
const MOOK = path.join(P.data, 'mook_db.json');
fs.writeFileSync(MOOK, JSON.stringify(doc, null, 2));
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([]));
fs.writeFileSync(P.access, JSON.stringify([]));
fs.writeFileSync(P.content, JSON.stringify([]));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

// ─────────────────────────────── servidor ────────────────────────────────────
const PORT = 4800 + (process.pid % 150);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'offline.db'),
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        IDENTITY_DB: path.join(tmp, 'identity.db'),
        SESSIONS_DB: path.join(tmp, 'sessions.db'), SESSION_KEY_CURRENT_PATH: P.key,
        SESSION_AUTH_MODE: 'compat',
        SESSION_ALLOWED_ORIGINS: 'https://app.test', ALLOWED_ORIGINS: 'https://app.test',
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'),
        PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'),
        EXPERIENCE_EVENTS_BACKBONE_ENABLED: '1',
    },
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });

async function waitHealthy() {
    for (let i = 0; i < 200; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${bootLog.slice(-2000)}`);
        try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* aún no escucha */ }
        await sleep(300);
    }
    throw new Error(`el server nunca respondió healthy\n${bootLog.slice(-2000)}`);
}

const cookieOf = (res) => { const m = (res.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
async function login(id) {
    const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${id.toLowerCase()}@fx.test`, password: PW }),
    });
    return { status: r.status, cookie: cookieOf(r) };
}
async function call(method, p, auth = {}, body) {
    const headers = { 'content-type': 'application/json', ...(auth.cookie ? { cookie: auth.cookie } : {}), ...(auth.xuid ? { 'x-user-id': auth.xuid } : {}) };
    if (method !== 'GET') headers['sec-fetch-site'] = 'same-origin';
    const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: json };
}
const storeHash = () => crypto.createHash('sha256').update(fs.readFileSync(MOOK)).digest('hex');
const storeEvidence = (id) => JSON.parse(fs.readFileSync(MOOK, 'utf8')).evidence.find(e => e.id === id);
let evdb = null;
const db = () => (evdb ??= new Database(P.events, { readonly: true, fileMustExist: true }));
const reviewedRows = () => db().prepare("SELECT * FROM events WHERE event = 'evidence_reviewed' ORDER BY id").all()
    .map(r => ({ ...r, payload: JSON.parse(r.payload_json || '{}') }));

const Q = '/api/experiences/review/queue';
const detail = (id) => `/api/experiences/review/${id}/detail`;
const decide = (id) => `/api/experiences/review/${id}`;
const FORGED = { userId: 'P1', reviewerId: 'ADM', groupId: 'G1', institutionId: 'org-a', organizationId: 'org-a', role: 'administrador', roles: ['administrador'], colegio: 'Nuevo Bosque' };
const X = (id) => ({ xuid: id });

try {
    await waitHealthy();
    const h0 = storeHash();

    // ═══════════════════ A. identidad legacy + estructura (todas las plataformas) ═══
    console.log('\n[A1] Participante (x-user-id, camino compat existente)');
    const a1 = await call('GET', `/api/experiences/${EXP.id}/route`, X('P1'));
    ok('A1. el participante ve su propia producción en su ruta',
        a1.status === 200 && (a1.body?.evidence ?? []).some(e => e.id === EV.P1.id), `→ ${a1.status}`);

    console.log('\n[A2] Otro participante');
    const a2a = await call('POST', `/api/experiences/evidence/${EV.P1.id}/resubmit`, X('P2'), { text: words(8) });
    const a2b = await call('GET', Q, X('P2'));
    const a2c = await call('GET', detail(EV.P1.id), X('P2'));
    const a2d = await call('POST', decide(EV.P1.id), X('P2'), { decision: 'aprobado', ...FORGED });
    ok('A2. otro participante no reenvía ni revisa; el payload falsificado no le abre nada',
        a2a.status === 403 && a2a.body?.code === 'NOT_EVIDENCE_OWNER' && a2b.status === 403 && a2b.body?.code === 'REVIEW_FORBIDDEN'
        && a2c.status === 403 && a2d.status === 403, `→ ${a2a.status}/${a2b.status}/${a2c.status}/${a2d.status}`);

    console.log('\n[A3] Identidad legacy sin sesión canónica');
    const a3a = await call('GET', Q, X('MED1'));
    const a3b = await call('GET', detail(EV.P1.id), X('MED1'));
    const a3c = await call('POST', decide(EV.P1.id), X('MED1'), { decision: 'aprobado', ...FORGED });
    ok('A3. MED1 por x-user-id (mediador con membership real) sigue FAIL-CLOSED: la autoridad nueva exige sesión',
        a3a.status === 403 && a3a.body?.code === 'MEDIATOR_SCOPE_GATED' && a3b.status === 403 && a3c.status === 403,
        `→ ${a3a.status}/${a3b.status}/${a3c.status}`);
    const a3d = await call('GET', Q, X('ADM'));
    const a3e = await call('GET', detail(EV.P2.id), X('ADM'));
    ok('A3b. el administrador conserva su alcance global previo (bandeja completa y detalle)',
        a3d.status === 200 && Array.isArray(a3d.body) && a3d.body.length === 2 && a3e.status === 200, `→ ${a3d.status}/${a3e.status}`);
    ok('A3c. la bandeja no expone correo ni userId del participante',
        a3d.status === 200 && JSON.stringify(a3d.body).includes('Nombre P1') && !JSON.stringify(a3d.body).includes('@fx.test') && !JSON.stringify(a3d.body).includes('"userId"'));

    console.log('\n[A4] Cuenta inactiva / inexistente');
    const a4a = await call('GET', Q, X('MEDX'));
    const a4b = await call('GET', Q, X('NADIE'));
    const a4c = await call('GET', Q, {});
    ok('A4. MEDX (disabled, mediador de G1), inexistente y anónimo → 401',
        a4a.status === 401 && a4b.status === 401 && a4c.status === 401, `→ ${a4a.status}/${a4b.status}/${a4c.status}`);

    console.log('\n[A5] Las denegaciones no escriben');
    ok('A5. el store es byte-idéntico tras todas las denegaciones y lecturas', storeHash() === h0);

    console.log('\n[A6] Estructura preservada');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    const reviewRoute = src.slice(src.indexOf("app.post('/api/experiences/review/:evidenceId', requireUserAuth"), src.indexOf("app.post('/api/experiences/evidence/:evidenceId/resubmit'"));
    ok('A6. la ruta de revisión emite evidence_reviewed una vez, tras mutar, con reviewerId de sesión',
        (reviewRoute.match(/emitEvidenceReviewed\(/g) ?? []).length === 1
        && reviewRoute.indexOf('await mutateMook') < reviewRoute.indexOf('emitEvidenceReviewed(')
        && reviewRoute.includes('reviewerId: req.user.id') && reviewRoute.includes('actorId: ev.userId'));
    const guard = src.slice(src.indexOf('function mediatorReviewScope'), src.indexOf('function resolveParticipantName'));
    ok('A6b. la autoridad del mediador exige sesión firmada y membership canónica; nada del cliente',
        guard.includes("req.auth?.authMethod !== 'session'") && guard.includes('mediatorIds.includes(me.id)')
        && guard.includes('memberIds.includes(ownerId)') && guard.includes('organizationId')
        && !/req\.(body|query|params)/.test(guard));
    ok('A6c. toda ruta de revisión pasa por el alcance por evidencia antes de mutar',
        ['detail', 'feedback', 'request-changes'].every(s => src.includes(`/api/experiences/review/:evidenceId/${s}', requireUserAuth`))
        && (src.match(/requireReviewScope\(req, res, req\.params\.evidenceId\)/g) ?? []).length === 4);

    // ═══════════════════ B. sesión firmada (POSIX-only) ══════════════════════════
    if (!POSIX) {
        console.log('\n[B] SKIP en win32: la clave de firma se lee con O_NOFOLLOW/uid (POSIX-only); esta capa corre en CI (identity-preflight → test:mook)');
    } else {
        const S = {};
        for (const id of ['ADM', 'P1', 'P2', 'MED1', 'MED2', 'MED3', 'MED4', 'MED0']) {
            const l = await login(id);
            if (l.status !== 200 || !l.cookie) throw new Error(`login ${id} → ${l.status} cookie=${!!l.cookie}`);
            S[id] = { cookie: l.cookie };
        }

        console.log('\n[B1] Participante con sesión');
        const b1 = await call('GET', `/api/experiences/${EXP.id}/route`, S.P1);
        ok('B1. el participante ve su propia producción en su ruta',
            b1.status === 200 && (b1.body?.evidence ?? []).some(e => e.id === EV.P1.id), `→ ${b1.status}`);
        const b1b = await call('POST', `/api/experiences/evidence/${EV.P1.id}/resubmit`, S.P2, { text: words(8) });
        ok('B1b. otro participante con sesión tampoco reenvía la producción ajena', b1b.status === 403 && b1b.body?.code === 'NOT_EVIDENCE_OWNER');

        console.log('\n[B2] Mediador con membership en el grupo del participante');
        const b2q = await call('GET', Q, S.MED1);
        const b2d = await call('GET', detail(EV.P1.id), S.MED1);
        const b2f = await call('POST', `/api/experiences/review/${EV.P1.id}/feedback`, S.MED1, { comment: 'bien encaminado' });
        ok('B2. MED1 (G1) ve la bandeja de SU grupo (P1 y P2), el detalle y comenta',
            b2q.status === 200 && Array.isArray(b2q.body) && b2q.body.map(x => x.id).sort().join() === [EV.P1.id, EV.P2.id].sort().join()
            && b2d.status === 200 && b2f.status === 200, `→ ${b2q.status}/${b2d.status}/${b2f.status}`);
        const h1 = storeHash();

        console.log('\n[B3] Mediador de la misma institución SIN membership en el grupo');
        const b3q = await call('GET', Q, S.MED2);
        const b3d = await call('GET', detail(EV.P1.id), S.MED2);
        const b3c = await call('POST', `/api/experiences/review/${EV.P1.id}/request-changes`, S.MED2, { comment: 'x' });
        ok('B3. MED2 (solo G2) ve únicamente a P2 y no toca la producción de P1',
            b3q.status === 200 && b3q.body.length === 1 && b3q.body[0].id === EV.P2.id
            && b3d.status === 403 && b3d.body?.code === 'REVIEW_FORBIDDEN' && b3c.status === 403,
            `→ ${b3q.status}/${b3d.status}/${b3c.status}`);

        console.log('\n[B4] Mediador de otra institución');
        const b4d = await call('GET', detail(EV.P1.id), S.MED3);
        const b4q = await call('GET', Q, S.MED3);
        ok('B4a. MED3 (org-b) no revisa a P1 (org-a) aunque un grupo de org-b lo liste',
            b4d.status === 403 && b4q.status === 200 && b4q.body.length === 0, `→ ${b4d.status}/${b4q.status}`);
        const b4b = await call('GET', Q, S.MED4);
        ok('B4b. MED4 (org-b) listado en G1 (org-a): la institución no coincide → gate',
            b4b.status === 403 && b4b.body?.code === 'MEDIATOR_SCOPE_GATED', `→ ${b4b.status} ${b4b.body?.code}`);
        const b4c = await call('GET', Q, S.MED0);
        ok('B4c. mediador sin ningún grupo → gate (sin cola global)', b4c.status === 403 && b4c.body?.code === 'MEDIATOR_SCOPE_GATED');

        console.log('\n[B5] Administrador global con sesión');
        const b5q = await call('GET', Q, S.ADM);
        const b5d = await call('GET', detail(EV.P2.id), S.ADM);
        ok('B5. el administrador ve todas las producciones y cualquier detalle', b5q.status === 200 && b5q.body.length === 2 && b5d.status === 200);

        console.log('\n[B6] Inactivo y falsificaciones');
        const l6 = await login('MEDX');
        ok('B6. MEDX (disabled) no obtiene sesión', l6.status !== 200 && !l6.cookie, `→ ${l6.status}`);
        const b6a = await call('POST', decide(EV.P1.id), S.MED2, { decision: 'aprobado', ...FORGED });
        const b6b = await call('POST', decide(EV.P1.id), { ...S.MED2, xuid: 'ADM' }, { decision: 'aprobado' });
        const b6c = await call('GET', Q, { ...S.MED0, xuid: 'MED1' });
        ok('B6b. payload falsificado → 403; cookie + x-user-id ajeno → 401 (subject_mismatch)',
            b6a.status === 403 && b6b.status === 401 && b6c.status === 401, `→ ${b6a.status}/${b6b.status}/${b6c.status}`);

        console.log('\n[B7] Las denegaciones no escriben');
        ok('B7. store byte-idéntico tras las denegaciones (solo cambió con el comentario válido de MED1)', storeHash() === h1 && h1 !== h0);
        ok('B7b. el comentario válido conserva SUBMITTED y un único feedback',
            storeEvidence(EV.P1.id).review.status === 'SUBMITTED' && storeEvidence(EV.P1.id).history.filter(h => h.type === 'feedback').length === 1);

        console.log('\n[B8] Revisión válida, sin duplicados, sujeto y revisor correctos');
        const b8 = await call('POST', decide(EV.P1.id), S.MED1, { decision: 'aprobado', feedback: 'ok', reviewerId: 'ADM', userId: 'P2' });
        const ev8 = storeEvidence(EV.P1.id);
        ok('B8. MED1 cierra la revisión: 200, REVIEWED, reviewerId de la SESIÓN (no del payload)',
            b8.status === 200 && b8.body?.review?.status === 'REVIEWED' && ev8.review.reviewerId === 'MED1' && ev8.userId === 'P1',
            `→ ${b8.status} ${JSON.stringify(b8.body)}`);
        await sleep(400);
        const b8r = await call('POST', decide(EV.P1.id), S.MED1, { decision: 'aprobado' });
        const b8a = await call('POST', decide(EV.P1.id), S.ADM, { decision: 'con_comentarios' });
        await sleep(400);
        const rows = reviewedRows();
        ok('B8b. revisión repetida → 409 y evidence_reviewed emitido UNA sola vez',
            b8r.status === 409 && b8a.status === 409 && rows.length === 1
            && storeEvidence(EV.P1.id).history.filter(h => h.type === 'reviewed').length === 1,
            `→ ${b8r.status}/${b8a.status} rows=${rows.length}`);
        const row = rows[0] ?? {};
        // El emisor persiste `actorId` como sujeto de la fila (`user_id`).
        const actor = row.user_id ?? row.userId ?? row.actor_id ?? row.payload?.actorId;
        ok('B8c. el hecho conserva participante (sujeto) y reviewerId de sesión, sin PII',
            actor === 'P1' && row.payload?.reviewerId === 'MED1' && row.payload?.evidenceId === EV.P1.id
            && !JSON.stringify(row).includes('@fx.test') && !JSON.stringify(row).includes('Nombre P1'),
            `→ actor=${actor} reviewer=${row.payload?.reviewerId}`);
    }
} catch (e) {
    failed++;
    console.log(`  FAIL — excepción: ${e.message}`);
} finally {
    try { evdb?.close(); } catch { /* noop */ }
    child.kill();
}
console.log(`\nmookReviewIdentity01a: ${passed} ok, ${failed} fallidas${POSIX ? '' : ' (capa B omitida en win32)'}`);
process.exit(failed ? 1 : 0);
