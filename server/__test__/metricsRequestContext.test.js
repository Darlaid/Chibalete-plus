/**
 * metricsRequestContext.test.js — CHP-STATS-LEGACY-PERF-01B.
 *
 * Verifica que el contexto de petición produce EXACTAMENTE los mismos números
 * que el camino legacy, y que no introduce estado entre peticiones.
 *
 * La regla que ordena esta suite: una optimización que cambie una sola cifra es
 * un fallo, por mucho que sea más rápida. Por eso la comparación es byte a byte
 * (salvo `computedAt`, que es un sello de instante) y no una tolerancia.
 *
 * Fixtures sintéticas. Ningún store real, ningún WAL/SHM, ninguna PII.
 *
 *   node server/__test__/metricsRequestContext.test.js
 */
import './helpers/testMode.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = pathToFileURL(path.join(HERE, '..', 'metricsService.js')).href;
const metrics = await import(M);

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);

const VOLATILE = new Set(['computedAt']);
function diff(a, b, p = '') {
    if (a === b) return null;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) return `${p}: ${ta} vs ${tb}`;
    if (ta === 'array') {
        if (a.length !== b.length) return `${p}: longitud ${a.length} vs ${b.length}`;
        for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
        return null;
    }
    if (ta === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join(',') !== kb.join(',')) return `${p}: claves ${ka.length} vs ${kb.length}`;
        for (const k of ka) { if (VOLATILE.has(k)) continue; const d = diff(a[k], b[k], p ? `${p}.${k}` : k); if (d) return d; }
        return null;
    }
    if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
    return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

// ── fixture sintética ───────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;
function makeFixture() {
    const users = [];
    const groups = [];
    const events = [];
    const progressMap = {};

    // 3 grupos: con actividad, sin actividad, y uno que comparte alumnos con el
    // primero (para que un mismo alumno se pida dos veces, como en la realidad).
    for (let g = 1; g <= 3; g++) {
        groups.push({ id: `grp-${g}`, name: `Grupo ${g}`, school: g === 3 ? 'Colegio B' : 'Colegio A',
                      memberIds: [], studentIds: [], teacherId: null });
    }
    for (let i = 1; i <= 12; i++) {
        const id = `usr-${i}`;
        users.push({ id, nombre_completo: `Persona ${i}`, roles: ['lector'], organizationId: 'org-a' });
        const g = i <= 6 ? 0 : (i <= 9 ? 1 : 2);
        groups[g].studentIds.push(id);
        groups[g].memberIds.push(id);
    }
    // Alumnos compartidos entre grupo 1 y 2 → el mismo alumno se calcula dos veces.
    groups[1].studentIds.push('usr-1', 'usr-2');
    groups[1].memberIds.push('usr-1', 'usr-2');

    // Eventos: usuarios 1..5 con sesiones; 6..12 sin ninguno.
    let ts = T0;
    for (let i = 1; i <= 5; i++) {
        const u = `usr-${i}`;
        for (let s = 0; s < i; s++) {
            events.push({ userId: u, event: 'session_start', contentId: `c-${s % 3}`, timestamp: ts++, streak: s });
            events.push({ userId: u, event: 'block_complete', contentId: `c-${s % 3}`, timestamp: ts++, streak: s + 1 });
            events.push({ userId: u, event: 'session_end', contentId: `c-${s % 3}`, timestamp: ts++, progressPercentage: 40 + s });
        }
        // evento huérfano: session_start sin end (sesión incompleta)
        events.push({ userId: u, event: 'session_start', contentId: 'c-orphan', timestamp: ts++, streak: 0 });
        events.push({ userId: u, event: 'leo_interaction_attempted', contentId: 'c-0', timestamp: ts++ });
        // tipo desconocido: debe ignorarse sin romper
        events.push({ userId: u, event: 'tipo_desconocido', contentId: 'c-0', timestamp: ts++ });
    }
    // evento de un usuario que no está en el padrón
    events.push({ userId: 'usr-fantasma', event: 'session_start', contentId: 'c-0', timestamp: ts++ });

    // Progreso: usuarios 1..4, con DUPLICADOS para el mismo usuario.
    let k = 0;
    for (let i = 1; i <= 4; i++) {
        for (let d = 0; d < (i === 2 ? 3 : 1); d++) {
            progressMap[`p-${k++}`] = {
                userId: `usr-${i}`, contentId: `c-${d}`,
                canonicalProgress: { globalPercentage: 20 * i + d },
                history: [{ durationSec: 60 * i }, { durationSec: 30 }],
                updatedAt: new Date(T0 - d * 86_400_000).toISOString(),
                isCompleted: i === 4,
            };
        }
    }

    return {
        events, groups, users,
        leoMemory: { memoryMap: { 'usr-1__a': { stage: 'comprehension', difficulty: 'medio' },
                                  'usr-3__b': { stage: 'reflection', difficulty: 'avanzado' } } },
        leoInteractions: [{ userId: 'usr-1', interactionType: 'pregunta', contentId: 'c-0' },
                          { userId: 'usr-1', interactionType: 'pregunta', contentId: 'c-1' }],
        progress: { progressMap },
    };
}

