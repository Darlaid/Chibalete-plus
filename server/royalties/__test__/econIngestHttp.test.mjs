/**
 * econIngestHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A2.
 *
 * Servidor REAL con sesión firmada (SESSION_AUTH_MODE=enforce): dos réplicas
 * con ECONOMIC_INGEST_MODE=on sobre el mismo events.db/sessions.db y una
 * tercera con el flag apagado. Comprueba:
 *   [1] lector autenticado válido → econ_events (identidad de la sesión)
 *   [2] anónimo rechazado
 *   [3] suplantación rechazada (header y cuerpo)
 *   [4] contenido inexistente o inaccesible
 *   [5] réplicas: una sola atribución por sesión
 *   [6] flag apagado: respuesta idéntica a hoy y sin tabla nueva
 *   [7] regresión: eventos de producto, acceso y catálogo intactos; la tabla
 *       `events` no recibe filas económicas
 *   [8] F3-A3: /api/runtime-config expone el flag; ticks generados por el
 *       núcleo real del cliente (cambio de modo entre réplicas) → 1 episodio
 *
 * POSIX-only (clave de sesión 0400, mismo criterio que sessionIdentityIntegration).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { createEconomicTickCore } from '../../../utils/economicTick.mjs';
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 } from '../economicEpisodes.mjs';
import { engineClockContext, excludedUsersFromRows } from '../econEvents.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
if (process.platform === 'win32') {
    console.log('econIngestHttp — SKIP (POSIX-only: clave de sesión 0400/uid)');
    process.exit(0);
}

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_econ_http_'));
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'), uploads: path.join(tmp, 'uploads'), offline: path.join(tmp, 'offline.db'),
    sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session_signing_key'),
    events: path.join(tmp, 'events.db'), eventsOff: path.join(tmp, 'events-off.db'), insights: path.join(tmp, 'insights.db'),
};
fs.mkdirSync(P.uploads, { recursive: true });
const PW = 'fixture-pass';
const hash = bcrypt.hashSync(PW, 4);
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'RDR', email: 'rdr@fx.test', password: hash, roles: ['lector'], accountStatus: 'active', nombre_completo: 'R' },
    { id: 'ADM', email: 'adm@fx.test', password: hash, roles: ['administrador'], accountStatus: 'active', nombre_completo: 'A' },
]));
for (const f of [P.groups, P.schools]) fs.writeFileSync(f, '[]');
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));
const mk = (n) => ({ id: `content-c${n}`, titulo: `Obra ${n}`, autor: 'A', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', publisherId: 'pub-chibalete-editores' });
fs.writeFileSync(P.content, JSON.stringify([mk(1), mk(2)], null, 2));
const SINCE = Date.now() - 86_400_000;
// Regla pagada SINTÉTICA (solo en este temporal): RDR → c1.
fs.writeFileSync(P.access, JSON.stringify([{
    id: 'r-paid-fixture', scope: 'user', scopeId: 'RDR', titleIds: ['content-c1'], collectionIds: [], expiresAt: null,
    commercialClass: 'paid_b2c', commercialClassSince: SINCE,
    commercialClassHistory: [{ commercialClass: 'paid_b2c', since: SINCE, by: 'fixture', evidenceRef: 'fixture-sintetica' }],
}], null, 2));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

const ORIGIN = 'https://app.test';
function spawnApi(port, { econ = true, eventsPath = P.events } = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: path.join(tmp, 'data'),
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
            UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: path.join(tmp, 'audit.json'),
            IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
            SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
            SESSION_ALLOWED_ORIGINS: ORIGIN, ALLOWED_ORIGINS: ORIGIN, ACCESS_FALLBACK_MODE: 'restricted',
            EVENTS_SQLITE_PATH: eventsPath, INSIGHTS_SQLITE_PATH: P.insights,
            ROYALTIES_DB: path.join(tmp, 'rdb', 'royalties.db'),
            ECONOMIC_INGEST_MODE: econ ? 'on' : '',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
    });
    let boot = '';
    child.stdout.on('data', (d) => { boot += d; });
    child.stderr.on('data', (d) => { boot += d; });
    child._boot = () => boot;
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-1500)}`);
        try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-1500)}`);
}
async function login(base, email) {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    return m ? `chp_session=${m[1]}` : null;
}
const post = async (base, events, { cookie, uid } = {}) => {
    const headers = { 'content-type': 'application/json', origin: ORIGIN };
    if (cookie) headers.cookie = cookie;
    if (uid) headers['x-user-id'] = uid;
    const r = await fetch(`${base}/api/v1/events`, { method: 'POST', headers, body: JSON.stringify({ events }) });
    let body = null; try { body = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body };
};
const get = async (base, url, cookie) => (await fetch(`${base}${url}`, { headers: { cookie } })).status;

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = () => Array.from(crypto.randomBytes(26), (b) => CROCK[b % 32]).join('');
const tick = (o = {}) => ({
    event: 'econ_tick', eventId: ulid(), mode: 'pdf', contentId: 'content-c1', sessionId: o.sessionId ?? 'sess-1',
    clientTs: o.clientTs ?? Date.now(), ...(o.userId ? { userId: o.userId } : {}),
    payload: { windowMs: 15000, visible: true, humanSignalAgoMs: 2000, audio: null }, ...o.override,
});
const econRows = (file, where = '') => {
    if (!fs.existsSync(file)) return null; // events.db se abre en perezoso: sin escrituras no existe
    const d = new Database(file, { readonly: true });
    try {
        const has = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='econ_events'").get();
        return has ? d.prepare(`SELECT * FROM econ_events ${where} ORDER BY id`).all() : null;
    } finally { d.close(); }
};
const eventsCount = (file) => { const d = new Database(file, { readonly: true }); try { return d.prepare('SELECT COUNT(*) n FROM events').get().n; } finally { d.close(); } };

const PORT = 5200 + (process.pid % 120);
const b1 = `http://127.0.0.1:${PORT}`, b2 = `http://127.0.0.1:${PORT + 1}`, b3 = `http://127.0.0.1:${PORT + 2}`;
const api1 = spawnApi(PORT), api2 = spawnApi(PORT + 1), api3 = spawnApi(PORT + 2, { econ: false, eventsPath: P.eventsOff });

try {
    await Promise.all([waitHealthy(b1, api1), waitHealthy(b2, api2), waitHealthy(b3, api3)]);
    const rdr = await login(b1, 'rdr@fx.test');
    const adm = await login(b1, 'adm@fx.test');
    ok('login real del lector y del administrador', !!rdr && !!adm);

    console.log('\n[1] lector autenticado válido');
    let r = await post(b1, [tick()], { cookie: rdr });
    ok('econ_tick aceptado', r.status === 200 && r.body.accepted === 1 && r.body.rejected === 0, JSON.stringify(r));
    let rows = econRows(P.events);
    ok('fila de actividad + atribución en econ_events', rows?.length === 2 && rows.every((x) => x.user_id === 'RDR'));
    const st = rows.find((x) => x.event === 'econ.session_start');
    const ea = JSON.parse(st.payload_json).econAccess;
    ok('atribución del servidor: regla sintética pagada', ea.ruleId === 'r-paid-fixture' && ea.commercialClass === 'paid_b2c' && ea.eligible === true);

    console.log('\n[2] anónimo');
    r = await post(b1, [tick()]);
    ok('sin sesión → 401', r.status === 401);
    r = await post(b1, [tick()], { uid: 'RDR' });
    ok('solo x-user-id (sin cookie) → 401', r.status === 401);

    console.log('\n[3] suplantación');
    r = await post(b1, [tick()], { cookie: rdr, uid: 'ADM' });
    ok('cookie de lector + x-user-id ajeno → 401', r.status === 401);
    r = await post(b1, [tick({ userId: 'ADM' })], { cookie: rdr });
    ok('userId ajeno en el cuerpo → rechazado', r.status === 200 && r.body.rejected === 1 && r.body.accepted === 0);
    ok('ninguna fila a nombre de otro usuario', econRows(P.events).every((x) => x.user_id === 'RDR'));

    console.log('\n[4] contenido inexistente o inaccesible');
    r = await post(b1, [tick({ sessionId: 's-missing', override: { contentId: 'content-nope' } })], { cookie: rdr });
    ok('obra inexistente → rechazada', r.body.rejected === 1);
    r = await post(b1, [tick({ sessionId: 's-denied', override: { contentId: 'content-c2' } })], { cookie: rdr });
    ok('obra sin acceso → rechazada', r.body.rejected === 1);
    r = await post(b1, [tick({ clientTs: Date.now() - 11 * 60_000, sessionId: 's-late' })], { cookie: rdr });
    ok('tick retrasado > 10 min → rechazado', r.body.rejected === 1);

    console.log('\n[5] réplicas');
    r = await post(b2, [tick({ clientTs: Date.now() + 1 })], { cookie: rdr });
    ok('la otra réplica acepta el siguiente tick de la sesión', r.body.accepted === 1);
    rows = econRows(P.events);
    ok('una sola atribución para la sesión', rows.filter((x) => x.event === 'econ.session_start' && x.session_id === 'sess-1').length === 1);
    const dupe = rows.find((x) => x.event === 'econ_tick');
    r = await post(b2, [{ ...tick(), eventId: dupe.event_id, clientTs: dupe.client_ts }], { cookie: rdr });
    ok('tick repetido en la otra réplica → deduplicado', r.body.deduplicated === 1);

    console.log('\n[6] flag apagado');
    const rOff = await login(b3, 'rdr@fx.test');
    r = await post(b3, [tick()], { cookie: rOff });
    ok('econ_tick rechazado igual que antes de F3-A2', r.status === 200 && r.body.accepted === 0 && r.body.rejected === 1);
    ok('sin tabla econ_events con el flag apagado', econRows(P.eventsOff) === null);

    console.log('\n[7] regresión');
    const before = eventsCount(P.events);
    const product = { eventId: ulid(), schemaVersion: 1, event: 'pdf.page_view', mode: 'pdf', userId: 'RDR', contentId: 'content-c1', sessionId: 'sess-1', clientTs: Date.now(), payload: {} };
    r = await post(b1, [product, tick({ clientTs: Date.now() + 2 })], { cookie: rdr });
    ok('lote mixto: evento de producto y econ_tick aceptados', r.body.accepted === 2, JSON.stringify(r.body));
    ok('la tabla events recibe solo el evento de producto', eventsCount(P.events) === before + 1);
    ok('acceso: c1 200 / c2 403', await get(b1, '/api/content/content-c1/access?userId=RDR', rdr) === 200 && await get(b1, '/api/content/content-c2/access?userId=RDR', rdr) === 403);
    ok('catálogo del lector 200', await get(b1, '/api/content', rdr) === 200);
    ok('auth/me 200', await get(b1, '/api/auth/me', rdr) === 200);
    console.log('\n[8] F3-A3: flag público y ticks del cliente real');
    const cfgOn = await (await fetch(`${b1}/api/runtime-config`)).json();
    const cfgOff = await (await fetch(`${b3}/api/runtime-config`)).json();
    ok('runtime-config: on / off según ECONOMIC_INGEST_MODE', cfgOn.economicIngest === 'on' && cfgOff.economicIngest === 'off' && 'mediaBaseUrl' in cfgOn);
    // Lectura de RDR: 45 s en PDF y 45 s en Guiado, hace 5 min, con el núcleo del cliente.
    const t0 = Date.now() - 5 * 60_000;
    const clientTicks = [];
    for (const [i, mode] of [['A', 'pdf'], ['B', 'text']].entries()) {
        const from = t0 + i * 50_000;
        const core = createEconomicTickCore({ mode: mode[1], contentId: 'content-c1', sessionId: `f3a3-${mode[0]}`, startedAt: from, visible: true });
        for (let t = from + 1000; t <= from + 45_000; t += 1000) {
            if ((t - from) % 10_000 === 0) core.humanSignal(t);
            if ((t - from) % 15_000 === 0) { const e = core.tick(t, ulid()); if (e) clientTicks.push(e); }
        }
    }
    r = await post(b1, clientTicks.filter((e) => e.mode === 'pdf'), { cookie: rdr });
    const r2 = await post(b2, clientTicks.filter((e) => e.mode === 'text'), { cookie: rdr });
    ok('ticks del cliente aceptados en las dos réplicas', r.body.rejected === 0 && r2.body.rejected === 0 && r.body.accepted + r2.body.accepted === clientTicks.length, JSON.stringify([r.body, r2.body]));
    const f3 = econRows(P.events, "WHERE session_id LIKE 'f3a3-%'");
    const res = computeEconomicEpisodes(f3, { ruleSet: RULE_SET_RS_2026_01_V1, eligibleContentIds: ['content-c1'], excludedUsers: excludedUsersFromRows(f3), ...engineClockContext() });
    ok('motor: 1 episodio cualificado con los dos modos (regla pagada sintética)', res.episodes.length === 1 && res.episodes[0].qualified && Object.keys(res.episodes[0].modeSeconds).length === 2, JSON.stringify(res.episodes));
    ok('ninguna réplica cayó', api1.exitCode === null && api2.exitCode === null && api3.exitCode === null);
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    for (const c of [api1, api2, api3]) c.kill();
    await sleep(500);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\neconIngestHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
