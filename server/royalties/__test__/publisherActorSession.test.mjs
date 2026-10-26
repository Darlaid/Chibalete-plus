/**
 * publisherActorSession.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-B (EDITORIALES-03).
 *
 * Regresión del defecto hallado en navegador: con sesión firmada (cookie,
 * SESSION_AUTH_MODE=enforce, como en producción) el actor de los cambios de
 * editorial hechos por POST /api/content quedaba como 'admin-secret', porque
 * requireAdminRole deja la identidad en req.user y no en req.auth. Las demás
 * suites usan x-user-id con la autenticación apagada y no lo veían.
 *
 *   node server/royalties/__test__/publisherActorSession.test.mjs   (POSIX: clave 0400)
 */
import '../../__test__/helpers/testMode.mjs';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
    console.log('publisherActorSession — SKIP (POSIX-only: clave de sesión 0400)');
    process.exit(0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB);

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CH = 'pub-chibalete-editores';
const PW = 'fixture-pass-f1b-actor';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f1b_actor_'));
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'), offline: path.join(tmp, 'offline.db'), sessions: path.join(tmp, 'sessions.db'),
    key: path.join(tmp, 'session_signing_key'), audit: path.join(tmp, 'user_audit.json'), royalties: path.join(tmp, 'rdb', 'royalties.db'),
    uploads: path.join(tmp, 'uploads'), data: path.join(tmp, 'data'),
};
fs.mkdirSync(P.uploads, { recursive: true });
fs.mkdirSync(P.data, { recursive: true });
const hash = bcrypt.hashSync(PW, 4);
fs.writeFileSync(P.users, JSON.stringify(['ADM:administrador', 'MED:mediador'].map((s) => {
    const [id, role] = s.split(':');
    return { id, email: `${id.toLowerCase()}@fx.test`, password: hash, roles: [role], accountStatus: 'active', nombre_completo: id };
})));
for (const f of [P.groups, P.schools]) fs.writeFileSync(f, '[]');
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));
const BOOK = { id: 'content-b1', titulo: 'Libro', autor: 'A', tipo: 'libro', editorial: 'Chibalete', etiquetas: [], status: 'disponible', descripcion_corta: 'd', portada_url: '', publisherId: CH };
fs.writeFileSync(P.content, JSON.stringify([BOOK], null, 2));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

const PORT = 6600 + (process.pid % 200);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, ACCESS_FALLBACK_MODE: 'restricted',
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: P.audit, ROYALTIES_DB: P.royalties,
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let boot = '';
child.stdout.on('data', (d) => { boot += d; });
child.stderr.on('data', (d) => { boot += d; });

const login = async (id) => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${id.toLowerCase()}@fx.test`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id} → ${r.status}`);
    return `chp_session=${m[1]}`;
};
const send = async (method, url, cookie, body, extra = {}) => {
    const r = await fetch(`${base}${url}`, {
        method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: j };
};
const rec = () => JSON.parse(fs.readFileSync(P.content, 'utf8')).find((c) => c.id === BOOK.id);

try {
    let healthy = false;
    for (let i = 0; i < 200 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(300);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
    const adm = await login('ADM');

    const pub = await send('POST', '/api/admin/publishers', adm, { kind: 'editorial', legalName: 'Editorial de prueba' });
    ok('alta de editorial con sesión', pub.status === 201, JSON.stringify(pub.body));
    // x-user-id distinto de la sesión: enforce lo rechaza y no cambia nada.
    const spoof = await send('POST', '/api/content', adm, { ...BOOK, publisherId: pub.body.id, publisherReassignConfirmed: true }, { 'x-user-id': 'MED' });
    ok('x-user-id incoherente con la sesión → 401 y sin cambios', spoof.status === 401 && rec().publisherId === CH);
    await sleep(2100);
    const r = await send('POST', '/api/content', adm, { ...BOOK, publisherId: pub.body.id, publisherReassignConfirmed: true });
    ok('reasignación con sesión → 200', r.status === 200 && rec().publisherId === pub.body.id, JSON.stringify(r.body));
    await sleep(500);

    const db = new Database(P.royalties, { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT actor, from_publisher_id, to_publisher_id FROM content_publisher_history').all();
    db.close();
    ok('historial: actor = usuario de la sesión (no admin-secret)', rows.length === 1 && rows[0].actor === 'ADM' && rows[0].from_publisher_id === CH, JSON.stringify(rows));
    const audit = fs.existsSync(P.audit) ? JSON.parse(fs.readFileSync(P.audit, 'utf8')) : [];
    const change = audit.find((e) => e.action === 'content_publisher_change');
    ok('user_audit content_publisher_change: actor = ADM', change?.actor === 'ADM', JSON.stringify(change));
    ok('user_audit publisher_create: actor = ADM', audit.find((e) => e.action === 'publisher_create')?.actor === 'ADM');
    ok('ninguna entrada con actor admin-secret', !audit.some((e) => e.actor === 'admin-secret'));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\npublisherActorSession — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
