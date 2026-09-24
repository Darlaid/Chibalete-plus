/**
 * a11yAutoAdvance.test.mjs — CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 Fase 1.
 *
 * Regresión CONDUCTUAL: ejecuta los hooks REALES `useA11yReaderNavigation` y
 * `useA11yAutoAdvance` juntos (bundleados con esbuild) sobre un shim de React
 * con re-render, efectos con deps y cleanups, un DOM mínimo simulado y un
 * reloj virtual. Nada de esto toca red ni stores.
 *
 *   A1  <120 min → LOCKED (y si la consulta falla, también).
 *   A2  ≥120 min → AVAILABLE_OFF.
 *   A3  desbloquear no enciende nada.
 *   A4  toggle → ACTIVE.
 *   A5  3+ observaciones manuales → espera por la mediana personal.
 *   A6  mínimo 8 s.   A7  máximo 180 s.
 *   A8  el avance automático pasa al siguiente segmento (mismo scroll).
 *   A9  el avance automático NO mueve el foco ni anuncia "Sección X de Y".
 *   A10 la navegación manual reinicia el reloj.
 *   A11 pestaña oculta congela el reloj.   A12 ventana sin foco, igual.
 *   A13 10 avances sin interacción → OFF + aviso único, sin reactivarse.
 *   A14 una interacción humana reinicia la vigilancia.
 *   A15 fin del libro → OFF + aviso, sin bucle.
 *   A16 cada apertura arranca en OFF; nada se persiste.
 *   +   núcleo puro (mediana, ventana de 5, límites de observación).
 *
 * Correr:  node hooks/__tests__/a11yAutoAdvance.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ''}`); fail++; }
}
const section = (t) => console.log(`\n${t}`);

// ── Shim de React: re-render síncrono, deps, cleanups ────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-autoadv-'));
const shimPath = path.join(tmp, 'react-shim.mjs');
fs.writeFileSync(shimPath, `
let hooks = [], hi = 0, queue = [], flushing = false, dirty = false, comp = null, props = null, out = null;
const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
function render() {
    if (flushing) { dirty = true; return; }
    flushing = true;
    let n = 0;
    try {
        do {
            dirty = false; hi = 0; queue = [];
            out = comp(props);
            for (const e of queue) { if (e.slot.cleanup) e.slot.cleanup(); const c = e.fn(); e.slot.cleanup = typeof c === 'function' ? c : null; }
            if (++n > 200) throw new Error('render loop');
        } while (dirty);
    } finally { flushing = false; }
}
export function __mount(c, p) { __unmount(); comp = c; props = p; render(); return () => out; }
export function __unmount() { for (const h of hooks) if (h && h.kind === 'effect' && h.cleanup) { h.cleanup(); h.cleanup = null; } hooks = []; }
export function useState(init) {
    const i = hi++;
    if (!hooks[i]) hooks[i] = { v: typeof init === 'function' ? init() : init };
    const slot = hooks[i];
    const set = (nv) => { const v = typeof nv === 'function' ? nv(slot.v) : nv; if (!Object.is(v, slot.v)) { slot.v = v; render(); } };
    return [slot.v, set];
}
export function useRef(v) { const i = hi++; if (!hooks[i]) hooks[i] = { current: v }; return hooks[i]; }
export function useMemo(fn, deps) { const i = hi++; const s = hooks[i]; if (!s || changed(s.deps, deps)) hooks[i] = { v: fn(), deps }; return hooks[i].v; }
export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
export function useEffect(fn, deps) {
    const i = hi++;
    if (!hooks[i]) hooks[i] = { kind: 'effect', deps: undefined, cleanup: null, ran: false };
    const s = hooks[i];
    if (!s.ran || !deps || changed(s.deps, deps)) { s.ran = true; s.deps = deps; queue.push({ fn, slot: s }); }
}
export const useLayoutEffect = useEffect;
export default { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect };
`);
const entryPath = path.join(tmp, 'entry.mjs');
const rel = (p) => JSON.stringify(path.join(ROOT, p).replace(/\\/g, '/'));
fs.writeFileSync(entryPath, `
export { useA11yReaderNavigation } from ${rel('hooks/useA11yReaderNavigation.ts')};
export { useA11yAutoAdvance, AUTO_ADVANCE_END_MESSAGE, AUTO_ADVANCE_INACTIVITY_MESSAGE, MY_EFFECTIVE_TIME_PATH } from ${rel('hooks/useA11yAutoAdvance.ts')};
export * as core from ${rel('utils/a11yAutoAdvance.mjs')};
export { __mount, __unmount } from ${JSON.stringify(shimPath.replace(/\\/g, '/'))};
`);
const bundlePath = path.join(tmp, 'bundle.mjs');
await esbuild.build({
    entryPoints: [entryPath], bundle: true, format: 'esm', platform: 'neutral',
    mainFields: ['module', 'main'], outfile: bundlePath, alias: { react: shimPath },
    define: { 'import.meta.env': '{"DEV":false}' }, logLevel: 'silent',
});

// ── DOM mínimo + reloj virtual ───────────────────────────────────────────────
let vnow = 1_000_000;
Date.now = () => vnow;
const timers = new Map(); let tid = 0;
globalThis.setTimeout = (fn, ms) => { const id = ++tid; timers.set(id, { at: vnow + (ms || 0), fn }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
function advance(ms) {
    const target = vnow + ms;
    for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        vnow = next[1].at;
        next[1].fn();
    }
    vnow = target;
}

class FakeEl {
    constructor(id) { this.id = id; this.textContent = ''; this.focusCalls = 0; }
    focus() { this.focusCalls++; globalThis.document.activeElement = this; }
    getBoundingClientRect() { return { top: 300, height: 40 }; }
}
globalThis.HTMLElement = FakeEl;
const els = new Map();
const el = (id) => { if (!els.has(id)) els.set(id, new FakeEl(id)); return els.get(id); };
const winL = new Map(), docL = new Map();
const addL = (m) => (t, fn) => { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(fn); };
const remL = (m) => (t, fn) => { m.get(t)?.delete(fn); };
const fire = (m, t) => { for (const fn of [...(m.get(t) ?? [])]) fn({ type: t }); };
globalThis.window = globalThis;
globalThis.addEventListener = addL(winL);
globalThis.removeEventListener = remL(winL);
globalThis.innerHeight = 800;
globalThis.scrollY = 0;
let scrollCalls = 0;
globalThis.scrollTo = () => { scrollCalls++; };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = (fn) => { fn(0); return 1; };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
const lsWrites = [];
globalThis.localStorage = { getItem: () => null, setItem: (k) => lsWrites.push(k), removeItem: () => {} };
globalThis.document = {
    visibilityState: 'visible', _focus: true, activeElement: null,
    hasFocus() { return this._focus; },
    getElementById: (id) => el(id),
    addEventListener: addL(docL), removeEventListener: remL(docL),
};
let unlockResponse = { ok: true, body: { effectiveReadingMs: 130 * 60_000, autoAdvanceUnlocked: true } };
const fetchCalls = [];
globalThis.fetch = (url, opts) => {
    fetchCalls.push({ url, opts });
    const r = unlockResponse;
    if (r === 'reject') return Promise.reject(new Error('network'));
    return Promise.resolve({ ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body });
};

const M = await import(pathToFileURL(bundlePath).href);
const { core } = M;

// ── Libro de prueba: 1 párrafo por segmento ──────────────────────────────────
function makeBook(words) {
    const half = Math.ceil(words.length / 2);
    const chapters = [0, 1].map(ci => ({
        id: `chap-${ci}`, heading: { text: `Capítulo ${ci + 1}` },
        sections: [{ paragraphs: words.slice(ci * half, (ci + 1) * half).map((_, k) => ({ id: `p-${ci}-0-${k}`, text: 'x' })) }],
    })).filter(c => c.sections[0].paragraphs.length > 0);
    const segments = [];
    chapters.forEach((ch, ci) => ch.sections[0].paragraphs.forEach((p, k) => {
        segments.push({ id: `seg-${p.id}`, paragraphIds: [p.id], estimatedWords: words[ci * half + k], chapterIndex: ci, oversize: false });
    }));
    return { book: { contentId: 'c-1', language: 'es', title: 'T', chapters, totalParagraphs: words.length }, segments };
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const announcer = () => el('a11y-announcer-polite').textContent;

async function mount(words, { unlock = true } = {}) {
    timers.clear(); winL.clear(); docL.clear(); els.clear();
    document.visibilityState = 'visible'; document._focus = true; document.activeElement = null;
    unlockResponse = unlock === 'reject' ? 'reject'
        : unlock === 'error' ? { ok: false, body: null }
        : { ok: true, body: { effectiveReadingMs: unlock ? 130 * 60_000 : 60 * 60_000, autoAdvanceUnlocked: !!unlock } };
    const { book, segments } = makeBook(words);
    const App = (p) => {
        const nav = M.useA11yReaderNavigation(p.book, p.segments);
        const aa = M.useA11yAutoAdvance({ userId: p.userId, navigation: nav, segments: p.segments });
        return { nav, aa };
    };
    const get = M.__mount(App, { book, segments, userId: 'lec-1' });
    await flush();
    advance(600);   // pasa el guard programático inicial del hook de navegación
    return {
        get,
        status: () => get().aa.status,
        seg: () => get().nav.currentSegmentIndex,
        human: (type = 'pointerdown') => fire(winL, type),
        toggle() { fire(winL, 'pointerdown'); get().aa.toggle(); },
        manualNext() { fire(winL, 'pointerdown'); get().nav.goToNextSegment(); },
    };
}

/** Avanza `ms-1` (sin cambio) y luego 1 ms (cambio): la espera es EXACTAMENTE ms. */
function expectAdvanceAfter(h, ms, label) {
    const before = h.seg();
    advance(ms - 1);
    const still = h.seg() === before;
    advance(1);
    ok(label, still && h.seg() === before + 1, `still=${still} seg ${before}→${h.seg()}`);
}

