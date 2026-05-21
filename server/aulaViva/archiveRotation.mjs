/**
 * archiveRotation.mjs — Aula Viva PASO 5 §20.
 *
 * Rota eventos antiguos (server_ts < now - RETENTION_DAYS) desde events.db
 * hacia events.archive.db. Pattern:
 *   1. ATTACH archive como segunda DB
 *   2. INSERT OR IGNORE archive.events SELECT * FROM main.events WHERE old
 *   3. DELETE FROM main.events WHERE old
 *   4. VACUUM main (opcional, gated)  — recupera espacio
 *   5. PRAGMA wal_checkpoint(TRUNCATE) — libera WAL
 *
 * Toda la operación en tx. Si falla cualquier paso, ROLLBACK → cero pérdida.
 *
 * Idempotente: dos corridas seguidas → la 2da no hace nada (no quedan
 * eventos viejos).
 *
 * GATING:
 *   ARCHIVE_ROTATION_ENABLED=1  → rotateOnce activo (default OFF).
 *
 * Verificación integrity_check antes y después.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { archiveGrowthBytes } from '../observability/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVENTS_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');
const DEFAULT_ARCHIVE_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'events.archive.db');

const RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS || 90);
const VACUUM_AFTER = process.env.ARCHIVE_VACUUM_AFTER_ROTATION === '1';

export const ENABLED = () => process.env.ARCHIVE_ROTATION_ENABLED === '1';

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
        candidates: 0, moved: 0, deleted: 0,
        archive_size_bytes: null, durationMs: 0,
        integrity_pre: null, integrity_post: null,
    };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    const t0 = Date.now();
    try {
        ensureArchiveSchema(archivePath);
        const db = new Database(eventsPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('busy_timeout = 10000');

        // Integrity pre
        try { result.integrity_pre = db.pragma('integrity_check', { simple: true }); } catch {}

        const cutoff = result.cutoff_ts;
        const candidates = db.prepare(
            `SELECT COUNT(*) AS n FROM events WHERE server_ts < ?`
        ).get(cutoff).n;
        result.candidates = candidates;

        if (candidates === 0) {
            db.close();
            result.ok = true;
            log(`[archiveRotation] no candidates (cutoff ${new Date(cutoff).toISOString()})`);
            return finalize();
        }

        if (dryRun) {
            db.close();
            result.ok = true;
            log(`[archiveRotation] dryRun: ${candidates} candidates`);
            return finalize();
        }

        // ATTACH archive como segunda DB.
        db.exec(`ATTACH DATABASE '${archivePath.replace(/'/g, "''")}' AS arch`);
        try {
            const tx = db.transaction(() => {
                const ins = db.prepare(
                    `INSERT OR IGNORE INTO arch.events
                       (id, event_id, schema_version, event, mode, user_id, content_id,
                        session_id, client_ts, server_ts, elapsed_ms, progress_fraction,
                        payload_json, created_at)
                     SELECT id, event_id, schema_version, event, mode, user_id, content_id,
                            session_id, client_ts, server_ts, elapsed_ms, progress_fraction,
                            payload_json, created_at
                     FROM events WHERE server_ts < ?`
                ).run(cutoff);
                result.moved = ins.changes;

                const del = db.prepare(
                    `DELETE FROM events WHERE server_ts < ?`
                ).run(cutoff);
                result.deleted = del.changes;
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
        log(`[archiveRotation] moved=${result.moved} deleted=${result.deleted} cutoff=${new Date(cutoff).toISOString()}`);
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
            archive_present: present,
            archive_size_bytes: sz,
            archive_size_mb: +(sz / 1048576).toFixed(2),
            vacuum_after_rotation: VACUUM_AFTER,
            ok: true,
        };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
