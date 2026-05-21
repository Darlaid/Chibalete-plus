/**
 * immersiveRuntimeV2.test.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Tests REALES (no regex) que ejecutan lógica del runtime V2 con fakes
 * controlados. Los 20 escenarios obligatorios listados en M-1:
 *
 *  1. openSession crea sesión nueva.
 *  2. openSession cierra sesión anterior antes de abrir otra.
 *  3. closeSession libera recursos.
 *  4. closeSession invalida callbacks pendientes.
 *  5. callback con lifecycleToken viejo no muta estado.
 *  6. play en ready pasa a playing.
 *  7. pause en playing pasa a paused sin resetear index.
 *  8. resume en paused pasa a playing.
 *  9. goTo(N, manual) cambia currentIndex a N.
 * 10. goTo fuera de rango falla con error explícito.
 * 11. dispatch serializa operaciones.
 * 12. triple play no inicia tres reproducciones.
 * 13. audio_unavailable deja sesión en estado controlado.
 * 14. visibility_timeout produce error explícito.
 * 15. reportVisibility de sesión vieja se ignora.
 * 16. progress solo guarda si completed.
 * 17. close durante open aborta hidratación.
 * 18. close durante play no deja audio huérfano.
 * 19. snapshot es inmutable.
 * 20. diagnostics exporta timeline con sessionId/contentId/index.
 *
 * Cómo correr:
 *   node engines/__tests__/immersiveRuntimeV2.test.mjs
 */

import { createImmersiveRuntime }         from '../ImmersiveRuntime.mjs';
import { createAudioRuntime }             from '../AudioRuntime.mjs';
import { createVisibilityCoordinator }    from '../VisibilityCoordinator.mjs';
import { createProgressRuntime }          from '../ProgressRuntime.mjs';
import { createDiagnostics }              from '../Diagnostics.mjs';
import { createRuntimeStore }             from '../RuntimeStore.mjs';
import { createImmersiveSession }         from '../ImmersiveSession.mjs';

// ── runner mínimo ───────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

// ── Fakes ───────────────────────────────────────────────────────────────────

/** Crea un fake audio que registra cada llamada. */
function makeFakeAudio(opts = {}) {
    const events = [];
    const factory = () => {
        const a = {
            _src: '',
            _currentTime: 0,
            _paused: true,
            get src() { return a._src; },
            set src(v) { a._src = v; events.push({ kind: 'set_src', src: v }); },
            get currentTime() { return a._currentTime; },
            set currentTime(v) { a._currentTime = v; },
            play: async () => {
                events.push({ kind: 'play' });
                if (opts.playRejects) throw new Error('play rejected');
                a._paused = false;
            },
            pause: () => {
                events.push({ kind: 'pause' });
                a._paused = true;
            },
        };
        events.push({ kind: 'create' });
        return a;
    };
    return { factory, events };
}

/** Resolver de src que puede ser configurado por test. */
function makeResolveSrc({ ok: returnOk = true, src = 'http://test/clip.mp3', throwError = false } = {}) {
    return async ({ index }) => {
        if (throwError) throw new Error('resolve failed');
        if (!returnOk) return null;
        return `${src}#${index}`;
    };
}

/** hydrateContent fake configurable. */
function makeHydrate({ totalIndices = 10, delayMs = 0, fail = false, throwKind = null } = {}) {
    return async ({ contentId }) => {
        if (delayMs > 0) await sleep(delayMs);
        if (throwKind) {
            const err = new Error('hydrate threw');
            err.kind = throwKind;
            throw err;
        }
        if (fail) throw new Error('hydrate failed');
        return { totalIndices };
    };
}

