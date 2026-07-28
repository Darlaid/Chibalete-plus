/**
 * comparability.mjs — CHP-STATS-SHADOW-01A.
 *
 * Declara QUÉ puede compararse entre el motor legacy y el canónico, con qué
 * periodo, y cómo se clasifica cada diferencia. Es un módulo de DECISIONES: no
 * hace I/O, no lee stores y no conoce Express.
 *
 * Por qué existe: legacy y canónico no son dos implementaciones de la misma
 * métrica. Difieren en fuente (progress_db/analytics vs events.db), en cómo
 * definen la población (texto `group.school` vs `organizationId`) y en periodo
 * (acumulado histórico vs ventana explícita). Comparar a ciegas produciría
 * "divergencias" que en realidad son diferencias de contrato, y ocultaría las
 * que sí importan.
 */

// ── Taxonomía de comparabilidad ─────────────────────────────────────────────
export const COMPARABILITY = Object.freeze({
    COMPARABLE_EXACT:              'COMPARABLE_EXACT',
    COMPARABLE_WITH_NORMALIZATION: 'COMPARABLE_WITH_NORMALIZATION',
    EXPECTED_CONTRACT_DIFFERENCE:  'EXPECTED_CONTRACT_DIFFERENCE',
    PERIOD_NOT_COMPARABLE:         'PERIOD_NOT_COMPARABLE',
    NOT_AVAILABLE_IN_LEGACY:       'NOT_AVAILABLE_IN_LEGACY',
    NOT_AVAILABLE_IN_CANONICAL:    'NOT_AVAILABLE_IN_CANONICAL',
    SEMANTICALLY_UNSAFE:           'SEMANTICALLY_UNSAFE',
});

// ── Razones de diferencia ───────────────────────────────────────────────────
export const REASON = Object.freeze({
    LEGACY_SOURCE_DIFFERENCE:       'LEGACY_SOURCE_DIFFERENCE',
    POPULATION_CONTRACT_DIFFERENCE: 'POPULATION_CONTRACT_DIFFERENCE',
    LEGACY_TEXT_JOIN:               'LEGACY_TEXT_JOIN',
    SESSION_RECONSTRUCTION_DIFFERENCE: 'SESSION_RECONSTRUCTION_DIFFERENCE',
    PERIOD_DIFFERENCE:              'PERIOD_DIFFERENCE',
    NO_DATA_SEMANTICS:              'NO_DATA_SEMANTICS',
    UNATTRIBUTED_EVENTS_EXCLUDED:   'UNATTRIBUTED_EVENTS_EXCLUDED',
    METRIC_NOT_COMPARABLE:          'METRIC_NOT_COMPARABLE',
    CANONICAL_SOURCE_ERROR:         'CANONICAL_SOURCE_ERROR',
    CANONICAL_SHAPE_INVALID:        'CANONICAL_SHAPE_INVALID',
    LEGACY_SHAPE_INVALID:           'LEGACY_SHAPE_INVALID',
    UNKNOWN_DIFFERENCE:             'UNKNOWN_DIFFERENCE',
});

export const SEVERITY = Object.freeze({
    EXPECTED:     'EXPECTED',
    REVIEW:       'REVIEW',
    ALERT:        'ALERT',
    ENGINE_ERROR: 'ENGINE_ERROR',
});

// ── Semántica de periodo por ruta ───────────────────────────────────────────
export const PERIOD_KIND = Object.freeze({
    NONE:            'NONE',              // la ruta no expone una métrica temporal
    ACCUMULATED:     'ACCUMULATED',       // acumulado histórico sin ventana declarada
    FIXED_WINDOW:    'FIXED_WINDOW',      // ventana fija horneada en el código
    REQUEST_WINDOW:  'REQUEST_WINDOW',    // ventana recibida por parámetro
    UNDETERMINED:    'UNDETERMINED',      // no demostrable → nunca se compara
});

