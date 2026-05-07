/**
 * GroupDiagnosisPanel — Sprint visibilidad.
 *
 * Renderiza el GroupDiagnosis devuelto por GET /api/groups/:id/diagnosis.
 *
 * Reglas de diseño NO negociables:
 *   - Los textos `message`, `cause`, `recommendedAction` se muestran TAL CUAL.
 *     No se traducen, no se reescriben, no se simplifican. El backend ya entrega
 *     lenguaje listo para Aula Viva (Sprint visibilidad).
 *   - Aula Viva nunca queda "vacía sin explicación": si totalMembers === 0
 *     se muestra el warning group_empty con su cause y recommendedAction.
 *   - Base visual compatible con Modo accesible:
 *       · alto contraste (texto oscuro sobre fondo claro, badges con bg sólido)
 *       · tipografía legible (mínimo text-base, headings text-xl/lg)
 *       · jerarquía clara (headline → status badge → cards)
 *       · sin gradientes ni glass effects (ruido visual)
 *       · iconos con role/aria-hidden correctos
 *       · estructura semántica: <section>, <article>, <header>, <dl>
 *
 * Este NO es el rediseño visual final del Modo accesible — es la estructura
 * correcta para que el Modo accesible funcione después sin reescribir el árbol.
 */
import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import type {
    GroupDiagnosis,
    DiagnosisTone,
    InconsistencyItem,
    WarningItem,
} from '../../utils/groupDiagnosis';
// Sprint Modo accesible — el componente ya tiene base AA. Cuando el contexto
// del Modo accesible está activo, escalamos tipografía y padding. Sin cambiar
// contenido ni mensajes — solo presentación.
import { useModoAccesible } from '../../context/ModoAccesibleContext';

// ─── Estilos por tono ────────────────────────────────────────────────────────
//
// Colores escogidos para cumplir contraste WCAG AA (>=4.5:1) sobre fondo claro
// y para diferenciarse claramente entre sí. NO usar grises tenues o pastel.
//
// emerald-700 sobre blanco: contraste 4.83  (AA)
// amber-700  sobre blanco: contraste 4.51  (AA)
// rose-700   sobre blanco: contraste 5.13  (AA)
// Texto blanco sobre estos colores: contraste alto en todos los casos.
const TONE_STYLES: Record<DiagnosisTone, {
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
        label:      'Todo en orden',
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
        label:      'Inconsistencia',
    },
};

const ICON_BY_TONE: Record<DiagnosisTone, typeof CheckCircle2> = {
    ok:      CheckCircle2,
    warning: AlertTriangle,
    error:   AlertCircle,
};

// ─── Sub-componentes ─────────────────────────────────────────────────────────

/**
 * Renderiza un warning o una inconsistency. Los 3 textos vienen del backend
 * y se muestran tal cual.
 */
interface MessageItemProps {
    item: WarningItem | InconsistencyItem;
    tone: 'warning' | 'error';
}
const MessageItem: React.FC<MessageItemProps> = ({ item, tone }) => {
    const { activo } = useModoAccesible();
    const styles = TONE_STYLES[tone];
    const Icon   = ICON_BY_TONE[tone];
    // Variantes mínimas activadas por el Modo accesible.
    const padding   = activo ? 'p-7'    : 'p-5';
    const titleSize = activo ? 'text-xl' : 'text-lg';
    const bodySize  = activo ? 'text-lg' : 'text-base';
    const iconSize  = activo ? 28        : 24;
    const indent    = activo ? 'ml-11'   : 'ml-9';
    return (
        <article className={`border-l-4 ${styles.cardBorder} ${styles.cardBg} text-gray-900 rounded-r-md ${padding}`}>
            <header className="flex items-start gap-3 mb-3">
                <Icon size={iconSize} aria-hidden="true" className={`flex-shrink-0 mt-0.5 ${styles.iconColor}`} />
                <h3 className={`${titleSize} font-semibold leading-snug`}>{item.message}</h3>
            </header>
            <dl className={`${indent} space-y-3 ${bodySize}`}>
                <div>
                    <dt className="font-semibold text-gray-700">Por qué pasa</dt>
                    <dd className="mt-0.5 text-gray-900">{item.cause}</dd>
                </div>
                <div>
                    <dt className="font-semibold text-gray-700">Qué hacer</dt>
                    <dd className="mt-0.5 text-gray-900">{item.recommendedAction}</dd>
                </div>
            </dl>
        </article>
    );
};

