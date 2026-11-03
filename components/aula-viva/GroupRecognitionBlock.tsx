/**
 * GroupRecognitionBlock.tsx — CHP-GAMIFICACION-G4-UX-U4.
 *
 * «Reconocimiento en el grupo» en Aula Viva: tres conteos del servidor
 * (GET /api/groups/:id/analytics-summary → `recognition`). Indicador pedagógico
 * (entregas por revisar) separado del reconocimiento del ledger y del catálogo.
 * Sin nombres, XP, niveles, rankings ni comparaciones. Sin el campo
 * (gamificación o XP apagados) no se pinta nada. Nada se guarda en el navegador.
 */
import React from 'react';
import { Inbox, Award, BookOpen } from 'lucide-react';
import type { GroupAnalyticsState } from '../../utils/groupAnalytics.mjs';
import { buildGroupRecognitionView } from '../../utils/groupRecognition.mjs';

const CARD = 'bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700';

const Item: React.FC<{ icon: React.ReactNode; title: string; value: number | null; text: string; children?: React.ReactNode }> =
    ({ icon, title, value, text, children }) => (
        <div className={CARD}>
            <div className="flex items-center gap-2">
                <span aria-hidden className="text-indigo-700 dark:text-indigo-300">{icon}</span>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</h3>
            </div>
            {value !== null && <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white" aria-hidden>{value}</p>}
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{text}</p>
            {children}
        </div>
    );

export const GroupRecognitionBlock: React.FC<{ state: GroupAnalyticsState; onReview?: () => void }> = ({ state, onReview }) => {
    if (state.status !== 'ready') return null;
    const view = buildGroupRecognitionView((state.summary as { recognition?: unknown }).recognition);
    if (!view) return null;
    return (
        <section aria-labelledby="av-reconocimiento" className="mb-8">
            <h2 id="av-reconocimiento" className="text-lg font-bold text-gray-900 dark:text-white mb-1">Reconocimiento en el grupo</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">Datos del grupo en conjunto. No se muestran XP, niveles ni datos de cada estudiante.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6">
                <Item icon={<Inbox size={20} />} title="Por revisar" value={view.pending.value} text={view.pending.text}>
                    {(view.pending.value ?? 0) > 0 && onReview && (
                        <button type="button" onClick={onReview} className="mt-3 inline-flex items-center min-h-[44px] px-4 rounded-lg border border-indigo-700 text-indigo-800 dark:text-indigo-200 dark:border-indigo-300 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/30 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400">
                            Ir a Producciones
                        </button>
                    )}
                </Item>
                <Item icon={<Award size={20} />} title="Reconocimiento" value={view.recognized.value} text={view.recognized.text} />
                <Item icon={<BookOpen size={20} />} title="Obras con experiencias" value={view.eligible.value} text={view.eligible.text} />
            </div>
        </section>
    );
};
