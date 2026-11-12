/**
 * b2cProvisioning.unit.test.mjs — CHP-B2C-PROVISIONING-01 (WEB-REORG P2-C). Lógica pura, sin E/S.
 */
import crypto from 'node:crypto';
import {
    makeB2cLoginId, B2C_LOGIN_ID_RX, isRepresentedAccount,
    computeExpiresAt, signB2cRequest, verifyB2cSignature, validateProvisionInput, validateRevokeInput,
    planUserPhase, planRulePhase, planRevoke, planTitleSync, ruleIdFor, idempotencyKeyFor, B2cError, B2C_TEMPLATE_RULE_ID,
    assertB2cDocumentsApproved, b2cTemplateRule, B2C_REQUIRED_DOCUMENTS, TERMS_CLOCK_SKEW_MS, termsActDayMs,
} from '../b2c/b2cProvisioning.mjs';
import { dayOf } from '../privacy/a2Registry.mjs';
import { acceptanceDocumentsStatus, requiredDocumentIds } from '../privacy/acceptance.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';

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
const P3 = planUserPhase({ users: [activeUser], rules: [template], input: input3, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T4', termsOnFileFor: () => true });
ok('cuenta activa existente (colegio) con T vigente: se reutiliza sin tocarla y sin enlace', P3.userOp === 'none' && P3.userId === 'U-ACT' && P3.activationUrl === null && P3.reusedAccount === true && P3.user === activeUser);
ok('cuenta deshabilitada → account_not_available',
    throwsCode(() => planUserPhase({ users: [{ ...activeUser, accountStatus: 'disabled' }], rules: [template], input: input3, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T' }), 'account_not_available'));
// V8.1-PROD-05B (G3): cuenta YA ACTIVA y compra nueva sin T del checkout.
const reuse = (extra) => planUserPhase({ users: [activeUser], rules: [template], input: input3, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T', ...extra });
ok('G3: activa sin T del checkout ni T previa → 422 terms_acceptance_required', throwsCode(() => reuse({ termsOnFileFor: () => false }), 'terms_acceptance_required'));
ok('G3: sin consulta de T (por defecto) → fallo cerrado 422', throwsCode(() => reuse({}), 'terms_acceptance_required'));
ok('G3: registro no verificable → 503 acceptance_registry_unavailable', throwsCode(() => reuse({ termsOnFileFor: () => null }), 'acceptance_registry_unavailable'));
const input3T = validateProvisionInput({ ...base, orderId: 1003, idempotencyKey: 'test:order:1003', email: 'lector@colegio.invalid', termsAcceptance: { version: DOCS.terms.version, acceptedAt: now - 1000 } }, now);
ok('G3: activa CON T del checkout → reutilizada', planUserPhase({ users: [activeUser], rules: [template], input: input3T, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'X', newToken: 'T', termsOnFileFor: () => false }).userOp === 'none');
ok('G3: cuenta nueva (invitada) no lo exige: la T se pide al activar', planUserPhase({ users: [], rules: [template], input: input3, nowMs: now, normalizeEmail, normalizeUser, newUserId: 'N', newToken: 'T' }).userOp === 'create');
const prevRule = planRulePhase({ rules: [template], input: input3, userId: 'U-ACT', nowMs: now }).rule;
ok('G3: reintento de un pedido ya aprovisionado → idempotente sin exigir T', reuse({ rules: [template, prevRule], termsOnFileFor: () => false }).status === 'already_activated');

console.log('V8.1-PROD-05B — documentos aprobados (G1) y aceptación acreditable (G2)');
const docsWith = (ids, over = {}) => acceptanceDocumentsStatus({ CHP_ACCEPTANCE_DOCUMENTS: JSON.stringify(Object.fromEntries(Object.values(DOCS)
    .filter((d) => ids.includes(d.id)).map((d) => [d.id, { version: d.version, url: `https://docs.example.invalid/${d.id}`, ...(over[d.id] || {}) }]))) });
const T_OK = { version: DOCS.terms.version, acceptedAt: now - 1000 };
ok('G1 = documentos de activación de un lector (001, 002, 004)', JSON.stringify([...B2C_REQUIRED_DOCUMENTS]) === JSON.stringify(requiredDocumentIds({ roles: ['lector'] })));
ok('G1: sin configuración → 503 DOCUMENTS_NOT_APPROVED', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: acceptanceDocumentsStatus({}) }), 'DOCUMENTS_NOT_APPROVED'));
ok('G1: JSON inválido → 503', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: acceptanceDocumentsStatus({ CHP_ACCEPTANCE_DOCUMENTS: '{x' }) }), 'DOCUMENTS_NOT_APPROVED'));
ok('G1: 001 y 002 aprobados, 004 pendiente → 503', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: docsWith(['001', '002', '005']) }), 'DOCUMENTS_NOT_APPROVED'));
ok('G1: 004 con otra versión → 503', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: docsWith(['001', '002', '004'], { '004': { version: '004@0.9' } }) }), 'DOCUMENTS_NOT_APPROVED'));
ok('G1: 001 con enlace http → 503', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: docsWith(['001', '002', '004'], { '001': { url: 'http://docs.example.invalid/001' } }) }), 'DOCUMENTS_NOT_APPROVED'));
ok('G1: sin el 002 aunque llegue T → 503 (la T nunca se valida contra un 002 no aprobado)', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: docsWith(['001', '004']), termsAcceptance: T_OK }), 'DOCUMENTS_NOT_APPROVED'));
ok('G1: 001, 002 y 004 aprobados → sin error', (() => { assertB2cDocumentsApproved({ docsStatus: docsWith(['001', '002', '004']), termsAcceptance: T_OK }); return true; })());
ok('G2: T de otra versión que la aprobada → 400', throwsCode(() => assertB2cDocumentsApproved({ docsStatus: docsWith(['001', '002', '004']), termsAcceptance: { ...T_OK, version: '002@0.9' } }), 'invalid_terms_acceptance'));
ok('G2: aceptación posterior a la activación (>5 min) → 400', throwsCode(() => validateProvisionInput({ ...base, activationAt: now - 3600e3, termsAcceptance: { version: DOCS.terms.version, acceptedAt: now } }, now), 'invalid_terms_acceptance'));
ok('G2: aceptación sin fecha → 400', throwsCode(() => validateProvisionInput({ ...base, termsAcceptance: { version: DOCS.terms.version } }, now), 'invalid_terms_acceptance'));
ok('G2: aceptación no objeto → 400', throwsCode(() => validateProvisionInput({ ...base, termsAcceptance: true }, now), 'invalid_terms_acceptance'));

