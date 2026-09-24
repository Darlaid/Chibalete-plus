/**
 * immersiveResumeSentenceTtsSync.test.mjs — CHP-MAINT-IMMERSIVE-AUDIO-TEXT-SYNC-01 Fase 1.
 *
 * Regresión CONDUCTUAL (no estructural): ejecuta el hook real
 * `useImmersivePlayback` (bundleado con esbuild, React reemplazado por un shim
 * de un solo render) contra elementos <audio> simulados, `fetch` simulado y un
 * reloj virtual. Cada blob de audio queda etiquetado como «TTS de la frase N»
 * o «MP3 del chunk K», así que el test sabe qué suena en cada instante y lo
 * compara con la frase resaltada.
 *
 * Bug reproducido (Fase 0, sesión real 20218–20234): al reanudar en la frase
 * 41 (chunk 2 = frases 26..43) el audio es TTS de UNA frase, pero el executor
 * por-chunk repartía su duración entre 41..43 → 42/43 resaltadas sin sonar y
 * `handleEnded` saltaba a 44. Además `chunkKey !== index` forzaba TTS de frase
 * al reanudar justo en el inicio de un chunk.
 *
 * Casos:
 *   A  resume a mitad de chunk: durante el audio de 41 solo se resalta 41.
 *   B  secuencia contigua 41 → 42 → 43, cada una con su propio audio.
 *   C  resume en el inicio de chunk (44): MP3 del chunk, sin TTS, executor activo.
 *   D  inicio normal (0): MP3 del chunk y activaciones = timeline heurística.
 *   E  TTS de la última frase del chunk → MP3 del chunk siguiente, sin salto ni duplicado.
 *   F  pause/resume dentro del mismo audio: currentTime conserva autoridad.
 *
 * Correr:  node hooks/__tests__/immersiveResumeSentenceTtsSync.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { buildHeuristicTimeline } from '../../utils/syncStrategyExecutor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

// ── Bundle del hook real con un shim de React ────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-resume-sync-'));
const shimPath = path.join(tmp, 'react-shim.mjs');
fs.writeFileSync(shimPath, `
export function useRef(v) { return { current: v }; }
export function useState(v) { const s = [typeof v === 'function' ? v() : v, () => {}]; return s; }
export function useCallback(fn) { return fn; }
export function useMemo(fn) { return fn(); }
export const __effects = [];
export function useEffect(fn) { __effects.push(fn); }
export function useLayoutEffect(fn) { __effects.push(fn); }
export default { useRef, useState, useCallback, useMemo, useEffect, useLayoutEffect };
`);
const bundlePath = path.join(tmp, 'useImmersivePlayback.bundle.mjs');
await esbuild.build({
    entryPoints: [path.join(ROOT, 'hooks', 'useImmersivePlayback.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    outfile: bundlePath,
    alias: { react: shimPath },
    define: { 'import.meta.env': '{"DEV":false}' },
    logLevel: 'silent',
});

// ── Entorno de navegador mínimo ──────────────────────────────────────────────
const memStore = new Map();
globalThis.window = globalThis;
if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
}
globalThis.localStorage = {
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)),
    removeItem: (k) => memStore.delete(k),
};

let vnow = 1_800_000_000_000;
const realDateNow = Date.now;
Date.now = () => vnow;

const logs = [];
const origConsole = { log: console.log, warn: console.warn, debug: console.debug, info: console.info, error: console.error };
function muteConsole() {
    for (const k of ['log', 'warn', 'debug', 'info', 'error']) console[k] = (...a) => logs.push(a);
}
function unmuteConsole() { Object.assign(console, origConsole); }

// Datos: longitudes reales de frase de los chunks 0..3 del testigo de Fase 0.
const LENS = [
    [53, 29, 41, 281, 43, 309, 127, 14, 15, 135, 280, 77],
    [93, 103, 127, 170, 103, 135, 294, 111, 43, 98, 41, 20, 27, 79],
    [59, 60, 252, 210, 24, 58, 81, 23, 188, 54, 109, 28, 59, 68, 20, 77, 47, 22],
    [59, 15, 37, 117, 48, 138, 29, 43, 101, 194, 28, 7, 63, 93, 97, 182, 76, 103],
    [59, 15, 37, 117, 48, 138, 29, 43, 101, 194, 28, 7, 63, 93, 97, 182, 76, 103],
];
const sentences = [];
const sentenceToChunk = [];
const manifest = { _meta: { version: 2, splitVersion: 1 } };
LENS.forEach((lens, k) => {
    const chunkSentences = [];
    lens.forEach((len) => {
        const idx = sentences.length;
        const head = `S${idx}| palabra`;
        const s = (head + ' palabra'.repeat(Math.ceil(len / 8))).slice(0, Math.max(len, head.length + 8));
        sentences.push(s);
        chunkSentences.push(s);
        sentenceToChunk.push(k);
    });
    manifest[String(k)] = {
        index: k, file: `audio/content-test/chunk_${k}.mp3`,
        sentences: chunkSentences, sentenceStart: sentenceToChunk.indexOf(k),
    };
});
const CHARS_PER_SEC = 16;
const ttsDur = (idx) => Math.max(1.5, sentences[idx].length / CHARS_PER_SEC);
const chunkDur = (k) => manifest[String(k)].sentences.reduce((a, s) => a + s.length, 0) / CHARS_PER_SEC;
const firstOfChunk = (k) => sentenceToChunk.indexOf(k);

// Audio etiquetado: blob → unidad → URL.
const blobTags = new WeakMap();
const srcInfo = new Map();
let urlSeq = 0;
URL.createObjectURL = (blob) => {
    const tag = blobTags.get(blob) ?? { kind: 'unknown', dur: 1 };
    const url = `blob:${tag.kind}-${tag.kind === 'tts' ? tag.idx : tag.key}-${++urlSeq}`;
    srcInfo.set(url, tag);
    return url;
};
URL.revokeObjectURL = () => {};

let ttsRequests = [];
function audioResponse(tag) {
    return {
        ok: true, status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
        blob: async () => { const b = new Blob(['x'.repeat(64)]); blobTags.set(b, tag); return b; },
        json: async () => ({}), text: async () => '',
    };
}
globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/tts')) {
        const text = JSON.parse(opts.body || '{}').text || '';
        const m = /^S(\d+)\|/.exec(text);
        const idx = m ? Number(m[1]) : -1;
        ttsRequests.push(idx);
        return audioResponse({ kind: 'tts', idx, dur: ttsDur(idx) });
    }
    const cm = /chunk_(\d+)\.mp3/.exec(u);
    if (cm) { const key = Number(cm[1]); return audioResponse({ kind: 'chunk', key, dur: chunkDur(key) }); }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '', blob: async () => new Blob([]) };
};

let plays = [];
class FakeAudio extends EventTarget {
    constructor(name) {
        super();
        this.name = name; this._src = ''; this.currentTime = 0; this.duration = NaN;
        this.paused = true; this.readyState = 0; this.playbackRate = 1; this.error = null;
        this.networkState = 0; this.ended = false; this.preload = 'auto';
    }
    get src() { return this._src; }
    set src(v) {
        this._src = v || '';
        this.currentTime = 0; this.paused = true; this.ended = false;
        const info = srcInfo.get(this._src);
        this.duration = info ? info.dur : NaN;
        this.readyState = info ? 4 : 0;
        if (info) {
            queueMicrotask(() => {
                this.dispatchEvent(new Event('loadedmetadata'));
                this.dispatchEvent(new Event('canplay'));
                this.dispatchEvent(new Event('canplaythrough'));
            });
        }
    }
    load() { const s = this._src; this.src = s; }
    play() {
        if (!this._src || !srcInfo.has(this._src)) return Promise.reject(new DOMException('no src', 'NotSupportedError'));
        this.paused = false;
        plays.push({ el: this.name, info: srcInfo.get(this._src), at: this.currentTime });
        return Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute(n) { if (n === 'src') this._src = ''; }
    canPlayType() { return 'probably'; }
}

const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// ── Instancia del hook ───────────────────────────────────────────────────────
async function mountHook() {
    const shim = await import(pathToFileURL(shimPath).href);
    shim.__effects.length = 0;
    const { useImmersivePlayback } = await import(pathToFileURL(bundlePath).href);
    const highlights = [];
    const ref = (v) => ({ current: v });
    let pbRef = null;
    const ctx = {
        sentencesRef: ref(sentences),
        audioSentencesRef: ref(sentences),
        manifestRef: ref(manifest),
        toChunkRef: ref(sentenceToChunk),
        anchorsMapRef: ref({}),
        audioModeRef: ref('perChunkNoAnchors'),
        speedRef: ref(1),
        userIdRef: ref('user-test'),
        unmountedRef: ref(false),
        onIndexChange: ref((idx) => {
            highlights.push(idx);
            // El visor ack-ea tras pintar (useLayoutEffect).
            queueMicrotask(() => { try { pbRef?.acknowledgeVisualHighlight(idx); } catch { /* noop */ } });
        }),
        onSessionEnd: ref(() => {}),
        onPlayChange: ref(() => {}),
        contentIdRef: ref('content-test'),
    };
    const pb = useImmersivePlayback(ctx);
    pbRef = pb;
    for (const fx of shim.__effects.splice(0)) { try { fx(); } catch { /* efectos de montaje no críticos */ } }
    const A = new FakeAudio('A');
    const B = new FakeAudio('B');
    pb.audioRefA.current = A;
    pb.audioRefB.current = B;
    return { pb, ctx, A, B, highlights, unmount: () => { ctx.unmountedRef.current = true; } };
}

