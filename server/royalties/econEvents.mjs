/**
 * econEvents.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A2.
 *
 * Ingesta económica: recepción, validación, persistencia y atribución
 * comercial de `econ_tick`. Alimenta al motor puro F3-A1
 * (`economicEpisodes.mjs`) sin cambiar su algoritmo.
 *
 * ALMACÉN — tabla `econ_events` dentro del MISMO `events.db` (decisión F3-A2):
 * misma conexión, WAL y respaldo, pero separada de `events`, así que ningún
 * lector de analítica, Aula Viva, insights o rollups la ve. Append-only por
 * triggers: la rotación de 90 días y la expiración de 12 meses de `events`
 * no la tocan; su retención se decide con la de regalías.
 *
 * DOS FILAS, DOS NATURALEZAS (actividad ≠ conclusión económica):
 *  - `econ_tick`          actividad declarada por el cliente, normalizada y
 *                         acotada por el servidor;
 *  - `econ.session_start` atribución comercial que el SERVIDOR registra con el
 *                         primer tick de la sesión técnica: regla F2-B y su
 *                         clase en ese instante. Id determinista ⇒ una sola por
 *                         sesión aunque dos réplicas reciban ticks a la vez.
 * La elegibilidad (Q, episodios) se calcula bajo demanda con el motor F3-A1;
 * nada aquí la concluye.
 *
 * Confianza: el usuario sale de la sesión firmada, nunca del cuerpo; el
 * payload se reconstruye campo a campo; el reloj del servidor fija las
 * ventanas admisibles.
 */
import crypto from 'node:crypto';
import { ECON_TICK_EVENT, RULE_SET_RS_2026_01_V1 } from './economicEpisodes.mjs';

export const ECON_SESSION_START_EVENT = 'econ.session_start';
export const ECON_EVENTS_TABLE = 'econ_events';

/**
 * Parámetros técnicos de ingesta. Los dos de reloj los confirmó el responsable
 * del plan en F3-A2 y son también los que exige `computeEconomicEpisodes`.
 */
export const ECON_INGEST_PARAMS = Object.freeze({
    clockSkewToleranceMs: 120_000,     // client_ts puede adelantarse al servidor hasta 2 min
    maxIngestDelayMs: 600_000,         // y llegar hasta 10 min tarde
    // Una ventana normal es de 15 s. Con la pestaña oculta los navegadores
    // espacian los temporizadores (hasta 1/min); la vía de escucha no exige
    // visibilidad, así que se admite hasta 2 min. El motor recorta además cada
    // ventana al tick anterior: nunca se acredita más que el tiempo real.
    maxWindowMs: 120_000,
    maxSignalAgoMs: 3_600_000,         // señales humanas de hasta 1 h atrás
    maxTicksPerUserPerMinute: 12,      // ≈ 3 sesiones simultáneas a 4 ticks/min
    minPlaybackRate: 0.25,
    maxPlaybackRate: 4,
    maxIdLength: 128,
});

const ULID_RX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const ID_RX = /^[A-Za-z0-9._:-]+$/;
const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isId = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && ID_RX.test(s);

/** `ECONOMIC_INGEST_MODE`: ausente o desconocido ⇒ `off` (sin ningún cambio en el producto). */
export function econIngestMode(env = process.env) {
    return String(env.ECONOMIC_INGEST_MODE || 'off').toLowerCase() === 'on' ? 'on' : 'off';
}

