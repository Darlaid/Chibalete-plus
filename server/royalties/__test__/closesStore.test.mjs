/**
 * closesStore.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U4 · F4-B-01.
 *
 * Cierres mensuales y trimestres sobre una royalties.db TEMPORAL (ROYALTIES_DB):
 *   [1] migración 0004 idempotente y encadenada
 *   [2] triggers append-only y restricciones SQL
 *   [3] INS con soporte (P11)
 *   [4] cierre técnico: U2 → U3 → snapshot canónico + hash, sin datos de lectores
 *   [5] simulación (no guarda; mismo hash) y cierre repetido
 *   [6] reproducción determinista y cambios posteriores de derechos/editorial
 *   [7] mes sin ingresos y periodo sin lecturas
 *   [8] retenidos y pendientes (D1 provisional, D3, D4, D5) no cobrables
 *   [9] movimientos: pago registrado, retención, liberación, asignación, traslado
 *   [10] trimestre completo, incompleto y definitivo (oficial)
 *   [11] manipulación detectada por hash
 *   [12] respaldo y restauración aislada con la 0004
 * Nunca toca data-critical/.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const code = (fn, c) => { try { fn(); return false; } catch (e) { return e.code === c; } };
const sqlFails = (fn, rx) => { try { fn(); return false; } catch (e) { return rx.test(e.message); } };
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB) ? fs.statSync(REAL_DB).mtimeMs : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_closes_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');

const P = await import('../publishersStore.mjs');
const R = await import('../rightsStore.mjs');
const C = await import('../closesStore.mjs');
const { RULE_SET_RS_2026_01_V1: RS } = await import('../economicEpisodes.mjs');
const { runMigrations } = await import('../../db/migrate.js');

const ALL = Object.fromEntries(R.RIGHTS_CAPABILITIES.map((c) => [c, true]));
const CLOCK = { clockSkewToleranceMs: 120_000, maxIngestDelayMs: 600_000 };
// Reloj del servidor controlado (CLOSE-GUARD-01): posterior a todos los meses que se cierran.
const LATER = '2027-06-01T12:00:00.000Z';
let seq = 0;
const read = (user, content, start, minutes = 10) => {
    const sid = `s-${++seq}`; const t0 = Date.parse(`${start}-05:00`);
    const mk = (event, t, payload) => ({ event_id: `ev-${String(++seq).padStart(7, '0')}`, event, mode: 'pdf', user_id: user, content_id: content,
        session_id: sid, client_ts: t, server_ts: t + 2000, payload_json: JSON.stringify(payload) });
    const out = [mk('pdf.session_start', t0, { econAccess: { ruleId: 'r', commercialClass: 'paid_b2c' } })];
    for (let s = 15; s <= minutes * 60; s += 15) out.push(mk('econ_tick', t0 + s * 1000, { windowMs: 15_000, visible: true, humanSignalAgoMs: 5_000, firstHumanSignalAgoMs: 5_000 }));
    return out;
};

try {
    section('[1] migración 0004');
    const db = P.getRoyaltiesDb();
    const versions = db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version);
    ok('0001…0004 aplicadas en orden', versions.join() === '0001_publishers,0002_rights_versions,0003_content_publisher_history,0004_closes');
    const again = runMigrations(db, () => {}, { dir: path.join(REPO, 'server', 'royalties', 'migrations'), tag: 't' });
    ok('re-ejecutar no aplica nada (idempotente)', again.applied.length === 0 && again.already.length === 4);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    ok('las 4 tablas del Plan §3.1 existen', ['rule_sets', 'period_inputs', 'closes', 'adjustments'].every((t) => tables.includes(t)));
    const trig = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((r) => r.name);
    ok('8 triggers nuevos (UPDATE y DELETE en cada tabla)', ['rule_sets', 'period_inputs', 'closes', 'adjustments'].every((t) => trig.includes(`${t}_no_update`) && trig.includes(`${t}_no_delete`)));

    // Fixture real: titulares, obras y derechos en la base temporal.
    const ED = P.createPublisher({ kind: 'editorial', legalName: 'Editorial Sintética', tradeName: 'Sintética' });
    const AUT = P.createPublisher({ kind: 'tercero', legalName: 'Autora Sintética', tradeName: 'Autora' });
    const book = (id) => ({ id, titulo: id, tipo: 'libro', status: 'disponible', publisherId: ED.id });
    const contents = new Map(['B1', 'B2', 'B3'].map((id) => [id, book(id)]));
    const rights = (contentId, o = {}) => R.createRightsVersion(contentId, {
        publisherId: ED.id, actRef: `ACTA-${contentId}`, actSignedOn: '2026-01-01', validFrom: o.validFrom ?? '2026-01-01', validUntil: null,
        effectiveAt: o.effectiveAt ?? '2026-01-01T05:00:00.000Z', legalStatus: o.legal ?? 'active', economicStatus: 'active', settlementClass: 'liquidable',
        alpha: o.alpha ?? 0.7, expectedMinutes: 10, shares: o.shares ?? [{ publisherId: ED.id, shareBp: 10000 }], permissions: ALL,
    }, { content: contents.get(contentId), actor: 'ADM', now: '2026-10-01T00:00:00.000Z' });
    rights('B1', { shares: [{ publisherId: ED.id, shareBp: 8000 }, { publisherId: AUT.id, shareBp: 2000 }] });
    rights('B1', { alpha: 0.9, validFrom: '2026-11-15', effectiveAt: '2026-11-15T05:00:00.000Z', shares: [{ publisherId: ED.id, shareBp: 8000 }, { publisherId: AUT.id, shareBp: 2000 }] });
    rights('B2', { alpha: 1 });
    rights('B3', { legal: 'disputed' });
    const live = (rows) => ({ rows, contents, versionsByContent: R.rightsIndex(), publisherHistoryByContent: new Map(),
        publishersById: new Map(P.listPublishers().map((p) => [p.id, p])), excludedUsers: new Map(), clock: CLOCK, ruleSet: RS });
    const NOV_ROWS = [...read('LECTOR-1', 'B1', '2026-11-05T10:00:00'), ...read('LECTOR-2', 'B1', '2026-11-06T10:00:00', 5),
        ...read('LECTOR-1', 'B1', '2026-11-20T10:00:00'), ...read('LECTOR-3', 'B2', '2026-11-08T10:00:00'), ...read('LECTOR-4', 'B3', '2026-11-09T10:00:00')];

    section('[2] append-only y restricciones');
    ok('INS que no cuadra con recaudo − deducciones → CHECK', sqlFails(() => db.prepare(`INSERT INTO period_inputs VALUES ('x','2026-11',10,1,8,'s',NULL,'a','t')`).run(), /CHECK/));
    ok('INS sin soporte → CHECK', sqlFails(() => db.prepare(`INSERT INTO period_inputs VALUES ('x','2026-11',10,1,9,'  ',NULL,'a','t')`).run(), /CHECK/));

    section('[3] INS con soporte (P11)');
    const inNov = C.recordPeriodInput({ period: '2026-11', grossCop: 2_100_000, deductionsCop: 100_000, supportRef: 'SOPORTE-FX-2026-11' }, { actor: 'ADM', now: '2026-12-02T10:00:00.000Z' });
    ok('INS = recaudo − deducciones (2.000.000)', inNov.insCop === 2_000_000 && inNov.supportRef === 'SOPORTE-FX-2026-11');
    ok('sin soporte → support_required', code(() => C.recordPeriodInput({ period: '2026-11', grossCop: 1, deductionsCop: 0, supportRef: '' }, { actor: 'ADM' }), 'support_required'));
    ok('deducciones > recaudo → invalid_amount', code(() => C.recordPeriodInput({ period: '2026-11', grossCop: 1, deductionsCop: 2, supportRef: 's' }, { actor: 'ADM' }), 'invalid_amount'));
    ok('importe no entero → invalid_amount', code(() => C.recordPeriodInput({ period: '2026-11', grossCop: 1.5, deductionsCop: 0, supportRef: 's' }, { actor: 'ADM' }), 'invalid_amount'));
    ok('periodo inválido → invalid_period', code(() => C.recordPeriodInput({ period: '2026-13', grossCop: 1, deductionsCop: 0, supportRef: 's' }, { actor: 'ADM' }), 'invalid_period'));
    ok('UPDATE/DELETE de period_inputs fallan', sqlFails(() => db.prepare('UPDATE period_inputs SET ins_cop = 0').run(), /append-only/) && sqlFails(() => db.prepare('DELETE FROM period_inputs').run(), /append-only/));

    section('[4] cierre técnico de noviembre');
    const sim = C.closeMonth({ month: '2026-11', mode: 'technical', periodInputId: inNov.id, ...live(NOV_ROWS) }, { actor: 'ADM', simulate: true });
    ok('simulación: no guarda nada', sim.simulation === true && C.getClose('2026-11') === null && db.prepare('SELECT COUNT(*) n FROM rule_sets').get().n === 0);
    const nov = C.closeMonth({ month: '2026-11', mode: 'technical', periodInputId: inNov.id, ...live(NOV_ROWS) }, { actor: 'ADM', now: '2026-12-05T10:00:00.000Z' });
    ok('cierre guardado, íntegro y con el mismo hash que la simulación', nov && nov.integrityOk && nov.snapshotSha256 === sim.snapshotSha256 && /^[0-9a-f]{64}$/.test(nov.snapshotSha256));
    const s = nov.snapshot;
    ok('técnico: no autoriza pagos', nov.mode === 'technical' && s.status === 'TECHNICAL_CLOSE' && s.paymentsAuthorized === false && nov.authorizationRef === null);
    ok('congela rule_set, INS con soporte, derechos y titulares', s.ruleSet.id === RS.id && s.periodInput.supportRef === 'SOPORTE-FX-2026-11'
        && s.rights.length === 4 && s.publishers.some((p) => p.id === AUT.id && p.tradeName === 'Autora'));
    ok('rule_set registrado una vez con su hash', db.prepare('SELECT COUNT(*) n FROM rule_sets').get().n === 1);
    ok('liquidación U3 dentro del snapshot, conciliada', s.settlement.reconciliation.ok && s.settlement.pools.brd === 500_000 && s.settlement.inputs.previewDigest === s.preview.trace.resultDigest);
    ok('digests de U2 y U3 en la fila del cierre', nov.previewDigest === s.preview.trace.resultDigest && nov.settlementDigest === s.settlement.trace.resultDigest);
    ok('sin identificadores de lectores', !/LECTOR-|"s-\d+"/.test(JSON.stringify(s)));
    ok('UPDATE/DELETE de closes fallan', sqlFails(() => db.prepare("UPDATE closes SET mode = 'official'").run(), /append-only/) && sqlFails(() => db.prepare('DELETE FROM closes').run(), /append-only/));
    ok('UPDATE/DELETE de rule_sets fallan', sqlFails(() => db.prepare("UPDATE rule_sets SET params = '{}'").run(), /append-only/) && sqlFails(() => db.prepare('DELETE FROM rule_sets').run(), /append-only/));

    section('[5] cierre repetido y cierre oficial');
    ok('segundo cierre del mismo periodo → close_exists', code(() => C.closeMonth({ month: '2026-11', mode: 'official', authorizationRef: 'AUT-1', periodInputId: inNov.id, ...live(NOV_ROWS) }, { actor: 'ADM', now: LATER }), 'close_exists'));
    ok('UNIQUE(period) también en SQL', sqlFails(() => db.prepare(`INSERT INTO closes SELECT 'dup', period, mode, rule_set_id, period_input_id, preview_digest, settlement_digest, snapshot, snapshot_sha256, authorization_ref, created_by, created_at FROM closes WHERE period='2026-11'`).run(), /UNIQUE/));
    ok('oficial sin autorización → authorization_required', code(() => C.closeMonth({ month: '2026-10', mode: 'official', periodInputId: inNov.id, ...live([]) }, { actor: 'ADM', now: LATER }), 'authorization_required'));
    ok('oficial sin autorización también rechazado por CHECK en SQL', sqlFails(() => db.prepare(`INSERT INTO closes SELECT 'x2', '2030-01', 'official', rule_set_id, period_input_id, preview_digest, settlement_digest, snapshot, snapshot_sha256, NULL, created_by, created_at FROM closes WHERE period='2026-11'`).run(), /CHECK/));
    ok('INS de otro periodo → period_input_mismatch', code(() => C.closeMonth({ month: '2026-10', mode: 'technical', periodInputId: inNov.id, ...live([]) }, { actor: 'ADM', now: LATER }), 'period_input_mismatch'));

    section('[6] reproducción determinista y cambios posteriores');
    ok('recalcular con las mismas entradas → mismo hash', C.verifyCloseReproduction('2026-11', live(NOV_ROWS)).reproduced);
    const frozenB1 = JSON.stringify(s.settlement.works.find((w) => w.contentId === 'B1'));
    const ledgerBefore = JSON.stringify(C.closeLedger('2026-11'));
    rights('B1', { alpha: 0.5, validFrom: '2026-11-01', effectiveAt: '2026-12-10T05:00:00.000Z', shares: [{ publisherId: AUT.id, shareBp: 10000 }] });
    P.updatePublisher(AUT.id, { status: 'inactive' });
    const after = C.getClose('2026-11');
    ok('derechos y titular cambiados después: el cierre no cambia', after.snapshotSha256 === nov.snapshotSha256 && after.integrityOk
        && JSON.stringify(after.snapshot.settlement.works.find((w) => w.contentId === 'B1')) === frozenB1 && after.snapshot.publishers.find((p) => p.id === AUT.id).status === 'active');
    ok('…ni sus saldos', JSON.stringify(C.closeLedger('2026-11')) === ledgerBefore);
    ok('recalcular con los datos actuales daría otro hash (el cierre no se recalcula)', C.verifyCloseReproduction('2026-11', live(NOV_ROWS)).reproduced === false);
    P.updatePublisher(AUT.id, { status: 'active' });

    section('[7] mes sin ingresos y periodo sin lecturas');
    const inOct = C.recordPeriodInput({ period: '2026-10', grossCop: 600_000, deductionsCop: 0, supportRef: 'SOPORTE-FX-2026-10' }, { actor: 'ADM' });
    const oct = C.closeMonth({ month: '2026-10', mode: 'technical', periodInputId: inOct.id, ...live([]) }, { actor: 'ADM', now: LATER });
    const so = oct.snapshot.settlement;
    ok('octubre sin lecturas: Σ S = 0, la BLC pasa a la BGP y se reparte por presencia', so.pools.blcToBgp && so.pools.bgpEffective === 150_000 && so.destinations.payable + so.destinations.retained === 150_000);
    ok('…conciliado', C.closeLedger('2026-10').reconciliation.ok);

    section('[8] retenidos y pendientes no cobrables');
    const L = C.closeLedger('2026-11');
    const st = s.settlement;
    ok('D1 provisional identificada y aplicada (B1 con dos versiones → 2 partes por Q)', s.policies.D1.id === 'D1-PROV-2026-10-v1' && s.policies.D1.status === 'provisional'
        && st.inputs.policies.versionSplit === 'proportional_q' && st.works.find((w) => w.contentId === 'B1').parts.length === 2);
    ok('D2 y D3 según U3-02', s.policies.D2.presenceHolders === 'rights_version_shares' && s.policies.D3.rule === 'retain_not_exclude');
    const b3 = st.works.find((w) => w.contentId === 'B3');
    ok('B3 en disputa: su MontoObra retenido (sin titular), no cobrable', b3.retained === b3.montoObra && b3.montoObra > 0 && L.totals.unattributedRetained >= b3.montoObra);
    ok('D4 complemento de alfa pendiente, fuera de lo cobrable', L.totals.pending.alphaComplement === st.destinations.alphaComplement && L.totals.pending.alphaComplement > 0);
    ok('cobrable = Σ totales de titulares; BRD = cobrable + retenido + pendiente', L.totals.payable === st.destinations.payable && L.reconciliation.ok
        && L.totals.payable + L.totals.retained + L.totals.pendingTotal === 500_000);

    section('[9] movimientos');
    const ed0 = L.holders.find((h) => h.publisherId === ED.id).payable;
    const pay = C.addMovement({ period: '2026-11', kind: 'payment_recorded', publisherId: ED.id, amountCop: 100_000, reason: 'Pago registrado (no ejecutado)', ref: 'COMPROBANTE-FX' }, { actor: 'ADM', now: '2026-12-10T00:00:00.000Z' });
    const L2 = C.closeLedger('2026-11');
    ok('pago registrado: baja el cobrable y sube lo pagado', pay.kind === 'payment_recorded' && L2.holders.find((h) => h.publisherId === ED.id).payable === ed0 - 100_000 && L2.totals.paid === 100_000 && L2.reconciliation.ok);
    ok('pago mayor que el saldo → insufficient_balance', code(() => C.addMovement({ period: '2026-11', kind: 'payment_recorded', publisherId: ED.id, amountCop: 10_000_000, reason: 'x' }, { actor: 'ADM' }), 'insufficient_balance'));
    C.addMovement({ period: '2026-11', kind: 'retention', publisherId: AUT.id, amountCop: 5_000, reason: 'Reclamo documental' }, { actor: 'ADM', now: '2026-12-10T00:00:01.000Z' });
    C.addMovement({ period: '2026-11', kind: 'release', source: 'holder_retained', publisherId: AUT.id, amountCop: 5_000, reason: 'Reclamo resuelto' }, { actor: 'ADM', now: '2026-12-10T00:00:02.000Z' });
    ok('retención y liberación del titular: saldo igual, conciliado', C.closeLedger('2026-11').holders.find((h) => h.publisherId === AUT.id).payable === L.holders.find((h) => h.publisherId === AUT.id).payable && C.closeLedger('2026-11').reconciliation.ok);
    ok('liberar lo retenido sin titular más de lo que hay → error', code(() => C.addMovement({ period: '2026-11', kind: 'release', source: 'unattributed_retained', publisherId: ED.id, amountCop: L.totals.unattributedRetained + 1, reason: 'x' }, { actor: 'ADM' }), 'insufficient_balance'));
    C.addMovement({ period: '2026-11', kind: 'release', source: 'unattributed_retained', publisherId: ED.id, amountCop: 1_000, reason: 'Disputa B3 resuelta en parte', ref: 'RESOLUCION-FX' }, { actor: 'ADM', now: '2026-12-10T00:00:03.000Z' });
    ok('asignar un pendiente D4 por encima de lo pendiente → error', code(() => C.addMovement({ period: '2026-11', kind: 'adjustment', source: 'pending_alpha_complement', publisherId: ED.id, amountCop: L.totals.pending.alphaComplement + 1, reason: 'x' }, { actor: 'ADM' }), 'insufficient_balance'));
    ok('origen no válido para el tipo → invalid_source', code(() => C.addMovement({ period: '2026-11', kind: 'payment_recorded', source: 'pending_alpha_complement', publisherId: ED.id, amountCop: 1, reason: 'x' }, { actor: 'ADM' }), 'invalid_source'));
    ok('ajuste que deja el cobrable negativo → error', code(() => C.addMovement({ period: '2026-11', kind: 'adjustment', publisherId: AUT.id, amountCop: -10_000_000, reason: 'x' }, { actor: 'ADM' }), 'insufficient_balance'));
    C.addMovement({ period: '2026-11', kind: 'adjustment', publisherId: AUT.id, amountCop: -1_000, reason: 'Corrección documentada', ref: 'NOTA-FX' }, { actor: 'ADM', now: '2026-12-10T00:00:04.000Z' });
    const autPayable = C.closeLedger('2026-11').holders.find((h) => h.publisherId === AUT.id).payable;
    ok('traslado a un periodo anterior → invalid_target_period', code(() => C.addMovement({ period: '2026-11', kind: 'balance_transfer', publisherId: AUT.id, amountCop: 1, targetPeriod: '2026-10', reason: 'x' }, { actor: 'ADM' }), 'invalid_target_period'));
    const tr = C.addMovement({ period: '2026-11', kind: 'balance_transfer', publisherId: AUT.id, amountCop: autPayable, targetPeriod: '2026-12', reason: 'Saldo bajo el umbral (50.000)' }, { actor: 'ADM', now: '2026-12-10T00:00:05.000Z' });
    const L3 = C.closeLedger('2026-11');
    ok('traslado de saldo: el cobrable de noviembre queda en 0 y conciliado', tr.targetPeriod === '2026-12' && L3.holders.find((h) => h.publisherId === AUT.id).payable === 0 && L3.reconciliation.ok);
    ok('UPDATE/DELETE de adjustments fallan', sqlFails(() => db.prepare('UPDATE adjustments SET amount_cop = 1').run(), /append-only/) && sqlFails(() => db.prepare('DELETE FROM adjustments').run(), /append-only/));
    ok('los movimientos no tocan el cierre (mismo hash)', C.getClose('2026-11').snapshotSha256 === nov.snapshotSha256);
    const inDec = C.recordPeriodInput({ period: '2026-12', grossCop: 0, deductionsCop: 0, supportRef: 'SIN-RECAUDO-FX-2026-12' }, { actor: 'ADM' });
    const dec = C.closeMonth({ month: '2026-12', mode: 'technical', periodInputId: inDec.id, ...live([...read('LECTOR-1', 'B2', '2026-12-03T10:00:00')]) }, { actor: 'ADM', now: LATER });
    const LD = C.closeLedger('2026-12');
    ok('mes sin ingresos (INS 0): bolsas en 0 aunque haya lecturas', dec.snapshot.settlement.pools.brd === 0 && dec.snapshot.settlement.destinations.payable === 0);
    ok('…el traslado entra congelado en el snapshot de diciembre', dec.snapshot.carriedIn.length === 1 && dec.snapshot.carriedIn[0].amountCop === autPayable
        && LD.holders.find((h) => h.publisherId === AUT.id).payable === autPayable && LD.reconciliation.ok);
    ok('traslado a un periodo ya cerrado → target_closed', code(() => C.addMovement({ period: '2026-11', kind: 'balance_transfer', publisherId: ED.id, amountCop: 1, targetPeriod: '2026-12', reason: 'x' }, { actor: 'ADM' }), 'target_closed'));

    section('[10] trimestres');
    const q4 = C.quarterSummary('2026-Q4');
    ok('2026-Q4 completo pero técnico → no definitivo', q4.complete && !q4.definitive && q4.status === 'PROVISIONAL_TECHNICAL' && q4.missingMonths.length === 0);
    ok('trimestre = Σ de sus cierres, conciliado al peso', q4.reconciliation.ok && q4.totals.brd === 150_000 + 500_000 + 0
        && q4.totals.payable === sum(['2026-10', '2026-11', '2026-12'].map((p) => C.closeLedger(p).totals.payable)));
    ok('traslado interno del trimestre: sale de nov y entra en dic', q4.totals.transferredOut === autPayable && q4.totals.carriedIn === autPayable);
    ok('pagado y pendientes preservados', q4.totals.paid === 100_000 && q4.totals.pending.alphaComplement === L.totals.pending.alphaComplement);
    P.updatePublisher(ED.id, { tradeName: 'Nombre nuevo' });
    ok('usa los snapshots, no los estados actuales', C.quarterSummary('2026-Q4').holders.find((h) => h.publisherId === ED.id).tradeName === 'Sintética');
    const q3 = C.quarterSummary('2026-Q3');
    ok('trimestre sin cierres: incompleto, meses faltantes listados', !q3.complete && q3.status === 'PROVISIONAL_INCOMPLETE' && q3.missingMonths.join() === '2026-07,2026-08,2026-09');
    for (const [i, mo] of ['2027-01', '2027-02'].entries()) {
        const inp = C.recordPeriodInput({ period: mo, grossCop: 400_000 * (i + 1), deductionsCop: 0, supportRef: `SOPORTE-FX-${mo}` }, { actor: 'ADM' });
        C.closeMonth({ month: mo, mode: 'official', authorizationRef: `AUTORIZACION-FX-${mo}`, periodInputId: inp.id, ...live([]) }, { actor: 'ADM', now: LATER });
    }
    const q1p = C.quarterSummary('2027-Q1');
    ok('2027-Q1 con 2 de 3 cierres oficiales → incompleto, nunca definitivo', !q1p.complete && !q1p.definitive && q1p.missingMonths.join() === '2027-03' && q1p.reconciliation.ok);
    const inMar = C.recordPeriodInput({ period: '2027-03', grossCop: 0, deductionsCop: 0, supportRef: 'SIN-RECAUDO-FX-2027-03' }, { actor: 'ADM' });
    const mar = C.closeMonth({ month: '2027-03', mode: 'official', authorizationRef: 'AUTORIZACION-FX-2027-03', periodInputId: inMar.id, ...live([]) }, { actor: 'ADM', now: LATER });
    const q1 = C.quarterSummary('2027-Q1');
    ok('3 cierres oficiales → trimestre DEFINITIVE', mar.mode === 'official' && mar.authorizationRef === 'AUTORIZACION-FX-2027-03' && q1.definitive && q1.status === 'DEFINITIVE' && q1.reconciliation.ok);
    ok('…y aun así el cierre oficial no autoriza pagos por sí mismo', mar.snapshot.paymentsAuthorized === false && mar.snapshot.status === 'OFFICIAL_CLOSE');
    ok('trimestre inválido → invalid_quarter', code(() => C.quarterSummary('2027-Q5'), 'invalid_quarter'));

    section('[10b] CLOSE-GUARD-01: solo meses terminados (America/Bogota, reloj controlado)');
    const counts = () => ['closes', 'period_inputs', 'rule_sets', 'adjustments'].map((t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n).join(',');
    const inApr = C.recordPeriodInput({ period: '2027-04', grossCop: 100_000, deductionsCop: 0, supportRef: 'SOPORTE-FX-2027-04' }, { actor: 'ADM' });
    const inDec27 = C.recordPeriodInput({ period: '2027-12', grossCop: 0, deductionsCop: 0, supportRef: 'SOPORTE-FX-2027-12' }, { actor: 'ADM' });
    const closeAt = (month, periodInputId, now, extra = {}) => () => C.closeMonth({ month, mode: 'technical', periodInputId, ...live([]), ...extra }, { actor: 'ADM', now });
    const before = counts();
    ok('mes en curso (15/04): cierre técnico rechazado → period_not_ended', code(closeAt('2027-04', inApr.id, '2027-04-15T17:00:00.000Z'), 'period_not_ended'));
    ok('…y el oficial también, aunque traiga autorización', code(closeAt('2027-04', inApr.id, '2027-04-15T17:00:00.000Z', { mode: 'official', authorizationRef: 'AUT-FX' }), 'period_not_ended'));
    let msg = ''; try { closeAt('2027-04', inApr.id, '2027-04-15T17:00:00.000Z')(); } catch (e) { msg = e.message; }
    ok('mensaje explícito con la fecha de apertura del cierre', /2027-04 aún no ha terminado/.test(msg) && /2027-05-01 a las 00:00 \(America\/Bogota\)/.test(msg), msg);
    ok('rechazo sin escrituras (cierres, INS, rule_sets, movimientos)', counts() === before);
    const simOpen = C.closeMonth({ month: '2027-04', mode: 'technical', periodInputId: inApr.id, ...live([]) }, { actor: 'ADM', now: '2027-04-15T17:00:00.000Z', simulate: true });
    ok('simulación del mes abierto permitida (no guarda)', simOpen.simulation === true && counts() === before);
    ok('último instante del mes en Bogotá (30/04 23:59:59.999 = 2027-05-01T04:59:59.999Z) → rechazado', code(closeAt('2027-04', inApr.id, '2027-05-01T04:59:59.999Z'), 'period_not_ended'));
    ok('medianoche UTC del 01/05 (aún 30/04 19:00 en Bogotá) → rechazado', code(closeAt('2027-04', inApr.id, '2027-05-01T00:00:00.000Z'), 'period_not_ended'));
    const apr = closeAt('2027-04', inApr.id, '2027-05-01T05:00:00.000Z')();
    ok('primer instante del mes siguiente en Bogotá (01/05 00:00 = 05:00Z) → cierre técnico permitido', apr && apr.mode === 'technical' && apr.integrityOk);
    ok('ese cierre tiene el mismo hash que su simulación con el mes abierto', apr.snapshotSha256 === simOpen.snapshotSha256);
    ok('cierre duplicado → close_exists', code(closeAt('2027-04', inApr.id, '2027-06-01T00:00:00.000Z'), 'close_exists'));
    ok('cambio de año: 2027-12 el 31/12 23:59:59.999 de Bogotá → rechazado', code(closeAt('2027-12', inDec27.id, '2028-01-01T04:59:59.999Z'), 'period_not_ended'));
    ok('cambio de año: año nuevo UTC (31/12 19:00 en Bogotá) → rechazado', code(closeAt('2027-12', inDec27.id, '2028-01-01T00:00:00.000Z'), 'period_not_ended'));
    ok('cambio de año: 01/01/2028 00:00 en Bogotá → permitido', C.closeMonth({ month: '2027-12', mode: 'technical', periodInputId: inDec27.id, ...live([]) }, { actor: 'ADM', now: '2028-01-01T05:00:00.000Z' }).period === '2027-12');
    ok('assertPeriodEnded: reloj inválido → invalid_clock', code(() => C.assertPeriodEnded('2027-04', 'no-es-fecha'), 'invalid_clock'));
    ok('cierres históricos intactos (íntegros y con el mismo hash)', C.getClose('2026-11').snapshotSha256 === nov.snapshotSha256 && ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].every((p) => C.getClose(p).integrityOk));

    section('[11] manipulación detectada');
    const copy = path.join(tmp, 'tampered.db');
    await db.backup(copy);
    const t = new Database(copy);
    t.exec('DROP TRIGGER closes_no_update');
    t.prepare("UPDATE closes SET snapshot = replace(snapshot, '\"insCop\":2000000', '\"insCop\":9000000') WHERE period = '2026-11'").run();
    const tc = C.getClose('2026-11', t);
    ok('snapshot alterado fuera de la aplicación → integrityOk = false', tc.integrityOk === false && tc.snapshot.periodInput.insCop === 9_000_000);
    ok('…y no admite movimientos', code(() => C.addMovement({ period: '2026-11', kind: 'payment_recorded', publisherId: ED.id, amountCop: 1, reason: 'x' }, { actor: 'ADM', db: t }), 'close_integrity_failed'));
    ok('…y el trimestre deja de conciliar', C.quarterSummary('2026-Q4', t).reconciliation.ok === false);
    t.close();

    section('[12] respaldo y restauración aislada con la 0004');
    const bak = path.join(tmp, 'backup.db');
    await db.backup(bak);
    const restored = new Database(bak, { readonly: true });
    const dump = (d) => ['rule_sets', 'period_inputs', 'closes', 'adjustments', 'rights_versions', 'publishers', '_migrations']
        .map((tb) => JSON.stringify(d.prepare(`SELECT * FROM ${tb} ORDER BY 1`).all())).join('\n');
    ok('integrity_check ok en la copia restaurada', restored.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
    ok('mismas filas en las 4 tablas nuevas y en las anteriores', dump(restored) === dump(db));
    ok('mismos triggers append-only', JSON.stringify(restored.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()) === JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()));
    ok('cierres íntegros y trimestre idéntico tras restaurar', ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].every((p) => C.getClose(p, restored).integrityOk)
        && JSON.stringify(C.quarterSummary('2026-Q4', restored)) === JSON.stringify(C.quarterSummary('2026-Q4')));
    restored.close();
} catch (e) {
    console.error(e);
    fail++;
} finally {
    P.closeRoyaltiesDb();
    fs.rmSync(tmp, { recursive: true, force: true });
}

const realAfter = fs.existsSync(REAL_DB) ? fs.statSync(REAL_DB).mtimeMs : null;
ok('data-critical/royalties.db intacta', realAfter === realBefore);
console.log(`\ncloses — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
