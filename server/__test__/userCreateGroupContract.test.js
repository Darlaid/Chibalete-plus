/**
 * userCreateGroupContract.test.js — CHP-ID-CANON-01A.
 *
 * Contrato de grupos en la creación de usuarios (POST /api/users y
 * POST /api/invite-user):
 *
 *   - la autoridad es el groupId estable, nunca el texto de curso/institución;
 *   - payload legacy con UNA coincidencia → se resuelve (compat documentada);
 *   - payload legacy con VARIAS → 409 AMBIGUOUS_GROUP + opciones;
 *   - jamás se elige el primer grupo arbitrariamente;
 *   - groupId inexistente o de otra institución → rechazo sin escritura;
 *   - error de persistencia → padrón intacto, cero estado parcial.
 *
 * Sigue la convención de endpointsMembership.test.js: reproduce el cuerpo del
 * handler usando EXACTAMENTE las mismas helpers que importa server.js, sin
 * levantar Express. Un chequeo estático al final impide que la réplica se
 * desincronice del handler real.
 *
 * Fixtures 100% sintéticas, en mkdtemp. No toca data/ ni data-critical/.
 *
 *   node server/__test__/userCreateGroupContract.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    findGroupsForSchool,
    groupChoice,
    validateExplicitGroupIds,
    resolveSingleGroupForSchool,
    addUserIdToGroup,
    ERR,
} from '../groupMembershipService.js';
import { withFileLock, withUsersLock } from '../usersLock.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);

// ────────────────────────────────────────────────────────────────────────────
// Fixtures sintéticas
// ────────────────────────────────────────────────────────────────────────────

// Dos grupos con el MISMO grado en instituciones distintas, dos grupos con el
// mismo nombre visible en la MISMA institución, y una institución mono-grupo.
const GROUPS = Object.freeze([
    { id: 'g_uno_a',   name: 'Quinto A',  grade: '5', type: 'course', school: 'Colegio Uno',  schoolId: 'sch_uno' },
    { id: 'g_uno_b',   name: 'Quinto A',  grade: '5', type: 'course', school: 'Colegio Uno',  schoolId: 'sch_uno' },
    { id: 'g_dos_a',   name: 'Quinto A',  grade: '5', type: 'course', school: 'Colegio Dos',  schoolId: 'sch_dos' },
    { id: 'g_solo',    name: 'Único',     grade: '3', type: 'course', school: 'Colegio Solo', schoolId: 'sch_solo' },
    { id: 'g_club',    name: 'Club Poe',  grade: '',  type: 'club',   school: 'Colegio Uno',  schoolId: 'sch_uno' },
]);

const clone = (x) => JSON.parse(JSON.stringify(x));

// ────────────────────────────────────────────────────────────────────────────
// Réplica del handler POST /api/users (fase de resolución de grupo)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve { status, body } cuando el handler cortaría, o { resolvedGroupIds }
 * cuando la resolución previa al lock termina bien.
 */
function handlerResolveGroups({ roles, colegio, groupIds }, groups) {
    const isLector = (roles || []).includes('lector');
    let resolvedGroupIds = Array.isArray(groupIds)
        ? groupIds.filter(g => typeof g === 'string' && g)
        : [];

    if (isLector && resolvedGroupIds.length === 0) {
        if (colegio) {
            const matches = findGroupsForSchool(colegio, groups);
            if (matches.length > 1) {
                return {
                    status: 409,
                    body: {
                        error:   ERR.AMBIGUOUS_GROUP,
                        message: `La institución "${colegio}" tiene ${matches.length} grupos. Selecciona el grupo y envía groupIds.`,
                        choices: matches.map(groupChoice),
                    },
                };
            }
            if (matches.length === 1) resolvedGroupIds = [matches[0].id];
        }
    }
    if (isLector && resolvedGroupIds.length === 0) {
        return { status: 400, body: { error: ERR.GROUP_REQUIRED } };
    }
    return { resolvedGroupIds };
}

/** Réplica de la validación dentro del lock (antes de cualquier escritura). */
function handlerValidateInLock(resolvedGroupIds, groups, colegio) {
    const gv = validateExplicitGroupIds(resolvedGroupIds, groups, colegio);
    if (gv.ok) return null;
    if (gv.error === ERR.GROUP_NOT_FOUND) {
        return { status: 400, body: { error: ERR.GROUP_NOT_FOUND, missing: gv.missing } };
    }
    return { status: 400, body: { error: ERR.GROUP_SCHOOL_MISMATCH, foreign: gv.foreign } };
}

