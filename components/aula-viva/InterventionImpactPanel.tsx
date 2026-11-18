/**
 * InterventionImpactPanel.tsx — V9 F7-C2R-U3C.
 *
 * Evaluación de impacto de las intervenciones registradas, de UN lector (`scope.type === 'user'`) o de UN curso
 * (`'group'`), tal como la calcula el servidor con la actividad fechada del curso
 * (`GET /api/aula-viva/institutional/outcomes/scope/:type/:id`). Tres estados que nunca se mezclan:
 *   - en seguimiento (`pending`): la ventana posterior no ha terminado; no hay comparación;
 *   - evidencia insuficiente: no hubo actividad comparable antes y después; no se afirma nada;
 *   - resultado calculado: se muestran los valores anterior y posterior que entrega el servidor.
 * El panel no calcula resultados ni rellena valores ausentes.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { describeInstitutionalError, describeNoEligibleReaders } from '../../utils/institutionalErrors';
import { InstitutionalLearningCard } from './InstitutionalLearningCard';
import type { InstitutionalLearning } from '../../services/aulaVivaInstitutionalService';
import {
    impactStateOf, describeImpactState, outcomeLabel, interventionLabel, formatImpactValue, IMPACT_METRICS, type ImpactRow,
} from '../../utils/pedagogicalStates';

interface StrategyRow { intervention_type: string; total: number; pending: number; insufficient: number; evaluated: number; improved: number; stable: number; worsened: number; mixed: number; sufficient: boolean }
interface ImpactBody {
    total_outcomes: number; pending: number; distribution: Record<string, number>; outcomes: ImpactRow[];
    by_type?: StrategyRow[]; min_support?: number; population?: { roster: number; eligible: number };
}
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; body: ImpactBody };

const date = (ms: number) => new Date(ms).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const BADGE: Record<string, string> = {
    pending: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    insufficient: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    calculated: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
};
const BADGE_TEXT: Record<string, string> = { pending: 'En seguimiento', insufficient: 'Evidencia insuficiente', calculated: 'Resultado calculado' };

export const InterventionImpactPanel: React.FC<{
    scope: { type: 'user' | 'group'; id: string };
    /** Nombre del lector por id (solo en la vista de curso). */
    nameOf?: (userId: string) => string | undefined;
}> = ({ scope, nameOf }) => {
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const isGroup = scope.type === 'group';
    // V9 F7-C2R-U3D — aprendizajes del curso (recomendación de grupo): solo en la vista de curso. null = no se pudo consultar.
    const [learnings, setLearnings] = useState<InstitutionalLearning[] | null>([]);

    const refresh = useCallback(async () => {
        setLoad({ status: 'loading' });
        try {
            const r = await fetch(`/api/aula-viva/institutional/outcomes/scope/${scope.type}/${encodeURIComponent(scope.id)}`, { cache: 'no-store' });
            let body: any = null;
            try { body = await r.json(); } catch { /* cuerpo vacío */ }
            if (!r.ok || !body || !Array.isArray(body.outcomes)) {
                return setLoad({ status: 'error', message: describeInstitutionalError(isGroup ? 'course' : 'reader', r.status, body?.error) });
            }
            setLoad({ status: 'ready', body });
            if (isGroup) {
                try {
                    const l = await fetch(`/api/aula-viva/institutional/learnings/scope/group/${encodeURIComponent(scope.id)}`, { cache: 'no-store' });
                    const list = l.ok ? await l.json() : null;
                    setLearnings(Array.isArray(list) ? list : null);
                } catch { setLearnings(null); }
            }
        } catch {
            setLoad({ status: 'error', message: 'No hubo respuesta del servidor. Revisa la conexión e inténtalo de nuevo.' });
        }
    }, [scope.type, scope.id, isGroup]);
    useEffect(() => { refresh(); }, [refresh]);

    const titleId = `impact-title-${scope.type}`;
    return (
        <section aria-labelledby={titleId} data-testid={`impact-panel-${scope.type}`}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 border border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 id={titleId} className="text-base font-bold flex items-center gap-2">
                        <Activity size={16} className="text-indigo-500" aria-hidden="true" />
                        {isGroup ? 'Impacto de las intervenciones del curso' : 'Impacto de las intervenciones'}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Compara la actividad del curso en los 14 días anteriores y los 14 posteriores a cada intervención. Es una observación, no prueba de causa.
                    </p>
                </div>
                <button type="button" onClick={refresh} aria-label="Actualizar el impacto de las intervenciones"
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <RefreshCw size={14} aria-hidden="true" />
                </button>
            </div>

            {load.status === 'loading' && <p role="status" className="mt-3 text-sm text-gray-500">Consultando el impacto…</p>}
            {load.status === 'error' && <p role="alert" data-testid="impact-error" className="mt-3 text-sm text-red-700 dark:text-red-300">{load.message}</p>}

            {load.status === 'ready' && (() => {
                const b = load.body;
                const rows = b.outcomes;
                const calculated = rows.filter(r => impactStateOf(r) === 'calculated').length;
                const insufficient = rows.filter(r => impactStateOf(r) === 'insufficient').length;
                // Curso sin lectores con seguimiento habilitado para esta cuenta: no es «sin intervenciones».
                if (isGroup && b.population && b.population.eligible === 0) {
                    const none = describeNoEligibleReaders(b.population.roster);
                    return (
                        <div role="status" data-testid="impact-no-eligible" className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
                            <p className="text-sm font-semibold">{none.title}</p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{none.roster} {none.body}</p>
                        </div>
                    );
                }
                return (
                    <div>
                        {isGroup && b.population && (
                            <p data-testid="impact-population" className="mt-3 text-sm text-gray-700 dark:text-gray-200">
                                Población evaluada: {b.population.eligible} {b.population.eligible === 1 ? 'lector' : 'lectores'} con seguimiento habilitado, de {b.population.roster} en la nómina del curso.
                            </p>
                        )}
                        {rows.length === 0
                            ? (
                                <p role="status" data-testid="impact-empty" className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                                    {isGroup ? 'No hay intervenciones registradas para los lectores de este curso.' : 'No hay intervenciones registradas para este lector.'} El impacto se evalúa a partir de las intervenciones que registres.
                                </p>
                            )
                            : (
                                <p role="status" data-testid="impact-summary" className="mt-3 text-sm text-gray-700 dark:text-gray-200">
                                    {rows.length} {rows.length === 1 ? 'intervención registrada' : 'intervenciones registradas'}: {calculated} con resultado calculado, {b.pending} en seguimiento y {insufficient} con evidencia insuficiente.
                                    {calculated > 0 && ` Resultados calculados: ${(['improved', 'stable', 'worsened', 'mixed'] as const).filter(k => (b.distribution[k] ?? 0) > 0).map(k => `${outcomeLabel(k).toLowerCase()}, ${b.distribution[k]}`).join('; ')}.`}
                                </p>
                            )}

                        {isGroup && (b.by_type ?? []).length > 0 && (
                            <div className="mt-4 overflow-x-auto">
                                <table className="w-full text-sm" data-testid="impact-by-strategy">
                                    <caption className="text-left text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Resultados por estrategia</caption>
                                    <thead>
                                        <tr className="text-left text-xs text-gray-500">
                                            <th scope="col" className="py-1 pr-3">Estrategia</th><th scope="col" className="py-1 pr-3">Registradas</th>
                                            <th scope="col" className="py-1 pr-3">Evaluadas</th><th scope="col" className="py-1">Resultado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {b.by_type!.map(t => (
                                            <tr key={t.intervention_type} className="border-t border-gray-100 dark:border-gray-700">
                                                <th scope="row" className="py-1 pr-3 font-medium text-left">{interventionLabel(t.intervention_type)}</th>
                                                <td className="py-1 pr-3">{t.total}</td>
                                                <td className="py-1 pr-3">{t.evaluated}</td>
                                                <td className="py-1">
                                                    {t.sufficient
                                                        ? `${t.improved} mejoró, ${t.stable} se mantuvo, ${t.worsened} empeoró, ${t.mixed} mixto`
                                                        : `Evidencia insuficiente (se necesitan al menos ${b.min_support ?? 5} evaluadas)`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {isGroup && (
                            <div className="mt-4" data-testid="course-learnings">
                                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Aprendizajes del curso</h4>
                                {learnings === null
                                    ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">No se pudieron consultar los aprendizajes del curso. Inténtalo de nuevo con «Actualizar».</p>
                                    : learnings.length === 0
                                        ? <p role="status" className="text-sm text-gray-600 dark:text-gray-300">Todavía no hay aprendizajes: una estrategia genera una indicación cuando reúne al menos {b.min_support ?? 5} intervenciones en el curso. No significa que las estrategias no funcionen.</p>
                                        : <div className="space-y-2">{learnings.map(l => <InstitutionalLearningCard key={l.learning_id} learning={l} />)}</div>}
                            </div>
                        )}

                        {rows.length > 0 && (
                            <ul className="mt-4 space-y-3" data-testid="impact-rows">
                                {rows.map(r => {
                                    const st = impactStateOf(r);
                                    return (
                                        <li key={r.outcome_id} data-state={st} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-semibold">{interventionLabel(r.intervention_type)}</span>
                                                <span className="text-xs text-gray-500">{date(r.created_at)}{isGroup ? ` · ${nameOf?.(r.user_id) ?? 'Lector del curso'}` : ''}</span>
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BADGE[st]}`}>{BADGE_TEXT[st]}{st === 'calculated' ? `: ${outcomeLabel(r.outcome_label).toLowerCase()}` : ''}</span>
                                            </div>
                                            {st !== 'calculated' && <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{describeImpactState(r, date)}</p>}
                                            {st === 'calculated' && r.baseline_metrics && r.followup_metrics && (
                                                <table className="mt-2 w-full text-sm" data-testid="impact-metrics">
                                                    <caption className="sr-only">Valores antes y después de la intervención</caption>
                                                    <thead>
                                                        <tr className="text-left text-xs text-gray-500">
                                                            <th scope="col" className="py-1 pr-3">Indicador</th><th scope="col" className="py-1 pr-3">Antes</th><th scope="col" className="py-1">Después</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {IMPACT_METRICS.map(m => (
                                                            <tr key={m.key} className="border-t border-gray-100 dark:border-gray-700">
                                                                <th scope="row" className="py-1 pr-3 font-normal text-left">{m.label}</th>
                                                                <td className="py-1 pr-3 tabular-nums">{formatImpactValue(r.baseline_metrics![m.key], m.unit)}</td>
                                                                <td className="py-1 tabular-nums">{formatImpactValue(r.followup_metrics![m.key], m.unit)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                );
            })()}
        </section>
    );
};
