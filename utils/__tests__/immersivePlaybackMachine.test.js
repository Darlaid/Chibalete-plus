/**
 * immersivePlaybackMachine.test.js — Tests puros de la state machine.
 *
 * Cubre los 12 criterios del usuario:
 *   1. No guardar progreso de nextIndex antes de COMMIT_ADVANCE.
 *   2. No emitir sentence_advanced antes de INDEX_COMMIT (ordenados juntos en commit).
 *   3. COMMIT_ADVANCE espera VISUAL_ACK si requireVisualAck=true.
 *   4. PAUSE durante pending cancela pending y mantiene committedIndex.
 *   5. BLOCK_COMPLETE durante pending cancela pending y mantiene committedIndex.
 *   6. SKIP durante pending cancela pending y hace hardResync.
 *   7. AUDIO_ENDED + SCHEDULE_ADVANCE con durationMs=61 → pending sin mover visual.
 *   8. DRIFT_DETECTED recomienda hardResync.
 *   9. UNMOUNT cancela pending.
 *   10. CONTENT_CHANGE resetea (mismatch bloqueado).
 *   11. transitionId viejo no puede commitear.
 *   12. progressIndex nunca > committedIndex.
 *
 * Cómo correr:
 *   node utils/__tests__/immersivePlaybackMachine.test.js
 */

import {
    initialState,
    reduce,
    Actions,
    hasPendingAdvance,
    isDrifting,
    canCommit,
} from '../immersivePlaybackMachine.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function effectTags(effects) {
    return effects.map(e => e.tag ?? e.type);
}

function findEffect(effects, predicate) {
    return effects.find(predicate);
}

const baseInit = { sessionKey: 'u1__c1', contentId: 'c1', startIndex: 45 };

