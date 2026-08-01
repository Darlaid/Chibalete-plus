/**
 * productionCanaryCorpus.test.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A, Fase 16.
 *
 * El corpus congelado solo vale si es imposible cambiarlo por accidente. Estas
 * pruebas cubren las dos mitades del riesgo:
 *
 *   · que el contrato se mueva sin que nadie lo note (gates, muestra, rutas,
 *     normalización, periodos, criterios de selección);
 *   · que el validador acepte un corpus que no debería aceptar (incompleto,
 *     modificado, caducado, con campos desconocidos, con PII o secretos).
 *
 * No tocan ningún store real: toda la evidencia sintética vive en un directorio
 * temporal propio y se borra al terminar.
 *
 *   node scripts/perf/productionCanaryCorpus.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CORPUS_ID, CORPUS_VERSION, ACCEPTANCE_CONTRACT_VERSION,
    ORG_ALIASES, GROUP_ALIAS, USER_ALIAS,
    ROUTE_CONTRACT, PERF_ROUTE_IDS, NEGATIVE_ROUTE_IDS, ROUTE_CLASSES,
    TECHNICAL_TIMESTAMP_NAMES, DERIVED_VOLATILE_PATHS, NORMALIZATION_CONTRACT,
    SAMPLING_CONTRACT, GATES, LIFECYCLE_GATES, PERIOD_CONTRACT,
    GROUP_SELECTION_CRITERIA, USER_SELECTION_CRITERIA,
    SYNTHETIC_PRINCIPAL_USER_ID, SYNTHETIC_ABSENT_SCHOOL_SLUG,
    acceptanceContract, acceptanceContractSha256, canonicalJson,
    sha256Hex, shortHash, resolvePath, templatePlaceholders,
    findPii, findSecrets,
} from './productionCanaryCorpus.mjs';
import {
    VERDICTS, Report, validateStructure, validateExpiry, validatePopulation,
    scanCorpusForLeaks, scanSanitizedForLeaks,
} from './validateProductionCanaryCorpus.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SANITIZED = path.join(REPO, 'docs', 'ops', 'stats-legacy-perf-corpus.sanitized.json');
const SCHEMA = path.join(REPO, 'docs', 'ops', 'stats-legacy-perf-corpus.schema.json');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-corpus-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignorar */ } });

console.log('productionCanaryCorpus — CHP-STATS-LEGACY-PERF-CORPUS-01A');

// ── fixture sintético: ni un identificador real ─────────────────────────────
const FAKE = {
    orgIds: { ORG_A: 'school-fixture-a', ORG_B: 'school-fixture-b', ORG_C: 'school-fixture-c', ORG_D: 'school-fixture-d' },
    groupId: 'group-fixture-r7',
    userId: 'user-fixture-r6',
};
const FAKE_MEMBERS = Array.from({ length: 40 }, (_, i) => `user-fixture-${i}`).concat(FAKE.userId);

function buildFixtureCorpus(overrides = {}) {
    const bindings = {
        ORG_A_SLUG: 'fixture-a', ORG_B_SLUG: 'fixture-b',
        ORG_C_SLUG: 'fixture-c', ORG_D_SLUG: 'fixture-d',
        GROUP_R7_ID: FAKE.groupId, USER_R6_ID: FAKE.userId,
    };
    const corpus = {
        corpusId: CORPUS_ID,
        corpusVersion: CORPUS_VERSION,
        generatedAt: '2026-08-01T14:00:00Z',
        expiresAt: '2026-08-24T23:17:59Z',
        reviewBy: '2026-08-15T00:00:00Z',
        production: {
            commit: 'a'.repeat(40), imageRef: 'chibalete/api:fixture',
            imageId: `sha256:${'b'.repeat(64)}`, observabilityCommit: 'c'.repeat(40),
            requiredFlags: { LEGACY_METRICS_REQUEST_CONTEXT: 'off', METRICS_ENGINE: 'legacy' },
        },
        acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
        acceptanceContractSha256: acceptanceContractSha256(),
        organizations: ORG_ALIASES.map((alias, i) => ({
            alias, name: `Fixture ${alias}`, id: FAKE.orgIds[alias], idSha256: sha256Hex(FAKE.orgIds[alias]),
            slug: `fixture-${'abcd'[i]}`, addressable: alias !== 'ORG_D',
            groups: alias === 'ORG_D' ? 0 : 1, membersInOro: alias === 'ORG_D' ? 0 : 41,
            activeReaders: alias === 'ORG_B' ? 0 : 5,
            dataState: alias === 'ORG_D' ? 'NOT_ADDRESSABLE' : alias === 'ORG_B' ? 'NO_ACTIVITY' : 'ACTIVE',
        })),
        group: {
            alias: GROUP_ALIAS, id: FAKE.groupId, idSha256: sha256Hex(FAKE.groupId),
            organizationAlias: 'ORG_A', type: 'course', membersInOro: 41, activeReaders: 5,
            selection: { ...GROUP_SELECTION_CRITERIA, eligibleCount: 1, runnerUpActiveReaders: null },
        },
        user: {
            alias: USER_ALIAS, id: FAKE.userId, idSha256: sha256Hex(FAKE.userId),
            selection: { ...USER_SELECTION_CRITERIA, poolSize: 41 },
        },
        syntheticPrincipals: { userId: SYNTHETIC_PRINCIPAL_USER_ID, schoolSlug: SYNTHETIC_ABSENT_SCHOOL_SLUG },
        periods: PERIOD_CONTRACT,
        routes: ROUTE_CONTRACT.map((r) => ({ ...r, path: resolvePath(r.pathTemplate, bindings) })),
        perfRouteIds: [...PERF_ROUTE_IDS],
        negativeRouteIds: [...NEGATIVE_ROUTE_IDS],
        normalization: NORMALIZATION_CONTRACT,
        sampling: SAMPLING_CONTRACT,
        gates: GATES,
        lifecycle: LIFECYCLE_GATES,
        populationHashes: {
            oroSha256: 'd'.repeat(64), groupsSha256: 'e'.repeat(64), schoolsSha256: 'f'.repeat(64),
            groupR7MembersSha256: sha256Hex(canonicalJson(FAKE_MEMBERS.slice().sort())),
            groupR7MemberCount: FAKE_MEMBERS.length, oroUserCount: 41, groupCount: 1,
        },
        driftCriteria: { productionCommitMustMatch: true },
    };
    return JSON.parse(JSON.stringify({ ...corpus, ...overrides }));
}

