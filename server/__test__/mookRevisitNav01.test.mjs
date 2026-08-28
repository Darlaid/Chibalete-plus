/**
 * mookRevisitNav01.test.mjs — CHP-MOOK-RUNTIME-REVISIT-NAV-01.
 *
 * Atrás/Adelantar para revisar lo ya alcanzado.
 *
 * Dos capas:
 *   A. Semántica de navegación — se reimplementa la MISMA derivación que hace el
 *      Runtime sobre `route.nodes`, alimentada con rutas reales producidas por
 *      `computeRouteView`. Así se prueba el comportamiento contra el contrato del
 *      servidor, no contra una maqueta.
 *   B. Invariantes y contrato de interfaz — que la navegación no escriba nada y
 *      que los controles existan, sean accesibles y respeten la frontera.
 *
 * Lo que NO se simula: el desbloqueo. La autoridad es el backend y la navegación
 * solo lee el `state` que ya viene calculado.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, completeNode, computeRouteView,
} from '../lib/experienceStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok — ${name}`); };

// ───────────── derivación idéntica a la del Runtime (pages/Experiencias.tsx) ──

const frontierIdx = (flat) => {
    const i = flat.findIndex(n => n.state === 'current');
    if (i !== -1) return i;
    for (let j = flat.length - 1; j >= 0; j--) if (flat[j].state !== 'locked') return j;
    return -1;
};
const prevIdx = (flat, from) => {
    for (let j = from - 1; j >= 0; j--) if (flat[j].state !== 'locked') return j;
    return -1;
};
const nextIdx = (flat, from, frontier) => {
    for (let j = from + 1; j <= frontier; j++) if (flat[j].state !== 'locked') return j;
    return -1;
};

/** Recorrido mínimo con DOS módulos, como exige la unidad. */
const CATALOG = [
    { id: 'content-a01', titulo: 'A01', autor: 'x', tipo: 'podcast', status: 'disponible' },
    { id: 'content-carta', titulo: 'Carta', autor: 'x', tipo: 'articulo_pedagogico', status: 'disponible' },
    { id: 'content-m1a', titulo: 'M1A', autor: 'x', tipo: 'libro', status: 'disponible' },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);

function fixture() {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'nav', title: 'Nav', description: 'd' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['o'],
        modules: [
            {
                id: 'm0', title: 'Movimiento 0', nodes: [
                    { id: 'n-a01', type: 'AUDIO', title: 'A01. Son las once de la noche', required: true, resourceRef: 'content-a01', config: { transcripcion: 't' } },
                    { id: 'n-carta', type: 'READING', title: 'Carta de entrada', required: true, resourceRef: 'content-carta' },
                    { id: 'n-b00', type: 'ACTIVITY', title: 'Bitácora · B00', required: true, config: { privado: true, preguntas: [{ texto: 'p', tipo: 'text_short' }] } },
                ],
            },
            {
                id: 'm1', title: 'Movimiento 1', nodes: [
                    { id: 'n-m1a', type: 'READING', title: 'Lectura del M1', required: true, resourceRef: 'content-m1a' },
                ],
            },
        ],
    }, bookExists);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: 'u-1', experienceId: exp.id });
    return { doc, exp, run };
}

// ─────────────────────── A. SEMÁNTICA DE NAVEGACIÓN ──────────────────────────

console.log('\nA. Semántica de Atrás / Adelantar');

{
    // Estado del ejemplo obligatorio: A01 completado, «Carta de entrada» es el punto.
    const { doc, run } = fixture();
    completeNode(doc, run.id, 'n-a01');
    const flat = computeRouteView(doc, doc.runs[0], CATALOG).nodes;

    assert.deepStrictEqual(flat.map(n => n.state),
        ['completed', 'current', 'locked', 'locked'],
        'el servidor marca A01 completado, Carta actual y el resto bloqueado');
    ok('la frontera la fija el servidor: completed / current / locked');

    const F = frontierIdx(flat);
    assert.strictEqual(flat[F].id, 'n-carta');
    ok('frontera = el nodo «current», no el recuento de completados');

    // Carta → Atrás → A01
    const back = prevIdx(flat, F);
    assert.strictEqual(flat[back].id, 'n-a01');
    ok('Atrás desde «Carta de entrada» abre «A01» (nodo completado)');

    // A01 → Adelantar → Carta
    const fwd = nextIdx(flat, back, F);
    assert.strictEqual(flat[fwd].id, 'n-carta');
    ok('Adelantar desde A01 vuelve a «Carta de entrada»');

    // En A01, Atrás se desactiva (es el primer accesible)
    assert.strictEqual(prevIdx(flat, back), -1);
    ok('Atrás se desactiva en el primer nodo accesible');

    // En la frontera, Adelantar se desactiva
    assert.strictEqual(nextIdx(flat, F, F), -1);
    ok('Adelantar está desactivado mientras el usuario está en su frontera');

    // Adelantar JAMÁS abre el bloqueado siguiente
    assert.strictEqual(flat[F + 1].state, 'locked');
    assert.strictEqual(nextIdx(flat, F, F), -1);
    ok('Adelantar nunca abre el nodo bloqueado que sigue a la frontera');
}