console.log('API-HARDEN-01 — tolerancia de reloj de termsAcceptance.acceptedAt');
const tIn = (acceptedAt, extra = {}) => validateProvisionInput({ ...base, termsAcceptance: { version: DOCS.terms.version, acceptedAt }, ...extra }, now);
const tCode = (acceptedAt, extra) => { try { tIn(acceptedAt, extra); return 'ok'; } catch (e) { return `${e.status}:${e.code}`; } };
ok('tolerancia explícita: 120000 ms', TERMS_CLOCK_SKEW_MS === 120000);
ok('adelanto de 4 s → aceptada, fecha original intacta', tIn(now + 4000).termsAcceptance.acceptedAt === now + 4000);
ok('adelanto de 120 s (límite) → aceptada, fecha original intacta', tIn(now + 120000).termsAcceptance.acceptedAt === now + 120000);
ok('adelanto de 120 s + 1 ms → 400', tCode(now + 120001) === '400:invalid_terms_acceptance');
ok('adelanto de 121 s → 400', tCode(now + 121000) === '400:invalid_terms_acceptance');
ok('adelanto de 3 min → 400', tCode(now + 180000) === '400:invalid_terms_acceptance');
ok('pasada reciente → aceptada', tCode(now - 60000) === 'ok');
ok('la tolerancia no ensancha el límite respecto de la activación: 5 min + 1 ms después de activationAt → 400', tCode(now - 3600e3 + 300001, { activationAt: now - 3600e3 }) === '400:invalid_terms_acceptance' && tCode(now - 3600e3 + 300000, { activationAt: now - 3600e3 }) === 'ok');
ok('la tolerancia no afecta a activationAt (sigue con su propio margen de 5 min)', (() => { try { validateProvisionInput({ ...base, activationAt: now + 300001 }, now); return false; } catch (e) { return e.code === 'invalid_activation_at'; } })());
ok('anterior a la cota mínima (2024-01-01) → 400', tCode(Date.UTC(2023, 11, 31)) === '400:invalid_terms_acceptance');
for (const [label, bad] of [['cadena ISO', '2026-11-12T10:00:00Z'], ['decimal', now + 0.5], ['negativa', -1], ['cero', 0], ['segundos en vez de ms', Math.floor(now / 1000)], ['null', null], ['NaN', NaN], ['Infinity', Infinity], ['objeto', {}], ['arreglo', [now]], ['cadena numérica', String(now)], ['booleano', true]]) {
    ok(`formato inválido (${label}) → 400`, tCode(bad) === '400:invalid_terms_acceptance');
}
ok('otra versión dentro de la tolerancia → 400 (la versión se valida igual)', (() => { try { validateProvisionInput({ ...base, termsAcceptance: { version: '002@0.9', acceptedAt: now + 4000 } }, now); return false; } catch (e) { return e.code === 'invalid_terms_acceptance'; } })());
// Día del acto: cruce de medianoche en Bogotá (UTC−5). La app está a las 23:59:30 y la tienda va 60 s adelantada.
const midnight = Date.UTC(2026, 10, 13, 5, 0, 0); // 2026-11-13 00:00:00 en Bogotá
const appNow = midnight - 30000, storeAt = appNow + 60000;
ok('sin acotar, la aceptación adelantada caería en el día SIGUIENTE al de la app', dayOf(storeAt) === '2026-11-13' && dayOf(appNow) === '2026-11-12');
ok('día del acto acotado al reloj de la app → nunca futuro', dayOf(termsActDayMs(storeAt, appNow)) === dayOf(appNow));
ok('aceptación pasada → su propio día, sin cambio', termsActDayMs(appNow - 86400000, appNow) === appNow - 86400000 && dayOf(termsActDayMs(appNow - 86400000, appNow)) === '2026-11-11');
ok('acotar el día no altera la evidencia: validateProvisionInput devuelve el acceptedAt original', validateProvisionInput({ ...base, activationAt: appNow, termsAcceptance: { version: DOCS.terms.version, acceptedAt: storeAt } }, appNow).termsAcceptance.acceptedAt === storeAt);
ok('plantilla vacía → template_rule_missing', throwsCode(() => b2cTemplateRule([{ ...template, titleIds: [] }]), 'template_rule_missing'));
ok('sin plantilla → template_rule_missing (503)', throwsCode(() => planRulePhase({ rules: [], input, userId: 'U', nowMs: now }), 'template_rule_missing'));

