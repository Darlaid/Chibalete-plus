/**
 * Tipos del Modo Accesible (mode='a11y').
 *
 * FASE 2 — modelo documental mínimo. Suficiente para renderizar texto plano
 * como documento estructurado (capítulos, secciones, párrafos).
 *
 * TODO Fase 4: agregar A11yMetadata con EPUB Accessibility 1.1 completo
 * (accessMode, accessibilityFeature, accessibilitySummary, conformsTo,
 * accessibilityHazard, certifiedBy, etc.). En esta fase intencionalmente
 * NO se modela esa metadata: el parser actual produce libros desde texto
 * plano, sin información editorial estructurada.
 *
 * Identificadores estables:
 *   capítulo:  chap-{index}
 *   sección:   sec-{chapterIndex}-{sectionIndex}
 *   párrafo:   p-{chapterIndex}-{sectionIndex}-{paragraphIndex}
 *   heading:   {idDelContenedor}-h
 *
 * Reglas:
 *   - Los IDs son estables: el mismo libro produce siempre los mismos IDs.
 *   - El campo `text` es texto plano. NUNCA HTML — el render no usa
 *     dangerouslySetInnerHTML bajo ninguna circunstancia.
 */

/** Párrafo del libro. Texto plano, render como nodo de texto React. */
export interface A11yParagraph {
    /** ID estable: `p-{chapterIndex}-{sectionIndex}-{paragraphIndex}`. */
    id: string;
    /** Texto plano del párrafo. NO HTML. */
    text: string;
    /** Override de idioma (BCP-47). Solo si difiere del libro. */
    lang?: string;
}

/** Sección dentro de un capítulo. Heading opcional (puede ser sección sin título visible). */
export interface A11ySection {
    /** ID estable: `sec-{chapterIndex}-{sectionIndex}`. */
    id: string;
    /**
     * Heading de la sección. Si está ausente, los párrafos se renderizan
     * directamente bajo el capítulo, sin elemento `<section>` envolvente.
     */
    heading?: {
        id: string;
        text: string;
        level: 3 | 4 | 5 | 6;
    };
    paragraphs: A11yParagraph[];
}

/** Capítulo del libro. Siempre con heading h2. */
export interface A11yChapter {
    /** ID estable: `chap-{index}`. */
    id: string;
    /** 1-based para UI ("Capítulo 1 de N"). */
    index: number;
    heading: {
        id: string;
        text: string;
        level: 2;
    };
    sections: A11ySection[];
}

/**
 * Diagnóstico interno del parser. UX-4C — visible solo en `?a11ydebug=1`.
 *
 * El campo `detectedFormat` agrega los formatos por bloque: cuántos bloques
 * se trataron como prosa por línea (Alicia) vs. wrap-80 (clásico). Útil para
 * detectar libros mal interpretados sin tener que abrir el archivo fuente.
 *
 * `warnings` lleva CÓDIGOS estables (no mensajes humanos) para que el debug
 * UI los traduzca o los tooltipee. Lista controlada — extender con cuidado.
 */
export interface A11yParserStats {
    /** Distribución de formatos por bloque multilínea durante classifyBlocks. */
    detectedFormat: {
        lineParagraphs:    number;
        wrappedParagraphs: number;
        singleLine:        number;
        chapterHeadings:   number;
    };
    chaptersCount:           number;
    paragraphsCount:         number;
    totalWords:              number;
    avgWordsPerParagraph:    number;
    maxWordsPerParagraph:    number;
    /** Párrafos con > OVERSIZE_PARAGRAPH_THRESHOLD palabras. */
    oversizeParagraphsCount: number;
    /** Top N párrafos sospechosamente largos (id + wordCount). */
    suspiciouslyLongParagraphs: Array<{ id: string; words: number }>;
    /** Códigos de advertencia. NO bloquean la lectura. */
    warnings: A11yParserWarning[];
}

export type A11yParserWarning =
    | 'LOW_CHAPTER_COUNT'
    | 'LOW_PARAGRAPH_COUNT'
    | 'HIGH_OVERSIZE_PARAGRAPHS'
    | 'VERY_LONG_PARAGRAPH'
    | 'MIXED_FORMAT_BLOCK';

/** Libro entero ya parseado y listo para render. */
export interface A11yBook {
    contentId: string;
    title: string;
    author?: string;
    /** BCP-47. Por defecto 'es' en Fase 2. */
    language: string;
    chapters: A11yChapter[];
    /** Total de párrafos del libro — denominador para porcentaje en Fase 6. */
    totalParagraphs: number;
    /**
     * Versión del parser que produjo este árbol. UX-4C: cualquier cambio
     * en heurística de segmentación de párrafos bumpa este string.
     * Sirve para invalidar progreso persistido en clientes que abrieron el
     * libro con un parser previo (los paragraphIds pudieron cambiar).
     * Opcional para no romper consumidores legacy del shape; presente
     * desde UX-4C en adelante.
     */
    parserVersion?: string;
    /** Diagnóstico interno. Visible solo en debug. */
    parserStats?: A11yParserStats;
}
