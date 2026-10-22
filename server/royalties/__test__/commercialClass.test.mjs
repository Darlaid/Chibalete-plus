/**
 * commercialClass.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-B.
 *
 * Módulo puro de clasificación comercial (P9):
 *   [1] taxonomía congelada y `unclassified` por defecto
 *   [2] validación estricta de la clasificación
 *   [3] historial sin retroactividad
 *   [4] predicado económico por clase y vigencia
 *   [5] POST /api/access: arrastre y rechazo de campos comerciales
 *   [6] exclusión de cuentas (admin, sintéticas, internas; mediadores no)
 *   [7] atribución determinista con reglas simultáneas
 *   [8] los escritores B2C existentes conservan la clase; las reglas nuevas nacen sin clase
 *
 *   node server/royalties/__test__/commercialClass.test.mjs
 */
import * as C from '../commercialClass.mjs';
import { planRevoke, planTitleSync, planRulePhase, B2C_TEMPLATE_RULE_ID } from '../../b2c/b2cProvisioning.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const rule = (id, extra = {}) => ({ id, scope: 'user', scopeId: 'u1', titleIds: ['c1'], collectionIds: [], expiresAt: null, ...extra });
const classify = (r, cls, nowMs, evidenceRef = 'EV-1') => C.applyClassification(r, { commercialClass: cls, evidenceRef }, { actor: 'ADM', nowMs }).rule;

section('[1] taxonomía y valor por defecto');
ok('taxonomía P9 exacta', JSON.stringify(C.COMMERCIAL_CLASSES) === JSON.stringify(['paid_b2c', 'paid_institutional', 'pilot', 'courtesy', 'promo_authorized', 'internal', 'template', 'unclassified']));
ok('solo las dos clases pagadas son económicas', JSON.stringify(C.ECONOMIC_COMMERCIAL_CLASSES) === JSON.stringify(['paid_b2c', 'paid_institutional']));
ok('regla antigua sin campos → unclassified', C.commercialClassAt(rule('r')) === 'unclassified');
ok('campo suelto sin historial no basta → unclassified', C.commercialClassAt(rule('r', { commercialClass: 'paid_b2c' })) === 'unclassified');
ok('historial con clase inválida se ignora', C.commercialClassAt(rule('r', { commercialClassHistory: [{ commercialClass: 'gratis', since: 1 }] })) === 'unclassified');

section('[2] validación');
ok('clase desconocida → rechazada', throwsCode(() => C.validateClassificationInput({ commercialClass: 'paid', evidenceRef: 'x' }), 'invalid_commercial_class'));
ok('sin soporte → rechazada', throwsCode(() => C.validateClassificationInput({ commercialClass: 'pilot' }), 'evidence_required'));
ok('soporte vacío → rechazado', throwsCode(() => C.validateClassificationInput({ commercialClass: 'pilot', evidenceRef: '  ' }), 'evidence_required'));
ok('fecha retroactiva del cliente → campo no admitido', throwsCode(() => C.validateClassificationInput({ commercialClass: 'pilot', evidenceRef: 'x', since: 1 }), 'unknown_field'));
ok('regla inexistente → 404', throwsCode(() => C.applyClassification(null, { commercialClass: 'pilot', evidenceRef: 'x' }, { actor: 'A' }), 'rule_not_found'));

section('[3] historial sin retroactividad');
const r0 = rule('r1');
const r1 = classify(r0, 'pilot', T0);
const r2 = classify(r1, 'paid_b2c', T0 + 1000);
ok('el original no se muta', !('commercialClassHistory' in r0));
ok('historial con dos entradas y autoría', r2.commercialClassHistory.length === 2 && r2.commercialClassHistory.every((h) => h.by === 'ADM' && h.evidenceRef === 'EV-1'));
ok('antes de clasificar → unclassified', C.commercialClassAt(r2, T0 - 1) === 'unclassified');
ok('entre ambos cambios → pilot', C.commercialClassAt(r2, T0 + 500) === 'pilot');
ok('después → paid_b2c', C.commercialClassAt(r2, T0 + 1000) === 'paid_b2c');
ok('reclasificar hoy no vuelve pagado el pasado', !C.ruleSupportsEconomicAttribution(r2, T0 + 500) && C.ruleSupportsEconomicAttribution(r2, T0 + 2000));
const same = C.applyClassification(r2, { commercialClass: 'paid_b2c', evidenceRef: 'EV-2' }, { actor: 'ADM', nowMs: T0 + 3000 });
ok('misma clase → sin cambio ni entrada nueva', same.changed === false && same.rule === r2);
const clash = classify(r2, 'courtesy', T0 + 1000);
ok('dos cambios en el mismo ms quedan ordenados', clash.commercialClassHistory.at(-1).since === T0 + 1001 && C.commercialClassAt(clash, T0 + 1001) === 'courtesy');
ok('campo de conveniencia sincronizado', r2.commercialClass === 'paid_b2c' && r2.commercialClassSince === T0 + 1000);