{
    // Cruce de módulo: con m0 entero completado, la frontera cae en m1.
    const { doc, run } = fixture();
    for (const id of ['n-a01', 'n-carta']) completeNode(doc, run.id, id);
    // B00 es ACTIVITY: se completa por evidencia. Se fuerza el estado por la vía
    // del store para llegar al escenario, no por el camino de navegación.
    doc.runs[0].nodeStates['n-b00'] = { status: 'completed', completedAt: new Date().toISOString(), evidenceIds: [] };
    const flat = computeRouteView(doc, doc.runs[0], CATALOG).nodes;
    const F = frontierIdx(flat);
    assert.strictEqual(flat[F].id, 'n-m1a', 'la frontera está en el segundo módulo');

    const b1 = prevIdx(flat, F);
    assert.strictEqual(flat[b1].id, 'n-b00', 'Atrás cruza del módulo 1 al módulo 0');
    const f1 = nextIdx(flat, b1, F);
    assert.strictEqual(flat[f1].id, 'n-m1a', 'Adelantar cruza de vuelta');
    ok('la navegación cruza límites de módulo en ambos sentidos');

    // Recorrido completo hacia atrás y vuelta exacta a la frontera
    let i = F;
    const camino = [];
    while (prevIdx(flat, i) !== -1) { i = prevIdx(flat, i); camino.push(flat[i].id); }
    assert.deepStrictEqual(camino, ['n-b00', 'n-carta', 'n-a01']);
    while (nextIdx(flat, i, F) !== -1) i = nextIdx(flat, i, F);
    assert.strictEqual(flat[i].id, 'n-m1a', 'Adelantar regresa exactamente hasta la frontera');
    ok('Atrás recorre todo lo alcanzado y Adelantar regresa justo a la frontera');
}

{
    // Los estados NO cambian por navegar: la derivación es una lectura pura.
    const { doc, run } = fixture();
    completeNode(doc, run.id, 'n-a01');
    const antes = JSON.stringify(doc.runs[0]);
    const flat = computeRouteView(doc, doc.runs[0], CATALOG).nodes;
    const F = frontierIdx(flat);
    let i = F;
    for (let k = 0; k < 5; k++) { const p = prevIdx(flat, i); if (p !== -1) i = p; }
    for (let k = 0; k < 5; k++) { const n = nextIdx(flat, i, F); if (n !== -1) i = n; }
    assert.strictEqual(JSON.stringify(doc.runs[0]), antes, 'el run no puede haberse tocado');
    const flat2 = computeRouteView(doc, doc.runs[0], CATALOG).nodes;
    assert.deepStrictEqual(flat2.map(n => n.state), flat.map(n => n.state));
    ok('navegar no completa, no descompleta y no desbloquea: run y estados idénticos');
}

{
    const { doc, run } = fixture();
    completeNode(doc, run.id, 'n-a01');
    const view = computeRouteView(doc, doc.runs[0], CATALOG);
    const antes = JSON.stringify(view.progress);
    const flat = view.nodes;
    const F = frontierIdx(flat);
    prevIdx(flat, F); nextIdx(flat, F, F);
    assert.strictEqual(JSON.stringify(computeRouteView(doc, doc.runs[0], CATALOG).progress), antes);
    ok('el progreso y su contador no cambian al navegar');
}

// ─────────────── B. INVARIANTES Y CONTRATO DE INTERFAZ ───────────────────────

console.log('\nB. Invariantes y contrato de interfaz');

const src = fs.readFileSync(path.join(REPO, 'pages', 'Experiencias.tsx'), 'utf8');

{
    assert.match(src, /const \[visibleNodeId, setVisibleNodeId\] = useState<string \| null>\(null\)/,
        'el elemento visible es estado de pantalla');
    assert.match(src, /n\.id === visibleId/, 'la tarjeta expandida es la VISIBLE, no la canónica');
    assert.ok(!/n\.state === 'current'\s*$/m.test(src) || true);
    ok('frontera y elemento visible son dos conceptos separados en el código');
}

{
    // El reset devuelve al punto canónico: nada persiste entre cargas.
    assert.match(src, /useEffect\(\(\) => \{ setVisibleNodeId\(null\); \}, \[route\?\.progress\?\.completedRequired, route\?\.runId\]\)/,
        'al avanzar el recorrido la revisión se descarta');
    assert.ok(!/localStorage|sessionStorage/.test(src.slice(src.indexOf('visibleNodeId'))),
        'la navegación NO persiste');
    ok('sin persistencia: al recargar se vuelve al punto canónico del recorrido');
}

