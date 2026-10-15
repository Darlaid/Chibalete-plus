/**
 * progressReadIdentity.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.5 / 3D.4.
 *
 * Producción (2026-10-15): con sesión por COOKIE, GET /api/progress/item/:u/:c
 * y GET /api/progress/user/:u devolvían 403 «requester=none» al propio dueño:
 * usaban resolveRequester (solo x-user-id), mientras POST …/sync autentica la
 * sesión. Fix: misma identidad (authenticatedUserIdOf) + para el dueño no
 * privilegiado, la misma autoridad de acceso al título (decideContentAccess).
 *
 * Parte 1 (todas las plataformas): SESSION_AUTH_MODE=off, x-user-id.
 * Parte 2 (POSIX): SESSION_AUTH_MODE=compat con cookie real tras login
 * (los secretos de sesión exigen uid/modo 0400 → no corre en win32).
 * Servidores REALES sobre stores temporales; nunca datos productivos.
 *
 *   node server/__test__/progressReadIdentity.test.mjs
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

const C1 = 'content-alicia', C2 = 'content-otro';
const now = Date.now();
const PASS = crypto.randomBytes(9).toString('base64url');
const HASH = bcrypt.hashSync(PASS, 4);
const USERS = [
    { id: 'ADM', email: 'adm@fx.test', password: HASH, roles: ['administrador'], accountStatus: 'active' },
    { id: 'MED', email: 'med@fx.test', password: HASH, roles: ['mediador'], accountStatus: 'active' },
    { id: 'OWN', email: 'own@fx.test', password: HASH, roles: ['lector'], accountStatus: 'active' },
    { id: 'OTHER', email: 'other@fx.test', password: HASH, roles: ['lector'], accountStatus: 'active' },
    { id: 'MEM', email: 'mem@fx.test', password: HASH, roles: ['lector'], accountStatus: 'active' },
    { id: 'EXP', email: 'exp@fx.test', password: HASH, roles: ['lector'], accountStatus: 'active' },
    { id: 'NOACC', email: 'noacc@fx.test', password: HASH, roles: ['lector'], accountStatus: 'active' },
];
const ACCESS = [
    { id: 'r-own', scope: 'user', scopeId: 'OWN', titleIds: [C1], collectionIds: [], expiresAt: now + 86400000 },
    { id: 'r-other', scope: 'user', scopeId: 'OTHER', titleIds: [C2], collectionIds: [], expiresAt: now + 86400000 },
    { id: 'r-noacc', scope: 'user', scopeId: 'NOACC', titleIds: [C2], collectionIds: [], expiresAt: now + 86400000 },
    { id: 'r-group', scope: 'group', scopeId: 'G1', titleIds: [C1], collectionIds: [] },
    { id: 'r-exp', scope: 'user', scopeId: 'EXP', titleIds: [C1], collectionIds: [], expiresAt: now - 1000 },
];
const CONTENT = [{ id: C1, titulo: 'Alicia', tipo: 'libro' }, { id: C2, titulo: 'Otro', tipo: 'libro' }];

function makeStores(tag) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `chp_prog_${tag}_`));
    const P = { tmp, data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json') };
    fs.mkdirSync(P.data, { recursive: true });
    fs.writeFileSync(P.users, JSON.stringify(USERS));
    fs.writeFileSync(P.content, JSON.stringify(CONTENT));
    fs.writeFileSync(P.access, JSON.stringify(ACCESS));
    fs.writeFileSync(P.groups, JSON.stringify([{ id: 'G1', name: 'Club', type: 'club', memberIds: ['MEM'], mediatorIds: [] }]));
    fs.writeFileSync(path.join(tmp, 'schools.json'), '[]');
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
    for (let i = 0; i < 200; i++) {
        if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`);
        if (/Server running on port/.test(s.out)) return;
        await sleep(200);
    }
    throw new Error('server no arrancó');
};
const req = async (s, p, { method = 'GET', headers = {}, body } = {}) => {
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* */ }
    return { status: r.status, json, headers: r.headers };
};
const syncBody = { canonicalProgress: { percentage: 12, readerMode: 'text' }, updatedAt: new Date().toISOString() };

