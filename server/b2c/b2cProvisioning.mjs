/**
 * b2cProvisioning.mjs — acceso B2C con caducidad (WEB-REORG P2-C, CHP-B2C-PROVISIONING-01).
 *
 * La tienda (WooCommerce) llama servidor a servidor cuando un pedido de suscripción queda
 * pagado. Este módulo decide, sin efectos, qué escribir; `server.js` lo aplica con los
 * mismos locks que el resto de la app (`mutateUsers`, `mutateAccessRules`).
 *
 * Modelo (doctrina P2-B):
 *  - UNA regla de acceso por pedido, de ámbito USUARIO, con id determinista
 *    `access-b2c-<source>-order-<orderId>` (idempotencia por construcción);
 *  - `titleIds` = copia de la regla plantilla `access-b2c-lectores` (lista maestra B2C);
 *  - `expiresAt` = mismo día 12 meses después, 23:59:59.999 en Bogotá. El motor de accesos
 *    ya ignora reglas vencidas en cada petición (accessService.js): no hace falta cron;
 *  - el comprador NUNCA entra en `group-b2c-lectores`: las reglas se SUMAN y la del grupo
 *    no caduca, así que pertenecer al grupo anularía la caducidad personal;
 *  - reembolso → `expiresAt = ahora` SOLO en la regla de ese pedido (sin borrar nada).
 *
 * Cuentas representadas (V9 F3-D1): con `reader: { type: 'minor' }` la cuenta de lectura es la de un
 * menor sin correo propio. Tiene `loginId` (generado por el servidor, no derivado de su nombre),
 * `representedBy.email` (contacto del adulto del pedido) y `email` vacío; varias pueden compartir
 * contacto. Todo lo demás (regla, progreso, decisiones) sigue yendo por `user.id`. El contacto es una
 * comprobación de VÍNCULO para reutilizar la cuenta, nunca prueba de representación legal: la
 * representación se declara al activar y la verifica GVA. Sin `reader`, el contrato no cambia.
 *
 * Autenticación: HMAC-SHA256 del cuerpo crudo con un secreto dedicado (file-only), marca de
 * tiempo con ventana de 300 s y comparación en tiempo constante. Nunca se registran correos,
 * tokens ni el secreto.
 */
import crypto from 'node:crypto';
import { ACCEPTANCE_DOCUMENTS } from '../../utils/acceptanceDocuments.mjs';

export const B2C_TEMPLATE_RULE_ID = 'access-b2c-lectores';
export const B2C_PLANS = Object.freeze(['digital', 'mi_biblioteca']);
export const B2C_SOURCES = Object.freeze(['production', 'staging', 'test']);
export const B2C_TS_HEADER = 'x-chplus-b2c-timestamp';
export const B2C_SIG_HEADER = 'x-chplus-b2c-signature';
export const B2C_SIGNATURE_WINDOW_SEC = 300;
export const B2C_INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC-5, sin horario de verano
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** API-HARDEN-01: adelanto máximo admitido del reloj de la tienda en `termsAcceptance.acceptedAt`. */
export const TERMS_CLOCK_SKEW_MS = 120_000;
/**
 * Instante con el que se clasifica el DÍA del acto en el registro de decisiones: nunca posterior al
 * reloj de la app. Con la tolerancia anterior, una aceptación «adelantada» cerca de la medianoche
 * caería en el día siguiente y el registro (que no admite días futuros) la rechazaría DESPUÉS de
 * crear la cuenta. Solo acota la clasificación del día: `acceptedAt` se conserva tal como llegó.
 */
