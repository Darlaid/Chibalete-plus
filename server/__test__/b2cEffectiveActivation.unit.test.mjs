/**
 * b2cEffectiveActivation.unit.test.mjs — CHP V9 Bloque II · F7-C3. Activación efectiva (lógica pura, corre en CI).
 *
 * Los doce meses de una suscripción B2C empiezan cuando el acceso existe de verdad:
 *   - cuenta ya activa ⇒ al conceder la regla (reloj de la app);
 *   - cuenta invitada ⇒ al activarse la cuenta; hasta entonces la regla es PENDIENTE: sin acceso y sin plazo.
 * La fecha que envía la tienda es solo «cuándo lo pidió». El tramo HTTP (servidor real, dos réplicas) está en
 * b2cEffectiveActivation.integration (contenedor desechable).
 *
 *   node server/__test__/b2cEffectiveActivation.unit.test.mjs
 */
import {
    planRulePhase, planStartPending, planRevoke, planTitleSync, planUserPhase, computeExpiresAt, b2cAccessState, isPendingB2cRule,
    B2cError, B2C_TEMPLATE_RULE_ID, ruleIdFor,
} from '../b2c/b2cProvisioning.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof B2cError ? e.code : `otro:${e?.message}`; } };

const DAY = 864e5, NOW = Date.UTC(2026, 10, 23, 15, 0, 0);
const template = (titles = ['obra-1', 'obra-2']) => ({ id: B2C_TEMPLATE_RULE_ID, scope: 'group', scopeId: 'group-b2c-lectores', titleIds: titles, collectionIds: [], expiresAt: null });
const input = (orderId, extra = {}) => ({ orderId, productId: 345, plan: 'digital', source: 'test', email: 'a@fixture.invalid', fullName: '', activationAt: NOW - 6 * DAY,
    idempotencyKey: `test:order:${orderId}`, dryRun: false, termsAcceptance: null, reader: null, ...extra });
const U = 'user-1';

section('[1] cuenta ya activa: la vigencia empieza al conceder la regla');
{
    const p = planRulePhase({ rules: [template()], input: input(1), userId: U, nowMs: NOW, accountActive: true });
    ok('regla creada, vigente desde AHORA (reloj de la app), no desde la fecha de la tienda (6 días antes)', p.ruleOp === 'create' && p.rule.b2c.activationAt === NOW && p.rule.expiresAt === computeExpiresAt(NOW) && p.rule.expiresAt > computeExpiresAt(NOW - 6 * DAY), JSON.stringify(p.rule.b2c));
    ok('la fecha de la tienda se conserva como `requestedAt`', p.rule.b2c.requestedAt === NOW - 6 * DAY && p.rule.b2c.activationBasis === 'rule_granted');
    ok('no queda pendiente y su estado es «active»', !isPendingB2cRule(p.rule) && b2cAccessState(p.rule, NOW) === 'active');
    ok('por defecto (sin indicar la cuenta) se comporta como cuenta activa: contrato anterior de quien llama', planRulePhase({ rules: [template()], input: input(1), userId: U, nowMs: NOW }).rule.expiresAt === computeExpiresAt(NOW));
}

section('[2] cuenta invitada: regla pendiente, sin acceso y sin plazo');
const pending = planRulePhase({ rules: [template()], input: input(2), userId: U, nowMs: NOW, accountActive: false }).rule;
{
    ok('pendiente: `expiresAt` 0 (el motor de accesos la ignora), sin fecha de inicio', pending.b2c.pendingActivation === true && pending.expiresAt === 0 && pending.b2c.expiresAt === 0 && pending.b2c.activationAt === null);
    ok('estado «pending_activation», no «expired»', b2cAccessState(pending, NOW) === 'pending_activation' && b2cAccessState(pending, NOW + 400 * DAY) === 'pending_activation');
    ok('lleva los títulos de la plantilla y los datos del pedido', JSON.stringify(pending.titleIds) === '["obra-1","obra-2"]' && pending.b2c.orderId === 2 && pending.b2c.plan === 'digital' && pending.scope === 'user' && pending.scopeId === U);
    ok('una regla pendiente cuenta como suscripción en curso: otra compra de la misma cuenta ⇒ conflicto', codeOf(() => planRulePhase({ rules: [template(), pending], input: input(3), userId: U, nowMs: NOW + 90 * DAY, accountActive: false })) === 'conflict_active_subscription');
    ok('…y no afecta a otra cuenta', planRulePhase({ rules: [template(), pending], input: input(3), userId: 'user-2', nowMs: NOW, accountActive: false }).ruleOp === 'create');
}

