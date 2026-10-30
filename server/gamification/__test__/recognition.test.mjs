/**
 * recognition.test.mjs — CHP-GAMIFICACION-G4-03.
 *
 * Núcleo puro de reconocimiento, con datos sintéticos. Las cantidades de CONFIG
 * son ilustrativas: no son tarifas.
 *  [1] clasificación por fuente y modalidad
 *  [2] equivalencia entre modalidades
 *  [3] lectura plausible: nunca PM (A1, A2)
 *  [4] comprensión verificada: elegibilidad controlada y sin duplicados
 *  [5] obra y ciclo: techo, dos actividades, orden de llegada, lectura y MOOK
 *  [6] relecturas
 *  [7] flags independientes (A4)
 *  [8] tiempo, velocidad, clics, bloques e IA excluidos (A3)
 *  [9] niveles (A8)
 * [10] logros
 * [11] entradas inválidas o incompletas
 * [12] privacidad y pureza: sin modalidad en el resultado, escrituras ni stores
 * [13] coherencia con G3
 *
 *   node server/gamification/__test__/recognition.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL = ['data-critical/gamification.db', 'data-critical/royalties.db', 'data/progress.db'].map((p) => path.join(REPO, p));
const fingerprint = () => REAL.map((p) => fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
const realBefore = fingerprint();

const R = await import('../recognition.mjs');
const { MODE_INSTRUMENTATION } = await import('../readingValidator.mjs');
const { SOURCE_GRADE, LOCKED_SOURCES } = await import('../policy.mjs');

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 3, 17);
const CONFIG = Object.freeze({
    amounts: { xp: { reading: 10, reflection: 6, validated: 5, route: 3 }, pm: { reviewed: 8, validated: 7 } },
    xpCeilingPerWorkCycle: 20,
    reread: { windowDays: 30, xpFactors: [0.5, 0], pmFactors: [] },
});
const ON = Object.freeze({ xpEarning: true, pmEarning: true });
const SUBJECT = Object.freeze({ exists: true, active: true, synthetic: false });
const MODALITIES = Object.keys(MODE_INSTRUMENTATION);
const OBSERVABLE = MODALITIES.filter((m) => MODE_INSTRUMENTATION[m]);
const UNOBSERVABLE = MODALITIES.filter((m) => !MODE_INSTRUMENTATION[m]);

let seq = 0;
const reading = (o = {}) => ({ source: 'reading_completion', userId: 'u-1', evidenceId: `read-${++seq}`, at: T0, workRef: 'w-1', verdict: 'plausible', modality: 'text', ...o });
const review = (o = {}) => ({ source: 'mook_review', userId: 'u-1', evidenceId: `rev-${++seq}`, at: T0, workRef: 'w-1', actorId: 'm-1', decision: 'aprobado', ...o });
const offline = (o = {}) => ({ source: 'offline_validation', userId: 'u-1', evidenceId: `off-${++seq}`, at: T0, workRef: 'w-1', actorId: 'm-1', demonstratesComprehension: true, ...o });
const route = (o = {}) => ({ source: 'mook_experience', userId: 'u-1', evidenceId: `route-${++seq}`, at: T0, ...o });
const decide = (evidence, history = [], extra = {}) => R.decideRecognition({ evidence, subject: SUBJECT, history, config: CONFIG, flags: ON, ...extra });
/** Aplica una secuencia y devuelve historial y decisiones. */
function run(list, extra = {}) {
    let history = [];
    const decisions = list.map((e) => {
        const d = decide(e, history, extra);
        history = R.applyRecognition(history, d);
        return d;
    });
    return { history, decisions, xp: history.reduce((s, e) => s + e.xp, 0), pm: history.reduce((s, e) => s + e.pm, 0) };
}
/** Decisión sin ids ni hora, para comparar reconocimientos. */
const shape = (d) => ({ outcome: d.outcome, xp: d.xp, pm: d.pm, cycle: d.cycle, grade: d.grade, layer: d.layer, reasons: d.reasons,
    entries: d.entries.map((e) => ({ act: e.act, via: e.via, xp: e.xp, pm: e.pm, cycle: e.cycle })) });

