import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Download, RefreshCw, CheckCircle, AlertTriangle, RotateCcw, LifeBuoy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLuAnalytics } from '../hooks/useLuAnalytics';

interface LUConfig {
    version: string;
    apkUrl: string;
    forceUpdate: boolean;
    /**
     * Se conserva en el contrato porque `/api/lu/version` lo sirve y otros
     * consumidores pueden leerlo, pero NO se renderiza en esta página: es texto
     * de release desactualizado y esta pantalla es pública (CHP-…-PAGE-01B).
     */
    notes: string;
    minSupportedVersion: string;
}

type Status = 'loading' | 'ok' | 'error';

/**
 * Valida el destino del APK antes de renderizar el enlace de descarga.
 *
 * Esta página es pública y se difunde por campaña, así que el `href` no puede
 * salir directo del JSON del servidor sin comprobar. Acepta únicamente:
 *   - ruta relativa, o URL absoluta del MISMO origen que la página;
 *   - HTTPS (se permite http solo en localhost/127.0.0.1 para desarrollo);
 *   - pathname bajo /uploads/ o /downloads/;
 *   - nombre terminado en .apk;
 *   - sin usuario, contraseña, query ni fragmento.
 *
 * Rechaza por tanto dominio externo, protocol-relative (//host), javascript:,
 * data:, http externo, rutas fuera de esas dos carpetas y ficheros no .apk.
 * El pathname que expone URL ya viene normalizado, de modo que un `..` no puede
 * escapar del prefijo comprobado.
 *
 * Pura y con el origen inyectado: así es verificable sin DOM.
 */
export function isSafeApkUrl(rawUrl: unknown, pageOrigin: string): boolean {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return false;

    let base: URL;
    let target: URL;
    try {
        base = new URL(pageOrigin);
        target = new URL(rawUrl, base);
    } catch {
        return false;
    }

    // Mismo origen. Cubre dominio externo, protocol-relative, javascript: y data:
    // (esos esquemas producen origin 'null', que nunca coincide).
    if (target.origin !== base.origin) return false;

    const isLocalhost = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
    if (target.protocol !== 'https:' && !isLocalhost) return false;

    if (target.username !== '' || target.password !== '') return false;
    if (target.search !== '' || target.hash !== '') return false;

    const p = target.pathname;
    if (!p.startsWith('/uploads/') && !p.startsWith('/downloads/')) return false;
    if (!p.toLowerCase().endsWith('.apk')) return false;

    return true;
}

