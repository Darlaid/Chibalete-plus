/**
 * AuthIntegrity65EA.test.mjs — CHP V9 65E-A (Bloque I). Nómina retenida en la interfaz.
 *
 * Un mediador sin su compromiso vigente recibe del servidor los grupos sin nómina (`rosterWithheld`) y la lista de
 * usuarios sin lectores. Aquí se comprueba, con el `dataService` REAL y la red simulada:
 *   [R] una respuesta anterior que llega tarde no vuelve a poner en memoria la nómina que la siguiente ya retiró
 *   [T] la interfaz lo explica y no lo presenta como «grupo vacío»; ningún texto nombra un código interno
 *
 *   node pages/__tests__/AuthIntegrity65EA.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_65ea_'));
const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

try {
    section('[R] respuestas tardías (dataService real, red simulada)');
    const out = path.join(tmp, 'ds.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'services/dataService.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
        external: ['react', 'react-dom'], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
    globalThis.window = globalThis; Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {} });
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };
    globalThis.localStorage = store({ chibalete_user_id: 'med' }); globalThis.sessionStorage = store();
    const realSetInterval = globalThis.setInterval; globalThis.setInterval = () => 0;

    const ROSTER = ['r1', 'r2', 'r3'];
    const group = (withheld) => ({ id: 'g1', name: 'Quinto A', type: 'course', school: 'Colegio', mediatorIds: ['med'], memberIds: withheld ? [] : ROSTER, studentIds: withheld ? [] : ROSTER, ...(withheld ? { rosterWithheld: true } : {}) });
    const med = { id: 'med', nombre_completo: 'Mediadora', roles: ['mediador'] };
    const readers = ROSTER.map((id) => ({ id, nombre_completo: `Estudiante ${id}`, roles: ['lector'], groupIds: ['g1'] }));
    // Cada petición se resuelve cuando la prueba lo decide: así una respuesta ANTIGUA puede llegar después de una nueva.
    const pending = { groups: [], users: [] };
    globalThis.fetch = (url) => new Promise((resolve) => {
        const u = String(url); const kind = /\/groups$/.test(u) ? 'groups' : /\/users$/.test(u) ? 'users' : null;
        if (!kind) return resolve({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
        pending[kind].push((body) => resolve({ ok: true, status: 200, json: async () => body }));
    });
    const { dataService: ds } = await import(pathToFileURL(out).href);
    globalThis.setInterval = realSetInterval;
    await tick(); await tick();
    // La carga inicial (si la hubo) recibe la nómina completa.
    for (let i = 0; i < 20; i++) {
        while (pending.groups.length) pending.groups.shift()([group(false)]);
        while (pending.users.length) pending.users.shift()([med, ...readers]);
        await tick();
    }
    const g1 = ds.reloadGroups(), u1 = ds.reloadUsers();          // (1) pedidas con el compromiso vigente…
    await tick();
    const g2 = ds.reloadGroups(), u2 = ds.reloadUsers();          // (2) …y otra vez después de la revocación
    await tick();
    ok('hay dos recargas de cada lista en camino', pending.groups.length === 2 && pending.users.length === 2, JSON.stringify([pending.groups.length, pending.users.length]));
    // La respuesta NUEVA (nómina retenida) llega primero.
    pending.groups[1]([group(true)]); pending.users[1]([med]);
    await g2; await u2; await tick();
    const students = () => ds.getGroupStudents('g1').map((s) => s.id);
    const mine = () => ds.getTeacherGroups('med');
    ok('con la respuesta nueva: el grupo sigue a su cargo, sin estudiantes y marcado como nómina retenida', mine().length === 1 && mine()[0].rosterWithheld === true && students().length === 0, JSON.stringify([mine(), students()]));
    // Ahora llega la respuesta ANTIGUA (con la nómina completa).
    pending.groups[0]([group(false)]); pending.users[0]([med, ...readers]);
    const lateStatus = await g1; const lateUsers = await u1; await tick();
    ok('la respuesta antigua que llega tarde NO vuelve a exponer la nómina', students().length === 0 && mine()[0].rosterWithheld === true && mine()[0].memberIds.length === 0 && lateUsers.every((u) => !/^Estudiante/.test(u.nombre_completo || '')), JSON.stringify([students(), mine()[0], lateUsers.length]));
    ok('…y esa recarga declara que no guardó nada (código 0)', lateStatus === 0, String(lateStatus));
    // Una recarga posterior con el compromiso otra vez vigente sí restaura la nómina.
    pending.groups.length = 0; pending.users.length = 0;
    const g3 = ds.reloadGroups(), u3 = ds.reloadUsers(); await tick();
    pending.groups[0]([group(false)]); pending.users[0]([med, ...readers]); await g3; await u3; await tick();
    ok('una recarga posterior con la nómina disponible la restaura', students().length === 3 && mine()[0].rosterWithheld !== true, JSON.stringify(students()));

    section('[T] estados visuales');
    const aula = code('pages/AulaViva.tsx'), err = read('utils/institutionalErrors.ts'), dash = code('pages/DashboardMediador.tsx'), inf = code('pages/InformeVisor.tsx');
    const notice = (err.match(/export const ROSTER_WITHHELD_NOTICE = ([\s\S]*?);\n/) || [])[1] || '';
    ok('Aula Viva muestra un aviso propio cuando el servidor retiene la nómina (no para la administración)', /canManageClassroom && !isAdmin && groups\.some\(g => g\.rosterWithheld === true\)/.test(aula) && /data-testid="aula-viva-roster-withheld"/.test(aula) && /\{ROSTER_WITHHELD_NOTICE\}/.test(aula));
    ok('el aviso dice que la lista no está disponible, que no significa grupo vacío y a quién acudir', /no está disponible para tu cuenta/.test(notice) && /no significa que los grupos estén vacíos/.test(notice) && /administración de tu institución/.test(notice), notice);
    ok('el aviso no nombra códigos internos ni permisos concretos', !/\bA2\b|\bC005\b|compromiso|autorizaci/i.test(notice), notice);
    ok('tablero e informe: con la nómina retenida no afirman «sin estudiantes registrados» (la nómina va como no disponible)', /getAllGroups\(\)\.some\(g => g\.id === courseId && !g\.rosterWithheld\)/.test(dash) && /getAllGroups\(\)\.some\(g => g\.id === id && !g\.rosterWithheld\)/.test(inf));
    ok('el tipo del grupo declara la marca', /rosterWithheld\?: boolean;/.test(read('types/index.ts')));
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e);
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nAuthIntegrity65EA — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