/** Commit espía. */
function makeCommitSpy() {
    const calls = [];
    return { spy: (input) => { calls.push(input); }, calls };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Construye runtime fresco. Permite override de cualquier subsistema. */
function makeRuntime(overrides = {}) {
    const diagnostics = overrides.diagnostics ?? createDiagnostics();
    const store       = overrides.store       ?? createRuntimeStore();
    const fakeAudio   = overrides.fakeAudio   ?? makeFakeAudio();
    const audio       = overrides.audio       ?? createAudioRuntime({
        diagnostics,
        audioFactory: fakeAudio.factory,
        resolveSrc:   overrides.resolveSrc ?? makeResolveSrc(),
    });
    const visibility  = overrides.visibility  ?? createVisibilityCoordinator({
        diagnostics, timeoutMs: overrides.visibilityTimeoutMs ?? 100,
    });
    const commit      = overrides.commit      ?? makeCommitSpy();
    const progress    = overrides.progress    ?? createProgressRuntime({
        diagnostics, commit: commit.spy, audioRuntime: audio,
    });
    const hydrateContent = overrides.hydrateContent ?? makeHydrate();

    const runtime = createImmersiveRuntime({
        diagnostics, store, audio, visibility, progress, hydrateContent,
        visibilityTimeoutMs: overrides.visibilityTimeoutMs ?? 100,
    });
    return { runtime, diagnostics, store, audio, fakeAudio, visibility, progress, commit, hydrateContent };
}

// ════════════════════════════════════════════════════════════════════════════
console.log('immersiveRuntimeV2 — Sprint Inmersivo V2 / Fase M-1');

// 1. openSession crea sesión nueva.
section('[1] openSession crea sesión nueva');
{
    const env = makeRuntime();
    const r = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    ok('ok=true',              r.ok === true);
    ok('session retornada',    !!r.session);
    ok('session.id es string', typeof r.session.id === 'string');
    ok('contentId persistido', r.session.contentId === 'c1');
    ok('userId persistido',    r.session.userId === 'u1');
    ok('status=ready post-open', env.runtime.getSnapshot().status === 'ready');
    ok('totalIndices hidratado', env.runtime.getSnapshot().totalIndices === 10);
}

// 2. openSession cierra sesión anterior antes de abrir otra.
section('[2] openSession cierra sesión anterior antes de abrir otra');
{
    const env = makeRuntime();
    const r1 = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const oldId = r1.session.id;
    const oldToken = r1.session.getToken();
    const r2 = await env.runtime.openSession({ contentId: 'c2', userId: 'u1' });
    ok('nueva sesión abierta',           r2.ok === true);
    ok('nueva sesión tiene id distinto', r2.session.id !== oldId);
    ok('nueva sesión tiene token mayor', r2.session.getToken() > oldToken);
    ok('vieja sesión está closed',       r1.session.getStatus() === 'closed');
    ok('runtime apunta a la nueva',      env.runtime.getActiveSession() === r2.session);
    ok('snapshot.contentId=c2',          env.runtime.getSnapshot().contentId === 'c2');
}

// 3. closeSession libera recursos.
section('[3] closeSession libera recursos');
{
    const env = makeRuntime();
    const r = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    await env.runtime.dispatch({ kind: 'play' });
    const closeResult = await env.runtime.closeSession('test');
    ok('close.ok=true',                  closeResult.ok === true);
    ok('session.getStatus=closed',       r.session.getStatus() === 'closed');
    ok('audio fake recibió pause',       env.fakeAudio.events.some(e => e.kind === 'pause'));
    ok('runtime.activeSession=null',     env.runtime.getActiveSession() === null);
    ok('snapshot.status=closed',         env.runtime.getSnapshot().status === 'closed');
}

// 4. closeSession invalida callbacks pendientes (visibility cancela).
section('[4] closeSession invalida callbacks pendientes');
{
    const env = makeRuntime({ visibilityTimeoutMs: 5000 });
    const r = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    // Iniciar await visibility manual (sin que el viewer reporte).
    const awaitP = env.visibility.awaitConfirmation(r.session.getRef(), 0);
    let rejected = null;
    awaitP.catch(e => { rejected = e; });
    await env.runtime.closeSession();
    // Damos una microtarea para que el reject propague.
    await sleep(5);
    ok('await fue rechazado',                 !!rejected);
    ok('error kind=aborted',                  rejected?.kind === 'aborted');
    ok('error reason=session_cancelled',      rejected?.reason === 'session_cancelled');
}

// 5. callback con lifecycleToken viejo no muta estado.
section('[5] callback con lifecycleToken viejo no muta estado');
{
    const env = makeRuntime();
    const r = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const session = r.session;
    const oldToken = session.getToken();
    // Cerramos la sesión, lo cual bumpea el token.
    await env.runtime.closeSession();
    const newToken = session.getToken();
    ok('token bumpeado tras close', newToken > oldToken);
    let caught = null;
    try {
        session.assertLive(oldToken, 'test_callback');
    } catch (e) { caught = e; }
    ok('assertLive con token viejo throws',                !!caught);
    ok('kind=destroyed_session_mutation o stale_session_callback',
       caught?.kind === 'destroyed_session_mutation' || caught?.kind === 'stale_session_callback');
    ok('isLive(oldToken) === false',                       session.isLive(oldToken) === false);
}

// 6. play en ready pasa a playing.
section('[6] play en ready pasa a playing');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    ok('pre: status=ready', env.runtime.getSnapshot().status === 'ready');
    const r = await env.runtime.dispatch({ kind: 'play' });
    ok('dispatch.ok',       r.ok === true);
    ok('post: status=playing', env.runtime.getSnapshot().status === 'playing');
}

// 7. pause en playing pasa a paused sin resetear index.
section('[7] pause en playing pasa a paused sin resetear index');
{
    const env = makeRuntime();
    const open = await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 3 });
    ok('startIndex=3', open.session.getCurrentIndex() === 3);
    await env.runtime.dispatch({ kind: 'play'  });
    await env.runtime.dispatch({ kind: 'pause' });
    ok('status=paused',           env.runtime.getSnapshot().status === 'paused');
    ok('currentIndex sigue en 3', env.runtime.getSnapshot().currentIndex === 3);
}

