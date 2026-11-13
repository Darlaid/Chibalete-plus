/**
 * b2cPasswordReset.unit.test.mjs — CHP V9 F4-A.
 *
 * Decisión pura de la solicitud de recuperación de contraseña por el canal firmado de la tienda
 * (`server/b2c/b2cPasswordReset.mjs`): a quién se resuelve, a quién se entrega, cuándo no se emite
 * y cómo se compara el token. No arranca el servidor ni toca almacenes.
 *
 *   node server/__test__/b2cPasswordReset.unit.test.mjs
 */
import crypto from 'node:crypto';
import { validatePasswordResetInput, planPasswordReset, hashResetToken, resetTokenMatches,
    B2C_RESET_TTL_MS, B2C_RESET_COOLDOWN_MS, RESET_TOKEN_HASH_PREFIX } from '../b2c/b2cPasswordReset.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const norm = (e) => (e ? String(e).trim().toLowerCase() : '');
const code = (fn) => { try { fn(); return 'sin-error'; } catch (e) { return `${e.status}:${e.code}`; } };

const CONTACT = 'madre@x.test';
const L1 = 'lec-aaaa-bbbb-cccc', L2 = 'lec-dddd-eeee-ffff';
const rep = (id, loginId, extra = {}) => ({ id, email: '', loginId, representedBy: { email: CONTACT }, nombre_completo: 'Lector', nombre_usuario: loginId, roles: ['lector'], accountStatus: 'active', b2c: true, password: 'h-' + id, credentialVersion: 3, ...extra });
const adult = (id, email, extra = {}) => ({ id, email, nombre_completo: id, roles: ['lector'], accountStatus: 'active', b2c: true, password: 'h-' + id, ...extra });
const users = () => [
    adult('MADRE', CONTACT),                                  // la madre tiene además su propia cuenta B2C
    rep('K1', L1), rep('K2', L2),                             // dos hermanos, mismo contacto
    adult('ADULTA', 'adulta@x.test'),
    rep('DIS', 'lec-3333-4444-5555', { accountStatus: 'disabled' }),
    rep('INV', 'lec-6666-7777-8888', { accountStatus: 'invited', inviteToken: 'x'.repeat(64) }),
    { id: 'COLE', email: 'cole@x.test', roles: ['lector'], accountStatus: 'active', organizationId: 'org-1', password: 'h' },   // institucional
    adult('ADM', 'adm@x.test', { roles: ['administrador'] }),
    adult('MED', 'med@x.test', { roles: ['mediador'] }),
    rep('SINC', 'lec-9999-aaaa-bbbb', { representedBy: { email: 'no-es-correo' } }),
];
const NOW = 1_800_000_000_000;
const TOKEN = crypto.randomBytes(32).toString('hex');
const plan = (identifier, { list = users(), nowMs = NOW, token = TOKEN } = {}) => planPasswordReset({ users: list, input: validatePasswordResetInput({ source: 'test', identifier }, norm), nowMs, token, normalizeEmail: norm });

console.log('[1] entrada');
ok('fuente desconocida o identificador ausente, no cadena, corto o enorme → 400', code(() => validatePasswordResetInput({ source: 'otra', identifier: L1 }, norm)) === '400:invalid_source'
    && [undefined, 7, ['a'], 'ab', 'x'.repeat(255)].every((v) => code(() => validatePasswordResetInput({ source: 'test', identifier: v }, norm)) === '400:invalid_identifier'));
ok('el identificador se normaliza (espacios y mayúsculas)', validatePasswordResetInput({ source: 'test', identifier: `  ${L1.toUpperCase()} ` }, norm).identifier === L1);

console.log('[2] cuenta adulta por correo');
const a = plan('adulta@x.test');
ok('se emite para ESA cuenta y se entrega a su propio correo', a.issue === true && a.user.id === 'ADULTA' && a.delivery.deliverTo === 'adulta@x.test' && a.delivery.account.kind === 'adult' && !('loginId' in a.delivery.account));
ok('enlace al restablecimiento existente, con vencimiento de una hora', a.delivery.resetUrl === `/#/reset-password?token=${TOKEN}` && a.delivery.expiresAt === NOW + B2C_RESET_TTL_MS && a.delivery.status === 'issued');
ok('lo guardado es SOLO el resumen del token y su vencimiento', a.user.resetToken === hashResetToken(TOKEN) && a.user.resetToken.startsWith(RESET_TOKEN_HASH_PREFIX) && !JSON.stringify(a.user).includes(TOKEN) && a.user.resetExpiresAt === NOW + B2C_RESET_TTL_MS);
ok('la solicitud no cambia contraseña ni nada más de la cuenta', (() => { const { resetToken, resetExpiresAt, ...rest } = a.user; return JSON.stringify(rest) === JSON.stringify(users()[3]); })());

