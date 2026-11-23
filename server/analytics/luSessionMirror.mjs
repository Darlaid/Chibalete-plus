/**
 * luSessionMirror.mjs — CHP V9 65E-C1. Copia canónica de los hechos de sesión de Lector Único (LU).
 *
 * POR QUÉ EXISTE
 * --------------
 * LU no usa el hook nativo: abrir, latido y cerrar llegan solo como telemetría heredada (`/api/analytics/events`,
 * `source: 'lu_android'`) y se guardan en `analytics_db.json`, una memoria RODANTE de 50 000 eventos. El espejo a
 * events.db omite esos tres hechos para todos los clientes porque los visores web ya los escriben allí por su cuenta;
 * LU no. Resultado: la única constancia de una sesión de LU desaparecía cuando la memoria rodaba, sin que ninguna regla
 * de conservación lo hubiera decidido.
 *
 * QUÉ HACE
 * --------
 * Al recibirlos, los tres hechos de sesión de LU se copian a events.db, el almacén canónico que sí tiene conservación
 * aprobada (90 días en caliente, archivo de 12 meses) y supresión por titular. No es un motor ni un almacén nuevo:
 *   - mismo `insertEvent`, misma deduplicación (`event_id` único): el identificador se DERIVA del evento de LU, así que
 *     un reenvío —aunque la memoria rodante ya haya olvidado el original— no crea otra fila;
 *   - nombres propios (`lu.read_session_*`): la familia `lu.*` ya está fuera de las señales por decisión documentada, y
 *     el resumen de Aula Viva solo lee los nombres que consume. Nadie cuenta estas filas dos veces;
 *   - se conservan la fecha del dispositivo (`client_ts`) y la de recepción del servidor (`server_ts`): con ellas se
 *     reconstruye el evento tal como llegó, con su constancia de recepción.
 *
 * QUIÉN LO LEE
 * ------------
 * El resumen de Aula Viva y el tablero unen esta copia con la telemetría heredada por `eventId`: mientras el evento
 * siga en la memoria rodante no cambia nada; cuando ya rodó, la sesión sigue contando. No reconstruye nada anterior a
 * su activación: lo que rodó antes no existe y se declara como hasta ahora.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DEFAULT_EVENTS_PATH, DEFAULT_ARCHIVE_PATH } from './historicalEvents.mjs';

export const LU_SOURCE = 'lu_android';
const TO_MIRROR = Object.freeze({ session_start: 'lu.read_session_start', session_heartbeat: 'lu.read_session_heartbeat', session_end: 'lu.read_session_end' });
const FROM_MIRROR = Object.freeze(Object.fromEntries(Object.entries(TO_MIRROR).map(([k, v]) => [v, k])));
export const LU_MIRROR_EVENTS = Object.freeze(Object.values(TO_MIRROR));
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const IN_CHUNK = 500;

/** Identificador estable (26 caracteres, alfabeto ULID) derivado del lector y del `eventId` que puso LU. */
export function mirrorEventId(userId, eventId) {
    const h = crypto.createHash('sha256').update(`lu-session:${userId}:${eventId}`).digest();
    let out = '';
    for (let i = 0; i < 26; i++) out += CROCKFORD[h[i] & 31];
    return out;
}

/**
 * Evento de LU (tal como llega a /api/analytics/events) → evento para `insertEvent`, o null si no es un hecho de sesión
 * de LU con obra, identificador y fecha.
 */
export function toMirrorEvent(e) {
    if (!e || e.source !== LU_SOURCE || !TO_MIRROR[e.event]) return null;
    if (typeof e.userId !== 'string' || !e.userId || typeof e.contentId !== 'string' || !e.contentId) return null;
    if (typeof e.eventId !== 'string' || !e.eventId || !Number.isFinite(e.timestamp)) return null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const payload = { _source: LU_SOURCE, eventId: e.eventId.slice(0, 128) };
    if (num(e.sessionDuration) !== undefined) payload.sessionDuration = e.sessionDuration;
    if (num(e.elapsedMs) !== undefined) payload.elapsedMs = e.elapsedMs;
    if (num(e.progressPercentage) !== undefined) payload.progressPercentage = e.progressPercentage;
    const elapsed = num(e.elapsedMs) ?? num(e.sessionDuration);
    return {
        eventId: mirrorEventId(e.userId, e.eventId), schemaVersion: 1, event: TO_MIRROR[e.event], mode: 'lu',
        userId: e.userId, contentId: e.contentId, sessionId: 'lu-session', clientTs: e.timestamp,
        ...(elapsed !== undefined ? { elapsedMs: elapsed } : {}),
        payload,
    };
}

