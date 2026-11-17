/**
 * contextLedger.mjs — CHP V9 F7-C2R-U1.
 *
 * Procedencia TEMPORAL del contexto pedagógico. Ni las reglas de acceso ni las membresías guardan desde cuándo valen:
 * sin ese dato una lectura anterior a la asignación de una obra, o al ingreso del lector al curso, sería
 * indistinguible de la actividad del curso. Este registro anota, hacia adelante, los intervalos en los que el servidor
 * OBSERVÓ cada asociación:
 *
 *   kind 'work'    (grupo, obra)    la obra está asociada al grupo (`'*'` = «todas», dato heredado del grupo)
 *   kind 'member'  (grupo, lector)  el lector es miembro del grupo
 *
 * No reconstruye historia: la primera observación abre los intervalos con `origin = 'baseline'`, que significa «vigente
 * al menos desde aquí; su inicio real se desconoce». Lo anterior a un `baseline` NO es verificable y no se atribuye.
 * Las asociaciones que aparecen después se abren con `origin = 'observed'` (inicio conocido); las que desaparecen se
 * cierran con `until_ts`. Nunca se borra ni se reescribe un intervalo.
 *
 * Vive en insights.db (INSIGHTS_SQLITE_PATH), con el resto del almacén de Aula Viva: mismo respaldo, mismo aislamiento
 * de pruebas, WAL compartido entre réplicas. Solo guarda identificadores de grupo, obra y lector y marcas de tiempo.
 * El lector va en la columna `user_id`: es la convención con la que la supresión de datos de una persona
 * (`privacy/suppression.mjs`) localiza y elimina sus filas en este almacén, sin lista de tablas.
 *
 * GATING: `AULA_VIVA_CONTEXT_LEDGER_ENABLED=1` (apagado por defecto). Apagado no se abre ni se escribe nada, y todo
 * el historial queda como no verificable.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.INSIGHTS_SQLITE_PATH || path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');

export const ENABLED = () => process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED === '1';
/** Marcador de «todas las obras» (grupo heredado con `availableContentIds: 'all'`). */
export const ALL_WORKS = '*';

