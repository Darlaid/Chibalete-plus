/**
 * ledgerCore.test.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Núcleo persistente sobre una gamification.db TEMPORAL (GAMIFICATION_DB):
 * flag OFF sin archivo, migración idempotente, constraints y triggers,
 * idempotencia (100 repeticiones), invariante snapshot = Σ ledger, operaciones
 * rechazadas, base corrupta con fallo seguro y aislamiento estructural
 * (sin ganchos, sin regalías). Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/ledgerCore.test.mjs
 */
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

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const RV = 'gm-test-v1';
const T0 = Date.UTC(2026, 9, 29, 15, 0, 0);
let seqTime = T0;
const tick = () => (seqTime += 1000);

try {
    section('[1] flag OFF: ni archivo ni migración');
    ok('importar los módulos no crea la base', !fs.existsSync(DB_PATH) && !fs.existsSync(path.dirname(DB_PATH)));
    ok('flag ausente ⇒ OFF', D.isGamificationEnabled({}) === false);
    for (const v of ['0', 'false', 'off', 'yes', ' ', 'TRUEISH']) ok(`GAMIFICATION_ENABLED='${v}' ⇒ OFF`, D.isGamificationEnabled({ GAMIFICATION_ENABLED: v }) === false);
    ok("'1' y 'true' ⇒ ON", D.isGamificationEnabled({ GAMIFICATION_ENABLED: '1' }) && D.isGamificationEnabled({ GAMIFICATION_ENABLED: 'TRUE' }));
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
    ok('exactamente las 10 tablas gm_ del modelo', JSON.stringify(tables) === JSON.stringify(['gm_achievements', 'gm_admin_audit', 'gm_pm_balances', 'gm_pm_movements', 'gm_redemption_transitions', 'gm_redemptions', 'gm_reward_grants', 'gm_rule_sets', 'gm_source_facts', 'gm_xp_entries']), tables.join(','));
    const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    ok('sin tablas auxiliares (solo _migrations y sqlite_sequence)', allTables.filter((t) => !t.startsWith('gm_')).join(',') === '_migrations,sqlite_sequence', allTables.join(','));
    ok('una migración registrada (0001_ledger)', JSON.stringify(db.prepare('SELECT version FROM _migrations').all().map((r) => r.version)) === '["0001_ledger"]');
    ok('la segunda apertura devuelve la misma conexión', D.getGamificationDb() === db);
    D.closeGamificationDb();
    const db2 = D.getGamificationDb();
    ok('reabrir no reaplica (sigue 1 migración)', db2.prepare('SELECT COUNT(*) n FROM _migrations').get().n === 1);
    const { runMigrations } = await import('../../db/migrate.js');
    const again = runMigrations(db2, () => {}, { dir: path.join(HERE, '..', 'migrations'), tag: 't' });
    ok('runMigrations explícito sobre una base migrada es no-op', again.applied.length === 0 && again.already.length === 1);

    section('[3] reglas versionadas (append-only, prospectivas)');
    ok('crear rule set', L.createRuleSet(db2, { ruleVersion: RV, rules: { pm: { mook_review: 20 } }, createdBy: 'migration', now: T0 }).created === true);
    ok('mismo contenido ⇒ idempotente', L.createRuleSet(db2, { ruleVersion: RV, rules: { pm: { mook_review: 20 } }, createdBy: 'migration', now: T0 }).created === false);
    ok('mismo id con otro contenido ⇒ IDEMPOTENCY_CONFLICT', throwsCode(() => L.createRuleSet(db2, { ruleVersion: RV, rules: { pm: { mook_review: 99 } }, createdBy: 'migration', now: T0 }), 'IDEMPOTENCY_CONFLICT'));
    ok('reglas retroactivas ⇒ RETROACTIVE_RULES', throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-test-v0', rules: {}, createdBy: 'migration', effectiveFrom: T0 - 1, now: T0 }), 'RETROACTIVE_RULES'));

    const fact = (over = {}) => ({ source: 'mook_review', sourceEventId: 'ev-1', factType: 'evidence_reviewed', userId: 'u-lector-1',
        actorId: 'u-mediador-1', occurredAt: T0, grade: 'A', decision: 'awarded', ruleVersion: RV,
        features: { experienceVersionId: 'xv-1', decision: 'aprobado', reviewerIsSelf: false }, xp: 30, pm: { amount: 20, reasonCode: 'mook_approved' }, ...over });

    section('[4] idempotencia: 100 repeticiones del mismo hecho');
    const results = [];
    for (let i = 0; i < 100; i++) results.push(L.recordFact(db2, { ...fact(), now: tick() }));
    ok('solo la primera inserta', results.filter((r) => r.inserted).length === 1 && results[0].inserted);
    ok('las 100 devuelven el mismo factId y movimiento', new Set(results.map((r) => r.factId)).size === 1 && new Set(results.map((r) => r.movementId)).size === 1);
    ok('1 hecho, 1 asiento XP y 1 movimiento PM en la base', db2.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 1
        && db2.prepare('SELECT COUNT(*) n FROM gm_xp_entries').get().n === 1 && db2.prepare('SELECT COUNT(*) n FROM gm_pm_movements').get().n === 1);
    ok('saldo = 20 y XP = 30', L.getBalance(db2, 'u-lector-1').available === 20 && L.getXp(db2, 'u-lector-1') === 30);
    ok('mismo hecho con otro sujeto ⇒ IDEMPOTENCY_CONFLICT', throwsCode(() => L.recordFact(db2, fact({ userId: 'u-otro' })), 'IDEMPOTENCY_CONFLICT'));

    section('[5] decisiones sin emisión y emisiones rechazadas');
    ok('observed sin montos se registra sin emitir', (() => { const r = L.recordFact(db2, fact({ sourceEventId: 'ev-obs', decision: 'observed', xp: 0, pm: null, features: { decision: 'con_comentarios' } })); return r.inserted && r.movementId === null && r.xpEntryId === null; })());
    ok('observed con montos ⇒ INVALID_EMISSION', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x1', decision: 'observed' })), 'INVALID_EMISSION'));
    ok('grado C emitiendo ⇒ GRADE_NOT_EMITTING', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x2', grade: 'C' })), 'GRADE_NOT_EMITTING'));
    ok('grado D emitiendo ⇒ GRADE_NOT_EMITTING', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x3', grade: 'D' })), 'GRADE_NOT_EMITTING'));
    ok('lectura terminada emitiendo ⇒ READING_EMISSION_LOCKED', throwsCode(() => L.recordFact(db2, fact({ source: 'reading_completion', sourceEventId: 'u:c:w1', factType: 'reading_completed', features: { verdict: 'plausible' } })), 'READING_EMISSION_LOCKED'));
    ok('lectura terminada en observación sí se registra', L.recordFact(db2, fact({ source: 'reading_completion', sourceEventId: 'u:c:w1', factType: 'reading_completed', decision: 'observed', xp: 0, pm: null, features: { verdict: 'plausible', activeMinutes: 42, reasons: [] } })).inserted);
    ok('autoconcesión (actor = sujeto) ⇒ SELF_AWARD', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x4', actorId: 'u-lector-1' })), 'SELF_AWARD'));
    ok('fuente leo ⇒ UNKNOWN_SOURCE', throwsCode(() => L.recordFact(db2, fact({ source: 'leo', sourceEventId: 'ev-x5' })), 'UNKNOWN_SOURCE'));
    ok('fuente royalties ⇒ UNKNOWN_SOURCE', throwsCode(() => L.recordFact(db2, fact({ source: 'royalties_qrs', sourceEventId: 'ev-x6' })), 'UNKNOWN_SOURCE'));
    ok('features con texto libre no admitido ⇒ INVALID_FEATURES', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x7', features: { feedback: 'muy bien' } })), 'INVALID_FEATURES'));
    ok('features con string largo ⇒ INVALID_FEATURES', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x8', features: { decision: 'x'.repeat(65) } })), 'INVALID_FEATURES'));
    ok('PM negativo en un hecho ⇒ INVALID_AMOUNT', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x9', pm: { amount: -5, reasonCode: 'r' } })), 'INVALID_AMOUNT'));
    ok('PM no entero ⇒ INVALID_AMOUNT', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x10', pm: { amount: 2.5, reasonCode: 'r' } })), 'INVALID_AMOUNT'));
    ok('PM fuera de cota ⇒ AMOUNT_OUT_OF_BOUNDS', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x11', pm: { amount: 99999, reasonCode: 'r' } })), 'AMOUNT_OUT_OF_BOUNDS'));
    ok('rule_version inexistente ⇒ UNKNOWN_RULE_VERSION', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev-x12', ruleVersion: 'gm-nope' })), 'UNKNOWN_RULE_VERSION'));
    ok('id con caracteres inválidos ⇒ INVALID_FACT', throwsCode(() => L.recordFact(db2, fact({ sourceEventId: 'ev 13 ; DROP' })), 'INVALID_FACT'));
    ok('ninguna operación rechazada dejó filas', db2.prepare("SELECT COUNT(*) n FROM gm_source_facts WHERE source_event_id LIKE 'ev-x%'").get().n === 0);

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
    ok('no existe primitiva de reserva ni de canje en G3-01', !('reserve' in L) && !('redeem' in L) && !Object.keys(L).some((k) => /reserv|redeem|coupon|grant/i.test(k)));

    section('[7] triggers append-only y constraints a nivel SQL');
    for (const t of ['gm_rule_sets', 'gm_source_facts', 'gm_xp_entries', 'gm_pm_movements', 'gm_admin_audit']) {
        ok(`UPDATE en ${t} aborta`, throwsMsg(() => db2.prepare(`UPDATE ${t} SET rowid = rowid`).run(), /append-only/));
        ok(`DELETE en ${t} aborta`, throwsMsg(() => db2.prepare(`DELETE FROM ${t}`).run(), /append-only/));
    }
    ok('DELETE en gm_pm_balances aborta', throwsMsg(() => db2.prepare('DELETE FROM gm_pm_balances').run(), /never deleted/));
    const rawMv = (o) => db2.prepare(`INSERT INTO gm_pm_movements (movement_id,user_id,kind,amount,source,idempotency_key,fact_id,redemption_id,related_movement_id,reason_code,actor_id,rule_version,period_day,period_week,created_at)
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
    ok('canje: DELETE aborta', throwsMsg(() => db2.prepare("DELETE FROM gm_redemptions").run(), /never deleted/));

    section('[8] invariante snapshot = Σ ledger y reconstrucción');
    // Secuencia pseudoaleatoria determinista de hechos, ajustes y compensaciones para varios usuarios.
    let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const users = ['u-a', 'u-b', 'u-c', 'u-d'];
    for (let i = 0; i < 300; i++) {
        const u = users[Math.floor(rnd() * users.length)];
        const r = rnd();
        try {
            if (r < 0.6) L.recordFact(db2, fact({ userId: u, sourceEventId: `prop-${Math.floor(rnd() * 120)}-${u}`, pm: { amount: 1 + Math.floor(rnd() * 50), reasonCode: 'mook_approved' }, now: tick() }));
            else if (r < 0.85) L.appendAdjustment(db2, { userId: u, amount: Math.floor(rnd() * 40) - 20 || 1, reasonCode: 'support', actorId: 'admin-1', idempotencyKey: `pa-${i}`, ruleVersion: RV, now: tick() });
            else {
                const last = db2.prepare('SELECT movement_id FROM gm_pm_movements WHERE user_id = ? ORDER BY seq DESC LIMIT 1').get(u);
                if (last) L.appendCompensation(db2, { userId: u, amount: -(1 + Math.floor(rnd() * 30)), reasonCode: 'correction', actorId: 'admin-1', relatedMovementId: last.movement_id, idempotencyKey: `pc-${i}`, ruleVersion: RV, now: tick() });
            }
        } catch (e) {
            if (!['INSUFFICIENT_BALANCE', 'IDEMPOTENCY_CONFLICT'].includes(e.code)) throw e;
        }
    }
    const v = L.verifyLedger(db2);
    ok(`snapshot = Σ ledger para ${v.users} usuarios tras 300 operaciones aleatorias`, v.ok, JSON.stringify(v.divergences).slice(0, 300));
    ok('ningún saldo negativo sin una compensación que lo explique', db2.prepare(`SELECT COUNT(*) n FROM gm_pm_balances b WHERE b.available < 0
        AND NOT EXISTS (SELECT 1 FROM gm_pm_movements m WHERE m.user_id = b.user_id AND m.kind = 'compensation')`).get().n === 0);
    const before = db2.prepare('SELECT user_id, available, reserved, lifetime_earned, last_seq FROM gm_pm_balances ORDER BY user_id').all();
    db2.prepare("UPDATE gm_pm_balances SET available = available + 777 WHERE user_id = 'u-a'").run();
    ok('una alteración manual del snapshot se detecta', L.verifyLedger(db2).ok === false);
    L.rebuildBalances(db2);
    const after = db2.prepare('SELECT user_id, available, reserved, lifetime_earned, last_seq FROM gm_pm_balances ORDER BY user_id').all();
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
    ok('server/gamification no menciona econ_events, royalties.db ni access_db', !/econ_events|royalties\.db|access_db|progress\.db|mook_db/.test(modSrc));
    ok('server/gamification no escribe archivos (solo mkdir del directorio de su base)', !/writeFile|appendFile|rename|unlink|rmSync|copyFile/.test(modSrc));
    ok('server/gamification no registra rutas HTTP', !/app\.(get|post|put|delete|use)\s*\(|express\.Router/.test(modSrc));
    ok('server.js no importa ni llama al motor (sin ganchos en G3-01)', !/gamification\//.test(read('server/server.js')));
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

console.log(`\nCHP-GAMIFICACION-G3-01 (núcleo) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