console.log('[3] cuenta representada por usuario de acceso');
const k1 = plan(L1);
ok('se emite para ESE lector y se entrega al contacto del adulto', k1.issue === true && k1.user.id === 'K1' && k1.delivery.deliverTo === CONTACT && k1.delivery.account.kind === 'represented' && k1.delivery.account.loginId === L1);
ok('la versión de credencial y la contraseña del lector no cambian con la solicitud', k1.user.credentialVersion === 3 && k1.user.password === 'h-K1');
ok('mayúsculas y espacios resuelven la misma cuenta', plan(`  ${L1.toUpperCase()} `).user?.id === 'K1');

console.log('[4] hermanos y correo del adulto');
const k2 = plan(L2);
ok('cada usuario resuelve SOLO a su lector, aunque compartan contacto', k2.user.id === 'K2' && k2.delivery.account.loginId === L2 && k1.index !== k2.index);
const madre = plan(CONTACT);
ok('pedir con el correo del adulto recupera la cuenta del ADULTO, nunca las de sus hijos', madre.issue === true && madre.user.id === 'MADRE' && madre.delivery.account.kind === 'adult' && !JSON.stringify(madre.delivery).includes('lec-'));
ok('…y si ese adulto no tiene cuenta propia, no se emite nada', (() => { const list = users().filter((u) => u.id !== 'MADRE'); return plan(CONTACT, { list }).issue === false; })());

console.log('[5] no se emite');
const none = (identifier, reason) => { const p = plan(identifier); return p.issue === false && p.reason === reason && Object.keys(p).sort().join() === 'issue,reason'; };
ok('correo o usuario inexistente', none('nadie@x.test', 'unknown') && none('lec-zzzz-zzzz-zzzz', 'unknown'));
ok('cuenta desactivada e invitación sin activar', none('lec-3333-4444-5555', 'not_active') && none('lec-6666-7777-8888', 'not_active'));
ok('cuenta institucional (no B2C): sigue con su administrador', none('cole@x.test', 'not_b2c'));
ok('administrador y mediador, aunque tuvieran marca B2C', none('adm@x.test', 'privileged') && none('med@x.test', 'privileged'));
ok('cuenta representada sin un contacto con forma de correo', none('lec-9999-aaaa-bbbb', 'no_recipient'));
ok('un «no emitido» no lleva correo, usuario ni enlace', ['nadie@x.test', 'lec-3333-4444-5555', 'cole@x.test'].every((i) => !/@|lec-|token/.test(JSON.stringify(plan(i)))));

console.log('[6] solicitudes repetidas');
const after = (list, p) => list.map((u, i) => (i === p.index ? p.user : u));
const list1 = after(users(), k1);
ok('segunda solicitud dentro del enfriamiento → no se emite: el enlace enviado sigue valiendo', plan(L1, { list: list1, nowMs: NOW + 60_000, token: 'b'.repeat(64) }).reason === 'cooldown' && plan(L1, { list: list1, nowMs: NOW + B2C_RESET_COOLDOWN_MS - 1, token: 'b'.repeat(64) }).reason === 'cooldown');
ok('el enfriamiento es por cuenta: su hermano sí puede pedir', plan(L2, { list: list1, nowMs: NOW + 60_000 }).issue === true);
const again = plan(L1, { list: list1, nowMs: NOW + B2C_RESET_COOLDOWN_MS, token: 'b'.repeat(64) });
ok('pasado el enfriamiento → token nuevo que reemplaza al anterior', again.issue === true && again.user.resetToken === hashResetToken('b'.repeat(64)) && again.user.resetToken !== k1.user.resetToken);
ok('con el token anterior ya vencido → se emite de nuevo', plan(L1, { list: list1, nowMs: NOW + B2C_RESET_TTL_MS + 1, token: 'c'.repeat(64) }).issue === true);

console.log('[7] comparación del token');
const stored = hashResetToken(TOKEN);
ok('el token correcto coincide con su resumen almacenado', resetTokenMatches(stored, TOKEN));
ok('otro token, vacío o no cadena → no coincide', !resetTokenMatches(stored, 'd'.repeat(64)) && !resetTokenMatches(stored, '') && !resetTokenMatches(stored, undefined) && !resetTokenMatches(undefined, TOKEN) && !resetTokenMatches('', ''));
ok('presentar el propio resumen almacenado NO sirve como token', !resetTokenMatches(stored, stored) && !resetTokenMatches(stored, stored.slice(RESET_TOKEN_HASH_PREFIX.length)));
ok('compatibilidad: un token heredado guardado en claro sigue comparándose por igualdad', resetTokenMatches('legado-en-claro-123', 'legado-en-claro-123') && !resetTokenMatches('legado-en-claro-123', 'legado-en-claro-124'));
ok('2000 tokens de 32 bytes: resúmenes distintos y de longitud fija', (() => { const s = new Set(Array.from({ length: 2000 }, () => hashResetToken(crypto.randomBytes(32).toString('hex')))); return s.size === 2000 && [...s].every((h) => h.length === RESET_TOKEN_HASH_PREFIX.length + 64); })());

console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
