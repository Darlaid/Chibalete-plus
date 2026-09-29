/**
 * b2cEntitlement.unit.test.mjs — P2-ENTITLEMENT-EXPIRY-01 y CHP-PRIVACY-LOGGING-01 (WEB-REORG P2-D1). Sin E/S.
 */
import { hasActiveEntitlement, isB2cIdentity, createB2cEntitlementGuard, ENTITLEMENT_EXPIRED } from '../b2c/b2cEntitlement.mjs';
import { redactEmail } from '../lib/logPrivacy.js';

let pass = 0, fail = 0;
const ok = (l, c) => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l), fail++);
const b2c = { id: 'U', b2c: true, roles: ['lector'] };
const school = { id: 'S', roles: ['lector'] };

console.log('decisión');
ok('identidad no B2C → sin cambios (siempre permitido aquí)', hasActiveEntitlement(school, []) === true);
ok('B2C con regla vigente → permitido', hasActiveEntitlement(b2c, ['access-b2c-test-order-1']) === true);
ok('B2C sin reglas vigentes → denegado', hasActiveEntitlement(b2c, []) === false);
ok('B2C con regla de colegio vigente → permitido (la regla de colegio concede lo suyo)', hasActiveEntitlement(b2c, ['rule-colegio']) === true);
ok('B2C con rol de mediación → permitido', hasActiveEntitlement({ ...b2c, roles: ['lector', 'mediador'] }, []) === true);
ok('isB2cIdentity solo con b2c === true', isB2cIdentity(b2c) && !isB2cIdentity({ b2c: 'true' }) && !isB2cIdentity(null));

console.log('middleware');
const run = (guard, user) => { let status = 200, body, nexted = false;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    guard({ user, method: 'POST', path: '/api/leo/ask' }, res, () => { nexted = true; }); return { status, body, nexted }; };
const expired = createB2cEntitlementGuard({ resolve: () => ({ appliedRules: [] }) });
const active = createB2cEntitlementGuard({ resolve: () => ({ appliedRules: ['r'] }) });
const listExpired = createB2cEntitlementGuard({ resolve: () => ({ appliedRules: [] }), onExpired: 'empty' });
const broken = createB2cEntitlementGuard({ resolve: () => { throw new Error('boom'); } });
const r1 = run(expired, b2c);
ok('B2C vencido → 403 ENTITLEMENT_EXPIRED, sin next()', r1.status === 403 && r1.body.code === ENTITLEMENT_EXPIRED && !r1.nexted);
ok('B2C vigente → next()', run(active, b2c).nexted);
ok('colegio (no B2C) con motor vacío → next() (doctrina escolar intacta)', run(expired, school).nexted);
const r2 = run(listExpired, b2c);
ok('listado con B2C vencido → [] (estado vacío)', r2.status === 200 && Array.isArray(r2.body) && r2.body.length === 0 && !r2.nexted);
ok('fallo del motor → B2C denegado (fail-closed)', run(broken, b2c).status === 403);
ok('fallo del motor → colegio no afectado', run(broken, school).nexted);

console.log('redacción de correos en registros');
ok('redacta la parte local', redactEmail('Lector.Uno@Fixture.Invalid') === 'l***@fixture.invalid');
ok('entrada no válida → unknown', redactEmail('') === 'unknown' && redactEmail(undefined) === 'unknown' && redactEmail('sin-arroba') === 'unknown');
ok('nunca devuelve la parte local completa', !redactEmail('secreto@x.co').includes('secreto'));

console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
