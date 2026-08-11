/**
 * identityTwoProcessConcurrency.test.mjs — CHP-IDDB-02B-D-A.
 *
 * Demuestra que identity.db aguanta DOS escritores productivos simultáneos,
 * que es la precondición para encender el shadow-write también en api_2.
 *
 * Todo ocurre entre PROCESOS Node independientes contra la MISMA base: usar
 * hilos o dos conexiones dentro de un proceso no probaría nada del locking
 * real, que es justo lo que hay que demostrar.
 *
 * Cubre:
 *   [1] misma operación lógica en paralelo  → idempotencia entre instancias
 *   [2] operaciones distintas en paralelo   → ninguna pisa a la otra
 *   [3] proyección completa concurrente     → el peor caso realista (247)
 *   [4] contención real de locking          → espera ACOTADA, nunca cuelgue
 *   [5] muerte del proceso dentro de una tx → atomicidad, jamás parcial
 *   [6] fallo del espejo con JSON confirmado→ FAILED_RECONCILABLE, sin mentir
 *
 * Corre 100% aislado en ficheros temporales: NUNCA toca data/, data-critical/
 * ni ninguna ruta productiva.
 *
 *   node server/__test__/identityTwoProcessConcurrency.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { mirrorSnapshotV2 } from '../db/identityShadowV2.js';
import { composeWriterId, parseWriterId } from '../db/identityWriteSurface.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, 'helpers', 'identityConcurrencyWorker.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02bda_conc_'));
const F = (n) => path.join(tmpdir, n);

// ── Corpus con la forma de producción: 247 reales + 400 sintéticos ────────
const realUsers = Array.from({ length: 247 }, (_, i) => ({
    id: `usr_${String(i + 1).padStart(4, '0')}`,
    email: `lector${i + 1}@colegio.test`,
    nombre_completo: `Lector ${i + 1}`,
    roles: [i === 0 ? 'administrador' : i < 5 ? 'mediador' : 'lector'],
    accountStatus: 'active',
}));
const syntheticUsers = Array.from({ length: 400 }, (_, i) => ({
    id: `load_${String(i + 1).padStart(4, '0')}`,
    email: `load${i + 1}@loadtest.test`,
    roles: ['lector'], accountStatus: 'active', _loadtest_marker: true,
}));
const FULL_CORPUS = [...realUsers, ...syntheticUsers];
const INSTITUTIONS = Array.from({ length: 4 }, (_, i) => ({
    id: `org_${i + 1}`, name: `Institucion ${i + 1}`,
}));

const freshDb = (name) => {
    const p = F(name);
    const db = new Database(p);
    // La base nace en WAL, como la productiva: si se dejara en modo `delete`,
    // los dos workers competirían por CAMBIAR el journal mode al abrir, que es
    // una carrera que en producción no existe y que taparía la que sí importa.
    db.pragma('journal_mode = WAL');
    runMigrations(db, () => {});
    db.close();
    return p;
};

/** Lanza los dos procesos con barrera y devuelve sus resultados JSON. */
function race(dbPath, specs, { startDelayMs = 700 } = {}) {
    const barrier = fs.mkdtempSync(path.join(tmpdir, 'barrier_'));
    const startAt = Date.now() + startDelayMs;
    const runs = specs.map(spec => new Promise((resolve) => {
        const args = [WORKER, '--db', dbPath, '--barrier', barrier,
            '--start-at', String(startAt)];
        for (const [k, v] of Object.entries(spec)) { args.push(`--${k}`, String(v)); }
        const ch = spawn(process.execPath, args, { cwd: path.resolve(__dirname, '..', '..') });
        let out = '', err = '';
        ch.stdout.on('data', d => { out += d; });
        ch.stderr.on('data', d => { err += d; });
        let spawnError = null;
        ch.on('error', e => { spawnError = e.message; });
        ch.on('close', (code, signal) => {
            let parsed = null;
            const line = out.trim().split('\n').filter(Boolean).pop();
            try { parsed = line ? JSON.parse(line) : null; } catch { /* se reporta crudo */ }
            resolve({ code, signal, spawnError, parsed, raw: out, err, child: ch });
        });
    }));
    return { barrier, done: Promise.all(runs) };
}

