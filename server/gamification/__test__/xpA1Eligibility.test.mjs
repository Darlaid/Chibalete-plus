/**
 * xpA1Eligibility.test.mjs — CHP-V8.1-CLOSE-06A (G-01).
 *
 * Ningún XP sin A1 concedida, verificada y vigente. Puerta A1 REAL
 * (`CHP_TEST_A1=real`), store MOOK real, barrido real y datos sintéticos:
 *  [1] titular adulto (A1 en la plataforma): 30 → 50 → 50 (techo)
 *  [2] representación: pendiente de verificar ⇒ 0; verificada ⇒ XP
 *  [3] A1 No / pendiente / sin decisión / solo A2 ⇒ 0
 *  [4] revocada ⇒ ningún XP nuevo; el histórico y la consulta propia se conservan
 *  [5] reintentos y dos réplicas a la vez ⇒ un solo asiento
 *  [6] rectificación y reconciliación con A1
 *  [7] sin retroactividad: aprobación anterior al acto de A1 ⇒ 0
 *  [8] registro no verificable ⇒ 0; recuperado ⇒ XP; `recordFact` pasa por la misma puerta
 *  [9] XP apagado ⇒ nada
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/xpA1Eligibility.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CHP_TEST_A1 = 'real';
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_a1_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const P = { gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl'), a2: path.join(tmp, 'a2', 'decisions.jsonl'),
    doc: path.join(tmp, 'mook.json'), users: path.join(tmp, 'users.json') };
P.db = path.join(P.gamDir, 'gamification.db');
for (const d of [P.gamDir, path.dirname(P.reg), path.dirname(P.a2)]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(P.reg, ''); fs.writeFileSync(P.a2, '');
Object.assign(process.env, { GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg, CHP_A2_REGISTRY: P.a2 });

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const G = await import('../progress.mjs');
const RX = await import('../rectification.mjs');
const R = await import('../../privacy/a2Registry.mjs');
(await import('../../royalties/publishersStore.mjs')).getRoyaltiesDb();

const DAY = 86_400_000;
const SINCE = Date.now() - 10 * DAY;
const TODAY = R.dayOf(Date.now());
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg,
    GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString(), CHP_A2_REGISTRY: P.a2 };
const IDS = ['ad', 'mv', 'mp', 'nn', 'pe', 'a2only', 'rv', 'late', 'con', 'down'];
const USERS = [...IDS.map((id) => ({ id, roles: ['lector'], accountStatus: 'active' })), { id: 'med', roles: ['mediador'], accountStatus: 'active' }, { id: 'adm-op', roles: ['administrador'], accountStatus: 'active' }];
fs.writeFileSync(P.users, JSON.stringify(USERS));

const doc = Store.emptyMookStore();
const mkExp = (slug, work) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: work },
        { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: work, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const A = [mkExp('a1', 'obra-a'), mkExp('a2', 'obra-a'), mkExp('a3', 'obra-a')];
const B = mkExp('b1', 'obra-b'), C = mkExp('c1', 'obra-c');
const deliver = (u, exp) => {
    const run = Store.startRun(doc, { userId: u, experienceId: exp.id }).run;
    Store.completeNode(doc, run.id, 'r');
    const work = Store.versionNodes(doc.versions.find((v) => v.id === run.experienceVersionId)).find((n) => n.id === 'p').resourceRef;
    const ev = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: u, payload: { text: 'una dos tres cuatro' },
        workAccess: { workRef: work, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() } }).evidence;
    Store.reviewEvidence(doc, ev.id, { reviewerId: 'med', decision: 'aprobado' });
    return ev;
};
const writer = D.getGamificationDb({ env: ENV });
L.createRuleSet(writer, { ruleVersion: 'gm-a1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000, rules: { schema: 1, facts: {}, recognition: PILOT } });
const sweep = (env = ENV) => M.recognizeMookWorks(writer, doc, { workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: SINCE, env,
    resolveUser: M.makeResolveUser(USERS, () => true, () => false) });
const xp = (u) => L.getXp(writer, u);
const awards = () => writer.prepare("SELECT COUNT(*) n FROM gm_xp_entries WHERE kind = 'award'").get().n;
const dec = (subjectId, kind, status, over = {}) => R.appendDecisions([{ subjectId, kind, status, actDay: '2026-01-15', version: '004@1.0', medium: 'paper',
    capacity: 'legal_representative', verification: 'verified', requestRef: `AUT-SINT-${subjectId}-${kind}`, ...over }]);

try {
    section('[1] titular adulto, A1 en la plataforma');
    dec('ad', 'A1', 'granted', { actDay: TODAY, medium: 'in_app', capacity: 'titular', verification: 'self_authenticated', requestRef: 'ACT-sint-ad' });
    const steps = [];
    for (const e of A) { deliver('ad', e); sweep(); sweep(); steps.push(xp('ad')); }
    ok('30 → 50 → 50: primera aprobación 30, segunda +20, techo 50', steps.join() === '30,50,50', steps.join());

    section('[2] representación del menor');
    dec('mv', 'A1', 'granted', { medium: 'in_app', verification: 'unverified', actDay: TODAY, requestRef: 'ACT-sint-mv' });
    deliver('mv', A[0]); const r2 = sweep();
    ok('A1 declarada por el representante sin verificar ⇒ 0 XP', xp('mv') === 0 && (r2.notRecorded.a1_not_effective ?? 0) >= 1, JSON.stringify(r2.notRecorded));
    dec('mv', 'A1', 'granted');
    sweep();
    ok('verificada por GVA/VER ⇒ 30 XP en el barrido siguiente', xp('mv') === 30, String(xp('mv')));

    section('[3] A1 insuficiente');
    dec('mp', 'A1', 'granted', { medium: 'in_app', verification: 'unverified', actDay: TODAY, requestRef: 'ACT-sint-mp' });
    dec('nn', 'A1', 'denied');
    dec('a2only', 'A2', 'granted');
    for (const u of ['mp', 'nn', 'pe', 'a2only']) deliver(u, A[0]);
    sweep(); sweep();
    ok('pendiente de verificar ⇒ 0', xp('mp') === 0);
    ok('A1 = No ⇒ 0', xp('nn') === 0);
    ok('sin decisión (cuenta activa) ⇒ 0: A1 no se infiere', xp('pe') === 0);
    ok('A2 = Sí no sustituye a A1 ⇒ 0', xp('a2only') === 0);
    ok('…y ninguna de ellas dejó fila: el hecho sigue libre', !L.hasFact(writer, { source: 'mook_review', sourceEventId: 'x', factType: 'evidence_reviewed', userId: 'pe' })
        && writer.prepare('SELECT COUNT(*) n FROM gm_subjects WHERE user_id IN (?, ?, ?, ?)').get('mp', 'nn', 'pe', 'a2only').n === 0);

    section('[4] revocación');
    dec('rv', 'A1', 'granted');
    deliver('rv', A[0]); sweep();
    ok('con A1: 30', xp('rv') === 30);
    dec('rv', 'A1', 'revoked');
    deliver('rv', A[1]); sweep(); sweep();
    ok('revocada ⇒ ningún XP nuevo (sigue en 30)', xp('rv') === 30, String(xp('rv')));
    ok('el XP histórico no se borra ni se anula', writer.prepare("SELECT COUNT(*) n FROM gm_xp_entries WHERE kind = 'void'").get().n === 0);
    const own = G.readProgress(writer, 'rv', { env: ENV });
    ok('la consulta propia sigue funcionando (30 XP)', own.xp === 30);

    section('[5] reintentos y dos réplicas');
    dec('con', 'A1', 'granted');
    deliver('con', B);
    fs.writeFileSync(P.doc, JSON.stringify(doc));
    writer.pragma('wal_checkpoint(TRUNCATE)');
    const before = awards();
    const barrier = path.join(tmp, 'go');
    const one = () => new Promise((resolve) => {
        const c = spawn(process.execPath, [path.join(HERE, 'a1SweepWorker.mjs'), barrier, P.doc, P.users, String(SINCE)], { env: { ...process.env, ...ENV, CHP_TEST_A1: 'real' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
        c.on('exit', () => resolve(out.trim().split('\n').at(-1)));
    });
    const runs = [one(), one()];
    await new Promise((r) => setTimeout(r, 2500));
    fs.writeFileSync(barrier, '');
    const outs = (await Promise.all(runs)).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    ok('dos réplicas a la vez: una registra, la otra lo ve', outs.reduce((s, o) => s + (o.recognized ?? 0), 0) === 1, JSON.stringify(outs));
    ok('un solo asiento nuevo y 30 XP', awards() === before + 1 && xp('con') === 30, `${awards() - before} ${xp('con')}`);
    sweep(); sweep();
    ok('reintentos del barrido: ningún asiento más', awards() === before + 1);

    section('[6] rectificación y reconciliación');
    const evAd = doc.evidence.filter((e) => e.userId === 'ad')[1];
    RX.voidRecognition(writer, { userId: 'ad', evidenceId: evAd.id, reason: 'recognition_error', requestRef: 'SOL-SINT-A1', actorId: 'adm-op' });
    sweep(); sweep();
    ok('anulación con A1 vigente: 50 → 30 y el barrido no la restaura', xp('ad') === 30, String(xp('ad')));

    section('[7] sin retroactividad');
    dec('late', 'A1', 'granted', { actDay: TODAY });
    const lateEv = { evidenceId: 'ev-late-1', userId: 'late', actorId: 'med', at: Date.now() - 3 * DAY, workRef: 'obra-c', decision: 'aprobado' };
    const rl = L.recordWorkRecognition(writer, lateEv, { env: ENV });
    ok('aprobación anterior al acto de A1 ⇒ a1_not_effective, sin fila', rl.reason === 'a1_not_effective' && !rl.inserted, JSON.stringify(rl));
    const rl2 = L.recordWorkRecognition(writer, { ...lateEv, evidenceId: 'ev-late-2', at: Date.now() }, { env: ENV });
    ok('aprobación posterior ⇒ XP', rl2.inserted && rl2.xp === 30, JSON.stringify(rl2));

    section('[8] registro no verificable y punto común');
    dec('down', 'A1', 'granted');
    deliver('down', C);
    const raw = fs.readFileSync(P.a2, 'utf8');
    fs.writeFileSync(P.a2, raw.replace('"a":"denied"', '"a":"granted"'));
    const rd = sweep();
    ok('registro alterado ⇒ 0 XP para todos (fallo cerrado)', xp('down') === 0 && (rd.notRecorded.a1_not_effective ?? 0) >= 1, JSON.stringify(rd.notRecorded));
    fs.writeFileSync(P.a2, raw);
    sweep();
    ok('registro recuperado ⇒ XP', xp('down') === 30);
    // Regla de prueba con misión (prospectiva): distingue la puerta A1 de una regla ausente.
    const t0 = Date.now();
    L.createRuleSet(writer, { ruleVersion: 'gm-a1-mission', createdBy: 'migration', now: t0, effectiveFrom: t0,
        rules: { schema: 1, facts: { 'mission/mission_completed': { xp: 3 } }, recognition: PILOT } });
    const f = (userId) => L.recordFact(writer, { source: 'mission', sourceEventId: `m-${userId}`, factType: 'mission_completed', userId, actorId: 'med', occurredAt: t0 + 1, eligibility: 'eligible', now: t0 + 2 }, { env: ENV });
    const before8 = awards();
    const fp = f('pe');
    ok('recordFact pasa por la misma puerta: sin A1 ⇒ rejected_not_eligible, sin fila', fp.decision === 'rejected_not_eligible' && !fp.persisted && awards() === before8, JSON.stringify(fp));
    const fa = f('ad');
    ok('…con A1 la misma misión emite (+3 XP)', fa.inserted && fa.xp === 3 && xp('ad') === 33, JSON.stringify(fa) + ' xp=' + xp('ad'));

    section('[9] XP apagado');
    const off = { ...ENV, XP_EARNING_ENABLED: '' };
    const n0 = awards();
    deliver('ad', B);
    ok('XP apagado: el barrido no hace nada', sweep(off).skipped === 'disabled' && awards() === n0);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nXP A1 eligibility (V8.1-CLOSE-06A G-01): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
