/**
 * userUpdateGroupContract.test.js — CHP-ID-DEPLOY-PREFLIGHT-01A.
 *
 * `PUT /api/users/:id` no validaba pertenencia institucional: un groupId de
 * otro colegio se aceptaba sin más. Este test fija el contrato de la edición,
 * con la misma fuerza que el de la creación:
 *
 *   - el groupId añadido debe existir              → GROUP_NOT_FOUND
 *   - el conjunto resultante debe ser de la
 *     institución del usuario                      → GROUP_SCHOOL_MISMATCH
 *   - cambiar de institución invalida el grupo previo
 *   - la validación ocurre dentro del lock y ANTES de escribir
 *   - un fallo deja ambos stores byte a byte intactos
 *   - mediadores y administradores conservan su contrato
 *
 * Réplica del cuerpo del handler con las MISMAS helpers que importa server.js
 * (convención de endpointsMembership.test.js), más un chequeo anti-drift contra
 * el handler real. Fixtures sintéticas en mkdtemp; no toca stores reales.
 *
 *   node server/__test__/userUpdateGroupContract.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    validateExplicitGroupIds,
    applyUserGroupsChange,
    diffIds,
    ERR,
} from '../groupMembershipService.js';
import { withFileLock, withUsersLock } from '../usersLock.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);

const clone = (x) => JSON.parse(JSON.stringify(x));

const GROUPS = Object.freeze([
    { id: 'g_uno_a', name: 'Quinto A', grade: '5', school: 'Colegio Uno', schoolId: 'sch_uno', studentIds: ['u_lector'], memberIds: ['u_lector'] },
    { id: 'g_uno_b', name: 'Quinto B', grade: '5', school: 'Colegio Uno', schoolId: 'sch_uno', studentIds: [], memberIds: [] },
    { id: 'g_dos_a', name: 'Sexto A',  grade: '6', school: 'Colegio Dos', schoolId: 'sch_dos', studentIds: [], memberIds: [] },
]);
const USERS = Object.freeze([
    { id: 'u_lector',  email: 'l@test.local', roles: ['lector'],        colegio: 'Colegio Uno', groupIds: ['g_uno_a'] },
    { id: 'u_med',     email: 'm@test.local', roles: ['mediador'],      colegio: 'Colegio Uno', groupIds: [] },
    { id: 'u_admin',   email: 'a@test.local', roles: ['administrador'], colegio: 'Colegio Uno', groupIds: [] },
    { id: 'u_colgado', email: 'c@test.local', roles: ['lector'],        colegio: 'Colegio Uno', groupIds: ['g_borrado'] },
]);

/**
 * Réplica del bloque de decisión de PUT /api/users/:id. Devuelve
 * `{ conflict }` cuando el handler cortaría, o `{ ok:true, ... }` si procede.
 * NO muta los argumentos salvo `groups`, y solo después de validar.
 */
function handlerUpdate(users, groups, id, updates) {
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return { conflict: { conflict: 'not_found' } };

    const oldGroupIds = Array.isArray(users[index].groupIds) ? [...users[index].groupIds] : [];
    const mergedUser  = { ...users[index], ...updates };
    const newGroupIds = Array.isArray(mergedUser.groupIds) ? [...mergedUser.groupIds] : [];
    const { added, removed } = diffIds(oldGroupIds, newGroupIds);

    const addedExist = validateExplicitGroupIds(added, groups, null);
    if (!addedExist.ok) return { conflict: { conflict: 'group', ...addedExist } };

    const groupIdSet  = new Set(groups.filter(g => g?.id).map(g => g.id));
    const resolvedNew = newGroupIds.filter(g => groupIdSet.has(g));
    const schoolCheck = validateExplicitGroupIds(resolvedNew, groups, mergedUser.colegio);
    if (!schoolCheck.ok) return { conflict: { conflict: 'group', ...schoolCheck } };

    const applied = applyUserGroupsChange(groups, id, added, removed);
    return { ok: true, mergedUser, added, removed, applied };
}

