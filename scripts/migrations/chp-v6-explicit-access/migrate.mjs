#!/usr/bin/env node
/**
 * migrate.mjs — CHP-V6-EXPLICIT-ACCESS-MEMBERSHIPS-01 (Etapa 5 del V6).
 *
 * Migrador GENERAL de acceso explícito. **DRY-RUN POR DEFECTO.**
 *
 *   node scripts/migrations/chp-v6-explicit-access/migrate.mjs \
 *        --root <dataDir> --users <path> [--json]                 ← dry-run
 *   node ... --root <dataDir> --users <path> --apply --manifest-out <path>
 *   node ... --root <dataDir> --users <path> --verify
 *   node ... --rollback --manifest <path>
 *
 * POR QUÉ EXISTE
 * --------------
 * Producción corre con `ACCESS_FALLBACK_MODE=open`: un lector sin reglas y sin
 * catálogo de grupo recibe `GRANTED via LEGACY_OPEN` (server.js §9). La Etapa 6
 * cierra ese fallback, así que antes hay que MATERIALIZAR de forma explícita el
 * acceso que hoy es implícito — sin ampliarlo ni recortarlo.
 *
 * INVARIANTE
 *   EXPLICIT_ACCESS_AFTER_MIGRATION(group) == LEGITIMATE_EFFECTIVE_ACCESS_BEFORE(group)
 *
 * NO abre arquitectura nueva: no crea stores, tablas, servicios, schedulers,
 * APIs, catálogos ni un modelo de entitlements alterno. Escribe exclusivamente
 * en las estructuras que el resolver YA consume:
 *
 *   access_db.json          reglas por scope (E6/E7 — `canUserAccessContent`
 *                           y `resolveUserContentAccess`). Es la estructura que
 *                           sobrevive a `ACCESS_FALLBACK_MODE=restricted`.
 *   group.availableContentIds  escalón legacy (server.js §7). Sigue vivo; si se
 *                           deja `undefined` el grupo continúa contando como
 *                           NO explícito en el preflight.
 *   group.memberIds / studentIds / user.groupIds
 *                           canales explícitos de membresía
 *                           (utils/groupMembership.mjs).
 *
 * Ambas estructuras se escriben en el MISMO plan y se reconcilian entre sí
 * (`reconcileRuleAgainstGroup`). El espejo hacia identity.db NO se reimplementa
 * aquí: se delega en los instrumentos OUT_OF_BAND que ya existen
 * (`scripts/identity/backfillAccessRules.mjs` para `access`,
 * `scripts/identity/reconcileIdentityShadow.mjs` para `users`/`groups`), y con
 * `IDENTITY_DUAL_WRITE` encendido el apply se BLOQUEA con el mismo guard
 * canónico que usa `groupMembershipService.writeJsonAtomic`.
 *
 * GARANTÍAS
 *   - dry-run por defecto; `--apply` exige además `--manifest-out` (sin
 *     manifiesto de preimagen no hay rollback, y sin rollback no se escribe);
 *   - el plan COMPLETO se calcula antes de la primera escritura;
 *   - idempotencia por ESTADO: los ids de regla son deterministas
 *     (`access-v6-explicit-<groupId>`) y el plan compara conjuntos ordenados,
 *     de modo que una segunda pasada produce WRITES_REQUIRED: 0;
 *   - rollback ESPECÍFICO por preimagen de CAMPO (nunca reemplaza stores
 *     completos): si un campo cambió después del apply, se salta y se reporta;
 *   - locking cross-proceso real (`withFileLock`, el mismo de server.js);
 *   - cero memberships cross-tenant;
 *   - la salida agregada no contiene nombres, correos ni userIds.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { classifyContentItem } from '../../../server/accessService.js';
import { withFileLock } from '../../../server/usersLock.js';
import { blockedWhenDualWrite } from '../../../server/db/identityWriteSurface.mjs';
import {
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
    addUserIdToGroup,
    addGroupIdToUser,
    isOperationallyEligibleLector,
} from '../../../utils/groupMembership.mjs';

export const UNIT = 'CHP-V6-EXPLICIT-ACCESS-MEMBERSHIPS-01';

/** Prefijo determinista de las reglas que crea esta unidad. */
export const RULE_ID_PREFIX = 'access-v6-explicit-';

/** Id determinista de la regla de grupo. Misma entrada ⇒ mismo id. */
export const ruleIdForGroup = (groupId) => `${RULE_ID_PREFIX}${groupId}`;

/**
 * POLÍTICA DE ARCHIVO DE GRUPOS — hallazgo, no decisión de este migrador.
 *
 * Auditoría del modelo canónico (server/server.js POST/PUT /api/groups,
 * normalizeGroup, utils/groupMembership.mjs, server/db/migrations/*.sql):
 * un grupo NO tiene estado de ciclo de vida. `status`/`archived` existen solo
 * para Experiencias (`server/lib/experienceStore.js`). Lo único parecido es la
 * ventana `accessStartsAt`/`accessEndsAt`, que es VIGENCIA DE CATÁLOGO, no
 * archivo: sobre un grupo vacío no cambia ninguna decisión de acceso.
 *
 * Por tanto el migrador NO propone archivar nada y NO inventa un campo nuevo:
 * los grupos vacíos no resolubles salen como HUMAN_DECISION_REQUIRED.
 */
