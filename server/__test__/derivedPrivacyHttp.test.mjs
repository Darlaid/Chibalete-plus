/**
 * derivedPrivacyHttp.test.mjs — CHP V9 Bloque III · F5-DP2. Aislamiento de indicadores derivados.
 *
 * Una cuenta institucional que además lee obras compradas por su cuenta. `mx-1` y `tw-1` son gemelos: mismo curso, la
 * MISMA lectura institucional (mismas obras, fechas y minutos, en la web y en LU). `mx-1` tiene además dos libros
 * comprados y mucha lectura personal (web, LU con reenvíos, progreso, Leo). Ningún indicador que reciba otra persona
 * puede distinguirlos: estado, métricas, línea de tiempo, perfil, señales, riesgo, recomendaciones, vector, impacto,
 * cola de atención, agregados de curso y colegio, y el almacén derivado que calculan los motores.
 *
 * server.js REAL, dos réplicas, sesiones reales (enforce); dos instituciones; el materializador y las series corren en
 * la réplica 1 con su planificador real (el clasificador es el del servidor).
 *   [1] reproducción: lectura institucional y personal diferenciadas      [6] almacén derivado (motores)
 *   [2] el titular conserva su historial completo                         [7] dos instituciones y cuentas personales
 *   [3] estado y métricas del estudiante: administración y mediación      [8] contexto cambiado y revocado
 *   [4] Aula Viva individual: administración                              [9] autoridad de máquina
 *   [5] agregados de curso y colegio                                      [10] concurrencia, réplicas y registros
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/. Imprime `TABLA {…}` con las cifras medidas.
 *
 *   node server/__test__/derivedPrivacyHttp.test.mjs
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
    console.log('derivedPrivacyHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1800)), fail++);
const section = (t) => console.log(`\n${t}`);
const TABLA = {};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_f5dp2_'));
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
// g-a (Colegio Alfa): los gemelos mx-1 / tw-1 y cuatro lectores más. mk-1 (con compra) y ck-1 (sin compra) no leen: sus
// filas del almacén derivado llevan una marca sembrada (un almacén calculado ANTES de esta corrección).
// g-z: curso sin obras; po-1 tiene una compra y pz-1 no. g-b (Colegio Beta): mb-1 / tb-1, el mismo par en otra institución.
const GA = ['mx-1', 'tw-1', 'ra-1', 'ra-2', 'ra-3', 'ra-4', 'mk-1', 'ck-1'], GZ = ['po-1', 'pz-1'], GB = ['mb-1', 'tb-1', 'rb-1', 'rb-2', 'rb-3', 'rb-4'];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', ['administrador']), acct('adm2', ['administrador']),
    acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    ...[...GA, ...GZ].map((id) => acct(id, ['lector'], A)), ...GB.map((id) => acct(id, ['lector'], B)),
    acct('pb-1', ['lector'], { b2c: true })]));
const course = (id, name, org, med, members) => ({ id, name, type: 'course', ...org, school: org.colegio, mediatorIds: [med], memberIds: members, studentIds: members });
const GROUPS = [course('g-a', 'Quinto A', A, 'med-a', GA), course('g-z', 'Quinto Z', A, 'med-a', GZ), course('g-a2', 'Sexto A', A, 'med-a', []), course('g-b', 'Quinto Beta', B, 'med-b', GB)];
const b2c = (n, userId, titleIds) => ({ id: `access-b2c-test-order-${n}`, scope: 'user', scopeId: userId, titleIds, collectionIds: [], expiresAt: Date.now() + 300 * 86_400_000,
    b2c: { orderId: n, source: 'test', plan: 'digital', idempotencyKey: `test:order:${n}`, activationAt: Date.now() - 30 * 86_400_000, expiresAt: Date.now() + 300 * 86_400_000 } });
const RULES = [{ id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'c2'], collectionIds: [] }, { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c1'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb1', 'cb2'], collectionIds: [] },
    // Dos libros adquiridos personalmente por mx-1 (dos pedidos); mb-1, mk-1 y po-1, uno; pb-1 es una cuenta personal.
    b2c(1, 'mx-1', ['p1']), b2c(2, 'mx-1', ['p2']), b2c(3, 'mb-1', ['p1']), b2c(4, 'mk-1', ['p1']), b2c(5, 'po-1', ['p1']), b2c(6, 'pb-1', ['p1', 'p2'])];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS)); fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra uno del curso'], ['c2', 'Obra dos del curso'], ['cb1', 'Obra uno de Beta'], ['cb2', 'Obra dos de Beta'], ['p1', 'Compra personal uno'], ['p2', 'Compra personal dos']]
    .map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(P.analytics, '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));

const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
// Leo: las mismas interacciones de curso para los gemelos; mx-1, además, muchas sobre su compra.
const leo = (u, c, n) => Array.from({ length: n }, (_, k) => ({ userId: u, contentId: c, timestamp: NOW - (k + 1) * 3_600_000, type: 'chat' }));
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), JSON.stringify([...leo('mx-1', 'c1', 3), ...leo('tw-1', 'c1', 3), ...leo('mx-1', 'p1', 14), ...leo('mb-1', 'cb1', 3), ...leo('tb-1', 'cb1', 3), ...leo('mb-1', 'p1', 9)]));
const mem = (n) => ({ schemaVersion: 1, interactionCount: n, lastInteractionAt: iso(NOW - 3_600_000), pedagogicalStage: 'comprehension', updatedAt: iso(NOW - 3_600_000) });
fs.writeFileSync(path.join(P.data, 'leo_memory_db.json'), JSON.stringify({ memoryMap: { 'mx-1__c1': mem(3), 'tw-1__c1': mem(3), 'mx-1__p1': mem(41) } }));
const ev = (u, c, i) => ({ id: `ev-${u}-${c}-${i}`, userId: u, contentId: c, timestamp: iso(NOW - (i + 1) * 600_000), evidenceType: 'scaffolded', pedagogicalObjective: 'vocabulary', surface: 'chat' });
fs.writeFileSync(P.evidence, JSON.stringify({ schemaVersion: 1, entries: [...[0, 1].map((i) => ev('mx-1', 'c1', i)), ...[0, 1].map((i) => ev('tw-1', 'c1', i)), ...[0, 1, 2, 3, 4].map((i) => ev('mx-1', 'p1', i))] }));

const REG = a2RegistryPath();
grantA2([...GA, ...GZ, ...GB]); grantC005(['med-a', 'med-b']);
const Ledger = await import('../aulaViva/contextLedger.mjs');
Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
Ledger.closeContextLedger();

// Almacén derivado sembrado con su esquema real para mk-1 (con compra), ck-1 (sin compra) y pb-1 (cuenta personal).
const MARK = 0.8125;
{
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
    for (const u of ['mk-1', 'ck-1', 'pb-1']) {
        const who = `marca-${u}`;
        insertRow(idb, 'user_reading_profiles', { user_id: u, abandono_risk: MARK, engagement_score: MARK, persistencia_score: MARK, last_active_at: NOW - DAY, updated_at: NOW, source_watermark: 1 });
        insertRow(idb, 'signal_snapshots', { scope_type: 'user', scope_id: u, signal_id: 'continuidad_semanal', period: '28d', metric_value: MARK, updated_at: NOW, metadata_json: JSON.stringify({ who }) });
        insertRow(rdb, 'feature_vectors', { user_id: u, features_json: JSON.stringify({ who, f: MARK }) });
        insertRow(pdb, 'pedagogical_risk_history', { user_id: u, source_signals_json: JSON.stringify({ who }) });
        insertRow(pdb, 'pedagogical_recommendations', { recommendation_id: `rec-${u}`, scope_type: 'user', scope_id: u, rule_id: 'r', recommendation_type: 'lectura_guiada', severity: 'critical', created_at: NOW, expires_at: NOW + DAY, explanation_json: JSON.stringify({ who }), rule_ids_json: '[]' });
        insertRow(odb, 'intervention_outcomes', { outcome_id: `out-u-${u}`, intervention_id: `int-${u}`, user_id: u, scope_type: 'user', scope_id: u, intervention_type: 'lectura_guiada', outcome_label: 'worsened', baseline_metrics_json: JSON.stringify({ who }), followup_metrics_json: '{}', delta_metrics_json: '{}', created_at: NOW });
    }
    for (const db of [idb, pdb, odb, rdb]) { try { db.close(); } catch { /* */ } }
}

