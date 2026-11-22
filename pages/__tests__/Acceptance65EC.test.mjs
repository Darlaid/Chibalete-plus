/**
 * Acceptance65EC.test.mjs — CHP V9 65E-C (Bloque I). Lo que la administración ve y lo que NO se le presenta.
 *
 *   [P] el Panel de Administración no muestra indicadores sin fuente de datos (ni estimados, ni al azar, ni escritos a mano)
 *   [O] un curso sin obras asociadas se distingue de un curso sin lectura, también en el agregado por colegio
 *
 *   node pages/__tests__/Acceptance65EC.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 500)), fail++);
const code = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('[P] Panel de Administración: ninguna cifra sin fuente');
const admin = code('pages/AdminDashboard.tsx');
ok('no calcula «estadísticas del colegio» estimadas ni «inteligencia de contenido» en el cliente', !/getSchoolPerformance|getContentInsights/.test(admin));
ok('no presenta tasa de adopción, tiempo promedio ni objetivos de aprendizaje', !/adoptionRate|avgHoursPerStudent|learningObjectives|Objetivos Alcanzados/.test(admin));
ok('no quedan cifras ni tendencias escritas a mano', !/vs mes anterior|\+12%|>4\/8<|<strong>45%<\/strong>|Oportunidad Editorial|Recomendación Pedagógica/.test(admin));
ok('no presenta como «vista global» los datos de un solo colegio', !/Vista Global \(Todos los Colegios\)/.test(admin));
ok('dice qué no tiene fuente de datos y que no se muestran cifras estimadas', /data-testid="admin-impact-no-source"/.test(admin) && /no tienen una fuente de datos del servidor/.test(admin) && /no se presentan cifras estimadas/.test(admin));
ok('lleva a las métricas reales de lectura', /href="#\/admin\/metricas"/.test(admin) && /data-testid="admin-impact-open-metrics"/.test(admin));
ok('lo que sí muestra son recuentos reales (colegios, cursos y clubes)', /\{schools\.length\}/.test(admin) && /\{allGroups\.length\}/.test(admin));
ok('ningún texto nombra códigos internos', !/\bA2\b|\bC005\b/.test(admin.replace(/className="[^"]*"/g, '')));

console.log('[O] curso sin obras asociadas ≠ curso sin lectura');
const metricas = code('pages/DashboardAdminLectura.tsx'), informe = code('pages/InformeVisor.tsx'), dash = code('pages/DashboardMediador.tsx'), kpis = code('components/aula-viva/GroupAnalyticsKpis.tsx');
ok('métricas de administración: estados propios «Sin obras asociadas» y «Sin actividad registrada», antes que «En riesgo»', /if \(c\.hasWorks === false\) return 'noworks';\s*\n\s*if \(c\.activeStudentCount === 0\) return 'noactivity';\s*\n\s*if \(c\.avgComposite < 30\)\s+return 'risk';/.test(metricas) && /noworks: \{ label: 'Sin obras asociadas'/.test(metricas) && /noactivity: \{ label: 'Sin actividad registrada'/.test(metricas));
ok('…ninguno de los dos cuenta como curso «en atención» ni muestra un promedio', /c\.avgComposite < 30 && c\.studentCount > 0 && c\.hasWorks !== false && c\.activeStudentCount !== 0/.test(metricas) && /course\.hasWorks !== false && course\.activeStudentCount !== 0 \? course\.avgComposite : '—'/.test(metricas));
ok('…y un colegio sin lectores activos no muestra nivel ni promedio (dice por qué)', /metrics\.noActivity \? \(/.test(metricas) && /metrics\.noCourseWorks \? 'Sin obras asociadas' : 'Sin actividad registrada'/.test(metricas) && /metrics\.noActivity \? '—' : summary\.avgComposite\.toFixed\(1\)/.test(metricas));
ok('informe por colegio: la fila del curso lo dice', /c\.hasWorks === false && <span[^>]*data-state="no_course_works"/.test(informe) && /no indican falta de lectura/.test(informe));
ok('tablero, informe de curso y Aula Viva conservan su aviso', /data-testid="dashboard-no-course-works"/.test(dash) && /data-testid="report-no-course-works"/.test(informe) && /data-testid="group-no-course-works"/.test(kpis));

ok('Aula Viva dice cuándo se calcularon sus cifras y cada cuánto se actualizan', /data-testid="group-computed-at"/.test(kpis) && /Cifras calculadas a las/.test(kpis) && /como máximo cada 5 minutos/.test(kpis));

console.log('[A] accesibilidad: controles con nombre');
const home = code('pages/Home.tsx');
ok('los botones de periodo del calendario de Inicio tienen nombre accesible', /changeDateRange\('prev'\)\} aria-label="Periodo anterior"/.test(home) && /changeDateRange\('next'\)\} aria-label="Periodo siguiente"/.test(home));

console.log(`\nAcceptance65EC — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
