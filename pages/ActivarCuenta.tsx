import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, ChevronLeft, CheckCircle, AlertCircle } from 'lucide-react';
// V8.1-CLOSE-05 (DIR-V81-01): mismas versiones que exige el servidor.
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../utils/acceptanceDocuments.mjs';

type UIState = 'idle' | 'submitting' | 'success' | 'error';

interface ErrorInfo {
    message: string;
    code?: string;
}

const DECISION_MESSAGES: Record<string, string> = {
    DECISIONS_REQUIRED: 'Faltan decisiones para activar la cuenta. Revisa los apartados señalados.',
    A1_DENIED: 'Sin la autorización de cuenta y lectura (A1) la cuenta no puede activarse. Puedes cambiar tu decisión o escribir a contacto@chibaleteeditores.com.',
    A0_DENIED: 'Sin autorizar los datos del representante (A0) no podemos registrar la representación.',
    A2_NOT_APPLICABLE: 'El seguimiento institucional (A2) solo aplica a cuentas de un colegio o club. Marca «No aplica».',
    VERSION_MISMATCH: 'Los documentos cambiaron. Recarga la página para ver la versión vigente.',
};

const versionOf = (v: string) => v.split('@')[1];
const flag = (on: boolean) => (on ? 'ring-2 ring-red-400 rounded p-1' : '');

/** Radio sin valor inicial: la decisión es siempre explícita. */
const Choice: React.FC<{ name: string; value: string; options: [string, string][]; onChange: (v: any) => void }> = ({ name, value, options, onChange }) => (
    <div className="flex flex-wrap gap-4 mt-1">
        {options.map(([v, label]) => (
            <label key={v} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
                {label}
            </label>
        ))}
    </div>
);

