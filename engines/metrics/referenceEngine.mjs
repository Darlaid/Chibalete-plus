/**
 * referenceEngine.mjs — CHP-METRICS-CONTRACT-01B (contrato v2, D1–D10 aprobadas).
 *
 * Motor de referencia READ-ONLY de las métricas canónicas. No abre archivos, no
 * escribe nada, no conoce rutas productivas: recibe una **abstracción** de
 * eventos y los padrones como entradas. Determinístico: ningún reloj propio,
 * ningún orden dependiente de inserción.
 *
 * ── Corrección de semántica poblacional (01B) ───────────────────────────────
 *
 * La v1 llamaba «registrados» a la cohorte filtrada por grupos, lo que hacía
 * desaparecer gente real: FilBo aparecía con 44 en vez de 46, y Externado con 0
 * en vez de 2. Son poblaciones DISTINTAS y ahora se reportan por separado:
 *
 *   registeredUsers     pertenecen a la organización — por `organizationId`
 *                       declarado O por pertenencia a uno de sus grupos.
 *                       NO depende de que existan eventos.
 *   registeredReaders   registeredUsers con rol lector.
 *   eligibleReaders     registeredReaders en ≥1 grupo ACTIVE_REAL de esa misma
 *                       organización. Es el denominador de cobertura.
 *   usersWithActivity   registeredUsers con ≥1 evento atribuible NO sistémico.
 *   activeReaders       eligibleReaders con ≥1 evento READING_ACTIVITY (D4).
 *
 * `usersWithActivity` y `activeReaders` son métricas separadas a propósito
 * (D4): estar presente no es leer.
 */
import {
    classifyEvent, EVENT_CLASS, isReadingMode,
    reconstructSessions, IDLE_MS, SESSION_CAP_MS,
} from './eventContract.mjs';

export const CONTRACT_VERSION = 2;

// ── Estados de medición ─────────────────────────────────────────────────────

export const MEASUREMENT_STATUS = Object.freeze({
    MEASURED:          'MEASURED',
    NO_ACTIVITY:       'NO_ACTIVITY',
    NO_DATA:           'NO_DATA',
    NOT_MATERIALIZED:  'NOT_MATERIALIZED',
    UNATTRIBUTED:      'UNATTRIBUTED',
    NOT_DEFINED:       'NOT_DEFINED',
    ERROR:             'ERROR',
});

/** Etiquetas visibles aprobadas en D10. La UI no debe inventar las suyas. */
export const STATUS_LABEL = Object.freeze({
    [MEASUREMENT_STATUS.NO_ACTIVITY]:      'Sin actividad registrada',
    [MEASUREMENT_STATUS.NO_DATA]:          'Sin datos suficientes',
    [MEASUREMENT_STATUS.NOT_MATERIALIZED]: 'Pendiente de cálculo',
    [MEASUREMENT_STATUS.NOT_DEFINED]:      'Métrica aún no disponible',
    [MEASUREMENT_STATUS.UNATTRIBUTED]:     'Actividad no atribuible',
    [MEASUREMENT_STATUS.ERROR]:            'Error al calcular',
});

/** Solo NO_ACTIVITY admite `value: 0` con `measured: true`. */
const VALUE_ALLOWED = new Set([MEASUREMENT_STATUS.MEASURED, MEASUREMENT_STATUS.NO_ACTIVITY]);

/**
 * Sobre estructural de toda métrica (Fase 3). Impone por construcción que
 * NOT_DEFINED / NO_DATA / NOT_MATERIALIZED / ERROR devuelvan `value: null`.
 */
export function metricEnvelope({ metric, value = null, status, reason = null, period = null,
                                 population = null, coverage = null, quality = null }) {
    const measured = VALUE_ALLOWED.has(status);
    return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        metric,
        value: measured ? value : null,
        measured,
        status,
        label: STATUS_LABEL[status] ?? null,
        reason,
        period,
        population,
        coverage,
        quality,
    });
}

