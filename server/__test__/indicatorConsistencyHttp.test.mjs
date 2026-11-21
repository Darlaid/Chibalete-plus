/**
 * indicatorConsistencyHttp.test.mjs — CHP V9 65B (Bloque I). Coherencia y fiabilidad de indicadores.
 *
 * Un mismo lector y curso aparecen en el tablero del mediador, en Aula Viva (individual y analítica del grupo), en las
 * intervenciones y su impacto, en el informe de curso y en Leo/ICDLI. Aquí la MISMA lectura sintética, de cifras
 * conocidas, entra por las tres vías con las que el cliente real la registra (events.db, eventos heredados y sesiones
 * del progreso) y se comprueba, con números, qué muestra cada superficie.
 *
 * Dos instituciones; un curso de seis lectores elegibles, un club que comparte una obra y un curso de tres lectores;
 * dos réplicas de server.js REAL (SESSION_AUTH_MODE=enforce, cookies de /api/auth/login, almacenes compartidos).
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/indicatorConsistencyHttp.test.mjs
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
    console.log('indicatorConsistencyHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 800)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65b_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.EVENTS_SQLITE_PATH = P.events;
process.env.PROGRESS_SQLITE_PATH = P.progress;
process.env.LEO_EVIDENCE_DB = P.evidence;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const med = (id, org) => acct(id, ['mediador'], { mediatorKind: 'teacher', ...org });
const reader = (id, org) => acct(id, ['lector'], { ...org, lastLoginAt: new Date(Date.now() - 86400000).toISOString() });
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6'], GS = ['rs-1', 'rs-2', 'rs-3'];
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']), med('med-a', A), med('med-a2', A), med('med-b', B),
    ...GA.map((id) => reader(id, A)), reader('ra-noa2', A), ...GS.map((id) => reader(id, A)), reader('rb-1', B), acct('b2c-1', ['lector'], { b2c: true }),
]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = [
    grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a'], [...GA, 'ra-noa2']),
    grp('g-a2', 'Club de lectura', A, 'Colegio Alfa', ['med-a2'], ['ra-1']),
    grp('g-s', 'Taller pequeño', A, 'Colegio Alfa', ['med-a'], [...GS]),            // menos de cinco lectores elegibles
    grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], ['rb-1']),
];
const RULES = [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'cs'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c4', 'cs'], collectionIds: [] },
    { id: 'r-g-s', scope: 'group', scopeId: 'g-s', titleIds: ['c5'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c-ra1', scope: 'user', scopeId: 'ra-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-1' } },
    { id: 'r-b2c-own', scope: 'user', scopeId: 'b2c-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-3' } },
];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['c3', 'Lectura personal comprada'], ['c4', 'Obra del club'], ['c5', 'Obra del taller'], ['cs', 'Obra compartida'], ['cb', 'Obra de la otra institución']]
    .map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const REG = a2RegistryPath();
const Reg = await import('../privacy/a2Registry.mjs');
grantA2([...GA, ...GS, 'rb-1']);
grantC005(['med-a', 'med-a2', 'med-b']);

const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
/** Mediodía UTC de hace `d` días: las cifras no dependen de la hora a la que corre la suite. */
const noon = (d) => Math.floor((NOW - d * DAY) / DAY) * DAY + DAY / 2;

