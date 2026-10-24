/**
 * foliateAdapter.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.2.
 *
 * ÚNICO punto de contacto entre la UI de Chibalete+ y el motor foliate-js
 * (vendor/foliate-js, snapshot exacto, sin modificar). La UI no conoce
 * <foliate-view>, renderer, part ni eventos internos: solo este contrato:
 *
 *   open(file) → { title, layout, toc, sectionCount }
 *   next() / prev() / goTo(href|index) / goToFraction(f)
 *   onRelocate(cb) → { fraction, sectionIndex, sectionCount, tocLabel, tocHref, cfi, location }
 *   setVisualFilter(css) / setTextSettings(css, maxInlineSize)  (este último solo reflowable)
 *   auditImages() / close()
 *
 * Seguridad: foliate NO soporta EPUB con scripts (blob: del mismo origen +
 * sandbox con allow-scripts por un bug de WebKit). Antes de renderizar, el
 * adapter inspecciona el libro y RECHAZA cualquier EPUB con scripts
 * (manifest `scripted`/JavaScript, <script>, on*=, javascript:). No transforma
 * contenido: si hay scripts, no se abre.
 *
 * Testeable en Node: el motor, el contenedor y el parser se inyectan.
 */

import { attachExtractionFriction } from '../../utils/contentProtection.mjs';

export class EpubScriptedContentError extends Error {
    constructor(reasons) {
        super('Este EPUB contiene scripts y no se puede abrir por seguridad.');
        this.code = 'EPUB_SCRIPTED_CONTENT';
        this.reasons = reasons;
    }
}

const JS_MEDIA_TYPE = /\/(x-)?(javascript|ecmascript)$/i;
const MARKUP_MEDIA_TYPE = /(x?html|xml|svg)/i;
export const FILTER_CSS_VAR = '--chp-epub-filter';
const FILTER_STYLE_ID = 'chp-epub-filter-part';

/**
 * 3F.1-R — búsqueda de entradas ZIP tolerante a hrefs percent-encoded.
 *
 * foliate (epub.js `resolveURL`) normaliza los href del manifest con
 * `decodeURI`, que NO decodifica caracteres reservados (`%2C` → `,`, `%3B`…).
 * Un EPUB válido con `href="Me_desconecto%2C_Luego.xhtml"` y la entrada ZIP
 * `Me_desconecto,_Luego.xhtml` no se encuentra: la sección carga `null` y el
 * paginador falla (`#display` → `this.#view.document` de undefined). Primero el
 * nombre exacto (comportamiento de foliate); solo si no existe, el nombre
 * decodificado. Sin tocar vendor/.
 */
export function createZipEntryResolver(entries) {
    const map = new Map((entries ?? []).map((e) => [e.filename, e]));
    return (name) => {
        if (typeof name !== 'string') return null;
        if (map.has(name)) return map.get(name);
        let decoded;
        try { decoded = decodeURIComponent(name); } catch { return null; }
        return decoded !== name && map.has(decoded) ? map.get(decoded) : null;
    };
}

/**
 * EPUB con el MISMO loader que foliate `makeZipLoader` (zip.js sin workers,
 * loadText/loadBlob/getSize) y el mismo `new EPUB(loader).init()`; solo cambia
 * la búsqueda de entradas (createZipEntryResolver). Lo que no sea ZIP sigue
 * por `makeBook` de foliate.
 */
async function makeEpubBook(file, fallbackMakeBook) {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return fallbackMakeBook(file);
    const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import('../../vendor/foliate-js/vendor/zip.js');
    configure({ useWebWorkers: false });
    const entries = await new ZipReader(new BlobReader(file)).getEntries();
    const entryOf = createZipEntryResolver(entries);
    const load = (f) => (name, ...args) => { const entry = entryOf(name); return entry ? f(entry, ...args) : null; };
    const loader = {
        entries,
        loadText: load((entry) => entry.getData(new TextWriter())),
        loadBlob: load((entry, type) => entry.getData(new BlobWriter(type))),
        getSize: (name) => entryOf(name)?.uncompressedSize ?? 0,
    };
    const { EPUB } = await import('../../vendor/foliate-js/epub.js');
    return new EPUB(loader).init();
}

/** Motor real: módulos de engine únicamente (nunca reader.js / reader.html / ui/). */
export const loadFoliateEngine = async () => {
    const mod = await import('../../vendor/foliate-js/view.js');
    return {
        makeBook: (file) => makeEpubBook(file, mod.makeBook),
        createView: () => document.createElement('foliate-view'),
    };
};

