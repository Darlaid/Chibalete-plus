/**
 * txtImporter.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 2A.
 *
 * importTxtToCanonicalBook({ contentId, text, contentFingerprint, language? })
 * → CanonicalBook v1. Función pura: el llamador entrega el texto; sin
 * filesystem, sin red, sin fechas.
 *
 * Estructura = la que hoy reconoce el Modo Accesible, sin heurísticas nuevas.
 * La gramática se REPLICA de utils/a11yDocumentParser.ts (a11y-parser-v2):
 * compartir el .ts obligaría a cruzar la frontera cliente/servidor. La paridad
 * la protege server/__test__/canonicalBookTxt.test.mjs contra el parser real.
 *
 * Texto de los bloques: el de la fuente normalizada por el contrato de 1B
 * (normalizeTextForContentFingerprint), SIN colapsar espacios ni unir líneas.
 * La vista de Accesible (espacios colapsados, líneas unidas por espacio) se
 * deriva de él; así la rendición TXT reproduce la fuente y conserva el
 * fingerprint.
 */
import { normalizeTextForContentFingerprint } from '../contentFingerprint.js';
import {
    CANONICAL_SCHEMA_VERSION, MAX_CANONICAL_SOURCE_CHARS,
    DEFAULT_FIRST_SEPARATOR, DEFAULT_BLOCK_SEPARATOR,
    CanonicalBookError, assertValidFingerprint, chapterId, blockId,
} from './canonicalBook.js';

