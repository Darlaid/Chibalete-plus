/**
 * scopeAccess.mjs — PASO 7 §13.
 *
 * Validación de acceso a scopes institucionales SIN tocar el middleware
 * de auth global (regla del proyecto: no modificar auth). Esta capa se
 * llama DESPUÉS de `requireUserAuth` (que ya validó que el x-user-id
 * existe en users_db.json).
 *
 * Política:
 *   - Admin → acceso a TODOS los scopes.
 *   - Mediador / profesor → acceso a scope='user' SI el user es miembro de
 *     ALGÚN grupo donde el caller es mediador. Acceso a scope='group' SI
 *     el caller es mediador de ese grupo. Acceso a scope='school' SI
 *     coordina/media en ese school. Acceso a scope='club' análogo a group.
 *   - Lector (estudiante) → acceso solo a scope='user' con su propio id.
 *   - Default-deny: si no aplica ninguna regla → false.
 *
 * Library scope: hoy no hay tabla; queda como "admin-only" hasta PASO 8.
 *
 * NUNCA lanza. Devuelve siempre boolean. Errores leídos como deny.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_PATH  = path.resolve(__dirname, '..', '..', 'data', 'users_db.json');
const GROUPS_PATH = path.resolve(__dirname, '..', '..', 'data', 'groups_db.json');

function readJsonSafe(p) {
    try {
        if (!fs.existsSync(p)) return [];
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return []; }
}

function getUser(userId) {
    if (!userId) return null;
    const users = readJsonSafe(USERS_PATH);
    return (Array.isArray(users) ? users : []).find(u => u?.id === userId) || null;
}

function isAdmin(user) {
    if (!user || !user.role) return false;
    const r = String(user.role).toLowerCase();
    return r === 'administrador' || r === 'admin';
}
function isMediator(user) {
    if (!user || !user.role) return false;
    const r = String(user.role).toLowerCase();
    return r === 'profesor' || r === 'mediador' || r === 'teacher'
        || r === 'librarian' || r === 'coordinator';
}

/**
 * Lista grupos donde el caller es mediador (groups.mediatorIds[] o
 * groups.mediatorId — soporta ambas formas históricas).
 */
function listGroupsForMediator(callerId) {
    const groups = readJsonSafe(GROUPS_PATH);
    if (!Array.isArray(groups)) return [];
    return groups.filter(g => {
        if (!g) return false;
        if (g.mediatorId === callerId) return true;
        if (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(callerId)) return true;
        if (Array.isArray(g.mediadores) && g.mediadores.includes(callerId)) return true;
        return false;
    });
}

/**
 * Devuelve true si `callerId` puede acceder a `(scope_type, scope_id)`.
 */
export function canAccessScope(callerId, scope_type, scope_id) {
    try {
        const caller = getUser(callerId);
        if (!caller) return false;
        if (isAdmin(caller)) return true;

        const sid = String(scope_id || '');
        switch (scope_type) {
            case 'user': {
                if (sid === callerId) return true;        // propio perfil
                if (!isMediator(caller)) return false;
                // mediador puede ver users de SUS grupos
                const myGroups = listGroupsForMediator(callerId);
                for (const g of myGroups) {
                    const members = Array.isArray(g.memberIds) ? g.memberIds : [];
                    if (members.includes(sid)) return true;
                }
                return false;
            }
            case 'group':
            case 'club': {
                if (!isMediator(caller)) return false;
                const myGroups = listGroupsForMediator(callerId);
                return myGroups.some(g => g.id === sid);
            }
            case 'school': {
                if (!isMediator(caller)) return false;
                const myGroups = listGroupsForMediator(callerId);
                return myGroups.some(g => g.schoolId === sid);
            }
            case 'library': {
                // No hay scope library funcional aún → admin-only.
                return false;
            }
            case 'all': {
                // Agregados globales: admin o mediator (lectura institucional anónima).
                return isMediator(caller);
            }
            case 'intervention':
            case 'risk':
            case 'habit':
            case 'modality':
            case 'trajectory': {
                // Agregados de cohorte tipo: lectura por mediadores/admin.
                return isMediator(caller);
            }
            default:
                return false;
        }
    } catch { return false; }
}

/**
 * Middleware-helper para los handlers institucionales. Si NO autoriza,
 * responde 403 + reason y NO continúa.
 */
export function requireScopeAccess(scope_type, scope_id, req, res) {
    const callerId = req.headers['x-user-id'];
    if (canAccessScope(callerId, scope_type, scope_id)) return true;
    res.status(403).json({ ok: false, error: 'scope_access_denied',
                            scope_type, scope_id });
    return false;
}
