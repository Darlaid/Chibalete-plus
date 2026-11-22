/**
 * contextLedgerRetention.test.mjs — CHP V9 65D-2R. Conservación del registro de procedencia.
 *
 * Regla operativa: constancias de sesión, 12 meses desde su última recepción; membresía cerrada, 12 meses desde su
 * cierre; membresía abierta y asociaciones obra–curso no caducan. Se comprueba sobre un insights.db temporal:
 *   [1] apagada por defecto (dos banderas); `dryRun` cuenta sin borrar
 *   [2] fechas límite: antes del vencimiento se conserva; en el vencimiento y después se elimina
 *   [3] nada necesario para una vinculación activa se elimina; las asociaciones obra–curso no llevan personas
 *   [4] idempotencia
 *   [5] dos procesos (réplicas) podando a la vez
 *   [6] lo podado no se reconstruye
 *   [7] después de podar, la evidencia que falta deja la lectura sin acreditar (nunca se da por buena)
 *   [8] supresión individual: sigue eliminando todo lo de la persona, caducado o no
 *   [9] calendario UTC: vencimiento exacto al milisegundo, fin de mes, 29 de febrero, sin depender de la zona horaria
 *   [10] constancias independientes: recibir otra sesión no renueva las anteriores
 *   [11] membresía cerrada por la observación: doce meses desde ESE cierre
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/contextLedgerRetention.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65d2r_'));
const DB = path.join(tmp, 'insights.db');
process.env.INSIGHTS_SQLITE_PATH = DB;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
delete process.env.AULA_VIVA_CONTEXT_LEDGER_RETENTION_ENABLED;

// Modo hijo: una «réplica» que poda con el reloj indicado y dice cuánto retiró.
if (process.argv[2] === '--prune-child') {
    process.env.AULA_VIVA_CONTEXT_LEDGER_RETENTION_ENABLED = '1';
    process.env.INSIGHTS_SQLITE_PATH = process.argv[3];
    const L = await import('../aulaViva/contextLedger.mjs');
    let r = L.pruneContextLedger({ nowTs: Number(process.argv[4]) });
    for (let i = 0; i < 20 && r.skipped === 'busy'; i++) { await new Promise((x) => setTimeout(x, 100)); r = L.pruneContextLedger({ nowTs: Number(process.argv[4]) }); }
    console.log(JSON.stringify(r));
    process.exit(0);
}

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++);
const section = (t) => console.log(`\n${t}`);

const L = await import('../aulaViva/contextLedger.mjs');
const { buildPedagogicalContext, creditSessions } = await import('../aulaViva/pedagogicalContext.mjs');
const DAY = 86_400_000;
const NOW = Date.UTC(2027, 10, 22, 15, 30, 0);            // reloj simulado de la poda
const CUT = L.ledgerRetentionCutoff(NOW);                 // 2026-11-22T15:30:00Z: lo fechado aquí vence exactamente en NOW

L.ledgerStatus();                                         // crea el esquema
const raw = new Database(DB);
const receipt = (user, work, sid, lastTs, extra = {}) => raw.prepare(`INSERT INTO reading_session_receipts (user_id, work_id, session_id, declared_start_ts, duration_sec, mode, first_received_ts, last_received_ts, from_origin)
    VALUES (?, ?, ?, ?, 600, 'text', ?, ?, ?)`).run(user, work, sid, extra.declared ?? lastTs - 600_000, extra.first ?? lastTs, lastTs, extra.origin ?? 1);
const interval = (kind, group, item, since, until, origin = 'observed') => raw.prepare(`INSERT INTO pedagogical_context_intervals (kind, group_id, work_id, user_id, since_ts, until_ts, origin) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(kind, group, kind === 'work' ? item : null, kind === 'member' ? item : null, since, until, origin);
const count = (q, ...a) => raw.prepare(q).get(...a).n;
const receiptsOf = (u) => count(`SELECT COUNT(*) n FROM reading_session_receipts WHERE user_id = ?`, u);
const memberRows = (u) => raw.prepare(`SELECT since_ts, until_ts, origin FROM pedagogical_context_intervals WHERE kind = 'member' AND user_id = ? ORDER BY since_ts`).all(u);

// Constancias en el límite: vencida hace 1 ms, vence exactamente ahora, vence dentro de 1 ms; una primera recepción antigua con última recepción reciente.
receipt('r-old', 'w1', 's-before', CUT - 1);
receipt('r-edge', 'w1', 's-exact', CUT);
receipt('r-new', 'w1', 's-after', CUT + 1);
receipt('r-long', 'w1', 's-refreshed', NOW - 5 * DAY, { first: CUT - 300 * DAY });
receipt('r-old', 'w1', '', CUT - 10 * DAY);              // guardado sin sesión, caducado
// Membresías: cerrada 1 ms antes del límite, cerrada en el límite, cerrada después; abierta desde hace tres años.
interval('member', 'g1', 'm-gone', CUT - 400 * DAY, CUT - 1);
interval('member', 'g1', 'm-edge', CUT - 400 * DAY, CUT);
interval('member', 'g1', 'm-recent', CUT - 400 * DAY, CUT + 1);
interval('member', 'g1', 'm-active', NOW - 3 * 365 * DAY, null, 'baseline');
interval('member', 'g1', 'm-back', CUT - 500 * DAY, CUT - 100 * DAY);   // se fue hace más de 12 meses…
interval('member', 'g1', 'm-back', NOW - 30 * DAY, null);                // …y volvió: vinculación activa
// Asociaciones obra–curso: una cerrada hace años y una abierta.
interval('work', 'g1', 'w-old', CUT - 900 * DAY, CUT - 800 * DAY);
interval('work', 'g1', 'w1', NOW - 3 * 365 * DAY, null, 'baseline');
const TOTAL = { receipts: count(`SELECT COUNT(*) n FROM reading_session_receipts`), intervals: count(`SELECT COUNT(*) n FROM pedagogical_context_intervals`) };

section('[1] apagada por defecto');
{
    const off = L.pruneContextLedger({ nowTs: NOW });
    ok('sin su bandera no elimina nada y lo dice', off.ok && off.skipped === 'retention_disabled_default_off' && count(`SELECT COUNT(*) n FROM reading_session_receipts`) === TOTAL.receipts && count(`SELECT COUNT(*) n FROM pedagogical_context_intervals`) === TOTAL.intervals, JSON.stringify(off));
    ok('la entrada del planificador tampoco', L.pruneOnce().skipped === 'retention_disabled_default_off');
    const dry = L.pruneContextLedger({ nowTs: NOW, dryRun: true });
    ok('`dryRun` cuenta lo que caducaría (3 constancias, 3 membresías cerradas) sin borrar', dry.ok && dry.dry_run && dry.receipts_removed === 3 && dry.member_intervals_removed === 3 && dry.cutoff_ts === CUT && count(`SELECT COUNT(*) n FROM reading_session_receipts`) === TOTAL.receipts, JSON.stringify(dry));
    process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '0'; process.env.AULA_VIVA_CONTEXT_LEDGER_RETENTION_ENABLED = '1';
    ok('con el registro apagado la bandera de conservación sola no hace nada', L.pruneContextLedger({ nowTs: NOW }).skipped === 'ledger_disabled' && L.RETENTION_ENABLED() === false);
    process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
}

section('[2] fechas límite');
const first = L.pruneContextLedger({ nowTs: NOW });
{
    ok('el corte es exacto: lo fechado en él vence en este instante y lo fechado 1 ms después, dentro de 1 ms', L.ledgerExpiryTs(CUT) === NOW && L.ledgerExpiryTs(CUT + 1) === NOW + 1 && L.ledgerExpiryTs(CUT - 1) === NOW - 1);
    ok('la poda retira 3 constancias y 3 membresías cerradas', first.ok && !first.skipped && first.receipts_removed === 3 && first.member_intervals_removed === 3, JSON.stringify(first));
    ok('constancia vencida hace 1 ms: eliminada (también su guardado sin sesión)', receiptsOf('r-old') === 0);
    ok('constancia que vence exactamente AHORA (12 meses justos desde su última recepción): eliminada', receiptsOf('r-edge') === 0);
    ok('constancia que vence dentro de 1 ms: se conserva', receiptsOf('r-new') === 1);
    ok('cuenta la ÚLTIMA recepción: una sesión antigua vuelta a recibir hace cinco días se conserva', receiptsOf('r-long') === 1);
    ok('membresía cuyo plazo venció hace 1 ms o vence exactamente ahora: eliminadas; la que vence dentro de 1 ms: conservada', memberRows('m-gone').length === 0 && memberRows('m-edge').length === 0 && memberRows('m-recent').length === 1);
}

section('[3] vinculación activa y asociaciones obra–curso');
{
    const active = memberRows('m-active');
    ok('membresía abierta desde hace tres años: intacta (misma fecha y origen)', active.length === 1 && active[0].until_ts === null && active[0].origin === 'baseline' && active[0].since_ts === NOW - 3 * 365 * DAY, JSON.stringify(active));
    const back = memberRows('m-back');
    ok('quien se fue hace más de 12 meses y volvió: caduca el periodo cerrado, se conserva el vigente', back.length === 1 && back[0].until_ts === null && back[0].since_ts === NOW - 30 * DAY, JSON.stringify(back));
    ok('asociaciones obra–curso: ninguna se elimina, ni la cerrada hace años', count(`SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE kind = 'work'`) === 2);
    ok('…y no llevan ningún identificador de persona (`user_id` nulo en todas)', count(`SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE kind = 'work' AND user_id IS NOT NULL`) === 0);
}

section('[4] idempotencia');
{
    const again = L.pruneContextLedger({ nowTs: NOW });
    ok('repetir la poda no elimina nada más', again.ok && again.receipts_removed === 0 && again.member_intervals_removed === 0, JSON.stringify(again));
    const st = L.ledgerStatus();
    ok('el estado declara la conservación: meses, bandera y última poda, sin identificadores', st.retention?.months === 12 && st.retention.enabled === true && st.retention.last_pruned_ts === NOW && !/r-|m-/.test(JSON.stringify(st)), JSON.stringify(st.retention));
}

section('[5] dos procesos podando a la vez');
{
    for (let i = 0; i < 400; i++) receipt(`c-${i % 40}`, 'w1', `cs-${i}`, CUT - 1000 - i);
    for (let i = 0; i < 60; i++) interval('member', 'g2', `cm-${i}`, CUT - 400 * DAY, CUT - 1000 - i);
    const run = () => new Promise((res) => { let out = ''; const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--prune-child', DB, String(NOW)], { cwd: path.resolve(HERE, '..', '..'), env: { ...process.env } });
        c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', () => { try { res(JSON.parse(out.trim().split('\n').pop())); } catch { res({ ok: false, raw: out }); } }); });
    const [a, b] = await Promise.all([run(), run()]);
    ok('las dos terminan bien y entre ambas retiran exactamente lo caducado (400 constancias, 60 membresías), sin duplicar ni dejar restos',
        a.ok && b.ok && a.receipts_removed + b.receipts_removed === 400 && a.member_intervals_removed + b.member_intervals_removed === 60
        && count(`SELECT COUNT(*) n FROM reading_session_receipts WHERE last_received_ts < ?`, CUT) === 0, JSON.stringify([a, b]));
    const left = [count(`SELECT COUNT(*) n FROM reading_session_receipts`), count(`SELECT COUNT(*) n FROM pedagogical_context_intervals`)];
    ok('lo vigente sigue ahí y nada más desaparece: quedan exactamente las 2 constancias y los 5 intervalos no vencidos', receiptsOf('r-new') === 1 && receiptsOf('r-long') === 1 && memberRows('m-active').length === 1 && left[0] === 2 && left[1] === 5, JSON.stringify(left));
}

section('[6] lo podado no se reconstruye');
{
    const before = count(`SELECT COUNT(*) n FROM pedagogical_context_intervals`);
    // Estado actual: m-active y m-back siguen en el curso con la obra w1; m-gone ya no está.
    const r = L.observeContext([{ groupId: 'g1', works: ['w1'], members: ['m-active', 'm-back'] }], { nowTs: NOW + 1000 });
    ok('una observación posterior no recrea la membresía eliminada ni toca las vigentes', r.ok && r.opened === 0 && memberRows('m-gone').length === 0 && memberRows('m-active')[0].since_ts === NOW - 3 * 365 * DAY, JSON.stringify(r));
    ok('…ni añade filas', r.closed === 0 && count(`SELECT COUNT(*) n FROM pedagogical_context_intervals`) === before, JSON.stringify(r));
    const re = L.observeContext([{ groupId: 'g1', works: ['w1'], members: ['m-active', 'm-back', 'm-gone'] }], { nowTs: NOW + 2000 });
    const rows = memberRows('m-gone');
    ok('si la persona vuelve al curso, su membresía empieza HOY («observada»), no en la fecha que tuvo', re.opened === 1 && rows.length === 1 && rows[0].since_ts === NOW + 2000 && rows[0].origin === 'observed' && rows[0].until_ts === null, JSON.stringify(rows));
}

section('[7] evidencia que falta ⇒ lectura sin acreditar');
{
    const ctx = () => buildPedagogicalContext({ readerId: 'm-active', groups: [{ groupId: 'g1', works: { all: false, ids: ['w1'], has: (c) => c === 'w1' } }], intervals: L.contextIntervals(['g1']) });
    const startedMs = CUT - 20 * DAY;
    const progress = { userId: 'm-active', contentId: 'w1', history: [{ sessionId: 'p-1', startedAt: new Date(startedMs).toISOString(), durationSec: 600, mode: 'text' }] };
    receipt('m-active', 'w1', 'p-1', startedMs + 600_000, { declared: startedMs, first: startedMs + 600_000 });
    const with1 = creditSessions(ctx(), progress, L.sessionReceiptsOf('m-active').get('w1'));
    ok('con su constancia, la sesión se acredita con su fecha y el progreso consta completo', with1.complete === true && with1.unverified === 0 && with1.sessions[0].startedAt === new Date(startedMs).toISOString(), JSON.stringify(with1));
    const p = L.pruneContextLedger({ nowTs: NOW });
    const without = creditSessions(ctx(), progress, L.sessionReceiptsOf('m-active').get('w1'));
    ok('caducada la constancia, la misma sesión queda SIN fecha acreditada y el progreso deja de constar completo', p.receipts_removed === 1 && without.complete === false && without.unverified === 1 && without.sessions[0].startedAt === null && without.sessions[0].evidence === 'no_server_receipt', JSON.stringify(without));
    ok('…y la membresía abierta sigue acreditando el presente', ctx().classify('w1', NOW - DAY) === 'in');
    // Periodo de una membresía eliminada: ya no consta ⇒ no se atribuye.
    const gone = buildPedagogicalContext({ readerId: 'm-old', groups: [{ groupId: 'g1', works: { all: false, ids: ['w1'], has: (c) => c === 'w1' } }], intervals: L.contextIntervals(['g1']) });
    ok('un periodo sin intervalo registrado no se atribuye al curso', gone.classify('w1', CUT - 50 * DAY) !== 'in' && gone.includeContent('w1', CUT - 50 * DAY) === false);
}

section('[8] supresión individual');
{
    const SUP = await import('../privacy/suppression.mjs');
    receipt('m-active', 'w1', 'p-2', NOW - DAY);
    const paths = SUP.residualPaths({ CHP_DATA_DIR: path.join(tmp, 'data'), EVENTS_SQLITE_PATH: path.join(tmp, 'no-events.db'), ARCHIVE_SQLITE_PATH: path.join(tmp, 'no-archive.db'),
        PROGRESS_SQLITE_PATH: path.join(tmp, 'no-progress.db'), INSIGHTS_SQLITE_PATH: DB }, tmp);
    const ack = await SUP.suppressResidualSources(paths, 'm-active');
    ok('elimina las constancias vigentes y la membresía ABIERTA de la persona (la conservación no la retiene)', receiptsOf('m-active') === 0 && memberRows('m-active').length === 0 && ack.insights?.rowsRemoved >= 2, JSON.stringify(ack.insights));
    ok('…y no toca lo de las demás ni las asociaciones obra–curso', receiptsOf('r-new') === 1 && memberRows('m-back').length === 1 && count(`SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE kind = 'work'`) === 2);
}

section('[9] calendario UTC y vencimiento exacto');
{
    const I = (x) => Date.parse(x), iso = (t) => new Date(t).toISOString();
    // [fecha de la última recepción o del cierre, vencimiento esperado]
    const CASES = [
        ['2027-03-15T09:20:30.123Z', '2028-03-15T09:20:30.123Z'],   // día cualquiera: misma fecha y hora, un año después
        ['2027-01-31T08:00:00.000Z', '2028-01-31T08:00:00.000Z'],   // fin de mes
        ['2027-12-31T23:59:59.999Z', '2028-12-31T23:59:59.999Z'],   // último milisegundo del año
        ['2027-02-28T12:00:01.000Z', '2028-02-28T12:00:01.000Z'],   // 28 de febrero hacia un año bisiesto
        ['2028-02-28T13:00:00.000Z', '2029-02-28T13:00:00.000Z'],   // 28 de febrero de un bisiesto
        ['2028-02-29T12:00:00.000Z', '2029-03-01T00:00:00.000Z'],   // 29 de febrero: ese día no existe ⇒ comienzo del 1 de marzo
        ['2028-03-01T00:00:00.000Z', '2029-03-01T00:00:00.000Z'],
        ['2027-03-28T01:30:00.000Z', '2028-03-28T01:30:00.000Z'],   // noche de cambio de hora en Europa: UTC no lo nota
        ['2027-11-07T06:30:00.000Z', '2028-11-07T06:30:00.000Z'],   // …y en América
    ];
    ok('el vencimiento es la misma fecha y hora UTC doce meses después (29 de febrero ⇒ 1 de marzo)', CASES.every(([d, e]) => iso(L.ledgerExpiryTs(I(d))) === e), JSON.stringify(CASES.map(([d]) => iso(L.ledgerExpiryTs(I(d))))));
    ok('nunca transcurren menos de 365 días', CASES.every(([d]) => L.ledgerExpiryTs(I(d)) - I(d) >= 365 * DAY));
    let badOrder = 0, prev = -Infinity; for (let t = I('2026-06-01T00:00:00Z'); t < I('2029-06-01T00:00:00Z'); t += 53 * 60_000 + 311) { const e = L.ledgerExpiryTs(t); if (e < prev) badOrder++; prev = e; }
    ok('una fecha posterior nunca vence antes que una anterior (tres años recorridos)', badOrder === 0, String(badOrder));
    let inexact = 0; for (let now = I('2027-02-25T00:00:00Z'); now < I('2029-03-05T00:00:00Z'); now += 5 * 3_600_000 + 7777) { const c = L.ledgerRetentionCutoff(now); if (!(L.ledgerExpiryTs(c) <= now && L.ledgerExpiryTs(c + 1) > now)) inexact++; }
    ok('el corte de la poda equivale exactamente a «vencimiento <= ahora» (dos años recorridos, incluido el bisiesto)', inexact === 0, String(inexact));
    // Cada caso contra la poda real, en orden de vencimiento: 1 ms antes se conserva; en su vencimiento se elimina.
    const sorted = [...CASES].sort((a, b) => I(a[1]) - I(b[1]) || I(a[0]) - I(b[0]));
    sorted.forEach(([d], i) => { receipt(`cal-${i}`, 'w1', `cal-s-${i}`, I(d)); interval('member', 'g9', `cal-${i}`, I(d) - 30 * DAY, I(d)); });
    const present = (i) => receiptsOf(`cal-${i}`) === 1 && memberRows(`cal-${i}`).length === 1, absent = (i) => receiptsOf(`cal-${i}`) === 0 && memberRows(`cal-${i}`).length === 0;
    const wrong = [];
    sorted.forEach(([d, e], i) => {
        const earlierTwin = sorted.findIndex((c) => c[1] === e) < i;      // otra fila con el MISMO vencimiento ya se podó en él
        L.pruneContextLedger({ nowTs: I(e) - 1 });
        if (!present(i) && !earlierTwin) wrong.push(`${d}: eliminada 1 ms ANTES de vencer`);
        L.pruneContextLedger({ nowTs: I(e) });
        if (!absent(i)) wrong.push(`${d}: sigue existiendo EN su vencimiento`);
    });
    ok('poda real, caso por caso: 1 ms antes del vencimiento constancia y membresía existen; en el vencimiento, ya no', wrong.length === 0, wrong.join(' | '));
    ok(`el resultado no depende de la zona horaria del proceso (TZ=${process.env.TZ ?? 'sin definir'}; desfase local ${new Date(I('2027-07-01T00:00:00Z')).getTimezoneOffset()} min)`,
        L.ledgerExpiryTs(I('2027-03-28T01:30:00.000Z')) === I('2028-03-28T01:30:00.000Z') && iso(L.ledgerRetentionCutoff(I('2028-03-28T01:30:00.000Z'))) === '2027-03-28T01:30:00.000Z');
}

section('[10] constancias independientes');
{
    const T0 = Date.UTC(2030, 0, 10, 10), SIX = Date.UTC(2030, 6, 10, 10);
    const rec = (sid, at, dur = 600) => L.recordSessionReceipt({ userId: 'ind', workId: 'w1', sessionId: sid, declaredStartTs: at - dur * 1000, durationSec: dur, mode: 'text', fromOrigin: sid === 'A', nowTs: at });
    rec('A', T0);
    rec('B', SIX);                                          // seis meses después llega OTRA sesión de la misma obra
    L.recordSessionReceipt({ userId: 'ind', workId: 'w1', sessionId: '', nowTs: SIX + 1000 });   // …y un guardado sin sesión
    const lastOf = (sid) => raw.prepare(`SELECT last_received_ts t FROM reading_session_receipts WHERE user_id = 'ind' AND session_id = ?`).get(sid)?.t;
    ok('recibir otra sesión o guardar más progreso no cambia la última recepción de la primera', lastOf('A') === T0 && lastOf('B') === SIX, JSON.stringify([lastOf('A'), lastOf('B')]));
    L.pruneContextLedger({ nowTs: L.ledgerExpiryTs(T0) - 1 });
    ok('1 ms antes del vencimiento de la primera: las tres constancias existen', receiptsOf('ind') === 3);
    L.pruneContextLedger({ nowTs: L.ledgerExpiryTs(T0) });
    ok('en el vencimiento de la primera: ella caduca aunque las otras sean recientes; las otras siguen', lastOf('A') === undefined && lastOf('B') === SIX && receiptsOf('ind') === 2);
    // Volver a recibir LA MISMA sesión (reintento) sí mueve su última recepción: es la regla («desde la última recepción»).
    rec('B', SIX + 30 * DAY);
    L.pruneContextLedger({ nowTs: L.ledgerExpiryTs(SIX) });
    const aliveAtOriginal = lastOf('B') === SIX + 30 * DAY;
    L.pruneContextLedger({ nowTs: L.ledgerExpiryTs(SIX + 30 * DAY) });
    ok('solo volver a recibir ESA sesión mueve su plazo: vive en su vencimiento original y caduca doce meses después de su última recepción', aliveAtOriginal && lastOf('B') === undefined);
}

section('[11] membresía cerrada por la observación');
{
    const OPEN = Date.UTC(2031, 0, 5, 9), CLOSE = Date.UTC(2034, 4, 20, 14, 45);
    L.observeContext([{ groupId: 'g1', works: ['w1'], members: ['m-back', 'leaver'] }], { nowTs: OPEN });
    L.pruneContextLedger({ nowTs: OPEN + 3 * 365 * DAY });   // tres años después y aún abierta: no caduca
    const open = memberRows('leaver');
    L.observeContext([{ groupId: 'g1', works: ['w1'], members: ['m-back'] }], { nowTs: CLOSE });   // sale del curso
    const closed = memberRows('leaver');
    ok('mientras está abierta no caduca; al salir del curso el servidor anota el cierre con su reloj', open.length === 1 && open[0].until_ts === null && closed.length === 1 && closed[0].until_ts === CLOSE, JSON.stringify([open, closed]));
    L.pruneContextLedger({ nowTs: L.ledgerExpiryTs(CLOSE) - 1 });
    const before = memberRows('leaver').length;
    L.pruneContextLedger({ nowTs: L.ledgerExpiryTs(CLOSE) });
    ok('doce meses desde ESE cierre (no desde su inicio): 1 ms antes existe; en el vencimiento se elimina', before === 1 && memberRows('leaver').length === 0);
    ok('…y quien sigue en el curso conserva su membresía abierta', memberRows('m-back').some((r) => r.until_ts === null));
}

raw.close(); L.closeContextLedger();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
console.log(`\ncontextLedgerRetention — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
