/**
 * collectiveContextHttp.test.mjs — CHP V9 F7-C2R-U3D.
 *
 * Analítica colectiva de quien media: cohortes tipadas (riesgo, hábito, trayectoria, modalidad, estrategia) y de
 * nómina, sus trayectorias, los patrones observados y los aprendizajes del curso, calculados con sus lectores
 * elegibles y la actividad fechada del curso. Las tablas guardadas agregan todas las instituciones y llevan marcas
 * que solo pueden salir de ellas: si un mediador las ve, hay fuga.
 *
 * Mismo laboratorio que pedagogicalRecoveryHttp (U3), con más lectores activos para que existan agregados divulgables:
 * dos instituciones con el MISMO tipo de riesgo, un curso sin obras, un lector sin A2 con mucha actividad, dos réplicas
 * de server.js REAL con SESSION_AUTH_MODE=enforce y almacenes compartidos, y una tercera con el registro apagado.
 *   [1] cohortes sin otras instituciones        [8] aprendizajes del curso (recomendación de grupo)
 *   [2] series y trayectorias (cifras)          [9] patrones observados (soporte y confianza)
 *   [3] lectura personal adicional              [10] registro apagado y curso sin obras
 *   [4][5] A2 y revocaciones en sesión          [12] administración, lector y B2C
 *   [6][7] umbral de cinco y no inferencia      [13] las dos réplicas responden igual (en cada bloque)
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/collectiveContextHttp.test.mjs
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
    console.log('collectiveContextHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u3d_'));
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
ev('ra-5', 'c1', 'session_started', at(70));                                 // ra-5: una sola fila
abandonsOn('ra-7', 'c1', 6); abandonsOn('ra-7', 'c1', 5);
read('ra-noa2', 'c1', 5); read('ra-noa2', 'c1', 4);                          // sin A2: jamás entra en agregados
read('ra-z', 'c3', 4); read('rb-1', 'cb', 3);

// U3D: ra-5 y ra-6 también leen y abandonan en el curso (con ra-2, ra-3 y ra-7 son cinco lectores con episodio de riesgo);
// ra-noa2 (sin A2) abandona MUCHO: si entrara en algún agregado, lo movería.
abandonsOn('ra-5', 'c1', 6); abandonsOn('ra-5', 'c1', 5); abandonsOn('ra-6', 'c1', 11); abandonsOn('ra-6', 'c1', 10);
for (const d of [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]) abandonsOn('ra-noa2', 'c1', d);
abandonsOn('rb-1', 'cb', 6); abandonsOn('rb-1', 'cb', 5);                    // otra institución, con el mismo tipo de riesgo
// ── Sesiones heredadas (analytics_db.json): la fuente del ICDLI ──
const legacy = [];
const session = (userId, contentId, startTs, d) => {
    legacy.push({ event: 'session_start', userId, contentId, timestamp: startTs, streak: 0 });
    legacy.push({ event: 'block_complete', userId, contentId, timestamp: startTs + 1000, streak: 1 });
    legacy.push({ event: 'block_complete', userId, contentId, timestamp: startTs + 2000, streak: 2 });
    legacy.push({ event: 'session_end', userId, contentId, timestamp: startTs + d, sessionDuration: d, progressPercentage: 50 });
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

const CO = `${AV}/institutional/cohorts`, PAT = `${AV}/institutional/patterns/recent`, STATUS = `${AV}/institutional/status`;
const MEM = (k) => `${CO}/coh_${k}_v1/members`, TRAJ = (k) => `${CO}/coh_${k}_v1/trajectory`, LEARN = (t, id) => `${AV}/institutional/learnings/scope/${t}/${id}`;
const ids = (r) => (r.json?.members ?? []).map((m) => m.user_id).sort().join();
// Lo que no depende del instante de la consulta (el último punto de una serie se evalúa «ahora»).
const stableSeries = (r) => JSON.stringify((r.json?.series ?? []).map((p) => ({ m: p.metrics, t: p.trend, n: p.sample_size })));
const stablePatterns = (r) => JSON.stringify((r.json?.patterns ?? []).map((p) => ({ ...p, updated_at: 0 })));
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.002;
const OTHERS = /"(rb-1|ra-noa2|ra-z|b2c-1)"/;

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base sembrada', seeded.ok && seeded.baseline);

    section('[1] cohortes contextualizadas, sin otras instituciones');
    {
        const rs = await both(`${CO}/definitions`, C['med-a']);
        const keys = (r) => (r.json ?? []).map((d) => d.cohort_key);
        ok('definiciones 200, iguales en las dos réplicas', all200(rs) && JSON.stringify(rs[0].json) === JSON.stringify(rs[1].json) && clean(rs), st(rs));
        ok('la nómina de SU curso y ninguna de otro curso, club o institución', keys(rs[0]).includes('group:g-a') && !keys(rs[0]).some((k) => /g-a2|g-b|g-z|org-/.test(k)), keys(rs[0]).join());
        ok('las cohortes tipadas que el sistema sabe construir: hábito, trayectoria, modalidad, riesgo y estrategia', ['habit:high_continuity', 'trajectory:recovered_after_risk', 'modality:audio_plus_immersive',
            'risk:abandono_alto', 'intervention:lectura_guiada', 'intervention:acompanamiento'].every((k) => keys(rs[0]).includes(k)), keys(rs[0]).join());
        ok('las definiciones son abstractas: no traen miembros ni recuentos', rs[0].json.every((d) => !('members' in d) && !('members_count' in d)) && !/"ra-\d"/.test(rs[0].text));
        ok('por tipo: solo ese tipo', (await both(`${CO}/by-type/habit`, C['med-a'])).every((r) => r.status === 200 && r.json.length === 1 && r.json[0].cohort_key === 'habit:high_continuity'));
        const risk = await both(MEM('risk:abandono_alto'), C['med-a']), habit = await both(MEM('habit:high_continuity'), C['med-a']),
            rec = await both(MEM('trajectory:recovered_after_risk'), C['med-a']), iv = await both(MEM('intervention:lectura_guiada'), C['med-a']), mod = await both(MEM('modality:audio_plus_immersive'), C['med-a']);
        ok('riesgo activo (abandono alto): los cuatro lectores del curso que lo tienen; ni el de otra institución ni el lector sin A2', risk.every((r) => r.status === 200 && ids(r) === 'ra-2,ra-5,ra-6,ra-7' && !OTHERS.test(r.text)), st(risk));
        ok('hábito (continuidad ≥ 0,7): solo quienes leen el CURSO con continuidad (ra-1 no entra por su lectura personal)', habit.every((r) => r.status === 200 && ids(r) === 'ra-1,ra-3'), st(habit));
        ok('trayectoria (riesgo ya resuelto): ra-3, que abandonaba y volvió a leer, y ra-5, con un episodio antiguo ya cerrado', rec.every((r) => ids(r) === 'ra-3,ra-5'), rec.map(ids).join(' | '));
        ok('estrategia recibida (lectura guiada): los tres lectores con esa intervención de quien media; no la de otro mediador', iv.every((r) => ids(r) === 'ra-3,ra-5,ra-7'), st(iv));
        ok('modalidad (inmersivo + audio): nadie, y se dice con la población (no es un error ni un «sin datos»)', mod.every((r) => r.status === 200 && r.json.members_count === 0 && r.json.population.eligible === 7 && r.json.data_state === 'ok'), st(mod));
        ok('cada respuesta declara su población: 7 lectores con seguimiento de 8 en la nómina', [...risk, ...habit, ...iv].every((r) => r.json.context === true && r.json.population.roster === 8 && r.json.population.eligible === 7));
        const b = await both(MEM('risk:abandono_alto'), C['med-b']);
        ok('el mediador de la otra institución, con la MISMA cohorte tipada, ve solo a su lector', b.every((r) => r.status === 200 && ['', 'rb-1'].includes(ids(r)) && r.json.population.roster === 1 && r.json.population.eligible === 1 && !/"ra-\d"/.test(r.text)), st(b));
        ok('…y no puede abrir la nómina, la trayectoria ni los aprendizajes del curso ajeno', [...await both(MEM('group:g-a'), C['med-b']), ...await both(TRAJ('group:g-a'), C['med-b']), ...await both(LEARN('group', 'g-a'), C['med-b'])].every((r) => r.status === 403 && !/"ra-\d"/.test(r.text)));
        ok('otro mediador de la misma institución tampoco abre este curso', [...await both(MEM('group:g-a'), C['med-a2']), ...await both(TRAJ('group:g-a'), C['med-a2'])].every((r) => r.status === 403));
    }

    section('[2] series y trayectorias');
    let seriesBefore, patternsBefore;
    {
        const rs = await both(TRAJ('group:g-a'), C['med-a']);
        const series = rs[0].json.series, last = series[0];
        seriesBefore = stableSeries(rs[0]);
        ok('trayectoria del curso 200, igual en las dos réplicas', all200(rs) && stableSeries(rs[1]) === seriesBefore && clean(rs), st(rs).slice(0, 300));
        ok('uno o más cortes (según el día en que corra), del más reciente al más antiguo, cada uno con ≥ 5 lectores', series.length >= 1 && series.every((p, i) => p.sample_size >= 5 && (i === 0 || p.period_end < series[i - 1].period_end)), JSON.stringify(series.map((p) => p.sample_size)));
        // Contraste con OTRA ruta: el punto actual es la media de los indicadores individuales de los seis lectores con datos.
        const tl = [];
        for (const u of ['ra-1', 'ra-2', 'ra-3', 'ra-5', 'ra-6', 'ra-7']) tl.push((await get(S1, `${AV}/students/${u}/timeline`, C['med-a'])).json);
        const mean = (f) => tl.map(f).reduce((a, b) => a + b, 0) / tl.length;
        const cont = (j) => j.signals_current.find((s) => s.signal_id === 'continuidad_semanal').metric_value;
        ok('el punto actual promedia a los 6 lectores con indicadores (ra-4, de historia no atribuible, no entra)', last.sample_size === 6 && tl.every((j) => j.data_state === 'ok')
            && near(last.metrics.abandono_risk, mean((j) => j.profile_current.abandono_risk)) && near(last.metrics.engagement_score, mean((j) => j.profile_current.engagement_score))
            && near(last.metrics.continuidad_semanal, mean(cont)), JSON.stringify([last.metrics.abandono_risk, mean((j) => j.profile_current.abandono_risk)]));
        // La regla de varios cortes (media, tendencia ±0,05 y cortes retenidos) se prueba sin fechas en collectiveView.unit.test.mjs.
        const prev = series[1], d = prev ? last.metrics.abandono_risk - prev.metrics.abandono_risk : null;
        ok('la tendencia compara con el corte anterior entregado (umbral del motor ±0,05); el más antiguo no tiene con qué comparar', series.at(-1).trend.abandono_risk === null
            && (!prev || last.trend.abandono_risk === (Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down')), JSON.stringify([last.trend.abandono_risk, d]));
        ok('confianza según el tamaño de la muestra (n/30), sin inflar', near(last.confidence, 6 / 30));
        ok('la respuesta declara población, miembros y estado', rs[0].json.context === true && rs[0].json.population.eligible === 7 && rs[0].json.population.members === 7 && rs[0].json.data_state === 'ok' && rs[0].json.min_cohort === 5);
        const stored = [...await both(`${CO}/coh-risk/trajectory`, C['med-a']), ...await both(`${CO}/coh-risk/members`, C['med-a'])];
        ok('la serie y los miembros GUARDADOS de la cohorte global no se entregan a quien media: el mismo identificador se resuelve en su contexto', !MARK.test(rs[0].text)
            && stored.every((r) => r.status === 200 && r.json.context === true && !MARK.test(r.text) && !OTHERS.test(r.text)) && ids(stored[2]) === 'ra-2,ra-5,ra-6,ra-7' && stored[0].json.series.length === 0);
    }

    section('[6] umbral de cinco en subgrupos · [7] sin inferencia entre vistas');
    {
        const small = [await both(TRAJ('habit:high_continuity'), C['med-a']), await both(TRAJ('risk:abandono_alto'), C['med-a']), await both(TRAJ('trajectory:recovered_after_risk'), C['med-a'])].flat();
        ok('cohortes con menos de 5 lectores: sin serie, y se dice por qué (no una serie vacía muda)', small.every((r) => r.status === 200 && r.json.series.length === 0 && r.json.suppressed === true && r.json.reason === 'min_eligible_readers'
            && r.json.minCohort === 5 && !/"metrics"/.test(r.text)), st(small).slice(0, 300));
        ok('…así que restar una cohorte pequeña de la serie del curso no revela los valores de nadie', small.every((r) => !/abandono_risk|engagement_score/.test(r.text)));
        const allMembers = [];
        for (const d of (await get(S1, `${CO}/definitions`, C['med-a'])).json) allMembers.push(await get(S2, `${CO}/${d.cohort_id}/members`, C['med-a']));
        ok('el lector sin A2 no figura en NINGUNA cohorte ni cuenta en ningún recuento', allMembers.every((r) => r.status === 200 && !/"ra-noa2"/.test(r.text) && r.json.population.eligible <= 7) && allMembers.length >= 8);
    }

    section('[9] patrones observados');
    {
        const rs = await both(PAT, C['med-a']);
        const p = rs[0].json.patterns[0];
        patternsBefore = stablePatterns(rs[0]);
        ok('200, igual en las dos réplicas', all200(rs) && stablePatterns(rs[1]) === patternsBefore && clean(rs), st(rs));
        // Episodios de «abandono alto» en el curso: ra-2, ra-5, ra-6 y ra-7 (activos) y ra-3 (resuelto) ⇒ 5 episodios de 5 lectores.
        ok('un patrón: «abandono alto», soporte 5 (cinco episodios de cinco lectores), confianza 0,5 (tramo 5–19 del motor)', rs[0].json.patterns.length === 1 && p.pattern_key === 'risk:abandono_alto' && p.support_count === 5
            && p.readers === 5 && p.confidence === 0.5 && rs[0].json.min_support === 5 && rs[0].json.min_cohort === 5, JSON.stringify(rs[0].json).slice(0, 400));
        ok('es un recuento de lo observado: no nombra lectores ni predice nada de ninguno', !/"ra-\d"|user_id|probab|predic/i.test(rs[0].text));
        ok('los episodios del lector sin A2 (quince días de abandonos) no entran en el soporte', p.support_count === 5);
        // Que su único lector llegue a tener un episodio contado depende de dónde caen los cortes diarios de la semana en
        // curso (64A: de jueves a sábado no lo hay). Lo que se afirma es que no recibe NINGÚN patrón, ni el de la otra institución.
        const b = await both(PAT, C['med-b']);
        ok('la otra institución, con el mismo tipo de riesgo, no ve este patrón: el suyo no alcanza el soporte y se dice', b.every((r) => r.status === 200 && r.json.patterns.length === 0 && r.json.withheld_below_support <= 1 && r.json.population.eligible === 1
            && r.json.population.roster === 1 && !/ctxpat_|support_count|"ra-\d"/.test(r.text)), st(b));
        const stRs = await both(STATUS, C['med-a']);
        ok('los totales de la pestaña ya no están en cero: cohortes con miembros, trayectorias divulgables y patrones de SUS cursos', stRs.every((r) => r.status === 200 && r.json.context === true && r.json.cohorts.total_active >= 5
            && r.json.trajectories.total >= 1 && r.json.patterns.total_active === 1 && r.json.population.eligible === 7 && !MARK.test(r.text)), st(stRs));
    }

    section('[8] recomendaciones de grupo: aprendizajes del curso');
    {
        const rs = await both(LEARN('group', 'g-a'), C['med-a']);
        const l = rs[0].json[0];
        ok('200, igual en las dos réplicas', all200(rs) && JSON.stringify(rs[0].json) === JSON.stringify(rs[1].json) && clean(rs), st(rs));
        ok('un aprendizaje: «acompanamiento», con 5 intervenciones de soporte (el mínimo) y su indicación observacional', rs[0].json.length === 1 && l.scope_type === 'group' && l.scope_id === 'g-a'
            && l.evidence.intervention_type === 'acompanamiento' && l.evidence.support_count === 5 && l.evidence.min_support_threshold === 5 && /NO implica causalidad/.test(l.recommendation_hint), JSON.stringify(l));
        ok('«lectura_guiada» (3 intervenciones) no genera una recomendación: evidencia insuficiente', !rs[0].json.some((x) => x.evidence.intervention_type === 'lectura_guiada'));
        ok('la distribución es la del impacto contextual del curso, no la guardada', l.evidence.outcome_distribution.worsened === 0 && !MARK.test(rs[0].text));
        ok('un colegio u otro ámbito no se entrega a quien media', (await both(LEARN('school', 'org-a'), C['med-a'])).every((r) => r.status === 403));
        ok('curso sin intervenciones: lista vacía con 200', (await both(LEARN('group', 'g-z'), C['med-z'])).every((r) => r.status === 200 && Array.isArray(r.json) && r.json.length === 0));
    }

    section('[3] lectura personal adicional no altera nada');
    {
        for (const d of [22, 15, 8, 3]) { abandonsOn('ra-1', 'c3', d); abandonsOn('ra-3', 'c3', d); abandonsOn('ra-6', 'c3', d); }
        for (const d of [40, 30, 20, 10]) readAt('ra-2', 'c3', at(d), 55);
        ok('la trayectoria del curso no cambia', (await both(TRAJ('group:g-a'), C['med-a'])).every((r) => stableSeries(r) === seriesBefore));
        ok('los patrones no cambian', (await both(PAT, C['med-a'])).every((r) => stablePatterns(r) === patternsBefore));
        ok('las cohortes no cambian (ra-1 no entra en «riesgo» por sus abandonos personales)', (await both(MEM('risk:abandono_alto'), C['med-a'])).every((r) => ids(r) === 'ra-2,ra-5,ra-6,ra-7')
            && (await both(MEM('habit:high_continuity'), C['med-a'])).every((r) => ids(r) === 'ra-1,ra-3'));
    }

    section('[10] motor apagado y falta de datos');
    {
        const offC = await login(S3, 'med-a');
        const t = await get(S3, TRAJ('group:g-a'), offC), p = await get(S3, PAT, offC), m = await get(S3, MEM('risk:abandono_alto'), offC), s = await get(S3, STATUS, offC);
        ok('registro contextual apagado: sin serie, sin patrones y sin miembros de riesgo, con el motivo declarado', t.status === 200 && t.json.series.length === 0 && t.json.reason !== undefined
            && p.status === 200 && p.json.patterns.length === 0 && p.json.data_state === 'insufficient' && p.json.reason === 'provenance_not_recorded'
            && m.status === 200 && m.json.members_count === 0 && m.json.reason === 'provenance_not_recorded' && s.json.reason === 'provenance_not_recorded', `${t.text.slice(0, 200)} | ${p.text.slice(0, 200)}`);
        const z = await both(PAT, C['med-z']), zt = await both(TRAJ('group:g-z'), C['med-z']);
        ok('curso sin obras: se declara «no_course_works», sin patrones ni serie', z.every((r) => r.status === 200 && r.json.data_state === 'no_course_works' && r.json.patterns.length === 0)
            && zt.every((r) => r.status === 200 && r.json.series.length === 0 && r.json.data_state === 'no_course_works'), st(z));
    }

    section('[12] administración, lector y B2C');
    {
        const adm = [...await both(`${CO}/definitions`, C.adm), ...await both(PAT, C.adm), ...await both(`${CO}/coh-risk/trajectory`, C.adm), ...await both(`${CO}/coh-risk/members`, C.adm)];
        ok('la administración conserva la vista global guardada (definiciones, patrones, trayectoria y miembros)', adm.every((r) => r.status === 200) && Array.isArray(adm[0].json) && adm[0].json.some((d) => d.cohort_id === 'coh-risk')
            && Array.isArray(adm[2].json) && adm[6].json.members_count === 8, adm.map((r) => r.status).join(' '));
        const denied3 = async (cookie) => { const out = []; for (const p of [`${CO}/definitions`, MEM('group:g-a'), MEM('risk:abandono_alto'), TRAJ('group:g-a'), PAT, LEARN('group', 'g-a'), STATUS]) out.push(...await both(p, cookie)); return out.every((r) => (r.status === 403 || r.status === 404) && !/"ra-\d"|metrics/.test(r.text)); };
        ok('un lector institucional no recibe nada colectivo', await denied3(C['ra-1']));
        ok('una cuenta B2C tampoco', await denied3(C['b2c-1']));
        ok('mediador sin C005: sin lectores elegibles, sin serie, sin patrones, sin miembros', [...await both(TRAJ('group:g-a'), C['med-noc']), ...await both(PAT, C['med-noc']), ...await both(MEM('group:g-a'), C['med-noc'])]
            .every((r) => r.status === 200 && r.json.population.eligible === 0 && !/"ra-\d"|"metrics"/.test(r.text)));
    }

    section('[4][5] exclusión por A2 y revocaciones en sesión');
    {
        Reg.appendDecisions([{ subjectId: 'ra-7', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-U3D-7' }]);
        const m = await both(MEM('risk:abandono_alto'), C['med-a']), t = await both(TRAJ('group:g-a'), C['med-a']), p = await both(PAT, C['med-a']);
        ok('A2 revocada: el lector sale de inmediato de las cohortes, en las dos réplicas', m.every((r) => ids(r) === 'ra-2,ra-5,ra-6' && r.json.population.eligible === 6));
        ok('…de la trayectoria (cinco lectores con indicadores)', t.every((r) => r.status === 200 && r.json.series[0].sample_size === 5 && r.json.population.members === 6));
        ok('…y del soporte de los patrones (4 episodios: el patrón ya no se entrega)', p.every((r) => r.json.patterns.length === 0 && r.json.withheld_below_support >= 1), JSON.stringify(p[0].json).slice(0, 500));
        Reg.appendDecisions([{ subjectId: 'ra-6', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-U3D-6' }]);
        const t2 = await both(TRAJ('group:g-a'), C['med-a']);
        ok('con cuatro lectores con indicadores ningún punto alcanza el umbral: la serie queda vacía y se cuenta lo retenido', t2.every((r) => r.status === 200 && r.json.series.length === 0 && r.json.suppressed_points >= 1 && !/"metrics":\{"/.test(r.text)), st(t2).slice(0, 300));
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-U3D' }]);
        const after = [...await both(MEM('group:g-a'), C['med-a']), ...await both(TRAJ('group:g-a'), C['med-a']), ...await both(PAT, C['med-a']), ...await both(LEARN('group', 'g-a'), C['med-a'])];
        ok('C005 revocado: de inmediato sin miembros, serie, patrones ni aprendizajes; ningún lector nombrado', after.every((r) => r.status === 200 && !/"ra-\d"|"metrics":\{"/.test(r.text))
            && after.slice(0, 6).every((r) => r.json.population.eligible === 0) && after.slice(6).every((r) => Array.isArray(r.json) && r.json.length === 0), after.map((r) => `${r.status}:${r.text.slice(0, 80)}`).join(' | '));
    }

    ok('nada global se tocó: cohortes, trayectorias y patrones guardados siguen como estaban', odb.prepare('SELECT COUNT(*) AS n FROM cohort_memberships').get().n === 8
        && odb.prepare('SELECT COUNT(*) AS n FROM cohort_definitions').get().n === 1 && leoStores() === LEO_BEFORE);
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