// ── La misma lectura, por las tres vías con las que el cliente real la registra ──
const eventsService = await import('../eventsService.js');
const edb = eventsService.getEventsDb();
let n = 0;
const ins = edb.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
    VALUES (@event_id, 1, @event, 'text', @user_id, @content_id, @session_id, @ts, @ts, @elapsed_ms, NULL, NULL, @ts)`);
const ev = (user_id, content_id, event, ts, elapsed = null) => ins.run({ event_id: `e-${++n}`, event, user_id, content_id, session_id: `s-${user_id}-${content_id}-${ts}`, ts, elapsed_ms: elapsed });
const legacy = [];
const Progress = await import('../progressService.js');
const histories = new Map();
/** Una sesión de lectura de `minutes` minutos. `via`: qué vías la registran (por defecto, las tres). */
const read = (u, c, d, minutes = 10, via = { backbone: true, legacy: true, progress: true }) => {
    const t = noon(d), ms = minutes * MIN;
    if (via.backbone) { ev(u, c, 'session_started', t); ev(u, c, 'reading_started', t + 1000); ev(u, c, 'session_heartbeat', t + ms, ms); ev(u, c, 'reading_completed', t + ms + 1000); }
    if (via.legacy) {
        legacy.push({ event: 'session_start', userId: u, contentId: c, timestamp: t, streak: 0, receivedAt: t + 5000 });
        legacy.push({ event: 'block_complete', userId: u, contentId: c, timestamp: t + 1000, streak: 1, receivedAt: t + 6000 });
        legacy.push({ event: 'session_end', userId: u, contentId: c, timestamp: t + ms, sessionDuration: ms, progressPercentage: 50, receivedAt: t + ms + 5000 });
    }
    if (via.progress) {
        const k = `${u}__${c}`;
        if (!histories.has(k)) histories.set(k, { userId: u, contentId: c, history: [] });
        histories.get(k).history.push({ sessionId: `p-${u}-${c}-${d}`, startedAt: iso(t), mode: 'text', durationSec: minutes * 60 });
    }
};
const ONLY_PROGRESS = { backbone: false, legacy: false, progress: true };

// ra-1 — evidencia suficiente. Intervención del tablero hace 16 días.
//   Curso (c1): antes, 3 sesiones de 10 min = 30 min; después, 6 sesiones de 10 min = 60 min. Obra compartida (cs): 10 min después.
//   Personal (c3): 150 min que NUNCA son del curso.
for (const d of [25, 22, 18]) read('ra-1', 'c1', d);
for (const d of [14, 12, 10, 8, 6, 4]) read('ra-1', 'c1', d);
read('ra-1', 'cs', 7);
for (const d of [20, 9, 2]) read('ra-1', 'c3', d, 50);
// ra-2 — leyó ANTES de la intervención (40 min) y nada después. Su lector no emite eventos heredados (como el EPUB).
for (const d of [25, 20]) read('ra-2', 'c1', d, 20, ONLY_PROGRESS);
// ra-3 — intervención de ayer: aún no evaluable. Lee antes y hoy.
read('ra-3', 'c1', 10); read('ra-3', 'c1', 5);
// ra-4 — su membresía solo consta desde ayer: toda su lectura es históricamente no atribuible.
for (const d of [24, 12, 6]) read('ra-4', 'c1', d);
// ra-5 — intervención hace 20 días y ninguna lectura, ni antes ni después: nada que comparar.
// ra-6 — sin intervención; abandona la obra del curso (dispara una recomendación contextual).
for (const d of [6, 5]) for (const k of [0, 1, 2]) { const t = noon(d) + k * 10 * MIN; ev('ra-6', 'c1', 'reading_started', t); ins.run({ event_id: `e-${++n}`, event: 'reading_abandoned', user_id: 'ra-6', content_id: 'c1', session_id: `s-ra-6-${t}`, ts: t + 30_000, elapsed_ms: null }); }
// ra-noa2 — lee mucho, pero sin A2: jamás entra en nada del mediador.
for (const d of [15, 9, 3]) read('ra-noa2', 'c1', d, 30);
// Taller pequeño (tres lectores) y la otra institución.
for (const u of GS) { read(u, 'c5', 9); read(u, 'c5', 3); }
read('rb-1', 'cb', 5); read('b2c-1', 'c3', 4);

fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(legacy));
const pct = { 'ra-1__c1': 60, 'ra-1__cs': 10, 'ra-1__c3': 90, 'ra-2__c1': 35, 'ra-3__c1': 20, 'ra-4__c1': 45 };
for (const [k, rec] of histories) Progress.upsertProgress({ id: k, userId: rec.userId, contentId: rec.contentId, isCompleted: false, updatedAt: rec.history[rec.history.length - 1].startedAt,
    canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct[k] ?? 25, lastInteractedMode: 'text' }, history: rec.history });

// ── Leo: evidencias fechadas (curso y personal) ──
const leoEntries = [];
let en = 0;
const leo = (userId, contentId, ms, interactionType, pedagogicalObjective) => leoEntries.push({ id: `ev-${++en}`, userId, contentId, surface: 'chat', interactionType, chunkIndex: null, pedagogicalObjective,
    promptType: 'question', pedagogicalStage: 'reflection', difficultyLevel: 'medio', evidenceType: 'autonomous', interpretationHint: `pista-${pedagogicalObjective}`, icdliHasData: false,
    preferredSupportType: null, interactionCountAtEvent: en, sequenceId: null, sequenceStep: null, timestamp: iso(ms) });
for (const d of [12, 10, 8, 6]) leo('ra-1', 'c1', noon(d) + 20 * MIN, 'inferential', 'inferential');
for (let i = 0; i < 12; i++) leo('ra-1', 'c3', noon(9) + (60 + i) * MIN, 'vocab', 'vocabulary');
leoEntries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
fs.writeFileSync(P.evidence, JSON.stringify({ schemaVersion: 1, entries: leoEntries }));
// Cada pregunta a Leo deja además una fila en el registro de interacciones (lo que cuenta el tablero).
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), JSON.stringify(leoEntries.map((e) => ({ userId: e.userId, contentId: e.contentId, timestamp: Date.parse(e.timestamp), interactionType: e.interactionType, surface: 'reader' }))));
fs.writeFileSync(path.join(P.data, 'leo_profile_db.json'), JSON.stringify({ profileMap: {} }));
fs.writeFileSync(path.join(P.data, 'leo_memory_db.json'), JSON.stringify({ memoryMap: {} }));

// ── Procedencia: línea base hace 100 días; la membresía de ra-4 solo consta desde ayer ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const seeded = Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
getInsightsExtDb().prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id = 'ra-4'`).run(NOW - DAY);
for (const rec of histories.values()) seedSessionReceipts(Ledger, rec);

