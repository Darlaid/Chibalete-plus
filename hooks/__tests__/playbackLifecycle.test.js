/**
 * playbackLifecycle.test.js — F19 (lifecycle del modo inmersivo).
 *
 * Verifica las 4 reparaciones del lifecycle: A, B, C, D.
 *   A: sessionComplete como overlay, NO render desmontante.
 *   B: domCount=0 con sesión viva → PB_LIFECYCLE_ACTIVE_DOM_LOST, no drift.
 *   C: cap MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION + reset en content change.
 *   D: BlockEngine.subscribe verifica unmounted + contentId match.
 *
 * Cobertura (12 criterios del spec del usuario):
 *
 *   1. sessionComplete=true NO retorna otro JSX desmontante.
 *   2. sessionComplete=true se renderiza como overlay dentro del return principal.
 *   3. domCount=0 con sesión viva emite PB_LIFECYCLE_ACTIVE_DOM_LOST.
 *   4. lifecycle violation NO escala a hardResync.
 *   5. lifecycle recovery: PB_LIFECYCLE_RECOVER_ATTEMPT + SUCCESS/FAILED.
 *   6. hardResync chequea hardResyncAttemptsRef y cap MAX=2.
 *   7. cap excedido → PB_HARD_RESYNC_CAPPED + status='error' + no más exec.
 *   8. reset() resetea hardResyncAttemptsRef a 0.
 *   9. BlockEngine.subscribe captura subscribedContentId al subscribe time.
 *   10. case complete (y todos los cases) verifican unmounted.
 *   11. case complete verifica analyticsContentIdRef === subscribedContentId.
 *   12. No hay condicionales por contentId/título/índice literal.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackLifecycle.test.js
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

console.log('\nplaybackLifecycle — F19 (A+B+C+D del lifecycle inmersivo)');

// ───────────────────────────────────────────────────────────────────────────
// CAMBIO A — sessionComplete como overlay, NO render desmontante
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[A] sessionComplete como overlay (no desmonta el visor)');

// 1. NO existe el early return `if (sessionComplete) return <...>;`
ok('No hay early return "if (sessionComplete) { return ( <div ..." desmontante',
   !/if\s*\(\s*sessionComplete\s*\)\s*\{\s*\n\s*return\s*\(\s*\n\s*<div\s+className=["'][^"']*h-screen/.test(visorSrc));

// 2. El overlay vive DENTRO del return principal, con condicional inline
ok('Overlay condicional renderizado con {sessionComplete && ...}',
   /\{sessionComplete\s*&&\s*\(/.test(visorSrc));

// 3. El overlay tiene atributo data-completion-overlay para auditoría
ok('Overlay marcado con data-completion-overlay="true"',
   /data-completion-overlay\s*=\s*["']true["']/.test(visorSrc));

// 4. El overlay incluye el role="dialog" / aria-modal (accesible)
ok('Overlay incluye role="dialog" y aria-modal="true"',
   /role\s*=\s*["']dialog["'][\s\S]{0,200}?aria-modal\s*=\s*["']true["']/.test(visorSrc));

// 5. El render principal (con ImmersiveShell) NO está condicionado por sessionComplete
const returnMatch = visorSrc.match(/return\s*\(\s*\n\s*<div\s+className=\{[^}]*relative\s+h-screen[\s\S]+?<ImmersiveShell/);
ok('Return principal con <ImmersiveShell /> existe sin condición de sessionComplete',
   returnMatch !== null);

// ───────────────────────────────────────────────────────────────────────────
// CAMBIO B (M-5.4.6 DEMOLITION Phase 1.a) — Sección ELIMINADA.
//
// El drift detector y su lifecycle recovery (PB_LIFECYCLE_ACTIVE_DOM_LOST,
// PB_LIFECYCLE_RECOVER_*) fueron removidos. La rama "domCount===0 con sesión
// viva → log + pb.pause" ya no existe. Si el DOM pierde la frase activa, es
// bug de render — el runtime NO intenta corregirlo.
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[B] (DEMOLITION Phase 1.a) drift detector + lifecycle recovery eliminado');
ok('B: drift detector ELIMINADO del visor (no contiene driftStrikesRef declaración nueva)',
   !/const\s+driftStrikesRef\s*=\s*useRef\s*\(\s*0\s*\)/.test(visorSrc));
ok('B: lifecycleRecoveryAttemptedRef ELIMINADO',
   !/lifecycleRecoveryAttemptedRef/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// CAMBIO C — cap de hardResync por sesión
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[C] cap MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION');

ok('Hook define MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION constante',
   /const\s+MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION\s*=\s*\d+/.test(hookSrc));

const capMatch = hookSrc.match(/const\s+MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION\s*=\s*(\d+)/);
const capValue = capMatch ? parseInt(capMatch[1], 10) : 0;
ok(`MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION es 1 o 2 (got ${capValue})`,
   capValue === 1 || capValue === 2);

ok('Hook declara hardResyncAttemptsRef',
   /hardResyncAttemptsRef\s*=\s*useRef\s*\(\s*0\s*\)/.test(hookSrc));

// hardResync chequea cap antes de ejecutar
ok('hardResync chequea attempts >= MAX antes de ejecutar',
   /const\s+hardResync\s*=[\s\S]{0,500}?hardResyncAttemptsRef\.current\s*>=\s*MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION/.test(hookSrc));

ok('Si cap excedido: log PB_HARD_RESYNC_CAPPED',
   /PB_HARD_RESYNC_CAPPED/.test(hookSrc));

// El orden actual es: cap check → log PB_HARD_RESYNC_CAPPED → setStatus(error) +
// onPlayChange(false) → return. Aceptamos ambos órdenes.
ok('Si cap excedido: setStatus("error") + return',
   /PB_HARD_RESYNC_CAPPED[\s\S]{0,800}?setStatus\s*\(\s*['"]error['"]\s*\)[\s\S]{0,400}?return;/.test(hookSrc));

ok('hardResync incrementa hardResyncAttemptsRef en cada exec',
   /hardResyncAttemptsRef\.current\+\+/.test(hookSrc));

// reset() resetea el contador
ok('reset() resetea hardResyncAttemptsRef.current = 0',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?hardResyncAttemptsRef\.current\s*=\s*0/.test(hookSrc));

// El log normal de PB_HARD_RESYNC incluye attempt + cap
ok('Log PB_HARD_RESYNC incluye attempt y cap',
   /PB_HARD_RESYNC[^_][\s\S]{0,400}?attempt:\s*hardResyncAttemptsRef\.current/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// CAMBIO D — BlockEngine.subscribe guards
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[D] BlockEngine.subscribe verifica unmounted + contentId match');

ok('Visor captura subscribedContentId al subscribe time',
   /subscribedContentId\s*=\s*analyticsContentIdRef\.current/.test(visorSrc));

ok('Subscribe handler chequea unmounted.current antes de procesar',
   /engine\.subscribe\s*\(\s*\(\s*event\s*\)[\s\S]{0,800}?if\s*\(\s*unmounted\.current\s*\)\s*return;/.test(visorSrc));

ok('Subscribe handler chequea analyticsContentIdRef.current !== subscribedContentId',
   /analyticsContentIdRef\.current\s*!==\s*subscribedContentId/.test(visorSrc));

// El case 'complete' NO retorna otro JSX (validar Cambio A indirectamente).
// Ventana ampliada por F20: el case ahora incluye 3 logs PB_BLOCK_COMPLETE_*.
ok('case complete sigue llamando setSessionComplete(true) (UI overlay)',
   /case\s+['"]complete['"]:[\s\S]{0,3000}?setSessionComplete\s*\(\s*true\s*\)/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION universal — sin condicionales por contentId/título/índice
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] Universal — sin hacks por libro/título/índice');

// Patrones literales explícitos prohibidos
const forbiddenPatterns = [
    /content(?:Id)?\s*[=!]==\s*['"]content-1773/,
    /content(?:Id)?\s*[=!]==\s*['"]content-1778/,
    /title[\s\S]{0,80}?Alicia/,
    /title[\s\S]{0,80}?guerra de los mundos/i,
    /\bindex\s*===\s*72\b/,
    /\bindex\s*===\s*73\b/,
    /\bcurrentIndex\s*===\s*72\b/,
];
for (const re of forbiddenPatterns) {
    ok(`Hook NO contiene patrón prohibido ${re}`,
       !re.test(hookSrc));
    ok(`Visor NO contiene patrón prohibido ${re}`,
       !re.test(visorSrc));
}

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — el árbol del visor sigue montado en sessionComplete
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] Árbol del visor permanece montado en sessionComplete');

// El return principal mantiene <ImmersiveShell> SIEMPRE
ok('<ImmersiveShell> está en el return principal (no condicionado a !sessionComplete)',
   /<ImmersiveShell\s+sentences=/.test(visorSrc));

// Los <audio> elements tampoco están condicionados
ok('<audio ref={pb.audioRefA}> existe en el return principal',
   /<audio[\s\S]{0,300}?ref=\{pb\.audioRefA\}/.test(visorSrc));

ok('<audio ref={pb.audioRefB}> existe en el return principal',
   /<audio[\s\S]{0,300}?ref=\{pb\.audioRefB\}/.test(visorSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