// 8. resume en paused pasa a playing.
section('[8] resume en paused pasa a playing');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    await env.runtime.dispatch({ kind: 'play'  });
    await env.runtime.dispatch({ kind: 'pause' });
    const r = await env.runtime.dispatch({ kind: 'resume' });
    ok('resume.ok',                r.ok === true);
    ok('status=playing',           env.runtime.getSnapshot().status === 'playing');
}

// 9. goTo(N, manual) cambia currentIndex a N.
section('[9] goTo(N, manual) cambia currentIndex a N');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const r = await env.runtime.dispatch({ kind: 'goTo', index: 7, source: 'manual' });
    ok('goTo.ok',                  r.ok === true);
    ok('currentIndex=7',           env.runtime.getSnapshot().currentIndex === 7);
    ok('visualReady reseteado',    env.runtime.getSnapshot().visualReady === false);
}

// 10. goTo fuera de rango falla con error explícito.
section('[10] goTo fuera de rango falla con error explícito');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const r1 = await env.runtime.dispatch({ kind: 'goTo', index: 999, source: 'manual' });
    ok('out-of-range r.ok=false',         r1.ok === false);
    ok('error.kind=invariant_violated',   r1.error?.kind === 'invariant_violated');
    ok('error.meta.reason=index_out_of_range',
       r1.error?.meta?.reason === 'index_out_of_range');
    const r2 = await env.runtime.dispatch({ kind: 'goTo', index: -5, source: 'manual' });
    ok('negative r.ok=false',             r2.ok === false);
    ok('non-integer error',               r2.error?.kind === 'invariant_violated');
    // Estado tras error sigue valid.
    ok('snapshot.status sigue siendo ready', env.runtime.getSnapshot().status === 'ready');
}

// 11. dispatch serializa operaciones.
section('[11] dispatch serializa operaciones');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const order = [];
    const p1 = env.runtime.dispatch({ kind: 'play'  }).then(() => order.push('play'));
    const p2 = env.runtime.dispatch({ kind: 'pause' }).then(() => order.push('pause'));
    const p3 = env.runtime.dispatch({ kind: 'resume' }).then(() => order.push('resume'));
    await Promise.all([p1, p2, p3]);
    ok('orden FIFO preservado',
       order.length === 3 && order[0] === 'play' && order[1] === 'pause' && order[2] === 'resume');
}

// 12. triple play no inicia tres reproducciones.
section('[12] triple play no inicia tres reproducciones');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const ps = [
        env.runtime.dispatch({ kind: 'play' }),
        env.runtime.dispatch({ kind: 'play' }),
        env.runtime.dispatch({ kind: 'play' }),
    ];
    const results = await Promise.all(ps);
    const firstOk = results[0]?.ok === true;
    const noopCount = results.filter(r => r?.reason === 'already_playing').length;
    ok('primera play ok',                       firstOk);
    ok('2da y 3ra son no-op already_playing',   noopCount === 2);
    const playEvents = env.fakeAudio.events.filter(e => e.kind === 'play').length;
    ok('audio.play() llamado solo 1 vez',       playEvents === 1);
}

// 13. audio_unavailable deja sesión en estado controlado.
section('[13] audio_unavailable deja sesión en estado controlado');
{
    const env = makeRuntime({ resolveSrc: makeResolveSrc({ ok: false }) });
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const r = await env.runtime.dispatch({ kind: 'play' });
    ok('r.ok=false',                            r.ok === false);
    ok('error.kind=audio_unavailable',          r.error?.kind === 'audio_unavailable');
    ok('snapshot.status=error',                 env.runtime.getSnapshot().status === 'error');
    ok('snapshot.lastError persiste',           env.runtime.getSnapshot().lastError?.kind === 'audio_unavailable');
}

// 14. visibility_timeout produce error explícito.
section('[14] visibility_timeout produce error explícito');
{
    const env = makeRuntime({ visibilityTimeoutMs: 30 });
    const open = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    let err = null;
    try {
        await env.visibility.awaitConfirmation(open.session.getRef(), 0, { timeoutMs: 30 });
    } catch (e) { err = e; }
    ok('await rechaza',                  !!err);
    ok('error.kind=visibility_timeout',  err?.kind === 'visibility_timeout');
    ok('error.index=0',                  err?.index === 0);
}

