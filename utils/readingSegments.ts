/**
 * readingSegments — Sprint UX-4A.
 *
 * Lógica pura de segmentación adaptativa para el Modo accesible. Reemplaza
 * la "navegación por párrafo HTML" (que produce saltos arbitrarios — un
 * párrafo puede ser una línea o veinte) por VENTANAS COGNITIVAS DE LECTURA:
 * agrupaciones de párrafos consecutivos que representan una cantidad
 * humanamente cómoda de texto visible.
 *
 * Reglas que se respetan:
 *   1. Los segmentos NO cruzan capítulo (siempre cierran en cambio de cap).
 *   2. Greedy con fusión de párrafos pequeños: si el segmento actual está
 *      bajo minWords, agregamos el siguiente párrafo aunque parezca completar
 *      una oración. Esto evita "segmento de 30 palabras seguido de segmento
 *      de 250" — incómodo cognitivamente.
 *   3. Si agregar un párrafo excedería maxWords y el segmento actual ya
 *      llegó al mínimo, cerramos y abrimos uno nuevo. Esto evita segmentos
 *      gigantes por un solo párrafo extra.
 *   4. Mega-párrafos (un único párrafo > maxWords*1.2): se marcan
 *      `oversize: true` pero NO se subdividen en MVP. Subdividir requeriría
 *      manipular el render del párrafo (split por oraciones + ids virtuales)
 *      y el riesgo de romper IntersectionObserver / scroll-sync no compensa.
 *      Documentado como riesgo pendiente.
 *
 * Design intencional — qué NO hace:
 *   - NO mide el DOM. La cuenta de palabras es proxy estable cross-browser
 *     y cross-fuente. Para ajustar al font-size del usuario, el caller
 *     reduce targetWords proporcionalmente.
 *   - NO crea páginas Kindle. Los segmentos son ANCLAS de navegación;
 *     el scroll natural del documento sigue siendo continuo. El usuario
 *     puede leer fluido y los botones "Siguiente/Anterior párrafo"
 *     simplemente saltan de ancla en ancla.
 *   - NO subdivide oraciones, listas, citas, diálogos. La granularidad
 *     mínima es el párrafo completo.
 */

import type { A11yBook } from '../types/a11y';

/**
 * Una ventana cognitiva de lectura. Agrupa N párrafos consecutivos del
 * mismo capítulo que juntos suman ~targetWords palabras.
 */
export interface ReadingSegment {
    /** ID estable derivado del primer párrafo. Útil para keys de React. */
    id: string;
    /** IDs de párrafos contenidos, en orden de lectura. */
    paragraphIds: string[];
    /** Suma de cuenta de palabras de los párrafos contenidos. */
    estimatedWords: number;
    /** Capítulo al que pertenece (todos los párrafos están en el mismo cap). */
    chapterIndex: number;
    /**
     * `true` si el segmento es un único párrafo cuya cuenta supera
     * maxWords*1.2. No subdividimos en MVP — sólo se marca para que el
     * UI sepa que es un caso edge (futuro: subdivisión por oraciones).
     */
    oversize: boolean;
}

export interface SegmentationConfig {
    /** Cantidad ideal de palabras por segmento. */
    targetWords: number;
    /** Mínimo: segmentos por debajo intentan fusionar con el siguiente. */
    minWords: number;
    /** Máximo: agregar un párrafo que exceda este valor abre nuevo segmento. */
    maxWords: number;
}

/**
 * Calibración perceptual UX-4B — targets absolutos por viewport.
 *
 * La iteración previa (UX-4A) usaba ratios uniformes 0.7/1.3 sobre un ideal
 * único por viewport (280 desktop / 150 mobile). En testeo real eso producía
 * segmentos que el lector percibía como "saltos enormes" — el sistema
 * optimizaba eficiencia técnica, no continuidad cognitiva.
 *
 * Nueva premisa: 1 clic = 1 avance humano y reconocible. Por eso pasamos a
 * targets absolutos (min/ideal/max independientes por viewport) en vez de
 * derivarlos desde un ratio. Permite calibrar desktop y mobile por separado
 * sin que un cambio en uno arrastre al otro.
 *
 * Hard max efectivo (umbral oversize) = maxWords * 1.2:
 *   Desktop: 220 * 1.2 = 264
 *   Mobile:  130 * 1.2 = 156
 */
const VIEWPORT_TARGETS = {
    desktop: { ideal: 180, min: 140, max: 220 },
    mobile:  { ideal: 100, min:  70, max: 130 },
} as const;

/**
 * Factor por tamaño tipográfico del usuario. Cuando el texto es más grande,
 * cada palabra ocupa más espacio en pantalla — para que la cantidad VISIBLE
 * (líneas cómodas) sea consistente, dividimos targetWords/min/max entre
 * este factor.
 *
 * UX-4B — calibración más agresiva en large/xl que la del CSS (1.125 / 1.25).
 * Razón: con tipografía grande, además de ocupar más ancho, el ojo recorre
 * más líneas por palabra — la "ventana cognitiva cómoda" se reduce más rápido
 * que la proporción CSS. Empíricamente 1.20 / 1.40 produce segmentos que se
 * sienten estables con xl + line-height amplio + sidebar visible.
 */
const FONT_FACTOR = {
    small:  0.875,
    medium: 1.0,
    large:  1.20,
    xl:     1.40,
} as const;

type FontSizeKey = keyof typeof FONT_FACTOR;

