/**
 * b2cProvisioning.unit.test.mjs — CHP-B2C-PROVISIONING-01 (WEB-REORG P2-C). Lógica pura, sin E/S.
 */
import crypto from 'node:crypto';
import {
    computeExpiresAt, signB2cRequest, verifyB2cSignature, validateProvisionInput, validateRevokeInput,
    planUserPhase, planRulePhase, planRevoke, planTitleSync, ruleIdFor, idempotencyKeyFor, B2cError, B2C_TEMPLATE_RULE_ID,
} from '../b2c/b2cProvisioning.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e instanceof B2cError && e.code === code; } };
const iso = (ms) => new Date(ms).toISOString();

console.log('expiresAt — mismo día +12 meses, 23:59:59.999 Bogotá');
ok('17:00 Bogotá 28-sep-2026 → 2027-09-29T04:59:59.999Z', iso(computeExpiresAt(Date.parse('2026-09-28T22:00:00Z'))) === '2027-09-29T04:59:59.999Z');
ok('22:00 Bogotá (03:00Z del día siguiente) sigue siendo el 28 local', iso(computeExpiresAt(Date.parse('2026-09-29T03:00:00Z'))) === '2027-09-29T04:59:59.999Z');
ok('00:30 Bogotá 1-ene → 1-ene del año siguiente', iso(computeExpiresAt(Date.parse('2027-01-01T05:30:00Z'))) === '2028-01-02T04:59:59.999Z');
ok('29-feb-2028 → 28-feb-2029', iso(computeExpiresAt(Date.parse('2028-02-29T15:00:00Z'))) === '2029-03-01T04:59:59.999Z');
ok('la vigencia supera siempre los 365 días', computeExpiresAt(Date.parse('2026-09-28T22:00:00Z')) - Date.parse('2026-09-28T22:00:00Z') > 365 * 864e5);

console.log('firma HMAC');
const secret = crypto.randomBytes(48).toString('hex');
const body = JSON.stringify({ a: 1, t: 'ñandú' });
const now = Date.parse('2026-09-28T22:00:00Z'); const ts = String(Math.floor(now / 1000));
const sig = signB2cRequest(secret, ts, body);
ok('firma válida', verifyB2cSignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now }));
ok('cuerpo alterado', !verifyB2cSignature({ secret, timestamp: ts, signature: sig, rawBody: body + ' ', nowMs: now }));
ok('secreto distinto', !verifyB2cSignature({ secret: secret + 'x', timestamp: ts, signature: sig, rawBody: body, nowMs: now }));
ok('marca de tiempo fuera de ventana (+301 s)', !verifyB2cSignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now + 301e3 }));
ok('marca de tiempo dentro de ventana (+299 s)', verifyB2cSignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now + 299e3 }));
ok('sin secreto (archivo ausente) → falso', !verifyB2cSignature({ secret: null, timestamp: ts, signature: sig, rawBody: body, nowMs: now }));
ok('sin cabeceras → falso', !verifyB2cSignature({ secret, timestamp: undefined, signature: undefined, rawBody: body, nowMs: now }));
ok('firma con otra longitud → falso sin lanzar', !verifyB2cSignature({ secret, timestamp: ts, signature: 'v1=00', rawBody: body, nowMs: now }));
ok('vector fijo (interoperabilidad con PHP hash_hmac)', signB2cRequest('k'.repeat(32), '1790632800', '{"x":1}') ===
    'v1=' + crypto.createHmac('sha256', 'k'.repeat(32)).update('1790632800.{"x":1}').digest('hex'));

console.log('validación de entrada');
const base = { orderId: 1001, productId: 345, plan: 'digital', source: 'test', email: 'a@fixture.invalid', fullName: 'A', activationAt: now, idempotencyKey: 'test:order:1001' };
ok('entrada válida', validateProvisionInput(base, now).orderId === 1001);
ok('plan inválido', throwsCode(() => validateProvisionInput({ ...base, plan: 'mensual' }, now), 'invalid_plan'));
ok('correo inválido', throwsCode(() => validateProvisionInput({ ...base, email: 'x' }, now), 'invalid_email'));
ok('activación en el futuro (>5 min)', throwsCode(() => validateProvisionInput({ ...base, activationAt: now + 6 * 60e3 }, now), 'invalid_activation_at'));
ok('activación pasada permitida (reintentos/pruebas)', validateProvisionInput({ ...base, activationAt: now - 400 * 864e5 }, now).activationAt < now);
ok('clave de idempotencia distinta de la derivada', throwsCode(() => validateProvisionInput({ ...base, idempotencyKey: 'otra' }, now), 'invalid_idempotency_key'));
ok('orderId no entero', throwsCode(() => validateProvisionInput({ ...base, orderId: '1e3x' }, now), 'invalid_order_id'));
ok('revoke: razón desconocida → manual', validateRevokeInput({ orderId: 1001, source: 'test', idempotencyKey: 'test:order:1001', reason: 'x' }).reason === 'manual');