/** Un fallo de concurrencia sin el stderr del proceso no es diagnosticable. */
const dumpWorkers = (res) => {
    for (const r of res) {
        if (r.code !== 0 || r.signal || r.spawnError) {
            console.log(`    [${r.parsed?.label ?? '?'}] code=${r.code} signal=${r.signal} `
                + `spawnError=${r.spawnError} stdout=${JSON.stringify(r.raw)}`);
        }
        if (r.err?.trim()) console.log(`    [${r.parsed?.label ?? '?'}] stderr: ${r.err.trim()}`);
        if (r.parsed && r.parsed.failed > 0) {
            console.log(`    [${r.parsed.label}] informe: ${JSON.stringify(r.parsed)}`);
        }
    }
};

const openRO = (p) => new Database(p, { readonly: true });
const integrity = (p) => {
    const db = openRO(p);
    const r = { quick: db.pragma('quick_check', { simple: true }),
        fk: db.pragma('foreign_key_check').length,
        users: db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c,
        ops: db.prepare(`SELECT COUNT(*) c FROM shadow_operations`).get().c,
        failed: db.prepare(`SELECT COUNT(*) c FROM shadow_operations
                            WHERE status='FAILED_RECONCILABLE'`).get().c,
        pending: db.prepare(`SELECT COUNT(*) c FROM shadow_operations
                             WHERE status='PENDING'`).get().c,
        writers: db.prepare(`SELECT DISTINCT writer_id w FROM shadow_operations`).all().map(r => r.w),
    };
    db.close();
    return r;
};

