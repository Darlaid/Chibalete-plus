import React from 'react';
import { Lightbulb, Info } from 'lucide-react';
import { OutcomeDistributionBars } from './OutcomeDistributionBars';
import type { InstitutionalLearning } from '../../services/aulaVivaInstitutionalService';

/**
 * InstitutionalLearningCard — PASO 7 §9.
 *
 * Renderiza un aprendizaje institucional con:
 *   - recommendation_hint observacional (sin causalidad)
 *   - distribución de outcomes (OutcomeDistributionBars)
 *   - support_count + confidence + evidence level visible
 *   - tag scope (all/global, school:X, group:Y)
 *
 * NO black-box. NO ranking. Solo evidencia honesta.
 */
export const InstitutionalLearningCard: React.FC<{
    learning: InstitutionalLearning;
}> = ({ learning }) => {
    const conf = typeof learning.confidence === 'number' ? learning.confidence : 0;
    const support = learning.evidence?.support_count ?? 0;
    const intervention = learning.evidence?.intervention_type;
    const evidenceLevel =
        conf >= 0.7 ? 'alta' : conf >= 0.4 ? 'media' : 'baja';
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 mt-1 text-amber-500 shrink-0"/>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                            {learning.scope_type}:{learning.scope_id}
                        </span>
                        {intervention && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                                {intervention.replace(/_/g, ' ')}
                            </span>
                        )}
                        <span className="text-[10px] text-gray-500">
                            n = {support}
                        </span>
                        <span className="text-[10px] text-gray-500">
                            evidencia {evidenceLevel}
                        </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-800 leading-snug">
                        {learning.recommendation_hint}
                    </p>
                </div>
            </div>

            {/* Distribución de outcomes (lo que sustenta el hint) */}
            {learning.evidence?.outcome_distribution && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                    <OutcomeDistributionBars
                        distribution={learning.evidence.outcome_distribution}
                        width={320}
                    />
                </div>
            )}

            {/* Confidence bar honesta — "fuerza de la señal observacional" */}
            <div className="mt-3 flex items-center gap-2">
                <Info className="w-3 h-3 text-gray-400 shrink-0"/>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    Fuerza observacional
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"
                     role="progressbar" aria-valuenow={Math.round(conf*100)}
                     aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-gray-500" style={{ width: `${Math.round(conf*100)}%` }}/>
                </div>
                <span className="text-[10px] tabular-nums text-gray-600">
                    {Math.round(conf*100)}%
                </span>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
                Observado, no causal. Refleja patrones registrados; no afirma efectos garantizados.
            </p>
        </div>
    );
};