console.log('fases de provisión');
const normalizeEmail = (e) => String(e).trim().toLowerCase();
const normalizeUser = (u) => ({ ...u });
const template = { id: B2C_TEMPLATE_RULE_ID, scope: 'group', scopeId: 'group-b2c-lectores', titleIds: ['o1', 'o2'], collectionIds: [] };
const input = validateProvisionInput(base, now);
const P1 = planUserPhase({ users: [], rules: [template], input, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'U-NEW', newToken: 'T1' });
ok('usuario nuevo: create, invited, sin grupos, marcado b2c', P1.userOp === 'create' && P1.user.accountStatus === 'invited' && P1.user.groupIds.length === 0 && P1.user.b2c === true);
ok('usuario nuevo: enlace de activación', P1.activationUrl === '/#/activar?token=T1');
const R1 = planRulePhase({ rules: [template], input, userId: 'U-NEW', nowMs: now });
ok('regla: id determinista, ámbito usuario', R1.rule.id === ruleIdFor('test', 1001) && R1.rule.scope === 'user' && R1.rule.scopeId === 'U-NEW');
ok('regla: titleIds = copia de la plantilla', JSON.stringify(R1.rule.titleIds) === '["o1","o2"]' && R1.rule.titleIds !== template.titleIds);
ok('regla: expiresAt calculado', R1.rule.expiresAt === computeExpiresAt(now) && R1.rule.b2c.activationAt === now);
const rulesAfter = [template, R1.rule];
const users1 = [P1.user];
const P2 = planUserPhase({ users: users1, rules: rulesAfter, input, nowMs: now + 1000, normalizeEmail, normalizeUser, newUserId: 'U-OTHER', newToken: 'T2' });
ok('reintento: already_activated, mismo usuario, token regenerado', P2.status === 'already_activated' && P2.userId === 'U-NEW' && P2.userOp === 'regenerate_token' && P2.activationUrl.endsWith('T2'));
const R2 = planRulePhase({ rules: rulesAfter, input, userId: 'U-NEW', nowMs: now + 1000 });
ok('reintento: ninguna regla nueva, expiresAt intacto', R2.ruleOp === 'none' && R2.rule.expiresAt === R1.rule.expiresAt);
const input2 = validateProvisionInput({ ...base, orderId: 1002, idempotencyKey: 'test:order:1002' }, now);
ok('segundo pedido con suscripción vigente → conflict_active_subscription',
    throwsCode(() => planUserPhase({ users: users1, rules: rulesAfter, input: input2, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T3' }), 'conflict_active_subscription'));
const expiredRules = [template, { ...R1.rule, expiresAt: now - 1 }];
ok('con la suscripción anterior vencida sí se provisiona', planUserPhase({ users: users1, rules: expiredRules, input: input2, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T3' }).status === 'activated');
const activeUser = { id: 'U-ACT', email: 'Lector@Colegio.invalid', accountStatus: 'active', roles: ['lector'], groupIds: ['g-col'] };
const input3 = validateProvisionInput({ ...base, orderId: 1003, idempotencyKey: 'test:order:1003', email: 'lector@colegio.invalid' }, now);
const P3 = planUserPhase({ users: [activeUser], rules: [template], input: input3, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T4' });
ok('cuenta activa existente (colegio): se reutiliza sin tocarla y sin enlace', P3.userOp === 'none' && P3.userId === 'U-ACT' && P3.activationUrl === null && P3.reusedAccount === true && P3.user === activeUser);
ok('cuenta deshabilitada → account_not_available',
    throwsCode(() => planUserPhase({ users: [{ ...activeUser, accountStatus: 'disabled' }], rules: [template], input: input3, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T' }), 'account_not_available'));
ok('sin plantilla → template_rule_missing (503)', throwsCode(() => planRulePhase({ rules: [], input, userId: 'U', nowMs: now }), 'template_rule_missing'));

console.log('revocación');
const RV = planRevoke({ rules: rulesAfter, input: validateRevokeInput({ orderId: 1001, source: 'test', idempotencyKey: 'test:order:1001', reason: 'refunded' }), nowMs: now + 5000 });
ok('revoked: expiresAt = ahora, motivo registrado', RV.status === 'revoked' && RV.rule.expiresAt === now + 5000 && RV.rule.b2c.revokeReason === 'refunded');
ok('solo cambia esa regla (la plantilla no se toca)', RV.rule.id === ruleIdFor('test', 1001) && template.titleIds.length === 2);
const RV2 = planRevoke({ rules: [template, RV.rule], input: validateRevokeInput({ orderId: 1001, source: 'test', idempotencyKey: 'test:order:1001', reason: 'refunded' }), nowMs: now + 9000 });
ok('revoke idempotente: already_revoked sin cambiar expiresAt', RV2.status === 'already_revoked' && RV2.rule.expiresAt === now + 5000);
ok('revoke de un pedido sin regla → 404', throwsCode(() => planRevoke({ rules: [template], input: validateRevokeInput({ orderId: 9, source: 'test', idempotencyKey: 'test:order:9' }), nowMs: now }), 'rule_not_found'));
ok('idempotencyKeyFor', idempotencyKeyFor('production', 5) === 'production:order:5');

console.log('sincronización del catálogo B2C');
const tpl2 = { ...template, titleIds: ['o1', 'o2', 'o3'] };
const vigente = { ...R1.rule }; const vencida = { ...R1.rule, id: 'access-b2c-test-order-7', expiresAt: now - 1 };
const S1 = planTitleSync({ rules: [tpl2, vigente, vencida, { id: 'rule-colegio', scope: 'group', titleIds: ['x'] }], nowMs: now });
ok('actualiza solo la regla B2C vigente', S1.updated === 1 && JSON.stringify(S1.rules[1].titleIds) === '["o1","o2","o3"]');
ok('no toca la vencida ni la de colegio', JSON.stringify(S1.rules[2].titleIds) === '["o1","o2"]' && JSON.stringify(S1.rules[3].titleIds) === '["x"]');
ok('idempotente', planTitleSync({ rules: S1.rules, nowMs: now }).updated === 0);

console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