console.log('userUpdateGroupContract — CHP-ID-DEPLOY-PREFLIGHT-01A');

// ── A. Casos del contrato ───────────────────────────────────────────────────
console.log('\n[A] Contrato de edición');
{
    // 1. Edición válida — mismo colegio, grupo existente
    {
        const g = clone(GROUPS), u = clone(USERS);
        const r = handlerUpdate(u, g, 'u_lector', { groupIds: ['g_uno_b'] });
        ok('1· edición válida acepta un grupo de la misma institución', r.ok === true, JSON.stringify(r.conflict));
        ok('1· la bidireccional se aplica sobre el grupo nuevo',
            g.find(x => x.id === 'g_uno_b').memberIds.includes('u_lector'));
        ok('1· y se retira del grupo anterior',
            !g.find(x => x.id === 'g_uno_a').memberIds.includes('u_lector'));
    }

    // 2. GROUP_NOT_FOUND — id añadido inexistente
    {
        const g = clone(GROUPS), u = clone(USERS);
        const r = handlerUpdate(u, g, 'u_lector', { groupIds: ['g_no_existe'] });
        ok('2· groupId añadido inexistente → GROUP_NOT_FOUND',
            r.conflict?.error === ERR.GROUP_NOT_FOUND, JSON.stringify(r));
        ok('2· los grupos no se mutaron', JSON.stringify(g) === JSON.stringify(clone(GROUPS)));
    }

    // 3. GROUP_SCHOOL_MISMATCH — grupo de otra institución
    {
        const g = clone(GROUPS), u = clone(USERS);
        const r = handlerUpdate(u, g, 'u_lector', { groupIds: ['g_dos_a'] });
        ok('3· groupId de otra institución → GROUP_SCHOOL_MISMATCH',
            r.conflict?.error === ERR.GROUP_SCHOOL_MISMATCH, JSON.stringify(r));
        ok('3· el rechazo nombra el grupo conflictivo',
            r.conflict?.foreign?.includes('g_dos_a'));
        ok('3· los grupos no se mutaron', JSON.stringify(g) === JSON.stringify(clone(GROUPS)));
    }

    // 4. Cambio de institución que invalida el grupo anterior
    {
        const g = clone(GROUPS), u = clone(USERS);
        const r = handlerUpdate(u, g, 'u_lector', { colegio: 'Colegio Dos' });
        ok('4· cambiar de institución invalida el grupo previo',
            r.conflict?.error === ERR.GROUP_SCHOOL_MISMATCH, JSON.stringify(r));
        ok('4· el conflicto señala el grupo heredado', r.conflict?.foreign?.includes('g_uno_a'));

        // …y es aceptable si el grupo se cambia en la misma operación.
        const g2 = clone(GROUPS), u2 = clone(USERS);
        const r2 = handlerUpdate(u2, g2, 'u_lector', { colegio: 'Colegio Dos', groupIds: ['g_dos_a'] });
        ok('4· cambiar institución Y grupo a la vez sí procede', r2.ok === true, JSON.stringify(r2.conflict));
    }

    // 5. Payload parcial — no toca groupIds
    {
        const g = clone(GROUPS), u = clone(USERS);
        const r = handlerUpdate(u, g, 'u_lector', { nombre_completo: 'Nombre Nuevo' });
        ok('5· payload parcial sin groupIds procede', r.ok === true, JSON.stringify(r.conflict));
        ok('5· conserva los groupIds previos',
            JSON.stringify(r.mergedUser.groupIds) === JSON.stringify(['g_uno_a']));
    }

    // 5b. Id colgante preexistente no bloquea una edición ajena
    {
        const g = clone(GROUPS), u = clone(USERS);
        const r = handlerUpdate(u, g, 'u_colgado', { nombre_completo: 'Otro Nombre' });
        ok('5b· un groupId colgante preexistente no bloquea editar otro campo',
            r.ok === true, JSON.stringify(r.conflict));
    }

    // 6. Roles sin exigencia de grupo
    {
        const g = clone(GROUPS), u = clone(USERS);
        ok('6· mediador puede quedarse sin grupo',
            handlerUpdate(u, g, 'u_med', { nombre_completo: 'Media Dora' }).ok === true);
        ok('6· mediador con grupo de su institución procede',
            handlerUpdate(clone(USERS), clone(GROUPS), 'u_med', { groupIds: ['g_uno_a'] }).ok === true);
        ok('6· mediador con grupo de otra institución → rechazo',
            handlerUpdate(clone(USERS), clone(GROUPS), 'u_med', { groupIds: ['g_dos_a'] })
                .conflict?.error === ERR.GROUP_SCHOOL_MISMATCH);
        ok('6· administrador puede quedarse sin grupo',
            handlerUpdate(clone(USERS), clone(GROUPS), 'u_admin', { bio_corta: 'x' }).ok === true);
    }

    // 7. Vaciar groupIds explícitamente sigue permitido (no es rol-gated aquí)
    {
        const r = handlerUpdate(clone(USERS), clone(GROUPS), 'u_lector', { groupIds: [] });
        ok('7· vaciar groupIds no rompe la validación', r.ok === true, JSON.stringify(r.conflict));
    }

    // 8. Usuario inexistente
    {
        const r = handlerUpdate(clone(USERS), clone(GROUPS), 'u_fantasma', { nombre_completo: 'x' });
        ok('8· usuario inexistente → not_found', r.conflict?.conflict === 'not_found');
    }
}

