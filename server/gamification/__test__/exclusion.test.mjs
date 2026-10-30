/**
 * exclusion.test.mjs — CHP-GAMIFICACION-PRIV-01D.
 *
 * Exclusión y no recreación, sobre bases temporales y usuarios sintéticos:
 *  [1] exclusión: desvincula, extingue saldo y es idempotente
 *  [2] reconciliación y ganchos: cero recreaciones
 *  [3] exclusión concurrente con ingesta desde dos procesos
 *  [4] restauración de un respaldo anterior a la exclusión
 *  [5] registro ausente, alterado o desalineado: ingesta bloqueada
 *  [6] separación criptográfica
 *  [7] flags OFF y aislamiento
 *
 *   node server/gamification/__test__/exclusion.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/pmMechanicsHarness.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_excl_'));
const dbDir = (n) => path.join(tmp, n, 'db');
const regFile = (n) => path.join(tmp, n, 'reg', 'registry.jsonl');

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const X = await import('../exclusions.mjs');
const E = await import('../erasure.mjs');
const S = await import('../subjects.mjs');
const R = await import('../reconcile.mjs');
const M = await import('../mookSource.mjs');
const I = await import('../intake.mjs');
const K = await import('../subjectKey.mjs');

const USER = 'lector-sintetico-excluido';
const KEEP = 'lector-sintetico-vigente';
const T = Date.UTC(2026, 9, 3, 15);
const rules = { schema: 1, caps: { pmPerDay: 1000, pmPerWeek: 5000 }, facts: { 'mission/mission_completed': { xp: 3, pm: 7 }, 'mook_experience/experience_completed': { xp: 2 } } };
function fresh(name) {
    const dir = dbDir(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.dirname(regFile(name)), { recursive: true });
    fs.writeFileSync(regFile(name), '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: path.join(dir, 'gamification.db'), GAMIFICATION_EXCLUSION_REGISTRY: regFile(name) };
    process.env.GAMIFICATION_EXCLUSION_REGISTRY = regFile(name);
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    L.createRuleSet(db, { ruleVersion: 'gm-e-v1', createdBy: 'migration', now: T - 1000, rules });
    return { db, env };
}
const mission = (userId, id) => ({ source: 'mission', sourceEventId: id, factType: 'mission_completed', userId, occurredAt: T, eligibility: 'eligible', now: T });
const route = (userId, v = 'xv-1') => ({ id: `r-${userId}-${v}`, userId, experienceVersionId: v, status: 'completed', completedAt: new Date(T + 1000).toISOString() });
const resolveUser = () => ({ exists: true, active: true, synthetic: false });
const n = (db, sql, ...a) => db.prepare(sql).get(...a).c;
const subjects = (db) => n(db, 'SELECT COUNT(*) c FROM gm_subjects');

try {
    section('[1] exclusión');
    let { db, env } = fresh('a');
    L.recordFact(db, mission(USER, 'm1'), { env });
    L.recordFact(db, mission(USER, 'm2'), { env });
    L.recordFact(db, mission(KEEP, 'm1'), { env });
    const ref = S.findSubject(db, USER).subject_ref;
    const rows = n(db, 'SELECT COUNT(*) c FROM gm_source_facts');
    const r1 = E.excludeUser(db, { userId: USER, env, now: T, requestRef: 'solicitud-sintetica-1' });
    ok('desvincula y extingue el saldo', r1.unlinked && r1.extinguished === 14 && r1.inserted, JSON.stringify(r1));
    ok('el acuse no contiene identidad', !JSON.stringify(r1).includes(USER) && !JSON.stringify(r1).includes(ref));
    ok('el vínculo desaparece, el otro lector sigue', !S.findSubject(db, USER) && !!S.findSubject(db, KEEP) && subjects(db) === 1);
    ok('el ledger conserva sus filas', n(db, 'SELECT COUNT(*) c FROM gm_source_facts') === rows);
    ok('saldo a 0 con una compensación auditada', n(db, "SELECT COUNT(*) c FROM gm_pm_movements WHERE subject_ref=? AND kind='compensation' AND reason_code='subject_erasure' AND actor_ref='system'", ref) === 1
        && db.prepare('SELECT available a FROM gm_pm_balances WHERE subject_ref=?').get(ref).a === 0);
    ok('el ledger cuadra', L.verifyLedger(db).ok);
    ok('tombstone sin identidad', n(db, 'SELECT COUNT(*) c FROM gm_erasures WHERE tombstone=?', X.tombstoneOf(USER)) === 1 && !JSON.stringify(db.prepare('SELECT * FROM gm_erasures').all()).includes(USER));
    ok('sin actividad en el tombstone: solo id, tombstone, día y referencia', db.prepare('PRAGMA table_info(gm_erasures)').all().length === 4);
    const r2 = E.excludeUser(db, { userId: USER, env, now: T });
    ok('repetir no cambia nada', !r2.inserted && !r2.unlinked && r2.extinguished === 0 && n(db, 'SELECT COUNT(*) c FROM gm_erasures') === 1 && L.verifyLedger(db).ok);
    ok('el registro no duplica', fs.readFileSync(regFile('a'), 'utf8').trim().split('\n').length === 1);
    ok('excluir a quien no tiene sujeto también se registra', E.excludeUser(db, { userId: 'sin-actividad', env, now: T }).inserted && !E.excludeUser(db, { userId: 'sin-actividad', env, now: T }).unlinked);
    ok('referencia inválida rechazada', throwsCode(() => E.excludeUser(db, { userId: 'x', requestRef: 'con espacios', env }), 'INVALID_REQUEST_REF'));
    db.pragma('wal_checkpoint(TRUNCATE)');
    ok('la identidad no queda en el archivo', ![env.GAMIFICATION_DB, `${env.GAMIFICATION_DB}-wal`].some((p) => fs.existsSync(p) && fs.readFileSync(p).includes(USER)));
    ok('un canje abierto impide excluir', (() => {
        const s = fresh('canje');
        L.recordFact(s.db, mission(USER, 'm1'), { env: s.env });
        const sr = S.findSubject(s.db, USER).subject_ref;
        s.db.prepare("INSERT INTO gm_redemptions VALUES ('c1',?,'k','rw','digital_asset',1,'gm-e-v1','RESERVED',1,1)").run(sr);
        const blocked = throwsCode(() => E.excludeUser(s.db, { userId: USER, env: s.env }), 'OPEN_REDEMPTIONS');
        const intact = !!S.findSubject(s.db, USER) && n(s.db, 'SELECT COUNT(*) c FROM gm_erasures') === 0;
        return blocked && intact;
    })());

    section('[2] cero recreaciones');
    ({ db, env } = fresh('b'));
    const doc = { evidence: [], runs: [route(USER), route(KEEP)] };
    const cands = () => R.mookExperienceCandidates(doc);
    ok('primer barrido: dos rutas', R.reconcile(db, cands(), { resolveUser, env }).recorded === 2);
    E.excludeUser(db, { userId: USER, env, now: T });
    const before = n(db, 'SELECT COUNT(*) c FROM gm_source_facts');
    const s1 = R.reconcile(db, cands(), { resolveUser, env });
    ok('barrido tras excluir: ningún hecho', s1.recorded === 0 && s1.byDecision.rejected_excluded_user === 1, JSON.stringify(s1));
    ok('ningún sujeto recreado', !S.findSubject(db, USER) && subjects(db) === 1);
    const hookRes = L.recordFact(db, { ...mission(USER, 'nuevo') }, { env });
    ok('ingesta directa rechazada, sin fila', hookRes.decision === 'rejected_excluded_user' && !hookRes.persisted);
    const actor = L.recordFact(db, { ...mission(KEEP, 'con-actor'), actorId: USER }, { env });
    ok('tampoco como actor', actor.decision === 'rejected_excluded_user' && !S.findSubject(db, USER));
    ok('ajuste rechazado', throwsCode(() => L.appendAdjustment(db, { userId: USER, amount: 1, reasonCode: 'x', actorId: 'admin', idempotencyKey: 'z', ruleVersion: 'gm-e-v1' }), 'SUBJECT_EXCLUDED'));
    ok('el alta directa también', throwsCode(() => S.ensureSubject(db, USER, { roleClass: 'reader', day: '2026-11-03' }), 'SUBJECT_EXCLUDED'));
    ok('sin filas nuevas', n(db, 'SELECT COUNT(*) c FROM gm_source_facts') === before);
    ok('el otro lector sigue recibiendo', L.recordFact(db, mission(KEEP, 'sigue'), { env }).inserted);
    D.closeGamificationDb({ resetBackoff: true }); I.closeIntake({ resetBackoff: true });
    const swept = M.runMookReconcileOnce({ readMook: () => doc, readUsers: () => [{ id: USER }, { id: KEEP }], isUserActive: () => true, isSyntheticUser: () => false, env: { ...env, GAMIFICATION_MOOK_SINCE: new Date(T - 1000).toISOString() } });
    db = D.getGamificationDb({ env });
    ok('barrido programado tras reiniciar: sin recreación', swept.ok && swept.recorded === 0 && !S.findSubject(db, USER), JSON.stringify(swept));

    section('[3] exclusión concurrente con ingesta en dos procesos');
    const c = fresh('c');
    const barrier = path.join(tmp, 'go');
    const stop = path.join(tmp, 'stop');
    D.closeGamificationDb({ resetBackoff: true });
    const worker = (role) => new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(HERE, 'exclusionWorker.mjs'), role, barrier, stop],
            { env: { ...process.env, GAMIFICATION_DB: c.env.GAMIFICATION_DB, GAMIFICATION_EXCLUSION_REGISTRY: regFile('c'), CHP_EXCLUDED_USER: USER }, stdio: ['ignore', 'pipe', 'pipe'] });
        let so = '', se = '';
        p.stdout.on('data', (d) => { so += d; }); p.stderr.on('data', (d) => { se += d; });
        p.on('close', (code) => { try { resolve({ code, ...JSON.parse(so) }); } catch { resolve({ code, errors: [so + se] }); } });
    });
    const ws = [worker('api1'), worker('api2'), worker('exclude')];
    setTimeout(() => fs.writeFileSync(barrier, 'go'), 700);
    const [w1, w2, w3] = await Promise.all(ws);
    ok('los tres procesos terminan sin error', [w1, w2, w3].every((w) => w.code === 0 && w.errors.length === 0), JSON.stringify([w1, w2, w3]).slice(0, 400));
    ok('hubo ingesta antes de la exclusión', w1.inserted + w2.inserted > 0, `${w1.inserted}+${w2.inserted}`);
    ok('ambas réplicas fueron rechazadas después', w1.refused > 0 && w2.refused > 0, `${w1.refused}+${w2.refused}`);
    const cdb = D.getGamificationDb({ env: c.env });
    ok('el sujeto no se recreó', subjects(cdb) === 0 && !S.findSubject(cdb, USER));
    ok('un único tombstone', n(cdb, 'SELECT COUNT(*) c FROM gm_erasures') === 1);
    ok('ledger coherente y saldo extinguido', L.verifyLedger(cdb).ok && n(cdb, 'SELECT COUNT(*) c FROM gm_pm_balances WHERE available <> 0') === 0);
    ok('una sola compensación de exclusión', n(cdb, "SELECT COUNT(*) c FROM gm_pm_movements WHERE reason_code='subject_erasure'") === 1);
    ok('ningún movimiento posterior a la compensación', (() => {
        const last = cdb.prepare('SELECT reason_code r FROM gm_pm_movements ORDER BY seq DESC LIMIT 1').get();
        return last.r === 'subject_erasure';
    })());

    section('[4] restauración de un respaldo anterior');
    const d = fresh('d');
    L.recordFact(d.db, mission(USER, 'm1'), { env: d.env });
    L.recordFact(d.db, mission(KEEP, 'm1'), { env: d.env });
    const snapshot = path.join(tmp, 'respaldo.db');
    d.db.exec(`VACUUM INTO '${snapshot.replace(/\\/g, '/')}'`);
    E.excludeUser(d.db, { userId: USER, env: d.env, now: T });
    D.closeGamificationDb({ resetBackoff: true });
    for (const suf of ['', '-wal', '-shm']) fs.rmSync(d.env.GAMIFICATION_DB + suf, { force: true });
    fs.copyFileSync(snapshot, d.env.GAMIFICATION_DB);
    let rdb = D.getGamificationDb({ env: d.env });
    ok('el respaldo trae de vuelta al sujeto', !!S.findSubject(rdb, USER) && n(rdb, 'SELECT COUNT(*) c FROM gm_erasures') === 0);
    ok('la puerta bloquea la ingesta', throwsCode(() => X.exclusionGate(rdb, d.env), 'EXCLUSION_REPLAY_REQUIRED'));
    ok('también la del otro lector', throwsCode(() => L.recordFact(rdb, mission(KEEP, 'bloqueada'), { env: d.env }), 'EXCLUSION_REPLAY_REQUIRED'));
    ok('y el barrido', throwsCode(() => R.reconcile(rdb, [], { resolveUser, env: d.env }), 'EXCLUSION_REPLAY_REQUIRED'));
    const io = await new Promise((resolve) => { I.closeIntake({ resetBackoff: true }); I.scheduleFact({ source: 'mook_experience', sourceEventId: 'xv-9', factType: 'experience_completed', userId: KEEP, occurredAt: T, eligibility: 'eligible', now: T }, { env: d.env, onDone: resolve }); });
    ok('y los ganchos: desisten', io.ok === false && io.code === 'EXCLUSION_REPLAY_REQUIRED', JSON.stringify(io));
    const rp = E.replayExclusions(rdb, { env: d.env, now: T });
    ok('reaplicar desvincula', rp.applied === 1 && rp.unlinked === 1 && !S.findSubject(rdb, USER), JSON.stringify(rp));
    ok('la puerta se abre y el otro lector sigue', !!X.exclusionGate(rdb, d.env) && L.recordFact(rdb, mission(KEEP, 'tras-replay'), { env: d.env }).inserted);
    ok('saldo extinguido tras reaplicar', L.verifyLedger(rdb).ok);
    const again = E.replayExclusions(rdb, { env: d.env, now: T });
    ok('reaplicar otra vez no hace nada', again.applied === 0 && again.unlinked === 0);
    const mid = fresh('mid');
    L.recordFact(mid.db, mission(USER, 'm1'), { env: mid.env });
    X.appendRegistry({ id: 'caida', tombstone: X.tombstoneOf(USER), day: '2026-11-03' }, mid.env);
    ok('caída entre registro y base: bloqueada', throwsCode(() => L.recordFact(mid.db, mission(KEEP, 'x'), { env: mid.env }), 'EXCLUSION_REPLAY_REQUIRED'));
    ok('…y se completa al reaplicar', E.replayExclusions(mid.db, { env: mid.env, now: T }).unlinked === 1 && !S.findSubject(mid.db, USER));

    section('[5] registro no disponible');
    const f = fresh('f');
    L.recordFact(f.db, mission(KEEP, 'base'), { env: f.env });
    const blockedBy = (mod, code) => {
        const was = process.env.GAMIFICATION_EXCLUSION_REGISTRY;
        const envX = mod(f.env);
        process.env.GAMIFICATION_EXCLUSION_REGISTRY = envX.GAMIFICATION_EXCLUSION_REGISTRY ?? '';
        const before2 = n(f.db, 'SELECT COUNT(*) c FROM gm_source_facts');
        const res = throwsCode(() => L.recordFact(f.db, mission(KEEP, `x-${code}-${Math.random()}`), { env: envX }), code);
        process.env.GAMIFICATION_EXCLUSION_REGISTRY = was;
        return res && n(f.db, 'SELECT COUNT(*) c FROM gm_source_facts') === before2;
    };
    ok('sin ruta configurada', blockedBy((e) => ({ ...e, GAMIFICATION_EXCLUSION_REGISTRY: '' }), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
    ok('archivo inexistente', blockedBy((e) => ({ ...e, GAMIFICATION_EXCLUSION_REGISTRY: path.join(tmp, 'f', 'reg', 'no-existe') }), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
    ok('en el mismo directorio que la base', blockedBy((e) => ({ ...e, GAMIFICATION_EXCLUSION_REGISTRY: path.join(path.dirname(e.GAMIFICATION_DB), 'r.jsonl') }), 'EXCLUSION_REGISTRY_NOT_INDEPENDENT'));
    const tampered = path.join(tmp, 'f', 'reg', 'alterado.jsonl');
    fs.writeFileSync(tampered, `${JSON.stringify({ id: 'a', t: 'b', d: 'c', m: '00' })}\n`);
    ok('línea alterada', blockedBy((e) => ({ ...e, GAMIFICATION_EXCLUSION_REGISTRY: tampered }), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
    const partial = path.join(tmp, 'f', 'reg', 'parcial.jsonl');
    fs.writeFileSync(partial, '{"id":"a"');
    ok('línea incompleta', blockedBy((e) => ({ ...e, GAMIFICATION_EXCLUSION_REGISTRY: partial }), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
    const g = fresh('g');
    E.excludeUser(g.db, { userId: USER, env: g.env, now: T });
    fs.writeFileSync(regFile('g'), '');
    ok('registro retrocedido respecto de la base', throwsCode(() => L.recordFact(g.db, mission(KEEP, 'x'), { env: g.env }), 'EXCLUSION_REGISTRY_STALE'));
    ok('ajustes y compensaciones también', throwsCode(() => L.appendAdjustment(g.db, { userId: KEEP, amount: 1, reasonCode: 'x', actorId: 'admin', idempotencyKey: 'z', ruleVersion: 'gm-e-v1' }), 'EXCLUSION_REGISTRY_STALE'));

    section('[6] separación criptográfica');
    const s = fresh('s');
    L.recordFact(s.db, mission(USER, 'm1'), { env: s.env });
    const subj = S.findSubject(s.db, USER);
    const t1 = X.tombstoneOf(USER);
    ok('tombstone determinista', t1 === X.tombstoneOf(USER) && t1 !== X.tombstoneOf(KEEP) && /^[0-9a-f]{64}$/.test(t1));
    ok('no es un hash sin clave', !['sha256', 'sha1'].some((a) => crypto.createHash(a).update(USER).digest('hex') === t1));
    ok('no coincide con ninguna clave del ledger', ![S.deriveSourceKey(subj, 'x', 'y', USER), S.deriveWorkKey(subj, USER), crypto.createHmac('sha256', K.getSubjectKey()).update(USER).digest('hex')].includes(t1));
    const key = K.getSubjectKey();
    K.clearSubjectKey();
    ok('sin clave de servidor no se calcula', throwsCode(() => X.tombstoneOf(USER), 'SUBJECT_KEY_UNAVAILABLE'));
    K.installSubjectKey(key);
    const erasureSrc = fs.readFileSync(path.join(HERE, '..', 'exclusions.mjs'), 'utf8');
    const subjectSrc = fs.readFileSync(path.join(HERE, '..', 'subjects.mjs'), 'utf8');
    ok('etiquetas de derivación distintas', /gm-exclusion-v1/.test(erasureSrc) && /gm-exclusion-registry-v1/.test(erasureSrc) && /gm-subject-v1/.test(subjectSrc) && !/gm-exclusion/.test(subjectSrc));

    section('[7] flags OFF y aislamiento');
    const off = fresh('off');
    const offBefore = fs.readFileSync(regFile('off'), 'utf8') + n(off.db, 'SELECT COUNT(*) c FROM gm_source_facts');
    const noFlags = { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: off.env.GAMIFICATION_DB, GAMIFICATION_EXCLUSION_REGISTRY: '' };
    const offR = L.recordFact(off.db, mission(USER, 'off'), { env: noFlags });
    ok('flags OFF: sin escrituras y sin exigir el registro', offR.decision === 'disabled_source' && fs.readFileSync(regFile('off'), 'utf8') + n(off.db, 'SELECT COUNT(*) c FROM gm_source_facts') === offBefore);
    ok('fuente bloqueada: sin exigir el registro', L.recordFact(off.db, { ...mission(USER, 'r'), source: 'mook_review', factType: 'evidence_reviewed' }, { env: noFlags }).decision === 'observed');
    const OFF_DB = path.join(tmp, 'sin', 'gamification.db');
    ok('flag padre OFF: sin base', throwsCode(() => D.getGamificationDb({ env: { GAMIFICATION_DB: OFF_DB } }), 'GAMIFICATION_DISABLED') && !fs.existsSync(path.dirname(OFF_DB)));
    const mods = fs.readdirSync(path.join(HERE, '..')).filter((m) => m.endsWith('.mjs'));
    const imports = mods.flatMap((m) => [...fs.readFileSync(path.join(HERE, '..', m), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((x) => x[1]));
    ok('sin regalías, progreso ni stores MOOK', !imports.some((i) => /royalt|rights|access|woo|progressService|experienceStore/i.test(i)), imports.join());
    ok('solo subjects.mjs toca gm_subjects', mods.filter((m) => /(FROM|INTO|DELETE FROM) gm_subjects/.test(fs.readFileSync(path.join(HERE, '..', m), 'utf8'))).join() === 'subjects.mjs');
    ok('el producto no llama a excludeUser', !fs.readFileSync(path.join(HERE, '..', '..', 'server.js'), 'utf8').includes('excludeUser') && mods.filter((m) => /excludeUser\(/.test(fs.readFileSync(path.join(HERE, '..', m), 'utf8'))).join() === 'erasure.mjs');
    const inventory = fs.readFileSync(path.join(HERE, '..', '..', '..', 'ops', 'backup', 'CHP-BACKUP-01B', 'runners', 'chibalete_backup', 'stores.py'), 'utf8');
    ok('el registro no está en el inventario de respaldos', !/GAMIFICATION_EXCLUSION|exclusion_registry|registry\.jsonl/i.test(inventory));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); I.closeIntake({ resetBackoff: true }); } catch { /* noop */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nCHP-GAMIFICACION-PRIV-01D (exclusión) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