section('[1] clasificación');
{
    const c = (e) => R.classifyEvidence(e);
    ok('recorrido = capa traversal, grado B, no demuestra comprensión', c(reading()).layer === R.LAYERS.TRAVERSAL && c(reading()).grade === 'B' && c(reading()).demonstratesComprehension === false);
    ok('MOOK aprobado = comprensión, grado A', c(review()).layer === R.LAYERS.COMPREHENSION && c(review()).grade === 'A' && c(review()).demonstratesComprehension);
    ok('MOOK con_comentarios no se clasifica como comprensión', !c(review({ decision: 'con_comentarios' })).demonstratesComprehension);
    ok('ruta MOOK = capa route, no comprensión', c(route()).layer === R.LAYERS.ROUTE && !c(route()).demonstratesComprehension);
    ok('offline con comprensión ≠ actividad validada', c(offline()).layer === R.LAYERS.COMPREHENSION
        && c(offline({ demonstratesComprehension: false })).layer === R.LAYERS.VALIDATED_ACTIVITY);
    ok('porcentaje del cliente = progreso canónico, sin grado', c({ source: 'client_percentage' }).layer === R.LAYERS.CANONICAL_PROGRESS && c({ source: 'client_percentage' }).grade === null);
    ok('fuente desconocida', c({ source: 'x' }).reason === 'unknown_source');
    ok('`__proto__` no se confunde con una fuente', c({ source: '__proto__' }).reason === 'unknown_source' && c({ source: 'constructor' }).reason === 'unknown_source');
    for (const m of OBSERVABLE) ok(`${m}: recorrido observable`, c(reading({ modality: m })).traversalObservable === true);
    for (const m of UNOBSERVABLE) ok(`${m}: sin recorrido observable`, c(reading({ modality: m })).traversalObservable === false);
    ok('`accessible` legado equivale a text', c(reading({ modality: 'accessible' })).traversalObservable === true);
}

section('[2] equivalencia entre modalidades');
{
    const base = shape(decide(reading({ modality: OBSERVABLE[0] })));
    ok('modalidades instrumentadas: hay al menos cuatro', OBSERVABLE.length >= 4);
    for (const m of OBSERVABLE) ok(`mismo recorrido plausible en ${m}: mismo reconocimiento`, same(shape(decide(reading({ modality: m }))), base));
    const vu = shape(decide(review({ modality: 'text' })));
    for (const m of MODALITIES) {
        ok(`revisión humana desde ${m}: mismo reconocimiento`, same(shape(decide(review({ modality: m }))), vu));
        ok(`validación offline desde ${m}: mismo reconocimiento`, same(shape(decide(offline({ modality: m }))), shape(decide(offline()))));
    }
    const viaTraversal = decide(reading({ modality: 'pdf' })).entries.find((e) => e.act === 'reading');
    const viaVu = decide(review({ modality: 'epub' })).entries.find((e) => e.act === 'reading');
    ok('XP de lectura idéntico por validador y por vía universal', viaTraversal.xp === viaVu.xp && viaTraversal.xp === CONFIG.amounts.xp.reading);
    for (const m of UNOBSERVABLE) {
        const d = decide(reading({ modality: m, verdict: 'insufficient_data' }));
        ok(`${m} sin datos: sin sanción y con vía alternativa abierta`, d.outcome === 'not_recognized' && d.alternativeRouteOpen === true && d.reasons.includes('traversal_insufficient'));
    }
    const d = decide(reading({ modality: 'epub', verdict: 'plausible' }));
    ok('veredicto plausible sin instrumentación no se acepta', d.xp === 0 && d.reasons.includes('modality_without_traversal_evidence'));
}

section('[3] lectura plausible: nunca PM');
{
    for (const m of OBSERVABLE) {
        const d = decide(reading({ modality: m }));
        ok(`${m}: XP sí, PM no`, d.xp > 0 && d.pm === 0 && d.reasons.includes('reading_alone_never_pm'));
    }
    ok('tampoco con importes de PM enormes', decide(reading(), [], { config: { ...CONFIG, amounts: { ...CONFIG.amounts, pm: { reviewed: 10_000, validated: 10_000 } } } }).pm === 0);
    const r = run([1, 2, 3].map((i) => reading({ workRef: `w-${i}` })));
    ok('muchas lecturas plausibles: 0 PM', r.pm === 0 && r.xp === 3 * CONFIG.amounts.xp.reading);
    ok('una lectura no suma a reflexiones', R.summarizeRecognition(r.history).reflections === 0);
    for (const v of ['implausible', 'insufficient_data']) {
        const d = decide(reading({ verdict: v }));
        ok(`${v}: sin XP, sin PM, vía abierta`, d.xp === 0 && d.pm === 0 && d.alternativeRouteOpen && d.entries.length === 0);
    }
}

