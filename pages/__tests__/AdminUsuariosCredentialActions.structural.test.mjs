/**
 * AdminUsuariosCredentialActions.structural.test.mjs — SEC-USERS-01 / Unidad A.
 *
 *   §1  el modal de edición ofrece Reinvitar y Desactivar (solo con id)
 *   §2  el enlace de activación vive solo en el estado del componente y se
 *       descarta al cerrar el modal; nunca va a almacenamiento persistente
 *   §3  dataService no guarda el enlace ni el token en this.users/saveState
 *   §4  la creación ya no precarga la contraseña predeterminada
 *   §5  el titular sigue activando vía ActivarCuenta → /api/accept-invite
 *
 *   node pages/__tests__/AdminUsuariosCredentialActions.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page    = fs.readFileSync(path.join(__dirname, '..', 'AdminUsuarios.tsx'), 'utf8');
const activar = fs.readFileSync(path.join(__dirname, '..', 'ActivarCuenta.tsx'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'dataService.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => cond
    ? (console.log(`  ✓ ${label}`), pass++)
    : (console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`), fail++);
const section = (name) => console.log(`\n${name}`);

section('§1 acciones en el modal');
ok('botón Reinvitar usuario', page.includes('Reinvitar usuario') && page.includes("handleCredentialAction('reinvite')"));
ok('botón Desactivar usuario', page.includes('Desactivar usuario') && page.includes("handleCredentialAction('disable')"));
ok('las acciones solo se muestran con usuario existente', /\{editingUser\?\.id && \(\s*<div[^>]*>\s*<p[^>]*>\s*Acceso de la cuenta/.test(page));
ok('confirmación antes de actuar', /handleCredentialAction[\s\S]{0,400}confirm\(/.test(page));

section('§2 enlace efímero');
ok('estado local credentialLink', page.includes('useState<string | null>(null)') && page.includes('setCredentialLink'));
ok('se descarta al cerrar el modal', page.includes('if (!isUserModalOpen) setCredentialLink(null)'));
ok('sin localStorage/sessionStorage en la página', !/localStorage|sessionStorage/.test(page));

section('§3 dataService no persiste el enlace');
const block = service.slice(service.indexOf('private async credentialAction'), service.indexOf('async deleteUser'));
ok('métodos reinviteUser y disableUser', service.includes('async reinviteUser(') && service.includes('async disableUser('));
ok('rutas /reinvite y /disable con POST', block.includes('/${action}') && block.includes("method: 'POST'"));
ok('solo accountStatus va al caché de usuarios', block.includes('accountStatus: body.accountStatus') && !/activationUrl[^;]*saveState|this\.users\[idx\] = \{[^}]*activationUrl/.test(block));
ok('sin almacenamiento local del enlace', !/localStorage|sessionStorage/.test(block));

section('§4 sin contraseña predeterminada');
ok("la creación no precarga 'chibalete123'", !page.includes("password: 'chibalete123'"));
ok('la ayuda ya no anuncia la predeterminada', !page.includes("Por defecto es 'chibalete123'"));
ok("dataService no rellena con 'chibalete123' al crear", !/\|\|\s*'chibalete123'/.test(service));
ok('crear sin contraseña inicial se bloquea en el formulario', page.includes('La contraseña inicial es obligatoria.'));

section('§5 activación por el titular');
ok('ActivarCuenta envía token y password a /api/accept-invite', activar.includes("'/api/accept-invite'") && /JSON\.stringify\(\{\s*token[\s\S]{0,40}password/.test(activar));
ok('ActivarCuenta muestra el error del servidor (política)', activar.includes('data.error'));

console.log(`\nAdminUsuariosCredentialActions — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