/** Estado de carga: no dejar la UI en blanco. */
function LoadingState() {
    return (
        <section
            aria-busy="true"
            aria-live="polite"
            className="bg-white border border-gray-200 rounded-lg p-6"
        >
            <p className="text-base text-gray-700">Cargando diagnóstico del grupo…</p>
        </section>
    );
}

/** Estado de error: el diagnóstico mismo no se pudo leer. */
function ErrorState({ message }: { message: string }) {
    return (
        <section
            role="alert"
            className="bg-white border-l-4 border-rose-700 rounded-r-md p-6"
        >
            <header className="flex items-start gap-3">
                <AlertCircle size={28} aria-hidden="true" className="flex-shrink-0 mt-0.5 text-rose-700" />
                <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">No se pudo obtener el diagnóstico</h2>
                    <p className="text-base text-gray-900">{message}</p>
                </div>
            </header>
        </section>
    );
}

// ─── Componente principal ────────────────────────────────────────────────────

export interface GroupDiagnosisPanelProps {
    diagnosis: GroupDiagnosis | null;
    loading?:  boolean;
    error?:    string | null;
}

export function GroupDiagnosisPanel({ diagnosis, loading, error }: GroupDiagnosisPanelProps) {
    const { activo } = useModoAccesible();
    if (loading)  return <LoadingState />;
    if (error)    return <ErrorState message={error} />;
    if (!diagnosis) return null;

    const tone   = diagnosis.summary.tone;
    const styles = TONE_STYLES[tone];
    const Icon   = ICON_BY_TONE[tone];
    // Variantes mínimas para Modo accesible.
    const headerPadding   = activo ? 'p-8'    : 'p-6';
    const headlineSize    = activo ? 'text-2xl' : 'text-xl';
    const bodyPadding     = activo ? 'p-8'    : 'p-6';
    const itemSpacing     = activo ? 'space-y-6' : 'space-y-4';

    // Inconsistencias primero — son las que requieren atención inmediata.
    // `rowId` (no `key`) para no colisionar con la prop reservada de React.
    const items: Array<{ rowId: string; item: WarningItem | InconsistencyItem; tone: 'warning' | 'error' }> = [
        ...diagnosis.inconsistencies.map((item, i) => ({ rowId: `inc-${i}-${item.type}`,  item, tone: 'error'   as const })),
        ...diagnosis.warnings.map((item, i)        => ({ rowId: `warn-${i}-${item.type}`, item, tone: 'warning' as const })),
    ];

    return (
        <section
            aria-labelledby="group-diagnosis-headline"
            className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
        >
            {/* ─── Header: badge + headline ─────────────────────────────── */}
            <header className={`${headerPadding} border-b border-gray-200`}>
                <div className="flex items-start gap-4">
                    <div
                        aria-hidden="true"
                        className={`flex-shrink-0 w-12 h-12 rounded-full ${styles.badgeBg} flex items-center justify-center`}
                    >
                        <Icon size={28} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${styles.badgeBg} ${styles.badgeText} uppercase tracking-wide`}>
                                {styles.label}
                            </span>
                            <span className="text-sm font-medium text-gray-700">
                                {diagnosis.totalMembers} {diagnosis.totalMembers === 1 ? 'estudiante' : 'estudiantes'}
                            </span>
                            {diagnosis.school && (
                                <span className="text-sm font-medium text-gray-500">· {diagnosis.school}</span>
                            )}
                        </div>
                        <h2
                            id="group-diagnosis-headline"
                            className={`${headlineSize} font-bold text-gray-900 leading-snug`}
                        >
                            {diagnosis.summary.headline}
                        </h2>
                    </div>
                </div>
            </header>

            {/* ─── Body: items (errores → warnings) ─────────────────────── */}
            {items.length > 0 && (
                <div className={`${bodyPadding} ${itemSpacing}`}>
                    {items.map(({ rowId, item, tone: itemTone }) => (
                        <MessageItem key={rowId} item={item} tone={itemTone} />
                    ))}
                </div>
            )}
        </section>
    );
}
