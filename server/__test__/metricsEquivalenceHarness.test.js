/**
 * metricsEquivalenceHarness.test.js — CHP-STATS-LEGACY-PERF-01D.
 *
 * Versión CI del harness de equivalencia: mismo mecanismo (dos PROCESOS
 * aislados, flag por entorno, reloj fijo, comparación byte a byte) pero sobre
 * fixtures sintéticas, sin snapshot y sin stores reales.
 *
 * La equivalencia sobre el snapshot completo (647 usuarios) sigue siendo una
 * puerta MANUAL, documentada en el ADR. Lo que se protege aquí es que el
 * mecanismo que la verifica siga funcionando: si alguien rompiera el aislamiento
 * de procesos, el reloj fijo o la comparación, esta prueba lo detecta antes de
 * que nadie vuelva a correr la matriz grande.
 *
 *   node server/__test__/metricsEquivalenceHarness.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.join(HERE, '..', 'metricsService.js');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'equivci_'));
const FIXED_NOW = 1800000000000;

// ── fixture sintética determinista ─────────────────────────────────────────
function buildFixture() {
    const users = [], groups = [], events = [], progressMap = {};
    for (let g = 1; g <= 3; g++) {
        groups.push({ id: `g-${g}`, name: `Grupo ${g}`, school: g === 3 ? 'Colegio Beta' : 'Colegio Alfa',
                      memberIds: [], studentIds: [], teacherId: null });
    }
    for (let i = 1; i <= 15; i++) {
        const id = `u-${i}`;
        users.push({ id, nombre_completo: `Persona ${i}`, roles: ['lector'], organizationId: 'org-1' });
        const gi = i <= 7 ? 0 : (i <= 11 ? 1 : 2);
        groups[gi].studentIds.push(id); groups[gi].memberIds.push(id);
    }
    // Solapamiento: los mismos alumnos en dos grupos del mismo colegio, que es
    // lo que provoca el doble cálculo en computeSchoolMetrics.
    groups[1].studentIds.push('u-1', 'u-2'); groups[1].memberIds.push('u-1', 'u-2');

    let ts = FIXED_NOW - 5_000_000;
    for (let i = 1; i <= 6; i++) {
        const u = `u-${i}`;
        for (let s = 0; s < i; s++) {
            events.push({ userId: u, event: 'session_start',  contentId: `c-${s % 2}`, timestamp: ts++, streak: s });
            events.push({ userId: u, event: 'block_complete', contentId: `c-${s % 2}`, timestamp: ts++, streak: s + 1 });
            events.push({ userId: u, event: 'session_end',    contentId: `c-${s % 2}`, timestamp: ts++, progressPercentage: 30 + s });
        }
        events.push({ userId: u, event: 'session_start', contentId: 'c-huerfano', timestamp: ts++, streak: 0 });
        events.push({ userId: u, event: 'desconocido',   contentId: 'c-0',        timestamp: ts++ });
    }
    let k = 0;
    for (let i = 1; i <= 5; i++) {
        for (let d = 0; d < (i === 3 ? 3 : 1); d++) {
            progressMap[`p-${k++}`] = {
                userId: `u-${i}`, contentId: `c-${d}`,
                canonicalProgress: { globalPercentage: 15 * i + d },
                history: [{ durationSec: 45 * i }],
                updatedAt: new Date(FIXED_NOW - d * 86_400_000).toISOString(),
                isCompleted: i === 5,
            };
        }
    }
    return { users, groups, events, progressMap };
}

const FIX = buildFixture();
fs.writeFileSync(path.join(TMP, 'fixture.json'), JSON.stringify(FIX));

/** Runner: fija el reloj ANTES de importar el servicio y vuelca el resultado. */
const RUNNER = path.join(TMP, 'runner.mjs');
fs.writeFileSync(RUNNER, `
import fs from 'node:fs';
const FIXED = ${FIXED_NOW};
const _r = Date.now; Date.now = () => FIXED;
const FIX = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const m = await import(${JSON.stringify('file://' + SERVICE.replace(/\\\\/g, '/'))});
m.init({ events: FIX.events, groups: FIX.groups, users: FIX.users,
         progress: { progressMap: FIX.progressMap },
         leoMemory: { memoryMap: {} }, leoInteractions: [] });
const out = { flag: process.env.LEGACY_METRICS_REQUEST_CONTEXT ?? null,
              enabled: m.isRequestContextEnabled(), cases: {} };
const run = (id, fn) => { try { out.cases[id] = { v: fn() }; } catch (e) { out.cases[id] = { err: { n: e.name, msg: e.message } }; } };
for (const u of FIX.users) run('U:' + u.id, () => m.computeStudentMetrics(u.id));
for (const g of FIX.groups) run('G:' + g.id, () => m.computeCourseMetrics(g.id));
for (const s of ['Colegio Alfa', 'Colegio Beta']) run('S:' + s, () => m.computeSchoolMetrics(s));
run('MISSING_U', () => m.computeStudentMetrics('no-existe'));
run('MISSING_G', () => m.computeCourseMetrics('no-existe'));
run('MISSING_S', () => m.computeSchoolMetrics('No Existe'));
out.counters = { ...m.metricsContextCounters };
Date.now = _r;
fs.writeFileSync(process.argv[3], JSON.stringify(out));
`);

