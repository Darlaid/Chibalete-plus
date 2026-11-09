/**
 * platformIntegration.test.mjs — CHP-GAMIFICACION-V8-INTEGRATION-01.
 *
 * Recorrido completo de gamificación por HTTP sobre DOS réplicas reales de
 * server.js (stores temporales compartidos, sesiones firmadas en modo enforce,
 * usuarios sintéticos). Desde V8-ACTIVATE-PREP-01 el arnés ya no cambia nada:
 * es el código real de `mook_review`.
 *  [1] lector individual (regla de usuario, revisa administración)
 *  [2] lector de colegio: 1.ª y 2.ª aprobación, ajustes y reenvío, duplicados
 *  [3] dos colegios, mediadores de grupos distintos: alcance de revisión
 *  [4] varias obras y experiencias; experiencia sin producción no suma
 *  [5] obra sin acceso y lector sin reglas: aprobada sin XP
 *  [6] cuenta excluida: misma vista que alguien sin actividad
 *  [7] aprobaciones concurrentes en las dos réplicas: exactamente un hecho
 *  [8] agregado del mediador: recuentos con k ≥ 5, sin datos individuales
 *  [9] historial: qué, cuándo y por qué; privacidad del JSON
 * [10] réplica con XP apagado: 404 y ninguna escritura
 * [11] reconciliadores por lotes concurrentes: convergen sin duplicados
 * [12] reinicio de una réplica: el progreso se conserva
 * Requiere POSIX (la clave de sesión exige 0400/uid): en Windows sale con SKIP.
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/platformIntegration.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { grantA2 } from '../../__test__/helpers/testA2.mjs';

if (process.platform === 'win32') {
    console.log('platformIntegration: SKIP en Windows (sesión firmada POSIX). Corre en CI (Linux) o dentro de la imagen.');
    process.exit(0);
}

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const HARNESS = pathToFileURL(path.join(HERE, 'helpers', 'xpRecognitionHarness.mjs')).href;

function realFingerprint() {
    const out = {};
    const walk = (d) => {
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) out[path.relative(REPO, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        }
    };
    walk(path.join(REPO, 'data')); walk(path.join(REPO, 'data-critical'));
    return out;
}
const realBefore = realFingerprint();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_platform_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const E = await import('../erasure.mjs');

const SINCE = Date.now() - 60_000;
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const WORDS = 'una dos tres cuatro cinco seis siete';
const PW = 'fixture-pass';
const HASH = bcrypt.hashSync(PW, 4);

// ── Plataforma sintética ─────────────────────────────────────────────────────
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'data', 'content.json'), mook: path.join(tmp, 'data', 'mook_db.json'), groups: path.join(tmp, 'data', 'groups_db.json'),
    gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl'), key: path.join(tmp, 'session_signing_key'),
};
P.gamDb = path.join(P.gamDir, 'gamification.db');
for (const d of [P.data, P.gamDir, path.dirname(P.reg), path.join(tmp, 'uploads'), path.join(tmp, 'sqlite')]) fs.mkdirSync(d, { recursive: true });
const user = (id, extra = {}) => ({ id, email: `${id}@fx.test`, password: HASH, nombre_completo: id, roles: ['lector'], accountStatus: 'active', ...extra });
const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const A1 = range('a', 1, 6), A2 = range('a', 7, 11), B1 = range('b', 1, 5);
const USERS = [
    ...A1.map((id) => user(id, { organizationId: 'org-a', colegio: 'Colegio A' })),
    ...A2.map((id) => user(id, { organizationId: 'org-a', colegio: 'Colegio A' })),
    ...B1.map((id) => user(id, { organizationId: 'org-b', colegio: 'Colegio B' })),
    user('m-a1', { roles: ['mediador'], organizationId: 'org-a' }), user('m-a2', { roles: ['mediador'], organizationId: 'org-a' }),
    user('m-b1', { roles: ['mediador'], organizationId: 'org-b' }),
    user('ind1'), user('ind2'), user('adm', { roles: ['administrador'] }),
];
fs.writeFileSync(P.users, JSON.stringify(USERS));
// V8.1-CLOSE-02: A2 = Sí para los lectores sintéticos (revisión y vistas individuales del mediador).
grantA2(USERS.filter((x) => x.roles.includes('lector')).map((x) => x.id));
const work = (id) => ({ id, titulo: `Título ${id}`, autor: 'A', tipo: 'libro', status: 'disponible', editorial: 'Chibalete', etiquetas: ['x'], descripcion_corta: 'd' });
fs.writeFileSync(P.content, JSON.stringify(['obra-1', 'obra-2', 'obra-3'].map(work)));
const group = (id, org, mediator, students) => ({ id, name: id, type: 'course', organizationId: org, mediatorIds: [mediator], teacherId: mediator, studentIds: students, memberIds: students });
fs.writeFileSync(P.groups, JSON.stringify([group('g-a1', 'org-a', 'm-a1', A1), group('g-a2', 'org-a', 'm-a2', A2), group('g-b1', 'org-b', 'm-b1', B1)]));
// Acceso explícito: reglas de grupo (SCOPE_TITLE) para obra-1 y obra-2; obra-3 sin reglas. ind1 con regla propia; ind2 sin reglas.
const rule = (id, scope, scopeId, titleIds) => ({ id, scope, scopeId, titleIds, collectionIds: [], expiresAt: null });
fs.writeFileSync(P.access, JSON.stringify([rule('r-ga1', 'group', 'g-a1', ['obra-1', 'obra-2']), rule('r-ga2', 'group', 'g-a2', ['obra-1', 'obra-2']),
    rule('r-gb1', 'group', 'g-b1', ['obra-1', 'obra-2']), rule('r-ind1', 'user', 'ind1', ['obra-1', 'obra-2'])]));
for (const f of ['progress_db.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(P.data, f), f === 'progress_db.json' ? '{"progressMap":{}}' : '[]');
// Organizaciones registradas: el CIS solo da alcance sobre grupos de una organización real.
fs.writeFileSync(path.join(P.data, 'schools_db.json'), JSON.stringify([{ id: 'org-a', name: 'Colegio A' }, { id: 'org-b', name: 'Colegio B' }]));
fs.writeFileSync(P.reg, '');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

// MOOK: X1 obra-1 (dos producciones), X2 obra-2, X3 obra-3 (sin acceso), X0 solo lectura (sin producción).
const doc = Store.emptyMookStore();
const mkExp = (slug, w, prods) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: w },
        ...prods.map((id) => ({ id, type: 'PRODUCTION', title: id, resourceRef: w, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }))] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp.id;
};
const X1 = mkExp('x1', 'obra-1', ['p1', 'p2']), X2 = mkExp('x2', 'obra-2', ['p']), X3 = mkExp('x3', 'obra-3', ['p']), X0 = mkExp('x0', 'obra-1', []);
fs.writeFileSync(P.mook, JSON.stringify(doc, null, 2));

const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.gamDb,
    GAMIFICATION_EXCLUSION_REGISTRY: P.reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
Object.assign(process.env, { GAMIFICATION_DB: P.gamDb, GAMIFICATION_EXCLUSION_REGISTRY: P.reg });
// Este proceso es una réplica escritora más (conexión abierta: -wal/-shm existen).
const db = D.getGamificationDb({ env: ENV });
L.createRuleSet(db, { ruleVersion: 'gm-v8-int', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
    rules: { schema: 1, facts: {}, recognition: PILOT } });
{
    const Pub = await import('../../royalties/publishersStore.mjs');
    Pub.getRoyaltiesDb();
    Pub.closeRoyaltiesDb?.();
}

// ── Réplicas ─────────────────────────────────────────────────────────────────
const ORIGIN = 'https://app.test';
function spawnApi(port, { flags = ENV } = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${HARNESS}`,
            CHP_DATA_DIR: P.data, USERS_DB: P.users, ACCESS_DB: P.access, CONTENT_DB: P.content,
            GROUPS_DB: P.groups, SCHOOLS_DB: path.join(P.data, 'schools_db.json'),
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'), UPLOADS_ROOT: path.join(tmp, 'uploads'),
            USER_AUDIT_DB: path.join(tmp, 'audit.json'), ACCESS_FALLBACK_MODE: 'restricted',
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'sqlite', `offline-${port}.db`), IDENTITY_DB: path.join(tmp, 'sqlite', 'identity.db'),
            SESSIONS_DB: path.join(tmp, 'sqlite', 'sessions.db'), SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
            IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
            SESSION_ALLOWED_ORIGINS: ORIGIN, ALLOWED_ORIGINS: ORIGIN,
            EVENTS_SQLITE_PATH: path.join(tmp, 'sqlite', `events-${port}.db`), ARCHIVE_SQLITE_PATH: path.join(tmp, 'sqlite', `archive-${port}.db`),
            INSIGHTS_SQLITE_PATH: path.join(tmp, 'sqlite', `insights-${port}.db`), PROGRESS_SQLITE_PATH: path.join(tmp, 'sqlite', `progress-${port}.db`),
            ROYALTIES_DB: process.env.ROYALTIES_DB,
            GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '', GAMIFICATION_MOOK_SINCE: '',
            ...flags, GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: '3600000', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    child.logs = () => logs;
    child.base = `http://127.0.0.1:${port}`;
    return child;
}
async function healthy(child) {
    for (let i = 0; i < 200; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child.logs().slice(-1500)}`);
        try { if ((await fetch(`${child.base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(300);
    }
    throw new Error(`nunca healthy\n${child.logs().slice(-1500)}`);
}
const call = async (srv, method, url, cookie, body) => {
    const headers = { origin: ORIGIN, ...(cookie ? { cookie: `chp_session=${cookie}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const r = await fetch(`${srv.base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
    return { status: r.status, body: json, text };
};
const tokens = new Map();
async function login(srv, id) {
    if (tokens.has(id)) return tokens.get(id);
    const r = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: `${id}@fx.test`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (!m) throw new Error(`login ${id}: ${r.status} ${await r.text()}`);
    tokens.set(id, m[1]);
    return m[1];
}
/** Inicia la experiencia, completa la lectura y entrega la producción `node`. */
async function deliver(srv, who, expId, node = 'p') {
    const tok = await login(srv, who);
    const run = await call(srv, 'POST', `/api/experiences/${expId}/run`, tok);
    if (![200, 201].includes(run.status)) throw new Error(`run ${who}: ${run.status} ${run.text}`);
    const runId = run.body.runId;
    await call(srv, 'POST', `/api/experiences/runs/${runId}/nodes/r/complete`, tok);
    const ev = await call(srv, 'POST', `/api/experiences/runs/${runId}/nodes/${node}/evidence`, tok, { text: WORDS });
    if (![200, 201].includes(ev.status)) throw new Error(`evidence ${who}: ${ev.status} ${ev.text}`);
    return { runId, evidenceId: ev.body.evidenceId, status: ev.status };
}
const review = async (srv, mediator, evidenceId, decision = 'aprobado') => call(srv, 'POST', `/api/experiences/review/${evidenceId}`, await login(srv, mediator), { decision });
/** Coherencia interna de una respuesta: XP total = historial = suma por obra (una sola instantánea). */
const torn = [];
const coherent = (b) => !b || b.enabled !== true || (b.xp === (b.history ?? []).reduce((s, e) => s + e.xp, 0) && b.xp === (b.works ?? []).reduce((s, w) => s + w.xp, 0));
const progress = async (srv, who) => {
    const r = await call(srv, 'GET', '/api/me/progress', await login(srv, who));
    if (r.status === 200 && !coherent(r.body)) torn.push(`${who}: ${r.text.slice(0, 300)}`);
    return r;
};
/** Los ganchos reconocen después de responder: espera a que el XP llegue (o venza). */
async function waitXp(srv, who, xp, ms = 15_000) {
    let last = null;
    for (const until = Date.now() + ms; Date.now() < until; await sleep(150)) {
        last = await progress(srv, who);
        if (last.body?.xp === xp) return last;
    }
    return last;
}
const facts = () => db.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c;
const sumXp = () => db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_xp_entries').get().n;
const workOf = (b, id) => b?.works?.find((w) => w.contentId === id);

