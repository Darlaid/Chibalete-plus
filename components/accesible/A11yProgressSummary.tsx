/**
 * A11yProgressSummary — bloque de "estado de lectura" en la sidebar.
 *
 * Antes vivía dentro de A11yReaderNavigation, mezclado con los controles.
 * Se separó para:
 *   - jerarquía visual: progreso es "información de orientación", no "control".
 *   - permitir que A11yReaderNavigation sea puramente compacto (botones).
 *   - no duplicar el announcer-polite que ya emite cambios de capítulo/párrafo.
 *
 * Render (UX-3B — sólo texto, sin <progress>):
 *   - 1 línea con título del libro (opcional)
 *   - 1 línea "Cap N/M: {título capítulo}"
 *   - 1 línea "Párrafo Z de W (NN%)"
 *
 * Por qué se eliminó el <progress> bar fina:
 *   El header del shell ya expone una <progress aria-label="Progreso de lectura">
 *   visible siempre. Tener una segunda <progress> aquí con un aria-label
 *   distinto ("Progreso del libro") forzaba al lector de pantalla a
 *   anunciar dos progreso-meters diferentes para el mismo dato. UX-3B
 *   elimina el duplicado: el header es la única fuente visual de progreso.
 *
 * Sin role="status" — el announcer-polite del nav hook ya cubre los cambios
 * dinámicos. Este bloque es display estático.
 *
 * Devuelve null si no hay párrafos: durante loading/error no tiene sentido
 * mostrar progreso falso.
 */

import React from 'react';
import type { ReaderNavigationApi } from '../../hooks/useA11yReaderNavigation';

interface A11yProgressSummaryProps {
    nav: ReaderNavigationApi;
    bookTitle?: string;
}

const A11yProgressSummary: React.FC<A11yProgressSummaryProps> = ({ nav, bookTitle }) => {
    if (nav.totalParagraphs === 0) return null;

    return (
        <div className="space-y-1.5 text-sm leading-snug">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Progreso
            </p>

            {bookTitle && (
                <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                    {bookTitle}
                </p>
            )}

            {nav.currentChapterTitle && (
                <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    Cap. {nav.currentChapterIndex + 1}/{nav.totalChapters}: {nav.currentChapterTitle}
                </p>
            )}

            {/* UX-4B — contador "Sección X de Y". Antes decía "Párrafo
                X de Y" pero los valores nunca representaron párrafos HTML
                — siempre fueron ReadingSegment (ventanas cognitivas).
                "Sección" describe lo que el usuario realmente avanza al
                pulsar los botones; los BOTONES siguen llamándose "párrafo"
                por claridad infantil. El % sigue siendo paragraph-based:
                progresa suave con scroll natural mientras el contador X/Y
                se mueve en chunks porque cada salto representa una
                ventana cognitiva completa. */}
            <p className="text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                {nav.totalSegments > 0 && nav.currentSegmentIndex >= 0
                    ? `Sección ${nav.currentSegmentIndex + 1} de ${nav.totalSegments}`
                    : `Sección — de —`}
                {' '}({nav.progressPercent}%)
            </p>
        </div>
    );
};

export default A11yProgressSummary;