const FIX = makeFixture();
const ALL_USERS = FIX.users.map(u => u.id);

console.log('metricsRequestContext — CHP-STATS-LEGACY-PERF-01B');

// ── [1] flag ────────────────────────────────────────────────────────────────
section('[1] feature flag');
{
    ok('[1a] ausente → off', metrics.resolveRequestContextFlag({}) === false);
    ok('[1b] vacío → off', metrics.resolveRequestContextFlag({ LEGACY_METRICS_REQUEST_CONTEXT: '' }) === false);
    ok('[1c] "off" → off', metrics.resolveRequestContextFlag({ LEGACY_METRICS_REQUEST_CONTEXT: 'off' }) === false);
    ok('[1d] "on" → on', metrics.resolveRequestContextFlag({ LEGACY_METRICS_REQUEST_CONTEXT: 'on' }) === true);
    let threw = false;
    try { metrics.resolveRequestContextFlag({ LEGACY_METRICS_REQUEST_CONTEXT: 'quizas' }); } catch (e) { threw = e.code === 'METRICS_CONFIG_ERROR'; }
    ok('[1e] valor inválido → error explícito, no default silencioso', threw);
}

// ── [2] exactitud alumno a alumno ──────────────────────────────────────────
section('[2] exactitud: legacy vs contexto');
{
    metrics.init(FIX);
    const ctx = metrics.createMetricsRequestContext();
    let bad = 0, firstDiff = null;
    for (const u of [...ALL_USERS, 'usr-fantasma', 'usr-inexistente']) {
        const legacy = metrics.computeStudentMetrics(u);
        const opt    = metrics.computeStudentMetrics(u, { context: ctx });
        const d = diff(legacy, opt);
        if (d) { bad++; firstDiff ??= `${u} → ${d}`; }
    }
    ok(`[2a] ${ALL_USERS.length + 2} usuarios idénticos (incl. sin datos y fantasma)`, bad === 0, firstDiff ?? '');
    ctx.dispose();
}

section('[3] exactitud: curso e institución');
{
    metrics.init(FIX);
    metrics.__setRequestContextEnabledForTests(false);
    const cursoLegacy   = metrics.computeCourseMetrics('grp-1');
    const colegioLegacy = metrics.computeSchoolMetrics('Colegio A');
    const vacioLegacy   = metrics.computeCourseMetrics('grp-2');

    metrics.__setRequestContextEnabledForTests(true);
    const cursoOpt   = metrics.computeCourseMetrics('grp-1');
    const colegioOpt = metrics.computeSchoolMetrics('Colegio A');
    const vacioOpt   = metrics.computeCourseMetrics('grp-2');
    metrics.__setRequestContextEnabledForTests(false);

    ok('[3a] curso con actividad idéntico', diff(cursoLegacy, cursoOpt) === null, diff(cursoLegacy, cursoOpt) ?? '');
    ok('[3b] institución idéntica', diff(colegioLegacy, colegioOpt) === null, diff(colegioLegacy, colegioOpt) ?? '');
    ok('[3c] grupo sin actividad idéntico', diff(vacioLegacy, vacioOpt) === null, diff(vacioLegacy, vacioOpt) ?? '');

    let threwL = null, threwO = null;
    try { metrics.computeSchoolMetrics('Colegio Inexistente'); } catch (e) { threwL = e.message; }
    metrics.__setRequestContextEnabledForTests(true);
    try { metrics.computeSchoolMetrics('Colegio Inexistente'); } catch (e) { threwO = e.message; }
    metrics.__setRequestContextEnabledForTests(false);
    ok('[3d] institución sin grupos lanza el mismo error', threwL !== null && threwL === threwO);
}