try {
    // ── [0] La APERTURA concurrente también compite por locks ────────────
    console.log('\n[0] dos procesos abriendo la misma base a la vez');
    {
        // Base deliberadamente NO-WAL: obliga a los dos procesos a intentar el
        // cambio de journal mode a la vez. Ese cambio exige lock exclusivo y no
        // respeta busy_timeout, así que sin el reintento acotado uno de los dos
        // moría en la apertura, antes de llegar al espejo.
        const p = F('open-race.db');
        const seed = new Database(p);
        runMigrations(seed, () => {});
        seed.pragma('journal_mode = delete');
        seed.close();
        const { done } = race(p, [
            { label: 'writer-A', mode: 'open-only' },
            { label: 'writer-B', mode: 'open-only' },
        ]);
        const res = await done;
        dumpWorkers(res);
        ok('ambas aperturas concurrentes tienen éxito',
            res.every(r => r.code === 0 && r.parsed?.ok === true),
            JSON.stringify(res.map(r => r.parsed ?? r.err.slice(0, 200))));
        ok('las dos acaban en WAL',
            res.every(r => String(r.parsed?.journalMode).toLowerCase() === 'wal'),
            res.map(r => r.parsed?.journalMode).join(','));
        ok('con busy_timeout ya fijado',
            res.every(r => r.parsed?.busyTimeout === 5000),
            res.map(r => r.parsed?.busyTimeout).join(','));
    }

    // ── [1] MISMA operación lógica, en paralelo ──────────────────────────
    console.log('\n[1] misma operación lógica desde dos procesos');
    {
        const db = freshDb('same-op.db');
        const corpus = F('corpus-real.json');
        fs.writeFileSync(corpus, JSON.stringify(realUsers));
        const { done } = race(db, [
            { label: 'writer-A', mode: 'mirror', corpus, domain: 'users',
              'source-hash': 'sv-same', 'source-seq': 1 },
            { label: 'writer-B', mode: 'mirror', corpus, domain: 'users',
              'source-hash': 'sv-same', 'source-seq': 1 },
        ]);
        const res = await done;
        dumpWorkers(res);
        const [a, b] = res.map(r => r.parsed);
        ok('ambos procesos terminan sin error',
            res.every(r => r.code === 0 && r.parsed?.ok === true),
            JSON.stringify(res.map(r => ({ code: r.code, err: r.err.slice(0, 300) }))));
        const busy = res.some(r => /SQLITE_BUSY|database is locked/i.test(r.err + r.raw));
        ok('NINGÚN SQLITE_BUSY sin manejar', !busy, res.map(r => r.err).join(' | '));
        const st = integrity(db);
        ok('247 identidades finales (no 494)', st.users === 247, String(st.users));
        ok('cada operación se aplicó UNA sola vez',
            (a?.applied + b?.applied) === 247, `${a?.applied} + ${b?.applied}`);
        ok('la otra corrida quedó en NOOP idempotente',
            (a?.noop + b?.noop) === 247, `${a?.noop} + ${b?.noop}`);
        ok('sin duplicados de operación', st.ops === 247, String(st.ops));
        ok('sin operaciones colgadas en PENDING', st.pending === 0, String(st.pending));
        ok('sin FAILED_RECONCILABLE', st.failed === 0, String(st.failed));
        ok('quick_check=ok y FK=0', st.quick === 'ok' && st.fk === 0, `${st.quick}/${st.fk}`);
        // La atribución nombra a quien APLICÓ. El que llega después y encuentra
        // la operación hecha se limita a NOOP: no puede reescribir el escritor,
        // o la traza diría que la aplicó una instancia que no tocó esa fila.
        const applier = (a?.applied === 247 ? a : b)?.label;
        ok('el escritor atribuido es exactamente el que aplicó',
            st.writers.length === 1
            && parseWriterId(st.writers[0]).runtimeInstance === applier
            && parseWriterId(st.writers[0]).callSite === 'server.writeJSON',
            `${st.writers.join(',')} — aplicó ${applier}`);
        console.log(`    A: applied=${a?.applied} noop=${a?.noop} ${a?.elapsedMs}ms | `
            + `B: applied=${b?.applied} noop=${b?.noop} ${b?.elapsedMs}ms`);
    }

    // ── [2] Operaciones DISTINTAS, en paralelo ───────────────────────────
    console.log('\n[2] operaciones distintas sobre entidades distintas');
    {
        const db = freshDb('distinct.db');
        const cUsers = F('c-users.json'), cInst = F('c-inst.json');
        fs.writeFileSync(cUsers, JSON.stringify(realUsers));
        fs.writeFileSync(cInst, JSON.stringify(INSTITUTIONS));
        const { done } = race(db, [
            { label: 'writer-A', mode: 'mirror', corpus: cUsers, domain: 'users',
              'source-hash': 'sv-u', 'source-seq': 1 },
            { label: 'writer-B', mode: 'mirror', corpus: cInst, domain: 'institutions',
              'source-hash': 'sv-i', 'source-seq': 1 },
        ]);
        const res = await done;
        dumpWorkers(res);
        const [a, b] = res.map(r => r.parsed);
        ok('ambos procesos terminan sin error',
            res.every(r => r.code === 0 && r.parsed?.ok === true),
            JSON.stringify(res.map(r => r.err.slice(0, 300))));
        ok('las dos operaciones se aplicaron', a?.applied === 247 && b?.applied === 4,
            `${a?.applied} / ${b?.applied}`);
        const d = openRO(db);
        ok('ninguna sobrescribió a la otra',
            d.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c === 247
            && d.prepare(`SELECT COUNT(*) c FROM institutions`).get().c === 4);
        ok('las dos transacciones quedaron completas',
            d.prepare(`SELECT COUNT(*) c FROM shadow_operations WHERE status='PENDING'`).get().c === 0);
        d.close();
        const st = integrity(db);
        ok('quick_check=ok y FK=0', st.quick === 'ok' && st.fk === 0);
        ok('cada dominio conserva su escritor', st.writers.length === 2, st.writers.join(','));
    }

    // ── [3] Proyección COMPLETA concurrente (peor caso realista) ─────────
    console.log('\n[3] proyección completa de 647 registros desde ambos procesos');
    {
        const db = freshDb('batch.db');
        const corpus = F('corpus-full.json');
        fs.writeFileSync(corpus, JSON.stringify(FULL_CORPUS));
        const t0 = Date.now();
        const { done } = race(db, [
            { label: 'writer-A', mode: 'mirror', corpus, domain: 'users',
              'source-hash': 'sv-batch', 'source-seq': 1 },
            { label: 'writer-B', mode: 'mirror', corpus, domain: 'users',
              'source-hash': 'sv-batch', 'source-seq': 1 },
        ]);
        const res = await done;
        dumpWorkers(res);
        const wall = Date.now() - t0;
        const [a, b] = res.map(r => r.parsed);
        ok('ambos procesos terminan sin error',
            res.every(r => r.code === 0 && r.parsed?.ok === true),
            JSON.stringify(res.map(r => r.err.slice(0, 300))));
        const st = integrity(db);
        ok('247 identidades finales', st.users === 247, String(st.users));
        ok('los 400 sintéticos quedan excluidos',
            a?.rejected === 400 && b?.rejected === 400, `${a?.rejected}/${b?.rejected}`);
        const d = openRO(db);
        ok('ningún sintético entró',
            d.prepare(`SELECT COUNT(*) c FROM users WHERE canonical_id LIKE 'load_%'`).get().c === 0);
        ok('0 desactivaciones inesperadas',
            d.prepare(`SELECT COUNT(*) c FROM shadow_operations
                       WHERE operation_type='deactivate'`).get().c === 0);
        ok('0 identidades borradas lógicamente',
            d.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NOT NULL`).get().c === 0);
        const wal = fs.existsSync(db + '-wal') ? fs.statSync(db + '-wal').size : 0;
        d.close();
        ok('idempotencia determinística', (a?.applied + b?.applied) === 247
            && (a?.noop + b?.noop) === 247, `${a?.applied}+${b?.applied} / ${a?.noop}+${b?.noop}`);
        ok('sin duplicados ni FK rotas', st.ops === 247 && st.fk === 0 && st.quick === 'ok');
        ok('sin FAILED_RECONCILABLE', st.failed === 0);
        console.log(`    wall=${wall}ms  A=${a?.elapsedMs}ms  B=${b?.elapsedMs}ms  WAL=${wal}B`);
    }

    // ── [4] Contención real de locking ───────────────────────────────────
    console.log('\n[4] contención: una tx abierta mientras el otro escribe');
    {
        const db = freshDb('lock.db');
        const corpus = F('corpus-real.json');
        const HOLD = 2500;                       // < busy_timeout (5000)
        const { done } = race(db, [
            { label: 'writer-A', mode: 'hold-lock', 'hold-ms': HOLD },
            { label: 'writer-B', mode: 'mirror', corpus, domain: 'users',
              'source-hash': 'sv-lock', 'source-seq': 1 },
        ]);
        const res = await done;
        dumpWorkers(res);
        const b = res.find(r => r.parsed?.label === 'writer-B')?.parsed;
        ok('el escritor bloqueado NO se cuelga ni revienta',
            res.every(r => r.code === 0), JSON.stringify(res.map(r => r.err.slice(0, 400))));
        ok('el segundo escritor completó su operación',
            b?.ok === true && b?.applied === 247, JSON.stringify(b));
        ok('la espera fue ACOTADA y coherente con el lock',
            b?.elapsedMs >= HOLD * 0.5 && b?.elapsedMs < 5000 + 3000,
            `esperó ${b?.elapsedMs}ms con lock de ${HOLD}ms`);
        const st = integrity(db);
        ok('sin corrupción tras la contención',
            st.quick === 'ok' && st.fk === 0 && st.users === 247 && st.pending === 0);
        console.log(`    lock=${HOLD}ms → el escritor B tardó ${b?.elapsedMs}ms`);
    }

    // ── [5] Muerte del proceso DENTRO de una transacción ─────────────────
    console.log('\n[5] atomicidad ante muerte del proceso a mitad de transacción');
    {
        const dbPath = freshDb('crash.db');
        const corpus = F('corpus-real.json');
        const { barrier, done } = race(dbPath, [
            { label: 'writer-A', mode: 'crash-mid-tx', corpus },
            { label: 'writer-B', mode: 'hold-lock', 'hold-ms': 1 },
        ]);
        // Espera a que A esté DENTRO de la transacción y lo mata en seco. Si A
        // muriera antes de llegar ahí, `done` resuelve y no tiene sentido
        // seguir esperando un marcador que ya no va a escribir nadie.
        const marker = path.join(barrier, 'IN_TX');
        let finished = null;
        done.then(r => { finished = r; });
        const deadline = Date.now() + 20000;
        while (!fs.existsSync(marker) && !finished && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 20));
        }
        const reached = fs.existsSync(marker);
        if (!reached) dumpWorkers(finished ?? []);
        ok('el proceso A llegó a estar dentro de la transacción', reached);
        if (reached) {
            const victim = Number(fs.readFileSync(marker, 'utf8'));
            try { process.kill(victim, 'SIGKILL'); } catch { /* ya murió */ }
        }
        await done;

        const st = integrity(dbPath);
        ok('SQLite queda consistente tras la muerte',
            st.quick === 'ok' && st.fk === 0, `${st.quick}/${st.fk}`);
        ok('la operación quedó AUSENTE, nunca parcial (0 de 5 filas)',
            st.users === 0, `${st.users} identidades sobrevivieron a la tx abortada`);
        ok('no quedó ninguna operación en PENDING', st.pending === 0, String(st.pending));

        // Y el segundo escritor sigue plenamente funcional sobre esa base.
        const corpusFile = F('corpus-real.json');
        const after = race(dbPath, [
            { label: 'writer-B', mode: 'mirror', corpus: corpusFile, domain: 'users',
              'source-hash': 'sv-after-crash', 'source-seq': 2 },
            { label: 'writer-C', mode: 'hold-lock', 'hold-ms': 1 },
        ]);
        const resAfter = await after.done;
        const bAfter = resAfter.find(r => r.parsed?.label === 'writer-B')?.parsed;
        ok('el otro escritor sigue funcionando sobre la base recuperada',
            bAfter?.ok === true && bAfter?.applied === 247, JSON.stringify(bAfter));
        const st2 = integrity(dbPath);
        ok('la base converge al padrón esperado',
            st2.users === 247 && st2.quick === 'ok' && st2.fk === 0 && st2.failed === 0);
    }

    // ── [6] Semántica de fallo del espejo con JSON confirmado ────────────
    console.log('\n[6] JSON confirmado + espejo caído → FAILED_RECONCILABLE');
    {
        const p = freshDb('failure.db');
        const canonical = F('canonical_users.json');
        fs.writeFileSync(canonical, JSON.stringify(realUsers, null, 2));
        const canonicalBefore = fs.readFileSync(canonical, 'utf8');

        const db = new Database(p);
        db.pragma('foreign_keys = ON');
        // Inyección de fallo: la tabla destino desaparece bajo los pies del
        // espejo. El upsert revienta DENTRO de la transacción.
        db.exec(`ALTER TABLE users RENAME TO users_hidden`);
        const writerId = composeWriterId({ runtimeInstance: 'writer-A', callSite: 'server.writeJSON' });
        const report = mirrorSnapshotV2(db, { domain: 'users', records: realUsers,
            sourceVersion: { hash: 'sv-fail', seq: 1 }, writerId, at: '2026-01-01T00:00:00Z' });

        ok('el espejo informa FAILED_RECONCILABLE sin lanzar',
            report.status === 'FAILED_RECONCILABLE', report.status);
        ok('la clasificación es explícita',
            report.classification === 'MIRROR_WRITE_FAILED', String(report.classification));
        ok('el JSON canónico NO se revierte',
            fs.readFileSync(canonical, 'utf8') === canonicalBefore);
        const failedRows = db.prepare(`SELECT operation_id, writer_id, error_classification
                                       FROM shadow_operations WHERE status='FAILED_RECONCILABLE'`).all();
        ok('queda registrado EXACTAMENTE una vez', failedRows.length === 1, String(failedRows.length));
        ok('con la atribución correcta del escritor',
            failedRows[0]?.writer_id === writerId, String(failedRows[0]?.writer_id));
        ok('sin operaciones a medias en PENDING',
            db.prepare(`SELECT COUNT(*) c FROM shadow_operations WHERE status='PENDING'`).get().c === 0);
        const state = db.prepare(`SELECT * FROM shadow_state WHERE domain='users'`).get();
        ok('el fallo cuenta pero NO avanza la versión del dominio',
            state.failed_count === 1 && state.last_source_version !== 'sv-fail',
            JSON.stringify(state));
        ok('la telemetría deja el hueco visible para el reconciliador',
            db.prepare(`SELECT COUNT(*) c FROM shadow_operations
                        WHERE status='FAILED_RECONCILABLE'`).get().c === 1);

        // Reparación SOLO en el fixture, por el camino diseñado para ello.
        db.exec(`ALTER TABLE users_hidden RENAME TO users`);
        const repair = mirrorSnapshotV2(db, { domain: 'users', records: realUsers,
            sourceVersion: { hash: 'sv-fail-2', seq: 2 }, writerId, at: '2026-01-01T00:01:00Z' });
        ok('tras reparar, el espejo converge', repair.status === 'APPLIED' && repair.applied === 247,
            `${repair.status}/${repair.applied}`);
        ok('la evidencia del fallo se conserva',
            db.prepare(`SELECT COUNT(*) c FROM shadow_operations
                        WHERE status='FAILED_RECONCILABLE'`).get().c === 1);
        ok('quick_check=ok y FK=0', db.pragma('quick_check', { simple: true }) === 'ok'
            && db.pragma('foreign_key_check').length === 0);
        db.close();
    }
    // ── [7] Reespejar no puede dejar operaciones colgadas en PENDING ─────
    console.log('\n[7] reespejar el mismo padrón no deja operaciones en vuelo');
    {
        const p = freshDb('pending.db');
        const db = new Database(p);
        db.pragma('foreign_keys = ON');
        const w = composeWriterId({ runtimeInstance: 'writer-A', callSite: 'server.writeJSON' });
        const groups = [{ id: 'g1', organizationId: 'org_1', type: 'course', name: 'Primero A',
            studentIds: realUsers.slice(0, 30).map(u => u.id), mediatorIds: [realUsers[1].id] }];
        const mirror = (domain, records, hash, seq) => mirrorSnapshotV2(db, { domain, records,
            sourceVersion: { hash, seq }, writerId: w, at: '2026-01-01T00:00:00Z' });
        mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        mirror('users', realUsers, 'sv-u', 1);
        const first = mirror('groups', groups, 'sv-g', 1);
        const pendingAfterFirst = db.prepare(
            `SELECT COUNT(*) c FROM shadow_operations WHERE status='PENDING'`).get().c;
        ok('el primer espejo aplica grupo y membresías',
            first.status === 'APPLIED' && first.applied === 32, `${first.status}/${first.applied}`);
        ok('y no deja nada en PENDING', pendingAfterFirst === 0, String(pendingAfterFirst));

        // Misma instantánea otra vez: todo debe reconocerse como ya hecho.
        const second = mirror('groups', groups, 'sv-g', 1);
        const pendingAfterSecond = db.prepare(
            `SELECT COUNT(*) c FROM shadow_operations WHERE status='PENDING'`).get().c;
        ok('el reespejo es íntegramente idempotente',
            second.applied === 0 && second.noop === 32, `${second.applied}/${second.noop}`);
        ok('y TAMPOCO deja operaciones colgadas en PENDING',
            pendingAfterSecond === 0, `${pendingAfterSecond} operaciones en vuelo`);
        ok('las membresías siguen intactas',
            db.prepare(`SELECT COUNT(*) c FROM memberships`).get().c === 31,
            String(db.prepare(`SELECT COUNT(*) c FROM memberships`).get().c));
        ok('el contador de intentos sí refleja las dos pasadas',
            db.prepare(`SELECT MIN(attempt_count) m FROM shadow_operations
                        WHERE entity_type='membership'`).get().m === 2);
        ok('quick_check=ok y FK=0', db.pragma('quick_check', { simple: true }) === 'ok'
            && db.pragma('foreign_key_check').length === 0);
        db.close();
    }
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* Windows retiene el handle */ }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