console.log('\nimmersivePlaybackMachine — 12 criterios de aceptación');

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 1 — No guardar progreso de nextIndex antes de COMMIT_ADVANCE
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C1] No puede guardar progreso de nextIndex antes de COMMIT_ADVANCE');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.AUDIO_ENDED, index: 45, durationMs: 3000 }).state;
    const sch = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended', finalDelay: 1400, floorRemaining: 0, rhythmMs: 50, now: 1000 });
    s = sch.state;
    ok('Después de SCHEDULE_ADVANCE: visualIndex sigue en 45, committedIndex sigue en 45',
       s.visualIndex === 45 && s.committedIndex === 45);
    ok('pendingTransition fue creada con toIndex=46',
       s.pendingTransition !== null && s.pendingTransition.toIndex === 46);

    // Intentar guardar progreso de 46 mientras hay pending → BLOCKED
    const saveAttempt = reduce(s, { type: Actions.SAVE_PROGRESS_REQUEST, index: 46 });
    ok('SAVE_PROGRESS_REQUEST(46) → tag progress_save_blocked_pending',
       effectTags(saveAttempt.effects).includes('progress_save_blocked_pending'));
    ok('No emite effect save_progress',
       !effectTags(saveAttempt.effects).includes('save_progress'));
    ok('progressIndex sigue en 45',
       saveAttempt.state.progressIndex === 45);

    // SAVE_PROGRESS_REQUEST(45) sí es legítimo (committed sigue siendo 45)
    const saveOk = reduce(s, { type: Actions.SAVE_PROGRESS_REQUEST, index: 45 });
    ok('SAVE_PROGRESS_REQUEST(45) sí emite save_progress',
       findEffect(saveOk.effects, e => e.type === 'save_progress') !== undefined);
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 2 — Orden index_commit ANTES de sentence_advanced
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C2] COMMIT_ADVANCE emite index_commit antes de sentence_advanced');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended', now: 1000 }).state;
    const commitResult = reduce(s, { type: Actions.COMMIT_ADVANCE, transitionId: s.pendingTransition.id });
    const tags = effectTags(commitResult.effects);
    const iCommit   = tags.indexOf('index_commit');
    const iAdvanced = tags.indexOf('sentence_advanced');
    ok('COMMIT_ADVANCE emite index_commit y sentence_advanced',
       iCommit >= 0 && iAdvanced >= 0,
       `tags=${tags.join(',')}`);
    ok('index_commit aparece ANTES de sentence_advanced',
       iCommit < iAdvanced,
       `index_commit en pos ${iCommit}, sentence_advanced en pos ${iAdvanced}`);
    ok('Tras commit, visualIndex=46, committedIndex=46',
       commitResult.state.visualIndex === 46 && commitResult.state.committedIndex === 46);
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 3 (M-5.4.6 Phase 1.b.4) — VISUAL_ACK ELIMINADO.
// Las assertions originales exigían que COMMIT_ADVANCE se bloqueara hasta
// recibir VISUAL_ACK. Ese gate violaba el nuevo INV "playback must never
// wait for render confirmation". La action queda como deprecated no-op.
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C3] (M-5.4.6) VISUAL_ACK action eliminada — sólo emite deprecated log');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended', requireVisualAck: true }).state;

    // VISUAL_ACK ahora es no-op — devuelve state sin mutar y un log deprecated.
    const ackResult = reduce(s, { type: Actions.VISUAL_ACK, index: 46 });
    ok('VISUAL_ACK devuelve state sin mutar (deprecated)',
       ackResult.state === s);
    ok('VISUAL_ACK emite PB_VISUAL_HIGHLIGHT_ACK_DEPRECATED',
       ackResult.effects.some(e => e.tag === 'PB_VISUAL_HIGHLIGHT_ACK_DEPRECATED'));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 4 — PAUSE durante pending
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C4] PAUSE durante pending cancela y mantiene committedIndex');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;
    ok('Antes de PAUSE: hay pendingTransition', s.pendingTransition !== null);

    const pauseResult = reduce(s, { type: Actions.PAUSE });
    ok('Tras PAUSE: pendingTransition es null',
       pauseResult.state.pendingTransition === null);
    ok('Tras PAUSE: status=paused',
       pauseResult.state.status === 'paused');
    ok('Tras PAUSE: committedIndex sigue en 45 (no toca el next)',
       pauseResult.state.committedIndex === 45);
    ok('Tras PAUSE: emite pending_advance_cancelled reason=pause',
       pauseResult.effects.some(e => e.tag === 'pending_advance_cancelled' && e.data?.reason === 'pause'));
    ok('Tras PAUSE: emite playback_paused con index=45',
       pauseResult.effects.some(e => e.tag === 'playback_paused' && e.data?.index === 45));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 5 — BLOCK_COMPLETE durante pending
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C5] BLOCK_COMPLETE durante pending cancela y mantiene committedIndex');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;
    const bcResult = reduce(s, { type: Actions.BLOCK_COMPLETE });
    ok('Tras BLOCK_COMPLETE: status=block_completed',
       bcResult.state.status === 'block_completed');
    ok('Tras BLOCK_COMPLETE: pendingTransition=null',
       bcResult.state.pendingTransition === null);
    ok('Tras BLOCK_COMPLETE: committedIndex sigue en 45',
       bcResult.state.committedIndex === 45);
    ok('Tras BLOCK_COMPLETE: emite pending_advance_cancelled reason=block_complete',
       bcResult.effects.some(e => e.tag === 'pending_advance_cancelled' && e.data?.reason === 'block_complete'));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 6 — SKIP durante pending hace hardResync
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C6] SKIP durante pending cancela y hace hard resync');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;
    const skipResult = reduce(s, { type: Actions.SKIP, targetIndex: 30 });
    ok('Tras SKIP: status=loading',
       skipResult.state.status === 'loading');
    ok('Tras SKIP: visualIndex=30 (atómico)',
       skipResult.state.visualIndex === 30);
    ok('Tras SKIP: committedIndex=30 (atómico)',
       skipResult.state.committedIndex === 30);
    ok('Tras SKIP: audioIndex=30 (atómico)',
       skipResult.state.audioIndex === 30);
    ok('Tras SKIP: pendingTransition=null',
       skipResult.state.pendingTransition === null);
    // M-5.4.6 (Case 4) — MA.SKIP ya NO emite hard_resync ni HARD_RESYNC effect.
    // Manual nav (next/prev) es un gesto deterministico, no un recovery.
    ok('M-5.4.6 — Tras SKIP: NO emite tag hard_resync',
       !skipResult.effects.some(e => e.tag === 'hard_resync'));
    ok('M-5.4.6 — Tras SKIP: NO emite HARD_RESYNC effect',
       !skipResult.effects.some(e => e.type === 'HARD_RESYNC'));
    ok('M-5.4.6 — Tras SKIP: emite tag manual_nav_commit',
       skipResult.effects.some(e => e.tag === 'manual_nav_commit' && e.data?.to === 30));
    ok('M-5.4.6 — Tras SKIP: emite cancel_pending reason=manual_nav',
       skipResult.effects.some(e => e.type === 'cancel_pending' && e.reason === 'manual_nav'));
    ok('Tras SKIP: emite load_audio index=30 autoPlay=true',
       skipResult.effects.some(e => e.type === 'load_audio' && e.index === 30 && e.autoPlay === true));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 7 — AUDIO_ENDED + SCHEDULE_ADVANCE con durationMs=61
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C7] AUDIO_ENDED+SCHEDULE con duration=61 → pending sin tocar visual');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 53 }).state;
    const ended = reduce(s, { type: Actions.AUDIO_ENDED, index: 53, durationMs: 61 });
    ok('AUDIO_ENDED emite sentence_time con durationMs=61',
       ended.effects.some(e => e.tag === 'sentence_time' && e.data?.durationMs === 61));
    ok('AUDIO_ENDED por sí solo NO crea pendingTransition',
       ended.state.pendingTransition === null);
    ok('AUDIO_ENDED por sí solo NO cambia visualIndex (sigue en 53)',
       ended.state.visualIndex === 53);

    // Caller debe llamar SCHEDULE_ADVANCE con floor
    const sched = reduce(ended.state, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 53, toIndex: 54, reason: 'audio_ended', floorRemaining: 1339, rhythmMs: 50, finalDelay: 1339, now: 1000 });
    ok('SCHEDULE con floor=1339 → pendingTransition creada',
       sched.state.pendingTransition !== null);
    ok('Durante pending: visualIndex sigue en 53',
       sched.state.visualIndex === 53);
    ok('Durante pending: committedIndex sigue en 53',
       sched.state.committedIndex === 53);
    ok('minCommitAt = now + max(floor, rhythm) = 1000+1339',
       sched.state.pendingTransition.minCommitAt === 2339,
       `got ${sched.state.pendingTransition.minCommitAt}`);
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 8 — DRIFT_DETECTED recomienda hardResync
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C8] DRIFT_DETECTED loguea y recomienda hard_resync');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    const drift = reduce(s, { type: Actions.DRIFT_DETECTED, observed: 47 });
    ok('DRIFT_DETECTED emite log index_drift_detected',
       drift.effects.some(e => e.tag === 'index_drift_detected'));
    ok('DRIFT_DETECTED emite recommend_hard_resync con committedIndex',
       drift.effects.some(e => e.type === 'recommend_hard_resync' && e.index === 45));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 9 — UNMOUNT cancela pending
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C9] UNMOUNT cancela pending y limpia estado');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;
    const um = reduce(s, { type: Actions.UNMOUNT });
    ok('UNMOUNT: pendingTransition=null',
       um.state.pendingTransition === null);
    ok('UNMOUNT: status=idle',
       um.state.status === 'idle');
    ok('UNMOUNT: emite cancel_pending reason=unmount',
       um.effects.some(e => e.type === 'cancel_pending' && e.reason === 'unmount'));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 10 — CONTENT_CHANGE resetea
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C10] CONTENT_CHANGE resetea y bloquea cross-content');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;

    const cc = reduce(s, { type: Actions.CONTENT_CHANGE, contentId: 'c2', sessionKey: 'u1__c2', startIndex: 0 });
    ok('CONTENT_CHANGE: contentId nuevo',
       cc.state.contentId === 'c2');
    ok('CONTENT_CHANGE: sessionKey nueva',
       cc.state.sessionKey === 'u1__c2');
    ok('CONTENT_CHANGE: committedIndex=0',
       cc.state.committedIndex === 0);
    ok('CONTENT_CHANGE: visualIndex=0',
       cc.state.visualIndex === 0);
    ok('CONTENT_CHANGE: pendingTransition=null',
       cc.state.pendingTransition === null);
    ok('CONTENT_CHANGE: emite cancel_pending',
       cc.effects.some(e => e.type === 'cancel_pending'));
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 11 — transitionId viejo no puede commitear
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C11] COMMIT_ADVANCE con transitionId stale → commit_rejected');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;
    const firstId = s.pendingTransition.id;

    // SKIP cancela y crea uno nuevo implícitamente (al re-schedule, sería otro id)
    s = reduce(s, { type: Actions.SKIP, targetIndex: 50 }).state;
    s = reduce(s, { type: Actions.START_PLAY, index: 50 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 50, toIndex: 51, reason: 'audio_ended' }).state;
    const newId = s.pendingTransition.id;

    ok('Nuevo transitionId > viejo',
       newId > firstId);

    // Intentar commit con el viejo transitionId → rejected
    const staleCommit = reduce(s, { type: Actions.COMMIT_ADVANCE, transitionId: firstId });
    ok('COMMIT_ADVANCE con transitionId viejo → commit_rejected reason=stale_transitionId',
       staleCommit.effects.some(e => e.tag === 'commit_rejected' && e.data?.reason === 'stale_transitionId'));
    ok('Estado intacto tras commit_rejected',
       staleCommit.state.committedIndex === 50 && staleCommit.state.pendingTransition?.id === newId);
}

