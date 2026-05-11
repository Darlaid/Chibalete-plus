/**
 * playbackStateMachine.test.js — INVARIANTES 13/14/15/17.
 *
 * Verifica vía análisis estático del source que:
 *   - sentence_advanced sólo se loguea desde dentro de doAdvance/goLoad (commit),
 *     no en el cuerpo de handleEnded antes del scheduling.
 *   - Los setTimeout de advance se trackean en refs pendingAdvanceTimerRef /
 *     pendingFallbackTimerRef.
 *   - cancelPendingAdvance se invoca en pause, load, reset y unmount cleanup.
 *   - Cache invalidation en path gapless cuando duración es sospechosa.
 *
 * Tests scenario-level — no requieren React/DOM. Si las invariantes
 * estructurales se rompen, el lint o este test falla.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackStateMachine.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, '..', 'useImmersivePlayback.ts');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

if (!fs.existsSync(sourcePath)) {
    console.error(`✗ useImmersivePlayback.ts no encontrado en ${sourcePath}`);
    process.exit(1);
}
const src = fs.readFileSync(sourcePath, 'utf8');

console.log('\nplaybackStateMachine — INVARIANTES 13/14/15/17');

// ───────────────────────────────────────────────────────────────────────────
// INV-13/17 — sentence_advanced solo se loguea en path de commit
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-13/17] sentence_advanced solo en commit, no en scheduling');

// Tomamos todas las líneas que contienen log('sentence_advanced'.
const advancedLines = [];
src.split('\n').forEach((line, i) => {
    if (/log\(['"]sentence_advanced['"]/.test(line)) {
        advancedLines.push({ line: i + 1, text: line.trim() });
    }
});

ok('Existe al menos una emisión de sentence_advanced',
   advancedLines.length >= 1,
   `count=${advancedLines.length}`);

ok('NO más de 2 emisiones de sentence_advanced (doAdvance + goLoad)',
   advancedLines.length <= 2,
   `count=${advancedLines.length}; lineas=${advancedLines.map(a=>a.line).join(',')}`);

// Para cada emisión, verificar que está PRECEDIDA en las ~12 líneas anteriores
// por una de: setIdx(nextIdx), load(nextIdx — eso indica commit.
for (const a of advancedLines) {
    const lines = src.split('\n');
    const start = Math.max(0, a.line - 12);
    const ctx = lines.slice(start, a.line).join('\n');
    const hasCommitMarker = /(setIdx\s*\(\s*nextIdx\s*\)|load\s*\(\s*nextIdx\s*,)/.test(ctx);
    ok(`sentence_advanced en línea ${a.line} está precedido por setIdx(nextIdx) o load(nextIdx,...) (commit)`,
       hasCommitMarker,
       `ctx (lineas ${start+1}-${a.line}): ${ctx.replace(/\s+/g, ' ').slice(-200)}`);
}

// REGRESION GUARD: el patrón antiguo (log antes de setIdx en el cuerpo de handleEnded)
// era: log('sentence_advanced') ... setIdx(nextIdx). Verificar que NO existe ya en el código.
const cuerpoAntiguo = /log\(['"]sentence_advanced['"][\s\S]{0,200}?nextEl\.playbackRate\s*=/.test(src);
ok('REGRESION GUARD: NO existe el patrón "log(sentence_advanced) ... nextEl.playbackRate" en el cuerpo de handleEnded',
   !cuerpoAntiguo,
   'el patrón antiguo emitía advanced ANTES del commit');

// ───────────────────────────────────────────────────────────────────────────
// INV-15 — timer refs explícitos para cancellation
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-15] timer refs explícitos para cancelación');

ok('Declara pendingAdvanceTimerRef',
   /pendingAdvanceTimerRef\s*=\s*useRef/.test(src));
ok('Declara pendingFallbackTimerRef',
   /pendingFallbackTimerRef\s*=\s*useRef/.test(src));
ok('Declara pendingCanplaythroughCleanupRef',
   /pendingCanplaythroughCleanupRef\s*=\s*useRef/.test(src));

ok('Existe función cancelPendingAdvance',
   /const\s+cancelPendingAdvance\s*=/.test(src));

// cancelPendingAdvance debe limpiar los 3 refs
const cancelFn = src.match(/const cancelPendingAdvance[\s\S]*?\n    \};/);
ok('cancelPendingAdvance está definida como función',
   cancelFn !== null);

if (cancelFn) {
    ok('cancelPendingAdvance llama clearTimeout(pendingAdvanceTimerRef.current)',
       /clearTimeout\(pendingAdvanceTimerRef\.current\)/.test(cancelFn[0]));
    ok('cancelPendingAdvance llama clearTimeout(pendingFallbackTimerRef.current)',
       /clearTimeout\(pendingFallbackTimerRef\.current\)/.test(cancelFn[0]));
    ok('cancelPendingAdvance limpia pendingCanplaythroughCleanupRef',
       /pendingCanplaythroughCleanupRef\.current\(\)/.test(cancelFn[0]) ||
       /pendingCanplaythroughCleanupRef\.current\s*=\s*null/.test(cancelFn[0]));
    ok('cancelPendingAdvance emite log pending_advance_cancelled',
       /pending_advance_cancelled/.test(cancelFn[0]));
}

// ───────────────────────────────────────────────────────────────────────────
// INV-15 — cancelPendingAdvance se invoca en los puntos críticos
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-15] cancelPendingAdvance llamado en pause/load/reset/cleanup/new_handleEnded');

const callSites = [
    { name: 'pause', expectedReason: 'pause' },
    { name: 'load',  expectedReason: 'skip_or_load' },
    { name: 'reset', expectedReason: 'content_reset' },
    { name: 'unmount cleanup', expectedReason: 'unmount' },
    { name: 'handleEnded inicio', expectedReason: 'new_handleEnded' },
];

for (const cs of callSites) {
    const rx = new RegExp(`cancelPendingAdvance\\s*\\(\\s*['"]${cs.expectedReason}['"]\\s*\\)`);
    ok(`cancelPendingAdvance('${cs.expectedReason}') es invocado (caller: ${cs.name})`,
       rx.test(src),
       'no se encuentra esa llamada en useImmersivePlayback.ts');
}

// ───────────────────────────────────────────────────────────────────────────
// INV-17 — index_scheduled y index_commit logs distintos
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-17] index_scheduled / index_commit son eventos separados');

ok('PlaybackEvent type incluye index_scheduled',
   /['"]index_scheduled['"]/.test(src));
ok('PlaybackEvent type incluye index_commit',
   /['"]index_commit['"]/.test(src));
ok('PlaybackEvent type incluye pending_advance_cancelled',
   /['"]pending_advance_cancelled['"]/.test(src));

ok('Se emite log(index_scheduled) en handleEnded',
   /log\(['"]index_scheduled['"]/.test(src));
ok('Se emite log(index_commit) en handleEnded',
   /log\(['"]index_commit['"]/.test(src));

// Los 3 events nuevos están en el debug-level filter (no van al backend)
const debugBlock = src.match(/if \(event === 'play_start'[\s\S]*?\)\s*\{\s*\n\s+console\.debug/);
ok('Eventos nuevos en debug-level filter (no se persisten al backend)',
   debugBlock !== null &&
   /index_scheduled/.test(debugBlock[0]) &&
   /index_commit/.test(debugBlock[0]) &&
   /pending_advance_cancelled/.test(debugBlock[0]));

// ───────────────────────────────────────────────────────────────────────────
// INV-9 (gapless) — cache invalidation con duración sospechosa
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-9] cache invalidation en path gapless de handleEnded');

ok('Existe cacheInvalidatedKeysRef (idempotencia de invalidación)',
   /cacheInvalidatedKeysRef\s*=\s*useRef/.test(src));

// Buscar el bloque de invalidación gapless
const gaplessInvalidation = /wasCached\s*&&\s*wordCount\s*>=\s*3\s*&&\s*durationMs\s*<\s*300/.test(src);
ok('handleEnded invalida cache cuando wasCached && wordCount>=3 && durationMs<300',
   gaplessInvalidation,
   'el threshold de cache invalidation gapless no se encuentra');

ok('Tras invalidar, URL.revokeObjectURL + audioCache.delete son ambas llamadas',
   /URL\.revokeObjectURL\(url\)[\s\S]{0,80}audioCache\.current\.delete\(key\)/.test(src));

ok('Se emite log audio_cache_invalidated con reason short_duration_on_gapless_end',
   /short_duration_on_gapless_end/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// REGRESION GUARDS del bug reportado por usuario
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[REGRESION] guards específicos del incidente "dudando"');

// 1. handleEnded debe cancelar pending del ciclo anterior al inicio
const handleEndedSrc = src.match(/const handleEnded\s*=\s*useCallback[\s\S]*?\}, \[getAudioUrl,/);
ok('handleEnded existe y termina en useCallback con dep getAudioUrl',
   handleEndedSrc !== null);

if (handleEndedSrc) {
    ok('REGRESION GUARD: handleEnded llama cancelPendingAdvance al inicio',
       /cancelPendingAdvance\s*\(\s*['"]new_handleEnded['"]\s*\)/.test(handleEndedSrc[0]),
       'sin este cancel, un onEnded espurio podría dejar dos doAdvance encolados');

    // 2. Dentro de handleEnded, los setTimeout que llaman doAdvance/goLoad
    // deben asignarse a un ref (no quedarse anónimos).
    const setTimeoutAssignments = handleEndedSrc[0].match(/pending\w+Ref\.current\s*=\s*setTimeout/g) || [];
    ok('REGRESION GUARD: ≥1 setTimeout en handleEnded se asigna a pendingTimerRef',
       setTimeoutAssignments.length >= 1,
       `count=${setTimeoutAssignments.length}`);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
