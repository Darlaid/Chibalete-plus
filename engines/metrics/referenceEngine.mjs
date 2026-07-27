/**
 * referenceEngine.mjs — CHP-METRICS-CONTRACT-01A.
 *
 * Motor de referencia READ-ONLY de las métricas canónicas. No abre archivos, no
 * escribe nada, no conoce rutas productivas: recibe una **abstracción** de
 * eventos y los padrones como entradas. Determinístico: ningún reloj propio,
 * ningún orden dependiente de inserción.
 *
 * Su papel es ser la verdad de contraste — lo que las métricas DEBERÍAN valer —
 * para comparar contra lo que hoy devuelven las APIs. No sustituye a nadie
 * todavía.
 *
 * Reglas vinculantes que implementa:
 *   · `organizationId` registrado es la clave institucional; nunca el nombre.
 *   · Los grupos históricos y sintéticos quedan fuera de toda métrica institucional.
 *   · Cero solo significa cero medido: la ausencia de datos NO es 0.
 *   · Los eventos no atribuibles se conservan y se reportan en buckets, jamás
 *     se eliminan ni se reparten.
 *   · Una métrica sin contrato aprobado se emite como NOT_DEFINED, no se estima.
 */
import {
    classifyEvent, EVENT_CLASS, isReadingMode,
    reconstructSessions,
} from './eventContract.mjs';

// ── Estados de medición ─────────────────────────────────────────────────────

export const MEASUREMENT_STATUS = Object.freeze({
    MEASURED:          'MEASURED',           // hay datos y el valor es real
    NO_ACTIVITY:       'NO_ACTIVITY',        // población conocida, actividad medida = 0
    NO_DATA:           'NO_DATA',            // no hay población o no hay medición posible
    NOT_MATERIALIZED:  'NOT_MATERIALIZED',   // depende de una proyección aún no construida
    UNATTRIBUTED:      'UNATTRIBUTED',       // hay actividad, pero no es atribuible a este scope
    NOT_DEFINED:       'NOT_DEFINED',        // el contrato de la métrica no está aprobado
    ERROR:             'ERROR',              // fallo real; jamás se degrada a 0
});

/**
 * Constructor único de resultados de métrica. Impide por construcción el
 * antipatrón `value: 0` sin medición: si no está MEASURED/NO_ACTIVITY, `value`
 * es null.
 */
export function metric({ value = null, status, coverage = null, reason = null, period = null }) {
    const measured = status === MEASUREMENT_STATUS.MEASURED
                  || status === MEASUREMENT_STATUS.NO_ACTIVITY;
    return Object.freeze({
        value: measured ? value : null,
        measured,
        coverage,          // {population, represented, ratio} o null
        status,
        reason,
        period,            // {fromTs, toTs} o null
    });
}

const arr = (x) => (Array.isArray(x) ? x : []);
const coverageOf = (population, represented) => ({
    population, represented,
    ratio: population > 0 ? Math.round((represented / population) * 10000) / 10000 : null,
});

// ── Buckets de eventos no atribuibles ───────────────────────────────────────

export const UNATTRIBUTED_BUCKET = Object.freeze({
    UNATTRIBUTED_IDENTITY:     'UNATTRIBUTED_IDENTITY',
    UNATTRIBUTED_GROUP:        'UNATTRIBUTED_GROUP',
    UNATTRIBUTED_ORGANIZATION: 'UNATTRIBUTED_ORGANIZATION',
    HISTORICAL_SCOPE:          'HISTORICAL_SCOPE',
    SYNTHETIC_SCOPE:           'SYNTHETIC_SCOPE',
    UNKNOWN_EVENT_TYPE:        'UNKNOWN_EVENT_TYPE',
});

// ── Construcción del índice institucional ───────────────────────────────────

/**
 * @param {object} input
 * @param {object[]} input.users      padrón canónico
 * @param {object[]} input.groups     grupos
 * @param {object[]} input.schools    registro institucional
 * @param {function} input.classifyGroup  clasificador inyectado (organizationScope)
 */
