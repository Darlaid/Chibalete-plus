import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { dataService } from '../services/dataService';
import type { StoreOrder, Group, Bundle } from '../types';
import { BarChart2, ShoppingCart, Users, BookOpen, Package, CheckCircle, Clock, Search, MapPin, Loader2, Brain, TrendingUp, Award, Download, Sparkles, GraduationCap, Scale } from 'lucide-react';

// CHP-EDITORIAL-ROYALTIES V1.4 U5: «Informes» de regalías (carga diferida: solo administración la abre).
const InformesRegalias = lazy(() => import('../components/admin/InformesRegalias'));

const AdminDashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'reports' | 'sales' | 'grupos' | 'informes'>('reports');
    const [orders, setOrders] = useState<StoreOrder[]>([]);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 8;

    // Analytics State
    const [selectedSchool, setSelectedSchool] = useState<string>('Global'); // 'Global' or specific school name
    const [schools, setSchools] = useState<string[]>([]);
    const [schoolStats, setSchoolStats] = useState<any>(null);
    const [contentInsights, setContentInsights] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Grupos State
    const [allGroups, setAllGroups] = useState<Group[]>([]);
    const [allBundles, setAllBundles] = useState<Bundle[]>([]);
    const [groupFilter, setGroupFilter] = useState<'all' | 'with' | 'without'>('all');

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            await new Promise(resolve => setTimeout(resolve, 50)); // Sim delay
            setOrders(dataService.getStoreOrders());
            setSchools(dataService.getColegios());
            setAllGroups(dataService.getAllGroups());
            setAllBundles(dataService.getBundles());
            setIsLoading(false);
        };
        loadData();
    }, []);

    // V9 65E-C: ya no se calculan aquí «estadísticas del colegio» (eran estimaciones y valores al azar; ver la pestaña).

    const handleStatusUpdate = (orderId: string, newStatus: StoreOrder['status']) => {
        dataService.updateOrderStatus(orderId, newStatus);
        setOrders([...dataService.getStoreOrders()]);
    };

    const totalSales = useMemo(() => orders.reduce((acc, o) => acc + o.total, 0), [orders]);
    const pendingOrders = useMemo(() => orders.filter(o => o.status === 'pendiente').length, [orders]);

    const bundleMap = useMemo(() => {
        const m: Record<string, Bundle> = {};
        allBundles.forEach(b => { m[b.id] = b; });
        return m;
    }, [allBundles]);

    const groupsWithExp = useMemo(() => allGroups.filter(g => !!g.activeExperienceId).length, [allGroups]);
    const groupsWithout = useMemo(() => allGroups.filter(g => !g.activeExperienceId).length, [allGroups]);

    const filteredGroups = useMemo(() => {
        if (groupFilter === 'with') return allGroups.filter(g => !!g.activeExperienceId);
        if (groupFilter === 'without') return allGroups.filter(g => !g.activeExperienceId);
        return allGroups;
    }, [allGroups, groupFilter]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
                <Loader2 size={40} className="animate-spin text-indigo-600" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Panel de Administración Global</h1>
                <div className="flex gap-2">
                    <button className="px-4 py-2 bg-indigo-50 dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-bold flex items-center hover:bg-indigo-100">
                        <Download size={16} className="mr-2" /> Exportar Informe
                    </button>
                </div>
            </div>

            {/* Tab Nav */}
            <div className="flex space-x-6 overflow-x-auto whitespace-nowrap border-b border-gray-200 dark:border-gray-700 mb-8">
                <button
                    onClick={() => setActiveTab('reports')}
                    className={`pb-4 px-2 font-bold flex items-center border-b-2 transition-colors ${activeTab === 'reports' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <BarChart2 className="mr-2" /> Impacto & Inteligencia
                </button>
                <button
                    onClick={() => setActiveTab('sales')}
                    className={`pb-4 px-2 font-bold flex items-center border-b-2 transition-colors ${activeTab === 'sales' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <ShoppingCart className="mr-2" /> Gestión de Ventas
                </button>
                <button
                    onClick={() => setActiveTab('grupos')}
                    className={`pb-4 px-2 font-bold flex items-center border-b-2 transition-colors ${activeTab === 'grupos' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <GraduationCap className="mr-2" /> Estado de Grupos
                </button>
                <button
                    onClick={() => setActiveTab('informes')}
                    className={`pb-4 px-2 font-bold flex items-center border-b-2 transition-colors ${activeTab === 'informes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <Scale className="mr-2" /> Informes
                </button>
            </div>

            {activeTab === 'informes' && (
                <Suspense fallback={<div className="flex justify-center p-10"><Loader2 size={32} className="animate-spin text-indigo-600" /></div>}>
                    <InformesRegalias />
                </Suspense>
            )}

            {/* V9 65E-C — esta pestaña mostraba cifras sin fuente de datos: puntajes de «objetivos de aprendizaje» generados
                al azar, un tiempo promedio estimado (libros × 2,5 h), «+12 % vs mes anterior», «4/8 objetivos» y un «45 %» de
                interés escritos a mano, y en «Vista Global» los datos del primer colegio. Se retiran: no se presenta ningún
                indicador que el servidor no calcule con actividad registrada. Las cifras reales están en Métricas de lectura. */}
            {activeTab === 'reports' && (
                <div className="animate-in fade-in space-y-6" data-testid="admin-impact-real">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center">
                            <BookOpen className="mr-2 text-indigo-500" /> Indicadores de lectura
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 max-w-2xl">
                            Los indicadores de cada colegio y de cada curso (estudiantes activos, sesiones, tiempo y niveles de lectura) se calculan en el servidor con la actividad registrada de las obras asociadas a cada curso.
                        </p>
                        <a href="#/admin/metricas" data-testid="admin-impact-open-metrics" className="inline-flex items-center mt-4 px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                            <TrendingUp size={16} className="mr-2" /> Abrir métricas de lectura
                        </a>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Colegios</p>
                            <h3 className="text-3xl font-bold mt-1 text-gray-800 dark:text-white">{schools.length}</h3>
                            <p className="text-xs text-gray-400 mt-4">Con grupos registrados</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Cursos y clubes</p>
                            <h3 className="text-3xl font-bold mt-1 text-gray-800 dark:text-white">{allGroups.length}</h3>
                            <p className="text-xs text-gray-400 mt-4">Su estado está en «Estado de Grupos»</p>
                        </div>
                    </div>
                    <p role="note" data-testid="admin-impact-no-source" className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
                        Tasa de adopción, tiempo promedio por estudiante, objetivos de aprendizaje y tendencias de contenido: todavía no tienen una fuente de datos del servidor, así que no se muestran. Aquí no se presentan cifras estimadas.
                    </p>
                </div>
            )}

            {activeTab === 'sales' && (
                <div className="animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm">
                            <p className="text-sm text-gray-500 font-bold uppercase">Ventas Totales</p>
                            <h3 className="text-3xl font-bold mt-2">${totalSales.toFixed(2)}</h3>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm">
                            <p className="text-sm text-gray-500 font-bold uppercase">Pedidos Pendientes</p>
                            <h3 className="text-3xl font-bold mt-2 text-orange-500">{pendingOrders}</h3>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="font-bold text-lg">Gestión de Pedidos</h3>
                        </div>
                        <div className="overflow-x-auto">
                            {orders.length > 0 ? (
                                <>
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-gray-50 dark:bg-gray-700/50 uppercase text-gray-500">
                                            <tr>
                                                <th className="p-4">ID Pedido</th>
                                                <th className="p-4">Cliente</th>
                                                <th className="p-4">Fecha</th>
                                                <th className="p-4">Total</th>
                                                <th className="p-4">Estado</th>
                                                <th className="p-4">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {orders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(order => (
                                                <tr key={order.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                    <td className="p-4 font-mono text-gray-500">#{order.id}</td>
                                                    <td className="p-4">
                                                        <p className="font-bold">{order.userName}</p>
                                                        <p className="text-xs text-gray-500">{order.userEmail}</p>
                                                    </td>
                                                    <td className="p-4">{order.date}</td>
                                                    <td className="p-4 font-bold">${order.total.toFixed(2)}</td>
                                                    <td className="p-4">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase 
                                                            ${order.status === 'pendiente' ? 'bg-orange-100 text-orange-700' :
                                                                order.status === 'enviado' ? 'bg-blue-100 text-blue-700' :
                                                                    order.status === 'entregado' ? 'bg-green-100 text-green-700' : 'bg-gray-200'}`}>
                                                            {order.status}
                                                        </span>
                                                    </td>
                                                    <td className="p-4">
                                                        {order.status === 'pendiente' && (
                                                            <button
                                                                onClick={() => handleStatusUpdate(order.id, 'enviado')}
                                                                className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-bold"
                                                            >
                                                                Marcar Enviado
                                                            </button>
                                                        )}
                                                        {order.status === 'enviado' && (
                                                            <button
                                                                onClick={() => handleStatusUpdate(order.id, 'entregado')}
                                                                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs font-bold"
                                                            >
                                                                Marcar Entregado
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {/* Pagination Controls */}
                                    <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-center items-center gap-4">
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50 text-sm font-medium"
                                        >
                                            Anterior
                                        </button>
                                        <span className="text-sm text-gray-600 dark:text-gray-400">
                                            Página {currentPage} de {Math.ceil(orders.length / itemsPerPage)}
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(orders.length / itemsPerPage), p + 1))}
                                            disabled={currentPage * itemsPerPage >= orders.length}
                                            className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50 text-sm font-medium"
                                        >
                                            Siguiente
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="p-8 text-center text-gray-500">
                                    <Package size={48} className="mx-auto mb-2 opacity-20" />
                                    <p>No hay pedidos registrados.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'grupos' && (
                <div className="animate-in fade-in space-y-6">

                    {/* Summary row */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 text-center">
                            <p className="text-3xl font-bold text-gray-800 dark:text-white">{allGroups.length}</p>
                            <p className="text-xs font-bold uppercase text-gray-400 mt-1">Grupos totales</p>
                        </div>
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-5 border border-indigo-100 dark:border-indigo-800 text-center">
                            <p className="text-3xl font-bold text-indigo-700 dark:text-indigo-300">{groupsWithExp}</p>
                            <p className="text-xs font-bold uppercase text-indigo-500 mt-1 flex items-center justify-center gap-1">
                                <Sparkles size={11} /> Con experiencia activa
                            </p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 text-center">
                            <p className="text-3xl font-bold text-gray-400">{groupsWithout}</p>
                            <p className="text-xs font-bold uppercase text-gray-400 mt-1">Sin experiencia</p>
                        </div>
                    </div>

                    {/* Filter pills */}
                    <div className="flex gap-2">
                        {([
                            { value: 'all', label: 'Todos' },
                            { value: 'with', label: 'Con experiencia' },
                            { value: 'without', label: 'Sin experiencia' },
                        ] as const).map(f => (
                            <button
                                key={f.value}
                                onClick={() => setGroupFilter(f.value)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${groupFilter === f.value
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {/* Groups list */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                        {filteredGroups.length === 0 ? (
                            <div className="p-10 text-center text-gray-400">
                                <GraduationCap size={36} className="mx-auto mb-2 opacity-30" />
                                <p className="text-sm">No hay grupos que coincidan con el filtro.</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs uppercase text-gray-500 border-b border-gray-100 dark:border-gray-700">
                                    <tr>
                                        <th className="px-5 py-3">Tipo</th>
                                        <th className="px-5 py-3">Nombre</th>
                                        <th className="px-5 py-3">Colegio</th>
                                        <th className="px-5 py-3 text-center">Miembros</th>
                                        <th className="px-5 py-3">Experiencia activa</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredGroups.map(g => {
                                        const memberCount = Array.isArray(g.memberIds) ? g.memberIds.length
                                            : Array.isArray(g.studentIds) ? g.studentIds.length : 0;
                                        const exp = g.activeExperienceId ? bundleMap[g.activeExperienceId] : null;
                                        return (
                                            <tr key={g.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                                                <td className="px-5 py-3 text-lg">
                                                    {g.type === 'club' ? '🎪' : '🏫'}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <p className="font-bold text-gray-800 dark:text-gray-200">{g.name}</p>
                                                    {g.grade && <p className="text-xs text-gray-400">{g.grade}</p>}
                                                </td>
                                                <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">
                                                    {g.school || g.organizationId || '—'}
                                                </td>
                                                <td className="px-5 py-3 text-center font-bold text-gray-700 dark:text-gray-300">
                                                    {memberCount}
                                                </td>
                                                <td className="px-5 py-3">
                                                    {exp ? (
                                                        <div>
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                                                <Sparkles size={10} /> {exp.name}
                                                            </span>
                                                            {exp.shortDescription && (
                                                                <p className="text-xs text-gray-400 mt-0.5">{exp.shortDescription}</p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-gray-400 italic">Sin experiencia</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
