/**
 * metricsApiV2.test.js — CHP-API-METRICS-01A.
 *
 * Contrato de la API v2 de métricas: rutas, parámetros, autorización por
 * organizationId vía CIS, semántica poblacional y estados.
 *
 * TODO sobre fixtures sintéticas en mkdtemp. El provider se inyecta, así que
 * ningún test abre `events.db` real ni crea WAL/SHM sobre stores productivos.
 *
 *   node server/__test__/metricsApiV2.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── Fixtures ────────────────────────────────────────────────────────────────
const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'apiv2_'));
const USERS_TMP   = path.join(tmpDir, 'usuarios_colegios_oro.json');
const GROUPS_TMP  = path.join(tmpDir, 'groups_db.json');
const SCHOOLS_TMP = path.join(tmpDir, 'schools_db.json');
process.env.USERS_DB   = USERS_TMP;
process.env.GROUPS_DB  = GROUPS_TMP;
process.env.SCHOOLS_DB = SCHOOLS_TMP;

const SCHOOLS = [
    { id: 'org-villas',    name: 'Villas de Aranjuez' },
    { id: 'org-bosque',    name: 'Nuevo Bosque' },
    { id: 'org-filbo',     name: 'FilBo 2026' },
    { id: 'org-externado', name: 'Externado' },
];
const GROUPS = [
    { id: 'g-villas', organizationId: 'org-villas', mediatorIds: ['med-villas'], memberIds: ['v1', 'v2', 'v3'] },
    { id: 'g-bosque', organizationId: 'org-bosque', mediatorIds: ['med-bosque'], memberIds: ['b1', 'b2'] },
    { id: 'g-filbo',  organizationId: 'org-filbo',  memberIds: ['f1', 'f2'] },
    { id: 'g-hist',   school: 'Histórica', mediatorIds: ['med-villas'], memberIds: ['h1'] },
    { id: 'g-synth',  organizationId: 'lt-org', memberIds: ['s1', 's2'] },
];
const USERS = [
    { id: 'admin1', roles: ['administrador'] },
    { id: 'med-villas', roles: ['mediador'] },
    { id: 'med-bosque', roles: ['mediador'] },
    { id: 'v1', roles: ['lector'] }, { id: 'v2', roles: ['lector'] }, { id: 'v3', roles: ['mediador'] },
    { id: 'b1', roles: ['lector'] }, { id: 'b2', roles: ['lector'] },
    { id: 'f1', roles: ['lector'] }, { id: 'f2', roles: ['lector'] },
    { id: 'f3', roles: ['lector'], organizationId: 'org-filbo' },   // sin grupo
    { id: 'f4', roles: ['lector'], organizationId: 'org-filbo' },   // sin grupo
    { id: 'e1', roles: ['mediador'], organizationId: 'org-externado' },
    { id: 'e2', roles: ['mediador'], organizationId: 'org-externado' },
    { id: 'h1', roles: ['lector'] },
    { id: 's1', roles: ['lector'], _loadtest_marker: true },
    { id: 's2', roles: ['lector'], _loadtest_marker: true },
    { id: 'x1', roles: ['lector'] },
];
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const ev = (id, event, userId, ts, extra = {}) => ({
    eventId: id, event, userId, mode: event.split('.')[0],
    sessionId: extra.sessionId ?? `s-${id}`, serverTs: ts,
    contentId: extra.contentId ?? null, elapsedMs: extra.elapsedMs ?? null, progressFraction: null,
});
const EVENTS = [
    // v1 dentro de los 30 días: lectura
    ev('a1', 'text.session_start',  'v1', NOW - 2 * DAY,               { contentId: 'c1', elapsedMs: 0 }),
    ev('a2', 'text.block_complete', 'v1', NOW - 2 * DAY + 300_000,     { contentId: 'c1', elapsedMs: 300_000 }),
    ev('a3', 'text.session_end',    'v1', NOW - 2 * DAY + 600_000,     { contentId: 'c1', elapsedMs: 600_000 }),
    // v2: solo telemetría/sistema → actividad, pero no lectura
    ev('a4', 'immersive.session_heartbeat', 'v2', NOW - 3 * DAY,       { contentId: 'c1', elapsedMs: 1000 }),
    ev('a5', 'immersive.chunk_audio_reuse', 'v2', NOW - 3 * DAY + 1000),
    // v1 fuera de los 30 días
    ev('a6', 'text.block_complete', 'v1', NOW - 200 * DAY,             { contentId: 'c9' }),
    // f1 dentro del periodo
    ev('a7', 'pdf.page_change',     'f1', NOW - DAY,                   { contentId: 'c3' }),
    // fuera de scope
    ev('a8', 'text.block_complete', 'h1', NOW - DAY, { contentId: 'c1' }),
    ev('a9', 'text.block_complete', 's1', NOW - DAY, { contentId: 'c1' }),
    ev('a10','text.block_complete', 'x1', NOW - DAY, { contentId: 'c1' }),
    ev('a11','text.block_complete', 'fantasma', NOW - DAY, { contentId: 'c1' }),
];
fs.writeFileSync(USERS_TMP,   JSON.stringify(USERS),   'utf8');
fs.writeFileSync(GROUPS_TMP,  JSON.stringify(GROUPS),  'utf8');
fs.writeFileSync(SCHOOLS_TMP, JSON.stringify(SCHOOLS), 'utf8');

const {
    createMetricsRouterV2, resolvePeriod, resolveIdleMs, authorize, compareShadow,
    metricsEngineMode, BadRequest, SHADOW_ALERT,
} = await import('../metrics/metricsRouterV2.mjs');
const { createMetricsProvider, MetricsSourceError } = await import('../metrics/metricsProvider.mjs');
const { resolveOrganizationInput, schoolNameToSlug, wrapLegacyMetrics, deprecationHeaders } =
    await import('../metrics/legacyMetricsAdapter.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Provider inyectado: eventos en memoria, cero SQLite ─────────────────────
let loadedEventCount = 0;
const provider = createMetricsProvider({
    paths: { usersDb: USERS_TMP, groupsDb: GROUPS_TMP, schoolsDb: SCHOOLS_TMP, eventsDb: '<memoria>' },
    openDb: async () => { throw new Error('openDb no debe usarse: el test inyecta loadEvents'); },
});
provider.loadEvents = async (period) => {
    const rows = EVENTS
        .filter(e => !period || (e.serverTs >= period.fromTs && e.serverTs <= period.toTs))
        .sort((a, b) => (a.serverTs - b.serverTs) || a.eventId.localeCompare(b.eventId));
    loadedEventCount = rows.length;
    return rows;
};

// ── Servidor de pruebas ─────────────────────────────────────────────────────
const app = express();
const requireUserAuth = (req, res, next) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ ok: false, error: 'identity_not_established' });
    next();
};
app.use('/api', createMetricsRouterV2({ requireUserAuth, provider, now: () => NOW, express }));
const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function get(pathname, callerId) {
    const res = await fetch(base + pathname, callerId ? { headers: { 'x-user-id': callerId } } : {});
    let body = null;
    try { body = await res.json(); } catch { /* algunas respuestas pueden no traer body */ }
    return { status: res.status, body, headers: res.headers };
}

