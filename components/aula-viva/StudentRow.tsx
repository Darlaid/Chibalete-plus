import React from 'react';
import { User } from '../../types';
import { MessageCircle, ChevronRight } from 'lucide-react';
import { EMPTY_TEXT, formatReadingDuration, type ReaderAnalytics } from '../../utils/groupAnalytics.mjs';

interface StudentRowProps {
    student: User;
    /**
     * CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1B): detalle del lector salido
     * de GET /api/groups/:id/analytics-summary (readers[], unido por userId).
     * undefined mientras carga / si falló: se muestra «—», nunca un 0 inventado.
     */
    analytics?: ReaderAnalytics;
    onSelect: () => void;
}

const NoData: React.FC<{ title: string }> = ({ title }) => (
    <span className="text-gray-400" title={title} aria-label={title}>—</span>
);

export const StudentRow: React.FC<StudentRowProps> = React.memo(({ student, analytics, onSelect }) => {
    return (
        <tr className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group" onClick={onSelect}>
            <td className="p-4 flex items-center">
                <img src={student.avatar_url} alt={student.nombre_usuario} className="w-8 h-8 rounded-full mr-3" />
                <span className="font-medium group-hover:text-indigo-600 transition-colors">{student.nombre_completo}</span>
            </td>
            <td className="p-4 text-center">
                {analytics ? analytics.progress.booksStarted : <NoData title="Sin datos" />}
            </td>
            <td className="p-4 text-center font-mono text-sm">
                {analytics ? formatReadingDuration(analytics.reading.allEffectiveMs) : <NoData title="Sin datos" />}
            </td>
            <td className="p-4 text-center">
                <div className="flex items-center justify-center gap-1" title="Interacciones con Chatbot">
                    <MessageCircle size={14} className="text-blue-500" />
                    <span className="font-bold text-sm text-gray-700 dark:text-gray-300">
                        {analytics ? analytics.leo.interactions : <NoData title="Sin datos" />}
                    </span>
                </div>
            </td>
            <td className="p-4 text-center">
                <NoData title={EMPTY_TEXT.tasks} />
            </td>
            <td className="p-4 text-right">
                <span className="hidden md:inline"><NoData title={EMPTY_TEXT.pisa} /></span>
                <button className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors relative group/btn">
                    <div className="absolute inset-0 bg-indigo-100 rounded-full scale-0 group-hover/btn:scale-100 transition-transform"></div>
                    <span className="relative z-10 hidden md:inline text-xs font-bold text-indigo-600 mr-2 opacity-0 group-hover/btn:opacity-100 transition-opacity">Ver Detalle</span>
                    <ChevronRight size={18} className="text-gray-400 group-hover/btn:text-indigo-600 relative z-10" />
                </button>
            </td>
        </tr>
    );
});
