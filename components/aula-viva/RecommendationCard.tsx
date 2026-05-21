import React, { useState } from 'react';
import { Lightbulb, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { Recommendation } from '../../services/aulaVivaOperationalService';
import { RiskBadge, type Severity } from './RiskBadge';

/**
 * RecommendationCard — PASO 5 §15 explicabilidad visible.
 *
 * Muestra UNA recomendación con:
 *   - severity badge + título
 *   - explicación observacional textual
 *   - reasons (chips)
 *   - signals_used (collapsable, con valores)
 *   - confidence visualizada como barra
 *   - acciones: aceptar / descartar / abrir intervención
 *
 * NO black-box. Cada campo del explanation está accesible.
 */
export interface RecommendationCardProps {
    rec: Recommendation;
    onAccept?: (rec: Recommendation) => void;
    onDismiss?: (rec: Recommendation) => void;
    onIntervene?: (rec: Recommendation) => void;
    disabled?: boolean;
}

const HUMAN_TITLE: Record<string, string> = {
    abandono_alto:            'Patrón de abandono temprano',
    fatiga_lectora:           'Posible fatiga lectora',
    invisibilidad_prolongada: 'Sin actividad lectora reciente',
    alta_autonomia:           'Buen momento para explorar más géneros',
    diversidad_baja:          'Lectura concentrada en pocos contenidos',
    deterioro_continuidad:    'Continuidad semanal descendió',
    mejora_destacada:         'Mejora notable en compromiso lector',
    habito_emergente:         'Hábito de lectura emergente',
};

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
    rec, onAccept, onDismiss, onIntervene, disabled = false,
}) => {
    const [expanded, setExpanded] = useState(false);
    const title = HUMAN_TITLE[rec.rule_id] || rec.rule_id.replace(/_/g, ' ');
    const isStale = Date.now() > rec.expires_at;
    const isHandled = rec.acknowledged > 0;
    const confidencePct = Math.round((rec.confidence || 0) * 100);
    const sev = rec.severity as Severity;

    return (
        <div className={`rounded-lg border p-4 ${isHandled ? 'bg-gray-50 opacity-70' : 'bg-white'}
                          ${isStale ? 'border-dashed border-gray-300' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                    <Lightbulb className="w-4 h-4 mt-1 text-gray-500 shrink-0" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-gray-900 text-sm">{title}</h3>
                            <RiskBadge severity={sev} compact />
                            {isStale && (
                                <span className="text-[10px] text-gray-500 uppercase">
                                    sin actualizar &gt;7d
                                </span>
                            )}
                        </div>
                        <p className="mt-1 text-sm text-gray-700 leading-snug">
                            {rec.explanation?.explanation || '(sin explicación disponible)'}
                        </p>
                    </div>
                </div>
                {!isHandled && (
                    <div className="flex gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => onAccept?.(rec)}
                            disabled={disabled}
                            className="p-1.5 rounded-md hover:bg-green-50 text-green-700 disabled:opacity-50"
                            aria-label="Marcar como vista">
                            <CheckCircle2 className="w-4 h-4"/>
                        </button>
                        <button
                            type="button"
                            onClick={() => onDismiss?.(rec)}
                            disabled={disabled}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 disabled:opacity-50"
                            aria-label="Descartar">
                            <X className="w-4 h-4"/>
                        </button>
                    </div>
                )}
            </div>

            {/* Confidence bar (pedagógicamente honesta: % observación, NO probabilidad) */}
            <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Confianza observación</span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden" role="progressbar"
                     aria-valuenow={confidencePct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-gray-500" style={{ width: `${confidencePct}%` }} />
                </div>
                <span className="text-[10px] tabular-nums text-gray-600">{confidencePct}%</span>
            </div>

            {/* Reasons chips */}
            {rec.explanation?.reasons && rec.explanation.reasons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {rec.explanation.reasons.map(r => (
                        <span key={r} className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-700">
                            {r.replace(/_/g, ' ')}
                        </span>
                    ))}
                </div>
            )}

            {/* Expand: signals_used + meta */}
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="mt-2 text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
                {expanded ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
                {expanded ? 'Ocultar señales' : 'Ver señales usadas'}
            </button>
            {expanded && rec.explanation?.signals_used && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
                    {rec.explanation.signals_used.map(s => (
                        <div key={s.id} className="px-2 py-1 rounded bg-gray-50 border border-gray-100">
                            <span className="text-gray-600">{s.id.replace(/_/g, ' ')}: </span>
                            <span className="font-medium text-gray-900">
                                {typeof s.value === 'number' ? s.value.toFixed(2) : '—'}
                            </span>
                            <span className="text-gray-400 ml-1">({s.confidence})</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Acción de intervención */}
            {!isHandled && onIntervene && (
                <button
                    type="button"
                    onClick={() => onIntervene(rec)}
                    disabled={disabled}
                    className="mt-3 w-full text-sm font-medium text-blue-700 hover:bg-blue-50 rounded-md py-1.5 border border-blue-200 disabled:opacity-50">
                    Registrar intervención
                </button>
            )}

            <div className="mt-2 text-[10px] text-gray-400">
                Calculado {new Date(rec.created_at).toLocaleString()} · rule={rec.rule_id} v{rec.explanation?.rule_version ?? '?'}
            </div>
        </div>
    );
};
