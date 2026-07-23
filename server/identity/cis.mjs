/**
 * cis.mjs — CHP-ID-01: Contrato de Identidad y Scope (CIS), CHP-ADR-01 §I.
 *
 * Única puerta de LECTURA de identidad/memberships/scope para la autorización
 * institucional. Resuelve sus fuentes EXCLUSIVAMENTE vía server/config.js
 * (USERS_DB / GROUPS_DB) — nunca por path hardcodeado (raíz de STAT-03/SEC-03).
 *
 * Compatibilidad identity.db (CHP-IDDB-01): cada lectura consulta primero la
 * fachada de cutover existente (tryIdentitySqliteRead). Con los flags
 * IDENTITY_* en default (OFF / read=json) la fachada devuelve null sin
 * overhead y se lee el JSON canónico. Este módulo NO escribe en ninguna
 * persistencia, NO abre identity.db y NO activa flags.
 *
 * Fail-closed (CHP-ADR-01 §I-2), sin catch-all silencioso:
 *   - identidad ausente o no demostrable contra el canónico → 'unauthenticated' (401)
 *   - principal verificado sin autorización para el scope   → 'forbidden' (403)
 *   - canónico ausente/ilegible/corrupto/inconsistente      → IdentityUnavailableError
 *     → 'unavailable' (503).
 * IDENTITY_UNAVAILABLE jamás se degrada a 403, lista vacía, total 0 ni false
 * presentado como decisión ordinaria. Solo se captura el error tipificado;
 * cualquier otro error de programación se propaga (debe verse).
 *
 * Identidad del caller: el id recibido (p. ej. header x-user-id) es un claim
 * `legacy_asserted` (CHP-ADR-01 §G.13) que aquí se VERIFICA contra el padrón
 * canónico configurado. NO es identidad criptográficamente verificada (eso
 * llega con ADR-04/CHP-ID-02) y NO habilita CHP-VAL-ISO-01.
 *
 * Privilegios globales (CHP-ADR-01 §G.8): los roles de plataforma NO amplían
 * scope institucional de forma implícita; todo grant global pasa por una
 * política declarada en PLATFORM_POLICIES y la decisión la referencia (`via`).
 *
 * Este módulo corre DESPUÉS de la autenticación de la ruta (requireUserAuth),
 * que ya rechaza cuentas inactivas; el CIS no re-evalúa accountStatus (paridad
 * con el contrato previo de scopeAccess).
 */
import fs from 'node:fs';
import { USERS_DB, GROUPS_DB } from '../config.js';
import {
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
    getGroupMembers,
} from '../../utils/groupMembership.mjs';
import { tryIdentitySqliteRead, markJsonRead } from '../db/identityReadFacade.js';

// Mapa de paths para la fachada de cutover (accessDb fuera del alcance de
// esta unidad). Mismos valores que usa el resto del server vía config.
const FACADE_PATHS = Object.freeze({ usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: null });

/** Error tipificado: el canónico no permite decidir. Mapea a 503, nunca a 403. */
export class IdentityUnavailableError extends Error {
    constructor(causeTag, detail) {
        super(`IDENTITY_UNAVAILABLE: ${causeTag}`);
        this.name = 'IdentityUnavailableError';
        this.code = 'IDENTITY_UNAVAILABLE';
        this.causeTag = causeTag;      // missing_store | unreadable_store | corrupt_store | inconsistent_store
        this.detail = detail ?? null;  // observabilidad interna; no se envía en respuestas HTTP
    }
}

/**
 * Políticas de grant global declaradas (CHP-ADR-01 §G.8). Un rol de
 * plataforma solo amplía scope a través de una entrada de esta tabla,
 * referenciada en la decisión — nunca por bypass implícito.
 */
export const PLATFORM_POLICIES = Object.freeze({
    platform_admin_full_institutional_read:
        'Rol de plataforma administrador: lectura de todos los scopes institucionales de Aula Viva. ' +
        'Grant global explícito que preserva el contrato previo (PASO 7 §13); su revisión pertenece a unidades posteriores.',
    mediator_aggregate_read:
        'Rol mediador: lectura de agregados institucionales anónimos (scope all / cohortes tipadas). ' +
        'Grant por rol explícito heredado del contrato PASO 7 §13.',
});

const ADMIN_ROLES    = new Set(['administrador', 'admin']);
const MEDIATOR_ROLES = new Set(['profesor', 'mediador', 'teacher', 'librarian', 'coordinator']);

