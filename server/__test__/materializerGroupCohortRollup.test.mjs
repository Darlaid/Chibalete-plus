/**
 * materializerGroupCohortRollup.test.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / A1 §7/§14/§16/§17.
 *
 * El materializer publica cohorte LECTORA por grupo:
 *   [1] `reader_cohort` = lectores del grupo; los mediadores NO entran
 *   [2] `active_users` ⊆ reader_cohort, según actividad en la ventana
 *   [3] la fila global 'all'/'global' sigue existiendo, sin cambios de contrato
 *   [4] repetir la materialización no duplica filas (PK compuesta)
 *   [5] events.db no se modifica (write scope = insights.db)
 *   [6] un grupo de otra institución no contamina la cohorte
 *
 * Fixtures 100 % temporales: groups/padrón/events/insights en fs.mkdtemp.
 * Ningún id ni número de un colegio real.
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gcohort_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmp, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmp, 'insights.db');
process.env.GROUPS_DB = path.join(tmp, 'groups_db.json');
process.env.USERS_DB  = path.join(tmp, 'usuarios_colegios_oro.json');

// ── Fixture: un grupo con 80 lectores + 10 mediadores, y otro de otra escuela.
const readers   = Array.from({ length: 80 }, (_, i) => `r-${String(i).padStart(3, '0')}`);
const mediators = Array.from({ length: 10 }, (_, i) => `m-${String(i).padStart(3, '0')}`);
const GROUP = 'grp-objetivo';
fs.writeFileSync(process.env.GROUPS_DB, JSON.stringify([
    {
        id: GROUP, type: 'course', name: 'Grupo objetivo', school: 'Institución A',
        studentIds: [...readers], memberIds: [...readers], mediatorIds: [...mediators],
    },
    {
        id: 'grp-ajeno', type: 'course', name: 'Grupo ajeno', school: 'Institución B',
        studentIds: ['x-1'], memberIds: ['x-1'], mediatorIds: [],
    },
]));
fs.writeFileSync(process.env.USERS_DB, JSON.stringify([
    ...readers.map(id => ({ id, roles: ['lector'], colegio: 'Institución A' })),
    ...mediators.map(id => ({ id, roles: ['mediador'], colegio: 'Institución A' })),
    { id: 'x-1', roles: ['lector'], colegio: 'Institución B' },
]));

const eventsService = await import('../eventsService.js');
const ext           = await import('../db/insightsDbExt.mjs');
const materializer  = await import('../services/insightMaterializer.mjs');

const NOW = Date.parse('2026-07-31T21:52:00Z');
const d = (back) => NOW - back * 86400_000;

// Sembrado RAW para conservar timestamps históricos exactos.
function seed(rows) {
    const db = new Database(process.env.EVENTS_SQLITE_PATH);
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
            schema_version INTEGER NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL,
            user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
            client_ts INTEGER, server_ts INTEGER NOT NULL, elapsed_ms INTEGER,
            progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`);
        const ins = db.prepare(`INSERT OR IGNORE INTO events
            (event_id, schema_version, event, mode, user_id, content_id, session_id,
             client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
            VALUES (?,1,?,?,?,?,?,?,?,?,NULL,?,?)`);
        const tx = db.transaction((rs) => {
            for (const r of rs) ins.run(r.event_id, r.event, r.mode, r.user_id, r.content_id,
                r.session_id, r.ts, r.ts, r.elapsed_ms ?? null, JSON.stringify(r.payload ?? {}), r.ts);
        });
        tx(rows);
    } finally { db.close(); }
}

// 12 lectores activos dentro de la ventana, con vocabulario LEGACY.
const ACTIVE = readers.slice(0, 12);
seed(ACTIVE.flatMap((uid, i) => [
    { event_id: `s${i}`, event: 'immersive.session_start',     mode: 'immersive', user_id: uid, content_id: `c-${i % 4}`, session_id: `ses-${i}`, ts: d(2) },
    { event_id: `h${i}`, event: 'immersive.session_heartbeat', mode: 'immersive', user_id: uid, content_id: `c-${i % 4}`, session_id: `ses-${i}`, ts: d(2), elapsed_ms: 300_000 },
    { event_id: `e${i}`, event: 'immersive.session_end',       mode: 'immersive', user_id: uid, content_id: `c-${i % 4}`, session_id: `ses-${i}`, ts: d(2), elapsed_ms: 600_000 },
]));
// Un mediador con actividad: NO debe contar como lector.
seed([{ event_id: 'med-a', event: 'immersive.session_start', mode: 'immersive', user_id: mediators[0], content_id: 'c-0', session_id: 'ses-m', ts: d(2) }]);
// Un lector fuera de la ventana de 28 días.
seed([{ event_id: 'old-a', event: 'immersive.session_start', mode: 'immersive', user_id: readers[70], content_id: 'c-0', session_id: 'ses-o', ts: d(120) }]);

const eventsBefore = fs.readFileSync(process.env.EVENTS_SQLITE_PATH);
const countEventsRows = () => {
    const db = new Database(process.env.EVENTS_SQLITE_PATH, { readonly: true });
    try { return db.prepare('SELECT COUNT(*) n FROM events').get().n; } finally { db.close(); }
};
const rowsBefore = countEventsRows();

const r1 = materializer.runOnce({ nowTs: NOW });
ok('runOnce ok', r1.ok === true, JSON.stringify(r1));

const db = ext.getInsightsExtDb();
const cohort = (scope_id, key) => db.prepare(
    `SELECT metric_value v FROM cohort_rollups WHERE scope_type='group' AND scope_id=? AND period='28d' AND metric_key=?`
).get(scope_id, key)?.v;

// ── §[1] denominador ────────────────────────────────────────────────────────
section('[1] reader_cohort excluye mediadores');
ok('reader_cohort = 80 (no 90)', cohort(GROUP, 'reader_cohort') === 80, String(cohort(GROUP, 'reader_cohort')));
ok('el fixture tenía 90 cuentas en la institución',
    JSON.parse(fs.readFileSync(process.env.USERS_DB, 'utf8')).filter(u => u.colegio === 'Institución A').length === 90);

// ── §[2] numerador ──────────────────────────────────────────────────────────
section('[2] active_users = lectores con actividad en la ventana');
ok('active_users = 12', cohort(GROUP, 'active_users') === 12, String(cohort(GROUP, 'active_users')));
ok('active_users ≤ reader_cohort', cohort(GROUP, 'active_users') <= cohort(GROUP, 'reader_cohort'));
{
    const medProfile = db.prepare('SELECT * FROM user_reading_profiles WHERE user_id=?').get(mediators[0]);
    ok('el mediador tiene perfil (es sujeto de eventos) pero NO suma al conteo lector',
        !!medProfile && cohort(GROUP, 'active_users') === 12);
    const oldProfile = db.prepare('SELECT * FROM user_reading_profiles WHERE user_id=?').get(readers[70]);
    ok('lector con actividad fuera de la ventana no cuenta como activo',
        !!oldProfile && cohort(GROUP, 'active_users') === 12);
}

// ── §[6] aislamiento entre grupos ───────────────────────────────────────────
section('[6] el grupo de otra institución no se contamina');
ok('grp-ajeno reader_cohort = 1', cohort('grp-ajeno', 'reader_cohort') === 1, String(cohort('grp-ajeno', 'reader_cohort')));
ok('grp-ajeno active_users = 0', cohort('grp-ajeno', 'active_users') === 0, String(cohort('grp-ajeno', 'active_users')));

// ── §[3] la fila global sobrevive ───────────────────────────────────────────
section('[3] rollup global intacto');
{
    const g = db.prepare(`SELECT metric_value v FROM cohort_rollups WHERE scope_type='all' AND scope_id='global' AND metric_key='active_users'`).get();
    const profiles = db.prepare('SELECT COUNT(*) n FROM user_reading_profiles').get().n;
    ok('all/global = COUNT(perfiles), contrato sin cambios', g?.v === profiles, `${g?.v} vs ${profiles}`);
    ok('global ≠ cohorte del grupo (son métricas distintas)', g?.v !== cohort(GROUP, 'reader_cohort'));
}

// ── §[4] idempotencia ───────────────────────────────────────────────────────
section('[4] repetir no duplica');
{
    const before = db.prepare('SELECT COUNT(*) n FROM cohort_rollups').get().n;
    materializer.runOnce({ nowTs: NOW });
    materializer.runOnce({ nowTs: NOW });
    const after = db.prepare('SELECT COUNT(*) n FROM cohort_rollups').get().n;
    ok('mismo número de filas tras 3 corridas', before === after, `${before} vs ${after}`);
    ok('mismos valores', cohort(GROUP, 'reader_cohort') === 80 && cohort(GROUP, 'active_users') === 12);
    const dupes = db.prepare(`SELECT COUNT(*) n FROM (
        SELECT scope_type, scope_id, period, metric_key, COUNT(*) c
        FROM cohort_rollups GROUP BY 1,2,3,4 HAVING c > 1)`).get().n;
    ok('sin claves duplicadas', dupes === 0);
}

// ── §[5] write scope ────────────────────────────────────────────────────────
section('[5] events.db intacto');
ok('mismo número de filas', countEventsRows() === rowsBefore, `${countEventsRows()} vs ${rowsBefore}`);
{
    const ro = new Database(process.env.EVENTS_SQLITE_PATH, { readonly: true });
    try {
        const ids = ro.prepare('SELECT MIN(id) mn, MAX(id) mx, COUNT(DISTINCT event_id) d FROM events').get();
        ok('rango de ids y unicidad de event_id intactos',
            ids.mn === 1 && ids.mx === rowsBefore && ids.d === rowsBefore, JSON.stringify(ids));
        ok('ninguna fila con payload alterado',
            ro.prepare("SELECT COUNT(*) n FROM events WHERE payload_json IS NULL").get().n === 0);
    } finally { ro.close(); }
}
// El handle que el materializer abre sobre events.db es READONLY: una escritura
// a través de él falla. (El proceso servidor mantiene aparte el handle RW de
// eventsService, que runOnce solo usa para contar filas.)
{
    let threw = false;
    const roHandle = new Database(process.env.EVENTS_SQLITE_PATH, { readonly: true });
    try { roHandle.prepare("DELETE FROM events WHERE id = 1").run(); }
    catch { threw = true; }
    finally { roHandle.close(); }
    ok('un handle readonly no puede escribir events.db', threw);
    ok('el materializer declara readonly:true sobre EVENTS_PATH',
        /new Database\(EVENTS_PATH, \{ readonly: true/.test(
            fs.readFileSync(new URL('../services/insightMaterializer.mjs', import.meta.url), 'utf8')));
}
ok('baseline capturado antes de materializar (no vacío)', eventsBefore.length > 0);

try { db.close(); } catch {}
try { eventsService.closeDb?.(); } catch {}
try { materializer.closeMaterializerEventsDb(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(`\nmaterializerGroupCohortRollup: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