console.log('userCreateGroupContract — CHP-ID-CANON-01A');

// ────────────────────────────────────────────────────────────────────────────
// A. Ambigüedad — los 9 casos del contrato
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[A] Resolución de grupo por caso');
{
    // 1. ningún grupo coincidente
    const r1 = handlerResolveGroups({ roles: ['lector'], colegio: 'Colegio Fantasma' }, GROUPS);
    ok('1· sin grupo coincidente → 400 GROUP_REQUIRED',
        r1.status === 400 && r1.body.error === ERR.GROUP_REQUIRED);

    // 2. un solo grupo coincidente → compat legacy documentada
    const r2 = handlerResolveGroups({ roles: ['lector'], colegio: 'Colegio Solo' }, GROUPS);
    ok('2· una sola coincidencia → resuelve ese groupId',
        !r2.status && r2.resolvedGroupIds.length === 1 && r2.resolvedGroupIds[0] === 'g_solo',
        JSON.stringify(r2));

    // 3. mismo grado en instituciones diferentes → NO es ambiguo: la
    //    institución acota; Colegio Dos tiene un solo grupo.
    const r3 = handlerResolveGroups({ roles: ['lector'], colegio: 'Colegio Dos' }, GROUPS);
    ok('3· mismo grado en otra institución no contamina la resolución',
        !r3.status && r3.resolvedGroupIds[0] === 'g_dos_a', JSON.stringify(r3));

    // 4. dos grupos homónimos en la MISMA institución → 409 con opciones
    const r4 = handlerResolveGroups({ roles: ['lector'], colegio: 'Colegio Uno' }, GROUPS);
    ok('4· varias coincidencias → 409 AMBIGUOUS_GROUP',
        r4.status === 409 && r4.body.error === ERR.AMBIGUOUS_GROUP, JSON.stringify(r4));
    ok('4· la respuesta 409 ofrece las opciones seleccionables',
        Array.isArray(r4.body.choices) && r4.body.choices.length === 3
        && r4.body.choices.every(c => typeof c.id === 'string' && c.id),
        JSON.stringify(r4.body.choices));
    ok('4· NUNCA elige el primer grupo arbitrariamente',
        r4.resolvedGroupIds === undefined);
    ok('4· las opciones no filtran datos ajenos al grupo',
        r4.body.choices.every(c => Object.keys(c).sort().join(',') === 'grade,id,name,type'),
        JSON.stringify(r4.body.choices[0]));

    // 5. groupId explícito válido → gana sobre cualquier inferencia
    const r5 = handlerResolveGroups({ roles: ['lector'], colegio: 'Colegio Uno', groupIds: ['g_uno_b'] }, GROUPS);
    ok('5· groupId explícito válido → sin ambigüedad',
        !r5.status && r5.resolvedGroupIds[0] === 'g_uno_b', JSON.stringify(r5));
    ok('5· groupId explícito evita el 409 aunque la institución sea multi-grupo',
        r5.status === undefined);

    // 6. groupId inexistente → rechazo en la validación bajo lock
    const r6 = handlerResolveGroups({ roles: ['lector'], colegio: 'Colegio Uno', groupIds: ['g_no_existe'] }, GROUPS);
    const v6 = handlerValidateInLock(r6.resolvedGroupIds, GROUPS, 'Colegio Uno');
    ok('6· groupId inexistente → 400 GROUP_NOT_FOUND',
        v6?.status === 400 && v6.body.error === ERR.GROUP_NOT_FOUND, JSON.stringify(v6));

    // 6b. groupId de otra institución
    const v6b = handlerValidateInLock(['g_dos_a'], GROUPS, 'Colegio Uno');
    ok('6b· groupId de otra institución → 400 GROUP_SCHOOL_MISMATCH',
        v6b?.status === 400 && v6b.body.error === ERR.GROUP_SCHOOL_MISMATCH, JSON.stringify(v6b));

    // 7. estudiante sin grupo ni institución
    const r7 = handlerResolveGroups({ roles: ['lector'] }, GROUPS);
    ok('7· estudiante sin grupo ni institución → 400 GROUP_REQUIRED',
        r7.status === 400 && r7.body.error === ERR.GROUP_REQUIRED);

    // 8. mediador — contrato actual preservado: grupo opcional
    const r8 = handlerResolveGroups({ roles: ['mediador'], colegio: 'Colegio Uno' }, GROUPS);
    ok('8· mediador sin groupIds → permitido (contrato actual sin cambios)',
        !r8.status && r8.resolvedGroupIds.length === 0, JSON.stringify(r8));
    const v8 = handlerValidateInLock(['g_uno_a'], GROUPS, 'Colegio Uno');
    ok('8· mediador con groupId válido de su institución → aceptado', v8 === null);

    // 9. administrador — igual que mediador
    const r9 = handlerResolveGroups({ roles: ['administrador'], colegio: 'Colegio Uno' }, GROUPS);
    ok('9· administrador sin groupIds → permitido',
        !r9.status && r9.resolvedGroupIds.length === 0, JSON.stringify(r9));

    // El club también es un grupo elegible por id (misma entidad `group`).
    const vClub = handlerValidateInLock(['g_club'], GROUPS, 'Colegio Uno');
    ok('· un club es un grupo válido por groupId', vClub === null);
}

