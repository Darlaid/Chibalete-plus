/**
 * validateProductionCanaryCorpus.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A, Fase 14.
 *
 * Verifica que el corpus productivo congelado **sigue describiendo lo que hay**,
 * sin ejecutar el benchmark y sin generar carga: una petición por ruta, como
 * mucho, y solo si se pide explícitamente.
 *
 * Es **fail-closed**: cualquier comprobación que no pueda completarse, cualquier
 * excepción inesperada y cualquier campo desconocido producen un veredicto
 * negativo. No hay «no pude comprobarlo, sigo».
 *
 * **Nunca actualiza el corpus.** Ante drift emite las diferencias y se detiene:
 * regenerar el corpus es una unidad nueva, no un efecto secundario de validarlo.
 *
 * Veredictos y códigos de salida:
 *   VALID    0   el corpus describe la producción actual
 *   DRIFTED 10   algo cambió: población, identidades, rutas, contrato
 *   EXPIRED 11   la ventana de datos que el corpus asume ya no existe
 *   UNSAFE  12   no es seguro medir: flags encendidos, secretos, PII, destino
 *
 * Uso:
 *   node validateProductionCanaryCorpus.mjs \
 *     --corpus /root/stats-legacy-perf-corpus-01a/PRODUCTION-CANARY-CORPUS.json \
 *     --data /var/www/chibalete/data --dataCritical /var/www/chibalete/data-critical \
 *     --probe --host 172.21.0.4 --port 3000 \
 *     --secretFile /var/www/chibalete/secrets/admin_secret \
 *     --allowRemote --iUnderstandThisGeneratesLoad
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadInspect, containerSummary } from '../security/safeOperationalEvidence.mjs';
import { isPublishableEnvValue } from '../security/evidenceContract.mjs';
import { REDACTED } from '../security/sensitiveTaxonomy.mjs';
import {
    CORPUS_ID, CORPUS_VERSION, ACCEPTANCE_CONTRACT_VERSION,
    ORG_ALIASES, GROUP_ALIAS, USER_ALIAS,
    PERF_ROUTE_IDS, NEGATIVE_ROUTE_IDS, ROUTE_CONTRACT,
    TECHNICAL_TIMESTAMP_NAMES, DERIVED_VOLATILE_PATHS,
    acceptanceContract, acceptanceContractSha256, sha256Hex, canonicalJson,
    findPii, findSecrets,
} from './productionCanaryCorpus.mjs';
import { assertSafeTarget, UnsafeTargetError } from './target-guard.mjs';

export const VERDICTS = { VALID: 'VALID', DRIFTED: 'DRIFTED', EXPIRED: 'EXPIRED', UNSAFE: 'UNSAFE' };
const EXIT = { VALID: 0, DRIFTED: 10, EXPIRED: 11, UNSAFE: 12 };

/** Claves admitidas en el corpus. Una clave desconocida es drift, no un extra. */
const KNOWN_CORPUS_KEYS = new Set([
    'corpusId', 'corpusVersion', 'generatedAt', 'expiresAt', 'reviewBy', 'production',
    'acceptanceContractVersion', 'acceptanceContractSha256', 'organizations', 'group',
    'user', 'syntheticPrincipals', 'periods', 'routes', 'perfRouteIds', 'negativeRouteIds',
    'normalization', 'sampling', 'gates', 'lifecycle', 'populationHashes', 'driftCriteria',
]);

const REQUIRED_CORPUS_KEYS = [...KNOWN_CORPUS_KEYS];

/**
 * Campos del corpus root-only que legítimamente contienen identificadores
 * exactos. Cualquier PII **fuera** de ellos es una fuga.
 */
const CORPUS_ID_BEARING_KEYS = new Set(['id', 'path', 'idSha256', 'userId', 'schoolSlug', 'slug']);

// ─────────────────────────────────────────────────────────────────────────────