// ── Intervenciones del tablero (interventions_db.json), con la cifra que el cliente guardó al registrarlas ──
// `readingTimeMsAtIntervention` es lo que el tablero mostraba entonces como tiempo de lectura (eventos heredados).
const dash = (id, studentId, daysAgo, snapshotMs, type = 'sesion_acompanada', courseId = 'g-a', mediatorId = 'med-a') => ({ id, mediatorId, studentId, courseId, type, note: 'nota sintética', contentId: 'c1',
    patternsAtIntervention: [], readingTimeMsAtIntervention: snapshotMs, createdAt: iso(noon(daysAgo)) });
const INTERVENTIONS = [
    dash('i-ra1', 'ra-1', 16, 30 * MIN),      // antes 30 min del curso; después 70 min ⇒ creció
    dash('i-ra2', 'ra-2', 16, 0),             // el tablero mostraba 0 (sin eventos heredados); no leyó después ⇒ NO creció
    dash('i-ra3', 'ra-3', 1, 10 * MIN),       // de ayer ⇒ aún no evaluable
    dash('i-ra4', 'ra-4', 16, 20 * MIN),      // lectura no atribuible ⇒ nada que comparar
    dash('i-ra5', 'ra-5', 20, 0),             // sin lectura ⇒ nada que comparar
    dash('i-rs1', 'rs-1', 16, 0, 'sesion_acompanada', 'g-s'),
];
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: INTERVENTIONS }));

