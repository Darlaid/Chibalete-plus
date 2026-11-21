/**
 * RevocationUi65C.test.mjs — V9 BI-65C · revocaciones y consistencia de interfaces.
 *
 * Solo presentación: ningún permiso cambia; el servidor sigue autorizando cada petición. Lo que se fija aquí:
 *   H  el gancho de revalidación vuelve a preguntar al recuperar foco/visibilidad/conexión y por intervalo, nunca con la
 *      pestaña oculta ni en ráfaga; la sesión que ya no es la de la pantalla (o que terminó) recarga la página;
 *   L  una revalidación del resumen del grupo no pasa por «cargando», retira lo mostrado si el servidor responde que no
 *      y lo conserva si no hubo respuesta; una respuesta vieja no pisa a la nueva;
 *   T  el texto de «se retiró lo que estabas viendo» no revela qué permiso cambió;
 *   S  un rechazo (401/403) descarta TODAS las copias locales de Aula Viva, no solo la de la ruta rechazada;
 *   P  cada vista del mediador usa la revalidación y descarta respuestas tardías;
 *   X  los cuatro textos de «lectura no atribuible» incluyen la fecha de lectura no verificable.
 *
 *   node pages/__tests__/RevocationUi65C.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65c_'));
const bundle = async (entry, name, extra = {}) => {
    const out = path.join(tmp, name);
    await esbuild.build({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', jsx: 'automatic', ...extra });
    return import(`${pathToFileURL(out).href}?t=${Date.now()}${Math.random()}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

try {
    // ── H — gancho ─────────────────────────────────────────────────────────────────────────────────────────────────
    section('[H] revalidación de una pantalla abierta');
    // React mínimo: el efecto corre al montar y guarda su limpieza. Basta para ejercitar el gancho sin navegador.
    const stub = path.join(tmp, 'react-stub.mjs');
    fs.writeFileSync(stub, `export const useRef = (v) => ({ current: v });
export const useEffect = (fn) => { const c = fn(); if (typeof c === 'function') globalThis.__cleanups.push(c); };
export default { useRef, useEffect };`);
    globalThis.__cleanups = [];
    const R = { cleanups: globalThis.__cleanups };
    const makeTarget = () => { const m = new Map(); return {
        addEventListener: (t, f) => { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(f); },
        removeEventListener: (t, f) => m.get(t)?.delete(f),
        fire: (t) => [...(m.get(t) || [])].forEach((f) => f()), count: () => [...m.values()].reduce((n, s) => n + s.size, 0) }; };
    const realNow = Date.now;
    let now = 1_000_000; Date.now = () => now;
    const win = makeTarget(), doc = makeTarget();
    let intervalFn = null, intervalMs = 0, cleared = 0, reloads = 0;
    const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
        key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m }; };
    Object.assign(win, { setInterval: (f, ms) => { intervalFn = f; intervalMs = ms; return 7; }, clearInterval: () => { cleared++; }, location: { reload: () => { reloads++; } } });
    globalThis.window = win; globalThis.document = Object.assign(doc, { visibilityState: 'visible' });
    globalThis.sessionStorage = store({ chibalete_user_id: 'med-a' }); globalThis.localStorage = store({ chibalete_user_id: 'med-a' });
    const H = await bundle('hooks/useAuthorizationRevalidation.ts', 'hook.mjs', { alias: { react: stub } });

    let calls = 0;
    H.useAuthorizationRevalidation(() => { calls++; });
    ok('se registra en foco, reconexión, vuelta a la página y visibilidad, con un intervalo', win.count() === 3 && doc.count() === 1 && intervalMs === H.REVALIDATE_INTERVAL_MS && intervalMs <= 60_000);
    win.fire('focus');
    ok('recién montada no repite la consulta (la carga inicial acaba de ocurrir)', calls === 0);
    now += H.REVALIDATE_MIN_GAP_MS + 1; win.fire('focus');
    ok('al recuperar el foco vuelve a preguntar', calls === 1);
    doc.fire('visibilitychange'); win.fire('online');
    ok('foco + visibilidad + conexión en ráfaga = una sola consulta', calls === 1);
    now += 10_000; doc.visibilityState = 'hidden'; win.fire('focus'); intervalFn();
    ok('con la pestaña oculta no consulta', calls === 1);
    doc.visibilityState = 'visible'; doc.fire('visibilitychange');
    ok('al volver a ser visible consulta', calls === 2);
    now += 60_000; intervalFn();
    ok('sin interacción, el intervalo consulta', calls === 3);
    now += 10_000; win.fire('online');
    ok('al recuperar la conexión consulta', calls === 4);
    R.cleanups.splice(0).forEach((c) => c());
    ok('al desmontar no queda nada escuchando', win.count() === 0 && doc.count() === 0 && cleared === 1);
    let off = 0; H.useAuthorizationRevalidation(() => { off++; }, false);
    ok('deshabilitada no escucha', win.count() === 0 && doc.count() === 0 && off === 0);

    section('[H] sesión vigente ≠ sesión de la pantalla');
    const me = (status, body) => { globalThis.fetch = async (url) => ({ ok: status >= 200 && status < 300, status, url, json: async () => body }); };
    const fireSession = async () => { now += 61_000; win.fire('focus'); await tick(); await tick(); await tick(); };
    H.useSessionRevalidation({ id: 'med-a', roles: ['mediador'] });
    me(200, { id: 'med-a', roles: ['mediador'] }); await fireSession();
    ok('misma cuenta y mismo rol: no pasa nada', reloads === 0 && sessionStorage.getItem('chibalete_user_id') === 'med-a');
    me(503, {}); await fireSession();
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); }; await fireSession();
    ok('fallo del servidor o sin respuesta: no se concluye nada (no recarga)', reloads === 0);
    me(200, { id: 'med-b', roles: ['mediador'] }); await fireSession();
    ok('otra cuenta en la sesión: recarga y quita el id local para que el arranque pregunte por la sesión vigente', reloads === 1 && sessionStorage.getItem('chibalete_user_id') === null && localStorage.getItem('chibalete_user_id') === null);
    now += 6_000; win.fire('focus'); await tick(); await tick(); await tick();
    ok('…una sola recarga por intervalo (sin bucle)', reloads === 1);
    now += 61_000;
    R.cleanups.splice(0).forEach((c) => c());
    globalThis.sessionStorage = store({ chibalete_user_id: 'med-a' });
    H.useSessionRevalidation({ id: 'med-a', roles: ['mediador'] });
    me(200, { id: 'med-a', roles: ['lector'] }); await fireSession();
    ok('mismo id con otro rol: recarga', reloads === 2);
    R.cleanups.splice(0).forEach((c) => c());
    globalThis.sessionStorage = store({ chibalete_user_id: 'med-a' });
    H.useSessionRevalidation({ id: 'med-a', roles: ['mediador'] });
    me(401, {}); await fireSession();
    ok('sesión terminada (401): recarga', reloads === 3);
    R.cleanups.splice(0).forEach((c) => c());
    H.useSessionRevalidation(null);
    ok('sin cuenta en pantalla no escucha', win.count() === 0);
    Date.now = realNow;

    // ── L — cargador del resumen del grupo ─────────────────────────────────────────────────────────────────────────
    section('[L] resumen del grupo: revalidación silenciosa');
    const { createLatestGroupAnalyticsLoader } = await import(pathToFileURL(path.join(ROOT, 'utils/groupAnalytics.mjs')).href);
    const http = (status) => Object.assign(new Error(`group analytics fetch failed: ${status}`), { status });
    let next = () => Promise.resolve({ groupId: 'g' });
    const loader = createLatestGroupAnalyticsLoader(() => next());
    const st = []; const push = (s) => st.push(s);
    await loader.load('g', push);
    ok('carga normal: loading → ready', JSON.stringify(st.map((s) => s.status)) === '["loading","ready"]');
    await loader.load('g', push, { silent: true });
    ok('revalidación con 200: sin «loading», el resumen se reemplaza', JSON.stringify(st.map((s) => s.status)) === '["loading","ready","ready"]');
    next = () => Promise.reject(new TypeError('Failed to fetch'));
    await loader.load('g', push, { silent: true });
    ok('revalidación sin respuesta: no emite nada (se conserva lo que había)', st.length === 3);
    for (const status of [403, 401, 503]) {
        next = () => Promise.reject(http(status));
        await loader.load('g', push, { silent: true });
        const last = st.at(-1);
        ok(`revalidación con ${status}: error con el código y marca de retirado; ya no hay resumen`, last.status === 'error' && last.httpStatus === status && last.withdrawn === true && !('summary' in last));
    }
    const first = []; next = () => Promise.reject(http(403));
    await createLatestGroupAnalyticsLoader(() => next()).load('g', (s) => first.push(s));
    ok('primera carga con 403: error con código, sin «retirado» (no se estaba mostrando nada)', JSON.stringify(first) === '[{"status":"loading"},{"status":"error","httpStatus":403}]', JSON.stringify(first));
    // Respuesta anterior (200, lenta) que llega después de la revocación ya detectada (403, rápida).
    const late = []; let resolveOld;
    const seqFetch = [() => new Promise((r) => { resolveOld = r; }), () => Promise.reject(http(403))];
    const l2 = createLatestGroupAnalyticsLoader(() => seqFetch.shift()());
    const p1 = l2.load('g', (s) => late.push(s), { silent: true });
    await l2.load('g', (s) => late.push(s), { silent: true });
    resolveOld({ groupId: 'g', readers: [{ userId: 'ra-1' }] }); await p1; await tick();
    ok('una respuesta 200 anterior que llega tarde NO repone lo retirado', JSON.stringify(late.map((s) => s.status)) === '["error"]' && !JSON.stringify(late).includes('ra-1'), JSON.stringify(late));

    // ── T — textos ─────────────────────────────────────────────────────────────────────────────────────────────────
    section('[T] «se retiró lo que estabas viendo»');
    const E = await bundle('utils/institutionalErrors.ts', 'errors.mjs');
    for (const subject of ['reader', 'course', 'group']) {
        const t403 = E.describeAccessWithdrawn(subject, 403), t503 = E.describeAccessWithdrawn(subject, 503), t401 = E.describeAccessWithdrawn(subject, 401);
        ok(`${subject} · 403: dice que dejó de estar disponible y que se retiró de la pantalla`, /dejó de estar disponible para tu cuenta/.test(t403) && /se retiró de la pantalla/.test(t403), t403);
        ok(`${subject} · 403: no revela qué decisión cambió ni muestra códigos`, !/\bA2\b|\bC005\b|compromiso|autorizaci[oó]n del|scope_access_denied/i.test(t403));
        ok(`${subject} · 503: se retiró porque no se puede confirmar; interrupción temporal, no cambio de permisos`, /se retiró de la pantalla/i.test(t503) && /no se puede confirmar/.test(t503) && /no un cambio en tus permisos/.test(t503) && !/dejó de estar disponible/.test(t503), t503);
        ok(`${subject} · 401: se retiró y la sesión terminó`, /Se retiró de la pantalla/.test(t401) && /sesión terminó/.test(t401));
    }

    // ── S — copias locales ─────────────────────────────────────────────────────────────────────────────────────────
    section('[S] un rechazo descarta todas las copias locales de Aula Viva');
    const respond = (map) => { globalThis.fetch = async (url) => { const hit = Object.entries(map).find(([p]) => String(url).endsWith(p)); const [status, body] = hit ? hit[1] : [404, {}];
        return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }; };
    globalThis.window = globalThis; globalThis.localStorage = store(); globalThis.sessionStorage = store({ chibalete_user_id: 'med-a' });
    const Ops = (await bundle('services/aulaVivaOperationalService.ts', 'ops.mjs')).aulaVivaOperationalService;
    const Inst = (await bundle('services/aulaVivaInstitutionalService.ts', 'inst.mjs')).aulaVivaInstitutionalService;
    const QUEUE = [{ user_id: 'ra-1', abandono_risk: 0.8 }];
    respond({ '/students-needing-attention': [200, QUEUE], '/students/ra-1/timeline': [200, { user_id: 'ra-1', risks: [] }], '/institutional/status': [200, { ts: 1, outcomes: { total: 3 } }] });
    await Ops.getAttentionQueue(); await Ops.getStudentTimeline('ra-1'); await Inst.getStatus();
    const keys = () => [...globalThis.localStorage._m.keys()].filter((k) => k.startsWith('chibalete:aulaviva'));
    ok('tres copias guardadas a nombre de la cuenta (dos operativas y una institucional)', keys().length === 3, keys().join());
    respond({ '/students/ra-1/timeline': [503, { error: 'individual_access_unavailable' }] });
    await Ops.getStudentTimeline('ra-1');
    ok('un 503 no descarta copias (interrupción, no rechazo)', keys().length === 3);
    respond({ '/students/ra-1/timeline': [403, { error: 'scope_access_denied' }] });
    const denied = await Ops.getStudentTimeline('ra-1');
    ok('un 403 en el timeline del lector descarta también la cola que lo nombraba y la copia institucional', keys().length === 0, keys().join());
    ok('…y entrega relleno marcado como fallo, sin datos anteriores', Ops && denied.risks.length === 0 && !JSON.stringify(denied).includes('abandono'));
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const offlineQueue = await Ops.getAttentionQueue();
    ok('sin conexión después del rechazo: la cola anterior NO reaparece', Array.isArray(offlineQueue) && offlineQueue.length === 0);
    respond({ '/students-needing-attention': [200, QUEUE], '/institutional/status': [403, { error: 'scope_access_denied' }] });
    await Ops.getAttentionQueue(); await Inst.getStatus();
    ok('un 403 institucional descarta también las copias operativas', keys().length === 0, keys().join());

    // ── P — vistas ─────────────────────────────────────────────────────────────────────────────────────────────────
    section('[P] cada vista del mediador revalida y descarta respuestas tardías');
    const aula = code('pages/AulaViva.tsx'), dash = code('pages/DashboardMediador.tsx'), inf = code('pages/InformeVisor.tsx'), opsPage = code('pages/AulaVivaOperacional.tsx');
    const leo = code('components/aula-viva/LeoMediatorPanel.tsx'), impact = code('components/aula-viva/InterventionImpactPanel.tsx'), spb = code('components/aula-viva/StudentProgressBlock.tsx'), tab = code('components/aula-viva/InstitutionalTab.tsx');
    for (const [name, src] of [['Aula Viva', aula], ['Tablero', dash], ['Informe', inf], ['Centro operativo', opsPage]]) {
        ok(`${name}: revalida la autorización y la sesión`, /useAuthorizationRevalidation\(/.test(src) && /useSessionRevalidation\(user\)/.test(src));
    }
    for (const [name, src] of [['Leo del mediador', leo], ['Impacto', impact], ['Progreso del estudiante', spb], ['Pestaña institucional', tab]]) {
        ok(`${name}: revalida la autorización`, /useAuthorizationRevalidation\(/.test(src));
    }
    ok('Leo e impacto: solo la consulta más reciente pinta', /if \(turn !== seq\.current\) return;/.test(leo) && /if \(turn !== seq\.current\) return;/.test(impact));
    ok('Leo e impacto: sin respuesta en una revalidación se conserva; con rechazo se retira y se explica', /if \(silent && s\.status === 0\) return;/.test(leo) && /describeAccessWithdrawn\('reader', s\.status\)/.test(leo)
        && /if \(turn !== seq\.current \|\| silent\) return;/.test(impact) && /describeAccessWithdrawn\(subject, r\.status\)/.test(impact));
    ok('Leo: un rechazo al abrir una obra vuelve a consultar el resumen (no deja lo anterior)', /if \(r\.status === 401 \|\| r\.status === 403\) \{ refresh\('silent'\); return; \}/.test(leo));
    ok('Aula Viva: diagnóstico con guarda de secuencia', /if \(turn !== diagnosisSeq\.current\) return;/.test(aula));
    ok('Aula Viva: vuelve a pedir grupos y nómina al servidor antes de revisar la selección', /Promise\.all\(\[dataService\.reloadGroups\(\), dataService\.reloadUsers\(\)\]\)\.then\(\(\) => setAuthTick/.test(aula));
    ok('Aula Viva: un curso que ya no está a cargo invalida la selección y se explica', /!mine\.some\(g => g\.id === selectedGroup\)/.test(aula) && /Ya no tienes a tu cargo/.test(aula) && /setSelectedStudent\(null\);\s*setStudents\(\[\]\);/.test(aula) && /data-testid="aula-viva-access-notice"/.test(aula));
    ok('Aula Viva: lector negado ⇒ Leo, impacto y progreso no se pintan', /selectedStudent && !studentDenied && canManageClassroom && !isAdmin && \(/.test(aula) && /selectedStudent && !studentDenied && selectedGroup && groupAnalytics\.status === 'ready'/.test(aula));
    ok('Aula Viva: el estado del lector se revalida sin «cargando» y un rechazo lo retira', /\}, \[selectedStudent, authTick\]\);/.test(aula) && /if \(silent && !status && statusShown\.current\) return;/.test(aula) && /describeAccessWithdrawn\('reader', status\)/.test(aula));
    ok('Aula Viva: sin grupo seleccionado no queda el resumen anterior', /analyticsLoader\.cancel\(\); setGroupAnalytics\(\{ status: 'loading' \}\); return;/.test(aula));
    ok('Tablero: un rechazo retira métricas, anotaciones, efectividad y la anotación abierta', /setInterventions\(\[\]\);\s*setEffectiveness\(null\);\s*setInterventionModal\(null\);/.test(dash));
    ok('Tablero: lo que el servidor ya no entrega no se conserva de una respuesta anterior', /setInterventions\(iv\?\.interventions \?\? \[\]\);\s*setEffectiveness\(eff\);/.test(dash) && /m && !enabled\.has\(m\.student\.userId\) \? null : m/.test(dash));
    ok('Tablero: respuesta tardía descartada y sin respuesta se conserva', /if \(cancelled\) return;/.test(dash) && /if \(silent && !httpFailed && shown\.current\) return;/.test(dash) && /\}, \[courseId, user, authTick\]\);/.test(dash));
    ok('Tablero: anotar sobre un lector ya no autorizado se explica, nunca el código', /describeInstitutionalError\('reader', res\.status, body\.error\)/.test(dash));
    ok('Informe: revalida el mismo informe sin «cargando» y un rechazo lo retira', /\}, \[user, id, type, authTick\]\);/.test(inf) && /describeAccessWithdrawn\('course', withdrawnStatus\)/.test(inf) && /if \(silent && !httpFailed && shown\.current\) return;/.test(inf));
    ok('Centro operativo: guardas de secuencia en cola y en el lector seleccionado', /if \(turn !== refreshSeq\.current\) return;/.test(opsPage) && (opsPage.match(/if \(turn !== selectionSeq\.current\) return;/g) || []).length >= 3);
    ok('Centro operativo: al cambiar de lector no queda nada del anterior', /selectionSeq\.current \+= 1;\s*setRecs\(\[\]\);\s*setTimeline\(null\);/.test(opsPage));
    ok('Centro operativo: una acción rechazada se dice y no marca la recomendación como aplicada', /data-testid="action-error"/.test(opsPage) && /if \(!failed\) setActionError\(actionFailure\(await aulaVivaOperationalService\.acknowledgeRecommendation\(rec\.recommendation_id, true\)\)\);/.test(opsPage));
    ok('Pestaña institucional: guardas de secuencia; otra cohorte no hereda la serie anterior', /if \(turn !== refreshSeq\.current\) return;/.test(tab) && /if \(turn !== trajSeq\.current\) return;/.test(tab) && /setTrajSeries\(\[\]\); setTrajMeta\(\{\}\); setTrajInfo\(\{\}\);/.test(tab));
    ok('ningún texto nuevo nombra A2/C005', ![aula, dash, inf, opsPage, leo, impact, tab, code('hooks/useAuthorizationRevalidation.ts')].some((s) => /\bA2\b|\bC005\b/.test(s)));
    ok('el gancho no guarda nada ni escribe en el servidor', !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(code('hooks/useAuthorizationRevalidation.ts')) && !/setItem\('chibalete_user_id'/.test(code('hooks/useAuthorizationRevalidation.ts')));

    // ── X — textos pedagógicos ─────────────────────────────────────────────────────────────────────────────────────
    section('[X] lectura no atribuible: la fecha de lectura no verificable es una causa declarada');
    const CAUSE = /empezó antes de la asignación, del ingreso al curso o del registro de esas fechas, o la fecha de lectura no pudo verificarse\)/;
    for (const p of ['components/aula-viva/StudentStatusPanel.tsx', 'components/aula-viva/GroupAnalyticsKpis.tsx', 'pages/DashboardMediador.tsx', 'pages/InformeVisor.tsx']) {
        ok(`${p}: incluye la causa y conserva las anteriores`, CAUSE.test(read(p)) && (read(p).match(/la fecha de lectura no pudo verificarse/g) || []).length === 1);
    }
    ok('la causa del estado individual también la declara', /o antes de que se registraran esas fechas; o la fecha de lectura no pudo verificarse\./.test(read('utils/studentStatus.mjs')));
    // Una sola copia de React para el componente y para el pintado: todo va en el mismo paquete.
    const entry = path.join(tmp, 'kpis-entry.tsx');
    fs.writeFileSync(entry, `import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupAnalyticsKpis } from ${JSON.stringify(path.join(ROOT, 'components/aula-viva/GroupAnalyticsKpis.tsx'))};
export const render = (state: any) => renderToStaticMarkup(<GroupAnalyticsKpis state={state} />);`);
    const kout = path.join(tmp, 'kpis.mjs');
    await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: kout, logLevel: 'silent', jsx: 'automatic', nodePaths: [path.join(ROOT, 'node_modules')],
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    const K = await import(pathToFileURL(kout).href);
    const summary = { groupId: 'g', readerCount: 3, reading: { all: { totalEffectiveMs: 0, readersWithActivity: 0, averageEffectiveMsPerReader: 0 }, last28d: { totalEffectiveMs: 0, readersWithActivity: 0, averageEffectiveMsPerReader: 0 } },
        leo: { interactions: 0, readersWithInteractions: 0, averageInteractionsPerReader: 0 }, progress: { readersWithProgress: 0, booksStarted: 0, booksCompleted: 0 }, tasks: { state: 'no_server_source' }, pisa: { state: 'no_server_source' }, readers: [],
        courseAttribution: { readers_with_unverifiable_history: 2, course_has_works: true } };
    const html = K.render({ status: 'ready', summary });
    ok('pintado: nota accesible (role="note") con la causa nueva y sin convertirla en ausencia de lectura', /role="note"[^>]*data-testid="group-unverifiable-history"/.test(html) && /la fecha de lectura no pudo verificarse/.test(html) && /no significa que no hayan leído/.test(html));
    const gone = K.render({ status: 'error', httpStatus: 403, withdrawn: true });
    ok('pintado: resumen retirado ⇒ alerta con la explicación y ninguna cifra', /role="alert"/.test(gone) && /dejó de estar disponible para tu cuenta y se retiró de la pantalla/.test(gone) && !/Tiempo de lectura|Interacción Chatbot/i.test(gone));
    const plain = K.render({ status: 'error' });
    ok('pintado: fallo sin código conserva el texto genérico', /No pudimos cargar la analítica del grupo\./.test(plain));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nRevocationUi65C — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
