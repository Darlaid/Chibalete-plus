/**
 * readingRuntimeSnapshotStore.test.mjs — CRR Fase 2 / persistencia local.
 *
 * Cubre save/load/clear + edge cases (TTL expiry, separación por mode,
 * defensa contra storage faltante).
 *
 *   node utils/__tests__/readingRuntimeSnapshotStore.test.mjs
 */
import { saveSnapshot, loadSnapshot, clearSnapshot } from '../readingRuntimeSnapshotStore.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

function makeStore() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => { map.clear(); },
        get _size() { return map.size; },
        _map: map,
    };
}

section('[1] save/load round-trip');
{
    const store = makeStore();
    globalThis.window = { localStorage: store };
    ok('saveSnapshot true en happy path',
       saveSnapshot({
           mode: 'accessible', userId: 'u1', contentId: 'c1',
           currentIndex: 7, totalIndices: 100, status: 'playing',
       }) === true);
    const s = loadSnapshot('u1', 'c1', 'accessible');
    ok('loadSnapshot devuelve último write',
       s !== null && s.currentIndex === 7 && s.status === 'playing');
    ok('totalIndices preservado',  s?.totalIndices === 100);
    ok('clearSnapshot true',       clearSnapshot('u1', 'c1', 'accessible') === true);
    ok('load tras clear → null',   loadSnapshot('u1', 'c1', 'accessible') === null);
}

section('[2] defensa: sin window → false/null');
{
    delete globalThis.window;
    ok('save sin window → false',   saveSnapshot({ mode: 'accessible', userId: 'u', contentId: 'c', currentIndex: 0, totalIndices: 0, status: 'idle' }) === false);
    ok('load sin window → null',    loadSnapshot('u', 'c', 'accessible') === null);
    ok('clear sin window → false',  clearSnapshot('u', 'c', 'accessible') === false);
}

section('[3] defensa: userId/contentId vacíos → false/null');
{
    globalThis.window = { localStorage: makeStore() };
    ok('save sin userId → false',    saveSnapshot({ mode: 'accessible', userId: '', contentId: 'c', currentIndex: 0, totalIndices: 0, status: 'idle' }) === false);
    ok('save sin contentId → false', saveSnapshot({ mode: 'accessible', userId: 'u', contentId: '', currentIndex: 0, totalIndices: 0, status: 'idle' }) === false);
    ok('load sin userId → null',     loadSnapshot('', 'c', 'accessible') === null);
    ok('clear sin contentId → false', clearSnapshot('u', '', 'accessible') === false);
}

section('[4] separación por mode');
{
    const store = makeStore();
    globalThis.window = { localStorage: store };
    saveSnapshot({ mode: 'accessible', userId: 'u', contentId: 'c', currentIndex: 1, totalIndices: 10, status: 'ready' });
    saveSnapshot({ mode: 'guided',     userId: 'u', contentId: 'c', currentIndex: 5, totalIndices: 10, status: 'playing' });
    ok('coexisten 2 claves (mismo user+content, modes distintos)', store._size === 2);
    ok('accessible recupera index=1', loadSnapshot('u', 'c', 'accessible')?.currentIndex === 1);
    ok('guided recupera index=5',     loadSnapshot('u', 'c', 'guided')?.currentIndex === 5);
    ok('clear de accessible NO afecta guided',
       clearSnapshot('u', 'c', 'accessible') && loadSnapshot('u', 'c', 'guided')?.currentIndex === 5);
}

section('[5] TTL: registro >30 días se descarta al leer');
{
    const store = makeStore();
    globalThis.window = { localStorage: store };
    const ageMs = 31 * 24 * 60 * 60 * 1000;
    const KEY = 'crr_snap__accessible__u__c';
    store.setItem(KEY, JSON.stringify({
        version: 1, mode: 'accessible', userId: 'u', contentId: 'c',
        currentIndex: 9, totalIndices: 10, status: 'paused',
        savedAt: Date.now() - ageMs,
    }));
    ok('payload viejo presente antes',  store._size === 1);
    const got = loadSnapshot('u', 'c', 'accessible');
    ok('load TTL-expired → null',       got === null);
    ok('load TTL-expired LIMPIA el zombie', store._size === 0);
}

section('[6] versión incorrecta se descarta');
{
    const store = makeStore();
    globalThis.window = { localStorage: store };
    const KEY = 'crr_snap__guided__u__c';
    store.setItem(KEY, JSON.stringify({
        version: 99, mode: 'guided', userId: 'u', contentId: 'c',
        currentIndex: 1, totalIndices: 2, status: 'ready',
        savedAt: Date.now(),
    }));
    ok('load con version mismatch → null', loadSnapshot('u', 'c', 'guided') === null);
}

section('[7] JSON corrupto se descarta');
{
    const store = makeStore();
    globalThis.window = { localStorage: store };
    store.setItem('crr_snap__pdf__u__c', '{not valid json}');
    ok('load con JSON inválido → null', loadSnapshot('u', 'c', 'pdf') === null);
}

delete globalThis.window;
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
