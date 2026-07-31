#!/usr/bin/env node
/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Herramienta única de evidencia operativa.
 *
 *   node scripts/security/safeOperationalEvidence.mjs <subcomando> [opciones]
 *
 * Subcomandos:
 *   container-summary   resumen de contenedores (allowlist de campos)
 *   compose-summary     resumen del compose efectivo, sin persistirlo crudo
 *   environment-names   nombres de variables; valores solo si son publicables
 *   mount-summary       mounts con rutas saneadas
 *   health-summary      estado de salud y reinicios
 *   image-summary       ImageID, referencia y etiquetas permitidas
 *   redact-json         redacta un JSON estructuralmente
 *   redact-env          redacta un .env (por defecto: solo nombres)
 *   redact-yaml         redacta un YAML conservando su validez
 *   scan-artifact       busca valores literales en un artefacto, sin tokenizar
 *
 * GARANTÍAS
 *
 *   1. No existe `--raw`, `--full` ni `--no-redact`. Pasarlos es un error duro:
 *      la herramienta no tiene modo inseguro que activar por descuido.
 *   2. La salida de Docker/compose se consume en memoria y se PROYECTA campo a
 *      campo. El objeto original nunca se escribe ni se imprime.
 *   3. `Config.Env` no se emite jamás con valores. Solo nombres, más los pocos
 *      valores de la allowlist de banderas (ver `evidenceContract.mjs`).
 *
 * Ver docs/ops/SAFE_OPERATIONAL_EVIDENCE.md.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
    EVIDENCE_CONTRACT_VERSION,
    projectContainer,
    projectLabels,
    projectMounts,
    projectNetworks,
    isPublishableEnvValue,
} from './evidenceContract.mjs';
import { isSensitiveName, REDACTED } from './sensitiveTaxonomy.mjs';
import { redactJson, redactEnvText, redactYaml, envNames } from './redact.mjs';
import { scanArtifact, loadNeedles } from './scanArtifact.mjs';

// ── Barrera contra modos inseguros ───────────────────────────────────────────

const FORBIDDEN_FLAGS = ['--raw', '-raw', '--full', '--no-redact', '--unsafe', '--verbatim'];

export const assertNoUnsafeFlags = (argv) => {
    const hit = argv.find((a) => FORBIDDEN_FLAGS.includes(a));
    if (hit) {
        throw new Error(
            `${hit} no existe y no se va a implementar. Esta herramienta no tiene modo crudo: ` +
            'la evidencia se construye por allowlist. Si necesitas un campo nuevo, añádelo a ' +
            'CONTAINER_ALLOWLIST en scripts/security/evidenceContract.mjs con su justificación.',
        );
    }
};

// ── Utilidades de argumentos ─────────────────────────────────────────────────

const argValue = (argv, name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const hasFlag = (argv, name) => argv.includes(name);
const positionals = (argv) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { i++; continue; }
        out.push(argv[i]);
    }
    return out;
};

// ── Origen de datos: Docker real o fixture sintética ─────────────────────────

/**
 * Acepta tanto un array JSON (`docker inspect` sin --format) como una línea
 * JSON por contenedor (`--format '{{json .}}'`).
 */
export const parseInspectPayload = (raw) => {
    const trimmed = String(raw).trim();
    if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
    }
    return trimmed.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
};

/**
 * Obtiene el inspect de un contenedor COMO OBJETO EN MEMORIA.
 *
 * `--from-file` permite alimentar la herramienta con una fixture sintética
 * (tests, ejercicios de incidente) o con el resultado de un `docker inspect`
 * remoto por TUBERÍA (`--from-file -` lee stdin). No es un modo inseguro: la
 * proyección por allowlist se aplica igual, venga el objeto de donde venga, y
 * en el caso de la tubería el objeto crudo no llega a tocar el disco.
 */
