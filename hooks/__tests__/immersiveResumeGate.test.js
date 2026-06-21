/**
 * Hotfix structural guard: immersive TTS must wait for resolved progress.
 *
 * Run:
 *   node hooks/__tests__/immersiveResumeGate.test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');

const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');
const v2Src = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivoV2.tsx'), 'utf8');

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

console.log('immersiveResumeGate — hotfix structural guard');

ok('Visor clásico importa resolveImmersiveResumePosition',
   /resolveImmersiveResumePosition/.test(visorSrc));

ok('Visor clásico guarda remoteProgressPromiseRef',
   /remoteProgressPromiseRef\.current\s*=\s*dataService\.fetchAndMergeRemoteProgress/.test(visorSrc));

ok('Post-hydration espera la promesa remota antes de leer progreso local',
   /await\s+progressPromise[\s\S]{0,600}?dataService\.getProgresoUsuarioLibro/.test(visorSrc));

ok('Post-hydration resuelve targetIndex desde helper único',
   /const\s+resolved\s*=\s*resolveImmersiveResumePosition[\s\S]{0,450}?targetIndex\s*=\s*resolved\.startIndex/.test(visorSrc));

ok('Índice resuelto se guarda en resolvedStartIndexRef',
   /resolvedStartIndexRef\.current\s*=\s*targetIndex/.test(visorSrc));

ok('Botón play queda bloqueado mientras resumeReady=false',
   /disabled=\{pb\.status === 'loading' \|\| isHydrating \|\| !resumeReady\}/.test(visorSrc));

// Verifica el gate real de togglePlay sin acoplarse al ancho exacto del bloque
// (que creció en HF previos y usa saltos CRLF en Windows). Localiza el guard
// y confirma que los tres pasos del bloqueo ocurren en orden antes del return:
//   1. marca el play pendiente, 2. loggea el bloqueo, 3. retorna sin reproducir.
function togglePlayGateOk(src) {
    const guard = src.indexOf('if (!resumeReadyRef.current) {');
    if (guard === -1) return false;
    // Acota al cuerpo del if (hasta su return temprano) con un margen holgado.
    const region = src.slice(guard, guard + 800);
    const iPending = region.indexOf('pendingPlayAfterResumeRef.current = true');
    const iLog = region.indexOf('[immersive-tts] blocked until progress ready');
    const iReturn = region.indexOf('return;', iLog === -1 ? 0 : iLog);
    return iPending > -1 && iLog > iPending && iReturn > iLog;
}
ok('togglePlay bloquea TTS hasta progress ready', togglePlayGateOk(visorSrc));

ok('Intento de play pendiente reproduce desde targetIndex resuelto, no desde 0',
   /const\s+shouldAutoPlay\s*=\s*isAutoTransition\s*\|\|\s*pendingPlayAfterResumeRef\.current[\s\S]{0,1600}?pb\.load\(targetIndex,\s*shouldAutoPlay/.test(visorSrc));

ok('Logs incluyen resolved start index',
   /\[immersive-resume\] resolved start index/.test(visorSrc));

ok('Logs incluyen speak from index',
   /\[immersive-tts\] speak from index/.test(visorSrc));

ok('Fallback inválido queda loggeado',
   /\[immersive-resume\] fallback to index 0/.test(visorSrc));

ok('V2 sigue aislado del hook clásico',
   !/^import\s+.*useImmersivePlayback/m.test(v2Src)
   && !/from\s+['"][^'"]*useImmersivePlayback/.test(v2Src));

ok('V2 mantiene restoreProgress antes de openSession',
   v2Src.indexOf('const restore = await restoreProgress') > -1
   && v2Src.indexOf('const result = await runtime.openSession') > v2Src.indexOf('const restore = await restoreProgress')
   && /startIndex:\s*restore\.startIndex/.test(v2Src));

console.log(`\nimmersiveResumeGate — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
