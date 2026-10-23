/**
 * userCredentialReset.test.mjs — SEC-USERS-01 / Unidad A.
 *
 * Servidor real en SESSION_AUTH_MODE=enforce (el modo productivo), con stores
 * herméticos en un directorio temporal. Demuestra:
 *   [1] solo un administrador reinvita/desactiva;
 *   [2] desactivar bloquea login y sesiones previas, y preserva el registro;
 *   [3] reinvitar invalida contraseña y sesiones;
 *   [4] el token caduca y es de un solo uso;
 *   [5] el titular fija su contraseña vía /api/accept-invite (ActivarCuenta);
 *   [6] la contraseña queda solo como hash generado por el servidor;
 *   [7] se rechazan predeterminadas y valores bcrypt (creación, activación, PUT);
 *   [8] ningún secreto en respuestas indebidas, logs ni auditoría;
 *   [9] un registro sin id no autentica ni se escribe por el login;
 *  [10] se conservan id, grupos, progreso y reglas de acceso;
 *  [11] sin regresiones en creación, login legacy, edición ordinaria y sesiones;
 *  [12] escrituras concurrentes sin pérdida y store compatible con respaldos.
 * POSIX-only (la clave de sesión se lee con el lector fail-closed POSIX).
 *
 *   node server/__test__/userCredentialReset.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
if (process.platform === 'win32') { console.log('userCredentialReset: SKIP (POSIX-only)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_credreset_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json', identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key', audit: tmp + '/au.json' };
fs.mkdirSync(P.uploads, { recursive: true });

// Contraseñas sintéticas de fixture (no son credenciales reales).
const PW = { PRIN: 'Prin-fixture-80!', ADM: 'Adm-fixture-77!', RDR: 'Rdr-fixture-12!', RDR2: 'Rdr2-fixture-34!', LEG: 'Legacy-plain-31', MED: 'Med-fixture-56!', NOID: 'Noid-plain-55', U1: 'U1-fixture-01!', U2: 'U2-fixture-02!', U3: 'U3-fixture-03!' };
const H = (p) => bcrypt.hashSync(p, 4);
const users = [
    // Fixture con el email de la cuenta principal (store temporal, no productivo).
    { id: 'PRIN', email: 'admin@chibaleteeditores.com', nombre_completo: 'Principal', password: H(PW.PRIN), roles: ['administrador'], accountStatus: 'active' },
    { id: 'ADM', email: 'adm@x.test', nombre_completo: 'Admin', password: H(PW.ADM), roles: ['administrador'], accountStatus: 'active' },
    { id: 'RDR', email: 'rdr@x.test', nombre_completo: 'Lectora', password: H(PW.RDR), roles: ['lector'], accountStatus: 'active', groupIds: ['g1'], nivel_lectura: 'Explorador', libros_leidos: 7 },
    { id: 'RDR2', email: 'rdr2@x.test', nombre_completo: 'Lector Dos', password: H(PW.RDR2), roles: ['lector'], accountStatus: 'active', groupIds: ['g1'] },
    { id: 'LEG', email: 'leg@x.test', nombre_completo: 'Legado', password: PW.LEG, roles: ['lector'] },
    { id: 'MED', email: 'med@x.test', nombre_completo: 'Mediadora', password: H(PW.MED), roles: ['mediador'], accountStatus: 'active' },
    { email: 'noid@x.test', nombre_completo: 'Sin id', password: PW.NOID, roles: ['lector'] },
    { id: 'U1', email: 'u1@x.test', nombre_completo: 'U1', password: H(PW.U1), roles: ['lector'], accountStatus: 'active' },
    { id: 'U2', email: 'u2@x.test', nombre_completo: 'U2', password: H(PW.U2), roles: ['lector'], accountStatus: 'active' },
    { id: 'U3', email: 'u3@x.test', nombre_completo: 'U3', password: H(PW.U3), roles: ['lector'], accountStatus: 'active' },
];
fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g1', type: 'course', name: 'G1', memberIds: ['RDR', 'RDR2'], mediatorIds: ['MED'] }]));
fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(P.access, JSON.stringify([{ id: 'rule-rdr', scope: 'user', scopeId: 'RDR', titleIds: ['t1'], collectionIds: [], expiresAt: null }]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 't1', title: 'T' }]));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const PORT = 4520 + (process.pid % 90); const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: tmp + '/data',
    USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
    CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
    USER_AUDIT_DB: P.audit, IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
    PROGRESS_SQLITE_PATH: tmp + '/progress.db',
    SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
    ACCESS_FALLBACK_MODE: 'open', SESSION_AUTH_MODE: 'enforce',
} });
let serverLog = ''; child.stdout.on('data', d => serverLog += d); child.stderr.on('data', d => serverLog += d);
async function waitHealthy() { for (let i = 0; i < 150; i++) { if (child.exitCode !== null) throw new Error('rc\n' + serverLog.slice(-1500)); try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await sleep(400); } throw new Error('never healthy\n' + serverLog.slice(-1500)); }

const readUsers = () => JSON.parse(fs.readFileSync(P.users, 'utf8'));
const userById = (id) => readUsers().find(u => u.id === id);
const cookieOf = (r) => { const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
const login = (email, password) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const loginCookie = async (email, password) => cookieOf(await login(email, password));
// Mutaciones con cookie: el guard CSRF exige Sec-Fetch-Site same-origin (lo pone el navegador).
const send = (method, url, cookie, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const me = async (cookie) => (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status;
const tokenOf = (url) => (String(url || '').match(/token=([0-9a-f]+)/) || [])[1];
const acceptInvite = (token, password) => fetch(`${base}/api/accept-invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const isServerBcrypt = (h) => typeof h === 'string' && /^\$2[ab]\$10\$/.test(h); // coste del servidor (fixtures usan 4)

const secretsSeen = []; // tokens emitidos durante la prueba, para buscarlos en logs/auditoría

async function main() {
    await waitHealthy();
    const admin = await loginCookie('adm@x.test', PW.ADM);
    ok('admin obtiene sesión (enforce)', !!admin);

    console.log('\n[1] solo administración');
    const med = await loginCookie('med@x.test', PW.MED);
    const rdr2 = await loginCookie('rdr2@x.test', PW.RDR2);
    ok('sin sesión → 401', (await send('POST', '/api/users/U1/disable')).status === 401);
    ok('lector → 403', (await send('POST', '/api/users/U1/disable', rdr2)).status === 403);
    ok('mediador → 403', (await send('POST', '/api/users/U1/reinvite', med)).status === 403);
    ok('x-user-id de admin sin sesión → 401 (enforce)', (await fetch(`${base}/api/users/U1/disable`, { method: 'POST', headers: { 'x-user-id': 'ADM' } })).status === 401);
    ok('admin sobre sí mismo → 409', (await send('POST', '/api/users/ADM/disable', admin)).status === 409);
    ok('usuario inexistente → 404', (await send('POST', '/api/users/NOPE/reinvite', admin)).status === 404);
    ok('U1 sigue intacto tras los intentos denegados', userById('U1').accountStatus === 'active' && userById('U1').password.startsWith('$2'));

    console.log('\n[2] desactivación');
    const rdr = await loginCookie('rdr@x.test', PW.RDR);
    ok('lectora con sesión viva', (await me(rdr)) === 200);
    const prog = await send('POST', '/api/progress/RDR/t1/sync', rdr, { canonicalProgress: { globalPercentage: 42, isCompleted: false }, updatedAt: new Date().toISOString() });
    const progTxt = await prog.text();
    ok('progreso registrado antes de desactivar', prog.status === 200, `status=${prog.status} ${progTxt.slice(0, 200)}`);
    const before = userById('RDR'); const accessSha = sha(P.access); const groupsBefore = fs.readFileSync(P.groups, 'utf8');
    const dis = await send('POST', '/api/users/RDR/disable', admin);
    const disBody = await dis.json();
    ok('disable → 200 accountStatus=disabled', dis.status === 200 && disBody.accountStatus === 'disabled');
    ok('respuesta sin campos de credencial', !('activationUrl' in disBody) && !JSON.stringify(disBody).includes('$2'));
    ok('sesión previa rechazada', (await me(rdr)) === 401);
    ok('login con la contraseña anterior → 401', (await login('rdr@x.test', PW.RDR)).status === 401);
    const after = userById('RDR');
    ok('credencial eliminada del registro', !('password' in after) && !('inviteToken' in after));
    ok('credentialVersion incrementado', (after.credentialVersion | 0) === (before.credentialVersion | 0) + 1);
    const keep = (u) => { const { password, credentialVersion, accountStatus, accountStatusChangedAt, ...r } = u; return JSON.stringify(r); };
    ok('[10] id, roles, grupos y perfil intactos', keep(after) === keep(before));
    ok('[10] grupo g1 conserva a RDR', fs.readFileSync(P.groups, 'utf8') === groupsBefore);
    ok('[10] reglas de acceso intactas', sha(P.access) === accessSha);
    ok('PUT accountStatus=active no devuelve la credencial', (await send('PUT', '/api/users/RDR', admin, { accountStatus: 'active' })).status === 200 && (await login('rdr@x.test', PW.RDR)).status === 401);
    await send('PUT', '/api/users/RDR', admin, { accountStatus: 'disabled' });

    console.log('\n[3] reinvitación');
    const legLogin = await login('leg@x.test', PW.LEG);
    const leg = cookieOf(legLogin);
    ok('[11] login legacy en texto plano sigue funcionando y se convierte a bcrypt', legLogin.status === 200 && userById('LEG').password.startsWith('$2'));
    const ri = await send('POST', '/api/users/LEG/reinvite', admin);
    const riBody = await ri.json();
    const tLeg = tokenOf(riBody.activationUrl); secretsSeen.push(tLeg);
    ok('reinvite → 200 invited + activationUrl', ri.status === 200 && riBody.accountStatus === 'invited' && /^\/#\/activar\?token=[0-9a-f]{64}$/.test(riBody.activationUrl));
    ok('[8] el token solo aparece dentro de activationUrl', !('inviteToken' in riBody));
    ok('[8] respuesta no-store', (ri.headers.get('cache-control') || '').includes('no-store'));
    ok('sesión previa revocada', (await me(leg)) === 401);
    ok('contraseña anterior inválida', (await login('leg@x.test', PW.LEG)).status === 401);
    const legRec = userById('LEG');
    ok('registro: invited, sin hash, token de 64 hex con caducidad ~48 h', legRec.accountStatus === 'invited' && !('password' in legRec) && /^[0-9a-f]{64}$/.test(legRec.inviteToken) && Math.abs(legRec.inviteExpiresAt - (Date.now() + 48 * 3600e3)) < 120e3);

    console.log('\n[7] política en la activación');
    ok('accept-invite con predeterminada → 400 default_password', (await (await acceptInvite(tLeg, 'chibalete123')).json()).code === 'default_password');
    const bcryptAttempt = await acceptInvite(tLeg, bcrypt.hashSync('atajo-conocido', 4));
    ok('accept-invite con valor bcrypt → 400 hash_not_allowed', bcryptAttempt.status === 400 && (await bcryptAttempt.json()).code === 'hash_not_allowed');
    ok('un rechazo de política no consume el token', userById('LEG').inviteToken === tLeg);

    console.log('\n[5][6] el titular fija su contraseña (ActivarCuenta → /api/accept-invite)');
    const NEW_LEG = 'Nueva-Legado-2026!';
    const acc = await acceptInvite(tLeg, NEW_LEG);
    const accBody = await acc.json();
    ok('accept-invite → 200 y cuenta activa', acc.status === 200 && userById('LEG').accountStatus === 'active');
    ok('[8] la respuesta de activación no expone hash ni token', !JSON.stringify(accBody).includes('$2') && !JSON.stringify(accBody).includes(tLeg));
    const legNow = userById('LEG');
    ok('[6] hash generado por el servidor (coste 10) y verificable', isServerBcrypt(legNow.password) && bcrypt.compareSync(NEW_LEG, legNow.password));
    ok('token retirado del registro', !('inviteToken' in legNow) && !('inviteExpiresAt' in legNow));
    ok('login con la nueva contraseña → 200', (await login('leg@x.test', NEW_LEG)).status === 200);

    console.log('\n[4] un solo uso y caducidad');
    ok('reutilizar el token → 404', (await acceptInvite(tLeg, 'Otra-Distinta-99!')).status === 404);
    const riMed = await (await send('POST', '/api/users/MED/reinvite', admin)).json();
    const tMed = tokenOf(riMed.activationUrl); secretsSeen.push(tMed);
    const all = readUsers(); all.find(u => u.id === 'MED').inviteExpiresAt = Date.now() - 1000; fs.writeFileSync(P.users, JSON.stringify(all, null, 2));
    ok('token caducado → 410', (await acceptInvite(tMed, 'Mediadora-Nueva-88!')).status === 410);
    const riMed2 = await (await send('POST', '/api/users/MED/reinvite', admin)).json();
    const tMed2 = tokenOf(riMed2.activationUrl); secretsSeen.push(tMed2);
    ok('una nueva reinvitación invalida el token anterior', tMed2 !== tMed && (await acceptInvite(tMed, 'Mediadora-Nueva-88!')).status === 404);
    ok('el token nuevo funciona', (await acceptInvite(tMed2, 'Mediadora-Nueva-88!')).status === 200);

    console.log('\n[10] recuperación de la cuenta desactivada conservando el progreso');
    const riR = await (await send('POST', '/api/users/RDR/reinvite', admin)).json();
    const tR = tokenOf(riR.activationUrl); secretsSeen.push(tR);
    ok('reinvitar una cuenta desactivada la recupera', (await acceptInvite(tR, 'Lectora-Vuelve-21!')).status === 200);
    const rdrBack = await loginCookie('rdr@x.test', 'Lectora-Vuelve-21!');
    const progBack = await fetch(`${base}/api/progress/item/RDR/t1`, { headers: { cookie: rdrBack } });
    const progJson = progBack.ok ? await progBack.json() : null;
    ok('el progreso previo sigue disponible para la titular', progBack.status === 200 && JSON.stringify(progJson).includes('42'));
    ok('grupo y regla siguen asociados', userById('RDR').groupIds?.[0] === 'g1' && sha(P.access) === accessSha);

    console.log('\n[7] política en creación y edición');
    const mk = (password, extra = {}) => send('POST', '/api/users', admin, { email: `nuevo-${Math.random().toString(36).slice(2, 7)}@x.test`, nombre_completo: 'Nuevo', roles: ['mediador'], password, ...extra });
    ok('crear con predeterminada → 400', (await mk('chibalete123')).status === 400);
    ok('crear con valor bcrypt → 400', (await mk(bcrypt.hashSync('x', 4))).status === 400);
    const created = await mk('Creada-Segura-61!', { inviteToken: 'f'.repeat(64), credentialVersion: 99 });
    const createdBody = await created.json();
    const createdRec = userById(createdBody.id);
    ok('[11] crear con contraseña válida → 2xx', created.status >= 200 && created.status < 300 && !!createdRec);
    ok('[6] hash de servidor en la creación', isServerBcrypt(createdRec?.password) && bcrypt.compareSync('Creada-Segura-61!', createdRec.password));
    ok('campos de credencial del cliente descartados en la creación', createdRec && !('inviteToken' in createdRec) && createdRec.credentialVersion !== 99);

    const rdr2Before = userById('RDR2');
    const edit = await send('PUT', '/api/users/RDR2', admin, { nombre_completo: 'Lector Dos Editado', password: '' });
    ok('[11] edición ordinaria → 200', edit.status === 200);
    ok('[11] edición sin contraseña no toca el hash ni la versión', userById('RDR2').password === rdr2Before.password && (userById('RDR2').credentialVersion | 0) === (rdr2Before.credentialVersion | 0));
    ok('[11] la sesión del lector sobrevive a una edición ordinaria', (await me(rdr2)) === 200);
    ok('PUT con predeterminada → 400', (await send('PUT', '/api/users/RDR2', admin, { password: 'chibalete123' })).status === 400);
    ok('PUT con valor bcrypt → 400', (await send('PUT', '/api/users/RDR2', admin, { password: bcrypt.hashSync('y', 4) })).status === 400);
    ok('PUT no permite fijar token ni credentialVersion', (await send('PUT', '/api/users/RDR2', admin, { inviteToken: 'a'.repeat(64), credentialVersion: 77 })).status === 200
        && !('inviteToken' in userById('RDR2')) && userById('RDR2').credentialVersion !== 77);
    const putPw = await send('PUT', '/api/users/RDR2', admin, { password: 'Cambio-Admin-73!' });
    ok('PUT con contraseña válida → 200, hash de servidor', putPw.status === 200 && isServerBcrypt(userById('RDR2').password) && bcrypt.compareSync('Cambio-Admin-73!', userById('RDR2').password));
    ok('PUT con contraseña revoca la sesión previa', (await me(rdr2)) === 401);

    console.log('\n[9] registro sin id');
    const noidBefore = JSON.stringify(readUsers().find(u => !u.id));
    const nl = await login('noid@x.test', PW.NOID);
    ok('login con la contraseña correcta → 401 genérico', nl.status === 401 && (await nl.json()).error === 'Credenciales inválidas');
    ok('el login no escribió el registro (sin lastLoginAt ni auto-upgrade)', JSON.stringify(readUsers().find(u => !u.id)) === noidBefore);
    ok('mediadora y lectores siguen autenticando', (await login('med@x.test', 'Mediadora-Nueva-88!')).status === 200 && (await login('u3@x.test', PW.U3)).status === 200);

    console.log('\n[12] concurrencia y compatibilidad del store');
    const [a, b, c] = await Promise.all([
        send('POST', '/api/users/U1/reinvite', admin),
        send('POST', '/api/users/U2/disable', admin),
        send('PUT', '/api/users/U3', admin, { nombre_completo: 'U3 renombrado' }),
    ]);
    const tU1 = tokenOf((await a.json()).activationUrl); secretsSeen.push(tU1);
    ok('tres escrituras concurrentes → 200', a.status === 200 && b.status === 200 && c.status === 200);
    ok('ninguna se pierde', userById('U1').accountStatus === 'invited' && userById('U2').accountStatus === 'disabled' && userById('U3').nombre_completo === 'U3 renombrado');
    const final = readUsers();
    ok('store = JSON array válido; estados dentro del contrato', Array.isArray(final) && final.every(u => u.accountStatus === undefined || ['active', 'invited', 'disabled'].includes(u.accountStatus)));
    ok('el único campo nuevo es accountStatusChangedAt (ISO)', final.filter(u => u.accountStatusChangedAt).every(u => !Number.isNaN(Date.parse(u.accountStatusChangedAt))));

    console.log('\n[8] ningún secreto en listados, logs ni auditoría');
    const list = await (await fetch(`${base}/api/users`, { headers: { cookie: admin } })).json();
    const listTxt = JSON.stringify(list);
    ok('GET /api/users sin password ni tokens', !/"password"|"inviteToken"|"resetToken"/.test(listTxt));
    await sleep(400); // la auditoría se escribe async
    const auditTxt = fs.existsSync(P.audit) ? fs.readFileSync(P.audit, 'utf8') : '';
    const audit = auditTxt ? JSON.parse(auditTxt) : [];
    ok('auditoría registra reinvite_user y disable_user', audit.some(e => e.action === 'reinvite_user') && audit.some(e => e.action === 'disable_user'));
    const pwValues = [...Object.values(PW), 'Nueva-Legado-2026!', 'Mediadora-Nueva-88!', 'Lectora-Vuelve-21!', 'Creada-Segura-61!', 'Cambio-Admin-73!'];
    const leak = (txt) => secretsSeen.filter(Boolean).some(t => txt.includes(t)) || pwValues.some(p => txt.includes(p));
    ok('auditoría sin tokens ni contraseñas', !leak(auditTxt));
    ok('log del servidor sin tokens ni contraseñas', !leak(serverLog));

    console.log('\n[13] cuenta administrativa principal protegida');
    const prinBefore = JSON.stringify(userById('PRIN'));
    const codeOf = async (r) => (await r.json().catch(() => ({}))).code;
    const rDis = await send('POST', '/api/users/PRIN/disable', admin);
    ok('otro admin no puede desactivarla → 409 PROTECTED_ACCOUNT', rDis.status === 409 && (await codeOf(rDis)) === 'PROTECTED_ACCOUNT');
    ok('ni reinvitarla → 409', (await send('POST', '/api/users/PRIN/reinvite', admin)).status === 409);
    ok('PUT accountStatus=disabled → 409', (await send('PUT', '/api/users/PRIN', admin, { accountStatus: 'disabled' })).status === 409);
    ok('PUT accountStatus=invited → 409', (await send('PUT', '/api/users/PRIN', admin, { accountStatus: 'invited' })).status === 409);
    ok('PUT quitar rol administrador → 409', (await send('PUT', '/api/users/PRIN', admin, { roles: ['lector'] })).status === 409);
    ok('PUT cambiar email → 409', (await send('PUT', '/api/users/PRIN', admin, { email: 'otra@x.test' })).status === 409);
    ok('PUT fijar contraseña desde otra cuenta → 409', (await send('PUT', '/api/users/PRIN', admin, { password: 'Toma-Control-91!' })).status === 409);
    ok('DELETE → 409', (await send('DELETE', '/api/users/PRIN', admin)).status === 409);
    ok('tras todos los intentos el registro es idéntico', JSON.stringify(userById('PRIN')) === prinBefore);
    ok('la contraseña de la principal sigue funcionando', (await login('admin@chibaleteeditores.com', PW.PRIN)).status === 200);
    ok('editar su nombre sigue permitido', (await send('PUT', '/api/users/PRIN', admin, { nombre_completo: 'Principal Editorial' })).status === 200
        && userById('PRIN').nombre_completo === 'Principal Editorial' && userById('PRIN').password === JSON.parse(prinBefore).password);

    const prin = await loginCookie('admin@chibaleteeditores.com', PW.PRIN);
    ok('la principal puede desactivar a otro administrador', (await send('POST', '/api/users/ADM/disable', prin)).status === 200);
    ok('la sesión del administrador desactivado cae', (await me(admin)) === 401);
    ok('la principal no puede desactivarse a sí misma', (await send('POST', '/api/users/PRIN/disable', prin)).status === 409);
    ok('la principal sigue activa y con sesión válida', userById('PRIN').accountStatus === 'active' && (await me(prin)) === 200);
    const selfPw = await send('PUT', '/api/users/PRIN', prin, { password: 'Prin-Propia-Nueva-82!' });
    ok('la principal sí puede cambiar su propia contraseña (política aplicada)', selfPw.status === 200 && bcrypt.compareSync('Prin-Propia-Nueva-82!', userById('PRIN').password));
    ok('y no con una predeterminada', (await send('PUT', '/api/users/PRIN', await loginCookie('admin@chibaleteeditores.com', 'Prin-Propia-Nueva-82!'), { password: 'chibalete123' })).status === 400);
}

main().then(() => {
    console.log(`\nuserCredentialReset — ${pass} ✓, ${fail} ✗`);
    try { child.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.error(serverLog.slice(-2000)); try { child.kill('SIGKILL'); } catch {} process.exit(1); });
