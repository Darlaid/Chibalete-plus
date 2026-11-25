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
 *   t  instante de la anotación (servidor, ISO 8601 UTC); lo llevan las líneas escritas desde V9R-DEP1
 * Por sujeto y tipo vale la ÚLTIMA línea. Sin línea ⇒ pendiente.
 *
 * V9R-DEP1 — dos tipos más, ninguno es una autorización de tratamiento:
 *   P             aceptación expresa de la Política de tratamiento de datos (001) al activar la cuenta. Es una
 *                 constancia propia: no sustituye ni aporta T, A0–A5 ni C005.
 *   PILOT_LEGACY  condición de continuidad de los pilotos anteriores a V9. NO es un consentimiento, ni una
 *                 autorización parental, ni un compromiso 005: solo constata que una pertenencia (grupo + cuenta)
 *                 existía en el corte del inventario. Ver el bloque PILOT_LEGACY más abajo.
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
// V8.1-PROD-02B: A3 (Leo / IA) y A5 (transcripción de voz) del 004, independientes de A1/A2. A4 (LU) no tiene
// tratamiento opcional propio en esta plataforma: queda comprendido en A1 (ver el documento de la unidad).
export const DECISION_KINDS = Object.freeze(['T', 'A0', 'A1', 'A2', 'A3', 'A5', 'C003', 'C005', 'P', 'PILOT_LEGACY']);
// `checkout`: aceptación en la compra, recibida por la integración autenticada de la tienda (HMAC servidor a servidor).
export const MEDIA = Object.freeze(['in_app', 'paper', 'electronic_signature', 'verifiable_message', 'admin_record', 'checkout']);
export const CAPACITIES = Object.freeze(['titular', 'legal_representative', 'institution', 'mediator']);
export const VERIFICATIONS = Object.freeze(['self_authenticated', 'verified', 'unverified']);