section('[4] predicado económico');
for (const cls of C.COMMERCIAL_CLASSES) {
    const r = classify(rule(`r-${cls}`), cls, T0);
    const expected = cls === 'paid_b2c' || cls === 'paid_institutional';
    ok(`${cls} → ${expected ? 'elegible' : 'no elegible'}`, C.ruleSupportsEconomicAttribution(r, T0 + 1) === expected);
}
const paid = classify(rule('rp'), 'paid_institutional', T0);
ok('regla caducada no respalda', !C.ruleSupportsEconomicAttribution({ ...paid, expiresAt: T0 + 10 }, T0 + 11));
ok('regla B2C revocada no respalda', !C.ruleSupportsEconomicAttribution({ ...paid, b2c: { revokedAt: T0 + 10 } }, T0 + 10));
ok('regla sin clasificar no respalda', !C.ruleSupportsEconomicAttribution(rule('ru'), T0));

section('[5] POST /api/access');
ok('cuerpo con commercialClass → rechazado', throwsCode(() => C.assertNoCommercialFieldsInPayload({ scope: 'user', commercialClass: 'paid_b2c' }), 'commercial_class_readonly'));
ok('cuerpo con historial → rechazado', throwsCode(() => C.assertNoCommercialFieldsInPayload({ commercialClassHistory: [] }), 'commercial_class_readonly'));
ok('cuerpo normal → aceptado', (() => { C.assertNoCommercialFieldsInPayload({ scope: 'user', titleIds: [] }); return true; })());
const rebuilt = C.carryCommercialFields({ id: 'r1', scope: 'user', scopeId: 'u1', titleIds: ['c9'], collectionIds: [], expiresAt: null }, r2);
ok('la actualización arrastra clase e historial', rebuilt.titleIds[0] === 'c9' && JSON.stringify(rebuilt.commercialClassHistory) === JSON.stringify(r2.commercialClassHistory) && rebuilt.commercialClass === 'paid_b2c');
ok('regla nueva sin guardada → sin campos comerciales', !('commercialClass' in C.carryCommercialFields({ id: 'n' }, null)));

section('[6] exclusión de cuentas');
ok('administrador excluido', C.isEconomicallyExcludedUser({ id: 'a', roles: ['administrador'] }));
ok('rol legacy rol=administrador excluido', C.isEconomicallyExcludedUser({ id: 'a', rol: 'administrador' }));
ok('cuenta sintética excluida', C.isEconomicallyExcludedUser({ id: 's', roles: ['lector'], _loadtest_marker: 'lt' }));
ok('cuenta interna de la lista excluida', C.isEconomicallyExcludedUser({ id: 'qa', roles: ['lector'] }, { internalUserIds: ['qa'] }));
ok('mediador NO excluido por rol (P7)', !C.isEconomicallyExcludedUser({ id: 'm', roles: ['mediador'] }));
ok('lector no excluido', !C.isEconomicallyExcludedUser({ id: 'l', roles: ['lector'] }));
ok('usuario desconocido excluido', C.isEconomicallyExcludedUser(null));

