/**
 * visualContinuityGuard.test.js — M-5.4.12 estructural.
 *
 * Blinda el "visual continuity guard": nunca viewport negro mientras el audio
 * sigue. Verifica el WIRING sobre el source real + la REGLA CRÍTICA: es
 * RENDER-ONLY (cero pb.* / setIdx / dispatch / executor / audio / nuevo
 * reconciliador / recovery loop).
 *
 * Cómo correr:  node hooks/__tests__/visualContinuityGuard.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');

console.log('\nvisualContinuityGuard — M-5.4.12 estructural');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1] Refs de continuidad declarados');

ok('lastRenderableSentenceRef declarado (preserva última frase válida)',
   /const\s+lastRenderableSentenceRef\s*=\s*useRef<\{\s*index:\s*number;\s*targetY:\s*number;\s*text:\s*string\s*\}\s*\|\s*null>\(null\)/.test(visorSrc));

ok('visualHoldStateRef declarado (episodio de hold, anti-spam)',
   /const\s+visualHoldStateRef\s*=\s*useRef<\{\s*holding:\s*boolean;\s*episode:\s*number;\s*sinceTs:\s*number\s*\}>/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[2] applyTransformWithContinuity — guard definido');

const guardMatch = visorSrc.match(
    /const\s+applyTransformWithContinuity\s*=\s*useCallback\(\([\s\S]*?\},\s*\[applyTransformForActiveSentence,\s*content\.id\]\)/);
ok('applyTransformWithContinuity definido como useCallback', guardMatch !== null);
const guardBody = guardMatch ? guardMatch[0] : '';

ok('en ok → persiste lastRenderableSentenceRef {index,targetY,text}',
   /res\.ok[\s\S]{0,300}?lastRenderableSentenceRef\.current\s*=\s*\{[\s\S]{0,120}?index[\s\S]{0,80}?targetY[\s\S]{0,80}?text/.test(guardBody));

ok('en !ok → re-aplica el translateY de la última frase válida (NO blanquea)',
   /last\s*&&\s*wrapper[\s\S]{0,200}?wrapper\.style\.transform\s*=\s*`translateY\(\$\{last\.targetY\}px\)`/.test(guardBody));

ok('emite VISUAL_CONTINUITY_HOLD',     /\[VISUAL_CONTINUITY_HOLD\]/.test(guardBody));
ok('emite VISUAL_CONTINUITY_RELEASE',  /\[VISUAL_CONTINUITY_RELEASE\]/.test(guardBody));
ok('emite VISUAL_NULL_RENDER_BLOCKED', /\[VISUAL_NULL_RENDER_BLOCKED\]/.test(guardBody));

ok('HOLD/NULL_BLOCKED gated por episodio (anti-spam: solo si !hold.holding)',
   /if\s*\(\s*!hold\.holding\s*\)\s*\{[\s\S]{0,400}?\[VISUAL_CONTINUITY_HOLD\][\s\S]{0,400}?\[VISUAL_NULL_RENDER_BLOCKED\]/.test(guardBody));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] Aplicado en CADA pass del fit (antes de los early-return)');

// El guard corre en fit_effect_entry ANTES del reset-de-índice / escalera.
ok('applyTransformWithContinuity(currentIndex, "fit_effect_entry") antes del reset de índice',
   // M-5.4.13: ventana 400→1400 — entre el entry-apply y el chequeo de
   // cambio de índice ahora va el comentario PHASE A. El continuity guard
   // (M-5.4.12) sigue corriendo PRIMERO en cada pass (intacto).
   /applyTransformWithContinuity\(\s*currentIndex\s*,\s*['"]fit_effect_entry['"]\s*\)[\s\S]{0,1400}?if\s*\(\s*fitStateRef\.current\.index\s*!==\s*currentIndex\s*\)/.test(visorSrc));

// M-5.4.13 — el continuity guard (M-5.4.12, INTACTO) ya NO compite con una
// cascada decideFitTier SÍNCRONA: PHASE A delega a optimisticVisualCommit y
// hace return; decideFitTier vive en PHASE B (runLayoutRefinement, async,
// post-paint). Verificamos: NO hay decideFitTier sincrónico en el path de
// cambio de índice del useLayoutEffect (centrado nunca bloqueado por medición).
ok('cambio de índice → optimisticVisualCommit + return (sin decideFitTier sync)',
   /if\s*\(\s*fitStateRef\.current\.index\s*!==\s*currentIndex\s*\)\s*\{[\s\S]{0,200}?optimisticVisualCommit\(\s*currentIndex\s*,\s*_measureStart\s*\)\s*;[\s\S]{0,40}?return\s*;[\s\S]{0,40}?\}/.test(visorSrc));

ok('decideFitTier vive en PHASE B (runLayoutRefinement async, no en el effect sync)',
   /const\s+runLayoutRefinement\s*=\s*useCallback\([\s\S]{0,4000}?decideFitTier\(\s*\{[\s\S]{0,120}?currentTier:\s*fitStateRef\.current\.tier/.test(visorSrc));

ok('settle-time también usa el guard (fit_settle), no el raw apply',
   /applyTransformWithContinuity\(\s*currentIndex\s*,\s*['"]fit_settle['"]\s*\)/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] REGLA CRÍTICA — RENDER-ONLY, cero mutación de runtime');

ok('guard NO llama pb.* / setIdx / dispatch / cancelSyncStrategy / hardResync / skip / pause',
   !/pb\.\w|setIdx\(|dispatch\w*\(|cancelSyncStrategy|hardResync|\bskip\(|\.pause\(/.test(guardBody));

ok('guard NO toca el executor ni el audio (sin syncStrategy / audioRef / play)',
   !/syncStrategy|audioRef[AB]|\.play\(|executeSyncStrategy/.test(guardBody));

ok('guard NO hace fade-out / clear de viewport / render null',
   !/setActiveSentence\s*\(\s*null|opacity\s*[:=]\s*0|innerHTML\s*=\s*['"]['"]|display\s*[:=]\s*['"]none['"]/.test(guardBody));

ok('guard solo muta DOM via transform/transition (visual puro)',
   /wrapper\.style\.transform/.test(guardBody)
   && !/document\.querySelector[\s\S]{0,80}?remove|appendChild|createElement/.test(guardBody));

ok('NO se introdujo nuevo reconciliador / recovery loop (sin setInterval/while/for-retry en el guard)',
   !/setInterval|while\s*\(|for\s*\(\s*;;/.test(guardBody));

// El guard NO bumpea navGeneration ni despacha a la machine (ownership simple).
ok('guard NO bumpea navGeneration ni despacha MA.*',
   !/navGenerationRef\.current\s*=|MA\.\w+/.test(guardBody));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
