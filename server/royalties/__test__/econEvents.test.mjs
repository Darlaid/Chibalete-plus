/**
 * econEvents.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A2.
 *
 * Ingesta económica sin servidor HTTP: validación de `econ_tick`, tabla
 * `econ_events` en un events.db temporal, atribución F2-B en el primer tick,
 * integración con el motor F3-A1 y compatibilidad con la rotación de archivo.
 * Stores 100 % temporales; las reglas pagadas son sintéticas.
 *
 *   node server/royalties/__test__/econEvents.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_econ_'));
// La rotación importa servicios de Aula Viva que resuelven padrones al cargar.
process.env.NODE_ENV = 'test';
process.env.GROUPS_DB = path.join(tmp, 'groups_db.json');
process.env.USERS_DB = path.join(tmp, 'usuarios.json');
fs.writeFileSync(process.env.GROUPS_DB, '[]');
fs.writeFileSync(process.env.USERS_DB, '[]');
process.env.EVENTS_SQLITE_PATH ??= path.join(tmp, 'unused-events.db');
process.env.INSIGHTS_SQLITE_PATH ??= path.join(tmp, 'unused-insights.db');

const econ = await import('../econEvents.mjs');
const cc = await import('../commercialClass.mjs');
const { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1: RS } = await import('../economicEpisodes.mjs');
const rot = await import('../../aulaViva/archiveRotation.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

// ── fixtures ────────────────────────────────────────────────────────────────
const T0 = Date.parse('2026-10-20T15:00:00Z'); // 10:00 en Bogotá
const SEC = 1000, MIN = 60 * SEC;
const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let seq = 0;
const ulid = () => { let n = ++seq, s = ''; for (let i = 0; i < 26; i++) { s = CROCK[n % 32] + s; n = Math.floor(n / 32); } return s; };

const C1 = { id: 'content-c1', tipo: 'libro' }, C2 = { id: 'content-c2', tipo: 'libro' };
const CONTENT = new Map([[C1.id, C1], [C2.id, C2]]);
const users = {
    R: { id: 'R', roles: ['lector'] },
    M: { id: 'M', roles: ['mediador'] },
    A: { id: 'A', roles: ['administrador'] },
    L: { id: 'L', roles: ['lector'], _loadtest_marker: true },
    I: { id: 'I', roles: ['lector'] },
};
const classify = (rule, cls, at) => cc.applyClassification(rule, { commercialClass: cls, evidenceRef: 'fixture-sintetica' }, { actor: 'test', nowMs: at }).rule;
const base = (id, scope, scopeId) => ({ id, scope, scopeId, titleIds: [C1.id, C2.id], collectionIds: [], expiresAt: null });
let PAID = classify(base('r-paid', 'user', 'R'), 'paid_b2c', T0 - 86_400_000);
const FREE = base('r-group-free', 'group', 'g1');                        // unclassified
const PILOT = classify(base('r-pilot', 'group', 'g2'), 'pilot', T0 - 86_400_000);

function attribution(user, appliedRuleIds, rules, at, internalUserIds = []) {
    const m = new Map();
    for (const c of CONTENT.values()) m.set(c.id, cc.resolveCommercialAttribution({ rules, appliedRuleIds, content: c, user, at, internalUserIds }));
    return m;
}
const newDb = (name) => { const db = new Database(path.join(tmp, `${name}.db`)); db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000'); return db; };
const tick = (o) => ({
    event: 'econ_tick', eventId: o.eventId ?? ulid(), mode: o.mode ?? 'pdf', contentId: o.contentId ?? C1.id,
    sessionId: o.sessionId ?? 's1', clientTs: o.t, userId: o.userId,
    payload: o.payload ?? { windowMs: o.windowMs ?? 15 * SEC, visible: o.visible ?? true, humanSignalAgoMs: o.ago ?? 2 * SEC, audio: o.audio ?? null },
});
const norm = (t, userId = 'R', now = t.clientTs + 500) => econ.normalizeEconTick(t, { userId, now });
/** Ingresa ticks como lo haría el servidor (uno por petición, reloj = client_ts + 0,5 s). */
function ingest(db, userId, ticks, attr) {
    const sum = { accepted: 0, deduplicated: 0, rejected: 0, errors: [] };
    for (const t of ticks) {
        const now = t.clientTs + 500;
        const n = econ.normalizeEconTick(t, { userId, now });
        if (!n.ok) { sum.rejected++; sum.errors.push(n.code); continue; }
        const r = econ.recordEconTicks(db, { userId, ticks: [n.tick], now, attributionByContent: attr });
        sum.accepted += r.accepted; sum.deduplicated += r.deduplicated; sum.rejected += r.rejected; sum.errors.push(...r.errors.map((e) => e.code));
    }
    return sum;
}
/** Lectura continua: `n` ticks de 15 s con señales humanas, desde `from`. */
const reading = (n, from, o = {}) => Array.from({ length: n }, (_, i) => tick({ ...o, t: from + (i + 1) * 15 * SEC }));
function engine(db, extra = {}) {
    const rows = econ.readEconRows(db);
    return computeEconomicEpisodes(rows, {
        ruleSet: RS, eligibleContentIds: [C1.id, C2.id], expectedMinutesByContent: { [C1.id]: 10, [C2.id]: 10 },
        excludedUsers: econ.excludedUsersFromRows(rows), ...econ.engineClockContext(), ...extra,
    });
}
const starts = (db) => db.prepare("SELECT * FROM econ_events WHERE event = 'econ.session_start' ORDER BY id").all();

