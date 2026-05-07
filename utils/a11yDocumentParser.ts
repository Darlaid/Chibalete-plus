/**
 * a11yDocumentParser — convierte texto plano en estructura A11yBook.
 *
 * UX-4C — hardening de detección de formato editorial.
 *
 * Antes (UX-4A/G1): cualquier bloque multi-línea producía UN ÚNICO párrafo
 * uniendo las líneas con espacios (`lines.join(' ')`). Esa regla funciona
 * para textos wrapeados a 80 columnas (donde varias líneas físicas son un
 * mismo párrafo lógico) pero DESTRUYE textos donde cada línea del .txt es
 * un párrafo editorial independiente — caso real observado en el archivo
 * de Alicia: 12 capítulos pasaban a parsearse como 6 capítulos y 42
 * mega-párrafos de hasta 2.459 palabras. Ver auditoría UX-4B.
 *
 * Estrategia (UX-4C):
 *   1. Normalizar: \r\n → \n, espacios horizontales colapsados, ≥3 saltos → 2.
 *   2. Dividir en bloques por líneas vacías (≥1 línea en blanco entre bloques).
 *   3. Clasificar cada bloque:
 *      - Línea única + matches CHAPTER_PATTERN → capítulo (h2).
 *      - Bloque multi-línea → llamar a `detectMultilineBlockFormat`:
 *          · 'line-paragraphs'   → cada línea es párrafo o capítulo independiente.
 *          · 'wrapped-paragraph' → comportamiento legacy `lines.join(' ')`.
 *      - Línea única no-capítulo → párrafo.
 *   4. Construir el árbol asegurando al menos un capítulo (capítulo implícito
 *      "Texto completo" si el texto no declara ninguno).
 *   5. Calcular `parserStats` con diagnóstico interno y warnings.
 *
 * Decisión post-G1 que se preserva:
 *   No se infieren `<h3>` desde texto plano. La heurística previa
 *   `isSectionHeading` queda comentada al final del archivo como referencia
 *   para metadata explícita futura.
 *
 * IDs estables (ver types/a11y.ts):
 *   chap-{i}, sec-{i}-{j}, p-{i}-{j}-{k}
 *
 * Garantías:
 *   - El parser NUNCA devuelve HTML — los textos van como strings planos.
 *   - El parser NUNCA infiere headings de prosa. Solo capítulos explícitos
 *     que matchean `CHAPTER_PATTERN`.
 *   - rawText vacío → libro válido con 1 capítulo "Texto completo" y
 *     totalParagraphs=0.
 *   - `parserVersion` siempre presente desde UX-4C: cualquier cliente con
 *     progreso persistido bajo IDs viejos puede comparar y descartar.
 */

import type { A11yBook, A11yChapter, A11ySection, A11yParserStats, A11yParserWarning } from '../types/a11y';

/**
 * Versión del parser. Bumpear ante cualquier cambio en `classifyBlocks`,
 * `detectMultilineBlockFormat` o la generación de `paragraphId`. El cliente
 * persiste progreso por paragraphId; un bump rompe la correspondencia y
 * permite invalidar limpiamente el progreso viejo.
 */
const PARSER_VERSION = 'a11y-parser-v2';

// ── Detección de capítulos ────────────────────────────────────────────────────
//
// Acepta:  "Capítulo 1", "CAPÍTULO I", "Capitulo 12", "Chapter 3", "Capítulo 5: Título"
// Rechaza: "El capítulo más triste fue el último." (palabra dentro de prosa)
//
// La regex requiere:
//   - inicio de línea
//   - palabra "capítulo" / "capitulo" (con o sin tilde) o "chapter"
//   - al menos un espacio
//   - número arábigo o romano
//   - límite de palabra
//
// La línea completa debe ser razonablemente corta (heading, no prosa).
const CHAPTER_PATTERN = /^\s*(?:cap[íi]tulo|chapter)\s+(?:[ivxlcdm]+|\d+)\b/i;
const CHAPTER_MAX_LEN = 120;

