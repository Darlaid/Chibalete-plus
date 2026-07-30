/**
 * metricsContextRatchet.test.js — CHP-STATS-LEGACY-PERF-01E, Fase 16.
 *
 * TRINQUETE estructural del contexto por petición. Corre en CI y **no** ejecuta
 * el benchmark HTTP: lo que protege son las propiedades de las que depende la
 * mejora, para que no se pierdan en un refactor posterior.
 *
 * La clasificación de rutas que verifica aquí no es una suposición: se
 * comprobó por HTTP con los contadores del servidor que solo las agregaciones
 * multiusuario crean contexto, y que el listado, la ruta de un alumno, el 404
 * previo al cálculo y los 401/403 no crean ninguno.
 *
 * Fixtures sintéticas, sin stores reales, sin red.
 *
 *   node server/__test__/metricsContextRatchet.test.js
 */
import './helpers/testMode.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const metrics = await import(pathToFileURL(path.join(HERE, '..', 'metricsService.js')).href);

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);

// ── fixture sintética ──────────────────────────────────────────────────────
const NOW = 1800000000000;
const users = [], groups = [], events = [], progressMap = {};
for (let g = 1; g <= 2; g++) {
    groups.push({ id: `g-${g}`, name: `Grupo ${g}`, school: 'Colegio Uno',
                  memberIds: [], studentIds: [], teacherId: null });
}
for (let i = 1; i <= 10; i++) {
    const id = `u-${i}`;
    users.push({ id, nombre_completo: `P${i}`, roles: ['lector'], organizationId: 'o-1' });
    const gi = i <= 6 ? 0 : 1;
    groups[gi].studentIds.push(id); groups[gi].memberIds.push(id);
}
// Solapamiento deliberado: el mismo alumno en los dos grupos del colegio.
groups[1].studentIds.push('u-1', 'u-2'); groups[1].memberIds.push('u-1', 'u-2');
let ts = NOW - 1_000_000;
for (let i = 1; i <= 5; i++) {
    for (let s = 0; s < 2; s++) {
        events.push({ userId: `u-${i}`, event: 'session_start', contentId: 'c-1', timestamp: ts++, streak: 0 });
        events.push({ userId: `u-${i}`, event: 'session_end',   contentId: 'c-1', timestamp: ts++, progressPercentage: 50 });
    }
}
let k = 0;
for (let i = 1; i <= 5; i++) {
    progressMap[`p-${k++}`] = { userId: `u-${i}`, contentId: 'c-1',
        canonicalProgress: { globalPercentage: 20 * i }, history: [{ durationSec: 30 }],
        updatedAt: new Date(NOW).toISOString(), isCompleted: false };
}
const RAW = { events, groups, users, progress: { progressMap },
              leoMemory: { memoryMap: {} }, leoInteractions: [] };

const snapshot = () => ({ ...metrics.metricsContextCounters });
const delta = (a, b) => Object.fromEntries(Object.keys(b).map(k2 => [k2, b[k2] - a[k2]]));

console.log('metricsContextRatchet — CHP-STATS-LEGACY-PERF-01E');

section('[1] el contexto solo aparece en agregaciones multiusuario');
{
    metrics.init(RAW);
    metrics.__setRequestContextEnabledForTests(true);

    let a = snapshot(); metrics.computeStudentMetrics('u-1');
    let d = delta(a, snapshot());
    ok('[1a] alumno directo NO crea contexto', d.metrics_request_context_created_total === 0);
    ok('[1b] alumno directo cuenta como llamada sin contexto', d.metrics_legacy_fallback_calls_total === 1);

    a = snapshot(); metrics.computeCourseMetrics('g-1');
    d = delta(a, snapshot());
    ok('[1c] curso crea exactamente un contexto', d.metrics_request_context_created_total === 1);
    ok('[1d] y lo libera', d.metrics_request_context_disposed_total === 1);

    a = snapshot(); metrics.computeSchoolMetrics('Colegio Uno');
    d = delta(a, snapshot());
    ok('[1e] institución crea exactamente un contexto', d.metrics_request_context_created_total === 1,
        String(d.metrics_request_context_created_total));
    ok('[1f] y lo libera', d.metrics_request_context_disposed_total === 1);
    metrics.__setRequestContextEnabledForTests(false);
}

