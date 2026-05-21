/**
 * endpointMembershipGovernance.test.js — Sprint MGL Fase 1 / M2
 *
 * Cubre el endpoint GET /api/membership-governance/groups.
 *
 * No levanta Express. Reproduce el cuerpo del handler con stubs de readJSON,
 * mismo patrón ligero del resto de la suite (`endpointValidate.test.js`,
 * `endpointsBidirectional.test.js`). Si el handler de server.js cambia de
 * shape, este replicador debe alinearse — ese es exactamente el punto.
 *
 * Cómo correr:
 *   node server/__test__/endpointMembershipGovernance.test.js
 */

import { applyLegacyColegioFallback } from '../groupMembershipService.js';
import { buildGroupDiagnosis }        from '../../utils/groupDiagnosis.mjs';
import {
    normalizeSchoolKey,
    detectGroupMaterializationState,
    buildGovernanceIndexes,
    countFallbackVisibleLectors,
    deriveOperationalRisk,
    deriveGovernanceStatus,
    deriveTransitionCapabilities,
    deriveMaterializationReadiness,
    deriveFallbackExtinguished,
    computeExplicitCoverage,
    comparePriority,
    SNAPSHOT_VERSION,
} from '../../utils/membershipGovernance.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

// ── res stub ────────────────────────────────────────────────────────────────
function makeRes() {
    const captured = { statusCode: 200, body: null };
    const res = {
        status(code) { captured.statusCode = code; return res; },
        json(body)   { captured.body = body; return res; },
    };
    return { res, captured };
}

