/**
 * immersiveRuntimeV2Bridge.test.mjs — Sprint Inmersivo V2 / Fase M-2.
 *
 * Tests REALES del bridge viewer ↔ runtime. Ejercitan TODA la lógica
 * orchestration que el viewer React ejecuta: createViewerRuntime, dispatch
 * helpers, reportVisible/Invisible, openContent, closeActive.
 *
 * Estos tests son la fuente de verdad sobre "qué hace el viewer cuando
 * monta/recibe interacciones/desmonta" — el componente React mismo es un
 * wrapper fino que solo conecta la firma del bridge a hooks de React.
 *
 * Cómo correr:
 *   node utils/__tests__/immersiveRuntimeV2Bridge.test.mjs
 */

import {
    createViewerRuntime,
    dispatchPlay,
    dispatchPause,
    dispatchResume,
    dispatchPrev,
    dispatchNext,
    dispatchGoTo,
    reportVisible,
    reportInvisible,
    openContent,
    closeActive,
} from '../immersiveRuntimeV2Bridge.mjs';
import { createAudioRuntime }            from '../../engines/AudioRuntime.mjs';
import { createDiagnostics }             from '../../engines/Diagnostics.mjs';
import { createVisibilityCoordinator }   from '../../engines/VisibilityCoordinator.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

// ── Fakes (igual patrón que immersiveRuntimeV2.test.mjs) ────────────────────

