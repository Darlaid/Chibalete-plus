/**
 * utils/membershipGovernance.mjs — lógica pura de la state machine de
 * membership governance.
 *
 * Sprint MGL Fase 1 / M1 — extrae las funciones puras que antes vivían
 * inline en server/server.js (~3590-4048) a un módulo ESM compartido:
 *
 *   - sameSchool                       (normalización + match)
 *   - validateSameInstitution          (cross-school gate)
 *   - countFallbackVisibleLectors      (active path counter)
 *   - resolveMaterializableUsers       (single source of truth del conjunto materializable)
 *   - detectGroupMaterializationState  (classifier oficial de los 4 estados)
 *   - buildGovernanceIndexes           (indexes precomputados para evitar O(n²))
 *
 * Reglas de diseño:
 *   - JavaScript ESM puro. Sin imports de Node. Sin acceso a disco.
 *   - Pure functions: mismo input → mismo output. Sin side effects.
 *   - Consume `utils/groupMembership.mjs` (fuente única de membresía base).
 *   - No reimplementa `applyLegacyColegioFallback`, `getExplicitGroupMembers`,
 *     `userIsLectorLike` — los importa.
 *   - Determinismo: cuando devuelve arrays de userIds, ordena lexicográficamente
 *     (crítico para reproducibilidad forensic del audit sampling).
 *
 * Nota sobre nombres:
 *   En server.js las funciones tenían prefijo `_` (convención privada). Aquí
 *   se exportan con nombres limpios. server.js las re-aliasa al `_` previo
 *   para que el resto del archivo (handlers de mutación) NO requiera cambios.
 *
 * Tests: utils/__tests__/membershipGovernance.test.mjs
 *
 * NO MOVER A ESTE MÓDULO:
 *   - writeAuditLog                    (side effect: persiste audit log)
 *   - withFileLock / mutateGroups / mutateUsers (I/O)
 *   - writeJSON / readJSON             (I/O)
 *   - normalizeGroup                   (side effect bidireccional + lookups SCHOOLS_DB)
 *   - request handlers / Express routes
 */

import {
    READER_ROLE,
    userIsLectorLike,
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
    isOperationallyEligibleLector,
    isOperationallyEligibleFallbackUser,
} from './groupMembership.mjs';

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

const arr = (x) => (Array.isArray(x) ? x : []);

// ────────────────────────────────────────────────────────────────────────────
// normalizeSchoolKey — ÚNICA authority de normalización para "same school".
//
// Cualquier semántica que compare nombres de escuela (sameSchool,
// validateSameInstitution fallback, indexes, classifier single-school check,
// future grouping/filtering/sorting) DEBE pasar por este helper. Prohibido
// reimplementar `s.trim().toLowerCase()` inline en cualquier consumer.
//
// Reglas:
//   - input no-string → ''
//   - trim + toLowerCase
//   - empty post-trim → '' (caller decide si '' es válido)
//
// Devuelve string canónico (puede ser '' si input es inválido o vacío).
// ────────────────────────────────────────────────────────────────────────────

