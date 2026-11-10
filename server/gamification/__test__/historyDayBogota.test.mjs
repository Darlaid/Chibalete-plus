/**
 * historyDayBogota.test.mjs — CHP-V8.1-CLOSE-08A.
 *
 * Prueba determinista, independiente de la hora de ejecución: el día de un
 * reconocimiento (el que muestra el historial, `progress.mjs`: ISO de
 * `occurred_at`) es el día civil de Bogotá (UTC−5), también entre las 19:00 y las
 * 24:00 de Bogotá, cuando la fecha UTC ya es la del día siguiente. Instantes fijos;
 * no se usa `Date.now()` para ningún hecho.
 *
 *   node server/gamification/__test__/historyDayBogota.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_tz_'));
const P = { db: path.join(tmp, 'gam', 'gamification.db'), reg: path.join(tmp, 'reg', 'exclusions.jsonl') };
fs.mkdirSync(path.dirname(P.db), { recursive: true }); fs.mkdirSync(path.dirname(P.reg), { recursive: true });
fs.writeFileSync(P.reg, '');
Object.assign(process.env, { GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg });
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');

const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.db, GAMIFICATION_EXCLUSION_REGISTRY: P.reg };
const RULE_FROM = Date.parse('2026-11-01T00:00:00-05:00');
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const CASES = [
    ['18:59 Bogotá (23:59 UTC, mismo día)', '2026-11-09T18:59:00-05:00', '2026-11-09'],
    ['19:01 Bogotá (00:01 UTC del día siguiente)', '2026-11-09T19:01:00-05:00', '2026-11-09'],
    ['23:30 Bogotá (04:30 UTC del día siguiente)', '2026-11-09T23:30:00-05:00', '2026-11-09'],
    ['00:10 Bogotá (05:10 UTC)', '2026-11-10T00:10:00-05:00', '2026-11-10'],
];
const historyDay = (occurredAt) => new Date(occurredAt).toISOString().slice(0, 10); // como progress.mjs (recognitionHistory)

try {
    const db = D.getGamificationDb({ env: ENV });
    L.createRuleSet(db, { ruleVersion: 'gm-tz', createdBy: 'migration', now: RULE_FROM, effectiveFrom: RULE_FROM, rules: { schema: 1, facts: {}, recognition: PILOT } });
    CASES.forEach(([label, iso, day], i) => {
        const at = Date.parse(iso);
        ok(`periodsFor: ${label} ⇒ ${day}`, L.periodsFor(at).day === day, L.periodsFor(at).day);
        const r = L.recordWorkRecognition(db, { evidenceId: `ev-tz-${i}`, userId: `u-tz-${i}`, actorId: 'med', at, workRef: `obra-${i}`, decision: 'aprobado' }, { env: ENV, now: at });
        const row = db.prepare('SELECT occurred_at, recorded_at FROM gm_source_facts WHERE fact_id = ?').get(r.factId);
        ok(`día del historial: ${label} ⇒ ${day} (no el día UTC)`, r.inserted && historyDay(row.occurred_at) === day && historyDay(row.recorded_at) === day,
            `${historyDay(row?.occurred_at)} / UTC ${new Date(at).toISOString().slice(0, 10)}`);
    });
    ok('el día UTC difiere en los casos de la tarde-noche (los que fallaban)', CASES.slice(1, 3).every(([, iso, day]) => new Date(Date.parse(iso)).toISOString().slice(0, 10) !== day));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nhistory day Bogotá (V8.1-CLOSE-08A): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
