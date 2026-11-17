/**
 * contextualFollowUpHttp.test.mjs — CHP V9 F7-C2R-U2.
 *
 * Seguimiento individual de Aula Viva para mediadores sobre el contexto pedagógico (U1). Las rutas EXISTENTES del
 * Centro operativo (timeline, vector, historial de riesgo, series, recomendaciones y su marcado, cola de atención,
 * estado) responden a quien media con indicadores calculados solo con la actividad fechada del curso; el perfil global
 * del lector no se entrega (lleva una marca, 0.8125 / «marca-<lector>», que delataría cualquier fuga).
 *
 * Dos instituciones y una tercera con un curso sin obras; dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce,
 * cookies de /api/auth/login, events.db e insights.db compartidos y el registro de procedencia encendido; una tercera
 * réplica con el registro apagado.
 *   [1][2] perfil solo del curso; la lectura personal no lo altera   [7] marcado autorizado y no autorizado
 *   [3] obras compartidas                                            [8] timeline longitudinal y perfil institucional
 *   [4] historial no verificable                                     [9] revocación inmediata de A2 / C005
 *   [5] indicadores y recomendaciones reales; estados sin datos      [10] lector, B2C y administración
 *   [6] cola de atención                                             [12] almacén global intacto
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/contextualFollowUpHttp.test.mjs
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
    console.log('contextualFollowUpHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u2_'));
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
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), '[]');
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

// ra-1: obra del curso (c1), compra personal (c3, con muchos abandonos), obra del club (c4) y obra compartida (cs).
for (const d of [20, 12, 6, 3]) read('ra-1', 'c1', d);
for (const d of [18, 17, 16, 9, 8, 4]) abandon('ra-1', 'c3', d);
read('ra-1', 'c3', 2, 300);
read('ra-1', 'c4', 7); read('ra-1', 'cs', 5);
// ra-2: abandono alto DENTRO del curso desde hace casi dos semanas (riesgo con fecha y recomendación).
// Mediodía UTC de un día: varios abandonos caen en la MISMA fecha sea cual sea la hora a la que corra la suite.
const noon = (d) => Math.floor(at(d) / DAY) * DAY + DAY / 2;
const abandonsOn = (u, c, d) => { for (const k of [0, 1, 2]) { const t = noon(d) + k * 600_000; ev(u, c, 'reading_started', t); ev(u, c, 'reading_abandoned', t + 30_000, { payload: { percentage: 3 } }); } };
abandonsOn('ra-2', 'c1', 13); abandonsOn('ra-2', 'c1', 12);
// ra-3: abandonó hace siete semanas y después retomó la lectura a diario (un episodio de riesgo ya resuelto).
abandonsOn('ra-3', 'c1', 50); abandonsOn('ra-3', 'c1', 49);
for (const d of [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]) read('ra-3', 'c1', d);
// ra-4: su membresía solo consta desde ayer (historia no verificable).  ra-5: una sola fila.  ra-6: nada.
read('ra-4', 'c1', 6);
ev('ra-5', 'c1', 'session_started', at(3));
// ra-7: abandono alto reciente en el curso (para descartar y para registrar una intervención).
abandonsOn('ra-7', 'c1', 6); abandonsOn('ra-7', 'c1', 5);
read('ra-z', 'c3', 4); read('ra-z', 'c3', 2);
read('rb-1', 'cb', 3);
read('b2c-1', 'c3', 3);

// ── Procedencia: línea base hace 100 días (cubre los cortes semanales de la evolución) ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const snapshot = () => GROUPS().map((g) => ({ groupId: g.id, works: RULES().filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds }));
const seeded = Ledger.observeContext(snapshot(), { nowTs: at(100) });
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
const idb = getInsightsExtDb();
idb.prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id = 'ra-4'`).run(at(1));

// ── Almacén GLOBAL con una marca (0.8125 / «marca-<lector>») que solo puede salir de él: si un mediador la ve, hay fuga ──
const MARK = 0.8125;
const Ped = await import('../db/pedagogyDbExt.mjs'), Rol = await import('../db/rollupsDbExt.mjs');
const pdb = Ped.getPedagogyExtDb(), rdb = Rol.getRollupsExtDb();
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
for (const u of [...GA, 'ra-z', 'rb-1']) {
    insertRow(idb, 'user_reading_profiles', { user_id: u, abandono_risk: MARK, engagement_score: MARK, persistencia_score: MARK, last_active_at: NOW - DAY, updated_at: NOW, source_watermark: 1 });
    insertRow(idb, 'signal_snapshots', { scope_type: 'user', scope_id: u, signal_id: 'continuidad_semanal', period: '28d', metric_value: MARK, updated_at: NOW, metadata_json: JSON.stringify({ who: `marca-${u}` }) });
    insertRow(rdb, 'feature_vectors', { user_id: u, vector_version: 1, period: '28d', period_end: NOW, features_json: JSON.stringify({ who: `marca-${u}`, f: MARK }) });
    insertRow(pdb, 'pedagogical_risk_history', { user_id: u, risk_type: 'marca_global', source_signals_json: JSON.stringify({ who: `marca-${u}` }) });
    insertRow(pdb, 'pedagogical_recommendations', { recommendation_id: `rec-global-${u}`, scope_type: 'user', scope_id: u, rule_id: 'marca_global', recommendation_type: 'lectura_guiada', severity: 'critical',
        created_at: NOW, expires_at: NOW + DAY, explanation_json: JSON.stringify({ who: `marca-${u}` }), rule_ids_json: '["marca_global"]' });
}
const globalDigest = () => JSON.stringify([
    idb.prepare('SELECT user_id, abandono_risk, engagement_score, updated_at FROM user_reading_profiles ORDER BY user_id').all(),
    idb.prepare(`SELECT scope_id, signal_id, metric_value FROM signal_snapshots ORDER BY scope_id, signal_id`).all(),
    rdb.prepare('SELECT user_id, features_json FROM feature_vectors ORDER BY user_id').all(),
    pdb.prepare('SELECT risk_id, resolved_at FROM pedagogical_risk_history ORDER BY risk_id').all(),
    pdb.prepare(`SELECT recommendation_id, acknowledged, applied FROM pedagogical_recommendations WHERE recommendation_id NOT LIKE 'ctx.%' ORDER BY recommendation_id`).all(),
]);
const GLOBAL_BEFORE = globalDigest();
const ctxRows = () => pdb.prepare(`SELECT recommendation_id, scope_type, scope_id, rule_id, acknowledged, acknowledged_at, acknowledged_by, applied, applied_at FROM pedagogical_recommendations WHERE recommendation_id LIKE 'ctx.%' ORDER BY id`).all();

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
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 200)}`).join(' | ');
const AV = '/api/aula-viva';
const TL = (u) => `${AV}/students/${u}/timeline`, FV = (u) => `${AV}/students/${u}/feature-vector`, RH = (u) => `${AV}/students/${u}/risk-history`,
    SG = (u, s) => `${AV}/students/${u}/signals/${s}/timeline`, RECS = (u) => `${AV}/recommendations/scope/user/${u}`, QUEUE = `${AV}/students-needing-attention`, STATUS = `${AV}/operational/status`;
const LEAK = /0\.8125|marca[-_]/;
const clean = (rs) => rs.every((r) => !LEAK.test(r.text));
const all200 = (rs) => rs.every((r) => r.status === 200);
const denied = (r) => r.status === 403 && r.json?.error === 'scope_access_denied' && !LEAK.test(r.text);
// Lo que no depende del instante exacto de la petición.
const stableTl = (j) => JSON.stringify(j && { s: j.data_state, r: j.reason, c: j.context, p: j.profile_current && { ...j.profile_current, updated_at: 0 },
    sig: (j.signals_current || []).map((x) => [x.signal_id, x.metric_value, x.confidence]), risks: (j.risks || []).map((x) => [x.risk_id, x.detected_at, x.resolved_at]),
    recs: (j.recommendations || []).map((x) => [x.recommendation_id, x.acknowledged, x.applied]), sum: (j.summaries || []).map((x) => x.id), prov: j.provenance?.digest ?? null,
    evo: (j.evolution || []).slice(0, -1) });
const agree = (rs) => all200(rs) && stableTl(rs[0].json) === stableTl(rs[1].json);
const sig = (j, id) => j?.signals_current?.find((s) => s.signal_id === id)?.metric_value;
const noDiag = (j) => j.profile_current === null && j.risks.length === 0 && j.recommendations.length === 0;
const View = await import('../aulaViva/contextualView.mjs');

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'ra-2', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base sembrada; las réplicas no observan nada distinto', seeded.ok && seeded.baseline
        && idb.prepare(`SELECT COUNT(*) AS n FROM pedagogical_context_intervals WHERE origin = 'observed'`).get().n === 0);
    ok('preparación: la administración ve el perfil GLOBAL (con la marca)', (await both(TL('ra-2'), C.adm)).every((r) => r.status === 200 && r.json?.profile_current?.abandono_risk === MARK));

    section('[1] perfil calculado solo con actividad del curso · [2] la lectura personal no lo altera');
    let tl1;
    {
        const rs = await both(TL('ra-1'), C['med-a']);
        tl1 = rs[0].json;
        ok('timeline 200, igual en las dos réplicas, sin rastro del perfil global', agree(rs) && clean(rs) && tl1.data_state === 'ok', st(rs));
        ok('perfil y señales del contexto: 2 obras (c1 y cs), sin los abandonos de la compra personal', sig(tl1, 'diversidad_lectora') === 2 && sig(tl1, 'abandono_temprano') === 0
            && tl1.provenance.events === count('ra-1', (r) => r.content_id === 'c1' || r.content_id === 'cs') && typeof tl1.profile_current.engagement_score === 'number');
        const ABANDON = ['abandono_alto', 'fatiga_lectora'];
        ok('sin recomendación ni riesgo de abandono atribuidos por la lectura personal', !tl1.risks.some((r) => ABANDON.includes(r.risk_type)) && !tl1.recommendations.some((r) => ABANDON.includes(r.rule_id)), JSON.stringify(tl1.recommendations.map((r) => r.rule_id)));
        ok('lleva contexto, ventana y estado; no nombra obras ajenas', tl1.context.groups[0].group_id === 'g-a' && tl1.window.days === 28 && !/"c3"|"c4"/.test(rs[0].text));
        ok('conserva la forma que usa la pantalla', ['user_id', 'profile_current', 'signals_current', 'risks', 'recommendations', 'summaries', 'experience_insights'].every((k) => k in tl1)
            && 'experiencias_iniciadas' in tl1.experience_insights);
        const fv = await both(FV('ra-1'), C['med-a']);
        ok('vector de rasgos del contexto', all200(fv) && clean(fv) && fv[0].json.features.diversidad === tl1.profile_current.diversidad_score && fv[0].json.features.progression_slope === null && fv[0].json.data_state === 'ok', st(fv));
        for (let i = 0; i < 30; i++) abandon('ra-1', 'c3', 1 + i * 0.4);
        read('ra-1', 'c3', 0.2, 240);
        const again = await both(TL('ra-1'), C['med-a']), fv2 = await both(FV('ra-1'), C['med-a']);
        ok('30 abandonos y una lectura larga personales: timeline y vector idénticos', agree(again) && stableTl(again[0].json) === stableTl(tl1) && JSON.stringify(fv2[0].json.features) === JSON.stringify(fv[0].json.features), st(again));
    }

    section('[3] obras compartidas con delimitación correcta');
    {
        const rs = await both(TL('ra-1'), C['med-a2']);
        const j = rs[0].json;
        ok('el mediador del club recibe su contexto: c4 y cs', agree(rs) && j.context.groups.length === 1 && j.context.groups[0].group_id === 'g-a2'
            && j.provenance.events === count('ra-1', (r) => r.content_id === 'c4' || r.content_id === 'cs'), st(rs));
        ok('mismo lector, dos mediadores: huellas distintas', j.provenance.digest !== tl1.provenance.digest);
    }

    section('[4] historial no verificable → insufficient');
    {
        const rs = await both(TL('ra-4'), C['med-a']);
        const j = rs[0].json;
        ok('insufficient / unverifiable_history, sin perfil, riesgo ni recomendaciones', agree(rs) && clean(rs) && j.data_state === 'insufficient' && j.reason === 'unverifiable_history' && noDiag(j) && j.signals_current.length === 0, st(rs));
        ok('la pantalla recibe una tarjeta que lo explica, con fecha', j.summaries.length === 1 && j.summaries[0].id === 'context_unverifiable_history' && j.summaries[0].kind === 'insufficient_data' && /a partir del \d{4}-\d{2}-\d{2}/.test(j.summaries[0].caveat));
        const fv = await both(FV('ra-4'), C['med-a']);
        ok('vector: sin rasgos y con el estado', fv.every((r) => r.status === 200 && r.json.features === null && r.json.data_state === 'insufficient'), st(fv));
        const off = await get(S3, TL('ra-2'), await login(S3, 'med-a'));
        ok('con el registro de procedencia apagado: insufficient / provenance_not_recorded, sin diagnóstico ni perfil global', off.status === 200 && off.json.data_state === 'insufficient'
            && off.json.reason === 'provenance_not_recorded' && noDiag(off.json) && off.json.summaries[0].id === 'context_provenance_not_recorded' && !LEAK.test(off.text), `${off.status} ${off.text.slice(0, 200)}`);
    }

    section('[5] evidencia suficiente → indicadores y recomendaciones reales · [8] timeline longitudinal');
    let rec2;
    {
        const rs = await both(TL('ra-2'), C['med-a']);
        const j = rs[0].json;
        ok('riesgo de abandono calculado con la lectura del curso', agree(rs) && clean(rs) && j.profile_current.abandono_risk > 0.7 && sig(j, 'abandono_temprano') === 1, st(rs));
        const risk = j.risks.find((r) => r.risk_type === 'abandono_alto');
        ok('riesgo activo con fecha de detección fija y real (un día UTC entre la lectura y hoy)', !!risk && risk.resolved_at === null && risk.detected_at % DAY === 0 && risk.detected_at >= at(15) && risk.detected_at <= Date.now(), JSON.stringify(j.risks));
        rec2 = j.recommendations.find((r) => r.rule_id === 'abandono_alto');
        ok('recomendación con su señal y su contexto', !!rec2 && rec2.acknowledged === 0 && rec2.explanation.signals_used.some((s) => s.id === 'abandono_temprano' && s.value === 1) && rec2.explanation.context.groups.join() === 'g-a'
            && View.isContextualRecommendationId(rec2.recommendation_id));
        ok('evolución fechada: un punto por semana y el actual', j.evolution.length >= 8 && j.evolution.every((p, i, a) => i === 0 || p.recorded_at > a[i - 1].recorded_at)
            && j.evolution.some((p) => p.data_state === 'no_activity') && j.evolution.at(-1).abandono_risk === j.profile_current.abandono_risk, JSON.stringify(j.evolution));
        const rh2 = await both(RH('ra-2'), C['med-a']);
        ok('historial de riesgo: el mismo episodio, idéntico en las dos réplicas', all200(rh2) && clean(rh2) && rh2[0].json.some((r) => r.risk_id === risk.risk_id) && rh2[0].text === rh2[1].text, st(rh2));

        const rh3 = await both(RH('ra-3'), C['med-a']);
        const ep = rh3[0].json?.find((r) => r.risk_type === 'abandono_alto');
        ok('ra-3: episodio de abandono detectado y RESUELTO, con las dos fechas; ninguno sigue activo', all200(rh3) && rh3[0].text === rh3[1].text && !!ep && ep.resolved_at > ep.detected_at && ep.active === false
            && rh3[0].json.every((r) => r.resolved_at !== null), st(rh3));
        const tl3 = (await both(TL('ra-3'), C['med-a']))[0].json;
        ok('ra-3 hoy: sin riesgo activo y con lectura sostenida', tl3.risks.every((r) => r.resolved_at !== null) && sig(tl3, 'continuidad_semanal') === 1 && tl3.recommendations.every((r) => r.rule_id !== 'abandono_alto'));
        const sg = await both(SG('ra-3', 'continuidad_semanal'), C['med-a']);
        const vals = sg[0].json.map((p) => p.metric_value);
        ok('serie semanal de una señal: cambia en el tiempo y termina en el valor actual', all200(sg) && clean(sg) && sg[0].json.length >= 8 && new Set(vals.map(String)).size >= 3 && vals.at(-1) === 1
            && sg[0].json.every((p) => p.signal_id === 'continuidad_semanal' && typeof p.recorded_at === 'number' && 'data_state' in p), JSON.stringify(vals));
    }

    section('[6] cola de atención');
    {
        const rs = await both(QUEUE, C['med-a']);
        const q = rs[0].json;
        ok('200 con sus lectores, igual en las dos réplicas y sin rastro del almacén global', all200(rs) && clean(rs) && JSON.stringify(q.map((x) => x.user_id)) === JSON.stringify(rs[1].json.map((x) => x.user_id)), st(rs));
        ok('solo lectores con riesgo calculable: ra-1, ra-2, ra-3 y ra-7', q.map((x) => x.user_id).sort().join() === 'ra-1,ra-2,ra-3,ra-7', JSON.stringify(q.map((x) => x.user_id)));
        ok('ordenada por severidad y riesgo: primero los de abandono alto', ['ra-2', 'ra-7'].includes(q[0].user_id) && ['ra-2', 'ra-7'].includes(q[1].user_id) && q[0].top_severity === 'high' && q[0].recommendations_count >= 1 && q[0].abandono_risk > 0.7, JSON.stringify(q));
        ok('forma de siempre', q.every((x) => ['user_id', 'abandono_risk', 'last_active_at', 'engagement_score', 'top_severity', 'recommendations_count', 'days_since_active'].every((k) => k in x) && typeof x.abandono_risk === 'number'));
        ok('ra-1 entra con el riesgo del curso, no con el de su compra personal', q.find((x) => x.user_id === 'ra-1').abandono_risk < 0.5 && !['high', 'critical'].includes(q.find((x) => x.user_id === 'ra-1').top_severity), JSON.stringify(q.find((x) => x.user_id === 'ra-1')));
        const s = await both(STATUS, C['med-a']);
        const o = s[0].json.context_overview;
        ok('estado: recuentos por situación (6 lectores con A2 en regla)', all200(s) && o.readers === 7 && o.ok === 5 && o.insufficient === 1 && o.no_activity === 1 && o.no_course_works === 0 && o.in_attention === 4, JSON.stringify(o));
        const tally = { critical: 0, high: 0, moderate: 0, info: 0 };
        for (const u of GA) for (const r of (await get(S1, RECS(u), C['med-a'])).json || []) tally[r.severity]++;
        ok('estado: cuenta las recomendaciones contextuales pendientes de sus lectores (dos altas) y ninguna global', s.every((r) => JSON.stringify(r.json.recommendations_summary) === JSON.stringify(tally)) && tally.high === 2 && tally.critical === 0,
            `${JSON.stringify(s[0].json.recommendations_summary)} vs ${JSON.stringify(tally)}`);
        const qz = await both(QUEUE, C['med-z']), sz = await both(STATUS, C['med-z']);
        ok('curso sin obras: cola vacía y el estado dice por qué', qz.every((r) => r.status === 200 && r.json.length === 0) && sz.every((r) => r.json.context_overview.no_course_works === 1 && r.json.context_overview.readers === 1), st(sz));
        const qb = await both(QUEUE, C['med-b']);
        ok('otra institución: su propia cola, sin lectores ajenos', qb.every((r) => r.status === 200 && r.json.every((x) => x.user_id === 'rb-1')));
        const qn = await both(QUEUE, C['med-noc']), sn = await both(STATUS, C['med-noc']);
        ok('mediador sin C005: ningún lector, y el estado lo declara (0 habilitados)', qn.every((r) => r.status === 200 && r.json.length === 0) && sn.every((r) => r.json.context_overview.readers === 0), st(sn));
        ok('lector: Aula Viva operativa no es su superficie', (await both(QUEUE, C['ra-1'])).every((r) => r.status === 403));
    }

    section('[7] marcado de recomendaciones: autorizado y no autorizado');
    {
        const ACK = (id) => `${AV}/recommendations/${encodeURIComponent(id)}/ack`, DIS = (id) => `${AV}/recommendations/${encodeURIComponent(id)}/dismiss`;
        const list = await both(RECS('ra-2'), C['med-a']);
        ok('el mediador consulta las recomendaciones del lector en su contexto', all200(list) && clean(list) && list[0].json[0].recommendation_id === rec2.recommendation_id && list[0].json.map((r) => r.recommendation_id).join() === list[1].json.map((r) => r.recommendation_id).join()
            && list[0].json.every((r) => r.scope_id === 'ra-2' && View.isContextualRecommendationId(r.recommendation_id)), st(list));
        const q0 = (await get(S1, QUEUE, C['med-a'])).json.find((x) => x.user_id === 'ra-2'), s0 = (await get(S1, STATUS, C['med-a'])).json;
        // No autorizados: nada cambia y la respuesta no revela a quién pertenece el identificador.
        const forged = (reader, key, rule) => View.recommendationIdFor(reader, key, rule, Math.floor(Date.now() / (7 * DAY)));
        const keyA = View.parseRecommendationId(rec2.recommendation_id).ctxKey;
        const attempts = [
            ['otra institución', C['med-b'], rec2.recommendation_id], ['mismo curso sin C005', C['med-noc'], rec2.recommendation_id], ['otro curso', C['med-a2'], rec2.recommendation_id],
            ['contexto ajeno sobre un lector propio', C['med-a2'], forged('ra-1', keyA, 'abandono_alto')], ['regla que no está activa', C['med-a'], forged('ra-1', keyA, 'abandono_alto')],
            ['identificador ilegible', C['med-a'], 'ctx.no-es-base64'], ['lector de otra institución', C['med-a'], forged('rb-1', keyA, 'abandono_alto')],
            ['recomendación GLOBAL del lector', C['med-a'], 'rec-global-ra-2'], ['el propio lector', C['ra-2'], rec2.recommendation_id],
        ];
        for (const [label, cookie, id] of attempts) {
            const a = await post(S1, ACK(id), cookie, {}), d = await post(S2, DIS(id), cookie, {});
            ok(`no autorizado — ${label}: 403 en ack y dismiss`, a.status === 403 && d.status === 403 && !LEAK.test(a.text) && !/ra-\d|rb-1|g-a/.test(a.text), `${a.status} ${a.text} | ${d.status} ${d.text}`);
        }
        ok('tras los intentos: ningún acto guardado y el almacén global intacto', ctxRows().length === 0 && globalDigest() === GLOBAL_BEFORE);
        // Autorizado.
        const a1 = await post(S1, ACK(rec2.recommendation_id), C['med-a'], {});
        ok('el mediador la marca como atendida', a1.status === 200 && JSON.parse(a1.text).acknowledged === true, `${a1.status} ${a1.text}`);
        const a2 = await post(S2, ACK(rec2.recommendation_id), C['med-a'], {});
        ok('marcarla otra vez (en la otra réplica) no cambia nada: idempotente', a2.status === 200 && JSON.parse(a2.text).ok === true && JSON.parse(a2.text).acknowledged === false && ctxRows().length === 1, `${a2.status} ${a2.text}`);
        const row = ctxRows()[0];
        ok('queda quién y cuándo, como fila del lector', row.scope_type === 'user' && row.scope_id === 'ra-2' && row.rule_id === 'abandono_alto' && row.acknowledged === 1 && row.acknowledged_by === 'med-a' && row.acknowledged_at >= NOW && row.applied === 0);
        const after = await both(RECS('ra-2'), C['med-a']), hist = await both(`${RECS('ra-2')}?includeAcknowledged=1`, C['med-a']);
        const inHist = (r) => r.json.find((x) => x.recommendation_id === rec2.recommendation_id);
        ok('ya no figura como pendiente; sí en el historial, marcada', after.every((r) => r.status === 200 && !r.json.some((x) => x.recommendation_id === rec2.recommendation_id))
            && hist.every((r) => inHist(r)?.acknowledged === 1 && inHist(r).acknowledged_at === row.acknowledged_at), st(hist));
        const q = (await both(QUEUE, C['med-a']))[0].json.find((x) => x.user_id === 'ra-2'), s = (await both(STATUS, C['med-a']))[0].json;
        ok('la cola y el resumen lo reflejan', q.recommendations_count === q0.recommendations_count - 1 && q.top_severity !== 'high' && s.recommendations_summary.high === s0.recommendations_summary.high - 1, JSON.stringify([q0, q, s.recommendations_summary]));
        ok('el timeline la muestra como revisada', (await both(TL('ra-2'), C['med-a'])).every((r) => r.json.recommendations.find((x) => x.recommendation_id === rec2.recommendation_id)?.acknowledged === 1));
        // Descartar e intervenir (ra-7).
        const rec7 = (await get(S1, RECS('ra-7'), C['med-a'])).json.find((r) => r.rule_id === 'abandono_alto');
        const iv = await post(S1, `${AV}/interventions`, C['med-a'], { studentId: 'ra-7', interventionType: rec7.recommendation_type, recommendationOrigin: rec7.recommendation_id });
        const ap = await post(S2, ACK(rec7.recommendation_id), C['med-a'], { applied: true });
        ok('registrar una intervención y marcarla como aplicada', iv.status === 200 && JSON.parse(iv.text).ok === true && ap.status === 200 && JSON.parse(ap.text).applied === true, `${iv.status} ${iv.text} | ${ap.status} ${ap.text}`);
        const r7 = ctxRows().find((r) => r.scope_id === 'ra-7');
        ok('aplicada con fecha; una fila por recomendación', !!r7 && r7.applied === 1 && r7.applied_at >= NOW && ctxRows().length === 2);
        const d7 = await post(S1, DIS(rec7.recommendation_id), C['med-a'], {});
        ok('descartar una ya atendida no la altera', d7.status === 200 && JSON.parse(d7.text).acknowledged === false && ctxRows().find((r) => r.scope_id === 'ra-7').applied === 1 && ctxRows().length === 2);
        ok('la administración conserva el marcado de recomendaciones globales', (await post(S1, ACK('rec-global-rb-1'), C.adm, {})).status === 200);
    }

    section('[5b] sin actividad del curso · curso sin obras · poca evidencia');
    {
        const r6 = await both(TL('ra-6'), C['med-a']);
        ok('sin actividad: no_activity, sin diagnóstico y con tarjeta propia', agree(r6) && r6[0].json.data_state === 'no_activity' && noDiag(r6[0].json) && r6[0].json.summaries[0].id === 'context_no_activity', st(r6));
        const rz = await both(TL('ra-z'), C['med-z']);
        ok('curso sin obras: no_course_works con tarjeta propia; su compra personal no aparece', agree(rz) && clean(rz) && rz[0].json.data_state === 'no_course_works' && noDiag(rz[0].json) && rz[0].json.summaries[0].id === 'context_no_course_works' && !/"c3"/.test(rz[0].text), st(rz));
        const r5 = await both(TL('ra-5'), C['med-a']);
        ok('poca evidencia: riesgo «insufficient», nunca 0; fuera de la cola', agree(r5) && r5[0].json.profile_current.abandono_risk === null && r5[0].json.indicator_states.abandono_risk === 'insufficient' && r5[0].json.recommendations.length === 0, st(r5));
        ok('recomendaciones de un lector sin actividad: lista vacía (200)', (await both(RECS('ra-6'), C['med-a'])).every((r) => r.status === 200 && Array.isArray(r.json) && r.json.length === 0));
    }

    section('[8b] perfil institucional del lector');
    {
        const rs = await both(`${AV}/institutional/profile/ra-2`, C['med-a']);
        ok('timeline, vector e historial de impacto del contexto', all200(rs) && clean(rs) && rs[0].json.timeline.data_state === 'ok' && rs[0].json.timeline.profile_current.abandono_risk > 0.7
            && rs[0].json.feature_vector.features.abandono === 1 && Array.isArray(rs[0].json.impact_history?.outcomes) && !('withheld' in rs[0].json), st(rs));
        ok('impacto por lector: el del contexto (U3), nunca el global', (await both(`${AV}/institutional/outcomes/scope/user/ra-2`, C['med-a'])).every((r) => r.status === 200 && Array.isArray(r.json.outcomes) && !LEAK.test(r.text)));
    }

    section('[9] revocación inmediata de A2 / C005 · otros accesos');
    {
        const routes = (u) => [TL(u), FV(u), RH(u), SG(u, 'continuidad_semanal'), RECS(u), `${AV}/institutional/profile/${u}`];
        const everyDenied = async (u, cookie) => { const out = []; for (const p of routes(u)) out.push(...await both(p, cookie)); return out.every(denied); };
        ok('otra institución: todas las rutas individuales denegadas', await everyDenied('ra-2', C['med-b']));
        ok('mediador sin C005: denegadas', await everyDenied('ra-2', C['med-noc']));
        ok('lector de un curso que no media: denegadas', await everyDenied('ra-2', C['med-a2']));
        ok('antes de revocar: ra-3 accesible', (await both(TL('ra-3'), C['med-a'])).every((r) => r.status === 200));
        Reg.appendDecisions([{ subjectId: 'ra-3', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-3' }]);
        ok('A2 revocada: denegado de inmediato en las dos réplicas', await everyDenied('ra-3', C['med-a']));
        const q = await both(QUEUE, C['med-a']), s = await both(STATUS, C['med-a']);
        ok('…y sale de la cola y de los recuentos', q.every((r) => r.status === 200 && !r.json.some((x) => x.user_id === 'ra-3')) && s.every((r) => r.json.context_overview.readers === 6));
        Reg.appendDecisions([{ subjectId: 'med-a2', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-A2' }]);
        ok('C005 revocado: denegado de inmediato en las dos réplicas', await everyDenied('ra-1', C['med-a2']));
        fs.appendFileSync(REG, 'esto no es una decisión\n');
        const broken = [...await both(TL('ra-2'), C['med-a']), ...await both(QUEUE, C['med-a'])];
        ok('registro de decisiones no verificable: 503, nunca datos', broken.every((r) => r.status === 503 && !LEAK.test(r.text) && !/profile_current/.test(r.text)), st(broken));
    }

    section('[10] lector, B2C y administración sin regresión');
    {
        const adm = { tl: await both(TL('ra-2'), C.adm), fv: await both(FV('ra-2'), C.adm), rh: await both(RH('ra-2'), C.adm), q: await both(QUEUE, C.adm) };
        ok('la administración conserva el perfil GLOBAL', adm.tl.every((r) => r.json?.profile_current?.abandono_risk === MARK && !('data_state' in r.json)), st(adm.tl));
        ok('…el vector de rasgos global', adm.fv.every((r) => r.status === 200 && /marca-ra-2/.test(r.text)), st(adm.fv));
        ok('…el historial de riesgo global', adm.rh.every((r) => r.status === 200 && /marca-ra-2/.test(r.text)), st(adm.rh));
        ok('…y la cola global', adm.q.every((r) => r.status === 200 && r.json.some((x) => x.abandono_risk === MARK)), st(adm.q));
        const CP = (pct) => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: pct }, viewportHint: pct }, updatedAt: new Date().toISOString() });
        const saved = [];
        for (const [u, c, pct] of [['ra-1', 'c1', 40], ['ra-1', 'c3', 70], ['b2c-1', 'c3', 80]]) saved.push((await post(S1, `/api/progress/${u}/${c}/sync`, C[u], CP(pct))).status);
        const has = (r, c) => (r.json?.progressList || []).some((p) => p.contentId === c);
        ok('el lector y la cuenta B2C guardan y leen su progreso completo', saved.every((x) => x === 200) && (await both('/api/progress/user/ra-1', C['ra-1'])).every((r) => r.status === 200 && has(r, 'c1') && has(r, 'c3'))
            && (await both('/api/progress/user/b2c-1', C['b2c-1'])).every((r) => r.status === 200 && has(r, 'c3')), saved.join(' '));
        ok('el mediador no alcanza a la cuenta B2C por ninguna vía', (await both(TL('b2c-1'), C['med-a'])).every((r) => r.status === 403) && (await both('/api/progress/user/b2c-1', C['med-a'])).every((r) => r.status === 403));
    }

    section('[12] almacén global intacto');
    {
        const now = globalDigest();
        ok('perfiles, señales, vectores y riesgos globales sin cambios; única recomendación global tocada, la que marcó la administración',
            JSON.stringify(JSON.parse(now).slice(0, 4)) === JSON.stringify(JSON.parse(GLOBAL_BEFORE).slice(0, 4))
            && JSON.parse(now)[4].filter((r) => r.acknowledged).map((r) => r.recommendation_id).join() === 'rec-global-rb-1');
        ok('lo único guardado por el seguimiento contextual: dos actos de atención', ctxRows().length === 2 && ctxRows().every((r) => r.acknowledged === 1 && r.acknowledged_by === 'med-a'));
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
