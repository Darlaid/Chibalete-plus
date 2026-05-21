/**
 * VisorInmersivoV2.test.mjs — Sprint Inmersivo V2 / Fase M-2.
 *
 * Tests estructurales del componente React. Su propósito principal es
 * verificar que el viewer V2 NO importa nada del stack V1 ni introduce
 * patrones prohibidos por la spec M-2 (hardResync, timers de reparación,
 * gobierno de audio/sesión/progreso).
 *
 * La lógica funcional del viewer (qué hace al montar, qué hace al click,
 * qué hace al unmount) está cubierta por la suite del bridge
 * (utils/__tests__/immersiveRuntimeV2Bridge.test.mjs), porque toda esa
 * lógica vive en el bridge — el componente es un wrapper fino.
 *
 * Estos tests son secundarios al éxito principal del bridge, como pide
 * el prompt M-2 ("sin regex como éxito principal"). Su valor es lock-in
 * arquitectónico: si en el futuro alguien intenta importar
 * useImmersivePlayback en el V2, este test rompe.
 *
 * Cómo correr:
 *   node pages/__tests__/VisorInmersivoV2.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerPath = path.join(__dirname, '..', 'VisorInmersivoV2.tsx');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('VisorInmersivoV2 — Sprint Inmersivo V2 / Fase M-2 (structural)');

// ─────────────────────────────────────────────────────────────────────────────
// 0. El archivo existe y se puede leer
// ─────────────────────────────────────────────────────────────────────────────
section('[0] viewer existe y es legible');
{
    ok('archivo presente en pages/VisorInmersivoV2.tsx', fs.existsSync(viewerPath));
}
const source = fs.readFileSync(viewerPath, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Imports: NO debe traer nada del stack V1
//
// Los archivos V1 que NO debe tocar M-2 son:
//   - hooks/useImmersivePlayback
//   - utils/immersivePlaybackMachine
//   - utils/activeSentenceBuffer
//   - engines/StartupEngine, BlockEngine, RewardEngine, TranceEngine
//     (V1 los usa para gamificación; V2 minimal no los necesita)
//
// M-5 (presentation layer): components/ImmersiveShell SÍ está permitido.
//   Es pure-render (1 import: React, zero deps V1, props-in JSX-out).
//   Reusarlo desde V2 evita drift visual sin acoplar runtime. El audit
//   `scripts/audit-v2-isolation.mjs` lo whiteliste con la misma justificación.
//
// Nota: esto es check estático — su propósito es lock-in. La auditoría
// real del comportamiento la cubren los tests del bridge.
// ─────────────────────────────────────────────────────────────────────────────
section('[1] el viewer NO importa stack V1 (excepto engines puros reusables)');
{
    // Sprint M-3.5: la lista se afina. StartupEngine SÍ está permitido
    // porque es engine puro (zero React, zero side effects, AbortSignal-aware)
    // y es la fuente única de verdad del parsing de oraciones — auditoría
    // M-2.5 lo identificó como reusable AS-IS. El uso es factory pattern
    // (new StartupEngine(...)), no copia de lógica.
    const forbidden = [
        'useImmersivePlayback',       // hook V1 con hardResync, machine interna
        'immersivePlaybackMachine',   // state machine V1
        'activeSentenceBuffer',       // buffer V1
        // 'ImmersiveShell' WHITELISTED en M-5 — pure-render shell, ver header.
        'BlockEngine',                // gamificación V1 (timer + estados)
        'RewardEngine',               // gamificación V1
        'TranceEngine',               // gradient UI V1
    ];
    for (const name of forbidden) {
        const re = new RegExp(`(import\\s[^;]*from\\s+['"][^'"]*${name}[^'"]*['"])|(from\\s+['"][^'"]*${name}[^'"]*['"])`);
        ok(`no importa ${name}`, !re.test(source), `match contra "${name}"`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NO contiene hardResync ni HARD_RESYNC
//
// hardResync es la API V1 que M-1 prohibió (Runtime V2 no la expone).
// Verificamos que el viewer no haga referencia textual.
// ─────────────────────────────────────────────────────────────────────────────
section('[2] NO contiene hardResync / HARD_RESYNC en código (excluye docstrings)');
{
    // Stripped de comentarios: la doc del viewer menciona "NO contiene:
    // hardResync" como auto-documentación de la ausencia. La regla aplica
    // al código vivo, no al texto descriptivo.
    const stripped = stripComments(source);
    ok('no menciona hardResync en código',  !/hardResync\b/i.test(stripped));
    ok('no menciona HARD_RESYNC en código', !/HARD_RESYNC/.test(stripped));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. NO usa timers de reparación
//
// Patrones explícitamente prohibidos: setTimeout/setInterval para retry,
// requestAnimationFrame para polling, "repair", "resync", "recover" como
// función o callback (heuristic: si aparecen, levantar el flag).
//
// Sí permitido: el código no contiene NINGÚN setTimeout/setInterval/RAF
// (M-2 no necesita timers — el runtime gestiona los timers internos de
// visibility timeout).
// ─────────────────────────────────────────────────────────────────────────────
section('[3] NO usa RAF/repair/resync (timers legítimos M-3.5 permitidos)');
{
    // Stripped de comentarios para no ser engañados por menciones en docs.
    //
    // Sprint M-3.5: setTimeout/setInterval están AHORA permitidos para:
    //   - Timer del nivel (setTimeout duration → dispatch pause).
    //   - DevDiagnosticsPanel polling (setInterval cada 500ms para refresh).
    // NO permitido: requestAnimationFrame para polling DOM, repair/resync
    // como acciones de divergencia.
    const stripped = stripComments(source);
    ok('no usa requestAnimationFrame', !/\brequestAnimationFrame\s*\(/.test(stripped));
    ok('no contiene "repair" en código',  !/\brepair\s*\(/.test(stripped));
    ok('no contiene "resync" en código',  !/\bresync\s*\(/.test(stripped));
    // recover() SÍ está permitido en M-3.5 (botón Reintentar → recoverFromError).
    ok('NO usa hardResync (sigue prohibido)',  !/\bhardResync\b/.test(stripped));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SÍ importa el bridge V2 + Runtime types
// ─────────────────────────────────────────────────────────────────────────────
section('[4] SÍ importa el stack productivo M-3.5');
{
    // M-3.5: el viewer ahora wirea el stack productivo completo.
    ok('importa createProductionRuntime',
       /\bcreateProductionRuntime\b/.test(source));
    ok('importa hydrateSentences (sentenceAdapter)',
       /\bhydrateSentences\b/.test(source));
    ok('importa restoreProgress (progressAdapter)',
       /\brestoreProgress\b/.test(source));
    ok('importa commitProgress (progressAdapter)',
       /\bcommitProgress\b/.test(source));
    ok('importa normalizeRaw (manifestAdapter)',
       /\bnormalizeRaw\b/.test(source));
    ok('importa StartupEngine (engine factory inyectado)',
       /from\s+['"][^'"]*engines\/StartupEngine['"]/.test(source));
    ok('importa al menos un dispatch helper del bridge',
       /\bdispatch(Play|Pause|Resume|Prev|Next|GoTo)\b/.test(source));
    ok('importa reportVisible',         /\breportVisible\b/.test(source));
    ok('importa dataService productivo',
       /from\s+['"][^'"]*services\/dataService['"]/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Wire up React mínimo correcto
//
// useSyncExternalStore para evitar race con el store, useEffect/useRef para
// lifecycle. NO useReducer ni state custom para gobernar la sesión.
// ─────────────────────────────────────────────────────────────────────────────
section('[5] usa useSyncExternalStore para snapshot');
{
    ok('usa useSyncExternalStore', /\buseSyncExternalStore\b/.test(source));
    ok('usa useEffect',             /\buseEffect\b/.test(source));
    ok('usa useRef',                /\buseRef\b/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Componente exporta default
// ─────────────────────────────────────────────────────────────────────────────
section('[6] export default presente');
{
    ok('export default VisorInmersivoV2',
       /export\s+default\s+VisorInmersivoV2/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. M-4: ruta local DEV ONLY presente bajo guard, NO reemplaza V1
// ─────────────────────────────────────────────────────────────────────────────
section('[7] M-4 — App.tsx tiene ruta local DEV ONLY con guards correctos');
{
    const appPath = path.join(__dirname, '..', '..', 'App.tsx');
    const appSrc  = fs.readFileSync(appPath, 'utf8');

    // V2 SÍ está mencionado (M-4 wire local).
    ok('App.tsx menciona VisorInmersivoV2',         /VisorInmersivoV2/.test(appSrc));
    ok('App.tsx contiene ruta /visor-v2-local',     /\/visor-v2-local\/:id/.test(appSrc));
    ok('App.tsx marca bloque DEV ONLY',             /DEV ONLY — NO PROD ROUTE/.test(appSrc));
    ok('App.tsx guard localStorage IMMERSIVE_RUNTIME',
       /IMMERSIVE_RUNTIME/.test(appSrc) && /v2-local/.test(appSrc));

    // V1 SIGUE siendo la ruta canónica.
    ok('App.tsx mantiene ruta /leer/inmersivo/:id (V1)',
       /\/leer\/inmersivo\/:id/.test(appSrc));
    ok('App.tsx mantiene ImmersiveWrapper (V1)',
       /<ImmersiveWrapper\s*\/?>/.test(appSrc));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. M-3.5 — recovery UI presente
// ─────────────────────────────────────────────────────────────────────────────
section('[8] M-3.5 — recovery UI conectado a runtime.recoverFromError');
{
    ok('contiene btn-recover testid',
       /data-testid=['"]btn-recover['"]/.test(source));
    ok('contiene recovery-banner testid',
       /data-testid=['"]recovery-banner['"]/.test(source));
    ok('llama runtime.recoverFromError',
       /runtime\.recoverFromError\s*\(/.test(source));
    ok('preserveIndex: true en recover',
       /preserveIndex\s*:\s*true/.test(source));
    ok('reconoce audio_autoplay_blocked como recoverable',
       /audio_autoplay_blocked/.test(source));
    ok('reconoce audio_decode_failed como recoverable',
       /audio_decode_failed/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. M-3.5 — useAuth para userId real (no stub)
// ─────────────────────────────────────────────────────────────────────────────
section('[9] M-3.5 — useAuth productivo');
{
    ok('importa useAuth',     /from\s+['"][^'"]*context\/AuthContext['"]/.test(source));
    ok('llama useAuth()',     /\buseAuth\s*\(\s*\)/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. M-3.5 — dispose en unmount (lifecycle stack)
// ─────────────────────────────────────────────────────────────────────────────
section('[10] M-3.5 — stack.dispose en unmount real');
{
    ok('llama stack.dispose()', /\.dispose\s*\(/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. M-3.5 — DevDiagnosticsPanel detrás de window.__IMMERSIVE_V2_DEBUG__
// ─────────────────────────────────────────────────────────────────────────────
section('[11] M-3.5 — DevDiagnosticsPanel gated por flag');
{
    ok('contiene DevDiagnosticsPanel',
       /\bDevDiagnosticsPanel\b/.test(source));
    ok('check window.__IMMERSIVE_V2_DEBUG__',
       /__IMMERSIVE_V2_DEBUG__/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. M-4 fix — __immersiveV2Stack se expone INMEDIATAMENTE al crear stack
// ─────────────────────────────────────────────────────────────────────────────
section('[12] M-4 — __immersiveV2Stack expuesto inmediato (no via panel)');
{
    // El bridge a window debe estar en el bloque de creación del stack,
    // NO en el useEffect del DevDiagnosticsPanel.
    const stripped = stripComments(source);
    // Cualquiera de estos patrones cuenta: el bridge se expone fuera del panel.
    ok('contiene asignación window.__immersiveV2Stack en bootstrap',
       /__immersiveV2Stack\s*=\s*candidate/.test(stripped)
       || /__immersiveV2Stack\s*=\s*stackRef\.current/.test(stripped));
    ok('contiene cleanup del bridge en unmount',
       /delete\s*\(window\s*as\s*any\)\.__immersiveV2Stack/.test(stripped));
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. M-4 fix #2 — bootstrap defensive con try/catch + fallback
// ─────────────────────────────────────────────────────────────────────────────
section('[16] M-4 fix#2 — Wrapper + Inner + bootstrap defensive + fallback');
{
    const stripped = stripComments(source);
    ok('contiene try/catch en bootstrap',
       /try\s*\{[\s\S]*?bootstrap[\s\S]*?\}\s*catch/.test(stripped)
       || /try\s*\{[\s\S]*?defaultViewerStackBuilder[\s\S]*?\}\s*catch/.test(stripped));
    ok('contiene console.log viewer.bootstrap.start',
       /console\.log\([^)]*viewer\.bootstrap\.start/.test(stripped));
    ok('contiene console.log viewer.bootstrap.stack_created',
       /console\.log\([^)]*viewer\.bootstrap\.stack_created/.test(stripped));
    ok('contiene console.log viewer.bootstrap.stack_exposed',
       /console\.log\([^)]*viewer\.bootstrap\.stack_exposed/.test(stripped));
    ok('contiene console.error viewer.bootstrap.fail',
       /console\.error\([^)]*viewer\.bootstrap\.fail/.test(stripped));
    ok('contiene BootstrapFailureFallback component',
       /BootstrapFailureFallback/.test(source));
    ok('contiene bootstrap-failure testid',
       /data-testid=['"]bootstrap-failure['"]/.test(source));
    ok('contiene bootstrap-error-message testid',
       /data-testid=['"]bootstrap-error-message['"]/.test(source));
    ok('contiene bootstrap-error-stack testid',
       /data-testid=['"]bootstrap-error-stack['"]/.test(source));
    ok('contiene VisorInmersivoV2Inner separado',
       /VisorInmersivoV2Inner/.test(source));
    ok('valida shape del candidate (subscribe + diagnostics.log)',
       /typeof[\s\S]{0,80}\.runtime\?\.subscribe[\s\S]{0,200}invalid stack shape/.test(stripped)
       || /candidate[\s\S]{0,400}invalid stack shape/.test(stripped));
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. M-4 fix — diagnostics viewer.* emitidos
// ─────────────────────────────────────────────────────────────────────────────
section('[13] M-4 — viewer emite diagnostics propios para hangs');
{
    ok('viewer.stack.created',         /viewer\.stack\.created/.test(source));
    ok('viewer.hydrate.start',         /viewer\.hydrate\.start/.test(source));
    ok('viewer.hydrate.done',          /viewer\.hydrate\.done/.test(source));
    ok('viewer.hydrate.fail',          /viewer\.hydrate\.fail/.test(source));
    ok('viewer.openSession.start',     /viewer\.openSession\.start/.test(source));
    ok('viewer.openSession.done',      /viewer\.openSession\.done/.test(source));
    ok('viewer.openSession.fail',      /viewer\.openSession\.fail/.test(source));
    ok('viewer.runtime.snapshot (M-4 fix #3)', /viewer\.runtime\.snapshot/.test(source));
    ok('console.log [V2] viewer.runtime.snapshot directo',
       /console\.log\([^)]*\[V2\][^)]*viewer\.runtime\.snapshot/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. M-4 fix — hydration timeout pasa al sentenceAdapter
// ─────────────────────────────────────────────────────────────────────────────
section('[14] M-4 — pasa timeoutMs al hydrateSentences');
{
    ok('contiene constante HYDRATION_TIMEOUT_MS',
       /HYDRATION_TIMEOUT_MS\s*=\s*\d+/.test(source));
    ok('pasa timeoutMs en hydrateSentences call',
       /timeoutMs\s*:\s*HYDRATION_TIMEOUT_MS/.test(source));
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. M-4 fix — UI muestra error explícito para TODOS los kinds
// ─────────────────────────────────────────────────────────────────────────────
section('[15] M-4 — UI banner muestra hydration_timeout y content_invalid');
{
    ok('label hydration_timeout',  /hydration_timeout[\s\S]{0,160}tard/.test(source));
    ok('label content_invalid',    /content_invalid[\s\S]{0,160}procesar/.test(source));
    ok('error-kind testid',        /data-testid=['"]error-kind['"]/.test(source));
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\nVisorInmersivoV2 (structural) — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * stripComments — remueve comentarios de línea (// ...) y de bloque (/* ... *\/)
 * para que las búsquedas de patrones prohibidos no se vean engañadas por
 * menciones legítimas en docstrings.
 */
function stripComments(src) {
    return src
        // Bloque /* ... */ multi-línea, no greedy.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Línea // ... hasta fin de línea.
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