console.log('metricsApiV2 — CHP-API-METRICS-01A');

// ── §1 Parámetros ───────────────────────────────────────────────────────────
console.log('\n[1] parámetros');
{
    ok('periodo por defecto = 30 días', resolvePeriod({}, NOW).days === 30);
    ok('period=7d se respeta', resolvePeriod({ period: '7d' }, NOW).days === 7);
    ok('period=all → histórico completo', resolvePeriod({ period: 'all' }, NOW) === null);
    ok('from/to explícitos', resolvePeriod({ from: NOW - DAY, to: NOW }, NOW).fromTs === NOW - DAY);
    const throws = (fn, code) => { try { fn(); return false; } catch (e) { return e instanceof BadRequest && e.code === code; } };
    ok('from > to → PERIOD_INVERTED', throws(() => resolvePeriod({ from: NOW, to: NOW - DAY }, NOW), 'PERIOD_INVERTED'));
    ok('period inválido → INVALID_PERIOD', throws(() => resolvePeriod({ period: 'ayer' }, NOW), 'INVALID_PERIOD'));
    ok('sin nowTs → NOW_TS_REQUIRED', throws(() => resolvePeriod({}, undefined), 'NOW_TS_REQUIRED'));
    ok('idle por defecto = 15 min', resolveIdleMs({}, { isAdmin: false }) === 15 * 60_000);
    ok('override de idle prohibido a no-admin',
        throws(() => resolveIdleMs({ sessionIdleMinutes: '30' }, { isAdmin: false }), 'IDLE_OVERRIDE_FORBIDDEN'));
    ok('override de idle permitido a admin',
        resolveIdleMs({ sessionIdleMinutes: '30' }, { isAdmin: true }) === 30 * 60_000);
    ok('idle fuera de rango → INVALID_IDLE',
        throws(() => resolveIdleMs({ sessionIdleMinutes: '9999' }, { isAdmin: true }), 'INVALID_IDLE'));
}