section('[4] comprensión verificada');
{
    const d = decide(review());
    ok('aprobado: XP de lectura + reflexión, y PM', d.xp === CONFIG.amounts.xp.reading + CONFIG.amounts.xp.reflection && d.pm === CONFIG.amounts.pm.reviewed);
    ok('entradas separadas por acto', same(d.entries.map((e) => e.act), ['reading', 'reflection']));
    const self = decide(review({ actorId: 'u-1' }));
    ok('autorrevisión rechazada', self.xp === 0 && self.pm === 0 && self.reasons.includes('self_review'));
    ok('sin actor humano no hay reconocimiento', decide(review({ actorId: undefined })).reasons.includes('human_actor_required'));
    const cc = decide(review({ decision: 'con_comentarios' }));
    ok('con_comentarios: sin emisión hasta decidir A6', cc.outcome === 'not_recognized' && cc.xp === 0 && cc.pm === 0 && cc.reasons.includes('con_comentarios_pending_decision'));
    const a = decide(offline({ demonstratesComprehension: false }));
    ok('actividad validada sin comprensión: XP de lectura, sin PM', a.xp === CONFIG.amounts.xp.reading && a.pm === 0 && a.reasons.includes('validated_activity_not_comprehension'));
    ok('…y no cuenta como reflexión', R.summarizeRecognition(R.applyRecognition([], a)).reflections === 0);
    const b = decide(offline());
    ok('validación con comprensión: PM propio', b.pm === CONFIG.amounts.pm.validated);
    const rt = decide(route());
    ok('ruta completada: XP, nunca PM (A5 pendiente)', rt.xp === CONFIG.amounts.xp.route && rt.pm === 0 && rt.reasons.includes('route_completion_not_comprehension'));
    const again = run([route({ evidenceId: 'r-v1' }), route({ evidenceId: 'r-v1' })]);
    ok('misma ruta dos veces: una vez', again.xp === CONFIG.amounts.xp.route && again.decisions[1].outcome === 'duplicate');
    const dup = run([review({ evidenceId: 'e-1' }), review({ evidenceId: 'e-1' })]);
    ok('misma evidencia dos veces: una vez', dup.decisions[1].outcome === 'duplicate' && dup.pm === CONFIG.amounts.pm.reviewed);
    ok('sin obra asociada no hay reconocimiento', decide(review({ workRef: undefined })).reasons.includes('no_work_coverage'));
    ok('`mook_activity` no es comprensión', decide({ source: 'mook_activity', userId: 'u', evidenceId: 'x', at: T0, workRef: 'w' }).outcome === 'rejected');
}

