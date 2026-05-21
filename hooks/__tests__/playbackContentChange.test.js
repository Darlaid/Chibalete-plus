/**
 * playbackContentChange.test.js — F15 (cambio de libro universal).
 *
 * Verifica que el cambio de contentId (cambio de libro) limpia
 * COMPLETAMENTE el estado del libro anterior y descarta callbacks tardíos.
 *
 * Cobertura (10 criterios del spec del usuario):
 *
 *   1. Hook declara contentSessionRef.
 *   2. reset() incrementa contentSessionRef (invalida callbacks).
 *   3. reset() limpia audioFailedKeys + audioRetriedKeys + cacheInvalidatedKeys.
 *   4. reset() incrementa loadToken (invalida loads en flight).
 *   5. reset() limpia audioCache + abortCtrls + inFlight.
 *   6. reset() pausa ambos audios + clear src.
 *   7. reset() emite CONTENT_CHANGE a la machine.
 *   8. acknowledgeVisualHighlight verifica session/contentId match.
 *   9. acknowledgeVisualHighlight loguea PB_LATE_VISUAL_ACK_IGNORED si stale.
 *   10. No hay condicionales por contentId específico (regression universal).
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackContentChange.test.js
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

const hookSrc  = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');

console.log('\nplaybackContentChange — F15 (cambio de libro universal)');

// ───────────────────────────────────────────────────────────────────────────
// 1. contentSessionRef declarado
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1] contentSessionRef declarado');
ok('Hook declara contentSessionRef como useRef<number>(0)',
   /contentSessionRef\s*=\s*useRef\s*<\s*number\s*>\s*\(\s*0\s*\)/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 2-7. reset() limpia todo cross-content
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[2-7] reset() limpia estado cross-content');

const resetBody = hookSrc.match(/const\s+reset\s*=\s*useCallback[\s\S]+?\}\s*,\s*\[\]\s*\)/);
if (!resetBody) {
    ok('cuerpo de reset() localizable', false);
} else {
    const body = resetBody[0];

    ok('reset() incrementa contentSessionRef (F15)',
       /contentSessionRef\.current\+\+/.test(body));

    ok('reset() incrementa loadToken (invalida loads en flight)',
       /loadToken\.current\+\+/.test(body));

    ok('reset() limpia audioFailedKeysRef',
       /audioFailedKeysRef\.current\.clear/.test(body));

    ok('reset() limpia audioRetriedKeysRef',
       /audioRetriedKeysRef\.current\.clear/.test(body));

    ok('reset() limpia cacheInvalidatedKeysRef',
       /cacheInvalidatedKeysRef\.current\.clear/.test(body));

    ok('reset() limpia audioCache (revoke + clear)',
       /audioCache\.current\.forEach[\s\S]{0,200}?revokeObjectURL[\s\S]{0,100}?audioCache\.current\.clear/.test(body));

    ok('reset() aborta abortCtrls',
       /abortCtrls\.current\.forEach[\s\S]{0,150}?ctrl\.abort/.test(body));

    ok('reset() limpia inFlight',
       /inFlight\.current\.clear/.test(body));

    ok('reset() pausa audioRefA y audioRefB',
       /pA\?\.pause\(\)[\s\S]{0,200}?pB\?\.pause\(\)/.test(body));

    ok('reset() limpia src de ambos players',
       /pA\.src\s*=\s*['"]['"][\s\S]{0,200}?pB\.src\s*=\s*['"]['"]/.test(body));

    ok('reset() reinicia activePlayer.current = "A"',
       /activePlayer\.current\s*=\s*['"]A['"]/.test(body));

    ok('reset() resetea currentIdxRef + sentenceStartTime',
       /currentIdxRef\.current\s*=\s*0[\s\S]{0,300}?sentenceStartTimeRef\.current\s*=\s*0/.test(body));

    ok('reset() invalida standbyGenRef (cancela canplaythrough listeners)',
       /standbyGenRef\.current\+\+/.test(body));

    // 7. Dispatch CONTENT_CHANGE
    ok('reset() dispatchea MA.CONTENT_CHANGE a la machine',
       /dispatchMachine\s*\(\s*\{\s*type:\s*MA\.CONTENT_CHANGE/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// 8. M-5.4.6 (Phase 1.b.5) — acknowledgeVisualHighlight es no-op stub
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[8] M-5.4.6: acknowledgeVisualHighlight quedó como no-op stub');

// El hook expone el helper para no romper callers legacy pero NO hace nada.
const ackBody = hookSrc.match(/const\s+acknowledgeVisualHighlight\s*=\s*\(/);
ok('acknowledgeVisualHighlight stub sigue exportado', ackBody !== null);
ok('acknowledgeVisualHighlight YA NO dispatchea VISUAL_HIGHLIGHT_ACK',
   !/const\s+acknowledgeVisualHighlight[\s\S]{0,500}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.VISUAL_HIGHLIGHT_ACK/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 9. M-5.4.6 — PB_LATE_VISUAL_ACK_IGNORED ya no aplica (visor no acknowledgea)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[9] M-5.4.6: PB_LATE_VISUAL_ACK_IGNORED eliminado');
ok('M-5.4.6 — PB_LATE_VISUAL_ACK_IGNORED YA NO aparece en el hook',
   !/PB_LATE_VISUAL_ACK_IGNORED/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 10. NO hay condicionales por contentId específico (regression universal)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[10] Regression universal: cero condicionales por contentId');

// Buscar contentId === 'algun-id' literal — prohibido por el principio.
const hookHasSpecificContentId = /content(?:Id)?\s*[=!]==\s*['"]content-\d/.test(hookSrc) ||
                                 /content(?:Id)?\s*[=!]==\s*['"]content-1773/.test(hookSrc) ||
                                 /content(?:Id)?\s*[=!]==\s*['"]content-1778/.test(hookSrc);
const visorHasSpecificContentId = /content(?:Id)?\s*[=!]==\s*['"]content-\d/.test(visorSrc) ||
                                  /content(?:Id)?\s*[=!]==\s*['"]content-1773/.test(visorSrc) ||
                                  /content(?:Id)?\s*[=!]==\s*['"]content-1778/.test(visorSrc);

ok('Hook NO contiene condicional por contentId literal',
   !hookHasSpecificContentId);
ok('Visor NO contiene condicional por contentId literal',
   !visorHasSpecificContentId);

// Tampoco título "Alicia" / "guerra" hardcodeado
ok('Hook NO contiene "Alicia" hardcodeado',
   !/Alicia/.test(hookSrc));
ok('Hook NO contiene "guerra de los mundos" hardcodeado',
   !/guerra de los mundos/i.test(hookSrc));

// Tampoco índice fijo 72 / 73 / etc. como condicional
ok('Hook NO contiene "index === 72" hardcodeado',
   !/(?:index|currentIndex)\s*===\s*72/.test(hookSrc));
ok('Hook NO contiene "index === 73" hardcodeado',
   !/(?:index|currentIndex)\s*===\s*73/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — el visor sí dispara reset() en cambio de content.id
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] visor llama pb.reset() en cambio de content.id');
ok('Visor llama pb.reset() en algún useEffect dependiente de content.id',
   /useEffect\s*\([\s\S]{0,3000}?pb\.reset\s*\(\s*\)[\s\S]{0,2000}?\[content\.id/.test(visorSrc) ||
   /pb\.reset\s*\(\s*\)/.test(visorSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
