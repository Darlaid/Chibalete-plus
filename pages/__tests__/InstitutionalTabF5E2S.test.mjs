/**
 * InstitutionalTabF5E2S.test.mjs — V9 F5-E2S · pestaña «Institucional» del Centro operativo.
 *
 * Antes: un 403 se devolvía como relleno sin marca, un 5xx o un fallo de red también, y la pestaña
 * pintaba «0 aprendizajes», «Sin aprendizajes registrados» o «Sin seguimiento pendiente» como si
 * fueran resultados. Solo presentación: no cambia ningún permiso.
 *
 *   200 con resultados · 200 vacío · 403 · 500 · 503 · sin red · cambio de cuenta · copia antigua ·
 *   recuperación · estructura de la pestaña.
 *
 *   node pages/__tests__/InstitutionalTabF5E2S.test.mjs
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
const code = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f5e2s_'));

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] }; };
// Un único bundle: el servicio institucional y las marcas que reutiliza del operativo.
const out = path.join(tmp, 'svc.mjs');
await esbuild.build({ stdin: { resolveDir: ROOT, loader: 'ts', contents: `export { aulaVivaInstitutionalService as I } from './services/aulaVivaInstitutionalService.ts'; export { fetchMetaOf, describeFetchFailure } from './services/aulaVivaOperationalService.ts';` },
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
globalThis.window = globalThis; globalThis.localStorage = store();
const as = (userId) => { globalThis.sessionStorage = store(userId ? { chibalete_user_id: userId } : {}); };
as('med-a');
const { I, fetchMetaOf: meta, describeFetchFailure } = await import(pathToFileURL(out).href);

let calls = 0;
const respond = (status, body) => { globalThis.fetch = async () => { calls++; return { ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'function' ? body() : body), text: async () => JSON.stringify(body) }; }; };
const byPath = (map) => { globalThis.fetch = async (u) => { calls++; const p = String(u).replace('/api/aula-viva/institutional', ''); return { ok: true, status: 200, json: async () => map[p], text: async () => '' }; }; };
const offline = () => { globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); }; };
const K = (p) => `chibalete:aulaviva7:${p}`;
const LEARNINGS = [{ learning_id: 'L1', scope_type: 'all', scope_id: 'global', learning_type: 'strategy_effect', recommendation_hint: 'pista sintética', confidence: 0.7, evidence: { support_count: 6, outcome_distribution: { improved: 4 } }, version: 1, active: 1, created_at: 1, updated_at: 1 }];
const STATUS = { ts: 1, outcomes: { total: 12, by_label: {} }, cohorts: { total_active: 2, total_memberships: 11 }, trajectories: { total: 4 }, learnings: { total_active: 1 }, patterns: { total_active: 3 } };
const FIVE = [['getStatus', '/status'], ['getLearningsGlobal', '/learnings/global'], ['getComparativeStrategies', '/comparative/strategies'], ['getCohortDefinitions', '/cohorts/definitions'], ['getFollowupQueue', '/outcomes/follow-up-queue']];
const five = async () => { const r = {}; for (const [fn] of FIVE) r[fn] = await I[fn](); return r; };

try {
    section('[200] respuesta válida');
    byPath({ '/status': STATUS, '/learnings/global': LEARNINGS, '/comparative/strategies': { strategies: [{ intervention_type: 'x', total: 6 }], vocabulary_class: 'observational', caveat: 'c' }, '/cohorts/definitions': [{ cohort_id: 'C1', cohort_key: 'k' }], '/outcomes/follow-up-queue': [{ intervention_id: 'I1' }] });
    let r = await five();
    ok('con resultados: los datos tal cual, sin marca de fallo ni de copia', r.getStatus.outcomes.total === 12 && r.getLearningsGlobal.length === 1 && Object.values(r).every((v) => !meta(v).failed && !meta(v).cached));
    ok('…las listas siguen siendo listas', Array.isArray(r.getLearningsGlobal) && Array.isArray(r.getCohortDefinitions) && Array.isArray(r.getFollowupQueue));
    ok('…y la copia local queda a nombre de la cuenta', FIVE.every(([, p]) => JSON.parse(globalThis.localStorage.getItem(K(p))).owner === 'med-a'));
    byPath({ '/status': { ...STATUS, outcomes: { total: 0, by_label: {} }, learnings: { total_active: 0 } }, '/learnings/global': [], '/comparative/strategies': { strategies: [], vocabulary_class: 'observational', caveat: 'c' }, '/cohorts/definitions': [], '/outcomes/follow-up-queue': [] });
    r = await five();
    ok('vacío REAL: listas vacías SIN marca de fallo (la pestaña conserva su presentación normal)', r.getLearningsGlobal.length === 0 && r.getFollowupQueue.length === 0 && r.getStatus.outcomes.total === 0 && Object.values(r).every((v) => !meta(v).failed && !meta(v).cached));

    section('[403] negado ≠ vacío ≠ indisponible');
    byPath({ '/status': STATUS, '/learnings/global': LEARNINGS, '/comparative/strategies': { strategies: [], vocabulary_class: 'observational', caveat: 'c' }, '/cohorts/definitions': [], '/outcomes/follow-up-queue': [] });
    await five();                                             // deja copias de med-a
    respond(403, { ok: false, error: 'scope_access_denied', scope_type: 'all', scope_id: 'global' });
    r = await five();
    ok('las cinco consultas llegan marcadas como fallo con estado 403', Object.values(r).every((v) => meta(v).failed === true && meta(v).status === 403 && !meta(v).cached));
    ok('…con la forma de relleno (la pantalla no se rompe), no con datos anteriores', r.getLearningsGlobal.length === 0 && r.getStatus.outcomes.total === 0 && !JSON.stringify(r).includes('pista sintética'));
    ok('…y las copias locales de esas rutas se descartan', FIVE.every(([, p]) => globalThis.localStorage.getItem(K(p)) === null));
    ok('el texto del 403 habla de habilitación, no de interrupción', /no está habilitada para tu cuenta/.test(describeFetchFailure(meta(r.getLearningsGlobal))) && !/temporal|conexión/.test(describeFetchFailure(meta(r.getLearningsGlobal))));
    ok('…y no muestra el código del servidor', !/scope_access_denied/.test(describeFetchFailure(meta(r.getLearningsGlobal))));

    section('[500/503] indisponibilidad temporal');
    byPath({ '/status': STATUS, '/learnings/global': LEARNINGS, '/comparative/strategies': { strategies: [], vocabulary_class: 'observational', caveat: 'c' }, '/cohorts/definitions': [], '/outcomes/follow-up-queue': [] });
    await five();
    for (const status of [500, 503]) {
        respond(status, { ok: false, error: 'individual_access_unavailable' });
        r = await five();
        ok(`${status}: fallo marcado; NO se sirve la copia anterior`, Object.values(r).every((v) => meta(v).failed === true && meta(v).status === status && !meta(v).cached) && r.getLearningsGlobal.length === 0);
        const t = describeFetchFailure(meta(r.getStatus), 'Reintentar');
        ok(`${status}: el texto dice interrupción temporal y nombra el botón de la pestaña`, /interrupción temporal/.test(t) && /«Reintentar»/.test(t) && !/habilitada/.test(t) && !/individual_access_unavailable/.test(t));
    }
    ok('un 5xx no borra la copia de la propia cuenta (sirve si luego falta la conexión)', globalThis.localStorage.getItem(K('/learnings/global')) !== null);

    section('[sin red] la copia es de quien la guardó');
    offline();
    r = await five();
    ok('misma cuenta: su copia, marcada como guardada y no como fallo', Object.values(r).every((v) => meta(v).cached === true && !meta(v).failed) && r.getLearningsGlobal[0].learning_id === 'L1' && r.getStatus.outcomes.total === 12);
    ok('…una lista guardada sigue siendo una lista, sin `_meta` dentro del contenido', Array.isArray(r.getLearningsGlobal) && JSON.stringify(r.getLearningsGlobal) === JSON.stringify(LEARNINGS));
    as('med-b');                                              // otra persona, mismo navegador
    r = await five();
    ok('otra cuenta: no recibe la copia de la anterior; fallo marcado sin estado HTTP', Object.values(r).every((v) => meta(v).failed === true && meta(v).status === 0 && !meta(v).cached) && !JSON.stringify(r).includes('pista sintética') && r.getStatus.outcomes.total === 0);
    ok('…y las copias ajenas se eliminan', FIVE.every(([, p]) => globalThis.localStorage.getItem(K(p)) === null));
    ok('texto sin red: falta de respuesta, ni «no habilitada» ni «interrupción temporal»', /No hubo respuesta del servidor/.test(describeFetchFailure(meta(r.getStatus))) && !/habilitada|temporal/.test(describeFetchFailure(meta(r.getStatus))));
    globalThis.localStorage.setItem(K('/learnings/global'), JSON.stringify({ value: [{ learning_id: 'VIEJA' }], at: Date.now() - 86_400_000 }));
    const old = await I.getLearningsGlobal();
    ok('copia antigua sin dueño (anterior a F5-E2): no se usa y se elimina', old.length === 0 && meta(old).failed === true && globalThis.localStorage.getItem(K('/learnings/global')) === null);
    as(null);
    byPath({ '/learnings/global': LEARNINGS }); await I.getLearningsGlobal();
    ok('sin cuenta local identificada no se guarda copia', globalThis.localStorage.getItem(K('/learnings/global')) === null);

    section('[recuperación]');
    as('med-b'); offline();
    const down = await I.getLearningsGlobal();
    byPath({ '/learnings/global': [] });
    const up = await I.getLearningsGlobal();
    ok('al volver la conexión, la misma llamada entrega el dato real y sin marcas', meta(down).failed === true && Array.isArray(up) && up.length === 0 && !meta(up).failed && !meta(up).cached);

    section('[PESTAÑA] cada bloque mira cómo llegó su dato');
    const tab = code('components/aula-viva/InstitutionalTab.tsx');
    ok('reutiliza las marcas y el texto del Centro operativo (sin otra capa de errores)', /import \{ fetchMetaOf, describeFetchFailure, type FetchMeta \} from '\.\.\/\.\.\/services\/aulaVivaOperationalService';/.test(tab)
        && /import \{ withMeta, type FetchMeta \} from '\.\/aulaVivaOperationalService';/.test(code('services/aulaVivaInstitutionalService.ts')));
    ok('consulta la marca de los cinco resultados y de la trayectoria', ['status', 'learnings', 'comparative', 'cohorts', 'followup'].every((n) => tab.includes(`fetchMetaOf(${n})`)) && /setTrajMeta\(fetchMetaOf\(r\)\)/.test(tab));
    const before = (a, b) => tab.indexOf(a) > 0 && tab.indexOf(a) < tab.indexOf(b);
    ok('aprendizajes: el fallo se evalúa ANTES que «Sin aprendizajes registrados»', before('learningsMeta.failed ? (', 'Sin aprendizajes registrados'));
    ok('comparativa: ANTES que «Sin comparativa disponible aún»', before('comparativeMeta.failed ? (', 'Sin comparativa disponible aún'));
    ok('cohortes: ANTES que «Sin cohortes construidas todavía»', before('cohortsMeta.failed ? (', 'Sin cohortes construidas todavía'));
    ok('seguimiento: ANTES que «Sin seguimiento pendiente»', before('followupMeta.failed ? (', 'Sin seguimiento pendiente'));
    ok('trayectoria: ANTES que «Sin serie temporal»', before('trajMeta.failed ? (', 'Sin serie temporal para'));
    ok('los totales no pintan 0 cuando la consulta falló', /const kpi = \(v: number \| undefined\) => \(statusMeta\.failed \? '—' : v \?\? 0\);/.test(tab) && !/value=\{status\?\.[a-z]+\?\.[a-z_]+ \?\? 0\}/.test(tab));
    ok('los subtítulos no dicen «0 activos» ante un fallo', /m\.failed \? 'no se pudo consultar'/.test(tab) && !/subtitle=\{`\$\{learnings\.length\} activos`\}/.test(tab));
    ok('dice expresamente que el fallo no es ausencia de aprendizajes ni de seguimiento', /Esto no significa que no haya aprendizajes registrados/.test(tab) && /Esto no significa que no haya intervenciones por seguir/.test(tab));
    ok('cada fallo ofrece «Reintentar» (vuelve a consultar: la navegación no queda atrapada)', /<button type="button" onClick=\{refresh\}/.test(tab) && /Reintentar/.test(tab) && /describeFetchFailure\(meta, 'Reintentar'\)/.test(tab));
    ok('datos guardados → aviso visible con su antigüedad', /Sin respuesta del servidor: se muestran los datos que esta cuenta consultó hace/.test(tab));
    ok('los estados vacíos normales siguen en su sitio', ['Sin aprendizajes registrados', 'Sin comparativa disponible aún', 'Sin cohortes construidas todavía', 'Sin seguimiento pendiente'].every((s) => tab.includes(s)));
    ok('ningún texto nombra A2/C005 ni muestra códigos del servidor', !/\bA2\b|\bC005\b|scope_access_denied|individual_access_unavailable/.test(tab));
    ok('se llamó al servidor en cada consulta (nada se resuelve solo con la copia)', calls >= 40, String(calls));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nInstitutionalTabF5E2S — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