export const GROUP_ARCHIVE_POLICY = Object.freeze({
    available: false,
    reason: 'NO_CANONICAL_GROUP_LIFECYCLE_STATE',
});

export class MigrationStop extends Error {
    constructor(code, detail) {
        super(`STOP — ${code}${detail ? `: ${detail}` : ''}`);
        this.name = 'MigrationStop';
        this.code = code;
    }
}

// ── Utilidades puras ────────────────────────────────────────────────────────

const arr = (x) => (Array.isArray(x) ? x : []);
const sortedUnique = (xs) => [...new Set(xs)].sort();
const canonical = (v) => JSON.stringify(v, (_k, val) => (
    val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
        : val
));
const sameJson = (a, b) => canonical(a) === canonical(b);
const sameSet = (a, b) => canonical(sortedUnique(arr(a))) === canonical(sortedUnique(arr(b)));

/**
 * Vigencia temporal — réplica exacta de `isEntityActive` (server.js §5 del
 * preflight de acceso). El reloj es el del servidor, jamás el del cliente.
 */
export function isEntityActive(startStr, endStr, now) {
    if (!startStr && !endStr) return true;
    if (startStr && now < new Date(startStr).getTime()) return false;
    if (endStr && now > new Date(endStr).getTime()) return false;
    return true;
}

/**
 * Réplica fiel de `resolveCollectionContentIds` (server/server.js:1109). No se
 * puede importar: vive en el módulo que arranca el Express app.
 */
export function resolveCollectionContentIds(collectionIds, content) {
    if (!Array.isArray(collectionIds) || collectionIds.length === 0) return [];
    const colSet = new Set(collectionIds);
    return arr(content).filter(c => c.parentId && colSet.has(c.parentId)).map(c => c.id);
}

/** Principals de un grupo: miembros, estudiantes legacy y mediadores. */
export function groupPrincipalIds(group, users) {
    const ids = new Set([
        ...arr(group.studentIds),
        ...arr(group.memberIds),
        ...arr(group.mediatorIds),
    ]);
    if (typeof group.teacherId === 'string' && group.teacherId) ids.add(group.teacherId);
    for (const u of arr(users)) {
        if (u && arr(u.groupIds).includes(group.id)) ids.add(u.id);
    }
    return ids;
}

/**
 * CATÁLOGO ABIERTO — el conjunto exacto que `LEGACY_OPEN` concede hoy a un
 * lector, una vez aplicados los dos filtros que el propio modelo ya impone:
 *
 *   publicación   `status === 'disponible'` (server/lib/libraryStore.js:161,
 *                 services/dataService.ts:1882-1886).
 *   pedagogía     `classifyContentItem(item) === 'PEDAGOGY_RESTRICTED'` es una
 *                 DENEGACIÓN para lectores (server.js §5 del preflight), nunca
 *                 una concesión: no es acceso legítimo y no se materializa.
 *
 * No se inventa ninguna lista: sale del catálogo canónico tal cual está.
 */
export function deriveOpenCatalog(content) {
    const open = [];
    let droppedByPublication = 0;
    let droppedByPedagogy = 0;
    for (const item of arr(content)) {
        if (typeof item?.id !== 'string' || !item.id) continue;
        if (item.status !== 'disponible') { droppedByPublication++; continue; }
        if (classifyContentItem(item) === 'PEDAGOGY_RESTRICTED') { droppedByPedagogy++; continue; }
        open.push(item.id);
    }
    return { openCatalog: sortedUnique(open), droppedByPublication, droppedByPedagogy };
}

/** Config institucional de un usuario (réplica del §8 del preflight). */
function schoolConfigFor(user, schoolConfigs) {
    const schoolName = user?.colegio || user?.school || '';
    if (!schoolName) return null;
    if (Array.isArray(schoolConfigs)) {
        return schoolConfigs.find(s => s?.schoolName === schoolName) || null;
    }
    if (schoolConfigs && typeof schoolConfigs === 'object') {
        return schoolConfigs[schoolName] || null;
    }
    return null;
}

/**
 * Conjunto efectivo que el escalón institucional concede HOY a un miembro.
 * `null` significa «sin restricción institucional activa» — es decir, el
 * usuario cae en LEGACY_OPEN y su acceso efectivo es el catálogo abierto.
 */
function orgEffectiveSetFor(user, schoolConfigs, content, now) {
    const cfg = schoolConfigFor(user, schoolConfigs);
    if (!cfg) return null;
    if (!isEntityActive(cfg.accessStartsAt, cfg.accessEndsAt, now)) return null;
    if (cfg.availableContentIds === 'all') return null;          // ORG_ALL ≡ abierto
    const titles = Array.isArray(cfg.availableContentIds) ? cfg.availableContentIds : [];
    const extra = resolveCollectionContentIds(arr(cfg.collectionIds), content);
    const union = sortedUnique([...titles, ...extra]);
    // Un array vacío no activa `hasAnyActiveGroupRule` en el §8 del preflight:
    // el usuario sigue cayendo en LEGACY_OPEN.
    return union.length > 0 ? union : null;
}

// ── Cálculo del plan ────────────────────────────────────────────────────────

