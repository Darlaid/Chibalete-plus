/**
 * activeSentenceContract.test.js — INVARIANTE 18 (DOM contract).
 *
 * Verifica que la INV-18 está materializada en el código fuente:
 *   - ImmersiveShell renderiza data-active-sentence, data-sentence-index,
 *     aria-current sobre la frase activa.
 *   - VisorInmersivo tiene useLayoutEffect que valida el contract DOM.
 *   - VisorInmersivo tiene drift detector con setInterval cada 250ms.
 *   - Drift recovery vía pb.skip(currentIndex) tras 2 strikes.
 *
 * No usa DOM real — análisis estático del source. Tests de DOM real
 * requerirían Playwright/jsdom (fuera de scope sin agregar deps).
 *
 * Cómo correr:
 *   node utils/__tests__/activeSentenceContract.test.js
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

const shellSrc = fs.readFileSync(path.join(ROOT, 'components', 'ImmersiveShell.tsx'), 'utf8');
const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');

console.log('\nactiveSentenceContract — INVARIANTE 18 (DOM contract)');

// ───────────────────────────────────────────────────────────────────────────
// ImmersiveShell — DOM attributes
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-18] ImmersiveShell renderiza attrs verificables');

ok('ImmersiveShell incluye data-active-sentence',
   /data-active-sentence\s*=\s*\{?\s*isActive\s*\?\s*['"]true['"]/.test(shellSrc));

ok('ImmersiveShell incluye data-sentence-index',
   /data-sentence-index\s*=\s*\{\s*idx\s*\}/.test(shellSrc));

ok('ImmersiveShell incluye aria-current (accesibilidad)',
   /aria-current\s*=\s*\{\s*isActive\s*\?\s*['"]true['"]/.test(shellSrc));

// REGRESION GUARD: si alguien quita los attrs por cleanup automático.
// Ventana ampliada para acomodar data-sentence-len + data-active-fit-scale
// + style (M-5.4.6 Case 3 layout fit).
ok('REGRESION GUARD: ImmersiveShell.tsx mantiene los 3 attrs juntos en la misma render',
   /data-sentence-index\s*=[\s\S]{0,400}data-active-sentence[\s\S]{0,400}aria-current/.test(shellSrc));

// ───────────────────────────────────────────────────────────────────────────
// M-5.4.6 (DEMOLITION Phase 1.b.2) — Sección "VisorInmersivo — useLayoutEffect
// contract validator" ELIMINADA. El visor pasó a READ-ONLY. Ya no:
//   - emite visual_highlight_ack
//   - marca domVerified:true
//   - distingue active_sentence_missing/duplicate/index_mismatch (los logs
//     genéricos PB_VISUAL_HIGHLIGHT_REJECTED + PB_ACTIVE_SENTENCE_REVEAL_FAILED
//     siguen existiendo pero como observabilidad pura, no autorizan playback)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-18] Visor sigue teniendo useLayoutEffect read-only');

ok('VisorInmersivo importa useLayoutEffect',
   /import\s+React,\s*\{[^}]*useLayoutEffect[^}]*\}\s+from\s+['"]react['"]/.test(visorSrc));

ok('VisorInmersivo tiene useLayoutEffect',
   /useLayoutEffect\s*\(/.test(visorSrc));

ok('Validator consulta document.querySelectorAll([data-active-sentence="true"]) (read-only)',
   /querySelectorAll\(['"][^'"]*data-active-sentence[^'"]*=[^'"]*['"]true['"][^'"]*['"]/.test(visorSrc));

// Verificamos que NO existan callers reales (kind: 'visual_highlight_ack',
// pb.acknowledgeVisualHighlight(...)) — sólo se admite la palabra en
// comentarios documentales.
ok('M-5.4.6 — Visor NO emite visual_highlight_ack como kind de immersiveLog',
   !/kind:\s*viaReveal\s*\?\s*['"]PB_VISUAL_HIGHLIGHT_ACK_AFTER_REVEAL['"]\s*:\s*['"]visual_highlight_ack['"]/.test(visorSrc));

ok('M-5.4.6 — Visor NO llama pb.acknowledgeVisualHighlight',
   !/pb\.acknowledgeVisualHighlight\s*\(/.test(visorSrc));

ok('M-5.4.6 — Visor NO marca domVerified:true (ack writer eliminado)',
   !/domVerified:\s*true/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// M-5.4.6 (DEMOLITION Phase 1.a) — Sección "VisorInmersivo — drift detector"
// ELIMINADA. El drift detector fue removido del visor. Las assertions que
// vivían acá enforce-aban su presencia (setInterval 250ms, strikes,
// PB_INDEX_DRIFT_DETECTED, hardResync recovery, etc.) — ya no aplican.
// ───────────────────────────────────────────────────────────────────────────

// REGRESION GUARD que SOBREVIVE: el visor NO debe navegar a otro libro como
// reacción a drift. Mantengo este check porque sigue siendo cierto en el
// modelo nuevo (navegar a otro libro NUNCA es respuesta a un problema de
// runtime — sólo a un gesto manual del usuario).
console.log('\n[INV-18] REGRESION GUARD: visor no navega a otro libro por drift');

ok('REGRESION GUARD: visor NO usa navigate por drift recovery',
   !/navigate\([^)]*['"]\/leer\/inmersivo\/[\s\S]{0,200}drift/.test(visorSrc),
   'drift recovery (eliminado) no debe navegar a otro libro');

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