/**
 * Contrato real de cada ruta en alcance, verificado leyendo `server.js` y
 * `metricsService.js`. `legacyCore` describe el cuerpo histórico de la
 * respuesta; `backboneAugment` describe el bloque `backboneMetrics`, que sí
 * proviene de events.db con una ventana explícita.
 */
export const ROUTE_CONTRACTS = Object.freeze({
    'metrics.schools': {
        path: '/api/metrics/schools',
        successor: '/api/v2/metrics/organizations',
        auth: 'admin_secret_or_authenticated_requester',
        legacySource: 'groups_db.school (texto libre)',
        legacyCore: { periodKind: PERIOD_KIND.NONE, windowDays: null },
        backboneAugment: null,
        note: 'Listado, no métrica. Deriva instituciones del texto `group.school`, '
            + 'no del registro institucional: puede listar nombres que no existen '
            + 'en schools_db y omitir instituciones registradas sin grupos.',
    },
    'metrics.school': {
        path: '/api/metrics/school/:schoolId',
        successor: '/api/v2/metrics/organizations/{organizationId}',
        auth: 'admin_secret_only',
        legacySource: 'metricsService.computeSchoolMetrics(schoolName)',
        legacyCore: { periodKind: PERIOD_KIND.ACCUMULATED, windowDays: null },
        backboneAugment: { periodKind: PERIOD_KIND.FIXED_WINDOW, windowDays: 30 },
        note: 'La entrada admite slug o nombre y se resuelve con `groups.find`, '
            + 'que toma la PRIMERA coincidencia sobre texto libre.',
    },
    'metrics.course': {
        path: '/api/metrics/course/:courseId',
        successor: '/api/v2/metrics/groups/{groupId}',
        auth: 'admin_secret_or_mediator_of_course',
        legacySource: 'metricsService.computeCourseMetrics(courseId)',
        legacyCore: { periodKind: PERIOD_KIND.ACCUMULATED, windowDays: null },
        backboneAugment: { periodKind: PERIOD_KIND.FIXED_WINDOW, windowDays: 30 },
        note: 'courseId ya es un groupId estable: no hay join textual.',
    },
    'metrics.student': {
        path: '/api/metrics/student/:userId',
        successor: '/api/v2/metrics/users/{userId}',
        auth: 'admin_secret_or_self',
        legacySource: 'metricsService.computeStudentMetrics(userId)',
        legacyCore: { periodKind: PERIOD_KIND.ACCUMULATED, windowDays: null },
        backboneAugment: { periodKind: PERIOD_KIND.FIXED_WINDOW, windowDays: 30 },
        note: 'No admite mediador: solo admin secret o el propio usuario.',
    },
});

/**
 * Matriz por métrica. `legacyPath` es null cuando la métrica no existe en la
 * respuesta legacy. Nada marcado distinto de COMPARABLE_* llega al comparador.
 */
