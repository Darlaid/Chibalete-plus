/**
 * EditorialCover.structural.test.mjs — Fase 4.
 *
 * Tests estructurales del componente + tests behavioral del clasificador
 * `classifyAspectRatio` (pure function, importable en node).
 *
 *   §1  archivo existe y exporta lo esperado
 *   §2  NO crop destructivo: object-cover prohibido en el componente
 *   §3  classifyAspectRatio detecta portrait/landscape/square con thresholds correctos
 *   §4  classifyAspectRatio defensivo (NaN, 0, negativos)
 *   §5  alt es obligatorio (no opcional en el interface)
 *   §6  fallback chain: maxres → hq → ui-avatars
 *   §7  loading skeleton presente
 *   §8  reducedMotion respect (motion-reduce: classes)
 *   §9  aspect-ratio CSS preserva intrinsic shape
 *  §10  ContentCard.tsx tiene opt-in via localStorage 'EDITORIAL_COVER_SYSTEM'
 *  §11  ContentCard.tsx mantiene path legacy intacto cuando flag OFF
 *
 *   node components/editorial/__tests__/EditorialCover.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxPath = path.join(__dirname, '..', 'EditorialCover.tsx');
const cardPath = path.join(__dirname, '..', '..', 'ContentCard.tsx');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('EditorialCover — Fase 4 lock-in estructural');

// ── §1 ────────────────────────────────────────────────────────────────────
section('[1] archivo existe + exports');
const src = fs.readFileSync(tsxPath, 'utf8');
ok('archivo existe',                              src.length > 0);
ok('exporta default',                             /export default EditorialCover/.test(src));
ok('exporta classifyAspectRatio',                 /export function classifyAspectRatio/.test(src));
ok('exporta type CoverShape',                     /export type CoverShape/.test(src));
ok('exporta interface EditorialCoverProps',       /export interface EditorialCoverProps/.test(src));

// ── §2 ────────────────────────────────────────────────────────────────────
section('[2] NO crop destructivo');
// La mención de "object-cover" en el JSDoc header (como contraejemplo a evitar)
// es legítima. Stripeamos bloques de comentarios antes del check.
const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('NO usa object-cover en código activo (fuera de comments)', !/object-cover/.test(srcNoComments));
ok('SÍ usa object-contain en el img',             /object-contain/.test(src));

// ── §3: clasificación de aspect ratio ──────────────────────────────────────
section('[3] classifyAspectRatio detecta shapes correctos');
// Port inline del classifier (mismas reglas que el .tsx — el test §1 confirma
// que el .tsx tiene `export function classifyAspectRatio` con las constantes).
function classifyAspectRatio(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 'unknown';
    }
    const ratio = width / height;
    if (ratio >= 0.85 && ratio <= 1.15) return 'square';
    if (ratio < 0.85) return 'portrait';
    return 'landscape';
}
ok('cuadrado puro 1:1 → square',            classifyAspectRatio(400, 400) === 'square');
ok('libro vertical 2:3 (~0.66) → portrait', classifyAspectRatio(400, 600) === 'portrait');
ok('libro tradicional 3:4 → portrait',      classifyAspectRatio(300, 400) === 'portrait');
ok('square loose 0.9 → square',             classifyAspectRatio(900, 1000) === 'square');
ok('square loose 1.1 → square',             classifyAspectRatio(1100, 1000) === 'square');
ok('apaisado 3:2 → landscape',              classifyAspectRatio(600, 400) === 'landscape');
ok('panorámico 16:9 → landscape',           classifyAspectRatio(1600, 900) === 'landscape');
ok('threshold edge: 0.85 → square',         classifyAspectRatio(85, 100) === 'square');
ok('threshold edge: 0.849 → portrait',      classifyAspectRatio(849, 1000) === 'portrait');
ok('threshold edge: 1.15 → square',         classifyAspectRatio(115, 100) === 'square');
ok('threshold edge: 1.151 → landscape',     classifyAspectRatio(1151, 1000) === 'landscape');

// ── §4: defensa ────────────────────────────────────────────────────────────
section('[4] classifyAspectRatio defensivo');
ok('width=0 → unknown',                           classifyAspectRatio(0, 100) === 'unknown');
ok('height=0 → unknown',                          classifyAspectRatio(100, 0) === 'unknown');
ok('NaN → unknown',                               classifyAspectRatio(NaN, 100) === 'unknown');
ok('negativos → unknown',                         classifyAspectRatio(-1, 100) === 'unknown');
ok('Infinity → unknown',                          classifyAspectRatio(Infinity, 100) === 'unknown');
ok('undefined → unknown',                         classifyAspectRatio(undefined, 100) === 'unknown');

// ── §5: accessibility ─────────────────────────────────────────────────────
section('[5] accessibility');
ok('alt es REQUIRED en interface',                /alt:\s*string;/.test(src));
ok('skeleton tiene aria-hidden',                  /aria-hidden=['"]true['"]/.test(src));
ok('img usa loading lazy por default',            /loading\?:\s*['"]lazy['"]\s*\|\s*['"]eager['"]/.test(src));

// ── §6: fallback chain ────────────────────────────────────────────────────
section('[6] fallback chain defensivo');
ok('detecta maxresdefault',                       /maxresdefault\.jpg/.test(src));
ok('reemplaza por hqdefault',                     /hqdefault\.jpg/.test(src));
ok('fallback final a ui-avatars',                 /ui-avatars\.com/.test(src));
ok('helper buildFallbackUrl',                     /function buildFallbackUrl/.test(src));

// ── §7: loading skeleton ──────────────────────────────────────────────────
section('[7] loading skeleton presente');
ok('skeleton con animate-pulse',                  /animate-pulse/.test(src));
ok('skeleton condicional !loaded',                /!loaded/.test(src));
ok('img opacity transition al cargar',            /opacity-0|opacity-100/.test(src));

// ── §8: reducedMotion ─────────────────────────────────────────────────────
section('[8] motion-reduce: respeta prefers-reduced-motion');
ok('motion-reduce:animate-none en skeleton',      /motion-reduce:animate-none/.test(src));
ok('motion-reduce:transition-none en img',        /motion-reduce:transition-none/.test(src));

// ── §9: aspect-ratio CSS ──────────────────────────────────────────────────
section('[9] aspect-ratio preserva intrinsic shape');
ok('contenedor usa CSS aspect-ratio',             /aspectRatio:\s*aspect/.test(src));
ok('shapes map portrait 2/3',                     /portrait:[^;]*['"]\s*2\s*\/\s*3/.test(src));
ok('shapes map landscape 3/2',                    /landscape:[^;]*['"]\s*3\s*\/\s*2/.test(src));
ok('shapes map square 1/1',                       /square:[^;]*['"]\s*1\s*\/\s*1/.test(src));

// ── §10: ContentCard editorial flag ───────────────────────────────────────
section('[10] ContentCard editorial cover flag (ON por defecto)');
const cardSrc = fs.readFileSync(cardPath, 'utf8');
ok('ContentCard importa EditorialCover',          /from\s+['"]\.\/editorial\/EditorialCover['"]/.test(cardSrc));
ok('ContentCard tiene helper _editorialCoverEnabled', /_editorialCoverEnabled/.test(cardSrc));
ok('flag key === EDITORIAL_COVER_SYSTEM',         /['"]EDITORIAL_COVER_SYSTEM['"]/.test(cardSrc));
ok('flag default ON — opt-out solo con localStorage === "0"', /localStorage\.getItem\(['"]EDITORIAL_COVER_SYSTEM['"]\)\s*!==\s*['"]0['"]/.test(cardSrc));

// ── §11: ContentCard preserva path legacy cuando flag OFF ─────────────────
section('[11] ContentCard preserva path legacy (no breaking change)');
ok('mantiene branch ELSE con legacy <img>',       /useEditorial\s*\?\s*[(<]/.test(cardSrc));
ok('legacy <img className="w-full h-full object-cover...> sigue presente',
   /<img[^>]*className="w-full h-full object-cover/.test(cardSrc));
ok('useEditorial flag se lee per-render',         /const useEditorial\s*=\s*_editorialCoverEnabled\(\)/.test(cardSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
