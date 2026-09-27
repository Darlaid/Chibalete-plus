/**
 * epubImporter.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 3A.
 *
 * EPUB → CanonicalBook v1 (el mismo contrato que el importador TXT). Puro:
 * Buffer → objeto. Sin filesystem, sin red, sin fechas, sin aleatoriedad.
 *
 *   parseEpubArchive(epubBuffer)  → { language, title, a11y, a11yStatus, images, documents }
 *   importEpubToCanonicalBook({ contentId, epubBuffer, contentFingerprint?, language? })
 *
 * Paquete: mimetype = application/epub+zip → META-INF/container.xml → primer
 * rootfile OPF. Todo se resuelve DENTRO del ZIP validado (safeZip.js); ninguna
 * URL con esquema (http:, https:, file:, data:, javascript:…) se sigue jamás.
 *
 * Orden de lectura = SPINE. Se procesan solo los itemref lineales cuyo item es
 * application/xhtml+xml y no es el documento de navegación. Lo demás (CSS,
 * fuentes, imágenes, audio, video, scripts, recursos fuera del spine) se ignora.
 *
 * XHTML → bloques (strictXml.js, sin DTD). Nada de HTML llega a la salida:
 *   - h1–h6 → bloque `heading` con level 1–6 (3C.1); p → bloque `paragraph`
 *     (inline anidado = texto);
 *   - texto suelto dentro de contenedores de bloque (div, section, li,
 *     blockquote, td…) → `paragraph` en el límite del contenedor, para no
 *     perder palabras;
 *   - <br> → salto de línea dentro del bloque;
 *   - espacios ASCII colapsados; NBSP y demás caracteres se conservan;
 *   - se descartan con todo su subárbol: head, script, style, nav, svg, math,
 *     iframe, object, embed, audio, video, canvas, template, noscript, form y
 *     controles, rp; y elementos `hidden`, aria-hidden="true" o
 *     epub:type/role de paginación, índice o landmarks.
 *
 * Imágenes (3C.1): cada <img> aceptada → bloque `image` en la posición que
 * ocupa en el DOM del XHTML (nunca la de la maqueta impresa). Una imagen
 * dentro de un bloque de texto (p/h, o texto suelto que la rodea) va justo
 * DESPUÉS de ese bloque: partirlo alteraría el texto. `src` = nombre de la
 * entrada del ZIP (ruta normalizada del paquete), que debe existir y estar
 * declarada en el manifest con un tipo raster admitido; `alt` = el de la
 * fuente, tal cual (ausente si no lo hay). Nada se extrae ni se escribe aquí.
 *   - src con esquema (http:, data:, javascript:…) → se ignora, nunca se sigue;
 *   - tipo no admitido (SVG incluido) → se ignora;
 *   - traversal/ruta absoluta, recurso ausente o no declarado → rechazo.
 *   Lo ignorado queda en parseEpubArchive().images (diagnóstico).
 *
 * Capítulos: cada documento del spine abre capítulo, y cada encabezado abre
 * otro (CanonicalBook v1 admite un único heading, al inicio del capítulo; es
 * la misma regla que aplica el importador TXT a «Capítulo N»). Texto previo al
 * primer encabezado → capítulo implícito, sin título inventado. Las imágenes
 * no abren capítulo: las previas al primer texto del documento se anteponen al
 * capítulo que ese texto abre; un documento solo con imágenes forma un
 * capítulo implícito. Así el texto conserva capítulos, IDs y fingerprint.
 *
 * Fingerprint: contentFingerprint es el de 1B sobre la RENDICIÓN TXT del libro
 * (renderCanonicalBookToPlainText): identidad del TEXTO, no del archivo. El
 * hash del .epub (bytes) es otro concepto, queda fuera de CanonicalBook y no
 * se calcula aquí. Si el llamador pasa contentFingerprint, debe coincidir.
 *
 * Un EPUB sin texto extraíble se rechaza (EPUB_NO_TEXT): un libro vacío no es
 * un CanonicalBook útil (TTS, lectores) y suele indicar un EPUB solo-imagen.
 */