console.log('revocación');
const RV = planRevoke({ rules: rulesAfter, input: validateRevokeInput({ orderId: 1001, source: 'test', idempotencyKey: 'test:order:1001', reason: 'refunded' }), nowMs: now + 5000 });
ok('revoked: expiresAt = ahora, motivo registrado', RV.status === 'revoked' && RV.rule.expiresAt === now + 5000 && RV.rule.b2c.revokeReason === 'refunded');
ok('solo cambia esa regla (la plantilla no se toca)', RV.rule.id === ruleIdFor('test', 1001) && template.titleIds.length === 2);
const RV2 = planRevoke({ rules: [template, RV.rule], input: validateRevokeInput({ orderId: 1001, source: 'test', idempotencyKey: 'test:order:1001', reason: 'refunded' }), nowMs: now + 9000 });
ok('revoke idempotente: already_revoked sin cambiar expiresAt', RV2.status === 'already_revoked' && RV2.rule.expiresAt === now + 5000);
ok('revoke de un pedido sin regla → 404', throwsCode(() => planRevoke({ rules: [template], input: validateRevokeInput({ orderId: 9, source: 'test', idempotencyKey: 'test:order:9' }), nowMs: now }), 'rule_not_found'));
ok('idempotencyKeyFor', idempotencyKeyFor('production', 5) === 'production:order:5');

