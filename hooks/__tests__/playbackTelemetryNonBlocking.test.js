/**
 * playbackTelemetryNonBlocking.test.js — F17 (telemetría no bloqueante).
 *
 * Verifica que pbLog cumple las reglas de F17:
 *   - sanitizar payload (no enviar sin userId);
 *   - dedupe por event tag tras un 400 (no spam);
 *   - try/catch global (playback nunca depende de telemetry);
 *   - x-user-id header.
 *
 * Cobertura (8 criterios del spec del usuario):
 *
 *   1. _sanitizeAndStringify rechaza payload sin userId.
 *   2. _sanitizeAndStringify rechaza userId === 'guest'.
 *   3. _sanitizeAndStringify retorna null si JSON.stringify throws.
 *   4. _telemetryFailedTags Set de dedupe declarado.
 *   5. fetch incluye header x-user-id.
 *   6. Si _telemetryFailedTags.has(event), early return (no fetch).
 *   7. fetch envuelto en try/catch global.
 *   8. .catch del fetch swallow (no throw).
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackTelemetryNonBlocking.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const hookSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');

console.log('\nplaybackTelemetryNonBlocking — F17 (telemetría no bloqueante)');

// ───────────────────────────────────────────────────────────────────────────
// 1-3. _sanitizeAndStringify
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1-3] _sanitizeAndStringify rechaza payloads inválidos');

ok('Hook define _sanitizeAndStringify',
   /function\s+_sanitizeAndStringify\s*\(\s*payload:\s*Record<string,\s*unknown>\s*\)\s*:\s*string\s*\|\s*null/.test(hookSrc));

const sanitizeBody = hookSrc.match(/function\s+_sanitizeAndStringify[\s\S]+?\n\}/);
if (!sanitizeBody) {
    ok('cuerpo de _sanitizeAndStringify localizable', false);
} else {
    const body = sanitizeBody[0];

    ok('Rechaza si !payload.userId',
       /!payload\.userId/.test(body));
    ok('Rechaza si payload.userId === ""',
       /payload\.userId\s*===\s*['"]['"]/.test(body));
    ok('Rechaza si payload.userId === "guest"',
       /payload\.userId\s*===\s*['"]guest['"]/.test(body));

    ok('JSON.stringify dentro de try/catch',
       /try\s*\{[\s\S]{0,150}?JSON\.stringify[\s\S]{0,150}?\}\s*catch/.test(body));

    ok('Retorna null en catch',
       /catch[\s\S]{0,100}?return\s+null/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// 4. _telemetryFailedTags Set declarado
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[4] _telemetryFailedTags Set de dedupe');

ok('Hook declara _telemetryFailedTags como Set<string>',
   /const\s+_telemetryFailedTags\s*=\s*new\s+Set<string>\s*\(\s*\)/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 5. fetch incluye header x-user-id
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[5] fetch a /api/events incluye header x-user-id');

ok('fetch /api/events incluye header x-user-id',
   /fetch\s*\(\s*['"]\/api\/events['"][\s\S]{0,500}?['"]x-user-id['"]:\s*userIdHeader/.test(hookSrc));

ok('userIdHeader derivado de String(payload.userId)',
   /userIdHeader\s*=\s*String\s*\(\s*payload\.userId/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 6. Dedupe por event tag (early return)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[6] Dedupe: si tag ya falló, early return sin fetch');

ok('pbLog chequea _telemetryFailedTags.has(event) antes de fetch',
   /if\s*\(\s*_telemetryFailedTags\.has\s*\(\s*event\s*\)\s*\)\s*return;/.test(hookSrc));

ok('Si res.ok es false, marca event como failed',
   /if\s*\(\s*!res\.ok\s*\)\s*\{[\s\S]{0,500}?_telemetryFailedTags\.add\s*\(\s*event\s*\)/.test(hookSrc));

ok('Loguea PB-TELEMETRY-FAIL una sola vez por tag',
   /PB-TELEMETRY-FAIL[\s\S]{0,200}?dedupe:\s*true/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 7. try/catch global alrededor del fetch
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[7] fetch envuelto en try/catch global (defense in depth)');

const pbLogBody = hookSrc.match(/function\s+pbLog[\s\S]+?\n\}/);
if (!pbLogBody) {
    ok('cuerpo de pbLog localizable', false);
} else {
    const body = pbLogBody[0];
    ok('pbLog envuelve fetch en try {} catch',
       /try\s*\{[\s\S]+?fetch\s*\(\s*['"]\/api\/events['"][\s\S]+?\}\s*catch/.test(body));

    ok('catch global vacío (swallow) — never throw from logger',
       /\}\s*catch\s*\{\s*\/\*[^*]*\*\/\s*\}/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// 8. .catch del fetch swallow
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[8] .catch del fetch swallow (red errors no rompen)');

ok('fetch.then().catch() swallow — no throw',
   /fetch[\s\S]{0,1500}?\.catch\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,200}?\}\s*\)/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — telemetría NUNCA en path crítico de playback
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] Playback no awaitea respuesta de telemetry');

// load(), play(), handleEnded NO deben await fetch a /api/events.
ok('Ningún await fetch /api/events en path de playback',
   !/await\s+fetch\s*\(\s*['"]\/api\/events['"]/.test(hookSrc));

// pbLog mismo no es async (no bloquea callers)
ok('pbLog NO es async (no bloquea callers)',
   /function\s+pbLog\s*\([^)]+\)\s*:\s*void/.test(hookSrc) &&
   !/async\s+function\s+pbLog/.test(hookSrc));

// keepalive: true sigue presente
ok('fetch /api/events sigue usando keepalive: true',
   /fetch\s*\(\s*['"]\/api\/events['"][\s\S]{0,800}?keepalive:\s*true/.test(hookSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