/** Cuentas internas o de QA (P7). Lista pendiente de negocio: vacía por defecto. */
export function internalUserIdsFromEnv(env = process.env) {
    return String(env.ROYALTIES_INTERNAL_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function ensureEconSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${ECON_EVENTS_TABLE} (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id      TEXT    UNIQUE NOT NULL,
            event         TEXT    NOT NULL CHECK (event IN ('${ECON_TICK_EVENT}', '${ECON_SESSION_START_EVENT}')),
            mode          TEXT    NOT NULL,
            user_id       TEXT    NOT NULL,
            content_id    TEXT    NOT NULL,
            session_id    TEXT    NOT NULL,
            client_ts     INTEGER NOT NULL,
            server_ts     INTEGER NOT NULL,
            payload_json  TEXT    NOT NULL,
            created_at    INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ux_econ_session_event_ts ON ${ECON_EVENTS_TABLE}(user_id, session_id, event, client_ts);
        CREATE INDEX IF NOT EXISTS idx_econ_user_server_ts ON ${ECON_EVENTS_TABLE}(user_id, server_ts);
        CREATE INDEX IF NOT EXISTS idx_econ_server_ts ON ${ECON_EVENTS_TABLE}(server_ts);
        CREATE TRIGGER IF NOT EXISTS econ_events_no_update BEFORE UPDATE ON ${ECON_EVENTS_TABLE}
            BEGIN SELECT RAISE(ABORT, 'econ_events is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS econ_events_no_delete BEFORE DELETE ON ${ECON_EVENTS_TABLE}
            BEGIN SELECT RAISE(ABORT, 'econ_events is append-only'); END;
    `);
}

/** Id determinista de la atribución de una sesión técnica. */
export function sessionStartEventId(userId, contentId, sessionId) {
    const h = crypto.createHash('sha256').update(`${userId}\u0000${contentId}\u0000${sessionId}`).digest('hex');
    return `econ-start-${h.slice(0, 40)}`;
}

/**
 * Valida un `econ_tick` del cliente y reconstruye su payload. No confía en
 * `userId`, `serverTs` ni en campos desconocidos.
 *
 * @returns {{ok:true, tick:object} | {ok:false, code:string}}
 */
export function normalizeEconTick(evt, { userId, now, params = ECON_INGEST_PARAMS, includedModes = RULE_SET_RS_2026_01_V1.includedModes }) {
    if (!evt || typeof evt !== 'object' || Array.isArray(evt) || evt.event !== ECON_TICK_EVENT) return { ok: false, code: 'malformed' };
    if (evt.userId !== undefined && evt.userId !== userId) return { ok: false, code: 'user_mismatch' };
    if (typeof evt.eventId !== 'string' || !ULID_RX.test(evt.eventId)) return { ok: false, code: 'invalid_event_id' };
    if (!includedModes.includes(evt.mode)) return { ok: false, code: 'mode_not_included' };
    if (!isId(evt.contentId, params.maxIdLength)) return { ok: false, code: 'invalid_content_id' };
    if (!isId(evt.sessionId, params.maxIdLength) || evt.sessionId.startsWith('legacy-')) return { ok: false, code: 'invalid_session_id' };
    if (!Number.isSafeInteger(evt.clientTs)) return { ok: false, code: 'invalid_client_ts' };
    if (evt.clientTs - now > params.clockSkewToleranceMs) return { ok: false, code: 'clock_ahead' };
    if (now - evt.clientTs > params.maxIngestDelayMs) return { ok: false, code: 'too_late' };

    const p = evt.payload;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, code: 'invalid_payload' };
    if (!isFiniteNum(p.windowMs) || p.windowMs <= 0 || p.windowMs > params.maxWindowMs) return { ok: false, code: 'invalid_window' };
    if (typeof p.visible !== 'boolean') return { ok: false, code: 'invalid_payload' };
    const ago = (x) => x === null || x === undefined || (isFiniteNum(x) && x >= 0 && x <= params.maxSignalAgoMs);
    if (!ago(p.humanSignalAgoMs) || !ago(p.firstHumanSignalAgoMs)) return { ok: false, code: 'invalid_signal' };
    if (isFiniteNum(p.firstHumanSignalAgoMs)
        && (p.firstHumanSignalAgoMs > p.windowMs || !isFiniteNum(p.humanSignalAgoMs) || p.firstHumanSignalAgoMs < p.humanSignalAgoMs)) {
        return { ok: false, code: 'invalid_signal' };
    }
    let audio = null;
    if (p.audio !== null && p.audio !== undefined) {
        const a = p.audio;
        if (typeof a !== 'object' || Array.isArray(a)
            || typeof a.playing !== 'boolean' || typeof a.gesture !== 'boolean' || typeof a.muted !== 'boolean'
            || !isFiniteNum(a.rate) || a.rate < params.minPlaybackRate || a.rate > params.maxPlaybackRate
            || !isFiniteNum(a.mediaAdvancedMs) || a.mediaAdvancedMs < 0) {
            return { ok: false, code: 'invalid_audio' };
        }
        // El medio no puede avanzar más que la ventana a su velocidad (+1 s de margen).
        if (a.mediaAdvancedMs > p.windowMs * a.rate + 1000) return { ok: false, code: 'audio_overrun' };
        audio = { playing: a.playing, gesture: a.gesture, mediaAdvancedMs: Math.round(a.mediaAdvancedMs), rate: a.rate, muted: a.muted };
    }
    const payload = { windowMs: Math.round(p.windowMs), visible: p.visible, humanSignalAgoMs: isFiniteNum(p.humanSignalAgoMs) ? Math.round(p.humanSignalAgoMs) : null };
    if (isFiniteNum(p.firstHumanSignalAgoMs)) payload.firstHumanSignalAgoMs = Math.round(p.firstHumanSignalAgoMs);
    payload.audio = audio;
    return { ok: true, tick: { eventId: evt.eventId.toUpperCase(), mode: evt.mode, contentId: evt.contentId, sessionId: evt.sessionId, clientTs: evt.clientTs, payload } };
}

/**
 * Persiste ticks ya normalizados de UN usuario autenticado, en una transacción
 * IMMEDIATE (serializa réplicas sobre el mismo archivo).
 *
 * @param {object} db  conexión de events.db
 * @param {object} o
 * @param {string} o.userId
 * @param {Array} o.ticks             salida `tick` de normalizeEconTick
 * @param {number} o.now              reloj del servidor
 * @param {Map<string, object>} o.attributionByContent  F2-B resuelta en `now`
 *        (solo se usa si la sesión aún no tiene atribución)
 * @returns {{accepted:number, deduplicated:number, rejected:number, errors:Array<{eventId, code}>}}
 */
export function recordEconTicks(db, { userId, ticks, now, attributionByContent, params = ECON_INGEST_PARAMS }) {
    ensureEconSchema(db);
    const out = { accepted: 0, deduplicated: 0, rejected: 0, errors: [] };
    const reject = (t, code) => { out.rejected++; out.errors.push({ eventId: t.eventId, code }); };
    const getStart = db.prepare(`SELECT content_id, mode FROM ${ECON_EVENTS_TABLE} WHERE user_id = ? AND session_id = ? AND event = '${ECON_SESSION_START_EVENT}'`);
    const recent = db.prepare(`SELECT COUNT(*) AS n FROM ${ECON_EVENTS_TABLE} WHERE user_id = ? AND event = '${ECON_TICK_EVENT}' AND server_ts > ?`);
    const insert = db.prepare(`INSERT OR IGNORE INTO ${ECON_EVENTS_TABLE}
        (event_id, event, mode, user_id, content_id, session_id, client_ts, server_ts, payload_json, created_at)
        VALUES (@event_id, @event, @mode, @user_id, @content_id, @session_id, @client_ts, @server_ts, @payload_json, @created_at)`);
    const sorted = [...ticks].sort((a, b) => a.clientTs - b.clientTs || (a.eventId < b.eventId ? -1 : 1));

    db.transaction(() => {
        let inMinute = recent.get(userId, now - 60_000).n;
        for (const t of sorted) {
            const start = getStart.get(userId, t.sessionId);
            if (start && (start.content_id !== t.contentId || start.mode !== t.mode)) { reject(t, 'session_mismatch'); continue; }
            if (inMinute >= params.maxTicksPerUserPerMinute) { reject(t, 'rate_limited'); continue; }
            if (!start) {
                const attribution = attributionByContent.get(t.contentId);
                if (!attribution) { reject(t, 'unattributable'); continue; }
                // El suelo de la sesión es el inicio de la primera ventana:
                // así el motor no recorta el primer tick a cero.
                insert.run({
                    event_id: sessionStartEventId(userId, t.contentId, t.sessionId), event: ECON_SESSION_START_EVENT,
                    mode: t.mode, user_id: userId, content_id: t.contentId, session_id: t.sessionId,
                    // Nunca más atrás que el retraso admitido: el motor rechazaría la fila.
                    client_ts: Math.max(t.clientTs - t.payload.windowMs, now - params.maxIngestDelayMs),
                    server_ts: now, created_at: now,
                    payload_json: JSON.stringify({ econAccess: {
                        ruleId: attribution.ruleId, commercialClass: attribution.commercialClass,
                        eligible: attribution.eligible, reason: attribution.reason,
                        candidateRuleIds: attribution.candidateRuleIds, resolvedAt: now,
                    } }),
                });
            }
            const r = insert.run({
                event_id: t.eventId, event: ECON_TICK_EVENT, mode: t.mode, user_id: userId,
                content_id: t.contentId, session_id: t.sessionId, client_ts: t.clientTs,
                server_ts: now, payload_json: JSON.stringify(t.payload), created_at: now,
            });
            if (r.changes > 0) { out.accepted++; inMinute++; } else out.deduplicated++;
        }
    }).immediate();
    return out;
}

/**
 * Lee `econ_events` con la forma de fila que espera `computeEconomicEpisodes`.
 * Filtra por `server_ts` (ventana de ingesta) y, opcionalmente, usuario u obra.
 */
export function readEconRows(db, { fromServerTs = 0, toServerTs = Number.MAX_SAFE_INTEGER, userId = null, contentId = null } = {}) {
    ensureEconSchema(db);
    const where = ['server_ts >= ?', 'server_ts <= ?'];
    const args = [fromServerTs, toServerTs];
    if (userId) { where.push('user_id = ?'); args.push(userId); }
    if (contentId) { where.push('content_id = ?'); args.push(contentId); }
    return db.prepare(`SELECT event_id, event, mode, user_id, content_id, session_id, client_ts, server_ts, payload_json
        FROM ${ECON_EVENTS_TABLE} WHERE ${where.join(' AND ')} ORDER BY id ASC`).all(...args);
}

/**
 * Usuarios cuya atribución registrada los excluye (administración, sintéticos,
 * internos). Forma `excludedUsers` del motor: userId → motivo.
 */
export function excludedUsersFromRows(rows) {
    const out = new Map();
    for (const r of rows) {
        if (r.event !== ECON_SESSION_START_EVENT) continue;
        try {
            if (JSON.parse(r.payload_json)?.econAccess?.reason === 'USER_EXCLUDED') out.set(r.user_id, 'attribution_user_excluded');
        } catch { /* fila ilegible: el motor la descarta como malformed */ }
    }
    return out;
}

/** Parámetros de reloj para `computeEconomicEpisodes`, idénticos a los de ingesta. */
export function engineClockContext(params = ECON_INGEST_PARAMS) {
    return { clockSkewToleranceMs: params.clockSkewToleranceMs, maxIngestDelayMs: params.maxIngestDelayMs };
}