/**
 * computePlan — PURO. Calcula el plan completo sin tocar disco.
 *
 * @param {{groups:object[], users:object[], content:object[], schools:object[],
 *          schoolConfigs:any, accessRules:object[]}} state
 * @param {{now?:number}} [opts]
 */
export function computePlan(state, opts = {}) {
    const now = opts.now ?? Date.now();
    const groups = arr(state.groups);
    const users = arr(state.users);
    const content = arr(state.content);
    const schools = arr(state.schools);
    const accessRules = arr(state.accessRules);
    const schoolConfigs = state.schoolConfigs ?? [];

    const { openCatalog, droppedByPublication, droppedByPedagogy } = deriveOpenCatalog(content);
    const openCatalogSet = new Set(openCatalog);
    const validOrgIds = new Set(schools.map(s => s?.id).filter(id => typeof id === 'string' && id));
    const usersById = new Map(users.map(u => [u?.id, u]).filter(([id]) => typeof id === 'string'));

    // Proyección de trabajo: el plan se calcula sobre el estado POST-membresías,
    // porque materializar miembros cambia quién resuelve el catálogo del grupo.
    const projectedGroups = groups.map(g => ({ ...g, studentIds: [...arr(g.studentIds)], memberIds: [...arr(g.memberIds)] }));
    const projectedUsers = users.map(u => ({ ...u, groupIds: [...arr(u.groupIds)] }));
    const projectedUsersById = new Map(projectedUsers.map(u => [u?.id, u]));
    // Presencia ORIGINAL del campo: el spread de la proyección siempre crea
    // studentIds/memberIds/groupIds, así que la preimagen debe mirar el record
    // canónico — de lo contrario el rollback dejaría `[]` donde no había campo.
    const originalGroupsById = new Map(groups.map(g => [g?.id, g]));
    const hadField = (record, field) => !!record && Object.prototype.hasOwnProperty.call(record, field);

    const operations = [];
    const conflicts = [];
    const unresolved = [];

    const counts = {
        groupsTotal: groups.length,
        organizationPreserved: 0,
        organizationInferred: 0,
        organizationAmbiguous: 0,
        organizationUnresolvedNoEvidence: 0,
        groupsEmptyUnresolved: 0,
        groupsEmptyProposedForArchive: 0,
        groupsInactive: 0,
        rulesToCreate: 0,
        groupsAlreadyExplicit: 0,
        catalogsToMaterialize: 0,
        contentAmbiguous: 0,
        membershipsPreserved: 0,
        membershipsToCreate: 0,
        crossTenantRejected: 0,
    };

    const orphanGroups = {
        deterministicallyResolvable: [],
        archivableByExistingPolicy: [],
        humanDecisionRequired: [],
    };

    // ── 1. MEMBRESÍAS ───────────────────────────────────────────────────────
    // Se materializan SOLO las que una fuente autoritativa existente ya
    // determina: el fallback `colegio → group.school` de
    // utils/groupMembership.mjs, que el runtime YA usa para resolver miembros
    // (getGroupMembers). Las explícitas se preservan intactas: si el grupo
    // tiene canales explícitos, el fallback ni siquiera se evalúa.
    const membershipMaterialized = new Map();   // groupId → string[] (userIds)

    for (const group of projectedGroups) {
        if (typeof group?.id !== 'string' || !group.id) {
            conflicts.push({ kind: 'GROUP_WITHOUT_ID' });
            continue;
        }
        const explicit = getExplicitGroupMembers(group, projectedUsers);
        counts.membershipsPreserved += explicit.size;
        if (explicit.size > 0) continue;

        const fallback = applyLegacyColegioFallback(group, projectedUsers, projectedGroups);
        if (!fallback.used) continue;

        const groupOrg = typeof group.organizationId === 'string' && validOrgIds.has(group.organizationId)
            ? group.organizationId : null;

        const accepted = [];
        for (const userId of [...fallback.matched].sort()) {
            const user = projectedUsersById.get(userId);
            if (!user || !isOperationallyEligibleLector(user)) continue;
            const userOrg = typeof user.organizationId === 'string' && user.organizationId ? user.organizationId : null;
            // CROSS-TENANT GUARD: dos organizaciones conocidas y distintas ⇒ nunca.
            if (groupOrg && userOrg && groupOrg !== userOrg) {
                counts.crossTenantRejected++;
                conflicts.push({ kind: 'CROSS_TENANT_MEMBERSHIP_REJECTED', groupId: group.id });
                continue;
            }
            accepted.push(userId);
        }
        if (accepted.length === 0) continue;

        const beforeStudents = [...arr(group.studentIds)];
        const beforeMembers = [...arr(group.memberIds)];
        for (const userId of accepted) {
            addUserIdToGroup(group, userId);
            const user = projectedUsersById.get(userId);
            const beforeGroupIds = [...arr(user.groupIds)];
            if (addGroupIdToUser(user, group.id)) {
                operations.push({
                    store: 'users', recordId: userId, kind: 'set-field', field: 'groupIds',
                    before: { present: hadField(usersById.get(userId), 'groupIds'), value: beforeGroupIds },
                    value: [...user.groupIds],
                });
            }
        }
        const originalGroup = originalGroupsById.get(group.id);
        operations.push({
            store: 'groups', recordId: group.id, kind: 'set-field', field: 'studentIds',
            before: { present: hadField(originalGroup, 'studentIds'), value: beforeStudents },
            value: [...group.studentIds],
        });
        operations.push({
            store: 'groups', recordId: group.id, kind: 'set-field', field: 'memberIds',
            before: { present: hadField(originalGroup, 'memberIds'), value: beforeMembers },
            value: [...group.memberIds],
        });
        counts.membershipsToCreate += accepted.length;
        membershipMaterialized.set(group.id, accepted);
    }

    // ── 2. ORGANIZACIÓN ─────────────────────────────────────────────────────
    // Sólo relaciones canónicas persistidas: `user.organizationId` de los
    // principals del grupo. Cero nombres, cero similitud textual, cero
    // heurísticas.
    for (const group of projectedGroups) {
        if (typeof group?.id !== 'string' || !group.id) continue;
        const declared = typeof group.organizationId === 'string' && group.organizationId ? group.organizationId : null;
        if (declared && validOrgIds.has(declared)) { counts.organizationPreserved++; continue; }

        const principals = groupPrincipalIds(group, projectedUsers);
        const candidates = new Set();
        for (const pid of principals) {
            const u = projectedUsersById.get(pid) ?? usersById.get(pid);
            const org = typeof u?.organizationId === 'string' ? u.organizationId : null;
            if (org && validOrgIds.has(org)) candidates.add(org);
        }

        if (candidates.size === 1) {
            const inferred = [...candidates][0];
            operations.push({
                store: 'groups', recordId: group.id, kind: 'set-field', field: 'organizationId',
                before: { present: Object.prototype.hasOwnProperty.call(group, 'organizationId'), value: group.organizationId },
                value: inferred,
            });
            group.organizationId = inferred;
            counts.organizationInferred++;
            orphanGroups.deterministicallyResolvable.push(group.id);
            continue;
        }

        if (candidates.size > 1) {
            counts.organizationAmbiguous++;
            conflicts.push({ kind: 'STOP_AMBIGUOUS_ORGANIZATION', groupId: group.id, candidates: candidates.size });
            unresolved.push({ groupId: group.id, reason: 'STOP_AMBIGUOUS_ORGANIZATION' });
            orphanGroups.humanDecisionRequired.push(group.id);
            continue;
        }

        // Sin evidencia convergente.
        if (principals.size === 0) {
            counts.groupsEmptyUnresolved++;
            unresolved.push({ groupId: group.id, reason: 'EMPTY_GROUP_NO_EVIDENCE' });
            // No hay estado canónico de archivo: no se propone ninguna transición.
            if (GROUP_ARCHIVE_POLICY.available) {
                counts.groupsEmptyProposedForArchive++;
                orphanGroups.archivableByExistingPolicy.push(group.id);
            } else {
                orphanGroups.humanDecisionRequired.push(group.id);
            }
        } else {
            counts.organizationUnresolvedNoEvidence++;
            unresolved.push({
                groupId: group.id,
                reason: declared ? 'INVALID_ORGANIZATION_REFERENCE_NO_EVIDENCE' : 'NO_ORGANIZATION_EVIDENCE',
            });
            orphanGroups.humanDecisionRequired.push(group.id);
        }
    }

    const unresolvedOrgIds = new Set(unresolved.map(u => u.groupId));

    // ── 3. CONTENIDO ────────────────────────────────────────────────────────
    const rulesByScopeId = new Map();
    for (const r of accessRules) {
        if (r?.scope !== 'group' || typeof r.scopeId !== 'string') continue;
        const expired = typeof r.expiresAt === 'number' && Number.isFinite(r.expiresAt) && now > r.expiresAt;
        if (expired) continue;
        if (!rulesByScopeId.has(r.scopeId)) rulesByScopeId.set(r.scopeId, []);
        rulesByScopeId.get(r.scopeId).push(r);
    }

    const materializedCatalogs = new Map();   // groupId → string[]

    for (const group of projectedGroups) {
        if (typeof group?.id !== 'string' || !group.id) continue;

        // Un grupo fuera de vigencia no aporta nada al resolver hoy (§7 lo
        // salta con `continue`): materializarle catálogo sería CONCEDER.
        if (!isEntityActive(group.accessStartsAt, group.accessEndsAt, now)) {
            counts.groupsInactive++;
            continue;
        }

        const hasLegacyCatalog = group.availableContentIds !== undefined
            || (Array.isArray(group.collectionIds) && group.collectionIds.length > 0);
        const existingRules = rulesByScopeId.get(group.id) ?? [];
        const ownRule = existingRules.find(r => r.id === ruleIdForGroup(group.id));
        const foreignRule = existingRules.find(r => r.id !== ruleIdForGroup(group.id));

        // Regla preexistente ajena a esta unidad: acceso YA explícito. Se
        // preserva tal cual — este migrador no reescribe reglas de nadie.
        if (foreignRule) {
            counts.groupsAlreadyExplicit++;
            continue;
        }

        // Catálogo legacy ya presente y sin regla propia: explícito por la vía
        // legacy. Se preserva; no se duplica en access_db.
        if (hasLegacyCatalog && !ownRule) {
            counts.groupsAlreadyExplicit++;
            continue;
        }

        const members = [...getExplicitGroupMembers(group, projectedUsers)];
        if (members.length === 0) {
            // Sin miembros no hay acceso que preservar: una regla aquí no
            // concede ni conserva nada. Ya está clasificado en §2.
            continue;
        }

        // Conjunto efectivo por miembro. Divergencia ⇒ STOP, no excepción.
        const distinct = new Map();
        for (const userId of members.sort()) {
            const user = projectedUsersById.get(userId);
            if (!user) continue;
            const orgSet = orgEffectiveSetFor(user, schoolConfigs, content, now);
            const effective = orgSet === null ? openCatalog : sortedUnique(orgSet.filter(id => openCatalogSet.has(id)));
            distinct.set(canonical(effective), effective);
        }
        if (distinct.size === 0) continue;
        if (distinct.size > 1) {
            counts.contentAmbiguous++;
            conflicts.push({ kind: 'STOP_AMBIGUOUS_CONTENT', groupId: group.id, variants: distinct.size });
            unresolved.push({ groupId: group.id, reason: 'STOP_AMBIGUOUS_CONTENT' });
            if (!orphanGroups.humanDecisionRequired.includes(group.id)) {
                orphanGroups.humanDecisionRequired.push(group.id);
            }
            continue;
        }
        // La organización sin resolver no bloquea el catálogo del grupo: el
        // acceso se preserva igual. Pero sí se registra el grupo como no
        // cerrado, y el gate UNRESOLVED_GROUPS: ZERO sigue sin cumplirse.
        const target = [...distinct.values()][0];
        materializedCatalogs.set(group.id, target);

        const ruleIsCurrent = ownRule
            && sameSet(ownRule.titleIds, target)
            && sameSet(ownRule.collectionIds, [])
            && (ownRule.expiresAt === null || ownRule.expiresAt === undefined);

        if (!ruleIsCurrent) {
            const record = {
                id: ruleIdForGroup(group.id),
                scope: 'group',
                scopeId: group.id,
                titleIds: target,
                collectionIds: [],
                expiresAt: null,
            };
            if (ownRule) {
                operations.push({
                    store: 'access', recordId: record.id, kind: 'replace-record',
                    before: { present: true, value: ownRule }, value: record,
                });
            } else {
                operations.push({
                    store: 'access', recordId: record.id, kind: 'create-record',
                    before: { present: false }, value: record,
                });
            }
            counts.rulesToCreate++;
        }

        if (!sameSet(group.availableContentIds, target) || group.availableContentIds === undefined) {
            operations.push({
                store: 'groups', recordId: group.id, kind: 'set-field', field: 'availableContentIds',
                before: { present: Object.prototype.hasOwnProperty.call(group, 'availableContentIds'), value: group.availableContentIds },
                value: target,
            });
            group.availableContentIds = target;
            counts.catalogsToMaterialize++;
        }
        if (unresolvedOrgIds.has(group.id)) {
            conflicts.push({ kind: 'CATALOG_MATERIALIZED_WITH_UNRESOLVED_ORGANIZATION', groupId: group.id });
        }
    }

    const rulesUntouched = accessRules.filter(r => typeof r?.id === 'string' && !r.id.startsWith(RULE_ID_PREFIX)).length;

    const plan = {
        unit: UNIT,
        catalog: {
            canonical: content.length,
            openCatalog: openCatalog.length,
            droppedByPublication,
            droppedByPedagogy,
        },
        groups: {
            total: counts.groupsTotal,
            organizationPreserved: counts.organizationPreserved,
            organizationInferred: counts.organizationInferred,
            organizationAmbiguous: counts.organizationAmbiguous,
            organizationUnresolvedNoEvidence: counts.organizationUnresolvedNoEvidence,
            emptyUnresolved: counts.groupsEmptyUnresolved,
            emptyProposedForArchive: counts.groupsEmptyProposedForArchive,
            inactive: counts.groupsInactive,
            alreadyExplicit: counts.groupsAlreadyExplicit,
        },
        rules: {
            untouchedPreexisting: rulesUntouched,
            toCreateOrReplace: counts.rulesToCreate,
        },
        content: {
            catalogsToMaterialize: counts.catalogsToMaterialize,
            ambiguous: counts.contentAmbiguous,
        },
        memberships: {
            preserved: counts.membershipsPreserved,
            toCreate: counts.membershipsToCreate,
            crossTenantRejected: counts.crossTenantRejected,
        },
        conflicts,
        unresolved,
        orphanGroups,
        archivePolicy: GROUP_ARCHIVE_POLICY,
        writesRequired: operations.length,
    };

    return { plan, operations, materializedCatalogs, membershipMaterialized, openCatalog };
}

