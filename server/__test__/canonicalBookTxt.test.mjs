/**
 * canonicalBookTxt.test.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 2A.
 *
 * TXT → CanonicalBook → TXT:
 *   - contrato v1 (ids, tipos, capítulo implícito sin texto inventado);
 *   - round-trip: la rendición es la fuente normalizada (mismo fingerprint);
 *   - paridad estructural con el parser REAL del Modo Accesible (el .ts se
 *     transpila en memoria y se importa como data: URL, sin escribir en el repo);
 *   - paridad de entrada del Inmersivo: el TTS real en modo mock produce los
 *     mismos chunks y frases desde la fuente y desde la rendición.
 *
 * Aislamiento: testMode primero; el TTS escribe solo en directorios temporales.
 *
 *   node server/__test__/canonicalBookTxt.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

process.env.TTS_MODE = 'mock';
process.env.AI_MODE = 'mock';

const { importTxtToCanonicalBook, accessibleLine } = await import('../content/txtImporter.js');
const { renderCanonicalBookToPlainText: render } = await import('../content/canonicalTxtRenderer.js');
const { validateCanonicalBook, chapterTitle, CanonicalBookError, CANONICAL_SCHEMA_VERSION, MAX_CANONICAL_SOURCE_CHARS } = await import('../content/canonicalBook.js');
const { computeContentFingerprint: fp, normalizeTextForContentFingerprint: norm } = await import('../contentFingerprint.js');
const { generateAudioForContent } = await import('../ttsService.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// Parser real del Modo Accesible.
const tsSource = fs.readFileSync(path.join(REPO, 'utils', 'a11yDocumentParser.ts'), 'utf8');
const { outputText } = ts.transpileModule(tsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { parsePlainTextToA11yBook } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

const imp = (text, contentId = 'c-test') => importTxtToCanonicalBook({ contentId, text, contentFingerprint: fp(text) });

/** Proyección de un bloque canónico a lo que muestra el Modo Accesible. */
const accessibleText = (text) => text.split('\n').map(accessibleLine).filter(Boolean).join(' ');

function accessibleParity(text) {
    const book = imp(text);
    const a11y = parsePlainTextToA11yBook({ contentId: 'c-test', title: 't', rawText: text });
    const canon = book.chapters.map(ch => ({
        title: ch.implicit ? 'Texto completo' : accessibleLine(chapterTitle(ch)),
        paragraphs: ch.blocks.filter(b => b.type === 'paragraph').map(b => accessibleText(b.text)),
    }));
    const ref = a11y.chapters.map(ch => ({
        title: ch.heading.text,
        paragraphs: ch.sections.flatMap(s => s.paragraphs.map(p => p.text)),
    }));
    const same = JSON.stringify(canon) === JSON.stringify(ref);
    let detail = '';
    if (!same) {
        detail = `capítulos ${canon.length} vs ${ref.length}; párrafos ${canon.flatMap(c => c.paragraphs).length} vs ${ref.flatMap(c => c.paragraphs).length}`;
    }
    return { same, detail };
}

