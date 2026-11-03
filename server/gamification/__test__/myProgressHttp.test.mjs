/**
 * myProgressHttp.test.mjs — CHP-GAMIFICACION-G4-UX-U2.
 *
 * `GET /api/me/progress` sobre server.js REAL, con stores temporales y usuarios
 * sintéticos. El ledger se siembra en ESTE proceso con el escritor real; los
 * servidores solo lo leen (reconciliador diferido una hora).
 *   [1] flags: sin gamificación 404; sin XP { enabled: false }
 *   [2] identidad de sesión (cabecera legada en modo off): ausente 401,
 *       usuario desactivado 403, inexistente 403
 *   [3] IDOR: ruta, query, cuerpo y cabeceras no confiables nunca cambian el sujeto
 *   [4] aislamiento entre lectores y entre instituciones (acceso real por reglas)
 *   [5] estados y XP 0/30/50 por HTTP; `mook_review` bloqueada (producción): sin
 *       actividades elegibles y aprobada sin XP, pero lo ya reconocido se ve
 *   [6] lecturas repetidas sin escrituras (gamification.db, MOOK, stores)
 *   [7] privacidad del JSON y 503 genérico sin filtración
 *   [8] POSIX: sesión firmada (enforce) válida, ausente, expirada, revocada por
 *       desactivación y suplantación por cabecera
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/myProgressHttp.test.mjs
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

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const HARNESS = pathToFileURL(path.join(HERE, 'helpers', 'xpRecognitionHarness.mjs')).href;
const POSIX = process.platform !== 'win32';

/** Huella de los stores reales (contenido de data/ y data-critical/). */
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_myprog_http_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const { signSessionToken } = await import('../../lib/sessionToken.js');

const SINCE = Date.now() - 60_000;
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [], pmFactors: [] } };
const WORDS = 'una dos tres cuatro cinco seis';
const PW = 'fixture-pass';
const HASH = bcrypt.hashSync(PW, 4);

// ── Stores sintéticos ────────────────────────────────────────────────────────
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'data', 'content.json'), mook: path.join(tmp, 'data', 'mook_db.json'),
    gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl'), key: path.join(tmp, 'session_signing_key'),
};
P.gamDb = path.join(P.gamDir, 'gamification.db');
for (const d of [P.data, P.gamDir, path.dirname(P.reg), path.join(tmp, 'uploads'), path.join(tmp, 'sqlite')]) fs.mkdirSync(d, { recursive: true });
const user = (id, extra = {}) => ({ id, email: `${id}@fx.test`, password: HASH, nombre_completo: id, roles: ['lector'], accountStatus: 'active', ...extra });
const USERS = [user('u-new'), user('u-30'), user('u-50'), user('u-pending'), user('u-instb', { organizationId: 'org-b', colegio: 'Colegio B' }),
    user('u-off', { accountStatus: 'disabled' }), user('u-med', { roles: ['administrador'] })];
fs.writeFileSync(P.users, JSON.stringify(USERS));
const work = (id) => ({ id, titulo: `Título ${id}`, autor: 'A', tipo: 'libro', status: 'disponible', editorial: 'Chibalete', etiquetas: ['x'], descripcion_corta: 'd' });
fs.writeFileSync(P.content, JSON.stringify([work('obra-a'), work('obra-b')]));
// Acceso explícito por persona (vía SCOPE_TITLE). u-instb no tiene reglas: otra institución.
fs.writeFileSync(P.access, JSON.stringify(['u-new', 'u-30', 'u-50', 'u-pending', 'u-off'].map((u) => ({
    id: `r-${u}`, scope: 'user', scopeId: u, titleIds: ['obra-a', 'obra-b'], collectionIds: [], expiresAt: null }))));
for (const f of ['progress_db.json', 'groups_db.json', 'schools_db.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(P.data, f), f === 'progress_db.json' ? '{"progressMap":{}}' : '[]');
fs.writeFileSync(P.reg, '');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
if (POSIX) fs.chmodSync(P.key, 0o400);

// MOOK: E1 obra-a con dos producciones, E2 obra-b.
const doc = Store.emptyMookStore();
const mkExp = (slug, w, prods) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: w },
        ...prods.map((id) => ({ id, type: 'PRODUCTION', title: id, resourceRef: w, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }))] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const E1 = mkExp('e1', 'obra-a', ['p1', 'p2']);