const lastHighlight = (h) => (h.length ? h[h.length - 1] : null);
function playing(A, B) { return [A, B].find((e) => !e.paused && e._src) ?? null; }
function unitLabel(info) { return info ? `${info.kind}:${info.kind === 'tts' ? info.idx : info.key}` : 'none'; }

/**
 * Reproduce el audio activo hasta `untilSec` (o el final). Devuelve muestras
 * { unit, t, highlight }. Si llega al final emula el orden del navegador:
 * paused=true → onEnded de React (handleEnded) → listeners 'ended' (executor).
 */
async function playActive(h, { untilSec = Infinity, stepSec = 0.25 } = {}) {
    const { pb, A, B, highlights } = h;
    const el = playing(A, B);
    if (!el) return { samples: [], ended: false, el: null };
    const info = srcInfo.get(el._src);
    const samples = [];
    const limit = Math.min(el.duration, untilSec);
    while (el.currentTime + stepSec < limit) {
        el.currentTime = Math.round((el.currentTime + stepSec) * 1000) / 1000;
        vnow += stepSec * 1000;
        el.dispatchEvent(new Event('timeupdate'));
        await Promise.resolve();
        samples.push({ unit: unitLabel(info), t: el.currentTime, highlight: lastHighlight(highlights) });
    }
    if (untilSec < el.duration) return { samples, ended: false, el };
    vnow += Math.max(0, (el.duration - el.currentTime) * 1000);
    el.currentTime = el.duration;
    el.dispatchEvent(new Event('timeupdate'));
    samples.push({ unit: unitLabel(info), t: el.currentTime, highlight: lastHighlight(highlights) });
    el.paused = true;
    el.ended = true;
    const slot = el === A ? 'A' : 'B';
    const p = pb.handleEnded(slot);
    el.dispatchEvent(new Event('ended'));
    await p;
    await settle(1200);
    return { samples, ended: true, el };
}