// ── Lectura fail-closed del canónico ─────────────────────────────────────────

function readIdentityArray(file, domain) {
    // 1) Fachada de cutover identity.db: con flags default devuelve null.
    const viaSqlite = tryIdentitySqliteRead(file, FACADE_PATHS);
    if (Array.isArray(viaSqlite)) return viaSqlite;

    // 2) JSON canónico configurado. Cualquier imposibilidad de decidir es
    //    IdentityUnavailableError — nunca [] silencioso (anti-patrón previo).
    if (!fs.existsSync(file)) {
        throw new IdentityUnavailableError('missing_store', { domain });
    }
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        throw new IdentityUnavailableError('unreadable_store', { domain, message: e?.message });
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new IdentityUnavailableError('corrupt_store', { domain, message: e?.message });
    }
    if (!Array.isArray(parsed)) {
        throw new IdentityUnavailableError('inconsistent_store', { domain, shape: typeof parsed });
    }
    markJsonRead(file, FACADE_PATHS);
    return parsed;
}

// ── Normalización de principal ───────────────────────────────────────────────

function normalizeRoles(u) {
    const out = new Set();
    const push = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase()); };
    if (Array.isArray(u?.roles)) u.roles.forEach(push);
    push(u?.role);
    push(u?.rol);
    return out;
}

/**
 * kind: real | synthetic | unknown (CHP-ADR-01 §G.10). Solo el atributo
 * persistido prueba real/synthetic; todo lo demás es unknown. PROHIBIDO
 * inferir por IDs, nombres, conteos o listas.
 */
function principalKind(u) {
    return (u?.kind === 'real' || u?.kind === 'synthetic') ? u.kind : 'unknown';
}

function isMediatorOfGroup(g, principalId) {
    if (!g || !principalId) return false;
    if (g.mediatorId === principalId) return true;
    if (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(principalId)) return true;
    if (Array.isArray(g.mediadores) && g.mediadores.includes(principalId)) return true;
    return false;
}

// ── Contrato CIS ─────────────────────────────────────────────────────────────

/**
 * Verifica el claim de identidad contra el canónico configurado.
 * @returns {object|null} principal sin credenciales (§I-5), o null si no existe.
 * @throws {IdentityUnavailableError} si el canónico no permite decidir.
 */
export function getPrincipal(principalId) {
    if (typeof principalId !== 'string' || principalId.length === 0) return null;
    const users = readIdentityArray(USERS_DB, 'users');
    const u = users.find(x => x && x.id === principalId) || null;
    if (!u) return null;
    const roles = normalizeRoles(u);
    return {
        id: u.id,
        roles: [...roles],
        kind: principalKind(u),
        platformAdmin: [...roles].some(r => ADMIN_ROLES.has(r)),
        mediatorRole:  [...roles].some(r => MEDIATOR_ROLES.has(r)),
        // NUNCA exponer password ni credenciales (CHP-ADR-01 §I-5).
    };
}

/**
 * Memberships activas del principal (unión de canales explícitos canónicos;
 * el fallback legacy por colegio se conserva SOLO donde ya operaba: canales
 * explícitos vacíos + escuela mono-grupo — utils/groupMembership.mjs).
 * @returns {Array<{groupId, schoolId, role:'mediator'|'member', via}>}
 * @throws {IdentityUnavailableError}
 */
export function getMemberships(principalId) {
    if (typeof principalId !== 'string' || principalId.length === 0) return [];
    const users  = readIdentityArray(USERS_DB, 'users');
    const groups = readIdentityArray(GROUPS_DB, 'groups');
    const list = [];
    for (const g of groups) {
        if (!g || !g.id) continue; // dato sucio (grupo sin id) — inalcanzable, igual que en la lógica canónica
        if (isMediatorOfGroup(g, principalId)) {
            list.push({ groupId: g.id, schoolId: g.schoolId ?? null, role: 'mediator', via: 'explicit' });
        }
        const explicit = getExplicitGroupMembers(g, users);
        if (explicit.has(principalId)) {
            list.push({ groupId: g.id, schoolId: g.schoolId ?? null, role: 'member', via: 'explicit' });
        } else if (explicit.size === 0) {
            const fb = applyLegacyColegioFallback(g, users, groups);
            if (fb.used && fb.matched.has(principalId)) {
                list.push({ groupId: g.id, schoolId: g.schoolId ?? null, role: 'member', via: 'legacy_colegio_fallback' });
            }
        }
    }
    return list;
}

