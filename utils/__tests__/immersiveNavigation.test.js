/**
 * immersiveNavigation.test.js — Pruebas unitarias de INVARIANTE 2.
 *
 * REGRESION GUARD principal del incidente 1 (salto entre libros). Si esta
 * suite falla, alguien volvió a abrir una vía de auto-navegación entre
 * contentIds distintos sin acción del usuario.
 *
 * Cómo correr:
 *   node utils/__tests__/immersiveNavigation.test.js
 */

import {
    assertManualNavigation,
    isAllowedManualNavReason,
    MANUAL_NAVIGATION_REASONS,
} from '../immersiveNavigation.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function throws(label, fn) {
    try { fn(); ok(label, false, 'expected throw'); }
    catch { ok(label, true); }
}

console.log('\nimmersiveNavigation — INVARIANTE 2');

console.log('\n[INV-2] Whitelist de razones manuales');

ok('"user_click_next" es allowed',
   isAllowedManualNavReason('user_click_next'));
ok('"user_click_book_card" es allowed',
   isAllowedManualNavReason('user_click_book_card'));
ok('"user_explicit_navigation" es allowed',
   isAllowedManualNavReason('user_explicit_navigation'));

ok('"block_complete" NO es allowed (INV-2 — incidente 1)',
   !isAllowedManualNavReason('block_complete'));
ok('"session_end" NO es allowed (INV-2 — incidente 1)',
   !isAllowedManualNavReason('session_end'));
ok('"audio_ended" NO es allowed',
   !isAllowedManualNavReason('audio_ended'));
ok('"content_queue_auto" NO es allowed (INV-12)',
   !isAllowedManualNavReason('content_queue_auto'));
ok('"" (vacío) NO es allowed',
   !isAllowedManualNavReason(''));
ok('undefined NO es allowed',
   !isAllowedManualNavReason(undefined));

ok('MANUAL_NAVIGATION_REASONS es read-only',
   Object.isFrozen(MANUAL_NAVIGATION_REASONS));

console.log('\n[INV-2] assertManualNavigation — bloqueo de cross-content sin reason');

ok('mismo contentId siempre se permite (refresh, reload)',
   assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-A',
       reason:        'block_complete',
   }).ok === true);

ok('cross-content con reason manual → ok',
   assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
       reason:        'user_click_next',
   }).ok === true);

ok('cross-content con reason "block_complete" → BLOCKED (incidente 1)',
   assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
       reason:        'block_complete',
   }).ok === false);

ok('cross-content con reason "session_end" → BLOCKED',
   assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
       reason:        'session_end',
   }).ok === false);

ok('cross-content con reason inventado → BLOCKED',
   assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
       reason:        'looked_legitimate',
   }).ok === false);

ok('cross-content sin reason → BLOCKED',
   assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
   }).ok === false);

console.log('\n[INV-2] en dev/test, asserts LANZAN para regresión');

throws('cross-content sin reason en dev → throw FATAL',
   () => assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
       reason:        'audio_ended',
       isDev:         true,
   }));

throws('cross-content con reason "auto" en dev → throw FATAL',
   () => assertManualNavigation({
       fromContentId: 'content-A',
       toContentId:   'content-B',
       reason:        'auto',
       source:        'BlockEngine.complete',
       isDev:         true,
   }));

// REGRESION GUARDS — incidente real
console.log('\n[INV-2] REGRESION GUARD — incidente 1 (Alicia → Libro de la Selva)');

ok('content-1773325007384 → content-1775664683377 sin reason → BLOCKED',
   assertManualNavigation({
       fromContentId: 'content-1773325007384',
       toContentId:   'content-1775664683377',
       reason:        'block_complete',
       source:        'BlockEngine.complete',
   }).ok === false);

ok('content-1773325007384 → content-1775664683377 con click manual → ok',
   assertManualNavigation({
       fromContentId: 'content-1773325007384',
       toContentId:   'content-1775664683377',
       reason:        'user_click_next',
       source:        'banner_proximo_button',
   }).ok === true);

throws('REGRESION GUARD: si alguien reabre BlockEngine.complete → throw en dev',
   () => assertManualNavigation({
       fromContentId: 'content-1773325007384',
       toContentId:   'content-1775664683377',
       reason:        'block_complete',
       source:        'BlockEngine.complete',
       isDev:         true,
   }));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