const ActivarCuenta: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [password, setPassword]       = useState('');
    const [confirm, setConfirm]         = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [uiState, setUiState]         = useState<UIState>('idle');
    const [errorInfo, setErrorInfo]     = useState<ErrorInfo | null>(null);
    const [validationError, setValidationError] = useState('');
    // Decisiones (002/004/005). Ninguna viene marcada: '' / false = sin decidir.
    const [actingAs, setActingAs]       = useState<'' | 'titular' | 'legal_representative'>('');
    const [adultDeclared, setAdultDeclared] = useState(false);
    const [a0, setA0]                   = useState<'' | 'yes' | 'no'>('');
    const [a1, setA1]                   = useState<'' | 'yes' | 'no'>('');
    const [a2, setA2]                   = useState<'' | 'yes' | 'no' | 'not_applicable'>('');
    const [terms, setTerms]             = useState(false);
    const [mediatorCommitment, setMediatorCommitment] = useState(false);
    const [required, setRequired]       = useState<string[]>([]);

    const navigate = useNavigate();

    // ── Token ausente ────────────────────────────────────────────────────────
    if (!token) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
                <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg text-center space-y-4">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Enlace inválido
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                        El enlace de activación no es válido o está incompleto.
                        Verifica que hayas copiado correctamente el enlace enviado por tu institución.
                    </p>
                    <Link
                        to="/bienvenida"
                        className="inline-block mt-2 text-indigo-600 hover:underline dark:text-indigo-400 font-medium text-sm"
                    >
                        Ir al inicio
                    </Link>
                </div>
            </div>
        );
    }

    // ── Validación local ─────────────────────────────────────────────────────
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

    // ── Submit ───────────────────────────────────────────────────────────────
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (uiState === 'submitting') return; // guard anti-doble submit
        if (!validate()) return;

        setUiState('submitting');
        setErrorInfo(null);

        try {
            const res = await fetch('/api/accept-invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token, password,
                    acceptance: {
                        terms, termsVersion: DOCS.terms.version,
                        dataNoticeVersion: DOCS.dataNotice.version,
                        ...(actingAs ? { actingAs } : {}),
                        adultDeclared,
                        ...(a0 ? { A0: a0 } : {}),
                        ...(a1 ? { A1: a1 } : {}),
                        ...(a2 ? { A2: a2 } : {}),
                        mediatorCommitment, mediatorVersion: DOCS.mediator.version,
                    },
                }),
            });

            const data = await res.json();

            if (res.ok) {
                setUiState('success');
                return;
            }

            // Mapear códigos de error del backend a mensajes claros
            if (res.status === 422) {
                setRequired(Array.isArray(data.required) ? data.required : []);
                setErrorInfo({ message: DECISION_MESSAGES[data.code] ?? 'Revisa las decisiones marcadas para continuar.', code: data.code });
            } else if (res.status === 410 || data.code === 'TOKEN_EXPIRED') {
                setErrorInfo({
                    message: 'Este enlace expiró. Pide a tu administrador que reenvíe la invitación.',
                    code: 'TOKEN_EXPIRED',
                });
            } else if (res.status === 409) {
                setErrorInfo({
                    message: 'Esta cuenta ya fue activada. Puedes ir directamente al inicio de sesión.',
                    code: 'ALREADY_ACTIVE',
                });
            } else if (res.status === 404) {
                setErrorInfo({
                    message: 'El enlace es inválido o ya fue utilizado.',
                    code: 'INVALID_TOKEN',
                });
            } else {
                setErrorInfo({
                    message: data.error || 'Ocurrió un error al activar la cuenta. Intenta nuevamente.',
                });
            }
            setUiState('error');

        } catch {
            setErrorInfo({ message: 'No se pudo conectar con el servidor. Verifica tu conexión.' });
            setUiState('error');
        }
    };

    // ── Pantalla de éxito ────────────────────────────────────────────────────
    if (uiState === 'success') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
                <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg text-center space-y-4">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        ¡Cuenta activada!
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Tu cuenta está lista. Ya puedes ingresar con tu nueva contraseña.
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

    // ── Formulario principal ─────────────────────────────────────────────────
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
                        Activa tu cuenta
                    </h1>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        Crea una contraseña para completar tu registro en Chibalete+.
                    </p>
                </div>

                {/* Error de servidor */}
                {uiState === 'error' && errorInfo && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-sm">
                        <p>{errorInfo.message}</p>
                        {(errorInfo.code === 'ALREADY_ACTIVE' || errorInfo.code === 'TOKEN_EXPIRED') && (
                            <Link
                                to="/auth"
                                className="block mt-2 font-semibold underline hover:text-red-900"
                            >
                                Ir al inicio de sesión
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

                    {/* V8.1-CLOSE-05 — decisiones diferenciadas, sin casillas premarcadas */}
                    <fieldset className="space-y-4 text-left border-t border-gray-200 dark:border-gray-700 pt-4" aria-describedby="decisiones-ayuda">
                        <legend className="text-sm font-semibold text-gray-900 dark:text-white">Tus decisiones</legend>
                        <p id="decisiones-ayuda" className="text-xs text-gray-500 dark:text-gray-400">
                            Cada decisión es independiente. Puedes consultarlas o cambiarlas escribiendo a contacto@chibaleteeditores.com.
                        </p>

                        <div className={flag(required.includes('actingAs'))}>
                            <span className="text-sm text-gray-800 dark:text-gray-100">Activo esta cuenta como</span>
                            <Choice name="actingAs" value={actingAs} onChange={setActingAs}
                                options={[['titular', 'Titular mayor de edad'], ['legal_representative', 'Representante legal de un lector menor de edad']]} />
                        </div>

                        <label className={'flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 ' + flag(required.includes('adultDeclared'))}>
                            <input type="checkbox" checked={adultDeclared} onChange={(e) => setAdultDeclared(e.target.checked)} className="mt-1" />
                            <span>Declaro que soy mayor de edad.</span>
                        </label>

                        {actingAs === 'legal_representative' && (
                            <div className={flag(required.includes('A0'))}>
                                <span className="text-sm text-gray-800 dark:text-gray-100">A0 · Autorizo el tratamiento de mis datos como representante ({DOCS.dataNotice.id}, v{versionOf(DOCS.dataNotice.version)}).</span>
                                <Choice name="A0" value={a0} onChange={setA0} options={[['yes', 'Sí'], ['no', 'No']]} />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Verificaremos la representación antes de habilitar las funciones que la requieren.</p>
                            </div>
                        )}

                        <div className={flag(required.includes('A1'))}>
                            <span className="text-sm text-gray-800 dark:text-gray-100">A1 · Cuenta, lectura y funciones educativas informadas ({DOCS.dataNotice.title}, v{versionOf(DOCS.dataNotice.version)}).</span>
                            <Choice name="A1" value={a1} onChange={setA1} options={[['yes', 'Sí, autorizo'], ['no', 'No autorizo']]} />
                        </div>

                        <div className={flag(required.includes('A2'))}>
                            <span className="text-sm text-gray-800 dark:text-gray-100">A2 · Seguimiento pedagógico por los mediadores asignados de mi colegio o club.</span>
                            <Choice name="A2" value={a2} onChange={setA2} options={[['yes', 'Sí, autorizo'], ['no', 'No autorizo'], ['not_applicable', 'No aplica (sin colegio ni club)']]} />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Es independiente de A1: sin A2 sigues leyendo, pero tus mediadores no ven tu detalle individual.</p>
                        </div>

                        {required.includes('C005') && (
                            <label className={'flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 ' + flag(true)}>
                                <input type="checkbox" checked={mediatorCommitment} onChange={(e) => setMediatorCommitment(e.target.checked)} className="mt-1" />
                                <span>Acepto el {DOCS.mediator.title} ({DOCS.mediator.id}, v{versionOf(DOCS.mediator.version)}) para los grupos que me asigne la institución.</span>
                            </label>
                        )}

                        <label className={'flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 ' + flag(required.includes('T'))}>
                            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" />
                            <span>Acepto los {DOCS.terms.title} ({DOCS.terms.id}, v{versionOf(DOCS.terms.version)}) y las condiciones de la oferta contratada.</span>
                        </label>
                    </fieldset>

                    <button
                        type="submit"
                        disabled={uiState === 'submitting'}
                        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors"
                    >
                        {uiState === 'submitting' ? 'Activando...' : 'Activar cuenta'}
                    </button>

                </form>
            </div>
        </div>
    );
};

export default ActivarCuenta;
