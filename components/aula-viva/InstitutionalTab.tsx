/**
 * InstitutionalTab.tsx — PASO 7.
 *
 * Sección "Institucional" de pages/AulaVivaOperacional.tsx. Compone:
 *   - InstitutionalLearningCard list (global learnings)
 *   - ComparativeStrategiesPanel (sin ranking docente)
 *   - CohortDefinitionsList con CohortTrajectorySVG por cohort
 *   - FollowupQueue (intervenciones overdue)
 *
 * Cada sección colapsable (default expanded la primera).
 * EmptyState honesto en cada sección.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Lightbulb, Users, Activity, Clock } from 'lucide-react';
import {
    aulaVivaInstitutionalService,
    type InstitutionalStatus, type InstitutionalLearning,
    type ComparativeStrategies, type CohortDefinition,
} from '../../services/aulaVivaInstitutionalService';
import { EmptyState } from './EmptyState';
import { InstitutionalLearningCard } from './InstitutionalLearningCard';
import { OutcomeDistributionBars } from './OutcomeDistributionBars';
import { CohortTrajectorySVG } from './CohortTrajectorySVG';

const Section: React.FC<{
    title: string; icon: React.ElementType;
    defaultExpanded?: boolean; subtitle?: string; children: React.ReactNode;
}> = ({ title, icon: Icon, defaultExpanded = false, subtitle, children }) => {
    const [open, setOpen] = useState(defaultExpanded);
    return (
        <section className="bg-white rounded-lg border border-gray-200 mb-4 overflow-hidden">
            <button type="button" onClick={() => setOpen(!open)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 text-gray-500"/>
                    <span className="font-medium text-gray-900 text-sm">{title}</span>
                    {subtitle && <span className="text-xs text-gray-500">· {subtitle}</span>}
                </div>
                {open ? <ChevronUp className="w-4 h-4 text-gray-400"/>
                      : <ChevronDown className="w-4 h-4 text-gray-400"/>}
            </button>
            {open && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
        </section>
    );
};

export const InstitutionalTab: React.FC = () => {
    const [status, setStatus] = useState<InstitutionalStatus | null>(null);
    const [learnings, setLearnings] = useState<InstitutionalLearning[]>([]);
    const [comparative, setComparative] = useState<ComparativeStrategies | null>(null);
    const [cohorts, setCohorts] = useState<CohortDefinition[]>([]);
    const [followup, setFollowup] = useState<Array<any>>([]);
    const [trajCohort, setTrajCohort] = useState<CohortDefinition | null>(null);
    const [trajSeries, setTrajSeries] = useState<Array<any>>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        const [s, l, c, cd, fq] = await Promise.all([
            aulaVivaInstitutionalService.getStatus(),
            aulaVivaInstitutionalService.getLearningsGlobal(),
            aulaVivaInstitutionalService.getComparativeStrategies(),
            aulaVivaInstitutionalService.getCohortDefinitions(),
            aulaVivaInstitutionalService.getFollowupQueue(),
        ]);
        setStatus(s); setLearnings(l); setComparative(c);
        setCohorts(cd); setFollowup(fq);
        setLoading(false);
    }, []);

    const openTrajectory = useCallback(async (cohort: CohortDefinition) => {
        setTrajCohort(cohort);
        const r = await aulaVivaInstitutionalService.getCohortTrajectory(cohort.cohort_id);
        setTrajSeries(r.series || []);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    if (loading) {
        return <div className="p-6 text-sm text-gray-500 animate-pulse">Cargando vista institucional…</div>;
    }

    return (
        <div className="max-w-5xl mx-auto">
            {/* KPIs institucionales mínimos */}
            <section className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <KpiBox label="Outcomes" value={status?.outcomes?.total ?? 0}/>
                <KpiBox label="Cohortes activas" value={status?.cohorts?.total_active ?? 0}/>
                <KpiBox label="Trayectorias" value={status?.trajectories?.total ?? 0}/>
                <KpiBox label="Aprendizajes" value={status?.learnings?.total_active ?? 0}/>
                <KpiBox label="Patrones" value={status?.patterns?.total_active ?? 0}/>
            </section>

            {/* Aprendizajes institucionales (default expanded — lo más útil) */}
            <Section title="Aprendizajes institucionales" icon={Lightbulb} defaultExpanded
                     subtitle={`${learnings.length} activos`}>
                {learnings.length === 0 ? (
                    <EmptyState kind="no_recommendations" where="institutional_learnings"
                                title="Sin aprendizajes registrados"
                                body="Los aprendizajes aparecen cuando hay suficiente historia de intervenciones (mínimo 5 outcomes por estrategia)."/>
                ) : (
                    <div className="space-y-3 mt-3">
                        {learnings.map(l => (
                            <InstitutionalLearningCard key={l.learning_id} learning={l}/>
                        ))}
                    </div>
                )}
            </Section>

            {/* Comparative intelligence */}
            <Section title="Comparativa de estrategias observada" icon={Activity}
                     subtitle="sin causalidad, solo observación">
                {!comparative || comparative.strategies.length === 0 ? (
                    <EmptyState kind="no_recommendations" where="comparative_strategies"
                                title="Sin comparativa disponible aún"
                                body="La comparativa de estrategias requiere outcomes registrados."/>
                ) : (
                    <div className="mt-3">
                        <p className="text-xs text-gray-500 mb-3 italic">{comparative.caveat}</p>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[10px] uppercase text-gray-500">
                                    <th className="py-1">Estrategia</th>
                                    <th className="py-1">Casos</th>
                                    <th className="py-1">Distribución</th>
                                </tr>
                            </thead>
                            <tbody>
                                {comparative.strategies.map(s => (
                                    <tr key={s.intervention_type} className="border-t border-gray-100">
                                        <td className="py-2 pr-2 font-medium text-gray-900 align-top">
                                            {s.intervention_type.replace(/_/g, ' ')}
                                        </td>
                                        <td className="py-2 pr-2 tabular-nums align-top text-gray-700">
                                            {s.total}
                                            {s.total < 5 && (
                                                <span className="ml-1 text-[10px] text-amber-600">
                                                    (muestra pequeña)
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2">
                                            <OutcomeDistributionBars distribution={s} width={280} showInsufficient={false}/>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            {/* Cohortes + trayectorias */}
            <Section title="Cohortes y trayectorias" icon={Users}
                     subtitle={`${cohorts.length} cohortes activas`}>
                {cohorts.length === 0 ? (
                    <EmptyState kind="snapshots_pending" where="cohort_definitions"
                                title="Sin cohortes construidas todavía"
                                body="Activa AULA_VIVA_COHORT_BUILDER_ENABLED y espera al próximo ciclo del scheduler."/>
                ) : (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1 max-h-72 overflow-y-auto pr-2">
                            {cohorts.slice(0, 50).map(c => (
                                <button key={c.cohort_id} type="button"
                                        onClick={() => openTrajectory(c)}
                                        className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100
                                                    ${trajCohort?.cohort_id === c.cohort_id ? 'bg-blue-50' : ''}`}>
                                    <span className="font-medium text-gray-900">{c.cohort_key}</span>
                                </button>
                            ))}
                        </div>
                        <div className="p-3 rounded border border-gray-100 bg-gray-50/50 min-h-[120px]">
                            {!trajCohort ? (
                                <p className="text-xs text-gray-500 italic">
                                    Selecciona una cohorte para ver su trayectoria.
                                </p>
                            ) : trajSeries.length === 0 ? (
                                <EmptyState kind="snapshots_pending" where="cohort_trajectory_empty"
                                            title={`Sin serie temporal para ${trajCohort.cohort_key}`}
                                            body="Active AULA_VIVA_TRAJECTORY_ENABLED y espere al próximo ciclo."/>
                            ) : (
                                <>
                                    <h4 className="text-xs font-medium text-gray-700 mb-2">
                                        {trajCohort.cohort_key} · {trajSeries.length} puntos
                                    </h4>
                                    <CohortTrajectorySVG series={trajSeries} metric="engagement_score"
                                                          label="engagement score" color="#3B82F6"/>
                                    <CohortTrajectorySVG series={trajSeries} metric="continuidad_semanal"
                                                          label="continuidad semanal" color="#10B981"/>
                                    <CohortTrajectorySVG series={trajSeries} metric="abandono_risk"
                                                          label="riesgo abandono" color="#EF4444"/>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </Section>

            {/* Seguimiento pendiente */}
            <Section title="Seguimiento de intervenciones pendiente" icon={Clock}
                     subtitle={`${followup.length} con follow-up vencido`}>
                {followup.length === 0 ? (
                    <EmptyState kind="no_recommendations" where="followup_queue"
                                title="Sin seguimiento pendiente"
                                body="Las intervenciones con ventana de follow-up cumplida ya tienen outcome calculado."/>
                ) : (
                    <ul className="mt-3 divide-y divide-gray-100">
                        {followup.slice(0, 20).map((f: any) => (
                            <li key={f.intervention_id} className="py-2 flex items-center justify-between text-sm">
                                <div>
                                    <span className="font-medium text-gray-900">{f.student_id}</span>
                                    <span className="text-gray-500"> · {f.intervention_type.replace(/_/g, ' ')}</span>
                                </div>
                                <span className="text-xs text-amber-700">
                                    vencido hace {f.days_overdue} día{f.days_overdue !== 1 ? 's' : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
};

const KpiBox: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
    <div className="rounded border border-gray-100 bg-white px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
        <div className="text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
);
