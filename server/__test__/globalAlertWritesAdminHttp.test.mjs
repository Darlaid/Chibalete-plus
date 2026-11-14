/**
 * globalAlertWritesAdminHttp.test.mjs — CHP V9 F5-C3S.
 *
 * Las tres ESCRITURAS de alertas globales de la plataforma solo las hace la administración. Antes las admitía el rol
 * de mediador de cualquier institución: generaba instantáneas, confirmaba y descartaba alertas de toda la plataforma.
 *
 *   POST /api/metrics/insights/snapshot      POST /api/metrics/insights/:insightKey/ack
 *                                            POST /api/metrics/insights/:insightKey/dismiss
 *
 * Mismo control que los cinco GET globales (F5-C3): autoridad de máquina o administrador de plataforma según el CIS,
 * resuelto ANTES de cualquier escritura. Dos réplicas de server.js REAL sobre almacenes sintéticos (insights.db
 * compartida), más una tercera con la identidad no verificable. SESSION_AUTH_MODE=off.
 *   [1] administración: las tres operaciones   [3] identidad no verificable   [5] revocación y usos legítimos
 *   [2] rechazos SIN efectos                   [4] autoridad de máquina       [6] estructura
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/globalAlertWritesAdminHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { freePorts } from './helpers/freePort.mjs';
import { ADMIN_SECRET_PATH } from '../lib/adminSecret.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gaw_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), usersX: path.join(tmp, 'users_x.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), insights: path.join(tmp, 'insights.db') };
fs.mkdirSync(P.data, { recursive: true });
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const user = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const USERS = [
    user('adm', ['administrador']), user('adm2', ['administrador']),
    user('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), user('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    user('med-libre', ['mediador'], { mediatorKind: 'teacher', ...A }),
    user('ra', ['lector'], A), user('b2c', ['lector'], { b2c: true, createdVia: 'b2c-provision' }),
    user('adm-off', ['administrador'], { accountStatus: 'disabled' }),
];
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: ['ra'], studentIds: ['ra'] },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: [], studentIds: [] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.usersX, JSON.stringify(USERS));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');

const ports = await freePorts(3);
const start = (port, i, extra = {}) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`), SESSIONS_DB: path.join(P.data, `sessions-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock', ...extra,
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error(`server no arrancó\n${s.out.slice(-1500)}`); };
const call = async (s, method, p, who, { body, headers = {} } = {}) => {
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(who ? { 'x-user-id': who } : {}), ...headers }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const DENIED = '{"error":"Acceso denegado"}';
/** Contenido lógico completo de insights.db (todas las tablas, todas las filas). Ausente ⇒ 'ausente'. */
const dump = () => {
    if (!fs.existsSync(P.insights)) return 'ausente';
    const db = new Database(P.insights, { readonly: true });
    try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
        return JSON.stringify(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY 1, 2`).all()]));
    } finally { db.close(); }
};
const rows = (table) => { const db = new Database(P.insights, { readonly: true }); try { return db.prepare(`SELECT * FROM ${table}`).all(); } finally { db.close(); } };
const WRITES = (key) => [['/api/metrics/insights/snapshot', { windowDays: 30 }], [`/api/metrics/insights/${encodeURIComponent(key)}/ack`, {}], [`/api/metrics/insights/${encodeURIComponent(key)}/dismiss`, { days: 7 }]];
const GLOBAL_GETS = ['/api/metrics/backbone', '/api/metrics/funnels', '/api/metrics/insights', '/api/metrics/insights/states', '/api/metrics/insights/notifications'];

const S1 = start(ports[0], 1), S2 = start(ports[1], 2), SX = start(ports[2], 3, { USERS_DB: P.usersX });
let staged = false;
try {
    await ready(S1); await ready(S2); await ready(SX);

    console.log('[1] administración: las tres operaciones siguen funcionando');
    const snap = await call(S1, 'POST', '/api/metrics/insights/snapshot', 'adm', { body: { windowDays: 30 } });
    ok('administrador → genera la instantánea (200, mismo contrato)', snap.status === 200 && snap.json?.ok === true && Object.keys(snap.json).sort().join() === 'insightsPersisted,notificationsCreated,ok,snapshotId,stateSummary', `${snap.status} ${snap.text.slice(0, 200)}`);
    // Alerta sintética sobre la que confirmar y descartar (el almacén de pruebas no tiene telemetría que la produzca).
    let states = rows('insight_states');
    if (states.length === 0) {
        const db = new Database(P.insights);
        try {
            const cols = db.prepare("PRAGMA table_info('insight_states')").all();
            const now = Date.now();
            const val = (c) => ({ insight_key: 'alerta-sintetica', scope_level: 'global', type: 'synthetic', severity: 'warning', title: 'Alerta sintética', status: 'active', first_seen_at: now, last_seen_at: now, occurrences: 1, last_payload_json: '{}', updated_at: now, created_at: now }[c.name] ?? (c.notnull && c.dflt_value === null ? (/INT|REAL|NUM/i.test(c.type) ? 0 : '') : null));
            const use = cols.filter((c) => val(c) !== null);
            db.prepare(`INSERT INTO insight_states (${use.map((c) => c.name).join(',')}) VALUES (${use.map(() => '?').join(',')})`).run(...use.map(val));
        } finally { db.close(); }
        states = rows('insight_states');
    }
    const KEY = states[0].insight_key;
    const ack = await call(S2, 'POST', `/api/metrics/insights/${encodeURIComponent(KEY)}/ack`, 'adm');
    ok('administrador → confirma una alerta (200 {ok:true}) y queda registrada', ack.status === 200 && ack.json?.ok === true && rows('insight_states').find((r) => r.insight_key === KEY)?.acknowledged_at > 0, `${ack.status} ${ack.text}`);
    const dis = await call(S1, 'POST', `/api/metrics/insights/${encodeURIComponent(KEY)}/dismiss`, 'adm2', { body: { days: 3 } });
    ok('otro administrador → la descarta (200 {ok, dismissedUntil}) y queda registrada', dis.status === 200 && dis.json?.ok === true && dis.json.dismissedUntil > Date.now() && rows('insight_states').find((r) => r.insight_key === KEY)?.dismissed_until === dis.json.dismissedUntil, `${dis.status} ${dis.text}`);
    ok('alerta inexistente → 404, como antes', (await call(S1, 'POST', '/api/metrics/insights/no-existe/ack', 'adm')).status === 404 && (await call(S2, 'POST', '/api/metrics/insights/no-existe/dismiss', 'adm')).status === 404);

    console.log('[2] rechazos sin efectos');
    const before = dump();
    const snapshots0 = rows('insight_snapshots').length;
    const SPOOF = { 'x-role': 'administrador', 'x-roles': 'administrador', 'x-user-role': 'administrador', 'x-admin': 'true', 'x-admin-secret': 'credencial-que-no-es-la-de-maquina' };
    const SPOOF_BODY = { role: 'administrador', roles: ['administrador'], actorId: 'adm', userId: 'adm', platformAdmin: true, windowDays: 30, days: 7 };
    const CASES = [['med-a', {}, 'mediador de la institución A'], ['med-b', {}, 'mediador de la institución B'], ['med-libre', {}, 'mediador sin grupos'], ['ra', {}, 'lector institucional'], ['b2c', {}, 'lector B2C'],
        [null, {}, 'sesión anónima'], ['no-existe', {}, 'identidad desconocida'], ['adm-off', {}, 'administrador con la cuenta desactivada'],
        ['med-a', SPOOF, 'mediador que se declara administrador (cabeceras y cuerpo) con una credencial de máquina inválida'], [null, { 'x-admin-secret': 'credencial-invalida' }, 'credencial de máquina inválida, sin sesión']];
    const denied = [];
    for (const [who, headers, label] of CASES) {
        const r = [];
        for (const s of [S1, S2]) for (const [p, body] of WRITES(KEY)) r.push(await call(s, 'POST', p, who, { headers, body: Object.keys(headers).length > 1 ? SPOOF_BODY : body }));
        denied.push(...r);
        ok(`${label} → 403 en las tres escrituras y las dos réplicas`, r.every((x) => x.status === 403 && x.text === DENIED), [...new Set(r.map((x) => `${x.status}:${x.text.slice(0, 50)}`))].join(' '));
    }
    ok(`tras ${denied.length} intentos denegados, insights.db es IDÉNTICA: ni instantáneas, ni confirmaciones, ni descartes`, dump() === before && rows('insight_snapshots').length === snapshots0);
    ok('…ningún rechazo trae alertas, claves, nombres ni correos', denied.every((r) => !/insight|snapshot|stateSummary|dismissedUntil|Cuenta |fixture\.invalid/.test(r.text) && !r.text.includes(KEY)));
    ok('…ni dejó rastro de instantánea en los registros del servidor', (S1.out + S2.out).split('[INSIGHTS_SNAPSHOT]').length - 1 === 1);

    console.log('[3] identidad no verificable');
    fs.writeFileSync(P.usersX, '{ esto no es json');   // el padrón de la tercera réplica deja de ser legible
    const blind = [];
    for (const who of ['adm', 'med-a']) for (const [p, body] of WRITES(KEY)) blind.push(await call(SX, 'POST', p, who, { body }));
    ok('registro de identidad ilegible → nadie escribe (fallo cerrado: 503, nunca 200)', blind.every((r) => r.status === 503 && r.json?.error === 'identity_unavailable' && !r.text.includes(KEY)), blind.map((r) => r.status).join(' '));
    ok('…y el almacén sigue idéntico', dump() === before);

    console.log('[4] autoridad de máquina');
    // El secreto de máquina es file-only en su ruta canónica (no inyectable). Solo se ejercita donde esa ruta es escribible.
    let machine = null;
    if (process.platform !== 'win32' && !fs.existsSync(ADMIN_SECRET_PATH)) {
        try {
            fs.mkdirSync(path.dirname(ADMIN_SECRET_PATH), { recursive: true });
            machine = 'F5C3S-maquina-sintetica-0123456789abcdefghij';
            fs.writeFileSync(ADMIN_SECRET_PATH, machine); fs.chmodSync(ADMIN_SECRET_PATH, 0o400); staged = true;
        } catch { machine = null; }
    }
    if (machine) {
        const ms = await call(S1, 'POST', '/api/metrics/insights/snapshot', null, { headers: { 'x-admin-secret': machine }, body: { windowDays: 30 } });
        if (ms.status === 200) {
            ok('autoridad de máquina válida → permitida en las tres escrituras', ms.json?.ok === true && (await call(S2, 'POST', `/api/metrics/insights/${encodeURIComponent(KEY)}/ack`, null, { headers: { 'x-admin-secret': machine } })).status === 200 && (await call(S1, 'POST', `/api/metrics/insights/${encodeURIComponent(KEY)}/dismiss`, null, { headers: { 'x-admin-secret': machine } })).status === 200);
            ok('…y la misma ruta con otra credencial sigue rechazada', (await call(S1, 'POST', '/api/metrics/insights/snapshot', null, { headers: { 'x-admin-secret': `${machine}x` } })).status === 403);
        } else console.log('  - SKIP autoridad de máquina válida: el secreto canónico no cumple los requisitos del lector en este entorno');
    } else console.log(`  - SKIP autoridad de máquina válida: ${ADMIN_SECRET_PATH} no es escribible aquí (la cubren las suites adminSecret* en POSIX)`);
    ok('credencial de máquina inválida → rechazada, con o sin sesión de mediador', denied.slice(-12).every((r) => r.status === 403));

    console.log('[5] revocación y usos legítimos');
    const mark = dump();
    fs.writeFileSync(P.users, JSON.stringify(USERS.map((u) => (u.id === 'adm2' ? { ...u, roles: ['mediador'], mediatorKind: 'teacher', ...A } : u))));
    let revoked = false;
    for (let i = 0; i < 160 && !revoked; i++) {
        const r = [];
        for (const s of [S1, S2]) for (const [p, body] of WRITES(KEY)) r.push(await call(s, 'POST', p, 'adm2', { body }));
        revoked = r.every((x) => x.status === 403);
        if (!revoked) await sleep(250);
    }
    ok('se retira el rol de administración (pasa a mediador) → pierde las tres escrituras en las DOS réplicas', revoked);
    const gets = [];
    for (const p of GLOBAL_GETS) gets.push([await call(S1, 'GET', p, 'adm'), await call(S2, 'GET', p, 'med-a'), await call(S1, 'GET', p, 'adm2'), await call(S2, 'GET', p, null)]);
    ok('los cinco GET globales siguen como en F5-C3: administración 200; mediador, exadministrador y anónimo 403', gets.every(([a, m, x, n]) => a.status === 200 && m.status === 403 && x.status === 403 && n.status === 403 && m.text === DENIED), gets.map((g) => g.map((r) => r.status).join('/')).join(' '));
    const st = await call(S1, 'GET', '/api/metrics/insights/states', 'adm');
    ok('panel administrativo: la alerta confirmada y descartada se lee con su estado', st.json?.states?.some((x) => x.insightKey === KEY && x.acknowledgedAt > 0 && x.dismissedUntil > 0), st.text.slice(0, 200));
    ok('mediación legítima sin regresión: el mediador sigue viendo sus grupos y la nómina del suyo', (await call(S1, 'GET', '/api/groups', 'med-a')).status === 200 && (await call(S2, 'GET', '/api/groups/g-a/members', 'med-a')).json?.count === 1);
    const again = await call(S2, 'POST', '/api/metrics/insights/snapshot', 'adm', { body: { windowDays: 30 } });
    ok('…y la administración sigue generando instantáneas', again.status === 200 && again.json?.ok === true && dump() !== mark);

    console.log('[6] estructura');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    for (const route of ["app.post('/api/metrics/insights/snapshot'", "app.post('/api/metrics/insights/:insightKey/ack'", "app.post('/api/metrics/insights/:insightKey/dismiss'"]) {
        const i = src.indexOf(route), blockSrc = src.slice(i, i + 1500);
        const g = blockSrc.indexOf('requireGlobalMetricsAdmin(req, res)');
        ok(`${route.slice(10)} resuelve la autorización antes de abrir el almacén`, i > 0 && g > 0 && g < blockSrc.indexOf('ensureInsightsDbOpen()'));
    }
    ok('el control antiguo que admitía mediadores ya no existe', !/requireAdminOrMediator\(/.test(src));
    const guard = src.slice(src.indexOf('async function requireGlobalMetricsAdmin'), src.indexOf('async function requireGlobalMetricsAdmin') + 900);
    ok('el control admite la autoridad de máquina (isAdminRequest) y al administrador de plataforma del CIS, y nada del cuerpo', /await isAdminRequest\(req\)/.test(guard) && /isPlatformAdminCaller\(req, ident\.userId\)/.test(guard) && !/req\.body|req\.query/.test(guard));
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    S1.child.kill('SIGKILL'); S2.child.kill('SIGKILL'); SX.child.kill('SIGKILL');
    if (staged) { try { fs.chmodSync(ADMIN_SECRET_PATH, 0o600); fs.unlinkSync(ADMIN_SECRET_PATH); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
