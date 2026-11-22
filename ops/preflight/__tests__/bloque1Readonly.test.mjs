/**
 * bloque1Readonly.test.mjs — CHP V9 65E-C. La comprobación previa al despliegue es de SOLO LECTURA y aplica la regla
 * de asociación del servidor (`groupsContentScope`). Datos sintéticos en un directorio temporal.
 *
 *   node ops/preflight/__tests__/bloque1Readonly.test.mjs
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coursesWithoutWorks, telemetryCoverage } from '../bloque1-readonly.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = path.join(REPO, 'ops', 'preflight', 'bloque1-readonly.mjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 700)), fail++);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_preflight_'));
const NOW = Date.now(), DAY = 86_400_000;

try {
    const groups = [
        { id: 'g-rule', name: 'Con regla', type: 'course', school: 'Alfa', memberIds: ['a', 'b'], studentIds: ['a', 'b'] },
        { id: 'g-legacy', name: 'Con campo heredado', type: 'course', school: 'Alfa', memberIds: ['a'], availableContentIds: ['c9'] },
        { id: 'g-all', name: 'Todo el catálogo', type: 'club', school: 'Alfa', memberIds: [], availableContentIds: 'all' },
        { id: 'g-none', name: 'Sin obras', type: 'course', school: 'Alfa', memberIds: ['a', 'b', 'c'], studentIds: ['c', 'd'] },
        { id: 'g-expired', name: 'Regla vencida', type: 'course', school: 'Beta', memberIds: ['x'] },
        { id: 'g-window', name: 'Vigencia terminada', type: 'course', school: 'Beta', memberIds: [], availableContentIds: ['c1'], accessEndsAt: new Date(NOW - DAY).toISOString() },
        { id: 'g-col', name: 'Solo colección', type: 'course', school: 'Beta', memberIds: ['y'], collectionIds: ['col-1'] },
        { id: 'g-colempty', name: 'Colección vacía', type: 'course', school: 'Beta', memberIds: ['z'], collectionIds: ['col-vacia'] },
    ];
    const access = [
        { id: 'r1', scope: 'group', scopeId: 'g-rule', titleIds: ['c1'], collectionIds: [] },
        { id: 'r2', scope: 'group', scopeId: 'g-expired', titleIds: ['c1'], collectionIds: [], expiresAt: NOW - DAY },
        { id: 'r3', scope: 'user', scopeId: 'a', titleIds: ['c-personal'], collectionIds: [] },          // compra personal: no asocia nada a un curso
        { id: 'r4', scope: 'organization', scopeId: 'org', titleIds: ['c1'], collectionIds: [] },         // de organización: tampoco
    ];
    const content = [{ id: 'c1' }, { id: 'c2', parentId: 'col-1' }];

    console.log('[1] regla de asociación (la del servidor)');
    const withCatalog = Object.fromEntries(coursesWithoutWorks(groups, access, content, NOW).map((c) => [c.id, c]));
    ok('regla de grupo vigente, campo heredado y «todo el catálogo» ⇒ con obras', ['g-rule', 'g-legacy', 'g-all'].every((id) => withCatalog[id].state === 'with_works'), JSON.stringify(withCatalog));
    ok('sin regla, regla vencida y vigencia terminada ⇒ SIN obras', ['g-none', 'g-expired', 'g-window'].every((id) => withCatalog[id].state === 'without_works'));
    ok('una compra personal o una regla de organización no asocian obras a ningún curso', withCatalog['g-none'].state === 'without_works');
    ok('colección con títulos ⇒ con obras; colección vacía ⇒ sin obras', withCatalog['g-col'].state === 'with_works' && withCatalog['g-colempty'].state === 'without_works');
    const noCatalog = Object.fromEntries(coursesWithoutWorks(groups, access, null, NOW).map((c) => [c.id, c]));
    ok('sin catálogo, un curso con solo colecciones se informa aparte (no se da por vacío)', noCatalog['g-col'].state === 'collections_unresolved' && noCatalog['g-colempty'].state === 'collections_unresolved');
    ok('miembros = unión de memberIds y studentIds (solo el número)', withCatalog['g-none'].members === 4 && withCatalog['g-rule'].members === 2);

    console.log('[2] telemetría conservada');
    const t0 = NOW - 10 * DAY;
    const events = [{ event: 'session_start', userId: 'a', timestamp: t0, receivedAt: t0 }, { event: 'session_start', userId: 'b', timestamp: t0 + DAY, source: 'lu_android' },
        { event: 'page_change', userId: 'a', timestamp: NOW - 1000, receivedAt: NOW }];
    const cov = telemetryCoverage(events);
    ok('recuento, tramo y eventos sin constancia', cov.events === 3 && cov.full === false && cov.span_days === 10 && cov.without_server_receipt === 1 && cov.lu_without_server_receipt === 1 && cov.session_starts === 2, JSON.stringify(cov));
    ok('memoria llena ⇒ se dice', telemetryCoverage(events, 3).full === true && telemetryCoverage([], 3).events === 0);

    console.log('[3] ejecución: solo lectura, sin datos de personas');
    const P = { groups: path.join(tmp, 'groups.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), analytics: path.join(tmp, 'analytics.json') };
    fs.writeFileSync(P.groups, JSON.stringify(groups)); fs.writeFileSync(P.access, JSON.stringify(access)); fs.writeFileSync(P.content, JSON.stringify(content)); fs.writeFileSync(P.analytics, JSON.stringify(events));
    const digest = () => Object.values(P).map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}:${fs.statSync(f).mtimeMs}`).join('|');
    const before = digest(), listing = fs.readdirSync(tmp).sort().join();
    const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    const j = run(['--groups', P.groups, '--access', P.access, '--content', P.content, '--analytics', P.analytics, '--json']);
    const out = JSON.parse(j.stdout || '{}');
    ok('termina bien y entrega el recuento', j.status === 0 && out.read_only === true && out.courses?.total === 8 && out.courses.with_works === 4 && out.courses.without_works === 4 && out.courses.without_works_with_members === 3, j.stdout + j.stderr);
    ok('lista los cursos sin obras por id y nombre', JSON.stringify(out.without_works.map((c) => c.id).sort()) === JSON.stringify(['g-colempty', 'g-expired', 'g-none', 'g-window']), JSON.stringify(out.without_works));
    ok('no entrega ningún identificador de persona', !/"memberIds"|"studentIds"|"userId"|"a"|"b"|"x"/.test(j.stdout), j.stdout.slice(0, 300));
    ok('ningún archivo cambió y no se creó ninguno', digest() === before && fs.readdirSync(tmp).sort().join() === listing);
    const text = run(['--groups', P.groups, '--access', P.access, '--analytics', P.analytics]);
    ok('salida legible: cursos sin obras, colecciones sin resolver y alcance de la telemetría', text.status === 0 && /SIN obras asociadas: 3 \(2 con miembros\)/.test(text.stdout) && /solo colecciones sin resolver: 2/.test(text.stdout) && /Telemetría heredada: 3 de 50000/.test(text.stdout), text.stdout);
    const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok('el script no contiene ninguna operación de escritura ni de red', !/writeFile|appendFile|rename|unlink|rmSync|mkdir|copyFile|createWriteStream|fetch\(|http\.|https\.|child_process/.test(src));
    const bad = run(['--groups', path.join(tmp, 'no-existe.json'), '--access', P.access]);
    ok('archivo obligatorio ausente ⇒ código 2, sin salida de datos', bad.status === 2 && bad.stdout === '', `${bad.status} ${bad.stdout}`);
    ok('sin argumentos ⇒ código 2 y modo de uso', run([]).status === 2);
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e);
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\npreflightBloque1 — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