section('[3] la activación de la cuenta inicia la vigencia, una sola vez');
{
    const at = NOW + 20 * DAY;   // la cuenta se activa veinte días después del pago
    const s = planStartPending({ rules: [template(['obra-1', 'obra-2', 'obra-3']), pending], userId: U, nowMs: at });
    const r = s.started[0];
    ok('una regla iniciada: inicio = momento de la activación, vencimiento = 12 meses después', s.started.length === 1 && r.b2c.activationAt === at && r.expiresAt === computeExpiresAt(at) && r.b2c.expiresAt === r.expiresAt && r.b2c.activationBasis === 'account_activated');
    ok('deja de estar pendiente y pasa a «active»', r.b2c.pendingActivation === undefined && !isPendingB2cRule(r) && b2cAccessState(r, at) === 'active');
    ok('recibe el catálogo vigente (la lista creció mientras esperaba)', JSON.stringify(r.titleIds) === '["obra-1","obra-2","obra-3"]');
    ok('conserva pedido, plan, clave de idempotencia y fecha de la tienda', ['idempotencyKey', 'requestedAt', 'orderId', 'plan'].every((f) => r.b2c[f] === pending.b2c[f]) && r.id === pending.id && r.b2c.plan === 'digital');
    const again = planStartPending({ rules: s.rules, userId: U, nowMs: at + 5 * DAY });
    ok('idempotente: una segunda activación no encuentra nada que iniciar ni mueve fechas', again.started.length === 0 && JSON.stringify(again.rules) === JSON.stringify(s.rules));
    ok('no toca reglas de otra cuenta, ni vencidas, ni la plantilla', planStartPending({ rules: [template(), pending, { ...pending, id: 'x', scopeId: 'user-2' }], userId: 'user-3', nowMs: at }).started.length === 0);
    const noTpl = planStartPending({ rules: [pending], userId: U, nowMs: at });
    ok('sin plantilla conserva sus propios títulos (no la vacía)', noTpl.started.length === 1 && JSON.stringify(noTpl.started[0].titleIds) === '["obra-1","obra-2"]');
}

section('[4] reintentos y reenvíos no mueven fechas');
{
    const started = planStartPending({ rules: [template(), pending], userId: U, nowMs: NOW + DAY }).rules;
    const retry = planRulePhase({ rules: started, input: input(2, { activationAt: NOW + 30 * DAY }), userId: U, nowMs: NOW + 30 * DAY, accountActive: true });
    ok('reenvío de un pedido ya iniciado: «none», la misma regla, mismas fechas', retry.ruleOp === 'none' && retry.rule.expiresAt === computeExpiresAt(NOW + DAY) && retry.rule.b2c.activationAt === NOW + DAY);
    const stillInvited = planRulePhase({ rules: [template(), pending], input: input(2), userId: U, nowMs: NOW + 3 * DAY, accountActive: false });
    ok('reintento con la cuenta todavía invitada: sigue pendiente', stillInvited.ruleOp === 'none' && isPendingB2cRule(stillInvited.rule));
    const heal = planRulePhase({ rules: [template(), pending], input: input(2), userId: U, nowMs: NOW + 3 * DAY, accountActive: true });
    ok('reintento con la cuenta ya activa y la regla aún pendiente: se inicia ahora (una vez)', heal.ruleOp === 'start' && heal.rule.b2c.activationAt === NOW + 3 * DAY && heal.rule.expiresAt === computeExpiresAt(NOW + 3 * DAY));
    ok('otra cuenta o clave distinta con el mismo pedido ⇒ idempotency_mismatch', codeOf(() => planRulePhase({ rules: [template(), pending], input: input(2), userId: 'user-9', nowMs: NOW, accountActive: true })) === 'idempotency_mismatch'
        && codeOf(() => planRulePhase({ rules: [template(), { ...pending, b2c: { ...pending.b2c, idempotencyKey: 'otra' } }], input: input(2), userId: U, nowMs: NOW })) === 'idempotency_mismatch');
}

section('[5] cancelación antes de activar; reembolso después');
{
    const rev = planRevoke({ rules: [pending], input: { orderId: 2, source: 'test', idempotencyKey: 'test:order:2', reason: 'cancelled' }, nowMs: NOW + DAY });
    ok('revocar una regla pendiente: deja de estar pendiente y queda revocada, sin haber empezado nunca', rev.status === 'revoked' && rev.rule.b2c.revokedAt === NOW + DAY && rev.rule.b2c.pendingActivation === undefined && rev.rule.b2c.revokedBeforeActivation === true && rev.rule.expiresAt === 0 && rev.rule.b2c.activationAt === null);
    ok('estado «revoked»; activar la cuenta después no la inicia', b2cAccessState(rev.rule, NOW + 2 * DAY) === 'revoked' && planStartPending({ rules: [template(), rev.rule], userId: U, nowMs: NOW + 2 * DAY }).started.length === 0);
    ok('…ni un reenvío con la cuenta activa', planRulePhase({ rules: [template(), rev.rule], input: input(2), userId: U, nowMs: NOW + 2 * DAY, accountActive: true }).ruleOp === 'none');
    ok('una regla revocada ya no bloquea una compra nueva', planRulePhase({ rules: [template(), rev.rule], input: input(7), userId: U, nowMs: NOW + 2 * DAY, accountActive: true }).ruleOp === 'create');
    const active = planRulePhase({ rules: [template()], input: input(5), userId: U, nowMs: NOW, accountActive: true }).rule;
    const refund = planRevoke({ rules: [active], input: { orderId: 5, source: 'test', idempotencyKey: 'test:order:5', reason: 'refunded' }, nowMs: NOW + 40 * DAY });
    ok('reembolso de una regla activa: vence en ese instante y conserva cuándo empezó', refund.rule.expiresAt === NOW + 40 * DAY && refund.rule.b2c.activationAt === NOW && refund.rule.b2c.revokedBeforeActivation === undefined);
}

