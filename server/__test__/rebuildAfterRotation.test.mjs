/**
 * rebuildAfterRotation.test.mjs — CHP-V6-EVENTS-RETENTION-01 / 10B §7-I, §30.
 *
 * El gate de fondo de 10A: reconstruir la historia DESPUÉS de rotar debe dar
 * exactamente el mismo resultado que antes de rotar.
 *
 *   1. dataset completo en hot → rebuild → huella lógica A
 *   2. rotar (parte se va al archivo)
 *   3. rebuild del MISMO corte sobre hot ∪ archive → huella lógica B
 *   4. A == B
 *
 * Y el contrapunto que prueba que el test no es trivial: un rebuild que mirase
 * solo la caliente después de rotar daría un resultado DISTINTO.
 *
 * Además: el camino incremental sigue leyendo solo la caliente.
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-21T12:00:00Z');
const CUT = NOW;                       // corte del "informe" = ahora
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rebuild_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmp, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmp, 'insights.db');
process.env.ARCHIVE_SQLITE_PATH  = path.join(tmp, 'events.archive.db');
process.env.GROUPS_DB = path.join(tmp, 'groups_db.json');
process.env.USERS_DB  = path.join(tmp, 'usuarios_colegios_oro.json');
fs.writeFileSync(process.env.GROUPS_DB, '[]');
fs.writeFileSync(process.env.USERS_DB, '[]');

const EV_DDL = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
  event TEXT NOT NULL, mode TEXT NOT NULL, user_id TEXT NOT NULL, content_id TEXT,
  session_id TEXT NOT NULL, client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
  elapsed_ms INTEGER, progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`;

// 3 usuarios "antiguos" (solo actividad de hace 200 d, irán al archivo) y
// 2 "recientes" (últimos 10 d, se quedan en hot). Mezcla de eventos legacy.
const rows = [];
let id = 0;
const push = (user, daysAgo, event, extra = {}) => {
    const ts = NOW - daysAgo * DAY;
    rows.push({ id: ++id, event_id: `ev-${id}`, event, mode: 'immersive', user_id: user,
        content_id: `c-${id % 4}`, session_id: `s-${user}-${daysAgo}`, client_ts: ts, server_ts: ts,
        elapsed_ms: extra.elapsed_ms ?? null, payload_json: '{}', created_at: ts });
};
for (const u of ['viejo-1', 'viejo-2', 'viejo-3']) {
    push(u, 200, 'immersive.session_start');
    push(u, 200, 'immersive.session_heartbeat', { elapsed_ms: 600_000 });
    push(u, 199, 'immersive.session_end', { elapsed_ms: 900_000 });
    push(u, 198, 'immersive.session_completed');
}
for (const u of ['nuevo-1', 'nuevo-2']) {
    push(u, 10, 'immersive.session_start');
    push(u, 10, 'immersive.session_heartbeat', { elapsed_ms: 300_000 });
    push(u, 9, 'immersive.session_end', { elapsed_ms: 420_000 });
}

function seedEvents(p) {
    try { for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true }); } catch {}
    const db = new Database(p); db.exec(EV_DDL);
    const ins = db.prepare(`INSERT INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
      VALUES (@id,@event_id,1,@event,@mode,@user_id,@content_id,@session_id,@client_ts,@server_ts,@elapsed_ms,NULL,@payload_json,@created_at)`);
    db.transaction(rs => rs.forEach(r => ins.run(r)))(rows);
    db.close();
}
function seedInsights(p, watermark) {
    try { for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true }); } catch {}
    const i = new Database(p);
    i.exec(`CREATE TABLE IF NOT EXISTS materializer_state (
        materializer_name TEXT PRIMARY KEY, last_event_id INTEGER NOT NULL, last_ts INTEGER,
        updated_at INTEGER, lag_events INTEGER, lag_seconds INTEGER, degraded INTEGER, last_error TEXT)`);
    i.prepare(`INSERT INTO materializer_state VALUES ('aula_viva_pedagogical_v1',?,0,?,0,0,0,NULL)`).run(watermark, NOW);
    i.close();
}

const mat = await import('../services/insightMaterializer.mjs');
const rot = await import('../aulaViva/archiveRotation.mjs');
const ext = await import('../db/insightsDbExt.mjs');

/** Huella lógica de las proyecciones, ignorando timestamps de ejecución. */
function fingerprint() {
    const db = ext.getInsightsExtDb();
    const snaps = db.prepare(`SELECT scope_type,scope_id,signal_id,period,metric_value,confidence
        FROM signal_snapshots ORDER BY scope_id,signal_id`).all();
    const profs = db.prepare(`SELECT user_id,fluidez_score,persistencia_score,autonomia_score,concentracion_score,
        diversidad_score,engagement_score,abandono_risk,last_active_at FROM user_reading_profiles ORDER BY user_id`).all();
    const coh = db.prepare(`SELECT scope_type,scope_id,period,metric_key,metric_value FROM cohort_rollups
        ORDER BY scope_type,scope_id,metric_key`).all();
    return { users: new Set(profs.map(p => p.user_id)).size,
        snaps: snaps.length, profiles: profs.length, cohorts: coh.length,
        sha: JSON.stringify({ snaps, profs, coh }) };
}
const resetInsightsProjections = () => {
    const db = ext.getInsightsExtDb();
    db.exec('DELETE FROM signal_snapshots; DELETE FROM user_reading_profiles; DELETE FROM cohort_rollups;');
};