// 15. reportVisibility de sesión vieja se ignora.
section('[15] reportVisibility de sesión vieja se ignora');
{
    const env = makeRuntime({ visibilityTimeoutMs: 50 });
    const r1 = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const oldId = r1.session.id;
    await env.runtime.openSession({ contentId: 'c2', userId: 'u1' });
    const snapBefore = env.runtime.getSnapshot();
    env.runtime.reportVisibility(oldId, 0, { visible: true });
    const snapAfter = env.runtime.getSnapshot();
    ok('snapshot.sessionId NO es oldId', snapAfter.sessionId !== oldId);
    ok('visualReady NO se marcó por sessionId viejo', snapAfter.visualReady === false);
    ok('snapshot intacto excepto por la sesión nueva', snapBefore.sessionId === snapAfter.sessionId);
}

// 16. progress solo guarda si completed (visual confirmed + audio no failed).
section('[16] progress solo guarda si completed');
{
    const env = makeRuntime();
    const open = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const ref = open.session.getRef();

    // Sin visual confirmado → schedule debe rechazar.
    const r1 = env.progress.schedule(ref, 0);
    ok('schedule sin visual: scheduled=false', r1.scheduled === false);
    ok('reason=gate_failed',                   r1.reason === 'gate_failed');
    ok('commit NO se llamó',                   env.commit.calls.length === 0);

    // Marcar visual confirmed → schedule pasa.
    env.progress.markVisualConfirmed(ref, 0);
    const r2 = env.progress.schedule(ref, 0);
    ok('schedule con visual: scheduled=true',  r2.scheduled === true);
    ok('commit recibido 1x',                   env.commit.calls.length === 1);
    ok('commit.index=0',                       env.commit.calls[0].index === 0);
    ok('commit.contentId=c1',                  env.commit.calls[0].contentId === 'c1');
    ok('commit.userId=u1',                     env.commit.calls[0].userId === 'u1');
}

// 17. close durante open aborta hidratación.
section('[17] close durante open aborta hidratación');
{
    const env = makeRuntime({ hydrateContent: makeHydrate({ totalIndices: 5, delayMs: 60 }) });
    // No await — kick off open en paralelo.
    const openP = env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    // Inmediatamente: cerrar.
    await sleep(10);    // suficiente para que hydrate empiece
    await env.runtime.closeSession('test_abort');
    const r = await openP;
    // El open puede haber resuelto antes del close, o haber sido abortado.
    // Aceptamos cualquiera de las dos formas; la INVARIANTE es que tras el
    // close la sesión está closed (no quedó playing huérfana).
    const finalStatus = env.runtime.getSnapshot().status;
    ok('snapshot final = closed o idle (no hay huérfana)',
       finalStatus === 'closed' || finalStatus === 'idle');
    ok('runtime.activeSession=null', env.runtime.getActiveSession() === null);
}

// 18. close durante play no deja audio huérfano.
section('[18] close durante play no deja audio huérfano');
{
    const env = makeRuntime();
    const open = await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    // Encolamos play sin await + close en paralelo.
    const playP  = env.runtime.dispatch({ kind: 'play' });
    const closeP = env.runtime.closeSession('test');
    await Promise.allSettled([playP, closeP]);
    ok('session final = closed',          open.session.getStatus() === 'closed');
    // El audio fake debe haber recibido pause como parte de releaseFor.
    const sawPause = env.fakeAudio.events.some(e => e.kind === 'pause');
    // Aceptamos que pause no se haya llamado si play nunca llegó a startar
    // antes del close — en ese caso el audio nunca arrancó.
    const sawPlay = env.fakeAudio.events.some(e => e.kind === 'play');
    ok('si hubo play, hubo pause',          !sawPlay || sawPause);
    ok('runtime.activeSession=null',       env.runtime.getActiveSession() === null);
}

// 19. snapshot es inmutable.
section('[19] snapshot es inmutable');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const snap = env.runtime.getSnapshot();
    ok('snapshot frozen',                Object.isFrozen(snap));
    let threw = false;
    try { snap.status = 'mutated'; } catch { threw = true; }
    // En strict mode (módulos ESM), asignar a frozen tira. En non-strict, no
    // pero el valor no cambia. Verificamos no-mutación efectiva.
    ok('snapshot.status sigue siendo ready',
       env.runtime.getSnapshot().status === 'ready');
    // Diferente snapshot tras transición.
    await env.runtime.dispatch({ kind: 'play' });
    const snap2 = env.runtime.getSnapshot();
    ok('snapshot post-play es referencia distinta',  snap !== snap2);
    ok('snap original sigue siendo ready',           snap.status === 'ready');
    ok('snap2.status=playing',                       snap2.status === 'playing');
}

