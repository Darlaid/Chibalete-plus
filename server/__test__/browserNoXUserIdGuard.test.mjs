/**
 * browserNoXUserIdGuard.test.mjs — CHP-IDDB-M1-A-...-REHEARSAL-01-R1.
 * Guard estático: el código de PRODUCTO del navegador no debe EMITIR x-user-id
 * como header de autenticación. Distingue producto de tests/tooling interno.
 * Falla si PRODUCT_BROWSER_X_USER_ID_EMITTERS > 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// Directorios de PRODUCTO del navegador.
const PRODUCT_DIRS = ['services', 'context', 'pages', 'components', 'hooks'];
// Extensiones de producto.
const EXT = /\.(ts|tsx|js|jsx)$/;
// Excluir tests / mocks / tooling.
const SKIP = /(__tests__|__mocks__|\.test\.|\.spec\.|\.stories\.)/;

function walk(dir, acc = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.test(p)) walk(p, acc); }
        else if (EXT.test(e.name) && !SKIP.test(p)) acc.push(p);
    }
    return acc;
}

// Un EMISOR es la construcción del header 'x-user-id' (no una mención en comentario/doc).
// Patrones: `'x-user-id':`, `"x-user-id":`, `setRequestHeader('x-user-id'`, `['x-user-id'] =`.
const EMITTER = /(['"]x-user-id['"]\s*:)|(setRequestHeader\(\s*['"]x-user-id['"])|(\[\s*['"]x-user-id['"]\s*\]\s*=)/;
// Líneas de comentario puro (no cuentan): // ... o * ... (jsdoc) o /** ... */.
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const offenders = [];
let scanned = 0;
for (const d of PRODUCT_DIRS) {
    for (const f of walk(path.join(REPO, d))) {
        scanned++;
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        lines.forEach((line, i) => {
            if (isComment(line)) return;
            if (EMITTER.test(line)) offenders.push(`${path.relative(REPO, f)}:${i + 1}`);
        });
    }
}

ok('se escanearon archivos de producto', scanned > 20, `n=${scanned}`);
ok('PRODUCT_BROWSER_X_USER_ID_EMITTERS = 0', offenders.length === 0, offenders.join(', '));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗  (product files scanned: ${scanned})`);
process.exit(fail ? 1 : 0);
