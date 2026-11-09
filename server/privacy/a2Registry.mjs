/**
 * a2Registry.mjs — CHP-V8.1-CLOSE-01 (G-02) · V8.1-CLOSE-05 (DIR-V81-01).
 *
 * Registro de decisiones verificables de aceptación y autorización. Un único
 * archivo append-only (`CHP_A2_REGISTRY`, sin valor por defecto) con una línea
 * autenticada por decisión. Como el registro de exclusiones (PRIV-01D), vive
 * fuera del inventario de respaldos: una restauración no reabre una decisión
 * retirada.
 *
 * Línea: `{id, s, k, a, d, e, v, w, q, x, u, r, m}`
 *   s  sujeto: HMAC del id de la cuenta (o de la organización para C003); nunca en claro
 *   k  tipo de decisión: T (002 + oferta), A0, A1, A2 (004), C003 (acuerdo institucional), C005 (mediador)
 *   a  granted | denied | revoked
 *   d  día de la anotación (servidor) · e  día del acto, aportado por la evidencia (≤ d)
 *   v  documento y versión (`004@1.0`) · w  medio · q  calidad de quien decide
 *   x  verificación: self_authenticated | verified | unverified
 *   u  vigencia opcional · r  referencia opaca y verificable · m  MAC
 * Por sujeto y tipo vale la ÚLTIMA línea. Sin línea ⇒ pendiente.
 *
 * Una decisión es EFECTIVA solo si es `granted`, está vigente y su verificación
 * es `verified` (GVA/VER sobre la ficha C.1) o `self_authenticated` (titular
 * adulto o mediador sobre su propia cuenta, en la plataforma). Lo declarado por
 * un representante en la plataforma queda `unverified` hasta que GVA lo verifique
 * (006 P03: el pago o el parentesco no acreditan representación).
 *
 * A1 no se infiere de la cuenta activa; A2 no se infiere de A1 ni de un C003.
 *
 * Fallo cerrado: sin ruta, sin clave, ilegible o con cualquier línea alterada ⇒
 * `A2_REGISTRY_UNAVAILABLE` y ninguna decisión efectiva.
 *
 * Escritura: el operador (stdin dentro de la réplica) o la activación de cuenta
 * (`POST /api/accept-invite`), que solo registra las decisiones de quien activa.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSubjectKey, loadSubjectKey } from '../gamification/subjectKey.mjs';

export const A2_STATUSES = Object.freeze(['granted', 'denied', 'revoked']);
export const DECISION_KINDS = Object.freeze(['T', 'A0', 'A1', 'A2', 'C003', 'C005']);
export const MEDIA = Object.freeze(['in_app', 'paper', 'electronic_signature', 'verifiable_message', 'admin_record']);
export const CAPACITIES = Object.freeze(['titular', 'legal_representative', 'institution', 'mediator']);
export const VERIFICATIONS = Object.freeze(['self_authenticated', 'verified', 'unverified']);
/** Mínimo de lectores retenidos para publicar detalle del resto (mismo umbral k que los agregados). */
export const A2_MIN_WITHHELD = 5;

const REF_RX = /^[A-Za-z0-9._:-]{1,128}$/;
const VERSION_RX = /^[0-9]{3}@[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const BOGOTA_OFFSET_MS = 5 * 3_600_000;

const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
const registryKey = () => hmac(getSubjectKey(), 'chp-a2-registry-v2');
const subjectKey = () => hmac(getSubjectKey(), 'chp-a2-reader-v1');
const FIELDS = ['id', 's', 'k', 'a', 'd', 'e', 'v', 'w', 'q', 'x', 'u', 'r'];
const entryMac = (e) => hmac(registryKey(), FIELDS.map((f) => String(e[f] ?? '')).join('\0')).toString('hex');

class A2Error extends Error {
    constructor(code) { super(code); this.name = 'A2Error'; this.code = code; }
}
const unavailable = () => new A2Error('A2_REGISTRY_UNAVAILABLE');

/** Día civil en Bogotá (`YYYY-MM-DD`). */
export const dayOf = (ms) => new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);

const subjectRef = (id) => hmac(subjectKey(), id).toString('hex');
const slot = (s, k) => `${s}\0${k}`;

/** Carga la clave de verificación (la de sujeto, por su archivo de secreto). Sin ella, fallo cerrado. */
export const loadA2Key = () => loadSubjectKey();

