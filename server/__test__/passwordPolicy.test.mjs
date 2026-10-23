/**
 * passwordPolicy.test.mjs — SEC-USERS-01 / Unidad A.
 * Política mínima de contraseñas nuevas: pura, sin disco ni red.
 *
 *   node server/__test__/passwordPolicy.test.mjs
 */
import bcrypt from 'bcryptjs';
import { checkNewPassword, hashNewPassword, KNOWN_DEFAULT_PASSWORDS, BCRYPT_COST } from '../lib/passwordPolicy.js';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const code = (pw, o) => { const r = checkNewPassword(pw, o); return r.ok ? 'ok' : r.code; };

console.log('\n[1] predeterminadas conocidas');
ok('chibalete123 → default_password', code('chibalete123') === 'default_password');
ok('variantes de mayúsculas/espacios → default_password', code('  ChIbAlEtE123 ') === 'default_password');
ok('12345678 → default_password', code('12345678') === 'default_password');
ok('la lista incluye el default histórico de la UI', KNOWN_DEFAULT_PASSWORDS.has('chibalete123'));

console.log('\n[2] hashes aportados por el cliente');
const h = bcrypt.hashSync('una-clave-cualquiera', 4);
ok('hash bcrypt real ($2a/$2b) → hash_not_allowed', code(h) === 'hash_not_allowed');
for (const p of ['$2a$10$x', '$2b$12$abc', '$2y$10$abc', '$2$10$abc', '$2x$10$abc']) ok(`${p.slice(0, 4)}… → hash_not_allowed`, code(p) === 'hash_not_allowed');
ok('"$" suelto no es hash', code('$ombra-larga-9') === 'ok');

console.log('\n[3] email y longitud');
ok('igual al email → matches_email', code('ana@colegio.edu', { email: 'Ana@Colegio.edu' }) === 'matches_email');
ok('igual a la parte local → matches_email', code('Ana.Perez', { email: 'ana.perez@x.org' }) === 'matches_email');
ok('minLength respeta el contrato de la ruta', code('corta7!', { minLength: 8 }) === 'too_short');
ok('sin minLength no impone longitud nueva', code('k9#Lm2') === 'ok');
ok('vacío / no string → invalid', code('') === 'invalid' && code(undefined) === 'invalid' && code(12345678) === 'invalid');

console.log('\n[4] aceptación y hash del servidor');
ok('contraseña razonable → ok', code('Ríos-de-tinta-42', { email: 'x@y.z', minLength: 8 }) === 'ok');
const r = checkNewPassword('chibalete123');
ok('el resultado no contiene el valor evaluado', !JSON.stringify(r).includes('chibalete123'));
const hashed = await hashNewPassword('Ríos-de-tinta-42');
ok('hashNewPassword produce bcrypt del coste declarado', hashed.startsWith(`$2b$${String(BCRYPT_COST).padStart(2, '0')}$`) || hashed.startsWith(`$2a$${String(BCRYPT_COST).padStart(2, '0')}$`));
ok('el hash verifica la contraseña', await bcrypt.compare('Ríos-de-tinta-42', hashed));
ok('el servidor hashea incluso valores con aspecto de hash (nunca passthrough)', (await hashNewPassword('$2b$10$abc')) !== '$2b$10$abc');

console.log(`\npasswordPolicy — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
