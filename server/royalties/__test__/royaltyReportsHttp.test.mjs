/**
 * royaltyReportsHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U5 · REPORTES-01.
 *
 * server.js REAL contra stores y bases TEMPORALES (datos sintéticos):
 *   [1] acceso: administración 200 no-store; mediación/lectura 403; anónimo 401; entradas inválidas 400
 *   [2] mes sin INS: solo Q/R/S (sin importes); mes sin lecturas
 *   [3] INS con soporte
 *   [4] simulación (PROVISIONAL, NO EXIGIBLE): reproducible, conciliada, D1 provisional, disputa retenida,
 *       D4 pendiente, editoriales y titular compartido; sin escrituras
 *   [5] exportaciones del MISMO resultado: CSV endurecido, HTML escapado, referencia y filtros
 *   [6] INS cero
 *   [7] cierre técnico solo con confirmación (oficial no habilitado); mismo hash que la simulación
 *   [8] cambios posteriores de derechos: el informe del cierre no cambia
 *   [9] trimestre incompleto y completo desde cierres congelados
 *   [10] sin datos de lectores y sin escrituras en las consultas
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
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_reports_http_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'),
    access: path.join(tmp, 'access.json'), audit: path.join(tmp, 'user_audit.json'), royalties: path.join(tmp, 'rdb', 'royalties.db'),
    uploads: path.join(tmp, 'uploads'), offline: path.join(tmp, 'offline.db'), events: path.join(tmp, 'events.db'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active', nombre_completo: 'Adm' },
    { id: 'MED', email: 'med@fx.test', roles: ['mediador'], accountStatus: 'active', nombre_completo: 'Med' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lectora Uno' },
    { id: 'LEC2', email: 'lec2@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lectora Dos' },
]));
const PUB = 'pub-chibalete-editores';
const mk = (id, titulo, publisherId = PUB) => ({ id, titulo, autor: 'Autora', tipo: 'libro', editorial: 'X', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', publisherId });

process.env.ROYALTIES_DB = P.royalties;
const store = await import('../publishersStore.mjs');
const rights = await import('../rightsStore.mjs');
const EXT = store.createPublisher({ kind: 'editorial', legalName: 'Externa FX', tradeName: 'Externa' });
const AUT = store.createPublisher({ kind: 'tercero', legalName: 'Autora FX', tradeName: 'Autora' });
// Títulos hostiles: inyección de fórmulas (CSV) y marcado (HTML).
const CONTENT = [mk('c1', '=HYPERLINK("http://x.test","clic")'), mk('c2', '<script>alert(1)</script> Dos', EXT.id), mk('c3', 'Obra en disputa', EXT.id), mk('c4', 'Sin lecturas')];
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));
fs.writeFileSync(P.access, '[]');
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');
const ALL = Object.fromEntries(rights.RIGHTS_CAPABILITIES.map((c) => [c, true]));
const v = (publisherId, extra = {}) => ({ publisherId, actRef: 'ACTA-FX', actSignedOn: '2026-10-01', validFrom: '2026-10-01', validUntil: null,
    effectiveAt: '2026-10-01T05:00:00.000Z', legalStatus: 'active', economicStatus: 'active', settlementClass: 'liquidable',
    alpha: 0.7, expectedMinutes: 10, shares: [{ publisherId, shareBp: 10000 }], permissions: ALL, ...extra });
const C = (id) => CONTENT.find((c) => c.id === id);
rights.createRightsVersion('c1', v(PUB, { shares: [{ publisherId: PUB, shareBp: 8000 }, { publisherId: AUT.id, shareBp: 2000 }] }), { content: C('c1'), actor: 'fixture' });
rights.createRightsVersion('c2', v(EXT.id, { alpha: 0.6 }), { content: C('c2'), actor: 'fixture' });
rights.createRightsVersion('c2', v(EXT.id, { alpha: 0.9, validFrom: '2026-11-15', effectiveAt: '2026-11-15T05:00:00.000Z',
    shares: [{ publisherId: EXT.id, shareBp: 7000 }, { publisherId: AUT.id, shareBp: 3000 }] }), { content: C('c2'), actor: 'fixture' });
rights.createRightsVersion('c3', v(EXT.id, { legalStatus: 'disputed' }), { content: C('c3'), actor: 'fixture' });
rights.createRightsVersion('c4', v(PUB), { content: C('c4'), actor: 'fixture' });
store.closeRoyaltiesDb();

const econ = await import('../econEvents.mjs');
const edb = new Database(P.events);
econ.ensureEconSchema(edb);
const ins = edb.prepare(`INSERT INTO econ_events (event_id, event, mode, user_id, content_id, session_id, client_ts, server_ts, payload_json, created_at)
    VALUES (@event_id, @event, @mode, @user_id, @content_id, @session_id, @client_ts, @server_ts, @payload_json, @created_at)`);
let seq = 0;
const PAID = { ruleId: 'r-paid', commercialClass: 'paid_b2c', eligible: true, reason: 'ELIGIBLE' };
function read(user, cid, start, minutes = 10) {
    const sid = `S${String(++seq).padStart(25, '0')}`;
    const t0 = Date.parse(`${start}-05:00`);
    const put = (event, t, payload) => ins.run({ event_id: `E${String(++seq).padStart(25, '0')}`, event, mode: 'text', user_id: user, content_id: cid, session_id: sid,
        client_ts: t, server_ts: t + 2000, payload_json: JSON.stringify(payload), created_at: t + 2000 });
    put('econ.session_start', t0, { econAccess: PAID });
    for (let s = 15; s <= minutes * 60; s += 15) put('econ_tick', t0 + s * 1000, { windowMs: 15_000, visible: true, humanSignalAgoMs: 5_000, firstHumanSignalAgoMs: 5_000 });
}
read('LEC', 'c1', '2026-11-03T10:00:00'); read('LEC2', 'c1', '2026-11-04T10:00:00', 5);
read('LEC', 'c2', '2026-11-05T10:00:00'); read('LEC2', 'c2', '2026-11-06T10:00:00'); read('LEC', 'c2', '2026-11-20T10:00:00');
read('LEC', 'c3', '2026-11-07T10:00:00');
edb.close();

const PORT = 5900 + (process.pid % 90);
const base = `http://127.0.0.1:${PORT}`;
let child = null, boot = '';
async function start() {
    boot = '';
    child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(PORT),
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: P.audit,
            ROYALTIES_DB: P.royalties, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, EVENTS_SQLITE_PATH: P.events,
            SESSION_AUTH_MODE: 'off', ROYALTIES_INTERNAL_USER_IDS: '', ECONOMIC_INGEST_MODE: '', RIGHTS_ENFORCEMENT_MODE: 'off',
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
const call = async (url, uid, body) => {
    const headers = uid ? { 'x-user-id': uid } : {};
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(`${base}${url}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
    const raw = Buffer.from(await r.arrayBuffer());
    const text = raw.toString('utf8').replace(/^﻿/, '');
    let j = null; try { j = JSON.parse(text); } catch { /* CSV/HTML */ }
    return { status: r.status, body: j, text, bom: raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF, h: (k) => r.headers.get(k) };
};
const count = (sql) => { const d = new Database(P.royalties, { readonly: true, fileMustExist: true }); try { return d.prepare(sql).get().n; } finally { d.close(); } };
const fingerprint = () => ({
    closes: count('SELECT COUNT(*) n FROM closes'), inputs: count('SELECT COUNT(*) n FROM period_inputs'), adj: count('SELECT COUNT(*) n FROM adjustments'),
    rules: count('SELECT COUNT(*) n FROM rule_sets'), rights: count('SELECT COUNT(*) n FROM rights_versions'),
    econ: (() => { const d = new Database(P.events, { readonly: true }); try { return d.prepare('SELECT COUNT(*) n FROM econ_events').get().n; } finally { d.close(); } })(),
    json: [P.users, P.content, P.access].map(sha).join(','),
});
const R = (q) => `/api/admin/royalties/report?${q}`;
const texts = [];

