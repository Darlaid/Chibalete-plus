/**
 * institutionalStatusAuthzHttp.test.mjs — CHP V9 F7-C2R-U3A.
 *
 * `/api/aula-viva/institutional/status` devolvía los recuentos GLOBALES del área institucional (resultados, cohortes,
 * trayectorias, aprendizajes y patrones de todas las instituciones) a cualquier sesión, también a un lector. Las rutas
 * que leen esa misma proyección entregaban a cualquier mediador filas de otras instituciones.
 *
 * Regla: sin sesión, 401; un lector (institucional o B2C), 403; quien media, solo lo de sus cursos y sus lectores con
 * seguimiento habilitado (CIS + A2 + C005); la administración de plataforma conserva la vista global. Una respuesta
 * denegada no trae recuentos ni nombra instituciones, cursos o lectores.
 *
 * Dos instituciones y una tercera con un curso sin obras; dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce
 * y cookies de /api/auth/login; almacén institucional con recuentos de las dos instituciones.
 *   [1] sesiones sin alcance           [4] rutas equivalentes        [6] revocación inmediata
 *   [2] mediador: solo sus cursos      [5] umbrales                  [7] nada se modifica
 *   [3] administración
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/institutionalStatusAuthzHttp.test.mjs
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
    console.log('institutionalStatusAuthzHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u3a_'));
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

// ── Lectura mínima del curso (para que el impacto contextual tenga dos ventanas) ──
const noon = (d) => Math.floor(at(d) / DAY) * DAY + DAY / 2;
const abandonsOn = (u, c, d) => { for (const k of [0, 1, 2]) { const t = noon(d) + k * 600_000; ev(u, c, 'reading_started', t); ev(u, c, 'reading_abandoned', t + 30_000, { payload: { percentage: 3 } }); } };
abandonsOn('ra-3', 'c1', 30); abandonsOn('ra-3', 'c1', 29);
for (const d of [14, 13, 12, 11, 10, 9, 8, 7]) read('ra-3', 'c1', d);
read('rb-1', 'cb', 25); read('rb-1', 'cb', 8);
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), '[]');

// ── Procedencia ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const snapshot = () => GROUPS().map((g) => ({ groupId: g.id, works: RULES().filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds }));
const seeded = Ledger.observeContext(snapshot(), { nowTs: at(100) });
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
const idb = getInsightsExtDb();

// ── Almacén GLOBAL del área institucional: recuentos y filas de las DOS instituciones, con marcas reconocibles ──
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
// Resultados guardados de las DOS instituciones (los de A y 4 de B), todos de la estrategia «estrategia_global».
for (const [i, u] of [...GA, 'rb-1', 'rb-1', 'rb-1', 'rb-1'].entries()) insertRow(odb, 'intervention_outcomes', { outcome_id: `out-glob-${i}`, intervention_id: `glob-${i}`, user_id: u, scope_type: 'user', scope_id: u,
    intervention_type: 'estrategia_global', outcome_label: 'worsened', baseline_metrics_json: '{}', followup_metrics_json: '{}', delta_metrics_json: '{}', notes_json: '{}' });
const cohort = (id, key, type, scopeType, scopeId) => insertRow(odb, 'cohort_definitions', { cohort_id: id, cohort_key: key, cohort_type: type, scope_type: scopeType, scope_id: scopeId, criteria_json: '{}', active: 1 });
cohort('coh-g-a', 'group:g-a', 'group', 'group', 'g-a'); cohort('coh-g-b', 'group:g-b', 'group', 'group', 'g-b'); cohort('coh-org-b', 'school:org-b', 'school', 'school', 'org-b');
cohort('coh-risk', 'risk:abandono_alto', 'risk', 'risk', 'abandono_alto');
for (const u of [...GA, 'rb-1']) insertRow(odb, 'cohort_memberships', { cohort_id: 'coh-risk', user_id: u, membership_reason_json: '{}', left_at: null });
insertRow(odb, 'cohort_trajectories', { cohort_id: 'coh-g-b', period: '28d', metrics_json: '{}', trend_json: '{}', sample_size: 9 });
for (const i of [1, 2, 3]) insertRow(odb, 'institutional_learnings', { learning_id: `lrn-glob-${i}`, scope_type: 'all', scope_id: 'global', learning_type: `observed_strategy_effect_${i}`,
    evidence_json: JSON.stringify({ support_count: 11, intervention_type: 'estrategia_global', marca: 'aprendizaje-global' }), confidence: 0.4, recommendation_hint: 'aprendizaje-global', active: 1 });
for (const i of [1, 2]) insertRow(odb, 'predictive_risk_patterns', { pattern_id: `pat-glob-${i}`, signal_sequence_json: JSON.stringify(['patron-global']), support_count: 11, confidence: 0.5, active: 1 });
const GLOBAL = { outcomes: GA.length + 4, cohorts: 4, memberships: GA.length + 1, trajectories: 1, learnings: 3, patterns: 2 };
// Intervenciones reales: una de la mediadora A con dos ventanas de lectura y una del mediador B.
const intv = (id, teacher, student, type, daysAgo) => insertRow(pdb, 'pedagogical_interventions', { intervention_id: id, teacher_id: teacher, student_id: student, intervention_type: type,
    created_at: at(daysAgo), notes: null, recommendation_origin: null, outcome: 'pending', outcome_at: null });
intv('iv-a-ra3', 'med-a', 'ra-3', 'lectura_guiada', 20);
intv('iv-b-rb1', 'med-b', 'rb-1', 'lectura_guiada', 18);
const storeDigest = () => JSON.stringify(['intervention_outcomes', 'cohort_definitions', 'cohort_memberships', 'cohort_trajectories', 'institutional_learnings', 'predictive_risk_patterns']
    .map((t) => odb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n));
const STORE_BEFORE = storeDigest();

const ports = await freePorts(2);
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

const S1 = start(ports[0], 1, true), S2 = start(ports[1], 2, true);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 260)}`).join(' | ');
const I = '/api/aula-viva/institutional';
const STATUS = `${I}/status`;
// Rutas que leen la MISMA proyección global (recuentos y filas de todas las instituciones).
const EQUIV = [`${I}/outcomes/by-type/estrategia_global`, `${I}/cohorts/definitions`, `${I}/cohorts/by-type/group`, `${I}/learnings/global`, `${I}/patterns/recent`, `${I}/comparative/strategies`];
const GLOBAL_MARK = /estrategia_global|aprendizaje-global|patron-global|coh-g-b|coh-org-b|"g-b"|org-b|lrn-glob|pat-glob/;
const isGlobalStatus = (j) => j?.outcomes?.total === GLOBAL.outcomes && j?.cohorts?.total_active === GLOBAL.cohorts && j?.learnings?.total_active === GLOBAL.learnings && j?.patterns?.total_active === GLOBAL.patterns;
// Denegado: 401/403 y un cuerpo que no trae ningún recuento ni nombra instituciones, cursos o lectores.
const denied = (r, code) => r.status === code && !/outcomes|cohorts|trajectories|learnings|patterns|total/.test(r.text) && !GLOBAL_MARK.test(r.text) && !/ra-\d|rb-1|g-a|org-a/.test(r.text);
const sameBody = (rs) => JSON.stringify({ ...rs[0].json, ts: 0 }) === JSON.stringify({ ...rs[1].json, ts: 0 });

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'rb-1', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base sembrada y almacén global con recuentos de las dos instituciones', seeded.ok && seeded.baseline && STORE_BEFORE === JSON.stringify([GLOBAL.outcomes, 4, GLOBAL.memberships, 1, 3, 2]));

    section('[1] sesiones sin alcance institucional');
    {
        const none = await both(STATUS, null), bad = await both(STATUS, 'chp_session=no-es-una-sesion');
        ok('sin sesión: 401, sin recuentos', none.every((r) => denied(r, 401)), st(none));
        ok('sesión inválida: 401, sin recuentos', bad.every((r) => denied(r, 401)), st(bad));
        const lector = await both(STATUS, C['ra-1']), otro = await both(STATUS, C['rb-1']), b2c = await both(STATUS, C['b2c-1']);
        ok('lector institucional: 403, sin recuentos globales', lector.every((r) => denied(r, 403)) && otro.every((r) => denied(r, 403)), st(lector));
        ok('lector B2C: 403, sin recuentos globales', b2c.every((r) => denied(r, 403)), st(b2c));
    }

    section('[2] mediador: solo sus cursos');
    {
        const a = await both(STATUS, C['med-a']);
        ok('mediadora A: 200, igual en las dos réplicas y NO los recuentos globales', a.every((r) => r.status === 200) && sameBody(a) && !isGlobalStatus(a[0].json) && a[0].json.context === true, st(a));
        ok('…sus propios recuentos: 1 comparación de su curso, población de sus lectores habilitados', a[0].json.outcomes.total === 1 && a[0].json.population.eligible === 6 && a[0].json.cohorts.total_active >= 1
            && a[0].json.learnings.total_active === 0 && a[0].json.patterns.total_active === 0, JSON.stringify(a[0].json));
        ok('…sin la estrategia ni las filas de la otra institución', a.every((r) => !GLOBAL_MARK.test(r.text) && !/worsened":1[01]/.test(r.text)));
        const b = await both(STATUS, C['med-b']);
        ok('mediador de otra institución: sus propios recuentos (1 lector, 1 comparación), nada de la institución A', b.every((r) => r.status === 200 && r.json.context === true && r.json.population.eligible === 1
            && r.json.outcomes.total === 1 && !isGlobalStatus(r.json)), st(b));
        const noc = await both(STATUS, C['med-noc']);
        ok('mediador del curso sin C005: ningún lector habilitado y ningún recuento del curso ni global', noc.every((r) => r.status === 200 && r.json.population.eligible === 0 && r.json.outcomes.total === 0 && !isGlobalStatus(r.json)), st(noc));
        const z = await both(STATUS, C['med-z']);
        ok('mediadora de un curso sin obras: sus lectores, sin comparaciones y sin recuentos globales', z.every((r) => r.status === 200 && r.json.outcomes.total === 0 && r.json.population.eligible === 1 && !isGlobalStatus(r.json)), st(z));
    }

    section('[3] administración de plataforma');
    {
        const a = await both(STATUS, C.adm);
        ok('conserva los recuentos globales', a.every((r) => r.status === 200 && isGlobalStatus(r.json) && r.json.trajectories.total === GLOBAL.trajectories && r.json.cohorts.total_memberships === GLOBAL.memberships && !('context' in r.json)), st(a));
        const eq = [];
        for (const p of EQUIV) eq.push(...await both(p, C.adm));
        ok('conserva las seis rutas equivalentes con datos globales', eq.every((r) => r.status === 200) && eq.filter((r) => GLOBAL_MARK.test(r.text)).length >= 10, eq.map((r) => r.status).join(' '));
    }

    section('[4] rutas equivalentes (misma proyección global)');
    {
        for (const p of EQUIV) {
            const none = await both(p, null), lec = await both(p, C['ra-1']), b2c = await both(p, C['b2c-1']);
            ok(`${p.replace(I, '')} — sin sesión 401; lector y B2C 403; ninguno recibe datos`, none.every((r) => r.status === 401 && !GLOBAL_MARK.test(r.text)) && [...lec, ...b2c].every((r) => r.status === 403 && !GLOBAL_MARK.test(r.text)), st([...none, ...lec]));
            const med = await both(p, C['med-a']);
            ok(`${p.replace(I, '')} — mediadora A: nada de otras instituciones ni recuentos globales`, med.every((r) => [200, 403].includes(r.status) && !GLOBAL_MARK.test(r.text.replace('"intervention_type":"estrategia_global"', '')) && !/"total":1\d/.test(r.text)) && JSON.stringify(med[0].json) === JSON.stringify(med[1].json), st(med));   // el nombre de la estrategia consultada es eco de la propia petición
        }
        const defs = await both(`${I}/cohorts/definitions`, C['med-a']), byType = await both(`${I}/cohorts/by-type/group`, C['med-a']);
        ok('definiciones de cohortes: la de su curso y las tipadas; no las de otros cursos o colegios', defs.every((r) => r.status === 200 && r.json.every((c) => c.context === true) && r.json.filter((c) => ['group', 'club', 'school'].includes(c.cohort_type)).map((c) => c.cohort_key).join() === 'group:g-a'
            && r.json.some((c) => c.cohort_key === 'habit:high_continuity') && !/g-b|org-/.test(r.text)), st(defs));   // V9 F7-C2R-U3D: definiciones del contexto (abstractas)
        ok('cohortes por tipo «group»: solo la de su curso', byType.every((r) => r.status === 200 && r.json.map((c) => c.cohort_key).join() === 'group:g-a'), st(byType));
        const bt = await both(`${I}/outcomes/by-type/lectura_guiada`, C['med-a']);
        ok('impacto por estrategia: el de sus cursos (1 caso), no el global', bt.every((r) => r.status === 200 && r.json.total === 1 && r.json.intervention_type === 'lectura_guiada'), st(bt));
        // V9 F7-C2R-U3D: quien media recibe los patrones OBSERVADOS en sus cursos (aquí ninguno alcanza el soporte), nunca los guardados.
        ok('patrones: los de sus cursos, con población y umbrales; no el agregado guardado entre instituciones', (await both(`${I}/patterns/recent`, C['med-a'])).every((r) => r.status === 200 && r.json.context === true
            && Array.isArray(r.json.patterns) && r.json.patterns.length === 0 && r.json.population.eligible === 6 && r.json.min_support === 5 && !/pat_|support_count":[1-9]/.test(r.text)));
        const tr = await both(`${I}/cohorts/coh-g-b/trajectory`, C['med-a']), mem = await both(`${I}/cohorts/coh-g-b/members`, C['med-a']);
        ok('trayectoria y miembros de la cohorte de otro curso: denegados', [...tr, ...mem].every((r) => r.status === 403 && !/sample_size|members_count/.test(r.text)), st(tr));
    }

    section('[5] umbrales: sin aprendizajes ni comparativas por debajo del mínimo');
    {
        const l = await both(`${I}/learnings/global`, C['med-a']), c = await both(`${I}/comparative/strategies`, C['med-a']);
        ok('un solo caso no produce un aprendizaje (mínimo 5)', l.every((r) => r.status === 200 && Array.isArray(r.json) && r.json.length === 0), st(l));
        ok('comparativa: solo la estrategia de sus cursos, con su total', c.every((r) => r.status === 200 && r.json.strategies.map((s) => `${s.intervention_type}:${s.total}`).join() === 'lectura_guiada:1'), st(c));
    }

    section('[6] revocación inmediata');
    {
        Reg.appendDecisions([{ subjectId: 'ra-3', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-3' }]);
        const a = await both(STATUS, C['med-a']);
        ok('A2 revocada: el lector y su comparación salen de los recuentos, en las dos réplicas', a.every((r) => r.status === 200 && r.json.outcomes.total === 0 && r.json.population.eligible === 5), st(a));
        Reg.appendDecisions([{ subjectId: 'med-b', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-B' }]);
        const b = await both(STATUS, C['med-b']);
        ok('C005 revocado: ningún lector habilitado ni recuento, de inmediato', b.every((r) => r.status === 200 && r.json.population.eligible === 0 && r.json.outcomes.total === 0 && !isGlobalStatus(r.json)), st(b));
        fs.appendFileSync(REG, 'esto no es una decisión\n');
        const broken = await both(STATUS, C['med-a']);
        ok('registro de decisiones no verificable: 503, nunca recuentos', broken.every((r) => r.status === 503 && !/outcomes/.test(r.text)), st(broken));
        ok('…la administración no depende del registro', (await both(STATUS, C.adm)).every((r) => r.status === 200 && isGlobalStatus(r.json)));
    }

    section('[7] nada se modifica');
    ok('el almacén institucional sigue igual', storeDigest() === STORE_BEFORE);
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
