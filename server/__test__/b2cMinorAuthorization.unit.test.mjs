/**
 * b2cMinorAuthorization.unit.test.mjs — CHP V9 Bloque II · F7-C4. Representación y autorizaciones de menores (lógica pura, corre en CI).
 *
 *  - la cuenta de un lector menor representado solo la activa su representante legal, con A0 y A1 expresas;
 *  - el pago, la invitación o el uso no aportan ninguna decisión;
 *  - una compra nueva no reabre una autorización de cuenta y lectura (A1) retirada o negada.
 * El tramo HTTP (servidor real, dos réplicas, dos familias y dos instituciones) está en b2cMinorAuthorization.integration.
 *
 *   node server/__test__/b2cMinorAuthorization.unit.test.mjs
 */
import { planActivationDecisions, isRepresentedMinorAccount } from '../privacy/acceptance.mjs';
import { planUserPhase, B2cError, B2C_TEMPLATE_RULE_ID, ruleIdFor } from '../b2c/b2cProvisioning.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof B2cError ? `${e.status}:${e.code}` : `otro:${e?.message}`; } };

const CTX = { today: '2026-11-23', ref: 'ACT-00000000-0000-4000-8000-000000000000' };
const V = { terms: true, termsVersion: DOCS.terms.version, policy: true, policyVersion: '001@1.0', dataNoticeVersion: DOCS.dataNotice.version };
const REP = { ...V, actingAs: 'legal_representative', A0: 'yes', A1: 'yes' };
const ADULT = { ...V, actingAs: 'titular', adultDeclared: true, A1: 'yes' };
const CONTACT = 'adulta@fixture.invalid';
const minorAccount = { id: 'user-k', email: '', loginId: 'lec-aaaa-bbbb-cccc', representedBy: { email: CONTACT }, roles: ['lector'], accountStatus: 'invited', b2c: true };
const adultAccount = { id: 'user-a', email: CONTACT, roles: ['lector'], accountStatus: 'invited', b2c: true };

section('[1] qué es una cuenta de menor representada');
ok('usuario propio + contacto del adulto ⇒ representada', isRepresentedMinorAccount(minorAccount) === true);
ok('una cuenta con correo propio, sin contacto o sin usuario no lo es', [adultAccount, { ...minorAccount, representedBy: undefined }, { ...minorAccount, loginId: '' }, { ...minorAccount, representedBy: { email: '' } }, null].every((u) => isRepresentedMinorAccount(u) === false));

