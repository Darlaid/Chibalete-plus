/**
 * CollectiveUiU3D.test.mjs — CHP V9 F7-C2R-U3D.
 *
 * Analítica colectiva en la experiencia de mediación (pestaña Institucional y analítica del curso):
 *   [1] comportamiento de los textos colectivos de `utils/pedagogicalStates.ts` (ejecutado): nombres de cohortes y de
 *       señales para docentes, estados de la evidencia y agregados retenidos por el umbral de divulgación;
 *   [2] estructura de la pestaña Institucional: consume las rutas existentes, muestra población y estados, no enseña
 *       claves técnicas ni nombres de banderas de configuración, y no afirma nada con agregados retenidos;
 *   [3] aprendizajes del curso junto al impacto del curso.
 * Las cifras, la delimitación institucional y la autorización se prueban en server/__test__/collectiveContextHttp.test.mjs.
 *
 *   node pages/__tests__/CollectiveUiU3D.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 300)), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_u3d_ui_'));
try {
    const out = path.join(tmp, 'states.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'utils', 'pedagogicalStates.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    const S = await import(pathToFileURL(out).href);

    console.log('\n[1] textos colectivos');
    const names = [['group', 'g-a'], ['club', 'c-1'], ['habit', 'high_continuity'], ['trajectory', 'recovered_after_risk'], ['modality', 'audio_plus_immersive'], ['intervention', 'lectura_guiada'], ['risk', 'abandono_alto']]
        .map(([cohort_type, scope_id]) => S.cohortLabel({ cohort_type, scope_id }, (id) => (id === 'g-a' ? 'Quinto A' : undefined)));
    ok('cada tipo de cohorte tiene nombre para docentes; la clave técnica nunca se muestra', names.every((n) => n.length > 5 && !/[a-z]+_[a-z]+|:[a-z]/.test(n)) && new Set(names).size === names.length, names.join(' | '));
    ok('el curso se nombra por su nombre, no por su identificador', names[0] === 'Curso: Quinto A' && !/g-a/.test(names[0]));
    ok('una señal se nombra como en las recomendaciones individuales', S.ruleLabel('abandono_alto') === 'Patrón de abandono temprano' && !/_/.test(S.ruleLabel('regla_nueva')));
    ok('con lectores con indicadores no hay aviso', S.describeCollectiveState('ok') === null && S.describeCollectiveState(undefined) === null);
    const st = [S.describeCollectiveState('no_eligible_readers'), S.describeCollectiveState('no_course_works'), S.describeCollectiveState('insufficient', 'provenance_not_recorded'),
        S.describeCollectiveState('insufficient', 'unverifiable_history'), S.describeCollectiveState('no_activity'), S.describeCollectiveState('insufficient', 'few_signals')];
    ok('seis estados distintos, cada uno con título y explicación', new Set(st.map((x) => x.kind)).size === 6 && st.every((x) => x.title.length > 5 && x.body.length > 40));
    ok('se nombran «registro contextual todavía no habilitado», «curso sin obras» y «sin lectores con seguimiento habilitado»', /Registro contextual todavía no habilitado/.test(st[2].title) && /sin obras/.test(st[1].title) && /seguimiento habilitado/.test(st[0].title));
    ok('ningún estado afirma que el grupo no lee ni muestra un código', st.every((x) => !/[a-z]+_[a-z_]+/.test(x.title + x.body) && !/no leen nada|sin leer/i.test(x.body)) && st.slice(0, 4).every((x) => /(no|ni) (significa|describe|se interpreta)/i.test(x.body)));
    ok('un agregado retenido se explica (cuántos lectores, mínimo) y no se lee como falta de actividad', /2 lectores/.test(S.describeSuppressed(5, 2)) && /al menos 5/.test(S.describeSuppressed(5, 2)) && /No significa que no haya actividad/.test(S.describeSuppressed(5)));
    const hint = S.learningHintText('En el scope group:g-a, después de la intervención "acompanamiento" se observó mejora observada en 1 de 5 casos (20%). NO implica causalidad — refleja patrones observados.', 'group');
    ok('la indicación de un aprendizaje pierde la etiqueta técnica del ámbito y conserva la advertencia', /^En este curso,/.test(hint) && /«Acompañamiento»/.test(hint) && !/scope|g-a|acompanamiento/.test(hint) && /NO implica causalidad/.test(hint));
    ok('…y la de la administración (ámbito global) no se toca', S.learningHintText('En el scope all:global, texto.', 'all') === 'En el scope all:global, texto.');

    console.log('\n[2] pestaña Institucional');
    const tab = code('components/aula-viva/InstitutionalTab.tsx'), svc = code('services/aulaVivaInstitutionalService.ts');
    ok('consume las rutas existentes de cohortes, trayectoria y patrones', /getCohortDefinitions\(\)/.test(tab) && /getCohortTrajectory\(cohort\.cohort_id\)/.test(tab) && /getPatternsRecent\(\)/.test(tab)
        && /'\/patterns\/recent'/.test(svc) && /\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/trajectory/.test(svc));
    ok('el servicio acepta la lista de la administración y el objeto de quien media', /Array\.isArray\(r\) \? \{ patterns: r \} : r/.test(svc));
    ok('las cohortes se listan por su nombre para docentes', /\{cohortName\(c\)\}/.test(tab) && !/\{c\.cohort_key\}/.test(tab) && !/trajCohort\.cohort_key/.test(tab));
    ok('ninguna pantalla nombra banderas de configuración', !/AULA_VIVA_[A-Z_]+/.test(tab));
    ok('la trayectoria declara su estado antes de pintar nada', tab.indexOf('data-testid="trajectory-state"') > 0 && tab.indexOf('data-testid="trajectory-state"') < tab.indexOf('data-testid="trajectory-latest"'));
    ok('una cohorte bajo el umbral no muestra serie: se explica', /data-testid="trajectory-suppressed"/.test(tab) && /describeSuppressed\(/.test(tab) && tab.indexOf('data-testid="trajectory-suppressed"') < tab.indexOf('data-testid="trajectory-latest"'));
    ok('la trayectoria declara la población, la muestra del último corte y los cortes retenidos', /data-testid="trajectory-population"/.test(tab) && /con seguimiento habilitado/.test(tab) && /suppressed_points/.test(tab) && /sample_size/.test(tab));
    ok('el último corte se lee sin gráfico, y un valor ausente es «sin dato»', /data-testid="trajectory-latest"/.test(tab) && /: 'sin dato'/.test(tab) && /sin corte anterior comparable/.test(tab));
    ok('sección «Patrones observados» con su estado, su población y su advertencia', /title="Patrones observados"/.test(tab) && /data-testid="patterns-state"/.test(tab) && /no predice nada sobre ningún lector/.test(tab) && /patterns\.population/.test(tab));
    ok('sin patrones: distingue «bajo el mínimo» de «nada observado»', /withheld_below_support/.test(tab) && /ninguna reúne todavía el mínimo/.test(tab) && /No se han observado señales repetidas/.test(tab));
    ok('un fallo de consulta no se lee como «sin patrones»', /where="observed_patterns_failed"/.test(tab) && /Esto no significa que no haya patrones/.test(tab));
    ok('tabla de patrones accesible, con la señal por su nombre', /<th scope="col" className="py-1">Señal observada<\/th>/.test(tab) && /<th scope="row"[^>]*>\{ruleLabel\(p\.observed_outcome\)\}/.test(tab));
    ok('estados anunciados a tecnologías de asistencia', (tab.match(/role="status"/g) || []).length >= 5);

    console.log('\n[3] aprendizajes del curso');
    const impact = code('components/aula-viva/InterventionImpactPanel.tsx'), card = code('components/aula-viva/InstitutionalLearningCard.tsx');
    ok('el impacto del curso consulta los aprendizajes de ESE curso por la ruta existente', /\/api\/aula-viva\/institutional\/learnings\/scope\/group\/\$\{encodeURIComponent\(scope\.id\)\}/.test(impact) && /if \(isGroup\) \{/.test(impact));
    ok('se muestran con la tarjeta existente', /<InstitutionalLearningCard key=\{l\.learning_id\} learning=\{l\} \/>/.test(impact));
    ok('sin aprendizajes se explica el mínimo; un fallo no se lee como «no hay»', /Todavía no hay aprendizajes/.test(impact) && /No significa que las estrategias no funcionen/.test(impact) && /No se pudieron consultar los aprendizajes del curso/.test(impact));
    ok('la tarjeta usa el texto sin etiqueta técnica y el nombre de la estrategia', /learningHintText\(learning\.recommendation_hint, learning\.scope_type\)/.test(card) && /interventionLabel\(intervention\)/.test(card));
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nCollectiveUiU3D — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
