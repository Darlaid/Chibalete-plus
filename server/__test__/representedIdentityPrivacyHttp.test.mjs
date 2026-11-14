/**
 * representedIdentityPrivacyHttp.test.mjs — CHP V9 F3-D4S.
 *
 * Privacidad de identidad de las cuentas representadas (F3-D1) en las respuestas al cliente,
 * contra server.js REAL (SESSION_AUTH_MODE=enforce, padrón sintético; POSIX como loginIdentifierHttp):
 *   [1] el lector representado inicia sesión: recibe SU usuario, nunca el correo del adulto responsable
 *   [2] /api/users y /api/auth/me del propio lector
 *   [3] activación: la respuesta trae el usuario y no el contacto; decisiones y acceso intactos
 *   [4] terceros (lector y mediador de la misma institución, otro lector B2C, sin sesión)
 *   [5] hermanos: cuentas y accesos independientes
 *   [6] administración de plataforma: conserva el registro completo
 *   [7] cuentas adultas e institucionales sin cambios; almacenamiento intacto
 *   [8] F3-D5: la clave interna del pedido (`b2cOrigin`) no llega al lector
 *   [9] F3-D5: sin nombre visible, ninguna vista de mediador usa el usuario de acceso como nombre
 *   [10] F3-D5: mediadores y lectores B2C; Leo sin A3
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/representedIdentityPrivacyHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, approveTestDocuments, grantA2, grantC005 } from './helpers/testA2.mjs';
import { ACCEPTANCE_DOCUMENTS } from '../../utils/acceptanceDocuments.mjs';
import { isRepresentedAccount } from '../b2c/b2cProvisioning.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { freePort } from './helpers/freePort.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform === 'win32') { console.log('representedIdentityPrivacyHttp: SKIP (POSIX-only)\nresultado: 0 correctas, 0 fallidas'); process.exit(0); }

const pw = (id) => `Fixture-${id}-sintetica-83!`;
const hash = (id) => bcrypt.hashSync(pw(id), 4);
const CONTACT = 'representante@x.test';
const ORG = 'org-alfa';
const L = { K1: 'lec-aaaa-bbbb-cccc', K2: 'lec-dddd-eeee-ffff', K4: 'lec-gggg-hhhh-2222', K5: 'lec-3333-4444-5555', K6: 'lec-7777-8888-9999', INV: 'lec-6666-7777-8888' };
const base0 = { avatar_url: '', bio_corta: '', libros_leidos: 0, seguidores: 0, seguidos: 0, nivel_lectura: 'Novato', groupIds: [] };
const emailAcc = (id, roles = ['lector'], extra = {}) => ({ id, email: `${id.toLowerCase()}@x.test`, nombre_completo: `Nombre ${id}`, nombre_usuario: id.toLowerCase(), password: hash(id), roles, accountStatus: 'active', ...base0, ...extra });
const repAcc = (id, name, extra = {}) => ({ id, email: '', loginId: L[id], representedBy: { email: CONTACT }, nombre_completo: name, nombre_usuario: L[id], password: hash(id), roles: ['lector'], colegio: '', accountStatus: 'active', b2c: true, createdVia: 'b2c-provision', b2cOrigin: `test:order:${id}`, ...base0, ...extra });
const INVITE = crypto.randomBytes(32).toString('hex');
const inOrg = { organizationId: ORG, colegio: 'Colegio Alfa' };
const seed = [
    emailAcc('ADM', ['administrador']),
    emailAcc('MED', ['mediador'], { mediatorKind: 'teacher', ...inOrg }),
    emailAcc('LEC', ['lector'], inOrg),
    emailAcc('B2C', ['lector'], { b2c: true, createdVia: 'b2c-provision' }),                                          // adulta con suscripción propia, sin institución
    repAcc('K1', 'Lupe'), repAcc('K2', 'Lector'),             // hermanos, mismo contacto
    repAcc('K4', 'Sol', inOrg),                               // caso límite: representada visible dentro de una institución
    repAcc('K5', '', inOrg),                                  // F3-D5: sin nombre visible, miembro de un grupo
    repAcc('K6', '', inOrg),                                  // F3-D5: sin nombre visible, candidata al grupo
    repAcc('INV', 'Nico', { accountStatus: 'invited', password: undefined, inviteToken: INVITE, inviteExpiresAt: Date.now() + 3_600_000 }),
];
ok('las cuentas de la prueba son representadas según el modelo', ['K1', 'K2', 'K4', 'K5', 'K6', 'INV'].every((id) => isRepresentedAccount(seed.find((u) => u.id === id))));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_repid_'));
const USERS = path.join(tmp, 'users.json');
const key = path.join(tmp, 'session_signing_key');
fs.writeFileSync(USERS, JSON.stringify(seed, null, 2));
fs.writeFileSync(path.join(tmp, 'g.json'), JSON.stringify([{ id: 'g-a1', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: ['MED'], memberIds: ['LEC', 'K4', 'K5'], studentIds: ['LEC', 'K4', 'K5'] }]));
fs.writeFileSync(path.join(tmp, 's.json'), JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }]));
const future = Date.now() + 300 * 86400000;
fs.writeFileSync(path.join(tmp, 'a.json'), JSON.stringify(['K1', 'INV'].map((id) => ({ id: `access-b2c-test-order-${id}`, scope: 'user', scopeId: id, titleIds: ['obra-1'], collectionIds: [], expiresAt: future, b2c: { orderId: id, idempotencyKey: `test:order:${id}` } }))));
fs.writeFileSync(path.join(tmp, 'c.json'), JSON.stringify([{ id: 'obra-1', titulo: 'Obra 1', tipo: 'libro' }]));
fs.writeFileSync(key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(key, 0o400);
const REG = a2RegistryPath();
approveTestDocuments();
grantA2(['K5', 'LEC']); grantC005(['MED']); // el mediador consulta a sus lectores con A2 y su compromiso 005 vigente

const port = await freePort(); const base = `http://127.0.0.1:${port}`;
let logs = '';
const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: path.join(tmp, 'data'), USERS_DB: USERS,
    GROUPS_DB: path.join(tmp, 'g.json'), SCHOOLS_DB: path.join(tmp, 's.json'), ACCESS_DB: path.join(tmp, 'a.json'), CONTENT_DB: path.join(tmp, 'c.json'),
    UPLOADS_ROOT: path.join(tmp, 'up'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'o.db'), USER_AUDIT_DB: path.join(tmp, 'audit.json'),
    IDENTITY_DB: path.join(tmp, 'i.db'), IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: path.join(tmp, 'in.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'e.db'), PROGRESS_SQLITE_PATH: path.join(tmp, 'p.db'),
    SESSIONS_DB: path.join(tmp, 'se.db'), SESSION_KEY_CURRENT_PATH: key, ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce', CHP_A2_REGISTRY: REG,
} });
child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });

const stored = () => JSON.parse(fs.readFileSync(USERS, 'utf8'));
const login = async (identifier, password) => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identifier, password }) });
    const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
    return { status: r.status, body, text, cookie: (r.headers.get('set-cookie') || '').match(/chp_session=[^;]+/)?.[0] ?? null };
};
const get = async (url, cookie) => { const r = await fetch(`${base}${url}`, { headers: cookie ? { cookie } : {} }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ } return { status: r.status, body, text }; };
const access = async (cookie, userId) => { const r = await get(`/api/content/obra-1/access?userId=${userId}`, cookie); return r.status === 200 ? r.body?.allowed === true : `HTTP${r.status}`; };
const leaks = (text, ...needles) => needles.filter((n) => text.includes(n));
const ANY_LOGIN = /lec-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/;

try {
    for (let i = 0; ; i++) {
        try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* arrancando */ }
        if (i > 200 || child.exitCode !== null) throw new Error(`no arrancó\n${logs.slice(-2000)}`);
        await sleep(150);
    }
    const before = fs.readFileSync(USERS, 'utf8');

    console.log('[1] inicio de sesión del lector representado');
    const k1 = await login(L.K1, pw('K1'));
    ok('usuario y contraseña → 200 con sesión', k1.status === 200 && !!k1.cookie && k1.body?.user?.id === 'K1');
    ok('la respuesta trae SU usuario de acceso', k1.body?.user?.loginId === L.K1);
    ok('…y NO el correo del adulto responsable (ni el campo)', !('representedBy' in (k1.body?.user ?? {})) && !k1.text.includes(CONTACT), leaks(k1.text, CONTACT, 'representedBy').join());
    ok('…el nombre público es el nombre visible, no el usuario de acceso', k1.body?.user?.nombre_usuario === 'Lupe' && k1.body.user.nombre_completo === 'Lupe');
    ok('el correo del representante sigue sin abrir ninguna cuenta', (await login(CONTACT, pw('K1'))).status === 401);

    console.log('[2] lecturas del propio lector');
    const mine = await get('/api/users', k1.cookie);
    ok('/api/users: solo su registro, con su usuario', mine.status === 200 && Array.isArray(mine.body) && mine.body.length === 1 && mine.body[0].id === 'K1' && mine.body[0].loginId === L.K1);
    ok('…sin el contacto del adulto ni el usuario de su hermano', !mine.text.includes(CONTACT) && !mine.text.includes('representedBy') && !mine.text.includes(L.K2));
    const meK1 = await get('/api/auth/me', k1.cookie);
    ok('/api/auth/me: su cuenta, sin el contacto', meK1.status === 200 && meK1.body?.id === 'K1' && !meK1.text.includes(CONTACT));
    ok('lee la obra de su suscripción', (await access(k1.cookie, 'K1')) === true);

    console.log('[3] activación de una cuenta representada');
    const reg0 = fs.readFileSync(REG, 'utf8').split('\n').filter(Boolean).length;
    const act = await fetch(`${base}/api/accept-invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: INVITE, password: pw('INV'),
        acceptance: { terms: true, termsVersion: ACCEPTANCE_DOCUMENTS.terms.version, dataNoticeVersion: ACCEPTANCE_DOCUMENTS.dataNotice.version, actingAs: 'legal_representative', adultDeclared: true, A0: 'yes', A1: 'yes', A2: 'not_applicable' } }) });
    const actText = await act.text(); const actBody = JSON.parse(actText);
    ok('con las decisiones del representante → 200 y cuenta activa', act.status === 200 && actBody.user?.id === 'INV' && actBody.user.accountStatus === 'active', `${act.status} ${actText.slice(0, 160)}`);
    ok('la respuesta trae el usuario de acceso de ESA cuenta (pantalla de activación)', actBody.user?.loginId === L.INV);
    ok('…y no el contacto del adulto, ni tokens ni contraseña', !actText.includes(CONTACT) && !/representedBy|inviteToken|"password"/.test(actText));
    ok('las decisiones quedaron registradas igual que antes (T, A0, A1 del representante)', fs.readFileSync(REG, 'utf8').split('\n').filter(Boolean).length === reg0 + 3, String(fs.readFileSync(REG, 'utf8').split('\n').filter(Boolean).length - reg0));
    const inv = await login(L.INV, pw('INV'));
    ok('el lector recién activado entra con su usuario y lee', inv.status === 200 && (await access(inv.cookie, 'INV')) === true);
    ok('el contacto sigue guardado para los procesos internos (provisión, recuperación, GVA)', stored().find((u) => u.id === 'INV').representedBy?.email === CONTACT && stored().find((u) => u.id === 'INV').loginId === L.INV);

    console.log('[4] terceros');
    ok('sin sesión no hay listado', (await get('/api/users')).status === 401);
    const lec = await login('lec@x.test', pw('LEC'));
    const seenByLec = await get('/api/users', lec.cookie);
    const k4Lec = seenByLec.body?.find((u) => u.id === 'K4');
    ok('lector de la misma institución: ve el perfil público de la cuenta representada', seenByLec.status === 200 && !!k4Lec && k4Lec.nombre_completo === 'Sol');
    ok('…con un nombre público que NO es el usuario de acceso', k4Lec?.nombre_usuario === 'Sol' && !('loginId' in (k4Lec ?? {})));
    ok('…y ningún usuario de acceso ni correo de representante en toda la respuesta', !ANY_LOGIN.test(seenByLec.text) && !seenByLec.text.includes(CONTACT) && !seenByLec.text.includes('representedBy'), leaks(seenByLec.text, CONTACT, 'lec-').join());
    ok('…no ve cuentas B2C ajenas a su institución', !seenByLec.body.some((u) => ['K1', 'K2', 'INV', 'B2C'].includes(u.id)));
    const med = await login('med@x.test', pw('MED'));
    const seenByMed = await get('/api/users', med.cookie);
    const k4Med = seenByMed.body?.find((u) => u.id === 'K4');
    ok('mediador de la misma institución: registro de la cuenta sin usuario de acceso ni contacto', !!k4Med && !('loginId' in k4Med) && !('representedBy' in k4Med) && k4Med.nombre_usuario === 'Sol' && !ANY_LOGIN.test(seenByMed.text) && !seenByMed.text.includes(CONTACT));
    ok('…y sigue viendo a sus lectores como antes (correo incluido)', seenByMed.body.find((u) => u.id === 'LEC')?.email === 'lec@x.test');
    const b2c = await login('b2c@x.test', pw('B2C'));
    const seenByB2c = await get('/api/users', b2c.cookie);
    ok('otra lectora B2C: solo su propio registro; nada de las cuentas representadas', seenByB2c.body?.length === 1 && seenByB2c.body[0].id === 'B2C' && !ANY_LOGIN.test(seenByB2c.text) && !seenByB2c.text.includes(CONTACT));

    console.log('[5] hermanos');
    const k2 = await login(L.K2, pw('K2'));
    const mine2 = await get('/api/users', k2.cookie);
    ok('cada hermano recibe solo su usuario', k2.body?.user?.loginId === L.K2 && mine2.body?.length === 1 && mine2.body[0].loginId === L.K2 && !mine2.text.includes(L.K1) && !mine2.text.includes(CONTACT));
    ok('sin nombre propio, el nombre público es genérico y no el usuario', k2.body.user.nombre_usuario === 'Lector');
    ok('sesiones y accesos independientes', (await get('/api/auth/me', k2.cookie)).body?.id === 'K2' && (await get('/api/auth/me', k1.cookie)).body?.id === 'K1'
        && (await access(k1.cookie, 'K1')) === true && (await access(k2.cookie, 'K2')) !== true && (await access(k2.cookie, 'K1')) !== true);

    console.log('[6] administración de plataforma');
    const adm = await login('adm@x.test', pw('ADM'));
    const all = await get('/api/users', adm.cookie);
    const k1Adm = all.body?.find((u) => u.id === 'K1');
    ok('ve todas las cuentas, con el contacto y el usuario de las representadas', all.status === 200 && all.body.length === seed.length && k1Adm?.representedBy?.email === CONTACT && k1Adm.loginId === L.K1);
    ok('…y sin contraseñas ni tokens', !/"password"|inviteToken|resetToken/.test(all.text));

    console.log('[7] cuentas existentes y almacenamiento');
    ok('lector institucional: su registro y su nombre de usuario no cambian', lec.body?.user?.nombre_usuario === 'lec' && lec.body.user.email === 'lec@x.test' && seenByLec.body.find((u) => u.id === 'LEC')?.email === 'lec@x.test');
    ok('perfil público de un mediador ante un lector: igual que antes', (() => { const m = seenByLec.body.find((u) => u.id === 'MED'); return !!m && m.nombre_usuario === 'med' && m.mediatorKind === 'teacher' && !('email' in m); })());
    ok('adulta B2C y administrador: nombre de usuario y correo intactos', b2c.body?.user?.nombre_usuario === 'b2c' && b2c.body.user.email === 'b2c@x.test' && adm.body?.user?.nombre_usuario === 'adm');
    const after = stored(); const prev = JSON.parse(before);
    ok('el padrón conserva contacto, usuario y nombre de usuario de todas las cuentas', after.every((u) => { const b = prev.find((x) => x.id === u.id); return JSON.stringify(u.representedBy) === JSON.stringify(b.representedBy) && u.loginId === b.loginId && u.nombre_usuario === b.nombre_usuario && u.email === b.email; }));
    ok('los registros del servidor no contienen el correo del representante', !logs.includes(CONTACT));

    console.log('[8] F3-D5: clave interna del pedido');
    const ORIGIN = /b2cOrigin|test:order/;
    ok('inicio de sesión, registro propio y activación no traen la clave del pedido', !ORIGIN.test(k1.text) && !ORIGIN.test(mine.text) && !ORIGIN.test(actText) && !ORIGIN.test(mine2.text), [k1.text, mine.text, actText].map((t) => ORIGIN.test(t)).join());
    ok('tampoco llega a terceros (lector, mediador, otra lectora B2C)', !ORIGIN.test(seenByLec.text) && !ORIGIN.test(seenByMed.text) && !ORIGIN.test(seenByB2c.text));
    ok('la administración de plataforma la conserva', k1Adm?.b2cOrigin === 'test:order:K1');
    ok('…y sigue guardada para la idempotencia de la provisión', stored().find((u) => u.id === 'K1').b2cOrigin === 'test:order:K1' && stored().find((u) => u.id === 'INV').b2cOrigin === 'test:order:INV');

    console.log('[9] F3-D5: nombre de respaldo');
    const k5Med = seenByMed.body.find((u) => u.id === 'K5'), k5Lec = seenByLec.body.find((u) => u.id === 'K5');
    ok('/api/users: sin nombre visible, el nombre público es «Lector» (mediador y lector)', k5Med?.nombre_usuario === 'Lector' && k5Lec?.nombre_usuario === 'Lector' && !('loginId' in k5Med));
    const members = await get('/api/groups/g-a1/members', med.cookie), cands = await get('/api/groups/g-a1/candidates', med.cookie);
    ok('nómina del grupo: la cuenta aparece, sin usuario de acceso como nombre', members.status === 200 && members.text.includes('"K5"') && !ANY_LOGIN.test(members.text) && !members.text.includes(CONTACT), `${members.status} ${members.text.match(ANY_LOGIN)?.[0] ?? ''}`);
    ok('candidatos del grupo: la cuenta aparece, sin usuario de acceso como nombre', cands.status === 200 && cands.text.includes('"K6"') && !ANY_LOGIN.test(cands.text) && !cands.text.includes(CONTACT), `${cands.status} ${cands.text.match(ANY_LOGIN)?.[0] ?? ''}`);
    const st5 = await get('/api/students/K5/status', med.cookie);
    ok('estado del estudiante: nombre de respaldo neutro, nunca el usuario', st5.status === 200 && typeof st5.body?.name === 'string' && st5.body.name !== L.K5 && !ANY_LOGIN.test(st5.text), `${st5.status} ${st5.body?.name}`);
    ok('un lector con nombre conserva el suyo en esas vistas', (await get('/api/students/LEC/status', med.cookie)).body?.name === 'Nombre LEC' && members.text.includes('Nombre LEC'));
    ok('el usuario de acceso no cambió: K5 sigue entrando con el suyo', (await login(L.K5, pw('K5'))).body?.user?.loginId === L.K5 && stored().find((u) => u.id === 'K5').nombre_usuario === L.K5);

    console.log('[10] F3-D5: mediadores, lectores B2C y Leo');
    const stK1 = await get('/api/students/K1/status', med.cookie);
    ok('un mediador no consulta el estado de un lector B2C', stK1.status === 403 && !ANY_LOGIN.test(stK1.text), String(stK1.status));
    const prK1 = await get('/api/progress/user/K1', med.cookie), itK1 = await get('/api/progress/item/K1/obra-1', med.cookie);
    ok('…ni su progreso (listado y por título), tampoco el de una adulta B2C', prK1.status === 403 && itK1.status === 403 && (await get('/api/progress/user/B2C', med.cookie)).status === 403, `${prK1.status} ${itK1.status}`);
    // V9 F5-A: además de mediar el grupo del lector, hacen falta la A2 del lector y el C005 del mediador (LEC la tiene; K4 no).
    ok('…el mediador conserva la lectura de progreso de SUS lectores con A2 vigente; sin A2 del lector, no', (await get('/api/progress/user/LEC', med.cookie)).status === 200 && (await get('/api/progress/user/K4', med.cookie)).status === 403);
    ok('el propio lector y la administración siguen leyendo ese progreso', (await get('/api/progress/user/K1', k1.cookie)).status === 200 && (await get('/api/progress/user/K1', adm.cookie)).status === 200 && (await get('/api/progress/item/K1/obra-1', k1.cookie)).status === 200);
    ok('un lector no lee el progreso ni el acceso de otro', (await get('/api/progress/user/K1', k2.cookie)).status === 403 && (await get('/api/progress/user/K1', lec.cookie)).status === 403 && (await access(lec.cookie, 'K1')) !== true);
    ok('el mediador conserva el estado de sus propios lectores', (await get('/api/students/LEC/status', med.cookie)).status === 200);
    ok('menor sin A3 efectiva: Leo no autorizado en su sesión', meK1.body?.optionalProcessing?.leo === false && (await get('/api/auth/me', inv.cookie)).body?.optionalProcessing?.leo === false);
    const leo = await fetch(`${base}/api/leo/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie: k1.cookie }, body: JSON.stringify({ question: '¿Quién es el autor?', contentId: 'obra-1' }) });
    ok('…y la API rechaza su pregunta a Leo', leo.status === 403, String(leo.status));
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