const arr = (x) => (Array.isArray(x) ? x : []);

/** Periodo por defecto aprobado en D7: últimos 30 días, siempre declarado. */
export function defaultPeriod(nowTs, days = 30) {
    if (!Number.isFinite(nowTs)) throw new TypeError('defaultPeriod: nowTs debe inyectarse (motor sin reloj)');
    return { fromTs: nowTs - days * 24 * 60 * 60 * 1000, toTs: nowTs, days };
}

// ── Buckets de eventos no atribuibles (D8) ──────────────────────────────────

export const UNATTRIBUTED_BUCKET = Object.freeze({
    UNATTRIBUTED_IDENTITY:     'UNATTRIBUTED_IDENTITY',
    UNATTRIBUTED_GROUP:        'UNATTRIBUTED_GROUP',
    UNATTRIBUTED_ORGANIZATION: 'UNATTRIBUTED_ORGANIZATION',
    HISTORICAL_SCOPE:          'HISTORICAL_SCOPE',
    SYNTHETIC_SCOPE:           'SYNTHETIC_SCOPE',
    UNKNOWN_EVENT_TYPE:        'UNKNOWN_EVENT_TYPE',
});

// ── Roles ───────────────────────────────────────────────────────────────────

function rolesOf(user) {
    const out = new Set();
    const push = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase()); };
    arr(user?.roles).forEach(push);
    push(user?.role);
    push(user?.rol);
    return out;
}
export const isReader = (user) => rolesOf(user).has('lector');

// ── Índice ──────────────────────────────────────────────────────────────────

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

    // userId → groupIds, solo por canales explícitos. Sin fallback por nombre.
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

    // Organización del usuario por pertenencia a grupo ACTIVE_REAL.
    const orgsViaGroups = new Map();
    for (const [uid, gids] of groupsOfUser) {
        for (const gid of gids) {
            const org = orgOfGroup.get(gid);
            if (!org) continue;
            if (!orgsViaGroups.has(uid)) orgsViaGroups.set(uid, new Set());
            orgsViaGroups.get(uid).add(org);
        }
    }
    // Organización declarada en el propio usuario (solo si está registrada).
    const orgDeclared = new Map();
    for (const u of arr(users)) {
        const declared = typeof u?.organizationId === 'string' ? u.organizationId.trim() : '';
        if (declared && registeredOrgIds.has(declared)) orgDeclared.set(u.id, declared);
    }

    return { usersById, registeredOrgIds, groupClass, orgOfGroup, groupsOfUser, orgsViaGroups, orgDeclared, ctx };
}

/** Organización de atribución de un usuario: declarada, o vía grupo activo. */
export function organizationOfUser(userId, index) {
    const declared = index.orgDeclared.get(userId);
    if (declared) return declared;
    const viaGroups = index.orgsViaGroups.get(userId);
    return viaGroups && viaGroups.size > 0 ? [...viaGroups].sort()[0] : null;
}

// ── Poblaciones (Fase 1) ────────────────────────────────────────────────────

export function organizationPopulation({ organizationId, users, index }) {
    const registeredUsers = [];
    for (const u of arr(users)) {
        if (!u?.id || u._loadtest_marker) continue;
        const declared = index.orgDeclared.get(u.id) === organizationId;
        const viaGroup = index.orgsViaGroups.get(u.id)?.has(organizationId) ?? false;
        if (declared || viaGroup) registeredUsers.push(u);
    }
    const registeredReaders = registeredUsers.filter(isReader);
    const inActiveGroup = (u) => index.orgsViaGroups.get(u.id)?.has(organizationId) ?? false;
    const eligibleReaders   = registeredReaders.filter(inActiveGroup);
    const readersWithoutGroup = registeredReaders.filter(u => !inActiveGroup(u));
    return {
        registeredUsers, registeredReaders, eligibleReaders, readersWithoutGroup,
        ids: {
            registeredUsers:   new Set(registeredUsers.map(u => u.id)),
            registeredReaders: new Set(registeredReaders.map(u => u.id)),
            eligibleReaders:   new Set(eligibleReaders.map(u => u.id)),
        },
    };
}