// ───────────────────────────────────────────────────────────────────────────
// CRITERIO 12 — progressIndex nunca > committedIndex
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C12] progressIndex nunca puede ser mayor que committedIndex');

{
    let s = initialState(baseInit);
    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    // Intentar guardar progreso 100 cuando committedIndex es 45 → bloqueado
    const r = reduce(s, { type: Actions.SAVE_PROGRESS_REQUEST, index: 100 });
    ok('SAVE_PROGRESS_REQUEST(100) con committedIndex=45 → bloqueado',
       r.effects.some(e => e.tag === 'progress_save_blocked_pending'));
    ok('progressIndex NO se actualiza',
       r.state.progressIndex === 45);

    // Progreso 45 (== committedIndex) → permitido
    const okSave = reduce(s, { type: Actions.SAVE_PROGRESS_REQUEST, index: 45 });
    ok('SAVE_PROGRESS_REQUEST(45) con committedIndex=45 → permitido',
       okSave.effects.some(e => e.tag === 'progress_save_allowed'));

    // Progreso 44 (menor a committedIndex) → permitido (monotonic forward)
    const okPast = reduce(s, { type: Actions.SAVE_PROGRESS_REQUEST, index: 44 });
    ok('SAVE_PROGRESS_REQUEST(44) con committedIndex=45 → permitido (monotonic)',
       okPast.effects.some(e => e.tag === 'progress_save_allowed'));
    ok('progressIndex se mantiene en max(prev, 44) = 45 (monotonic upward)',
       okPast.state.progressIndex === 45);
}

// ───────────────────────────────────────────────────────────────────────────
// SELECTORS — sanity checks
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[selectors] hasPendingAdvance / isDrifting / canCommit');

{
    let s = initialState(baseInit);
    ok('Estado inicial: hasPendingAdvance=false', !hasPendingAdvance(s));
    ok('Estado inicial: isDrifting=false', !isDrifting(s));
    ok('Estado inicial: canCommit=false', !canCommit(s));

    s = reduce(s, { type: Actions.START_PLAY, index: 45 }).state;
    s = reduce(s, { type: Actions.SCHEDULE_ADVANCE, fromIndex: 45, toIndex: 46, reason: 'audio_ended' }).state;
    ok('Tras SCHEDULE: hasPendingAdvance=true', hasPendingAdvance(s));
    ok('Tras SCHEDULE: canCommit=true (sin requireVisualAck)', canCommit(s));

    // Simular drift: visualIndex manualmente desincronizado (no debería pasar
    // por flujo normal, pero el selector debe detectarlo)
    const drifty = { ...s, pendingTransition: null, visualIndex: 47, committedIndex: 45 };
    ok('Estado drifty: isDrifting=true', isDrifting(drifty));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