// ── [1] validación del tick ─────────────────────────────────────────────────
section('[1] validación y reconstrucción del econ_tick');
{
    const t = tick({ t: T0 });
    const n = norm(t);
    ok('tick válido de lector autenticado', n.ok && n.tick.contentId === C1.id && n.tick.payload.windowMs === 15000);
    ok('el usuario sale de la sesión: userId ajeno en el cuerpo → user_mismatch', norm({ ...t, userId: 'OTRO' }).code === 'user_mismatch');
    ok('userId igual al de la sesión se admite', norm({ ...t, userId: 'R' }).ok);
    const extra = norm({ ...t, payload: { ...t.payload, isAdmin: true, credit: 999, serverTs: 1 } });
    ok('campos desconocidos del cliente se descartan', extra.ok && !('isAdmin' in extra.tick.payload) && !('credit' in extra.tick.payload));
    ok('eventId no ULID → rechazado', norm({ ...t, eventId: 'x' }).code === 'invalid_event_id');
    ok('modo fuera de V1 (lu) → rechazado', norm({ ...t, mode: 'lu' }).code === 'mode_not_included');
    ok('epub admitido (modo V1)', norm({ ...t, mode: 'epub' }).ok);
    ok('sesión legacy- → rechazada', norm({ ...t, sessionId: 'legacy-1' }).code === 'invalid_session_id');
    ok('reloj adelantado > 120 s → clock_ahead', econ.normalizeEconTick(t, { userId: 'R', now: T0 - 121 * SEC }).code === 'clock_ahead');
    ok('adelanto de 119 s admitido', econ.normalizeEconTick(t, { userId: 'R', now: T0 - 119 * SEC }).ok);
    ok('retraso > 10 min → too_late', econ.normalizeEconTick(t, { userId: 'R', now: T0 + 601 * SEC }).code === 'too_late');
    ok('ventana 0 → rechazada', norm(tick({ t: T0, windowMs: 0 })).code === 'invalid_window');
    ok('ventana > 2 min (tiempo excesivo) → rechazada', norm(tick({ t: T0, windowMs: 121 * SEC })).code === 'invalid_window');
    ok('ventana parcial de cierre (7 s) admitida', norm(tick({ t: T0, windowMs: 7 * SEC })).ok);
    ok('señal humana negativa → rechazada', norm(tick({ t: T0, ago: -1 })).code === 'invalid_signal');
    ok('visible no booleano → rechazado', norm(tick({ t: T0, visible: 'yes' })).code === 'invalid_payload');
    const au = (a) => norm(tick({ t: T0, visible: false, audio: { playing: true, gesture: true, muted: false, rate: 1, mediaAdvancedMs: 15000, ...a } }));
    ok('audio atendido válido', au({}).ok && au({}).tick.payload.audio.mediaAdvancedMs === 15000);
    ok('audio que avanza más que la ventana → audio_overrun', au({ mediaAdvancedMs: 60000 }).code === 'audio_overrun');
    ok('velocidad absurda → invalid_audio', au({ rate: 16 }).code === 'invalid_audio');
    ok('clientTs no entero → invalid_client_ts', norm({ ...t, clientTs: T0 + 0.5 }, 'R', T0).code === 'invalid_client_ts');
}

