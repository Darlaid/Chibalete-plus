
import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { Home, Library, Search, User, LifeBuoy, Crown, Upload, LogOut, Users, PlayCircle, ShoppingBag, Gamepad2, GraduationCap, BarChart2, Clock, Menu, X, NotebookPen, Package, Gift } from 'lucide-react';

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

    // --- DESKTOP SIDEBAR ITEMS ---
    const navItemsDesktop = [
        { to: '/', icon: <Home size={22} strokeWidth={2} />, label: 'Inicio' },
        { to: '/biblioteca', icon: <Library size={22} strokeWidth={2} />, label: 'Biblioteca' },
        { to: '/multimedia', icon: <PlayCircle size={22} strokeWidth={2} />, label: 'Multimedia' },
        { to: '/trivia', icon: <Gamepad2 size={22} strokeWidth={2} />, label: 'Trívia' },
        { to: '/tienda', icon: <ShoppingBag size={22} strokeWidth={2} />, label: 'Tienda' },
        { to: '/bitacora', icon: <NotebookPen size={22} strokeWidth={2} />, label: 'Bitácora' }, // Added here
        { to: '/buscar', icon: <Search size={22} strokeWidth={2} />, label: 'Buscar', mobileOnly: true },
        { to: user ? `/perfil/${user.id}` : '/auth', icon: <User size={22} strokeWidth={2} />, label: 'Perfil' },
    ];

    const secondaryItemsDesktop = [
        { to: '/soporte', icon: <LifeBuoy size={20} />, label: 'Soporte' },
    ]

    if (user?.roles.includes('administrador') || user?.roles.includes('profesor')) {
        navItemsDesktop.splice(3, 0, { to: '/aula-viva', icon: <GraduationCap size={22} strokeWidth={2} />, label: 'Aula Viva' });
    }

    if (user?.roles.includes('administrador')) {
        secondaryItemsDesktop.push({ to: '/admin-dashboard', icon: <BarChart2 size={20} />, label: 'Panel Admin' });
        secondaryItemsDesktop.push({ to: '/subir-contenido', icon: <Upload size={20} />, label: 'Subir' });
        secondaryItemsDesktop.push({ to: '/admin/productos', icon: <Package size={20} />, label: 'Productos' });
        secondaryItemsDesktop.push({ to: '/admin/recompensas', icon: <Gift size={20} />, label: 'Recompensas' });
        secondaryItemsDesktop.push({ to: '/admin/usuarios', icon: <Users size={20} />, label: 'Usuarios' });
    }

    // --- MOBILE NAVIGATION ---
    const mobileBottomBarItems = [
        { to: '/', icon: <Home size={24} />, label: 'Inicio' },
        { to: '/buscar', icon: <Search size={24} />, label: 'Buscar' },
        { to: user ? `/perfil/${user.id}` : '/auth', icon: <User size={24} />, label: 'Perfil' },
    ];

    const mobileGridItems = [
        { to: user ? `/perfil/${user.id}` : '/auth', icon: <User size={28} />, label: 'Perfil' },
        { to: '/buscar', icon: <Search size={28} />, label: 'Buscar' },
        { to: '/biblioteca', icon: <Library size={28} />, label: 'Biblioteca' },
        { to: '/multimedia', icon: <PlayCircle size={28} />, label: 'Multimedia' },
        { to: '/trivia', icon: <Gamepad2 size={28} />, label: 'Trívia' },
        { to: '/tienda', icon: <ShoppingBag size={28} />, label: 'Tienda' },
        { to: '/bitacora', icon: <NotebookPen size={28} />, label: 'Bitácora' }, // Added here
        ...((user?.roles.includes('profesor') || user?.roles.includes('administrador'))
            ? [{ to: '/aula-viva', icon: <GraduationCap size={28} />, label: 'Aula Viva' }]
            : []),
        { to: '/soporte', icon: <LifeBuoy size={28} />, label: 'Soporte' },
        ...((user?.roles.includes('administrador')) ? [
            { to: '/admin-dashboard', icon: <BarChart2 size={28} />, label: 'Panel Admin' },
            { to: '/subir-contenido', icon: <Upload size={28} />, label: 'Subir' },
            { to: '/admin/usuarios', icon: <Users size={28} />, label: 'Usuarios' }
        ] : [])
    ];

    const handleLogout = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Direct logout for better UX, or use a custom modal instead of window.confirm which can be flaky
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
                        Chibalete+ 2.0
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
