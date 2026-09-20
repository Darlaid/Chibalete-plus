/**
 * resetRequestNoTokenDisclosure.test.mjs — CHP-SEC-PASSWORD-RESET-01.
 *
 * Demuestra que el endpoint PÚBLICO de recuperación de contraseña:
 *   - no devuelve token de reset, ni URL con token, ni identificadores;
 *   - responde EXACTAMENTE igual exista o no la cuenta, sea admin o lector (anti-oracle);
 *   - no emite ningún token utilizable: no escribe resetToken en el almacén;
 *   - no modifica la contraseña de nadie.
 * Y que el flujo administrativo de INVITACIÓN/ACTIVACIÓN sigue intacto (separación).
 *
 * Usa un almacén temporal de fixtures: NUNCA toca datos productivos. POSIX-only.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
if (process.platform === 'win32') { console.log('resetRequestNoTokenDisclosure: SKIP (POSIX-only)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_resetsec_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json', progress: tmp + '/p.json', identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key' };
fs.mkdirSync(P.uploads, { recursive: true });

const PW = 'contrasena-fixture';
const HASH_LECTOR = bcrypt.hashSync(PW, 4);
const HASH_ADMIN = bcrypt.hashSync(PW, 4);
const INVITE_TOKEN = 'token-de-invitacion-de-fixture-0123456789';

// Fixtures: nada de correos productivos reales.
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'LECTOR', email: 'lector@fixture.invalid', nombre_completo: 'Lector Fixture', password: HASH_LECTOR, roles: ['lector'], accountStatus: 'active' },
    { id: 'ADMIN', email: 'admin@fixture.invalid', nombre_completo: 'Admin Fixture', password: HASH_ADMIN, roles: ['administrador'], accountStatus: 'active' },
    { id: 'INVITADO', email: 'invitado@fixture.invalid', nombre_completo: 'Invitado Fixture', roles: ['lector'], accountStatus: 'invited', inviteToken: INVITE_TOKEN, inviteExpiresAt: Date.now() + 3600000 },
]));
fs.writeFileSync(P.groups, '[]'); fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, JSON.stringify([{ id: 't1', title: 'T' }]));
fs.writeFileSync(P.progress, '{"progressMap":{}}');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const PORT = 4610 + (process.pid % 80); const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: tmp + '/data',
    USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
    CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
    USER_AUDIT_DB: tmp + '/au.json', IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
    SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
    ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce',
} });
let boot = ''; child.stdout.on('data', d => boot += d); child.stderr.on('data', d => boot += d);

const post = async (ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo JSON */ }
    return { status: r.status, body: j };
};
const leerUsuarios = () => JSON.parse(fs.readFileSync(P.users, 'utf8'));

const arrancado = async () => { for (let i = 0; i < 100; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return true; } catch { /* aún no */ } await sleep(150); } return false; };

