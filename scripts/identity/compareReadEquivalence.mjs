#!/usr/bin/env node
/**
 * compareReadEquivalence.mjs — CHP-IDDB-02C-A.
 *
 * Compara las LECTURAS de identidad JSON vs SQLite para el dominio canónico
 * elegible, a nivel de contrato lógico. READ-ONLY absoluto: abre identity.db
 * en readonly, no escribe ningún store y no imprime PII (identificadores
 * hasheados, jamás nombres ni correos).
 *
 * QUÉ COMPARA (y qué no)
 * ----------------------
 * `reconcileIdentityShadow --check` ya compara la PROYECCIÓN columnar
 * (diagnose). Este comparador cubre lo que aquél no mira: la forma que las
 * lecturas REALES devuelven —el `raw_json` que `identityReadFacade` serviría,
 * las funciones del repo (`byId`, `byEmail`, `membershipsOfUser`, …)— y los
 * casos negativos, contra lo que el JSON canónico produce hoy.
 *
 * CONTRATO DE EQUIVALENCIA (Fase 3)
 * ---------------------------------
 * NO se exige igualdad de: timestamps internos, provenance, source_version,
 * contabilidad shadow, orden físico de arrays ni campos no expuestos.
 * SÍ se exige, por entidad:
 *   USER        todos los campos del registro JSON excepto password/passwordHash
 *               (el espejo los excluye POR DISEÑO: credential_excluded=1).
 *   INSTITUTION institution_id ↔ id, official_name ↔ name, status activo.
 *   GROUP       registro completo (raw_json = registro JSON) + columnas
 *               derivadas (institution_id ↔ organizationId, type, grade_level,
 *               section, legacy_school ↔ school).
 *   MEMBERSHIP  (user, group, institution, role, status) con cardinalidad
 *               exacta y sin duplicados, en AMBOS sentidos.
 *
 * MATRIZ DE EXCLUSIONES (Fase 4) — divergencias INTENCIONALES, no mismatches:
 *   cohorte sintética (_loadtest_marker)  → en JSON, NUNCA en SQLite
 *   tombstones                            → tabla propia, jamás users
 *   grupos legacy/test y sintéticos       → en JSON, excluidos del espejo
 *   credenciales                          → jamás en SQLite
 *   access                                → dominio NO espejado aún (gap declarado)
 * Cualquier otra diferencia es UNEXPECTED_DIVERGENCE.
 *
 * CONSISTENCY FENCE (Fase 5): hashes de las fuentes al inicio y al final; si
 * difieren la corrida se marca sourcesStable=false (UNSTABLE_SAMPLE) y el
 * llamador decide repetir. SQLite se lee en readonly (WAL da vista estable).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { resolveLiveSources } from './identityLiveSources.mjs';
import { projectCanonical } from './reconcileIdentityShadow.mjs';
import { canonicalJson, ImportError } from './importIdentityCandidate.mjs';
import { makeIdentityRepo } from '../../server/repositories/identityRepo.js';

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const h16 = (v) => sha(v).slice(0, 16);
const AT = '1970-01-01T00:00:00.000Z';   // proyección determinista; los timestamps no forman parte del contrato

const stripCredentials = (u) => {
    const out = {};
    for (const k of Object.keys(u ?? {})) {
        if (k === 'password' || k === 'passwordHash') continue;
        out[k] = u[k];
    }
    return out;
};
const logicallyEqual = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Acumulador de casos con evidencia sin PII. */
function makeTally(section) {
    const t = { section, TOTAL_CASES: 0, MATCH: 0, EXPECTED_DIVERGENCE: 0,
        UNEXPECTED_DIVERGENCE: 0, evidence: [] };
    t.match = () => { t.TOTAL_CASES++; t.MATCH++; };
    t.expected = () => { t.TOTAL_CASES++; t.EXPECTED_DIVERGENCE++; };
    t.mismatch = (ev) => {
        t.TOTAL_CASES++; t.UNEXPECTED_DIVERGENCE++;
        if (t.evidence.length < 25) t.evidence.push(ev);   // acotado
    };
    return t;
}

