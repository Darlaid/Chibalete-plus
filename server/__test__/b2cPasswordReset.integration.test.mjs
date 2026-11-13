/**
 * b2cPasswordReset.integration.test.mjs — CHP V9 F4-A.
 *
 * Recuperación de contraseña por el canal firmado de la tienda (`POST /api/b2c/password-reset`) y
 * confirmación con el restablecimiento existente, contra server.js REAL (SESSION_AUTH_MODE=enforce).
 * Como b2cProvisioning.integration: el secreto file-only vive en una ruta constante, así que SOLO corre
 * en un contenedor desechable con CHP_B2C_TEST_SECRET_SANDBOX=1 y nunca pisa un secreto existente.
 *   [1] autenticación del canal            [6] no se emite: respuestas idénticas
 *   [2] los endpoints públicos no emiten   [7] token vencido, reutilizado y resumen presentado
 *   [3] cuenta adulta por correo           [8] solicitudes repetidas y abuso
 *   [4] cuenta representada por usuario    [9] decisiones, acceso, progreso y demás cuentas
 *   [5] hermanos y correo del adulto       [10] compatibilidad y registros
 * Nunca toca data/ ni data-critical/. No envía correo.
 *
 *   CHP_B2C_TEST_SECRET_SANDBOX=1 node server/__test__/b2cPasswordReset.integration.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, approveTestDocuments } from './helpers/testA2.mjs';
import { appendDecisions, dayOf } from '../privacy/a2Registry.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signB2cRequest, B2C_TS_HEADER, B2C_SIG_HEADER } from '../b2c/b2cProvisioning.mjs';
import { hashResetToken, B2C_RESET_TTL_MS, RESET_TOKEN_HASH_PREFIX } from '../b2c/b2cPasswordReset.mjs';
import { B2C_PROVISIONING_SECRET_PATH } from '../lib/b2cProvisioningSecret.js';
import bcrypt from 'bcryptjs';
import { freePort } from './helpers/freePort.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.platform === 'win32') { console.log('b2cPasswordReset.integration: SKIP (POSIX-only)'); process.exit(0); }
if (process.env.CHP_B2C_TEST_SECRET_SANDBOX !== '1') { console.log('b2cPasswordReset.integration: SKIP (requiere CHP_B2C_TEST_SECRET_SANDBOX=1 en un contenedor desechable)'); process.exit(0); }
if (fs.existsSync(B2C_PROVISIONING_SECRET_PATH)) { console.error('ABORT: ya existe un secreto B2C en la ruta canónica; esta prueba nunca lo pisa.'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_b2c_reset_'));
const USERS = path.join(tmp, 'users.json'), ACCESS = path.join(tmp, 'a.json'), key = path.join(tmp, 'key');
const SECRET = crypto.randomBytes(48).toString('hex');
fs.mkdirSync(path.dirname(B2C_PROVISIONING_SECRET_PATH), { recursive: true });
fs.writeFileSync(B2C_PROVISIONING_SECRET_PATH, SECRET, { mode: 0o400 }); fs.chmodSync(B2C_PROVISIONING_SECRET_PATH, 0o400);

const pw = (id) => `Fixture-${id}-sintetica-47!`;
const NEW = (id) => `Nueva-${id}-sintetica-2031!`;
const hash = (id) => bcrypt.hashSync(pw(id), 4);
const CONTACT = 'madre@fixture.invalid';
const L = { K1: 'lec-aaaa-bbbb-cccc', K2: 'lec-dddd-eeee-ffff', DIS: 'lec-3333-4444-5555', INV: 'lec-6666-7777-8888', GHOST: 'lec-zzzz-zzzz-zzzz' };
const base0 = { avatar_url: '', bio_corta: '', libros_leidos: 0, seguidores: 0, seguidos: 0, nivel_lectura: 'Novato', groupIds: [], roles: ['lector'], accountStatus: 'active' };
const adult = (id, email, extra = {}) => ({ id, email, nombre_completo: id, nombre_usuario: id.toLowerCase(), password: hash(id), b2c: true, createdVia: 'b2c-provision', ...base0, ...extra });
const rep = (id, extra = {}) => ({ id, email: '', loginId: L[id], representedBy: { email: CONTACT }, nombre_completo: 'Lector', nombre_usuario: L[id], password: hash(id), colegio: '', b2c: true, createdVia: 'b2c-provision', b2cOrigin: `test:order:${id}`, credentialVersion: 2, ...base0, ...extra });
const LEGACY = 'legado-' + crypto.randomBytes(20).toString('hex');
const seed = [
    adult('ADULTA', 'adulta@fixture.invalid'),
    adult('MADRE', CONTACT),                                                    // la madre tiene además su propia cuenta
    rep('K1'), rep('K2'),                                                       // hermanos, mismo contacto
    rep('DIS', { accountStatus: 'disabled' }),
    rep('INV', { accountStatus: 'invited', password: undefined, inviteToken: crypto.randomBytes(32).toString('hex'), inviteExpiresAt: Date.now() + 3_600_000 }),
    adult('COLE', 'cole@fixture.invalid', { b2c: undefined, createdVia: undefined, organizationId: 'org-1', colegio: 'Colegio Alfa' }),
    adult('ADM', 'adm@fixture.invalid', { roles: ['administrador'] }),
    adult('LEG', 'legado@fixture.invalid', { resetToken: LEGACY, resetExpiresAt: Date.now() + 3_600_000 }), // token heredado en claro
];
fs.writeFileSync(USERS, JSON.stringify(seed, null, 2));
fs.writeFileSync(path.join(tmp, 'g.json'), '[]'); fs.writeFileSync(path.join(tmp, 's.json'), JSON.stringify([{ id: 'org-1', name: 'Colegio Alfa' }]));
const future = Date.now() + 300 * 86400000;
fs.writeFileSync(ACCESS, JSON.stringify(['ADULTA', 'K1', 'K2'].map((id) => ({ id: `access-b2c-test-order-${id}`, scope: 'user', scopeId: id, titleIds: ['obra-1'], collectionIds: [], expiresAt: future, b2c: { orderId: id, idempotencyKey: `test:order:${id}` } }))));
fs.writeFileSync(path.join(tmp, 'c.json'), JSON.stringify([{ id: 'obra-1', titulo: 'Obra 1', tipo: 'libro' }]));
fs.writeFileSync(key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(key, 0o400);
const REG = a2RegistryPath(); approveTestDocuments();
appendDecisions(['T', 'A0', 'A1'].map((kind) => ({ subjectId: 'K1', kind, status: 'granted', actDay: dayOf(Date.now()), version: kind === 'T' ? '002@1.0' : '004@1.0', medium: 'in_app', capacity: 'legal_representative', verification: 'unverified', requestRef: `SINT-F4A-${kind}` })), { env: { CHP_A2_REGISTRY: REG } });

const port = await freePort(); const base = `http://127.0.0.1:${port}`;
let logs = '';
const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: path.join(tmp, 'data'), USERS_DB: USERS,
    GROUPS_DB: path.join(tmp, 'g.json'), SCHOOLS_DB: path.join(tmp, 's.json'), ACCESS_DB: ACCESS, CONTENT_DB: path.join(tmp, 'c.json'),
    UPLOADS_ROOT: path.join(tmp, 'up'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'o.db'), USER_AUDIT_DB: path.join(tmp, 'audit.json'),
    IDENTITY_DB: path.join(tmp, 'i.db'), IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: path.join(tmp, 'in.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'e.db'), PROGRESS_SQLITE_PATH: path.join(tmp, 'p.db'),
    SESSIONS_DB: path.join(tmp, 'se.db'), SESSION_KEY_CURRENT_PATH: key, ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce', CHP_A2_REGISTRY: REG,
} });
child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });

const stored = () => JSON.parse(fs.readFileSync(USERS, 'utf8'));
const user = (id) => stored().find((u) => u.id === id);
const tsNow = () => String(Math.floor(Date.now() / 1000));
const signed = async (cuerpo, { secret = SECRET, ts = tsNow(), tamper = false } = {}) => {
    const raw = JSON.stringify(cuerpo);
    const r = await fetch(`${base}/api/b2c/password-reset`, { method: 'POST', headers: { 'content-type': 'application/json', [B2C_TS_HEADER]: ts, [B2C_SIG_HEADER]: signB2cRequest(secret, ts, raw) }, body: tamper ? raw.replace('}', ',"x":1}') : raw });
    const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
    return { status: r.status, body, text };
};
const ask = (identifier) => signed({ source: 'test', identifier });
const tokenOf = (r) => r.body?.resetUrl?.split('token=')[1] ?? '';
const post = async (url, body, cookie) => { const r = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie, 'sec-fetch-site': 'same-origin' } : {}) }, body: JSON.stringify(body) }); const text = await r.text(); let b = null; try { b = JSON.parse(text); } catch { /* */ } return { status: r.status, body: b, text, headers: r.headers }; };
const login = async (identifier, password) => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identifier, password }) }); return { status: r.status, cookie: (r.headers.get('set-cookie') || '').match(/chp_session=[^;]+/)?.[0] ?? null }; };
const me = async (cookie) => (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status;
const canRead = async (cookie, id) => { const r = await fetch(`${base}/api/content/obra-1/access?userId=${id}`, { headers: { cookie } }); const b = await r.json().catch(() => null); return r.status === 200 && b?.allowed === true; };
const progress = async (cookie, id) => { const r = await fetch(`${base}/api/progress/user/${id}`, { headers: { cookie } }); const b = await r.json().catch(() => null); return r.status === 200 ? (b?.progressList || []).length : `HTTP${r.status}`; };
const confirm = (token, password) => post('/api/auth/reset-confirm', { token, password });
const NOT_ISSUED = '{"status":"not_issued"}';
const HEX64 = /[0-9a-f]{64}/;

try {
    for (let i = 0; ; i++) {
        try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* arrancando */ }
        if (i > 200 || child.exitCode !== null) throw new Error(`no arrancó\n${logs.slice(-2000)}`);
        await sleep(150);
    }
    const usersBefore = fs.readFileSync(USERS, 'utf8'), accessBefore = fs.readFileSync(ACCESS, 'utf8'), regBefore = fs.readFileSync(REG, 'utf8');

    console.log('[1] autenticación del canal');
    const body1 = { source: 'test', identifier: 'adulta@fixture.invalid' };
    ok('sin cabeceras → 401', (await post('/api/b2c/password-reset', body1)).status === 401);
    ok('secreto distinto, marca de tiempo vieja y cuerpo alterado → 401', (await signed(body1, { secret: 'x'.repeat(64) })).status === 401 && (await signed(body1, { ts: String(Math.floor(Date.now() / 1000) - 600) })).status === 401 && (await signed(body1, { tamper: true })).status === 401);
    ok('entrada inválida con firma correcta → 400 sin datos', (await signed({ source: 'otra', identifier: 'adulta@fixture.invalid' })).text === '{"status":"error","code":"invalid_source"}' && (await signed({ source: 'test' })).text === '{"status":"error","code":"invalid_identifier"}');
    ok('nada de lo anterior escribió en el padrón', fs.readFileSync(USERS, 'utf8') === usersBefore);

    console.log('[2] los endpoints públicos no emiten nada');
    const pub = [];
    for (const [url, id] of [['/api/auth/reset-request', 'adulta@fixture.invalid'], ['/api/auth/reset-request', L.K1], ['/api/auth/reset-request', 'nadie@fixture.invalid'], ['/api/request-password-reset', L.GHOST]]) pub.push(await post(url, { email: id }));
    ok('correo real, usuario real, correo y usuario inexistentes → mismo estado y mismo cuerpo', pub.every((r) => r.status === 202 && r.text === pub[0].text));
    ok('…sin token, correo, usuario ni dato de cuenta; y sin escribir nada', !HEX64.test(pub[0].text) && !/@|lec-|token|user/i.test(pub[0].text) && fs.readFileSync(USERS, 'utf8') === usersBefore);

    console.log('[3] cuenta adulta por correo');
    const sesA = await login('adulta@fixture.invalid', pw('ADULTA'));
    const a = await ask('  ADULTA@Fixture.Invalid ');
    const tA = tokenOf(a);
    ok('emitido para esa cuenta: se entrega a su propio correo, con enlace y vencimiento', a.status === 200 && a.body?.status === 'issued' && a.body.deliverTo === 'adulta@fixture.invalid' && a.body.account?.kind === 'adult' && HEX64.test(tA) && a.body.resetUrl === `/#/reset-password?token=${tA}` && Math.abs(a.body.expiresAt - (Date.now() + B2C_RESET_TTL_MS)) < 10_000);
    ok('la respuesta firmada no trae contraseña, identificador interno ni datos de otras cuentas', Object.keys(a.body).sort().join() === 'account,deliverTo,expiresAt,resetUrl,status' && !/"password"|"id"|lec-/.test(a.text));
    ok('en el padrón queda solo el resumen del token', user('ADULTA').resetToken === hashResetToken(tA) && user('ADULTA').resetToken.startsWith(RESET_TOKEN_HASH_PREFIX) && !fs.readFileSync(USERS, 'utf8').includes(tA));
    ok('la solicitud NO cambia la contraseña ni cierra la sesión', user('ADULTA').password === seed[0].password && (await me(sesA.cookie)) === 200 && (await login('adulta@fixture.invalid', pw('ADULTA'))).status === 200);
    const cA = await confirm(tA, NEW('ADULTA'));
    ok('confirmación con el token → 200; la respuesta no trae token ni contraseña', cA.status === 200 && cA.body?.user?.id === 'ADULTA' && !HEX64.test(cA.text) && !/"password"|resetToken/.test(cA.text));
    ok('entra con la nueva, no con la anterior; las sesiones previas quedan cerradas', (await login('adulta@fixture.invalid', NEW('ADULTA'))).status === 200 && (await login('adulta@fixture.invalid', pw('ADULTA'))).status === 401 && (await me(sesA.cookie)) === 401);
    ok('el token quedó consumido: no vuelve a servir', (await confirm(tA, NEW('ADULTA') + 'x')).status === 404 && user('ADULTA').resetToken === undefined && user('ADULTA').resetExpiresAt === undefined);

    console.log('[4] cuenta representada por usuario de acceso');
    const sesK1 = await login(L.K1, pw('K1')), sesK2 = await login(L.K2, pw('K2'));
    await post('/api/progress/K1/obra-1/sync', { canonicalProgress: { globalPercentage: 42 }, updatedAt: new Date().toISOString() }, sesK1.cookie);
    const k1 = await ask(L.K1.toUpperCase()); const t1 = tokenOf(k1);
    ok('emitido para ESE lector: se entrega al contacto del adulto, con su usuario', k1.body?.status === 'issued' && k1.body.deliverTo === CONTACT && k1.body.account?.kind === 'represented' && k1.body.account.loginId === L.K1 && HEX64.test(t1));
    ok('…sin tocar su contraseña, su versión de credencial ni su sesión', user('K1').password === seed[2].password && user('K1').credentialVersion === 2 && (await me(sesK1.cookie)) === 200);
    ok('conocer el usuario no da el token: la vía pública sigue devolviendo lo mismo', (await post('/api/auth/reset-request', { email: L.K1 })).text === pub[0].text);
    const c1 = await confirm(t1, NEW('K1'));
    ok('el adulto confirma con el token → el lector entra con SU usuario y la nueva contraseña', c1.status === 200 && c1.body?.user?.loginId === L.K1 && (await login(L.K1, NEW('K1'))).status === 200 && (await login(L.K1, pw('K1'))).status === 401);
    ok('…la respuesta no trae el contacto del adulto ni la clave del pedido', !c1.text.includes(CONTACT) && !/representedBy|b2cOrigin/.test(c1.text));
    ok('el correo del adulto sigue sin ser una identidad de ese lector', (await login(CONTACT, NEW('K1'))).status === 401);

    console.log('[5] hermanos y correo del adulto');
    ok('recuperar a un hermano no tocó al otro: contraseña, sesión y sin token pendiente', user('K2').password === seed[3].password && user('K2').resetToken === undefined && (await me(sesK2.cookie)) === 200 && (await login(L.K2, pw('K2'))).status === 200);
    const k2 = await ask(L.K2); const t2 = tokenOf(k2);
    ok('el otro hermano pide lo suyo: token distinto, mismo contacto, su propio usuario', k2.body?.status === 'issued' && t2 !== t1 && k2.body.deliverTo === CONTACT && k2.body.account.loginId === L.K2);
    const m = await ask(CONTACT); const tM = tokenOf(m);
    ok('pedir con el correo del adulto recupera la cuenta del ADULTO: ningún usuario lec- en la respuesta', m.body?.status === 'issued' && m.body.account?.kind === 'adult' && m.body.deliverTo === CONTACT && !/lec-/.test(m.text));
    const cM = await confirm(tM, NEW('MADRE'));
    ok('…y ese token cambia SOLO la cuenta del adulto, no las de sus hijos', cM.status === 200 && cM.body.user.id === 'MADRE' && (await login(L.K1, NEW('K1'))).status === 200 && (await login(L.K2, pw('K2'))).status === 200 && (await login(L.K1, NEW('MADRE'))).status === 401 && (await login(L.K2, NEW('MADRE'))).status === 401);
    const c2 = await confirm(t2, NEW('K2'));
    ok('el token de cada hermano cambia solo su cuenta', c2.status === 200 && c2.body.user.id === 'K2' && (await login(L.K2, NEW('K2'))).status === 200 && (await login(L.K1, NEW('K2'))).status === 401 && (await login(L.K1, NEW('K1'))).status === 200);

    console.log('[6] no se emite: respuestas idénticas');
    const snap = fs.readFileSync(USERS, 'utf8');
    const none = [];
    for (const id of ['nadie@fixture.invalid', L.GHOST, L.DIS, L.INV, 'cole@fixture.invalid', 'adm@fixture.invalid']) none.push(await ask(id));
    ok('inexistente (correo y usuario), desactivada, sin activar, institucional y administrador → 200 con el MISMO cuerpo', none.every((r) => r.status === 200 && r.text === NOT_ISSUED), none.map((r) => `${r.status}:${r.text}`).join(' '));
    ok('…sin escribir nada en el padrón', fs.readFileSync(USERS, 'utf8') === snap);
    ok('la cuenta desactivada sigue sin poder entrar', (await login(L.DIS, pw('DIS'))).status === 401);

    console.log('[7] token vencido, reutilizado y resumen presentado');
    const tExp = tokenOf(await ask('adulta@fixture.invalid'));
    const all = stored(); const ia = all.findIndex((u) => u.id === 'ADULTA'); all[ia].resetExpiresAt = Date.now() - 1000; fs.writeFileSync(USERS, JSON.stringify(all, null, 2));
    const ex = await confirm(tExp, NEW('ADULTA') + '2');
    ok('token vencido → 410 y la contraseña no cambia', ex.status === 410 && ex.body?.code === 'TOKEN_EXPIRED' && (await login('adulta@fixture.invalid', NEW('ADULTA'))).status === 200);
    ok('token inexistente → 404; token ya usado → 404', (await confirm('f'.repeat(64), NEW('X'))).status === 404 && (await confirm(t1, NEW('K1') + '2')).status === 404);
    const tH = tokenOf(await ask('adulta@fixture.invalid'));
    ok('presentar el resumen almacenado en lugar del token → 404', HEX64.test(tH) && (await confirm(user('ADULTA').resetToken, NEW('X'))).status === 404 && (await confirm(user('ADULTA').resetToken.slice(RESET_TOKEN_HASH_PREFIX.length), NEW('X'))).status === 404);
    ok('contraseña débil con token válido → 400 y el token sigue disponible', (await confirm(tH, 'corta')).status === 400 && user('ADULTA').resetToken === hashResetToken(tH));

    console.log('[8] solicitudes repetidas y abuso');
    const sesA2 = await login('adulta@fixture.invalid', NEW('ADULTA'));
    const cvBefore = user('ADULTA').credentialVersion; const hashBefore = user('ADULTA').resetToken;
    const burst = []; for (let i = 0; i < 8; i++) burst.push(await ask('adulta@fixture.invalid'));
    ok('ocho solicitudes seguidas → ninguna emite otro token; el enlace enviado sigue siendo el mismo', burst.every((r) => r.text === NOT_ISSUED) && user('ADULTA').resetToken === hashBefore);
    ok('…ni cierran la sesión, ni cambian la contraseña o la versión de credencial', (await me(sesA2.cookie)) === 200 && user('ADULTA').credentialVersion === cvBefore && (await login('adulta@fixture.invalid', NEW('ADULTA'))).status === 200);
    ok('el enlace original sigue sirviendo después del abuso', (await confirm(tH, NEW('ADULTA') + '-3')).status === 200 && (await login('adulta@fixture.invalid', NEW('ADULTA') + '-3')).status === 200);
    const lim = await confirm('f'.repeat(64), NEW('X'));
    ok('la confirmación conserva su límite de intentos por origen', lim.headers.get('ratelimit-limit') !== null || lim.headers.get('ratelimit') !== null, [...lim.headers.keys()].filter((k) => k.includes('rate')).join());

    console.log('[9] decisiones, acceso, progreso y demás cuentas');
    const k1New = await login(L.K1, NEW('K1'));
    ok('el lector recuperado conserva su suscripción y su progreso', (await canRead(k1New.cookie, 'K1')) === true && (await progress(k1New.cookie, 'K1')) === 1);
    ok('reglas de acceso y registro de decisiones: sin un solo cambio', fs.readFileSync(ACCESS, 'utf8') === accessBefore && fs.readFileSync(REG, 'utf8') === regBefore);
    ok('identidad intacta: usuario, contacto, clave del pedido, estado y roles de todas las cuentas', stored().every((u) => { const b = seed.find((x) => x.id === u.id); return u.loginId === b.loginId && JSON.stringify(u.representedBy) === JSON.stringify(b.representedBy) && u.email === b.email && u.b2cOrigin === b.b2cOrigin && u.accountStatus === b.accountStatus && JSON.stringify(u.roles) === JSON.stringify(b.roles); }));
    ok('cuentas que nadie recuperó: contraseña intacta', ['DIS', 'COLE', 'ADM'].every((id) => user(id).password === seed.find((x) => x.id === id).password) && (await login('cole@fixture.invalid', pw('COLE'))).status === 200 && (await login('adm@fixture.invalid', pw('ADM'))).status === 200);

    console.log('[10] compatibilidad y registros');
    const leg = await confirm(LEGACY, NEW('LEG'));
    ok('un token heredado guardado en claro sigue confirmándose como antes', leg.status === 200 && leg.body.user.id === 'LEG' && (await login('legado@fixture.invalid', NEW('LEG'))).status === 200 && (await confirm(LEGACY, NEW('LEG') + 'x')).status === 404);
    ok('los registros del servidor no contienen tokens, el secreto ni correos completos', !HEX64.test(logs) && !logs.includes(SECRET) && !/[\w.+-]+@fixture\.invalid/i.test(logs), (logs.match(/[\w.+-]+@fixture\.invalid/i) || [''])[0]);
    ok('…y sí dejan constancia de cada emisión sin datos personales', (logs.match(/\[B2C\] password-reset test → issued/g) || []).length === 6 && /\[B2C\] password-reset test → not_issued \(cooldown\)/.test(logs));
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(B2C_PROVISIONING_SECRET_PATH, { force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
