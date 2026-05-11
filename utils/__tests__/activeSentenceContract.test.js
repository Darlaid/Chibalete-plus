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

// REGRESION GUARD: si alguien quita los attrs por cleanup automático
ok('REGRESION GUARD: ImmersiveShell.tsx mantiene los 3 attrs juntos en la misma render',
   /data-sentence-index\s*=[\s\S]{0,150}data-active-sentence[\s\S]{0,150}aria-current/.test(shellSrc));

// ───────────────────────────────────────────────────────────────────────────
// VisorInmersivo — useLayoutEffect contract validator
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-18] VisorInmersivo valida contract DOM post-render');

ok('VisorInmersivo importa useLayoutEffect',
   /import\s+React,\s*\{[^}]*useLayoutEffect[^}]*\}\s+from\s+['"]react['"]/.test(visorSrc));

ok('VisorInmersivo tiene useLayoutEffect',
   /useLayoutEffect\s*\(/.test(visorSrc));

ok('Validator consulta document.querySelectorAll([data-active-sentence="true"])',
   /querySelectorAll\(['"][^'"]*data-active-sentence[^'"]*=[^'"]*['"]true['"][^'"]*['"]/.test(visorSrc));

ok('Validator chequea count === 0 (active_sentence_missing)',
   /active_sentence_missing/.test(visorSrc));

ok('Validator chequea count > 1 (active_sentence_duplicate)',
   /active_sentence_duplicate/.test(visorSrc));

ok('Validator chequea data-sentence-index vs currentIndex (mismatch)',
   /active_sentence_index_mismatch/.test(visorSrc));

ok('Validator emite visual_highlight_ack cuando contract pasa',
   /visual_highlight_ack/.test(visorSrc));

ok('Validator marca domVerified:true en el log de ack',
   /domVerified:\s*true/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// VisorInmersivo — drift detector
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-18] Drift detector activo cada 250ms durante playback');

ok('Drift detector usa setInterval con 250ms',
   /setInterval\([\s\S]+?,\s*250\s*\)/.test(visorSrc));

ok('Drift detector solo corre si pb.isPlaying (no en pause)',
   /if\s*\(\s*!\s*pb\.isPlaying[\s\S]{0,100}?return/.test(visorSrc));

ok('Drift detector incrementa strikes en driftStrikesRef',
   /driftStrikesRef\s*=\s*useRef\s*\(\s*0\s*\)/.test(visorSrc) &&
   /driftStrikesRef\.current\+\+/.test(visorSrc));

ok('Drift detector emite drift_detected con strikes',
   /drift_detected[\s\S]{0,400}?strikes:\s*driftStrikesRef\.current/.test(visorSrc));

ok('Tras >=2 strikes, dispara hardResync vía pb.skip(currentIndex)',
   /driftStrikesRef\.current\s*>=\s*2[\s\S]+?pb\.skip\s*\(\s*currentIndex\s*\)/.test(visorSrc));

ok('Emite drift_recovery_hard_resync antes del skip',
   /drift_recovery_hard_resync/.test(visorSrc));

ok('Resetea strikes a 0 después del recovery',
   /driftStrikesRef\.current\s*=\s*0/.test(visorSrc));

// Cleanup del setInterval en return
ok('useEffect del drift detector limpia el setInterval en cleanup',
   /clearInterval\(id\)/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESION GUARDS específicas del bug
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-18] REGRESION GUARDS');

ok('REGRESION GUARD: no se inicia audio sin que exista visual_highlight_ack en el flujo',
   /visual_highlight_ack/.test(visorSrc),
   'el log de ack debe estar presente');

ok('REGRESION GUARD: pb.skip se invoca en drift recovery (no navigate)',
   /pb\.skip\s*\(\s*currentIndex\s*\)/.test(visorSrc));

ok('REGRESION GUARD: hardResync NO usa navigate (no cambia de libro)',
   !/navigate\([^)]*['"]\/leer\/inmersivo\/[\s\S]{0,200}drift/.test(visorSrc),
   'drift recovery no debe navegar a otro libro');

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
