/**
 * acceptance.mjs — CHP-V8.1-CLOSE-05 (DIR-V81-01).
 *
 * Decisiones que exige la activación de una cuenta (`POST /api/accept-invite`),
 * el único punto de vinculación propio de Chibalete+: lo usan las invitaciones
 * institucionales y las cuentas que crea la tienda (B2C). Función pura: decide
 * qué falta y qué se registra; no escribe.
 *
 * Reglas (002, 004, 005; 006 P03):
 *  - nada viene marcado: cada decisión llega explícita o falta;
 *  - términos (002) y su versión vigente, siempre;
 *  - lector: quien activa declara su calidad (titular adulto o representante
 *    legal). Representante ⇒ A0. A1 Sí/No obligatoria; con A1 = No la cuenta no se
 *    activa (004 A1). A2 solo existe con acompañamiento institucional: cuenta con
 *    organización ⇒ Sí/No obligatoria; sin organización ⇒ «no aplica»;
 *  - mediador: titular adulto y compromiso 005 aceptado;
 *  - lo declarado por un representante queda `unverified` hasta que GVA lo
 *    verifique; titular y mediador quedan `self_authenticated` (enlace personal
 *    de activación más contraseña propia);
 *  - un contrato institucional (C003) no aporta A1 ni A2.
 */
import { ACCEPTANCE_DOCUMENTS as DOCS, DECISION_OPTIONS as OPT } from '../../utils/acceptanceDocuments.mjs';

const roleNames = (user) => (Array.isArray(user?.roles) ? user.roles : [user?.role]).filter(Boolean).map(String);
export const isMediatorAccount = (user) => roleNames(user).some((r) => /mediador|profesor/i.test(r));
export const isAdminAccount = (user) => roleNames(user).some((r) => /administrador/i.test(r));
/** Acompañamiento institucional: la cuenta pertenece a una organización registrada en su ficha. */
export const isInstitutionalReader = (user) => typeof user?.organizationId === 'string' && user.organizationId.trim() !== '';

/**
 * @param {object} user      cuenta invitada (ficha del padrón)
 * @param {object} acceptance  cuerpo `acceptance` de la petición
 * @param {{ today: string, ref: string }} ctx
 * @returns {{ ok: true, decisions: object[], profile: string } | { ok: false, code: string, required?: string[] }}
 */
export function planActivationDecisions(user, acceptance, { today, ref }) {
    const a = acceptance && typeof acceptance === 'object' ? acceptance : {};
    const staff = isMediatorAccount(user) || isAdminAccount(user);
    const mediator = isMediatorAccount(user);
    const institutional = !staff && isInstitutionalReader(user);
    const missing = [];
    if (a.terms !== true) missing.push('T');
    if (!staff && !OPT.actingAs.includes(a.actingAs)) missing.push('actingAs');
    if (!staff && !OPT.A1.includes(a.A1)) missing.push('A1');
    if (institutional && !['yes', 'no'].includes(a.A2)) missing.push('A2');
    if (!staff && a.actingAs === 'legal_representative' && !OPT.A0.includes(a.A0)) missing.push('A0');
    if ((staff || a.actingAs === 'titular') && a.adultDeclared !== true) missing.push('adultDeclared');
    if (mediator && a.mediatorCommitment !== true) missing.push('C005');
    if (missing.length) return { ok: false, code: 'DECISIONS_REQUIRED', required: missing };

    if (a.termsVersion !== DOCS.terms.version) return { ok: false, code: 'VERSION_MISMATCH', required: ['T'] };
    if (!staff && a.dataNoticeVersion !== DOCS.dataNotice.version) return { ok: false, code: 'VERSION_MISMATCH', required: ['A1'] };
    if (mediator && a.mediatorVersion !== DOCS.mediator.version) return { ok: false, code: 'VERSION_MISMATCH', required: ['C005'] };
    if (!staff && !institutional && a.A2 !== undefined && a.A2 !== 'not_applicable') return { ok: false, code: 'A2_NOT_APPLICABLE', required: ['A2'] };
    if (!staff && a.actingAs === 'legal_representative' && a.A0 === 'no') return { ok: false, code: 'A0_DENIED' };
    if (!staff && a.A1 === 'no') return { ok: false, code: 'A1_DENIED' };

    const representative = !staff && a.actingAs === 'legal_representative';
    const capacity = representative ? 'legal_representative' : 'titular';
    const verification = representative ? 'unverified' : 'self_authenticated';
    const base = { subjectId: user.id, actDay: today, medium: 'in_app', requestRef: ref };
    const decisions = [{ ...base, kind: 'T', status: 'granted', version: DOCS.terms.version, capacity, verification }];
    if (representative) decisions.push({ ...base, kind: 'A0', status: 'granted', version: DOCS.dataNotice.version, capacity, verification });
    if (!staff) decisions.push({ ...base, kind: 'A1', status: 'granted', version: DOCS.dataNotice.version, capacity, verification });
    if (institutional) decisions.push({ ...base, kind: 'A2', status: a.A2 === 'yes' ? 'granted' : 'denied', version: DOCS.dataNotice.version, capacity, verification });
    if (mediator) decisions.push({ ...base, kind: 'C005', status: 'granted', version: DOCS.mediator.version, capacity: 'mediator', verification: 'self_authenticated' });
    return { ok: true, decisions, profile: mediator ? 'mediator' : staff ? 'staff' : representative ? 'representative' : 'titular' };
}
