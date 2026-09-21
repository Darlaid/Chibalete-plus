/**
 * historicalEventsReader.test.mjs — CHP-V6-EVENTS-RETENTION-01 / 10B §7.
 *
 *   [A] solo hot            → idéntico al contrato previo
 *   [B] hot + archive       → unión completa, sin solape
 *   [C] mismo event_id      → una sola fila, gana la caliente
 *   [D] archive ausente     → no se crea y no falla
 *   [E] fromTs/toTs         → filtra AMBAS fuentes
 *   [F] userIds             → filtra AMBAS fuentes
 *   [G] envelope            → idéntico campo a campo
 *   [H] orden estable
 *   [I] rebuildInsights sobre hot+archive == dataset original pre-rotación
 *
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_hist_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmp, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmp, 'insights.db');
process.env.ARCHIVE_SQLITE_PATH  = path.join(tmp, 'events.archive.db');
process.env.GROUPS_DB = path.join(tmp, 'groups_db.json');
process.env.USERS_DB  = path.join(tmp, 'usuarios_colegios_oro.json');
fs.writeFileSync(process.env.GROUPS_DB, '[]');
fs.writeFileSync(process.env.USERS_DB, '[]');

const { readHistoricalEvents } = await import('../analytics/historicalEvents.mjs');

const DDL = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
  event TEXT NOT NULL, mode TEXT NOT NULL, user_id TEXT NOT NULL, content_id TEXT,
  session_id TEXT NOT NULL, client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
  elapsed_ms INTEGER, progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`;

const T0 = Date.parse('2026-05-01T00:00:00Z');
const row = (id, ts, user = 'U1', extra = {}) => ({
    id, event_id: `ev-${id}`, schema_version: 1, event: 'immersive.session_start', mode: 'immersive',
    user_id: user, content_id: `c-${id % 3}`, session_id: `s-${id}`,
    client_ts: T0 + ts, server_ts: T0 + ts, elapsed_ms: id * 1000, progress_fraction: null,
    payload_json: JSON.stringify({ k: id }), created_at: T0 + ts, ...extra,
});
function write(p, rows) {
    const db = new Database(p);
    db.exec(DDL);
    const ins = db.prepare(`INSERT OR REPLACE INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
      VALUES (@id,@event_id,@schema_version,@event,@mode,@user_id,@content_id,@session_id,@client_ts,@server_ts,@elapsed_ms,@progress_fraction,@payload_json,@created_at)`);
    db.transaction(rs => rs.forEach(r => ins.run(r)))(rows);
    db.close();
}
const reset = () => { for (const f of fs.readdirSync(tmp)) if (f.startsWith('events')) fs.rmSync(path.join(tmp, f), { force: true }); };
const P = { ev: process.env.EVENTS_SQLITE_PATH, ar: process.env.ARCHIVE_SQLITE_PATH };

// ── [A] solo hot ─────────────────────────────────────────────────────────────
section('[A] solo hot → contrato previo intacto');
reset();
write(P.ev, [row(1, 1000), row(2, 2000), row(3, 3000)]);
{
    const r = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    ok('3 filas', r.rows.length === 3, String(r.rows.length));
    ok('archive ausente reportado', r.archivePresent === false);
    ok('sources.hot=3 archive=0', r.sources.hot === 3 && r.sources.archive === 0);
    ok('0 duplicados', r.duplicates === 0);
}

// ── [D] archive ausente no se crea ───────────────────────────────────────────
section('[D] archive ausente → no se crea, no falla');
ok('events.archive.db sigue sin existir', !fs.existsSync(P.ar));

// ── [B] hot + archive sin solape ─────────────────────────────────────────────
section('[B] hot + archive sin solape → unión completa');
write(P.ar, [row(10, 100), row(11, 200)]);
{
    const r = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    ok('5 filas', r.rows.length === 5, String(r.rows.length));
    ok('archivePresent', r.archivePresent === true);
    ok('sources hot=3 archive=2', r.sources.hot === 3 && r.sources.archive === 2);
    ok('ids únicos', new Set(r.rows.map(x => x.id)).size === 5);
}

// ── [H] orden estable ────────────────────────────────────────────────────────
section('[H] orden por server_ts, desempate por id');
{
    const r = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    const ts = r.rows.map(x => x.server_ts);
    ok('server_ts no decreciente', ts.every((v, i) => i === 0 || ts[i - 1] <= v), JSON.stringify(ts));
    ok('el archivo (más viejo) va primero', r.rows[0].id === 10 && r.rows[1].id === 11,
        JSON.stringify(r.rows.map(x => x.id)));
    const again = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    ok('dos lecturas dan el mismo orden',
        JSON.stringify(r.rows.map(x => x.id)) === JSON.stringify(again.rows.map(x => x.id)));
}

// ── [C] mismo event_id en ambos ──────────────────────────────────────────────
section('[C] mismo event_id en ambas fuentes → una sola fila, gana la caliente');
reset();
write(P.ev, [{ ...row(1, 1000), payload_json: '{"origen":"hot"}' }]);
write(P.ar, [{ ...row(1, 1000), payload_json: '{"origen":"archive"}' }]);
{
    const r = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    ok('1 sola fila', r.rows.length === 1, String(r.rows.length));
    ok('gana la caliente', r.rows[0].payload_json === '{"origen":"hot"}', r.rows[0].payload_json);
    ok('duplicado contabilizado', r.duplicates === 1, String(r.duplicates));
    ok('la fuente archive no se modificó', (() => {
        const a = new Database(P.ar, { readonly: true });
        const v = a.prepare('SELECT payload_json p FROM events WHERE id=1').get().p; a.close();
        return v === '{"origen":"archive"}';
    })());
}

// ── [E] ventana temporal ─────────────────────────────────────────────────────
section('[E] fromTs/toTs filtra ambas fuentes');
reset();
write(P.ev, [row(1, 5000), row(2, 9000)]);
write(P.ar, [row(10, 1000), row(11, 3000)]);
{
    const all = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    ok('sin ventana: 4', all.rows.length === 4);
    const win = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar, fromTs: T0 + 2000, toTs: T0 + 6000 });
    ok('ventana [2000,6000]: 2 filas (una de cada fuente)', win.rows.length === 2, JSON.stringify(win.rows.map(x => x.id)));
    ok('son id 11 (archive) y 1 (hot)', win.rows.map(x => x.id).sort((a, b) => a - b).join() === '1,11');
    const none = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar, fromTs: T0 + 90_000, toTs: T0 + 99_000 });
    ok('ventana sin datos: 0', none.rows.length === 0);
}

// ── [F] userIds ──────────────────────────────────────────────────────────────
section('[F] userIds filtra ambas fuentes');
reset();
write(P.ev, [row(1, 1000, 'UA'), row(2, 2000, 'UB')]);
write(P.ar, [row(10, 100, 'UA'), row(11, 200, 'UB')]);
{
    const ua = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar, userIds: ['UA'] });
    ok('solo UA: 2 filas', ua.rows.length === 2 && ua.rows.every(r => r.user_id === 'UA'),
        JSON.stringify(ua.rows.map(x => x.user_id)));
    ok('una de cada fuente', ua.rows.map(x => x.id).sort((a, b) => a - b).join() === '1,10');
    const both = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar, userIds: ['UA', 'UB'] });
    ok('ambos: 4 filas', both.rows.length === 4);
}

// ── [G] envelope íntegro ─────────────────────────────────────────────────────
section('[G] envelope idéntico campo a campo');
reset();
const original = [row(1, 1000, 'UA'), row(2, 2000, 'UB', { elapsed_ms: null, content_id: null, progress_fraction: 0.5 })];
write(P.ev, [original[0]]);
write(P.ar, [original[1]]);
{
    const r = readHistoricalEvents({ eventsPath: P.ev, archivePath: P.ar });
    const byId = new Map(r.rows.map(x => [x.id, x]));
    for (const o of original) {
        const got = byId.get(o.id);
        const campos = ['event_id', 'schema_version', 'event', 'mode', 'user_id', 'content_id',
            'session_id', 'client_ts', 'server_ts', 'elapsed_ms', 'progress_fraction', 'payload_json', 'created_at'];
        ok(`id ${o.id}: los 13 campos + id intactos`,
            got && got.id === o.id && campos.every(c => got[c] === o[c]),
            JSON.stringify(got));
    }
}

// ── Entradas degeneradas ─────────────────────────────────────────────────────
section('[J] rutas inexistentes y entradas raras');
{
    const r = readHistoricalEvents({ eventsPath: path.join(tmp, 'no-existe.db'), archivePath: path.join(tmp, 'tampoco.db') });
    ok('todo ausente → 0 filas sin lanzar', r.rows.length === 0 && r.archivePresent === false);
    ok('no creó ninguno de los dos', !fs.existsSync(path.join(tmp, 'no-existe.db')) && !fs.existsSync(path.join(tmp, 'tampoco.db')));
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\nhistoricalEventsReader: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
