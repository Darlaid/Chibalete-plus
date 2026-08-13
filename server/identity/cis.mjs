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
import { USERS_DB, GROUPS_DB, SCHOOLS_DB } from '../config.js';
import {
    getExplicitGroupMembers,
    getGroupMembers,
} from '../../utils/groupMembership.mjs';
import {
    GROUP_CLASS,
    SCOPE_REASON,
    registeredOrganizationIds,
    classifyGroup,
} from './organizationScope.mjs';
import { tryIdentitySqliteRead, markJsonRead } from '../db/identityReadFacade.js';
import { observeIdentityShadowRead } from '../db/identityShadowCompare.js';

// Mapa de paths para la fachada de cutover (accessDb fuera del alcance de
// esta unidad). Mismos valores que usa el resto del server vía config.
const FACADE_PATHS = Object.freeze({ usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: null });
// CHP-IDDB-02C-B: el comparador sombra sí cubre schools, porque observa sin
// servir. Que una superficie sea observable NO la hace elegible para cutover.
const COMPARE_PATHS = Object.freeze({
    usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: null, schoolsDb: SCHOOLS_DB,
});

export { GROUP_CLASS, SCOPE_REASON };

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
    // 02C-B — observación sombra de una superficie de AUTORIZACIÓN. `parsed` ya
    // es el resultado oficial y se devuelve intacto: el comparador no lo muta,
    // no lo sustituye y no puede lanzar.
    try {
        observeIdentityShadowRead(file, parsed, COMPARE_PATHS, { surface: 'cis' });
    } catch { /* la observación jamás altera una decisión de autorización */ }
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
 * Contexto de clasificación institucional: el registro de organizaciones y el
 * índice de usuarios necesarios para decidir ACTIVE_REAL / HISTORICAL /
 * SYNTHETIC sin recurrir a ningún texto.
 * @throws {IdentityUnavailableError} si el registro no permite decidir.
 */
function organizationContext(users) {
    const schools = readIdentityArray(SCHOOLS_DB, 'schools');
    return {
        registeredOrgIds: registeredOrganizationIds(schools),
        usersById: new Map((users || []).filter(u => u?.id).map(u => [u.id, u])),
    };
}

/**
 * Memberships del principal, por canales EXPLÍCITOS del grupo únicamente.
 *
 * CHP-ID-GROUPS-RECON-01B: el fallback legacy por nombre de colegio queda fuera
 * de toda decisión de scope — era autorización basada en texto. Cada membership
 * declara además la clasificación del grupo y su `organizationId`, que es la
 * única autoridad institucional (ya no existe `schoolId`).
 *
 * @returns {Array<{groupId, organizationId, groupClass, role:'mediator'|'member', via}>}
 * @throws {IdentityUnavailableError}
 */
export function getMemberships(principalId) {
    if (typeof principalId !== 'string' || principalId.length === 0) return [];
    const users  = readIdentityArray(USERS_DB, 'users');
    const groups = readIdentityArray(GROUPS_DB, 'groups');
    const ctx    = organizationContext(users);
    const list = [];
    for (const g of groups) {
        if (!g || !g.id) continue; // grupo sin id: sin clave estable, nunca sostiene scope
        const cls = classifyGroup(g, ctx);
        const base = { groupId: g.id, organizationId: cls.organizationId, groupClass: cls.class };
        if (isMediatorOfGroup(g, principalId)) {
            list.push({ ...base, role: 'mediator', via: 'explicit' });
        }
        if (getExplicitGroupMembers(g, users).has(principalId)) {
            list.push({ ...base, role: 'member', via: 'explicit' });
        }
    }
    return list;
}

/**
 * Scope institucional del principal = UNIÓN de sus memberships, restringida a
 * grupos ACTIVE_REAL. Los históricos y los sintéticos no aportan scope aunque
 * el principal los medie. Los roles de plataforma NO aparecen aquí: solo
 * amplían acceso vía PLATFORM_POLICIES en authorizeScope.
 * @throws {IdentityUnavailableError}
 */
export function resolveScope(principalId) {
    const memberships = getMemberships(principalId);
    const mediatorGroupIds = new Set();
    const memberGroupIds   = new Set();
    const organizationIds  = new Set();
    for (const m of memberships) {
        if (m.groupClass !== GROUP_CLASS.ACTIVE_REAL) continue;
        if (m.role === 'mediator') {
            mediatorGroupIds.add(m.groupId);
            if (m.organizationId) organizationIds.add(m.organizationId);
        } else {
            memberGroupIds.add(m.groupId);
        }
    }
    return {
        mediatorGroupIds: [...mediatorGroupIds],
        memberGroupIds:   [...memberGroupIds],
        organizationIds:  [...organizationIds],
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
                const ctx    = organizationContext(users);
                let sawOutOfScopeGroup = null;
                for (const g of groups) {
                    if (!g || !g.id || !isMediatorOfGroup(g, principal.id)) continue;
                    const cls = classifyGroup(g, ctx);
                    if (cls.class !== GROUP_CLASS.ACTIVE_REAL) {
                        sawOutOfScopeGroup = cls.reason ?? SCOPE_REASON.GROUP_NOT_IN_ACTIVE_SCOPE;
                        continue; // un grupo fuera de scope no da visibilidad sobre nadie
                    }
                    // Sin fallback por nombre de colegio: solo pertenencia explícita.
                    const members = getGroupMembers(g, users, {
                        allGroups: groups, useLegacyColegioFallback: false,
                    });
                    if (members.includes(sid)) {
                        return { decision: 'allow', via: 'mediator_of_member_group' };
                    }
                }
                return {
                    decision: 'forbidden',
                    cause: sawOutOfScopeGroup ?? 'target_not_in_mediated_groups',
                };
            }
            case 'group':
            case 'club': {
                if (!principal.mediatorRole) return { decision: 'forbidden', cause: 'not_a_mediator' };
                const scope = resolveScope(principal.id);
                if (scope.mediatorGroupIds.includes(sid)) {
                    return { decision: 'allow', via: 'mediator_of_group' };
                }
                // Diagnóstico tipificado: distingue "no lo medias" de "lo medias
                // pero ese grupo está fuera del scope activo".
                const groups = readIdentityArray(GROUPS_DB, 'groups');
                const target = groups.find(g => g?.id === sid);
                if (target && isMediatorOfGroup(target, principal.id)) {
                    const users = readIdentityArray(USERS_DB, 'users');
                    const cls = classifyGroup(target, organizationContext(users));
                    return { decision: 'forbidden',
                             cause: cls.reason ?? SCOPE_REASON.GROUP_NOT_IN_ACTIVE_SCOPE };
                }
                return { decision: 'forbidden', cause: 'not_mediator_of_group' };
            }
            case 'school':
            case 'organization': {
                // El scope institucional se identifica SIEMPRE por organizationId
                // registrado. Un nombre de colegio nunca es un scope_id válido.
                if (!principal.mediatorRole) return { decision: 'forbidden', cause: 'not_a_mediator' };
                const users = readIdentityArray(USERS_DB, 'users');
                const { registeredOrgIds } = organizationContext(users);
                if (!registeredOrgIds.has(sid)) {
                    return { decision: 'forbidden', cause: SCOPE_REASON.ORGANIZATION_NOT_REGISTERED };
                }
                const scope = resolveScope(principal.id);
                return scope.organizationIds.includes(sid)
                    ? { decision: 'allow', via: 'mediator_in_organization' }
                    : { decision: 'forbidden', cause: SCOPE_REASON.ORGANIZATION_MISMATCH };
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