// ── Gramática replicada de a11yDocumentParser.ts (a11y-parser-v2) ────────────
const CHAPTER_PATTERN = /^\s*(?:cap[íi]tulo|chapter)\s+(?:[ivxlcdm]+|\d+)\b/i;
const CHAPTER_MAX_LEN = 120;
const TERMINAL_PUNCT_RX = /[.!?…»"”'’\)\]\}](?:["”'’»\)\]\}\s])*$/;
const PARAGRAPH_START_RX = /^["“«'‘¿¡—–\-]|^[A-ZÁÉÍÓÚÑÜ]/;
const LONG_LINE_WORDS = 20;
const SHORT_LINE_WORDS = 12;
const MIN_LINES_FOR_LINE_PARAGRAPHS = 3;

/** Línea tal como la ve el parser de Accesible: espacios/tabs colapsados y trim. */
export const accessibleLine = (line) => line.replace(/[ \t]+/g, ' ').trim();

const isChapterHeading = (line) => line.length <= CHAPTER_MAX_LEN && CHAPTER_PATTERN.test(line);

const countWords = (text) => {
    if (!text) return 0;
    const m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
};

/** Mismas reglas A, A2, B y C que detectMultilineBlockFormat. */
function isLineParagraphs(lines) {
    const lineCount = lines.length;
    if (lineCount <= 1) return false;
    const wordCounts = lines.map(countWords);
    const totalWords = wordCounts.reduce((a, b) => a + b, 0);
    const averageWordCount = totalWords / lineCount;
    let terminal = 0, start = 0;
    for (const line of lines) {
        if (TERMINAL_PUNCT_RX.test(line)) terminal += 1;
        if (PARAGRAPH_START_RX.test(line)) start += 1;
    }
    const terminalRatio = terminal / lineCount;
    const startRatio = start / lineCount;
    if (lineCount >= MIN_LINES_FOR_LINE_PARAGRAPHS && averageWordCount >= LONG_LINE_WORDS && terminalRatio >= 0.5) return true;
    if (lineCount >= 5 && totalWords >= 50 && startRatio >= 0.6 && terminalRatio >= 0.5) return true;
    return false; // B y C → wrapped-paragraph
}

/**
 * Clasifica un bloque fuente (líneas contiguas no vacías) en unidades
 * {type, lines:[índices]} con la misma lógica que classifyBlocks.
 */
function classifySourceBlock(indices, view) {
    const units = [];
    const single = (i) => units.push({ type: isChapterHeading(view[i]) ? 'heading' : 'paragraph', lines: [i] });
    if (indices.length === 1) { single(indices[0]); return units; }

    // splitChapterHeadingsInBlock
    const groups = [];
    let current = [];
    let foundHeading = false;
    for (const i of indices) {
        if (isChapterHeading(view[i])) {
            foundHeading = true;
            if (current.length) { groups.push(current); current = []; }
            groups.push([i]);
        } else {
            current.push(i);
        }
    }
    if (current.length) groups.push(current);
    const subBlocks = foundHeading ? groups : [indices];
    const inheritLineParagraphs = foundHeading && indices.length >= 5;

    for (const sub of subBlocks) {
        if (sub.length === 1) { single(sub[0]); continue; }
        const lineParagraphs = inheritLineParagraphs || isLineParagraphs(sub.map(i => view[i]));
        if (lineParagraphs) sub.forEach(single);
        else units.push({ type: 'paragraph', lines: sub });
    }
    return units;
}

export function importTxtToCanonicalBook({ contentId, text, contentFingerprint, language } = {}) {
    if (typeof contentId !== 'string' || !contentId) {
        throw new CanonicalBookError('INVALID_CONTENT_ID', 'contentId debe ser un string no vacío');
    }
    if (typeof text !== 'string') {
        throw new CanonicalBookError('INVALID_TEXT', 'text debe ser un string');
    }
    if (text.length > MAX_CANONICAL_SOURCE_CHARS) {
        throw new CanonicalBookError('TEXT_TOO_LARGE', `text supera ${MAX_CANONICAL_SOURCE_CHARS} caracteres`);
    }
    assertValidFingerprint(contentFingerprint);

    const normalized = normalizeTextForContentFingerprint(text);
    const lines = normalized === '' ? [] : normalized.split('\n');
    const view = lines.map(accessibleLine);

    // Bloques fuente: líneas contiguas no vacías (vacía = solo espacio en blanco,
    // igual que el split /\n\s*\n/ del parser de Accesible).
    const units = [];
    let run = [];
    for (let i = 0; i <= lines.length; i++) {
        if (i < lines.length && view[i] !== '') { run.push(i); continue; }
        if (run.length) { units.push(...classifySourceBlock(run, view)); run = []; }
    }

    // Árbol de capítulos + separadores exactos entre bloques.
    const chapters = [];
    let current = null;
    let prevEnd = -1;
    for (const unit of units) {
        const start = unit.lines[0];
        const end = unit.lines[unit.lines.length - 1];
        const gap = lines.slice(prevEnd + 1, start).map(l => l + '\n').join('');
        const separator = prevEnd < 0 ? gap : '\n' + gap;
        const defaultSeparator = prevEnd < 0 ? DEFAULT_FIRST_SEPARATOR : DEFAULT_BLOCK_SEPARATOR;

        if (unit.type === 'heading' || !current) {
            current = unit.type === 'heading'
                ? { id: chapterId(chapters.length + 1), blocks: [] }
                : { id: chapterId(chapters.length + 1), implicit: true, blocks: [] };
            chapters.push(current);
        }
        const block = {
            id: blockId(unit.type, chapters.length, current.blocks.length + 1),
            type: unit.type,
            text: lines.slice(start, end + 1).join('\n'),
        };
        if (separator !== defaultSeparator) block.separatorBefore = separator;
        current.blocks.push(block);
        prevEnd = end;
    }
    // Sin bloques: un único capítulo implícito vacío (el Modo Accesible hace
    // lo mismo). No se inventa texto: el rótulo lo decide cada visor.
    if (chapters.length === 0) chapters.push({ id: chapterId(1), implicit: true, blocks: [] });

    const book = { schemaVersion: CANONICAL_SCHEMA_VERSION, contentId, contentFingerprint };
    if (typeof language === 'string' && language) book.language = language;
    book.chapters = chapters;
    const trailing = prevEnd < 0 ? normalized : lines.slice(prevEnd + 1).map(l => '\n' + l).join('');
    if (trailing) book.trailing = trailing;
    return book;
}
