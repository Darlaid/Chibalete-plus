/**
 * contentStoreRmwSuiteIntegrity.test.mjs — CHP-CI-CONTENT-RMW-01.
 *
 * Guard de INTEGRIDAD del gate, no del producto.
 *
 * `contentStoreRmwConcurrency.test.mjs` solo demuestra algo porque arranca DOS
 * procesos `server.js` REALES contra un store compartido y comprueba el
 * resultado LEYENDO EL DISCO. El defecto que protege (CHP-CONTENT-STORE-RMW-01)
 * vive en la interacción entre el lock de fichero y una caché por proceso: un
 * único proceso comparte caché y no puede reproducirlo, y un doble de prueba
 * que evite la caché real probaría justamente lo que no es.
 *
 * Por tanto, una suite reescrita con dobles o con una sola réplica seguiría
 * pasando en verde mientras deja de proteger nada. Este fichero impide esa
 * sustitución silenciosa: si alguien degrada la suite, el gate se pone rojo.
 *
 * NOTA sobre el control anti-literal: este guard SOLO inspecciona el fichero de
 * la suite, nunca su propio código. Por eso puede nombrar aquí los literales
 * prohibidos (`sinon`, `jest.mock`, …) sin detectarse a sí mismo. Si algún día
 * se fusionaran ambos ficheros, esa propiedad se perdería.
 *
 *   node server/__test__/contentStoreRmwSuiteIntegrity.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const SUITE_REL = 'server/__test__/contentStoreRmwConcurrency.test.mjs';
const SELF_REL = 'server/__test__/contentStoreRmwSuiteIntegrity.test.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const suitePath = path.join(REPO, SUITE_REL);
if (!fs.existsSync(suitePath)) {
    console.error(`  ✗ la suite multiproceso no existe: ${SUITE_REL}`);
    console.log('\ncontentStoreRmwSuiteIntegrity — PASS 0 / FAIL 1');
    process.exit(1);
}
const src = fs.readFileSync(suitePath, 'utf8');
const count = (re) => (src.match(re) || []).length;

// ── [1] El script del gate ejecuta la suite Y este guard ─────────────────
console.log('[1] el script npm del gate');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const script = pkg.scripts?.['test:content-rmw'] || '';
ok('existe el script test:content-rmw', script.length > 0);
ok('el script ejecuta la suite multiproceso', script.includes(SUITE_REL), script);
ok('el script ejecuta este guard de integridad', script.includes(SELF_REL), script);
ok('los comandos se encadenan con && (cualquier fallo aborta)',
    script.includes('&&') && !/\|\|/.test(script) && !/;/.test(script), script);

// ── [2] Dos procesos server.js REALES ────────────────────────────────────
console.log('\n[2] dos réplicas reales, no dobles ni un solo proceso');
ok('la suite arranca server.js como proceso hijo real',
    /spawn\(\s*process\.execPath\s*,\s*\[\s*'server\/server\.js'\s*\]/.test(src));
ok('arranca DOS réplicas (≥2 invocaciones del helper de spawn)',
    count(/=\s*spawnApi\(/g) >= 2, `${count(/=\s*spawnApi\(/g)} invocación(es)`);
ok('las réplicas escuchan en dos puertos distintos de loopback',
    count(/http:\/\/127\.0\.0\.1:\$\{/g) >= 2, `${count(/http:\/\/127\.0\.0\.1:\$\{/g)} base(s)`);
ok('ambas réplicas comparten el mismo store (CONTENT_DB inyectado por env)',
    /CONTENT_DB:/.test(src));
ok('espera a que cada réplica esté healthy antes de escribir',
    /\/api\/health/.test(src));

// ── [3] Sin dobles de prueba ─────────────────────────────────────────────
// Se prohíben marcos de mocking y el parcheo de los internos cuyo
// comportamiento real ES el objeto de la prueba (caché + lock).
console.log('\n[3] ausencia de dobles de prueba y de parcheo de internos');
const DOBLES = [
    /from\s+['"](sinon|proxyquire|mock-fs|nock|testdouble|jest-mock)['"]/,
    /require\(\s*['"](sinon|proxyquire|mock-fs|nock|testdouble|jest-mock)['"]\s*\)/,
    /\bjest\s*\.\s*mock\s*\(/,
    /\bmock\s*\.\s*(method|fn|module)\s*\(/,
    /\bMockAgent\b/,
    /\bsetGlobalDispatcher\s*\(/,
];
const encontrados = DOBLES.filter(re => re.test(src)).map(String);
ok('no importa ni usa ningún marco de dobles de prueba',
    encontrados.length === 0, encontrados.join(' '));
ok('no reasigna la caché ni los lectores/escritores del store',
    !/\b(readJSON|writeJSON|_jsonCache|withFileLock)\s*=[^=]/.test(src));
ok('no sustituye fetch por una implementación propia',
    !/\bglobalThis\.fetch\s*=/.test(src) && !/\bglobal\.fetch\s*=/.test(src));

// ── [4] La verificación se hace contra el DISCO ──────────────────────────
// Si el conteo se leyera de la respuesta HTTP, la réplica podría servir su
// propia caché y el test pasaría con el store ya corrupto.
console.log('\n[4] las aserciones leen el store del disco');
ok('lee y parsea el store desde el filesystem',
    count(/JSON\.parse\(\s*fs\.readFileSync\(/g) >= 2,
    `${count(/JSON\.parse\(\s*fs\.readFileSync\(/g)} lectura(s)`);
ok('el conteo verificado proviene del disco, no de una respuesta HTTP',
    /=\s*\(\)\s*=>\s*JSON\.parse\(\s*fs\.readFileSync\(/.test(src));

// ── [5] Volumen y cobertura mínimos ──────────────────────────────────────
console.log('\n[5] volumen y cobertura mínimos');
ok('conserva la reproducción de 39 escrituras alternando réplica', /i\s*<\s*39\b/.test(src));
ok('conserva la prueba de volumen de 100 ids', /i\s*<\s*100\b/.test(src));
ok('conserva el ratchet estructural sobre server.js',
    /withFileLock\(DB_FILE/.test(src) && /_jsonCache\.delete\(DB_FILE\)/.test(src));
ok('cubre el RMW asíncrono del progreso TTS', /ttsStatus|processingStatus/.test(src));
ok('cubre eliminación concurrente sin resurrección', /method:\s*'DELETE'/.test(src));
ok('mantiene una batería de aserciones no trivial (≥20)',
    count(/\bok\(/g) >= 20, `${count(/\bok\(/g)} aserciones`);

// ── [6] Aislamiento: temporales, cero producción, cero red externa ───────
console.log('\n[6] aislamiento');
ok('el store vive en un directorio temporal del sistema',
    /mkdtempSync\(/.test(src) && /os\.tmpdir\(\)/.test(src));
// Solo sobre CÓDIGO: la cabecera de la suite documenta legítimamente qué
// rutas NUNCA toca («data/, data-critical/, uploads productivos»), y esa
// promesa en prosa no debe leerse como una violación.
const codigo = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')     // comentarios de bloque
    .replace(/^[ \t]*\/\/.*$/gm, ' ');     // comentarios de línea completa
const PRODUCCION = [
    /\/var\/www\//, /\/opt\/chibalete/, /\/etc\/chibalete/, /\/var\/backups\/chibalete/,
    /data-critical/, /chibaleteplus/, /['"]data\/(content|users_db|groups_db)/,
];
const marcas = PRODUCCION.filter(re => re.test(codigo)).map(String);
ok('no nombra ninguna ruta ni dominio productivo en código', marcas.length === 0, marcas.join(' '));
const urls = (codigo.match(/https?:\/\/[^\s'"`)]+/g) || [])
    .filter(u => !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u));
ok('no contacta ningún host externo', urls.length === 0, urls.join(' '));
ok('no habilita proveedores de IA reales (claves vaciadas)',
    /OPENAI_API_KEY:\s*''/.test(src) && /GEMINI_API_KEY:\s*''/.test(src));

// ── [7] Limpieza y fail-closed ───────────────────────────────────────────
console.log('\n[7] limpieza de procesos/temporales y salida fail-closed');
ok('mata los procesos hijos al terminar', /\.kill\(/.test(src));
ok('borra el directorio temporal al terminar', /rmSync\([^)]*recursive/.test(src));
ok('la limpieza corre pase lo que pase (finally)', /\.finally\(/.test(src));
ok('comprueba que no queda ningún lock huérfano', /\.lock/.test(src));
ok('sale con código distinto de 0 si algo falla',
    /process\.exit\([^)]*\?\s*0\s*:\s*1\s*\)/.test(src));

console.log(`\ncontentStoreRmwSuiteIntegrity — PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
