import React from 'react';

/**
 * Sparkline — SVG puro (sin lib externa). PASO 5 §14.
 *
 * Mini-línea para mostrar tendencias temporales en celdas pequeñas.
 * Coordenadas escaladas al viewBox; el SVG se redimensiona vía CSS.
 *
 * Props:
 *   - values: number[]  — serie temporal (índice = punto X)
 *   - width / height (default 80x24)
 *   - color (default 'currentColor' → hereda)
 *   - showZero — si true dibuja línea base en y=0
 */
export interface SparklineProps {
    values: Array<number | null | undefined>;
    width?: number;
    height?: number;
    color?: string;
    showZero?: boolean;
    ariaLabel?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
    values, width = 80, height = 24, color = 'currentColor', showZero = false,
    ariaLabel = 'Tendencia',
}) => {
    const nums = values.map(v => (typeof v === 'number' && isFinite(v) ? v : null));
    const valid = nums.filter((v): v is number => v != null);
    if (valid.length < 2) {
        return (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
                 role="img" aria-label={ariaLabel}>
                <text x={width/2} y={height/2+4} textAnchor="middle" fontSize="10" fill="#9CA3AF">
                    sin datos
                </text>
            </svg>
        );
    }
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const range = max - min || 1;
    const padX = 2, padY = 2;
    const w = width - 2 * padX, h = height - 2 * padY;
    const points: string[] = [];
    nums.forEach((v, i) => {
        if (v == null) return;
        const x = padX + (i / Math.max(1, nums.length - 1)) * w;
        const y = padY + h - ((v - min) / range) * h;
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
             role="img" aria-label={`${ariaLabel}: ${valid.length} puntos, min ${min.toFixed(2)}, max ${max.toFixed(2)}`}>
            {showZero && (
                <line x1={padX} x2={width-padX}
                      y1={padY + h - ((0 - min) / range) * h}
                      y2={padY + h - ((0 - min) / range) * h}
                      stroke="#E5E7EB" strokeWidth="1" strokeDasharray="2,2"/>
            )}
            <polyline points={points.join(' ')} fill="none"
                      stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
            {/* Punto final destacado */}
            {(() => {
                const last = points[points.length - 1].split(',');
                return <circle cx={last[0]} cy={last[1]} r="2" fill={color}/>;
            })()}
        </svg>
    );
};
