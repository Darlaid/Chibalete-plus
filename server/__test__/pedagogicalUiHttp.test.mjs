/**
 * pedagogicalUiHttp.test.mjs — CHP V9 F7-C2R-U3C.
 *
 * Contrato de datos de las dos interfaces recuperadas para quien media: el panel «Leo: lectura pedagógica» y el panel
 * de impacto de intervenciones (individual y de curso). Comprueba lo que la pantalla muestra, con CIFRAS calculadas a
 * mano desde los eventos sembrados, no solo que las rutas respondan.
 *
 * Mismo laboratorio que pedagogicalRecoveryHttp (U3): dos instituciones y una tercera con un curso sin obras, dos
 * réplicas de server.js REAL con SESSION_AUTH_MODE=enforce y almacenes compartidos, y una tercera con el registro de
 * procedencia apagado.
 *   [1] Leo: perfil, ICDLI, fortalezas, alertas, acción, continuidad, activación   [5] intervención anotada en el tablero
 *   [2] estados: no atribuible, sin actividad, curso sin obras, registro apagado   [6] lectura personal adicional
 *   [3] impacto individual: calculado (cifras), pendiente, insuficiente            [7] audiencia sin ampliar
 *   [4] impacto del curso: población y resultados por estrategia                   [8] revocación A2 / C005 en sesión
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/pedagogicalUiHttp.test.mjs
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
    console.log('pedagogicalUiHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u3c_'));
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

const HIST = (u, c) => `/api/leo/mediator/student/${u}/content/${c}`;
const rowOf = (r, id) => (r.json?.outcomes ?? []).find((o) => o.intervention_id === id);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.002;
const strategy = (r, t) => (r.json?.by_type ?? []).find((x) => x.intervention_type === t);

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base sembrada', seeded.ok && seeded.baseline);

    section('[1] Leo del mediador: lo que muestra el panel');
    {
        const rs = await both(LEO('ra-1'), C['med-a']);
        const s = sum(rs[0]);
        ok('resumen 200 e igual en las dos réplicas', all200(rs) && stableSum(sum(rs[0])) === stableSum(sum(rs[1])) && clean(rs), st(rs));
        ok('suficiencia de evidencia declarada: 4 interacciones del curso y sus sesiones de lectura, con fechas', s.data_state === 'ok' && s.provenance.evidence === 4 && s.provenance.reading_sessions >= 1
            && typeof s.provenance.first_ts === 'string' && typeof s.provenance.last_ts === 'string', JSON.stringify(s.provenance));
        ok('perfil e ICDLI: nivel e índice, fortalezas y alertas como textos', s.icdliHasData === true && typeof s.icdliLevel === 'string' && Number.isFinite(s.icdliComposite)
            && Array.isArray(s.icdliDominantStrengths) && Array.isArray(s.icdliDominantAlerts) && Array.isArray(s.alerts) && [...s.icdliDominantStrengths, ...s.icdliDominantAlerts, ...s.alerts].every((x) => typeof x === 'string'));
        ok('objetivo dominante, tipo de apoyo y acción sugerida: inferencia (la del curso), no el vocabulario de su lectura personal', s.dominantPedagogicalObjective === 'inferential' && s.preferredSupportType === 'inferential'
            && typeof s.suggestedMediatorAction === 'string' && s.suggestedMediatorAction.length > 10);
        ok('continuidad: 4 interacciones, todas de la obra del curso; nada de la compra personal', s.totalInteractions === 4 && s.recentEvidenceSignals.length === 4 && s.recentEvidenceSignals.every((e) => e.contentId === 'c1') && !/"c3"/.test(rs[0].text));
        const h = await both(HIST('ra-1', 'c1'), C['med-a']);
        ok('detalle por obra: 4 interacciones, etapa, dificultad y qué trabajó', h.every((r) => r.status === 200 && r.json.history.interactionCount === 4 && r.json.history.objectiveDistribution.inferential === 4
            && typeof r.json.history.pedagogicalStage === 'string' && typeof r.json.history.difficultyLevel === 'string'), st(h));
        ok('detalle de la obra personal: denegado', (await both(HIST('ra-1', 'c3'), C['med-a'])).every(denied));
        const a = await both(ACT('ra-1'), C['med-a']);
        ok('activación: mensaje para la familia y continuidad, cada uno con tipo y texto; nada de la obra personal', a.every((r) => r.status === 200 && r.json.data_state === 'ok' && r.json.outputs.length >= 1
            && r.json.outputs.some((o) => o.type === 'family') && r.json.outputs.every((o) => typeof o.type === 'string' && typeof o.message === 'string' && o.message.length > 5 && o.contentId !== 'c3')), st(a));
    }

    section('[2] estados que el panel explica (nunca ceros)');
    {
        const unv = await both(LEO('ra-4'), C['med-a']), none = await both(LEO('ra-6'), C['med-a']), now = await both(LEO('ra-z'), C['med-z']);
        ok('lectura histórica no atribuible: «insufficient / unverifiable_history», sin perfil ni acción', unv.every((r) => r.status === 200 && sum(r).data_state === 'insufficient' && sum(r).reason === 'unverifiable_history'
            && sum(r).icdliHasData === false && sum(r).suggestedMediatorAction === null && sum(r).totalInteractions === null), st(unv));
        ok('sin actividad: «no_activity», sin perfil ni acción', none.every((r) => r.status === 200 && sum(r).data_state === 'no_activity' && sum(r).suggestedMediatorAction === null && sum(r).totalInteractions === null), st(none));
        ok('curso sin obras: «no_course_works»', now.every((r) => r.status === 200 && sum(r).data_state === 'no_course_works' && !/"c3"/.test(r.text)), st(now));
        const off = await get(S3, LEO('ra-1'), await login(S3, 'med-a')), offAct = await get(S3, ACT('ra-1'), await login(S3, 'med-a'));
        ok('registro contextual apagado: «insufficient / provenance_not_recorded», sin salidas de activación', off.status === 200 && sum(off).data_state === 'insufficient' && sum(off).reason === 'provenance_not_recorded'
            && offAct.status === 200 && offAct.json.outputs.length === 0 && offAct.json.reason === 'provenance_not_recorded', off.text.slice(0, 200));
    }

    section('[3] impacto individual: cifras contra los eventos sembrados');
    let before3;
    {
        // ra-3, intervención «lectura_guiada» hace 20 días. Ventana anterior (días 34–20): solo los abandonos de los días 30 y 29
        // (3 inicios + 3 abandonos tempranos cada día) ⇒ 2 días con actividad, 6 inicios, 6 abandonos, 0 minutos, 0 lecturas terminadas.
        // Ventana posterior (días 20–6): ocho lecturas de 10 minutos, días 14 a 7 ⇒ 8 días, 16 inicios (sesión + lectura), 8 terminadas, 80 minutos.
        // Sus abandonos de la obra personal c3 (días 16, 15, 12, 10) caen en la ventana posterior y NO cuentan.
        const rs = await both(IMP('ra-3'), C['med-a']);
        const o = rowOf(rs[0], 'iv-ra3');
        before3 = JSON.stringify(o);
        ok('impacto 200, igual en las dos réplicas, sin el resultado global guardado («worsened»)', all200(rs) && JSON.stringify(rowOf(rs[1], 'iv-ra3')) === before3 && clean(rs) && !/worsened":[1-9]/.test(rs[0].text), st(rs));
        ok('antes: continuidad 2/7, abandono 6/12, 0 minutos, completitud 0/6', near(o.baseline_metrics.continuidad, 2 / 7) && near(o.baseline_metrics.abandono, 0.5) && o.baseline_metrics.tiempo_efectivo === 0
            && near(o.baseline_metrics.completitud, 0) && o.baseline_metrics.eventsCount === 12, JSON.stringify(o.baseline_metrics));
        ok('después: continuidad 1 (8 días, tope 7/7), abandono 0, 80 minutos, completitud 8/16', near(o.followup_metrics.continuidad, 1) && near(o.followup_metrics.abandono, 0) && o.followup_metrics.tiempo_efectivo === 80
            && near(o.followup_metrics.completitud, 0.5) && o.followup_metrics.eventsCount === 32, JSON.stringify(o.followup_metrics));
        ok('resultado calculado: «improved», con sus ventanas de 14 días', o.data_state === 'ok' && o.outcome_label === 'improved' && o.baseline_window_end === o.created_at
            && o.baseline_window_end - o.baseline_window_start === 14 * DAY && o.followup_window_end - o.followup_window_start === 14 * DAY);
        ok('la intervención de un mediador de otra institución sobre el mismo lector no aparece', !rowOf(rs[0], 'iv-ra3-b'));
        const p = await both(IMP('ra-7'), C['med-a']), i = await both(IMP('ra-5'), C['med-a']);
        const pend = rowOf(p[0], 'iv-ra7'), ins = rowOf(i[0], 'iv-ra5');
        ok('pendiente: sin etiqueta ni cifras, con la fecha en que cierra la ventana (intervención + 14 días)', pend.data_state === 'pending' && pend.outcome_label === null && pend.baseline_metrics === null && pend.followup_metrics === null
            && pend.delta_metrics === null && pend.followup_due_at === pend.created_at + 14 * DAY && p[0].json.pending === 1, JSON.stringify(pend));
        ok('evidencia insuficiente: ni mejoría ni deterioro', ins.data_state === 'insufficient' && ins.outcome_label === 'insufficient_data' && i[0].json.distribution.improved === 0 && i[0].json.distribution.worsened === 0, JSON.stringify(ins).slice(0, 300));
    }

    section('[4] impacto agregado del curso: población y resultados por estrategia');
    let groupTotal;
    {
        const rs = await both(GIMP('g-a'), C['med-a']);
        const j = rs[0].json;
        groupTotal = j.outcomes.length;
        ok('200 e igual en las dos réplicas; población: 7 lectores con seguimiento de 8 en la nómina (el lector sin A2 no entra)', all200(rs) && JSON.stringify(rs[1].json.by_type) === JSON.stringify(j.by_type)
            && j.population.roster === 8 && j.population.eligible === 7 && !j.outcomes.some((o) => o.user_id === 'ra-noa2'), JSON.stringify(j.population));
        const lg = strategy(rs[0], 'lectura_guiada'), ac = strategy(rs[0], 'acompanamiento');
        ok('«lectura_guiada»: 3 registradas = 1 calculada (mejoró) + 1 en seguimiento + 1 insuficiente; sin evidencia suficiente para afirmar nada de la estrategia', lg.total === 3 && lg.evaluated === 1 && lg.improved === 1
            && lg.pending === 1 && lg.insufficient === 1 && lg.sufficient === false && j.min_support === 5, JSON.stringify(lg));
        ok('«acompanamiento»: 5 registradas; las cuentas cierran (calculadas + seguimiento + insuficientes = registradas)', ac.total === 5 && ac.evaluated + ac.pending + ac.insufficient === 5 && ac.evaluated === ac.improved + ac.stable + ac.worsened + ac.mixed, JSON.stringify(ac));
        ok('totales coherentes con las filas', j.pending === j.outcomes.filter((o) => o.data_state === 'pending').length && j.total_outcomes === j.outcomes.length - j.pending
            && j.by_type.reduce((n, t) => n + t.total, 0) === j.outcomes.length);
        ok('el mediador de otro curso de la misma institución no ve este curso', (await both(GIMP('g-a'), C['med-a2'])).every((r) => r.status === 403));
    }

    section('[5] intervención anotada desde el tablero del curso');
    {
        const made = await post(S1, '/api/interventions', C['med-a'], { studentId: 'ra-2', courseId: 'g-a', type: 'conversacion', note: 'nota sintética' });
        const madeId = (() => { try { return JSON.parse(made.text).intervention.id; } catch { return null; } })();
        ok('se registra (201)', made.status === 201 && typeof madeId === 'string', `${made.status} ${made.text.slice(0, 200)}`);
        const id = `dash_${madeId}`;
        const rs = await both(IMP('ra-2'), C['med-a']);
        const o = rowOf(rs[0], id);
        ok('aparece en el impacto del lector, en las dos réplicas, como «en seguimiento» (recién registrada), sin la nota', rs.every((r) => r.status === 200 && rowOf(r, id)) && o.data_state === 'pending' && o.intervention_type === 'conversacion'
            && o.followup_due_at === o.created_at + 14 * DAY && !/nota sintética/.test(rs[0].text), st(rs).slice(0, 300));
        const g = await both(GIMP('g-a'), C['med-a']);
        ok('…y en el impacto del curso (una intervención más, una estrategia más)', g.every((r) => r.json.outcomes.length === groupTotal + 1 && strategy(r, 'conversacion')?.pending === 1));
        const no = await post(S2, '/api/interventions', C['med-b'], { studentId: 'ra-2', courseId: 'g-a', type: 'conversacion', note: 'x' });
        ok('un mediador de otra institución no puede anotarla', no.status === 403, String(no.status));
    }

    section('[6] lectura personal adicional no altera el impacto');
    {
        for (const d of [18, 13, 9]) abandonsOn('ra-3', 'c3', d);
        for (const d of [33, 25]) readAt('ra-3', 'c3', at(d), 45);
        const rs = await both(IMP('ra-3'), C['med-a']);
        ok('las cifras de la intervención no cambian con más actividad personal (B2C) antes y después', rs.every((r) => JSON.stringify(rowOf(r, 'iv-ra3')) === before3), JSON.stringify(rowOf(rs[0], 'iv-ra3')).slice(0, 300));
        ok('…ni el resumen de Leo de otro lector con compra personal', (await both(LEO('ra-1'), C['med-a'])).every((r) => sum(r).totalInteractions === 4 && !/"c3"/.test(r.text)));
    }

    section('[7] audiencia: sin ampliar');
    {
        ok('otra institución: Leo, activación e impacto denegados', [...await both(LEO('ra-3'), C['med-b']), ...await both(ACT('ra-3'), C['med-b']), ...await both(IMP('ra-3'), C['med-b']), ...await both(GIMP('g-a'), C['med-b'])].every((r) => r.status === 403 && !MARK.test(r.text)));
        ok('mediador sin C005: denegado', [...await both(LEO('ra-3'), C['med-noc']), ...await both(IMP('ra-3'), C['med-noc'])].every((r) => r.status === 403));
        ok('cuenta B2C: ningún mediador la consulta', [...await both(LEO('b2c-1'), C['med-a']), ...await both(IMP('b2c-1'), C['med-a'])].every((r) => r.status === 403 || r.status === 404));
        ok('un lector no abre la vista de mediación de otro lector ni la suya', [...await both(LEO('ra-3'), C['ra-1']), ...await both(LEO('ra-1'), C['ra-1'])].every((r) => r.status === 403));
        ok('el lector conserva su propia activación', (await both(ACT('ra-1'), C['ra-1'])).every((r) => r.status === 200 && Array.isArray(r.json.outputs)));
    }

    section('[8] revocación durante la sesión');
    {
        Reg.appendDecisions([{ subjectId: 'ra-3', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-U3C' }]);
        ok('A2 revocada: Leo, activación e impacto del lector denegados de inmediato en las dos réplicas', [...await both(LEO('ra-3'), C['med-a']), ...await both(ACT('ra-3'), C['med-a']), ...await both(IMP('ra-3'), C['med-a'])].every((r) => r.status === 403 && !/improved|baseline_metrics/.test(r.text)));
        const g = await both(GIMP('g-a'), C['med-a']);
        ok('…y sale del impacto del curso (6 lectores evaluados; ninguna fila suya)', g.every((r) => r.status === 200 && r.json.population.eligible === 6 && !r.json.outcomes.some((o) => o.user_id === 'ra-3')), JSON.stringify(g[0].json?.population));
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-U3C' }]);
        ok('C005 revocado: Leo, activación e impacto individual denegados de inmediato', [...await both(LEO('ra-1'), C['med-a']), ...await both(ACT('ra-1'), C['med-a']), ...await both(IMP('ra-1'), C['med-a'])].every((r) => r.status === 403));
        ok('…y el impacto del curso queda sin lectores evaluados ni filas (0 de 8), sin cifras de nadie', (await both(GIMP('g-a'), C['med-a'])).every((r) => r.status === 200 && r.json.population.eligible === 0
            && r.json.outcomes.length === 0 && r.json.by_type.length === 0));
    }

    ok('los almacenes globales de Leo no se tocaron', leoStores() === LEO_BEFORE);
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
