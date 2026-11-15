/**
 * count-legacy-mediation.mjs — SEC-SESSION-IDENTITY-04U.
 *
 * Recuento de SOLO LECTURA de cómo está asignada la mediación en los grupos activos. Responde una
 * pregunta previa al despliegue del hotfix de sesiones: ¿cuántos grupos activos dependen únicamente
 * del campo heredado `teacherId`? El CIS (la autoridad de alcance) no reconoce `teacherId`; quien
 * solo figure ahí deja de ver el progreso de sus lectores con el hotfix.
 *
 * Qué hace: abre tres archivos en lectura (grupos, usuarios, colegios), clasifica en memoria con
 * el MISMO módulo puro que usa el CIS (`server/identity/organizationScope.mjs`) y escribe en la
 * salida estándar un único objeto JSON de recuentos. Nada más.
 *
 * Qué NO hace: no escribe, no crea ni modifica archivos, no abre bases SQLite, no usa la red, no
 * carga el servidor ni el CIS (que registra observaciones), y no imprime nombres, correos ni
 * identificadores de personas, grupos o colegios: solo enteros bajo claves fijas.
 *
 * Uso (desde la raíz de la aplicación; en el contenedor, /app):
 *   node scripts/ops/count-legacy-mediation.mjs
 *   # o, sin copiar nada al contenedor, por la entrada estándar:
 *   docker exec -i <réplica api> node --input-type=module - < scripts/ops/count-legacy-mediation.mjs
 *
 * Rutas: GROUPS_DB / USERS_DB / SCHOOLS_DB del entorno del proceso (las mismas variables que el
 * servidor); si faltan, se rechaza la ejecución en vez de suponer una ruta.
 * Código de salida: 0 = recuento emitido; 2 = no se pudo decidir (sin rutas o almacén ilegible).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MEDIATOR_ROLES = new Set(['profesor', 'mediador', 'teacher', 'librarian', 'coordinator']); // = cis.mjs
const arr = (x) => (Array.isArray(x) ? x : []);
const isId = (x) => typeof x === 'string' && x.length > 0;

function hasMediatorRole(user) {
    const roles = [...arr(user?.roles), user?.role, user?.rol];
    return roles.some((r) => typeof r === 'string' && MEDIATOR_ROLES.has(r.trim().toLowerCase()));
}

/**
 * Recuento puro. `scope` = { classifyGroup, registeredOrganizationIds, GROUP_CLASS } de organizationScope.mjs.
 * @returns {object} solo enteros.
 */
export function countMediation({ groups, users, schools }, scope) {
    const usersById = new Map(arr(users).filter((u) => isId(u?.id)).map((u) => [u.id, u]));
    const ctx = { registeredOrgIds: scope.registeredOrganizationIds(schools), usersById };
    const isMediator = (id) => isId(id) && hasMediatorRole(usersById.get(id));
    const out = {
        groupsTotal: 0,
        groupsActive: 0,
        groupsOutOfActiveScope: 0,
        activeWithCisMediator: 0,
        activeTeacherIdOnly: 0,
        activeWithoutCisMediator: 0,
        activeWithCisMediatorAndOtherTeacherId: 0,
    };
    for (const g of arr(groups)) {
        out.groupsTotal += 1;
        if (!g || scope.classifyGroup(g, ctx).class !== scope.GROUP_CLASS.ACTIVE_REAL) { out.groupsOutOfActiveScope += 1; continue; }
        out.groupsActive += 1;
        // Lo que el CIS reconoce como mediación (cis.mjs · isMediatorOfGroup) y que además tenga rol de mediador.
        const declared = new Set([g.mediatorId, ...arr(g.mediatorIds), ...arr(g.mediadores)].filter(isId));
        const recognised = [...declared].some(isMediator);
        const legacyTeacher = isMediator(g.teacherId) && !declared.has(g.teacherId);
        if (recognised) {
            out.activeWithCisMediator += 1;
            if (legacyTeacher) out.activeWithCisMediatorAndOtherTeacherId += 1;
        } else if (legacyTeacher) {
            out.activeTeacherIdOnly += 1;
        } else {
            out.activeWithoutCisMediator += 1;
        }
    }
    return out;
}

function readArray(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY);
    try {
        const parsed = JSON.parse(fs.readFileSync(fd, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error('not_an_array');
        return parsed;
    } finally { fs.closeSync(fd); }
}

async function main() {
    const root = process.env.CHP_APP_ROOT || process.cwd();
    const paths = { groups: process.env.GROUPS_DB, users: process.env.USERS_DB, schools: process.env.SCHOOLS_DB };
    const missing = Object.entries(paths).filter(([, p]) => !isId(p)).map(([k]) => k);
    if (missing.length) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: 'missing_store_path', stores: missing })}\n`);
        return 2;
    }
    let scope, data;
    try {
        scope = await import(pathToFileURL(path.join(root, 'server', 'identity', 'organizationScope.mjs')).href);
        data = { groups: readArray(paths.groups), users: readArray(paths.users), schools: readArray(paths.schools) };
    } catch (e) {
        // El motivo, nunca la ruta ni el contenido.
        process.stdout.write(`${JSON.stringify({ ok: false, error: 'store_unreadable', reason: e?.code || e?.message?.slice(0, 40) || 'unknown' })}\n`);
        return 2;
    }
    const counts = countMediation(data, scope);
    process.stdout.write(`${JSON.stringify({
        ok: true,
        unit: 'SEC-SESSION-IDENTITY-04U',
        generatedAt: new Date().toISOString(),
        // Si la réplica sirve la identidad desde SQLite, este recuento (JSON canónico) debe confirmarse contra ese modo.
        identityReadMode: { IDENTITY_READ: process.env.IDENTITY_READ || null, IDENTITY_SQLITE_ENABLED: process.env.IDENTITY_SQLITE_ENABLED || null },
        counts,
    })}\n`);
    return 0;
}

// Solo se ejecuta como programa (archivo o entrada estándar); al importarse desde una prueba, no.
const invoked = !process.argv[1] || process.argv[1] === '-' || pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = await main();
