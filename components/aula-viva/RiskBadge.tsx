import React from 'react';

/**
 * RiskBadge — etiqueta visual de severidad pedagógica.
 * Vocabulario observacional (PASO 3 audit §5):
 *   critical → "Atención urgente"
 *   high     → "Atención prioritaria"
 *   moderate → "Seguimiento sugerido"
 *   info     → "Información"
 * Colores Tailwind seguros (sin lib gráfica).
 */
export type Severity = 'critical' | 'high' | 'moderate' | 'info';

const COLORS: Record<Severity, { bg: string; fg: string; ring: string; label: string }> = {
    critical: { bg: 'bg-rose-100',  fg: 'text-rose-800',  ring: 'ring-rose-200',  label: 'Atención urgente' },
    high:     { bg: 'bg-orange-100',fg: 'text-orange-800',ring: 'ring-orange-200',label: 'Atención prioritaria' },
    moderate: { bg: 'bg-amber-100', fg: 'text-amber-800', ring: 'ring-amber-200', label: 'Seguimiento sugerido' },
    info:     { bg: 'bg-sky-100',   fg: 'text-sky-800',   ring: 'ring-sky-200',   label: 'Información' },
};

export const RiskBadge: React.FC<{
    severity: Severity | null;
    compact?: boolean;
}> = ({ severity, compact = false }) => {
    if (!severity) return null;
    const c = COLORS[severity];
    return (
        <span className={`inline-flex items-center gap-1 rounded-full ${c.bg} ${c.fg} ring-1 ${c.ring} ${
            compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
        } font-medium`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
                severity === 'critical' ? 'bg-rose-500' :
                severity === 'high'     ? 'bg-orange-500' :
                severity === 'moderate' ? 'bg-amber-500' :
                                          'bg-sky-500'
            }`} aria-hidden/>
            {c.label}
        </span>
    );
};