function isChapterHeading(line: string): boolean {
    if (line.length > CHAPTER_MAX_LEN) return false;
    return CHAPTER_PATTERN.test(line);
}

/**
 * Si un bloque multi-línea contiene una o más líneas que son chapter
 * headings, las extrae a sub-bloques propios. Devuelve siempre una lista
 * de "sub-bloques" donde cada heading aparece aislado y las prosas
 * consecutivas quedan agrupadas.
 *
 * Ejemplo (EPUB raro observado durante UX-4D):
 *
 *   ['Capítulo 1', 'El barco zarpó al amanecer...']
 *
 * sin esta función, el bloque cae en `wrapped-paragraph` (solo 2 líneas,
 * ninguna regla de line-paragraphs aplica) y el heading se fusiona con
 * la prosa siguiente — el capítulo se pierde y queda "Texto completo".
 *
 * Con esta función, se separa en:
 *
 *   [['Capítulo 1'], ['El barco zarpó al amanecer...']]
 *
 * y ambos sub-bloques se clasifican individualmente: el heading como
 * capítulo, la prosa como párrafo. Si el bloque NO tenía headings, devuelve
 * `[lines]` sin tocar — el resto del pipeline funciona igual que siempre.
 *
 * Es una regla GENERAL ("los chapter headings nunca se fusionan con
 * prosa") y no una excepción por libro.
 */
function splitChapterHeadingsInBlock(lines: string[]): string[][] {
    const groups: string[][] = [];
    let current: string[] = [];
    let foundHeading = false;
    for (const line of lines) {
        if (isChapterHeading(line)) {
            foundHeading = true;
            if (current.length > 0) {
                groups.push(current);
                current = [];
            }
            groups.push([line]);
        } else {
            current.push(line);
        }
    }
    if (current.length > 0) groups.push(current);
    // Fast path: si no había headings, devolvemos el bloque tal cual para
    // que el resto del pipeline procese exactamente lo mismo que antes.
    if (!foundHeading) return [lines];
    return groups;
}

// ── Normalización ────────────────────────────────────────────────────────────

function normalizeText(raw: string): string {
    return raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Colapsar espacios horizontales (no toca \n).
        .replace(/[ \t]+/g, ' ')
        // Colapsar 3+ saltos consecutivos a 2 (preserva separación de párrafos).
        .replace(/\n{3,}/g, '\n\n')
        // Espacios al inicio/fin de línea.
        .split('\n')
        .map(l => l.trim())
        .join('\n')
        .trim();
}

// ── Detección de formato editorial en bloque multi-línea ─────────────────────
//
// Decide si un bloque multi-línea representa varios párrafos (cada línea es
// un párrafo, formato Alicia) o un único párrafo wrapeado en varias líneas
// (formato 80-cols). La decisión usa cuatro señales combinadas — no una
// condición frágil:
//
//   1. averageWordCount     — proxy de "líneas largas o cortas".
//   2. terminalPunctuation  — fracción de líneas que cierran con `.!?…»"]`.
//   3. capitalOrDialogStart — fracción que empiezan como párrafo (mayúscula,
//                             diálogo `—`/`–`, apertura `«`/`"`/`¿`/`¡`).
//   4. allLinesShort        — todas las líneas tienen ≤ SHORT_LINE_WORDS.
//
// Reglas (en orden, primer match gana):
//
//   A. Bloque suficientemente largo (≥3 líneas), líneas medianas-largas y
//      mayoría cierran en puntuación final → 'line-paragraphs'.
//      (Caso Alicia clásico. Es la señal más fuerte y suele ser inequívoca.)
//
//   A2. Bloque grande con MUCHOS comienzos de párrafo (mayúscula / diálogo)
//       → 'line-paragraphs'.
//       (Captura capítulos donde la prosa intercala diálogos cortos que
//       bajan el avgWordCount o el terminalRatio por debajo del umbral A
//       — observado empíricamente en cap III de Alicia.)
//
//   B. Todas las líneas son cortas y la mayoría NO cierran en puntuación
//      final → 'wrapped-paragraph'.
//      (Wrap clásico, versos cortos, listas. Conserva comportamiento legacy.)
//
//   C. Default → 'wrapped-paragraph'.
//      (Conservador: ante duda, no fragmentar.)