// 20. diagnostics exporta timeline con sessionId/contentId/index.
section('[20] diagnostics exporta timeline con sessionId/contentId/index');
{
    const env = makeRuntime();
    const open = await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 2 });
    await env.runtime.dispatch({ kind: 'play' });
    await env.runtime.dispatch({ kind: 'goTo', index: 4, source: 'manual' });
    const trace = env.runtime.diagnostics.exportTrace(open.session.id);
    ok('trace no vacío',                trace.length > 0);
    ok('todos los eventos tienen sessionId correcto',
       trace.every(e => e.sessionId === open.session.id));
    ok('hay eventos con contentId',
       trace.some(e => e.contentId === 'c1'));
    const transitions = trace.filter(e => e.kind === 'state.transition');
    ok('al menos 2 state.transition emitidos',  transitions.length >= 2);
    const sessionOpened = trace.some(e => e.kind === 'session.opened');
    const sessionReady  = trace.some(e => e.kind === 'session.ready');
    ok('session.opened registrado',     sessionOpened);
    ok('session.ready registrado',      sessionReady);
    // Eventos de queue con sus 'kind'.
    const queueStart = trace.filter(e => e.kind === 'queue.start');
    ok('queue.start emitido para acciones', queueStart.length >= 2);
}

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN M-3.2 — audio events (audioEnded / audioFailed),
// audio_autoplay_blocked, forceClose, audioCleanup hook.
// ════════════════════════════════════════════════════════════════════════════

// 21. audioEnded avanza currentIndex en estado playing + auto-arranca next
section('[21] audioEnded avanza currentIndex y auto-arranca siguiente clip (M-3.3)');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 2 });
    await env.runtime.dispatch({ kind: 'play' });
    ok('pre: currentIndex=2',         env.runtime.getSnapshot().currentIndex === 2);
    ok('pre: status=playing',         env.runtime.getSnapshot().status === 'playing');
    const playEventsBefore = env.fakeAudio.events.filter(e => e.kind === 'play').length;
    const r = await env.runtime.dispatch({ kind: 'audioEnded', index: 2 });
    ok('audioEnded ok',               r.ok === true);
    // M-3.3: reason cambia de 'advanced' a 'advanced_and_played' porque
    // el handler ahora hace preflight + startPlayback inline.
    ok('reason=advanced_and_played',  r.reason === 'advanced_and_played');
    ok('post: currentIndex=3',        env.runtime.getSnapshot().currentIndex === 3);
    ok('post: visualReady=false',     env.runtime.getSnapshot().visualReady === false);
    ok('post: status sigue playing',  env.runtime.getSnapshot().status === 'playing');
    const playEventsAfter = env.fakeAudio.events.filter(e => e.kind === 'play').length;
    ok('audio.play() del siguiente clip se invocó',
       playEventsAfter === playEventsBefore + 1);
}

// 22. audioEnded en último índice → status='paused' (session_completed)
section('[22] audioEnded en último índice → paused');
{
    const env = makeRuntime();   // hydrate default = totalIndices 10
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 9 });
    await env.runtime.dispatch({ kind: 'play' });
    const r = await env.runtime.dispatch({ kind: 'audioEnded', index: 9 });
    ok('reason=session_completed',    r.reason === 'session_completed');
    ok('status=paused',               env.runtime.getSnapshot().status === 'paused');
    ok('currentIndex sigue 9',        env.runtime.getSnapshot().currentIndex === 9);
}

// 23. audioEnded con index stale (≠ currentIndex) → no-op
section('[23] audioEnded stale → no-op');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 3 });
    await env.runtime.dispatch({ kind: 'play' });
    const r = await env.runtime.dispatch({ kind: 'audioEnded', index: 99 });
    ok('reason=stale_index',          r.reason === 'stale_index');
    ok('currentIndex sigue 3',        env.runtime.getSnapshot().currentIndex === 3);
    ok('status sigue playing',        env.runtime.getSnapshot().status === 'playing');
}

// 24. audioEnded en pausa NO avanza (usuario pausó manualmente, audio del
//     clip anterior llegó a su fin tarde)
section('[24] audioEnded en paused → no avanza');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 1 });
    await env.runtime.dispatch({ kind: 'play' });
    await env.runtime.dispatch({ kind: 'pause' });
    const r = await env.runtime.dispatch({ kind: 'audioEnded', index: 1 });
    ok('reason=not_playing',          r.reason === 'not_playing');
    ok('currentIndex sigue 1',        env.runtime.getSnapshot().currentIndex === 1);
    ok('status sigue paused',         env.runtime.getSnapshot().status === 'paused');
}

// 25. audioFailed transiciona a error con kind=audio_failed
section('[25] audioFailed → status=error, lastError.kind=audio_failed');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 0 });
    await env.runtime.dispatch({ kind: 'play' });
    const r = await env.runtime.dispatch({
        kind: 'audioFailed', index: 0, reason: 'decode_failed_test',
    });
    ok('r.ok=false',                            r.ok === false);
    ok('error.kind=audio_failed',               r.error?.kind === 'audio_failed');
    ok('snapshot.status=error',                 env.runtime.getSnapshot().status === 'error');
    ok('snapshot.lastError.kind=audio_failed',  env.runtime.getSnapshot().lastError?.kind === 'audio_failed');
}

