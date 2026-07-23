/**
 * snapshotCore.test.mjs — CHP-BACKUP-01-SNAPSHOT-01.
 *
 * Fixtures 100% sintéticos en mkdtemp. Sin producción, red, SSH ni credenciales.
 * Cubre los 22 casos exigidos. Nunca imprime contenido de fixtures.
 *
 *   node scripts/snapshot/__tests__/snapshotCore.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
    createSnapshot, verifySnapshot, dryRunPlan, validateRootsAndDest,
    discoverAssets, _openSourceReadonly, SnapshotError,
} from '../snapshotCore.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const silent = () => {};

// ── Fixture builder: raíces data/ + data-critical/ sintéticas ───────────────
function makeSqlite(p, rows = 3) {
    const db = new Database(p);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < rows; i++) ins.run(`row-${i}`);
    db.close();
}
function buildFixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'snaptest_'));
    const dataRoot = path.join(base, 'data');
    const dcRoot = path.join(base, 'data-critical');
    const dest = path.join(base, 'snapshots');
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.mkdirSync(dcRoot, { recursive: true });
    // REQUIRED
    fs.writeFileSync(path.join(dcRoot, 'usuarios_colegios_oro.json'), JSON.stringify([{ id: 'u1' }]));
    makeSqlite(path.join(dcRoot, 'events.db'), 5);
    fs.writeFileSync(path.join(dataRoot, 'groups_db.json'), JSON.stringify([{ id: 'g1' }]));
    fs.writeFileSync(path.join(dataRoot, 'content.json'), JSON.stringify([{ id: 'c1' }]));
    fs.writeFileSync(path.join(dataRoot, 'access_db.json'), JSON.stringify([]));
    makeSqlite(path.join(dataRoot, 'progress.db'), 4);
    // REQUIRED_IF_PRESENT (algunos)
    fs.writeFileSync(path.join(dataRoot, 'leo_memory_db.json'), JSON.stringify({ sessions: [] }));
    fs.writeFileSync(path.join(dataRoot, 'analytics_db.json'), JSON.stringify([{ e: 1 }]));
    fs.writeFileSync(path.join(dataRoot, 'playback_events.log'),
        JSON.stringify({ event: 'x', userId: 'u1' }) + '\n' + JSON.stringify({ event: 'y', userId: 'u1' }) + '\n');
    // Exclusiones que NO deben copiarse (residuos operativos, no dbs reales)
    fs.writeFileSync(path.join(dcRoot, 'insights.db'), 'x');
    fs.writeFileSync(path.join(dcRoot, 'identity.db'), 'x');
    fs.writeFileSync(path.join(dataRoot, 'users_db.json.bak.local'), '{}');
    return { base, dataRoot, dcRoot, dest, opts: (extra = {}) => ({ dataRoot, dataCriticalRoot: dcRoot, dest, log: silent, ...extra }) };
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function snapshotFingerprint(root) {
    // Compara datos AUTORITATIVOS; excluye sidecars efímeros -wal/-shm, que
    // SQLite puede tocar al abrir en read-only (limitación documentada por la
    // unidad). El .db principal y los JSON sí deben quedar idénticos.
    const acc = [];
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (/(-wal|-shm)$/.test(e.name)) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else { const st = fs.statSync(p); acc.push(`${path.relative(root, p)}|${st.size}|${st.mtimeMs}|${sha(p)}`); }
        }
    })(root);
    return acc.join('\n');
}

const fx = buildFixture();
try {
    // ── 1: snapshot completo válido ─────────────────────────────────────────
    console.log('\n[1] snapshot completo válido');
    const r1 = await createSnapshot(fx.opts({ snapshotId: 'snap-1' }));
    ok('1) createSnapshot publica dir', fs.existsSync(r1.dir) && fs.existsSync(path.join(r1.dir, 'COMPLETE')));
    ok('1b) manifiesto presente + status COMPLETE',
        JSON.parse(fs.readFileSync(path.join(r1.dir, 'manifest.json'), 'utf8')).status === 'COMPLETE');
    ok('1c) NO copió exclusiones (insights/identity/bak) ni sidecars wal/shm',
        !fs.existsSync(path.join(r1.dir, 'data-critical', 'insights.db')) &&
        !fs.existsSync(path.join(r1.dir, 'data-critical', 'identity.db')) &&
        !fs.existsSync(path.join(r1.dir, 'data', 'users_db.json.bak.local')) &&
        !fs.existsSync(path.join(r1.dir, 'data-critical', 'events.db-wal')) &&
        !fs.existsSync(path.join(r1.dir, 'data-critical', 'events.db-shm')) &&
        !fs.existsSync(path.join(r1.dir, 'data', 'progress.db-wal')));

    // ── 2: verificación independiente exitosa ──────────────────────────────
    console.log('\n[2] verificación independiente');
    const v1 = verifySnapshot(r1.dir, silent);
    ok('2) verify OK sin acceso a fuentes', v1.ok === true && v1.errors.length === 0);

    // ── 3: SQLite WAL con writer concurrente y backup íntegro ──────────────
    console.log('\n[3] SQLite WAL + writer concurrente');
    {
        const fx3 = buildFixture();
        const dbPath = path.join(fx3.dcRoot, 'events.db');
        const writer = new Database(dbPath);
        writer.pragma('journal_mode = WAL');
        const ins = writer.prepare('INSERT INTO t (v) VALUES (?)');
        for (let i = 0; i < 200; i++) ins.run(`concurrent-${i}`); // writer activo antes del backup
        const r3 = await createSnapshot(fx3.opts({ snapshotId: 'snap-3' }));
        for (let i = 0; i < 50; i++) ins.run(`after-${i}`);       // sigue escribiendo después
        writer.close();
        const v3 = verifySnapshot(r3.dir, silent);
        ok('3) backup íntegro con writer concurrente', v3.ok === true);
        rmrf(fx3.base);
    }

    // ── 4: fuente SQLite abierta exclusivamente read-only ──────────────────
    console.log('\n[4] fuente sqlite read-only');
    {
        const src = _openSourceReadonly(path.join(fx.dcRoot, 'events.db'));
        let threw = false;
        try { src.exec('INSERT INTO t (v) VALUES (\'x\')'); } catch { threw = true; }
        src.close();
        ok('4) escribir en la conexión de fuente lanza (es read-only)', threw);
    }

    // ── 5: JSON estable → captura OK (implícito en 1). Confirmar attempts=1 ─
    console.log('\n[5] JSON estable');
    {
        const m = JSON.parse(fs.readFileSync(path.join(r1.dir, 'manifest.json'), 'utf8'));
        const groups = m.assets.find(a => a.name === 'groups_db');
        ok('5) cohorte JSON estable en 1 intento', groups && groups.json_capture_attempts === 1);
    }

    // ── 6: mutación JSON durante la captura → retry ────────────────────────
    console.log('\n[6] mutación JSON en captura → retry');
    {
        const fx6 = buildFixture();
        let mutated = 0;
        const r6 = await createSnapshot(fx6.opts({
            snapshotId: 'snap-6', maxJsonRetries: 5,
            _testHooks: {
                afterJsonCopy: () => {
                    if (mutated < 2) { // muta en los 2 primeros intentos, estable después
                        mutated++;
                        fs.writeFileSync(path.join(fx6.dataRoot, 'content.json'),
                            JSON.stringify([{ id: 'c1', n: mutated }]));
                    }
                },
            },
        }));
        const m6 = JSON.parse(fs.readFileSync(path.join(r6.dir, 'manifest.json'), 'utf8'));
        const content = m6.assets.find(a => a.name === 'content');
        ok('6) reintentó y finalmente publicó', content.json_capture_attempts >= 3 && verifySnapshot(r6.dir, silent).ok);
        rmrf(fx6.base);
    }

    // ── 7: JSON que nunca se estabiliza → fallo cerrado ────────────────────
    console.log('\n[7] JSON nunca estable → fallo cerrado');
    {
        const fx7 = buildFixture();
        let threw = null;
        try {
            await createSnapshot(fx7.opts({
                snapshotId: 'snap-7', maxJsonRetries: 3,
                _testHooks: { afterJsonCopy: (n) => fs.writeFileSync(path.join(fx7.dataRoot, 'content.json'), JSON.stringify([{ n }])) },
            }));
        } catch (e) { threw = e; }
        ok('7) falla cerrado sin publicar', threw instanceof SnapshotError && threw.code === 'JSON_COHORT_UNSTABLE');
        ok('7b) no quedó snapshot ni staging', !fs.existsSync(path.join(fx7.dest, 'snap-7')) &&
            !fs.existsSync(path.join(fx7.dest, '.staging', 'snap-7')));
        rmrf(fx7.base);
    }

    // ── 8: JSON malformado → fallo cerrado ─────────────────────────────────
    console.log('\n[8] JSON malformado → fallo');
    {
        const fx8 = buildFixture();
        fs.writeFileSync(path.join(fx8.dataRoot, 'content.json'), '{ malformed');
        let threw = null;
        try { await createSnapshot(fx8.opts({ snapshotId: 'snap-8' })); } catch (e) { threw = e; }
        ok('8) malformado estable → fallo cerrado', threw instanceof SnapshotError);
        ok('8b) sin publicar', !fs.existsSync(path.join(fx8.dest, 'snap-8')));
        rmrf(fx8.base);
    }

    // ── 9: REQUIRED ausente → fallo ────────────────────────────────────────
    console.log('\n[9] REQUIRED ausente → fallo');
    {
        const fx9 = buildFixture();
        fs.rmSync(path.join(fx9.dataRoot, 'groups_db.json'));
        let threw = null;
        try { await createSnapshot(fx9.opts({ snapshotId: 'snap-9' })); } catch (e) { threw = e; }
        ok('9) REQUIRED ausente → REQUIRED_ASSET_MISSING', threw?.code === 'REQUIRED_ASSET_MISSING');
        rmrf(fx9.base);
    }

    // ── 10: REQUIRED_IF_PRESENT ausente → documentado (absent_optional) ────
    console.log('\n[10] REQUIRED_IF_PRESENT ausente → documentado');
    {
        const fx10 = buildFixture();
        fs.rmSync(path.join(fx10.dataRoot, 'leo_memory_db.json'));
        const r10 = await createSnapshot(fx10.opts({ snapshotId: 'snap-10' }));
        const m10 = JSON.parse(fs.readFileSync(path.join(r10.dir, 'manifest.json'), 'utf8'));
        ok('10) ausente opcional registrado en manifiesto', m10.absent_optional.includes('leo_memory_db'));
        ok('10b) snapshot válido pese a opcional ausente', verifySnapshot(r10.dir, silent).ok);
        rmrf(fx10.base);
    }

    // ── 11: playback legacy coherente ──────────────────────────────────────
    console.log('\n[11] playback JSONL coherente');
    {
        const pb = r1 && JSON.parse(fs.readFileSync(path.join(r1.dir, 'manifest.json'), 'utf8'))
            .assets.find(a => a.name === 'playback_events_log');
        ok('11) playback capturado como jsonl con validación', pb && pb.type === 'jsonl' && pb.validation === 'jsonl_ok');
    }

    // ── 12: registro legacy parcial/mutado → fallo ─────────────────────────
    console.log('\n[12] playback parcial → fallo');
    {
        const fx12 = buildFixture();
        // Línea final SIN terminador \n = registro parcial estable.
        fs.writeFileSync(path.join(fx12.dataRoot, 'playback_events.log'),
            JSON.stringify({ event: 'a', userId: 'u1' }) + '\n' + '{ "event": "b", "user');
        let threw = null;
        try { await createSnapshot(fx12.opts({ snapshotId: 'snap-12' })); } catch (e) { threw = e; }
        ok('12) JSONL incoherente → fallo cerrado', threw instanceof SnapshotError && threw.code === 'JSONL_INCOHERENT');
        ok('12b) sin publicar', !fs.existsSync(path.join(fx12.dest, 'snap-12')));
        rmrf(fx12.base);
    }

    // ── 13: checksum alterado post-snapshot → verificador falla ────────────
    console.log('\n[13] checksum alterado → verify falla');
    {
        const fx13 = buildFixture();
        const r13 = await createSnapshot(fx13.opts({ snapshotId: 'snap-13' }));
        const target = path.join(r13.dir, 'data', 'groups_db.json');
        fs.chmodSync(target, 0o600); fs.writeFileSync(target, JSON.stringify([{ id: 'TAMPERED' }]));
        const v = verifySnapshot(r13.dir, silent);
        ok('13) verify detecta CHECKSUM_MISMATCH', !v.ok && v.errors.some(e => e.startsWith('CHECKSUM_MISMATCH')));
        rmrf(fx13.base);
    }

    // ── 14: archivo adicional inyectado → verificador falla ────────────────
    console.log('\n[14] archivo extra → verify falla');
    {
        const fx14 = buildFixture();
        const r14 = await createSnapshot(fx14.opts({ snapshotId: 'snap-14' }));
        fs.writeFileSync(path.join(r14.dir, 'data', 'INTRUDER.json'), '{}');
        const v = verifySnapshot(r14.dir, silent);
        ok('14) verify detecta UNEXPECTED_FILE', !v.ok && v.errors.some(e => e.startsWith('UNEXPECTED_FILE')));
        rmrf(fx14.base);
    }

    // ── 15: manifest o COMPLETE ausente → verificador falla ────────────────
    console.log('\n[15] COMPLETE/manifest ausente → verify falla');
    {
        const fx15 = buildFixture();
        const r15 = await createSnapshot(fx15.opts({ snapshotId: 'snap-15' }));
        fs.rmSync(path.join(r15.dir, 'COMPLETE'));
        const v = verifySnapshot(r15.dir, silent);
        ok('15) verify falla sin COMPLETE', !v.ok && v.errors.some(e => e.startsWith('COMPLETE_MISSING')));
        rmrf(fx15.base);
    }

    // ── 16: symlink y path traversal rechazados ────────────────────────────
    console.log('\n[16] symlink / traversal');
    {
        // String CRUDO con '..' (path.join lo normalizaría) → debe rechazarse.
        let t1 = null; try { validateRootsAndDest({ dataRoot: fx.dataRoot, dataCriticalRoot: fx.dcRoot, dest: `${fx.base}${path.sep}..${path.sep}evil` }); } catch (e) { t1 = e; }
        ok('16a) traversal en dest rechazado', t1?.code === 'PATH_TRAVERSAL', t1?.code);
        // symlink en fuente — requiere privilegio de symlink; en win32 sin él, skip.
        const fx16 = buildFixture();
        const link = path.join(fx16.dataRoot, 'content.json');
        let canSymlink = true;
        try { fs.rmSync(link); fs.symlinkSync(path.join(fx16.dataRoot, 'groups_db.json'), link); }
        catch (e) { canSymlink = false; }
        if (!canSymlink) {
            ok('16b) symlink: SKIP (plataforma sin privilegio de symlink)', true);
        } else {
            let t2 = null;
            try { await createSnapshot(fx16.opts({ snapshotId: 'snap-16' })); } catch (e) { t2 = e; }
            ok('16b) symlink en asset rechazado', t2?.code === 'SYMLINK_REJECTED', t2?.code);
        }
        rmrf(fx16.base);
    }

    // ── 17: destino dentro del origen rechazado ────────────────────────────
    console.log('\n[17] dest dentro de origen');
    {
        let t1 = null; try { validateRootsAndDest({ dataRoot: fx.dataRoot, dataCriticalRoot: fx.dcRoot, dest: path.join(fx.dataRoot, 'sub') }); } catch (e) { t1 = e; }
        ok('17a) dest dentro de dataRoot rechazado', t1?.code === 'DEST_INSIDE_SOURCE');
        let t2 = null; try { validateRootsAndDest({ dataRoot: fx.dataRoot, dataCriticalRoot: fx.dcRoot, dest: fx.dataRoot }); } catch (e) { t2 = e; }
        ok('17b) dest == source rechazado', t2?.code === 'DEST_EQUALS_SOURCE');
    }

    // ── 18: colisión de snapshot_id rechazada ──────────────────────────────
    console.log('\n[18] colisión de id');
    {
        let threw = null;
        try { await createSnapshot(fx.opts({ snapshotId: 'snap-1' })); } catch (e) { threw = e; } // ya existe
        ok('18) id existente → SNAPSHOT_ID_COLLISION', threw?.code === 'SNAPSHOT_ID_COLLISION');
    }

    // ── 19: error intermedio no publica snapshot final ─────────────────────
    console.log('\n[19] error intermedio no publica');
    {
        const fx19 = buildFixture();
        // Corromper una fuente SQLite → integrity_check de la copia falla.
        fs.writeFileSync(path.join(fx19.dcRoot, 'events.db'),
            Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(2000)]));
        let threw = null;
        try { await createSnapshot(fx19.opts({ snapshotId: 'snap-19' })); } catch (e) { threw = e; }
        ok('19) fallo intermedio lanza', threw instanceof SnapshotError);
        ok('19b) no publicó snapshot final', !fs.existsSync(path.join(fx19.dest, 'snap-19')));
        ok('19c) no dejó staging', !fs.existsSync(path.join(fx19.dest, '.staging', 'snap-19')));
        rmrf(fx19.base);
    }

    // ── 20: permisos 0700/0600 (POSIX) ─────────────────────────────────────
    console.log('\n[20] permisos');
    {
        if (process.platform === 'win32') {
            ok('20) permisos: skipped en win32 (verify lo declara)', verifySnapshot(r1.dir, silent).permCheck === 'skipped_win32');
        } else {
            const dirMode = fs.statSync(r1.dir).mode & 0o777;
            const fileMode = fs.statSync(path.join(r1.dir, 'manifest.json')).mode & 0o777;
            ok('20) dir 0700 / file 0600', dirMode === 0o700 && fileMode === 0o600, `dir=${dirMode.toString(8)} file=${fileMode.toString(8)}`);
        }
    }

    // ── 21: ninguna fuente cambia (bytes/hash/mtime/permisos) ──────────────
    console.log('\n[21] fuentes intactas');
    {
        const fx21 = buildFixture();
        const before = snapshotFingerprint(fx21.dataRoot) + '\n' + snapshotFingerprint(fx21.dcRoot);
        await createSnapshot(fx21.opts({ snapshotId: 'snap-21' }));
        verifySnapshot(path.join(fx21.dest, 'snap-21'), silent);
        const after = snapshotFingerprint(fx21.dataRoot) + '\n' + snapshotFingerprint(fx21.dcRoot);
        ok('21) fuentes byte/hash/mtime idénticas tras snapshot+verify', before === after);
        rmrf(fx21.base);
    }

    // ── 22: dry-run cero escrituras + logs sin contenido ───────────────────
    console.log('\n[22] dry-run cero escrituras');
    {
        const fx22 = buildFixture();
        const before = snapshotFingerprint(fx22.dataRoot) + '\n' + snapshotFingerprint(fx22.dcRoot);
        const destBefore = fs.existsSync(fx22.dest);
        const logs = [];
        const plan = dryRunPlan(fx22.opts(), (m) => logs.push(m));
        const after = snapshotFingerprint(fx22.dataRoot) + '\n' + snapshotFingerprint(fx22.dcRoot);
        ok('22a) dry-run no altera fuentes', before === after);
        ok('22b) dry-run no crea destino', fs.existsSync(fx22.dest) === destBefore);
        ok('22c) plan lista activos sin copiarlos', plan.wouldCopy.length > 0 && plan.mode === 'dry-run');
        // Logs solo nombres lógicos/tipos: ningún valor de fixture ('row-', 'u1', etc.)
        const joined = logs.join('\n');
        ok('22d) logs sin contenido de stores', !/row-\d|"id":"u1"|c1|TAMPERED/.test(joined));
        rmrf(fx22.base);
    }

    // ── extra: manifiesto sin PII ──────────────────────────────────────────
    console.log('\n[extra] manifiesto sin contenido de stores');
    {
        const manRaw = fs.readFileSync(path.join(r1.dir, 'manifest.json'), 'utf8');
        ok('E1) manifiesto no contiene payloads de fixtures', !/row-\d|"sessions"|"n":\d/.test(manRaw));
        ok('E2) manifiesto declara límites de consistencia', /no global point-in-time/.test(manRaw));
    }

    console.log(`\nRESULT: pass=${pass} fail=${fail}`);
    if (fail > 0) process.exitCode = 1;
} finally {
    rmrf(fx.base);
}