export class Report {
    constructor() { this.checks = []; }
    add(name, ok, verdictIfFailed, detail) {
        this.checks.push({ name, ok: Boolean(ok), verdictIfFailed, detail: detail ?? null });
        return ok;
    }
    get failures() { return this.checks.filter((c) => !c.ok); }
    /** El peor veredicto gana. Sin fallos, VALID. */
    verdict() {
        const order = [VERDICTS.VALID, VERDICTS.DRIFTED, VERDICTS.EXPIRED, VERDICTS.UNSAFE];
        return this.failures.reduce((worst, f) =>
            (order.indexOf(f.verdictIfFailed) > order.indexOf(worst) ? f.verdictIfFailed : worst),
        VERDICTS.VALID);
    }
}

/** Recorre el corpus buscando PII fuera de los campos que la llevan por diseño. */
export function scanCorpusForLeaks(corpus) {
    const leaks = [];
    const walk = (value, keyPath, key) => {
        if (typeof value === 'string') {
            if (!CORPUS_ID_BEARING_KEYS.has(key)) {
                for (const kind of findPii(value)) leaks.push({ kind, at: keyPath });
            }
            for (const kind of findSecrets(value, { allowSha256: true })) leaks.push({ kind, at: keyPath });
        } else if (Array.isArray(value)) {
            value.forEach((v, i) => walk(v, `${keyPath}[${i}]`, key));
        } else if (value && typeof value === 'object') {
            for (const k of Object.keys(value)) walk(value[k], keyPath ? `${keyPath}.${k}` : k, k);
        }
    };
    walk(corpus, '', '');
    return leaks;
}

/** El descriptor versionado no puede llevar ni un identificador exacto. */
export function scanSanitizedForLeaks(text) {
    return [...findPii(text).map((k) => ({ kind: k, at: 'sanitized' })),
        ...findSecrets(text, { allowSha256: true }).map((k) => ({ kind: k, at: 'sanitized' }))];
}

export function validateStructure(corpus, report) {
    const keys = Object.keys(corpus || {});
    report.add('corpus.keys.known', keys.every((k) => KNOWN_CORPUS_KEYS.has(k)),
        VERDICTS.DRIFTED, keys.filter((k) => !KNOWN_CORPUS_KEYS.has(k)));
    report.add('corpus.keys.complete', REQUIRED_CORPUS_KEYS.every((k) => k in (corpus || {})),
        VERDICTS.DRIFTED, REQUIRED_CORPUS_KEYS.filter((k) => !(k in (corpus || {}))));
    report.add('corpus.id', corpus?.corpusId === CORPUS_ID, VERDICTS.DRIFTED, corpus?.corpusId);
    report.add('corpus.version', corpus?.corpusVersion === CORPUS_VERSION, VERDICTS.DRIFTED, corpus?.corpusVersion);
    report.add('contract.version', corpus?.acceptanceContractVersion === ACCEPTANCE_CONTRACT_VERSION,
        VERDICTS.DRIFTED, corpus?.acceptanceContractVersion);
    report.add('contract.sha256', corpus?.acceptanceContractSha256 === acceptanceContractSha256(),
        VERDICTS.DRIFTED, { corpus: corpus?.acceptanceContractSha256, computed: acceptanceContractSha256() });

    /**
     * El hash almacenado no basta: es un campo del propio corpus, y quien
     * relajara un gate podría dejarlo intacto. Se compara el contrato
     * **incrustado** contra el contrato del código, subárbol a subárbol.
     * `path` se excluye de las rutas porque solo existe en el artefacto
     * root-only —lleva los identificadores resueltos— y no forma parte del
     * contrato.
     */
    const code = acceptanceContract();
    const stripPath = (routes) => (routes || []).map(({ path: _p, ...rest }) => rest);
    const embedded = {
        routes: stripPath(corpus?.routes),
        normalization: corpus?.normalization,
        sampling: corpus?.sampling,
        gates: corpus?.gates,
        lifecycle: corpus?.lifecycle,
        periods: corpus?.periods,
    };
    for (const key of Object.keys(embedded)) {
        report.add(`contract.embedded.${key}`,
            canonicalJson(embedded[key]) === canonicalJson(key === 'routes' ? stripPath(code.routes) : code[key]),
            VERDICTS.DRIFTED, key);
    }

    const routeIds = (corpus?.routes || []).map((r) => r.id);
    report.add('routes.complete',
        PERF_ROUTE_IDS.every((id) => routeIds.includes(id)) &&
        NEGATIVE_ROUTE_IDS.every((id) => routeIds.includes(id)),
        VERDICTS.DRIFTED, routeIds);
    report.add('routes.count', routeIds.length === ROUTE_CONTRACT.length, VERDICTS.DRIFTED, routeIds.length);
    report.add('routes.resolved', (corpus?.routes || []).every((r) => typeof r.path === 'string' && !r.path.includes('{{')),
        VERDICTS.DRIFTED, (corpus?.routes || []).filter((r) => String(r.path).includes('{{')).map((r) => r.id));

    report.add('normalization.names',
        canonicalJson(corpus?.normalization?.technicalTimestampNames) === canonicalJson(TECHNICAL_TIMESTAMP_NAMES),
        VERDICTS.DRIFTED, corpus?.normalization?.technicalTimestampNames);
    report.add('normalization.derivedPaths',
        canonicalJson(corpus?.normalization?.derivedVolatilePaths) === canonicalJson(DERIVED_VOLATILE_PATHS),
        VERDICTS.DRIFTED, corpus?.normalization?.derivedVolatilePaths);

    report.add('periods.absolute',
        corpus?.periods?.routesAcceptQueryParameters === false &&
        typeof corpus?.periods?.dataCoverage?.eventsTo === 'string' &&
        !/now|rolling|ultimos/i.test(String(corpus?.periods?.dataCoverage?.eventsTo)),
        VERDICTS.DRIFTED, corpus?.periods?.dataCoverage);

    report.add('sampling.frozen',
        corpus?.sampling?.level2?.totalObservationsPerArmAndRoute === 64 &&
        corpus?.sampling?.level2?.blocksPerArm === 4 &&
        corpus?.sampling?.level2?.concurrency === 1,
        VERDICTS.DRIFTED, corpus?.sampling?.level2);

    report.add('aliases', ORG_ALIASES.every((a) => (corpus?.organizations || []).some((o) => o.alias === a)) &&
        corpus?.group?.alias === GROUP_ALIAS && corpus?.user?.alias === USER_ALIAS,
        VERDICTS.DRIFTED, (corpus?.organizations || []).map((o) => o.alias));
    return report;
}