const verdictOf = (corpus, now) => {
    const r = new Report();
    validateStructure(corpus, r);
    validateExpiry(corpus, r, now ?? new Date('2026-08-05T00:00:00Z'));
    return r.verdict();
};

// ─────────────────────────────────────────────────────────────────────────────
section('[1] contrato de aceptación: versión y hash estables');
{
    ok('[1a] versión declarada', ACCEPTANCE_CONTRACT_VERSION === '1.0.0');
    const a = acceptanceContractSha256(), b = acceptanceContractSha256();
    ok('[1b] hash determinista entre invocaciones', a === b);
    ok('[1c] hash es sha256 hex', /^[0-9a-f]{64}$/.test(a));
    // La serialización canónica ordena claves: el mismo contrato con las claves
    // en otro orden debe producir el MISMO hash.
    const c1 = acceptanceContract();
    const reordered = Object.fromEntries(Object.keys(c1).reverse().map((k) => [k, c1[k]]));
    ok('[1d] el orden de claves no altera el hash', canonicalJson(c1) === canonicalJson(reordered));
    ok('[1e] cambiar un gate cambia el hash',
        canonicalJson({ ...c1, gates: { ...c1.gates, X: 1 } }) !== canonicalJson(c1));
}

section('[2] matriz R1–R7 completa e inmutable');
{
    ok('[2a] siete rutas de rendimiento', PERF_ROUTE_IDS.length === 7);
    ok('[2b] R1..R7 exactamente', canonicalJson([...PERF_ROUTE_IDS]) ===
        canonicalJson(['ROUTE_1', 'ROUTE_2', 'ROUTE_3', 'ROUTE_4', 'ROUTE_5', 'ROUTE_6', 'ROUTE_7']));
    ok('[2c] tres negativas', canonicalJson([...NEGATIVE_ROUTE_IDS]) === canonicalJson(['NEG_401', 'NEG_403', 'NEG_404']));
    ok('[2d] diez rutas en total', ROUTE_CONTRACT.length === 10);
    ok('[2e] todas GET', ROUTE_CONTRACT.every((r) => r.method === 'GET'));
    ok('[2f] ninguna declara query', ROUTE_CONTRACT.every((r) => !r.pathTemplate.includes('?')));
    ok('[2g] cada ruta declara status esperado', ROUTE_CONTRACT.every((r) => Number.isInteger(r.expectedStatus)));
    ok('[2h] cada ruta declara content-type', ROUTE_CONTRACT.every((r) => r.expectedContentType === 'application/json; charset=utf-8'));
    ok('[2i] cada ruta declara topLevelKeys', ROUTE_CONTRACT.every((r) => Array.isArray(r.topLevelKeys) && r.topLevelKeys.length > 0));
    ok('[2j] contrato congelado (Object.freeze)', Object.isFrozen(ROUTE_CONTRACT));

    const creates = ROUTE_CONTRACT.filter((r) => r.createsContext).map((r) => r.id);
    ok('[2k] solo R2,R3,R4,R7 crean contexto',
        canonicalJson(creates) === canonicalJson(['ROUTE_2', 'ROUTE_3', 'ROUTE_4', 'ROUTE_7']), creates.join(','));
    ok('[2l] R6 (alumno suelto) NO crea contexto',
        ROUTE_CONTRACT.find((r) => r.id === 'ROUTE_6').createsContext === false);
    ok('[2m] R5 es 404 de institución registrada sin grupos',
        ROUTE_CONTRACT.find((r) => r.id === 'ROUTE_5').expectedStatus === 404);
    ok('[2n] clases asignadas a todas', ROUTE_CONTRACT.every((r) => Object.values(ROUTE_CLASSES).includes(r.routeClass)));
}

