/**
 * ActivityBasis65EC4.test.mjs — CHP V9 65E-C4 (Bloque I). Actividad observada ≠ lectura acreditada, en la interfaz.
 *
 * Las vistas de administración muestran actividad observada en las obras del curso (sin comprobar fechas). El servidor
 * la marca y entrega aparte la lectura acreditada (65A). Aquí se comprueba el texto que las pantallas enseñan y que
 * todas las pantallas de administración lo enseñan:
 *   [T] texto: con lectura acreditada disponible, sin registro de procedencia, por colegio, y para la mediación (nada)
 *   [P] pantallas: tablero del curso, informe, resumen de Aula Viva y panel institucional
 *
 *   node pages/__tests__/ActivityBasis65EC4.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65ec4_basis_'));

try {
    const out = path.join(tmp, 'ie.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'utils/institutionalErrors.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    const { describeActivityBasis } = await import(pathToFileURL(out).href);
    const OBSERVED = { kind: 'observed_activity', credited: false, scope: 'course_works', dated: false };

    section('[T] qué dice la nota');
    {
        const a = describeActivityBasis({ activityBasis: OBSERVED, creditedReading: { rule: '65A', available: true, activeStudentCount: 3, readers_with_unattributable_reading: 5 } });
        ok('administración, con lectura acreditada: dice que es actividad observada, que no certifica participación, y da la acreditada (3) y la no atribuible (5)',
            /actividad observada/.test(a) && /No certifican participación del curso/.test(a) && /Lectura acreditada del curso: 3 estudiantes con lectura acreditada; 5 tienen lectura que no puede atribuirse al curso\./.test(a), a);
        const one = describeActivityBasis({ activityBasis: OBSERVED, creditedReading: { available: true, readersWithActivity: 1, readers_with_unattributable_reading: 1 } });
        ok('singular correcto y lectores del resumen de Aula Viva', /1 estudiante con lectura acreditada; 1 tiene lectura que no puede atribuirse/.test(one), one);
        const none = describeActivityBasis({ activityBasis: OBSERVED, creditedReading: { available: true, activeStudentCount: 5, readers_with_unattributable_reading: 0 } });
        ok('sin lectura no atribuible no se inventa la frase', /5 estudiantes con lectura acreditada\.$/.test(none), none);
        const off = describeActivityBasis({ activityBasis: OBSERVED, creditedReading: { available: false, reason: 'provenance_not_recorded' } });
        ok('sin registro de procedencia: lo dice; no presenta la actividad observada como acreditada ni un cero', /no está disponible todavía/.test(off) && !/Lectura acreditada del curso: \d/.test(off), off);
        const school = describeActivityBasis({ activityBasis: OBSERVED, creditedReading: { available: false, reason: 'per_course_only' } });
        ok('agregado del colegio: remite la lectura acreditada a cada curso', /se consulta en cada curso/.test(school), school);
        ok('respuesta de la mediación (sin marca): no hay nota, sus cifras ya son las acreditadas', describeActivityBasis({ summary: {} }) === null && describeActivityBasis(null) === null && describeActivityBasis(undefined) === null);
    }

    section('[P] todas las pantallas de administración la muestran');
    {
        const dash = code('pages/DashboardMediador.tsx'), rep = code('pages/InformeVisor.tsx'), kpis = code('components/aula-viva/GroupAnalyticsKpis.tsx'), adm = code('pages/DashboardAdminLectura.tsx');
        ok('tablero del curso', /data-testid="dashboard-activity-basis"/.test(dash) && /role="note" data-testid="dashboard-activity-basis"/.test(dash) && /describeActivityBasis\(data as ActivityBasisInfo\)/.test(dash));
        ok('informe del curso', /role="note" data-testid="report-activity-basis"/.test(rep) && /describeActivityBasis\(data as ActivityBasisInfo\)/.test(rep));
        ok('resumen de Aula Viva', /role="note" data-testid="group-activity-basis"/.test(kpis) && /describeActivityBasis\(s as ActivityBasisInfo \| null\)/.test(kpis));
        ok('panel institucional (colegios)', /role="note" data-testid="admin-activity-basis"/.test(adm) && /describeActivityBasis\(/.test(adm));
        const srv = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'latin1');
        ok('el servidor marca las tres respuestas de administración en un punto común (curso, resumen, colegio)', (srv.match(/activityBasis = OBSERVED_ACTIVITY_BASIS/g) || []).length === 2 && /activityBasis: OBSERVED_ACTIVITY_BASIS, creditedReading/.test(srv));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nActivityBasis65EC4 — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