export function validateExpiry(corpus, report, now = new Date()) {
    const exp = Date.parse(corpus?.expiresAt ?? '');
    report.add('expiry.parseable', Number.isFinite(exp), VERDICTS.UNSAFE, corpus?.expiresAt);
    if (Number.isFinite(exp)) {
        report.add('expiry.notPassed', now.getTime() < exp, VERDICTS.EXPIRED,
            { now: now.toISOString(), expiresAt: corpus.expiresAt });
    }
    const rev = Date.parse(corpus?.reviewBy ?? '');
    if (Number.isFinite(rev) && now.getTime() >= rev) {
        report.add('expiry.reviewDue', false, VERDICTS.DRIFTED,
            { now: now.toISOString(), reviewBy: corpus.reviewBy });
    }
    return report;
}

/** Existencia e integridad de la población, contra los ficheros reales. */
export function validatePopulation(corpus, { data, dataCritical }, report) {
    const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
    const schools = read(path.join(data, 'schools_db.json'));
    const groups = read(path.join(data, 'groups_db.json'));
    const oro = read(path.join(dataCritical, 'usuarios_colegios_oro.json'));

    const fileSha = (p) => sha256Hex(fs.readFileSync(p));
    report.add('population.oroSha', fileSha(path.join(dataCritical, 'usuarios_colegios_oro.json')) === corpus.populationHashes.oroSha256, VERDICTS.DRIFTED);
    report.add('population.groupsSha', fileSha(path.join(data, 'groups_db.json')) === corpus.populationHashes.groupsSha256, VERDICTS.DRIFTED);
    report.add('population.schoolsSha', fileSha(path.join(data, 'schools_db.json')) === corpus.populationHashes.schoolsSha256, VERDICTS.DRIFTED);

    const schoolIds = new Set(schools.map((s) => s.id));
    for (const o of corpus.organizations) {
        report.add(`organization.${o.alias}.exists`, schoolIds.has(o.id), VERDICTS.DRIFTED, o.alias);
        const gs = groups.filter((g) => g.school === o.name);
        report.add(`organization.${o.alias}.addressable`, (gs.length > 0) === o.addressable, VERDICTS.DRIFTED,
            { alias: o.alias, groupsNow: gs.length, expected: o.addressable });
    }

    const g7 = groups.find((g) => g.id === corpus.group.id);
    report.add(`${GROUP_ALIAS}.exists`, Boolean(g7), VERDICTS.DRIFTED);
    if (g7) {
        const mem = [...new Set([...(g7.studentIds || []), ...(g7.memberIds || [])])];
        report.add(`${GROUP_ALIAS}.membershipHash`,
            sha256Hex(canonicalJson(mem.slice().sort())) === corpus.populationHashes.groupR7MembersSha256,
            VERDICTS.DRIFTED, { countNow: mem.length, countAtFreeze: corpus.populationHashes.groupR7MemberCount });
        report.add(`${USER_ALIAS}.memberOfGroup`, mem.includes(corpus.user.id), VERDICTS.DRIFTED);
    }

    const oroIds = new Set(oro.filter((u) => u.id).map((u) => String(u.id)));
    report.add(`${USER_ALIAS}.exists`, oroIds.has(String(corpus.user.id)), VERDICTS.DRIFTED);
    report.add('population.oroCount', oro.length === corpus.populationHashes.oroUserCount, VERDICTS.DRIFTED,
        { now: oro.length, atFreeze: corpus.populationHashes.oroUserCount });
    report.add('syntheticPrincipal.doesNotCollide',
        !oroIds.has(String(corpus.syntheticPrincipals.userId)), VERDICTS.UNSAFE);
    report.add('syntheticSchool.doesNotCollide',
        !schools.some((s) => s.name === corpus.syntheticPrincipals.schoolSlug), VERDICTS.UNSAFE);
    return report;
}