let _db = null, _st = null;
function db() {
    if (_db) return _db;
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    // Corto a propósito: una observación que no consigue el turno se omite y la siguiente la recupera.
    _db.pragma('busy_timeout = 1500');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS pedagogical_context_intervals (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        kind      TEXT NOT NULL CHECK (kind IN ('work','member')),
        group_id  TEXT NOT NULL,
        work_id   TEXT,                 -- kind 'work'
        user_id   TEXT,                 -- kind 'member' (lector)
        since_ts  INTEGER NOT NULL,
        until_ts  INTEGER,
        origin    TEXT NOT NULL CHECK (origin IN ('baseline','observed')),
        CHECK ((kind = 'work' AND work_id IS NOT NULL AND user_id IS NULL) OR (kind = 'member' AND user_id IS NOT NULL AND work_id IS NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pci_open ON pedagogical_context_intervals(kind, group_id, IFNULL(work_id, ''), IFNULL(user_id, '')) WHERE until_ts IS NULL;
      CREATE INDEX IF NOT EXISTS idx_pci_group ON pedagogical_context_intervals(group_id, kind);
      CREATE TABLE IF NOT EXISTS pedagogical_context_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    _st = {
        open:      _db.prepare(`SELECT id, kind, group_id, IFNULL(work_id, user_id) AS item_id FROM pedagogical_context_intervals WHERE until_ts IS NULL`),
        insert:    _db.prepare(`INSERT INTO pedagogical_context_intervals (kind, group_id, work_id, user_id, since_ts, until_ts, origin) VALUES (@kind, @group_id, @work_id, @user_id, @since_ts, NULL, @origin)`),
        close:     _db.prepare(`UPDATE pedagogical_context_intervals SET until_ts = ? WHERE id = ? AND until_ts IS NULL`),
        ofGroup:   _db.prepare(`SELECT kind, IFNULL(work_id, user_id) AS item_id, since_ts, until_ts, origin FROM pedagogical_context_intervals WHERE group_id = ? ORDER BY since_ts ASC, id ASC`),
        getMeta:   _db.prepare(`SELECT value FROM pedagogical_context_meta WHERE key = ?`),
        setMeta:   _db.prepare(`INSERT INTO pedagogical_context_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
        counts:    _db.prepare(`SELECT kind, origin, COUNT(*) AS n, SUM(until_ts IS NULL) AS open FROM pedagogical_context_intervals GROUP BY kind, origin`),
    };
    return _db;
}
export function closeContextLedger() { if (_db) { try { _db.close(); } catch { /* ya cerrada */ } } _db = null; _st = null; }

const keyOf = (kind, groupId, itemId) => `${kind}\u0000${groupId}\u0000${itemId}`;

/**
 * Reconcilia el registro con el estado ACTUAL de las asociaciones. Idempotente; una transacción inmediata por llamada,
 * así que dos réplicas que observan a la vez dejan el mismo resultado.
 *
 * @param {Array<{groupId:string, works:string[], members:string[]}>} snapshot  estado completo y leído sin errores
 * @param {{nowTs?:number}} [opts]
 * @returns {{ok:boolean, skipped?:string, opened:number, closed:number, baseline:boolean}}
 */
export function observeContext(snapshot, opts = {}) {
    const out = { ok: false, opened: 0, closed: 0, baseline: false };
    if (!ENABLED()) return { ...out, ok: true, skipped: 'disabled' };
    if (!Array.isArray(snapshot)) return { ...out, skipped: 'invalid_snapshot' };
    const nowTs = opts.nowTs ?? Date.now();
    const desired = new Map();
    for (const g of snapshot) {
        const gid = typeof g?.groupId === 'string' ? g.groupId : '';
        if (!gid) continue;
        for (const w of new Set((g.works || []).map(String))) if (w) desired.set(keyOf('work', gid, w), ['work', gid, w]);
        for (const m of new Set((g.members || []).map(String))) if (m) desired.set(keyOf('member', gid, m), ['member', gid, m]);
    }
    db();
    const run = _db.transaction(() => {
        const open = _st.open.all();
        // Una lectura vacía con intervalos abiertos es casi siempre un fallo de lectura, no un colegio que desapareció:
        // cerrarlo todo destruiría la continuidad verificable. Se omite; la siguiente observación decide.
        if (desired.size === 0 && open.length > 0) return 'empty_snapshot';
        const baseline = !_st.getMeta.get('baseline_ts');
        const seen = new Set();
        for (const row of open) {
            const k = keyOf(row.kind, row.group_id, row.item_id);
            if (desired.has(k)) seen.add(k);
            else { _st.close.run(nowTs, row.id); out.closed++; }
        }
        for (const [k, [kind, gid, item]] of desired) {
            if (seen.has(k)) continue;
            _st.insert.run({ kind, group_id: gid, work_id: kind === 'work' ? item : null, user_id: kind === 'member' ? item : null,
                since_ts: nowTs, origin: baseline ? 'baseline' : 'observed' });
            out.opened++;
        }
        if (baseline) { _st.setMeta.run('baseline_ts', String(nowTs)); out.baseline = true; }
        _st.setMeta.run('last_observed_ts', String(nowTs));
        return null;
    });
    try {
        const skipped = run.immediate();
        if (skipped) return { ...out, ok: true, skipped };
        out.ok = true;
    } catch (e) {
        return { ...out, skipped: e?.code === 'SQLITE_BUSY' ? 'busy' : 'error', error: String(e?.message || e) };
    }
    return out;
}

/**
 * Intervalos registrados de unos grupos.
 * @param {Iterable<string>} groupIds
 * @returns {Map<string, {work: Map<string, Array<{since:number, until:number|null, origin:string}>>, member: Map<string, Array<{since:number, until:number|null, origin:string}>>}>}
 *          Mapa vacío si el registro está apagado.
 */
export function contextIntervals(groupIds) {
    const out = new Map();
    if (!ENABLED()) return out;
    db();
    for (const gid of new Set([...groupIds].map(String))) {
        const entry = { work: new Map(), member: new Map() };
        for (const r of _st.ofGroup.all(gid)) {
            const m = entry[r.kind];
            if (!m.has(r.item_id)) m.set(r.item_id, []);
            m.get(r.item_id).push({ since: r.since_ts, until: r.until_ts ?? null, origin: r.origin });
        }
        out.set(gid, entry);
    }
    return out;
}

/** Estado agregado (salud y medición): solo recuentos y marcas de tiempo, ningún identificador. */
export function ledgerStatus() {
    if (!ENABLED()) return { enabled: false };
    try {
        db();
        const num = (k) => { const v = _st.getMeta.get(k)?.value; return v ? Number(v) : null; };
        return { enabled: true, baseline_ts: num('baseline_ts'), last_observed_ts: num('last_observed_ts'),
            intervals: _st.counts.all().map((r) => ({ kind: r.kind, origin: r.origin, total: r.n, open: r.open })) };
    } catch (e) { return { enabled: true, error: String(e?.message || e) }; }
}
