/**
 * exclusions.mjs — CHP-GAMIFICACION-PRIV-01D.
 *
 * Tombstones y registro de exclusiones. El tombstone identifica a una persona
 * excluida sin conservar su id ni actividad alguna.
 *
 * Separación criptográfica: tombstones y registro usan claves derivadas de la
 * clave de servidor con etiqueta propia; ninguna coincide con la derivación de
 * claves del ledger (`subjects.mjs`).
 *
 * Registro independiente: archivo append-only cuya ruta da
 * `GAMIFICATION_EXCLUSION_REGISTRY`, sin valor por defecto y fuera del directorio
 * de `gamification.db`. No pertenece al inventario de respaldos: una restauración
 * no lo retrocede. Es la autoridad frente a `gm_erasures`, que sí se restaura.
 *
 * Puerta (`exclusionGate`): ausente, ilegible, alterado o desalineado con
 * `gm_erasures` ⇒ ninguna ingesta. Nunca se asume que no hay exclusiones.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSubjectKey } from './subjectKey.mjs';
import { resolveGamificationDbPath, GamificationError } from './db.mjs';

const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
const exclusionKey = () => hmac(getSubjectKey(), 'gm-exclusion-v1');
const registryKey = () => hmac(getSubjectKey(), 'gm-exclusion-registry-v1');
const entryMac = ({ id, t, d }) => hmac(registryKey(), [id, t, d].join('\0')).toString('hex');
const unavailable = () => new GamificationError('EXCLUSION_REGISTRY_UNAVAILABLE');

/** Determinista: sirve para reconocer a la persona sin guardar su id. */
export const tombstoneOf = (userId) => hmac(exclusionKey(), userId).toString('hex');

/** Ruta configurada e independiente de la base, o error. */
function registryPath(env) {
    const raw = env.GAMIFICATION_EXCLUSION_REGISTRY || process.env.GAMIFICATION_EXCLUSION_REGISTRY;
    if (!raw) throw unavailable();
    const p = path.resolve(raw);
    if (path.dirname(p) === path.dirname(resolveGamificationDbPath(env))) throw new GamificationError('EXCLUSION_REGISTRY_NOT_INDEPENDENT');
    return p;
}

/** Tombstones del registro. Cualquier línea alterada o incompleta invalida el conjunto. */
export function readRegistry(env = process.env) {
    const p = registryPath(env);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); } catch { throw unavailable(); }
    const out = new Set();
    if (raw === '') return out;
    if (!raw.endsWith('\n')) throw unavailable();
    for (const line of raw.slice(0, -1).split('\n')) {
        let e;
        try { e = JSON.parse(line); } catch { throw unavailable(); }
        const mac = Buffer.from(String(e?.m ?? ''), 'hex');
        const expected = Buffer.from(entryMac(e ?? {}), 'hex');
        if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) throw unavailable();
        out.add(e.t);
    }
    return out;
}

/** Añade una exclusión con escritura durable. El registro se escribe ANTES que la base. */
export function appendRegistry({ id, tombstone, day }, env = process.env) {
    const p = registryPath(env);
    const e = { id, t: tombstone, d: day };
    const fd = fs.openSync(p, 'a');
    try {
        fs.writeSync(fd, `${JSON.stringify({ ...e, m: entryMac(e) })}\n`);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

const erasureTombstones = (db) => new Set(db.prepare('SELECT tombstone FROM gm_erasures').all().map((r) => r.tombstone));

/**
 * Puerta previa a cualquier ingesta.
 * @throws EXCLUSION_REGISTRY_UNAVAILABLE | EXCLUSION_REGISTRY_NOT_INDEPENDENT
 * @throws EXCLUSION_REPLAY_REQUIRED  el registro tiene exclusiones que la base no (restauración)
 * @throws EXCLUSION_REGISTRY_STALE   la base tiene exclusiones que el registro no
 */
export function exclusionGate(db, env = process.env) {
    const registry = readRegistry(env);
    const stored = erasureTombstones(db);
    for (const t of registry) if (!stored.has(t)) throw new GamificationError('EXCLUSION_REPLAY_REQUIRED');
    for (const t of stored) if (!registry.has(t)) throw new GamificationError('EXCLUSION_REGISTRY_STALE');
    return { excludes: (userId) => registry.has(tombstoneOf(userId)) };
}
