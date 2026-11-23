/**
 * luContextHttp.test.mjs — CHP V9 65E-C2 (Bloque I). La lectura de Lector Único (LU) en el contexto pedagógico.
 *
 * Un lector que solo lee en LU y otro con la MISMA lectura en la web (mismas obras, mismas fechas, mismos minutos, mismo
 * curso y autorizaciones) deben dar los mismos indicadores contextuales: trayectoria, agregado y serie del curso,
 * cohortes, patrones, recomendaciones y lista de atención. Por las rutas reales, en dos réplicas y dos instituciones:
 *   [1] lector LU frente a lector web: indicadores individuales
 *   [2] curso de lectores LU frente a curso de lectores web: agregado, serie y trayectoria de cohorte
 *   [3] coherencia con el tablero y el resumen de Aula Viva (mismos minutos)
 *   [4] sin doble conteo: reenvíos, la copia conservada, y quien lee en LU y en la web
 *   [5] telemetría rodada: la sesión de LU sigue contando en el contexto
 *   [6] histórico sin constancia: «información insuficiente», no inactividad; y no se acredita después
 *   [7] periodo: lectura anterior al ingreso al curso, igual que la web
 *   [8] lectura personal (B2C) en LU: no entra
 *   [9] otra institución, A2 y C005: sin fugas
 *   [10] reinicio de una réplica
 *   [11] (65E-C3) lectura sin conexión cuya fecha declarada antecede a un cambio del contexto: no se acredita en ninguna
 *        superficie (tablero, Aula Viva, trayectoria, cohorte, recomendaciones), ni se acredita después
 *   [12] (65E-C4) administración frente a mediación: las cifras de la administración son ACTIVIDAD OBSERVADA y lo dicen;
 *        la lectura ACREDITADA (65A) va aparte y coincide con la de la mediación, con contexto estable y cambiado
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/. Imprime `TABLA {…}` con las cifras medidas.
 *
 *   node server/__test__/luContextHttp.test.mjs
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
    console.log('luContextHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1600)), fail++);
const section = (t) => console.log(`\n${t}`);
const TABLA = {};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65ec2_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
P.analytics = path.join(P.data, 'analytics_db.json'); P.archive = path.join(P.data, 'archive.db');
process.env.INSIGHTS_SQLITE_PATH = P.insights; process.env.EVENTS_SQLITE_PATH = P.events; process.env.ARCHIVE_SQLITE_PATH = P.archive;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
// g-lu: cinco lectores que SOLO leen en LU · g-web: cinco con la misma lectura en la web · g-x: los casos límite
const LU = [1, 2, 3, 4, 5].map((i) => `lu-${i}`), WEB = [1, 2, 3, 4, 5].map((i) => `web-${i}`);
// lu-old: LU sin constancia de recepción (anterior a 65A) · lu-pre / web-pre: lectura anterior a su ingreso al curso
// lu-b2c: LU sobre su obra personal · lu-rev: LU, A2 revocada · mix-1: lee en LU y en la web · r-none: no lee
// 65E-C3 — chg-work: leyó en LU, sin conexión, una obra que DESPUÉS se retiró del curso y se volvió a asociar, y sincroniza hoy
// chg-mem: ídem, pero es él quien salió del curso y volvió · chg-ok: leyó sin conexión con el contexto ya estable
const GX = ['lu-old', 'lu-pre', 'web-pre', 'lu-b2c', 'lu-rev', 'mix-1', 'r-none', 'chg-work', 'chg-mem', 'chg-ok'];
const READERS_A = [...LU, ...WEB, ...GX];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', ['administrador']), acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    ...READERS_A.map((id) => acct(id, ['lector'], A)), acct('lb-1', ['lector'], B)]));
const course = (id, name, org, med, members) => ({ id, name, type: 'course', ...org, school: org.colegio, mediatorIds: [med], memberIds: members, studentIds: members });
const GROUPS = [course('g-lu', 'Quinto LU', A, 'med-a', LU), course('g-web', 'Quinto Web', A, 'med-a', WEB), course('g-x', 'Sexto', A, 'med-a', GX), course('g-b', 'Otro colegio', B, 'med-b', ['lb-1'])];
const RULES = [...['g-lu', 'g-web', 'g-x'].map((g) => ({ id: `r-${g}`, scope: 'group', scopeId: g, titleIds: g === 'g-x' ? ['c1', 'cs', 'cc'] : ['c1', 'cs'], collectionIds: [] })),
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c', scope: 'user', scopeId: 'lu-b2c', titleIds: ['cp'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-65EC2' } }];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS)); fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['cs', 'Segunda obra'], ['cc', 'Obra retirada y vuelta a asociar'], ['cp', 'Lectura personal'], ['cb', 'Obra de la otra institución']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));

const DAY = 86_400_000, MIN = 60_000, NOW = Date.now();
const luEvent = (userId, contentId, event, ts, extra = {}) => ({ eventId: crypto.randomUUID(), userId, event, timestamp: ts, contentId, source: 'lu_android', ...extra });
/** Sesión de LU: abrir, un latido por minuto y cerrar (ReaderViewModel.kt + AnalyticsSyncCoordinator.kt). */
const luSession = (userId, contentId, startMs, minutes) => {
    const evs = [luEvent(userId, contentId, 'session_start', startMs)];
    for (let m = 1; m < minutes; m++) evs.push(luEvent(userId, contentId, 'session_heartbeat', startMs + m * MIN, { elapsedMs: m * MIN }));
    evs.push(luEvent(userId, contentId, 'session_end', startMs + minutes * MIN, { sessionDuration: minutes * MIN, elapsedMs: minutes * MIN, progressPercentage: 35 }));
    return evs;
};
// La lectura de cada par: tres sesiones en tres días distintos, dos obras del curso, 30 minutos en total.
const PLAN = [[6, 'c1', 12], [3, 'cs', 8], [1, 'c1', 10]].map(([daysAgo, contentId, minutes]) => ({ startMs: NOW - daysAgo * DAY - 90 * MIN, contentId, minutes }));
const PLAN_MIN = PLAN.reduce((a, s) => a + s.minutes, 0);
// lu-old: 9 min de LU de hace 4 días SIN constancia de recepción (guardados antes de 65A), sobre una obra del curso.
fs.writeFileSync(P.analytics, JSON.stringify(luSession('lu-old', 'c1', NOW - 4 * DAY, 9)));

