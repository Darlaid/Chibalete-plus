/**
 * historicalEvents.mjs — CHP-V6-EVENTS-RETENTION-01 / Etapa 10B.
 *
 * Lector READ-ONLY de la historia lógica completa de eventos: `events.db`
 * (caliente) ∪ `events.archive.db` (archivo), como una sola secuencia.
 *
 * POR QUÉ EXISTE
 * --------------
 * El preflight 10A encontró el bloqueo de fondo de la rotación: **ningún
 * consumidor de runtime leía `events.archive.db`**. `rebuildInsights` abría
 * solo la base caliente, así que archivar equivalía a sacar esa historia del
 * alcance de cualquier reconstrucción. Medido sobre el corpus real: rotar a 90
 * días dejaba el replay del informe del 31-jul-2026 en 12.510 eventos de 19
 * usuarios, cuando el corpus tiene 16.263 de 37.
 *
 * CONTRATO
 * --------
 *   - Solo lectura. Ambos handles se abren `readonly: true`.
 *   - **Nunca crea el archivo.** Si `events.archive.db` no existe, la historia
 *     es exactamente la caliente: no es un error, es el estado normal de hoy.
 *   - Mismo envelope: se devuelven las filas crudas tal cual, sin proyectar ni
 *     renombrar. `id`, `event_id`, `server_ts`, `payload_json` y el resto viajan
 *     intactos.
 *   - Dedupe por `event_id`, con **precedencia de la caliente**. La rotación
 *     mueve filas (copia y luego borra lo confirmado), así que un solape solo
 *     puede darse si una rotación quedó a medias; en ese caso la versión viva
 *     es la autoridad. Nunca se reconcilia por similitud ni se mezcla campo a
 *     campo: se toma una fila u otra, entera.
 *   - Orden: `server_ts ASC`, desempate por `id ASC`. Los `id` se preservan al
 *     archivar, así que la unión mantiene un orden total estable.
 *
 * NO sustituye al camino incremental: `runOnce` sigue leyendo solo la caliente
 * por `id > watermark`. Mezclar archivo en el incremental reintroduciría
 * historia ya procesada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_EVENTS_PATH = () => process.env.EVENTS_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');
export const DEFAULT_ARCHIVE_PATH = () => process.env.ARCHIVE_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'events.archive.db');

/** Límite duro heredado del contrato de `rebuildInsights`. */
const DEFAULT_LIMIT = 100_000;

const SELECT = `SELECT * FROM events WHERE server_ts >= ? AND server_ts <= ? ORDER BY id ASC LIMIT ?`;

/** Lee una fuente si existe; si no, devuelve []. Nunca crea el archivo. */
function readFrom(dbPath, fromTs, toTs, limit) {
    if (!dbPath || !fs.existsSync(dbPath)) return [];
    let db = null;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        db.pragma('busy_timeout = 5000');
        return db.prepare(SELECT).all(fromTs, toTs, limit);
    } catch {
        // Una fuente ilegible no puede degradar silenciosamente la historia: el
        // llamador lo ve en `sources`, que dirá que esta fuente aportó 0 filas.
        return [];
    } finally {
        if (db) { try { db.close(); } catch { /* ignore */ } }
    }
}

/**
 * Historia lógica en una ventana temporal.
 *
 * @param {object}   opts
 * @param {number}   [opts.fromTs=0]
 * @param {number}   [opts.toTs=Date.now()]
 * @param {string[]} [opts.userIds]      filtra a estos sujetos en AMBAS fuentes
 * @param {string}   [opts.eventsPath]
 * @param {string}   [opts.archivePath]
 * @param {number}   [opts.limit]        por fuente, antes de unir
 * @returns {{ rows: object[], sources: {hot:number, archive:number},
 *             duplicates: number, archivePresent: boolean }}
 */
export function readHistoricalEvents(opts = {}) {
    const fromTs = Number.isFinite(opts.fromTs) ? opts.fromTs : 0;
    const toTs   = Number.isFinite(opts.toTs) ? opts.toTs : Date.now();
    const limit  = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_LIMIT;
    const eventsPath  = opts.eventsPath  || DEFAULT_EVENTS_PATH();
    const archivePath = opts.archivePath || DEFAULT_ARCHIVE_PATH();
    const archivePresent = !!archivePath && fs.existsSync(archivePath);

    const hot = readFrom(eventsPath, fromTs, toTs, limit);
    const archive = archivePresent ? readFrom(archivePath, fromTs, toTs, limit) : [];

    const userFilter = Array.isArray(opts.userIds) && opts.userIds.length > 0
        ? new Set(opts.userIds) : null;
    const keep = (r) => !userFilter || userFilter.has(r.user_id);

    // La caliente entra primero y gana el dedupe.
    const seen = new Set();
    const rows = [];
    let duplicates = 0;
    for (const r of hot) {
        if (!keep(r)) continue;
        if (r.event_id != null) {
            if (seen.has(r.event_id)) { duplicates++; continue; }
            seen.add(r.event_id);
        }
        rows.push(r);
    }
    for (const r of archive) {
        if (!keep(r)) continue;
        if (r.event_id != null) {
            if (seen.has(r.event_id)) { duplicates++; continue; }
            seen.add(r.event_id);
        }
        rows.push(r);
    }

    rows.sort((a, b) => (a.server_ts - b.server_ts) || (a.id - b.id));

    return {
        rows,
        sources: { hot: hot.length, archive: archive.length },
        duplicates,
        archivePresent,
    };
}
