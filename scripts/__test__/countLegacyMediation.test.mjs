/**
 * countLegacyMediation.test.mjs — SEC-SESSION-IDENTITY-04U.
 *
 * Valida, con datos 100 % sintéticos, el recuento de solo lectura `scripts/ops/count-legacy-mediation.mjs`:
 * las tres categorías pedidas, que el resultado coincide con lo que el CIS concede de verdad, que la salida
 * no contiene ningún identificador y que la ejecución no escribe nada.
 *
 *   node scripts/__test__/countLegacyMediation.test.mjs
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'ops', 'count-legacy-mediation.mjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_sec04u_count_'));
const P = { groups: path.join(tmp, 'groups.json'), users: path.join(tmp, 'users.json'), schools: path.join(tmp, 'schools.json') };
const A = { organizationId: 'org-zeta' };
const u = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Persona ${id}`, roles, ...extra });
const USERS = [
    u('pm-1', ['mediador']), u('pm-2', ['mediador']), u('pm-3', ['profesor']), u('pm-4', ['mediador']),
    u('pl-1', ['lector']), u('pl-2', ['lector']), u('pl-3', ['lector']),
    u('lt-1', ['lector'], { _loadtest_marker: true }), u('lt-m', ['mediador'], { _loadtest_marker: true }),
];
const GROUPS = [
    // Activos con mediador reconocido por el CIS: 3
    { id: 'gx-1', name: 'Grupo secreto uno', ...A, mediatorIds: ['pm-1'], teacherId: 'pm-1', memberIds: ['pl-1'] },
    { id: 'gx-2', name: 'Grupo secreto dos', ...A, mediadores: ['pm-2'], memberIds: ['pl-2'] },
    { id: 'gx-3', name: 'Grupo secreto tres', ...A, mediatorIds: ['pm-1'], teacherId: 'pm-4', memberIds: ['pl-3'] }, // + otro docente solo en teacherId
    // Activos cuyo único vínculo es teacherId: 2
    { id: 'gx-4', name: 'Grupo secreto cuatro', ...A, teacherId: 'pm-3', memberIds: ['pl-1'] },
    { id: 'gx-5', name: 'Grupo secreto cinco', ...A, mediatorIds: [], teacherId: 'pm-4', memberIds: ['pl-2'] },
    // Activos sin mediador reconocido: 4
    { id: 'gx-6', name: 'Grupo secreto seis', ...A, memberIds: ['pl-1'] },                              // nadie
    { id: 'gx-7', name: 'Grupo secreto siete', ...A, mediatorIds: ['pl-3'], memberIds: ['pl-1'] },       // un lector no media
    { id: 'gx-8', name: 'Grupo secreto ocho', ...A, mediatorIds: ['no-existe'], teacherId: 'tampoco' },  // ids que no resuelven
    { id: 'gx-9', name: 'Grupo secreto nueve', ...A, teacherId: 'pl-2', memberIds: ['pl-1'] },           // teacherId sin rol de mediador
    // Fuera del alcance activo: 3 (no cuentan en ninguna de las tres categorías)
    { id: 'gx-10', name: 'Histórico', mediatorIds: ['pm-1'], memberIds: ['pl-1'] },                       // sin organizationId
    { id: 'gx-11', name: 'No registrado', organizationId: 'org-fantasma', teacherId: 'pm-3' },
    { id: 'gx-12', name: 'Sintético', organizationId: 'org-carga', teacherId: 'lt-m', mediatorIds: ['lt-m'], memberIds: ['lt-1'] },
];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-zeta', name: 'Institución Zeta' }]));
const digest = () => Object.values(P).map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}:${fs.statSync(f).mtimeMs}`).join('|');
const listing = () => fs.readdirSync(tmp).sort().join(',');
const env = { ...process.env, GROUPS_DB: P.groups, USERS_DB: P.users, SCHOOLS_DB: P.schools, CHP_APP_ROOT: REPO };
const EXPECT = { groupsTotal: 12, groupsActive: 9, groupsOutOfActiveScope: 3, activeWithCisMediator: 3, activeTeacherIdOnly: 2, activeWithoutCisMediator: 4, activeWithCisMediatorAndOtherTeacherId: 1 };

try {
    console.log('[1] recuento');
    const before = digest(), files = listing();
    const r = spawnSync(process.execPath, [SCRIPT], { env, cwd: REPO, encoding: 'utf8' });
    let out = null; try { out = JSON.parse(r.stdout); } catch { /* */ }
    ok('termina con código 0 y un único objeto JSON', r.status === 0 && out?.ok === true && r.stdout.trim().split('\n').length === 1, `${r.status} ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
    ok('las tres categorías y los totales son los esperados', JSON.stringify(out?.counts) === JSON.stringify(EXPECT), JSON.stringify(out?.counts));
    ok('las tres categorías reparten exactamente los grupos activos', out && out.counts.activeWithCisMediator + out.counts.activeTeacherIdOnly + out.counts.activeWithoutCisMediator === out.counts.groupsActive);

    console.log('[2] coincide con lo que el CIS concede');
    const probe = `
        const cis = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'server', 'identity', 'cis.mjs')).href)});
        const groups = ${JSON.stringify(GROUPS.map((g) => g.id))}, people = ${JSON.stringify(USERS.map((x) => x.id))};
        const rec = groups.filter((g) => people.some((p) => cis.authorizeScope(p, 'group', g).decision === 'allow')).length;
        console.log('RECOGNISED=' + rec);`;
    const c = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...env, NODE_ENV: 'test', IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json' }, cwd: REPO, encoding: 'utf8' });
    ok('grupos que el CIS reconoce como mediados = activeWithCisMediator', c.status === 0 && Number(c.stdout.match(/RECOGNISED=(\d+)/)?.[1]) === EXPECT.activeWithCisMediator, `${c.status} ${c.stdout.slice(-120)} ${c.stderr.slice(-300)}`);

    console.log('[3] sin datos personales ni identificadores');
    const leak = [...USERS.flatMap((x) => [x.id, x.email, x.nombre_completo]), ...GROUPS.flatMap((g) => [g.id, g.name]), 'org-zeta', 'Institución Zeta', tmp];
    ok('la salida no contiene ids, nombres, correos, colegios ni rutas', !leak.some((s) => (r.stdout + r.stderr).includes(s)), r.stdout);
    ok('en `counts` solo hay enteros bajo claves fijas', out && Object.values(out.counts).every((v) => Number.isInteger(v)) && Object.keys(out.counts).join() === Object.keys(EXPECT).join());

    console.log('[4] solo lectura');
    ok('los tres almacenes quedan idénticos (contenido y fecha de modificación)', digest() === before);
    ok('no se crea ningún archivo junto a los almacenes', listing() === files, listing());
    const src = fs.readFileSync(SCRIPT, 'utf8');
    ok('el guion no usa ninguna API de escritura, red, proceso ni SQLite', !/writeFile|appendFile|createWriteStream|\brename|\bunlink|\brm(Sync)?\(|mkdir|copyFile|chmod|O_WRONLY|O_RDWR|O_CREAT|node:http|node:https|node:net|fetch\(|child_process|better-sqlite3|sqlite/.test(src.replace(/\/\*[\s\S]*?\*\//, '')));
    ok('los archivos se abren con O_RDONLY', /fs\.openSync\(file, fs\.constants\.O_RDONLY\)/.test(src));

    console.log('[5] ejecución por la entrada estándar (sin copiar el guion al contenedor)');
    const s = spawnSync(process.execPath, ['--input-type=module', '-'], { env, cwd: REPO, input: src, encoding: 'utf8' });
    let so = null; try { so = JSON.parse(s.stdout); } catch { /* */ }
    ok('mismo recuento por la entrada estándar', s.status === 0 && JSON.stringify(so?.counts) === JSON.stringify(EXPECT), `${s.status} ${s.stdout.slice(0, 160)} ${s.stderr.slice(0, 200)}`);

    console.log('[6] falla cerrado');
    const noEnv = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, GROUPS_DB: '', USERS_DB: '', SCHOOLS_DB: '', CHP_APP_ROOT: REPO }, cwd: REPO, encoding: 'utf8' });
    ok('sin rutas configuradas → código 2 y ningún recuento (no supone una ruta)', noEnv.status === 2 && /missing_store_path/.test(noEnv.stdout) && !/counts/.test(noEnv.stdout), `${noEnv.status} ${noEnv.stdout}`);
    const bad = spawnSync(process.execPath, [SCRIPT], { env: { ...env, GROUPS_DB: path.join(tmp, 'no-existe.json') }, cwd: REPO, encoding: 'utf8' });
    ok('almacén ilegible → código 2, sin recuento y sin revelar la ruta', bad.status === 2 && /store_unreadable/.test(bad.stdout) && !/counts/.test(bad.stdout) && !bad.stdout.includes(tmp), `${bad.status} ${bad.stdout}`);
    ok('…y nunca un cero inventado', !/"activeTeacherIdOnly":0/.test(noEnv.stdout + bad.stdout));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\ncountLegacyMediation — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