section('[6] vencimiento, catálogo y renovación');
{
    const active = planRulePhase({ rules: [template()], input: input(6), userId: U, nowMs: NOW, accountActive: true }).rule;
    ok('doce meses después del inicio: «expired»', b2cAccessState(active, active.expiresAt - 1) === 'active' && b2cAccessState(active, active.expiresAt) === 'expired');
    ok('una regla vencida no se renueva sola: un reenvío del pedido no la toca', planRulePhase({ rules: [template(), active], input: input(6), userId: U, nowMs: active.expiresAt + DAY, accountActive: true }).ruleOp === 'none');
    ok('vencida, una compra nueva sí crea otra regla con otros doce meses', planRulePhase({ rules: [template(), active], input: input(8), userId: U, nowMs: active.expiresAt + DAY, accountActive: true }).rule.expiresAt === computeExpiresAt(active.expiresAt + DAY));
    const sync = planTitleSync({ rules: [template(['obra-1', 'obra-2', 'obra-9']), pending, { ...active, expiresAt: NOW - DAY }], nowMs: NOW });
    ok('la sincronización del catálogo alcanza a la regla pendiente (no está vencida) y no a la vencida', sync.updated === 1 && JSON.stringify(sync.rules[1].titleIds) === '["obra-1","obra-2","obra-9"]' && isPendingB2cRule(sync.rules[1]) && JSON.stringify(sync.rules[2].titleIds) === '["obra-1","obra-2"]');
    ok('estados de una regla ajena al B2C: sin estado', b2cAccessState(template(), NOW) === null && b2cAccessState(null, NOW) === null);
}

section('[7] la fase de identidad no cambia: pagar no activa la cuenta');
{
    const normalizeEmail = (e) => String(e || '').trim().toLowerCase(), normalizeUser = (u) => u;
    const plan = planUserPhase({ users: [], rules: [template()], input: input(9), nowMs: NOW, normalizeEmail, normalizeUser, newUserId: 'user-n', newToken: 't'.repeat(64), newLoginId: () => 'lec-aaaa-bbbb-cccc', termsOnFileFor: () => false });
    ok('alta nueva ⇒ cuenta INVITADA con enlace; nunca activa por el pago', plan.userOp === 'create' && plan.user.accountStatus === 'invited' && /token=/.test(plan.activationUrl) && !plan.user.password);
    const kid = planUserPhase({ users: [], rules: [template()], input: input(10, { reader: { type: 'minor', loginId: null, name: 'Lupe' } }), nowMs: NOW, normalizeEmail, normalizeUser, newUserId: 'user-k', newToken: 'k'.repeat(64), newLoginId: () => 'lec-aaaa-bbbb-cccc', termsOnFileFor: () => false });
    ok('lector menor ⇒ cuenta representada invitada: usuario propio, sin correo, contacto del adulto como vínculo', kid.user.accountStatus === 'invited' && kid.user.email === '' && kid.user.loginId === 'lec-aaaa-bbbb-cccc' && kid.user.representedBy.email === 'a@fixture.invalid');
    const active = { id: 'user-a', email: 'a@fixture.invalid', roles: ['lector'], accountStatus: 'active', b2c: true };
    ok('cuenta ya activa sin términos vigentes ⇒ 422 (no se concede acceso por inferencia)', codeOf(() => planUserPhase({ users: [active], rules: [template()], input: input(11), nowMs: NOW, normalizeEmail, normalizeUser, newUserId: 'x', newToken: 'x', termsOnFileFor: () => false })) === 'terms_acceptance_required');
    ok('…registro no verificable ⇒ 503 (fallo cerrado)', codeOf(() => planUserPhase({ users: [active], rules: [template()], input: input(11), nowMs: NOW, normalizeEmail, normalizeUser, newUserId: 'x', newToken: 'x', termsOnFileFor: () => null })) === 'acceptance_registry_unavailable');
    ok('identificador de regla estable por pedido', ruleIdFor('test', 9) === 'access-b2c-test-order-9');
}

console.log(`\nb2cEffectiveActivation.unit — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
