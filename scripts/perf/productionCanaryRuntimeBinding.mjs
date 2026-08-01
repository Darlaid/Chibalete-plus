/**
 * productionCanaryRuntimeBinding.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A-R2.
 *
 * **El corpus y el runtime son dos artefactos distintos, y esa es la idea.**
 *
 * `PRODUCTION-CANARY-CORPUS.json` congela el contrato estadístico: población,
 * alias, R1–R7, parámetros, periodos, normalización, muestra y gates. Es
 * inmutable: si cambia, el canary ya no mide lo que se acordó medir.
 *
 * Pero el contrato tiene que poder ejecutarse sobre una imagen **nueva** —la de
 * observabilidad—, cuyo commit e `ImageID` son necesariamente distintos de los
 * de la producción actual. Meter esa identidad dentro del corpus obligaría a
 * regenerarlo en cada despliegue, y un corpus que se regenera no está
 * congelado: es un formulario.
 *
 * De ahí la separación. El **runtime binding** es un atestado root-only, ajeno
 * al `acceptanceContract`, que responde a una sola pregunta:
 *
 *   ¿esta imagen concreta está autorizada a ejecutar este contrato concreto?
 *
 * Y la responde exigiendo pruebas, no confianza: descendencia del baseline
 * productivo, diff estrictamente dentro de una allowlist, dependencias
 * intactas, `ImageID` completo, etiqueta OCI idéntica al commit y caducidad no
 * posterior a la del corpus.
 *
 * Ser descendiente NO basta. Un descendiente puede traer cualquier cosa; lo que
 * autoriza es el CONTENIDO del diff, fichero a fichero.
 *
 * Este módulo es puro: no escribe, no consulta contenedores, no lee `.env` y no
 * toca stores.
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canonicalJson, sha256Hex } from './productionCanaryCorpus.mjs';

export const BINDING_VERSION = '1.0.0';

/**
 * Baseline productivo. Es una constante del proyecto, no un parámetro: el
 * binding existe para autorizar el salto DESDE esta producción concreta.
 */
export const BASELINE_PRODUCTION_COMMIT = '4c407af21262905db9478a07ce3dfe4e39ac9734';

/** Contrato de aceptación que el binding puede acompañar. Sin él, no ata nada. */
export const EXPECTED_ACCEPTANCE_CONTRACT_SHA256 =
    '344117208e63ec4f1a3ba6e105e6dc05c3b234f56d41c3486da009a0b7ef4dae';

// ─────────────────────────────────────────────────────────────────────────────
// Allowlist de rutas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ficheros que **cambian el comportamiento de la imagen** y están autorizados.
 * Son exactamente los tres de la telemetría secret-only, y la lista es de rutas
 * exactas: nada de prefijos, porque un prefijo bajo `server/` autorizaría medio
 * backend.
 */
export const RUNTIME_OBSERVABILITY_PATHS = Object.freeze([
    'server/lib/operationalAdminAuth.js',   // middleware secret-only file-only
    'server/metricsService.js',             // snapshot READ-ONLY de contadores
    'server/server.js',                     // montaje de la ruta operacional
]);

/**
 * Ficheros que no alteran el runtime servido: validación, pruebas, esquemas y
 * documentación. Se admiten por prefijo donde el prefijo es inequívoco.
 */
export const VALIDATION_AND_TESTS_PATHS = Object.freeze([
    { kind: 'exact', path: '.github/workflows/identity-preflight.yml' },
    { kind: 'exact', path: 'package.json' },   // solo scripts; las deps se verifican aparte
    { kind: 'prefix', path: 'docs/ops/' },
    { kind: 'prefix', path: 'docs/' },
    { kind: 'prefix', path: 'scripts/perf/' },
    { kind: 'prefix', path: 'server/__test__/' },
]);

/**
 * Denegación explícita. Se evalúa ANTES que la allowlist, de modo que ampliar
 * un prefijo por descuido no puede abrir ninguna de estas puertas.
 */