export const RUNTIME_CONTAINERS = Object.freeze(['chibalete_api_1', 'chibalete_api_2']);

/** Banderas cuyo valor el validador NECESITA leer. Las tres están en la allowlist. */
const REQUIRED_FLAGS = Object.freeze({
    LEGACY_METRICS_REQUEST_CONTEXT: 'off',
    METRICS_ENGINE: 'legacy',
});

/**
 * El commit se toma de la etiqueta OCI `image.revision`, no de `GIT_SHA`.
 *
 * `GIT_SHA` es una variable de entorno y **no** está en `ENV_VALUE_ALLOWLIST`,
 * así que la evidencia segura la devuelve `[REDACTED]` — correctamente: leer
 * variables no publicables es exactamente lo que el contrato prohíbe. La
 * etiqueta es además mejor prueba: la estampa el build de la imagen, no el
 * entorno de ejecución, así que no puede divergir de lo que se construyó.
 */
const COMMIT_LABEL = 'org.opencontainers.image.revision';

/**
 * Flags, imagen y salud de las API productivas.
 *
 * **Evidencia operativa segura, por proyección.** No se lee `.Config.Env` ni se
 * ejecuta `docker inspect` en crudo desde aquí: se reutiliza el helper sancionado
 * `scripts/security/safeOperationalEvidence.mjs`, que proyecta el objeto por
 * allowlist y devuelve `[REDACTED]` para todo valor no publicable —incluidas
 * `OPENAI_API_KEY` y `GEMINI_API_KEY`—. No se crea un segundo mecanismo de
 * redacción: si hiciera falta publicar una bandera nueva, se añade a
 * `ENV_VALUE_ALLOWLIST` con su justificación.
 *
 * Es **fail-closed**: una bandera ausente, un valor redactado donde se esperaba
 * uno publicable, o una variable sensible que llegara con valor, son fallos con
 * veredicto `UNSAFE` — nunca un «no pude comprobarlo, sigo».
 *
 * @param {object} opts.inspected  objetos de inspect ya cargados (fixture de
 *   prueba). Se proyectan por la MISMA allowlist: una fixture no es una vía
 *   privilegiada, solo evita depender de Docker en CI.
 */
