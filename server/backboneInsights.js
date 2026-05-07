/**
 * backboneInsights.js — capa interpretativa sobre metrics + funnels.
 *
 * Sprint Data Backbone — Fase 6B.
 *
 * Convierte los agregados del backbone (backboneMetrics + backboneFunnels)
 * en insights legibles para mediadores y administradores. Las reglas son
 * deterministas, simples y explicables — no hay IA, no hay predicciones,
 * no hay umbrales aprendidos: cada insight expone su evidencia y su
 * threshold para que un humano pueda verificar la lógica.
 *
 * Filosofía:
 *   - Cada regla emite a lo sumo un insight (o uno por modo, si aplica).
 *   - El insight describe la situación, la evidencia numérica, y una
 *     recomendación concreta. No persiste alertas: cada llamada recomputa.
 *   - IDs son determinísticos (regla + scope + mode) para deduplicación
 *     consistente entre snapshots o merges multi-escuela.
 *
 * Lo que NO hace:
 *   - No abre DB. No hace I/O. Recibe agregados ya calculados.
 *   - No emite eventos. No notifica. No envía correos.
 *   - No reescribe los thresholds en función de lo histórico — cada
 *     llamada es independiente.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

const READING_MODES = ['text', 'immersive', 'a11y', 'pdf', 'album'];

// Tipos válidos de insight (tipados en backend para validar shape).
export const INSIGHT_TYPES = Object.freeze([
    'adoption', 'dropoff', 'progress', 'error',
    'retention', 'technical', 'recommendation',
]);
export const INSIGHT_SEVERITIES = Object.freeze(['info', 'warning', 'critical']);

// Errores de contenido a11y que escalan severidad cuando aparecen.
const A11Y_CONTENT_ERROR_TYPES = Object.freeze([
    'text_unavailable', 'doc_empty', 'invalid_format',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(n, fallback = 0) {
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function pushInsight(out, partial) {
    out.push({
        scope: { level: 'global' },
        createdAt: Date.now(),
        ...partial,
    });
}

function severityRank(s) {
    return s === 'critical' ? 2 : s === 'warning' ? 1 : 0;
}

function compareInsights(a, b) {
    // 1) severidad descendente
    const sd = severityRank(b.severity) - severityRank(a.severity);
    if (sd !== 0) return sd;
    // 2) sampleSize descendente
    const aSize = safeNum(a.evidence?.sampleSize, 0);
    const bSize = safeNum(b.evidence?.sampleSize, 0);
    if (bSize !== aSize) return bSize - aSize;
    // 3) desviación frente a threshold (cuando aplica)
    const aDev = Math.abs(safeNum(a.evidence?.value) - safeNum(a.evidence?.threshold));
    const bDev = Math.abs(safeNum(b.evidence?.value) - safeNum(b.evidence?.threshold));
    return bDev - aDev;
}

function computeSeveritySummary(insights) {
    const out = { critical: 0, warning: 0, info: 0, total: insights.length };
    for (const i of insights) {
        if (i.severity === 'critical')      out.critical += 1;
        else if (i.severity === 'warning')  out.warning  += 1;
        else                                out.info     += 1;
    }
    return out;
}

// Acceso defensivo a funnels.lu/reading/etc. — el funnel puede no existir
// si el caller pasó un shape parcial.
function getFunnel(funnels, key) {
    return funnels && funnels.funnels && funnels.funnels[key]
        ? funnels.funnels[key]
        : null;
}

// Helper específico: count de un step por su key (ahorra match manual).
function stepCount(funnel, stepKey) {
    if (!funnel || !Array.isArray(funnel.steps)) return 0;
    const s = funnel.steps.find(st => st.key === stepKey);
    return safeNum(s?.count, 0);
}

// ── Reglas ──────────────────────────────────────────────────────────────────
//
// Cada regla recibe (insights, ctx) donde ctx = { metrics, funnels, windowDays }.
// Empuja insights al array si su condición se cumple.

function ruleNoNativeData(insights, ctx) {
    const { metrics } = ctx;
    const totalEvents = safeNum(metrics?.sourceBreakdown?.native?.totalEvents, 0);
    if (totalEvents > 0) return;
    pushInsight(insights, {
        id: 'insight.global.no_native_data',
        type: 'technical',
        severity: 'info',
        title: 'Sin datos nativos en la ventana',
        description: 'No se han registrado eventos del nuevo sistema en el período analizado. Las métricas combinadas usan fallback legacy.',
        evidence: { metric: 'sourceBreakdown.native.totalEvents', value: totalEvents, sampleSize: 0 },
        recommendation: 'Esperar tráfico real o validar que los emisores native estén desplegados en visores y LU.',
    });
}

function ruleReadingEarlyDropoff(insights, ctx) {
    const reading = getFunnel(ctx.funnels, 'reading');
    if (!reading) return;
    const starts     = stepCount(reading, 'session_start');
    const heartbeats = stepCount(reading, 'session_heartbeat');
    if (starts < 10) return;

    const ratio = starts > 0 ? heartbeats / starts : 0;
    const threshold = 0.5;
    if (ratio >= threshold) return;

    pushInsight(insights, {
        id: 'insight.reading.early_dropoff.global',
        type: 'retention',
        severity: 'warning',
        title: 'Muchos lectores abren, pero no permanecen',
        description: `Solo el ${Math.round(ratio * 100)}% de las sesiones de lectura llega a registrar actividad sostenida (heartbeat).`,
        evidence: {
            metric:      'reading.heartbeat / reading.session_start',
            value:       ratio,
            threshold,
            sampleSize:  starts,
            funnel:      'reading',
        },
        funnel: 'reading',
        recommendation: 'Revisar onboarding, carga inicial o atractivo del primer minuto de lectura.',
    });
}

function ruleReadingLowCloseRate(insights, ctx) {
    const reading = getFunnel(ctx.funnels, 'reading');
    if (!reading) return;
    const starts = stepCount(reading, 'session_start');
    const ends   = stepCount(reading, 'session_end');
    if (starts < 10) return;

    const ratio = starts > 0 ? ends / starts : 0;
    const threshold = 0.4;
    if (ratio >= threshold) return;

    pushInsight(insights, {
        id: 'insight.reading.low_close_rate.global',
        type: 'retention',
        severity: 'warning',
        title: 'Muchas sesiones no se cierran correctamente',
        description: `Solo el ${Math.round(ratio * 100)}% de las sesiones llega a emitir session_end. Posible cierre abrupto, problema técnico o UX.`,
        evidence: {
            metric:      'reading.session_end / reading.session_start',
            value:       ratio,
            threshold,
            sampleSize:  starts,
            funnel:      'reading',
        },
        funnel: 'reading',
        recommendation: 'Revisar manejo de cierre de pestaña, beforeunload, o errores que cortan la sesión.',
    });
}

function ruleLuDownloadDropoff(insights, ctx) {
    const lu = getFunnel(ctx.funnels, 'lu');
    if (!lu) return;
    const pageViews    = stepCount(lu, 'page_view');
    const downloadStart = stepCount(lu, 'download_start');
    if (pageViews < 10) return;

    const ratio = pageViews > 0 ? downloadStart / pageViews : 0;
    const threshold = 0.3;
    if (ratio >= threshold) return;

    pushInsight(insights, {
        id: 'insight.lu.download_dropoff.global',
        type: 'adoption',
        severity: 'warning',
        title: 'Pocos usuarios descargan Chibalete LU después de verla',
        description: `Solo el ${Math.round(ratio * 100)}% de los visitantes inicia la descarga del APK.`,
        evidence: {
            metric:     'lu.download_start / lu.page_view',
            value:      ratio,
            threshold,
            sampleSize: pageViews,
            funnel:     'lu',
        },
        funnel: 'lu',
        recommendation: 'Mejorar el llamado a la descarga, aclarar beneficios offline o reducir fricción del flujo.',
    });
}

function ruleLuErrorsHigh(insights, ctx) {
    const lu = getFunnel(ctx.funnels, 'lu');
    if (!lu) return;
    const pageViews = stepCount(lu, 'page_view');
    const errors    = safeNum(lu.errors?.total, 0);
    if (pageViews < 5) return; // sample mínimo para evitar falsos por baja N

    const rate = pageViews > 0 ? errors / pageViews : 0;
    let severity = null;
    if (rate > 0.25)      severity = 'critical';
    else if (rate > 0.10) severity = 'warning';
    if (!severity) return;

    pushInsight(insights, {
        id: 'insight.lu.errors_high.global',
        type: 'error',
        severity,
        title: 'Errores de descarga LU por encima del umbral',
        description: `${errors} errores de descarga sobre ${pageViews} vistas (${Math.round(rate * 100)}%). Tipos: ${
            Object.entries(lu.errors?.byType ?? {})
                .map(([k, v]) => `${k}=${v}`).join(', ') || 'sin detalle'
        }.`,
        evidence: {
            metric:     'lu.errors.total / lu.page_view',
            value:      rate,
            threshold:  severity === 'critical' ? 0.25 : 0.10,
            sampleSize: pageViews,
            funnel:     'lu',
        },
        funnel: 'lu',
        recommendation: 'Revisar apkUrl, endpoint de versión y disponibilidad del archivo APK.',
    });
}

function ruleImmersiveNoAudio(insights, ctx) {
    const im = getFunnel(ctx.funnels, 'immersive');
    if (!im) return;
    const starts = stepCount(im, 'session_start');
    const plays  = safeNum(im.audio?.playSessions, 0);
    if (starts <= 5) return;

    const ratio = starts > 0 ? plays / starts : 0;
    const threshold = 0.5;
    if (ratio >= threshold) return;

    pushInsight(insights, {
        id: 'insight.immersive.no_audio.global',
        type: 'dropoff',
        severity: 'warning',
        title: 'Muchos usuarios entran al modo inmersivo pero no reproducen audio',
        description: `Solo ${plays} de ${starts} sesiones inmersivas reproducen audio (${Math.round(ratio * 100)}%).`,
        evidence: {
            metric:     'immersive.audio.playSessions / immersive.session_start',
            value:      ratio,
            threshold,
            sampleSize: starts,
            funnel:     'immersive',
        },
        funnel: 'immersive',
        recommendation: 'Revisar visibilidad del botón play, permisos/autoplay del navegador o claridad del modo.',
    });
}

function ruleA11yContentErrors(insights, ctx) {
    const a11y = getFunnel(ctx.funnels, 'a11y');
    if (!a11y) return;
    const total = safeNum(a11y.errors?.total, 0);
    if (total <= 0) return;
    const byType = a11y.errors?.byType ?? {};

    // Suma de errores que indican contenido no apto para accesibilidad.
    let contentErrorTotal = 0;
    const presentTypes = [];
    for (const t of A11Y_CONTENT_ERROR_TYPES) {
        const n = safeNum(byType[t], 0);
        if (n > 0) {
            contentErrorTotal += n;
            presentTypes.push(t);
        }
    }
    if (contentErrorTotal <= 0) return;

    const starts = stepCount(a11y, 'session_start');
    const sessionRate = starts > 0 ? contentErrorTotal / starts : 0;

    // Severidad: critical si >= 3 contenidos afectados (proxy: >= 3 ocurrencias
    // de tipos de error de contenido) o si afecta > 20% de las sesiones.
    let severity = 'warning';
    if (contentErrorTotal >= 3 || sessionRate > 0.20) severity = 'critical';

    pushInsight(insights, {
        id: 'insight.a11y.content_errors.global',
        type: 'error',
        severity,
        title: 'Errores de contenido en Modo Accesible',
        description: `${contentErrorTotal} errores detectados en tipos de contenido sensibles (${presentTypes.join(', ')}).`,
        evidence: {
            metric:     'a11y.errors.byType[content_types].total',
            value:      contentErrorTotal,
            threshold:  3,
            sampleSize: starts,
            funnel:     'a11y',
        },
        funnel: 'a11y',
        recommendation: 'Priorizar corrección de textos planos accesibles para los contenidos afectados.',
    });
}

function ruleLowProgressByMode(insights, ctx) {
    const m = ctx.metrics;
    if (!m || !m.progressByMode || !m.usageByMode) return;
    const threshold = 0.15;

    for (const mode of READING_MODES) {
        const prog  = m.progressByMode[mode];
        const usage = m.usageByMode[mode];
        if (!prog || !usage) continue;
        const sessions = safeNum(usage.sessionStarts, 0);
        if (sessions < 10) continue;
        const avg = safeNum(prog.averageProgressFraction, 0);
        if (avg >= threshold) continue;

        pushInsight(insights, {
            id: `insight.mode.low_progress.${mode}.global`,
            type: 'progress',
            severity: 'warning',
            title: `Bajo progreso promedio en modo ${mode}`,
            description: `El progreso promedio en ${mode} es ${Math.round(avg * 100)}% sobre ${sessions} sesiones.`,
            evidence: {
                metric:     `progressByMode.${mode}.averageProgressFraction`,
                value:      avg,
                threshold,
                sampleSize: sessions,
                mode,
            },
            mode,
            recommendation: 'Revisar si el modo está generando avance real o si los usuarios abandonan pronto.',
        });
    }
}

function ruleDominantAdoptionByMode(insights, ctx) {
    const m = ctx.metrics;
    if (!m || !m.usageByMode) return;

    let totalUsers = 0;
    const perMode = {};
    for (const mode of READING_MODES) {
        const u = m.usageByMode[mode];
        const users = safeNum(u?.activeUsers, 0);
        perMode[mode] = users;
        totalUsers   += users;
    }
    // Sample mínimo: requerimos cierto volumen para que la regla aplique.
    if (totalUsers < 10) return;

    const threshold = 0.5;
    for (const mode of READING_MODES) {
        const users = perMode[mode];
        const share = totalUsers > 0 ? users / totalUsers : 0;
        if (share <= threshold) continue;

        pushInsight(insights, {
            id: `insight.mode.dominant_adoption.${mode}.global`,
            type: 'adoption',
            severity: 'info',
            title: `Un modo concentra la mayor adopción: ${mode}`,
            description: `${users} usuarios activos en ${mode} representan el ${Math.round(share * 100)}% del total.`,
            evidence: {
                metric:     `usageByMode.${mode}.activeUsers / total`,
                value:      share,
                threshold,
                sampleSize: totalUsers,
                mode,
            },
            mode,
            recommendation: 'Analizar qué elementos de este modo pueden trasladarse a otros para equilibrar adopción.',
        });
    }
}

function ruleLowHeartbeatCoverage(insights, ctx) {
    const m = ctx.metrics;
    if (!m || !m.heartbeatCoverage || !m.usageByMode) return;
    const threshold = 50; // coveragePercent en escala 0..100

    for (const mode of READING_MODES) {
        const cov = m.heartbeatCoverage[mode];
        const usage = m.usageByMode[mode];
        if (!cov || !usage) continue;
        const sessions = safeNum(usage.sessionStarts, 0);
        if (sessions < 10) continue;
        const pct = safeNum(cov.coveragePercent, 0);
        if (pct >= threshold) continue;

        pushInsight(insights, {
            id: `insight.mode.low_heartbeat.${mode}.global`,
            type: 'technical',
            severity: 'warning',
            title: `Cobertura de heartbeat baja en modo ${mode}`,
            description: `Solo ${pct}% de las sesiones de ${mode} reportan heartbeat sobre ${sessions} sesiones.`,
            evidence: {
                metric:     `heartbeatCoverage.${mode}.coveragePercent`,
                value:      pct,
                threshold,
                sampleSize: sessions,
                mode,
            },
            mode,
            recommendation: 'Revisar si el modo pierde sesiones, se cierra abruptamente o no marca actividad correctamente.',
        });
    }
}

const RULES = [
    ruleNoNativeData,
    ruleReadingEarlyDropoff,
    ruleReadingLowCloseRate,
    ruleLuDownloadDropoff,
    ruleLuErrorsHigh,
    ruleImmersiveNoAudio,
    ruleA11yContentErrors,
    ruleLowProgressByMode,
    ruleDominantAdoptionByMode,
    ruleLowHeartbeatCoverage,
];

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Calcula los insights del backbone a partir de metrics + funnels.
 *
 * @param {object} input
 * @param {object} input.metrics    - shape `aggregateBackboneMetrics`.
 * @param {object} input.funnels    - shape `computeBackboneFunnels`.
 * @param {number} input.windowDays - días de la ventana (informativo).
 * @returns {object}
 */
