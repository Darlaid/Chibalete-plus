import React from 'react';
import { RiskBadge, type Severity } from './RiskBadge';
import { EmptyState } from './EmptyState';
import { AlertCircle, CheckCircle2, Eye, Info, MinusCircle } from 'lucide-react';

/**
 * LongitudinalStudentTimeline — Fase 3A Aula Viva Operacional.
 *
 * Render cronológico del estado longitudinal de UN lector. Pensado para que
 * un mediador entienda en 5 segundos qué pasó, sin necesidad de scrollear
 * tablas de signals crudos.
 *
 * Principios de diseño:
 *   - Plain semántica HTML. NO canvas. NO D3. NO heatmaps.
 *   - Tailwind para estilos. Mobile-friendly por defecto (stack vertical).
 *   - Reusa `RiskBadge` (severity visual unificada) y `EmptyState` existentes.
 *   - Cada tarjeta lleva caveat visible. El backend filtra vocabulario
 *     prohibido (afirmaciones de comprensión, juicios de valor); este
 *     componente confía en eso y NO reescribe textos.
 *   - Recibe los datos via prop — NO hace fetch interno. La página/orquestador
 *     decide cuándo cargar y de dónde.
 *   - Defensivo: si `data` es null o algún campo falta, degrada a EmptyState.
 */

// ── Shapes (compatibles con el payload del endpoint /students/:userId/timeline) ─

export interface TimelineSummary {
    id: string;
    kind: 'insufficient_data' | 'attention' | 'positive' | 'observation' | 'neutral';
    headline: string;
    evidence: string;
    confidence: 'low' | 'medium' | 'high';
    caveat: string;
    sources: string[];
}

export interface TimelineSignal {
    signal_id: string;
    metric_value: number | null;
    confidence: string;
    updated_at?: number | null;
}

export interface TimelineRisk {
    risk_id?: string;
    risk_type: string;
    severity: Severity;
    detected_at: number;
    resolved_at: number | null;
}

export interface TimelineRecommendation {
    recommendation_id: string;
    rule_id: string;
    severity: Severity;
    acknowledged: number | boolean;
    created_at: number;
    expires_at?: number | null;
}

