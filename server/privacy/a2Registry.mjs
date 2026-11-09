/**
 * a2Registry.mjs — CHP-V8.1-CLOSE-01 (G-02).
 *
 * Fuente administrativa de la decisión A2 de cada lector (004 §9 A2, 006 §3.3):
 * consulta individual por parte de sus mediadores asignados. A2 es independiente
 * de A1 y del estado de cuenta: nunca se infiere de `accountStatus`, de la
 * membresía ni de otra decisión.
 *
 * Registro: archivo append-only cuya ruta da `CHP_A2_REGISTRY`, sin valor por
 * defecto. Igual que el registro de exclusiones (PRIV-01D), debe vivir fuera del
 * inventario de respaldos: una restauración no reabre una A2 retirada. Cada línea
 * lleva un MAC con clave derivada de la clave de sujeto (etiqueta propia) y el
 * lector se identifica por un HMAC, nunca por su id. Por lector vale la ÚLTIMA
 * línea: `granted` (con vigencia opcional), `denied` o `revoked`. Sin línea ⇒
 * pendiente.
 *
 * Fallo cerrado: sin ruta, sin clave, ilegible o con cualquier línea alterada ⇒
 * `A2_REGISTRY_UNAVAILABLE` y ninguna consulta individual.
 *
 * Escritura: solo operador (stdin dentro de la réplica, como `excludeUser`). No
 * hay ruta HTTP que escriba aquí.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSubjectKey, loadSubjectKey } from '../gamification/subjectKey.mjs';

export const A2_STATUSES = Object.freeze(['granted', 'denied', 'revoked']);
/** Mínimo de lectores retenidos para publicar detalle del resto (mismo umbral k que los agregados). */
export const A2_MIN_WITHHELD = 5;

const REF_RX = /^[A-Za-z0-9._:-]{1,128}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const BOGOTA_OFFSET_MS = 5 * 3_600_000;

const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
const registryKey = () => hmac(getSubjectKey(), 'chp-a2-registry-v1');
const readerKey = () => hmac(getSubjectKey(), 'chp-a2-reader-v1');
const FIELDS = ['id', 's', 'a', 'd', 'u', 'r'];
const entryMac = (e) => hmac(registryKey(), FIELDS.map((k) => String(e[k] ?? '')).join('\0')).toString('hex');

class A2Error extends Error {
    constructor(code) { super(code); this.name = 'A2Error'; this.code = code; }
}
const unavailable = () => new A2Error('A2_REGISTRY_UNAVAILABLE');

/** Día civil en Bogotá (`YYYY-MM-DD`). */
export const dayOf = (ms) => new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);

const readerRef = (userId) => hmac(readerKey(), userId).toString('hex');

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

/** Último estado por lector. Cualquier línea alterada o incompleta invalida el conjunto. */
export function readA2Registry(env = process.env) {
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
        if (!e || typeof e !== 'object' || !A2_STATUSES.includes(e.a)) throw unavailable();
        const mac = Buffer.from(String(e.m ?? ''), 'hex');
        const expected = Buffer.from(entryMac(e), 'hex');
        if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) throw unavailable();
        out.set(e.s, { status: e.a, validUntil: e.u ?? null });
    }
    return out;
}

/**
 * Anota una decisión A2 verificada por Administración. Escritura durable.
 * @param {{ userId: string, status: 'granted'|'denied'|'revoked', requestRef: string, validUntil?: string|null }} entry
 * @returns acuse sin datos personales
 */
export function appendA2Decision({ userId, status, requestRef, validUntil = null }, { env = process.env, now = Date.now() } = {}) {
    if (typeof userId !== 'string' || !userId) throw new A2Error('INVALID_USER');
    if (!A2_STATUSES.includes(status)) throw new A2Error('INVALID_STATUS');
    if (typeof requestRef !== 'string' || !REF_RX.test(requestRef)) throw new A2Error('INVALID_REQUEST_REF');
    if (validUntil !== null && (status !== 'granted' || typeof validUntil !== 'string' || !DAY_RX.test(validUntil))) throw new A2Error('INVALID_VALID_UNTIL');
    readA2Registry(env); // nunca se añade a un registro que no se puede verificar
    const p = registryPath(env);
    const e = { id: crypto.randomUUID(), s: readerRef(userId), a: status, d: dayOf(now), u: validUntil, r: requestRef };
    const fd = fs.openSync(p, 'a');
    try {
        fs.writeSync(fd, `${JSON.stringify({ ...e, m: entryMac(e) })}\n`);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    return { entryId: e.id, status, day: e.d, validUntil };
}

/**
 * Puerta A2 vigente. `allows(userId)` solo es verdadero con `granted` y dentro de
 * su vigencia (inclusive).
 * @throws A2_REGISTRY_UNAVAILABLE | A2_REGISTRY_NOT_INDEPENDENT
 */
export function a2Gate(env = process.env, now = Date.now()) {
    const registry = readA2Registry(env);
    const today = dayOf(now);
    return {
        allows: (userId) => {
            if (typeof userId !== 'string' || !userId) return false;
            const st = registry.get(readerRef(userId));
            return !!st && st.status === 'granted' && (st.validUntil === null || today <= st.validUntil);
        },
    };
}

/**
 * Criterio ÚNICO de divulgación individual a quien consulta un grupo (G-02).
 * El llamador ya resolvió sesión, alcance y cohorte; aquí solo se decide A2.
 *  - `allowed`: lectores cuyo detalle individual puede mostrarse (A2 vigente);
 *    registro no verificable ⇒ nadie (`unavailable`);
 *  - `aggregateOver`: sobre quién se calculan los agregados que acompañan a ese
 *    detalle. Con entre 1 y A2_MIN_WITHHELD − 1 lectores retenidos, restar el
 *    detalle publicado al agregado de la cohorte revelaría a los retenidos: los
 *    agregados se limitan entonces a `allowed`. Con 0 o ≥ A2_MIN_WITHHELD
 *    retenidos, o sin detalle publicado, el agregado de la cohorte no revela a
 *    nadie y se mantiene.
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
