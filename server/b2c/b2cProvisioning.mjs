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
 * Autenticación: HMAC-SHA256 del cuerpo crudo con un secreto dedicado (file-only), marca de
 * tiempo con ventana de 300 s y comparación en tiempo constante. Nunca se registran correos,
 * tokens ni el secreto.
 */
import crypto from 'node:crypto';

export const B2C_TEMPLATE_RULE_ID = 'access-b2c-lectores';
export const B2C_PLANS = Object.freeze(['digital', 'mi_biblioteca']);
export const B2C_SOURCES = Object.freeze(['production', 'staging', 'test']);
export const B2C_TS_HEADER = 'x-chplus-b2c-timestamp';
export const B2C_SIG_HEADER = 'x-chplus-b2c-signature';
export const B2C_SIGNATURE_WINDOW_SEC = 300;
export const B2C_INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC-5, sin horario de verano
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
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
    return { orderId, productId, plan: b.plan, source: b.source, email: b.email, fullName, activationAt,
        idempotencyKey: b.idempotencyKey, dryRun: b.dryRun === true };
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
export function planUserPhase({ users, rules, input, nowMs, normalizeEmail, normalizeUser, newUserId, newToken }) {
    const ruleId = ruleIdFor(input.source, input.orderId);
    const existingRule = rules.find(r => r && r.id === ruleId);
    if (existingRule && existingRule.b2c?.idempotencyKey !== input.idempotencyKey) throw new B2cError(409, 'idempotency_mismatch');

    const email = normalizeEmail(input.email);
    let user = existingRule
        ? users.find(u => u && u.id === existingRule.scopeId)
        : users.find(u => u && normalizeEmail(u.email) === email);

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
    return { status: existingRule ? 'already_activated' : 'activated', userId: user.id, userOp: 'none', user,
        activationUrl: null, reusedAccount: true };
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
    const template = rules.find(r => r && r.id === B2C_TEMPLATE_RULE_ID);
    if (!template || !Array.isArray(template.titleIds) || template.titleIds.length === 0) throw new B2cError(503, 'template_rule_missing');
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