section('[3] parámetros: sin selección en ejecución');
{
    const withMarks = ROUTE_CONTRACT.filter((r) => templatePlaceholders(r.pathTemplate).length > 0);
    ok('[3a] los marcadores son un conjunto cerrado',
        withMarks.every((r) => templatePlaceholders(r.pathTemplate)
            .every((p) => ['ORG_A_SLUG', 'ORG_B_SLUG', 'ORG_C_SLUG', 'ORG_D_SLUG', 'GROUP_R7_ID', 'USER_R6_ID'].includes(p))));
    let threw = false;
    try { resolvePath('/api/metrics/school/{{UNKNOWN}}', {}); } catch { threw = true; }
    ok('[3b] un marcador sin resolver lanza, no se sirve tal cual', threw);
    ok('[3c] resolución sustituye el marcador',
        resolvePath('/api/metrics/course/{{GROUP_R7_ID}}', { GROUP_R7_ID: 'g1' }) === '/api/metrics/course/g1');
}

section('[4] normalización derivada de la evidencia, no declarada');
{
    ok('[4a] diez sellos técnicos', TECHNICAL_TIMESTAMP_NAMES.length === 10);
    ok('[4b] son exactamente los de -01E',
        canonicalJson([...TECHNICAL_TIMESTAMP_NAMES]) === canonicalJson(
            ['computedAt', 'generatedAt', 'createdAt', 'timestamp', 'windowFrom', 'windowTo', 'from', 'to', 'fromTs', 'toTs']));
    ok('[4c] lastLoginAt NO está en la whitelist', !TECHNICAL_TIMESTAMP_NAMES.includes('lastLoginAt'));
    ok('[4d] lastActivityAt NO está en la whitelist', !TECHNICAL_TIMESTAMP_NAMES.includes('lastActivityAt'));
    ok('[4e] nueve rutas volátiles derivadas', DERIVED_VOLATILE_PATHS.length === 9);
    const re = new RegExp(NORMALIZATION_CONTRACT.technicalTimestampPattern);
    ok('[4f] el patrón acepta las nueve derivadas', DERIVED_VOLATILE_PATHS.every((p) => re.test(p.replace(/\[\]/g, ''))));
    ok('[4g] el patrón rechaza un campo funcional', !re.test('summary.totalSessions'));
    ok('[4h] el patrón rechaza lastLoginAt', !re.test('user.lastLoginAt'));
    ok('[4i] el orden de claves es contractual', NORMALIZATION_CONTRACT.sortObjectKeys === false);
    ok('[4j] los arrays no se ordenan', NORMALIZATION_CONTRACT.sortArrays === false);
    ok('[4k] 0 y null se distinguen', NORMALIZATION_CONTRACT.compareZeroVsNull === true);
    ok('[4l] excluir exige nombre Y variación intra-brazo',
        NORMALIZATION_CONTRACT.excludeRequiresBothNameAndIntraArmVariation === true);
}

section('[5] periodos absolutos');
{
    ok('[5a] timezone declarada', PERIOD_CONTRACT.timezone === 'UTC');
    ok('[5b] las rutas no admiten query', PERIOD_CONTRACT.routesAcceptQueryParameters === false);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    ok('[5c] cobertura con fechas absolutas',
        [PERIOD_CONTRACT.dataCoverage.progressFrom, PERIOD_CONTRACT.dataCoverage.progressTo,
            PERIOD_CONTRACT.dataCoverage.eventsFrom, PERIOD_CONTRACT.dataCoverage.eventsTo].every((v) => iso.test(v)));
    ok('[5d] la ventana rodante se declara fijada en código',
        PERIOD_CONTRACT.rollingBackboneWindow.codeFixed === true &&
        PERIOD_CONTRACT.rollingBackboneWindow.windowDays === 30);
    ok('[5e] sus campos están normalizados',
        PERIOD_CONTRACT.rollingBackboneWindow.normalizedFields.every((f) => TECHNICAL_TIMESTAMP_NAMES.includes(f)));
    ok('[5f] `now` y los timestamps móviles están prohibidos',
        PERIOD_CONTRACT.forbidden.includes('now') && PERIOD_CONTRACT.forbidden.includes('timestamps-moviles'));
    ok('[5g] la ventana de ejecución debe ser absoluta',
        PERIOD_CONTRACT.canaryExecutionWindow.mustBeAbsolute === true);
}