const ChibaleteLU: React.FC = () => {
    const [config, setConfig] = useState<LUConfig | null>(null);
    const [status, setStatus] = useState<Status>('loading');

    const { user } = useAuth();
    const analytics = useLuAnalytics({
        userId:  user?.id,
        enabled: !!user?.id,
    });

    // Refs para que la closure de fetchConfig siempre vea los trackers
    // actuales sin re-crear la función ni mutar dependencias.
    const analyticsRef = useRef(analytics);
    analyticsRef.current = analytics;

    // Guards para emitir cada *_view a lo sumo una vez por sesión, aunque
    // el usuario haga refresh manual (botón "Intentar de nuevo").
    const installViewSentRef = useRef(false);
    const offlineViewSentRef = useRef(false);

    const fetchConfig = () => {
        setStatus('loading');
        fetch('/api/lu/version')
            .then(r => {
                if (!r.ok) throw new Error(`Error ${r.status}`);
                return r.json();
            })
            .then((data: LUConfig) => {
                setConfig(data);
                setStatus('ok');
                analyticsRef.current.trackVersionCheck({
                    version:               data.version,
                    apkUrlAvailable:       typeof data.apkUrl === 'string' && data.apkUrl.length > 0,
                    releaseNotesAvailable: typeof data.notes === 'string' && data.notes.length > 0,
                });
            })
            .catch((err: unknown) => {
                setStatus('error');
                analyticsRef.current.trackDownloadError({
                    errorType: 'version_fetch_failed',
                    message:   err instanceof Error ? err.message : 'unknown',
                });
            });
    };

    useEffect(() => {
        analyticsRef.current.trackPageView({ route: '/chibalete-lu' });
        fetchConfig();
    }, []);

    // Una vez que la pantalla muestra instrucciones / ayuda offline (siempre
    // visibles cuando status='ok'), emitir el *_view exactamente una vez.
    useEffect(() => {
        if (status !== 'ok') return;
        if (!installViewSentRef.current) {
            analyticsRef.current.trackInstallInstructionsView();
            installViewSentRef.current = true;
        }
        if (!offlineViewSentRef.current) {
            analyticsRef.current.trackOfflineHelpView();
            offlineViewSentRef.current = true;
        }
    }, [status]);

    // Destino validado. null → no se renderiza ningún <a> descargable.
    const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const apkHrefIsSafe = !!config && isSafeApkUrl(config.apkUrl, pageOrigin);

    const handleDownloadClick = () => {
        const version = config?.version ?? '';
        const apkUrl  = config?.apkUrl  ?? '';
        if (!apkUrl) {
            analyticsRef.current.trackDownloadError({
                errorType: 'apk_url_missing',
                message:   'apkUrl no disponible en la configuración',
                version,
            });
            return;
        }
        analyticsRef.current.trackDownloadStart({ version, apkUrl });
        // El <a download> dispara la descarga del browser de forma nativa;
        // desde el frontend no podemos confirmar bytes recibidos, sólo el
        // hito del click. Por eso method='browser_download'.
        analyticsRef.current.trackDownloadSuccess({ version, method: 'browser_download' });
    };

    const stepNumber = (n: number) => (
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center">{n}</span>
    );

    return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto">
            {/* Encabezado */}
            <div className="flex items-center gap-3 mb-2">
                <Smartphone size={28} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Chibalete LU</h1>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-8 ml-1">
                Versión ligera de Chibalete+ para dispositivos Android. Página oficial de descarga.
            </p>

            {/* Estado: cargando */}
            {status === 'loading' && (
                <div className="flex items-center gap-3 p-6 bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <RefreshCw size={20} className="text-indigo-500 animate-spin flex-shrink-0" />
                    <span className="text-gray-500 dark:text-gray-400 text-sm">Cargando información…</span>
                </div>
            )}

            {/* Estado: error */}
            {status === 'error' && (
                <div className="p-6 bg-white dark:bg-gray-800/50 rounded-xl border border-red-100 dark:border-red-900/40 shadow-sm">
                    <div className="flex items-start gap-3 mb-4">
                        <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">No se pudo cargar la información de Chibalete LU</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifica tu conexión e intenta de nuevo.</p>
                        </div>
                    </div>
                    <button
                        onClick={fetchConfig}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <RefreshCw size={15} />
                        Intentar de nuevo
                    </button>
                </div>
            )}

            {/* Estado: ok */}
            {status === 'ok' && config && (
                <>
                    {/* Banner forceUpdate */}
                    {config.forceUpdate && (
                        <div className="flex items-start gap-3 p-4 mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl">
                            <AlertTriangle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-bold text-red-700 dark:text-red-300">Debes actualizar Chibalete LU para continuar</p>
                                <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">
                                    La versión instalada ya no es compatible. Descarga la nueva versión a continuación.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Tarjeta principal de descarga */}
                    <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 mb-6">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                            <div>
                                <span className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Versión disponible</span>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{config.version}</p>
                            </div>
                            {config.forceUpdate ? (
                                <span className="flex items-center gap-1.5 px-3 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm font-semibold rounded-full border border-red-200 dark:border-red-800/40">
                                    <AlertTriangle size={14} />
                                    Actualización requerida
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm font-semibold rounded-full border border-green-100 dark:border-green-800/40">
                                    <CheckCircle size={14} />
                                    Disponible
                                </span>
                            )}
                        </div>

                        {apkHrefIsSafe ? (
                            <a
                                href={config.apkUrl}
                                download
                                onClick={handleDownloadClick}
                                className="flex items-center justify-center gap-2 w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl transition-colors shadow-sm text-base"
                            >
                                <Download size={18} />
                                Descargar para Android
                            </a>
                        ) : (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-semibold text-red-700 dark:text-red-300">La descarga no está disponible en este momento</p>
                                        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                                            No pudimos verificar el origen del archivo, así que no mostramos el enlace. Intenta de nuevo más tarde o avisa a la persona que te envió este enlace.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={fetchConfig}
                                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                                >
                                    <RefreshCw size={15} />
                                    Intentar de nuevo
                                </button>
                            </div>
                        )}

                        <p className="text-xs text-center text-gray-400 dark:text-gray-500 mt-3">
                            Requiere Android. Versión mínima soportada: {config.minSupportedVersion}
                        </p>
                    </div>

                    {/* Actualización — para quienes YA tienen Chibalete LU */}
                    <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            <RotateCcw size={18} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                            <h2 className="font-bold text-gray-800 dark:text-gray-100">Si ya tienes Chibalete LU</h2>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            Antes de empezar, ten a mano la contraseña con la que entra ese equipo: la vas a necesitar al final.
                        </p>
                        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                            <li className="flex gap-3">
                                {stepNumber(1)}
                                <span>Descarga el archivo con el botón de arriba e <strong className="text-gray-800 dark:text-gray-200">instálalo encima de la aplicación que ya está instalada</strong>.</span>
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(2)}
                                <span><strong className="text-gray-800 dark:text-gray-200">No desinstales Chibalete LU</strong> y <strong className="text-gray-800 dark:text-gray-200">no borres sus datos</strong>. Instalando encima se conservan el libro y el progreso.</span>
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(3)}
                                <span>Cuando termine, <strong className="text-gray-800 dark:text-gray-200">abre Chibalete LU con internet</strong>.</span>
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(4)}
                                <span><strong className="text-gray-800 dark:text-gray-200">Es normal que te pida iniciar sesión de nuevo.</strong> No es un error y no se ha perdido nada: entra con la cuenta de siempre de ese equipo.</span>
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(5)}
                                <span>Abre una lectura para confirmar que todo quedó funcionando.</span>
                            </li>
                        </ol>
                    </div>

                    {/* Primera instalación */}
                    <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 mb-6">
                        <h2 className="font-bold text-gray-800 dark:text-gray-100 mb-4">Si es tu primera instalación</h2>
                        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                            <li className="flex gap-3">
                                {stepNumber(1)}
                                Descarga el archivo APK con el botón de arriba.
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(2)}
                                Ábrelo y autoriza la instalación cuando Android te lo solicite.
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(3)}
                                Inicia sesión con la cuenta correspondiente.
                            </li>
                            <li className="flex gap-3">
                                {stepNumber(4)}
                                Descarga la lectura asignada y ábrela.
                            </li>
                        </ol>
                    </div>

                    {/* Ayuda */}
                    <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800/40 p-5 mb-6">
                        <LifeBuoy size={20} className="text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
                            Si aparece un error, no desinstales la aplicación. Contacta a la persona que te envió este enlace.
                        </p>
                    </div>

                    {/* Propósito */}
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/40 p-5">
                        <h2 className="font-bold text-indigo-800 dark:text-indigo-200 mb-2 text-sm uppercase tracking-wide">¿Para qué sirve?</h2>
                        <p className="text-sm text-indigo-700 dark:text-indigo-300 leading-relaxed">
                            Chibalete LU es una versión liviana pensada para dispositivos modestos. Permite leer y continuar donde lo dejaste, sin necesidad de una conexión constante. La misma cuenta, el mismo catálogo, sin pasos extra.
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};

export default ChibaleteLU;
