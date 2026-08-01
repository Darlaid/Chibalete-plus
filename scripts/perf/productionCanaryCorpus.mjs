/**
 * productionCanaryCorpus.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A.
 *
 * **Contrato de aceptación congelado** del canary productivo de
 * `LEGACY_METRICS_REQUEST_CONTEXT`. Fuente única, versionada y sin PII de:
 *
 *   · la matriz R1–R7 y las tres rutas negativas;
 *   · la normalización de campos volátiles;
 *   · el diseño muestral productivo;
 *   · los gates por clase de ruta.
 *
 * Lo que este módulo **no** contiene y nunca debe contener: identificadores
 * exactos de organización, grupo o usuario. Esos viven únicamente en el
 * artefacto root-only del VPS (`PRODUCTION-CANARY-CORPUS.json`, 0600 root:root),
 * y aquí solo se referencian por alias y por hash.
 *
 * Consumidores:
 *   · `buildProductionCanaryCorpus.mjs`  — genera el artefacto root-only;
 *   · `validateProductionCanaryCorpus.mjs` — detecta drift antes del canary.
 *
 * Ninguna función de este módulo escribe en disco ni emite peticiones.
 */

import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Versiones
// ─────────────────────────────────────────────────────────────────────────────

export const CORPUS_ID = 'CHP-STATS-LEGACY-PERF-CORPUS-01A';
export const CORPUS_VERSION = '1.0.0';

/**
 * Versión del contrato de aceptación. Cambiarla es cambiar el criterio, y solo
 * puede hacerse en una unidad nueva: nunca durante un canary y nunca después de
 * ver resultados.
 */
export const ACCEPTANCE_CONTRACT_VERSION = '1.0.0';

/** Alias públicos. La relación alias ↔ identidad exacta es root-only. */
export const ORG_ALIASES = ['ORG_A', 'ORG_B', 'ORG_C', 'ORG_D'];
export const GROUP_ALIAS = 'GROUP_R7';
export const USER_ALIAS = 'USER_R6';

// ─────────────────────────────────────────────────────────────────────────────
// Clases de ruta — recuperadas de -01E (contadores del servidor, no supuestos)
// ─────────────────────────────────────────────────────────────────────────────

export const ROUTE_CLASSES = {
    SCHOOL_AGGREGATION_MEMOIZED: 'SCHOOL_AGGREGATION_MEMOIZED',
    COURSE_AGGREGATION_INDEXED: 'COURSE_AGGREGATION_INDEXED',
    UNCHANGED_NO_CONTEXT: 'UNCHANGED_NO_CONTEXT',
};

/**
 * Principals sintéticos. Cumplen el formato de la ruta, no colisionan con
 * producción y son estables entre corridas.
 *
 * `SYNTHETIC_PRINCIPAL_USER_ID` produce el 403 **sin usar el identificador real
 * de otra institución**: `resolveRequester` devuelve `null` para un `x-user-id`
 * desconocido, y el handler de alumno responde 403 en cuanto `selfAccess` es
 * falso. Reutilizar un lector real de otra organización daría el mismo status a
 * cambio de exponer un cruce entre poblaciones; no compensa.
 */
export const SYNTHETIC_PRINCIPAL_USER_ID = 'user-synthetic-corpus-01a-does-not-exist';
export const SYNTHETIC_ABSENT_SCHOOL_SLUG = 'synthetic-school-does-not-exist';

/**
 * Matriz R1–R7 + negativas.
 *
 * `pathTemplate` usa marcadores que el corpus root-only resuelve con los IDs
 * exactos. Ninguna ruta admite parámetros de query: los cuatro handlers legacy
 * (`/api/metrics/schools`, `/api/metrics/school/:schoolId`,
 * `/api/metrics/student/:userId`, `/api/metrics/course/:courseId`) leen
 * exclusivamente `req.params`. No hay nada que «seleccionar en ejecución».
 */
