/**
 * pilotLegacy.test.mjs — CHP V9R-DEP1. Condición PILOT_LEGACY y constancia P en el registro de decisiones.
 *
 * Con datos sintéticos, sin servidor:
 *  [1] la condición no rige sin sello; con sello rige por PERTENENCIA (grupo + cuenta) y por función
 *  [2] régimen cerrado: tras el sello no se concede ni se lee nada nuevo (ni otro sello)
 *  [3] nunca es un consentimiento: forma propia, y ninguna decisión de consentimiento se satisface con ella
 *  [4] pareja mediador–lector: mismo grupo, pertenencias vigentes HOY; negativa o revocación expresa prevalece
 *  [5] revocación de una pertenencia, vigencia y fin del régimen (sello revocado)
 *  [6] constancia P (Política 001): propia, con instante, sin efecto sobre otras decisiones
 *  [7] líneas anteriores (sin instante) siguen verificando; el instante no se puede añadir ni quitar
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/pilotLegacy.test.mjs
 */
import './helpers/testMode.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from '../privacy/a2Registry.mjs';
import { adminActivationAllowed, optionalProcessingFor, planActivationDecisions, policyOnFile } from '../privacy/acceptance.mjs';
import { getSubjectKey } from '../gamification/subjectKey.mjs';
import { pilotLine } from './helpers/testA2.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_pilot_'));
const newEnv = (name) => { const p = path.join(tmp, `${name}.jsonl`); fs.writeFileSync(p, ''); return { CHP_A2_REGISTRY: p, GAMIFICATION_EXCLUSION_REGISTRY: path.join(tmp, 'excl.jsonl') }; };
const NOW = Date.parse('2026-11-25T15:00:00Z'), DAY = 86_400_000, TODAY = R.dayOf(NOW);
const add = (env, lines, now = NOW) => R.appendDecisions(lines, { env, now });
const gate = (env, now = NOW) => R.decisionGate(env, now);
const member = (groupId, userId, capacity, extra = {}) => pilotLine({ groupId, userId, capacity, ...extra });
const SEAL = pilotLine({ seal: true });
const decision = (subjectId, kind, status, extra = {}) => ({ subjectId, kind, status, actDay: TODAY, version: kind === 'C005' ? '005@1.0' : '004@1.0', medium: 'paper',
    capacity: kind === 'C005' ? 'mediator' : 'legal_representative', verification: 'verified', requestRef: `SINT-${kind}-${subjectId}`, ...extra });

// Grupos de HOY (lo que en el servidor aporta el CIS): med-1 media g-1 y g-2; med-2 media g-3.
let TODAY_GROUPS = {
    'med-1': [{ groupId: 'g-1', memberIds: ['r-1', 'r-2', 'r-3', 'r-new'] }, { groupId: 'g-2', memberIds: ['r-9'] }],
    'med-2': [{ groupId: 'g-3', memberIds: ['r-7'] }],
    'med-new': [{ groupId: 'g-1', memberIds: ['r-1', 'r-2', 'r-3', 'r-new'] }],
};
R.setPilotScopeResolver((id) => TODAY_GROUPS[id] ?? []);
const PILOT = [member('g-1', 'med-1', 'pilot_mediator'), member('g-1', 'r-1', 'pilot_reader_followup'), member('g-1', 'r-2', 'pilot_reader_followup'),
    member('g-1', 'r-3', 'pilot_reader'), member('g-3', 'med-2', 'pilot_mediator'), member('g-3', 'r-7', 'pilot_reader_followup')];

