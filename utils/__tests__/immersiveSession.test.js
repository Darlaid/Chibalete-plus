/**
 * immersiveSession.test.js — Pruebas unitarias de INVARIANTES 1, 3, 4.
 *
 * Cómo correr:
 *   node utils/__tests__/immersiveSession.test.js
 */

import {
    buildSessionKey,
    buildNamespacedStorageKey,
    isForbiddenStorageKey,
    FORBIDDEN_STORAGE_KEY_PATTERNS,
    assertImmersiveSessionActive,
} from '../immersiveSession.js';

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

console.log('\nimmersiveSession — INVARIANTES 1, 3, 4');

// ───────────────────────────────────────────────────────────────────────────
// INV 3 — sessionKey + namespacing
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-3] sessionKey + storage namespacing');

ok('buildSessionKey(user, content) → "user__content"',
   buildSessionKey('user-1', 'content-A') === 'user-1__content-A');

ok('buildSessionKey con userId undefined → "guest__content"',
   buildSessionKey(undefined, 'content-A') === 'guest__content-A');

ok('buildSessionKey con contentId null → "user__unknown"',
   buildSessionKey('user-1', null) === 'user-1__unknown');

ok('buildNamespacedStorageKey produce path completo',
   buildNamespacedStorageKey('user-1', 'content-A', 'progress') === 'immersive:user-1:content-A:progress');

ok('Distintos usuarios producen keys distintas',
   buildNamespacedStorageKey('user-1', 'X', 'leo_session') !==
   buildNamespacedStorageKey('user-2', 'X', 'leo_session'));

ok('Distintos contentIds producen keys distintas',
   buildNamespacedStorageKey('user-1', 'A', 'progress') !==
   buildNamespacedStorageKey('user-1', 'B', 'progress'));

console.log('\n[INV-3] storage keys prohibidas (regresión guard)');

ok('"immersiveProgress" es prohibida',
   isForbiddenStorageKey('immersiveProgress'));
ok('"currentContent" es prohibida',
   isForbiddenStorageKey('currentContent'));
ok('"activeBook" es prohibida',
   isForbiddenStorageKey('activeBook'));
ok('"lastPlayback" es prohibida',
   isForbiddenStorageKey('lastPlayback'));
ok('"currentSentenceIndex" es prohibida',
   isForbiddenStorageKey('currentSentenceIndex'));
ok('"playbackState" es prohibida',
   isForbiddenStorageKey('playbackState'));
ok('"leo_session_content-XYZ" (legacy sin userId) es prohibida',
   isForbiddenStorageKey('leo_session_content-1773089901847'));
ok('"immersive:user-1:content-A:progress" NO es prohibida',
   !isForbiddenStorageKey('immersive:user-1:content-A:progress'));
ok('"leo_session_user-1_content-A" (namespaced legacy) NO es prohibida',
   !isForbiddenStorageKey('leo_session_user-1_content-A'));

ok('FORBIDDEN_STORAGE_KEY_PATTERNS es read-only (frozen)',
   Object.isFrozen(FORBIDDEN_STORAGE_KEY_PATTERNS));

// ───────────────────────────────────────────────────────────────────────────
// INV 4 — assertImmersiveSessionActive
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-4] assertImmersiveSessionActive — guards anti-stale');

const baseScenario = {
    source: 'unit_test',
    sourceContentId: 'content-A',
    sourceSessionKey: 'user-1__content-A',
    routeContentId: 'content-A',
    activeContentId: 'content-A',
    activeSessionKey: 'user-1__content-A',
};

ok('Callback con todo activo → ok=true',
   assertImmersiveSessionActive({ ...baseScenario }).ok === true);

ok('Callback con contentId distinto al activo → ok=false (INV-1 + INV-4)',
   assertImmersiveSessionActive({
       ...baseScenario,
       sourceContentId: 'content-OLD',
   }).ok === false);

ok('Callback con sessionKey distinta → ok=false',
   assertImmersiveSessionActive({
       ...baseScenario,
       sourceSessionKey: 'user-OLD__content-A',
   }).ok === false);

ok('Callback con signal.aborted → ok=false',
   assertImmersiveSessionActive({ ...baseScenario, aborted: true }).ok === false);

ok('Callback después de unmount → ok=false',
   assertImmersiveSessionActive({ ...baseScenario, unmounted: true }).ok === false);

ok('routeContentId divergente de activeContentId → ok=false (INV-1 fatal)',
   assertImmersiveSessionActive({
       ...baseScenario,
       routeContentId: 'content-OTHER',
   }).ok === false);

console.log('\n[INV-4] en dev/test, guards LANZAN para detectar regresión');

throws('contentId mismatch en dev → throw',
   () => assertImmersiveSessionActive({
       ...baseScenario,
       sourceContentId: 'content-OLD',
       isDev: true,
   }));

throws('sessionKey mismatch en dev → throw',
   () => assertImmersiveSessionActive({
       ...baseScenario,
       sourceSessionKey: 'user-OLD__content-A',
       isDev: true,
   }));

throws('aborted en dev → throw',
   () => assertImmersiveSessionActive({ ...baseScenario, aborted: true, isDev: true }));

throws('unmounted en dev → throw',
   () => assertImmersiveSessionActive({ ...baseScenario, unmounted: true, isDev: true }));

throws('route/active divergence en dev → throw (FATAL)',
   () => assertImmersiveSessionActive({
       ...baseScenario,
       routeContentId: 'content-OTHER',
       isDev: true,
   }));

// REGRESION GUARDS — incidentes específicos:
console.log('\n[INV-1, INV-4] REGRESION GUARDS — incidentes históricos');

ok('INCIDENTE 1: progreso de otro contentId NO puede mutar visor activo',
   assertImmersiveSessionActive({
       source: 'fetchAndMergeRemoteProgress',
       sourceContentId: 'content-1773325007384',
       sourceSessionKey: 'user-1__content-1773325007384',
       routeContentId:   'content-1775664683377',
       activeContentId:  'content-1775664683377',
       activeSessionKey: 'user-1__content-1775664683377',
   }).ok === false);

ok('INCIDENTE 1: callback de StartupEngine viejo NO puede mutar visor de nuevo libro',
   assertImmersiveSessionActive({
       source: 'StartupEngine.subscribe',
       sourceContentId: 'content-OLD',
       sourceSessionKey: 'user-1__content-OLD',
       routeContentId:   'content-NEW',
       activeContentId:  'content-NEW',
       activeSessionKey: 'user-1__content-NEW',
   }).ok === false);

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
