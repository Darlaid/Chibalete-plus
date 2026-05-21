import React from 'react';

/**
 * CohortTrajectorySVG — PASO 7 §7.
 *
 * Línea longitudinal SVG puro que muestra la evolución de UNA métrica
 * a lo largo de una serie de trayectorias de cohorte. Coordenadas con
 * eje X = period_end (timestamp), eje Y = metric_value.
 *
 * Sin lib externa. Sin tooltips complejos. Pedagógicamente legible.
 */
export interface TrajectoryPoint {
    period_end: number;
    metrics: Record<string, number | null>;
    sample_size?: number;
}

export const CohortTrajectorySVG: React.FC<{
    series: TrajectoryPoint[];
    metric: string;
    label?: string;
    width?: number;
    height?: number;
    color?: string;
}> = ({ series, metric, label, width = 320, height = 96, color = '#3B82F6' }) => {
    const pts = series
        .map(p => ({ x: p.period_end, y: p.metrics?.[metric] }))
        .filter(p => typeof p.y === 'number' && isFinite(p.y!)) as Array<{x: number, y: number}>;
    if (pts.length < 2) {
        return (
            <div className="text-[11px] text-gray-500 italic text-center py-4">
                Sin serie temporal suficiente para {label || metric}
            </div>
        );
    }
    pts.sort((a, b) => a.x - b.x);
    const minX = pts[0].x;
    const maxX = pts[pts.length - 1].x;
    const rangeX = maxX - minX || 1;
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    const rangeY = maxY - minY || 1;
    const padX = 24, padY = 18;
    const w = width - 2 * padX;
    const h = height - 2 * padY;
    const path = pts.map((p, i) => {
        const x = padX + ((p.x - minX) / rangeX) * w;
        const y = padY + h - ((p.y - minY) / rangeY) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const lastPt = pts[pts.length - 1];
    const lastX = padX + w;
    const lastY = padY + h - ((lastPt.y - minY) / rangeY) * h;

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
             role="img" aria-label={`Trayectoria ${label || metric}: ${pts.length} puntos`}>
            {/* baseline */}
            <line x1={padX} y1={padY + h} x2={padX + w} y2={padY + h}
                  stroke="#E5E7EB" strokeWidth="1"/>
            <text x={padX} y={padY - 4} fontSize="10" fill="#6B7280">
                {label || metric}
            </text>
            <text x={padX + w} y={padY - 4} fontSize="9" fill="#9CA3AF" textAnchor="end">
                {new Date(minX).toLocaleDateString()} → {new Date(maxX).toLocaleDateString()}
            </text>
            {/* line */}
            <path d={path} fill="none" stroke={color} strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"/>
            {/* final point */}
            <circle cx={lastX} cy={lastY} r="3" fill={color}/>
            <text x={lastX - 4} y={lastY - 6} fontSize="10" fill="#111827"
                  textAnchor="end" fontWeight={500}>
                {lastPt.y.toFixed(2)}
            </text>
            {/* min/max ticks */}
            <text x={padX - 4} y={padY + 4} fontSize="9" fill="#9CA3AF" textAnchor="end">
                {maxY.toFixed(2)}
            </text>
            <text x={padX - 4} y={padY + h + 2} fontSize="9" fill="#9CA3AF" textAnchor="end">
                {minY.toFixed(2)}
            </text>
        </svg>
    );
};