/**
 * Calcula la configuración objetivo de segmentación a partir del viewport
 * y el tamaño tipográfico activo.
 *
 * Targets UX-4B:
 *   Desktop (>=768px): ideal 180, rango 140–220 (hard max ~260 vía oversize).
 *   Mobile  (< 768px): ideal 100, rango  70–130 (hard max ~156 vía oversize).
 *
 * Cuando el usuario aumenta font-size, dividimos los tres valores por el
 * factor — los segmentos se reducen proporcionalmente para mantener una
 * ventana cognitiva visualmente constante. En xl, los targets se reducen
 * ~30% respecto a medium.
 */
export function deriveSegmentationConfig(args: {
    viewportWidth: number;
    fontSize:      FontSizeKey;
}): SegmentationConfig {
    const isMobile = args.viewportWidth < 768;
    const t = isMobile ? VIEWPORT_TARGETS.mobile : VIEWPORT_TARGETS.desktop;
    const factor = FONT_FACTOR[args.fontSize] ?? 1.0;
    const target = Math.max(40, Math.round(t.ideal / factor));
    const minW   = Math.max(30, Math.round(t.min   / factor));
    const maxW   = Math.max(50, Math.round(t.max   / factor));
    return {
        targetWords: target,
        minWords:    minW,
        maxWords:    maxW,
    };
}

// ── Helpers internos ────────────────────────────────────────────────────────

function countWords(text: string): number {
    if (!text) return 0;
    // Tokenización defensiva: cualquier secuencia de caracteres no-whitespace
    // es una palabra. Suficiente para español/inglés sin lib externa.
    const m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
}

interface FlatParagraph {
    paragraphId:  string;
    chapterIndex: number;
    words:        number;
}

function flattenBook(book: A11yBook): FlatParagraph[] {
    const out: FlatParagraph[] = [];
    book.chapters.forEach((ch, ci) => {
        for (const sec of ch.sections) {
            for (const p of sec.paragraphs) {
                out.push({
                    paragraphId:  p.id,
                    chapterIndex: ci,
                    words:        countWords(p.text),
                });
            }
        }
    });
    return out;
}

interface PartialSegment {
    paragraphIds: string[];
    words:        number;
    chapterIndex: number;
}

function finalize(seg: PartialSegment, config: SegmentationConfig): ReadingSegment {
    const oversize = seg.paragraphIds.length === 1
        && seg.words > config.maxWords * 1.2;
    return {
        id:             `seg-${seg.paragraphIds[0]}`,
        paragraphIds:   seg.paragraphIds,
        estimatedWords: seg.words,
        chapterIndex:   seg.chapterIndex,
        oversize,
    };
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Computa la lista de ReadingSegment para un libro completo.
 *
 * Complejidad: O(N) sobre el total de párrafos del libro. Para un libro
 * de 5000 párrafos esto son 5000 iteraciones simples (un sumar + un
 * comparar) — milisegundos. La memoización ocurre arriba (useReadingSegments).
 */
export function computeSegments(
    book: A11yBook,
    config: SegmentationConfig,
): ReadingSegment[] {
    const flat = flattenBook(book);
    if (flat.length === 0) return [];

    const segments: ReadingSegment[] = [];
    let current: PartialSegment | null = null;

    for (const para of flat) {
        if (!current) {
            current = { paragraphIds: [para.paragraphId], words: para.words, chapterIndex: para.chapterIndex };
            continue;
        }

        // Cambio de capítulo → siempre cerrar y abrir nuevo segmento.
        if (para.chapterIndex !== current.chapterIndex) {
            segments.push(finalize(current, config));
            current = { paragraphIds: [para.paragraphId], words: para.words, chapterIndex: para.chapterIndex };
            continue;
        }

        const wouldBe = current.words + para.words;

        // Bajo minWords: fusionamos siempre (párrafos pequeños consecutivos
        // no deben quedar solos como segmentos diminutos — diálogo + acción
        // breve + respuesta corta = una sola ventana cognitiva).
        if (current.words < config.minWords) {
            current.paragraphIds.push(para.paragraphId);
            current.words = wouldBe;
            continue;
        }

        // Dentro del max: agregamos para llegar más cerca del target.
        if (wouldBe <= config.maxWords) {
            current.paragraphIds.push(para.paragraphId);
            current.words = wouldBe;
            continue;
        }

        // Excedería maxWords y ya superamos minWords: cerramos.
        segments.push(finalize(current, config));
        current = { paragraphIds: [para.paragraphId], words: para.words, chapterIndex: para.chapterIndex };
    }

    if (current) segments.push(finalize(current, config));

    return segments;
}

/**
 * Encuentra el índice del segmento que contiene `paragraphId`. Devuelve -1
 * si el párrafo no aparece en ningún segmento (caso edge: libro vacío o
 * desync entre flat y segments).
 *
 * Complejidad: O(N*M) en peor caso, pero N (segmentos) es típicamente
 * <100 incluso para libros largos, y la búsqueda corta en cuanto encuentra.
 * Si esto se vuelve hot path, considerar un Map<paragraphId, segmentIndex>
 * pre-computado.
 */
export function findSegmentForParagraph(
    segments: ReadingSegment[],
    paragraphId: string,
): number {
    for (let i = 0; i < segments.length; i++) {
        if (segments[i].paragraphIds.includes(paragraphId)) return i;
    }
    return -1;
}
