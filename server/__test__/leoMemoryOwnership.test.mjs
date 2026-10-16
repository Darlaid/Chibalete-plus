/**
 * leoMemoryOwnership.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.5-S1.
 *
 * GET/POST /api/leo/memory/:userId/:contentId solo exigían una identidad
 * válida (requireUserAuth): el :userId del path nunca se comparaba con ella,
 * así que cualquier sesión leía o sobrescribía la memoria Leo de otro lector.
 * Contrato definitivo: OWNER-ONLY en lectura y escritura.
 *   - dueño → 200 (GET y POST);
 *   - otro lector, mediador de su grupo, administrador → 403 (GET y POST);
 *   - sin identidad → 401;
 *   - todo 401/403: sin memoria en la respuesta, sin escritura, sin claves
 *     nuevas, store byte-idéntico.
 *
 * Parte 1 (todas las plataformas): SESSION_AUTH_MODE=off, x-user-id.
 * Parte 2 (POSIX): SESSION_AUTH_MODE=compat con cookie real tras login; prueba
 * que el sujeto del handler sale de la cookie (sin x-user-id) — el gate real.
 * Servidores REALES sobre stores temporales; nunca datos productivos.
 *
 *   node server/__test__/leoMemoryOwnership.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const C1 = 'content-alicia';
const PASS = crypto.randomBytes(9).toString('base64url');
const HASH = bcrypt.hashSync(PASS, 4);
const ORG = 'school-fx';
const USERS = [
    { id: 'ADM', email: 'adm@fx.test', password: HASH, roles: ['administrador'], accountStatus: 'active' },
    { id: 'MED', email: 'med@fx.test', password: HASH, roles: ['mediador'], mediatorKind: 'teacher', organizationId: ORG, colegio: 'Colegio FX', accountStatus: 'active', groupIds: ['G1'] },
    { id: 'OWN', email: 'own@fx.test', password: HASH, roles: ['lector'], organizationId: ORG, colegio: 'Colegio FX', accountStatus: 'active', groupIds: ['G1'] },
    { id: 'OTHER', email: 'other@fx.test', password: HASH, roles: ['lector'], organizationId: ORG, colegio: 'Colegio FX', accountStatus: 'active', groupIds: ['G1'] },
];
const GROUPS = [{ id: 'G1', name: 'Grado FX', type: 'course', organizationId: ORG, school: 'Colegio FX', memberIds: ['OWN', 'OTHER'], studentIds: ['OWN', 'OTHER'], mediatorIds: ['MED'] }];

function makeStores(tag) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `chp_leomem_${tag}_`));
    const P = { tmp, data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json') };
    fs.mkdirSync(P.data, { recursive: true });
    fs.writeFileSync(P.users, JSON.stringify(USERS));
    fs.writeFileSync(P.content, JSON.stringify([{ id: C1, titulo: 'Alicia', tipo: 'libro' }]));
    fs.writeFileSync(P.access, '[]');
    fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
    fs.writeFileSync(path.join(tmp, 'schools.json'), JSON.stringify([{ id: ORG, name: 'Colegio FX' }]));
    P.leo = path.join(P.data, 'leo_memory_db.json');
    return P;
}
function start(P, port, extra = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: path.join(P.tmp, 'schools.json'),
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(P.tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted',
            USER_AUDIT_DB: path.join(P.tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(P.tmp, 'progress.db'),
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock', ...extra,
        },
    });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', d => { s.out += d; });
    child.stderr.on('data', d => { s.out += d; });
    return s;
}
const ready = async (s) => {
    for (let i = 0; i < 600; i++) {
        if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`);
        if (/Server running on port/.test(s.out)) return;
        await sleep(200);
    }
    throw new Error(`server no arrancó\n${s.out.slice(-1500)}`);
};
const req = async (s, p, { method = 'GET', headers = {}, body } = {}) => {
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const storeBytes = (P) => (fs.existsSync(P.leo) ? fs.readFileSync(P.leo, 'utf8') : null);
const M = `/api/leo/memory/OWN/${C1}`;
const SECRET_MARK = 'marca-privada-del-dueno';

/**
 * Cada rechazo: status esperado, respuesta sin memoria ni la marca privada,
 * store byte-idéntico (no escribe, no crea claves).
 */
async function expectDenied(S, P, label, status, opts) {
    const before = storeBytes(P);
    const r = await req(S, opts.path ?? M, opts);
    ok(`${label} → ${status}`, r.status === status, `${r.status} ${r.text.slice(0, 200)}`);
    ok(`${label} … sin memoria en la respuesta`, r.json?.memory === undefined && !r.text.includes(SECRET_MARK), r.text.slice(0, 200));
    ok(`${label} … store byte-idéntico`, storeBytes(P) === before);
}

