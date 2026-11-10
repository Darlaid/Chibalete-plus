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
export function planActivationDecisions(user, acceptance, { today, ref, termsAccepted = false }) {
    const a = acceptance && typeof acceptance === 'object' ? acceptance : {};
    const staff = isMediatorAccount(user) || isAdminAccount(user);
    const mediator = isMediatorAccount(user);
    const institutional = !staff && isInstitutionalReader(user);
    const missing = [];
    if (a.terms !== true && !termsAccepted) missing.push('T');
    if (!staff && !OPT.actingAs.includes(a.actingAs)) missing.push('actingAs');
    if (!staff && !OPT.A1.includes(a.A1)) missing.push('A1');
    if (institutional && !['yes', 'no'].includes(a.A2)) missing.push('A2');
    if (!staff && a.actingAs === 'legal_representative' && !OPT.A0.includes(a.A0)) missing.push('A0');
    if ((staff || a.actingAs === 'titular') && a.adultDeclared !== true) missing.push('adultDeclared');
    if (mediator && a.mediatorCommitment !== true) missing.push('C005');
    if (missing.length) return { ok: false, code: 'DECISIONS_REQUIRED', required: missing };

    if (!termsAccepted && a.termsVersion !== DOCS.terms.version) return { ok: false, code: 'VERSION_MISMATCH', required: ['T'] };
    if (!staff && a.dataNoticeVersion !== DOCS.dataNotice.version) return { ok: false, code: 'VERSION_MISMATCH', required: ['A1'] };
    if (mediator && a.mediatorVersion !== DOCS.mediator.version) return { ok: false, code: 'VERSION_MISMATCH', required: ['C005'] };
    if (!staff && !institutional && a.A2 !== undefined && a.A2 !== 'not_applicable') return { ok: false, code: 'A2_NOT_APPLICABLE', required: ['A2'] };
    // V8.1-PROD-02B: A3 y A5 son opcionales; si llegan, solo «yes» o «no».
    for (const k of ['A3', 'A5']) if (a[k] !== undefined && !OPT[k].includes(a[k])) return { ok: false, code: 'DECISIONS_REQUIRED', required: [k] };
    if (!staff && a.actingAs === 'legal_representative' && a.A0 === 'no') return { ok: false, code: 'A0_DENIED' };
    if (!staff && a.A1 === 'no') return { ok: false, code: 'A1_DENIED' };

    const representative = !staff && a.actingAs === 'legal_representative';
    const capacity = representative ? 'legal_representative' : 'titular';
    const verification = representative ? 'unverified' : 'self_authenticated';
    const base = { subjectId: user.id, actDay: today, medium: 'in_app', requestRef: ref };
    // T ya vigente (compra) ⇒ no se duplica. Nunca aporta A0/A1/A2: esas son del representante o titular aquí.
    const decisions = termsAccepted ? [] : [{ ...base, kind: 'T', status: 'granted', version: DOCS.terms.version, capacity, verification }];
    if (representative) decisions.push({ ...base, kind: 'A0', status: 'granted', version: DOCS.dataNotice.version, capacity, verification });
    if (!staff) decisions.push({ ...base, kind: 'A1', status: 'granted', version: DOCS.dataNotice.version, capacity, verification });
    if (institutional) decisions.push({ ...base, kind: 'A2', status: a.A2 === 'yes' ? 'granted' : 'denied', version: DOCS.dataNotice.version, capacity, verification });
    // V8.1-PROD-02B: A3/A5 del lector solo si las decide; sin respuesta quedan pendientes (no se presumen).
    if (!staff) for (const k of ['A3', 'A5']) if (a[k] !== undefined) decisions.push({ ...base, kind: k, status: a[k] === 'yes' ? 'granted' : 'denied', version: DOCS.dataNotice.version, capacity, verification });
    if (mediator) decisions.push({ ...base, kind: 'C005', status: 'granted', version: DOCS.mediator.version, capacity: 'mediator', verification: 'self_authenticated' });
    return { ok: true, decisions, profile: mediator ? 'mediator' : staff ? 'staff' : representative ? 'representative' : 'titular' };
}

// ── V8.1-CLOSE-06B ──────────────────────────────────────────────────────────

/**
 * Documentos aprobados y publicados según Dirección. Configuración del servidor
 * (`CHP_ACCEPTANCE_DOCUMENTS`), JSON `{"002": {"version": "002@1.0", "url": "https://…"}, …}`.
 * Un documento cuenta como aprobado solo si la versión declarada es la que exige el
 * código y su enlace es https. Cualquier otra cosa ⇒ pendiente de aprobación.
 * @returns {{ id, version, title, url: string|null, approved: boolean }[]}
 */
export function acceptanceDocumentsStatus(env = process.env) {
    let declared = {};
    try { declared = JSON.parse(env.CHP_ACCEPTANCE_DOCUMENTS || '{}') || {}; } catch { declared = {}; }
    return Object.values(DOCS).map((d) => {
        const e = declared[d.id];
        let url = null;
        try { url = e && e.version === d.version && new URL(e.url).protocol === 'https:' ? new URL(e.url).toString() : null; } catch { url = null; }
        return { id: d.id, version: d.version, title: d.title, url, approved: url !== null };
    });
}

/** Documentos que una activación necesita aprobados, según la cuenta. */
export function requiredDocumentIds(user) {
    if (isMediatorAccount(user)) return ['001', '002', '005'];
    if (isAdminAccount(user)) return ['001', '002'];
    return ['001', '002', '004'];
}

/** T vigente para la versión actual (p. ej. aceptada en la compra): no se vuelve a pedir al activar. */
export const termsOnFile = (gate, userId) => {
    try { return gate.effective('T', userId) && gate.state('T', userId)?.version === DOCS.terms.version; } catch { return false; }
};

/**
 * Altas y cambios administrativos: una cuenta de lector o mediador solo queda ACTIVA
 * sin pasar por la activación si el registro ya tiene su decisión efectiva
 * (regularización con evidencia verificable: A1 del lector, C005 del mediador).
 * Administración de plataforma: sin cambio. Registro no verificable ⇒ no.
 */
export function adminActivationAllowed(user, gate) {
    const pureAdmin = isAdminAccount(user) && !isMediatorAccount(user) && !roleNames(user).some((r) => /lector/i.test(r));
    if (pureAdmin) return true;
    if (!gate) return false;
    return isMediatorAccount(user) ? gate.effective('C005', user.id) : gate.effective('A1', user.id);
}

/**
 * V8.1-PROD-02B — tratamientos opcionales del 004 para una cuenta:
 *  - `leo` (A3): Leo e IA;
 *  - `voiceTranscription` (A5): transcripción automática de la voz en la oralidad.
 * Mediadores y administración no deciden A3/A5 (no son lectores): `true`. Un lector necesita la
 * decisión EFECTIVA (concedida y verificada, o del titular adulto autenticado); pendiente, negada,
 * revocada o sin verificar ⇒ `false`. Lanza si el registro no es verificable (el llamador decide
 * el fallo cerrado).
 */
export function optionalProcessingFor(user, gate) {
    if (isMediatorAccount(user) || isAdminAccount(user)) return { leo: true, voiceTranscription: true };
    return { leo: gate.effective('A3', user.id), voiceTranscription: gate.effective('A5', user.id) };
}
