/**
 * temporalIntegrityHttp.test.mjs — CHP V9 65A (Bloque I). Integridad temporal del seguimiento.
 *
 * La fecha de una sesión de lectura (`session.startedAt`), la marca de orden de un guardado (`updatedAt`) y la fecha de
 * un evento heredado (`timestamp`) las declara el dispositivo. Hasta aquí el servidor no anotaba cuándo recibía nada,
 * así que la atribución de la lectura a un curso dependía solo del reloj del dispositivo, y el historial de un progreso
 * (las 20 últimas sesiones) impedía acreditar una obra leída en más sesiones. Desde 65A el servidor anota la recepción
 * de cada sesión con su reloj y solo acredita ante quien media las fechas coherentes con esa recepción.
 *
 * Dos instituciones; dos réplicas de server.js REAL (SESSION_AUTH_MODE=enforce, cookies de /api/auth/login, almacenes
 * compartidos) y una tercera con el registro de procedencia apagado. Todo el progreso entra por las rutas reales:
 * `POST /api/progress/:u/:c/sync` (web) y `POST /api/progress/my/:c` (contrato de LU: mismo cuerpo, usuario de sesión).
 *
 *   [1] actividad fechada válida             [6] cambios de membresía y de asignación    [11] revocación A2 / C005
 *   [2] fecha futura o incoherente           [7] más de 20 sesiones por obra             [12] dos réplicas consistentes
 *   [3] reloj del dispositivo incorrecto     [8] historia anterior no verificable        [13] estado, informes, Leo
 *   [4] sincronización tardía legítima       [9] lectura personal B2C excluida           [14] eventos heredados
 *   [5] reenvíos, duplicados, orden invertido [10] historial propio conservado           [15] supresión
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/temporalIntegrityHttp.test.mjs
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
    console.log('temporalIntegrityHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 700)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65a_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.EVENTS_SQLITE_PATH = P.events;
process.env.PROGRESS_SQLITE_PATH = P.progress;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const med = (id, org) => acct(id, ['mediador'], { mediatorKind: 'teacher', ...org });
const reader = (id, org) => acct(id, ['lector'], { ...org, lastLoginAt: new Date(Date.now() - 86400000).toISOString() });
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6', 'ra-7', 'ra-8'];
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']), med('med-a', A), med('med-b', B),
    ...GA.map((id) => reader(id, A)), reader('rb-1', B), acct('b2c-1', ['lector'], { b2c: true }),
]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = [grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a'], [...GA]), grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], ['rb-1'])];
const WORKS_A = ['c1', 'c2', 'c5', 'c6', 'c7'];
const RULES = [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: WORKS_A, collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c-ra1', scope: 'user', scopeId: 'ra-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-1' } },
    { id: 'r-b2c-own', scope: 'user', scopeId: 'b2c-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-3' } },
];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['c2', 'Obra asignada después'], ['c3', 'Lectura personal comprada'], ['c5', 'Obra larga'], ['c6', 'Obra leída con el reloj adelantado'],
    ['c7', 'Obra con fechas dudosas'], ['cb', 'Obra de la otra institución']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), '[]');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const REG = a2RegistryPath();
const Reg = await import('../privacy/a2Registry.mjs');
grantA2([...GA, 'rb-1']);
grantC005(['med-a', 'med-b']);

const DAY = 86_400_000, NOW = Date.now(), at = (d) => NOW - d * DAY, iso = (ms) => new Date(ms).toISOString();

// ── Procedencia: línea base hace 100 días; hace 10 se asignó c2 y entró ra-3; ra-5 salió hace 2 días y volvió hace 1 ──
const Ledger = await import('../aulaViva/contextLedger.mjs');
const snap = ({ without = [], absent = [] } = {}) => GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds).filter((t) => !without.includes(t)),
    members: g.memberIds.filter((m) => !absent.includes(m)) }));
const seeded = Ledger.observeContext(snap({ without: ['c2'], absent: ['ra-3'] }), { nowTs: at(100) });
Ledger.observeContext(snap(), { nowTs: at(10) });
Ledger.observeContext(snap({ absent: ['ra-5'] }), { nowTs: at(2) });
Ledger.observeContext(snap(), { nowTs: at(1) });

// ── [8] progreso anterior al registro de recepciones: sembrado directamente, sin constancia de ninguna sesión ──
const Progress = await import('../progressService.js');
Progress.upsertProgress({ id: 'ra-7__c1', userId: 'ra-7', contentId: 'c1', isCompleted: false, updatedAt: iso(at(30)),
    canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: 70, lastInteractedMode: 'text' },
    history: [{ sessionId: 'old-1', startedAt: iso(at(40)), mode: 'text', durationSec: 600 }, { sessionId: 'old-2', startedAt: iso(at(30)), mode: 'text', durationSec: 600 }] });

const ports = await freePorts(3);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i, ledger) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: ledger ? '1' : '', AULA_VIVA_CONTEXT_PREVIEW_ENABLED: ledger ? '1' : '',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`nunca healthy (${last})`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const post = async (s, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const S1 = start(ports[0], 1, true), S2 = start(ports[1], 2, true), S3 = start(ports[2], 3, false);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 330)}`).join(' | ');
const LIST = (u) => `/api/progress/user/${u}`, ITEM = (u, c) => `/api/progress/item/${u}/${c}`, STATUS = (u) => `/api/students/${u}/status`,
    METRICS = (g) => `/api/metrics/course/${g}`, REPORT = (g) => `/api/reports/course/${g}`, SUMMARY = (g) => `/api/groups/${g}/analytics-summary`, LEO = (u) => `/api/leo/mediator/student/${u}`;
const all200 = (rs) => rs.every((r) => r.status === 200);
const same = (rs) => JSON.stringify(rs[0].json) === JSON.stringify(rs[1].json);
const ids = (list) => (list || []).map((p) => p.contentId).sort().join();
const hist = (j, c) => (j?.historicalProgress || []).find((h) => h.contentId === c);
const verified = (j, c) => (j?.progressList || []).find((p) => p.contentId === c);
const breakdown = (j, u) => (j.studentBreakdown || []).find((s) => s.userId === u);
const cp = (pct) => ({ sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, lastInteractedMode: 'text' });
const ses = (id, startMs, durationSec = 60) => ({ sessionId: id, startedAt: iso(startMs), mode: 'text', durationSec });
// (La comprobación de función permite ejecutar esta suite contra el código anterior a 65A para reproducir los defectos.)
const receiptsOf = (u, c) => (typeof Ledger.sessionReceiptsOf === 'function' ? Ledger.sessionReceiptsOf(u)?.get(c) : null) ?? [];

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-b', ...GA, 'rb-1', 'b2c-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    let turn = 0;
    const replica = () => (turn++ % 2 ? S2 : S1);
    /** Guardado web (`/sync`) o con el contrato de LU (`/my`), alternando réplica. */
    const sync = (u, c, body, { lu = false, on = replica() } = {}) => post(on, lu ? `/api/progress/my/${c}` : `/api/progress/${u}/${c}/sync`, C[u], body);
    const own = async (u, c) => (await get(S1, ITEM(u, c), C[u])).json?.progress;
    ok('preparación: línea base registrada y tabla de recepciones vacía', seeded.ok && seeded.baseline && receiptsOf('ra-1', 'c1').length === 0);

    section('[1] actividad fechada válida · [5] reenvíos y duplicados · [12] dos réplicas');
    {
        const t = Date.now();
        const body = { canonicalProgress: cp(40), updatedAt: iso(t - 5000), session: ses('s-ra1-c1', t - 60_000, 55) };
        const first = await sync('ra-1', 'c1', body, { on: S1 });
        ok('guardado en línea aceptado', first.status === 200 && first.json.success === true && !first.json.ignored, first.text.slice(0, 200));
        const before = await both(LIST('ra-1'), C['med-a']);
        ok('el mediador lo recibe acreditado, con su avance, igual en las dos réplicas', all200(before) && same(before) && verified(before[0].json, 'c1')?.canonicalProgress.globalPercentage === 40
            && before[0].json.historicalProgress.length === 0, st(before));
        const r0 = receiptsOf('ra-1', 'c1');
        ok('el servidor anotó UNA recepción, con su propio reloj y la fecha declarada por el dispositivo', r0.length === 1 && r0[0].declared_start_ts === t - 60_000 && r0[0].first_received_ts >= t
            && r0[0].first_received_ts <= Date.now() && r0[0].from_origin === 1 && r0[0].conflict === 0, JSON.stringify(r0));
        const again = [await sync('ra-1', 'c1', body, { on: S2 }), await sync('ra-1', 'c1', body, { on: S1 }), await sync('ra-1', 'c1', body, { on: S2 })];
        ok('el mismo guardado reenviado tres veces (dos réplicas): 200 y descartado como repetido', again.every((r) => r.status === 200 && r.json.ignored === true), again.map((r) => r.text.slice(0, 80)).join('|'));
        const after = await both(LIST('ra-1'), C['med-a']);
        const r1 = receiptsOf('ra-1', 'c1');
        ok('los duplicados no alteran nada: misma respuesta, una sola sesión, misma primera recepción', JSON.stringify(after[0].json) === JSON.stringify(before[0].json) && same(after)
            && (await own('ra-1', 'c1')).history.length === 1 && r1.length === 1 && r1[0].first_received_ts === r0[0].first_received_ts && r1[0].conflict === 0, JSON.stringify(r1));
    }

    section('[2] fecha futura o incoherente');
    {
        const t = Date.now();
        // El dispositivo tiene el reloj tres días adelantado: sesión y marca de orden «en el futuro».
        const fut = await sync('ra-1', 'c6', { canonicalProgress: cp(30), updatedAt: iso(t + 3 * DAY), session: ses('s-fut', t + 3 * DAY, 60) });
        const stored = await own('ra-1', 'c6');
        ok('el guardado con fecha futura se acepta, pero su marca de orden no queda en el futuro', fut.status === 200 && Date.parse(stored.updatedAt) <= Date.now() + 5 * 60_000 && Date.parse(stored.updatedAt) >= t - 1000, stored.updatedAt);
        // El reloj se corrige: el siguiente guardado, con la hora real, ya no queda bloqueado durante tres días.
        const next = await sync('ra-1', 'c6', { canonicalProgress: cp(35), updatedAt: iso(Date.now()), session: ses('s-real', Date.now() - 20_000, 20) });
        ok('…y el siguiente guardado con la hora real NO se descarta', next.status === 200 && !next.json.ignored && (await own('ra-1', 'c6')).canonicalProgress.globalPercentage === 35, next.text.slice(0, 200));
        const rs = await both(LIST('ra-1'), C['med-a']);
        const h = hist(rs[0].json, 'c6');
        ok('ante el mediador la sesión futura NO acredita la obra: sin porcentaje, identificada con su motivo', all200(rs) && same(rs) && !verified(rs[0].json, 'c6') && h?.attribution === 'unverifiable_history'
            && h.reason === 'unverified_session_dates' && h?.unverifiedSessions === 1 && !('canonicalProgress' in h), st(rs));
        ok('…y la sesión con fecha coherente sí consta (1 sesión, con fecha no futura)', h?.verifiedSessions === 1 && Date.parse(h?.lastVerifiedAt) <= Date.now());

        // Fechas que no son fechas (cliente defectuoso).
        const bad = await sync('ra-2', 'c7', { canonicalProgress: cp(10), updatedAt: 'tampoco-es-fecha', session: { sessionId: 'g1', startedAt: 'no-es-fecha', durationSec: 'x' } });
        const g = await own('ra-2', 'c7');
        ok('fechas que no son fechas: guardado aceptado con marcas válidas del servidor (ni basura ni NaN)', bad.status === 200 && Number.isFinite(Date.parse(g.updatedAt)) && Number.isFinite(Date.parse(g.history[0].startedAt))
            && g.history[0].durationSec === 0, JSON.stringify(g).slice(0, 300));
        const ok2 = await sync('ra-2', 'c7', { canonicalProgress: cp(15), updatedAt: iso(Date.now()), session: ses('g2', Date.now() - 10_000, 10) });
        ok('…y el progreso no queda bloqueado para siempre', ok2.status === 200 && !ok2.json.ignored && (await own('ra-2', 'c7')).canonicalProgress.globalPercentage === 15, ok2.text.slice(0, 200));
        const r2 = await both(LIST('ra-2'), C['med-a']);
        ok('una sesión sin fecha declarada vale por la recepción del servidor: obra acreditada', all200(r2) && verified(r2[0].json, 'c7')?.canonicalProgress.globalPercentage === 15, st(r2));
    }

    section('[3] reloj del dispositivo incorrecto');
    {
        const t = Date.now();
        // Atrasado 30 días: la sesión se declara antes de que c2 se asignara al curso (hace 10 días).
        await sync('ra-4', 'c2', { canonicalProgress: cp(25), updatedAt: iso(t - 30 * DAY), session: ses('s-slow', t - 30 * DAY, 300) });
        const rs = await both(LIST('ra-4'), C['med-a']);
        const h = hist(rs[0].json, 'c2');
        ok('reloj atrasado: la lectura no se atribuye a un periodo que no consta (no acreditada, sin porcentaje)', all200(rs) && same(rs) && !verified(rs[0].json, 'c2') && h?.reason === 'started_before_course' && h?.verifiedSessions === 0, st(rs));
        // Adelantado dos minutos: dentro de la tolerancia.
        await sync('ra-8', 'c5', { canonicalProgress: cp(12), updatedAt: iso(Date.now() + 120_000), session: ses('s-skew', Date.now() + 120_000, 30) });
        const r8 = await both(LIST('ra-8'), C['med-a']);
        ok('desfase de dos minutos: dentro de la tolerancia, acreditada', all200(r8) && verified(r8[0].json, 'c5')?.canonicalProgress.globalPercentage === 12, st(r8));
        // La misma sesión vuelve con otra fecha de inicio.
        const t2 = Date.now();
        await sync('ra-1', 'c7', { canonicalProgress: cp(20), updatedAt: iso(t2 - 1000), session: ses('s-x', t2 - 120_000, 100) });
        await sync('ra-1', 'c7', { canonicalProgress: cp(22), updatedAt: iso(Date.now()), session: ses('s-x', t2 - 3 * DAY, 100) });
        const mine = await own('ra-1', 'c7');
        ok('la misma sesión reenviada con otra fecha: el historial del lector conserva la primera', mine.history.length === 1 && mine.history[0].startedAt === iso(t2 - 120_000), JSON.stringify(mine.history));
        const r1 = await both(LIST('ra-1'), C['med-a']);
        ok('…y ante el mediador esa sesión deja de acreditarse (fechas contradictorias)', all200(r1) && !verified(r1[0].json, 'c7') && hist(r1[0].json, 'c7')?.reason === 'unverified_session_dates'
            && hist(r1[0].json, 'c7')?.verifiedSessions === 0 && receiptsOf('ra-1', 'c7')[0]?.conflict === 1, st(r1));
    }

    section('[4] sincronización tardía legítima (contrato de LU) · [5] orden invertido');
    {
        // LU: leyó sin conexión hace dos días y sincroniza hoy. Misma forma de cuerpo, ruta `/api/progress/my/:c`.
        const lu = await sync('ra-6', 'c1', { canonicalProgress: cp(45), updatedAt: iso(at(2) + 900_000), session: ses('lu-1', at(2), 900) }, { lu: true });
        const mine = await own('ra-6', 'c1');
        ok('lectura sin conexión sincronizada dos días después: aceptada, con SU fecha (no la de recepción)', lu.status === 200 && mine.history[0].startedAt === iso(at(2)) && mine.updatedAt === iso(at(2) + 900_000)
            && mine.canonicalProgress.globalPercentage === 45, JSON.stringify(mine).slice(0, 300));
        const rs = await both(LIST('ra-6'), C['med-a']);
        ok('…y acreditada ante el mediador: el curso y la asignación no cambiaron entre la lectura y la recepción', all200(rs) && same(rs) && verified(rs[0].json, 'c1')?.canonicalProgress.globalPercentage === 45, st(rs));
        const rc = receiptsOf('ra-6', 'c1')[0];
        ok('la constancia guarda las dos cosas: fecha declarada (hace dos días) y recepción (hoy)', rc?.declared_start_ts === at(2) && rc?.first_received_ts > at(2) + DAY, JSON.stringify(rc));
        // LU sin sesión (solo porcentaje): no hay fecha que acreditar.
        await sync('ra-6', 'c5', { canonicalProgress: cp(50), updatedAt: iso(Date.now()) }, { lu: true });
        const r6 = await both(LIST('ra-6'), C['med-a']);
        ok('guardado sin sesión: el avance del lector se conserva y ante el mediador es acumulado sin fecha', (await own('ra-6', 'c5')).canonicalProgress.globalPercentage === 50 && !verified(r6[0].json, 'c5')
            && hist(r6[0].json, 'c5')?.reason === 'undated_progress' && !/globalPercentage|canonicalProgress/.test(JSON.stringify(r6[0].json.historicalProgress)), st(r6));

        // Orden invertido: primero llega el guardado reciente y después el de la lectura sin conexión, más antiguo.
        const t = Date.now();
        await sync('ra-2', 'c1', { canonicalProgress: cp(60), updatedAt: iso(t - 1000), session: ses('new', t - 30_000, 25) });
        const late = await sync('ra-2', 'c1', { canonicalProgress: cp(20), updatedAt: iso(at(2) + 600_000), session: ses('old', at(2), 600) });
        const m2 = await own('ra-2', 'c1');
        ok('guardado antiguo recibido después: la posición no retrocede…', late.status === 200 && late.json.ignored === true && m2.canonicalProgress.globalPercentage === 60 && m2.updatedAt === iso(t - 1000), late.text.slice(0, 200));
        ok('…pero su sesión, que es lectura real, no desaparece del historial del lector', m2.history.map((h) => h.sessionId).sort().join() === 'new,old' && m2.history.find((h) => h.sessionId === 'old').startedAt === iso(at(2)), JSON.stringify(m2.history));
        const r2 = await both(LIST('ra-2'), C['med-a']);
        ok('…y las dos sesiones constan ante el mediador: obra acreditada con su avance', all200(r2) && same(r2) && verified(r2[0].json, 'c1')?.canonicalProgress.globalPercentage === 60 && receiptsOf('ra-2', 'c1').length === 2, st(r2));
    }

    section('[6] cambios de membresía y de asignación durante el periodo sin conexión');
    {
        // ra-3 entró al curso hace 10 días.
        await sync('ra-3', 'c1', { canonicalProgress: cp(30), updatedAt: iso(at(15) + 600_000), session: ses('pre', at(15), 600) });
        await sync('ra-3', 'c1', { canonicalProgress: cp(55), updatedAt: iso(at(5) + 600_000), session: ses('post', at(5), 600) });
        const r3 = await both(LIST('ra-3'), C['med-a']);
        const h3 = hist(r3[0].json, 'c1');
        ok('lectura anterior al ingreso del lector: no se atribuye; la posterior sí consta (1 sesión, 10 min)', all200(r3) && same(r3) && !verified(r3[0].json, 'c1') && h3?.reason === 'started_before_course'
            && h3?.verifiedSessions === 1 && h3?.verifiedReadingTimeMs === 600_000 && !('canonicalProgress' in h3), st(r3));
        // ra-5 salió del curso hace 2 días y volvió hace 1. Declara una lectura sin conexión de hace 5 días.
        await sync('ra-5', 'c1', { canonicalProgress: cp(33), updatedAt: iso(at(5) + 600_000), session: ses('away', at(5), 600) });
        await sync('ra-5', 'c1', { canonicalProgress: cp(36), updatedAt: iso(Date.now()), session: ses('back', Date.now() - 30_000, 25) });
        const r5 = await both(LIST('ra-5'), C['med-a']);
        const h5 = hist(r5[0].json, 'c1');
        ok('la membresía cambió entre la fecha declarada y la recepción: esa sesión no se acredita (solo la fecha del dispositivo la sitúa)', all200(r5) && same(r5) && !verified(r5[0].json, 'c1')
            && h5?.reason === 'unverified_session_dates' && h5?.unverifiedSessions === 1, st(r5));
        ok('…la sesión en línea posterior sí consta, y el lector conserva todo su avance', h5?.verifiedSessions === 1 && (await own('ra-5', 'c1')).canonicalProgress.globalPercentage === 36 && (await own('ra-5', 'c1')).history.length === 2);
    }

    section('[7] más de 20 sesiones por obra');
    {
        const t = Date.now();
        let bad = 0;
        for (let i = 0; i < 25; i++) {
            const startMs = t - (26 - i) * 20_000;
            const r = await sync('ra-4', 'c5', { canonicalProgress: cp(2 * (i + 1)), updatedAt: iso(startMs + 10_000), session: ses(`long-${i}`, startMs, 10) });
            if (r.status !== 200 || r.json.ignored) bad++;
        }
        const mine = await own('ra-4', 'c5');
        ok('25 sesiones guardadas; el historial propio del lector sigue recortado a las 20 últimas (sin cambios)', bad === 0 && mine.history.length === 20 && mine.history[0].sessionId === 'long-5' && mine.canonicalProgress.globalPercentage === 50, `${bad} ${mine.history.length}`);
        ok('el servidor tiene constancia de las 25, la primera desde el origen del progreso', receiptsOf('ra-4', 'c5').length === 25 && receiptsOf('ra-4', 'c5').filter((r) => r.from_origin === 1).length === 1);
        const rs = await both(LIST('ra-4'), C['med-a']);
        ok('el recorte ya no impide acreditar: obra del curso con su avance (antes «session_history_truncated»)', all200(rs) && same(rs) && verified(rs[0].json, 'c5')?.canonicalProgress.globalPercentage === 50 && !hist(rs[0].json, 'c5'), st(rs));
        const it = await both(ITEM('ra-4', 'c5'), C['med-a']);
        ok('por obra: acreditada', it.every((r) => r.status === 200 && r.json.attribution === 'verified_context' && r.json.progress.canonicalProgress.globalPercentage === 50), st(it));
    }

    section('[8] historia anterior no verificable');
    {
        const r0 = await both(LIST('ra-7'), C['med-a']);
        const h0 = hist(r0[0].json, 'c1');
        ok('progreso anterior al registro de recepciones: no se certifica ni se reconstruye (2 sesiones sin constancia)', all200(r0) && same(r0) && !verified(r0[0].json, 'c1') && h0?.reason === 'unverified_session_dates'
            && h0?.unverifiedSessions === 2 && h0?.verifiedSessions === 0 && !/globalPercentage/.test(r0[0].text), st(r0));
        ok('…ni se inventan constancias para esas sesiones', receiptsOf('ra-7', 'c1').length === 0);
        await sync('ra-7', 'c1', { canonicalProgress: cp(75), updatedAt: iso(Date.now()), session: ses('fresh', Date.now() - 40_000, 35) });
        const r1 = await both(LIST('ra-7'), C['med-a']);
        const h1 = hist(r1[0].json, 'c1');
        ok('una sesión nueva sí consta desde ahora (1), sin convertir el acumulado antiguo en acreditado', !verified(r1[0].json, 'c1') && h1?.verifiedSessions === 1 && h1?.unverifiedSessions === 2 && !/globalPercentage/.test(r1[0].text)
            && receiptsOf('ra-7', 'c1').length === 1 && receiptsOf('ra-7', 'c1')[0]?.from_origin === 0, st(r1));
        // Guardado recibido por una réplica con el registro apagado: no hay constancia ⇒ no se acredita.
        const off = await sync('ra-8', 'c1', { canonicalProgress: cp(18), updatedAt: iso(Date.now()), session: ses('no-receipt', Date.now() - 20_000, 15) }, { on: S3 });
        const r8 = await both(LIST('ra-8'), C['med-a']);
        ok('guardado sin constancia de recepción (registro apagado en esa réplica): conservado para el lector, no acreditado', off.status === 200 && receiptsOf('ra-8', 'c1').length === 0 && !verified(r8[0].json, 'c1')
            && hist(r8[0].json, 'c1')?.reason === 'unverified_session_dates' && (await own('ra-8', 'c1')).canonicalProgress.globalPercentage === 18, st(r8));
        const offMed = await get(S3, LIST('ra-1'), await login(S3, 'med-a'));
        ok('con el registro apagado nada se certifica y nada desaparece (regla anterior intacta)', offMed.status === 200 && offMed.json.progressList.length === 0 && ids(offMed.json.historicalProgress) === 'c1,c6,c7'
            && offMed.json.historicalProgress.every((h) => h.reason === 'provenance_not_verifiable' && !('unverifiedSessions' in h)), offMed.text.slice(0, 300));
    }

    section('[9] lectura personal B2C excluida · otra institución');
    {
        await sync('ra-1', 'c3', { canonicalProgress: cp(66), updatedAt: iso(Date.now()), session: ses('own-buy', Date.now() - 30_000, 25) });
        await sync('b2c-1', 'c3', { canonicalProgress: cp(80), updatedAt: iso(Date.now()), session: ses('b2c', Date.now() - 30_000, 25) });
        await sync('rb-1', 'cb', { canonicalProgress: cp(44), updatedAt: iso(Date.now()), session: ses('b-1', Date.now() - 30_000, 25) });
        const rs = await both(LIST('ra-1'), C['med-a']);
        ok('la compra personal del lector no aparece ante el mediador, aunque tenga constancia de recepción', all200(rs) && !/"c3"/.test(rs[0].text) && !/"globalPercentage":66/.test(rs[0].text) && receiptsOf('ra-1', 'c3').length === 1, st(rs));
        ok('una cuenta B2C sigue denegada a cualquier mediador', (await both(LIST('b2c-1'), C['med-a'])).every((r) => r.status === 403));
        const b = await both(LIST('rb-1'), C['med-b']);
        ok('la otra institución acredita lo suyo…', all200(b) && same(b) && verified(b[0].json, 'cb')?.canonicalProgress.globalPercentage === 44, st(b));
        ok('…y ninguna ve a los lectores de la otra', (await both(LIST('rb-1'), C['med-a'])).every((r) => r.status === 403) && (await both(LIST('ra-1'), C['med-b'])).every((r) => r.status === 403));
    }

    section('[14] eventos heredados (analytics): fecha declarada frente a recepción');
    {
        const t = Date.now();
        const evs = (startTs) => [{ event: 'session_start', userId: 'ra-1', contentId: 'c1', timestamp: startTs, streak: 0 }, { event: 'block_complete', userId: 'ra-1', contentId: 'c1', timestamp: startTs + 1000, streak: 1 },
            { event: 'session_end', userId: 'ra-1', contentId: 'c1', timestamp: startTs + 40_000, sessionDuration: 40_000, progressPercentage: 40 }];
        const good = await post(S1, '/api/analytics/events', C['ra-1'], evs(t - 50_000));
        const future = await post(S2, '/api/analytics/events', C['ra-1'], evs(t + 3 * DAY));
        const stored = JSON.parse(fs.readFileSync(path.join(P.data, 'analytics_db.json'), 'utf8'));
        ok('eventos con fecha coherente: guardados con el sello de recepción del servidor', good.status === 200 && good.json.received === 3 && stored.length === 3 && stored.every((e) => e.receivedAt >= t && e.timestamp <= e.receivedAt), JSON.stringify(stored).slice(0, 300));
        ok('eventos fechados tres días en el futuro: no entran en el almacén', future.status === 200 && future.json.received === 0, future.text);
        const forged = await post(S1, '/api/analytics/events', C['ra-1'], [{ event: 'session_start', userId: 'ra-1', contentId: 'c5', timestamp: t - 20_000, streak: 0, receivedAt: 1 }]);
        ok('el sello de recepción no lo fija el cliente', forged.status === 200 && JSON.parse(fs.readFileSync(path.join(P.data, 'analytics_db.json'), 'utf8')).find((e) => e.contentId === 'c5').receivedAt >= t);
        const m = await both(METRICS('g-a'), C['med-a']);
        // V9 65D-1: el tablero suma además la sesión real del progreso de c6 (sin telemetría); la «del futuro» de c6 no se acredita.
        ok('en el tablero del curso ra-1 tiene sus sesiones reales (2 por telemetría + la real de c6 por el progreso), ninguna «del futuro»', all200(m) && m.every((x) => breakdown(x.json, 'ra-1')?.totalSessions === 3 && breakdown(x.json, 'ra-1')?.progressOnlySessions === 1), JSON.stringify(breakdown(m[0].json, 'ra-1')).slice(0, 300));
    }

    section('[13] estado individual, informes de curso, resumen y Leo coherentes');
    {
        const s4 = await both(STATUS('ra-4'), C['med-a']), s7 = await both(STATUS('ra-7'), C['med-a']);
        ok('estado de ra-4: una obra acreditada (la de 25 sesiones) y una aparte (reloj atrasado)', all200(s4) && same(s4) && s4[0].json.progress.booksStarted === 1 && s4[0].json.progress.unverifiableHistory === 1
            && s4[0].json.progress.percentage === 50 && s4[0].json.state === 'ACTIVE_PROGRESS', st(s4));
        ok('estado de ra-7: su lectura antigua no se le niega ni se certifica; cuenta la sesión nueva', s7.every((r) => r.status === 200 && r.json.progress.booksStarted === 0 && r.json.progress.unverifiableHistory === 1
            && r.json.state !== 'ACTIVE_NO_PROGRESS'), st(s7));
        const m = await both(METRICS('g-a'), C['med-a']), rep = await both(REPORT('g-a'), C['med-a']), sum = await both(SUMMARY('g-a'), C['med-a']);
        const ca = m[0].json.courseAttribution;
        // Acreditadas: ra-1 c1 · ra-2 c1, c7 · ra-4 c5 · ra-6 c1 · ra-8 c5 = 6. No acreditables: ra-1 c6, c7 · ra-3 c1 · ra-4 c2 · ra-5 c1 · ra-6 c5 · ra-7 c1 · ra-8 c1 = 8.
        ok('métricas del curso: recuento de atribución exacto', all200(m) && ca.verified_context === 6 && ca.unverifiable_history === 8 && ca.readers_with_unverifiable_history === 7, JSON.stringify(ca));
        ok('informe del curso: el mismo recuento', all200(rep) && JSON.stringify(rep[0].json.courseAttribution) === JSON.stringify(ca) && JSON.stringify(rep[1].json.courseAttribution) === JSON.stringify(ca), JSON.stringify(rep[0].json.courseAttribution));
        const r4 = sum[0].json.readers.find((x) => x.userId === 'ra-4'), r7 = sum[0].json.readers.find((x) => x.userId === 'ra-7');
        ok('resumen del grupo: mismas cifras por lector, en las dos réplicas', all200(sum) && r4.courseAttribution.verified_context === 1 && r4.courseAttribution.unverifiable_history === 1 && r7.courseAttribution.verified_context === 0
            && r7.courseAttribution.unverifiable_history === 1 && JSON.stringify(sum[1].json.courseAttribution) === JSON.stringify(sum[0].json.courseAttribution), JSON.stringify([r4?.courseAttribution, r7?.courseAttribution]));
        ok('resumen del grupo: la obra de 25 sesiones es el libro iniciado de ra-4 (50 %); ra-7 no tiene ninguno acreditado', r4.progress?.booksStarted === 1 && r4.progress?.averagePercent === 50 && r7.progress?.booksStarted === 0
            && sum[0].json.courseAttribution.verified_context === 6, JSON.stringify([r4, r7]).slice(0, 400));
        const leo = await both(LEO('ra-1'), C['med-a']);
        ok('Leo del mediador sigue disponible', all200(leo), st(leo));
        const iv = await both('/api/interventions/student/ra-4', C['med-a']), ef = await both('/api/interventions/effectiveness', C['med-a']);
        ok('indicadores de intervenciones: siguen respondiendo', all200(iv) && all200(ef), st(iv));
    }

    section('[10] historial propio conservado · administración');
    {
        const o1 = await both(LIST('ra-1'), C['ra-1']);
        const pct = (j, c) => j.progressList.find((p) => p.contentId === c)?.canonicalProgress.globalPercentage;
        ok('el lector ve todas sus obras con su avance, sin marcas de atribución', all200(o1) && ids(o1[0].json.progressList) === 'c1,c3,c6,c7' && !('historicalProgress' in o1[0].json)
            && pct(o1[0].json, 'c6') === 35 && pct(o1[0].json, 'c7') === 22 && pct(o1[0].json, 'c3') === 66, st(o1));
        const c6 = o1[0].json.progressList.find((p) => p.contentId === 'c6');
        ok('…incluida la sesión que declaró con el reloj adelantado: su historial no se reescribe', c6.history.length === 2 && c6.history.some((h) => h.sessionId === 's-fut' && Date.parse(h.startedAt) > Date.now() + DAY));
        ok('la cuenta B2C conserva su progreso', (await both(LIST('b2c-1'), C['b2c-1'])).every((r) => r.status === 200 && pct(r.json, 'c3') === 80));
        ok('la administración conserva la vista completa', (await both(LIST('ra-7'), C.adm)).every((r) => r.status === 200 && pct(r.json, 'c1') === 75 && !('historicalProgress' in r.json)));
        ok('el almacén de progreso solo contiene lo que guardaron los lectores', Progress.getProgressByUser('ra-4').length === 2 && Progress.getProgressItem('ra-7', 'c1').history.length === 3);
    }

    section('[11] revocación A2 / C005');
    {
        const deniedAll = async (u, cookie) => { const out = []; for (const p of [LIST(u), ITEM(u, 'c1'), STATUS(u)]) out.push(...await both(p, cookie)); return out.every((r) => r.status === 403 || r.status === 404) && out.every((r) => !/globalPercentage|historicalProgress/.test(r.text)); };
        Reg.appendDecisions([{ subjectId: 'ra-2', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-65A' }]);
        ok('A2 revocada: denegado de inmediato en las dos réplicas, aunque sus sesiones tengan constancia', await deniedAll('ra-2', C['med-a']) && receiptsOf('ra-2', 'c1').length === 2);
        ok('…y sale del tablero y del recuento del curso', (await both(METRICS('g-a'), C['med-a'])).every((r) => r.status === 200 && !breakdown(r.json, 'ra-2') && r.json.courseAttribution.verified_context === 4));
        ok('…sin dejar de poder guardar su propia lectura', (await sync('ra-2', 'c1', { canonicalProgress: cp(62), updatedAt: iso(Date.now()), session: ses('after-rev', Date.now() - 5000, 5) })).status === 200);
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-65A' }]);
        ok('C005 revocado: denegado de inmediato', await deniedAll('ra-1', C['med-a']) && await deniedAll('ra-4', C['med-a']));
    }

    section('[15] supresión de los datos de una persona');
    {
        for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
        await sleep(300);
        const before = { ra6: receiptsOf('ra-6', 'c1').length + receiptsOf('ra-6', 'c5').length, ra4: receiptsOf('ra-4', 'c5').length };
        Ledger.closeContextLedger();
        const { suppressResidualSources, residualPaths } = await import('../privacy/suppression.mjs');
        const ack = await suppressResidualSources(residualPaths({ CHP_DATA_DIR: P.data, EVENTS_SQLITE_PATH: P.events, ARCHIVE_SQLITE_PATH: path.join(P.data, 'archive-1.db'), PROGRESS_SQLITE_PATH: P.progress,
            LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'), USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), ACCESS_DB: P.access, INSIGHTS_SQLITE_PATH: P.insights }, tmp), 'ra-6');
        ok('la supresión existente elimina también las constancias de recepción de esa persona (sin código nuevo)', before.ra6 === 2 && receiptsOf('ra-6', 'c1').length === 0 && receiptsOf('ra-6', 'c5').length === 0
            && (ack.insights?.rowsRemoved ?? 0) >= 2, JSON.stringify(ack.insights));
        ok('…y solo las suyas', receiptsOf('ra-4', 'c5').length === before.ra4 && before.ra4 === 25);
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2, S3]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { Ledger.closeContextLedger(); Progress.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
