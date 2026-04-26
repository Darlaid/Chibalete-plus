import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, BookUser, ShieldCheck } from 'lucide-react';

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
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#8ecae4] text-slate-800 p-4 text-center">
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
                    ¿No tienes cuenta? Contacta a tu institución educativa.
                </p>
                <p>
                    Si quieres inscribirte a Chibalete+, escríbenos a:<br />
                    <a
                        href="mailto:contacto@chibaleteeditores.com"
                        className="font-bold underline hover:text-slate-900 transition-colors"
                    >
                        contacto@chibaleteeditores.com
                    </a>
                </p>
                <p>
                    Descubre más en <a href="https://tiendachibalete.com/" target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-slate-900 transition-colors">https://tiendachibalete.com/</a>
                </p>
            </div>
        </div>
    );
};

export default Bienvenida;
