/**
 * royaltiesPreviewHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U2 · F3-B-01.
 *
 * server.js REAL contra stores y bases TEMPORALES:
 *   [1] solo administración (lector y mediador 403, anónimo 401), no-store, mes inválido 400
 *   [2] vista previa: derechos por episodio, procedencia, QA y P7 excluidos, S
 *   [3] sin datos personales en la respuesta
 *   [4] sin escrituras: econ_events, derechos, historial y JSON idénticos
 *   [5] events.db sin econ_events: mes vacío y la tabla NO se crea
 *
 *   node server/royalties/__test__/royaltiesPreviewHttp.test.mjs
 */
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB);

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_preview_http_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'),
    access: path.join(tmp, 'access.json'), audit: path.join(tmp, 'user_audit.json'), royalties: path.join(tmp, 'rdb', 'royalties.db'),
    uploads: path.join(tmp, 'uploads'), offline: path.join(tmp, 'offline.db'), events: path.join(tmp, 'events.db'), eventsBare: path.join(tmp, 'events-bare.db'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active', nombre_completo: 'Adm' },
    { id: 'MED', email: 'med@fx.test', roles: ['mediador'], accountStatus: 'active', nombre_completo: 'Med' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lectora Uno' },
    { id: 'LEC2', email: 'lec2@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lectora Dos' },
    { id: 'QA', email: 'qa@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Carga', _loadtest_marker: true },
    { id: 'INT', email: 'int@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Interna' },
]));
const PUB = 'pub-chibalete-editores';
const mk = (id, extra = {}) => ({ id, titulo: `Obra ${id}`, autor: 'Autora', tipo: 'libro', editorial: 'X', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', publisherId: PUB, ...extra });
fs.writeFileSync(P.content, JSON.stringify([mk('c1'), mk('c2'), mk('c3')], null, 2));
fs.writeFileSync(P.access, JSON.stringify([], null, 2));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

// ── derechos e historial en la royalties.db temporal (antes de arrancar) ─────
process.env.ROYALTIES_DB = P.royalties;
const store = await import('../publishersStore.mjs');
const rights = await import('../rightsStore.mjs');
const assignment = await import('../publisherAssignment.mjs');
const ext = store.createPublisher({ kind: 'editorial', legalName: 'Externa FX' });
const ALL = Object.fromEntries(rights.RIGHTS_CAPABILITIES.map((c) => [c, true]));
const contentOf = (id, publisherId = PUB) => ({ ...mk(id), publisherId });
const v = (publisherId, extra = {}) => ({ publisherId, actRef: 'ACTA-FX', actSignedOn: '2026-10-01', validFrom: '2026-10-01', validUntil: null,
    effectiveAt: '2026-10-01T05:00:00.000Z', legalStatus: 'active', economicStatus: 'active', settlementClass: 'liquidable',
    alpha: 0.7, expectedMinutes: 10, shares: [{ publisherId, shareBp: 10000 }], permissions: ALL, ...extra });
rights.createRightsVersion('c1', v(PUB), { content: contentOf('c1'), actor: 'fixture' });
rights.createRightsVersion('c2', v(PUB, { validUntil: '2026-11-10' }), { content: contentOf('c2'), actor: 'fixture' });
// c3: Acta de la editorial externa; la obra pasó de PUB a la externa el 15/11.
rights.createRightsVersion('c3', v(ext.id), { content: contentOf('c3', ext.id), actor: 'fixture' });
assignment.recordPublisherChange({ contentId: 'c3', change: { from: PUB, to: ext.id }, actor: 'fixture', at: '2026-11-15T15:00:00.000Z' }, () => {});
const content = JSON.parse(fs.readFileSync(P.content, 'utf8'));
content.find((c) => c.id === 'c3').publisherId = ext.id;
fs.writeFileSync(P.content, JSON.stringify(content, null, 2));
store.closeRoyaltiesDb();

// ── econ_events sintéticos en la events.db temporal ─────────────────────────
const econ = await import('../econEvents.mjs');
const edb = new Database(P.events);
econ.ensureEconSchema(edb);
const ins = edb.prepare(`INSERT INTO econ_events (event_id, event, mode, user_id, content_id, session_id, client_ts, server_ts, payload_json, created_at)
    VALUES (@event_id, @event, @mode, @user_id, @content_id, @session_id, @client_ts, @server_ts, @payload_json, @created_at)`);
let seq = 0;
const PAID = { ruleId: 'r-paid', commercialClass: 'paid_b2c', eligible: true, reason: 'ELIGIBLE' };
function read({ user, content: cid, start, minutes = 10, mode = 'text', access = PAID }) {
    const sid = `S${String(++seq).padStart(25, '0')}`;
    const t0 = Date.parse(`${start}-05:00`);
    const put = (event, t, payload) => ins.run({ event_id: `E${String(++seq).padStart(25, '0')}`, event, mode, user_id: user, content_id: cid, session_id: sid,
        client_ts: t, server_ts: t + 2000, payload_json: JSON.stringify(payload), created_at: t + 2000 });
    put('econ.session_start', t0, { econAccess: access });
    for (let s = 15; s <= minutes * 60; s += 15) put('econ_tick', t0 + s * 1000, { windowMs: 15_000, visible: true, humanSignalAgoMs: 5_000, firstHumanSignalAgoMs: 5_000 });
}
read({ user: 'LEC', content: 'c1', start: '2026-11-03T10:00:00' });
read({ user: 'LEC2', content: 'c1', start: '2026-11-04T10:00:00', mode: 'pdf', minutes: 5 });
read({ user: 'LEC', content: 'c2', start: '2026-11-05T10:00:00' });          // c2 vigente
read({ user: 'LEC', content: 'c2', start: '2026-11-20T10:00:00' });          // c2 vencida
read({ user: 'LEC', content: 'c3', start: '2026-11-05T12:00:00' });          // c3: editorial de entonces = PUB ≠ Acta
read({ user: 'LEC', content: 'c3', start: '2026-11-20T12:00:00' });          // c3: ya de la externa → cualifica
read({ user: 'QA', content: 'c1', start: '2026-11-06T10:00:00' });           // QA (_loadtest_marker)
read({ user: 'INT', content: 'c1', start: '2026-11-07T10:00:00' });          // interna por P7 (env)
read({ user: 'LEC2', content: 'c1', start: '2026-11-08T10:00:00', access: { ruleId: 'r-free', commercialClass: 'courtesy', eligible: false, reason: 'CLASS_COURTESY' } });
edb.close();
new Database(P.eventsBare).close(); // events.db sin la tabla económica

const PORT = 5800 + (process.pid % 90);
const base = `http://127.0.0.1:${PORT}`;
let child = null;
let boot = '';
async function start(eventsPath) {
    boot = '';
    child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(PORT),
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: P.audit,
            ROYALTIES_DB: P.royalties, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, EVENTS_SQLITE_PATH: eventsPath,
            SESSION_AUTH_MODE: 'off', ROYALTIES_INTERNAL_USER_IDS: 'INT', ECONOMIC_INGEST_MODE: '', RIGHTS_ENFORCEMENT_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
    });
    child.stdout.on('data', (d) => { boot += d; });
    child.stderr.on('data', (d) => { boot += d; });
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
}
async function stop() {
    if (!child) return;
    const c = child; child = null;
    c.kill();
    for (let i = 0; i < 50 && c.exitCode === null; i++) await sleep(100);
}
const call = async (url, uid) => {
    const r = await fetch(`${base}${url}`, { headers: uid ? { 'x-user-id': uid } : {} });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* sin JSON */ }
    return { status: r.status, body: j, text, cache: r.headers.get('cache-control') };
};
const count = (file, sql) => { const d = new Database(file, { readonly: true, fileMustExist: true }); try { return d.prepare(sql).get().n; } finally { d.close(); } };
const fingerprint = () => ({
    econ: count(P.events, 'SELECT COUNT(*) n FROM econ_events'),
    events: count(P.events, "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='events'") ? count(P.events, 'SELECT COUNT(*) n FROM events') : 0,
    rights: count(P.royalties, 'SELECT COUNT(*) n FROM rights_versions'),
    history: count(P.royalties, 'SELECT COUNT(*) n FROM content_publisher_history'),
    json: [P.users, P.content, P.access].map(sha).join(','),
});
const URL_ = '/api/admin/royalties/preview?month=2026-11';