export type MultilineBlockFormat = 'line-paragraphs' | 'wrapped-paragraph';

interface MultilineDetectionResult {
    format:  MultilineBlockFormat;
    /** True si la decisión cae en zona ambigua (regla C o D con señales
     *  contradictorias). Se reporta como warning MIXED_FORMAT_BLOCK. */
    ambiguous: boolean;
    /** Métricas usadas para la decisión, expuestas para tests / debug. */
    metrics: {
        lineCount:                    number;
        averageWordCount:             number;
        terminalPunctuationRatio:     number;
        capitalOrDialogStartRatio:    number;
    };
}

const TERMINAL_PUNCT_RX = /[.!?…»"”'’\)\]\}](?:["”'’»\)\]\}\s])*$/;
const PARAGRAPH_START_RX = /^["“«'‘¿¡—–\-]|^[A-ZÁÉÍÓÚÑÜ]/;

const LONG_LINE_WORDS  = 20;  // avg a partir del cual cuenta como "líneas largas"
const SHORT_LINE_WORDS = 12;  // por línea, hasta aquí cuenta como "línea corta"
const MIN_LINES_FOR_LINE_PARAGRAPHS = 3;  // bloques de 2 líneas no se consideran prosa-por-línea

export function detectMultilineBlockFormat(lines: string[]): MultilineDetectionResult {
    const lineCount = lines.length;
    if (lineCount <= 1) {
        return {
            format: 'wrapped-paragraph',
            ambiguous: false,
            metrics: { lineCount, averageWordCount: 0, terminalPunctuationRatio: 0, capitalOrDialogStartRatio: 0 },
        };
    }

    const wordCounts = lines.map(countWords);
    const totalWords = wordCounts.reduce((a, b) => a + b, 0);
    const averageWordCount = totalWords / lineCount;

    let terminalCount = 0;
    let startCount    = 0;
    for (const line of lines) {
        if (TERMINAL_PUNCT_RX.test(line)) terminalCount += 1;
        if (PARAGRAPH_START_RX.test(line)) startCount += 1;
    }
    const terminalRatio = terminalCount / lineCount;
    const startRatio    = startCount    / lineCount;

    const allShort = wordCounts.every(w => w <= SHORT_LINE_WORDS);

    const metrics = {
        lineCount,
        averageWordCount,
        terminalPunctuationRatio:  terminalRatio,
        capitalOrDialogStartRatio: startRatio,
    };

    // Regla A — prosa por línea con líneas medianas-largas y puntuación final.
    if (lineCount >= MIN_LINES_FOR_LINE_PARAGRAPHS
        && averageWordCount >= LONG_LINE_WORDS
        && terminalRatio >= 0.5) {
        return { format: 'line-paragraphs', ambiguous: false, metrics };
    }

    // Regla A2 — bloques con SUFICIENTE PROSA TOTAL y mayoría de líneas
    // iniciando como párrafo independiente. Captura dos casos:
    //   1. Capítulos donde la prosa intercala diálogos cortos ("—Sí.")
    //      que bajan avg fuera del umbral de Regla A.
    //   2. Capítulos sin blank-lines limpias donde un heading "Capítulo X"
    //      queda pegado al cuerpo — el heading mismo es una línea corta y
    //      reduce el avg, pero el bloque entero sigue siendo prosa por línea.
    //
    // Usamos `totalWords >= 50` en lugar de `averageWordCount` porque éste
    // último puede ser arrastrado a la baja por una sola línea muy corta
    // (un heading pegado, un diálogo de 2 palabras). El total del bloque
    // es una medida más estable de "cuánta prosa hay aquí".
    //
    // El umbral 5 líneas evita aplicar esto a bloques pequeños tipo poema.
    // terminalRatio >= 0.5 protege versos breves (puntuación irregular).
    if (lineCount >= 5
        && totalWords >= 50
        && startRatio >= 0.6
        && terminalRatio >= 0.5) {
        return { format: 'line-paragraphs', ambiguous: false, metrics };
    }

    // Regla B — wrap clásico / versos cortos / listas.
    if (allShort && terminalRatio < 0.5) {
        return { format: 'wrapped-paragraph', ambiguous: false, metrics };
    }

    // Regla C — default conservador. Marcamos ambiguo si las señales son
    // contradictorias para que el debug UI muestre MIXED_FORMAT_BLOCK.
    const ambiguous = (terminalRatio >= 0.4 && terminalRatio < 0.6)
                   || (averageWordCount >= 12 && averageWordCount < LONG_LINE_WORDS);
    return { format: 'wrapped-paragraph', ambiguous, metrics };
}

// ── Clasificación de bloques ─────────────────────────────────────────────────

type Block =
    | { kind: 'chapter';   text: string }
    | { kind: 'paragraph'; text: string };

interface ClassificationResult {
    blocks: Block[];
    formatTally: {
        lineParagraphs:    number;
        wrappedParagraphs: number;
        singleLine:        number;
        chapterHeadings:   number;
    };
    /** Bloques cuya detección quedó marcada como `ambiguous`. */
    ambiguousBlocks: number;
}

function classifyBlocks(normalized: string): ClassificationResult {
    const tally = {
        lineParagraphs:    0,
        wrappedParagraphs: 0,
        singleLine:        0,
        chapterHeadings:   0,
    };
    let ambiguousBlocks = 0;

    if (!normalized) {
        return { blocks: [], formatTally: tally, ambiguousBlocks };
    }

    const rawBlocks = normalized
        .split(/\n\s*\n/)
        .map(b => b.trim())
        .filter(b => b.length > 0);

    const out: Block[] = [];
    for (const block of rawBlocks) {
        const lines = block
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);

        if (lines.length === 0) continue;

        if (lines.length === 1) {
            const line = lines[0];
            if (isChapterHeading(line)) {
                out.push({ kind: 'chapter', text: line });
                tally.chapterHeadings += 1;
            } else {
                out.push({ kind: 'paragraph', text: line });
                tally.singleLine += 1;
            }
            continue;
        }

        // Pre-procesamiento UX-4D: si hay chapter headings dentro del bloque
        // multi-línea (caso EPUB raro: heading sin blank-line de separación),
        // los extraemos a sub-bloques propios. Cada sub-bloque luego se
        // clasifica individualmente. Si no hay headings, splitChapterHeadingsInBlock
        // devuelve `[lines]` y el comportamiento es idéntico al de UX-4C.
        const subBlocks = splitChapterHeadingsInBlock(lines);
        const blockHadHeadings = subBlocks.length > 1 || (subBlocks.length === 1 && subBlocks[0] !== lines);

        // Si el BLOQUE ORIGINAL era largo (>=5 líneas) Y contenía headings,
        // los sub-bloques de prosa heredan el formato line-paragraphs sin
        // pasar por la heurística. Razón: en un bloque originalmente largo
        // de prosa por línea con capítulos pegados, cada línea entre
        // capítulos es un párrafo independiente — y los sub-bloques quedan
        // demasiado pequeños individualmente para que las reglas A/A2
        // disparen. La regla solo se aplica cuando hay evidencia de
        // estructura editorial (headings detectados).
        //
        // Si el bloque original era CORTO (<5 líneas, típico EPUB raro
        // tipo "Capítulo X\nuna línea de prosa"), procesamos cada sub-bloque
        // con la heurística estándar — bloques de 1 línea son trivial.
        const inheritLineParagraphs = blockHadHeadings && lines.length >= 5;

        for (const sub of subBlocks) {
            if (sub.length === 0) continue;
            if (sub.length === 1) {
                const line = sub[0];
                if (isChapterHeading(line)) {
                    out.push({ kind: 'chapter', text: line });
                    tally.chapterHeadings += 1;
                } else {
                    out.push({ kind: 'paragraph', text: line });
                    tally.singleLine += 1;
                }
                continue;
            }

            // Sub-bloque multi-línea: decidir formato.
            let format: MultilineBlockFormat;
            if (inheritLineParagraphs) {
                format = 'line-paragraphs';
            } else {
                const detection = detectMultilineBlockFormat(sub);
                if (detection.ambiguous) ambiguousBlocks += 1;
                format = detection.format;
            }

            if (format === 'line-paragraphs') {
                // Cada línea es un párrafo o capítulo independiente. La
                // re-comprobación de chapter heading es defensiva: ya
                // splitChapterHeadingsInBlock los habría sacado, pero si
                // alguno se cuela aquí lo tratamos correctamente.
                for (const line of sub) {
                    if (isChapterHeading(line)) {
                        out.push({ kind: 'chapter', text: line });
                        tally.chapterHeadings += 1;
                    } else {
                        out.push({ kind: 'paragraph', text: line });
                        tally.lineParagraphs += 1;
                    }
                }
            } else {
                // Comportamiento legacy: un párrafo con líneas unidas por espacio.
                // Mantiene intactos los formatos wrap-80, versos cortos y listas.
                out.push({ kind: 'paragraph', text: sub.join(' ') });
                tally.wrappedParagraphs += 1;
            }
        }
    }

    return { blocks: out, formatTally: tally, ambiguousBlocks };
}

// ── Construcción del árbol ───────────────────────────────────────────────────

interface BuildContext {
    chapters: A11yChapter[];
    currentChapter: A11yChapter | null;
    currentSection: A11ySection | null;
    totalParagraphs: number;
    /** Track de wordCount por párrafo creado, para parserStats. */
    paragraphWordCounts: Array<{ id: string; words: number }>;
}

function startChapter(ctx: BuildContext, text: string): void {
    const idx = ctx.chapters.length + 1;
    const chap: A11yChapter = {
        id: `chap-${idx}`,
        index: idx,
        heading: { id: `chap-${idx}-h`, text, level: 2 },
        sections: [],
    };
    ctx.chapters.push(chap);
    ctx.currentChapter = chap;
    ctx.currentSection = null;
}

function ensureChapter(ctx: BuildContext): A11yChapter {
    if (!ctx.currentChapter) startChapter(ctx, 'Texto completo');
    return ctx.currentChapter as A11yChapter;
}

/**
 * Garantiza que existe una "sección" contenedor para los párrafos del
 * capítulo actual. Post-G1: la sección NUNCA tiene heading — es solo el
 * agrupador estructural que mantiene los IDs `p-{chap}-{sec}-{para}` estables.
 *
 * Como no se infieren subsecciones desde texto plano, en la práctica cada
 * capítulo tiene exactamente UNA sección sin heading. La indirección se
 * conserva para no cambiar el shape de A11yBook ni los IDs históricos.
 */
function ensureSection(ctx: BuildContext): A11ySection {
    const chap = ensureChapter(ctx);
    if (!ctx.currentSection || !chap.sections.includes(ctx.currentSection)) {
        const sIdx = chap.sections.length + 1;
        const sec: A11ySection = {
            id: `sec-${chap.index}-${sIdx}`,
            paragraphs: [],
        };
        chap.sections.push(sec);
        ctx.currentSection = sec;
    }
    return ctx.currentSection;
}

function appendParagraph(ctx: BuildContext, text: string): void {
    const sec = ensureSection(ctx);
    const chap = ctx.currentChapter as A11yChapter;
    const sIdx = chap.sections.indexOf(sec) + 1;
    const pIdx = sec.paragraphs.length + 1;
    const id = `p-${chap.index}-${sIdx}-${pIdx}`;
    sec.paragraphs.push({ id, text });
    ctx.totalParagraphs += 1;
    ctx.paragraphWordCounts.push({ id, words: countWords(text) });
}

// ── parserStats ───────────────────────────────────────────────────────────────
//
// Umbrales para warnings. Calibrados empíricamente para libros típicos del
// catálogo Chibalete+ (cuentos infantiles 5k-30k palabras). Si en el futuro
// se cargan ensayos largos o corpus adultos, revisar.

/** Umbral a partir del cual un párrafo se considera "oversize". */
const OVERSIZE_PARAGRAPH_THRESHOLD = 500;
/** Umbral a partir del cual emitimos VERY_LONG_PARAGRAPH. */
const VERY_LONG_PARAGRAPH_THRESHOLD = 1000;
/** Cuántos párrafos largos reportamos (top-N) en suspiciouslyLongParagraphs. */
const SUSPICIOUS_REPORT_TOP_N = 5;
/** Mínimo de palabras totales del libro para que low-counts sean significativos. */
const MIN_WORDS_FOR_COUNT_WARNINGS = 800;

function buildParserStats(
    ctx: BuildContext,
    classification: ClassificationResult,
): A11yParserStats {
    const wordCounts = ctx.paragraphWordCounts.map(p => p.words);
    const totalWords = wordCounts.reduce((a, b) => a + b, 0);
    const paragraphsCount = ctx.paragraphWordCounts.length;
    const avgWords = paragraphsCount > 0 ? Math.round(totalWords / paragraphsCount) : 0;
    const maxWords = wordCounts.length > 0 ? Math.max(...wordCounts) : 0;
    const oversize = ctx.paragraphWordCounts.filter(p => p.words > OVERSIZE_PARAGRAPH_THRESHOLD).length;

    const suspicious = [...ctx.paragraphWordCounts]
        .filter(p => p.words > OVERSIZE_PARAGRAPH_THRESHOLD)
        .sort((a, b) => b.words - a.words)
        .slice(0, SUSPICIOUS_REPORT_TOP_N)
        .map(p => ({ id: p.id, words: p.words }));

    const warnings: A11yParserWarning[] = [];
    const significant = totalWords >= MIN_WORDS_FOR_COUNT_WARNINGS;

    if (significant && ctx.chapters.length === 1 && ctx.chapters[0].heading.text === 'Texto completo' && totalWords > 3000) {
        warnings.push('LOW_CHAPTER_COUNT');
    }
    if (significant && paragraphsCount < 10) {
        warnings.push('LOW_PARAGRAPH_COUNT');
    }
    if (paragraphsCount > 0 && oversize / paragraphsCount > 0.10) {
        warnings.push('HIGH_OVERSIZE_PARAGRAPHS');
    }
    if (maxWords > VERY_LONG_PARAGRAPH_THRESHOLD) {
        warnings.push('VERY_LONG_PARAGRAPH');
    }
    if (classification.ambiguousBlocks > 0) {
        warnings.push('MIXED_FORMAT_BLOCK');
    }

    return {
        detectedFormat: classification.formatTally,
        chaptersCount:           ctx.chapters.length,
        paragraphsCount,
        totalWords,
        avgWordsPerParagraph:    avgWords,
        maxWordsPerParagraph:    maxWords,
        oversizeParagraphsCount: oversize,
        suspiciouslyLongParagraphs: suspicious,
        warnings,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
    if (!text) return 0;
    const m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
}

// ── API pública ──────────────────────────────────────────────────────────────

export interface ParsePlainTextParams {
    contentId: string;
    title: string;
    author?: string;
    /** BCP-47. Default 'es'. */
    language?: string;
    rawText: string;
}

export function parsePlainTextToA11yBook(params: ParsePlainTextParams): A11yBook {
    const { contentId, title, author, language = 'es', rawText } = params;
    const normalized = normalizeText(rawText ?? '');

    // Caso vacío: libro estructuralmente válido sin párrafos.
    if (!normalized) {
        const ctx: BuildContext = {
            chapters: [
                {
                    id: 'chap-1',
                    index: 1,
                    heading: { id: 'chap-1-h', text: 'Texto completo', level: 2 },
                    sections: [],
                },
            ],
            currentChapter: null,
            currentSection: null,
            totalParagraphs: 0,
            paragraphWordCounts: [],
        };
        const emptyClassification: ClassificationResult = {
            blocks: [],
            formatTally: { lineParagraphs: 0, wrappedParagraphs: 0, singleLine: 0, chapterHeadings: 0 },
            ambiguousBlocks: 0,
        };
        return {
            contentId,
            title,
            author,
            language,
            chapters: ctx.chapters,
            totalParagraphs: 0,
            parserVersion: PARSER_VERSION,
            parserStats: buildParserStats(ctx, emptyClassification),
        };
    }

    const classification = classifyBlocks(normalized);
    const ctx: BuildContext = {
        chapters: [],
        currentChapter: null,
        currentSection: null,
        totalParagraphs: 0,
        paragraphWordCounts: [],
    };

    for (const block of classification.blocks) {
        switch (block.kind) {
            case 'chapter':
                startChapter(ctx, block.text);
                break;
            case 'paragraph':
                appendParagraph(ctx, block.text);
                break;
        }
    }

    // Garantía mínima: siempre al menos un capítulo (aunque esté vacío).
    if (ctx.chapters.length === 0) {
        startChapter(ctx, 'Texto completo');
    }

    return {
        contentId,
        title,
        author,
        language,
        chapters: ctx.chapters,
        totalParagraphs: ctx.totalParagraphs,
        parserVersion: PARSER_VERSION,
        parserStats: buildParserStats(ctx, classification),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCIA — heurística de subsecciones eliminada en G1
// ─────────────────────────────────────────────────────────────────────────────
//
// Este bloque queda como referencia para una futura detección de
// subsecciones BASADA EN METADATA (no en inferencia desde texto plano).
//
// La heurística previa producía <h3> automáticos a partir de cualquier línea
// corta sin puntuación final. En libros reales eso clasificaba como heading:
//   - epígrafes ("El sol se ponía")
//   - diálogos sin guion ("Sí")
//   - notas marginales ("Editor")
//   - frases sueltas que separan visualmente sin ser títulos
//
// Resultado: NVDA y VoiceOver listaban prosa en heading navigation,
// ensuciando el árbol semántico (fail SC 1.3.1, 2.4.6).
//
// Cuando se introduzca metadata explícita por libro (Fase 5 del plan EPUB),
// las subsecciones deben venir DECLARADAS por el editor, no inferidas.
//
// const SECTION_MAX_LEN = 90;
// function isSectionHeading(line: string): boolean {
//     if (line.length === 0 || line.length > SECTION_MAX_LEN) return false;
//     if (/[.,;:?!]\s*$/.test(line)) return false;
//     if (/^[—–\-"«"''*+•·]/.test(line)) return false;
//     if (!/^[A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü¿¡]/.test(line)) return false;
//     return true;
// }
//
// function startSection(ctx: BuildContext, text: string): void {
//     const chap = ensureChapter(ctx);
//     const sIdx = chap.sections.length + 1;
//     const sec: A11ySection = {
//         id: `sec-${chap.index}-${sIdx}`,
//         heading: { id: `sec-${chap.index}-${sIdx}-h`, text, level: 3 },
//         paragraphs: [],
//     };
//     chap.sections.push(sec);
//     ctx.currentSection = sec;
// }