function registryPath(env) {
    const raw = env.CHP_A2_REGISTRY ?? process.env.CHP_A2_REGISTRY;
    if (!raw) throw unavailable();
    const p = path.resolve(raw);
    const excl = env.GAMIFICATION_EXCLUSION_REGISTRY ?? process.env.GAMIFICATION_EXCLUSION_REGISTRY;
    if (excl && path.resolve(excl) === p) throw new A2Error('A2_REGISTRY_NOT_INDEPENDENT');
    return p;
}

/** Último estado por sujeto y tipo. Cualquier línea alterada o incompleta invalida el conjunto. */
export function readDecisions(env = process.env) {
    const p = registryPath(env);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); } catch { throw unavailable(); }
    try { getSubjectKey(); } catch { throw unavailable(); } // la clave se exige aunque el registro esté vacío
    const out = new Map();
    if (raw === '') return out;
    if (!raw.endsWith('\n')) throw unavailable();
    for (const line of raw.slice(0, -1).split('\n')) {
        let e;
        try { e = JSON.parse(line); } catch { throw unavailable(); }
        if (!e || typeof e !== 'object' || !A2_STATUSES.includes(e.a) || !DECISION_KINDS.includes(e.k)) throw unavailable();
        const mac = Buffer.from(String(e.m ?? ''), 'hex');
        const expected = Buffer.from(entryMac(e), 'hex');
        if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) throw unavailable();
        out.set(slot(e.s, e.k), { status: e.a, validUntil: e.u ?? null, verification: e.x, actDay: e.e, version: e.v, medium: e.w, capacity: e.q });
    }
    return out;
}

/** Último estado A2 por lector (compatibilidad CLOSE-01..03). */
export function readA2Registry(env = process.env) {
    const out = new Map();
    for (const [key, st] of readDecisions(env)) {
        const [s, k] = key.split('\0');
        if (k === 'A2') out.set(s, st);
    }
    return out;
}

function validateDecision(d, today) {
    const bad = (code) => { throw new A2Error(code); };
    if (typeof d?.subjectId !== 'string' || !d.subjectId) bad('INVALID_USER');
    if (!DECISION_KINDS.includes(d.kind)) bad('INVALID_KIND');
    if (!A2_STATUSES.includes(d.status)) bad('INVALID_STATUS');
    if (typeof d.requestRef !== 'string' || !REF_RX.test(d.requestRef)) bad('INVALID_REQUEST_REF');
    if (typeof d.version !== 'string' || !VERSION_RX.test(d.version)) bad('INVALID_VERSION');
    if (!MEDIA.includes(d.medium)) bad('INVALID_MEDIUM');
    if (!CAPACITIES.includes(d.capacity)) bad('INVALID_CAPACITY');
    if (!VERIFICATIONS.includes(d.verification)) bad('INVALID_VERIFICATION');
    // La fecha del acto la aporta la evidencia: nunca futura, nunca por defecto.
    if (typeof d.actDay !== 'string' || !DAY_RX.test(d.actDay) || Number.isNaN(Date.parse(d.actDay)) || d.actDay > today) bad('INVALID_ACT_DATE');
    if (d.validUntil != null && (d.status !== 'granted' || typeof d.validUntil !== 'string' || !DAY_RX.test(d.validUntil))) bad('INVALID_VALID_UNTIL');
    // Combinaciones: la autoverificación solo cabe en la plataforma y sobre la propia cuenta.
    if (d.verification === 'self_authenticated' && (d.medium !== 'in_app' || !['titular', 'mediator'].includes(d.capacity))) bad('INVALID_VERIFICATION');
    if (d.kind === 'A0' && d.capacity !== 'legal_representative') bad('INVALID_CAPACITY');
    if (d.kind === 'C003' && d.capacity !== 'institution') bad('INVALID_CAPACITY');
    if (d.kind === 'C005' && d.capacity !== 'mediator') bad('INVALID_CAPACITY');
    if (d.kind !== 'C003' && d.capacity === 'institution') bad('INVALID_CAPACITY');
}

/**
 * Anota decisiones en UNA escritura durable. Todas o ninguna: se validan antes de escribir.
 * @param {Array<{subjectId, kind, status, actDay, version, medium, capacity, verification, requestRef, validUntil?}>} decisions
 * @returns acuses sin datos personales
 */
