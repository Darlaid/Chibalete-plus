/**
 * GroupAnalyticsKpis.tsx — CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1B).
 *
 * KPIs, competencias PISA y evolución del grupo en Aula Viva, alimentados SOLO
 * por GET /api/groups/:id/analytics-summary (nunca por pedagogicalStats).
 * Un cero real se muestra como 0; lo que no tiene fuente de servidor (tareas,
 * PISA, evolución) se muestra como estado vacío explícito, nunca como 0 %.
 */
import React from 'react';
import { describeAccessWithdrawn, describeInstitutionalError, describeActivityCoverage, describeActivityBasis, SESSION_HISTORY_CAPPED_NOTE, type ActivityDataCoverage, type ActivityBasisInfo } from '../../utils/institutionalErrors';
import { MessageCircle, CheckCircle, Clock, BrainCircuit, TrendingUp } from 'lucide-react';
import {
    EMPTY_TEXT, GROUP_ANALYTICS_ERROR, formatLeoAverage, formatReadingDuration, hasNoServerSource,
    type GroupAnalyticsState,
} from '../../utils/groupAnalytics.mjs';

const CARD = 'bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-between';
const PANEL = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700';

const Kpi: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode; loading: boolean; children: React.ReactNode }> =
    ({ title, subtitle, icon, loading, children }) => (
        <div className={CARD} aria-busy={loading || undefined}>
            <div>
                <p className="text-sm text-gray-500 font-bold uppercase mb-1">{title}</p>
                {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
            </div>
            <div className="flex items-end justify-between mt-2">
                {loading ? <p className="text-3xl font-bold text-gray-300" aria-label="Cargando">…</p> : children}
                {icon}
            </div>
        </div>
    );

const EmptyValue: React.FC<{ text: string }> = ({ text }) => (
    <p className="text-sm font-semibold text-gray-500 dark:text-gray-400" data-empty-state="no_server_source">{text}</p>
);

/** Fila de 4 KPIs del grupo. */
export const GroupAnalyticsKpis: React.FC<{ state: GroupAnalyticsState }> = ({ state }) => {
    if (state.status === 'error') {
        return (
            <div role="alert" className="mb-8 p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 text-sm font-medium text-red-700 dark:text-red-300">
                {state.withdrawn ? describeAccessWithdrawn('course', state.httpStatus)
                    : state.httpStatus === 401 || state.httpStatus === 403 || state.httpStatus === 503 ? describeInstitutionalError('course', state.httpStatus)
                    : GROUP_ANALYTICS_ERROR}
            </div>
        );
    }
    const loading = state.status === 'loading';
    const s = state.status === 'ready' ? state.summary : null;
    // V9 F7-C2R-U3B — cuántos lectores tienen lectura que no puede atribuirse al curso (no entra en estas cifras).
    const attribution = (s as { courseAttribution?: { readers_with_unverifiable_history?: number; course_has_works?: boolean } } | null)?.courseAttribution;
    const unattributed = attribution?.readers_with_unverifiable_history ?? 0;
    // V9 65E-B — desde cuándo es completa la actividad contada, y cuántos lectores tienen un total que es un mínimo.
    const coverage = describeActivityCoverage((s as { dataCoverage?: ActivityDataCoverage } | null)?.dataCoverage);
    const rawComputedAt = (s as { computedAt?: number | null } | null)?.computedAt;
    const computedAt = typeof rawComputedAt === 'number' && Number.isFinite(rawComputedAt) ? rawComputedAt : null;
    const capped = s ? s.readers.filter(r => (r as { sessionHistoryCapped?: boolean }).sessionHistoryCapped === true).length : 0;
    return (
        <>
        {describeActivityBasis(s as ActivityBasisInfo | null) && <p role="note" data-testid="group-activity-basis" className="mb-3 text-sm text-gray-600 dark:text-gray-300">{describeActivityBasis(s as ActivityBasisInfo | null)}</p>}
        {coverage && <p role="note" data-testid="group-data-coverage" className="mb-3 text-sm text-gray-600 dark:text-gray-300">{coverage}</p>}
        {capped > 0 && (
            <p role="note" data-testid="group-session-history-capped" className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                El tiempo de lectura de {capped} {capped === 1 ? 'lector es' : 'lectores es'} un mínimo: {SESSION_HISTORY_CAPPED_NOTE}.
            </p>
        )}
        {attribution?.course_has_works === false && (
            <p role="note" data-testid="group-no-course-works" className="mb-3 text-sm text-gray-600 dark:text-gray-300">Este curso no tiene obras asociadas: no hay lectura del curso que mostrar. Las cifras en cero no significan que sus estudiantes no lean.</p>
        )}
        {unattributed > 0 && (
            <p role="note" data-testid="group-unverifiable-history" className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                {unattributed} {unattributed === 1 ? 'lector tiene' : 'lectores tienen'} lectura de obras del curso que no puede atribuirse al curso (empezó antes de la asignación, del ingreso al curso o del registro de esas fechas, o la fecha de lectura no pudo verificarse). Esa lectura no entra en estas cifras y no significa que no hayan leído.
            </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-8 animate-in fade-in">
            <Kpi title="Interacción Chatbot" subtitle="Promedio interacciones/alumno" loading={loading}
                icon={<MessageCircle className="text-blue-400 mb-1" size={28} />}>
                <p className="text-3xl font-bold">{s ? formatLeoAverage(s.leo.averageInteractionsPerReader) : ''}</p>
            </Kpi>
            <Kpi title="Cumplimiento Tareas" subtitle="Tasa de entrega efectiva" loading={loading}
                icon={<CheckCircle className="text-green-400 mb-1" size={28} />}>
                {s && hasNoServerSource(s.tasks) ? <EmptyValue text={EMPTY_TEXT.tasks} /> : <EmptyValue text="—" />}
            </Kpi>
            <Kpi title="Tiempo de Lectura" subtitle="Promedio total acumulado" loading={loading}
                icon={<Clock className="text-purple-400 mb-1" size={28} />}>
                <p className="text-3xl font-bold">{s ? formatReadingDuration(s.reading.all.averageEffectiveMsPerReader) : ''}</p>
            </Kpi>
            <Kpi title="Distribución PISA" loading={loading}>
                {s && hasNoServerSource(s.pisa) ? <EmptyValue text={EMPTY_TEXT.pisa} /> : <EmptyValue text="—" />}
            </Kpi>
        </div>
        {/* V9 65E-C — el resumen se conserva hasta 5 minutos: se dice cuándo se calculó, para que una lectura recién
            hecha que todavía no aparece aquí (y sí en el tablero del curso) no se lea como una contradicción. */}
        {computedAt !== null && (
            <p role="note" data-testid="group-computed-at" className="-mt-5 mb-8 text-xs text-gray-500 dark:text-gray-400">
                Cifras calculadas a las {new Date(computedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}. Se actualizan como máximo cada 5 minutos; la lectura más reciente puede tardar ese tiempo en aparecer aquí.
            </p>
        )}
        </>
    );
};

/** Bloque «Competencias PISA & Saber Pro»: sin fuente → un único estado neutral. */
export const GroupPisaCompetencies: React.FC<{ state: GroupAnalyticsState }> = ({ state }) => (
    <div className={PANEL}>
        <h3 className="text-lg font-bold flex items-center mb-6 text-indigo-800 dark:text-indigo-400">
            <BrainCircuit className="mr-2" /> Competencias PISA & Saber Pro (Promedio Grupo)
        </h3>
        {state.status === 'loading' && <p className="text-sm text-gray-400" aria-busy="true">Cargando…</p>}
        {state.status === 'error' && <p className="text-sm text-gray-500">{GROUP_ANALYTICS_ERROR}</p>}
        {state.status === 'ready' && (
            <p className="text-sm text-gray-500 dark:text-gray-400" data-empty-state="no_server_source">{EMPTY_TEXT.pisaCompetencies}</p>
        )}
    </div>
);

/** Evolución histórica: no hay serie de servidor todavía → estado vacío. */
export const GroupEvolutionPanel: React.FC = () => (
    <div className={PANEL}>
        <h3 className="text-lg font-bold flex items-center mb-4"><TrendingUp className="mr-2 text-indigo-500" /> Evolución Histórica del Desempeño</h3>
        <p className="text-xs text-gray-400" data-empty-state="no_server_source">{EMPTY_TEXT.evolution}</p>
    </div>
);