/**
 * Reconciliación entre las DOS estructuras del contrato vigente: la regla de
 * scope `group` y `group.availableContentIds` deben expresar el mismo conjunto.
 */
export function reconcileRuleAgainstGroup(groups, accessRules) {
    const rules = new Map(
        arr(accessRules)
            .filter(r => typeof r?.id === 'string' && r.id.startsWith(RULE_ID_PREFIX))
            .map(r => [r.scopeId, r]),
    );
    const mismatches = [];
    let checked = 0;
    for (const g of arr(groups)) {
        const rule = rules.get(g?.id);
        if (!rule) continue;
        checked++;
        if (!sameSet(rule.titleIds, g.availableContentIds)) mismatches.push(g.id);
    }
    return { checked, mismatches };
}

/** Ninguna membresía materializada puede cruzar organización. */
export function assertNoCrossTenant(groups, users, schools) {
    const validOrgIds = new Set(arr(schools).map(s => s?.id).filter(Boolean));
    const usersById = new Map(arr(users).map(u => [u?.id, u]));
    const violations = [];
    for (const g of arr(groups)) {
        const groupOrg = typeof g?.organizationId === 'string' && validOrgIds.has(g.organizationId) ? g.organizationId : null;
        if (!groupOrg) continue;
        for (const uid of new Set([...arr(g.memberIds), ...arr(g.studentIds)])) {
            const u = usersById.get(uid);
            const userOrg = typeof u?.organizationId === 'string' && u.organizationId ? u.organizationId : null;
            if (userOrg && userOrg !== groupOrg) violations.push({ groupId: g.id });
        }
    }
    return violations;
}

