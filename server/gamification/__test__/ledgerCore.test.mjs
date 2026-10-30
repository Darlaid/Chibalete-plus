/**
 * ledgerCore.test.mjs — CHP-GAMIFICACION-G3-01 / G3-02.
 *
 * Núcleo persistente sobre una gamification.db TEMPORAL (GAMIFICATION_DB):
 * flag OFF sin archivo, migración idempotente, reglas versionadas y
 * validadas, política de emisión (el llamador nunca fija montos), topes
 * diarios/semanales en America/Bogota, idempotencia (100 repeticiones),
 * invariante snapshot = Σ ledger, constraints y triggers, base corrupta con
 * fallo seguro y aislamiento estructural (sin ganchos, sin regalías).
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/ledgerCore.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/pmMechanicsHarness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const throwsMsg = (fn, rx) => { try { fn(); return false; } catch (e) { return rx.test(e.message); } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'gamification.db');
const realBefore = fs.existsSync(REAL_DB);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_core_'));
const DB_PATH = path.join(tmp, 'nested', 'gamification.db');
process.env.GAMIFICATION_DB = DB_PATH;
delete process.env.GAMIFICATION_ENABLED;
delete process.env.PM_EARNING_ENABLED;

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const RV = 'gm-test-v1';
const EARN = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1' };
const CAPS = { pmPerDay: 200, pmPerWeek: 300, pmPerDayBySource: { mission: 50 } };
const RULES = { schema: 1, caps: CAPS, facts: {
    'mission/mission_completed': { xp: 30, pm: 20 }, // hecho sintético: el arnés de pruebas levanta el bloqueo solo en este proceso
    'mook_review/evidence_reviewed': { emitWhen: { decision: ['aprobado'] } },
    'mook_experience/experience_completed': { xp: 20 },
} };
const T0 = Date.UTC(2026, 9, 29, 15, 0, 0);
let seqTime = T0;
const tick = () => (seqTime += 1000);

try {
    section('[1] flag OFF: ni archivo ni migración');
    ok('importar los módulos no crea la base', !fs.existsSync(DB_PATH) && !fs.existsSync(path.dirname(DB_PATH)));
    ok('flag ausente ⇒ OFF', D.isGamificationEnabled({}) === false);
    for (const v of ['0', 'false', 'off', 'yes', ' ', 'TRUEISH']) ok(`GAMIFICATION_ENABLED='${v}' ⇒ OFF`, D.isGamificationEnabled({ GAMIFICATION_ENABLED: v }) === false);
    ok("'1' y 'true' ⇒ ON", D.isGamificationEnabled({ GAMIFICATION_ENABLED: '1' }) && D.isGamificationEnabled({ GAMIFICATION_ENABLED: 'TRUE' }));
    ok('PM_EARNING_ENABLED sin el padre ⇒ OFF', D.isEarningEnabled({ PM_EARNING_ENABLED: '1' }) === false && D.isEarningEnabled(EARN) === true);
    ok('getGamificationDb con flag OFF lanza GAMIFICATION_DISABLED', throwsCode(() => D.getGamificationDb(), 'GAMIFICATION_DISABLED'));
    const off = D.safely(() => 1);
    ok('safely con flag OFF ⇒ { ok:false, code:GAMIFICATION_DISABLED } sin lanzar', off.ok === false && off.code === 'GAMIFICATION_DISABLED');
    ok('tras intentos con flag OFF sigue sin archivo ni directorio', !fs.existsSync(DB_PATH) && !fs.existsSync(path.dirname(DB_PATH)));
    ok('la ruta por defecto es data-critical/gamification.db', D.resolveGamificationDbPath({}) === REAL_DB);

    section('[2] apertura, pragmas y migración');
    process.env.GAMIFICATION_ENABLED = '1';
    const db = D.getGamificationDb();
    ok('con flag ON se crea la base (y su directorio)', fs.existsSync(DB_PATH));
    ok('journal_mode = WAL', String(db.pragma('journal_mode', { simple: true })).toLowerCase() === 'wal');
    ok('synchronous = FULL (2)', db.pragma('synchronous', { simple: true }) === 2);
    ok('busy_timeout = 5000', db.pragma('busy_timeout', { simple: true }) === 5000);
    ok('foreign_keys = ON', db.pragma('foreign_keys', { simple: true }) === 1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'gm_%' ORDER BY name").all().map((r) => r.name);
    ok('exactamente las 13 tablas gm_ del modelo', JSON.stringify(tables) === JSON.stringify(['gm_achievements', 'gm_admin_audit', 'gm_erasures', 'gm_pm_balances', 'gm_pm_movements', 'gm_redemption_transitions', 'gm_redemptions', 'gm_reward_grants', 'gm_rule_sets', 'gm_source_facts', 'gm_subjects', 'gm_work_cycles', 'gm_xp_entries']), tables.join(','));
    const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    ok('sin tablas auxiliares (solo _migrations y sqlite_sequence)', allTables.filter((t) => !t.startsWith('gm_')).join(',') === '_migrations,sqlite_sequence', allTables.join(','));
    ok('dos migraciones registradas', JSON.stringify(db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version)) === '["0001_ledger","0002_subject_model"]');
    ok('la segunda apertura devuelve la misma conexión', D.getGamificationDb() === db);
    D.closeGamificationDb();
    const db2 = D.getGamificationDb();
    ok('reabrir no reaplica (siguen 2 migraciones)', db2.prepare('SELECT COUNT(*) n FROM _migrations').get().n === 2);
    const { runMigrations } = await import('../../db/migrate.js');
    const again = runMigrations(db2, () => {}, { dir: path.join(HERE, '..', 'migrations'), tag: 't' });
    ok('runMigrations explícito sobre una base migrada es no-op', again.applied.length === 0 && again.already.length === 2);

    section('[3] reglas versionadas (validadas, append-only, prospectivas)');
    ok('sin reglas vigentes ⇒ NO_ACTIVE_RULES', throwsCode(() => L.recordFact(db2, { source: 'mook_review', sourceEventId: 'ev-0', factType: 'evidence_reviewed', userId: 'u-x', occurredAt: T0, eligibility: 'eligible', now: T0 }, { env: EARN }), 'NO_ACTIVE_RULES'));
    ok('crear rule set', L.createRuleSet(db2, { ruleVersion: RV, rules: RULES, createdBy: 'migration', now: T0 }).created === true);
    ok('mismo contenido ⇒ idempotente', L.createRuleSet(db2, { ruleVersion: RV, rules: RULES, createdBy: 'migration', now: T0 }).created === false);
    ok('mismo id con otro contenido ⇒ IDEMPOTENCY_CONFLICT', throwsCode(() => L.createRuleSet(db2, { ruleVersion: RV, rules: { ...RULES, caps: { pmPerDay: 1, pmPerWeek: 1 } }, createdBy: 'migration', now: T0 }), 'IDEMPOTENCY_CONFLICT'));
    ok('reglas retroactivas ⇒ RETROACTIVE_RULES', throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-test-v0', rules: RULES, createdBy: 'migration', effectiveFrom: T0 - 1, now: T0 }), 'RETROACTIVE_RULES'));
    const badRules = [
        ['sin topes', { schema: 1, facts: {} }],
        ['tope diario > semanal', { schema: 1, facts: {}, caps: { pmPerDay: 10, pmPerWeek: 5 } }],
        ['grado configurable', { schema: 1, facts: { 'mission/mission_completed': { xp: 1, pm: 1, grade: 'A' } }, caps: CAPS }],
        ['fuente leo', { schema: 1, facts: { 'leo/answer': { xp: 1, pm: 1 } }, caps: CAPS }],
        ['monto fuera de cota', { schema: 1, facts: { 'mission/mission_completed': { xp: 1, pm: 99999 } }, caps: CAPS }],
        ['emitWhen con feature no admitida', { schema: 1, facts: { 'mission/mission_completed': { pm: 1, emitWhen: { feedback: ['x'] } } }, caps: CAPS }],
        ['clave raíz desconocida', { schema: 1, facts: {}, caps: CAPS, bonus: 5 }],
    ];
    for (const [l, r] of badRules) ok(`regla inválida (${l}) ⇒ INVALID_RULES`, throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-bad', rules: r, createdBy: 'migration', now: T0 }), 'INVALID_RULES'));
    ok('regla que haría emitir a la lectura ⇒ READING_EMISSION_LOCKED', throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-bad', rules: { schema: 1, facts: { 'reading_completion/reading_completed': { xp: 5, pm: 5 } }, caps: CAPS }, createdBy: 'migration', now: T0 }), 'READING_EMISSION_LOCKED'));
    ok('ninguna regla inválida quedó registrada', db2.prepare("SELECT COUNT(*) n FROM gm_rule_sets WHERE rule_version='gm-bad'").get().n === 0);

    const fact = (over = {}) => ({ source: 'mission', sourceEventId: 'ev-1', factType: 'mission_completed', userId: 'u-lector-1',
        actorId: 'u-mediador-1', occurredAt: T0, eligibility: 'eligible', ...over });
    const rec = (over = {}, env = EARN) => L.recordFact(db2, { now: tick(), ...fact(over) }, { env });

    section('[4] idempotencia: 100 repeticiones del mismo hecho');
    const results = [];
    for (let i = 0; i < 100; i++) results.push(rec());
    ok('solo la primera inserta', results.filter((r) => r.inserted).length === 1 && results[0].inserted);
    ok('las 100 devuelven el mismo factId, movimiento y montos', new Set(results.map((r) => r.factId)).size === 1 && new Set(results.map((r) => r.movementId)).size === 1 && results.every((r) => r.pm === 20 && r.xp === 30));
    ok('1 hecho, 1 asiento XP y 1 movimiento PM en la base', db2.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 1
        && db2.prepare('SELECT COUNT(*) n FROM gm_xp_entries').get().n === 1 && db2.prepare('SELECT COUNT(*) n FROM gm_pm_movements').get().n === 1);
    ok('saldo = 20 y XP = 30 (montos de la regla, no del llamador)', L.getBalance(db2, 'u-lector-1').available === 20 && L.getXp(db2, 'u-lector-1') === 30);
    ok('el hecho quedó con grado B (fijo por fuente) y la rule_version vigente', (() => { const r = db2.prepare('SELECT grade, rule_version FROM gm_source_facts').get(); return r.grade === 'B' && r.rule_version === RV; })());
    ok('mismo id de fuente con otro sujeto ⇒ hecho propio: las claves no se cruzan entre sujetos', rec({ userId: 'u-otro' }).inserted === true);

    section('[5] el llamador no fija montos; decisiones sin emisión');
    for (const k of ['xp', 'pm', 'amount', 'grade', 'decision', 'ruleVersion']) {
        ok(`campo «${k}» del llamador ⇒ CALLER_FIELD_NOT_ALLOWED`, throwsCode(() => L.recordFact(db2, { ...fact({ sourceEventId: `ev-f-${k}` }), [k]: k === 'grade' ? 'A' : 999 }, { env: EARN }), 'CALLER_FIELD_NOT_ALLOWED'));
    }
    const obs = rec({ sourceEventId: 'ev-obs', eligibility: 'observe' });
    ok('observe ⇒ observed, sin emisión ni fila', !obs.persisted && obs.factId === null && obs.decision === 'observed' && obs.pm === 0 && obs.xp === 0);
    const cc = rec({ source: 'mook_review', factType: 'evidence_reviewed', sourceEventId: 'ev-cc', features: { decision: 'con_comentarios' } });
    ok('MOOK con_comentarios ⇒ observed (emitWhen) sin emisión', cc.decision === 'observed' && cc.pm === 0 && cc.movementId === null);
    const self = rec({ sourceEventId: 'ev-self', actorId: 'u-lector-1' });
    ok('autorrevisión declarada elegible ⇒ rejected_self_review, sin emisión', self.decision === 'rejected_self_review' && self.pm === 0 && self.xp === 0);
    const rd = rec({ source: 'reading_completion', sourceEventId: 'u:c:w1', factType: 'reading_completed', features: { verdict: 'plausible', reasons: [] } });
    ok('lectura terminada elegible ⇒ observed (bloqueada), sin fila', rd.decision === 'observed' && rd.pm === 0 && !rd.persisted);
    const nr = rec({ sourceEventId: 'ev-norule', factType: 'otro_tipo' });
    ok('hecho sin regla ⇒ rejected_not_eligible', nr.decision === 'rejected_not_eligible' && nr.pm === 0);
    const syn = rec({ sourceEventId: 'ev-syn', eligibility: 'rejected_excluded_user' });
    ok('rechazo declarado por el adaptador se registra tal cual', syn.decision === 'rejected_excluded_user' && syn.pm === 0);
    const offE = rec({ sourceEventId: 'ev-off' }, { GAMIFICATION_ENABLED: '1' });
    ok('PM_EARNING_ENABLED ausente ⇒ disabled_source, sin emisión', offE.decision === 'disabled_source' && offE.pm === 0 && offE.xp === 0);
    const offE2 = rec({ sourceEventId: 'ev-off2' }, { PM_EARNING_ENABLED: '1' });
    ok('PM_EARNING_ENABLED con el padre OFF ⇒ disabled_source', offE2.decision === 'disabled_source');
    ok('elegibilidad desconocida ⇒ INVALID_ELIGIBILITY', throwsCode(() => rec({ sourceEventId: 'ev-x1', eligibility: 'awarded' }), 'INVALID_ELIGIBILITY'));
    ok('fuente leo ⇒ UNKNOWN_SOURCE', throwsCode(() => rec({ source: 'leo', sourceEventId: 'ev-x5' }), 'UNKNOWN_SOURCE'));
    ok('fuente royalties ⇒ UNKNOWN_SOURCE', throwsCode(() => rec({ source: 'royalties_qrs', sourceEventId: 'ev-x6' }), 'UNKNOWN_SOURCE'));
    ok('features con texto libre no admitido ⇒ INVALID_FEATURES', throwsCode(() => rec({ source: 'mook_review', factType: 'evidence_reviewed', sourceEventId: 'ev-x7', features: { feedback: 'muy bien' } }), 'INVALID_FEATURES'));
    ok('features con string largo ⇒ INVALID_FEATURES', throwsCode(() => rec({ source: 'mook_review', factType: 'evidence_reviewed', sourceEventId: 'ev-x8', features: { decision: 'x'.repeat(65) } }), 'INVALID_FEATURES'));
    ok('id con caracteres inválidos ⇒ INVALID_FACT', throwsCode(() => rec({ sourceEventId: 'ev 13 ; DROP' }), 'INVALID_FACT'));
    ok('ninguna operación rechazada dejó filas', db2.prepare("SELECT COUNT(*) n FROM gm_source_facts WHERE source_event_id LIKE 'ev-x%' OR source_event_id LIKE 'ev-f-%'").get().n === 0);

    section('[5b] topes diarios y semanales (America/Bogota)');
    const DAY1 = Date.UTC(2026, 10, 2, 15); // lunes 2026-11-02, 10:00 Bogotá
    const capRec = (id, at) => L.recordFact(db2, { ...fact({ userId: 'u-cap', sourceEventId: id }), now: at }, { env: EARN });
    const c = [0, 1, 2, 3].map((i) => capRec(`cap-${i}`, DAY1 + i * 1000));
    ok('20 + 20 + 10 (capped) + 0 (capped) con pmPerDayBySource.mission = 50', c.map((r) => r.pm).join(',') === '20,20,10,0' && c[2].decision === 'capped' && c[3].decision === 'capped');
    ok('el XP no se recorta por los topes de PM', c.every((r) => r.xp === 30));
    ok('al día siguiente (Bogotá) el tope diario se renueva', capRec('cap-d2', DAY1 + 86_400_000).pm === 20);
    for (let d = 2; d < 7; d++) for (let i = 0; i < 3; i++) capRec(`cap-w-${d}-${i}`, DAY1 + d * 86_400_000 + i * 1000);
    const weekly = db2.prepare("SELECT SUM(amount) n FROM gm_pm_movements WHERE subject_ref=(SELECT subject_ref FROM gm_subjects WHERE user_id='u-cap') AND kind='earn' AND period_week='2026-W45'").get().n;
    ok(`tope semanal respetado (${weekly} = ${CAPS.pmPerWeek})`, weekly === CAPS.pmPerWeek);
    ok('la semana ISO siguiente vuelve a emitir', capRec('cap-nextweek', DAY1 + 7 * 86_400_000).pm === 20);
    ok('23:59 del domingo en Bogotá (04:59Z del lunes) sigue en la semana anterior', L.periodsFor(Date.UTC(2026, 10, 9, 4, 59)).week === '2026-W45');

    section('[5c] cambio de reglas prospectivo (D48)');
    L.createRuleSet(db2, { ruleVersion: 'gm-test-v2', rules: { ...RULES, facts: { ...RULES.facts, 'mission/mission_completed': { xp: 30, pm: 5 } } }, createdBy: 'admin-1', effectiveFrom: T0 + 30 * 86_400_000, now: T0 });
    ok('antes de entrar en vigor rige la versión anterior', L.getActiveRuleSet(db2, T0 + 5).ruleVersion === RV);
    const v2 = L.recordFact(db2, { ...fact({ userId: 'u-v2', sourceEventId: 'ev-v2', occurredAt: T0 + 31 * 86_400_000 }), now: T0 + 31 * 86_400_000 }, { env: EARN });
    ok('después rige la nueva y el hecho guarda su rule_version', v2.pm === 5 && db2.prepare('SELECT rule_version FROM gm_source_facts WHERE fact_id=?').get(v2.factId).rule_version === 'gm-test-v2');
    ok('los hechos anteriores conservan su versión y su monto', db2.prepare('SELECT rule_version FROM gm_source_facts WHERE fact_id=?').get(results[0].factId).rule_version === RV && L.getBalance(db2, 'u-lector-1').available === 20);

    section('[6] ajustes y compensaciones (nunca «set balance»)');
    const mv1 = results[0].movementId;
    ok('ajuste por "system" ⇒ INVALID_ACTOR', throwsCode(() => L.appendAdjustment(db2, { userId: 'u-lector-1', amount: 5, reasonCode: 'support', actorId: 'system', idempotencyKey: 'k1', ruleVersion: RV }), 'INVALID_ACTOR'));
    const adj = L.appendAdjustment(db2, { userId: 'u-lector-1', amount: 5, reasonCode: 'support_goodwill', actorId: 'admin-1', idempotencyKey: 'k1', ruleVersion: RV, now: tick() });
    ok('ajuste +5 por administrador', adj.inserted && L.getBalance(db2, 'u-lector-1').available === 25);
    ok('reintento idéntico del ajuste ⇒ mismo movimiento, sin duplicar', L.appendAdjustment(db2, { userId: 'u-lector-1', amount: 5, reasonCode: 'support_goodwill', actorId: 'admin-1', idempotencyKey: 'k1', ruleVersion: RV }).movementId === adj.movementId && L.getBalance(db2, 'u-lector-1').available === 25);
    ok('misma clave con otro monto ⇒ IDEMPOTENCY_CONFLICT', throwsCode(() => L.appendAdjustment(db2, { userId: 'u-lector-1', amount: 6, reasonCode: 'support_goodwill', actorId: 'admin-1', idempotencyKey: 'k1', ruleVersion: RV }), 'IDEMPOTENCY_CONFLICT'));
    ok('el ajuste deja auditoría administrativa', db2.prepare("SELECT COUNT(*) n FROM gm_admin_audit WHERE action='adjustment' AND ref=?").get(adj.movementId).n === 1);
    ok('ajuste que dejaría saldo negativo ⇒ INSUFFICIENT_BALANCE', throwsCode(() => L.appendAdjustment(db2, { userId: 'u-lector-1', amount: -26, reasonCode: 'support', actorId: 'admin-1', idempotencyKey: 'k2', ruleVersion: RV }), 'INSUFFICIENT_BALANCE'));
    ok('compensación sin movimiento relacionado del mismo usuario ⇒ INVALID_RELATED_MOVEMENT', throwsCode(() => L.appendCompensation(db2, { userId: 'u-otro', amount: -5, reasonCode: 'fraud', actorId: 'admin-1', relatedMovementId: mv1, idempotencyKey: 'c1', ruleVersion: RV }), 'INVALID_RELATED_MOVEMENT'));
    const comp = L.appendCompensation(db2, { userId: 'u-lector-1', amount: -40, reasonCode: 'fraud_proven', actorId: 'admin-1', relatedMovementId: mv1, idempotencyKey: 'c1', ruleVersion: RV, now: tick() });
    ok('la compensación SÍ puede dejar saldo negativo (Contratos §5.4)', comp.inserted && L.getBalance(db2, 'u-lector-1').available === -15);
    ok('lifetime_earned no cambia por ajustes ni compensaciones', L.getBalance(db2, 'u-lector-1').lifetimeEarned === 20);
    ok('no existe primitiva de reserva ni de canje', !Object.keys(L).some((k) => /reserv|redeem|coupon|grant/i.test(k)));

    section('[7] triggers append-only y constraints a nivel SQL');
    for (const t of ['gm_rule_sets', 'gm_source_facts', 'gm_xp_entries', 'gm_pm_movements', 'gm_admin_audit']) {
        ok(`UPDATE en ${t} aborta`, throwsMsg(() => db2.prepare(`UPDATE ${t} SET rowid = rowid`).run(), /append-only/));
        ok(`DELETE en ${t} aborta`, throwsMsg(() => db2.prepare(`DELETE FROM ${t}`).run(), /append-only/));
    }
    ok('DELETE en gm_pm_balances aborta', throwsMsg(() => db2.prepare('DELETE FROM gm_pm_balances').run(), /never deleted/));
    const rawMv = (o) => db2.prepare(`INSERT INTO gm_pm_movements (movement_id,subject_ref,kind,amount,source,idempotency_key,fact_id,redemption_id,related_movement_id,reason_code,actor_ref,rule_version,period_day,period_week,created_at)
        VALUES (@id,'u-raw',@kind,@amount,'raw',@key,@fact,@red,@rel,'r',@actor,'${RV}','2026-10-29','2026-W44',1)`).run({ fact: null, red: null, rel: null, actor: 'system', ...o });
    ok('SQL: earn sin hecho ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r1', kind: 'earn', amount: 5, key: 'r1' }), /CHECK/));
    ok('SQL: earn negativo ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r2', kind: 'earn', amount: -5, key: 'r2', fact: results[0].factId }), /CHECK/));
    ok('SQL: reserve sin canje ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r3', kind: 'reserve', amount: -5, key: 'r3' }), /CHECK/));
    ok('SQL: adjustment por system ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r4', kind: 'adjustment', amount: 5, key: 'r4' }), /CHECK/));
    ok('SQL: kind desconocido ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r5', kind: 'set_balance', amount: 5, key: 'r5', actor: 'a' }), /CHECK/));
    ok('SQL: clave de idempotencia repetida ⇒ UNIQUE', throwsMsg(() => rawMv({ id: 'r6', kind: 'adjustment', amount: 5, key: `fact:${results[0].factId}`, actor: 'a' }), /UNIQUE/));
    ok('SQL: compensación con FK inexistente ⇒ FOREIGN KEY', throwsMsg(() => rawMv({ id: 'r7', kind: 'compensation', amount: -5, key: 'r7', rel: 'no-existe', actor: 'a' }), /FOREIGN KEY/));
    ok('SQL: XP negativo ⇒ CHECK', throwsMsg(() => db2.prepare(`INSERT INTO gm_xp_entries VALUES ('x1','u','award',-1,'${results[0].factId}',NULL,'${RV}',1)`).run(), /CHECK/));
    ok('SQL: fuente leo ⇒ CHECK', throwsMsg(() => db2.prepare(`INSERT INTO gm_source_facts VALUES ('f-l','leo','e','t','u',NULL,1,1,'C','awarded','${RV}','{}')`).run(), /CHECK/));
    db2.prepare(`INSERT INTO gm_redemptions VALUES ('red-1','u-raw','k','rw','digital_asset',100,'${RV}','RESERVED',1,1)`).run();
    ok('canje: RESERVED → CONFIRMED (salto) aborta', throwsMsg(() => db2.prepare("UPDATE gm_redemptions SET state='CONFIRMED' WHERE redemption_id='red-1'").run(), /illegal transition/));
    ok('canje: cambiar precio aborta', throwsMsg(() => db2.prepare("UPDATE gm_redemptions SET price_pm=1 WHERE redemption_id='red-1'").run(), /illegal transition/));
    db2.prepare("UPDATE gm_redemptions SET state='DELIVERED' WHERE redemption_id='red-1'").run();
    db2.prepare("UPDATE gm_redemptions SET state='CONFIRMED' WHERE redemption_id='red-1'").run();
    ok('canje: estado final inmutable', throwsMsg(() => db2.prepare("UPDATE gm_redemptions SET state='RELEASED' WHERE redemption_id='red-1'").run(), /illegal transition/));
    ok('canje: DELETE aborta', throwsMsg(() => db2.prepare('DELETE FROM gm_redemptions').run(), /never deleted/));

    section('[8] invariante snapshot = Σ ledger y reconstrucción');
    // Secuencia pseudoaleatoria determinista de hechos (montos de la regla, con topes),
    // ajustes y compensaciones para varios usuarios a lo largo de varios días.
    let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const users = ['u-a', 'u-b', 'u-c', 'u-d'];
    let tProp = Date.UTC(2026, 11, 1, 15);
    for (let i = 0; i < 300; i++) {
        const u = users[Math.floor(rnd() * users.length)];
        const r = rnd();
        tProp += Math.floor(rnd() * 4 * 3_600_000);
        try {
            if (r < 0.35) L.recordFact(db2, { ...fact({ userId: u, sourceEventId: `prop-${Math.floor(rnd() * 120)}-${u}` }), now: tProp }, { env: EARN });
            else if (r < 0.6) L.recordFact(db2, { source: 'mook_experience', sourceEventId: `pexp-${Math.floor(rnd() * 60)}-${u}`, factType: 'experience_completed', userId: u, occurredAt: tProp, eligibility: 'eligible', features: { experienceVersionId: 'xv-1' }, now: tProp }, { env: EARN });
            else if (r < 0.85) L.appendAdjustment(db2, { userId: u, amount: Math.floor(rnd() * 40) - 20 || 1, reasonCode: 'support', actorId: 'admin-1', idempotencyKey: `pa-${i}`, ruleVersion: RV, now: tProp });
            else {
                const last = db2.prepare('SELECT movement_id FROM gm_pm_movements WHERE subject_ref = (SELECT subject_ref FROM gm_subjects WHERE user_id = ?) ORDER BY seq DESC LIMIT 1').get(u);
                if (last) L.appendCompensation(db2, { userId: u, amount: -(1 + Math.floor(rnd() * 30)), reasonCode: 'correction', actorId: 'admin-1', relatedMovementId: last.movement_id, idempotencyKey: `pc-${i}`, ruleVersion: RV, now: tProp });
            }
        } catch (e) {
            if (!['INSUFFICIENT_BALANCE', 'IDEMPOTENCY_CONFLICT'].includes(e.code)) throw e;
        }
    }
    const v = L.verifyLedger(db2);
    ok(`snapshot = Σ ledger para ${v.users} usuarios tras 300 operaciones aleatorias`, v.ok, JSON.stringify(v.divergences).slice(0, 300));
    const over = db2.prepare(`SELECT subject_ref, period_day, SUM(amount) n FROM gm_pm_movements WHERE kind='earn' GROUP BY subject_ref, period_day HAVING n > ${CAPS.pmPerDay}`).all();
    const overW = db2.prepare(`SELECT subject_ref, period_week, SUM(amount) n FROM gm_pm_movements WHERE kind='earn' GROUP BY subject_ref, period_week HAVING n > ${CAPS.pmPerWeek}`).all();
    ok('ningún usuario excede los topes diario ni semanal en toda la secuencia', over.length === 0 && overW.length === 0, JSON.stringify([over, overW]));
    ok('ningún saldo negativo sin una compensación que lo explique', db2.prepare(`SELECT COUNT(*) n FROM gm_pm_balances b WHERE b.available < 0
        AND NOT EXISTS (SELECT 1 FROM gm_pm_movements m WHERE m.subject_ref = b.subject_ref AND m.kind = 'compensation')`).get().n === 0);
    const before = db2.prepare('SELECT subject_ref, available, reserved, lifetime_earned, last_seq FROM gm_pm_balances ORDER BY subject_ref').all();
    db2.prepare("UPDATE gm_pm_balances SET available = available + 777 WHERE subject_ref = (SELECT subject_ref FROM gm_subjects WHERE user_id = 'u-a')").run();
    ok('una alteración manual del snapshot se detecta', L.verifyLedger(db2).ok === false);
    L.rebuildBalances(db2);
    const after = db2.prepare('SELECT subject_ref, available, reserved, lifetime_earned, last_seq FROM gm_pm_balances ORDER BY subject_ref').all();
    ok('rebuildBalances restaura exactamente el snapshot derivado', JSON.stringify(after) === JSON.stringify(before) && L.verifyLedger(db2).ok);
    const page = L.listMovements(db2, 'u-lector-1', { limit: 2 });
    ok('listMovements pagina por seq y no expone datos de otros', page.length === 2 && page[0].seq < page[1].seq && L.listMovements(db2, 'u-lector-1', { afterSeq: page[1].seq }).every((m) => m.seq > page[1].seq));

    section('[9] periodos de topes en America/Bogota');
    ok('23:30 hora Bogotá sigue siendo el mismo día local', L.periodsFor(Date.UTC(2026, 9, 30, 4, 30)).day === '2026-10-29');
    ok('00:30 hora Bogotá ya es el día siguiente', L.periodsFor(Date.UTC(2026, 9, 30, 5, 30)).day === '2026-10-30');
    ok('semana ISO correcta (2026-10-29 ⇒ W44)', L.periodsFor(Date.UTC(2026, 9, 29, 15)).week === '2026-W44');
    ok('semana ISO en cambio de año (2027-01-01 ⇒ 2026-W53)', L.periodsFor(Date.UTC(2027, 0, 1, 15)).week === '2026-W53');

    section('[10] base corrupta o inaccesible: fallo seguro');
    D.closeGamificationDb({ resetBackoff: true });
    const BAD = path.join(tmp, 'corrupt', 'gamification.db');
    fs.mkdirSync(path.dirname(BAD), { recursive: true });
    fs.writeFileSync(BAD, Buffer.alloc(8192, 0x5a));
    process.env.GAMIFICATION_DB = BAD;
    ok('base corrupta ⇒ GAMIFICATION_DB_UNAVAILABLE', throwsCode(() => D.getGamificationDb({ now: 1 }), 'GAMIFICATION_DB_UNAVAILABLE'));
    ok('durante el backoff no se reintenta (mismo código, sin tocar disco)', throwsCode(() => D.getGamificationDb({ now: 2 }), 'GAMIFICATION_DB_UNAVAILABLE'));
    const s1 = D.safely(() => 1);
    ok('safely nunca lanza: { ok:false, code }', s1.ok === false && s1.code === 'GAMIFICATION_DB_UNAVAILABLE');
    ok('el archivo corrupto no fue sobrescrito', fs.readFileSync(BAD).every((b) => b === 0x5a));
    D.closeGamificationDb({ resetBackoff: true });
    const DIR_AS_FILE = path.join(tmp, 'blocked');
    fs.writeFileSync(DIR_AS_FILE, 'x');
    process.env.GAMIFICATION_DB = path.join(DIR_AS_FILE, 'gamification.db');
    ok('ruta inaccesible (directorio que es archivo) ⇒ GAMIFICATION_DB_UNAVAILABLE', throwsCode(() => D.getGamificationDb({ now: 1 }), 'GAMIFICATION_DB_UNAVAILABLE'));
    D.closeGamificationDb({ resetBackoff: true });
    process.env.GAMIFICATION_DB = DB_PATH;

    section('[11] aislamiento estructural');
    const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
    const modFiles = fs.readdirSync(path.join(HERE, '..')).filter((f) => f.endsWith('.mjs') || f.endsWith('.js'));
    const modSrc = modFiles.map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8')).join('\n');
    ok('server/gamification no importa server/royalties', !/from\s+['"][^'"]*royalties/.test(modSrc));
    ok('server/gamification no menciona econ_events, royalties.db ni access_db', !/econ_events|royalties\.db|access_db/.test(modSrc));
    const srcOf = (f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8');
    const nonLockSrc = modFiles.filter((f) => f !== 'mookSource.mjs').map(srcOf).join('\n');
    ok('server/gamification no escribe archivos (salvo el lock del reconciliador)', !/writeFile|appendFile|rename|unlink|rmSync|copyFile|openSync/.test(nonLockSrc));
    ok('mookSource solo escribe/borra su lock `<base>.reconcile.lock`', /const lockFile = `\$\{dbPath\}\.reconcile\.lock`/.test(srcOf('mookSource.mjs'))
        && !/writeFile|appendFile|rename|rmSync|copyFile/.test(srcOf('mookSource.mjs')));
    ok('server/gamification no registra rutas HTTP', !/app\.(get|post|put|delete|use)\s*\(|express\.Router/.test(modSrc));
    // Imports y lecturas reales, no menciones en comentarios: readingValidator
    // documenta que sus lectores (eventsService/progressService) se le INYECTAN.
    ok('server/gamification no importa ni lee stores de producto (las fuentes se le pasan)',
        !/readFileSync|from\s+['"][^'"]*(progressService|experienceStore|eventsService)[^'"]*['"]|USERS_DB|mook_db\.json/.test(modSrc));
    const serverSrc = read('server/server.js');
    ok('server.js importa del motor SOLO mookSource.mjs', (serverSrc.match(/from '\.\/gamification\/[^']+'/g) || []).join() === "from './gamification/mookSource.mjs'");
    ok('server.js engancha solo revisión MOOK, experiencia completada y el reconciliador', (serverSrc.match(/gamificationMook\.\w+/g) || []).sort().join() === 'gamificationMook.makeResolveUser,gamificationMook.onMookEvidenceReviewed,gamificationMook.onMookRunUpdated,gamificationMook.startMookReconciler');
    ok('el gancho de revisión va DESPUÉS de res.json', /res\.json\(\{ id: ev\.id, review: ev\.review \}\);\s*\n\s*\/\/[^\n]*\n\s*gamificationMook\.onMookEvidenceReviewed/.test(serverSrc));
    ok('ni lectura, ni progreso, ni Leo, ni acceso enganchados al motor', !/scheduleFact|recordFact|reading_completion/.test(serverSrc));
    ok('progressService no depende del motor', !/gamification/.test(read('server/progressService.js')));
    ok('experienceStore (MOOK) no depende del motor', !/gamification/.test(read('server/lib/experienceStore.js')));
    ok('leoOrchestrator no depende del motor', !/server\/gamification|\.\/gamification/.test(read('server/leoOrchestrator.js')));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCHP-GAMIFICACION-G3 (núcleo) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
