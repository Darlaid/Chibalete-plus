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
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthorizationRevalidation } from '../../hooks/useAuthorizationRevalidation';
import { ChevronDown, ChevronUp, Lightbulb, Users, Activity, Clock } from 'lucide-react';
import {
    aulaVivaInstitutionalService,
    type InstitutionalStatus, type InstitutionalLearning,
    type ComparativeStrategies, type CohortDefinition, type CollectiveMeta, type ObservedPatterns,
} from '../../services/aulaVivaInstitutionalService';
import { dataService } from '../../services/dataService';
import { cohortLabel, ruleLabel, describeCollectiveState, describeSuppressed } from '../../utils/pedagogicalStates';
import { fetchMetaOf, describeFetchFailure, type FetchMeta } from '../../services/aulaVivaOperationalService';
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
    const [trajMeta, setTrajMeta] = useState<FetchMeta>({});
    // V9 F7-C2R-U3D — estado y población de la trayectoria abierta, y patrones observados.
    const [trajInfo, setTrajInfo] = useState<CollectiveMeta>({});
    const [patterns, setPatterns] = useState<ObservedPatterns>({ patterns: [] });
    const [loading, setLoading] = useState(true);

    // V9 BI-65C — solo la consulta más reciente pinta (una respuesta tardía, de otra cohorte o anterior a un rechazo
    // ya detectado, se descarta).
    const refreshSeq = useRef(0);
    const trajSeq = useRef(0);
    const refresh = useCallback(async () => {
        const turn = ++refreshSeq.current;
        const [s, l, c, cd, fq, pt] = await Promise.all([
            aulaVivaInstitutionalService.getStatus(),
            aulaVivaInstitutionalService.getLearningsGlobal(),
            aulaVivaInstitutionalService.getComparativeStrategies(),
            aulaVivaInstitutionalService.getCohortDefinitions(),
            aulaVivaInstitutionalService.getFollowupQueue(),
            aulaVivaInstitutionalService.getPatternsRecent(),
        ]);
        if (turn !== refreshSeq.current) return;
        setStatus(s); setLearnings(l); setComparative(c);
        setCohorts(cd); setFollowup(fq); setPatterns(pt);
        setLoading(false);
    }, []);

    const openTrajectory = useCallback(async (cohort: CohortDefinition, mode?: unknown) => {
        const turn = ++trajSeq.current;
        // Al abrir OTRA cohorte no queda en pantalla la serie de la anterior mientras llega la nueva.
        if (mode !== 'silent') { setTrajSeries([]); setTrajMeta({}); setTrajInfo({}); }
        setTrajCohort(cohort);
        const r = await aulaVivaInstitutionalService.getCohortTrajectory(cohort.cohort_id);
        if (turn !== trajSeq.current) return;
        setTrajSeries(r.series || []);
        setTrajMeta(fetchMetaOf(r));
        setTrajInfo(r);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);
    // La pestaña abierta vuelve a preguntar al servidor (foco, visibilidad, reconexión e intervalo). Lo que ya no
    // autoriza llega como consulta fallida y deja de mostrarse; el servicio no sirve copias ante un rechazo.
    useAuthorizationRevalidation(() => { refresh(); if (trajCohort) openTrajectory(trajCohort, 'silent'); });

    if (loading) {
        return <div className="p-6 text-sm text-gray-500 animate-pulse">Cargando vista institucional…</div>;
    }

    // V9 F5-E2S — una consulta que NO respondió no es «cero aprendizajes» ni «sin seguimiento
    // pendiente». Cada bloque mira cómo llegó su dato antes de decidir qué decir.
    const statusMeta = fetchMetaOf(status), learningsMeta = fetchMetaOf(learnings), comparativeMeta = fetchMetaOf(comparative),
        cohortsMeta = fetchMetaOf(cohorts), followupMeta = fetchMetaOf(followup);
    const cachedMetas = [statusMeta, learningsMeta, comparativeMeta, cohortsMeta, followupMeta].filter(m => m.cached);
    const cachedAgeMin = Math.max(0, ...cachedMetas.map(m => Math.round((m.age_ms ?? 0) / 60000)));
    const kpi = (v: number | undefined) => (statusMeta.failed ? '—' : v ?? 0);
    // V9 F7-C2R-U3D — nombres para docentes y estados de la evidencia colectiva (nunca claves técnicas ni ceros mudos).
    const cohortName = (c: CohortDefinition) => cohortLabel(c, id => dataService.getAllGroups().find(g => g.id === id)?.name);
    const patternsMeta = fetchMetaOf(patterns);
    const trajState = describeCollectiveState(trajInfo.data_state, trajInfo.reason);
    const patternsState = describeCollectiveState(patterns.data_state, patterns.reason);
    const count = (m: FetchMeta, n: number, unit: string) => (m.failed ? 'no se pudo consultar' : `${n} ${unit}`);
    const Failed: React.FC<{ meta: FetchMeta; where: string; what: string; note?: string }> = ({ meta, where, what, note }) => (
        <div className="mt-3">
            <EmptyState kind="custom" where={where} title={`No pudimos consultar ${what}`}
                        body={`${describeFetchFailure(meta, 'Reintentar')}${note ? ` ${note}` : ''}`}>
                <button type="button" onClick={refresh}
                        className="text-sm text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-md border border-blue-200">
                    Reintentar
                </button>
            </EmptyState>
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto">
            {cachedMetas.length > 0 && (
                <p role="status" className="mb-4 px-3 py-2 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-900">
                    Sin respuesta del servidor: se muestran los datos que esta cuenta consultó hace {cachedAgeMin} min. Pueden no estar al día.
                </p>
            )}
            {/* KPIs institucionales mínimos */}
            <section className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <KpiBox label="Outcomes" value={kpi(status?.outcomes?.total)}/>
                <KpiBox label="Cohortes activas" value={kpi(status?.cohorts?.total_active)}/>
                <KpiBox label="Trayectorias" value={kpi(status?.trajectories?.total)}/>
                <KpiBox label="Aprendizajes" value={kpi(status?.learnings?.total_active)}/>
                <KpiBox label="Patrones" value={kpi(status?.patterns?.total_active)}/>
            </section>
            {statusMeta.failed && (
                <p role="status" className="mb-4 -mt-2 text-xs text-amber-700">
                    No se pudieron consultar los totales institucionales. {describeFetchFailure(statusMeta, 'Reintentar')}
                </p>
            )}

            {/* Aprendizajes institucionales (default expanded — lo más útil) */}
            <Section title="Aprendizajes institucionales" icon={Lightbulb} defaultExpanded
                     subtitle={count(learningsMeta, learnings.length, 'activos')}>
                {learningsMeta.failed ? (
                    <Failed meta={learningsMeta} where="institutional_learnings_failed" what="los aprendizajes institucionales"
                            note="Esto no significa que no haya aprendizajes registrados."/>
                ) : learnings.length === 0 ? (
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
                {comparativeMeta.failed ? (
                    <Failed meta={comparativeMeta} where="comparative_strategies_failed" what="la comparativa de estrategias"/>
                ) : !comparative || comparative.strategies.length === 0 ? (
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
                     subtitle={count(cohortsMeta, cohorts.length, 'cohortes consultables')}>
                {cohortsMeta.failed ? (
                    <Failed meta={cohortsMeta} where="cohort_definitions_failed" what="las cohortes"/>
                ) : cohorts.length === 0 ? (
                    <EmptyState kind="snapshots_pending" where="cohort_definitions"
                                title="Sin cohortes construidas todavía"
                                body="Todavía no hay cohortes que consultar. Aparecerán cuando el curso tenga lectores con seguimiento habilitado."/>
                ) : (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1 max-h-72 overflow-y-auto pr-2">
                            {cohorts.slice(0, 50).map(c => (
                                <button key={c.cohort_id} type="button"
                                        onClick={() => openTrajectory(c)}
                                        className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100
                                                    ${trajCohort?.cohort_id === c.cohort_id ? 'bg-blue-50' : ''}`}>
                                    <span className="font-medium text-gray-900">{cohortName(c)}</span>
                                </button>
                            ))}
                        </div>
                        <div className="p-3 rounded border border-gray-100 bg-gray-50/50 min-h-[120px]">
                            {!trajCohort ? (
                                <p className="text-xs text-gray-500 italic">
                                    Selecciona una cohorte para ver su trayectoria.
                                </p>
                            ) : trajMeta.failed ? (
                                <EmptyState kind="custom" where="cohort_trajectory_failed"
                                            title={`No pudimos consultar la trayectoria de «${cohortName(trajCohort)}»`}
                                            body={describeFetchFailure(trajMeta, 'Reintentar')}/>
                            ) : trajState ? (
                                <div role="status" data-testid="trajectory-state" data-state={trajState.kind}>
                                    <p className="text-sm font-semibold text-gray-900">{trajState.title}</p>
                                    <p className="mt-1 text-sm text-gray-600">{trajState.body}</p>
                                </div>
                            ) : trajInfo.suppressed || (trajSeries.length === 0 && (trajInfo.suppressed_points ?? 0) > 0) ? (
                                <div role="status" data-testid="trajectory-suppressed">
                                    <p className="text-sm font-semibold text-gray-900">Sin trayectoria que mostrar para «{cohortName(trajCohort)}»</p>
                                    <p className="mt-1 text-sm text-gray-600">{describeSuppressed(trajInfo.minCohort ?? trajInfo.min_cohort ?? 5, trajInfo.suppressed ? trajInfo.population?.members : undefined)}</p>
                                </div>
                            ) : trajSeries.length === 0 ? (
                                <EmptyState kind="snapshots_pending" where="cohort_trajectory_empty"
                                            title={`Sin serie temporal para «${cohortName(trajCohort)}»`}
                                            body="Todavía no hay cortes con indicadores para esta cohorte."/>
                            ) : (
                                <>
                                    <h4 className="text-xs font-medium text-gray-700 mb-2">
                                        {cohortName(trajCohort)} · {trajSeries.length} {trajSeries.length === 1 ? 'corte semanal' : 'cortes semanales'}
                                    </h4>
                                    {trajInfo.population && (
                                        <p data-testid="trajectory-population" className="text-xs text-gray-600 mb-2">
                                            {trajInfo.population.members ?? trajInfo.population.eligible} {(trajInfo.population.members ?? trajInfo.population.eligible) === 1 ? 'lector' : 'lectores'} en la cohorte, de {trajInfo.population.eligible} con seguimiento habilitado ({trajInfo.population.roster} en la nómina). Último corte: promedio de {trajSeries[0]?.sample_size} lectores con indicadores.
                                            {(trajInfo.suppressed_points ?? 0) > 0 && ` ${trajInfo.suppressed_points} ${trajInfo.suppressed_points === 1 ? 'corte no se muestra' : 'cortes no se muestran'} por tener menos de ${trajInfo.min_cohort ?? 5} lectores.`}
                                        </p>
                                    )}
                                    {/* V9 F7-C2R-U3D — valores del último corte, legibles aunque solo haya un punto. */}
                                    {trajSeries[0] && (
                                        <table className="w-full text-xs mb-3" data-testid="trajectory-latest">
                                            <caption className="text-left text-[10px] uppercase text-gray-500 mb-1">Último corte (promedio de la cohorte)</caption>
                                            <tbody>
                                                {([['continuidad_semanal', 'Continuidad semanal'], ['engagement_score', 'Compromiso lector'], ['abandono_risk', 'Señal de abandono']] as const).map(([k, label]) => {
                                                    const v = trajSeries[0].metrics?.[k], t = trajSeries[0].trend?.[k];
                                                    return (
                                                        <tr key={k} className="border-t border-gray-100">
                                                            <th scope="row" className="py-1 pr-2 font-normal text-left text-gray-700">{label}</th>
                                                            <td className="py-1 pr-2 tabular-nums">{typeof v === 'number' ? `${Math.round(v * 100)} %` : 'sin dato'}</td>
                                                            <td className="py-1 text-gray-500">{t === 'up' ? 'sube frente al corte anterior' : t === 'down' ? 'baja frente al corte anterior' : t === 'flat' ? 'estable' : 'sin corte anterior comparable'}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
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

            {/* V9 F7-C2R-U3D — patrones observados (recuento de señales, no predicción sobre ningún lector) */}
            <Section title="Patrones observados" icon={Activity}
                     subtitle={count(patternsMeta, patterns.patterns.length, patterns.patterns.length === 1 ? 'patrón' : 'patrones')}>
                {patternsMeta.failed ? (
                    <Failed meta={patternsMeta} where="observed_patterns_failed" what="los patrones observados"
                            note="Esto no significa que no haya patrones."/>
                ) : patternsState ? (
                    <div role="status" data-testid="patterns-state" data-state={patternsState.kind} className="mt-3">
                        <p className="text-sm font-semibold text-gray-900">{patternsState.title}</p>
                        <p className="mt-1 text-sm text-gray-600">{patternsState.body}</p>
                    </div>
                ) : (
                    <div className="mt-3" data-testid="observed-patterns">
                        <p className="text-xs text-gray-500 mb-3 italic">
                            Cuenta cuántas veces se observó cada señal en {patterns.context ? 'tus cursos' : 'la plataforma'}{patterns.weeks ? ` durante las últimas ${patterns.weeks} semanas` : ''}. Es una observación agregada: no predice nada sobre ningún lector.
                            {patterns.population && ` Población: ${patterns.population.eligible} ${patterns.population.eligible === 1 ? 'lector' : 'lectores'} con seguimiento habilitado, de ${patterns.population.roster} en la nómina.`}
                        </p>
                        {patterns.patterns.length === 0 ? (
                            <p role="status" data-testid="patterns-empty" className="text-sm text-gray-600">
                                {(patterns.withheld_below_support ?? 0) > 0
                                    ? `Se han observado señales, pero ninguna reúne todavía el mínimo para mostrarse como patrón (al menos ${patterns.min_support ?? 5} observaciones de ${patterns.min_cohort ?? 5} lectores distintos).`
                                    : 'No se han observado señales repetidas en el período.'}
                            </p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[10px] uppercase text-gray-500">
                                        <th scope="col" className="py-1">Señal observada</th><th scope="col" className="py-1">Veces</th>
                                        <th scope="col" className="py-1">Lectores</th><th scope="col" className="py-1">Solidez de la evidencia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {patterns.patterns.map(p => (
                                        <tr key={p.pattern_id} className="border-t border-gray-100">
                                            <th scope="row" className="py-2 pr-2 font-medium text-gray-900 text-left">{ruleLabel(p.observed_outcome)}</th>
                                            <td className="py-2 pr-2 tabular-nums">{p.support_count}</td>
                                            <td className="py-2 pr-2 tabular-nums">{p.readers ?? '—'}</td>
                                            <td className="py-2">{p.confidence >= 0.7 ? 'alta' : p.confidence >= 0.4 ? 'media' : 'baja'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </Section>

            {/* Seguimiento pendiente */}
            <Section title="Seguimiento de intervenciones pendiente" icon={Clock}
                     subtitle={count(followupMeta, followup.length, 'con follow-up vencido')}>
                {followupMeta.failed ? (
                    <Failed meta={followupMeta} where="followup_queue_failed" what="el seguimiento pendiente"
                            note="Esto no significa que no haya intervenciones por seguir."/>
                ) : followup.length === 0 ? (
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
