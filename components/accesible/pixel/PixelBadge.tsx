/**
 * PixelBadge — Sprint Modo accesible (experiencia).
 *
 * Insignia pixel: forma cuadrada, borde duro, sombra de stamp pequeña.
 * Versión visual de los badges tonales actuales (Aula Viva / StudentStatus)
 * adaptada al lenguaje pixel.
 *
 * Reglas: contraste AA en todas las variantes, sin animaciones.
 */
import React from 'react';

export type PixelBadgeTone = 'ok' | 'warning' | 'error' | 'neutral';

const TONE_STYLES: Record<PixelBadgeTone, { bg: string; text: string; border: string; shadow: string }> = {
    ok:      { bg: 'bg-emerald-700', text: 'text-white', border: 'border-emerald-900',
               shadow: 'shadow-[2px_2px_0_0_rgb(6,78,59)]' },
    warning: { bg: 'bg-amber-700',   text: 'text-white', border: 'border-amber-900',
               shadow: 'shadow-[2px_2px_0_0_rgb(120,53,15)]' },
    error:   { bg: 'bg-rose-700',    text: 'text-white', border: 'border-rose-900',
               shadow: 'shadow-[2px_2px_0_0_rgb(136,19,55)]' },
    neutral: { bg: 'bg-gray-800',    text: 'text-white', border: 'border-black',
               shadow: 'shadow-[2px_2px_0_0_rgb(0,0,0)]' },
};

export interface PixelBadgeProps {
    tone?:      PixelBadgeTone;
    children:   React.ReactNode;
    className?: string;
}

export function PixelBadge({ tone = 'neutral', children, className = '' }: PixelBadgeProps) {
    const s = TONE_STYLES[tone];
    return (
        <span
            className={[
                'inline-flex items-center px-3 py-1 text-sm font-bold uppercase tracking-wide',
                'border-2 rounded-sm select-none',
                s.bg, s.text, s.border, s.shadow,
                className,
            ].filter(Boolean).join(' ')}
        >
            {children}
        </span>
    );
}
