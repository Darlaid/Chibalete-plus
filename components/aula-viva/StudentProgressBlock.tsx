/**
 * StudentProgressBlock.tsx — CHP-V8-UNIFIED-XP-01.
 *
 * Progreso individual de la persona seleccionada en Aula Viva, para su mediador:
 * XP acumulado, nivel, obras reconocidas y logros. Solo lectura, sin panel nuevo:
 * vive junto al panel del estudiante. Sin rankings ni comparaciones. Si la
 * consulta no existe (XP apagado, fuera de alcance o fuera del grupo), no pinta
 * nada. Nada se guarda en el navegador.
 */
import React, { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { dataService } from '../../services/dataService';
import { classifyStudentProgress } from '../../utils/studentProgressView.mjs';

type State =
    | { kind: 'loading' }
    | { kind: 'hidden' }
    | { kind: 'unavailable' }
    | { kind: 'ok'; view: { xp: number; levelName: string; recognizedWorks: number; achievements: string[] } };

const CARD = 'bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700';

export const StudentProgressBlock: React.FC<{ groupId: string; studentId: string }> = ({ groupId, studentId }) => {
    const [state, setState] = useState<State>({ kind: 'loading' });

    useEffect(() => {
        let cancelled = false;
        setState({ kind: 'loading' });
        dataService.getStudentProgress(groupId, studentId).then(({ status, body }) => {
            if (!cancelled) setState(classifyStudentProgress(status, body) as State);
        });
        return () => { cancelled = true; };
    }, [groupId, studentId]);

    if (state.kind === 'hidden') return null;
    return (
        <section aria-labelledby="av-progreso-individual" aria-busy={state.kind === 'loading'} className={CARD}>
            <div className="flex items-center gap-2">
                <span aria-hidden className="text-indigo-700 dark:text-indigo-300"><Award size={20} /></span>
                <h3 id="av-progreso-individual" className="text-sm font-bold text-gray-800 dark:text-gray-100">Progreso de lectura</h3>
            </div>
            {state.kind === 'loading' && <p className="mt-2 text-sm text-gray-700 dark:text-gray-200" role="status">Cargando progreso…</p>}
            {state.kind === 'unavailable' && <p className="mt-2 text-sm text-gray-700 dark:text-gray-200" role="status">No pudimos cargar el progreso. Inténtalo más tarde.</p>}
            {state.kind === 'ok' && (
                <>
                    <dl className="mt-3 grid grid-cols-3 gap-3">
                        <div>
                            <dt className="text-xs text-gray-600 dark:text-gray-300">XP acumulado</dt>
                            <dd className="text-2xl font-bold text-gray-900 dark:text-white">{state.view.xp}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-gray-600 dark:text-gray-300">Nivel</dt>
                            <dd className="text-lg font-bold text-gray-900 dark:text-white">{state.view.levelName}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-gray-600 dark:text-gray-300">Obras reconocidas</dt>
                            <dd className="text-2xl font-bold text-gray-900 dark:text-white">{state.view.recognizedWorks}</dd>
                        </div>
                    </dl>
                    <h4 className="mt-4 text-xs font-bold text-gray-700 dark:text-gray-200">Logros</h4>
                    {state.view.achievements.length === 0
                        ? <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Todavía sin logros.</p>
                        : (
                            <ul className="mt-1 list-disc list-inside text-sm text-gray-800 dark:text-gray-100">
                                {state.view.achievements.map((t) => <li key={t}>{t}</li>)}
                            </ul>
                        )}
                    <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">Solo lo reconocido a esta persona. Sin comparaciones con el grupo.</p>
                </>
            )}
        </section>
    );
};
