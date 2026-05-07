/**
 * useReadingSegments — Sprint UX-4A, recalibrado en UX-4B.
 *
 * Hook React que produce la lista memoizada de ReadingSegment para el libro
 * abierto, adaptada al viewport y al tamaño tipográfico del usuario.
 * Targets perceptuales: ~180 palabras desktop / ~100 mobile (medium font),
 * reducidos proporcionalmente con large/xl. Ver deriveSegmentationConfig
 * en utils/readingSegments.ts.
 *
 * Cómo se calcula:
 *   1. Detecta viewport.innerWidth (mobile / desktop) — debounce 200ms
 *      al resize para evitar resegmentación agresiva mientras el user
 *      arrastra la ventana.
 *   2. Combina con `fontSize` del usuario para derivar SegmentationConfig.
 *   3. Bucket-quantiza targetWords a múltiplos de 20, así pequeñas
 *      variaciones (ej. ventana 800→820px) NO disparan recompute. El
 *      umbral real para resegmentar es cruzar de un bucket al siguiente.
 *   4. Memoiza la llamada a computeSegments por (bookId × bookLanguage ×
 *      bucketedTarget).
 *
 * Performance:
 *   - Cero listeners en el camino caliente (sólo 'resize' debounceado).
 *   - O(N) sobre los párrafos del libro, sólo al cambiar el bucket.
 *   - Devuelve referencias estables del segments[] mientras el bucket no
 *     cambie — segura para deps de useEffect downstream.
 *
 * NO hace:
 *   - No re-renderiza el documento. El cambio de segmentación es invisible
 *     visualmente; sólo afecta a qué párrafo apuntan los botones "Siguiente
 *     párrafo" / "Párrafo anterior" (que internamente saltan de segmento
 *     en segmento).
 */

import { useEffect, useMemo, useState } from 'react';
import type { A11yBook } from '../types/a11y';
import {
    computeSegments,
    deriveSegmentationConfig,
    type ReadingSegment,
    type SegmentationConfig,
} from '../utils/readingSegments';
import type { FontSize } from './useA11yReadingSettings';

const RESIZE_DEBOUNCE_MS = 200;
const BUCKET_SIZE        = 20; // palabras

function bucketWords(target: number): number {
    return Math.round(target / BUCKET_SIZE) * BUCKET_SIZE;
}

export interface UseReadingSegmentsResult {
    /** Lista de segmentos en orden de lectura. Vacía si book es null. */
    segments: ReadingSegment[];
    /** Config efectiva aplicada (con targetWords ya bucket-cuantizado). */
    config:   SegmentationConfig;
}

export function useReadingSegments(
    book: A11yBook | null,
    fontSize: FontSize,
): UseReadingSegmentsResult {
    // viewport tracking con debounce. Inicial: ssr-safe default 1024px
    // (suficientemente desktop para que el primer paint tenga segments).
    const [viewportWidth, setViewportWidth] = useState<number>(() =>
        typeof window !== 'undefined' ? window.innerWidth : 1024,
    );

    useEffect(() => {
        if (typeof window === 'undefined') return;
        let timer: number | null = null;
        const onResize = () => {
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                setViewportWidth(window.innerWidth);
            }, RESIZE_DEBOUNCE_MS);
        };
        window.addEventListener('resize', onResize, { passive: true });
        return () => {
            window.removeEventListener('resize', onResize);
            if (timer !== null) window.clearTimeout(timer);
        };
    }, []);

    // Config "cruda" derivada del viewport + fontSize. Se cuantiza abajo.
    const rawConfig = useMemo<SegmentationConfig>(
        () => deriveSegmentationConfig({ viewportWidth, fontSize }),
        [viewportWidth, fontSize],
    );

    // Bucket-cuantización del targetWords. Recompute sólo cruza buckets.
    const bucketedTarget = bucketWords(rawConfig.targetWords);

    // Config efectiva. UX-4B: min/max vienen YA calculados desde
    // deriveSegmentationConfig (targets absolutos por viewport, no ratios
    // sobre el target). El bucketing aplica sólo al targetWords — su rol
    // es estabilizar la identidad del config ante resizes pequeños, no
    // redefinir el rango. Min/max son fijos por (viewport, fontSize) y
    // sólo cambian cuando alguno de esos cambia, no al cruzar un bucket.
    const config = useMemo<SegmentationConfig>(() => ({
        targetWords: bucketedTarget,
        minWords:    rawConfig.minWords,
        maxWords:    rawConfig.maxWords,
    }), [bucketedTarget, rawConfig.minWords, rawConfig.maxWords]);

    // segmentación memoizada. Deps mínimas: identidad del libro + bucket.
    // El propio config es derivable estáticamente del bucket → no hace falta
    // ponerlo en deps.
    const segments = useMemo(
        () => book ? computeSegments(book, config) : [],
        [book?.contentId, book?.language, bucketedTarget, config],
    );

    return { segments, config };
}