try {
    if (!await arrancado()) { console.error('El servidor no arrancó:\n' + boot.slice(-2000)); process.exit(1); }

    const antes = leerUsuarios();
    const passAntes = Object.fromEntries(antes.map(u => [u.id, u.password]));

    // --- A) correo existente (lector activo) ---
    const A = await post('/api/auth/reset-request', { email: 'lector@fixture.invalid' });
    // --- B) correo inexistente ---
    const B = await post('/api/auth/reset-request', { email: 'no-existe@fixture.invalid' });
    // --- C) cuenta admin de fixture ---
    const C = await post('/api/auth/reset-request', { email: 'admin@fixture.invalid' });
    // --- D) entrada inválida ---
    const D1 = await post('/api/auth/reset-request', {});
    const D2 = await post('/api/auth/reset-request', { email: 'esto-no-es-un-correo' });

    console.log('CHP-SEC-PASSWORD-RESET-01 — contrato del endpoint público');

    // Mismo status para A, B y C.
    ok('A/B/C devuelven el mismo status', A.status === B.status && B.status === C.status, `A=${A.status} B=${B.status} C=${C.status}`);
    ok('el status es 202', A.status === 202, `recibido ${A.status}`);

    // Mismo cuerpo exacto: es la prueba anti-oracle más fuerte.
    const sA = JSON.stringify(A.body), sB = JSON.stringify(B.body), sC = JSON.stringify(C.body);
    ok('A/B/C devuelven un cuerpo idéntico', sA === sB && sB === sC, `A=${sA} B=${sB} C=${sC}`);

    // Sin token ni identidad en ninguna respuesta.
    const prohibido = ['resetToken', 'resetUrl', 'resetExpiresAt', 'token', 'userId', 'id', 'email', 'accountStatus', 'roles'];
    for (const [etiqueta, r] of [['A', A], ['B', B], ['C', C]]) {
        const claves = Object.keys(r.body || {});
        const filtradas = claves.filter(k => prohibido.includes(k));
        ok(`${etiqueta}: la respuesta no expone claves sensibles`, filtradas.length === 0, `claves=${claves.join(',')}`);
        ok(`${etiqueta}: el cuerpo serializado no contiene ningún token`, !/[0-9a-f]{32,}/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    }

    // No se emite ningún token utilizable.
    const despues = leerUsuarios();
    ok('ningún usuario recibió resetToken', despues.every(u => !u.resetToken), 'se escribió un resetToken en el almacén');
    ok('ningún usuario recibió resetExpiresAt', despues.every(u => !u.resetExpiresAt));

    // No se modifica ninguna contraseña.
    ok('las contraseñas no cambiaron', despues.every(u => u.password === passAntes[u.id]));

    // D) entrada inválida: se rechaza, y sin filtrar nada.
    ok('D1 (sin email) se rechaza con 4xx', D1.status >= 400 && D1.status < 500, `status=${D1.status}`);
    // Un correo mal formado NO debe distinguirse de uno inexistente: mismo contrato.
    // Devolver un error de formato aquí sería un oráculo más débil pero oráculo al fin.
    ok('D2 (email mal formado) recibe el MISMO contrato que A/B/C', D2.status === A.status && JSON.stringify(D2.body) === sA, `status=${D2.status} body=${JSON.stringify(D2.body)}`);
    ok('D no expone token', !/[0-9a-f]{32,}/i.test(JSON.stringify(D1.body) + JSON.stringify(D2.body)));

    // Ruta legacy: mismo contrato.
    const L = await post('/api/request-password-reset', { email: 'lector@fixture.invalid' });
    ok('la ruta legacy respeta el mismo contrato', L.status === A.status && JSON.stringify(L.body) === sA, `status=${L.status} body=${JSON.stringify(L.body)}`);

    // --- SEPARACIÓN: la invitación/activación NO se rompe (Fase E) ---
    console.log('CHP-SEC-PASSWORD-RESET-01 — separación con invitación/activación');
    const act = await post('/api/accept-invite', { token: INVITE_TOKEN, password: 'contrasena-nueva-1' });
    ok('accept-invite sigue activando al invitado', act.status === 200, `status=${act.status} body=${JSON.stringify(act.body)}`);
    const trasActivar = leerUsuarios().find(u => u.id === 'INVITADO');
    ok('el invitado queda activo', trasActivar && trasActivar.accountStatus === 'active', `status=${trasActivar && trasActivar.accountStatus}`);
    ok('el inviteToken se consume', trasActivar && !trasActivar.inviteToken);
    ok('el invitado tiene contraseña tras activar', !!(trasActivar && trasActivar.password));

    // Un token de invitación NO sirve como token de reset y viceversa.
    const cruce = await post('/api/auth/reset-confirm', { token: INVITE_TOKEN, password: 'otra-contrasena-2' });
    ok('un inviteToken no sirve para confirmar un reset', cruce.status >= 400, `status=${cruce.status}`);

    console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
} finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* limpieza best-effort */ }
}
process.exit(fail === 0 ? 0 : 1);