section('[6] gates congelados con los valores históricos de -01E-R1');
{
    const A = GATES[ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED];
    const B = GATES[ROUTE_CLASSES.COURSE_AGGREGATION_INDEXED];
    const C = GATES[ROUTE_CLASSES.UNCHANGED_NO_CONTEXT];
    ok('[6a] clase A p50 ≤ ×0,50', A.p50OnMaxRatio === 0.50);
    ok('[6b] clase A p95 ≤ ×0,50', A.p95OnMaxRatio === 0.50);
    ok('[6c] clase A reducción absoluta ≥100 ms si p95_off ≥200 ms',
        A.absoluteP95ReductionMs === 100 && A.absoluteAppliesWhenP95OffAtLeastMs === 200);
    ok('[6d] clase A exige memo hits > 0', A.memoHitsMustBePositive === true);
    ok('[6e] clase B p50 ≤ ×0,65', B.p50OnMaxRatio === 0.65);
    ok('[6f] clase B p95 ≤ ×0,60', B.p95OnMaxRatio === 0.60);
    ok('[6g] clase B reducción absoluta ≥100 ms si p95_off ≥250 ms',
        B.absoluteP95ReductionMs === 100 && B.absoluteAppliesWhenP95OffAtLeastMs === 250);
    ok('[6h] clase B: cero memo hits es lo esperado', B.zeroMemoHitsIsExpected === true);
    ok('[6i] clase B declara el carve-out dual, no lo silencia',
        B.dualTopologySatisfiedByLevel1Evidence === true);
    ok('[6j] A y B exigen 3 de 4 bloques y el agregado',
        A.blocksThatMustPass === 3 && A.aggregateMustPass && B.blocksThatMustPass === 3 && B.aggregateMustPass);
    ok('[6k] clase C: latencia NO bloqueante', C.latencyBlocking === false);
    ok('[6l] clase C: contadores a cero', C.createdDelta === 0 && C.disposedDelta === 0 &&
        C.activeFinal === 0 && C.memoHitsDelta === 0 && C.memoMissesDelta === 0);
    ok('[6m] clase C: sin diferencias contractuales ni de valor',
        C.contractDifferences === 0 && C.valueDifferences === 0);
    ok('[6n] «regresión extrema» definida antes del canary',
        C.extremeRegression.p95RatioAbove === 2.0 && C.extremeRegression.andAbsoluteIncreaseAboveMs === 250);
    ok('[6o] el ±5 % NO aparece como gate de clase C',
        !JSON.stringify(C).includes('1.05') && !('p95OnMaxRatio' in C));
    ok('[6p] las seis rutas de clase C están listadas', C.routes.length === 6);
    ok('[6q] gates congelados', Object.isFrozen(GATES) && Object.isFrozen(A) && Object.isFrozen(B) && Object.isFrozen(C));
}

section('[7] ciclo de vida y telemetría');
{
    ok('[7a] created = disposed', LIFECYCLE_GATES.createdDeltaEqualsDisposedDelta === true);
    ok('[7b] active final cero', LIFECYCLE_GATES.activeFinal === 0);
    ok('[7c] ningún contexto vivo a los 60 s', LIFECYCLE_GATES.noContextAliveAfterSeconds === 60);
    ok('[7d] solo `active` es no monotónico',
        canonicalJson([...LIFECYCLE_GATES.countersMonotonicExcept]) === canonicalJson(['active']));
    ok('[7e] el endpoint operacional no altera contadores',
        LIFECYCLE_GATES.operationalEndpointMustNotChangeCounters === true);
    ok('[7f] ruta de telemetría secret-only correcta',
        LIFECYCLE_GATES.telemetryEndpoint === '/api/admin/system/metrics/request-context');
    ok('[7g] los diez contadores publicados están declarados', LIFECYCLE_GATES.telemetryCounters.length === 10);
    ok('[7h] se documenta que no hay reset', LIFECYCLE_GATES.countersResetOnlyOnProcessRestart === true);
}