export const termsActDayMs = (acceptedAt, nowMs) => Math.min(acceptedAt, nowMs);
/** V9 F3-D1 — usuario de acceso de una cuenta representada: `lec-xxxx-xxxx-xxxx`, 60 bits aleatorios. */
const LOGIN_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 símbolos, sin l, o, 0 ni 1
export const B2C_LOGIN_ID_RX = /^lec-[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$/;
export function makeB2cLoginId(bytes = crypto.randomBytes(12)) {
    let s = '';
    for (let i = 0; i < 12; i++) s += LOGIN_ID_ALPHABET[bytes[i] & 31]; // 5 bits por símbolo, sin sesgo
    return `lec-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
/** Cuenta B2C representada: usuario propio y contacto de un adulto, sin correo propio. */
export const isRepresentedAccount = (u) => !!u && u.b2c === true && typeof u.loginId === 'string' && B2C_LOGIN_ID_RX.test(u.loginId)
    && typeof u.representedBy?.email === 'string' && u.representedBy.email !== '';
const MIN_ACTIVATION_MS = Date.UTC(2024, 0, 1); // cota de cordura; admite fechas pasadas (reintentos, pruebas de caducidad)

/** Error funcional con estado HTTP y código estable (sin datos personales). */
export class B2cError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/**
 * Fin de la vigencia: mismo día del calendario de Bogotá, 12 meses después, a las 23:59:59.999
 * (hora de Bogotá). Si el día no existe (29-feb), se usa el último día del mes.
 */
export function computeExpiresAt(activationAt) {
    const local = new Date(activationAt - BOGOTA_OFFSET_MS); // campos UTC = hora local de Bogotá
    const y = local.getUTCFullYear() + 1;
    const m = local.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = Math.min(local.getUTCDate(), lastDay);
    return Date.UTC(y, m, d, 23, 59, 59, 999) + BOGOTA_OFFSET_MS;
}

export const ruleIdFor = (source, orderId) => `access-b2c-${source}-order-${orderId}`;
export const idempotencyKeyFor = (source, orderId) => `${source}:order:${orderId}`;

/** Firma `v1=<hex>` de `${timestamp}.${rawBody}`. La usan la tienda y las pruebas. */
export function signB2cRequest(secret, timestamp, rawBody) {
    return 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

/** Verifica firma y ventana temporal. Devuelve true/false; nunca lanza ni explica el motivo. */
export function verifyB2cSignature({ secret, timestamp, signature, rawBody, nowMs }) {
    if (!secret || typeof rawBody !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') return false;
    if (!/^\d{9,12}$/.test(timestamp)) return false;
    const skew = Math.abs(Math.floor(nowMs / 1000) - Number(timestamp));
    if (skew > B2C_SIGNATURE_WINDOW_SEC) return false;
    const expected = signB2cRequest(secret, timestamp, rawBody);
    return crypto.timingSafeEqual(digest(expected), digest(signature));
}

/**
 * Middleware de autenticación. `readSecret` es inyectable solo para pruebas unitarias; en
 * producción es `readB2cProvisioningSecret` (ruta constante). Cualquier fallo → 401 idéntico.
 */
export function createB2cGuard({ readSecret, log = () => {}, now = () => Date.now() }) {
    return async function b2cGuard(req, res, next) {
        let secret = null;
        try { secret = await readSecret(); } catch (e) { log(`[B2C] secret unavailable (${e?.code || 'ERROR'})`, 'SECURITY'); }
        const ok = verifyB2cSignature({
            secret,
            timestamp: req.headers[B2C_TS_HEADER],
            signature: req.headers[B2C_SIG_HEADER],
            rawBody: req.rawBody,
            nowMs: now(),
        });
        secret = null;
        if (!ok) return res.status(401).json({ error: 'No autorizado' });
        return next();
    };
}

const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Valida y normaliza la entrada de /provision. Lanza B2cError(400, …). */
export function validateProvisionInput(body, nowMs) {
    const b = body && typeof body === 'object' ? body : {};
    const orderId = Number(b.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new B2cError(400, 'invalid_order_id');
    const productId = Number(b.productId);
    if (!Number.isInteger(productId) || productId <= 0) throw new B2cError(400, 'invalid_product_id');
    if (!B2C_PLANS.includes(b.plan)) throw new B2cError(400, 'invalid_plan');
    if (!B2C_SOURCES.includes(b.source)) throw new B2cError(400, 'invalid_source');
    if (!isEmail(b.email)) throw new B2cError(400, 'invalid_email');
    const activationAt = Number(b.activationAt);
    if (!Number.isInteger(activationAt) || activationAt < MIN_ACTIVATION_MS || activationAt > nowMs + MAX_FUTURE_SKEW_MS) {
        throw new B2cError(400, 'invalid_activation_at');
    }
    if (b.idempotencyKey !== idempotencyKeyFor(b.source, orderId)) throw new B2cError(400, 'invalid_idempotency_key');
    const fullName = typeof b.fullName === 'string' ? b.fullName.trim().slice(0, 120) : '';
    // V8.1-CLOSE-06B: constancia opcional de la aceptación del checkout, firmada con el resto del
    // cuerpo. Solo la versión vigente de los términos (002) y una fecha no futura. Ausente ⇒ como antes.
    let termsAcceptance = null;
    if (b.termsAcceptance !== undefined) {
        const t = b.termsAcceptance;
        const at = t?.acceptedAt; // API-HARDEN-01: sin coerción — solo un entero en ms (ni cadenas ni arreglos)
        if (!t || typeof t !== 'object' || t.version !== ACCEPTANCE_DOCUMENTS.terms.version) throw new B2cError(400, 'invalid_terms_acceptance');
        // API-HARDEN-01: la tienda y la app tienen relojes distintos. Solo se tolera un adelanto pequeño y
        // acotado (TERMS_CLOCK_SKEW_MS); más allá, la fecha es futura y no acreditable. El valor no se altera.
        if (!Number.isInteger(at) || at < MIN_ACTIVATION_MS || at > nowMs + TERMS_CLOCK_SKEW_MS) throw new B2cError(400, 'invalid_terms_acceptance');
        // V8.1-PROD-05B (G2): la aceptación del checkout precede al pago; una posterior a la activación no es acreditable.
        if (at > activationAt + MAX_FUTURE_SKEW_MS) throw new B2cError(400, 'invalid_terms_acceptance');
        termsAcceptance = { version: t.version, acceptedAt: at };
    }
    // V9 F3-D1: lector menor representado. `email` es entonces el contacto del adulto del pedido. `loginId`
    // solo para reutilizar una cuenta existente; `name` es un apodo opcional (nunca se exige). La aceptación
    // del checkout es del comprador: no se admite como T de la cuenta del menor (la API la anotaría como
    // `titular / verified`); el representante la da al activar y GVA la verifica.
    let reader = null;
    if (b.reader !== undefined) {
        const r = b.reader;
        if (!r || typeof r !== 'object' || Array.isArray(r) || r.type !== 'minor') throw new B2cError(400, 'invalid_reader');
        if (r.loginId !== undefined && (typeof r.loginId !== 'string' || !B2C_LOGIN_ID_RX.test(r.loginId))) throw new B2cError(400, 'invalid_reader');
        if (r.name !== undefined && typeof r.name !== 'string') throw new B2cError(400, 'invalid_reader');
        const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
        if ([...name].length > 60) throw new B2cError(400, 'invalid_reader');
        if (termsAcceptance) throw new B2cError(400, 'terms_acceptance_not_applicable');
        reader = { type: 'minor', loginId: r.loginId ?? null, name };
    }
    return { orderId, productId, plan: b.plan, source: b.source, email: b.email, fullName, activationAt,
        idempotencyKey: b.idempotencyKey, dryRun: b.dryRun === true, termsAcceptance, reader };
}

/**
 * V8.1-PROD-05B (G1, G2) — precondición documental, ANTES de cualquier escritura.
 * `docsStatus` = `acceptanceDocumentsStatus()` (CHP_ACCEPTANCE_DOCUMENTS). El comprador B2C activa
 * una cuenta de lector: necesita 001, 002 y 004 (= `requiredDocumentIds` de un lector). Una compra que
 * no se podría activar no se aprovisiona (503 DOCUMENTS_NOT_APPROVED); la tienda reintenta cuando
 * Dirección los apruebe. La aceptación del checkout solo vale para el 002 aprobado con esa versión.
 */
export const B2C_REQUIRED_DOCUMENTS = Object.freeze(['001', '002', '004']);
export function assertB2cDocumentsApproved({ docsStatus, termsAcceptance = null }) {
    const docs = Array.isArray(docsStatus) ? docsStatus : [];
    const approved = (id) => docs.find(d => d && d.id === id && d.approved === true);
    if (!B2C_REQUIRED_DOCUMENTS.every(approved)) throw new B2cError(503, 'DOCUMENTS_NOT_APPROVED');
    if (termsAcceptance) {
        const terms = approved(ACCEPTANCE_DOCUMENTS.terms.id);
        if (!terms || terms.version !== termsAcceptance.version) throw new B2cError(400, 'invalid_terms_acceptance');
    }
}

/** Plantilla B2C vigente (lista maestra). Se comprueba antes de escribir y de nuevo bajo el lock. */
export function b2cTemplateRule(rules) {
    const template = (Array.isArray(rules) ? rules : []).find(r => r && r.id === B2C_TEMPLATE_RULE_ID);
    if (!template || !Array.isArray(template.titleIds) || template.titleIds.length === 0) throw new B2cError(503, 'template_rule_missing');
    return template;
}

/** Valida la entrada de /revoke. */
export function validateRevokeInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const orderId = Number(b.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new B2cError(400, 'invalid_order_id');
    if (!B2C_SOURCES.includes(b.source)) throw new B2cError(400, 'invalid_source');
    if (b.idempotencyKey !== idempotencyKeyFor(b.source, orderId)) throw new B2cError(400, 'invalid_idempotency_key');
    const reason = ['refunded', 'cancelled', 'manual'].includes(b.reason) ? b.reason : 'manual';
    return { orderId, source: b.source, idempotencyKey: b.idempotencyKey, reason, dryRun: b.dryRun === true };
}

const isActiveB2cRuleFor = (rule, userId, nowMs) =>
    rule && rule.b2c && rule.scope === 'user' && rule.scopeId === userId &&
    (typeof rule.expiresAt !== 'number' || rule.expiresAt > nowMs);

/**
 * Fase 1 (bajo el lock de usuarios): resuelve la identidad. Pura: devuelve la mutación.
 *
 * @returns {{ status, userId, userOp: 'create'|'regenerate_token'|'none', user, activationUrl, reusedAccount }}
 */
export function planUserPhase({ users, rules, input, nowMs, normalizeEmail, normalizeUser, newUserId, newToken, newLoginId, termsOnFileFor }) {
    const ruleId = ruleIdFor(input.source, input.orderId);
    const existingRule = rules.find(r => r && r.id === ruleId);
    if (existingRule && existingRule.b2c?.idempotencyKey !== input.idempotencyKey) throw new B2cError(409, 'idempotency_mismatch');
    if (input.reader) return planRepresentedUserPhase({ users, rules, input, nowMs, normalizeEmail, normalizeUser, newUserId, newToken, newLoginId, termsOnFileFor, existingRule, ruleId });

    const email = normalizeEmail(input.email);
    let user = existingRule
        ? users.find(u => u && u.id === existingRule.scopeId)
        : users.find(u => u && normalizeEmail(u.email) === email);

    // V8.1-CLOSE-09B — reenvío firmado de un pedido cuya cuenta ya no existe (supresión: la regla
    // se conserva sin titular con `b2c.suppressedAt`; o baja): NUNCA se recrea ni se invita. Mismo
    // código que una cuenta no disponible, sin revelar nada del titular. Un pedido nuevo tiene otra
    // regla (id por pedido) y sigue el flujo normal.
    if (existingRule && (existingRule.b2c?.suppressedAt || !user)) throw new B2cError(409, 'account_not_available');
    // V9 F3-D1: un pedido aprovisionado para un lector representado no se reinterpreta sin `reader`.
    if (existingRule && user.loginId) throw new B2cError(409, 'idempotency_mismatch');
    if (!existingRule && user && rules.some(r => r && r.id !== ruleId && isActiveB2cRuleFor(r, user.id, nowMs))) {
        throw new B2cError(409, 'conflict_active_subscription');
    }
    if (user && !['active', 'invited'].includes(user.accountStatus || 'active')) throw new B2cError(409, 'account_not_available');

    const regen = (u) => ({ ...u, inviteToken: newToken, inviteExpiresAt: nowMs + B2C_INVITE_TTL_MS });
    if (!user) {
        const local = email.split('@')[0];
        const created = normalizeUser({
            id: newUserId, email, nombre_completo: input.fullName || local, nombre_usuario: local,
            roles: ['lector'], colegio: '', groupIds: [], avatar_url: '', bio_corta: '',
            libros_leidos: 0, seguidores: 0, seguidos: 0, nivel_lectura: 'Novato',
            accountStatus: 'invited', inviteToken: newToken, inviteExpiresAt: nowMs + B2C_INVITE_TTL_MS,
            b2c: true, createdVia: 'b2c-provision',
        });
        return { status: existingRule ? 'already_activated' : 'activated', userId: newUserId, userOp: 'create', user: created,
            activationUrl: `/#/activar?token=${newToken}`, reusedAccount: false };
    }
    if ((user.accountStatus || 'active') === 'invited') {
        // Invitación pendiente (cuenta nueva o respuesta perdida): enlace nuevo, el anterior deja de valer.
        return { status: existingRule ? 'already_activated' : 'activated', userId: user.id, userOp: 'regenerate_token', user: regen(user),
            activationUrl: `/#/activar?token=${newToken}`, reusedAccount: !existingRule && !user.b2c };
    }
    // V8.1-PROD-05B (G3): una cuenta YA ACTIVA no pasa por la activación, así que una compra nueva solo
    // le da acceso con T de los términos exigibles: la del checkout o una previa vigente de esa misma
    // versión (`termsOnFileFor` → true/false; null = registro no verificable). Sin dato ⇒ fallo cerrado.
    // Reintento de un pedido ya aprovisionado: sin cambio (idempotencia).
    if (!existingRule && !input.termsAcceptance) {
        const onFile = typeof termsOnFileFor === 'function' ? termsOnFileFor(user.id) : false;
        if (onFile === null) throw new B2cError(503, 'acceptance_registry_unavailable');
        if (onFile !== true) throw new B2cError(422, 'terms_acceptance_required');
    }
    return { status: existingRule ? 'already_activated' : 'activated', userId: user.id, userOp: 'none', user,
        activationUrl: null, reusedAccount: true };
}