export const FORBIDDEN_PATHS = Object.freeze([
    { kind: 'exact', path: 'package-lock.json' },
    { kind: 'exact', path: 'Dockerfile' },
    { kind: 'exact', path: '.dockerignore' },
    { kind: 'suffix', path: '/Dockerfile' },
    { kind: 'prefix', path: 'node_modules/' },
    { kind: 'prefix', path: 'data/' },
    { kind: 'prefix', path: 'data-critical/' },
    { kind: 'prefix', path: 'public/uploads/' },
    { kind: 'prefix', path: 'engines/' },
    { kind: 'prefix', path: 'server/leo/' },
    { kind: 'prefix', path: 'scripts/migrations/' },
    { kind: 'prefix', path: 'pages/' },
    { kind: 'prefix', path: 'components/' },
    { kind: 'prefix', path: 'services/' },
    { kind: 'prefix', path: 'hooks/' },
    { kind: 'regex', path: '^docker-compose.*\\.ya?ml$' },
    { kind: 'regex', path: '^\\.env' },
]);

/** Campos de `package.json` que no pueden variar entre baseline y source. */
export const DEPENDENCY_FIELDS = Object.freeze([
    'dependencies', 'devDependencies', 'peerDependencies',
    'optionalDependencies', 'bundledDependencies', 'overrides', 'resolutions',
]);

const matches = (rule, p) => {
    if (rule.kind === 'exact') return p === rule.path;
    if (rule.kind === 'prefix') return p.startsWith(rule.path);
    if (rule.kind === 'suffix') return p.endsWith(rule.path);
    if (rule.kind === 'regex') return new RegExp(rule.path).test(p);
    return false;
};

/**
 * Clasifica una ruta. Denegación primero, allowlist después, y **por defecto
 * desconocida**: lo que nadie autorizó expresamente no pasa.
 */
export function classifyPath(p) {
    const path = String(p);
    if (FORBIDDEN_PATHS.some((r) => matches(r, path))) return 'FORBIDDEN';
    if (RUNTIME_OBSERVABILITY_PATHS.includes(path)) return 'RUNTIME_OBSERVABILITY';
    if (VALIDATION_AND_TESTS_PATHS.some((r) => matches(r, path))) return 'VALIDATION_AND_TESTS';
    return 'UNKNOWN';
}

// ─────────────────────────────────────────────────────────────────────────────
// Forma del artefacto
// ─────────────────────────────────────────────────────────────────────────────

