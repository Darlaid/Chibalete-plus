import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, BookUser, ShieldCheck } from 'lucide-react';
import LandingCarousel from '../components/LandingCarousel';

const Bienvenida: React.FC = () => {
    const navigate = useNavigate();

    const handleNavigateToAuth = (role: string) => {
        navigate('/auth', { state: { targetRole: role } });
    };

    const RoleButton: React.FC<{ onClick: () => void; icon: React.ReactNode; children: React.ReactNode; primary?: boolean }> = ({ onClick, icon, children, primary }) => (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-center font-bold py-4 px-6 rounded-full text-lg shadow-lg transition-transform transform hover:scale-105 ${primary
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 ring-4 ring-indigo-200'
                : 'bg-white text-slate-700 hover:bg-gray-50'
                }`}
        >
            {icon}
            <span className="ml-3">{children}</span>
        </button>
    );

    return (
        <div className="flex flex-col lg:flex-row min-h-screen bg-[#8ecae4] text-slate-800">
            <div className="lg:w-[38%] flex flex-col items-center justify-center p-6 md:p-8 text-center">
            <img
                src="/chibalete_logo.png"
                alt="Logo Chibalete"
                className="w-32 md:w-40 mb-4 drop-shadow-md"
            />
            <h1 className="text-4xl md:text-5xl font-bold mb-2 drop-shadow-sm">
                Chibalete+
            </h1>
            <p className="text-xl md:text-2xl mb-12 max-w-2xl mx-auto font-medium">
                Formar mejores ciudadanos, democratizando la lectura
            </p>
            <div className="w-full max-w-xs space-y-4">

                <RoleButton onClick={() => handleNavigateToAuth('lector')} icon={<BookUser />}>
                    Soy Lector
                </RoleButton>
                <RoleButton onClick={() => handleNavigateToAuth('mediador')} icon={<User />}>
                    Soy Mediador
                </RoleButton>
                <RoleButton onClick={() => handleNavigateToAuth('administrador')} icon={<ShieldCheck />}>
                    Soy Administrador
                </RoleButton>
            </div>

            <div className="mt-12 text-sm text-slate-700 space-y-3">
                <p>
                    ¿No tienes cuenta? consulta nuestros planes en:<br />
                    <a
                        href="https://chibaleteeditores.com/tienda/suscripciones/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold underline break-all hover:text-slate-900 transition-colors"
                    >
                        https://chibaleteeditores.com/tienda/suscripciones/
                    </a>
                </p>
                <p>
                    Descubre más en<br />
                    <a
                        href="https://chibaleteeditores.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold underline break-all hover:text-slate-900 transition-colors"
                    >
                        https://chibaleteeditores.com/
                    </a>
                </p>
            </div>
            </div>

            <div className="lg:w-[62%] flex p-4 pt-0 md:p-8 md:pt-0 lg:pt-8">
                <LandingCarousel />
            </div>
        </div>
    );
};

export default Bienvenida;
