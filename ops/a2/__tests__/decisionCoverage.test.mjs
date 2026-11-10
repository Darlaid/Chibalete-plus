/**
 * decisionCoverage.test.mjs — CHP-V8.1-PROD-02C. Herramienta de cobertura (solo lectura, agregada).
 *   node ops/a2/__tests__/decisionCoverage.test.mjs
 */
import '../../../server/__test__/helpers/testMode.mjs';
import { a2RegistryPath, grantA1, grantA2, grantC005, grantOptional } from '../../../server/__test__/helpers/testA2.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_dcov_'));
const USERS = path.join(tmp, 'users.json');
fs.writeFileSync(USERS, JSON.stringify([
    { id: 'adm', roles: ['administrador'] },
    { id: 'med-1', roles: ['mediador'], organizationId: 'org' }, { id: 'med-2', roles: ['mediador'], organizationId: 'org' },
    { id: 'r1', roles: ['lector'], organizationId: 'org', email: 'r1@fixture.invalid' }, { id: 'r2', roles: ['lector'], organizationId: 'org' },
    { id: 'r3', roles: ['lector'] }, { id: 'r-off', roles: ['lector'], accountStatus: 'disabled' },
]));
a2RegistryPath();
grantA1(['r1', 'r2', 'r3']); grantA2(['r1']); grantA2(['r2'], 'denied');
grantOptional('A3', ['r1']); grantOptional('A3', ['r2'], { status: 'denied' }); grantOptional('A5', ['r3'], { verification: 'unverified' });
grantC005(['med-1']);
const reg = process.env.CHP_A2_REGISTRY;
const before = fs.readFileSync(reg, 'utf8');
const run = (env = {}) => spawnSync(process.execPath, [path.join(REPO, 'ops/a2/decision_coverage.mjs')],
    { env: { ...process.env, NODE_ENV: 'test', DC_APP_ROOT: REPO, USERS_DB: USERS, ...env }, encoding: 'utf8' });
const r = run();
let out = null; try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* */ }
ok('salida JSON y código 0', r.status === 0 && out?.ok === true, r.stdout + r.stderr);
ok('cuenta solo las cuentas activas (3 lectores, 2 mediadores)', out?.activeReaders === 3 && out?.activeMediators === 2, JSON.stringify(out));
ok('A3 por estado: 1 efectiva, 1 negada, 1 pendiente', out?.readers.A3.effective === 1 && out.readers.A3.denied === 1 && out.readers.A3.pending === 1, JSON.stringify(out?.readers.A3));
ok('A5 sin verificar no cuenta como efectiva', out?.readers.A5.granted_unverified === 1 && out.impact.voiceTranscriptionClosedReaders === 3, JSON.stringify(out?.readers.A5));
ok('A2 solo entre lectores institucionales', JSON.stringify(out?.readers.A2) === JSON.stringify({ effective: 1, denied: 1 }), JSON.stringify(out?.readers.A2));
ok('impacto: 2 lectores sin Leo, 1 mediador sin acceso individual', out?.impact.leoClosedReaders === 2 && out.impact.mediatorsWithoutIndividualAccess === 1);
ok('sin ids, nombres ni correos en la salida', !/r1|r2|r3|med-1|adm|@fixture/.test(r.stdout));
ok('no escribe en el registro', fs.readFileSync(reg, 'utf8') === before);
fs.writeFileSync(reg, before.replace('"a":"granted"', '"a":"denied"'));
const broken = run();
ok('registro alterado ⇒ ok:false y código 1 (nunca recuentos)', broken.status === 1 && /"ok":false/.test(broken.stdout), broken.stdout);
fs.writeFileSync(reg, before);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
console.log(`\ndecision coverage (V8.1-PROD-02C): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
