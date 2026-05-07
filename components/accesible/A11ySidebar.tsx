/**
 * A11ySidebar — panel de lectura del Modo accesible.
 *
 * Acompañamiento lector. UX-2B: cada bloque vive en su propio
 * <PixelPanel> autocontenido — borde + stamp shadow propios. La
 * separación entre bloques la da el `gap-5` del <aside> padre.
 *
 *     ┌──────────────────┐   ← PixelPanel
 *     │ PROGRESO         │
 *     │ ...              │
 *     └──────────────────┘
 *     ┌──────────────────┐   ← PixelPanel
 *     │ NAVEGACIÓN       │
 *     │ Capítulo anterior│
 *     │ Siguiente cap.   │
 *     │ Párrafo anterior │
 *     │ Siguiente párr.  │
 *     └──────────────────┘
 *     ┌──────────────────┐   ← PixelPanel
 *     │ Índice (6) ⌄     │
 *     └──────────────────┘
 *     ┌──────────────────┐   ← PixelPanel
 *     │ Lectura ⌄        │
 *     └──────────────────┘
 *
 * Reglas:
 *   - Lectura SIEMPRE visible (también en loading/error).
 *   - Progreso, Navegación e Índice solo si hay book + párrafos / capítulos.
 *   - El botón "Volver" vive en el header del shell (no acá).
 *   - Desktop: TOC abierto por default (matchMedia al mount).
 *   - Mobile: TOC y Lectura mutuamente excluyentes — abrir uno cierra el otro.
 *   - Skip link "Saltar al índice" dispara CustomEvent que aquí se escucha
 *     y expande el TOC + foco al primer link.
 *   - Lectura abre INLINE (no absolute) — el contenedor sidebar maneja el
 *     scroll global; evita panel cortado por overflow.
 *
 * Performance:
 *   - Cero re-render del documento. Las CSS vars siguen heredando del root
 *     del shell. Settings/TOC state son locales a esta sidebar.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import A11yReaderNavigation from './A11yReaderNavigation';
import A11yReadingSettings from './A11yReadingSettings';
import A11yTableOfContents from './A11yTableOfContents';
import A11yProgressSummary from './A11yProgressSummary';
import { A11Y_REQUEST_TOC_EXPAND } from './A11ySkipLinks';
import { PixelButton } from './pixel/PixelButton';
import { PixelPanel } from './pixel/PixelPanel';
import type { A11yBook } from '../../types/a11y';
import type { ReaderNavigationApi } from '../../hooks/useA11yReaderNavigation';
import type { ReadingSettingsApi, ReadingLanguage } from '../../hooks/useA11yReadingSettings';

interface A11ySidebarProps {
    book: A11yBook | null;
    navigation: ReaderNavigationApi;
    settingsApi: ReadingSettingsApi;
    availableLanguages: ReadonlyArray<ReadingLanguage>;
}

const TOC_PANEL_ID = 'a11y-toc-panel';

// SECTION/FIRST_SECTION eliminados (UX-2B): cada bloque ahora vive en su
// propio <PixelPanel> autocontenido (border + stamp shadow). La separación
// entre bloques la da el `gap-5` del <aside> padre; ya no necesitamos
// border-t como divisor.
//
// TOGGLE_BTN eliminado en UX-2A: el toggle del Índice usa PixelButton.

/** matchMedia helper SSR-safe. Devuelve true si estamos en breakpoint md+. */
function isDesktopBreakpoint(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(min-width: 768px)').matches;
}