const PORT = 5900 + (process.pid % 100) * 3;
const servers = [];
try {
    let r1 = spawnApi(PORT), r2 = spawnApi(PORT + 1);
    servers.push(r1, r2);
    await Promise.all([healthy(r1), healthy(r2)]);

    section('[1] lector individual (regla propia, revisa administración)');
    {
        const ev = await deliver(r1, 'ind1', X1, 'p1');
        ok('admin aprueba en la otra réplica', (await review(r2, 'adm', ev.evidenceId)).status === 200);
        const p = await waitXp(r1, 'ind1', 30);
        ok('30 XP, nivel Brote, obra reconocida', p.body?.xp === 30 && p.body.level.id === 'brote' && workOf(p.body, 'obra-1')?.state === 'recognized', p.text);
        ok('un mediador de colegio no puede revisar a un lector individual', (await review(r1, 'm-a1', ev.evidenceId)).status === 403);
    }

    section('[2] lector de colegio: dos aprobaciones, ajustes, reenvío y duplicados');
    {
        const e1 = await deliver(r1, 'a1', X1, 'p1');
        ok('mediador de su grupo aprueba (réplica 2)', (await review(r2, 'm-a1', e1.evidenceId)).status === 200);
        ok('1.ª aprobación ⇒ 30 XP', (await waitXp(r1, 'a1', 30)).body?.xp === 30);
        const tok = await login(r1, 'a1');
        const route = await call(r1, 'POST', `/api/experiences/${X1}/run`, tok);
        const e2 = await call(r1, 'POST', `/api/experiences/runs/${route.body.runId}/nodes/p2/evidence`, tok, { text: WORDS });
        ok('2.ª entrega en la misma ruta', e2.status === 201, e2.text);
        const again = await call(r2, 'POST', `/api/experiences/runs/${route.body.runId}/nodes/p2/evidence`, tok, { text: WORDS });
        ok('reintento de la misma entrega: 200, misma evidencia', again.status === 200 && again.body?.evidenceId === e2.body.evidenceId, again.text);
        const req = await call(r2, 'POST', `/api/experiences/review/${e2.body.evidenceId}/request-changes`, await login(r2, 'm-a1'), { comment: 'amplía' });
        ok('pedir ajustes no suma', req.status === 200 && (await progress(r1, 'a1')).body?.xp === 30);
        ok('estado «sugerencia» en Mi progreso', workOf((await progress(r1, 'a1')).body, 'obra-1')?.state === 'revision_requested');
        const re = await call(r1, 'POST', `/api/experiences/evidence/${e2.body.evidenceId}/resubmit`, tok, { text: `${WORDS} ocho nueve` });
        ok('reenvío: nueva versión, vuelve a revisión', re.status === 200 && re.body?.versionsCount === 2, re.text);
        ok('aprobación tras el reenvío', (await review(r1, 'm-a1', e2.body.evidenceId)).status === 200);
        const p = await waitXp(r2, 'a1', 50);
        ok('2.ª aprobación ⇒ 50 XP y obra completa', p.body?.xp === 50 && workOf(p.body, 'obra-1')?.state === 'complete', p.text);
        const dup = await review(r2, 'm-a1', e2.body.evidenceId);
        await sleep(800);
        ok('aprobar otra vez no suma (techo y clave de idempotencia)', dup.status !== 200 || (await progress(r1, 'a1')).body?.xp === 50);
        ok('una evidencia aprobada = un hecho', db.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c === 3);
    }

    section('[3] dos colegios y mediadores de grupos distintos');
    {
        const eb = await deliver(r2, 'b1', X1, 'p1');
        ok('mediador de otro colegio: 403', (await review(r1, 'm-a1', eb.evidenceId)).status === 403);
        const ea = await deliver(r1, 'a7', X1, 'p1');
        ok('mediador del mismo colegio pero de otro grupo: 403', (await review(r1, 'm-a1', ea.evidenceId)).status === 403);
        ok('su propio mediador sí aprueba', (await review(r2, 'm-b1', eb.evidenceId)).status === 200 && (await review(r1, 'm-a2', ea.evidenceId)).status === 200);
        ok('cada lector recibe sus 30 XP', (await waitXp(r1, 'b1', 30)).body?.xp === 30 && (await waitXp(r2, 'a7', 30)).body?.xp === 30);
        ok('el XP de a1 no cambia', (await progress(r2, 'a1')).body?.xp === 50);
    }

    section('[4] varias obras y experiencias');
    {
        const e = await deliver(r2, 'a1', X2);
        ok('otra obra: +30', (await review(r1, 'm-a1', e.evidenceId)).status === 200 && (await waitXp(r1, 'a1', 80)).body?.xp === 80);
        const p = (await progress(r1, 'a1')).body;
        ok('dos obras en Mi progreso, cada una con su techo', workOf(p, 'obra-1')?.xp === 50 && workOf(p, 'obra-2')?.xp === 30 && p.stats.works === 2, JSON.stringify(p.works));
        const tok = await login(r1, 'a2');
        const run0 = await call(r1, 'POST', `/api/experiences/${X0}/run`, tok);
        await call(r1, 'POST', `/api/experiences/runs/${run0.body.runId}/nodes/r/complete`, tok);
        await sleep(800);
        ok('experiencia sin producción completada: 0 XP y ningún hecho', (await progress(r2, 'a2')).body?.xp === 0 && facts() === 6, String(facts()));
    }

    section('[5] obra sin acceso y lector sin reglas');
    {
        const e3 = await deliver(r1, 'a2', X3);
        ok('obra sin acceso aprobada', (await review(r2, 'm-a1', e3.evidenceId)).status === 200);
        const ei = await deliver(r1, 'ind2', X1, 'p1');
        ok('lector sin reglas aprobado por administración', (await review(r1, 'adm', ei.evidenceId)).status === 200);
        await sleep(1500);
        const pa = (await progress(r2, 'a2')).body, pi = (await progress(r2, 'ind2')).body;
        ok('aprobada sin XP, sin hecho', pa?.xp === 0 && workOf(pa, 'obra-3')?.state === 'approved_no_xp' && pi?.xp === 0 && workOf(pi, 'obra-1')?.state === 'approved_no_xp'
            && facts() === 6, JSON.stringify([pa?.works, pi?.works, facts()]));
        ok('sin reglas: ninguna actividad que sume', pi.availability.activities === 0 && pa.availability.works === 2);
    }

    section('[6] cuenta excluida');
    {
        const ack = E.excludeUser(db, { userId: 'a3', requestRef: 'SOL-SINT-V8', env: ENV });
        ok('exclusión registrada', ack.inserted && !ack.unlinked);
        const e = await deliver(r2, 'a3', X1, 'p1');
        ok('su mediador aprueba (la pedagogía sigue igual)', (await review(r1, 'm-a1', e.evidenceId)).status === 200);
        await sleep(1500);
        const pe = (await progress(r1, 'a3')).body, pn = (await progress(r1, 'a10')).body;
        ok('0 XP y vista idéntica a la de alguien sin actividad', pe?.xp === 0 && JSON.stringify(pe) === JSON.stringify(pn), JSON.stringify(pe));
        ok('sin sujeto ni hecho', facts() === 6 && db.prepare('SELECT COUNT(*) c FROM gm_erasures').get().c === 1);
    }

    section('[7] aprobaciones concurrentes en las dos réplicas');
    {
        const evs = await Promise.all(['a4', 'a5', 'a6'].map((u, i) => deliver(i % 2 ? r2 : r1, u, X2)));
        const res = await Promise.all(evs.flatMap((e) => [review(r1, 'm-a1', e.evidenceId), review(r2, 'm-a1', e.evidenceId)]));
        ok('cada evidencia aprobada al menos una vez', evs.every((_, i) => res[2 * i].status === 200 || res[2 * i + 1].status === 200), JSON.stringify(res.map((r) => r.status)));
        const p = await Promise.all(['a4', 'a5', 'a6'].map((u, i) => waitXp(i % 2 ? r1 : r2, u, 30)));
        ok('exactamente 30 XP para cada uno', p.every((x) => x.body?.xp === 30), JSON.stringify(p.map((x) => x.body?.xp)));
        ok('exactamente un hecho por evidencia', facts() === 9, String(facts()));
    }

    section('[7b] lecturas de Mi progreso durante aprobaciones concurrentes');
    {
        const readers = ['a9', 'a10', 'a11'];
        const evs = await Promise.all(readers.map((u, i) => deliver(i % 2 ? r2 : r1, u, X1, 'p1')));
        let stop = false, reads = 0;
        const poll = async (srv, who) => { while (!stop) { await progress(srv, who); reads += 1; } };
        const pollers = readers.flatMap((u) => [poll(r1, u), poll(r2, u)]);
        await Promise.all(evs.map((e, i) => review(i % 2 ? r1 : r2, 'm-a2', e.evidenceId)));
        const done = await Promise.all(readers.map((u, i) => waitXp(i % 2 ? r2 : r1, u, 30)));
        await sleep(500);
        stop = true;
        await Promise.all(pollers);
        ok('las tres aprobaciones llegan a 30 XP', done.every((x) => x.body?.xp === 30));
        ok(`${reads} lecturas concurrentes, todas coherentes (XP = historial = obras)`, torn.length === 0 && reads > 20, torn.slice(0, 2).join(' || '));
    }

    section('[8] agregado del mediador');
    {
        const g = await call(r1, 'GET', '/api/groups/g-a1/analytics-summary', await login(r1, 'm-a1'));
        const rec = JSON.stringify(g.body ?? {});
        const ledger = g.body?.recognition?.ledger ?? g.body?.gamification?.ledger ?? null;
        ok('resumen del grupo para su mediador', g.status === 200, g.text.slice(0, 200));
        ok('recuento de lectores con obra reconocida (a1, a4, a5, a6 = 4 de 6; a3 excluida no cuenta)', ledger?.status === 'ok' && ledger.studentsWithRecognizedWork === 4, rec.slice(0, 400));
        ok('sin nombres, XP ni niveles individuales', !/"xp"|nivel|level|semilla|brote|"a1"|a1@/i.test(JSON.stringify(g.body?.recognition ?? {})));
        ok('otro mediador no ve ese grupo', [403, 404].includes((await call(r1, 'GET', '/api/groups/g-a1/analytics-summary', await login(r1, 'm-b1'))).status));
        const small = await call(r2, 'GET', '/api/groups/g-b1/analytics-summary', await login(r2, 'm-b1'));
        ok('grupo de 5: se muestra; el umbral es k ≥ 5', small.status === 200 && small.body?.recognition?.ledger?.status === 'ok', JSON.stringify(small.body?.recognition));
        ok('mediador: su propio progreso es privado y no da acceso a otros', (await progress(r1, 'm-a1')).body?.xp === 0);
    }

    section('[9] historial y privacidad');
    {
        const p = (await progress(r2, 'a1')).body;
        const h = p?.history ?? [];
        const today = new Date().toISOString().slice(0, 10);
        ok('cinco actos: lectura y dos reflexiones de obra-1, lectura y reflexión de obra-2', h.length === 5 && h.reduce((s, e) => s + e.xp, 0) === 80, JSON.stringify(h));
        ok('cada entrada con día, obra, título y acto', h.every((e) => e.day === today && ['obra-1', 'obra-2'].includes(e.contentId) && e.title?.startsWith('Título') && ['reading', 'reflection'].includes(e.act)));
        const all = JSON.stringify(p);
        ok('sin claves, ids de hechos, evidencias ni revisores', !/subject|work_key|fact|tombstone|evid-|m-a1|reviewer|[0-9a-f]{64}/i.test(all));
        ok('el sujeto es siempre la sesión: query y cabecera no cambian nada',
            (await call(r1, 'GET', '/api/me/progress?userId=a1', await login(r1, 'a2'))).body?.xp === 0);
    }

    section('[10] réplica con XP apagado');
    {
        const off = spawnApi(PORT + 2, { flags: { ...ENV, XP_EARNING_ENABLED: '' } });
        const gone = spawnApi(PORT + 3, { flags: { GAMIFICATION_ENABLED: '' } });
        servers.push(off, gone);
        await Promise.all([healthy(off), healthy(gone)]);
        ok('sin gamificación: /api/me/progress 404', (await progress(gone, 'a1')).status === 404);
        ok('XP apagado: { enabled: false }', (await progress(off, 'a1')).body?.enabled === false);
        const before = facts();
        const e = await deliver(off, 'a8', X1, 'p1');
        ok('la revisión funciona igual con XP apagado', (await review(off, 'm-a2', e.evidenceId)).status === 200);
        await sleep(1500);
        ok('su gancho no escribe nada', facts() === before);
        gone.kill('SIGKILL'); off.kill('SIGKILL');
    }

    section('[11] reconciliadores por lotes concurrentes (dos réplicas)');
    {
        // a8 quedó aprobada con XP apagado en su réplica: la reconciliación de las réplicas con XP la recoge.
        const worker = path.join(HERE, 'mookBatchedWorker.mjs');
        const barrier = path.join(tmp, 'barrier');
        const run = () => new Promise((resolve) => {
            const c = spawn(process.execPath, [worker, 'replica', barrier], {
                env: { ...process.env, ...ENV, CHP_FIXTURE: P.mook, CHP_USERS: P.users }, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
            c.on('close', (code) => resolve({ code, out }));
        });
        const rs = [run(), run()];
        await sleep(300);
        fs.writeFileSync(barrier, '');
        const done = await Promise.all(rs);
        ok('dos reconciliadores terminan', done.every((d) => d.code === 0), JSON.stringify(done.map((d) => d.out.slice(-200))));
        ok('a8 reconocida una sola vez (30 XP)', (await waitXp(r1, 'a8', 30, 5000)).body?.xp === 30);
        ok('sin duplicados: 13 hechos y XP total = suma de ciclos', facts() === 13 && sumXp() === db.prepare('SELECT SUM(xp) n FROM gm_work_cycles').get().n, String(facts()));
        ok('ledger íntegro', db.pragma('integrity_check', { simple: true }) === 'ok');
        ok('PM retirado: ningún movimiento ni saldo', db.prepare('SELECT COUNT(*) c FROM gm_pm_movements').get().c === 0 && db.prepare('SELECT COUNT(*) c FROM gm_pm_balances').get().c === 0);
    }

    section('[12] reinicio de una réplica');
    {
        r1.kill('SIGKILL');
        await sleep(300);
        r1 = spawnApi(PORT);
        servers.push(r1);
        await healthy(r1);
        const p = await progress(r1, 'a1');
        ok('tras reiniciar, el progreso es el mismo (sesión, XP e historial)', p.body?.xp === 80 && p.body.history.length === 5, p.text.slice(0, 200));
        ok('los logs de las réplicas no contienen ids de lectores junto a XP', ![r2.logs()].some((l) => /a1[^\n]*\bxp\b/i.test(l)));
    }

    section('[coherencia]');
    ok('ninguna respuesta de Mi progreso rota en toda la prueba', torn.length === 0, torn.slice(0, 2).join(' || '));

    section('[aislamiento]');
    const after = realFingerprint();
    const diff = Object.keys({ ...realBefore, ...after }).filter((k) => realBefore[k] !== after[k]);
    ok('stores reales intactos (data/, data-critical/)', diff.length === 0, diff.join());
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    try { D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
console.log(`\nplatformIntegration (V8-INTEGRATION-01): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
