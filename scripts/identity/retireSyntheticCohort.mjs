#!/usr/bin/env node
/**
 * retireSyntheticCohort.mjs — CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-01.
 *
 * RETIRO FUNCIONAL REVERSIBLE de la cohorte sintética atestada (400 usuarios
 * del Test 2.0). NO es una purga: no borra usuarios, ni progreso, ni grupo,
 * ni la regla (queda presente como evidencia, expirada).
 *
 *   SYNTHETIC_RETIRED :=
 *     AUTHENTICATION_DISABLED  (accountStatus='disabled'; isUserActive ya
 *                               bloquea login Y toda sesión x-user-id, que es
 *                               stateless y revalida status en CADA request)
 *     ∧ ACCESS_RULE_INACTIVE   (lt-access-v2 con expiresAt en el pasado; el
 *                               engine salta reglas expiradas en lectura)
 *     ∧ USER_RECORDS_PRESERVED ∧ PROGRESS_PRESERVED ∧ GROUP_PRESERVED
 *
 * SELECCIÓN DE COHORTE — doble atestación OBLIGATORIA y concordante:
 *   (a) marcador `_loadtest_marker` en el registro del padrón, Y
 *   (b) hash h16(id) presente en identity.db
 *       migration_exclusions(entity='user', SYNTHETIC_LOADTEST_QUARANTINED).
 * Cualquier discrepancia (marcado sin exclusión, excluido sin marcar) ⇒
 * STOP COHORT SELECTION AMBIGUOUS. Un usuario sin marcador JAMÁS se
 * selecciona (STOP REAL USER SELECTED es estructuralmente imposible: la
 * selección exige (a)∧(b)).
 *
 * WRITERS: exclusivamente las superficies canónicas — PUT /api/users/:id por
 * usuario (JSON físico authority, lock, mirror hook, atribución
 * server.writeJSON) y POST /api/access (upsert, mirrorAccess). El transporte
 * es inyectable para tests; el default es HTTP real.
 *
 * ORDEN (F5): 1º expirar la regla (cerrar la concesión), 2º deshabilitar
 * cuentas. En ningún estado intermedio hay cuentas habilitadas con MÁS acceso
 * que antes: la concesión solo decrece.
 *
 * Idempotente y reanudable: cada re-ejecución recalcula el delta pendiente y
 * solo toca lo que falta. Rollback lógico desde snapshot (estados previos +
 * expiración previa de la regla; SIN credenciales) con reconocimiento
 * explícito del riesgo (--acknowledge-security-risk): reactivar la cohorte
 * reintroduce una credencial compartida conocida.
 *
 * Modos:
 *   --dry-run  (default) lee stores en disco, 0 mutaciones, agregados solo.
 *   --apply    exige --base y auth (--admin-secret-file o --admin-user-id).
 *   --rollback exige snapshot previo + --acknowledge-security-risk.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DISABLED_STATUS = 'disabled';
export const RETIRED_EXPIRES_AT = 1;   // epoch-ms pasado: semántica probada del engine
export const EXCLUSION_DISPOSITION = 'SYNTHETIC_LOADTEST_QUARANTINED';

const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

export class RetireError extends Error {
    constructor(stop, message) { super(message); this.stop = stop; }
}

/** Hashes de exclusión atestados (identity.db, RO). */
export function attestedUserExclusionHashes(db) {
    return new Set(db.prepare(
        `SELECT reference_hash FROM migration_exclusions
         WHERE entity='user' AND disposition=?`).all(EXCLUSION_DISPOSITION)
        .map(r => r.reference_hash));
}

/**
 * Selección de cohorte con doble atestación estricta. Devuelve la lista de
 * ids sintéticos. Lanza ante CUALQUIER discrepancia.
 */
