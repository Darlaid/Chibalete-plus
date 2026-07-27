/**
 * AdminUsuariosGroupContract.structural.test.mjs — CHP-ID-CANON-01A.
 *
 * El formulario de /admin/usuarios era la causa próxima de AMBIGUOUS_GROUP:
 * para un estudiante solo ofrecía "Curso / Grado" como texto libre y el
 * selector de grupo estaba condicionado a mediador/administrador, así que el
 * POST salía sin groupIds y el backend tenía que adivinar el grupo desde el
 * nombre del colegio.
 *
 *   §1  el selector de grupo se muestra también para estudiantes
 *   §2  el envío queda bloqueado mientras no haya grupo elegido
 *   §3  el curso en texto libre no es autoridad de membresía
 *   §4  los errores se muestran inline y traducidos (sin alert crudo)
 *   §5  dataService no colapsa los 409 de grupo en "el usuario ya existe"
 *
 *   node pages/__tests__/AdminUsuariosGroupContract.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath    = path.join(__dirname, '..', 'AdminUsuarios.tsx');
const servicePath = path.join(__dirname, '..', '..', 'services', 'dataService.ts');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => cond
    ? (console.log(`  ✓ ${label}`), pass++)
    : (console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`), fail++);
const section = (name) => console.log(`\n${name}`);

console.log('AdminUsuarios — contrato de grupos (CHP-ID-CANON-01A)');

const src     = fs.readFileSync(pagePath, 'utf8');
const service = fs.readFileSync(servicePath, 'utf8');

// ── §1 ──────────────────────────────────────────────────────────────────────
section('[1] selector de grupo visible para estudiantes');
ok('existe el derivado userNeedsGroup',            /const userNeedsGroup\s*=/.test(src));
ok('existe el derivado userHasGroup',              /const userHasGroup\s*=/.test(src));
ok('userNeedsGroup se calcula desde el rol lector', /editingUserIsLector[\s\S]{0,120}roles[\s\S]{0,80}'lector'|'lector'[\s\S]{0,120}editingUserIsLector/.test(src)
    || /const editingUserIsLector[\s\S]{0,80}'lector'/.test(src));
ok('el bloque de grupos ya no está condicionado solo a mediador/admin',
    !/\{\(isMediator\(editingUser\) \|\| isAdmin\(editingUser\)\) && \(/.test(src));
ok('el bloque de grupos incluye a quien necesita grupo',
    /\{\(userNeedsGroup \|\| isMediator\(editingUser\) \|\| isAdmin\(editingUser\)\) && \(/.test(src));
ok('el nuevo usuario arranca con groupIds inicializado',
    /roles: \['lector'\][\s\S]{0,120}groupIds: \[\]/.test(src));

// ── §2 ──────────────────────────────────────────────────────────────────────
section('[2] envío bloqueado mientras haya ambigüedad');
ok('el botón de guardar se deshabilita sin grupo',
    /disabled=\{isSavingUser \|\| \(userNeedsGroup && !userHasGroup\)\}/.test(src));
ok('handleSaveUser corta antes del fetch si falta grupo',
    /if \(userNeedsGroup && !userHasGroup\) \{/.test(src));
ok('el corte ocurre antes de llamar a createUser',
    src.indexOf('if (userNeedsGroup && !userHasGroup) {') < src.indexOf('dataService.createUser'));
ok('se explica el caso "colegio sin grupos"',
    /todavía no tiene grupos/.test(src));

// ── §2b ─────────────────────────────────────────────────────────────────────
section('[2b] sólo grupos autorizados de la institución seleccionada');
ok('el conjunto autorizado sale de schoolGroups',
    /const authorizedGroupIds = React\.useMemo\(\s*\(\) => new Set\(schoolGroups\.map/.test(src));
ok('la selección se sanea contra el conjunto autorizado',
    /const selectedGroupIds = \(editingUser\?\.groupIds \|\| \[\]\)\.filter\(id => authorizedGroupIds\.has\(id\)\)/.test(src));
ok('userHasGroup se calcula sobre la selección saneada',
    /const userHasGroup = selectedGroupIds\.length > 0/.test(src));
ok('un cambio de institución purga la selección inválida',
    /const pruned  = current\.filter\(id => authorizedGroupIds\.has\(id\)\)/.test(src));
ok('el envío usa la selección saneada, no el estado crudo',
    /colegio: selectedSchool, groupIds: selectedGroupIds/.test(src));
ok('el checkbox refleja la selección saneada',
    /checked=\{selectedGroupIds\.includes\(group\.id\)\}/.test(src));
ok('el selector solo lista grupos del colegio en contexto',
    /\{schoolGroups\.map\(group => \(/.test(src));

// ── §3 ──────────────────────────────────────────────────────────────────────
section('[3] el curso en texto libre no decide membresía');
ok('el campo curso sigue existiendo (metadato del perfil)',
    /curso: e\.target\.value/.test(src));
ok('se documenta que curso no es autoridad',
    /Etiqueta informativa del perfil/.test(src));
ok('el formulario no deriva groupIds desde el texto de curso',
    !/groupIds:\s*\[[^\]]*curso/.test(src));

// ── §4 ──────────────────────────────────────────────────────────────────────
section('[4] errores inline, comprensibles, sin PII');
ok('existe el traductor de errores',        /const describeUserSaveError/.test(src));
ok('traduce AMBIGUOUS_GROUP',               /case 'AMBIGUOUS_GROUP':/.test(src));
ok('traduce GROUP_REQUIRED',                /case 'GROUP_REQUIRED':/.test(src));
ok('traduce GROUP_NOT_FOUND',               /case 'GROUP_NOT_FOUND':/.test(src));
ok('traduce GROUP_SCHOOL_MISMATCH',         /case 'GROUP_SCHOOL_MISMATCH':/.test(src));
ok('el guardado de usuario ya no usa alert()',
    !/alert\(`Error al guardar usuario/.test(src));
ok('el error se renderiza inline con role=alert',
    /userSaveMsg &&[\s\S]{0,400}role="alert"/.test(src));
ok('el traductor no imprime el payload ni el usuario',
    !/JSON\.stringify\(editingUser\)/.test(src));

// ── §5 ──────────────────────────────────────────────────────────────────────
section('[5] dataService propaga el código de error real');
ok('createUser lee el cuerpo antes de decidir por status',
    /const body = await response\.json\(\)\.catch/.test(service));
ok('createUser reconoce los códigos de grupo',
    /'AMBIGUOUS_GROUP'[\s\S]{0,200}'GROUP_SCHOOL_MISMATCH'/.test(service));
ok('createUser adjunta code al error', /\{ code, choices/.test(service));
ok('el duplicado conserva su mensaje histórico para el import masivo',
    /El usuario ya existe \(Email o ID duplicado\)\./.test(service));
ok('crearUsuariosMasivos sigue detectando duplicados por mensaje',
    /includes\('El usuario ya existe'\)/.test(service));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
