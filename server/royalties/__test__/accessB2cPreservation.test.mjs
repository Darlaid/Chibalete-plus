/**
 * accessB2cPreservation.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-B gate.
 *
 * POST /api/access reconstruye la regla desde el cuerpo. Antes de esta
 * corrección, actualizar una regla B2C perdía su objeto `b2c` (pedido,
 * idempotencia, revocación) y, con él, la posibilidad de revocarla por
 * reembolso (planRevoke → 409). Comprueba con el servidor real:
 *   [1] `b2c` se conserva íntegro al actualizar una regla B2C activa y una revocada
 *   [2] la revocada sigue sin acceso y la activa conserva el suyo
 *   [3] tras la actualización, el reembolso aún puede revocar y la
 *       sincronización de títulos aún ve la regla
 *   [4] el cliente no puede inyectar `b2c` (campo del servidor)
 *
 * Requiere /app/secrets escribible (POST /api/access exige admin-secret
 * file-only): Linux/contenedor con `--tmpfs /app/secrets`. Si no, SKIP.
 *
 *   node server/royalties/__test__/accessB2cPreservation.test.mjs
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRevoke, planTitleSync, B2C_TEMPLATE_RULE_ID } from '../../b2c/b2cProvisioning.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SECRET_FILE = '/app/secrets/admin_secret';
let ADMIN_SECRET = null;
if (process.platform !== 'win32') {
    try {
        fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
        if (!fs.existsSync(SECRET_FILE)) {
            ADMIN_SECRET = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(SECRET_FILE, ADMIN_SECRET, { mode: 0o400 });
        }
    } catch { ADMIN_SECRET = null; }
}
if (!ADMIN_SECRET) {
    console.log('accessB2cPreservation — SKIP: requiere /app/secrets escribible (Linux/contenedor)');
    process.exit(0);
}

const NOW = Date.now();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_access_b2c_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), uploads: path.join(tmp, 'uploads') };
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active', nombre_completo: 'Adm' },
    { id: 'B1', email: 'b1@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'B1', b2c: true },
    { id: 'B2', email: 'b2@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'B2', b2c: true },
]));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');
const mk = (n) => ({ id: `content-c${n}`, titulo: `Obra ${n}`, autor: 'A', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', publisherId: 'pub-chibalete-editores' });
fs.writeFileSync(P.content, JSON.stringify([mk(1), mk(2)], null, 2));
const key = (n) => `production:order:${n}`;
const ACTIVE = {
    id: 'access-b2c-production-order-7', scope: 'user', scopeId: 'B1', titleIds: ['content-c1'], collectionIds: [], expiresAt: NOW + 86400000,
    b2c: { orderId: 7, productId: 345, plan: 'digital', source: 'production', idempotencyKey: key(7), activationAt: NOW - 1000, expiresAt: NOW + 86400000, createdAt: NOW - 1000, templateRuleId: B2C_TEMPLATE_RULE_ID },
};
const REVOKED = {
    id: 'access-b2c-production-order-8', scope: 'user', scopeId: 'B2', titleIds: ['content-c1'], collectionIds: [], expiresAt: NOW - 5000,
    b2c: { orderId: 8, productId: 345, plan: 'digital', source: 'production', idempotencyKey: key(8), activationAt: NOW - 9000, expiresAt: NOW + 86400000, createdAt: NOW - 9000, templateRuleId: B2C_TEMPLATE_RULE_ID, revokedAt: NOW - 5000, revokeReason: 'refunded' },
};
const TEMPLATE = { id: B2C_TEMPLATE_RULE_ID, scope: 'group', scopeId: 'g-b2c', titleIds: ['content-c1', 'content-c2'], collectionIds: [], expiresAt: null };
fs.writeFileSync(P.access, JSON.stringify([TEMPLATE, ACTIVE, REVOKED], null, 2));

const PORT = 6100 + (process.pid % 90);
const base = `http://127.0.0.1:${PORT}`;
let boot = '';
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: path.join(tmp, 'audit.json'),
        ROYALTIES_DB: path.join(tmp, 'rdb', 'royalties.db'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'offline.db'),
        SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: 'restricted',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
child.stdout.on('data', (d) => { boot += d; });
child.stderr.on('data', (d) => { boot += d; });
const call = async (method, url, uid, body, headers = {}) => {
    const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: j };
};
const H = { 'x-admin-secret': ADMIN_SECRET };
const stored = (id) => JSON.parse(fs.readFileSync(P.access, 'utf8')).find((r) => r.id === id);
const canRead = async (uid, cid) => (await call('GET', `/api/content/${cid}/access?userId=${uid}`, uid)).status;

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
    const before = { b1: await canRead('B1', 'content-c1'), b2: await canRead('B2', 'content-c1') };
    ok('línea base: B1 lee (activa), B2 no (revocada)', before.b1 === 200 && before.b2 === 403, JSON.stringify(before));

    console.log('\n[1] b2c se conserva al actualizar');
    let r = await call('POST', '/api/access', null, { id: ACTIVE.id, scope: 'user', scopeId: 'B1', titleIds: ['content-c1', 'content-c2'], collectionIds: [], expiresAt: ACTIVE.expiresAt }, H);
    ok('actualizar regla activa → 200', r.status === 200);
    ok('regla activa: b2c idéntico', JSON.stringify(stored(ACTIVE.id).b2c) === JSON.stringify(ACTIVE.b2c), JSON.stringify(stored(ACTIVE.id).b2c));
    ok('regla activa: el cambio pedido sí se aplicó', stored(ACTIVE.id).titleIds.length === 2);
    r = await call('POST', '/api/access', null, { id: REVOKED.id, scope: 'user', scopeId: 'B2', titleIds: ['content-c1'], collectionIds: [], expiresAt: REVOKED.expiresAt }, H);
    ok('regla revocada: b2c idéntico (revokedAt y motivo)', r.status === 200 && JSON.stringify(stored(REVOKED.id).b2c) === JSON.stringify(REVOKED.b2c));

    console.log('\n[2] accesos tras la actualización');
    ok('B1 sigue leyendo; ahora también c2', await canRead('B1', 'content-c1') === 200 && await canRead('B1', 'content-c2') === 200);
    ok('B2 sigue sin acceso (revocación efectiva)', await canRead('B2', 'content-c1') === 403);

    console.log('\n[3] el ciclo B2C sigue operativo');
    const all = JSON.parse(fs.readFileSync(P.access, 'utf8'));
    let rev;
    try { rev = planRevoke({ rules: all, input: { orderId: 7, source: 'production', idempotencyKey: key(7), reason: 'refunded' }, nowMs: NOW + 10 }); } catch (e) { rev = { error: e.code }; }
    ok('el reembolso aún revoca la regla actualizada', rev.status === 'revoked', JSON.stringify(rev));
    let rev8;
    try { rev8 = planRevoke({ rules: all, input: { orderId: 8, source: 'production', idempotencyKey: key(8), reason: 'refunded' }, nowMs: NOW + 10 }); } catch (e) { rev8 = { error: e.code }; }
    ok('la revocada se reconoce como ya revocada', rev8.status === 'already_revoked', JSON.stringify(rev8));

    console.log('\n[4] el cliente no inyecta b2c');
    r = await call('POST', '/api/access', null, { id: 'r-manual', scope: 'user', scopeId: 'B2', titleIds: ['content-c2'], collectionIds: [], expiresAt: null, b2c: { orderId: 999, idempotencyKey: key(999) } }, H);
    ok('regla nueva: b2c del cuerpo ignorado', r.status === 200 && stored('r-manual') && !('b2c' in stored('r-manual')));
    r = await call('POST', '/api/access', null, { id: ACTIVE.id, scope: 'user', scopeId: 'B1', titleIds: ['content-c1'], collectionIds: [], expiresAt: ACTIVE.expiresAt, b2c: { orderId: 999 } }, H);
    ok('regla existente: el b2c del cuerpo no sustituye al guardado', r.status === 200 && stored(ACTIVE.id).b2c?.orderId === 7);
    // Ahora la regla B2C activa tiene 1 título y la plantilla 2: debe sincronizarse.
    const sync = planTitleSync({ rules: JSON.parse(fs.readFileSync(P.access, 'utf8')), nowMs: NOW + 20 });
    const synced = sync.rules.find((x) => x.id === ACTIVE.id);
    ok('la sincronización de títulos aún ve la regla B2C activa', sync.updated === 1 && synced.titleIds.length === 2 && synced.b2c?.titlesSyncedAt === NOW + 20, JSON.stringify({ updated: sync.updated }));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
    fs.rmSync(tmp, { recursive: true, force: true });
    try { fs.chmodSync(SECRET_FILE, 0o600); fs.rmSync(SECRET_FILE); } catch { /* noop */ }
}

console.log(`\naccessB2cPreservation — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