/** Las cinco listas institucionales, separadas (no una sola). */
export function populations({ users, schools, index, eventUserIds = new Set() }) {
    const registered = arr(schools).filter(s => s?.id).map(s => String(s.id).trim()).sort();
    const withActiveGroups = new Set([...index.orgOfGroup.values()]);
    const withReaders = [], withEventReaders = [];
    for (const org of registered) {
        const p = organizationPopulation({ organizationId: org, users, index });
        if (p.registeredReaders.length > 0) withReaders.push(org);
        if (p.registeredReaders.some(u => eventUserIds.has(u.id))) withEventReaders.push(org);
    }
    return {
        registeredOrganizations:       registered,
        organizationsWithActiveGroups: [...withActiveGroups].sort(),
        organizationsWithReaders:      withReaders,
        organizationsWithEventReaders: withEventReaders,
    };
}

// ── Atribución de eventos (D8) ──────────────────────────────────────────────

export function attributeEvent(event, index) {
    const uid = event?.userId;
    if (!uid || !index.usersById.has(uid)) {
        return { attributed: false, organizationId: null, bucket: UNATTRIBUTED_BUCKET.UNATTRIBUTED_IDENTITY };
    }
    if (index.usersById.get(uid)._loadtest_marker) {
        return { attributed: false, organizationId: null, bucket: UNATTRIBUTED_BUCKET.SYNTHETIC_SCOPE };
    }
    const gids = index.groupsOfUser.get(uid);
    const org = organizationOfUser(uid, index);
    if (!org) {
        if (!gids || gids.size === 0) {
            return { attributed: false, organizationId: null, bucket: UNATTRIBUTED_BUCKET.UNATTRIBUTED_GROUP };
        }
        const classes = [...gids].map(g => index.groupClass.get(g));
        const bucket = classes.includes('SYNTHETIC_OUT_OF_SCOPE')
            ? UNATTRIBUTED_BUCKET.SYNTHETIC_SCOPE
            : classes.includes('HISTORICAL_OUT_OF_SCOPE')
                ? UNATTRIBUTED_BUCKET.HISTORICAL_SCOPE
                : UNATTRIBUTED_BUCKET.UNATTRIBUTED_ORGANIZATION;
        return { attributed: false, organizationId: null, bucket };
    }
    if (classifyEvent(event.event).class === EVENT_CLASS.UNKNOWN_REVIEW_REQUIRED) {
        return { attributed: true, organizationId: org, bucket: UNATTRIBUTED_BUCKET.UNKNOWN_EVENT_TYPE };
    }
    return { attributed: true, organizationId: org, bucket: null };
}

// ── Métricas ────────────────────────────────────────────────────────────────

const inPeriod = (e, period) => !period
    || (Number.isFinite(e.serverTs) && e.serverTs >= period.fromTs && e.serverTs <= period.toTs);

const isSystemEvent  = (e) => classifyEvent(e.event).class === EVENT_CLASS.SYSTEM_EVENT;
const isReadingEvent = (e) => classifyEvent(e.event).class === EVENT_CLASS.READING_ACTIVITY;

/**
 * Métricas de una organización, cada una con su sobre completo.
 * @returns {{organizationId:string, population:object, metrics:object}}
 */
