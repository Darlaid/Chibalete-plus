/**
 * target-guard.test.mjs — CHP-STATS-SHADOW-PERF-01D-CHKPT.
 *
 * La barrera de destino es lo único que separa un harness de benchmark de una
 * herramienta de denegación de servicio contra la propia plataforma. Se prueba
 * en CI porque un fallo aquí es silencioso hasta que hace daño.
 *
 *   node scripts/perf/target-guard.test.mjs
 */
import { assertSafeTarget, guardFromArgs, UnsafeTargetError } from './target-guard.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const blocked = (fn) => caught(fn) instanceof UnsafeTargetError;

console.log('target-guard — CHP-STATS-SHADOW-PERF-01D-CHKPT');

section('[1] destinos locales permitidos sin ceremonia');
{
    ok('[1a] 127.0.0.1', assertSafeTarget('127.0.0.1').classification === 'loopback');
    ok('[1b] localhost', assertSafeTarget('localhost').classification === 'loopback');
    ok('[1c] ::1', assertSafeTarget('::1').classification === 'loopback');
    ok('[1d] 127.0.0.53 sigue siendo loopback', assertSafeTarget('127.0.0.53').classification === 'loopback');
    ok('[1e] nombre de servicio de la red interna',
        assertSafeTarget('chpbench_api_1').classification === 'internal');
}

section('[2] los dominios productivos están prohibidos SIEMPRE');
{
    ok('[2a] dominio principal', blocked(() => assertSafeTarget('chibaleteplus.com')));
    ok('[2b] con www', blocked(() => assertSafeTarget('www.chibaleteplus.com')));
    ok('[2c] dominio editorial', blocked(() => assertSafeTarget('chibaleteeditores.com')));
    ok('[2d] subdominio studio', blocked(() => assertSafeTarget('studio.chibaleteeditores.com')));
    // Lo importante: ninguna bandera los desbloquea.
    ok('[2e] --allowRemote NO los desbloquea',
        blocked(() => assertSafeTarget('chibaleteplus.com', { allowRemote: true, acknowledged: true })));
    ok('[2f] mayúsculas y espacios no evaden la barrera',
        blocked(() => assertSafeTarget('  WWW.ChibalatePlus.com  '.replace('ChibalatePlus', 'Chibaleteplus'),
            { allowRemote: true, acknowledged: true })));
}

section('[3] cualquier host externo exige confirmación explícita');
{
    ok('[3a] IP externa bloqueada por defecto', blocked(() => assertSafeTarget('203.0.113.10')));
    ok('[3b] dominio ajeno bloqueado por defecto', blocked(() => assertSafeTarget('ejemplo.test')));
    ok('[3c] --allowRemote sin acuse sigue bloqueando',
        blocked(() => assertSafeTarget('203.0.113.10', { allowRemote: true })));
    ok('[3d] con ambas banderas se permite',
        assertSafeTarget('203.0.113.10', { allowRemote: true, acknowledged: true }).classification === 'remote');
}

section('[4] entradas degeneradas');
{
    ok('[4a] host vacío rechazado', blocked(() => assertSafeTarget('')));
    ok('[4b] host nulo rechazado', blocked(() => assertSafeTarget(null)));
    ok('[4c] host no string rechazado', blocked(() => assertSafeTarget(42)));
}

section('[5] lectura de banderas desde argumentos');
{
    ok('[5a] guardFromArgs respeta el bloqueo por defecto',
        blocked(() => guardFromArgs('203.0.113.10', {})));
    ok('[5b] guardFromArgs acepta con ambas banderas',
        guardFromArgs('203.0.113.10',
            { allowRemote: true, iUnderstandThisGeneratesLoad: true }).classification === 'remote');
}

console.log(`\ntarget-guard: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