import path from 'path';
import { computeContentFingerprint } from '../contentFingerprint.js';
import {
    CANONICAL_SCHEMA_VERSION, CanonicalBookError, assertValidFingerprint,
    chapterId, blockId, isTextBlock, isSafeCanonicalMediaSrc, validateCanonicalBook,
} from './canonicalBook.js';
import { renderCanonicalBookToPlainText } from './canonicalTxtRenderer.js';
import { openZip, validateEntryName } from './safeZip.js';
import { parseStrictXml, childElements, textContent } from './strictXml.js';

const fail = (code, message) => { throw new CanonicalBookError(code, message); };

const EPUB_MIMETYPE = 'application/epub+zip';
const OPF_MEDIA_TYPE = 'application/oebps-package+xml';
const XHTML_MEDIA_TYPE = 'application/xhtml+xml';
const LANGUAGE_RX = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
// Raster que los visores muestran como <img> sin superficie activa. SVG queda fuera.
const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const SKIP = new Set(['head', 'script', 'style', 'nav', 'svg', 'math', 'iframe', 'object', 'embed', 'audio', 'video',
    'canvas', 'template', 'noscript', 'form', 'button', 'input', 'select', 'textarea', 'map', 'rp']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_CONTAINERS = new Set(['body', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'blockquote',
    'figure', 'figcaption', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'caption', 'pre', 'hr', 'address', 'details', 'summary', 'hgroup']);
const SKIP_SEMANTICS = new Set(['pagebreak', 'toc', 'landmarks', 'page-list', 'doc-pagebreak', 'doc-toc']);

const decoder = new TextDecoder('utf-8', { fatal: true });
function readXml(zip, name, htmlEntities) {
    let text;
    try { text = decoder.decode(zip.read(name)); } catch (e) {
        if (e instanceof CanonicalBookError) throw e;
        fail('EPUB_ENCODING', `${name} no es UTF-8 válido`);
    }
    return parseStrictXml(text, { htmlEntities });
}

/**
 * href del OPF → nombre de entrada del ZIP, confinado a la raíz del paquete.
 * Rechaza esquemas, rutas absolutas, '\' y cualquier escape de la raíz.
 */
export function resolvePackageHref(baseDir, href) {
    if (typeof href !== 'string' || !href) fail('EPUB_BAD_HREF', 'href vacío');
    const noFragment = href.split('#')[0];
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(noFragment)) fail('EPUB_REMOTE_RESOURCE', 'recurso con esquema (remoto o externo)');
    if (noFragment.startsWith('/') || noFragment.includes('\\') || noFragment.includes('\0')) fail('EPUB_BAD_HREF', 'href absoluto o inválido');
    let decoded;
    try { decoded = decodeURIComponent(noFragment); } catch { fail('EPUB_BAD_HREF', 'href mal codificado'); }
    const segs = [];
    for (const seg of `${baseDir ? baseDir + '/' : ''}${decoded}`.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { if (!segs.length) fail('EPUB_PATH_ESCAPE', 'href escapa de la raíz del paquete'); segs.pop(); continue; }
        segs.push(seg);
    }
    return validateEntryName(segs.join('/'));
}

const collapse = (s) => s.replace(/[ \t\n\r\f]+/g, ' ').trim();
function finishBlockText(parts) {
    return parts.join('').split('\u0000').map(collapse).filter(Boolean).join('\n');
}

function isSkipped(el) {
    if (SKIP.has(el.name)) return true;
    const a = el.attrs;
    if (Object.hasOwn(a, 'hidden')) return true;
    if (a['aria-hidden'] === 'true') return true;
    const sem = `${a['epub:type'] || ''} ${a.role || ''}`.split(/\s+/);
    return sem.some(t => SKIP_SEMANTICS.has(t));
}