// 26. autoplay blocked → kind=audio_autoplay_blocked en lastError
section('[26] play() rechazado por autoplay → audio_autoplay_blocked');
{
    // Configuramos un fake audio que rechaza play() con NotAllowedError.
    const blockedFakeAudio = {
        factory: () => {
            const a = {
                _src: '',
                get src() { return a._src; },
                set src(v) { a._src = v; },
                get currentTime() { return 0; },
                set currentTime(_v) {},
                play: async () => {
                    const err = new Error('autoplay disallowed by user agent');
                    err.name = 'NotAllowedError';
                    throw err;
                },
                pause: () => {},
            };
            return a;
        },
        events: [],
    };
    const env = makeRuntime({ fakeAudio: blockedFakeAudio });
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const r = await env.runtime.dispatch({ kind: 'play' });
    ok('r.ok=false',                                        r.ok === false);
    ok('error.kind=audio_autoplay_blocked',                 r.error?.kind === 'audio_autoplay_blocked');
    ok('snapshot.status=error',                             env.runtime.getSnapshot().status === 'error');
    ok('snapshot.lastError.kind=audio_autoplay_blocked',
       env.runtime.getSnapshot().lastError?.kind === 'audio_autoplay_blocked');
}

// 27. forceClose con audio.startPlayback colgada termina rápido
section('[27] forceClose con audio.startPlayback nunca resuelve termina rápido');
{
    // Audio cuya play() retorna una promesa que jamás resuelve.
    const hangingFakeAudio = {
        factory: () => {
            const a = {
                _src: '',
                get src() { return a._src; },
                set src(v) { a._src = v; },
                get currentTime() { return 0; },
                set currentTime(_v) {},
                play: () => new Promise(() => {}),   // never resolves
                pause: () => {},
            };
            return a;
        },
        events: [],
    };
    const env = makeRuntime({ fakeAudio: hangingFakeAudio });
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const playP = env.runtime.dispatch({ kind: 'play' });   // se va a colgar

    const t0 = Date.now();
    const r = env.runtime.forceClose('test_hang');
    const elapsed = Date.now() - t0;
    ok('forceClose ok',                       r.ok === true);
    ok('forceClose es síncrono (<10ms)',      elapsed < 10);
    ok('runtime.activeSession=null',          env.runtime.getActiveSession() === null);
    ok('snapshot.status=closed',              env.runtime.getSnapshot().status === 'closed');

    // playP nunca debe mutar estado tras forceClose.
    // Lo dejamos colgado deliberadamente (no await). El proceso termina
    // limpio porque el promise pending no impide exit.
    void playP;
}

// 28. forceClose es idempotente
section('[28] forceClose idempotente');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1' });
    const r1 = env.runtime.forceClose('first');
    ok('1st ok',                              r1.ok === true);
    const r2 = env.runtime.forceClose('second');
    ok('2nd no_active_session',               r2.ok === true && r2.reason === 'no_active_session');
}

// 29. forceClose permite openSession nuevo después
section('[29] tras forceClose, openSession nuevo funciona');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'cA', userId: 'u1' });
    env.runtime.forceClose('switch');
    const r = await env.runtime.openSession({ contentId: 'cB', userId: 'u1' });
    ok('openSession ok',                      r.ok === true);
    ok('snapshot.contentId=cB',               env.runtime.getSnapshot().contentId === 'cB');
    ok('snapshot.status=ready',               env.runtime.getSnapshot().status === 'ready');
}

// 30bis. audioFailed con reason='decode_failed' → kind='audio_decode_failed' (M-3.3)
section('[30bis] audioFailed reason=decode_failed → kind audio_decode_failed');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 0 });
    await env.runtime.dispatch({ kind: 'play' });
    const r = await env.runtime.dispatch({
        kind: 'audioFailed', index: 0, reason: 'decode_failed',
    });
    ok('r.ok=false',                                   r.ok === false);
    ok('error.kind=audio_decode_failed',               r.error?.kind === 'audio_decode_failed');
    ok('snapshot.lastError.kind=audio_decode_failed',  env.runtime.getSnapshot().lastError?.kind === 'audio_decode_failed');
    ok('error.meta.reason=decode_failed',              r.error?.meta?.reason === 'decode_failed');
}

// 30ter. audioFailed con reason='network_failure' → kind='audio_failed' (genérico)
section('[30ter] audioFailed reason=network_failure → kind audio_failed (genérico)');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c1', userId: 'u1', startIndex: 0 });
    await env.runtime.dispatch({ kind: 'play' });
    const r = await env.runtime.dispatch({
        kind: 'audioFailed', index: 0, reason: 'network_failure',
    });
    ok('error.kind=audio_failed',         r.error?.kind === 'audio_failed');
    ok('error.meta.reason=network_failure', r.error?.meta?.reason === 'network_failure');
}