// ── Rutas y E/S ─────────────────────────────────────────────────────────────

/** Resuelve una ruta DENTRO de root, rechazando escapes y symlinks. */
export function safeResolve(root, relative) {
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, relative);
    const rel = path.relative(rootAbs, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new MigrationStop('PATH_ESCAPE', relative);
    }
    let cursor = rootAbs;
    for (const part of rel.split(path.sep)) {
        cursor = path.join(cursor, part);
        let st;
        try { st = fs.lstatSync(cursor); } catch { break; }
        if (st.isSymbolicLink()) throw new MigrationStop('SYMLINK_REJECTED', relative);
    }
    return abs;
}

function assertRegularFile(abs, label) {
    let st;
    try { st = fs.lstatSync(abs); } catch { throw new MigrationStop('INPUT_MISSING', label); }
    if (st.isSymbolicLink()) throw new MigrationStop('SYMLINK_REJECTED', label);
    if (!st.isFile()) throw new MigrationStop('NOT_REGULAR_FILE', label);
}

/**
 * Lectura canónica FÍSICA, fail-closed — mismo contrato que
 * `readCanonicalStoreForMutation` (server.js): sin caché, sin seam, sin
 * fallback a vacío. Una lectura degradada truncaría el store al escribir.
 */
function readCanonicalArray(abs, label, { optional = false } = {}) {
    if (optional && !fs.existsSync(abs)) return [];
    assertRegularFile(abs, label);
    const raw = fs.readFileSync(abs, 'utf8');
    if (!raw.trim()) throw new MigrationStop('CANONICAL_READ_FAILED', `${label}: EMPTY_FILE`);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new MigrationStop('CANONICAL_READ_FAILED', `${label}: PARSE_ERROR`); }
    if (!Array.isArray(parsed)) throw new MigrationStop('CANONICAL_READ_FAILED', `${label}: NOT_ARRAY`);
    return parsed;
}