/**
 * XHTML (árbol) → [{ type: 'heading', level, text } | { type: 'paragraph', text }
 * | { type: 'image', src, alt? }]. `resolveImage(img)` devuelve { src, alt? },
 * null para ignorarla, o lanza; sin él las imágenes se ignoran (como en 3A).
 */
export function extractXhtmlBlocks(root, { resolveImage } = {}) {
    const blocks = [];
    let loose = [];
    let deferred = []; // imágenes dentro de texto suelto: van tras ese párrafo
    const flushLoose = () => {
        const text = finishBlockText(loose);
        if (text) blocks.push({ type: 'paragraph', text });
        blocks.push(...deferred);
        loose = [];
        deferred = [];
    };
    const image = (node) => {
        const img = resolveImage ? resolveImage(node) : null;
        return img ? { type: 'image', ...img } : null;
    };
    const collect = (node, parts, images) => {
        if (node.type === 'text') { parts.push(node.value); return; }
        if (isSkipped(node)) return;
        if (node.name === 'br') { parts.push('\u0000'); return; }
        if (node.name === 'img') { const img = image(node); if (img) images.push(img); return; }
        for (const c of node.children) collect(c, parts, images);
    };
    const walk = (node) => {
        if (node.type === 'text') { loose.push(node.value); return; }
        if (isSkipped(node)) return;
        if (node.name === 'br') { loose.push('\u0000'); return; }
        if (node.name === 'img') {
            const img = image(node);
            if (!img) return;
            if (finishBlockText(loose)) deferred.push(img);
            else { flushLoose(); blocks.push(img); }
            return;
        }
        if (HEADINGS.has(node.name) || node.name === 'p') {
            flushLoose();
            const parts = [];
            const images = [];
            collect(node, parts, images);
            const text = finishBlockText(parts);
            if (text) blocks.push(node.name === 'p' ? { type: 'paragraph', text } : { type: 'heading', level: Number(node.name[1]), text });
            blocks.push(...images);
            return;
        }
        const isBlock = BLOCK_CONTAINERS.has(node.name);
        if (isBlock) flushLoose();
        for (const c of node.children) walk(c);
        if (isBlock) flushLoose();
    };
    const body = childElements(root, 'body')[0];
    if (!body) fail('EPUB_NO_BODY', 'documento XHTML sin body');
    walk(body);
    flushLoose();
    return blocks;
}

function metadataValues(metadata) {
    const a11y = {};
    const add = (key, value) => {
        const v = collapse(String(value || ''));
        if (!v) return;
        (a11y[key] ??= []).push(v);
    };
    for (const meta of childElements(metadata, 'meta')) {
        const prop = meta.attrs.property || meta.attrs.name || '';
        const m = prop.match(/^schema:(accessMode|accessModeSufficient|accessibilityFeature|accessibilityHazard|accessibilitySummary|accessibilityAPI|accessibilityControl)$/);
        if (m) add(m[1], meta.attrs.property ? textContent(meta) : meta.attrs.content);
    }
    return a11y;
}

