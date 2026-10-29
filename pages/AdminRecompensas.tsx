import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { JournalEntry } from '../types';
import { Gift, Clock, Search, AlertCircle } from 'lucide-react';

const AdminRecompensas: React.FC = () => {
    const { user } = useAuth();
    const [requests, setRequests] = useState<JournalEntry[]>([]);
    const [filter, setFilter] = useState<'submitted' | 'approved' | 'rejected'>('submitted');

    useEffect(() => {
        loadRequests();
    }, [filter]);

    const loadRequests = () => {
        setRequests(dataService.getRewardRequests(filter));
    };

    if (!user || !user.roles.includes('administrador')) {
        return <div className="p-8 text-center text-red-500">Acceso restringido a administradores.</div>;
    }

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
            <header className="mb-8">
                <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                    <Gift className="mr-3" size={32} /> Gestión de Recompensas
                </h1>
                <p className="text-gray-500 dark:text-gray-400">Historial de solicitudes guardadas en este navegador (solo lectura).</p>
                {/* G0: el canje era simulado (nunca emitía cupones); sin aprobar ni rechazar. */}
                <p role="status" className="mt-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                    El canje de Puntos de Magia no está habilitado: estas solicitudes no generan descuentos ni se pueden aprobar. Las recompensas estarán disponibles cuando el sistema esté habilitado.
                </p>
            </header>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                    {(['submitted', 'approved', 'rejected'] as const).map(status => (
                        <button
                            key={status}
                            onClick={() => setFilter(status)}
                            className={`flex-1 py-4 text-center font-bold capitalize transition-colors ${filter === status
                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-500'
                                    : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                        >
                            {status === 'submitted' ? 'Pendientes' : status === 'approved' ? 'Aprobados' : 'Rechazados'}
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {requests.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <Clock size={48} className="mx-auto mb-4 opacity-50" />
                            <p>No hay solicitudes en estado "{filter === 'submitted' ? 'pendiente' : filter}".</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-100 dark:bg-gray-700 text-sm uppercase text-gray-500 font-bold">
                                    <tr>
                                        <th className="p-4">Fecha</th>
                                        <th className="p-4">Estudiante</th>
                                        <th className="p-4">Recompensa Solicitada</th>
                                        <th className="p-4">Puntos</th>
                                        <th className="p-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {requests.map(req => {
                                        // Try to find user name 
                                        const reqUser = dataService.getUsuarioById(req.userId);
                                        const userName = reqUser ? reqUser.nombre_completo : req.userId;

                                        // Extract points cost from content string if possible, or display generic
                                        const costMatch = req.content.match(/Costo: (\d+)/);
                                        const points = costMatch ? costMatch[1] : '???';

                                        return (
                                            <tr key={req.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                                <td className="p-4 text-sm text-gray-500 whitespace-nowrap">
                                                    {new Date(req.date).toLocaleDateString()}
                                                </td>
                                                <td className="p-4 font-bold">
                                                    {userName}
                                                </td>
                                                <td className="p-4">
                                                    {req.title}
                                                    <div className="text-xs text-gray-400 mt-1 line-clamp-1">{req.content}</div>
                                                </td>
                                                <td className="p-4 text-indigo-600 font-bold">
                                                    {points} pts
                                                </td>
                                                <td className="p-4 text-right">
                                                    {filter === 'submitted' ? (
                                                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                                            Histórico · sin acción
                                                        </span>
                                                    ) : (
                                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${filter === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                            {filter === 'approved' ? 'Aprobado' : 'Rechazado'}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminRecompensas;