function readOptionalJson(abs, label, fallbackValue) {
    if (!fs.existsSync(abs)) return fallbackValue;
    assertRegularFile(abs, label);
    const raw = fs.readFileSync(abs, 'utf8');
    if (!raw.trim()) return fallbackValue;
    try { return JSON.parse(raw); } catch { throw new MigrationStop('CANONICAL_READ_FAILED', `${label}: PARSE_ERROR`); }
}

export function resolvePaths({ root, usersFile }) {
    if (!root) throw new MigrationStop('ROOT_REQUIRED', 'usa --root <dataDir>');
    if (!usersFile) throw new MigrationStop('USERS_REQUIRED', 'usa --users <ruta>');
    const usersAbs = path.resolve(usersFile);
    assertRegularFile(usersAbs, 'users');
    return {
        groups: safeResolve(root, 'groups_db.json'),
        access: safeResolve(root, 'access_db.json'),
        content: safeResolve(root, 'content.json'),
        schools: safeResolve(root, 'schools_db.json'),
        schoolConfigs: safeResolve(root, 'school_configs.json'),
        users: usersAbs,
    };
}

export function readState(paths) {
    return {
        groups: readCanonicalArray(paths.groups, 'groups_db.json'),
        access: readCanonicalArray(paths.access, 'access_db.json'),
        content: readCanonicalArray(paths.content, 'content.json'),
        users: readCanonicalArray(paths.users, 'users'),
        schools: readOptionalJson(paths.schools, 'schools_db.json', []),
        schoolConfigs: readOptionalJson(paths.schoolConfigs, 'school_configs.json', []),
    };
}

const toPlanState = (s) => ({
    groups: s.groups, users: s.users, content: s.content,
    schools: s.schools, schoolConfigs: s.schoolConfigs, accessRules: s.access,
});