// ── [4] índices: orden, duplicados, ausencia ───────────────────────────────
section('[4] índices exactos');
{
    metrics.init(FIX);
    const ctx = metrics.createMetricsRequestContext();
    const allProgress = Object.values(FIX.progress.progressMap);
    let bad = 0, orderBad = 0;
    for (const u of ALL_USERS) {
        const scan = allProgress.filter(p => p.userId === u);
        const idx  = ctx.progressFor(u);
        if (scan.length !== idx.length) bad++;
        else for (let i = 0; i < scan.length; i++) if (scan[i] !== idx[i]) { orderBad++; break; }
    }
    ok('[4a] progreso: mismos registros por usuario', bad === 0);
    ok('[4b] progreso: mismo orden y duplicados preservados', orderBad === 0);
    ok('[4c] usuario con 3 registros duplicados los conserva', ctx.progressFor('usr-2').length === 3);
    ok('[4d] usuario sin progreso → [] (no null, no 0)',
        Array.isArray(ctx.progressFor('usr-12')) && ctx.progressFor('usr-12').length === 0);
    ok('[4e] usuario sin eventos → []',
        Array.isArray(ctx.eventsFor('usr-12')) && ctx.eventsFor('usr-12').length === 0);
    ok('[4f] usuario sin sesiones → []', ctx.sessionsFor('usr-12').length === 0);

    let evBad = 0;
    for (const u of ALL_USERS) {
        if (FIX.events.filter(e => e.userId === u).length !== ctx.eventsFor(u).length) evBad++;
    }
    ok('[4g] eventos: mismas rebanadas', evBad === 0);
    ctx.dispose();
}

// ── [5] memoización ────────────────────────────────────────────────────────
section('[5] memoización');
{
    metrics.init(FIX);
    const ctx = metrics.createMetricsRequestContext();
    metrics.computeStudentMetrics('usr-1', { context: ctx });
    ok('[5a] primer cálculo → miss', ctx.counters.memoMisses === 1 && ctx.counters.memoHits === 0);
    const a = metrics.computeStudentMetrics('usr-1', { context: ctx });
    ok('[5b] segundo cálculo → hit', ctx.counters.memoHits === 1);
    const b = metrics.computeStudentMetrics('usr-1', { context: ctx });
    ok('[5c] el hit devuelve la misma instancia', a === b);
    metrics.computeStudentMetrics('usr-2', { context: ctx });
    ok('[5d] otro usuario → miss', ctx.counters.memoMisses === 2);

    // Contexto nuevo dentro de la misma generación: memo vacía.
    const ctx2 = metrics.createMetricsRequestContext();
    ok('[5e] contexto nuevo arranca con memo vacía', ctx2.memo.size === 0);
    ok('[5f] el contexto anterior no es visible desde el nuevo',
        ctx2.counters.memoHits === 0 && ctx2.counters.memoMisses === 0);
    ctx.dispose(); ctx2.dispose();
}

// ── [6] sin contexto = legacy exacto ───────────────────────────────────────
section('[6] call sites sin contexto');
{
    metrics.init(FIX);
    const before = metrics.metricsContextCounters.metrics_legacy_fallback_calls_total;
    const r = metrics.computeStudentMetrics('usr-1');
    ok('[6a] funciona sin argumento de opciones', r && r.userId === 'usr-1');
    ok('[6b] se contabiliza como llamada legacy',
        metrics.metricsContextCounters.metrics_legacy_fallback_calls_total === before + 1);
    ok('[6c] options vacío se comporta igual', diff(r, metrics.computeStudentMetrics('usr-1', {})) === null);
}

