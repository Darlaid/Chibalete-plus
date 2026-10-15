/**
 * chibaleteEpubReader.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.2.
 * Integración Chibalete+ ↔ foliate-js (motor falso inyectado; sin DOM ni red)
 * + ratchet estructural de la ruta dev y de los imports del motor.
 *
 *   node components/epub-reader/__tests__/chibaleteEpubReader.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createFoliateAdapter, inspectScriptedContent, findScriptsInDocument, FILTER_CSS_VAR,
} from '../foliateAdapter.mjs';
import {
    buildFilterCss, applyPreset, normalizeFilters, resetFilters, DEFAULT_FILTERS,
    buildTextCss, normalizeText, isReflowableLayout, FILTER_PRESETS,
} from '../readerVisualSettings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── motor falso ──────────────────────────────────────────────────────────────
function fakeEngine({ layout = 'reflowable', manifest = [], texts = {}, openDelay = 0 } = {}) {
    const calls = [];
    const book = {
        metadata: { title: 'Alicia', language: 'es' },
        rendition: { layout },
        sections: Array.from({ length: 14 }, (_, i) => ({ id: `s${i}` })),
        toc: [{ label: ' Cap I ', href: 'c1.xhtml', subitems: [{ label: 'Cap II', href: 'c2.xhtml' }] }],
        resources: { manifest },
        loadText: async (href) => texts[href] ?? null,
    };
    const views = [];
    const engine = {
        calls, book, views,
        makeBook: async (file) => { calls.push(['makeBook', file.name]); return book; },
        createView: () => {
            const listeners = {};
            const style = new Map();
            const attrs = new Map();
            const v = {
                isFixedLayout: layout === 'pre-paginated',
                classList: { add: (c) => calls.push(['class', c]) },
                style: { setProperty: (k, val) => style.set(k, val), removeProperty: (k) => style.delete(k), get: (k) => style.get(k) },
                addEventListener: (n, cb) => { (listeners[n] ??= []).push(cb); },
                emit: (n, detail) => (listeners[n] ?? []).forEach((cb) => cb({ detail })),
                open: async (b) => { calls.push(['open', b === book]); if (openDelay) await new Promise((r) => setTimeout(r, openDelay)); },
                init: async () => calls.push(['init']),
                next: () => calls.push(['next']), prev: () => calls.push(['prev']),
                goTo: (t) => calls.push(['goTo', t]), goToFraction: (f) => calls.push(['goToFraction', f]),
                close: () => calls.push(['close']), remove: () => calls.push(['remove']),
                renderer: { setStyles: (css) => calls.push(['setStyles', css]), setAttribute: (k, val) => attrs.set(k, val), attrs },
            };
            views.push(v);
            return v;
        },
    };
    return engine;
}
const host = () => { const children = []; return { children, append: (el) => children.push(el) }; };
const styleRoot = () => { const els = []; return { els, querySelector: (sel) => els.find((e) => `#${e.id}` === sel) ?? null, append: (e) => els.push(e), ownerDocument: { createElement: () => ({}) } }; };
const file = { name: 'Aventuras_Alicia_Maravillas_EPUB_V4.epub' };

console.log('[A/B] inicialización y open(File)');
{
    const eng = fakeEngine(); const h = host(); const sr = styleRoot();
    const ad = createFoliateAdapter({ host: h, loadEngine: async () => eng, styleRoot: sr });
    ok('A. adapter creado sin tocar el motor hasta open()', eng.calls.length === 0 && ad.isOpen === false);
    const info = await ad.open(file);
    ok('A. open crea <foliate-view> y lo monta en el host', h.children.length === 1 && eng.views.length === 1);
    ok('B. open(File) → makeBook(File) + view.open(book) + init', JSON.stringify(eng.calls.filter((c) => ['makeBook', 'open', 'init'].includes(c[0]))) === JSON.stringify([['makeBook', file.name], ['open', true], ['init']]));
    ok('B. devuelve título, layout, nº de secciones', info.title === 'Alicia' && info.layout === 'reflowable' && info.sectionCount === 14);
    ok('E. TOC expuesto aplanado con profundidad y labels limpios', JSON.stringify(info.toc) === JSON.stringify([{ label: 'Cap I', href: 'c1.xhtml', depth: 0 }, { label: 'Cap II', href: 'c2.xhtml', depth: 1 }]));
    ok('regla ::part(filter) instalada una vez', sr.els.length === 1 && /::part\(filter\)/.test(sr.els[0].textContent));

    console.log('\n[C] navegación delega en el motor');
    ad.next(); ad.prev(); ad.goTo('c2.xhtml'); ad.goToFraction(0.5);
    ok('C. next/prev/goTo/goToFraction', JSON.stringify(eng.calls.slice(-4)) === JSON.stringify([['next'], ['prev'], ['goTo', 'c2.xhtml'], ['goToFraction', 0.5]]));

    console.log('\n[D] relocate');
    let state = null;
    const off = ad.onRelocate((s) => { state = s; });
    eng.views[0].emit('relocate', { fraction: 0.5077, section: { current: 8, total: 14 }, location: { current: 900, next: 901, total: 1800 }, tocItem: { label: ' Capítulo VII ', href: 'c7.xhtml' }, cfi: 'epubcfi(/6/18!/4)' });
    ok('D. relocate → estado normalizado (fraction, sección, toc, cfi, location)', state?.fraction === 0.5077 && state.sectionIndex === 8 && state.sectionCount === 14 && state.tocLabel === 'Capítulo VII' && state.tocHref === 'c7.xhtml' && state.cfi === 'epubcfi(/6/18!/4)' && state.location.total === 1800);
    off(); state = null; eng.views[0].emit('relocate', { fraction: 1 });
    ok('D. onRelocate devuelve un off() efectivo', state === null);

    console.log('\n[F/G] filtros visuales');
    ad.setVisualFilter(buildFilterCss(applyPreset('invertido')));
    ok('F. preset Invertido → invert(1) hue-rotate(180deg) en la variable del part', eng.views[0].style.get(FILTER_CSS_VAR) === 'invert(1) hue-rotate(180deg)');
    ok('F. Brillo/Contraste/Saturación → CSS exacto', buildFilterCss({ brightness: 90, contrast: 150, saturation: 0, preset: 'normal' }) === 'brightness(0.9) contrast(1.5) saturate(0)');
    ok('F. Sepia y Escala de grises', buildFilterCss(applyPreset('sepia')) === 'contrast(0.95) sepia(0.6)' && buildFilterCss(applyPreset('grises')) === 'saturate(0)');
    ok('F. valores fuera de rango se acotan', JSON.stringify(normalizeFilters({ brightness: 999, contrast: -5, saturation: 'x', preset: 'raro' })) === JSON.stringify({ preset: 'normal', brightness: 150, contrast: 50, saturation: 100 }));
    ok('F. 5 presets exactos', Object.values(FILTER_PRESETS).map((p) => p.label).join('|') === 'Normal|Alto contraste|Escala de grises|Invertido|Sepia');
    ad.setVisualFilter(buildFilterCss(resetFilters()));
    ok('G. reset → sin filtro (variable eliminada) y estado por defecto', eng.views[0].style.get(FILTER_CSS_VAR) === undefined && buildFilterCss(resetFilters()) === '' && JSON.stringify(resetFilters()) === JSON.stringify(DEFAULT_FILTERS));

    console.log('\n[texto reflowable]');
    ok('setTextSettings en reflowable → setStyles + max-inline-size', ad.setTextSettings(buildTextCss({ fontScale: 140, lineHeight: 160 }), 800) === true && eng.views[0].renderer.attrs.get('max-inline-size') === '800px' && /font-size: 140%/.test(eng.calls.findLast((c) => c[0] === 'setStyles')[1]));
    ok('ajustes de texto por defecto → CSS vacío (no toca el libro)', buildTextCss(normalizeText({})) === '');

    ad.close();
    ok('close() destruye la vista', eng.calls.slice(-2).map((c) => c[0]).join() === 'close,remove' && ad.isOpen === false);
}

console.log('\n[H] fixed-layout no recibe ajustes reflowable');
{
    const eng = fakeEngine({ layout: 'pre-paginated' });
    const ad = createFoliateAdapter({ host: host(), loadEngine: async () => eng, styleRoot: styleRoot() });
    const info = await ad.open(file);
    ok('H. layout pre-paginated detectado', info.layout === 'pre-paginated' && !isReflowableLayout(info.layout) && isReflowableLayout('reflowable'));
    ok('H. setTextSettings → no-op (ni setStyles ni max-inline-size)', ad.setTextSettings('html{font-size:200%}', 900) === false && !eng.calls.some((c) => c[0] === 'setStyles') && !eng.views[0].renderer.attrs.size);
    ad.setVisualFilter('saturate(0)');
    ok('H. los filtros visuales sí aplican a fixed-layout', eng.views[0].style.get(FILTER_CSS_VAR) === 'saturate(0)');
}

console.log('\n[seguridad] EPUB con scripts → no se abre');
{
    const fakeDoc = (els) => ({ querySelector: (s) => (s === 'script' ? els.find((e) => e.tag === 'script') ?? null : null), querySelectorAll: () => els.map((e) => ({ attributes: e.attrs ?? [] })) });
    ok('manifest JavaScript → motivo', (await inspectScriptedContent({ resources: { manifest: [{ href: 'a.js', mediaType: 'text/javascript' }] } })).length === 1);
    ok('manifest properties scripted → motivo', (await inspectScriptedContent({ resources: { manifest: [{ href: 'c.xhtml', mediaType: 'image/png', properties: ['scripted'] }] } })).length === 1);
    ok('findScriptsInDocument: <script>, on*=, javascript:', findScriptsInDocument(fakeDoc([{ tag: 'script' }, { attrs: [{ name: 'onload', value: 'x()' }] }, { attrs: [{ name: 'href', value: ' javascript:alert(1)' }] }])).join('|') === 'script|atributo onload|javascript: URL');
    ok('documento limpio → sin motivos', findScriptsInDocument(fakeDoc([{ attrs: [{ name: 'href', value: 'c2.xhtml' }, { name: 'class', value: 'one' }] }])).length === 0);
    const eng = fakeEngine({ manifest: [{ href: 'c1.xhtml', mediaType: 'application/xhtml+xml' }], texts: { 'c1.xhtml': '<html/>' } });
    const ad = createFoliateAdapter({ host: host(), loadEngine: async () => eng, styleRoot: styleRoot(), parse: () => fakeDoc([{ tag: 'script' }]) });
    let err = null; try { await ad.open(file); } catch (e) { err = e; }
    ok('open() rechaza con EPUB_SCRIPTED_CONTENT y NO crea vista', err?.code === 'EPUB_SCRIPTED_CONTENT' && eng.views.length === 0 && /c1\.xhtml: script/.test(err.reasons.join()));
}

console.log('\n[StrictMode] open cancelado por close() no deja vistas huérfanas');
{
    const eng = fakeEngine({ openDelay: 30 }); const h = host();
    const ad = createFoliateAdapter({ host: h, loadEngine: async () => eng, styleRoot: styleRoot() });
    const p = ad.open(file).catch((e) => e);
    await new Promise((r) => setTimeout(r, 5));
    ad.close();
    const res = await p;
    ok('el open en curso termina como EPUB_OPEN_CANCELLED', res?.code === 'EPUB_OPEN_CANCELLED');
    ok('la vista creada se cierra y retira', eng.calls.filter((c) => c[0] === 'remove').length >= 1 && ad.isOpen === false);
    let fired = false; ad.onRelocate(() => { fired = true; }); eng.views[0].emit('relocate', { fraction: 0.1 });
    ok('relocate de la vista cancelada se ignora', fired === false);
}

console.log('\n[I] ruta dev y aislamiento del motor (estructural)');
{
    const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
    ok('I. ruta registrada SOLO bajo import.meta.env.DEV', /const DevEpubReader = import\.meta\.env\.DEV \? React\.lazy\(\(\) => import\('\.\/pages\/DevEpubReader'\)\) : null;/.test(app) && /\{DevEpubReader && <Route path="\/dev\/epub-reader" element=\{<DevEpubReader \/>\} \/>\}/.test(app));
    const nav = ['components/Navbar.tsx', 'components/Layout.tsx', 'pages/Biblioteca.tsx', 'config/routePermissions.ts'].filter((f) => fs.existsSync(path.join(ROOT, f)));
    ok(`I. no aparece en navegación normal (${nav.length} archivos)`, nav.length >= 3 && nav.every((f) => !/dev\/epub-reader|DevEpubReader/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
    const dir = path.join(ROOT, 'components', 'epub-reader');
    const sources = fs.readdirSync(dir).filter((f) => /\.(tsx?|mjs)$/.test(f)).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    sources.push(['DevEpubReader.tsx', fs.readFileSync(path.join(ROOT, 'pages', 'DevEpubReader.tsx'), 'utf8')]);
    const foliateImporters = sources.filter(([, s]) => /vendor\/foliate-js/.test(s.replace(/^\s*(\/\/|\*).*$/gm, ''))).map(([f]) => f);
    ok('solo el adapter importa el motor', foliateImporters.join() === 'foliateAdapter.mjs', foliateImporters.join());
    const adapter = sources.find(([f]) => f === 'foliateAdapter.mjs')[1];
    ok('el adapter importa únicamente view.js (motor)', (adapter.match(/import\('\.\.\/\.\.\/vendor\/foliate-js\/[^']+'\)/g) ?? []).join() === "import('../../vendor/foliate-js/view.js')");
    ok('nunca reader.js / reader.html / ui/ upstream', sources.every(([, s]) => !/foliate-js\/(reader\.(js|html)|ui\/)/.test(s)));
}

console.log(`\nchibaleteEpubReader — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
