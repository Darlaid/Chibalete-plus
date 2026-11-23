/**
 * PrivacyLocal65EC1.test.mjs — CHP V9 65E-C1 (Bloque I). Privacidad local y continuidad sin conexión.
 *
 * Con el `dataService` REAL, el almacenamiento del navegador y la red simulados:
 *   [C] al cerrar sesión no queda la copia del progreso ni del padrón; lo pendiente de enviar SÍ se conserva
 *   [I] la cola de pendientes es del dispositivo: cada cuenta envía solo lo suyo; sin sesión, nada
 *   [P] lo pendiente de una cuenta no lo desaloja la actividad de otra; un rechazo definitivo no se reintenta
 *   [T] una respuesta de progreso que llega tarde no repone la copia de la cuenta que ya salió
 *   [L] antes de salir se envía lo pendiente de ESA cuenta; cierre de sesión pendiente (sin conexión)
 *   [A] contexto de autenticación y lector EPUB (estructura)
 *
 *   node pages/__tests__/PrivacyLocal65EC1.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65ec1_'));
const store = () => { const m = new Map(); return { _m: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

try {
    const out = path.join(tmp, 'ds.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'services/dataService.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
        external: ['react', 'react-dom'], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    globalThis.window = globalThis; Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {} });
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };
    const LS = store(), SS = store();
    globalThis.localStorage = LS; globalThis.sessionStorage = SS;
    const realSetInterval = globalThis.setInterval; globalThis.setInterval = () => 0;
    // Red simulada: cada petición queda anotada; `respond(url, init)` decide la respuesta.
    const calls = [];
    let respond = () => ({ status: 503 });
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url); calls.push([init.method || 'GET', u]);
        const r = await respond(u, init);
        if (r === 'network') throw new TypeError('network');
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
    };
    const { dataService: ds } = await import(pathToFileURL(out).href);
    globalThis.setInterval = realSetInterval;
    await tick(5);
    const QUEUE = 'chibalete_failed_syncs';
    const entry = (userId, contentId, sid, addedAt = new Date().toISOString()) => ({ userId, contentId, payload: JSON.stringify({ canonicalProgress: { globalPercentage: 40 }, session: { sessionId: sid, startedAt: addedAt, durationSec: 60, mode: 'text' }, updatedAt: addedAt }), addedAt });
    const setQueue = (list) => LS.setItem(QUEUE, JSON.stringify(Object.fromEntries(list.map((e) => [`${e.userId}__${e.contentId}__${JSON.parse(e.payload).session.sessionId}`, e]))));
    const queue = () => Object.values(JSON.parse(LS.getItem(QUEUE) || '{}')).map((e) => `${e.userId}/${e.contentId}`).sort();
    const sentTo = (id) => calls.filter(([m, u]) => m === 'POST' && u.includes(`/progress/${id}/`)).length;
    const reset = () => { calls.length = 0; ds.failedSyncs.clear(); ds.settledFailKeys.clear(); ds.pendingSyncs.clear(); ds.lastSyncedPayloads.clear(); };

    section('[C] cierre de sesión: copias fuera, pendientes dentro');
    LS.setItem('chibalete_user_id', 'A');
    LS.setItem('chibalete_progress', JSON.stringify([{ id: 'A__c3', usuario_id: 'A', contenido_id: 'c3', porcentaje: 40 }]));
    LS.setItem('chibalete_users', JSON.stringify([{ id: 'r1', nombre_completo: 'Estudiante Uno' }])); LS.setItem('chibalete_groups', '[{"id":"g1"}]'); LS.setItem('chibalete_schools', '[]');
    LS.setItem('chibalete:aulaviva:/students-needing-attention', '{"owner":"A"}'); LS.setItem('gemini_cache_abc', '{"respuesta":"texto de Leo"}');
    LS.setItem('vt_fontSize', '18'); LS.setItem('chibalete:a11y:settings', '{}'); LS.setItem('a11y_events_queue', '[{"eventId":"e1","userId":"A","event":"a11y.session_end"}]');
    SS.setItem('leo_session_c3', '{"turnos":3}');
    setQueue([entry('A', 'c3', 's-a1')]);
    ds.progress = [{ id: 'A__c3', usuario_id: 'A', contenido_id: 'c3', porcentaje: 40 }];
    ds.clearSessionState();
    ok('no queda la copia del progreso, ni en memoria ni en el navegador', LS.getItem('chibalete_progress') === null && ds.progress.length === 0);
    ok('ni el padrón, los grupos, los colegios, las copias de Aula Viva, la caché de respuestas de Leo o la conversación de la pestaña', ['chibalete_users', 'chibalete_groups', 'chibalete_schools', 'chibalete:aulaviva:/students-needing-attention', 'gemini_cache_abc'].every((k) => LS.getItem(k) === null) && SS.getItem('leo_session_c3') === null, [...LS._m.keys()].join());
    ok('lo pendiente de enviar se conserva (progreso y eventos del Modo Accesible)', queue().join() === 'A/c3' && JSON.parse(LS.getItem('a11y_events_queue')).length === 1);
    ok('y las preferencias del dispositivo', LS.getItem('vt_fontSize') === '18' && LS.getItem('chibalete:a11y:settings') === '{}');
    ok('la copia en memoria de la cola se vacía (la del navegador no)', ds.failedSyncs.size === 0 && ds.pendingSyncs.size === 0 && ds.lastSyncedPayloads.size === 0);

    section('[I] cada cuenta envía solo lo suyo');
    reset(); respond = () => ({ status: 200 });
    setQueue([entry('A', 'c3', 's-a1'), entry('B', 'c1', 's-b1')]);
    LS.removeItem('chibalete_user_id');
    ds.retryFailedSyncs(); await tick(5);
    ok('sin sesión no se envía nada y la cola queda intacta', calls.length === 0 && queue().join() === 'A/c3,B/c1', JSON.stringify(calls));
    LS.setItem('chibalete_user_id', 'B');
    ds.retryFailedSyncs(); await tick(5);
    ok('con la sesión de B: se envía lo de B y NADA de A', sentTo('B') === 1 && sentTo('A') === 0, JSON.stringify(calls));
    ok('…lo de B sale de la cola; lo de A sigue esperando a A', queue().join() === 'A/c3', queue().join());
    // Un guardado que estaba a punto de salir cuando cambió la sesión: no se envía con la sesión de otro.
    reset();
    ds.pendingSyncs.set('A__c9', { usuario_id: 'A', contenido_id: 'c9', canonicalProgress: { globalPercentage: 10 }, fecha_actualizacion: new Date().toISOString(), session: { sessionId: 's-a9', startedAt: new Date().toISOString(), durationSec: 30, mode: 'text' } });
    ds.flushSync(true); await tick(5);
    ok('un guardado de A a punto de enviarse con la sesión de B no se envía: pasa a la cola', sentTo('A') === 0 && queue().join() === 'A/c3,A/c9', `${JSON.stringify(calls)} ${queue().join()}`);
    LS.setItem('chibalete_user_id', 'A'); reset();
    ds.retryFailedSyncs(); await tick(5);
    ok('cuando vuelve A, sus dos pendientes llegan al servidor y la cola queda vacía', sentTo('A') === 2 && queue().length === 0, `${JSON.stringify(calls)} ${queue().join()}`);

    section('[P] pendientes de otra cuenta, rechazos y caducidad');
    reset(); LS.setItem('chibalete_user_id', 'B'); respond = () => 'network';
    setQueue([entry('A', 'c3', 's-a1')]);
    for (let i = 0; i < 60; i++) ds.addToFailedSyncs(`B__c${i}__s${i}`, 'B', `c${i}`, entry('B', `c${i}`, `s${i}`).payload);
    const q = queue();
    ok('60 pendientes de B no desalojan el de A (el tope es por cuenta: 50 de B + 1 de A)', q.includes('A/c3') && q.filter((x) => x.startsWith('B/')).length === 50, `${q.length} ${q.includes('A/c3')}`);
    reset(); LS.setItem('chibalete_user_id', 'A');
    setQueue([entry('A', 'c3', 's-a1'), entry('A', 'c4', 's-a2'), entry('A', 'c5', 's-a3')]);
    respond = (u) => ({ status: u.includes('/c3/') ? 403 : u.includes('/c4/') ? 500 : 401 });
    ds.retryFailedSyncs(); await tick(5);
    ok('rechazo definitivo (403: cuenta suprimida, obra retirada) → no se conserva; 500 y 401 → siguen para reintentar', queue().join() === 'A/c4,A/c5', queue().join());
    reset(); setQueue([entry('A', 'c3', 's-old', new Date(Date.now() - 8 * 86400000).toISOString()), entry('A', 'c4', 's-new')]);
    respond = () => 'network';
    ds.retryFailedSyncs(); await tick(5);
    // V9 65E-C3: el plazo de 7 días rige para la cuenta que YA NO usa el equipo. Con su sesión abierta, lo pendiente de A
    // no caduca sin haberse enviado (antes se borraba en silencio tras una semana sin conexión).
    ok('con su sesión abierta, un pendiente de más de 7 días NO se borra sin enviarse: sigue en la cola', queue().join() === 'A/c3,A/c4', queue().join());
    reset(); LS.setItem('chibalete_user_id', 'B');
    setQueue([entry('A', 'c3', 's-old', new Date(Date.now() - 8 * 86400000).toISOString()), entry('A', 'c4', 's-new')]);
    ds.retryFailedSyncs(); await tick(5);
    ok('un pendiente de más de 7 días de una cuenta que no volvió sí caduca (y no se envía con la sesión de otra)', queue().join() === 'A/c4' && sentTo('A') === 0, `${queue().join()} ${sentTo('A')}`);
    LS.setItem('chibalete_user_id', 'A');

    section('[T] respuesta tardía');
    reset(); LS.setItem('chibalete_user_id', 'A'); LS.removeItem('chibalete_progress'); LS.removeItem(QUEUE);
    let release;
    respond = (u) => (u.includes('/progress/user/A') ? new Promise((r) => { release = () => r({ status: 200, body: { progressList: [{ id: 'A__c3', userId: 'A', contentId: 'c3', updatedAt: new Date().toISOString(), canonicalProgress: { globalPercentage: 77 } }] } }); }) : { status: 200 });
    const p = ds.syncUserProgress('A'); await tick(5);
    LS.removeItem('chibalete_user_id'); ds.clearSessionState();          // A cierra sesión mientras la respuesta viene en camino
    release(); await p; await tick(5);
    ok('la respuesta que llega después del cierre de sesión no repone el progreso de A', LS.getItem('chibalete_progress') === null && ds.progress.length === 0, String(LS.getItem('chibalete_progress')));
    LS.setItem('chibalete_user_id', 'B');
    respond = (u) => (u.includes('/progress/user/A') ? { status: 200, body: { progressList: [{ id: 'A__c3', userId: 'A', contentId: 'c3', updatedAt: new Date().toISOString(), canonicalProgress: { globalPercentage: 77 } }] } } : { status: 200 });
    await ds.syncUserProgress('A'); await tick(5);
    ok('…ni una respuesta sobre A recibida con la sesión de B', LS.getItem('chibalete_progress') === null && ds.progress.length === 0);
    respond = (u) => (u.includes('/progress/user/B') ? { status: 200, body: { progressList: [{ id: 'B__c1', userId: 'B', contentId: 'c1', updatedAt: new Date().toISOString(), canonicalProgress: { globalPercentage: 12 } }] } } : { status: 200 });
    await ds.syncUserProgress('B'); await tick(5);
    ok('la de la cuenta con sesión sí se guarda (sin cambios para el uso normal)', ds.progress.length === 1 && ds.progress[0].usuario_id === 'B');

    section('[L] antes de salir y cierre pendiente');
    reset(); LS.setItem('chibalete_user_id', 'A'); respond = () => ({ status: 200 });
    setQueue([entry('A', 'c3', 's-a1'), entry('B', 'c1', 's-b1')]);
    ds.pendingSyncs.set('A__c7', { usuario_id: 'A', contenido_id: 'c7', canonicalProgress: { globalPercentage: 5 }, fecha_actualizacion: new Date().toISOString(), session: { sessionId: 's-a7', startedAt: new Date().toISOString(), durationSec: 20, mode: 'text' } });
    await ds.flushPendingForLogout('A', 500);
    ok('con servidor: antes de revocar se envía lo pendiente de A (también lo que estaba a punto de salir) y nada de B', sentTo('A') === 2 && sentTo('B') === 0 && queue().join() === 'B/c1', `${JSON.stringify(calls)} ${queue().join()}`);
    reset(); respond = () => 'network';
    setQueue([entry('A', 'c3', 's-a1')]);
    ds.pendingSyncs.set('A__c7', { usuario_id: 'A', contenido_id: 'c7', canonicalProgress: { globalPercentage: 5 }, fecha_actualizacion: new Date().toISOString(), session: { sessionId: 's-a7', startedAt: new Date().toISOString(), durationSec: 20, mode: 'text' } });
    await ds.flushPendingForLogout('A', 500);
    ok('sin conexión: nada se pierde; los dos pendientes de A quedan en la cola', queue().join() === 'A/c3,A/c7', queue().join());
    reset(); respond = () => new Promise(() => {});
    setQueue([entry('A', 'c3', 's-a1')]);
    const t0 = Date.now(); await ds.flushPendingForLogout('A', 300);
    ok('un servidor que no responde no retiene el cierre de sesión (espera acotada)', Date.now() - t0 < 2000 && queue().join() === 'A/c3', `${Date.now() - t0} ms`);
    respond = () => 'network';
    ok('revocación sin respuesta del servidor → `false`', (await ds.serverLogout()) === false);
    ds.markLogoutPending();
    ok('queda la marca de cierre pendiente (sin ningún dato de la cuenta)', ds.hasLogoutPending() === true && LS.getItem('chibalete_logout_pending') === '1');
    ok('mientras no haya servidor la marca sigue', (await ds.settlePendingLogout()) === false && ds.hasLogoutPending() === true);
    respond = (u) => ({ status: u.includes('/auth/logout') ? 200 : 503 });
    ok('con servidor: se revoca y la marca desaparece', (await ds.settlePendingLogout()) === true && ds.hasLogoutPending() === false && calls.some(([m, u]) => m === 'POST' && u.endsWith('/auth/logout')));
    respond = () => ({ status: 401 }); ds.markLogoutPending();
    ok('una sesión que el servidor ya no reconoce también cierra el pendiente', (await ds.settlePendingLogout()) === true && ds.hasLogoutPending() === false);

    section('[A] contexto de autenticación y lector EPUB');
    const auth = code('context/AuthContext.tsx'), epub = code('components/epub-reader/EpubReaderApp.tsx'), dsSrc = code('services/dataService.ts');
    const logout = auth.slice(auth.indexOf('const logout = () => {'), auth.indexOf('return (', auth.indexOf('const logout = () => {')));
    ok('cerrar sesión: marca primero; después envía lo pendiente de la cuenta, revoca y solo entonces quita la marca', logout.indexOf('dataService.markLogoutPending()') >= 0 && logout.indexOf('dataService.markLogoutPending()') < logout.indexOf('dataService.flushPendingForLogout(leavingId)')
        && /flushPendingForLogout\(leavingId\)\s*\.then\(\(\) => dataService\.serverLogout\(\)\)\s*\.then\(\(revoked\) => \{ if \(revoked\) dataService\.clearLogoutPending\(\); \}\)/.test(logout));
    ok('…y sigue limpiando el estado local y el contenido editorial (sin cambios)', /dataService\.clearSessionState\(\);/.test(logout) && /clearEditorialClientStorage\(\);/.test(logout) && /localStorage\.removeItem\('chibalete_user_id'\)/.test(logout));
    const init = auth.slice(auth.indexOf('const initAuth = async () => {'), auth.indexOf('initAuth();'));
    ok('al abrir con un cierre pendiente: se reintenta la revocación y NO se restaura la sesión por la cookie', /if \(!storedUserId && dataService\.hasLogoutPending\(\)\)/.test(init) && /logoutPending = !\(await dataService\.settlePendingLogout\(\)\);/.test(init) && /if \(!storedUserId && !logoutPending\) \{\s*const me = await dataService\.fetchSessionMe\(\);/.test(init));
    ok('un inicio de sesión nuevo cierra el pendiente y no hereda memoria de otra cuenta', /dataService\.clearLogoutPending\(\);\s*if \(user\?\.id && user\.id !== userToLogin\.id\) dataService\.clearSessionState\(\);/.test(auth));
    ok('el lector EPUB (página aparte) tampoco usa la cookie con un cierre pendiente', /getItem\('chibalete_logout_pending'\) === '1'/.test(epub) && epub.indexOf("chibalete_logout_pending") < epub.indexOf("fetch('/api/auth/me'"));
    ok('la marca no guarda datos de la cuenta', /setItem\(DataService\.LOGOUT_PENDING_KEY, '1'\)/.test(dsSrc));
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e);
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nPrivacyLocal65EC1 — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
