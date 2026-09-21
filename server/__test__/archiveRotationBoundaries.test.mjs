/**
 * archiveRotationBoundaries.test.mjs — CHP-V6-EVENTS-RETENTION-01 / 10B.
 *
 * §11 expiry separado del rotation:
 *   [E-A] rotation=1 expiry=0 con un evento de >12 meses en archive → permanece
 *   [E-B] rotation=1 expiry=1                                        → puede expirar
 *   [E-C] rotation=0 expiry=1                                        → no rota nada
 *   [E-D] sin flags                                                   → cero actividad
 *   [E-E] eventos 91 d–12 m                                           → archivados, no expirados
 *   [E-F] frontera exacta de 12 meses                                 → operador contractual intacto
 *
 * §15 frontera por watermark:
 *   [W-A] edad incluye 1…100, watermark 80 → solo 1…80
 *   [W-B] sin watermark / inválido         → SAFE_SKIP, cero candidatos
 *   [W-C] evento viejo con id > watermark  → permanece hot
 *   [W-D] evento reciente con id < wm      → permanece hot (por edad)
 *   [W-E] watermark supera todo            → rotación histórica completa
 *
 * §19 dryRun sin escrituras · §18 atomicidad · §22 invariantes.
 * Stores 100 % temporales.
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rot_'));
process.env.GROUPS_DB = path.join(tmp, 'groups_db.json');
process.env.USERS_DB  = path.join(tmp, 'usuarios_colegios_oro.json');
fs.writeFileSync(process.env.GROUPS_DB, '[]');
fs.writeFileSync(process.env.USERS_DB, '[]');

const rot = await import('../aulaViva/archiveRotation.mjs');

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-21T12:00:00Z');
const EV_DDL = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
  event TEXT NOT NULL, mode TEXT NOT NULL, user_id TEXT NOT NULL, content_id TEXT,
  session_id TEXT NOT NULL, client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
  elapsed_ms INTEGER, progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`;
const AR_DDL = EV_DDL.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'INTEGER PRIMARY KEY');

let caseN = 0;
/** Crea un caso aislado: events.db con `rows`, insights.db con `watermark`. */
function mkCase(rows, { watermark = null, archiveRows = null, noInsights = false, noState = false } = {}) {
    const dir = path.join(tmp, `c${++caseN}`);
    fs.mkdirSync(dir, { recursive: true });
    const ev = path.join(dir, 'events.db'), ar = path.join(dir, 'events.archive.db'), ins = path.join(dir, 'insights.db');
    const db = new Database(ev); db.exec(EV_DDL);
    const insert = db.prepare(`INSERT INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
      VALUES (?,?,1,'immersive.session_start','immersive','U1','c1',?,?,?,NULL,NULL,'{}',?)`);
    db.transaction(rs => rs.forEach(r => insert.run(r.id, `ev-${r.id}`, `s-${r.id}`, r.ts, r.ts, r.ts)))(rows);
    db.close();
    if (archiveRows) {
        const a = new Database(ar); a.exec(AR_DDL);
        const ai = a.prepare(`INSERT INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
          VALUES (?,?,1,'immersive.session_start','immersive','U1','c1',?,?,?,NULL,NULL,'{}',?)`);
        a.transaction(rs => rs.forEach(r => ai.run(r.id, `ev-${r.id}`, `s-${r.id}`, r.ts, r.ts, r.ts)))(archiveRows);
        a.close();
    }
    if (!noInsights) {
        const i = new Database(ins);
        i.exec(`CREATE TABLE IF NOT EXISTS materializer_state (
            materializer_name TEXT PRIMARY KEY, last_event_id INTEGER NOT NULL, last_ts INTEGER,
            updated_at INTEGER, lag_events INTEGER, lag_seconds INTEGER, degraded INTEGER, last_error TEXT)`);
        if (!noState && watermark !== null) {
            i.prepare(`INSERT INTO materializer_state (materializer_name,last_event_id,last_ts,updated_at,lag_events,lag_seconds,degraded,last_error)
                VALUES ('aula_viva_pedagogical_v1',?,0,?,0,0,0,NULL)`).run(watermark, NOW);
        }
        i.close();
    }
    return { dir, ev, ar, ins };
}
const count = (p, where = '') => {
    if (!fs.existsSync(p)) return 0;
    const d = new Database(p, { readonly: true });
    try { return d.prepare(`SELECT COUNT(*) n FROM events ${where}`).get().n; } finally { d.close(); }
};
const ids = (p) => {
    if (!fs.existsSync(p)) return [];
    const d = new Database(p, { readonly: true });
    try { return d.prepare('SELECT id FROM events ORDER BY id').all().map(r => r.id); } finally { d.close(); }
};
const run = (c, extra = {}) => rot.rotateOnce({
    forceRun: true, nowTs: NOW, eventsPath: c.ev, archivePath: c.ar, insightsPath: c.ins, log: () => {}, ...extra,
});