// Autoridad de máquina (solo si el entorno permite crear su archivo, como en el contenedor de laboratorio).
const SECRET_DIR = '/app/secrets', SECRET_FILE = `${SECRET_DIR}/admin_secret`, MACHINE = crypto.randomBytes(24).toString('hex');
let machine = false;
try { if (!fs.existsSync(SECRET_FILE)) { fs.mkdirSync(SECRET_DIR, { recursive: true }); fs.writeFileSync(SECRET_FILE, MACHINE, { mode: 0o400 }); fs.chmodSync(SECRET_FILE, 0o400); machine = true; } } catch { machine = false; }

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
        // Los motores del almacén derivado corren de verdad en la réplica 1 (con el clasificador del servidor).
        ...(i === 1 ? { AULA_VIVA_SCHEDULER_ENABLED: '1', INSIGHTS_MATERIALIZER_ENABLED: '1', MATERIALIZER_INTERVAL_MS: '1500', ROLLUPS_ENABLED: '1', ROLLUPS_INTERVAL_MS: '1500' } : {}),
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`server not ready: ${last}\n${s.out.slice(-1500)}`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie, headers = {}) => parse(await fetch(`${s.base}${p}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } }));
const send = async (s, method, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method, headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body ?? {}) }));
const post = (s, p, cookie, body) => send(s, 'POST', p, cookie, body);
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};
const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 320)}`).join(' | ');
const sql = (file, q, ...a) => { const db = new Database(file, { readonly: true, fileMustExist: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };

// ── Lectura ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Sesión web como hechos canónicos en events.db, con fecha exacta (la misma para los gemelos). */
const insertWebSessions = (userId, plan) => {
    const db = new Database(P.events); db.pragma('busy_timeout = 5000');
    const ins = db.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
        VALUES (?, 1, ?, 'text', ?, ?, ?, ?, ?, ?, NULL, '{}', ?)`);
    db.transaction(() => {
        plan.forEach((s, k) => {
            const sid = `web-${userId}-${s.contentId}-${k}`, row = (name, ts, elapsed) => ins.run(`${sid}-${name}-${ts}`, name, userId, s.contentId, sid, ts, ts, elapsed, ts);
            row('reading_started', s.startMs, null);
            for (let m = 1; m < s.minutes; m++) row('session_heartbeat', s.startMs + m * MIN, m * MIN);
            row('session_ended', s.startMs + s.minutes * MIN, s.minutes * MIN);
        });
    })();
    db.close();
};
const luEvent = (userId, contentId, event, ts, extra = {}) => ({ eventId: crypto.randomUUID(), userId, event, timestamp: ts, contentId, source: 'lu_android', ...extra });
const luSession = (userId, contentId, startMs, minutes) => {
    const evs = [luEvent(userId, contentId, 'session_start', startMs)];
    for (let m = 1; m < minutes; m++) evs.push(luEvent(userId, contentId, 'session_heartbeat', startMs + m * MIN, { elapsedMs: m * MIN }));
    evs.push(luEvent(userId, contentId, 'session_end', startMs + minutes * MIN, { sessionDuration: minutes * MIN, elapsedMs: minutes * MIN, progressPercentage: 35 }));
    return evs;
};
const nativeEvt = (userId, contentId, sid, action, extra = {}) => ({ eventId: crypto.randomUUID(), schemaVersion: 1, event: `text.${action}`, mode: 'text', userId, contentId, sessionId: sid, clientTs: Date.now(), ...extra });
const webNative = (userId, contentId, minutes) => { const sid = crypto.randomUUID();
    return { events: [nativeEvt(userId, contentId, sid, 'session_start'), nativeEvt(userId, contentId, sid, 'session_heartbeat', { elapsedMs: 60_000 }), nativeEvt(userId, contentId, sid, 'session_end', { elapsedMs: minutes * MIN, progressFraction: 0.4 })] }; };
const pbody = (sid, idx, pct, startMs, minutes) => ({ canonicalProgress: { sentenceIndex: idx, totalSentences: 99999, globalPercentage: pct, lastInteractedMode: 'text' }, updatedAt: iso(Date.now()),
    session: { sessionId: sid, startedAt: iso(startMs), durationSec: minutes * 60, mode: 'text' } });
// Lectura INSTITUCIONAL de cada par: tres sesiones web en tres días, dos obras del curso, 30 min; y 9 min en LU.
const planOf = (w1, w2) => [[6, w1, 12], [3, w2, 8], [1, w1, 10]].map(([d, contentId, minutes]) => ({ startMs: NOW - d * DAY - 90 * MIN, contentId, minutes }));
const LU_AT = NOW - 2 * DAY - 200 * MIN;
// Lectura PERSONAL de mx-1: cuatro sesiones web largas en días que no coinciden con los del curso, LU y una sesión de hoy.
const PERSONAL = [[5, 'p1', 45], [4, 'p2', 40], [2, 'p1', 50], [0, 'p2', 25]].map(([d, contentId, minutes]) => ({ startMs: NOW - d * DAY - 300 * MIN, contentId, minutes }));
const SENT = { 'mx-1:p1': 42424, 'mx-1:p2': 43434, 'mb-1:p1': 44444, 'pb-1:p1': 45454, 'po-1:p1': 46464 };
const leak = (text) => /"p1"|"p2"|Compra personal|(?<![0-9.])(42424|43434|44444|45454|46464)(?![0-9])/.test(text);

// Comparación entre gemelos: el mismo cuerpo, sin identificadores ni instantes de cálculo.
const VOLATILE = /(^|_)(generatedAt|computedAt|computed_at|updated_at|updatedAt|digest|eventId|event_id|sessionId|recommendation_id|risk_id|ts|requestId|fetchedAt|recorded_at|lastLoginAt|lastReadingEventAt|windowFrom|windowTo)$/;
const norm = (v, ids) => {
    if (Array.isArray(v)) return v.map((x) => norm(x, ids));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x, ids)]));
    if (typeof v === 'string') { let s = v; for (const id of ids) s = s.split(id).join('LECTOR'); return s; }
    return v;
};
const same = (a, b, ids) => JSON.stringify(norm(a, ids)) === JSON.stringify(norm(b, ids));
const diffOf = (a, b, ids, at = '') => {
    const x = norm(a, ids), y = norm(b, ids), out = [];
    const walk = (p, q, where) => {
        if (out.length > 8) return;
        if (p && q && typeof p === 'object' && typeof q === 'object') { for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) walk(p[k], q[k], `${where}.${k}`); return; }
        if (JSON.stringify(p) !== JSON.stringify(q)) out.push(`${where}: ${JSON.stringify(p)?.slice(0, 60)} ≠ ${JSON.stringify(q)?.slice(0, 60)}`);
    };
    walk(x, y, at);
    return out.join(' ; ');
};
const sig = (j, id) => (j?.signals_current || []).find((s) => s.signal_id === id)?.metric_value ?? null;
const SCORES = ['persistencia_score', 'diversidad_score', 'engagement_score', 'abandono_risk'];
const shape = (j) => JSON.stringify({ signals: Object.fromEntries((j?.signals_current || []).filter((s) => typeof s.metric_value === 'number').map((s) => [s.signal_id, s.metric_value]).sort()),
    profile: j?.profile_current ? Object.fromEntries(SCORES.map((k) => [k, j.profile_current[k] ?? null])) : null });
const AV = (u) => [`/api/aula-viva/students/${u}/timeline`, `/api/aula-viva/students/${u}/feature-vector`, `/api/aula-viva/students/${u}/risk-history`,
    `/api/aula-viva/students/${u}/signals/continuidad_semanal/timeline`, `/api/aula-viva/recommendations/scope/user/${u}`, `/api/aula-viva/institutional/profile/${u}`,
    `/api/aula-viva/institutional/outcomes/scope/user/${u}`];
const IND = (u, c) => [`/api/students/${u}/status`, `/api/metrics/student/${u}`, `/api/progress/user/${u}`, `/api/reading-progress/${u}`, `/api/leo/mediator/student/${u}`, `/api/leo/activation/${u}`,
    `/api/leo/mediator/student/${u}/content/${c}`, `/api/interventions/student/${u}`, ...AV(u)];
const GRP = (g) => [`/api/groups/${g}/analytics-summary`, `/api/metrics/course/${g}`, `/api/reports/course/${g}`, `/api/groups/${g}/diagnosis`, `/api/aula-viva/cohorts/group/${g}`, `/api/aula-viva/cohorts/group/${g}/rollups`,
    `/api/aula-viva/institutional/outcomes/scope/group/${g}`, `/api/v2/metrics/groups/${g}`];
const GLOBAL = ['/api/metrics/schools', '/api/metrics/school/colegio-alfa', '/api/aula-viva/students-needing-attention', '/api/aula-viva/recommendations', '/api/aula-viva/operational/status', '/api/aula-viva/institutional/status',
    '/api/v2/metrics/organizations', '/api/v2/metrics/organizations/org-a'];

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'adm2', 'med-a', 'med-b', 'mx-1', 'tw-1', 'ra-1', 'mk-1', 'po-1', 'pz-1', 'mb-1', 'tb-1', 'pb-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);

    section('[1] reproducción: una cuenta con lectura institucional y personal, web y LU');
    {
        const w = [];
        // La primera escritura real crea el registro de eventos (una lectura del curso de ra-1 por el visor web).
        w.push(await post(S1, '/api/analytics/events', C['ra-1'], luSession('ra-1', 'c1', NOW - 2 * DAY - 500 * MIN, 6)));
        // Institucional, idéntica en cada par (web con fecha exacta; LU por la ruta real, con la fecha del dispositivo).
        for (const [u, w1, w2] of [['mx-1', 'c1', 'c2'], ['tw-1', 'c1', 'c2'], ['mb-1', 'cb1', 'cb2'], ['tb-1', 'cb1', 'cb2']]) {
            insertWebSessions(u, planOf(w1, w2));
            w.push(await post(S1, '/api/analytics/events', C[u], luSession(u, w2, LU_AT, 9)));
            w.push(await post(S1, `/api/progress/${u}/${w1}/sync`, C[u], pbody(`s-${u}-1`, 310, 40, NOW - 6 * DAY - 90 * MIN, 12)));
            w.push(await post(S2, `/api/progress/${u}/${w2}/sync`, C[u], pbody(`s-${u}-2`, 320, 20, NOW - 3 * DAY - 90 * MIN, 8)));
        }
        for (const u of ['ra-1']) { insertWebSessions(u, [{ startMs: NOW - 2 * DAY, contentId: 'c1', minutes: 6 }]); }
        // Personal de mx-1: web fechada, web de hoy por la ruta real, LU con REENVÍO en las dos réplicas, progreso de sus dos libros.
        insertWebSessions('mx-1', PERSONAL);
        w.push(await post(S1, '/api/v1/events', C['mx-1'], webNative('mx-1', 'p1', 30)));
        const luPersonal = luSession('mx-1', 'p2', NOW - 1 * DAY - 400 * MIN, 35);
        w.push(await post(S1, '/api/analytics/events', C['mx-1'], luPersonal));
        w.push(await post(S2, '/api/analytics/events', C['mx-1'], luPersonal));   // reenvío
        w.push(await post(S1, '/api/analytics/events', C['mx-1'], luPersonal));   // y otro
        w.push(await post(S1, '/api/progress/mx-1/p1/sync', C['mx-1'], pbody('s-mx-p1', SENT['mx-1:p1'], 96, NOW - 5 * DAY - 300 * MIN, 45)));
        w.push(await post(S2, '/api/progress/mx-1/p2/sync', C['mx-1'], pbody('s-mx-p2', SENT['mx-1:p2'], 85, NOW - 4 * DAY - 300 * MIN, 40)));
        w.push(await post(S1, '/api/progress/mx-1/p1/complete', C['mx-1'], {}));
        // La otra institución, una cuenta personal y un lector cuyo curso no tiene obras.
        insertWebSessions('mb-1', [{ startMs: NOW - 5 * DAY - 300 * MIN, contentId: 'p1', minutes: 45 }]);
        w.push(await post(S2, '/api/progress/mb-1/p1/sync', C['mb-1'], pbody('s-mb-p1', SENT['mb-1:p1'], 70, NOW - 5 * DAY - 300 * MIN, 45)));
        insertWebSessions('pb-1', [{ startMs: NOW - 3 * DAY, contentId: 'p1', minutes: 33 }]);
        w.push(await post(S1, '/api/progress/pb-1/p1/sync', C['pb-1'], pbody('s-pb-p1', SENT['pb-1:p1'], 60, NOW - 3 * DAY, 33)));
        insertWebSessions('po-1', [{ startMs: NOW - 3 * DAY, contentId: 'p1', minutes: 20 }]);
        w.push(await post(S2, '/api/progress/po-1/p1/sync', C['po-1'], pbody('s-po-p1', SENT['po-1:p1'], 50, NOW - 3 * DAY, 20)));
        const bad = w.filter((r) => r.status !== 200 && r.status !== 202);
        ok(`lectura registrada por sus rutas reales (${w.length} escrituras, las dos réplicas, LU con dos reenvíos)`, bad.length === 0, st(bad.slice(0, 3)));
        const rows = sql(P.events, `SELECT user_id, content_id, COUNT(*) n FROM events WHERE user_id IN ('mx-1','tw-1') GROUP BY 1, 2 ORDER BY 1, 2`);
        const by = Object.fromEntries(rows.map((r) => [`${r.user_id}:${r.content_id}`, r.n]));
        ok('en el registro de eventos, la lectura institucional de los gemelos es idéntica y la personal existe solo para mx-1', by['mx-1:c1'] === by['tw-1:c1'] && by['mx-1:c2'] === by['tw-1:c2'] && by['mx-1:p1'] > 50 && by['mx-1:p2'] > 50 && !('tw-1:p1' in by), JSON.stringify(by));
        TABLA.eventos = by;
    }
    // El materializador de la réplica 1 procesa el registro (su planificador real).
    {
        let done = false;
        for (let i = 0; i < 160 && !done; i++) {
            await sleep(250);
            try {
                const wm = sql(P.insights, `SELECT last_event_id FROM materializer_state`)[0]?.last_event_id ?? 0;
                const max = sql(P.events, `SELECT MAX(id) m FROM events`)[0].m;
                done = wm >= max && sql(P.insights, `SELECT 1 FROM user_reading_profiles WHERE user_id = 'tw-1'`).length === 1;
            } catch { done = false; }
        }
        ok('el materializador (planificador real de la réplica 1) procesó todo el registro', done, S1.out.split('\n').filter((l) => /scheduler|materializer/i.test(l)).slice(-6).join('\n'));
    }

    section('[2] el titular conserva su historial personal completo');
    {
        const own = await both('/api/progress/user/mx-1', C['mx-1']);
        ok('mx-1 ve sus cuatro obras: las dos del curso y sus dos libros', own.every((r) => r.status === 200 && r.json.progressList.length === 4 && [42424, 43434].every((v) => r.text.includes(String(v)))), st(own));
        const rp = await both('/api/reading-progress/mx-1', C['mx-1']);
        ok('…también en su progreso de lectura', rp.every((r) => r.status === 200 && r.text.includes('"p1"') && r.text.includes('"p2"')), st(rp));
        const mine = await both('/api/metrics/student/mx-1', C['mx-1']), twin = await both('/api/metrics/student/tw-1', C['tw-1']);
        ok('sus métricas propias incluyen su lectura personal (no son las de su gemelo, que solo lee en el curso)', mine.every((r, i) => r.status === 200 && !same(r.json, twin[i].json, ['mx-1', 'tw-1'])), st(mine));
        const s = await both('/api/students/mx-1/status', C['mx-1']);
        ok('su propio estado cuenta sus cuatro obras', s.every((r) => r.status === 200 && r.json.progress.booksStarted === 4 && r.json.progress.booksCompleted >= 1), st(s));
        TABLA.titular = { obras: own[0].json?.progressList?.length, estado: s[0].json?.progress };
        const acc = await both('/api/content/p1/access?userId=mx-1', C['mx-1']);
        ok('y sigue pudiendo abrir sus libros', acc.every((r) => r.status === 200 && r.json.allowed === true), st(acc));
    }

    section('[3] estado y métricas del estudiante: la lectura personal no las mueve');
    for (const [who, label] of [['adm', 'administración'], ['adm2', 'otra cuenta de administración'], ['med-a', 'mediación']]) {
        const a = await both('/api/students/mx-1/status', C[who]), b = await both('/api/students/tw-1/status', C[who]);
        ok(`${label} — estado: mx-1 = tw-1 (libros iniciados, completados, porcentaje, última lectura, mensaje)`, a.every((r, i) => r.status === 200 && b[i].status === 200 && same(r.json, b[i].json, ['mx-1', 'tw-1'])),
            `${diffOf(a[0].json, b[0].json, ['mx-1', 'tw-1'])} | ${st(a)}`);
        ok(`${label} — estado: dos obras, ninguna completada, 30 %`, a.every((r) => r.json?.progress?.booksStarted === 2 && r.json.progress.booksCompleted === 0 && r.json.progress.percentage === 30), JSON.stringify(a.map((r) => r.json?.progress)));
        // La última lectura que ve otra persona es la de sus obras institucionales (anterior a la de su libro, guardada después).
        const ownLast = Date.parse((await get(S1, '/api/students/mx-1/status', C['mx-1'])).json?.lastReadingEventAt);
        ok(`${label} — estado: la «última lectura» no es la de su libro personal`, a.every((r) => Date.parse(r.json?.lastReadingEventAt) < ownLast), `${a[0].json?.lastReadingEventAt} / titular ${new Date(ownLast).toISOString()}`);
        TABLA[`estado:${who}`] = { mx: a[0].json?.progress, tw: b[0].json?.progress, ultima_mx: a[0].json?.lastReadingEventAt, ultima_tw: b[0].json?.lastReadingEventAt };
    }
    {
        const a = await both('/api/metrics/student/mx-1', C.adm), m = await both('/api/metrics/student/mx-1', C['med-a']);
        ok('métricas del estudiante: ni el rol administrador ni la mediación las consultan (solo el titular y la autoridad de máquina; ver [9])', [...a, ...m].every((r) => r.status === 403 && !leak(r.text)), st([...a, ...m]));
        // Curso sin obras: la compra no convierte «sin contenido habilitado» en otra cosa, ni deja verse.
        for (const who of ['adm', 'med-a']) {
            const p = await both('/api/students/po-1/status', C[who]), z = await both('/api/students/pz-1/status', C[who]);
            ok(`${who} — lector de un curso sin obras, con una compra (po-1) y sin ella (pz-1): el mismo estado`, p.every((r, i) => r.status === 200 && same(r.json, z[i].json, ['po-1', 'pz-1'])), `${diffOf(p[0].json, z[0].json, ['po-1', 'pz-1'])}`);
            TABLA[`estado_sin_obras:${who}`] = { po: p[0].json?.state, pz: z[0].json?.state };
        }
        const own = await get(S1, '/api/students/po-1/status', C['po-1']);
        ok('…y po-1 sí ve su propio estado con su libro', own.status === 200 && own.json.progress.booksStarted === 1, own.text.slice(0, 200));
    }

    section('[4] Aula Viva individual ante la administración');
    {
        const tm = await both('/api/aula-viva/students/mx-1/timeline', C.adm), tt = await both('/api/aula-viva/students/tw-1/timeline', C.adm);
        ok('línea de tiempo: señales y perfil de mx-1 = los de tw-1 (tiempo, continuidad, diversidad, persistencia, riesgo)', tm.every((r, i) => r.status === 200 && tt[i].status === 200 && shape(r.json) === shape(tt[i].json) && sig(r.json, 'tiempo_efectivo_lectura') !== null),
            `${shape(tm[0].json)} ≠ ${shape(tt[0].json)}`);
        TABLA.linea_de_tiempo = { mx: JSON.parse(shape(tm[0].json)), tw: JSON.parse(shape(tt[0].json)), estado_mx: tm[0].json?.data_state ?? null };
        ok('…la de mx-1 dice que es su lectura institucional, y la de tw-1 sigue saliendo del almacén', tm.every((r) => r.json?.context?.basis === 'institutional_reading' && r.json.data_state === 'ok') && tt.every((r) => !('data_state' in r.json)), `${tm[0].text.slice(0, 200)}`);
        const fm = await both('/api/aula-viva/students/mx-1/feature-vector', C.adm);
        ok('vector de rasgos de mx-1: calculado con su lectura institucional', fm.every((r) => r.status === 200 && r.json?.context?.basis === 'institutional_reading' && !leak(r.text)), st(fm));
        const all = []; for (const p of AV('mx-1')) all.push(...(await both(p, C.adm)).map((r) => ({ p, ...r })));
        ok('las siete rutas individuales de mx-1 responden 200 y ninguna trae sus obras compradas', all.every((r) => r.status === 200 && !leak(r.text)), st(all.filter((r) => r.status !== 200 || leak(r.text)).slice(0, 3)));
        // Almacén calculado antes de la corrección (marca 0.8125): mk-1 tiene una compra; ck-1 no.
        const mk = []; for (const p of AV('mk-1')) mk.push(...(await both(p, C.adm)).map((r) => ({ p, ...r })));
        ok('un lector con compra cuyo almacén se calculó con toda su actividad (marca sembrada): la administración no recibe esa fila en ninguna ruta', mk.every((r) => r.status === 200 && !/0\.8125|marca-/.test(r.text)), st(mk.filter((r) => /0\.8125|marca-/.test(r.text)).slice(0, 3)));
        const mkT = await get(S1, '/api/aula-viva/students/mk-1/timeline', C.adm);
        ok('…recibe «sin actividad institucional en la ventana», no un perfil ni un riesgo en cero', mkT.json?.data_state === 'no_activity' && mkT.json.profile_current === null && (mkT.json.risks || []).length === 0 && (mkT.json.summaries || []).some((s) => s.id === 'context_no_activity'), mkT.text.slice(0, 300));
        const ck = await both('/api/aula-viva/students/ck-1/timeline', C.adm);
        ok('un lector sin compras conserva el almacén tal cual (sin cambios para la administración)', ck.every((r) => r.status === 200 && r.json?.profile_current?.abandono_risk === MARK && !('data_state' in r.json)), st(ck));
        const q = await both('/api/aula-viva/students-needing-attention', C.adm);
        ok('cola de atención: ck-1 sigue; mk-1 no entra con el riesgo del almacén; la cuenta personal no entra', q.every((r) => r.status === 200 && Array.isArray(r.json) && r.json.some((x) => x.user_id === 'ck-1' && x.abandono_risk === MARK)
            && !r.json.some((x) => x.user_id === 'mk-1' && x.abandono_risk === MARK) && !r.json.some((x) => x.user_id === 'pb-1')), st(q));
        const rq = await both('/api/aula-viva/recommendations/scope/user/mk-1', C.adm);
        ok('recomendaciones de mk-1: ninguna del almacén', rq.every((r) => r.status === 200 && Array.isArray(r.json) && !r.json.some((x) => x.recommendation_id === 'rec-mk-1')), st(rq));
        // La administración puede atender una recomendación de la vista institucional (y solo de esa).
        const recs = (await get(S1, '/api/aula-viva/recommendations/scope/user/mx-1', C.adm)).json || [];
        TABLA.recomendaciones_mx = recs.map((r) => r.rule_id);
        if (recs.length > 0) {
            const ack = await post(S2, `/api/aula-viva/recommendations/${encodeURIComponent(recs[0].recommendation_id)}/ack`, C.adm, {});
            const after = (await get(S1, '/api/aula-viva/recommendations/scope/user/mx-1?includeAcknowledged=1', C.adm)).json || [];
            ok('la administración atiende una recomendación institucional de mx-1 y queda anotada', ack.status === 200 && ack.json?.ok === true && after.some((r) => r.recommendation_id === recs[0].recommendation_id && r.acknowledged === 1), `${ack.status} ${ack.text.slice(0, 160)}`);
            const foreign = await post(S1, `/api/aula-viva/recommendations/${encodeURIComponent(recs[0].recommendation_id)}/ack`, C['med-b'], {});
            ok('…quien media en otra institución no puede marcarla', foreign.status === 403, `${foreign.status}`);
        }
        const stored = await post(S1, '/api/aula-viva/recommendations/rec-ck-1/ack', C.adm, {});
        ok('…y sigue atendiendo las guardadas de un lector sin compras', stored.status === 200 && stored.json?.ok === true, `${stored.status} ${stored.text.slice(0, 160)}`);
        const leoA = await both('/api/leo/mediator/student/mx-1', C.adm), leoB = await both('/api/leo/mediator/student/tw-1', C.adm);
        ok('Leo ante la administración: las interacciones de mx-1 son las de su obra del curso (las mismas que tw-1), sin la compra', leoA.every((r, i) => r.status === 200 && r.json.summary.totalInteractions === leoB[i].json.summary.totalInteractions && !leak(r.text)), `${leoA[0].text.slice(0, 200)} | ${leoB[0].text.slice(0, 200)}`);
        TABLA.leo = { mx: leoA[0].json?.summary?.totalInteractions, tw: leoB[0].json?.summary?.totalInteractions };
    }

    section('[5] agregados de curso y colegio');
    for (const who of ['adm', 'med-a']) {
        const rows = []; for (const p of [...GRP('g-a'), ...(who === 'adm' ? GLOBAL : [])]) rows.push(...(await both(p, C[who])).map((r) => ({ p, ...r })));
        ok(`${who} — ${rows.length} respuestas de curso${who === 'adm' ? ', colegio y globales' : ''}: ninguna trae las obras compradas ni su lectura`, rows.every((r) => !leak(r.text)), st(rows.filter((r) => leak(r.text)).slice(0, 3)));
        const sum = await both('/api/groups/g-a/analytics-summary', C[who]);
        const row = (r, u) => (r.json?.readers || []).find((x) => x.userId === u);
        ok(`${who} — resumen del curso: la fila de mx-1 = la de tw-1`, sum.every((r) => r.status === 200 && row(r, 'mx-1') && same(row(r, 'mx-1'), row(r, 'tw-1'), ['mx-1', 'tw-1'])), `${diffOf(row(sum[0], 'mx-1'), row(sum[0], 'tw-1'), ['mx-1', 'tw-1'])} | ${sum[0].status}`);
        const met = await both('/api/metrics/course/g-a', C[who]);
        if (who === 'med-a') {
            const mrow = (r, u) => (r.json?.studentBreakdown || []).find((x) => x.userId === u);
            ok('med-a — tablero del curso: la fila de mx-1 = la de tw-1', met.every((r) => r.status === 200 && mrow(r, 'mx-1') && same(mrow(r, 'mx-1'), mrow(r, 'tw-1'), ['mx-1', 'tw-1', 'Cuenta'])), `${diffOf(mrow(met[0], 'mx-1'), mrow(met[0], 'tw-1'), ['mx-1', 'tw-1'])}`);
        }
        TABLA[`curso:${who}`] = { resumen_mx_ms: row(sum[0], 'mx-1')?.reading?.allEffectiveMs ?? null, resumen_tw_ms: row(sum[0], 'tw-1')?.reading?.allEffectiveMs ?? null, activos: met[0].json?.summary?.activeStudentCount ?? null };
    }

    section('[6] el almacén derivado que calculan los motores');
    {
        const prof = (u) => sql(P.insights, `SELECT persistencia_score, diversidad_score, engagement_score, abandono_risk, last_active_at FROM user_reading_profiles WHERE user_id = ?`, u)[0] ?? null;
        const snaps = (u) => JSON.stringify(sql(P.insights, `SELECT signal_id, metric_value, confidence FROM signal_snapshots WHERE scope_type = 'user' AND scope_id = ? AND period = '28d' ORDER BY signal_id`, u));
        ok('perfil guardado de mx-1 = el de tw-1 (también la última actividad: la de su lectura del curso)', !!prof('tw-1') && JSON.stringify(prof('mx-1')) === JSON.stringify(prof('tw-1')), `${JSON.stringify(prof('mx-1'))} ≠ ${JSON.stringify(prof('tw-1'))}`);
        ok('señales guardadas de mx-1 = las de tw-1', snaps('mx-1') === snaps('tw-1') && snaps('tw-1').length > 20, `${snaps('mx-1').slice(0, 400)} ≠ ${snaps('tw-1').slice(0, 400)}`);
        ok('igual en la otra institución: mb-1 = tb-1', JSON.stringify(prof('mb-1')) === JSON.stringify(prof('tb-1')) && snaps('mb-1') === snaps('tb-1'), `${JSON.stringify(prof('mb-1'))} ≠ ${JSON.stringify(prof('tb-1'))}`);
        TABLA.almacen = { mx: prof('mx-1'), tw: prof('tw-1') };
        const pb = sql(P.insights, `SELECT updated_at FROM user_reading_profiles WHERE user_id = 'pb-1'`)[0];
        ok('la cuenta personal no se materializa: su fila sembrada no se recalcula con su lectura', !!pb && pb.updated_at === NOW, JSON.stringify(pb));
        ok('un lector cuya única lectura es personal (po-1) no genera perfil ni señales', !prof('po-1') && snaps('po-1') === '[]', `${JSON.stringify(prof('po-1'))} ${snaps('po-1')}`);
        // Series diarias (motor de series, ámbito global): las sesiones de lectura personal no se cuentan.
        // Institucionales: 4 lectores × 3 sesiones web + 2 de ra-1 (web y LU) + 4 de LU = 18. Personales (no entran): 4 web y 1 LU de
        // mx-1, y una de mb-1, de pb-1 y de po-1.
        let started = null;
        for (let i = 0; i < 80 && started !== 18; i++) {
            try { started = sql(P.insights, `SELECT COALESCE(SUM(metric_value), 0) n FROM daily_rollups WHERE scope_type = 'all' AND metric_key = 'sessions_started'`)[0].n; } catch { started = null; }
            if (started !== 18) await sleep(250);
        }
        ok('series diarias globales: 18 sesiones iniciadas, las institucionales (con la lectura personal serían 26)', started === 18, `sessions_started=${started}`);
        TABLA.series = { sesiones_iniciadas: started };
    }

    {   // El clasificador que comparten los motores y las métricas v2 (que no admiten sesión de navegador): sus reglas.
        const PR = await import('../privacy/personalReading.mjs');
        const rows = Object.assign([{ user_id: 'a', content_id: 'c' }, { user_id: 'a', content_id: 'p' }, { user_id: 'pers', content_id: 'c' }, { user_id: 'boom', content_id: 'c' }, { user_id: null, content_id: 'p' }], { truncated: true });
        const untouched = PR.institutionalRows(rows);
        PR.setPersonalReadingResolver((u) => { if (u === 'boom') throw new Error('sin clasificar'); return (c) => u === 'pers' || c === 'p'; });
        const kept = PR.institutionalRows(rows);
        PR.setPersonalReadingResolver(null);
        ok('clasificador: fuera la obra personal y toda la cuenta personal; si no puede clasificar a alguien, sus filas no entran; conserva el orden y la marca de historia recortada; sin registrar, no cambia nada',
            untouched === rows && kept.length === 2 && kept[0] === rows[0] && kept[1] === rows[4] && kept.truncated === true && PR.institutionalRows(rows) === rows, JSON.stringify(kept));
    }

    section('[7] dos instituciones y cuentas personales');
    {
        const a = await both('/api/students/mb-1/status', C['med-b']), b = await both('/api/students/tb-1/status', C['med-b']);
        ok('institución Beta, mediación — estado: mb-1 = tb-1', a.every((r, i) => r.status === 200 && same(r.json, b[i].json, ['mb-1', 'tb-1'])), diffOf(a[0].json, b[0].json, ['mb-1', 'tb-1']));
        const aa = await both('/api/students/mb-1/status', C.adm), ab = await both('/api/students/tb-1/status', C.adm);
        ok('institución Beta, administración — estado: mb-1 = tb-1', aa.every((r, i) => r.status === 200 && same(r.json, ab[i].json, ['mb-1', 'tb-1'])), diffOf(aa[0].json, ab[0].json, ['mb-1', 'tb-1']));
        const ta = await both('/api/aula-viva/students/mb-1/timeline', C.adm), tb = await both('/api/aula-viva/students/tb-1/timeline', C.adm);
        ok('institución Beta, administración — línea de tiempo: mb-1 = tb-1', ta.every((r, i) => r.status === 200 && shape(r.json) === shape(tb[i].json)), `${shape(ta[0].json)} ≠ ${shape(tb[0].json)}`);
        const cross = []; for (const p of [...IND('mx-1', 'c1'), ...GRP('g-a')]) cross.push(...(await both(p, C['med-b'])).map((r) => ({ p, ...r })));
        ok('la mediación de Beta no recibe nada de un lector ni de un curso de Alfa', cross.every((r) => r.status !== 200 || (!/mx-1|tw-1|ra-1/.test(r.text) && !leak(r.text))), st(cross.filter((r) => r.status === 200 && /mx-1|tw-1|ra-1/.test(r.text)).slice(0, 3)));
        const pers = []; for (const who of ['adm', 'adm2', 'med-a']) for (const p of IND('pb-1', 'p1')) pers.push(...(await both(p, C[who])).map((r) => ({ p, who, ...r })));
        const persBad = pers.filter((r) => ![403, 404, 503].includes(r.status) || leak(r.text) || /0\.8125|marca-/.test(r.text));
        ok(`cuenta personal: ${pers.length} consultas de administración y mediación — ninguna entrega indicadores ni la marca de su fila guardada`, persBad.length === 0, persBad.slice(0, 4).map((r) => `${r.who} ${r.p} ${r.status}:${r.text.slice(0, 120)}`).join(' | '));
    }

    section('[8] contexto cambiado y revocado');
    {
        // (a) mx-1 se traslada a otro curso (que solo tiene c1): su lectura personal sigue fuera para todos.
        const mv = await post(S1, '/api/groups/g-a2/members/move', C.adm, { fromGroupId: 'g-a', userIds: ['mx-1'] });
        const sA = await both('/api/students/mx-1/status', C.adm), sM = await both('/api/students/mx-1/status', C['med-a']);
        ok('tras un traslado de curso: la administración ve su lectura institucional (dos obras), la mediación la de su nuevo curso; nunca la personal', mv.status === 200 && sA.every((r) => r.status === 200 && r.json.progress.booksStarted === 2 && !leak(r.text)) && sM.every((r) => r.status === 200 && r.json.progress.booksStarted <= 1 && !leak(r.text)),
            `${mv.status} ${JSON.stringify(sA.map((r) => r.json?.progress))} ${JSON.stringify(sM.map((r) => r.json?.progress))}`);
        const back = await post(S2, '/api/groups/g-a/members/move', C.adm, { fromGroupId: 'g-a2', userIds: ['mx-1'] });
        ok('…y vuelve a su curso', back.status === 200, String(back.status));
        // (b) baja de todos los cursos: sin grupo, sus compras siguen siendo suyas.
        const rm = await send(S1, 'DELETE', '/api/groups/g-b/members/mb-1', C.adm);
        const sB = await both('/api/students/mb-1/status', C.adm), tB = await both('/api/aula-viva/students/mb-1/timeline', C.adm);
        ok('lector dado de baja de su curso: la administración sigue sin recibir su lectura personal (estado y línea de tiempo)', rm.status === 200 && sB.every((r) => r.status === 200 && r.json.progress.booksStarted === 2 && !leak(r.text)) && tB.every((r) => r.status === 200 && !leak(r.text) && r.json?.context?.basis === 'institutional_reading'),
            `${rm.status} ${JSON.stringify(sB.map((r) => r.json?.progress))} ${tB[0].text.slice(0, 160)}`);
        // (c) compra reembolsada (la regla vence y queda anotada, no se borra): su lectura sigue siendo personal.
        const rules = JSON.parse(fs.readFileSync(P.access, 'utf8')).map((r) => (r.id === 'access-b2c-test-order-2' ? { ...r, expiresAt: Date.now() - 1000, b2c: { ...r.b2c, revokedAt: Date.now() - 1000, revokeReason: 'refunded' } } : r));
        const tmpFile = `${P.access}.tmp`; fs.writeFileSync(tmpFile, JSON.stringify(rules)); fs.renameSync(tmpFile, P.access);
        let closed = false;
        for (let i = 0; i < 60 && !closed; i++) { await sleep(250); const d = await both('/api/content/p2/access?userId=mx-1', C['mx-1']); closed = d.every((r) => r.json?.allowed === false); }
        const sR = await both('/api/students/mx-1/status', C.adm), tR = await both('/api/aula-viva/students/mx-1/timeline', C.adm), tT = await both('/api/aula-viva/students/tw-1/timeline', C.adm);
        ok('compra reembolsada: el acceso se cierra y lo que leyó de ese libro sigue sin entrar en ningún indicador institucional', closed && sR.every((r) => r.json?.progress?.booksStarted === 2 && !leak(r.text)) && tR.every((r, i) => shape(r.json) === shape(tT[i].json)),
            `closed=${closed} ${JSON.stringify(sR.map((r) => r.json?.progress))} ${shape(tR[0].json)}`);
        const ownR = await both('/api/progress/user/mx-1', C['mx-1']);
        ok('…y el titular conserva el registro de su lectura', ownR.every((r) => r.status === 200 && r.json.progressList.length === 4), st(ownR));
        // (d) autorizaciones: sin A2 del lector o sin C005 de quien media, nada (el contrato no cambia).
        const Reg = await import('../privacy/a2Registry.mjs');
        const decide = (id, kind, status, capacity) => Reg.appendDecisions([{ subjectId: id, kind, status, actDay: Reg.dayOf(Date.now()), version: kind === 'C005' ? '005@1.0' : '004@1.0', medium: 'paper', capacity, verification: 'verified', requestRef: `F5DP2-SINT-${kind}-${status}-${id}` }]);
        decide('mx-1', 'A2', 'revoked', 'legal_representative');
        const a2 = []; for (const p of IND('mx-1', 'c1')) a2.push(...(await both(p, C['med-a'])).map((r) => ({ p, ...r })));
        const a2Bad = a2.filter((r) => ![403, 404, 503].includes(r.status) || leak(r.text));
        ok('A2 revocada: la mediación no recibe ningún indicador de mx-1', a2Bad.length === 0, a2Bad.slice(0, 4).map((r) => `${r.p} ${r.status}:${r.text.slice(0, 120)}`).join(' | '));
        grantA2(['mx-1']);
        decide('med-a', 'C005', 'revoked', 'mediator');
        const c5 = []; for (const p of [...IND('tw-1', 'c1'), ...GRP('g-a')]) c5.push(...(await both(p, C['med-a'])).map((r) => ({ p, ...r })));
        ok('C005 revocado: la mediación no recibe indicadores de ningún lector ni del curso', c5.every((r) => !r.text.includes('"tw-1"') || r.status !== 200), st(c5.filter((r) => r.status === 200 && r.text.includes('"tw-1"')).slice(0, 3)));
        grantC005(['med-a']);
        const again = await both('/api/students/tw-1/status', C['med-a']);
        ok('con las autorizaciones vigentes de nuevo, vuelve', again.every((r) => r.status === 200 && r.json.progress.booksStarted === 2), st(again));
    }

    section('[9] autoridad de máquina');
    if (machine) {
        const H = { 'x-admin-secret': MACHINE };
        const m = [await get(S1, '/api/metrics/student/mx-1', null, H), await get(S1, '/api/metrics/student/tw-1', null, H), await get(S2, '/api/metrics/student/mx-1', null, H), await get(S2, '/api/metrics/student/tw-1', null, H)];
        ok('máquina — métricas del estudiante: mx-1 = tw-1 en las dos réplicas (sesiones, tiempo, obras, Leo, embudos), sin sus obras compradas', m.every((r) => r.status === 200 && !leak(r.text)) && same(m[0].json, m[1].json, ['mx-1', 'tw-1']) && same(m[2].json, m[3].json, ['mx-1', 'tw-1']), diffOf(m[0].json, m[1].json, ['mx-1', 'tw-1']));
        const own = await get(S1, '/api/metrics/student/mx-1', C['mx-1']);
        const starts = (j) => j?.backboneMetrics?.funnels?.funnels?.reading?.summary?.starts ?? null;
        ok('…y el titular sigue recibiendo las suyas completas (más lecturas iniciadas que las del curso)', own.status === 200 && starts(own.json) > starts(m[0].json), `${starts(own.json)} / ${starts(m[0].json)}`);
        TABLA.metricas_estudiante = { maquina_mx_inicios: starts(m[0].json), maquina_tw_inicios: starts(m[1].json), titular_mx_inicios: starts(own.json) };
        const tech = []; for (const p of ['/api/metrics/course/g-a', '/api/metrics/school/colegio-alfa', '/api/metrics/schools', '/api/progress/user/tw-1', '/api/reading-progress/tw-1', '/api/progress/item/tw-1/c1', '/api/progress/user/mx-1']) tech.push({ p, ...(await get(S2, p, null, H)) });
        ok('máquina — sus consultas legítimas siguen respondiendo: tablero de curso y de colegio, lista de colegios y progreso institucional de un lector', tech.every((r) => r.status === 200), tech.filter((r) => r.status !== 200).map((r) => `${r.p} ${r.status}`).join(' | '));
        ok('…el tablero de curso conserva el desglose por estudiante para la máquina, y nada trae la lectura personal', Array.isArray(tech[0].json?.studentBreakdown) && tech[0].json.studentBreakdown.some((x) => x.userId === 'mx-1') && tech.every((r) => !leak(r.text)), tech[0].text.slice(0, 200));
        ok('…del lector con compras recibe su progreso institucional (dos obras)', tech[6].json?.progressList?.length === 2, tech[6].text.slice(0, 200));
        const pers = [await get(S1, '/api/progress/user/pb-1', null, H), await get(S2, '/api/metrics/student/pb-1', null, H), await get(S1, '/api/reading-progress/pb-1', null, H)];
        ok('máquina — una cuenta personal sigue cerrada, también sus métricas (403 personal_reading_withheld)', pers.every((r) => r.status === 403 && r.json?.error === 'personal_reading_withheld' && !leak(r.text)), st(pers));
        const bad = await get(S1, '/api/metrics/student/mx-1', null, { 'x-admin-secret': `${MACHINE}x` });
        ok('un secreto incorrecto no abre nada', [401, 403].includes(bad.status) && !leak(bad.text), String(bad.status));
    } else {
        console.log('  · autoridad de máquina: no disponible en este entorno (no se pudo crear su archivo); cubierta en el laboratorio');
    }

    section('[10] concurrencia, réplicas y registros');
    {
        const shots = []; let stop = false; const running = [];
        const loop = (async () => { while (!stop) { for (const s of [S1, S2]) for (const [who, p] of [['adm', '/api/students/mx-1/status'], ['adm', '/api/aula-viva/students/mx-1/feature-vector'], ['adm', '/api/aula-viva/students/mx-1/timeline'], ['med-a', '/api/students/mx-1/status'], ['adm2', '/api/aula-viva/students-needing-attention']])
            running.push((async () => { const r = await get(s, p, C[who]); shots.push({ p, who, status: r.status, leak: leak(r.text), started: r.json?.progress?.booksStarted }); })()); await sleep(20); } })();
        // Mientras tanto mx-1 sigue leyendo su libro (web y LU) y consulta lo suyo.
        for (let k = 0; k < 4; k++) { await post(k % 2 ? S1 : S2, '/api/v1/events', C['mx-1'], webNative('mx-1', 'p1', 5 + k)); await post(k % 2 ? S2 : S1, '/api/analytics/events', C['mx-1'], luSession('mx-1', 'p1', Date.now() - (k + 2) * 3_600_000, 4)); await get(S1, '/api/progress/user/mx-1', C['mx-1']); }
        await sleep(250); stop = true; await loop; await Promise.all(running);
        const bad = shots.filter((x) => x.leak || (x.started !== undefined && x.started !== 2) || x.status !== 200);
        ok(`${shots.length} consultas concurrentes de administración y mediación en las dos réplicas mientras mx-1 lee su libro: todas 200, ninguna con su lectura personal, el estado siempre en dos obras`, shots.length > 40 && bad.length === 0, JSON.stringify(bad.slice(0, 4)));
        const logs = `${S1.out}\n${S2.out}`;
        ok('los registros del servidor no contienen la lectura personal (ni centinelas ni posiciones)', !Object.values(SENT).some((v) => new RegExp(`(?<![0-9.])${v}(?![0-9])`).test(logs)) && !/sentenceIndex|globalPercentage/.test(logs));
        ok('ni el secreto de máquina ni contraseñas', !logs.includes(PW) && !logs.includes(MACHINE));
    }

    // V9R RC-1 — /api/v2/metrics/* por HTTP real. Su autoridad válida es la sesión firmada MÁS la identidad declarada
    // (`x-user-id`) igual a la de la sesión; el secreto de máquina no la sustituye.
    section('[11] métricas v2: autoridad, alcance y separación de la lectura personal');
    {
        const V = (id) => ({ 'x-user-id': id });
        const v2 = async (p, who) => [await get(S1, p, C[who], V(who)), await get(S2, p, C[who], V(who))];
        const ORG = '/api/v2/metrics/organizations/org-a', LIST = '/api/v2/metrics/organizations';
        const denied = [await get(S1, ORG, C.adm), await get(S2, ORG, C['mx-1'], V('adm')), await get(S1, ORG, null, V('adm')), await get(S2, '/api/v2/metrics/users/mx-1', null, V('mx-1')),
            ...(machine ? [await get(S1, ORG, null, { 'x-admin-secret': MACHINE }), await get(S2, ORG, null, { 'x-admin-secret': MACHINE, 'x-user-id': 'adm' })] : [])];
        ok('sin identidad declarada, con la de otra cuenta, sin sesión o solo con el secreto de máquina: 401 y sin datos', denied.every((r) => r.status === 401 && !r.json?.metrics && !leak(r.text)), st(denied));

        const aOrg = await v2(ORG, 'adm'), aGrp = await v2('/api/v2/metrics/groups/g-a', 'adm'), aList = await v2(LIST, 'adm');
        ok('administración: organización, grupo y lista responden 200 en las dos réplicas, sin lectura personal', [...aOrg, ...aGrp, ...aList].every((r) => r.status === 200 && !leak(r.text)), st([...aOrg, ...aGrp, ...aList]));
        ok('…la lista de la administración trae las dos instituciones y las cifras de plataforma', aList.every((r) => r.json?.organizations?.length === 2 && r.json?.populations && r.json?.unattributed), aList[0].text.slice(0, 300));
        // Cada métrica por su valor y su estado (el periodo lleva la hora de cada consulta).
        const M = (r) => r.json?.metrics && Object.fromEntries(Object.entries(r.json.metrics).map(([k, v]) => [k, { value: v?.value ?? null, status: v?.status ?? null }]));
        // El tiempo en plataforma sale de las horas de llegada de cada petición: entre gemelos difiere en milisegundos.
        const X = (m) => ({ ...m, platformTimeMs: m?.platformTimeMs && { status: m.platformTimeMs.status } });
        const near = (a, b) => Math.abs((a?.platformTimeMs?.value ?? 0) - (b?.platformTimeMs?.value ?? 0)) < 5000;
        for (const who of ['adm', 'med-a']) {
            const um = await v2('/api/v2/metrics/users/mx-1', who), ut = await v2('/api/v2/metrics/users/tw-1', who);
            ok(`${who}: las métricas del lector con compras son las de su gemelo sin compras (sesiones, tiempo de lectura, obras distintas), en las dos réplicas`,
                [...um, ...ut].every((r) => r.status === 200 && !leak(r.text)) && [0, 1].every((i) => M(um[i]) && same(X(M(um[i])), X(M(ut[i])), ['mx-1', 'tw-1']) && near(M(um[i]), M(ut[i]))), `${st([um[0], ut[0]])} ${diffOf(X(M(um[0])), X(M(ut[0])), ['mx-1', 'tw-1'])} ${M(um[0])?.platformTimeMs?.value}/${M(ut[0])?.platformTimeMs?.value}`);
            if (who === 'adm') TABLA.v2 = { mx: { obras: M(um[0])?.distinctContents?.value ?? null, lectura_ms: M(um[0])?.readingTimeMs?.value ?? null, sesiones: M(um[0])?.sessions?.value ?? null },
                tw: { obras: M(ut[0])?.distinctContents?.value ?? null, lectura_ms: M(ut[0])?.readingTimeMs?.value ?? null, sesiones: M(ut[0])?.sessions?.value ?? null } };
        }
        const pb = [...await v2('/api/v2/metrics/users/pb-1', 'adm'), ...await v2('/api/v2/metrics/users/pb-1', 'med-a')];
        ok('una cuenta personal no entrega actividad a la administración ni a la mediación', pb.every((r) => !leak(r.text) && (r.status === 403 || (r.status === 200 && r.json?.organizationId === null && M(r)?.activeReaders?.value == null))), st(pb));

        const mGrp = await v2('/api/v2/metrics/groups/g-a', 'med-a'), mList = await v2(LIST, 'med-a');
        ok('mediación: su curso responde 200 sin lectura personal', mGrp.every((r) => r.status === 200 && !leak(r.text)), st(mGrp));
        const foreign = []; for (const p of ['/api/v2/metrics/groups/g-b', '/api/v2/metrics/organizations/org-b', '/api/v2/metrics/users/mb-1']) foreign.push(...(await v2(p, 'med-a')).map((r) => ({ p, ...r })));
        ok('mediación: el curso, la institución y el lector de otra institución quedan negados (403)', foreign.every((r) => r.status === 403 && !r.json?.metrics), foreign.map((r) => `${r.p} ${r.status}`).join(' | '));
        ok('mediación: la lista no trae otra institución ni las cifras de plataforma', mList.every((r) => r.status === 200 && (r.json?.organizations || []).every((o) => o.organizationId === 'org-a') && r.json?.populations === null && r.json?.unattributed === null && !leak(r.text)), mList[0].text.slice(0, 300));

        const rList = await v2(LIST, 'mx-1'), rOther = [...await v2(ORG, 'mx-1'), ...await v2('/api/v2/metrics/users/tw-1', 'mx-1'), ...await v2('/api/v2/metrics/groups/g-a', 'mx-1')];
        ok('lector: ninguna organización visible y ninguna cifra de plataforma (antes recibía las poblaciones de toda la plataforma)', rList.every((r) => r.status === 200 && r.json?.organizations?.length === 0 && r.json?.populations === null && r.json?.unattributed === null), rList[0].text.slice(0, 300));
        ok('lector: organización, curso y otro lector negados (403)', rOther.every((r) => r.status === 403 && !r.json?.metrics), st(rOther));
        const rOwn = await v2('/api/v2/metrics/users/mx-1', 'mx-1'), bOwn = await v2('/api/v2/metrics/users/pb-1', 'pb-1');
        ok('titular: esta API es institucional — su consulta propia nunca falla con error del servidor ni mezcla su lectura personal; sus datos completos siguen en sus rutas propias ([1])', [...rOwn, ...bOwn].every((r) => [200, 403].includes(r.status) && !leak(r.text)), st([...rOwn, ...bOwn]));
        TABLA.v2_titular = { lector_colegio: rOwn[0].status, cuenta_personal: bOwn[0].status };
    }

    // V9R RC-1 — señal de cuenta eliminada para Lector Único. Va al final: elimina una cuenta del padrón de prueba.
    section('[12] cuenta eliminada: señal para el dispositivo y consulta de cuentas ausentes');
    {
        const REM = '/api/lu/accounts/removed', gone = 'pz-1';
        const before = await post(S1, REM, C['tw-1'], { ids: [gone, 'mx-1', 'no-existe-1'] });
        ok('antes de la baja: la consulta solo nombra el identificador que no existe', before.status === 200 && JSON.stringify(before.json?.removed) === '["no-existe-1"]', st([before]));
        const bad = [await post(S1, REM, C['tw-1'], {}), await post(S1, REM, C['tw-1'], { ids: [] }), await post(S2, REM, C['tw-1'], { ids: Array.from({ length: 26 }, (_, i) => `u-${i}`) }),
            await post(S2, REM, C['tw-1'], { ids: [7] }), await post(S1, REM, C['tw-1'], { ids: ['x'.repeat(121)] })];
        ok('consulta mal formada o con más de 25 identificadores: 400', bad.every((r) => r.status === 400), st(bad));
        const anon = [await post(S1, REM, '', { ids: [gone] }), await post(S2, REM, 'chp_session=no-es-una-sesion', { ids: [gone] })];
        ok('sin sesión válida la consulta no responde (401)', anon.every((r) => r.status === 401 && !r.json?.removed), st(anon));

        const tDel = Date.now();
        const alive = await get(S1, '/api/offline/assignment', C[gone]);
        const del = await send(S1, 'DELETE', `/api/users/${gone}`, C.adm);
        ok('la administración elimina la cuenta', alive.status === 200 && del.status === 200 && del.json?.success === true, st([alive, del]));

        const sig = [];
        for (const s of [S1, S2]) {
            sig.push({ p: 'assignment', ...(await get(s, '/api/offline/assignment', C[gone])) }, { p: 'me', ...(await get(s, '/api/auth/me', C[gone])) },
                { p: 'sync', ...(await post(s, `/api/progress/${gone}/c1/sync`, C[gone], pbody(`s-${gone}-x`, 300, 10, NOW - DAY, 5))) },
                { p: 'analytics', ...(await post(s, '/api/analytics/events', C[gone], luSession(gone, 'c1', NOW - DAY, 2))) },
                { p: 'removed', ...(await post(s, REM, C[gone], { ids: ['mx-1'] })) });
        }
        ok('la sesión todavía vigente de la cuenta eliminada recibe 401 con `code: account_removed` en las rutas que usa Lector Único (asignación, sesión, progreso, telemetría, consulta), en las dos réplicas',
            sig.length === 10 && sig.every((r) => r.status === 401 && r.json?.code === 'account_removed'), sig.map((r) => `${r.p} ${r.status} ${r.json?.code}`).join(' | '));
        ok('…y nada de lo que envió se guardó', sql(P.events, 'SELECT COUNT(*) n FROM events WHERE user_id = ? AND server_ts >= ?', gone, tDel)[0].n === 0);

        const outCookie = await login(S1, 'tb-1'); const lo = await post(S1, '/api/auth/logout', outCookie, {});
        const plain = [await get(S1, '/api/offline/assignment', ''), await get(S2, '/api/offline/assignment', 'chp_session=no-es-una-sesion'), await get(S2, '/api/offline/assignment', outCookie),
            await post(S1, `/api/progress/tb-1/c1/sync`, outCookie, pbody('s-tb-x', 300, 10, NOW - DAY, 5)), await post(S1, '/api/analytics/events', outCookie, luSession('tb-1', 'c1', NOW - DAY, 2))];
        ok('cualquier otro rechazo (sin sesión, sesión inválida, sesión cerrada) es el 401 de siempre, sin la señal: el dispositivo no borra nada', lo.status === 200 && plain.every((r) => r.status === 401 && r.json?.code === undefined), st(plain));
        const relog = await parse(await fetch(`${S1.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S1.base }, body: JSON.stringify({ email: `${gone}@fixture.invalid`, password: PW }) }));
        ok('el inicio de sesión de la cuenta eliminada responde lo mismo que una credencial incorrecta (no revela la baja a quien no tenía sesión)', relog.status === 401 && relog.json?.code === undefined, st([relog]));

        const after = [await post(S1, REM, C['tw-1'], { ids: [gone, 'mx-1', 'tw-1'] }), await post(S2, REM, C['mx-1'], { ids: [gone, gone, 'tw-1'] })];
        ok('otra cuenta del mismo dispositivo pregunta: la respuesta nombra la cuenta eliminada (una vez) y ninguna que exista, en las dos réplicas', after.every((r) => r.status === 200 && JSON.stringify(r.json?.removed) === `["${gone}"]`), st(after));
        ok('la consulta no devuelve nada más que identificadores enviados', after.every((r) => Object.keys(r.json || {}).join() === 'removed'));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    if (machine) { try { fs.chmodSync(SECRET_FILE, 0o600); fs.rmSync(SECRET_FILE, { force: true }); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nderivedPrivacyHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
