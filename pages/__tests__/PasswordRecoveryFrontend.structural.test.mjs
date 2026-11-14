/**
 * PasswordRecoveryFrontend.structural.test.mjs — CHP V9 F4-B2.
 *
 * «¿Olvidaste tu contraseña?» en Chibalete+ lleva a la página pública de recuperación de la tienda (V9 F4-B1);
 * la app no tiene formulario propio de solicitud y el restablecimiento por token es el que ya existía.
 *
 *   §1  enlace desde el formulario de acceso
 *   §2  sin token: indicación y enlace, ningún formulario de solicitud dentro de la app
 *   §3  con token: restablecimiento existente, mensajes y accesibilidad
 *   §4  el token no sale del formulario
 *   §5  contratos del servidor en los que se apoya (sin cambios)
 *
 *   node pages/__tests__/PasswordRecoveryFrontend.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const auth = read('pages', 'Auth.tsx');
const reset = read('pages', 'ResetPassword.tsx');
const util = read('utils', 'passwordRecovery.ts');
const app = read('App.tsx');
const server = read('server', 'server.js');

let pass = 0, fail = 0;
const ok = (l, c) => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l), fail++));
const section = (n) => console.log(`\n${n}`);
const URL_RX = /export const STORE_PASSWORD_RECOVERY_URL = '([^']+)';/;
const url = util.match(URL_RX)?.[1] ?? '';

section('§1 enlace desde el acceso');
ok('dirección única y fija: la página de recuperación de la tienda, por https y sin datos', url === 'https://chibaleteeditores.com/?chplus-clave=1' && (util.match(/export const/g) || []).length === 1);
const loginForm = auth.slice(auth.indexOf('<form onSubmit={handleLogin}'), auth.indexOf('<form onSubmit={handleRegister}'));
ok('«¿Olvidaste tu contraseña?» es un enlace real a esa página (ya no href="#")', /<a href=\{STORE_PASSWORD_RECOVERY_URL\}[^>]*>¿Olvidaste tu contraseña\?<\/a>/.test(loginForm) && !/href="#"/.test(loginForm));
ok('…sin datos del formulario en la dirección, sin referente y sin ventana emergente', !/STORE_PASSWORD_RECOVERY_URL\s*\+|\$\{STORE_PASSWORD_RECOVERY_URL\}|formData[^\n]*STORE_PASSWORD/.test(auth) && /referrerPolicy="no-referrer"/.test(loginForm) && /rel="noopener noreferrer"/.test(loginForm) && !/target="_blank"[^>]*>¿Olvidaste/.test(loginForm));
ok('…reconocible y con foco visible para teclado', /underline[^"]*focus:ring-2[^"]*">¿Olvidaste tu contraseña\?/.test(loginForm));
ok('sigue habiendo un único formulario de acceso, por correo o usuario', (auth.match(/onSubmit=\{handleLogin\}/g) || []).length === 1 && loginForm.includes('aria-label="Correo electrónico o usuario"'));

section('§2 sin token');
const request = reset.slice(reset.indexOf('// ── MODO 1'), reset.indexOf('// ── MODO 2'));
ok('la app no tiene formulario de solicitud: ni campos, ni envío, ni llamadas', request.length > 0 && !/<form|<input|onSubmit|fetch\(/.test(request));
ok('nadie llama ya a /api/request-password-reset desde el frontend', !/request-password-reset|reset-request/.test(reset) && !/request-password-reset|reset-request/.test(auth));
ok('explica el camino y enlaza la página de la tienda', request.includes('href={STORE_PASSWORD_RECOVERY_URL}') && request.includes('Recuperar mi contraseña en la tienda') && request.includes('usuario de acceso (empieza por «lec-»)'));
ok('conserva la vía institucional: colegio o club → su administrador', request.includes('Si tu cuenta es de un colegio o un club, pide ayuda a su administrador.'));
ok('no afirma nada sobre la existencia de una cuenta', !/existe una cuenta|encontramos|no encontramos|registrad[oa] con/i.test(request));
ok('la ruta es la de siempre y sigue siendo una sola', (app.match(/path="\/reset-password"/g) || []).length === 1 && /searchParams\.get\('token'\)/.test(reset));

section('§3 con token');
const confirm = reset.slice(reset.indexOf('// ── MODO 2'), reset.indexOf('// ── Componente raíz'));
ok('usa el restablecimiento existente con { token, password }', /fetch\('\/api\/confirm-password-reset'[\s\S]{0,200}body: JSON\.stringify\(\{ token, password \}\)/.test(confirm));
ok('mensajes de enlace vencido, inválido o ya utilizado, y cuenta no restablecible', confirm.includes('El enlace de restablecimiento expiró. Solicita uno nuevo.') && confirm.includes('Enlace inválido o ya utilizado.') && confirm.includes('No se puede restablecer esta cuenta.'));
ok('desde un enlace vencido o inválido se vuelve a pedir en la tienda', /errorInfo\.code === 'TOKEN_EXPIRED' \|\| errorInfo\.code === 'INVALID_TOKEN'[\s\S]{0,200}href=\{STORE_PASSWORD_RECOVERY_URL\}[\s\S]{0,300}Solicitar un nuevo enlace/.test(confirm) && !/to="\/reset-password"/.test(confirm));
ok('errores anunciados (role="alert") y éxito (role="status")', (confirm.match(/role="alert"/g) || []).length === 2 && confirm.includes('role="status"'));
ok('campos y botones de mostrar/ocultar con nombre accesible', confirm.includes('aria-label="Nueva contraseña (mínimo 8 caracteres)"') && confirm.includes('aria-label="Confirmar contraseña"') && (confirm.match(/aria-pressed=\{show(Password|Confirm)\}/g) || []).length === 2);
ok('las contraseñas se piden como nuevas (autocompletado new-password) y con el mínimo del servidor', (confirm.match(/autoComplete="new-password"/g) || []).length === 2 && confirm.includes('minLength={8}') && /password\.length < 8\) \{\s*return res\.status\(400\)/.test(server));
ok('tras el cambio remite al acceso por correo o por usuario', confirm.includes('Ya puedes ingresar con tu correo o con el usuario de acceso de la cuenta.') && confirm.includes("navigate('/auth')"));

section('§4 el token no sale del formulario');
ok('el token solo viaja en el cuerpo de la confirmación', (reset.match(/\btoken\b/g) || []).length > 0 && !/console\.|localStorage|sessionStorage|document\.cookie/.test(reset) && (reset.match(/JSON\.stringify\(\{ token, password \}\)/g) || []).length === 1);
ok('ningún enlace de la pantalla arrastra el token', !/href=\{[^}]*token|to=\{[^}]*token|\?token=\$\{/.test(reset));

section('§5 contratos del servidor (sin cambios)');
ok('la confirmación compara el token emitido por la tienda (resumen) y los heredados', server.includes('resetTokenMatches(u?.resetToken, token)'));
ok('respuestas 404 / 409 / 410 de la confirmación', /status\(404\)\.json\(\{ error: 'Token inválido o ya utilizado' \}\)/.test(server) && /status\(410\)\.json\(\{ error: 'El enlace de restablecimiento expiró\.[^']*', code: 'TOKEN_EXPIRED' \}\)/.test(server) && /conflict === 'not_active'\) return res\.status\(409\)/.test(server));
ok('el endpoint público de solicitud sigue sin emitir nada', server.includes("log('Password reset solicitado: no se emite token (sin canal de entrega seguro)', 'ACCESS');"));

console.log(`\nPassword recovery frontend (V9 F4-B2): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
