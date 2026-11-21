/**
 * ReadingContinuity65D1.test.mjs — V9 BI-65D-1 · fuentes de lectura y continuidad (cliente).
 *
 *   E  lector EPUB: cada guardado lleva su sesión de lectura (contrato de los demás visores); sin red, el guardado queda
 *      en la cola de reintentos EXISTENTE de la aplicación, con su forma y su clave por sesión
 *   W  visores web (dataService): una sesión POR OBRA (antes una por carga de la página, compartida por todos los libros);
 *      sin conexión, cada sesión espera en la cola por separado y se envía al volver la red; la cola adopta lo que dejó el
 *      lector EPUB y conserva siete días
 *   T  tablero e informe: quien lee sin telemetría no es «Inactivo» / «Sin datos»
 *
 *   node pages/__tests__/ReadingContinuity65D1.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 700)), fail++);
const section = (t) => console.log(`\n${t}`);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65d1_'));
const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(), _m: m }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

try {
    // ── E — lector EPUB ────────────────────────────────────────────────────────────────────────────────────────────
    section('[E] lector EPUB: sesión de lectura y cola de reintentos');
    const E = await import(pathToFileURL(path.join(ROOT, 'components/epub-reader/epubProgress.mjs')).href);
    let now = 1_000_000_000_000, ids = 0;
    const sess = E.createEpubReadingSession({ now: () => now, newId: () => `s${++ids}` });
    ok('sin avance del lector no hay sesión', sess.payload() === null);
    sess.touch(now); now += 4 * 60_000; sess.touch(now);
    const p1 = sess.payload();
    ok('dos avances con 4 min entre ellos = una sesión de 240 s, modo epub, con su fecha de inicio', p1.sessionId === 's1' && p1.durationSec === 240 && p1.mode === 'epub' && p1.startedAt === new Date(now - 240_000).toISOString(), JSON.stringify(p1));
    now += E.EPUB_SESSION_IDLE_MS + 1; sess.touch(now);
    ok('tras una pausa de más de 30 min empieza otra sesión (no se suma la pausa)', sess.payload().sessionId === 's2' && sess.payload().durationSec === 0, JSON.stringify(sess.payload()));

    const FP = `sha256:${'b'.repeat(64)}`;
    const sent = []; const timers = [];
    let t = 0;
    const saver = E.createEpubProgressSaver({ fingerprint: FP, initialCfi: null, now: () => t, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
        send: (body) => { sent.push(body); }, session: E.createEpubReadingSession({ now: () => t, newId: () => 'sx' }) });
    saver.onRelocate({ cfi: 'epubcfi(/6/2!/4/2)', sectionIndex: 0, fraction: 0 });   // apertura: no es avance
    saver.arm();
    t = 10_000; saver.onRelocate({ cfi: 'epubcfi(/6/4!/4/2)', sectionIndex: 1, fraction: 0.1 });
    t = 70_000; saver.onRelocate({ cfi: 'epubcfi(/6/4!/4/8)', sectionIndex: 1, fraction: 0.2 });
    saver.flush();
    ok('el guardado del EPUB lleva la sesión: inicio en el primer avance, 60 s, modo epub', sent.length === 1 && sent[0].session?.sessionId === 'sx' && sent[0].session.durationSec === 60
        && sent[0].session.mode === 'epub' && sent[0].session.startedAt === new Date(10_000).toISOString() && sent[0].canonicalProgress.epub.cfi === 'epubcfi(/6/4!/4/8)', JSON.stringify(sent[0]));
    const noSession = E.createEpubProgressSaver({ fingerprint: FP, now: () => t, setTimer: () => 1, clearTimer: () => {}, send: (b) => { sent.push(b); } });
    noSession.arm(); t = 80_000; noSession.onRelocate({ cfi: 'epubcfi(/6/8!/4/2)', sectionIndex: 3, fraction: 0.5 }); noSession.flush();
    ok('sin sesión configurada el cuerpo es el de antes (compatibilidad)', !('session' in sent[1]), JSON.stringify(sent[1]));

    const ls = store();
    ok('sin red / 401 / 408 / 429 / 5xx se reintenta; 400, 403 y 404 no', [0, 401, 408, 429, 500, 503].every(E.shouldRetryProgressSync) && ![400, 403, 404].some(E.shouldRetryProgressSync));
    E.enqueueFailedProgressSync(ls, { userId: 'u1', contentId: 'c1', body: sent[0], now: () => 5_000 });
    E.enqueueFailedProgressSync(ls, { userId: 'u1', contentId: 'c1', body: { ...sent[0], session: { ...sent[0].session, durationSec: 90 } }, now: () => 6_000 });
    E.enqueueFailedProgressSync(ls, { userId: 'u1', contentId: 'c1', body: { ...sent[0], session: { ...sent[0].session, sessionId: 'sy' } }, now: () => 7_000 });
    const q = JSON.parse(ls.getItem('chibalete_failed_syncs'));
    ok('queda en la cola de la aplicación (misma clave y forma), una entrada por sesión; la misma sesión se actualiza', Object.keys(q).sort().join() === 'u1__c1__sx,u1__c1__sy'
        && JSON.parse(q.u1__c1__sx.payload).session.durationSec === 90 && q.u1__c1__sx.userId === 'u1' && q.u1__c1__sx.contentId === 'c1' && typeof q.u1__c1__sx.addedAt === 'string', JSON.stringify(q));
    ok('un almacenamiento que falla no rompe el lector', E.enqueueFailedProgressSync({ getItem: () => { throw new Error('x'); } }, { userId: 'u', contentId: 'c', body: {} }) === false);
    const app = code('components/epub-reader/EpubReaderApp.tsx');
    ok('el lector usa la sesión y deja en la cola lo que no llegó (antes `.catch(() => undefined)`)', /session: createEpubReadingSession\(\)/.test(app) && /if \(!r\.ok && shouldRetryProgressSync\(r\.status\)\) keep\(body\);/.test(app) && /\(\) => keep\(body\)\)/.test(app) && !/\.catch\(\(\) => undefined\)/.test(app));

    // ── W — dataService ───────────────────────────────────────────────────────────────────────────────────────────
    section('[W] visores web: sesión por obra y cola de reintentos por sesión (dataService real, red simulada)');
    const out = path.join(tmp, 'ds.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'services/dataService.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
        external: ['react', 'react-dom'], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    const calls = []; let online = true;
    const W = { listeners: new Map(), addEventListener(t, f) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(f); }, removeEventListener() {},
        fire(t) { (this.listeners.get(t) || []).forEach((f) => f()); } };
    globalThis.window = globalThis; Object.assign(globalThis, { addEventListener: W.addEventListener.bind(W), removeEventListener: () => {} });
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };
    globalThis.localStorage = store({ chibalete_user_id: 'u1' }); globalThis.sessionStorage = store();
    // El lector EPUB dejó antes una sesión sin enviar.
    E.enqueueFailedProgressSync(globalThis.localStorage, { userId: 'u1', contentId: 'cE', body: { ...sent[0], session: { ...sent[0].session, sessionId: 'epub-off' } }, now: () => Date.now() });
    const realSetInterval = globalThis.setInterval; let every15s = null; globalThis.setInterval = (fn) => { every15s = fn; return 0; };
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (/\/progress\//.test(u) && init.method === 'POST') { calls.push({ u, body: JSON.parse(init.body) }); if (!online) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, json: async () => ({}) }; }
        return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
    };
    const { dataService: ds } = await import(pathToFileURL(out).href);
    globalThis.setInterval = realSetInterval;
    every15s?.(); await tick();   // el vaciado periódico (cada 15 s) reintenta la cola
    const progressCalls = () => calls.filter((c) => /\/sync$/.test(c.u));
    ok('en el primer vaciado periódico, la cola adopta y envía la sesión que dejó el lector EPUB', progressCalls().some((c) => c.u.endsWith('/progress/u1/cE/sync') && c.body.session?.sessionId === 'epub-off'), JSON.stringify(calls.map((c) => c.u)));
    await tick(); await tick();
    calls.length = 0;
    // Libro A y luego libro B en la MISMA carga de la página, sin conexión.
    online = false;
    ds.recordReaderOpen('u1', 'cA', 'texto');
    ds.updateProgreso('u1', 'cA', 3, 10);
    ds.forceFlush(); await tick(); await tick();
    ds.recordReaderOpen('u1', 'cB', 'pdf');
    ds.updateProgreso('u1', 'cB', 1, 10, 0, 'pdf');
    ds.forceFlush(); await tick(); await tick();
    // Se vuelve a abrir el libro A (otra sesión) y se guarda, todavía sin conexión.
    ds.recordReaderOpen('u1', 'cA', 'texto');
    ds.updateProgreso('u1', 'cA', 5, 10);
    ds.forceFlush(); await tick(); await tick();
    const sA = calls.filter((c) => c.u.endsWith('/cA/sync')).map((c) => c.body.session), sB = calls.filter((c) => c.u.endsWith('/cB/sync')).map((c) => c.body.session);
    ok('cada obra tiene su sesión (A ≠ B) y reabrir el visor empieza otra (A1 ≠ A2)', sA.length === 2 && sB.length === 1 && sA[0].sessionId !== sB[0].sessionId && sA[0].sessionId !== sA[1].sessionId, JSON.stringify({ sA, sB }));
    ok('…con el modo de su visor y la duración desde que se abrió ESA obra (no desde que cargó la aplicación)', sA[0].mode === 'text' && sB[0].mode === 'pdf' && sA.concat(sB).every((s) => s.durationSec < 5), JSON.stringify({ sA, sB }));
    const queue = JSON.parse(globalThis.localStorage.getItem('chibalete_failed_syncs') || '{}');
    ok('sin conexión, la cola guarda las TRES sesiones por separado (antes la segunda de A reemplazaba a la primera)', Object.keys(queue).filter((k) => k.startsWith('u1__cA__')).length === 2 && Object.keys(queue).some((k) => k.startsWith('u1__cB__')), Object.keys(queue).join());
    calls.length = 0; online = true;
    W.fire('online'); await tick(); await tick(); await tick();
    const resent = progressCalls().map((c) => c.body.session?.sessionId);
    ok('al volver la red se envían las tres sesiones y la cola queda vacía', [sA[0].sessionId, sA[1].sessionId, sB[0].sessionId].every((id) => resent.includes(id)) && Object.keys(JSON.parse(globalThis.localStorage.getItem('chibalete_failed_syncs') || '{}')).length === 0, JSON.stringify({ resent, q: globalThis.localStorage.getItem('chibalete_failed_syncs') }));
    const dsCode = code('services/dataService.ts');
    ok('la cola conserva siete días (antes 24 h) y adopta lo que dejaron otras páginas antes de escribir', /FAILED_SYNCS_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000;/.test(dsCode) && /private saveFailedSyncs\(\): void \{\s*this\.adoptStoredFailedSyncs\(\);/.test(dsCode) && /retryFailedSyncs\(\): void \{\s*this\.adoptStoredFailedSyncs\(\);/.test(dsCode));
    ok('ya no existe la sesión única por carga de la página', !/currentSessionId|sessionStartTimeMs/.test(dsCode));

    // ── T — textos ────────────────────────────────────────────────────────────────────────────────────────────────
    section('[T] tablero e informe: quien lee sin telemetría no es «Inactivo» ni «Sin datos»');
    const dash = code('pages/DashboardMediador.tsx'), inf = code('pages/InformeVisor.tsx');
    ok('tablero: estado propio antes que «Inactivo», fuera de la cuenta de atención, con tiempo y detalle de lectura', /if \(readsWithoutLevel\(s\)\) return 'reading';\s*if \(!s\.hasData\)\s*return 'attention';/.test(dash)
        && /reading:\s*\{ label: NO_LEVEL_LABEL/.test(dash) && /!isUnattributed\(s\) && !readsWithoutLevel\(s\)\)\.length/.test(dash)
        && /student\.hasData \|\| readsWithoutLevel\(student\) \? formatDuration\(student\.totalReadingTimeMs\)/.test(dash) && /\(student\.hasData \|\| readsWithoutLevel\(student\)\) && <ReadingSnapshot/.test(dash));
    ok('tablero: sin patrón «sin actividad» y un resumen que dice sesiones, tiempo y por qué no hay nivel', /isUnattributed\(student\) \|\| readsWithoutLevel\(student\) \? \[\] : \['sin_actividad'\]/.test(dash) && /Sin nivel calculado: \$\{NO_LEVEL_NOTE\}/.test(dash));
    ok('informe: «Lee · nivel sin calcular» en lugar de «Sin datos»', /s\.readsWithoutTelemetry \? 'Lee · nivel sin calcular'/.test(inf) && /s\.hasData \|\| s\.readsWithoutTelemetry \? '' : 'opacity-50'/.test(inf));
    ok('ningún texto nuevo nombra A2/C005', ![dash, inf, code('components/epub-reader/epubProgress.mjs')].some((s) => /\bA2\b|\bC005\b/.test(s)));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nReadingContinuity65D1 — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
