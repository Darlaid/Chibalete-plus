/**
 * PendingQueue65EC4.test.mjs — CHP V9 65E-C4 (Bloque I). Colas de lectura pendiente sin pérdida silenciosa.
 *
 * Con el `dataService` REAL, el almacenamiento del navegador y la red simulados; cuentas A y B en el mismo equipo:
 *   [N] capacidad: más de 50 pendientes de una cuenta — ninguno se desaloja (antes se perdían los más antiguos)
 *   [T] cuenta ausente con pendientes de 8, 30 y 60 días: se conservan (plazo: 12 meses, el de Lector Único)
 *   [X] caducidad a los 12 meses: no es una entrega; queda constancia y se le dice a su titular al volver
 *   [C] A → B → A: cada cuenta envía solo lo suyo; nada viaja con las credenciales de otra
 *   [D] sincronización tardía, rechazo definitivo y eliminación voluntaria
 *   [S] almacenamiento agotado: lo ya guardado no se toca, lo nuevo no se da por guardado y se informa
 *   [A] cola del Visor Accesible: sin tope por número ni desalojo entre cuentas (estructura)
 *
 *   node pages/__tests__/PendingQueue65EC4.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65ec4_'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;
const TABLA = {};
/** Almacenamiento del navegador simulado, con cuota opcional (como el `QuotaExceededError` real). */
const store = () => {
    const m = new Map(); let quota = Infinity;
    return { _m: m, setQuota: (n) => { quota = n; }, getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { const size = [...m].reduce((a, [kk, vv]) => a + (kk === k ? 0 : vv.length), 0) + String(v).length; if (size > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
        removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
};

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
    const { dataService: ds } = await import(pathToFileURL(out).href);
    globalThis.setInterval = realSetInterval;
    await ds.waitForInitialization(); await tick(5);

    const QUEUE = 'chibalete_failed_syncs';
    const old = (d) => new Date(Date.now() - d * DAY).toISOString();
    const body = (sid, at) => JSON.stringify({ canonicalProgress: { globalPercentage: 40 }, session: { sessionId: sid, startedAt: at, durationSec: 600, mode: 'text' }, updatedAt: at });
    const entry = (userId, contentId, sid, addedAt = new Date().toISOString()) => ({ userId, contentId, payload: body(sid, addedAt), addedAt });
    const setQueue = (list) => LS.setItem(QUEUE, JSON.stringify(Object.fromEntries(list.map((e) => [`${e.userId}__${e.contentId}__${JSON.parse(e.payload).session.sessionId}`, e]))));
    const raw = () => JSON.parse(LS.getItem(QUEUE) || '{}');
    const queue = () => Object.values(raw()).filter((e) => e && e.payload).map((e) => `${e.userId}/${e.contentId}`).sort();
    const reset = () => { calls.length = 0; ds.failedSyncs.clear(); ds.settledFailKeys.clear(); ds.pendingSyncs.clear(); ds.lastSyncedPayloads.clear(); ds.expiredNotes = {}; ds.unpersistedKeys?.clear(); ds.acknowledgedExpired?.clear(); LS.setQuota(Infinity); LS.removeItem(QUEUE); };
    const sentTo = (id) => calls.filter(([m, u]) => m === 'POST' && u.includes(`/progress/${id}/`)).length;
    const session = (id) => (id ? LS.setItem('chibalete_user_id', id) : LS.removeItem('chibalete_user_id'));

    section('[N] más de 50 pendientes de una cuenta');
    {
        reset(); session('A'); respond = () => 'network';
        setQueue([entry('B', 'cb', 's-b')]);
        for (let i = 0; i < 120; i++) ds.addToFailedSyncs(`A__c${i}__s${i}`, 'A', `c${i}`, body(`s${i}`, old(0)));
        const q = queue();
        TABLA['120 lecturas pendientes de A · quedan en la cola (antes: 50)'] = q.filter((x) => x.startsWith('A/')).length;
        ok('las 120 lecturas pendientes de A siguen en la cola: ninguna se desalojó por capacidad', q.filter((x) => x.startsWith('A/')).length === 120, String(q.length));
        ok('…incluida la primera (la más antigua, la que antes se perdía)', q.includes('A/c0') && q.includes('A/c119'));
        ok('…y la de la otra cuenta sigue intacta', q.includes('B/cb'));
        const st = ds.pendingSyncStatus('A');
        ok('el estado las cuenta todas y ninguna figura como no guardada', st.count === 120 && st.unsaved === 0, JSON.stringify(st));
        TABLA['tamaño de la cola con 121 lecturas (caracteres) / presupuesto'] = [LS.getItem(QUEUE).length, 1_500_000];
        ok('121 lecturas ocupan una fracción pequeña del presupuesto de la cola (menos del 5 %)', LS.getItem(QUEUE).length < 75_000, String(LS.getItem(QUEUE).length));
        respond = () => ({ status: 200 }); calls.length = 0;
        ds.retryFailedSyncs(); await tick(20);
        ok('al volver la conexión se envían las 120 de A (y ninguna de B) y salen al confirmarse', sentTo('A') === 120 && sentTo('B') === 0 && queue().join() === 'B/cb', `${sentTo('A')} ${sentTo('B')} ${queue().length}`);
    }

    section('[T] cuenta ausente: pendientes de 8, 30 y 60 días');
    {
        reset(); session('B'); respond = () => ({ status: 200 });
        setQueue([entry('A', 'c8', 's-8', old(8)), entry('A', 'c30', 's-30', old(30)), entry('A', 'c60', 's-60', old(60))]);
        ds.retryFailedSyncs(); await tick(10);
        TABLA['A ausente · pendientes de 8/30/60 días conservados (antes: 0)'] = queue().length;
        ok('con otra cuenta usando el equipo, los tres siguen en la cola (antes caducaban al séptimo día)', queue().join() === 'A/c30,A/c60,A/c8', queue().join());
        ok('…no se enviaron con la sesión de B', sentTo('A') === 0);
        ok('…y no queda constancia de caducidad: nada caducó', ds.pendingSyncStatus('A').expired === null && raw().__expired__ === undefined, JSON.stringify(raw().__expired__));
        session(null); calls.length = 0;
        ds.retryFailedSyncs(); await tick(10);
        ok('sin ninguna sesión abierta: los tres siguen y nada se envía', queue().length === 3 && calls.filter(([m]) => m === 'POST').length === 0, queue().join());
        const st = ds.pendingSyncStatus('A');
        ok('a su titular se le puede decir la fecha: 12 meses desde la más antigua (dentro de 305 días)', Math.abs(st.expiresAt - (Date.now() + 305 * DAY)) < 60_000 && ds.pendingRetentionLabel === '12 meses', String(st.expiresAt));
        session('A'); calls.length = 0;
        ds.retryFailedSyncs(); await tick(10);
        ok('A vuelve a los 60 días: sus tres lecturas se envían y salen al confirmarse', sentTo('A') === 3 && queue().length === 0, `${sentTo('A')} ${queue().join()}`);
    }

    section('[X] caducidad a los 12 meses');
    {
        reset(); session('B'); respond = () => ({ status: 200 });
        setQueue([entry('A', 'c1', 's-400', old(400)), entry('A', 'c2', 's-370', old(370)), entry('A', 'c3', 's-300', old(300)), entry('B', 'cb', 's-b-old', old(400))]);
        ds.retryFailedSyncs(); await tick(10);
        ok('lo de A con más de 12 meses caduca; lo de 300 días se conserva', queue().join() === 'A/c3', queue().join());
        ok('lo de la cuenta en sesión (B) no caduca aunque tenga 400 días: se envió', sentTo('B') === 1 && sentTo('A') === 0, `${sentTo('B')} ${sentTo('A')}`);
        const note = raw().__expired__;
        ok('caducar no es entregar: queda una constancia sin contenido (cuántas y cuándo), por titular', note?.A?.count === 2 && !JSON.stringify(note).includes('c1') && note.B === undefined, JSON.stringify(note));
        ok('B no recibe ningún aviso de caducidad', ds.pendingSyncStatus('B').expired === null);
        session('A');
        const st = ds.pendingSyncStatus('A');
        TABLA['A vuelve tras 12 meses · [pendientes, caducadas avisadas]'] = [st.count, st.expired?.count ?? 0];
        ok('A vuelve: se le informa de 2 lecturas eliminadas sin enviarse (no figuran como entregadas)', st.expired?.count === 2 && st.count === 1 && Number.isFinite(st.expired.at), JSON.stringify(st));
        ds.acknowledgeExpiredPending('A');
        ok('al darse por enterada, la constancia se retira del equipo', ds.pendingSyncStatus('A').expired === null && raw().__expired__ === undefined, JSON.stringify(raw().__expired__));
    }

    section('[C] A → B → A: sin sincronización con credenciales ajenas');
    {
        reset(); session('A'); respond = () => 'network';
        ds.addToFailedSyncs('A__c1__s1', 'A', 'c1', body('s1', old(0)));
        session('B'); respond = (u) => ({ status: u.includes('/progress/B/') ? 200 : 401 }); calls.length = 0;
        ds.addToFailedSyncs('B__c2__s2', 'B', 'c2', body('s2', old(0)));
        ds.retryFailedSyncs(); await tick(10);
        ok('con la sesión de B: se envía lo de B y NADA de A', sentTo('B') === 1 && sentTo('A') === 0 && queue().join() === 'A/c1', `${sentTo('B')} ${sentTo('A')} ${queue().join()}`);
        session(null); calls.length = 0; ds.retryFailedSyncs(); await tick(10);
        ok('sin sesión: no se envía nada', calls.filter(([m]) => m === 'POST').length === 0);
        session('A'); respond = () => ({ status: 200 }); calls.length = 0;
        ds.retryFailedSyncs(); await tick(10);
        ok('A vuelve: su lectura se envía y sale de la cola', sentTo('A') === 1 && queue().length === 0);
    }

    section('[D] sincronización tardía, rechazo definitivo y eliminación voluntaria');
    {
        reset(); session('A');
        setQueue([entry('A', 'c1', 's-late', old(200)), entry('A', 'c2', 's-gone', old(200)), entry('A', 'c3', 's-fail', old(200))]);
        respond = (u) => ({ status: u.includes('/c1/') ? 200 : u.includes('/c2/') ? 410 : 500 });
        ds.retryFailedSyncs(); await tick(10);
        ok('200 días después: la confirmada sale, la rechazada de forma definitiva (410) sale, la que falló (500) sigue', queue().join() === 'A/c3', queue().join());
        ok('…y ninguna de las dos que salieron deja constancia de caducidad (no caducaron)', ds.pendingSyncStatus('A').expired === null);
        setQueue([entry('A', 'c3', 's-fail', old(200)), entry('B', 'cb', 's-b', old(3))]);
        ds.failedSyncs.clear(); ds.settledFailKeys.clear();
        ds.purgeLocalDataOf('A');
        ok('eliminación voluntaria de A: se va lo suyo y solo lo suyo', queue().join() === 'B/cb', queue().join());
        session('B'); respond = () => ({ status: 200 }); setQueue([entry('A', 'c9', 's-x', old(400)), entry('B', 'cb', 's-b', old(3))]);
        ds.failedSyncs.clear(); ds.settledFailKeys.clear(); ds.acknowledgedExpired.clear();
        ds.retryFailedSyncs(); await tick(10);
        ds.purgeLocalDataOf('A');
        ok('…y su constancia de caducidad también se elimina con sus datos', raw().__expired__ === undefined && ds.pendingSyncStatus('A').expired === null, JSON.stringify(raw()));
    }

    section('[S] almacenamiento del navegador agotado');
    {
        reset(); session('A'); respond = () => 'network';
        for (let i = 0; i < 3; i++) ds.addToFailedSyncs(`A__c${i}__s${i}`, 'A', `c${i}`, body(`s${i}`, old(0)));
        const saved = LS.getItem(QUEUE);
        LS.setQuota([...LS._m].reduce((a, [, v]) => a + v.length, 0) + 40);   // no cabe ni una lectura más
        ds.addToFailedSyncs('A__c9__s9', 'A', 'c9', body('s9', old(0)));
        ok('lo que ya estaba guardado sigue intacto (nada se desaloja para hacer sitio)', LS.getItem(QUEUE) === saved && queue().join() === 'A/c0,A/c1,A/c2', queue().join());
        const st = ds.pendingSyncStatus('A');
        TABLA['sin espacio · [pendientes, no guardadas en el equipo]'] = [st.count, st.unsaved];
        ok('la nueva NO se da por guardada: el estado dice que 1 de las 4 solo existe en esta página', st.count === 4 && st.unsaved === 1, JSON.stringify(st));
        ok('…y sigue en memoria para enviarse en cuanto haya conexión', ds.failedSyncs.has('A__c9__s9'));
        respond = () => ({ status: 200 }); calls.length = 0;
        ds.retryFailedSyncs(); await tick(20);
        ok('vuelve la conexión: se envían las 4 (también la no guardada) y la cola queda vacía y sin avisos', sentTo('A') === 4 && queue().length === 0 && ds.pendingSyncStatus('A').unsaved === 0, `${sentTo('A')} ${queue().join()} ${JSON.stringify(ds.pendingSyncStatus('A'))}`);
        // Presupuesto propio de la cola (no depende de que el navegador rechace la escritura).
        reset(); session('A'); respond = () => 'network';
        const big = 'x'.repeat(700_000);
        ds.addToFailedSyncs('A__c1__s1', 'A', 'c1', big); ds.addToFailedSyncs('A__c2__s2', 'A', 'c2', big);
        ds.addToFailedSyncs('A__c3__s3', 'A', 'c3', big);
        ok('al superar el presupuesto de la cola (1,5 M de caracteres) lo nuevo queda sin guardar y declarado, sin desalojar lo anterior', queue().join() === 'A/c1,A/c2' && ds.pendingSyncStatus('A').unsaved === 1, `${queue().join()} ${JSON.stringify(ds.pendingSyncStatus('A'))}`);
    }

    section('[A] interfaz y cola del Visor Accesible (estructura)');
    {
        const dsCode = code('services/dataService.ts'), a11y = code('hooks/useA11yAnalytics.ts'), dlg = code('components/LogoutDialog.tsx');
        ok('la cola principal ya no tiene tope por número de entradas ni desaloja por capacidad', !/FAILED_SYNCS_MAX\b(?!_BYTES)/.test(dsCode) && /FAILED_SYNCS_MAX_BYTES = 1_500_000/.test(dsCode));
        ok('plazo de la cuenta ausente: 12 meses, el de Lector Único', /FAILED_SYNCS_TTL_MS = 365 \* 24 \* 60 \* 60 \* 1000/.test(dsCode));
        ok('Visor Accesible: sin tope de 200 eventos ni descarte de los más antiguos (que podían ser de otra cuenta)', !/MAX_QUEUE\b(?!_BYTES)/.test(a11y) && !/events\.slice\(events\.length - /.test(a11y) && /MAX_QUEUE_BYTES = 1_000_000/.test(a11y));
        ok('…si no se pudieron guardar, vuelven al buffer cuando el envío falla (no se dan por guardados)', /const persisted = saveQueue\(/.test(a11y) && /bufferRef\.current\.unshift\(\.\.\.fresh\)/.test(a11y));
        ok('el aviso dice cuándo no queda espacio y cuándo algo caducó sin enviarse, con un «Entendido» que retira la constancia', /data-testid="pending-unsaved"/.test(dlg) && /No queda espacio en este equipo/.test(dlg) && /data-testid="pending-expired-notice"/.test(dlg) && /acknowledgeExpiredPending\(user\.id\)/.test(dlg));
        ok('el plazo se comunica con el valor real («12 meses»), no con una cifra fija en el texto', /dataService\.pendingRetentionLabel/.test(dlg) && !/7 días/.test(dlg));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nPendingQueue65EC4 — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
