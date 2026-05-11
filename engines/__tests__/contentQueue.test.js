/**
 * contentQueue.test.js — Pruebas unitarias de INVARIANTE 12.
 *
 * "ContentQueue no gobierna reproducción". ContentQueue.getNextContent
 * debe ser función pura: dados los mismos inputs, siempre devuelve el mismo
 * output, sin tocar router, navigate, location, audio, sessionStorage,
 * fetch, ni cualquier side effect.
 *
 * Cómo correr:
 *   node engines/__tests__/contentQueue.test.js
 */

// engines/ContentQueue.ts compila a engines/ContentQueue.js solo si pasamos
// por tsc/Vite. Para el test directo en node usamos un import dinámico al
// archivo .ts que falla: por eso replicamos la firma esperada y forzamos
// que el archivo fuente cumpla con la API pura mediante regex estática.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, '..', 'ContentQueue.ts');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

console.log('\ncontentQueue — INVARIANTE 12');

if (!fs.existsSync(sourcePath)) {
    console.error(`  ✗ ContentQueue.ts no encontrado en ${sourcePath}`);
    process.exit(1);
}
const source = fs.readFileSync(sourcePath, 'utf8');

console.log('\n[INV-12] ContentQueue debe ser función pura — sin side effects');

// Reglas globales sobre TODO el archivo. fetch() y similares loaders se
// excluyen aquí y se validan más abajo, restringidos a preloadContentText.
const FORBIDDEN_PATTERNS = [
    { rx: /\bnavigate\s*\(/,         msg: 'no debe llamar navigate()' },
    { rx: /useNavigate\s*\(/,        msg: 'no debe usar useNavigate()' },
    { rx: /window\.location/,        msg: 'no debe tocar window.location' },
    { rx: /location\.(hash|href|assign|replace)\b/, msg: 'no debe tocar location.*' },
    { rx: /window\.history/,         msg: 'no debe tocar window.history' },
    { rx: /history\.(push|replace)/, msg: 'no debe tocar history.*' },
    { rx: /sessionStorage\./,        msg: 'no debe escribir sessionStorage' },
    { rx: /localStorage\./,          msg: 'no debe escribir localStorage' },
    { rx: /XMLHttpRequest/,          msg: 'no debe usar XMLHttpRequest' },
    { rx: /audio\.\w+\s*=/,          msg: 'no debe escribir propiedades de audio' },
    { rx: /new\s+Audio\s*\(/,        msg: 'no debe instanciar Audio()' },
    { rx: /setTimeout\s*\(/,         msg: 'no debe usar setTimeout (puro)' },
    { rx: /setInterval\s*\(/,        msg: 'no debe usar setInterval (puro)' },
    { rx: /addEventListener/,        msg: 'no debe registrar event listeners' },
    { rx: /import\s+React\b/,        msg: 'no debe importar React (es modulo puro)' },
    { rx: /useState\s*\(/,           msg: 'no debe usar hooks de React' },
    { rx: /useEffect\s*\(/,          msg: 'no debe usar hooks de React' },
];

for (const { rx, msg } of FORBIDDEN_PATTERNS) {
    ok(msg, !rx.test(source), `match en ContentQueue.ts: ${(source.match(rx) ?? [])[0] ?? ''}`);
}

ok('exporta getNextContent',
   /export\s+function\s+getNextContent\b/.test(source));

ok('exporta preloadContentText',
   /export\s+(async\s+)?function\s+preloadContentText\b/.test(source));

// preloadContentText hace fetch, pero ES la ÚNICA función side-effect-y permitida
// (calienta el cache HTTP). Verifico que se llame fetch SOLO dentro de esa función.
console.log('\n[INV-12] fetch sólo en preloadContentText');

const preloadFn = source.match(/export\s+async\s+function\s+preloadContentText[\s\S]*?\n\}/);
ok('preloadContentText existe como función exportada',
   preloadFn !== null);

if (preloadFn) {
    const remainingSource = source.replace(preloadFn[0], '');
    ok('no hay fetch fuera de preloadContentText',
       !/\bfetch\s*\(/.test(remainingSource),
       `match fuera: ${(remainingSource.match(/\bfetch\s*\(/) ?? [])[0] ?? ''}`);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
