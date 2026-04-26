import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AtSign, Lock, Eye, EyeOff, ChevronLeft, CheckCircle } from 'lucide-react';

type UIState = 'idle' | 'submitting' | 'success' | 'error';

interface ErrorInfo {
    message: string;
    code?: string;
}

// ── MODO 1: Sin token — Solicitar email ──────────────────────────────────────

const RequestResetForm: React.FC = () => {
    const [email, setEmail]         = useState('');
    const [uiState, setUiState]     = useState<UIState>('idle');
    const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (uiState === 'submitting') return;

        setUiState('submitting');
        setErrorInfo(null);

        try {
            const res = await fetch('/api/request-password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });

            // El backend siempre responde 200 (anti-oracle).
            // El único error posible es 400 (email ausente) o fallo de red.
            if (res.ok) {
                setEmail('');
                setUiState('success');
                return;
            }

            const data = await res.json();
            setErrorInfo({ message: data.error || 'Ocurrió un error. Intenta nuevamente.' });
            setUiState('error');

        } catch {
            setErrorInfo({ message: 'No se pudo conectar con el servidor. Verifica tu conexión.' });
            setUiState('error');
        }
    };

    if (uiState === 'success') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
                <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg text-center space-y-4">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Revisa tu correo
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.
                    </p>
                    <Link
                        to="/auth"
                        className="inline-block mt-2 text-indigo-600 hover:underline dark:text-indigo-400 font-medium text-sm"
                    >
                        Volver al inicio de sesión
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 relative">

            <Link
                to="/auth"
                className="absolute top-4 left-4 md:top-8 md:left-8 flex items-center text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors font-medium"
            >
                <ChevronLeft className="w-5 h-5 mr-1" />
                Volver al inicio de sesión
            </Link>

            <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg mt-12 md:mt-0">

                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                        ¿Olvidaste tu contraseña?
                    </h1>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        Ingresa tu correo y te enviaremos instrucciones para restablecerla.
                    </p>
                </div>

                {uiState === 'error' && errorInfo && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-sm">
                        {errorInfo.message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">

                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                            <AtSign className="h-5 w-5 text-gray-400" />
                        </span>
                        <input
                            type="email"
                            className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700 dark:text-white"
                            placeholder="Correo electrónico"
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); setErrorInfo(null); }}
                            required
                            autoComplete="email"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={uiState === 'submitting'}
                        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors"
                    >
                        {uiState === 'submitting' ? 'Enviando...' : 'Enviar instrucciones'}
                    </button>

                </form>
            </div>
        </div>
    );
};

// ── MODO 2: Con token — Nueva contraseña ─────────────────────────────────────

const ConfirmResetForm: React.FC<{ token: string }> = ({ token }) => {
    const [password, setPassword]           = useState('');
    const [confirm, setConfirm]             = useState('');
    const [showPassword, setShowPassword]   = useState(false);
    const [showConfirm, setShowConfirm]     = useState(false);
    const [uiState, setUiState]             = useState<UIState>('idle');
    const [errorInfo, setErrorInfo]         = useState<ErrorInfo | null>(null);
    const [validationError, setValidationError] = useState('');

    const navigate = useNavigate();

    const validate = (): boolean => {
        if (password.length < 8) {
            setValidationError('La contraseña debe tener al menos 8 caracteres.');
            return false;
        }
        if (password !== confirm) {
            setValidationError('Las contraseñas no coinciden.');
            return false;
        }
        setValidationError('');
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (uiState === 'submitting') return;
        if (!validate()) return;

        setUiState('submitting');
        setErrorInfo(null);

        try {
            const res = await fetch('/api/confirm-password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });

            const data = await res.json();

            if (res.ok) {
                setUiState('success');
                return;
            }

            if (res.status === 410 || data.code === 'TOKEN_EXPIRED') {
                setErrorInfo({
                    message: 'El enlace de restablecimiento expiró. Solicita uno nuevo.',
                    code: 'TOKEN_EXPIRED',
                });
            } else if (res.status === 404) {
                setErrorInfo({
                    message: 'Enlace inválido o ya utilizado.',
                    code: 'INVALID_TOKEN',
                });
            } else if (res.status === 409) {
                setErrorInfo({
                    message: 'No se puede restablecer esta cuenta. Contacta a tu administrador.',
                    code: 'ACCOUNT_ERROR',
                });
            } else {
                setErrorInfo({
                    message: data.error || 'Ocurrió un error. Intenta nuevamente.',
                });
            }
            setUiState('error');

        } catch {
            setErrorInfo({ message: 'No se pudo conectar con el servidor. Verifica tu conexión.' });
            setUiState('error');
        }
    };

    if (uiState === 'success') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
                <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg text-center space-y-4">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        ¡Contraseña actualizada!
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Tu contraseña fue cambiada correctamente. Ya puedes ingresar.
                    </p>
                    <button
                        onClick={() => navigate('/auth')}
                        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md transition-colors"
                    >
                        Ir al inicio de sesión
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 relative">

            <Link
                to="/bienvenida"
                className="absolute top-4 left-4 md:top-8 md:left-8 flex items-center text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors font-medium"
            >
                <ChevronLeft className="w-5 h-5 mr-1" />
                Volver al inicio
            </Link>

            <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg mt-12 md:mt-0">

                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                        Nueva contraseña
                    </h1>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        Elige una contraseña segura para tu cuenta.
                    </p>
                </div>

                {/* Error de servidor */}
                {uiState === 'error' && errorInfo && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-sm">
                        <p>{errorInfo.message}</p>
                        {(errorInfo.code === 'TOKEN_EXPIRED' || errorInfo.code === 'INVALID_TOKEN') && (
                            <Link
                                to="/reset-password"
                                className="block mt-2 font-semibold underline hover:text-red-900"
                            >
                                Solicitar nuevo enlace
                            </Link>
                        )}
                    </div>
                )}

                {/* Error de validación local */}
                {validationError && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-sm">
                        {validationError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">

                    {/* Nueva contraseña */}
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                            <Lock className="h-5 w-5 text-gray-400" />
                        </span>
                        <input
                            type={showPassword ? 'text' : 'password'}
                            className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700 dark:text-white"
                            placeholder="Nueva contraseña (mín. 8 caracteres)"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); setValidationError(''); }}
                            required
                            minLength={8}
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>

                    {/* Confirmar contraseña */}
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                            <Lock className="h-5 w-5 text-gray-400" />
                        </span>
                        <input
                            type={showConfirm ? 'text' : 'password'}
                            className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700 dark:text-white"
                            placeholder="Confirmar contraseña"
                            value={confirm}
                            onChange={(e) => { setConfirm(e.target.value); setValidationError(''); }}
                            required
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirm(!showConfirm)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                            {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={uiState === 'submitting'}
                        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors"
                    >
                        {uiState === 'submitting' ? 'Guardando...' : 'Guardar nueva contraseña'}
                    </button>

                </form>
            </div>
        </div>
    );
};

// ── Componente raíz — decide modo según presencia de token ───────────────────

const ResetPassword: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    if (token) {
        return <ConfirmResetForm token={token} />;
    }

    return <RequestResetForm />;
};

export default ResetPassword;
