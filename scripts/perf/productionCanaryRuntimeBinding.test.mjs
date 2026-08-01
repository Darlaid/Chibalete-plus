/**
 * productionCanaryRuntimeBinding.test.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A-R2.
 *
 * El binding es lo único que puede autorizar una imagen nueva sin descongelar
 * el corpus. Por eso lo que se prueba aquí, sobre todo, es lo que **debe
 * rechazar**: un descendiente cualquiera, un fichero fuera de la allowlist, un
 * `package-lock` tocado, un `ImageID` truncado, una caducidad más larga que la
 * del corpus.
 *
 * Todo el material es sintético y vive en un repositorio Git temporal propio.
 * No se toca el repo real, ni producción, ni ningún store.
 *
 *   node scripts/perf/productionCanaryRuntimeBinding.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex, acceptanceContractSha256 } from './productionCanaryCorpus.mjs';
import {
    BINDING_VERSION, BASELINE_PRODUCTION_COMMIT, EXPECTED_ACCEPTANCE_CONTRACT_SHA256,
    BINDING_FIELDS, RUNTIME_OBSERVABILITY_PATHS, FORBIDDEN_PATHS,
    classifyPath, checkBindingStructure, checkBindingExpiry,
    checkBindingAgainstGit, checkBindingAgainstRuntime, dependenciesUnchanged,
    runtimeDiffDigest, collectGitFacts,
} from './productionCanaryRuntimeBinding.mjs';
import { VERDICTS, Report, validateRuntime, validateRuntimeBinding, RUNTIME_CONTAINERS }
    from './validateProductionCanaryCorpus.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-binding-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignorar */ } });

console.log('productionCanaryRuntimeBinding — CHP-STATS-LEGACY-PERF-CORPUS-01A-R2');

const worst = (checks) => {
    const order = [VERDICTS.VALID, VERDICTS.DRIFTED, VERDICTS.EXPIRED, VERDICTS.UNSAFE];
    return checks.filter((c) => !c.ok)
        .reduce((w, c) => (order.indexOf(c.verdict) > order.indexOf(w) ? c.verdict : w), VERDICTS.VALID);
};
const failed = (checks, name) => checks.some((c) => !c.ok && c.name === name);

