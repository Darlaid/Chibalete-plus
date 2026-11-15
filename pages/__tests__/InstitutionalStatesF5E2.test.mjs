/**
 * InstitutionalStatesF5E2.test.mjs — V9 F5-E2 · estados institucionales y continuidad de interfaz.
 *
 * Solo presentación: ningún permiso cambia. Lo que se fija aquí:
 *   A  «Ver Detalle» con 403/503 → estado de error con regreso, sin caída de la aplicación.
 *   B  503 de tablero/informe de curso → aviso de indisponibilidad temporal, nunca el código crudo.
 *   C  cero lectores habilitados → nómina / habilitados / sin información consultable, sin diagnósticos.
 *   D  grupo que el CIS no reconoce → mensaje comprensible en vez de `scope_access_denied`.
 *   E  panel administrativo → los 403/503 por colegio se cuentan y se dicen.
 *   CO Centro operativo → una consulta fallida no es «no hay nada»; la copia local es de quien la guardó.
 *
 *   node pages/__tests__/InstitutionalStatesF5E2.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f5e2_'));
const bundle = async (entry, name, extra = {}) => {
    const out = path.join(tmp, name);
    await esbuild.build({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', jsx: 'automatic', ...extra });
    return import(`${pathToFileURL(out).href}?t=${Date.now()}${Math.random()}`);
};
const CODE = /scope_access_denied|individual_access_unavailable|identity_unavailable|identity_not_established/;

try {
    section('[TEXTOS] un código del servidor nunca es lo que lee la persona');
    const E = await bundle('utils/institutionalErrors.ts', 'errors.mjs');
    for (const subject of ['reader', 'course', 'group']) {
        const t503 = E.describeInstitutionalError(subject, 503, 'individual_access_unavailable');
        const t403 = E.describeInstitutionalError(subject, 403, 'scope_access_denied');
        ok(`${subject} · 503 → indisponibilidad temporal, sin código`, /temporal/.test(t503) && !CODE.test(t503) && !/no tienes acceso|no está habilitad/i.test(t503), t503);
        ok(`${subject} · 503 dice que NO es un cambio de permisos (no se confunde con un 403)`, /no un cambio en tus permisos/.test(t503));
        ok(`${subject} · 403 → falta de habilitación o acceso, sin código`, !CODE.test(t403) && /habilitad|acceso/.test(t403) && !/temporal/.test(t403), t403);
        ok(`${subject} · 403 no revela qué decisión falta (ni A2 ni C005)`, !/A2|C005|compromiso|autorizaci[oó]n del/i.test(t403));
        ok(`${subject} · identidad no verificable (503 identity_unavailable) → mismo aviso temporal`, E.describeInstitutionalError(subject, 503, 'identity_unavailable') === t503);
        ok(`${subject} · fallo sin cuerpo → frase genérica, sin «undefined» ni número suelto`, /Inténtalo de nuevo/.test(E.describeInstitutionalError(subject, 500, undefined)));
    }
    ok('una frase del servidor sí se respeta; «Acceso denegado» se explica', E.describeInstitutionalError('course', 404, 'Curso no encontrado') === 'Curso no encontrado'
        && E.describeInstitutionalError('course', 403, 'Acceso denegado') !== 'Acceso denegado');
    ok('isServerErrorCode distingue código de frase', E.isServerErrorCode('scope_access_denied') && E.isServerErrorCode('individual_access_unavailable') && !E.isServerErrorCode('Acceso denegado') && !E.isServerErrorCode(''));

    section('[C] cero lectores habilitados no es un resultado pedagógico');
    const none3 = E.describeNoEligibleReaders(3), none0 = E.describeNoEligibleReaders(0), noneU = E.describeNoEligibleReaders(null);
    ok('distingue nómina (3), habilitados (ninguno) e información consultable (no hay)', /Nómina del curso: 3 estudiantes/.test(none3.roster) && /seguimiento habilitado/.test(none3.title) && /no hay información consultable/.test(none3.body));
    ok('dice expresamente que no describe actividad ni nivel', /no describe la actividad ni el nivel lector/.test(none3.body));
    ok('sin diagnósticos ni cifras inventadas', ![none3, none0, noneU].some((n) => /inferencial|inactiv|bajo|0 estudiantes|0%|Inicial/i.test(`${n.title} ${n.roster} ${n.body}`)));
    ok('curso sin nómina ≠ curso sin habilitados', /sin estudiantes registrados/.test(none0.roster) && /no tiene estudiantes en su nómina/.test(none0.body) && none0.body !== none3.body);
    ok('nómina desconocida → se dice, no se supone cero', /no disponible/.test(noneU.roster));
    ok('cobertura: «6 … · nómina del curso: 7» solo si difieren', E.describeReaderCoverage(6, 7) === '6 lectores con seguimiento habilitado · nómina del curso: 7'
        && E.describeReaderCoverage(6, 6) === '6 lectores con seguimiento habilitado' && E.describeReaderCoverage(1, null) === '1 lector con seguimiento habilitado');

    section('[A] «Ver Detalle»: 403/503 → error con regreso, sin caída');
    const ds = code('services/dataService.ts');
    ok('getStudentStatus no entrega como estado un cuerpo sin forma de StudentStatus', /typeof body\.state !== 'string' \|\| typeof body\.tone !== 'string'/.test(ds) && /describeInstitutionalError\('reader', r\.status, body\.error\)/.test(ds));
    // Render REAL del panel: un único bundle con el componente y react-dom/server (una sola copia de React).
    const panelOut = path.join(tmp, 'panel.mjs');
    await esbuild.build({ stdin: { resolveDir: ROOT, loader: 'ts', contents: `export { StudentStatusPanel } from './components/aula-viva/StudentStatusPanel.tsx'; export { renderToStaticMarkup } from 'react-dom/server'; export { default as React } from 'react';` },
        bundle: true, format: 'esm', platform: 'node', outfile: panelOut, logLevel: 'silent', jsx: 'automatic',
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    const { StudentStatusPanel: Panel, renderToStaticMarkup, React } = await import(pathToFileURL(panelOut).href);
    const html = (props) => renderToStaticMarkup(React.createElement(Panel, props));
    let crashed = null, h403 = '';
    try { h403 = html({ status: { error: 'scope_access_denied', scope_type: 'user', scope_id: 'x' }, loading: false, error: null, onClose: () => {} }); } catch (e) { crashed = e.message; }
    ok('un cuerpo `{ error }` pasado como estado NO hace caer el render', crashed === null, crashed ?? '');
    ok('…y se pinta como error, sin el código ni un diagnóstico inventado', /No se pudo mostrar el estado del estudiante/.test(h403) && !CODE.test(h403) && !/Activo|Atención|Problema/.test(h403), h403.slice(0, 200));
    const hErr = html({ status: null, error: E.describeInstitutionalError('reader', 503, 'individual_access_unavailable'), onClose: () => {} });
    ok('estado de error: explica y ofrece «Volver al listado»', /temporal/.test(hErr) && /Volver al listado/.test(hErr) && /role="alert"/.test(hErr));
    ok('sin `onClose` no pinta un botón que no haría nada', !/Volver al listado/.test(html({ status: null, error: 'x' })));
    const hOk = html({ status: { userId: 'u', name: 'Lectora Sintética', state: 'ACTIVE', tone: 'ok', headline: 'h', message: 'm', cause: 'c', recommendedAction: 'r', lastLoginAt: null, lastReadingEventAt: null, progress: { booksStarted: 1, booksCompleted: 0, percentage: 10 } }, onClose: () => {} });
    ok('un estado válido se sigue pintando igual', /Lectora Sintética/.test(hOk) && !/No se pudo mostrar/.test(hOk));

    section('[B/C/D] tablero, informe y diagnóstico de grupo');
    const dash = code('pages/DashboardMediador.tsx'), inf = code('pages/InformeVisor.tsx');
    ok('tablero: el error del servidor pasa por describeInstitutionalError (no `body.error` crudo)', /describeInstitutionalError\('course', metricsRes\.status, body\.error\)/.test(dash) && !/throw new Error\(body\.error \?\? `Error \$\{metricsRes\.status\}`\)/.test(dash));
    ok('informe: ídem para el curso', /describeInstitutionalError\('course', r\.status, b\.error\)/.test(inf));
    ok('tablero e informe descartan lo cargado antes al fallar (no quedan datos anteriores)', /setData\(null\);\s*throw new Error\(describeInstitutionalError/.test(dash) && /setData\(null\);\s*return r\.json\(\)/.test(inf));
    ok('tablero: con cero habilitados se devuelve el estado propio ANTES de interpretar o pintar alertas', dash.indexOf('summary.studentCount === 0') > 0 && dash.indexOf('summary.studentCount === 0') < dash.indexOf('buildSummaryInterpretation(summary, alerts)') && /describeNoEligibleReaders\(rosterCount\)/.test(dash));
    ok('informe: ídem', /cd && cd\.summary\.studentCount === 0/.test(inf) && /describeNoEligibleReaders\(rosterCount\)/.test(inf));
    ok('la cabecera ya no llama «estudiantes» a los lectores habilitados', /describeReaderCoverage\(summary\.studentCount, rosterCount\)/.test(dash) && !/\{summary\.studentCount\} estudiantes/.test(dash));
    ok('diagnóstico de grupo: 403/503 explicados (el `headline` del servidor se respeta)', /body\?\.summary\?\.headline \|\| describeInstitutionalError\('group', r\.status, body\?\.error\)/.test(ds));

    section('[E] panel administrativo: lo que falta se dice');
    const adm = code('pages/DashboardAdminLectura.tsx');
    ok('cada consulta por colegio conserva su estado HTTP', /status: r\.status, ok: r\.ok/.test(adm));
    ok('los fallos se registran (antes se descartaban en silencio)', /missing\.push\(/.test(adm) && /setUnavailable\(missing\)/.test(adm));
    ok('se distingue «incompleto» de «no disponible» y 403 de 503', /Panel incompleto: faltan las métricas de/.test(adm) && /no están disponibles para esta sesión/.test(adm) && /u\.status === 403/.test(adm) && /u\.status === 503/.test(adm));
    ok('se conserva lo que sí respondió', /metricsMap\[schoolList\[i\]\.schoolId\] = result\.value\.body/.test(adm));

    section('[CO] Centro operativo: consulta fallida ≠ «no hay nada»; la copia local tiene dueño');
    const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
    const boot = async (userId) => {
        globalThis.window = globalThis; globalThis.localStorage = globalThis.localStorage ?? store(); globalThis.sessionStorage = store(userId ? { chibalete_user_id: userId } : {});
        return (await bundle('services/aulaVivaOperationalService.ts', `ops-${Math.random()}.mjs`));
    };
    const respond = (status, body) => { globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }); };
    const offline = () => { globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); }; };
    const QUEUE = [{ user_id: 'ra-1', abandono_risk: 0.8, last_active_at: null, engagement_score: null, top_severity: 'critical', recommendations_count: 1, days_since_active: 5 }];
    globalThis.localStorage = store();

    let S = await boot('med-a');
    respond(200, QUEUE);
    const okRes = await S.aulaVivaOperationalService.getAttentionQueue();
    ok('respuesta correcta: lista tal cual, sin marca de fallo', Array.isArray(okRes) && okRes.length === 1 && !S.fetchMetaOf(okRes).failed && !S.fetchMetaOf(okRes).cached);
    ok('la copia local queda con dueño', JSON.parse(globalThis.localStorage.getItem('chibalete:aulaviva:/students-needing-attention')).owner === 'med-a');

    for (const status of [503, 500]) {
        respond(status, { ok: false, error: 'individual_access_unavailable' });
        const r = await S.aulaVivaOperationalService.getAttentionQueue();
        ok(`${status}: NO se sirve la copia anterior; relleno vacío marcado como fallo`, Array.isArray(r) && r.length === 0 && S.fetchMetaOf(r).failed === true && S.fetchMetaOf(r).status === status && !S.fetchMetaOf(r).cached);
    }
    respond(403, { ok: false, error: 'scope_access_denied' });
    const r403 = await S.aulaVivaOperationalService.getAttentionQueue();
    ok('403: fallo marcado y la copia local se descarta', S.fetchMetaOf(r403).failed === true && S.fetchMetaOf(r403).status === 403 && globalThis.localStorage.getItem('chibalete:aulaviva:/students-needing-attention') === null);

    respond(200, QUEUE); await S.aulaVivaOperationalService.getAttentionQueue();
    offline();
    const cached = await S.aulaVivaOperationalService.getAttentionQueue();
    ok('sin conexión, MISMA cuenta: su copia, marcada como guardada', S.fetchMetaOf(cached).cached === true && !S.fetchMetaOf(cached).failed && cached.length === 1);
    ok('…y una lista sigue siendo una lista (antes se convertía en objeto y `attention.slice` hacía caer la aplicación)', Array.isArray(cached) && typeof cached.slice === 'function' && cached.slice(0, 15)[0].user_id === 'ra-1');
    ok('…`_meta` no se cuela en el contenido', JSON.stringify(cached) === JSON.stringify(QUEUE));

    S = await boot('med-b');                       // otra persona en el mismo navegador
    offline();
    const other = await S.aulaVivaOperationalService.getAttentionQueue();
    ok('sin conexión, OTRA cuenta: no ve la copia de la anterior', Array.isArray(other) && other.length === 0 && S.fetchMetaOf(other).failed === true && !JSON.stringify(other).includes('ra-1'));
    ok('…y esa copia ajena se elimina', globalThis.localStorage.getItem('chibalete:aulaviva:/students-needing-attention') === null);
    globalThis.localStorage.setItem('chibalete:aulaviva:/operational/status', JSON.stringify({ value: { ts: 1, recommendations_summary: { critical: 9, high: 9, moderate: 9, info: 9 }, materializer_ready: { ready: true }, recent_jobs: [], degraded: false }, at: Date.now() }));
    const legacy = await S.aulaVivaOperationalService.getOperationalStatus();
    ok('una copia antigua SIN dueño tampoco se usa', S.fetchMetaOf(legacy).failed === true && legacy.recommendations_summary.critical === 0);
    S = await boot(null);
    respond(200, QUEUE); await S.aulaVivaOperationalService.getAttentionQueue();
    ok('sin cuenta local identificada no se guarda copia', globalThis.localStorage.getItem('chibalete:aulaviva:/students-needing-attention') === null);

    const inst = code('services/aulaVivaInstitutionalService.ts');
    ok('pestaña institucional: misma regla de dueño y sin copia ante 5xx', /owner !== me/.test(inst) && /if \(httpStatus\) return fallback;/.test(inst) && /JSON\.stringify\(\{ value, at: Date\.now\(\), owner \}\)/.test(inst));

    const page = code('pages/AulaVivaOperacional.tsx');
    ok('la página consulta cómo llegó cada resultado', /fetchMetaOf\(status\)/.test(page) && /fetchMetaOf\(attention\)/.test(page) && /fetchMetaOf\(cohort\)/.test(page) && /fetchMetaOf\(recs\)/.test(page));
    ok('lista fallida → «No pudimos consultar esta lista», evaluado ANTES que cualquier vacío', page.indexOf('attentionMeta.failed ? (') > 0 && page.indexOf('attentionMeta.failed ? (') < page.indexOf('Los patrones lectores se mantienen estables'));
    ok('…y dice que eso no significa que no haya lectores que atender', /Esto no significa que no haya lectores que necesiten atención/.test(page));
    ok('«patrones estables» solo con información procesada y sin fallo', /attention\.length === 0 && !materializerReady \?/.test(page) && /const materializerReady = !!status\?\.materializer_ready\?\.ready && !statusMeta\.failed;/.test(page));
    ok('los indicadores no pintan 0 cuando la consulta falló', /attentionMeta\.failed \? '—' : attention\.length/.test(page) && /statusMeta\.failed \? '—' : totalActive/.test(page) && !/sin lectores en riesgo activo/.test(page));
    ok('mediador sin grupos: se dice, no se afirma estabilidad', /No tienes grupos asignados como mediador/.test(page));
    ok('datos guardados → aviso visible con su antigüedad', /Sin respuesta del servidor: se muestran los datos que esta cuenta consultó hace/.test(page));
    ok('A7 intacto: all/global solo bajo isAdmin(user); el mediador pide su grupo', /isAdmin\(user\)\s*\?\s*\['all', 'global'\]/.test(page) && (page.match(/'all', 'global'/g) || []).length === 1 && page.includes("['group', mediated[0]]") && page.includes('getCohortComparison(scope[0], scope[1])'));

    section('[LÍMITES] solo presentación');
    ok('ningún texto nuevo nombra A2/C005 ni decisiones concretas', ![read('utils/institutionalErrors.ts').replace(/\/\*[\s\S]*?\*\//g, ''), page].some((s) => /\bA2\b|\bC005\b/.test(s)));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nInstitutionalStatesF5E2 — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