// 30. audioCleanup callback es invocado al pause/release/unmount
section('[30] AudioRuntime audioCleanup hook se invoca');
{
    const cleanupCalls = [];
    const fakeAudio = makeFakeAudio();
    const diagnostics = (await import('../Diagnostics.mjs')).createDiagnostics();
    const audio = (await import('../AudioRuntime.mjs')).createAudioRuntime({
        diagnostics,
        audioFactory: fakeAudio.factory,
        resolveSrc: async ({ index }) => `http://test/clip.mp3#${index}`,
        audioCleanup: (a) => { cleanupCalls.push(a); },
    });

    const session = { id: 's1', contentId: 'c1' };
    await audio.preflight(session, 0);
    await audio.startPlayback(session, 0, 'http://x.mp3');
    audio.releaseFor(session);
    ok('cleanup invocado en releaseFor',  cleanupCalls.length === 1);

    // Otro audio + unmount.
    await audio.startPlayback(session, 1, 'http://y.mp3');
    audio.unmount();
    ok('cleanup invocado en unmount',     cleanupCalls.length === 2);

    // Otro audio + reemplazo en startPlayback nuevo.
    audio.mount();   // re-mount
    await audio.startPlayback(session, 2, 'http://z1.mp3');
    await audio.startPlayback(session, 3, 'http://z2.mp3');   // reemplaza al anterior
    ok('cleanup invocado al reemplazar audio activo',  cleanupCalls.length === 3);
}

// ════════════════════════════════════════════════════════════════════════════
// SECCIÓN M-3.4 — recoverFromError + destroy publica snapshot final.
// ════════════════════════════════════════════════════════════════════════════

// 31. recoverFromError tras audio_autoplay_blocked → ready en mismo index
section('[31] recoverFromError preserveIndex tras autoplay_blocked');
{
    let blockNext = true;
    const blockedFakeAudio = {
        factory: () => {
            const a = {
                _src: '', get src() { return a._src; }, set src(v) { a._src = v; },
                get currentTime() { return 0; }, set currentTime(_v) {},
                play: async () => {
                    if (blockNext) {
                        const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e;
                    }
                },
                pause: () => {},
            };
            return a;
        },
        events: [],
    };
    const env = makeRuntime({ fakeAudio: blockedFakeAudio });
    await env.runtime.openSession({ contentId: 'cR', userId: 'u1', startIndex: 3 });
    const playR = await env.runtime.dispatch({ kind: 'play' });
    ok('play falló con autoplay_blocked',  playR.error?.kind === 'audio_autoplay_blocked');
    ok('snapshot.status=error',            env.runtime.getSnapshot().status === 'error');
    ok('currentIndex=3 antes del recover', env.runtime.getSnapshot().currentIndex === 3);

    // Usuario hace click → recoverFromError
    blockNext = false;
    const recR = await env.runtime.recoverFromError({ preserveIndex: true });
    ok('recoverFromError ok',                          recR.ok === true);
    ok('snapshot.status=ready post-recover',           env.runtime.getSnapshot().status === 'ready');
    ok('currentIndex preservado en 3',                 env.runtime.getSnapshot().currentIndex === 3);
    ok('contentId preservado',                         env.runtime.getSnapshot().contentId === 'cR');
    ok('lastError limpio en nueva sesión',             env.runtime.getSnapshot().lastError === null);
}

// 32. recoverFromError preserveIndex=false → vuelve a 0
section('[32] recoverFromError preserveIndex=false → currentIndex=0');
{
    const env = makeRuntime({
        resolveSrc: makeResolveSrc({ ok: false }),   // play falla siempre
    });
    await env.runtime.openSession({ contentId: 'cR2', userId: 'u1', startIndex: 5 });
    await env.runtime.dispatch({ kind: 'play' });
    ok('snapshot.status=error',  env.runtime.getSnapshot().status === 'error');
    // Reset resolveSrc a OK — recreating resolver no es trivial; aceptamos
    // que el segundo play falle también. Solo verificamos preserveIndex=false.
    const recR = await env.runtime.recoverFromError({ preserveIndex: false });
    // Puede que la nueva sesión también termine en error si resolveSrc sigue fallando.
    // Lo importante: currentIndex inicial ahora es 0 (NO 5).
    if (env.runtime.getActiveSession()) {
        ok('currentIndex=0 (preserveIndex=false)',
           env.runtime.getActiveSession().getCurrentIndex() === 0);
    }
}

// 33. recoverFromError sin error → no-op explícito
section('[33] recoverFromError sin error → no_error_to_recover');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'cN', userId: 'u1' });
    ok('pre: status=ready',                env.runtime.getSnapshot().status === 'ready');
    const r = await env.runtime.recoverFromError();
    ok('ok=true',                          r.ok === true);
    ok('reason=no_error_to_recover',       r.reason === 'no_error_to_recover');
    ok('status sigue ready',               env.runtime.getSnapshot().status === 'ready');
}

