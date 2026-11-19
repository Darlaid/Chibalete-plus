/**
 * interventionImpact.unit.test.mjs — CHP V9 65B. Evaluación de una intervención del tablero, con números.
 *
 * `computeImpact` dividía el tiempo de lectura de las sesiones fechadas del lector entre una cifra que guardó el
 * cliente al registrar la intervención (`readingTimeMsAtIntervention`), de otra fuente. Aquí la regla, sin servidor:
 * con sesiones fechadas, las dos cifras salen de ellas; se dice cuándo la intervención aún no es evaluable y cuándo
 * no hay con qué comparar; y las tasas se calculan sobre las evaluadas. Sin sesiones fechadas, el cálculo anterior.
 * Además, la pantalla del tablero usa la evaluación del servidor (comprobación estructural).
 *
 *   node server/__test__/interventionImpact.unit.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = await import('../interventionAnalyticsService.js');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);

const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const iv = (studentId, daysAgo, snapshotMs = 0, type = 'sesion_acompanada', patterns = []) => ({ id: `i-${studentId}-${daysAgo}`, studentId, courseId: 'g', type, patternsAtIntervention: patterns,
    readingTimeMsAtIntervention: snapshotMs, createdAt: iso(NOW - daysAgo * DAY) });
const ses = (daysAgo, minutes) => ({ timestamp: NOW - daysAgo * DAY, durationMs: minutes * MIN });
const TL = {
    a: [ses(25, 10), ses(22, 10), ses(18, 10), ses(14, 30), ses(8, 40)],     // 30 min antes del día 16; 70 después
    b: [ses(25, 20), ses(20, 20)],                                           // 40 min antes; nada después
    c: [ses(10, 10), ses(1, 10)],
    d: [ses(5, 3)],                                                          // nada antes; 3 min después
    e: [ses(5, 0.5)],                                                        // nada antes; medio minuto después
    f: [ses(30, 50), ses(5, 9)],                                             // 50 antes; 9 después (×1,18)
    g: [ses(30, 50), ses(5, 11)],                                            // 50 antes; 11 después (×1,22)
};
const map = { a: 100 * MIN, b: 40 * MIN, c: 20 * MIN, d: 3 * MIN, e: 30_000, f: 59 * MIN, g: 61 * MIN };
const impact = (i) => S.computeImpact(i, map, TL, NOW);

console.log('\n[1] la regla, con una sola fuente');
ok('creció de 30 a 100 min: mejoró', impact(iv('a', 16)) === 'improved');
ok('40 min antes y nada después: sin cambio, aunque el cliente hubiera guardado 0', impact(iv('b', 16, 0)) === 'unchanged');
ok('…y aunque hubiera guardado una cifra pequeña de otra fuente', impact(iv('b', 16, 5 * MIN)) === 'unchanged');
ok('sin lectura previa: más de un minuto después es mejora; menos, no', impact(iv('d', 16)) === 'improved' && impact(iv('e', 16)) === 'unchanged');
ok('el umbral sigue siendo un 20 %: ×1,18 no, ×1,22 sí', impact(iv('f', 16)) === 'unchanged' && impact(iv('g', 16)) === 'improved');

console.log('\n[2] cuándo no hay evaluación');
ok('intervención de hace menos de tres días: pendiente', impact(iv('c', 1)) === 'pending' && impact(iv('a', 2.9)) === 'pending' && impact(iv('a', 3.1)) !== 'pending');
ok('lector sin ninguna sesión fechada: no comparable', impact(iv('z', 16)) === 'insufficient' && impact(iv('z', 16, 30 * MIN)) === 'insufficient');
ok('pendiente va antes que no comparable', impact(iv('z', 1)) === 'pending');

console.log('\n[3] sin sesiones fechadas (llamadas antiguas) se conserva el cálculo anterior');
ok('misma firma de dos argumentos, mismo resultado que antes', S.computeImpact(iv('a', 16, 30 * MIN), map) === 'improved' && S.computeImpact(iv('b', 16, 0), map) === 'improved'
    && S.computeImpact(iv('b', 16, 40 * MIN), map) === 'unchanged');

console.log('\n[4] agregados sobre las evaluadas');
{
    const list = [iv('a', 16), iv('b', 16), iv('c', 1), iv('z', 16), iv('g', 16, 0, 'contacto_familia'), iv('f', 16, 0, 'contacto_familia')];
    const by = S.computeEffectivenessByType(list, map, TL);
    const sa = by.find((t) => t.type === 'sesion_acompanada'), cf = by.find((t) => t.type === 'contacto_familia');
    ok('sesión acompañada: 4 en total = 1 mejoró + 1 sin cambio + 1 pendiente + 1 no comparable; tasa 1/2', sa.total === 4 && sa.improved === 1 && sa.unchanged === 1 && sa.pending === 1 && sa.insufficient === 1
        && sa.evaluated === 2 && sa.improvementRate === 0.5, JSON.stringify(sa));
    ok('contacto con la familia: 2 evaluadas, 1 mejoró', cf.total === 2 && cf.evaluated === 2 && cf.improved === 1 && cf.improvementRate === 0.5 && cf.pending === 0, JSON.stringify(cf));
    ok('los estados suman el total en cada estrategia', by.every((t) => t.improved + t.unchanged + t.pending + t.insufficient === t.total));
    ok('las tasas temporales usan como base las que ya tienen el plazo mínimo', sa.immediateRate === sa.immediateCount / 3 && sa.sustainedRate === sa.sustainedCount / 3);
    const none = S.computeEffectivenessByType([iv('c', 1), iv('z', 16)], map, TL)[0];
    ok('sin ninguna evaluada no hay tasa inventada (0 sobre 0 evaluadas, no «0 % de 2»)', none.evaluated === 0 && none.improvementRate === 0 && none.total === 2);
    const pat = S.computeSuccessPatterns([iv('a', 16, 0, 'x', ['p']), iv('b', 16, 0, 'x', ['p']), iv('c', 1, 0, 'x', ['p']), iv('z', 16, 0, 'x', ['p'])], map, TL);
    ok('patrones de éxito: las pendientes y las no comparables no cuentan ni a favor ni en contra', pat.length === 1 && pat[0].total === 2 && pat[0].improved === 1 && pat[0].improvementRate === 0.5, JSON.stringify(pat));
    const hist = S.buildStudentInterventionHistory([iv('a', 16, 5 * MIN)], 'a', map, TL)[0], hp = S.buildStudentInterventionHistory([iv('c', 1)], 'c', map, TL)[0];
    ok('historial: razón de crecimiento 100/30 = 3,33 (no 100/5 de la cifra del cliente); pendiente sin razón', hist.impact === 'improved' && hist.timeGrowthRatio === 3.33 && hp.impact === 'pending' && hp.timeGrowthRatio === null,
        JSON.stringify([hist.timeGrowthRatio, hp.timeGrowthRatio]));
}

console.log('\n[5] la pantalla del tablero usa la evaluación del servidor');
{
    const tsx = fs.readFileSync(path.join(HERE, '..', '..', 'pages', 'DashboardMediador.tsx'), 'utf8');
    ok('ya no recalcula la evaluación con su propia fórmula', !/function computeInterventionImpact/.test(tsx) && /lastIntervention\?\.impact \?\? null/.test(tsx));
    ok('distingue la intervención en seguimiento', /impact === 'pending'/.test(tsx) && /En seguimiento/.test(tsx));
    ok('el porcentaje se dice sobre las evaluadas y cuenta aparte pendientes y no comparables', /totalEvaluated \?\? effectiveness\.totalInterventions\} evaluadas\)/.test(tsx) && /totalPending/.test(tsx)
        && /totalNotComparable/.test(tsx) && /en seguimiento \(recientes, aún sin evaluar\)/.test(tsx));
    ok('sin ninguna evaluada no muestra un porcentaje', /\? `\$\{Math\.round\(effectiveness\.overallImprovementRate \* 100\)\}%` : '—'/.test(tsx));
}

console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