section('[2] un scan por petición, no uno por alumno');
{
    metrics.init(RAW);
    const ctx = metrics.createMetricsRequestContext();
    // Los índices se construyen en el constructor: una sola pasada por progreso
    // y una sola por eventos, con independencia de cuántos alumnos se pidan.
    const distintos = new Set([...groups[0].studentIds, ...groups[1].studentIds]);
    for (const u of distintos) metrics.computeStudentMetrics(u, { context: ctx });
    for (const u of distintos) metrics.computeStudentMetrics(u, { context: ctx });

    ok('[2a] cada alumno se calcula una sola vez',
        ctx.counters.memoMisses === distintos.size, `misses=${ctx.counters.memoMisses} distintos=${distintos.size}`);
    ok('[2b] la segunda pasada son aciertos', ctx.counters.memoHits === distintos.size);
    ok('[2c] el índice de progreso existe y es único',
        ctx.progressByUser instanceof Map && ctx.progressByUser.size > 0);
    ok('[2d] el índice de sesiones existe y es único', ctx.sessionsByUser instanceof Map);
    ctx.dispose();
}

section('[3] flag apagado: ni un solo contexto');
{
    metrics.init(RAW);
    metrics.__setRequestContextEnabledForTests(false);
    const a = snapshot();
    metrics.computeSchoolMetrics('Colegio Uno');
    metrics.computeCourseMetrics('g-1');
    metrics.computeStudentMetrics('u-1');
    const d = delta(a, snapshot());
    ok('[3a] con el flag off no se crea ningún contexto', d.metrics_request_context_created_total === 0);
    ok('[3b] todo pasa por el camino legacy', d.metrics_legacy_fallback_calls_total > 0);
}

section('[4] liberación del contexto');
{
    metrics.init(RAW);
    const ctx = metrics.createMetricsRequestContext();
    metrics.computeStudentMetrics('u-1', { context: ctx });
    ok('[4a] antes de liberar, la memo tiene contenido', ctx.memo.size === 1);
    ctx.dispose();
    ok('[4b] tras liberar, memo e índices quedan vacíos',
        ctx.memo.size === 0 && ctx.progressByUser.size === 0 && ctx.sessionsByUser.size === 0);
    let threw = false;
    try { ctx.progressFor('u-1'); } catch { threw = true; }
    ok('[4c] un contexto liberado ya no se puede usar', threw);
}

section('[5] paridad estructural off vs on sobre la misma fixture');
{
    const VOL = new Set(['computedAt']);
    const diff = (a, b, p = '') => {
        if (a === b) return null;
        const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
        const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
        if (ta !== tb) return `${p}: ${ta} vs ${tb}`;
        if (ta === 'array') {
            if (a.length !== b.length) return `${p}: longitud`;
            for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
            return null;
        }
        if (ta === 'object') {
            const ka = Object.keys(a), kb = Object.keys(b);
            if (ka.join(',') !== kb.join(',')) return `${p}: claves`;
            for (const kk of ka) { if (VOL.has(kk)) continue; const d = diff(a[kk], b[kk], p ? `${p}.${kk}` : kk); if (d) return d; }
            return null;
        }
        return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
    };

    metrics.init(RAW);
    metrics.__setRequestContextEnabledForTests(false);
    const offSchool = metrics.computeSchoolMetrics('Colegio Uno');
    const offCourse = metrics.computeCourseMetrics('g-1');
    metrics.__setRequestContextEnabledForTests(true);
    const onSchool = metrics.computeSchoolMetrics('Colegio Uno');
    const onCourse = metrics.computeCourseMetrics('g-1');
    metrics.__setRequestContextEnabledForTests(false);

    ok('[5a] institución idéntica', diff(offSchool, onSchool) === null, diff(offSchool, onSchool) ?? '');
    ok('[5b] curso idéntico', diff(offCourse, onCourse) === null, diff(offCourse, onCourse) ?? '');
}

section('[6] sin estado entre peticiones');
{
    metrics.init(RAW);
    const c1 = metrics.createMetricsRequestContext();
    metrics.computeStudentMetrics('u-1', { context: c1 });
    const c2 = metrics.createMetricsRequestContext();
    ok('[6a] un contexto nuevo arranca con memo vacía', c2.memo.size === 0);
    metrics.computeStudentMetrics('u-1', { context: c2 });
    ok('[6b] y su primer cálculo es un miss, no un acierto heredado',
        c2.counters.memoMisses === 1 && c2.counters.memoHits === 0);
    c1.dispose(); c2.dispose();
}

console.log(`\nmetricsContextRatchet: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