/** Fila de events.db → el evento de LU con la forma de la telemetría heredada (fecha del dispositivo + recepción). */
export function fromMirrorRow(row) {
    const event = FROM_MIRROR[row?.event];
    if (!event) return null;
    let p = {};
    try { p = JSON.parse(row.payload_json || '{}') || {}; } catch { p = {}; }
    if (typeof p.eventId !== 'string' || !p.eventId) return null;
    return { eventId: p.eventId, userId: row.user_id, event, timestamp: row.client_ts, receivedAt: row.server_ts, contentId: row.content_id, source: LU_SOURCE,
        ...(typeof p.elapsedMs === 'number' ? { elapsedMs: p.elapsedMs } : {}), ...(typeof p.sessionDuration === 'number' ? { sessionDuration: p.sessionDuration } : {}),
        ...(typeof p.progressPercentage === 'number' ? { progressPercentage: p.progressPercentage } : {}) };
}

function readFrom(dbPath, userIds) {
    if (!userIds.length || !dbPath || !fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('busy_timeout = 5000');
        const out = [];
        for (let i = 0; i < userIds.length; i += IN_CHUNK) {
            const chunk = userIds.slice(i, i + IN_CHUNK);
            const sql = `SELECT event, user_id, content_id, client_ts, server_ts, payload_json FROM events
                WHERE user_id IN (${chunk.map(() => '?').join(',')}) AND event IN (${LU_MIRROR_EVENTS.map(() => '?').join(',')})`;
            for (const r of db.prepare(sql).all(...chunk, ...LU_MIRROR_EVENTS)) out.push(r);
        }
        return out;
    } catch (e) {
        if (/no such table/i.test(String(e?.message))) return [];   // base recién creada, todavía sin eventos
        throw e;
    } finally {
        try { db.close(); } catch { /* ignore */ }
    }
}

/**
 * Hechos de sesión de LU conservados para esos lectores (caliente ∪ archivo), con la forma de la telemetría heredada.
 * @returns {object[]}
 */
export function readLuMirror(userIds, opts = {}) {
    const ids = [...new Set((userIds || []).filter((id) => typeof id === 'string' && id))];
    const rows = [...readFrom(opts.eventsPath || DEFAULT_EVENTS_PATH(), ids), ...readFrom(opts.archivePath || DEFAULT_ARCHIVE_PATH(), ids)];
    const seen = new Set(), out = [];
    for (const r of rows) {
        const e = fromMirrorRow(r);
        if (!e || seen.has(`${e.userId}\n${e.eventId}`)) continue;
        seen.add(`${e.userId}\n${e.eventId}`);
        out.push(e);
    }
    return out;
}

/**
 * Telemetría heredada ∪ copia conservada, sin repetir: un evento que sigue en la memoria rodante vale tal cual; de la
 * copia solo entran los que ya no están. El orden de la telemetría heredada no cambia (los añadidos van al final).
 */
export function withLuMirror(legacyEvents, mirrorEvents) {
    const legacy = Array.isArray(legacyEvents) ? legacyEvents : [];
    if (!Array.isArray(mirrorEvents) || mirrorEvents.length === 0) return legacy;
    const have = new Set();
    for (const e of legacy) if (e?.source === LU_SOURCE && typeof e.eventId === 'string') have.add(`${e.userId}\n${e.eventId}`);
    const extra = mirrorEvents.filter((e) => !have.has(`${e.userId}\n${e.eventId}`));
    return extra.length ? [...legacy, ...extra] : legacy;
}