function resetRecorders() { plays = []; ttsRequests = []; logs.length = 0; }

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nimmersiveResumeSentenceTtsSync — resume con TTS de frase fuera del sync por-chunk');
muteConsole();
const results = {};
try {
    // ── A + B + E + F(tts): resume en 41 (mitad del chunk 2) ─────────────────
    resetRecorders();
    let h = await mountHook();
    await h.pb.load(41, true, { anchorFirstAudio: true, reason: 'first_play_after_resume' });
    await settle(60);
    const units = [];
    const perUnit = [];
    for (let step = 0; step < 4; step++) {
        const el = playing(h.A, h.B);
        if (!el) break;
        const info = srcInfo.get(el._src);
        units.push(unitLabel(info));
        let samples = [];
        if (step === 1) {
            // F — pause/resume a mitad del TTS de 42.
            const half = await playActive(h, { untilSec: el.duration / 2 });
            const tBefore = el.currentTime;
            h.pb.pause(); await settle(30);
            const playsBefore = plays.length;
            await h.pb.resume(); await settle(60);
            results.fTts = {
                tBefore, tAfter: el.currentTime, sameSrc: srcInfo.get(el._src) === info,
                replayedUnits: plays.slice(playsBefore).map((p) => unitLabel(p.info)),
                highlightAfterResume: lastHighlight(h.highlights),
            };
            samples = half.samples;
        }
        if (step === 3) {
            // F — pause/resume a mitad del MP3 del chunk 3 (executor vivo).
            const first = await playActive(h, { untilSec: el.duration / 2 });
            const tBefore = el.currentTime;
            const hlBefore = lastHighlight(h.highlights);
            h.pb.pause(); await settle(30);
            const playsBefore = plays.length;
            await h.pb.resume(); await settle(60);
            const second = await playActive(h, { untilSec: el.duration * 0.9 });
            results.fChunk = {
                tBefore, tAfterResume: first.el ? el.currentTime : null, hlBefore,
                replayedUnits: plays.slice(playsBefore).map((p) => unitLabel(p.info)),
                highlightsSecondHalf: second.samples.map((s) => s.highlight),
            };
            perUnit.push({ unit: unitLabel(info), samples: [...first.samples, ...second.samples] });
            break;
        }
        const r = await playActive(h);
        perUnit.push({ unit: unitLabel(info), samples: [...samples, ...r.samples] });
    }
    results.resume41 = { units, perUnit, ttsRequests: [...ttsRequests], highlights: [...h.highlights] };
    h.unmount();

    // ── E: resume en la ÚLTIMA frase del chunk 2 (43) ────────────────────────
    resetRecorders();
    h = await mountHook();
    await h.pb.load(43, true, { anchorFirstAudio: true, reason: 'first_play_after_resume' });
    await settle(60);
    const eUnits = [];
    const eFirst = playing(h.A, h.B);
    eUnits.push(unitLabel(eFirst && srcInfo.get(eFirst._src)));
    const eRun = await playActive(h);
    const eNext = playing(h.A, h.B);
    eUnits.push(unitLabel(eNext && srcInfo.get(eNext._src)));
    results.last43 = { units: eUnits, samples43: eRun.samples, highlights: [...h.highlights], ttsRequests: [...ttsRequests] };
    h.unmount();

    // ── C: resume en el INICIO del chunk 3 (44) ──────────────────────────────
    resetRecorders();
    h = await mountHook();
    await h.pb.load(44, true, { anchorFirstAudio: true, reason: 'first_play_after_resume' });
    await settle(60);
    const cEl = playing(h.A, h.B);
    const cUnit = unitLabel(cEl && srcInfo.get(cEl._src));
    const cRun = await playActive(h, { untilSec: 30 });
    results.chunkStart44 = { unit: cUnit, ttsRequests: [...ttsRequests], highlights: [...h.highlights], samples: cRun.samples };
    h.unmount();

    // ── D: inicio normal en 0 ────────────────────────────────────────────────
    resetRecorders();
    h = await mountHook();
    await h.pb.load(0, true);
    await settle(60);
    const dEl = playing(h.A, h.B);
    const dUnit = unitLabel(dEl && srcInfo.get(dEl._src));
    const dRun = await playActive(h);
    results.normal0 = { unit: dUnit, ttsRequests: [...ttsRequests], samples: dRun.samples, highlights: [...h.highlights], nextUnit: unitLabel(playing(h.A, h.B) && srcInfo.get(playing(h.A, h.B)._src)) };
    h.unmount();
} finally {
    unmuteConsole();
}

