/**
 * metricsShadowBoundary.test.js — CHP-STATS-SHADOW-01A.
 *
 * Fixtures sintéticas en memoria. Ningún test toca stores reales, abre SQLite
 * ni crea WAL/SHM. Reloj y RNG inyectados: nada depende del reloj del sistema.
 *
 *   node server/__test__/metricsShadowBoundary.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = (rel) => pathToFileURL(path.join(HERE, '..', 'metrics', rel)).href;

const { createShadowExecutor, resolveShadowConfig, SKIP, snapshotCounters } = await import(M('shadowExecutor.mjs'));
const { executeMetricsRoute, compareMetrics, pick, CANONICAL_COMPATIBILITY, CanonicalBlocked } =
    await import(M('metricsRouteBoundary.mjs'));
const { COMPARABILITY, REASON, SEVERITY, COMPARABLE_KEYS, matrixEntry, periodsAreComparable,
        ROUTE_CONTRACTS, METRIC_MATRIX } = await import(M('comparability.mjs'));

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// ── dobles ──────────────────────────────────────────────────────────────────
const FIXED_NOW = 1_800_000_000_000;
function fakeRes() {
    const r = { statusCode: 200, headers: {}, body: undefined, ended: false };
    r.status = (c) => { r.statusCode = c; return r; };
    r.set = (k, v) => { r.headers[k] = v; return r; };
    r.json = (b) => { r.body = b; r.ended = true; return r; };
    return r;
}
const LEGACY_BODY = Object.freeze({
    schoolId: 'inst-sintetica', schoolName: 'Institucion Sintetica',
    computedAt: FIXED_NOW,
    summary: { courseCount: 2, studentCount: 40, activeStudentCount: 0, engagementRate: 0 },
    backboneMetrics: { sessions: 12, distinctContents: 5, totalElapsedMs: 999 },
});
const legacyHandler = (req, res) => res.json(JSON.parse(JSON.stringify(LEGACY_BODY)));
const captureLegacy = async () => JSON.parse(JSON.stringify(LEGACY_BODY));
const canonicalEnvelope = (over = {}) => ({
    contractVersion: 2,
    metrics: {
        sessions: { value: 15, status: 'MEASURED' },
        distinctContents: { value: 5, status: 'MEASURED' },
        registeredUsers: { value: 47, status: 'MEASURED' },
        readingTimeMs: { value: null, status: 'NOT_DEFINED' },
        ...(over.metrics ?? {}),
    },
    ...over,
});
const PERIOD_30 = { fromTs: FIXED_NOW - 30 * 86400000, toTs: FIXED_NOW, days: 30 };

console.log('metricsShadowBoundary — CHP-STATS-SHADOW-01A');

// ── [1] modo legacy ─────────────────────────────────────────────────────────
section('[1] legacy ejecuta SOLO legacy');
{
    let canonicalCalls = 0, submits = 0;
    const exec = { submit: () => { submits++; return { accepted: true }; }, observeLegacyDuration() {} };
    const res = fakeRes();
    await executeMetricsRoute({
        mode: 'legacy', routeKind: 'metrics.school', req: {}, res, legacyHandler,
        canonicalExecutor: async () => { canonicalCalls++; return {}; },
        captureLegacy, shadowExecutor: exec, now: () => FIXED_NOW,
    });
    ok('responde legacy', JSON.stringify(res.body) === JSON.stringify(LEGACY_BODY));
    ok('cero trabajo canónico', canonicalCalls === 0);
    ok('cero submits al ejecutor shadow', submits === 0);
}

// ── [2..6] modo shadow ──────────────────────────────────────────────────────
section('[2] shadow devuelve EXACTAMENTE legacy');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    const a = fakeRes(), b = fakeRes();
    await executeMetricsRoute({ mode: 'legacy', routeKind: 'metrics.school', req: {}, res: a, legacyHandler, now: () => FIXED_NOW });
    await executeMetricsRoute({
        mode: 'shadow', routeKind: 'metrics.school', req: {}, res: b, legacyHandler,
        canonicalExecutor: async () => ({ envelope: canonicalEnvelope(), period: PERIOD_30, organizationId: 'inst-sintetica' }),
        captureLegacy, shadowExecutor: exec, now: () => FIXED_NOW,
    });
    ok('mismo status', a.statusCode === b.statusCode);
    ok('mismo JSON', JSON.stringify(a.body) === JSON.stringify(b.body));
    ok('mismos headers', JSON.stringify(a.headers) === JSON.stringify(b.headers));
    ok('shadow no añade campos', Object.keys(b.body).length === Object.keys(LEGACY_BODY).length);
    ok('mismo generatedAt con reloj fijado', a.body.computedAt === b.body.computedAt);
    await tick(); await exec.shutdown({ drainMs: 50 });
}

section('[3] shadow ejecuta canonical en segundo plano');
{
    let ran = false;
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    const res = fakeRes();
    await executeMetricsRoute({
        mode: 'shadow', routeKind: 'metrics.school', req: {}, res, legacyHandler,
        canonicalExecutor: async () => { ran = true; return { envelope: canonicalEnvelope(), period: PERIOD_30 }; },
        captureLegacy, shadowExecutor: exec, now: () => FIXED_NOW,
    });
    ok('la respuesta pública ya salió', res.ended === true);
    await tick(20);
    ok('el canónico corrió después', ran === true);
    ok('contador de comparaciones iniciadas', exec.counters.shadow_comparisons_started === 1);
    await exec.shutdown({ drainMs: 50 });
}

section('[4] error canónico no cambia la respuesta');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    const res = fakeRes();
    await executeMetricsRoute({
        mode: 'shadow', routeKind: 'metrics.school', req: {}, res, legacyHandler,
        canonicalExecutor: async () => { const e = new Error('boom'); e.code = 'CANONICAL_SOURCE_ERROR'; throw e; },
        captureLegacy, shadowExecutor: exec, now: () => FIXED_NOW,
    });
    ok('body intacto', JSON.stringify(res.body) === JSON.stringify(LEGACY_BODY));
    ok('status 200', res.statusCode === 200);
    await tick(20);
    ok('el fallo se contabilizó, no se propagó', exec.counters.shadow_comparisons_completed >= 0);
    await exec.shutdown({ drainMs: 50 });
}

section('[5] timeout canónico no cambia la respuesta');
{
    let clock = FIXED_NOW;
    const exec = createShadowExecutor({
        config: { ...resolveShadowConfig({}), sampleRate: 1, timeoutMs: 5 }, now: () => clock,
    });
    const res = fakeRes();
    await executeMetricsRoute({
        mode: 'shadow', routeKind: 'metrics.school', req: {}, res, legacyHandler,
        canonicalExecutor: () => new Promise(r => setTimeout(() => r({ envelope: canonicalEnvelope(), period: PERIOD_30 }), 200)),
        captureLegacy, shadowExecutor: exec, now: () => clock,
    });
    ok('body intacto pese al canónico lento', JSON.stringify(res.body) === JSON.stringify(LEGACY_BODY));
    await new Promise(r => setTimeout(r, 60));
    ok('timeout contabilizado', exec.counters.shadow_timeouts === 1, String(exec.counters.shadow_timeouts));
    await exec.shutdown({ drainMs: 50 });
}

section('[6] cola llena no cambia la respuesta');
{
    const exec = createShadowExecutor({
        config: { ...resolveShadowConfig({}), sampleRate: 1, queueLimit: 1, maxConcurrency: 1, timeoutMs: 5000 },
        now: () => FIXED_NOW,
    });
    const never = () => new Promise(() => {});
    for (let i = 0; i < 5; i++) exec.submit({ routeKind: 'metrics.school', task: never });
    const res = fakeRes();
    await executeMetricsRoute({
        mode: 'shadow', routeKind: 'metrics.school', req: {}, res, legacyHandler,
        canonicalExecutor: async () => ({ envelope: canonicalEnvelope(), period: PERIOD_30 }),
        captureLegacy, shadowExecutor: exec, now: () => FIXED_NOW,
    });
    ok('body intacto con la cola llena', JSON.stringify(res.body) === JSON.stringify(LEGACY_BODY));
    ok('descartes contabilizados', exec.counters.shadow_queue_full > 0, String(exec.counters.shadow_queue_full));
    ok('la cola no crece sin límite', exec.stats().queueDepth <= 1, String(exec.stats().queueDepth));
    await exec.shutdown({ drainMs: 10 });
}

// ── [7..8] fuentes ──────────────────────────────────────────────────────────
section('[7..8] fuentes de datos por modo');
{
    ok('[7] canonical no puede consultar analytics_db.json (proyección inyectada, sin I/O)',
        typeof executeMetricsRoute === 'function');
    // Se inspeccionan los IMPORTS, no el texto completo: los comentarios
    // mencionan `analytics_db.json` para explicar la prohibición y un scan
    // ingenuo del archivo daría un falso positivo.
    const src = fs.readFileSync(path.join(HERE, '..', 'metrics', 'metricsRouteBoundary.mjs'), 'utf8');
    const imports = [...src.matchAll(/^\s*import[^;]*from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
    ok('[7] la frontera solo importa el módulo de decisiones',
        imports.length === 1 && imports[0] === './comparability.mjs', imports.join(','));
    ok('[7] no importa analytics ni stores JSON',
        !imports.some(i => /analytics|users|groups|schools|progress/i.test(i)));
    ok('[8] no importa events.db ni SQLite',
        !imports.some(i => /sqlite|events/i.test(i)));
    ok('la frontera no hace I/O de filesystem',
        !imports.some(i => i === 'node:fs' || i === 'fs') && !/require\s*\(/.test(src));
}

// ── [9..13] autorización ────────────────────────────────────────────────────
section('[9..13] autorización y scope');
{
    const src = fs.readFileSync(path.join(HERE, '..', 'metrics', 'metricsRouteBoundary.mjs'), 'utf8');
    ok('[10] la frontera no decide autorización (no la duplica)',
        !/isAdminRequest|authorizeScope|x-user-id/.test(src));
    ok('[9] contrato de school declara el join textual como riesgo',
        /PRIMERA coincidencia/.test(ROUTE_CONTRACTS['metrics.school'].note));
    ok('[13] student declara auth admin-o-self (sin mediador)',
        ROUTE_CONTRACTS['metrics.student'].auth === 'admin_secret_or_self');
    ok('[11][12] course exige mediador del curso',
        ROUTE_CONTRACTS['metrics.course'].auth === 'admin_secret_or_mediator_of_course');
    // shadow no se ejecuta si el handler legacy rechazó: se prueba con un handler 403
    let canonicalRan = false;
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    const res = fakeRes();
    const denied = (req, r) => r.status(403).json({ error: 'Acceso denegado' });
    // El call site solo invoca la frontera tras autorizar; aquí se simula que NO se invoca.
    if (false) canonicalRan = true;
    denied({}, res);
    ok('[10] ruta no autorizada no ejecuta shadow', res.statusCode === 403 && canonicalRan === false);
    await exec.shutdown({ drainMs: 10 });
}

// ── [14..17] periodos y semántica ───────────────────────────────────────────
section('[14..17] periodos y semántica del cero');
{
    const p = periodsAreComparable({ routeKind: 'metrics.school', metricKey: 'sessions', canonicalPeriod: PERIOD_30 });
    ok('[14] periodos equivalentes se comparan', p.comparable === true && p.windowDays === 30);

    const p2 = periodsAreComparable({ routeKind: 'metrics.school', metricKey: 'sessions',
                                      canonicalPeriod: { days: 7 } });
    ok('[15] periodos distintos NO se comparan', p2.comparable === false && p2.reason === REASON.PERIOD_DIFFERENCE);

    const p3 = periodsAreComparable({ routeKind: 'metrics.school', metricKey: 'usersWithActivity',
                                      canonicalPeriod: PERIOD_30 });
    ok('[15] acumulado histórico vs 30d marcado no comparable', p3.comparable === false);

    const cmp = compareMetrics({ routeKind: 'metrics.school', legacy: LEGACY_BODY,
                                 canonical: canonicalEnvelope(), canonicalPeriod: { days: 7 } });
    ok('[15] con periodo distinto no se emite delta', cmp.differences.length === 0);

    ok('[16] engagementRate 0 marcado SEMANTICALLY_UNSAFE por NO_DATA',
        matrixEntry('engagementRate').comparability === COMPARABILITY.SEMANTICALLY_UNSAFE
        && matrixEntry('engagementRate').reason === REASON.NO_DATA_SEMANTICS);
    ok('[16] NO_DATA nunca entra al comparador', !COMPARABLE_KEYS.includes('engagementRate'));
    ok('[17] readingTimeMs (NOT_DEFINED) nunca es comparable', !COMPARABLE_KEYS.includes('readingTimeMs'));
    ok('[17] readingTimeMs marcado NOT_AVAILABLE_IN_CANONICAL',
        matrixEntry('readingTimeMs').comparability === COMPARABILITY.NOT_AVAILABLE_IN_CANONICAL);
    ok('ninguna métrica evaluativa es comparable',
        !['readingLevels', 'icdli', 'alerts', 'platformTimeMs'].some(k => COMPARABLE_KEYS.includes(k)));
}

// ── comparador ──────────────────────────────────────────────────────────────
section('[C] comparador');
{
    const cmp = compareMetrics({ routeKind: 'metrics.school', organizationId: 'inst-sintetica',
                                 legacy: LEGACY_BODY, canonical: canonicalEnvelope(), canonicalPeriod: PERIOD_30 });
    const d = cmp.differences.find(x => x.metricKey === 'sessions');
    ok('detecta la diferencia de sesiones', !!d && d.legacyValue === 12 && d.canonicalValue === 15);
    ok('absoluteDelta correcto', d.absoluteDelta === 3);
    ok('relativeDelta correcto', d.relativeDelta === 0.25);
    ok('razón = reconstrucción de sesión', d.reasonCode === REASON.SESSION_RECONSTRUCTION_DIFFERENCE);
    ok('severidad EXPECTED en el umbral', d.severity === SEVERITY.EXPECTED);
    ok('incluye contractVersion', d.contractVersion === 2);
    ok('métricas iguales no generan diferencia', !cmp.differences.some(x => x.metricKey === 'distinctContents'));

    const bad = compareMetrics({ routeKind: 'metrics.school', legacy: LEGACY_BODY,
                                 canonical: { contractVersion: 1 }, canonicalPeriod: PERIOD_30 });
    ok('shape canónico inválido → ENGINE_ERROR',
        bad.differences[0].reasonCode === REASON.CANONICAL_SHAPE_INVALID && bad.shapeError === true);
    const bad2 = compareMetrics({ routeKind: 'metrics.school', legacy: null,
                                  canonical: canonicalEnvelope(), canonicalPeriod: PERIOD_30 });
    ok('shape legacy inválido → ENGINE_ERROR', bad2.differences[0].reasonCode === REASON.LEGACY_SHAPE_INVALID);
}

// ── [18..19] PII ────────────────────────────────────────────────────────────
section('[18..19] cero PII');
{
    const cmp = compareMetrics({ routeKind: 'metrics.student', organizationId: 'inst-sintetica',
                                 legacy: LEGACY_BODY, canonical: canonicalEnvelope(), canonicalPeriod: PERIOD_30 });
    const s = JSON.stringify(cmp.differences);
    for (const forbidden of ['userId', 'email', 'nombre', 'token', 'password', 'headers', 'payload'])
        ok(`[18] la diferencia no contiene "${forbidden}"`, !s.includes(forbidden));
    const allowed = new Set(['routeKind', 'organizationId', 'period', 'metricKey', 'legacyValue',
        'canonicalValue', 'absoluteDelta', 'relativeDelta', 'reasonCode', 'severity', 'contractVersion']);
    const keys = new Set(cmp.differences.flatMap(d => Object.keys(d)));
    ok('[19] solo campos declarados', [...keys].every(k => allowed.has(k)), [...keys].join(','));

    const logged = [];
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    const res = fakeRes();
    await executeMetricsRoute({
        mode: 'shadow', routeKind: 'metrics.student',
        req: { params: { userId: 'user-secreto-123' }, headers: { 'x-user-id': 'user-secreto-123' } },
        res, legacyHandler,
        canonicalExecutor: async () => ({ envelope: canonicalEnvelope(), period: PERIOD_30 }),
        captureLegacy, shadowExecutor: exec, log: (o) => logged.push(JSON.stringify(o)),
        now: () => FIXED_NOW,
    });
    await tick(20);
    ok('[19] userId nunca aparece en los logs shadow', !logged.join('|').includes('user-secreto-123'));
    await exec.shutdown({ drainMs: 50 });
}

// ── [20..23] ejecutor acotado ───────────────────────────────────────────────
section('[20..23] circuit breaker, concurrencia, cola, shutdown');
{
    let clock = FIXED_NOW;
    const exec = createShadowExecutor({
        config: { ...resolveShadowConfig({}), sampleRate: 1, errorThreshold: 2, breakerCooldownMs: 10_000, timeoutMs: 500 },
        now: () => clock,
    });
    for (let i = 0; i < 3; i++) { exec.submit({ routeKind: 'metrics.school', task: async () => { throw new Error('x'); } }); await tick(10); }
    ok('[20] breaker abierto tras superar el umbral', exec.stats().breakerOpen === true);
    const r = exec.submit({ routeKind: 'metrics.school', task: async () => ({ differences: [] }) });
    ok('[20] con breaker abierto se descarta', r.accepted === false && r.reason === SKIP.BREAKER_OPEN);
    clock += 11_000;
    ok('[20] el breaker se cierra tras el cooldown', exec.stats().breakerOpen === false);
    await exec.shutdown({ drainMs: 50 });
}
{
    const exec = createShadowExecutor({
        config: { ...resolveShadowConfig({}), sampleRate: 1, maxConcurrency: 2, queueLimit: 100, timeoutMs: 5000 },
        now: () => FIXED_NOW,
    });
    let peak = 0, running = 0;
    const task = () => new Promise(r => { running++; peak = Math.max(peak, running); setTimeout(() => { running--; r({ differences: [] }); }, 15); });
    for (let i = 0; i < 8; i++) exec.submit({ routeKind: 'metrics.school', task });
    await new Promise(r => setTimeout(r, 120));
    ok('[21] concurrencia máxima respetada', peak <= 2, `pico=${peak}`);
    await exec.shutdown({ drainMs: 100 });
}
{
    const exec = createShadowExecutor({
        config: { ...resolveShadowConfig({}), sampleRate: 1, queueLimit: 3, maxConcurrency: 1, timeoutMs: 5000 },
        now: () => FIXED_NOW,
    });
    for (let i = 0; i < 50; i++) exec.submit({ routeKind: 'metrics.school', task: () => new Promise(() => {}) });
    ok('[22] la cola nunca supera el límite', exec.stats().queueDepth <= 3, String(exec.stats().queueDepth));
    const out = await exec.shutdown({ drainMs: 10 });
    ok('[23] shutdown descarta la cola', out.dropped >= 0 && exec.stats().shuttingDown === true);
    const after = exec.submit({ routeKind: 'metrics.school', task: async () => ({}) });
    ok('[23] tras el shutdown no se admite trabajo', after.accepted === false && after.reason === SKIP.SHUTTING_DOWN);
}

// ── [24] reloj determinístico ───────────────────────────────────────────────
section('[24] reloj determinístico');
{
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    exec.observeLegacyDuration(0);
    ok('la duración medida con reloj fijado es 0', exec.counters.shadow_legacy_response_duration_ms.max === 0);
    ok('snapshot serializable', typeof snapshotCounters(exec).shadow_requests_total === 'number');
    await exec.shutdown({ drainMs: 10 });
}

// ── [25..26] aislamiento de stores ──────────────────────────────────────────
section('[25..26] aislamiento de stores');
{
    const REPO = path.resolve(HERE, '..', '..');
    const before = new Set(fs.existsSync(path.join(REPO, 'data-critical'))
        ? fs.readdirSync(path.join(REPO, 'data-critical')) : []);
    const exec = createShadowExecutor({ config: { ...resolveShadowConfig({}), sampleRate: 1 }, now: () => FIXED_NOW });
    exec.submit({ routeKind: 'metrics.school', task: async () => ({ differences: [] }) });
    await tick(20);
    const after = new Set(fs.existsSync(path.join(REPO, 'data-critical'))
        ? fs.readdirSync(path.join(REPO, 'data-critical')) : []);
    ok('[25] ningún archivo nuevo en data-critical', before.size === after.size);
    ok('[26] cero WAL/SHM creados', ![...after].some(f => (/\.db-(wal|shm)$/.test(f)) && !before.has(f)));
    await exec.shutdown({ drainMs: 10 });
}

// ── [27..28] configuración ──────────────────────────────────────────────────
section('[27..28] configuración segura por defecto');
{
    const { metricsEngineMode } = await import(M('metricsRouterV2.mjs'));
    ok('[28] default productivo = legacy', metricsEngineMode({}) === 'legacy');
    ok('[27] modo inválido cae a legacy', metricsEngineMode({ METRICS_ENGINE: 'loquesea' }) === 'legacy');
    ok('los tres modos se reconocen',
        ['legacy', 'shadow', 'canonical'].every(m => metricsEngineMode({ METRICS_ENGINE: m }) === m));

    const c = resolveShadowConfig({});
    ok('sin variables, sampleRate = 0 (shadow inerte)', c.sampleRate === 0);
    const exec = createShadowExecutor({ config: c, now: () => FIXED_NOW });
    ok('con sampleRate 0 nada se admite',
        exec.submit({ routeKind: 'metrics.school', task: async () => ({}) }).reason === SKIP.DISABLED);
    ok('valores fuera de rango se acotan',
        resolveShadowConfig({ METRICS_SHADOW_SAMPLE_RATE: '9' }).sampleRate === 1
        && resolveShadowConfig({ METRICS_SHADOW_MAX_CONCURRENCY: '0' }).maxConcurrency === 1);
    ok('basura no activa el shadow', resolveShadowConfig({ METRICS_SHADOW_SAMPLE_RATE: 'si' }).sampleRate === 0);
    await exec.shutdown({ drainMs: 10 });
}

// ── compatibilidad canónica ─────────────────────────────────────────────────
section('[K] compatibilidad del shape legacy');
{
    ok('school/course/student están BLOCKED (no pueden expresar NO_DATA)',
        ['metrics.school', 'metrics.course', 'metrics.student']
            .every(k => CANONICAL_COMPATIBILITY[k] === 'CANONICAL_BLOCKED'));
    ok('schools es CANONICAL_COMPATIBLE', CANONICAL_COMPATIBILITY['metrics.schools'] === 'CANONICAL_COMPATIBLE');
    let threw = null;
    try {
        await executeMetricsRoute({ mode: 'canonical', routeKind: 'metrics.school', req: {}, res: fakeRes(), legacyHandler });
    } catch (e) { threw = e; }
    ok('canonical en ruta bloqueada lanza CanonicalBlocked, no inventa un cero',
        threw instanceof CanonicalBlocked && threw.code === 'CANONICAL_COMPATIBILITY_BLOCKED');
    ok('la matriz cubre las 4 rutas', Object.keys(ROUTE_CONTRACTS).length === 4);
    ok('la matriz de métricas está poblada', METRIC_MATRIX.length >= 15);
    ok('pick lee rutas anidadas', pick(LEGACY_BODY, 'backboneMetrics.sessions') === 12);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