/**
 * V9 F3-D1 — fase 1 para un lector menor representado (`input.reader`). Pura.
 *
 * Resolución de la cuenta, sin usar nunca el correo como identidad:
 *  1. el pedido ya tiene regla ⇒ su cuenta (reintento o reenvío: idempotencia por pedido);
 *  2. `reader.loginId` ⇒ esa cuenta SOLO si es representada y su contacto es el del pedido. Usuario
 *     inexistente, ajeno o de una cuenta no representada: la MISMA respuesta (409 `account_not_available`),
 *     sin datos de nadie;
 *  3. sin `loginId` ⇒ la cuenta que este mismo pedido ya creó (`b2cOrigin`: un fallo entre crear la
 *     cuenta y su regla no duplica cuentas en el reintento) o, si no existe, una cuenta nueva.
 * Cuenta ya ACTIVA + pedido nuevo: exige T EFECTIVA en el registro (representación verificada por
 * GVA). Una T declarada y sin verificar no basta ⇒ 422 y revisión manual. Aquí no se anota ninguna
 * decisión: pagar no acredita representación ni consentimiento.
 */
function planRepresentedUserPhase({ users, rules, input, nowMs, normalizeEmail, normalizeUser, newUserId, newToken, newLoginId, termsOnFileFor, existingRule, ruleId }) {
    const contact = normalizeEmail(input.email);
    const linked = (u) => isRepresentedAccount(u) && normalizeEmail(u.representedBy.email) === contact;
    let user = null;
    if (existingRule) {
        user = users.find(u => u && u.id === existingRule.scopeId);
        if (existingRule.b2c?.suppressedAt || !user) throw new B2cError(409, 'account_not_available');
        if (!linked(user) || (input.reader.loginId && input.reader.loginId !== user.loginId)) throw new B2cError(409, 'idempotency_mismatch');
    } else if (input.reader.loginId) {
        user = users.find(u => u && u.loginId === input.reader.loginId);
        if (!linked(user)) throw new B2cError(409, 'account_not_available');
    } else {
        user = users.find(u => u && u.b2cOrigin === input.idempotencyKey) || null;
        if (user && !linked(user)) throw new B2cError(409, 'idempotency_mismatch');
    }
    if (user && !['active', 'invited'].includes(user.accountStatus || 'active')) throw new B2cError(409, 'account_not_available');
    if (user && !existingRule && rules.some(r => r && r.id !== ruleId && isActiveB2cRuleFor(r, user.id, nowMs))) {
        throw new B2cError(409, 'conflict_active_subscription');
    }
    const status = existingRule ? 'already_activated' : 'activated';
    if (!user) {
        // Usuario de acceso: aleatorio (no deriva del nombre) y único frente a usuarios, correos e ids existentes.
        let loginId = null;
        for (let i = 0; i < 8 && !loginId; i++) {
            const c = typeof newLoginId === 'function' ? newLoginId() : null;
            if (typeof c === 'string' && B2C_LOGIN_ID_RX.test(c) && !users.some(u => u && (u.loginId === c || u.id === c || normalizeEmail(u.email) === c))) loginId = c;
        }
        if (!loginId) throw new B2cError(503, 'login_id_unavailable');
        const created = normalizeUser({
            id: newUserId, email: '', loginId, representedBy: { email: contact },
            nombre_completo: input.reader.name || 'Lector', nombre_usuario: loginId,
            roles: ['lector'], colegio: '', groupIds: [], avatar_url: '', bio_corta: '',
            libros_leidos: 0, seguidores: 0, seguidos: 0, nivel_lectura: 'Novato',
            accountStatus: 'invited', inviteToken: newToken, inviteExpiresAt: nowMs + B2C_INVITE_TTL_MS,
            b2c: true, createdVia: 'b2c-provision', b2cOrigin: input.idempotencyKey,
        });
        return { status, userId: newUserId, userOp: 'create', user: created, loginId,
            activationUrl: `/#/activar?token=${newToken}`, reusedAccount: false };
    }
    if ((user.accountStatus || 'active') === 'invited') {
        return { status, userId: user.id, userOp: 'regenerate_token', loginId: user.loginId,
            user: { ...user, inviteToken: newToken, inviteExpiresAt: nowMs + B2C_INVITE_TTL_MS },
            activationUrl: `/#/activar?token=${newToken}`, reusedAccount: !existingRule && user.b2cOrigin !== input.idempotencyKey };
    }
    if (!existingRule) {
        const onFile = typeof termsOnFileFor === 'function' ? termsOnFileFor(user.id) : false;
        if (onFile === null) throw new B2cError(503, 'acceptance_registry_unavailable');
        if (onFile !== true) throw new B2cError(422, 'terms_acceptance_required');
    }
    return { status, userId: user.id, userOp: 'none', user, loginId: user.loginId, activationUrl: null, reusedAccount: true };
}