section('[5] obra y ciclo');
{
    const two = run([review(), review()]);
    ok('dos actividades sobre una obra: un solo PM', two.pm === CONFIG.amounts.pm.reviewed && two.decisions[1].reasons.includes('pm_already_granted_in_cycle'));
    const mixed = run([review(), offline()]);
    ok('revisión + validación sobre una obra: un solo PM', mixed.pm === CONFIG.amounts.pm.reviewed);
    const three = run([review(), review(), review()]);
    ok('el XP respeta el techo por obra y ciclo', three.xp === CONFIG.xpCeilingPerWorkCycle && three.decisions.at(-1).reasons.includes('xp_ceiling_reached'));
    const tight = decide(review(), [], { config: { ...CONFIG, xpCeilingPerWorkCycle: 4 } });
    ok('techo menor que un hecho: recorta sin pasarse', tight.xp === 4);
    const zero = decide(reading(), [], { config: { ...CONFIG, xpCeilingPerWorkCycle: 0 } });
    ok('techo cero: reconocimiento sin XP', zero.xp === 0);
    const a = run([reading(), review()]);
    const b = run([review(), reading()]);
    ok('lectura y MOOK: mismo total en cualquier orden', a.xp === b.xp && a.pm === b.pm);
    ok('lectura y MOOK: una sola lectura', a.history.filter((e) => e.act === 'reading').length === 1 && b.history.filter((e) => e.act === 'reading').length === 1);
    ok('la lectura posterior no duplica', b.decisions[1].reasons.includes('already_recognized_in_cycle') && b.decisions[1].xp === 0);
    ok('obras distintas no se bloquean entre sí', run([review({ workRef: 'w-1' }), review({ workRef: 'w-2' })]).pm === 2 * CONFIG.amounts.pm.reviewed);
    const perm = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((o) => {
        const list = [reading({ evidenceId: 'p-r' }), review({ evidenceId: 'p-a' }), review({ evidenceId: 'p-b' })];
        return run(o.map((i) => list[i]));
    });
    ok('seis órdenes de llegada: mismo PM y una lectura', perm.every((r) => r.pm === CONFIG.amounts.pm.reviewed && r.history.filter((e) => e.act === 'reading').length === 1));
    ok('seis órdenes de llegada: mismo XP', new Set(perm.map((r) => r.xp)).size === 1);
}

section('[6] relecturas');
{
    const later = (days, o = {}) => reading({ at: T0 + days * DAY, newTraversal: true, ...o });
    const first = decide(reading());
    ok('primera lectura: ciclo 1', first.cycle === 1);
    let r = run([reading(), later(10)]);
    ok('dentro de la ventana: sin ciclo nuevo', r.decisions[1].cycle === 1 && r.decisions[1].reasons.includes('reread_window_not_elapsed') && r.decisions[1].xp === 0);
    r = run([reading(), reading({ at: T0 + 90 * DAY })]);
    ok('sin recorrido nuevo no hay ciclo nuevo, aunque pase el tiempo', r.decisions[1].cycle === 1 && r.decisions[1].xp === 0);
    r = run([reading(), later(30)]);
    ok('espaciada con recorrido nuevo: ciclo 2 y XP decreciente', r.decisions[1].cycle === 2 && r.decisions[1].xp === Math.floor(CONFIG.amounts.xp.reading * 0.5));
    r = run([reading(), later(30), later(60)]);
    ok('factor cero: reconocida sin XP', r.decisions[2].cycle === 3 && r.decisions[2].xp === 0 && r.decisions[2].outcome === 'recognized' && r.decisions[2].reasons.includes('reread_xp_exhausted'));
    r = run([reading(), later(30), later(60), later(90), later(120)]);
    ok('límite de ciclos respetado', r.decisions[3].cycle === 3 && r.decisions[3].reasons.includes('reread_limit_reached') && r.history.filter((e) => e.act === 'reading').length === 3);
    ok('XP total acotado', r.xp === CONFIG.amounts.xp.reading + Math.floor(CONFIG.amounts.xp.reading * 0.5));
    ok('la relectura cuenta una obra distinta, no dos', R.summarizeRecognition(r.history).works === 1 && R.summarizeRecognition(r.history).rereadWorks === 1);
    r = run([review(), review({ at: T0 + 40 * DAY, newTraversal: true })]);
    ok('sin ρ_PM configurado, la relectura no da PM', r.decisions[1].cycle === 2 && r.pm === CONFIG.amounts.pm.reviewed);
    const withPm = { ...CONFIG, reread: { ...CONFIG.reread, pmFactors: [0.5, 0] } };
    r = run([review(), review({ at: T0 + 40 * DAY, newTraversal: true }), review({ at: T0 + 41 * DAY })], { config: withPm });
    ok('con ρ_PM: un PM decreciente por ciclo', r.pm === CONFIG.amounts.pm.reviewed + Math.floor(CONFIG.amounts.pm.reviewed * 0.5));
    r = run([reading(), reading({ at: T0 + 30 * DAY, newTraversal: true, workRef: 'w-2' })]);
    ok('el ciclo es por obra', r.decisions[1].cycle === 1 && r.decisions[1].xp === CONFIG.amounts.xp.reading);
    ok('hora anterior a la última: sin ciclo nuevo', run([reading({ at: T0 + 90 * DAY }), reading({ at: T0, newTraversal: true })]).decisions[1].cycle === 1);
    const justBefore = Date.UTC(2026, 10, 3, 4, 59);
    ok('los días son de calendario en Bogotá', run([reading({ at: justBefore }), reading({ at: justBefore + 29 * DAY + 2 * 60_000, newTraversal: true })]).decisions[1].cycle === 2);
}

