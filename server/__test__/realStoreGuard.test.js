/**
 * realStoreGuard.test.js — CHP-ID-CANON-01B.
 *
 * Verifica que el guard de precarga (scripts/test-real-store-guard.mjs) impide
 * de verdad que un test escriba dentro de data/, data-critical/ o
 * public/uploads/, y que NO estorba ni las lecturas ni los temporales.
 *
 * El guard se prueba en un proceso hijo con `--import`, que es exactamente como
 * lo aplica scripts/verify-test-store-isolation.mjs a la suite.
 *
 *   node server/__test__/realStoreGuard.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = './scripts/test-real-store-guard.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);

/** Ejecuta `code` en un hijo con el guard precargado. */
function runGuarded(code) {
    const r = spawnSync(process.execPath, ['--import', GUARD, '--input-type=module', '-e', code], {
        cwd: REPO_ROOT, encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test' },
    });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const blocked = (r) => r.status !== 0 && r.out.includes('REAL_STORE_WRITE_BLOCKED');

console.log('realStoreGuard — CHP-ID-CANON-01B');

// ── A. Bloquea escrituras sobre stores reales ───────────────────────────────
console.log('\n[A] Escrituras bloqueadas');
{
    const cases = [
        ['writeFileSync en data/',           `fs.writeFileSync('data/users_db.json','[]')`],
        ['writeFileSync en data-critical/',  `fs.writeFileSync('data-critical/usuarios_colegios_oro.json','[]')`],
        ['appendFileSync en data/',          `fs.appendFileSync('data/groups_db.json','x')`],
        ['unlinkSync en data/',              `fs.unlinkSync('data/users_db.json')`],
        ['renameSync hacia data/',           `fs.renameSync('package.json','data/robado.json')`],
        ['copyFileSync hacia data-critical/',`fs.copyFileSync('package.json','data-critical/copia.json')`],
        ['createWriteStream en data/',       `fs.createWriteStream('data/nuevo.json')`],
        ['openSync modo w en data/',         `fs.openSync('data/users_db.json','w')`],
        ['promises.writeFile en uploads',    `await fs.promises.writeFile('public/uploads/x.bin','x')`],
        ['rmSync en data-critical/',         `fs.rmSync('data-critical/identity.db')`],
    ];
    for (const [label, stmt] of cases) {
        const r = runGuarded(`import fs from 'node:fs';\n${stmt};`);
        ok(label, blocked(r), r.out.split('\n')[0]);
    }
}

// ── B. No estorba lo legítimo ───────────────────────────────────────────────
console.log('\n[B] Operaciones legítimas siguen funcionando');
{
    const readReal = runGuarded(
        `import fs from 'node:fs';
         const raw = fs.readFileSync('package.json','utf8');
         if (!raw.includes('chibalete')) throw new Error('lectura inesperada');
         if (fs.existsSync('data/users_db.json')) fs.readFileSync('data/users_db.json','utf8');
         console.log('READ_OK');`);
    ok('leer un store real sigue permitido', readReal.status === 0 && readReal.out.includes('READ_OK'),
        readReal.out.split('\n')[0]);

    const tmpWrite = runGuarded(
        `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
         const d = fs.mkdtempSync(path.join(os.tmpdir(),'guard_'));
         const f = path.join(d,'padron.json');
         fs.writeFileSync(f, '[]');
         fs.renameSync(f, path.join(d,'padron2.json'));
         fs.rmSync(d, { recursive: true, force: true });
         console.log('TMP_OK');`);
    ok('escribir en un temporal sigue permitido', tmpWrite.status === 0 && tmpWrite.out.includes('TMP_OK'),
        tmpWrite.out.split('\n')[0]);

    const repoWrite = runGuarded(
        `import fs from 'node:fs';
         const p = 'scripts/.guard_probe.tmp';
         fs.writeFileSync(p,'x'); fs.unlinkSync(p);
         console.log('REPO_OK');`);
    ok('escribir fuera de los stores protegidos sigue permitido',
        repoWrite.status === 0 && repoWrite.out.includes('REPO_OK'), repoWrite.out.split('\n')[0]);
}

// ── C. Sin el guard, la misma escritura pasaría (el guard es la causa) ──────
console.log('\n[C] El bloqueo lo produce el guard, no el entorno');
{
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
         const d = fs.mkdtempSync(path.join(os.tmpdir(),'noguard_'));
         fs.writeFileSync(path.join(d,'x.json'),'[]');
         fs.rmSync(d,{recursive:true,force:true});
         console.log('NOGUARD_OK');`], { cwd: REPO_ROOT, encoding: 'utf8' });
    ok('sin guard, una escritura temporal equivalente funciona',
        r.status === 0 && `${r.stdout}`.includes('NOGUARD_OK'));
}

// ── D. Los stores reales no cambiaron durante este test ─────────────────────
console.log('\n[D] Stores reales intactos tras el test');
{
    const probes = [
        path.join(REPO_ROOT, 'data', 'robado.json'),
        path.join(REPO_ROOT, 'data', 'nuevo.json'),
        path.join(REPO_ROOT, 'data-critical', 'copia.json'),
        path.join(REPO_ROOT, 'public', 'uploads', 'x.bin'),
    ];
    ok('ninguna de las escrituras bloqueadas llegó al disco',
        probes.every(p => !fs.existsSync(p)),
        probes.filter(p => fs.existsSync(p)).join(', '));
    ok('data/users_db.json sigue existiendo (no fue borrado)',
        !fs.existsSync(path.join(REPO_ROOT, 'data')) || fs.existsSync(path.join(REPO_ROOT, 'data', 'users_db.json')));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