export function selectCohort(users, exclusionHashes) {
    const cohort = [];
    const markedNotExcluded = [];
    const matchedHashes = new Set();
    for (const u of users) {
        const id = String(u?.id ?? '');
        const marked = Boolean(u?._loadtest_marker);
        const excluded = exclusionHashes.has(h16(id));
        if (marked && excluded) { cohort.push(id); matchedHashes.add(h16(id)); continue; }
        if (marked && !excluded) markedNotExcluded.push(h16(id));
        if (!marked && excluded) {
            throw new RetireError('COHORT SELECTION AMBIGUOUS',
                `usuario excluido en identity.db pero SIN marcador en el padrón (${h16(id)})`);
        }
    }
    if (markedNotExcluded.length) {
        throw new RetireError('COHORT SELECTION AMBIGUOUS',
            `${markedNotExcluded.length} usuario(s) marcados sin exclusión atestada`);
    }
    const unmatched = [...exclusionHashes].filter(h => !matchedHashes.has(h));
    if (unmatched.length) {
        throw new RetireError('COHORT SELECTION AMBIGUOUS',
            `${unmatched.length} exclusión(es) atestada(s) sin registro presente en el padrón`);
    }
    return cohort;
}

/** Localiza la regla objetivo y valida que apunte al grupo sintético atestado. */
export function selectRule(rules, groupsExclusionCheck, ruleId) {
    const rule = rules.find(r => String(r?.id) === ruleId);
    if (!rule) return null;                     // ausente: retiro de regla = noop
    if (rule.scope !== 'group' || !groupsExclusionCheck(String(rule.scopeId))) {
        throw new RetireError('ACCESS RULE RETIREMENT UNKNOWN',
            `la regla ${ruleId} no apunta a un grupo sintético atestado`);
    }
    return rule;
}

export function ruleIsRetired(rule, now = Date.now()) {
    return typeof rule?.expiresAt === 'number' && Number.isFinite(rule.expiresAt)
        && now > rule.expiresAt;
}

/** Payload de expiración: la regla ÍNTEGRA (evidencia) con expiresAt pasado. */
export function buildRetirementRulePayload(rule) {
    return { ...rule, expiresAt: RETIRED_EXPIRES_AT };
}

/** Plan/dry-run: agregados exclusivamente. Nunca PII, nunca credenciales. */
export function planRetirement({ users, rules, exclusionHashes, isSyntheticGroup,
    ruleId = 'lt-access-v2', progressRows = null }) {
    const cohort = selectCohort(users, exclusionHashes);
    const byId = new Map(users.map(u => [String(u.id), u]));
    const active = cohort.filter(id => {
        const s = byId.get(id)?.accountStatus;
        return !s || s === 'active';
    });
    const disabled = cohort.filter(id => byId.get(id)?.accountStatus === DISABLED_STATUS);
    const rule = selectRule(rules, isSyntheticGroup, ruleId);
    const ruleActive = rule ? !ruleIsRetired(rule) : false;
    return {
        SYNTHETIC_TOTAL: cohort.length,
        SYNTHETIC_ACTIVE: active.length,
        SYNTHETIC_DISABLED: disabled.length,
        RULE_PRESENT: Boolean(rule),
        RULE_ACTIVE: ruleActive,
        RULE_EXPIRATION: rule?.expiresAt ?? null,
        CANONICAL_USERS: users.length - cohort.length,
        REAL_USERS_SELECTED: 0,          // estructural: la selección exige doble atestación
        PROGRESS_ROWS: progressRows,
        EXPECTED_USER_UPDATES: active.length,
        EXPECTED_RULE_UPDATES: ruleActive ? 1 : 0,
        cohortIds: cohort,               // ids internos para apply; NO imprimir
        rule,
    };
}

/** Snapshot de rollback: estados previos + expiración previa. Sin credenciales. */
export function buildSnapshot(plan, users) {
    const byId = new Map(users.map(u => [String(u.id), u]));
    return {
        unit: 'CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-01',
        takenAt: new Date().toISOString(),
        ROLLBACK_REINTRODUCES_SECURITY_RISK: true,
        statuses: Object.fromEntries(plan.cohortIds.map(id =>
            [id, byId.get(id)?.accountStatus ?? null])),
        rule: plan.rule
            ? { id: String(plan.rule.id), previousExpiresAt: plan.rule.expiresAt ?? null }
            : null,
    };
}

export function writeSnapshot(snapshotPath, snapshot) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 1) + '\n', { mode: 0o600 });
    return snapshotPath;
}

/**
 * Transporte HTTP real (default de producción/canary). `auth` aporta
 * x-admin-secret (leído de archivo, jamás de argv) o x-user-id admin.
 */