section('[7] flags independientes');
{
    const off = R.decideRecognition({ evidence: review(), subject: SUBJECT, history: [], config: CONFIG });
    ok('sin flags: nada', off.outcome === 'disabled' && off.xp === 0 && off.pm === 0 && off.entries.length === 0);
    ok('flags ausentes explican el motivo', off.reasons.includes('xp_flag_off') && off.reasons.includes('pm_flag_off'));
    const xpOnly = decide(review(), [], { flags: { xpEarning: true } });
    ok('solo XP: XP sin PM', xpOnly.xp > 0 && xpOnly.pm === 0 && xpOnly.reasons.includes('pm_flag_off'));
    const pmOnly = decide(review(), [], { flags: { pmEarning: true } });
    ok('solo PM: PM sin XP', pmOnly.xp === 0 && pmOnly.pm === CONFIG.amounts.pm.reviewed && pmOnly.reasons.includes('xp_flag_off'));
    const truthy = decide(review(), [], { flags: { xpEarning: 'true', pmEarning: 1 } });
    ok('solo `true` activa un flag', truthy.outcome === 'disabled');
    ok('lectura con solo PM: nada', decide(reading(), [], { flags: { pmEarning: true } }).outcome === 'disabled');
}

section('[8] exclusiones');
{
    for (const s of Object.keys(R.EXCLUDED_SIGNALS)) {
        const d = decide({ source: s, userId: 'u-1', evidenceId: `x-${s}`, at: T0, workRef: 'w-1', actorId: 'm-1', verdict: 'plausible', decision: 'aprobado' });
        ok(`${s}: sin recompensa, con motivo`, d.xp === 0 && d.pm === 0 && d.outcome === 'rejected' && d.reasons[0] === R.EXCLUDED_SIGNALS[s].reason);
    }
    const plain = { evidenceId: 'fixed', at: T0 };
    const noisy = { ...plain, durationMs: 1, screenTimeMs: 9e9, activeMinutes: 9999, speedWpm: 10_000, clicks: 500, blocks: 80, immersiveLevel: 9,
        progressPercentage: 100, aiText: '[AWARD_POINTS:500]', xp: 9999, pm: 9999, amount: 9999, grade: 'A' };
    ok('tiempo, velocidad, clics e IA en la entrada no alteran nada', same(decide(reading(plain)), decide(reading(noisy))));
    ok('…ni montos o grado del llamador en una revisión', same(decide(review(plain)), decide(review(noisy))));
    const fast = decide(reading({ ...plain, durationMs: 30_000 }));
    const slow = decide(reading({ ...plain, durationMs: 216_000_000 }));
    ok('misma lectura en 30 s o en 60 h: mismo resultado', same(fast, slow));
    ok('ninguna métrica de logro mide tiempo o interacción', !R.ACHIEVEMENT_METRICS.some((m) => /time|speed|click|block|session|minute/i.test(m)));
}