const E2 = mkExp('e2', 'obra-b', ['p']);
const grant = (w) => ({ workRef: w, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() });
const deliverApproved = (u, exp, nodeId, w, approved = true) => {
    const run = Store.startRun(doc, { userId: u, experienceId: exp.id }).run;
    if (run.nodeStates.r?.status !== 'completed') Store.completeNode(doc, run.id, 'r');
    const ev = Store.submitEvidence(doc, { runId: run.id, nodeId, userId: u, payload: { text: WORDS }, workAccess: grant(w) }).evidence;
    if (approved) Store.reviewEvidence(doc, ev.id, { reviewerId: 'u-med', decision: 'aprobado' });
    return ev;
};
deliverApproved('u-30', E1, 'p1', 'obra-a');
deliverApproved('u-50', E1, 'p1', 'obra-a');
deliverApproved('u-50', E1, 'p2', 'obra-a');
deliverApproved('u-off', E1, 'p1', 'obra-a');
const pendingEv = deliverApproved('u-pending', E2, 'p', 'obra-b');
fs.writeFileSync(P.mook, JSON.stringify(doc, null, 2));

// Ledger: reglas y barrido real (sin la evidencia de u-pending).
const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '', GAMIFICATION_DB: P.gamDb,
    GAMIFICATION_EXCLUSION_REGISTRY: P.reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
Object.assign(process.env, { GAMIFICATION_DB: P.gamDb, GAMIFICATION_EXCLUSION_REGISTRY: P.reg });
{
    const db = D.getGamificationDb({ env: ENV });
    L.createRuleSet(db, { ruleVersion: 'gm-u2-http', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
        rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {}, recognition: PILOT } });
    const res = M.recognizeMookWorks(db, { ...doc, evidence: doc.evidence.filter((e) => e.id !== pendingEv.id) }, {
        workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: SINCE, env: ENV,
        resolveUser: M.makeResolveUser(USERS.map((u) => ({ ...u, accountStatus: 'active' })), () => true, () => false) });
    if (res.recognized !== 4) throw new Error(`siembra inesperada: ${JSON.stringify(res)}`);
    D.closeGamificationDb({ resetBackoff: true });
}
// Derechos: base de regalías sana y vacía (sin retiradas). Sin ella, el servidor
// trata toda obra como retirada (fallo cerrado), igual que el barrido.
{
    const Pub = await import('../../royalties/publishersStore.mjs');
    Pub.getRoyaltiesDb();
    Pub.closeRoyaltiesDb?.();
}
const hashDir = (d) => fs.readdirSync(d).sort().map((f) => `${f}:${crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex')}`).join();