try {
    section('[1] sin sello no rige; con sello, por pertenencia y por función');
    const env = newEnv('main');
    add(env, PILOT);
    ok('cargada pero sin sello ⇒ no rige para nadie', !gate(env).pilot('mediator', 'g-1', 'med-1') && !R.a2Gate(env, NOW, { mediatorId: 'med-1' }).allows('r-1'));
    add(env, [SEAL]);
    const g = gate(env);
    ok('mediador del corte en SU grupo', g.pilot('mediator', 'g-1', 'med-1') && R.pilotMediatorOf(g, 'g-1', 'med-1'));
    ok('…y en ningún otro grupo, aunque hoy lo medie (g-2 no es del corte)', !g.pilot('mediator', 'g-2', 'med-1') && !g.pilot('mediator', 'g-3', 'med-1'));
    ok('una línea de lector no vale como línea de mediador, ni al revés', !g.pilot('mediator', 'g-1', 'r-1') && !g.pilot('reader', 'g-1', 'med-1') && !g.pilot('followup', 'g-1', 'med-1'));
    ok('lector solo de nómina: figura, sin seguimiento', g.pilot('reader', 'g-1', 'r-3') && !g.pilot('followup', 'g-1', 'r-3'));
    ok('lector con seguimiento: figura y tiene seguimiento', g.pilot('reader', 'g-1', 'r-1') && g.pilot('followup', 'g-1', 'r-1'));
    const rosters = R.pilotRosters(g, 'med-1');
    ok('nómina de piloto: solo g-1 y solo los tres lectores del corte (no el nuevo, no g-2)', [...rosters.keys()].join() === 'g-1' && [...rosters.get('g-1')].sort().join() === 'r-1,r-2,r-3', JSON.stringify([...rosters]));
    ok('una cuenta sin línea no obtiene nada, aunque medie hoy el mismo grupo', R.pilotRosters(g, 'med-new').size === 0 && !R.pilotMediatorOf(g, 'g-1', 'med-new'));
    ok('ids vacíos o no texto ⇒ no', !g.pilot('mediator', '', 'med-1') && !g.pilot('mediator', 'g-1', undefined) && !g.pilot('otra', 'g-1', 'med-1'));

    section('[2] régimen cerrado');
    ok('tras el sello no se admite una pertenencia nueva', codeOf(() => add(env, [member('g-1', 'r-new', 'pilot_reader_followup')])) === 'PILOT_LEGACY_SEALED');
    ok('…ni un mediador nuevo, ni otro sello', codeOf(() => add(env, [member('g-1', 'med-new', 'pilot_mediator')])) === 'PILOT_LEGACY_SEALED' && codeOf(() => add(env, [SEAL])) === 'PILOT_LEGACY_SEALED');
    ok('en un lote, nada después del sello', codeOf(() => add(newEnv('batch'), [member('g-1', 'med-1', 'pilot_mediator'), SEAL, member('g-1', 'r-1', 'pilot_reader')])) === 'PILOT_LEGACY_SEALED');
    {
        // Una línea de concesión escrita a mano DESPUÉS del sello, con MAC válido (alguien con la clave): no se lee.
        const forged = newEnv('forged');
        add(forged, [member('g-1', 'med-1', 'pilot_mediator'), SEAL]);
        const tail = newEnv('tail');
        add(tail, [member('g-1', 'r-new', 'pilot_reader_followup'), member('g-9', 'med-1', 'pilot_mediator')]);
        fs.appendFileSync(forged.CHP_A2_REGISTRY, fs.readFileSync(tail.CHP_A2_REGISTRY, 'utf8'));
        const fg = gate(forged);
        ok('una concesión añadida tras el sello no rige (y el registro sigue verificable)', !fg.pilot('reader', 'g-1', 'r-new') && !fg.pilot('mediator', 'g-9', 'med-1') && fg.pilot('mediator', 'g-1', 'med-1'));
    }

    section('[3] nunca es un consentimiento');
    ok('effective() no la toma por decisión: ni PILOT_LEGACY ni A1/A2/A3/A5/C005/T/P', ['PILOT_LEGACY', 'A1', 'A2', 'A3', 'A5', 'T', 'P'].every((k) => !g.effective(k, 'r-1'))
        && !g.effective('C005', 'med-1') && !g.effective('PILOT_LEGACY', R.pilotSubject('g-1', 'r-1')) && !g.effective('PILOT_LEGACY', R.PILOT_SEAL_SUBJECT));
    ok('estado de A2 y C005 de las cuentas de piloto: pendiente (no se anotó nada)', g.status('A2', 'r-1') === 'pending' && g.status('C005', 'med-1') === 'pending' && g.status('A1', 'r-1') === 'pending');
    ok('Leo y voz siguen cerrados para el lector de piloto', JSON.stringify(optionalProcessingFor({ id: 'r-1', roles: ['lector'] }, g)) === '{"leo":false,"voiceTranscription":false}');
    ok('XP: A1 no se da por tenida', !R.a1Gate(env, NOW).allowsAt('r-1', NOW));
    ok('alta administrativa: la condición de piloto no activa una cuenta', !adminActivationAllowed({ id: 'r-1', roles: ['lector'] }, g) && !adminActivationAllowed({ id: 'med-1', roles: ['mediador'] }, g));
    const e3 = newEnv('shape');
    const bad = (over) => codeOf(() => add(e3, [{ ...member('g-1', 'r-1', 'pilot_reader'), ...over }]));
    ok('no admite «denied», ni verificación de consentimiento, ni calidad de titular o representante', bad({ status: 'denied' }) === 'INVALID_STATUS'
        && bad({ verification: 'verified' }) === 'INVALID_VERIFICATION' && bad({ verification: 'self_authenticated', medium: 'in_app' }) === 'INVALID_MEDIUM'
        && bad({ capacity: 'legal_representative' }) === 'INVALID_CAPACITY' && bad({ capacity: 'titular' }) === 'INVALID_CAPACITY' && bad({ capacity: 'mediator' }) === 'INVALID_CAPACITY');
    ok('no admite versión de documento ni otro medio', bad({ version: '004@1.0' }) === 'INVALID_VERSION' && bad({ medium: 'paper' }) === 'INVALID_MEDIUM');
    ok('el sujeto es una pertenencia, nunca una cuenta; y el sello solo con su sujeto', bad({ subjectId: 'r-1' }) === 'INVALID_USER' && bad({ capacity: 'pilot_seal' }) === 'INVALID_USER'
        && bad({ subjectId: R.PILOT_SEAL_SUBJECT }) === 'INVALID_USER');
    ok('ningún otro tipo puede usar la forma de piloto', codeOf(() => add(e3, [decision('r-1', 'A2', 'granted', { verification: 'inventory' })])) === 'INVALID_VERIFICATION'
        && codeOf(() => add(e3, [decision('r-1', 'A2', 'granted', { capacity: 'pilot_reader_followup' })])) === 'INVALID_CAPACITY'
        && codeOf(() => add(e3, [decision(R.pilotSubject('g-1', 'r-1'), 'A2', 'granted', { requestRef: 'SINT-A2-SUJETO' })])) === 'INVALID_USER'
        && codeOf(() => add(e3, [decision('r-1', 'A2', 'granted', { version: R.PILOT_VERSION })])) === 'INVALID_VERSION');
    ok('nada de lo anterior escribió', fs.readFileSync(e3.CHP_A2_REGISTRY, 'utf8') === '');
    ok('el registro no guarda grupos ni cuentas en claro', !/g-1|r-1|med-1/.test(fs.readFileSync(env.CHP_A2_REGISTRY, 'utf8')));

    section('[4] pareja mediador–lector');
    const a2 = (mediatorId, e = env, now = NOW) => R.a2Gate(e, now, { mediatorId });
    ok('mediador y lector del mismo grupo del corte, lector con seguimiento ⇒ sí', a2('med-1').allows('r-1') && a2('med-1').allows('r-2'));
    ok('lector solo de nómina ⇒ sin seguimiento individual', !a2('med-1').allows('r-3'));
    ok('lector nuevo del mismo curso ⇒ no', !a2('med-1').allows('r-new'));
    ok('lector de otro grupo que también media hoy (no es del corte) ⇒ no', !a2('med-1').allows('r-9'));
    ok('lector de piloto de OTRO mediador ⇒ no (cada cual en su ámbito)', !a2('med-1').allows('r-7') && !a2('med-2').allows('r-1') && a2('med-2').allows('r-7'));
    ok('mediador nuevo del mismo curso ⇒ no', !a2('med-new').allows('r-1'));
    ok('sin mediador (otra vía de consulta) la condición de piloto no cuenta', !R.a2Gate(env, NOW).allows('r-1'));
    {
        const d = R.individualDisclosure(['r-1', 'r-2', 'r-3', 'r-new'], { env, now: NOW, mediatorId: 'med-1' });
        ok('criterio único de divulgación: solo los dos con seguimiento', d.status === 'partial' && [...d.allowed].sort().join() === 'r-1,r-2', JSON.stringify([...d.allowed]));
    }
    // Traslado: r-2 deja g-1 y pasa a g-2 (que med-1 también media). Su pertenencia del corte ya no existe hoy.
    const keep = TODAY_GROUPS;
    TODAY_GROUPS = { ...keep, 'med-1': [{ groupId: 'g-1', memberIds: ['r-1', 'r-3'] }, { groupId: 'g-2', memberIds: ['r-9', 'r-2'] }] };
    ok('traslado: el lector trasladado deja de tener seguimiento por piloto, también en su curso nuevo', !a2('med-1').allows('r-2') && a2('med-1').allows('r-1')
        && !R.pilotRosters(gate(env), 'med-1').get('g-1').has('r-2'));
    // El mediador deja de mediar el grupo: nada.
    TODAY_GROUPS = { ...keep, 'med-1': [{ groupId: 'g-2', memberIds: ['r-9'] }] };
    ok('mediador retirado del curso: sin nómina ni seguimiento por piloto', !a2('med-1').allows('r-1') && R.pilotRosters(gate(env), 'med-1').size === 0);
    TODAY_GROUPS = keep;
    ok('sin fuente de grupos de hoy, o si falla ⇒ nada', (() => { R.setPilotScopeResolver(() => { throw new Error('x'); }); const a = !a2('med-1').allows('r-1'); R.setPilotScopeResolver(null); const b = !a2('med-1').allows('r-1');
        R.setPilotScopeResolver((id) => TODAY_GROUPS[id] ?? []); return a && b && a2('med-1').allows('r-1'); })());
    // Negativa expresa: prevalece sobre la condición de piloto.
    add(env, [decision('r-2', 'A2', 'denied')]);
    ok('A2 = No del lector prevalece sobre la condición de piloto', !a2('med-1').allows('r-2') && a2('med-1').allows('r-1'));
    add(env, [decision('r-2', 'A2', 'granted')]);
    ok('A2 real sin C005 del mediador: rige la condición de piloto de la pareja (no hay negativa)', a2('med-1').allows('r-2'));
    add(env, [decision('med-2', 'C005', 'revoked')]);
    ok('C005 revocado del mediador prevalece: sin nómina ni seguimiento, y el otro mediador no cambia', !a2('med-2').allows('r-7') && R.pilotRosters(gate(env), 'med-2').size === 0
        && !R.pilotMediatorOf(gate(env), 'g-3', 'med-2') && a2('med-1').allows('r-1'));
    // Regularización real: C005 + A2 abren lo que la condición de piloto no (lector nuevo).
    add(env, [decision('med-1', 'C005', 'granted'), decision('r-new', 'A2', 'granted')]);
    ok('con C005 y A2 reales, el lector nuevo sí (vía ordinaria, no piloto)', a2('med-1').allows('r-new') && !gate(env).pilot('reader', 'g-1', 'r-new'));

    section('[5] revocación, vigencia y fin del régimen');
    const e5 = newEnv('life');
    add(e5, [member('g-1', 'med-1', 'pilot_mediator'), member('g-1', 'r-1', 'pilot_reader_followup', { validUntil: R.dayOf(NOW + 10 * DAY) }), member('g-1', 'r-2', 'pilot_reader_followup'),
        pilotLine({ seal: true, validUntil: R.dayOf(NOW + 30 * DAY) })]);
    ok('vigente hoy', a2('med-1', e5).allows('r-1') && a2('med-1', e5).allows('r-2'));
    ok('la pertenencia con vigencia caduca sola; la otra sigue', !a2('med-1', e5, NOW + 11 * DAY).allows('r-1') && a2('med-1', e5, NOW + 11 * DAY).allows('r-2'));
    ok('vencido el sello, el régimen entero deja de regir', !a2('med-1', e5, NOW + 31 * DAY).allows('r-2') && !gate(e5, NOW + 31 * DAY).pilot('mediator', 'g-1', 'med-1'));
    add(e5, [member('g-1', 'r-2', 'pilot_reader_followup', { status: 'revoked', ref: 'SOL-SINT-1' })]);
    ok('revocar una pertenencia la cierra de inmediato', !a2('med-1', e5).allows('r-2') && a2('med-1', e5).allows('r-1'));
    ok('…y no se puede volver a conceder', codeOf(() => add(e5, [member('g-1', 'r-2', 'pilot_reader_followup')])) === 'PILOT_LEGACY_SEALED');
    add(e5, [pilotLine({ seal: true, status: 'revoked', ref: 'DIR-SINT-FIN' })]);
    ok('sello revocado: fin del régimen para todos', !a2('med-1', e5).allows('r-1') && !gate(e5).pilot('mediator', 'g-1', 'med-1') && R.pilotRosters(gate(e5), 'med-1').size === 0);
    ok('…sin reapertura posible', codeOf(() => add(e5, [SEAL])) === 'PILOT_LEGACY_SEALED' && codeOf(() => add(e5, [member('g-1', 'r-5', 'pilot_reader')])) === 'PILOT_LEGACY_SEALED');

    section('[6] constancia P (Política 001)');
    const e6 = newEnv('policy');
    const ctx = { today: TODAY, ref: 'ACT-sint-p' };
    const adult = { terms: true, termsVersion: '002@1.0', policy: true, policyVersion: '001@1.0', dataNoticeVersion: '004@1.0', actingAs: 'titular', adultDeclared: true, A1: 'yes' };
    const reader = (id, extra = {}) => ({ id, roles: ['lector'], accountStatus: 'invited', ...extra });
    ok('sin aceptar la Política ⇒ falta P (no la aportan términos ni A1)', planActivationDecisions(reader('n-1'), { ...adult, policy: undefined }, ctx).required?.join() === 'P');
    ok('valor que no es true ⇒ falta P (nada premarcado)', planActivationDecisions(reader('n-1'), { ...adult, policy: 'true' }, ctx).required?.includes('P'));
    ok('otra versión de la Política ⇒ VERSION_MISMATCH sobre P', (() => { const p = planActivationDecisions(reader('n-1'), { ...adult, policyVersion: '001@0.9' }, ctx); return p.code === 'VERSION_MISMATCH' && p.required.join() === 'P'; })());
    const p1 = planActivationDecisions(reader('n-1'), adult, ctx);
    const pol = p1.decisions?.find((d) => d.kind === 'P');
    ok('adulto: T, A1 y P, cada una con su documento', p1.ok && p1.decisions.map((d) => `${d.kind}:${d.version}`).join() === 'T:002@1.0,A1:004@1.0,P:001@1.0', JSON.stringify(p1.decisions));
    ok('P: la cuenta, quien declara (titular autenticado), el acto y su referencia', pol.subjectId === 'n-1' && pol.capacity === 'titular' && pol.verification === 'self_authenticated' && pol.medium === 'in_app'
        && pol.actDay === TODAY && pol.requestRef === 'ACT-sint-p');
    const acks = add(e6, p1.decisions);
    const lineP = fs.readFileSync(e6.CHP_A2_REGISTRY, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.k === 'P');
    ok('en el registro: tipo, documento y versión, día e INSTANTE del servidor, sin el id en claro', lineP.v === '001@1.0' && lineP.d === TODAY && lineP.t === new Date(NOW).toISOString() && lineP.a === 'granted'
        && lineP.q === 'titular' && lineP.x === 'self_authenticated' && lineP.r === 'ACT-sint-p' && !JSON.stringify(lineP).includes('n-1') && acks.length === 3);
    ok('P efectiva y en su versión', gate(e6).effective('P', 'n-1') && policyOnFile(gate(e6), 'n-1'));
    ok('P no autoriza ningún tratamiento: A2, A3, A5 y C005 siguen pendientes', ['A2', 'A3', 'A5', 'C005'].every((k) => gate(e6).status(k, 'n-1') === 'pending'));
    const rep = { ...adult, actingAs: 'legal_representative', adultDeclared: undefined, A0: 'yes' };
    const p2 = planActivationDecisions(reader('menor-1', { loginId: 'lector.menor', representedBy: { email: 'adulto@fixture.invalid' } }), rep, ctx);
    ok('menor representado: T, A0, A1 y P, todas del representante y sin verificar; P aparte de A0/A1', p2.ok && p2.decisions.map((d) => d.kind).join() === 'T,A0,A1,P'
        && p2.decisions.every((d) => d.capacity === 'legal_representative' && d.verification === 'unverified'), JSON.stringify(p2));
    ok('menor: nadie la acepta como «titular»', planActivationDecisions(reader('menor-1', { loginId: 'lector.menor', representedBy: { email: 'adulto@fixture.invalid' } }), adult, ctx).code === 'REPRESENTATIVE_REQUIRED');
    add(e6, p2.decisions);
    ok('lo declarado por el representante no es efectivo hasta verificar (como A0/A1)', !gate(e6).effective('P', 'menor-1') && gate(e6).status('P', 'menor-1') === 'granted_unverified');
    const pm = planActivationDecisions({ id: 'med-n', roles: ['mediador'], accountStatus: 'invited' }, { terms: true, termsVersion: '002@1.0', policy: true, policyVersion: '001@1.0', adultDeclared: true, mediatorCommitment: true, mediatorVersion: '005@1.0' }, ctx);
    ok('mediador: T, C005 y P; P como titular, C005 como mediador', pm.ok && pm.decisions.map((d) => `${d.kind}:${d.capacity}`).join() === 'T:titular,C005:mediator,P:titular');
    ok('mediador sin aceptar la Política ⇒ falta P', planActivationDecisions({ id: 'med-n', roles: ['mediador'] }, { terms: true, termsVersion: '002@1.0', adultDeclared: true, mediatorCommitment: true, mediatorVersion: '005@1.0' }, ctx).required?.join() === 'P');
    ok('ya aceptada en esta versión (reinvitación) ⇒ no se duplica', (() => { const p = planActivationDecisions(reader('n-1'), { ...adult, policy: undefined, policyVersion: undefined }, { ...ctx, policyAccepted: true }); return p.ok && !p.decisions.some((d) => d.kind === 'P'); })());
    ok('alta administrativa: A1 verificada sin P ⇒ no queda activa; con P verificada ⇒ sí', (() => {
        add(e6, [decision('adm-alta', 'A1', 'granted')]);
        const before = adminActivationAllowed({ id: 'adm-alta', roles: ['lector'] }, gate(e6));
        add(e6, [decision('adm-alta', 'P', 'granted', { version: '001@1.0', capacity: 'titular' })]);
        return !before && adminActivationAllowed({ id: 'adm-alta', roles: ['lector'] }, gate(e6));
    })());
    ok('P nunca en calidad de institución ni de mediador', codeOf(() => add(e6, [decision('x', 'P', 'granted', { version: '001@1.0', capacity: 'mediator' })])) === 'INVALID_CAPACITY'
        && codeOf(() => add(e6, [decision('x', 'P', 'granted', { version: '001@1.0', capacity: 'institution' })])) === 'INVALID_CAPACITY');
    add(e6, [decision('n-1', 'P', 'revoked', { version: '001@1.0', capacity: 'titular', medium: 'verifiable_message', requestRef: 'SOL-SINT-P' })]);
    ok('revocación de P: queda anotada y deja de constar como vigente; las demás decisiones no cambian', gate(e6).status('P', 'n-1') === 'revoked' && !policyOnFile(gate(e6), 'n-1') && gate(e6).effective('A1', 'n-1') && gate(e6).effective('T', 'n-1'));

    section('[7] compatibilidad e integridad del instante');
    const e7 = newEnv('compat');
    // Línea con el formato anterior (sin `t`), con el MAC que calculaba la versión anterior.
    const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
    const FIELDS = ['id', 's', 'k', 'a', 'd', 'e', 'v', 'w', 'q', 'x', 'u', 'r'];
    const old = { id: crypto.randomUUID(), s: hmac(hmac(getSubjectKey(), 'chp-a2-reader-v1'), 'viejo-1').toString('hex'), k: 'A2', a: 'granted', d: TODAY, e: TODAY, v: '004@1.0', w: 'paper', q: 'legal_representative', x: 'verified', u: null, r: 'AUT-VIEJA' };
    old.m = hmac(hmac(getSubjectKey(), 'chp-a2-registry-v2'), FIELDS.map((f) => String(old[f] ?? '')).join('\0')).toString('hex');
    fs.writeFileSync(e7.CHP_A2_REGISTRY, `${JSON.stringify(old)}\n`);
    ok('una línea anterior (sin instante) sigue verificando', gate(e7).effective('A2', 'viejo-1'));
    add(e7, [decision('nuevo-1', 'A2', 'granted')]);
    const raw = fs.readFileSync(e7.CHP_A2_REGISTRY, 'utf8');
    ok('conviven líneas con y sin instante', gate(e7).effective('A2', 'viejo-1') && gate(e7).effective('A2', 'nuevo-1'));
    fs.writeFileSync(e7.CHP_A2_REGISTRY, raw.replace(/"t":"[^"]+",/, ''));
    ok('quitar el instante de una línea ⇒ registro no disponible', codeOf(() => gate(e7)) === 'A2_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(e7.CHP_A2_REGISTRY, raw.replace('"r":"AUT-VIEJA"', '"r":"AUT-VIEJA","t":"2020-01-01T00:00:00.000Z"'));
    ok('añadir un instante a una línea anterior ⇒ registro no disponible', codeOf(() => gate(e7)) === 'A2_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(e7.CHP_A2_REGISTRY, raw.replace(/"t":"[^"]+"/, '"t":"2020-01-01T00:00:00.000Z"'));
    ok('alterar el instante ⇒ registro no disponible', codeOf(() => gate(e7)) === 'A2_REGISTRY_UNAVAILABLE');
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\npilotLegacy (V9R-DEP1): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