export const METRIC_MATRIX = Object.freeze([
    // ── poblaciones ────────────────────────────────────────────────────────
    { key: 'registeredUsers', legacyPath: 'summary.studentCount',
      comparability: COMPARABILITY.EXPECTED_CONTRACT_DIFFERENCE,
      reason: REASON.POPULATION_CONTRACT_DIFFERENCE,
      why: 'legacy cuenta alumnos alcanzados por el texto `school`; canónico cuenta '
         + 'usuarios con `organizationId`. Son poblaciones distintas por definición.' },

    { key: 'registeredReaders', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_LEGACY,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: 'legacy no distingue lector de mediador dentro del conteo.' },

    { key: 'eligibleReaders', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_LEGACY,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: 'concepto introducido por el contrato canónico.' },

    { key: 'readersWithoutGroup', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_LEGACY,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: 'legacy deriva la población DESDE los grupos: un lector sin grupo es invisible.' },

    // ── actividad ──────────────────────────────────────────────────────────
    { key: 'usersWithActivity', legacyPath: 'summary.activeStudentCount',
      comparability: COMPARABILITY.PERIOD_NOT_COMPARABLE,
      reason: REASON.PERIOD_DIFFERENCE,
      why: 'legacy es acumulado histórico sin ventana; canónico usa periodo explícito.' },

    { key: 'activeReaders', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_LEGACY,
      reason: REASON.METRIC_NOT_COMPARABLE, why: 'no existe en el shape legacy.' },

    // ── backbone (events.db, ventana 30d) — el único terreno común ─────────
    { key: 'sessions', legacyPath: 'backboneMetrics.sessions',
      comparability: COMPARABILITY.COMPARABLE_WITH_NORMALIZATION,
      reason: REASON.SESSION_RECONSTRUCTION_DIFFERENCE,
      requiresWindowDays: 30,
      why: 'ambos leen events.db en 30d, pero reconstruyen sesión de forma distinta: '
         + 'legacy agrupa por sessionId, canónico por ventana de inactividad.' },

    { key: 'distinctContents', legacyPath: 'backboneMetrics.distinctContents',
      comparability: COMPARABILITY.COMPARABLE_WITH_NORMALIZATION,
      reason: REASON.UNATTRIBUTED_EVENTS_EXCLUDED,
      requiresWindowDays: 30,
      why: 'el canónico excluye eventos no atribuibles a una organización.' },

    { key: 'platformTimeMs', legacyPath: 'backboneMetrics.totalElapsedMs',
      comparability: COMPARABILITY.SEMANTICALLY_UNSAFE,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: '`elapsed_ms` es ACUMULADO por sesión: sumarlo infla el total. '
         + 'Documentado en el contrato canónico de métricas.' },

    // ── prohibidas explícitamente ──────────────────────────────────────────
    { key: 'readingTimeMs', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_CANONICAL,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: 'el contrato canónico lo declara NOT_DEFINED; no se publica ni se compara.' },

    { key: 'engagementRate', legacyPath: 'summary.engagementRate',
      comparability: COMPARABILITY.SEMANTICALLY_UNSAFE,
      reason: REASON.NO_DATA_SEMANTICS,
      why: 'legacy devuelve 0 cuando studentCount es 0: un cero que significa '
         + '"sin datos". El canónico lo distingue con NO_DATA.' },

    { key: 'readingLevels', legacyPath: 'readingLevels',
      comparability: COMPARABILITY.SEMANTICALLY_UNSAFE,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: 'indicador evaluativo; el plan maestro prohíbe tratarlo como métrica de seguimiento.' },

    { key: 'icdli', legacyPath: 'icdli',
      comparability: COMPARABILITY.SEMANTICALLY_UNSAFE,
      reason: REASON.METRIC_NOT_COMPARABLE, why: 'índice compuesto sin definición canónica.' },

    { key: 'alerts', legacyPath: 'alerts',
      comparability: COMPARABILITY.SEMANTICALLY_UNSAFE,
      reason: REASON.METRIC_NOT_COMPARABLE, why: 'inferencia prescriptiva, no dato observado.' },

    { key: 'coverage', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_LEGACY,
      reason: REASON.METRIC_NOT_COMPARABLE, why: 'concepto canónico.' },

    { key: 'measurementStatus', legacyPath: null,
      comparability: COMPARABILITY.NOT_AVAILABLE_IN_LEGACY,
      reason: REASON.METRIC_NOT_COMPARABLE,
      why: 'MEASURED/NO_ACTIVITY/NO_DATA no tienen representación en el shape legacy.' },

    { key: 'groups', legacyPath: 'summary.courseCount',
      comparability: COMPARABILITY.EXPECTED_CONTRACT_DIFFERENCE,
      reason: REASON.LEGACY_TEXT_JOIN,
      why: 'legacy agrupa por texto `school`; canónico por `organizationId`.' },

    { key: 'organizations', legacyPath: 'schools',
      comparability: COMPARABILITY.EXPECTED_CONTRACT_DIFFERENCE,
      reason: REASON.LEGACY_TEXT_JOIN,
      why: 'legacy lista nombres derivados de grupos; canónico lista el registro institucional.' },
]);