function runArm(flag) {
    const outFile = path.join(TMP, `out-${flag}-${crypto.randomBytes(4).toString('hex')}.json`);
    const r = spawnSync(process.execPath, [RUNNER, path.join(TMP, 'fixture.json'), outFile], {
        env: { ...process.env, LEGACY_METRICS_REQUEST_CONTEXT: flag, TZ: 'UTC' },
        encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`brazo ${flag} falló: ${(r.stderr || '').slice(-500)}`);
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
}

console.log('metricsEquivalenceHarness — CHP-STATS-LEGACY-PERF-01D');

section('[1] los dos brazos arrancan con el flag correcto');
let off, on;
{
    off = runArm('off');
    on  = runArm('on');
    ok('[1a] brazo off con contexto deshabilitado', off.enabled === false);
    ok('[1b] brazo on con contexto habilitado', on.enabled === true);
    ok('[1c] procesos distintos: el flag no se alterna en el mismo proceso',
        off.flag === 'off' && on.flag === 'on');
}

section('[2] equivalencia byte a byte, sin normalizar nada funcional');
{
    const ids = Object.keys(off.cases);
    let exact = 0; const bad = [];
    for (const id of ids) {
        const a = JSON.stringify(off.cases[id]);
        const b = JSON.stringify(on.cases[id]);
        if (a === b) exact++; else bad.push(id.split(':')[0]);
    }
    ok(`[2a] ${exact}/${ids.length} casos EXACT_MATCH`, exact === ids.length,
        bad.length ? `divergen: ${[...new Set(bad)].join(',')}` : '');
    ok('[2b] computedAt coincide con reloj fijo (no se excluye del contrato)',
        JSON.stringify(off.cases['U:u-1']).includes(String(FIXED_NOW)));
}

section('[3] los errores también son equivalentes');
{
    for (const id of ['MISSING_U', 'MISSING_G', 'MISSING_S']) {
        const a = off.cases[id], b = on.cases[id];
        ok(`[3-${id}] mismo desenlace`, JSON.stringify(a) === JSON.stringify(b));
    }
    ok('[3d] grupo inexistente lanza en ambos', Boolean(off.cases['MISSING_G'].err && on.cases['MISSING_G'].err));
}

section('[4] contadores coherentes con el diseño');
{
    ok('[4a] el brazo off no crea ningún contexto', off.counters.metrics_request_context_created_total === 0);
    ok('[4b] el brazo on crea uno por agregación', on.counters.metrics_request_context_created_total === 5,
        String(on.counters.metrics_request_context_created_total));
    ok('[4c] todos los contextos se liberan',
        on.counters.metrics_request_context_created_total === on.counters.metrics_request_context_disposed_total);
    ok('[4d] la ruta de alumno suelto no usa contexto en ningún brazo',
        off.counters.metrics_legacy_fallback_calls_total > 0 && on.counters.metrics_legacy_fallback_calls_total > 0);
    ok('[4e] el solapamiento produce aciertos de memo', on.counters.metrics_student_memo_hits_total > 0);
}

section('[5] determinismo entre corridas');
{
    const off2 = runArm('off');
    const on2  = runArm('on');
    ok('[5a] brazo off reproducible', JSON.stringify(off.cases) === JSON.stringify(off2.cases));
    ok('[5b] brazo on reproducible', JSON.stringify(on.cases) === JSON.stringify(on2.cases));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nmetricsEquivalenceHarness: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