export const BINDING_FIELDS = Object.freeze([
    'bindingVersion', 'corpusSha256', 'acceptanceContractSha256',
    'baselineProductionCommit', 'sourceCommit', 'sourceTree',
    'imageId', 'imageRevision', 'imageManifestSha256',
    'approvedDiffSha256', 'approvedRuntimeFiles', 'createdAt', 'expiresAt',
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// ─────────────────────────────────────────────────────────────────────────────
// Hechos derivados de Git
// ─────────────────────────────────────────────────────────────────────────────

const git = (repo, args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * Blob de un fichero en un commit, o `null` si no existía.
 *
 * Un fichero nuevo hace que `git rev-parse` falle y escriba en stderr; es el
 * caso normal para `operationalAdminAuth.js`, que no existe en el baseline. Se
 * silencia stderr a propósito: `null` YA es la respuesta correcta, y dejar
 * pasar un `fatal:` haría ruidosa una validación que debe leerse de un vistazo.
 */
function blobAt(repo, commit, path) {
    try {
        return execFileSync('git', ['-C', repo, 'rev-parse', `${commit}:${path}`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return null; }
}

/**
 * Huella del cambio autorizado.
 *
 * **No se hashea el texto del diff.** El formato de `git diff` no es estable
 * entre versiones ni entre repositorios (la longitud de los hashes abreviados
 * de la línea `index` depende de `core.abbrev`), así que hashearlo produciría
 * falsos DRIFTED. Se hashea el manifiesto canónico de pares de blobs, que es
 * exactamente reproducible y además más fuerte: identifica el contenido final,
 * no su representación.
 */
export function runtimeDiffDigest(repo, baseline, source, files) {
    const manifest = [...files].sort().map((path) => ({
        path,
        baselineBlob: blobAt(repo, baseline, path),
        sourceBlob: blobAt(repo, source, path),
    }));
    return { manifest, digest: sha256Hex(canonicalJson(manifest)) };
}

/** ¿Cambiaron las dependencias entre los dos commits? */
export function dependenciesUnchanged(repo, baseline, source) {
    const read = (commit) => {
        try { return JSON.parse(git(repo, ['show', `${commit}:package.json`])); }
        catch { return null; }
    };
    const a = read(baseline); const b = read(source);
    if (!a || !b) return { unchanged: false, reason: 'package.json ilegible en un extremo' };
    for (const f of DEPENDENCY_FIELDS) {
        if (canonicalJson(a[f] ?? null) !== canonicalJson(b[f] ?? null)) {
            return { unchanged: false, reason: `campo ${f} modificado` };
        }
    }
    return { unchanged: true, reason: null };
}

/** Todo lo que el validador necesita saber de Git, en una sola pasada. */
export function collectGitFacts(repo, baseline, source) {
    let descendant = false;
    try {
        execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', baseline, source], { stdio: 'ignore' });
        descendant = true;
    } catch { descendant = false; }

    const tree = git(repo, ['rev-parse', `${source}^{tree}`]).trim();
    const changedFiles = git(repo, ['diff', '--name-only', `${baseline}..${source}`])
        .split('\n').map((s) => s.trim()).filter(Boolean).sort();
    const runtimeFiles = changedFiles.filter((f) => classifyPath(f) === 'RUNTIME_OBSERVABILITY');
    const { digest } = runtimeDiffDigest(repo, baseline, source, runtimeFiles);
    return {
        descendant, tree, changedFiles, runtimeFiles,
        diffDigest: digest,
        deps: dependenciesUnchanged(repo, baseline, source),
        classified: Object.fromEntries(changedFiles.map((f) => [f, classifyPath(f)])),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación estructural (sin Git)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @returns {{name: string, ok: boolean, verdict: 'UNSAFE'|'DRIFTED'|'EXPIRED',
 *   detail: any}[]} comprobaciones; `ok:false` lleva su veredicto.
 */
export function checkBindingStructure(binding, { corpusSha256, corpusExpiresAt } = {}) {
    const out = [];
    const add = (name, ok, verdict, detail = null) => out.push({ name, ok: Boolean(ok), verdict, detail });
    const b = binding ?? {};

    const keys = Object.keys(b);
    add('binding.keys.known', keys.every((k) => BINDING_FIELDS.includes(k)), 'UNSAFE',
        keys.filter((k) => !BINDING_FIELDS.includes(k)));
    add('binding.keys.complete', BINDING_FIELDS.every((k) => k in b), 'UNSAFE',
        BINDING_FIELDS.filter((k) => !(k in b)));
    add('binding.version', b.bindingVersion === BINDING_VERSION, 'UNSAFE', b.bindingVersion);

    // Hashes completos: un hash truncado no identifica nada de forma única.
    add('binding.corpusSha256.format', SHA256_HEX.test(String(b.corpusSha256 ?? '')), 'UNSAFE', b.corpusSha256);
    add('binding.contractSha256.format', SHA256_HEX.test(String(b.acceptanceContractSha256 ?? '')), 'UNSAFE');
    add('binding.manifestSha256.format', SHA256_HEX.test(String(b.imageManifestSha256 ?? '')), 'UNSAFE');
    add('binding.diffSha256.format', SHA256_HEX.test(String(b.approvedDiffSha256 ?? '')), 'UNSAFE');
    add('binding.imageId.format', IMAGE_ID.test(String(b.imageId ?? '')), 'UNSAFE', b.imageId);
    add('binding.sourceCommit.format', GIT_SHA.test(String(b.sourceCommit ?? '')), 'UNSAFE');
    add('binding.sourceTree.format', GIT_SHA.test(String(b.sourceTree ?? '')), 'UNSAFE');
    add('binding.imageRevision.format', GIT_SHA.test(String(b.imageRevision ?? '')), 'UNSAFE');

    add('binding.baseline', b.baselineProductionCommit === BASELINE_PRODUCTION_COMMIT, 'UNSAFE',
        b.baselineProductionCommit);
    add('binding.contractSha256.expected',
        b.acceptanceContractSha256 === EXPECTED_ACCEPTANCE_CONTRACT_SHA256, 'UNSAFE');
    // La etiqueta OCI DEBE ser el commit: es lo que une la imagen al código.
    add('binding.revisionEqualsSourceCommit', b.imageRevision === b.sourceCommit, 'UNSAFE',
        { revision: b.imageRevision, source: b.sourceCommit });
    add('binding.notBaselineItself', b.sourceCommit !== BASELINE_PRODUCTION_COMMIT, 'UNSAFE');

    if (corpusSha256 !== undefined) {
        add('binding.corpusSha256.matches', b.corpusSha256 === corpusSha256, 'UNSAFE',
            { binding: b.corpusSha256, corpus: corpusSha256 });
    }

    const files = Array.isArray(b.approvedRuntimeFiles) ? b.approvedRuntimeFiles : null;
    add('binding.approvedRuntimeFiles.isArray', files !== null, 'UNSAFE');
    if (files) {
        const bad = files.filter((f) => classifyPath(f) !== 'RUNTIME_OBSERVABILITY');
        add('binding.approvedRuntimeFiles.allowlisted', bad.length === 0, 'UNSAFE', bad);
    }

    add('binding.createdAt.format', ISO_INSTANT.test(String(b.createdAt ?? '')), 'UNSAFE', b.createdAt);
    add('binding.expiresAt.format', ISO_INSTANT.test(String(b.expiresAt ?? '')), 'UNSAFE', b.expiresAt);
    if (corpusExpiresAt) {
        const be = Date.parse(b.expiresAt ?? ''); const ce = Date.parse(corpusExpiresAt);
        // Un binding que sobreviviera al corpus autorizaría medir con un
        // contrato cuya ventana de datos ya no existe.
        add('binding.expiresAt.notAfterCorpus',
            Number.isFinite(be) && Number.isFinite(ce) && be <= ce, 'UNSAFE',
            { binding: b.expiresAt, corpus: corpusExpiresAt });
    }
    return out;
}

/** Caducidad del binding, evaluada aparte porque su veredicto es EXPIRED. */
export function checkBindingExpiry(binding, now = new Date()) {
    const exp = Date.parse(binding?.expiresAt ?? '');
    if (!Number.isFinite(exp)) return [{ name: 'binding.expiry.parseable', ok: false, verdict: 'UNSAFE', detail: binding?.expiresAt }];
    return [{
        name: 'binding.expiry.notPassed', ok: now.getTime() < exp, verdict: 'EXPIRED',
        detail: { now: now.toISOString(), expiresAt: binding.expiresAt },
    }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación contra Git
// ─────────────────────────────────────────────────────────────────────────────

/** Compara el atestado con lo que Git dice de verdad. */
export function checkBindingAgainstGit(binding, facts) {
    const out = [];
    const add = (name, ok, verdict, detail = null) => out.push({ name, ok: Boolean(ok), verdict, detail });
    const b = binding ?? {};

    add('git.ancestry', facts.descendant === true, 'UNSAFE',
        `${BASELINE_PRODUCTION_COMMIT.slice(0, 7)}..${String(b.sourceCommit).slice(0, 7)}`);
    add('git.sourceTree', b.sourceTree === facts.tree, 'UNSAFE',
        { binding: b.sourceTree, git: facts.tree });

    const unknown = Object.entries(facts.classified).filter(([, k]) => k === 'UNKNOWN').map(([f]) => f);
    const forbidden = Object.entries(facts.classified).filter(([, k]) => k === 'FORBIDDEN').map(([f]) => f);
    add('git.noForbiddenFiles', forbidden.length === 0, 'UNSAFE', forbidden);
    add('git.noUnknownFiles', unknown.length === 0, 'UNSAFE', unknown);
    add('git.dependenciesUnchanged', facts.deps.unchanged === true, 'UNSAFE', facts.deps.reason);

    add('git.runtimeFilesMatchBinding',
        canonicalJson([...(b.approvedRuntimeFiles ?? [])].sort()) === canonicalJson([...facts.runtimeFiles].sort()),
        'UNSAFE', { binding: b.approvedRuntimeFiles, git: facts.runtimeFiles });
    add('git.approvedDiffSha256', b.approvedDiffSha256 === facts.diffDigest, 'UNSAFE',
        { binding: b.approvedDiffSha256, git: facts.diffDigest });
    return out;
}

/** Coincidencia entre el atestado y los contenedores vivos. */
export function checkBindingAgainstRuntime(binding, { imageId, revision, containerName }) {
    const n = containerName ?? 'runtime';
    return [
        { name: `${n}.binding.imageId`, ok: imageId === binding.imageId, verdict: 'DRIFTED',
            detail: { binding: binding.imageId, live: imageId } },
        { name: `${n}.binding.revision`, ok: revision === binding.imageRevision, verdict: 'DRIFTED',
            detail: { binding: binding.imageRevision, live: revision } },
    ];
}

export const sha256OfBuffer = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