try {
    await start();

    console.log('\n[1] acceso');
    ok('anónimo → 401', (await call(R('month=2026-11'), null)).status === 401);
    ok('lector → 403', (await call(R('month=2026-11'), 'LEC')).status === 403);
    ok('mediador → 403', (await call(R('month=2026-11'), 'MED')).status === 403);
    // Escrituras: guard compartido requireAdminAccess (sin sesión firmada → 401; con sesión no admin → 403).
    ok('mediación y lectura no registran INS ni cierran', [401, 403].includes((await call('/api/admin/royalties/period-inputs', 'MED', { period: '2026-11', grossCop: 1, deductionsCop: 0, supportRef: 'x' })).status)
        && [401, 403].includes((await call('/api/admin/royalties/closes', 'LEC', { month: '2026-11', confirmMonth: '2026-11' })).status));
    for (const q of ['month=2026-13', 'month=x', 'quarter=2026-Q5', '']) ok(`«${q}» → 400`, (await call(R(q), 'ADM')).status === 400);

    console.log('\n[2] mes sin INS y mes sin lecturas');
    const before = fingerprint();
    const noIns = await call(R('month=2026-11'), 'ADM');
    ok('200 no-store', noIns.status === 200 && /no-store/.test(noIns.h('cache-control') || ''));
    const ni = noIns.body;
    ok('sin INS: PROVISIONAL, NO EXIGIBLE, solo Q/R/S (sin importes)', ni.source === 'preview' && ni.notExigible && ni.ins === null && ni.pools === null
        && ni.works.find((w) => w.contentId === 'c1').Q === 2 && ni.works.every((w) => w.montoObra === null));
    const oct = (await call(R('month=2026-10'), 'ADM')).body;
    ok('octubre sin lecturas: obras con régimen y Q = 0', oct.works.length === 4 && oct.works.every((w) => w.Q === 0));
    ok('consultar no escribe nada', JSON.stringify(fingerprint()) === JSON.stringify(before));

    console.log('\n[3] INS con soporte');
    ok('sin soporte → 400 support_required', (await call('/api/admin/royalties/period-inputs', 'ADM', { period: '2026-11', grossCop: 1, deductionsCop: 0, supportRef: '' })).body?.code === 'support_required');
    const pi = await call('/api/admin/royalties/period-inputs', 'ADM', { period: '2026-11', grossCop: 2_100_000, deductionsCop: 100_000, supportRef: 'SOPORTE-FX-NOV' });
    ok('INS 2.000.000 registrado (201)', pi.status === 201 && pi.body.insCop === 2_000_000);
    ok('listado de INS del periodo', (await call('/api/admin/royalties/period-inputs?period=2026-11', 'ADM')).body.length === 1);

    console.log('\n[4] simulación de noviembre');
    const mid = fingerprint();
    const sim = (await call(R('month=2026-11'), 'ADM')).body;
    const sim2 = (await call(R('month=2026-11'), 'ADM')).body;
    ok('PROVISIONAL, NO EXIGIBLE, simulación con referencia sha256', sim.status === 'PROVISIONAL' && sim.source === 'simulation' && sim.notExigible && /^[0-9a-f]{64}$/.test(sim.reference.value));
    ok('reproducible: misma referencia en otra consulta', sim2.reference.value === sim.reference.value);
    ok('la simulación no guarda nada', JSON.stringify(fingerprint()) === JSON.stringify(mid));
    ok('INS y bolsas: BRD 500.000, BGP 150.000, BLC 350.000', sim.ins.insCop === 2_000_000 && sim.pools.brd === 500_000 && sim.pools.bgp === 150_000 && sim.pools.blc === 350_000);
    ok('D1 provisional identificada; c2 con dos versiones → 2 partes', sim.policies.D1.id === 'D1-PROV-2026-10-v1' && sim.policies.D1.status === 'provisional'
        && sim.works.find((w) => w.contentId === 'c2').parts.length === 2);
    const c3 = sim.works.find((w) => w.contentId === 'c3');
    ok('c3 en disputa: MontoObra retenido, no cobrable', c3.montoObra > 0 && c3.retained === c3.montoObra);
    ok('D4 complemento de alfa pendiente', sim.totals.pending.alphaComplement > 0);
    const aut = sim.holders.find((h) => h.publisherId === AUT.id);
    ok('autora (tercero) compartida entre c1 (PUB) y c2 (Externa)', aut && aut.variable > 0 && sim.works.filter((w) => w.beneficiaries.includes(AUT.id)).length === 2);
    ok('conciliación: Σ cobrable de titulares = total; BRD = cobrable + retenido + pendiente', sim.reconciliation.ok
        && sum(sim.holders.map((h) => h.payable)) === sim.totals.payable && sim.totals.payable + sim.totals.retained + sim.totals.pendingTotal === 500_000);
    texts.push(JSON.stringify(sim));

    console.log('\n[5] exportaciones del mismo resultado');
    const csv = await call(R(`month=2026-11&format=csv&expectReference=${sim.reference.value}`), 'ADM');
    ok('CSV: 200, text/csv, adjunto, no-store, BOM', csv.status === 200 && /text\/csv/.test(csv.h('content-type')) && /attachment/.test(csv.h('content-disposition'))
        && /no-store/.test(csv.h('cache-control') || '') && csv.bom);
    ok('CSV: referencia, NO EXIGIBLE, fórmula y D1', csv.text.includes(sim.reference.value) && csv.text.includes('NO EXIGIBLE') && csv.text.includes('sqrt(Q)') && csv.text.includes('D1-PROV-2026-10-v1'));
    const cells = csv.text.split(/\r\n/).flatMap((l) => l.split(';'));
    ok('CSV: ninguna celda empieza por = + - @ (inyección neutralizada)', cells.every((c) => !/^"?[=+@]/.test(c) && !/^"-/.test(c)) && csv.text.includes(`"'=HYPERLINK(""http://x.test"",""clic"")"`));
    ok('CSV: cobrable total igual al de la pantalla', csv.text.includes(`"Cobrable (COP)";${sim.totals.payable}\r\n`));
    for (const h of sim.holders) ok(`CSV: saldo de ${h.name} = ${h.payable}`, csv.text.split('\r\n').some((l) => l.startsWith(`"${h.publisherId}";`) && l.endsWith(`;${h.payable};"${h.belowPayoutThreshold ? 'sí' : 'no'}"`)));
    const html = await call(R(`month=2026-11&format=html&expectReference=${sim.reference.value}`), 'ADM');
    ok('HTML: 200, CSP sin scripts, no-store', html.status === 200 && /text\/html/.test(html.h('content-type')) && /default-src 'none'/.test(html.h('content-security-policy') || ''));
    ok('HTML: título escapado y sin <script>', html.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !/<script/i.test(html.text));
    ok('HTML: NO EXIGIBLE, referencia e importes', html.text.includes('NO EXIGIBLE') && html.text.includes(sim.reference.value) && html.text.includes(Number(sim.totals.payable).toLocaleString('es-CO')));
    ok('referencia distinta → 409 result_changed', (await call(R('month=2026-11&format=csv&expectReference=deadbeef'), 'ADM')).body?.code === 'result_changed');
    const f = (await call(R(`month=2026-11&titular=${AUT.id}`), 'ADM')).body;
    ok('filtro por titular: solo la autora y sus obras; totales intactos', f.holders.length === 1 && f.holders[0].publisherId === AUT.id && f.works.length === 2
        && f.totals.payable === sim.totals.payable && f.visibleTotals.payable === aut.payable);
    // U6 (regresión): con filtro, el archivo dice que los totales son del periodo completo y da el subtotal visible.
    const fcsv = await call(R(`month=2026-11&titular=${AUT.id}&format=csv&expectReference=${sim.reference.value}`), 'ADM');
    const fhtml = await call(R(`month=2026-11&titular=${AUT.id}&format=html&expectReference=${sim.reference.value}`), 'ADM');
    ok('CSV filtrado: ámbito de los totales y subtotal visible del titular', fcsv.text.includes('"Ámbito de los totales";"Periodo completo (sin filtrar)"')
        && fcsv.text.includes(`"Subtotal visible: cobrable (COP)";${aut.payable}\r\n`) && fcsv.text.includes(`"Cobrable (COP)";${sim.totals.payable}\r\n`));
    ok('HTML filtrado: ámbito y subtotal visible', fhtml.text.includes('Periodo completo (sin filtrar)') && fhtml.text.includes(`cobrable ${Number(aut.payable).toLocaleString('es-CO')} COP`));
    const nf = await call(R(`month=2026-11&format=csv&expectReference=${sim.reference.value}`), 'ADM');
    ok('sin filtro no aparece el subtotal visible', !nf.text.includes('Subtotal visible'));
    const fe = (await call(R(`month=2026-11&editorial=${EXT.id}`), 'ADM')).body;
    ok('filtro por editorial: obras de Externa (c2, c3)', fe.works.map((w) => w.contentId).join() === 'c2,c3', JSON.stringify(fe.works.map((w) => [w.contentId, w.responsiblePublisherId])) + ' ext=' + EXT.id);
    const fo = (await call(R('month=2026-11&obra=c1'), 'ADM')).body;
    ok('filtro por obra: c1 y sus beneficiarios', fo.works.length === 1 && fo.holders.map((h) => h.publisherId).sort().join() === [AUT.id, PUB].sort().join());
    texts.push(csv.text, html.text);

    console.log('\n[6] INS cero');
    await call('/api/admin/royalties/period-inputs', 'ADM', { period: '2026-12', grossCop: 0, deductionsCop: 0, supportRef: 'SIN-RECAUDO-FX-DIC' });
    const dec = (await call(R('month=2026-12'), 'ADM')).body;
    ok('diciembre con INS 0: bolsas en 0, conciliado', dec.pools.brd === 0 && dec.totals.payable === 0 && dec.reconciliation.ok);

    console.log('\n[7] cierre técnico');
    ok('sin confirmación → 400', (await call('/api/admin/royalties/closes', 'ADM', { month: '2026-11', periodInputId: pi.body.id })).body?.code === 'confirmation_required');
    ok('oficial no habilitado → 400', (await call('/api/admin/royalties/closes', 'ADM', { month: '2026-11', periodInputId: pi.body.id, confirmMonth: '2026-11', mode: 'official' })).body?.code === 'official_not_enabled');
    const cl = await call('/api/admin/royalties/closes', 'ADM', { month: '2026-11', periodInputId: pi.body.id, confirmMonth: '2026-11' });
    ok('cierre técnico 201 con el mismo hash que la simulación', cl.status === 201 && cl.body.mode === 'technical' && cl.body.snapshotSha256 === sim.reference.value);
    ok('segundo cierre → 409', (await call('/api/admin/royalties/closes', 'ADM', { month: '2026-11', periodInputId: pi.body.id, confirmMonth: '2026-11' })).status === 409);
    ok('INS de un periodo cerrado → 409', (await call('/api/admin/royalties/period-inputs', 'ADM', { period: '2026-11', grossCop: 1, deductionsCop: 0, supportRef: 'x' })).status === 409);
    const closed = (await call(R('month=2026-11'), 'ADM')).body;
    ok('el informe pasa a TÉCNICO desde el cierre, con la misma referencia y cifras', closed.status === 'TECHNICAL' && closed.source === 'close' && closed.notExigible
        && closed.reference.value === sim.reference.value && closed.totals.payable === sim.totals.payable);
    ok('lista de cierres', (await call('/api/admin/royalties/closes', 'ADM')).body.map((c) => c.period).join() === '2026-11');

    console.log('\n[8] cambios posteriores de derechos');
    const st2 = await import('../publishersStore.mjs');
    rights.createRightsVersion('c1', v(PUB, { alpha: 0.2, effectiveAt: '2026-11-20T05:00:00.000Z' }), { content: C('c1'), actor: 'fixture' });
    st2.closeRoyaltiesDb();
    const after = (await call(R('month=2026-11'), 'ADM')).body;
    ok('el informe del cierre no cambia (misma referencia y cifras)', after.reference.value === closed.reference.value && JSON.stringify(after.holders) === JSON.stringify(closed.holders));

    console.log('\n[9] trimestre');
    const q1 = (await call(R('quarter=2026-Q4'), 'ADM')).body;
    ok('Q4 con solo noviembre: PROVISIONAL incompleto, faltan oct y dic', q1.status === 'PROVISIONAL_INCOMPLETE' && q1.missingMonths.join() === '2026-10,2026-12' && q1.notExigible);
    await call('/api/admin/royalties/period-inputs', 'ADM', { period: '2026-10', grossCop: 300_000, deductionsCop: 0, supportRef: 'SOPORTE-FX-OCT' });
    const octIn = (await call('/api/admin/royalties/period-inputs?period=2026-10', 'ADM')).body[0];
    const decIn = (await call('/api/admin/royalties/period-inputs?period=2026-12', 'ADM')).body[0];
    await call('/api/admin/royalties/closes', 'ADM', { month: '2026-10', periodInputId: octIn.id, confirmMonth: '2026-10' });
    await call('/api/admin/royalties/closes', 'ADM', { month: '2026-12', periodInputId: decIn.id, confirmMonth: '2026-12' });
    const q = (await call(R('quarter=2026-Q4'), 'ADM')).body;
    ok('Q4 completo con cierres técnicos → PROVISIONAL_TECHNICAL, nunca definitivo', q.complete && !q.definitive && q.status === 'PROVISIONAL_TECHNICAL' && q.notExigible);
    ok('Q4 = Σ cierres: BRD 75.000 + 500.000 + 0, conciliado', q.totals.brd === 575_000 && q.reconciliation.ok && sum(q.holders.map((h) => h.payable)) === q.totals.payable);
    ok('Q4: referencia sha256 y hashes de los 3 cierres', /^[0-9a-f]{64}$/.test(q.reference.value) && q.closes.every((c) => /^[0-9a-f]{64}$/.test(c.snapshotSha256)));
    const qcsv = await call(R(`quarter=2026-Q4&format=csv&expectReference=${q.reference.value}`), 'ADM');
    ok('CSV trimestral del mismo resultado', qcsv.status === 200 && qcsv.text.includes(q.reference.value) && qcsv.text.includes('"Meses faltantes";"ninguno"'));
    texts.push(JSON.stringify(q), qcsv.text);

    console.log('\n[10] privacidad y no escrituras');
    ok('sin identificadores, nombres ni correos de lectores en JSON, CSV ni HTML', texts.every((t) => !/"(LEC|LEC2)"|Lectora|lec@fx|userId|sessionId|S0000/.test(t)));
    const fp = fingerprint();
    for (const qq of ['month=2026-11', 'month=2026-12', 'month=2027-01', 'quarter=2026-Q4', 'month=2026-11&format=csv', 'quarter=2026-Q4&format=html']) await call(R(qq), 'ADM');
    ok('las consultas y exportaciones no escriben', JSON.stringify(fingerprint()) === JSON.stringify(fp));
    ok('sin errores del informe en el log', !/ROYALTIES_REPORT/.test(boot));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
}
ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\nroyaltyReportsHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