section('[2] la cuenta de un menor solo la activa su representante legal');
{
    const asAdult = planActivationDecisions(minorAccount, ADULT, CTX);
    ok('«titular mayor de edad» en la cuenta de un menor ⇒ REPRESENTATIVE_REQUIRED, sin decisiones', asAdult.ok === false && asAdult.code === 'REPRESENTATIVE_REQUIRED' && asAdult.required.includes('actingAs') && asAdult.decisions === undefined, JSON.stringify(asAdult));
    ok('…aunque la compra hubiera dejado términos vigentes (no puede haberlos: la tienda no los admite para un menor)', planActivationDecisions(minorAccount, ADULT, { ...CTX, termsAccepted: true }).code === 'REPRESENTATIVE_REQUIRED');
    const rep = planActivationDecisions(minorAccount, REP, CTX);
    ok('representante con A0 y A1 = sí ⇒ T, A0, A1 y la Política (P) en calidad de representante legal, declaradas y sin verificar', rep.ok === true && rep.profile === 'representative' && JSON.stringify(rep.decisions.map((d) => d.kind)) === '["T","A0","A1","P"]'
        && rep.decisions.every((d) => d.capacity === 'legal_representative' && d.verification === 'unverified' && d.status === 'granted' && d.subjectId === 'user-k' && d.requestRef === CTX.ref && d.actDay === CTX.today), JSON.stringify(rep));
    ok('cada decisión lleva la versión del documento que se aceptó', rep.decisions[0].version === DOCS.terms.version && rep.decisions.slice(1, 3).every((d) => d.version === DOCS.dataNotice.version) && rep.decisions[3].version === DOCS.policy.version);
    const need = (acc) => { const r = planActivationDecisions(minorAccount, acc, CTX); return r.ok ? 'ok' : `${r.code}:${(r.required || []).join(',')}`; };
    ok('nada se presume: sin A0, sin A1, sin términos o sin declarar la calidad ⇒ faltan', need({ ...REP, A0: undefined }) === 'DECISIONS_REQUIRED:A0' && need({ ...REP, A1: undefined }) === 'DECISIONS_REQUIRED:A1'
        && need({ ...REP, terms: false }) === 'DECISIONS_REQUIRED:T' && need({ ...REP, actingAs: undefined }) === 'DECISIONS_REQUIRED:actingAs' && need({}) .startsWith('DECISIONS_REQUIRED:'));
    ok('A0 = no o A1 = no ⇒ la cuenta no se activa', need({ ...REP, A0: 'no' }) === 'A0_DENIED:' && need({ ...REP, A1: 'no' }) === 'A1_DENIED:');
    ok('A2 no existe sin institución: «sí» o «no» ⇒ A2_NOT_APPLICABLE; «no aplica» o ausente ⇒ sin decisión A2', need({ ...REP, A2: 'yes' }) === 'A2_NOT_APPLICABLE:A2' && need({ ...REP, A2: 'no' }) === 'A2_NOT_APPLICABLE:A2'
        && planActivationDecisions(minorAccount, { ...REP, A2: 'not_applicable' }, CTX).decisions.every((d) => d.kind !== 'A2'));
    const opt = planActivationDecisions(minorAccount, { ...REP, A3: 'yes', A5: 'no' }, CTX).decisions;
    ok('las finalidades opcionales van separadas: solo las que se deciden, cada una con su sí o su no', JSON.stringify(opt.map((d) => `${d.kind}:${d.status}`)) === '["T:granted","A0:granted","A1:granted","A3:granted","A5:denied","P:granted"]'
        && planActivationDecisions(minorAccount, REP, CTX).decisions.every((d) => !['A3', 'A5'].includes(d.kind)));
}

section('[3] lo demás no cambia');
{
    const adult = planActivationDecisions(adultAccount, ADULT, CTX);
    ok('una persona adulta sigue activando su propia cuenta como titular (autenticada, efectiva)', adult.ok === true && adult.profile === 'titular' && adult.decisions.every((d) => d.capacity === 'titular' && d.verification === 'self_authenticated'));
    ok('…y con términos ya aceptados en la compra no se duplican', JSON.stringify(planActivationDecisions(adultAccount, ADULT, { ...CTX, termsAccepted: true }).decisions.map((d) => d.kind)) === '["A1","P"]');
    const inst = { id: 'user-i', email: 'lector@fixture.invalid', roles: ['lector'], organizationId: 'org-a' };
    ok('lector institucional: A2 sí/no sigue siendo obligatoria e independiente', planActivationDecisions(inst, ADULT, CTX).required?.includes('A2') && planActivationDecisions(inst, { ...ADULT, A2: 'no' }, CTX).decisions.some((d) => d.kind === 'A2' && d.status === 'denied'));
    const med = { id: 'user-m', email: 'm@fixture.invalid', roles: ['mediador'], loginId: 'x', representedBy: { email: 'y@fixture.invalid' } };
    ok('el compromiso 005 del mediador no cambia (ni siquiera con campos de cuenta representada)', planActivationDecisions(med, { ...V, adultDeclared: true, mediatorCommitment: true, mediatorVersion: DOCS.mediator.version }, CTX).decisions.some((d) => d.kind === 'C005'));
}