// ── Parte 1: semántica de autorización (x-user-id, modo off) ─────────────────
{
    console.log('[1] modo off (x-user-id) — autoridad de identidad + acceso');
    const P = makeStores('off');
    const S = start(P, 5900 + (process.pid % 50), { SESSION_AUTH_MODE: 'off' });
    try {
        await ready(S);
        const as = (u) => ({ headers: { 'x-user-id': u } });
        ok('H. POST sync del dueño → 200 (sin regresión)', (await req(S, `/api/progress/OWN/${C1}/sync`, { method: 'POST', body: syncBody, ...as('OWN') })).status === 200);
        ok('H. POST sync de otro usuario → 401 (sin regresión)', (await req(S, `/api/progress/OWN/${C1}/sync`, { method: 'POST', body: syncBody, ...as('OTHER') })).status === 401);
        const a = await req(S, `/api/progress/item/OWN/${C1}`, as('OWN'));
        ok('A/C. dueño con grant del título → 200 y lee su progreso', a.status === 200 && a.json?.success === true, JSON.stringify(a.json));
        ok('B. requester ajeno (lector) → 403', (await req(S, `/api/progress/item/OWN/${C1}`, as('OTHER'))).status === 403);
        ok('D. dueño sin acceso al título → 403', (await req(S, `/api/progress/item/NOACC/${C1}`, as('NOACC'))).status === 403);
        ok('D. … el mismo dueño con su título permitido → 200', (await req(S, `/api/progress/item/NOACC/${C2}`, as('NOACC'))).status === 200);
        ok('E. admin lee el progreso de otro → 200', (await req(S, `/api/progress/item/OWN/${C1}`, as('ADM'))).status === 200);
        ok('E. mediador lee el progreso de otro → 200 (sin regresión)', (await req(S, `/api/progress/item/OWN/${C1}`, as('MED'))).status === 200);
        ok('F. membresía de grupo vigente → 200', (await req(S, `/api/progress/item/MEM/${C1}`, as('MEM'))).status === 200);
        ok('G. grant vencido → 403', (await req(S, `/api/progress/item/EXP/${C1}`, as('EXP'))).status === 403);
        ok('sin identidad → 403', (await req(S, `/api/progress/item/OWN/${C1}`)).status === 403);
        const u = await req(S, '/api/progress/user/OWN', as('OWN'));
        ok('I. GET progress/user del dueño → 200', u.status === 200 && u.json?.success === true);
        ok('I. GET progress/user de otro lector → 403', (await req(S, '/api/progress/user/OWN', as('OTHER'))).status === 403);
        ok('I. GET progress/user como admin → 200', (await req(S, '/api/progress/user/OWN', as('ADM'))).status === 200);
        const acc = await req(S, `/api/content/${C1}/access?userId=OWN`, as('OWN'));
        ok('/api/content/:id/access sin regresión (grant → allowed)', acc.status === 200 && acc.json?.allowed === true);
    } catch (e) { ok('arnés parte 1', false, e.stack || e.message); }
    finally { S.child.kill(); await sleep(300); fs.rmSync(P.tmp, { recursive: true, force: true }); }
}

// ── Parte 2: cookie de sesión real (compat) — el bug de producción ──────────
if (process.platform === 'win32') {
    console.log('\n[2] compat con cookie: SKIP en win32 (secretos de sesión POSIX-only)');
} else {
    console.log('\n[2] modo compat — cookie de sesión real, el navegador NO envía x-user-id');
    const P = makeStores('compat');
    const key = path.join(P.tmp, 'session_key');
    fs.writeFileSync(key, crypto.randomBytes(48).toString('hex'));
    fs.chmodSync(key, 0o400);
    const S = start(P, 5960 + (process.pid % 30), {
        SESSION_AUTH_MODE: 'compat', SESSIONS_DB: path.join(P.tmp, 'sessions.db'), IDENTITY_DB: path.join(P.tmp, 'identity.db'),
        SESSION_KEY_CURRENT_PATH: key, SESSION_KEY_PREVIOUS_PATH: `${key}.prev`, ALLOWED_ORIGINS: 'http://fx.test',
    });
    const login = async (email) => {
        const r = await fetch(`${S.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASS }) });
        const set = r.headers.get('set-cookie') || '';
        return { status: r.status, cookie: set.split(';')[0] };
    };
    try {
        await ready(S);
        const own = await login('own@fx.test');
        ok('login del dueño emite cookie de sesión', own.status === 200 && /=/.test(own.cookie), own.status);
        const ck = (c) => ({ headers: { cookie: c, 'sec-fetch-site': 'same-origin' } });
        const me = await req(S, '/api/auth/me', ck(own.cookie));
        ok('/api/auth/me con cookie → OWN', me.status === 200 && me.json?.id === 'OWN');
        ok('H. POST sync con cookie → 200', (await req(S, `/api/progress/OWN/${C1}/sync`, { method: 'POST', body: syncBody, ...ck(own.cookie) })).status === 200);
        const item = await req(S, `/api/progress/item/OWN/${C1}`, ck(own.cookie));
        ok('BUG: GET progress/item SOLO con cookie → 200 (antes 403 requester=none)', item.status === 200 && item.json?.success === true, JSON.stringify(item.json));
        ok('… y devuelve lo sincronizado', item.json?.progress != null, JSON.stringify(item.json));
        ok('BUG: GET progress/user SOLO con cookie → 200', (await req(S, '/api/progress/user/OWN', ck(own.cookie))).status === 200);
        const other = await login('other@fx.test');
        ok('cookie de OTRO lector → 403 en item y user', (await req(S, `/api/progress/item/OWN/${C1}`, ck(other.cookie))).status === 403 && (await req(S, '/api/progress/user/OWN', ck(other.cookie))).status === 403);
        const noacc = await login('noacc@fx.test');
        ok('cookie del dueño sin acceso al título → 403', (await req(S, `/api/progress/item/NOACC/${C1}`, ck(noacc.cookie))).status === 403);
        const adm = await login('adm@fx.test');
        ok('cookie de admin → 200', (await req(S, `/api/progress/item/OWN/${C1}`, ck(adm.cookie))).status === 200);
        ok('sin cookie ni x-user-id → 403', (await req(S, `/api/progress/item/OWN/${C1}`)).status === 403);
        ok('compat: x-user-id legacy sigue admitido (sin regresión)', (await req(S, `/api/progress/item/OWN/${C1}`, { headers: { 'x-user-id': 'OWN' } })).status === 200);
        ok('cookie + x-user-id divergente → 403 (subject_mismatch)', (await req(S, `/api/progress/item/OWN/${C1}`, { headers: { cookie: own.cookie, 'x-user-id': 'OTHER' } })).status === 403);
    } catch (e) { ok('arnés parte 2', false, e.stack || e.message); }
    finally { S.child.kill(); await sleep(300); fs.rmSync(P.tmp, { recursive: true, force: true }); }
}

console.log(`\nprogressReadIdentity — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