async function runContract(S, P, as, tag) {
    const w = await req(S, M, { method: 'POST', headers: as('OWN'), body: { lastQuestionType: SECRET_MARK } });
    ok(`${tag} A. dueño POST → 200`, w.status === 200 && w.json?.success === true, w.text.slice(0, 200));
    const r = await req(S, M, { headers: as('OWN') });
    ok(`${tag} A. dueño GET → 200 con lo escrito`, r.status === 200 && r.json?.memory?.lastQuestionType === SECRET_MARK, r.text.slice(0, 200));
    const keysBefore = Object.keys(JSON.parse(storeBytes(P)).memoryMap);
    for (const [who, role] of [['OTHER', 'B. otro lector'], ['MED', 'C. mediador del mismo grupo'], ['ADM', 'D. administrador']]) {
        await expectDenied(S, P, `${tag} ${role} GET memoria ajena`, 403, { headers: as(who) });
        await expectDenied(S, P, `${tag} ${role} POST memoria ajena`, 403, { method: 'POST', headers: as(who), body: { lastQuestionType: 'pisado' } });
    }
    await expectDenied(S, P, `${tag} B. POST al path de otro sujeto (sin crear clave)`, 403, { path: `/api/leo/memory/OTHER/${C1}`, method: 'POST', headers: as('OWN'), body: { a: 1 } });
    await expectDenied(S, P, `${tag} E. sin sesión GET`, 401, {});
    await expectDenied(S, P, `${tag} E. sin sesión POST`, 401, { method: 'POST', body: { a: 1 } });
    ok(`${tag} ninguna clave nueva tras los rechazos`, JSON.stringify(Object.keys(JSON.parse(storeBytes(P)).memoryMap)) === JSON.stringify(keysBefore));
}

// ── Parte 1: x-user-id (modo off) ───────────────────────────────────────────
{
    console.log('[1] modo off (x-user-id) — memoria Leo OWNER-ONLY');
    const P = makeStores('off');
    const S = start(P, 6100 + (process.pid % 50), { SESSION_AUTH_MODE: 'off' });
    try {
        await ready(S);
        await runContract(S, P, (u) => ({ 'x-user-id': u }), '[off]');
    } catch (e) { ok('arnés parte 1', false, e.stack || e.message); }
    finally { S.child.kill(); await sleep(300); fs.rmSync(P.tmp, { recursive: true, force: true }); }
}

// ── Parte 2: cookie de sesión real (compat) ─────────────────────────────────
if (process.platform === 'win32') {
    console.log('\n[2] compat con cookie: SKIP en win32 (secretos de sesión POSIX-only)');
} else {
    console.log('\n[2] modo compat — cookie de sesión real, el navegador NO envía x-user-id');
    const P = makeStores('compat');
    const key = path.join(P.tmp, 'session_key');
    fs.writeFileSync(key, crypto.randomBytes(48).toString('hex'));
    fs.chmodSync(key, 0o400);
    const S = start(P, 6160 + (process.pid % 30), {
        SESSION_AUTH_MODE: 'compat', SESSIONS_DB: path.join(P.tmp, 'sessions.db'), IDENTITY_DB: path.join(P.tmp, 'identity.db'),
        SESSION_KEY_CURRENT_PATH: key, SESSION_KEY_PREVIOUS_PATH: `${key}.prev`, ALLOWED_ORIGINS: 'http://fx.test',
    });
    const login = async (email) => {
        const r = await fetch(`${S.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
        return (r.headers.get('set-cookie') || '').split(';')[0];
    };
    try {
        await ready(S);
        const cookies = {};
        for (const u of USERS) cookies[u.id] = await login(u.email);
        ok('login emite cookie de sesión para los 4 sujetos', Object.values(cookies).every(c => /^chp_session=./.test(c)), JSON.stringify(Object.keys(cookies)));
        // Solo cookie: ningún x-user-id viaja; el sujeto del handler sale de la sesión.
        const ck = (u) => ({ cookie: cookies[u], 'sec-fetch-site': 'same-origin' });
        await runContract(S, P, ck, '[cookie]');
        const own = await req(S, `/api/leo/memory/OTHER/${C1}`, { method: 'POST', headers: ck('OTHER'), body: { lastQuestionType: 'propia-de-other' } });
        ok('[cookie] el sujeto es el de la cookie: OTHER escribe SU memoria → 200', own.status === 200);
        const keys = Object.keys(JSON.parse(storeBytes(P)).memoryMap).sort();
        ok('[cookie] … y solo existen las claves de los dueños que escribieron', JSON.stringify(keys) === JSON.stringify([`OTHER__${C1}`, `OWN__${C1}`].sort()), keys.join(','));
        await expectDenied(S, P, '[cookie] cookie OWN + x-user-id OTHER (divergente)', 401, { headers: { ...ck('OWN'), 'x-user-id': 'OTHER' } });
        await expectDenied(S, P, '[cookie] cookie OTHER + x-user-id OWN (no suplanta)', 401, { method: 'POST', headers: { ...ck('OTHER'), 'x-user-id': 'OWN' }, body: { a: 1 } });
        await expectDenied(S, P, '[cookie] cookie inválida', 401, { headers: { cookie: 'chp_session=forjada', 'sec-fetch-site': 'same-origin' } });
    } catch (e) { ok('arnés parte 2', false, e.stack || e.message); }
    finally { S.child.kill(); await sleep(300); fs.rmSync(P.tmp, { recursive: true, force: true }); }
}

console.log(`\nleoMemoryOwnership — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
