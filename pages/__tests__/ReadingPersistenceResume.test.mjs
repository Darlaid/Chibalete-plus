/**
 * ReadingPersistenceResume.test.mjs — V9R BLOCKER-READING-PERSISTENCE-01.
 *
 * Al volver a entrar, el progreso del servidor puede llegar DESPUÉS de que Inicio y Biblioteca calcularon «Estoy
 * leyendo» (al cerrar sesión se borra la copia local, 65E-C1). Con el `dataService` REAL, la red y el almacenamiento
 * simulados:
 *   [E] `syncUserProgress` avisa con `chibalete:progress-synced` ({ userId } y nada más) solo con la sesión que lo pidió
 *   [R] carreras: cambio de cuenta o cierre de sesión durante la sincronización ⇒ ni se guarda ni se avisa
 *   [L] la lista en progreso que se recalcula con el aviso: llega después del acceso ⇒ aparece; antes ⇒ igual que hoy;
 *       aviso de otra cuenta ⇒ no cambia; lector de colegio y administración sin cambios
 *   [P] Inicio y Biblioteca (estructura): escuchan el aviso, filtran por la cuenta, limpian al desmontar
 *   [V] Modo Guiado (estructura + regla): una posición entre 0 y 0,5 % se reanuda; las demás, igual que antes
 *
 *   node pages/__tests__/ReadingPersistenceResume.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_readpersist_'));
const store = () => { const m = new Map(); return { _m: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

try {
    const out = path.join(tmp, 'ds.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'services/dataService.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
        external: ['react', 'react-dom'], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    // `window` con eventos reales (EventTarget): así se observa el aviso tal como lo recibiría la página.
    const bus = new EventTarget();
    globalThis.window = globalThis;
    Object.assign(globalThis, { addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus) });
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };
    const LS = store(), SS = store();
    globalThis.localStorage = LS; globalThis.sessionStorage = SS;
    const realSetInterval = globalThis.setInterval; globalThis.setInterval = () => 0;
    const calls = [];
    let respond = () => ({ status: 503 });
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url); calls.push([init.method || 'GET', u]);
        const r = await respond(u, init);
        if (r === 'network') throw new TypeError('network');
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
    };
    const mod = await import(pathToFileURL(out).href);
    const ds = mod.dataService;
    globalThis.setInterval = realSetInterval;
    await tick(5);

    const EVT = mod.PROGRESS_SYNCED_EVENT;
    const events = [];
    addEventListener(EVT, (e) => events.push(e.detail));
    const remote = (userId, contentId, pct, hint) => ({ id: `${userId}__${contentId}`, userId, contentId, updatedAt: new Date().toISOString(),
        canonicalProgress: { globalPercentage: pct, lastInteractedMode: 'text', anchor: { type: 'text', value: pct }, ...(hint !== undefined ? { viewportHint: hint } : {}) } });
    const progressFor = (list) => (u) => {
        const m = u.match(/\/progress\/user\/([^/?]+)/);
        return m ? { status: 200, body: { success: true, progressList: list.filter((p) => p.userId === m[1]) } } : { status: 200 };
    };
    const login = (id) => { LS.setItem('chibalete_user_id', id); };
    const logout = () => { LS.removeItem('chibalete_user_id'); ds.clearSessionState(); };
    const reset = () => { events.length = 0; calls.length = 0; ds.clearSessionState(); LS.removeItem('chibalete_user_id'); };

    section('[E] el aviso');
    ok('el nombre del evento es el acordado', EVT === 'chibalete:progress-synced');
    reset(); login('A');
    respond = progressFor([remote('A', 'c1', 67, 66.78)]);
    await ds.syncUserProgress('A'); await tick(5);
    ok('al terminar con la sesión de A: guarda su progreso y avisa una vez', ds.progress.length === 1 && ds.progress[0].porcentaje === 67 && events.length === 1, JSON.stringify(events));
    ok('el aviso lleva SOLO la cuenta (ni obras ni porcentajes)', events.length === 1 && JSON.stringify(Object.keys(events[0])) === '["userId"]' && events[0].userId === 'A', JSON.stringify(events));
    ok('sin peticiones adicionales: una sola lectura de progreso', calls.length === 1 && calls[0][0] === 'GET' && calls[0][1].includes('/progress/user/A'), JSON.stringify(calls));
    reset(); login('A'); respond = () => ({ status: 500 });
    await ds.syncUserProgress('A'); await tick(5);
    ok('si el servidor falla: no se avisa ni se guarda nada', events.length === 0 && ds.progress.length === 0);
    reset(); login('A'); respond = () => 'network';
    await ds.syncUserProgress('A'); await tick(5);
    ok('sin red: tampoco', events.length === 0 && ds.progress.length === 0);

    section('[R] carreras de sesión');
    reset(); login('A');
    let release;
    respond = (u) => (u.includes('/progress/user/A') ? new Promise((r) => { release = () => r(progressFor([remote('A', 'c1', 67, 66.78)])(u)); }) : { status: 200 });
    let p = ds.syncUserProgress('A'); await tick(5);
    logout(); login('B');                                          // A sale y entra B mientras la respuesta viene en camino
    release(); await p; await tick(5);
    ok('cambio de cuenta durante la sincronización: el progreso de A no se guarda', ds.progress.length === 0 && LS.getItem('chibalete_progress') === null, String(LS.getItem('chibalete_progress')));
    ok('…ni se avisa (B no recibe nada de A)', events.length === 0, JSON.stringify(events));
    reset(); login('A');
    respond = (u) => (u.includes('/progress/user/A') ? new Promise((r) => { release = () => r(progressFor([remote('A', 'c1', 67, 66.78)])(u)); }) : { status: 200 });
    p = ds.syncUserProgress('A'); await tick(5);
    logout();                                                      // A cierra sesión y no entra nadie
    release(); await p; await tick(5);
    ok('cierre de sesión durante la sincronización: la respuesta tardía se descarta sin guardar ni avisar', ds.progress.length === 0 && LS.getItem('chibalete_progress') === null && events.length === 0, JSON.stringify(events));
    reset(); login('B');
    respond = progressFor([remote('A', 'c1', 67, 66.78)]);
    await ds.syncUserProgress('A'); await tick(5);
    ok('una sincronización de A pedida con la sesión de B no guarda ni avisa', ds.progress.length === 0 && events.length === 0);

    section('[L] la lista «en progreso» que se recalcula con el aviso');
    // Catálogo y acceso como los de una cuenta B2C: una regla con dos obras.
    ds.content = [{ id: 'c1', titulo: 'La metamorfosis', tipo: 'libro', etiquetas: [] }, { id: 'c2', titulo: 'La guerra de los mundos', tipo: 'libro', etiquetas: [] }, { id: 'c9', titulo: 'Fuera del derecho', tipo: 'libro', etiquetas: [] }];
    const grant = (userId, titleIds) => { ds.userContentAccessCache[userId] = { state: { appliedRules: ['r'], titleIds, collectionIds: [] }, fetchedAt: Date.now() }; };
    // Réplica exacta del manejador de las páginas (ver [P]): solo la cuenta del aviso, recalcula con getContenidosEnProgreso.
    const page = (userId, roles) => {
        let list = ds.getContenidosEnProgreso(userId, roles);               // cálculo existente al tener el acceso
        const onSynced = (e) => { if (e.detail?.userId !== userId) return; list = ds.getContenidosEnProgreso(userId, roles); };
        addEventListener(EVT, onSynced);
        return { get list() { return list; }, unmount: () => removeEventListener(EVT, onSynced) };
    };
    reset(); login('A'); grant('A', ['c1', 'c2']);
    let pg = page('A', ['lector']);
    ok('al tener el acceso, sin progreso todavía: la lista está vacía (lo que veía Dirección)', pg.list.length === 0);
    respond = progressFor([remote('A', 'c1', 67, 66.78), remote('A', 'c9', 40)]);
    await ds.syncUserProgress('A'); await tick(5);
    ok('el progreso llega DESPUÉS del acceso ⇒ la lista se actualiza con la obra y su 67 %', pg.list.length === 1 && pg.list[0].content.id === 'c1' && pg.list[0].progress.porcentaje === 67, JSON.stringify(pg.list.map((i) => [i.content.id, i.progress.porcentaje])));
    ok('…y sigue sin mostrar una obra fuera de su derecho', !pg.list.some((i) => i.content.id === 'c9'));
    pg.unmount();
    reset(); login('A'); grant('A', ['c1', 'c2']);
    respond = progressFor([remote('A', 'c2', 18, 17.55)]);
    await ds.syncUserProgress('A'); await tick(5);
    events.length = 0;
    pg = page('A', ['lector']);
    ok('el progreso llega ANTES del acceso ⇒ el cálculo existente ya lo muestra (sin cambios)', pg.list.length === 1 && pg.list[0].content.id === 'c2' && pg.list[0].progress.porcentaje === 18);
    pg.unmount();
    reset(); login('A'); grant('A', ['c1', 'c2']);
    pg = page('A', ['lector']);
    dispatchEvent(new CustomEvent(EVT, { detail: { userId: 'B' } }));
    ds.progress = [{ id: 'x', usuario_id: 'A', contenido_id: 'c1', porcentaje: 50 }];   // aunque hubiera datos, el aviso ajeno no recalcula
    dispatchEvent(new CustomEvent(EVT, { detail: { userId: 'B' } }));
    ok('un aviso de otra cuenta no cambia la lista', pg.list.length === 0);
    pg.unmount();
    dispatchEvent(new CustomEvent(EVT, { detail: { userId: 'A' } }));
    ok('desmontada la página, un aviso ya no la toca', pg.list.length === 0);
    // Regresión: lector de colegio (misma vía) y administración (sin filtro de acceso).
    reset(); login('L'); grant('L', ['c1']);
    pg = page('L', ['lector']);
    respond = progressFor([remote('L', 'c1', 25, 24.9)]);
    await ds.syncUserProgress('L'); await tick(5);
    ok('lector de colegio: misma lista y mismo porcentaje que antes', pg.list.length === 1 && pg.list[0].progress.porcentaje === 25);
    pg.unmount();
    reset(); login('ADM');
    pg = page('ADM', ['administrador']);
    respond = progressFor([remote('ADM', 'c9', 10)]);
    await ds.syncUserProgress('ADM'); await tick(5);
    ok('administración: conserva su excepción de acceso (sin cambios)', pg.list.length === 1 && pg.list[0].content.id === 'c9');
    pg.unmount();
    reset(); login('A'); grant('A', ['c1']);
    respond = progressFor([remote('A', 'c1', 100, 100)]);
    pg = page('A', ['lector']);
    await ds.syncUserProgress('A'); await tick(5);
    ok('una obra terminada (100 %) sigue fuera de «Estoy leyendo» (sin cambios)', pg.list.length === 0);
    pg.unmount();

    section('[P] Inicio y Biblioteca (estructura)');
    const home = code('pages/Home.tsx');
    const bib = code('pages/Biblioteca.tsx');
    const dsSrc = code('services/dataService.ts');
    const auth = code('context/AuthContext.tsx');
    for (const [name, src] of [['Inicio', home], ['Biblioteca', bib]]) {
        ok(`${name}: importa el evento del servicio (sin nombre repetido a mano)`, /import \{ dataService, PROGRESS_SYNCED_EVENT \} from '\.\.\/services\/dataService';/.test(src) && !src.includes("'chibalete:progress-synced'"));
        ok(`${name}: escucha solo con cuenta y acceso, y limpia al desmontar`, /if \(!user\?\.id \|\| !accessReady\) return;/.test(src)
            && /window\.addEventListener\(PROGRESS_SYNCED_EVENT, onSynced\);\s*return \(\) => window\.removeEventListener\(PROGRESS_SYNCED_EVENT, onSynced\);/.test(src));
        ok(`${name}: ignora el aviso de otra cuenta`, /\.detail\?\.userId !== userId\) return;/.test(src));
        ok(`${name}: recalcula con el mismo cálculo de siempre`, /dataService\.getContenidosEnProgreso\(userId, roles\)/.test(src));
        ok(`${name}: el cálculo existente al tener el acceso sigue en su sitio`, /if \(user && accessReady\)/.test(src));
    }
    ok('Inicio: el aviso solo recalcula «Estoy leyendo» (no vuelve a pedir tareas, comunidad ni nada más)', (() => {
        const i = home.indexOf('const onSynced'); const body = home.slice(i, home.indexOf('};', i));
        return i > 0 && /setEnProgreso\(/.test(body) && !/setNuevos|setRecomendados|setAssignments|setMisPublicaciones|fetch\(/.test(body);
    })());
    ok('Biblioteca: recalcula sobre el MISMO catálogo autorizado por el servidor y, sin él, no hace nada', /const authorized = authorizedCatalogRef\.current;\s*if \(!authorized\) return;\s*setEnProgreso\(gateProgressByVisible\(dataService\.getContenidosEnProgreso\(userId, roles\), authorized\)/.test(bib));
    ok('Biblioteca: al llegar el catálogo, se lee el progreso de ese momento (no la copia tomada al empezar)', /authorizedCatalogRef\.current = authorized;[\s\S]{0,200}setEnProgreso\(gateProgressByVisible\(dataService\.getContenidosEnProgreso\(user\.id, user\.roles\), authorized\)/.test(bib));
    ok('Biblioteca: al cambiar de cuenta se olvida el catálogo anterior', /useEffect\(\(\) => \{\s*authorizedCatalogRef\.current = null;/.test(bib));
    ok('servicio: el aviso sale después de la comprobación de sesión y del guardado', (() => {
        const s = dsSrc.slice(dsSrc.indexOf('async syncUserProgress('), dsSrc.indexOf('async syncUserProgress(') + 3000);
        const guard = s.indexOf('if (epoch !== this.sessionEpoch || this.getSessionUserId() !== userId) return;');
        const save = s.indexOf("this.saveState('progress', this.progress);");
        const notify = s.indexOf('this.notifyProgressSynced(userId);');
        return guard > 0 && save > guard && notify > save;
    })());
    ok('servicio: el aviso solo lleva { userId }', /new CustomEvent\(PROGRESS_SYNCED_EVENT, \{ detail: \{ userId \} \}\)/.test(dsSrc));
    ok('65E-C1: cerrar sesión sigue borrando la copia del progreso', /public clearSessionState\(\): void \{[\s\S]*?this\.progress = \[\];/.test(dsSrc) && /'chibalete_progress'/.test(dsSrc));
    ok('AuthContext sin cambios en la sincronización (sigue en segundo plano)', (auth.match(/dataService\.syncUserProgress\(/g) || []).length === 2 && !auth.includes('PROGRESS_SYNCED_EVENT'));

    section('[V] Modo Guiado: reanudar posiciones pequeñas');
    const vt = code('pages/VisorTexto.tsx');
    ok('la condición de reanudar acepta un viewportHint válido > 0 aunque el porcentaje sea 0', /const hint = progress\?\.canonicalProgress\?\.viewportHint;\s*const hasPreciseHint = typeof hint === 'number' && isFinite\(hint\) && hint > 0;\s*if \(progress && \(progress\.porcentaje > 0 \|\| hasPreciseHint\)\)/.test(vt));
    ok('el destino sigue saliendo del viewportHint (prioridad sin cambios)', /const scrollPct = \(cp\?\.viewportHint !== undefined && isFinite\(cp\.viewportHint\)\)\s*\? cp\.viewportHint/.test(vt));
    ok('el guardado no cambia (porcentaje redondeado + viewportHint preciso)', /const precisePct = Math\.max\(0, Math\.min\(100, \(scrollTop \/ docHeight\) \* 100\)\);\s*const percentage = Math\.round\(precisePct\);/.test(vt));
    // La misma regla, evaluada: ¿se reanuda?
    const resumes = (porcentaje, hint) => { const hasPreciseHint = typeof hint === 'number' && isFinite(hint) && hint > 0; return !!({ porcentaje }) && (porcentaje > 0 || hasPreciseHint); };
    ok('0 % con posición 0,447 (la de #735) ⇒ se reanuda', resumes(0, 0.447) === true);
    ok('0 % sin posición o en 0 ⇒ no (como antes)', resumes(0, undefined) === false && resumes(0, 0) === false && resumes(0, NaN) === false);
    ok('posiciones ordinarias (18 %, 67 %) ⇒ igual que antes', resumes(18, 17.55) && resumes(67, 66.78) && resumes(67, undefined));
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e);
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nReadingPersistenceResume — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
