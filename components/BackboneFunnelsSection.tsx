/**
 * BackboneFunnelsSection — embudos de conversión sobre el Backbone v1.
 *
 * Sprint Data Backbone — Fase 6A.
 *
 * Render aditivo bajo "Uso por modo de lectura". Lee de la propiedad
 * opcional `funnels` que el backend (Sprint 6A) inyecta dentro de
 * backboneMetrics. Si el campo no existe (cliente viejo / backend sin
 * Sprint 6A) → no renderiza nada.
 *
 * Reglas:
 *   - `funnels === null/undefined` → no renderizar (zero-impact).
 *   - Sin sesiones nativas en ningún flujo → "Aún no hay datos
 *     suficientes".
 *   - Caso normal → cards compactas LU / lectura general / accesible /
 *     inmersivo. PDF y álbum no tienen card propia (su métrica es la
 *     misma que ya muestra "Uso por modo"); quedan disponibles vía API
 *     para Sprint 6B si hace falta una vista detalle.
 */

import React from 'react';

// ── Tipos espejo del backend ─────────────────────────────────────────────────

export interface FunnelStep {
    key:                    string;
    label:                  string;
    count:                  number;
    uniqueUsers:            number;
    conversionFromPrevious: number | null;
    conversionFromStart:    number;
}

export interface FunnelDropoff {
    from:        string;
    to:          string;
    lost:        number;
    lostPercent: number;
}

export interface FunnelSummary {
    starts:         number;
    completions:    number;
    completionRate: number;
    biggestDropoff: FunnelDropoff | null;
}

export interface FunnelBase {
    id:        string;
    label:     string;
    steps:     FunnelStep[];
    dropoffs:  FunnelDropoff[];
    summary:   FunnelSummary;
}

export interface FunnelLu extends FunnelBase {
    errors: { total: number; byType: Record<string, number> };
}

export interface FunnelA11y extends FunnelBase {
    errors: { total: number; byType: Record<string, number> };
}

export interface FunnelImmersive extends FunnelBase {
    audio: { playSessions: number; pauseSessions: number; playPauseRatio: number };
}

export interface FunnelReading extends FunnelBase {
    byMode: Record<string, FunnelBase>;
}

export interface BackboneFunnels {
    generatedAt?:            number;
    windowDays?:             number | null;
    windowFrom?:             number | null;
    windowTo?:               number | null;
    sourceFilter?:           'native';
    nativeEventCount?:       number;
    ignoredNonNativeEvents?: number;
    funnels?: {
        lu?:        FunnelLu;
        reading?:   FunnelReading;
        a11y?:      FunnelA11y;
        immersive?: FunnelImmersive;
        pdf?:       FunnelBase;
        album?:     FunnelBase;
    };
}

// ── Formateo ─────────────────────────────────────────────────────────────────