/**
 * Fase 2 (bajo el lock de accesos): crea la regla del pedido si no existe. Pura.
 * Vuelve a comprobar existencia y conflicto con el estado fresco (carreras entre contenedores).
 */
export function planRulePhase({ rules, input, userId, nowMs }) {
    const ruleId = ruleIdFor(input.source, input.orderId);
    const existing = rules.find(r => r && r.id === ruleId);
    if (existing) {
        if (existing.b2c?.idempotencyKey !== input.idempotencyKey || existing.scopeId !== userId) throw new B2cError(409, 'idempotency_mismatch');
        return { ruleOp: 'none', rule: existing };
    }
    if (rules.some(r => r && isActiveB2cRuleFor(r, userId, nowMs))) throw new B2cError(409, 'conflict_active_subscription');
    const template = b2cTemplateRule(rules);
    const expiresAt = computeExpiresAt(input.activationAt);
    const rule = {
        id: ruleId, scope: 'user', scopeId: userId,
        titleIds: template.titleIds.filter(id => typeof id === 'string'),
        collectionIds: [],
        expiresAt,
        b2c: { orderId: input.orderId, productId: input.productId, plan: input.plan, source: input.source,
            idempotencyKey: input.idempotencyKey, activationAt: input.activationAt, expiresAt, createdAt: nowMs,
            templateRuleId: B2C_TEMPLATE_RULE_ID },
    };
    return { ruleOp: 'create', rule };
}