/** Paquete EPUB → documentos del spine ya reducidos a bloques de texto. */
export function parseEpubArchive(epubBuffer, { limits } = {}) {
    const zip = openZip(epubBuffer, limits);

    if (!zip.entries.has('mimetype')) fail('EPUB_NO_MIMETYPE', 'falta mimetype');
    const mimetype = zip.read('mimetype').toString('latin1').trim();
    if (mimetype !== EPUB_MIMETYPE) fail('EPUB_BAD_MIMETYPE', 'mimetype no es application/epub+zip');

    if (!zip.entries.has('META-INF/container.xml')) fail('EPUB_NO_CONTAINER', 'falta META-INF/container.xml');
    const container = readXml(zip, 'META-INF/container.xml', false);
    if (container.name !== 'container') fail('EPUB_BAD_CONTAINER', 'container.xml inválido');
    const rootfiles = childElements(container, 'rootfiles').flatMap(r => childElements(r, 'rootfile'));
    const rootfile = rootfiles.find(r => r.attrs['media-type'] === OPF_MEDIA_TYPE) || rootfiles[0];
    if (!rootfile || !rootfile.attrs['full-path']) fail('EPUB_BAD_CONTAINER', 'container.xml sin rootfile');
    const opfName = resolvePackageHref('', rootfile.attrs['full-path']);
    if (!zip.entries.has(opfName)) fail('EPUB_NO_OPF', 'el OPF declarado no existe');

    const opf = readXml(zip, opfName, false);
    if (opf.name !== 'package') fail('EPUB_BAD_OPF', 'OPF sin elemento package');
    const opfDir = path.posix.dirname(opfName) === '.' ? '' : path.posix.dirname(opfName);
    const metadata = childElements(opf, 'metadata')[0];
    const manifestEl = childElements(opf, 'manifest')[0];
    const spineEl = childElements(opf, 'spine')[0];
    if (!manifestEl || !spineEl) fail('EPUB_BAD_OPF', 'OPF sin manifest o spine');

    const firstText = (name) => {
        const el = metadata && childElements(metadata, name)[0];
        return el ? collapse(textContent(el)) : null;
    };
    const language = firstText('language');
    const title = firstText('title');
    const a11y = metadata ? metadataValues(metadata) : {};
    const core = ['accessMode', 'accessibilityFeature', 'accessibilityHazard', 'accessibilitySummary'];
    const present = core.filter(k => a11y[k]?.length).length;
    const a11yStatus = present === 0 ? 'ABSENT' : present === core.length ? 'PRESENT' : 'PARTIAL';

    const manifest = new Map();
    for (const item of childElements(manifestEl, 'item')) {
        const { id, href } = item.attrs;
        if (!id || !href) fail('EPUB_BAD_OPF', 'item de manifest incompleto');
        if (manifest.has(id)) fail('EPUB_DUPLICATE_ID', 'id duplicado en manifest');
        manifest.set(id, { href, mediaType: item.attrs['media-type'] || '', properties: (item.attrs.properties || '').split(/\s+/) });
    }

    // Imágenes: solo recursos del paquete declarados en el manifest (por entrada ZIP).
    const manifestByEntry = new Map();
    for (const item of manifest.values()) {
        try { manifestByEntry.set(resolvePackageHref(opfDir, item.href), item); } catch { /* items remotos o inválidos: nunca son imagen aceptable */ }
    }
    const images = { accepted: 0, ignored: { noSrc: 0, remote: 0, unsupportedType: {} } };
    const imageResolver = (docDir) => (el) => {
        const href = el.attrs.src;
        if (typeof href !== 'string' || !href.trim()) { images.ignored.noSrc++; return null; }
        let entry;
        try { entry = resolvePackageHref(docDir, href.trim()); } catch (e) {
            if (e.code === 'EPUB_REMOTE_RESOURCE') { images.ignored.remote++; return null; }
            throw e;
        }
        if (!zip.entries.has(entry)) fail('EPUB_IMAGE_MISSING', 'imagen referenciada ausente en el ZIP');
        const item = manifestByEntry.get(entry);
        if (!item) fail('EPUB_IMAGE_UNDECLARED', 'imagen no declarada en el manifest');
        if (!IMAGE_MEDIA_TYPES.has(item.mediaType)) {
            const t = item.mediaType || '(vacío)';
            images.ignored.unsupportedType[t] = (images.ignored.unsupportedType[t] || 0) + 1;
            return null;
        }
        if (!isSafeCanonicalMediaSrc(entry)) fail('EPUB_IMAGE_BAD_SRC', 'ruta de imagen no apta como referencia interna');
        images.accepted++;
        return Object.hasOwn(el.attrs, 'alt') ? { src: entry, alt: el.attrs.alt } : { src: entry };
    };

    const itemrefs = childElements(spineEl, 'itemref');
    if (itemrefs.length === 0) fail('EPUB_EMPTY_SPINE', 'spine vacío');
    const seen = new Set();
    const documents = [];
    for (const ref of itemrefs) {
        const idref = ref.attrs.idref;
        if (!idref || !manifest.has(idref)) fail('EPUB_SPINE_REF_MISSING', 'itemref sin item en manifest');
        if (seen.has(idref)) fail('EPUB_SPINE_DUPLICATE', 'itemref repetido en spine');
        seen.add(idref);
        const item = manifest.get(idref);
        const name = resolvePackageHref(opfDir, item.href);
        if (!zip.entries.has(name)) fail('EPUB_SPINE_RESOURCE_MISSING', 'documento del spine ausente en el ZIP');
        if (ref.attrs.linear === 'no') continue;
        if (item.mediaType !== XHTML_MEDIA_TYPE || item.properties.includes('nav')) continue;
        const root = readXml(zip, name, true);
        if (root.name !== 'html') fail('EPUB_BAD_XHTML', 'documento del spine sin elemento html');
        const docDir = path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name);
        documents.push({ blocks: extractXhtmlBlocks(root, { resolveImage: imageResolver(docDir) }) });
    }
    return { language, title, a11y, a11yStatus, images, documents };
}

