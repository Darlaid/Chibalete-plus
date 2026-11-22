/**
 * DataConsistency65EB.test.mjs — CHP V9 65E-B (Bloque I). Lo que la interfaz dice de los límites de los datos.
 *
 *   [C] cobertura de la actividad conservada: se declara con su fecha solo cuando la memoria rodó
 *   [T] estados visuales: total mínimo (historial lleno), «sin actividad desde…», lectores no atribuibles ≠ cero activos
 * Ningún texto nombra códigos internos.
 *
 *   node pages/__tests__/DataConsistency65EB.test.mjs
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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65eb_'));

try {
    section('[C] cobertura declarada (utils/institutionalErrors.ts real)');
    const out = path.join(tmp, 'ie.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'utils/institutionalErrors.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    const { describeActivityCoverage, SESSION_HISTORY_CAPPED_NOTE } = await import(pathToFileURL(out).href);
    const none = { rolling: false, from: null };
    ok('sin memoria llena no dice nada (ni con datos ausentes)', describeActivityCoverage({ telemetry: none, leo: none }) === null && describeActivityCoverage(undefined) === null && describeActivityCoverage(null) === null && describeActivityCoverage({}) === null);
    const from = Date.UTC(2026, 8, 14, 12);
    const t = describeActivityCoverage({ telemetry: { rolling: true, from }, leo: none }) || '';
    ok('telemetría llena: dice desde qué fecha es completa y que lo anterior ya no entra en el cálculo', /desde el/.test(t) && /2026/.test(t) && /ya no está disponible para este cálculo/.test(t), t);
    ok('…y que una cifra menor no significa menos lectura', /no significa menos lectura/.test(t), t);
    ok('…sin hablar de Leo cuando su registro no está lleno', !/Leo/.test(t), t);
    const l = describeActivityCoverage({ telemetry: none, leo: { rolling: true, from } }) || '';
    ok('registro de Leo lleno: lo dice con su fecha', /interacciones con Leo/.test(l) && /2026/.test(l), l);
    const u = describeActivityCoverage({ telemetry: { rolling: true, from: null }, leo: none }) || '';
    ok('sin fecha conocida no inventa una', !/desde el/.test(u) && /más recientemente/.test(u), u);
    ok('ningún texto nombra códigos internos ni cifras técnicas del almacén', ![t, l, u, SESSION_HISTORY_CAPPED_NOTE].some((x) => /\bA2\b|\bC005\b|50[ .]?000|rolling|analytics_db|events\.db/i.test(x)));
    ok('la nota de total mínimo explica el motivo (últimas 20 sesiones por obra)', /últimas 20 sesiones/.test(SESSION_HISTORY_CAPPED_NOTE) && /puede ser mayor/.test(SESSION_HISTORY_CAPPED_NOTE), SESSION_HISTORY_CAPPED_NOTE);

    section('[T] estados visuales');
    const dash = code('pages/DashboardMediador.tsx'), inf = code('pages/InformeVisor.tsx'), kpis = code('components/aula-viva/GroupAnalyticsKpis.tsx'),
        rowSrc = code('components/aula-viva/StudentRow.tsx'), op = code('pages/AulaVivaOperacional.tsx');
    ok('tablero: muestra la cobertura declarada por el servidor', /data-testid="dashboard-data-coverage"/.test(dash) && /describeActivityCoverage\(data\.dataCoverage\)/.test(dash));
    ok('tablero: con el historial lleno dice «al menos N sesiones» y por qué', /student\.sessionHistoryCapped \? 'al menos ' : ''/.test(dash) && /SESSION_HISTORY_CAPPED_NOTE/.test(dash));
    ok('tablero: sin sesiones y con la memoria rodada dice «sin actividad registrada desde…», no «no ha registrado actividad aún»', /student\.activityKnownSince !== undefined/.test(dash) && /Sin actividad registrada/.test(dash) && /no se interpreta como que nunca haya leído/.test(dash));
    ok('informe: cobertura declarada y total mínimo marcado', /data-testid="report-data-coverage"/.test(inf) && /s\.sessionHistoryCapped \?/.test(inf));
    ok('Aula Viva (grupo): cobertura declarada y cuántos lectores tienen un tiempo mínimo', /data-testid="group-data-coverage"/.test(kpis) && /data-testid="group-session-history-capped"/.test(kpis));
    ok('Aula Viva (fila): el tiempo mínimo se marca (≥) y se explica', /analytics\.sessionHistoryCapped \?/.test(rowSrc) && /data-state="session_history_capped"/.test(rowSrc) && /≥/.test(rowSrc));
    ok('centro operativo: los lectores con lectura no atribuible se dicen aparte de los activos', /readers_with_unattributable_activity/.test(op) && /no cuentan como inactivos/.test(op));
    ok('…y con cero acreditados pero lectura no atribuible no se muestra «0 activos»', /Math\.round\(activeUsersDaily\) === 0 && unattributableCount > 0 \? '—'/.test(op));
    ok('…sin la etiqueta técnica anterior', !/profiles materializados/.test(op));
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e);
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nDataConsistency65EB — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
