/**
 * insightsStateEngine.js — orquestador snapshot → state → notification.
 *
 * Sprint Data Backbone — Fase 6C.
 *
 * Recibe la salida de `computeBackboneInsights` y la persiste en
 * `insightsStore`, manteniendo el estado vivo de cada alerta:
 *
 *   - active        → la condición sigue cumpliéndose.
 *   - resolved      → la alerta ya no aparece en el snapshot actual.
 *   - acknowledged  → un humano confirmó que ya la vio (no silencia).
 *   - dismissed     → silenciada hasta `dismissed_until`.
 *
 * El engine también genera `insight_notifications` con la cola interna
 * (channel='dashboard') según las reglas del Sprint 6C:
 *
 *   1. Insight nuevo y critical → notification 'new_critical'.
 *   2. Warning que empeora con delta > 0.15 (ratio) → 'worsening'.
 *   3. Critical que reaparece tras estar resolved → 'critical_reappears'.
 *   4. Warning que persiste 3 snapshots seguidos → 'persistent_warning'.
 *
 * Reglas de transición:
 *   - dismissed con dismissed_until futuro: se mantiene dismissed aunque
 *     la condición siga cumpliéndose. last_seen sí se actualiza.
 *   - acknowledged: last_seen sigue actualizando, severity actualiza,
 *     pero NO se reactiva salvo que la severidad escale a critical.
 *   - resolved: si la condición vuelve a aparecer, status = active. Si la
 *     reaparición trae severity critical, además se notifica.
 */

import {
    insertSnapshot,
    getStateByKey,
    upsertState,
    markStateResolved,
    listActiveStatesByScope,
    insertNotification,
    hasPendingNotification,
} from './insightsStore.js';
import { ulid } from './ulid.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

function severityRank(s) {
    return SEVERITY_RANK[s] ?? 0;
}

function buildInsightKey(insight, scope) {
    const sid = scope?.id ?? '_';
    const lvl = scope?.level ?? 'global';
    return `${insight.id}::${lvl}::${sid}`;
}

function isRatioMetric(insight) {
    // Heurística: el threshold define la unidad. Si threshold ∈ (0, 1] el
    // value se interpreta como ratio (0..1). Si está fuera, es absoluto.
    const t = insight?.evidence?.threshold;
    return typeof t === 'number' && t > 0 && t <= 1;
}