function makeFakeAudio() {
    const events = [];
    const factory = () => {
        const a = {
            _src: '', _paused: true,
            get src() { return a._src; },
            set src(v) { a._src = v; events.push({ kind: 'set_src', src: v }); },
            get currentTime() { return 0; },
            set currentTime(_v) {},
            play: async () => { events.push({ kind: 'play' }); a._paused = false; },
            pause: () => { events.push({ kind: 'pause' }); a._paused = true; },
        };
        events.push({ kind: 'create' });
        return a;
    };
    return { factory, events };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeBridge(overrides = {}) {
    const fakeAudio = makeFakeAudio();
    // El bridge NO inyecta audioFactory — es responsabilidad del viewer
    // (M-2) o del productivo (M-3) construir el AudioRuntime con su
    // factory. Aquí simulamos esa inyección con fakes para los tests.
    const diagnostics = createDiagnostics();
    const audio = createAudioRuntime({
        diagnostics,
        audioFactory: fakeAudio.factory,
        resolveSrc: async ({ index }) => `http://test/clip.mp3#${index}`,
    });
    const visibility = createVisibilityCoordinator({
        diagnostics, timeoutMs: overrides.visibilityTimeoutMs ?? 100,
    });
    const runtime = createViewerRuntime({
        audio, visibility, diagnostics,
        hydrateContent: overrides.hydrateContent ?? (async () => ({ totalIndices: 5 })),
        visibilityTimeoutMs: overrides.visibilityTimeoutMs ?? 100,
    });
    return { runtime, audio, fakeAudio, visibility, diagnostics };
}

// ════════════════════════════════════════════════════════════════════════════
console.log('immersiveRuntimeV2Bridge — Sprint Inmersivo V2 / Fase M-2');

// ─────────────────────────────────────────────────────────────────────────────
// 1. createViewerRuntime devuelve runtime con la API mínima esperada
// ─────────────────────────────────────────────────────────────────────────────
section('[1] createViewerRuntime devuelve runtime válido');
{
    const { runtime } = makeBridge();
    ok('runtime.openSession existe',     typeof runtime.openSession === 'function');
    ok('runtime.closeSession existe',    typeof runtime.closeSession === 'function');
    ok('runtime.dispatch existe',        typeof runtime.dispatch === 'function');
    ok('runtime.reportVisibility existe', typeof runtime.reportVisibility === 'function');
    ok('runtime.subscribe existe',       typeof runtime.subscribe === 'function');
    ok('runtime.getSnapshot existe',     typeof runtime.getSnapshot === 'function');
    ok('runtime.diagnostics.exportTrace existe',
       typeof runtime.diagnostics?.exportTrace === 'function');
    const snap = runtime.getSnapshot();
    ok('snapshot inicial sessionId=null', snap.sessionId === null);
    ok('snapshot inicial status=idle',    snap.status === 'idle');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. openContent abre y devuelve sessionId estable
// ─────────────────────────────────────────────────────────────────────────────
section('[2] openContent abre y devuelve sessionId');
{
    const { runtime } = makeBridge();
    const r = await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    ok('openContent.ok=true',              r.ok === true);
    ok('sessionId es string',              typeof r.sessionId === 'string');
    ok('runtime.getSnapshot.sessionId coincide',
       runtime.getSnapshot().sessionId === r.sessionId);
    ok('runtime.getSnapshot.status=ready', runtime.getSnapshot().status === 'ready');
    ok('totalIndices hidratado=5',         runtime.getSnapshot().totalIndices === 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. dispatchPlay/Pause/Resume reflejan en snapshot
// ─────────────────────────────────────────────────────────────────────────────
section('[3] dispatchPlay/Pause/Resume → snapshot status');
{
    const { runtime } = makeBridge();
    await openContent(runtime, { contentId: 'c1', userId: 'u1' });

    const r1 = await dispatchPlay(runtime);
    ok('play.ok',                            r1.ok === true);
    ok('snapshot.status=playing',            runtime.getSnapshot().status === 'playing');

    const r2 = await dispatchPause(runtime);
    ok('pause.ok',                           r2.ok === true);
    ok('snapshot.status=paused',             runtime.getSnapshot().status === 'paused');

    const r3 = await dispatchResume(runtime);
    ok('resume.ok',                          r3.ok === true);
    ok('snapshot.status=playing tras resume', runtime.getSnapshot().status === 'playing');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. dispatchPrev/Next saturan en bordes y mueven currentIndex
// ─────────────────────────────────────────────────────────────────────────────
section('[4] dispatchPrev / dispatchNext con saturación en bordes');
{
    const { runtime } = makeBridge();
    await openContent(runtime, { contentId: 'c1', userId: 'u1', startIndex: 2 });

    // En el medio: next mueve a 3.
    const rN = await dispatchNext(runtime);
    ok('next.ok',                          rN.ok === true);
    ok('currentIndex=3',                   runtime.getSnapshot().currentIndex === 3);

    // prev mueve a 2.
    const rP = await dispatchPrev(runtime);
    ok('prev.ok',                          rP.ok === true);
    ok('currentIndex=2 tras prev',         runtime.getSnapshot().currentIndex === 2);

    // Bordes: en index 0, prev es no-op (saturado).
    await dispatchGoTo(runtime, 0);
    const rPSat = await dispatchPrev(runtime);
    ok('prev en 0 → at_start',             rPSat.ok === true && rPSat.reason === 'at_start');
    ok('currentIndex sigue en 0',          runtime.getSnapshot().currentIndex === 0);

    // En el último (4 cuando total=5): next es no-op.
    await dispatchGoTo(runtime, 4);
    const rNSat = await dispatchNext(runtime);
    ok('next en último → at_end',          rNSat.ok === true && rNSat.reason === 'at_end');
    ok('currentIndex sigue en 4',          runtime.getSnapshot().currentIndex === 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. dispatchGoTo con index no-entero falla con error explícito
// ─────────────────────────────────────────────────────────────────────────────
section('[5] dispatchGoTo valida index entero');
{
    const { runtime } = makeBridge();
    await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    const r1 = await dispatchGoTo(runtime, 1.5);
    ok('non-integer ok=false',             r1.ok === false);
    ok('error.kind=invariant_violated',    r1.error?.kind === 'invariant_violated');
    ok('error.meta.reason=index_not_integer',
       r1.error?.meta?.reason === 'index_not_integer');
    const r2 = await dispatchGoTo(runtime, 'abc');
    ok('non-number ok=false',              r2.ok === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. reportVisible llama runtime.reportVisibility para sessionId activo
// ─────────────────────────────────────────────────────────────────────────────
section('[6] reportVisible llama runtime.reportVisibility (sessionId activo)');
{
    const { runtime } = makeBridge();
    const open = await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    // Pre-condition: visualReady=false.
    ok('pre: visualReady=false',           runtime.getSnapshot().visualReady === false);
    const result = reportVisible(runtime, open.sessionId, 0);
    ok('dispatched=true',                  result.dispatched === true);
    ok('post: visualReady=true',           runtime.getSnapshot().visualReady === true);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. reportVisible con sessionId VIEJO se descarta antes de llegar al runtime
// ─────────────────────────────────────────────────────────────────────────────
section('[7] reportVisible con sessionId stale → dispatched=false');
{
    const { runtime } = makeBridge();
    const r1 = await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    const oldSessionId = r1.sessionId;
    await openContent(runtime, { contentId: 'c2', userId: 'u1' });
    const result = reportVisible(runtime, oldSessionId, 0);
    ok('stale → dispatched=false',         result.dispatched === false);
    ok('reason=stale_session',             result.reason === 'stale_session');
    // Defense-in-depth: aunque se hubiera llamado runtime.reportVisibility,
    // el runtime también lo descartaría (cancelForSession ya disparó al
    // cerrar la primera sesión). El bridge filtra ANTES, ahorrando logs.
    ok('snapshot.visualReady de c2 sigue false',
       runtime.getSnapshot().visualReady === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. reportVisible con index fuera de rango → descartado
// ─────────────────────────────────────────────────────────────────────────────
section('[8] reportVisible con index out-of-range → descartado');
{
    const { runtime } = makeBridge();
    const open = await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    const r1 = reportVisible(runtime, open.sessionId, -1);
    ok('negative index → dispatched=false', r1.dispatched === false);
    ok('reason=invalid_index',              r1.reason === 'invalid_index');
    const r2 = reportVisible(runtime, open.sessionId, 99);
    ok('out_of_range → dispatched=false',   r2.dispatched === false);
    ok('reason=out_of_range',               r2.reason === 'out_of_range');
    const r3 = reportVisible(runtime, open.sessionId, 1.5);
    ok('non-integer → dispatched=false',    r3.dispatched === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. reportInvisible delega visible:false con reason
// ─────────────────────────────────────────────────────────────────────────────
section('[9] reportInvisible delega visible:false');
{
    const { runtime, visibility } = makeBridge({ visibilityTimeoutMs: 5000 });
    const open = await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    // Pendientes en visibility para reproducir el contract failure.
    const sessionRef = { id: open.sessionId, contentId: 'c1' };
    const awaitP = visibility.awaitConfirmation(sessionRef, 0, { timeoutMs: 5000 });
    let err = null;
    awaitP.catch(e => { err = e; });
    const r = reportInvisible(runtime, open.sessionId, 0, 'dom_mismatch');
    ok('reportInvisible dispatched=true',    r.dispatched === true);
    await sleep(5);
    ok('await rechaza con visibility_contract_failed',
       err?.kind === 'visibility_contract_failed');
    ok('reason del bridge llegó al error',   err?.reason === 'dom_mismatch');
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. closeActive cierra y libera; idempotente al volver a llamar
// ─────────────────────────────────────────────────────────────────────────────
section('[10] closeActive cierra y libera; idempotente');
{
    const { runtime, fakeAudio } = makeBridge();
    await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    await dispatchPlay(runtime);
    const r1 = await closeActive(runtime, 'unmount');
    ok('close.ok',                              r1.ok === true);
    ok('snapshot.status=closed',                runtime.getSnapshot().status === 'closed');
    ok('audio recibió pause',                   fakeAudio.events.some(e => e.kind === 'pause'));
    const r2 = await closeActive(runtime, 'unmount-again');
    ok('idempotente: 2da llamada también ok',   r2.ok === true);
    ok('runtime.activeSession=null',            runtime.getActiveSession() === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Cambio rápido de contenido: openContent A → openContent B → reportVisible(A) ignorado
//     (este es el escenario "cambio rápido de contenido no deja callback viejo
//      reportando al nuevo" del prompt M-2).
// ─────────────────────────────────────────────────────────────────────────────
section('[11] cambio rápido de contenido — callback viejo no contamina al nuevo');
{
    const { runtime } = makeBridge();
    const a = await openContent(runtime, { contentId: 'cA', userId: 'u1' });
    const b = await openContent(runtime, { contentId: 'cB', userId: 'u1' });
    ok('A.sessionId !== B.sessionId',           a.sessionId !== b.sessionId);
    ok('snapshot.contentId=cB',                 runtime.getSnapshot().contentId === 'cB');

    // Callback viejo intentando reportar visible para A.
    const oldReport = reportVisible(runtime, a.sessionId, 0);
    ok('old report descartado (stale_session)', oldReport.dispatched === false);
    ok('snapshot de B intacto: visualReady=false', runtime.getSnapshot().visualReady === false);

    // Report válido para B sí pasa.
    const newReport = reportVisible(runtime, b.sessionId, 0);
    ok('new report dispatched',                 newReport.dispatched === true);
    ok('snapshot.visualReady=true para B',      runtime.getSnapshot().visualReady === true);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Subscribe entrega snapshots tras transiciones
// ─────────────────────────────────────────────────────────────────────────────
section('[12] subscribe entrega snapshots tras cada transición');
{
    const { runtime } = makeBridge();
    const seen = [];
    const unsub = runtime.subscribe((snap) => seen.push(snap.status));
    await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    await dispatchPlay(runtime);
    await dispatchPause(runtime);
    unsub();
    // Se debieron entregar al menos: opening → ready → playing → paused.
    // Confirmamos que vemos la secuencia en orden.
    const has = (s) => seen.indexOf(s);
    ok('opening visto',                       has('opening') >= 0);
    ok('ready visto después de opening',      has('ready') > has('opening'));
    ok('playing visto después de ready',      has('playing') > has('ready'));
    ok('paused visto después de playing',     has('paused') > has('playing'));
    // unsubscribe es efectivo: tras unsub no se reciben más.
    const lengthAtUnsub = seen.length;
    await dispatchPlay(runtime);
    ok('tras unsub, no se reciben más snapshots', seen.length === lengthAtUnsub);
}

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN AUDIT — tests añadidos tras la auditoría profunda M-1/M-2.
// Cubren los gaps F1, F2, F4 + nuevos invariantes (StrictMode sim, listener
// accumulation, runtime.destroy, cancelAll de visibility).
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 13. Concurrent openSession serializa SIN starvation del event loop (fix F1)
// ─────────────────────────────────────────────────────────────────────────────
section('[13] concurrent openSession con hydrate-timer NO bloquea event loop');
{
    // Caso reproductivo: hydrate usa setTimeout (macrotask). Si openSession
    // serializa con busy-loop de microtasks, el segundo open() jamás dejaría
    // que el setTimeout del primero corra → deadlock. Esto debe completarse
    // en pocos ms.
    const fakeAudio = makeFakeAudio();
    const diagnostics = createDiagnostics();
    const audio = createAudioRuntime({ diagnostics, audioFactory: fakeAudio.factory,
        resolveSrc: async ({ index }) => `http://test/clip.mp3#${index}` });
    const visibility = createVisibilityCoordinator({ diagnostics, timeoutMs: 100 });
    const runtime = createViewerRuntime({
        audio, visibility, diagnostics,
        hydrateContent: async () => { await sleep(20); return { totalIndices: 3 }; },
    });

    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
        openContent(runtime, { contentId: 'cA', userId: 'u1' }),
        openContent(runtime, { contentId: 'cB', userId: 'u1' }),
    ]);
    const elapsed = Date.now() - t0;

    ok('ambos opens resolvieron',          r1.ok || r2.ok);
    ok('al menos uno tuvo éxito',          r2.ok === true);
    ok('elapsed < 200ms (no deadlock)',    elapsed < 200);
    ok('snapshot.contentId=cB (último gana)', runtime.getSnapshot().contentId === 'cB');
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. cleanup-during-pending-open cierra la sesión recién abierta (fix F1/F3)
// ─────────────────────────────────────────────────────────────────────────────
section('[14] closeSession durante openSession en flight cierra correctamente');
{
    const fakeAudio = makeFakeAudio();
    const diagnostics = createDiagnostics();
    const audio = createAudioRuntime({ diagnostics, audioFactory: fakeAudio.factory,
        resolveSrc: async ({ index }) => `http://test/clip.mp3#${index}` });
    const visibility = createVisibilityCoordinator({ diagnostics, timeoutMs: 100 });
    const runtime = createViewerRuntime({
        audio, visibility, diagnostics,
        hydrateContent: async () => { await sleep(30); return { totalIndices: 3 }; },
    });

    // Fire openSession.
    const openP = openContent(runtime, { contentId: 'cA', userId: 'u1' });
    // Inmediatamente: closeActive (simula viewer cleanup en mount-then-unmount).
    await sleep(5);
    const closeR = await closeActive(runtime, 'rapid_unmount');

    // Esperar a que open termine.
    const openR = await openP;

    ok('closeActive completó',            closeR.ok === true);
    ok('runtime.activeSession=null',      runtime.getActiveSession() === null);
    const finalStatus = runtime.getSnapshot().status;
    ok('snapshot final = closed',         finalStatus === 'closed');
    // openR puede ser ok=true (si terminó antes del close) o ok=false con aborted.
    // En cualquier caso, no debe haber sesión huérfana.
    ok('si openR.ok=true, su sesión está closed',
       !openR.ok || (openR.sessionId && runtime.getActiveSession() === null));
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. runtime.destroy() libera todo (fix F2)
// ─────────────────────────────────────────────────────────────────────────────
section('[15] runtime.destroy() libera audio + visibility + diagnostics + store');
{
    const fakeAudio = makeFakeAudio();
    const diagnostics = createDiagnostics();
    const audio = createAudioRuntime({ diagnostics, audioFactory: fakeAudio.factory,
        resolveSrc: async ({ index }) => `http://test/clip.mp3#${index}` });
    const visibility = createVisibilityCoordinator({ diagnostics, timeoutMs: 100 });
    const runtime = createViewerRuntime({
        audio, visibility, diagnostics,
        hydrateContent: async () => ({ totalIndices: 5 }),
    });

    // Abrir y arrancar audio para generar estado.
    await openContent(runtime, { contentId: 'c1', userId: 'u1' });
    await dispatchPlay(runtime);

    // Subscribe un listener — debe limpiarse tras destroy.
    let snapsReceived = 0;
    const unsub = runtime.subscribe(() => { snapsReceived++; });

    // Diagnostics tiene eventos.
    ok('pre-destroy: diagnostics tiene eventos',
       runtime.diagnostics.getRecentEvents().length > 0);

    // Destroy.
    const destroyR = await runtime.destroy('test');
    ok('destroy.ok=true',                   destroyR.ok === true);
    ok('idempotente: 2da destroy también ok',
       (await runtime.destroy()).ok === true);

    // Post-destroy: snapshot está reseteado, diagnostics vacío.
    ok('snapshot reset (status=idle)',      runtime.getSnapshot().status === 'idle');
    ok('diagnostics clear()',               runtime.diagnostics.getRecentEvents().length === 0);
    ok('audio fake recibió pause antes',    fakeAudio.events.some(e => e.kind === 'pause'));

    // Listener viejo desconectado (store.reset).
    const before = snapsReceived;
    // Intento abrir → debe fallar con runtime_destroyed.
    const openAfter = await openContent(runtime, { contentId: 'cAfter', userId: 'u1' });
    ok('openSession post-destroy falla',    openAfter.ok === false);
    ok('error.kind=aborted',                openAfter.error?.kind === 'aborted');
    ok('listener no recibió más snapshots tras destroy', snapsReceived === before);

    // unsub idempotente.
    try { unsub(); ok('unsub no throws', true); } catch { ok('unsub no throws', false); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. Dos runtimes coexistiendo no comparten estado (cross-runtime isolation)
// ─────────────────────────────────────────────────────────────────────────────
section('[16] dos runtimes coexistentes — cross-runtime isolation');
{
    const r1 = makeBridge();
    const r2 = makeBridge();
    await openContent(r1.runtime, { contentId: 'c1', userId: 'u1' });
    await openContent(r2.runtime, { contentId: 'c2', userId: 'u2' });

    ok('r1.contentId=c1',                   r1.runtime.getSnapshot().contentId === 'c1');
    ok('r2.contentId=c2',                   r2.runtime.getSnapshot().contentId === 'c2');
    ok('r1.sessionId !== r2.sessionId',
       r1.runtime.getSnapshot().sessionId !== r2.runtime.getSnapshot().sessionId);

    await dispatchPlay(r1.runtime);
    ok('r1 playing, r2 sigue ready',
       r1.runtime.getSnapshot().status === 'playing' &&
       r2.runtime.getSnapshot().status === 'ready');

    // Destroy r1 no afecta r2.
    await r1.runtime.destroy('test');
    ok('r1 destroyed, r2 intacto',
       r1.runtime.getSnapshot().status === 'idle' &&
       r2.runtime.getSnapshot().status === 'ready');
}

// ─────────────────────────────────────────────────────────────────────────────
// 17. Listener cleanup en RuntimeStore tras N subscribe/unsubscribe
// ─────────────────────────────────────────────────────────────────────────────
section('[17] listeners no acumulan tras N subscribe/unsubscribe');
{
    const { runtime } = makeBridge();
    await openContent(runtime, { contentId: 'c1', userId: 'u1' });

    // Simulamos N viewers que subscriben+unsubscriben (StrictMode-like).
    const N = 10;
    for (let i = 0; i < N; i++) {
        const unsub = runtime.subscribe(() => {});
        unsub();
    }

    // Subscribe uno final y cuenta cuántos snapshots recibe tras un dispatch.
    let received = 0;
    const unsub = runtime.subscribe(() => { received++; });
    await dispatchPlay(runtime);
    unsub();

    // Sin acumulación: el dispatch causa exactamente 1 transición observable.
    // (Lo que importa: NO N+1 invocaciones.)
    ok('último subscriber recibió ≥1 snapshot', received >= 1);
    ok('sin amplificación N×: received < N', received < N);
}

// ─────────────────────────────────────────────────────────────────────────────
// 18. visibility.cancelAll() limpia pendings huérfanos (fix F4)
// ─────────────────────────────────────────────────────────────────────────────
section('[18] visibility.cancelAll() limpia pendings de todas las sesiones');
{
    const { runtime, visibility } = makeBridge({ visibilityTimeoutMs: 5000 });
    const open1 = await openContent(runtime, { contentId: 'c1', userId: 'u1' });

    // Crear 2 pendings manualmente.
    const sessionRef = { id: open1.sessionId, contentId: 'c1' };
    const p1 = visibility.awaitConfirmation(sessionRef, 0, { timeoutMs: 5000 });
    const p2 = visibility.awaitConfirmation(sessionRef, 1, { timeoutMs: 5000 });
    let r1Err = null, r2Err = null;
    p1.catch(e => { r1Err = e; });
    p2.catch(e => { r2Err = e; });

    ok('pre: 2 pendings activos', visibility._pendingCount() === 2);

    visibility.cancelAll('test');
    await sleep(5);

    ok('post: 0 pendings',                          visibility._pendingCount() === 0);
    ok('p1 rechazado con aborted',                  r1Err?.kind === 'aborted');
    ok('p2 rechazado con aborted',                  r2Err?.kind === 'aborted');
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\nimmersiveRuntimeV2Bridge — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