export function normalizeSchoolKey(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

// Versión interna inferida de la pública para compat con el código previo
// (era `norm()` privado). Mantener nombre `norm` para diff mínimo en bloques
// que ya lo usaban.
const norm = normalizeSchoolKey;

// ────────────────────────────────────────────────────────────────────────────
// sameSchool — comparador normalizado para institución por nombre.
//
// Hardening empty-string: si cualquiera de los strings queda vacío después
// de trim, devolvemos false. Razón: "" === "" colapsaba a true, lo que
// significaba que dos entries SIN institución especificada se trataban como
// "misma institución" — un falso positivo silencioso. Sin esta guarda, un
// user con colegio="" pasaba el cross-school check contra cualquier group
// con school="" (data drift). Empty-vs-empty NO es match.
// ────────────────────────────────────────────────────────────────────────────

export function sameSchool(userColegio, groupSchool) {
    const a = normalizeSchoolKey(userColegio);
    const b = normalizeSchoolKey(groupSchool);
    if (a.length === 0 || b.length === 0) return false;
    return a === b;
}

// ────────────────────────────────────────────────────────────────────────────
// validateSameInstitution — gate de seguridad cross-school.
//
// Misma semántica que el filtro de candidates (server.js line ~3376): si
// cualquiera de los dos canales coincide, se considera misma institución:
//   1. organizationId match (preferente, definitivo cuando ambos lo tienen)
//   2. fallback colegio normalizado (lowercase + trim) — soporte legacy
//
// NO bloquea fallback colegio legítimo: un user con colegio="Chibalete"
// pasa la validación contra group.school="Chibalete" (con o sin acentos
// normalizados, sin diferenciar mayúsculas).
//
// Devuelve true si la asignación/mutación está permitida, false si es cross-
// school. El caller decide la semántica de error (failed[], 422, etc.).
// ────────────────────────────────────────────────────────────────────────────

export function validateSameInstitution(user, group) {
    if (!user || !group) return false;
    const sameOrg = !!(user.organizationId && group.organizationId
        && user.organizationId === group.organizationId);
    if (sameOrg) return true;
    return sameSchool(user.colegio, group.school);
}

// ────────────────────────────────────────────────────────────────────────────
// countFallbackVisibleLectors — cuenta lectores que aparecerían vía fallback
// colegio para este grupo, SIN aplicar el gate de peers (single-school).
//
// Sprint MGL M2.1a — antes este helper duplicaba la regla de "lector
// fallback-elegible" con un check distinto al del resolver (no excluía
// soft-deleted). Ahora delega 100% a `isOperationallyEligibleFallbackUser`,
// el SoT compartido en `utils/groupMembership.mjs`. Resultado:
//   - Cero duplicación de regla.
//   - Endurecimiento automático: soft-deleted ya no se cuentan.
//   - Diverge de `applyLegacyColegioFallback(...).matched.size` SOLO en
//     el peer gate: este helper NO valida que la escuela tenga 1 grupo.
//     Razón: callsites legacy (extinction risk guard, materialize audit)
//     necesitan el raw count del universo "matching colegio" para audit
//     metadata, no el resolver gate-ado. Los callsites que sí necesitan
//     el resolver-flavor (M2 snapshot) usan applyLegacyColegioFallback
//     directamente.
// ────────────────────────────────────────────────────────────────────────────

export function countFallbackVisibleLectors(group, allUsers) {
    if (!group || typeof group !== 'object') return 0;
    let count = 0;
    for (const u of (allUsers || [])) {
        if (isOperationallyEligibleFallbackUser(u, group)) count++;
    }
    return count;
}

// ────────────────────────────────────────────────────────────────────────────
// resolveMaterializableUsers — ÚNICO punto de cálculo del conjunto materializable.
//
// Classifier, dryRun preview, execute path, audit metadata, y cualquier
// caller futuro (resurrection, reconciliation, scripts, UI governance) DEBEN
// reusar este helper. Prohibido reimplementar la lógica inline.
//
// Fórmula formal:
//   materializable = applyLegacyColegioFallback(g).matched ∖ getExplicitGroupMembers(g)
//
// Determinismo: orden lexicográfico vía sort(). Mismo input → mismo output
// cross-replica, cross-replay, cross-version. Crítico para reproducibilidad
// forensic del audit sampling.
//
// PURO. No toca disco, no toca locks.
// ────────────────────────────────────────────────────────────────────────────

export function resolveMaterializableUsers(group, users, allGroups) {
    const matched = applyLegacyColegioFallback(group, users, allGroups).matched;
    const explicit = getExplicitGroupMembers(group, users);
    return [...matched]
        .filter(uid => !explicit.has(uid))
        .sort();
}

// ────────────────────────────────────────────────────────────────────────────
// detectGroupMaterializationState — classifier centralizado.
//
// Estados terminales (cuatro):
//   - 'fallback_dependent'   → operación target (PROCEED)
//   - 'fully_explicit'       → noOp legítimo (todos los lectores ya explícitos)
//   - 'empty_inert'          → noOp (no hay fallback semánticamente activable)
//   - 'mixed_legacy_state'   → 422 (coexistencia ambigua, requiere intervención)
//
// reasonCode (taxonomía oficial Commit 6):
//   fallback_dependent:  'single_school_implicit'
//   fully_explicit:      'no_remaining_fallback_visibility'
//   empty_inert:         'no_school' | 'multi_school' | 'no_lectores'
//   mixed_legacy_state:  'partial_explicitification' | 'cross_school_corruption'
//
// mixedSeverity (sólo para mixed_legacy_state):
//   'recoverable' → todos los explícitos pasan validateSameInstitution con g
//   'corrupted'   → ≥1 explícito viola same-institution (cross-school drift)
//
// Orphan IDs (explicit channel apunta a userId no resoluble) NO se cuentan
// como corrupción — son issue separada (syncGroupMembership los limpia).
//
// PURO. Caller provee userById Map pre-computado para evitar O(N) lookups.
// ────────────────────────────────────────────────────────────────────────────

// Versión del classifier — bump cuando taxonomía cambie (estados, reasonCodes,
// mixedSeverity, semántica de fields). Permite forensic replay y dashboards
// que filtren por versión cuando se introduzcan v2/v3.
export const CLASSIFIER_VERSION = 1;

export function detectGroupMaterializationState(group, users, allGroups, userById) {
    // 0) Defensa contra group sin school válido
    const targetSchool = normalizeSchoolKey(group?.school);
    if (targetSchool.length === 0) {
        return {
            classifierVersion:           CLASSIFIER_VERSION,
            state:                       'empty_inert',
            reasonCode:                  'no_school',
            explicitCount:               0,
            fallbackEligibleNotExplicit: 0,
            crossSchoolExplicitCount:    0,
            mixedSeverity:               null,
            isSingleSchool:              false,
        };
    }

    // 1) Single-school check (peers.length === 1)
    let peers = 0;
    for (const g of (allGroups || [])) {
        if (normalizeSchoolKey(g?.school) === targetSchool) peers++;
        if (peers > 1) break;
    }
    const isSingleSchool = peers === 1;

    // 2) Explicit members snapshot
    const explicit = getExplicitGroupMembers(group, users);
    const explicitCount = explicit.size;

    // 3) fallbackEligibleNotExplicit — derivado del resolver canónico (SoT).
    //    applyLegacyColegioFallback YA gate-a sobre single-school: bajo multi-
    //    school devuelve matched vacío. Reusar el resolver garantiza que el
    //    classifier NUNCA diverja del execute path (anti-drift architectural).
    const materializableFromResolver = resolveMaterializableUsers(group, users, allGroups);
    const fallbackEligibleNotExplicit = materializableFromResolver.length;

    // 4) Cross-school explicit count (informativo + driver de mixedSeverity)
    let crossSchoolExplicitCount = 0;
    if (explicitCount > 0) {
        for (const uid of explicit) {
            const u = userById?.get(uid);
            if (!u) continue;  // orphan ID — fuera del scope del classifier
            if (!validateSameInstitution(u, group)) crossSchoolExplicitCount++;
        }
    }

    // 5) State resolution
    //
    // Matriz definitiva:
    //                       │ single-school │ multi-school │
    // ─────────────────────────────────────────────────────
    // explicit=0, elig=0    │ empty_inert   │ empty_inert  │
    //                       │  no_lectores  │ multi_school │
    // explicit=0, elig>0    │ fallback_dep  │ (imposible)  │
    //                       │  single_impl. │              │
    // explicit>0, elig=0    │ fully_explicit│ fully_explicit│
    //                       │  no_remaining │ no_remaining │
    // explicit>0, elig>0    │ mixed_legacy  │ (imposible)  │
    //                       │  partial_expl │              │
    //                       │  cross_school │              │
    //
    // (elig>0 implica single-school por contrato de applyLegacyColegioFallback —
    //  el contador anterior sólo se incrementa bajo isSingleSchool.)

    if (explicitCount === 0) {
        if (!isSingleSchool) {
            return {
                classifierVersion:           CLASSIFIER_VERSION,
                state:                       'empty_inert',
                reasonCode:                  'multi_school',
                explicitCount:               0,
                fallbackEligibleNotExplicit: 0,
                crossSchoolExplicitCount:    0,
                mixedSeverity:               null,
                isSingleSchool:              false,
            };
        }
        if (fallbackEligibleNotExplicit === 0) {
            return {
                classifierVersion:           CLASSIFIER_VERSION,
                state:                       'empty_inert',
                reasonCode:                  'no_lectores',
                explicitCount:               0,
                fallbackEligibleNotExplicit: 0,
                crossSchoolExplicitCount:    0,
                mixedSeverity:               null,
                isSingleSchool:              true,
            };
        }
        return {
            classifierVersion:           CLASSIFIER_VERSION,
            state:                       'fallback_dependent',
            reasonCode:                  'single_school_implicit',
            explicitCount:               0,
            fallbackEligibleNotExplicit,
            crossSchoolExplicitCount:    0,
            mixedSeverity:               null,
            isSingleSchool:              true,
        };
    }

    // explicitCount > 0
    if (fallbackEligibleNotExplicit === 0) {
        return {
            classifierVersion:           CLASSIFIER_VERSION,
            state:                       'fully_explicit',
            reasonCode:                  'no_remaining_fallback_visibility',
            explicitCount,
            fallbackEligibleNotExplicit: 0,
            crossSchoolExplicitCount,    // informativo
            mixedSeverity:               null,
            isSingleSchool,
        };
    }

    // explicitCount > 0 && fallbackEligibleNotExplicit > 0 → mixed
    // (sólo posible bajo isSingleSchool por construcción)
    const corrupted = crossSchoolExplicitCount > 0;
    return {
        classifierVersion:           CLASSIFIER_VERSION,
        state:                       'mixed_legacy_state',
        reasonCode:                  corrupted ? 'cross_school_corruption' : 'partial_explicitification',
        explicitCount,
        fallbackEligibleNotExplicit,
        crossSchoolExplicitCount,
        mixedSeverity:               corrupted ? 'corrupted' : 'recoverable',
        isSingleSchool:              true,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// buildGovernanceIndexes — precomputa indexes O(N+M) reutilizables.
//
// Objetivo: cualquier consumidor que necesite clasificar N grupos sobre M
// users debe poder hacerlo en O(N+M) total, no en O(N×M). Para el endpoint
// de governance snapshot (M2), que clasifica TODOS los grupos del sistema,
// el costo agregado se vuelve significativo sin esto.
//
// Output:
//   indexVersion:    number    — bump cuando shape cambie (forensic + dashboards)
//   userById:        Map<userId, user>
//   usersBySchool:   Map<normalizedSchool, user[]>      — SOLO lectores op-válidos
//   groupsBySchool:  Map<normalizedSchool, group[]>     — todos los grupos con school
//
// Hardening operacional de `usersBySchool` (regla M1-delta):
//   Excluye users con cualquiera de estos defectos data-drift:
//     - !u (null/undefined)
//     - !u.id (sin id)
//     - !Array.isArray(u.roles) (roles no es array)
//     - !u.roles.includes('lector') (no lector)
//     - normalizeSchoolKey(u.colegio) === '' (colegio vacío/inválido)
//     - u.deleted === true (soft-deleted)
//     - u.deletedAt (string truthy — soft-deleted con timestamp)
//
//   Estos users SÍ aparecen en `userById` (para resolución forensic), pero
//   NUNCA en `usersBySchool` (que es la lista de "lectores operacionalmente
//   visibles del colegio"). Esta separación es crítica para el classifier:
//   un user soft-deleted no debe contribuir a fallback eligibility.
//
// PURO. Sin side effects. O(N+M) time, O(N+M) space.
// ────────────────────────────────────────────────────────────────────────────

export const INDEX_VERSION = 1;

// Sprint MGL M2.1a — el predicate user-level vive en utils/groupMembership.mjs
// como `isOperationallyEligibleLector`. Lo importamos en lugar de duplicar.
// Mantenemos el alias local para no alterar callsites internos del módulo.
const isOperationallyValidLector = isOperationallyEligibleLector;

// ────────────────────────────────────────────────────────────────────────────
// SNAPSHOT BUILDERS — helpers puros que el endpoint M2 (y futuros consumers)
// usan para producir un row de governance snapshot por grupo.
//
// Todos son derivaciones determinísticas del classification result. No tocan
// disco ni emiten side effects. Pueden testarse aislados.
// ────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_VERSION = 1;

// State → operationalRisk mapping (criterio de triage para la UI):
//   corrupted (mixed) → critical
//   recoverable (mixed) → high
//   fallback_dependent → medium  (compatibility-preserving fallback activo)
//   fully_explicit → low
//   empty_inert → low (sin deuda, sin migración pendiente)
export function deriveOperationalRisk(state, mixedSeverity) {
    if (state === 'mixed_legacy_state' && mixedSeverity === 'corrupted')   return 'critical';
    if (state === 'mixed_legacy_state' && mixedSeverity === 'recoverable') return 'high';
    if (state === 'fallback_dependent')                                    return 'medium';
    if (state === 'fully_explicit')                                        return 'low';
    if (state === 'empty_inert')                                           return 'low';
    return 'medium';   // estado desconocido futuro: no degrade silenciosamente
}

// State → governanceStatus mapping (semántica para banners/dashboards):
//   corrupted → corruption_detected
//   recoverable → manual_intervention_required
//   fallback_dependent → migration_required
//   fully_explicit → stable
//   empty_inert → stable
export function deriveGovernanceStatus(state, mixedSeverity) {
    if (state === 'mixed_legacy_state' && mixedSeverity === 'corrupted')   return 'corruption_detected';
    if (state === 'mixed_legacy_state' && mixedSeverity === 'recoverable') return 'manual_intervention_required';
    if (state === 'fallback_dependent')                                    return 'migration_required';
    if (state === 'fully_explicit')                                        return 'stable';
    if (state === 'empty_inert')                                           return 'stable';
    return 'manual_intervention_required';  // unknown future → fail-safe to attention
}

// State → transitionCapabilities (qué operaciones son válidas en este estado):
export function deriveTransitionCapabilities(state, mixedSeverity) {
    return {
        canMaterialize:           state === 'fallback_dependent',
        canRepairAutomatically:   state === 'mixed_legacy_state' && mixedSeverity === 'recoverable',
        requiresManualResolution: state === 'mixed_legacy_state' && mixedSeverity === 'corrupted',
    };
}

// State → materializationReadiness:
export function deriveMaterializationReadiness(state, reasonCode) {
    if (state === 'fallback_dependent') {
        return { ready: true, blocked: false, blockedReason: null };
    }
    if (state === 'mixed_legacy_state') {
        return { ready: false, blocked: true, blockedReason: reasonCode };
    }
    // fully_explicit, empty_inert, error states: not ready, not blocked (irrelevant)
    return { ready: false, blocked: false, blockedReason: null };
}

// explicitCoverage = explicit / (explicit + fallbackEligibleNotExplicit)
// Devuelve null si denominator === 0 (no hay base sobre la cual computar).
// FLOAT PRECISO — el frontend redondea para display.
export function computeExplicitCoverage(explicitCount, fallbackEligibleNotExplicit) {
    const denom = explicitCount + fallbackEligibleNotExplicit;
    if (denom <= 0) return null;
    return explicitCount / denom;
}

// fallbackExtinguished — derivado del state. NO se persiste.
export function deriveFallbackExtinguished(state) {
    return state === 'fully_explicit';
}

// Sort comparator para ordenamiento operacional risk-first.
// Priority lower = más urgente (aparece primero).
export function comparePriority(a, b) {
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    if (pa !== pb) return pa - pb;
    const na = (a.name || a.id || '').toLowerCase();
    const nb = (b.name || b.id || '').toLowerCase();
    return na.localeCompare(nb);
}
function priorityOf(g) {
    if (g.state === 'mixed_legacy_state' && g.mixedSeverity === 'corrupted')   return 0;
    if (g.state === 'mixed_legacy_state' && g.mixedSeverity === 'recoverable') return 1;
    if (g.state === 'fallback_dependent')                                      return 2;
    if (g.state === 'fully_explicit')                                          return 3;
    if (g.state === 'empty_inert')                                             return 4;
    return 5;  // unknown future state
}

export function buildGovernanceIndexes(users, groups) {
    const userById       = new Map();
    const usersBySchool  = new Map();
    const groupsBySchool = new Map();

    for (const u of arr(users)) {
        if (!u || typeof u !== 'object') continue;
        if (typeof u.id !== 'string' || u.id.length === 0) continue;
        userById.set(u.id, u);
        if (!isOperationallyValidLector(u)) continue;
        const school = normalizeSchoolKey(u.colegio);
        if (school.length === 0) continue;
        if (!usersBySchool.has(school)) usersBySchool.set(school, []);
        usersBySchool.get(school).push(u);
    }

    for (const g of arr(groups)) {
        if (!g?.id) continue;
        const school = normalizeSchoolKey(g.school);
        if (school.length === 0) continue;
        if (!groupsBySchool.has(school)) groupsBySchool.set(school, []);
        groupsBySchool.get(school).push(g);
    }

    return { indexVersion: INDEX_VERSION, userById, usersBySchool, groupsBySchool };
}
