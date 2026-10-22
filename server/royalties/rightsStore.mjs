/**
 * rightsStore.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-A.
 *
 * Derechos versionados por obra (`rights_versions` en royalties.db) y las dos
 * preguntas que el resto del sistema les hace:
 *   - capabilityVerdict: ¿esta obra puede usarse para esta capacidad ahora?
 *     (cumplimiento P15; solo obras con régimen, ver DECISIONES_F0C §1.1)
 *   - economicEligibility: ¿esta obra puede participar en una liquidación en
 *     esta fecha? (`publisherId` por sí solo nunca la concede)
 *
 * Solo inserciones: corregir o cambiar derechos = nueva versión. La versión
 * efectiva en un instante es la de mayor version_no con effective_at <= ese
 * instante. Una obra con versiones pero sin versión efectiva y vigente queda
 * con todas sus capacidades denegadas: una licencia vencida no la libera.
 *
 * Fechas de vigencia (valid_from/valid_until, YYYY-MM-DD, inclusivas) en día
 * contractual America/Bogota (P6, UTC−5 sin horario de verano).
 */
import { getRoyaltiesDb, getPublisher, PublisherError } from './publishersStore.mjs';
import { ulid } from '../ulid.js';

export const RIGHTS_CAPABILITIES = Object.freeze([
    'subscription_reading', 'tts', 'ai_leo', 'offline', 'indexing', 'promo_fragments', 'cover_metadata',
]);
export const LEGAL_STATUSES = Object.freeze(['active', 'suspended', 'revoked', 'disputed']);
export const ECONOMIC_STATUSES = Object.freeze(['pending', 'active', 'retained']);
export const SETTLEMENT_CLASSES = Object.freeze(['liquidable', 'auxiliary', 'excluded']);
/** Tipos liquidables en V1 (P10: MOOK, podcast, vídeo y LU fuera). */
export const ECONOMIC_CONTENT_TYPES = Object.freeze(['libro', 'libro_album']);
export const FULL_SHARE_BP = 10000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

const bad = (code, message) => new PublisherError(400, code, message);
const isValidDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
    && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isValidInstant = (s) => typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s));