const W = (n, w = 100) => Array.from({ length: n }, () => w);

try {
    section('[CORE] modelo de ritmo');
    {
        let obs = [];
        for (const d of [60_000, 30_000, 120_000, 60_000, 60_000, 90_000]) obs = core.pushObservation(obs, { words: 100, durationMs: d });
        ok('ventana: solo las últimas 5', obs.length === 5 && obs[0].durationMs === 30_000);
        ok('mediana de ppm (100/0.5,100/2,100/1,100/1,100/1.5 → 100)', core.personalWpm(obs).wpm === 100, core.personalWpm(obs).wpm);
        ok('< 3 observaciones → respaldo', core.personalWpm(obs.slice(0, 2)).source === 'fallback');
        ok('observación < 3 s se descarta', core.pushObservation([], { words: 100, durationMs: 2_999 }).length === 0);
        ok('observación > 300 s se descarta', core.pushObservation([], { words: 100, durationMs: 300_001 }).length === 0);
        ok('3 s y 300 s exactos se aceptan',
            core.pushObservation([], { words: 1, durationMs: 3_000 }).length === 1 && core.pushObservation([], { words: 1, durationMs: 300_000 }).length === 1);
        ok('exactamente tres estados',
            core.deriveAutoAdvanceStatus({ unlocked: false, enabled: true }) === 'LOCKED'
            && core.deriveAutoAdvanceStatus({ unlocked: true, enabled: false }) === 'AVAILABLE_OFF'
            && core.deriveAutoAdvanceStatus({ unlocked: true, enabled: true }) === 'ACTIVE');
        ok('umbral de desbloqueo = 120 min', core.AUTO_ADVANCE_UNLOCK_MS === 7_200_000);
        ok('límite de inactividad = 10', core.INACTIVITY_LIMIT === 10 && core.inactivityLimitReached(10) && !core.inactivityLimitReached(9));
    }

    section('[A1–A4] estados y opt-in');
    {
        let h = await mount(W(5), { unlock: false });
        ok('A1 <120 min → LOCKED', h.status() === 'LOCKED');
        h.toggle();
        ok('A1 toggle en LOCKED no hace nada', h.status() === 'LOCKED');
        ok('A1 consulta al endpoint propio, con credenciales y sin caché',
            fetchCalls.at(-1)?.url === M.MY_EFFECTIVE_TIME_PATH && fetchCalls.at(-1)?.opts?.credentials === 'include' && fetchCalls.at(-1)?.opts?.cache === 'no-store');
        h = await mount(W(5), { unlock: 'error' });
        ok('A1 endpoint 5xx → LOCKED (fail-closed)', h.status() === 'LOCKED');
        h = await mount(W(5), { unlock: 'reject' });
        ok('A1 red caída → LOCKED (fail-closed)', h.status() === 'LOCKED');

        h = await mount(W(5));
        ok('A2 ≥120 min → AVAILABLE_OFF', h.status() === 'AVAILABLE_OFF');
        const s0 = h.seg(), sc0 = scrollCalls;
        advance(10 * 60_000);
        ok('A3 desbloqueado no se activa solo (10 min sin moverse)', h.status() === 'AVAILABLE_OFF' && h.seg() === s0 && scrollCalls === sc0);
        h.toggle();
        ok('A4 toggle → ACTIVE', h.status() === 'ACTIVE');
        h.toggle();
        ok('A4 toggle otra vez → AVAILABLE_OFF', h.status() === 'AVAILABLE_OFF');
    }

    section('[A5–A7] espera por segmento');
    {
        let h = await mount(W(8));
        h.toggle();
        expectAdvanceAfter(h, 75_000, 'sin historia: 100 palabras a 80 ppm (respaldo) → 75 s');

        h = await mount(W(8));
        for (let i = 0; i < 3; i++) { advance(60_000); h.manualNext(); }
        ok('3 avances manuales registrados', h.seg() === 3);
        h.toggle();
        expectAdvanceAfter(h, 60_000, 'A5 mediana personal: 100 palabras en 60 s → 100 ppm → 60 s');

        h = await mount([5, 5, 5]);
        h.toggle();
        expectAdvanceAfter(h, 8_000, 'A6 segmento de 5 palabras → mínimo 8 s');

        h = await mount([1000, 1000, 1000]);
        h.toggle();
        expectAdvanceAfter(h, 180_000, 'A7 segmento de 1000 palabras → máximo 180 s');
    }

    section('[A8–A9] navegación automática = navegación existente, sin foco');
    {
        const h = await mount(W(6));
        h.toggle();
        const focusBefore = [...els.values()].reduce((n, e) => n + e.focusCalls, 0);
        const scrollBefore = scrollCalls;
        advance(75_000);
        advance(100);  // deja correr el setTimeout(50) de cualquier anuncio
        ok('A8 auto → siguiente segmento', h.seg() === 1);
        ok('A8 mismo scroll que el botón (window.scrollTo)', scrollCalls > scrollBefore);
        const focusAfter = [...els.values()].reduce((n, e) => n + e.focusCalls, 0);
        ok('A9 auto no mueve el foco', focusAfter === focusBefore && document.activeElement === null);
        ok('A9 auto no anuncia "Sección X de Y"', !/Sección/.test(announcer()), announcer());
        h.manualNext();
        advance(100);
        ok('contrato manual intacto: foco al párrafo + anuncio', el('p-0-0-2').focusCalls === 1 && /^Sección 3 de 6$/.test(announcer()), announcer());
    }

    section('[A10] la navegación manual reinicia el reloj');
    {
        const h = await mount(W(8));
        h.toggle();
        advance(50_000);
        h.manualNext();
        ok('manual durante ACTIVE navega', h.seg() === 1 && h.status() === 'ACTIVE');
        expectAdvanceAfter(h, 75_000, 'la espera vuelve a empezar completa desde el nuevo segmento');
        advance(10_000);
        h.human(); h.get().nav.goToNextChapter();
        ok('cambio de capítulo navega', h.seg() === 4, h.seg());
        expectAdvanceAfter(h, 75_000, 'cambio de capítulo también reinicia el reloj');
        advance(20_000);
        h.human(); h.get().nav.goToChapterById('chap-0');
        ok('selección desde el índice navega', h.seg() === 0, h.seg());
        expectAdvanceAfter(h, 75_000, 'selección desde el índice reinicia el reloj');
    }

    section('[A11–A12] segundo plano: el reloj se congela');
    {
        let h = await mount(W(6));
        h.toggle();
        advance(30_000);
        document.visibilityState = 'hidden'; fire(docL, 'visibilitychange');
        advance(600_000);
        ok('A11 10 min con la pestaña oculta → ningún avance', h.seg() === 0 && h.status() === 'ACTIVE');
        document.visibilityState = 'visible'; fire(docL, 'visibilitychange');
        expectAdvanceAfter(h, 45_000, 'A11 al volver, reanuda con el tiempo restante (45 s)');

        h = await mount(W(6));
        h.toggle();
        advance(30_000);
        document._focus = false; fire(winL, 'blur');
        advance(600_000);
        ok('A12 10 min con la ventana sin foco → ningún avance', h.seg() === 0);
        document._focus = true; fire(winL, 'focus');
        expectAdvanceAfter(h, 45_000, 'A12 al recuperar el foco, reanuda con el tiempo restante');
    }

    section('[A13–A14] vigilancia de inactividad');
    {
        let h = await mount(W(30));
        h.toggle();
        for (let i = 0; i < 10; i++) advance(75_000);
        advance(100);
        ok('A13 10 avances sin interacción → AVAILABLE_OFF', h.seg() === 10 && h.status() === 'AVAILABLE_OFF', `seg=${h.seg()} ${h.status()}`);
        ok('A13 aviso de inactividad', announcer() === M.AUTO_ADVANCE_INACTIVITY_MESSAGE, announcer());
        document.visibilityState = 'hidden'; fire(docL, 'visibilitychange');
        document.visibilityState = 'visible'; fire(docL, 'visibilitychange');
        fire(winL, 'blur'); fire(winL, 'focus'); fire(winL, 'scroll');
        advance(600_000);
        ok('A13 no se reactiva con scroll/foco/visibilidad', h.seg() === 10 && h.status() === 'AVAILABLE_OFF');

        h = await mount(W(30));
        h.toggle();
        for (let i = 0; i < 9; i++) advance(75_000);
        h.human('keydown');
        for (let i = 0; i < 9; i++) advance(75_000);
        ok('A14 una interacción humana reinicia el contador (18 avances y sigue ACTIVE)',
            h.seg() === 18 && h.status() === 'ACTIVE', `seg=${h.seg()} ${h.status()}`);
        advance(75_000);
        ok('A14 …y el décimo desde la interacción apaga', h.seg() === 19 && h.status() === 'AVAILABLE_OFF', `seg=${h.seg()} ${h.status()}`);
    }

    section('[A15] fin del libro');
    {
        const h = await mount(W(3));
        h.toggle();
        advance(75_000); advance(75_000);
        ok('llega al último segmento', h.seg() === 2);
        advance(75_000);
        advance(100);
        ok('A15 fin → AVAILABLE_OFF', h.status() === 'AVAILABLE_OFF');
        ok('A15 aviso de fin', announcer() === M.AUTO_ADVANCE_END_MESSAGE, announcer());
        advance(600_000);
        ok('A15 sin bucle ni vuelta al inicio', h.seg() === 2);
    }

    section('[A16] cada apertura arranca en OFF, nada se persiste');
    {
        let h = await mount(W(4));
        h.toggle();
        ok('abierto y encendido', h.status() === 'ACTIVE');
        M.__unmount();
        ok('al desmontar no queda ninguna espera', timers.size === 0, timers.size);
        h = await mount(W(4));
        ok('A16 nueva apertura → AVAILABLE_OFF', h.status() === 'AVAILABLE_OFF');
        ok('A16 ninguna escritura en localStorage', lsWrites.length === 0, lsWrites.join(','));
        const src = fs.readFileSync(path.join(ROOT, 'hooks', 'useA11yAutoAdvance.ts'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        ok('A16 el hook no usa localStorage/sessionStorage', !/localStorage|sessionStorage|indexedDB/.test(code));
        ok('A16 useState(false) para ON/OFF', /useState<boolean>\(false\)/.test(code));
    }
} finally {
    M.__unmount();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\nCHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 (hooks) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