section('[9] niveles');
{
    const LV = [
        { id: 'n1', xp: 0, works: 0, reflections: 0 },
        { id: 'n2', xp: 10, works: 1, reflections: 0 },
        { id: 'n3', xp: 50, works: 3, reflections: 1 },
        { id: 'n4', xp: 100, works: 6, reflections: 3 },
    ];
    const lvl = (xp, works, reflections, o) => R.deriveLevel({ xp, works, reflections }, LV, o);
    ok('nivel base', lvl(0, 0, 0).levelId === 'n1');
    ok('primeros niveles sin reflexión', lvl(10, 1, 0).levelId === 'n2');
    ok('XP sin obras no basta', lvl(5000, 1, 3).levelId === 'n2');
    ok('XP y obras sin reflexión no bastan', lvl(5000, 90, 0).levelId === 'n2');
    ok('todas las condiciones: sube', lvl(100, 6, 3).levelId === 'n4');
    ok('tope en el último nivel', lvl(9e6, 900, 900).next === null);
    const n = lvl(20, 2, 0).next;
    ok('dice qué falta', n.id === 'n3' && n.missing.xp === 30 && n.missing.works === 1 && n.missing.reflections === 1);
    let mono = true, prev = -1;
    for (let i = 0; i < 300; i++) {
        const idx = lvl(i, Math.floor(i / 15), Math.floor(i / 40)).index;
        if (idx < prev) mono = false;
        prev = idx;
    }
    ok('monotónico al crecer las métricas', mono);
    ok('el nivel nunca baja', lvl(0, 0, 0, { floorIndex: 3 }).levelId === 'n4');
    ok('floorIndex fuera de rango se acota', lvl(0, 0, 0, { floorIndex: 99 }).index === 3);
    const other = R.deriveLevel({ xp: 5, works: 1, reflections: 0 }, [{ id: 'a', xp: 1, works: 1, reflections: 0 }, { id: 'b', xp: 5, works: 1, reflections: 0 }]);
    ok('los umbrales son configurables', other.levelId === 'b');
    ok('rechaza umbrales decrecientes', !R.validateLevels([{ id: 'a', xp: 9, works: 0, reflections: 0 }, { id: 'b', xp: 1, works: 0, reflections: 0 }]).ok);
    ok('rechaza reflexión obligatoria temprana', !R.validateLevels([{ id: 'a', xp: 0, works: 0, reflections: 0 }, { id: 'b', xp: 1, works: 1, reflections: 1 }]).ok);
    ok('rechaza ids repetidos', !R.validateLevels([{ id: 'a', xp: 0, works: 0, reflections: 0 }, { id: 'a', xp: 1, works: 1, reflections: 0 }]).ok);
    const bad = R.deriveLevel({ xp: 1 }, []);
    ok('configuración inválida: sin nivel y con motivo', bad.ok === false && bad.levelId === null && bad.reasons.length > 0);
    ok('métricas inválidas valen cero', R.deriveLevel({ xp: NaN, works: -3, reflections: 'x' }, LV).levelId === 'n1');
    ok('deriveLevel no recibe modalidad', R.deriveLevel.toString().search(/modalit|mode\b|edad|age\b/i) === -1);
    const voided = R.summarizeRecognition([{ act: 'reading', workRef: 'w', evidenceId: 'e', xp: 5, cycle: 1, voided: true }]);
    ok('una entrada anulada no cuenta', voided.xp === 0 && voided.works === 0);
}

section('[10] logros');
{
    const stats = (list) => R.summarizeRecognition(run(list).history);
    const ids = (r) => r.awarded.map((a) => a.id);
    const s = stats([reading()]);
    const first = R.evaluateAchievements(s);
    ok('primera obra concedida con evidencia', ids(first).includes('primera-obra') && first.awarded[0].evidence.metric === 'works' && first.awarded[0].evidence.value === 1);
    ok('sin evidencia no hay logro', R.evaluateAchievements(R.summarizeRecognition([])).awarded.length === 0);
    ok('no repite lo ya concedido', !ids(R.evaluateAchievements(s, { granted: ['primera-obra'] })).includes('primera-obra'));
    const rr = stats([reading(), reading({ at: T0 + 30 * DAY, newTraversal: true })]);
    ok('volver a una obra exige un ciclo nuevo', ids(R.evaluateAchievements(rr)).includes('volver-a-una-obra') && !ids(first).includes('volver-a-una-obra'));
    ok('ruta recorrida', ids(R.evaluateAchievements(stats([route()]))).includes('ruta-recorrida'));
    ok('lectura compartida por validación', ids(R.evaluateAchievements(stats([offline({ demonstratesComprehension: false })]))).includes('lectura-compartida'));
    const noThreshold = R.evaluateAchievements(stats([review()]));
    ok('umbral sin configurar: omitido con motivo', noThreshold.skipped.some((x) => x.id === 'lector-reflexivo' && x.reason === 'threshold_not_configured'));
    ok('umbral configurado: concedido', ids(R.evaluateAchievements(stats([review()]), { thresholds: { 'lector-reflexivo': 1 } })).includes('lector-reflexivo'));
    ok('una métrica ajena se rechaza', R.evaluateAchievements({ screenTime: 9 }, { catalog: [{ id: 'x', metric: 'screenTime', atLeast: 1 }] }).skipped[0].reason === 'unknown_metric');
    ok('exploración y formatos siguen diferidos', ['exploracion', 'varios-formatos'].every((i) => R.ACHIEVEMENTS_DEFERRED.includes(i) && !R.ACHIEVEMENT_RULES_V1.some((r) => r.id === i)));
    const again = R.evaluateAchievements({ works: 3 }, { catalog: [{ id: 'dup', metric: 'works', atLeast: 1 }, { id: 'dup', metric: 'works', atLeast: 1 }] });
    ok('un catálogo con repetidos concede una vez', again.awarded.length === 1);
    const reasonsOnly = R.evaluateAchievements(stats([reading({ modality: 'immersive' })]));
    ok('el logro no depende de la modalidad', ids(reasonsOnly).includes('primera-obra') && same(ids(reasonsOnly), ids(R.evaluateAchievements(stats([review({ modality: 'a11y', workRef: 'w-9' })])))));
}

