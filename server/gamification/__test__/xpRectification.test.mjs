/**
 * xpRectification.test.mjs — CHP-V8.1-CLOSE-01 (G-03).
 *
 * Anulación de un reconocimiento XP erróneo, con store MOOK real, el escritor real
 * (barrido) y datos sintéticos:
 *  [1] 30/20/50 intactos antes de corregir
 *  [2] anulación: XP efectivo, nivel, obras y vista del mediador recalculados
 *  [3] idempotencia: segunda llamada sin efecto
 *  [4] historial íntegro y auditoría con motivo y referencia, sin ids
 *  [5] la reconciliación no restaura lo anulado; el techo no se libera
 *  [6] entradas inválidas, persona excluida, sin clave, registro dañado
 *  [7] XP apagado: la corrección funciona y nada se emite
 *  [8] dos réplicas a la vez sobre la misma evidencia ⇒ una sola anulación
 *  [9] invariantes de O8 (mismas consultas)
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/xpRectification.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_rectify_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const P = { gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl') };
P.db = path.join(P.gamDir, 'gamification.db');
for (const d of [P.gamDir, path.dirname(P.reg)]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(P.reg, '');
Object.assign(process.env, { GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg });

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
const G = await import('../progress.mjs');
const RX = await import('../rectification.mjs');
const SK = await import('../subjectKey.mjs');
(await import('../../royalties/publishersStore.mjs')).getRoyaltiesDb();

const SINCE = Date.now() - 60_000;
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg,
    GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
const USERS = ['a1', 'a2', 'a3', 'c1'].map((id) => ({ id, roles: ['lector'], accountStatus: 'active' }))
    .concat([{ id: 'med', roles: ['mediador'], accountStatus: 'active' }, { id: 'adm-op', roles: ['administrador'], accountStatus: 'active' }]);

const doc = Store.emptyMookStore();
const mkExp = (slug, work) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: work },
        { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: work, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const EXPS = [mkExp('e1', 'obra-a'), mkExp('e2', 'obra-a'), mkExp('e3', 'obra-a'), mkExp('e4', 'obra-b')];
const deliver = (u, exp) => {
    const run = Store.startRun(doc, { userId: u, experienceId: exp.id }).run;
    Store.completeNode(doc, run.id, 'r');
    const work = Store.versionNodes(doc.versions.find((v) => v.id === run.experienceVersionId)).find((n) => n.id === 'p').resourceRef;
    const ev = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: u, payload: { text: 'una dos tres cuatro' },
        workAccess: { workRef: work, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() } }).evidence;
    Store.reviewEvidence(doc, ev.id, { reviewerId: 'med', decision: 'aprobado' });
    return ev;
};

let writer = D.getGamificationDb({ env: ENV });
L.createRuleSet(writer, { ruleVersion: 'gm-rectify', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
    rules: { schema: 1, facts: {}, recognition: PILOT } });
const sweep = (env = ENV) => M.recognizeMookWorks(writer, doc, { workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: SINCE, env,
    resolveUser: M.makeResolveUser(USERS, () => true, () => false) });
const xpOf = (u) => L.getXp(writer, u);
const count = (sql, ...a) => writer.prepare(sql).get(...a).n;
const ledgerCounts = () => ({
    facts: count('SELECT COUNT(*) n FROM gm_source_facts'), awards: count("SELECT COUNT(*) n FROM gm_xp_entries WHERE kind = 'award'"),
    voids: count("SELECT COUNT(*) n FROM gm_xp_entries WHERE kind = 'void'"), cycles: count('SELECT COUNT(*) n FROM gm_work_cycles'),
    audit: count('SELECT COUNT(*) n FROM gm_admin_audit'),
});
const req = (over = {}) => ({ userId: 'a1', evidenceId: ev2.id, reason: 'recognition_error', requestRef: 'SOL-SINT-0001', actorId: 'adm-op', ...over });
const student = (u) => G.readStudentRecognition(writer, u, { env: ENV });

let ev1, ev2, ev3;
try {
    section('[1] 30/20/50 antes de corregir');
    ev1 = deliver('a1', EXPS[0]); sweep();
    const x1 = xpOf('a1');
    ev2 = deliver('a1', EXPS[1]); sweep();
    const x2 = xpOf('a1');
    ok('a1: 30 → 50 (lectura 10 + reflexión 20; segunda reflexión 20; techo 50)', x1 === 30 && x2 === 50, `${x1} ${x2}`);
    const before = student('a1');
    ok('vista del mediador: 50 XP y logros previos', before.xp === 50 && before.recognizedWorks === 1, JSON.stringify(before));
    const evB = deliver('a2', EXPS[3]); sweep();
    ok('otra persona: 30 XP', xpOf('a2') === 30);
    const counts0 = ledgerCounts();

    section('[2] anulación de la segunda entrega de a1');
    const ack = RX.voidRecognition(writer, req());
    ok('acuse: anulado, 20 XP afectados', ack.voided === true && ack.alreadyVoided === false && ack.xp === 20, JSON.stringify(ack));
    ok('acuse sin ids ni claves', !/a1|adm|[0-9a-f]{32}|evidence/i.test(JSON.stringify(ack)), JSON.stringify(ack));
    ok('XP efectivo recalculado: 50 → 30', xpOf('a1') === 30, String(xpOf('a1')));
    const after = student('a1');
    ok('vista del mediador recalculada (30 XP, la obra sigue reconocida por la primera entrega)', after.xp === 30 && after.recognizedWorks === 1, JSON.stringify(after));
    ok('«mirada profunda» (dos reflexiones) ya no cuenta', !after.achievements.includes('mirada-profunda') && before.achievements.includes('mirada-profunda'), JSON.stringify(after.achievements));
    const own = G.readProgress(writer, 'a1', { env: ENV });
    ok('«Mi progreso» = vista del mediador', own.xp === 30 && own.level.id === after.level.id, JSON.stringify(own));
    ok('la otra persona no cambia', xpOf('a2') === 30);

    section('[3] idempotencia');
    const again = RX.voidRecognition(writer, req({ requestRef: 'SOL-SINT-0002' }));
    ok('segunda llamada: alreadyVoided, sin efecto', again.voided === false && again.alreadyVoided === true && xpOf('a1') === 30, JSON.stringify(again));
    const c1 = ledgerCounts();
    ok('una sola anulación y una sola fila de auditoría', c1.voids === 1 && c1.audit === counts0.audit + 1, JSON.stringify(c1));

    section('[4] historial íntegro y auditoría');
    ok('hechos, asientos award y actos por obra intactos (nada se borra)', c1.facts === counts0.facts && c1.awards === counts0.awards && c1.cycles === counts0.cycles, JSON.stringify({ counts0, c1 }));
    ok('las tablas siguen siendo append-only', codeOf(() => writer.prepare("DELETE FROM gm_xp_entries WHERE kind = 'void'").run()) !== null
        && codeOf(() => writer.prepare("UPDATE gm_admin_audit SET ref = 'x'").run()) !== null);
    const audit = writer.prepare('SELECT * FROM gm_admin_audit').all();
    ok('auditoría: motivo y referencia verificables', audit.length === 1 && audit[0].action === 'xp_void:recognition_error' && audit[0].ref === 'SOL-SINT-0001', JSON.stringify(audit));
    ok('auditoría sin ids canónicos (solo sujetos pseudónimos)', audit.every((row) => Object.values(row).every((v) => v !== 'a1' && v !== 'adm-op')) && audit[0].actor_ref !== audit[0].target_ref);
    ok('fecha con precisión de día', audit[0].created_at % 1000 === 0 && new Date(audit[0].created_at).getUTCHours() === 5);

    section('[5] la reconciliación no restaura lo anulado');
    for (let i = 0; i < 3; i++) sweep();
    const c2 = ledgerCounts();
    ok('tres barridos: ningún asiento nuevo, XP sigue en 30', c2.awards === c1.awards && c2.facts === c1.facts && xpOf('a1') === 30, JSON.stringify(c2));
    const direct = L.recordWorkRecognition(writer, { evidenceId: ev2.id, userId: 'a1', actorId: 'med', at: Date.now(), workRef: 'obra-a', decision: 'aprobado' }, { env: ENV });
    ok('el gancho de revisión con la misma evidencia tampoco emite', direct.inserted === false && xpOf('a1') === 30, JSON.stringify(direct));
    ev3 = deliver('a1', EXPS[2]); sweep();
    ok('una entrega nueva en la misma obra y ciclo no recupera el techo anulado', xpOf('a1') === 30, String(xpOf('a1')));

    section('[6] entradas inválidas y fallo seguro');
    const cFail = JSON.stringify(ledgerCounts());
    const cases = [
        ['motivo fuera de la lista', req({ reason: 'porque si' }), 'INVALID_VOID_REASON'],
        ['referencia con datos personales', req({ requestRef: 'Ana Pérez 5B' }), 'INVALID_REQUEST_REF'],
        ['sin referencia', req({ requestRef: '' }), 'INVALID_REQUEST_REF'],
        ['sin operador', req({ actorId: '' }), 'INVALID_ACTOR'],
        ['autocorrección', req({ actorId: 'a1' }), 'SELF_RECTIFICATION'],
        ['evidencia sin reconocimiento', req({ evidenceId: ev3.id }), 'RECOGNITION_NOT_FOUND'],
        ['evidencia inexistente', req({ evidenceId: 'no-existe' }), 'RECOGNITION_NOT_FOUND'],
        ['persona sin sujeto', req({ userId: 'a3' }), 'RECOGNITION_NOT_FOUND'],
        ['evidencia de otra persona', req({ userId: 'a2' }), 'RECOGNITION_NOT_FOUND'],
    ];
    for (const [l, r, want] of cases) ok(`${l} ⇒ ${want}`, codeOf(() => RX.voidRecognition(writer, r)) === want, String(codeOf(() => RX.voidRecognition(writer, r))));
    E.excludeUser(writer, { userId: 'a2', env: ENV });
    ok('persona excluida ⇒ SUBJECT_EXCLUDED', codeOf(() => RX.voidRecognition(writer, req({ userId: 'a2', evidenceId: evB.id }))) === 'SUBJECT_EXCLUDED');
    const regRaw = fs.readFileSync(P.reg, 'utf8');
    fs.writeFileSync(P.reg, `${regRaw}{"x":1}\n`);
    ok('registro de exclusiones dañado ⇒ no se escribe', codeOf(() => RX.voidRecognition(writer, req())) === 'EXCLUSION_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(P.reg, regRaw);
    SK.clearSubjectKey();
    ok('sin clave de sujeto ⇒ SUBJECT_KEY_UNAVAILABLE', codeOf(() => RX.voidRecognition(writer, req())) === 'SUBJECT_KEY_UNAVAILABLE');
    SK.installSubjectKey(process.env.CHP_TEST_SUBJECT_KEY);
    ok('ningún intento fallido dejó filas', JSON.stringify(ledgerCounts()) === cFail, `${JSON.stringify(ledgerCounts())} vs ${cFail}`);

    section('[7] XP apagado');
    const OFF = { ...ENV, XP_EARNING_ENABLED: '' };
    const evC = deliver('c1', EXPS[3]); sweep();
    ok('c1: 30 XP con XP encendido', xpOf('c1') === 30);
    const offAck = RX.voidRecognition(writer, { userId: 'c1', evidenceId: evC.id, reason: 'rectification_request', requestRef: 'SOL-SINT-0003', actorId: 'adm-op' }, { env: OFF });
    ok('con XP apagado la corrección funciona (corregir no emite)', offAck.voided === true && xpOf('c1') === 0);
    const c3 = ledgerCounts();
    deliver('c1', EXPS[0]); sweep(OFF);
    ok('con XP apagado el barrido no emite nada', ledgerCounts().awards === c3.awards && xpOf('c1') === 0);

    section('[8] dos réplicas a la vez');
    const evD = deliver('a3', EXPS[3]); sweep();
    ok('a3: 30 XP', xpOf('a3') === 30);
    writer.pragma('wal_checkpoint(TRUNCATE)');
    const barrier = path.join(tmp, 'go');
    const spawnOne = (ref) => new Promise((resolve) => {
        const c = spawn(process.execPath, [path.join(HERE, 'rectificationWorker.mjs'), barrier, 'a3', evD.id, ref], { env: { ...process.env, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        c.stdout.on('data', (d) => { out += d; });
        c.stderr.on('data', (d) => { out += d; });
        c.on('exit', () => resolve(out.trim().split('\n').at(-1)));
    });
    const runs = [spawnOne('SOL-SINT-0004'), spawnOne('SOL-SINT-0005')];
    await new Promise((r) => setTimeout(r, 1500));
    fs.writeFileSync(barrier, '');
    const outs = (await Promise.all(runs)).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    ok('una réplica anula y la otra ve la anulación', outs.filter((o) => o.voided).length === 1 && outs.filter((o) => o.alreadyVoided).length === 1, JSON.stringify(outs));
    const a3void = count("SELECT COUNT(*) n FROM gm_xp_entries v JOIN gm_xp_entries a ON a.entry_id = v.voids_entry_id WHERE v.kind = 'void' AND a.subject_ref = (SELECT subject_ref FROM gm_subjects WHERE user_id = 'a3')");
    ok('exactamente una anulación y una auditoría para a3', a3void === 1 && count("SELECT COUNT(*) n FROM gm_admin_audit WHERE ref IN ('SOL-SINT-0004','SOL-SINT-0005')") === 1);
    ok('a3: 0 XP, visto igual por el escritor', xpOf('a3') === 0);

    section('[9] invariantes de O8');
    ok('cada anulación apunta a un award del mismo sujeto', count("SELECT COUNT(*) n FROM gm_xp_entries v WHERE v.kind = 'void' AND NOT EXISTS (SELECT 1 FROM gm_xp_entries a WHERE a.entry_id = v.voids_entry_id AND a.kind = 'award' AND a.subject_ref = v.subject_ref)") === 0);
    ok('actos por obra = su asiento award (work_caps)', count("SELECT COUNT(*) n FROM (SELECT c.fact_id FROM gm_work_cycles c GROUP BY c.fact_id HAVING SUM(c.xp) <> (SELECT a.xp FROM gm_xp_entries a WHERE a.fact_id = c.fact_id AND a.kind = 'award'))") === 0);
    ok('sin PM', ['gm_pm_movements', 'gm_pm_balances', 'gm_redemptions'].every((t) => count(`SELECT COUNT(*) n FROM ${t}`) === 0));
    ok('un award por hecho, sin huérfanos', count("SELECT COUNT(*) n FROM (SELECT fact_id FROM gm_xp_entries WHERE kind = 'award' GROUP BY fact_id HAVING COUNT(*) > 1)") === 0
        && count("SELECT COUNT(*) n FROM gm_source_facts f WHERE NOT EXISTS (SELECT 1 FROM gm_xp_entries a WHERE a.fact_id = f.fact_id AND a.kind = 'award')") === 0);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nXP rectification (V8.1-CLOSE-01 G-03): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