// ── Replicador del handler ──────────────────────────────────────────────────
//
// Refleja literalmente lo que vive en server.js para el endpoint MGL.
// readJSON es un stub que mapea las 3 rutas usadas por el handler.
function runMembershipGovernanceHandler({ users, groups, audit, query, readJSONImpl }) {
    const { res, captured } = makeRes();
    const readJSON = readJSONImpl || ((token) => {
        if (token === 'USERS_DB')      return users || [];
        if (token === 'GROUPS_DB')     return groups || [];
        if (token === 'USER_AUDIT_DB') return audit || [];
        throw new Error(`unexpected token: ${token}`);
    });

    const req = { headers: { 'x-user-id': 'tester' }, query: query || {} };

    try {
        const u = readJSON('USERS_DB')  || [];
        const g = readJSON('GROUPS_DB') || [];

        const indexes = buildGovernanceIndexes(u, g);

        const schoolFilter = typeof req.query.school === 'string'
            ? normalizeSchoolKey(req.query.school)
            : null;
        const stateFilterRaw = typeof req.query.state === 'string' ? req.query.state.trim() : '';
        const stateFilter = stateFilterRaw.length > 0
            ? new Set(stateFilterRaw.split(',').map(s => s.trim()).filter(Boolean))
            : null;
        const includeAudit = req.query.includeAudit === 'true';

        let auditByGroupId = null;
        if (includeAudit) {
            try {
                const auditEntries = readJSON('USER_AUDIT_DB') || [];
                auditByGroupId = new Map();
                for (const e of auditEntries) {
                    const gid = e?.details?.groupId;
                    if (typeof gid !== 'string' || gid.length === 0) continue;
                    const ts  = e.timestamp;
                    if (typeof ts !== 'string') continue;
                    const prev = auditByGroupId.get(gid);
                    if (!prev || ts > prev.timestamp) {
                        auditByGroupId.set(gid, e);
                    }
                }
            } catch {
                auditByGroupId = new Map();
            }
        }

        const groupsToClassify = schoolFilter
            ? g.filter(gr => normalizeSchoolKey(gr?.school) === schoolFilter)
            : g;

        const counts = {
            fully_explicit:     0,
            fallback_dependent: 0,
            mixed_legacy_state: 0,
            empty_inert:        0,
        };

        const classifiedAll = g.map(gr => {
            const c = detectGroupMaterializationState(gr, u, g, indexes.userById);
            counts[c.state] = (counts[c.state] || 0) + 1;
            return { group: gr, classification: c };
        });

        const groupSet = schoolFilter
            ? new Set(groupsToClassify.map(gr => gr.id))
            : null;

        const rows = [];
        for (const { group, classification } of classifiedAll) {
            if (groupSet && !groupSet.has(group.id)) continue;
            if (stateFilter && !stateFilter.has(classification.state)) continue;

            const {
                state, reasonCode, mixedSeverity, isSingleSchool,
                explicitCount, fallbackEligibleNotExplicit, crossSchoolExplicitCount,
            } = classification;

            const fbAll = applyLegacyColegioFallback(group, u, g);
            const fallbackEligibleUsers = fbAll.matched.size;

            const fallbackVisibleUsers = state === 'fallback_dependent'
                ? countFallbackVisibleLectors(group, u)
                : 0;
            const totalVisibleUsers = explicitCount + fallbackVisibleUsers;
            const explicitCoverage = computeExplicitCoverage(explicitCount, fallbackEligibleNotExplicit);
            const diagnosis = buildGroupDiagnosis(group, u, g);

            const auditEntry = (includeAudit && auditByGroupId.has(group.id))
                ? auditByGroupId.get(group.id)
                : null;

            rows.push({
                id:             group.id,
                name:           typeof group.name === 'string' ? group.name : group.id,
                type:           group.type === 'club' ? 'club' : 'course',
                school:         typeof group.school === 'string' ? group.school : null,
                organizationId: typeof group.organizationId === 'string' ? group.organizationId : null,
                state, reasonCode, mixedSeverity, isSingleSchool,
                operationalRisk:  deriveOperationalRisk(state, mixedSeverity),
                governanceStatus: deriveGovernanceStatus(state, mixedSeverity),
                explicitMembers: explicitCount,
                fallbackVisibleUsers,
                fallbackEligibleUsers,
                fallbackEligibleNotExplicit,
                crossSchoolExplicitCount,
                totalVisibleUsers,
                explicitCoverage,
                fallbackExtinguished:     deriveFallbackExtinguished(state),
                materializationReadiness: deriveMaterializationReadiness(state, reasonCode),
                transitionCapabilities:   deriveTransitionCapabilities(state, mixedSeverity),
                diagnosisSummary: {
                    healthStatus:         diagnosis.healthStatus,
                    inconsistenciesCount: Array.isArray(diagnosis.inconsistencies) ? diagnosis.inconsistencies.length : 0,
                    warningsCount:        Array.isArray(diagnosis.warnings) ? diagnosis.warnings.length : 0,
                },
                lastAuditEvent: auditEntry ? {
                    ts:               auditEntry.timestamp,
                    action:           auditEntry.action,
                    actor:            auditEntry.actor || null,
                    auditReferenceId: auditEntry.auditReferenceId || null,
                } : null,
            });
        }

        rows.sort(comparePriority);

        res.json({
            snapshotVersion: SNAPSHOT_VERSION,
            generatedAt:     new Date().toISOString(),
            totalGroups:     g.length,
            counts,
            groups:          rows,
        });
    } catch {
        res.status(500).json({
            error:   'Internal Server Error',
            message: 'No se pudo generar el snapshot de governance.',
        });
    }
    return captured;
}