const REG = a2RegistryPath();
grantA2([...READERS_A, 'lb-1']); grantC005(['med-a', 'med-b']);
const Ledger = await import('../aulaViva/contextLedger.mjs');
Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
Ledger.closeContextLedger();
{   // lu-pre y web-pre constan como miembros desde hace dos días: su lectura de hace cinco es anterior al ingreso.
    const db = new Database(P.insights);
    const n = db.prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-x' AND user_id IN ('lu-pre', 'web-pre')`).run(NOW - 2 * DAY).changes;
    db.close();
    if (n !== 2) throw new Error(`fixture: membresías fechadas ${n}`);
}
{   // 65E-C3 — el contexto CAMBIÓ hace dos días y se restableció ayer: la obra `cc` se retiró del curso y se volvió a
    // asociar; `chg-mem` salió del curso y volvió. Lo leído hace tres días ocurrió con el contexto vigente, pero no
    // consta vigente de forma continua hasta hoy.
    const db = new Database(P.insights);
    const reopen = (kind, col, id) => {
        const c = db.prepare(`UPDATE pedagogical_context_intervals SET until_ts = ? WHERE kind = ? AND group_id = 'g-x' AND ${col} = ? AND until_ts IS NULL`).run(NOW - 2 * DAY, kind, id).changes;
        db.prepare(`INSERT INTO pedagogical_context_intervals (kind, group_id, ${col}, since_ts, until_ts, origin) VALUES (?, 'g-x', ?, ?, NULL, 'observed')`).run(kind, id, NOW - 1 * DAY);
        return c;
    };
    const n = reopen('work', 'work_id', 'cc') + reopen('member', 'user_id', 'chg-mem');
    db.close();
    if (n !== 2) throw new Error(`fixture: contexto cambiado ${n}`);
}

const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: P.archive,
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: '1', AULA_VIVA_CONTEXT_OBSERVE_INTERVAL_MS: '3600000',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`server not ready: ${last}\n${s.out.slice(-1500)}`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const post = async (s, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};
const S1 = start(ports[0], 1);
let S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 300)}`).join(' | ');
const sql = (file, q, ...a) => { const db = new Database(file, { readonly: true, fileMustExist: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };
const stored = () => JSON.parse(fs.readFileSync(P.analytics, 'utf8'));
const MINS = (ms) => Math.round((ms || 0) / MIN);
/** La misma sesión como la escribe la web en events.db (hechos canónicos), con las mismas fechas. */
const insertWebSessions = (userId, plan) => {
    const db = new Database(P.events); db.pragma('busy_timeout = 5000');
    const ins = db.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
        VALUES (?, 1, ?, 'text', ?, ?, ?, ?, ?, ?, NULL, '{}', ?)`);
    db.transaction(() => {
        plan.forEach((s, k) => {
            const sid = `web-${userId}-${k}`, row = (name, ts, elapsed) => ins.run(`${sid}-${name}-${ts}`, name, userId, s.contentId, sid, ts, ts, elapsed, ts);
            row('reading_started', s.startMs, null);
            for (let m = 1; m < s.minutes; m++) row('session_heartbeat', s.startMs + m * MIN, m * MIN);
            row('session_ended', s.startMs + s.minutes * MIN, s.minutes * MIN);
        });
    })();
    db.close();
};
// Lo comparable entre dos lectores: estado, señales con valor, puntajes del perfil, riesgos y recomendaciones (sin ids ni fechas de cálculo).
const SCORES = ['persistencia_score', 'diversidad_score', 'engagement_score', 'abandono_risk'];
const sig = (j, id) => (j?.signals_current || []).find((s) => s.signal_id === id)?.metric_value ?? null;
const shape = (j) => JSON.stringify({ state: j?.data_state ?? null, reason: j?.reason ?? null,
    signals: Object.fromEntries((j?.signals_current || []).filter((s) => typeof s.metric_value === 'number').map((s) => [s.signal_id, s.metric_value]).sort()),
    profile: j?.profile_current ? Object.fromEntries(SCORES.map((k) => [k, j.profile_current[k] ?? null])) : null,
    risks: (j?.risks || []).map((r) => r.risk_type).sort(), recs: (j?.recommendations || []).map((r) => r.rule_id).sort() });
const brief = (j) => [j?.data_state ?? null, j?.reason ?? null, sig(j, 'tiempo_efectivo_lectura'), sig(j, 'continuidad_semanal') === null ? null : Math.round(sig(j, 'continuidad_semanal') * 7), sig(j, 'diversidad_lectora'), j?.profile_current?.engagement_score ?? null];
const metric = (x, k) => (x.json?.metrics || []).find((y) => y.metric_key === k)?.metric_value ?? null;
const cohortShape = (x) => JSON.stringify({ suppressed: x.json?.suppressed ?? null, by_state: x.json?.by_state ?? null,
    metrics: Object.fromEntries((x.json?.metrics || []).map((m) => [m.metric_key, m.metric_value]).sort()) });
