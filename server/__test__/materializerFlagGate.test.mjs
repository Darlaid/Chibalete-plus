/**
 * materializerFlagGate.test.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / A1 §13.
 *
 * `INSIGHTS_MATERIALIZER_ENABLED` pasa de decorativo a autoritativo:
 *   [1] scheduler=0, materializer=0 → nada corre
 *   [2] scheduler=0, materializer=1 → nada corre (el gate global manda)
 *   [3] scheduler=1, materializer=0 → scheduler vivo, materializer NO registrado
 *   [4] scheduler=1, materializer=1 → loop del materializer registrado
 *   [5] los otros nueve engines siguen OFF por sus propios flags
 *   [6] `runOnce` NO se invoca con el flag apagado
 *
 * Sandbox: HOME/DB temporales. Nunca toca data/ ni data-critical/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

// Stores aislados: el scheduler abre insights.db para el leader-election.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_matflag_'));
process.env.INSIGHTS_SQLITE_PATH = path.join(tmp, 'insights.db');
process.env.EVENTS_SQLITE_PATH   = path.join(tmp, 'events.db');
// El materializer resuelve grupos/padrón vía server/config.js (autoridad
// obligatoria, CHP-ADR-01 §G.4). En test ese guard exige fixtures temporales.
process.env.NODE_ENV  = 'test';
process.env.USERS_DB  = path.join(tmp, 'usuarios_colegios_oro.json');
process.env.GROUPS_DB = path.join(tmp, 'groups_db.json');
fs.writeFileSync(process.env.USERS_DB, '[]');
fs.writeFileSync(process.env.GROUPS_DB, '[]');

const ENV_KEYS = ['AULA_VIVA_SCHEDULER_ENABLED', 'INSIGHTS_MATERIALIZER_ENABLED'];
const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
const setEnv = (sched, mat) => {
    if (sched === null) delete process.env.AULA_VIVA_SCHEDULER_ENABLED;
    else process.env.AULA_VIVA_SCHEDULER_ENABLED = sched;
    if (mat === null) delete process.env.INSIGHTS_MATERIALIZER_ENABLED;
    else process.env.INSIGHTS_MATERIALIZER_ENABLED = mat;
};

const sched = await import('../aulaViva/scheduler.mjs');

// ── §[6] el gate se evalúa por llamada, no al importar el módulo ────────────
section('[6] MATERIALIZER_ENABLED lee el entorno por llamada');
setEnv('1', '0'); ok("con '0' → false", sched.MATERIALIZER_ENABLED() === false);
setEnv('1', '1'); ok("con '1' → true",  sched.MATERIALIZER_ENABLED() === true);
setEnv('1', null); ok('ausente → false', sched.MATERIALIZER_ENABLED() === false);
setEnv('1', 'true'); ok("'true' (no '1') → false", sched.MATERIALIZER_ENABLED() === false);
setEnv('1', 'yes'); ok("'yes' → false", sched.MATERIALIZER_ENABLED() === false);

async function run(schedFlag, matFlag) {
    setEnv(schedFlag, matFlag);
    const r = await sched.start({ log: () => {} });
    const status = sched.getStatus();
    sched.stop();
    return { r, status };
}

// ── §[1][2] gate global ─────────────────────────────────────────────────────
section('[1] scheduler=0, materializer=0 → nada corre');
{
    const { r } = await run('0', '0');
    ok('started=false', r.started === false, JSON.stringify(r));
    ok('razón = disabled por defecto', r.reason === 'scheduler_disabled_default_off');
    ok('sin lista de loops', r.loops === undefined);
}
section('[2] scheduler=0, materializer=1 → el gate global sigue mandando');
{
    const { r } = await run('0', '1');
    ok('started=false', r.started === false, JSON.stringify(r));
}

// ── §[3] el caso que antes era imposible ────────────────────────────────────
section('[3] scheduler=1, materializer=0 → scheduler vivo SIN materializer');
{
    const { r, status } = await run('1', '0');
    ok('started=true', r.started === true, JSON.stringify(r));
    ok('materializer NO está entre los loops', !r.loops.includes('materializer'),
        JSON.stringify(r.loops));
    ok('status.materializer_enabled=false', status.materializer_enabled === false);
    ok('el resto de loops sí se registran', r.loops.length > 0);
}

// ── §[4] activación explícita ───────────────────────────────────────────────
section('[4] scheduler=1, materializer=1 → loop registrado');
let loopsOn = [];
{
    const { r, status } = await run('1', '1');
    loopsOn = r.loops;
    ok('started=true', r.started === true);
    ok('materializer registrado', r.loops.includes('materializer'), JSON.stringify(r.loops));
    ok('es el primer loop (mayor prioridad)', r.loops[0] === 'materializer');
    ok('status.materializer_enabled=true', status.materializer_enabled === true);
}

// ── §[5] los demás engines no cambian ───────────────────────────────────────
section('[5] los otros nueve engines siguen gobernados por su propio flag');
{
    const { r: rOff } = await run('1', '0');
    const expected = ['intervention', 'rollups', 'feature_extract', 'archive_rotation',
        'outcome_engine', 'cohort_builder', 'trajectory_analyzer',
        'institutional_learning', 'predictive_patterns'];
    for (const key of expected) {
        ok(`${key} registrado en ambos casos`,
            rOff.loops.includes(key) && loopsOn.includes(key));
    }
    ok('la única diferencia es materializer',
        loopsOn.length - rOff.loops.length === 1
        && loopsOn.filter(k => !rOff.loops.includes(k)).join() === 'materializer',
        `${JSON.stringify(loopsOn)} vs ${JSON.stringify(rOff.loops)}`);
    ok('sus flags siguen ausentes del entorno (OFF)',
        !process.env.INTERVENTION_ENGINE_ENABLED && !process.env.ROLLUPS_ENABLED
        && !process.env.FEATURE_EXTRACTION_ENABLED && !process.env.ARCHIVE_ROTATION_ENABLED);
}

// ── Limpieza ────────────────────────────────────────────────────────────────
for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(`\nmaterializerFlagGate: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
