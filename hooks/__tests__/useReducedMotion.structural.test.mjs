/**
 * useReducedMotion.structural.test.mjs — Fase 4 accessibility.
 *
 *   §1  archivo existe + exports default + named
 *   §2  query correcta: '(prefers-reduced-motion: reduce)'
 *   §3  SSR-safe: chequea typeof window === 'undefined' antes de matchMedia
 *   §4  defensivo: matchMedia throw → fallback false
 *   §5  initial state lee matchMedia.matches al primer render
 *   §6  useEffect suscribe a change con addEventListener (moderno)
 *   §7  fallback legacy a addListener si addEventListener no existe (Safari <14)
 *   §8  cleanup: useEffect retorna unsubscribe
 *   §9  VisorAlbum.tsx integra useReducedMotion en narrativeTransition + confetti
 *  §10  ContentCard NO importa el hook directamente (Tailwind motion-reduce: ya lo cubre)
 *
 *   node hooks/__tests__/useReducedMotion.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(__dirname, '..', 'useReducedMotion.ts');
const albumPath = path.join(__dirname, '..', '..', 'pages', 'VisorAlbum.tsx');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('useReducedMotion — Fase 4 lock-in estructural');

const src = fs.readFileSync(hookPath, 'utf8');
const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── §1 ────────────────────────────────────────────────────────────────────
section('[1] exports correctos');
ok('archivo existe',                                src.length > 0);
ok('exporta function useReducedMotion',             /export function useReducedMotion/.test(src));
ok('exporta default useReducedMotion',              /export default useReducedMotion/.test(src));
ok('return type boolean',                           /\):\s*boolean/.test(src));

// ── §2: query exact ────────────────────────────────────────────────────────
section('[2] query exact');
ok("query === '(prefers-reduced-motion: reduce)'",
   /matchMedia\(['"]\(prefers-reduced-motion:\s*reduce\)['"]\)/.test(src));

// ── §3: SSR-safe ──────────────────────────────────────────────────────────
section('[3] SSR-safe');
ok('chequea typeof window === undefined',
   /typeof\s+window\s*===\s*['"]undefined['"]/.test(srcNoComments));
ok('chequea typeof window.matchMedia (=== o !==)',
   /typeof\s+window\.matchMedia\s*[!=]==\s*['"]function['"]/.test(srcNoComments));
ok('initial state lazy con useState(() =>',
   /useState[^;]*\(\s*\(\s*\)\s*=>/.test(srcNoComments));

// ── §4: defensivo try/catch ───────────────────────────────────────────────
section('[4] defensivo — matchMedia throw → fallback false');
ok('try/catch en initial state',                    /try\s*\{[\s\S]*matchMedia[\s\S]*?\}\s*catch/.test(srcNoComments));
ok('try/catch en useEffect subscription',           (srcNoComments.match(/try\s*\{/g) || []).length >= 2);
ok('default seguro: return false',                  /return\s+false/.test(srcNoComments));

// ── §5: initial state ─────────────────────────────────────────────────────
section('[5] initial state lee matchMedia.matches');
ok('initial usa .matches',                          /\.matches/.test(srcNoComments));

// ── §6: useEffect addEventListener ────────────────────────────────────────
section('[6] addEventListener moderno');
ok('useEffect presente',                            /useEffect\(/.test(srcNoComments));
ok('addEventListener("change")',                    /addEventListener\(['"]change['"]/.test(srcNoComments));

// ── §7: fallback legacy ───────────────────────────────────────────────────
section('[7] fallback legacy addListener (Safari <14)');
ok('chequea typeof addListener',                    /typeof\s+\w+\.addListener\s*===\s*['"]function['"]/.test(srcNoComments));
ok('addListener fallback',                          /\w+\.addListener\(/.test(srcNoComments));

// ── §8: cleanup ───────────────────────────────────────────────────────────
section('[8] useEffect cleanup');
ok('return de cleanup',                             /return\s*\(\s*\)\s*=>\s*\{/.test(srcNoComments));
ok('removeEventListener en cleanup',                /removeEventListener\(['"]change['"]/.test(srcNoComments));
ok('removeListener legacy cleanup',                 /removeListener\??\.\(|removeListener\?\.\(|removeListener\(/.test(srcNoComments));

// ── §9: VisorAlbum integra el hook ────────────────────────────────────────
section('[9] VisorAlbum integra useReducedMotion');
const albumSrc = fs.readFileSync(albumPath, 'utf8');
ok('VisorAlbum importa useReducedMotion',           /import\s*\{\s*useReducedMotion\s*\}\s*from\s*['"]\.\.\/hooks\/useReducedMotion['"]/.test(albumSrc));
ok('VisorAlbum llama useReducedMotion()',           /const\s+reducedMotion\s*=\s*useReducedMotion\(\)/.test(albumSrc));
ok('narrativeTransition respeta reducedMotion',     /reducedMotion[\s\S]{0,200}?['"]none['"]/.test(albumSrc));
ok('confetti hit-challenge gated por !reducedMotion',
   /if\s*\(\s*!reducedMotion\s*\)\s*\{[\s\S]*?confetti\(\{\s*particleCount:\s*100/.test(albumSrc));
ok('confetti complete-celebration gated por !reducedMotion',
   /if\s*\(\s*!reducedMotion\s*\)\s*\{[\s\S]*?confetti\(\{\s*particleCount:\s*140/.test(albumSrc));

// ── §10: ContentCard usa Tailwind motion-reduce: (no necesita el hook) ────
section('[10] ContentCard usa Tailwind motion-reduce: classes');
const cardSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'ContentCard.tsx'), 'utf8');
ok('ContentCard NO importa useReducedMotion directamente',
   !/from\s+['"][^'"]*useReducedMotion['"]/.test(cardSrc));
ok('ContentCard usa motion-reduce:transition-none',
   /motion-reduce:transition-none/.test(cardSrc));
ok('ContentCard usa motion-reduce:group-hover:scale-100',
   /motion-reduce:group-hover:scale-100/.test(cardSrc));

// ── §11: CHP-WCAG-FIVE-SURFACES-01B — lock-in de los P1 corregidos ─────────
section('[11] CHP-WCAG-01B — P1 transversales y de Biblioteca (estructural)');
const readSrc = (...segs) => fs.readFileSync(path.join(__dirname, '..', '..', ...segs), 'utf8');
const layoutSrc   = readSrc('components', 'Layout.tsx');
const appSrc      = readSrc('App.tsx');
const chatbotSrc  = readSrc('components', 'Chatbot.tsx');
const navbarSrc   = readSrc('components', 'Navbar.tsx');
const bibSrc      = readSrc('pages', 'Biblioteca.tsx');
const inmSrc      = readSrc('pages', 'VisorInmersivo.tsx');
const txtSrc      = readSrc('pages', 'VisorTexto.tsx');
const leoSrc      = readSrc('components', 'LeoCompanion.tsx');
const subirSrc    = readSrc('pages', 'SubirContenido.tsx');

// LAYOUT-01 — enlace de salto: primer control, oculto fuera de foco, destino en <main>
ok('Layout: enlace "Saltar al contenido principal"',      /Saltar al contenido principal/.test(layoutSrc));
ok('Layout: el enlace de salto precede a la Navbar',       layoutSrc.indexOf('href="#contenido-principal"') < layoutSrc.indexOf('<Navbar'));
ok('Layout: oculto fuera de foco (sr-only focus:not-sr-only)', /sr-only focus:not-sr-only/.test(layoutSrc));
ok('Layout: <main id="contenido-principal" tabIndex={-1}>', /<main id="contenido-principal" ref=\{mainRef\} tabIndex=\{-1\}/.test(layoutSrc));
ok('Layout: el click enfoca el main (HashRouter no navega)', /main\.focus\(\)/.test(layoutSrc) && /e\.preventDefault\(\)/.test(layoutSrc));
// LAYOUT-04 — espacio reservado bajo el FAB de Leo
ok('Layout: main reserva espacio inferior (pb-40 md:pb-24)', /pb-40 md:pb-24/.test(layoutSrc));

// LAYOUT-02 — títulos por ruta, distintos en las cinco rutas auditadas
ok('App: RouteTitle escribe document.title con useLocation', /const RouteTitle/.test(appSrc) && /document\.title = /.test(appSrc) && /useLocation\(\)/.test(appSrc));
ok('App: <RouteTitle /> montado dentro del HashRouter',    /<HashRouter>\s*<RouteTitle \/>/.test(appSrc));
{
    const tbl = appSrc.slice(appSrc.indexOf('const ROUTE_TITLES'), appSrc.indexOf('const RouteTitle'));
    const entries = [...tbl.matchAll(/\[(\/[^\n]*?\/), '([^']+)'\]/g)].map(m => [new RegExp(m[1].slice(1, -1)), m[2]]);
    const titleFor = (p) => (entries.find(([re]) => re.test(p)) || [null, 'Chibalete+'])[1];
    const routes = ['/biblioteca', '/experiencias/exp-1', '/subir-contenido', '/aula-viva', '/aula-viva/operacional'];
    const titles = routes.map(titleFor);
    ok(`App: cinco rutas auditadas → cinco títulos distintos (${titles.join(' | ')})`,
       new Set(titles).size === 5 && titles.every(t => t && t !== 'Chibalete+'));
}

// LAYOUT-03 — FAB de Leo con nombre accesible
ok('Chatbot: FAB con aria-label="Abrir chat con Leo"',     /aria-label="Abrir chat con Leo"/.test(chatbotSrc));
ok('Chatbot: sin aria-label="crab" (nombre erróneo)',      !/aria-label="crab"/.test(chatbotSrc));

// LAYOUT-05 (incidental) — rótulo "Gestión" ya no en gray-400
ok('Navbar: "Gestión" con text-gray-600',                   /text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">Gestión/.test(navbarSrc));

// LAYOUT-06 + BIBLIOTECA-01 — chips: foco visible con contraste y estado aria-pressed
ok('Biblioteca: chips con aria-pressed={activeTab === tab}', /aria-pressed=\{activeTab === tab\}/.test(bibSrc));
ok('Biblioteca: chips con anillo focus-visible indigo-700', /focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2/.test(bibSrc));

// BIBLIOTECA-02 — portada fuera del orden de tabulación y del árbol accesible
ok('ContentCard: enlace de portada con tabIndex={-1} y aria-hidden', /tabIndex=\{-1\}\s*aria-hidden="true"\s*>/.test(cardSrc.replace(/\/\/[^\n]*\n/g, '')));
ok('ContentCard: el título conserva su enlace con nombre',  /<Link to=\{`\/contenido\/\$\{content\.id\}`\} className="[^"]*hover:text-indigo-600/.test(cardSrc));

// BIBLIOTECA-06 — cinco botones del inmersivo con nombre
for (const label of ['Ajustes de lectura', 'Frase anterior', 'Frase siguiente', 'Aumentar velocidad', 'Reducir velocidad']) {
    ok(`VisorInmersivo: aria-label="${label}"`, inmSrc.includes(`aria-label="${label}"`));
}

// BIBLIOTECA-08 — panel de ajustes del guiado como diálogo con teclado
ok('VisorTexto: panel role="dialog" aria-label="Ajustes de lectura"', /id="vt-ajustes-lectura" role="dialog" aria-label="Ajustes de lectura"/.test(txtSrc));
ok('VisorTexto: disparador con aria-expanded y aria-controls', /aria-expanded=\{isDisplayMenuOpen\}/.test(txtSrc) && /aria-controls="vt-ajustes-lectura"/.test(txtSrc));
ok('VisorTexto: foco al abrir + Escape cierra + restaura foco al disparador',
   /if \(isDisplayMenuOpen\) displayMenuRef\.current\?\.focus\(\)/.test(txtSrc) && /e\.key === 'Escape'[^\n]*closeDisplayMenu\(\)/.test(txtSrc) && /displayMenuTriggerRef\.current\?\.focus\(\)/.test(txtSrc));
ok('VisorTexto: ciclo Tab/Shift+Tab dentro del panel',      /e\.shiftKey && \(active === first/.test(txtSrc) && /active === last\) \{ e\.preventDefault\(\); first\.focus\(\); \}/.test(txtSrc));
for (const label of ['Reducir tamaño de fuente', 'Aumentar tamaño de fuente', 'Reducir velocidad de voz', 'Aumentar velocidad de voz']) {
    ok(`VisorTexto: aria-label="${label}"`, txtSrc.includes(`aria-label="${label}"`));
}

// BIBLIOTECA-09 — modal de Leo como diálogo
ok('LeoCompanion: role="dialog" aria-modal aria-labelledby', /role="dialog" aria-modal="true" aria-labelledby="leo-companion-title"/.test(leoSrc));
ok('LeoCompanion: h2 con id del título',                    /<h2 id="leo-companion-title"/.test(leoSrc));
ok('LeoCompanion: botón cerrar con nombre',                 /onClick=\{onClose\} aria-label="Cerrar"/.test(leoSrc));
ok('LeoCompanion: foco inicial + restauración al elemento previo',
   /dialogRef\.current\?\.focus\(\)/.test(leoSrc) && /const openerRef = useRef<HTMLElement \| null>\(typeof document !== 'undefined' \? \(document\.activeElement as HTMLElement \| null\) : null\)/.test(leoSrc) && /opener\.focus\(\)/.test(leoSrc) && /window\.setTimeout\(\(\) => \{ document\.querySelector<HTMLElement>\(selector\)\?\.focus\(\); \}, 0\)/.test(leoSrc));
ok('LeoCompanion: Escape cierra y Tab cicla',               /e\.key === 'Escape'[^\n]*onClose\(\)/.test(leoSrc) && /e\.shiftKey && \(active === first/.test(leoSrc));

// STUDIO-06 — formulario de Subir: cada htmlFor tiene su id
{
    const fors = [...subirSrc.matchAll(/htmlFor="(sc-[a-z-]+)"/g)].map(m => m[1]);
    const ids  = new Set([...subirSrc.matchAll(/\bid="(sc-[a-z-]+)"/g)].map(m => m[1]));
    ok(`SubirContenido: ${fors.length} labels sc-* asociados (≥ 12)`, fors.length >= 12);
    ok('SubirContenido: todo htmlFor="sc-*" tiene su id="sc-*"', fors.every(f => ids.has(f)) && new Set(fors).size === fors.length);
    for (const f of ['sc-tipo', 'sc-titulo', 'sc-autor', 'sc-descripcion', 'sc-etiquetas', 'sc-biografia', 'sc-portada', 'sc-recurso', 'sc-texto-es', 'sc-texto-en', 'sc-texto-pt', 'sc-ilustraciones']) {
        ok(`SubirContenido: campo ${f} etiquetado`, fors.includes(f) && ids.has(f));
    }
}

// Contraste de los colores introducidos (Tailwind v3 por defecto) — WCAG 1.4.3 / 1.4.11
{
    const lum = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    ok('contraste: anillo de foco indigo-700 (#4338ca) sobre blanco ≥ 3:1', ratio('#4338ca', '#ffffff') >= 3);
    ok('contraste: texto blanco sobre amber-700 (#b45309) ≥ 4.5:1',    ratio('#ffffff', '#b45309') >= 4.5);
    ok('contraste: gray-600 (#4b5563) sobre blanco ≥ 4.5:1',           ratio('#4b5563', '#ffffff') >= 4.5);
    ok('contraste: enlace de salto blanco sobre indigo-700 ≥ 4.5:1',    ratio('#ffffff', '#4338ca') >= 4.5);
}

// ── §12: CHP-WCAG-FIVE-SURFACES-01C — lock-in de los P2 corregidos ─────────
section('[12] CHP-WCAG-01C — P2 (Biblioteca, visores, Leo, Subir, Aula Viva operacional)');
const fichaSrc = readSrc('pages', 'PaginaDetalleLibro.tsx');
const opSrc    = readSrc('pages', 'AulaVivaOperacional.tsx');
const bibSrc2  = readSrc('pages', 'Biblioteca.tsx');
const inmSrc2  = readSrc('pages', 'VisorInmersivo.tsx');
const txtSrc2  = readSrc('pages', 'VisorTexto.tsx');
const leoSrc2  = readSrc('components', 'LeoCompanion.tsx');
const cardSrc2 = readSrc('components', 'ContentCard.tsx');
const subirSrc2 = readSrc('pages', 'SubirContenido.tsx');

// BIBLIOTECA-03 / 04 — campos con nombre
ok('Biblioteca: buscador con aria-label',                     /aria-label="Buscar título, autor o tema"/.test(bibSrc2));
ok('Ficha: textarea de reseña con aria-label',                /<textarea\s+aria-label="Tu reseña"/.test(fichaSrc));
// BIBLIOTECA-05 — landmarks / encabezado
ok('Ficha: contenedor raíz es <main>',                        /return \(\s*<main className="relative min-h-screen/.test(fichaSrc) && /<\/main>\s*\);\s*};/.test(fichaSrc));
ok('Inmersivo: role="main" con nombre y h1 accesible',        /role="main" aria-label=\{content\?\.titulo \?\? 'Lectura inmersiva'\}/.test(inmSrc2) && /<h1 className="sr-only">\{content\?\.titulo\}<\/h1>/.test(inmSrc2));
// BIBLIOTECA-07 — nombres explícitos en el guiado
ok('Guiado: botón de voz con aria-label y aria-pressed',      /aria-label=\{audioLoading \? 'Generando audio' : isPlaying \? 'Pausar lectura' : 'Leer en voz alta'\}/.test(txtSrc2) && /aria-pressed=\{isPlaying\}/.test(txtSrc2));
ok('Guiado: oralidad con aria-label',                         /aria-label="Laboratorio de oralidad \(beta\)"/.test(txtSrc2));
// BIBLIOTECA-10 — retorno de foco desde los visores al control de origen
ok('Ficha: goRead envía returnFocus en el estado de navegación', /const goRead = \(path: string, returnFocus\?: string\) =>/.test(fichaSrc) && /\{ state: \{ returnFocus \} \}/.test(fichaSrc));
for (const key of ['leer-ahora', 'inmersivo', 'guiado', 'accesible']) {
    ok(`Ficha: control data-return-focus="${key}"`, fichaSrc.includes(`data-return-focus="${key}"`));
}
ok('Ficha: al montar enfoca el control de origen (una vez)',  /returnFocusDone\.current = true; target\.focus\(\);/.test(fichaSrc) && /\[data-return-focus="\$\{returnFocusKey\}"\]/.test(fichaSrc));
ok('Inmersivo: «Volver» devuelve returnFocus (fallback inmersivo)', /const goBackToFicha = \(\) => navigate\(fichaPath, \{ state: \{ returnFocus: [^\n]*\?\? 'inmersivo' \} \}\)/.test(inmSrc2) && /onClick=\{goBackToFicha\}/.test(inmSrc2));
ok('Guiado: «Volver» devuelve returnFocus (fallback guiado)', /useNavigateTo\(fichaPath, \{ state: \{ returnFocus: [^\n]*\?\? 'guiado' \} \}\)/.test(txtSrc2));
// BIBLIOTECA-11 / 12
ok('Leo: «Para ti» con text-gray-600',                        /text-gray-600 dark:text-gray-300 text-center tracking-wider mb-1">Para ti/.test(leoSrc2));
ok('ContentCard: enlace del título con min-h-6',              /className="block truncate min-h-6 leading-6 hover:text-indigo-600/.test(cardSrc2));
// STUDIO-05 — tarjetas de modo con estado
ok('Subir: 4 tarjetas de modo con aria-pressed',              (subirSrc2.match(/aria-pressed=\{uploadMode === '(new|existing|manage|experiencia)'\}/g) || []).length === 4);
// AULAVIVA-01 / 02 / 03
ok('Operacional: lector seleccionado con aria-pressed',       /aria-pressed=\{selectedStudent === item\.user_id\}/.test(opSrc));
ok('Operacional: anuncio role="status" al cargar el timeline', /<p role="status" aria-live="polite" className="sr-only">\{selectionAnnounce\}<\/p>/.test(opSrc) && /setSelectionAnnounce\(`Lector \$\{userId\} seleccionado\. Recomendaciones y timeline cargados\.`\)/.test(opSrc));
ok('Operacional: pie con text-gray-600 y estado emerald-700', /<footer className="mt-6 text-xs text-gray-600 text-center">/.test(opSrc) && /<span className="text-emerald-700">operacional<\/span>/.test(opSrc));
// contraste de los colores nuevos (Tailwind v3)
{
    const lum = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    ok('contraste: gray-600 (#4b5563) sobre gray-50 (#f9fafb) ≥ 4.5:1',     ratio('#4b5563', '#f9fafb') >= 4.5);
    ok('contraste: gray-700 (#374151) sobre gray-100 (#f3f4f6) ≥ 4.5:1',    ratio('#374151', '#f3f4f6') >= 4.5);
    ok('contraste: emerald-700 (#047857) sobre gray-50 ≥ 4.5:1',            ratio('#047857', '#f9fafb') >= 4.5);
    ok('contraste: gray-600 sobre indigo-50 (#eef2ff) ≥ 4.5:1',              ratio('#4b5563', '#eef2ff') >= 4.5);
}
// Permanencia P1 (01B): salto, título, FAB, ring, diálogos — ya cubiertos en §11; aquí se fija que siguen presentes
ok('P1 permanece: skip link + RouteTitle + FAB + ring + diálogos', /Saltar al contenido principal/.test(layoutSrc) && /const RouteTitle/.test(appSrc) && /aria-label="Abrir chat con Leo"/.test(chatbotSrc) && /focus-visible:ring-indigo-700/.test(bibSrc2) && /role="dialog" aria-label="Ajustes de lectura"/.test(txtSrc2) && /aria-labelledby="leo-companion-title"/.test(leoSrc2));

// ── §13: CHP-LEO-AI-TRANSPARENCY-NOTICE-01A — aviso de IA en las dos superficies ─
section('[13] CHP-LEO-AI-NOTICE-01A — aviso de IA en chat flotante y compañero');
{
    const chatSrc3 = readSrc('components', 'Chatbot.tsx');
    const leoSrc3  = readSrc('components', 'LeoCompanion.tsx');
    const mookSrc3 = readSrc('pages', 'Experiencias.tsx');
    const NOTICE   = 'Leo es un asistente de inteligencia artificial y puede equivocarse: conversarás con una IA que acompaña tu lectura, no con una persona. Leo no califica ni evalúa; las producciones las revisa siempre tu mediador humano.';
    const surfaces = [['Chatbot', chatSrc3], ['LeoCompanion', leoSrc3]];
    // etiqueta de apertura del <p> que contiene el aviso, en cada superficie
    const noticeTag = (src) => src.slice(src.lastIndexOf('<p ', src.indexOf(NOTICE)), src.indexOf(NOTICE));

    // (1)(2) el aviso está, literal, en ambas superficies activas de Leo
    for (const [name, src] of surfaces) {
        ok(`${name}: contiene el aviso de IA literal`, src.includes(NOTICE));
    }
    // trazabilidad: el texto deriva del nodo LEO de MOOK (cola verbatim compartida)
    ok('MOOK sigue siendo la fuente: cola del aviso idéntica',
       mookSrc3.includes('Leo no califica ni evalúa; las producciones las revisa siempre tu mediador humano.'));

    for (const [name, src] of surfaces) {
        // (3) identifica expresamente la inteligencia artificial
        ok(`${name}: identifica expresamente la inteligencia artificial`,
           /Leo es un asistente de inteligencia artificial/.test(src));
        // (4) declara falibilidad
        ok(`${name}: declara que puede equivocarse`, /puede equivocarse/.test(src));
        // (6) es texto visible de nodo, no atributo ARIA, title ni placeholder
        ok(`${name}: el aviso es texto de nodo, no title/aria-label/placeholder`,
           /<p [^>]*>\s*$/.test(noticeTag(src))
           && !/(title|aria-label|aria-description|placeholder)="[^"]*inteligencia artificial/.test(src));
        // (6b) ni oculto a la vista ni al árbol accesible
        ok(`${name}: el aviso NO está en sr-only/hidden/aria-hidden/opacity-0`,
           !/sr-only|\bhidden\b|aria-hidden|invisible|opacity-0/.test(noticeTag(src)));
        // (8) no es live region: no se anuncia durante el streaming
        ok(`${name}: el aviso NO es live region`,
           !/aria-live|role="status"|role="alert"/.test(noticeTag(src)));
    }

    // (5) el aviso precede en el DOM al control que inicia la interacción
    ok('Chatbot: el aviso precede al campo de pregunta',
       chatSrc3.indexOf(NOTICE) < chatSrc3.indexOf('onKeyDown={handleKeyDown}'));
    ok('Chatbot: el aviso precede al botón de envío',
       chatSrc3.indexOf(NOTICE) < chatSrc3.indexOf('onClick={handleSend}'));
    ok('Chatbot: el aviso va tras el encabezado del panel abierto',
       chatSrc3.indexOf('Leo - Asistente') < chatSrc3.indexOf(NOTICE));
    ok('LeoCompanion: el aviso precede a vocabulario y pregunta',
       leoSrc3.indexOf(NOTICE) < leoSrc3.indexOf("onClick={() => setMode('vocab')}")
       && leoSrc3.indexOf(NOTICE) < leoSrc3.indexOf("onClick={() => setMode('question')}"));
    ok('LeoCompanion: el aviso precede al campo y al envío',
       leoSrc3.indexOf(NOTICE) < leoSrc3.indexOf('onClick={handleAction}'));
    ok('LeoCompanion: el aviso va dentro del diálogo, tras el h2 y antes del cuerpo',
       leoSrc3.indexOf('id="leo-companion-title"') < leoSrc3.indexOf(NOTICE)
       && leoSrc3.indexOf(NOTICE) < leoSrc3.indexOf('{/* Body */}'));

    // (7) no introduce consentimiento, aceptación ni bloqueo
    // los comentarios del propio parche nombran la palabra «consentimiento»:
    // la aserción tiene que mirar el JSX renderizado, no los comentarios.
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [name, src] of surfaces) {
        const code = stripComments(src);
        ok(`${name}: sin checkbox ni aceptación nuevos`,
           !/type="checkbox"/.test(code) && !/consentimiento|Acepto|He leído|Entendido/i.test(code));
    }

    // (8) aparece exactamente una vez: no se repite por mensaje ni por respuesta
    for (const [name, src] of surfaces) {
        const n = src.split(NOTICE).length - 1;
        ok(`${name}: el aviso aparece exactamente 1 vez (${n})`, n === 1);
    }
    ok('Chatbot: el aviso está fuera del map de mensajes',
       chatSrc3.indexOf(NOTICE) < chatSrc3.indexOf('messages.map((msg)'));
    ok('LeoCompanion: el aviso está fuera del bloque de respuesta',
       leoSrc3.indexOf(NOTICE) < leoSrc3.indexOf("mode === 'result'"));

    // (9)(10) diálogo, foco inicial, restauración, Escape y ciclo Tab intactos
    ok('LeoCompanion: diálogo/foco/Escape/Tab siguen intactos tras el aviso',
       /role="dialog" aria-modal="true" aria-labelledby="leo-companion-title"/.test(leoSrc3)
       && /dialogRef\.current\?\.focus\(\)/.test(leoSrc3)
       && /opener\.focus\(\)/.test(leoSrc3)
       && /e\.key === 'Escape'[^\n]*onClose\(\)/.test(leoSrc3)
       && /e\.shiftKey && \(active === first/.test(leoSrc3));
    ok('Chatbot: FAB accesible y minimizar intactos tras el aviso',
       /aria-label="Abrir chat con Leo"/.test(chatSrc3) && /toggleChat\(false\)/.test(chatSrc3));
    ok('el aviso no introduce elementos focalizables nuevos',
       surfaces.every(([, src]) => {
           const i = src.indexOf(NOTICE);
           const block = src.slice(src.lastIndexOf('<p ', i), src.indexOf('</p>', i));
           return !/<(a|button|input|select|textarea)\b|tabIndex/.test(block);
       }));

    // (11) reflow 320/479: banda de ancho natural, sin anchos fijos ni superposición
    for (const [name, src] of surfaces) {
        const tag = noticeTag(src);
        ok(`${name}: el aviso no fija ancho ni se superpone`,
           !/\bw-\[|\babsolute\b|\bfixed\b|min-w-/.test(tag));
        ok(`${name}: el aviso usa la banda discreta text-xs px-4 py-2`,
           /text-xs/.test(tag) && /px-4 py-2/.test(tag));
    }

    // (12) contraste del par usado por el aviso (Tailwind v3), claro y oscuro
    {
        const lum = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        const rLight = ratio('#4b5563', '#f9fafb'), rDark = ratio('#d1d5db', '#111827');
        ok(`aviso claro: gray-600 sobre gray-50 ≥ 4.5:1 (${rLight.toFixed(2)})`, rLight >= 4.5);
        ok(`aviso oscuro: gray-300 sobre gray-900 ≥ 4.5:1 (${rDark.toFixed(2)})`, rDark >= 4.5);
    }

    // (13) el aviso no toca el contrato funcional de Leo
    ok('LeoCompanion: endpoint, método y payload de /api/leo/ask intactos',
       /fetch\('\/api\/leo\/ask', \{/.test(leoSrc3)
       && /method: 'POST'/.test(leoSrc3)
       && /contentId, chunkIndex: currentIndex, interactionType: type, payload, exactSentence,/.test(leoSrc3));
    ok('Chatbot: sigue usando chatConBibliotecario del servicio existente',
       /chatConBibliotecario/.test(chatSrc3) && /from '\.\.\/services\/geminiService'/.test(chatSrc3));

    // (15) el texto no promete exactitud, evaluación automática ni sustitución docente
    ok('el texto no promete exactitud ni evaluación ni sustituye al docente',
       !/siempre correcto|siempre acierta|nunca se equivoca|100%|infalible|te calificar|reemplaza a tu/i.test(NOTICE)
       && /no califica ni evalúa/.test(NOTICE)
       && /tu mediador humano/.test(NOTICE));
}

// ── §14: CHP-LEO-MINOR-PRIVACY-NOTICE-01A — aviso de privacidad para menores ──
section('[14] CHP-LEO-PRIVACY-01A — aviso de privacidad en las 3 superficies de Leo');
{
    const chatSrc4 = readSrc('components', 'Chatbot.tsx');
    const leoSrc4  = readSrc('components', 'LeoCompanion.tsx');
    const expSrc4  = readSrc('pages', 'Experiencias.tsx');
    const surfaces4 = [['Chatbot', chatSrc4], ['LeoCompanion', leoSrc4], ['Experiencias', expSrc4]];

    const BOLD = 'Cuida tu información.';
    const BODY = ' Cuando usas Leo, lo que escribes se procesa para generar una respuesta y Chibalete+ registra señales generales para acompañar tu lectura. No compartas nombres completos, direcciones, teléfonos, contraseñas ni otra información privada. Tu mediador puede consultar indicadores de acompañamiento, no la conversación completa. Si algo te incomoda, cierra Leo y habla con una persona adulta o con tu mediador.';
    const MAIL = 'contacto@chibaleteeditores.com';
    const privTag = (src) => src.slice(src.lastIndexOf('<p ', src.indexOf(BOLD)), src.indexOf(BOLD));

    // (1)(2) las tres superficies activas llevan el texto aprobado completo
    for (const [name, src] of surfaces4) {
        ok(`${name}: lleva el encabezado en negrita del aviso`,
           src.includes(`<strong className="font-bold">${BOLD}</strong>`));
        ok(`${name}: lleva el cuerpo del texto aprobado, íntegro y sin alterar`, src.includes(BODY));
    }

    // (3) expresiones que el texto aprobado exige conservar
    for (const [name, src] of surfaces4) {
        ok(`${name}: conserva «Cuida tu información»`, src.includes('Cuida tu información'));
        ok(`${name}: conserva «no la conversación completa»`, src.includes('no la conversación completa'));
        ok(`${name}: advierte sobre datos privados`,
           /No compartas nombres completos, direcciones, teléfonos, contraseñas/.test(src));
        ok(`${name}: ofrece la salida a una persona adulta o al mediador`,
           /cierra Leo y habla con una persona adulta o con tu mediador/.test(src));
    }

    // (4) el aviso precede al control que inicia la interacción
    ok('Chatbot: el aviso de privacidad precede al campo y al envío',
       chatSrc4.indexOf(BOLD) < chatSrc4.indexOf('onKeyDown={handleKeyDown}')
       && chatSrc4.indexOf(BOLD) < chatSrc4.indexOf('onClick={handleSend}'));
    ok('LeoCompanion: el aviso precede a vocabulario, pregunta y envío',
       leoSrc4.indexOf(BOLD) < leoSrc4.indexOf("onClick={() => setMode('vocab')}")
       && leoSrc4.indexOf(BOLD) < leoSrc4.indexOf("onClick={() => setMode('question')}")
       && leoSrc4.indexOf(BOLD) < leoSrc4.indexOf('onClick={handleAction}'));
    ok('Experiencias: el aviso precede al botón de validación del nodo LEO',
       expSrc4.indexOf(BOLD) < expSrc4.indexOf('Ya conversé — validar'));

    // (5)(6) canal institucional como mailto, y ninguna dirección personal
    for (const [name, src] of surfaces4) {
        ok(`${name}: enlace mailto al buzón institucional`,
           src.includes(`<a href="mailto:${MAIL}"`));
        const correos = [...src.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map(m => m[0]);
        const ajenos = correos.filter(c => c !== MAIL);
        ok(`${name}: no aparece ninguna otra dirección de correo (${correos.length} total)`,
           ajenos.length === 0, ajenos.join(','));
    }

    // (7) informativo: sin consentimiento, checkbox ni modal nuevo
    const stripComments4 = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [name, src] of surfaces4) {
        const code = stripComments4(src);
        ok(`${name}: sin checkbox ni texto de aceptación`,
           !/type="checkbox"/.test(code) && !/consentimiento|Acepto|He leído|Entendido/i.test(code));
    }
    ok('Chatbot y LeoCompanion: el aviso no es live region',
       [chatSrc4, leoSrc4, expSrc4].every(src => !/aria-live|role="status"|role="alert"/.test(privTag(src))));

    // (8) fuera de los ciclos de mensajes y de resultados, y exactamente una vez
    for (const [name, src] of surfaces4) {
        const n = src.split(BODY).length - 1;
        ok(`${name}: el aviso aparece exactamente 1 vez (${n})`, n === 1);
    }
    ok('Chatbot: el aviso está fuera del map de mensajes',
       chatSrc4.indexOf(BOLD) < chatSrc4.indexOf('messages.map((msg)'));
    ok('LeoCompanion: el aviso está fuera del bloque de respuesta',
       leoSrc4.indexOf(BOLD) < leoSrc4.indexOf("mode === 'result'"));

    // (9) el aviso de IA anterior sigue en pie en las tres superficies
    ok('Chatbot y LeoCompanion conservan el aviso de IA con falibilidad',
       /Leo es un asistente de inteligencia artificial y puede equivocarse/.test(chatSrc4)
       && /Leo es un asistente de inteligencia artificial y puede equivocarse/.test(leoSrc4));
    ok('Experiencias conserva el aviso de IA del nodo LEO',
       /Leo es un asistente de inteligencia artificial: conversarás con una IA/.test(expSrc4));
    ok('en las tres, el aviso de IA precede al de privacidad',
       surfaces4.every(([, src]) => src.indexOf('Leo es un asistente de inteligencia artificial') < src.indexOf(BOLD)));

    // (10) contratos de red intactos
    ok('LeoCompanion: endpoint, método y payload de /api/leo/ask intactos',
       /fetch\('\/api\/leo\/ask', \{/.test(leoSrc4)
       && /method: 'POST'/.test(leoSrc4)
       && /contentId, chunkIndex: currentIndex, interactionType: type, payload, exactSentence,/.test(leoSrc4));
    ok('Chatbot: sigue usando chatConBibliotecario del servicio existente',
       /chatConBibliotecario/.test(chatSrc4) && /from '\.\.\/services\/geminiService'/.test(chatSrc4));
    ok('el texto del aviso NO se envía al modelo ni entra en ningún payload',
       surfaces4.every(([, src]) => {
           const code = stripComments4(src);
           const i = code.indexOf(BOLD);
           if (i < 0) return false;
           // el aviso vive dentro de un <p>, nunca dentro de un JSON.stringify / body
           const ctx = code.slice(Math.max(0, i - 400), i);
           return !/JSON\.stringify\(\s*\{[^}]*$/.test(ctx) && !/body:\s*$/.test(ctx);
       }));

    // (11) sin estado, efecto ni import nuevos
    for (const [name, src] of surfaces4) {
        const tag = privTag(src);
        ok(`${name}: el aviso no introduce estado ni efectos`,
           !/useState|useEffect|useRef/.test(tag));
    }
    ok('Chatbot: los imports no cambiaron por el aviso',
       /^import \{ Send, Minimize2, Loader2, Volume2, Mic, StopCircle \} from 'lucide-react';$/m.test(chatSrc4));
    ok('LeoCompanion: los imports no cambiaron por el aviso',
       /^import \{ X, Send, UserCircle2 \} from 'lucide-react';$/m.test(leoSrc4));

    // (12) WCAG: contraste del par usado, ausencia de anchos fijos, foco intacto
    {
        const lum = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        ok(`privacidad claro: gray-600 sobre gray-50 ≥ 4.5:1 (${ratio('#4b5563', '#f9fafb').toFixed(2)})`,
           ratio('#4b5563', '#f9fafb') >= 4.5);
        ok(`privacidad oscuro: gray-300 sobre gray-900 ≥ 4.5:1 (${ratio('#d1d5db', '#111827').toFixed(2)})`,
           ratio('#d1d5db', '#111827') >= 4.5);
    }
    for (const [name, src] of surfaces4) {
        const tag = privTag(src);
        ok(`${name}: el aviso no fija ancho ni se superpone`,
           !/\bw-\[|\babsolute\b|\bfixed\b|min-w-/.test(tag));
    }
    ok('LeoCompanion: diálogo, foco, Escape y ciclo Tab siguen fijados',
       /role="dialog" aria-modal="true" aria-labelledby="leo-companion-title"/.test(leoSrc4)
       && /dialogRef\.current\?\.focus\(\)/.test(leoSrc4)
       && /opener\.focus\(\)/.test(leoSrc4)
       && /e\.key === 'Escape'[^\n]*onClose\(\)/.test(leoSrc4)
       && /e\.shiftKey && \(active === first/.test(leoSrc4));
    ok('LeoCompanion: el ciclo Tab incluye enlaces ([href]) — el mailto es alcanzable',
       /\[href\]/.test(leoSrc4));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
