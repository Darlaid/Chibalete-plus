import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, ChevronLeft, CheckCircle, AlertCircle } from 'lucide-react';
// V8.1-CLOSE-05 (DIR-V81-01): mismas versiones que exige el servidor.
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../utils/acceptanceDocuments.mjs';

type UIState = 'idle' | 'submitting' | 'success' | 'error';

interface ErrorInfo {
    message: string;
    code?: string;
}

interface DocStatus { id: string; version: string; title: string; url: string | null; approved: boolean }

/** Enlace al texto publicado, o aviso de que aún no está aprobado (nunca se presenta un borrador como aprobado). */
const DocLink: React.FC<{ doc: DocStatus | null; fallbackTitle: string }> = ({ doc, fallbackTitle }) => (
    doc?.approved && doc.url
        ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="underline text-indigo-600 dark:text-indigo-400">{doc.title} (v{doc.version.split('@')[1]})</a>
        : <span className="text-amber-700 dark:text-amber-400">{doc?.title ?? fallbackTitle}: pendiente de aprobación por Dirección</span>
);

const DECISION_MESSAGES: Record<string, string> = {
    DOCUMENTS_NOT_APPROVED: 'La activación todavía no está disponible: hay documentos pendientes de aprobación.',
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
    // V8.1-PROD-02B — A3 (Leo / IA) y A5 (transcripción de voz), opcionales: sin respuesta quedan pendientes.
    const [a3, setA3]                   = useState<'' | 'yes' | 'no'>('');
    const [a5, setA5]                   = useState<'' | 'yes' | 'no'>('');
    const [terms, setTerms]             = useState(false);
    const [mediatorCommitment, setMediatorCommitment] = useState(false);
    const [required, setRequired]       = useState<string[]>([]);
    // V8.1-CLOSE-06B: estado de los documentos según Dirección (aprobado + enlace publicado).
    const [docs, setDocs]               = useState<DocStatus[] | null>(null);
    useEffect(() => {
        let alive = true;
        fetch('/api/acceptance/documents', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((b) => { if (alive) setDocs(Array.isArray(b?.documents) ? b.documents : []); })
            .catch(() => { if (alive) setDocs([]); });
        return () => { alive = false; };
    }, []);
    const docOf = (id: string) => docs?.find((d) => d.id === id) ?? null;
    const baseDocsApproved = !!docs && ['001', '002'].every((id) => docOf(id)?.approved === true);

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
                        ...(a3 ? { A3: a3 } : {}),
                        ...(a5 ? { A5: a5 } : {}),
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
                        <ul className="text-xs space-y-1" aria-label="Documentos">
                            <li><DocLink doc={docOf('001')} fallbackTitle={DOCS.policy.title} /></li>
                            <li><DocLink doc={docOf('002')} fallbackTitle={DOCS.terms.title} /></li>
                            <li><DocLink doc={docOf('004')} fallbackTitle={DOCS.dataNotice.title} /></li>
                            {required.includes('C005') && <li><DocLink doc={docOf('005')} fallbackTitle={DOCS.mediator.title} /></li>}
                        </ul>
                        {docs && !baseDocsApproved && (
                            <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                                La activación estará disponible cuando Dirección publique las versiones aprobadas de estos documentos.
                            </p>
                        )}

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

                        <div>
                            <span className="text-sm text-gray-800 dark:text-gray-100">A3 · Leo, el asistente con inteligencia artificial (opcional).</span>
                            <Choice name="A3" value={a3} onChange={setA3} options={[['yes', 'Sí, autorizo'], ['no', 'No autorizo']]} />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Las preguntas a Leo y el contexto de la lectura se procesan con un proveedor de inteligencia artificial. Sin A3 no se usa Leo; la lectura no cambia. Si no respondes, queda pendiente.</p>
                        </div>

                        {/* V8.1-PROD-03D (DIR-V81-09): una sola A5 para las tres actividades de voz (004, ficha 6.3). Explicación antes de elegir. */}
                        <div role="group" aria-labelledby="a5-titulo" aria-describedby="a5-ayuda">
                            <span id="a5-titulo" className="text-sm text-gray-800 dark:text-gray-100">A5 · Voz: lectura en voz alta, dictado a Leo y respuestas orales (opcional).</span>
                            <ul id="a5-ayuda" className="text-xs text-gray-600 dark:text-gray-300 mt-1 mb-1 list-disc pl-5 space-y-1">
                                <li>Lectura en voz alta y dictado de preguntas a Leo: el servicio de reconocimiento de voz de tu navegador transcribe la voz (en Google Chrome es un servicio de Google). Chibalete no recibe la voz; del dictado solo recibe el texto de la pregunta, que además requiere A3.</li>
                                <li>Respuestas orales a tareas: la grabación se queda en este dispositivo solo mientras la usas y no se envía a nadie, tampoco a Chibalete.</li>
                                <li>Es una sola decisión para las tres actividades e independiente de A3. Sin A5 no se abre el micrófono: puedes seguir leyendo, leer en voz alta sin transcripción y escribir a Leo si autorizas A3. Si no respondes, queda pendiente.</li>
                            </ul>
                            <Choice name="A5" value={a5} onChange={setA5} options={[['yes', 'Sí, autorizo'], ['no', 'No autorizo']]} />
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
                        disabled={uiState === 'submitting' || !baseDocsApproved}
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
