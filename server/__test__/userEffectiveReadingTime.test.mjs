/**
 * userEffectiveReadingTime.test.mjs — CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 (1B).
 *
 * El desbloqueo del avance automático lee SOLO las filas del usuario por
 * índice. Esta suite fija que el resultado es EXACTAMENTE el del camino previo
 * (`readHistoricalEvents` + filtro por usuario + `computeEffectiveReadingMs`),
 * con la misma semántica de unión hot ∪ archive, y que ya no escanea la base.
 *
 *   E1  equivalencia exacta con el camino previo, usuario por usuario.
 *   E2  dedupe por event_id con precedencia de la caliente (solape de rotación).
 *   E3  sin archivo: resultado = solo caliente, y el archivo NO se crea.
 *   E4  fuente corrupta → lanza (el endpoint responde 500 → LOCKED), no 0 silencioso.
 *   E5  la consulta usa el índice por user_id en ambas bases (no SCAN).
 *   E6  escala: 60k filas de otros usuarios no se leen.
 *   E7  las bases no cambian (solo lectura).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { readHistoricalEvents } from '../analytics/historicalEvents.mjs';
import { computeEffectiveReadingMs } from '../analytics/effectiveReadingTime.mjs';
import { normalizeEventForSignals } from '../analytics/legacyEventNormalizer.mjs';
import { readUserHistoricalRows, userEffectiveReadingMs } from '../analytics/userEffectiveReadingTime.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const MIN = 60_000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_uert_'));
const HOT = path.join(tmp, 'events.db');
const ARCH = path.join(tmp, 'events.archive.db');
const NOARCH = path.join(tmp, 'no-existe.archive.db');

// DDL e índices idénticos a eventsService.js / archiveRotation.mjs.
const DDL = `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
    schema_version INTEGER NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL,
    user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
    client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL, elapsed_ms INTEGER,
    progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`;
const IDX_HOT = `CREATE INDEX IF NOT EXISTS idx_user_content ON events(user_id, content_id, server_ts);
    CREATE INDEX IF NOT EXISTS idx_event_ts ON events(event, server_ts);`;
const IDX_ARCH = `CREATE INDEX IF NOT EXISTS idx_arch_user_content ON events(user_id, content_id, server_ts);
    CREATE INDEX IF NOT EXISTS idx_arch_event_ts ON events(event, server_ts);`;

function open(p, idx) { const db = new Database(p); db.exec(DDL); db.exec(idx); return db; }
const ins = (db) => db.prepare(`INSERT INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
    VALUES (@id,@event_id,1,@event,@mode,@user_id,@content_id,@session_id,@ts,@ts,@elapsed_ms,NULL,@payload_json,@ts)`);
let nextId = 1;
const row = (o) => { const id = o.id ?? nextId++; return { id, event_id: o.event_id ?? `ev-${id}`, mode: 'a11y', content_id: 'c-1',
    session_id: `s-${id}`, elapsed_ms: null, payload_json: '{}', ...o, id }; };

const T0 = 1_780_000_000_000;
const hot = open(HOT, IDX_HOT), arch = open(ARCH, IDX_ARCH);
const iH = ins(hot), iA = ins(arch);
// u1: sesión legacy en archivo + sesión canónica en caliente + fila solapada (mismo event_id en ambas).
iA.run(row({ user_id: 'u1', event: 'a11y.session_start', ts: T0 }));
iA.run(row({ user_id: 'u1', event: 'a11y.session_heartbeat', ts: T0 + 10 * MIN, elapsed_ms: 10 * MIN }));
iA.run(row({ user_id: 'u1', event: 'a11y.session_end', ts: T0 + 30 * MIN, elapsed_ms: 30 * MIN }));
const dup = row({ user_id: 'u1', event: 'session_ended', ts: T0 + 5 * 86_400_000 + 90 * MIN, payload_json: JSON.stringify({ totalMs: 90 * MIN }) });
iH.run(row({ user_id: 'u1', event: 'reading_started', ts: T0 + 5 * 86_400_000 }));
iH.run(dup);
iA.run({ ...dup, payload_json: JSON.stringify({ totalMs: 999 * MIN }) });   // copia vieja en archivo: pierde
// u2: heartbeats acumulados sin cierre (el máximo manda) + filas técnicas ignoradas.
iH.run(row({ user_id: 'u2', event: 'immersive.session_start', mode: 'immersive', ts: T0 }));
iH.run(row({ user_id: 'u2', event: 'immersive.session_heartbeat', mode: 'immersive', ts: T0 + MIN, elapsed_ms: MIN }));
iH.run(row({ user_id: 'u2', event: 'immersive.session_heartbeat', mode: 'immersive', ts: T0 + 3 * MIN, elapsed_ms: 3 * MIN }));
iH.run(row({ user_id: 'u2', event: 'immersive.sentence_time', mode: 'immersive', ts: T0 + 4 * MIN, elapsed_ms: 999 * MIN }));
// u3: nada. Relleno: 60k filas de otros usuarios (no deben leerse).
const fill = hot.transaction(() => {
    for (let i = 0; i < 60_000; i++) iH.run(row({ user_id: `other-${i % 500}`, event: 'session_heartbeat', ts: T0 + i, payload_json: JSON.stringify({ elapsedMs: i }) }));
});
fill();
hot.close(); arch.close();

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before = { hot: sha(HOT), arch: sha(ARCH) };
const previo = (uid, archivePath = ARCH) => computeEffectiveReadingMs(
    readHistoricalEvents({ userIds: [uid], eventsPath: HOT, archivePath }).rows,
    (r) => normalizeEventForSignals(r.event)).ms;

console.log('\n[E1] equivalencia exacta con el camino previo');
for (const uid of ['u1', 'u2', 'u3', 'other-7']) {
    const a = previo(uid), b = userEffectiveReadingMs(uid, { eventsPath: HOT, archivePath: ARCH });
    ok(`${uid}: ${b} ms == ${a} ms`, a === b, `${a} vs ${b}`);
}
ok('u1 = 30 min (archivo) + 90 min (caliente) = 120 min', userEffectiveReadingMs('u1', { eventsPath: HOT, archivePath: ARCH }) === 120 * MIN);
ok('u2 = máximo acumulado (3 min), telemetría técnica ignorada', userEffectiveReadingMs('u2', { eventsPath: HOT, archivePath: ARCH }) === 3 * MIN);

console.log('\n[E2] dedupe con precedencia de la caliente');
{
    const { rows, sources } = readUserHistoricalRows('u1', { eventsPath: HOT, archivePath: ARCH });
    const d = rows.filter(r => r.event_id === dup.event_id);
    ok('el event_id solapado aparece una sola vez', d.length === 1);
    ok('…y es la versión de la caliente (90 min, no 999)', JSON.parse(d[0].payload_json).totalMs === 90 * MIN);
    ok('fuentes: 2 hot + 4 archive', sources.hot === 2 && sources.archive === 4, JSON.stringify(sources));
    ok('orden server_ts ASC', rows.every((r, i) => i === 0 || rows[i - 1].server_ts <= r.server_ts));
}

console.log('\n[E3] sin archivo');
{
    const b = userEffectiveReadingMs('u1', { eventsPath: HOT, archivePath: NOARCH });
    ok('resultado = solo caliente, igual al camino previo', b === previo('u1', NOARCH) && b === 90 * MIN, String(b));
    ok('el archivo NO se crea', !fs.existsSync(NOARCH));
}

console.log('\n[E4] fuente corrupta → lanza (fail-closed en el endpoint)');
{
    const bad = path.join(tmp, 'corrupt.archive.db');
    fs.writeFileSync(bad, 'esto no es sqlite');
    let threw = false;
    try { userEffectiveReadingMs('u1', { eventsPath: HOT, archivePath: bad }); } catch { threw = true; }
    ok('archivo ilegible lanza, no devuelve 0 en silencio', threw);
}

console.log('\n[E5] la consulta usa el índice por user_id');
{
    const src = fs.readFileSync(new URL('../analytics/userEffectiveReadingTime.mjs', import.meta.url), 'utf8');
    const sql = /const SELECT_USER = `([\s\S]*?)`;/.exec(src)[1];
    for (const [p, name] of [[HOT, 'idx_user_content'], [ARCH, 'idx_arch_user_content']]) {
        const db = new Database(p, { readonly: true });
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('u1').map(r => r.detail).join(' | ');
        db.close();
        ok(`${path.basename(p)}: ${plan}`, plan.includes(name) && !/SCAN events(?! USING)/.test(plan));
    }
}

console.log('\n[E6] escala');
{
    const t0 = performance.now();
    const { sources } = readUserHistoricalRows('u2', { eventsPath: HOT, archivePath: ARCH });
    const ms = performance.now() - t0;
    ok(`solo lee las filas del sujeto (${sources.hot} de ${60_000 + 4 + 2}) en ${ms.toFixed(1)} ms`, sources.hot === 4 && sources.archive === 0);
}

console.log('\n[E7] solo lectura');
ok('events.db byte-idéntico', sha(HOT) === before.hot);
ok('events.archive.db byte-idéntico', sha(ARCH) === before.arch);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
console.log(`\nCHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 (1B, lectura por usuario) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