export const ROUTE_CONTRACT = Object.freeze([
    {
        id: 'ROUTE_1',
        desc: 'listado institucional',
        method: 'GET',
        pathTemplate: '/api/metrics/schools',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.UNCHANGED_NO_CONTEXT,
        expectedStatus: 200,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: false,
        topLevelKeys: ['schools'],
    },
    {
        id: 'ROUTE_2',
        desc: 'institucion alto volumen',
        method: 'GET',
        pathTemplate: '/api/metrics/school/{{ORG_A_SLUG}}',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED,
        expectedStatus: 200,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: true,
        topLevelKeys: ['alerts', 'backboneMetrics', 'computedAt', 'courseBreakdown',
            'distributions', 'icdli', 'productMetrics', 'readingLevels',
            'schoolId', 'schoolName', 'summary'],
    },
    {
        id: 'ROUTE_3',
        desc: 'institucion sin actividad',
        method: 'GET',
        pathTemplate: '/api/metrics/school/{{ORG_B_SLUG}}',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED,
        expectedStatus: 200,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: true,
        topLevelKeys: ['alerts', 'backboneMetrics', 'computedAt', 'courseBreakdown',
            'distributions', 'icdli', 'productMetrics', 'readingLevels',
            'schoolId', 'schoolName', 'summary'],
    },
    {
        id: 'ROUTE_4',
        desc: 'institucion FilBo',
        method: 'GET',
        pathTemplate: '/api/metrics/school/{{ORG_C_SLUG}}',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED,
        expectedStatus: 200,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: true,
        topLevelKeys: ['alerts', 'backboneMetrics', 'computedAt', 'courseBreakdown',
            'distributions', 'icdli', 'productMetrics', 'readingLevels',
            'schoolId', 'schoolName', 'summary'],
    },
    {
        id: 'ROUTE_5',
        desc: 'institucion registrada sin grupos',
        method: 'GET',
        pathTemplate: '/api/metrics/school/{{ORG_D_SLUG}}',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.UNCHANGED_NO_CONTEXT,
        // Registrada en `schools_db.json` pero sin un solo grupo, así que
        // `resolveSchoolRecord` no la resuelve y el 404 se emite ANTES de
        // cualquier cálculo. Es un control de camino corto, no un error.
        expectedStatus: 404,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: false,
        topLevelKeys: ['error'],
    },
    {
        id: 'ROUTE_6',
        desc: 'usuario',
        method: 'GET',
        pathTemplate: '/api/metrics/student/{{USER_R6_ID}}',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.UNCHANGED_NO_CONTEXT,
        expectedStatus: 200,
        expectedContentType: 'application/json; charset=utf-8',
        // Medido en -01B: para un solo alumno construir los índices cuesta
        // +47 %. La ruta de alumno suelto NO crea contexto, por diseño.
        createsContext: false,
        topLevelKeys: ['alerts', 'backboneMetrics', 'computedAt', 'dataWindow',
            'icdli', 'productMetrics', 'readingLevels', 'summary', 'userId'],
    },
    {
        id: 'ROUTE_7',
        desc: 'grupo',
        method: 'GET',
        pathTemplate: '/api/metrics/course/{{GROUP_R7_ID}}',
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.COURSE_AGGREGATION_INDEXED,
        expectedStatus: 200,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: true,
        topLevelKeys: ['alerts', 'backboneMetrics', 'computedAt', 'courseId',
            'courseName', 'distributions', 'icdli', 'needsAttention',
            'productMetrics', 'readingLevels', 'studentBreakdown', 'summary',
            'topPerformers'],
    },
    {
        id: 'NEG_401',
        desc: 'sin identidad',
        method: 'GET',
        pathTemplate: '/api/metrics/schools',
        auth: 'NONE',
        routeClass: ROUTE_CLASSES.UNCHANGED_NO_CONTEXT,
        expectedStatus: 401,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: false,
        topLevelKeys: ['error'],
    },
    {
        id: 'NEG_403',
        desc: 'principal sintetico fuera de scope',
        method: 'GET',
        pathTemplate: '/api/metrics/student/{{USER_R6_ID}}',
        auth: 'SYNTHETIC_USER_HEADER',
        routeClass: ROUTE_CLASSES.UNCHANGED_NO_CONTEXT,
        expectedStatus: 403,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: false,
        topLevelKeys: ['error'],
    },
    {
        id: 'NEG_404',
        desc: 'scope inexistente',
        method: 'GET',
        pathTemplate: `/api/metrics/school/${SYNTHETIC_ABSENT_SCHOOL_SLUG}`,
        auth: 'ADMIN_SECRET',
        routeClass: ROUTE_CLASSES.UNCHANGED_NO_CONTEXT,
        expectedStatus: 404,
        expectedContentType: 'application/json; charset=utf-8',
        createsContext: false,
        topLevelKeys: ['error'],
    },
]);

