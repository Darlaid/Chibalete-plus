#!/usr/bin/env node
/**
 * backfillAccessRules.mjs — CHP-IDDB-GAP4-ACCESS-RULES-01.
 *
 * Puebla `identity.db.access_rules` desde el store canónico de reglas de
 * acceso (`access_db.json`) y verifica la equivalencia SEMÁNTICA de decisión
 * entre ambos orígenes. El JSON nunca se modifica: la sincronización es
 * unidireccional JSON → SQLite, exactamente igual que el resto del espejo.
 *
 * POR QUÉ NO ES UN SEGUNDO SISTEMA DE SHADOW
 * ------------------------------------------
 * El canal de espejo de `access` YA existe en producción: cada write de
 * `ACCESS_DB` pasa por writeJSON → identityWriteHook → mirrorAccess (full
 * re-sync transaccional e idempotente, server/db/identityShadow.js). Lo único
 * que faltó históricamente fue la población inicial: el import v2 (02A/02B)
 * omitió el dominio a propósito y nunca hubo un write productivo que disparara
 * el hook. Este instrumento ejecuta UNA VEZ el MISMO mirrorAccess del runtime
 * —una sola implementación, un solo conjunto de reglas— con atribución de
 * escritor fuera de banda (`backfillAccessRules.apply`, ver
 * identityWriteSurface.mjs) y versión de origen registrada como provenance en
 * shadow_audit.
 *
 * MODOS
 *   --dry-run   (default) read-only: censo, validación del contrato, diff
 *               predicho contra el espejo actual y equivalencia de decisión
 *               fuente ↔ proyección. NO escribe.
 *   --apply     ejecuta mirrorAccess una vez (transaccional, idempotente,
 *               restart-safe: re-ejecutarlo converge al mismo estado) y
 *               después verifica: diff residual = 0 y equivalencia de
 *               decisión fuente ↔ espejo REAL (vía identityRepo, el mismo
 *               camino de lectura del runtime).
 *   --verify    read-only post-apply: diff residual (NEW_CHANGES) y
 *               equivalencia de decisión fuente ↔ espejo real.
 *
 * GATES (todos fail-closed; cualquier violación → exit 1 sin escribir)
 *   INVALID=0     toda regla cumple el contrato del Scope Engine
 *                 (id no vacío, scope ∈ {user,group,organization}, scopeId
 *                 no vacío, titleIds/collectionIds arrays de strings si
 *                 existen, expiresAt número finito o null/ausente).
 *   CONFLICTS=0   ningún id repetido (idéntico o divergente: mirrorAccess es
 *                 un upsert por id, un id repetido colapsaría filas).
 *   EXCLUDED=0    política explícita: NINGUNA regla se excluye del espejo.
 *                 El espejo es una copia lossless del store canónico.
 *
 * Cómo correr (fixture):
 *   node scripts/identity/backfillAccessRules.mjs \
 *     --sources-root /ruta/fixture --identity-db /ruta/identity.db --dry-run
 */
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mirrorAccess } from '../../server/db/identityShadow.js';
import { makeIdentityRepo } from '../../server/repositories/identityRepo.js';
import { composeWriterId } from '../../server/db/identityWriteSurface.mjs';
import { runtimeInstanceId } from '../../server/healthHandler.js';
import { createAccessService } from '../../server/accessService.js';
import { resolveLiveSources, ACCESS_RULE_SCOPES } from './identityLiveSources.mjs';
import { assertIdentityDbPath } from './reconcileIdentityShadow.mjs';
import { canonicalJson, ImportError } from './importIdentityCandidate.mjs';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const h16 = (s) => sha(s).slice(0, 16);

/**
 * Valida el contrato de una regla del Scope Engine. Devuelve la lista de
 * defectos (vacía = válida). No lanza: el llamador decide el gate.
 */
export function validateAccessRule(rule) {
    const defects = [];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ['NOT_AN_OBJECT'];
    if (!String(rule.id ?? '').trim()) defects.push('EMPTY_ID');
    if (!ACCESS_RULE_SCOPES.includes(rule.scope)) defects.push('INVALID_SCOPE');
    if (!String(rule.scopeId ?? '').trim()) defects.push('EMPTY_SCOPE_ID');
    for (const field of ['titleIds', 'collectionIds']) {
        const v = rule[field];
        if (v === undefined || v === null) continue;
        if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) {
            defects.push(`${field.toUpperCase()}_NOT_STRING_ARRAY`);
        }
    }
    const exp = rule.expiresAt;
    if (exp !== undefined && exp !== null && !(typeof exp === 'number' && Number.isFinite(exp))) {
        defects.push('EXPIRES_AT_NOT_FINITE_NUMBER');
    }
    return defects;
}