function atomicWrite(abs, data) {
    const dir = path.dirname(abs);
    const tmp = path.join(dir, `.${path.basename(abs)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    let fd;
    try {
        fd = fs.openSync(tmp, 'wx', 0o644);
        fs.writeSync(fd, JSON.stringify(data, null, 2));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, abs);
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* noop */ } }
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* noop */ }
    }
}

const dualWriteEnabled = (env = process.env) => env.IDENTITY_DUAL_WRITE === '1'
    || String(env.IDENTITY_DUAL_WRITE).toLowerCase() === 'true';

/**
 * Guard canónico: con el dual-write encendido una escritura fuera del seam del
 * API divergiría del espejo en silencio. Es exactamente el mismo bloqueo que
 * aplica `groupMembershipService.writeJsonAtomic`, reutilizando
 * `blockedWhenDualWrite` de server/db/identityWriteSurface.mjs.
 */
export function assertMirrorSafe(stores, env = process.env) {
    for (const domain of stores) {          // 'users' | 'groups' | 'access'
        const blocked = blockedWhenDualWrite({ dualWriteEnabled: dualWriteEnabled(env), domain });
        if (blocked) throw new MigrationStop(blocked, `dominio ${domain}`);
    }
}

// ── Aplicación de operaciones ───────────────────────────────────────────────

const STORE_ORDER = ['users', 'groups', 'access'];

function applyToRecords(records, ops, direction) {
    const byId = new Map(records.map((r, i) => [r?.id, i]));
    const skipped = [];
    let changed = 0;
    for (const op of ops) {
        const idx = byId.get(op.recordId);
        if (op.kind === 'create-record') {
            if (direction === 'forward') {
                if (idx !== undefined) { skipped.push({ ...op, why: 'ALREADY_PRESENT' }); continue; }
                records.push(op.value);
                byId.set(op.recordId, records.length - 1);
                changed++;
            } else {
                if (idx === undefined) { skipped.push({ ...op, why: 'ALREADY_ABSENT' }); continue; }
                if (!sameJson(records[idx], op.value)) { skipped.push({ ...op, why: 'MODIFIED_AFTER_APPLY' }); continue; }
                records.splice(idx, 1);
                byId.clear();
                records.forEach((r, i) => byId.set(r?.id, i));
                changed++;
            }
            continue;
        }
        if (op.kind === 'replace-record') {
            if (idx === undefined) { skipped.push({ ...op, why: 'RECORD_MISSING' }); continue; }
            const expected = direction === 'forward' ? op.before.value : op.value;
            const next = direction === 'forward' ? op.value : op.before.value;
            if (!sameJson(records[idx], expected)) { skipped.push({ ...op, why: 'MODIFIED_AFTER_APPLY' }); continue; }
            records[idx] = next;
            changed++;
            continue;
        }
        // set-field
        if (idx === undefined) { skipped.push({ ...op, why: 'RECORD_MISSING' }); continue; }
        const record = records[idx];
        if (direction === 'forward') {
            record[op.field] = op.value;
            changed++;
        } else {
            if (!sameJson(record[op.field], op.value)) { skipped.push({ ...op, why: 'MODIFIED_AFTER_APPLY' }); continue; }
            if (op.before.present) record[op.field] = op.before.value;
            else delete record[op.field];
            changed++;
        }
    }
    return { changed, skipped };
}

async function mutateStore(absPath, label, fn) {
    return withFileLock(absPath, async () => {
        const records = readCanonicalArray(absPath, label);
        const result = await fn(records);
        if (result.changed > 0) atomicWrite(absPath, records);
        return result;
    }, `chp-v6-explicit-access:${label}`);
}

/**
 * Ejecuta las operaciones del plan. Cada store se muta bajo su propio lock
 * cross-proceso y se reescribe de forma atómica. Devuelve el manifiesto de
 * preimagen: es el único insumo del rollback específico.
 */
export async function applyOperations(paths, operations, { direction = 'forward' } = {}) {
    const stores = [...new Set(operations.map(o => o.store))];
    assertMirrorSafe(stores);
    const ordered = direction === 'forward' ? STORE_ORDER : [...STORE_ORDER].reverse();
    const report = {};
    for (const store of ordered) {
        const ops = operations.filter(o => o.store === store);
        if (ops.length === 0) continue;
        report[store] = await mutateStore(paths[store], store, (records) => applyToRecords(records, ops, direction));
    }
    return report;
}

export function buildManifest({ operations, paths, plan }) {
    return {
        unit: UNIT,
        manifestVersion: 1,
        createdAt: new Date().toISOString(),
        paths: { groups: paths.groups, access: paths.access, users: paths.users },
        summary: {
            writes: operations.length,
            groups: plan.groups,
            rules: plan.rules,
            memberships: plan.memberships,
        },
        operations,
    };
}

export async function rollback({ manifest }) {
    if (manifest?.unit !== UNIT) throw new MigrationStop('MANIFEST_FOREIGN', String(manifest?.unit));
    if (manifest.manifestVersion !== 1) throw new MigrationStop('MANIFEST_VERSION', String(manifest.manifestVersion));
    const ops = arr(manifest.operations);
    if (ops.length === 0) return { restored: 0, skipped: [] };
    const report = await applyOperations(manifest.paths, ops, { direction: 'inverse' });
    const restored = Object.values(report).reduce((n, r) => n + r.changed, 0);
    const skipped = Object.values(report).flatMap(r => r.skipped.map(s => ({ store: s.store, kind: s.kind, why: s.why })));
    return { restored, skipped, report };
}

// ── Orquestación por modo ───────────────────────────────────────────────────

export async function run({ root, usersFile, mode = 'dry-run', manifestOut = null, now }) {
    const paths = resolvePaths({ root, usersFile });
    const state = readState(paths);
    const { plan, operations } = computePlan(toPlanState(state), { now });

    if (mode === 'dry-run') {
        return { mode, status: plan.writesRequired === 0 ? 'NO_OP' : 'PLANNED', plan, applied: false };
    }

    if (mode === 'verify') {
        const rec = reconcileRuleAgainstGroup(state.groups, state.access);
        const cross = assertNoCrossTenant(state.groups, state.users, state.schools);
        const ok = plan.writesRequired === 0 && rec.mismatches.length === 0 && cross.length === 0;
        return {
            mode, status: ok ? 'RECONCILED' : 'DIVERGENT', plan, applied: false,
            reconciliation: rec, crossTenantViolations: cross.length,
        };
    }

    if (mode !== 'apply') throw new MigrationStop('UNKNOWN_MODE', mode);
    if (!manifestOut) throw new MigrationStop('MANIFEST_OUT_REQUIRED', '--apply exige --manifest-out <ruta>');
    if (plan.conflicts.some(c => c.kind.startsWith('STOP_'))) {
        throw new MigrationStop('BLOCKING_CONFLICTS', `${plan.conflicts.filter(c => c.kind.startsWith('STOP_')).length} conflicto(s)`);
    }
    if (plan.writesRequired === 0) {
        return { mode, status: 'NO_OP', plan, applied: false };
    }

    // El manifiesto de preimagen se escribe ANTES de tocar ningún store: sin
    // rollback disponible no se aplica nada.
    const manifest = buildManifest({ operations, paths, plan });
    assertMirrorSafe([...new Set(operations.map(o => o.store))]);
    atomicWrite(path.resolve(manifestOut), manifest);

    const report = await applyOperations(paths, operations, { direction: 'forward' });

    const after = readState(paths);
    const verifyPlan = computePlan(toPlanState(after), { now }).plan;
    const rec = reconcileRuleAgainstGroup(after.groups, after.access);
    const cross = assertNoCrossTenant(after.groups, after.users, after.schools);

    return {
        mode, status: 'APPLIED', plan, applied: true, manifestPath: path.resolve(manifestOut), report,
        postState: {
            writesRequired: verifyPlan.writesRequired,
            reconciliation: rec,
            crossTenantViolations: cross.length,
        },
    };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function argOf(flag, fallback = null) {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
        ? process.argv[i + 1] : fallback;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
    try {
        if (process.argv.includes('--rollback')) {
            const mp = argOf('--manifest');
            if (!mp) throw new MigrationStop('MANIFEST_REQUIRED', 'usa --manifest <ruta>');
            const out = await rollback({ manifest: JSON.parse(fs.readFileSync(mp, 'utf8')) });
            console.log(JSON.stringify({ unit: UNIT, mode: 'rollback', ...out }, null, 2));
            process.exit(0);
        }
        const mode = process.argv.includes('--apply') ? 'apply'
            : process.argv.includes('--verify') ? 'verify' : 'dry-run';
        const out = await run({
            root: argOf('--root'),
            usersFile: argOf('--users'),
            mode,
            manifestOut: argOf('--manifest-out'),
        });
        if (process.argv.includes('--json')) {
            console.log(JSON.stringify(out, null, 2));
        } else {
            const p = out.plan;
            console.log(`${UNIT} — modo ${out.mode} — ${out.status}`);
            console.log(`  catálogo: ${p.catalog.canonical} registros → ${p.catalog.openCatalog} abiertos`
                + ` (−${p.catalog.droppedByPublication} sin publicar, −${p.catalog.droppedByPedagogy} pedagogía)`);
            console.log(`  grupos: ${p.groups.total} · org preservada=${p.groups.organizationPreserved}`
                + ` inferida=${p.groups.organizationInferred} ambigua=${p.groups.organizationAmbiguous}`
                + ` sin evidencia=${p.groups.organizationUnresolvedNoEvidence} vacíos=${p.groups.emptyUnresolved}`
                + ` inactivos=${p.groups.inactive} ya explícitos=${p.groups.alreadyExplicit}`);
            console.log(`  reglas: preexistentes intactas=${p.rules.untouchedPreexisting} a crear=${p.rules.toCreateOrReplace}`);
            console.log(`  catálogos a materializar=${p.content.catalogsToMaterialize} ambiguos=${p.content.ambiguous}`);
            console.log(`  memberships: preservadas=${p.memberships.preserved} a crear=${p.memberships.toCreate}`
                + ` cross-tenant rechazadas=${p.memberships.crossTenantRejected}`);
            console.log(`  huérfanos: resolubles=${p.orphanGroups.deterministicallyResolvable.length}`
                + ` archivables=${p.orphanGroups.archivableByExistingPolicy.length}`
                + ` decisión humana=${p.orphanGroups.humanDecisionRequired.length}`);
            console.log(`  conflictos=${p.conflicts.length} unresolved=${p.unresolved.length}`);
            console.log(`\nWRITES_REQUIRED: ${p.writesRequired}${out.applied ? ' (APLICADOS)' : ' — NADA se escribió'}`);
        }
        process.exit(0);
    } catch (e) {
        console.error(e instanceof MigrationStop ? e.message : `STOP — UNEXPECTED: ${e.stack || e.message}`);
        process.exit(1);
    }
}