export interface LongitudinalTimelinePayload {
    user_id: string;
    profile_current: Record<string, unknown> | null;
    signals_current: TimelineSignal[];
    risks: TimelineRisk[];
    recommendations: TimelineRecommendation[];
    summaries?: TimelineSummary[];
    stale?: boolean;
    reason?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const KIND_STYLE: Record<TimelineSummary['kind'], { bg: string; border: string; iconColor: string; Icon: React.ElementType; ariaTone: string }> = {
    insufficient_data: { bg: 'bg-gray-50',    border: 'border-gray-200',   iconColor: 'text-gray-500',   Icon: MinusCircle, ariaTone: 'neutral' },
    attention:         { bg: 'bg-amber-50',   border: 'border-amber-200',  iconColor: 'text-amber-600',  Icon: AlertCircle, ariaTone: 'warning' },
    positive:          { bg: 'bg-emerald-50', border: 'border-emerald-200',iconColor: 'text-emerald-600',Icon: CheckCircle2,ariaTone: 'positive' },
    observation:       { bg: 'bg-sky-50',     border: 'border-sky-200',    iconColor: 'text-sky-600',    Icon: Eye,         ariaTone: 'info' },
    neutral:           { bg: 'bg-gray-50',    border: 'border-gray-200',   iconColor: 'text-gray-500',   Icon: Info,        ariaTone: 'neutral' },
};

const CONFIDENCE_LABEL: Record<TimelineSummary['confidence'], string> = {
    low: 'confianza baja',
    medium: 'confianza media',
    high: 'confianza alta',
};

function relativeDays(ts: number | null | undefined): string {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'fecha desconocida';
    const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
    if (days < 0)  return 'futuro';
    if (days === 0) return 'hoy';
    if (days === 1) return 'hace 1 día';
    if (days < 7)  return `hace ${days} días`;
    if (days < 30) return `hace ${Math.floor(days / 7)} semana${Math.floor(days / 7) !== 1 ? 's' : ''}`;
    return `hace ${Math.floor(days / 30)} mes${Math.floor(days / 30) !== 1 ? 'es' : ''}`;
}

// ── Sub-componentes ────────────────────────────────────────────────────────

const SummaryCard: React.FC<{ summary: TimelineSummary }> = ({ summary }) => {
    const s = KIND_STYLE[summary.kind] ?? KIND_STYLE.neutral;
    const { Icon } = s;
    return (
        <article
            className={`rounded-lg border ${s.border} ${s.bg} p-3 sm:p-4`}
            aria-label={`Resumen observacional: ${summary.headline}`}
            data-summary-id={summary.id}
        >
            <header className="flex items-start gap-2">
                <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${s.iconColor}`} aria-hidden />
                <div className="flex-1 min-w-0">
                    <p className="text-sm sm:text-base font-medium text-gray-900 leading-snug">
                        {summary.headline}
                    </p>
                    <p className="mt-1 text-xs sm:text-sm text-gray-700 leading-relaxed">
                        {summary.evidence}
                    </p>
                </div>
                <span
                    className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-white/70 text-gray-700 font-medium flex-shrink-0"
                    aria-label={CONFIDENCE_LABEL[summary.confidence]}
                    title={CONFIDENCE_LABEL[summary.confidence]}
                >
                    {summary.confidence}
                </span>
            </header>
            <p className="mt-2 text-[11px] sm:text-xs text-gray-600 italic leading-relaxed">
                {summary.caveat}
            </p>
        </article>
    );
};

const RiskCard: React.FC<{ risk: TimelineRisk }> = ({ risk }) => (
    <article
        className="rounded-lg border border-rose-200 bg-rose-50 p-3 sm:p-4"
        aria-label={`Riesgo activo: ${risk.risk_type}`}
    >
        <header className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 capitalize truncate">
                {risk.risk_type.replace(/_/g, ' ')}
            </span>
            <RiskBadge severity={risk.severity} compact />
        </header>
        <p className="mt-1 text-xs text-gray-700">
            Detectado {relativeDays(risk.detected_at)}.
            {risk.resolved_at === null && (
                <span className="ml-1 text-rose-700 font-medium">No resuelto.</span>
            )}
        </p>
    </article>
);

const RecommendationCardMini: React.FC<{ rec: TimelineRecommendation }> = ({ rec }) => {
    const isPending = rec.acknowledged === 0 || rec.acknowledged === false;
    return (
        <article
            className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4"
            aria-label={`Recomendación: ${rec.rule_id}`}
            data-recommendation-id={rec.recommendation_id}
        >
            <header className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">
                    {rec.rule_id.replace(/_/g, ' ')}
                </span>
                <RiskBadge severity={rec.severity} compact />
            </header>
            <p className="mt-1 text-xs text-gray-700">
                {relativeDays(rec.created_at)}
                {isPending
                    ? <span className="ml-1 text-amber-700 font-medium">Pendiente de revisión.</span>
                    : <span className="ml-1 text-gray-500">Ya revisada.</span>}
            </p>
        </article>
    );
};

// ── Componente principal ───────────────────────────────────────────────────

export const LongitudinalStudentTimeline: React.FC<{
    data: LongitudinalTimelinePayload | null;
    loading?: boolean;
}> = ({ data, loading = false }) => {
    if (loading) {
        return (
            <div className="p-4 text-sm text-gray-500" role="status" aria-live="polite">
                Cargando timeline longitudinal…
            </div>
        );
    }
    if (!data) {
        return <EmptyState kind="no_signals_yet" />;
    }
    // Sin profile + sin summaries — el endpoint no halló nada relevante.
    if (data.profile_current === null && (data.summaries?.length ?? 0) === 0) {
        return <EmptyState kind="no_signals_yet" />;
    }

    const summaries = Array.isArray(data.summaries) ? data.summaries : [];
    const unresolvedRisks = (Array.isArray(data.risks) ? data.risks : [])
        .filter(r => r && r.resolved_at === null)
        .slice(0, 5);
    const recentRecs = (Array.isArray(data.recommendations) ? data.recommendations : [])
        .slice()
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        .slice(0, 6);

    return (
        <article
            aria-label="Timeline longitudinal del lector"
            className="space-y-4 sm:space-y-5"
            data-component="LongitudinalStudentTimeline"
        >
            {data.stale && (
                <p className="text-[11px] sm:text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    Datos potencialmente atrasados ({data.reason ?? 'unknown'}). Las métricas se actualizan periódicamente.
                </p>
            )}

            {summaries.length > 0 && (
                <section aria-label="Resúmenes observacionales" className="space-y-2">
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Observaciones recientes
                    </h3>
                    {summaries.map(s => <SummaryCard key={s.id} summary={s} />)}
                </section>
            )}

            {unresolvedRisks.length > 0 && (
                <section aria-label="Riesgos sin resolver" className="space-y-2">
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Riesgos activos
                    </h3>
                    {unresolvedRisks.map(r => (
                        <RiskCard key={r.risk_id ?? `${r.risk_type}_${r.detected_at}`} risk={r} />
                    ))}
                </section>
            )}

            {recentRecs.length > 0 && (
                <section aria-label="Recomendaciones recientes" className="space-y-2">
                    <h3 className="text-xs sm:text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Recomendaciones recientes
                    </h3>
                    {recentRecs.map(r => (
                        <RecommendationCardMini key={r.recommendation_id} rec={r} />
                    ))}
                </section>
            )}

            <footer className="pt-2 text-[10px] sm:text-xs text-gray-500 italic">
                Las observaciones son derivadas determinísticamente de los eventos longitudinales.
                Ninguna afirma comprensión, motivación o emoción real del lector — son patrones
                observados en la plataforma. Datos siempre interpretables junto con conocimiento
                pedagógico del mediador.
            </footer>
        </article>
    );
};

export default LongitudinalStudentTimeline;