// ── §15 frontera por watermark ───────────────────────────────────────────────
section('[W-A] edad incluye 1…100, watermark 80 → solo 1…80 se archivan');
{
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, ts: NOW - 200 * DAY }));
    const c = mkCase(rows, { watermark: 80 });
    const r = run(c, { expiryEnabled: false });
    ok('candidatos por edad = 100', r.candidates_by_age === 100, String(r.candidates_by_age));
    ok('candidatos seguros = 80', r.candidates === 80, String(r.candidates));
    ok('por encima del watermark = 20', r.candidates_above_watermark === 20, String(r.candidates_above_watermark));
    ok('movidos = 80', r.moved === 80 && r.deleted === 80, `${r.moved}/${r.deleted}`);
    ok('hot conserva 20', count(c.ev) === 20, String(count(c.ev)));
    ok('ARCHIVED_ABOVE_WATERMARK = 0', Math.max(...ids(c.ar)) === 80, String(Math.max(...ids(c.ar))));
    ok('los que quedan son 81…100', ids(c.ev)[0] === 81 && ids(c.ev).at(-1) === 100);
    ok('sin pérdida: 80 + 20 = 100', count(c.ev) + count(c.ar) === 100);
}

section('[W-B] sin watermark válido → SAFE_SKIP, cero candidatos');
for (const [label, optsCase] of [
    ['insights.db ausente', { noInsights: true }],
    ['materializer_state sin fila', { noState: true }],
    ['watermark = 0', { watermark: 0 }],
]) {
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }], optsCase);
    const r = run(c, { expiryEnabled: false });
    ok(`${label} → skipped`, r.skipped === true, JSON.stringify({ skipped: r.skipped, reason: r.reason }));
    ok(`${label} → candidates 0`, r.candidates === 0);
    ok(`${label} → razón explicable`, typeof r.reason === 'string' && r.reason.startsWith('safe_skip_no_watermark:'), r.reason);
    ok(`${label} → NO degrada a solo-edad (hot intacto)`, count(c.ev) === 1);
    ok(`${label} → NO creó el archivo`, !fs.existsSync(c.ar));
}

section('[W-C] evento viejo con id > watermark → permanece hot');
{
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }, { id: 2, ts: NOW - 200 * DAY }], { watermark: 1 });
    run(c, { expiryEnabled: false });
    ok('hot conserva el id 2', ids(c.ev).join() === '2', ids(c.ev).join());
    ok('archive tiene solo el 1', ids(c.ar).join() === '1');
}

section('[W-D] evento reciente con id < watermark → permanece hot por edad');
{
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }, { id: 2, ts: NOW - 10 * DAY }], { watermark: 999 });
    const r = run(c, { expiryEnabled: false });
    ok('solo 1 candidato', r.candidates === 1, String(r.candidates));
    ok('el reciente sigue hot', ids(c.ev).join() === '2');
}

section('[W-E] watermark por encima de todo → rotación histórica completa');
{
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }, { id: 2, ts: NOW - 100 * DAY }], { watermark: 10_000 });
    const r = run(c, { expiryEnabled: false });
    ok('2 candidatos, 2 movidos', r.candidates === 2 && r.moved === 2);
    ok('hot vacío', count(c.ev) === 0);
    ok('above_watermark = 0', r.candidates_above_watermark === 0);
}