const A11ySidebar: React.FC<A11ySidebarProps> = ({
    book, navigation, settingsApi, availableLanguages,
}) => {
    // Estado lifted del TOC. Inicial: expandido en desktop, colapsado en mobile.
    // Sincronización SSR-safe via factory de useState (corre solo en mount).
    const [tocExpanded, setTocExpanded] = useState<boolean>(() => isDesktopBreakpoint());
    const [lecturaOpen, setLecturaOpen] = useState<boolean>(false);

    const hasBook        = !!book;
    const hasChapters    = !!book && book.chapters.length > 0;
    const hasParagraphs  = navigation.totalParagraphs > 0;

    // Mutual exclusion: en mobile, abrir uno cierra el otro. En desktop
    // pueden coexistir (la sidebar tiene espacio suficiente).
    const setTocSafe = useCallback((next: boolean) => {
        setTocExpanded(next);
        if (next && !isDesktopBreakpoint()) setLecturaOpen(false);
    }, []);
    const setLecturaSafe = useCallback((next: boolean) => {
        setLecturaOpen(next);
        if (next && !isDesktopBreakpoint()) setTocExpanded(false);
    }, []);

    const toggleToc = useCallback(() => setTocSafe(!tocExpanded), [tocExpanded, setTocSafe]);

    // Skip link "Saltar al índice" — escucha CustomEvent disparado por
    // A11ySkipLinks. Auto-expande el TOC + foco al primer link tras render.
    useEffect(() => {
        const handler = () => {
            setTocSafe(true);
            // Esperar al próximo frame para que el render del listado
            // termine antes de buscar el primer link.
            requestAnimationFrame(() => {
                const firstLink = document.querySelector<HTMLAnchorElement>(
                    `#${TOC_PANEL_ID} a`
                );
                if (firstLink) {
                    firstLink.focus();
                    return;
                }
                // Fallback: si no hay capítulos, dejamos foco en el botón
                // (el skip link ya lo enfocó por su side-effect default).
                document.getElementById('a11y-toc-toggle')?.focus();
            });
        };
        document.addEventListener(A11Y_REQUEST_TOC_EXPAND, handler);
        return () => document.removeEventListener(A11Y_REQUEST_TOC_EXPAND, handler);
    }, [setTocSafe]);

    return (
        <aside
            id="a11y-controls"
            role="complementary"
            aria-label="Controles de lectura"
            tabIndex={-1}
            className={[
                // Mobile: barra inferior fija, layout vertical compacto.
                // UX-2C — bajamos presencia mobile: max-h 60vh→50vh,
                // gap-5→4, py-4→3. Sin nuevas interacciones, sin gestos:
                // sólo respiración. La sidebar deja de tapar media pantalla
                // cuando el usuario está leyendo. Desktop (md:) intacto.
                'fixed bottom-0 left-0 right-0 z-30',
                'border-t border-gray-200 dark:border-gray-800',
                'bg-white dark:bg-gray-950',
                'px-4 py-3',
                'flex flex-col gap-4',
                'max-h-[50vh] overflow-y-auto overscroll-contain',
                // UX-3B — safe-area-inset-bottom: en iPhones con home indicator
                // la barra inferior fija quedaba parcialmente bajo la zona del
                // gesto del sistema. Sumamos el inset al pb del aside para
                // que el último botón quede tocable. En Android sin notch la
                // env() es 0px → no afecta. Tailwind no tiene utility para
                // env(), por eso va inline via padding-bottom.
                'pb-[env(safe-area-inset-bottom)]',
                // Desktop preserva gap-5 (UX-1) — sólo mobile baja a gap-4.
                'md:gap-5',
                // Desktop (md+): override a sidebar derecha sticky vertical.
                // Un único scroll vertical (overflow-y-auto) — los paneles
                // internos NO crean scrolls anidados (Lectura es inline,
                // TOC tiene max-h propia para listas largas pero no es
                // problema: solo aplica con muchos capítulos).
                'md:static md:z-auto',
                'md:w-72 md:shrink-0 md:self-start',
                'md:sticky md:top-4',
                'md:bg-transparent dark:md:bg-transparent',
                'md:border-t-0 md:border-l md:border-l-gray-200 dark:md:border-l-gray-800',
                'md:py-0 md:pl-4 md:pr-0',
                'md:max-h-[calc(100vh-2rem)]',
                // Foco visible cuando llega vía skip link.
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2',
                'focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2',
            ].join(' ')}
        >
            {/* BLOQUE — Progreso. Solo si hay book con párrafos. */}
            {hasBook && hasParagraphs && (
                <PixelPanel>
                    <A11yProgressSummary nav={navigation} bookTitle={book?.title} />
                </PixelPanel>
            )}

            {/* BLOQUE — Navegación compacta. Solo si hay book con párrafos.
                Loading/error → no se muestra (no hay nada que navegar). */}
            {hasBook && hasParagraphs && (
                <PixelPanel>
                    <A11yReaderNavigation nav={navigation} />
                </PixelPanel>
            )}

            {/* BLOQUE — Índice colapsable. Solo si hay capítulos. El
                botón siempre lleva id="a11y-toc-toggle" — destino del
                skip link. */}
            {hasBook && hasChapters && (
                <PixelPanel>
                    {/* Toggle Índice — PixelButton neutral md, w-full. El id
                        "a11y-toc-toggle" se preserva: es el destino del skip
                        link "Saltar al índice" (A11ySkipLinks). El chevron
                        refleja el estado expandido/colapsado. */}
                    <PixelButton
                        id="a11y-toc-toggle"
                        onClick={toggleToc}
                        aria-expanded={tocExpanded}
                        aria-controls={TOC_PANEL_ID}
                        tone="neutral"
                        size="md"
                        icon={BookOpen}
                        className="w-full"
                    >
                        Índice ({book!.chapters.length})
                        {tocExpanded
                            ? <ChevronUp size={20} aria-hidden="true" />
                            : <ChevronDown size={20} aria-hidden="true" />}
                    </PixelButton>

                    {tocExpanded && (
                        <div id={TOC_PANEL_ID} className="mt-2">
                            <A11yTableOfContents
                                book={book}
                                onChapterSelect={navigation.goToChapterById}
                                embedded
                                activeChapterIndex={navigation.currentChapterIndex}
                            />
                        </div>
                    )}
                </PixelPanel>
            )}

            {/* BLOQUE — Lectura. Siempre visible.
                placement="inline" hace que el panel se expanda en el flujo
                de la sidebar — el contenedor sidebar maneja el scroll
                global. Evita que el panel quede recortado por overflow del
                padre. open/onOpenChange controlled para mutual exclusion
                con el TOC en mobile. */}
            <PixelPanel>
                <A11yReadingSettings
                    api={settingsApi}
                    availableLanguages={availableLanguages}
                    align="right"
                    placement="inline"
                    open={lecturaOpen}
                    onOpenChange={setLecturaSafe}
                />
            </PixelPanel>
        </aside>
    );
};

export default A11ySidebar;
