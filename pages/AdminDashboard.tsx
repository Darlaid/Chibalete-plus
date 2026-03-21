import React, { useState, useEffect, useMemo } from 'react';
import { dataService } from '../services/dataService';
import type { StoreOrder, Group, Bundle } from '../types';
import { BarChart2, ShoppingCart, Users, BookOpen, Package, CheckCircle, Clock, Search, MapPin, Loader2, Brain, TrendingUp, Award, Download, Sparkles, GraduationCap } from 'lucide-react';

const AdminDashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'reports' | 'sales' | 'grupos'>('reports');
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
            setContentInsights(dataService.getContentInsights());
            setAllGroups(dataService.getAllGroups());
            setAllBundles(dataService.getBundles());
            setIsLoading(false);
        };
        loadData();
    }, []);

    // Effect to update stats when school selection changes
    useEffect(() => {
        if (!isLoading) {
            // If Global, we aggregate (mockly) or pick a representative view
            // For this version, if 'Global', we might just show the first school or an average, 
            // but let's assume getSchoolPerformance allows handling 'Global' in a real backend.
            // Here we'll just sum up if multiple schools exist, or pick the first one for the specific metrics.
            // To keep it simple and robust for the user:
            const targetSchool = selectedSchool === 'Global' && schools.length > 0 ? schools[0] : selectedSchool;

            if (targetSchool && targetSchool !== 'Global') {
                setSchoolStats(dataService.getSchoolPerformance(targetSchool));
            } else if (schools.length > 0) {
                // Default to first school if detailed global aggregation isn't built
                setSchoolStats(dataService.getSchoolPerformance(schools[0]));
            } else {
                // Fallback for no data
                setSchoolStats({
                    adoptionRate: 0, avgHoursPerStudent: 0, totalStudents: 0,
                    learningObjectives: { criticalThinking: 0, autonomy: 0, writing: 0, inference: 0, knowledge: 0, engagement: 0 }
                });
            }
        }
    }, [selectedSchool, schools, isLoading]);

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
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Panel de Administración Global</h1>
                <div className="flex gap-2">
                    <button className="px-4 py-2 bg-indigo-50 dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-bold flex items-center hover:bg-indigo-100">
                        <Download size={16} className="mr-2" /> Exportar Informe
                    </button>
                </div>
            </div>

            {/* Tab Nav */}
            <div className="flex space-x-6 border-b border-gray-200 dark:border-gray-700 mb-8">
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
            </div>

            {activeTab === 'reports' && (
                <div className="animate-in fade-in space-y-8">

                    {/* CONTEXT SELECTOR */}
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                        <MapPin className="text-gray-400" />
                        <span className="font-bold text-gray-700 dark:text-gray-200">Contexto:</span>
                        <select
                            value={selectedSchool}
                            onChange={(e) => setSelectedSchool(e.target.value)}
                            className="bg-gray-50 dark:bg-gray-700 border-none rounded-lg p-2 font-medium focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="Global">Vista Global (Todos los Colegios)</option>
                            {schools.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {/* TOP STATS CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white p-6 rounded-xl shadow-lg">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <p className="text-indigo-100 text-xs font-bold uppercase tracking-wider">Tasa de Adopción</p>
                                    <h3 className="text-4xl font-extrabold mt-1">{schoolStats?.adoptionRate}%</h3>
                                </div>
                                <div className="p-2 bg-white/20 rounded-lg"><TrendingUp size={24} /></div>
                            </div>
                            <div className="w-full bg-black/20 rounded-full h-1.5 mt-2">
                                <div className="bg-white h-1.5 rounded-full" style={{ width: `${schoolStats?.adoptionRate}%` }}></div>
                            </div>
                            <p className="text-xs text-indigo-100 mt-3 font-medium">Estudiantes activos vs matriculados</p>
                        </div>

                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Tiempo Promedio</p>
                                    <h3 className="text-3xl font-bold mt-1 text-gray-800 dark:text-white">{schoolStats?.avgHoursPerStudent}h<span className="text-sm font-normal text-gray-400">/sem</span></h3>
                                </div>
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Clock size={24} /></div>
                            </div>
                            <p className="text-xs text-green-500 mt-4 font-bold flex items-center">
                                <TrendingUp size={12} className="mr-1" /> +12% vs mes anterior
                            </p>
                        </div>

                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Estudiantes</p>
                                    <h3 className="text-3xl font-bold mt-1 text-gray-800 dark:text-white">{schoolStats?.totalStudents}</h3>
                                </div>
                                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Users size={24} /></div>
                            </div>
                            <p className="text-xs text-gray-400 mt-4">Total inscritos en plataforma</p>
                        </div>

                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Objetivos Alcanzados</p>
                                    <h3 className="text-3xl font-bold mt-1 text-gray-800 dark:text-white">4/8</h3>
                                </div>
                                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><Award size={24} /></div>
                            </div>
                            <p className="text-xs text-gray-400 mt-4">Metas PISA/Saber Pro</p>
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-8">
                        {/* LEFT: PISA/SABER OBJECTIVES */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center">
                                    <Brain className="mr-2 text-indigo-500" /> Objetivos de Aprendizaje
                                </h3>
                                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-bold">PISA / Saber Pro</span>
                            </div>

                            <div className="space-y-4">
                                {[
                                    { label: 'Pensamiento Crítico', val: schoolStats?.learningObjectives.criticalThinking, color: 'bg-blue-500' },
                                    { label: 'Autonomía Lectora', val: schoolStats?.learningObjectives.autonomy, color: 'bg-purple-500' },
                                    { label: 'Producción Escrita', val: schoolStats?.learningObjectives.writing, color: 'bg-green-500' },
                                    { label: 'Inferencia y Análisis', val: schoolStats?.learningObjectives.inference, color: 'bg-amber-500' },
                                    { label: 'Gestión del Conocimiento', val: schoolStats?.learningObjectives.knowledge, color: 'bg-rose-500' },
                                    { label: 'Compromiso Socioemocional', val: schoolStats?.learningObjectives.engagement, color: 'bg-indigo-500' },
                                ].map((item) => (
                                    <div key={item.label}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="font-medium text-gray-600 dark:text-gray-300">{item.label}</span>
                                            <span className="font-bold text-gray-800 dark:text-white">{item.val}/100</span>
                                        </div>
                                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5">
                                            <div className={`h-2.5 rounded-full transition-all duration-1000 ${item.color}`} style={{ width: `${item.val}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-start">
                                <Search className="text-blue-500 mr-2 flex-shrink-0 mt-1" size={18} />
                                <p className="text-sm text-blue-800 dark:text-blue-200">
                                    <strong>Recomendación Pedagógica:</strong> Para mejorar el "Pensamiento Crítico", sugiere a los docentes asignar más <em>Reseñas Argumentativas</em> en los grupos de 9° y 10°.
                                </p>
                            </div>
                        </div>

                        {/* RIGHT: CONTENT INTELLIGENCE */}
                        <div className="space-y-6">
                            {/* TOP GENRES */}
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                                <h3 className="font-bold text-lg text-gray-800 dark:text-white mb-6 flex items-center">
                                    <BookOpen className="mr-2 text-indigo-500" /> Inteligencia de Contenido
                                </h3>

                                <div className="mb-6">
                                    <p className="text-sm font-bold text-gray-500 mb-3 uppercase">Lo que más gusta leer</p>
                                    <div className="flex flex-wrap gap-2">
                                        {contentInsights?.topGenres.map((g: any, i: number) => (
                                            <div key={g.name} className={`px-4 py-2 rounded-lg font-bold border-2 ${i === 0 ? 'bg-indigo-50 border-indigo-500 text-indigo-700' :
                                                i === 1 ? 'bg-indigo-50/50 border-indigo-300 text-indigo-600' :
                                                    'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                                                }`}>
                                                {g.name} <span className="opacity-60 ml-1 text-xs">{g.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <p className="text-sm font-bold text-gray-500 mb-3 uppercase">Autores de Mayor Enganche</p>
                                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {contentInsights?.topAuthors.map((a: any, i: number) => (
                                            <li key={a.name} className="py-2 flex justify-between items-center">
                                                <div className="flex items-center">
                                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mr-3 ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                                                        }`}>
                                                        {i + 1}
                                                    </span>
                                                    <span className="font-medium text-gray-700 dark:text-gray-200">{a.name}</span>
                                                </div>
                                                <div className="w-24 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 ml-4">
                                                    <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (a.count / (contentInsights.topAuthors[0]?.count || 1)) * 100)}%` }}></div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            {/* INSIGHT CARD */}
                            <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg">
                                <h4 className="font-bold text-lg mb-2 flex items-center"><TrendingUp className="mr-2" /> Oportunidad Editorial</h4>
                                <p className="text-indigo-100 text-sm mb-4">
                                    Los datos indican un interés creciente del <strong>45%</strong> por contenidos de <strong>Ciencia Ficción</strong> y <strong>Naturaleza</strong> en los grados inferiores.
                                </p>
                                <button className="w-full py-2 bg-white text-indigo-600 font-bold rounded-lg hover:bg-indigo-50 transition-colors">
                                    Ver Proyectos Sugeridos
                                </button>
                            </div>
                        </div>
                    </div>
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