// ── [7] generación: un contexto no sobrevive a init() ──────────────────────
section('[7] el contexto no cruza peticiones');
{
    metrics.init(FIX);
    const ctx = metrics.createMetricsRequestContext();
    metrics.computeStudentMetrics('usr-1', { context: ctx });

    metrics.init(FIX);                       // nueva "petición": datos recargados
    let threw = false;
    try { metrics.computeStudentMetrics('usr-1', { context: ctx }); } catch { threw = true; }
    ok('[7a] usar un contexto tras init() lanza en vez de devolver cifras viejas', threw);

    ctx.dispose();
    let threwDisposed = false;
    try { ctx.progressFor('usr-1'); } catch { threwDisposed = true; }
    ok('[7b] un contexto liberado no se puede seguir usando', threwDisposed);
    ok('[7c] dispose vacía las estructuras', ctx.memo.size === 0 && ctx.progressByUser.size === 0);
}

// ── [8] aislamiento ante mutación ──────────────────────────────────────────
section('[8] el resultado memoizado no se contamina');
{
    metrics.init(FIX);
    const ctx = metrics.createMetricsRequestContext();
    const first = metrics.computeStudentMetrics('usr-1', { context: ctx });
    const snapshot = JSON.parse(JSON.stringify({ ...first, computedAt: 0 }));

    // Ningún consumidor debería mutar; si alguno lo hiciera, esto lo delata.
    const second = metrics.computeStudentMetrics('usr-1', { context: ctx });
    const after = JSON.parse(JSON.stringify({ ...second, computedAt: 0 }));
    ok('[8a] dos lecturas del memo son equivalentes', JSON.stringify(snapshot) === JSON.stringify(after));

    // El índice no debe exponer el array interno para que lo mutan.
    const slice1 = ctx.progressFor('usr-12');
    let frozenOk = true;
    try { slice1.push({ userId: 'usr-12' }); } catch { /* congelado */ }
    if (ctx.progressFor('usr-12').length !== 0) frozenOk = false;
    ok('[8b] la lista vacía compartida no puede crecer por accidente', frozenOk);
    ctx.dispose();
}

// ── [9] concurrencia: contextos independientes ─────────────────────────────
section('[9] concurrencia');
{
    metrics.init(FIX);
    const N = 50;
    const contexts = Array.from({ length: N }, () => metrics.createMetricsRequestContext());
    const results = await Promise.all(contexts.map(async (c, i) => {
        const u = ALL_USERS[i % ALL_USERS.length];
        return { u, r: metrics.computeStudentMetrics(u, { context: c }) };
    }));
    let bad = 0;
    for (const { u, r } of results) if (r.userId !== u) bad++;
    ok(`[9a] ${N} contextos concurrentes sin datos cruzados`, bad === 0);
    ok('[9b] cada contexto tiene su propia memo',
        contexts.every(c => c.memo.size === 1));
    ok('[9c] ningún contexto acumuló hits de otro',
        contexts.every(c => c.counters.memoHits === 0));
    contexts.forEach(c => c.dispose());
    ok('[9d] todos liberados', contexts.every(c => c.disposed === true));
}

// ── [10] escaneos: el trabajo deja de repetirse ────────────────────────────
section('[10] el trabajo repetido desaparece');
{
    metrics.init(FIX);
    const ctx = metrics.createMetricsRequestContext();
    const before = { ...ctx.counters };
    // 'Colegio A' tiene grupos 1 y 2; usr-1 y usr-2 están en ambos.
    const distintos = new Set([...FIX.groups[0].studentIds, ...FIX.groups[1].studentIds]).size;
    metrics.computeSchoolMetrics('Colegio A', { context: ctx });
    ok('[10a] cada alumno se calcula una sola vez',
        ctx.counters.memoMisses - before.memoMisses === distintos,
        `misses=${ctx.counters.memoMisses} distintos=${distintos}`);
    ok('[10b] la segunda pasada son aciertos de memo', ctx.counters.memoHits > 0);
    ctx.dispose();
}

// ── [11] observabilidad sin PII ────────────────────────────────────────────
section('[11] contadores');
{
    const c = metrics.metricsContextCounters;
    const keys = Object.keys(c);
    ok('[11a] todos los contadores son numéricos', keys.every(k => typeof c[k] === 'number'));
    const blob = JSON.stringify(c);
    ok('[11b] los contadores no contienen identificadores',
        !/usr-|grp-|org-|Colegio|@/.test(blob), blob.slice(0, 120));
    ok('[11c] se contabilizan creaciones y liberaciones',
        c.metrics_request_context_created_total > 0 && c.metrics_request_context_disposed_total > 0);
}

console.log(`\nmetricsRequestContext: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