export function buildIndex({ users, groups, schools, classifyGroup }) {
    if (typeof classifyGroup !== 'function') {
        throw new TypeError('referenceEngine: classifyGroup es obligatorio (inyección explícita)');
    }
    const usersById = new Map(arr(users).filter(u => u?.id).map(u => [u.id, u]));
    const registeredOrgIds = new Set(arr(schools).filter(s => s?.id).map(s => String(s.id).trim()));
    const ctx = { registeredOrgIds, usersById };

    const groupClass = new Map();
    const orgOfGroup = new Map();
    for (const g of arr(groups)) {
        if (!g?.id) continue;
        const c = classifyGroup(g, ctx);
        groupClass.set(g.id, c.class);
        if (c.class === 'ACTIVE_REAL' && c.organizationId) orgOfGroup.set(g.id, c.organizationId);
    }

    // userId → groupIds (canales explícitos del grupo + user.groupIds). Sin
    // fallback por nombre de colegio: eso era atribución textual.
    const groupsOfUser = new Map();
    const link = (uid, gid) => {
        if (!groupsOfUser.has(uid)) groupsOfUser.set(uid, new Set());
        groupsOfUser.get(uid).add(gid);
    };
    for (const g of arr(groups)) {
        if (!g?.id) continue;
        for (const uid of new Set([...arr(g.memberIds), ...arr(g.studentIds)])) link(uid, g.id);
    }
    for (const u of arr(users)) {
        if (!u?.id) continue;
        for (const gid of arr(u.groupIds)) link(u.id, gid);
    }

    const orgOfUser = new Map();
    for (const [uid, gids] of groupsOfUser) {
        for (const gid of gids) {
            const org = orgOfGroup.get(gid);
            if (org) { orgOfUser.set(uid, org); break; }
        }
    }

    return { usersById, registeredOrgIds, groupClass, orgOfGroup, groupsOfUser, orgOfUser, ctx };
}

// ── Poblaciones institucionales (las cinco, separadas) ──────────────────────

export function populations({ users, groups, schools, index, eventUserIds = new Set() }) {
    const registered = arr(schools).filter(s => s?.id).map(s => String(s.id).trim());
    const withActiveGroups = new Set([...index.orgOfGroup.values()]);

    const readersByOrg = new Map();
    for (const u of arr(users)) {
        if (!u?.id) continue;
        const org = index.orgOfUser.get(u.id);
        if (!org) continue;
        if (!readersByOrg.has(org)) readersByOrg.set(org, new Set());
        readersByOrg.get(org).add(u.id);
    }
    const withReaders = new Set([...readersByOrg.keys()].filter(o => readersByOrg.get(o).size > 0));
    const withEventUsers = new Set([...readersByOrg.entries()]
        .filter(([, set]) => [...set].some(id => eventUserIds.has(id)))
        .map(([org]) => org));

    return {
        registeredOrganizations:        registered,
        organizationsWithActiveGroups:  [...withActiveGroups].sort(),
        organizationsWithReaders:       [...withReaders].sort(),
        organizationsWithEventReaders:  [...withEventUsers].sort(),
        // La quinta categoría (con actividad EN EL PERIODO) la calcula
        // computeOrganization, porque depende del periodo solicitado.
    };
}

// ── Clasificación de cada evento ────────────────────────────────────────────

/**
 * Atribuye un evento y, si no puede, dice exactamente por qué. Nunca lo tira.
 * @returns {{attributed:boolean, organizationId:string|null, bucket:string|null}}
 */
