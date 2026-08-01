/**
 * buildProductionCanaryRuntimeBinding.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A-R2.
 *
 * Genera el atestado root-only `PRODUCTION-CANARY-RUNTIME-BINDING.json`, que
 * autoriza a UNA imagen concreta a ejecutar el contrato congelado del corpus.
 *
 * **No inventa nada.** Todo lo que el generador no puede probar, lo exige por
 * parámetro; y todo lo que puede derivar de Git, lo deriva de Git y lo compara.
 * Si algo no cuadra, no escribe: no existe un modo «escribe y ya lo revisamos».
 *
 * Lo que se pasa a mano (porque solo existe tras construir la imagen):
 *   --imageId            sha256:… completo, nunca abreviado
 *   --imageRevision      etiqueta OCI de la imagen; debe ser el commit
 *   --imageManifestSha256 digest del manifiesto de la imagen
 *
 * Lo que sale de Git:
 *   descendencia del baseline productivo · árbol del commit · ficheros
 *   cambiados y su clasificación · invariancia de dependencias · huella del
 *   cambio runtime autorizado.
 *
 * Lo que NO hace: tocar el corpus, leer `.env`, consultar contenedores,
 * contactar con un registry o sobrescribir un binding existente sin `--force`.
 *
 * Uso:
 *   node buildProductionCanaryRuntimeBinding.mjs \
 *     --corpus /root/…/PRODUCTION-CANARY-CORPUS.json \
 *     --repo /path/al/repo --sourceCommit <sha40> \
 *     --imageId sha256:<64hex> --imageRevision <sha40> \
 *     --imageManifestSha256 <64hex> \
 *     --createdAt <iso> --expiresAt <iso> \
 *     --out /root/…/PRODUCTION-CANARY-RUNTIME-BINDING.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './productionCanaryCorpus.mjs';
import {
    BINDING_VERSION, BASELINE_PRODUCTION_COMMIT, EXPECTED_ACCEPTANCE_CONTRACT_SHA256,
    BINDING_FIELDS, collectGitFacts, checkBindingStructure, checkBindingAgainstGit,
} from './productionCanaryRuntimeBinding.mjs';

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2), v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    }
    return out;
}

const args = parseArgs(process.argv);
const need = (k) => {
    const v = args[k];
    if (v === undefined || v === true || String(v).trim() === '') {
        console.error(`STOP — falta --${k}. El generador no inventa valores.`);
        process.exit(2);
    }
    return String(v);
};

const corpusPath = need('corpus');
const outPath = need('out');
const repo = String(args.repo ?? process.cwd());

// ── el corpus se LEE, nunca se escribe ──────────────────────────────────────
let corpus;
let corpusSha256;
try {
    const buf = fs.readFileSync(corpusPath);
    corpusSha256 = sha256Hex(buf);
    corpus = JSON.parse(buf.toString('utf8'));
} catch (e) {
    console.error(`STOP — corpus ilegible: ${e.message}`);
    process.exit(3);
}

if (corpus.acceptanceContractSha256 !== EXPECTED_ACCEPTANCE_CONTRACT_SHA256) {
    console.error('STOP — el corpus no lleva el contrato de aceptación esperado. ' +
        'Un binding solo ata un contrato conocido.');
    process.exit(3);
}

// ── negarse a sobrescribir sin decisión explícita ───────────────────────────
if (fs.existsSync(outPath) && !args.force) {
    console.error(`STOP — ya existe ${outPath}. Reemplazarlo exige --force, ` +
        'porque un binding sobrescrito en silencio invalidaría la evidencia del anterior.');
    process.exit(4);
}

const binding = {
    bindingVersion: BINDING_VERSION,
    corpusSha256,
    acceptanceContractSha256: corpus.acceptanceContractSha256,
    baselineProductionCommit: BASELINE_PRODUCTION_COMMIT,
    sourceCommit: need('sourceCommit'),
    sourceTree: '',                 // se rellena desde Git, más abajo
    imageId: need('imageId'),
    imageRevision: need('imageRevision'),
    imageManifestSha256: need('imageManifestSha256'),
    approvedDiffSha256: '',         // se rellena desde Git
    approvedRuntimeFiles: [],       // se rellena desde Git
    createdAt: need('createdAt'),
    expiresAt: need('expiresAt'),
};

// ── hechos de Git ───────────────────────────────────────────────────────────
let facts;
try {
    facts = collectGitFacts(repo, BASELINE_PRODUCTION_COMMIT, binding.sourceCommit);
} catch (e) {
    console.error(`STOP — no se pudieron derivar los hechos de Git: ${e.message}`);
    process.exit(5);
}
binding.sourceTree = facts.tree;
binding.approvedRuntimeFiles = [...facts.runtimeFiles].sort();
binding.approvedDiffSha256 = facts.diffDigest;

// El orden de claves se fija aquí para que el artefacto sea estable.
const ordered = {};
for (const k of BINDING_FIELDS) ordered[k] = binding[k];

// ── validar ANTES de escribir ───────────────────────────────────────────────
const checks = [
    ...checkBindingStructure(ordered, { corpusSha256, corpusExpiresAt: corpus.expiresAt }),
    ...checkBindingAgainstGit(ordered, facts),
];
const failures = checks.filter((c) => !c.ok);

console.log(`clasificación del diff ${BASELINE_PRODUCTION_COMMIT.slice(0, 7)}..${binding.sourceCommit.slice(0, 7)}:`);
for (const [file, kind] of Object.entries(facts.classified)) console.log(`  ${kind.padEnd(24)} ${file}`);

if (failures.length) {
    console.error(`\nSTOP — el binding NO se escribe: ${failures.length} comprobación(es) fallida(s).`);
    for (const f of failures) {
        console.error(`  ${f.verdict}  ${f.name}` + (f.detail == null ? '' : `  ${JSON.stringify(f.detail)}`));
    }
    process.exit(6);
}

// ── escritura atómica, 0600 ─────────────────────────────────────────────────
const tmp = `${outPath}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(ordered, null, 1)}\n`, { mode: 0o600 });
fs.chmodSync(tmp, 0o600);
fs.renameSync(tmp, outPath);      // rename atómico: nunca un binding a medias
fs.chmodSync(outPath, 0o600);

console.log(`\nbinding escrito: ${outPath} (0600)`);
console.log(`  sourceCommit        : ${ordered.sourceCommit}`);
console.log(`  sourceTree          : ${ordered.sourceTree}`);
console.log(`  imageId             : ${ordered.imageId}`);
console.log(`  approvedRuntimeFiles: ${ordered.approvedRuntimeFiles.join(', ') || '(ninguno)'}`);
console.log(`  approvedDiffSha256  : ${ordered.approvedDiffSha256}`);
console.log(`  sha256 del binding  : ${sha256Hex(fs.readFileSync(outPath))}`);
console.log(`\nEl corpus NO se ha modificado (${path.basename(corpusPath)} sigue en ${corpusSha256.slice(0, 8)}…).`);
