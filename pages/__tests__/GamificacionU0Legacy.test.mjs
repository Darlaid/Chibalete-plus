/**
 * GamificacionU0Legacy.test.mjs — CHP-GAMIFICACION-G4-UX-U0.
 *
 * Limpieza de gamificación heredada (docs/gamificacion/GAMIFICACION_G4_UX_01.md §G):
 *  [R] RewardEngine: sin XP, nivel ni racha; nada en localStorage; solo continuidad
 *      técnica en memoria. Prueba de comportamiento real (bundle con esbuild) con
 *      TranceEngine: la atenuación se activa con 3 bloques seguidos, como antes.
 *  [V] VisorInmersivo: sin avisos de XP, telemetría con level 0 y sin level_up;
 *      duración de sesión con etiquetas descriptivas y mismas duraciones (D44).
 *  [P] Perfil: sin «Nivel» ni «Puntos de Magia».
 *  [H] Home: sin «racha».
 *  [M] DashboardMediador: sin avgPeakStreak ni «streak».
 *
 *   node pages/__tests__/GamificacionU0Legacy.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

console.log('\n[R] RewardEngine: solo continuidad técnica');
const reward = read('engines/RewardEngine.ts');
const rewardCode = code(reward);
ok('sin localStorage', !/localStorage/.test(rewardCode));
ok('sin XP, nivel ni multiplicador', !/\bxp\b|xpGained|level|multiplier|BASE_XP/i.test(rewardCode));
ok('sin «streak» en el código', !/streak/i.test(rewardCode));
ok('expone solo continuidad', /consecutiveBlocks/.test(rewardCode) && /getIsInFocusFlow/.test(rewardCode));
ok('ya no existen el hook ni los avisos de XP',
    !fs.existsSync(path.join(ROOT, 'hooks/useRewardFeedback.ts')) && !fs.existsSync(path.join(ROOT, 'components/RewardToasts.tsx')));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_u0_'));
try {
    const out = path.join(tmp, 'engines.mjs');
    fs.writeFileSync(path.join(tmp, 'entry.ts'),
        `export { RewardEngine } from ${JSON.stringify(path.join(ROOT, 'engines/RewardEngine.ts'))};\n`
        + `export { TranceEngine } from ${JSON.stringify(path.join(ROOT, 'engines/TranceEngine.ts'))};\n`);
    await esbuild.build({ entryPoints: [path.join(tmp, 'entry.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    const { RewardEngine, TranceEngine } = await import(pathToFileURL(out).href);

    // BlockEngine mínimo: solo emite start/complete.
    const listeners = new Set();
    const block = { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } };
    const fire = (type) => [...listeners].forEach((l) => l({ type }));
    const touched = [];
    globalThis.localStorage = { getItem: (k) => { touched.push(['get', k]); return null; }, setItem: (k) => touched.push(['set', k]) };

    const r = new RewardEngine(block);
    const t = new TranceEngine(r);
    const events = [];
    r.subscribe((e) => events.push(e));
    const blockDone = () => { fire('start'); fire('complete'); };
    blockDone(); blockDone();
    ok('dos bloques seguidos: continuidad 2, sin atenuación', r.getState().consecutiveBlocks === 2 && !r.getIsInFocusFlow() && !t.getState().isActive);
    blockDone();
    ok('tercer bloque seguido: atenuación activa (igual que antes)', r.getState().consecutiveBlocks === 3 && r.getIsInFocusFlow() && t.getState().isActive);
    ok('un evento de continuidad por bloque, sin xp ni nivel', events.length === 3 && events.every((e) => e.type === 'continuity' && !('xp' in e.state) && !('level' in e.state)));
    const last = r.getState().lastBlockTimestamp;
    // Pausa larga: el siguiente bloque empieza fuera de la ventana de 30 s.
    const realNow = Date.now;
    Date.now = () => last + 31_000;
    blockDone();
    Date.now = realNow;
    ok('tras una pausa larga la continuidad vuelve a 1 y la atenuación se apaga', r.getState().consecutiveBlocks === 1 && !r.getIsInFocusFlow() && !t.getState().isActive);
    ok('bloques de la sesión contados en memoria', r.getState().blocksCompleted === 4);
    r.destroy(); t.destroy();
    ok('nada leído ni escrito en localStorage', touched.length === 0, JSON.stringify(touched));
    const r2 = new RewardEngine(block);
    ok('una sesión nueva empieza en cero (sin persistencia)', r2.getState().consecutiveBlocks === 0 && r2.getState().blocksCompleted === 0);
    r2.destroy();
    delete globalThis.localStorage;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n[V] VisorInmersivo');
const visor = read('pages/VisorInmersivo.tsx');
const visorCode = code(visor);
ok('no importa ni muestra avisos de XP', !/useRewardFeedback|RewardToasts|\+\$\{?\w*\}? XP/.test(visorCode));
ok('no emite level_up', !/'level_up'/.test(visorCode));
ok('telemetría sin nivel: todo `level` es 0', (visorCode.match(/\blevel:\s*([^,\n]+)/g) ?? []).every((m) => /level:\s*0$/.test(m.trim())));
ok('streak de telemetría = bloques consecutivos', !/\.streak\b/.test(visorCode) && /streak: s\.consecutiveBlocks/.test(visorCode));
const levels = visor.match(/const LEVELS = \{([\s\S]*?)\};/)?.[1] ?? '';
ok('duración de sesión: mismas claves y duraciones', /1: \{ duration: 40,/.test(levels) && /2: \{ duration: 180,/.test(levels) && /3: \{ duration: 300,/.test(levels)
    && /4: \{ duration: 1200,/.test(levels) && /5: \{ duration: Infinity,/.test(levels));
ok('duración de sesión: sin «Nivel» ni rangos (Novato, Maestro, Leyenda…)', levels.length > 0 && !/Nivel|Novato|Aprendiz|Explorador|Maestro|Leyenda/.test(levels));

console.log('\n[P] Perfil');
const perfil = code(read('pages/Perfil.tsx'));
ok('sin «Puntos de Magia» ni user.puntos', !/Puntos de Magia|user\.puntos/.test(perfil));
ok('sin nivel_lectura', !/nivel_lectura/.test(perfil));

console.log('\n[H] Home');
ok('sin «racha»', !/racha/i.test(code(read('pages/Home.tsx'))));

console.log('\n[M] DashboardMediador');
const dash = code(read('pages/DashboardMediador.tsx'));
ok('sin avgPeakStreak ni streakBreakRate', !/avgPeakStreak|streakBreakRate/.test(dash));
ok('sin «streak» ni «racha» en textos', !/streak|racha/i.test(dash));

console.log(`\nCHP-GAMIFICACION-G4-UX-U0 (legados) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