// ── Aserciones ───────────────────────────────────────────────────────────────
const r41 = results.resume41;
console.log('\n[A] resume a mitad de chunk (41): solo se resalta la frase que suena');
ok('primer audio = TTS de la frase 41', r41.units[0] === 'tts:41', `units=${r41.units.join(',')}`);
const during41 = new Set(r41.perUnit[0]?.samples.map((s) => s.highlight));
ok('durante el audio de 41 solo se resalta 41 (no 42/43)',
   during41.size === 1 && during41.has(41), `highlights=${[...during41].join(',')}`);

console.log('\n[B] secuencia contigua 41 → 42 → 43, cada frase con su audio');
ok('segundo audio = TTS de 42', r41.units[1] === 'tts:42', `units=${r41.units.join(',')}`);
ok('tercer audio = TTS de 43', r41.units[2] === 'tts:43', `units=${r41.units.join(',')}`);
for (const k of [1, 2]) {
    const u = r41.perUnit[k];
    const idx = 41 + k;
    const hs = new Set(u?.samples.map((s) => s.highlight));
    ok(`durante el audio de ${idx} solo se resalta ${idx}`, hs.size === 1 && hs.has(idx), `highlights=${[...hs].join(',')}`);
}
const spokenTts = r41.units.filter((u) => u.startsWith('tts:')).map((u) => Number(u.slice(4)));
ok('ninguna frase suena dos veces', new Set(spokenTts).size === spokenTts.length, `tts=${spokenTts.join(',')}`);
ok('no se pide TTS para frases del chunk siguiente (≥44)', r41.ttsRequests.every((i) => i < 44), `tts=${r41.ttsRequests.join(',')}`);