export function computeBackboneInsights({ metrics, funnels, windowDays } = {}) {
    const safeMetrics = metrics ?? {};
    const safeFunnels = funnels ?? {};

    const ctx = { metrics: safeMetrics, funnels: safeFunnels, windowDays: windowDays ?? null };
    const insights = [];

    for (const rule of RULES) {
        try {
            rule(insights, ctx);
        } catch {
            // Una regla rota no debe tumbar todas las demás.
        }
    }

    // Dedup defensivo por id (solo se queda el primero — las reglas no
    // deberían colisionar pero es barato proteger).
    const byId = new Map();
    for (const i of insights) {
        if (!byId.has(i.id)) byId.set(i.id, i);
    }
    const deduped = [...byId.values()].sort(compareInsights);

    return {
        generatedAt:     Date.now(),
        windowDays:      windowDays ?? null,
        severitySummary: computeSeveritySummary(deduped),
        insights:        deduped,
    };
}

/**
 * Shape vacío válido — fallback cuando no se puede calcular.
 */
export function emptyBackboneInsights({ windowDays } = {}) {
    return {
        generatedAt:     Date.now(),
        windowDays:      windowDays ?? null,
        severitySummary: { critical: 0, warning: 0, info: 0, total: 0 },
        insights:        [],
    };
}