// ── B. Persistencia: cero escritura parcial, concurrencia, rollback ─────────
console.log('\n[B] Persistencia');
{
    const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'putcontract_'));
    const USERS_F  = path.join(tmpDir, 'usuarios_colegios_oro.json');
    const GROUPS_F = path.join(tmpDir, 'groups_db.json');
    fs.writeFileSync(USERS_F,  JSON.stringify(clone(USERS),  null, 2), 'utf8');
    fs.writeFileSync(GROUPS_F, JSON.stringify(clone(GROUPS), null, 2), 'utf8');

    const readJson  = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const writeJson = (f, d) => {
        const tmp = `${f}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
        fs.renameSync(tmp, f);
    };

    // B1 — rechazo institucional ⇒ ambos archivos byte a byte intactos
    {
        const uBefore = fs.readFileSync(USERS_F, 'utf8');
        const gBefore = fs.readFileSync(GROUPS_F, 'utf8');
        let conflict = null;
        await withFileLock(GROUPS_F, async () => {
            await withUsersLock(USERS_F, () => {
                const users = readJson(USERS_F), groups = readJson(GROUPS_F);
                const r = handlerUpdate(users, groups, 'u_lector', { groupIds: ['g_dos_a'] });
                if (r.conflict) { conflict = r.conflict; return; }
                writeJson(GROUPS_F, groups);
                users[users.findIndex(u => u.id === 'u_lector')] = r.mergedUser;
                writeJson(USERS_F, users);
            });
        }, 'groupsLock');
        ok('B1· rechazo institucional antes de escribir',
            conflict?.error === ERR.GROUP_SCHOOL_MISMATCH);
        ok('B1· padrón byte a byte intacto', fs.readFileSync(USERS_F, 'utf8') === uBefore);
        ok('B1· grupos byte a byte intactos', fs.readFileSync(GROUPS_F, 'utf8') === gBefore);
    }

    // B2 — fallo de persistencia en grupos ⇒ el usuario no se escribe
    {
        const uBefore = fs.readFileSync(USERS_F, 'utf8');
        let threw = false;
        try {
            await withFileLock(GROUPS_F, async () => {
                await withUsersLock(USERS_F, () => {
                    const users = readJson(USERS_F), groups = readJson(GROUPS_F);
                    const r = handlerUpdate(users, groups, 'u_lector', { groupIds: ['g_uno_b'] });
                    if (r.conflict) return;
                    throw new Error('disk failure (simulada) al escribir grupos');
                });
            }, 'groupsLock');
        } catch { threw = true; }
        ok('B2· el fallo se propaga', threw);
        ok('B2· el padrón no cambió', fs.readFileSync(USERS_F, 'utf8') === uBefore);
        ok('B2· sin estado parcial', readJson(USERS_F).find(u => u.id === 'u_lector').groupIds[0] === 'g_uno_a');
    }

    // B3 — edición válida sí persiste, de forma atómica
    {
        await withFileLock(GROUPS_F, async () => {
            await withUsersLock(USERS_F, () => {
                const users = readJson(USERS_F), groups = readJson(GROUPS_F);
                const r = handlerUpdate(users, groups, 'u_lector', { groupIds: ['g_uno_b'] });
                if (r.conflict) throw new Error('no debía conflictuar');
                writeJson(GROUPS_F, groups);
                users[users.findIndex(u => u.id === 'u_lector')] = r.mergedUser;
                writeJson(USERS_F, users);
            });
        }, 'groupsLock');
        ok('B3· la edición válida persiste',
            readJson(USERS_F).find(u => u.id === 'u_lector').groupIds[0] === 'g_uno_b');
        ok('B3· bidireccional coherente en disco',
            readJson(GROUPS_F).find(g => g.id === 'g_uno_b').memberIds.includes('u_lector'));
        ok('B3· sin temporales huérfanos',
            fs.readdirSync(tmpDir).every(f => !f.endsWith('.tmp')), fs.readdirSync(tmpDir).join(','));
    }

    // B4 — concurrencia: ediciones simultáneas bajo el mismo lock
    {
        const edit = async (userId, nombre) => withUsersLock(USERS_F, () => {
            const users = readJson(USERS_F);
            const i = users.findIndex(u => u.id === userId);
            users[i] = { ...users[i], nombre_completo: nombre };
            writeJson(USERS_F, users);
        });
        await Promise.all([edit('u_lector', 'A'), edit('u_med', 'B'), edit('u_admin', 'C')]);
        const users = readJson(USERS_F);
        ok('B4· las 3 ediciones concurrentes se conservan',
            users.find(u => u.id === 'u_lector').nombre_completo === 'A'
            && users.find(u => u.id === 'u_med').nombre_completo === 'B'
            && users.find(u => u.id === 'u_admin').nombre_completo === 'C');
        ok('B4· sin pérdida de registros por lost update', users.length === USERS.length);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── C. Anti-drift contra el handler real ───────────────────────────────────
console.log('\n[C] El handler real aplica el mismo contrato');
{
    const src = fs.readFileSync(path.join(REPO_ROOT, 'server', 'server.js'), 'utf8');
    const i = src.indexOf("app.put('/api/users/:id'");
    const next = src.indexOf('\napp.', i + 1);
    const body = src.slice(i, next > -1 ? next : i + 8000);

    ok('PUT valida existencia de los ids añadidos',
        /validateExplicitGroupIds\(added, groups, null\)/.test(body));
    ok('PUT valida institución sobre el conjunto resultante',
        /validateExplicitGroupIds\(resolvedNew, groups, mergedUser\.colegio\)/.test(body));
    ok('PUT responde GROUP_SCHOOL_MISMATCH', body.includes('GROUP_SCHOOL_MISMATCH'));
    ok('PUT valida ANTES de aplicar la bidireccional',
        body.indexOf('validateExplicitGroupIds(resolvedNew') < body.indexOf('applyUserGroupsChange('));
    ok('PUT valida ANTES de escribir',
        body.indexOf('validateExplicitGroupIds(added') < body.indexOf('writeJSON(GROUPS_DB'));
    ok('PUT ya no usa el conflicto orphan_group suelto', !body.includes("conflict: 'orphan_group'"));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
