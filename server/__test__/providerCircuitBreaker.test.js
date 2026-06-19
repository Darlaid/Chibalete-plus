/**
 * providerCircuitBreaker.test.js — HF4B-2. Pruebas directas de los primitivos
 * del circuit-breaker de proveedor en aiEngine.js.
 *
 * Cómo correr (sin framework, solo Node):
 *   node server/__test__/providerCircuitBreaker.test.js
 *
 * Aislamiento: solo ejercita helpers puros con `now` inyectado. NO llama a
 * OpenAI/Gemini, NO toca red ni filesystem. Cada bloque resetea el estado con
 * _resetBreakers().
 *
 * Cubre:
 *   1. tripBreaker abre el breaker.
 *   2. isBreakerOpen true dentro de la ventana.
 *   3. al pasar now + cooldownMs, isBreakerOpen false (half-open por tiempo).
 *   4. closeBreaker cierra inmediatamente.
 *   5. isQuotaError reconoce 429/quota/rate limit/401/403.
 *   6. isQuotaError NO reconoce TimeoutError / No audio data / network reset.
 *   7. Aislamiento por clave (openai:tts no abre openai:chat ni gemini:tts).
 *   8. getBreakerState expone provider, taskType, open, until, reason, openedAt.
 *   9. _resetBreakers limpia el estado.
 */

import {
    AI_CONFIG,
    _breakerKey,
    isQuotaError,
    isBreakerOpen,
    tripBreaker,
    closeBreaker,
    getBreakerState,
    _resetBreakers,
} from '../aiEngine.js';

let pass = 0;
let fail = 0;

