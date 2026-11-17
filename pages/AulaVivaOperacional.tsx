/**
 * AulaVivaOperacional.tsx — PASO 5.
 *
 * Página NUEVA (ruta /aula-viva/operacional) que complementa la existente
 * pages/AulaViva.tsx (intacta). Centro operativo pedagógico longitudinal:
 *
 *   1. DegradedModeBanner (estado del backend)
 *   2. "Estudiantes que necesitan atención hoy" — attention queue ordenada
 *      por severidad y abandono_risk
 *   3. Resumen de recomendaciones activas por severidad
 *   4. Comparativa cohort (global por ahora; group/school cuando el
 *      materializer aprenda scope group — PASO 6)
 *   5. Sparklines de tendencias institucionales (rollups)
 *
 * Filosofía PASO 5: NO reemplaza al docente, organiza/prioriza/visibiliza.
 * SIN comparaciones individuo↔individuo. Vocabulario observacional.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Users, AlertCircle, Sparkles, TrendingUp, Activity, ChevronRight } from 'lucide-react';
import {
    aulaVivaOperationalService, fetchMetaOf, describeFetchFailure,
    type AttentionItem, type OperationalStatus, type CohortComparison,
    type Recommendation, type ProfileTimeline,
} from '../services/aulaVivaOperationalService';
import { DegradedModeBanner } from '../components/aula-viva/DegradedModeBanner';
import { EmptyState } from '../components/aula-viva/EmptyState';
import { RecommendationCard } from '../components/aula-viva/RecommendationCard';
import { RiskBadge, type Severity } from '../components/aula-viva/RiskBadge';
import { Sparkline } from '../components/aula-viva/Sparkline';
// PASO 7 — sección institucional (tab paralelo, no reemplaza nada).
import { InstitutionalTab } from '../components/aula-viva/InstitutionalTab';
import { aulaVivaInstitutionalService } from '../services/aulaVivaInstitutionalService';
// Fase 3B — cableo del timeline longitudinal (creado en Fase 3A).
import { LongitudinalStudentTimeline } from '../components/aula-viva/LongitudinalStudentTimeline';
// CHP-SEC-AUTHZ-AULA-VIVA-AGGREGATE-SCOPE-02 — qué cohorte pide cada principal.
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { isAdmin } from '../utils/permissions';

function formatDays(days: number | null): string {
    if (days == null) return 'sin actividad registrada';
    if (days === 0) return 'hoy';
    if (days === 1) return 'hace 1 día';
    if (days < 7) return `hace ${days} días`;
    if (days < 30) return `hace ${Math.floor(days/7)} semana${days >= 14 ? 's' : ''}`;
    return `hace +${Math.floor(days/30)} mes${days >= 60 ? 'es' : ''}`;
}

type ActiveTab = 'operativo' | 'institucional';

const AulaVivaOperacional: React.FC = () => {
    const [status, setStatus] = useState<OperationalStatus | null>(null);
    const [attention, setAttention] = useState<AttentionItem[]>([]);
    const [cohort, setCohort] = useState<CohortComparison | null>(null);
    const [recs, setRecs] = useState<Recommendation[]>([]);
    const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionBusy, setActionBusy] = useState(false);
    // Fase 3B — timeline longitudinal del estudiante seleccionado.
    const [timeline, setTimeline] = useState<ProfileTimeline | null>(null);
    const [timelineLoading, setTimelineLoading] = useState(false);
    // PASO 7 — tab switcher operativo/institucional.
    const [activeTab, setActiveTab] = useState<ActiveTab>('operativo');
    // V9 F5-E2 — qué cohorte corresponde a quien mira: sin grupos mediados no hay nada que afirmar.
    const [scopeKind, setScopeKind] = useState<'admin' | 'group' | 'none'>('none');

    const { user } = useAuth();

    const refresh = useCallback(async () => {
        // El agregado interinstitucional (all/global) es solo del administrador
        // (el servidor lo deniega al mediador). El mediador ve la cohorte de su
        // grupo: /api/groups ya llega acotado por el servidor y el CIS vuelve a
        // autorizar el grupo al pedirlo. Sin grupo mediado → sin cohorte.
        const mediated = dataService.getAllGroups()
            .filter(g => !!user && (g.mediatorIds ?? []).includes(user.id))
            .map(g => g.id).sort();
        const scope: [string, string] | null = isAdmin(user)
            ? ['all', 'global']
            : (mediated.length ? ['group', mediated[0]] : null);
        const [s, q, c] = await Promise.all([
            aulaVivaOperationalService.getOperationalStatus(),
            aulaVivaOperationalService.getAttentionQueue(),
            scope ? aulaVivaOperationalService.getCohortComparison(scope[0], scope[1]) : Promise.resolve(null),
        ]);
        setStatus(s);
        setAttention(q);
        setCohort(c);
        setScopeKind(isAdmin(user) ? 'admin' : (mediated.length ? 'group' : 'none'));
        setLoading(false);
    }, [user]);

    const refreshRecs = useCallback(async (userId: string) => {
        const r = await aulaVivaOperationalService.getRecommendations('user', userId);
        setRecs(r);
    }, []);

    // Fase 3B — fetch del timeline longitudinal cuando cambia el estudiante.
    // Defensivo: cualquier fallo deja timeline=null y el componente degrada
    // a su EmptyState interno.
    // CHP-WCAG-01C AULAVIVA-02 (4.1.3): anuncio del cambio de lector sin mover el foco.
    const [selectionAnnounce, setSelectionAnnounce] = useState('');
    const refreshTimeline = useCallback(async (userId: string) => {
        setTimelineLoading(true);
        try {
            const t = await aulaVivaOperationalService.getStudentTimeline(userId);
            setTimeline(t);
            setSelectionAnnounce(`Lector ${userId} seleccionado. Recomendaciones y timeline cargados.`);
        } catch {
            setTimeline(null);
            setSelectionAnnounce(`Lector ${userId} seleccionado. No se pudo cargar el timeline.`);
        } finally {
            setTimelineLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);
    useEffect(() => {
        if (selectedStudent) {
            refreshRecs(selectedStudent);
            refreshTimeline(selectedStudent);
        } else {
            setTimeline(null);
        }
    }, [selectedStudent, refreshRecs, refreshTimeline]);

    const handleAccept = useCallback(async (rec: Recommendation) => {
        setActionBusy(true);
        await aulaVivaOperationalService.acknowledgeRecommendation(rec.recommendation_id, false);
        if (selectedStudent) await refreshRecs(selectedStudent);
        await refresh();
        setActionBusy(false);
    }, [selectedStudent, refreshRecs, refresh]);

    const handleDismiss = useCallback(async (rec: Recommendation) => {
        setActionBusy(true);
        await aulaVivaOperationalService.dismissRecommendation(rec.recommendation_id);
        if (selectedStudent) await refreshRecs(selectedStudent);
        await refresh();
        setActionBusy(false);
    }, [selectedStudent, refreshRecs, refresh]);

    const handleIntervene = useCallback(async (rec: Recommendation) => {
        if (!selectedStudent) return;
        const notes = window.prompt('Nota breve sobre la intervención (opcional):') ?? undefined;
        setActionBusy(true);
        await aulaVivaOperationalService.recordIntervention(
            selectedStudent,
            rec.recommendation_type,
            notes,
            rec.recommendation_id,
        );
        await aulaVivaOperationalService.acknowledgeRecommendation(rec.recommendation_id, true);
        if (selectedStudent) await refreshRecs(selectedStudent);
        await refresh();
        setActionBusy(false);
    }, [selectedStudent, refreshRecs, refresh]);

    if (loading) {
        return (
            <div className="p-6">
                <div className="animate-pulse text-sm text-gray-500">Cargando centro operativo…</div>
            </div>
        );
    }

    const recsSummary = status?.recommendations_summary ?? { critical: 0, high: 0, moderate: 0, info: 0 };
    const totalActive = recsSummary.critical + recsSummary.high + recsSummary.moderate + recsSummary.info;

    // V9 F5-E2 — una consulta que NO respondió no es «no hay nada». Antes la lista vacía de relleno
    // se pintaba como «0 · sin lectores en riesgo» y «los patrones se mantienen estables».
    const statusMeta = fetchMetaOf(status), attentionMeta = fetchMetaOf(attention), cohortMeta = fetchMetaOf(cohort), recsMeta = fetchMetaOf(recs);
    // V9 F7-C2R-U2 — un timeline que no respondió (p. ej. la autorización del lector dejó de estar vigente) no es «sin sesiones».
    const timelineMeta = fetchMetaOf(timeline);
    const cachedMetas = [statusMeta, attentionMeta, cohortMeta].filter(m => m.cached);
    const cachedAgeMin = Math.max(0, ...cachedMetas.map(m => Math.round((m.age_ms ?? 0) / 60000)));
    const failureText = (m: Parameters<typeof describeFetchFailure>[0]) => describeFetchFailure(m);
    const materializerReady = !!status?.materializer_ready?.ready && !statusMeta.failed;
    // V9 F7-C2R-U2 — la cola del mediador sale del contexto de sus cursos. Un lector sin indicadores no entra en ella, y
    // eso no significa que «vaya bien»: se dice cuántos están en cada situación.
    const overview = statusMeta.failed ? null : (status?.context_overview ?? null);
    const overviewParts: string[] = overview ? [
        overview.insufficient > 0 ? `${overview.insufficient} con información insuficiente por ahora` : '',
        overview.no_activity > 0 ? `${overview.no_activity} sin actividad en las obras del curso en los últimos 28 días` : '',
        overview.no_course_works > 0 ? `${overview.no_course_works} en cursos sin obras asociadas` : '',
        overview.ok - overview.in_attention > 0 ? `${overview.ok - overview.in_attention} con muy poca lectura del curso para estimar un riesgo` : '',
    ].filter(Boolean) : [];

    // Sparkline de active_users (proxy de continuidad institucional)
    const activeUsersDaily = (cohort?.metrics?.find(m => m.metric_key === 'active_users')?.metric_value);
    const cohortMetricsToShow = cohort?.metrics?.filter(m =>
        ['active_users', 'at_risk_users', 'avg_continuidad', 'profiles_evaluated'].includes(m.metric_key)
    ) ?? [];

    return (
        <div className="min-h-screen bg-gray-50">
            <DegradedModeBanner />

            <div className="max-w-7xl mx-auto px-4 py-6">
                <header className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">Aula Viva — Centro operativo</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Vista pedagógica longitudinal. Los datos provienen de patrones observados,
                            no son evaluaciones cognitivas.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={refresh}
                        className="text-sm text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-md border border-blue-200">
                        Actualizar
                    </button>
                </header>

                {/* PASO 7 — tab switcher operativo / institucional */}
                <div className="mb-6 border-b border-gray-200 flex gap-1" role="tablist" aria-label="Vistas de Aula Viva">
                    <button type="button" role="tab"
                            aria-selected={activeTab === 'operativo'}
                            onClick={() => { setActiveTab('operativo'); aulaVivaInstitutionalService.trackScopeSwitch('operativo'); }}
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition
                                        ${activeTab === 'operativo'
                                          ? 'border-blue-500 text-blue-700'
                                          : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                        Operativo
                    </button>
                    <button type="button" role="tab"
                            aria-selected={activeTab === 'institucional'}
                            onClick={() => { setActiveTab('institucional'); aulaVivaInstitutionalService.trackScopeSwitch('institucional'); }}
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition
                                        ${activeTab === 'institucional'
                                          ? 'border-blue-500 text-blue-700'
                                          : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                        Institucional
                    </button>
                </div>

                {activeTab === 'institucional' ? <InstitutionalTab/> : (<>

                {cachedMetas.length > 0 && (
                    <p role="status" className="mb-4 px-3 py-2 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-900">
                        Sin respuesta del servidor: se muestran los datos que esta cuenta consultó hace {cachedAgeMin} min. Pueden no estar al día.
                    </p>
                )}

                {/* ── Summary KPI cards ────────────────────────────────────────── */}
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    <KpiCard
                        icon={Users} label="Estudiantes en atención" value={attentionMeta.failed ? '—' : attention.length}
                        sublabel={attentionMeta.failed ? 'no se pudo consultar' : attention.length === 0 ? 'ninguno priorizado ahora' : 'priorizado por severidad'}
                    />
                    <KpiCard
                        icon={AlertCircle} label="Recomendaciones activas" value={statusMeta.failed ? '—' : totalActive}
                        sublabel={statusMeta.failed ? 'no se pudo consultar' : `crít ${recsSummary.critical} · alt ${recsSummary.high} · mod ${recsSummary.moderate} · info ${recsSummary.info}`}
                        accent={statusMeta.failed ? null : recsSummary.critical > 0 ? 'critical' : recsSummary.high > 0 ? 'high' : null}
                    />
                    <KpiCard
                        icon={TrendingUp} label="Continuidad promedio"
                        value={cohort?.metrics?.find(m => m.metric_key === 'avg_continuidad')?.metric_value?.toFixed(2) ?? '—'}
                        sublabel="ventana 28d"
                    />
                    <KpiCard
                        icon={Activity} label="Lectores activos"
                        value={typeof activeUsersDaily === 'number' ? Math.round(activeUsersDaily) : '—'}
                        sublabel="profiles materializados"
                    />
                </section>

                {/* ── Two-column: attention queue · selected student recs ──────── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Attention queue */}
                    <section className="bg-white rounded-lg border border-gray-200 p-4">
                        <h2 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <Users className="w-5 h-5 text-gray-500"/>
                            Estudiantes que necesitan atención hoy
                        </h2>
                        {attentionMeta.failed ? (
                            <EmptyState kind="custom" where="attention_queue_failed"
                                title="No pudimos consultar esta lista"
                                body={`${failureText(attentionMeta)} Esto no significa que no haya lectores que necesiten atención.`}
                            />
                        ) : attention.length === 0 && scopeKind === 'none' ? (
                            <EmptyState kind="custom" where="attention_queue_no_groups"
                                title="No tienes grupos asignados como mediador"
                                body="Esta lista se arma con los lectores de los grupos que medias. Si deberías tener un grupo, pide a la administración de tu institución que revise la asignación."
                            />
                        ) : attention.length === 0 && overview && overview.readers === 0 ? (
                            <EmptyState kind="custom" where="attention_queue_no_enabled_readers"
                                title="Sin lectores habilitados para el seguimiento individual"
                                body="El seguimiento individual requiere la autorización vigente de cada lector y tu compromiso de mediación vigente. Consulta con la administración de tu institución. Esto no describe cómo leen."
                            />
                        ) : attention.length === 0 && overview && overviewParts.length > 0 ? (
                            <EmptyState kind="custom" where="attention_queue_context_states"
                                title="Todavía no hay lectores con indicadores del curso"
                                body={`${overview.readers === 1 ? 'Tu único lector habilitado' : `De tus ${overview.readers} lectores habilitados`}: ${overviewParts.join('; ')}. Esto no describe cómo leen.`}
                            />
                        ) : attention.length === 0 && !materializerReady ? (
                            <EmptyState kind="snapshots_pending" where="attention_queue_pending"
                                title="Aún no hay información procesada"
                                body="Todavía no hay señales procesadas para priorizar lectores. Esto no describe cómo van: vuelve a consultar más tarde."
                            />
                        ) : attention.length === 0 ? (
                            <EmptyState kind="no_recommendations" where="attention_queue"
                                title="Sin lectores priorizados ahora"
                                body="No hay estudiantes con riesgo activo o recomendaciones críticas. Los patrones lectores se mantienen estables."
                            />
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {attention.slice(0, 15).map(item => (
                                    <li key={item.user_id}>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedStudent(item.user_id)}
                                            aria-pressed={selectedStudent === item.user_id}
                                            className={`w-full flex items-center justify-between gap-3 px-2 py-3 text-left
                                                        hover:bg-gray-50 rounded ${
                                                          selectedStudent === item.user_id ? 'bg-blue-50' : ''
                                                        }`}>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-gray-900 text-sm truncate">
                                                        {item.user_id}
                                                    </span>
                                                    <RiskBadge severity={item.top_severity as Severity | null} compact/>
                                                </div>
                                                <div className="mt-1 text-xs text-gray-600 flex items-center gap-3 flex-wrap">
                                                    <span>actividad: {formatDays(item.days_since_active)}</span>
                                                    <span>riesgo abandono: {(item.abandono_risk * 100).toFixed(0)}%</span>
                                                    {item.recommendations_count > 0 && (
                                                        <span>{item.recommendations_count} recomendación{item.recommendations_count > 1 ? 'es' : ''}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0"/>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {!attentionMeta.failed && attention.length > 0 && overviewParts.length > 0 && (
                            <p className="mt-3 text-xs text-gray-600" data-testid="attention-context-states">
                                Fuera de esta lista: {overviewParts.join('; ')}. Esto no describe cómo leen.
                            </p>
                        )}
                    </section>

                    {/* Recommendations for selected student */}
                    <section className="bg-white rounded-lg border border-gray-200 p-4">
                        <h2 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-gray-500"/>
                            {selectedStudent ? `Recomendaciones: ${selectedStudent}` : 'Recomendaciones'}
                        </h2>
                        {!selectedStudent ? (
                            <EmptyState kind="custom" where="recommendations_idle"
                                title="Selecciona un lector"
                                body="Elige un estudiante de la lista para ver sus recomendaciones, señales usadas y opciones de intervención."
                            />
                        ) : recsMeta.failed ? (
                            <EmptyState kind="custom" where="recommendations_failed"
                                title="No pudimos consultar las recomendaciones"
                                body={`${failureText(recsMeta)} Esto no significa que este lector no tenga recomendaciones.`}
                            />
                        ) : recs.length === 0 && timeline?.data_state && timeline.data_state !== 'ok' ? (
                            <EmptyState kind="custom" where="recommendations_no_indicators"
                                title="Sin recomendaciones por ahora"
                                body="No hay indicadores del curso para este lector en este momento (el timeline explica por qué). Esto no significa que su lectura sea estable."
                            />
                        ) : recs.length === 0 ? (
                            <EmptyState kind="no_recommendations" where="recommendations_for_student"/>
                        ) : (
                            <div className="space-y-3">
                                {recs.map(r => (
                                    <RecommendationCard
                                        key={r.recommendation_id}
                                        rec={r}
                                        onAccept={handleAccept}
                                        onDismiss={handleDismiss}
                                        onIntervene={handleIntervene}
                                        disabled={actionBusy}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                {/* ── Fase 3B: timeline longitudinal del lector seleccionado ── */}
                <p role="status" aria-live="polite" className="sr-only">{selectionAnnounce}</p>
                {selectedStudent && (
                    <section className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
                        <h2 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-gray-500"/>
                            Timeline longitudinal: {selectedStudent}
                        </h2>
                        {timelineMeta.failed && !timelineLoading ? (
                            <EmptyState kind="custom" where="timeline_failed"
                                title="No pudimos consultar el timeline"
                                body={`${failureText(timelineMeta)} Esto no describe cómo lee este estudiante.`}
                            />
                        ) : (
                        <LongitudinalStudentTimeline
                            data={timeline as any /* shape compatible — service ya incluye summaries */}
                            loading={timelineLoading}
                        />
                        )}
                    </section>
                )}

                {/* ── Cohort comparison ─────────────────────────────────────── */}
                <section className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
                    <h2 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-gray-500"/>
                        Cohort institucional (ventana 28d)
                    </h2>
                    {cohortMeta.failed ? (
                        <EmptyState kind="custom" where="cohort_failed"
                            title="No pudimos consultar el agregado"
                            body={failureText(cohortMeta)}
                        />
                    ) : scopeKind === 'none' ? (
                        <EmptyState kind="custom" where="cohort_no_groups"
                            title="Sin grupo asignado"
                            body="El agregado se muestra para los grupos que medias."
                        />
                    ) : cohortMetricsToShow.length === 0 ? (
                        <EmptyState kind="snapshots_pending" where="cohort_global"/>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {cohortMetricsToShow.map(m => (
                                <div key={m.metric_key} className="p-3 rounded border border-gray-100 bg-gray-50/50">
                                    <div className="text-[10px] uppercase tracking-wide text-gray-500">{m.metric_key.replace(/_/g, ' ')}</div>
                                    <div className="mt-1 text-xl font-semibold text-gray-900 tabular-nums">
                                        {typeof m.metric_value === 'number' ? m.metric_value.toFixed(2) : '—'}
                                    </div>
                                    {typeof m.delta_vs_global === 'number' && m.delta_vs_global !== 0 && (
                                        <div className={`text-xs ${m.delta_vs_global > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            Δ {m.delta_vs_global > 0 ? '+' : ''}{m.delta_vs_global.toFixed(2)} vs global
                                        </div>
                                    )}
                                    <div className="mt-2 text-gray-400">
                                        <Sparkline values={[
                                            typeof m.global_value === 'number' ? m.global_value : 0,
                                            typeof m.metric_value === 'number' ? m.metric_value : 0,
                                        ]} width={80} height={20}/>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* ── System health footnote ────────────────────────────────── */}
                <footer className="mt-6 text-xs text-gray-600 text-center">
                    Estado del sistema:&nbsp;
                    {statusMeta.failed
                        ? <span className="text-amber-600">no se pudo consultar</span>
                        : status?.materializer_ready?.ready
                        ? <span className="text-emerald-700">operacional</span>
                        : <span className="text-amber-600">{status?.materializer_ready?.reason || 'pendiente'}</span>}
                    &nbsp;· última actualización {status?.ts ? new Date(status.ts).toLocaleTimeString() : '—'}
                </footer>

                </>)}  {/* fin fragment del tab "operativo" — PASO 7 wrap */}
            </div>
        </div>
    );
};

const KpiCard: React.FC<{
    icon: React.ElementType;
    label: string;
    value: string | number;
    sublabel?: string;
    accent?: 'critical' | 'high' | null;
}> = ({ icon: Icon, label, value, sublabel, accent }) => {
    const accentClass =
        accent === 'critical' ? 'border-rose-200 bg-rose-50/50' :
        accent === 'high'     ? 'border-orange-200 bg-orange-50/50' :
                                'border-gray-200 bg-white';
    return (
        <div className={`rounded-lg border p-3 ${accentClass}`}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
                <Icon className="w-4 h-4"/> {label}
            </div>
            <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
            {sublabel && <div className="mt-0.5 text-[11px] text-gray-500">{sublabel}</div>}
        </div>
    );
};

export default AulaVivaOperacional;