console.log('endpointMembershipGovernance — Sprint MGL Fase 1 / M2');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Universo vacío
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] universo vacío');
{
    const r = runMembershipGovernanceHandler({ users: [], groups: [], audit: [] });
    ok('status 200',                r.statusCode === 200);
    ok('snapshotVersion=1',         r.body.snapshotVersion === 1);
    ok('generatedAt es ISO',        typeof r.body.generatedAt === 'string' && /T.*Z$/.test(r.body.generatedAt));
    ok('totalGroups=0',             r.body.totalGroups === 0);
    ok('counts.fully_explicit=0',     r.body.counts.fully_explicit === 0);
    ok('counts.fallback_dependent=0', r.body.counts.fallback_dependent === 0);
    ok('counts.mixed_legacy_state=0', r.body.counts.mixed_legacy_state === 0);
    ok('counts.empty_inert=0',        r.body.counts.empty_inert === 0);
    ok('groups=[]',                 Array.isArray(r.body.groups) && r.body.groups.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Schema completo de un row — fully_explicit
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] schema completo del row (fully_explicit)');
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Escuela Norte', groupIds: ['gFE'] },
    ];
    const groups = [
        { id: 'gFE', name: 'Primero A', type: 'course', school: 'Escuela Norte', organizationId: 'orgN',
          studentIds: ['u1'], memberIds: ['u1'] },
    ];
    const r = runMembershipGovernanceHandler({ users, groups });
    ok('1 row retornado', r.body.groups.length === 1);
    const row = r.body.groups[0];
    ok('row.id',                          row.id === 'gFE');
    ok('row.name',                        row.name === 'Primero A');
    ok('row.type=course',                 row.type === 'course');
    ok('row.school preservado',           row.school === 'Escuela Norte');
    ok('row.organizationId preservado',   row.organizationId === 'orgN');
    ok('state=fully_explicit',            row.state === 'fully_explicit');
    ok('operationalRisk=low',             row.operationalRisk === 'low');
    ok('governanceStatus=stable',         row.governanceStatus === 'stable');
    ok('explicitMembers=1',               row.explicitMembers === 1);
    ok('fallbackVisibleUsers=0',          row.fallbackVisibleUsers === 0);
    ok('fallbackExtinguished=true',       row.fallbackExtinguished === true);
    ok('materializationReadiness.ready=false', row.materializationReadiness.ready === false);
    ok('canMaterialize=false',            row.transitionCapabilities.canMaterialize === false);
    ok('diagnosisSummary presente',       typeof row.diagnosisSummary === 'object' && row.diagnosisSummary !== null);
    ok('lastAuditEvent=null (sin includeAudit)', row.lastAuditEvent === null);
    ok('explicitCoverage es número',      typeof row.explicitCoverage === 'number');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. fallback_dependent — fallbackVisibleUsers > 0 + readiness.ready=true
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] fallback_dependent — visibility activa');
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Escuela Sur', groupIds: [] },
        { id: 'u2', roles: ['lector'], colegio: 'Escuela Sur', groupIds: [] },
    ];
    const groups = [
        { id: 'gFB', name: 'Solo grupo', type: 'course', school: 'Escuela Sur',
          studentIds: [], memberIds: [] },
    ];
    const r = runMembershipGovernanceHandler({ users, groups });
    const row = r.body.groups[0];
    ok('state=fallback_dependent',           row.state === 'fallback_dependent');
    ok('explicitMembers=0',                  row.explicitMembers === 0);
    ok('fallbackVisibleUsers=2',             row.fallbackVisibleUsers === 2);
    ok('fallbackEligibleUsers=2',            row.fallbackEligibleUsers === 2);
    ok('fallbackEligibleNotExplicit=2',      row.fallbackEligibleNotExplicit === 2);
    ok('totalVisibleUsers=2',                row.totalVisibleUsers === 2);
    ok('readiness.ready=true',               row.materializationReadiness.ready === true);
    ok('canMaterialize=true',                row.transitionCapabilities.canMaterialize === true);
    ok('operationalRisk=medium',             row.operationalRisk === 'medium');
    ok('governanceStatus=migration_required', row.governanceStatus === 'migration_required');
    ok('fallbackExtinguished=false',         row.fallbackExtinguished === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. mixed_legacy_state — fallbackVisibleUsers debe ser 0 aunque haya elegibles
//    (mixed NO permite fallback como active path)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] mixed_legacy_state — fallback inactivo');
{
    const users = [
        // explicit en gMix, MISMA escuela
        { id: 'uE', roles: ['lector'], colegio: 'Escuela Mix', groupIds: ['gMix'] },
        // mismo colegio, no explicit
        { id: 'uF', roles: ['lector'], colegio: 'Escuela Mix', groupIds: [] },
        // CROSS-SCHOOL explicit → dispara mixed
        { id: 'uX', roles: ['lector'], colegio: 'Otra Escuela', groupIds: ['gMix'] },
    ];
    const groups = [
        { id: 'gMix', name: 'Mixto', type: 'course', school: 'Escuela Mix',
          studentIds: ['uE', 'uX'], memberIds: ['uE', 'uX'] },
    ];
    const r = runMembershipGovernanceHandler({ users, groups });
    const row = r.body.groups[0];
    ok('state=mixed_legacy_state',     row.state === 'mixed_legacy_state');
    ok('mixedSeverity definido',       row.mixedSeverity === 'recoverable' || row.mixedSeverity === 'corrupted');
    ok('explicitMembers=2',            row.explicitMembers === 2);
    ok('fallbackVisibleUsers=0 (mixed inactiva fallback)', row.fallbackVisibleUsers === 0);
    ok('fallbackEligibleUsers preserva universo',          row.fallbackEligibleUsers >= 1);
    ok('readiness.blocked=true',       row.materializationReadiness.blocked === true);
    ok('canMaterialize=false',         row.transitionCapabilities.canMaterialize === false);
    ok('requiresManualResolution o canRepairAutomatically',
        row.transitionCapabilities.requiresManualResolution === true ||
        row.transitionCapabilities.canRepairAutomatically === true);
    ok('operationalRisk in [high,critical]',
        row.operationalRisk === 'high' || row.operationalRisk === 'critical');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. empty_inert — sin explicit, sin colegio
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] empty_inert — sin colegio, sin explicit');
{
    const groups = [
        { id: 'gE', name: 'Vacío', type: 'course', school: null,
          studentIds: [], memberIds: [] },
    ];
    const r = runMembershipGovernanceHandler({ users: [], groups });
    const row = r.body.groups[0];
    ok('state=empty_inert',             row.state === 'empty_inert');
    ok('operationalRisk=low',           row.operationalRisk === 'low');
    ok('governanceStatus=stable',       row.governanceStatus === 'stable');
    // Por contrato: deriveFallbackExtinguished devuelve true SOLO en fully_explicit.
    // En empty_inert no hay nada que extinguir; es false por construcción.
    ok('fallbackExtinguished=false (sólo true en fully_explicit)',
        row.fallbackExtinguished === false);
    ok('canMaterialize=false',          row.transitionCapabilities.canMaterialize === false);
    ok('canRepairAutomatically=false',  row.transitionCapabilities.canRepairAutomatically === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Filtro ?school — entrega solo grupos del colegio normalizado;
//    counts y totalGroups se mantienen GLOBALES.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] filter ?school');
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Norte', groupIds: ['gN'] },
        { id: 'u2', roles: ['lector'], colegio: 'Sur',   groupIds: ['gS'] },
    ];
    const groups = [
        { id: 'gN', name: 'NorteA', type: 'course', school: 'Norte', studentIds: ['u1'], memberIds: ['u1'] },
        { id: 'gS', name: 'SurA',   type: 'course', school: 'Sur',   studentIds: ['u2'], memberIds: ['u2'] },
    ];
    const r = runMembershipGovernanceHandler({ users, groups, query: { school: '  NORTE  ' } });
    ok('totalGroups GLOBAL (no afectado por filtro)', r.body.totalGroups === 2);
    ok('counts GLOBAL fully_explicit=2',              r.body.counts.fully_explicit === 2);
    ok('groups filtrado a 1',                         r.body.groups.length === 1);
    ok('groups[0].school=Norte',                      r.body.groups[0].school === 'Norte');
    ok('normalización trim+lower aplica',             r.body.groups[0].id === 'gN');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Filtro ?state CSV
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] filter ?state CSV');
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Norte', groupIds: ['gFE'] },
        { id: 'u2', roles: ['lector'], colegio: 'Sur',   groupIds: [] },
    ];
    const groups = [
        { id: 'gFE', name: 'A',  type: 'course', school: 'Norte', studentIds: ['u1'], memberIds: ['u1'] }, // fully
        { id: 'gFB', name: 'B',  type: 'course', school: 'Sur',   studentIds: [],     memberIds: [] },     // fallback
        { id: 'gEI', name: 'C',  type: 'course', school: null,    studentIds: [],     memberIds: [] },     // empty
    ];
    const r = runMembershipGovernanceHandler({
        users, groups, query: { state: 'fully_explicit,empty_inert' },
    });
    ok('totalGroups=3 (global)',           r.body.totalGroups === 3);
    ok('counts mantienen los 3 estados',
        r.body.counts.fully_explicit === 1 &&
        r.body.counts.fallback_dependent === 1 &&
        r.body.counts.empty_inert === 1);
    ok('groups filtrado a 2',              r.body.groups.length === 2);
    const stateSet = new Set(r.body.groups.map(g => g.state));
    ok('solo fully + empty en response',   stateSet.has('fully_explicit') && stateSet.has('empty_inert') && !stateSet.has('fallback_dependent'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. includeAudit=false (default) — lastAuditEvent es null incluso si hay audit
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] includeAudit=false default — audit NO se hidrata');
{
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'N', groupIds: ['g1'] }];
    const groups = [{ id: 'g1', school: 'N', studentIds: ['u1'], memberIds: ['u1'] }];
    const audit  = [{
        timestamp: '2026-05-01T00:00:00.000Z',
        action: 'membership.materialize',
        actor: 'admin1',
        auditReferenceId: '01HXAUD',
        details: { groupId: 'g1' },
    }];
    const r = runMembershipGovernanceHandler({ users, groups, audit });
    ok('lastAuditEvent null por default', r.body.groups[0].lastAuditEvent === null);

    // ?includeAudit=false literal también null
    const r2 = runMembershipGovernanceHandler({ users, groups, audit, query: { includeAudit: 'false' } });
    ok('includeAudit=false literal sigue null', r2.body.groups[0].lastAuditEvent === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. includeAudit=true — toma el más reciente por grupo
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] includeAudit=true — pick más reciente por grupo');
{
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'N', groupIds: ['g1'] }];
    const groups = [{ id: 'g1', school: 'N', studentIds: ['u1'], memberIds: ['u1'] }];
    const audit  = [
        { timestamp: '2026-05-01T00:00:00.000Z', action: 'a1', actor: 'alice',
          auditReferenceId: 'A1', details: { groupId: 'g1' } },
        { timestamp: '2026-05-09T00:00:00.000Z', action: 'a2', actor: 'bob',
          auditReferenceId: 'A2', details: { groupId: 'g1' } },
        { timestamp: '2026-05-05T00:00:00.000Z', action: 'a3', actor: 'carol',
          auditReferenceId: 'A3', details: { groupId: 'gOTHER' } },
    ];
    const r = runMembershipGovernanceHandler({
        users, groups, audit, query: { includeAudit: 'true' },
    });
    const ev = r.body.groups[0].lastAuditEvent;
    ok('lastAuditEvent hidratado',        ev !== null);
    ok('toma timestamp más reciente',     ev?.ts === '2026-05-09T00:00:00.000Z');
    ok('action correcto',                 ev?.action === 'a2');
    ok('actor correcto',                  ev?.actor === 'bob');
    ok('auditReferenceId correcto',       ev?.auditReferenceId === 'A2');
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. includeAudit con audit ilegible → no rompe; todos los rows null
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[10] includeAudit + audit ilegible — degradación silenciosa');
{
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'N', groupIds: ['g1'] }];
    const groups = [{ id: 'g1', school: 'N', studentIds: ['u1'], memberIds: ['u1'] }];
    const r = runMembershipGovernanceHandler({
        users, groups,
        query: { includeAudit: 'true' },
        readJSONImpl: (token) => {
            if (token === 'USERS_DB')      return users;
            if (token === 'GROUPS_DB')     return groups;
            if (token === 'USER_AUDIT_DB') throw new Error('audit corrupto');
            throw new Error(`unexpected: ${token}`);
        },
    });
    ok('status 200 (no propaga el throw)',  r.statusCode === 200);
    ok('lastAuditEvent null',               r.body.groups[0].lastAuditEvent === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Sort risk-first: corrupted → recoverable → fallback → fully → empty
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[11] sort risk-first');
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'N', groupIds: ['gFE'] },
        { id: 'u2', roles: ['lector'], colegio: 'S', groupIds: [] },
    ];
    const groups = [
        { id: 'gFE', name: 'Z',  type: 'course', school: 'N', studentIds: ['u1'], memberIds: ['u1'] }, // fully
        { id: 'gFB', name: 'A',  type: 'course', school: 'S', studentIds: [],     memberIds: [] },     // fallback
        { id: 'gEI', name: 'M',  type: 'course', school: null, studentIds: [],   memberIds: [] },     // empty
    ];
    const r = runMembershipGovernanceHandler({ users, groups });
    const order = r.body.groups.map(g => g.state);
    ok('orden: fallback_dependent < fully_explicit',
        order.indexOf('fallback_dependent') < order.indexOf('fully_explicit'));
    ok('orden: fully_explicit < empty_inert',
        order.indexOf('fully_explicit') < order.indexOf('empty_inert'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Sort dentro de bucket: alfabético por name
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] sort alfabético dentro de bucket');
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'N', groupIds: ['gZ'] },
        { id: 'u2', roles: ['lector'], colegio: 'N', groupIds: ['gA'] },
    ];
    const groups = [
        { id: 'gZ', name: 'Zorro',  type: 'course', school: 'N', studentIds: ['u1'], memberIds: ['u1'] },
        { id: 'gA', name: 'Águila', type: 'course', school: 'N', studentIds: ['u2'], memberIds: ['u2'] },
    ];
    const r = runMembershipGovernanceHandler({ users, groups });
    // comparePriority usa localeCompare. 'á' > 'z' en raw codepoint, pero
    // localeCompare bajo locale por defecto pone 'á' antes de 'z'. Aserto
    // sobre la posición real.
    ok('orden alfabético: Águila[0] < Zorro[1]',
        r.body.groups[0].name === 'Águila' && r.body.groups[1].name === 'Zorro');
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Error path — readJSON falla → 500 con shape genérico
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] error path');
{
    const r = runMembershipGovernanceHandler({
        users: [], groups: [],
        readJSONImpl: () => { throw new Error('ENOENT'); },
    });
    ok('status=500',                      r.statusCode === 500);
    ok('body.error existe',               typeof r.body?.error === 'string');
    ok('body.message existe',             typeof r.body?.message === 'string');
    ok('NO expone error técnico',         !/ENOENT/.test(r.body?.message || ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Filter school + state combinados
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] filter school + state combinados');
{
    // Importante: para que un grupo sea fallback_dependent, debe ser el ÚNICO
    // grupo de su escuela (single-school). Si ponemos 2 grupos con school='N',
    // ambos colapsan a empty_inert/multi_school.
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'N', groupIds: [] },             // → fallback eligible para gN
        { id: 'u2', roles: ['lector'], colegio: 'S', groupIds: ['gS'] },          // → explicit en gS
    ];
    const groups = [
        { id: 'gN', name: 'NorteUnico', school: 'N', studentIds: [],     memberIds: [] },     // fallback N
        { id: 'gS', name: 'SurUnico',   school: 'S', studentIds: ['u2'], memberIds: ['u2'] }, // fully S
        { id: 'gO', name: 'OtroUnico',  school: 'O', studentIds: [],     memberIds: [] },     // empty_inert (no lectores)
    ];
    const r = runMembershipGovernanceHandler({
        users, groups, query: { school: 'N', state: 'fallback_dependent' },
    });
    ok('1 row resultante (N ∩ fallback)', r.body.groups.length === 1);
    ok('row.id=gN',                        r.body.groups[0].id === 'gN');
    ok('totalGroups=3 (global)',           r.body.totalGroups === 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cierre
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\nendpointMembershipGovernance — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