export function appendDecisions(decisions, { env = process.env, now = Date.now() } = {}) {
    if (!Array.isArray(decisions) || decisions.length === 0) throw new A2Error('NO_DECISIONS');
    const today = dayOf(now);
    for (const d of decisions) validateDecision(d, today);
    readDecisions(env); // nunca se añade a un registro que no se puede verificar
    const p = registryPath(env);
    const lines = decisions.map((d) => {
        const e = { id: crypto.randomUUID(), s: subjectRef(d.subjectId), k: d.kind, a: d.status, d: today, e: d.actDay, v: d.version,
            w: d.medium, q: d.capacity, x: d.verification, u: d.validUntil ?? null, r: d.requestRef };
        return { e, line: `${JSON.stringify({ ...e, m: entryMac(e) })}\n` };
    });
    const fd = fs.openSync(p, 'a');
    try {
        fs.writeSync(fd, lines.map((l) => l.line).join(''));
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    return lines.map(({ e }) => ({ entryId: e.id, kind: e.k, status: e.a, day: e.d, actDay: e.e, verification: e.x, validUntil: e.u }));
}

/**
 * Compatibilidad CLOSE-01..03: decisión A2 ya verificada sobre la ficha C.1.
 * Sin fecha del acto aportada se usa el día de la anotación (la verificación es de hoy).
 */
export function appendA2Decision({ userId, status, requestRef, validUntil = null, actDay = null, version = '004@1.0', medium = 'admin_record', capacity = 'legal_representative' }, { env = process.env, now = Date.now() } = {}) {
    const [ack] = appendDecisions([{ subjectId: userId, kind: 'A2', status, requestRef, validUntil, actDay: actDay ?? dayOf(now),
        version, medium, capacity, verification: 'verified' }], { env, now });
    return { entryId: ack.entryId, status: ack.status, day: ack.day, validUntil: ack.validUntil };
}

const isEffective = (st, today) => !!st && st.status === 'granted' && ['verified', 'self_authenticated'].includes(st.verification)
    && (st.validUntil === null || today <= st.validUntil);

/**
 * Lectura de decisiones vigentes.
 * @throws A2_REGISTRY_UNAVAILABLE | A2_REGISTRY_NOT_INDEPENDENT
 */
export function decisionGate(env = process.env, now = Date.now()) {
    const registry = readDecisions(env);
    const today = dayOf(now);
    const stateOf = (kind, id) => (typeof id === 'string' && id ? registry.get(slot(subjectRef(id), kind)) ?? null : null);
    return {
        effective: (kind, id) => isEffective(stateOf(kind, id), today),
        /** pending | granted_unverified | effective | expired | denied | revoked */
        status: (kind, id) => {
            const st = stateOf(kind, id);
            if (!st) return 'pending';
            if (st.status !== 'granted') return st.status;
            if (!['verified', 'self_authenticated'].includes(st.verification)) return 'granted_unverified';
            return isEffective(st, today) ? 'effective' : 'expired';
        },
    };
}

/**
 * Puerta A2 vigente. `allows(userId)` solo es verdadero con A2 `granted`,
 * verificada y dentro de su vigencia (inclusive).
 * @throws A2_REGISTRY_UNAVAILABLE | A2_REGISTRY_NOT_INDEPENDENT
 */
export function a2Gate(env = process.env, now = Date.now()) {
    const gate = decisionGate(env, now);
    return { allows: (userId) => gate.effective('A2', userId) };
}

/**
 * Criterio ÚNICO de divulgación individual a quien consulta un grupo (G-02).
 * El llamador ya resolvió sesión, alcance y cohorte; aquí solo se decide A2.
 *  - `allowed`: lectores cuyo detalle individual puede mostrarse (A2 efectiva);
 *    registro no verificable ⇒ nadie (`unavailable`);
 *  - `aggregateOver`: con entre 1 y A2_MIN_WITHHELD − 1 lectores retenidos, restar el
 *    detalle publicado al agregado de la cohorte revelaría a los retenidos: los
 *    agregados se limitan entonces a `allowed`. Con 0 o ≥ A2_MIN_WITHHELD
 *    retenidos, o sin detalle publicado, se mantiene el agregado de la cohorte.
 * @param {string[]} cohort
 * @returns {{ status: 'ok'|'partial'|'unavailable', allowed: Set<string>, aggregateOver: 'cohort'|'allowed' }}
 */
export function individualDisclosure(cohort, { env = process.env, now = Date.now() } = {}) {
    let gate;
    try { gate = a2Gate(env, now); } catch { return { status: 'unavailable', allowed: new Set(), aggregateOver: 'cohort' }; }
    const ids = [...new Set((cohort ?? []).filter((id) => typeof id === 'string' && id))];
    const allowed = new Set(ids.filter((id) => gate.allows(id)));
    const withheld = ids.length - allowed.size;
    if (withheld === 0) return { status: 'ok', allowed, aggregateOver: 'cohort' };
    const aggregateOver = allowed.size > 0 && withheld < A2_MIN_WITHHELD ? 'allowed' : 'cohort';
    return { status: 'partial', allowed, aggregateOver };
}