section('[8] diseño muestral congelado');
{
    const L2 = SAMPLING_CONTRACT.level2;
    ok('[8a] nivel 1 no se repite en producción', SAMPLING_CONTRACT.level1.repeatInProduction === false);
    ok('[8b] nivel 1 conserva las 252 muestras del banco', SAMPLING_CONTRACT.level1.samplesPerRouteAndArm === 252);
    ok('[8c] 4 bloques por brazo', L2.blocksPerArm === 4);
    ok('[8d] ≥10 observaciones por bloque', L2.observationsPerBlockAndArm >= 10);
    ok('[8e] total por brazo dentro de [40,64]',
        L2.totalObservationsPerArmAndRoute >= 40 && L2.totalObservationsPerArmAndRoute <= 64);
    ok('[8f] NO se usan 250 muestras en producción', L2.totalObservationsPerArmAndRoute < 250);
    ok('[8g] bloques × observaciones = total',
        L2.blocksPerArm * L2.observationsPerBlockAndArm === L2.totalObservationsPerArmAndRoute);
    ok('[8h] concurrencia 1', L2.concurrency === 1);
    ok('[8i] bucle abierto (ritmo igualado)', L2.openLoop === true);
    ok('[8j] patrón ABBA + BAAB',
        canonicalJson([...L2.armSequence]) === canonicalJson(['off', 'on', 'on', 'off', 'off', 'on', 'on', 'off']));
    ok('[8k] cuatro bloques por brazo en la secuencia',
        L2.armSequence.filter((a) => a === 'off').length === 4 && L2.armSequence.filter((a) => a === 'on').length === 4);
    ok('[8l] warm-up separado', L2.warmupWavesPerBlock > 0);
    ok('[8m] pausa entre bloques', L2.cooldownSecondsBetweenBlocks > 0);
    ok('[8n] reglas de descarte declaradas', L2.discardRules.length === 3);
    ok('[8o] máximo de reintentos acotado', L2.maxRetriesPerBlock === 1 && L2.maxRetriesPerRun === 2);
    ok('[8p] envolvente de carga declarada',
        L2.abortIfHostLoad1Above > 0 && L2.abortIfApiCpuCoresAbove > 0 && L2.abortOnAnyApiRestart === true);
    ok('[8q] nivel 3: latencia solo descriptiva', SAMPLING_CONTRACT.level3.latencyIsDescriptiveOnly === true);
    ok('[8r] nivel 2 solo aplica a clases A y B',
        canonicalJson([...L2.appliesToClasses]) === canonicalJson(
            [ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED, ROUTE_CLASSES.COURSE_AGGREGATION_INDEXED]));
}

section('[9] criterios de selección determinísticos');
{
    ok('[9a] rango operativo declarado',
        GROUP_SELECTION_CRITERIA.minMembersInOro === 20 && GROUP_SELECTION_CRITERIA.maxMembersInOro === 120);
    ok('[9b] orden por lectores activos', GROUP_SELECTION_CRITERIA.orderBy === 'activeReaders DESC');
    ok('[9c] empates por id ascendente, no por preferencia humana',
        GROUP_SELECTION_CRITERIA.tieBreak === 'id ASC');
    ok('[9d] los sintéticos quedan excluidos por institución no registrada',
        GROUP_SELECTION_CRITERIA.exclusions.includes('SCHOOL_NOT_REGISTERED'));
    ok('[9e] usuario ordenado por hash estable', USER_SELECTION_CRITERIA.orderBy === 'sha256(userId) ASC');
    ok('[9f] el usuario no requiere login', USER_SELECTION_CRITERIA.requiresLogin === false);
    ok('[9g] lastLoginAt no puede modificarse', USER_SELECTION_CRITERIA.mustNotUpdateLastLoginAt === true);
    ok('[9h] respuesta verificada dos veces', USER_SELECTION_CRITERIA.verifyResponseTwice === true);

    // El orden por hash es estable e independiente del orden de entrada.
    const ids = ['user-z', 'user-a', 'user-m', 'user-b'];
    const byHash = (xs) => xs.slice().sort((a, b) => sha256Hex(a).localeCompare(sha256Hex(b)));
    ok('[9i] misma selección con el padrón barajado',
        byHash(ids)[0] === byHash(ids.slice().reverse())[0]);
    ok('[9j] hash truncado a 8 hex', /^[0-9a-f]{8}$/.test(shortHash('user-a')));
}

section('[10] principals sintéticos para las rutas negativas');
{
    ok('[10a] usuario sintético con formato de ruta válido', /^[a-z0-9-]+$/.test(SYNTHETIC_PRINCIPAL_USER_ID));
    ok('[10b] declara explícitamente que no existe', /does-not-exist/.test(SYNTHETIC_PRINCIPAL_USER_ID));
    ok('[10c] institución sintética inexistente', /does-not-exist/.test(SYNTHETIC_ABSENT_SCHOOL_SLUG));
    ok('[10d] el 403 no usa un identificador real de otra institución',
        ROUTE_CONTRACT.find((r) => r.id === 'NEG_403').auth === 'SYNTHETIC_USER_HEADER');
    ok('[10e] el 401 va sin credencial', ROUTE_CONTRACT.find((r) => r.id === 'NEG_401').auth === 'NONE');
    ok('[10f] el 404 usa la institución sintética',
        ROUTE_CONTRACT.find((r) => r.id === 'NEG_404').pathTemplate.includes(SYNTHETIC_ABSENT_SCHOOL_SLUG));
    ok('[10g] los sintéticos no cambian entre corridas',
        SYNTHETIC_PRINCIPAL_USER_ID === 'user-synthetic-corpus-01a-does-not-exist');
}

section('[11] el validador acepta un corpus íntegro');
{
    ok('[11a] fixture completo → VALID', verdictOf(buildFixtureCorpus()) === VERDICTS.VALID);
    ok('[11b] sin fugas en el fixture', scanCorpusForLeaks(buildFixtureCorpus()).length === 0);
}

