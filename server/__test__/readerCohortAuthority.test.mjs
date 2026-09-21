/**
 * readerCohortAuthority.test.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / A1 §14.
 *
 * La cohorte LECTORA de un grupo sale de la autoridad de membresía vigente
 * (`utils/groupMembership.mjs`) menos los mediadores declarados. Nunca de la
 * población institucional ni del `users_db.json` legacy.
 *
 * Casos (todos genéricos: ningún id ni número de un colegio real):
 *   [1] 80 lectores + 10 mediadores → cohorte 80, excluidos 10
 *   [2] usuario ajeno al grupo no entra aunque comparta institución
 *   [3] duplicación studentIds/memberIds no infla el conteo
 *   [4] un mediador listado por error en memberIds sigue excluido
 *   [5] teacherId legacy excluido
 *   [6] lector soft-deleted según el contrato vigente del fallback
 *   [7] cross-tenant: el fallback por colegio no cruza instituciones
 *   [8] el módulo no consulta users_db.json legacy
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGroupReaderCohort, groupNonReaderIds } from '../analytics/readerCohort.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const lector = (id, colegio = 'Institución A') => ({ id, roles: ['lector'], colegio });
const mediador = (id, colegio = 'Institución A') => ({ id, roles: ['mediador'], colegio });

// ── §[1] cohorte = lectores; mediadores fuera ───────────────────────────────
section('[1] N lectores + M mediadores → cohorte = N');
{
    const readers   = Array.from({ length: 80 }, (_, i) => `r-${i}`);
    const mediators = Array.from({ length: 10 }, (_, i) => `m-${i}`);
    const group = {
        id: 'g-1', school: 'Institución A',
        studentIds: [...readers], memberIds: [...readers],
        mediatorIds: [...mediators],
    };
    const users = [...readers.map(id => lector(id)), ...mediators.map(id => mediador(id))];
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group] });
    ok('cohorte lectora = 80', r.readerIds.length === 80, String(r.readerIds.length));
    ok('mediadores excluidos = 0 (no estaban en members)', r.excludedMediatorIds.length === 0);
    ok('ningún mediador en la cohorte', !r.readerIds.some(id => id.startsWith('m-')));
    ok('los 10 mediadores son no-lectores declarados', groupNonReaderIds(group).size === 10);
    ok('80 + 10 = 90 cuentas de institución, pero la cohorte NO es 90',
        users.length === 90 && r.readerIds.length !== 90);
}

// ── §[2] usuario ajeno al grupo ─────────────────────────────────────────────
section('[2] cuenta institucional fuera del grupo no entra');
{
    const group = { id: 'g-2', school: 'Institución A', studentIds: ['r-1'], memberIds: ['r-1'], mediatorIds: [] };
    const otherGroup = { id: 'g-2b', school: 'Institución A', studentIds: ['r-9'], memberIds: ['r-9'], mediatorIds: [] };
    const users = [lector('r-1'), lector('r-9'), lector('r-suelto')];
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group, otherGroup] });
    ok('solo el miembro explícito', r.readerIds.length === 1 && r.readerIds[0] === 'r-1',
        JSON.stringify(r.readerIds));
}

// ── §[3] duplicación studentIds/memberIds ───────────────────────────────────
section('[3] studentIds ∪ memberIds sin inflar');
{
    const group = {
        id: 'g-3', school: 'Institución A',
        studentIds: ['a', 'b', 'c'], memberIds: ['b', 'c', 'd'], mediatorIds: [],
    };
    const users = ['a', 'b', 'c', 'd'].map(id => lector(id));
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group] });
    ok('unión sin duplicados = 4', r.readerIds.length === 4, JSON.stringify(r.readerIds));
    ok('sin ids repetidos', new Set(r.readerIds).size === r.readerIds.length);
}

// ── §[4] mediador contaminando memberIds ────────────────────────────────────
section('[4] mediador listado por error en memberIds → excluido igual');
{
    const group = {
        id: 'g-4', school: 'Institución A',
        studentIds: ['r-1', 'r-2', 'med-1'], memberIds: ['r-1', 'r-2', 'med-1'],
        mediatorIds: ['med-1'],
    };
    const users = [lector('r-1'), lector('r-2'), mediador('med-1')];
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group] });
    ok('cohorte = 2', r.readerIds.length === 2, JSON.stringify(r.readerIds));
    ok('med-1 reportado como excluido', r.excludedMediatorIds.includes('med-1'));
}

// ── §[5] teacherId legacy ───────────────────────────────────────────────────
section('[5] teacherId legacy excluido');
{
    const group = {
        id: 'g-5', school: 'Institución A',
        studentIds: ['r-1', 'prof-legacy'], memberIds: ['r-1', 'prof-legacy'],
        mediatorIds: [], teacherId: 'prof-legacy',
    };
    const users = [lector('r-1'), mediador('prof-legacy')];
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group] });
    ok('cohorte = 1', r.readerIds.length === 1 && r.readerIds[0] === 'r-1', JSON.stringify(r.readerIds));
}

// ── §[6] soft-deleted bajo el fallback por colegio ──────────────────────────
section('[6] fallback por colegio honra el contrato de elegibilidad');
{
    const group = { id: 'g-6', school: 'Institución A', studentIds: [], memberIds: [], mediatorIds: [] };
    const users = [
        lector('r-vivo'),
        { ...lector('r-borrado'), deleted: true },
        { ...lector('r-borrado-ts'), deletedAt: '2026-01-01T00:00:00Z' },
        mediador('med-1'),
    ];
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group] });
    ok('solo el lector vivo', r.readerIds.length === 1 && r.readerIds[0] === 'r-vivo',
        JSON.stringify(r.readerIds));
    ok('el mediador no entra por el fallback', !r.readerIds.includes('med-1'));
}

// ── §[7] cross-tenant ───────────────────────────────────────────────────────
section('[7] el fallback por colegio no cruza instituciones');
{
    const group = { id: 'g-7', school: 'Institución A', studentIds: [], memberIds: [], mediatorIds: [] };
    const users = [lector('r-a', 'Institución A'), lector('r-b', 'Institución B')];
    const r = resolveGroupReaderCohort(group, users, { allGroups: [group] });
    ok('solo lectores de la misma institución',
        r.readerIds.length === 1 && r.readerIds[0] === 'r-a', JSON.stringify(r.readerIds));
}
{
    // Con dos grupos en la misma escuela el fallback no puede desambiguar.
    const gA = { id: 'g-7a', school: 'Institución A', studentIds: [], memberIds: [], mediatorIds: [] };
    const gB = { id: 'g-7b', school: 'Institución A', studentIds: [], memberIds: [], mediatorIds: [] };
    const r = resolveGroupReaderCohort(gA, [lector('r-a')], { allGroups: [gA, gB] });
    ok('escuela con 2 grupos → fallback inactivo', r.readerIds.length === 0);
}

// ── §[8] no se consulta users_db.json legacy ────────────────────────────────
section('[8] sin dependencia de users_db.json legacy');
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'analytics', 'readerCohort.mjs'), 'utf8');
    ok('readerCohort.mjs no menciona users_db', !/users_db/i.test(src.replace(/^\s*\*.*$/gm, '')));
    ok('readerCohort.mjs no lee disco', !/readFileSync|require\(|node:fs/.test(src));
    // Código efectivo: sin líneas de comentario (// y bloques * de JSDoc).
    const strip = (s) => s.split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
    const mat = strip(fs.readFileSync(path.join(__dirname, '..', 'services', 'insightMaterializer.mjs'), 'utf8'));
    ok('el materializer importa USERS_DB canónico', /USERS_DB/.test(mat));
    ok('el materializer no referencia users_db.json en código', !/users_db\.json/.test(mat));
}

// ── Entradas degeneradas ────────────────────────────────────────────────────
section('[9] entradas degeneradas');
for (const g of [null, undefined, {}, 42, 'x']) {
    const r = resolveGroupReaderCohort(g, []);
    ok(`${JSON.stringify(g)} → cohorte vacía`, Array.isArray(r.readerIds) && r.readerIds.length === 0);
}

console.log(`\nreaderCohortAuthority: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
