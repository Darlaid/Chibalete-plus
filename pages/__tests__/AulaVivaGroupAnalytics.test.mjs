/**
 * AulaVivaGroupAnalytics.test.mjs — CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1B).
 *
 * Aula Viva conectada a GET /api/groups/:id/analytics-summary:
 *   contrato puro (utils/groupAnalytics.mjs) · cargador «solo la última» ·
 *   render REAL (esbuild + react-dom/server) de los KPIs, competencias,
 *   evolución y la fila de estudiante · estructura de AulaViva/dataService.
 *
 *   A reading >0   B reading 0 real   C Leo 14/80 no redondea a 0   D Leo 0 real
 *   E tareas sin fuente   F PISA sin fuente   G 80 + 10 mediadores → 80
 *   H unión por userId   I loading   J error sin fallback   K cambio rápido
 *   L panel individual intacto   M evolución vacía   N competencias vacías
 *   O pedagogicalStats fuera del camino analítico
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import {
    parseGroupAnalyticsSummary, indexReadersById, lectorOnlyStudents, formatReadingDuration, formatLeoAverage,
    createLatestGroupAnalyticsLoader, hasNoServerSource, GROUP_ANALYTICS_ERROR, EMPTY_TEXT, NO_SERVER_SOURCE,
} from '../../utils/groupAnalytics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const MIN = 60_000;

// ── Fixtures con la forma EXACTA del endpoint (valores de Villas / Nuevo Bosque) ──
const win = (total, readers, n) => ({ totalEffectiveMs: total, readersWithActivity: readers, averageEffectiveMsPerReader: total / n });
const readers = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const VILLAS = {
    groupId: 'g-va', readerCount: 80,
    reading: { all: win(249216008, 26, 80), last28d: win(1531263, 2, 80) },
    leo: { interactions: 14, readersWithInteractions: 5, averageInteractionsPerReader: 14 / 80 },
    progress: { readersWithProgress: 16, booksStarted: 23, booksCompleted: 5 },
    tasks: { state: NO_SERVER_SOURCE }, pisa: { state: NO_SERVER_SOURCE },
    readers: readers(80, i => ({ userId: `lec-${i}`,
        reading: { allEffectiveMs: i === 0 ? 135 * MIN : 0, last28dEffectiveMs: 0 },
        leo: { interactions: i === 0 ? 3 : 0 },
        progress: { booksStarted: i === 0 ? 2 : 0, booksCompleted: 0, averagePercent: i === 0 ? 2 : 0 } })),
};
const NUEVO = {
    ...VILLAS, groupId: 'g-nb',
    reading: { all: win(0, 0, 80), last28d: win(0, 0, 80) },
    leo: { interactions: 0, readersWithInteractions: 0, averageInteractionsPerReader: 0 },
    progress: { readersWithProgress: 0, booksStarted: 0, booksCompleted: 0 },
    readers: readers(80, i => ({ userId: `nb-${i}`, reading: { allEffectiveMs: 0, last28dEffectiveMs: 0 },
        leo: { interactions: 0 }, progress: { booksStarted: 0, booksCompleted: 0, averagePercent: 0 } })),
};

section('[CONTRATO] parse · formato · cero vs sin dato');
{
    ok('parse acepta la forma del endpoint', parseGroupAnalyticsSummary(VILLAS)?.readerCount === 80);
    ok('parse rechaza forma inválida (→ ERROR, nunca ceros)', parseGroupAnalyticsSummary({ groupId: 'x' }) === null
        && parseGroupAnalyticsSummary(null) === null && parseGroupAnalyticsSummary({ ...VILLAS, reading: {} }) === null);
    ok('A 249.216.008 ms / 80 → «52 min»', formatReadingDuration(VILLAS.reading.all.averageEffectiveMsPerReader) === '52 min',
        formatReadingDuration(VILLAS.reading.all.averageEffectiveMsPerReader));
    ok('B 0 real → «0 min»', formatReadingDuration(0) === '0 min');
    ok('formato H h M min', formatReadingDuration(135 * MIN) === '2 h 15 min' && formatReadingDuration(120 * MIN) === '2 h');
    ok('C Leo 14/80 = 0,175 → «0,18» (no se redondea a 0)', formatLeoAverage(14 / 80) === '0,18', formatLeoAverage(14 / 80));
    ok('D Leo 0 real → «0»', formatLeoAverage(0) === '0');
    ok('E/F tareas y PISA sin fuente ≠ cero', hasNoServerSource(VILLAS.tasks) && hasNoServerSource(VILLAS.pisa) && !hasNoServerSource({ state: 'ok' }));

    const med = (i) => ({ id: `m-${i}`, roles: ['mediador'] });
    const lec = (i) => ({ id: `l-${i}`, roles: ['lector'] });
    const members = [...Array.from({ length: 80 }, (_, i) => lec(i)), ...Array.from({ length: 10 }, (_, i) => med(i)),
        { id: 'adm', roles: ['administrador'] }, { id: 'prof', roles: ['lector'] }];
    const grp = { mediatorIds: Array.from({ length: 10 }, (_, i) => `m-${i}`), teacherId: 'prof' };
    const visible = lectorOnlyStudents(members, grp);
    ok('G 80 lectores + 10 mediadores (+ admin, + teacherId) → 80', visible.length === 80 && visible.every(u => u.id.startsWith('l-')), String(visible.length));
    const idx = indexReadersById(VILLAS);
    ok('H unión por userId', idx.get('lec-0')?.leo.interactions === 3 && idx.get('lec-5')?.reading.allEffectiveMs === 0 && !idx.has('m-0'));
}

section('[CARGADOR] loading · ready · error · cambio rápido de grupo');
{
    const pending = new Map();
    const signals = new Map();
    const fetcher = (gid, signal) => new Promise((resolve, reject) => { pending.set(gid, { resolve, reject }); signals.set(gid, signal); });
    const loader = createLatestGroupAnalyticsLoader(fetcher);
    const states = [];
    loader.load('g-va', s => states.push(['va', s.status]));
    ok('I primer estado: loading', states.at(-1)?.[1] === 'loading');
    loader.load('g-nb', s => states.push(['nb', s.status]));
    ok('K el cambio aborta la petición anterior', signals.get('g-va').aborted === true && signals.get('g-nb').aborted === false);
    pending.get('g-nb').resolve(NUEVO);
    await new Promise(r => setTimeout(r, 0));
    pending.get('g-va').resolve(VILLAS);           // respuesta vieja que llega tarde
    pending.get('g-va').reject?.(new Error('x'));
    await new Promise(r => setTimeout(r, 0));
    ok('K la respuesta vieja NO sobrescribe el grupo nuevo', JSON.stringify(states) === '[["va","loading"],["nb","loading"],["nb","ready"]]', JSON.stringify(states));

    const s2 = [];
    const l2 = createLatestGroupAnalyticsLoader(() => Promise.reject(new Error('500')));
    await l2.load('g', s => s2.push(s));
    ok('J fallo → { status: error } sin datos', JSON.stringify(s2) === '[{"status":"loading"},{"status":"error"}]', JSON.stringify(s2));
    const s3 = [];
    const l3 = createLatestGroupAnalyticsLoader((g, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')))));
    const p3 = l3.load('g', s => s3.push(s.status)); l3.cancel(); await p3;
    ok('un abort no se reporta como error', JSON.stringify(s3) === '["loading"]', JSON.stringify(s3));
}

// ── Render real de los componentes ─────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-aulaviva-'));
const fwd = (p) => JSON.stringify(p.replace(/\\/g, '/'));
const entry = path.join(tmp, 'entry.mjs');
fs.writeFileSync(entry, `
export { GroupAnalyticsKpis, GroupPisaCompetencies, GroupEvolutionPanel } from ${fwd(path.join(ROOT, 'components', 'aula-viva', 'GroupAnalyticsKpis.tsx'))};
export { StudentRow } from ${fwd(path.join(ROOT, 'components', 'aula-viva', 'StudentRow.tsx'))};
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
`);
const bundle = path.join(tmp, 'bundle.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'node_modules')], jsx: 'automatic',
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
const UI = await import(pathToFileURL(bundle).href);
const html = (C, props) => UI.renderToStaticMarkup(UI.createElement(C, props));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

section('[RENDER] KPIs del grupo');
{
    const va = text(html(UI.GroupAnalyticsKpis, { state: { status: 'ready', summary: VILLAS } }));
    ok('A Villas: tiempo «52 min»', va.includes('52 min'), va);
    ok('C Villas: Leo «0,18» con subtítulo de interacciones', va.includes('0,18') && va.includes('Promedio interacciones/alumno') && !va.includes('preguntas'), va);
    ok('E «Sin tareas asignadas» (sin «0%»)', va.includes(EMPTY_TEXT.tasks) && !/\b0 ?%/.test(va), va);
    ok('F «Sin evaluaciones PISA» sin Bajo/Medio/Alto', va.includes(EMPTY_TEXT.pisa) && !/Bajo|Medio|Alto/.test(va), va);
    const nb = text(html(UI.GroupAnalyticsKpis, { state: { status: 'ready', summary: NUEVO } }));
    ok('B/D Nuevo Bosque: «0 min» y Leo «0» reales', nb.includes('0 min') && / 0 /.test(nb), nb);
    ok('E/F Nuevo Bosque: tareas y PISA siguen sin fuente (no 0 %)', nb.includes(EMPTY_TEXT.tasks) && nb.includes(EMPTY_TEXT.pisa) && !/%/.test(nb), nb);
    const ld = html(UI.GroupAnalyticsKpis, { state: { status: 'loading' } });
    ok('I loading: aria-busy y ningún número', ld.includes('aria-busy="true"') && !/\d+ min|0,|\d%/.test(text(ld)), text(ld));
    const er = html(UI.GroupAnalyticsKpis, { state: { status: 'error' } });
    ok('J error: mensaje con role=alert y SIN ceros', er.includes('role="alert"') && text(er).includes(GROUP_ANALYTICS_ERROR) && !/\d/.test(text(er)), text(er));
}

section('[RENDER] competencias PISA y evolución');
{
    const c = text(html(UI.GroupPisaCompetencies, { state: { status: 'ready', summary: VILLAS } }));
    ok('N un único estado neutral, sin 0 %', c.includes(EMPTY_TEXT.pisaCompetencies) && !/%/.test(c)
        && !/Literal|Inferencial|Crítica/.test(c), c);
    ok('N error → mensaje, no ceros', text(html(UI.GroupPisaCompetencies, { state: { status: 'error' } })).includes(GROUP_ANALYTICS_ERROR));
    const e = html(UI.GroupEvolutionPanel, {});
    ok('M evolución: «Sin datos históricos», sin gráfica', text(e).includes(EMPTY_TEXT.evolution) && !/style=/.test(e), e);
}

section('[RENDER] fila de estudiante');
{
    const student = { id: 'lec-0', nombre_completo: 'Estudiante', nombre_usuario: 'e', avatar_url: '/avatar.png' };
    const row = (analytics) => text(UI.renderToStaticMarkup(UI.createElement('table', null,
        UI.createElement('tbody', null, UI.createElement(UI.StudentRow, { student, analytics, onSelect: () => {} })))));
    const r = row(indexReadersById(VILLAS).get('lec-0'));
    ok('libros = booksStarted (2) · tiempo «2 h 15 min» · Leo 3 entero', /Estudiante 2 2 h 15 min 3 /.test(r), r);
    ok('tareas y PISA → «—», nunca 0 %', (r.match(/—/g) || []).length === 2 && !/%/.test(r), r);
    const z = row(indexReadersById(NUEVO).get('nb-0'));
    ok('cero real → «0», «0 min», «0»', /Estudiante 0 0 min 0 /.test(z), z);
    const none = row(undefined);
    ok('sin analítica (carga/error) → «—» en todo, sin ceros', !/\d/.test(none) && (none.match(/—/g) || []).length === 5, none);
}

section('[ESTRUCTURA] AulaViva / dataService');
{
    const src = fs.readFileSync(path.join(ROOT, 'pages', 'AulaViva.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok('O ninguna llamada a getPedagogicalStats / getGroupDistribution / getGroupEvolution',
        !/getPedagogicalStats|getGroupDistribution|getGroupEvolution/.test(code));
    ok('O sin CompetencyBar/DistributionChart/TrendChart alimentados por mock', !/CompetencyBar|DistributionChart|TrendChart/.test(code));
    ok('una sola fuente: el cargador «solo la última» sobre getGroupAnalyticsSummary',
        (code.match(/getGroupAnalyticsSummary\(/g) || []).length === 1 && /createLatestGroupAnalyticsLoader\(/.test(code));
    ok('K una carga por cambio de grupo (deps: grupo, permiso, cargador) y cancelación al desmontar',
        /analyticsLoader\.load\(selectedGroup, setGroupAnalytics\)/.test(code)
        && /\}, \[selectedGroup, canManageClassroom, analyticsLoader\]\);/.test(code) && /return \(\) => analyticsLoader\.cancel\(\);/.test(code));
    ok('tabla: StudentRow recibe readers[] por userId', /analytics=\{readerAnalytics\?\.get\(student\.id\)\}/.test(code));
    ok('tabla: columna «Tiempo de Lectura» (no Sem/Día)', code.includes('>Tiempo de Lectura<') && !code.includes('Sem/Día'));
    ok('L panel individual intacto (StudentStatusPanel + getStudentStatus)', /<StudentStatusPanel/.test(code) && /dataService\.getStudentStatus\(selectedStudent\.id\)/.test(code));
    let panelDiff = 'x';
    try { panelDiff = execFileSync('git', ['diff', 'HEAD', '--', 'components/aula-viva/StudentStatusPanel.tsx'], { cwd: ROOT, encoding: 'utf8' }); } catch { /* sin git */ }
    ok('L StudentStatusPanel.tsx sin cambios', panelDiff === '', panelDiff.slice(0, 200));

    const ds = fs.readFileSync(path.join(ROOT, 'services', 'dataService.ts'), 'utf8');
    const i = ds.indexOf('    getGroupStudents(groupId: string)');
    ok('G getGroupStudents filtra con lectorOnlyStudents', /return lectorOnlyStudents\(members, group\);/.test(ds.slice(i, ds.indexOf('\n    }', i) + 6)));
    const j = ds.indexOf('    async getGroupAnalyticsSummary(');
    const m = ds.slice(j, ds.indexOf('\n    }', j));
    ok('J getGroupAnalyticsSummary lanza ante fallo; sin fallback a pedagogicalStats/localStorage',
        j > 0 && /throw/.test(m) && !/pedagogicalStats|persistenceService|localStorage/.test(m));
    for (const f of ['GroupAnalyticsKpis.tsx', 'StudentRow.tsx']) {
        const c = fs.readFileSync(path.join(ROOT, 'components', 'aula-viva', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        ok(`O ${f} no toca PedagogicalStats`, !/PedagogicalStats|pedagogicalStats/.test(c));
    }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\nCHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1B front) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
