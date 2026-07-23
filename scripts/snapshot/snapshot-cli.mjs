#!/usr/bin/env node
/**
 * snapshot-cli.mjs — CHP-BACKUP-01-SNAPSHOT-01 · CLI segura.
 *
 * NO tiene rutas productivas por defecto: data-root, data-critical-root y dest
 * son OBLIGATORIOS. Sin ellos → usage + exit 2. No ejecuta nada en producción.
 *
 * Uso:
 *   node scripts/snapshot/snapshot-cli.mjs --data-root <dir> --data-critical-root <dir> \
 *        --dest <dir> [--dry-run] [--id <snapshot_id>] [--max-json-retries N]
 *   node scripts/snapshot/snapshot-cli.mjs verify --snapshot <dir>
 *
 * Exit codes: 0 ok · 2 error de uso/validación · 3 fallo de snapshot/verify.
 */
import { createSnapshot, dryRunPlan, verifySnapshot, SnapshotError } from './snapshotCore.mjs';

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) { out[key] = true; }
            else { out[key] = next; i++; }
        } else {
            out._.push(a);
        }
    }
    return out;
}

function usage(msg) {
    if (msg) console.error(`error: ${msg}\n`);
    console.error(`snapshot-cli — generador consistente de estado estructurado (local only)

  crear (dry-run por defecto seguro requiere --run para ejecutar):
    --data-root <dir>           (obligatorio) raíz data/
    --data-critical-root <dir>  (obligatorio) raíz data-critical/
    --dest <dir>                (obligatorio) destino del snapshot
    --dry-run                   plan sin escrituras (recomendado primero)
    --run                       ejecutar la creación real (local)
    --id <snapshot_id>          id explícito (default: timestamp UTC)
    --max-json-retries <N>      reintentos de cohorte JSON (1..20, default 3)

  verificar:
    verify --snapshot <dir>     valida un snapshot ya creado (sin fuentes)

  NO usa rutas productivas por defecto. NO se conecta a producción.`);
    return 2;
}

async function main() {
    const argv = process.argv.slice(2);
    const args = parseArgs(argv);

    // Subcomando verify
    if (args._[0] === 'verify') {
        if (!args.snapshot || args.snapshot === true) return usage('verify requiere --snapshot <dir>');
        const r = verifySnapshot(String(args.snapshot), console.log);
        if (!r.ok) { console.error('VERIFY FAIL:', r.errors.join('; ')); return 3; }
        console.log(`VERIFY OK — ${r.checked}/${r.total} activos, perms=${r.permCheck}`);
        return 0;
    }

    // Crear
    const dataRoot = args['data-root'];
    const dataCriticalRoot = args['data-critical-root'];
    const dest = args.dest;
    if (!dataRoot || dataRoot === true) return usage('--data-root obligatorio');
    if (!dataCriticalRoot || dataCriticalRoot === true) return usage('--data-critical-root obligatorio');
    if (!dest || dest === true) return usage('--dest obligatorio');

    const opts = {
        dataRoot: String(dataRoot),
        dataCriticalRoot: String(dataCriticalRoot),
        dest: String(dest),
        log: console.log,
    };
    if (args.id && args.id !== true) opts.snapshotId = String(args.id);
    if (args['max-json-retries'] && args['max-json-retries'] !== true) {
        opts.maxJsonRetries = Number.parseInt(String(args['max-json-retries']), 10);
    }

    if (args['dry-run'] || !args.run) {
        if (!args['dry-run'] && !args.run) {
            console.error('nota: sin --run se ejecuta dry-run (seguro). Usa --run para crear el snapshot real.\n');
        }
        dryRunPlan(opts, console.log);
        return 0;
    }

    const r = await createSnapshot(opts);
    console.log(`OK snapshot=${r.snapshotId} assets=${r.assets} dir=${r.dir}`);
    return 0;
}

main()
    .then(code => process.exit(code ?? 0))
    .catch(err => {
        if (err instanceof SnapshotError) { console.error(`SNAPSHOT ERROR ${err.code}: ${err.message}`); process.exit(3); }
        console.error('UNEXPECTED ERROR:', err?.message || err);
        process.exit(3);
    });
