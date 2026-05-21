/**
 * playbackProgressGating.test.js — F5 (STRICT GATING de PROGRESS_SAVE).
 *
 * Verifica estructuralmente que VisorInmersivo y el hook implementan la
 * regla:
 *
 *   "Una frase no puede guardar progreso si no fue destacada y leída."
 *
 * Cobertura:
 *   - Hook expone canSaveProgress(index): { ok, reason }.
 *   - canSaveProgress valida: completed, visualHighlightConfirmed,
 *     audioStarted, audioEnded, progressEligible, !pending_next, !pendingAdvance.
 *   - Visor: el effect de PROGRESS_SAVE llama canSaveProgress antes de save.
 *   - Si gate.ok=false → log PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION + abort.
 *   - El flush de salida (cleanup) también pasa por el gate.
 *   - NO hay path donde dataService.updateProgreso se llame sin gate previo.
 *   - El gate antiguo `pb.isPendingAdvance()` fue reemplazado (no acumulado).
 *   - F5 NO toca playback en path de bloqueo (no hardResync, no pause).
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackProgressGating.test.js
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

console.log('\nplaybackProgressGating — F5 (regla madre: no progreso sin completed)');

// ───────────────────────────────────────────────────────────────────────────
// Hook expone canSaveProgress con la signature correcta
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[hook] canSaveProgress como API pública');

ok('Interface ImmersivePlayback declara canSaveProgress(index): { ok, reason? }',
   /interface\s+ImmersivePlayback[\s\S]+?canSaveProgress:\s*\(\s*index:\s*number\s*\)\s*=>\s*\{\s*ok:\s*boolean;\s*reason\?:\s*string\s*\}/.test(hookSrc));

ok('Hook define const canSaveProgress',
   /const\s+canSaveProgress\s*=\s*\(\s*index:\s*number\s*\)\s*:\s*\{\s*ok:\s*boolean;\s*reason\?:\s*string\s*\}\s*=>/.test(hookSrc));

ok('return del hook incluye canSaveProgress',
   /return\s*\{[\s\S]+?canSaveProgress[\s\S]+?\};/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// canSaveProgress valida cada regla
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[hook] canSaveProgress valida cada gating rule');

const canSaveBody = hookSrc.match(/const\s+canSaveProgress\s*=[\s\S]+?return\s*\{\s*ok:\s*true\s*\};/);
if (!canSaveBody) {
    ok('cuerpo de canSaveProgress localizable (sanity)', false, 'no se encontró el cuerpo');
} else {
    const body = canSaveBody[0];

    ok('canSaveProgress chequea isPendingAdvance() → reason pending_advance',
       /isPendingAdvance\s*\(\s*\)[\s\S]{0,200}?reason:\s*['"]pending_advance['"]/.test(body));

    ok('canSaveProgress chequea no_active_sentence (sin buffer.current)',
       /reason:\s*['"]no_active_sentence['"]/.test(body));

    ok('canSaveProgress chequea index_mismatch',
       /c\.index\s*!==\s*index[\s\S]{0,100}?reason:\s*['"]index_mismatch['"]/.test(body));

    ok('canSaveProgress chequea buffer.locked',
       /buffer\.locked[\s\S]{0,100}?reason:\s*['"]buffer_locked['"]/.test(body));

    ok('canSaveProgress chequea status === completed',
       /c\.status\s*!==\s*['"]completed['"][\s\S]{0,200}?reason:\s*`status_/.test(body));

    // M-5.4.6 (Phase 1.b.3 + decisión E.2) — gate de visualHighlightConfirmed
    // eliminado. canSaveProgress ahora gatea sólo en playback consumido.
    ok('M-5.4.6 — canSaveProgress YA NO chequea visualHighlightConfirmed',
       !/!c\.visualHighlightConfirmed[\s\S]{0,150}?reason:\s*['"]visual_not_confirmed['"]/.test(body));

    ok('canSaveProgress chequea audioStarted',
       /!c\.audioStarted[\s\S]{0,150}?reason:\s*['"]audio_not_started['"]/.test(body));

    ok('canSaveProgress chequea audioEnded',
       /!c\.audioEnded[\s\S]{0,150}?reason:\s*['"]audio_not_ended['"]/.test(body));

    ok('canSaveProgress chequea progressEligible',
       /!c\.progressEligible[\s\S]{0,150}?reason:\s*['"]progress_not_eligible['"]/.test(body));

    ok('canSaveProgress chequea buffer.next === null',
       /buffer\.next\s*!==\s*null[\s\S]{0,150}?reason:\s*['"]pending_next['"]/.test(body));

    // REGRESSION: canSaveProgress es read-only — NO debe llamar dispatchMachine,
    // NO debe llamar setStatus, NO debe llamar hardResyncToIndex.
    ok('canSaveProgress NO llama dispatchMachine (read-only)',
       !/dispatchMachine/.test(body));
    ok('canSaveProgress NO llama setStatus (read-only)',
       !/setStatus/.test(body));
    ok('canSaveProgress NO llama hardResyncToIndex (read-only)',
       !/hardResyncToIndex/.test(body));
    ok('canSaveProgress NO llama load() (read-only)',
       !/\bload\s*\(/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// Visor: el effect de PROGRESS_SAVE pasa por canSaveProgress
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[visor] PROGRESS_SAVE effect llama canSaveProgress antes de guardar');

// El effect está identificado por el setTimeout de 800ms y la llamada
// dataService.updateProgreso(...). Buscamos que canSaveProgress aparezca
// antes de updateProgreso en el bloque.
ok('Visor llama pb.canSaveProgress(currentIndex)',
   /pb\.canSaveProgress\s*\(\s*currentIndex\s*\)/.test(visorSrc));

// Hay al menos 2 invocaciones (debounce + cleanup flush)
const canSaveCalls = (visorSrc.match(/pb\.canSaveProgress/g) ?? []).length;
ok('Visor llama canSaveProgress al menos 2 veces (debounce + cleanup)',
   canSaveCalls >= 2,
   `count=${canSaveCalls}`);

// El gate debe preceder a updateProgreso en el path principal
ok('canSaveProgress aparece ANTES de dataService.updateProgreso en el path debounced',
   /pb\.canSaveProgress\s*\(\s*currentIndex\s*\)[\s\S]{0,800}?dataService\.updateProgreso/.test(visorSrc));

// Si gate.ok es false → log con tag PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION + return
ok('Si !gate.ok → log PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION + reason',
   /if\s*\(\s*!gate\.ok\s*\)\s*\{[\s\S]{0,400}?reason:\s*gate\.reason[\s\S]{0,200}?PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION/.test(visorSrc) ||
   /if\s*\(\s*!gate\.ok\s*\)\s*\{[\s\S]{0,400}?PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION[\s\S]{0,200}?reason:\s*gate\.reason/.test(visorSrc));

ok('Si !gate.ok → return sin guardar',
   /if\s*\(\s*!gate\.ok\s*\)\s*\{[\s\S]{0,500}?return;/.test(visorSrc));

// Path "allowed": log con tag PB_PROGRESS_SAVE_ALLOWED
ok('Path allowed loguea PB_PROGRESS_SAVE_ALLOWED',
   /PB_PROGRESS_SAVE_ALLOWED/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// Cleanup flush también gateado
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[visor cleanup] flush de salida también pasa por canSaveProgress');

// El return del useEffect (cleanup) debe llamar canSaveProgress antes de
// updateProgreso. Buscamos: dentro de un `return () => {` ... canSaveProgress ... updateProgreso
const cleanupBlock = visorSrc.match(/return\s*\(\s*\)\s*=>\s*\{[\s\S]+?dataService\.forceFlush\(\);[\s\S]+?\};/);
if (cleanupBlock) {
    const body = cleanupBlock[0];
    ok('Cleanup llama pb.canSaveProgress',
       /pb\.canSaveProgress/.test(body));
    ok('Cleanup tiene path "allowed" → updateProgreso',
       /if\s*\(\s*gate\.ok\s*\)[\s\S]{0,800}?dataService\.updateProgreso/.test(body));
    ok('Cleanup tiene path "blocked" → log via cleanup_flush',
       /PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION[\s\S]{0,300}?cleanup_flush/.test(body));
} else {
    ok('Cleanup block localizable', false);
}

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION: el guard antiguo isPendingAdvance() ya no se usa solo
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] guard antiguo isPendingAdvance reemplazado en visor');

// El visor NO debe llamar pb.isPendingAdvance() directamente para gateo de
// PROGRESS_SAVE (ahora está envuelto dentro de canSaveProgress).
ok('Visor NO llama directamente pb.isPendingAdvance() (delegado a canSaveProgress)',
   !/pb\.isPendingAdvance\s*\(\s*\)/.test(visorSrc));

// Tampoco existe el log "pending_advance_in_flight" como gate primary en el visor
ok('Visor NO usa reason "pending_advance_in_flight" (legacy)',
   !/pending_advance_in_flight/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION: el path de bloqueo NO toca playback
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] bloqueo de PROGRESS_SAVE NO afecta playback');

// El branch !gate.ok del visor NO debe llamar pb.pause, pb.skip, hardResync
// ni navigate. Buscamos el bloque if (!gate.ok) y verificamos.
const blockedBranches = visorSrc.match(/if\s*\(\s*!gate\.ok\s*\)\s*\{[\s\S]+?\}/g) ?? [];
let allClean = blockedBranches.length > 0;
for (const branch of blockedBranches) {
    if (/pb\.pause|pb\.skip|hardResync|navigate\(/.test(branch)) {
        allClean = false;
        break;
    }
}
ok('Ningún branch !gate.ok llama pb.pause / pb.skip / hardResync / navigate',
   allClean,
   `branches encontrados: ${blockedBranches.length}`);

// ───────────────────────────────────────────────────────────────────────────
// Hook: REQUEST_PROGRESS_SAVE de la machine sigue cubierto por F2
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[machine] REQUEST_PROGRESS_SAVE sigue siendo action válida');
const machineSrc = fs.readFileSync(path.join(ROOT, 'utils', 'immersivePlaybackMachine.js'), 'utf8');
ok('Actions.REQUEST_PROGRESS_SAVE existe (cubierto por playbackMachineF2.test.js)',
   /REQUEST_PROGRESS_SAVE:\s*['"]REQUEST_PROGRESS_SAVE['"]/.test(machineSrc));

ok('Reduce maneja REQUEST_PROGRESS_SAVE',
   /case\s+Actions\.REQUEST_PROGRESS_SAVE:/.test(machineSrc));

// ───────────────────────────────────────────────────────────────────────────
// Helper canSaveProgress refleja assertCanSaveProgress de F1
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[paridad] canSaveProgress refleja assertCanSaveProgress del buffer puro');

// Las mismas reglas que assertCanSaveProgress de activeSentenceBuffer.js
// pero inline para no importar. Verificamos paridad mínima de checks:
const bufferSrc = fs.readFileSync(path.join(ROOT, 'utils', 'activeSentenceBuffer.js'), 'utf8');
const assertChecks = [
    'no_active_sentence',
    'index_mismatch',
    'buffer_locked',
    'pending_next',
];
for (const check of assertChecks) {
    const inBuffer = new RegExp(`reason:\\s*['"]${check}['"]`).test(bufferSrc);
    const inHook   = new RegExp(`reason:\\s*['"]${check}['"]`).test(canSaveBody?.[0] ?? '');
    ok(`paridad reason "${check}" (buffer ↔ hook)`,
       inBuffer === inHook && inBuffer === true);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
