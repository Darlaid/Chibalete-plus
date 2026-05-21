import React from 'react';

/**
 * OutcomeDistributionBars — SVG puro PASO 7 §7.
 *
 * Barras horizontales para mostrar distribución improved/stable/worsened/
 * mixed/insufficient_data. Pedagógicamente honesto: cada barra muestra
 * count, etiqueta humana, y porcentaje del total.
 *
 * NO ranking. NO gauges grandes. Solo conteo + porcentaje.
 */
export interface OutcomeDistribution {
    improved?: number;
    stable?: number;
    worsened?: number;
    mixed?: number;
    insufficient_data?: number;
}

const LABEL_ORDER: Array<keyof OutcomeDistribution> = [
    'improved', 'stable', 'mixed', 'worsened', 'insufficient_data',
];

const LABEL_HUMAN: Record<keyof OutcomeDistribution, { text: string; color: string }> = {
    improved:           { text: 'Mejora observada',      color: '#10B981' },  // emerald
    stable:             { text: 'Sin cambios',           color: '#9CA3AF' },  // gray
    mixed:              { text: 'Cambios mixtos',        color: '#F59E0B' },  // amber
    worsened:           { text: 'Retroceso observado',   color: '#EF4444' },  // rose
    insufficient_data:  { text: 'Datos insuficientes',   color: '#D1D5DB' },  // gray-300
};

export const OutcomeDistributionBars: React.FC<{
    distribution: OutcomeDistribution;
    width?: number;
    rowHeight?: number;
    showInsufficient?: boolean;
}> = ({ distribution, width = 320, rowHeight = 28, showInsufficient = true }) => {
    const labels = LABEL_ORDER.filter(k =>
        k !== 'insufficient_data' || showInsufficient);
    const total = labels.reduce((s, k) => s + (distribution[k] || 0), 0);
    if (total === 0) {
        return (
            <div className="text-xs text-gray-500 italic py-3 text-center">
                Sin outcomes registrados todavía
            </div>
        );
    }
    const max = Math.max(...labels.map(k => distribution[k] || 0), 1);
    const labelWidth = 130;
    const numWidth = 56;
    const barWidth = Math.max(80, width - labelWidth - numWidth - 16);
    const svgHeight = labels.length * rowHeight;

    return (
        <svg width={width} height={svgHeight} viewBox={`0 0 ${width} ${svgHeight}`}
             role="img" aria-label={`Distribución de outcomes, total ${total}`}>
            {labels.map((k, i) => {
                const v = distribution[k] || 0;
                const w = (v / max) * barWidth;
                const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                const { text, color } = LABEL_HUMAN[k];
                const y = i * rowHeight + 4;
                return (
                    <g key={k}>
                        <text x={labelWidth - 6} y={y + 14} fontSize="11"
                              fill="#374151" textAnchor="end">{text}</text>
                        <rect x={labelWidth} y={y + 4} width={Math.max(2, w)} height={14}
                              rx={2} fill={color} opacity={v > 0 ? 1 : 0.25}/>
                        <text x={labelWidth + barWidth + 6} y={y + 14} fontSize="11"
                              fill="#111827" fontWeight={500}>
                            {v} <tspan fill="#6B7280" fontWeight={400}>({pct}%)</tspan>
                        </text>
                    </g>
                );
            })}
        </svg>
    );
};