function assert(label, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

const COOLDOWN = AI_CONFIG.breakerCooldownMs;
const T0 = 1_000_000; // reloj base ficticio (ms)

// ── Test 1-3: trip / open dentro de ventana / expiración ─────────────────────
function test1to3() {
    console.log('\n[1-3] trip → open dentro de ventana → expira tras cooldown');
    _resetBreakers();
    assert('cooldown configurado = 300000ms', COOLDOWN === 300000, `cooldown=${COOLDOWN}`);

    assert('antes de trip: cerrado', isBreakerOpen('openai', 'tts', T0) === false);

    tripBreaker('openai', 'tts', '429', T0);
    assert('tras trip: abierto en T0', isBreakerOpen('openai', 'tts', T0) === true);
    assert('abierto justo antes de expirar', isBreakerOpen('openai', 'tts', T0 + COOLDOWN - 1) === true);
    assert('cerrado exactamente en openUntil (>)', isBreakerOpen('openai', 'tts', T0 + COOLDOWN) === false);
    assert('cerrado pasado el cooldown', isBreakerOpen('openai', 'tts', T0 + COOLDOWN + 5000) === false);
}

// ── Test 4: closeBreaker cierra inmediatamente ───────────────────────────────
function test4() {
    console.log('\n[4] closeBreaker cierra inmediatamente');
    _resetBreakers();
    tripBreaker('openai', 'tts', '429', T0);
    assert('abierto antes de close', isBreakerOpen('openai', 'tts', T0) === true);
    const had = closeBreaker('openai', 'tts');
    assert('closeBreaker devuelve true (había entrada)', had === true);
    assert('cerrado inmediatamente tras close', isBreakerOpen('openai', 'tts', T0) === false);
    const hadNone = closeBreaker('openai', 'tts');
    assert('closeBreaker sobre inexistente devuelve false', hadNone === false);
}

// ── Test 5: isQuotaError reconoce cuota/auth/rate ────────────────────────────
function test5() {
    console.log('\n[5] isQuotaError reconoce 429/quota/rate limit/401/403');
    assert('429', isQuotaError('429 You exceeded your current quota') === true);
    assert('quota (texto)', isQuotaError('insufficient_quota: billing') === true);
    assert('rate limit', isQuotaError('Rate limit reached for requests') === true);
    assert('401', isQuotaError('401 Unauthorized') === true);
    assert('403', isQuotaError('403 Forbidden') === true);
    assert('acepta objeto Error', isQuotaError(new Error('429 quota')) === true);
}

// ── Test 6: isQuotaError NO reconoce timeouts/otros ──────────────────────────
function test6() {
    console.log('\n[6] isQuotaError NO reconoce timeout / no audio / reset');
    assert('TimeoutError', isQuotaError('TTS request exceeded 15s timeout') === false);
    assert('TimeoutError (name)', isQuotaError(Object.assign(new Error('aborted'), {})) === false);
    assert('No audio data', isQuotaError('No audio data in Gemini response') === false);
    assert('network reset genérico', isQuotaError('ECONNRESET socket hang up') === false);
    assert('string vacío', isQuotaError('') === false);
    assert('null', isQuotaError(null) === false);
}

// ── Test 7: aislamiento por clave ────────────────────────────────────────────
function test7() {
    console.log('\n[7] aislamiento por clave provider:taskType');
    _resetBreakers();
    assert('_breakerKey formato', _breakerKey('openai', 'tts') === 'openai:tts');

    tripBreaker('openai', 'tts', '429', T0);
    assert('openai:tts abierto', isBreakerOpen('openai', 'tts', T0) === true);
    assert('openai:chat NO afectado', isBreakerOpen('openai', 'chat', T0) === false);
    assert('openai:text_light NO afectado', isBreakerOpen('openai', 'text_light', T0) === false);
    assert('gemini:tts NO afectado', isBreakerOpen('gemini', 'tts', T0) === false);
}

// ── Test 8: getBreakerState expone campos ────────────────────────────────────
function test8() {
    console.log('\n[8] getBreakerState expone provider/taskType/open/until/reason/openedAt');
    _resetBreakers();
    tripBreaker('openai', 'tts', '429', T0);
    const state = getBreakerState(T0);
    assert('un solo breaker', state.length === 1, `len=${state.length}`);
    const e = state[0];
    assert('key', e.key === 'openai:tts');
    assert('provider', e.provider === 'openai');
    assert('taskType', e.taskType === 'tts');
    assert('open=true en T0', e.open === true);
    assert('reason', e.reason === '429');
    assert('until es ISO', typeof e.until === 'string' && e.until === new Date(T0 + COOLDOWN).toISOString());
    assert('openedAt es ISO', typeof e.openedAt === 'string' && e.openedAt === new Date(T0).toISOString());

    // open refleja la expiración según `now`
    const stateLater = getBreakerState(T0 + COOLDOWN + 1);
    assert('open=false pasado el cooldown en getBreakerState', stateLater[0].open === false);
}

// ── Test 9: _resetBreakers limpia ────────────────────────────────────────────
function test9() {
    console.log('\n[9] _resetBreakers limpia el estado');
    _resetBreakers();
    tripBreaker('openai', 'tts', '429', T0);
    tripBreaker('gemini', 'tts', 'quota', T0);
    assert('2 breakers antes de reset', getBreakerState(T0).length === 2);
    _resetBreakers();
    assert('0 breakers tras reset', getBreakerState(T0).length === 0);
    assert('isBreakerOpen false tras reset', isBreakerOpen('openai', 'tts', T0) === false);
}

// ── Runner ───────────────────────────────────────────────────────────────────
(() => {
    console.log('providerCircuitBreaker — HF4B-2');
    const tests = [test1to3, test4, test5, test6, test7, test8, test9];
    for (const t of tests) {
        try { t(); }
        catch (e) { fail++; console.error(`  ✗ ${t.name} lanzó excepción — ${e && e.stack ? e.stack : e}`); }
    }
    console.log('');
    console.log(`providerCircuitBreaker — pass=${pass} fail=${fail}`);
    if (fail > 0) process.exitCode = 1;
})();
