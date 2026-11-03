/**
 * MiProgreso.test.mjs — CHP-GAMIFICACION-G4-UX-U3.
 *
 * Pantalla privada «Mi progreso» (`/mi-progreso`), con datos sintéticos con la
 * forma exacta del contrato U2:
 *  [V] presentación pura (utils/myProgressView.mjs): 0/30/50 XP, ocho estados,
 *      logros, sin actividades elegibles, respuestas inválidas y clasificación HTTP
 *  [R] render real de MiProgresoView y de los avisos (esbuild + react-dom/server):
 *      semántica, barras accesibles, textos y ausencia de 0 XP en errores
 *  [S] estructura: ruta sin :id, enlaces solo en perfil propio y tras aprobación,
 *      nada en storage, sin cálculo en el navegador
 *
 *   node pages/__tests__/MiProgreso.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { buildProgressView, classifyProgressResponse, WORK_STATE_TEXT, LEVEL_NAMES } from '../../utils/myProgressView.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Respuestas sintéticas con la forma de U2 ────────────────────────────────
const base = { enabled: true, stats: { works: 0, reflections: 0, deepWorks: 0 }, availability: { works: 2, activities: 3 } };
const ZERO = { ...base, xp: 0, level: { id: 'semilla', index: 0, next: { id: 'brote', xpTarget: 30, missing: { xp: 30, works: 1, reflections: 0 } } },
    achievements: { earned: [], next: { id: 'primera-obra', metric: 'works', missing: 1 } }, works: [] };
const XP30 = { ...base, xp: 30, level: { id: 'brote', index: 1, next: null },
    achievements: { earned: ['primera-obra'], next: { id: 'mirada-profunda', metric: 'deepWorks', missing: 1 } },
    works: [{ contentId: 'obra-a', title: 'El principito', experienceId: 'exp-1', state: 'recognized', xp: 30, ceiling: 50, reflections: 1 }] };
const XP50 = { ...base, xp: 50, level: { id: 'brote', index: 1, next: null }, availability: { works: 1, activities: 1 },
    achievements: { earned: ['primera-obra', 'mirada-profunda'], next: null },
    works: [{ contentId: 'obra-a', title: 'El principito', experienceId: 'exp-1', state: 'complete', xp: 50, ceiling: 50, reflections: 2 }] };
const STATES = Object.keys(WORK_STATE_TEXT);
const ALL_STATES = { ...ZERO, works: STATES.map((s, i) => ({ contentId: `obra-${i}`, title: `Obra ${s}`, experienceId: `exp-${i}`, state: s,
    xp: s === 'recognized' ? 30 : s === 'complete' ? 50 : 0, ceiling: 50, reflections: s === 'complete' ? 2 : s === 'recognized' ? 1 : 0 })) };
const NO_ELIGIBLE = { ...ZERO, availability: { works: 0, activities: 0 }, achievements: { earned: [], next: null } };

console.log('\n[V] presentación pura');
{
    const z = buildProgressView(ZERO);
    ok('0 XP: Semilla, 0 XP, barra 0 de 30 hacia Brote', z.level.name === 'Semilla' && z.xp === 0 && z.level.bar?.text === '0 de 30 XP para Brote' && z.level.bar.max === 30);
    ok('0 XP: requisitos en texto (30 XP y 1 obra)', z.level.requirements.map((r) => r.text).join('|') === 'Te faltan 30 XP|Escribir sobre 1 obra');
    ok('0 XP: estado inicial positivo y siguiente logro «Primera obra»', z.zero === true && z.nextAchievement?.title === 'Primera obra');
    const t = buildProgressView(XP30);
    ok('30 XP: Brote, sin barra de nivel y «¡Llegaste a Brote!»', t.level.name === 'Brote' && t.level.bar === null && t.level.reached === '¡Llegaste a Brote!');
    ok('30 XP: obra «30 de 50 XP» con 1.ª reflexión ✓ y 2.ª pendiente', t.works[0].xp?.text === '30 de 50 XP' && t.works[0].marks.map((m) => m.done).join() === 'true,false');
    ok('30 XP: logro obtenido + un solo siguiente', t.earned.map((a) => a.title).join() === 'Primera obra' && t.nextAchievement?.title === 'Mirada profunda');
    const f = buildProgressView(XP50);
    ok('50 XP: obra completa 50 de 50 con dos marcas', f.works[0].stateText === '¡Obra completa!' && f.works[0].xp.text === '50 de 50 XP' && f.works[0].marks.every((m) => m.done));
    ok('50 XP: dos logros y sin siguiente', f.earned.length === 2 && f.nextAchievement === null);
    const all = buildProgressView(ALL_STATES);
    ok('los ocho estados del contrato U2 tienen texto y se muestran', STATES.length === 8 && all.works.length === 8 && all.works.every((w) => w.stateText === WORK_STATE_TEXT[w.state]));
    ok('`reviewed` y `approved_no_xp` sin barra de XP cuando no hay XP', ['reviewed', 'approved_no_xp'].every((s) => all.works.find((w) => w.state === s).xp === null));
    ok('`reviewed` nunca dice «Aprobada»', !/aprobad/i.test(WORK_STATE_TEXT.reviewed));
    ok('`approved_no_xp` no promete XP', /no suma XP/.test(WORK_STATE_TEXT.approved_no_xp));
    ok('estado desconocido: se omite', buildProgressView({ ...ZERO, works: [{ contentId: 'x', title: 'X', state: 'hacked', xp: 99, ceiling: 50 }] }).works.length === 0);
    const n = buildProgressView(NO_ELIGIBLE);
    ok('sin actividades elegibles: sin barra, sin requisitos ni siguiente logro', n.canEarn === false && n.level.bar === null && n.level.requirements.length === 0 && n.nextAchievement === null);
    ok('solo tramos activos: un nivel provisional no se muestra', buildProgressView({ ...ZERO, level: { id: 'raiz', index: 2, next: null } }) === null
        && Object.keys(LEVEL_NAMES).join() === 'semilla,brote');
    ok('un siguiente nivel provisional no se muestra', buildProgressView({ ...XP30, level: { id: 'brote', index: 1, next: { id: 'raiz', xpTarget: 120, missing: { xp: 90 } } } }).level.bar === null);
    ok('respuesta inválida ⇒ null (la pantalla dice «no pudimos cargar», no 0 XP)',
        [null, {}, { enabled: true }, { enabled: true, xp: -1, level: { id: 'semilla' } }, { enabled: false, xp: 0, level: { id: 'semilla' } }].every((d) => buildProgressView(d) === null));
    ok('logro desconocido: no se muestra el id crudo', buildProgressView({ ...XP30, achievements: { earned: ['x-raro'], next: { id: 'x-raro', metric: 'works', missing: 1 } } }).earned.length === 0);
    const k = (s, b) => classifyProgressResponse(s, b).kind;
    ok('clasificación HTTP: 200/enabled, 200/disabled, 404, 401, 403, 503, red caída',
        k(200, ZERO) === 'ok' && k(200, { enabled: false }) === 'disabled' && k(404, { error: 'Not Found' }) === 'off'
        && k(401, null) === 'unauthenticated' && k(403, null) === 'forbidden' && k(503, { code: 'PROGRESS_UNAVAILABLE' }) === 'unavailable' && k(0, null) === 'unavailable');
    ok('la vista no inventa XP: usa el del servidor tal cual', buildProgressView({ ...XP30, xp: 37 }).xp === 37);
}

// ── Render real ─────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-miprogreso-'));
const mockDs = path.join(tmp, 'dataService.mock.mjs');
fs.writeFileSync(mockDs, 'export const dataService = { getMyProgress: () => new Promise(() => {}) };');
const mockAuth = path.join(tmp, 'AuthContext.mock.mjs');
fs.writeFileSync(mockAuth, "export const useAuth = () => ({ user: { id: 'u-sintetico' }, logout: () => {} });");
const entry = path.join(tmp, 'entry.mjs');
const fwd = (p) => JSON.stringify(p.replace(/\\/g, '/'));
fs.writeFileSync(entry, `
export { default as MiProgreso, MiProgresoView, MiProgresoNotice } from ${fwd(path.join(ROOT, 'pages', 'MiProgreso.tsx'))};
export { buildProgressView } from ${fwd(path.join(ROOT, 'utils', 'myProgressView.mjs'))};
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { MemoryRouter } from 'react-router-dom';
`);
const bundle = path.join(tmp, 'bundle.mjs');
await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'node_modules')], jsx: 'automatic', define: { 'import.meta.env': '{"DEV":false}' },
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 'doubles', setup(b) {
        b.onResolve({ filter: /services\/dataService$/ }, () => ({ path: mockDs }));
        b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: mockAuth }));
    } }],
});
const M = await import(pathToFileURL(bundle).href);
const inRouter = (el) => M.renderToStaticMarkup(M.createElement(M.MemoryRouter, null, el));
const view = (d) => inRouter(M.createElement(M.MiProgresoView, { view: M.buildProgressView(d) }));
const count = (html, re) => (html.match(re) ?? []).length;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

try {
    console.log('\n[R] render real');
    const z = view(ZERO);
    ok('cuatro secciones con encabezado h2 enlazado (aria-labelledby)', count(z, /<section aria-labelledby="mp-/g) === 4 && count(z, /<h2 id="mp-/g) === 4);
    ok('barra de nivel: role=progressbar con min/max/now y aria-valuetext', /role="progressbar" aria-label="Avance hacia Brote" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0" aria-valuetext="0 de 30 XP para Brote"/.test(z));
    ok('el valor de la barra también está en texto visible', text(z).includes('0 de 30 XP para Brote'));
    ok('requisitos con marca accesible (listo/pendiente)', /Te faltan 30 XP<span class="sr-only"> \(pendiente\)<\/span>/.test(z));
    ok('0 XP: mensaje positivo y botón «Ver experiencias»', text(z).includes('Tu camino empieza aquí') && /href="\/experiencias"[^>]*>Ver experiencias/.test(z));
    ok('iconos decorativos ocultos al lector de pantalla', count(z, /<svg[^>]*aria-hidden="true"/g) >= 3 && count(z, /<svg(?![^>]*aria-hidden)/g) === 0);
    const t = view(XP30);
    ok('30 XP: «Brote», «30 XP» y «¡Llegaste a Brote!» sin barra de nivel', text(t).includes('Brote') && text(t).includes('30 XP') && t.includes('¡Llegaste a Brote!')
        && !/aria-label="Avance hacia/.test(t));
    ok('obra: título, estado con prefijo para lector de pantalla y barra 30 de 50', t.includes('El principito') && /<span class="sr-only">Estado: <\/span>Reconocida/.test(t)
        && /aria-valuemax="50" aria-valuenow="30" aria-valuetext="30 de 50 XP"/.test(t));
    ok('enlace «Ver mi entrega» a la experiencia, con nombre accesible único', /href="\/experiencias\/exp-1"[^>]*>Ver mi entrega<span class="sr-only"> sobre El principito<\/span>/.test(t));
    ok('logros: solo el obtenido y un «Siguiente posible»', text(t).includes('Primera obra') && count(t, /Siguiente posible/g) === 1 && !text(t).includes('Lector reflexivo'));
    const f = view(XP50);
    ok('50 XP: «¡Obra completa!» 50 de 50, dos logros, sin siguiente', f.includes('¡Obra completa!') && /aria-valuetext="50 de 50 XP"/.test(f) && text(f).includes('Mirada profunda') && !/Siguiente posible/.test(f));
    const a = view(ALL_STATES);
    ok('los ocho estados se pintan con su texto', STATES.every((s) => a.includes(WORK_STATE_TEXT[s].replace(/&/g, '&amp;'))));
    ok('obras como lista semántica', /<ul class="mt-3 space-y-4"><li/.test(a) && count(a, /<h3 /g) === 8);
    const n = view(NO_ELIGIBLE);
    ok('sin actividades elegibles: invitación a leer, sin barra ni promesa de XP', text(n).includes('Todavía no hay experiencias que sumen XP para ti') && /href="\/biblioteca"/.test(n)
        && !/role="progressbar"/.test(n) && !/Ver experiencias/.test(n) && !/Siguiente posible/.test(n));
    ok('«Qué cuenta» desplegable nativo (teclado) y sin promesas numéricas fijas', /<details class="group"><summary/.test(z) && text(z).includes('Leer, abrir páginas, escuchar audios o hablar con Leo no da XP') && !/50 XP/.test(text(z).split('Qué cuenta')[1]));
    ok('objetivos táctiles ≥ 44 px y foco visible en enlaces y botones', count(z, /min-h-\[44px\]/g) >= 2 && count(z, /focus-visible:ring-4/g) >= 2);
    ok('sin rankings, rachas, comparaciones ni puntos de magia', !/ranking|racha|puesto|compañeros|Puntos de Magia|\bPM\b|mejor que/i.test(text(a) + text(z)));
    ok('sin animaciones', !/animate-|transition/.test(a + z + t));

    const err = inRouter(M.createElement(M.MiProgresoNotice, { kind: 'unavailable' }));
    ok('503: aviso con «Reintentar» y role=alert, sin 0 XP', /role="alert"/.test(err) && /Reintentar/.test(err) && !/\bXP\b/.test(text(err)));
    const un = inRouter(M.createElement(M.MiProgresoNotice, { kind: 'unauthenticated' }));
    ok('401: pide volver a ingresar, sin datos', /Ingresar de nuevo/.test(un) && !/\bXP\b/.test(text(un)));
    const fb = inRouter(M.createElement(M.MiProgresoNotice, { kind: 'forbidden' }));
    ok('403: sin acceso, sin datos', /No tienes acceso/.test(fb) && !/\bXP\b/.test(text(fb)));
    const loading = inRouter(M.createElement(M.MiProgreso));
    ok('carga: h1 «Mi progreso», región aria-live y ningún valor', /<h1[^>]*>Mi progreso<\/h1>/.test(loading) && /aria-live="polite" aria-busy="true"/.test(loading) && !/\bXP\b/.test(text(loading)));

    console.log('\n[S] estructura y privacidad');
    const app = read('App.tsx');
    ok('ruta /mi-progreso protegida y SIN :id', /path="\/mi-progreso" element=\{\s*<ProtectedRoute access=\{getRouteAccess\('\/mi-progreso'\)\}>/.test(app) && !/mi-progreso\/:/.test(app));
    ok('routePermissions: /mi-progreso autenticada', /path: '\/mi-progreso',\s*access: 'authenticated'/.test(read('config/routePermissions.ts')));
    const perfil = code(read('pages/Perfil.tsx'));
    ok('Perfil: el hook solo consulta en el perfil propio', /useMyProgressAvailable\(currentUser\?\.id, !!currentUser && currentUser\.id === id\)/.test(perfil));
    ok('Perfil: el enlace exige isOwnProfile Y servidor habilitado', /\{isOwnProfile && showMyProgress && \(/.test(perfil) && count(perfil, /to="\/mi-progreso"/g) === 1);
    ok('Perfil: sin «Nivel» ni «Puntos de Magia» (U0 intacto)', !/Puntos de Magia/.test(perfil));
    const exp = code(read('pages/Experiencias.tsx'));
    ok('Experiencias: enlace solo tras entrega aprobada y con servidor habilitado',
        /useMyProgressAvailable\(user\?\.id, approvedProduction\)/.test(exp) && /e\.review\?\.decision === 'aprobado'/.test(exp) && /\{showMyProgress && <Link to="\/mi-progreso"/.test(exp));
    const page = code(read('pages/MiProgreso.tsx')), util = code(read('utils/myProgressView.mjs')), hook = code(read('hooks/useMyProgressAvailable.ts'));
    ok('nada en localStorage / sessionStorage / caches / IndexedDB', ![page, util, hook].some((s) => /localStorage|sessionStorage|caches\.|indexedDB|persistenceService/.test(s)));
    const ds = read('services/dataService.ts');
    const fn = ds.match(/async getMyProgress\(\)[\s\S]*?\r?\n {4}\}\r?\n/)?.[0] ?? '';
    ok('cliente: GET /me/progress con cookie, cache no-store y sin userId', /\/me\/progress`, \{ credentials: 'include', cache: 'no-store' \}/.test(fn) && !/userId|x-user-id|persistence/.test(fn));
    ok('sin cálculo de XP/nivel/logros en el navegador', !/deriveLevel|evaluateAchievements|PILOT_LEVELS|xpCeiling|\* ?20|\+ ?30|gamification\//.test(page + util + hook));
    ok('la pantalla no conoce otros usuarios: sin useParams ni ids en la ruta', !/useParams/.test(page));
    ok('al cambiar de usuario se descarta el estado y se vuelve a pedir', /useEffect\(\(\) => \{\s*setLoad\(\{ kind: 'loading' \}\);\s*if \(userId\) void fetchProgress\(\);\s*\}, \[userId, fetchProgress\]\)/.test(page));
    ok('404 / enabled:false: la pantalla no se muestra', /load\.kind === 'off' \|\| load\.kind === 'disabled'\) return <Navigate to="\/" replace \/>/.test(page));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nMiProgreso (G4-UX-U3): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