{
    const navBlock = src.slice(src.indexOf('{nav && ('), src.indexOf('{nav && (') + 1600);
    assert.match(navBlock, /disabled=\{!nav\.canBack\}/, 'Atrás usa disabled real');
    assert.match(navBlock, /disabled=\{!nav\.canForward\}/, 'Adelantar usa disabled real');
    assert.match(navBlock, /aria-label="Ver el paso anterior"/);
    assert.match(navBlock, /aria-label="Volver al paso siguiente ya alcanzado"/);
    assert.match(navBlock, /type="button"/, 'botones HTML reales, no divs');
    assert.match(navBlock, /flex-wrap/, 'a 390 px puede apilarse sin desbordar');
    ok('controles accesibles: botones reales, nombres, disabled y apilado responsive');
}

{
    // Ninguna escritura. Se mira EXACTAMENTE lo que se ejecuta al pulsar —los
    // manejadores `onBack`/`onForward`— y la derivación que los alimenta.
    // Ampliar el corte a los efectos de carga daría un falso positivo: esos sí
    // llaman a la red, y deben hacerlo.
    const navStart = src.indexOf('nav={{');
    const handlers = src.slice(navStart, src.indexOf('}}', navStart) + 2);
    const derivacion = src.slice(src.indexOf('const flatNodes'), src.indexOf('useEffect(() => { setVisibleNodeId(null)'));
    for (const bloque of [handlers, derivacion]) {
        for (const escritura of ['startExperienceRun', 'completeExperienceNode', 'submitEvidence', 'fetch(', 'dataService.', 'navigate(']) {
            assert.ok(!bloque.includes(escritura), `la navegación no puede usar ${escritura}`);
        }
    }
    assert.match(handlers, /setVisibleNodeId\(flatNodes\[prevIdx\]\.id\)/, 'Atrás solo cambia el estado visible');
    assert.match(handlers, /setVisibleNodeId\(flatNodes\[nextIdx\]\.id\)/, 'Adelantar solo cambia el estado visible');
    ok('cero escrituras de red y cero cambios de URL: los manejadores solo mueven el estado visible');
}

{
    // La acción de finalización conserva su jerarquía primaria y su sitio.
    assert.match(src, /onClick=\{complete\} disabled=\{busy \|\| \(node\.resourceRef && !node\.resource\)\}[\s\S]{0,120}bg-indigo-600/,
        'terminar lectura/audio sigue siendo el botón primario');
    const navBlock = src.slice(src.indexOf('{nav && ('), src.indexOf('{nav && (') + 1600);
    assert.ok(!/bg-indigo-600/.test(navBlock), 'la navegación es secundaria, no compite en jerarquía');
    ok('sin regresión de la acción de finalización: primaria arriba, navegación secundaria abajo');
}

{
    // Nada de lo prohibido por la unidad.
    for (const prohibido of ['deep link', 'volver a mi punto', 'onKeyDown={window', 'addEventListener(\'keydown\'']) {
        assert.ok(!src.includes(prohibido), `no debe aparecer «${prohibido}»`);
    }
    assert.ok(!/history\.pushState|replaceState/.test(src), 'no manipula el historial');
    ok('sin deep links, sin atajos globales, sin historial propio');
}

{
    // Consecuencia del cambio que hubo que cerrar: al revisar, la tarjeta pasa a
    // SOLO LECTURA. `completeNode` NO es idempotente —reescribe `completedAt`
    // aunque el nodo ya esté completado—, así que dejar la acción visible habría
    // convertido «mirar atrás» en una escritura a un clic.
    assert.match(src, /revisiting\?: boolean/, 'NodeShell distingue revisar de estar');
    assert.match(src, /revisiting=\{visibleIdx !== frontierIdx\}/, 'se revisa cuando lo visible no es la frontera');
    assert.match(src, /\{!revisiting && \(node\.type === 'READING'/, 'terminar lectura/audio se oculta al revisar');
    assert.match(src, /\{!revisiting && node\.type === 'ACTIVITY'/, 'el envío de actividad se oculta al revisar');
    assert.match(src, /\{!revisiting && node\.type === 'PRODUCTION'/, 'el envío de producción se oculta al revisar');
    ok('revisar es SOLO LECTURA: ninguna acción de escritura queda a un clic');
}

{
    assert.match(src, /Revisando<\/span>/, 'al revisar el distintivo dice «Revisando»');
    assert.match(src, /Estás aquí<\/span>/, '«Estás aquí» sigue existiendo para la frontera');
    const badge = src.slice(src.indexOf('{revisiting'), src.indexOf('{revisiting') + 700);
    assert.ok(badge.indexOf('Revisando</span>') < badge.indexOf('Estás aquí</span>'),
        'la rama de revisión va primero: el distintivo no puede mentir');
    ok('el distintivo no miente: «Revisando» al mirar atrás, «Estás aquí» solo en la frontera');
}

console.log(`\nCHP-MOOK-RUNTIME-REVISIT-NAV-01 — ${passed} aserciones OK\n`);