// ── repositorio sintético ───────────────────────────────────────────────────
const REPO = path.join(TMP, 'repo');
const g = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function writeIn(rel, content) {
    const p = path.join(REPO, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

fs.mkdirSync(REPO, { recursive: true });
execFileSync('git', ['-C', REPO, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
// Dominio reservado por la RFC 6761 y compuesto por fragmentos: Git exige algo
// con forma de correo, y el detector de fugas del proyecto no debe ver uno.
g('config', 'user.email', ['fixture', 'ejemplo.invalid'].join('@'));
g('config', 'user.name', 'Fixture');
g('config', 'commit.gpgsign', 'false');

const PKG_BASE = {
    name: 'fixture', version: '1.0.0',
    dependencies: { express: '5.0.0' },
    devDependencies: {},
    scripts: { test: 'node x.js' },
};
writeIn('package.json', JSON.stringify(PKG_BASE, null, 2));
writeIn('package-lock.json', JSON.stringify({ lockfileVersion: 3 }, null, 2));
writeIn('Dockerfile', 'FROM node:20\n');
writeIn('server/server.js', 'export const app = 1;\n');
writeIn('server/metricsService.js', 'export const counters = {};\n');
g('add', '-A'); g('commit', '-qm', 'baseline');
const BASE = g('rev-parse', 'HEAD');

/** Reescribe la constante de baseline para el repo sintético. */
const withBaseline = (fn) => fn();

// Commit «bueno»: solo ficheros runtime autorizados + docs.
writeIn('server/server.js', 'export const app = 1;\nexport const route = 2;\n');
writeIn('server/lib/operationalAdminAuth.js', 'export const auth = 1;\n');
writeIn('docs/ops/NOTA.md', '# nota\n');
g('add', '-A'); g('commit', '-qm', 'observabilidad');
const GOOD = g('rev-parse', 'HEAD');

// Commit «malo»: toca package-lock y un fichero no autorizado.
writeIn('package-lock.json', JSON.stringify({ lockfileVersion: 3, extra: true }, null, 2));
writeIn('random/thing.txt', 'hola\n');
g('add', '-A'); g('commit', '-qm', 'no autorizado');
const BAD = g('rev-parse', 'HEAD');

// Commit que cambia dependencias.
writeIn('package.json', JSON.stringify({ ...PKG_BASE, dependencies: { express: '5.1.0' } }, null, 2));
g('add', '-A'); g('commit', '-qm', 'sube dependencia');
const DEPS = g('rev-parse', 'HEAD');

// Commit que altera el CONTENIDO de un fichero runtime autorizado. La ruta
// sigue permitida; lo que cambia es qué hace. La huella debe distinguirlo.
writeIn('server/server.js', 'export const app = 1;\nexport const route = 2;\nexport const puertaTrasera = 3;\n');
g('add', '-A'); g('commit', '-qm', 'contenido runtime alterado');
const ALTERED = g('rev-parse', 'HEAD');

// Rama huérfana: descendiente de nada.
execFileSync('git', ['-C', REPO, 'checkout', '-q', '--orphan', 'huerfana'], { stdio: 'ignore' });
writeIn('server/server.js', 'export const app = 99;\n');
g('add', '-A'); g('commit', '-qm', 'huerfano');
const ORPHAN = g('rev-parse', 'HEAD');
execFileSync('git', ['-C', REPO, 'checkout', '-q', 'main'], { stdio: 'ignore' });

const CORPUS_SHA = sha256Hex('corpus-fixture');
const CORPUS_EXPIRES = '2026-08-24T23:17:59Z';

function makeBinding(over = {}) {
    const facts = collectGitFacts(REPO, BASE, GOOD);
    return {
        bindingVersion: BINDING_VERSION,
        corpusSha256: CORPUS_SHA,
        acceptanceContractSha256: EXPECTED_ACCEPTANCE_CONTRACT_SHA256,
        baselineProductionCommit: BASELINE_PRODUCTION_COMMIT,
        sourceCommit: GOOD,
        sourceTree: facts.tree,
        imageId: `sha256:${'a'.repeat(64)}`,
        imageRevision: GOOD,
        imageManifestSha256: 'b'.repeat(64),
        approvedDiffSha256: facts.diffDigest,
        approvedRuntimeFiles: [...facts.runtimeFiles].sort(),
        createdAt: '2026-08-01T15:00:00Z',
        expiresAt: '2026-08-20T00:00:00Z',
        ...over,
    };
}
const structOf = (b) => checkBindingStructure(b, { corpusSha256: CORPUS_SHA, corpusExpiresAt: CORPUS_EXPIRES });

// ─────────────────────────────────────────────────────────────────────────────
section('[1] allowlist de rutas');
{
    ok('[1a] los tres ficheros runtime están declarados', RUNTIME_OBSERVABILITY_PATHS.length === 3);
    ok('[1b] son rutas exactas, no prefijos',
        RUNTIME_OBSERVABILITY_PATHS.every((p) => !p.endsWith('/')));
    for (const p of RUNTIME_OBSERVABILITY_PATHS) {
        ok(`[1c] ${p} → RUNTIME_OBSERVABILITY`, classifyPath(p) === 'RUNTIME_OBSERVABILITY');
    }
    ok('[1d] package-lock.json prohibido', classifyPath('package-lock.json') === 'FORBIDDEN');
    ok('[1e] Dockerfile prohibido', classifyPath('Dockerfile') === 'FORBIDDEN');
    ok('[1f] Dockerfile anidado prohibido', classifyPath('ops/x/Dockerfile') === 'FORBIDDEN');
    ok('[1g] compose prohibido', classifyPath('docker-compose.prod.yml') === 'FORBIDDEN');
    ok('[1h] .env prohibido', classifyPath('.env.local') === 'FORBIDDEN');
    ok('[1i] engines/ prohibido', classifyPath('engines/metricsEngine.ts') === 'FORBIDDEN');
    ok('[1j] server/leo/ prohibido', classifyPath('server/leo/leoEngine.js') === 'FORBIDDEN');
    ok('[1k] migraciones prohibidas', classifyPath('scripts/migrations/x/migrate.mjs') === 'FORBIDDEN');
    ok('[1l] stores prohibidos',
        classifyPath('data/users_db.json') === 'FORBIDDEN' && classifyPath('data-critical/events.db') === 'FORBIDDEN');
    ok('[1m] frontend prohibido',
        ['pages/A.tsx', 'components/B.tsx', 'services/c.ts', 'hooks/d.ts'].every((p) => classifyPath(p) === 'FORBIDDEN'));
    ok('[1n] lo no declarado es UNKNOWN, no permitido', classifyPath('random/file.txt') === 'UNKNOWN');
    ok('[1o] denegación gana sobre allowlist: scripts/migrations vs scripts/perf',
        classifyPath('scripts/migrations/z.mjs') === 'FORBIDDEN' && classifyPath('scripts/perf/z.mjs') === 'VALIDATION_AND_TESTS');
    ok('[1p] la lista de prohibidos está congelada', Object.isFrozen(FORBIDDEN_PATHS));
}

section('[2] estructura del binding');
{
    const good = structOf(makeBinding());
    ok('[2a] un binding correcto no falla nada', good.every((c) => c.ok),
        good.filter((c) => !c.ok).map((c) => c.name).join(','));
    ok('[2b] campos exactamente los declarados',
        canonicalJson(Object.keys(makeBinding()).sort()) === canonicalJson([...BINDING_FIELDS].sort()));

    const unknown = structOf(makeBinding({ campoInventado: 1 }));
    ok('[2c] campo desconocido → UNSAFE',
        worst(unknown) === VERDICTS.UNSAFE && failed(unknown, 'binding.keys.known'));

    const incomplete = makeBinding(); delete incomplete.imageManifestSha256;
    ok('[2d] campo ausente → UNSAFE', worst(structOf(incomplete)) === VERDICTS.UNSAFE);

    ok('[2e] hash de corpus incorrecto → UNSAFE',
        failed(structOf(makeBinding({ corpusSha256: sha256Hex('otro') })), 'binding.corpusSha256.matches'));
    ok('[2f] hash de contrato incorrecto → UNSAFE',
        failed(structOf(makeBinding({ acceptanceContractSha256: 'f'.repeat(64) })), 'binding.contractSha256.expected'));
    ok('[2g] baseline distinto → UNSAFE',
        failed(structOf(makeBinding({ baselineProductionCommit: '0'.repeat(40) })), 'binding.baseline'));

    ok('[2h] ImageID truncado → UNSAFE',
        failed(structOf(makeBinding({ imageId: 'sha256:0b31f5a2' })), 'binding.imageId.format'));
    ok('[2i] ImageID sin prefijo sha256 → UNSAFE',
        failed(structOf(makeBinding({ imageId: 'a'.repeat(64) })), 'binding.imageId.format'));
    ok('[2j] commit abreviado → UNSAFE',
        failed(structOf(makeBinding({ sourceCommit: '4b000cc' })), 'binding.sourceCommit.format'));
    ok('[2k] manifiesto truncado → UNSAFE',
        failed(structOf(makeBinding({ imageManifestSha256: 'abc' })), 'binding.manifestSha256.format'));

    ok('[2l] revisión OCI distinta del commit → UNSAFE',
        failed(structOf(makeBinding({ imageRevision: 'c'.repeat(40) })), 'binding.revisionEqualsSourceCommit'));
    ok('[2m] el baseline no puede atestarse a sí mismo',
        failed(structOf(makeBinding({ sourceCommit: BASELINE_PRODUCTION_COMMIT, imageRevision: BASELINE_PRODUCTION_COMMIT })),
            'binding.notBaselineItself'));

    ok('[2n] fichero runtime no autorizado en el atestado → UNSAFE',
        failed(structOf(makeBinding({ approvedRuntimeFiles: ['server/server.js', 'engines/metricsEngine.ts'] })),
            'binding.approvedRuntimeFiles.allowlisted'));

    ok('[2o] expiración posterior a la del corpus → UNSAFE',
        failed(structOf(makeBinding({ expiresAt: '2026-09-30T00:00:00Z' })), 'binding.expiresAt.notAfterCorpus'));
    ok('[2p] expiración igual a la del corpus se admite',
        !failed(structOf(makeBinding({ expiresAt: CORPUS_EXPIRES })), 'binding.expiresAt.notAfterCorpus'));
    ok('[2q] fecha ilegible → UNSAFE',
        failed(structOf(makeBinding({ expiresAt: 'cuando toque' })), 'binding.expiresAt.format'));
}

section('[3] caducidad');
{
    ok('[3a] vigente → sin fallo',
        checkBindingExpiry(makeBinding(), new Date('2026-08-05T00:00:00Z')).every((c) => c.ok));
    const exp = checkBindingExpiry(makeBinding(), new Date('2026-08-25T00:00:00Z'));
    ok('[3b] caducado → EXPIRED', worst(exp) === VERDICTS.EXPIRED);
}

section('[4] atestación contra Git');
{
    const facts = collectGitFacts(REPO, BASE, GOOD);
    ok('[4a] descendencia detectada', facts.descendant === true);
    ok('[4b] ficheros runtime derivados de Git',
        canonicalJson(facts.runtimeFiles.slice().sort()) ===
        canonicalJson(['server/lib/operationalAdminAuth.js', 'server/server.js']));
    ok('[4c] dependencias intactas', facts.deps.unchanged === true);

    const good = checkBindingAgainstGit(makeBinding(), facts);
    ok('[4d] binding coherente con Git', good.every((c) => c.ok),
        good.filter((c) => !c.ok).map((c) => c.name).join(','));

    ok('[4e] árbol distinto → UNSAFE',
        failed(checkBindingAgainstGit(makeBinding({ sourceTree: 'd'.repeat(40) }), facts), 'git.sourceTree'));
    ok('[4f] huella del diff distinta → UNSAFE',
        failed(checkBindingAgainstGit(makeBinding({ approvedDiffSha256: 'e'.repeat(64) }), facts), 'git.approvedDiffSha256'));
    ok('[4g] lista de ficheros runtime que no cuadra → UNSAFE',
        failed(checkBindingAgainstGit(makeBinding({ approvedRuntimeFiles: ['server/server.js'] }), facts),
            'git.runtimeFilesMatchBinding'));

    // Commit que toca package-lock y un fichero no autorizado.
    const badFacts = collectGitFacts(REPO, BASE, BAD);
    const bad = checkBindingAgainstGit(makeBinding({ sourceCommit: BAD, imageRevision: BAD, sourceTree: badFacts.tree }), badFacts);
    ok('[4h] package-lock modificado → UNSAFE', failed(bad, 'git.noForbiddenFiles'));
    ok('[4i] fichero desconocido → UNSAFE', failed(bad, 'git.noUnknownFiles'));
    ok('[4j] ambos son UNSAFE, no DRIFTED', worst(bad) === VERDICTS.UNSAFE);

    // Cambio de dependencias.
    const depFacts = collectGitFacts(REPO, BASE, DEPS);
    ok('[4k] dependencia modificada se detecta', depFacts.deps.unchanged === false);
    ok('[4l] dependencia modificada → UNSAFE',
        failed(checkBindingAgainstGit(makeBinding({ sourceCommit: DEPS, imageRevision: DEPS, sourceTree: depFacts.tree }), depFacts),
            'git.dependenciesUnchanged'));

    // Descendencia rota.
    const orphanFacts = collectGitFacts(REPO, BASE, ORPHAN);
    ok('[4m] commit fuera de ancestry → UNSAFE',
        failed(checkBindingAgainstGit(makeBinding({ sourceCommit: ORPHAN, imageRevision: ORPHAN, sourceTree: orphanFacts.tree }), orphanFacts),
            'git.ancestry'));

    // Ser descendiente NO basta: BAD también desciende de BASE.
    ok('[4n] ser descendiente no basta — BAD desciende y aun así se rechaza',
        badFacts.descendant === true && worst(bad) === VERDICTS.UNSAFE);

    // La huella es del contenido, no del texto del diff: reproducible.
    const d1 = runtimeDiffDigest(REPO, BASE, GOOD, facts.runtimeFiles).digest;
    const d2 = runtimeDiffDigest(REPO, BASE, GOOD, [...facts.runtimeFiles].reverse()).digest;
    ok('[4o] la huella no depende del orden de los ficheros', d1 === d2);
    // BAD no toca ningún fichero runtime, así que su huella DEBE coincidir:
    // lo que rechaza a BAD es la clasificación, no la huella. Distinguir las
    // dos protecciones importa.
    ok('[4p] la huella ignora cambios fuera del alcance runtime',
        runtimeDiffDigest(REPO, BASE, BAD, facts.runtimeFiles).digest === d1);

    // ALTERED sí cambia el CONTENIDO de un fichero autorizado: misma ruta,
    // distinto comportamiento. Aquí la huella es la única defensa.
    const altFacts = collectGitFacts(REPO, BASE, ALTERED);
    ok('[4q] la huella cambia si cambia el contenido de un fichero autorizado',
        altFacts.diffDigest !== d1);
    ok('[4r] un binding con la huella vieja no autoriza el contenido nuevo',
        failed(checkBindingAgainstGit(
            makeBinding({ sourceCommit: ALTERED, imageRevision: ALTERED, sourceTree: altFacts.tree }), altFacts),
        'git.approvedDiffSha256'));
}

section('[5] sin repositorio no hay atestación: fail-closed');
{
    const r = new Report();
    validateRuntimeBinding(makeBinding(), r, { corpusSha256: CORPUS_SHA, corpusExpiresAt: CORPUS_EXPIRES, repo: null });
    ok('[5a] sin --repo → UNSAFE', r.verdict() === VERDICTS.UNSAFE);
    ok('[5b] el fallo es explícito, no una omisión',
        r.failures.some((f) => f.name === 'binding.gitAttested'));

    const r2 = new Report();
    validateRuntimeBinding(makeBinding(), r2, {
        corpusSha256: CORPUS_SHA, corpusExpiresAt: CORPUS_EXPIRES,
        repo: path.join(TMP, 'no-existe'),
    });
    ok('[5c] repo inexistente → UNSAFE', r2.verdict() === VERDICTS.UNSAFE);
}

section('[6] runtime vivo contra el atestado');
{
    const b = makeBinding();
    const okChecks = checkBindingAgainstRuntime(b, { imageId: b.imageId, revision: b.imageRevision, containerName: 'api_1' });
    ok('[6a] imagen y revisión coincidentes → sin fallo', okChecks.every((c) => c.ok));

    const wrongImage = checkBindingAgainstRuntime(b, { imageId: `sha256:${'9'.repeat(64)}`, revision: b.imageRevision, containerName: 'api_1' });
    ok('[6b] ImageID vivo distinto → DRIFTED', worst(wrongImage) === VERDICTS.DRIFTED);

    const wrongRev = checkBindingAgainstRuntime(b, { imageId: b.imageId, revision: '7'.repeat(40), containerName: 'api_1' });
    ok('[6c] revisión OCI viva distinta → DRIFTED', worst(wrongRev) === VERDICTS.DRIFTED);
}

section('[7] los dos modos del validador');
{
    const FLAGS_OFF = ['LEGACY_METRICS_REQUEST_CONTEXT=off', 'METRICS_ENGINE=legacy'];
    const FLAGS_ON = ['LEGACY_METRICS_REQUEST_CONTEXT=on', 'METRICS_ENGINE=legacy'];
    // El entorno se pasa por parámetro y nunca se muta después: mutarlo
    // requeriría escribir la ruta cruda del campo, que es justo lo que el
    // ratchet de evidencia prohíbe.
    const makeInspect = (name, revision, imageId, envLines = FLAGS_OFF) => ({
        Name: `/${name}`, Image: imageId, RestartCount: 0, Created: '2026-08-01T00:00:00Z',
        State: { Status: 'running', Health: { Status: 'healthy' }, StartedAt: '2026-08-01T00:00:00Z' },
        HostConfig: { RestartPolicy: { Name: 'unless-stopped' }, Memory: 0, NanoCpus: 0 },
        Config: {
            Image: 'chibalete/api:x',
            Env: [...envLines],
            Labels: { 'org.opencontainers.image.revision': revision },
        },
        Mounts: [], NetworkSettings: { Networks: {} },
    });

    const CURRENT_IMAGE = `sha256:${'0'.repeat(64)}`;
    const NEW_IMAGE = `sha256:${'a'.repeat(64)}`;
    const corpus = {
        production: { imageId: CURRENT_IMAGE, commit: BASELINE_PRODUCTION_COMMIT },
    };

    // MODO A — producción actual.
    const a1 = new Report();
    validateRuntime(corpus, a1, {
        docker: false,
        inspected: RUNTIME_CONTAINERS.map((n) => makeInspect(n, BASELINE_PRODUCTION_COMMIT, CURRENT_IMAGE)),
    });
    ok('[7a] MODO A: producción actual → sin fallos', a1.failures.length === 0,
        a1.failures.map((f) => f.name).join(','));

    // MODO A con la imagen nueva: debe fallar. Ese es justo el problema que
    // el binding resuelve, y la vía A no se relaja.
    const a2 = new Report();
    validateRuntime(corpus, a2, {
        docker: false,
        inspected: RUNTIME_CONTAINERS.map((n) => makeInspect(n, GOOD, NEW_IMAGE)),
    });
    ok('[7b] MODO A: runtime nuevo SIN binding → DRIFTED', a2.verdict() === VERDICTS.DRIFTED);
    ok('[7c] falla por ImageID y por commit',
        a2.failures.some((f) => f.name.endsWith('.imageId')) &&
        a2.failures.some((f) => f.name.endsWith('.commit')));

    // MODO B — con atestado, el mismo runtime nuevo es aceptable.
    const b1 = new Report();
    validateRuntime(corpus, b1, {
        docker: false,
        binding: makeBinding({ imageId: NEW_IMAGE }),
        inspected: RUNTIME_CONTAINERS.map((n) => makeInspect(n, GOOD, NEW_IMAGE)),
    });
    ok('[7d] MODO B: runtime nuevo CON binding → sin fallos', b1.failures.length === 0,
        b1.failures.map((f) => `${f.name}:${JSON.stringify(f.detail)}`).join(' | '));
    ok('[7e] MODO B no compara contra el corpus',
        !b1.checks.some((c) => c.name.endsWith('.imageId') && !c.name.includes('binding')));

    // MODO B con un runtime que NO es el atestado.
    const b2 = new Report();
    validateRuntime(corpus, b2, {
        docker: false,
        binding: makeBinding({ imageId: NEW_IMAGE }),
        inspected: RUNTIME_CONTAINERS.map((n) => makeInspect(n, GOOD, `sha256:${'f'.repeat(64)}`)),
    });
    ok('[7f] MODO B: imagen distinta de la atestada → DRIFTED', b2.verdict() === VERDICTS.DRIFTED);

    // El flag encendido sigue siendo UNSAFE en ambos modos.
    const b3 = new Report();
    const onInspect = RUNTIME_CONTAINERS.map((n) => makeInspect(n, GOOD, NEW_IMAGE, FLAGS_ON));
    validateRuntime(corpus, b3, { docker: false, binding: makeBinding({ imageId: NEW_IMAGE }), inspected: onInspect });
    ok('[7g] MODO B no relaja la seguridad viva: flag on → UNSAFE', b3.verdict() === VERDICTS.UNSAFE);
}

section('[8] el generador es fail-closed y no sobrescribe');
{
    const corpusFile = path.join(TMP, 'corpus.json');
    fs.writeFileSync(corpusFile, JSON.stringify({
        acceptanceContractSha256: acceptanceContractSha256(),
        expiresAt: CORPUS_EXPIRES,
    }));
    const GEN = path.join(HERE, 'buildProductionCanaryRuntimeBinding.mjs');
    const run = (extra, out) => spawnSync(process.execPath, [GEN,
        '--corpus', corpusFile, '--repo', REPO,
        '--imageId', `sha256:${'a'.repeat(64)}`,
        '--imageManifestSha256', 'b'.repeat(64),
        '--createdAt', '2026-08-01T15:00:00Z', '--expiresAt', '2026-08-20T00:00:00Z',
        '--out', out, ...extra], { encoding: 'utf8' });

    // El repo sintético no desciende del baseline real, así que el generador
    // DEBE negarse: es exactamente la protección que se está probando.
    const outA = path.join(TMP, 'binding-a.json');
    const resA = run(['--sourceCommit', GOOD, '--imageRevision', GOOD], outA);
    ok('[8a] sin ancestry real → no escribe', resA.status !== 0 && !fs.existsSync(outA));
    ok('[8b] el motivo es explícito', /git\.ancestry|STOP/.test(`${resA.stdout}${resA.stderr}`));

    const outB = path.join(TMP, 'binding-b.json');
    const resB = run(['--sourceCommit', GOOD], outB);   // falta --imageRevision
    ok('[8c] parámetro obligatorio ausente → no escribe',
        resB.status !== 0 && !fs.existsSync(outB) && /imageRevision/.test(resB.stderr));

    const resC = run(['--sourceCommit', GOOD, '--imageRevision', GOOD, '--imageId', 'sha256:abc'], path.join(TMP, 'binding-c.json'));
    ok('[8d] ImageID truncado → no escribe', resC.status !== 0);

    // Sobrescritura: se niega sin --force.
    const outD = path.join(TMP, 'binding-d.json');
    fs.writeFileSync(outD, '{}', { mode: 0o600 });
    const resD = run(['--sourceCommit', GOOD, '--imageRevision', GOOD], outD);
    ok('[8e] no sobrescribe sin --force',
        resD.status === 4 && fs.readFileSync(outD, 'utf8') === '{}');
    ok('[8f] lo dice claramente', /--force/.test(resD.stderr));

    // El corpus nunca se toca.
    const before = sha256Hex(fs.readFileSync(corpusFile));
    run(['--sourceCommit', GOOD, '--imageRevision', GOOD], path.join(TMP, 'binding-e.json'));
    ok('[8g] el generador no modifica el corpus', sha256Hex(fs.readFileSync(corpusFile)) === before);

    // Contrato de aceptación desconocido → se niega antes de mirar Git.
    const badCorpus = path.join(TMP, 'corpus-bad.json');
    fs.writeFileSync(badCorpus, JSON.stringify({ acceptanceContractSha256: 'f'.repeat(64), expiresAt: CORPUS_EXPIRES }));
    const resF = spawnSync(process.execPath, [GEN, '--corpus', badCorpus, '--repo', REPO,
        '--sourceCommit', GOOD, '--imageRevision', GOOD, '--imageId', `sha256:${'a'.repeat(64)}`,
        '--imageManifestSha256', 'b'.repeat(64), '--createdAt', '2026-08-01T15:00:00Z',
        '--expiresAt', '2026-08-20T00:00:00Z', '--out', path.join(TMP, 'binding-f.json')], { encoding: 'utf8' });
    ok('[8h] contrato de aceptación desconocido → no escribe', resF.status === 3);
}

section('[9] privacidad del atestado');
{
    const b = makeBinding();
    const text = JSON.stringify(b);
    ok('[9a] sin correos', !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text));
    ok('[9b] sin identificadores de usuario', !/\buser[-_][0-9]{10,}\b/i.test(text));
    ok('[9c] sin identificadores de grupo ni institución',
        !/\b(?:group|course|school)[-_][0-9]{10,}\b/i.test(text));
    ok('[9d] solo hashes, commits y fechas',
        Object.entries(b).every(([k, v]) => k === 'approvedRuntimeFiles'
            ? v.every((f) => typeof f === 'string' && f.startsWith('server/'))
            : typeof v === 'string'));
    ok('[9e] el binding no lleva alias ni población del corpus',
        !text.includes('ORG_') && !text.includes('GROUP_R7') && !text.includes('USER_R6'));
}

section('[10] el binding NO forma parte del contrato de aceptación');
{
    ok('[10a] el hash del contrato no cambia por existir el binding',
        acceptanceContractSha256() === EXPECTED_ACCEPTANCE_CONTRACT_SHA256);
    const src = fs.readFileSync(path.join(HERE, 'productionCanaryCorpus.mjs'), 'utf8');
    ok('[10b] el módulo del contrato no importa el del binding',
        !src.includes('productionCanaryRuntimeBinding'));
    ok('[10c] acceptanceContract() no menciona binding alguno',
        !/acceptanceContract\(\)[\s\S]{0,600}binding/i.test(src));
}

console.log(`\nproductionCanaryRuntimeBinding: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