const defaultParse = (text, type) => new DOMParser().parseFromString(text, type);

/** Motivos por los que un documento del libro contiene scripts. */
export function findScriptsInDocument(doc) {
    const reasons = [];
    if (!doc) return reasons;
    if (doc.querySelector('script')) reasons.push('script');
    for (const el of doc.querySelectorAll('*')) {
        for (const attr of el.attributes ?? []) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) reasons.push(`atributo ${name}`);
            else if (/^(href|src|xlink:href|action|formaction)$/.test(name) && /^\s*javascript:/i.test(attr.value)) reasons.push('javascript: URL');
        }
        if (reasons.length > 5) break;
    }
    return reasons;
}

/** Inspección previa al render. Devuelve la lista de motivos (vacía = seguro). */
export async function inspectScriptedContent(book, parse = defaultParse) {
    const reasons = [];
    const manifest = book?.resources?.manifest ?? [];
    for (const item of manifest) {
        if (JS_MEDIA_TYPE.test(item.mediaType ?? '')) reasons.push(`manifest: ${item.href} (${item.mediaType})`);
        if ((item.properties ?? []).includes?.('scripted')) reasons.push(`manifest: ${item.href} (scripted)`);
    }
    if (typeof book?.loadText === 'function') {
        for (const item of manifest) {
            if (!MARKUP_MEDIA_TYPE.test(item.mediaType ?? '')) continue;
            const text = await book.loadText(item.href);
            if (!text) continue;
            const type = /svg/i.test(item.mediaType) ? 'image/svg+xml' : 'application/xhtml+xml';
            for (const r of findScriptsInDocument(parse(text, type))) reasons.push(`${item.href}: ${r}`);
        }
    }
    return reasons;
}

const flattenToc = (items, depth = 0, out = []) => {
    for (const item of items ?? []) {
        out.push({ label: String(item.label ?? '').trim(), href: item.href, depth });
        if (item.subitems?.length) flattenToc(item.subitems, depth + 1, out);
    }
    return out;
};

/**
 * @param {{ host: { append: Function, ownerDocument?: Document },
 *           loadEngine?: () => Promise<{ makeBook: Function, createView: Function }>,
 *           parse?: Function, styleRoot?: { querySelector?: Function, append?: Function, ownerDocument?: Document } }} opts
 */
