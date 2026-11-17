/**
 * contextIndicatorsHttp.test.mjs — CHP V9 F7-C2R-U1.
 *
 * Indicadores derivados CONTEXTUALES por HTTP: dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce, cookies de
 * /api/auth/login, un events.db y un insights.db compartidos (como en producción) y el registro de procedencia
 * encendido. La ruta de verificación del motor (`/api/aula-viva/context/students/:id/indicators`) solo existe con
 * AULA_VIVA_CONTEXT_PREVIEW_ENABLED=1; las rutas de Aula Viva siguen reteniendo los indicadores individuales (F7-C2S).
 *
 * Dos instituciones y una tercera con un curso sin obras. `ra-1` pertenece a dos cursos de mediadores distintos, tiene
 * una compra personal (c3) y leyó c2 antes de que se asignara a su curso.
 *   [1] lectura del curso y compra personal      [6] evidencia insuficiente y ausencia de actividad
 *   [2] otro curso y obra compartida             [7] equivalencia con el cálculo original
 *   [3] asignación y membresía posteriores       [8] lector, B2C, administración y retención F7-C2S
 *   [4] A2 / C005 / otra institución             [9] almacén global intacto; ruta apagada
 *   [5] curso sin obras
 * Cada comprobación se hace en las dos réplicas. POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como
 * aprobada) y en CI una omisión es un fallo. Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/contextIndicatorsHttp.test.mjs
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
    console.log('contextIndicatorsHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2r_u1_'));
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
    ...GA.map((id) => reader(id, A)), reader('ra-new', A), reader('ra-z', Z), reader('rb-1', B),
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
grantA2([...GA, 'ra-new', 'ra-z', 'rb-1']);
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

for (const d of [20, 12, 6, 3]) read('ra-1', 'c1', d);
for (const d of [18, 17, 16, 9, 8, 4]) abandon('ra-1', 'c3', d);
read('ra-1', 'c3', 2, 300);
read('ra-1', 'c4', 7); read('ra-1', 'cs', 5);
read('ra-1', 'c2', 9);                                                   // antes de que c2 se asigne al curso (ocurre durante la prueba)
read('ra-2', 'c1', 21); read('ra-2', 'c1', 14); read('ra-2', 'c1', 9); abandon('ra-2', 'c1', 5); read('ra-2', 'c1', 2, 25);
ev('ra-5', 'c1', 'session_started', at(3));                              // poca evidencia
read('ra-new', 'c1', 4);                                                 // leyó c1 por su cuenta; entra al curso durante la prueba
read('ra-z', 'c3', 4); read('ra-z', 'c3', 2);
read('rb-1', 'cb', 3);
read('b2c-1', 'c3', 3);

// ── Procedencia: lo que el servidor habría observado hace 40 días (el mismo estado que verá al arrancar) ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const snapshot = () => GROUPS().map((g) => ({ groupId: g.id, works: RULES().filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds }));
const seeded = Ledger.observeContext(snapshot(), { nowTs: at(40) });
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
const idb = getInsightsExtDb();
const observedRows = () => idb.prepare(`SELECT kind, group_id, IFNULL(work_id, user_id) AS item_id FROM pedagogical_context_intervals WHERE origin = 'observed' ORDER BY id`).all();
const globalRows = () => ['user_reading_profiles', 'signal_snapshots', 'cohort_rollups'].map((t) => idb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n).join(',');
const GLOBAL_BEFORE = globalRows();

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
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 160)}`).join(' | ');
const CTX = (u) => `/api/aula-viva/context/students/${u}/indicators`;
// Lo que no depende del instante de la petición: debe ser idéntico entre réplicas y entre peticiones.
const stable = (j) => JSON.stringify(j && { data_state: j.data_state, reason: j.reason, context: j.context, indicator_states: j.indicator_states,
    profile: j.profile_current && Object.fromEntries(Object.entries(j.profile_current).filter(([k]) => k !== 'updated_at')),
    signals: (j.signals_current || []).map((s) => [s.signal_id, s.metric_value, s.confidence]), risks: (j.risks || []).map((r) => [r.risk_type, r.severity]),
    recommendations: (j.recommendations || []).map((r) => [r.rule_id, r.severity]), features: j.feature_vector?.features ?? null,
    provenance: j.provenance && { ...j.provenance, verifiable_from: undefined } });
const agree = (rs) => rs.every((r) => r.status === 200) && stable(rs[0].json) === stable(rs[1].json);
const sig = (j, id) => j?.signals_current?.find((s) => s.signal_id === id)?.metric_value;
const denied = (r) => r.status === 403 && r.json?.error === 'scope_access_denied' && !('data_state' in r.json);
const NO_DIAG = (j) => j.profile_current === null && j.risks.length === 0 && j.recommendations.length === 0 && j.feature_vector === null;

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'ra-z', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    ok('preparación: línea base sembrada y las dos réplicas no observan nada distinto al arrancar', seeded.ok && seeded.baseline && observedRows().length === 0, JSON.stringify([seeded, observedRows()]));

    section('[1] lectura del curso y compra personal');
    let base1;
    {
        const rs = await both(CTX('ra-1'), C['med-a']);
        base1 = rs[0].json;
        const expected = count('ra-1', (r) => r.content_id === 'c1' || r.content_id === 'cs');
        ok('200 con indicadores, iguales en las dos réplicas', agree(rs) && base1.data_state === 'ok', st(rs));
        ok('contribuyen las lecturas de las obras del curso (c1 y cs)', base1.provenance.events === expected && sig(base1, 'diversidad_lectora') === 2, JSON.stringify(base1.provenance));
        ok('los abandonos de la compra personal no entran: sin riesgo de abandono atribuido', sig(base1, 'abandono_temprano') === 0 && !base1.recommendations.some((r) => r.rule_id === 'abandono_alto'));
        ok('la respuesta no nombra obras ajenas ni recuentos de lo excluido', !/"c3"|"c4"|"c2"|outside|unverifiable|audit/.test(rs[0].text), rs[0].text.slice(0, 300));
        for (let i = 0; i < 30; i++) abandon('ra-1', 'c3', 1 + i * 0.4);
        const again = await both(CTX('ra-1'), C['med-a']);
        ok('30 abandonos personales más: el resultado no cambia en ninguna réplica', agree(again) && stable(again[0].json) === stable(base1), st(again));
    }

    section('[2] otro curso y obra compartida');
    {
        const rs = await both(CTX('ra-1'), C['med-a2']);
        const j = rs[0].json;
        ok('el mediador del club recibe SU contexto (c4 y cs)', agree(rs) && j.provenance.events === count('ra-1', (r) => r.content_id === 'c4' || r.content_id === 'cs') && j.context.groups.length === 1 && j.context.groups[0].group_id === 'g-a2', st(rs));
        ok('dos mediadores, dos huellas distintas del mismo lector', j.provenance.digest !== base1.provenance.digest);
        ok('la obra del club no entra en el contexto del curso', base1.context.groups.length === 1 && base1.context.groups[0].group_id === 'g-a');
    }

    section('[3] asignación y membresía posteriores');
    {
        // c2 se asigna AHORA al curso g-a. ra-1 la había leído hace 9 días.
        writeAtomic(P.access, RULES().map((r) => (r.id === 'r-g-a' ? { ...r, titleIds: ['c1', 'cs', 'c2'] } : r)));
        const rs = await both(CTX('ra-1'), C['med-a']);
        ok('la asignación queda observada una sola vez entre las dos réplicas', observedRows().filter((r) => r.kind === 'work' && r.group_id === 'g-a' && r.item_id === 'c2').length === 1, JSON.stringify(observedRows()));
        ok('la lectura anterior a la asignación NO se incorpora', agree(rs) && rs[0].json.provenance.digest === base1.provenance.digest && rs[0].json.context.groups[0].works === 3, st(rs));
        await sleep(30);
        { const t = Date.now(); ev('ra-1', 'c2', 'session_started', t); ev('ra-1', 'c2', 'reading_started', t + 1); ev('ra-1', 'c2', 'session_heartbeat', t + 2, { elapsed: 600_000 }); ev('ra-1', 'c2', 'reading_completed', t + 3); }
        await sleep(30);
        const after = await both(CTX('ra-1'), C['med-a']);
        ok('la lectura posterior a la asignación SÍ contribuye', agree(after) && after[0].json.provenance.events === base1.provenance.events + 4 && sig(after[0].json, 'diversidad_lectora') === 3, st(after));

        // ra-new entra AHORA al curso. Había leído c1 hace 4 días.
        writeAtomic(P.groups, GROUPS().map((g) => (g.id === 'g-a' ? { ...g, memberIds: [...GA, 'ra-new'], studentIds: [...GA, 'ra-new'] } : g)));
        const nw = await both(CTX('ra-new'), C['med-a']);
        ok('lo leído antes de entrar al curso no cuenta: no_activity, sin diagnóstico', agree(nw) && nw[0].json.data_state === 'no_activity' && NO_DIAG(nw[0].json) && nw[0].json.provenance.events === 0, st(nw));
        ok('la membresía queda observada una sola vez', observedRows().filter((r) => r.kind === 'member' && r.item_id === 'ra-new').length === 1);
    }

    section('[4] A2 / C005 / otra institución');
    {
        ok('otra institución: denegado', (await both(CTX('ra-1'), C['med-b'])).every(denied));
        ok('mediador del curso sin C005: denegado', (await both(CTX('ra-1'), C['med-noc'])).every(denied));
        ok('lector de un curso que no media: denegado', (await both(CTX('ra-2'), C['med-a2'])).every(denied));
        ok('el propio lector no usa esta ruta (es de mediación)', (await both(CTX('ra-1'), C['ra-1'])).every((r) => r.status === 403));
        ok('cuenta B2C personal: denegado a cualquier mediador', (await both(CTX('b2c-1'), C['med-a'])).every(denied));
        ok('sin sesión: 401', (await both(CTX('ra-1'), null)).every((r) => r.status === 401));
        ok('antes de revocar: ra-3 accesible', (await both(CTX('ra-3'), C['med-a'])).every((r) => r.status === 200));
        Reg.appendDecisions([{ subjectId: 'ra-3', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-3' }]);
        ok('A2 revocada: denegado de inmediato en las dos réplicas', (await both(CTX('ra-3'), C['med-a'])).every(denied));
        Reg.appendDecisions([{ subjectId: 'med-a2', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-A2' }]);
        ok('C005 revocado: denegado de inmediato en las dos réplicas', (await both(CTX('ra-1'), C['med-a2'])).every(denied));
    }

    section('[5] curso sin obras');
    {
        const rs = await both(CTX('ra-z'), C['med-z']);
        ok('no_course_works, sin perfil ni señales', agree(rs) && rs[0].json.data_state === 'no_course_works' && NO_DIAG(rs[0].json) && rs[0].json.signals_current.length === 0 && rs[0].json.provenance === null, st(rs));
        ok('su compra personal no aparece', !/"c3"/.test(rs[0].text));
    }

    section('[6] evidencia insuficiente y ausencia de actividad');
    {
        const r6 = await both(CTX('ra-6'), C['med-a']);
        ok('sin actividad: no_activity (distinto de insufficient)', agree(r6) && r6[0].json.data_state === 'no_activity' && NO_DIAG(r6[0].json), st(r6));
        const r5 = await both(CTX('ra-5'), C['med-a']);
        ok('poca evidencia: riesgo «insufficient», nunca 0', agree(r5) && r5[0].json.profile_current.abandono_risk === null && r5[0].json.indicator_states.abandono_risk === 'insufficient'
            && r5[0].json.risks.length === 0 && r5[0].json.recommendations.length === 0, st(r5));
        // Una obra del curso leída antes de la línea base de un grupo: no atribuible ⇒ sin diagnóstico.
        idb.prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id = 'ra-4'`).run(at(1));
        read('ra-4', 'c1', 6); readAt('ra-4', 'c1', Date.now() - 3_600_000);
        const r4 = await both(CTX('ra-4'), C['med-a']);
        ok('historia no verificable: insufficient / unverifiable_history, sin diagnóstico y con fecha', agree(r4) && r4[0].json.data_state === 'insufficient' && r4[0].json.reason === 'unverifiable_history'
            && NO_DIAG(r4[0].json) && r4[0].json.signals_current.length === 0 && r4[0].json.provenance.verifiable_from > Date.now(), st(r4));
    }

    section('[7] equivalencia con el cálculo original');
    {
        const rs = await both(CTX('ra-2'), C['med-a']);
        const j = rs[0].json;
        const { computeUserSignals, computeUserProfile } = await import('../services/signalCompute.mjs');
        const rows = edb.prepare('SELECT * FROM events WHERE user_id = ? AND server_ts >= ? ORDER BY server_ts ASC').all('ra-2', j.window.from);
        const refS = computeUserSignals(rows, { nowTs: j.computed_at, windowDays: 28, userId: 'ra-2' }), refP = computeUserProfile(refS, { nowTs: j.computed_at });
        ok('lector con solo actividad del curso: señales = cálculo original', agree(rs) && j.signals_current.every((s) => s.metric_value === (typeof refS[s.signal_id].value === 'number' ? refS[s.signal_id].value : null) && s.confidence === refS[s.signal_id].confidence), st(rs));
        ok('…y perfil = cálculo original', Object.keys(refP).every((k) => j.profile_current[k] === refP[k]), JSON.stringify([j.profile_current, refP]));
        ok('usa todas sus filas', j.provenance.events === rows.length);
    }

    section('[8] lector, B2C, administración y retención F7-C2S');
    {
        // V9 F7-C2R-U2: las rutas de Aula Viva ya responden por mediación, con el MISMO cálculo que la ruta de verificación.
        const tl = await both('/api/aula-viva/students/ra-1/timeline', C['med-a']), pv = await both(CTX('ra-1'), C['med-a']);
        ok('el timeline de Aula Viva usa las mismas entradas que el motor (misma huella)', tl.every((r, i) => r.status === 200 && r.json.provenance.digest === pv[i].json.provenance.digest && r.json.data_state === pv[i].json.data_state));
        ok('el impacto por lector responde desde el contexto (U3)', (await both('/api/aula-viva/institutional/outcomes/scope/user/ra-1', C['med-a'])).every((r) => r.status === 200 && Array.isArray(r.json.outcomes)));
        const CP = (pct, u = 'x') => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: pct }, viewportHint: pct }, updatedAt: new Date().toISOString(), session: { sessionId: `s-${u}-${Date.now()}`, mode: 'text', durationSec: 60 } });
        const saved = [];
        for (const [u, c, pct] of [['ra-1', 'c1', 40], ['ra-1', 'c3', 70], ['b2c-1', 'c3', 80]]) saved.push((await post(S1, `/api/progress/${u}/${c}/sync`, C[u], CP(pct, u))).status);
        ok('el lector y la cuenta B2C guardan su progreso', saved.every((x) => x === 200), saved.join(' '));
        const has = (r, c) => (r.json?.progressList || []).some((p) => p.contentId === c);
        ok('F7-C2 intacto: el mediador solo lista progreso de obras del curso', (await both('/api/progress/user/ra-1', C['med-a'])).every((r) => r.status === 200 && has(r, 'c1') && !has(r, 'c3')));
        ok('el lector conserva su progreso completo (curso y compra personal)', (await both('/api/progress/user/ra-1', C['ra-1'])).every((r) => r.status === 200 && has(r, 'c1') && has(r, 'c3')));
        ok('la cuenta B2C conserva su progreso', (await both('/api/progress/user/b2c-1', C['b2c-1'])).every((r) => r.status === 200 && has(r, 'c3')));
        ok('el mediador no alcanza a la cuenta B2C', (await both('/api/progress/user/b2c-1', C['med-a'])).every((r) => r.status === 403));
        ok('la administración conserva la vista global del lector', (await both('/api/aula-viva/students/ra-1/timeline', C.adm)).every((r) => r.status === 200 && 'profile_current' in (r.json ?? {})));
    }

    section('[9] almacén global intacto; ruta apagada');
    {
        ok('perfiles, señales y agregados globales: mismas filas que antes', globalRows() === GLOBAL_BEFORE, `${GLOBAL_BEFORE} → ${globalRows()}`);
        const off = await get(S3, CTX('ra-1'), await login(S3, 'med-a'));
        ok('sin AULA_VIVA_CONTEXT_PREVIEW_ENABLED la ruta no existe (404)', off.status === 404, `${off.status} ${off.text.slice(0, 120)}`);
        ok('solo dos asociaciones observadas en toda la prueba (c2 y ra-new)', observedRows().length === 2, JSON.stringify(observedRows()));
        const leaks = [S1, S2].map((s) => (s.out.match(/\[CONTEXT\][^\n]*/g) || []).join('\n'));
        ok('el registro del servidor no nombra lectores ni obras', leaks.every((l) => !/ra-\d|ra-new|"c\d"|\bc[1-4s]\b/.test(l)), leaks.join(' | ').slice(0, 400));
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1200));
} finally {
    for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); eventsService.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