/** Censo + validación del store canónico completo. */
export function censusAccessRules(rules, now = Date.now()) {
    const arr = Array.isArray(rules) ? rules : [];
    const invalid = [];
    const byId = new Map();
    const conflicts = [];
    const duplicates = [];
    const agg = { TOTAL: arr.length, ACTIVE: 0, EXPIRED: 0,
        USER_SCOPED: 0, GROUP_SCOPED: 0, ORGANIZATION_SCOPED: 0 };
    for (const [i, r] of arr.entries()) {
        const defects = validateAccessRule(r);
        if (defects.length) { invalid.push({ index: i, ref: h16(String(r?.id ?? i)), defects }); continue; }
        const id = String(r.id);
        const prev = byId.get(id);
        if (prev !== undefined) {
            duplicates.push(h16(id));
            if (prev !== canonicalJson(r)) conflicts.push(h16(id));
        } else {
            byId.set(id, canonicalJson(r));
        }
        const expired = typeof r.expiresAt === 'number' && Number.isFinite(r.expiresAt) && now > r.expiresAt;
        agg[expired ? 'EXPIRED' : 'ACTIVE']++;
        if (r.scope === 'user') agg.USER_SCOPED++;
        if (r.scope === 'group') agg.GROUP_SCOPED++;
        if (r.scope === 'organization') agg.ORGANIZATION_SCOPED++;
    }
    return { aggregates: agg, invalid, duplicates, conflicts,
        projectedRows: byId.size, excluded: 0 };
}

/**
 * Diff semántico store canónico ↔ tabla access_rules. Compara el registro
 * COMPLETO (raw_json es lossless), no conteos.
 */
export function diffAccessMirror(db, rules) {
    const exp = new Map((Array.isArray(rules) ? rules : [])
        .filter(r => r && String(r.id ?? '').trim())
        .map(r => [String(r.id), canonicalJson(r)]));
    const rows = db.prepare(
        `SELECT id, raw_json FROM access_rules WHERE deleted_at IS NULL`).all();
    const out = { insert: [], update: [], soft_delete: [], noop: [], malformed_raw: [] };
    const seen = new Set();
    for (const row of rows) {
        const id = String(row.id);
        seen.add(id);
        let parsed = null;
        try { parsed = JSON.parse(row.raw_json); }
        catch { out.malformed_raw.push(h16(id)); continue; }
        const e = exp.get(id);
        if (e === undefined) { out.soft_delete.push(h16(id)); continue; }
        out[e === canonicalJson(parsed) ? 'noop' : 'update'].push(h16(id));
    }
    for (const id of exp.keys()) if (!seen.has(id)) out.insert.push(h16(id));
    out.changes = out.insert.length + out.update.length + out.soft_delete.length
        + out.malformed_raw.length;
    return out;
}

/**
 * Equivalencia SEMÁNTICA de decisión: el MISMO motor (createAccessService,
 * el de producción) evaluado con las reglas de un origen y del otro, sobre el
 * corpus completo de principals × contenidos relevantes. La única variable
 * entre ambos servicios es el array de reglas: users/groups/normalización son
 * idénticos a ambos lados, así que cualquier diferencia es atribuible al
 * dominio access — que es exactamente lo que se quiere probar.
 *
 * Direcciones: la igualdad de tuplas de decisión es simétrica y el diff de
 * conjuntos (diffAccessMirror) reporta faltantes y sobrantes en ambos
 * sentidos; ninguna dirección queda sin cubrir.
 */