console.log('\n[E] TTS de la última frase del chunk → MP3 del chunk siguiente');
ok('tras 43 suena el MP3 del chunk 3', r41.units[3] === 'chunk:3', `units=${r41.units.join(',')}`);
const firstChunk3 = r41.perUnit[3]?.samples[0]?.highlight;
ok('el MP3 del chunk 3 arranca resaltando 44 (sin salto ni duplicado)', firstChunk3 === 44, `highlight=${firstChunk3}`);
const hl41 = r41.highlights;
const expectedPrefix = [41, 42, 43, 44];
ok('orden de resaltado 41, 42, 43, 44 sin huecos',
   JSON.stringify(hl41.filter((i) => i <= 44).filter((v, i, a) => a.indexOf(v) === i)) === JSON.stringify(expectedPrefix),
   `highlights=${hl41.slice(0, 12).join(',')}`);
ok('resume en 43 (última del chunk): TTS de 43 y luego chunk 3',
   results.last43.units[0] === 'tts:43' && results.last43.units[1] === 'chunk:3', `units=${results.last43.units.join(',')}`);
ok('durante el TTS de 43 solo se resalta 43',
   results.last43.samples43.every((s) => s.highlight === 43), `hl=${[...new Set(results.last43.samples43.map((s) => s.highlight))].join(',')}`);

console.log('\n[C] resume en el inicio del chunk 3 (44)');
ok('usa el MP3 del chunk 3 (no TTS de frase)', results.chunkStart44.unit === 'chunk:3', `unit=${results.chunkStart44.unit}`);
ok('no se pide ningún TTS de frase', results.chunkStart44.ttsRequests.length === 0, `tts=${results.chunkStart44.ttsRequests.join(',')}`);
const cMax = Math.max(...results.chunkStart44.samples.map((s) => s.highlight));
ok('executor por-chunk activo: el resaltado avanza dentro del chunk', cMax > 44, `max=${cMax}`);

console.log('\n[D] inicio normal en 0 (sin cambios)');
ok('usa el MP3 del chunk 0', results.normal0.unit === 'chunk:0', `unit=${results.normal0.unit}`);
ok('no se pide TTS de frase', results.normal0.ttsRequests.length === 0, `tts=${results.normal0.ttsRequests.join(',')}`);
{
    const group = manifest['0'].sentences.map((s, i) => ({ absoluteSentenceIndex: i, localIndexInChunk: i, weight: s.length }));
    const timeline = buildHeuristicTimeline(group, chunkDur(0) * 1000);
    let worst = 0;
    for (const e of timeline) {
        const firstSeen = results.normal0.samples.find((s) => s.highlight >= e.absoluteSentenceIndex);
        if (!firstSeen) { worst = Infinity; break; }
        worst = Math.max(worst, Math.abs(firstSeen.t * 1000 - e.startMs));
    }
    ok('activaciones = timeline heurística (±300 ms)', worst <= 300, `peor desvío=${worst} ms`);
}
ok('al terminar el chunk 0 sigue el MP3 del chunk 1', results.normal0.nextUnit === 'chunk:1', `next=${results.normal0.nextUnit}`);

console.log('\n[F] pause/resume dentro del mismo audio');
const fT = results.fTts;
ok('TTS de 42: currentTime conservado tras resume', fT && fT.tAfter >= fT.tBefore && fT.sameSrc, JSON.stringify(fT));
ok('TTS de 42: resume no cambia de unidad de audio', fT && fT.replayedUnits.every((u) => u === 'tts:42'), JSON.stringify(fT?.replayedUnits));
ok('TTS de 42: el resaltado sigue en 42', fT && fT.highlightAfterResume === 42, JSON.stringify(fT));
const fC = results.fChunk;
ok('chunk 3: resume no reinicia el audio', fC && fC.tAfterResume >= fC.tBefore && fC.replayedUnits.every((u) => u === 'chunk:3'), JSON.stringify(fC && { t: [fC.tBefore, fC.tAfterResume], u: fC.replayedUnits }));
const fcH = fC?.highlightsSecondHalf ?? [];
ok('chunk 3: resaltado monótono tras resume (sin reinicio de secuencia)',
   !!fC && fcH.length > 0 && fcH.every((v, i) => i === 0 || v >= fcH[i - 1]) && fcH[0] >= fC.hlBefore,
   `hlBefore=${fC?.hlBefore} first=${fcH[0]}`);

Date.now = realDateNow;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
    if (process.env.DEBUG_RESUME_SYNC) console.log(JSON.stringify(results, null, 1).slice(0, 20000));
    process.exit(1);
}
process.exit(0);
