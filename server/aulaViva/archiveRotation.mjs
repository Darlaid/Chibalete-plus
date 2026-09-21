/**
 * archiveRotation.mjs — Aula Viva PASO 5 §20.
 *
 * Rota eventos antiguos (server_ts <= now - RETENTION_DAYS) desde events.db
 * hacia events.archive.db y expira del archivo los que superan 12 meses
 * calendario (CHP-EVENTS-RETENTION-ROTATION-01D). Pattern:
 *   0. leer el watermark del materializador (SAFE_SKIP si no es valido)
 *   1. ATTACH archive como segunda DB
 *   2. INSERT OR IGNORE archive.events SELECT * FROM main.events WHERE old
 *      AND id <= watermark
 *   3. DELETE FROM main.events WHERE old AND id <= watermark
 *      AND event_id ya presente en archive
 *   4. DELETE FROM archive.events WHERE server_ts > 12 meses
 *      — SOLO con ARCHIVE_EXPIRY_ENABLED=1 (gate propio, default OFF)
 *   5. VACUUM main (opcional, gated)  — recupera espacio
 *   6. PRAGMA wal_checkpoint(TRUNCATE) — libera WAL
 *
 * Toda la operación en tx. Si falla cualquier paso, ROLLBACK → cero pérdida.
 *
 * Idempotente: dos corridas seguidas → la 2da no hace nada (no quedan
 * eventos viejos).
 *
 * GATING (CHP-V6-EVENTS-RETENTION-01 / 10B):
 *   ARCHIVE_ROTATION_ENABLED=1  → rotateOnce activo (default OFF).
 *   ARCHIVE_EXPIRY_ENABLED=1    → ademas permite la eliminacion definitiva
 *                                 >12 meses (default OFF). Separados a
 *                                 proposito: archivar no es borrar.
 *
 * FRONTERA DE SEGURIDAD (10B): una fila solo sale del vivo si cumple LAS DOS
 * condiciones — `server_ts <= now - 90 d` Y `id <= materializer watermark`.
 * Sin watermark valido la rotacion se SALTA; nunca degrada a solo-edad.
 *
 * dryRun NO escribe nada ni crea events.archive.db.
 *
 * Verificación integrity_check antes y después.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { archiveGrowthBytes } from '../observability/metrics.js';
// CHP-V6-EVENTS-RETENTION-01 / 10B — frontera obligatoria por el watermark
// del materializador, leido de su autoridad existente (insights.db).
import { readMaterializerWatermark } from '../analytics/materializerWatermark.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVENTS_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');
const DEFAULT_ARCHIVE_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'events.archive.db');

const RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS || 90);
const VACUUM_AFTER = process.env.ARCHIVE_VACUUM_AFTER_ROTATION === '1';

// CHP-EVENTS-RETENTION-ROTATION-01D — política `02a4708`:
//   0–90 días        → events.db (vivo)
//   día 90–12 meses  → events.archive.db
//   > 12 meses       → expirado (se elimina del archivo)
// El límite de 12 meses es CALENDARIO UTC (no 360/365 días): un evento
// expira solo cuando `now` supera `server_ts + 12 meses`; a los 12 meses
// exactos todavía existe. El límite de 90 días es inclusivo: al alcanzar
// exactamente `server_ts + 90 días` el evento es elegible para archivado.
export const ARCHIVE_RETENTION_MONTHS = 12;

/** Resta `months` meses calendario en UTC, sujetando el día al último del mes destino. */
export function subtractMonthsUtc(ts, months) {
    const d = new Date(ts);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() - months, day = d.getUTCDate();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(day, lastDay),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

export const ENABLED = () => process.env.ARCHIVE_ROTATION_ENABLED === '1';

/**
 * CHP-V6-EVENTS-RETENTION-01 / 10B — gate INDEPENDIENTE de la expiracion.
 *
 * Hasta 10A, archivar (>90 d) y eliminar definitivamente del archivo (>12
 * meses) compartian el unico `ARCHIVE_ROTATION_ENABLED`: encender la rotacion
 * encendia tambien el borrado. Ahora la expiracion solo ocurre con su propio
 * flag en '1'. Default OFF. El flag habilita CAPACIDAD, no autorizacion:
 * la politica (`docs/ops/CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md`)
 * no autoriza ninguna eliminacion todavia.
 */
export const EXPIRY_ENABLED = () => process.env.ARCHIVE_EXPIRY_ENABLED === '1';

function dbPath(envKey, fallback) { return process.env[envKey] || fallback; }

/**
 * Asegura que events.archive.db existe con el mismo schema que events.db.
 * Si no existe, lo crea vacío con el DDL canónico.
 */
function ensureArchiveSchema(archivePath) {
    const fresh = !fs.existsSync(archivePath);
    const db = new Database(archivePath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    if (fresh) {
        // Schema clonado de eventsService.js (sin AUTOINCREMENT en archive — el
        // id viene del archivo origen, lo preservamos por trazabilidad).
        db.exec(`
            CREATE TABLE IF NOT EXISTS events (
                id                 INTEGER PRIMARY KEY,
                event_id           TEXT    UNIQUE NOT NULL,
                schema_version     INTEGER NOT NULL DEFAULT 1,
                event              TEXT    NOT NULL,
                mode               TEXT    NOT NULL,
                user_id            TEXT    NOT NULL,
                content_id         TEXT,
                session_id         TEXT    NOT NULL,
                client_ts          INTEGER NOT NULL,
                server_ts          INTEGER NOT NULL,
                elapsed_ms         INTEGER,
                progress_fraction  REAL,
                payload_json       TEXT,
                created_at         INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_arch_user_content ON events(user_id, content_id, server_ts);
            CREATE INDEX IF NOT EXISTS idx_arch_event_ts     ON events(event, server_ts);
        `);
    }
    db.close();
}

/**
 * Ejecuta una rotación.
 * @param {{nowTs?:number, log?:(m:string)=>void, dryRun?:boolean,
 *          retentionDays?:number, eventsPath?:string, archivePath?:string,
 *          forceRun?:boolean}} [opts]
 */
export function rotateOnce(opts = {}) {
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const dryRun = !!opts.dryRun;
    const retention = opts.retentionDays ?? RETENTION_DAYS;
    const eventsPath = opts.eventsPath || dbPath('EVENTS_SQLITE_PATH', DEFAULT_EVENTS_PATH);
    const archivePath = opts.archivePath || dbPath('ARCHIVE_SQLITE_PATH', DEFAULT_ARCHIVE_PATH);

    const result = {
        ok: false, skipped: false, dryRun,
        retention_days: retention, cutoff_ts: nowTs - retention * 86_400_000,
        retention_months: ARCHIVE_RETENTION_MONTHS,
        expiry_cutoff_ts: subtractMonthsUtc(nowTs, ARCHIVE_RETENTION_MONTHS),
        candidates: 0, moved: 0, deleted: 0, expirable: 0, expired: 0,
        archive_size_bytes: null, durationMs: 0,
        integrity_pre: null, integrity_post: null,
        // 10B
        expiry_enabled: (opts.expiryEnabled ?? EXPIRY_ENABLED()),
        watermark: null, watermark_reason: null,
        candidates_by_age: 0, candidates_above_watermark: 0,
    };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    const t0 = Date.now();

    // ── 10B §13/§14 — frontera obligatoria por watermark ────────────────────
    // Una fila solo sale del vivo si ya fue materializada: `id <= watermark`.
    // Sin watermark valido NO se degrada a solo-edad; se salta la rotacion.
    const wm = readMaterializerWatermark({ insightsPath: opts.insightsPath });
    result.watermark = wm.watermark;
    result.watermark_reason = wm.reason;
    if (!wm.ok) {
        return { ...result, ok: true, skipped: true, candidates: 0,
            reason: `safe_skip_no_watermark:${wm.reason}`, durationMs: Date.now() - t0 };
    }
    const watermark = wm.watermark;

    // ── 10B §19 — dryRun SIN efectos: no crea el archivo, no abre en escritura.
    if (dryRun) {
        let ro = null, roArch = null;
        try {
            ro = new Database(eventsPath, { readonly: true, fileMustExist: true });
            ro.pragma('busy_timeout = 5000');
            result.candidates_by_age = ro.prepare(
                `SELECT COUNT(*) AS n FROM events WHERE server_ts <= ?`).get(result.cutoff_ts).n;
            result.candidates = ro.prepare(
                `SELECT COUNT(*) AS n FROM events WHERE server_ts <= ? AND id <= ?`
            ).get(result.cutoff_ts, watermark).n;
            result.candidates_above_watermark = result.candidates_by_age - result.candidates;
            if (fs.existsSync(archivePath)) {
                roArch = new Database(archivePath, { readonly: true, fileMustExist: true });
                result.expirable = roArch.prepare(
                    `SELECT COUNT(*) AS n FROM events WHERE server_ts < ?`).get(result.expiry_cutoff_ts).n;
                result.archive_size_bytes = fs.statSync(archivePath).size;
            }
            result.ok = true;
            log(`[archiveRotation] dryRun: ${result.candidates} candidates (age ${result.candidates_by_age}, above watermark ${result.candidates_above_watermark}), ${result.expirable} expirable, expiry=${result.expiry_enabled ? 'ON' : 'OFF'}`);
        } catch (e) {
            result.error = String(e?.message || e);
        } finally {
            if (ro) { try { ro.close(); } catch {} }
            if (roArch) { try { roArch.close(); } catch {} }
        }
        result.durationMs = Date.now() - t0;
        return result;
    }

    try {
        ensureArchiveSchema(archivePath);
        const db = new Database(eventsPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('busy_timeout = 10000');

        // Integrity pre
        try { result.integrity_pre = db.pragma('integrity_check', { simple: true }); } catch {}

        // Frontera 1 (inclusiva): elegible al alcanzar exactamente 90 días.
        const cutoff = result.cutoff_ts;
        // Frontera 2 (estricta): expira solo al SUPERAR 12 meses calendario.
        const expiry = result.expiry_cutoff_ts;

        result.candidates_by_age = db.prepare(
            `SELECT COUNT(*) AS n FROM events WHERE server_ts <= ?`
        ).get(cutoff).n;
        // 10B: solo lo ya materializado puede salir del vivo.
        const candidates = db.prepare(
            `SELECT COUNT(*) AS n FROM events WHERE server_ts <= ? AND id <= ?`
        ).get(cutoff, watermark).n;
        result.candidates = candidates;
        result.candidates_above_watermark = result.candidates_by_age - candidates;

        const closeAnd = (fn) => { try { db.exec(`DETACH DATABASE arch`); } catch {} db.close(); return fn(); };

        // ATTACH archive como segunda DB (también para contar/expirar).
        db.exec(`ATTACH DATABASE '${archivePath.replace(/'/g, "''")}' AS arch`);
        try {
            result.expirable = db.prepare(
                `SELECT COUNT(*) AS n FROM arch.events WHERE server_ts < ?`
            ).get(expiry).n;
            // 10B: con la expiracion apagada, `expirable` es solo observacion.
            const expiryOn = opts.expiryEnabled ?? EXPIRY_ENABLED();
            result.expiry_enabled = expiryOn;

            if (candidates === 0 && (!expiryOn || result.expirable === 0)) {
                result.ok = true;
                log(`[archiveRotation] no candidates (cutoff ${new Date(cutoff).toISOString()}, expiry ${new Date(expiry).toISOString()})`);
                return closeAnd(finalize);
            }
            // Una sola transacción SQLite: archivar → confirmar → retirar del
            // vivo SOLO lo confirmado → expirar del archivo. Cualquier fallo
            // hace ROLLBACK y deja events.db intacto.
            const tx = db.transaction(() => {
                const ins = db.prepare(
                    `INSERT OR IGNORE INTO arch.events
                       (id, event_id, schema_version, event, mode, user_id, content_id,
                        session_id, client_ts, server_ts, elapsed_ms, progress_fraction,
                        payload_json, created_at)
                     SELECT id, event_id, schema_version, event, mode, user_id, content_id,
                            session_id, client_ts, server_ts, elapsed_ms, progress_fraction,
                            payload_json, created_at
                     FROM events WHERE server_ts <= ? AND id <= ?`
                ).run(cutoff, watermark);
                result.moved = ins.changes;

                // Retirar del vivo únicamente las filas cuya presencia en el
                // archivo queda verificada por event_id (idempotente: una fila
                // ya archivada antes también se retira, sin duplicarse).
                const del = db.prepare(
                    `DELETE FROM events
                      WHERE server_ts <= ?
                        AND id <= ?
                        AND event_id IN (SELECT event_id FROM arch.events)`
                ).run(cutoff, watermark);
                result.deleted = del.changes;

                // 10B: la eliminacion definitiva (>12 meses) vive detras de su
                // propio gate. Con ARCHIVE_EXPIRY_ENABLED apagado no se borra
                // NI UNA fila del archivo, por antigua que sea.
                if (expiryOn) {
                    const exp = db.prepare(
                        `DELETE FROM arch.events WHERE server_ts < ?`
                    ).run(expiry);
                    result.expired = exp.changes;
                } else {
                    result.expired = 0;
                }
            });
            tx();
        } finally {
            try { db.exec(`DETACH DATABASE arch`); } catch {}
        }

        // Integrity post + checkpoint
        try { result.integrity_post = db.pragma('integrity_check', { simple: true }); } catch {}
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        if (VACUUM_AFTER) {
            try { db.exec('VACUUM'); } catch (e) { log(`[archiveRotation] VACUUM failed: ${e.message}`); }
        }
        db.close();

        // Métrica de tamaño del archive
        try {
            const sz = fs.statSync(archivePath).size;
            result.archive_size_bytes = sz;
            try { archiveGrowthBytes.set(sz); } catch {}
        } catch {}

        result.ok = true;
        log(`[archiveRotation] moved=${result.moved} deleted=${result.deleted} expired=${result.expired} expiry_enabled=${result.expiry_enabled} watermark=${watermark} candidates=${result.candidates} above_watermark=${result.candidates_above_watermark} cutoff=${new Date(cutoff).toISOString()} expiry=${new Date(expiry).toISOString()}`);
        return finalize();
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[archiveRotation] FAILED: ${result.error}`);
        return finalize();
    }

    function finalize() {
        result.durationMs = Date.now() - t0;
        return result;
    }
}

export function getStatus() {
    try {
        const archivePath = process.env.ARCHIVE_SQLITE_PATH || DEFAULT_ARCHIVE_PATH;
        const present = fs.existsSync(archivePath);
        const sz = present ? fs.statSync(archivePath).size : 0;
        return {
            engine: 'aula_viva_archive_rotation_v1',
            enabled: ENABLED(),
            retention_days: RETENTION_DAYS,
            retention_months: ARCHIVE_RETENTION_MONTHS,
            archive_present: present,
            archive_size_bytes: sz,
            archive_size_mb: +(sz / 1048576).toFixed(2),
            vacuum_after_rotation: VACUUM_AFTER,
            expiry_enabled: EXPIRY_ENABLED(),
            ok: true,
        };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
