/**
 * immersiveAudioRecovery.test.mjs — HF4A.
 *
 * Ejercita el HELPER REAL (utils/immersiveAudioRecovery.mjs) que el hook
 * importa y usa. No es simulación.
 *
 * Cobertura:
 *   1. no_url / timeout / abort → recuperable.
 *   2. decode / NotSupportedError → persistente.
 *   3. shouldClearFailure(reason, hasValidUrl).
 *   4. límites de reintento / ausencia de loops (canRetryAfterFailure).
 *
 * Cómo correr:
 *   node utils/__tests__/immersiveAudioRecovery.test.mjs
 */

import {
    classifyAudioFailure,
    isRecoverableFailure,
    isPersistentFailure,
    shouldClearFailure,
    canRetryAfterFailure,
    RECOVERABLE_REASONS,
    PERSISTENT_REASONS,
} from '../immersiveAudioRecovery.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

console.log('\nimmersiveAudioRecovery — HF4A (clasificación + clear-on-valid-url)');

// ───────────────────────────────────────────────────────────────────────────
// 1. Recuperables
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1] no_url / timeout / abort → recuperable');

for (const r of ['no_url', 'timeout', 'TimeoutError', 'abort', 'AbortError']) {
    ok(`classify("${r}") === recoverable`, classifyAudioFailure(r) === 'recoverable');
    ok(`isRecoverableFailure("${r}") === true`, isRecoverableFailure(r) === true);
    ok(`isPersistentFailure("${r}") === false`, isPersistentFailure(r) === false);
}

ok('null → recoverable (default seguro)', classifyAudioFailure(null) === 'recoverable');
ok('undefined → recoverable (default seguro)', classifyAudioFailure(undefined) === 'recoverable');
ok('motivo desconocido → recoverable', classifyAudioFailure('weird_unknown_reason') === 'recoverable');
ok('RECOVERABLE_REASONS incluye no_url', RECOVERABLE_REASONS.includes('no_url'));

// ───────────────────────────────────────────────────────────────────────────
// 2. Persistentes
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[2] decode / NotSupportedError → persistente');

for (const r of ['decode', 'NotSupportedError', 'EncodingError']) {
    ok(`classify("${r}") === persistent`, classifyAudioFailure(r) === 'persistent');
    ok(`isPersistentFailure("${r}") === true`, isPersistentFailure(r) === true);
    ok(`isRecoverableFailure("${r}") === false`, isRecoverableFailure(r) === false);
}
ok('PERSISTENT_REASONS incluye NotSupportedError', PERSISTENT_REASONS.includes('NotSupportedError'));

// ───────────────────────────────────────────────────────────────────────────
// 3. shouldClearFailure(reason, hasValidUrl) — la regla central
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] shouldClearFailure(reason, hasValidUrl)');

// El caso del bug: timeout previo + URL válida (HIT 200) → limpiar.
ok('no_url + hasValidUrl=true → CLEAR', shouldClearFailure('no_url', true) === true);
ok('timeout + hasValidUrl=true → CLEAR', shouldClearFailure('timeout', true) === true);
ok('abort + hasValidUrl=true → CLEAR', shouldClearFailure('abort', true) === true);

// Sin URL válida nunca se limpia (no hay evidencia de recuperación).
ok('no_url + hasValidUrl=false → NO clear', shouldClearFailure('no_url', false) === false);
ok('timeout + hasValidUrl=false → NO clear', shouldClearFailure('timeout', false) === false);

// Persistente: ni con URL válida (evita loop sobre blob corrupto).
ok('NotSupportedError + hasValidUrl=true → NO clear', shouldClearFailure('NotSupportedError', true) === false);
ok('decode + hasValidUrl=true → NO clear', shouldClearFailure('decode', true) === false);
ok('NotSupportedError + hasValidUrl=false → NO clear', shouldClearFailure('NotSupportedError', false) === false);

// Default seguro: motivo nulo + URL válida → recuperable → clear.
ok('null + hasValidUrl=true → CLEAR (default recuperable)', shouldClearFailure(null, true) === true);

// ───────────────────────────────────────────────────────────────────────────
// 4. Límites de reintento / ausencia de loops
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] canRetryAfterFailure — sin loops sobre blob corrupto');

// Persistente: primer retry permitido, segundo NO (audioRetriedKeysRef cap).
ok('persistente + alreadyRetried=false → retry permitido', canRetryAfterFailure('NotSupportedError', false) === true);
ok('persistente + alreadyRetried=true → retry BLOQUEADO', canRetryAfterFailure('NotSupportedError', true) === false);

// Recuperable: reintentable (acotado por gesto del usuario / fetch fresco).
ok('recuperable + alreadyRetried=false → retry permitido', canRetryAfterFailure('no_url', false) === true);
ok('recuperable + alreadyRetried=true → retry permitido', canRetryAfterFailure('timeout', true) === true);

// Invariante anti-loop: un persistente agotado nunca vuelve a true.
let loopGuardHolds = true;
for (let i = 0; i < 5; i++) {
    if (canRetryAfterFailure('NotSupportedError', true) !== false) { loopGuardHolds = false; break; }
}
ok('persistente agotado: canRetryAfterFailure estable en false (no loop)', loopGuardHolds);

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