export function makeHttpTransport({ base, adminSecret = null, adminUserId = null }) {
    const headers = { 'content-type': 'application/json' };
    if (adminSecret) headers['x-admin-secret'] = adminSecret;
    else if (adminUserId) headers['x-user-id'] = adminUserId;
    else throw new RetireError('CONFIG', 'apply exige --admin-secret-file o --admin-user-id');
    return {
        async updateUserStatus(id, status) {
            const r = await fetch(`${base}/api/users/${encodeURIComponent(id)}`, {
                method: 'PUT', headers, body: JSON.stringify({ accountStatus: status }) });
            return { ok: r.ok, status: r.status };
        },
        async upsertAccessRule(payload) {
            const r = await fetch(`${base}/api/access`, {
                method: 'POST', headers, body: JSON.stringify(payload) });
            return { ok: r.ok, status: r.status };
        },
    };
}

/**
 * APPLY — orden: (1) expirar regla, (2) deshabilitar cuentas pendientes.
 * Idempotente y reanudable: opera solo sobre el delta. `maxUserOps` existe
 * para el test de interrupción/resume; producción no lo pasa.
 */
export async function applyRetirement({ plan, transport, log = () => {},
    targetStatus = DISABLED_STATUS, maxUserOps = Infinity }) {
    const result = { rule_updates: 0, rule_noop: 0, user_updates: 0,
        user_noop: plan.SYNTHETIC_DISABLED, user_failed: 0, interrupted: false };

    if (plan.RULE_ACTIVE) {
        const res = await transport.upsertAccessRule(buildRetirementRulePayload(plan.rule));
        if (!res.ok) {
            throw new RetireError('ACCESS RULE RETIREMENT UNKNOWN',
                `upsert de expiración devolvió ${res.status}`);
        }
        result.rule_updates = 1;
        log('rule_retired');
    } else {
        result.rule_noop = 1;
    }

    let ops = 0;
    for (const id of plan.cohortIds) {
        // Solo los pendientes (idempotencia/resume): el plan trae el censo.
        if (!planIsPending(plan, id)) continue;
        if (ops >= maxUserOps) { result.interrupted = true; break; }
        const res = await transport.updateUserStatus(id, targetStatus);
        if (res.ok) { result.user_updates++; ops++; }
        else if (res.status === 404) {
            throw new RetireError('COHORT SELECTION AMBIGUOUS',
                `usuario de cohorte inexistente en el writer (${h16(id)})`);
        } else { result.user_failed++; }
    }
    if (result.user_failed) {
        throw new RetireError('APPLY FAILED',
            `${result.user_failed} actualización(es) de estado fallida(s); re-ejecutar para reanudar`);
    }
    return result;
}

const _pending = new WeakMap();
function planIsPending(plan, id) {
    let set = _pending.get(plan);
    if (!set) {
        set = new Set(plan.cohortIds.filter(cid => {
            // pendiente = no está ya disabled según el censo del plan
            return !plan._disabledSet?.has(cid);
        }));
        _pending.set(plan, set);
    }
    return set.has(id);
}

/** Enriquecer el plan con el set disabled (para idempotencia/resume). */
export function withDisabledSet(plan, users) {
    const byId = new Map(users.map(u => [String(u.id), u]));
    plan._disabledSet = new Set(plan.cohortIds.filter(id =>
        byId.get(id)?.accountStatus === DISABLED_STATUS));
    return plan;
}

// ── CLI ──────────────────────────────────────────────────────────────────
// dry-run: lee stores en disco + identity.db RO. apply/rollback: HTTP real.
export function parseArgs(argv) {
    const a = { mode: 'dry-run', ruleId: 'lt-access-v2' };
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--dry-run') a.mode = 'dry-run';
        else if (t === '--apply') a.mode = 'apply';
        else if (t === '--rollback') a.mode = 'rollback';
        else if (t === '--users-db') a.usersDb = argv[++i];
        else if (t === '--groups-db') a.groupsDb = argv[++i];
        else if (t === '--access-db') a.accessDb = argv[++i];
        else if (t === '--identity-db') a.identityDb = argv[++i];
        else if (t === '--base') a.base = argv[++i];
        else if (t === '--admin-secret-file') a.adminSecretFile = argv[++i];
        else if (t === '--admin-user-id') a.adminUserId = argv[++i];
        else if (t === '--snapshot-path') a.snapshotPath = argv[++i];
        else if (t === '--rule-id') a.ruleId = argv[++i];
        else if (t === '--acknowledge-security-risk') a.ackRisk = true;
        else if (t === '--max-user-ops') a.maxUserOps = Number(argv[++i]);
    }
    return a;
}

