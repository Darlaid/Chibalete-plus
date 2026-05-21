/**
 * useReducedMotion.structural.test.mjs — Fase 4 accessibility.
 *
 *   §1  archivo existe + exports default + named
 *   §2  query correcta: '(prefers-reduced-motion: reduce)'
 *   §3  SSR-safe: chequea typeof window === 'undefined' antes de matchMedia
 *   §4  defensivo: matchMedia throw → fallback false
 *   §5  initial state lee matchMedia.matches al primer render
 *   §6  useEffect suscribe a change con addEventListener (moderno)
 *   §7  fallback legacy a addListener si addEventListener no existe (Safari <14)
 *   §8  cleanup: useEffect retorna unsubscribe
 *   §9  VisorAlbum.tsx integra useReducedMotion en narrativeTransition + confetti
 *  §10  ContentCard NO importa el hook directamente (Tailwind motion-reduce: ya lo cubre)
 *
 *   node hooks/__tests__/useReducedMotion.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(__dirname, '..', 'useReducedMotion.ts');
const albumPath = path.join(__dirname, '..', '..', 'pages', 'VisorAlbum.tsx');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('useReducedMotion — Fase 4 lock-in estructural');

const src = fs.readFileSync(hookPath, 'utf8');
const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── §1 ────────────────────────────────────────────────────────────────────
section('[1] exports correctos');
ok('archivo existe',                                src.length > 0);
ok('exporta function useReducedMotion',             /export function useReducedMotion/.test(src));
ok('exporta default useReducedMotion',              /export default useReducedMotion/.test(src));
ok('return type boolean',                           /\):\s*boolean/.test(src));

// ── §2: query exact ────────────────────────────────────────────────────────
section('[2] query exact');
ok("query === '(prefers-reduced-motion: reduce)'",
   /matchMedia\(['"]\(prefers-reduced-motion:\s*reduce\)['"]\)/.test(src));

// ── §3: SSR-safe ──────────────────────────────────────────────────────────
section('[3] SSR-safe');
ok('chequea typeof window === undefined',
   /typeof\s+window\s*===\s*['"]undefined['"]/.test(srcNoComments));
ok('chequea typeof window.matchMedia (=== o !==)',
   /typeof\s+window\.matchMedia\s*[!=]==\s*['"]function['"]/.test(srcNoComments));
ok('initial state lazy con useState(() =>',
   /useState[^;]*\(\s*\(\s*\)\s*=>/.test(srcNoComments));

// ── §4: defensivo try/catch ───────────────────────────────────────────────
section('[4] defensivo — matchMedia throw → fallback false');
ok('try/catch en initial state',                    /try\s*\{[\s\S]*matchMedia[\s\S]*?\}\s*catch/.test(srcNoComments));
ok('try/catch en useEffect subscription',           (srcNoComments.match(/try\s*\{/g) || []).length >= 2);
ok('default seguro: return false',                  /return\s+false/.test(srcNoComments));

// ── §5: initial state ─────────────────────────────────────────────────────
section('[5] initial state lee matchMedia.matches');
ok('initial usa .matches',                          /\.matches/.test(srcNoComments));

// ── §6: useEffect addEventListener ────────────────────────────────────────
section('[6] addEventListener moderno');
ok('useEffect presente',                            /useEffect\(/.test(srcNoComments));
ok('addEventListener("change")',                    /addEventListener\(['"]change['"]/.test(srcNoComments));

// ── §7: fallback legacy ───────────────────────────────────────────────────
section('[7] fallback legacy addListener (Safari <14)');
ok('chequea typeof addListener',                    /typeof\s+\w+\.addListener\s*===\s*['"]function['"]/.test(srcNoComments));
ok('addListener fallback',                          /\w+\.addListener\(/.test(srcNoComments));

// ── §8: cleanup ───────────────────────────────────────────────────────────
section('[8] useEffect cleanup');
ok('return de cleanup',                             /return\s*\(\s*\)\s*=>\s*\{/.test(srcNoComments));
ok('removeEventListener en cleanup',                /removeEventListener\(['"]change['"]/.test(srcNoComments));
ok('removeListener legacy cleanup',                 /removeListener\??\.\(|removeListener\?\.\(|removeListener\(/.test(srcNoComments));

// ── §9: VisorAlbum integra el hook ────────────────────────────────────────
section('[9] VisorAlbum integra useReducedMotion');
const albumSrc = fs.readFileSync(albumPath, 'utf8');
ok('VisorAlbum importa useReducedMotion',           /import\s*\{\s*useReducedMotion\s*\}\s*from\s*['"]\.\.\/hooks\/useReducedMotion['"]/.test(albumSrc));
ok('VisorAlbum llama useReducedMotion()',           /const\s+reducedMotion\s*=\s*useReducedMotion\(\)/.test(albumSrc));
ok('narrativeTransition respeta reducedMotion',     /reducedMotion[\s\S]{0,200}?['"]none['"]/.test(albumSrc));
ok('confetti hit-challenge gated por !reducedMotion',
   /if\s*\(\s*!reducedMotion\s*\)\s*\{[\s\S]*?confetti\(\{\s*particleCount:\s*100/.test(albumSrc));
ok('confetti complete-celebration gated por !reducedMotion',
   /if\s*\(\s*!reducedMotion\s*\)\s*\{[\s\S]*?confetti\(\{\s*particleCount:\s*140/.test(albumSrc));

// ── §10: ContentCard usa Tailwind motion-reduce: (no necesita el hook) ────
section('[10] ContentCard usa Tailwind motion-reduce: classes');
const cardSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'ContentCard.tsx'), 'utf8');
ok('ContentCard NO importa useReducedMotion directamente',
   !/from\s+['"][^'"]*useReducedMotion['"]/.test(cardSrc));
ok('ContentCard usa motion-reduce:transition-none',
   /motion-reduce:transition-none/.test(cardSrc));
ok('ContentCard usa motion-reduce:group-hover:scale-100',
   /motion-reduce:group-hover:scale-100/.test(cardSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