/** Las siete rutas de rendimiento, en orden. */
export const PERF_ROUTE_IDS = Object.freeze(
    ['ROUTE_1', 'ROUTE_2', 'ROUTE_3', 'ROUTE_4', 'ROUTE_5', 'ROUTE_6', 'ROUTE_7']);
export const NEGATIVE_ROUTE_IDS = Object.freeze(['NEG_401', 'NEG_403', 'NEG_404']);

// ─────────────────────────────────────────────────────────────────────────────
// Normalización — derivada de la evidencia, no declarada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nombres admisibles como sello técnico. Son **exactamente** los diez de
 * `http-equivalence.mjs` en `-01E`. `lastActivityAt`, `lastLoginAt` y cualquier
 * otro campo NO están aquí: la evidencia histórica no los excluyó, y añadirlos
 * por intuición sería ampliar la whitelist para tapar una diferencia real.
 */
export const TECHNICAL_TIMESTAMP_NAMES = Object.freeze([
    'computedAt', 'generatedAt', 'createdAt', 'timestamp',
    'windowFrom', 'windowTo', 'from', 'to', 'fromTs', 'toTs',
]);

export const TECHNICAL_TIMESTAMP_PATTERN =
    `(^|\\.)(${TECHNICAL_TIMESTAMP_NAMES.join('|')})$`;

/**
 * Las nueve rutas de sello técnico que realmente variaron dentro del brazo
 * `off` en `-01E`, y que esta unidad reprodujo sobre las capturas archivadas.
 * Un campo solo se excluye si **además** varía dentro del propio brazo: la
 * lista acota, no autoriza por sí sola.
 */
export const DERIVED_VOLATILE_PATHS = Object.freeze([
    'backboneMetrics.funnels.generatedAt',
    'backboneMetrics.funnels.windowFrom',
    'backboneMetrics.funnels.windowTo',
    'backboneMetrics.generatedAt',
    'backboneMetrics.insights.generatedAt',
    'backboneMetrics.insights.insights[].createdAt',
    'backboneMetrics.windowFrom',
    'backboneMetrics.windowTo',
    'computedAt',
]);

