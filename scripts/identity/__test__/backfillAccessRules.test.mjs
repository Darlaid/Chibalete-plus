/**
 * backfillAccessRules.test.mjs — CHP-IDDB-GAP4-ACCESS-RULES-01.
 *
 * Prueba la cadena completa del cierre de GAP-4 sobre fixtures herméticas:
 *
 *   canonical access source → censo/validación → backfill (mirrorAccess REAL)
 *   → equivalencia semántica de decisión JSON ↔ SQLite → idempotencia →
 *   revocación → sincronización de escrituras futuras (identityWriteHook REAL)
 *   → reconciliación LIVE con sección access → comparador runtime (MATCH y
 *   mismatch de seguridad artificial).
 *
 * Ningún caso toca stores reales ni rutas productivas.
 *
 *   node scripts/identity/__test__/backfillAccessRules.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../server/db/migrate.js';
import { mirrorSnapshotV2 } from '../../../server/db/identityShadowV2.js';
import { backfillAccessRules, censusAccessRules, validateAccessRule,
    diffAccessMirror, compareAccessDecisions, parseArgs } from '../backfillAccessRules.mjs';
import { reconcileIdentityShadow } from '../reconcileIdentityShadow.mjs';
import { resolveLiveSources } from '../identityLiveSources.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e.classification ?? e.message; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb_gap4_'));
const ROOT = path.join(tmp, 'root');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'data-critical'), { recursive: true });
const P = {
    padron: path.join(ROOT, 'data-critical', 'usuarios_colegios_oro.json'),
    groups: path.join(ROOT, 'data', 'groups_db.json'),
    institutions: path.join(ROOT, 'data', 'schools_db.json'),
    access: path.join(ROOT, 'data', 'access_db.json'),
};
const writeAt = (p, o) => { fs.writeFileSync(p, JSON.stringify(o, null, 1)); return p; };

// ── Fixtures: topología con las tres clases de scope + regla expirada ────────
const INST = [{ id: 'inst-a', name: 'Alfa' }];
const GROUPS = [
    { id: 'g-can', organizationId: 'inst-a', name: 'Primero A', type: 'course',
      memberIds: ['u-lector'], mediatorIds: ['u-med'] },
    { id: 'g-otro', organizationId: 'inst-a', name: 'Segundo B', type: 'club',
      memberIds: ['u-otro'], mediatorIds: [] },
];
const USERS = [
    { id: 'u-lector', email: 'l@x.cl', roles: ['lector'], accountStatus: 'active',
      organizationId: 'inst-a' },
    { id: 'u-otro', email: 'o@x.cl', roles: ['lector'], accountStatus: 'active',
      organizationId: 'inst-a' },
    { id: 'u-med', email: 'm@x.cl', roles: ['mediador'], accountStatus: 'active',
      organizationId: 'inst-a' },
    { id: 'u-sin-org', email: 's@x.cl', roles: ['lector'], accountStatus: 'active' },
];
const FUTURE = Date.now() + 86400000;
const PAST = Date.now() - 86400000;
const RULES = [
    { id: 'r-group', scope: 'group', scopeId: 'g-can', titleIds: ['t-1', 't-2'],
      collectionIds: [], expiresAt: null },
    { id: 'r-user', scope: 'user', scopeId: 'u-otro', titleIds: ['t-3'],
      collectionIds: ['col-1'], expiresAt: FUTURE },
    { id: 'r-org', scope: 'organization', scopeId: 'inst-a', titleIds: ['t-org'],
      collectionIds: [], expiresAt: null },
    { id: 'r-expirada', scope: 'group', scopeId: 'g-otro', titleIds: ['t-caducado'],
      collectionIds: [], expiresAt: PAST },
];
writeAt(P.padron, USERS); writeAt(P.groups, GROUPS); writeAt(P.institutions, INST);
writeAt(P.access, RULES);

const DBP = path.join(tmp, 'identity.db');
{
    const db = new Database(DBP);
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const svv = (r) => ({ hash: sha(JSON.stringify(r)).slice(0, 32), seq: 1 });
    for (const [domain, records] of [['institutions', INST], ['users', USERS], ['groups', GROUPS]]) {
        mirrorSnapshotV2(db, { domain, records, sourceVersion: svv(records),
            writerId: 'server.writeJSON', at: '2026-01-01T00:00:00Z' });
    }
    db.close();
}
const q = (sql, ro = true) => {
    const db = new Database(DBP, { readonly: ro });
    try { return db.prepare(sql).all(); } finally { db.close(); }
};

try {
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[1] CONTRATO: validación y censo del store canónico');
    ok('regla válida → 0 defectos', validateAccessRule(RULES[0]).length === 0);
    ok('scope desconocido → INVALID_SCOPE',
        validateAccessRule({ id: 'x', scope: 'planet', scopeId: 'p' }).includes('INVALID_SCOPE'));
    ok('scopeId vacío → EMPTY_SCOPE_ID',
        validateAccessRule({ id: 'x', scope: 'user', scopeId: ' ' }).includes('EMPTY_SCOPE_ID'));
    ok('titleIds no-array-de-strings → defecto',
        validateAccessRule({ id: 'x', scope: 'user', scopeId: 'u', titleIds: [1] })
            .includes('TITLEIDS_NOT_STRING_ARRAY'));
    ok('expiresAt no numérico → defecto',
        validateAccessRule({ id: 'x', scope: 'user', scopeId: 'u', expiresAt: 'mañana' })
            .includes('EXPIRES_AT_NOT_FINITE_NUMBER'));
    ok('regla malformada (no objeto) → NOT_AN_OBJECT', validateAccessRule(null).includes('NOT_AN_OBJECT'));

    const census = censusAccessRules(RULES);
    ok('censo: TOTAL=4 ACTIVE=3 EXPIRED=1',
        census.aggregates.TOTAL === 4 && census.aggregates.ACTIVE === 3 && census.aggregates.EXPIRED === 1,
        JSON.stringify(census.aggregates));
    ok('censo: scopes 1 user / 2 group / 1 organization',
        census.aggregates.USER_SCOPED === 1 && census.aggregates.GROUP_SCOPED === 2
        && census.aggregates.ORGANIZATION_SCOPED === 1);
    ok('censo: proyectadas=4, excluidas=0 (política lossless)',
        census.projectedRows === 4 && census.excluded === 0);
    ok('censo limpio: 0 inválidas / 0 duplicadas / 0 conflictos',
        census.invalid.length === 0 && census.duplicates.length === 0 && census.conflicts.length === 0);

    const dupIdentical = censusAccessRules([...RULES, RULES[0]]);
    ok('duplicado idéntico → DUPLICATES=1 (gate bloquea: upsert colapsaría filas)',
        dupIdentical.duplicates.length === 1 && dupIdentical.conflicts.length === 0);
    const dupDivergent = censusAccessRules([...RULES, { ...RULES[0], titleIds: ['t-99'] }]);
    ok('duplicado divergente → CONFLICTS=1',
        dupDivergent.conflicts.length === 1);
    const withInvalid = censusAccessRules([...RULES, { id: 'mal', scope: 'nope', scopeId: 'x' }]);
    ok('regla inválida contabilizada en INVALID, no proyectada',
        withInvalid.invalid.length === 1 && withInvalid.projectedRows === 4);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[2] FUENTE LIVE: access entra al contrato, vacío es legal');
    const live = resolveLiveSources({ sourcesRoot: ROOT });
    ok('resolveLiveSources expone sources.access (4 reglas)',
        Array.isArray(live.sources.access) && live.sources.access.length === 4);
    ok('atestación registra ruta+hash+conteo de access',
        /^[0-9a-f]{64}$/.test(live.attestation.canonicalSourceIdentity.access.sha256)
        && live.attestation.accounting.accessRuleRecords === 4);
    writeAt(P.access, []);
    ok('access vacío NO aborta (allowEmpty)',
        (await caught(() => resolveLiveSources({ sourcesRoot: ROOT }))) === null);
    writeAt(P.access, [{ id: 'mal', scope: 'planeta', scopeId: 'x' }]);
    ok('scope fuera de contrato → fail closed',
        (await caught(() => resolveLiveSources({ sourcesRoot: ROOT })))
            === 'LIVE_SOURCE_ACCESS_RULE_INVALID_SCOPE');
    writeAt(P.access, [{ id: 'mal2', scope: 'user', scopeId: '' }]);
    ok('scopeId vacío → fail closed',
        (await caught(() => resolveLiveSources({ sourcesRoot: ROOT })))
            === 'LIVE_SOURCE_ACCESS_RULE_WITHOUT_SCOPE_ID');
    writeAt(P.access, RULES);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[3] DRY-RUN: predice sin escribir');
    const dry = await backfillAccessRules({ mode: 'dry-run', sourcesRoot: ROOT, identityDbPath: DBP });
    ok('dry-run ok=true con gates GREEN', dry.ok === true, JSON.stringify(dry.gates));
    ok('predicción: insert=4 update=0 delete=0 noop=0',
        dry.predicted.insert.length === 4 && dry.predicted.update.length === 0
        && dry.predicted.soft_delete.length === 0 && dry.predicted.noop.length === 0);
    ok('equivalencia proyectada: >0 casos, 0 mismatches, 0 de seguridad',
        dry.decision_equivalence_projected.cases > 0
        && dry.decision_equivalence_projected.mismatches === 0
        && dry.decision_equivalence_projected.security_relevant_mismatches === 0,
        JSON.stringify(dry.decision_equivalence_projected));
    ok('dry-run NO escribió (access_rules sigue vacía)',
        q(`SELECT COUNT(*) c FROM access_rules`)[0].c === 0);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[4] APPLY: mirrorAccess real, provenance, equivalencia contra el repo real');
    const applied = await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
    ok('apply ok=true', applied.ok === true, JSON.stringify({ g: applied.gates, a: applied.applied }));
    ok('apply: attempted=4 inserted=4 failed=0',
        applied.applied.attempted === 4 && applied.applied.inserted === 4
        && applied.applied.failed === 0, JSON.stringify(applied.applied));
    ok('residual tras apply = 0 cambios', applied.residual.changes === 0);
    ok('4 filas activas en access_rules',
        q(`SELECT COUNT(*) c FROM access_rules WHERE deleted_at IS NULL`)[0].c === 4);
    ok('shadow_audit access ok=1 con provenance GAP4_BACKFILL y writer atribuido',
        (() => { const a = applied.last_access_audit;
            return a && a.ok === 1 && String(a.detail).startsWith('GAP4_BACKFILL')
                && String(a.detail).includes('::backfillAccessRules.apply')
                && String(a.detail).includes('src='); })(),
        JSON.stringify(applied.last_access_audit));
    ok('equivalencia de decisión contra el espejo REAL: 0 mismatches',
        applied.decision_equivalence_mirror.mismatches === 0
        && applied.decision_equivalence_mirror.security_relevant_mismatches === 0,
        JSON.stringify(applied.decision_equivalence_mirror));

    console.log('\n[5] VERIFY + IDEMPOTENCIA');
    const verify = await backfillAccessRules({ mode: 'verify', sourcesRoot: ROOT, identityDbPath: DBP });
    ok('verify: NEW_CHANGES=0 y ok=true', verify.new_changes === 0 && verify.ok === true);
    const applied2 = await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
    ok('segundo apply: idempotente (0 insert, 4 noop, residual=0)',
        applied2.ok === true && applied2.applied.inserted === 0
        && applied2.applied.noop === 4 && applied2.residual.changes === 0,
        JSON.stringify(applied2.applied));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[6] SEMÁNTICA DE DECISIÓN (positivos y negativos, ambos orígenes)');
    {
        const repoRules = q(`SELECT raw_json FROM access_rules WHERE deleted_at IS NULL`)
            .map(r => JSON.parse(r.raw_json));
        const eq = compareAccessDecisions({ users: USERS, groups: GROUPS,
            jsonRules: RULES, otherRules: repoRules, fallbackMode: 'open' });
        ok('corpus completo: 0 mismatches (principal inexistente, resource inexistente, '
            + 'grupo ajeno, regla expirada y colección incluidos)',
            eq.cases > 40 && eq.mismatches === 0, JSON.stringify(eq));
        // La semántica concreta que el espejo debe conservar:
        const { createAccessService } = await import('../../../server/accessService.js');
        const svc = (rules) => createAccessService({
            readJSON: (p) => p === 'U' ? USERS : p === 'G' ? GROUPS : rules,
            log: () => {}, normalizeUser: u => u, normalizeGroup: g => g,
            USERS_DB: 'U', GROUPS_DB: 'G', ACCESS_DB: 'A', fallbackMode: 'open' });
        for (const [label, rules] of [['JSON', RULES], ['SQLite', repoRules]]) {
            const s = svc(rules);
            ok(`${label}: miembro del grupo → ALLOW por título`,
                s.canUserAccessContent('u-lector', 't-1', { id: 't-1', parentId: null }).allowed === true);
            ok(`${label}: usuario de OTRO grupo → DENY estricto (regla activa no autoriza)`,
                (() => { const d = s.canUserAccessContent('u-otro', 't-1', { id: 't-1', parentId: null });
                    return d.allowed === false && d.legacyFallback === false; })());
            ok(`${label}: colección autorizada → ALLOW vía parentId`,
                s.canUserAccessContent('u-otro', 'lib-x', { id: 'lib-x', parentId: 'col-1' }).allowed === true);
            ok(`${label}: regla EXPIRADA no aplica (miembro de g-otro sin acceso a t-caducado por esa vía)`,
                (() => { const r = s.resolveUserContentAccess('u-otro');
                    return !r.titleIds.includes('t-caducado') && !r.appliedRules.includes('r-expirada'); })());
            ok(`${label}: org scope aplica por organizationId`,
                s.resolveUserContentAccess('u-lector').titleIds.includes('t-org'));
            ok(`${label}: principal sin reglas → fallback legacy (sin concesión estricta)`,
                s.canUserAccessContent('u-sin-org', 't-1', { id: 't-1', parentId: null })
                    .legacyFallback === true);
            ok(`${label}: principal inexistente → sin reglas aplicadas`,
                s.resolveUserContentAccess('quien-sabe').appliedRules.length === 0);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[7] MISMATCH DE SEGURIDAD ARTIFICIAL → detectado, nunca silencioso');
    {
        // Regla extra SOLO en SQLite que concedería t-secreto a u-lector.
        const db = new Database(DBP);
        const extra = { id: 'r-intrusa', scope: 'user', scopeId: 'u-lector',
            titleIds: ['t-secreto'], collectionIds: [], expiresAt: null };
        db.prepare(`INSERT INTO access_rules(id,scope,scope_id,title_ids_json,collection_ids_json,
                    expires_at,raw_json) VALUES (?,?,?,?,?,?,?)`)
            .run(extra.id, extra.scope, extra.scopeId, JSON.stringify(extra.titleIds),
                '[]', null, JSON.stringify(extra));
        db.close();
        const repoRules = q(`SELECT raw_json FROM access_rules WHERE deleted_at IS NULL`)
            .map(r => JSON.parse(r.raw_json));
        const eq = compareAccessDecisions({ users: USERS, groups: GROUPS,
            jsonRules: RULES, otherRules: repoRules, fallbackMode: 'open' });
        ok('DENY(JSON) vs ALLOW(SQLite) → security_relevant_mismatches > 0',
            eq.security_relevant_mismatches > 0, JSON.stringify(eq));
        const rec = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: DBP });
        ok('reconciliación LIVE: la intrusa es UNEXPECTED_IN_SQLITE y el estado NO es MATCH',
            rec.state === 'DIVERGENT' && rec.counts.access.UNEXPECTED_IN_SQLITE === 1,
            JSON.stringify(rec.counts.access));
        // Convergencia: el backfill (full re-sync) elimina la intrusa.
        const heal = await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
        ok('re-apply converge (soft-delete de la intrusa) y vuelve a equivalencia',
            heal.ok === true && heal.applied.soft_deleted === 1
            && heal.decision_equivalence_mirror.mismatches === 0,
            JSON.stringify(heal.applied));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[8] RECONCILIACIÓN LIVE: sección access propia, sin esconderse');
    {
        const rec = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: DBP });
        ok('LIVE=MATCH con access poblada', rec.state === 'MATCH', JSON.stringify(rec.counts));
        ok('counts.access.MATCH=4 reportado como sección propia',
            rec.counts.access && rec.counts.access.MATCH === 4, JSON.stringify(rec.counts.access));
        // Divergencia de dominio access: se reporta, no se disfraza de MATCH global.
        writeAt(P.access, [...RULES, { id: 'r-nueva', scope: 'user', scopeId: 'u-otro',
            titleIds: ['t-nuevo'], collectionIds: [], expiresAt: null }]);
        const rec2 = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: DBP });
        ok('regla nueva solo-JSON → access MISSING_IN_SQLITE=1 y estado DIVERGENT',
            rec2.state === 'DIVERGENT' && rec2.counts.access.MISSING_IN_SQLITE === 1,
            JSON.stringify(rec2.counts.access));
        const heal = await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
        const rec3 = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: DBP });
        ok('tras converger: LIVE=MATCH access.MATCH=5',
            heal.ok === true && rec3.state === 'MATCH' && rec3.counts.access.MATCH === 5);
        writeAt(P.access, RULES);
        await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[9] REVOCACIÓN: JSON vacío → espejo converge a 0 activas');
    {
        writeAt(P.access, []);
        const emptied = await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
        ok('apply con [] → soft_delete de todas, ok=true',
            emptied.ok === true && emptied.applied.soft_deleted === 4, JSON.stringify(emptied.applied));
        ok('0 filas activas; historial conservado (soft delete: 4 reglas + intrusa + r-nueva)',
            q(`SELECT COUNT(*) c FROM access_rules WHERE deleted_at IS NULL`)[0].c === 0
            && q(`SELECT COUNT(*) c FROM access_rules`)[0].c === 6);
        const rec = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: DBP });
        ok('LIVE=MATCH con access vacío a ambos lados', rec.state === 'MATCH');
        writeAt(P.access, RULES);
        await backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT, identityDbPath: DBP });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[10] WRITE-SYNC FUTURO: el hook REAL espeja el write del seam');
    {
        process.env.IDENTITY_DUAL_WRITE = '1';
        process.env.IDENTITY_SQLITE_ENABLED = '1';
        process.env.IDENTITY_DB = DBP;
        const { makeIdentityWriteHook, _resetIdentityWriteHook } =
            await import('../../../server/db/identityWriteHook.js');
        const { closeIdentityDb } = await import('../../../server/db/identityDb.js');
        _resetIdentityWriteHook(); closeIdentityDb();
        const hook = makeIdentityWriteHook({ usersDb: P.padron, groupsDb: P.groups,
            accessDb: P.access, schoolsDb: P.institutions, log: () => {},
            writerId: 'server.writeJSON' });
        const nueva = { id: 'r-post', scope: 'group', scopeId: 'g-otro',
            titleIds: ['t-post'], collectionIds: [], expiresAt: null };
        const updated = [...RULES, nueva];
        writeAt(P.access, updated);        // el write JSON canónico ya ocurrió…
        hook(P.access, updated);           // …y el seam dispara el espejo (async)
        let row = null;
        for (let i = 0; i < 40 && !row; i++) {
            await new Promise(r => setTimeout(r, 100));
            row = q(`SELECT raw_json FROM access_rules WHERE id='r-post' AND deleted_at IS NULL`)[0];
        }
        ok('la regla creada por el writer del seam aparece en SQLite',
            !!row && JSON.parse(row.raw_json).titleIds[0] === 't-post');
        const audit = q(`SELECT ok, detail FROM shadow_audit WHERE domain='access'
                         ORDER BY id DESC LIMIT 1`)[0];
        ok('audit del write futuro: ok=1 atribuido a ::server.writeJSON con src/seq',
            audit && audit.ok === 1 && String(audit.detail).includes('::server.writeJSON')
            && String(audit.detail).includes('src='), JSON.stringify(audit));
        // Idempotencia del canal: repetir el mismo write converge sin duplicar.
        hook(P.access, updated);
        await new Promise(r => setTimeout(r, 500));
        ok('write repetido: sigue habiendo exactamente 5 activas',
            q(`SELECT COUNT(*) c FROM access_rules WHERE deleted_at IS NULL`)[0].c === 5);
        // Revocación vía writer: quitar la regla converge el espejo.
        writeAt(P.access, RULES);
        hook(P.access, RULES);
        let gone = false;
        for (let i = 0; i < 40 && !gone; i++) {
            await new Promise(r => setTimeout(r, 100));
            gone = q(`SELECT COUNT(*) c FROM access_rules
                      WHERE id='r-post' AND deleted_at IS NULL`)[0].c === 0;
        }
        ok('revocación por el writer real converge (r-post soft-deleted)', gone);
        const rec = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: DBP });
        ok('tras el ciclo de escrituras futuras: LIVE=MATCH access.MATCH=4',
            rec.state === 'MATCH' && rec.counts.access.MATCH === 4,
            JSON.stringify(rec.counts.access));
        delete process.env.IDENTITY_DUAL_WRITE;
        closeIdentityDb();
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[11] COMPARADOR RUNTIME: access MATCH real y EXTRA de seguridad');
    {
        process.env.IDENTITY_SQLITE_ENABLED = '1';
        process.env.IDENTITY_SHADOW_COMPARE = '1';
        process.env.IDENTITY_SHADOW_COMPARE_DOMAINS = 'access';
        process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';
        process.env.IDENTITY_SHADOW_COMPARE_STALE_MS = '0';
        process.env.IDENTITY_DB = DBP;
        const CMP = await import('../../../server/db/identityShadowCompare.js');
        const { getIdentityDb, closeIdentityDb } = await import('../../../server/db/identityDb.js');
        const PATHS = { usersDb: P.padron, groupsDb: P.groups, accessDb: P.access,
            schoolsDb: P.institutions };
        CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(DBP);
        await CMP.warmupShadowCompare();
        CMP.observeIdentityShadowRead(P.access, RULES, PATHS, {});
        let a = CMP.getShadowCompareSnapshot().byDomain.access;
        ok('access poblada → 4 MATCH, el gap ACCESS_RULES DESAPARECIÓ solo',
            a.entities.match === 4 && !a.entities.gaps.ACCESS_RULES,
            JSON.stringify(a.entities));
        ok('0 inesperadas / 0 seguridad', a.entities.unexpected === 0 && a.entities.security === 0);
        ok('resultado de la lectura = match', a.results.match === 1, JSON.stringify(a.results));

        // Fila intrusa en el espejo → EXTRA_IN_SQLITE, clasificada de seguridad.
        {
            const db = new Database(DBP);
            db.prepare(`INSERT INTO access_rules(id,scope,scope_id,title_ids_json,collection_ids_json,
                        expires_at,raw_json) VALUES ('r-x','user','u-lector','["t-x"]','[]',NULL,
                        '{"id":"r-x","scope":"user","scopeId":"u-lector","titleIds":["t-x"]}')`).run();
            db.close();
        }
        CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(DBP);
        await CMP.warmupShadowCompare();
        CMP.observeIdentityShadowRead(P.access, RULES, PATHS, {});
        a = CMP.getShadowCompareSnapshot().byDomain.access;
        ok('regla intrusa → SECURITY_RELEVANT_DIVERGENCE (EXTRA_IN_SQLITE)',
            a.entities.security === 1, JSON.stringify(a.entities));
        {
            const db = new Database(DBP);
            db.prepare(`DELETE FROM access_rules WHERE id='r-x'`).run();
            db.close();
        }
        delete process.env.IDENTITY_SHADOW_COMPARE;
        CMP.__resetShadowCompare(); closeIdentityDb();
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[12] CLI y gates de apply');
    ok('CLI: modo por defecto dry-run', parseArgs([]).mode === 'dry-run');
    ok('CLI: --apply explícito', parseArgs(['--apply']).mode === 'apply');
    {
        writeAt(P.access, [...RULES, { ...RULES[0], titleIds: ['divergente'] }]);
        ok('fuente con id duplicado divergente → fail closed ANTES de tocar nada',
            (await caught(() => backfillAccessRules({ mode: 'apply', sourcesRoot: ROOT,
                identityDbPath: DBP }))) === 'LIVE_SOURCE_DUPLICATE_IDENTITY');
        writeAt(P.access, RULES);
        ok('identity-db inexistente → fail closed',
            (await caught(() => backfillAccessRules({ mode: 'dry-run', sourcesRoot: ROOT,
                identityDbPath: path.join(tmp, 'nope.db') }))) === 'IDENTITY_DB_NOT_FOUND');
        ok('modo desconocido → fail closed',
            (await caught(() => backfillAccessRules({ mode: 'yolo', sourcesRoot: ROOT,
                identityDbPath: DBP }))) === 'BACKFILL_MODE_UNKNOWN');
    }
} catch (e) {
    ok('suite ejecutable', false, String(e?.stack || e));
}

console.log(`\n${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