export const loadInspect = (names, fromFile) => {
    if (fromFile) {
        const parsed = parseInspectPayload(readFileSync(fromFile === '-' ? 0 : fromFile, 'utf8'));
        return parsed;
    }
    if (!names.length) throw new Error('Falta el nombre del contenedor (o --from-file <fixture>).');
    // `--format {{json .}}` devuelve una línea JSON por contenedor. Se parsea
    // en memoria y se descarta; jamás se redirige a un archivo.
    const raw = execFileSync('docker', ['inspect', '--format', '{{json .}}', ...names], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    return raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
};

/** Compose efectivo en memoria; nunca se persiste crudo. */
export const loadComposeConfig = (composeFile, fromFile) => {
    if (fromFile) return JSON.parse(readFileSync(fromFile === '-' ? 0 : fromFile, 'utf8'));
    const args = ['compose'];
    if (composeFile) args.push('-f', composeFile);
    args.push('config', '--format', 'json');
    const raw = execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(raw);
};

// ── Las diez funciones del contrato ──────────────────────────────────────────

/** 1. Resumen completo de contenedor, campo a campo. */
export const containerSummary = (inspected) => ({
    contract: EVIDENCE_CONTRACT_VERSION,
    kind: 'container-summary',
    containers: inspected.map((c) => ({
        ...projectContainer(c),
        labels: projectLabels(c?.Config?.Labels),
        mounts: projectMounts(c?.Mounts),
        networks: projectNetworks(c?.NetworkSettings?.Networks),
        environment: environmentNames([c]).variables[0]?.entries ?? [],
    })),
});

/** 2. Resumen del compose efectivo. */
export const composeSummary = (config) => {
    const services = Object.entries(config?.services ?? {}).map(([name, svc]) => {
        const envRaw = svc?.environment ?? {};
        const entries = Array.isArray(envRaw)
            ? envRaw.map((e) => { const i = String(e).indexOf('='); return i < 0 ? [String(e), null] : [String(e).slice(0, i), String(e).slice(i + 1)]; })
            : Object.entries(envRaw);
        return {
            service: name,
            image: svc?.image ?? null,
            containerName: svc?.container_name ?? null,
            restart: svc?.restart ?? null,
            memLimit: svc?.mem_limit ?? null,
            cpus: svc?.cpus ?? null,
            networks: Array.isArray(svc?.networks) ? [...svc.networks] : Object.keys(svc?.networks ?? {}),
            ports: (svc?.ports ?? []).map((p) => (typeof p === 'string' ? p : `${p.published ?? ''}:${p.target ?? ''}`)),
            envFiles: (Array.isArray(svc?.env_file) ? svc.env_file : svc?.env_file ? [svc.env_file] : [])
                .map((f) => (typeof f === 'string' ? f : f?.path ?? String(f))),
            mounts: (svc?.volumes ?? []).map((v) => (typeof v === 'string'
                ? { spec: v.split(':').slice(-2).join(':') }
                : { source: v?.source ?? null, target: v?.target ?? null, readOnly: v?.read_only ?? null })),
            environment: entries.map(([k, v]) => ({
                name: k,
                value: isPublishableEnvValue(k) && !isSensitiveName(k) ? (v === null ? null : String(v)) : REDACTED,
            })).sort((a, b) => a.name.localeCompare(b.name)),
        };
    });
    return {
        contract: EVIDENCE_CONTRACT_VERSION,
        kind: 'compose-summary',
        note: 'compose efectivo consumido en memoria; nunca persistido crudo',
        services,
        networks: Object.keys(config?.networks ?? {}),
    };
};

/** 3. Nombres de variables de entorno (valores solo si son publicables). */
export const environmentNames = (inspected) => ({
    contract: EVIDENCE_CONTRACT_VERSION,
    kind: 'environment-names',
    variables: inspected.map((c) => ({
        container: (c?.Name ?? '').replace(/^\//, '') || null,
        entries: (c?.Config?.Env ?? []).map((line) => {
            const i = String(line).indexOf('=');
            const name = i < 0 ? String(line) : String(line).slice(0, i);
            const value = i < 0 ? null : String(line).slice(i + 1);
            return {
                name,
                value: isPublishableEnvValue(name) && !isSensitiveName(name) ? value : REDACTED,
            };
        }).sort((a, b) => a.name.localeCompare(b.name)),
    })),
});

/** 4. Mounts con rutas saneadas. */
export const mountSummary = (inspected) => ({
    contract: EVIDENCE_CONTRACT_VERSION,
    kind: 'mount-summary',
    containers: inspected.map((c) => ({
        name: (c?.Name ?? '').replace(/^\//, '') || null,
        mounts: projectMounts(c?.Mounts),
    })),
});

/** 5. Salud y reinicios. */
export const healthSummary = (inspected) => ({
    contract: EVIDENCE_CONTRACT_VERSION,
    kind: 'health-summary',
    containers: inspected.map((c) => ({
        name: (c?.Name ?? '').replace(/^\//, '') || null,
        status: c?.State?.Status ?? null,
        health: c?.State?.Health?.Status ?? null,
        restartCount: c?.RestartCount ?? null,
        startedAt: c?.State?.StartedAt ?? null,
        // Los logs del healthcheck pueden contener URLs firmadas: solo el conteo.
        healthLogEntries: Array.isArray(c?.State?.Health?.Log) ? c.State.Health.Log.length : 0,
    })),
});

/** 6. Imagen: ImageID, referencia y labels permitidos. */
export const imageSummary = (inspected) => ({
    contract: EVIDENCE_CONTRACT_VERSION,
    kind: 'image-summary',
    containers: inspected.map((c) => ({
        name: (c?.Name ?? '').replace(/^\//, '') || null,
        imageId: c?.Image ?? null,
        imageRef: c?.Config?.Image ?? null,
        labels: projectLabels(c?.Config?.Labels),
    })),
});

// 7-9: redact-json / redact-env / redact-yaml se resuelven en el CLI con los
// redactores de redact.mjs. 10: scan-artifact, con scanArtifact.mjs.

// ── CLI ──────────────────────────────────────────────────────────────────────

const emit = (argv, payload, { alwaysString = false } = {}) => {
    const out = argv.indexOf('--out') >= 0 ? argValue(argv, '--out') : null;
    const text = alwaysString ? String(payload) : JSON.stringify(payload, null, 2);
    if (out) {
        writeFileSync(out, text.endsWith('\n') ? text : text + '\n', { mode: 0o600 });
        process.stdout.write(`evidencia escrita en ${out} (0600)\n`);
    } else {
        process.stdout.write(text + '\n');
    }
};

const USAGE = `uso: safeOperationalEvidence.mjs <subcomando> [opciones]

  container-summary <contenedor...> [--from-file f] [--out f]
  compose-summary   [--compose-file f] [--from-file f] [--out f]
  environment-names <contenedor...> [--from-file f] [--out f]
  mount-summary     <contenedor...> [--from-file f] [--out f]
  health-summary    <contenedor...> [--from-file f] [--out f]
  image-summary     <contenedor...> [--from-file f] [--out f]
  redact-json       <archivo> [--out f]
  redact-env        <archivo> [--mode names|redacted] [--out f]
  redact-yaml       <archivo> [--out f]
  scan-artifact     <archivo> --needles <archivo> [--out f]

No existe --raw. Ver docs/ops/SAFE_OPERATIONAL_EVIDENCE.md.`;

export const main = (argv) => {
    assertNoUnsafeFlags(argv);
    const [sub, ...rest] = argv;
    const pos = positionals(rest);
    const fromFile = argValue(rest, '--from-file');

    switch (sub) {
        case 'container-summary':
            emit(rest, containerSummary(loadInspect(pos, fromFile))); break;
        case 'compose-summary':
            emit(rest, composeSummary(loadComposeConfig(argValue(rest, '--compose-file'), fromFile))); break;
        case 'environment-names':
            emit(rest, environmentNames(loadInspect(pos, fromFile))); break;
        case 'mount-summary':
            emit(rest, mountSummary(loadInspect(pos, fromFile))); break;
        case 'health-summary':
            emit(rest, healthSummary(loadInspect(pos, fromFile))); break;
        case 'image-summary':
            emit(rest, imageSummary(loadInspect(pos, fromFile))); break;
        case 'redact-json': {
            if (!pos[0]) throw new Error('falta el archivo JSON');
            emit(rest, redactJson(JSON.parse(readFileSync(pos[0], 'utf8')))); break;
        }
        case 'redact-env': {
            if (!pos[0]) throw new Error('falta el archivo .env');
            const mode = argValue(rest, '--mode', 'names');
            if (!['names', 'redacted'].includes(mode)) throw new Error(`--mode inválido: ${mode}`);
            emit(rest, redactEnvText(readFileSync(pos[0], 'utf8'), { mode }), { alwaysString: true }); break;
        }
        case 'redact-yaml': {
            if (!pos[0]) throw new Error('falta el archivo YAML');
            emit(rest, redactYaml(readFileSync(pos[0], 'utf8')), { alwaysString: true }); break;
        }
        case 'scan-artifact': {
            const needlesFile = argValue(rest, '--needles');
            if (!pos[0] || !needlesFile) throw new Error('uso: scan-artifact <archivo> --needles <archivo>');
            const findings = scanArtifact(readFileSync(pos[0]), loadNeedles(needlesFile));
            emit(rest, {
                contract: EVIDENCE_CONTRACT_VERSION,
                kind: 'scan-artifact',
                artifact: pos[0],
                clean: findings.length === 0,
                findings,
            });
            if (findings.length) process.exitCode = 1;
            break;
        }
        case 'env-names':
            emit(rest, { contract: EVIDENCE_CONTRACT_VERSION, kind: 'env-names', names: envNames(readFileSync(pos[0], 'utf8')) }); break;
        default:
            process.stderr.write(USAGE + '\n');
            process.exitCode = 2;
    }
};

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/security/safeOperationalEvidence.mjs');
if (invokedDirectly) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        process.stderr.write(`ERROR: ${err.message}\n`);
        process.exitCode = 1;
    }
}