// ── V9R-DEP1 · PILOT_LEGACY ──────────────────────────────────────────────────
// Régimen cerrado de continuidad. Una línea por PERTENENCIA existente en el corte (sujeto = grupo + cuenta) y una
// línea de SELLO que cierra la carga:
//   - nada rige hasta que existe el sello; desde el sello no se admite ni se lee ninguna concesión nueva (tampoco
//     otro sello): ninguna cuenta, curso o institución posterior puede obtener la condición;
//   - cada línea admite solo `granted` y `revoked`; revocar una pertenencia la cierra para siempre, y revocar el
//     sello termina el régimen entero; `u` (vigencia) lo hace caducar solo;
//   - su verificación es `inventory` (cotejo con el inventario del corte): nunca `verified` ni `self_authenticated`,
//     así que `effective()` jamás la toma por una decisión de consentimiento, y ningún otro tipo puede declararla.
// Qué conserva, y solo dentro de ESE grupo y mientras la pertenencia siga existiendo hoy:
//   pilot_mediator         en lugar del C005 del mediador: nómina y resumen de ese grupo;
//   pilot_reader           el lector figura en la nómina que ve ese mediador (sin detalle individual);
//   pilot_reader_followup  además, en lugar de su A2: el seguimiento individual HISTÓRICO por ese mediador.
// «Histórico» = lo que el mediador ya consultaba en la versión anterior a V9: progreso de lectura, estado del lector,
// filas del resumen y del tablero del curso, intervenciones del tablero, revisión y exportación de entregas. Cada una
// de esas funciones lo pide de forma expresa (`pilot: true`); `a2Gate` NO lo aplica por defecto, así que ninguna
// función nueva lo hereda por reutilizar el criterio de A2.
// Qué NO abre, nunca: Leo e IA (A3) ni las vistas de Leo del mediador, transcripción de voz (A5), XP (A1), términos
// (T), candidatos y diagnóstico del grupo, la analítica derivada de Aula Viva (indicadores contextuales, riesgo,
// recomendaciones, impacto, cohortes, trayectorias, patrones, perfil y línea de tiempo), ni nada sobre un lector o
// un grupo sin su propia línea. Una negativa o revocación expresa de A2 (lector) o de
// C005 (mediador) prevalece siempre sobre la condición de piloto.
export const PILOT_KIND = 'PILOT_LEGACY';
export const PILOT_VERSION = 'PILOT@1.0';
export const PILOT_VERIFICATION = 'inventory';
export const PILOT_MEDIUM = 'admin_record';
export const PILOT_CAPACITIES = Object.freeze(['pilot_mediator', 'pilot_reader', 'pilot_reader_followup', 'pilot_seal']);
const PILOT_PREFIX = 'pilot-legacy\u001f';
export const PILOT_SEAL_SUBJECT = `${PILOT_PREFIX}seal`;
/** Sujeto de una pertenencia del corte. Nunca coincide con el id de una cuenta ni de una organización. */
export const pilotSubject = (groupId, userId) => `${PILOT_PREFIX}membership\u001f${groupId}\u001f${userId}`;
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
// `t` entra en el MAC solo cuando la línea lo trae: las líneas anteriores siguen verificando y no se puede añadir ni quitar.
const entryMac = (e) => hmac(registryKey(), [...FIELDS, ...(e.t != null ? ['t'] : [])].map((f) => String(e[f] ?? '')).join('\0')).toString('hex');

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
    const sealSlot = slot(subjectRef(PILOT_SEAL_SUBJECT), PILOT_KIND);
    for (const line of raw.slice(0, -1).split('\n')) {
        let e;
        try { e = JSON.parse(line); } catch { throw unavailable(); }
        if (!e || typeof e !== 'object' || !A2_STATUSES.includes(e.a) || !DECISION_KINDS.includes(e.k)) throw unavailable();
        const mac = Buffer.from(String(e.m ?? ''), 'hex');
        const expected = Buffer.from(entryMac(e), 'hex');
        if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) throw unavailable();
        // PILOT_LEGACY: desde el sello el régimen está cerrado. Una concesión posterior no se lee (ni otro sello).
        if (e.k === PILOT_KIND && e.a === 'granted' && out.has(sealSlot)) continue;
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
    if (d.kind === PILOT_KIND) {
        // Forma única y cerrada: nunca con la calidad, el medio ni la verificación de un consentimiento.
        if (d.status === 'denied') bad('INVALID_STATUS');
        if (d.version !== PILOT_VERSION) bad('INVALID_VERSION');
        if (d.medium !== PILOT_MEDIUM) bad('INVALID_MEDIUM');
        if (!PILOT_CAPACITIES.includes(d.capacity)) bad('INVALID_CAPACITY');
        if (d.verification !== PILOT_VERIFICATION) bad('INVALID_VERIFICATION');
        if ((d.capacity === 'pilot_seal') !== (d.subjectId === PILOT_SEAL_SUBJECT)) bad('INVALID_USER');
        if (d.capacity !== 'pilot_seal' && !d.subjectId.startsWith(`${PILOT_PREFIX}membership\u001f`)) bad('INVALID_USER');
    } else {
        if (typeof d.version !== 'string' || !VERSION_RX.test(d.version)) bad('INVALID_VERSION');
        if (!MEDIA.includes(d.medium)) bad('INVALID_MEDIUM');
        if (!CAPACITIES.includes(d.capacity)) bad('INVALID_CAPACITY');
        if (!VERIFICATIONS.includes(d.verification)) bad('INVALID_VERIFICATION');
        if (d.subjectId.startsWith(PILOT_PREFIX)) bad('INVALID_USER');
    }
    // La fecha del acto la aporta la evidencia: nunca futura, nunca por defecto.
    if (typeof d.actDay !== 'string' || !DAY_RX.test(d.actDay) || Number.isNaN(Date.parse(d.actDay)) || d.actDay > today) bad('INVALID_ACT_DATE');
    if (d.validUntil != null && (d.status !== 'granted' || typeof d.validUntil !== 'string' || !DAY_RX.test(d.validUntil))) bad('INVALID_VALID_UNTIL');
    // Combinaciones: la autoverificación solo cabe en la plataforma y sobre la propia cuenta.
    if (d.verification === 'self_authenticated' && (d.medium !== 'in_app' || !['titular', 'mediator'].includes(d.capacity))) bad('INVALID_VERIFICATION');
    if (d.kind === 'A0' && d.capacity !== 'legal_representative') bad('INVALID_CAPACITY');
    if (d.kind === 'C003' && d.capacity !== 'institution') bad('INVALID_CAPACITY');
    if (d.kind === 'C005' && d.capacity !== 'mediator') bad('INVALID_CAPACITY');
    if (d.kind !== 'C003' && d.capacity === 'institution') bad('INVALID_CAPACITY');
    // P (001): la acepta quien activa la cuenta, por sí o como representante; nunca una institución ni «mediator».
    if (d.kind === 'P' && !['titular', 'legal_representative'].includes(d.capacity)) bad('INVALID_CAPACITY');
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
    const current = readDecisions(env); // nunca se añade a un registro que no se puede verificar
    // PILOT_LEGACY: con el sello puesto (aunque esté revocado) no se concede nada más; en el lote, el sello va al final.
    const pilotGrants = decisions.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === PILOT_KIND && d.status === 'granted');
    if (pilotGrants.length) {
        if (current.has(slot(subjectRef(PILOT_SEAL_SUBJECT), PILOT_KIND))) throw new A2Error('PILOT_LEGACY_SEALED');
        const seal = pilotGrants.find(({ d }) => d.capacity === 'pilot_seal');
        if (seal && pilotGrants.some(({ i }) => i > seal.i)) throw new A2Error('PILOT_LEGACY_SEALED');
    }
    const p = registryPath(env);
    const at = new Date(now).toISOString();
    const lines = decisions.map((d) => {
        const e = { id: crypto.randomUUID(), s: subjectRef(d.subjectId), k: d.kind, a: d.status, d: today, e: d.actDay, v: d.version,
            w: d.medium, q: d.capacity, x: d.verification, u: d.validUntil ?? null, r: d.requestRef, t: at };
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
    const pilotLive = (st, capacities) => !!st && st.status === 'granted' && st.verification === PILOT_VERIFICATION && st.version === PILOT_VERSION
        && capacities.includes(st.capacity) && (st.validUntil === null || today <= st.validUntil);
    let sealed = null;
    const pilotSealed = () => (sealed ??= pilotLive(stateOf(PILOT_KIND, PILOT_SEAL_SUBJECT), ['pilot_seal']));
    return {
        /**
         * V9R-DEP1 — ¿esa pertenencia (grupo + cuenta) tiene la condición PILOT_LEGACY vigente, con esa función?
         * `role`: 'mediator' | 'reader' (figura en la nómina) | 'followup' (seguimiento individual).
         * Solo con el régimen sellado y vigente. No comprueba que la pertenencia siga existiendo hoy: eso lo
         * decide el llamador con los grupos actuales.
         */
        pilot: (role, groupId, userId) => {
            if (typeof groupId !== 'string' || !groupId || typeof userId !== 'string' || !userId || !pilotSealed()) return false;
            const capacities = role === 'mediator' ? ['pilot_mediator'] : role === 'reader' ? ['pilot_reader', 'pilot_reader_followup']
                : role === 'followup' ? ['pilot_reader_followup'] : [];
            return pilotLive(stateOf(PILOT_KIND, pilotSubject(groupId, userId)), capacities);
        },
        effective: (kind, id) => isEffective(stateOf(kind, id), today),
        /** Última línea (versión, medio, calidad…) o null. Solo para decidir; nunca sale del servidor. */
        state: (kind, id) => stateOf(kind, id),
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
 * V8.1-CLOSE-06A (G-01) — puerta A1 para emitir XP. `allowsAt(userId, atMs)` solo
 * es verdadero con A1 `granted`, verificada (o del titular adulto autenticado),
 * vigente HOY y con fecha del acto ≤ el día del hecho: una autorización posterior
 * no habilita hechos anteriores (prospectiva, como las reglas D48).
 * @throws A2_REGISTRY_UNAVAILABLE | A2_REGISTRY_NOT_INDEPENDENT
 */
export function a1Gate(env = process.env, now = Date.now()) {
    const registry = readDecisions(env);
    const today = dayOf(now);
    return {
        allowsAt: (userId, atMs) => {
            if (typeof userId !== 'string' || !userId || !Number.isFinite(atMs)) return false;
            const st = registry.get(slot(subjectRef(userId), 'A1'));
            return isEffective(st, today) && st.actDay <= dayOf(atMs);
        },
    };
}

/**
 * Puerta A2 vigente. `allows(userId)` solo es verdadero con A2 `granted`,
 * verificada y dentro de su vigencia (inclusive). Con `mediatorId`, exige además
 * C005 efectivo del mediador (consulta institucional por un mediador).
 * V9R-DEP1: con `pilot: true` (solo funciones históricas, ver PILOT_LEGACY arriba) admite además la pareja
 * mediador–lector de un piloto anterior a V9. Por defecto es `false`: una función nueva exige A2 y C005.
 * @throws A2_REGISTRY_UNAVAILABLE | A2_REGISTRY_NOT_INDEPENDENT
 */
export function a2Gate(env = process.env, now = Date.now(), { mediatorId = null, pilot = false } = {}) {
    const gate = decisionGate(env, now);
    // V8.1-CLOSE-07B (G-07): para un mediador, además su compromiso 005 (C005) efectivo y
    // vigente: la vigencia del 005 caduca sola y su retiro rige en la petición siguiente.
    const mediatorOk = mediatorId === null || gate.effective('C005', mediatorId);
    // V9R-DEP1: o bien la pareja mediador–lector es de un piloto anterior a V9 (mismo grupo, las dos pertenencias
    // en el corte y vigentes hoy, el lector con seguimiento). Se calcula una vez por puerta, y solo si hace falta.
    let followup = null;
    const pilotAllows = (userId) => {
        if (pilot !== true || mediatorId === null || typeof userId !== 'string' || !userId) return false;
        if (pilotRefused(gate, 'A2', userId)) return false;
        followup ??= pilotFollowupReaders(gate, mediatorId);
        return followup.has(userId);
    };
    return { allows: (userId) => (mediatorOk && gate.effective('A2', userId)) || pilotAllows(userId) };
}

// ── V9R-DEP1 · PILOT_LEGACY: lectura ─────────────────────────────────────────

/** Una negativa o revocación expresa prevalece sobre la condición de piloto. */
const pilotRefused = (gate, kind, id) => ['denied', 'revoked'].includes(gate.status(kind, id));

/**
 * Grupos que una cuenta media HOY, con su nómina de hoy: `(mediatorId) => [{ groupId, memberIds }]`. Lo aporta el
 * servidor (la fuente de identidad es suya); sin él, o si falla, la condición de piloto no concede nada.
 */
let pilotScopeResolver = null;
export function setPilotScopeResolver(fn) { pilotScopeResolver = typeof fn === 'function' ? fn : null; }
const mediatedToday = (mediatorId) => {
    if (!pilotScopeResolver) return [];
    try { return (pilotScopeResolver(mediatorId) ?? []).filter((g) => g && typeof g.groupId === 'string'); } catch { return []; }
};

/**
 * Nóminas de piloto de un mediador: por cada grupo que media hoy y cuya pertenencia es del corte, los miembros de
 * hoy cuya pertenencia a ESE grupo también lo es. Un lector o un grupo sin su línea no aparece.
 * @returns {Map<string, Set<string>>} groupId → lectores
 */
export function pilotRosters(gate, mediatorId) {
    const out = new Map();
    if (typeof mediatorId !== 'string' || !mediatorId || pilotRefused(gate, 'C005', mediatorId)) return out;
    for (const g of mediatedToday(mediatorId)) {
        if (!gate.pilot('mediator', g.groupId, mediatorId)) continue;
        out.set(g.groupId, new Set((g.memberIds ?? []).filter((id) => gate.pilot('reader', g.groupId, id))));
    }
    return out;
}

/**
 * ¿Ese mediador conserva, por PILOT_LEGACY, la nómina y el resumen de ESE grupo? Solo si lo media HOY, su
 * pertenencia es del corte y su C005 no está negado ni revocado (las mismas condiciones que `pilotRosters`).
 */
export function pilotMediatorOf(gate, groupId, mediatorId) {
    return pilotRosters(gate, mediatorId).has(groupId);
}

/** Lectores cuyo seguimiento individual conserva ese mediador por PILOT_LEGACY (sin mirar A2: lo hace `a2Gate`). */
function pilotFollowupReaders(gate, mediatorId) {
    const out = new Set();
    for (const [groupId, readers] of pilotRosters(gate, mediatorId)) for (const id of readers) if (gate.pilot('followup', groupId, id)) out.add(id);
    return out;
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
export function individualDisclosure(cohort, { env = process.env, now = Date.now(), mediatorId = null, pilot = false } = {}) {
    let gate;
    try { gate = a2Gate(env, now, { mediatorId, pilot }); } catch { return { status: 'unavailable', allowed: new Set(), aggregateOver: 'cohort' }; }
    const ids = [...new Set((cohort ?? []).filter((id) => typeof id === 'string' && id))];
    const allowed = new Set(ids.filter((id) => gate.allows(id)));
    const withheld = ids.length - allowed.size;
    if (withheld === 0) return { status: 'ok', allowed, aggregateOver: 'cohort' };
    const aggregateOver = allowed.size > 0 && withheld < A2_MIN_WITHHELD ? 'allowed' : 'cohort';
    return { status: 'partial', allowed, aggregateOver };
}