export function createFoliateAdapter({ host, loadEngine = loadFoliateEngine, parse = defaultParse, styleRoot } = {}) {
    let view = null;
    let layout = null;
    // Cada open/close abre una "generación": un open que termina después de un
    // close (p. ej. React StrictMode monta-desmonta-monta) no deja vistas huérfanas.
    let generation = 0;
    const relocateListeners = new Set();
    // F3-A3: interacción de confianza dentro de las páginas (iframes), que no
    // llega al documento del lector. Solo se notifica; no cambia nada más.
    const activityListeners = new Set();
    const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'click', 'focusin'];
    // 3E.6: motivo del último relocate según el renderer de foliate ('page',
    // 'snap', 'scroll', 'navigation' = lector; 'anchor' = re-maquetación
    // automática, p. ej. al cargar imágenes). El renderer lo emite en el mismo
    // dispatch, justo DESPUÉS del relocate de la vista.
    let lastRelocateReason = null;

    const ensureFilterStyle = () => {
        const root = styleRoot ?? globalThis.document?.head;
        if (!root || root.querySelector?.(`#${FILTER_STYLE_ID}`)) return;
        const doc = root.ownerDocument ?? globalThis.document;
        const style = doc.createElement('style');
        style.id = FILTER_STYLE_ID;
        style.textContent = `foliate-view.chp-epub-view::part(filter) { filter: var(${FILTER_CSS_VAR}, none); }`;
        root.append(style);
    };

    const normalizeRelocate = (detail = {}) => ({
        fraction: typeof detail.fraction === 'number' ? detail.fraction : null,
        sectionIndex: detail.section?.current ?? null,
        sectionCount: detail.section?.total ?? view?.book?.sections?.length ?? null,
        tocLabel: detail.tocItem?.label ? String(detail.tocItem.label).trim() : null,
        tocHref: detail.tocItem?.href ?? null,
        cfi: detail.cfi ?? null,
        location: detail.location ? { current: detail.location.current, next: detail.location.next, total: detail.location.total } : null,
    });

    return {
        async open(file) {
            if (view) this.close();
            const gen = ++generation;
            const stale = () => gen !== generation;
            const engine = await loadEngine();
            const book = await engine.makeBook(file);
            const reasons = await inspectScriptedContent(book, parse);
            if (reasons.length) throw new EpubScriptedContentError(reasons);
            if (stale()) throw Object.assign(new Error('apertura cancelada'), { code: 'EPUB_OPEN_CANCELLED' });

            const created = engine.createView();
            view = created;
            created.classList?.add('chp-epub-view');
            created.addEventListener('relocate', (e) => {
                if (stale()) return;
                const state = normalizeRelocate(e.detail);
                for (const cb of relocateListeners) cb(state);
            });
            // Las flechas dentro de la página del libro (iframe) también pasan página.
            created.addEventListener('load', (e) => {
                // CP-4A: el texto vive en iframes; la fricción de copia se engancha a cada documento.
                attachExtractionFriction(e.detail?.doc);
                for (const name of ACTIVITY_EVENTS) {
                    e.detail?.doc?.addEventListener?.(name, (ev) => {
                        if (ev.isTrusted && !stale()) for (const cb of activityListeners) cb();
                    }, { capture: true, passive: true });
                }
                e.detail?.doc?.addEventListener?.('keydown', (ev) => {
                    if (ev.key === 'ArrowRight') { ev.preventDefault(); created.goRight?.(); }
                    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); created.goLeft?.(); }
                });
            });
            ensureFilterStyle();
            host.append(created);
            await created.open(book);
            created.renderer?.addEventListener?.('relocate', (e) => { if (!stale()) lastRelocateReason = e.detail?.reason ?? null; });
            if (stale()) { created.close?.(); created.remove?.(); throw Object.assign(new Error('apertura cancelada'), { code: 'EPUB_OPEN_CANCELLED' }); }
            layout = created.isFixedLayout ? 'pre-paginated' : (book.rendition?.layout ?? 'reflowable');
            await created.init?.({ showTextStart: false });
            return {
                title: book.metadata?.title ?? null,
                language: book.metadata?.language ?? null,
                layout,
                toc: flattenToc(book.toc),
                sectionCount: book.sections?.length ?? 0,
            };
        },
        next() { return view?.next(); },
        prev() { return view?.prev(); },
        goTo(target) { return view?.goTo(target); },
        goToFraction(f) { return view?.goToFraction(f); },
        onRelocate(cb) { relocateListeners.add(cb); return () => relocateListeners.delete(cb); },
        onActivity(cb) { activityListeners.add(cb); return () => activityListeners.delete(cb); },
        get layout() { return layout; },
        get lastRelocateReason() { return lastRelocateReason; },
        get isOpen() { return !!view; },
        setVisualFilter(css) {
            if (!view) return;
            if (css) view.style.setProperty(FILTER_CSS_VAR, css);
            else view.style.removeProperty(FILTER_CSS_VAR);
        },
        /** Solo reflowable: CSS de texto + ancho de columna. En fixed-layout no hace nada. */
        setTextSettings(css, maxInlineSize) {
            if (!view || layout === 'pre-paginated' || !view.renderer) return false;
            view.renderer.setStyles?.(css ?? '');
            if (maxInlineSize) view.renderer.setAttribute('max-inline-size', `${maxInlineSize}px`);
            return true;
        },
        /**
         * Diagnóstico (dev): recorre todas las secciones con la navegación del
         * motor y cuenta imágenes cargadas. Vuelve a la posición previa.
         */
        async auditImages() {
            if (!view) return null;
            const back = view.lastLocation?.cfi ?? null;
            const sections = [];
            for (let index = 0; index < view.book.sections.length; index++) {
                await view.renderer.goTo({ index });
                const doc = view.renderer.getContents().find((c) => c.index === index)?.doc;
                const imgs = doc ? [...doc.images] : [];
                const svgImgs = doc ? [...doc.querySelectorAll('image')] : [];
                const results = await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {})).then(() => img.naturalWidth > 0)));
                const textLength = doc?.body?.textContent?.trim().length ?? 0;
                sections.push({ index, images: imgs.length + svgImgs.length, loaded: results.filter(Boolean).length + svgImgs.length, textLength });
            }
            if (back) await view.goTo(back);
            const total = sections.reduce((s, x) => s + x.images, 0);
            const loaded = sections.reduce((s, x) => s + x.loaded, 0);
            return { sections, total, loaded, emptySections: sections.filter((s) => !s.images && !s.textLength).map((s) => s.index) };
        },
        close() {
            generation++;
            view?.close?.();
            view?.remove?.();
            view = null;
            layout = null;
            lastRelocateReason = null;
        },
    };
}
