/**
 * derivedIndicatorsHttp.test.mjs — CHP V9 F7-C2S.
 *
 * Indicadores individuales DERIVADOS. Aula Viva (perfil, señales, riesgo, vector de rasgos, recomendaciones por lector,
 * impacto, cola de atención, cohortes de riesgo) y Leo (perfil del lector, ICDLI, alertas, acción sugerida, mensaje a
 * la familia, recomendación, invitación a producir) se calculan con TODA la actividad del lector y se guardan sin la
 * obra ni el curso de origen. Un mediador con CIS + A2 + C005 en regla no los recibe: 403 con código propio o campos
 * ausentes y declarados; nunca ceros, un perfil «estable» ni una lista vacía. El cálculo y el almacén no cambian.
 *
 * `ra-1` lee c1 (obra de su curso) y c3 (compra personal B2C). Sus indicadores derivados llevan una marca (0.8125,
 * «marca-ra-1», apoyo «vocabulary») que solo puede salir del almacén derivado: si aparece ante el mediador, hay fuga.
 * `ra-2` solo tiene actividad de su curso. `ra-z` está en un curso sin obras asociadas.
 *
 * Tres instituciones (dos con cursos comparables y una con un curso sin obras), dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce; cookies de /api/auth/login.
 *   [1] perfil con actividad de curso y personal   [5] informe, intervención y Leo del mediador
 *   [2] perfil solo de curso institucional         [6] curso sin obras
 *   [3] otra institución                           [7] lo propio del lector y la administración
 *   [4] A2 o C005 ausente o revocada               [8] agregados
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/derivedIndicatorsHttp.test.mjs
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
    console.log('derivedIndicatorsHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 500)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2s_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' }, Z = { organizationId: 'org-c', colegio: 'Colegio Gamma' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const med = (id, org) => acct(id, ['mediador'], { mediatorKind: 'teacher', ...org });
const reader = (id, org) => acct(id, ['lector'], { ...org });
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6'];     // seis con A2: tras revocar una, el agregado del curso sigue siendo divulgable (≥ 5)
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    med('med-a', A), med('med-noc', A), med('med-z', Z), med('med-b', B),
    ...GA.map((id) => reader(id, A)), reader('ra-noa2', A), reader('ra-z', Z), reader('rb-1', B),
]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
fs.writeFileSync(P.groups, JSON.stringify([
    grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a', 'med-noc'], [...GA, 'ra-noa2']),
    grp('g-z', 'Quinto Z', Z, 'Colegio Gamma', ['med-z'], ['ra-z']),          // curso SIN obras asociadas
    grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], ['rb-1']),
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }, { id: 'org-c', name: 'Colegio Gamma' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['c3', 'Lectura personal comprada'], ['cb', 'Obra de la otra institución']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c-ra1', scope: 'user', scopeId: 'ra-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-1' } },
    { id: 'r-b2c-raz', scope: 'user', scopeId: 'ra-z', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-2' } },
]));
const NOW = Date.now(), T0 = NOW - 3 * 86400000;
const events = [];
const session = (userId, contentId, d, at) => {
    events.push({ event: 'session_start', userId, contentId, timestamp: at, streak: 0 });
    events.push({ event: 'block_complete', userId, contentId, timestamp: at + 1000, streak: 1 });
    events.push({ event: 'session_end', userId, contentId, timestamp: at + d, sessionDuration: d, progressPercentage: 50 });
};
session('ra-1', 'c1', 60000, T0); session('ra-1', 'c3', 7000000, T0 + 3600000);
session('ra-2', 'c1', 50000, T0); session('ra-z', 'c3', 40000, T0); session('rb-1', 'cb', 45000, T0);
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

// Leo: perfil del lector (toda su actividad), memoria por obra y evidencias recientes.
const iso = (ms) => new Date(ms).toISOString();
const leoProfile = (userId) => ({ schemaVersion: 1, userId, vocabularyInteractionsCount: 9, inferentialInteractionsCount: 1, reflectionInteractionsCount: 0,
    writingInteractionsCount: 0, totalChatInteractions: 10, oralityAttemptsCount: 0, averageOralityScore: null, preferredSupportType: 'vocabulary', updatedAt: iso(NOW) });
fs.writeFileSync(path.join(P.data, 'leo_profile_db.json'), JSON.stringify({ profileMap: { 'ra-1': leoProfile('ra-1'), 'ra-2': leoProfile('ra-2'), 'ra-z': leoProfile('ra-z') } }));
const mem = (n, stage) => ({ schemaVersion: 1, interactionCount: n, lastInteractionAt: iso(NOW - 3600000), pedagogicalStage: stage, updatedAt: iso(NOW - 3600000) });
fs.writeFileSync(path.join(P.data, 'leo_memory_db.json'), JSON.stringify({ memoryMap: {
    'ra-1__c1': mem(3, 'comprehension'), 'ra-1__c3': mem(41, 'creation'), 'ra-2__c1': mem(4, 'comprehension'), 'ra-z__c3': mem(6, 'creation') } }));
const ev = (userId, contentId, i) => ({ id: `ev-${userId}-${contentId}-${i}`, userId, contentId, timestamp: iso(NOW - (i + 1) * 600000), evidenceType: 'scaffolded', pedagogicalObjective: 'vocabulary', surface: 'chat' });
fs.writeFileSync(P.evidence, JSON.stringify({ schemaVersion: 1, entries: [
    ...[0, 1].map((i) => ev('ra-1', 'c1', i)), ...[0, 1, 2, 3].map((i) => ev('ra-1', 'c3', i)), ...[0, 1].map((i) => ev('ra-2', 'c1', i)), ...[0, 1, 2].map((i) => ev('ra-z', 'c3', i)) ] }));

const REG = a2RegistryPath();
const Reg = await import('../privacy/a2Registry.mjs');
grantA2([...GA, 'ra-z', 'rb-1']);
grantC005(['med-a', 'med-z', 'med-b']);

// Almacén derivado con su esquema REAL. La marca 0.8125 / «marca-<lector>» solo existe aquí.
const MARK = 0.8125;
const Ins = await import('../db/insightsDbExt.mjs'), Ped = await import('../db/pedagogyDbExt.mjs'), Out = await import('../db/outcomesDbExt.mjs'), Rol = await import('../db/rollupsDbExt.mjs');
const idb = Ins.getInsightsExtDb(), pdb = Ped.getPedagogyExtDb(), odb = Out.getOutcomesExtDb(), rdb = Rol.getRollupsExtDb();
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
const SUBJECTS = [...GA, 'ra-noa2', 'ra-z', 'rb-1'];
for (const u of SUBJECTS) {
    const who = `marca-${u}`;
    insertRow(idb, 'user_reading_profiles', { user_id: u, abandono_risk: MARK, engagement_score: MARK, persistencia_score: MARK, last_active_at: NOW - 86_400_000, updated_at: NOW, source_watermark: 1 });
    insertRow(idb, 'signal_snapshots', { scope_type: 'user', scope_id: u, signal_id: 'continuidad_semanal', period: '28d', metric_value: MARK, updated_at: NOW, metadata_json: JSON.stringify({ who }) });
    insertRow(rdb, 'feature_vectors', { user_id: u, features_json: JSON.stringify({ who, f: MARK }) });
    insertRow(pdb, 'pedagogical_risk_history', { user_id: u, source_signals_json: JSON.stringify({ who }) });
    insertRow(pdb, 'pedagogical_recommendations', { recommendation_id: `rec-${u}`, scope_type: 'user', scope_id: u, rule_id: 'r', recommendation_type: 'lectura_guiada', severity: 'critical', created_at: NOW, expires_at: NOW + 86_400_000, explanation_json: JSON.stringify({ who }), rule_ids_json: '[]' });
    insertRow(odb, 'intervention_outcomes', { outcome_id: `out-u-${u}`, intervention_id: `int-${u}`, user_id: u, scope_type: 'user', scope_id: u, intervention_type: 'lectura_guiada', outcome_label: 'worsened', baseline_metrics_json: JSON.stringify({ who }), followup_metrics_json: '{}', delta_metrics_json: '{}', created_at: NOW });
}
// Agregados del curso g-a (5 lectores) y filas de impacto por lector dentro del ámbito de grupo.
insertRow(idb, 'cohort_rollups', { scope_type: 'group', scope_id: 'g-a', period: '28d', metric_key: 'active_users', metric_value: 6, updated_at: NOW, source_watermark: 1 });
insertRow(pdb, 'pedagogical_recommendations', { recommendation_id: 'rec-g-a', scope_type: 'group', scope_id: 'g-a', rule_id: 'r', recommendation_type: 'lectura_guiada', severity: 'moderate', created_at: NOW, expires_at: NOW + 86_400_000, explanation_json: '{}', rule_ids_json: '[]' });
for (const u of GA.slice(0, 5)) insertRow(odb, 'intervention_outcomes', { outcome_id: `out-g-${u}`, intervention_id: `intg-${u}`, user_id: u, scope_type: 'group', scope_id: 'g-a', intervention_type: 'lectura_guiada', outcome_label: u === 'ra-1' ? 'worsened' : 'improved', baseline_metrics_json: JSON.stringify({ who: `marca-${u}` }), followup_metrics_json: '{}', delta_metrics_json: '{}', created_at: NOW });
insertRow(odb, 'intervention_outcomes', { outcome_id: 'out-g-z', intervention_id: 'intg-z', user_id: 'ra-z', scope_type: 'group', scope_id: 'g-z', intervention_type: 'lectura_guiada', outcome_label: 'worsened', baseline_metrics_json: JSON.stringify({ who: 'marca-ra-z' }), followup_metrics_json: '{}', delta_metrics_json: '{}', created_at: NOW });
insertRow(odb, 'cohort_definitions', { cohort_id: 'coh-risk', cohort_key: 'risk:abandono_alto', cohort_type: 'risk', scope_type: 'risk', scope_id: 'abandono_alto', criteria_json: '{}', active: 1 });
insertRow(odb, 'cohort_definitions', { cohort_id: 'coh-g-a', cohort_key: 'group:g-a', cohort_type: 'group', scope_type: 'group', scope_id: 'g-a', criteria_json: '{}', active: 1 });
for (const u of SUBJECTS) insertRow(odb, 'cohort_memberships', { cohort_id: 'coh-risk', user_id: u, membership_reason_json: '{}', left_at: null });
for (const u of GA) insertRow(odb, 'cohort_memberships', { cohort_id: 'coh-g-a', user_id: u, membership_reason_json: '{}', left_at: null });
const derivedDigest = () => JSON.stringify([
    idb.prepare('SELECT user_id, abandono_risk, engagement_score, persistencia_score FROM user_reading_profiles ORDER BY user_id').all(),
    idb.prepare(`SELECT scope_id, metric_value FROM signal_snapshots WHERE scope_type = 'user' ORDER BY scope_id`).all(),
    rdb.prepare('SELECT user_id, features_json FROM feature_vectors ORDER BY user_id').all(),
    pdb.prepare('SELECT recommendation_id, acknowledged FROM pedagogical_recommendations ORDER BY recommendation_id').all(),
    odb.prepare('SELECT outcome_id, outcome_label FROM intervention_outcomes ORDER BY outcome_id').all(),
    odb.prepare('SELECT cohort_id, user_id FROM cohort_memberships ORDER BY cohort_id, user_id').all(),
]);
const leoDigest = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(P.data, 'leo_profile_db.json'))).digest('hex');
const BEFORE = { derived: derivedDigest(), leo: leoDigest() };

const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* aún no */ } await sleep(150); } throw new Error(`nunca healthy\n${s.out.slice(-1500)}`); };
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

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 90)}`).join(' | ');
const WITHHELD = 'individual_indicators_withheld';
// Retenido: 403, solo el código; ni la marca del almacén derivado ni una forma «vacía» que se lea como diagnóstico.
const withheld = (r) => r.status === 403 && r.json?.error === WITHHELD && Object.keys(r.json).sort().join() === 'error,ok';
const denied = (r) => r.status === 403 && r.json?.error === 'scope_access_denied';
const LEAK = /0\.8125|marca-|abandono_risk|engagement_score|persistencia_score|profile_current|signals_current|feature|"vocabulary"|icdli|suggestedMediatorAction|"alerts"|preferredSupportType|dominantPedagogicalObjective/;
const noLeak = (r) => !LEAK.test(r.text);
// Las rutas con indicadores individuales derivados de Aula Viva, por lector.
const AV = (u) => [`/api/aula-viva/students/${u}/timeline`, `/api/aula-viva/students/${u}/feature-vector`, `/api/aula-viva/students/${u}/risk-history`,
    `/api/aula-viva/students/${u}/signals/continuidad_semanal/timeline`, `/api/aula-viva/recommendations/scope/user/${u}`,
    `/api/aula-viva/institutional/profile/${u}`, `/api/aula-viva/institutional/outcomes/scope/user/${u}`];
const LEO_PERSON = ['icdliHasData', 'icdliLevel', 'icdliComposite', 'icdliDominantAlerts', 'icdliDominantStrengths', 'dominantPedagogicalObjective', 'preferredSupportType', 'alerts', 'suggestedMediatorAction'];
const allAV = async (u, cookie) => { const out = []; for (const p of AV(u)) out.push(...(await both(p, cookie)).map((r) => ({ ...r, path: p }))); return out; };
// V9 F7-C2R-U2: por mediación, las rutas de Aula Viva responden con indicadores del CONTEXTO del curso (200) y nunca con
// el almacén derivado global, que aquí lleva la marca 0.8125 / «marca-<lector>». El impacto por lector sigue retenido.
const GLOBAL_MARK = /0\.8125|marca-/;
const contextual = (r) => (/\/outcomes\//.test(r.path) ? withheld(r) : r.status === 200 && !GLOBAL_MARK.test(r.text));

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-noc', 'med-z', 'med-b', 'ra-1', 'ra-2', 'ra-z', 'rb-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const CP = (pct) => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: pct }, viewportHint: pct }, updatedAt: new Date().toISOString() });
    const saved = [];
    for (const [u, c, pct] of [['ra-1', 'c1', 40], ['ra-1', 'c3', 70], ['ra-2', 'c1', 35], ['ra-z', 'c3', 20], ['rb-1', 'cb', 25]]) saved.push((await post(S1, `/api/progress/${u}/${c}/sync`, C[u], CP(pct))).status);
    ok('preparación: cada lector guarda su propio progreso', saved.every((x) => x === 200), saved.join(' '));
    {   // El almacén derivado SÍ tiene datos: la administración los ve (si no, las retenciones no probarían nada).
        const t = await get(S1, '/api/aula-viva/students/ra-1/timeline', C.adm), s = await get(S2, '/api/leo/mediator/student/ra-1', C.adm);
        ok('preparación: la administración ve el perfil derivado de ra-1 (marca 0.8125) y su perfil de Leo (apoyo «vocabulary», campos ICDLI y acción sugerida)',
            t.status === 200 && t.json?.profile_current?.abandono_risk === MARK && s.status === 200 && s.json?.summary?.preferredSupportType === 'vocabulary' && 'icdliHasData' in (s.json?.summary ?? {}) && typeof s.json.summary.suggestedMediatorAction === 'string',
            `${t.status} ${t.text.slice(0, 160)} | ${s.status} ${s.text.slice(0, 260)}`);
    }

    section('[1] perfil con actividad de curso y personal: sin indicadores individuales contaminados');
    {
        const rs = await allAV('ra-1', C['med-a']);
        ok('Aula Viva: las rutas individuales de ra-1 responden desde el contexto del curso, sin el almacén derivado global (impacto: retenido)', rs.length === 14 && rs.every(contextual), st(rs));
        const tl = rs.find((r) => /\/timeline$/.test(r.path) && !/signals/.test(r.path));
        ok('…el timeline dice su estado y no trae diagnóstico sin evidencia atribuible', typeof tl.json.data_state === 'string' && tl.json.data_state !== 'ok' && tl.json.profile_current === null && tl.json.risks.length === 0 && tl.json.summaries.length === 1, tl.text.slice(0, 300));
        const q = await both('/api/aula-viva/students-needing-attention', C['med-a']);
        ok('cola de atención: la del mediador, sin lectores ordenados por el riesgo global', q.every((r) => r.status === 200 && Array.isArray(r.json) && !GLOBAL_MARK.test(r.text)), st(q));
        const leo = await both('/api/leo/mediator/student/ra-1', C['med-a']);
        ok('Leo del mediador: 200 sin ningún campo del perfil del lector ni del ICDLI (ausentes, no en cero)', leo.every((r) => r.status === 200 && r.json?.success === true && LEO_PERSON.every((k) => !(k in r.json.summary))), st(leo));
        ok('…y declara cuáles retiene', leo.every((r) => JSON.stringify([...(r.json.summary.withheld ?? [])].sort()) === JSON.stringify([...LEO_PERSON].sort())));
        ok('…conserva lo que sale de la obra del curso: 3 interacciones (no 44), señales solo de c1', leo.every((r) => r.json.summary.totalInteractions === 3 && r.json.summary.recentEvidenceSignals.length === 2 && !/"c3"/.test(r.text)), leo[0].text.slice(0, 400));
        const act = await both('/api/leo/activation/ra-1', C['med-a']);
        ok('activación: sin mensaje a la familia, recomendación ni invitación a producir; se declaran retenidas', act.every((r) => r.status === 200 && (r.json.outputs ?? []).every((o) => o.type === 'continuity')
            && JSON.stringify(r.json.withheld) === JSON.stringify(['family', 'recommendation', 'production']) && !/"c3"/.test(r.text)), st(act));
    }

    section('[2] perfil solo de curso institucional: únicamente indicadores de procedencia demostrable');
    {
        const rs = await allAV('ra-2', C['med-a']);
        ok('el perfil derivado global de ra-2 tampoco se entrega: responde el contexto', rs.every(contextual), st(rs));
        const pr = await both('/api/progress/user/ra-2', C['med-a']), stt = await both('/api/students/ra-2/status', C['med-a']);
        ok('progreso por obra del curso: sí (c1, 35 %)', pr.every((r) => r.status === 200 && r.json.progressList.length === 1 && r.json.progressList[0].contentId === 'c1'), st(pr));
        ok('estado del lector sobre las obras del curso: sí', stt.every((r) => r.status === 200 && r.json?.progress?.booksStarted === 1), st(stt));
        const leo = await both('/api/leo/mediator/student/ra-2', C['med-a']), hist = await both('/api/leo/mediator/student/ra-2/content/c1', C['med-a']);
        ok('Leo sobre la obra del curso: sesiones y evidencias de c1 (4 interacciones), sin perfil de persona', leo.every((r) => r.status === 200 && r.json.summary.totalInteractions === 4 && !('preferredSupportType' in r.json.summary)) && hist.every((r) => r.status === 200 && r.json?.history), st(leo));
        const cm = await both('/api/metrics/course/g-a', C['med-a']);
        const row = (r, id) => (r.json?.studentBreakdown ?? []).find((x) => x.userId === id);
        ok('tablero del curso: el perfil pedagógico de ra-2 y de ra-1 se calcula solo con sesiones de c1', cm.every((r) => r.status === 200 && row(r, 'ra-2') && 'pedagogicalProfile' in row(r, 'ra-2') && row(r, 'ra-1')?.totalSessions === 1 && !/"c3"/.test(r.text) && !r.text.includes('7000000')), cm[0].text.slice(0, 300));
    }

    section('[3] otra institución: rechazo');
    {
        const rs = await allAV('ra-1', C['med-b']);
        ok('med-b (otra institución) → scope_access_denied en las siete rutas, sin datos', rs.every(denied) && rs.every(noLeak), st(rs));
        const leo = [...await both('/api/leo/mediator/student/ra-1', C['med-b']), ...await both('/api/leo/activation/ra-1', C['med-b'])];
        ok('…y en Leo', leo.every((r) => r.status === 403 && noLeak(r)), st(leo));
        const own = await allAV('rb-1', C['med-b']);
        ok('simétrico: sobre su propio lector, concedido y contextual', own.every(contextual), st(own));
        const m = await both('/api/aula-viva/institutional/cohorts/coh-g-a/members', C['med-b']);
        ok('nómina de una cohorte de otra institución → 403', m.every((r) => r.status === 403 && !/ra-1/.test(r.text)), st(m));
    }

    section('[4] A2 o C005 ausente o revocada: rechazo (no «retenido»)');
    {
        const noA2 = await allAV('ra-noa2', C['med-a']), noC = await allAV('ra-1', C['med-noc']);
        ok('lector sin A2 → scope_access_denied', noA2.every(denied) && noA2.every(noLeak), st(noA2));
        ok('mediador del curso sin C005 → scope_access_denied', noC.every(denied) && noC.every(noLeak), st(noC));
        const leoNoC = await both('/api/leo/mediator/student/ra-1', C['med-noc']);
        ok('…y en Leo', leoNoC.every((r) => r.status === 403), st(leoNoC));
        Reg.appendDecisions([{ subjectId: 'ra-5', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-5' }]);
        const rev = await allAV('ra-5', C['med-a']);
        ok('A2 revocada → rechazo inmediato en las dos réplicas', rev.every(denied), st(rev));
        Reg.appendDecisions([{ subjectId: 'med-z', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-Z' }]);
        const revC = await allAV('ra-z', C['med-z']);
        ok('C005 revocado → rechazo inmediato en las dos réplicas', revC.every(denied), st(revC));
        grantC005(['med-z']);
        const back = await allAV('ra-z', C['med-z']);
        ok('C005 vuelto a otorgar → concedido de nuevo (contextual)', back.every(contextual), st(back));
    }

    section('[5] informe, intervención y Leo del mediador: sin exposición alternativa');
    {
        const paths = ['/api/reports/course/g-a', '/api/metrics/course/g-a', '/api/groups/g-a/analytics-summary', '/api/students/ra-1/status', '/api/interventions/student/ra-1',
            '/api/interventions/effectiveness?courseId=g-a', '/api/interventions/effectiveness', '/api/aula-viva/operational/status', '/api/aula-viva/institutional/outcomes/follow-up-queue',
            '/api/leo/mediator/student/ra-1/content/c1'];
        const rs = []; for (const p of paths) rs.push(...await both(p, C['med-a']));
        const bad = rs.filter((r) => r.status >= 500 || /0\.8125|marca-|abandono_risk|engagement_score|"c3"|Lectura personal comprada|7000000/.test(r.text));
        ok('informe, tablero, resumen del grupo, estado, intervenciones, estado operativo y cola de seguimiento: sin la marca derivada ni la lectura personal', bad.length === 0, bad.map((r) => `${r.status} ${r.text.slice(0, 200)}`).join(' || '));
        const hist = await both('/api/leo/mediator/student/ra-1/content/c3', C['med-a']);
        ok('historial de Leo de la compra personal → 403', hist.every((r) => r.status === 403), st(hist));
        const os_ = await both('/api/aula-viva/operational/status', C['med-a']);
        ok('estado operativo: las recomendaciones de un lector (critical) no se cuentan al mediador; sí la de su grupo', os_.every((r) => r.status === 200 && r.json.recommendations_summary.critical === 0 && r.json.recommendations_summary.moderate === 1), st(os_));
        const risk = await both('/api/aula-viva/institutional/cohorts/coh-risk/members', C['med-a']);
        ok('miembros de una cohorte de riesgo → retenido (pertenecer a ella es un indicador derivado)', risk.every(withheld) && risk.every((r) => !/ra-1/.test(r.text)), st(risk));
        const roster = await both('/api/aula-viva/institutional/cohorts/coh-g-a/members', C['med-a']);
        ok('nómina de la cohorte de su curso: sí (es la lista del curso, no un indicador)', roster.every((r) => r.status === 200 && r.json.members_count >= 4), st(roster));
        const intv = await post(S1, '/api/aula-viva/interventions', C['med-a'], { studentId: 'ra-1', interventionType: 'lectura_guiada' });
        ok('el mediador sigue pudiendo registrar una intervención sobre su lector', intv.status === 200, intv.text.slice(0, 200));
    }

    section('[6] curso sin obras: sin diagnósticos individuales falsos');
    {
        const rs = await allAV('ra-z', C['med-z']);
        ok('Aula Viva: curso sin obras ⇒ no_course_works, sin el perfil global de ra-z', rs.every(contextual) && rs.filter((r) => /students\/ra-z\/timeline$/.test(r.path)).every((r) => r.json.data_state === 'no_course_works' && r.json.profile_current === null), st(rs));
        const leo = await both('/api/leo/mediator/student/ra-z', C['med-z']);
        ok('Leo: 0 interacciones en ámbito y NINGUNA alerta, acción sugerida ni nivel (no «Mantén el ritmo actual» ni «Inicial»)',
            leo.every((r) => r.status === 200 && r.json.summary.totalInteractions === 0 && LEO_PERSON.every((k) => !(k in r.json.summary)) && !/Mantén el ritmo|Inicial|Sin datos ICDLI|Baja actividad/.test(r.text)), st(leo));
        const act = await both('/api/leo/activation/ra-z', C['med-z']);
        ok('activación: ninguna salida (su única actividad es personal)', act.every((r) => r.status === 200 && r.json.outputs.length === 0 && !/"c3"/.test(r.text)), st(act));
        const stt = await both('/api/students/ra-z/status', C['med-z']);
        ok('estado: cero libros en ámbito, sin la compra personal', stt.every((r) => r.status === 200 && r.json?.progress?.booksStarted === 0 && !/"c3"/.test(r.text)), st(stt));
        const og = await both('/api/aula-viva/institutional/outcomes/scope/group/g-z', C['med-z']);
        ok('impacto del curso de un solo lector: suprimido, sin su resultado individual', og.every((r) => r.status === 200 && r.json.suppressed === true && r.json.outcomes.length === 0 && !/worsened|marca-/.test(r.text)), st(og));
    }

    section('[7] lo propio del lector y la administración: intactos');
    {
        const own = await both('/api/progress/user/ra-1', C['ra-1']);
        ok('el lector conserva todo su progreso (curso y personal)', own.every((r) => r.status === 200 && r.json.progressList.length === 2), st(own));
        const ownP = await both('/api/aula-viva/institutional/profile/ra-1', C['ra-1']);
        ok('el lector ve su propio perfil (no es consulta por mediación)', ownP.every((r) => r.status === 200 && 'timeline' in r.json), st(ownP));
        const ownA = await both('/api/leo/activation/ra-1', C['ra-1']);
        ok('el lector recibe sus propias salidas de Leo completas (también el mensaje a la familia), sin «withheld»', ownA.every((r) => r.status === 200 && !('withheld' in r.json) && r.json.outputs.some((o) => o.type !== 'continuity')), st(ownA));
        const other = await both('/api/aula-viva/institutional/profile/ra-2', C['ra-1']);
        ok('…pero no el de otro lector', other.every((r) => r.status === 403), st(other));
        const adm = await allAV('ra-1', C.adm);
        ok('la administración de plataforma conserva las siete rutas', adm.every((r) => r.status === 200), st(adm));
        const q = await both('/api/aula-viva/students-needing-attention', C.adm);
        ok('…y la cola de atención', q.every((r) => r.status === 200 && Array.isArray(r.json) && r.json.some((x) => x.user_id === 'ra-1')), st(q));
        const leoAdm = await both('/api/leo/mediator/student/ra-1', C.adm);
        ok('…y el resumen completo de Leo (44 interacciones, alertas y acción sugerida)', leoAdm.every((r) => r.status === 200 && r.json.summary.totalInteractions === 44 && Array.isArray(r.json.summary.alerts) && typeof r.json.summary.suggestedMediatorAction === 'string'), st(leoAdm));
        ok('ningún cálculo ni dato almacenado cambió: almacén derivado y perfil de Leo idénticos', derivedDigest().replace(/"acknowledged":\d/g, '') === BEFORE.derived.replace(/"acknowledged":\d/g, '') && leoDigest() === BEFORE.leo);
    }

    section('[8] agregados: sin fuga indirecta de perfiles');
    {
        const coh = await both('/api/aula-viva/cohorts/group/g-a', C['med-a']);
        ok('comparativa del curso: agregado visible (6 activos) y sin identificadores de lector', coh.every((r) => r.status === 200 && (r.json.metrics ?? []).some((m) => m.metric_key === 'active_users' && m.metric_value === 6) && !/ra-\d|marca-/.test(r.text)), st(coh));
        const og = await both('/api/aula-viva/institutional/outcomes/scope/group/g-a', C['med-a']);
        ok('impacto del curso: distribución (5 resultados) SIN las filas por lector', og.every((r) => r.status === 200 && r.json.total_outcomes === 5 && r.json.distribution.improved === 4 && r.json.outcomes.length === 0
            && JSON.stringify(r.json.withheld) === '["outcomes"]' && !/ra-\d|marca-|user_id/.test(r.text)), st(og));
        const ogAdm = await both('/api/aula-viva/institutional/outcomes/scope/group/g-a', C.adm);
        ok('…la administración conserva las filas', ogAdm.every((r) => r.status === 200 && r.json.outcomes.length === 5), st(ogAdm));
        const recs = await both('/api/aula-viva/recommendations/scope/group/g-a', C['med-a']);
        ok('recomendaciones del grupo: sí, y ninguna de un lector', recs.every((r) => r.status === 200 && Array.isArray(r.json) && r.json.every((x) => x.scope_type === 'group') && !/marca-/.test(r.text)), st(recs));
        const an = await both('/api/groups/g-a/analytics-summary', C['med-a']);
        ok('resumen del grupo: sin la lectura personal ni la marca derivada', an.every((r) => r.status === 200 && !/"c3"|7000000|0\.8125|marca-/.test(r.text)), st(an));
        const eff = await both('/api/interventions/effectiveness?courseId=g-a', C['med-a']);
        ok('efectividad de intervenciones: perfiles pedagógicos solo con actividad del curso', eff.every((r) => r.status === 200 && !/"c3"|0\.8125|marca-/.test(r.text)), st(eff));
    }
} catch (e) {
    console.error('ERROR', e?.stack || e); fail++;
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    for (const m of [Ins, Ped, Out, Rol]) for (const k of Object.keys(m)) if (/^close/.test(k)) try { m[k](); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nderivedIndicatorsHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
