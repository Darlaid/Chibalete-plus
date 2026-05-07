/**
 * BackboneInsightsSection — alertas e insights sobre el Backbone.
 *
 * Sprint Data Backbone — Fase 6B.
 *
 * Render aditivo bajo la sección de embudos. Lee de la propiedad opcional
 * `insights` que el backend (Sprint 6B) inyecta dentro de backboneMetrics.
 * Si el campo no existe (cliente viejo / backend sin Sprint 6B) → no
 * renderiza nada.
 *
 * Reglas:
 *   - `insights === null/undefined` → no renderizar (zero-impact).
 *   - `severitySummary.total === 0` → "Sin alertas relevantes por ahora".
 *   - Caso normal → resumen de severidades + máximo 5 insights prioritarios.
 *
 * El componente no agrupa, no filtra, no transforma — confía en el orden
 * que ya devuelve el backend (critical → warning → info, dentro de cada
 * grupo por sampleSize y desviación).
 */

import React from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

// ── Tipos espejo del backend ─────────────────────────────────────────────────

export type InsightSeverity = 'info' | 'warning' | 'critical';
export type InsightType =
    | 'adoption' | 'dropoff' | 'progress' | 'error'
    | 'retention' | 'technical' | 'recommendation';

export interface InsightEvidence {
    metric:      string;
    value:       number;
    threshold?:  number;
    sampleSize?: number;
    mode?:       string;
    funnel?:     string;
}

export interface Insight {
    id:             string;
    type:           InsightType;
    severity:       InsightSeverity;
    title:          string;
    description:    string;
    evidence:       InsightEvidence;
    recommendation: string;
    scope:          { level: 'global' | 'school' | 'course' | 'student'; id?: string };
    mode?:          string;
    funnel?:        string;
    createdAt:      number;
}

export interface InsightSeveritySummary {
    critical: number;
    warning:  number;
    info:     number;
    total:    number;
}

export interface BackboneInsights {
    generatedAt?:     number;
    windowDays?:      number | null;
    severitySummary?: InsightSeveritySummary;
    insights?:        Insight[];
}

// ── Estilos por severidad ────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<InsightSeverity, {
    icon:       React.ComponentType<{ size?: number; className?: string }>;
    badge:      string;
    border:     string;
    iconColor:  string;
    label:      string;
}> = {
    critical: {
        icon:      AlertCircle,
        badge:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        border:    'border-red-200 dark:border-red-900/40',
        iconColor: 'text-red-600 dark:text-red-400',
        label:     'Crítica',
    },
    warning: {
        icon:      AlertTriangle,
        badge:     'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        border:    'border-amber-200 dark:border-amber-900/40',
        iconColor: 'text-amber-600 dark:text-amber-400',
        label:     'Advertencia',
    },
    info: {
        icon:      Info,
        badge:     'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
        border:    'border-sky-200 dark:border-sky-900/40',
        iconColor: 'text-sky-600 dark:text-sky-400',
        label:     'Informativa',
    },
};

// ── Formateo de evidencia ────────────────────────────────────────────────────

function formatEvidence(e: InsightEvidence): string {
    const parts: string[] = [];
    if (Number.isFinite(e.value)) {
        // Si parece ratio (0..1), formatea como porcentaje. Si es entero
        // pequeño, déjalo como cuenta. Si parece porcentaje (0..100), idem.
        if (e.value > 0 && e.value <= 1) {
            parts.push(`${Math.round(e.value * 100)}%`);
        } else if (Number.isInteger(e.value)) {
            parts.push(String(e.value));
        } else {
            parts.push(e.value.toFixed(2));
        }
    }
    if (e.threshold !== undefined && Number.isFinite(e.threshold)) {
        const t = e.threshold > 0 && e.threshold <= 1
            ? `${Math.round(e.threshold * 100)}%`
            : String(e.threshold);
        parts.push(`umbral ${t}`);
    }
    if (e.sampleSize !== undefined && Number.isFinite(e.sampleSize)) {
        parts.push(`n=${e.sampleSize}`);
    }
    return parts.join(' · ');
}

// ── Item de insight ──────────────────────────────────────────────────────────

const InsightItem: React.FC<{ insight: Insight }> = ({ insight }) => {
    const style = SEVERITY_STYLES[insight.severity];
    const Icon  = style.icon;

    return (
        <div className={`bg-white dark:bg-gray-800 border ${style.border} rounded-lg p-4`}>
            <div className="flex items-start gap-3">
                <Icon size={18} className={`${style.iconColor} flex-shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {insight.title}
                        </h3>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>
                            {style.label}
                        </span>
                        {insight.mode && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                {insight.mode}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 leading-snug mb-2">
                        {insight.description}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums mb-2">
                        {formatEvidence(insight.evidence)}
                    </p>
                    <p className="text-xs text-gray-700 dark:text-gray-200 italic">
                        → {insight.recommendation}
                    </p>
                </div>
            </div>
        </div>
    );
};

// ── Resumen compacto de severidades ──────────────────────────────────────────

const SeverityChip: React.FC<{ severity: InsightSeverity; count: number }> = ({ severity, count }) => {
    if (count === 0) return null;
    const s = SEVERITY_STYLES[severity];
    const Icon = s.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>
            <Icon size={12} />
            {count} {s.label.toLowerCase()}{count === 1 ? '' : 's'}
        </span>
    );
};

// ── Componente principal ─────────────────────────────────────────────────────

interface BackboneInsightsSectionProps {
    insights: BackboneInsights | null | undefined;
    /** Máximo de insights a renderizar. Default 5. */
    maxItems?: number;
}

const BackboneInsightsSection: React.FC<BackboneInsightsSectionProps> = ({ insights, maxItems = 5 }) => {
    if (!insights) return null;

    const summary    = insights.severitySummary ?? { critical: 0, warning: 0, info: 0, total: 0 };
    const list       = Array.isArray(insights.insights) ? insights.insights : [];
    const windowDays = insights.windowDays ?? 30;
    const visible    = list.slice(0, maxItems);
    const hidden     = Math.max(0, list.length - visible.length);

    return (
        <section aria-labelledby="backbone-insights-title" className="mt-6">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <h2
                    id="backbone-insights-title"
                    className="text-xs font-semibold tracking-wider uppercase text-gray-500 dark:text-gray-400"
                >
                    Alertas e insights
                </h2>
                {summary.total > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <SeverityChip severity="critical" count={summary.critical} />
                        <SeverityChip severity="warning"  count={summary.warning}  />
                        <SeverityChip severity="info"     count={summary.info}     />
                    </div>
                )}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                Últimos {windowDays} {windowDays === 1 ? 'día' : 'días'} · reglas determinísticas sobre eventos native
            </p>

            {summary.total === 0 ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                        Sin alertas relevantes por ahora.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {visible.map(i => (
                        <InsightItem key={i.id} insight={i} />
                    ))}
                    {hidden > 0 && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 italic text-center">
                            +{hidden} insight{hidden === 1 ? '' : 's'} más en /api/metrics/insights
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};

export default BackboneInsightsSection;