// ── [2] persistencia, deduplicación y atribución ────────────────────────────
section('[2] econ_events: persistencia, duplicados y orden');
{
    const db = newDb('p');
    const attr = attribution(users.R, ['r-paid', 'r-group-free'], [PAID, FREE], T0);
    const ts = reading(3, T0);
    let r = ingest(db, 'R', ts, attr);
    ok('3 ticks aceptados', r.accepted === 3 && r.rejected === 0, JSON.stringify(r));
    const st = starts(db);
    ok('una sola atribución por sesión', st.length === 1);
    const ea = JSON.parse(st[0].payload_json).econAccess;
    ok('reglas simultáneas: una única regla atribuida (la pagada, prioridad F2-B)', ea.ruleId === 'r-paid' && ea.commercialClass === 'paid_b2c' && ea.eligible === true);
    ok('candidatas auditables sin doble atribución', JSON.stringify(ea.candidateRuleIds) === JSON.stringify(['r-paid', 'r-group-free']));
    ok('id determinista de la atribución', st[0].event_id === econ.sessionStartEventId('R', C1.id, 's1'));
    ok('suelo de sesión = inicio de la primera ventana', st[0].client_ts === ts[0].clientTs - 15 * SEC);
    r = ingest(db, 'R', [ts[1]], attr);
    ok('tick repetido (mismo eventId) → deduplicado', r.deduplicated === 1 && r.accepted === 0);
    r = ingest(db, 'R', [{ ...ts[1], eventId: ulid() }], attr);
    ok('mismo instante con otro eventId → deduplicado', r.deduplicated === 1);
    r = ingest(db, 'R', [tick({ t: T0 + 7 * SEC })], attr);
    ok('tick fuera de orden se guarda (el motor ordena por instante)', r.accepted === 1);
    r = ingest(db, 'R', [tick({ t: T0 + 70 * SEC, contentId: C2.id })], attr);
    ok('misma sesión con otra obra → session_mismatch', r.rejected === 1 && r.errors[0] === 'session_mismatch');
    r = ingest(db, 'R', [tick({ t: T0 + 75 * SEC, mode: 'text' })], attr);
    ok('misma sesión con otro modo → session_mismatch', r.errors[0] === 'session_mismatch');
    r = ingest(db, 'R', [tick({ t: T0 + 80 * SEC, sessionId: 's-x', contentId: 'content-sin-atribucion' })], attr);
    ok('obra sin atribución resuelta → unattributable', r.errors[0] === 'unattributable');
    ok('append-only: UPDATE bloqueado', (() => { try { db.prepare("UPDATE econ_events SET user_id = 'X'").run(); return false; } catch (e) { return /append-only/.test(e.message); } })());
    ok('append-only: DELETE bloqueado', (() => { try { db.prepare('DELETE FROM econ_events').run(); return false; } catch (e) { return /append-only/.test(e.message); } })());
    const rows = econ.readEconRows(db);
    ok('lectura desde events.db con forma del motor', rows.length === 5 && rows.every((x) => 'payload_json' in x && 'server_ts' in x));
    ok('lectura filtrada por obra', econ.readEconRows(db, { contentId: 'nada' }).length === 0);
    db.close();
}