function safeNum(n) {
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ── Decisor de notification ──────────────────────────────────────────────────
//
// Devuelve null o `{ type, payload }`. Quien llame es responsable de hacer
// dedup vía `hasPendingNotification`.

function decideNotification({ insight, prev, newOccurrences, prevStatus, prevSeverity, isRatio, deltaValue }) {
    const sev = insight.severity;

    // 1. Insight nuevo con severity critical
    if (!prev && sev === 'critical') {
        return { type: 'new_critical' };
    }

    // 3. Critical que reaparece tras estar resolved
    if (prev && prevStatus === 'resolved' && sev === 'critical') {
        return { type: 'critical_reappears' };
    }

    // 2. Warning empeora fuerte (delta > 0.15 cuando value es ratio)
    if (sev === 'warning' && isRatio && typeof deltaValue === 'number' && deltaValue > 0.15) {
        return { type: 'worsening' };
    }

    // 4. Warning con 3 snapshots seguidos exactos (transición 2→3)
    if (sev === 'warning' && newOccurrences === 3) {
        return { type: 'persistent_warning' };
    }

    return null;
}

// ── Procesado de un insight individual ───────────────────────────────────────

function processOneInsight({ insight, scope, ts }) {
    const insightKey = buildInsightKey(insight, scope);
    const prev       = getStateByKey(insightKey);

    const newValue = safeNum(insight.evidence?.value);
    const isRatio  = isRatioMetric(insight);

    // Severidad escalada: si nuevo es critical y previo no era critical,
    // un state acknowledged debe reactivarse.
    const sev          = insight.severity;
    const prevStatus   = prev?.status ?? null;
    const prevSeverity = prev?.severity ?? null;
    const escalated    = severityRank(sev) > severityRank(prevSeverity || 'info')
                         && sev === 'critical';

    // Decidir status nuevo.
    let nextStatus;
    let dismissedUntil   = prev?.dismissed_until ?? null;
    let acknowledgedAt   = prev?.acknowledged_at ?? null;
    let acknowledgedBy   = prev?.acknowledged_by ?? null;

    if (!prev) {
        nextStatus = 'active';
    } else if (prev.dismissed_until && prev.dismissed_until > ts) {
        // Sigue silenciada por el operador.
        nextStatus = 'dismissed';
    } else if (prev.dismissed_until && prev.dismissed_until <= ts) {
        // Expiró el silencio: limpiamos dismissed_until y el state vuelve a vivir.
        dismissedUntil = null;
        nextStatus = 'active';
    } else if (prev.status === 'acknowledged' && !escalated) {
        // Ack se mantiene a menos que escale a critical.
        nextStatus = 'acknowledged';
    } else {
        // Cualquier otra: active. Si estaba resolved y reaparece, se reactiva.
        nextStatus = 'active';
        // Si reactivamos por escalación, limpiamos ack para no quedar en estado raro.
        if (escalated) {
            acknowledgedAt = null;
            acknowledgedBy = null;
        }
    }

    const previousValue   = prev?.last_value ?? null;
    const lastValue       = newValue;
    const deltaValue      = (typeof previousValue === 'number' && typeof lastValue === 'number')
        ? lastValue - previousValue
        : null;
    const occurrences     = (prev?.occurrences ?? 0) + 1;
    const firstSeenAt     = prev?.first_seen_at ?? ts;

    upsertState({
        insightKey,
        scopeLevel:        scope.level,
        scopeId:           scope.id ?? null,
        type:              insight.type,
        severity:          sev,
        title:             insight.title,
        status:            nextStatus,
        firstSeenAt,
        lastSeenAt:        ts,
        lastValue,
        previousValue,
        deltaValue,
        occurrences,
        dismissedUntil,
        acknowledgedAt,
        acknowledgedBy,
        lastPayloadJson:   JSON.stringify(insight),
        updatedAt:         ts,
    });

    // Notifications: solo si el state está active. Si está dismissed o
    // acknowledged, no notificamos — fue silenciado o ya alguien lo vio.
    if (nextStatus !== 'active') {
        return { insightKey, status: nextStatus, occurrences, deltaValue, notification: null };
    }

    const decided = decideNotification({
        insight, prev,
        newOccurrences: occurrences,
        prevStatus,
        prevSeverity,
        isRatio,
        deltaValue,
    });

    let notification = null;
    if (decided && !hasPendingNotification(insightKey, decided.type)) {
        const notificationId = ulid();
        const payload = {
            type:        decided.type,
            insightKey,
            severity:    sev,
            title:       insight.title,
            value:       lastValue,
            deltaValue,
            occurrences,
            createdAt:   ts,
            insight,
        };
        insertNotification({
            notificationId,
            insightKey,
            scopeLevel:    scope.level,
            scopeId:       scope.id ?? null,
            severity:      sev,
            channel:       'dashboard',
            status:        'pending',
            createdAt:     ts,
            sentAt:        null,
            payloadJson:   JSON.stringify(payload),
        });
        notification = { notificationId, type: decided.type };
    }

    return { insightKey, status: nextStatus, occurrences, deltaValue, notification };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Procesa un snapshot completo: persiste, actualiza states, marca
 * resolved los que ya no aparecen, genera notifications.
 *
 * @param {object} input
 * @param {object} input.insights    - shape `computeBackboneInsights`
 *                                     ({ insights:[], severitySummary, ... }).
 * @param {object} input.scope       - { level, id? }.
 * @param {number} input.windowDays  - ventana usada al computar.
 * @param {string} [input.actorId]   - opcional, quién disparó la corrida.
 *
 * @returns {{
 *   snapshotId, generatedAt,
 *   insightsPersisted, statesNew, statesUpdated, statesResolved,
 *   notificationsCreated, stateSummary
 * }}
 */
export function processInsightsSnapshot({ insights, scope, windowDays, actorId } = {}) {
    if (!insights || !Array.isArray(insights.insights)) {
        throw new Error('insights payload required');
    }
    const safeScope = {
        level: scope?.level ?? 'global',
        id:    scope?.id    ?? null,
    };
    const ts = Date.now();
    const snapshotId = ulid();

    // 1. Persistir snapshot.
    insertSnapshot({
        snapshotId,
        scopeLevel:    safeScope.level,
        scopeId:       safeScope.id,
        windowDays:    windowDays ?? 30,
        generatedAt:   typeof insights.generatedAt === 'number' ? insights.generatedAt : ts,
        summaryJson:   JSON.stringify(insights.severitySummary ?? {}),
        insightsJson:  JSON.stringify(insights.insights ?? []),
        createdAt:     ts,
    });

    // 2. Procesar cada insight actual.
    const seenKeys = new Set();
    let statesNew = 0, statesUpdated = 0, notificationsCreated = 0;
    const notifications = [];

    for (const insight of insights.insights) {
        const had = !!getStateByKey(buildInsightKey(insight, safeScope));
        const r = processOneInsight({ insight, scope: safeScope, ts });
        seenKeys.add(r.insightKey);
        if (had) statesUpdated += 1; else statesNew += 1;
        if (r.notification) {
            notificationsCreated += 1;
            notifications.push(r.notification);
        }
    }

    // 3. Marcar resolved a los states activos del scope que no aparecieron.
    let statesResolved = 0;
    const activeStates = listActiveStatesByScope(safeScope.level, safeScope.id);
    for (const s of activeStates) {
        if (!seenKeys.has(s.insight_key)) {
            markStateResolved(s.insight_key, ts);
            statesResolved += 1;
        }
    }

    // 4. Resumen de states post-procesamiento (calculado a mano para
    // evitar otra query — los counts de active/critical/warning ya los
    // sabemos a partir del snapshot procesado).
    const stateSummary = {
        new:       statesNew,
        updated:   statesUpdated,
        resolved:  statesResolved,
        total:     statesNew + statesUpdated,
    };

    return {
        snapshotId,
        generatedAt: ts,
        insightsPersisted:    insights.insights.length,
        statesNew,
        statesUpdated,
        statesResolved,
        notificationsCreated,
        notifications,
        stateSummary,
        actorId: actorId ?? null,
    };
}