/**
 * Scope institucional del principal = UNIÓN explícita de sus memberships
 * (multi-membership de diseño). Los roles de plataforma NO aparecen aquí:
 * solo amplían acceso vía PLATFORM_POLICIES en authorizeScope.
 * @throws {IdentityUnavailableError}
 */
export function resolveScope(principalId) {
    const memberships = getMemberships(principalId);
    const mediatorGroupIds = new Set();
    const memberGroupIds   = new Set();
    const schoolIds        = new Set();
    for (const m of memberships) {
        if (m.role === 'mediator') {
            mediatorGroupIds.add(m.groupId);
            if (m.schoolId) schoolIds.add(m.schoolId);
        } else {
            memberGroupIds.add(m.groupId);
        }
    }
    return {
        mediatorGroupIds: [...mediatorGroupIds],
        memberGroupIds:   [...memberGroupIds],
        schoolIds:        [...schoolIds],
    };
}

/**
 * Decisión de acceso tipificada (CHP-ADR-01 §I-2). NUNCA lanza por
 * indisponibilidad del canónico: la devuelve como decision:'unavailable'.
 * Errores de programación sí se propagan (sin catch-all).
 *
 * @returns {{decision:'allow'|'unauthenticated'|'forbidden'|'unavailable',
 *            via?:string, cause?:string}}
 */
export function authorizeScope(principalId, scope_type, scope_id) {
    let principal;
    try {
        principal = getPrincipal(principalId);
    } catch (e) {
        if (e instanceof IdentityUnavailableError) {
            return { decision: 'unavailable', cause: e.causeTag };
        }
        throw e;
    }
    if (typeof principalId !== 'string' || principalId.length === 0) {
        return { decision: 'unauthenticated', cause: 'missing_principal' };
    }
    if (!principal) {
        return { decision: 'unauthenticated', cause: 'unknown_principal' };
    }

    if (principal.platformAdmin) {
        return { decision: 'allow', via: 'policy:platform_admin_full_institutional_read' };
    }

    const sid = String(scope_id ?? '');
    try {
        switch (scope_type) {
            case 'user': {
                if (sid === principal.id) return { decision: 'allow', via: 'self' };
                if (!principal.mediatorRole) return { decision: 'forbidden', cause: 'not_a_mediator' };
                const users  = readIdentityArray(USERS_DB, 'users');
                const groups = readIdentityArray(GROUPS_DB, 'groups');
                for (const g of groups) {
                    if (!g || !g.id || !isMediatorOfGroup(g, principal.id)) continue;
                    const members = getGroupMembers(g, users, { allGroups: groups });
                    if (members.includes(sid)) {
                        return { decision: 'allow', via: 'mediator_of_member_group' };
                    }
                }
                return { decision: 'forbidden', cause: 'target_not_in_mediated_groups' };
            }
            case 'group':
            case 'club': {
                if (!principal.mediatorRole) return { decision: 'forbidden', cause: 'not_a_mediator' };
                const scope = resolveScope(principal.id);
                return scope.mediatorGroupIds.includes(sid)
                    ? { decision: 'allow', via: 'mediator_of_group' }
                    : { decision: 'forbidden', cause: 'not_mediator_of_group' };
            }
            case 'school': {
                if (!principal.mediatorRole) return { decision: 'forbidden', cause: 'not_a_mediator' };
                const scope = resolveScope(principal.id);
                return scope.schoolIds.includes(sid)
                    ? { decision: 'allow', via: 'mediator_in_school' }
                    : { decision: 'forbidden', cause: 'not_mediator_in_school' };
            }
            case 'library': {
                // Sin scope library funcional aún → admin-only (política arriba).
                return { decision: 'forbidden', cause: 'library_admin_only' };
            }
            case 'all':
            case 'intervention':
            case 'risk':
            case 'habit':
            case 'modality':
            case 'trajectory': {
                return principal.mediatorRole
                    ? { decision: 'allow', via: 'policy:mediator_aggregate_read' }
                    : { decision: 'forbidden', cause: 'aggregate_mediator_only' };
            }
            default:
                return { decision: 'forbidden', cause: 'unknown_scope_type' };
        }
    } catch (e) {
        if (e instanceof IdentityUnavailableError) {
            return { decision: 'unavailable', cause: e.causeTag };
        }
        throw e;
    }
}
