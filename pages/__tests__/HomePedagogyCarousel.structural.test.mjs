/**
 * HomePedagogyCarousel.structural.test.mjs
 * CHP-UI-PEDAGOGY-VISIBILITY-01.
 *
 * 1. `getArticulosPedagogicos` (Inicio → «Ideas y Reflexiones») excluye los
 *    nodos internos de Experiencias (`standalone === false`). El predicado se
 *    EXTRAE del fuente y se ejecuta sobre fixtures: no es una réplica.
 * 2. `ContentCarousel` sigue siendo horizontal con overflow interno y añade
 *    flechas de escritorio (ref + scrollBy smooth + estado por scroll/resize).
 *
 * Sin red. 0 lecturas y 0 escrituras de stores reales.
 *
 *   node pages/__tests__/HomePedagogyCarousel.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

// ── 1. getArticulosPedagogicos ──────────────────────────────────────────────
section('[1] Inicio · Ideas y Reflexiones sin nodos MOOK');
{
    const ds = read('services/dataService.ts');
    const m = ds.slice(ds.indexOf('getArticulosPedagogicos(): Content[] {'));
    const body = m.slice(0, m.indexOf('\n    }'));
    const pred = body.match(/this\.content\.filter\((c => [^;]+)\);/);
    ok('el método existe y filtra this.content', !!pred, body);
    const filter = pred ? new Function(`return (${pred[1]});`)() : () => false;
    const fixtures = [
        { id: 'pi',   tipo: 'articulo_pedagogico' },
        { id: 'm4',   tipo: 'articulo_pedagogico', standalone: true },
        { id: 'mook', tipo: 'articulo_pedagogico', standalone: false },
        { id: 'm1',   tipo: 'libro' },
        { id: 'guia', tipo: 'guia' },
    ];
    const ids = fixtures.filter(filter).map(c => c.id);
    ok('mantiene articulo_pedagogico sin standalone', ids.includes('pi'));
    ok('mantiene articulo_pedagogico standalone:true', ids.includes('m4'));
    ok('excluye el nodo MOOK (standalone:false)', !ids.includes('mook'));
    ok('no amplía a otros tipos', !ids.includes('m1') && !ids.includes('guia'), JSON.stringify(ids));

    const home = read('pages/Home.tsx');
    ok('Home sigue alimentando el carrusel con getArticulosPedagogicos',
        home.includes('dataService.getArticulosPedagogicos()') && home.includes('items={articulosPedagogicos}'));
}

// ── 2. ContentCarousel ──────────────────────────────────────────────────────
section('[2] ContentCarousel · navegación de escritorio');
{
    const src = read('components/ContentCarousel.tsx');
    ok('sigue siendo horizontal con overflow interno',
        src.includes('flex overflow-x-auto') && src.includes('scrollbar-hide'));
    ok('conserva el ancho de tarjeta', src.includes('w-36 md:w-48 flex-shrink-0'));
    ok('no se convirtió en grid', !/\bgrid\b/.test(src));
    ok('ref al scroller', src.includes('ref={scrollerRef}'));
    ok('scrollBy smooth ≈ 80% del ancho visible',
        src.includes('scrollBy(') && src.includes("behavior: 'smooth'") && src.includes('clientWidth * SCROLL_STEP')
        && /SCROLL_STEP = 0\.8\b/.test(src));
    ok('flechas visibles solo desde md', (src.match(/hidden md:flex/g) || []).length === 1 && src.includes('${arrowClass} left-2') && src.includes('${arrowClass} right-2'));
    ok('flechas ocultas en los extremos', src.includes('{canPrev && (') && src.includes('{canNext && ('));
    ok('estado recalculado en scroll y resize',
        src.includes("addEventListener('scroll', updateArrows") && src.includes("addEventListener('resize', updateArrows")
        && src.includes('ResizeObserver'));
    ok('listeners limpiados', src.includes("removeEventListener('scroll'") && src.includes("removeEventListener('resize'") && src.includes('disconnect()'));
    ok('botones accesibles', src.includes('aria-label="Ver anteriores"') && src.includes('aria-label="Ver más"') && src.includes('type="button"'));
    ok('flechas posicionadas dentro del contenedor (sin overflow de página)',
        src.includes('<div className="relative">') && src.includes('absolute'));
    ok('sin scroll-snap (no cambia el comportamiento móvil)', !src.includes('snap-'));
}

console.log(`\nHomePedagogyCarousel.structural: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