export async function loadPlanFromStores(a) {
    const Database = (await import('better-sqlite3')).default;
    const users = JSON.parse(fs.readFileSync(a.usersDb, 'utf8'));
    const rules = JSON.parse(fs.readFileSync(a.accessDb, 'utf8'));
    const db = new Database(a.identityDb, { readonly: true });
    try {
        const excl = attestedUserExclusionHashes(db);
        const groupExcl = new Set(db.prepare(
            `SELECT reference_hash FROM migration_exclusions
             WHERE entity='group' AND disposition='SYNTHETIC_LOADTEST_EXCLUDED'`)
            .all().map(r => r.reference_hash));
        const plan = planRetirement({
            users, rules, exclusionHashes: excl,
            isSyntheticGroup: (gid) => groupExcl.has(h16(gid)),
            ruleId: a.ruleId,
        });
        return withDisabledSet(plan, users);
    } finally { db.close(); }
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('retireSyntheticCohort.mjs');
if (invokedDirectly) {
    (async () => {
        const a = parseArgs(process.argv.slice(2));
        const plan = await loadPlanFromStores(a);
        const aggregates = { ...plan };
        delete aggregates.cohortIds; delete aggregates.rule; delete aggregates._disabledSet;
        if (a.mode === 'dry-run') {
            console.log(JSON.stringify({ mode: 'dry-run', ...aggregates }, null, 1));
            return;
        }
        const adminSecret = a.adminSecretFile
            ? fs.readFileSync(a.adminSecretFile, 'utf8').trim() : null;
        const transport = makeHttpTransport({ base: a.base,
            adminSecret, adminUserId: a.adminUserId ?? null });
        if (a.mode === 'apply') {
            if (a.snapshotPath) {
                const users = JSON.parse(fs.readFileSync(a.usersDb, 'utf8'));
                writeSnapshot(a.snapshotPath, buildSnapshot(plan, users));
            }
            const res = await applyRetirement({ plan, transport,
                maxUserOps: Number.isFinite(a.maxUserOps) ? a.maxUserOps : Infinity,
                log: (m) => console.error(m) });
            console.log(JSON.stringify({ mode: 'apply', ...aggregates, result: res }, null, 1));
            return;
        }
        const snapshot = JSON.parse(fs.readFileSync(a.snapshotPath, 'utf8'));
        const res = await rollbackRetirement({ snapshot, currentRule: plan.rule,
            transport, acknowledgeSecurityRisk: Boolean(a.ackRisk),
            log: (m) => console.error(m) });
        console.log(JSON.stringify({ mode: 'rollback', result: res }, null, 1));
    })().catch((e) => {
        console.error(`STOP — CHP-IDDB-GAP1-01 ${e.stop ?? 'FAILED'}: ${e.message}`);
        process.exit(1);
    });
}

/** ROLLBACK lógico desde snapshot. Restaura estados y expiración previa. */
export async function rollbackRetirement({ snapshot, currentRule, transport,
    acknowledgeSecurityRisk = false, log = () => {} }) {
    if (!acknowledgeSecurityRisk) {
        throw new RetireError('ROLLBACK NOT ACKNOWLEDGED',
            'ROLLBACK_REINTRODUCES_SECURITY_RISK=true: exige --acknowledge-security-risk '
            + '(y en producción, mitigación de credencial ANTES de reactivar salvo emergencia)');
    }
    const out = { user_restores: 0, rule_restores: 0 };
    for (const [id, prev] of Object.entries(snapshot.statuses)) {
        const res = await transport.updateUserStatus(id, prev ?? 'active');
        if (!res.ok) throw new RetireError('ROLLBACK FAILED', `restore ${h16(id)} → ${res.status}`);
        out.user_restores++;
    }
    if (snapshot.rule && currentRule) {
        const res = await transport.upsertAccessRule(
            { ...currentRule, expiresAt: snapshot.rule.previousExpiresAt });
        if (!res.ok) throw new RetireError('ROLLBACK FAILED', `rule restore → ${res.status}`);
        out.rule_restores = 1;
    }
    log('rollback_complete');
    return out;
}
