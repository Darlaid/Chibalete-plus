/**
 * materializerWatermark.mjs — CHP-V6-EVENTS-RETENTION-01 / Etapa 10B.
 *
 * Lectura READ-ONLY del watermark del materializador. Helper mínimo: no crea
 * store ni cursor paralelo, consulta la autoridad que ya existe —
 * `insights.db` → `materializer_state` → pipeline `aula_viva_pedagogical_v1`.
 *
 * POR QUÉ EXISTE
 * --------------
 * El corte de la rotación era puramente temporal: `server_ts <= now - 90d`, sin
 * consultar nunca cuánto había procesado el materializador. Hoy eso es seguro
 * por casualidad del estado (el `max_id` archivable es 6.454 y el watermark va
 * por 20.078), no por construcción. Si el materializador llegara a acumular más
 * de 90 días de retraso, la rotación retiraría del vivo filas que nunca se
 * proyectaron. Esta lectura permite exigir la frontera por `id`.
 *
 * La frontera es por `id`, NO por `server_ts`: el watermark del materializador
 * es un `last_event_id`, y traducirlo a tiempo asumiría una correlación entre
 * `id` y `server_ts` que nadie garantiza (el dual-write legacy inserta con
 * `server_ts = Date.now()` del servidor, no el del cliente).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Mismo nombre de pipeline que usa `insightMaterializer`. */
export const MATERIALIZER_NAME = 'aula_viva_pedagogical_v1';

export const DEFAULT_INSIGHTS_PATH = () => process.env.INSIGHTS_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');

/**
 * @param {{insightsPath?:string, materializerName?:string}} [opts]
 * @returns {{ ok:boolean, watermark:number|null, reason:string,
 *             degraded?:boolean, last_error?:string|null }}
 *   `ok:true` solo con un watermark entero > 0 leído de la autoridad.
 *   Cualquier otra cosa — base ausente, tabla ausente, fila ausente, valor no
 *   entero, 0, negativo o error de lectura — devuelve `ok:false` con la razón,
 *   para que el llamador pueda hacer SAFE_SKIP en vez de degradar a solo-edad.
 */
export function readMaterializerWatermark(opts = {}) {
    const insightsPath = opts.insightsPath || DEFAULT_INSIGHTS_PATH();
    const name = opts.materializerName || MATERIALIZER_NAME;
    if (!insightsPath || !fs.existsSync(insightsPath)) {
        return { ok: false, watermark: null, reason: 'insights_db_absent' };
    }
    let db = null;
    try {
        db = new Database(insightsPath, { readonly: true, fileMustExist: true });
        db.pragma('busy_timeout = 5000');
        const hasTable = db.prepare(
            `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='materializer_state'`
        ).get().n > 0;
        if (!hasTable) return { ok: false, watermark: null, reason: 'materializer_state_absent' };
        const row = db.prepare(
            `SELECT last_event_id, degraded, last_error FROM materializer_state WHERE materializer_name = ?`
        ).get(name);
        if (!row) return { ok: false, watermark: null, reason: 'never_materialized' };
        const wm = row.last_event_id;
        if (!Number.isInteger(wm) || wm <= 0) {
            return { ok: false, watermark: null, reason: 'watermark_invalid' };
        }
        return {
            ok: true, watermark: wm, reason: 'ok',
            degraded: !!row.degraded, last_error: row.last_error ?? null,
        };
    } catch (e) {
        return { ok: false, watermark: null, reason: 'read_failed:' + String(e?.message || e).slice(0, 60) };
    } finally {
        if (db) { try { db.close(); } catch { /* ignore */ } }
    }
}