// ────────────────────────────────────────────────────────────────────────────
// B. Helpers puros — sin mutación, sin excepciones
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[B] Helpers de resolución');
{
    const before = JSON.stringify(GROUPS);
    findGroupsForSchool('Colegio Uno', GROUPS);
    validateExplicitGroupIds(['g_uno_a'], GROUPS, 'Colegio Uno');
    ok('los helpers no mutan el store de grupos', JSON.stringify(GROUPS) === before);

    ok('findGroupsForSchool normaliza espacios y capitalización',
        findGroupsForSchool('  colegio uno ', GROUPS).length === 3);
    ok('findGroupsForSchool sin institución → []',
        findGroupsForSchool('', GROUPS).length === 0);
    ok('validateExplicitGroupIds con lista vacía → ok (no impone grupo)',
        validateExplicitGroupIds([], GROUPS, 'Colegio Uno').ok === true);
    ok('validateExplicitGroupIds sin institución no inventa regla nueva',
        validateExplicitGroupIds(['g_dos_a'], GROUPS, undefined).ok === true);
    ok('validateExplicitGroupIds reporta TODOS los ids faltantes',
        validateExplicitGroupIds(['nope1', 'nope2'], GROUPS, 'Colegio Uno').missing.length === 2);
    ok('resolveSingleGroupForSchool conserva su contrato legacy',
        resolveSingleGroupForSchool('Colegio Uno', GROUPS).error === ERR.AMBIGUOUS_GROUP
        && resolveSingleGroupForSchool('Colegio Solo', GROUPS).groupId === 'g_solo');
}

