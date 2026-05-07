/**
 * PixelProgressBar — Sprint Modo accesible (experiencia).
 *
 * Barra de progreso tipo "nivel" con bloques visibles. Inspirada en barras
 * de carga de juegos retro, pero con accesibilidad real:
 *
 *   - role="progressbar" + aria-valuemin/max/now
 *   - aria-label legible (la consigna debe pasarlo)
 *   - texto alternativo accesible para screen readers (cuántos bloques de cuántos)
 *   - bloques generados por divs (no caracteres unicode) para que el ancho
 *     sea controlado por flex/grid y el aspecto sea predecible cross-browser
 *
 * El sprint pide el aspecto "▓▓▓░░░" — lo logramos con bloques cuadrados
 * sólidos (full) o vacíos (empty) en una grilla.
 */
import React from 'react';

export interface PixelProgressBarProps {
    /** 0..100 — el componente clamp internamente. */
    value:   number;
    /** Cantidad total de bloques. Default 10. Mínimo 4, máximo 20. */
    blocks?: number;
    /** Etiqueta accesible (obligatoria). Ej: "Nivel de lectura". */
    label:   string;
    /** Si true, oculta visualmente el label (sigue visible para SR). */
    hideLabel?: boolean;
    /** Tono de los bloques llenos. Default 'primary'. */
    tone?:   'primary' | 'success' | 'warning';
    className?: string;
}

const TONE_FILLED: Record<NonNullable<PixelProgressBarProps['tone']>, string> = {
    primary: 'bg-indigo-700  border-indigo-900',
    success: 'bg-emerald-700 border-emerald-900',
    warning: 'bg-amber-700   border-amber-900',
};

const EMPTY_BLOCK = 'bg-gray-100 border-gray-400';

export function PixelProgressBar({
    value,
    blocks: blocksProp = 10,
    label,
    hideLabel = false,
    tone = 'primary',
    className = '',
}: PixelProgressBarProps) {
    // Clamp inputs.
    const blocks = Math.max(4, Math.min(20, Math.floor(blocksProp)));
    const pct    = Math.max(0, Math.min(100, value));
    // Bloques llenos: redondeo "más cercano" para que 50% en 10 bloques sean 5,
    // no 4 ni 6. Math.round es predecible para los usuarios.
    const filledCount = Math.round((pct / 100) * blocks);

    const filledClasses = TONE_FILLED[tone];

    return (
        <div className={`w-full ${className}`}>
            {/* Label visible (a menos que se pida ocultar) */}
            {!hideLabel && (
                <div className="flex items-baseline justify-between mb-2">
                    <span className="text-base font-bold text-gray-900">{label}</span>
                    <span className="text-base font-mono font-bold text-gray-900 tabular-nums">{Math.round(pct)}%</span>
                </div>
            )}
            {/* Barra: grid de bloques */}
            <div
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                aria-valuetext={`${filledCount} de ${blocks} bloques completados`}
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${blocks}, minmax(0, 1fr))` }}
            >
                {Array.from({ length: blocks }, (_, i) => (
                    <div
                        key={i}
                        aria-hidden="true"
                        className={[
                            'h-6 border-2 rounded-sm',
                            i < filledCount ? filledClasses : EMPTY_BLOCK,
                        ].join(' ')}
                    />
                ))}
            </div>
            {/* Texto alternativo accesible — visible para SR aunque hideLabel sea true */}
            <span className="sr-only">{label}: {Math.round(pct)} por ciento, {filledCount} de {blocks} bloques.</span>
        </div>
    );
}