const roundTrip = (text) => {
    const book = imp(text);
    const rendered = render(book);
    return { book, rendered, exact: rendered === norm(text), fpEqual: fp(rendered) === fp(text) };
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] contrato y casos C1–C16');
{
    const b = imp('Había una vez un gato.\n\nDormía mucho.');
    ok('C1 sin capítulos → 1 capítulo implícito, sin título inventado', b.chapters.length === 1 && b.chapters[0].implicit === true && !('title' in b.chapters[0]) && chapterTitle(b.chapters[0]) === null);
    ok('C1 no aparece "Texto completo" en el libro', !JSON.stringify(b).includes('Texto completo'));
    ok('schemaVersion 1 y contrato válido', b.schemaVersion === CANONICAL_SCHEMA_VERSION && CANONICAL_SCHEMA_VERSION === 1 && validateCanonicalBook(b).length === 0, validateCanonicalBook(b).join(';'));
    ok('fingerprint incorporado tal cual', b.contentFingerprint === fp('Había una vez un gato.\n\nDormía mucho.'));
    ok('sin sourceFormat, URL ni fechas en el libro', !/sourceFormat|url|At"|timestamp/i.test(JSON.stringify(b)));
}
{
    const b = imp('Capítulo 1\n\nEl barco zarpó.');
    ok('C2 «Capítulo 1» → capítulo explícito con encabezado', b.chapters.length === 1 && !b.chapters[0].implicit && chapterTitle(b.chapters[0]) === 'Capítulo 1' && b.chapters[0].blocks[1].type === 'paragraph');
    ok('C3 «Chapter 1» → capítulo', chapterTitle(imp('Chapter 1\n\nText.').chapters[0]) === 'Chapter 1');
    ok('C4 romano «CAPÍTULO IV» y «Capitulo xii: El mar» → capítulos', imp('CAPÍTULO IV\n\nA.\n\nCapitulo xii: El mar\n\nB.').chapters.length === 2);
    ok('C4 prosa «El capítulo más triste…» NO es capítulo', imp('El capítulo 3 fue triste.').chapters[0].implicit === true);
    ok('C4 línea de >120 caracteres NO es capítulo', imp('Capítulo 1 ' + 'x'.repeat(120)).chapters[0].implicit === true);
    const five = imp(['Prólogo.', 'Capítulo 1', 'Uno.', 'Capítulo 2', 'Dos.', 'Capítulo 3', 'Tres.'].join('\n\n'));
    ok('C5 texto previo + 3 capítulos → implícito + 3', five.chapters.length === 4 && five.chapters[0].implicit && five.chapters.slice(1).every(c => !c.implicit));
    const many = imp('Uno.\n\nDos.\n\nTres.');
    ok('C6 tres párrafos → 3 bloques paragraph en orden', many.chapters[0].blocks.map(x => x.text).join('|') === 'Uno.|Dos.|Tres.');
    ok('C7 CRLF ≡ LF (mismo libro)', JSON.stringify(imp('Uno.\r\n\r\nDos.')) === JSON.stringify(imp('Uno.\n\nDos.')));
    ok('C8 BOM ≡ sin BOM', JSON.stringify(imp('﻿Uno.\n\nDos.')) === JSON.stringify(imp('Uno.\n\nDos.')));
    ok('C9 puntuación y caracteres especiales intactos', imp('¿Qué? ¡No! —dijo… «bien» “sí”.').chapters[0].blocks[0].text === '¿Qué? ¡No! —dijo… «bien» “sí”.');
    ok('C10 párrafos cortos se conservan', imp('Sí.\n\nNo.\n\nTal vez.').chapters[0].blocks.length === 3);
    const wrapped = imp('Era una mañana fría de invierno y el\nviento soplaba con fuerza entre los\nárboles del bosque viejo.');
    ok('C11 hard-wrap corto → 1 párrafo que conserva sus saltos', wrapped.chapters[0].blocks.length === 1 && wrapped.chapters[0].blocks[0].text.split('\n').length === 3);
    const e = imp('');
    ok('C12 texto vacío → libro válido, 1 capítulo implícito sin bloques, rendición vacía', e.chapters.length === 1 && e.chapters[0].implicit && e.chapters[0].blocks.length === 0 && render(e) === '' && validateCanonicalBook(e).length === 0);
    ok('C12 solo espacios/saltos → vacío equivalente', render(imp('  \n\n\t\n')) === norm('  \n\n\t\n'));
    const s = fs.readFileSync(path.join(REPO, 'utils/__test__/corpus/A-novela-clasica-limpia.txt'), 'utf8');
    ok('C13 determinismo: dos importaciones byte a byte iguales', JSON.stringify(imp(s)) === JSON.stringify(imp(s)));
    const ids = imp(s).chapters.flatMap(c => [c.id, ...c.blocks.map(x => x.id)]);
    ok('C14 IDs únicos', new Set(ids).size === ids.length && ids.length > 2);
    ok('C15 continuidad del fingerprint', roundTrip(s).fpEqual);
    const once = imp(s);
    ok('C16 import → render → import estable', JSON.stringify(importTxtToCanonicalBook({ contentId: 'c-test', text: render(once), contentFingerprint: once.contentFingerprint })) === JSON.stringify(once));
}

console.log('\n[2] errores explícitos');
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e instanceof CanonicalBookError && e.code === code; } };
ok('texto no string → INVALID_TEXT', throwsCode(() => importTxtToCanonicalBook({ contentId: 'x', text: null, contentFingerprint: fp('') }), 'INVALID_TEXT'));
ok('contentId vacío → INVALID_CONTENT_ID', throwsCode(() => importTxtToCanonicalBook({ contentId: '', text: 'a', contentFingerprint: fp('a') }), 'INVALID_CONTENT_ID'));
ok('fingerprint inválido → INVALID_FINGERPRINT', throwsCode(() => importTxtToCanonicalBook({ contentId: 'x', text: 'a', contentFingerprint: 'md5:abc' }), 'INVALID_FINGERPRINT'));
ok('texto demasiado grande → TEXT_TOO_LARGE', throwsCode(() => importTxtToCanonicalBook({ contentId: 'x', text: 'a'.repeat(MAX_CANONICAL_SOURCE_CHARS + 1), contentFingerprint: fp('a') }), 'TEXT_TOO_LARGE'));

