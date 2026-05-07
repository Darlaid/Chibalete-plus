/**
 * A11yTableOfContents — índice navegable del libro.
 *
 * Renderiza:
 *   <nav id="a11y-toc" aria-label="Índice del libro" tabindex="-1">
 *     <h2>Índice</h2>
 *     <ol>
 *       <li><a href="#chap-1">Capítulo 1</a></li>
 *       …
 *     </ol>
 *   </nav>
 *
 * Reglas:
 *   - Lista ordenada (<ol>) — los capítulos tienen orden semántico.
 *   - Cada item es un <a href="#chap-N"> que el lector de pantalla anuncia
 *     como link con destino claro (cumple WCAG 2.4.4 Link Purpose).
 *   - Click intercepta y mueve foco programáticamente al <section> del
 *     capítulo (que tiene tabIndex=-1). Necesario porque el proyecto usa
 *     HashRouter y un href "#chap-1" puede colisionar con la URL hash.
 *   - aria-current NO se implementa en Fase 2 (Fase 6: progress).
 *   - Estado vacío: si no hay capítulos, mensaje accesible dentro del nav.
 *
 * POST-G1:
 *   - El título "Índice" es <p>, no <h2>. El <h2> previo se mezclaba en
 *     heading navigation con los <h2> de capítulos del libro y rompía la
 *     expectativa "h2 = capítulo". El nav ya está etiquetado por
 *     aria-label="Índice del libro" — el accessible name no necesita el h2.
 *
 * Compatible con A11yShell: el id="a11y-toc" y el tabIndex=-1 permiten
 * que el skip link "Saltar al índice" siga funcionando.
 */

import React from 'react';
import type { A11yBook } from '../../types/a11y';

interface A11yTableOfContentsProps {
    book: A11yBook | null;
    /**
     * Callback opcional para sincronizar el state interno de navegación
     * (currentParagraphIndex, capítulo actual, progreso, regla focal).
     *
     * Cuando se pasa: el TOC delega COMPLETAMENTE en este callback (foco,
     * scroll y anuncio los maneja el navigation hook). Cuando NO se pasa
     * (uso fuera del visor accesible / tests aislados): comportamiento
     * legacy de focus + scroll local.
     */
    onChapterSelect?: (chapterId: string) => void;
    /**
     * Cuando true, el TOC se renderiza con padding/border reducidos para
     * embebido en sidebar (ya no es un bloque full-width entre header y main).
     * El comportamiento semántico es idéntico: <nav id="a11y-toc"> con
     * aria-label, lista <ol>, mismo handler de click.
     */
    embedded?: boolean;
    /**
     * Índice 0-based del capítulo actualmente activo en la lectura. Si se
     * pasa y matchea la posición de un capítulo, ese link recibe
     * aria-current="true" (WCAG 4.1.2 / WAI-ARIA: marca "estás aquí" en
     * navegación) y un estilo destacado.
     *
     * Si es undefined o -1, no se destaca nada (comportamiento legacy).
     */
    activeChapterIndex?: number;
}

const A11yTableOfContents: React.FC<A11yTableOfContentsProps> = ({
    book,
    onChapterSelect,
    embedded = false,
    activeChapterIndex,
}) => {
    const handleClick = (
        event: React.MouseEvent<HTMLAnchorElement>,
        targetId: string,
    ) => {
        event.preventDefault();
        // Si el visor proveyó un callback de sincronización, lo usamos
        // como única fuente de verdad. El nav hook se encarga de actualizar
        // currentParagraphIndex (que dispara regla focal y progreso),
        // mover foco al <section> y anunciar el cambio.
        //
        // Fallback robusto: si el callback lanza por cualquier razón,
        // caemos al comportamiento legacy (focus + scroll local) y emitimos
        // un warning solo en development. En producción el fallback es
        // silencioso — el user sigue navegando aunque algo esté mal en
        // el wiring.
        if (onChapterSelect) {
            try {
                onChapterSelect(targetId);
                return;
            } catch (e) {
                if (import.meta.env.DEV) {
                    console.warn(
                        '[A11yTableOfContents] onChapterSelect lanzó excepción; usando fallback legacy.',
                        e,
                    );
                }
                // Cae al fallback de abajo.
            }
        }
        // Comportamiento legacy: focus + scroll local.
        const target = document.getElementById(targetId);
        if (!target) return;
        target.focus();
        target.scrollIntoView({ block: 'start' });
    };

    const hasChapters = book !== null && book.chapters.length > 0;

    return (
        <nav
            id="a11y-toc"
            aria-label="Índice del libro"
            tabIndex={-1}
            className={[
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2',
                'focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2',
                embedded
                    ? 'rounded'              // sin padding ni border — el contenedor (sidebar) los provee
                    : 'px-6 py-4 border-b border-gray-200 dark:border-gray-800',
            ].join(' ')}
        >
            {/* En modo embedded el botón expandible (en sidebar) ya muestra
                la palabra "Índice" — evitamos duplicarla. En modo standalone
                mantenemos el header visual. */}
            {!embedded && (
                <p className="text-lg font-semibold mb-2">Índice</p>
            )}

            {!hasChapters && (
                <p className="text-sm text-gray-600 dark:text-gray-400 italic">
                    Índice no disponible.
                </p>
            )}

            {hasChapters && (
                <ol className={[
                    'list-decimal list-inside space-y-1 marker:text-gray-500',
                    // En sidebar embebida la lista puede crecer mucho; le
                    // damos altura máxima con scroll interno para no estirar
                    // la sidebar entera.
                    embedded ? 'max-h-64 overflow-y-auto overscroll-contain text-sm pr-1' : '',
                ].join(' ')}>
                    {book!.chapters.map((c, idx) => {
                        const isActive = typeof activeChapterIndex === 'number'
                            && activeChapterIndex === idx;
                        return (
                            <li key={c.id}>
                                <a
                                    href={`#${c.id}`}
                                    onClick={(e) => handleClick(e, c.id)}
                                    aria-current={isActive ? 'true' : undefined}
                                    className={[
                                        'text-blue-700 dark:text-blue-400 hover:underline rounded',
                                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2',
                                        'focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2',
                                        // Capítulo activo: destacado visual.
                                        // aria-current="true" es la fuente
                                        // semántica para AT; el estilo es
                                        // refuerzo visual para sighted.
                                        isActive
                                            ? 'font-semibold bg-blue-50 dark:bg-blue-900/30 px-1'
                                            : '',
                                    ].filter(Boolean).join(' ')}
                                >
                                    {c.heading.text}
                                </a>
                            </li>
                        );
                    })}
                </ol>
            )}
        </nav>
    );
};

export default A11yTableOfContents;