// ── §11 expiry separado ──────────────────────────────────────────────────────
section('[E-A] rotation=1 expiry=0 → un evento de >12 meses PERMANECE en el archivo');
{
    const c = mkCase([{ id: 5, ts: NOW - 100 * DAY }], { watermark: 100, archiveRows: [{ id: 1, ts: NOW - 500 * DAY }] });
    const r = run(c, { expiryEnabled: false });
    ok('expirables detectados = 1', r.expirable === 1, String(r.expirable));
    ok('expired = 0', r.expired === 0, String(r.expired));
    ok('la fila antigua sigue en el archivo', ids(c.ar).includes(1));
    ok('expiry_enabled reportado false', r.expiry_enabled === false);
    ok('la rotación sí ocurrió', r.moved === 1 && count(c.ev) === 0);
}

section('[E-B] rotation=1 expiry=1 → el evento de >12 meses puede expirar');
{
    const c = mkCase([{ id: 5, ts: NOW - 100 * DAY }], { watermark: 100, archiveRows: [{ id: 1, ts: NOW - 500 * DAY }] });
    const r = run(c, { expiryEnabled: true });
    ok('expired = 1', r.expired === 1, String(r.expired));
    ok('la fila antigua ya no está', !ids(c.ar).includes(1), ids(c.ar).join());
    ok('la recién archivada sí', ids(c.ar).includes(5));
}

section('[E-C] rotation=0 expiry=1 → no rota nada por accidente');
{
    const saved = { r: process.env.ARCHIVE_ROTATION_ENABLED, e: process.env.ARCHIVE_EXPIRY_ENABLED };
    delete process.env.ARCHIVE_ROTATION_ENABLED;
    process.env.ARCHIVE_EXPIRY_ENABLED = '1';
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }], { watermark: 100, archiveRows: [{ id: 9, ts: NOW - 500 * DAY }] });
    const r = rot.rotateOnce({ nowTs: NOW, eventsPath: c.ev, archivePath: c.ar, insightsPath: c.ins, log: () => {} });
    ok('skipped por el gate global', r.skipped === true && r.reason === 'disabled_default_off', JSON.stringify(r.reason));
    ok('hot intacto', count(c.ev) === 1);
    ok('archive intacto', ids(c.ar).join() === '9');
    if (saved.r === undefined) delete process.env.ARCHIVE_ROTATION_ENABLED; else process.env.ARCHIVE_ROTATION_ENABLED = saved.r;
    if (saved.e === undefined) delete process.env.ARCHIVE_EXPIRY_ENABLED; else process.env.ARCHIVE_EXPIRY_ENABLED = saved.e;
}

section('[E-D] sin flags → cero actividad');
{
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }], { watermark: 100 });
    const r = rot.rotateOnce({ nowTs: NOW, eventsPath: c.ev, archivePath: c.ar, insightsPath: c.ins, log: () => {} });
    ok('skipped', r.skipped === true && r.reason === 'disabled_default_off');
    ok('hot intacto', count(c.ev) === 1);
    ok('archive no creado', !fs.existsSync(c.ar));
    ok('ENABLED() false por defecto', rot.ENABLED() === false);
    ok('EXPIRY_ENABLED() false por defecto', rot.EXPIRY_ENABLED() === false);
}

section('[E-E] eventos de 91 d – 12 m → archivados, nunca expirados');
{
    const c = mkCase([{ id: 1, ts: NOW - 91 * DAY }, { id: 2, ts: NOW - 300 * DAY }], { watermark: 100 });
    const r = run(c, { expiryEnabled: true });
    ok('ambos archivados', r.moved === 2, String(r.moved));
    ok('ninguno expirado', r.expired === 0, String(r.expired));
    ok('los dos están en el archivo', ids(c.ar).join() === '1,2');
}

