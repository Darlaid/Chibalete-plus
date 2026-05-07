/**
 * StudentStatusPanel — Sprint Panel del estudiante.
 *
 * Espejo de GroupDiagnosisPanel para un lector individual. Renderiza el
 * StudentStatus devuelto por GET /api/students/:id/status.
 *
 * Reglas de diseño NO negociables (idénticas a GroupDiagnosisPanel):
 *   - `headline`, `message`, `cause`, `recommendedAction` se muestran TAL CUAL.
 *     No se traducen ni se reescriben — el backend ya entrega lenguaje listo.
 *   - El estudiante nunca queda "vacío": incluso 404/500 traen un payload con
 *     shape StudentStatus (state TECH_ISSUE), y este componente lo muestra.
 *   - Base visual compatible con Modo accesible (alto contraste, semántica HTML).
 */
import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Calendar, BookOpen, X } from 'lucide-react';
import type { StudentStatus, StudentStatusTone } from '../../utils/studentStatus';
// Sprint Modo accesible — base AA ya cumplida; cuando el contexto está activo
// escalamos tipografía, padding y tamaño del icono. Sin tocar contenido.
import { useModoAccesible } from '../../context/ModoAccesibleContext';
// Sprint Modo accesible (experiencia) — sustitutos pixel del progreso y el badge.
import { PixelProgressBar } from '../accesible/pixel/PixelProgressBar';
import { PixelBadge } from '../accesible/pixel/PixelBadge';

// Mismos estilos tonales que GroupDiagnosisPanel — coherencia visual cross-panel.
const TONE_STYLES: Record<StudentStatusTone, {
    badgeBg:    string;
    badgeText:  string;
    cardBorder: string;
    cardBg:     string;
    iconColor:  string;
    label:      string;
}> = {
    ok: {
        badgeBg:    'bg-emerald-700',
        badgeText:  'text-white',
        cardBorder: 'border-emerald-700',
        cardBg:     'bg-emerald-50',
        iconColor:  'text-emerald-700',
        label:      'Activo',
    },
    warning: {
        badgeBg:    'bg-amber-700',
        badgeText:  'text-white',
        cardBorder: 'border-amber-700',
        cardBg:     'bg-amber-50',
        iconColor:  'text-amber-700',
        label:      'Atención',
    },
    error: {
        badgeBg:    'bg-rose-700',
        badgeText:  'text-white',
        cardBorder: 'border-rose-700',
        cardBg:     'bg-rose-50',
        iconColor:  'text-rose-700',
        label:      'Problema',
    },
};

const ICON_BY_TONE: Record<StudentStatusTone, typeof CheckCircle2> = {
    ok:      CheckCircle2,
    warning: AlertTriangle,
    error:   AlertCircle,
};

