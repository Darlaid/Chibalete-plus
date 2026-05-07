/**
 * jsonCacheCoherence.test.js — guardrail de coherencia multi-instancia.
 *
 * Cómo correr (sin framework, solo Node):
 *   node server/__test__/jsonCacheCoherence.test.js
 *
 * Por qué existe:
 *   En despliegue multi-instancia (api_1 + api_2 detrás de nginx) cada proceso
 *   tiene su propio _jsonCache. La invalidación de writeJSON solo afecta al
 *   proceso que escribió, así que los archivos en los que el read-after-write
 *   debe ser consistente entre instancias NO pueden cachearse.
 *
 *   USERS_DB es uno de esos archivos: el admin invita o crea un usuario y el
 *   gestor de usuarios debe verlo de inmediato sin importar a qué API caiga
 *   la lectura. Este test impide que un commit futuro re-introduzca caché
 *   sobre USERS_DB sin romper el test (= sin pensarlo).
 *
 * Qué valida:
 *   1. Que `UNCACHED_JSON_FILES` exista como constante exportable o,
 *      indirectamente vía grep, esté definido en server.js.
 *   2. Que USERS_DB esté listado en UNCACHED_JSON_FILES.
 *   3. Que NO exista una entrada `[USERS_DB]: <ttl>` activa en _JSON_TTL.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SERVER_JS  = path.resolve(__dirname, '..', 'server.js');

let pass = 0;
let fail = 0;

function assert(label, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

console.log('jsonCacheCoherence — leyendo', SERVER_JS);
const src = fs.readFileSync(SERVER_JS, 'utf8');

// 1. UNCACHED_JSON_FILES está definido
assert(
    'UNCACHED_JSON_FILES está declarado en server.js',
    /\bconst\s+UNCACHED_JSON_FILES\s*=\s*new\s+Set\s*\(/.test(src),
    'no se encontró `const UNCACHED_JSON_FILES = new Set(...)`'
);

// 2. USERS_DB está dentro de la inicialización del Set
//    Captura el contenido del Set y verifica que mencione USERS_DB.
const setMatch = src.match(/const\s+UNCACHED_JSON_FILES\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
assert(
    'UNCACHED_JSON_FILES inicializa con un array literal',
    !!setMatch,
    'no se pudo extraer el contenido del Set'
);
if (setMatch) {
    assert(
        'USERS_DB está incluido en UNCACHED_JSON_FILES',
        /\bUSERS_DB\b/.test(setMatch[1]),
        `contenido del Set: ${setMatch[1].trim() || '(vacío)'}`
    );
}

// 3. _JSON_TTL no debe contener una entrada activa para USERS_DB.
//    Aceptamos comentarios ("// USERS_DB ..."), pero no una asignación viva.
const ttlMatch = src.match(/const\s+_JSON_TTL\s*=\s*\{([\s\S]*?)\n\};/);
assert(
    '_JSON_TTL está declarado',
    !!ttlMatch,
    'no se pudo localizar `const _JSON_TTL = { ... };`'
);
if (ttlMatch) {
    const body = ttlMatch[1];
    // Línea no comentada que asigne TTL a USERS_DB:
    //   [USERS_DB]: 60_000,
    const liveAssignment = body
        .split('\n')
        .map(l => l.replace(/^\s+/, ''))
        .filter(l => !l.startsWith('//') && !l.startsWith('*'))
        .some(l => /\[\s*USERS_DB\s*\]\s*:/.test(l));
    assert(
        'No hay asignación TTL activa para USERS_DB en _JSON_TTL',
        !liveAssignment,
        'se detectó `[USERS_DB]: <ttl>` no comentado — re-introduciría incoherencia entre api_1/api_2'
    );
}

console.log('');
console.log(`jsonCacheCoherence — pass=${pass} fail=${fail}`);
if (fail > 0) {
    process.exitCode = 1;
}