export function attributeEvent(event, index) {
    const uid = event?.userId;
    if (!uid || !index.usersById.has(uid)) {
        return { attributed: false, organizationId: null, bucket: UNATTRIBUTED_BUCKET.UNATTRIBUTED_IDENTITY };
    }
    const user = index.usersById.get(uid);
    if (user._loadtest_marker) {
        return { attributed: false, organizationId: null, bucket: UNATTRIBUTED_BUCKET.SYNTHETIC_SCOPE };
    }
    const gids = index.groupsOfUser.get(uid);
    if (!gids || gids.size === 0) {
        return { attributed: false, organizationId: null, bucket: UNATTRIBUTED_BUCKET.UNATTRIBUTED_GROUP };
    }
    const org = index.orgOfUser.get(uid);
    if (!org) {
        const classes = [...gids].map(g => index.groupClass.get(g));
        const bucket = classes.includes('SYNTHETIC_OUT_OF_SCOPE')
            ? UNATTRIBUTED_BUCKET.SYNTHETIC_SCOPE
            : classes.includes('HISTORICAL_OUT_OF_SCOPE')
                ? UNATTRIBUTED_BUCKET.HISTORICAL_SCOPE
                : UNATTRIBUTED_BUCKET.UNATTRIBUTED_ORGANIZATION;
        return { attributed: false, organizationId: null, bucket };
    }
    if (classifyEvent(event.event).class === EVENT_CLASS.UNKNOWN_REVIEW_REQUIRED) {
        // La identidad SÍ se atribuye; lo desconocido es la semántica del evento.
        return { attributed: true, organizationId: org, bucket: UNATTRIBUTED_BUCKET.UNKNOWN_EVENT_TYPE };
    }
    return { attributed: true, organizationId: org, bucket: null };
}

// ── Métricas ────────────────────────────────────────────────────────────────

const inPeriod = (e, period) => !period
    || (Number.isFinite(e.serverTs) && e.serverTs >= period.fromTs && e.serverTs <= period.toTs);

/**
 * Métricas de una organización. `events` es un iterable de eventos ya
 * normalizados: {eventId, event, mode, userId, contentId, sessionId, serverTs,
 * elapsedMs, progressFraction}.
 */
