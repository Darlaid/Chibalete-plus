/**
 * a11yDocumentParser.test.mjs — regresión post-G1.
 *
 * Estos tests blindan el comportamiento que se decidió tras la auditoría
 * estática G1: el parser NUNCA debe inferir headings (ni h3 ni cualquier
 * otro nivel) desde texto plano que no sea un patrón explícito de capítulo.
 *
 * Si alguien reactiva por error la heurística `isSectionHeading` (o agrega
 * cualquier otra inferencia desde prosa), la suite se cae.
 *
 * Ejecutar:
 *   node utils/__test__/a11yDocumentParser.test.mjs
 *
 * No requiere vitest/jest. Transpila el parser .ts en memoria con la API
 * de typescript (ya está como devDep), escribe el JS resultante a un
 * archivo temporal, lo importa, corre los asserts y limpia el tmp.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PARSER_TS_PATH = path.resolve(__dirname, '../a11yDocumentParser.ts');
const TMP_JS_PATH    = path.resolve(__dirname, '.tmp-a11yDocumentParser.test.mjs');

// ── Setup: transpilar TS → JS ESM ────────────────────────────────────────────

if (!fs.existsSync(PARSER_TS_PATH)) {
    console.error(`✗ no se encontró ${PARSER_TS_PATH}`);
    process.exit(1);
}

const tsSource = fs.readFileSync(PARSER_TS_PATH, 'utf8');
const { outputText, diagnostics } = ts.transpileModule(tsSource, {
    compilerOptions: {
        target:           ts.ScriptTarget.ES2022,
        module:           ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop:  true,
        // El parser solo importa types con `import type`, esto los elimina.
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    reportDiagnostics: true,
});

if (diagnostics && diagnostics.length > 0) {
    for (const d of diagnostics) {
        const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        console.warn(`[ts diagnostic] ${msg}`);
    }
}

fs.writeFileSync(TMP_JS_PATH, outputText, 'utf8');

let parsePlainTextToA11yBook;
let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, label, detail = '') {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else      { fail += 1; failures.push(`${label}${detail ? ' — ' + detail : ''}`); console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// Helper: aplana el árbol y devuelve la lista de headings con sus levels.
function collectHeadings(book) {
    const out = [];
    out.push({ level: 1, text: book.title, source: 'book.title' });
    for (const ch of book.chapters) {
        if (ch.heading) out.push({ level: ch.heading.level, text: ch.heading.text, source: `chap-${ch.index}` });
        for (const sec of ch.sections) {
            if (sec.heading) out.push({ level: sec.heading.level, text: sec.heading.text, source: sec.id });
        }
    }
    return out;
}

function collectAllSectionHeadings(book) {
    const out = [];
    for (const ch of book.chapters) {
        for (const sec of ch.sections) {
            if (sec.heading) out.push(sec.heading);
        }
    }
    return out;
}

function collectAllParagraphs(book) {
    const out = [];
    for (const ch of book.chapters) {
        for (const sec of ch.sections) {
            for (const p of sec.paragraphs) out.push(p);
        }
    }
    return out;
}

const HTML_TAG_RX = /<\/?[a-z][\s\S]*?>/i;

// ── Carga del módulo ─────────────────────────────────────────────────────────

try {
    const mod = await import(pathToFileURL(TMP_JS_PATH).href);
    parsePlainTextToA11yBook = mod.parsePlainTextToA11yBook;
    if (typeof parsePlainTextToA11yBook !== 'function') {
        throw new Error('parsePlainTextToA11yBook no exportada por el módulo transpilado');
    }
} catch (e) {
    console.error(`✗ fallo al cargar el parser transpilado: ${e.message}`);
    if (fs.existsSync(TMP_JS_PATH)) fs.unlinkSync(TMP_JS_PATH);
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 1 — Ninguna línea corta de prosa genera section.heading
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 1] Líneas cortas de prosa NO generan section.heading');
{
    const rawText = [
        'Era una mañana fría',
        '',
        'No había nadie',
        '',
        'Solo el viento',
        '',
        'Y un eco lejano',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'test-1', title: 'Test 1', rawText,
    });
    const sectionHeadings = collectAllSectionHeadings(book);
    assert(sectionHeadings.length === 0,
        `cero section.heading en libro de prosa corta (esperado 0, got ${sectionHeadings.length})`,
        sectionHeadings.map(h => h.text).join(' | '));
    // Las 4 líneas son párrafos.
    assert(book.totalParagraphs === 4,
        `4 párrafos (esperado 4, got ${book.totalParagraphs})`);
    // Sin capítulo explícito → 1 capítulo "Texto completo".
    assert(book.chapters.length === 1, 'un solo capítulo implícito');
    assert(book.chapters[0].heading.text === 'Texto completo', 'capítulo implícito etiquetado');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 2 — Diálogos breves no generan h3
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 2] Diálogos breves NO generan h3');
{
    const rawText = [
        'Capítulo 1',
        '',
        '— Sí',
        '',
        '— ¿Estás seguro?',
        '',
        '— Lo estoy',
        '',
        '— Bien',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'test-2', title: 'Test 2', rawText,
    });
    const headings = collectHeadings(book);
    const h3s = headings.filter(h => h.level === 3);
    assert(h3s.length === 0, `cero h3 en libro de diálogos cortos (got ${h3s.length})`,
        h3s.map(h => h.text).join(' | '));
    // El único capítulo "Capítulo 1" como h2.
    const h2s = headings.filter(h => h.level === 2);
    assert(h2s.length === 1, `un solo h2 (got ${h2s.length})`);
    assert(h2s[0].text === 'Capítulo 1', 'h2 = "Capítulo 1"');
    assert(book.totalParagraphs === 4, '4 párrafos de diálogo');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 3 — Epígrafes no generan h3
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 3] Epígrafes / frases sueltas NO generan h3');
{
    const rawText = [
        'El sol se ponía',
        '',
        'Editor',
        '',
        'Sí',
        '',
        'Y entonces empezó.',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'test-3', title: 'Test 3', rawText,
    });
    const sectionHeadings = collectAllSectionHeadings(book);
    assert(sectionHeadings.length === 0,
        `cero section.heading con epígrafes/frases sueltas (got ${sectionHeadings.length})`,
        sectionHeadings.map(h => h.text).join(' | '));
    assert(book.totalParagraphs === 4, '4 párrafos (todas las líneas son párrafos)');
    // Verificamos que esas líneas concretas NO aparezcan como heading text.
    const allHeadings = collectHeadings(book).map(h => h.text);
    for (const line of ['El sol se ponía', 'Editor', 'Sí']) {
        assert(!allHeadings.includes(line),
            `"${line}" no aparece como heading`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 4 — Solo capítulos explícitos generan heading level 2
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 4] Solo capítulos explícitos producen h2');
{
    const rawText = [
        'Capítulo 1',
        '',
        'Texto del primer capítulo.',
        '',
        'Más texto.',
        '',
        'Capítulo 2',
        '',
        'Texto del segundo.',
        '',
        'CAPÍTULO III',
        '',
        'Tercer capítulo en romanos mayúsculas.',
        '',
        'Chapter 4',
        '',
        'Cuarto capítulo en inglés.',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'test-4', title: 'Test 4', rawText,
    });
    const headings = collectHeadings(book);
    const h2s = headings.filter(h => h.level === 2);
    const h3s = headings.filter(h => h.level === 3);
    const h1s = headings.filter(h => h.level === 1);
    assert(h2s.length === 4, `4 capítulos detectados (got ${h2s.length})`,
        h2s.map(h => h.text).join(' | '));
    assert(h3s.length === 0, `cero h3 en libro de capítulos limpios (got ${h3s.length})`);
    assert(h1s.length === 1, `un solo h1 (book.title) (got ${h1s.length})`);
    assert(h2s[0].text === 'Capítulo 1', 'h2 #1');
    assert(h2s[1].text === 'Capítulo 2', 'h2 #2');
    assert(h2s[2].text === 'CAPÍTULO III', 'h2 #3 acepta romanos mayúsculas');
    assert(h2s[3].text === 'Chapter 4', 'h2 #4 acepta "Chapter" en inglés');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 5 — Libro vacío no rompe
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 5] Inputs degenerados no rompen el parser');
{
    // 5a. rawText = ''
    {
        let book;
        let threw = false;
        try {
            book = parsePlainTextToA11yBook({
                contentId: 'test-5a', title: 'Vacío', rawText: '',
            });
        } catch { threw = true; }
        assert(!threw,                           '5a: rawText vacío no lanza');
        assert(book.totalParagraphs === 0,       '5a: 0 párrafos');
        assert(book.chapters.length === 1,       '5a: 1 capítulo "Texto completo"');
        assert(book.chapters[0].heading.level === 2, '5a: capítulo implícito h2');
    }
    // 5b. rawText con solo whitespace
    {
        let threw = false;
        let book;
        try {
            book = parsePlainTextToA11yBook({
                contentId: 'test-5b', title: 'WS', rawText: '   \n\n\n   \t\n',
            });
        } catch { threw = true; }
        assert(!threw,                           '5b: solo whitespace no lanza');
        assert(book.totalParagraphs === 0,       '5b: 0 párrafos');
        assert(book.chapters.length >= 1,        '5b: al menos 1 capítulo');
    }
    // 5c. rawText null/undefined defensivos
    {
        let threw = false;
        let book;
        try {
            book = parsePlainTextToA11yBook({
                contentId: 'test-5c', title: 'Null', rawText: null,
            });
        } catch { threw = true; }
        assert(!threw,                           '5c: rawText null no lanza (?? "" defensivo)');
        assert(book && book.totalParagraphs === 0, '5c: shape válido');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 6 — IDs de párrafos estables
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 6] IDs estables: mismo input → mismos IDs');
{
    const rawText = [
        'Capítulo 1',
        '',
        'Primero.',
        '',
        'Segundo.',
        '',
        'Capítulo 2',
        '',
        'Tercero.',
    ].join('\n');
    const a = parsePlainTextToA11yBook({ contentId: 'x', title: 'Y', rawText });
    const b = parsePlainTextToA11yBook({ contentId: 'x', title: 'Y', rawText });
    const idsA = collectAllParagraphs(a).map(p => p.id);
    const idsB = collectAllParagraphs(b).map(p => p.id);
    assert(idsA.length === idsB.length, `mismo número de párrafos (${idsA.length} vs ${idsB.length})`);
    assert(idsA.length === 3,           `3 párrafos esperados (got ${idsA.length})`);
    assert(JSON.stringify(idsA) === JSON.stringify(idsB),
        'IDs idénticos run a run');
    // Formato `p-{chap}-{sec}-{para}`.
    const ID_RX = /^p-\d+-\d+-\d+$/;
    for (const id of idsA) {
        assert(ID_RX.test(id), `id "${id}" cumple formato p-N-M-K`);
    }
    // IDs concretos esperados.
    assert(idsA[0] === 'p-1-1-1', `primer párrafo cap 1 → ${idsA[0]}`);
    assert(idsA[1] === 'p-1-1-2', `segundo párrafo cap 1 → ${idsA[1]}`);
    assert(idsA[2] === 'p-2-1-1', `primer párrafo cap 2 → ${idsA[2]}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 7 — El parser nunca devuelve HTML
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 7] El parser preserva texto plano, no devuelve HTML');
{
    // 7a. Texto con tags literales debe preservarse como string sin parsear.
    {
        const rawText = [
            'Capítulo 1',
            '',
            'Una línea con <p>etiqueta literal</p> dentro.',
            '',
            'Otra con <script>alert(1)</script> simulada.',
        ].join('\n');
        const book = parsePlainTextToA11yBook({
            contentId: 'test-7a', title: 'HTML literal', rawText,
        });
        const paras = collectAllParagraphs(book);
        assert(paras.length === 2, '2 párrafos');
        // Los paragraphs DEBEN contener el texto del HTML como string.
        // El test fundamental: book → JSON → parse → mismo objeto sin tags
        // ejecutados ni reformateados. parsed.text debe ser idéntico a la
        // entrada (después del trim/normalize del parser).
        assert(paras[0].text.includes('<p>') && paras[0].text.includes('</p>'),
            'tags literales preservados como texto');
        assert(paras[1].text.includes('<script>'),
            'script tag preservado como texto (no ejecutado / no eliminado)');
        // El valor `text` es string, no objeto/JSX.
        assert(typeof paras[0].text === 'string', 'paragraph.text es string');
        assert(typeof paras[1].text === 'string', 'paragraph.text es string');
    }
    // 7b. Ningún heading.text contiene tags HTML "balanceados" (no debe haber
    //     transformación que produzca tags).
    {
        const rawText = 'Capítulo 1\n\nUn texto normal.';
        const book = parsePlainTextToA11yBook({
            contentId: 'test-7b', title: 'Limpio', rawText,
        });
        const headings = collectHeadings(book);
        for (const h of headings) {
            assert(!HTML_TAG_RX.test(h.text),
                `heading "${h.text}" libre de tags HTML`);
        }
        const paras = collectAllParagraphs(book);
        for (const p of paras) {
            assert(!HTML_TAG_RX.test(p.text),
                `párrafo libre de tags HTML añadidos por el parser`);
        }
    }
    // 7c. Confirmar que NO hay ninguna propiedad llamada __html / dangerouslySetInnerHTML
    //     en el árbol producido.
    {
        const rawText = 'Capítulo 1\n\nPárrafo.';
        const book = parsePlainTextToA11yBook({
            contentId: 'test-7c', title: 'Shape', rawText,
        });
        const json = JSON.stringify(book);
        assert(!json.includes('__html'),
            'shape no contiene __html');
        assert(!json.includes('dangerouslySetInnerHTML'),
            'shape no contiene dangerouslySetInnerHTML');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 8 — Regression guard del bug eliminado en G1
// ─────────────────────────────────────────────────────────────────────────────
//
// Estos inputs son los que la heurística ANTERIOR convertía falsamente en
// h3. Si alguien reactiva por error la lógica `isSectionHeading`, estos
// asserts caen.
console.log('\n[CASO 8] Regression guard: inputs que el parser viejo convertía en h3');
{
    const inputs = [
        'Bienvenida',                   // 1 palabra, < 90 chars, sin puntuación
        'PRIMERA PARTE',                // mayúsculas cortas
        'Una mañana cualquiera',        // 3 palabras sin punto
        'Adiós',                        // 1 palabra con tilde
        'Madrid 1923',                  // alfanumérico
        '¿Quién',                        // empieza con ¿ (válido para regex)
    ];
    for (const linea of inputs) {
        const rawText = [
            'Capítulo 1',
            '',
            linea,
            '',
            'Texto siguiente.',
        ].join('\n');
        const book = parsePlainTextToA11yBook({
            contentId: 'test-8', title: 'guard', rawText,
        });
        const sectionHeadings = collectAllSectionHeadings(book);
        assert(sectionHeadings.length === 0,
            `"${linea}" NO se convierte en heading (got ${sectionHeadings.length} section headings)`);
        const paras = collectAllParagraphs(book);
        assert(paras.some(p => p.text === linea),
            `"${linea}" aparece como paragraph.text`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 9 — Multi-línea wrapped (líneas cortas sin puntuación) → un párrafo
// ─────────────────────────────────────────────────────────────────────────────
//
// Regression guard del comportamiento legacy preservado en UX-4C: bloques
// con líneas cortas y sin puntuación final siguen fusionándose como un solo
// párrafo. Cubre wrap-80, versos breves y listas — los formatos que la
// heurística NO debe fragmentar.
console.log('\n[CASO 9] Bloque multi-línea wrapped → un solo párrafo');
{
    const rawText = [
        'Capítulo 1',
        '',
        'Línea uno',
        'línea dos',
        'línea tres',
        '',
        'Otro párrafo.',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'test-9', title: 'multi', rawText,
    });
    const paras = collectAllParagraphs(book);
    assert(paras.length === 2, `2 párrafos (got ${paras.length})`);
    assert(paras[0].text === 'Línea uno línea dos línea tres',
        'líneas del primer bloque unidas con espacio');
    assert(paras[1].text === 'Otro párrafo.', 'segundo párrafo intacto');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 10 — UX-4C: parserVersion + parserStats presentes en el shape
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 10] UX-4C — parserVersion y parserStats expuestos');
{
    const rawText = 'Capítulo 1\n\nUn párrafo de prueba con varias palabras.';
    const book = parsePlainTextToA11yBook({
        contentId: 'test-10', title: 'meta', rawText,
    });
    assert(typeof book.parserVersion === 'string' && book.parserVersion.length > 0,
        `parserVersion presente (got ${book.parserVersion})`);
    assert(book.parserVersion === 'a11y-parser-v2',
        `parserVersion === 'a11y-parser-v2'`);
    assert(book.parserStats && typeof book.parserStats === 'object',
        'parserStats es un objeto');
    const s = book.parserStats;
    assert(typeof s.chaptersCount === 'number' && s.chaptersCount >= 1,
        `chaptersCount es número >=1 (got ${s.chaptersCount})`);
    assert(typeof s.paragraphsCount === 'number',
        'paragraphsCount es número');
    assert(typeof s.totalWords === 'number',
        'totalWords es número');
    assert(Array.isArray(s.warnings),
        'warnings es array');
    assert(typeof s.detectedFormat === 'object',
        'detectedFormat es objeto');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 1 — UX-4C: blank-line paragraphs (formato editorial clásico)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[FIXTURE 1] Párrafos separados por blank-lines — caso editorial clásico');
{
    const rawText = [
        'Capítulo 1',
        '',
        'Era una mañana fría y el viento susurraba entre los árboles del jardín. Alicia caminaba lentamente hacia la fuente.',
        '',
        'En su mano llevaba un libro pequeño, que apretaba con fuerza para no dejarlo caer al suelo mojado.',
        '',
        'El conejo apareció de pronto, mirando el reloj con cara preocupada y refunfuñando algo sobre la duquesa.',
        '',
        'Capítulo 2',
        '',
        'La fiesta había comenzado sin que nadie se diera cuenta de la hora exacta a la que sonó la primera campanada.',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'fixture-1', title: 'Blank lines', rawText,
    });
    const paras = collectAllParagraphs(book);
    const s = book.parserStats;
    assert(book.chapters.length === 2, `2 capítulos (got ${book.chapters.length})`);
    assert(paras.length === 4, `4 párrafos (got ${paras.length})`);
    assert(s.maxWordsPerParagraph < 100,
        `ningún párrafo gigante (max ${s.maxWordsPerParagraph})`);
    assert(s.oversizeParagraphsCount === 0,
        `0 párrafos oversize (got ${s.oversizeParagraphsCount})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 2 — UX-4C: line-per-paragraph (formato Alicia)
// ─────────────────────────────────────────────────────────────────────────────
//
// Crítico: este fixture reproduce el patrón que destruía el parser pre-UX-4C.
// Cada línea del .txt es un párrafo editorial; NO hay blank-lines internas
// en el cuerpo del capítulo. La heurística debe reconocerlo y producir
// muchos párrafos en lugar de un mega-bloque.
console.log('\n[FIXTURE 2] Una línea = un párrafo (formato Alicia)');
{
    const lines = [
        'Capítulo 1',
        '',
        'Alicia comenzaba a sentirse muy cansada de estar sentada junto a su hermana, en la orilla del banco, y de no tener nada que hacer; una o dos veces había mirado dentro del libro que su hermana estaba leyendo.',
        'Así que estaba considerando en su propia mente, tanto como podía, porque el día caluroso la hacía sentir adormecida, si el placer de hacer una guirnalda de margaritas valdría la molestia de levantarse y recoger las margaritas.',
        'No había nada tan notable en eso; ni Alicia pensó que fuera tan extraño escuchar al conejo decir para sí mismo que llegaría tarde, porque cuando lo pensó después, se le ocurrió que debió haberse preguntado por esto.',
        'Pero cuando el conejo sacó un reloj del bolsillo de su chaleco, lo miró y luego se fue corriendo, Alicia se levantó de un salto porque le cruzó por la mente que nunca había visto nada igual.',
    ];
    const rawText = lines.join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'fixture-2', title: 'Line-per-para', rawText,
    });
    const paras = collectAllParagraphs(book);
    const s = book.parserStats;
    assert(paras.length === 4,
        `4 párrafos esperados, NO 1 mega-párrafo (got ${paras.length})`);
    assert(s.detectedFormat.lineParagraphs >= 4,
        `formato 'line-paragraphs' detectado (got lineParagraphs=${s.detectedFormat.lineParagraphs})`);
    assert(s.detectedFormat.wrappedParagraphs === 0,
        `ningún bloque marcado como wrapped (got ${s.detectedFormat.wrappedParagraphs})`);
    assert(s.maxWordsPerParagraph < 200,
        `ningún párrafo > 200 palabras (got ${s.maxWordsPerParagraph})`);
    // Cada línea debe ser su propio paragraphId.
    const ids = paras.map(p => p.id);
    assert(new Set(ids).size === paras.length, 'todos los IDs son únicos');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 3 — UX-4C: wrap-80 (líneas cortas que pertenecen al mismo párrafo)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[FIXTURE 3] Texto wrapeado a 80 columnas — debe unirse');
{
    const rawText = [
        'Capítulo 1',
        '',
        'alicia caminaba por el',
        'jardín mirando las flores',
        'que crecían junto al muro',
        '',
        'el conejo apareció en',
        'la esquina con prisa',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'fixture-3', title: 'Wrap-80', rawText,
    });
    const paras = collectAllParagraphs(book);
    const s = book.parserStats;
    assert(paras.length === 2, `2 párrafos (un por bloque, got ${paras.length})`);
    assert(paras[0].text.includes('alicia caminaba') && paras[0].text.includes('al muro'),
        'líneas wrap del primer bloque unidas');
    assert(paras[1].text.includes('el conejo') && paras[1].text.includes('prisa'),
        'líneas wrap del segundo bloque unidas');
    assert(s.detectedFormat.wrappedParagraphs >= 2,
        `bloques marcados como wrapped (got ${s.detectedFormat.wrappedParagraphs})`);
    assert(s.detectedFormat.lineParagraphs === 0,
        `cero líneas como line-paragraphs (got ${s.detectedFormat.lineParagraphs})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 4 — UX-4C: capítulos sin blank-lines limpias alrededor
// ─────────────────────────────────────────────────────────────────────────────
//
// En Alicia los caps VI–XII estaban "pegados" al cuerpo previo sin blank-line.
// El parser viejo fusionaba heading + cuerpo + heading siguiente en un solo
// bloque multi-línea → un único mega-párrafo y capítulos perdidos.
console.log('\n[FIXTURE 4] Capítulos pegados a bloques (sin blank-lines limpias)');
{
    const rawText = [
        'Capítulo 1',
        'Primer párrafo del capítulo uno con varias palabras suficientes para parecer prosa real.',
        'Segundo párrafo del capítulo uno con más palabras que hacen que el conjunto sea sustantivo.',
        'Tercer párrafo final del capítulo uno antes de que aparezca el siguiente heading editorial.',
        'Capítulo 2',
        'Primer párrafo del capítulo dos con suficiente longitud para que la heurística lo reconozca.',
        'Segundo párrafo del capítulo dos con más prosa para asegurar la detección de formato lineal.',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'fixture-4', title: 'Caps pegados', rawText,
    });
    assert(book.chapters.length === 2,
        `2 capítulos detectados aunque pegados (got ${book.chapters.length})`);
    const paras = collectAllParagraphs(book);
    assert(paras.length === 5,
        `5 párrafos repartidos en 2 capítulos (got ${paras.length})`);
    assert(book.chapters[0].sections[0].paragraphs.length === 3,
        '3 párrafos en cap 1');
    assert(book.chapters[1].sections[0].paragraphs.length === 2,
        '2 párrafos en cap 2');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 5 — UX-4C: poemas / versos breves no se fragmentan
// ─────────────────────────────────────────────────────────────────────────────
//
// Los versos cortos sin puntuación final deben mantenerse como un único
// "párrafo" lógico (tal como hace el wrapped legacy). La heurística no
// debe romperlos en líneas separadas.
console.log('\n[FIXTURE 5] Poemas / versos breves se preservan como wrapped');
{
    const rawText = [
        'Capítulo 1',
        '',
        // Estrofa de 4 versos cortos sin puntuación final consistente
        '"Eres viejo, padre Guillermo", dijo el joven',
        '"Y tu pelo se ha vuelto muy blanco;',
        'Y, sin embargo, te paras de cabeza incesantemente—',
        '¿Crees, a tu edad, que es correcto?"',
        '',
        // Diálogo breve (cada línea < 12 palabras, sin terminal final)
        '— ¿Quién eres tú',
        '— Soy yo',
        '— ¿Y dónde estás',
        '— Aquí',
    ].join('\n');
    const book = parsePlainTextToA11yBook({
        contentId: 'fixture-5', title: 'Versos', rawText,
    });
    const paras = collectAllParagraphs(book);
    // Cada bloque es UN párrafo (las líneas se mantienen unidas con espacio).
    // Si la heurística fuera demasiado agresiva, los rompería en 4+4=8.
    assert(paras.length === 2,
        `2 párrafos (versos no fragmentados, got ${paras.length})`);
    assert(paras[0].text.includes('padre Guillermo') && paras[0].text.includes('correcto'),
        'estrofa preservada en un solo paragraph.text');
    assert(paras[1].text.includes('Quién eres') && paras[1].text.includes('Aquí'),
        'diálogo breve preservado en un solo paragraph.text');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 11 — UX-4C: detectMultilineBlockFormat es export pure-function
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 11] detectMultilineBlockFormat exportada y aplicable como pure');
{
    // Importamos la función junto con el parser (re-import de mismo módulo).
    const mod = await import(pathToFileURL(TMP_JS_PATH).href);
    const detect = mod.detectMultilineBlockFormat;
    assert(typeof detect === 'function',
        'detectMultilineBlockFormat exportada');

    // Cada línea termina en `.`, son LARGAS (>20 palabras) → line-paragraphs.
    const longLines = [
        'Una línea muy larga con muchas palabras y puntuación final completa al cierre del enunciado para superar el umbral de prosa por línea.',
        'Otra línea suficientemente extensa con prosa real y descriptiva que también termina en punto y supera holgadamente las veinte palabras necesarias.',
        'Y una tercera línea final que también termina en punto y tiene suficiente longitud para ser considerada prosa editorial humana plena.',
    ];
    const det1 = detect(longLines);
    assert(det1.format === 'line-paragraphs',
        `líneas largas con punto → line-paragraphs (got ${det1.format})`);

    // Líneas cortas sin puntuación final → wrapped-paragraph.
    const wrapLines = ['una línea corta', 'sin puntuación', 'pequeñas todas'];
    const det2 = detect(wrapLines);
    assert(det2.format === 'wrapped-paragraph',
        `líneas cortas sin punto → wrapped (got ${det2.format})`);

    // Caso edge: 1 línea → wrapped (no aplica decisión).
    const det3 = detect(['Una sola línea']);
    assert(det3.format === 'wrapped-paragraph',
        '1 línea siempre devuelve wrapped (no aplica)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────`);
console.log(`Resultado: ${pass} pass / ${fail} fail`);
if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log('  - ' + f);
}
console.log(`──────────────────────────────────────────────`);

if (fs.existsSync(TMP_JS_PATH)) fs.unlinkSync(TMP_JS_PATH);

process.exit(fail === 0 ? 0 : 1);
