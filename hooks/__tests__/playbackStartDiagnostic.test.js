/**
 * playbackStartDiagnostic.test.js — F16 (PB_START_DIAGNOSTIC universal).
 *
 * Verifica que el hook expone getStartDiagnostic con snapshot completo del
 * estado runtime, y que el visor lo dispara tras 1500ms de togglePlay sin
 * que pb llegue a 'playing'. Permite identificar exactamente cuál contrato
 * falla en cualquier libro sin necesidad de hacks por contentId.
 *
 * Cobertura:
 *   1. Hook expone getStartDiagnostic(index): Record<string, any>.
 *   2. Snapshot incluye contentId, sessionKey, userId, index, currentIndex.
 *   3. Snapshot incluye hasActiveSentence, activeSentenceStatus, visualConfirmed.
 *   4. Snapshot incluye audioFailed, hasAudioUrl.
 *   5. Snapshot incluye machineStatus, pendingTransition.
 *   6. Snapshot incluye currentSrc, currentPlayerReadyState, currentPlayerPaused.
 *   7. Snapshot incluye contentSession (para detectar libro stale).
 *   8. Visor schedulea diagnostic timer tras togglePlay (1500ms).
 *   9. Visor emite kind PB_START_DIAGNOSTIC.
 *   10. Visor cancela timer si pb.isPlaying llega antes.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackStartDiagnostic.test.js
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

console.log('\nplaybackStartDiagnostic — F16 (diagnóstico universal de arranque)');

// ───────────────────────────────────────────────────────────────────────────
// 1. Hook expone getStartDiagnostic
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1] Hook expone getStartDiagnostic(index)');

ok('Interface declara getStartDiagnostic(index): Record<string, any>',
   /interface\s+ImmersivePlayback[\s\S]+?getStartDiagnostic:\s*\(\s*index:\s*number\s*\)\s*=>\s*Record<string,\s*any>/.test(hookSrc));

ok('Hook define const getStartDiagnostic',
   /const\s+getStartDiagnostic\s*=\s*\(\s*index:\s*number\s*\)\s*:\s*Record<string,\s*any>\s*=>/.test(hookSrc));

ok('return del hook incluye getStartDiagnostic',
   /return\s*\{[\s\S]+?getStartDiagnostic[\s\S]+?\};/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 2-7. Snapshot incluye campos requeridos
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[2-7] Snapshot incluye todos los campos del spec F16');

const diagBody = hookSrc.match(/const\s+getStartDiagnostic\s*=[\s\S]+?\};\s*\n\s*\}\s*;\s*\n/);
if (!diagBody) {
    ok('cuerpo de getStartDiagnostic localizable', false);
} else {
    const body = diagBody[0];

    // M-5.4.6 (Phase 1.b.5) — 'visualConfirmed' eliminado del diagnostic.
    // v4.0.2 — 'canStartAudio' eliminado del diagnostic: la función fue
    // removida en la DEMOLITION M-5.4.6 y el campo quedó como referencia rota.
    const requiredFields = [
        'contentId', 'sessionKey', 'userId', 'index', 'currentIndex',
        'sentencesLength',
        'hasActiveSentence', 'activeSentenceIndex', 'activeSentenceStatus',
        'audioStarted', 'audioEnded', 'progressEligible',
        'audioFailed', 'audioRetried', 'hasAudioUrl',
        'isPreparedForIndex',
        'machineStatus', 'committedIndex', 'visualIndex', 'audioIndex',
        'progressIndex', 'pendingTransition',
        'playerStatus', 'currentSrc', 'currentPlayerReadyState',
        'currentPlayerDuration', 'currentPlayerPaused',
        'loadToken', 'contentSession', 'isPendingAdvance', 'standbyReady',
    ];
    for (const field of requiredFields) {
        ok(`Snapshot incluye campo "${field}"`,
           new RegExp(`\\b${field}:`).test(body));
    }
}

// ───────────────────────────────────────────────────────────────────────────
// 8. Visor schedulea diagnostic timer tras togglePlay
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[8] Visor schedulea diagnostic 1500ms tras togglePlay');

ok('Visor declara startDiagnosticTimerRef',
   /startDiagnosticTimerRef\s*=\s*useRef[\s\S]{0,150}?null/.test(visorSrc));

ok('togglePlay schedulea setTimeout(1500)',
   /togglePlay\s*=[\s\S]{0,2500}?setTimeout\s*\([\s\S]{0,500}?,\s*1500\s*\)/.test(visorSrc));

ok('togglePlay limpia timer previo (clearTimeout) antes de schedule',
   /togglePlay\s*=[\s\S]{0,1500}?clearTimeout\s*\(\s*startDiagnosticTimerRef\.current/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// 9. Emite kind PB_START_DIAGNOSTIC con snapshot
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[9] El timer emite PB_START_DIAGNOSTIC con snapshot completo');

ok('Visor loguea kind PB_START_DIAGNOSTIC',
   /kind:\s*['"]PB_START_DIAGNOSTIC['"]/.test(visorSrc));

ok('Log incluye snapshot: pb.getStartDiagnostic(targetIdx)',
   /snapshot:\s*pb\.getStartDiagnostic\s*\(\s*targetIdx\s*\)/.test(visorSrc));

ok('Log incluye triggeredAfterMs: 1500',
   /triggeredAfterMs:\s*1500/.test(visorSrc));

// El log SOLO ocurre si !pb.isPlaying (no spam para casos exitosos)
ok('Log condicionado a !pb.isPlaying tras 1500ms',
   /setTimeout[\s\S]{0,800}?if\s*\(\s*!pb\.isPlaying\s*\)\s*\{[\s\S]{0,500}?PB_START_DIAGNOSTIC/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// 10. Cancelar timer si pb.isPlaying llega antes
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[10] Cancela diagnostic timer si pb.isPlaying llega antes');

ok('useEffect dependiente de pb.isPlaying limpia timer',
   /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,500}?pb\.isPlaying[\s\S]{0,500}?clearTimeout\s*\(\s*startDiagnosticTimerRef\.current/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — el diagnostic NO contiene condicionales por contentId
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] getStartDiagnostic es universal (sin hacks)');

if (diagBody) {
    const body = diagBody[0];
    ok('getStartDiagnostic NO usa contentId === literal',
       !/contentId\s*===\s*['"]content-/.test(body));
    ok('getStartDiagnostic NO usa título "Alicia" / "guerra"',
       !/Alicia/.test(body) && !/guerra/i.test(body));
    ok('getStartDiagnostic NO contiene if/switch sobre index específico',
       !/if\s*\(\s*index\s*===\s*\d+/.test(body));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