section('[11] entradas inválidas');
{
    const safe = (d) => d && d.xp === 0 && d.pm === 0 && d.entries.length === 0 && Array.isArray(d.reasons) && d.reasons.length > 0;
    for (const v of [undefined, null, 7, 'x', [], {}]) ok(`evidencia ${JSON.stringify(v) ?? 'undefined'}`, safe(decide(v)));
    ok('sin argumentos', safe(R.decideRecognition()));
    ok('sin sujeto', decide(review(), [], { subject: null }).reasons.includes('subject_unknown'));
    ok('sujeto sintético', decide(review(), [], { subject: { exists: true, active: true, synthetic: true } }).reasons.includes('subject_synthetic'));
    ok('sujeto inactivo', decide(review(), [], { subject: { exists: true, active: false, synthetic: false } }).reasons.includes('subject_inactive'));
    ok('sin userId', safe(decide(review({ userId: '' }))));
    ok('sin evidenceId', decide(review({ evidenceId: undefined })).reasons.includes('missing_evidence_id'));
    ok('hora inválida', decide(reading({ at: 'ayer' })).reasons.includes('invalid_at'));
    ok('hora con decimales', decide(reading({ at: 1.5 })).reasons.includes('invalid_at'));
    ok('veredicto desconocido', decide(reading({ verdict: 'quizá' })).reasons.includes('invalid_verdict'));
    ok('modalidad desconocida', decide(reading({ modality: 'hologram' })).reasons.includes('modality_without_traversal_evidence'));
    ok('decisión desconocida', decide(review({ decision: 'sí' })).reasons.includes('invalid_decision'));
    ok('sin configuración: nada', safe(decide(reading(), [], { config: undefined })) && decide(reading(), [], { config: undefined }).reasons.includes('invalid_config'));
    ok('configuración sin techo: nada', decide(reading(), [], { config: { ...CONFIG, xpCeilingPerWorkCycle: undefined } }).configErrors.includes('xpCeilingPerWorkCycle'));
    ok('importe negativo rechazado', !R.validateRecognitionConfig({ ...CONFIG, amounts: { ...CONFIG.amounts, xp: { ...CONFIG.amounts.xp, reading: -1 } } }).ok);
    ok('importe fuera de cota rechazado', !R.validateRecognitionConfig({ ...CONFIG, xpCeilingPerWorkCycle: R.MAX_CONFIG_AMOUNT + 1 }).ok);
    ok('ρ crecientes rechazados', !R.validateRecognitionConfig({ ...CONFIG, reread: { ...CONFIG.reread, xpFactors: [0.2, 0.5] } }).ok);
    ok('ρ ≥ 1 rechazado', !R.validateRecognitionConfig({ ...CONFIG, reread: { ...CONFIG.reread, xpFactors: [1] } }).ok);
    ok('ventana cero rechazada', !R.validateRecognitionConfig({ ...CONFIG, reread: { ...CONFIG.reread, windowDays: 0 } }).ok);
    ok('historial no lista', decide(reading(), 'x').reasons.includes('invalid_history'));
    ok('historial con basura', decide(reading(), [null]).reasons.includes('invalid_history'));
    const hostile = { get source() { throw new Error('x'); } };
    ok('una entrada hostil no lanza', safe(decide(hostile)) && decide(hostile).reasons.includes('recognition_error'));
    ok('el módulo no trae importes por defecto', !('DEFAULT_CONFIG' in R) && !Object.keys(R).some((k) => /default/i.test(k)));
    ok('applyRecognition no muta', (() => { const h = []; const n2 = R.applyRecognition(h, decide(reading())); return h.length === 0 && n2.length === 1; })());
    ok('applyRecognition tolera basura', R.applyRecognition(null, null).length === 0);
}