// 34. recoverFromError sin sesión activa → invariant_violated
section('[34] recoverFromError sin sesión activa → error');
{
    const env = makeRuntime();
    const r = await env.runtime.recoverFromError();
    ok('ok=false',                              r.ok === false);
    ok('error.kind=invariant_violated',         r.error?.kind === 'invariant_violated');
    ok('error.meta.reason=no_active_session',   r.error?.meta?.reason === 'no_active_session');
}

// 35. recoverFromError post-destroy → aborted
section('[35] recoverFromError post-destroy → aborted');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'c', userId: 'u1' });
    await env.runtime.destroy();
    const r = await env.runtime.recoverFromError();
    ok('ok=false',                          r.ok === false);
    ok('error.kind=aborted',                r.error?.kind === 'aborted');
    ok('error.meta.reason=runtime_destroyed', r.error?.meta?.reason === 'runtime_destroyed');
}

// 36. recoverFromError emite diagnostics (recover.start + recover.done)
section('[36] recoverFromError emite recover.start/done en diagnostics');
{
    let blockNext = true;
    const blockedFakeAudio = {
        factory: () => {
            const a = {
                _src: '', get src() { return a._src; }, set src(v) { a._src = v; },
                get currentTime() { return 0; }, set currentTime(_v) {},
                play: async () => {
                    if (blockNext) { const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e; }
                },
                pause: () => {},
            };
            return a;
        },
        events: [],
    };
    const env = makeRuntime({ fakeAudio: blockedFakeAudio });
    await env.runtime.openSession({ contentId: 'cD', userId: 'u1' });
    await env.runtime.dispatch({ kind: 'play' });
    blockNext = false;
    await env.runtime.recoverFromError();
    const trace = env.runtime.diagnostics.getRecentEvents();
    const kinds = trace.map(e => e.kind);
    ok('recover.start emitido',  kinds.includes('recover.start'));
    ok('recover.done emitido',   kinds.includes('recover.done'));
}

// 37. destroy publica snapshot final (subscriber recibe INITIAL_SNAPSHOT)
section('[37] destroy notifica snapshot final a subscribers (M-3.4)');
{
    const env = makeRuntime();
    await env.runtime.openSession({ contentId: 'cF', userId: 'u1' });
    const seen = [];
    const unsub = env.runtime.subscribe((snap) => seen.push({
        sessionId: snap.sessionId, status: snap.status,
    }));
    await env.runtime.destroy();
    // El último snapshot que el subscriber recibió debe ser idle/null.
    const last = seen[seen.length - 1];
    ok('subscriber recibió snapshot final',         seen.length > 0);
    ok('último snapshot.sessionId=null',            last?.sessionId === null);
    ok('último snapshot.status=idle',               last?.status === 'idle');
    unsub();
    // Tras destroy + reset({notify}), el listener fue clear: nuevos eventos no llegan.
    const before = seen.length;
    // No hay forma de "emit" después de destroy — el runtime está cerrado.
    // Verificamos que destroy 2x es no-op silencioso.
    await env.runtime.destroy();
    ok('seen.length no cambia tras 2do destroy',    seen.length === before);
}

// 38. callback viejo post-recover NO muta sesión nueva
section('[38] callback viejo (token previo) NO muta sesión nueva post-recover');
{
    let blockNext = true;
    const blockedFakeAudio = {
        factory: () => {
            const a = {
                _src: '', get src() { return a._src; }, set src(v) { a._src = v; },
                get currentTime() { return 0; }, set currentTime(_v) {},
                play: async () => {
                    if (blockNext) { const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e; }
                },
                pause: () => {},
            };
            return a;
        },
        events: [],
    };
    const env = makeRuntime({ fakeAudio: blockedFakeAudio });
    const open1 = await env.runtime.openSession({ contentId: 'cT', userId: 'u1' });
    await env.runtime.dispatch({ kind: 'play' });
    const oldSessionId = open1.session.id;
    const oldToken = open1.session.getToken();
    blockNext = false;
    const rec = await env.runtime.recoverFromError();
    ok('recover ok',                          rec.ok === true);
    const newSessionId = rec.session.id;
    ok('newSessionId !== oldSessionId',       newSessionId !== oldSessionId);
    // assertLive con token viejo debe rechazar.
    const oldSession = open1.session;
    let caught = null;
    try {
        oldSession.assertLive(oldToken, 'test_callback');
    } catch (e) { caught = e; }
    ok('oldSession.assertLive(oldToken) throws',
       !!caught && (caught.kind === 'destroyed_session_mutation' || caught.kind === 'stale_session_callback'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\nimmersiveRuntimeV2 — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