/** Revocación: solo la regla del pedido; idempotente; nunca borra. Pura. */
export function planRevoke({ rules, input, nowMs }) {
    const ruleId = ruleIdFor(input.source, input.orderId);
    const rule = rules.find(r => r && r.id === ruleId);
    if (!rule) throw new B2cError(404, 'rule_not_found');
    if (rule.b2c?.idempotencyKey !== input.idempotencyKey) throw new B2cError(409, 'idempotency_mismatch');
    if (rule.b2c?.revokedAt) return { status: 'already_revoked', ruleOp: 'none', rule };
    const expiresAt = typeof rule.expiresAt === 'number' ? Math.min(rule.expiresAt, nowMs) : nowMs;
    return { status: 'revoked', ruleOp: 'update',
        rule: { ...rule, expiresAt, b2c: { ...rule.b2c, revokedAt: nowMs, revokeReason: input.reason } } };
}

/**
 * Sincronización del catálogo B2C: copia los `titleIds` de la plantilla a las reglas de pedido
 * NO vencidas. Idempotente. Se ejecuta después de añadir una obra a `access-b2c-lectores`.
 */
export function planTitleSync({ rules, nowMs }) {
    const template = rules.find(r => r && r.id === B2C_TEMPLATE_RULE_ID);
    if (!template || !Array.isArray(template.titleIds) || template.titleIds.length === 0) throw new B2cError(503, 'template_rule_missing');
    const target = JSON.stringify([...template.titleIds]);
    let updated = 0;
    const next = rules.map(r => {
        if (!r || !r.b2c || r.scope !== 'user' || (typeof r.expiresAt === 'number' && r.expiresAt <= nowMs)) return r;
        if (JSON.stringify(r.titleIds || []) === target) return r;
        updated++;
        return { ...r, titleIds: [...template.titleIds], b2c: { ...r.b2c, titlesSyncedAt: nowMs } };
    });
    return { updated, rules: next };
}