section('[3] límite de frecuencia por usuario');
{
    const db = newDb('rate');
    const attr = attribution(users.R, ['r-paid'], [PAID], T0);
    const now = T0 + 500;
    const many = Array.from({ length: 14 }, (_, i) => econ.normalizeEconTick(tick({ t: T0 - i * SEC, sessionId: `s${i % 4}` }), { userId: 'R', now }).tick);
    const r = econ.recordEconTicks(db, { userId: 'R', ticks: many, now, attributionByContent: attr });
    ok('12 ticks/min aceptados y el resto rate_limited', r.accepted === 12 && r.rejected === 2 && r.errors.every((e) => e.code === 'rate_limited'), JSON.stringify(r));
    const later = econ.recordEconTicks(db, { userId: 'R', ticks: [econ.normalizeEconTick(tick({ t: T0 + 61 * SEC, sessionId: 's0' }), { userId: 'R', now: T0 + 61 * SEC }).tick], now: T0 + 61 * SEC, attributionByContent: attr });
    ok('pasado el minuto vuelve a aceptar', later.accepted === 1);
    db.close();
}

section('[4] réplicas: dos conexiones, una atribución');
{
    const file = path.join(tmp, 'rep.db');
    const a = new Database(file), b = new Database(file);
    for (const d of [a, b]) { d.pragma('journal_mode = WAL'); d.pragma('busy_timeout = 5000'); }
    const paid = attribution(users.R, ['r-paid'], [PAID], T0);
    const free = attribution(users.R, ['r-group-free'], [FREE], T0);
    const t1 = econ.normalizeEconTick(tick({ t: T0, sessionId: 'rep' }), { userId: 'R', now: T0 }).tick;
    const t2 = econ.normalizeEconTick(tick({ t: T0 + 15 * SEC, sessionId: 'rep' }), { userId: 'R', now: T0 + 15 * SEC }).tick;
    econ.recordEconTicks(a, { userId: 'R', ticks: [t1], now: T0, attributionByContent: paid });
    econ.recordEconTicks(b, { userId: 'R', ticks: [t2], now: T0 + 15 * SEC, attributionByContent: free });
    const st = starts(a);
    ok('la segunda réplica no crea otra atribución', st.length === 1 && JSON.parse(st[0].payload_json).econAccess.ruleId === 'r-paid');
    ok('ambos ticks persistidos', econ.readEconRows(b).filter((x) => x.event === 'econ_tick').length === 2);
    a.close(); b.close();
}

// ── [5] integración con el motor F3-A1 ──────────────────────────────────────
section('[5] motor F3-A1 sobre econ_events');
{
    const db = newDb('eng');
    ingest(db, 'R', reading(8, T0), attribution(users.R, ['r-paid'], [PAID], T0));           // 2 min, pagada
    ingest(db, 'M', reading(8, T0, { sessionId: 'm1' }), attribution(users.M, ['r-group-free'], [FREE], T0));
    ingest(db, 'A', reading(8, T0, { sessionId: 'a1' }), attribution(users.A, ['r-paid'], [PAID], T0));
    ingest(db, 'L', reading(8, T0, { sessionId: 'l1' }), attribution(users.L, ['r-paid'], [PAID], T0));
    ingest(db, 'I', reading(8, T0, { sessionId: 'i1' }), attribution(users.I, ['r-paid'], [PAID], T0, ['I']));
    ingest(db, 'P', reading(8, T0, { sessionId: 'p1' }), attribution({ id: 'P', roles: ['lector'] }, ['r-pilot'], [PILOT], T0));
    const out = engine(db);
    const ep = (u) => out.episodes.filter((e) => e.userId === u);
    ok('regla pagada sintética: 1 episodio cualificado', ep('R').length === 1 && ep('R')[0].qualified, JSON.stringify(ep('R')));
    ok('tiempo acreditado ≤ tiempo real (2 min)', ep('R')[0].activeSeconds <= 120 && ep('R')[0].activeSeconds >= 90);
    ok('mediador no excluido por rol; no elegible por acceso sin clasificar', ep('M')[0].reasons.join() === 'access_not_paid');
    ok('administrador excluido', ep('A')[0].reasons.some((r) => r.startsWith('user_excluded')));
    ok('cuenta sintética excluida', ep('L')[0].reasons.some((r) => r.startsWith('user_excluded')));
    ok('cuenta interna (P7) excluida', ep('I')[0].reasons.some((r) => r.startsWith('user_excluded')));
    ok('piloto no elegible', ep('P')[0].reasons.join() === 'access_not_paid');
    ok('Q de la obra = 1 (solo la pagada)', out.works.find((w) => w.contentId === C1.id).Q === 1);
    ok('sin filas inválidas', out.audit.invalidEvents.length === 0, JSON.stringify(out.audit.invalidByReason));
    db.close();
}

