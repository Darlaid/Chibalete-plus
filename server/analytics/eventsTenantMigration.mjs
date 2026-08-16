/**
 * eventsTenantMigration.mjs — CHP-STATS-INGEST-01B.
 *
 * Migración ADITIVA e IDEMPOTENTE de `events.db`: añade columnas de contexto
 * institucional verificado (`institution_id`, `group_id`) nullable, para que la
 * ingestión canónica endurecida pueda persistir el snapshot server-resuelto.
 *
 * Garantías:
 *   - SOLO `ALTER TABLE ... ADD COLUMN` (aditivo). Sin DROP, sin DELETE, sin
 *     UPDATE de eventos históricos, sin rewrite masivo.
 *   - Idempotente: si la columna ya existe, no hace nada. Re-ejecutable (2ª
 *     corrida = no-op seguro).
 *   - Eventos existentes quedan con institution_id=NULL / group_id=NULL (SQLite
 *     ADD COLUMN nullable rellena NULL). SIN backfill inventado.
 *
 * DORMANT: no se invoca en el arranque del runtime en esta unidad. Se ejecutará
 * en la activación controlada futura de INGEST (unidad aparte), nunca contra la
 * DB productiva aquí.
 *
 * Toma un handle better-sqlite3 ya abierto (inyección → testeable sin tocar
 * `eventsService`, que mantiene su propia conexión).
 */

export const TENANT_COLUMNS = Object.freeze([
    { name: 'institution_id', type: 'TEXT' },
    { name: 'group_id', type: 'TEXT' },
]);

/** Columnas actuales de la tabla `events` (nombres en minúscula). */
function existingColumns(db) {
    const rows = db.prepare('PRAGMA table_info(events)').all();
    return new Set(rows.map(r => String(r.name)));
}

/**
 * Aplica la migración aditiva. Devuelve el detalle de lo aplicado.
 * @param {import('better-sqlite3').Database} db  conexión abierta a events.db
 * @returns {{applied:string[], skipped:string[], alreadyMigrated:boolean}}
 */
export function migrateEventsTenantColumns(db) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('migrateEventsTenantColumns: db handle inválido');
    }
    // La tabla `events` debe existir (la crea eventsService.ensureSchema). Si no,
    // no migramos (no fabricamos schema base aquí).
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get();
    if (!tbl) throw new Error('migrateEventsTenantColumns: tabla events ausente');

    const applied = [];
    const skipped = [];
    // Transacción: o se añaden todas las faltantes o ninguna.
    const run = db.transaction(() => {
        const cols = existingColumns(db);
        for (const col of TENANT_COLUMNS) {
            if (cols.has(col.name)) { skipped.push(col.name); continue; }
            // ADD COLUMN nullable → filas existentes = NULL. Aditivo puro.
            db.prepare(`ALTER TABLE events ADD COLUMN ${col.name} ${col.type}`).run();
            applied.push(col.name);
        }
    });
    run();

    return { applied, skipped, alreadyMigrated: applied.length === 0 };
}

/** True si events.db ya tiene las columnas de contexto. */
export function eventsTenantColumnsPresent(db) {
    const cols = existingColumns(db);
    return TENANT_COLUMNS.every(c => cols.has(c.name));
}
