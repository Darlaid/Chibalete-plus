/**
 * o8Check.test.mjs — V8-GATE-CLOSE-02 (O8). Laboratorio del comprobador operativo, con
 * datos SINTÉTICOS, dentro de la imagen de la API (POSIX: modos de archivo reales).
 *
 *   docker run --rm --network none -v "<repo>/ops/gamification:/o8:ro" \
 *     --entrypoint node chibalete/api:<tag> /o8/__tests__/o8Check.test.mjs
 *
 * Escenarios: inerte; base viva con hechos reales (30/+20/techo) ⇒ OK; alteraciones
 * (PM, hecho sin asiento, acto por encima de su importe, techo, fuente ajena, hecho
 * anterior al corte, registro desalineado, regla distinta del acta) ⇒ FAIL con su
 * contador; clave ausente o con modo incorrecto ⇒ FAIL; base sin escritor vivo ⇒ WARN
 * sin crear archivos. Nunca toca rutas fuera de un directorio temporal.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, '..', 'o8-check.mjs');
const ROOT = process.env.O8_APP_ROOT || '/app';
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_o8_'));
const P = { dbDir: path.join(tmp, 'dc'), regDir: path.join(tmp, 'reg'), secDir: path.join(tmp, 'sec') };
for (const d of Object.values(P)) fs.mkdirSync(d, { recursive: true });
P.db = path.join(P.dbDir, 'gamification.db');
P.reg = path.join(P.regDir, 'exclusions.jsonl');
P.key = path.join(P.secDir, 'gamification_subject_key');
fs.writeFileSync(P.reg, '');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'), { mode: 0o400 });
fs.chmodSync(P.key, 0o400);

const SINCE = Date.now() - 3_600_000;
const ACTA = { schema: 1, facts: {}, recognition: { approvalRef: 'DIR-XP-O1-20261107', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } }, xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } } };
const ACTA_SHA = crypto.createHash('sha256').update(JSON.stringify(ACTA)).digest('hex');
const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg,
    GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString(), O8_KEY_PATH: P.key, O8_EXPECT_RULE_VERSION: 'a7a12-v3-xp-o1', O8_EXPECT_RULES_SHA: ACTA_SHA, O8_APP_ROOT: ROOT };

function run(env) {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GAMIFICATION|XP|PM|O8)_/.test(k)));
    const r = spawnSync(process.execPath, [CHECK], { env: { ...clean, ...env }, encoding: 'utf8' });
    const lines = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const by = Object.fromEntries(lines.filter((l) => l.check).map((l) => [l.check, l]));
    return { rc: r.status, by, summary: lines.at(-1), raw: r.stdout + r.stderr };
}

try {
    console.log('\n[1] inerte (sin flags ni archivos)');
    {
        const r = run({ O8_APP_ROOT: ROOT, GAMIFICATION_DB: P.db, O8_KEY_PATH: path.join(tmp, 'no-key') });
        ok('rc 0 y modo inerte', r.rc === 0 && r.summary?.mode === 'inerte' && r.summary.summary === 'OK', r.raw);
        ok('sin base, sin clave, sin registro: OK en inerte', r.by.ledger_db?.present === false && r.by.subject_key?.present === false && r.by.exclusion_registry?.configured === false);
        ok('no creó la base', !fs.existsSync(P.db));
    }

    console.log('\n[2] base viva con hechos reales');
    process.env.GAMIFICATION_DB = P.db;
    process.env.GAMIFICATION_EXCLUSION_REGISTRY = P.reg;
    const D = await import(path.join(ROOT, 'server/gamification/db.mjs'));
    const L = await import(path.join(ROOT, 'server/gamification/ledger.mjs'));
    const SK = await import(path.join(ROOT, 'server/gamification/subjectKey.mjs'));
    await SK.loadSubjectKey({ path: P.key });
    // V8.1-CLOSE-06A (G-01): sin A1 verificada no hay XP. Fichas C.1 sintéticas para los lectores de la siembra.
    const A2R = await import(path.join(ROOT, 'server/privacy/a2Registry.mjs'));
    process.env.CHP_A2_REGISTRY = path.join(tmp, 'a2', 'decisions.jsonl');
    fs.mkdirSync(path.dirname(process.env.CHP_A2_REGISTRY), { recursive: true });
    fs.writeFileSync(process.env.CHP_A2_REGISTRY, '');
    A2R.appendDecisions(['lec-a', 'lec-b'].map((u) => ({ subjectId: u, kind: 'A1', status: 'granted', actDay: '2000-01-01', version: '004@1.0',
        medium: 'paper', capacity: 'legal_representative', verification: 'verified', requestRef: `AUT-SINT-${u}` })));
    let writer = D.getGamificationDb({ env: ENV });
    L.createRuleSet(writer, { ruleVersion: 'a7a12-v3-xp-o1', createdBy: 'lab', rules: ACTA, now: SINCE, effectiveFrom: SINCE });
    const rec = (ev, user, work) => L.recordWorkRecognition(writer, { evidenceId: ev, userId: user, actorId: 'med-lab', at: Date.now(), workRef: work, decision: 'aprobado' }, { env: ENV });
    const xs = [rec('e1', 'lec-a', 'obra-1').xp, rec('e2', 'lec-a', 'obra-1').xp, rec('e3', 'lec-a', 'obra-1').xp, rec('e4', 'lec-b', 'obra-1').xp, rec('e1', 'lec-a', 'obra-1').xp];
    ok('siembra real: 30, 20, 0 (techo), 30, reintento 0', xs.join() === '30,20,0,30,0', xs.join());
    {
        const r = run(ENV);
        ok('todo OK con datos sanos', r.rc === 0 && r.summary.summary === 'OK', r.raw);
        ok('recuentos: 3 hechos, 3 asientos, 0 PM', r.by.facts_entries?.facts === 3 && r.by.facts_entries.xpEntries === 3 && r.by.pm_absent.pmRows === 0);
        ok('regla vigente = acta (versión y SHA)', r.by.rules?.activeMatchesActa === true);
        ok('clave cargable y registro alineado', r.by.subject_key?.loadable === true && r.by.registry_alignment?.status === 'OK');
        ok('la salida no contiene ids, claves ni rutas', !/lec-|med-|obra-|e1|[0-9a-f]{48}|chp_o8_/.test(r.raw), r.raw);
        ok('la comprobación no escribió: mismos hechos en la base', writer.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 3);
    }

    console.log('\n[2b] alarma D41 (aprobaciones anómalas)');
    {
        const r = run(ENV);
        ok('valores sanos: OK con máximos agregados', r.by.anomalies_d41?.status === 'OK' && r.by.anomalies_d41.maxApprovalsPerMediatorDay === 3 && r.by.anomalies_d41.maxXpPerReaderDay === 50, JSON.stringify(r.by.anomalies_d41));
        const w = run({ ...ENV, O8_MAX_APPROVALS_PER_MEDIATOR_DAY: '2', O8_MAX_XP_PER_READER_DAY: '40' });
        ok('umbral superado ⇒ WARN (no FAIL), rc 0', w.by.anomalies_d41?.status === 'WARN' && w.rc === 0 && w.summary.summary === 'WARN', JSON.stringify(w.summary));
    }

    console.log('\n[2c] rectificación (V8.1-CLOSE-01 G-03)');
    {
        const RX = await import(path.join(ROOT, 'server/gamification/rectification.mjs'));
        const ack = RX.voidRecognition(writer, { userId: 'lec-b', evidenceId: 'e4', reason: 'recognition_error', requestRef: 'SOL-SINT-0001', actorId: 'adm-lab' }, { env: ENV });
        const r = run(ENV);
        ok('tras anular: todo OK, 1 anulación válida', ack.voided && r.rc === 0 && r.summary.summary === 'OK' && r.by.facts_entries?.voids === 1 && r.by.facts_entries.badVoids === 0, r.raw);
        ok('work_caps sigue OK (los actos no cambian)', r.by.work_caps?.status === 'OK');
    }

    console.log('\n[3] regla distinta del acta');
    ok('SHA esperado distinto ⇒ FAIL en rules', run({ ...ENV, O8_EXPECT_RULES_SHA: 'f'.repeat(64) }).by.rules?.status === 'FAIL');

    console.log('\n[4] alteraciones del ledger (inyectadas por SQL, base sintética)');
    const fid = writer.prepare('SELECT fact_id, subject_ref FROM gm_source_facts LIMIT 1').get();
    writer.prepare(`INSERT INTO gm_pm_movements (movement_id, subject_ref, kind, amount, source, idempotency_key, fact_id, redemption_id, related_movement_id, reason_code, actor_ref, rule_version, period_day, period_week, created_at)
        VALUES ('mv-x', ?, 'adjustment', 5, 'admin', 'k-x', NULL, NULL, NULL, 'r', 'a', 'a7a12-v3-xp-o1', '2026-11-07', '2026-W45', 1)`).run(fid.subject_ref);
    writer.prepare("INSERT INTO gm_source_facts VALUES ('f-sin', 'mission', 'k-sin', 't', ?, NULL, ?, ?, 'B', 'awarded', 'a7a12-v3-xp-o1', '{}')").run(fid.subject_ref, Date.now(), Date.now());
    writer.prepare("INSERT INTO gm_source_facts VALUES ('f-old', 'mook_review', 'k-old', 'evidence_reviewed', ?, NULL, ?, ?, 'A', 'awarded', 'a7a12-v3-xp-o1', '{}')").run(fid.subject_ref, SINCE - 5 * 86_400_000, Date.now());
    writer.prepare("INSERT INTO gm_xp_entries VALUES ('x-old', ?, 'award', 15, 'f-old', NULL, 'a7a12-v3-xp-o1', 1)").run(fid.subject_ref);
    writer.prepare("INSERT INTO gm_work_cycles VALUES ('f-old', ?, 'wk-x', 1, 'reading', 15, 0)").run(fid.subject_ref);
    writer.prepare("INSERT INTO gm_work_cycles VALUES ('f-old', ?, 'wk-x', 1, 'reflection', 40, 0)").run(fid.subject_ref);
    writer.prepare("INSERT INTO gm_xp_entries VALUES ('v-bad', 'otro-sujeto', 'void', 0, NULL, 'x-old', 'a7a12-v3-xp-o1', 1)").run();
    {
        const r = run(ENV);
        ok('rc 1 y resumen FAIL', r.rc === 1 && r.summary.summary === 'FAIL');
        ok('PM detectado', r.by.pm_absent?.status === 'FAIL' && r.by.pm_absent.pmRows === 1);
        ok('fuente ajena y hecho sin asiento detectados', r.by.facts_entries?.badSources === 1 && r.by.facts_entries.factsWithoutEntry === 1);
        ok('acto por encima de su importe, techo superado y desajuste ciclo/asiento', r.by.work_caps?.actsOverAmount === 2 && r.by.work_caps.cyclesOverCeiling === 1 && r.by.work_caps.factsCycleXpMismatch === 1, JSON.stringify(r.by.work_caps));
        ok('hecho anterior al corte detectado', r.by.cutoff?.factsBeforeCutoff === 1);
        ok('anulación sobre un asiento de otro sujeto detectada', r.by.facts_entries?.badVoids === 1, JSON.stringify(r.by.facts_entries));
    }

    console.log('\n[5] registro desalineado');
    writer.prepare("INSERT INTO gm_erasures (erasure_id, tombstone, erased_on, request_ref) VALUES ('er-x', 'tomb-x', '2026-11-07', NULL)").run();
    ok('exclusión en la base sin línea en el registro ⇒ FAIL EXCLUSION_REGISTRY_STALE', run(ENV).by.registry_alignment?.code === 'EXCLUSION_REGISTRY_STALE');
    ok('registro en el mismo directorio que la base ⇒ FAIL', run({ ...ENV, GAMIFICATION_EXCLUSION_REGISTRY: path.join(P.dbDir, 'exclusions.jsonl') }).by.exclusion_registry?.status === 'FAIL');

    console.log('\n[6] clave');
    ok('clave ausente con G4 encendido ⇒ FAIL', run({ ...ENV, O8_KEY_PATH: path.join(P.secDir, 'no') }).by.subject_key?.status === 'FAIL');
    const loose = path.join(P.secDir, 'loose');
    fs.writeFileSync(loose, crypto.randomBytes(48).toString('hex'), { mode: 0o644 });
    fs.chmodSync(loose, 0o644);
    const rl = run({ ...ENV, O8_KEY_PATH: loose });
    ok('clave con modo 0644 ⇒ FAIL y no cargable', rl.by.subject_key?.status === 'FAIL' && rl.by.subject_key.loadable === false, JSON.stringify(rl.by.subject_key));

    console.log('\n[7] base sin escritor vivo');
    D.closeGamificationDb({ resetBackoff: true });
    writer = null;
    const before = fs.readdirSync(P.dbDir).sort().join();
    const rn = run(ENV);
    ok('XP encendido y base sin -wal/-shm ⇒ WARN, sin abrirla', rn.by.ledger_db?.status === 'WARN' && rn.by.ledger_db.live === false, JSON.stringify(rn.by.ledger_db));
    ok('no creó -wal/-shm', fs.readdirSync(P.dbDir).sort().join() === before, before);
} catch (e) {
    console.error('  ✗ excepción', e);
    fail++;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\no8Check (V8-GATE-CLOSE-02): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
