/**
 * pilotLegacyPack.test.mjs — CHP V9R-DEP1. Herramienta de carga de PILOT_LEGACY (emit) y su verificación agregada.
 *   node ops/a2/__tests__/pilotLegacyPack.test.mjs
 */
import '../../../server/__test__/helpers/testMode.mjs';
import { a2RegistryPath } from '../../../server/__test__/helpers/testA2.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../../server/privacy/a2Registry.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_pilotpack_'));
const USERS = path.join(tmp, 'users.json'), GROUPS = path.join(tmp, 'groups.json');
const u = (id, roles, extra = {}) => ({ id, roles, organizationId: 'org', email: `${id}@fixture.invalid`, nombre_completo: `Persona ${id}`, ...extra });
fs.writeFileSync(USERS, JSON.stringify([u('adm', ['administrador']), u('med-1', ['mediador']), u('med-2', ['mediador']), u('med-off', ['mediador'], { accountStatus: 'disabled' }),
    u('r1', ['lector']), u('r2', ['lector']), u('r3', ['lector']), u('r-off', ['lector'], { accountStatus: 'disabled' }), u('r-inv', ['lector'], { accountStatus: 'invited' }), u('r9', ['lector'])]));
const g = (id, mediatorIds, members) => ({ id, name: id, type: 'course', organizationId: 'org', mediatorIds, memberIds: members, studentIds: members });
fs.writeFileSync(GROUPS, JSON.stringify([g('g-1', ['med-1', 'med-off', 'fantasma'], ['r1', 'r2', 'r-off', 'r-inv']), g('g-2', ['med-2'], ['r3']), g('g-otro', ['med-2'], ['r9']), g('g-vacio', [], ['r9'])]));
const REG = a2RegistryPath();
const base = { PILOT_MODE: 'emit', PILOT_GROUPS: 'g-1,g-2', PILOT_FOLLOWUP: 'g-1', PILOT_CUTOFF_DAY: '2026-11-24', PILOT_REF: 'DIR-SINT-PILOT' };
const run = (env) => spawnSync(process.execPath, [path.join(REPO, 'ops/a2/pilot_legacy_pack.mjs')],
    { env: { ...process.env, NODE_ENV: 'test', DC_APP_ROOT: REPO, USERS_DB: USERS, GROUPS_DB: GROUPS, ...env }, encoding: 'utf8' });
const codeOf = (r) => { try { return JSON.parse(r.stderr.trim().split('\n').pop()).code; } catch { return null; } };

const r = run(base);
const lines = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
ok('emit: código 0 y una línea por pertenencia más el sello, que va al final', r.status === 0 && lines.length === 6 && lines.at(-1).capacity === 'pilot_seal' && lines.at(-1).subjectId === R.PILOT_SEAL_SUBJECT, r.stdout + r.stderr);
ok('solo cuentas activas con su función: 2 mediadores, 3 lectores (ni desactivadas, ni invitadas, ni ids sin cuenta)', lines.filter((l) => l.capacity === 'pilot_mediator').length === 2
    && lines.filter((l) => /^pilot_reader/.test(l.capacity)).length === 3 && !/med-off|fantasma|r-off|r-inv|r9|g-otro/.test(r.stdout));
ok('seguimiento solo donde se decidió (g-1); en g-2, solo nómina', lines.filter((l) => l.capacity === 'pilot_reader_followup').length === 2 && lines.filter((l) => l.capacity === 'pilot_reader').length === 1);
ok('forma cerrada: tipo, versión, medio y verificación de piloto; día del corte; referencia de Dirección', lines.every((l) => l.kind === 'PILOT_LEGACY' && l.status === 'granted' && l.version === R.PILOT_VERSION
    && l.medium === 'admin_record' && l.verification === 'inventory' && l.actDay === '2026-11-24' && l.requestRef === 'DIR-SINT-PILOT' && l.validUntil === null));
ok('recuentos por stderr, sin ids ni nombres', /"lineas":6/.test(r.stderr) && !/r1|r2|r3|med-1|Persona|@fixture/.test(r.stderr), r.stderr);
ok('no escribe en el registro por sí misma', fs.readFileSync(REG, 'utf8') === '');
ok('nada tiene valor por defecto', codeOf(run({ ...base, PILOT_GROUPS: '' })) === 'PILOT_GROUPS_REQUIRED' && codeOf(run({ ...base, PILOT_FOLLOWUP: '' })) === 'PILOT_FOLLOWUP_REQUIRED'
    && codeOf(run({ ...base, PILOT_REF: '' })) === 'PILOT_REF_REQUIRED' && codeOf(run({ ...base, PILOT_CUTOFF_DAY: '' })) === 'PILOT_CUTOFF_DAY_INVALID' && codeOf(run({ ...base, PILOT_MODE: '' })) === 'PILOT_MODE_REQUIRED');
ok('corte futuro, grupo inexistente, grupo sin mediador o seguimiento fuera del piloto ⇒ error y ninguna línea', [['PILOT_CUTOFF_DAY', '2999-01-01', 'PILOT_CUTOFF_DAY_INVALID'], ['PILOT_GROUPS', 'g-1,g-nada', 'PILOT_GROUP_NOT_FOUND'],
    ['PILOT_GROUPS', 'g-vacio', 'PILOT_GROUP_WITHOUT_MEDIATOR'], ['PILOT_FOLLOWUP', 'g-otro', 'PILOT_FOLLOWUP_OUTSIDE_PILOT'], ['PILOT_VALID_UNTIL', '2026-01-01', 'PILOT_VALID_UNTIL_INVALID']]
    .every(([k, v, code]) => { const x = run({ ...base, ...(k === 'PILOT_GROUPS' && v === 'g-vacio' ? { PILOT_FOLLOWUP: 'none' } : {}), [k]: v }); return x.status === 1 && codeOf(x) === code && (k === 'PILOT_GROUPS' && v === 'g-1,g-nada' ? true : x.stdout === ''); }));
const all = run({ ...base, PILOT_FOLLOWUP: 'all', PILOT_VALID_UNTIL: '2027-06-30' }).stdout.trim().split('\n').map((l) => JSON.parse(l));
ok('`all` y vigencia: todos los lectores con seguimiento y todas las líneas con su fecha de caducidad', all.filter((l) => l.capacity === 'pilot_reader_followup').length === 3 && all.every((l) => l.validUntil === '2027-06-30'));

// La salida se carga tal cual con el operador de decisiones (aquí, su misma llamada) y el régimen queda cerrado.
R.appendDecisions(lines);
const v = run({ PILOT_MODE: 'verify' });
const head = (() => { try { return JSON.parse(v.stdout.trim().split('\n')[0]); } catch { return null; } })();
ok('verify: sellado, 2 grupos, 2 pertenencias de mediador, 3 de lector y 2 con seguimiento', v.status === 0 && head?.ok === true && head.sellado === true && head.grupos === 2 && head.pertenenciasDeMediador === 2
    && head.pertenenciasDeLector === 3 && head.conSeguimiento === 2, v.stdout + v.stderr);
ok('verify: sin ids de cuenta, nombres ni correos', !/r1|r2|r3|med-1|med-2|Persona|@fixture/.test(v.stdout));
const again = (() => { try { R.appendDecisions(lines); return null; } catch (e) { return e.code; } })();
ok('una segunda carga se rechaza: el régimen está sellado', again === 'PILOT_LEGACY_SEALED');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
console.log(`\npilot legacy pack (V9R-DEP1): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