const tl = (u, cookie) => both(`/api/aula-viva/students/${u}/timeline`, cookie);

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-b', 'lb-1', ...READERS_A]) C[id] = await login(id.length % 2 ? S1 : S2, id);

    section('[escritura] LU por la ruta real (alternando réplicas); la web, con las mismas fechas');
    const w = [], sent = {};
    let turn = 0;
    const sendLu = async (u, s) => { const evs = luSession(u, s.contentId, s.startMs, s.minutes); (sent[u] ||= []).push(evs); w.push(await post(turn++ % 2 ? S1 : S2, '/api/analytics/events', C[u], evs)); };
    for (const u of LU) for (const s of PLAN) await sendLu(u, s);
    for (const u of WEB) insertWebSessions(u, PLAN);
    // lu-pre / web-pre: 7 min de c1 hace cinco días (antes de constar como miembros). lu-b2c: 7 min de su obra personal.
    const PRE = [{ startMs: NOW - 5 * DAY, contentId: 'c1', minutes: 7 }];
    await sendLu('lu-pre', PRE[0]); insertWebSessions('web-pre', PRE);
    await sendLu('lu-b2c', { startMs: NOW - 2 * DAY, contentId: 'cp', minutes: 7 });
    await sendLu('lu-rev', PLAN[2]);
    // mix-1: la primera y la tercera sesión en LU; la segunda, en la web.
    await sendLu('mix-1', PLAN[0]); await sendLu('mix-1', PLAN[2]); insertWebSessions('mix-1', [PLAN[1]]);
    await sendLu('lb-1', { startMs: NOW - 1 * DAY, contentId: 'cb', minutes: 11 });
    // 65E-C3 — 12 min leídos sin conexión hace tres días (antes del cambio de contexto), sincronizados hoy.
    const OLD = { startMs: NOW - 3 * DAY, minutes: 12 };
    await sendLu('chg-work', { ...OLD, contentId: 'cc' });
    await sendLu('chg-mem', { ...OLD, contentId: 'c1' });
    // chg-ok: 12 min leídos sin conexión hace doce horas (después del cambio), sincronizados hoy.
    await sendLu('chg-ok', { startMs: NOW - 12 * 60 * MIN, contentId: 'cc', minutes: 12 });
    ok('todas las escrituras de LU aceptadas', w.every((x) => x.status === 200), w.filter((x) => x.status !== 200).map((x) => `${x.status} ${x.text.slice(0, 120)}`).join(' | '));

    section('[1] lector que solo lee en LU frente a lector con la misma lectura en la web');
    const tLu = await tl('lu-1', C['med-a']), tWeb = await tl('web-1', C['med-a']);
    {
        TABLA['lector LU [estado, motivo, min, días, obras, engagement]'] = brief(tLu[0].json);
        TABLA['lector web [estado, motivo, min, días, obras, engagement]'] = brief(tWeb[0].json);
        ok('el lector web tiene indicadores: 30 min, 3 días, 2 obras', tWeb.every((x) => x.status === 200 && x.json.data_state === 'ok' && sig(x.json, 'tiempo_efectivo_lectura') === PLAN_MIN && Math.round(sig(x.json, 'continuidad_semanal') * 7) === 3 && sig(x.json, 'diversidad_lectora') === 2), JSON.stringify(tWeb.map((x) => brief(x.json))));
        ok('el lector LU ya no sale «sin actividad»: tiene indicadores', tLu.every((x) => x.status === 200 && x.json.data_state === 'ok'), JSON.stringify(tLu.map((x) => [x.status, ...brief(x.json)])));
        ok('…los MISMOS que el lector web: señales, perfil, riesgos y recomendaciones', tLu.every((x) => shape(x.json) === shape(tWeb[0].json)), `${shape(tLu[0].json)}\n${shape(tWeb[0].json)}`);
        ok('…iguales en las dos réplicas', shape(tLu[0].json) === shape(tLu[1].json) && shape(tWeb[0].json) === shape(tWeb[1].json));
        ok('…con la fecha del dispositivo: última actividad ayer, no en el momento de sincronizar', tLu.every((x) => Math.abs((x.json.profile_current?.last_active_at ?? 0) - (PLAN[2].startMs + PLAN[2].minutes * MIN)) < 1000), String(tLu[0].json?.profile_current?.last_active_at));
        const evo = (x) => (x.json?.evolution || []).slice(-1)[0];
        ok('la trayectoria del lector LU tiene serie (último punto con eventos)', tLu.every((x) => (evo(x)?.events ?? 0) > 0), JSON.stringify(tLu.map(evo)));
        const fv = [await both('/api/aula-viva/students/lu-1/feature-vector', C['med-a']), await both('/api/aula-viva/students/web-1/feature-vector', C['med-a'])];
        const feats = (x) => JSON.stringify(x.json?.features ?? x.json?.feature_vector?.features ?? null);
        ok('vector de rasgos: el mismo para los dos', fv.flat().every((x) => x.status === 200) && feats(fv[0][0]) !== 'null' && fv[0].every((x) => feats(x) === feats(fv[1][0])), `${feats(fv[0][0])}\n${feats(fv[1][0])}`);
        const rc = [await both('/api/aula-viva/recommendations/scope/user/lu-1', C['med-a']), await both('/api/aula-viva/recommendations/scope/user/web-1', C['med-a'])];
        const rules = (x) => JSON.stringify((x.json?.recommendations ?? x.json ?? []).map?.((r) => r.rule_id).sort() ?? null);
        ok('recomendaciones: las mismas reglas para los dos', rc.flat().every((x) => x.status === 200) && rc[0].every((x) => rules(x) === rules(rc[1][0])), `${rules(rc[0][0])} ${rules(rc[1][0])}`);
        const pr = [await both('/api/aula-viva/institutional/profile/lu-1', C['med-a']), await both('/api/aula-viva/institutional/profile/web-1', C['med-a'])];
        ok('perfil institucional del lector: responde para los dos con el mismo estado', pr.flat().every((x) => x.status === 200) && pr[0].every((x) => (x.json?.data_state ?? null) === (pr[1][0].json?.data_state ?? null)), st(pr.flat()).slice(0, 600));
    }

    section('[2] curso de lectores LU frente a curso de lectores web');
    {
        const cLu = await both('/api/aula-viva/cohorts/group/g-lu', C['med-a']), cWeb = await both('/api/aula-viva/cohorts/group/g-web', C['med-a']);
        TABLA['agregado curso LU [activos, por estado]'] = [metric(cLu[0], 'active_users'), cLu[0].json?.by_state ?? null];
        TABLA['agregado curso web [activos, por estado]'] = [metric(cWeb[0], 'active_users'), cWeb[0].json?.by_state ?? null];
        ok('curso web: 5 lectores con indicadores', cWeb.every((x) => x.status === 200 && x.json.suppressed === false && x.json.by_state?.ok === 5), st(cWeb));
        ok('curso LU: sus 5 lectores con indicadores (ninguno «sin actividad»)', cLu.every((x) => x.status === 200 && x.json.suppressed === false && x.json.by_state?.ok === 5 && x.json.by_state?.no_activity === 0), JSON.stringify(cLu.map((x) => x.json?.by_state)));
        ok('…y el mismo agregado que el curso web (activos y promedios)', cLu.every((x) => cohortShape(x) === cohortShape(cWeb[0])) && metric(cLu[0], 'active_users') === 5, `${cohortShape(cLu[0])}\n${cohortShape(cWeb[0])}`);
        const rLu = await both('/api/aula-viva/cohorts/group/g-lu/rollups', C['med-a']), rWeb = await both('/api/aula-viva/cohorts/group/g-web/rollups', C['med-a']);
        const weekly = (x) => JSON.stringify((x.json?.weekly || []).map((p) => [p.metric_key, p.period_start ?? p.week_start ?? null, p.metric_value]).sort());
        ok('serie semanal del curso: la misma para LU y web, y no vacía', [...rLu, ...rWeb].every((x) => x.status === 200) && (rWeb[0].json?.weekly || []).length > 0 && rLu.every((x) => weekly(x) === weekly(rWeb[0])), `${weekly(rLu[0]).slice(0, 500)}\n${weekly(rWeb[0]).slice(0, 500)}`);
        const trj = async (g) => both(`/api/aula-viva/institutional/cohorts/${encodeURIComponent(`coh_group:${g}_v1`)}/trajectory`, C['med-a']);
        const jLu = await trj('g-lu'), jWeb = await trj('g-web');
        // El punto más reciente es el instante de cada consulta: se comparan los cortes semanales por fecha y todos por contenido.
        const series = (x) => JSON.stringify((x.json?.series || []).map((p, i) => [i === 0 ? 'ahora' : p.period_end, p.sample_size, p.metrics]));
        TABLA['trayectoria de cohorte · puntos entregados LU / web'] = [(jLu[0].json?.series || []).length, (jWeb[0].json?.series || []).length];
        ok('trayectoria de la cohorte web: con puntos (5 lectores)', jWeb.every((x) => x.status === 200 && (x.json.series || []).length > 0 && x.json.series[0].sample_size === 5), st(jWeb).slice(0, 500));
        ok('trayectoria de la cohorte LU: los mismos puntos, tamaños y promedios', jLu.every((x) => x.status === 200 && series(x) === series(jWeb[0])), `${series(jLu[0]).slice(0, 600)}\n${series(jWeb[0]).slice(0, 600)}`);
        const habit = async () => both(`/api/aula-viva/institutional/cohorts/${encodeURIComponent('coh_habit:high_continuity_v1')}/members`, C['med-a']);
        const hb = await habit();
        ok('cohortes tipadas: responden sin exponer lectores de otra institución', hb.every((x) => x.status === 200 && !x.text.includes('lb-1')), st(hb).slice(0, 400));
        const pat = await both('/api/aula-viva/institutional/patterns/recent', C['med-a']);
        ok('patrones: responden (misma evidencia de riesgo para LU y web ⇒ ningún patrón exclusivo de una fuente)', pat.every((x) => x.status === 200), st(pat).slice(0, 400));
        const att = await both('/api/aula-viva/students-needing-attention', C['med-a']);
        const ids = (x) => JSON.stringify(x.json ?? null);
        ok('lista de atención: ningún lector LU aparece por «sin actividad» mientras su par web no aparece', att.every((x) => x.status === 200 && LU.every((u, i) => ids(x).includes(`"${u}"`) === ids(x).includes(`"${WEB[i]}"`))), st(att).slice(0, 500));
    }

    section('[3] coherencia con el tablero y el resumen de Aula Viva');
    {
        const m = await both('/api/metrics/course/g-lu', C['med-a']), s = await both('/api/groups/g-lu/analytics-summary', C['med-a']), sw = await both('/api/groups/g-web/analytics-summary', C['med-a']);
        const row = (j, u) => (j?.studentBreakdown || []).find((q) => q.userId === u), rdr = (j, u) => (j?.readers || []).find((q) => q.userId === u);
        TABLA['lu-1 · minutos [contexto, Aula Viva 28 d, tablero] / sesiones tablero'] = [sig(tLu[0].json, 'tiempo_efectivo_lectura'), MINS(rdr(s[0].json, 'lu-1')?.reading.last28dEffectiveMs), MINS(row(m[0].json, 'lu-1')?.totalReadingTimeMs), row(m[0].json, 'lu-1')?.totalSessions ?? null];
        ok('lector LU: 30 minutos en el contexto, en Aula Viva (28 d) y en el tablero; 3 sesiones', m.every((x) => MINS(row(x.json, 'lu-1')?.totalReadingTimeMs) === PLAN_MIN && row(x.json, 'lu-1')?.totalSessions === 3) && s.every((x) => MINS(rdr(x.json, 'lu-1')?.reading.last28dEffectiveMs) === PLAN_MIN) && sig(tLu[0].json, 'tiempo_efectivo_lectura') === PLAN_MIN, JSON.stringify([row(m[0].json, 'lu-1'), rdr(s[0].json, 'lu-1')]).slice(0, 600));
        ok('lector web: los mismos 30 minutos en el contexto y en Aula Viva', sw.every((x) => MINS(rdr(x.json, 'web-1')?.reading.last28dEffectiveMs) === PLAN_MIN) && sig(tWeb[0].json, 'tiempo_efectivo_lectura') === PLAN_MIN);
        ok('activos del curso LU: 5 en el tablero, en Aula Viva y en el agregado contextual', m.every((x) => x.json.summary?.activeStudentCount === 5) && s.every((x) => x.json.reading?.last28d?.readersWithActivity === 5), JSON.stringify([m[0].json?.summary, s[0].json?.reading?.last28d]));
    }

    section('[4] sin doble conteo');
    {
        const again = [];
        for (const evs of sent['lu-2']) { again.push(await post(S1, '/api/analytics/events', C['lu-2'], evs)); again.push(await post(S2, '/api/analytics/events', C['lu-2'], evs)); }
        ok('reenvío completo de las tres sesiones por las dos réplicas: nada nuevo', again.every((x) => x.status === 200 && x.json.received === 0), st(again).slice(0, 400));
        const t2 = await tl('lu-2', C['med-a']);
        ok('…y los indicadores del lector no cambian (30 min, 3 días)', t2.every((x) => shape(x.json) === shape(tWeb[0].json)), `${shape(t2[0].json)}`);
        const copies = sql(P.events, `SELECT COUNT(*) n FROM events WHERE user_id = 'lu-1' AND event LIKE 'lu.read_session_%'`)[0].n, mem = stored().filter((e) => e.userId === 'lu-1').length;
        ok('la sesión está a la vez en la memoria rodante y en la copia conservada (33 hechos en cada una) y cuenta UNA vez', copies === 33 && mem === 33 && sig(tLu[0].json, 'tiempo_efectivo_lectura') === PLAN_MIN, `${copies} ${mem}`);
        const tm = await tl('mix-1', C['med-a']);
        TABLA['mix-1 (LU + web) [estado, motivo, min, días, obras, engagement]'] = brief(tm[0].json);
        ok('quien lee dos sesiones en LU y una en la web: los mismos 30 min, 3 días y 2 obras (ni más ni menos)', tm.every((x) => x.status === 200 && shape(x.json) === shape(tWeb[0].json)), `${shape(tm[0].json)}\n${shape(tWeb[0].json)}`);
        const Mat = await import('../services/insightMaterializer.mjs');
        const h = Mat.readOwnEventHistory('lu-1', NOW - 28 * DAY); Mat.closeMaterializerEventsDb();
        ok('la historia de eventos propia del lector LU sigue sin incluir la copia (las señales globales no cambian de entradas)', h.length === 0, String(h.length));
    }

    section('[5] telemetría rodada');
    {
        // La memoria rodante ya no guarda nada de lu-3 (lo que ocurre al superar los 50 000 eventos): queda su copia.
        const kept = stored().filter((e) => e.userId !== 'lu-3');
        fs.writeFileSync(`${P.analytics}.seed.tmp`, JSON.stringify(kept)); fs.renameSync(`${P.analytics}.seed.tmp`, P.analytics);
        await sleep(2300);
        const t3 = await tl('lu-3', C['med-a']);
        ok('la memoria rodante ya no tiene eventos del lector', stored().every((e) => e.userId !== 'lu-3'));
        ok('…y sus indicadores contextuales son los mismos (30 min, 3 días), en las dos réplicas', t3.every((x) => x.status === 200 && shape(x.json) === shape(tWeb[0].json)), `${shape(t3[0].json)}`);
        const again = await post(S1, '/api/analytics/events', C['lu-3'], sent['lu-3'][0]);
        const t3b = await tl('lu-3', C['med-a']);
        ok('reenvío posterior a la rotación (la memoria lo acepta de nuevo): sigue siendo la misma lectura', again.status === 200 && again.json.received === sent['lu-3'][0].length && t3b.every((x) => shape(x.json) === shape(tWeb[0].json)), `${again.text} ${shape(t3b[0].json)}`);
        const c = await both('/api/aula-viva/cohorts/group/g-lu', C['med-a']);
        ok('…y el agregado del curso conserva sus 5 lectores con indicadores', c.every((x) => x.json?.by_state?.ok === 5), JSON.stringify(c.map((x) => x.json?.by_state)));
    }

    section('[6] histórico sin constancia de recepción');
    {
        const to = await tl('lu-old', C['med-a']), tn = await tl('r-none', C['med-a']);
        TABLA['lu-old (LU sin constancia) [estado, motivo]'] = [to[0].json?.data_state ?? null, to[0].json?.reason ?? null];
        TABLA['r-none (no lee) [estado, motivo]'] = [tn[0].json?.data_state ?? null, tn[0].json?.reason ?? null];
        ok('LU sin constancia sobre una obra del curso: «información insuficiente» (historial no comprobable), sin perfil ni riesgo', to.every((x) => x.status === 200 && x.json.data_state === 'insufficient' && x.json.reason === 'unverifiable_history' && x.json.profile_current === null && (x.json.risks || []).length === 0), JSON.stringify(to.map((x) => brief(x.json))));
        ok('…con su explicación en la tarjeta de estado y sin minutos acreditados', to.every((x) => (x.json.summaries || []).some((c) => c.id === 'context_unverifiable_history') && sig(x.json, 'tiempo_efectivo_lectura') === null), JSON.stringify(to[0].json?.summaries?.map((c) => c.id)));
        ok('quien no ha leído: «sin actividad» (un estado distinto)', tn.every((x) => x.status === 200 && x.json.data_state === 'no_activity'), JSON.stringify(tn.map((x) => brief(x.json))));
        const s = await both('/api/groups/g-x/analytics-summary', C['med-a']);
        const rdr = (j, u) => (j?.readers || []).find((q) => q.userId === u);
        ok('…coherente con Aula Viva: 0 minutos con la marca de lectura no atribuible', s.every((x) => rdr(x.json, 'lu-old')?.reading.allEffectiveMs === 0 && rdr(x.json, 'lu-old')?.historicalActivity === true), JSON.stringify(s.map((x) => rdr(x.json, 'lu-old'))));
        // Reenviar ahora la misma sesión no la convierte en acreditada con su fecha antigua (ya está guardada sin constancia).
        const old = stored().filter((e) => e.userId === 'lu-old');
        const re = await post(S2, '/api/analytics/events', C['lu-old'], old.map(({ receivedAt, ...e }) => e));
        const to2 = await tl('lu-old', C['med-a']);
        ok('reenviarla hoy no la acredita: sigue «insuficiente»', re.status === 200 && re.json.received === 0 && to2.every((x) => x.json.data_state === 'insufficient'), `${re.text} ${JSON.stringify(to2.map((x) => brief(x.json)))}`);
        const fut = await post(S1, '/api/analytics/events', C['r-none'], luSession('r-none', 'c1', Date.now() + 3 * DAY, 5));
        const tn2 = await tl('r-none', C['med-a']);
        ok('una sesión de LU fechada en el futuro no se guarda ni se acredita', fut.status === 200 && tn2.every((x) => x.json.data_state === 'no_activity') && sql(P.events, `SELECT COUNT(*) n FROM events WHERE user_id = 'r-none' AND event LIKE 'lu.read_session_%' AND server_ts < client_ts - 300000`)[0].n === 0, `${fut.text} ${JSON.stringify(tn2.map((x) => brief(x.json)))}`);
    }

    section('[7] periodo: lectura anterior al ingreso al curso');
    {
        const a = await tl('lu-pre', C['med-a']), b = await tl('web-pre', C['med-a']);
        TABLA['lectura anterior al ingreso · LU / web [estado, motivo]'] = [[a[0].json?.data_state ?? null, a[0].json?.reason ?? null], [b[0].json?.data_state ?? null, b[0].json?.reason ?? null]];
        ok('la lectura web anterior al ingreso no da indicadores', b.every((x) => x.status === 200 && x.json.data_state !== 'ok' && x.json.profile_current === null), JSON.stringify(b.map((x) => brief(x.json))));
        ok('la lectura de LU anterior al ingreso recibe exactamente el mismo trato (por la fecha del dispositivo, no la de sincronización)', a.every((x) => x.status === 200 && shape(x.json) === shape(b[0].json)), `${shape(a[0].json)}\n${shape(b[0].json)}`);
    }

    section('[8] lectura personal (B2C) en LU');
    {
        const t = await tl('lu-b2c', C['med-a']);
        TABLA['lu-b2c (LU sobre obra personal) [estado, motivo]'] = [t[0].json?.data_state ?? null, t[0].json?.reason ?? null];
        ok('7 min de LU sobre su obra personal: nada entra en el contexto del curso («sin actividad» en las obras del curso)', t.every((x) => x.status === 200 && x.json.data_state === 'no_activity' && x.json.profile_current === null), JSON.stringify(t.map((x) => brief(x.json))));
        ok('…y la obra personal no aparece en ninguna parte de la respuesta', t.every((x) => !/"cp"/.test(x.text)));
        const c = await both('/api/aula-viva/cohorts/group/g-x', C['med-a']);
        ok('…ni cuenta como activo en el agregado del curso', c.every((x) => x.status === 200 && !/"cp"/.test(x.text)), st(c).slice(0, 300));
    }

    section('[9] otra institución, A2 y C005');
    {
        const cross = [...await tl('lb-1', C['med-a']), ...await both('/api/aula-viva/cohorts/group/g-b', C['med-a']), ...await tl('lu-1', C['med-b']), ...await both('/api/aula-viva/cohorts/group/g-lu', C['med-b'])];
        ok('el mediador de una institución no consulta lectores ni cursos de la otra (403)', cross.every((x) => x.status === 403), st(cross).slice(0, 500));
        const own = await tl('lb-1', C['med-b']);
        ok('la otra institución ve la lectura de LU de su lector (11 min) y nada de la primera', own.every((x) => x.status === 200 && sig(x.json, 'tiempo_efectivo_lectura') === 11 && !/lu-\d|web-\d|"c1"/.test(x.text)), JSON.stringify(own.map((x) => brief(x.json))));
        const self = await tl('lu-1', C['lu-2']);
        ok('un lector no consulta los indicadores de otro', self.every((x) => x.status === 403), st(self).slice(0, 200));
        const before = await tl('lu-rev', C['med-a']);
        grantA2(['lu-rev'], 'revoked');
        const after = await tl('lu-rev', C['med-a']), cx = await both('/api/aula-viva/cohorts/group/g-x', C['med-a']);
        ok('A2 revocada: la lectura de LU del lector deja de entregarse (antes 200 con indicadores, después 403), en las dos réplicas', before.every((x) => x.status === 200 && x.json.data_state === 'ok') && after.every((x) => x.status === 403), `${st(before).slice(0, 200)} → ${st(after).slice(0, 200)}`);
        ok('…y no figura en el agregado del curso', cx.every((x) => x.status === 200 && !x.text.includes('lu-rev')));
        grantC005(['med-a'], { status: 'revoked' });
        const noC = [...await tl('lu-1', C['med-a']), ...await both('/api/aula-viva/cohorts/group/g-lu', C['med-a'])];
        ok('C005 del mediador revocado: ni indicadores individuales (403) ni cifras del curso (ningún lector elegible, sin métricas)', noC.slice(0, 2).every((x) => x.status === 403) && noC.slice(2).every((x) => x.status === 403 || (x.json?.suppressed === true && x.json.population?.eligible === 0 && (x.json.metrics || []).length === 0)), st(noC).slice(0, 400));
        grantC005(['med-a']);
        const back = await tl('lu-1', C['med-a']);
        ok('…y con el compromiso vigente de nuevo, los mismos indicadores que antes', back.every((x) => x.status === 200 && shape(x.json) === shape(tWeb[0].json)), st(back).slice(0, 300));
    }

    section('[11] fecha declarada anterior a un cambio del contexto (65A en todas las superficies)');
    {
        const row = (j, u) => (j?.studentBreakdown || []).find((q) => q.userId === u), rdr = (j, u) => (j?.readers || []).find((q) => q.userId === u);
        const surfaces = async (u) => {
            const m = await both('/api/metrics/course/g-x', C['med-a']), s = await both('/api/groups/g-x/analytics-summary', C['med-a']), t = await tl(u, C['med-a']);
            const rc = await both(`/api/aula-viva/recommendations/scope/user/${u}`, C['med-a']);
            return { m, s, t, rc, brief: [row(m[0].json, u)?.totalSessions ?? null, MINS(row(m[0].json, u)?.totalReadingTimeMs), row(m[0].json, u)?.dataState ?? null, MINS(rdr(s[0].json, u)?.reading.allEffectiveMs), rdr(s[0].json, u)?.historicalActivity === true, t[0].json?.data_state ?? null, t[0].json?.reason ?? null] };
        };
        const uncredited = (x, u) => x.m.every((q) => row(q.json, u)?.totalSessions === 0 && row(q.json, u)?.dataState === 'unverifiable_history' && row(q.json, u)?.needsAttention === false)
            && x.s.every((q) => rdr(q.json, u)?.reading.allEffectiveMs === 0 && rdr(q.json, u)?.historicalActivity === true)
            && x.t.every((q) => q.status === 200 && q.json.data_state === 'insufficient' && q.json.reason === 'unverifiable_history' && q.json.profile_current === null && (q.json.recommendations || []).length === 0)
            && x.rc.every((q) => q.status === 200 && JSON.stringify(q.json?.recommendations ?? q.json ?? []) === '[]');
        const w = await surfaces('chg-work'), mm = await surfaces('chg-mem'), okr = await surfaces('chg-ok');
        TABLA['obra retirada y reasociada tras la lectura [sesiones, min, estado tablero, min Aula Viva, no atribuible, estado contexto, motivo]'] = w.brief;
        TABLA['lector que salió y volvió tras la lectura  [sesiones, min, estado tablero, min Aula Viva, no atribuible, estado contexto, motivo]'] = mm.brief;
        TABLA['lectura sin conexión con contexto estable    [sesiones, min, estado tablero, min Aula Viva, no atribuible, estado contexto, motivo]'] = okr.brief;
        ok('obra retirada del curso y vuelta a asociar DESPUÉS de la lectura: sin acreditar en tablero, Aula Viva, trayectoria y recomendaciones («no atribuible», nunca «sin actividad» ni minutos), en las dos réplicas', uncredited(w, 'chg-work'), JSON.stringify(w.brief));
        ok('lector que salió del curso y volvió DESPUÉS de la lectura: el mismo resultado en las cuatro superficies', uncredited(mm, 'chg-mem'), JSON.stringify(mm.brief));
        ok('la lectura sin conexión con el contexto estable hasta la recepción SÍ se acredita, igual en todas: 1 sesión, 12 min', okr.m.every((q) => row(q.json, 'chg-ok')?.totalSessions === 1 && MINS(row(q.json, 'chg-ok')?.totalReadingTimeMs) === 12 && row(q.json, 'chg-ok')?.dataState === 'verified_context')
            && okr.s.every((q) => MINS(rdr(q.json, 'chg-ok')?.reading.allEffectiveMs) === 12) && okr.t.every((q) => q.json.data_state === 'ok' && sig(q.json, 'tiempo_efectivo_lectura') === 12), JSON.stringify(okr.brief));
        const c = await both('/api/aula-viva/cohorts/group/g-x', C['med-a']);
        ok('agregado del curso: esos dos lectores cuentan como «no atribuible», aparte de los activos', c.every((x) => x.status === 200 && x.json.suppressed === false && metric(x, 'readers_with_unattributable_activity') >= 2), JSON.stringify(c.map((x) => [x.json?.by_state, x.json?.metrics])).slice(0, 500));
        ok('la lectura queda conservada como del lector (su copia en events.db), solo sin atribución al curso', sql(P.events, `SELECT COUNT(*) n FROM events WHERE user_id = 'chg-work' AND event LIKE 'lu.read_session_%'`)[0].n === 13);
        // Sin acreditación posterior: ni reenviando lo mismo ni enviándolo como si fuera otra sesión con las mismas fechas.
        const again = await post(S1, '/api/analytics/events', C['chg-work'], sent['chg-work'][0]);
        const fresh = await post(S2, '/api/analytics/events', C['chg-work'], luSession('chg-work', 'cc', NOW - 3 * DAY, 12));
        const w2 = await surfaces('chg-work');
        ok('reenviarla, o enviarla de nuevo con otros identificadores y las mismas fechas, no la acredita después', again.json?.received === 0 && fresh.status === 200 && uncredited(w2, 'chg-work'), `${again.text} ${fresh.text} ${JSON.stringify(w2.brief)}`);
        const adm = await both('/api/metrics/course/g-x', C.adm);
        const medActive = w2.m[0].json?.summary?.activeStudentCount ?? null;
        TABLA['curso g-x · lectores activos [mediación, administración]'] = [medActive, adm[0].json?.summary?.activeStudentCount ?? null];
        ok('la administración (obras del curso, sin atribución por fechas) sigue contando esa lectura como actividad: al menos dos activos más que la mediación', adm.every((x) => x.status === 200 && Number.isFinite(medActive) && x.json.summary?.activeStudentCount >= medActive + 2), JSON.stringify(adm.map((x) => [x.status, x.json?.summary])).slice(0, 400));
    }

    section('[12] administración frente a mediación: actividad observada y lectura acreditada');
    {
        const rdr = (j, u) => (j?.readers || []).find((q) => q.userId === u);
        const shape = (x) => JSON.stringify([x.json?.activityBasis ?? null, x.json?.creditedReading ?? null]);
        // Curso con el contexto CAMBIADO para dos lectores (g-x).
        const adm = await both('/api/metrics/course/g-x', C.adm), med = await both('/api/metrics/course/g-x', C['med-a']);
        const cr = adm[0].json?.creditedReading, ms = med[0].json?.summary, ma = med[0].json?.courseAttribution;
        TABLA['g-x (contexto cambiado) · tablero [activos observados (adm), activos acreditados (adm), activos (mediación), no atribuibles adm / mediación]'] = [adm[0].json?.summary?.activeStudentCount ?? null, cr?.activeStudentCount ?? null, ms?.activeStudentCount ?? null, cr?.readers_with_unattributable_reading ?? null, ma?.readers_with_unverifiable_history ?? null];
        ok('la administración recibe sus cifras con nombre y procedencia: actividad observada en las obras del curso, sin acreditar', adm.every((x) => x.status === 200 && x.json.activityBasis?.kind === 'observed_activity' && x.json.activityBasis.credited === false && x.json.activityBasis.scope === 'course_works' && x.json.activityBasis.dated === false), shape(adm[0]));
        ok('…y, aparte, la lectura acreditada con la regla 65A', adm.every((x) => x.json.creditedReading?.rule === '65A' && x.json.creditedReading.available === true), shape(adm[0]));
        ok('con el contexto cambiado las dos cifras DIFIEREN: más actividad observada que lectura acreditada', adm.every((x) => x.json.summary.activeStudentCount > x.json.creditedReading.activeStudentCount), JSON.stringify(adm.map((x) => [x.json.summary.activeStudentCount, x.json.creditedReading.activeStudentCount])));
        // La administración agrega el curso completo; la mediación no ve a lu-rev (A2 revocada en [9]), que tiene lectura
        // acreditada. Misma regla, una persona de diferencia en la población: se comprueba esa diferencia exacta.
        ok('la lectura acreditada de la administración sigue la MISMA regla que la mediación: mismos lectores con lectura no atribuible, y sus activos = los de la mediación + el lector que la mediación no ve por A2 revocada', adm.every((x) => x.json.creditedReading.activeStudentCount === ms.activeStudentCount + 1 && x.json.creditedReading.readers_with_unattributable_reading === ma.readers_with_unverifiable_history) && !med[0].text.includes('lu-rev'), `${JSON.stringify(cr)} ${JSON.stringify([ms?.activeStudentCount, ma])}`);
        ok('igual en las dos réplicas', shape(adm[0]) === shape(adm[1]));
        ok('la respuesta de la mediación no lleva la marca de actividad observada: sus cifras ya son las acreditadas', med.every((x) => x.status === 200 && x.json.activityBasis === undefined && x.json.creditedReading === undefined));
        ok('la administración sigue sin recibir el desglose por lector', adm.every((x) => x.json.aggregateOnly === true && x.json.studentBreakdown === undefined && !/chg-work|chg-mem/.test(x.text)));
        // Resumen de Aula Viva.
        const sa = await both('/api/groups/g-x/analytics-summary', C.adm), sm = await both('/api/groups/g-x/analytics-summary', C['med-a']);
        const medActive = (sm[0].json?.readers || []).filter((q) => (q.reading?.allEffectiveMs ?? 0) > 0).length, medMs = (sm[0].json?.readers || []).reduce((n, q) => n + (q.reading?.allEffectiveMs ?? 0), 0);
        const scr = sa[0].json?.creditedReading;
        TABLA['g-x · resumen de Aula Viva [lectores con lectura observados (adm), acreditados (adm), mediación; minutos observados, acreditados]'] = [sa[0].json?.reading?.all?.readersWithActivity ?? null, scr?.readersWithActivity ?? null, medActive, MINS(sa[0].json?.reading?.all?.totalEffectiveMs), MINS(scr?.totalEffectiveMs)];
        ok('resumen de Aula Viva de la administración: actividad observada, con la lectura acreditada aparte', sa.every((x) => x.status === 200 && x.json.activityBasis?.kind === 'observed_activity' && x.json.creditedReading?.available === true), shape(sa[0]));
        ok('…acreditada = la de la mediación (mismos lectores con lectura y mismos minutos)', sa.every((x) => x.json.creditedReading.readersWithActivity === medActive && x.json.creditedReading.totalEffectiveMs === medMs), `${JSON.stringify(scr)} ${medActive} ${medMs}`);
        ok('…los 24 minutos de las dos lecturas con contexto cambiado están en lo observado y NO en lo acreditado', sa.every((x) => MINS(x.json.reading.all.totalEffectiveMs) - MINS(x.json.creditedReading.totalEffectiveMs) >= 24 && x.json.creditedReading.readers_with_unattributable_reading >= 2), JSON.stringify([MINS(sa[0].json?.reading?.all?.totalEffectiveMs), scr]));
        ok('…sin doble conteo: el lector de contexto estable cuenta lo mismo en las dos (12 min)', MINS(rdr(sa[0].json, 'chg-ok')?.reading.allEffectiveMs ?? rdr(sm[0].json, 'chg-ok')?.reading.allEffectiveMs) === 12 && MINS(rdr(sm[0].json, 'chg-ok')?.reading.allEffectiveMs) === 12);
        // Curso con el contexto ESTABLE (g-lu): observado y acreditado coinciden.
        const al = await both('/api/metrics/course/g-lu', C.adm), sl = await both('/api/groups/g-lu/analytics-summary', C.adm);
        TABLA['g-lu (contexto estable) · [activos observados, activos acreditados; lectores observados, acreditados]'] = [al[0].json?.summary?.activeStudentCount ?? null, al[0].json?.creditedReading?.activeStudentCount ?? null, sl[0].json?.reading?.all?.readersWithActivity ?? null, sl[0].json?.creditedReading?.readersWithActivity ?? null];
        ok('con el contexto estable, lo observado y lo acreditado coinciden (5 y 5) en tablero y resumen', al.every((x) => x.json.summary.activeStudentCount === 5 && x.json.creditedReading.activeStudentCount === 5 && x.json.creditedReading.readers_with_unattributable_reading === 0)
            && sl.every((x) => x.json.reading.all.readersWithActivity === 5 && x.json.creditedReading.readersWithActivity === 5 && x.json.creditedReading.totalEffectiveMs === x.json.reading.all.totalEffectiveMs), JSON.stringify([al[0].json?.creditedReading, sl[0].json?.creditedReading]));
        // Informe del curso y agregado del colegio.
        const rep = await both('/api/reports/course/g-x', C.adm);
        ok('el informe del curso lleva la misma distinción que el tablero', rep.every((x) => x.status === 200 && x.json.activityBasis?.kind === 'observed_activity' && x.json.creditedReading?.activeStudentCount === cr?.activeStudentCount), st(rep).slice(0, 300));
        const sch = await both('/api/metrics/school/' + encodeURIComponent('Colegio Alfa'), C.adm);
        ok('el agregado del colegio se declara actividad observada; la lectura acreditada se remite a cada curso', sch.every((x) => x.status === 200 && x.json.activityBasis?.kind === 'observed_activity' && x.json.creditedReading?.available === false && x.json.creditedReading.reason === 'per_course_only'), st(sch).slice(0, 300));
        const cross = [...await both('/api/metrics/course/g-b', C['med-a']), ...await both('/api/groups/g-b/analytics-summary', C['med-a'])];
        ok('el aislamiento por institución no cambia: el mediador de una no consulta el curso de la otra', cross.every((x) => x.status === 403));
    }

    section('[10] reinicio de una réplica');
    {
        S2.child.kill('SIGTERM'); await new Promise((res) => S2.child.once('exit', res));
        S2 = start(ports[1], 2); await ready(S2);
        const t = await tl('lu-1', C['med-a']), c = await both('/api/aula-viva/cohorts/group/g-lu', C['med-a']);
        ok('tras reiniciar una réplica: mismos indicadores del lector LU y mismo agregado en las dos', t.every((x) => x.status === 200 && shape(x.json) === shape(tWeb[0].json)) && cohortShape(c[0]) === cohortShape(c[1]) && c.every((x) => x.json?.by_state?.ok === 5), `${shape(t[1].json)} ${cohortShape(c[1])}`);
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA, null, 1)}`);
console.log(`\nluContextHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
