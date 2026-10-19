/**
 * ContentExtractionDeterrence.test.mjs
 * CHP-CONTENT-PROTECTION-2026-01 CP-4A.
 *
 * Unitario del helper `utils/contentProtection.mjs` (fricción de copia /
 * menú / arrastre, CSS de impresión) + ratchet estructural de dónde se monta
 * `ProtectedContentSurface`, de los atributos de media y de la ausencia de
 * marca de agua (WATERMARK_POLICY: PROHIBITED). El comportamiento real
 * (impresión, árbol de accesibilidad) se verificó en navegador.
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

section('[4] Sin marca de agua (WATERMARK_POLICY: PROHIBITED)');
const helper = read('utils/contentProtection.mjs');
const helperCode = helper.replace(/\/\*[\s\S]*?\*\//g, '');
ok('helper sin generadores de marca (label, marcador, baldosa)', !/watermark|viewerMarker|data-chp-mark|svg\+xml/i.test(helperCode));
ok('impresión sin marcador', !PROTECTED_PRINT_CSS.includes('attr(') && !PROTECTED_PRINT_CSS.includes('data-chp-mark'));

section('[5] CSS de impresión');
ok('solo en @media print', PROTECTED_PRINT_CSS.trim().startsWith('@media print'));
ok('oculta toda la página cuando hay superficie protegida', /html\[data-chp-protected\] body > \* \{ display: none !important; \}/.test(PROTECTED_PRINT_CSS));
ok('muestra aviso «Contenido protegido en Chibalete+»', PROTECTED_PRINT_CSS.includes('content: "Contenido protegido en Chibalete+"'));
ok('solo el aviso (sin ::after con identificador)', !PROTECTED_PRINT_CSS.includes('::after'));
ok('sin regla global (sin el atributo, la impresión no cambia)', !/(^|\n)\s*body\s*>/.test(PROTECTED_PRINT_CSS));

section('[6] Componente ProtectedContentSurface');
const surface = read('components/ProtectedContentSurface.tsx');
// Sin comentarios: la documentación del componente nombra /access a propósito.
const surfaceCode = surface.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('display: contents (no cambia layout)', surface.includes("display: 'contents'"));
ok('copy / cut / contextmenu / dragstart locales (no globales)',
    ['onCopy', 'onCut', 'onContextMenu', 'onDragStart'].every((h) => surface.includes(`${h}={onExtraction}`))
    && !/(document|window)\.addEventListener\(\s*'(copy|cut|contextmenu|dragstart|keydown)'/.test(surface));
ok('sin overlay ni marca de agua', !/chp-watermark|backgroundImage|position: 'fixed'|aria-hidden|data-chp-mark|watermark=|viewer/.test(surfaceCode));
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
ok('Inmersivo envuelto', /<ProtectedContentSurface>\s*<VisorInmersivo content/.test(app));
const router = read('components/ContentRouter.tsx');
ok('Podcast envuelto', /<ProtectedContentSurface>\s*<VisorAudio/.test(router));
ok('Vídeo envuelto', /<ProtectedContentSurface>\s*<VisorVideo/.test(router));
ok('Detalle (metadata) NO envuelto', !/<ProtectedContentSurface[^>]*>\s*<PaginaDetalleLibro/.test(router));
const epubApp = read('components/epub-reader/EpubReaderApp.tsx');
ok('EPUB original envuelto', /<ProtectedContentSurface>\s*<ChibaleteEpubReader/.test(epubApp));
ok('ningún punto de montaje pasa datos de la persona', ![app, router, epubApp].some((f) => /<ProtectedContentSurface[^>]*(viewer|watermark)=/.test(f)));
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

section('[9] CP-4A1: 0 marca de agua por superficie (WATERMARK_POLICY: PROHIBITED)');
// La superficie es visualmente neutra: un único <div display:contents> con los hijos.
const surfaceJsx = surfaceCode.slice(surfaceCode.indexOf('return ('));
ok('superficie: un único elemento propio', (surfaceJsx.match(/<[a-z]+[\s>]/g) || []).length === 1 && surfaceJsx.includes('{children}'));
ok('superficie: sin svg, img, span, style ni texto visible propio', !/<(svg|img|span|style|p|i)\b/.test(surfaceJsx));
const mounts = {
    'A. Guiado': /<AccessWrapper>\{\(content\) => <VisorTexto/.test(app),
    'B. Accesible': /<AccessWrapper surfaceMode="accessible">\{\(content\) => <VisorAccesible/.test(app),
    'C. Inmersivo': /<ProtectedContentSurface>\s*<VisorInmersivo content/.test(app),
    'D. PDF': /<AccessWrapper>\{\(content\) => <VisorPDF/.test(app),
    'E. EPUB': /<ProtectedContentSurface>\s*<ChibaleteEpubReader/.test(epubApp),
    'F. Álbum': /<AccessWrapper>\{\(content\) => <VisorAlbum/.test(app),
    'F. Galería': /<AccessWrapper>\{\(content\) => <GaleriaIlustraciones/.test(app),
    'G. Vídeo': /<ProtectedContentSurface>\s*<VisorVideo/.test(router),
};
for (const [k, v] of Object.entries(mounts)) ok(`${k}: montado sin props de marca ni datos de persona`, v);
ok('AccessWrapper pasa solo el modo', /<ProtectedContentSurface mode=\{surfaceMode\}>/.test(accessWrapper));
const runtimeFiles = ['App.tsx', 'components/ContentRouter.tsx', 'components/epub-reader/EpubReaderApp.tsx',
    'components/epub-reader/foliateAdapter.mjs', 'components/GaleriaIlustraciones.tsx', 'pages/VisorAudio.tsx',
    'pages/VisorVideo.tsx', 'pages/Experiencias.tsx', 'components/ProtectedContentSurface.tsx', 'utils/contentProtection.mjs'];
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const offenders = runtimeFiles.filter((f) => /watermark|viewerMarker|data-chp-mark|chpMark|watermarkLabel|shortInstitution/i.test(strip(read(f))));
ok('H/J. ningún archivo runtime de CP-4A deriva marcador ni monta overlay', offenders.length === 0, offenders.join(', '));
ok('I. sin derivación de identidad (hash de cuenta) en el helper', !/0x811c9dc5|Math\.imul|colegio|institution/.test(helperCode));
ok('K. impresión: aviso presente', PROTECTED_PRINT_CSS.includes('Contenido protegido en Chibalete+'));
ok('K. impresión: sin marca (sin attr(), ::after ni fondo)', !/attr\(|::after|background-image|url\(/.test(PROTECTED_PRINT_CSS));
ok('sin detección de capturas (PrintScreen, visibilitychange, blur, keydown)',
    !/PrintScreen|visibilitychange|'blur'|keydown|keyup/.test(surfaceCode + helperCode));

console.log(`\nContentExtractionDeterrence — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
