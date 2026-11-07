/**
 * verificar_o1.mjs — V8-ACTIVATION-GATE-01.
 *
 * Comprueba que el acta O1 (APROBACION-DIR-XP-O1-20261107.md) se traduce EXACTAMENTE
 * a `createRuleSet` y que el contrato solo XP da 30 / +20 / techo 50, sin PM y sin XP
 * por recorrido, tiempo o lectura terminada. Lee el bloque `rules` del propio acta.
 *
 * Base temporal sintética: nunca toca data/ ni data-critical/, no usa clave de sujeto
 * ni datos reales y no instala nada en producción.
 *
 *   node docs/gamificacion/aprobaciones/verificar_o1.mjs
 */
import '../../../server/__test__/helpers/testMode.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const ACTA = path.join(HERE, 'APROBACION-DIR-XP-O1-20261107.md');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const code = (fn) => { try { fn(); return 'sin error'; } catch (e) { return e.code ?? e.message; } };

const md = fs.readFileSync(ACTA, 'utf8').replace(/\r\n/g, '\n');
const block = md.match(/```json\n([\s\S]*?)\n```/)?.[1];
const RULES = JSON.parse(block);
const SHA = crypto.createHash('sha256').update(JSON.stringify(RULES)).digest('hex');
const declared = md.match(/SHA-256 del bloque `rules` \| `([0-9a-f]{64}|__SHA__)`/)?.[1];
const RV = md.match(/`ruleVersion` \| `([^`]+)`/)?.[1];
const REF = md.match(/`approvalRef` \| `([^`]+)`/)?.[1];

const REAL_DB = path.join(REPO, 'data-critical', 'gamification.db');
const realBefore = fs.existsSync(REAL_DB);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_acta_o1_'));
process.env.GAMIFICATION_DB = path.join(tmp, 'gamification.db');
process.env.GAMIFICATION_ENABLED = '1';
const D = await import('../../../server/gamification/db.mjs');
const L = await import('../../../server/gamification/ledger.mjs');
const P = await import('../../../server/gamification/policy.mjs');
const R = await import('../../../server/gamification/recognition.mjs');
const G = await import('../../../server/gamification/progress.mjs');

try {
    console.log('\n[1] el acta y su bloque');
    ok('bloque JSON presente y parseable', !!RULES && RULES.schema === 1);
    ok(`SHA-256 declarado en el acta = el del bloque (${SHA.slice(0, 16)}…)`, declared === SHA, `declarado=${declared}`);
    ok('approvalRef del bloque = el del acta', RULES.recognition?.approvalRef === REF && REF === 'DIR-XP-O1-20261107');
    ok('sin campos de PM ni topes', !/"pm"|pmFactors|caps|pmPer/.test(block));
    ok('facts vacío: ninguna fuente paga por la vía genérica', JSON.stringify(RULES.facts) === '{}');
    ok('10 + 20, techo 50, ruta 0, validated 0, sin relecturas', JSON.stringify(RULES.recognition.amounts.xp) === '{"reading":10,"reflection":20,"validated":0,"route":0}'
        && RULES.recognition.xpCeilingPerWorkCycle === 50 && JSON.stringify(RULES.recognition.reread.xpFactors) === '[]');

    console.log('\n[2] createRuleSet real (base temporal)');
    const db = D.getGamificationDb();
    const now = Date.UTC(2026, 10, 7, 15);
    ok('validateApprovedRecognition: ok', R.validateApprovedRecognition(RULES.recognition).ok, JSON.stringify(R.validateApprovedRecognition(RULES.recognition).errors));
    const a = L.createRuleSet(db, { ruleVersion: RV, createdBy: 'verificacion', rules: RULES, now, effectiveFrom: now });
    ok(`se crea con ruleVersion ${RV}`, a.created === true);
    ok('idempotente: repetir ⇒ created:false', L.createRuleSet(db, { ruleVersion: RV, createdBy: 'verificacion', rules: RULES, now, effectiveFrom: now }).created === false);
    const row = db.prepare('SELECT rules_sha256, rules_json FROM gm_rule_sets WHERE rule_version = ?').get(RV);
    ok('rules_sha256 guardado = SHA del acta', row.rules_sha256 === SHA);
    ok('getActiveRuleSet devuelve la regla del acta', L.getActiveRuleSet(db, now + 1)?.ruleVersion === RV);
    const variant = (patch) => code(() => L.createRuleSet(db, { ruleVersion: 'variante', createdBy: 'verificacion', rules: patch(structuredClone(RULES)), now, effectiveFrom: now }));
    ok('variante con caps ⇒ PM_RETIRED', variant((r) => ({ ...r, caps: { pmPerDay: 0, pmPerWeek: 0 } })) === 'PM_RETIRED');
    ok('variante con amounts.pm a 0 ⇒ PM_RETIRED', variant((r) => { r.recognition.amounts.pm = { reviewed: 0, validated: 0 }; return r; }) === 'PM_RETIRED');
    ok('variante con reread.pmFactors ⇒ PM_RETIRED', variant((r) => { r.recognition.reread.pmFactors = []; return r; }) === 'PM_RETIRED');
    ok('variante que pagaría la revisión por facts ⇒ rechazada', variant((r) => { r.facts = { 'mook_review/evidence_reviewed': { xp: 30 } }; return r; }) !== 'sin error');
    ok('variante retroactiva ⇒ RETROACTIVE_RULES', code(() => L.createRuleSet(db, { ruleVersion: 'retro', createdBy: 'verificacion', rules: RULES, now, effectiveFrom: now - 1 })) === 'RETROACTIVE_RULES');
    ok('mismo ruleVersion con otro contenido ⇒ IDEMPOTENCY_CONFLICT', code(() => L.createRuleSet(db, { ruleVersion: RV, createdBy: 'verificacion', rules: { ...RULES, facts: { 'mission/x': { xp: 1 } } }, now, effectiveFrom: now })) === 'IDEMPOTENCY_CONFLICT');

    console.log('\n[3] reconocimiento con la regla del acta (puro)');
    const config = RULES.recognition;
    const subject = { exists: true, active: true, synthetic: false };
    const ev = (id, work, extra = {}) => ({ source: 'mook_review', userId: 'lector-sintetico', actorId: 'mediador-sintetico', evidenceId: id, at: now + 1000, workRef: work, decision: 'aprobado', ...extra });
    let h = [];
    const step = (e) => { const d = R.decideRecognition({ evidence: e, subject, history: h, config, flags: { xpEarning: true } }); h = R.applyRecognition(h, d); return d; };
    const d1 = step(ev('e1', 'obra-1'));
    ok('primera aprobación: 10 + 20 = 30', d1.outcome === 'recognized' && d1.xp === 30 && d1.entries.map((e) => `${e.act}:${e.xp}`).join() === 'reading:10,reflection:20');
    const d2 = step(ev('e2', 'obra-1'));
    ok('segunda aprobación de la misma obra: +20', d2.xp === 20);
    const d3 = step(ev('e3', 'obra-1'));
    ok('tercera: 0 (techo de 50 por obra y ciclo)', d3.xp === 0 && R.summarizeRecognition(h).xp === 50);
    const d4 = step(ev('e4', 'obra-1', { newTraversal: true, at: now + 90 * 86_400_000 }));
    ok('relectura: sin XP (ciclo único)', d4.xp === 0);
    ok('otra obra: vuelve a dar 30', step(ev('e5', 'obra-2')).xp === 30);
    ok('ninguna salida trae pm', !JSON.stringify(h).includes('"pm"') && !('pm' in d1));
    ok('«con comentarios» no se reconoce', R.decideRecognition({ evidence: ev('e6', 'obra-3', { decision: 'con_comentarios' }), subject, history: [], config, flags: { xpEarning: true } }).xp === 0);
    ok('autorrevisión no se reconoce', R.decideRecognition({ evidence: ev('e7', 'obra-3', { actorId: 'lector-sintetico' }), subject, history: [], config, flags: { xpEarning: true } }).xp === 0);
    ok('XP apagado: nada', R.decideRecognition({ evidence: ev('e8', 'obra-3'), subject, history: [], config, flags: {} }).xp === 0);

    console.log('\n[4] sin XP por recorrido, tiempo ni lectura terminada');
    const fact = (source, factType, features) => P.decideEmission({ rules: RULES, source, factType, eligibility: 'eligible', features, xpEnabled: true });
    ok('recorrido MOOK completado: 0 XP', fact('mook_experience', 'experience_completed', {}).xp === 0);
    ok('lectura terminada: 0 XP (bloqueada)', fact('reading_completion', 'reading_completed', { verdict: 'plausible' }).xp === 0);
    ok('validación presencial: 0 XP (bloqueada)', fact('offline_validation', 'validated', {}).xp === 0);
    ok('revisión por facts: 0 XP (solo por reconocimiento)', fact('mook_review', 'evidence_reviewed', {}).xp === 0);
    for (const s of ['screen_time', 'reading_speed', 'clicks', 'immersive_block', 'client_percentage']) {
        ok(`señal ${s}: excluida`, R.assessEligibility({ source: s, userId: 'u', evidenceId: 'x', at: 1 }, subject).xp.eligible === false);
    }

    console.log('\n[5] niveles activos');
    ok('solo Semilla y Brote', JSON.stringify(G.PILOT_LEVELS.map((l) => l.id)) === '["semilla","brote"]');
    ok('0 XP ⇒ Semilla', R.deriveLevel({ xp: 0, works: 0, reflections: 0 }, G.PILOT_LEVELS).levelId === 'semilla');
    ok('30 XP y 1 obra ⇒ Brote', R.deriveLevel({ xp: 30, works: 1, reflections: 1 }, G.PILOT_LEVELS).levelId === 'brote');
    ok('50 XP sigue en Brote (no hay más niveles activos)', R.deriveLevel({ xp: 50, works: 1, reflections: 2 }, G.PILOT_LEVELS).levelId === 'brote');
} catch (e) {
    console.error('  ✗ excepción', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    ok('la base real data-critical/gamification.db no se creó', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nActa O1 (${RV}): ${pass} ✓, ${fail} ✗  — SHA-256 ${SHA}`);
process.exit(fail ? 1 : 0);