section('[4] una compra nueva no reabre una autorización retirada');
{
    const NOW = Date.UTC(2026, 10, 23, 15), normalizeEmail = (e) => String(e || '').trim().toLowerCase(), normalizeUser = (u) => u;
    const tpl = { id: B2C_TEMPLATE_RULE_ID, scope: 'group', scopeId: 'group-b2c-lectores', titleIds: ['obra-1'], collectionIds: [], expiresAt: null };
    const input = (orderId, extra = {}) => ({ orderId, productId: 345, plan: 'digital', source: 'test', email: CONTACT, fullName: '', activationAt: NOW, idempotencyKey: `test:order:${orderId}`, dryRun: false, termsAcceptance: null, reader: null, ...extra });
    const base = { nowMs: NOW, normalizeEmail, normalizeUser, newUserId: 'user-n', newToken: 't'.repeat(64), newLoginId: () => 'lec-dddd-eeee-ffff', termsOnFileFor: () => true };
    const activeMinor = { ...minorAccount, accountStatus: 'active' }, activeAdult = { ...adultAccount, accountStatus: 'active' };
    const withdrawn = (ids) => (id) => ids.includes(id);
    const reader = { type: 'minor', loginId: minorAccount.loginId, name: '' };
    ok('menor con A1 retirada + pedido nuevo ⇒ 422 authorization_withdrawn', codeOf(() => planUserPhase({ ...base, users: [activeMinor], rules: [tpl], input: input(1, { reader }), authorizationWithdrawnFor: withdrawn(['user-k']) })) === '422:authorization_withdrawn');
    ok('adulta con A1 retirada + pedido nuevo ⇒ 422 (aunque traiga la aceptación de la compra)', codeOf(() => planUserPhase({ ...base, users: [activeAdult], rules: [tpl], input: input(2, { termsAcceptance: { version: DOCS.terms.version, acceptedAt: NOW } }), authorizationWithdrawnFor: withdrawn(['user-a']) })) === '422:authorization_withdrawn');
    ok('también si la cuenta seguía invitada', codeOf(() => planUserPhase({ ...base, users: [minorAccount], rules: [tpl], input: input(3, { reader }), authorizationWithdrawnFor: withdrawn(['user-k']) })) === '422:authorization_withdrawn');
    ok('la retirada de una cuenta no afecta a otra, ni a un alta nueva', planUserPhase({ ...base, users: [activeMinor], rules: [tpl], input: input(4, { reader }), authorizationWithdrawnFor: withdrawn(['user-a']) }).userOp === 'none'
        && planUserPhase({ ...base, users: [activeMinor], rules: [tpl], input: input(5, { reader: { type: 'minor', loginId: null, name: 'Otro' } }), authorizationWithdrawnFor: withdrawn(['user-k']) }).userOp === 'create');
    const existing = { id: ruleIdFor('test', 6), scope: 'user', scopeId: 'user-k', titleIds: ['obra-1'], expiresAt: NOW + 1e9, b2c: { idempotencyKey: 'test:order:6', orderId: 6, source: 'test', expiresAt: NOW + 1e9 } };
    ok('reintento de un pedido que ya tenía su regla: sin cambio (idempotencia)', planUserPhase({ ...base, users: [activeMinor], rules: [tpl, existing], input: input(6, { reader }), authorizationWithdrawnFor: withdrawn(['user-k']) }).status === 'already_activated');
    ok('registro no verificable (null) o sin puerta: no se concluye una retirada; rigen las demás reglas (términos)', planUserPhase({ ...base, users: [activeMinor], rules: [tpl], input: input(7, { reader }), authorizationWithdrawnFor: () => null }).userOp === 'none'
        && planUserPhase({ ...base, users: [activeMinor], rules: [tpl], input: input(8, { reader }) }).userOp === 'none'
        && codeOf(() => planUserPhase({ ...base, termsOnFileFor: () => null, users: [activeMinor], rules: [tpl], input: input(9, { reader }), authorizationWithdrawnFor: () => null })) === '503:acceptance_registry_unavailable');
    ok('menor activo sin representación verificada + pedido nuevo: sigue siendo revisión manual (422 terms_acceptance_required)', codeOf(() => planUserPhase({ ...base, termsOnFileFor: () => false, users: [activeMinor], rules: [tpl], input: input(10, { reader }), authorizationWithdrawnFor: () => false })) === '422:terms_acceptance_required');
}

console.log(`\nb2cMinorAuthorization.unit — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
