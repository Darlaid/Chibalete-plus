/**
 * ContentExtractionDeterrence.test.mjs
 * CHP-CONTENT-PROTECTION-2026-01 CP-4A.
 *
 * Unitario del helper `utils/contentProtection.mjs` (fricción de copia /
 * menú / arrastre, marca de agua, CSS de impresión) + ratchet estructural de
 * dónde se monta `ProtectedContentSurface` y de los atributos de media. El
 * comportamiento real (impresión, captura, árbol de accesibilidad) se
 * verificó en navegador.
 *
 * Sin red. 0 lecturas y 0 escrituras de stores reales.
 *
 *   node pages/__tests__/ContentExtractionDeterrence.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EDITABLE_SELECTOR,
    PROTECTED_CLIPBOARD_TEXT,
    PROTECTED_PRINT_CSS,
    attachExtractionFriction,
    interceptExtraction,
    shouldIntercept,
    surfacePolicy,
    viewerMarker,
    watermarkLabel,
    watermarkOffset,
    watermarkTileDataUri,
} from '../../utils/contentProtection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

// Elemento mínimo: `closest` responde según si el nodo está dentro de un control.
const el = (editable) => ({ nodeType: 1, closest: (sel) => (sel === EDITABLE_SELECTOR && editable ? {} : null) });
const textNode = (parent) => ({ nodeType: 3, parentElement: parent });
const fakeEvent = (type, target) => {
    const data = {};
    return {
        type, target, prevented: false, data,
        preventDefault() { this.prevented = true; },
        clipboardData: type === 'copy' || type === 'cut' ? { setData: (k, v) => { data[k] = v; } } : undefined,
    };
};

section('[1] Política por superficie');
for (const t of ['copy', 'cut', 'contextmenu', 'dragstart']) {
    ok(`standard intercepta ${t} sobre texto editorial`, shouldIntercept(t, el(false), 'standard') === true);
    ok(`standard NO intercepta ${t} en input/textarea/control`, shouldIntercept(t, el(true), 'standard') === false);
    ok(`accessible NO intercepta ${t} (ALLOWED_FOR_ACCESSIBILITY)`, shouldIntercept(t, el(false), 'accessible') === false);
}
ok('nodo de texto se resuelve a su elemento padre', shouldIntercept('copy', textNode(el(false))) === true);
ok('evento sin Element (window/document) → no se toca', shouldIntercept('copy', null) === false);
ok('otros eventos (keydown, paste, select) nunca', ['keydown', 'paste', 'select', 'selectstart'].every((t) => !shouldIntercept(t, el(false))));
ok('modo desconocido cae a standard', surfacePolicy('xx') === surfacePolicy('standard'));
ok('selector editable incluye input, textarea, select, contenteditable y opt-out explícito',
    ['input', 'textarea', 'select', 'contenteditable', 'data-chp-allow-copy'].every((k) => EDITABLE_SELECTOR.includes(k)));

section('[2] interceptExtraction');
{
    const e = fakeEvent('copy', el(false));
    ok('copy editorial → preventDefault', interceptExtraction(e) === true && e.prevented);
    ok('portapapeles recibe solo el aviso', e.data['text/plain'] === PROTECTED_CLIPBOARD_TEXT);
    const c = fakeEvent('cut', el(false));
    ok('cut editorial → preventDefault', interceptExtraction(c) && c.prevented);
    const i = fakeEvent('copy', el(true));
    ok('copy en input → intacto', interceptExtraction(i) === false && !i.prevented && !('text/plain' in i.data));
    const a = fakeEvent('copy', el(false));
    ok('copy en Accesible → intacto', interceptExtraction(a, 'accessible') === false && !a.prevented);
    const m = fakeEvent('contextmenu', el(false));
    ok('contextmenu editorial → preventDefault', interceptExtraction(m) && m.prevented);
}

section('[3] attachExtractionFriction (iframes de Foliate)');
{
    const listeners = new Map();
    const doc = {
        addEventListener: (t, h) => listeners.set(t, h),
        removeEventListener: (t, h) => { if (listeners.get(t) === h) listeners.delete(t); },
    };
    const detach = attachExtractionFriction(doc);
    ok('engancha copy/cut/contextmenu/dragstart', ['copy', 'cut', 'contextmenu', 'dragstart'].every((t) => listeners.has(t)));
    ok('no engancha teclado (sin keyboard hijacking)', !listeners.has('keydown') && !listeners.has('keyup'));
    const e = fakeEvent('copy', el(false));
    listeners.get('copy')(e);
    ok('el manejador intercepta', e.prevented);
    detach();
    ok('detach retira todo', listeners.size === 0);
    ok('doc ausente → no-op', typeof attachExtractionFriction(null) === 'function');
}

section('[4] Marca de agua: contenido y privacidad');
{
    const id = 'user-1712345678901-maria.perez@colegio.cl';
    const mk = viewerMarker(id);
    ok('marcador = 6 hex mayúsculas', /^[0-9A-F]{6}$/.test(mk), mk);
    ok('marcador determinista (correlacionable recalculando sobre users_db)', viewerMarker(id) === mk);
    ok('marcadores distintos para ids distintos', viewerMarker('u-a') !== viewerMarker('u-b'));
    ok('sin id → neutro', viewerMarker(null) === '------');
    const now = new Date(2026, 9, 18, 14, 37);
    const label = watermarkLabel({ userId: id, institution: 'Colegio San Martín de Porres', now });
    ok('formato «Chibalete+ · institución · marcador · dd/mm/aa»', label === `Chibalete+ · Colegio San Martín de Porres · ${mk} · 18/10/26`, label);
    ok('no contiene el id, correo ni hora exacta', !label.includes('user-') && !label.includes('@') && !label.includes('14:37'));
    const long = watermarkLabel({ userId: 'x', institution: 'Institución Educativa Particular Bilingüe del Valle Sur', now });
    ok('institución larga abreviada (≤28)', long.split(' · ')[1].length <= 28, long);
    ok('sin institución → se omite', watermarkLabel({ userId: 'x', now }).split(' · ').length === 3);
    const tile = watermarkTileDataUri('Chibalete+ · <b>&"x"');
    const svg = decodeURIComponent(tile.slice(tile.indexOf(',') + 1, -2));
    ok('baldosa = data URI SVG', tile.startsWith('url("data:image/svg+xml'));
    ok('texto escapado (sin inyección de marcado)', svg.includes('&lt;b&gt;&amp;&quot;x&quot;') && !svg.includes('<b>'));
    ok('baldosa sin scripts ni recursos externos', !/script|href|xlink/i.test(svg));
    ok('opacidad discreta', /fill-opacity="0\.(1|2)\d*"/.test(svg));
    ok('offset determinista con rand inyectado', watermarkOffset(() => 0.5) === '190px 110px');
}

section('[5] CSS de impresión');
ok('solo en @media print', PROTECTED_PRINT_CSS.trim().startsWith('@media print'));
ok('oculta toda la página cuando hay superficie protegida', /html\[data-chp-protected\] body > \* \{ display: none !important; \}/.test(PROTECTED_PRINT_CSS));
ok('muestra aviso «Contenido protegido en Chibalete+»', PROTECTED_PRINT_CSS.includes('content: "Contenido protegido en Chibalete+"'));
ok('muestra marcador vía attr(data-chp-mark)', PROTECTED_PRINT_CSS.includes('attr(data-chp-mark)'));
ok('sin regla global (sin el atributo, la impresión no cambia)', !/(^|\n)\s*body\s*>/.test(PROTECTED_PRINT_CSS));

section('[6] Componente ProtectedContentSurface');
const surface = read('components/ProtectedContentSurface.tsx');
// Sin comentarios: la documentación del componente nombra /access a propósito.
const surfaceCode = surface.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('display: contents (no cambia layout)', surface.includes("display: 'contents'"));
ok('copy / cut / contextmenu / dragstart locales (no globales)',
    ['onCopy', 'onCut', 'onContextMenu', 'onDragStart'].every((h) => surface.includes(`${h}={onExtraction}`))
    && !/(document|window)\.addEventListener\(\s*'(copy|cut|contextmenu|dragstart|keydown)'/.test(surface));
ok('marca: aria-hidden + pointer-events none + fija', surface.includes('aria-hidden="true"') && surface.includes("pointerEvents: 'none'") && surface.includes("position: 'fixed'"));
ok('marca sin texto en el DOM (fondo SVG)', surface.includes('backgroundImage: tile') && !/>\s*\{label\}\s*</.test(surface));
ok('sin timers, animación ni observers', !/setInterval|setTimeout|requestAnimationFrame|MutationObserver|ResizeObserver|animation/.test(surface));
ok('no decide acceso, no carga contenido, no toca progreso',
    !/useAccessCheck|dataService|fetch\(|progress|\/access/.test(surfaceCode));
ok('activa la impresión protegida con contador de montajes', surface.includes("setAttribute('data-chp-protected'") && surface.includes('mounted === 0'));

section('[7] Dónde se monta');
const app = read('App.tsx');
const accessWrapper = app.slice(app.indexOf('const AccessWrapper'), app.indexOf('// Wrappers específicos'));
ok('AccessWrapper envuelve el visor autorizado (PDF, Guiado, Álbum, Galería, Accesible)',
    /<ProtectedContentSurface mode=\{surfaceMode\}[\s\S]*\{children\(content\)\}[\s\S]*<\/ProtectedContentSurface>/.test(accessWrapper));
ok('la superficie va DESPUÉS del veredicto (denied/error retornan antes)',
    accessWrapper.indexOf("access.status === 'error'") < accessWrapper.indexOf('<ProtectedContentSurface'));
ok('Accesible usa surfaceMode="accessible"', /<AccessWrapper surfaceMode="accessible">\{\(content\) => <VisorAccesible/.test(app));
ok('PDF/Guiado/Álbum/Galería con modo standard (default)',
    ['VisorPDF', 'VisorTexto', 'VisorAlbum', 'GaleriaIlustraciones'].every((v) => new RegExp(`<AccessWrapper>\\{\\(content\\) => <${v}`).test(app)));
ok('Inmersivo envuelto', /<ProtectedContentSurface[^>]*>\s*<VisorInmersivo content/.test(app));
const router = read('components/ContentRouter.tsx');
ok('Podcast envuelto sin marca visual', /<ProtectedContentSurface watermark=\{false\}[^>]*>\s*<VisorAudio/.test(router));
ok('Vídeo envuelto con marca', /<ProtectedContentSurface viewer=[^>]*>\s*<VisorVideo/.test(router));
ok('Detalle (metadata) NO envuelto', !/<ProtectedContentSurface[^>]*>\s*<PaginaDetalleLibro/.test(router));
const epubApp = read('components/epub-reader/EpubReaderApp.tsx');
ok('EPUB original envuelto', /<ProtectedContentSurface viewer=\{viewer\}>\s*<ChibaleteEpubReader/.test(epubApp));
ok('EPUB: marca con colegio de /api/auth/me', epubApp.includes('institution: meJson?.colegio'));
const foliate = read('components/epub-reader/foliateAdapter.mjs');
ok('EPUB: fricción en cada iframe de Foliate', foliate.includes('attachExtractionFriction(e.detail?.doc)'));
ok('Layout (páginas administrativas) NO monta superficie', !read('components/Layout.tsx').includes('ProtectedContentSurface'));

section('[8] Media');
const video = read('pages/VisorVideo.tsx');
const videoTag = video.slice(video.indexOf('<video'), video.indexOf('</video>'));
ok('vídeo local: controlsList="nodownload"', videoTag.includes('controlsList="nodownload"'));
ok('vídeo local: disablePictureInPicture', videoTag.includes('disablePictureInPicture'));
ok('vídeo local conserva controls', /\bcontrols\b/.test(videoTag));
ok('YouTube embed sin tocar', video.includes('picture-in-picture"') && video.includes('allowFullScreen'));
const audio = read('pages/VisorAudio.tsx');
ok('podcast: controlsList="nodownload"', /<audio[^>]*controlsList="nodownload"/.test(audio));
ok('podcast: sin botón de descarga', !/descarga|Download/.test(audio));
ok('podcast: control de velocidad conservado (sin noplaybackrate)', audio.includes('changeSpeed') && !audio.includes('noplaybackrate'));
const mook = read('pages/Experiencias.tsx');
const mookAudio = mook.slice(mook.indexOf('<audio'), mook.indexOf('/>', mook.indexOf('<audio')));
ok('MOOK: audio nodownload + contextmenu', mookAudio.includes('controlsList="nodownload"') && mookAudio.includes('onContextMenu'));
ok('MOOK: controles nativos conservados', /\bcontrols\b/.test(mookAudio));
ok('ningún noplaybackrate en el repo de visores',
    ![video, audio, mook].some((s) => s.includes('noplaybackrate')));
const gallery = read('components/GaleriaIlustraciones.tsx');
ok('Galería: imágenes no arrastrables', (gallery.match(/draggable=\{false\}/g) || []).length === 2);

console.log(`\nContentExtractionDeterrence — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
