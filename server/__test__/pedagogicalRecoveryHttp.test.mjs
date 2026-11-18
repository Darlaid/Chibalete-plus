/**
 * pedagogicalRecoveryHttp.test.mjs — CHP V9 F7-C2R-U3.
 *
 * Leo del mediador, ICDLI, impacto de intervenciones y agregados de curso, calculados con el contexto pedagógico (U1).
 * Los acumuladores globales (perfil y memoria de Leo, impacto y agregados guardados) llevan valores que solo pueden
 * salir de ellos: si un mediador los ve, hay fuga. `ra-1` tiene mucha actividad PERSONAL (lectura, sesiones y
 * conversaciones con Leo sobre una compra) que no debe mover ningún indicador del curso.
 *
 * Dos instituciones y una tercera con un curso sin obras; dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce,
 * cookies de /api/auth/login, almacenes compartidos y el registro de procedencia encendido; una tercera réplica con el
 * registro apagado.
 *   [1] Leo con contexto válido; activación y familias    [6][7] agregados, cohortes y umbral de divulgación
 *   [2][10] ICDLI y lectura personal adicional             [8] cambios de membresía y obra compartida
 *   [3] sin procedencia → insuficiencia                     [11] revocación inmediata de A2 / C005
 *   [4][5] impacto individual y grupal                      [13] nada global se toca
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/pedagogicalRecoveryHttp.test.mjs
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

if (process.platform === 'win32') {
    console.log('pedagogicalRecoveryHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u3_'));
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
const reader = (id, org) => acct(id, ['lector'], { ...org });
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6', 'ra-7'];
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-z', Z), med('med-b', B),
    ...GA.map((id) => reader(id, A)), reader('ra-noa2', A), reader('ra-8', A), reader('ra-z', Z), reader('rb-1', B),
    acct('b2c-1', ['lector'], { b2c: true }),
]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = () => [
    grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a', 'med-noc'], [...GA, 'ra-noa2']),
    grp('g-a2', 'Club de lectura', A, 'Colegio Alfa', ['med-a2'], ['ra-1']),
    grp('g-z', 'Quinto Z', Z, 'Colegio Gamma', ['med-z'], ['ra-z']),          // curso SIN obras asociadas
    grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], ['rb-1']),
];
const RULES = () => [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'cs'], collectionIds: [] },
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
grantA2([...GA, 'ra-8', 'ra-z', 'rb-1']);
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

const noon = (d) => Math.floor(at(d) / DAY) * DAY + DAY / 2;
const abandonsOn = (u, c, d) => { for (const k of [0, 1, 2]) { const t = noon(d) + k * 600_000; ev(u, c, 'reading_started', t); ev(u, c, 'reading_abandoned', t + 30_000, { payload: { percentage: 3 } }); } };
// ── Lectura (events.db) ──
for (const d of [20, 12, 6, 3]) read('ra-1', 'c1', d);                       // ra-1: curso regular; mucha lectura y abandonos PERSONALES
for (const d of [18, 17, 16, 9, 8, 4]) abandonsOn('ra-1', 'c3', d);
read('ra-1', 'c4', 7); read('ra-1', 'cs', 5);
abandonsOn('ra-2', 'c1', 13); abandonsOn('ra-2', 'c1', 12);                  // ra-2: abandono alto en el curso
abandonsOn('ra-3', 'c1', 30); abandonsOn('ra-3', 'c1', 29);                  // ra-3: abandonaba; tras la intervención (día 20) lee a diario
for (const d of [14, 13, 12, 11, 10, 9, 8, 7]) read('ra-3', 'c1', d);
for (const d of [16, 15, 12, 10]) abandonsOn('ra-3', 'c3', d);               // …y a la vez abandona su lectura PERSONAL
read('ra-4', 'c1', 6);                                                       // ra-4: historia no verificable
ev('ra-5', 'c1', 'session_started', at(25));                                 // ra-5: una sola fila
abandonsOn('ra-7', 'c1', 6); abandonsOn('ra-7', 'c1', 5);
read('ra-noa2', 'c1', 5); read('ra-noa2', 'c1', 4);                          // sin A2: jamás entra en agregados
read('ra-z', 'c3', 4); read('rb-1', 'cb', 3);

// ── Sesiones heredadas (analytics_db.json): la fuente del ICDLI ──
const legacy = [];
const session = (userId, contentId, startTs, d) => {
    // V9 65A: `receivedAt` es el sello de recepción que la ingesta pone a cada evento; sin él su fecha no sirve para atribuir.
    legacy.push({ event: 'session_start', userId, contentId, timestamp: startTs, streak: 0, receivedAt: startTs + 5000 });
    legacy.push({ event: 'block_complete', userId, contentId, timestamp: startTs + 1000, streak: 1, receivedAt: startTs + 1000 + 5000 });
    legacy.push({ event: 'block_complete', userId, contentId, timestamp: startTs + 2000, streak: 2, receivedAt: startTs + 2000 + 5000 });
    legacy.push({ event: 'session_end', userId, contentId, timestamp: startTs + d, sessionDuration: d, progressPercentage: 50, receivedAt: startTs + d + 5000 });
};
for (const d of [20, 12, 6, 3]) session('ra-1', 'c1', at(d), 600_000);
for (const d of [19, 15, 11, 9, 5, 2]) session('ra-1', 'c3', at(d), 5_400_000);
session('ra-2', 'c1', at(12), 300_000);
const writeLegacy = () => fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(legacy));
writeLegacy();

// ── Leo: evidencias FECHADAS por obra, y acumuladores globales con una marca que el mediador no debe ver ──
const EV = path.join(tmp, 'leo_evidence.json');
process.env.LEO_EVIDENCE_DB = EV;
const iso = (ms) => new Date(ms).toISOString();
const leoEntries = [];
let en = 0;
const leo = (userId, contentId, ms, interactionType, pedagogicalObjective, extra = {}) => leoEntries.push({ id: `ev-${++en}`, userId, contentId, surface: 'chat', interactionType,
    chunkIndex: null, pedagogicalObjective, promptType: 'question', pedagogicalStage: extra.stage ?? 'comprehension', difficultyLevel: extra.difficulty ?? 'medio',
    evidenceType: extra.evidenceType ?? 'autonomous', interpretationHint: `pista-${pedagogicalObjective}`, icdliHasData: false, preferredSupportType: null,
    interactionCountAtEvent: en, sequenceId: extra.sequenceId ?? null, sequenceStep: extra.sequenceStep ?? null, timestamp: iso(ms) });
for (const h of [30, 29, 28, 27]) leo('ra-1', 'c1', NOW - h * 3_600_000, 'inferential', 'inferential', { stage: 'reflection', difficulty: 'avanzado' });   // curso: inferencia
for (let i = 0; i < 12; i++) leo('ra-1', 'c3', NOW - (40 + i) * 3_600_000, 'vocab', 'vocabulary', { evidenceType: 'scaffolded' });                          // personal: vocabulario
for (const h of [26, 25]) leo('ra-2', 'c1', NOW - h * 3_600_000, 'reflection', 'critical', { stage: 'reflection' });
for (const h of [50, 49]) leo('ra-4', 'c1', NOW - h * 3_600_000, 'vocab', 'vocabulary');                                                                     // anterior a su membresía verificable
leoEntries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
fs.writeFileSync(EV, JSON.stringify({ schemaVersion: 1, entries: leoEntries }));
const prof = (userId, v) => ({ schemaVersion: 1, userId, vocabularyInteractionsCount: v, inferentialInteractionsCount: 0, reflectionInteractionsCount: 0, writingInteractionsCount: 0,
    totalChatInteractions: v, oralityAttemptsCount: 0, averageOralityScore: null, preferredSupportType: 'vocabulary', updatedAt: iso(NOW) });
fs.writeFileSync(path.join(P.data, 'leo_profile_db.json'), JSON.stringify({ profileMap: { 'ra-1': prof('ra-1', 77), 'ra-2': prof('ra-2', 77), 'ra-6': prof('ra-6', 77), 'ra-z': prof('ra-z', 77) } }));
const mem = (n, stage) => ({ schemaVersion: 1, interactionCount: n, lastInterventionAt: iso(NOW - 3_600_000), pedagogicalStage: stage, difficultyLevel: 'medio', recentAnchors: ['a', 'b', 'c'], updatedAt: iso(NOW - 3_600_000) });
fs.writeFileSync(path.join(P.data, 'leo_memory_db.json'), JSON.stringify({ memoryMap: { 'ra-1__c1': mem(99, 'creation'), 'ra-1__c3': mem(41, 'creation'), 'ra-6__c1': mem(55, 'creation') } }));

// ── Procedencia: línea base hace 100 días; la membresía de ra-4 solo consta desde ayer ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const snapshot = () => GROUPS().map((g) => ({ groupId: g.id, works: RULES().filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds }));
const seeded = Ledger.observeContext(snapshot(), { nowTs: at(100) });
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
const idb = getInsightsExtDb();
idb.prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id = 'ra-4'`).run(at(1));

// ── Intervenciones (reales) y almacén GLOBAL de impacto y agregados con marca ──
const Ped = await import('../db/pedagogyDbExt.mjs'), Out = await import('../db/outcomesDbExt.mjs');
const pdb = Ped.getPedagogyExtDb(), odb = Out.getOutcomesExtDb();
let seq = 0;
const insertRow = (db, t, values) => {
    const info = db.prepare(`PRAGMA table_info(${t})`).all();
    const row = {};
    for (const c of info) {
        if (c.name in values) { row[c.name] = values[c.name]; continue; }
        if (c.pk && /INT/i.test(c.type) && info.filter((x) => x.pk).length === 1) continue;
        if (c.notnull && c.dflt_value === null) row[c.name] = /INT/i.test(c.type) ? NOW + (seq++) : /REAL|NUM/i.test(c.type) ? 1 : (/_json$/.test(c.name) ? '{}' : `${c.name}-${seq++}`);
    }
    const k = Object.keys(row);
    db.prepare(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map((x) => '@' + x).join(',')})`).run(row);
};
const intv = (id, teacher, student, daysAgo) => insertRow(pdb, 'pedagogical_interventions', { intervention_id: id, teacher_id: teacher, student_id: student, intervention_type: 'lectura_guiada',
    created_at: at(daysAgo), notes: null, recommendation_origin: null, outcome: 'pending', outcome_at: null });
intv('iv-ra3', 'med-a', 'ra-3', 20);          // con evidencia en las dos ventanas
intv('iv-ra5', 'med-a', 'ra-5', 20);          // sin evidencia suficiente
intv('iv-ra7', 'med-a', 'ra-7', 3);           // ventana posterior aún abierta
intv('iv-ra3-b', 'med-b', 'ra-3', 20);        // de un mediador de OTRA institución: no es del contexto
intv('iv-noa2', 'med-a', 'ra-noa2', 20);      // lector sin A2: no entra en el impacto del grupo
// Cinco intervenciones de otra estrategia (el mínimo para que haya un aprendizaje).
for (const u of ['ra-1', 'ra-2', 'ra-3', 'ra-5', 'ra-7']) insertRow(pdb, 'pedagogical_interventions', { intervention_id: `ac-${u}`, teacher_id: 'med-a', student_id: u,
    intervention_type: 'acompanamiento', created_at: at(21), notes: null, recommendation_origin: null, outcome: 'pending', outcome_at: null });
for (const u of ['ra-3', 'ra-5', 'ra-7', 'ra-noa2']) insertRow(odb, 'intervention_outcomes', { outcome_id: `out-glob-${u}`, intervention_id: `glob-${u}`, user_id: u, scope_type: 'user', scope_id: u,
    intervention_type: 'lectura_guiada', outcome_label: 'worsened', baseline_metrics_json: JSON.stringify({ who: `marca-${u}` }), followup_metrics_json: '{}', delta_metrics_json: '{}', notes_json: '{}' });
insertRow(idb, 'cohort_rollups', { scope_type: 'group', scope_id: 'g-a', period: '28d', metric_key: 'active_users', metric_value: 999, updated_at: NOW, source_watermark: 1 });
insertRow(idb, 'cohort_rollups', { scope_type: 'group', scope_id: 'g-a', period: '28d', metric_key: 'avg_continuidad', metric_value: 0.8125, updated_at: NOW, source_watermark: 1 });
insertRow(odb, 'cohort_definitions', { cohort_id: 'coh-risk', cohort_key: 'risk:abandono_alto', cohort_type: 'risk', scope_type: 'risk', scope_id: 'abandono_alto', criteria_json: '{}', active: 1 });
for (const u of [...GA, 'ra-noa2']) insertRow(odb, 'cohort_memberships', { cohort_id: 'coh-risk', user_id: u, membership_reason_json: '{}', left_at: null });
for (const u of GA) insertRow(idb, 'user_reading_profiles', { user_id: u, abandono_risk: 0.8125, engagement_score: 0.8125, last_active_at: NOW - DAY, updated_at: NOW, source_watermark: 1 });
const leoStores = () => ['leo_profile_db.json', 'leo_memory_db.json'].map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(P.data, f))).digest('hex')).join();
const LEO_BEFORE = leoStores();

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
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 260)}`).join(' | ');
const AV = '/api/aula-viva';
const LEO = (u) => `/api/leo/mediator/student/${u}`, ACT = (u) => `/api/leo/activation/${u}`, IMP = (u) => `${AV}/institutional/outcomes/scope/user/${u}`,
    GIMP = (g) => `${AV}/institutional/outcomes/scope/group/${g}`, COH = (g) => `${AV}/cohorts/group/${g}`, ROLL = (g) => `${AV}/cohorts/group/${g}/rollups`;
const MARK = /0\.8125|marca[-_]|"metric_value":999\b/;
const clean = (rs) => rs.every((r) => !MARK.test(r.text));
const all200 = (rs) => rs.every((r) => r.status === 200);
const denied = (r) => r.status === 403 && /scope_access_denied/.test(r.text) && !MARK.test(r.text);
const sum = (r) => r.json?.summary;
// Lo que no depende del instante de la petición.
const stableSum = (s) => JSON.stringify(s && { ...s, generatedAt: 0 });
const metricOf = (j, k) => j?.metrics?.find((m) => m.metric_key === k)?.metric_value;

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base sembrada', seeded.ok && seeded.baseline);
    const admLeo = await get(S1, LEO('ra-1'), C.adm);
    ok('preparación: la administración ve el perfil GLOBAL de Leo (apoyo «vocabulary», 140 interacciones acumuladas)', admLeo.status === 200 && sum(admLeo).preferredSupportType === 'vocabulary' && sum(admLeo).totalInteractions === 140, admLeo.text.slice(0, 300));

    section('[1] Leo usa contexto pedagógico válido · [3] sin procedencia → insuficiencia');
    let leo1;
    {
        const rs = await both(LEO('ra-1'), C['med-a']);
        leo1 = sum(rs[0]);
        ok('resumen 200 e igual en las dos réplicas', all200(rs) && stableSum(sum(rs[0])) === stableSum(sum(rs[1])) && leo1.data_state === 'ok', st(rs));
        ok('perfil del CURSO: apoyo «inferential» y objetivo dominante «inferential» (el global dice «vocabulary»)', leo1.preferredSupportType === 'inferential' && leo1.dominantPedagogicalObjective === 'inferential');
        ok('interacciones del curso: 4, no las 99 de la memoria acumulada ni las 41 personales', leo1.totalInteractions === 4 && leo1.provenance.evidence === 4);
        ok('señales recientes solo de la obra del curso', leo1.recentEvidenceSignals.length === 4 && leo1.recentEvidenceSignals.every((s) => s.contentId === 'c1') && !/"c3"/.test(rs[0].text));
        ok('alertas y acción sugerida calculadas (no retenidas) y sin el predominio léxico personal', Array.isArray(leo1.alerts) && !leo1.alerts.includes('Predomina apoyo léxico en las interacciones')
            && typeof leo1.suggestedMediatorAction === 'string' && !('withheld' in leo1), JSON.stringify([leo1.alerts, leo1.suggestedMediatorAction]));
        ok('lleva estado, contexto y procedencia', leo1.context.groups[0].group_id === 'g-a' && typeof leo1.provenance.last_ts === 'string');

        const r6 = await both(LEO('ra-6'), C['med-a']);
        ok('sin actividad del curso: no_activity, sin nivel, alertas ni acción (ni el apoyo «vocabulary» de su perfil global)', all200(r6) && sum(r6[0]).data_state === 'no_activity' && sum(r6[0]).alerts === null
            && sum(r6[0]).suggestedMediatorAction === null && sum(r6[0]).preferredSupportType === null && sum(r6[0]).icdliLevel === null && sum(r6[0]).totalInteractions === null, st(r6));
        const r4 = await both(LEO('ra-4'), C['med-a']);
        ok('evidencias anteriores a la pertenencia verificable: insufficient, sin diagnóstico', all200(r4) && sum(r4[0]).data_state === 'insufficient' && sum(r4[0]).reason === 'unverifiable_history'
            && sum(r4[0]).alerts === null && sum(r4[0]).preferredSupportType === null && sum(r4[0]).recentEvidenceSignals.length === 0, st(r4));
        const rz = await both(LEO('ra-z'), C['med-z']);
        ok('curso sin obras: no_course_works', all200(rz) && sum(rz[0]).data_state === 'no_course_works' && sum(rz[0]).preferredSupportType === null, st(rz));
        const off = await get(S3, LEO('ra-1'), await login(S3, 'med-a'));
        ok('registro de procedencia apagado: insufficient / provenance_not_recorded', off.status === 200 && sum(off).data_state === 'insufficient' && sum(off).reason === 'provenance_not_recorded' && sum(off).preferredSupportType === null, off.text.slice(0, 240));

        const h1 = await both(`${LEO('ra-1')}/content/c1`, C['med-a']), h3 = await both(`${LEO('ra-1')}/content/c3`, C['med-a']);
        ok('historial por obra del curso: 4 interacciones fechadas (no las 99 acumuladas)', h1.every((r) => r.status === 200 && r.json.history.interactionCount === 4 && r.json.history.objectiveDistribution.inferential === 4 && r.json.history.pedagogicalStage === 'reflection'), st(h1));
        ok('historial de la compra personal: denegado', h3.every((r) => r.status === 403));
    }

    section('[2] ICDLI no incorpora actividad personal · [10] lectura personal adicional');
    {
        ok('ICDLI del curso con datos (4 sesiones de la obra del curso)', leo1.icdliHasData === true && leo1.provenance.reading_sessions === 4 && typeof leo1.icdliComposite === 'number' && typeof leo1.icdliLevel === 'string');
        const before = stableSum(leo1), actBefore = JSON.stringify((await get(S1, ACT('ra-1'), C['med-a'])).json.outputs.map((o) => [o.type, o.message]));
        for (let i = 0; i < 25; i++) session('ra-1', 'c3', NOW - (i + 1) * 3_600_000, 7_000_000);
        writeLegacy();
        const more = JSON.parse(fs.readFileSync(EV, 'utf8'));
        for (let i = 0; i < 30; i++) more.entries.push({ ...leoEntries.find((e) => e.contentId === 'c3'), id: `ev-x-${i}`, timestamp: iso(NOW - (i + 1) * 60_000) });
        fs.writeFileSync(EV, JSON.stringify(more));
        for (let i = 0; i < 20; i++) abandonsOn('ra-1', 'c3', 1 + i * 0.5);
        const again = await both(LEO('ra-1'), C['med-a']);
        ok('25 sesiones, 30 conversaciones y 60 abandonos PERSONALES más: el resumen de Leo no cambia', all200(again) && stableSum(sum(again[0])) === before && stableSum(sum(again[1])) === before, st(again));
        const actAfter = JSON.stringify((await get(S2, ACT('ra-1'), C['med-a'])).json.outputs.map((o) => [o.type, o.message]));
        ok('…ni las salidas de activación', actAfter === actBefore, `${actBefore} | ${actAfter}`);
        ok('…y la administración sigue viendo el perfil GLOBAL', sum(await get(S1, LEO('ra-1'), C.adm)).preferredSupportType === 'vocabulary');
    }

    section('[1b] activación y comunicación con familias');
    {
        const rs = await both(ACT('ra-1'), C['med-a']);
        const types = rs[0].json.outputs.map((o) => o.type);
        ok('las salidas se calculan (ya no se declaran retenidas)', all200(rs) && !('withheld' in rs[0].json) && rs[0].json.data_state === 'ok' && JSON.stringify(types) === JSON.stringify(rs[1].json.outputs.map((o) => o.type)), st(rs));
        ok('mensaje a la familia con la actividad del curso', types.includes('family'));
        const rec = rs[0].json.outputs.find((o) => o.type === 'recommendation');
        ok('recomendación basada en el apoyo del curso («inferential»), no en el global', !!rec && rec.context.basedOnSupportType === 'inferential' && !/vocabulary/.test(JSON.stringify(rec.context)));
        ok('invitación a producir: sale de la reflexión registrada en el curso', (await both(ACT('ra-2'), C['med-a'])).every((r) => r.json.outputs.some((o) => o.type === 'production')));
        const none = await both(ACT('ra-6'), C['med-a']);
        ok('sin actividad del curso: ninguna salida y el estado lo dice', none.every((r) => r.status === 200 && r.json.outputs.length === 0 && r.json.data_state === 'no_activity'), st(none));
        const self = await get(S1, ACT('ra-1'), C['ra-1']);
        ok('el propio lector conserva sus salidas completas (perfil global)', self.status === 200 && !('data_state' in self.json) && self.json.outputs.some((o) => o.type === 'recommendation' && o.context.basedOnSupportType === 'vocabulary'), self.text.slice(0, 300));
    }

    section('[4] impacto individual contextual');
    {
        const rs = await both(IMP('ra-3'), C['med-a']);
        const j = rs[0].json, row = j.outcomes?.find((o) => o.intervention_id === 'iv-ra3');
        ok('200 con las intervenciones del curso, sin la del mediador de otra institución ni el impacto global', all200(rs) && clean(rs) && j.outcomes.length === 2 && !!row && j.outcomes.every((o) => o.teacher_id === 'med-a'), st(rs));
        ok('ventanas de 14 días antes y después, con actividad del curso en ambas', row.baseline_window_end === row.followup_window_start && row.baseline_metrics.eventsCount >= 3 && row.followup_metrics.eventsCount >= 3
            && row.baseline_window_end - row.baseline_window_start === 14 * DAY, JSON.stringify(row).slice(0, 400));
        ok('clasificada con el algoritmo vigente: el abandono del curso bajó', ['improved', 'mixed'].includes(row.outcome_label) && row.baseline_metrics.abandono > row.followup_metrics.abandono && row.data_state === 'ok', `${row.outcome_label} ${JSON.stringify([row.baseline_metrics.abandono, row.followup_metrics.abandono])}`);
        ok('los abandonos PERSONALES de la ventana posterior no cuentan', row.followup_metrics.diversidad === 1 && row.followup_metrics.abandono === 0);
        const before = JSON.stringify(j.outcomes);
        for (const d of [14, 13, 11, 9]) abandonsOn('ra-3', 'c3', d);
        const LG = (r) => r.json.outcomes.find((o) => o.intervention_type === 'lectura_guiada');
        ok('más abandonos personales: el impacto no cambia', JSON.stringify((await get(S2, IMP('ra-3'), C['med-a'])).json.outcomes) === before);
        const r5 = await both(IMP('ra-5'), C['med-a']);
        ok('datos insuficientes: ni «mejoró» ni «empeoró»', r5.every((r) => r.status === 200 && LG(r).data_state === 'insufficient' && LG(r).outcome_label === 'insufficient_data'
            && r.json.distribution.improved === 0 && r.json.distribution.worsened === 0), st(r5));
        const r7 = await both(IMP('ra-7'), C['med-a']);
        ok('ventana posterior abierta: pendiente, sin comparación', r7.every((r) => r.status === 200 && r.json.pending === 1 && LG(r).data_state === 'pending' && LG(r).outcome_label === null && LG(r).baseline_metrics === null), st(r7));
        const prof = await both(`${AV}/institutional/profile/ra-3`, C['med-a']);
        ok('el perfil institucional incluye el historial de impacto contextual', prof.every((r) => r.status === 200 && r.json.impact_history?.outcomes?.[0]?.intervention_id === 'iv-ra3' && !('withheld' in r.json)) && clean(prof), st(prof));
        ok('la administración conserva el impacto GLOBAL', (await both(IMP('ra-3'), C.adm)).every((r) => r.status === 200 && /marca-ra-3/.test(r.text)));
    }

    section('[5] impacto grupal sin lectores no elegibles');
    {
        const rs = await both(GIMP('g-a'), C['med-a']);
        const j = rs[0].json;
        ok('200, sin el almacén global y con la población explicada (nómina 8, con seguimiento 7)', all200(rs) && clean(rs) && j.population.roster === 8 && j.population.eligible === 7, st(rs));
        const lg = j.outcomes.filter((o) => o.intervention_type === 'lectura_guiada');
        ok('solo intervenciones de lectores con seguimiento habilitado (sin la del lector sin A2)', lg.map((o) => o.intervention_id).sort().join() === 'iv-ra3,iv-ra5,iv-ra7' && j.outcomes.length === 8 && !/ra-noa2/.test(rs[0].text));
        ok('distribución contada sobre comparaciones hechas; la pendiente va aparte', j.pending === 1 && j.total_outcomes === 7 && Object.values(j.distribution).reduce((a, b) => a + b, 0) === 7
            && lg.filter((o) => ['improved', 'mixed'].includes(o.outcome_label)).length === 1 && lg.filter((o) => o.outcome_label === 'insufficient_data').length === 1, JSON.stringify([j.distribution, j.pending]));
        ok('otra institución: denegado', (await both(GIMP('g-a'), C['med-b'])).every((r) => r.status === 403));
        ok('mediador del curso sin C005: sin lectores habilitados, ninguna fila', (await both(GIMP('g-a'), C['med-noc'])).every((r) => r.status === 200 && r.json.outcomes.length === 0 && r.json.population.eligible === 0));
    }

    section('[6] agregados y cohortes sin contaminación · [7] umbral de divulgación');
    let agg;
    {
        const rs = await both(COH('g-a'), C['med-a']);
        agg = rs[0].json;
        ok('comparativa del curso: 200, igual en las dos réplicas, sin los valores del almacén global', all200(rs) && clean(rs) && JSON.stringify(rs[0].json) === JSON.stringify(rs[1].json) && agg.suppressed === false, st(rs));
        ok('nómina total y población con seguimiento, por separado', metricOf(agg, 'reader_cohort') === 8 && metricOf(agg, 'eligible_readers') === 7 && agg.population.roster === 8 && agg.population.eligible === 7);
        ok('activos, evaluados y riesgo agregado del CURSO', metricOf(agg, 'active_users') === 5 && metricOf(agg, 'profiles_evaluated') === 5 && agg.by_state.insufficient === 1 && agg.by_state.no_activity === 1, JSON.stringify(agg.metrics));
        ok('promedios y riesgo solo con cinco o más lectores que los sostengan', typeof metricOf(agg, 'avg_continuidad') === 'number' && metricOf(agg, 'at_risk_users') === null, JSON.stringify(agg.metrics));
        for (let i = 0; i < 20; i++) abandonsOn('ra-2', 'c3', 1 + i * 0.4);
        ok('lectura personal adicional de un miembro: el agregado no cambia', JSON.stringify((await get(S2, COH('g-a'), C['med-a'])).json) === JSON.stringify(agg));
        const small = await both(COH('g-a2'), C['med-a2']);
        ok('curso con un solo lector: suprimido (umbral), sin métricas', small.every((r) => r.status === 200 && r.json.suppressed === true && r.json.reason === 'min_eligible_readers' && r.json.metrics.length === 0 && r.json.minCohort === 5), st(small));
        const roll = await both(ROLL('g-a'), C['med-a']);
        ok('serie semanal del curso (cortes fijos), sin filas por lector', all200(roll) && clean(roll) && roll[0].json.weekly.length >= 3 && roll[0].json.weekly.every((w) => w.scope_id === 'g-a' && !('user_id' in w))
            && JSON.stringify(roll[0].json) === JSON.stringify(roll[1].json), st(roll));
        const mem = await both(`${AV}/institutional/cohorts/coh-risk/members`, C['med-a']);
        ok('cohorte de riesgo: los lectores con ese riesgo activo EN EL CURSO (ra-2 y ra-7), no los del almacén global', mem.every((r) => r.status === 200 && r.json.context === true
            && r.json.members.map((m) => m.user_id).sort().join() === 'ra-2,ra-7' && !/ra-noa2|ra-1"/.test(r.text)), st(mem));
        ok('la administración conserva el agregado y la cohorte globales', (await both(COH('g-a'), C.adm)).every((r) => r.status === 200 && /999/.test(r.text))
            && (await both(`${AV}/institutional/cohorts/coh-risk/members`, C.adm)).every((r) => r.json.members_count === 8));
        ok('otra institución: agregado del curso denegado', (await both(COH('g-a'), C['med-b'])).every((r) => r.status === 403));
    }

    section('[5b] la pestaña Institucional del mediador: totales, aprendizajes y comparativa de SUS cursos');
    {
        const I = `${AV}/institutional`;
        const s = await both(`${I}/status`, C['med-a']), l = await both(`${I}/learnings/global`, C['med-a']), c = await both(`${I}/comparative/strategies`, C['med-a']);
        ok('totales del contexto: 7 comparaciones y 1 pendiente (el almacén global tiene 4 «worsened»)', s.every((r) => r.status === 200 && r.json.context === true && r.json.outcomes.total === 7 && r.json.outcomes.pending === 1
            && r.json.population.eligible === 7 && !('worsened' in r.json.outcomes.by_label && r.json.outcomes.by_label.worsened === 4)), st(s));
        ok('aprendizaje solo con cinco o más casos de la misma estrategia', l.every((r) => r.status === 200 && r.json.length === 1 && r.json[0].evidence.intervention_type === 'acompanamiento' && r.json[0].evidence.support_count === 5
            && typeof r.json[0].recommendation_hint === 'string') && clean(l), st(l));
        ok('comparativa de estrategias de sus cursos', c.every((r) => r.status === 200 && r.json.context === true && r.json.strategies.map((x) => `${x.intervention_type}:${x.total}`).sort().join() === 'acompanamiento:5,lectura_guiada:2') && clean(c), st(c));
        ok('la administración conserva los totales GLOBALES', (await both(`${I}/status`, C.adm)).every((r) => r.status === 200 && r.json.outcomes.total === 4 && !('context' in r.json)));
        const sb = await both(`${I}/status`, C['med-b']);
        ok('otra institución: sus propios totales, sin los de este curso', sb.every((r) => r.status === 200 && r.json.outcomes.total === 0 && r.json.population.eligible === 1));
    }

    section('[9] progreso histórico propio conservado');
    {
        const CP = (pct) => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: pct }, viewportHint: pct }, updatedAt: new Date().toISOString() });
        const saved = [];
        for (const [u, c, pct] of [['ra-1', 'c1', 40], ['ra-1', 'c3', 70], ['b2c-1', 'c3', 80]]) saved.push((await post(S1, `/api/progress/${u}/${c}/sync`, C[u], CP(pct))).status);
        const has = (r, c) => (r.json?.progressList || []).some((p) => p.contentId === c);
        ok('el lector conserva su historial completo (curso y compra personal) y la cuenta B2C el suyo', saved.every((x) => x === 200)
            && (await both('/api/progress/user/ra-1', C['ra-1'])).every((r) => r.status === 200 && has(r, 'c1') && has(r, 'c3'))
            && (await both('/api/progress/user/b2c-1', C['b2c-1'])).every((r) => r.status === 200 && has(r, 'c3')), saved.join(' '));
        ok('el mediador no alcanza a la cuenta B2C por Leo ni por impacto', [...await both(LEO('b2c-1'), C['med-a']), ...await both(IMP('b2c-1'), C['med-a'])].every((r) => r.status === 403));
    }

    section('[8] cambios de membresía y asociación');
    {
        // ra-8 entra AHORA al curso; había conversado con Leo sobre c1 ayer y leído por su cuenta.
        const more = JSON.parse(fs.readFileSync(EV, 'utf8'));
        for (const h of [20, 19, 18]) more.entries.push({ ...leoEntries.find((e) => e.userId === 'ra-2'), id: `ev-8-${h}`, userId: 'ra-8', timestamp: iso(NOW - h * 3_600_000) });
        more.entries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
        fs.writeFileSync(EV, JSON.stringify(more));
        read('ra-8', 'c1', 2);
        writeAtomic(P.groups, GROUPS().map((g) => (g.id === 'g-a' ? { ...g, memberIds: [...g.memberIds, 'ra-8'], studentIds: [...g.memberIds, 'ra-8'] } : g)));
        const rs = await both(LEO('ra-8'), C['med-a']);
        ok('conversaciones anteriores al ingreso: no se incorporan (no_activity, sin diagnóstico)', all200(rs) && sum(rs[0]).data_state === 'no_activity' && sum(rs[0]).alerts === null && sum(rs[0]).recentEvidenceSignals.length === 0, st(rs));
        const a2 = (await get(S1, COH('g-a'), C['med-a'])).json;
        ok('el agregado cuenta al nuevo miembro en la población, no su actividad anterior', a2.population.roster === 9 && a2.population.eligible === 8 && metricOf(a2, 'active_users') === metricOf(agg, 'active_users'));
        // Obra compartida: el club (g-a2) y el curso (g-a) tienen cs; cada mediador solo cuenta lo suyo.
        ok('obra compartida: el mediador del club ve su contexto, no el del curso', sum(await get(S1, LEO('ra-1'), C['med-a2'])).context.groups[0].group_id === 'g-a2');
    }

    section('[11] revocación inmediata de A2 / C005');
    {
        Reg.appendDecisions([{ subjectId: 'ra-3', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-3' }]);
        const d = [...await both(LEO('ra-3'), C['med-a']), ...await both(ACT('ra-3'), C['med-a']), ...await both(IMP('ra-3'), C['med-a']), ...await both(`${LEO('ra-3')}/content/c1`, C['med-a'])];
        ok('A2 revocada: Leo, activación e impacto denegados de inmediato en las dos réplicas', d.every(denied), st(d));
        const g = await both(GIMP('g-a'), C['med-a']), c = await both(COH('g-a'), C['med-a']);
        ok('…y el lector sale del impacto y del agregado del curso', g.every((r) => !r.json.outcomes.some((o) => o.user_id === 'ra-3') && r.json.population.eligible === 7) && c.every((r) => r.json.population.eligible === 7), st(g));
        ok('…y de los totales de la pestaña Institucional', (await both(`${AV}/institutional/status`, C['med-a'])).every((r) => r.json.outcomes.total === 5));
        Reg.appendDecisions([{ subjectId: 'med-a2', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-A2' }]);
        ok('C005 revocado: Leo denegado de inmediato', (await both(LEO('ra-1'), C['med-a2'])).every(denied));
        ok('otra institución y mediador sin C005: Leo denegado', [...await both(LEO('ra-1'), C['med-b']), ...await both(LEO('ra-1'), C['med-noc'])].every((r) => r.status === 403 && !MARK.test(r.text)));
    }

    section('[13] nada global se toca');
    {
        ok('los acumuladores de Leo (perfil y memoria) no se modificaron', leoStores() === LEO_BEFORE);
        ok('el impacto guardado y los agregados globales siguen como estaban', odb.prepare(`SELECT COUNT(*) AS n FROM intervention_outcomes`).get().n === 4
            && idb.prepare(`SELECT metric_value FROM cohort_rollups WHERE scope_id = 'g-a' AND metric_key = 'active_users'`).get().metric_value === 999);
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