// ── 1. rebuild con TODO en caliente ──────────────────────────────────────────
section('[1] rebuild ANTES de rotar (todo en hot)');
seedEvents(process.env.EVENTS_SQLITE_PATH);
seedInsights(process.env.INSIGHTS_SQLITE_PATH, 10_000);
const r0 = mat.rebuildInsights({ fromTs: 0, toTs: CUT });
const before = fingerprint();
ok('rebuild ok', r0.ok === true, JSON.stringify(r0));
ok(`escaneó las ${rows.length} filas`, r0.scanned === rows.length, String(r0.scanned));
ok('5 usuarios con perfil', before.profiles === 5, String(before.profiles));
ok('archive ausente en el rebuild', r0.archive_present === false);
ok('sources: todo hot', r0.sources.hot === rows.length && r0.sources.archive === 0, JSON.stringify(r0.sources));

// ── 2. rotar ─────────────────────────────────────────────────────────────────
section('[2] rotación real: los "viejos" salen de la caliente');
mat.closeMaterializerEventsDb();
const rr = rot.rotateOnce({ forceRun: true, nowTs: NOW, expiryEnabled: false,
    eventsPath: process.env.EVENTS_SQLITE_PATH, archivePath: process.env.ARCHIVE_SQLITE_PATH,
    insightsPath: process.env.INSIGHTS_SQLITE_PATH, log: () => {} });
ok('rotó 12 filas (3 usuarios × 4 eventos)', rr.moved === 12 && rr.deleted === 12, `${rr.moved}/${rr.deleted}`);
ok('expired = 0 (expiry OFF)', rr.expired === 0);
{
    const h = new Database(process.env.EVENTS_SQLITE_PATH, { readonly: true });
    const a = new Database(process.env.ARCHIVE_SQLITE_PATH, { readonly: true });
    ok('hot 6 + archive 12 = 18', h.prepare('SELECT COUNT(*) n FROM events').get().n === 6
        && a.prepare('SELECT COUNT(*) n FROM events').get().n === 12);
    ok('los viejos ya no están en hot',
        h.prepare("SELECT COUNT(*) n FROM events WHERE user_id LIKE 'viejo-%'").get().n === 0);
    h.close(); a.close();
}

// ── 3. el contrapunto: rebuild mirando SOLO la caliente ─────────────────────
section('[3] contrapunto — si el rebuild solo mirase hot, el resultado CAMBIA');
mat.closeMaterializerEventsDb();
resetInsightsProjections();
{
    const { readHistoricalEvents } = await import('../analytics/historicalEvents.mjs');
    const soloHot = readHistoricalEvents({ eventsPath: process.env.EVENTS_SQLITE_PATH,
        archivePath: path.join(tmp, 'no-existe.db'), fromTs: 0, toTs: CUT });
    ok('solo hot ve 6 de 18 filas', soloHot.rows.length === 6, String(soloHot.rows.length));
    ok('solo hot ve 2 de los 5 usuarios',
        new Set(soloHot.rows.map(r => r.user_id)).size === 2);
}

// ── 4. rebuild sobre hot ∪ archive ───────────────────────────────────────────
section('[4] rebuild DESPUÉS de rotar, sobre hot ∪ archive');
resetInsightsProjections();
const r1 = mat.rebuildInsights({ fromTs: 0, toTs: CUT });
const after = fingerprint();
ok('rebuild ok', r1.ok === true);
ok(`volvió a escanear las ${rows.length} filas`, r1.scanned === rows.length, String(r1.scanned));
ok('archive detectado', r1.archive_present === true);
ok('sources: 6 hot + 12 archive', r1.sources.hot === 6 && r1.sources.archive === 12, JSON.stringify(r1.sources));
ok('0 duplicados deduplicados', r1.duplicates_deduped === 0);
ok('los 5 usuarios vuelven a tener perfil', after.profiles === 5, String(after.profiles));

section('[5] REBUILD_BEFORE == REBUILD_AFTER');
ok('mismo número de snapshots', before.snaps === after.snaps, `${before.snaps} vs ${after.snaps}`);
ok('mismo número de perfiles', before.profiles === after.profiles);
ok('mismos cohort rollups', before.cohorts === after.cohorts);
ok('HUELLA LÓGICA IDÉNTICA', before.sha === after.sha,
    before.sha === after.sha ? '' : 'las proyecciones difieren');

// ── 6. el incremental NO cambia de fuente ───────────────────────────────────
section('[6] INCREMENTAL_SOURCE: HOT_ONLY');
{
    const src = fs.readFileSync(new URL('../services/insightMaterializer.mjs', import.meta.url), 'utf8');
    const runOnceBody = src.slice(src.indexOf('export function runOnce'), src.indexOf('export function rebuildInsights'));
    ok('runOnce no llama al reader histórico', !runOnceBody.includes('readHistoricalEvents'));
    ok('runOnce sigue usando _stmtBatch sobre la caliente', runOnceBody.includes('_stmtBatch.all('));
    const rebuildBody = src.slice(src.indexOf('export function rebuildInsights'));
    ok('rebuildInsights sí usa el reader histórico', rebuildBody.includes('readHistoricalEvents'));
}

try { ext.getInsightsExtDb().close(); } catch {}
try { mat.closeMaterializerEventsDb(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\nrebuildAfterRotation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
