/**
 * LoginIdFrontend.structural.test.mjs — CHP V9 F3-D4.
 *
 * Activación e inicio de sesión de cuentas representadas mediante su usuario de acceso (`loginId`),
 * solo en el frontend y sobre los contratos existentes de la API (F3-D1/D2).
 *
 *   §1  inicio de sesión: un solo formulario, identificador = correo o usuario, mismo contrato
 *   §2  activación: muestra el usuario que devuelve la API, sin buscarlo ni mostrar el contacto
 *   §3  enlace vencido: remite a la recuperación de la tienda sin quitar la indicación institucional
 *   §4  perfil: usuario de acceso en lugar de un correo inexistente, solo lectura
 *   §5  contratos del servidor en los que se apoya (sin cambios en este paso)
 *
 *   node pages/__tests__/LoginIdFrontend.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { B2C_LOGIN_ID_RX } from '../../server/b2c/b2cProvisioning.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const auth = read('pages', 'Auth.tsx');
const act = read('pages', 'ActivarCuenta.tsx');
const perfil = read('pages', 'Perfil.tsx');
const types = read('types', 'index.ts');
const service = read('services', 'dataService.ts');
const server = read('server', 'server.js');
const app = read('App.tsx');

let pass = 0, fail = 0;
const ok = (l, c) => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l), fail++));
const section = (n) => console.log(`\n${n}`);

section('§1 inicio de sesión');
const loginForm = auth.slice(auth.indexOf('<form onSubmit={handleLogin}'), auth.indexOf('<form onSubmit={handleRegister}'));
ok('un solo formulario de ingreso y una sola ruta /auth', (auth.match(/onSubmit=\{handleLogin\}/g) || []).length === 1 && (app.match(/path="\/auth"/g) || []).length === 1);
ok('el identificador ya no es type="email": admite correo o usuario', loginForm.length > 0 && !/type="email"/.test(loginForm) && /name="email"[\s\S]{0,400}type="text"/.test(loginForm));
ok('etiqueta «Correo electrónico o usuario» visible y accesible', loginForm.includes('placeholder="Correo electrónico o usuario"') && loginForm.includes('aria-label="Correo electrónico o usuario"'));
ok('sin corrección ni mayúsculas automáticas; autocompletado de usuario', loginForm.includes('autoComplete="username"') && loginForm.includes('autoCapitalize="none"') && loginForm.includes('spellCheck={false}'));
ok('sigue siendo obligatorio y sin patrón de correo en el cliente', /name="email"[\s\S]{0,700}required/.test(loginForm) && !/pattern=/.test(loginForm));
ok('contraseña: etiqueta, autocompletado y mostrar/ocultar accesible', loginForm.includes('aria-label="Contraseña"') && loginForm.includes('autoComplete="current-password"') && loginForm.includes('aria-pressed={showPassword}'));
ok('el error de ingreso se anuncia (role="alert") con el mensaje del servidor', auth.includes('<div role="alert"') && auth.includes("setError(e?.message || 'Error al iniciar sesión. Intenta nuevamente.')"));
ok('mismo contrato: POST /auth/login con { email, password }', auth.includes('dataService.validarCredenciales(formData.email.trim(), formData.password)')
    && /fetch\(`\$\{this\.apiUrl\}\/auth\/login`[\s\S]{0,200}body: JSON\.stringify\(\{ email, password \}\)/.test(service));
ok('los mensajes 401 y 429 del servidor se conservan', service.includes("body.error || 'Credenciales inválidas'") && service.includes('Demasiados intentos'));

section('§2 activación');
const rx = act.match(/const LOGIN_ID_RX = (\/.+\/);/);
ok('la forma del usuario es la del servidor', !!rx && rx[1] === String(B2C_LOGIN_ID_RX));
ok('el usuario sale SOLO de la respuesta de la activación, de una cuenta sin correo', act.includes("typeof data?.user?.loginId === 'string' && !data.user.email && LOGIN_ID_RX.test(data.user.loginId)"));
ok('no consulta usuarios ni el padrón para obtenerlo', !/\/api\/users|getAllUsers|getUsuarioById|dataService/.test(act));
ok('no muestra el contacto del representante', !/representedBy/.test(act));
ok('se muestra con rótulo, seleccionable y con botón para copiar', act.includes('Usuario de acceso del lector') && act.includes('select-all') && act.includes('navigator.clipboard.writeText(loginId)') && act.includes('Copiar usuario'));
ok('la copia se anuncia (role="status", aria-live)', /role="status" aria-live="polite"[\s\S]{0,160}Usuario copiado\./.test(act));
ok('explica que se entra con el usuario y no con un correo', act.includes('Para entrar se usa este usuario (no un correo)'));
ok('las cuentas con correo ven el mensaje de siempre', act.includes("'Tu cuenta está lista. Ya puedes ingresar con tu nueva contraseña.'"));
ok('las decisiones no cambian: A0, A1, A2, A3 y A5, sin premarcar', ['name="A0"', 'name="A1"', 'name="A2"', 'name="A3"', 'name="A5"'].every((x) => act.includes(x)) && !/defaultChecked|checked=\{true\}/.test(act));
ok('el cuerpo enviado a /api/accept-invite no lleva usuario ni datos nuevos', /body: JSON\.stringify\(\{\s*token, password,\s*acceptance: \{/.test(act) && !/loginId[^\n]*JSON\.stringify|JSON\.stringify\([^)]*loginId/.test(act));

section('§3 enlace vencido');
ok('se conserva la indicación institucional', act.includes('pide a tu administrador que reenvíe la invitación'));
ok('remite a la recuperación de enlace de la tienda', act.includes("const STORE_LINK_RECOVERY_URL = 'https://chibaleteeditores.com/?chplus-enlace=1';") && act.includes('recuperar el enlace de activación'));
ok('enlace externo seguro, solo con TOKEN_EXPIRED', /errorInfo\.code === 'TOKEN_EXPIRED' && \(\s*<p[\s\S]{0,400}href=\{STORE_LINK_RECOVERY_URL\} target="_blank" rel="noopener noreferrer"/.test(act));
ok('el enlace no arrastra el token ni datos del lector', !/STORE_LINK_RECOVERY_URL\s*\+|\$\{STORE_LINK_RECOVERY_URL\}/.test(act));
ok('el error se anuncia (role="alert")', act.includes('<div role="alert"'));

section('§4 perfil');
ok('usuario de acceso solo en el perfil propio, con correo vacío y loginId', perfil.includes('{isOwnProfile && !currentUser?.email && currentUser?.loginId && ('));
ok('se muestra como texto: sin campo ni acción de edición', /Usuario de acceso: <code className="font-mono select-all">\{currentUser\.loginId\}<\/code>/.test(perfil) && !/<input[^>]*loginId|representedBy/.test(perfil));
ok('el tipo User declara loginId como dato opcional', /loginId\?: string;/.test(types) && !/representedBy/.test(types));
ok('la pestaña Seguridad sigue igual', perfil.includes("{activeTab === 'seguridad' && isOwnProfile && <PasswordChangeSection onChanged={logout} />}"));

section('§5 contratos del servidor (sin cambios)');
ok('la activación devuelve la cuenta saneada (incluye loginId, nunca credenciales)', /return res\.status\(200\)\.json\(\{\s*success: true,\s*user:\s*sanitizeUserForClient\(activated\),/.test(server)
    && /const \{ password, inviteToken, inviteExpiresAt, resetToken, resetExpiresAt, \.\.\.safeUser \} = user;/.test(server));
ok('el enlace vencido responde 410 TOKEN_EXPIRED', /status\(410\)\.json\(\{ error: 'El enlace de invitación expiró\.[^']*', code: 'TOKEN_EXPIRED' \}\)/.test(server));

console.log(`\nLoginId frontend (V9 F3-D4): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