section('[12] el validador rechaza: incompleto, modificado, desconocido, caducado');
{
    const drop = (k) => { const c = buildFixtureCorpus(); delete c[k]; return c; };
    ok('[12a] sin `routes` → DRIFTED', verdictOf(drop('routes')) === VERDICTS.DRIFTED);
    ok('[12b] sin `gates` → DRIFTED', verdictOf(drop('gates')) === VERDICTS.DRIFTED);
    ok('[12c] sin `normalization` → DRIFTED', verdictOf(drop('normalization')) === VERDICTS.DRIFTED);
    ok('[12d] sin `periods` → DRIFTED', verdictOf(drop('periods')) === VERDICTS.DRIFTED);

    const unknown = buildFixtureCorpus(); unknown.extraFieldNadieDeclaro = true;
    ok('[12e] campo desconocido → DRIFTED', verdictOf(unknown) === VERDICTS.DRIFTED);

    const tampered = buildFixtureCorpus();
    tampered.gates.COURSE_AGGREGATION_INDEXED.p95OnMaxRatio = 0.95;
    ok('[12f] gate relajado a posteriori → DRIFTED (el hash no cuadra)',
        verdictOf(tampered) === VERDICTS.DRIFTED);

    const resampled = buildFixtureCorpus();
    resampled.sampling.level2.totalObservationsPerArmAndRoute = 8;
    ok('[12g] muestra rebajada → DRIFTED', verdictOf(resampled) === VERDICTS.DRIFTED);

    const widened = buildFixtureCorpus();
    widened.normalization.technicalTimestampNames = [...TECHNICAL_TIMESTAMP_NAMES, 'lastLoginAt'];
    ok('[12h] whitelist ampliada → DRIFTED', verdictOf(widened) === VERDICTS.DRIFTED);

    const missingRoute = buildFixtureCorpus();
    missingRoute.routes = missingRoute.routes.filter((r) => r.id !== 'ROUTE_7');
    ok('[12i] falta ROUTE_7 → DRIFTED', verdictOf(missingRoute) === VERDICTS.DRIFTED);

    const unresolved = buildFixtureCorpus();
    unresolved.routes[1].path = '/api/metrics/school/{{ORG_A_SLUG}}';
    ok('[12j] marcador sin resolver → DRIFTED', verdictOf(unresolved) === VERDICTS.DRIFTED);

    ok('[12k] caducado → EXPIRED',
        verdictOf(buildFixtureCorpus(), new Date('2026-09-01T00:00:00Z')) === VERDICTS.EXPIRED);
    ok('[12l] antes de expirar pero pasada la revisión → DRIFTED',
        verdictOf(buildFixtureCorpus(), new Date('2026-08-20T00:00:00Z')) === VERDICTS.DRIFTED);
    const badExpiry = buildFixtureCorpus({ expiresAt: 'cuando toque' });
    ok('[12m] expiración ilegible → UNSAFE', verdictOf(badExpiry) === VERDICTS.UNSAFE);
    ok('[12n] corpus vacío → no VALID', verdictOf({}) !== VERDICTS.VALID);
}

section('[13] el peor veredicto gana y el validador es fail-closed');
{
    const r = new Report();
    r.add('a', false, VERDICTS.DRIFTED);
    r.add('b', false, VERDICTS.UNSAFE);
    r.add('c', true, VERDICTS.DRIFTED);
    ok('[13a] UNSAFE domina a DRIFTED', r.verdict() === VERDICTS.UNSAFE);
    const r2 = new Report();
    r2.add('a', false, VERDICTS.DRIFTED);
    r2.add('b', false, VERDICTS.EXPIRED);
    ok('[13b] EXPIRED domina a DRIFTED', r2.verdict() === VERDICTS.EXPIRED);
    ok('[13c] sin fallos, VALID', new Report().verdict() === VERDICTS.VALID);

    // Los dos cebos se construyen por concatenación y con valores reservados
    // (RFC 6761 `.invalid`, placeholder explícito): el detector se ejercita de
    // verdad, pero ningún escáner de credenciales ve una cadena sospechosa.
    const leaky = buildFixtureCorpus();
    leaky.group.notes = ['contacto: fixture', 'ejemplo.invalid'].join('@');
    ok('[13d] un correo en un campo libre se detecta', scanCorpusForLeaks(leaky).some((l) => l.kind === 'EMAIL'));
    const secretish = buildFixtureCorpus();
    secretish.group.notes = ['x-admin', 'secret: FIXTURE-NOT-A-REAL-SECRET-0000'].join('-');
    ok('[13e] un secreto pegado por descuido se detecta',
        scanCorpusForLeaks(secretish).some((l) => l.kind === 'ADMIN_SECRET_HEADER_VALUE'));
}

