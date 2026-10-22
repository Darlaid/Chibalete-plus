/**
 * commercialClass.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-B.
 *
 * Clasificación comercial de las reglas de `access_db.json` (P9). Módulo puro:
 * no lee ni escribe stores; server.js aplica sus resultados dentro del lock de
 * accesos existente.
 *
 * - Taxonomía congelada en DECISIONES_F0C.md (P9). Una regla sin clase válida
 *   es `unclassified`, que nunca es elegible.
 * - Solo `paid_b2c` y `paid_institutional` pueden respaldar una atribución
 *   económica (G5: ninguna lectura gratuita, piloto, de cortesía, promocional,
 *   interna o de plantilla genera remuneración).
 * - La clase NO interviene en el permiso de lectura: el motor de acceso no la lee.
 * - Sin retroactividad: cada cambio de clase se añade a `commercialClassHistory`
 *   con la hora del servidor; `commercialClassAt(rule, t)` devuelve la clase
 *   vigente en `t`, así que reclasificar hoy no altera atribuciones pasadas.
 */

export const COMMERCIAL_CLASSES = Object.freeze([
    'paid_b2c', 'paid_institutional', 'pilot', 'courtesy', 'promo_authorized', 'internal', 'template', 'unclassified',
]);
export const ECONOMIC_COMMERCIAL_CLASSES = Object.freeze(['paid_b2c', 'paid_institutional']);
/** Campos de la regla que solo escribe el endpoint de clasificación. */
export const COMMERCIAL_FIELDS = Object.freeze(['commercialClass', 'commercialClassSince', 'commercialClassHistory']);
const SCOPE_RANK = Object.freeze({ user: 0, group: 1, organization: 2 });

export class CommercialClassError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'CommercialClassError';
        this.status = status;
        this.code = code;
    }
}
const bad = (code, message) => new CommercialClassError(400, code, message);

export const isCommercialClass = (v) => typeof v === 'string' && COMMERCIAL_CLASSES.includes(v);
export const isEconomicClass = (c) => ECONOMIC_COMMERCIAL_CLASSES.includes(c);

/** Clase vigente de una regla en el instante `at` (ms). Sin historial válido → unclassified. */
export function commercialClassAt(rule, at = Date.now()) {
    const history = Array.isArray(rule?.commercialClassHistory) ? rule.commercialClassHistory : [];
    let current = 'unclassified';
    let since = -Infinity;
    for (const h of history) {
        if (!h || !isCommercialClass(h.commercialClass) || !Number.isFinite(h.since)) continue;
        if (h.since <= at && h.since >= since) { current = h.commercialClass; since = h.since; }
    }
    return current;
}

/** ¿Está la regla vigente en `at`? Mismo criterio de caducidad que el motor de acceso. */
export function ruleActiveAt(rule, at = Date.now()) {
    if (!rule) return false;
    if (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && at > rule.expiresAt) return false;
    if (rule.b2c && Number.isFinite(rule.b2c.revokedAt) && at >= rule.b2c.revokedAt) return false;
    return true;
}

/**
 * ¿Puede la regla respaldar una atribución económica en `at`?
 * Clase pagada vigente en `at` y regla activa en `at`. No mira el contenido.
 */
export function ruleSupportsEconomicAttribution(rule, at = Date.now()) {
    return ruleActiveAt(rule, at) && isEconomicClass(commercialClassAt(rule, at));
}

/** Valida la petición de clasificación. */
export function validateClassificationInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('invalid_body', 'Cuerpo inválido');
    for (const k of Object.keys(input)) {
        if (!['commercialClass', 'evidenceRef', 'note'].includes(k)) throw bad('unknown_field', `Campo no admitido: ${k}`);
    }
    if (!isCommercialClass(input.commercialClass)) throw bad('invalid_commercial_class', `commercialClass debe ser uno de: ${COMMERCIAL_CLASSES.join(', ')}`);
    const evidenceRef = typeof input.evidenceRef === 'string' ? input.evidenceRef.trim() : '';
    if (!evidenceRef || evidenceRef.length > 300) throw bad('evidence_required', 'evidenceRef es obligatorio (máx. 300): soporte de la aprobación individual');
    const note = input.note == null ? null : String(input.note).slice(0, 1000);
    return { commercialClass: input.commercialClass, evidenceRef, note };
}

/**
 * Devuelve una COPIA de la regla con la nueva clase vigente desde `nowMs`.
 * Nunca acepta una fecha del cliente: la clase rige desde que se registra.
 * Si la clase ya es la vigente, devuelve { changed: false } sin tocar nada.
 */