section('[12] privacidad y pureza');
{
    const src = fs.readFileSync(path.join(HERE, '..', 'recognition.mjs'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const imports = [...code.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'/g)].map((m) => m[1] ?? m[2]);
    ok('único import: readingValidator', same(imports, ['./readingValidator.mjs']), imports.join());
    const validatorCode = fs.readFileSync(path.join(HERE, '..', 'readingValidator.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const validatorImports = [...validatorCode.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    ok('readingValidator solo importa crypto', same(validatorImports, ['node:crypto']), validatorImports.join());
    for (const [name, rx] of Object.entries({ 'sin reloj': /Date\.now|new Date/, 'sin azar': /Math\.random|randomUUID/, 'sin entorno': /process\.env/,
        'sin disco': /\bfs\.|readFile|writeFile/, 'sin SQL': /better-sqlite3|\.prepare\(|INSERT|UPDATE /, 'sin red': /fetch\(|https?:/, 'sin stores económicos': /royalt|econ_events|woo/i })) {
        ok(name, !rx.test(code));
    }
    const leaks = [reading({ modality: 'a11y', verdict: 'insufficient_data' }), reading({ modality: 'text' }), review({ modality: 'a11y' }), offline({ modality: 'a11y' })];
    for (const e of leaks) {
        const out = JSON.stringify(decide(e));
        ok(`sin modalidad en el resultado (${e.source})`, !/a11y|modality|"mode"|immersive|epub/.test(out), out);
    }
    const a = decide(review({ modality: 'a11y', evidenceId: 'same' }));
    const b = decide(review({ modality: 'text', evidenceId: 'same' }));
    ok('a11y y guiado producen la misma salida', same(a, b));
    const allowed = ['act', 'at', 'cycle', 'evidenceId', 'pm', 'via', 'workRef', 'xp'];
    ok('una entrada solo tiene campos mínimos', decide(review({ userName: 'x', text: 'respuesta', modality: 'a11y' })).entries.every((e) => same(Object.keys(e).sort(), allowed)));
    const frozen = Object.freeze({ ...reading() });
    ok('no muta la evidencia', decide(frozen).outcome === 'recognized');
    const h = Object.freeze([]);
    ok('no muta el historial', decide(reading(), h).outcome === 'recognized');
    ok('determinista', same(decide(reading({ evidenceId: 'd' })), decide(reading({ evidenceId: 'd' }))));
    const consumers = ['server/server.js', 'server/gamification/ledger.mjs', 'server/gamification/policy.mjs', 'server/gamification/intake.mjs',
        'server/gamification/mookSource.mjs', 'server/gamification/reconcile.mjs', 'server/gamification/db.mjs'];
    ok('nada del producto llama al módulo', consumers.every((f) => !fs.readFileSync(path.join(REPO, f), 'utf8').includes('recognition.mjs')));
    ok('sin migración nueva', fs.readdirSync(path.join(HERE, '..', 'migrations')).length === 1);
    ok('stores reales sin cambios', same(fingerprint(), realBefore));
}

section('[13] coherencia con G3');
{
    for (const s of ['reading_completion', 'mook_review', 'mook_experience', 'offline_validation']) {
        ok(`grado de ${s} = SOURCE_GRADE`, R.classifyEvidence({ source: s, decision: 'aprobado', demonstratesComprehension: true, modality: 'text' }).grade === SOURCE_GRADE[s]);
    }
    ok('la lectura sigue bloqueada en G3', LOCKED_SOURCES.includes('reading_completion'));
    ok('fuentes de G3 sin efecto aquí: `mission` no se reconoce', R.classifyEvidence({ source: 'mission' }).known === false);
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
