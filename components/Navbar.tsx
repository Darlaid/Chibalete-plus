
import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { isMediator, isAdmin, normalizeRoles } from '../utils/permissions';
import {
    Home, Library, Search, User, LifeBuoy, Upload, LogOut, Users,
    PlayCircle, ShoppingBag, Gamepad2, GraduationCap, BarChart2,
    Clock, Menu, X, NotebookPen, Package, Gift, Sparkles, Globe, Smartphone
} from 'lucide-react';

// Helper component for standard nav items with accessibility improvements
const NavItem: React.FC<{ to: string; icon: React.ReactNode; label: string; mobileOnly?: boolean }> = ({ to, icon, label, mobileOnly }) => {
    const location = useLocation();
    const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

    return (
        <NavLink
            to={to}
            className={`flex flex-col md:flex-row items-center md:justify-start md:space-x-3 p-2 md:px-4 md:py-3 rounded-xl transition-all duration-200 group focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] min-w-[44px] ${isActive
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 font-semibold'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                } ${mobileOnly ? 'md:hidden' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
        >
            <div className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`}>
                {icon}
            </div>
            <span className="text-[10px] md:text-sm font-medium mt-1 md:mt-0">{label}</span>
        </NavLink>
    );
};

// Grid Item for Mobile Menu with larger hit area
const MobileMenuItem: React.FC<{ to: string; icon: React.ReactNode; label: string; onClick: () => void }> = ({ to, icon, label, onClick }) => {
    const location = useLocation();
    const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

    return (
        <NavLink
            to={to}
            onClick={onClick}
            className={`flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-200 border min-h-[100px] active:scale-95 ${isActive
                ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
            role="menuitem"
        >
            <div className={`mb-2 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {icon}
            </div>
            <span className="text-xs font-bold text-center">{label}</span>
        </NavLink>
    );
}

const RecentItem: React.FC<{ id: string, title: string, type: string, portada: string }> = ({ id, title, type, portada }) => {
    const navigate = useNavigate();
    return (
        <button
            onClick={() => navigate(`/contenido/${id}`)}
            className="flex items-center w-full p-2 space-x-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label={`Abrir reciente: ${title}`}
        >
            <img src={portada} alt="" className="w-8 h-8 rounded object-cover shadow-sm group-hover:scale-105 transition-transform" aria-hidden="true" />
            <div className="text-left overflow-hidden">
                <p className="text-xs font-medium truncate text-gray-700 dark:text-gray-300 group-hover:text-indigo-600">{title}</p>
                <p className="text-xs text-gray-400 capitalize">{type.replace('_', ' ')}</p>
            </div>
        </button>
    )
}

const Navbar: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [location]);

    const recentItems = user ? dataService.getRecentHistory(user.id) : [];

    // ---------------------------------------------------------------------------
    // RBAC — evaluación de permisos para visibilidad del menú (Fase 1G.1)
    //
    // Variables derivadas (una sola evaluación por render):
    //   normalizedRoles → array limpio para cualquier check puntual futuro
    //   userIsAdmin     → true si 'administrador' está en los roles
    //   userIsMediator  → true si 'mediador' está en los roles
    //   canManage       → true para mediador | administrador
    // DT-05: 'profesor' eliminado del modelo — isMediator() solo cubre 'mediador'.
    // ---------------------------------------------------------------------------
    const normalizedRoles = normalizeRoles(user?.roles);
    const userIsAdmin     = normalizedRoles.includes('administrador');
    const userIsMediator  = isMediator(user);
    const canManage       = userIsAdmin || userIsMediator;

    // Label contextual para /aula-viva:
    // mediador/admin → "Aula Viva" (terminología pedagógica del sistema)
    // lector         → "Mi Aula" (más accesible y personal)
    const aulaLabel = canManage ? 'Aula Viva' : 'Mi Aula';

    // ---------------------------------------------------------------------------
    // DESKTOP SIDEBAR — items declarativos con agrupación semántica
    // ---------------------------------------------------------------------------

    // ── Sección Lectura ─── visible para todos los usuarios autenticados ────────
    // /aula-viva tiene access='authenticated' en routePermissions; la página adapta
    // su vista internamente (canManageClassroom en AulaViva.tsx).
    const navItemsDesktop = [
        { to: '/',         icon: <Home size={22} strokeWidth={2} />,         label: 'Inicio' },
        { to: '/aula-viva', icon: <GraduationCap size={22} strokeWidth={2} />, label: aulaLabel },
        { to: '/biblioteca', icon: <Library size={22} strokeWidth={2} />,     label: 'Biblioteca' },
        { to: '/experiencias', icon: <Sparkles size={22} strokeWidth={2} />,  label: 'Experiencias' },
        { to: '/multimedia', icon: <PlayCircle size={22} strokeWidth={2} />,  label: 'Multimedia' },
        { to: '/trivia',     icon: <Gamepad2 size={22} strokeWidth={2} />,    label: 'Trívia' },
        { to: '/tienda',     icon: <ShoppingBag size={22} strokeWidth={2} />, label: 'Tienda' },
        { to: '/bitacora',   icon: <NotebookPen size={22} strokeWidth={2} />, label: 'Bitácora' },
        { to: '/clubs',      icon: <Globe size={22} strokeWidth={2} />,       label: 'Clubes' },
        { to: '/buscar',     icon: <Search size={22} strokeWidth={2} />,      label: 'Buscar', mobileOnly: true },
        { to: user ? `/perfil/${user.id}` : '/auth', icon: <User size={22} strokeWidth={2} />, label: 'Perfil' },
    ];

    // ── Sección Gestión ─── visibilidad graduada por rol ───────────────────────
    // Orden: utilidades (todos) → mediación → administración
    const secondaryItemsDesktop = [
        // Todos los usuarios autenticados
        { to: '/soporte',       icon: <LifeBuoy size={20} />,   label: 'Soporte' },
        { to: '/chibalete-lu',  icon: <Smartphone size={20} />, label: 'Chibalete LU' },

        // ── Administración: solo administrador ─────────────────────────────────
        ...(userIsAdmin ? [
            { to: '/subir-contenido',    icon: <Upload size={20} />,    label: 'Subir' },
            { to: '/admin-dashboard',    icon: <BarChart2 size={20} />, label: 'Panel Admin' },
            { to: '/admin/productos',    icon: <Package size={20} />,   label: 'Productos' },
            { to: '/admin/recompensas',  icon: <Gift size={20} />,      label: 'Recompensas' },
            { to: '/admin/usuarios',     icon: <Users size={20} />,     label: 'Usuarios' },
            { to: '/admin/experiencias', icon: <Sparkles size={20} />,  label: 'Experiencias' },
        ] : []),
    ];

    // ---------------------------------------------------------------------------
    // MOBILE NAVIGATION — coherente con desktop en visibilidad y orden
    // ---------------------------------------------------------------------------

    const mobileBottomBarItems = [
        { to: '/',   icon: <Home size={24} />,   label: 'Inicio' },
        { to: '/buscar', icon: <Search size={24} />, label: 'Buscar' },
        { to: user ? `/perfil/${user.id}` : '/auth', icon: <User size={24} />, label: 'Perfil' },
    ];

    // Grid completo — mismo orden semántico que desktop.
    const mobileGridItems = [
        // ── Sección Lectura ────────────────────────────────────────────────────
        { to: user ? `/perfil/${user.id}` : '/auth', icon: <User size={28} />,         label: 'Perfil' },
        { to: '/buscar',    icon: <Search size={28} />,        label: 'Buscar' },
        { to: '/aula-viva', icon: <GraduationCap size={28} />, label: aulaLabel },
        { to: '/biblioteca', icon: <Library size={28} />,       label: 'Biblioteca' },
        { to: '/multimedia', icon: <PlayCircle size={28} />,    label: 'Multimedia' },
        { to: '/trivia',     icon: <Gamepad2 size={28} />,      label: 'Trívia' },
        { to: '/tienda',     icon: <ShoppingBag size={28} />,   label: 'Tienda' },
        { to: '/bitacora',   icon: <NotebookPen size={28} />,   label: 'Bitácora' },
        { to: '/clubs',      icon: <Globe size={28} />,         label: 'Clubes' },
        { to: '/soporte',      icon: <LifeBuoy size={28} />,   label: 'Soporte' },
        { to: '/chibalete-lu', icon: <Smartphone size={28} />, label: 'Chibalete LU' },

        // ── Sección Administración: solo administrador ─────────────────────────
        ...(userIsAdmin ? [
            { to: '/subir-contenido',    icon: <Upload size={28} />,    label: 'Subir' },
            { to: '/admin-dashboard',    icon: <BarChart2 size={28} />, label: 'Panel Admin' },
            { to: '/admin/usuarios',     icon: <Users size={28} />,     label: 'Usuarios' },
            { to: '/admin/productos',    icon: <Package size={28} />,   label: 'Productos' },
            { to: '/admin/recompensas',  icon: <Gift size={28} />,      label: 'Recompensas' },
            { to: '/admin/experiencias', icon: <Sparkles size={28} />,  label: 'Experiencias' },
        ] : []),
    ];

    const handleLogout = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        logout();
        navigate('/bienvenida', { replace: true });
    };

    return (
        <>
            {/* 1. Fixed Bottom Bar (Mobile) */}
            <nav
                className="fixed bottom-0 left-0 right-0 h-[70px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border-t border-gray-200/50 dark:border-gray-700/50 md:hidden flex justify-around items-center z-[100] px-2 pb-safe-bottom pt-1 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)]"
                aria-label="Navegación móvil inferior"
            >
                {mobileBottomBarItems.map(item => (
                    <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
                ))}

                <button
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-w-[44px] min-h-[44px]"
                    aria-label="Abrir menú principal"
                    aria-expanded={isMobileMenuOpen}
                >
                    <Menu size={24} strokeWidth={2.5} />
                    <span className="text-[10px] font-medium mt-1">Menú</span>
                </button>
            </nav>

            {/* 2. Full Screen Mobile Menu Overlay */}
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-[110] bg-white/98 dark:bg-gray-900/98 backdrop-blur-xl md:hidden flex flex-col animate-in fade-in slide-in-from-bottom-5 duration-300" role="dialog" aria-modal="true" aria-label="Menú completo">
                    <div className="p-4 flex justify-between items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pt-safe-top">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-gradient-to-tr from-indigo-600 to-purple-500 rounded-lg shadow-lg"></div>
                            <h2 className="text-xl font-bold text-gray-800 dark:text-white tracking-tight">Menú Principal</h2>
                        </div>
                        <button
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                            aria-label="Cerrar menú"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 pb-24">
                        <div className="grid grid-cols-2 gap-4 mb-8" role="menu">
                            {mobileGridItems.map(item => (
                                <MobileMenuItem
                                    key={item.to}
                                    to={item.to}
                                    icon={item.icon}
                                    label={item.label}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                />
                            ))}
                        </div>

                        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center justify-center space-x-2 py-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors shadow-sm min-h-[50px]"
                            >
                                <LogOut size={20} />
                                <span>Cerrar Sesión</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. Desktop Sidebar */}
            <nav className="hidden md:flex flex-col w-72 h-full bg-white/80 dark:bg-gray-900/80 backdrop-blur border-r border-gray-100 dark:border-gray-800 z-40 shadow-sm overflow-hidden">
                {/* Header Section (Logo + Title) - Fixed at top */}
                <div className="flex flex-col items-center gap-1 px-6 pt-6 pb-4 w-full flex-shrink-0">
                    <img
                        src="/chibalete_logo.png"
                        alt="Chibalete Editores"
                        className="h-16 w-auto object-contain drop-shadow-sm hover:scale-105 transition-transform duration-300"
                    />
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400">
                        Chibalete+ 3.0.2
                    </span>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-hide flex flex-col">
                    <div className="flex flex-col space-y-1">
                        {navItemsDesktop.filter(i => !i.mobileOnly).map(item => (
                            <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
                        ))}
                    </div>

                    <div className="mt-6 mb-2">
                        <p className="px-4 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Gestión</p>
                        <div className="flex flex-col space-y-1">
                            {secondaryItemsDesktop.map(item => (
                                <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
                            ))}
                        </div>
                    </div>

                    {recentItems.length > 0 && (
                        <div className="mt-4">
                            <p className="px-4 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                                <Clock size={12} className="mr-1" /> Recientes
                            </p>
                            <div className="space-y-1">
                                {recentItems.map(item => (
                                    <RecentItem key={item.id} id={item.id} title={item.titulo} type={item.tipo} portada={item.portada_url} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Section (Logout) - Fixed at bottom */}
                <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 flex-shrink-0">
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="flex items-center space-x-3 px-4 py-3 text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200 rounded-xl w-full text-left cursor-pointer group"
                    >
                        <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
                        <span className="font-medium">Cerrar Sesión</span>
                    </button>
                </div>
            </nav>
        </>
    );
};

export default Navbar;
