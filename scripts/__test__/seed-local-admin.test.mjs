/**
 * seed-local-admin.test.mjs — Tests del seed admin local.
 *
 *   §1  NODE_ENV=production aborta con exit 1 (subprocess)
 *   §2  USERS_DB apuntando a /var/www/chibalete aborta
 *   §3  Sin users_db.json existente → CREATE con bcrypt password válido
 *   §4  User existe con password plain o hash incorrecto → UPDATE password
 *   §5  User existe con bcrypt(admin123) válido → NO-OP (idempotente)
 *   §6  Re-run múltiple sin cambios después del primer éxito
 *   §7  Preserva todos los demás campos del user existente
 *   §8  Asegura roles incluye 'administrador' sin remover otros roles
 *   §9  accountStatus pasa a 'active' si era otro
 *  §10  Crea backup automático antes de modificar
 *
 *   node scripts/__test__/seed-local-admin.test.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SCRIPT     = path.resolve(__dirname, '..', 'seed-local-admin.mjs');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

// ── Helpers ────────────────────────────────────────────────────────────────
function makeTmpDb(initialUsers = null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedtest-'));
    const file = path.join(dir, 'users_db.json');
    if (Array.isArray(initialUsers)) {
        fs.writeFileSync(file, JSON.stringify(initialUsers, null, 4));
    }
    return { dir, file };
}

function runScript(env = {}, opts = {}) {
    const result = spawnSync('node', [SCRIPT], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 30_000,
        ...opts,
    });
    return {
        exitCode: result.status,
        stdout:   result.stdout || '',
        stderr:   result.stderr || '',
    };
}

function readUsers(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const TEST_EMAIL = 'admin@chibaleteeditores.com';

// ── §1: production aborta ──────────────────────────────────────────────────
section('[1] NODE_ENV=production aborta con exit 1');
{
    const { file } = makeTmpDb([]);
    const r = runScript({ NODE_ENV: 'production', USERS_DB: file });
    ok('exit code !== 0',                    r.exitCode !== 0);
    ok('stdout/stderr menciona "production"',
       /production/i.test(r.stdout + r.stderr));
    ok('archivo NO fue creado/modificado',
       JSON.stringify(readUsers(file)) === '[]');
}

// ── §2: path productivo aborta ─────────────────────────────────────────────
section('[2] USERS_DB con path productivo aborta');
{
    const r = runScript({
        NODE_ENV: 'development',
        USERS_DB: '/var/www/chibalete/data/users_db.json',
    });
    ok('exit code !== 0',                    r.exitCode !== 0);
    ok('stdout/stderr menciona "productivo" o el path bloqueado',
       /productivo|var\/www|var\\www/i.test(r.stdout + r.stderr));
}

// ── §3: CREATE cuando no existe ────────────────────────────────────────────
section('[3] CREATE cuando no hay user con ese email');
{
    const { file } = makeTmpDb([
        { id: 'other-1', email: 'other@example.com', roles: ['lector'] },
    ]);
    const r = runScript({ NODE_ENV: 'development', USERS_DB: file });
    ok('exit code 0', r.exitCode === 0, `stderr=${r.stderr.slice(0,200)}`);
    const users = readUsers(file);
    ok('total users === 2 (preservó el existente + agregó admin)', users.length === 2);
    const admin = users.find(u => u.email === TEST_EMAIL);
    ok('admin existe',                        !!admin);
    ok('admin.roles incluye administrador',   admin?.roles?.includes('administrador'));
    ok('admin.accountStatus === active',      admin?.accountStatus === 'active');
    ok('admin.password es bcrypt hash',       typeof admin?.password === 'string' && admin.password.startsWith('$2'));
    const passOk = bcrypt.compareSync('admin123', admin?.password ?? '');
    ok('admin.password valida bcrypt.compare("admin123",...)', passOk);
    ok('preserva user pre-existente',         users.find(u => u.email === 'other@example.com'));
}

// ── §4: UPDATE password cuando hash incorrecto ────────────────────────────
section('[4] UPDATE password cuando hash actual NO valida admin123');
{
    // User existente con un hash bcrypt distinto (de "otra_password").
    const wrongHash = bcrypt.hashSync('otra_password_xxx', 10);
    const { file } = makeTmpDb([
        { id: 'admin-pre', email: TEST_EMAIL, password: wrongHash,
          roles: ['administrador'], accountStatus: 'active',
          nombre_completo: 'PRESERVE_ME',
          colegio: 'Chibalete',
          customField: 'PRESERVED_ALSO' },
    ]);
    const r = runScript({ NODE_ENV: 'development', USERS_DB: file });
    ok('exit code 0', r.exitCode === 0);
    const users = readUsers(file);
    ok('total users === 1 (no duplicó)', users.length === 1);
    const admin = users[0];
    ok('id preservado === admin-pre',         admin.id === 'admin-pre');
    ok('nombre_completo preservado',          admin.nombre_completo === 'PRESERVE_ME');
    ok('customField preservado',              admin.customField === 'PRESERVED_ALSO');
    ok('colegio preservado',                  admin.colegio === 'Chibalete');
    ok('password ahora valida admin123',      bcrypt.compareSync('admin123', admin.password));
    ok('hash es diferente al anterior',       admin.password !== wrongHash);
}

// ── §5: NOOP idempotente cuando ya valida admin123 ────────────────────────
section('[5] NO-OP idempotente cuando hash ya valida admin123');
{
    const correctHash = bcrypt.hashSync('admin123', 10);
    const { file } = makeTmpDb([
        { id: 'admin-pre', email: TEST_EMAIL, password: correctHash,
          roles: ['administrador'], accountStatus: 'active' },
    ]);
    const originalContent = fs.readFileSync(file, 'utf8');
    const r = runScript({ NODE_ENV: 'development', USERS_DB: file });
    ok('exit code 0', r.exitCode === 0);
    ok('stdout dice "noop" o "Sin cambios"',
       /noop|Sin cambios/i.test(r.stdout));
    const afterContent = fs.readFileSync(file, 'utf8');
    ok('archivo NO fue modificado (mismo contenido byte-a-byte)',
       afterContent === originalContent);
    const users = readUsers(file);
    ok('hash preservado IDÉNTICO',            users[0].password === correctHash);
}

// ── §6: Re-run sin cambios ─────────────────────────────────────────────────
section('[6] Re-run múltiple no genera cambios después del primer éxito');
{
    const { file } = makeTmpDb([]);
    runScript({ NODE_ENV: 'development', USERS_DB: file });
    const afterFirst = fs.readFileSync(file, 'utf8');
    const r = runScript({ NODE_ENV: 'development', USERS_DB: file });
    ok('exit code 0 en re-run',               r.exitCode === 0);
    ok('archivo IDÉNTICO tras re-run',
       fs.readFileSync(file, 'utf8') === afterFirst);
}

// ── §7: Preserva otros campos en UPDATE ────────────────────────────────────
section('[7] preserva todos los campos custom en UPDATE');
{
    const { file } = makeTmpDb([
        { id: 'admin-x', email: TEST_EMAIL, password: 'plain_text_old',
          roles: ['administrador'], accountStatus: 'active',
          libros_leidos: 42, seguidores: 7, avatar_url: '/x.png',
          groupIds: ['g1', 'g2'], lastLoginAt: '2026-01-01T00:00:00.000Z' },
    ]);
    runScript({ NODE_ENV: 'development', USERS_DB: file });
    const users = readUsers(file);
    const a = users[0];
    ok('libros_leidos preservado',            a.libros_leidos === 42);
    ok('seguidores preservado',               a.seguidores === 7);
    ok('avatar_url preservado',               a.avatar_url === '/x.png');
    ok('groupIds preservado (array)',         Array.isArray(a.groupIds) && a.groupIds.length === 2);
    ok('lastLoginAt preservado',              a.lastLoginAt === '2026-01-01T00:00:00.000Z');
    ok('password fue actualizado (bcrypt)',   a.password.startsWith('$2'));
}

// ── §8: roles incluye administrador sin remover otros ─────────────────────
section('[8] roles incluye administrador sin remover otros roles');
{
    const correctHash = bcrypt.hashSync('admin123', 10);
    const { file } = makeTmpDb([
        { id: 'admin-x', email: TEST_EMAIL, password: correctHash,
          roles: ['mediador', 'lector'], accountStatus: 'active' },
    ]);
    runScript({ NODE_ENV: 'development', USERS_DB: file });
    const a = readUsers(file)[0];
    ok('roles incluye administrador',         a.roles.includes('administrador'));
    ok('roles preserva mediador',             a.roles.includes('mediador'));
    ok('roles preserva lector',               a.roles.includes('lector'));
    ok('sin duplicados',                      a.roles.length === new Set(a.roles).size);
}

// ── §9: accountStatus pasa a 'active' si era otro ─────────────────────────
section('[9] accountStatus pasa a active si estaba disabled');
{
    const correctHash = bcrypt.hashSync('admin123', 10);
    const { file } = makeTmpDb([
        { id: 'admin-x', email: TEST_EMAIL, password: correctHash,
          roles: ['administrador'], accountStatus: 'disabled' },
    ]);
    runScript({ NODE_ENV: 'development', USERS_DB: file });
    const a = readUsers(file)[0];
    ok('accountStatus === active',            a.accountStatus === 'active');
}

// ── §10: backup automático ────────────────────────────────────────────────
section('[10] backup automático en modificación');
{
    const { file, dir } = makeTmpDb([
        { id: 'admin-pre', email: TEST_EMAIL, password: 'plain_old',
          roles: ['administrador'], accountStatus: 'active' },
    ]);
    runScript({ NODE_ENV: 'development', USERS_DB: file });
    const backups = fs.readdirSync(dir).filter(f => f.includes('.backup-'));
    ok('al menos 1 backup creado',            backups.length >= 1);
    if (backups.length > 0) {
        const backupContent = fs.readFileSync(path.join(dir, backups[0]), 'utf8');
        // El backup es el ESTADO PREVIO (antes del cambio), debe contener 'plain_old'
        ok('backup contiene el estado PREVIO al cambio',
           backupContent.includes('plain_old'));
    }
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