export function applyClassification(rule, input, { actor, nowMs = Date.now() }) {
    if (!rule || typeof rule !== 'object') throw new CommercialClassError(404, 'rule_not_found', 'Regla no encontrada');
    const v = validateClassificationInput(input);
    const previous = commercialClassAt(rule, nowMs);
    if (previous === v.commercialClass) return { changed: false, previous, rule };
    const history = Array.isArray(rule.commercialClassHistory) ? rule.commercialClassHistory : [];
    const lastSince = history.reduce((m, h) => (Number.isFinite(h?.since) ? Math.max(m, h.since) : m), -Infinity);
    const since = Math.max(nowMs, lastSince + 1);
    const entry = { commercialClass: v.commercialClass, since, by: String(actor || 'unknown'), evidenceRef: v.evidenceRef, ...(v.note ? { note: v.note } : {}) };
    return {
        changed: true,
        previous,
        rule: { ...rule, commercialClass: v.commercialClass, commercialClassSince: since, commercialClassHistory: [...history, entry] },
    };
}

/**
 * POST /api/access reconstruye la regla desde el cuerpo: arrastra los campos
 * comerciales guardados y rechaza que el cuerpo los traiga (solo se cambian por
 * el endpoint de clasificación, que es el auditado).
 */
export function assertNoCommercialFieldsInPayload(payload) {
    const sent = COMMERCIAL_FIELDS.filter((k) => payload && Object.prototype.hasOwnProperty.call(payload, k));
    if (sent.length) throw bad('commercial_class_readonly', `La clasificación comercial se cambia por su endpoint propio (campos: ${sent.join(', ')})`);
}
export function carryCommercialFields(newRule, storedRule) {
    if (!storedRule) return newRule;
    const out = { ...newRule };
    for (const k of COMMERCIAL_FIELDS) if (Object.prototype.hasOwnProperty.call(storedRule, k)) out[k] = storedRule[k];
    return out;
}

/**
 * ¿Queda la cuenta fuera de la remuneración? Administración, tráfico sintético
 * y las cuentas internas que se aporten (P7: la lista concreta está pendiente
 * de negocio). Los mediadores NO se excluyen por su rol.
 */
export function isEconomicallyExcludedUser(user, { internalUserIds = [] } = {}) {
    if (!user) return true;
    const roles = Array.isArray(user.roles) ? user.roles : (user.rol ? [user.rol] : []);
    if (roles.includes('administrador')) return true;
    if (Object.prototype.hasOwnProperty.call(user, '_loadtest_marker')) return true;
    return internalUserIds.includes(user.id);
}

/** ¿Cubre la regla este contenido? Títulos explícitos o colección (parentId). */
export function ruleCoversContent(rule, content) {
    if (!rule || !content) return false;
    if (Array.isArray(rule.titleIds) && rule.titleIds.includes(content.id)) return true;
    return !!content.parentId && Array.isArray(rule.collectionIds) && rule.collectionIds.includes(content.parentId);
}

/**
 * Atribución comercial determinista para (usuario, contenido, instante).
 * `appliedRuleIds` sale del motor de acceso (resolveUserContentAccess), que ya
 * decidió qué reglas aplican al usuario; aquí solo se filtra por contenido y se
 * elige UNA. Orden: clase económica vigente primero (P8: basta una regla pagada
 * que cubra la obra), luego ámbito user > group > organization, luego id.
 * Devuelve una sola regla o ninguna: nunca dos atribuciones.
 */
export function resolveCommercialAttribution({ rules, appliedRuleIds, content, user, at = Date.now(), internalUserIds = [] }) {
    const applied = new Set(Array.isArray(appliedRuleIds) ? appliedRuleIds : []);
    const candidates = (Array.isArray(rules) ? rules : [])
        .filter((r) => r && applied.has(r.id) && ruleActiveAt(r, at) && ruleCoversContent(r, content))
        .map((r) => ({ rule: r, commercialClass: commercialClassAt(r, at) }))
        .sort((a, b) => (Number(isEconomicClass(b.commercialClass)) - Number(isEconomicClass(a.commercialClass)))
            || ((SCOPE_RANK[a.rule.scope] ?? 9) - (SCOPE_RANK[b.rule.scope] ?? 9))
            || String(a.rule.id).localeCompare(String(b.rule.id)));
    const chosen = candidates[0] || null;
    const excluded = isEconomicallyExcludedUser(user, { internalUserIds });
    let reason;
    if (!chosen) reason = 'NO_COVERING_RULE';
    else if (!isEconomicClass(chosen.commercialClass)) reason = `CLASS_${chosen.commercialClass.toUpperCase()}`;
    else if (excluded) reason = 'USER_EXCLUDED';
    else reason = 'ELIGIBLE';
    return {
        ruleId: chosen?.rule.id ?? null,
        commercialClass: chosen?.commercialClass ?? null,
        eligible: reason === 'ELIGIBLE',
        reason,
        candidateRuleIds: candidates.map((c) => c.rule.id),
    };
}
