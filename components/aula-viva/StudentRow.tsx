import React from 'react';
import { User, PedagogicalStats } from '../../types';
import { MessageCircle, ChevronRight, BarChart2 } from 'lucide-react';

interface StudentRowProps {
    student: User;
    stats?: PedagogicalStats;
    onSelect: () => void;
}

export const StudentRow: React.FC<StudentRowProps> = React.memo(({ student, stats, onSelect }) => {
    const avgComp = stats ? Math.round((stats.comprension_literal + stats.comprension_inferencial + stats.reflexion_critica) / 3) : 0;

    let statusColor = 'bg-gray-200 text-gray-600';
    if (avgComp >= 80) statusColor = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    else if (avgComp >= 60) statusColor = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    else if (stats) statusColor = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';

    return (
        <tr className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group" onClick={onSelect}>
            <td className="p-4 flex items-center">
                <img src={student.avatar_url} alt={student.nombre_usuario} className="w-8 h-8 rounded-full mr-3" />
                <span className="font-medium group-hover:text-indigo-600 transition-colors">{student.nombre_completo}</span>
            </td>
            <td className="p-4 text-center">{stats?.booksCompleted || 0}</td>
            <td className="p-4 text-center font-mono text-sm">
                <div className="flex flex-col items-center">
                    <span title="Promedio Semanal">{stats?.weeklyReadingTimeMinutes || 0}m/sem</span>
                    <span className="text-[10px] text-gray-400">{stats?.dailyReadingTimeMinutes || 0}m/día</span>
                </div>
            </td>
            <td className="p-4 text-center">
                <div className="flex items-center justify-center gap-1" title="Interacciones con Chatbot">
                    <MessageCircle size={14} className="text-blue-500" />
                    <span className="font-bold text-sm text-gray-700 dark:text-gray-300">{stats?.chatbotInteractions || 0}</span>
                </div>
            </td>
            <td className="p-4 text-center">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${((stats?.taskCompletionRate || 0) > 80) ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                    {stats?.taskCompletionRate || 0}%
                </span>
            </td>
            <td className="p-4 text-right">
                <button className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors relative group/btn">
                    <div className="absolute inset-0 bg-indigo-100 rounded-full scale-0 group-hover/btn:scale-100 transition-transform"></div>
                    <span className="relative z-10 hidden md:inline text-xs font-bold text-indigo-600 mr-2 opacity-0 group-hover/btn:opacity-100 transition-opacity">Ver Detalle</span>
                    <ChevronRight size={18} className="text-gray-400 group-hover/btn:text-indigo-600 relative z-10" />
                </button>
                <div className="flex justify-end gap-2 mt-1 md:hidden">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColor} font-bold`}>
                        {avgComp}% Global
                    </span>
                </div>
            </td>
        </tr>
    );
});