export function validateRuntime(corpus, report, { docker = true, inspected = null } = {}) {
    if (!docker && !inspected) return report;

    let summary;
    try {
        summary = containerSummary(inspected ?? loadInspect([...RUNTIME_CONTAINERS], null));
    } catch (e) {
        report.add('runtime.evidence', false, VERDICTS.UNSAFE, e.message);
        return report;
    }

    const seen = new Set();
    for (const c of summary.containers) {
        const name = c.name ?? '(sin nombre)';
        seen.add(name);
        const env = new Map((c.environment ?? []).map((e) => [e.name, e.value]));

        for (const [flag, expected] of Object.entries(REQUIRED_FLAGS)) {
            const value = env.get(flag);
            if (value === undefined) {
                report.add(`${name}.${flag}`, false, VERDICTS.UNSAFE, 'bandera ausente');
            } else if (value === REDACTED) {
                // La bandera está en la allowlist, así que un [REDACTED] aquí
                // significa que el contrato de evidencia cambió bajo nuestros pies.
                report.add(`${name}.${flag}`, false, VERDICTS.UNSAFE,
                    'redactada pese a estar en ENV_VALUE_ALLOWLIST');
            } else {
                report.add(`${name}.${flag}`, value === expected, VERDICTS.UNSAFE,
                    { expected, got: value });
            }
        }

        /**
         * Defensa en profundidad: si el helper devolviera con valor una variable
         * que no es publicable, la evidencia estaría filtrando y hay que
         * detenerse, no continuar con un aviso.
         */
        const leaked = (c.environment ?? [])
            .filter((e) => e.value !== REDACTED && e.value !== null && !isPublishableEnvValue(e.name))
            .map((e) => e.name);
        report.add(`${name}.noSensitiveValues`, leaked.length === 0, VERDICTS.UNSAFE, leaked);

        report.add(`${name}.imageId`, c.imageId === corpus.production.imageId, VERDICTS.DRIFTED);
        report.add(`${name}.healthy`, c.health === 'healthy', VERDICTS.UNSAFE, c.health);
        report.add(`${name}.noRestarts`, c.restartCount === 0, VERDICTS.UNSAFE, c.restartCount);

        const revision = c.labels?.allowed?.[COMMIT_LABEL];
        report.add(`${name}.commit`, revision === corpus.production.commit, VERDICTS.DRIFTED,
            revision === undefined ? `etiqueta ${COMMIT_LABEL} ausente` : { expected: corpus.production.commit, got: revision });
    }

    // Fail-closed también ante ausencias: un contenedor que no responde no puede
    // leerse como «sin hallazgos».
    for (const expectedName of RUNTIME_CONTAINERS) {
        report.add(`${expectedName}.present`, seen.has(expectedName), VERDICTS.UNSAFE);
    }
    return report;
}