function formatPercent(fraction: number): string {
    if (!Number.isFinite(fraction)) return '—';
    return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

function formatLostPercent(fraction: number): string {
    if (!Number.isFinite(fraction)) return '—';
    return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

// ── Card compacta por funnel ─────────────────────────────────────────────────

interface FunnelCardProps {
    funnel:           FunnelBase;
    accentColor?:     string;
    extraLabel?:      string;
    extraValue?:      string;
}

const FunnelCard: React.FC<FunnelCardProps> = ({ funnel, extraLabel, extraValue }) => {
    const { label, summary, steps } = funnel;
    const hasData = summary.starts > 0;

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {label}
                </h3>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {steps.length} pasos
                </span>
            </div>

            {!hasData ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    Sin actividad en la ventana.
                </p>
            ) : (
                <>
                    <dl className="space-y-2 text-sm">
                        <Row label="Inicio"        value={`${summary.starts} sesiones`} />
                        <Row label="Final"         value={`${summary.completions} sesiones`} />
                        <Row
                            label="Conversión"
                            value={formatPercent(summary.completionRate)}
                            emphasize={summary.completionRate >= 0.5}
                        />
                        {summary.biggestDropoff && (
                            <Row
                                label="Mayor abandono"
                                value={`${stepLabelFor(summary.biggestDropoff.from, steps)} → ${stepLabelFor(summary.biggestDropoff.to, steps)}`}
                                detail={`-${summary.biggestDropoff.lost} (${formatLostPercent(summary.biggestDropoff.lostPercent)})`}
                                negative
                            />
                        )}
                        {extraLabel && extraValue !== undefined && (
                            <Row label={extraLabel} value={extraValue} />
                        )}
                    </dl>

                    {/* Mini bar de pasos: muestra la cadena visualmente */}
                    <div className="mt-3 flex items-baseline gap-1 text-[11px] text-gray-500 dark:text-gray-400 overflow-x-auto">
                        {steps.map((s, i) => (
                            <React.Fragment key={s.key}>
                                {i > 0 && <span className="text-gray-300 dark:text-gray-600">→</span>}
                                <span className="whitespace-nowrap">
                                    <span className="font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                                        {s.count}
                                    </span>
                                    <span className="ml-1">{s.label}</span>
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const Row: React.FC<{
    label:     string;
    value:     string;
    detail?:   string;
    emphasize?: boolean;
    negative?:  boolean;
}> = ({ label, value, detail, emphasize, negative }) => (
    <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
        <dd className="flex flex-col items-end">
            <span
                className={
                    negative
                        ? 'text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums'
                        : emphasize
                            ? 'text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums'
                            : 'text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums'
                }
            >
                {value}
            </span>
            {detail && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
                    {detail}
                </span>
            )}
        </dd>
    </div>
);

function stepLabelFor(key: string, steps: FunnelStep[]): string {
    const found = steps.find(s => s.key === key);
    return found ? found.label : key;
}

// ── Componente principal ─────────────────────────────────────────────────────

interface BackboneFunnelsSectionProps {
    funnels: BackboneFunnels | null | undefined;
}

const BackboneFunnelsSection: React.FC<BackboneFunnelsSectionProps> = ({ funnels }) => {
    if (!funnels || !funnels.funnels) return null;

    const f          = funnels.funnels;
    const windowDays = funnels.windowDays ?? 30;

    // Si ningún flujo tiene sesiones, mostramos estado vacío único.
    const totalStarts =
        (f.lu?.summary.starts ?? 0) +
        (f.reading?.summary.starts ?? 0) +
        (f.a11y?.summary.starts ?? 0) +
        (f.immersive?.summary.starts ?? 0);

    return (
        <section aria-labelledby="backbone-funnels-title" className="mt-6">
            <h2
                id="backbone-funnels-title"
                className="text-xs font-semibold tracking-wider uppercase text-gray-500 dark:text-gray-400 mb-1"
            >
                Embudos de conversión
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                Últimos {windowDays} {windowDays === 1 ? 'día' : 'días'} · solo eventos del nuevo sistema (native)
            </p>

            {totalStarts === 0 ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                        Aún no hay datos suficientes.
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Los embudos solo cuentan eventos emitidos por el nuevo sistema.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {f.lu && (
                        <FunnelCard
                            funnel={f.lu}
                            extraLabel={f.lu.errors.total > 0 ? 'Errores de descarga' : undefined}
                            extraValue={f.lu.errors.total > 0 ? String(f.lu.errors.total) : undefined}
                        />
                    )}
                    {f.reading && <FunnelCard funnel={f.reading} />}
                    {f.a11y && (
                        <FunnelCard
                            funnel={f.a11y}
                            extraLabel={f.a11y.errors.total > 0 ? 'Errores accesibilidad' : undefined}
                            extraValue={f.a11y.errors.total > 0 ? String(f.a11y.errors.total) : undefined}
                        />
                    )}
                    {f.immersive && (
                        <FunnelCard
                            funnel={f.immersive}
                            extraLabel="Ratio play/pause"
                            extraValue={
                                f.immersive.audio.playSessions + f.immersive.audio.pauseSessions > 0
                                    ? formatPercent(f.immersive.audio.playPauseRatio)
                                    : '—'
                            }
                        />
                    )}
                </div>
            )}
        </section>
    );
};

export default BackboneFunnelsSection;
