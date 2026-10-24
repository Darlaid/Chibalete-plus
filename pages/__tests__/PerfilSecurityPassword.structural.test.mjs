/**
 * PerfilSecurityPassword.structural.test.mjs — SEC-ACCOUNT-01.
 *
 *   §1  Perfil ofrece la pestaña Seguridad solo en el perfil propio
 *   §2  el formulario pide actual, nueva y confirmación, con mostrar/ocultar
 *   §3  validación de cortesía alineada con el servidor (mínimo 12)
 *   §4  tras el éxito se cierra la sesión local (el servidor ya revocó todas)
 *   §5  dataService llama al endpoint por cookie, sin x-user-id ni id propio,
 *       y nunca registra ni guarda los valores
 *
 *   node pages/__tests__/PerfilSecurityPassword.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const perfil  = fs.readFileSync(path.join(__dirname, '..', 'Perfil.tsx'), 'utf8');
const section_ = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'PasswordChangeSection.tsx'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'dataService.ts'), 'utf8');
const server  = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => cond
    ? (console.log(`  ✓ ${label}`), pass++)
    : (console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`), fail++);
const section = (name) => console.log(`\n${name}`);

section('§1 pestaña Seguridad en Perfil');
ok('importa PasswordChangeSection', perfil.includes("import PasswordChangeSection from '../components/PasswordChangeSection'"));
ok('botón de pestaña solo en el perfil propio', perfil.includes('{isOwnProfile && <TabButton tab="seguridad" label="Seguridad" />}'));
ok('panel solo en el perfil propio y con logout como cierre', perfil.includes("{activeTab === 'seguridad' && isOwnProfile && <PasswordChangeSection onChanged={logout} />}"));

section('§2 formulario');
ok('contraseña actual con autocomplete current-password', /label="Contraseña actual"[\s\S]{0,200}autoComplete="current-password"/.test(section_));
ok('nueva y confirmación con autocomplete new-password', /label="Nueva contraseña"[\s\S]{0,200}autoComplete="new-password"/.test(section_)
    && /label="Confirmar nueva contraseña"[\s\S]{0,200}autoComplete="new-password"/.test(section_));
ok('mostrar/ocultar por campo, accesible', section_.includes("type={visible ? 'text' : 'password'}") && section_.includes('aria-pressed={visible}') && section_.includes('aria-label={visible ?'));
ok('botón «Cambiar contraseña»', section_.includes("'Cambiar contraseña'"));
ok('errores anunciados (role=alert) y éxito (role=status)', section_.includes('role="alert"') && section_.includes('role="status"'));

section('§3 validación de cortesía');
ok('mínimo 12, igual que el servidor', /SELF_PASSWORD_MIN_LENGTH = 12/.test(section_) && /SELF_PASSWORD_MIN_LENGTH = 12/.test(server));
ok('confirmación distinta y reutilización se avisan antes de enviar', section_.includes('next !== confirm') && section_.includes('next === current'));

section('§4 cierre de sesión tras el éxito');
ok('éxito → limpia campos y programa onChanged', /if \(r\.ok\) \{[\s\S]{0,200}setCurrent\(''\); setNext\(''\); setConfirm\(''\);[\s\S]{0,200}setTimeout\(onChanged/.test(section_));
ok('el mensaje indica iniciar sesión con la nueva contraseña', section_.includes('inicia sesión de nuevo con tu nueva contraseña'));

section('§5 cliente sin identidad propia ni persistencia');
const mStart = service.indexOf('public async changeOwnPassword');
const m = service.slice(mStart, service.indexOf('/**', mStart));
ok('POST /auth/change-password con cookie same-origin', m.includes('/auth/change-password') && m.includes("method: 'POST'") && m.includes("credentials: 'same-origin'"));
ok('el cuerpo solo lleva las tres contraseñas', m.includes('JSON.stringify({ currentPassword, newPassword, confirmPassword })'));
ok('sin x-user-id ni id de usuario', !/x-user-id|userId|\.id\b/.test(m));
ok('sin console.* ni almacenamiento', !/console\.|localStorage|sessionStorage|persistenceService|saveState/.test(m + section_));

console.log(`\nPerfilSecurityPassword — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