/** Día contractual (America/Bogota) de un instante, como YYYY-MM-DD. */
export function bogotaDay(at) {
    return new Date(new Date(at).getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** ¿Es un registro del catálogo una obra liquidable por tipo en V1? */
export function isEconomicContentType(content) {
    return !!content && ECONOMIC_CONTENT_TYPES.includes(content.tipo)
        && !content.parentId && !String(content.id || '').startsWith('content-mook-');
}

// ── puro: versión efectiva y capacidades ────────────────────────────────────

/** Versión efectiva en `at` (la de mayor version_no ya activada), o null. */
export function effectiveVersion(versions, at = new Date()) {
    const t = new Date(at).getTime();
    let best = null;
    for (const v of versions || []) {
        if (Date.parse(v.effectiveAt) > t) continue;
        if (!best || v.versionNo > best.versionNo) best = v;
    }
    return best;
}

/** ¿Está la versión dentro de su vigencia y jurídicamente activa en `at`? */
export function versionInForce(v, at = new Date()) {
    if (!v || v.legalStatus !== 'active') return false;
    const day = bogotaDay(at);
    if (day < v.validFrom) return false;
    if (v.validUntil && day > v.validUntil) return false;
    return true;
}

/**
 * Veredicto de una capacidad para una obra. Sin versiones → sin régimen
 * (comportamiento actual). Con versiones → solo lo que la versión efectiva y
 * vigente autoriza de forma expresa.
 */
export function capabilityVerdict(versions, capability, at = new Date()) {
    if (!RIGHTS_CAPABILITIES.includes(capability)) throw new Error(`capacidad desconocida: ${capability}`);
    if (!versions || versions.length === 0) return { regime: false, allowed: true, reason: 'NO_RIGHTS_REGIME' };
    const v = effectiveVersion(versions, at);
    if (!v) return { regime: true, allowed: false, reason: 'NO_EFFECTIVE_VERSION' };
    if (!versionInForce(v, at)) {
        return { regime: true, allowed: false, reason: v.legalStatus !== 'active' ? `LEGAL_${v.legalStatus.toUpperCase()}` : 'OUT_OF_VALIDITY', versionId: v.id };
    }
    if (v.permissions[capability] !== true) return { regime: true, allowed: false, reason: 'CAPABILITY_NOT_AUTHORIZED', versionId: v.id };
    return { regime: true, allowed: true, reason: 'AUTHORIZED', versionId: v.id };
}

// ── puro: elegibilidad económica ────────────────────────────────────────────

/**
 * ¿Puede la obra participar en una liquidación en `at`?
 * @param {{ content: object|null, versions: object[], publisherById: (id:string)=>object|null, at?: Date|string }} p
 * @returns {{ eligible: boolean, reasons: string[], versionId: string|null }}
 */
export function economicEligibility({ content, versions, publisherById, at = new Date() }) {
    const reasons = [];
    if (!content) return { eligible: false, reasons: ['CONTENT_NOT_FOUND'], versionId: null };
    if (content.status !== 'disponible') reasons.push('CONTENT_NOT_AVAILABLE');
    if (!isEconomicContentType(content)) reasons.push('CONTENT_TYPE_NOT_ECONOMIC');
    if (!versions || versions.length === 0) {
        reasons.push('NO_RIGHTS_VERSION');
        return { eligible: false, reasons, versionId: null };
    }
    const v = effectiveVersion(versions, at);
    if (!v) {
        reasons.push('NO_EFFECTIVE_VERSION');
        return { eligible: false, reasons, versionId: null };
    }
    if (v.legalStatus !== 'active') reasons.push(`LEGAL_${v.legalStatus.toUpperCase()}`);
    else if (!versionInForce(v, at)) reasons.push('OUT_OF_VALIDITY');
    if (v.economicStatus !== 'active') reasons.push(`ECONOMIC_${v.economicStatus.toUpperCase()}`);
    if (v.settlementClass !== 'liquidable') reasons.push(`SETTLEMENT_${v.settlementClass.toUpperCase()}`);
    if (v.permissions.subscription_reading !== true) reasons.push('READING_NOT_AUTHORIZED');
    if (!(v.alpha > 0 && v.alpha <= 1)) reasons.push('ALPHA_MISSING');
    if (!(v.expectedMinutes > 0)) reasons.push('EXPECTED_MINUTES_MISSING');
    const editorial = publisherById(v.publisherId);
    if (!editorial || editorial.status !== 'active') reasons.push('PUBLISHER_NOT_ACTIVE');
    if (content.publisherId !== v.publisherId) reasons.push('PUBLISHER_MISMATCH');
    const shares = Array.isArray(v.shares) ? v.shares : [];
    const sum = shares.reduce((s, x) => s + (Number.isInteger(x.shareBp) ? x.shareBp : 0), 0);
    if (shares.length === 0 || sum !== FULL_SHARE_BP) reasons.push('SHARES_INVALID');
    for (const s of shares) {
        const holder = publisherById(s.publisherId);
        if (!holder || holder.status !== 'active') { reasons.push('SHARE_HOLDER_NOT_ACTIVE'); break; }
    }
    return { eligible: reasons.length === 0, reasons, versionId: v.id };
}

// ── persistencia ────────────────────────────────────────────────────────────

const PERM_COL = (cap) => `perm_${cap}`;

function toApi(row) {
    if (!row) return null;
    let shares = [];
    try { shares = JSON.parse(row.shares || '[]'); } catch { shares = []; }
    const permissions = {};
    for (const cap of RIGHTS_CAPABILITIES) permissions[cap] = row[PERM_COL(cap)] === 1;
    return {
        id: row.id,
        contentId: row.content_id,
        versionNo: row.version_no,
        publisherId: row.publisher_id,
        actRef: row.act_ref,
        actSignedOn: row.act_signed_on,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        effectiveAt: row.effective_at,
        legalStatus: row.legal_status,
        economicStatus: row.economic_status,
        settlementClass: row.settlement_class,
        alpha: row.alpha,
        expectedMinutes: row.expected_minutes,
        shares,
        permissions,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
    };
}

/** Historial completo de una obra, de la versión 1 en adelante. */
export function listRightsVersions(contentId, db = getRoyaltiesDb()) {
    return db.prepare('SELECT * FROM rights_versions WHERE content_id = ? ORDER BY version_no').all(contentId).map(toApi);
}

/** Versiones de todas las obras con régimen, agrupadas por contentId. */
export function rightsIndex(db = getRoyaltiesDb()) {
    const index = new Map();
    for (const row of db.prepare('SELECT * FROM rights_versions ORDER BY content_id, version_no').all()) {
        const v = toApi(row);
        if (!index.has(v.contentId)) index.set(v.contentId, []);
        index.get(v.contentId).push(v);
    }
    return index;
}

const ALLOWED_INPUT = new Set([
    'publisherId', 'actRef', 'actSignedOn', 'validFrom', 'validUntil', 'effectiveAt', 'legalStatus',
    'economicStatus', 'settlementClass', 'alpha', 'expectedMinutes', 'shares', 'permissions', 'notes',
]);

/**
 * Valida y normaliza una versión. `content` es el registro del catálogo (lo
 * aporta el llamador; este módulo no lee content.json).
 */
export function validateRightsInput(input, { content, publisherById }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('invalid_body', 'Cuerpo inválido');
    for (const k of Object.keys(input)) if (!ALLOWED_INPUT.has(k)) throw bad('unknown_field', `Campo no admitido: ${k}`);
    if (!content) throw new PublisherError(404, 'content_not_found', 'La obra no existe en el catálogo');

    const editorial = typeof input.publisherId === 'string' ? publisherById(input.publisherId) : null;
    if (!editorial) throw bad('unknown_publisher', 'La editorial indicada no existe');
    if (editorial.status !== 'active') throw bad('inactive_publisher', 'La editorial indicada está inactiva');
    if (content.publisherId !== input.publisherId) throw bad('publisher_mismatch', 'La editorial no coincide con la editorial responsable de la obra');

    const actRef = typeof input.actRef === 'string' ? input.actRef.trim() : '';
    if (!actRef || actRef.length > 200) throw bad('invalid_act_ref', 'La referencia del Acta es obligatoria (máx. 200)');
    for (const k of ['actSignedOn', 'validFrom']) if (!isValidDate(input[k])) throw bad('invalid_date', `${k} debe ser una fecha YYYY-MM-DD`);
    if (input.validUntil != null && !isValidDate(input.validUntil)) throw bad('invalid_date', 'validUntil debe ser una fecha YYYY-MM-DD');
    if (input.validUntil != null && input.validUntil < input.validFrom) throw bad('invalid_validity', 'validUntil es anterior a validFrom');
    if (!isValidInstant(input.effectiveAt)) throw bad('invalid_effective_at', 'effectiveAt debe ser una fecha-hora ISO');
    if (!LEGAL_STATUSES.includes(input.legalStatus)) throw bad('invalid_legal_status', 'legalStatus inválido');
    if (!ECONOMIC_STATUSES.includes(input.economicStatus)) throw bad('invalid_economic_status', 'economicStatus inválido');
    if (!SETTLEMENT_CLASSES.includes(input.settlementClass)) throw bad('invalid_settlement_class', 'settlementClass inválido');

    const perms = input.permissions;
    if (!perms || typeof perms !== 'object' || Array.isArray(perms)) throw bad('permissions_required', 'Los permisos son obligatorios y expresos');
    for (const k of Object.keys(perms)) if (!RIGHTS_CAPABILITIES.includes(k)) throw bad('unknown_permission', `Permiso desconocido: ${k}`);
    for (const cap of RIGHTS_CAPABILITIES) {
        if (typeof perms[cap] !== 'boolean') throw bad('permission_not_explicit', `El permiso ${cap} debe declararse como true o false`);
    }

    const alpha = input.alpha == null ? null : input.alpha;
    if (alpha !== null && !(typeof alpha === 'number' && alpha > 0 && alpha <= 1)) throw bad('invalid_alpha', 'alpha debe estar en (0, 1]');
    const expectedMinutes = input.expectedMinutes == null ? null : input.expectedMinutes;
    if (expectedMinutes !== null && !(typeof expectedMinutes === 'number' && expectedMinutes > 0 && expectedMinutes < 100000)) {
        throw bad('invalid_expected_minutes', 'expectedMinutes debe ser un número positivo');
    }

    const shares = input.shares == null ? [] : input.shares;
    if (!Array.isArray(shares) || shares.length > 50) throw bad('invalid_shares', 'shares debe ser una lista');
    const seen = new Set();
    let sum = 0;
    for (const s of shares) {
        if (!s || typeof s !== 'object' || Object.keys(s).some((k) => k !== 'publisherId' && k !== 'shareBp')) throw bad('invalid_shares', 'Cada participación es { publisherId, shareBp }');
        if (!Number.isInteger(s.shareBp) || s.shareBp < 1 || s.shareBp > FULL_SHARE_BP) throw bad('invalid_shares', 'shareBp debe ser un entero entre 1 y 10000');
        if (seen.has(s.publisherId)) throw bad('invalid_shares', 'Titular repetido en la matriz');
        seen.add(s.publisherId);
        const holder = typeof s.publisherId === 'string' ? publisherById(s.publisherId) : null;
        if (!holder) throw bad('unknown_share_holder', `Titular inexistente: ${s.publisherId}`);
        if (holder.status !== 'active') throw bad('inactive_share_holder', `Titular inactivo: ${s.publisherId}`);
        sum += s.shareBp;
    }
    if (shares.length > 0 && sum !== FULL_SHARE_BP) throw bad('shares_not_100', 'Las participaciones deben sumar 100 % (10000 pb)');

    if (input.settlementClass === 'liquidable') {
        if (!isEconomicContentType(content)) throw bad('not_economic_type', 'Este tipo de contenido no es liquidable en V1');
        if (shares.length === 0) throw bad('shares_required', 'Una obra liquidable necesita su matriz de participaciones');
        if (alpha === null) throw bad('alpha_required', 'Una obra liquidable necesita alpha');
        if (expectedMinutes === null) throw bad('expected_minutes_required', 'Una obra liquidable necesita minutos esperados (P1)');
        if (perms.subscription_reading !== true) throw bad('reading_required', 'Una obra liquidable debe autorizar la lectura por suscripción');
    }

    const notes = input.notes == null ? null : String(input.notes).slice(0, 2000);
    return {
        publisherId: input.publisherId, actRef, actSignedOn: input.actSignedOn, validFrom: input.validFrom,
        validUntil: input.validUntil ?? null, effectiveAt: new Date(input.effectiveAt).toISOString(),
        legalStatus: input.legalStatus, economicStatus: input.economicStatus, settlementClass: input.settlementClass,
        alpha, expectedMinutes, shares, permissions: { ...perms }, notes,
    };
}

/** Registra una versión nueva (nunca modifica las anteriores). */
export function createRightsVersion(contentId, input, { content, actor, now = new Date().toISOString(), db = getRoyaltiesDb() }) {
    if (typeof contentId !== 'string' || !contentId) throw bad('invalid_content_id', 'contentId inválido');
    const publisherById = (id) => getPublisher(id, db);
    const v = validateRightsInput(input, { content, publisherById });
    const insert = db.transaction(() => {
        const { n } = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS n FROM rights_versions WHERE content_id = ?').get(contentId);
        const row = {
            id: `rv-${ulid().toLowerCase()}`, content_id: contentId, version_no: n + 1, publisher_id: v.publisherId,
            act_ref: v.actRef, act_signed_on: v.actSignedOn, valid_from: v.validFrom, valid_until: v.validUntil,
            effective_at: v.effectiveAt, legal_status: v.legalStatus, economic_status: v.economicStatus,
            settlement_class: v.settlementClass, alpha: v.alpha, expected_minutes: v.expectedMinutes,
            shares: JSON.stringify(v.shares), notes: v.notes, created_by: String(actor || 'unknown'), created_at: now,
        };
        for (const cap of RIGHTS_CAPABILITIES) row[PERM_COL(cap)] = v.permissions[cap] ? 1 : 0;
        const keys = Object.keys(row);
        db.prepare(`INSERT INTO rights_versions (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(row);
        return row.id;
    });
    const id = insert.immediate();
    return toApi(db.prepare('SELECT * FROM rights_versions WHERE id = ?').get(id));
}

/** Elegibilidad de una obra leyendo sus versiones y titulares de la base. */
export function eligibilityFor(content, { at = new Date(), db = getRoyaltiesDb() } = {}) {
    const versions = content ? listRightsVersions(content.id, db) : [];
    return economicEligibility({ content, versions, publisherById: (id) => getPublisher(id, db), at });
}

// ── cumplimiento (P15) ──────────────────────────────────────────────────────

export const RIGHTS_ENFORCEMENT_MODES = Object.freeze(['off', 'shadow', 'enforce']);

/** Modo vigente. Cualquier valor desconocido se trata como 'off'. */
export function rightsEnforcementMode(env = process.env) {
    const m = String(env.RIGHTS_ENFORCEMENT_MODE || 'off').toLowerCase();
    return RIGHTS_ENFORCEMENT_MODES.includes(m) ? m : 'off';
}

/**
 * Guardia por capacidad para los puntos de autorización del servidor.
 * Devuelve { deny, verdict }. En 'off' no consulta la base; en 'shadow'
 * registra lo que denegaría y no deniega; en 'enforce' deniega.
 *
 * El índice se relee como mucho cada `refreshMs`. Si una relectura falla se
 * usa el último índice bueno (las obras sin régimen siguen intactas); solo si
 * nunca se pudo leer, 'enforce' deniega (fail-closed) en lugar de explotar sin
 * licencia una obra que podría exigirla.
 */
export function createRightsGate({ log = () => {}, env = process.env, getIndex = () => rightsIndex(), refreshMs = 2000, now = () => Date.now() } = {}) {
    let cached = null;
    let loadedAt = 0;
    const currentIndex = () => {
        if (cached && now() - loadedAt < refreshMs) return cached;
        try {
            cached = getIndex();
            loadedAt = now();
        } catch (e) {
            log(`[RIGHTS] index read failed: ${e.message}${cached ? ' (using last good index)' : ''}`, 'ERROR');
            if (!cached) throw e;
        }
        return cached;
    };
    rightsGate.invalidate = () => { loadedAt = 0; };
    return rightsGate;
    function rightsGate(contentId, capability, { exempt = false, at = new Date(), silent = false } = {}) {
        const mode = rightsEnforcementMode(env);
        if (mode === 'off' || exempt || !contentId) return { deny: false, verdict: null };
        let verdict;
        try {
            verdict = capabilityVerdict(currentIndex().get(contentId) || [], capability, at);
        } catch (e) {
            if (mode === 'shadow') return { deny: false, verdict: null };
            return { deny: true, verdict: { regime: true, allowed: false, reason: 'RIGHTS_UNAVAILABLE' } };
        }
        if (verdict.allowed) return { deny: false, verdict };
        if (mode === 'shadow') {
            if (!silent) log(`[RIGHTS_SHADOW] would_deny contentId=${contentId} capability=${capability} reason=${verdict.reason}`, 'ACCESS');
            return { deny: false, verdict };
        }
        if (!silent) log(`[RIGHTS] deny contentId=${contentId} capability=${capability} reason=${verdict.reason}`, 'ACCESS');
        return { deny: true, verdict };
    }
}
