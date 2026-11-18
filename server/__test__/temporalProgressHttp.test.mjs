/**
 * temporalProgressHttp.test.mjs — CHP V9 F7-C2R-U3B.
 *
 * Atribución TEMPORAL del progreso al curso. Hasta aquí, las rutas de mediación (progreso por lector y por obra,
 * reading-progress, estado individual, métricas e informe de curso, resumen del grupo, indicadores de intervenciones)
 * mostraban el progreso de toda obra asociada HOY al curso, aunque la lectura fuera anterior a la asignación o al
 * ingreso del lector. Regla única: el mediador recibe el progreso con pertenencia temporal acreditada
 * (`verified_context`); el que no puede acreditarse se identifica (`unverifiable_history`) sin porcentaje, con las
 * sesiones fechadas que sí caen en el curso; sin registro, `no_activity`. El lector conserva todo.
 *
 * Dos instituciones y una tercera con un curso sin obras; dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce,
 * cookies de /api/auth/login y almacenes compartidos; una tercera réplica con el registro de procedencia apagado.
 * `ra-1`: c1 (empezada en el curso), c2 (empezada antes de asignarse), c3 (compra personal), c4 (obra del club) y cs
 * (compartida entre curso y club).
 *   [1][2][6] antes y después de la asignación; compra personal   [9] estado, informes y totales
 *   [3] acumulado sin fecha, historial recortado, sin actividad    [7] curso sin obras; registro apagado
 *   [4][5] obra compartida; cambio de membresía                    [10] historial propio; [8] revocación
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/temporalProgressHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';
import { seedSessionReceipts } from './helpers/seedSessionReceipts.mjs';

if (process.platform === 'win32') {
    console.log('temporalProgressHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u3b_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.EVENTS_SQLITE_PATH = P.events;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' }, Z = { organizationId: 'org-c', colegio: 'Colegio Gamma' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const med = (id, org) => acct(id, ['mediador'], { mediatorKind: 'teacher', ...org });
const reader = (id, org) => acct(id, ['lector'], { ...org, lastLoginAt: new Date(Date.now() - 86400000).toISOString() });
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6'];
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-z', Z), med('med-b', B),
    ...GA.map((id) => reader(id, A)), reader('ra-z', Z), reader('rb-1', B),
    acct('b2c-1', ['lector'], { b2c: true }),
]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = () => [
    grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a', 'med-noc'], [...GA]),
    grp('g-a2', 'Club de lectura', A, 'Colegio Alfa', ['med-a2'], ['ra-1']),
    grp('g-z', 'Quinto Z', Z, 'Colegio Gamma', ['med-z'], ['ra-z']),          // curso SIN obras asociadas
    grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], ['rb-1']),
];
const RULES = () => [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'c2', 'cs'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c4', 'cs'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c-ra1', scope: 'user', scopeId: 'ra-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-1' } },
    { id: 'r-b2c-raz', scope: 'user', scopeId: 'ra-z', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-2' } },
    { id: 'r-b2c-own', scope: 'user', scopeId: 'b2c-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-3' } },
];
// Escritura atómica, como la del servidor: las réplicas nunca leen un archivo a medias.
const writeAtomic = (file, data) => { const t = `${file}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(data)); fs.renameSync(t, file); };
writeAtomic(P.groups, GROUPS());
writeAtomic(P.access, RULES());
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }, { id: 'org-c', name: 'Colegio Gamma' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['c2', 'Obra asignada después'], ['c3', 'Lectura personal comprada'], ['c4', 'Obra del club'], ['cs', 'Obra compartida'], ['cb', 'Obra de la otra institución']]
    .map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const REG = a2RegistryPath();
const Reg = await import('../privacy/a2Registry.mjs');
grantA2([...GA, 'ra-z', 'rb-1']);
grantC005(['med-a', 'med-a2', 'med-z', 'med-b']);

// ── Eventos (events.db compartido, esquema real) ──
const DAY = 86_400_000, NOW = Date.now(), at = (d) => NOW - d * DAY;
const eventsService = await import('../eventsService.js');
const edb = eventsService.getEventsDb();
let n = 0;
const ins = edb.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
    VALUES (@event_id, 1, @event, 'text', @user_id, @content_id, @session_id, @ts, @ts, @elapsed_ms, NULL, @payload_json, @ts)`);
const ev = (user_id, content_id, event, ts, extra = {}) => ins.run({ event_id: `e-${++n}`, event, user_id, content_id, session_id: `s-${user_id}-${content_id}-${Math.floor(ts / 3_600_000)}`,
    ts, elapsed_ms: extra.elapsed ?? null, payload_json: extra.payload ? JSON.stringify(extra.payload) : null });
const readAt = (u, c, t, minutes = 10) => { ev(u, c, 'session_started', t); ev(u, c, 'reading_started', t + 1000);
    ev(u, c, 'session_heartbeat', t + minutes * 60_000, { elapsed: minutes * 60_000 }); ev(u, c, 'reading_completed', t + minutes * 60_000 + 1000); };
const read = (u, c, d, minutes = 10) => readAt(u, c, at(d), minutes);
const abandon = (u, c, d) => { const t = at(d); ev(u, c, 'reading_started', t); ev(u, c, 'reading_abandoned', t + 30_000, { payload: { percentage: 3 } }); };
const count = (u, pred) => edb.prepare('SELECT content_id, server_ts FROM events WHERE user_id = ?').all(u).filter(pred).length;

// ── Progreso (almacén real, compartido con las réplicas) ──
process.env.PROGRESS_SQLITE_PATH = path.join(tmp, 'progress.db');
const Progress = await import('../progressService.js');
const iso = (ms) => new Date(ms).toISOString();
const sessions = (days) => days.map((d, i) => ({ sessionId: `s-${d}-${i}`, startedAt: iso(at(d)), mode: 'text', durationSec: 600 }));
// V9 65A: cada progreso sembrado lleva las constancias que el servidor habría anotado al recibir sus sesiones en línea
// (se anotan más abajo, con el registro ya abierto). `fromOrigin: false` = progreso anterior al registro.
const seededProgress = [];
const progress = (u, c, pct, days, receiptOpts = {}) => { seededProgress.push([Progress.upsertProgress({ id: `${u}__${c}`, userId: u, contentId: c, isCompleted: false,
    canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, lastInteractedMode: 'text' }, updatedAt: iso(days.length ? at(Math.min(...days)) : at(3)), history: sessions(days) }), receiptOpts]); };
// ra-1 (en el curso desde siempre; c2 se asignó al curso hace 10 días; c3 es una compra personal; c4 es del club).
progress('ra-1', 'c1', 40, [20, 12, 6]);        // empezó dentro del curso
progress('ra-1', 'c2', 65, [15, 5]);            // empezó ANTES de la asignación; una sesión posterior
progress('ra-1', 'c3', 70, [18, 9, 2]);         // compra personal
progress('ra-1', 'c4', 30, [7]);                // obra del club
progress('ra-1', 'cs', 20, [8]);                // obra compartida entre el curso y el club
progress('ra-2', 'c1', 35, [30, 14]);
progress('ra-2', 'cs', 55, []);                 // acumulado SIN sesiones fechadas
progress('ra-3', 'c1', 50, [15, 4]);            // ra-3 entró al curso hace 10 días: empezó antes
progress('ra-4', 'c1', 90, Array.from({ length: 20 }, (_, i) => 25 - i), { fromOrigin: false });   // historial recortado (20), anterior al registro
progress('ra-z', 'c3', 20, [4]);
progress('b2c-1', 'c3', 80, [3]);
// ra-5: sin progreso.

// Sesiones heredadas (analytics_db.json): fuente de las métricas y del informe de curso.
const legacy = [];
const session = (userId, contentId, startTs) => {
    // V9 65A: `receivedAt` es el sello que la ingesta pone a cada evento; sin él su fecha no sirve para atribuir.
    legacy.push({ event: 'session_start', userId, contentId, timestamp: startTs, streak: 0, receivedAt: startTs + 5000 });
    legacy.push({ event: 'block_complete', userId, contentId, timestamp: startTs + 1000, streak: 1, receivedAt: startTs + 5000 });
    legacy.push({ event: 'session_end', userId, contentId, timestamp: startTs + 600_000, sessionDuration: 600_000, progressPercentage: 50, receivedAt: startTs + 605_000 });
};
for (const d of [20, 12, 6]) session('ra-1', 'c1', at(d));
session('ra-1', 'c2', at(15)); session('ra-1', 'c2', at(5));
for (const d of [18, 9, 2]) session('ra-1', 'c3', at(d));
session('ra-3', 'c1', at(15)); session('ra-3', 'c1', at(4));
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(legacy));
// Lectura canónica (events.db): fuente del resumen del grupo.
read('ra-1', 'c1', 6, 10); read('ra-1', 'c2', 15, 30); read('ra-1', 'c2', 5, 10); read('ra-1', 'c3', 2, 50);
read('ra-3', 'c1', 15, 30); read('ra-3', 'c1', 4, 10);

// ── Procedencia: línea base hace 100 días; hace 10 días se asignó c2 al curso y entró ra-3 ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const works = (g, without = []) => RULES().filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds).filter((t) => !without.includes(t));
const seeded = Ledger.observeContext(GROUPS().map((g) => ({ groupId: g.id, works: works(g, ['c2']), members: g.memberIds.filter((m) => m !== 'ra-3') })), { nowTs: at(100) });
Ledger.observeContext(GROUPS().map((g) => ({ groupId: g.id, works: works(g), members: g.memberIds })), { nowTs: at(10) });
for (const [record, receiptOpts] of seededProgress) seedSessionReceipts(Ledger, record, { undatedAt: at(3), ...receiptOpts });

const ports = await freePorts(3);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i, flags) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: flags ? '1' : '', AULA_VIVA_CONTEXT_PREVIEW_ENABLED: flags ? '1' : '',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`nunca healthy (${last})\n${s.out.slice(-1500)}`); };
const get = async (s, p, cookie) => {
    const r = await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const post = async (s, p, cookie, body) => {
    const r = await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
};
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const S1 = start(ports[0], 1, true), S2 = start(ports[1], 2, true), S3 = start(ports[2], 3, false);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 300)}`).join(' | ');
const LIST = (u) => `/api/progress/user/${u}`, ITEM = (u, c) => `/api/progress/item/${u}/${c}`, RP = (u) => `/api/reading-progress/${u}`, RPI = (u, c) => `/api/reading-progress/${u}/${c}`,
    STATUS = (u) => `/api/students/${u}/status`, METRICS = (g) => `/api/metrics/course/${g}`, REPORT = (g) => `/api/reports/course/${g}`, SUMMARY = (g) => `/api/groups/${g}/analytics-summary`;
const all200 = (rs) => rs.every((r) => r.status === 200);
const same = (rs, pick = (j) => j) => JSON.stringify(pick(rs[0].json)) === JSON.stringify(pick(rs[1].json));
const ids = (list) => (list || []).map((p) => p.contentId).sort().join();
const hist = (j, c) => (j.historicalProgress || []).find((h) => h.contentId === c);
const breakdown = (j, u) => (j.studentBreakdown || []).find((s) => s.userId === u);
const sessionsOf = (b) => b?.totalSessions;

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base y asignación posterior registradas', seeded.ok && seeded.baseline);

    section('[1] lectura anterior a la asignación · [2] lectura con asociación válida · [6] compra personal');
    {
        const rs = await both(LIST('ra-1'), C['med-a']);
        const j = rs[0].json;
        ok('lista 200, igual en las dos réplicas', all200(rs) && same(rs), st(rs));
        ok('progreso acreditado del curso: c1 y cs, con su porcentaje', ids(j.progressList) === 'c1,cs' && j.progressList.find((p) => p.contentId === 'c1').canonicalProgress.globalPercentage === 40);
        const c2 = hist(j, 'c2');
        ok('c2 (empezada antes de asignarse): identificada como historial no acreditable, SIN porcentaje', !!c2 && c2.attribution === 'unverifiable_history' && c2.reason === 'started_before_course'
            && !('canonicalProgress' in c2) && !/65/.test(JSON.stringify(c2)), JSON.stringify(c2));
        ok('…y con la sesión posterior a la asignación acreditada (1 sesión, 10 min, con fecha)', c2.verifiedSessions === 1 && c2.verifiedReadingTimeMs === 600_000 && typeof c2.lastVerifiedAt === 'string');
        ok('la compra personal (c3) y la obra del club (c4) no aparecen de ninguna forma', !/"c3"|"c4"/.test(rs[0].text) && j.historicalProgress.length === 1);
        ok('recuento de atribución', j.courseAttribution.verified_context === 2 && j.courseAttribution.unverifiable_history === 1);
        const i1 = await both(ITEM('ra-1', 'c1'), C['med-a']), i2 = await both(ITEM('ra-1', 'c2'), C['med-a']), i3 = await both(ITEM('ra-1', 'c3'), C['med-a']);
        ok('por obra: c1 acreditada con su avance', i1.every((r) => r.status === 200 && r.json.attribution === 'verified_context' && r.json.progress.canonicalProgress.globalPercentage === 40), st(i1));
        ok('por obra: c2 sin avance entregado y con su estado (no «sin progreso»)', i2.every((r) => r.status === 200 && r.json.progress === null && r.json.attribution === 'unverifiable_history' && r.json.verifiedSessions === 1 && !/65/.test(r.text)), st(i2));
        ok('por obra: la compra personal sigue denegada', i3.every((r) => r.status === 403));
        const rp = await both(RP('ra-1'), C['med-a']), rpi = await both(RPI('ra-1', 'c2'), C['med-a']);
        ok('reading-progress: resumen solo con lo acreditado y el historial aparte', all200(rp) && same(rp) && ids(rp[0].json.readingProgress) === 'c1,cs' && rp[0].json.summary.total === 2
            && rp[0].json.summary.unverifiableHistory === 1 && ids(rp[0].json.historicalProgress) === 'c2' && typeof rp[0].json.historicalProgress[0].title === 'string', st(rp));
        ok('reading-progress por obra: c2 sin porcentaje y con su estado', rpi.every((r) => r.status === 200 && r.json.readingProgress === null && r.json.attribution === 'unverifiable_history'), st(rpi));
    }

    section('[3] acumulado sin fecha · historial recortado · sin actividad');
    {
        const r2 = await both(LIST('ra-2'), C['med-a']);
        ok('acumulado sin sesiones fechadas: conservado como historial no acreditable, sin certificar su 55 %', all200(r2) && ids(r2[0].json.progressList) === 'c1' && hist(r2[0].json, 'cs')?.reason === 'undated_progress'
            && hist(r2[0].json, 'cs').verifiedSessions === 0 && !/55/.test(JSON.stringify(r2[0].json.historicalProgress)), st(r2));
        const r4 = await both(LIST('ra-4'), C['med-a']);
        ok('historial de sesiones recortado (20): el acumulado no se certifica; las 20 sesiones fechadas sí cuentan', all200(r4) && r4[0].json.progressList.length === 0 && hist(r4[0].json, 'c1')?.reason === 'session_history_truncated'
            && hist(r4[0].json, 'c1').verifiedSessions === 20, st(r4));
        const r5 = await both(LIST('ra-5'), C['med-a']), i5 = await both(ITEM('ra-5', 'c1'), C['med-a']), rp5 = await both(RPI('ra-5', 'c1'), C['med-a']);
        ok('sin progreso: listas vacías y atribución en cero', r5.every((r) => r.status === 200 && r.json.progressList.length === 0 && r.json.historicalProgress.length === 0));
        ok('…y por obra: «no_activity», distinto de historial no acreditable', i5.every((r) => r.json.progress === null && r.json.attribution === 'no_activity') && rp5.every((r) => r.json.attribution === 'no_activity' && r.json.readingProgress?.status === 'not_started'), st(i5));
    }

    section('[4] obra compartida entre cursos · [5] cambio de membresía');
    {
        const club = await both(LIST('ra-1'), C['med-a2']);
        ok('el mediador del club ve acreditadas c4 y cs; nada del curso', all200(club) && ids(club[0].json.progressList) === 'c4,cs' && club[0].json.historicalProgress.length === 0 && !/"c1"|"c2"|"c3"/.test(club[0].text), st(club));
        const r3 = await both(LIST('ra-3'), C['med-a']);
        ok('lector que entró después: su lectura anterior no se atribuye; la sesión posterior al ingreso sí consta', all200(r3) && r3[0].json.progressList.length === 0 && hist(r3[0].json, 'c1')?.reason === 'started_before_course'
            && hist(r3[0].json, 'c1').verifiedSessions === 1, st(r3));
    }

    section('[9] estado, informes y totales coherentes');
    {
        const s1 = await both(STATUS('ra-1'), C['med-a']), s3 = await both(STATUS('ra-3'), C['med-a']), s5 = await both(STATUS('ra-5'), C['med-a']);
        ok('estado de ra-1: totales solo con lo acreditado (2 obras) y el historial aparte (1)', all200(s1) && s1[0].json.progress.booksStarted === 2 && s1[0].json.progress.unverifiableHistory === 1
            && s1[0].json.progress.percentage === 30 && s1[0].json.state === 'ACTIVE_PROGRESS' && s1[0].json.courseAttribution.unverifiable_history === 1, st(s1));
        ok('estado de ra-3: NO «sin avance»; cuenta su sesión acreditada tras el ingreso y deja aparte la lectura no atribuible', s3.every((r) => r.status === 200 && r.json.state === 'ACTIVE_PROGRESS' && r.json.progress.booksStarted === 0
            && r.json.progress.unverifiableHistory === 1 && typeof r.json.lastReadingEventAt === 'string'), st(s3));
        ok('estado de ra-5: sin avance (no hay nada registrado)', s5.every((r) => r.status === 200 && r.json.state === 'ACTIVE_NO_PROGRESS' && r.json.progress.unverifiableHistory === 0), st(s5));
        const m = await both(METRICS('g-a'), C['med-a']), rep = await both(REPORT('g-a'), C['med-a']);
        const b1 = breakdown(m[0].json, 'ra-1'), b3 = breakdown(m[0].json, 'ra-3');
        ok('métricas del curso 200 con el recuento de atribución', all200(m) && m[0].json.courseAttribution.unverifiable_history >= 4 && m[0].json.courseAttribution.readers_with_unverifiable_history === 4, JSON.stringify(m[0].json.courseAttribution));
        ok('ra-1 en el tablero: 4 sesiones (tres de c1 y la de c2 posterior a la asignación); la de c2 anterior y las personales no cuentan', sessionsOf(b1) === 4 && b1.courseAttribution.unverifiable_history === 1, JSON.stringify([sessionsOf(b1), b1.courseAttribution]));
        ok('ra-3 en el tablero: solo la sesión posterior a su ingreso, y marcado con historial no acreditable', sessionsOf(b3) === 1 && b3.courseAttribution.unverifiable_history === 1 && b3.courseAttribution.verified_context === 0, JSON.stringify([sessionsOf(b3), b3.courseAttribution]));
        const b4 = breakdown(m[0].json, 'ra-4'), b5 = breakdown(m[0].json, 'ra-5');
        ok('un lector sin actividad acreditada pero con lectura no atribuible NO figura como «necesita atención»', sessionsOf(b4) === 0 && b4.dataState === 'unverifiable_history' && b4.needsAttention === false
            && b4.contentsCompleted === 0 && !/"c1"/.test(JSON.stringify(b4.readingDetails ?? {})) && !(m[0].json.needsAttention || []).some((x) => x.userId === 'ra-4')
            && m[0].json.courseAttribution.readers_without_verified_activity === 2, JSON.stringify([b4, m[0].json.courseAttribution]).slice(0, 700));
        ok('…y uno sin ninguna lectura sí figura, como siempre', b5.dataState === 'no_activity' && b5.needsAttention === true);
        ok('informe del curso: mismas cifras y mismo recuento', all200(rep) && JSON.stringify(rep[0].json.courseAttribution) === JSON.stringify(m[0].json.courseAttribution)
            && breakdown(rep[0].json, 'ra-1').courseAttribution.unverifiable_history === 1, st(rep).slice(0, 300));
        const sum = await both(SUMMARY('g-a'), C['med-a']);
        const r1 = sum[0].json.readers.find((x) => x.userId === 'ra-1'), r3 = sum[0].json.readers.find((x) => x.userId === 'ra-3');
        ok('resumen del grupo 200 con el recuento de atribución, global y por lector', all200(sum) && sum[0].json.courseAttribution.readers_with_unverifiable_history === 4 && r1.courseAttribution.verified_context === 2
            && r3.courseAttribution.unverifiable_history === 1 && r3.courseAttribution.verified_context === 0, JSON.stringify(sum[0].json.courseAttribution));
        ok('resumen: la fila de quien tiene lectura fechada no atribuible lo dice (no queda como un «0 min» mudo)', r3.historicalActivity === true && r1.historicalActivity === true
            && !sum[0].json.readers.find((x) => x.userId === 'ra-5').historicalActivity, JSON.stringify(r3));
        ok('resumen: el tiempo de lectura de ra-1 no incluye la sesión de c2 anterior a la asignación ni la personal', r1.reading.allEffectiveMs === 20 * 60_000, JSON.stringify(r1.reading));
        const iv = await both('/api/interventions/student/ra-1', C['med-a']), ef = await both('/api/interventions/effectiveness', C['med-a']);
        ok('indicadores de intervenciones del tablero: siguen respondiendo', all200(iv) && all200(ef), st(iv));
    }

    section('[7] curso sin obras · registro apagado');
    {
        const z = await both(LIST('ra-z'), C['med-z']), sz = await both(STATUS('ra-z'), C['med-z']);
        ok('curso sin obras: nada del lector (su compra no es del curso)', z.every((r) => r.status === 200 && r.json.progressList.length === 0 && r.json.historicalProgress.length === 0 && !/"c3"/.test(r.text)), st(z));
        ok('…estado «el curso no tiene obras» (ni «sin avance» ni lectura no atribuible)', sz.every((r) => r.status === 200 && r.json.state === 'NO_COURSE_WORKS' && r.json.progress.unverifiableHistory === 0
            && r.json.progress.courseHasWorks === false && r.json.courseAttribution.course_has_works === false), st(sz));
        const mz = await both(METRICS('g-z'), C['med-z']), sumz = await both(SUMMARY('g-z'), C['med-z']), ma = await get(S1, METRICS('g-a'), C['med-a']);
        ok('tablero y resumen del curso sin obras: lo declaran y no afirman alertas sobre lectura inexistente', mz.every((r) => r.status === 200 && r.json.courseAttribution.course_has_works === false && r.json.alerts.length === 0)
            && sumz.every((r) => r.status === 200 && r.json.courseAttribution.course_has_works === false), st(mz).slice(0, 300));
        ok('…y un curso con obras lo declara como tal', ma.json.courseAttribution.course_has_works === true);
        const off = await get(S3, LIST('ra-1'), await login(S3, 'med-a'));
        ok('con el registro de procedencia apagado: nada se certifica y nada desaparece (c1, c2 y cs como historial no acreditable)', off.status === 200 && off.json.progressList.length === 0
            && ids(off.json.historicalProgress) === 'c1,c2,cs' && off.json.historicalProgress.every((h) => h.reason === 'provenance_not_verifiable' && h.verifiedSessions === 0) && !/"c3"|"c4"/.test(off.text), off.text.slice(0, 300));
        const offS = await get(S3, STATUS('ra-1'), await login(S3, 'med-a'));
        ok('…y el estado no dice «sin avance»', offS.status === 200 && offS.json.state === 'ACTIVE_UNVERIFIED_HISTORY' && offS.json.progress.unverifiableHistory === 3, offS.text.slice(0, 200));
    }

    section('[10] historial propio del lector intacto · administración');
    {
        const own = await both(LIST('ra-1'), C['ra-1']);
        ok('el lector ve sus cinco obras con su avance completo, sin marcas de atribución', all200(own) && ids(own[0].json.progressList) === 'c1,c2,c3,c4,cs' && !('historicalProgress' in own[0].json)
            && own[0].json.progressList.find((p) => p.contentId === 'c2').canonicalProgress.globalPercentage === 65, st(own));
        ok('…su estado propio cuenta todo', (await both(STATUS('ra-1'), C['ra-1'])).every((r) => r.status === 200 && r.json.progress.booksStarted === 5 && !('courseAttribution' in r.json)));
        ok('la cuenta B2C conserva su progreso', (await both(LIST('b2c-1'), C['b2c-1'])).every((r) => r.status === 200 && ids(r.json.progressList) === 'c3'));
        ok('la administración conserva la vista completa del lector', (await both(LIST('ra-1'), C.adm)).every((r) => r.status === 200 && r.json.progressList.length === 5));
        ok('el almacén de progreso no se modificó', Progress.getProgressByUser('ra-1').length === 5 && Progress.getProgressItem('ra-1', 'c2').canonicalProgress.globalPercentage === 65);
    }

    section('[8] revocación A2 / C005 · otros accesos');
    {
        const deniedAll = async (u, cookie) => { const out = []; for (const p of [LIST(u), ITEM(u, 'c1'), RP(u), RPI(u, 'c1'), STATUS(u)]) out.push(...await both(p, cookie)); return out.every((r) => r.status === 403 || r.status === 404) && out.every((r) => !/globalPercentage|historicalProgress/.test(r.text)); };
        ok('otra institución: denegado', await deniedAll('ra-1', C['med-b']));
        ok('mediador sin C005: denegado', await deniedAll('ra-1', C['med-noc']));
        ok('cuenta B2C: denegada a cualquier mediador', await deniedAll('b2c-1', C['med-a']));
        Reg.appendDecisions([{ subjectId: 'ra-2', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-2' }]);
        ok('A2 revocada: denegado de inmediato en las dos réplicas', await deniedAll('ra-2', C['med-a']));
        ok('…y sale del tablero del curso', (await both(METRICS('g-a'), C['med-a'])).every((r) => r.status === 200 && !breakdown(r.json, 'ra-2')));
        Reg.appendDecisions([{ subjectId: 'med-a2', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-A2' }]);
        ok('C005 revocado: denegado de inmediato', await deniedAll('ra-1', C['med-a2']));
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); Progress.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