const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: '1', AULA_VIVA_CONTEXT_PREVIEW_ENABLED: '1',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`nunca healthy (${last})`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const send = async (s, method, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method, headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body ?? {}) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 380)}`).join(' | ');
const AV = '/api/aula-viva';
const METRICS = (g) => `/api/metrics/course/${g}`, REPORT = (g) => `/api/reports/course/${g}`, SUMMARY = (g) => `/api/groups/${g}/analytics-summary`, STATUS = (u) => `/api/students/${u}/status`,
    IVC = (g) => `/api/interventions/course/${g}`, IVS = (u) => `/api/interventions/student/${u}`, EFF = (g) => `/api/interventions/effectiveness${g ? `?courseId=${g}` : ''}`,
    IMP = (u) => `${AV}/institutional/outcomes/scope/user/${u}`, GIMP = (g) => `${AV}/institutional/outcomes/scope/group/${g}`, LEO = (u) => `/api/leo/mediator/student/${u}`, SM = (u) => `/api/metrics/student/${u}`;
const all200 = (rs) => rs.every((r) => r.status === 200);
const same = (rs, pick = (j) => j) => JSON.stringify(pick(rs[0].json)) === JSON.stringify(pick(rs[1].json));
const breakdown = (j, u) => (j?.studentBreakdown || []).find((s) => s.userId === u);

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-b', 'ra-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base registrada', seeded.ok && seeded.baseline);

    if (process.env.PROBE) {
        const dump = async (label, p, cookie = C['med-a'], pick = (j) => j) => { const r = await get(S1, p, cookie); console.log(`\n### ${label} ${r.status}\n${JSON.stringify(pick(r.json) ?? r.text.slice(0, 300)).slice(0, Number(process.env.PROBE) || 1500)}`); };
        await dump('METRICS g-a summary', METRICS('g-a'), C['med-a'], (j) => ({ summary: j.summary, productMetrics: j.productMetrics, courseAttribution: j.courseAttribution, keys: Object.keys(j) }));
        for (const u of ['ra-1', 'ra-2', 'ra-4']) await dump(`METRICS breakdown ${u}`, METRICS('g-a'), C['med-a'], (j) => breakdown(j, u));
        await dump('REPORT g-a ra-1', REPORT('g-a'), C['med-a'], (j) => ({ b: breakdown(j, 'ra-1'), keys: Object.keys(j) }));
        await dump('SUMMARY g-a', SUMMARY('g-a'), C['med-a'], (j) => ({ ...j, readers: j.readers?.filter((x) => ['ra-1', 'ra-2', 'ra-4'].includes(x.userId)) }));
        await dump('STATUS ra-1', STATUS('ra-1'));
        await dump('SM ra-1', SM('ra-1'));
        await dump('IVC g-a', IVC('g-a'));
        await dump('IVS ra-1', IVS('ra-1'));
        await dump('IVS ra-2', IVS('ra-2'));
        await dump('EFF g-a', EFF('g-a'));
        await dump('IMP ra-1', IMP('ra-1'));
        await dump('GIMP g-a', GIMP('g-a'));
        await dump('LEO ra-1', LEO('ra-1'));
        await dump('TIMELINE ra-1', `${AV}/students/ra-1/timeline`);
        throw new Error('PROBE');
    }

    const TL = (u) => `${AV}/students/${u}/timeline`, RECS = (u) => `${AV}/recommendations/scope/user/${u}`, ACK = (id) => `${AV}/recommendations/${encodeURIComponent(id)}/ack`,
        QUEUE = `${AV}/students-needing-attention`, COH = (g) => `${AV}/cohorts/group/${g}`;
    const iv = (j, id) => (j?.interventions || []).find((x) => x.id === id);
    const signal = (j, id) => (j?.signals_current || []).find((x) => x.signal_id === id);

    section('[1] un lector, un curso, cifras conocidas: 10 sesiones y 100 minutos del curso (más 150 personales que no cuentan)');
    {
        const m = await both(METRICS('g-a'), C['med-a']), rep = await both(REPORT('g-a'), C['med-a']), sum = await both(SUMMARY('g-a'), C['med-a']);
        const tl = await both(TL('ra-1'), C['med-a']), stt = await both(STATUS('ra-1'), C['med-a']), leo = await both(LEO('ra-1'), C['med-a']);
        const b = breakdown(m[0].json, 'ra-1'), rb = breakdown(rep[0].json, 'ra-1'), sr = sum[0].json.readers.find((x) => x.userId === 'ra-1'), L = leo[0].json.summary;
        ok('todas las superficies responden, igual en las dos réplicas', [m, rep, sum, tl, stt, leo].every(all200) && same(m, (j) => j.studentBreakdown) && same(rep, (j) => j.studentBreakdown)
            && same(sum, (j) => j.readers) && same(stt, (j) => j.progress), st(m).slice(0, 200));
        ok('TIEMPO DE LECTURA = 100 min en el tablero, el informe, el resumen del grupo y la señal de Aula Viva', b.totalReadingTimeMs === 100 * MIN && rb.totalReadingTimeMs === 100 * MIN
            && sr.reading.allEffectiveMs === 100 * MIN && signal(tl[0].json, 'tiempo_efectivo_lectura').metric_value === 100, JSON.stringify([b.totalReadingTimeMs, rb.totalReadingTimeMs, sr.reading, signal(tl[0].json, 'tiempo_efectivo_lectura')]));
        ok('SESIONES = 10 en el tablero, el informe, Aula Viva y Leo', b.totalSessions === 10 && rb.totalSessions === 10 && signal(tl[0].json, 'tiempo_efectivo_lectura').meta.sessions === 10 && L.provenance.reading_sessions === 10);
        ok('LIBROS = 2 iniciados, 35 % de media, en el estado individual, el resumen del grupo y el tablero', stt[0].json.progress.booksStarted === 2 && stt[0].json.progress.percentage === 35 && sr.progress.booksStarted === 2
            && sr.progress.averagePercent === 35 && b.contentsInProgress === 2 && b.readingDetails.inProgress.map((x) => x.progressPercentage).sort().join() === '10,60', JSON.stringify([stt[0].json.progress, sr.progress]));
        ok('…y el tiempo por obra del tablero suma el total (90 + 10 min)', b.readingDetails.inProgress.reduce((a, x) => a + x.totalReadingTimeMs, 0) === 100 * MIN);
        ok('ICDLI: el compuesto del tablero y del informe es el de Leo del mediador (misma fórmula, mismas sesiones de Leo)', Math.round(b.composite) === L.icdliComposite && rb.composite === b.composite && L.icdliLevel === b.level
            && L.icdliComposite === 19, JSON.stringify([b.composite, rb.composite, L.icdliComposite, b.level, L.icdliLevel]));
        ok('INTERACCIONES DE LEO = 4 (las del curso) en el tablero, el resumen del grupo y Leo; las 12 personales no cuentan', b.totalLeoInteractions === 4 && sr.leo.interactions === 4 && L.totalInteractions === 4, JSON.stringify([b.totalLeoInteractions, sr.leo, L.totalInteractions]));
        ok('la lectura personal no aparece en ninguna superficie', [m, rep, sum, tl, stt, leo].every((rs) => rs.every((r) => !/"c3"/.test(r.text))));
        const mine = await get(S1, STATUS('ra-1'), C['ra-1']);
        ok('el lector, en cambio, conserva todo lo suyo (3 obras)', mine.status === 200 && mine.json.progress.booksStarted === 3);
    }

    section('[2] intervenciones: la «efectividad» del tablero, verificada con números');
    {
        const ivc = await both(IVC('g-a'), C['med-a']), eff = await both(EFF('g-a'), C['med-a']);
        const E = eff[0].json, T = E.effectivenessByType[0];
        ok('lista y efectividad 200, iguales en las dos réplicas', all200(ivc) && all200(eff) && same(ivc) && same(eff, (j) => ({ ...j, computedAt: 0 })), st(eff).slice(0, 300));
        // ra-1: antes 30 min, total 100 ⇒ ×3,33 ⇒ mejoró. ra-2: antes 40, total 40 ⇒ ×1 ⇒ sin cambio.
        ok('ra-1 (30 min antes, 70 después): mejoró', iv(ivc[0].json, 'i-ra1').impact === 'improved');
        ok('ra-2 (40 min antes, nada después): SIN CAMBIO. Antes salía «mejoró»: se dividía por la cifra 0 que guardó el cliente', iv(ivc[0].json, 'i-ra2').impact === 'unchanged');
        ok('ra-3 (intervención de ayer): PENDIENTE, no «sin cambio» ni «mejoró»', iv(ivc[0].json, 'i-ra3').impact === 'pending');
        ok('ra-4 (lectura no atribuible) y ra-5 (sin lectura): no comparables, sin diagnóstico', iv(ivc[0].json, 'i-ra4').impact === 'insufficient' && iv(ivc[0].json, 'i-ra5').impact === 'insufficient');
        ok('efectividad del curso: 1 de 2 evaluadas = 50 %; 1 pendiente y 2 no comparables aparte (antes: «3 de 5 = 60 %»)', E.totalInterventions === 5 && E.totalImproved === 1 && E.totalEvaluated === 2
            && E.totalPending === 1 && E.totalNotComparable === 2 && E.overallImprovementRate === 0.5, JSON.stringify({ ...E, effectivenessByType: 0, topTypes: 0, coursePedagogicalProfile: 0 }));
        ok('…por estrategia, las mismas cifras', T.total === 5 && T.improved === 1 && T.unchanged === 1 && T.pending === 1 && T.insufficient === 2 && T.evaluated === 2 && T.improvementRate === 0.5, JSON.stringify(T));
        ok('la lista del curso y la efectividad no se contradicen: mismas intervenciones «mejoró»', ivc[0].json.interventions.filter((x) => x.impact === 'improved').length === E.totalImproved
            && ivc[0].json.interventions.filter((x) => x.impact === 'pending').length === E.totalPending);
        const h1 = await both(IVS('ra-1'), C['med-a']), h2 = await both(IVS('ra-2'), C['med-a']), h3 = await both(IVS('ra-3'), C['med-a']);
        ok('historial del lector: la misma evaluación y la razón de crecimiento con una sola fuente (100/30 = 3,33; 40/40 = 1)', all200(h1) && h1[0].json.history[0].impact === 'improved' && h1[0].json.history[0].timeGrowthRatio === 3.33
            && h2[0].json.history[0].impact === 'unchanged' && h2[0].json.history[0].timeGrowthRatio === 1, JSON.stringify([h1[0].json.history[0], h2[0].json.history[0]]).slice(0, 400));
        ok('…y una intervención pendiente no tiene razón de crecimiento', h3[0].json.history[0].impact === 'pending' && h3[0].json.history[0].timeGrowthRatio === null);
        ok('la cifra que guardó el cliente se conserva en el registro, sin usarse en la evaluación', iv(ivc[0].json, 'i-ra2').readingTimeMsAtIntervention === 0 && iv(ivc[0].json, 'i-ra3').readingTimeMsAtIntervention === 10 * MIN);

        // Relación con el impacto contextual de Aula Viva (otro contrato: clasificador sobre ventanas de 14 días de events.db).
        const g = await both(GIMP('g-a'), C['med-a']), i1 = await both(IMP('ra-1'), C['med-a']);
        const row = (id) => g[0].json.outcomes.find((o) => o.intervention_id === `dash_${id}`);
        ok('impacto contextual: las MISMAS cinco intervenciones del tablero', all200(g) && same(g, (j) => j.distribution) && g[0].json.outcomes.length === 5 && ['i-ra1', 'i-ra2', 'i-ra3', 'i-ra4', 'i-ra5'].every((id) => !!row(id)), st(g).slice(0, 200));
        ok('…ra-1 mejoró también allí, con las mismas cifras de tiempo (30 → 70 min)', row('i-ra1').outcome_label === 'improved' && row('i-ra1').baseline_metrics.tiempo_efectivo === 30 && row('i-ra1').followup_metrics.tiempo_efectivo === 70
            && i1[0].json.outcomes[0].outcome_label === 'improved');
        ok('…la de ayer está pendiente en los dos', row('i-ra3').data_state === 'pending' && g[0].json.pending === 1);
        ok('…y ninguno de los dos afirma un resultado donde no hay con qué comparar (ra-4, ra-5)', ['i-ra4', 'i-ra5'].every((id) => !['improved', 'stable', 'worsened', 'mixed'].includes(row(id).outcome_label)));
        ok('diferencia justificada: ra-2 solo tiene sesiones del progreso (su lector no emite telemetría); el tablero la evalúa y Aula Viva declara evidencia insuficiente', row('i-ra2').outcome_label === 'insufficient_data'
            && row('i-ra2').baseline_metrics.eventsCount === 0);
        ok('ningún resultado «mejoró» en una superficie es «empeoró» en la otra', g[0].json.outcomes.every((o) => !(o.outcome_label === 'worsened' && iv(ivc[0].json, o.intervention_id.replace('dash_', ''))?.impact === 'improved')));
    }

    section('[3] curso con menos de cinco lectores elegibles · privacidad y permisos');
    {
        const e = await both(EFF('g-s'), C['med-a']), gi = await both(GIMP('g-s'), C['med-a']), coh = await both(COH('g-s'), C['med-a']);
        ok('taller de tres lectores: su intervención se evalúa (20 min después, nada antes ⇒ mejoró)…', all200(e) && e[0].json.totalInterventions === 1 && e[0].json.totalImproved === 1 && e[0].json.totalEvaluated === 1, st(e).slice(0, 200));
        ok('…pero no se afirma nada de la estrategia (una evaluada, mínimo 5) ni se publican agregados del curso', all200(gi) && gi[0].json.by_type.every((t) => t.sufficient === false) && coh.every((r) => r.status === 200 && r.json.suppressed === true), st(coh).slice(0, 200));
        const all = [await both(METRICS('g-a'), C['med-a']), await both(REPORT('g-a'), C['med-a']), await both(SUMMARY('g-a'), C['med-a']), await both(IVC('g-a'), C['med-a']), await both(GIMP('g-a'), C['med-a'])].flat();
        ok('el lector sin A2 (90 min leídos) no aparece ni cuenta en ninguna superficie', all.every((r) => r.status === 200 && !/ra-noa2/.test(r.text)) && all[0].json.summary.studentCount === 6);
        const foreign = [await both(METRICS('g-a'), C['med-b']), await both(SUMMARY('g-a'), C['med-b']), await both(IVC('g-a'), C['med-b']), await both(EFF('g-a'), C['med-b']), await both(GIMP('g-a'), C['med-b']), await both(LEO('ra-1'), C['med-b']),
            await both(IVC('g-a'), C['med-a2']), await both(EFF('g-a'), C['med-a2'])].flat();
        ok('otra institución y el mediador del club: denegados en el curso', foreign.every((r) => r.status === 403 || r.status === 404), foreign.map((r) => r.status).join());
        const club = await both(EFF(), C['med-a2']);
        ok('el mediador del club no recibe las intervenciones del curso en su agregado', all200(club) && club[0].json.totalInterventions === 0, st(club).slice(0, 200));
    }

    section('[4] dos réplicas: una intervención nueva, una recomendación atendida, la caché y los eventos');
    {
        await both(IVC('g-a'), C['med-a']); await both(EFF('g-a'), C['med-a']);   // las dos réplicas acaban de leer el registro
        const made = await send(S1, 'POST', '/api/interventions', C['med-a'], { studentId: 'ra-6', courseId: 'g-a', type: 'recomendacion_libro', note: 'registrada en la réplica 1', patternsAtIntervention: [], readingTimeMsAtIntervention: 0 });
        const seen = await get(S2, IVC('g-a'), C['med-a']), eff2 = await get(S2, EFF('g-a'), C['med-a']), g2 = await get(S2, GIMP('g-a'), C['med-a']);
        const id = made.json?.intervention?.id;
        ok('intervención registrada en una réplica: la otra la entrega DE INMEDIATO (antes, hasta 30 s después)', made.status === 201 && !!iv(seen.json, id) && iv(seen.json, id).impact === 'pending', `${made.status} ${seen.text.slice(0, 200)}`);
        ok('…y sus cifras dependientes ya la cuentan: 6 intervenciones, 2 pendientes, el porcentaje no cambia', eff2.json.totalInterventions === 6 && eff2.json.totalPending === 2 && eff2.json.totalEvaluated === 2 && eff2.json.overallImprovementRate === 0.5
            && g2.json.outcomes.length === 6 && g2.json.pending === 2, JSON.stringify([eff2.json.totalInterventions, eff2.json.totalPending, g2.json.pending]));
        const again = await both(EFF('g-a'), C['med-a']);
        ok('…las dos réplicas dan lo mismo', same(again, (j) => ({ ...j, computedAt: 0 })));

        const recs = await both(RECS('ra-6'), C['med-a']);
        const rec = (recs[0].json || [])[0];
        ok('recomendación contextual de ra-6 pendiente, igual en las dos réplicas', all200(recs) && !!rec && rec.acknowledged === 0 && same(recs, (j) => j.map((x) => [x.recommendation_id, x.acknowledged])), st(recs).slice(0, 300));
        const q0 = await both(QUEUE, C['med-a']);
        const a = await send(S1, 'POST', ACK(rec.recommendation_id), C['med-a'], {});
        const after = await get(S2, TL('ra-6'), C['med-a']), q1 = await both(QUEUE, C['med-a']);
        ok('marcada como atendida en una réplica: la otra la muestra atendida de inmediato', a.status === 200 && after.json.recommendations.find((x) => x.recommendation_id === rec.recommendation_id)?.acknowledged === 1, `${a.status} ${a.text.slice(0, 200)}`);
        ok('…y lo que depende de ella (la cola de atención) se recalcula igual en las dos', all200(q0) && all200(q1) && JSON.stringify(q1[0].json) === JSON.stringify(q1[1].json)
            && JSON.stringify(q1[0].json) !== JSON.stringify(q0[0].json), JSON.stringify([q0[0].json, q1[0].json]).slice(0, 400));

        // Eventos heredados: una réplica con el archivo en caché no puede reescribirlo sin lo que guardó la otra.
        await get(S2, METRICS('g-a'), C['med-a']);                                 // la réplica 2 lee (y cachea) los eventos
        const t = Date.now();
        const evs = (tag, start) => [{ event: 'session_start', userId: 'ra-1', contentId: 'c1', timestamp: start, streak: 0, eventId: `${tag}-1` },
            { event: 'session_end', userId: 'ra-1', contentId: 'c1', timestamp: start + 60_000, sessionDuration: 60_000, progressPercentage: 61, eventId: `${tag}-2` }];
        const w1 = await send(S1, 'POST', '/api/analytics/events', C['ra-1'], evs('r1', t - 300_000)), w2 = await send(S2, 'POST', '/api/analytics/events', C['ra-1'], evs('r2', t - 120_000));
        const stored = JSON.parse(fs.readFileSync(path.join(P.data, 'analytics_db.json'), 'utf8')).map((e) => e.eventId).filter(Boolean).sort().join();
        ok('eventos guardados por las dos réplicas, una tras otra: no se pierde ninguno', w1.status === 200 && w2.status === 200 && stored === 'r1-1,r1-2,r2-1,r2-2', stored);

        const s1 = await get(S1, SUMMARY('g-a'), C['med-a']), s1b = await get(S1, SUMMARY('g-a'), C['med-a']), s2 = await get(S2, SUMMARY('g-a'), C['med-a']);
        ok('resumen del grupo (caché de 5 min por réplica): declara cuándo se calculó y no lo presenta como nuevo al repetirlo', Number.isFinite(s1.json.computedAt) && s1.json.computedAt <= Date.now()
            && s1b.json.computedAt === s1.json.computedAt && Number.isFinite(s2.json.computedAt), JSON.stringify([s1.json.computedAt, s1b.json.computedAt, s2.json.computedAt]));
    }

    section('[5] revocación A2 / C005: los datos que entrega el servidor cambian de inmediato en las dos réplicas');
    {
        Reg.appendDecisions([{ subjectId: 'ra-1', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-65B' }]);
        const m = await both(METRICS('g-a'), C['med-a']), sum = await both(SUMMARY('g-a'), C['med-a']), ivc = await both(IVC('g-a'), C['med-a']), eff = await both(EFF('g-a'), C['med-a']), g = await both(GIMP('g-a'), C['med-a']);
        ok('A2 de ra-1 revocada: sale del tablero y del resumen (también del resumen en caché), en las dos', all200(m) && all200(sum) && m.every((r) => !breakdown(r.json, 'ra-1') && r.json.summary.studentCount === 5)
            && sum.every((r) => r.json.readerCount === 5 && !r.json.readers.some((x) => x.userId === 'ra-1')), JSON.stringify([m[0].json.summary, sum[0].json.readerCount]));
        ok('…su intervención deja de listarse y de contar: 5 intervenciones, ninguna «mejoró», 1 evaluada', ivc.every((r) => r.status === 200 && !iv(r.json, 'i-ra1')) && eff.every((r) => r.json.totalInterventions === 5 && r.json.totalImproved === 0
            && r.json.totalEvaluated === 1 && r.json.overallImprovementRate === 0) && g.every((r) => !r.json.outcomes.some((o) => o.user_id === 'ra-1')), JSON.stringify([eff[0].json.totalInterventions, eff[0].json.totalImproved, eff[0].json.totalEvaluated]));
        const ind = [await both(IVS('ra-1'), C['med-a']), await both(LEO('ra-1'), C['med-a']), await both(IMP('ra-1'), C['med-a']), await both(TL('ra-1'), C['med-a']), await both(STATUS('ra-1'), C['med-a'])].flat();
        ok('…y todo lo individual queda denegado, sin cifras', ind.every((r) => r.status === 403 && !/composite|totalReadingTimeMs|tiempo_efectivo/.test(r.text)), ind.map((r) => r.status).join());
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-65B' }]);
        const gone = [await both(METRICS('g-a'), C['med-a']), await both(IVC('g-a'), C['med-a']), await both(EFF('g-a'), C['med-a']), await both(GIMP('g-a'), C['med-a']), await both(LEO('ra-2'), C['med-a']), await both(IVS('ra-2'), C['med-a'])].flat();
        ok('C005 del mediador revocado: ninguna cifra individual ni lista de intervenciones, en las dos réplicas', gone.every((r) => r.status !== 200 || !/"studentId":"ra-|"userId":"ra-|"user_id":"ra-/.test(r.text)), gone.map((r) => r.status).join());
        // V9 BI-65C-S — el resumen del grupo tampoco: antes respondía 200 con los agregados de TODA la nómina.
        const sumGone = await both(SUMMARY('g-a'), C['med-a']);
        ok('…ni el resumen agregado del grupo: 403 sin cifras, en las dos réplicas', sumGone.every((r) => r.status === 403 && r.json?.error === 'scope_access_denied'
            && !/totalEffectiveMs|readersWithActivity|readerCount|booksStarted|recognition/.test(r.text)), sumGone.map((r) => `${r.status} ${r.text.slice(0, 80)}`).join(' | '));
        const sumPeer = await both(SUMMARY('g-a2'), C['med-a2']), sumAdmin = await both(SUMMARY('g-a'), C['adm']), sumOther = [await both(SUMMARY('g-a'), C['med-b']), await both(SUMMARY('g-a'), C['med-a2'])].flat();
        ok('el mediador de otro curso, con su compromiso vigente, conserva el resumen de SU curso', all200(sumPeer) && sumPeer.every((r) => Number.isFinite(r.json.readerCount) && r.json.groupId === 'g-a2'), sumPeer.map((r) => r.status).join());
        ok('la administración conserva el resumen del grupo (sin el lector revocado, como antes)', all200(sumAdmin) && sumAdmin.every((r) => r.json.readerCount === 5 && r.json.reading?.all && !r.json.readers.some((x) => x.userId === 'ra-1')), sumAdmin.map((r) => `${r.status} ${r.json?.readerCount}`).join());
        ok('otra institución y el mediador de otro curso siguen sin acceso a este grupo', sumOther.every((r) => r.status === 403), sumOther.map((r) => r.status).join());
        const peerReaders = sumPeer.flatMap((r) => (r.json.readers || []).map((x) => x.userId));
        ok('…y un lector sin autorización vigente no aparece en ningún detalle (ra-1 revocado es el único miembro de g-a2)', !peerReaders.includes('ra-1'), peerReaders.join());
        grantC005(['med-a']);
        const sumBack = await both(SUMMARY('g-a'), C['med-a']);
        ok('compromiso otorgado de nuevo ⇒ vuelve el resumen, sin el lector revocado, en las dos réplicas', all200(sumBack) && sumBack.every((r) => r.json.readerCount === 5 && !r.json.readers.some((x) => x.userId === 'ra-1')), sumBack.map((r) => `${r.status} ${r.json?.readerCount}`).join());
    }
} catch (e) {
    if (e?.message !== 'PROBE') { fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500)); }
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); Progress.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
