/**
 * rightsLifecycle.test.mjs — CHP-V8.1-CLOSE-07B (G-05, G-06, G-08).
 *
 * Con datos sintéticos, store MOOK real, barrido real y puerta A1 REAL:
 *  [1] G-05 supresión: desvincula, deja la constancia contra reactivaciones y retira A1/A2;
 *      sin base de gamificación, solo la constancia; entradas inválidas
 *  [2] G-05 tras restaurar el padrón: lista exactamente las cuentas que no pueden volver
 *  [3] G-06 exclusión ≠ revocación ≠ nueva vinculación
 *  [4] G-08 qué queda tras desvincular: ningún id en la base; vínculo por fecha posible
 *      cuando la fuente MOOK identificada sigue existiendo ⇒ seudonimización, no anonimización
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/rightsLifecycle.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CHP_TEST_A1 = 'real';
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rights_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const P = { gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl'), a2: path.join(tmp, 'a2', 'decisions.jsonl') };
P.db = path.join(P.gamDir, 'gamification.db');
for (const d of [P.gamDir, path.dirname(P.reg), path.dirname(P.a2)]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(P.reg, ''); fs.writeFileSync(P.a2, '');
Object.assign(process.env, { GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg, CHP_A2_REGISTRY: P.a2 });

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const X = await import('../exclusions.mjs');
const R = await import('../../privacy/a2Registry.mjs');
const SUP = await import('../../privacy/suppression.mjs');
(await import('../../royalties/publishersStore.mjs')).getRoyaltiesDb();

const DAY = 86_400_000;
const SINCE = Date.now() - 10 * DAY;
const TODAY = R.dayOf(Date.now());
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg,
    GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString(), CHP_A2_REGISTRY: P.a2 };
const IDS = ['sup-1', 'keep-1', 'rev-1', 'new-1', 'crowd-1', 'crowd-2', 'crowd-3'];
const USERS = [...IDS.map((id) => ({ id, roles: ['lector'], accountStatus: 'active' })), { id: 'med', roles: ['mediador'], accountStatus: 'active' }];

const doc = Store.emptyMookStore();
const mkExp = (slug, work) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: work },
        { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: work, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const EA = mkExp('a', 'obra-a'), EB = mkExp('b', 'obra-b');
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
L.createRuleSet(writer, { ruleVersion: 'gm-rights', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000, rules: { schema: 1, facts: {}, recognition: PILOT } });
const sweep = () => M.recognizeMookWorks(writer, doc, { workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: SINCE, env: ENV,
    resolveUser: M.makeResolveUser(USERS, () => true, () => false) });
const xp = (u) => L.getXp(writer, u);
let refN = 0; // referencias opacas: nunca el id
const a1 = (id, status = 'granted', actDay = '2026-01-10') => R.appendDecisions([{ subjectId: id, kind: 'A1', status, actDay, version: '004@1.0', medium: 'paper',
    capacity: 'legal_representative', verification: 'verified', requestRef: `AUT-SINT-${++refN}` }]);
const textCells = () => {
    const out = [];
    for (const { name } of writer.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
        for (const row of writer.prepare(`SELECT * FROM "${name}"`).all()) for (const v of Object.values(row)) if (typeof v === 'string') out.push(v);
    }
    return out;
};

try {
    for (const id of ['sup-1', 'keep-1', 'rev-1']) a1(id);
    R.appendDecisions([{ subjectId: 'sup-1', kind: 'A2', status: 'granted', actDay: '2026-01-10', version: '004@1.0', medium: 'paper', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-A2-0' }]);
    for (const id of ['sup-1', 'keep-1', 'rev-1']) deliver(id, EA);
    sweep();

    section('[1] G-05 supresión');
    ok('antes: cada lector con 30 XP y su sujeto', ['sup-1', 'keep-1', 'rev-1'].every((u) => xp(u) === 30));
    ok('referencia con texto libre ⇒ INVALID_REQUEST_REF', codeOf(() => SUP.suppressAccount(writer, { userId: 'sup-1', requestRef: 'Ana 5B', requestDay: TODAY, capacity: 'legal_representative' }, { env: ENV })) === 'INVALID_REQUEST_REF');
    ok('sin fecha del trámite ⇒ INVALID_ACT_DATE (no se fabrica)', codeOf(() => SUP.suppressAccount(writer, { userId: 'sup-1', requestRef: 'SOL-1', capacity: 'legal_representative' }, { env: ENV })) === 'INVALID_ACT_DATE');
    ok('calidad no admitida ⇒ INVALID_CAPACITY', codeOf(() => SUP.suppressAccount(writer, { userId: 'sup-1', requestRef: 'SOL-1', requestDay: TODAY, capacity: 'institution' }, { env: ENV })) === 'INVALID_CAPACITY');
    const ack = SUP.suppressAccount(writer, { userId: 'sup-1', requestRef: 'SOL-SINT-0001', requestDay: TODAY, capacity: 'legal_representative' }, { env: ENV });
    ok('acuse: constancia, desvinculado, A1 y A2 retiradas, sin ids', ack.tombstoned && ack.unlinked && ack.decisionsRevoked.join() === 'A1,A2' && !JSON.stringify(ack).includes('sup-1'), JSON.stringify(ack));
    ok('el sujeto ya no existe y su XP no es atribuible', writer.prepare('SELECT COUNT(*) n FROM gm_subjects WHERE user_id = ?').get('sup-1').n === 0 && xp('sup-1') === 0);
    ok('constancia en el registro de exclusiones (independiente de respaldos)', X.readRegistry(ENV).has(X.tombstoneOf('sup-1')));
    ok('A1 y A2 revocadas en el registro de decisiones', R.decisionGate().status('A1', 'sup-1') === 'revoked' && R.decisionGate().status('A2', 'sup-1') === 'revoked');
    ok('los demás no cambian', xp('keep-1') === 30 && xp('rev-1') === 30 && R.decisionGate().effective('A1', 'keep-1'));
    const again = SUP.suppressAccount(writer, { userId: 'sup-1', requestRef: 'SOL-SINT-0001', requestDay: TODAY, capacity: 'legal_representative' }, { env: ENV });
    ok('repetir es idempotente: una sola constancia', again.tombstoned && fs.readFileSync(P.reg, 'utf8').trim().split('\n').length === 1);
    const noDb = SUP.suppressAccount(null, { userId: 'nogam-1', requestRef: 'SOL-SINT-0002', requestDay: TODAY, capacity: 'titular', mediator: true }, { env: ENV });
    ok('sin base de gamificación: solo constancia y retiros (también C005 del mediador)', noDb.tombstoned && !noDb.unlinked && noDb.decisionsRevoked.join() === 'A1,A2,C005'
        && X.readRegistry(ENV).has(X.tombstoneOf('nogam-1')));
    ok('…la base existente exige reaplicar antes de ingerir (fallo cerrado)', codeOf(() => X.exclusionGate(writer, ENV)) === 'EXCLUSION_REPLAY_REQUIRED');
    const E = await import('../erasure.mjs');
    E.replayExclusions(writer, { env: ENV });
    ok('…reaplicada (runbook PRIV-C7), la puerta vuelve a abrir', codeOf(() => X.exclusionGate(writer, ENV)) === null);

    section('[2] G-05 tras restaurar el padrón');
    a1('rev-1', 'revoked', TODAY);
    const restored = [...IDS, 'nogam-1', 'off-1'].map((id) => ({ id, accountStatus: id === 'off-1' ? 'disabled' : 'active' }));
    const restrict = SUP.accountsToRestrictAfterRestore(restored, { env: ENV });
    ok('lista exactamente las suprimidas y la de A1 revocada', restrict.sort().join() === ['nogam-1', 'rev-1', 'sup-1'].sort().join(), restrict.join());
    ok('no lista cuentas vigentes ni las ya desactivadas', !restrict.includes('keep-1') && !restrict.includes('off-1'));
    const raw = fs.readFileSync(P.reg, 'utf8');
    fs.writeFileSync(P.reg, raw.replace('"t":"', '"t":"x'));
    ok('registro de exclusiones alterado ⇒ error, nunca una lista vacía', codeOf(() => SUP.accountsToRestrictAfterRestore(restored, { env: ENV })) === 'EXCLUSION_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(P.reg, raw);

    section('[3] G-06 exclusión ≠ revocación ≠ nueva vinculación');
    a1('sup-1', 'granted', TODAY);
    deliver('sup-1', EB); sweep();
    ok('excluida: aunque vuelva a constar A1, ningún XP (exclusión irreversible)', xp('sup-1') === 0 && writer.prepare('SELECT COUNT(*) n FROM gm_subjects WHERE user_id = ?').get('sup-1').n === 0);
    const revoked = L.recordWorkRecognition(writer, { evidenceId: 'ev-rev-1', userId: 'rev-1', actorId: 'med', at: Date.now(), workRef: 'obra-b', decision: 'aprobado' }, { env: ENV });
    ok('revocada: ningún XP nuevo (a1_not_effective), conserva el histórico', revoked.reason === 'a1_not_effective' && xp('rev-1') === 30);
    a1('rev-1', 'granted', TODAY);
    const before = L.recordWorkRecognition(writer, { evidenceId: 'ev-rev-2', userId: 'rev-1', actorId: 'med', at: Date.now() - DAY, workRef: 'obra-b', decision: 'aprobado' }, { env: ENV });
    ok('nueva autorización: una aprobación del periodo anterior no suma (prospectiva, por día)', before.reason === 'a1_not_effective');
    deliver('rev-1', mkExp('c', 'obra-c')); sweep();
    ok('…y sí suma hacia delante', xp('rev-1') === 60, String(xp('rev-1')));
    a1('new-1', 'granted', TODAY);
    deliver('new-1', EA); sweep();
    ok('nueva vinculación legítima (cuenta nueva con su 004): suma XP', xp('new-1') === 30);

    section('[4] G-08 qué queda tras desvincular');
    ok('ningún texto de la base contiene el id de la persona suprimida', !textCells().some((v) => v.includes('sup-1')));
    const facts = writer.prepare('SELECT occurred_at, COUNT(*) n FROM gm_source_facts GROUP BY occurred_at').all();
    ok('el ledger conserva hechos y XP sin dueño (claves aleatorias, sin sal)', writer.prepare('SELECT COUNT(*) n FROM gm_xp_entries WHERE subject_ref NOT IN (SELECT subject_ref FROM gm_subjects)').get().n >= 1);
    // Vínculo por combinación: la fuente MOOK identificada (userId + fecha de revisión) sigue existiendo.
    const supEvidenceDays = new Set(doc.evidence.filter((e) => e.userId === 'sup-1').map((e) => Date.parse(e.review?.reviewedAt ?? e.submittedAt ?? 0)).filter(Number.isFinite).map((t) => Math.floor((t - 5 * 3_600_000) / DAY)));
    ok('la fuente MOOK conserva userId y fecha de la entrega suprimida (D4)', doc.evidence.some((e) => e.userId === 'sup-1'));
    ok('con un solo evento ese día el vínculo por fecha sería posible ⇒ hoy es seudonimización', supEvidenceDays.size >= 1 && facts.some((f) => f.n >= 1));
    for (const u of ['crowd-1', 'crowd-2', 'crowd-3']) { a1(u, 'granted', '2026-01-10'); deliver(u, EA); }
    sweep();
    const sameDay = writer.prepare('SELECT COUNT(*) n FROM gm_source_facts WHERE occurred_at = (SELECT MAX(occurred_at) FROM gm_source_facts)').get().n;
    ok('con varios eventos el mismo día, el hecho ya no es atribuible por fecha', sameDay >= 3, String(sameDay));
    ok('las constancias de los registros son seudónimos con clave (HMAC), no anónimas', X.tombstoneOf('sup-1') === X.tombstoneOf('sup-1') && !fs.readFileSync(P.a2, 'utf8').includes('sup-1'));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nrights lifecycle (V8.1-CLOSE-07B G-05/G-06/G-08): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
