/**
 * A11yReaderNavigation — controles de navegación del Modo accesible.
 *
 * Refactor UX-2A: pasa de "iconos cuadrados HTML" a PixelButton con
 * etiquetas REALES ("Capítulo anterior" / "Siguiente capítulo" / …).
 * El contador (ej. "5 / 6") deja de ser un span entre dos flechas y se
 * convierte en texto label arriba del par — más claro para niñas y
 * niños y más legible con lector de pantalla.
 *
 * Layout por grupo:
 *
 *     Capítulo 5 / 6
 *     [ ◀ Capítulo anterior      ]   PixelButton w-full neutral md
 *     [ Siguiente capítulo ▶     ]
 *     Párrafo 7 / 42
 *     [ ◀ Párrafo anterior       ]
 *     [ Siguiente párrafo ▶      ]
 *
 * Decisiones de diseño:
 *   - tone="neutral": chrome de lectura, no acción comercial. Convive
 *     mejor con los temas a11y (claro, oscuro, sistema) que un acento
 *     de color. La identidad pixel viene del stamp shadow + bordes
 *     duros + press translate, no del color.
 *   - size="md": 48px de alto, AAA para target size, no domina el
 *     ancho de 288px de la sidebar.
 *   - w-full: los cuatro botones del bloque alinean verticalmente y
 *     leen como una columna unificada.
 *   - disabled HTML real cuando no hay anterior/siguiente: PixelButton
 *     atenúa visualmente y desactiva pointer events.
 *   - aria-label completo en cada flecha como antes; ChevronLeft/Right
 *     siguen aria-hidden.
 *
 * UX-4A — Segmentación adaptativa:
 *   Los botones "Siguiente párrafo" / "Párrafo anterior" navegan ENTRE
 *   ReadingSegment, no entre <p> HTML. El nombre visible de los BOTONES
 *   se preserva por claridad infantil (regla de producto explícita).
 *
 * UX-4B — Calibración perceptual:
 *   - Targets reducidos (~180 palabras desktop / ~100 mobile) para que
 *     1 clic = 1 avance humano, no un salto grande de contexto.
 *   - El CONTADOR cambia a "Sección X / Y" porque "Párrafo X / Y" era
 *     conceptualmente incorrecto: ya no son párrafos HTML reales. La
 *     palabra "Sección" describe lo que el usuario realmente avanza —
 *     una ventana cognitiva — sin tecnicismos como "segmento" o "tramo".
 *     Los BOTONES siguen siendo "párrafo" por claridad infantil.
 *
 *   El contador "Capítulo X / Y" sigue siendo capítulos HTML reales —
 *   los capítulos son una unidad pedagógica natural y no se segmentan.
 */

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PixelButton } from './pixel/PixelButton';
import type { ReaderNavigationApi } from '../../hooks/useA11yReaderNavigation';

interface A11yReaderNavigationProps {
    nav: ReaderNavigationApi;
}

const LEGEND       = 'text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400';
const COUNTER_LINE = 'text-xs tabular-nums text-gray-700 dark:text-gray-300';

const A11yReaderNavigation: React.FC<A11yReaderNavigationProps> = ({ nav }) => {
    if (nav.totalParagraphs === 0) return null;

    const chapterCounter = nav.currentChapterIndex >= 0
        ? `${nav.currentChapterIndex + 1} / ${nav.totalChapters}`
        : '— / —';
    // UX-4B — contador "Sección X / Y". Antes decía "Párrafo X / Y" pero
    // los valores nunca correspondieron a párrafos HTML — siempre fueron
    // ReadingSegment (ventanas cognitivas). Se renombra a "Sección" para
    // que el contador describa la unidad real. Los BOTONES siguen siendo
    // "Siguiente párrafo / Párrafo anterior" por claridad infantil.
    const segmentCounter = nav.totalSegments > 0 && nav.currentSegmentIndex >= 0
        ? `${nav.currentSegmentIndex + 1} / ${nav.totalSegments}`
        : '— / —';

    return (
        <nav id="a11y-reader-nav" aria-label="Navegación de lectura" className="space-y-4">
            {/* Eyebrow del bloque. aria-hidden porque el <nav aria-label="…">
                ya nombra el landmark; sin esto el lector de pantalla anunciaría
                "Navegación" dos veces seguidas. */}
            <p className={LEGEND} aria-hidden="true">
                Navegación
            </p>

            {/* CAPÍTULOS */}
            <div role="group" aria-labelledby="a11y-nav-cap-legend" className="space-y-2">
                <p id="a11y-nav-cap-legend" className={COUNTER_LINE}>
                    Capítulo {chapterCounter}
                </p>
                <PixelButton
                    tone="neutral"
                    size="md"
                    icon={ChevronLeft}
                    disabled={!nav.hasPrevChapter}
                    onClick={nav.goToPrevChapter}
                    aria-label="Ir al capítulo anterior"
                    className="w-full"
                >
                    Capítulo anterior
                </PixelButton>
                <PixelButton
                    tone="neutral"
                    size="md"
                    disabled={!nav.hasNextChapter}
                    onClick={nav.goToNextChapter}
                    aria-label="Ir al siguiente capítulo"
                    className="w-full"
                >
                    Siguiente capítulo
                    <ChevronRight size={20} aria-hidden="true" />
                </PixelButton>
            </div>

            {/* SECCIONES (botones siguen llamándose "Párrafo" por claridad infantil) */}
            <div role="group" aria-labelledby="a11y-nav-par-legend" className="space-y-2">
                <p id="a11y-nav-par-legend" className={COUNTER_LINE}>
                    Sección {segmentCounter}
                </p>
                <PixelButton
                    tone="neutral"
                    size="md"
                    icon={ChevronLeft}
                    disabled={!nav.hasPrevSegment}
                    onClick={nav.goToPrevSegment}
                    aria-label="Ir al párrafo anterior"
                    className="w-full"
                >
                    Párrafo anterior
                </PixelButton>
                <PixelButton
                    tone="neutral"
                    size="md"
                    disabled={!nav.hasNextSegment}
                    onClick={nav.goToNextSegment}
                    aria-label="Ir al siguiente párrafo"
                    className="w-full"
                >
                    Siguiente párrafo
                    <ChevronRight size={20} aria-hidden="true" />
                </PixelButton>
            </div>
        </nav>
    );
};

export default A11yReaderNavigation;
