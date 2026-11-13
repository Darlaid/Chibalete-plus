/**
 * suppressionResidualHttp.test.mjs — CHP-V8.1-CLOSE-09A/09B (G-08, fuentes residuales).
 *  09B: insights.db, reenvío B2C, concurrencia de Leo y compactación separada y controlada.
 *
 * Con server.js REAL (dos réplicas, identity.db con dual-write) y datos sintéticos:
 *  [0] siembra de las seis fuentes para `sup` (a suprimir), `xpo` (solo retiro de XP) y `k1`
 *  [1] supresión: eventos propios, progreso y Leo eliminados; auditoría, eventos de terceros y
 *      regla B2C conservados SIN la persona; identity.db sin correo ni nombre; los bytes
 *      antiguos no quedan en los archivos SQLite; `xpo` y `k1` intactos
 *  [2] restauración en cuarentena: el respaldo trae todo de vuelta; conciliación concurrente
 *      desde dos procesos (idempotente); la cuenta restaurada inicia sesión hasta eliminarla;
 *      el retiro de XP no se trata como supresión
 *  [3] puerta de promoción: sin acciones pendientes ni cambios en una pasada más
 *  [4] promoción: ninguna réplica deja entrar a la persona; los demás siguen
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/suppressionResidualHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, grantA1, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ORG = 'org-alfa';
const PW = 'Clave-Sintetica-2026!';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_residual_'));
const stage = (name) => {
    const base = path.join(tmp, name), data = path.join(base, 'data'), crit = path.join(base, 'crit');
    for (const d of [data, crit, path.join(base, 'uploads')]) fs.mkdirSync(d, { recursive: true });
    return {
        base, data, uploads: path.join(base, 'uploads'),
        users: path.join(base, 'users.json'), groups: path.join(base, 'groups.json'), schools: path.join(base, 'schools.json'), content: path.join(base, 'content.json'),
        mook: path.join(data, 'mook_db.json'), subs: path.join(data, 'submissions_db.json'),
        // fuentes residuales (mismos nombres que en producción)
        eventsDb: path.join(crit, 'events.db'), archiveDb: path.join(crit, 'events.archive.db'), progressDb: path.join(data, 'progress.db'),
        progressJson: path.join(data, 'progress_db.json'), leoMemory: path.join(data, 'leo_memory_db.json'), leoProfile: path.join(data, 'leo_profile_db.json'),
        leoInteractions: path.join(data, 'leo_interactions_db.json'), leoEvidence: path.join(data, 'leo_evidence_db.json'),
        audit: path.join(base, 'user_audit_log.json'), access: path.join(base, 'access_db.json'), identityDb: path.join(crit, 'identity.db'), insightsDb: path.join(crit, 'insights.db'),
    };
};
const LIVE = stage('live'), BAK = stage('backup'), Q = stage('quarantine');
const JSON_STORES = ['users', 'groups', 'schools', 'content', 'mook', 'subs', 'progressJson', 'leoMemory', 'leoProfile', 'leoInteractions', 'leoEvidence', 'audit', 'access'];
const SQLITE_STORES = ['eventsDb', 'archiveDb', 'progressDb', 'identityDb', 'insightsDb'];

// Registros independientes (fuera de los respaldos), como en producción.
a2RegistryPath();
const REG = path.join(tmp, 'registries', 'exclusions.jsonl');
fs.mkdirSync(path.dirname(REG)); fs.writeFileSync(REG, '');
process.env.GAMIFICATION_EXCLUSION_REGISTRY = REG;
process.env.EVENTS_SQLITE_PATH = LIVE.eventsDb;
process.env.PROGRESS_SQLITE_PATH = LIVE.progressDb;
process.env.INSIGHTS_SQLITE_PATH = LIVE.insightsDb;

const SUP = await import('../privacy/suppression.mjs');
const X = await import('../gamification/exclusions.mjs');
const R = await import('../privacy/a2Registry.mjs');
const Events = await import('../eventsService.js');
const Progress = await import('../progressService.js');
const Store = await import('../lib/experienceStore.js');

const READERS = ['sup', 'xpo', 'k1'];
const W = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
W(LIVE.users, [
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
    { id: 'med', roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', email: 'med@fixture.invalid' },
    ...READERS.map((id) => ({ id, nombre_completo: `Sint ${id}`, email: `${id}@fixture.invalid`, password: PW, roles: ['lector'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active' })),
]);
W(LIVE.groups, [{ id: 'g-a1', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: ['med'], memberIds: READERS, studentIds: READERS }]);
W(LIVE.schools, [{ id: ORG, name: 'Colegio Alfa' }]); W(LIVE.content, []);
grantA1(READERS); grantA2(READERS); grantC005(['med']);

// MOOK y entregas (G-08 de CLOSE-08A) para comprobar que el retiro de XP no las toca.
const doc = Store.emptyMookStore();
const exp = Store.createExperience(doc, { slug: 'e', title: 'E' });
const ver = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'p', type: 'PRODUCTION', title: 'p', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
Store.publishVersion(doc, ver.id);
for (const u of READERS) Store.submitEvidence(doc, { runId: Store.startRun(doc, { userId: u, experienceId: exp.id }).run.id, nodeId: 'p', userId: u, payload: { text: `MOOK-PRIVADO-${u} dos tres` } });
W(LIVE.mook, doc);
W(LIVE.subs, READERS.map((u) => ({ id: `s-${u}`, taskId: 't', studentId: u, groupId: 'g-a1', responseText: `ENTREGA-${u}`, status: 'submitted', submittedAt: '2026-11-01T15:00:00.000Z', wordCount: 1 })));

// ── [0] Siembra de las seis fuentes ──────────────────────────────────────────
const TOKEN = (u) => `RASTRO-${u}-7f3a`; // texto único por persona para buscarlo en los bytes
for (const u of READERS) {
    Events.insertEvent({ eventId: `ev-${u}-1`, schemaVersion: 1, event: 'reading_progress', mode: 'text', userId: u, contentId: 'c1', sessionId: `ses-${u}`, clientTs: Date.now(), payload: { note: TOKEN(u) } });
    // Varias sincronizaciones de la misma fila: cada upsert deja la versión anterior en páginas libres.
    for (const pct of [10, 20, 40]) Progress.upsertProgress({ id: `${u}__c1`, userId: u, contentId: 'c1', isCompleted: false, canonicalProgress: { percentage: pct, note: `${TOKEN(u)}-${pct}` }, updatedAt: new Date().toISOString(), history: [] });
}
// Evento de un mediador que menciona a la persona (auditoría de Aula Viva).
Events.insertEvent({ eventId: 'ev-med-view-sup', schemaVersion: 1, event: 'teacher_viewed_student', mode: 'aula_viva', userId: 'med', contentId: null, sessionId: 'ses-med', clientTs: Date.now(), payload: { groupId: 'g-a1', studentId: 'sup', at: 1 } });
Events.closeDb(); Progress.closeDb();
// insights.db con su esquema REAL (los mismos módulos que lo crean en producción).
for (const [m, open, close] of [['../insightsStore.js', 'ensureDbOpen', 'closeDb'], ['../db/insightsDbExt.mjs', 'getInsightsExtDb', 'closeInsightsExtDb'],
    ['../db/outcomesDbExt.mjs', 'getOutcomesExtDb', 'closeOutcomesExtDb'], ['../db/pedagogyDbExt.mjs', 'getPedagogyExtDb', 'closePedagogyExtDb'], ['../db/rollupsDbExt.mjs', 'getRollupsExtDb', 'closeRollupsExtDb']]) {
    const mod = await import(m); mod[open](); mod[close]();
}
{ const db = new Database(LIVE.eventsDb); db.exec(`VACUUM INTO '${LIVE.archiveDb.replace(/\\/g, '/')}'`); db.close(); }
W(LIVE.progressJson, { progressMap: Object.fromEntries(READERS.map((u) => [`${u}__c1`, { userId: u, contentId: 'c1', note: TOKEN(u) }])) });
W(LIVE.leoMemory, { memoryMap: Object.fromEntries(READERS.map((u) => [`${u}__c1`, { recentAnchors: [TOKEN(u)] }])) });
W(LIVE.leoProfile, { profileMap: Object.fromEntries(READERS.map((u) => [u, { userId: u, note: TOKEN(u) }])) });
W(LIVE.leoInteractions, READERS.map((u) => ({ userId: u, contentId: 'c1', timestamp: 1, interactionType: 'chat', surface: 'reader' })));
W(LIVE.leoEvidence, { schemaVersion: 1, entries: READERS.map((u) => ({ id: `le-${u}`, userId: u, contentId: 'c1', evidenceType: 'x', timestamp: 1 })) });
W(LIVE.audit, [
    { action: 'change_own_password', actor: 'sup', targetUserId: 'sup', details: { email: 'sup@fixture.invalid' }, auditReferenceId: 'A-1', timestamp: '2026-11-01T00:00:00.000Z' },
    { action: 'update_user', actor: 'adm', targetUserId: 'k1', details: { email: 'k1@fixture.invalid', fieldsUpdated: ['bio'] }, auditReferenceId: 'A-2', timestamp: '2026-11-01T00:00:00.000Z' },
]);
const b2c = { orderId: 77, productId: 9, plan: 'digital', source: 'test', idempotencyKey: 'test:order:77', activationAt: Date.now(), expiresAt: Date.now() + 1e10, createdAt: Date.now(), templateRuleId: 'access-b2c-lectores' };
W(LIVE.access, [
    { id: 'access-b2c-lectores', scope: 'group', scopeId: 'group-b2c-lectores', titleIds: ['c1'], collectionIds: [], expiresAt: null },
    { id: 'access-user-sup', scope: 'user', scopeId: 'sup', titleIds: ['c1'], collectionIds: [], expiresAt: null },
    { id: 'access-b2c-test-order-77', scope: 'user', scopeId: 'sup', titleIds: ['c1'], collectionIds: [], expiresAt: b2c.expiresAt, b2c },
    { id: 'access-user-k1', scope: 'user', scopeId: 'k1', titleIds: ['c1'], collectionIds: [], expiresAt: null },
]);

const envFor = (P, port) => ({
    ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
    USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
    USER_AUDIT_DB: P.audit, PROGRESS_SQLITE_PATH: P.progressDb, EVENTS_SQLITE_PATH: P.eventsDb, ARCHIVE_SQLITE_PATH: P.archiveDb,
    INSIGHTS_SQLITE_PATH: P.insightsDb, OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, 'offline.db'),
    IDENTITY_DB: P.identityDb, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
    SESSIONS_DB: path.join(P.data, 'sessions.db'), LEO_EVIDENCE_DB: P.leoEvidence,
    ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
});
const paths = (P) => ({ eventsDb: P.eventsDb, archiveDb: P.archiveDb, progressDb: P.progressDb, progressJson: P.progressJson, leoMemory: P.leoMemory,
    leoProfile: P.leoProfile, leoInteractions: P.leoInteractions, leoEvidence: P.leoEvidence, audit: P.audit, access: P.access, identityDb: P.identityDb, insightsDb: P.insightsDb });
const spawnApi = async (P) => {
    const port = await freePort();
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: envFor(P, port) });
    let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
    child.logs = () => logs; child.base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 200; i++) { if (child.exitCode !== null) throw new Error(logs.slice(-1500)); try { if ((await fetch(`${child.base}/api/health`)).ok) return child; } catch { /* */ } await sleep(300); }
    throw new Error('nunca healthy');
};
const stop = async (c) => { if (c && c.exitCode === null && c.signalCode === null) { const exited = new Promise((r) => c.once('exit', r)); c.kill('SIGKILL'); await exited; } };
const req = (c, method, url, as, body) => fetch(`${c.base}${url}`, { method, headers: { 'x-user-id': as, 'sec-fetch-site': 'same-origin', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const login = async (c, id) => (await fetch(`${c.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) })).status;
const status = async (c, s) => (await req(c, 'GET', `/api/students/${s}/status`, 'med')).status;
const q1 = (file, sql, ...a) => { const db = new Database(file, { readonly: true }); try { return db.prepare(sql).get(...a); } finally { db.close(); } };
const bytesHave = (file, needle) => [file, `${file}-wal`].some((f) => fs.existsSync(f) && fs.readFileSync(f).includes(Buffer.from(needle)));
const textHas = (P, needle) => JSON_STORES.some((k) => fs.existsSync(P[k]) && fs.readFileSync(P[k], 'utf8').includes(needle));
/** ¿Queda algo identificable de `u` en las seis fuentes (incluidos los bytes de los SQLite)? */
const residualOf = (P, u) => ({
    events: q1(P.eventsDb, 'SELECT COUNT(*) n FROM events WHERE user_id = ? OR instr(payload_json, ?) > 0', u, `"${u}"`).n,
    archive: q1(P.archiveDb, 'SELECT COUNT(*) n FROM events WHERE user_id = ? OR instr(payload_json, ?) > 0', u, `"${u}"`).n,
    progress: q1(P.progressDb, 'SELECT COUNT(*) n FROM progress WHERE user_id = ?', u).n,
    identity: q1(P.identityDb, 'SELECT COUNT(*) n FROM users WHERE canonical_id = ? AND (email_raw IS NOT NULL OR raw_json <> \'{}\')', u).n
        + q1(P.identityDb, 'SELECT COUNT(*) n FROM access_rules WHERE scope_id = ?', u).n + q1(P.identityDb, 'SELECT COUNT(*) n FROM memberships WHERE user_id = ?', u).n,
    insights: insightsOf(P.insightsDb, u),
    bytes: SQLITE_STORES.filter((k) => bytesHave(P[k], TOKEN(u)) || bytesHave(P[k], `${u}@fixture.invalid`)).length,
    json: JSON_STORES.filter((k) => k !== 'users' && fs.existsSync(P[k]) && (fs.readFileSync(P[k], 'utf8').includes(`"${u}"`) || fs.readFileSync(P[k], 'utf8').includes(`"${u}__`) || fs.readFileSync(P[k], 'utf8').includes(TOKEN(u)) || fs.readFileSync(P[k], 'utf8').includes(`${u}@fixture`))).length,
});
const clean = (r) => Object.values(r).every((v) => v === 0);
// ── insights.db: filas sintéticas genéricas sobre el esquema REAL (lo crea el servidor) ──
const LVL = (cols) => ['scope_type', 'scope_level'].find((c) => cols.has(c) && cols.has('scope_id'));
const tablesOf = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const infoOf = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all();
const jsonCols = (info) => info.filter((c) => /(_json|^notes$|^payload)/.test(c.name)).map((c) => c.name);
let seq = 0;
function insertRow(db, t, values) {
    const info = infoOf(db, t);
    const row = {};
    for (const c of info) {
        if (c.name in values) { row[c.name] = values[c.name]; continue; }
        if (c.pk && /INT/i.test(c.type)) continue;
        if (c.notnull && c.dflt_value === null) row[c.name] = /INT/i.test(c.type) ? 1000 + (seq++) : /REAL|NUM/i.test(c.type) ? 1.5 : `${c.name}-${seq++}`;
    }
    for (const c of jsonCols(info)) if (!(c in values) && c in row) row[c] = '{}';
    const keys = Object.keys(row);
    try { db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`).run(row); return true; } catch { return false; }
}
function seedInsights(file) {
    const db = new Database(file); db.pragma('busy_timeout = 5000');
    const out = { personal: 0, group: 0, tables: [] };
    try {
        for (const t of tablesOf(db)) {
            const info = infoOf(db, t), cols = new Set(info.map((c) => c.name)), lvl = LVL(cols), jc = jsonCols(info);
            const withJson = (v, u) => { for (const c of jc) v[c] = JSON.stringify({ note: TOKEN(u) }); return v; };
            for (const u of READERS) {
                let v = null;
                if (cols.has('user_id')) v = { user_id: u };
                else if (cols.has('student_id')) v = { student_id: u, ...(cols.has('teacher_id') ? { teacher_id: 'med' } : {}) };
                else if (lvl) v = { [lvl]: 'user', scope_id: u };
                if (v && insertRow(db, t, withJson(v, u))) { out.personal++; if (!out.tables.includes(t)) out.tables.push(t); }
            }
            if (lvl && !cols.has('user_id') && !cols.has('student_id')) {
                const v = { [lvl]: 'group', scope_id: 'g-a1' };
                for (const c of jc) v[c] = JSON.stringify({ readers: READERS, note: 'GRUPO' });
                if (insertRow(db, t, v)) out.group++;
            }
        }
    } finally { db.close(); }
    return out;
}
/** Filas personales de `u` y referencias a su id en insights.db. */
function insightsOf(file, u) {
    const db = new Database(file, { readonly: true });
    let n = 0;
    try {
        for (const t of tablesOf(db)) {
            const info = infoOf(db, t), cols = new Set(info.map((c) => c.name)), lvl = LVL(cols);
            const w = [];
            if (cols.has('user_id')) w.push('user_id = @u');
            if (cols.has('student_id')) w.push('student_id = @u');
            if (cols.has('teacher_id')) w.push('teacher_id = @u');
            if (lvl) w.push(`(${lvl} = 'user' AND scope_id = @u)`);
            for (const c of jsonCols(info)) w.push(`instr(${c}, @q) > 0`);
            if (w.length) n += db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${w.join(' OR ')}`).get({ u, q: JSON.stringify(u) }).n;
        }
    } finally { db.close(); }
    return n;
}
/** Huella de los agregados de grupo (todas las columnas salvo los JSON). */
function groupFingerprint(file) {
    const db = new Database(file, { readonly: true });
    try {
        return JSON.stringify(tablesOf(db).flatMap((t) => {
            const info = infoOf(db, t), lvl = LVL(new Set(info.map((c) => c.name)));
            if (!lvl) return [];
            const plain = info.map((c) => c.name).filter((c) => !jsonCols(info).includes(c));
            return db.prepare(`SELECT ${plain.join(',')} FROM ${t} WHERE ${lvl} = 'group' ORDER BY rowid`).all().map((r) => [t, r]);
        }));
    } finally { db.close(); }
}
const copyStage = (from, to) => {
    for (const k of JSON_STORES) if (fs.existsSync(from[k])) fs.copyFileSync(from[k], to[k]);
    for (const k of SQLITE_STORES) { fs.rmSync(to[k], { force: true }); for (const s of ['-wal', '-shm']) fs.rmSync(to[k] + s, { force: true }); const db = new Database(from[k]); db.exec(`VACUUM INTO '${to[k].replace(/\\/g, '/')}'`); db.close(); }
};
/** Conciliación desde un proceso aparte (como el operador en una réplica). */
const reconcileIn = (P) => new Promise((resolve) => {
    const code = `const S=await import(${JSON.stringify(path.join(REPO, 'server/privacy/suppression.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'))});
        const fs=await import('node:fs');const users=JSON.parse(fs.readFileSync(process.env.USERS_DB,'utf8'));
        const r=await S.reapplyResidualAfterRestore(S.residualPaths(process.env), { extraIds: users.map(u=>u.id) });
        const m=await S.reapplyMookSuppressionsAfterRestore({ mookPath: process.env.CHP_DATA_DIR+'/mook_db.json' });
        const s=await S.reapplySubmissionSuppressionsAfterRestore({ submissionsPath: process.env.CHP_DATA_DIR+'/submissions_db.json' });
        console.log(JSON.stringify({ r, m, s, a: S.restoreActions(users) }));`;
    const c = spawn(process.execPath, ['--input-type=module', '-e', code], { env: envFor(P, 0) });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('exit', (rc) => { try { resolve({ rc, ...JSON.parse(out.trim().split('\n').pop()) }); } catch { resolve({ rc, raw: out }); } });
});
const TODAY = R.dayOf(Date.now());
const fileUrl = (rel) => path.join(REPO, rel).replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:').replace(/^\//, 'file:///');

let api1, api2, q;
try {
    api1 = await spawnApi(LIVE); api2 = await spawnApi(LIVE);
    // Primera escritura del padrón: identity.db se puebla por dual-write.
    ok('alta auxiliar (dispara el espejo de identity.db)', (await req(api1, 'POST', '/api/users', 'adm', { id: 'k2', email: 'k2@fixture.invalid', nombre_completo: 'Sint k2', password: PW, roles: ['lector'], colegio: 'Colegio Alfa', groupIds: [] })).status < 300);
    for (let i = 0; i < 50 && !(fs.existsSync(LIVE.identityDb) && q1(LIVE.identityDb, "SELECT COUNT(*) n FROM sqlite_master WHERE name='users'").n && q1(LIVE.identityDb, 'SELECT COUNT(*) n FROM users').n >= 5); i++) await sleep(200);
    // Espejo de accesos con la MISMA función que usa el hook en cada escritura del archivo.
    { const { mirrorAccess } = await import('../db/identityShadow.js'); const db = new Database(LIVE.identityDb); db.pragma('busy_timeout = 5000'); mirrorAccess(db, J(LIVE.access), () => {}, 'test-seed'); db.close(); }
    for (let i = 0; i < 50 && !(fs.existsSync(LIVE.insightsDb) && q1(LIVE.insightsDb, "SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").n >= 10); i++) await sleep(200);
    const seeded = seedInsights(LIVE.insightsDb);
    ok('insights.db sembrada sobre su esquema real (personales y agregados de grupo)', seeded.personal >= 12 && seeded.group >= 3, JSON.stringify(seeded));
    const groupBefore = groupFingerprint(LIVE.insightsDb);

    section('[0] antes');
    ok('identity.db espeja el padrón (correo y nombre de la persona)', q1(LIVE.identityDb, 'SELECT email_raw e FROM users WHERE canonical_id = ?', 'sup')?.e === 'sup@fixture.invalid');
    ok('identity.db espeja sus reglas de acceso', q1(LIVE.identityDb, 'SELECT COUNT(*) n FROM access_rules WHERE scope_id = ?', 'sup').n === 2);
    for (const u of ['sup', 'xpo']) ok(`las seis fuentes contienen a ${u}`, Object.entries(residualOf(LIVE, u)).filter(([k]) => k !== 'bytes').every(([, v]) => v > 0), JSON.stringify(residualOf(LIVE, u)));
    ok('el mediador ve a la persona; ella entra', (await status(api1, 'sup')) === 200 && (await login(api2, 'sup')) === 200);
    copyStage(LIVE, BAK); // «respaldo» anterior a la supresión

    section('[1] supresión (orden: DELETE → operador)');
    // Retiro de XP de `xpo` (PRIV-C7): constancia sin supresión.
    X.appendRegistry({ id: 'x-xpo', tombstone: X.tombstoneOf('xpo'), day: TODAY });
    const del = await req(api1, 'DELETE', '/api/users/sup', 'adm');
    ok('DELETE con la operación existente', del.status === 200);
    await sleep(800); // auditoría y espejo son asíncronos
    ok('la baja deja el correo en la auditoría (hallazgo) y la fila de identity.db solo dada de baja', textHas(LIVE, 'sup@fixture.invalid')
        && q1(LIVE.identityDb, 'SELECT email_raw e, deleted_at d FROM users WHERE canonical_id = ?', 'sup')?.d !== null);
    const acct = SUP.suppressAccount(null, { userId: 'sup', requestRef: 'SOL-SINT-0901', requestDay: TODAY, capacity: 'legal_representative' });
    await SUP.suppressMookParticipant({ mookPath: LIVE.mook, userId: 'sup', requestRef: 'SOL-SINT-0901' });
    await SUP.suppressSubmissions({ submissionsPath: LIVE.subs, userId: 'sup', requestRef: 'SOL-SINT-0901' });
    const ack = await SUP.suppressResidualSources(paths(LIVE), 'sup');
    ok('constancia, T/A1/A2 revocadas', acct.decisionsRevoked.join() === 'T,A1,A2' && SUP.suppressionGate().isSuppressed('sup'));
    ok('el retiro de XP NO es supresión', SUP.suppressionGate().isSuppressed('xpo') === false && X.readRegistry().has(X.tombstoneOf('xpo')));
    ok('acuse sin ids ni contenido', !JSON.stringify(ack).includes('sup') && !JSON.stringify(ack).includes('RASTRO'), JSON.stringify(ack));
    ok('eventos propios eliminados (vivo y archivo)', ack.events.ownRemoved === 1 && ack.eventsArchive.ownRemoved === 1);
    ok('evento del mediador conservado, sin la persona', ack.events.mentionsPseudonymized === 1
        && q1(LIVE.eventsDb, 'SELECT payload_json p FROM events WHERE event_id = ?', 'ev-med-view-sup').p.includes(SUP.SUPPRESSED_SUBJECT));
    ok('progreso (SQLite y legado) y Leo (memoria, perfil, interacciones, evidencia) eliminados',
        ack.progress.removed === 1 && ack.progressLegacy.removed === 1 && ack.leoMemory.removed === 1 && ack.leoProfile.removed === 1 && ack.leoInteractions.removed === 1 && ack.leoEvidence.removed === 1);
    const aud = J(LIVE.audit);
    ok('auditoría conservada (mismo número de entradas) y sin la persona', ack.audit.entriesPseudonymized >= 2 && aud.length >= 3
        && aud.some((e) => e.action === 'delete_user' && e.targetUserId === SUP.SUPPRESSED_SUBJECT && !e.details?.email) && aud.find((e) => e.auditReferenceId === 'A-2')?.details?.email === 'k1@fixture.invalid');
    const rules = J(LIVE.access);
    const kept = rules.find((r) => r.id === 'access-b2c-test-order-77');
    ok('regla personal eliminada; regla B2C conservada sin titular y vencida (antirreenvío)', ack.access.removed === 1 && ack.access.b2cKeptWithoutSubject === 1
        && !rules.some((r) => r.id === 'access-user-sup') && kept?.scopeId === SUP.SUPPRESSED_SUBJECT && kept.expiresAt <= Date.now() && kept.b2c.idempotencyKey === 'test:order:77');
    const B = await import('../b2c/b2cProvisioning.mjs');
    const plan = (order, email) => { try { return B.planUserPhase({ users: J(LIVE.users), rules: J(LIVE.access), input: { source: 'test', orderId: order, idempotencyKey: `test:order:${order}`, email, fullName: 'X', activationAt: Date.now(), plan: 'digital', productId: 9 }, nowMs: Date.now(), normalizeEmail: (e) => String(e ?? '').trim().toLowerCase(), normalizeUser: (x) => x, newUserId: 'user-new', newToken: 't' }); } catch (e) { return { status: e.status, code: e.code }; } };
    ok('B2C: reenvío firmado del pedido suprimido ⇒ 409 account_not_available, sin crear ni invitar', plan(77, 'sup@fixture.invalid').code === 'account_not_available');
    ok('B2C: la respuesta no depende del titular (otro correo, misma respuesta)', JSON.stringify(plan(77, 'otro@fixture.invalid')) === JSON.stringify(plan(77, 'sup@fixture.invalid')));
    ok('B2C: pedido NUEVO de la misma persona ⇒ alta nueva legítima', plan(78, 'sup@fixture.invalid').userOp === 'create', JSON.stringify(plan(78, 'sup@fixture.invalid')));
    ok('B2C: pedido nuevo de otra persona ⇒ alta normal', plan(79, 'nuevo@fixture.invalid').userOp === 'create');
    const idr = q1(LIVE.identityDb, 'SELECT * FROM users WHERE canonical_id = ?', 'sup');
    ok('identity.db: baja sin correo, nombre ni raw_json; sin membresías ni reglas con su id', idr && idr.email_raw === null && idr.nombre_completo === null && idr.raw_json === '{}'
        && idr.deleted_at && idr.email_norm.startsWith(`${SUP.SUPPRESSED_SUBJECT}:`) && ack.identity.accessRules === 2);
    ok('insights.db: filas personales eliminadas, referencias en agregados desvinculadas', ack.insights.rowsRemoved >= seeded.tables.length && ack.insights.refsPseudonymized >= seeded.group, JSON.stringify(ack.insights));
    ok('…agregados de grupo intactos (mismas filas y valores)', groupFingerprint(LIVE.insightsDb) === groupBefore);
    ok('…filas de xpo y k1 intactas', insightsOf(LIVE.insightsDb, 'xpo') > 0 && insightsOf(LIVE.insightsDb, 'k1') > 0);
    ok('supresión lógica sin compactar: queda pendiente, nunca por defecto', ack.progress.compactionPending === true && ack.identity.compactionPending === true && !('vacuumed' in ack.progress));

    section('[1a] compactación separada (dos réplicas abiertas)');
    const holder = new Database(LIVE.progressDb); holder.pragma('busy_timeout = 100'); holder.exec('BEGIN IMMEDIATE');
    const busy = SUP.compactAfterSuppression(paths(LIVE), { vacuum: ['progressDb'], checkpointOnly: [], busyTimeoutMs: 200 });
    holder.exec('ROLLBACK'); holder.close();
    ok('base ocupada por un escritor ⇒ busy, sin cambios', busy.progressDb?.status === 'busy' && q1(LIVE.progressDb, 'PRAGMA quick_check').quick_check === 'ok', JSON.stringify(busy));
    const hashOf = (fl) => crypto.createHash('sha256').update(fs.readFileSync(fl)).digest('hex');
    const hBefore = hashOf(LIVE.identityDb);
    const nospace = SUP.compactAfterSuppression(paths(LIVE), { vacuum: ['identityDb'], checkpointOnly: [], statfs: () => ({ bavail: 1, bsize: 1 }) });
    ok('sin espacio suficiente ⇒ insufficient_space, archivo intacto', nospace.identityDb?.status === 'insufficient_space' && hashOf(LIVE.identityDb) === hBefore);
    const k1Before = q1(LIVE.progressDb, 'SELECT canonical_progress c FROM progress WHERE user_id = ?', 'k1').c;
    const comp = SUP.compactAfterSuppression(paths(LIVE));
    ok('compactación con las réplicas abiertas: integridad y recuentos iguales', ['progressDb', 'identityDb', 'insightsDb'].every((k) => comp[k]?.status === 'compacted')
        && ['eventsDb', 'archiveDb'].every((k) => ['checkpointed', 'busy'].includes(comp[k]?.status)), JSON.stringify(comp));
    ok('…datos no suprimidos idénticos', q1(LIVE.progressDb, 'SELECT canonical_progress c FROM progress WHERE user_id = ?', 'k1').c === k1Before);
    ok('…las réplicas siguen sirviendo (lectura y escritura)', (await login(api1, 'k1')) === 200 && (await req(api2, 'PUT', '/api/users/k1', 'adm', { bio_corta: 'y' })).status === 200);
    // Interrupción: SIGKILL a un proceso a mitad de la compactación (VACUUM es transaccional).
    const big = path.join(tmp, 'interrupt.db');
    { const db = new Database(big); db.pragma('journal_mode = WAL'); db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)'); const ins = db.prepare('INSERT INTO t (v) VALUES (?)'); db.transaction(() => { for (let i = 0; i < 60000; i++) ins.run(`fila-${i}-${'x'.repeat(200)}`); })(); db.exec('DELETE FROM t WHERE id % 3 = 0'); db.close(); }
    const expected = q1(big, 'SELECT COUNT(*) n, SUM(length(v)) s FROM t');
    let killedMidway = 0;
    for (const delay of [40, 120, 250]) {
        const c = spawn(process.execPath, ['--input-type=module', '-e', `const S=await import(${JSON.stringify(fileUrl('server/privacy/suppression.mjs'))});console.log(JSON.stringify(S.compactAfterSuppression({ progressDb: ${JSON.stringify(big)} }, { vacuum: ['progressDb'], checkpointOnly: [] })));`], { env: envFor(LIVE, 0) });
        const exited = new Promise((r) => c.once('exit', r)); // antes de nada: el proceso puede terminar antes del kill
        let o = ''; c.stdout.on('data', (d) => { o += d; });
        await sleep(delay); c.kill('SIGKILL'); await exited;
        if (!o.includes('compacted')) killedMidway++;
        const after = q1(big, 'SELECT COUNT(*) n, SUM(length(v)) s FROM t');
        ok(`interrupción a los ${delay} ms: base íntegra y mismos datos`, q1(big, 'PRAGMA quick_check').quick_check === 'ok' && after.n === expected.n && after.s === expected.s, JSON.stringify(after));
    }
    ok('…al menos una interrupción ocurrió a mitad de la compactación', killedMidway >= 1);
    ok('…y una compactación posterior termina bien', SUP.compactAfterSuppression({ progressDb: big }, { vacuum: ['progressDb'], checkpointOnly: [] }).progressDb.status === 'compacted');
    ok('nada identificable en las seis fuentes, ni en los bytes de los SQLite', clean(residualOf(LIVE, 'sup')), JSON.stringify(residualOf(LIVE, 'sup')));
    ok('retiro de XP y terceros intactos', !clean(residualOf(LIVE, 'xpo')) && residualOf(LIVE, 'xpo').events === 1 && residualOf(LIVE, 'k1').progress === 1
        && rules.some((r) => r.id === 'access-user-k1') && J(LIVE.mook).evidence.some((e) => e.userId === 'xpo'));
    ok('las réplicas: login 401 y el mediador no la ve', (await login(api1, 'sup')) === 401 && (await login(api2, 'sup')) === 401 && (await status(api2, 'sup')) !== 200);
    const again = await SUP.suppressResidualSources(paths(LIVE), 'sup');
    let n = 0; JSON.stringify(again, (k, v) => { if (typeof v === 'number') n += v; return v; });
    ok('repetir no cambia nada', n === 0, JSON.stringify(again));
    // Escritura posterior del padrón (otra réplica): no vuelve a espejar a la persona.
    await req(api2, 'PUT', '/api/users/k1', 'adm', { bio_corta: 'x' }); await sleep(800);
    ok('una escritura posterior del padrón no la reintroduce en identity.db', q1(LIVE.identityDb, 'SELECT email_raw e FROM users WHERE canonical_id = ?', 'sup')?.e === null);

    section('[1b] Leo: dos procesos escriben sin pausa mientras se elimina y suprime a una persona');
    ok('alta de la persona de la prueba', (await req(api1, 'POST', '/api/users', 'adm', { id: 'lsup', email: 'lsup@fixture.invalid', nombre_completo: 'Sint lsup', password: PW, roles: ['lector'], colegio: 'Colegio Alfa', groupIds: [] })).status < 300);
    const writerCode = `const M=await import(${JSON.stringify(fileUrl('server/leoMemoryService.js'))});const E=await import(${JSON.stringify(fileUrl('server/leoEvidenceService.js'))});
        const fs=await import('node:fs');M.setLeoSubjectGuard((id)=>JSON.parse(fs.readFileSync(process.env.USERS_DB,'utf8')).some(u=>u.id===id));
        const end=Date.now()+Number(process.env.LEO_MS);let k1=0,err=0;
        while(Date.now()<end){for(const uid of ['lsup','k1']){try{M.recordInteraction({userId:uid,contentId:'c9',surface:'reader',interactionType:'chat'});E.persistLeoEvidence({id:'e'+Math.random(),userId:uid,contentId:'c9',evidenceType:'x',timestamp:Date.now(),...(uid==='k1'?{sequenceId:process.env.WTAG,sequenceStep:k1+1}:{})});M.updateLeoLearnerProfile(uid,{note:'n'});if(uid==='k1')k1++;}catch{err++;}}}
        console.log(JSON.stringify({k1,err}));`;
    // V9 F4-A1: cada escritor numera sus escrituras de k1 (sequenceId = su etiqueta, sequenceStep = 1..n) y la
    // prueba cuenta los recortes que anuncia el servicio. CHP_TEST_LEO_MS alarga la carrera para ejercitar el tope.
    const runWriter = (tag) => new Promise((resolve) => { const c = spawn(process.execPath, ['--input-type=module', '-e', writerCode], { env: { ...envFor(LIVE, 0), LEO_MS: process.env.CHP_TEST_LEO_MS || '5000', WTAG: tag } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('exit', (rc) => {
        const fsErrors = o.match(/(Error writing|Locked write failed|persistLeoEvidence failed)[^\n]{0,120}/g) || [];
        const trims = (o.match(/Evidence DB trimmed to \d+ entries/g) || []).length;
        try { resolve({ rc, tag, trims, writeErrors: fsErrors.length, detail: [...new Set(fsErrors)].slice(0, 3), ...JSON.parse(o.trim().split('\n').pop()) }); } catch { resolve({ rc, writeErrors: fsErrors.length, raw: o.slice(-500) }); }
    }); });
    const k1Mem0 = J(LIVE.leoMemory).memoryMap['k1__c9']?.interactionCount ?? 0;
    // Política de retención del servicio (no se toca): al superar MAX se conservan las TRIM_TO más recientes.
    const evSrc = fs.readFileSync(path.join(REPO, 'server', 'leoEvidenceService.js'), 'utf8');
    const EV_MAX = Number(evSrc.match(/const _MAX_ENTRIES\s*=\s*(\d+);/)?.[1]), EV_TRIM_TO = Number(evSrc.match(/const _TRIM_TO\s*=\s*(\d+);/)?.[1]);
    const PER_TRIM = EV_MAX + 1 - EV_TRIM_TO; // entradas (las más antiguas) que elimina cada recorte
    const applyRetention = (list) => (list.length > EV_MAX ? list.slice(list.length - EV_TRIM_TO) : list);
    const evToken = (e) => (e.sequenceId ? `${e.sequenceId}:${e.sequenceStep}` : JSON.stringify(e));
    const ev0 = J(LIVE.leoEvidence).entries.map(evToken); // todo lo anterior a la carrera (más antiguo que cualquier escritura suya)
    const writers = [runWriter('w1'), runWriter('w2')];
    await sleep(1500);
    ok('…escribiendo para la persona antes de la baja', J(LIVE.leoMemory).memoryMap['lsup__c9']?.interactionCount > 0);
    ok('…baja con la operación existente', (await req(api2, 'DELETE', '/api/users/lsup', 'adm')).status === 200);
    SUP.suppressAccount(null, { userId: 'lsup', requestRef: 'SOL-SINT-0902', requestDay: TODAY, capacity: 'titular' });
    await SUP.suppressResidualSources(paths(LIVE), 'lsup');
    const [w1, w2] = await Promise.all(writers);
    ok('escritores sin errores', w1.rc === 0 && w2.rc === 0 && w1.err === 0 && w2.err === 0, JSON.stringify([w1, w2]));
    ok('…ni escrituras descartadas por el sistema de archivos', w1.writeErrors === 0 && w2.writeErrors === 0, JSON.stringify([w1.detail, w2.detail]));
    const leoText = ['leoMemory', 'leoProfile', 'leoInteractions', 'leoEvidence'].map((k) => fs.readFileSync(LIVE[k], 'utf8')).join('');
    ok('ninguna escritura posterior reintroduce a la persona (memoria, perfil, evidencia)', !leoText.includes('"lsup') && !leoText.includes('lsup__') && !leoText.includes(TOKEN('lsup')));
    ok('sin escrituras perdidas: el contador de k1 suma exactamente las de los dos procesos', (J(LIVE.leoMemory).memoryMap['k1__c9']?.interactionCount ?? 0) - k1Mem0 === w1.k1 + w2.k1, JSON.stringify([J(LIVE.leoMemory).memoryMap['k1__c9'], w1.k1, w2.k1]));
    { // bloque propio: nombres locales de la comprobación de retención
    // V9 F4-A1 — evidencia de k1 con el tope de retención. El almacén es de solo-anexado y, al superar EV_MAX,
    // conserva las EV_TRIM_TO más recientes: lo que falte tiene que ser lo MÁS ANTIGUO y caber en lo que eliminaron
    // los recortes anunciados. Sin recortes, la cuenta es exacta, como antes.
    if (['middle', 'last', 'oldest'].includes(process.env.CHP_TEST_INJECT_EVIDENCE_LOSS)) { // prueba negativa controlada: simula una escritura perdida
        const db = J(LIVE.leoEvidence); const mine = db.entries.map((e, i) => (e.sequenceId === 'w1' ? i : -1)).filter((i) => i >= 0);
        const at = { middle: mine[Math.floor(mine.length / 2)], last: mine[mine.length - 1], oldest: mine[0] }[process.env.CHP_TEST_INJECT_EVIDENCE_LOSS];
        db.entries.splice(at, 1); W(LIVE.leoEvidence, db); console.log(`      [autoprueba] se retiró una entrada de w1 (${process.env.CHP_TEST_INJECT_EVIDENCE_LOSS})`);
    }
    const evNow = J(LIVE.leoEvidence).entries;
    const trims = w1.trims + w2.trims, written = w1.k1 + w2.k1;
    const keptOf = (w) => evNow.filter((e) => e.userId === 'k1' && e.contentId === 'c9' && e.sequenceId === w.tag).map((e) => e.sequenceStep);
    const kept = [keptOf(w1), keptOf(w2)];
    const lost = written - kept[0].length - kept[1].length;
    const nowTokens = new Set(evNow.map(evToken)); const baseLost = ev0.filter((t) => !nowTokens.has(t)).length;
    console.log(`      (evidencia de k1: ${written} escritas, ${written - lost} conservadas, ${trims} recorte(s); previas perdidas: ${baseLost} de ${ev0.length})`);
    ok('política de retención leída del servicio y tope respetado', Number.isInteger(EV_MAX) && Number.isInteger(EV_TRIM_TO) && EV_TRIM_TO < EV_MAX && evNow.length <= EV_MAX, `${EV_MAX}/${EV_TRIM_TO} len=${evNow.length}`);
    ok('…y la evidencia de k1 también: sin recortes, exactamente todas las escrituras (y nada previo perdido)', trims > 0 || (lost === 0 && baseLost === 0), JSON.stringify({ written, lost, baseLost, trims }));
    ok('…lo conservado de cada proceso es un tramo contiguo que termina en su ÚLTIMA escritura (sin huecos ni duplicados)', [w1, w2].every((w, i) => {
        const steps = kept[i]; if (steps.length === 0) return trims > 0 && w.k1 <= lost; // solo si todo lo suyo era lo más antiguo
        return steps[steps.length - 1] === w.k1 && steps.every((n, j) => j === 0 || n === steps[j - 1] + 1);
    }), JSON.stringify(kept.map((k, i) => [k[0], k[k.length - 1], k.length, [w1, w2][i].k1])));
    ok('…lo que falta cabe EXACTAMENTE en lo eliminado por los recortes y es lo más antiguo', lost >= 0 && lost + baseLost <= trims * PER_TRIM && (lost === 0 || baseLost === ev0.length), JSON.stringify({ lost, baseLost, budget: trims * PER_TRIM, previas: ev0.length }));

    // Retención determinista, sin concurrencia: un proceso anexa un número conocido de entradas que cruza el tope,
    // se queda por debajo y lo vuelve a cruzar; el almacén debe coincidir entrada por entrada con la política.
    const before = J(LIVE.leoEvidence).entries.map(evToken);
    const N_RET = (EV_MAX + 1 - Math.min(before.length, EV_MAX)) + 150 + (EV_MAX + 1 - EV_TRIM_TO - 150);
    let sim = before.slice(), simTrims = 0;
    for (let n = 1; n <= N_RET; n++) { sim.push(`ret:${n}`); const t = applyRetention(sim); if (t !== sim) { simTrims++; sim = t; } }
    const retCode = `const E=await import(${JSON.stringify(fileUrl('server/leoEvidenceService.js'))});
        for(let n=1;n<=Number(process.env.N_RET);n++)E.persistLeoEvidence({userId:'k1',contentId:'c9',evidenceType:'x',timestamp:n,sequenceId:'ret',sequenceStep:n});console.log('fin');`;
    const ret = await new Promise((resolve) => { const c = spawn(process.execPath, ['--input-type=module', '-e', retCode], { env: { ...envFor(LIVE, 0), N_RET: String(N_RET) } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; });
        c.on('exit', (rc) => resolve({ rc, trims: (o.match(/Evidence DB trimmed to \d+ entries/g) || []).length, errors: (o.match(/Error writing|Locked write failed|persistLeoEvidence failed/g) || []).length })); });
    if (process.env.CHP_TEST_INJECT_EVIDENCE_LOSS === 'retention') { const db = J(LIVE.leoEvidence); db.entries.splice(Math.floor(db.entries.length / 2), 1); W(LIVE.leoEvidence, db); console.log('      [autoprueba] se retiró una entrada tras la fase de retención'); }
    const after = J(LIVE.leoEvidence).entries.map(evToken);
    ok(`retención determinista: ${N_RET} entradas más cruzan el tope dos veces y entre medias se quedan por debajo`, ret.rc === 0 && ret.errors === 0 && simTrims === 2 && ret.trims === simTrims, JSON.stringify({ ret, simTrims, N_RET, antes: before.length }));
    ok('…y el almacén coincide entrada por entrada con la política (ni una de más, ni una de menos, en orden)', after.length === sim.length && after.every((t, i) => t === sim[i]), JSON.stringify({ almacén: after.length, política: sim.length, primeraDiferencia: after.findIndex((t, i) => t !== sim[i]) }));
    }
    await stop(api1); await stop(api2); api1 = api2 = null;

    section('[2] restauración en CUARENTENA');
    copyStage(BAK, Q);
    ok('el respaldo trae todo de vuelta', !clean(residualOf(Q, 'sup')) && J(Q.users).some((u) => u.id === 'sup' && u.accountStatus === 'active'));
    const [c1, c2] = await Promise.all([reconcileIn(Q), reconcileIn(Q)]);
    ok('conciliación concurrente desde dos procesos sin error', c1.rc === 0 && c2.rc === 0, JSON.stringify([c1.raw, c2.raw]));
    ok('solo la suprimida: se elimina, no se desactiva; el retiro de XP no aparece', c1.a?.toDelete.join() === 'sup' && c1.a.toDisable.length === 0 && !c1.a.toDelete.includes('xpo'), JSON.stringify(c1.a));
    ok('entre las dos, una única aplicación efectiva', c1.r.changes + c2.r.changes > 0 && (c1.m.evidenceRemoved + c2.m.evidenceRemoved) === 1 && (c1.s.submissionsRemoved + c2.s.submissionsRemoved) === 1, JSON.stringify([c1, c2]));
    q = await spawnApi(Q);
    ok('RIESGO: sin eliminarla, la cuenta restaurada inicia sesión (por eso cuarentena)', (await login(q, 'sup')) === 200);
    ok('…pero ningún mediador la ve', (await status(q, 'sup')) === 403);
    ok('AT la elimina en la cuarentena', (await req(q, 'DELETE', '/api/users/sup', 'adm')).status === 200);
    await sleep(800);
    const c3 = await reconcileIn(Q);
    ok('segunda pasada: trata la entrada nueva de auditoría y el espejo de la baja', c3.rc === 0 && c3.r.changes > 0, JSON.stringify(c3));
    ok('XP-only intacto en la cuarentena', residualOf(Q, 'xpo').events === 1 && J(Q.mook).evidence.some((e) => e.userId === 'xpo') && J(Q.users).some((u) => u.id === 'xpo' && u.accountStatus === 'active'));

    section('[3] puerta de promoción');
    const g = await reconcileIn(Q);
    ok('ABIERTA: sin cuentas pendientes y una pasada más no cambia nada', g.rc === 0 && g.a.toDelete.length === 0 && g.a.toDisable.length === 0 && g.r.changes === 0 && g.m.participants === 0 && g.s.submissionsRemoved === 0, JSON.stringify(g));
    const qc = SUP.compactAfterSuppression(paths(Q));
    ok('compactación en la cuarentena (sin tráfico) antes de promover', ['progressDb', 'identityDb', 'insightsDb'].every((k) => qc[k]?.status === 'compacted') && ['eventsDb', 'archiveDb'].every((k) => qc[k]?.status === 'checkpointed'), JSON.stringify(qc));
    ok('nada identificable de la persona en la cuarentena', clean(residualOf(Q, 'sup')), JSON.stringify(residualOf(Q, 'sup')));
    const prev = process.env.GAMIFICATION_EXCLUSION_REGISTRY; fs.renameSync(REG, `${REG}.off`);
    const broken = await reconcileIn(Q);
    ok('registro de exclusiones no disponible ⇒ la conciliación falla y no escribe', broken.rc !== 0);
    fs.renameSync(`${REG}.off`, REG); process.env.GAMIFICATION_EXCLUSION_REGISTRY = prev;
    ok('cuarentena: login 401', (await login(q, 'sup')) === 401);
    await stop(q); q = null;

    section('[4] promoción y reapertura');
    copyStage(Q, LIVE);
    api1 = await spawnApi(LIVE); api2 = await spawnApi(LIVE);
    ok('ninguna réplica deja entrar a la persona', (await login(api1, 'sup')) === 401 && (await login(api2, 'sup')) === 401);
    ok('el mediador no la ve', (await status(api1, 'sup')) !== 200 && (await status(api2, 'sup')) !== 200);
    ok('los demás siguen: k1 y xpo entran; el mediador ve a k1', (await login(api1, 'k1')) === 200 && (await login(api2, 'xpo')) === 200 && (await status(api2, 'k1')) === 200);
    ok('logs sin el rastro ni el correo de la persona', ![api1, api2].some((c) => c.logs().includes(TOKEN('sup')) || c.logs().includes('sup@fixture.invalid')));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const c of [api1, api2, q]) await stop(c).catch(() => {});
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nsuppression residual sources HTTP (V8.1-CLOSE-09A/09B G-08): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