/** Métricas que el comparador puede evaluar numéricamente. */
export const COMPARABLE_KEYS = Object.freeze(
    METRIC_MATRIX
        .filter(m => m.comparability === COMPARABILITY.COMPARABLE_EXACT
                  || m.comparability === COMPARABILITY.COMPARABLE_WITH_NORMALIZATION)
        .map(m => m.key),
);

export const matrixEntry = (key) => METRIC_MATRIX.find(m => m.key === key) ?? null;

/**
 * ¿Los periodos de ambos motores son equivalentes para esta métrica?
 * Sin equivalencia demostrable NO se calcula delta: se registra
 * PERIOD_NOT_COMPARABLE y no se emite alerta de divergencia.
 *
 * @returns {{comparable: boolean, reason: string|null, windowDays: number|null}}
 */
export function periodsAreComparable({ routeKind, metricKey, canonicalPeriod }) {
    const contract = ROUTE_CONTRACTS[routeKind];
    if (!contract) return { comparable: false, reason: REASON.UNKNOWN_DIFFERENCE, windowDays: null };

    const entry = matrixEntry(metricKey);
    if (!entry) return { comparable: false, reason: REASON.METRIC_NOT_COMPARABLE, windowDays: null };
    if (!COMPARABLE_KEYS.includes(metricKey)) {
        return { comparable: false, reason: entry.reason, windowDays: null };
    }

    // Las únicas métricas comparables viven en el bloque backbone, con ventana fija.
    const aug = contract.backboneAugment;
    if (!aug || aug.periodKind !== PERIOD_KIND.FIXED_WINDOW) {
        return { comparable: false, reason: REASON.PERIOD_DIFFERENCE, windowDays: null };
    }
    const need = entry.requiresWindowDays ?? aug.windowDays;
    if (aug.windowDays !== need) {
        return { comparable: false, reason: REASON.PERIOD_DIFFERENCE, windowDays: null };
    }
    // El canónico debe haberse pedido con la MISMA ventana.
    if (!canonicalPeriod || canonicalPeriod.days !== need) {
        return { comparable: false, reason: REASON.PERIOD_DIFFERENCE, windowDays: need };
    }
    return { comparable: true, reason: null, windowDays: need };
}

/** Severidad a partir de la razón y de la magnitud relativa. */
export function severityFor({ reason, relativeDelta }) {
    if (reason === REASON.CANONICAL_SOURCE_ERROR
        || reason === REASON.CANONICAL_SHAPE_INVALID
        || reason === REASON.LEGACY_SHAPE_INVALID) return SEVERITY.ENGINE_ERROR;

    const expected = new Set([
        REASON.POPULATION_CONTRACT_DIFFERENCE, REASON.LEGACY_TEXT_JOIN,
        REASON.LEGACY_SOURCE_DIFFERENCE, REASON.PERIOD_DIFFERENCE,
        REASON.NO_DATA_SEMANTICS, REASON.METRIC_NOT_COMPARABLE,
        REASON.UNATTRIBUTED_EVENTS_EXCLUDED,
    ]);
    if (expected.has(reason)) return SEVERITY.EXPECTED;
    if (reason === REASON.SESSION_RECONSTRUCTION_DIFFERENCE) {
        return (relativeDelta != null && relativeDelta > 0.25) ? SEVERITY.REVIEW : SEVERITY.EXPECTED;
    }
    if (reason === REASON.UNKNOWN_DIFFERENCE) {
        return (relativeDelta != null && relativeDelta > 0.10) ? SEVERITY.ALERT : SEVERITY.REVIEW;
    }
    return SEVERITY.REVIEW;
}
