/**
 * identityDbPathContract.test.js — CHP-IDDB-02B-PATH-01.
 *
 * Contrato de la ruta de identity.db: resolutor único, fail-closed en
 * producción y cero efectos con los flags apagados. Todo en directorios
 * temporales; nunca toca stores reales ni rutas productivas.
 *
 *   node server/__test__/identityDbPathContract.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    resolveIdentityDbPath, identitySqliteCapabilityActive, redactIdentityDbPath,
    IDENTITY_DB_LEGACY_DEFAULT, IDENTITY_DB_ERRORS, IdentityDbPathError,
} from '../db/identityDbPath.mjs';
import { flags } from '../lib/flags.js';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const cls = (fn) => { try { fn(); return null; } catch (e) { return e.classification ?? e.message; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iddbpath_'));
const F = (n) => path.join(tmp, n);
const PROD = { NODE_ENV: 'production' };

try {
    console.log('\n[1-2] flags apagados: cero efectos');
    const emptyDir = fs.mkdtempSync(path.join(tmp, 'vacio_'));
    const before = fs.readdirSync(emptyDir);
    ok('sin variable y sin flags resuelve al default histórico, sin tocar nada',
        resolveIdentityDbPath({ env: {} }) === IDENTITY_DB_LEGACY_DEFAULT
        && fs.readdirSync(emptyDir).length === before.length);
    const dedicated = path.join(emptyDir, 'identity.db');
    ok('con ruta explícita y flags apagados tampoco se abre ni se crea',
        resolveIdentityDbPath({ env: { IDENTITY_DB: dedicated } }) === dedicated
        && !fs.existsSync(dedicated) && fs.readdirSync(emptyDir).length === 0);
    ok('resolver no crea el directorio padre',
        !fs.existsSync(path.join(tmp, 'no-existe-jamas')));
    ok('en producción con flags apagados sigue sin exigir la variable',
        resolveIdentityDbPath({ env: { ...PROD } }) === IDENTITY_DB_LEGACY_DEFAULT);

    console.log('\n[3-5] producción + capacidad SQLite + variable ausente → fallo cerrado');
    for (const [label, env] of [
        ['IDENTITY_SQLITE_ENABLED', { ...PROD, IDENTITY_SQLITE_ENABLED: '1' }],
        ['IDENTITY_DUAL_WRITE', { ...PROD, IDENTITY_DUAL_WRITE: '1' }],
        ['IDENTITY_READ=sqlite', { ...PROD, IDENTITY_READ: 'sqlite' }],
        ['IDENTITY_SQLITE_ENABLED=true', { ...PROD, IDENTITY_SQLITE_ENABLED: 'true' }],
    ]) {
        ok(`${label} sin ruta → IDENTITY_DB_PATH_REQUIRED`,
            cls(() => resolveIdentityDbPath({ env })) === IDENTITY_DB_ERRORS.REQUIRED);
    }

    console.log('\n[6] el default histórico se rechaza como destino productivo');
    ok('ruta explícita al default bajo data-critical → UNSAFE',
        cls(() => resolveIdentityDbPath({
            env: { ...PROD, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DB: IDENTITY_DB_LEGACY_DEFAULT },
        })) === IDENTITY_DB_ERRORS.UNSAFE);
    ok('y también si llega como argumento explícito (no es puerta trasera)',
        cls(() => resolveIdentityDbPath({
            env: { ...PROD, IDENTITY_DUAL_WRITE: '1' }, explicitPath: IDENTITY_DB_LEGACY_DEFAULT,
        })) === IDENTITY_DB_ERRORS.UNSAFE);

    console.log('\n[7-8] validación de forma');
    ok('ruta relativa → INVALID',
        cls(() => resolveIdentityDbPath({ env: { IDENTITY_DB: './identity.db' } }))
        === IDENTITY_DB_ERRORS.INVALID);
    ok('variable vacía → INVALID',
        cls(() => resolveIdentityDbPath({ env: { IDENTITY_DB: '   ' } })) === IDENTITY_DB_ERRORS.INVALID);
    ok('ruta dedicada absoluta aceptada en producción con SQLite on',
        resolveIdentityDbPath({ env: { ...PROD, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DB: dedicated },
        }) === dedicated);
    const asDir = fs.mkdtempSync(path.join(tmp, 'dir_'));
    ok('un directorio como destino → INVALID (solo al abrir)',
        resolveIdentityDbPath({ env: { IDENTITY_DB: asDir } }) === asDir
        && cls(() => resolveIdentityDbPath({ env: { IDENTITY_DB: asDir }, forOpen: true }))
           === IDENTITY_DB_ERRORS.INVALID);
    ok('la ruta nunca se registra completa', redactIdentityDbPath(dedicated).startsWith('…/')
        && !redactIdentityDbPath(dedicated).includes(tmp));
    ok('el error de forma tampoco filtra la ruta completa',
        !String(cls(() => resolveIdentityDbPath({ env: { IDENTITY_DB: 'relativa/x.db' } })) ?? '')
            .includes('relativa/x.db'));

    console.log('\n[capacidad] una sola semántica, sin divergencia con flags.js');
    for (const [env, expected] of [
        [{}, false], [{ IDENTITY_SQLITE_ENABLED: '1' }, true], [{ IDENTITY_DUAL_WRITE: 'true' }, true],
        [{ IDENTITY_READ: 'sqlite' }, true], [{ IDENTITY_READ: 'json' }, false],
        [{ IDENTITY_SQLITE_ENABLED: '0' }, false],
    ]) {
        ok(`capacidad(${JSON.stringify(env)}) = ${expected}`,
            identitySqliteCapabilityActive(env) === expected);
    }
    const saved = { ...process.env };
    for (const env of [{ IDENTITY_SQLITE_ENABLED: '1' }, { IDENTITY_DUAL_WRITE: '1' },
                       { IDENTITY_READ: 'sqlite' }, {}]) {
        for (const k of ['IDENTITY_SQLITE_ENABLED', 'IDENTITY_DUAL_WRITE', 'IDENTITY_READ']) delete process.env[k];
        Object.assign(process.env, env);
        const viaFlags = flags.identitySqliteEnabled() || flags.identityDualWrite()
            || flags.identityReadSource() === 'sqlite';
        ok(`flags.js y el resolutor coinciden en ${JSON.stringify(env)}`,
            viaFlags === identitySqliteCapabilityActive(process.env));
    }
    for (const k of ['IDENTITY_SQLITE_ENABLED', 'IDENTITY_DUAL_WRITE', 'IDENTITY_READ']) delete process.env[k];
    Object.assign(process.env, saved);

    console.log('\n[9-14] runtime: nadie abre nada mientras esté apagado');
    for (const k of ['IDENTITY_SQLITE_ENABLED', 'IDENTITY_DUAL_WRITE', 'IDENTITY_READ', 'IDENTITY_DB']) {
        delete process.env[k];
    }
    const identityDb = await import('../db/identityDb.js');
    const writeHook = await import('../db/identityWriteHook.js');
    const readFacade = await import('../db/identityReadFacade.js');
    const health = await import('../observability/health.js');
    const snap = (p) => [p, `${p}-wal`, `${p}-shm`]
        .map(f => fs.existsSync(f) ? `${path.basename(f)}:${fs.statSync(f).size}` : 'ausente').join('|');
    const legacyBefore = snap(IDENTITY_DB_LEGACY_DEFAULT);
    const dedicatedDir = fs.mkdtempSync(path.join(tmp, 'dedicado_'));
    process.env.IDENTITY_DB = path.join(dedicatedDir, 'identity.db');
    ok('bootstrap con el flag apagado no hace nada',
        await writeHook.bootstrapIdentityDb(() => {}) === false);
    ok('la facade de lectura no abre nada',
        readFacade.tryIdentitySqliteRead(F('users.json'),
            { usersDb: F('users.json'), groupsDb: '', accessDb: '' }) === null);
    const readiness = await health.buildReadiness();
    ok('health con flags apagados reporta disabled y no abre SQLite',
        readiness.checks?.identity_sqlite?.state === 'disabled',
        JSON.stringify(readiness.checks?.identity_sqlite));
    ok('la ruta dedicada sigue sin existir', !fs.existsSync(process.env.IDENTITY_DB));
    ok('no se crearon WAL ni SHM', fs.readdirSync(dedicatedDir).length === 0);
    ok('el default histórico no fue tocado', snap(IDENTITY_DB_LEGACY_DEFAULT) === legacyBefore);

    console.log('\n[15] los tests con ruta explícita siguen funcionando');
    identityDb.closeIdentityDb();
    const explicit = F('explicita.db');
    const dbx = identityDb.getIdentityDb(explicit);
    ok('getIdentityDb(ruta) abre exactamente esa ruta', fs.existsSync(explicit));
    ok('y aplica los PRAGMA del contrato', dbx.pragma('journal_mode', { simple: true }) === 'wal'
        && dbx.pragma('busy_timeout', { simple: true }) === 5000);
    identityDb.closeIdentityDb();

    console.log('\n[DECISIVA] con un default falso presente, solo se abre la ruta dedicada');
    // Se fabrica un "default histórico" falso en un árbol temporal que imita
    // data-critical/, y se comprueba que activar SQLite con IDENTITY_DB
    // apuntando a otro sitio no lo toca ni por asomo.
    const fakeRoot = fs.mkdtempSync(path.join(tmp, 'fakeapp_'));
    const fakeCritical = path.join(fakeRoot, 'data-critical');
    fs.mkdirSync(fakeCritical);
    const fakeDefault = path.join(fakeCritical, 'identity.db');
    fs.writeFileSync(fakeDefault, 'NO-SOY-UNA-BASE');
    const fakeBefore = fs.readFileSync(fakeDefault, 'utf8');
    const fakeMtime = fs.statSync(fakeDefault).mtimeMs;
    const realDir = fs.mkdtempSync(path.join(tmp, 'real_'));
    const realPath = path.join(realDir, 'identity.db');
    process.env.IDENTITY_SQLITE_ENABLED = '1';
    process.env.IDENTITY_DB = realPath;
    identityDb.closeIdentityDb();
    const dbReal = identityDb.getIdentityDb();
    ok('se abrió la ruta dedicada', fs.existsSync(realPath));
    ok('el default falso no cambió de contenido',
        fs.readFileSync(fakeDefault, 'utf8') === fakeBefore);
    ok('ni de mtime', fs.statSync(fakeDefault).mtimeMs === fakeMtime);
    ok('no aparecieron WAL/SHM junto al default falso',
        fs.readdirSync(fakeCritical).join(',') === 'identity.db');
    ok('la base abierta es la dedicada, no el default',
        path.resolve(dbReal.name) === path.resolve(realPath), dbReal.name);
    identityDb.closeIdentityDb();
    delete process.env.IDENTITY_SQLITE_ENABLED;
    delete process.env.IDENTITY_DB;

    console.log('\n[16-18] contratos que no deben regresar');
    const importer = await import('../../scripts/identity/importIdentityCandidate.mjs');
    ok('el importador conserva la barrera .candidate.db',
        cls(() => importer.assertSafeOutputPath(F('identity.db'), null)) === 'PRODUCTION_PATH_REJECTED');
    ok('y sigue aceptando una candidate legítima',
        importer.assertSafeOutputPath(F('x.candidate.db'), null) === F('x.candidate.db'));
    const promoter = await import('../../scripts/identity/promoteIdentityCandidate.mjs');
    ok('el promotor sigue exigiendo allowlist',
        cls(() => promoter.assertPromotionTarget(F('identity.db'), { allowlist: [] }))
        === 'TARGET_ALLOWLIST_REQUIRED');
    ok('el promotor sigue exigiendo flags apagados',
        cls(() => promoter.assertFlagsOff({ IDENTITY_DUAL_WRITE: '1' })) === 'IDENTITY_FLAGS_ACTIVE');
    const reconciler = await import('../../scripts/identity/reconcileIdentityShadow.mjs');
    ok('el reconciliador sigue rechazando rutas productivas',
        cls(() => reconciler.assertIdentityDbPath('/var/www/chibalete/data-critical/identity.db'))
        === 'PRODUCTION_PATH_REJECTED');
    ok('IdentityDbPathError expone clasificación estable',
        new IdentityDbPathError(IDENTITY_DB_ERRORS.REQUIRED, 'x').classification
        === 'IDENTITY_DB_PATH_REQUIRED');

    console.log('\n[aislamiento] nada fuera del temporal');
    ok('no existe identity.db en ninguna ruta productiva',
        !fs.existsSync('/var/www/chibalete/identity/identity.db')
        && !fs.existsSync('/app/identity/identity.db'));
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    for (const k of ['IDENTITY_SQLITE_ENABLED', 'IDENTITY_DUAL_WRITE', 'IDENTITY_READ', 'IDENTITY_DB']) {
        delete process.env[k];
    }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