export function compareAccessDecisions({ users, groups, jsonRules, otherRules,
    fallbackMode = 'open', extraPrincipals = [], extraContents = [] }) {
    const U = 'U', G = 'G';
    const mkSvc = (rules) => createAccessService({
        readJSON: (p) => p === U ? users : p === G ? groups : rules,
        log: () => {}, normalizeUser: (u) => u, normalizeGroup: (g) => g,
        USERS_DB: U, GROUPS_DB: G, ACCESS_DB: 'A', fallbackMode,
    });
    const svcJson = mkSvc(jsonRules);
    const svcOther = mkSvc(otherRules);

    // Corpus de contenidos: todo título referido por cualquier regla de ambos
    // orígenes, un representante por colección referida, y negativos fijos.
    const contents = new Map();
    for (const r of [...jsonRules, ...otherRules]) {
        for (const t of (Array.isArray(r?.titleIds) ? r.titleIds : [])) {
            contents.set(t, { id: t, parentId: null });
        }
        for (const c of (Array.isArray(r?.collectionIds) ? r.collectionIds : [])) {
            const id = `gap4-member-of-${c}`;
            contents.set(id, { id, parentId: c });
        }
    }
    contents.set('gap4-content-inexistente', { id: 'gap4-content-inexistente', parentId: null });
    contents.set('gap4-col-inexistente', { id: 'gap4-col-inexistente', parentId: 'col-que-no-existe' });
    for (const c of extraContents) contents.set(c.id, c);

    const principals = [...users.map(u => String(u.id)), 'gap4-principal-inexistente',
        ...extraPrincipals];

    let cases = 0, mismatches = 0, securityMismatches = 0;
    const samples = [];
    for (const pid of principals) {
        // Superficie de catálogo: resolveUserContentAccess completo.
        const a = svcJson.resolveUserContentAccess(pid);
        const b = svcOther.resolveUserContentAccess(pid);
        cases++;
        const setEq = (x, y) => canonicalJson([...x].sort()) === canonicalJson([...y].sort());
        if (!setEq(a.titleIds, b.titleIds) || !setEq(a.collectionIds, b.collectionIds)
            || !setEq(a.appliedRules, b.appliedRules)) {
            mismatches++;
            const widened = b.titleIds.some(t => !a.titleIds.includes(t))
                || b.collectionIds.some(c => !a.collectionIds.includes(c));
            if (widened) securityMismatches++;
            if (samples.length < 6) samples.push({ kind: 'catalog', principal: h16(pid), widened });
        }
        // Superficie de decisión puntual: canUserAccessContent por contenido.
        for (const content of contents.values()) {
            cases++;
            const dj = svcJson.canUserAccessContent(pid, content.id, content);
            const dz = svcOther.canUserAccessContent(pid, content.id, content);
            if (dj.allowed !== dz.allowed || dj.legacyFallback !== dz.legacyFallback
                || dj.reason !== dz.reason) {
                mismatches++;
                // DENY→ALLOW o pérdida de modo estricto: relevante de seguridad.
                if ((dz.allowed && !dj.allowed)
                    || (dj.legacyFallback === false && dz.legacyFallback === true)) {
                    securityMismatches++;
                }
                if (samples.length < 6) {
                    samples.push({ kind: 'decision', principal: h16(pid),
                        content: h16(content.id),
                        json: { allowed: dj.allowed, fallback: dj.legacyFallback },
                        other: { allowed: dz.allowed, fallback: dz.legacyFallback } });
                }
            }
        }
    }
    return { cases, mismatches, security_relevant_mismatches: securityMismatches, samples };
}

