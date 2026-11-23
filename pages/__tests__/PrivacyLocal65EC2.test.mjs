/**
 * PrivacyLocal65EC2.test.mjs — CHP V9 65E-C2 (Bloque I). Cierre de sesión pendiente: nada se carga con la sesión que salió.
 *
 * Tras cerrar sesión SIN conexión, la cookie de esa cuenta sigue viva hasta que el servidor reciba la revocación. Al
 * reabrir la aplicación con conexión, el arranque descargaba con ella el catálogo, el padrón y los grupos de la cuenta
 * saliente y volvía a guardar el catálogo en el dispositivo. Con el `dataService` REAL y la red simulada:
 *   [P] con cierre pendiente, el arranque no pide ni guarda datos de la cuenta; sin cierre pendiente, arranca como siempre
 *   [A] el contexto de autenticación retira también lo editorial al resolver el cierre pendiente (estructura)
 *
 *   node pages/__tests__/PrivacyLocal65EC2.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 700)), fail++);
const section = (t) => console.log(`\n${t}`);
const code = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65ec2_'));
const store = () => { const m = new Map(); return { _m: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ACCOUNT_DATA = /\/api\/(content|users|groups|schools|bundles)\b/;

try {
    const out = path.join(tmp, 'ds.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'services/dataService.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
        external: ['react', 'react-dom'], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    globalThis.window = globalThis; Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {} });
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };
    const realSetInterval = globalThis.setInterval; globalThis.setInterval = () => 0;
    const calls = [];
    // El servidor responde como a una sesión viva: catálogo con una obra personal de la cuenta.
    globalThis.fetch = async (url) => {
        const u = String(url); calls.push(u);
        const body = /\/content\b/.test(u) ? [{ id: 'obra-personal', titulo: 'Compra de la cuenta saliente' }] : /\/server-time\b/.test(u) ? { serverTime: Date.now() } : [];
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    };
    /** Arranca un `dataService` nuevo (como al abrir la aplicación) sobre ese almacenamiento. */
    const boot = async (LS, n) => {
        globalThis.localStorage = LS; globalThis.sessionStorage = store(); calls.length = 0;
        const { dataService } = await import(`${pathToFileURL(out).href}?boot=${n}`);
        await dataService.waitForInitialization(); await tick(5);
        return dataService;
    };

    section('[P] arranque con un cierre de sesión pendiente');
    {
        const LS = store(); LS.setItem('chibalete_logout_pending', '1');
        const ds = await boot(LS, 1);
        ok('no se pide catálogo, padrón, grupos, colegios ni paquetes con la sesión de la cuenta que salió', !calls.some((u) => ACCOUNT_DATA.test(u)), calls.join(' '));
        ok('…y nada de esa cuenta queda guardado en el dispositivo', LS.getItem('chibalete_content') === null && !JSON.stringify([...LS._m]).includes('obra-personal'), JSON.stringify([...LS._m.keys()]));
        ok('…ni en la memoria de la aplicación', ds.getContentById?.('obra-personal') === undefined || ds.getContentById('obra-personal') == null);
        ok('la marca sigue puesta hasta que el servidor confirme la revocación', LS.getItem('chibalete_logout_pending') === '1' && ds.hasLogoutPending() === true);
        const settled = await ds.settlePendingLogout();
        ok('resolver el cierre pendiente pide la revocación y retira la marca', settled === true && calls.some((u) => /\/auth\/logout$/.test(u)) && LS.getItem('chibalete_logout_pending') === null, calls.join(' '));
    }
    {
        const LS = store();
        await boot(LS, 2);
        ok('sin cierre pendiente el arranque no cambia: carga el catálogo y el padrón', calls.some((u) => /\/api\/content\b/.test(u)) && calls.some((u) => /\/api\/users\b/.test(u)), calls.join(' '));
    }
    globalThis.setInterval = realSetInterval;

    section('[A] contexto de autenticación (estructura)');
    {
        const auth = code('context/AuthContext.tsx');
        const branch = auth.slice(auth.indexOf('dataService.hasLogoutPending()'), auth.indexOf('fetchSessionMe'));
        ok('al resolver el cierre pendiente se retiran las copias de la sesión Y lo editorial (catálogo, IA, Leo)', /settlePendingLogout\(\)/.test(branch) && /clearSessionState\(\)/.test(branch) && /clearEditorialClientStorage\(\)/.test(branch), branch.slice(0, 400));
        ok('…y con el cierre pendiente sin resolver no se restaura la sesión por la cookie', /!storedUserId && !logoutPending/.test(auth));
        const ds = code('services/dataService.ts');
        ok('el arranque consulta la marca antes de cargar datos de la cuenta', /Promise\.all\(this\.hasLogoutPending\(\) \? \[this\.syncServerTime\(\)\]/.test(ds));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nPrivacyLocal65EC2 — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