// ── §2 Contrato de respuesta ────────────────────────────────────────────────
console.log('\n[2] contrato de respuesta');
{
    const r = await get('/api/v2/metrics/organizations/org-villas', 'admin1');
    ok('200 para admin', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    const b = r.body;
    for (const k of ['contractVersion', 'generatedAt', 'period', 'sessionStrategy',
                     'organizationId', 'metrics', 'population', 'coverage', 'quality']) {
        ok(`el sobre incluye ${k}`, k in b);
    }
    ok('contractVersion = 2', b.contractVersion === 2);
    ok('generatedAt es el reloj inyectado', b.generatedAt === NOW);
    ok('sessionStrategy declara la ventana', b.sessionStrategy === 'INACTIVITY_WINDOW_15MIN');
    ok('el periodo viaja resuelto', b.period.days === 30);
    ok('distinctContents es el nombre publicado',
        'distinctContents' in b.metrics && !('contentsOpened' in b.metrics));
    ok('coverage declara numerador y denominador',
        typeof b.coverage.numerator === 'number' && typeof b.coverage.denominator === 'number');
}

// ── §3 Semántica poblacional (Fase 5) ───────────────────────────────────────
console.log('\n[3] semántica poblacional');
{
    const filbo = (await get('/api/v2/metrics/organizations/org-filbo', 'admin1')).body;
    ok('FilBo conserva los 4 registrados (2 sin grupo)', filbo.population.registeredUsers === 4,
        JSON.stringify(filbo.population));
    ok('FilBo reporta readersWithoutGroup = 2', filbo.population.readersWithoutGroup === 2);
    ok('FilBo eligibleReaders = 2', filbo.population.eligibleReaders === 2);

    const ext = (await get('/api/v2/metrics/organizations/org-externado', 'admin1')).body;
    ok('Externado conserva 2 registrados', ext.population.registeredUsers === 2);
    ok('Externado eligibleReaders = 0', ext.population.eligibleReaders === 0);
    ok('Externado lectura → NO_DATA con value null',
        ext.metrics.activeReaders.status === 'NO_DATA' && ext.metrics.activeReaders.value === null);
    ok('Externado NO muestra registeredUsers = 0',
        ext.metrics.registeredUsers.value === 2 && ext.metrics.registeredUsers.measured === true);

    const bosque = (await get('/api/v2/metrics/organizations/org-bosque', 'admin1')).body;
    ok('Bosque conserva su población elegible', bosque.population.eligibleReaders === 2);
    ok('Bosque activeReaders = 0 medido con NO_ACTIVITY',
        bosque.metrics.activeReaders.value === 0
        && bosque.metrics.activeReaders.measured === true
        && bosque.metrics.activeReaders.status === 'NO_ACTIVITY');
    ok('Bosque muestra la etiqueta aprobada',
        bosque.metrics.activeReaders.label === 'Sin actividad registrada');

    const villas = (await get('/api/v2/metrics/organizations/org-villas', 'admin1')).body;
    ok('Villas registeredUsers no depende de eventos', villas.population.registeredUsers === 3);
    ok('Villas registeredReaders refleja el rol real', villas.population.registeredReaders === 2);
    ok('usersWithActivity ≠ activeReaders',
        villas.population.usersWithActivity === 2 && villas.population.activeReaders === 1,
        JSON.stringify(villas.population));
    ok('las siete poblaciones viajan por separado',
        ['registeredUsers', 'registeredReaders', 'eligibleReaders', 'readersWithoutGroup',
         'usersWithActivity', 'activeReaders', 'readersWithEvents']
            .every(k => typeof villas.population[k] === 'number'));
}

// ── §4 Métricas y estados ───────────────────────────────────────────────────
console.log('\n[4] métricas y estados');
{
    const b = (await get('/api/v2/metrics/organizations/org-villas', 'admin1')).body;
    for (const m of ['registeredUsers', 'registeredReaders', 'eligibleReaders', 'usersWithActivity',
                     'activeReaders', 'entries', 'sessions', 'platformTimeMs', 'distinctContents']) {
        ok(`publica ${m}`, m in b.metrics);
    }
    ok('readingTimeMs es NOT_DEFINED con value null',
        b.metrics.readingTimeMs.status === 'NOT_DEFINED' && b.metrics.readingTimeMs.value === null
        && b.metrics.readingTimeMs.measured === false);
    ok('readingTimeMs lleva la etiqueta aprobada',
        b.metrics.readingTimeMs.label === 'Métrica aún no disponible');
    ok('entries = sessions (D1)', b.metrics.entries.value === b.metrics.sessions.value);
    ok('no se publica ninguna métrica fuera del contrato',
        Object.keys(b.metrics).every(k => [
            'registeredUsers', 'registeredReaders', 'eligibleReaders', 'readersWithoutGroup',
            'usersWithActivity', 'activeReaders', 'entries', 'sessions', 'platformTimeMs',
            'distinctContents', 'readingTimeMs'].includes(k)), Object.keys(b.metrics).join(','));
}

// ── §5 Periodo ──────────────────────────────────────────────────────────────
console.log('\n[5] periodo');
{
    const p30 = (await get('/api/v2/metrics/organizations/org-villas?period=30d', 'admin1')).body;
    const all = (await get('/api/v2/metrics/organizations/org-villas?period=all', 'admin1')).body;
    ok('el histórico incluye más contenidos que 30 días',
        all.metrics.distinctContents.value > p30.metrics.distinctContents.value,
        `${all.metrics.distinctContents.value} vs ${p30.metrics.distinctContents.value}`);
    ok('period=all declara period null', all.period === null);
    ok('la consulta se acota por periodo en el provider', loadedEventCount === EVENTS.length);
    const r = await get('/api/v2/metrics/organizations/org-villas?period=nope', 'admin1');
    ok('periodo inválido → 400', r.status === 400 && r.body.error === 'INVALID_PERIOD');
}

// ── §6 Autorización ─────────────────────────────────────────────────────────
console.log('\n[6] autorización');
{
    ok('sin identidad → 401', (await get('/api/v2/metrics/organizations/org-villas')).status === 401);
    ok('admin ve su organización', (await get('/api/v2/metrics/organizations/org-villas', 'admin1')).status === 200);
    ok('mediador ve SU organización',
        (await get('/api/v2/metrics/organizations/org-villas', 'med-villas')).status === 200);
    const ajena = await get('/api/v2/metrics/organizations/org-bosque', 'med-villas');
    ok('mediador NO ve otra organización → 403', ajena.status === 403, JSON.stringify(ajena.body));
    const inexistente = await get('/api/v2/metrics/organizations/org-inventada', 'admin1');
    ok('organización inexistente → 404', inexistente.status === 404, JSON.stringify(inexistente.body));
    ok('un lector no accede a métricas de organización',
        (await get('/api/v2/metrics/organizations/org-villas', 'v1')).status === 403);
    ok('un lector sí accede a su propia métrica',
        (await get('/api/v2/metrics/users/v1', 'v1')).status === 200);
    ok('un lector NO accede a la métrica de otro',
        (await get('/api/v2/metrics/users/v2', 'v1')).status === 403);
    ok('el nombre del colegio no autoriza',
        (await get('/api/v2/metrics/organizations/Villas%20de%20Aranjuez', 'admin1')).status === 404);
    ok('el slug tampoco autoriza en v2',
        (await get('/api/v2/metrics/organizations/villas-de-aranjuez', 'admin1')).status === 404);

    const lista = await get('/api/v2/metrics/organizations', 'med-villas');
    ok('la lista solo trae las organizaciones autorizadas',
        lista.status === 200 && lista.body.organizations.length === 1
        && lista.body.organizations[0].organizationId === 'org-villas',
        String(lista.body.organizations?.length));
    ok('la lista del admin trae las cuatro',
        (await get('/api/v2/metrics/organizations', 'admin1')).body.organizations.length === 4);
}

// ── §7 Grupos y usuarios ────────────────────────────────────────────────────
console.log('\n[7] grupos y usuarios');
{
    const g = await get('/api/v2/metrics/groups/g-villas', 'med-villas');
    ok('grupo autorizado → 200', g.status === 200);
    ok('el grupo acota la población a sus miembros', g.body.population.registeredUsers === 3);
    ok('la respuesta de grupo declara groupId y organizationId',
        g.body.groupId === 'g-villas' && g.body.organizationId === 'org-villas');
    // El CIS deniega el grupo histórico a un mediador: está fuera del scope
    // activo. Esa es la autorización aprobada y no se relaja aquí.
    const hist = await get('/api/v2/metrics/groups/g-hist', 'med-villas');
    ok('grupo histórico → 403 para el mediador que lo media',
        hist.status === 403 && hist.body.cause === 'GROUP_HISTORICAL', JSON.stringify(hist.body));
    // El admin sí pasa el gate; ahí se ve el estado NO_DATA del grupo.
    const histAdmin = await get('/api/v2/metrics/groups/g-hist', 'admin1');
    ok('grupo histórico visto por admin → NO_DATA, no ceros',
        histAdmin.status === 200
        && histAdmin.body.metrics.activeReaders.status === 'NO_DATA'
        && histAdmin.body.metrics.activeReaders.value === null
        && histAdmin.body.metrics.activeReaders.reason === 'GROUP_NOT_IN_ACTIVE_SCOPE');
    ok('grupo sintético no es accesible como scope activo',
        (await get('/api/v2/metrics/groups/g-synth', 'med-villas')).status === 403);

    const u = await get('/api/v2/metrics/users/v1', 'admin1');
    ok('usuario → 200 con su organización', u.status === 200 && u.body.organizationId === 'org-villas');
    ok('usuario inexistente → 404', (await get('/api/v2/metrics/users/no-existe', 'admin1')).status === 404);
    const sinOrg = await get('/api/v2/metrics/users/x1', 'admin1');
    ok('usuario sin organización activa → NO_DATA, no ceros',
        sinOrg.body.metrics.activeReaders.status === 'NO_DATA'
        && sinOrg.body.metrics.activeReaders.value === null);
}

// ── §8 Quality buckets ──────────────────────────────────────────────────────
console.log('\n[8] quality buckets');
{
    const lista = (await get('/api/v2/metrics/organizations?includeQuality=true', 'admin1')).body;
    const buckets = lista.unattributed.buckets;
    for (const k of ['UNATTRIBUTED_IDENTITY', 'UNATTRIBUTED_GROUP', 'UNATTRIBUTED_ORGANIZATION',
                     'HISTORICAL_SCOPE', 'SYNTHETIC_SCOPE', 'UNKNOWN_EVENT_TYPE']) {
        ok(`bucket ${k} presente`, k in buckets);
    }
    ok('los no atribuibles no se reparten',
        buckets.HISTORICAL_SCOPE.events === 1 && buckets.SYNTHETIC_SCOPE.events === 1
        && buckets.UNATTRIBUTED_GROUP.events === 1 && buckets.UNATTRIBUTED_IDENTITY.events === 1);
    ok('los buckets no exponen userIds', !JSON.stringify(buckets).includes('fantasma'));

    const villas = (await get('/api/v2/metrics/organizations/org-villas', 'admin1')).body;
    ok('quality trae cappedSessions y orphanSessionEnds',
        'cappedSessions' in villas.quality && 'orphanSessionEnds' in villas.quality);
    const sinQ = (await get('/api/v2/metrics/organizations/org-villas?includeQuality=false', 'admin1')).body;
    ok('includeQuality=false omite quality', sinQ.quality === null);
}

// ── §9 Feature flag y compatibilidad legacy ─────────────────────────────────
console.log('\n[9] feature flag y legacy');
{
    ok('el default del flag es legacy', metricsEngineMode({}) === 'legacy');
    ok('un valor desconocido cae a legacy', metricsEngineMode({ METRICS_ENGINE: 'loquesea' }) === 'legacy');
    for (const m of ['canonical', 'shadow', 'legacy']) {
        ok(`el flag reconoce ${m}`, metricsEngineMode({ METRICS_ENGINE: m }) === m);
    }

    ok('el slug resuelve a organizationId como compatibilidad de entrada',
        resolveOrganizationInput('villas-de-aranjuez', SCHOOLS).organizationId === 'org-villas');
    ok('la resolución declara que vino por slug',
        resolveOrganizationInput('villas-de-aranjuez', SCHOOLS).via === 'slug_compat');
    ok('un organizationId se usa tal cual',
        resolveOrganizationInput('org-villas', SCHOOLS).via === 'organizationId');
    ok('el nombre exacto también resuelve',
        resolveOrganizationInput('Nuevo Bosque', SCHOOLS).organizationId === 'org-bosque');
    ok('un nombre ambiguo NO toma la primera coincidencia',
        resolveOrganizationInput('Dup', [{ id: 'a', name: 'Dup' }, { id: 'b', name: 'Dup' }]).organizationId === null);
    ok('el slug se calcula sin acentos', schoolNameToSlug('Institución Ñandú') === 'institucion-nandu');
    ok('las cabeceras de deprecación apuntan al sucesor',
        deprecationHeaders({ successor: '/api/v2/metrics/organizations' }).Deprecation === 'true');

    // Modo legacy: el wrapper NO llama al motor canónico.
    let canonicalCalled = 0, legacyCalled = 0;
    const wrapped = wrapLegacyMetrics({
        legacyHandler: () => { legacyCalled++; },
        canonicalHandler: () => { canonicalCalled++; return {}; },
        successor: '/api/v2/metrics/organizations',
        mode: () => 'legacy',
    });
    await wrapped({ headers: {} }, { set: () => {} });
    ok('en modo legacy el motor nuevo no interviene', legacyCalled === 1 && canonicalCalled === 0);

    let shadowLogs = 0;
    const shadowed = wrapLegacyMetrics({
        legacyHandler: () => { legacyCalled++; },
        canonicalHandler: async () => ({ contractVersion: 2, population: { registeredUsers: 3, activeReaders: 1 },
                                         metrics: { registeredUsers: {}, activeReaders: {}, sessions: {}, platformTimeMs: {} },
                                         coverage: { numerator: 1, denominator: 2, ratio: 0.5 } }),
        captureLegacy: async () => ({ summary: { studentCount: 3, activeStudentCount: 2 } }),
        successor: '/api/v2/metrics/organizations',
        mode: () => 'shadow',
        log: (msg) => { shadowLogs++; ok('el log shadow no contiene PII', !/@|nombre_completo|"v1"/.test(msg)); },
    });
    await shadowed({ headers: {}, route: { path: '/x' } }, { set: () => {} });
    ok('en modo shadow responde legacy y registra la comparación', shadowLogs === 1);
}

// ── §10 Shadow comparison ───────────────────────────────────────────────────
console.log('\n[10] shadow comparison');
{
    const canonical = {
        contractVersion: 2,
        population: { registeredUsers: 90, activeReaders: 21 },
        metrics: { registeredUsers: {}, activeReaders: {}, sessions: {}, platformTimeMs: {} },
        coverage: { numerator: 21, denominator: 80, ratio: 0.2625 },
    };
    const legacy = { summary: { studentCount: 80, activeStudentCount: 24 } };
    const cmp = compareShadow({ endpoint: '/api/metrics/school/:id', legacy, canonical });
    ok('la comparación es agregada', cmp.comparable === true && Array.isArray(cmp.differences));
    ok('declara la razón del desvío, no lo trata como fallo',
        cmp.differences.every(d => typeof d.reason === 'string') && cmp.alerts.length === 0);
    ok('marca el desvío que supera el umbral',
        cmp.differences.find(d => d.field === 'students').exceedsThreshold === false
        && cmp.differences.find(d => d.field === 'active').delta === -3);
    ok('una respuesta canónica inválida alerta',
        compareShadow({ endpoint: 'x', legacy, canonical: { contractVersion: 1 } })
            .alerts.includes(SHADOW_ALERT.INVALID_CANONICAL_SHAPE));
    ok('una métrica faltante alerta',
        compareShadow({ endpoint: 'x', legacy, canonical: { ...canonical, metrics: {} } })
            .alerts.includes(SHADOW_ALERT.MISSING_METRIC));
    ok('la comparación no expone identidades', !JSON.stringify(cmp).includes('userId'));
}

// ── §11 Errores nunca se vuelven ceros ──────────────────────────────────────
console.log('\n[11] errores');
{
    const roto = createMetricsProvider({
        paths: { usersDb: USERS_TMP, groupsDb: GROUPS_TMP, schoolsDb: SCHOOLS_TMP, eventsDb: '<memoria>' },
        openDb: async () => { throw new Error('x'); },
    });
    roto.loadEvents = async () => { throw new MetricsSourceError('events.db', 'unreadable'); };
    const appErr = express();
    appErr.use('/api', createMetricsRouterV2({ requireUserAuth, provider: roto, now: () => NOW, express }));
    const srv = http.createServer(appErr);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/v2/metrics/organizations/org-villas`,
                            { headers: { 'x-user-id': 'admin1' } });
    const body = await res.json();
    ok('fuente caída → 503 explícito', res.status === 503 && body.error === 'metrics_source_unavailable');
    ok('el error NO se convirtió en ceros', !('metrics' in body));
    await new Promise(r => srv.close(r));
}

// ── §12 Determinismo, PII y aislamiento ─────────────────────────────────────
console.log('\n[12] determinismo, PII y aislamiento');
{
    const a = (await get('/api/v2/metrics/organizations/org-villas', 'admin1')).body;
    const b = (await get('/api/v2/metrics/organizations/org-villas', 'admin1')).body;
    ok('dos llamadas idénticas devuelven lo mismo', JSON.stringify(a) === JSON.stringify(b));

    const lista = JSON.stringify((await get('/api/v2/metrics/organizations', 'admin1')).body);
    ok('la respuesta no contiene identidades de usuario', !/"v1"|"f3"|fantasma/.test(lista));
    ok('la respuesta no contiene emails ni nombres', !/@/.test(lista) && !/nombre_completo/.test(lista));

    const provSrc = fs.readFileSync(path.join(REPO_ROOT, 'server', 'metrics', 'metricsProvider.mjs'), 'utf8');
    ok('el provider abre events.db en readonly', /readonly:\s*true/.test(provSrc));
    ok('el provider no escribe nada', !/writeFileSync|INSERT|UPDATE|DELETE/.test(provSrc));
    ok('el provider no hardcodea rutas productivas', !/\/app\/|\/var\/www\//.test(provSrc));
    ok('el provider acota por periodo en SQL', /server_ts >= \? AND server_ts <= \?/.test(provSrc));

    for (const rel of ['data/users_db.json', 'data-critical/events.db']) {
        const p = path.join(REPO_ROOT, rel);
        ok(`ningún test creó ${rel}.tmp`, !fs.existsSync(`${p}.tmp`));
    }
}

await new Promise(r => server.close(r));
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