export function computeOrganization({ organizationId, events, index, users, period = null,
                                      idleMs = IDLE_MS, capMs = SESSION_CAP_MS }) {
    const emit = (metric, o) => metricEnvelope({ metric, period, ...o });

    if (!index.registeredOrgIds.has(organizationId)) {
        return {
            organizationId,
            population: null,
            metrics: {
                registeredUsers: emit('registeredUsers', {
                    status: MEASUREMENT_STATUS.NO_DATA, reason: 'ORGANIZATION_NOT_REGISTERED' }),
            },
        };
    }

    const pop = organizationPopulation({ organizationId, users, index });

    // Eventos del periodo, por usuario registrado en la organización.
    const byUser = new Map();
    let unattributedForOrg = 0, unknownEvents = 0;
    for (const e of events) {
        if (!inPeriod(e, period)) continue;
        if (!pop.ids.registeredUsers.has(e.userId)) continue;
        const a = attributeEvent(e, index);
        if (!a.attributed || a.organizationId !== organizationId) { unattributedForOrg++; continue; }
        if (a.bucket === UNATTRIBUTED_BUCKET.UNKNOWN_EVENT_TYPE) unknownEvents++;
        if (!byUser.has(e.userId)) byUser.set(e.userId, []);
        byUser.get(e.userId).push(e);
    }

    const usersWithActivityIds = new Set();
    const activeReaderIds = new Set();
    for (const [uid, evs] of byUser) {
        if (evs.some(e => !isSystemEvent(e))) usersWithActivityIds.add(uid);
        if (pop.ids.eligibleReaders.has(uid) && evs.some(isReadingEvent)) activeReaderIds.add(uid);
    }

    const populationBlock = {
        registeredUsers:   pop.registeredUsers.length,
        registeredReaders: pop.registeredReaders.length,
        eligibleReaders:   pop.eligibleReaders.length,
        usersWithActivity: usersWithActivityIds.size,
        activeReaders:     activeReaderIds.size,
        readersWithoutGroup: pop.readersWithoutGroup.length,
        readersWithEvents: [...pop.ids.registeredReaders].filter(id => byUser.has(id)).length,
    };

    // Sesiones y tiempo, solo sobre lectores elegibles.
    let sessionCount = 0, platformMs = 0, cappedSessions = 0;
    const contents = new Set();
    for (const uid of [...pop.ids.eligibleReaders].sort()) {
        const evs = byUser.get(uid);
        if (!evs) continue;
        const sessions = reconstructSessions(evs, { idleMs, capMs });
        sessionCount += sessions.length;
        for (const s of sessions) {
            if (Number.isFinite(s.durationMs)) platformMs += s.durationMs;
            if (s.durationCapped) cappedSessions++;
        }
        for (const e of evs) {
            if (e.contentId && isReadingMode(classifyEvent(e.event).mode)) contents.add(e.contentId);
        }
    }

    const coverage = {
        numerator: activeReaderIds.size,
        denominator: pop.eligibleReaders.length,
        ratio: pop.eligibleReaders.length > 0
            ? Math.round((activeReaderIds.size / pop.eligibleReaders.length) * 10000) / 10000
            : null,
    };
    const quality = { unattributedEvents: unattributedForOrg, unknownEvents, cappedSessions };
    const common = { population: populationBlock, coverage, quality };

    const metrics = {
        // Poblaciones: siempre medidas, jamás dependen de que haya eventos.
        registeredUsers:   emit('registeredUsers',   { value: populationBlock.registeredUsers,   status: MEASUREMENT_STATUS.MEASURED, ...common }),
        registeredReaders: emit('registeredReaders', { value: populationBlock.registeredReaders, status: MEASUREMENT_STATUS.MEASURED, ...common }),
        eligibleReaders:   emit('eligibleReaders',   { value: populationBlock.eligibleReaders,   status: MEASUREMENT_STATUS.MEASURED, ...common }),
        readersWithoutGroup: emit('readersWithoutGroup', { value: populationBlock.readersWithoutGroup, status: MEASUREMENT_STATUS.MEASURED, ...common }),
        // D6: no se estima ni se reetiqueta el tiempo en plataforma.
        readingTimeMs:     emit('readingTimeMs', { status: MEASUREMENT_STATUS.NOT_DEFINED,
                                                   reason: 'READING_TIME_CONTRACT_PENDING', ...common }),
    };

    // Sin lectores elegibles no hay población sobre la que medir lectura.
    if (pop.eligibleReaders.length === 0) {
        const noData = (m) => emit(m, { status: MEASUREMENT_STATUS.NO_DATA, reason: 'NO_ELIGIBLE_READERS', ...common });
        return { organizationId, population: populationBlock, metrics: {
            ...metrics,
            usersWithActivity: emit('usersWithActivity', {
                value: populationBlock.usersWithActivity,
                status: populationBlock.registeredUsers > 0
                    ? (usersWithActivityIds.size > 0 ? MEASUREMENT_STATUS.MEASURED : MEASUREMENT_STATUS.NO_ACTIVITY)
                    : MEASUREMENT_STATUS.NO_DATA,
                reason: populationBlock.registeredUsers > 0 ? null : 'NO_POPULATION', ...common }),
            activeReaders:  noData('activeReaders'),
            entries:        noData('entries'),
            sessions:       noData('sessions'),
            platformTimeMs: noData('platformTimeMs'),
            contentsOpened: noData('contentsOpened'),
        } };
    }

    // Con población elegible: cero actividad es un CERO MEDIDO (D9).
    const hasActivity = activeReaderIds.size > 0;
    const st = hasActivity ? MEASUREMENT_STATUS.MEASURED : MEASUREMENT_STATUS.NO_ACTIVITY;
    const sessionReason = `INACTIVITY_WINDOW_${Math.round(idleMs / 60000)}MIN`;

    return { organizationId, population: populationBlock, metrics: {
        ...metrics,
        usersWithActivity: emit('usersWithActivity', {
            value: populationBlock.usersWithActivity,
            status: usersWithActivityIds.size > 0 ? MEASUREMENT_STATUS.MEASURED : MEASUREMENT_STATUS.NO_ACTIVITY,
            ...common }),
        activeReaders:  emit('activeReaders',  { value: activeReaderIds.size, status: st, ...common }),
        // D1: una entrada es el inicio de una sesión reconstruida.
        entries:        emit('entries',        { value: sessionCount, status: st, reason: sessionReason, ...common }),
        sessions:       emit('sessions',       { value: sessionCount, status: st, reason: sessionReason, ...common }),
        platformTimeMs: emit('platformTimeMs', { value: platformMs,   status: st,
                                                 reason: cappedSessions > 0 ? `CAPPED_SESSIONS_${cappedSessions}` : null,
                                                 ...common }),
        contentsOpened: emit('contentsOpened', { value: contents.size, status: st, ...common }),
    } };
}

/** Recuento de no atribuibles por bucket. Se preserva siempre, nunca se reparte. */
export function unattributedReport({ events, index, period = null }) {
    const buckets = Object.fromEntries(Object.values(UNATTRIBUTED_BUCKET)
        .map(b => [b, { events: 0, users: new Set() }]));
    let attributed = 0, total = 0;
    for (const e of events) {
        if (!inPeriod(e, period)) continue;
        total++;
        const a = attributeEvent(e, index);
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
                            idleMs = IDLE_MS, capMs = SESSION_CAP_MS }) {
    const evs = arr(events);
    const index = buildIndex({ users, groups, schools, classifyGroup });
    const eventUserIds = new Set(evs.map(e => e?.userId).filter(Boolean));
    return {
        contractVersion: CONTRACT_VERSION,
        period,
        sessionStrategy: `INACTIVITY_WINDOW_${Math.round(idleMs / 60000)}MIN`,
        sessionCapMs: capMs,
        populations: populations({ users, schools, index, eventUserIds }),
        organizations: [...index.registeredOrgIds].sort()
            .map(organizationId => computeOrganization({ organizationId, events: evs, index, users, period, idleMs, capMs })),
        unattributed: unattributedReport({ events: evs, index, period }),
    };
}
