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
    evaluateRecoveryCoherence,
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

// ───────────────────────────────────────────────────────────────────────────
// 5. HF4A-R2 — evaluateRecoveryCoherence (regla rectora de triple coherencia)
//    Estos casos modelan, a nivel de decisión PURA, los escenarios de race que
//    el deploy fallido de HF4A no contemplaba.
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[5] evaluateRecoveryCoherence — triple coherencia (token/índice/completion)');

// Caso positivo: todo coherente → ok, reason 'coherent'. (HIT 200 sobre la
// frase activa, generación vigente, sesión no completada → recuperar.)
{
    const r = evaluateRecoveryCoherence({
        requestedIndex: 12, currentIndex: 12, token: 5, currentToken: 5, sessionCompleted: false,
    });
    ok('coherente (idx=idx, token=token, !completed) → ok', r.ok === true, JSON.stringify(r));
    ok('coherente → reason "coherent"', r.reason === 'coherent');
}

// Caso 1 — navegación manual durante getAudioUrl pendiente: el índice se movió.
{
    const r = evaluateRecoveryCoherence({
        requestedIndex: 12, currentIndex: 18, token: 5, currentToken: 5, sessionCompleted: false,
    });
    ok('índice movido (12→18) → NO ok', r.ok === false);
    ok('índice movido → reason "index_moved"', r.reason === 'index_moved');
}

// Caso 2 — same-chunk: el token NO cambió (manualSentenceJump same-chunk no
// bumpea loadToken) pero el índice SÍ. La triple coherencia lo detecta igual.
{
    const r = evaluateRecoveryCoherence({
        requestedIndex: 12, currentIndex: 13, token: 7, currentToken: 7, sessionCompleted: false,
    });
    ok('same-chunk: token igual pero índice movido → NO ok (cubre hueco)', r.ok === false);
    ok('same-chunk: reason "index_moved" pese a token vigente', r.reason === 'index_moved');
}

// Token stale — una carga más nueva invalidó la actual.
{
    const r = evaluateRecoveryCoherence({
        requestedIndex: 12, currentIndex: 12, token: 5, currentToken: 6, sessionCompleted: false,
    });
    ok('token stale (5≠6) → NO ok', r.ok === false);
    ok('token stale → reason "stale_token" (precede a índice/completion)', r.reason === 'stale_token');
}

// Caso 4 — completion: misma frase y token, pero la sesión ya terminó.
{
    const r = evaluateRecoveryCoherence({
        requestedIndex: 12, currentIndex: 12, token: 5, currentToken: 5, sessionCompleted: true,
    });
    ok('sesión completada → NO ok', r.ok === false);
    ok('sesión completada → reason "session_completed"', r.reason === 'session_completed');
}

// Orden de precedencia: token > índice > completion (todos rotos → gana token).
{
    const r = evaluateRecoveryCoherence({
        requestedIndex: 12, currentIndex: 99, token: 1, currentToken: 2, sessionCompleted: true,
    });
    ok('precedencia: todo roto → reason "stale_token" (chequeo más barato primero)', r.reason === 'stale_token');
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
