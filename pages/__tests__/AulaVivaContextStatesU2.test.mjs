/**
 * AulaVivaContextStatesU2.test.mjs — CHP V9 F7-C2R-U2.
 *
 * Centro operativo con seguimiento contextual: lo que la pantalla dice cuando NO hay indicadores. Un lector sin
 * indicadores del curso no entra en la cola, y eso no puede leerse como «sin riesgo» ni «patrones estables».
 * Estructural (sobre el código fuente): las ramas existen, en el orden correcto y con textos que no afirman nada del
 * lector. El comportamiento de las rutas lo cubre server/__test__/contextualFollowUpHttp.test.mjs.
 *
 *   node pages/__tests__/AulaVivaContextStatesU2.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const code = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c) => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l), fail++);

const page = code('pages/AulaVivaOperacional.tsx');
const service = code('services/aulaVivaOperationalService.ts');
const timeline = code('components/aula-viva/LongitudinalStudentTimeline.tsx');
const at = (s) => page.indexOf(s);

console.log('\n[1] cola de atención');
ok('el servicio declara los recuentos por situación del mediador', /context_overview\?: \{ readers: number; ok: number; no_activity: number; insufficient: number; no_course_works: number; in_attention: number \}/.test(service));
ok('la página los toma del estado y los descarta si esa consulta falló', /const overview = statusMeta\.failed \? null : \(status\?\.context_overview \?\? null\);/.test(page));
ok('sin lectores habilitados: mensaje propio', at('attention_queue_no_enabled_readers') > 0 && /Sin lectores habilitados para el seguimiento individual/.test(page));
ok('lectores sin indicadores: se dice cuántos y por qué', at('attention_queue_context_states') > 0 && /información insuficiente por ahora/.test(page) && /sin actividad en las obras del curso/.test(page) && /en cursos sin obras asociadas/.test(page));
ok('esas ramas van ANTES de «patrones estables»', at('attention_queue_no_enabled_readers') < at('where="attention_queue"\n') && at('attention_queue_context_states') < at('where="attention_queue"\n') && at('where="attention_queue"\n') > 0);
ok('con la cola poblada también se informa de los que quedan fuera', /data-testid="attention-context-states"/.test(page) && /Fuera de esta lista:/.test(page));
ok('ningún texto de estado afirma algo del lector', (page.match(/Esto no describe cómo leen?/g) || []).length >= 3);

console.log('\n[2] lector seleccionado');
ok('recomendaciones vacías sin indicadores: no se dice «patrones estables»', at('recommendations_no_indicators') > 0 && at('recommendations_no_indicators') < at('where="recommendations_for_student"')
    && /timeline\?\.data_state && timeline\.data_state !== 'ok'/.test(page) && /Esto no significa que su lectura sea estable/.test(page));
ok('un timeline que no respondió no se pinta como «sin sesiones»', /const timelineMeta = fetchMetaOf\(timeline\);/.test(page) && at('timeline_failed') > 0 && at('timeline_failed') < at('<LongitudinalStudentTimeline'));
ok('el timeline muestra los riesgos ya resueltos con sus dos fechas', /Riesgos resueltos/.test(timeline) && /typeof r\.resolved_at === 'number'/.test(timeline) && /dejó de observarse/.test(timeline));
ok('el tipo del timeline admite el estado del cálculo contextual', /data_state\?: 'ok' \| 'no_activity' \| 'insufficient' \| 'no_course_works';/.test(service));

console.log('\n[3] agregado del curso (V9 F7-C2R-U3)');
ok('el servicio declara la población medida y la supresión por umbral', /population\?: \{ roster: number; eligible: number \};/.test(service) && /suppressed\?: boolean;/.test(service));
ok('agregado suprimido: se explica el umbral, no «materialización pendiente»', at('cohort_suppressed') > 0 && at('cohort_suppressed') < at('where="cohort_global"') && /cohort\?\.suppressed \?/.test(page));
ok('con agregado visible se dice con cuántos lectores de la nómina se calculó', /data-testid="cohort-population"/.test(page) && /los que tienen seguimiento habilitado/.test(page));

console.log(`\nAulaVivaContextStatesU2 — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