export function compareReadEquivalence({ sourcesRoot, identityDbPath }) {
    if (!identityDbPath) throw new ImportError('IDENTITY_DB_REQUIRED', 'se exige --identity-db');
    if (!fs.existsSync(identityDbPath)) throw new ImportError('IDENTITY_DB_NOT_FOUND', identityDbPath);

    // ── Fence: apertura + primera captura de hashes (el contrato LIVE ya
    //    valida forma, claves, duplicados y cohorte sintética; fail-closed).
    const pre = resolveLiveSources({ sourcesRoot });
    const db = new Database(path.resolve(identityDbPath), { readonly: true });

    try {
        const repo = makeIdentityRepo(db);
        if (repo.schemaVersion() < 2) {
            throw new ImportError('SCHEMA_NOT_V2', 'el comparador exige el esquema v2');
        }
        const sources = pre.sources;
        const syntheticIds = new Set(pre.syntheticIds);

        // Dominio elegible: EXACTAMENTE como lo define el reconciliador
        // (tombstones + migration_exclusions + instituciones resolubles).
        const expected = projectCanonical(db, {
            users: sources.users, groups: sources.groups, institutions: sources.institutions,
        }, AT);
        const eligibleUserIds = new Set(expected.users.map(u => u.canonical_id));
        const eligibleGroupIds = new Set(expected.groups.map(g => g.group_id));
        const jsonUserById = new Map(sources.users.map(u => [String(u.id), u]));
        const jsonGroupById = new Map(sources.groups.map(g => [String(g.id), g]));

        const report = { sections: {}, exclusions: {}, negatives: {}, fence: {} };
        const S = (name) => (report.sections[name] = makeTally(name));

        // ══ FASE 6 — USERS ════════════════════════════════════════════════
        const tUsers = S('users_all');
        const sqliteUsers = repo.users.all();                       // lo que el facade serviría
        const sqliteUserById = new Map(sqliteUsers.map(u => [String(u.id), u]));
        for (const id of eligibleUserIds) {
            const j = stripCredentials(jsonUserById.get(id));
            const s = sqliteUserById.get(id);
            if (!s) { tUsers.mismatch({ kind: 'MISSING_IN_SQLITE', entity: 'user', ref: h16(id) }); continue; }
            if (!logicallyEqual(j, s)) {
                const fields = Object.keys({ ...j, ...s })
                    .filter(k => canonicalJson(j?.[k] ?? null) !== canonicalJson(s?.[k] ?? null));
                tUsers.mismatch({ kind: 'FIELD_MISMATCH', entity: 'user', ref: h16(id),
                    fields: fields.slice(0, 6) });
                continue;
            }
            tUsers.match();
        }
        for (const id of sqliteUserById.keys()) {
            if (!eligibleUserIds.has(id)) {
                tUsers.mismatch({ kind: 'UNEXPECTED_IN_SQLITE', entity: 'user', ref: h16(id) });
            }
        }

        // Exclusiones de usuarios (matriz F4): sintéticos jamás en SQLite.
        const tSynth = S('users_synthetic_exclusion');
        for (const id of syntheticIds) {
            if (sqliteUserById.has(id)) {
                tSynth.mismatch({ kind: 'SYNTHETIC_PRESENT_IN_SQLITE', ref: h16(id) });
            } else tSynth.expected();          // divergencia INTENCIONAL comprobada
        }
        // Tombstones: jamás presentes como users, jamás autenticables.
        const tTomb = S('tombstones_invariants');
        const tombs = db.prepare(
            `SELECT tombstone_id, legacy_identity_hash, authentication_allowed
             FROM identity_tombstones`).all();
        for (const t of tombs) {
            const asUser = db.prepare(`SELECT 1 FROM users WHERE canonical_id = ?`)
                .get(t.tombstone_id);
            if (asUser) tTomb.mismatch({ kind: 'TOMBSTONE_AS_USER', ref: h16(t.tombstone_id) });
            else if (t.authentication_allowed !== 0) {
                tTomb.mismatch({ kind: 'TOMBSTONE_AUTHENTICABLE', ref: h16(t.tombstone_id) });
            } else tTomb.expected();
        }

        // ══ FASE 7 — INSTITUTIONS ═══════════════════════════════════════════
        const tInst = S('institutions');
        const sqliteInst = new Map(repo.institutions.all().map(i => [i.institution_id, i]));
        const expInstIds = new Set(expected.institutions.map(i => i.institution_id));
        for (const e of expected.institutions) {
            const s = sqliteInst.get(e.institution_id);
            const j = sources.institutions.find(x => String(x.id) === e.institution_id);
            if (!s) { tInst.mismatch({ kind: 'MISSING_IN_SQLITE', entity: 'institution', ref: h16(e.institution_id) }); continue; }
            if (String(s.official_name) !== String(j.name).trim() || s.status !== 'active') {
                tInst.mismatch({ kind: 'FIELD_MISMATCH', entity: 'institution',
                    ref: h16(e.institution_id), fields: ['official_name/status'] });
                continue;
            }
            tInst.match();
        }
        for (const id of sqliteInst.keys()) {
            if (!expInstIds.has(id)) tInst.mismatch({ kind: 'UNEXPECTED_IN_SQLITE', entity: 'institution', ref: h16(id) });
        }

        // ══ FASE 8 — GROUPS ═════════════════════════════════════════════════
        const tGroups = S('groups_canonical');
        const sqliteGroupsRaw = new Map(repo.groups.all().map(g => [String(g.id), g]));
        for (const gid of eligibleGroupIds) {
            const j = jsonGroupById.get(gid);
            const s = sqliteGroupsRaw.get(gid);
            if (!s) { tGroups.mismatch({ kind: 'MISSING_IN_SQLITE', entity: 'group', ref: h16(gid) }); continue; }
            if (!logicallyEqual(j, s)) {
                tGroups.mismatch({ kind: 'FIELD_MISMATCH', entity: 'group', ref: h16(gid) });
                continue;
            }
            // Columnas derivadas del contrato — leídas de la TABLA, no de
            // groupsV2.byId(): esa shape no expone grade_level/section (y eso
            // es parte del contrato de la shape, no un defecto).
            const col = db.prepare(
                `SELECT institution_id, type, grade_level, section, legacy_school
                 FROM groups WHERE group_id = ? AND deleted_at IS NULL`).get(gid);
            const colOk = col && col.institution_id === String(j.organizationId)
                && col.type === String(j.type)
                && String(col.grade_level ?? '') === String(j.gradeLevel ?? j.grade ?? '')
                && String(col.section ?? '') === String(j.section ?? '')
                && String(col.legacy_school ?? '') === String(j.school ?? '');
            if (!colOk) { tGroups.mismatch({ kind: 'COLUMN_CONTRACT_MISMATCH', entity: 'group', ref: h16(gid) }); continue; }
            tGroups.match();
        }
        for (const gid of sqliteGroupsRaw.keys()) {
            if (!eligibleGroupIds.has(gid)) tGroups.mismatch({ kind: 'UNEXPECTED_IN_SQLITE', entity: 'group', ref: h16(gid) });
        }
        // Clasificación de los grupos JSON no canónicos (matriz F4).
        const tExcl = S('groups_excluded_classification');
        const exclGroupHashes = new Set(db.prepare(
            `SELECT reference_hash FROM migration_exclusions WHERE entity='group'`).all()
            .map(r => r.reference_hash));
        const groupClasses = { CANONICAL: 0, EXCLUDED_BY_POLICY: 0, UNRESOLVED_INSTITUTION: 0, UNCLASSIFIED: 0 };
        for (const g of sources.groups) {
            const gid = String(g.id);
            if (eligibleGroupIds.has(gid)) { groupClasses.CANONICAL++; continue; }
            if (exclGroupHashes.has(h16(gid))) { groupClasses.EXCLUDED_BY_POLICY++; tExcl.expected(); continue; }
            const oid = String(g.organizationId ?? '');
            if (!oid || !expInstIds.has(oid)) { groupClasses.UNRESOLVED_INSTITUTION++; tExcl.expected(); continue; }
            groupClasses.UNCLASSIFIED++;
            tExcl.mismatch({ kind: 'GROUP_EXCLUDED_WITHOUT_POLICY', ref: h16(gid) });
        }
        report.exclusions.groups = groupClasses;

        // ══ FASE 9 — MEMBERSHIPS (ambos sentidos) ═══════════════════════════
        const tMem = S('memberships');
        const expMem = new Map(expected.memberships.map(m =>
            [`${m.group_id}|${m.user_id}|${m.role}`, m]));
        const sqlMem = db.prepare(
            `SELECT membership_id, user_id, group_id, institution_id, role, status FROM memberships`).all();
        const seenKeys = new Set();
        for (const m of sqlMem) {
            const key = `${m.group_id}|${m.user_id}|${m.role}`;
            if (seenKeys.has(key)) { tMem.mismatch({ kind: 'DUPLICATE', ref: h16(key) }); continue; }
            seenKeys.add(key);
            const e = expMem.get(key);
            if (!e) { tMem.mismatch({ kind: 'EXTRA_IN_SQLITE', ref: h16(key) }); continue; }
            if (e.institution_id !== m.institution_id || m.status !== 'active') {
                tMem.mismatch({ kind: 'FIELD_MISMATCH', ref: h16(key), fields: ['institution_id/status'] });
                continue;
            }
            tMem.match();
        }
        for (const key of expMem.keys()) {
            if (!seenKeys.has(key)) tMem.mismatch({ kind: 'MISSING_IN_SQLITE', ref: h16(key) });
        }

        // ══ FASE 10 — READ SHAPES (funciones reales del repo) ═══════════════
        const tShapes = S('read_shapes');
        for (const id of eligibleUserIds) {                       // users.byId
            const s = repo.users.byId(id);
            const j = stripCredentials(jsonUserById.get(id));
            (s && logicallyEqual(j, s)) ? tShapes.match()
                : tShapes.mismatch({ kind: 'BYID_DIVERGES', entity: 'user', ref: h16(id) });
        }
        {                                                          // users.byEmail (solo correos únicos en el dominio elegible)
            const freq = new Map();
            for (const id of eligibleUserIds) {
                const em = String(jsonUserById.get(id).email ?? '').trim().toLowerCase();
                freq.set(em, (freq.get(em) ?? 0) + 1);
            }
            let dupEmails = 0;
            for (const id of eligibleUserIds) {
                const j = jsonUserById.get(id);
                const em = String(j.email ?? '').trim().toLowerCase();
                if ((freq.get(em) ?? 0) !== 1) { dupEmails++; continue; }
                const s = repo.users.byEmail(em);
                (s && String(s.id) === String(j.id)) ? tShapes.match()
                    : tShapes.mismatch({ kind: 'BYEMAIL_DIVERGES', entity: 'user', ref: h16(id) });
            }
            report.exclusions.duplicated_emails_skipped_in_byEmail = dupEmails;
        }
        for (const e of expected.institutions) {                   // institutions.byId + groupsOf
            const s = repo.institutions.byId(e.institution_id);
            (s && s.institution_id === e.institution_id) ? tShapes.match()
                : tShapes.mismatch({ kind: 'INST_BYID_DIVERGES', ref: h16(e.institution_id) });
            const gs = repo.institutions.groupsOf(e.institution_id).map(g => g.group_id).sort();
            const je = expected.groups.filter(g => g.institution_id === e.institution_id)
                .map(g => g.group_id).sort();
            logicallyEqual(gs, je) ? tShapes.match()
                : tShapes.mismatch({ kind: 'GROUPSOF_DIVERGES', ref: h16(e.institution_id) });
        }
        for (const gid of eligibleGroupIds) {                      // membersOf por grupo
            const got = repo.groupsV2.membersOf(gid).map(m => `${m.user_id}|${m.role}`).sort();
            const exp = expected.memberships.filter(m => m.group_id === gid)
                .map(m => `${m.user_id}|${m.role}`).sort();
            logicallyEqual(got, exp) ? tShapes.match()
                : tShapes.mismatch({ kind: 'MEMBERSOF_DIVERGES', ref: h16(gid) });
        }
        {                                                          // membershipsOfUser por usuario con membresías
            const byUser = new Map();
            for (const m of expected.memberships) {
                if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
                byUser.get(m.user_id).push(`${m.group_id}|${m.role}`);
            }
            for (const [uid, exp] of byUser) {
                const got = repo.memberships.ofUser(uid).map(m => `${m.group_id}|${m.role}`).sort();
                logicallyEqual(got, exp.sort()) ? tShapes.match()
                    : tShapes.mismatch({ kind: 'MEMBERSHIPSOFUSER_DIVERGES', ref: h16(uid) });
            }
        }
        {                                                          // aliases: cada alias activo resuelve a user XOR tombstone y el destino existe
            const aliases = db.prepare(
                `SELECT legacy_alias, user_id, tombstone_id FROM identity_aliases WHERE status='active'`).all();
            for (const a of aliases) {
                const r = repo.aliases.resolve(a.legacy_alias);
                const ok = r && ((r.target === 'user' && r.userId && sqliteUserById.has(String(r.userId)))
                    || (r.target === 'tombstone' && r.tombstoneId));
                ok ? tShapes.match()
                   : tShapes.mismatch({ kind: 'ALIAS_RESOLUTION_BROKEN', ref: h16(a.legacy_alias) });
            }
            report.exclusions.aliases_checked = aliases.length;
        }
        for (const t of tombs) {                                   // tombstones.byHash
            const r = repo.tombstones.byHash(t.legacy_identity_hash);
            (r && r.tombstone_id === t.tombstone_id && r.authentication_allowed === 0)
                ? tShapes.match()
                : tShapes.mismatch({ kind: 'TOMBSTONE_BYHASH_DIVERGES', ref: h16(t.tombstone_id) });
        }

        // ══ FASE 11 — CASOS NEGATIVOS ═══════════════════════════════════════
        const neg = {};
        const expectNull = (label, v) => { neg[label] = v == null ? 'NOT_FOUND(ok)' : 'FOUND(!)' ; return v == null; };
        const tNeg = S('negative_cases');
        expectNull('user_inexistente', repo.users.byId('no-such-user-xyz')) ? tNeg.match() : tNeg.mismatch({ kind: 'NEG_USER' });
        expectNull('institution_inexistente', repo.institutions.byId('no-such-inst')) ? tNeg.match() : tNeg.mismatch({ kind: 'NEG_INST' });
        expectNull('group_inexistente', repo.groupsV2.byId('no-such-group')) ? tNeg.match() : tNeg.mismatch({ kind: 'NEG_GROUP' });
        (repo.memberships.ofUser('no-such-user-xyz').length === 0) ? (neg.membership_inexistente = 'EMPTY(ok)', tNeg.match())
            : (neg.membership_inexistente = 'NON_EMPTY(!)', tNeg.mismatch({ kind: 'NEG_MEM' }));
        {   // sintético: JSON lo encuentra, SQLite no → divergencia ESPERADA y direccional
            const sid = pre.syntheticIds[0];
            if (sid) {
                const inJson = jsonUserById.has(String(sid));
                const inSql = repo.users.byId(sid) != null;
                neg.synthetic_user = `json=${inJson ? 'FOUND' : 'MISSING'} sqlite=${inSql ? 'FOUND(!)' : 'NOT_FOUND(ok)'}`;
                (inJson && !inSql) ? tNeg.expected() : tNeg.mismatch({ kind: 'NEG_SYNTH', ref: h16(sid) });
            }
        }
        {   // tombstone como identidad
            const th = tombs[0];
            if (th) {
                const asUser = repo.users.byId(th.tombstone_id) != null;
                neg.tombstoned_identity = asUser ? 'FOUND_AS_USER(!)' : 'NOT_FOUND(ok)';
                asUser ? tNeg.mismatch({ kind: 'NEG_TOMB', ref: h16(th.tombstone_id) }) : tNeg.match();
            }
        }
        {   // grupo legacy/test: en JSON sí, en SQLite no → ESPERADO
            const legacy = sources.groups.map(g => String(g.id)).find(id => !eligibleGroupIds.has(id));
            if (legacy) {
                const inJson = jsonGroupById.has(legacy);
                const inSql = repo.groupsV2.byId(legacy) != null;
                neg.legacy_group = `json=${inJson ? 'FOUND' : 'MISSING'} sqlite=${inSql ? 'FOUND(!)' : 'NOT_FOUND(ok)'}`;
                (inJson && !inSql) ? tNeg.expected() : tNeg.mismatch({ kind: 'NEG_LEGACY', ref: h16(legacy) });
            }
        }
        for (const [label, bad] of [['identificador_vacio', ''], ['identificador_no_string', 12345]]) {
            const r = repo.users.byId(bad);
            neg[label] = r == null ? 'NOT_FOUND(ok)' : 'FOUND(!)';
            r == null ? tNeg.match() : tNeg.mismatch({ kind: 'NEG_INVALID_ID' });
        }
        report.negatives = neg;

        // ── Fence: segunda captura ───────────────────────────────────────────
        const post = resolveLiveSources({ sourcesRoot });
        const stable = ['padron', 'groups', 'institutions'].every(k =>
            pre.attestation.canonicalSourceIdentity[k].sha256
            === post.attestation.canonicalSourceIdentity[k].sha256);
        report.fence = {
            sourcesStable: stable,
            classification: stable ? 'STABLE_SAMPLE' : 'UNSTABLE_SAMPLE',
            pre: pre.attestation.canonicalSourceIdentity,
            post: stable ? undefined : post.attestation.canonicalSourceIdentity,
        };

        // ── Agregado ─────────────────────────────────────────────────────────
        const agg = { TOTAL_CASES: 0, MATCH: 0, EXPECTED_DIVERGENCE: 0, UNEXPECTED_DIVERGENCE: 0 };
        for (const s of Object.values(report.sections)) {
            for (const k of Object.keys(agg)) agg[k] += s[k];
        }
        return {
            tool: 'compareReadEquivalence', unit: 'CHP-IDDB-02C-A',
            backendA: 'json(live sources)', backendB: 'sqlite(identityRepo, readonly)',
            eligible: { users: eligibleUserIds.size, institutions: expected.institutions.length,
                groups: eligibleGroupIds.size, memberships: expected.memberships.length },
            aggregate: agg,
            sections: Object.fromEntries(Object.entries(report.sections)
                .map(([k, v]) => [k, { TOTAL_CASES: v.TOTAL_CASES, MATCH: v.MATCH,
                    EXPECTED_DIVERGENCE: v.EXPECTED_DIVERGENCE,
                    UNEXPECTED_DIVERGENCE: v.UNEXPECTED_DIVERGENCE,
                    evidence: v.evidence.length ? v.evidence : undefined }])),
            exclusions: report.exclusions,
            negatives: report.negatives,
            fence: report.fence,
        };
    } finally {
        db.close();
    }
}

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--sources-root') a.sourcesRoot = argv[++i];
        else if (argv[i] === '--identity-db') a.identityDbPath = argv[++i];
    }
    return a;
}
const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('compareReadEquivalence.mjs');
if (invokedDirectly) {
    try {
        const r = compareReadEquivalence(parseArgs(process.argv.slice(2)));
        console.log(JSON.stringify(r, null, 1));
        const bad = r.aggregate.UNEXPECTED_DIVERGENCE > 0 || !r.fence.sourcesStable;
        process.exit(bad ? 2 : 0);
    } catch (e) {
        console.error(`STOP — ${e.classification ?? 'COMPARE_FAILED'}: ${e.message}`);
        process.exit(1);
    }
}
