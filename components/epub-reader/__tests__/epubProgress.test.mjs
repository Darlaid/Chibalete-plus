/**
 * epubProgress.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.6.
 *
 * Lógica pura del progreso EPUB del lector: fingerprint byte-exacto (Web
 * Crypto), decisión de restauración por fingerprint, cuerpo del sync, y el
 * guardado (no el relocate de apertura, debounce, máximo de espera, flush).
 *
 *   node components/epub-reader/__tests__/epubProgress.test.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    computeEpubFingerprint, pickRestoreCfi, toEpubSyncBody, createEpubProgressSaver,
    isValidEpubCfi, EPUB_CFI_MAX_LENGTH,
} from '../epubProgress.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const FP = `sha256:${'a'.repeat(64)}`;
const FP2 = `sha256:${'b'.repeat(64)}`;
const CFI = 'epubcfi(/6/18!/4/2/10,/1:0,/1:42)';
const rel = (cfi, sectionIndex = 8, fraction = 0.5) => ({ cfi, sectionIndex, fraction, sectionCount: 14, tocLabel: null, tocHref: null, location: null });

// Reloj y timers falsos: el debounce se prueba sin esperas reales.
function fakeClock() {
    let t = 0; let seq = 0; const timers = new Map();
    return {
        now: () => t,
        setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
        clearTimer: (id) => { timers.delete(id); },
        advance(ms) {
            t += ms;
            for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); }
        },
        get pending() { return timers.size; },
    };
}
function makeSaver(extra = {}) {
    const sent = [];
    const clock = fakeClock();
    const saver = createEpubProgressSaver({
        fingerprint: FP, send: (body, opts) => { sent.push({ body, opts }); },
        now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...extra,
    });
    return { saver, sent, clock };
}

(async () => {
    console.log('[L] fingerprint = SHA-256 byte-exacto (Web Crypto)');
    const bytes = crypto.randomBytes(300_000);
    const expected = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    ok('L. ArrayBuffer/Uint8Array → sha256:<64 hex> igual a node:crypto', await computeEpubFingerprint(bytes) === expected);
    ok('L. Blob (los mismos bytes que el File del lector) → mismo hash', await computeEpubFingerprint(new Blob([bytes.subarray(0, 1000), bytes.subarray(1000)])) === expected);
    ok('L. formato en minúsculas', /^sha256:[0-9a-f]{64}$/.test(expected));
    const alicia = path.join(REPO, 'EPUB test', 'Aventuras_Alicia_Maravillas_EPUB_V4.epub');
    if (fs.existsSync(alicia)) {
        const fp = await computeEpubFingerprint(new Blob([fs.readFileSync(alicia)]));
        ok('L. Alicia → sha256:b85b8dea…5d37 (hash conocido de la fuente)', fp === 'sha256:b85b8dea87a87fbc30b0622ee83f1fe23d52e3bdc9b7d8879bd69ae97e045d37', fp);
    } else {
        console.log('  - L. Alicia: SKIP (EPUB fuente no presente en esta copia)');
    }

    console.log('[G/H] restaurar solo con el mismo fingerprint');
    const prog = (epub) => ({ canonicalProgress: { sentenceIndex: 0, globalPercentage: 50, epub } });
    ok('G. fingerprint igual + CFI válido → restaura ese CFI', pickRestoreCfi(prog({ cfi: CFI, sectionIndex: 8, fraction: 0.5, contentFingerprint: FP }), FP) === CFI);
    ok('H. fingerprint distinto → no restaura', pickRestoreCfi(prog({ cfi: CFI, sectionIndex: 8, fraction: 0.5, contentFingerprint: FP2 }), FP) === null);
    ok('H. sin epub guardado / progreso nulo → no restaura', pickRestoreCfi(prog(undefined), FP) === null && pickRestoreCfi(null, FP) === null);
    ok('H. CFI guardado inválido → no restaura', pickRestoreCfi(prog({ cfi: '/6/18', contentFingerprint: FP }), FP) === null);
    ok('H. fingerprint actual malformado → no restaura', pickRestoreCfi(prog({ cfi: CFI, contentFingerprint: FP }), 'sha256:XYZ') === null);
    ok('no usa globalPercentage para restaurar', pickRestoreCfi({ canonicalProgress: { globalPercentage: 73 } }, FP) === null);

    console.log('[cuerpo del sync]');
    const body = toEpubSyncBody(rel(CFI, 8, 0.50774), FP, () => '2026-10-16T00:00:00.000Z');
    ok('cuerpo = { canonicalProgress: { globalPercentage, epub{cfi,sectionIndex,fraction,contentFingerprint} }, updatedAt }',
        JSON.stringify(body) === JSON.stringify({ canonicalProgress: { globalPercentage: 50.77, epub: { cfi: CFI, sectionIndex: 8, fraction: 0.50774, contentFingerprint: FP } }, updatedAt: '2026-10-16T00:00:00.000Z' }), JSON.stringify(body));
    ok('el cuerpo NO lleva campos legacy (sentenceIndex/anchor/viewportHint/lastInteractedMode/isCompleted/session)',
        !['sentenceIndex', 'totalSentences', 'anchor', 'viewportHint', 'lastInteractedMode', 'contentFingerprint'].some(k => k in body.canonicalProgress) && !('isCompleted' in body) && !('session' in body));
    ok('E. CFI inválido / sección / fraction fuera de rango → sin cuerpo',
        toEpubSyncBody(rel('/6/18'), FP) === null && toEpubSyncBody(rel(CFI, -1), FP) === null && toEpubSyncBody(rel(CFI, 1.5), FP) === null && toEpubSyncBody(rel(CFI, 2, 1.2), FP) === null);
    const longCfi = `epubcfi(${'/4'.repeat(2100)})`;
    ok('F. CFI > 4096 → sin cuerpo (nunca se trunca)', longCfi.length > EPUB_CFI_MAX_LENGTH && toEpubSyncBody(rel(longCfi), FP) === null && !isValidEpubCfi(longCfi));

    console.log('[I] relocates de apertura/restauración no guardan');
    {
        const { saver, sent, clock } = makeSaver();
        saver.onRelocate(rel('epubcfi(/6/2!/4)', 0, 0));
        saver.onRelocate(rel(CFI));
        clock.advance(60_000);
        ok('I. antes de arm(): ningún sync aunque pase el tiempo', sent.length === 0 && clock.pending === 0);
        saver.arm();
        saver.onRelocate(rel(CFI));
        clock.advance(60_000);
        ok('I. tras arm(), re-emitir la posición de partida no guarda', sent.length === 0);
    }
    {
        const { saver, sent, clock } = makeSaver({ initialCfi: CFI });
        saver.arm();
        saver.onRelocate(rel(CFI));
        clock.advance(10_000);
        ok('I. relocate del CFI restaurado (llega tarde) no guarda', sent.length === 0);
    }

    {
        // Producción local 3E.6: foliate re-maqueta al cargar imágenes y emite
        // relocate con reason 'anchor' DESPUÉS de abrir; eso no es avanzar.
        const { saver, sent, clock } = makeSaver();
        saver.arm();
        saver.onRelocate({ ...rel('epubcfi(/6/4!/4,/2,/20)', 1, 0.009), reason: 'anchor' });
        saver.onRelocate({ ...rel('epubcfi(/6/4!/4,/2,/22)', 1, 0.01), reason: 'selection' });
        clock.advance(60_000);
        ok('I. relocate automático (reason anchor/selection) tras arm() → no guarda', sent.length === 0);
        saver.onRelocate({ ...rel('epubcfi(/6/6!/4)', 2, 0.02), reason: 'page' });
        saver.onRelocate({ ...rel('epubcfi(/6/6!/4,/2,/30)', 2, 0.02), reason: 'anchor' });
        clock.advance(5000);
        ok('… un pase de página (reason page) sí, y el anchor posterior no lo sustituye', sent.length === 1 && sent[0].body.canonicalProgress.epub.cfi === 'epubcfi(/6/6!/4)');
        for (const reason of ['snap', 'scroll', 'navigation', undefined]) {
            const t = makeSaver(); t.saver.arm();
            t.saver.onRelocate({ ...rel('epubcfi(/6/8!/4)', 3, 0.03), reason });
            t.clock.advance(5000);
            ok(`… reason ${reason ?? 'ausente (fixed-layout goTo)'} → guarda`, t.sent.length === 1);
        }
    }

    console.log('[debounce]');
    {
        const { saver, sent, clock } = makeSaver();
        saver.arm();
        for (let i = 1; i <= 10; i++) { saver.onRelocate(rel(`epubcfi(/6/${i * 2}!/4)`, i, i / 20)); clock.advance(500); }
        ok('C. 10 páginas en 5 s → 0 requests mientras sigue pasando', sent.length === 0);
        clock.advance(3000);
        ok('C. … y 1 request con la ÚLTIMA posición al parar', sent.length === 1 && sent[0].body.canonicalProgress.epub.cfi === 'epubcfi(/6/20!/4)' && sent[0].opts.keepalive === false);
        saver.onRelocate(rel('epubcfi(/6/20!/4)', 10, 0.5));
        clock.advance(10_000);
        ok('C. misma posición que la ya enviada → no reenvía', sent.length === 1);
    }
    {
        const { saver, sent, clock } = makeSaver();
        saver.arm();
        for (let i = 1; i <= 40; i++) { saver.onRelocate(rel(`epubcfi(/6/${i * 2}!/4)`, i, i / 50)); clock.advance(1000); }
        ok('C. pasar páginas sin parar 40 s → guarda por máximo de espera (≤ 3 requests, no 40)', sent.length >= 2 && sent.length <= 3, String(sent.length));
    }

    console.log('[salida]');
    {
        const { saver, sent, clock } = makeSaver();
        saver.arm();
        saver.onRelocate(rel(CFI));
        saver.flush({ keepalive: true });
        ok('flush al salir → envía ya la posición pendiente con keepalive', sent.length === 1 && sent[0].opts.keepalive === true && clock.pending === 0);
        ok('flush sin nada pendiente → no envía', saver.flush({ keepalive: true }) === null && sent.length === 1);
        saver.onRelocate(rel('epubcfi(/6/30!/4)'));
        saver.dispose();
        clock.advance(60_000);
        ok('dispose cancela el pendiente', sent.length === 1);
    }

    console.log('[J] reabrir vuelve al CFI guardado');
    {
        const { saver, sent, clock } = makeSaver();
        saver.arm();
        saver.onRelocate(rel(CFI, 8, 0.5));
        clock.advance(5000);
        // El servidor guarda canonicalProgress.epub tal cual (+ updatedAt).
        const stored = { canonicalProgress: { epub: { ...sent[0].body.canonicalProgress.epub, updatedAt: 'x' } } };
        ok('J. lo que se envía, al reabrir con el mismo EPUB, restaura el mismo CFI', pickRestoreCfi(stored, FP) === CFI);
        ok('J. … y con otro EPUB (fingerprint distinto) no', pickRestoreCfi(stored, FP2) === null);
    }

    console.log(`\nepubProgress — ${pass} ✓, ${fail} ✗`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