try {
    const before = fingerprint();
    await start(P.events);

    console.log('\n[1] acceso');
    ok('anónimo → 401', (await call(URL_, null)).status === 401);
    ok('lector → 403', (await call(URL_, 'LEC')).status === 403);
    ok('mediador → 403', (await call(URL_, 'MED')).status === 403);
    for (const m of ['', '2026-13', '2026-1', 'x']) ok(`mes «${m}» → 400`, (await call(`/api/admin/royalties/preview?month=${m}`, 'ADM')).status === 400);
    const r = await call(URL_, 'ADM');
    ok('administración → 200 con no-store', r.status === 200 && /no-store/.test(r.cache || ''), `${r.status} ${r.text.slice(0, 300)}`);

    console.log('\n[2] contenido de la vista previa');
    const p = r.body || {};
    const w = (id) => (p.works || []).find((x) => x.contentId === id) || {};
    ok('PROVISIONAL, noviembre, rs-2026-01-v1', p.status === 'PROVISIONAL' && p.month === '2026-11' && p.ruleSet?.id === 'rs-2026-01-v1');
    ok('c1: 2 episodios pagados cualifican; QA, interna y cortesía excluidos', w('c1').Q === 2
        && w('c1').episodes?.excludedByReason?.user_excluded === 2 && w('c1').episodes?.excludedByReason?.['access_not_paid:courtesy'] === 1, JSON.stringify(w('c1').episodes));
    ok('c1: R = mediana(585/600, 285/600) y S de la Doctrina', Math.abs(w('c1').R - (0.975 + 0.475) / 2) < 1e-12 && Math.abs(w('c1').S - Math.sqrt(2) * (0.4 + 0.6 * 0.725)) < 1e-12, JSON.stringify([w('c1').R, w('c1').S]));
    ok('c2: cualifica antes del vencimiento, no después (OUT_OF_VALIDITY)', w('c2').Q === 1 && w('c2').episodes?.excludedByReason?.['rights:OUT_OF_VALIDITY'] === 1);
    ok('c3: editorial reasignada → antes PUBLISHER_MISMATCH, después cualifica', w('c3').Q === 1 && w('c3').episodes?.excludedByReason?.['rights:PUBLISHER_MISMATCH'] === 1
        && w('c3').responsiblePublisherId === ext.id && w('c3').flags?.includes('publisher_changed_in_period'));
    ok('totales de control', p.totals?.Q === 4 && p.totals?.worksWithQ === 3 && p.totals?.episodes === 9 && p.trace?.rowsRead > 0);
    ok('versiones con titularidad aplicable', w('c3').versions?.[0]?.shares?.[0]?.publisherId === ext.id && w('c1').versions?.[0]?.alpha === 0.7);

    console.log('\n[3] privacidad');
    ok('sin identificadores, nombres ni correos de lectores', !/"(LEC|LEC2|QA|INT)"|Lectora|lec@fx|qa@fx|userId|sessionId|S0000/.test(r.text));

    const again = await call(URL_, 'ADM');
    ok('reproducible: mismo resultDigest en otra consulta', again.body?.trace?.resultDigest === p.trace?.resultDigest);
    await stop();

    console.log('\n[4] sin escrituras');
    const after = fingerprint();
    ok('econ_events, eventos, derechos, historial y JSON idénticos', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    ok('sin trazas de error de la vista previa', !/ROYALTIES_PREVIEW/.test(boot));

    console.log('\n[5] events.db sin la tabla económica');
    await start(P.eventsBare);
    const e = await call(URL_, 'ADM');
    ok('200 con el mes vacío de lecturas (solo obras con régimen, Q = 0)', e.status === 200 && e.body.totals.Q === 0 && e.body.trace.rowsRead === 0 && e.body.works.every((x) => x.Q === 0), e.text.slice(0, 300));
    await stop();
    ok('la tabla econ_events NO se creó', count(P.eventsBare, "SELECT COUNT(*) n FROM sqlite_master WHERE name='econ_events'") === 0);
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
}
ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\nroyaltiesPreviewHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
