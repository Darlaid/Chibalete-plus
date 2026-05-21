/**
 * validateActiveSentenceVisibility.test.js — F8 (verdadera regla madre).
 *
 * Cubre los 13 casos del spec del usuario:
 *
 *   V1.  count === 0 → active_missing
 *   V2.  count > 1   → active_duplicate
 *   V3.  index ≠ expectedIndex → index_mismatch
 *   V4.  textContent vacío → empty_text
 *   V5.  opacity < 0.65 → opacity_too_low
 *   V6.  display:none → invisible_style
 *   V7.  visibility:hidden → invisible_style
 *   V8.  width/height === 0 → zero_size
 *   V9.  rect fuera del container (overflow-hidden) → outside_viewport
 *   V10. centro vertical fuera del 5%-95% del container → outside_active_band
 *   V11. className no incluye 'immersive-sentence-active' → missing_active_class
 *   V12. color === backgroundColor → contrast_suspect
 *   V13. todo OK → ok:true con metrics completas
 *
 * Stubs sin jsdom: el validador acepta DOM elements como objetos con la
 * interfaz mínima { getAttribute, textContent, getBoundingClientRect, className }
 * y un getStyle inyectable.
 *
 * Cómo correr:
 *   node utils/__tests__/validateActiveSentenceVisibility.test.js
 */

import { validateActiveSentenceVisibility, _internals } from '../validateActiveSentenceVisibility.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

// ── Stubs helpers ────────────────────────────────────────────────────────

/**
 * Container "centrado" en (0,0) con tamaño 800×600.
 * containerRect: top=0 bottom=600 left=0 right=800.
 */
const baseContainer = {
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600, top: 0, bottom: 600, left: 0, right: 800 }),
};

/**
 * Stub de elemento activo "saludable" — index 45, en el centro del container,
 * opacidad alta, clase activa.
 */
function makeHealthyEl(overrides = {}) {
    const defaults = {
        attrs: { 'data-sentence-index': '45' },
        textContent: 'Ésta es la frase activa, visible y legible.',
        rect: { x: 100, y: 250, width: 600, height: 100, top: 250, bottom: 350, left: 100, right: 700 },
        className: 'immersive-sentence-item immersive-sentence-active py-8 px-8 text-center',
        style: { opacity: '1', visibility: 'visible', display: 'block', color: 'rgb(255, 255, 255)', backgroundColor: 'rgba(0, 0, 0, 0)' },
    };
    const merged = { ...defaults, ...overrides };
    return {
        getAttribute: (n) => merged.attrs[n] ?? null,
        textContent: merged.textContent,
        getBoundingClientRect: () => merged.rect,
        className: merged.className,
        __style: merged.style,
    };
}

function makeStyleGetter() {
    return (el) => el.__style;
}

console.log('\nvalidateActiveSentenceVisibility — F8 (ack solo si VERDADERAMENTE visible)');

// ───────────────────────────────────────────────────────────────────────────
// V1 — count === 0 → active_missing
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V1] activeEls vacío → active_missing');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = active_missing', r.reason === 'active_missing');
    ok('metrics.count = 0', r.metrics.count === 0);
}

// ───────────────────────────────────────────────────────────────────────────
// V2 — count > 1 → active_duplicate
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V2] dos active elements → active_duplicate');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl(), makeHealthyEl()],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = active_duplicate', r.reason === 'active_duplicate');
    ok('metrics.count = 2', r.metrics.count === 2);
}

// ───────────────────────────────────────────────────────────────────────────
// V3 — index ≠ expectedIndex → index_mismatch
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V3] data-sentence-index distinto → index_mismatch');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ attrs: { 'data-sentence-index': '46' } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = index_mismatch', r.reason === 'index_mismatch');
    ok('metrics.domIdx = 46', r.metrics.domIdx === 46);
}

// ───────────────────────────────────────────────────────────────────────────
// V4 — textContent vacío → empty_text
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V4] textContent vacío → empty_text');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ textContent: '   \n   ' })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = empty_text', r.reason === 'empty_text');
    ok('metrics incluyen textLength=0', r.metrics.textLength === 0);
}

// ───────────────────────────────────────────────────────────────────────────
// V5 — opacity < 0.65 → opacity_too_low
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V5] opacity 0.20 → opacity_too_low');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ style: { opacity: '0.20', visibility: 'visible', display: 'block', color: '#fff', backgroundColor: 'transparent' } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = opacity_too_low', r.reason === 'opacity_too_low');
    ok('metrics.opacity = 0.20', Math.abs(r.metrics.opacity - 0.20) < 0.001);

    // boundary: opacity >= 0.65 sí pasa
    const r2 = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ style: { opacity: '0.65', visibility: 'visible', display: 'block', color: '#fff', backgroundColor: 'transparent' } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('opacity = 0.65 (límite) sí pasa', r2.ok === true);
}

// ───────────────────────────────────────────────────────────────────────────
// V6 — display:none → invisible_style
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V6] display:none → invisible_style');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ style: { opacity: '1', visibility: 'visible', display: 'none', color: '#fff', backgroundColor: 'transparent' } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = invisible_style', r.reason === 'invisible_style');
}

// ───────────────────────────────────────────────────────────────────────────
// V7 — visibility:hidden → invisible_style
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V7] visibility:hidden → invisible_style');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ style: { opacity: '1', visibility: 'hidden', display: 'block', color: '#fff', backgroundColor: 'transparent' } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = invisible_style', r.reason === 'invisible_style');
}