console.log('\n[3] bordes de formato: round-trip exacto + paridad con Accesible');
const EDGE = {
    'blancos múltiples entre párrafos': 'Uno.\n\n\n\n\nDos.',
    'líneas en blanco con espacios/tabs': 'Uno.\n   \n\t\nDos.',
    'línea en blanco con NBSP': 'Uno.\n \nDos.',
    'NBSP al final del archivo': 'Uno.\n ',
    'saltos iniciales': '\n\n\nUno.\n\nDos.',
    'sangría y espacios internos': '   Uno  con   espacios.\n\n\tDos.',
    'encabezado pegado a la prosa (EPUB raro)': 'Capítulo 1\nEl barco zarpó al amanecer.',
    'bloque largo con capítulos pegados (hereda línea=párrafo)': 'Capítulo 1\nUna.\nDos.\nCapítulo 2\nTres.\nCuatro.',
    'prosa línea a línea (regla A)': Array.from({ length: 4 }, (_, i) => `Esta es la línea ${i} con bastantes palabras para superar el umbral de veinte palabras de promedio por línea sin duda alguna.`).join('\n'),
    'verso corto (regla B)': 'Verde que te quiero verde\nverde viento verdes ramas\nel barco sobre la mar\ny el caballo en la montaña',
    'CR sueltos (Mac clásico)': 'Uno.\r\rDos.',
    'solo encabezados': 'Capítulo 1\n\nCapítulo 2',
};
for (const [label, text] of Object.entries(EDGE)) {
    const rt = roundTrip(text);
    const par = accessibleParity(text);
    ok(`${label}: round-trip exacto, fingerprint igual y paridad`, rt.exact && rt.fpEqual && par.same && validateCanonicalBook(rt.book).length === 0, `${rt.exact}/${rt.fpEqual}/${par.detail}/${validateCanonicalBook(rt.book).join(';')}`);
}

console.log('\n[4] corpus del repo (utils/__test__/corpus, incluye H-epub-raro)');
const CORPUS_DIR = path.join(REPO, 'utils', '__test__', 'corpus');
const corpus = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.txt')).sort();
ok('H-epub-raro.txt presente', corpus.includes('H-epub-raro.txt'));
const ttsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_canon_tts_'));
const ttsInput = async (id, text) => {
    const dir = path.join(ttsRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'src.txt'), text);
    await generateAudioForContent(id, path.join(dir, 'src.txt'), dir);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'audio', id, 'manifest.json'), 'utf8'));
    return JSON.stringify({ meta: m._meta, chunks: Object.keys(m).filter(k => k !== '_meta').map(k => [m[k].text, m[k].sentences, m[k].sentenceStart]) });
};
for (const file of corpus) {
    const text = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8');
    const rt = roundTrip(text);
    const par = accessibleParity(text);
    const guided = rt.rendered.split('\n').join('\n') === text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
    const same = (await ttsInput(`src-${file}`, text)) === (await ttsInput(`ren-${file}`, rt.rendered));
    const chapters = rt.book.chapters.length, blocks = rt.book.chapters.reduce((a, c) => a + c.blocks.length, 0);
    ok(`${file}: ${chapters} cap / ${blocks} bloques — round-trip, fingerprint, Accesible, Guiado, Inmersivo`,
        rt.exact && rt.fpEqual && par.same && guided && same && validateCanonicalBook(rt.book).length === 0,
        `rt=${rt.exact} fp=${rt.fpEqual} a11y=${par.same}(${par.detail}) guiado=${guided} inmersivo=${same}`);
}
fs.rmSync(ttsRoot, { recursive: true, force: true });

console.log(`\ncanonicalBookTxt — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