section('[6] actividad visual, audio atendido, pausas y cierre');
{
    const db = newDb('act');
    const attr = attribution(users.R, ['r-paid'], [PAID], T0);
    // Audio con pantalla oculta: sin señal visual, con gesto y avance real.
    const audio = Array.from({ length: 6 }, (_, i) => tick({ t: T0 + (i + 1) * 15 * SEC, sessionId: 'au', visible: false, ago: (i + 1) * 15 * SEC,
        audio: { playing: true, gesture: true, muted: false, rate: 1, mediaAdvancedMs: 15000 } }));
    ingest(db, 'R', audio, attr);
    let e = engine(db).episodes;
    ok('audio atendido sin visibilidad acredita tiempo', e.length === 1 && e[0].activeSeconds >= 60, JSON.stringify(e));
    // Audio silenciado: no acredita.
    const db2 = newDb('mute');
    ingest(db2, 'R', audio.map((t) => ({ ...t, eventId: ulid(), payload: { ...t.payload, audio: { ...t.payload.audio, muted: true } } })), attr);
    ok('audio silenciado no acredita', engine(db2).episodes.length === 0);
    db2.close();
    // Pausa > 120 s entre dos tramos: el hueco no cuenta.
    const db3 = newDb('pause');
    ingest(db3, 'R', [...reading(4, T0, { sessionId: 'pz' }), ...reading(4, T0 + 4 * 15 * SEC + 5 * MIN, { sessionId: 'pz', ago: 2 * SEC })], attr);
    const ep3 = engine(db3).episodes;
    const total3 = ep3.reduce((s, x) => s + x.activeSeconds, 0);
    ok('pausa de 5 min excluida del tiempo activo', total3 <= 8 * 15, `${total3}`);
    db3.close();
    // Cierre al desmontar: tick final parcial; solo franjas completas.
    const db4 = newDb('close');
    ingest(db4, 'R', [...reading(4, T0, { sessionId: 'cl' }), tick({ t: T0 + 4 * 15 * SEC + 7 * SEC, sessionId: 'cl', windowMs: 7 * SEC })], attr);
    const e4 = engine(db4).episodes[0];
    ok('tick final parcial aceptado sin acreditar franjas incompletas', e4.activeSeconds % 15 === 0 && e4.activeSeconds <= 4 * 15 + 15);
    db4.close();
    db.close();
}

section('[7] cambio de modo y concurrencia entre obras');
{
    const db = newDb('modes');
    const attr = attribution(users.R, ['r-paid'], [PAID], T0);
    ingest(db, 'R', reading(4, T0, { sessionId: 'pdf-1', mode: 'pdf' }), attr);
    ingest(db, 'R', reading(4, T0 + 4 * 15 * SEC + 2 * MIN, { sessionId: 'txt-1', mode: 'text' }), attr);
    let out = engine(db);
    ok('cambiar de modo dentro de la obra: 1 episodio', out.episodes.length === 1, JSON.stringify(out.episodes.map((e) => e.modeSeconds)));
    ok('los minutos se reparten por modo, no se duplican', Object.keys(out.episodes[0].modeSeconds).length === 2
        && Object.values(out.episodes[0].modeSeconds).reduce((a, b) => a + b, 0) === out.episodes[0].activeSeconds);
    db.close();
    const db2 = newDb('cross');
    ingest(db2, 'R', reading(6, T0, { sessionId: 'w1', contentId: C1.id, ago: 1 * SEC }), attr);
    ingest(db2, 'R', reading(6, T0, { sessionId: 'w2', contentId: C2.id, ago: 5 * SEC }), attr);
    out = engine(db2);
    const total = out.episodes.reduce((s, x) => s + x.activeSeconds, 0);
    ok('dos obras a la vez: cada franja a una sola obra', total <= 6 * 15 && out.audit.crossWorkDroppedSlots > 0, `${total}`);
    db2.close();
}