section('[14] aislamiento de stores: la población se lee, no se escribe');
{
    const data = path.join(TMP, 'data'); const dc = path.join(TMP, 'data-critical');
    fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(dc, { recursive: true });
    const schools = ORG_ALIASES.map((a) => ({ id: FAKE.orgIds[a], name: `Fixture ${a}` }));
    // ORG_A, ORG_B y ORG_C son direccionables (tienen grupo); ORG_D no, igual
    // que la institución registrada sin grupos que sostiene ROUTE_5.
    const groups = [
        { id: FAKE.groupId, school: 'Fixture ORG_A', type: 'course', memberIds: FAKE_MEMBERS },
        { id: 'group-fixture-b', school: 'Fixture ORG_B', type: 'course', memberIds: [] },
        { id: 'group-fixture-c', school: 'Fixture ORG_C', type: 'course', memberIds: [] },
    ];
    const oro = FAKE_MEMBERS.map((id) => ({ id, roles: ['lector'] }));
    fs.writeFileSync(path.join(data, 'schools_db.json'), JSON.stringify(schools));
    fs.writeFileSync(path.join(data, 'groups_db.json'), JSON.stringify(groups));
    fs.writeFileSync(path.join(dc, 'usuarios_colegios_oro.json'), JSON.stringify(oro));

    const corpus = buildFixtureCorpus();
    corpus.populationHashes.oroSha256 = sha256Hex(fs.readFileSync(path.join(dc, 'usuarios_colegios_oro.json')));
    corpus.populationHashes.groupsSha256 = sha256Hex(fs.readFileSync(path.join(data, 'groups_db.json')));
    corpus.populationHashes.schoolsSha256 = sha256Hex(fs.readFileSync(path.join(data, 'schools_db.json')));
    corpus.populationHashes.oroUserCount = oro.length;
    corpus.organizations = corpus.organizations.map((o) => ({ ...o, name: `Fixture ${o.alias}` }));

    const before = [path.join(data, 'schools_db.json'), path.join(data, 'groups_db.json'),
        path.join(dc, 'usuarios_colegios_oro.json')].map((p) => sha256Hex(fs.readFileSync(p)));

    const r = new Report();
    validatePopulation(corpus, { data, dataCritical: dc }, r);
    const after = [path.join(data, 'schools_db.json'), path.join(data, 'groups_db.json'),
        path.join(dc, 'usuarios_colegios_oro.json')].map((p) => sha256Hex(fs.readFileSync(p)));

    ok('[14a] la validación de población no falla sobre datos coherentes',
        r.failures.length === 0, r.failures.map((f) => f.name).join(','));
    ok('[14b] los ficheros quedan byte a byte iguales', canonicalJson(before) === canonicalJson(after));

    // Drift de membresía: sacar un miembro debe detectarse.
    fs.writeFileSync(path.join(data, 'groups_db.json'),
        JSON.stringify([{ ...groups[0], memberIds: FAKE_MEMBERS.slice(1) }, groups[1], groups[2]]));
    const r2 = new Report();
    validatePopulation(corpus, { data, dataCritical: dc }, r2);
    ok('[14c] un cambio de membresía se detecta como DRIFTED',
        r2.verdict() === VERDICTS.DRIFTED && r2.failures.some((f) => f.name.includes('membershipHash')));

    // Colisión del principal sintético: si existiera de verdad, sería UNSAFE.
    fs.writeFileSync(path.join(data, 'groups_db.json'), JSON.stringify(groups));
    fs.writeFileSync(path.join(dc, 'usuarios_colegios_oro.json'),
        JSON.stringify([...oro, { id: SYNTHETIC_PRINCIPAL_USER_ID, roles: ['lector'] }]));
    const r3 = new Report();
    validatePopulation(corpus, { data, dataCritical: dc }, r3);
    ok('[14d] si el principal sintético existiera → UNSAFE',
        r3.failures.some((f) => f.name === 'syntheticPrincipal.doesNotCollide' && f.verdictIfFailed === VERDICTS.UNSAFE));
}

section('[15] descriptor sanitizado versionado: cero PII, cero secretos');
{
    ok('[15a] el descriptor existe', fs.existsSync(SANITIZED));
    const text = fs.readFileSync(SANITIZED, 'utf8');
    const json = JSON.parse(text);
    ok('[15b] es JSON parseable', typeof json === 'object');
    ok('[15c] sin PII', findPii(text).length === 0, JSON.stringify(findPii(text)));
    ok('[15d] sin secretos (los sha256 de contrato son legítimos)',
        findSecrets(text, { allowSha256: true }).length === 0);
    ok('[15e] scanSanitizedForLeaks limpio', scanSanitizedForLeaks(text).length === 0);
    ok('[15f] ningún identificador exacto de organización',
        json.organizations.every((o) => !('id' in o) && /^[0-9a-f]{8}$/.test(o.idHash8)));
    ok('[15g] ningún identificador exacto de grupo',
        !('id' in json.group) && /^[0-9a-f]{8}$/.test(json.group.idHash8));
    ok('[15h] ningún identificador exacto de usuario',
        !('id' in json.user) && /^[0-9a-f]{8}$/.test(json.user.idHash8));
    ok('[15i] ninguna ruta resuelta (llevarían IDs)', json.routes.every((r) => !('path' in r)));
    ok('[15j] sin hashes de población (identifican el fichero exacto)', !('populationHashes' in json));
    ok('[15k] apunta al artefacto root-only', json.rootOnlyArtifact.mode === '0600 root:root');
    ok('[15l] mismo contrato que el código', json.acceptanceContractSha256 === acceptanceContractSha256());
    ok('[15m] las cuatro instituciones', json.organizations.length === 4);
    ok('[15n] alias completos',
        canonicalJson(json.organizations.map((o) => o.alias)) === canonicalJson([...ORG_ALIASES]));
    ok('[15o] estados de datos distinguidos, no colapsados a 0',
        json.organizations.some((o) => o.dataState === 'NO_ACTIVITY') &&
        json.organizations.some((o) => o.dataState === 'NOT_ADDRESSABLE'));
    ok('[15p] flags requeridos off/legacy',
        json.production.requiredFlags.LEGACY_METRICS_REQUEST_CONTEXT === 'off' &&
        json.production.requiredFlags.METRICS_ENGINE === 'legacy');
    ok('[15q] sin imageId (huella exacta de despliegue)', !('imageId' in json.production));
}

