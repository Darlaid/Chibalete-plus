/**
 * acceptanceDecisions.test.mjs — CHP-V8.1-CLOSE-05 (DIR-V81-01).
 *
 * Registro de decisiones (v2) y plan de activación, con datos sintéticos:
 *  [1] aceptación contractual (T) y autorización (A0/A1/A2) diferenciadas
 *  [2] representación del menor: lo declarado queda sin verificar
 *  [3] A1 Sí / No / pendiente
 *  [4] A2 Sí / No / pendiente / revocada; A2 no se infiere de A1 ni de C003
 *  [5] versiones, fecha del acto y evidencia (sin fechas futuras ni por defecto)
 *  [6] mediador (C005) e institución (C003)
 *  [7] nada premarcado: lo ausente falta, no se presume
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/acceptanceDecisions.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from '../privacy/a2Registry.mjs';
import { planActivationDecisions } from '../privacy/acceptance.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_accept_'));
const env = { CHP_A2_REGISTRY: path.join(tmp, 'decisions.jsonl') };
fs.writeFileSync(env.CHP_A2_REGISTRY, '');
const NOW = Date.parse('2026-11-09T15:00:00Z');
const TODAY = R.dayOf(NOW);
const ctx = { today: TODAY, ref: 'ACT-sintetico-1' };
const lector = (id, extra = {}) => ({ id, roles: ['lector'], accountStatus: 'invited', ...extra });
const adult = { terms: true, termsVersion: DOCS.terms.version, dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'titular', adultDeclared: true, A1: 'yes' };
const write = (plan) => R.appendDecisions(plan.decisions, { env, now: NOW });
const gate = () => R.decisionGate(env, NOW);

try {
    section('[1] aceptación y autorización diferenciadas');
    const p1 = planActivationDecisions(lector('b2c-1'), adult, ctx);
    ok('titular adulto B2C: T y A1, sin A2 (no aplica)', p1.ok && p1.decisions.map((d) => d.kind).join() === 'T,A1', JSON.stringify(p1));
    ok('T con 002@1.0 y A1 con 004@1.0, mismo acto y referencia', p1.decisions[0].version === '002@1.0' && p1.decisions[1].version === '004@1.0'
        && p1.decisions.every((d) => d.actDay === TODAY && d.requestRef === 'ACT-sintetico-1' && d.medium === 'in_app'));
    ok('titular: autenticado por su enlace y contraseña', p1.decisions.every((d) => d.capacity === 'titular' && d.verification === 'self_authenticated'));
    write(p1);
    ok('registro: T y A1 efectivas para b2c-1', gate().effective('T', 'b2c-1') && gate().effective('A1', 'b2c-1'));
    ok('sin términos no hay activación', planActivationDecisions(lector('x'), { ...adult, terms: undefined }, ctx).required?.includes('T'));
    ok('aceptar términos no autoriza datos: falta A1', planActivationDecisions(lector('x'), { ...adult, A1: undefined }, ctx).required?.includes('A1'));

    section('[2] representación del menor');
    const rep = { ...adult, actingAs: 'legal_representative', adultDeclared: undefined, A0: 'yes' };
    const p2 = planActivationDecisions(lector('menor-1', { organizationId: 'org-a' }), { ...rep, A2: 'yes' }, ctx);
    ok('representante: T, A0, A1 y A2, todo como representante sin verificar', p2.ok && p2.decisions.map((d) => d.kind).join() === 'T,A0,A1,A2'
        && p2.decisions.every((d) => d.capacity === 'legal_representative' && d.verification === 'unverified'), JSON.stringify(p2.decisions?.map((d) => d.verification)));
    write(p2);
    ok('lo declarado por el representante NO es efectivo hasta verificar (006 P03)', !gate().effective('A1', 'menor-1') && gate().status('A2', 'menor-1') === 'granted_unverified');
    ok('…y A2 no abre la consulta institucional', !R.a2Gate(env, NOW).allows('menor-1'));
    R.appendDecisions([{ subjectId: 'menor-1', kind: 'A2', status: 'granted', actDay: TODAY, version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-0001' },
        { subjectId: 'menor-1', kind: 'A1', status: 'granted', actDay: TODAY, version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-0001' }], { env, now: NOW });
    ok('GVA/VER verifica la ficha C.1 ⇒ A1 y A2 efectivas', gate().effective('A1', 'menor-1') && R.a2Gate(env, NOW).allows('menor-1'));
    ok('representante sin A0 ⇒ falta A0', planActivationDecisions(lector('x'), { ...rep, A0: undefined }, ctx).required?.includes('A0'));
    ok('representante con A0 = No ⇒ A0_DENIED', planActivationDecisions(lector('x'), { ...rep, A0: 'no' }, ctx).code === 'A0_DENIED');
    ok('titular sin declarar mayoría de edad ⇒ falta adultDeclared', planActivationDecisions(lector('x'), { ...adult, adultDeclared: undefined }, ctx).required?.includes('adultDeclared'));

    section('[3] A1 Sí / No / pendiente');
    ok('A1 = No ⇒ A1_DENIED: la cuenta no se activa (004 A1)', planActivationDecisions(lector('x'), { ...adult, A1: 'no' }, ctx).code === 'A1_DENIED');
    ok('A1 sin decidir ⇒ pendiente (no existe en el registro)', gate().status('A1', 'nunca-decidio') === 'pending');
    ok('una cuenta activa sin línea A1 no tiene A1 (no se infiere)', !gate().effective('A1', 'cuenta-activa-antigua'));
    ok('valores no admitidos para A1 cuentan como sin decidir', planActivationDecisions(lector('x'), { ...adult, A1: true }, ctx).required?.includes('A1'));

    section('[4] A2 Sí / No / pendiente / revocada');
    const inst = (id) => lector(id, { organizationId: 'org-a' });
    ok('lector institucional sin A2 ⇒ falta A2', planActivationDecisions(inst('i1'), adult, ctx).required?.includes('A2'));
    ok('lector institucional con «no aplica» ⇒ falta A2', planActivationDecisions(inst('i1'), { ...adult, A2: 'not_applicable' }, ctx).required?.includes('A2'));
    write(planActivationDecisions(inst('i-si'), { ...adult, A2: 'yes' }, ctx));
    write(planActivationDecisions(inst('i-no'), { ...adult, A2: 'no' }, ctx));
    ok('A2 = Sí (titular adulto) ⇒ efectiva', R.a2Gate(env, NOW).allows('i-si'));
    ok('A2 = No ⇒ denied, sin consulta', gate().status('A2', 'i-no') === 'denied' && !R.a2Gate(env, NOW).allows('i-no'));
    ok('A1 = Sí no implica A2: b2c-1 sin A2', gate().status('A2', 'b2c-1') === 'pending');
    R.appendDecisions([{ subjectId: 'i-si', kind: 'A2', status: 'revoked', actDay: TODAY, version: '004@1.0', medium: 'verifiable_message', capacity: 'titular', verification: 'verified', requestRef: 'SOL-0001' }], { env, now: NOW });
    ok('revocada ⇒ gana la última línea, sin consulta', gate().status('A2', 'i-si') === 'revoked' && !R.a2Gate(env, NOW).allows('i-si'));
    ok('A2 en una cuenta sin institución ⇒ A2_NOT_APPLICABLE', planActivationDecisions(lector('x'), { ...adult, A2: 'yes' }, ctx).code === 'A2_NOT_APPLICABLE');

    section('[5] versiones, fecha del acto y evidencia');
    ok('versión distinta de la vigente ⇒ VERSION_MISMATCH', planActivationDecisions(lector('x'), { ...adult, termsVersion: '002@0.9' }, ctx).code === 'VERSION_MISMATCH');
    const prior = { subjectId: 'antiguo-1', kind: 'A1', status: 'granted', version: '004@1.0', medium: 'paper', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-0002' };
    ok('evidencia previa sin fecha del acto ⇒ INVALID_ACT_DATE (no se fabrica)', codeOf(() => R.appendDecisions([{ ...prior }], { env, now: NOW })) === 'INVALID_ACT_DATE');
    ok('fecha del acto futura ⇒ INVALID_ACT_DATE', codeOf(() => R.appendDecisions([{ ...prior, actDay: '2026-11-10' }], { env, now: NOW })) === 'INVALID_ACT_DATE');
    const acks = R.appendDecisions([{ ...prior, actDay: '2026-03-02' }], { env, now: NOW });
    ok('evidencia previa válida: conserva su fecha de acto y se anota hoy', acks[0].actDay === '2026-03-02' && acks[0].day === TODAY);
    ok('autoverificación fuera de la plataforma ⇒ INVALID_VERIFICATION', codeOf(() => R.appendDecisions([{ ...prior, actDay: TODAY, verification: 'self_authenticated' }], { env, now: NOW })) === 'INVALID_VERIFICATION');
    ok('representante no puede autoverificarse', codeOf(() => R.appendDecisions([{ ...prior, actDay: TODAY, medium: 'in_app', verification: 'self_authenticated' }], { env, now: NOW })) === 'INVALID_VERIFICATION');
    ok('referencia con texto libre ⇒ INVALID_REQUEST_REF', codeOf(() => R.appendDecisions([{ ...prior, actDay: TODAY, requestRef: 'Ana Pérez 5B' }], { env, now: NOW })) === 'INVALID_REQUEST_REF');
    const before = fs.readFileSync(env.CHP_A2_REGISTRY, 'utf8');
    ok('lote con una línea inválida ⇒ no se escribe ninguna', codeOf(() => R.appendDecisions([{ ...prior, actDay: TODAY }, { ...prior, kind: 'XX', actDay: TODAY }], { env, now: NOW })) === 'INVALID_KIND'
        && fs.readFileSync(env.CHP_A2_REGISTRY, 'utf8') === before);
    ok('el registro no guarda ids en claro', !/"(b2c-1|menor-1|i-si|antiguo-1)"/.test(before));
    fs.writeFileSync(env.CHP_A2_REGISTRY, before.replace('"k":"A1"', '"k":"A2"'));
    ok('una línea alterada (tipo cambiado) ⇒ registro no disponible', codeOf(() => R.decisionGate(env, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(env.CHP_A2_REGISTRY, before);

    section('[6] mediador e institución');
    const med = { id: 'med-1', roles: ['mediador'], organizationId: 'org-a', accountStatus: 'invited' };
    ok('mediador sin compromiso 005 ⇒ falta C005', planActivationDecisions(med, { terms: true, termsVersion: DOCS.terms.version, adultDeclared: true }, ctx).required?.includes('C005'));
    const pm = planActivationDecisions(med, { terms: true, termsVersion: DOCS.terms.version, adultDeclared: true, mediatorCommitment: true, mediatorVersion: DOCS.mediator.version }, ctx);
    ok('mediador: T y C005 (005@1.0), sin A1/A2 de lector', pm.ok && pm.decisions.map((d) => d.kind).join() === 'T,C005' && pm.decisions[1].version === '005@1.0' && pm.decisions[1].capacity === 'mediator');
    write(pm);
    ok('C005 efectiva para el mediador', gate().effective('C005', 'med-1'));
    R.appendDecisions([{ subjectId: 'org-a', kind: 'C003', status: 'granted', actDay: '2026-10-01', version: '003@1.0', medium: 'electronic_signature', capacity: 'institution', verification: 'verified', requestRef: 'CONV-0001' }], { env, now: NOW });
    ok('C003 de la institución registrado', gate().effective('C003', 'org-a'));
    ok('el C003 no da A1 ni A2 a sus lectores', !gate().effective('A1', 'i1') && !R.a2Gate(env, NOW).allows('i1'));
    ok('C003 solo con calidad «institución»', codeOf(() => R.appendDecisions([{ subjectId: 'org-b', kind: 'C003', status: 'granted', actDay: TODAY, version: '003@1.0', medium: 'paper', capacity: 'titular', verification: 'verified', requestRef: 'CONV-2' }], { env, now: NOW })) === 'INVALID_CAPACITY');

    section('[7] nada premarcado');
    const none = planActivationDecisions(lector('x', { organizationId: 'org-a' }), undefined, ctx);
    ok('sin cuerpo de decisiones ⇒ todo falta', none.code === 'DECISIONS_REQUIRED' && ['T', 'actingAs', 'A1', 'A2'].every((k) => none.required.includes(k)), JSON.stringify(none));
    ok('valores «verdaderos» que no son true no cuentan', planActivationDecisions(lector('x'), { ...adult, terms: 'true' }, ctx).required?.includes('T'));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\nacceptance decisions (V8.1-CLOSE-05): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