section('[7] atribución determinista');
const content = { id: 'c1', parentId: null };
const lec = { id: 'u1', roles: ['lector'] };
const g = (id, cls, extra = {}) => classify({ id, scope: 'group', scopeId: 'g1', titleIds: ['c1'], collectionIds: [], expiresAt: null, ...extra }, cls, T0);
const u = (id, cls, extra = {}) => classify({ id, scope: 'user', scopeId: 'u1', titleIds: ['c1'], collectionIds: [], expiresAt: null, ...extra }, cls, T0);
const o = (id, cls) => classify({ id, scope: 'organization', scopeId: 'org1', titleIds: ['c1'], collectionIds: [], expiresAt: null }, cls, T0);
const at = T0 + 1;
let rs = [u('r-user-pilot', 'pilot'), g('r-group-paid', 'paid_institutional')];
let a = C.resolveCommercialAttribution({ rules: rs, appliedRuleIds: rs.map((r) => r.id), content, user: lec, at });
ok('regla pagada gana a piloto de mayor precedencia (P8)', a.ruleId === 'r-group-paid' && a.eligible && a.reason === 'ELIGIBLE');
ok('una sola atribución, candidatos listados', a.candidateRuleIds.length === 2 && typeof a.ruleId === 'string');
rs = [o('r-org-paid', 'paid_institutional'), g('r-group-paid', 'paid_institutional'), u('r-user-paid', 'paid_b2c')];
a = C.resolveCommercialAttribution({ rules: rs, appliedRuleIds: rs.map((r) => r.id), content, user: lec, at });
ok('entre pagadas: user > group > organization', a.ruleId === 'r-user-paid');
rs = [g('r-b', 'paid_institutional'), g('r-a', 'paid_institutional')];
const runs = new Set([0, 1, 2, 3].map((i) => C.resolveCommercialAttribution({ rules: i % 2 ? rs : [...rs].reverse(), appliedRuleIds: ['r-a', 'r-b'], content, user: lec, at }).ruleId));
ok('empate: desempate por id, independiente del orden', runs.size === 1 && runs.has('r-a'));
rs = [u('r-unc', 'unclassified')];
a = C.resolveCommercialAttribution({ rules: rs, appliedRuleIds: ['r-unc'], content, user: lec, at });
ok('regla sin clasificar: atribuida pero no elegible', a.ruleId === 'r-unc' && !a.eligible && a.reason === 'CLASS_UNCLASSIFIED');
a = C.resolveCommercialAttribution({ rules: [u('r-pilot', 'pilot')], appliedRuleIds: ['r-pilot'], content, user: lec, at });
ok('piloto: no elegible', !a.eligible && a.reason === 'CLASS_PILOT');
a = C.resolveCommercialAttribution({ rules: [u('r-paid', 'paid_b2c')], appliedRuleIds: ['r-paid'], content, user: { id: 'adm', roles: ['administrador'] }, at });
ok('administrador con regla pagada: excluido', !a.eligible && a.reason === 'USER_EXCLUDED' && a.ruleId === 'r-paid');
a = C.resolveCommercialAttribution({ rules: [u('r-paid', 'paid_b2c')], appliedRuleIds: [], content, user: lec, at });
ok('regla que el motor no aplicó → no cuenta', a.ruleId === null && a.reason === 'NO_COVERING_RULE');
a = C.resolveCommercialAttribution({ rules: [u('r-paid', 'paid_b2c', { titleIds: ['c2'] })], appliedRuleIds: ['r-paid'], content, user: lec, at });
ok('regla que no cubre la obra → no cuenta', a.ruleId === null);
a = C.resolveCommercialAttribution({ rules: [u('r-col', 'paid_b2c', { titleIds: [], collectionIds: ['col1'] })], appliedRuleIds: ['r-col'], content: { id: 'c5', parentId: 'col1' }, user: lec, at });
ok('cobertura por colección', a.ruleId === 'r-col' && a.eligible);
a = C.resolveCommercialAttribution({ rules: [u('r-exp', 'paid_b2c', { expiresAt: T0 })], appliedRuleIds: ['r-exp'], content, user: lec, at });
ok('regla caducada no se atribuye', a.ruleId === null);
a = C.resolveCommercialAttribution({ rules: [u('r-late', 'paid_b2c')], appliedRuleIds: ['r-late'], content, user: lec, at: T0 - 1 });
ok('clase pagada posterior al instante → no elegible', a.ruleId === 'r-late' && a.reason === 'CLASS_UNCLASSIFIED');

section('[8] escritores B2C existentes');
const key = 'production:order:7';
const template = { id: B2C_TEMPLATE_RULE_ID, scope: 'group', scopeId: 'g-b2c', titleIds: ['c1', 'c2'], collectionIds: [], expiresAt: null };
const b2cRule = classify({ id: 'access-b2c-production-order-7', scope: 'user', scopeId: 'u7', titleIds: ['c1'], collectionIds: [], expiresAt: T0 + 1e9, b2c: { orderId: 7, idempotencyKey: key } }, 'paid_b2c', T0);
const rev = planRevoke({ rules: [b2cRule], input: { orderId: 7, source: 'production', idempotencyKey: key, reason: 'refunded' }, nowMs: T0 + 50 });
ok('revocar conserva clase e historial', rev.rule.commercialClass === 'paid_b2c' && rev.rule.commercialClassHistory.length === 1);
ok('tras revocar no respalda; antes sí (sin retroactividad)', !C.ruleSupportsEconomicAttribution(rev.rule, T0 + 60) && C.ruleSupportsEconomicAttribution(rev.rule, T0 + 10));
const sync = planTitleSync({ rules: [classify(template, 'template', T0), b2cRule], nowMs: T0 + 1 });
ok('sincronizar títulos conserva la clase', sync.rules[1].commercialClass === 'paid_b2c' && sync.rules[1].titleIds.length === 2);
const created = planRulePhase({ rules: [classify(template, 'template', T0)], input: { source: 'production', orderId: 8, productId: 1, plan: 'digital', idempotencyKey: 'production:order:8', activationAt: T0 }, userId: 'u8', nowMs: T0 });
ok('regla B2C nueva nace sin clase (no hereda «template»)', created.ruleOp === 'create' && !('commercialClass' in created.rule) && C.commercialClassAt(created.rule, T0) === 'unclassified');

console.log(`\ncommercialClass — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