export const NORMALIZATION_CONTRACT = Object.freeze({
    technicalTimestampNames: TECHNICAL_TIMESTAMP_NAMES,
    technicalTimestampPattern: TECHNICAL_TIMESTAMP_PATTERN,
    derivedVolatilePaths: DERIVED_VOLATILE_PATHS,
    /** Un campo volátil no técnico es no-determinismo funcional, no ruido. */
    excludeRequiresBothNameAndIntraArmVariation: true,
    sortObjectKeys: false,     // el orden de claves ES contractual
    sortArrays: false,         // ningún array se ordena
    compareStatus: true,
    compareContentType: true,
    compareNulls: true,
    compareZeroVsNull: true,   // 0, NO_ACTIVITY, NO_DATA y DATA_INCOMPLETE difieren
    compareDenominators: true,
    compareDataStates: true,
    compareCoverage: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Diseño muestral productivo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NIVEL 1 — evidencia algorítmica previa. Ya ejecutada en `-01E-R1` sobre banco
 * aislado (252 muestras por ruta y brazo, topologías individual y dual,
 * concurrencias 1 y 4). **No se repite en producción.**
 */
export const LEVEL_1_PRIOR_EVIDENCE = Object.freeze({
    unit: 'CHP-STATS-LEGACY-PERF-01E-R1',
    samplesPerRouteAndArm: 252,
    topologies: ['individual', 'dual'],
    concurrencies: [1, 4],
    repeatInProduction: false,
});

/**
 * NIVEL 2 — canary productivo de las rutas con efecto grande.
 *
 * 16 observaciones por bloque y brazo × 4 bloques por brazo = **64 por brazo y
 * ruta**, el máximo que la unidad autoriza sin nueva aprobación.
 *
 * Por qué 64 y no el mínimo de 40: con 10 observaciones por bloque el estimador
 * de p95 ES el máximo del bloque (`ceil(0.95·10)−1 = 9`, el último de diez), que
 * es justamente el estadístico inestable que produjo el falso negativo de
 * `-01E`. Con 64 agregadas el p95 cae en el 61.º estadístico de orden de 64 —una
 * cuantila de cola de verdad—, y los 16 por bloque bastan para que el p50 por
 * bloque (8.º–9.º de 16) sea estable en el control de consistencia.
 *
 * Por qué no 250: en banco aislado el coste de saturar era nulo. En producción
 * cada petición de agregación cuesta ~0,7–1,1 s de CPU sobre 2 vCPU
 * compartidos con tráfico real. 252 por brazo y ruta multiplicarían por ~4 la
 * duración y la carga sin mover el veredicto, porque el efecto medido
 * (62–88 % de reducción) está muy por encima de los gates (40–50 %).
 */
export const LEVEL_2_PRODUCTION_CANARY = Object.freeze({
    appliesToClasses: [
        ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED,
        ROUTE_CLASSES.COURSE_AGGREGATION_INDEXED,
    ],
    blocksPerArm: 4,
    totalBlocks: 8,
    /** ABBA + BAAB, idéntico a `-01E-R1`. */
    armSequence: ['off', 'on', 'on', 'off', 'off', 'on', 'on', 'off'],
    observationsPerBlockAndArm: 16,
    totalObservationsPerArmAndRoute: 64,
    concurrency: 1,
    /**
     * Solo ritmo de llegada igualado (bucle abierto). El bucle cerrado hace que
     * el brazo rápido reciba más carga y confunde «código más rápido» con «más
     * peticiones por segundo».
     */
    openLoop: true,
    pacingMsAggregation: 2500,
    pacingMsUnchanged: 1000,
    warmupWavesPerBlock: 4,
    cooldownSecondsBetweenBlocks: 30,
    seedBase: 900,
    /** Un bloque se descarta —entero— si ocurre cualquiera de estas cosas. */
    discardRules: [
        'TRANSPORT_ERROR_OR_TIMEOUT_IN_BLOCK',
        'CONTAMINATED_COUNTER_BASELINE_AT_BLOCK_START',
        'FEWER_THAN_16_VALID_OBSERVATIONS',
    ],
    maxRetriesPerBlock: 1,
    maxRetriesPerRun: 2,
    /** Más de un bloque descartado por brazo invalida la corrida. */
    maxDiscardedBlocksPerArm: 1,
    /** Envolvente de seguridad: superarla aborta el canary, no lo degrada. */
    abortIfHostLoad1Above: 3.0,
    abortIfApiCpuCoresAbove: 1.2,
    abortOnAnyApiRestart: true,
});

/**
 * NIVEL 3 — rutas sin contexto. Se verifican **estructuralmente**, no por
 * latencia: `-01E-R1` demostró con un control nulo que el gate del ±5 % sobre
 * p95 queda por debajo de la resolución del experimento (el brazo `off`
 * comparado consigo mismo lo incumple, +32 % en topología dual).
 */
export const LEVEL_3_UNCHANGED_ROUTES = Object.freeze({
    appliesToClasses: [ROUTE_CLASSES.UNCHANGED_NO_CONTEXT],
    observationsPerBlockAndArm: 16,
    totalObservationsPerArmAndRoute: 64,
    latencyIsDescriptiveOnly: true,
    percentBandGateRejected: '±5 % sobre p95 — por debajo del ruido, no discrimina',
});

export const SAMPLING_CONTRACT = Object.freeze({
    level1: LEVEL_1_PRIOR_EVIDENCE,
    level2: LEVEL_2_PRODUCTION_CANARY,
    level3: LEVEL_3_UNCHANGED_ROUTES,
});

// ─────────────────────────────────────────────────────────────────────────────
// Gates congelados
// ─────────────────────────────────────────────────────────────────────────────

export const GATES = Object.freeze({
    /** Clase A — gates históricos exactos de `-01E-R1`, sin reescribir. */
    [ROUTE_CLASSES.SCHOOL_AGGREGATION_MEMOIZED]: Object.freeze({
        routes: ['ROUTE_2', 'ROUTE_3', 'ROUTE_4'],
        p50OnMaxRatio: 0.50,
        p95OnMaxRatio: 0.50,
        absoluteP95ReductionMs: 100,
        absoluteAppliesWhenP95OffAtLeastMs: 200,
        contextsCreatedEqualsDisposed: true,
        memoHitsMustBePositive: true,
        progressScansPerRequest: 1,
        eventProcessingsPerRequest: 1,
        blocksThatMustPass: 3,
        blocksPerArm: 4,
        aggregateMustPass: true,
    }),
    /** Clase B — gates históricos exactos de `-01E-R1`, sin reescribir. */
    [ROUTE_CLASSES.COURSE_AGGREGATION_INDEXED]: Object.freeze({
        routes: ['ROUTE_7'],
        p50OnMaxRatio: 0.65,
        p95OnMaxRatio: 0.60,
        absoluteP95ReductionMs: 100,
        absoluteAppliesWhenP95OffAtLeastMs: 250,
        zeroMemoHitsIsExpected: true,
        progressScansPerRequest: 1,
        eventProcessingsPerRequest: 1,
        contractRegressions: 0,
        blocksThatMustPass: 3,
        blocksPerArm: 4,
        aggregateMustPass: true,
        /**
         * `-01E-R1` exigía cumplir en topología individual **y** dual. El canary
         * productivo es de UNA sola API por construcción: la topología dual no
         * es reproducible sin poner el flag en ambas instancias, que es
         * justamente lo que el canary existe para evitar. El subcriterio dual se
         * da por satisfecho con la evidencia de nivel 1 (58,1 %, 4/4 bloques) y
         * NO se vuelve a medir. Queda declarado, no silenciado.
         */
        dualTopologySatisfiedByLevel1Evidence: true,
    }),
    /** Clase C — estructural. La latencia informa, no bloquea. */
    [ROUTE_CLASSES.UNCHANGED_NO_CONTEXT]: Object.freeze({
        routes: ['ROUTE_1', 'ROUTE_5', 'ROUTE_6', 'NEG_401', 'NEG_403', 'NEG_404'],
        contractDifferences: 0,
        valueDifferences: 0,
        createdDelta: 0,
        disposedDelta: 0,
        activeFinal: 0,
        memoHitsDelta: 0,
        memoMissesDelta: 0,
        latencyBlocking: false,
        /**
         * «Regresión extrema», definida ANTES del canary. Las dos condiciones
         * cuantitativas son conjuntas a propósito: una ruta que pase de 20 a
         * 45 ms dobla su p95 sin que eso signifique nada.
         */
        extremeRegression: Object.freeze({
            newErrorStatusNotPresentInOffArm: true,
            anyTimeoutMs: 30000,
            p95RatioAbove: 2.0,
            andAbsoluteIncreaseAboveMs: 250,
        }),
    }),
});

/** Ciclo de vida — se exige en todas las clases y en toda la corrida. */
export const LIFECYCLE_GATES = Object.freeze({
    createdDeltaEqualsDisposedDelta: true,
    activeFinal: 0,
    noContextAliveAfterSeconds: 60,
    countersMonotonicExcept: ['active'],
    operationalEndpointMustNotChangeCounters: true,
    /** Ruta operacional de lectura, secret-only, introducida en `bba2a4e`. */
    telemetryEndpoint: '/api/admin/system/metrics/request-context',
    telemetryCounters: [
        'createdTotal', 'disposedTotal', 'active',
        'progressUsersIndexedTotal', 'eventUsersIndexedTotal',
        'memoHitsTotal', 'memoMissesTotal', 'legacyFallbackCallsTotal',
        'studentComputationsTotal', 'buildDurationMsTotal',
    ],
    /**
     * No existe reset por HTTP ni exportado: los contadores solo vuelven a cero
     * al reiniciar el proceso. Por eso todo se evalúa por **delta** entre dos
     * lecturas, nunca por valor absoluto.
     */
    countersResetOnlyOnProcessRestart: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterios de selección — declarados ANTES de observar ningún ganador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rango operativo de `GROUP_R7`, fijado antes de mirar la distribución real.
 *
 * La clave del rango es `membersInOro` —la población que el agregador recorre
 * de verdad—, no el número de lectores activos: `computeStudentMetrics` escanea
 * el mapa de progreso completo tenga o no el alumno actividad, así que el coste
 * lo fija el censo del grupo. Los lectores activos ordenan; el censo acota.
 */
export const GROUP_SELECTION_CRITERIA = Object.freeze({
    /**
     * 20: con ~8 ms de recomputación por alumno (`-01A`: 4,2–9,3 ms de scan de
     * progreso + 1,9–2,2 ms de `parseSessions`) más los ~100 ms fijos de
     * `loadAndInitMetrics`, veinte alumnos sitúan `p95_off` por encima de los
     * 250 ms que exige el criterio absoluto de la clase B. Por debajo, el gate
     * histórico no es ejercitable y el canary no probaría nada.
     */
    minMembersInOro: 20,
    /**
     * 120: `p50_off` histórico con 90 alumnos fue 696–1444 ms. A 120 la
     * petición se mantiene por debajo de ~2 s, de modo que con concurrencia 1 y
     * ritmo de 2500 ms el canary queda por debajo del 100 % de un core.
     */
    maxMembersInOro: 120,
    minActiveReaders: 1,
    exclusions: [
        'SCHOOL_NOT_REGISTERED',   // excluye por construcción grupos sintéticos y de prueba
        'ARCHIVED',
        'EMPTY',
        'NO_ORO_COVERAGE',
        'OUT_OF_RANGE',
        'NO_ATTRIBUTABLE_ACTIVITY',
    ],
    orderBy: 'activeReaders DESC',
    tieBreak: 'id ASC',
});

/**
 * `USER_R6`. El orden por hash estable del identificador evita que la elección
 * dependa del orden del padrón, de la antigüedad o de una preferencia humana.
 */
export const USER_SELECTION_CRITERIA = Object.freeze({
    mustBeInCanonicalPadron: true,
    requiredRole: 'lector',
    mustBeMemberOfGroupR7: true,
    requiresLogin: false,
    mustNotUpdateLastLoginAt: true,
    orderBy: 'sha256(userId) ASC',
    takeFirstSatisfying: true,
    verifyResponseTwice: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Periodos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las cuatro rutas legacy **no admiten un solo parámetro de query**: leen
 * exclusivamente `req.params`. No existe, por tanto, un periodo que el corpus
 * pueda fijar como parámetro de petición, y decir lo contrario sería inventar
 * una superficie que el código no tiene.
 *
 * Lo que sí se congela son las tres ventanas que gobiernan de verdad la
 * comparación:
 *
 *  A. `dataCoverage` — ventana absoluta de los datos productivos. Es el periodo
 *     principal: lo que el canary observa sale de aquí.
 *  B. `rollingBackboneWindow` — `windowDays: 30` fijado en el código, relativo
 *     al instante de la petición. No es configurable. Sus campos
 *     (`windowFrom`/`windowTo`) ya están en la whitelist de sellos técnicos
 *     derivada de la evidencia, así que su deriva está normalizada, no ignorada.
 *  C. `canaryExecutionWindow` — ventana absoluta de ejecución, declarada por
 *     corrida. Ambos brazos de un mismo bloque la comparten, que es lo que hace
 *     comparable la ventana rodante.
 *
 * De ahí sale la expiración: la última actividad registrada es de
 * 2026-07-25T23:17:59Z, así que la ventana rodante de 30 días se vacía el
 * 2026-08-24T23:17:59Z. Pasado ese instante, `backboneMetrics` cambia de forma
 * en las rutas de clase A, B y en ROUTE_6, y el corpus dejaría de describir lo
 * que mide.
 */
export const PERIOD_CONTRACT = Object.freeze({
    timezone: 'UTC',
    routesAcceptQueryParameters: false,
    dataCoverage: Object.freeze({
        role: 'PRIMARY',
        progressFrom: '2026-03-16T21:51:07.928Z',
        progressTo: '2026-07-25T23:17:51.927Z',
        eventsFrom: '2026-05-08T01:24:12Z',
        eventsTo: '2026-07-25T23:17:59Z',
    }),
    rollingBackboneWindow: Object.freeze({
        role: 'SECONDARY_CONTROL',
        windowDays: 30,
        codeFixed: true,
        relativeToRequestTime: true,
        normalizedFields: ['windowFrom', 'windowTo', 'generatedAt'],
    }),
    canaryExecutionWindow: Object.freeze({
        role: 'DECLARED_PER_RUN',
        mustBeAbsolute: true,
        mustBeBeforeCorpusExpiry: true,
    }),
    forbidden: ['now', 'ultimos-30-dias-recalculados-por-request', 'timestamps-moviles'],
});

// ─────────────────────────────────────────────────────────────────────────────
// Serialización canónica y hash del contrato
// ─────────────────────────────────────────────────────────────────────────────

/** JSON con claves ordenadas en profundidad: mismo contrato → mismo byte. */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** El contrato de aceptación: lo que no puede cambiar tras ver resultados. */
export function acceptanceContract() {
    return {
        acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
        routes: ROUTE_CONTRACT,
        normalization: NORMALIZATION_CONTRACT,
        sampling: SAMPLING_CONTRACT,
        gates: GATES,
        lifecycle: LIFECYCLE_GATES,
        periods: PERIOD_CONTRACT,
        groupSelection: GROUP_SELECTION_CRITERIA,
        userSelection: USER_SELECTION_CRITERIA,
    };
}

export function acceptanceContractSha256() {
    return crypto.createHash('sha256').update(canonicalJson(acceptanceContract())).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de sanitización
// ─────────────────────────────────────────────────────────────────────────────

export function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Hash truncado para documentos versionados. Nunca el identificador. */
export function shortHash(value) {
    return sha256Hex(value).slice(0, 8);
}

/**
 * Resuelve los marcadores de `pathTemplate` con los identificadores exactos.
 * Solo se invoca dentro del artefacto root-only o en el propio VPS.
 */
export function resolvePath(pathTemplate, bindings) {
    return pathTemplate.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key) => {
        if (!(key in bindings)) throw new Error(`marcador sin resolver: ${key}`);
        return String(bindings[key]);
    });
}

/** Marcadores que un `pathTemplate` declara. */
export function templatePlaceholders(pathTemplate) {
    return [...pathTemplate.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de PII y de secretos en el material versionado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formas de identificador que NO pueden aparecer en un documento versionado.
 * No pretende ser un detector universal: cubre exactamente los formatos que
 * este dominio produce.
 */
const PII_PATTERNS = Object.freeze([
    { name: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
    { name: 'USER_ID', re: /\buser[-_][0-9]{10,}\b/i },
    { name: 'GROUP_ID', re: /\b(?:group|course|grupo)[-_][0-9]{10,}\b/i },
    { name: 'SCHOOL_ID', re: /\bschool-[0-9]{10,}\b/i },
    { name: 'EPOCH_ID', re: /\b17[0-9]{11}\b/ },
]);

const SECRET_PATTERNS = Object.freeze([
    { name: 'ADMIN_SECRET_HEADER_VALUE', re: /x-admin-secret\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/i },
    { name: 'HEX_64', re: /\b[0-9a-f]{64}\b/ },
    { name: 'BEARER', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
    { name: 'PRIVATE_KEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'API_KEY_ASSIGN', re: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{16,}["']/i },
]);

/**
 * @param {string} text
 * @param {{allowSha256: boolean}} [opts] los hashes de población son sha256 de
 *   64 hex legítimos; el corpus root-only los lleva, los documentos no.
 */
export function findPii(text) {
    return PII_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function findSecrets(text, { allowSha256 = false } = {}) {
    return SECRET_PATTERNS
        .filter((p) => (allowSha256 && p.name === 'HEX_64' ? false : p.re.test(text)))
        .map((p) => p.name);
}
