/**
 * PrivacyLocal65EC3.test.mjs — CHP V9 65E-C3 (Bloque I). Cierre de sesión informado, eliminación voluntaria y cola.
 *
 * Con el `dataService` REAL, el almacenamiento del navegador y la red simulados; dos cuentas (A y B) en el mismo equipo:
 *   [R] resumen de lo que queda en el equipo de UNA cuenta (pendientes y datos que solo existen aquí)
 *   [E] eliminación voluntaria: quita solo lo de esa cuenta; lo de la otra, lo compartido y las preferencias, intactos
 *   [Q] cola: la antigüedad no es una entrega — lo pendiente de la cuenta en sesión no caduca; lo de quien se fue, a los 7 días
 *   [V] regreso tras un periodo prolongado: se envía, no se borra
 *   [S] supresión legítima y rechazo definitivo: se retira sin reintentar
 *   [D] diálogo de cierre de sesión y aviso de pendientes (estructura y accesibilidad)
 *
 *   node pages/__tests__/PrivacyLocal65EC3.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 800)), fail++);
const section = (t) => console.log(`\n${t}`);
const code = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65ec3_'));
const store = () => { const m = new Map(); return { _m: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

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
    const calls = [];
    let respond = () => ({ status: 503 });
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url); calls.push([init.method || 'GET', u]);
        const r = await respond(u, init);
        if (r === 'network') throw new TypeError('network');
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
    };

    // ── Lo que dos cuentas dejaron en el mismo navegador (las claves y formas reales de la aplicación) ──
    const QUEUE = 'chibalete_failed_syncs';
    const entry = (userId, contentId, sid, addedAt = new Date().toISOString()) => ({ userId, contentId, payload: JSON.stringify({ canonicalProgress: { globalPercentage: 40 }, session: { sessionId: sid, startedAt: addedAt, durationSec: 60, mode: 'text' }, updatedAt: addedAt }), addedAt });
    const setQueue = (list) => LS.setItem(QUEUE, JSON.stringify(Object.fromEntries(list.map((e) => [`${e.userId}__${e.contentId}__${JSON.parse(e.payload).session.sessionId}`, e]))));
    // (65E-C4: la cola puede llevar además la constancia de caducidades, que no es una lectura pendiente)
    const queue = () => Object.values(JSON.parse(LS.getItem(QUEUE) || '{}')).filter((e) => e && e.payload).map((e) => `${e.userId}/${e.contentId}`).sort();
    const J = (k) => JSON.parse(LS.getItem(k) || '[]');
    const seed = () => {
        LS.clear();
        LS.setItem('chibalete_journalEntries', JSON.stringify([{ id: 'j-a1', userId: 'A', type: 'personal', title: 'Diario de A', content: 'privado A', date: '2026-11-20', tags: [] }, { id: 'j-a2', userId: 'A', type: 'task_draft', title: 'Borrador de tarea de A', content: 'tarea A', date: '2026-11-21', tags: [] },
            { id: 'j-b1', userId: 'B', type: 'personal', title: 'Diario de B', content: 'privado B', date: '2026-11-20', tags: [] }]));
        LS.setItem('chibalete_reviews', JSON.stringify([{ id: 'r-a', usuario_id: 'A', contenido_id: 'c1', puntuacion: 5, comentario: 'reseña A' }, { id: 'r-b', usuario_id: 'B', contenido_id: 'c1', puntuacion: 4, comentario: 'reseña B' }]));
        LS.setItem('chibalete_assignments', JSON.stringify([{ id: 'as-1', groupId: 'g1', title: 'Tarea del curso', studentSubmissions: [{ studentId: 'A', studentName: 'A', content: 'entrega A' }, { studentId: 'B', studentName: 'B', content: 'entrega B' }] }]));
        LS.setItem('chibalete_communityPosts', JSON.stringify([{ id: 'p-a', autor_id: 'A', texto: 'post A' }, { id: 'p-b', autor_id: 'B', texto: 'post B' }]));
        LS.setItem('chibalete_oralityAttempts', JSON.stringify([{ id: 'o-a', userId: 'A', contentId: 'c1' }, { id: 'o-b', userId: 'B', contentId: 'c1' }]));
        LS.setItem('chibalete_leoReaderProfiles', JSON.stringify([{ userId: 'A', level: 2 }, { userId: 'B', level: 3 }]));
        LS.setItem('chibalete_bookmarks', JSON.stringify([{ id: 'bm-1', nombre: 'Marcador del equipo', imagen_url: '' }]));
        LS.setItem('chibalete_vocab_A', JSON.stringify(['efímero', 'umbral'])); LS.setItem('chibalete_vocab_B', JSON.stringify(['bruma']));
        LS.setItem('reread_A_c1', JSON.stringify({ readCount: 2 })); LS.setItem('reread_B_c1', JSON.stringify({ readCount: 1 }));
        LS.setItem('crr_snap__text__A__c1', JSON.stringify({ userId: 'A' })); LS.setItem('crr_snap__text__B__c1', JSON.stringify({ userId: 'B' }));
        LS.setItem('a11y_events_queue', JSON.stringify([{ eventId: 'e-a', userId: 'A', event: 'a11y.session_start' }, { eventId: 'e-b', userId: 'B', event: 'a11y.session_start' }]));
        LS.setItem('vt_fontSize', '18'); LS.setItem('chibalete:a11y:settings', '{"fontSize":20}');
        setQueue([entry('A', 'c1', 's-a1'), entry('A', 'c3', 's-a2'), entry('B', 'c1', 's-b1')]);
    };
    seed();
    const { dataService: ds } = await import(pathToFileURL(out).href);
    globalThis.setInterval = realSetInterval;
    await ds.waitForInitialization(); await tick(5);
    const reset = () => { calls.length = 0; ds.failedSyncs.clear(); ds.settledFailKeys.clear(); ds.pendingSyncs.clear(); ds.lastSyncedPayloads.clear(); ds.expiredNotes = {}; ds.unpersistedKeys?.clear(); };
    const sentTo = (id) => calls.filter(([m, u]) => m === 'POST' && u.includes(`/progress/${id}/`)).length;

    section('[R] qué queda en el equipo de cada cuenta');
    {
        const a = ds.localDataSummary('A'), b = ds.localDataSummary('B'), z = ds.localDataSummary('Z');
        ok('cuenta A: 3 lecturas sin enviar (2 de la cola + lectura accesible), 2 entradas de bitácora, 1 reseña, 1 entrega, 1 publicación, 1 práctica de voz, 2 palabras, 3 notas de lectura', a.pendingReadings === 3 && a.journal === 2 && a.reviews === 1 && a.submissions === 1 && a.posts === 1 && a.orality === 1 && a.vocabulary === 2 && a.other === 3 && a.total === 14, JSON.stringify(a));
        ok('cuenta B: solo lo suyo (2 sin enviar, 1 entrada, 1 palabra)', b.pendingReadings === 2 && b.journal === 1 && b.vocabulary === 1 && b.total === 11, JSON.stringify(b));
        ok('una cuenta sin nada en el equipo: todo en cero (el diálogo no se abre)', z.total === 0 && z.pendingReadings === 0, JSON.stringify(z));
        ok('el resumen dice hasta cuándo se conservarían los pendientes si la cuenta no vuelve (12 meses desde el más antiguo; 65E-C4)', Math.abs(a.pendingExpiresAt - (Date.now() + 365 * DAY)) < 60_000 && ds.pendingRetentionDays === 365 && ds.pendingRetentionLabel === '12 meses', String(a.pendingExpiresAt));
        ok('consultar el resumen no envía ni borra nada', calls.filter(([m]) => m === 'POST').length === 0 && queue().join() === 'A/c1,A/c3,B/c1');
    }

    section('[E] eliminación voluntaria de la cuenta A');
    {
        const before = { prefs: [LS.getItem('vt_fontSize'), LS.getItem('chibalete:a11y:settings')], bookmarks: LS.getItem('chibalete_bookmarks') };
        ds.purgeLocalDataOf('A');
        const a = ds.localDataSummary('A'), b = ds.localDataSummary('B');
        ok('de A no queda nada en el equipo', a.total === 0, JSON.stringify(a));
        ok('…ni en el almacenamiento: ningún texto ni clave de A', ![...LS._m].some(([k, v]) => /"userId":"A"|"usuario_id":"A"|"studentId":"A"|"autor_id":"A"|privado A|entrega A|reseña A/.test(v) || /_A(_|$)|__A__/.test(k)), JSON.stringify([...LS._m.keys()]));
        ok('lo de B sigue intacto: sus pendientes, bitácora, reseña, entrega, publicación, voz, vocabulario y notas', b.total === 11 && queue().join() === 'B/c1' && J('chibalete_journalEntries').map((e) => e.id).join() === 'j-b1' && J('chibalete_reviews')[0].id === 'r-b'
            && J('chibalete_assignments')[0].studentSubmissions.map((x) => x.studentId).join() === 'B' && LS.getItem('chibalete_vocab_B') === '["bruma"]' && LS.getItem('reread_B_c1') !== null && LS.getItem('crr_snap__text__B__c1') !== null
            && J('a11y_events_queue').map((e) => e.userId).join() === 'B', JSON.stringify([b, queue()]));
        ok('la tarea del curso sigue existiendo (solo salió la entrega de A)', J('chibalete_assignments').length === 1 && J('chibalete_assignments')[0].title === 'Tarea del curso');
        ok('lo que no es de ninguna cuenta no se toca: preferencias de lectura y marcadores del equipo', LS.getItem('vt_fontSize') === before.prefs[0] && LS.getItem('chibalete:a11y:settings') === before.prefs[1] && LS.getItem('chibalete_bookmarks') === before.bookmarks);
        ok('eliminar no envía nada por su cuenta (el envío previo lo hace el cierre de sesión con la sesión válida)', calls.filter(([m]) => m === 'POST').length === 0);
        ok('lo eliminado no vuelve a aparecer al reintentar la cola', (ds.retryFailedSyncs(), queue().join() === 'B/c1'));
        ds.purgeLocalDataOf('');
        ok('sin cuenta indicada no se borra nada', ds.localDataSummary('B').total === 11);
    }

    section('[Q] cola: la antigüedad no es una entrega');
    {
        const old = (d) => new Date(Date.now() - d * DAY).toISOString();
        reset(); LS.setItem('chibalete_user_id', 'A'); respond = () => 'network';
        setQueue([entry('A', 'c1', 's-10d', old(10)), entry('A', 'c3', 's-2d', old(2)), entry('B', 'c1', 's-b-400d', old(400)), entry('B', 'c3', 's-b-60d', old(60))]);
        ds.retryFailedSyncs(); await tick(5);
        ok('A con la sesión abierta y sin conexión diez días: su lectura de hace 10 días sigue en la cola (antes se borraba al séptimo)', queue().includes('A/c1') && queue().includes('A/c3'), queue().join());
        ok('…se intentó enviar (2 intentos de A) y nada de B', sentTo('A') === 2 && sentTo('B') === 0, `${sentTo('A')} ${sentTo('B')}`);
        ok('lo de B, que ya no usa el equipo: lo de más de 12 meses caduca, lo de 60 días se conserva', queue().join() === 'A/c1,A/c3,B/c3', queue().join());
        const st = ds.pendingSyncStatus('A');
        ok('estado de pendientes de A: 2, con la fecha del más antiguo', st.count === 2 && Math.abs(st.oldestAddedAt - (Date.now() - 10 * DAY)) < 60_000, JSON.stringify(st));
        ok('…y el de una cuenta sin pendientes: 0', ds.pendingSyncStatus('Z').count === 0);
        reset(); LS.removeItem('chibalete_user_id');
        setQueue([entry('A', 'c1', 's-400d', old(400)), entry('A', 'c3', 's-10d', old(10))]);
        ds.retryFailedSyncs(); await tick(5);
        ok('sin ninguna sesión abierta rige el plazo: lo de más de 12 meses se elimina, lo de 10 días se conserva y nada se envía', queue().join() === 'A/c3' && calls.filter(([m]) => m === 'POST').length === 0, queue().join());
    }

    section('[V] regreso tras un periodo prolongado');
    {
        const old = (d) => new Date(Date.now() - d * DAY).toISOString();
        reset(); LS.setItem('chibalete_user_id', 'A');
        setQueue([entry('A', 'c1', 's-20d', old(20))]);
        respond = () => ({ status: 200 });
        ds.retryFailedSyncs(); await tick(5);
        ok('A vuelve a los 20 días con su lectura todavía en el equipo: se ENVÍA (1 envío) y sale de la cola al confirmarse', sentTo('A') === 1 && queue().length === 0, `${sentTo('A')} ${queue().join()}`);
        reset(); setQueue([entry('A', 'c1', 's-20d', old(20))]);
        respond = () => ({ status: 500 });
        ds.retryFailedSyncs(); await tick(5);
        ok('…y si el servidor falla, sigue en la cola para el próximo intento (no se confunde con entregada)', queue().join() === 'A/c1', queue().join());
    }

    section('[S] supresión legítima y rechazo definitivo');
    {
        reset(); LS.setItem('chibalete_user_id', 'A');
        setQueue([entry('A', 'c1', 's-x', new Date(Date.now() - 9 * DAY).toISOString()), entry('A', 'c3', 's-y')]);
        respond = (u) => ({ status: u.includes('/c1/') ? 410 : 403 });
        ds.retryFailedSyncs(); await tick(5);
        ok('el servidor rechaza de forma definitiva (cuenta suprimida, obra retirada): se retira de la cola, tenga la antigüedad que tenga', queue().length === 0, queue().join());
    }

    section('[D] diálogo de cierre de sesión y aviso de pendientes (estructura)');
    {
        const dlg = code('components/LogoutDialog.tsx'), nav = code('components/Navbar.tsx'), perfil = code('pages/Perfil.tsx'), auth = code('context/AuthContext.tsx');
        ok('diálogo accesible: role="dialog", modal, con título y descripción asociados', /role="dialog"/.test(dlg) && /aria-modal="true"/.test(dlg) && /aria-labelledby="logout-dialog-title"/.test(dlg) && /aria-describedby="logout-dialog-desc"/.test(dlg));
        ok('teclado: Escape cancela o vuelve, y el tabulador no sale del diálogo', /e\.key === 'Escape'/.test(dlg) && /e\.key !== 'Tab'/.test(dlg) && /last\.focus\(\)/.test(dlg) && /first\.focus\(\)/.test(dlg));
        ok('el foco inicial está en la opción que NO borra (conservar; en la confirmación, volver)', /ref=\{firstRef\}[^>]*onClick=\{onKeep\}/.test(dlg) && /ref=\{firstRef\}[^>]*onClick=\{\(\) => setStep\('choose'\)\}/.test(dlg));
        ok('eliminar exige un segundo paso de confirmación; el primer botón solo lo abre', /onClick=\{\(\) => setStep\('confirm'\)\}[^>]*data-testid="logout-delete"/.test(dlg) && /onClick=\{confirmDelete\}[^>]*data-testid="logout-delete-confirm"/.test(dlg) && (dlg.match(/onDelete\(\)/g) || []).length === 1);
        ok('la confirmación dice qué se pierde y que no afecta a otras cuentas', /se perderá/.test(dlg) && /no hay otra copia/.test(dlg) && /otras personas que usen este equipo/.test(dlg) && /no se puede deshacer/.test(dlg));
        ok('el aviso explica el riesgo en equipos compartidos y recomienda un perfil propio del navegador', /acceso al navegador/.test(dlg) && /propio perfil del navegador/.test(dlg));
        ok('eliminar: primero se intenta enviar lo pendiente con la sesión válida, después se borra lo de esa cuenta y se cierra', /await dataService\.flushPendingForLogout\(user\.id\);\s*dataService\.purgeLocalDataOf\(user\.id\);\s*finish\(\);/.test(dlg));
        ok('sin nada de la cuenta en el equipo no se pregunta: cierra directamente', /localDataSummary\(id\)\.total === 0\)\) \{ finish\(\); return; \}/.test(dlg));
        ok('los botones del menú (escritorio y móvil) y el del perfil usan este flujo; ya no hay `window.confirm`', /useLogoutFlow\(/.test(nav) && /logoutFlow\.requestLogout\(/.test(nav) && /\{logoutFlow\.dialog\}/.test(nav) && /useLogoutFlow\(/.test(perfil) && /\{logoutFlow\.dialog\}/.test(perfil) && !/window\.confirm\('¿Estás seguro de que quieres cerrar sesión/.test(perfil));
        ok('el cierre de sesión en sí no cambió: sigue sin borrar por defecto lo que solo existe en el equipo', !/purgeLocalDataOf/.test(auth));
        ok('aviso de pendientes: región de estado, solo con la cuenta en sesión y sin alarmar por un envío en curso', /role="status"/.test(dlg) && /pendingSyncStatus\(user\.id\)/.test(dlg) && /60_000/.test(dlg) && (nav.match(/<PendingSyncNotice \/>/g) || []).length === 2);
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nPrivacyLocal65EC3 — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
