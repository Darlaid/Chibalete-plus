/**
 * publishersStore.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-A.
 *
 * Registro único de titulares (editoriales y terceros con derechos económicos)
 * en `data-critical/royalties.db`. Plan: docs/royalties/PLAN_GENERAL_V1_1.md §3.
 *
 * - Una sola base para todo el módulo; esta unidad solo crea `publishers`.
 * - Migraciones con el runner existente (server/db/migrate.js) sobre
 *   server/royalties/migrations/.
 * - Apertura PEREZOSA: tests y desarrollo nunca crean la base real por el
 *   mero hecho de arrancar el servidor. En producción server.js la abre al
 *   arrancar (el inventario de respaldos la exige presente).
 * - La identidad (`id`) la asigna el servidor y es inmutable.
 * - Sin datos bancarios: solo identidad, contacto, estado y referencias
 *   administrativas.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../db/migrate.js';
import { ulid } from '../ulid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'royalties.db');

export const CHIBALETE_PUBLISHER_ID = 'pub-chibalete-editores';
export const PUBLISHER_KINDS = Object.freeze(['editorial', 'tercero']);
export const PUBLISHER_STATUSES = Object.freeze(['active', 'inactive']);

export class PublisherError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'PublisherError';
        this.status = status;
        this.code = code;
    }
}

export const resolveRoyaltiesDbPath = () =>
    (process.env.ROYALTIES_DB ? path.resolve(process.env.ROYALTIES_DB) : DEFAULT_DB_PATH);

let _db = null;

/** Abre (y migra) la base. Idempotente; seguro con dos réplicas. */
export function getRoyaltiesDb(log = () => {}) {
    if (_db) return _db;
    const dbPath = resolveRoyaltiesDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    const opts = { dir: MIGRATIONS_DIR, tag: 'royalties-migrate' };
    try {
        runMigrations(db, log, opts);
    } catch (e) {
        // La otra réplica pudo aplicar la misma versión entre la lectura de
        // `_migrations` y nuestra transacción: reintentar ya la ve aplicada.
        log(`[royalties-migrate] retry after: ${e.message}`);
        runMigrations(db, log, opts);
    }
    _db = db;
    return db;
}

/** Solo para tests / shutdown ordenado. */
export function closeRoyaltiesDb() {
    if (_db) { try { _db.close(); } catch { /* noop */ } _db = null; }
}

// ── validación ──────────────────────────────────────────────────────────────