section('[8] sin efecto retroactivo');
{
    const db = newDb('retro');
    let rule = base('r-later', 'user', 'R');                                   // unclassified
    ingest(db, 'R', reading(6, T0, { sessionId: 'before' }), attribution(users.R, ['r-later'], [rule], T0));
    const before = engine(db);
    rule = classify(rule, 'paid_b2c', T0 + 10 * MIN);                           // reclasificada después
    const T1 = T0 + 40 * MIN;
    ingest(db, 'R', reading(6, T1, { sessionId: 'after' }), attribution(users.R, ['r-later'], [rule], T1));
    const after = engine(db);
    const st = starts(db).map((s) => JSON.parse(s.payload_json).econAccess.commercialClass);
    ok('la atribución guardada no cambia al reclasificar', st[0] === 'unclassified' && st[1] === 'paid_b2c');
    ok('la sesión previa sigue sin cualificar', after.episodes.find((e) => e.startMs < T0 + 10 * MIN).reasons.includes('access_not_paid'));
    ok('la sesión posterior cualifica', after.episodes.find((e) => e.startMs >= T1).qualified);
    ok('recálculo idéntico para el periodo previo', JSON.stringify(before.episodes[0]) === JSON.stringify(after.episodes.find((e) => e.startMs < T0 + 10 * MIN)));
    db.close();
}

section('[9] compatibilidad con la rotación de archivo');
{
    const dir = path.join(tmp, 'rot'); fs.mkdirSync(dir);
    const ev = path.join(dir, 'events.db'), ar = path.join(dir, 'events.archive.db'), ins = path.join(dir, 'insights.db');
    const db = new Database(ev);
    db.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
      event TEXT NOT NULL, mode TEXT NOT NULL, user_id TEXT NOT NULL, content_id TEXT,
      session_id TEXT NOT NULL, client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
      elapsed_ms INTEGER, progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`);
    const OLD = T0 - 400 * 86_400_000;
    db.prepare(`INSERT INTO events (event_id,event,mode,user_id,content_id,session_id,client_ts,server_ts,payload_json,created_at)
      VALUES ('ev-1','pdf.session_start','pdf','U','c','s',?,?,'{}',?)`).run(OLD, OLD, OLD);
    econ.ensureEconSchema(db);
    db.prepare(`INSERT INTO econ_events (event_id,event,mode,user_id,content_id,session_id,client_ts,server_ts,payload_json,created_at)
      VALUES ('econ-old','econ_tick','pdf','U','c','s',?,?,'{}',?)`).run(OLD, OLD, OLD);
    db.close();
    const i = new Database(ins);
    i.exec(`CREATE TABLE materializer_state (materializer_name TEXT PRIMARY KEY, last_event_id INTEGER NOT NULL, last_ts INTEGER,
        updated_at INTEGER, lag_events INTEGER, lag_seconds INTEGER, degraded INTEGER, last_error TEXT)`);
    i.prepare(`INSERT INTO materializer_state VALUES ('aula_viva_pedagogical_v1', 10, 0, ?, 0, 0, 0, NULL)`).run(T0);
    i.close();
    const r = rot.rotateOnce({ forceRun: true, expiryEnabled: true, nowTs: T0, eventsPath: ev, archivePath: ar, insightsPath: ins, log: () => {} });
    const after = new Database(ev, { readonly: true });
    const live = after.prepare('SELECT COUNT(*) n FROM events').get().n, econN = after.prepare('SELECT COUNT(*) n FROM econ_events').get().n;
    after.close();
    ok('la rotación mueve `events` como siempre', r.ok && !r.skipped && live === 0, JSON.stringify({ ok: r.ok, skipped: r.skipped, reason: r.reason, moved: r.moved }));
    ok('econ_events no se rota ni expira (evidencia conservada)', econN === 1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\neconEvents — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