/** Bloques por documento → capítulos v1 con IDs ordinales (texto e imágenes por separado). */
function toChapters(documents) {
    const chapters = [];
    let current = null;
    let textOrdinal = 0, imageOrdinal = 0;
    const open = (implicit) => {
        current = implicit ? { id: chapterId(chapters.length + 1), implicit: true, blocks: [] } : { id: chapterId(chapters.length + 1), blocks: [] };
        chapters.push(current);
        textOrdinal = 0; imageOrdinal = 0;
    };
    const pushImage = (b) => {
        const block = { id: blockId('image', chapters.length, ++imageOrdinal), type: 'image', src: b.src };
        if ('alt' in b) block.alt = b.alt;
        current.blocks.push(block);
    };
    for (const doc of documents) {
        current = null; // cada documento del spine abre capítulo
        let leading = []; // imágenes previas al primer texto del documento
        for (const b of doc.blocks) {
            if (b.type === 'image') {
                if (current) pushImage(b); else leading.push(b);
                continue;
            }
            if (b.type === 'heading' || !current) {
                open(b.type !== 'heading');
                leading.forEach(pushImage);
                leading = [];
            }
            const block = { id: blockId(b.type, chapters.length, ++textOrdinal), type: b.type, text: b.text };
            if (b.type === 'heading') block.level = b.level;
            current.blocks.push(block);
        }
        if (leading.length) { open(true); leading.forEach(pushImage); }
    }
    return chapters;
}

export function importEpubToCanonicalBook({ contentId, epubBuffer, contentFingerprint, language, limits } = {}) {
    if (typeof contentId !== 'string' || !contentId) fail('INVALID_CONTENT_ID', 'contentId debe ser un string no vacío');
    const parsed = parseEpubArchive(epubBuffer, { limits });
    const chapters = toChapters(parsed.documents);
    if (!chapters.some(ch => ch.blocks.some(isTextBlock))) fail('EPUB_NO_TEXT', 'el EPUB no contiene texto extraíble en su spine');

    const fingerprint = computeContentFingerprint(renderCanonicalBookToPlainText({ chapters }));
    if (contentFingerprint !== undefined && contentFingerprint !== null) {
        assertValidFingerprint(contentFingerprint);
        if (contentFingerprint !== fingerprint) fail('FINGERPRINT_MISMATCH', 'contentFingerprint no corresponde al texto del EPUB');
    }
    const book = { schemaVersion: CANONICAL_SCHEMA_VERSION, contentId, contentFingerprint: fingerprint };
    const lang = typeof language === 'string' && language ? language : parsed.language;
    if (lang && LANGUAGE_RX.test(lang)) book.language = lang;
    book.chapters = chapters;

    const problems = validateCanonicalBook(book);
    if (problems.length) fail('INVALID_BOOK', `CanonicalBook inválido: ${problems.slice(0, 3).join('; ')}`);
    return book;
}