section('[16] el descriptor cumple su propio JSON Schema');
{
    const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
    const json = JSON.parse(fs.readFileSync(SANITIZED, 'utf8'));

    /** Subconjunto de draft-07 suficiente para este esquema. */
    function validate(node, s, at, errs) {
        if (!s || typeof s !== 'object') return;
        if (s.$ref) {
            const key = s.$ref.replace('#/definitions/', '');
            return validate(node, schema.definitions[key], at, errs);
        }
        if ('const' in s && node !== s.const) errs.push(`${at}: const ${JSON.stringify(s.const)} ≠ ${JSON.stringify(node)}`);
        if (s.enum && !s.enum.includes(node)) errs.push(`${at}: enum`);
        if (s.type) {
            const t = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
            const types = Array.isArray(s.type) ? s.type : [s.type];
            const okT = types.some((x) => x === t || (x === 'integer' && Number.isInteger(node)));
            if (!okT) { errs.push(`${at}: type ${types} ≠ ${t}`); return; }
        }
        if (s.pattern && typeof node === 'string' && !new RegExp(s.pattern).test(node)) errs.push(`${at}: pattern`);
        if (typeof node === 'number') {
            if (s.minimum != null && node < s.minimum) errs.push(`${at}: minimum`);
            if (s.maximum != null && node > s.maximum) errs.push(`${at}: maximum`);
        }
        if (Array.isArray(node)) {
            if (s.minItems != null && node.length < s.minItems) errs.push(`${at}: minItems`);
            if (s.maxItems != null && node.length > s.maxItems) errs.push(`${at}: maxItems`);
            if (s.items) node.forEach((v, i) => validate(v, s.items, `${at}[${i}]`, errs));
        }
        if (node && typeof node === 'object' && !Array.isArray(node)) {
            for (const r of s.required || []) if (!(r in node)) errs.push(`${at}: falta "${r}"`);
            if (s.additionalProperties === false && s.properties) {
                for (const k of Object.keys(node)) if (!(k in s.properties)) errs.push(`${at}: sobra "${k}"`);
            }
            for (const [k, sub] of Object.entries(s.properties || {})) {
                if (k in node) validate(node[k], sub, at ? `${at}.${k}` : k, errs);
            }
        }
    }
    const errs = [];
    validate(json, schema, '', errs);
    ok('[16a] el descriptor sanitizado valida contra el esquema', errs.length === 0, errs.slice(0, 5).join(' | '));

    const broken = JSON.parse(fs.readFileSync(SANITIZED, 'utf8'));
    broken.production.requiredFlags.LEGACY_METRICS_REQUEST_CONTEXT = 'on';
    const e2 = []; validate(broken, schema, '', e2);
    ok('[16b] el esquema rechaza el flag encendido', e2.length > 0);

    const broken2 = JSON.parse(fs.readFileSync(SANITIZED, 'utf8'));
    broken2.organizations.pop();
    const e3 = []; validate(broken2, schema, '', e3);
    ok('[16c] el esquema exige las cuatro instituciones', e3.length > 0);

    const broken3 = JSON.parse(fs.readFileSync(SANITIZED, 'utf8'));
    broken3.gates.COURSE_AGGREGATION_INDEXED.p95OnMaxRatio = 0.9;
    const e4 = []; validate(broken3, schema, '', e4);
    ok('[16d] el esquema congela el gate de la clase B', e4.length > 0);

    const broken4 = JSON.parse(fs.readFileSync(SANITIZED, 'utf8'));
    broken4.routes[0].campoInventado = 1;
    const e5 = []; validate(broken4, schema, '', e5);
    ok('[16e] el esquema rechaza campos desconocidos en una ruta', e5.length > 0);
}

console.log(`\nproductionCanaryCorpus: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
