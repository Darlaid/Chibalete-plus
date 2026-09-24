/**
 * userEffectiveReadingTime.mjs — CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 (1B).
 *
 * Tiempo efectivo de lectura de UN usuario sobre la historia lógica completa
 * (`events.db` ∪ `events.archive.db`), para el desbloqueo del avance
 * automático (GET /api/reading/my-effective-time).
 *
 * POR QUÉ NO `readHistoricalEvents`
 * ---------------------------------
 * Ese lector está pensado para la reconstrucción del materializador: trae TODA
 * la ventana (`SELECT *` sin filtro de sujeto) y filtra por usuario en JS.
 * Medido en producción (Fase 2, 2026-09-24): ~20k filas por llamada,
 * 350–720 ms en caliente y >1 s en frío, y como better-sqlite3 es síncrono,
 * cada llamada congelaba la réplica entera (un /api/health pasaba de ~5 ms a
 * 326–515 ms). Aquí se consulta SOLO al sujeto, por el índice que ya existe en
 * ambas bases (`idx_user_content` / `idx_arch_user_content`, prefijo user_id).
 *
 * MISMA SEMÁNTICA que `readHistoricalEvents` (y por tanto el mismo resultado
 * que la señal `tiempo_efectivo_lectura` sobre ese usuario):
 *   - solo lectura (`readonly: true`); NUNCA crea el archivo;
 *   - dedupe por `event_id` con precedencia de la base caliente;
 *   - orden `server_ts ASC`, desempate por `id ASC`;
 *   - la agregación es `computeEffectiveReadingMs` con el normalizador legacy.
 *
 * Diferencia deliberada: una fuente ilegible LANZA (el endpoint responde 500 y
 * el cliente queda LOCKED, fail-closed) en vez de aportar 0 filas en silencio.
 * Un archivo inexistente no es un error: es el estado normal sin rotación.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DEFAULT_EVENTS_PATH, DEFAULT_ARCHIVE_PATH } from './historicalEvents.mjs';
import { computeEffectiveReadingMs } from './effectiveReadingTime.mjs';
import { normalizeEventForSignals } from './legacyEventNormalizer.mjs';

// Solo las columnas que usa la agregación. El filtro por user_id aprovecha el
// índice (user_id, content_id, server_ts) de ambas bases.
const SELECT_USER = `SELECT id, event_id, event, content_id, server_ts, elapsed_ms, payload_json
    FROM events WHERE user_id = ?`;

function readUserRows(dbPath, userId) {
    if (!dbPath || !fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('busy_timeout = 5000');
        return db.prepare(SELECT_USER).all(userId);
    } finally {
        try { db.close(); } catch { /* ignore */ }
    }
}

/**
 * Filas del usuario en hot ∪ archive, con la semántica de `readHistoricalEvents`.
 * @param {string} userId
 * @param {{ eventsPath?: string, archivePath?: string }} [opts]
 */
export function readUserHistoricalRows(userId, opts = {}) {
    const hot = readUserRows(opts.eventsPath || DEFAULT_EVENTS_PATH(), userId);
    const archive = readUserRows(opts.archivePath || DEFAULT_ARCHIVE_PATH(), userId);
    const seen = new Set();
    const rows = [];
    for (const r of [...hot, ...archive]) {   // la caliente entra primero y gana el dedupe
        if (r.event_id != null) {
            if (seen.has(r.event_id)) continue;
            seen.add(r.event_id);
        }
        rows.push(r);
    }
    rows.sort((a, b) => (a.server_ts - b.server_ts) || (a.id - b.id));
    return { rows, sources: { hot: hot.length, archive: archive.length } };
}

/**
 * Tiempo efectivo (ms) del usuario sobre toda su historia lógica.
 * @param {string} userId
 * @param {{ eventsPath?: string, archivePath?: string }} [opts]
 */
export function userEffectiveReadingMs(userId, opts = {}) {
    const { rows } = readUserHistoricalRows(userId, opts);
    return computeEffectiveReadingMs(rows, (row) => normalizeEventForSignals(row.event)).ms;
}