// ── Servidores ────────────────────────────────────────────────────────────────
const ORIGIN = 'https://app.test';
function spawnApi(port, { flags = ENV, harness = true, mode = 'off' } = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''}${harness ? ` --import ${HARNESS}` : ''}`,
            CHP_DATA_DIR: P.data, USERS_DB: P.users, ACCESS_DB: P.access, CONTENT_DB: P.content,
            GROUPS_DB: path.join(P.data, 'groups_db.json'), SCHOOLS_DB: path.join(P.data, 'schools_db.json'),
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'), UPLOADS_ROOT: path.join(tmp, 'uploads'),
            USER_AUDIT_DB: path.join(tmp, 'audit.json'), ACCESS_FALLBACK_MODE: 'restricted',
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'sqlite', `offline-${port}.db`), IDENTITY_DB: path.join(tmp, 'sqlite', `identity-${port}.db`),
            SESSIONS_DB: path.join(tmp, 'sqlite', 'sessions.db'), SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: mode,
            ...(mode !== 'off' ? { IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json' } : {}),
            SESSION_ALLOWED_ORIGINS: ORIGIN, ALLOWED_ORIGINS: ORIGIN,
            EVENTS_SQLITE_PATH: path.join(tmp, 'sqlite', `events-${port}.db`), ARCHIVE_SQLITE_PATH: path.join(tmp, 'sqlite', `archive-${port}.db`),
            INSIGHTS_SQLITE_PATH: path.join(tmp, 'sqlite', `insights-${port}.db`), PROGRESS_SQLITE_PATH: path.join(tmp, 'sqlite', `progress-${port}.db`),
            ROYALTIES_DB: process.env.ROYALTIES_DB,
            GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '', PM_EARNING_ENABLED: '', GAMIFICATION_MOOK_SINCE: '',
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
const get = async (child, url, headers = {}) => {
    const r = await fetch(`${child.base}${url}`, { headers });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch { /* no JSON */ }
    return { status: r.status, body, text, cache: r.headers.get('cache-control') };
};
const as = (u) => ({ 'x-user-id': u });
const workOf = (b, id) => b?.works?.find((w) => w.contentId === id);

const PORT = 5600 + (process.pid % 150) * 2;
const servers = [];
try {
    const on = spawnApi(PORT);
    const locked = spawnApi(PORT + 1, { harness: false });
    const off = spawnApi(PORT + 2, { flags: { GAMIFICATION_ENABLED: '' } });
    const xpOff = spawnApi(PORT + 3, { flags: { ...ENV, XP_EARNING_ENABLED: '' } });
    servers.push(on, locked, off, xpOff);
    await Promise.all(servers.map(healthy));
    const gamBefore = hashDir(P.gamDir);
    const mookBefore = fs.readFileSync(P.mook, 'utf8');

    section('[1] flags');
    {
        const r = await get(off, '/api/me/progress', as('u-30'));
        ok('sin GAMIFICATION_ENABLED ⇒ 404 { error: Not Found }', r.status === 404 && JSON.stringify(r.body) === '{"error":"Not Found"}', r.text);
        const x = await get(xpOff, '/api/me/progress', as('u-30'));
        ok('sin XP_EARNING_ENABLED ⇒ 200 { enabled: false }', x.status === 200 && JSON.stringify(x.body) === '{"enabled":false}', x.text);
        ok('flags apagadas: la base no se crea ni cambia', hashDir(P.gamDir) === gamBefore);
    }

    section('[2] identidad');
    {
        const r = await get(on, '/api/me/progress', as('u-30'));
        ok('sesión válida ⇒ 200 con su progreso (30 XP)', r.status === 200 && r.body?.enabled === true && r.body.xp === 30, r.text);
        ok('Cache-Control: no-store', r.cache === 'no-store');
        const anon = await get(on, '/api/me/progress');
        ok('sin identidad ⇒ 401 sin datos', anon.status === 401 && !('xp' in (anon.body ?? {})));
        const dis = await get(on, '/api/me/progress', as('u-off'));
        ok('usuario desactivado ⇒ 403 sin datos (aunque tenga XP)', dis.status === 403 && !('xp' in (dis.body ?? {})));
        const ghost = await get(on, '/api/me/progress', as('u-no-existe'));
        ok('usuario inexistente ⇒ 403 sin datos', ghost.status === 403 && !('xp' in (ghost.body ?? {})));
    }

    section('[3] IDOR');
    {
        const mine = (await get(on, '/api/me/progress', as('u-30'))).text;
        const q = await get(on, '/api/me/progress?userId=u-50&user=u-50&id=u-50&subject=u-50', as('u-30'));
        ok('query con otro usuario: mismo resultado propio', q.status === 200 && q.text === mine && q.body.xp === 30);
        const route = await get(on, '/api/me/progress/u-50', as('u-30'));
        ok('ruta con id ajeno ⇒ 404, sin datos', route.status === 404 && !/"xp"/.test(route.text));
        const legacyPath = await get(on, '/api/progress/me/u-50', as('u-30'));
        ok('ninguna variante con id expone progreso de gamificación', !/"achievements"/.test(legacyPath.text));
        const post = await fetch(`${on.base}/api/me/progress`, { method: 'POST', headers: { ...as('u-30'), 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'u-50' }) });
        const postText = await post.text();
        ok('cuerpo con userId (POST): sin ruta de escritura, sin datos', post.status === 404 && !/"xp"/.test(postText), `${post.status}`);
        const hdr = await get(on, '/api/me/progress', { ...as('u-30'), 'x-forwarded-user': 'u-50', 'x-subject-id': 'u-50', 'x-on-behalf-of': 'u-50', 'x-original-user-id': 'u-50' });
        ok('cabeceras no confiables con otro usuario: mismo resultado propio', hdr.status === 200 && hdr.text === mine);
        const dup = await fetch(`${on.base}/api/me/progress`, { headers: [['x-user-id', 'u-30'], ['x-user-id', 'u-50']] });
        const dupBody = await dup.json().catch(() => null);
        ok('x-user-id duplicada: nunca devuelve el progreso de u-50', !(dup.status === 200 && dupBody?.xp === 50), `${dup.status} ${JSON.stringify(dupBody)}`);
    }

    section('[4] aislamiento');
    {
        const a = (await get(on, '/api/me/progress', as('u-30'))).body;
        const b = (await get(on, '/api/me/progress', as('u-50'))).body;
        ok('u-30: 30 XP, Brote, obra-a reconocida (1 reflexión)', a.xp === 30 && a.level.id === 'brote' && workOf(a, 'obra-a')?.state === 'recognized' && workOf(a, 'obra-a').reflections === 1);
        ok('u-50: 50 XP, obra-a completa, «mirada-profunda»', b.xp === 50 && workOf(b, 'obra-a')?.state === 'complete' && b.achievements.earned.includes('mirada-profunda'));
        const inst = (await get(on, '/api/me/progress', as('u-instb'))).body;
        ok('otra institución sin reglas: 0 XP, sin obras, 0 elegibles', inst.xp === 0 && inst.works.length === 0 && inst.availability.works === 0 && inst.availability.activities === 0, JSON.stringify(inst));
        const fresh = (await get(on, '/api/me/progress', as('u-new'))).body;
        ok('u-new con acceso: 0 XP, 2 obras y 3 actividades elegibles', fresh.xp === 0 && fresh.availability.works === 2 && fresh.availability.activities === 3, JSON.stringify(fresh.availability));
        ok('acceso real por reglas: elegibles para u-new, no para u-instb', fresh.achievements.next?.id === 'primera-obra' && inst.achievements.next === null);
    }

    section('[5] estados y bloqueo de producción');
    {
        const p = (await get(on, '/api/me/progress', as('u-pending'))).body;
        ok('aprobada sin barrido: pending_recognition y 0 XP', workOf(p, 'obra-b')?.state === 'pending_recognition' && p.xp === 0);
        const lp = (await get(locked, '/api/me/progress', as('u-pending'))).body;
        ok('`mook_review` bloqueada: la misma aprobada ⇒ approved_no_xp', workOf(lp, 'obra-b')?.state === 'approved_no_xp' && lp.xp === 0, JSON.stringify(lp));
        const lf = (await get(locked, '/api/me/progress', as('u-new'))).body;
        ok('`mook_review` bloqueada: catálogo sin actividades elegibles', lf.availability.works === 0 && lf.availability.activities === 0 && lf.achievements.next === null);
        const l30 = (await get(locked, '/api/me/progress', as('u-30'))).body;
        ok('`mook_review` bloqueada: lo ya reconocido se sigue viendo (30 XP)', l30.xp === 30 && workOf(l30, 'obra-a')?.state === 'recognized');
    }

    section('[6] lecturas repetidas sin escrituras');
    {
        const outs = [];
        for (let i = 0; i < 6; i++) outs.push((await get(i % 2 ? locked : on, '/api/me/progress', as('u-50'))).text);
        ok('lecturas repetidas estables (por servidor)', new Set(outs.filter((_, i) => i % 2 === 0)).size === 1 && new Set(outs.filter((_, i) => i % 2 === 1)).size === 1);
        const after = hashDir(P.gamDir);
        const strip = (s) => s.split(',').filter((x) => !/-(wal|shm):/.test(x)).join();
        ok('gamification.db sin cambios (sin contar índices WAL)', strip(after) === strip(gamBefore), `${gamBefore}\n${after}`);
        ok('ningún lock de barrido ni archivo nuevo junto a la base', fs.readdirSync(P.gamDir).every((f) => /^gamification\.db(-wal|-shm)?$/.test(f)), fs.readdirSync(P.gamDir).join());
        ok('mook_db.json sin cambios', fs.readFileSync(P.mook, 'utf8') === mookBefore);
    }

    section('[7] privacidad y errores');
    {
        const bodies = await Promise.all(['u-30', 'u-50', 'u-pending', 'u-new', 'u-instb'].map(async (u) => (await get(on, '/api/me/progress', as(u))).text));
        const all = bodies.join('\n');
        ok('sin claves hex de 64 ni ids de sujeto, hechos o evidencias', !/[0-9a-f]{64}/.test(all) && !/subject|fact|evid-|run-|tombstone|work_key/i.test(all));
        ok('sin datos de otras personas (ids de usuario)', bodies.every((b, i) => !/u-(30|50|pending|new|instb|med|off)/.test(b)), all.slice(0, 300));
        ok('sin motivos internos', !/reason|rejected|excluded|withdrawn|locked|predates|disabled/i.test(all));
        // Registro de exclusiones dañado ⇒ 503 genérico.
        fs.writeFileSync(P.reg, '{"id":"x","t":"abc"');
        const broken = await get(on, '/api/me/progress', as('u-30'));
        fs.writeFileSync(P.reg, '');
        ok('registro dañado ⇒ 503 con mensaje genérico', broken.status === 503 && broken.body?.code === 'PROGRESS_UNAVAILABLE', broken.text);
        ok('el 503 no expone XP, código interno ni traza', !/"xp"|EXCLUSION|REGISTRY|stack|at |\.mjs/.test(broken.text), broken.text);
        ok('el log del servidor registra solo el código, sin usuario', /progreso no disponible: EXCLUSION_REGISTRY_UNAVAILABLE/.test(on.logs())
            && !/progreso no disponible[^\n]*u-30/.test(on.logs()));
    }

    section('[8] sesión firmada (POSIX, enforce)');
    if (!POSIX) {
        console.log('  - SKIP en Windows: la clave de sesión exige semántica POSIX (0400/uid). Corre en CI (Linux).');
    } else {
        const enf = spawnApi(PORT + 4, { mode: 'enforce' });
        servers.push(enf);
        await healthy(enf);
        const login = async (email) => {
            const r = await fetch(`${enf.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }) });
            const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
            return m ? m[1] : null;
        };
        const tok = await login('u-30@fx.test');
        ok('login de lector sintético', !!tok);
        const mine = await get(enf, '/api/me/progress', { cookie: `chp_session=${tok}` });
        ok('sesión válida ⇒ 200, su progreso (30 XP)', mine.status === 200 && mine.body?.xp === 30, mine.text);
        ok('sin sesión ⇒ 401', (await get(enf, '/api/me/progress')).status === 401);
        ok('solo cabecera legada (enforce) ⇒ 401', (await get(enf, '/api/me/progress', as('u-30'))).status === 401);
        const spoof = await get(enf, '/api/me/progress', { cookie: `chp_session=${tok}`, 'x-user-id': 'u-50' });
        ok('sesión de u-30 + x-user-id u-50 ⇒ nunca 50 XP', !(spoof.status === 200 && spoof.body?.xp === 50), spoof.text);
        ok('sesión de u-30 + x-user-id u-50 ⇒ rechazada o propia', spoof.status === 401 || spoof.status === 403 || spoof.body?.xp === 30, `${spoof.status}`);
        const payload = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString('utf8'));
        const now = Math.floor(Date.now() / 1000);
        const expired = signSessionToken({ ...payload, iat: now - 7200, exp: now - 60 }, fs.readFileSync(P.key, 'utf8'));
        const exp = await get(enf, '/api/me/progress', { cookie: `chp_session=${expired}` });
        ok('sesión expirada (firma válida) ⇒ 401 sin datos', exp.status === 401 && !/"xp"/.test(exp.text), `${exp.status}`);
        const forged = signSessionToken({ ...payload, sub: 'u-50' }, crypto.randomBytes(48).toString('hex'));
        ok('token con otra clave ⇒ 401', (await get(enf, '/api/me/progress', { cookie: `chp_session=${forged}` })).status === 401);
        // Desactivación: la sesión ya emitida deja de servir.
        const tok50 = await login('u-50@fx.test');
        ok('u-50 entra', (await get(enf, '/api/me/progress', { cookie: `chp_session=${tok50}` })).body?.xp === 50);
        const roster = JSON.parse(fs.readFileSync(P.users, 'utf8'));
        roster.find((u) => u.id === 'u-50').accountStatus = 'disabled';
        fs.writeFileSync(P.users, JSON.stringify(roster));
        await sleep(300);
        const gone = await get(enf, '/api/me/progress', { cookie: `chp_session=${tok50}` });
        ok('usuario desactivado tras el login ⇒ 401 sin datos', gone.status === 401 && !/"xp"/.test(gone.text), `${gone.status} ${gone.text}`);
    }
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    await sleep(500);
    D.closeGamificationDb({ resetBackoff: true });
    const diff = Object.entries(realFingerprint()).filter(([k, v]) => realBefore[k] !== v).map(([k]) => k);
    ok('stores reales intactos (data/, data-critical/)', diff.length === 0 && Object.keys(realBefore).every((k) => fs.existsSync(path.join(REPO, k))), diff.join());
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows: archivos aún abiertos */ }
}

console.log(`\nmy progress HTTP (G4-UX-U2): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