section('[E-F] frontera exacta: 90 d inclusiva, 12 meses estricta');
{
    const c = mkCase([{ id: 1, ts: NOW - 90 * DAY }, { id: 2, ts: NOW - 89 * DAY }], { watermark: 100 });
    const r = run(c, { expiryEnabled: false });
    ok('exactamente 90 d es elegible', r.candidates === 1 && ids(c.ar).join() === '1', JSON.stringify(ids(c.ar)));
    ok('89 d permanece hot', ids(c.ev).join() === '2');

    const exact = rot.subtractMonthsUtc(NOW, 12);
    const c2 = mkCase([{ id: 5, ts: NOW - 100 * DAY }], { watermark: 100, archiveRows: [{ id: 1, ts: exact }, { id: 2, ts: exact - 1 }] });
    const r2 = run(c2, { expiryEnabled: true });
    ok('a los 12 meses EXACTOS todavía existe', ids(c2.ar).includes(1), ids(c2.ar).join());
    ok('al superarlos por 1 ms expira', !ids(c2.ar).includes(2));
    ok('expired = 1', r2.expired === 1, String(r2.expired));
}

// ── §19 dryRun sin escrituras ────────────────────────────────────────────────
section('[D] dryRun: cero escrituras, no crea el archivo');
{
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }, { id: 2, ts: NOW - 10 * DAY }], { watermark: 1 });
    const before = fs.readFileSync(c.ev);
    const r = run(c, { dryRun: true, expiryEnabled: false });
    ok('ok y dryRun', r.ok === true && r.dryRun === true);
    ok('candidatos calculados = 1', r.candidates === 1, String(r.candidates));
    ok('por edad = 1, sobre watermark = 0', r.candidates_by_age === 1 && r.candidates_above_watermark === 0);
    ok('NO creó events.archive.db', !fs.existsSync(c.ar));
    ok('events.db byte-idéntico', Buffer.compare(fs.readFileSync(c.ev), before) === 0);
    ok('moved/deleted/expired en 0', r.moved === 0 && r.deleted === 0 && r.expired === 0);
    const wals = fs.readdirSync(c.dir).filter(f => f.includes('archive'));
    ok('ningún fichero de archive creado', wals.length === 0, JSON.stringify(wals));
}
section('[D2] dryRun con archive existente: lo lee sin tocarlo');
{
    const c = mkCase([{ id: 1, ts: NOW - 200 * DAY }], { watermark: 100, archiveRows: [{ id: 9, ts: NOW - 500 * DAY }] });
    const before = fs.readFileSync(c.ar);
    const r = run(c, { dryRun: true, expiryEnabled: true });
    ok('reporta 1 expirable', r.expirable === 1, String(r.expirable));
    ok('no expiró nada', r.expired === 0 && ids(c.ar).join() === '9');
    ok('archive byte-idéntico', Buffer.compare(fs.readFileSync(c.ar), before) === 0);
}

// ── §22 invariantes + idempotencia ───────────────────────────────────────────
section('[I] invariantes: sin pérdida, sin duplicados, idempotente');
{
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, ts: NOW - (i < 30 ? 200 : 10) * DAY }));
    const c = mkCase(rows, { watermark: 1000 });
    const hotBefore = count(c.ev);
    const r1 = run(c, { expiryEnabled: false });
    const h1 = count(c.ev), a1 = count(c.ar);
    ok('HOT_BEFORE == HOT_AFTER + ARCHIVE', hotBefore === h1 + a1, `${hotBefore} vs ${h1}+${a1}`);
    ok('sin solape', ids(c.ev).filter(x => ids(c.ar).includes(x)).length === 0);
    const r2 = run(c, { expiryEnabled: false });
    ok('2ª corrida: 0 candidatos, 0 movidos', r2.candidates === 0 && r2.moved === 0 && r2.deleted === 0);
    ok('conteos estables', count(c.ev) === h1 && count(c.ar) === a1);
    ok('integrity ok pre y post', r1.integrity_pre === 'ok' && r1.integrity_post === 'ok');
    const d = new Database(c.ar, { readonly: true });
    ok('0 duplicados en archive', d.prepare('SELECT COUNT(*) n FROM (SELECT event_id,COUNT(*) c FROM events GROUP BY 1 HAVING c>1)').get().n === 0);
    d.close();
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\narchiveRotationBoundaries: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