// ───────────────────────────────────────────────────────────────────────────
// V8 — width o height === 0 → zero_size
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V8] width === 0 → zero_size');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ rect: { x: 0, y: 0, width: 0, height: 100, top: 0, bottom: 100, left: 0, right: 0 } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = zero_size', r.reason === 'zero_size');

    // height === 0
    const r2 = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ rect: { x: 0, y: 0, width: 600, height: 0, top: 0, bottom: 0, left: 0, right: 600 } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('height === 0 también es zero_size', r2.ok === false && r2.reason === 'zero_size');
}

// ───────────────────────────────────────────────────────────────────────────
// V9 — rect fuera del container → outside_viewport
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V9] elemento totalmente arriba del container → outside_viewport');
{
    // Container top=0 bottom=600. Elemento bottom=-50 (totalmente arriba).
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ rect: { x: 100, y: -150, width: 600, height: 100, top: -150, bottom: -50, left: 100, right: 700 } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = outside_viewport', r.reason === 'outside_viewport');

    // Totalmente abajo
    const r2 = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ rect: { x: 100, y: 700, width: 600, height: 100, top: 700, bottom: 800, left: 100, right: 700 } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('totalmente abajo también es outside_viewport', r2.ok === false && r2.reason === 'outside_viewport');
}

// ───────────────────────────────────────────────────────────────────────────
// V10 — centro fuera del 5%-95% → outside_active_band
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V10] centro vertical en 1% del container → outside_active_band');
{
    // Container 0-600. Banda activa = [30, 570]. Elemento centrado en y=10.
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ rect: { x: 100, y: 0, width: 600, height: 20, top: 0, bottom: 20, left: 100, right: 700 } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    // El centro está en y=10 (dentro del container pero fuera del 5%-95%=[30,570])
    // Pero ojo: el rect SE SOLAPA con el container (0-20 ⊂ 0-600), así que NO es outside_viewport.
    ok('ok = false', r.ok === false, `reason=${r.reason}`);
    ok('reason = outside_active_band', r.reason === 'outside_active_band');
    ok('metrics.centerInActiveBand = false', r.metrics.centerInActiveBand === false);
}

// ───────────────────────────────────────────────────────────────────────────
// V11 — falta className 'immersive-sentence-active' → missing_active_class
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V11] className sin "immersive-sentence-active" → missing_active_class');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ className: 'immersive-sentence-item py-8 px-8 text-center' })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = missing_active_class', r.reason === 'missing_active_class');

    // Variante: clase contiene substring "active" pero no como token completo
    const r2 = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ className: 'immersive-sentence-active-sibling text-center' })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('substring "active" pero no token exacto NO satisface', r2.ok === false && r2.reason === 'missing_active_class');
}

// ───────────────────────────────────────────────────────────────────────────
// V12 — color === backgroundColor → contrast_suspect
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V12] color === backgroundColor → contrast_suspect');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl({ style: { opacity: '1', visibility: 'visible', display: 'block', color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(0, 0, 0)' } })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = false', r.ok === false);
    ok('reason = contrast_suspect', r.reason === 'contrast_suspect');
}

// ───────────────────────────────────────────────────────────────────────────
// V13 — todo OK → ok:true con metrics completas
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[V13] elemento sano → ok:true con metrics completas');
{
    const r = validateActiveSentenceVisibility({
        expectedIndex: 45,
        activeEls: [makeHealthyEl()],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('ok = true', r.ok === true);
    ok('reason = undefined', r.reason === undefined);
    ok('metrics.count = 1', r.metrics.count === 1);
    ok('metrics.domIdx = 45', r.metrics.domIdx === 45);
    ok('metrics.textLength > 0', r.metrics.textLength > 0);
    ok('metrics.rect existe', r.metrics.rect !== null);
    ok('metrics.containerRect existe', r.metrics.containerRect !== null);
    ok('metrics.opacity = 1', r.metrics.opacity === 1);
    ok('metrics.visibility = visible', r.metrics.visibility === 'visible');
    ok('metrics.display = block', r.metrics.display === 'block');
    ok('metrics.className incluye immersive-sentence-active',
       r.metrics.className.includes('immersive-sentence-active'));
    ok('metrics.centerInActiveBand = true', r.metrics.centerInActiveBand === true);
    ok('metrics.centerDistanceFromContainerCenter calculado',
       Number.isFinite(r.metrics.centerDistanceFromContainerCenter));
}

// ───────────────────────────────────────────────────────────────────────────
// EXTRA — ack RECHAZA aún cuando attrs son OK (regression del bug F8)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresión F8] DOM contract OK pero invisible → ack RECHAZADO');
{
    // Caso real reportado: data-active-sentence=true + index correcto, pero
    // el elemento está fuera del overflow-hidden y el usuario no lo ve.
    const r = validateActiveSentenceVisibility({
        expectedIndex: 72,
        activeEls: [makeHealthyEl({
            attrs: { 'data-sentence-index': '72' },
            rect: { x: 100, y: 700, width: 600, height: 100, top: 700, bottom: 800, left: 100, right: 700 },
        })],
        containerEl: baseContainer,
        getStyle: makeStyleGetter(),
    });
    ok('Elemento fuera del container → ack RECHAZADO',
       r.ok === false);
    ok('reason específico (outside_viewport o outside_active_band)',
       r.reason === 'outside_viewport' || r.reason === 'outside_active_band');
}

// ───────────────────────────────────────────────────────────────────────────
// Constantes default expuestas
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[internals] constantes por default');
ok('DEFAULT_REQUIRED_CLASS === "immersive-sentence-active"',
   _internals.DEFAULT_REQUIRED_CLASS === 'immersive-sentence-active');
ok('DEFAULT_MIN_OPACITY === 0.65',
   _internals.DEFAULT_MIN_OPACITY === 0.65);

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