export function computeOrganization({ organizationId, events, index, users, period = null,
                                      idleMs = 15 * 60 * 1000, capMs }) {
    if (!index.registeredOrgIds.has(organizationId)) {
        return {
            organizationId,
            registeredReaders: metric({ status: MEASUREMENT_STATUS.NO_DATA, reason: 'ORGANIZATION_NOT_REGISTERED' }),
        };
    }

    const readers = arr(users).filter(u => u?.id && index.orgOfUser.get(u.id) === organizationId
                                        && !u._loadtest_marker);
    const readerIds = new Set(readers.map(u => u.id));
    const withGroup = readers.filter(u => (index.groupsOfUser.get(u.id)?.size ?? 0) > 0).length;

    const byUser = new Map();
    for (const e of events) {
        if (!readerIds.has(e.userId)) continue;
        if (!inPeriod(e, period)) continue;
        if (!byUser.has(e.userId)) byUser.set(e.userId, []);
        byUser.get(e.userId).push(e);
    }

    const population = readers.length;
    const represented = byUser.size;
    const cov = coverageOf(population, represented);

    if (population === 0) {
        return {
            organizationId,
            registeredReaders: metric({ value: 0, status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
            readersWithGroup:  metric({ value: 0, status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
            activeReaders:     metric({ status: MEASUREMENT_STATUS.NO_DATA, reason: 'NO_POPULATION', coverage: cov, period }),
            sessions:          metric({ status: MEASUREMENT_STATUS.NO_DATA, reason: 'NO_POPULATION', coverage: cov, period }),
            platformTimeMs:    metric({ status: MEASUREMENT_STATUS.NO_DATA, reason: 'NO_POPULATION', coverage: cov, period }),
            readingTimeMs:     metric({ status: MEASUREMENT_STATUS.NOT_DEFINED, reason: 'READING_TIME_CONTRACT_PENDING', coverage: cov, period }),
            contentsOpened:    metric({ status: MEASUREMENT_STATUS.NO_DATA, reason: 'NO_POPULATION', coverage: cov, period }),
        };
    }

    // Sin ningún evento: la población existe y la actividad medida es CERO.
    // Esto sí es un cero legítimo, y se distingue de NO_DATA.
    if (represented === 0) {
        const noAct = (extra = {}) => metric({ value: 0, status: MEASUREMENT_STATUS.NO_ACTIVITY,
                                               coverage: cov, period, ...extra });
        return {
            organizationId,
            registeredReaders: metric({ value: population, status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
            readersWithGroup:  metric({ value: withGroup,  status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
            activeReaders:     noAct(),
            sessions:          noAct(),
            platformTimeMs:    noAct(),
            readingTimeMs:     metric({ status: MEASUREMENT_STATUS.NOT_DEFINED, reason: 'READING_TIME_CONTRACT_PENDING', coverage: cov, period }),
            contentsOpened:    noAct(),
        };
    }

    let sessionCount = 0, platformMs = 0, cappedSessions = 0;
    const contents = new Set();
    for (const [, evs] of [...byUser.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const sessions = reconstructSessions(evs, capMs === undefined ? { idleMs } : { idleMs, capMs });
        sessionCount += sessions.length;
        for (const s of sessions) {
            if (Number.isFinite(s.durationMs)) platformMs += s.durationMs;
            if (s.durationCapped) cappedSessions++;
        }
        for (const e of evs) {
            if (e.contentId && isReadingMode(classifyEvent(e.event).mode)) contents.add(e.contentId);
        }
    }

    return {
        organizationId,
        registeredReaders: metric({ value: population,  status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
        readersWithGroup:  metric({ value: withGroup,   status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
        activeReaders:     metric({ value: represented, status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
        sessions:          metric({ value: sessionCount, status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period,
                                    reason: `INACTIVITY_WINDOW_${Math.round(idleMs / 60000)}MIN` }),
        platformTimeMs:    metric({ value: platformMs,  status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period,
                                    reason: cappedSessions > 0 ? `CAPPED_SESSIONS_${cappedSessions}` : null }),
        // El tiempo de LECTURA (frente a tiempo en plataforma) exige separar
        // lectura efectiva de sesión abierta. Sin contrato aprobado no se estima.
        readingTimeMs:     metric({ status: MEASUREMENT_STATUS.NOT_DEFINED, reason: 'READING_TIME_CONTRACT_PENDING', coverage: cov, period }),
        contentsOpened:    metric({ value: contents.size, status: MEASUREMENT_STATUS.MEASURED, coverage: cov, period }),
    };
}

/** Recuento de no atribuibles por bucket. Se preserva siempre, nunca se reparte. */
export function unattributedReport({ events, index, period = null }) {
    const buckets = Object.fromEntries(Object.values(UNATTRIBUTED_BUCKET).map(b => [b, { events: 0, users: new Set() }]));
    let attributed = 0, total = 0;
    for (const e of events) {
        if (!inPeriod(e, period)) continue;
        total++;
        const a = attributeEvent(e, index);
        if (a.attributed && !a.bucket) { attributed++; continue; }
        if (a.attributed) attributed++;
        if (a.bucket) { buckets[a.bucket].events++; if (e.userId) buckets[a.bucket].users.add(e.userId); }
    }
    return {
        totalEvents: total,
        attributedEvents: attributed,
        buckets: Object.fromEntries(Object.entries(buckets)
            .map(([k, v]) => [k, { events: v.events, distinctUsers: v.users.size }])),
        period,
    };
}

/** Resumen determinístico y sanitizado: solo agregados, jamás identidades. */
export function summarize({ users, groups, schools, events, classifyGroup, period = null,
                            idleMs = 15 * 60 * 1000, capMs }) {
    const evs = arr(events);
    const index = buildIndex({ users, groups, schools, classifyGroup });
    const eventUserIds = new Set(evs.map(e => e?.userId).filter(Boolean));
    const pops = populations({ users, groups, schools, index, eventUserIds });
    const orgs = [...index.registeredOrgIds].sort()
        .map(organizationId => computeOrganization({ organizationId, events: evs, index, users, period, idleMs, capMs }));
    return {
        contractVersion: 1,
        period,
        sessionStrategy: `INACTIVITY_WINDOW_${Math.round(idleMs / 60000)}MIN`,
        populations: pops,
        organizations: orgs,
        unattributed: unattributedReport({ events: evs, index, period }),
    };
}