// Formato fecha ES — sin librería, sin opinión sobre zona horaria del cliente.
function formatTimestamp(iso: string | null): string {
    if (!iso) return 'Sin registro';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Sin registro';
    return d.toLocaleString('es-CO', {
        year:   'numeric',
        month:  'short',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
    });
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function LoadingState() {
    return (
        <section
            aria-busy="true"
            aria-live="polite"
            className="bg-white border border-gray-200 rounded-lg p-6"
        >
            <p className="text-base text-gray-700">Cargando estado del estudiante…</p>
        </section>
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <section role="alert" className="bg-white border-l-4 border-rose-700 rounded-r-md p-6">
            <header className="flex items-start gap-3">
                <AlertCircle size={28} aria-hidden="true" className="flex-shrink-0 mt-0.5 text-rose-700" />
                <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">No se pudo obtener el estado del estudiante</h2>
                    <p className="text-base text-gray-900">{message}</p>
                </div>
            </header>
        </section>
    );
}

interface MetaItemProps {
    label:  string;
    value:  string;
    icon:   React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
}
const MetaItem: React.FC<MetaItemProps> = ({ label, value, icon: Icon }) => (
    <div className="flex items-start gap-2">
        <Icon size={18} aria-hidden={true} className="flex-shrink-0 mt-0.5 text-gray-500" />
        <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="text-base text-gray-900">{value}</dd>
        </div>
    </div>
);

// ─── Componente principal ────────────────────────────────────────────────────

export interface StudentStatusPanelProps {
    status:   StudentStatus | null;
    loading?: boolean;
    error?:   string | null;
    /** Si se provee, muestra un botón "Cerrar" que invoca este callback. */
    onClose?: () => void;
}

export function StudentStatusPanel({ status, loading, error, onClose }: StudentStatusPanelProps) {
    const { activo } = useModoAccesible();
    if (loading)  return <LoadingState />;
    if (error)    return <ErrorState message={error} />;
    if (!status)  return null;

    const tone   = status.tone;
    const styles = TONE_STYLES[tone];
    const Icon   = ICON_BY_TONE[tone];

    // Variantes mínimas activadas por el Modo accesible — solo presentación.
    const sectionPadding = activo ? 'p-8' : 'p-6';
    const nameSize       = activo ? 'text-3xl' : 'text-2xl';
    const headlineSize   = activo ? 'text-xl'  : 'text-lg';
    const messageSize    = activo ? 'text-xl'  : 'text-lg';
    const bodySize       = activo ? 'text-lg'  : 'text-base';
    const iconSize       = activo ? 28         : 24;
    const indent         = activo ? 'ml-11'    : 'ml-9';
    const cardPadding    = activo ? 'p-7'      : 'p-5';
    const cardMargin     = activo ? 'm-8'      : 'm-6';
    const closeBtnPad    = activo ? 'p-3 -m-3' : 'p-2 -m-2';

    return (
        <section
            aria-labelledby="student-status-headline"
            className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
        >
            {/* ─── Header: nombre + badge tonal + headline ─────────────── */}
            <header className={`${sectionPadding} border-b border-gray-200`}>
                <div className="flex items-start gap-4">
                    <div
                        aria-hidden="true"
                        className={`flex-shrink-0 w-12 h-12 rounded-full ${styles.badgeBg} flex items-center justify-center`}
                    >
                        <Icon size={28} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={`${nameSize} font-bold text-gray-900 leading-tight mb-1`}>
                            {status.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            {activo
                                ? <PixelBadge tone={tone}>{styles.label}</PixelBadge>
                                : (
                                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${styles.badgeBg} ${styles.badgeText} uppercase tracking-wide`}>
                                        {styles.label}
                                    </span>
                                )}
                            <span className="text-sm font-medium text-gray-500">
                                {status.state.replace(/_/g, ' ').toLowerCase()}
                            </span>
                        </div>
                        <h2
                            id="student-status-headline"
                            className={`${headlineSize} font-semibold text-gray-900 leading-snug`}
                        >
                            {status.headline}
                        </h2>
                    </div>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className={`flex-shrink-0 ${closeBtnPad} rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400`}
                            aria-label="Cerrar panel del estudiante"
                        >
                            <X size={activo ? 24 : 20} />
                        </button>
                    )}
                </div>
            </header>

            {/* ─── Metadatos: último ingreso · última lectura · progreso ── */}
            {/* En Modo accesible la última columna se reemplaza por una barra
                "nivel" pixel — más visual y más amigable. Cuando no está
                activo, se conserva el texto plano actual. */}
            <dl className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${sectionPadding} border-b border-gray-200`}>
                <MetaItem
                    label="Último ingreso"
                    icon={Calendar}
                    value={formatTimestamp(status.lastLoginAt)}
                />
                <MetaItem
                    label="Última lectura"
                    icon={BookOpen}
                    value={formatTimestamp(status.lastReadingEventAt)}
                />
                {activo && status.progress.booksStarted > 0 ? (
                    <div>
                        <PixelProgressBar
                            value={status.progress.percentage}
                            blocks={10}
                            label="Avance"
                            tone={tone === 'error' ? 'warning' : tone === 'ok' ? 'success' : 'primary'}
                        />
                        <p className="mt-1 text-sm text-gray-600">
                            {status.progress.booksCompleted}/{status.progress.booksStarted} libros
                        </p>
                    </div>
                ) : (
                    <MetaItem
                        label="Avance"
                        icon={BookOpen}
                        value={
                            status.progress.booksStarted > 0
                                ? `${status.progress.percentage}% · ${status.progress.booksCompleted}/${status.progress.booksStarted} libros`
                                : 'Sin lecturas iniciadas'
                        }
                    />
                )}
            </dl>

            {/* ─── Mensaje narrativo: message + cause + recommendedAction ── */}
            <article className={`${cardMargin} border-l-4 ${styles.cardBorder} ${styles.cardBg} text-gray-900 rounded-r-md ${cardPadding}`}>
                <header className="flex items-start gap-3 mb-3">
                    <Icon size={iconSize} aria-hidden="true" className={`flex-shrink-0 mt-0.5 ${styles.iconColor}`} />
                    <h3 className={`${messageSize} font-semibold leading-snug`}>{status.message}</h3>
                </header>
                <dl className={`${indent} space-y-3 ${bodySize}`}>
                    <div>
                        <dt className="font-semibold text-gray-700">Por qué pasa</dt>
                        <dd className="mt-0.5 text-gray-900">{status.cause}</dd>
                    </div>
                    <div>
                        <dt className="font-semibold text-gray-700">Qué hacer</dt>
                        <dd className="mt-0.5 text-gray-900">{status.recommendedAction}</dd>
                    </div>
                </dl>
            </article>
        </section>
    );
}
