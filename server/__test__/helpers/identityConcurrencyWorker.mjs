/**
 * identityConcurrencyWorker.mjs — CHP-IDDB-02B-D-A.
 *
 * Proceso Node INDEPENDIENTE que escribe en el espejo de identidad. Existe
 * porque el escenario que hay que demostrar —api_1 y api_2 escribiendo la
 * misma SQLite— es de DOS PROCESOS: unos hilos dentro del mismo proceso
 * compartirían la conexión y no probarían nada del locking real entre
 * procesos.
 *
 * Abre la base por el MISMO resolutor y con los MISMOS pragmas que el runtime
 * (`getIdentityDb`), y espeja por la MISMA función que el hook
 * (`mirrorSnapshotV2`). No hay una copia del camino de escritura para tests.
 *
 * Emite UNA línea JSON por stdout con el resultado. Nunca escribe en rutas
 * productivas: la ruta llega por `--db` y el driver siempre pasa un temporal.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt = null) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const DB = arg('db');
const LABEL = arg('label');                 // writer-A | writer-B
const MODE = arg('mode');
const BARRIER = arg('barrier');
const START_AT = Number(arg('start-at', '0'));
const CORPUS = arg('corpus');               // fichero JSON con la instantánea
const DOMAIN = arg('domain', 'users');
const SOURCE_HASH = arg('source-hash', 'sv-1');
const SOURCE_SEQ = Number(arg('source-seq', '1'));
const HOLD_MS = Number(arg('hold-ms', '0'));

process.env.IDENTITY_DB = DB;
process.env.IDENTITY_SQLITE_ENABLED = '1';
process.env.IDENTITY_DUAL_WRITE = '1';
process.env.HOSTNAME = LABEL;               // instancia de runtime simulada

const { getIdentityDb } = await import('../../db/identityDb.js');
const { mirrorSnapshotV2 } = await import('../../db/identityShadowV2.js');
const { composeWriterId } = await import('../../db/identityWriteSurface.mjs');
const { runtimeInstanceId } = await import('../../healthHandler.js');

/**
 * En POSIX, stdout hacia un pipe es ASÍNCRONO: un `process.exit()` inmediato
 * después de escribir se lleva por delante la línea sin vaciar. Eso convertía
 * un fallo del worker en un proceso mudo, que es la peor forma de fallar.
 * Se espera al vaciado antes de terminar.
 */
const emit = (o) => new Promise(resolve => process.stdout.write(
    JSON.stringify({ label: LABEL, mode: MODE, ...o }) + '\n', resolve));
const writerId = composeWriterId({ runtimeInstance: runtimeInstanceId(), callSite: 'server.writeJSON' });

/** Alineación real de los dos procesos: fichero de listo + instante común. */
function barrier() {
    if (!BARRIER) return;
    fs.writeFileSync(path.join(BARRIER, `${LABEL}.ready`), '1');
    const deadline = Date.now() + 30000;
    for (;;) {
        const n = fs.readdirSync(BARRIER).filter(f => f.endsWith('.ready')).length;
        if (n >= 2) break;
        if (Date.now() > deadline) throw new Error('BARRIER_TIMEOUT');
    }
    while (Date.now() < START_AT) { /* alineación fina: giro corto y acotado */ }
}

const records = CORPUS ? JSON.parse(fs.readFileSync(CORPUS, 'utf8')) : [];

let busyEvents = 0;
const t0 = Date.now();

try {
    // La APERTURA entra en el try: abrir la base también compite por locks, y
    // un fallo ahí debe reportarse como resultado, no reventar el proceso.
    const db = getIdentityDb();
    if (MODE === 'open-only') {
        // Solo abrir. Cubre la contención de la propia apertura, que es donde
        // `journal_mode = WAL` puede chocar con el otro proceso.
        await emit({ ok: true, journalMode: String(db.pragma('journal_mode', { simple: true })),
            busyTimeout: Number(db.pragma('busy_timeout', { simple: true })),
            elapsedMs: Date.now() - t0 });
    } else if (MODE === 'hold-lock') {
        // Mantiene una transacción de escritura abierta para que el otro
        // proceso encuentre la base ocupada de verdad.
        barrier();
        db.exec('BEGIN IMMEDIATE');
        db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok,detail)
                    VALUES (?,?,?,?,?)`).run('users', 0, 0, 1, 'lock-holder');
        fs.writeFileSync(path.join(BARRIER, 'LOCK_HELD'), String(Date.now()));
        const until = Date.now() + HOLD_MS;
        while (Date.now() < until) { /* retiene el lock el tiempo pedido */ }
        db.exec('COMMIT');
        await emit({ ok: true, heldMs: HOLD_MS, elapsedMs: Date.now() - t0 });
    } else if (MODE === 'crash-mid-tx') {
        // Fault injection: transacción abierta, filas dentro, y el proceso
        // muere sin COMMIT. El driver lo mata desde fuera.
        barrier();
        db.exec('BEGIN IMMEDIATE');
        const at = new Date().toISOString();
        for (const r of records.slice(0, 5)) {
            db.prepare(`INSERT INTO users(canonical_id,legacy_identity_hash,email_norm,email_raw,
                        nombre_completo,nombre_usuario,roles_json,global_role,status,credential_excluded,
                        provenance,source_version,raw_json,created_at,updated_at,deleted_at)
                        VALUES (?,?,?,?,?,?,?,?,?,1,'crash-test',?,'{}',?,?,NULL)`)
                .run(r.id, 'h_' + r.id, r.email, r.email, r.nombre_completo ?? null, null,
                    '["lector"]', 'lector', 'active', SOURCE_HASH, at, at);
        }
        fs.writeFileSync(path.join(BARRIER, 'IN_TX'), String(process.pid));
        await emit({ ok: true, phase: 'in-transaction', pid: process.pid });
        // Se queda dentro de la transacción hasta que lo maten.
        for (;;) { /* espera la muerte */ }
    } else {
        // Camino normal: espejar una instantánea, igual que el hook.
        barrier();
        const report = mirrorSnapshotV2(db, {
            domain: DOMAIN, records,
            sourceVersion: { hash: SOURCE_HASH, seq: SOURCE_SEQ },
            writerId, at: new Date().toISOString(),
        });
        await emit({ ok: true, writerId, status: report.status, classification: report.classification,
            attempted: report.attempted, applied: report.applied, noop: report.noop,
            failed: report.failed, rejected: report.rejected.length,
            elapsedMs: Date.now() - t0, busyEvents });
    }
} catch (e) {
    const busy = /SQLITE_BUSY|database is locked/i.test(e.message);
    await emit({ ok: false, error: e.message, sqliteBusy: busy, code: e.code ?? null,
        stack: String(e.stack ?? '').split('\n')[1]?.trim() ?? null,
        elapsedMs: Date.now() - t0 });
    process.exitCode = 1;
}
// Salida natural: nada de process.exit(), que truncaría stdout.
