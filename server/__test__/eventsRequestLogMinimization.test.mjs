/**
 * eventsRequestLogMinimization.test.mjs — CHP-EVENT-REQUEST-LOG-PAYLOAD-MINIMIZATION-01A.
 *
 * POST /api/events ya no escribe el cuerpo de la solicitud en el log del proceso.
 * Servidor REAL hermético (stores, SQLite y uploads en un temporal; SESSION_AUTH_MODE=off)
 * con stdout/stderr capturados. Se inyectan sentinelas sintéticos distintos por
 * categoría y se demuestra que ninguno aparece en la salida del proceso, mientras
 * el contrato HTTP y la persistencia se conservan.
 *
 *   node server/__test__/eventsRequestLogMinimization.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ulid } from '../ulid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_evlog_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'), events: path.join(tmp, 'events.db'),
};
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([{ id: 'u-fixture', email: 'u-fixture@fixture.invalid', roles: ['lector'], accountStatus: 'active' }]));
for (const f of [P.groups, P.schools, P.access, P.content]) fs.writeFileSync(f, '[]');
fs.writeFileSync(path.join(P.data, 'progress_db.json'), JSON.stringify({ progressMap: {} }));

// Sentinelas sintéticos (jamás datos reales). El id de usuario del HEADER es un
// fixture plano porque el access-log HTTP general (fuera de esta unidad) lo registra;
// los sentinelas de usuario/evento viajan en el CUERPO, que es lo que se minimiza.
const S = {
    email:   'SENT-EMAIL-7f3a@fixture.invalid',
    token:   'SENT-TOKEN-9c1d2e3f',
    session: 'SENT-SESSION-4b5c6d',
    text:    'SENT-TEXTO-PEDAGOGICO-la-luciernaga-8e9f',
    unknown: 'SENT-UNKNOWN-KEY-VALUE-0a1b',
    invalid: 'SENT-INVALID-VALUE-2c3d',
    userId:  'SENT-BODY-USER-4e5f',
    eventId: 'SENT-BODY-EVENT-6a7b',
};

function spawnApi(port) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
            UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'),
            ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
            SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '', LOG_LEVEL: 'info' },
    });
    child._out = ''; child._err = '';
    child.stdout.on('data', d => { child._out += d; });
    child.stderr.on('data', d => { child._err += d; });
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${(child._out + child._err).slice(-1500)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error('nunca healthy');
}
const post = async (base, body, uid = 'u-fixture') => {
    const r = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) }, body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { json = null; }
    return { status: r.status, body: json };
};
const rows = () => { const db = new Database(P.events, { readonly: true }); try { return db.prepare('SELECT event_id, event, mode, user_id, session_id, payload_json FROM events ORDER BY id').all(); } finally { db.close(); } };

const port = 3500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const api = spawnApi(port);
try {
    await waitHealthy(base, api);
    const bootOut = api._out.length, bootErr = api._err.length;

    // 1) evento válido con sentinelas en el cuerpo
    const validId = ulid();
    const valid = await post(base, { event: 'manifest_fail', ts: 1700000000000, eventId: validId, sessionId: S.session, contentId: 'c-fixture',
        nota: S.text, email: S.email, token: S.token, unknownKey: S.unknown, userId: S.userId, reviewerId: S.userId, bodyEventId: S.eventId });
    // 2) duplicado (mismo eventId)
    const dup = await post(base, { event: 'manifest_fail', ts: 1700000000000, eventId: validId, sessionId: S.session, contentId: 'c-fixture', nota: S.text });
    // 3) inválido: payload > 4 KB → rechazado por validación canónica (contrato: 200 {ok:true}, sin inserción)
    const invalid = await post(base, { event: 'blob_invalid', eventId: ulid(), sessionId: S.session, big: S.invalid + 'x'.repeat(5000) });
    // 4) sin identidad → 400 (contrato previo de la ruta en modo off)
    const unauth = await post(base, { event: 'manifest_fail', nota: S.text }, null);
    // 5) event no string → 400
    const noEvent = await post(base, { event: 42, nota: S.text });
    await sleep(500);

    console.log('\n[A] contratos HTTP y persistencia');
    ok('válido → 200 {ok:true}', valid.status === 200 && valid.body?.ok === true, JSON.stringify([valid.status, valid.body]));
    ok('duplicado → 200 {ok:true} (dedup por event_id)', dup.status === 200 && dup.body?.ok === true);
    ok('inválido (payload > 4 KB) → 200 {ok:true} recovery-first', invalid.status === 200 && invalid.body?.ok === true);
    ok('sin identidad → 400', unauth.status === 400);
    ok('event no string → 400 {error}', noEvent.status === 400 && typeof noEvent.body?.error === 'string');
    const rs = rows();
    ok('exactamente 1 fila persistida (válido; duplicado deduplicado; inválido no insertado)', rs.length === 1, String(rs.length));
    const row = rs[0] || {};
    const payload = row.payload_json ? JSON.parse(row.payload_json) : {};
    ok('fila válida conserva el contrato: event_id, immersive.manifest_fail, user_id del header, session_id del cuerpo',
        row.event_id === validId && row.event === 'immersive.manifest_fail' && row.mode === 'immersive' && row.user_id === 'u-fixture' && row.session_id === S.session);
    ok('payload persistido conserva las claves del cuerpo y _source=legacy (persistencia intacta)',
        payload._source === 'legacy' && payload.nota === S.text && payload.unknownKey === S.unknown && payload.bodyEventId === S.eventId);

    console.log('\n[B] la salida del proceso no contiene ningún sentinela');
    const out = api._out.slice(bootOut), err = api._err.slice(bootErr);
    for (const [k, v] of Object.entries(S)) {
        ok(`stdout sin sentinela ${k}`, !out.includes(v));
        ok(`stderr sin sentinela ${k}`, !err.includes(v));
    }
    ok('el cuerpo completo no aparece serializado ([EVENT] retirado)', !/\[EVENT\]/.test(out + err) && !out.includes('"nota"') && !out.includes('bodyEventId'));
    ok('los errores de validación no reproducen valores', !/rejected \(/.test(out + err) && !(out + err).includes('exceeds 4KB'));

    console.log('\n[C] señal operacional restante: solo campos fijos');
    const v1 = (out + err).split('\n').filter(l => l.includes('[EVENTS_V1]'));
    ok('quedan líneas [EVENTS_V1] de dual-write (accepted/dedup/rejected)', v1.length >= 3, v1.map(l => l.trim().slice(-70)).join(' | ') + ' | rows=' + rows().length);
    ok('cada línea [EVENTS_V1] contiene exclusivamente contadores fijos',
        v1.every(l => /\[EVENTS_V1\] dual-write event: (accepted=[01] dedup=[01]|rejected=1|error=1)$/.test(l.trim())), v1.map(l => l.trim().slice(-60)).join(' | '));

    console.log('\n[D] el access-log HTTP general conserva método, ruta y estado');
    const access = out.split('\n').filter(l => l.includes('"url":"/api/events"'));
    ok('≥ 5 líneas de access-log para /api/events', access.length >= 5, String(access.length));
    ok('cada línea trae method, url y statusCode', access.every(l => /"method":"POST"/.test(l) && /"statusCode":(200|400)/.test(l)));

    console.log('\n[E] estructural');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    const i = src.indexOf("app.post('/api/events', requireEventsWriteAuth");
    const block = src.slice(i, src.indexOf("app.post('/api/v1/events'", i));
    ok('la ruta no serializa req.body ni rest en logs', !/JSON\.stringify\(rest\)/.test(block) && !/JSON\.stringify\(req\.body/.test(block) && !/\[EVENT\]/.test(block));
    ok('la ruta no interpola reason ni e.message en logs', !/\$\{dualResult\.reason\}/.test(block) && !/\$\{e\.message\}/.test(block));
    ok('fixtures sin datos reales', S.email.endsWith('@fixture.invalid'));
} finally {
    try { api.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