console.log('cuentas representadas (V9 F3-D1)');
{
    // — usuario de acceso —
    const ids = new Set(Array.from({ length: 2000 }, () => makeB2cLoginId()));
    ok('loginId: formato lec-xxxx-xxxx-xxxx, 2000 generados sin repetición', ids.size === 2000 && [...ids].every((x) => B2C_LOGIN_ID_RX.test(x)));
    ok('loginId: 12 símbolos de 5 bits (60 bits), determinado solo por los bytes aleatorios', makeB2cLoginId(Buffer.alloc(12, 0)) === 'lec-aaaa-aaaa-aaaa' && makeB2cLoginId(Buffer.alloc(12, 31)) === 'lec-9999-9999-9999' && makeB2cLoginId(Buffer.alloc(12, 255)) === 'lec-9999-9999-9999');
    // — contrato —
    const C = 'madre@fixture.invalid';
    const inp = (orderId, reader, extra = {}) => validateProvisionInput({ ...base, orderId, idempotencyKey: `test:order:${orderId}`, email: C, fullName: 'Madre Fixture', ...(reader === undefined ? {} : { reader }), ...extra }, now);
    ok('sin `reader` el contrato no cambia (reader = null)', validateProvisionInput(base, now).reader === null && validateProvisionInput(base, now).email === base.email);
    ok('reader menor válido: sin loginId, apodo opcional y normalizado', JSON.stringify(inp(1, { type: 'minor' }).reader) === '{"type":"minor","loginId":null,"name":""}' && inp(1, { type: 'minor', name: '  Lu\tpe \n' }).reader.name === 'Lu pe');
    for (const [label, r] of [['tipo desconocido', { type: 'adult' }], ['sin tipo', {}], ['no es objeto', 'minor'], ['arreglo', [{ type: 'minor' }]], ['nulo', null], ['loginId mal formado', { type: 'minor', loginId: 'lupe' }],
        ['loginId no cadena', { type: 'minor', loginId: 7 }], ['loginId con mayúsculas', { type: 'minor', loginId: 'LEC-AAAA-AAAA-AAAA' }], ['nombre no cadena', { type: 'minor', name: 5 }], ['nombre de 61 caracteres', { type: 'minor', name: 'ñ'.repeat(61) }]]) {
        ok(`reader inválido (${label}) → 400 invalid_reader`, throwsCode(() => inp(1, r), 'invalid_reader'));
    }
    ok('nombre de 60 caracteres admitido', inp(1, { type: 'minor', name: 'ñ'.repeat(60) }).reader.name.length === 60);
    ok('la aceptación del comprador no se admite como T de la cuenta del menor → 400', throwsCode(() => inp(1, { type: 'minor' }, { termsAcceptance: { version: DOCS.terms.version, acceptedAt: now - 1000 } }), 'terms_acceptance_not_applicable'));

    // — almacén simulado: fase 1 + fase 2 como las aplica server.js —
    const users = []; let rules = [template]; let n = 0; const seq = [];
    const loginIds = () => makeB2cLoginId();
    const phase1 = (input, { tof = () => false, gen = loginIds } = {}) => {
        const p = planUserPhase({ users, rules, input, nowMs: now, normalizeEmail, normalizeUser, newUserId: `U${++n}`, newToken: `TK${n}`, newLoginId: gen, termsOnFileFor: tof });
        if (p.userOp === 'create') users.push(p.user); else if (p.userOp !== 'none') users[users.findIndex((u) => u.id === p.userId)] = p.user;
        return p;
    };
    const phase2 = (input, p) => { const r = planRulePhase({ rules, input, userId: p.userId, nowMs: now }); if (r.ruleOp === 'create') rules.push(r.rule); return r; };
    const buy = (input, o) => { const p = phase1(input, o); return { ...p, rule: phase2(input, p) }; };
    const snap = () => JSON.stringify([users, rules]);
    const activateAcc = (id) => { const i = users.findIndex((u) => u.id === id); const { inviteToken, inviteExpiresAt, ...rest } = users[i]; users[i] = { ...rest, accountStatus: 'active' }; };
    const expire = (ruleId) => { rules = rules.map((r) => (r.id === ruleId ? { ...r, expiresAt: now - 1 } : r)); };

    // 1. la adulta compra para sí misma: sin regresión
    const self = buy(validateProvisionInput({ ...base, orderId: 2000, idempotencyKey: 'test:order:2000', email: C, fullName: 'Madre Fixture', termsAcceptance: { version: DOCS.terms.version, acceptedAt: now - 1000 } }, now));
    ok('[1] para sí misma: cuenta por correo, sin loginId ni vínculo', self.userOp === 'create' && self.user.email === C && self.user.loginId === undefined && self.user.representedBy === undefined && self.loginId === undefined && !isRepresentedAccount(self.user));
    activateAcc(self.userId);
    // 2. primer menor
    const k1 = buy(inp(2001, { type: 'minor', name: 'Lupe' }));
    ok('[2] primer menor: cuenta y regla propias', k1.userOp === 'create' && k1.userId !== self.userId && k1.rule.ruleOp === 'create' && k1.rule.rule.scopeId === k1.userId && k1.rule.rule.id === ruleIdFor('test', 2001));
    ok('…cuenta representada: loginId del servidor, contacto del adulto, sin correo propio, invitada', isRepresentedAccount(k1.user) && B2C_LOGIN_ID_RX.test(k1.loginId) && k1.user.loginId === k1.loginId && k1.user.email === '' && k1.user.representedBy.email === C && k1.user.accountStatus === 'invited' && k1.activationUrl === `/#/activar?token=${k1.user.inviteToken}`);
    ok('…lector sin grupos, colegio ni otro rol; el nombre de facturación no se copia a la cuenta', JSON.stringify(k1.user.roles) === '["lector"]' && k1.user.groupIds.length === 0 && k1.user.colegio === '' && k1.user.nombre_completo === 'Lupe' && !JSON.stringify(k1.user).includes('Madre Fixture'));
    ok('…el loginId no deriva del nombre del menor', !k1.loginId.includes('lupe') && k1.user.nombre_usuario === k1.loginId);
    // 3. segundo menor, mismo representante (con la adulta y el primer menor con suscripción vigente)
    const k2 = buy(inp(2002, { type: 'minor' }));
    ok('[3] segundo menor, mismo contacto: OTRA cuenta y OTRA regla, sin 409', k2.userOp === 'create' && k2.userId !== k1.userId && k2.loginId !== k1.loginId && k2.rule.rule.scopeId === k2.userId && k2.user.representedBy.email === C && k2.user.nombre_completo === 'Lector');
    ok('[4] adulta con suscripción propia + menores: tres cuentas y tres reglas separadas', users.length === 3 && new Set(rules.filter((r) => r.b2c).map((r) => r.scopeId)).size === 3 && users.filter((u) => normalizeEmail(u.email) === C).length === 1);
    // 6. loginId ajeno o inexistente
    const before = snap();
    const unknown = 'lec-zzzz-zzzz-zzzz';
    const eUnknown = (() => { try { phase1(inp(2010, { type: 'minor', loginId: unknown })); } catch (e) { return e; } })();
    const eForeign = (() => { try { phase1(validateProvisionInput({ ...base, orderId: 2011, idempotencyKey: 'test:order:2011', email: 'otro@fixture.invalid', reader: { type: 'minor', loginId: k1.loginId } }, now)); } catch (e) { return e; } })();
    ok('[6] loginId inexistente y loginId de otro representante → la MISMA respuesta 409 account_not_available', eUnknown?.status === 409 && eUnknown.code === 'account_not_available' && eForeign?.status === 409 && eForeign.code === eUnknown.code && eForeign.message === eUnknown.message);
    ok('…sin datos de nadie en el error y sin ninguna escritura', Object.keys(eForeign).sort().join() === 'code,status' && snap() === before);
    ok('…conocer el correo de un adulto no da su cuenta: una compra «menor» con ese correo crea una cuenta nueva y no toca la suya', (() => { const a = JSON.stringify(users.find((u) => u.id === self.userId)); const p = phase1(inp(2012, { type: 'minor' })); const same = JSON.stringify(users.find((u) => u.id === self.userId)) === a; users.pop(); return p.userOp === 'create' && p.userId !== self.userId && same; })());
    // 7. reintento con la misma clave
    const cnt = [users.length, rules.length];
    const again = buy(inp(2001, { type: 'minor', name: 'Lupe' }));
    ok('[7] reintento del pedido: misma cuenta y regla, already_activated, enlace nuevo (invitación pendiente), sin duplicados', again.status === 'already_activated' && again.userId === k1.userId && again.loginId === k1.loginId && again.userOp === 'regenerate_token' && again.rule.ruleOp === 'none' && users.length === cnt[0] && rules.length === cnt[1]);
    ok('…un reintento que cambia de lector o de modalidad → 409 idempotency_mismatch', throwsCode(() => phase1(inp(2001, { type: 'minor', loginId: k2.loginId })), 'idempotency_mismatch') && throwsCode(() => phase1(inp(2001, undefined)), 'idempotency_mismatch') && throwsCode(() => phase1(inp(2000, { type: 'minor' })), 'idempotency_mismatch'));
    // 8. fallo intermedio: la cuenta se creó y la regla no llegó a escribirse
    const p3 = phase1(inp(2003, { type: 'minor' }));
    ok('[8] fallo intermedio: hay cuenta invitada y ninguna regla (sin acceso)', p3.userOp === 'create' && !rules.some((r) => r.scopeId === p3.userId));
    const u3 = users.length;
    const retry = buy(inp(2003, { type: 'minor' }));
    ok('…el reintento reutiliza ESA cuenta (b2cOrigin), no crea otra, y escribe la regla una sola vez', retry.userId === p3.userId && retry.loginId === p3.loginId && retry.userOp === 'regenerate_token' && users.length === u3 && retry.rule.ruleOp === 'create' && rules.filter((r) => r.id === ruleIdFor('test', 2003)).length === 1);
    ok('…y un tercer intento ya no escribe nada nuevo', (() => { const r = buy(inp(2003, { type: 'minor' })); return r.status === 'already_activated' && r.rule.ruleOp === 'none' && users.length === u3; })());
    ok('…la misma clave con otro contacto → 409 idempotency_mismatch (no se crea una segunda cuenta)', (() => { users.push({ ...p3.user, id: 'TMP', b2cOrigin: 'test:order:2020', loginId: makeB2cLoginId() }); const t = throwsCode(() => phase1(validateProvisionInput({ ...base, orderId: 2020, idempotencyKey: 'test:order:2020', email: 'otro@fixture.invalid', reader: { type: 'minor' } }, now)), 'idempotency_mismatch'); users.pop(); return t; })());
    // 5. recompra para un menor existente
    ok('[5] recompra con la suscripción aún vigente → 409 conflict_active_subscription (una vigente por cuenta, como siempre)', throwsCode(() => phase1(inp(2004, { type: 'minor', loginId: k1.loginId })), 'conflict_active_subscription'));
    expire(ruleIdFor('test', 2001));
    const inv = buy(inp(2004, { type: 'minor', loginId: k1.loginId }));
    ok('…cuenta aún sin activar + pedido nuevo → misma cuenta, enlace nuevo, regla del pedido nuevo', inv.userId === k1.userId && inv.userOp === 'regenerate_token' && inv.status === 'activated' && inv.reusedAccount === true && inv.rule.rule.id === ruleIdFor('test', 2004));
    activateAcc(k1.userId); expire(ruleIdFor('test', 2004));
    const b5 = snap();
    ok('…cuenta ACTIVA, representación SIN verificar → 422 terms_acceptance_required, sin escrituras (revisión manual)', throwsCode(() => phase1(inp(2005, { type: 'minor', loginId: k1.loginId }), { tof: () => false }), 'terms_acceptance_required') && snap() === b5);
    ok('…registro no verificable → 503 (fallo cerrado)', throwsCode(() => phase1(inp(2005, { type: 'minor', loginId: k1.loginId }), { tof: () => null }), 'acceptance_registry_unavailable'));
    const ver = buy(inp(2005, { type: 'minor', loginId: k1.loginId }), { tof: (id) => id === k1.userId });
    ok('…representación verificada por GVA (T efectiva) → activated en SU cuenta, sin enlace, regla nueva', ver.status === 'activated' && ver.userId === k1.userId && ver.userOp === 'none' && ver.activationUrl === null && ver.loginId === k1.loginId && ver.rule.rule.scopeId === k1.userId);
    ok('…la verificación de un menor no vale para su hermano', (() => { activateAcc(k2.userId); expire(ruleIdFor('test', 2002)); return throwsCode(() => phase1(inp(2006, { type: 'minor', loginId: k2.loginId }), { tof: (id) => id === k1.userId }), 'terms_acceptance_required'); })());
    ok('…cuenta deshabilitada → 409 account_not_available (misma respuesta que una ajena)', (() => { const i = users.findIndex((u) => u.id === k2.userId); const keep = users[i]; users[i] = { ...keep, accountStatus: 'disabled' }; const t = throwsCode(() => phase1(inp(2006, { type: 'minor', loginId: k2.loginId }), { tof: () => true }), 'account_not_available'); users[i] = keep; return t; })());
    // 9. revocación de un pedido
    const r9 = snap();
    const rv = planRevoke({ rules, input: validateRevokeInput({ orderId: 2003, source: 'test', idempotencyKey: 'test:order:2003', reason: 'refunded' }), nowMs: now + 1000 });
    ok('[9] revocar el pedido de un menor toca solo su regla; las demás cuentas y reglas quedan idénticas', rv.status === 'revoked' && rv.rule.id === ruleIdFor('test', 2003) && rv.rule.scopeId === p3.userId && snap() === r9 && rules.filter((r) => r.b2c && r.id !== rv.rule.id).every((r) => !r.b2c.revokedAt));
    // — unicidad del usuario de acceso —
    const taken = k1.loginId; let calls = 0;
    const fresh = phase1(inp(2030, { type: 'minor' }), { gen: () => (++calls === 1 ? taken : 'lec-abcd-efgh-2345') });
    ok('loginId repetido → se descarta y se genera otro', fresh.loginId === 'lec-abcd-efgh-2345' && calls === 2);
    const u30 = users.length;
    ok('sin loginId libre o con generador inválido → 503 login_id_unavailable, sin cuenta parcial', throwsCode(() => phase1(inp(2031, { type: 'minor' }), { gen: () => taken }), 'login_id_unavailable') && throwsCode(() => phase1(inp(2031, { type: 'minor' }), { gen: () => 'Lupe' }), 'login_id_unavailable') && users.length === u30);
    ok('pedido suprimido (regla sin titular) → 409 account_not_available, nunca se recrea', (() => { const id = ruleIdFor('test', 2030); const keep = rules; rules = [...rules, { id, scope: 'user', scopeId: 'suppressed', expiresAt: now - 1, b2c: { idempotencyKey: 'test:order:2030', suppressedAt: now } }]; const t = throwsCode(() => phase1(inp(2030, { type: 'minor' })), 'account_not_available'); rules = keep; return t; })());
    ok('ninguna cuenta representada comparte usuario, y ninguna entra por la búsqueda por correo', new Set(users.filter(isRepresentedAccount).map((u) => u.loginId)).size === users.filter(isRepresentedAccount).length && users.filter(isRepresentedAccount).every((u) => u.email === ''));
}

console.log('sincronización del catálogo B2C');
const tpl2 = { ...template, titleIds: ['o1', 'o2', 'o3'] };
const vigente = { ...R1.rule }; const vencida = { ...R1.rule, id: 'access-b2c-test-order-7', expiresAt: now - 1 };
const S1 = planTitleSync({ rules: [tpl2, vigente, vencida, { id: 'rule-colegio', scope: 'group', titleIds: ['x'] }], nowMs: now });
ok('actualiza solo la regla B2C vigente', S1.updated === 1 && JSON.stringify(S1.rules[1].titleIds) === '["o1","o2","o3"]');
ok('no toca la vencida ni la de colegio', JSON.stringify(S1.rules[2].titleIds) === '["o1","o2"]' && JSON.stringify(S1.rules[3].titleIds) === '["x"]');
ok('idempotente', planTitleSync({ rules: S1.rules, nowMs: now }).updated === 0);

console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