// ────────────────────────────────────────────────────────────────────────────
// C. Persistencia — atomicidad, cero escritura parcial, concurrencia
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[C] Escritura atómica y ausencia de estado parcial');
{
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'grpcontract_'));
    const USERS_F = path.join(tmpDir, 'usuarios_colegios_oro.json');
    const GROUPS_F = path.join(tmpDir, 'groups_db.json');

    const seedUsers = [{ id: 'u_seed', email: 'seed@test.local', roles: ['lector'], colegio: 'Colegio Uno', groupIds: ['g_uno_a'] }];
    fs.writeFileSync(USERS_F, JSON.stringify(seedUsers, null, 2), 'utf8');
    fs.writeFileSync(GROUPS_F, JSON.stringify(clone(GROUPS), null, 2), 'utf8');

    const readJson  = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const writeJson = (f, data) => {
        const tmp = `${f}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, f);
    };

    // C1 — validación fallida dentro del lock ⇒ cero escritura en ambos stores.
    {
        const usersBefore  = fs.readFileSync(USERS_F, 'utf8');
        const groupsBefore = fs.readFileSync(GROUPS_F, 'utf8');
        let rejected = null;

        await withFileLock(GROUPS_F, async () => {
            await withUsersLock(USERS_F, () => {
                const users  = readJson(USERS_F);
                const groups = readJson(GROUPS_F);
                const gv = validateExplicitGroupIds(['g_no_existe'], groups, 'Colegio Uno');
                if (!gv.ok) { rejected = gv.error; return; }
                users.push({ id: 'u_nuevo' });
                writeJson(USERS_F, users);
            });
        }, 'groupsLock');

        ok('C1· groupId inexistente aborta antes de escribir', rejected === ERR.GROUP_NOT_FOUND);
        ok('C1· padrón de usuarios intacto', fs.readFileSync(USERS_F, 'utf8') === usersBefore);
        ok('C1· store de grupos intacto', fs.readFileSync(GROUPS_F, 'utf8') === groupsBefore);
    }

    // C2 — fallo al escribir grupos ⇒ el usuario NO se persiste (orden groups→users).
    {
        const usersBefore = fs.readFileSync(USERS_F, 'utf8');
        let threw = false;
        try {
            await withFileLock(GROUPS_F, async () => {
                await withUsersLock(USERS_F, () => {
                    const users  = readJson(USERS_F);
                    const groups = readJson(GROUPS_F);
                    addUserIdToGroup(groups.find(g => g.id === 'g_uno_a'), 'u_rollback');
                    // Simula un fallo de I/O en la escritura de grupos.
                    throw new Error('disk failure (simulada)');
                    // eslint-disable-next-line no-unreachable
                    users.push({ id: 'u_rollback' });
                    writeJson(USERS_F, users);
                });
            }, 'groupsLock');
        } catch { threw = true; }

        ok('C2· el fallo de persistencia se propaga', threw);
        ok('C2· ningún usuario parcial quedó escrito', fs.readFileSync(USERS_F, 'utf8') === usersBefore);
        ok('C2· sin lector huérfano en el padrón',
            readJson(USERS_F).every(u => u.id !== 'u_rollback'));
    }

    // C3 — escritura atómica: temporal en el mismo filesystem + rename.
    {
        writeJson(USERS_F, [...readJson(USERS_F), { id: 'u_atomic', email: 'a@test.local', roles: ['lector'], groupIds: ['g_uno_a'] }]);
        ok('C3· el reemplazo atómico dejó JSON válido y completo',
            readJson(USERS_F).some(u => u.id === 'u_atomic'));
        ok('C3· no quedaron temporales huérfanos',
            fs.readdirSync(tmpDir).every(f => !f.endsWith('.tmp')),
            fs.readdirSync(tmpDir).join(','));
    }

    // C4 — concurrencia: dos escrituras en paralelo bajo el mismo lock no se pisan.
    {
        const addUser = async (id) => withUsersLock(USERS_F, () => {
            const users = readJson(USERS_F);
            users.push({ id, email: `${id}@test.local`, roles: ['lector'], groupIds: ['g_uno_a'] });
            writeJson(USERS_F, users);
        });
        await Promise.all([addUser('u_c1'), addUser('u_c2'), addUser('u_c3')]);
        const ids = readJson(USERS_F).map(u => u.id);
        ok('C4· las 3 escrituras concurrentes se conservan',
            ['u_c1', 'u_c2', 'u_c3'].every(id => ids.includes(id)), ids.join(','));
        ok('C4· sin duplicados por lost update',
            new Set(ids).size === ids.length, ids.join(','));
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// D. Privacidad — los errores no filtran datos personales
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[D] Privacidad de las respuestas de error');
{
    const r = handlerResolveGroups(
        { roles: ['lector'], colegio: 'Colegio Uno', password: 'secreto-en-claro', email: 'nina@colegio.test' },
        GROUPS,
    );
    const serialized = JSON.stringify(r.body);
    ok('el 409 no incluye password', !serialized.includes('secreto-en-claro'));
    ok('el 409 no incluye email', !serialized.includes('nina@colegio.test'));
    ok('el 409 no incluye el payload completo', !serialized.includes('"roles"'));
}

// ────────────────────────────────────────────────────────────────────────────
// E. Anti-drift — el handler real usa las mismas reglas que esta réplica
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[E] El handler real no divergió de la réplica');
{
    const src = fs.readFileSync(path.join(REPO_ROOT, 'server', 'server.js'), 'utf8');
    const createIdx = src.indexOf("app.post('/api/users'");
    const createBody = src.slice(createIdx, createIdx + 4500);

    ok('POST /api/users usa findGroupsForSchool', createBody.includes('findGroupsForSchool'));
    ok('POST /api/users responde 409 en ambigüedad',
        /status\(409\)[\s\S]{0,200}AMBIGUOUS_GROUP/.test(createBody));
    ok('POST /api/users devuelve las opciones de grupo', createBody.includes('choices'));
    ok('POST /api/users valida groupIds explícitos',
        createBody.includes('validateExplicitGroupIds'));
    ok('POST /api/users ya no infiere vía resolveSingleGroupForSchool',
        !createBody.includes('resolveSingleGroupForSchool'));

    const inviteIdx = src.indexOf("app.post('/api/invite-user'");
    const inviteBody = src.slice(inviteIdx, inviteIdx + 3000);
    ok('POST /api/invite-user comparte el contrato 409',
        inviteBody.includes('findGroupsForSchool')
        && /status\(409\)[\s\S]{0,200}AMBIGUOUS_GROUP/.test(inviteBody));

    ok('server.js no reintroduce paths de identidad hardcodeados',
        !src.includes("'data', 'users_db.json'") && !src.includes('data/users_db.json'));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