/** Una petición por ruta, sin repetición y sin concurrencia. Nunca es carga. */
export async function probeRoutes(corpus, { host, port, secret }, report) {
    const base = `http://${host}:${port}`;
    for (const r of corpus.routes) {
        const headers = { accept: 'application/json' };
        if (r.auth === 'ADMIN_SECRET') headers['x-admin-secret'] = secret;
        if (r.auth === 'SYNTHETIC_USER_HEADER') headers['x-user-id'] = corpus.syntheticPrincipals.userId;
        let status = null; let ct = null; let top = null;
        try {
            const res = await fetch(base + r.path, { headers, redirect: 'manual' });
            status = res.status;
            ct = res.headers.get('content-type');
            const body = await res.json().catch(() => null);
            top = body && !Array.isArray(body) && typeof body === 'object' ? Object.keys(body).sort() : null;
        } catch (e) {
            report.add(`probe.${r.id}.reachable`, false, VERDICTS.UNSAFE, e.message);
            continue;
        }
        report.add(`probe.${r.id}.status`, status === r.expectedStatus, VERDICTS.DRIFTED,
            { expected: r.expectedStatus, got: status });
        report.add(`probe.${r.id}.contentType`, ct === r.expectedContentType, VERDICTS.DRIFTED,
            { expected: r.expectedContentType, got: ct });
        report.add(`probe.${r.id}.schema`,
            canonicalJson(top) === canonicalJson([...r.topLevelKeys].sort()), VERDICTS.DRIFTED,
            { expected: [...r.topLevelKeys].sort(), got: top });
    }
    return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2), v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv);
    const report = new Report();
    const corpusPath = String(args.corpus || '');
    let corpus;
    try {
        corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
        report.add('corpus.parseable', true, VERDICTS.UNSAFE);
    } catch (e) {
        report.add('corpus.parseable', false, VERDICTS.UNSAFE, e.message);
        return finish(report, args);
    }

    // El corpus root-only debe estar cerrado a root.
    try {
        const mode = fs.statSync(corpusPath).mode & 0o777;
        report.add('corpus.mode0600', mode === 0o600, VERDICTS.UNSAFE, mode.toString(8));
    } catch (e) { report.add('corpus.mode0600', false, VERDICTS.UNSAFE, e.message); }

    validateStructure(corpus, report);
    validateExpiry(corpus, report);

    const leaks = scanCorpusForLeaks(corpus);
    report.add('corpus.noLeaks', leaks.length === 0, VERDICTS.UNSAFE, leaks);

    if (args.sanitized) {
        const text = fs.readFileSync(String(args.sanitized), 'utf8');
        const sl = scanSanitizedForLeaks(text);
        report.add('sanitized.noPii', sl.length === 0, VERDICTS.UNSAFE, sl);
    }

    if (args.data && args.dataCritical) {
        // `insights.db` no se abre en ningún momento: solo se comprueba que su
        // inodo no cambió, lo que demuestra que esta validación no lo consultó.
        const insights = path.join(String(args.dataCritical), 'insights.db');
        const before = fs.existsSync(insights) ? fs.statSync(insights).mtimeMs : null;
        validatePopulation(corpus, { data: String(args.data), dataCritical: String(args.dataCritical) }, report);
        const after = fs.existsSync(insights) ? fs.statSync(insights).mtimeMs : null;
        report.add('insights.untouched', before === after, VERDICTS.UNSAFE);
    }

    if (args.inspectFrom) {
        // Fixture sintética por la MISMA vía que el helper sancionado
        // (`--from-file`): la proyección por allowlist se aplica igual, así que
        // no es un camino privilegiado, solo uno que no depende de Docker.
        validateRuntime(corpus, report, { inspected: loadInspect([], String(args.inspectFrom)) });
    } else if (!args.noDocker) {
        validateRuntime(corpus, report);
    }

    if (args.probe) {
        try {
            assertSafeTarget(String(args.host || '127.0.0.1'), {
                allowRemote: Boolean(args.allowRemote),
                acknowledged: Boolean(args.iUnderstandThisGeneratesLoad),
            });
        } catch (e) {
            if (e instanceof UnsafeTargetError) {
                report.add('probe.target', false, VERDICTS.UNSAFE, e.message);
                return finish(report, args);
            }
            throw e;
        }
        const secret = fs.readFileSync(String(args.secretFile), 'utf8').trim();
        await probeRoutes(corpus, { host: String(args.host), port: Number(args.port || 3000), secret }, report);
    }

    return finish(report, args);
}

function finish(report, args) {
    const verdict = report.verdict();
    for (const c of report.checks) {
        if (!c.ok) console.error(`  FAIL  ${c.name}  → ${c.verdictIfFailed}` +
            (c.detail == null ? '' : `  ${JSON.stringify(c.detail)}`));
    }
    console.log(`\n${report.checks.length - report.failures.length}/${report.checks.length} comprobaciones OK`);
    console.log(`VEREDICTO: ${verdict}`);
    if (verdict !== VERDICTS.VALID) {
        console.error('\nEl corpus NO se actualiza automáticamente. Regenerarlo es una unidad nueva.');
    }
    if (args.json) fs.writeFileSync(String(args.json), JSON.stringify({ verdict, checks: report.checks }, null, 1), { mode: 0o600 });
    process.exitCode = EXIT[verdict];
    return verdict;
}

const invokedDirectly = process.argv[1] &&
    import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (invokedDirectly) {
    main().catch((e) => {
        // Fail-closed: una excepción no prevista nunca puede leerse como VALID.
        console.error(`UNSAFE — excepción no controlada: ${e.stack || e.message}`);
        console.log('VEREDICTO: UNSAFE');
        process.exitCode = EXIT.UNSAFE;
    });
}