const TEXT_FIELDS = {
    legalName: { col: 'legal_name', max: 200 },
    tradeName: { col: 'trade_name', max: 200 },
    taxId: { col: 'tax_id', max: 40 },
    contactName: { col: 'contact_name', max: 120 },
    contactEmail: { col: 'contact_email', max: 160 },
    contactPhone: { col: 'contact_phone', max: 40 },
    notes: { col: 'notes', max: 1000 },
};
const SERVER_OWNED = new Set(['id', 'createdAt', 'updatedAt']);
const ALLOWED = new Set(['kind', 'status', 'imprints', ...Object.keys(TEXT_FIELDS)]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const bad = (code, message) => new PublisherError(400, code, message);

/** Normaliza la entrada a columnas. `partial` = PUT (solo los campos enviados). */
function toColumns(input, { partial }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('invalid_body', 'Cuerpo inválido');
    for (const k of Object.keys(input)) {
        if (!ALLOWED.has(k) && !SERVER_OWNED.has(k)) throw bad('unknown_field', `Campo no admitido: ${k}`);
    }
    const cols = {};
    if ('kind' in input || !partial) {
        if (!PUBLISHER_KINDS.includes(input.kind)) throw bad('invalid_kind', 'kind debe ser "editorial" o "tercero"');
        cols.kind = input.kind;
    }
    if ('status' in input) {
        if (!PUBLISHER_STATUSES.includes(input.status)) throw bad('invalid_status', 'status debe ser "active" o "inactive"');
        cols.status = input.status;
    }
    for (const [key, { col, max }] of Object.entries(TEXT_FIELDS)) {
        if (!(key in input)) continue;
        const v = input[key];
        if (v === null || v === '') { cols[col] = null; continue; }
        if (typeof v !== 'string') throw bad('invalid_field', `${key} debe ser texto`);
        const t = v.trim();
        if (t.length > max) throw bad('invalid_field', `${key} supera ${max} caracteres`);
        cols[col] = t || null;
    }
    if ('legal_name' in cols || !partial) {
        if (!cols.legal_name) throw bad('legal_name_required', 'La razón social es obligatoria');
    }
    if (cols.contact_email && !EMAIL_RE.test(cols.contact_email)) throw bad('invalid_email', 'Correo de contacto inválido');
    if ('imprints' in input) {
        const list = input.imprints;
        if (!Array.isArray(list) || list.length > 30 || !list.every((s) => typeof s === 'string' && s.trim() && s.trim().length <= 120)) {
            throw bad('invalid_imprints', 'imprints debe ser una lista de hasta 30 sellos (texto)');
        }
        cols.imprints = JSON.stringify([...new Set(list.map((s) => s.trim()))]);
    }
    return cols;
}

function toApi(row) {
    if (!row) return null;
    let imprints = [];
    try { imprints = JSON.parse(row.imprints || '[]'); } catch { imprints = []; }
    return {
        id: row.id,
        kind: row.kind,
        legalName: row.legal_name,
        tradeName: row.trade_name,
        taxId: row.tax_id,
        imprints,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone,
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ── operaciones ─────────────────────────────────────────────────────────────

export function listPublishers(db = getRoyaltiesDb()) {
    return db.prepare('SELECT * FROM publishers ORDER BY legal_name COLLATE NOCASE, id').all().map(toApi);
}

export function getPublisher(id, db = getRoyaltiesDb()) {
    if (typeof id !== 'string' || !id) return null;
    return toApi(db.prepare('SELECT * FROM publishers WHERE id = ?').get(id));
}

export function createPublisher(input, { now = new Date().toISOString(), db = getRoyaltiesDb() } = {}) {
    const cols = toColumns(input, { partial: false });
    const row = {
        id: `pub-${ulid().toLowerCase()}`,
        status: 'active',
        imprints: '[]',
        ...cols,
        created_at: now,
        updated_at: now,
    };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO publishers (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(row);
    return getPublisher(row.id, db);
}

export function updatePublisher(id, input, { now = new Date().toISOString(), db = getRoyaltiesDb() } = {}) {
    if (!getPublisher(id, db)) throw new PublisherError(404, 'not_found', 'Titular no encontrado');
    const cols = toColumns(input, { partial: true });
    const keys = Object.keys(cols);
    if (keys.length) {
        db.prepare(`UPDATE publishers SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
            .run({ ...cols, updated_at: now, id });
    }
    return getPublisher(id, db);
}

/**
 * Borra un titular solo si nada lo referencia. `referenceCount` lo calcula el
 * llamador (contenidos con ese publisherId). El registro permanente de
 * Chibalete Editores nunca se borra; para retirarlo se desactiva.
 */
export function deletePublisher(id, { referenceCount, db = getRoyaltiesDb() }) {
    if (!getPublisher(id, db)) throw new PublisherError(404, 'not_found', 'Titular no encontrado');
    if (id === CHIBALETE_PUBLISHER_ID) throw new PublisherError(409, 'protected_publisher', 'Este titular es permanente; desactívalo en lugar de borrarlo');
    if (!Number.isInteger(referenceCount) || referenceCount > 0) {
        throw new PublisherError(409, 'publisher_referenced', `El titular está asociado a ${referenceCount} contenido(s); desactívalo en lugar de borrarlo`);
    }
    db.prepare('DELETE FROM publishers WHERE id = ?').run(id);
}