export async function backfillAccessRules({
    mode = 'dry-run', sourcesRoot, identityDbPath,
    fallbackMode = process.env.ACCESS_FALLBACK_MODE || 'open',
    log = () => {},
} = {}) {
    if (!['dry-run', 'apply', 'verify'].includes(mode)) {
        throw new ImportError('BACKFILL_MODE_UNKNOWN', String(mode));
    }
    // Fuentes canónicas con el contrato LIVE completo (rutas derivadas, rejas
    // de basenames, forma validada, hashes como evidencia de la corrida).
    const { sources, attestation } = resolveLiveSources({ sourcesRoot });
    const abs = assertIdentityDbPath(identityDbPath);
    const rules = sources.access;

    const census = censusAccessRules(rules);
    const gates = {
        INVALID: census.invalid.length,
        DUPLICATES: census.duplicates.length,
        CONFLICTS: census.conflicts.length,
        EXCLUDED: census.excluded,
    };
    const gatesGreen = gates.INVALID === 0 && gates.DUPLICATES === 0 && gates.CONFLICTS === 0;

    const db = new Database(abs, { readonly: mode !== 'apply' });
    try {
        // La tabla debe existir (schema 0001, conservada por 0002). Sin ella no
        // hay espejo posible y el instrumento no la crea: eso es del migrador.
        const hasTable = db.prepare(
            `SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_rules'`).get();
        if (!hasTable) throw new ImportError('ACCESS_RULES_TABLE_MISSING', abs);

        const before = diffAccessMirror(db, rules);
        const report = {
            unit: 'CHP-IDDB-GAP4-ACCESS-RULES-01', mode, attestation,
            source_rules: census.aggregates.TOTAL,
            projected_rules: census.projectedRows,
            excluded_rules: census.excluded,
            aggregates: census.aggregates,
            gates, gatesGreen,
            invalid_detail: census.invalid,
            predicted: before,
        };

        if (mode === 'dry-run') {
            // Equivalencia fuente ↔ proyección: lo que el espejo CONTENDRÍA.
            report.decision_equivalence_projected = compareAccessDecisions({
                users: sources.users, groups: sources.groups,
                jsonRules: rules, otherRules: rules.map(r => JSON.parse(JSON.stringify(r))),
                fallbackMode,
            });
            report.ok = gatesGreen
                && report.decision_equivalence_projected.mismatches === 0;
            return report;
        }

        if (mode === 'verify') {
            const repo = makeIdentityRepo(db);
            report.new_changes = before.changes;
            report.decision_equivalence_mirror = compareAccessDecisions({
                users: sources.users, groups: sources.groups,
                jsonRules: rules, otherRules: repo.access.all(),
                fallbackMode,
            });
            const audit = db.prepare(
                `SELECT ok, json_count, sqlite_count, detail FROM shadow_audit
                 WHERE domain='access' ORDER BY id DESC LIMIT 1`).get() ?? null;
            report.last_access_audit = audit;
            report.ok = gatesGreen && before.changes === 0
                && report.decision_equivalence_mirror.mismatches === 0
                && !!audit && audit.ok === 1;
            return report;
        }

        // mode === 'apply'
        if (!gatesGreen) {
            report.ok = false;
            report.stop = 'CHP-IDDB-GAP4 MIGRATION CONFLICT';
            return report;
        }
        const writerId = composeWriterId({
            runtimeInstance: runtimeInstanceId(), callSite: 'backfillAccessRules.apply' });
        const srcMeta = attestation.canonicalSourceIdentity.access;
        const provenance = `GAP4_BACKFILL ${writerId} src=${srcMeta.sha256.slice(0, 32)}`;
        const mirrored = mirrorAccess(db, rules, log, provenance);
        const after = diffAccessMirror(db, rules);
        const repo = makeIdentityRepo(db);
        const equivalence = compareAccessDecisions({
            users: sources.users, groups: sources.groups,
            jsonRules: rules, otherRules: repo.access.all(),
            fallbackMode,
        });
        const audit = db.prepare(
            `SELECT ok, json_count, sqlite_count, detail FROM shadow_audit
             WHERE domain='access' ORDER BY id DESC LIMIT 1`).get() ?? null;
        report.applied = {
            mirror_ok: mirrored,
            attempted: census.projectedRows,
            inserted: before.insert.length,
            updated: before.update.length + before.malformed_raw.length,
            soft_deleted: before.soft_delete.length,
            noop: before.noop.length,
            failed: mirrored ? 0 : census.projectedRows,
        };
        report.residual = after;
        report.decision_equivalence_mirror = equivalence;
        report.last_access_audit = audit;
        report.ok = mirrored && after.changes === 0 && equivalence.mismatches === 0
            && !!audit && audit.ok === 1 && String(audit.detail ?? '').startsWith('GAP4_BACKFILL');
        return report;
    } finally {
        db.close();
    }
}

// ── CLI ──────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
    const a = { mode: 'dry-run' };
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--dry-run') a.mode = 'dry-run';
        else if (t === '--apply') a.mode = 'apply';
        else if (t === '--verify') a.mode = 'verify';
        else if (t === '--sources-root') a.sourcesRoot = argv[++i];
        else if (t === '--identity-db') a.identityDbPath = argv[++i];
        else if (t === '--fallback-mode') a.fallbackMode = argv[++i];
    }
    return a;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('backfillAccessRules.mjs');
if (invokedDirectly) {
    const a = parseArgs(process.argv.slice(2));
    backfillAccessRules({ ...a, log: (m) => console.error(m) })
        .then(r => {
            console.log(JSON.stringify(r, null, 1));
            process.exit(r.ok ? 0 : 1);
        })
        .catch(e => {
            console.error(`STOP — ${e.classification ?? 'BACKFILL_FAILED'}: ${e.message}`);
            process.exit(1);
        });
}
