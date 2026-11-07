/**
 * ledgerCore.test.mjs — CHP-GAMIFICACION-G3-01 / G3-02.
 *
 * Núcleo persistente sobre una gamification.db TEMPORAL (GAMIFICATION_DB):
 * flag OFF sin archivo, migración idempotente, reglas versionadas y
 * validadas, política de emisión (el llamador nunca fija montos), idempotencia
 * (100 repeticiones), XP acumulativo sin topes de PM, constraints y triggers,
 * base corrupta con fallo seguro y aislamiento estructural (sin regalías).
 *
 * V8-UNIFIED-XP-01: los Puntos de Magia están retirados. Aquí se prueba que no
 * existen como moneda activa (ni flag, ni reglas, ni primitivas, ni filas nuevas)
 * y que un conjunto de reglas HISTÓRICO con `pm`/`caps` sigue leyéndose y solo
 * emite XP.
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/ledgerCore.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
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
const EARN = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1' };
// Regla válida SIN campos de PM (V8-UNIFIED-XP-01): solo XP.
const RULES = { schema: 1, facts: {
    'mission/mission_completed': { xp: 30 }, // hecho sintético
    'mook_review/evidence_reviewed': {},
    'mook_experience/experience_completed': { xp: 20 },
} };
const pmRows = (db) => ['gm_pm_movements', 'gm_pm_balances', 'gm_redemptions'].reduce((n, t) => n + db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0);
const T0 = Date.UTC(2026, 9, 29, 15, 0, 0);
let seqTime = T0;
const tick = () => (seqTime += 1000);

try {
    section('[1] flag OFF: ni archivo ni migración');
    ok('importar los módulos no crea la base', !fs.existsSync(DB_PATH) && !fs.existsSync(path.dirname(DB_PATH)));
    ok('flag ausente ⇒ OFF', D.isGamificationEnabled({}) === false);
    for (const v of ['0', 'false', 'off', 'yes', ' ', 'TRUEISH']) ok(`GAMIFICATION_ENABLED='${v}' ⇒ OFF`, D.isGamificationEnabled({ GAMIFICATION_ENABLED: v }) === false);
    ok("'1' y 'true' ⇒ ON", D.isGamificationEnabled({ GAMIFICATION_ENABLED: '1' }) && D.isGamificationEnabled({ GAMIFICATION_ENABLED: 'TRUE' }));
    ok('PM retirado: db.mjs ya no expone el flag de PM', !('isEarningEnabled' in D));
    ok('XP_EARNING_ENABLED sin el padre ⇒ OFF', D.isXpEarningEnabled({ XP_EARNING_ENABLED: '1' }) === false && D.isXpEarningEnabled(EARN) === true);
    ok('PM_EARNING_ENABLED no enciende nada', D.isXpEarningEnabled({ GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1' }) === false);
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
    ok('tres migraciones registradas', JSON.stringify(db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version)) === '["0001_ledger","0002_subject_model","0003_work_cycle_acts"]');
    ok('la segunda apertura devuelve la misma conexión', D.getGamificationDb() === db);
    D.closeGamificationDb();
    const db2 = D.getGamificationDb();
    ok('reabrir no reaplica (siguen 3 migraciones)', db2.prepare('SELECT COUNT(*) n FROM _migrations').get().n === 3);
    const { runMigrations } = await import('../../db/migrate.js');
    const again = runMigrations(db2, () => {}, { dir: path.join(HERE, '..', 'migrations'), tag: 't' });
    ok('runMigrations explícito sobre una base migrada es no-op', again.applied.length === 0 && again.already.length === 3);

    section('[3] reglas versionadas (validadas, append-only, prospectivas)');
    ok('sin reglas vigentes ⇒ NO_ACTIVE_RULES', throwsCode(() => L.recordFact(db2, { source: 'mission', sourceEventId: 'ev-0', factType: 'mission_completed', userId: 'u-x', occurredAt: T0, eligibility: 'eligible', now: T0 }, { env: EARN }), 'NO_ACTIVE_RULES'));
    ok('regla válida sin campos de PM ⇒ se crea', L.createRuleSet(db2, { ruleVersion: RV, rules: RULES, createdBy: 'migration', now: T0 }).created === true);
    ok('mismo contenido ⇒ idempotente', L.createRuleSet(db2, { ruleVersion: RV, rules: RULES, createdBy: 'migration', now: T0 }).created === false);
    ok('mismo id con otro contenido ⇒ IDEMPOTENCY_CONFLICT', throwsCode(() => L.createRuleSet(db2, { ruleVersion: RV, rules: { ...RULES, facts: { 'mission/mission_completed': { xp: 1 } } }, createdBy: 'migration', now: T0 }), 'IDEMPOTENCY_CONFLICT'));
    ok('reglas retroactivas ⇒ RETROACTIVE_RULES', throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-test-v0', rules: RULES, createdBy: 'migration', effectiveFrom: T0 - 1, now: T0 }), 'RETROACTIVE_RULES'));
    const badRules = [
        ['grado configurable', { schema: 1, facts: { 'mission/mission_completed': { xp: 1, grade: 'A' } } }],
        ['fuente leo', { schema: 1, facts: { 'leo/answer': { xp: 1 } } }],
        ['monto fuera de cota', { schema: 1, facts: { 'mission/mission_completed': { xp: 99999 } } }],
        ['emitWhen con feature no admitida', { schema: 1, facts: { 'mission/mission_completed': { xp: 1, emitWhen: { feedback: ['x'] } } } }],
        ['clave raíz desconocida', { schema: 1, facts: {}, bonus: 5 }],
    ];
    for (const [l, r] of badRules) ok(`regla inválida (${l}) ⇒ INVALID_RULES`, throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-bad', rules: r, createdBy: 'migration', now: T0 }), 'INVALID_RULES'));
    const retired = [
        ['topes de PM (caps)', { schema: 1, facts: {}, caps: { pmPerDay: 10, pmPerWeek: 50 } }],
        ['pm en una regla, aunque sea 0', { schema: 1, facts: { 'mission/mission_completed': { xp: 1, pm: 0 } } }],
        ['pm positivo', { schema: 1, facts: { 'mission/mission_completed': { xp: 1, pm: 5 } } }],
    ];
    for (const [l, r] of retired) ok(`PM retirado (${l}) ⇒ PM_RETIRED`, throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-bad', rules: r, createdBy: 'migration', now: T0 }), 'PM_RETIRED'));
    ok('regla que haría emitir a la lectura ⇒ READING_EMISSION_LOCKED', throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-bad', rules: { schema: 1, facts: { 'reading_completion/reading_completed': { xp: 5 } } }, createdBy: 'migration', now: T0 }), 'READING_EMISSION_LOCKED'));
    ok('ninguna regla inválida quedó registrada', db2.prepare("SELECT COUNT(*) n FROM gm_rule_sets WHERE rule_version='gm-bad'").get().n === 0);

    const fact = (over = {}) => ({ source: 'mission', sourceEventId: 'ev-1', factType: 'mission_completed', userId: 'u-lector-1',
        actorId: 'u-mediador-1', occurredAt: T0, eligibility: 'eligible', ...over });
    const rec = (over = {}, env = EARN) => L.recordFact(db2, { now: tick(), ...fact(over) }, { env });

    section('[4] idempotencia: 100 repeticiones del mismo hecho');
    const results = [];
    for (let i = 0; i < 100; i++) results.push(rec());
    ok('solo la primera inserta', results.filter((r) => r.inserted).length === 1 && results[0].inserted);
    ok('las 100 devuelven el mismo factId y XP', new Set(results.map((r) => r.factId)).size === 1 && results.every((r) => r.xp === 30));
    ok('el resultado no tiene campos de PM', results.every((r) => !('pm' in r) && !('movementId' in r)));
    ok('1 hecho, 1 asiento XP y NINGUNA fila de PM en la base', db2.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 1
        && db2.prepare('SELECT COUNT(*) n FROM gm_xp_entries').get().n === 1 && pmRows(db2) === 0);
    ok('XP = 30 (monto de la regla, no del llamador)', L.getXp(db2, 'u-lector-1') === 30);
    ok('el hecho quedó con grado B (fijo por fuente) y la rule_version vigente', (() => { const r = db2.prepare('SELECT grade, rule_version FROM gm_source_facts').get(); return r.grade === 'B' && r.rule_version === RV; })());
    ok('mismo id de fuente con otro sujeto ⇒ hecho propio: las claves no se cruzan entre sujetos', rec({ userId: 'u-otro' }).inserted === true);

    section('[5] el llamador no fija montos; decisiones sin emisión');
    for (const k of ['xp', 'pm', 'amount', 'grade', 'decision', 'ruleVersion']) {
        ok(`campo «${k}» del llamador ⇒ CALLER_FIELD_NOT_ALLOWED`, throwsCode(() => L.recordFact(db2, { ...fact({ sourceEventId: `ev-f-${k}` }), [k]: k === 'grade' ? 'A' : 999 }, { env: EARN }), 'CALLER_FIELD_NOT_ALLOWED'));
    }
    const obs = rec({ sourceEventId: 'ev-obs', eligibility: 'observe' });
    ok('observe ⇒ observed, sin emisión ni fila', !obs.persisted && obs.factId === null && obs.decision === 'observed' && obs.xp === 0);
    const cc = rec({ source: 'mook_review', factType: 'evidence_reviewed', sourceEventId: 'ev-cc' });
    ok('revisión MOOK ⇒ observed, sin emisión', cc.decision === 'observed' && cc.xp === 0 && !cc.persisted);
    const self = rec({ sourceEventId: 'ev-self', actorId: 'u-lector-1' });
    ok('autorrevisión declarada elegible ⇒ rejected_self_review, sin emisión', self.decision === 'rejected_self_review' && self.xp === 0);
    const rd = rec({ source: 'reading_completion', sourceEventId: 'u:c:w1', factType: 'reading_completed', features: { verdict: 'plausible' } });
    ok('lectura terminada elegible ⇒ observed (bloqueada), sin fila', rd.decision === 'observed' && rd.xp === 0 && !rd.persisted);
    const nr = rec({ sourceEventId: 'ev-norule', factType: 'otro_tipo' });
    ok('hecho sin regla ⇒ rejected_not_eligible', nr.decision === 'rejected_not_eligible' && nr.xp === 0);
    const syn = rec({ sourceEventId: 'ev-syn', eligibility: 'rejected_excluded_user' });
    ok('rechazo declarado por el adaptador se registra tal cual', syn.decision === 'rejected_excluded_user' && syn.xp === 0);
    const offE = rec({ sourceEventId: 'ev-off' }, { GAMIFICATION_ENABLED: '1' });
    ok('XP_EARNING_ENABLED ausente ⇒ disabled_source, sin emisión', offE.decision === 'disabled_source' && offE.xp === 0 && !offE.persisted);
    const offE2 = rec({ sourceEventId: 'ev-off2' }, { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1' });
    ok('solo PM_EARNING_ENABLED (retirado) ⇒ disabled_source, sin fila', offE2.decision === 'disabled_source' && !offE2.persisted);
    ok('elegibilidad desconocida ⇒ INVALID_ELIGIBILITY', throwsCode(() => rec({ sourceEventId: 'ev-x1', eligibility: 'awarded' }), 'INVALID_ELIGIBILITY'));
    ok('fuente leo ⇒ UNKNOWN_SOURCE', throwsCode(() => rec({ source: 'leo', sourceEventId: 'ev-x5' }), 'UNKNOWN_SOURCE'));
    ok('fuente royalties ⇒ UNKNOWN_SOURCE', throwsCode(() => rec({ source: 'royalties_qrs', sourceEventId: 'ev-x6' }), 'UNKNOWN_SOURCE'));
    ok('features con texto libre no admitido ⇒ INVALID_FEATURES', throwsCode(() => rec({ source: 'mook_review', factType: 'evidence_reviewed', sourceEventId: 'ev-x7', features: { feedback: 'muy bien' } }), 'INVALID_FEATURES'));
    ok('features con string largo ⇒ INVALID_FEATURES', throwsCode(() => rec({ source: 'mook_review', factType: 'evidence_reviewed', sourceEventId: 'ev-x8', features: { decision: 'x'.repeat(65) } }), 'INVALID_FEATURES'));
    ok('id con caracteres inválidos ⇒ INVALID_FACT', throwsCode(() => rec({ sourceEventId: 'ev 13 ; DROP' }), 'INVALID_FACT'));
    ok('ninguna operación rechazada dejó filas', db2.prepare("SELECT COUNT(*) n FROM gm_source_facts WHERE source_event_id LIKE 'ev-x%' OR source_event_id LIKE 'ev-f-%'").get().n === 0);

    section('[5b] XP acumulativo: sin topes de PM ni decisión «capped»');
    const DAY1 = Date.UTC(2026, 10, 2, 15); // lunes 2026-11-02, 10:00 Bogotá
    const capRec = (id, at) => L.recordFact(db2, { ...fact({ userId: 'u-cap', sourceEventId: id }), now: at }, { env: EARN });
    const c = [0, 1, 2, 3].map((i) => capRec(`cap-${i}`, DAY1 + i * 1000));
    ok('cuatro hechos el mismo día ⇒ 30 XP cada uno, todos «awarded»', c.every((r) => r.xp === 30 && r.decision === 'awarded'));
    ok('el XP se acumula (4 × 30 = 120)', L.getXp(db2, 'u-cap') === 120);
    ok('ninguna fila de PM escrita', pmRows(db2) === 0);
    ok('23:59 del domingo en Bogotá (04:59Z del lunes) sigue en la semana anterior', L.periodsFor(Date.UTC(2026, 10, 9, 4, 59)).week === '2026-W45');

    section('[5c] cambio de reglas prospectivo (D48)');
    L.createRuleSet(db2, { ruleVersion: 'gm-test-v2', rules: { ...RULES, facts: { ...RULES.facts, 'mission/mission_completed': { xp: 45 } } }, createdBy: 'admin-1', effectiveFrom: T0 + 30 * 86_400_000, now: T0 });
    ok('antes de entrar en vigor rige la versión anterior', L.getActiveRuleSet(db2, T0 + 5).ruleVersion === RV);
    const v2 = L.recordFact(db2, { ...fact({ userId: 'u-v2', sourceEventId: 'ev-v2', occurredAt: T0 + 31 * 86_400_000 }), now: T0 + 31 * 86_400_000 }, { env: EARN });
    ok('después rige la nueva y el hecho guarda su rule_version', v2.xp === 45 && db2.prepare('SELECT rule_version FROM gm_source_facts WHERE fact_id=?').get(v2.factId).rule_version === 'gm-test-v2');
    ok('los hechos anteriores conservan su versión y su monto', db2.prepare('SELECT rule_version FROM gm_source_facts WHERE fact_id=?').get(results[0].factId).rule_version === RV && L.getXp(db2, 'u-lector-1') === 30);

    section('[6] PM inexistente como moneda activa');
    for (const k of ['getBalance', 'listMovements', 'appendAdjustment', 'appendCompensation', 'extinguishSubject', 'verifyLedger', 'rebuildBalances']) {
        ok(`ledger ya no exporta ${k}`, !(k in L));
    }
    ok('ninguna primitiva de saldo, movimiento, ajuste, reserva, canje ni PM', !Object.keys(L).some((k) => /balance|movement|adjust|compens|reserv|redeem|coupon|grant|\bpm|Pm/i.test(k)), Object.keys(L).join(','));
    ok('tras todas las emisiones anteriores no hay ninguna fila de PM', pmRows(db2) === 0);

    section('[7] triggers append-only y constraints a nivel SQL (incluidas las tablas HISTÓRICAS de PM)');
    // Filas históricas sintéticas: el esquema de PM se conserva para no corromper
    // bases antiguas, y sus protecciones siguen vigentes sobre esas filas.
    const rawMv = (o) => db2.prepare(`INSERT INTO gm_pm_movements (movement_id,subject_ref,kind,amount,source,idempotency_key,fact_id,redemption_id,related_movement_id,reason_code,actor_ref,rule_version,period_day,period_week,created_at)
        VALUES (@id,'u-raw',@kind,@amount,'raw',@key,@fact,@red,@rel,'r',@actor,'${RV}','2026-10-29','2026-W44',1)`).run({ fact: null, red: null, rel: null, actor: 'system', ...o });
    rawMv({ id: 'r6a', kind: 'adjustment', amount: 5, key: 'dup-key', actor: 'a' });
    db2.prepare("INSERT INTO gm_pm_balances VALUES ('u-raw', 5, 0, 0, 1, 1)").run();
    db2.prepare("INSERT INTO gm_admin_audit VALUES ('aud-raw', 'a', 'adjustment', 'u-raw', 'r6a', 1)").run();
    for (const t of ['gm_rule_sets', 'gm_source_facts', 'gm_xp_entries', 'gm_pm_movements', 'gm_admin_audit']) {
        ok(`UPDATE en ${t} aborta`, throwsMsg(() => db2.prepare(`UPDATE ${t} SET rowid = rowid`).run(), /append-only/));
        ok(`DELETE en ${t} aborta`, throwsMsg(() => db2.prepare(`DELETE FROM ${t}`).run(), /append-only/));
    }
    ok('DELETE en gm_pm_balances aborta', throwsMsg(() => db2.prepare('DELETE FROM gm_pm_balances').run(), /never deleted/));
    ok('SQL: earn sin hecho ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r1', kind: 'earn', amount: 5, key: 'r1' }), /CHECK/));
    ok('SQL: earn negativo ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r2', kind: 'earn', amount: -5, key: 'r2', fact: results[0].factId }), /CHECK/));
    ok('SQL: reserve sin canje ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r3', kind: 'reserve', amount: -5, key: 'r3' }), /CHECK/));
    ok('SQL: adjustment por system ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r4', kind: 'adjustment', amount: 5, key: 'r4' }), /CHECK/));
    ok('SQL: kind desconocido ⇒ CHECK', throwsMsg(() => rawMv({ id: 'r5', kind: 'set_balance', amount: 5, key: 'r5', actor: 'a' }), /CHECK/));
    ok('SQL: clave de idempotencia repetida ⇒ UNIQUE', throwsMsg(() => rawMv({ id: 'r6', kind: 'adjustment', amount: 5, key: 'dup-key', actor: 'a' }), /UNIQUE/));
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

    section('[8] invariante XP: total = Σ asientos, uno por hecho, sin PM');
    // Secuencia pseudoaleatoria determinista de hechos (montos de la regla) para
    // varios usuarios a lo largo de varios días, con reintentos.
    let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const users = ['u-a', 'u-b', 'u-c', 'u-d'];
    let tProp = Date.UTC(2026, 11, 1, 15);
    for (let i = 0; i < 300; i++) {
        const u = users[Math.floor(rnd() * users.length)];
        tProp += Math.floor(rnd() * 4 * 3_600_000);
        if (rnd() < 0.6) L.recordFact(db2, { ...fact({ userId: u, sourceEventId: `prop-${Math.floor(rnd() * 120)}-${u}` }), now: tProp }, { env: EARN });
        else L.recordFact(db2, { source: 'mook_experience', sourceEventId: `pexp-${Math.floor(rnd() * 60)}-${u}`, factType: 'experience_completed', userId: u, occurredAt: tProp, eligibility: 'eligible', now: tProp }, { env: EARN });
    }
    const perUser = users.map((u) => {
        const ref = db2.prepare('SELECT subject_ref FROM gm_subjects WHERE user_id = ?').get(u)?.subject_ref ?? '';
        const facts = db2.prepare('SELECT COUNT(*) n FROM gm_source_facts WHERE subject_ref = ?').get(ref).n;
        const entries = db2.prepare("SELECT COUNT(*) n, COALESCE(SUM(xp),0) xp FROM gm_xp_entries WHERE subject_ref = ? AND kind = 'award'").get(ref);
        return { u, facts, entries: entries.n, sum: entries.xp, total: L.getXp(db2, u) };
    });
    ok('getXp = Σ asientos para cada usuario tras 300 operaciones', perUser.every((r) => r.total === r.sum && r.total > 0), JSON.stringify(perUser));
    ok('exactamente un asiento de XP por hecho (reintentos sin duplicar)', perUser.every((r) => r.facts === r.entries));
    ok('ninguna fila de PM escrita por el motor (solo las sintéticas de [7])', db2.prepare("SELECT COUNT(*) n FROM gm_pm_movements WHERE subject_ref <> 'u-raw'").get().n === 0
        && db2.prepare("SELECT COUNT(*) n FROM gm_pm_balances WHERE subject_ref <> 'u-raw'").get().n === 0);

    section('[8b] compatibilidad no destructiva con reglas HISTÓRICAS con PM');
    // Conjunto guardado antes de V8-UNIFIED-XP-01 (con pm y caps): se inserta tal cual,
    // sin pasar por createRuleSet, como lo dejaría una base antigua.
    const HIST = { schema: 1, caps: { pmPerDay: 5, pmPerWeek: 10 }, facts: { 'mission/mission_completed': { xp: 12, pm: 99 } } };
    const histAt = Date.UTC(2027, 1, 1, 15);
    db2.prepare('INSERT INTO gm_rule_sets VALUES (?, ?, ?, ?, ?, ?)').run('gm-hist-pm', histAt - 10, 'migration', JSON.stringify(HIST), 'h'.repeat(64), histAt);
    ok('el conjunto histórico se lee como vigente', L.getActiveRuleSet(db2, histAt + 1).ruleVersion === 'gm-hist-pm');
    const hist = [0, 1].map((i) => L.recordFact(db2, { ...fact({ userId: 'u-hist', sourceEventId: `hist-${i}`, occurredAt: histAt + i }), now: histAt + i }, { env: EARN }));
    ok('con reglas históricas solo se emite XP (12 + 12), sin topes ni «capped»', hist.every((r) => r.xp === 12 && r.decision === 'awarded') && L.getXp(db2, 'u-hist') === 24);
    ok('el pm histórico se ignora: ninguna fila de PM nueva', db2.prepare("SELECT COUNT(*) n FROM gm_pm_movements WHERE subject_ref <> 'u-raw'").get().n === 0);
    ok('las filas históricas de PM siguen intactas (no se borran)', db2.prepare("SELECT COUNT(*) n FROM gm_pm_movements WHERE subject_ref = 'u-raw'").get().n === 1
        && db2.prepare("SELECT COUNT(*) n FROM gm_redemptions WHERE redemption_id = 'red-1'").get().n === 1);
    ok('los hechos anteriores conservan su XP', L.getXp(db2, 'u-lector-1') === 30);

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
    const nonLockSrc = modFiles.filter((f) => !['mookSource.mjs', 'exclusions.mjs'].includes(f)).map(srcOf).join('\n');
    ok('server/gamification no escribe archivos (salvo el lock del reconciliador y el registro de exclusiones)', !/writeFile|appendFile|renameSync|unlinkSync|rmSync|copyFile|openSync/.test(nonLockSrc));
    ok('el registro de exclusiones solo añade: no renombra, trunca ni borra', /openSync\(p, 'a'\)/.test(srcOf('exclusions.mjs')) && !/writeFile|rename|unlink|rmSync|truncate|copyFile/.test(srcOf('exclusions.mjs')));
    ok('mookSource solo escribe/borra su lock `<base>.reconcile.lock`', /const lockFile = `\$\{dbPath\}\.reconcile\.lock`/.test(srcOf('mookSource.mjs'))
        && !/writeFile|appendFile|rmSync|copyFile|truncate|cpSync/.test(srcOf('mookSource.mjs')));
    // G4-PERF-01B-LOCK-FINAL: la ÚNICA operación de movimiento autorizada es la
    // liberación atómica del lock: `rename` del lock a su nombre de liberación
    // (`<lock>.<testigo>.release`) y, si lo apartado era ajeno, `link` de vuelta
    // (nunca sobrescribe). Ningún otro rename/link/unlink, ni sobre otras rutas.
    {
        const ms = srcOf('mookSource.mjs');
        const code = ms.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/;\s*\/\/.*$/gm, ';');
        const calls = (re) => code.match(re) ?? [];
        const lockRegion = code.match(/function tryLock[\s\S]*?let lockRaceHook/)?.[0] ?? '';
        ok('mookSource: un solo rename, del lock a su nombre de liberación',
            calls(/\brename\w*\s*\(/g).length === 1 && calls(/\bfs\.renameSync\(lockFile, aside\)/g).length === 1
            && calls(/\bconst aside = `\$\{lockFile\}\.\$\{token\.replace\(\/\[\^0-9A-Za-z-\]\/g, '-'\)\}\.release`;/g).length === 1);
        ok('mookSource: un solo link, de vuelta a la ruta del lock (sin sobrescribir)',
            calls(/\b(link|symlink)\w*\s*\(/g).length === 1 && calls(/\bfs\.linkSync\(aside, lockFile\)/g).length === 1);
        ok('mookSource: unlink solo sobre el lock o su nombre de liberación',
            calls(/\bunlinkSync\(/g).length === 2 && calls(/\bunlinkSync\([^)]*\)/g).every((c) => /^unlinkSync\((lockFile|aside)\)$/.test(c)));
        ok('mookSource: la liberación solo recibe el lock del plan',
            calls(/\bunlock\([^)]*\)/g).length >= 1 && calls(/\bunlock\([^)]*\)/g).every((c) => c === 'unlock(plan.lockFile, token)'));
        ok('mookSource: rename/link/unlink solo dentro del código del lock',
            lockRegion.length > 0 && !/\b(rename|link|unlink)\w*\s*\(/.test(code.replace(lockRegion, '')));
        ok('mookSource: el código del lock no nombra stores, padrones, uploads ni respaldos',
            lockRegion.length > 0 && !/data-critical|data\/|mook_db|usuarios_|users_db|\.json|\.db['"`]|uploads|backup|restic/i.test(lockRegion));
    }
    ok('server/gamification no registra rutas HTTP', !/app\.(get|post|put|delete|use)\s*\(|express\.Router/.test(modSrc));
    // Imports y lecturas reales, no menciones en comentarios: readingValidator
    // documenta que sus lectores (eventsService/progressService) se le INYECTAN.
    ok('server/gamification no importa ni lee stores de producto (las fuentes se le pasan)',
        !/readFileSync|from\s+['"][^'"]*(progressService|experienceStore|eventsService)[^'"]*['"]|USERS_DB|mook_db\.json/.test(modFiles.filter((f) => f !== 'exclusions.mjs').map(srcOf).join('\n')));
    const serverSrc = read('server/server.js');
    ok('server.js importa del motor SOLO mookSource.mjs', (serverSrc.match(/from '\.\/gamification\/[^']+'/g) || []).join() === "from './gamification/mookSource.mjs'");
    ok('server.js engancha solo revisión MOOK, experiencia completada, el reconciliador, el progreso propio (U2), los agregados de grupo (U4) y el progreso individual del mediador (V8-UNIFIED-XP-01)', [...new Set(serverSrc.match(/gamificationMook\.\w+/g) || [])].sort().join() === 'gamificationMook.isStudentProgressReadable,gamificationMook.makeResolveUser,gamificationMook.onMookEvidenceReviewed,gamificationMook.onMookRunUpdated,gamificationMook.readGroupRecognition,gamificationMook.readMyProgress,gamificationMook.readStudentProgress,gamificationMook.startMookReconciler');
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
