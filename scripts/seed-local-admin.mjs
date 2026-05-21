#!/usr/bin/env node
/**
 * seed-local-admin.mjs — seed idempotente del usuario admin LOCAL de auditoría.
 *
 * Garantiza que en entorno LOCAL/DEV exista (o se actualice) el usuario:
 *
 *   email:    admin@chibaleteeditores.com
 *   password: admin123       (bcrypt hash cost 10, mismo mecanismo que el server)
 *   roles:    ['administrador']
 *
 * REGLAS DURAS:
 *
 *   1. NUNCA correr en producción. Si NODE_ENV === 'production' aborta con
 *      exit 1 sin tocar absolutamente nada. Doble verificación:
 *        - flag env explícito.
 *        - chequeo de marcadores de filesystem productivos (data-critical/).
 *
 *   2. Idempotente. Si el user ya existe y `bcrypt.compare('admin123', hash)`
 *      es true, NO toca el archivo. Re-run N veces sin side-effect.
 *
 *   3. Sin duplicar. Si el email ya existe → UPDATE in-place. Solo crea
 *      nuevo si NO existe ningún user con ese email.
 *
 *   4. Preserva otros campos del user (nombre_completo, colegio, groupIds,
 *      avatar_url, etc.). Solo toca `password`, asegura `roles` incluye
 *      'administrador' y `accountStatus='active'`.
 *
 *   5. Write atómico: escribe a un .tmp adyacente y renombra. Backup
 *      automático en `users_db.json.backup-<timestamp>` antes del primer
 *      write (solo si el archivo existe — por si algo sale mal el usuario
 *      puede restaurar manualmente).
 *
 *   6. Sin imprimir el password en stdout (excepto el explicit success log
 *      al final, una sola vez, después de validar).
 *
 *   7. NO usa el server. Manipula data/users_db.json directo. Server puede
 *      estar corriendo o no — no se reinicia, el server recarga al primer
 *      request (lectura cada vez de disco, sin cache largo).
 *
 * Uso:
 *
 *   node scripts/seed-local-admin.mjs
 *   # o
 *   npm run seed:admin-local
 *
 * Override del path (tests):
 *
 *   USERS_DB=/path/to/test/users_db.json node scripts/seed-local-admin.mjs
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

// ── Constantes del usuario semilla ─────────────────────────────────────────
const SEED_EMAIL    = 'admin@chibaleteeditores.com';
const SEED_PASSWORD = 'admin123';
const SEED_ROLE     = 'administrador';
const SEED_ID_NEW   = 'local-admin-seed';   // solo se usa si no existe el email

// ── Path resolution ────────────────────────────────────────────────────────
// Mismo mecanismo que el server: env var USERS_DB primero, fallback a
// data/users_db.json desde la raíz del repo. Permite que los tests pasen
// un tmp file.
const USERS_DB = process.env.USERS_DB || path.join(REPO_ROOT, 'data', 'users_db.json');

// ── Logger conciso ─────────────────────────────────────────────────────────
function log(msg, level = 'INFO') {
    const ts = new Date().toISOString();
    const prefix = level === 'ERROR' ? '\x1b[31m[ERROR]\x1b[0m'
                 : level === 'WARN'  ? '\x1b[33m[WARN]\x1b[0m'
                 : level === 'OK'    ? '\x1b[32m[OK]\x1b[0m'
                 : `[${level}]`;
    // eslint-disable-next-line no-console
    console.log(`${ts} ${prefix} ${msg}`);
}

// ── GUARDIA #1: NODE_ENV === 'production' ─────────────────────────────────
function assertNotProduction() {
    const env = String(process.env.NODE_ENV || '').trim().toLowerCase();
    if (env === 'production') {
        log('Aborto: NODE_ENV=production. Este seed es SOLO para local/dev.', 'ERROR');
        process.exit(1);
    }
}

// ── GUARDIA #2: marcadores de filesystem productivos ──────────────────────
// Si el path apunta a /var/www/chibalete/ o el repo contiene data-critical/
// con marcador "production: true" cerca, abortamos por exceso de prudencia.
function assertNotProductionFilesystem() {
    // Marcador 1: USERS_DB apunta a /var/www/chibalete (Docker VPS bind-mount)
    if (USERS_DB.includes('/var/www/chibalete') || USERS_DB.includes('\\var\\www\\chibalete')) {
        log(`Aborto: el path USERS_DB parece productivo (${USERS_DB}).`, 'ERROR');
        process.exit(1);
    }
    // Marcador 2: existe data-critical/PROD_MARKER en repo root
    const prodMarker = path.join(REPO_ROOT, 'data-critical', 'PROD_MARKER');
    if (fs.existsSync(prodMarker)) {
        log(`Aborto: marcador productivo encontrado en ${prodMarker}.`, 'ERROR');
        process.exit(1);
    }
}

// ── Core seed logic ───────────────────────────────────────────────────────

async function runSeed() {
    assertNotProduction();
    assertNotProductionFilesystem();

    log(`USERS_DB: ${USERS_DB}`);

    // Cargar users actuales (o crear archivo vacío si no existe).
    /** @type {Array<object>} */
    let users;
    if (!fs.existsSync(USERS_DB)) {
        log(`Archivo no existe — se creará con un único user admin.`, 'WARN');
        users = [];
    } else {
        try {
            const raw = fs.readFileSync(USERS_DB, 'utf8');
            users = raw.trim() ? JSON.parse(raw) : [];
            if (!Array.isArray(users)) {
                log(`users_db.json no es un array (root type=${typeof users}). Aborto.`, 'ERROR');
                process.exit(2);
            }
        } catch (err) {
            log(`No se pudo parsear users_db.json: ${err?.message}`, 'ERROR');
            process.exit(2);
        }
    }

    // Buscar admin existente por email (case-insensitive, por las dudas).
    const idx = users.findIndex(u =>
        u && typeof u.email === 'string' && u.email.toLowerCase() === SEED_EMAIL.toLowerCase());

    let didMutate = false;
    let action;     // 'created' | 'updated' | 'noop'

    if (idx >= 0) {
        const existing = users[idx];

        // Idempotencia dura: si el password actual ya valida 'admin123',
        // NO re-hashear (mantenemos el salt actual para evitar churn).
        let needPasswordUpdate = true;
        if (typeof existing.password === 'string' && existing.password.startsWith('$2')) {
            try {
                if (await bcrypt.compare(SEED_PASSWORD, existing.password)) {
                    needPasswordUpdate = false;
                }
            } catch { /* corrupted hash → re-hashear */ }
        }

        // Asegurar campos críticos sin tocar el resto.
        const rolesArr = Array.isArray(existing.roles) ? existing.roles : [];
        const needRoleUpdate          = !rolesArr.includes(SEED_ROLE);
        const needAccountStatusUpdate = existing.accountStatus !== 'active';

        if (!needPasswordUpdate && !needRoleUpdate && !needAccountStatusUpdate) {
            action = 'noop';
            log(`User ya está en estado deseado (password OK, role administrador, accountStatus active). Sin cambios.`, 'OK');
        } else {
            const updated = { ...existing };
            if (needPasswordUpdate) {
                updated.password = await bcrypt.hash(SEED_PASSWORD, 10);
            }
            if (needRoleUpdate) {
                updated.roles = [...new Set([...rolesArr, SEED_ROLE])];
            }
            if (needAccountStatusUpdate) {
                updated.accountStatus = 'active';
            }
            users[idx] = updated;
            didMutate = true;
            action = 'updated';
            log(`User actualizado (password=${needPasswordUpdate}, role=${needRoleUpdate}, status=${needAccountStatusUpdate}).`, 'OK');
        }
    } else {
        // Crear nuevo.
        const hashed = await bcrypt.hash(SEED_PASSWORD, 10);
        users.push({
            id:              SEED_ID_NEW,
            email:           SEED_EMAIL,
            password:        hashed,
            nombre_completo: 'Admin Local (seed)',
            roles:           [SEED_ROLE],
            colegio:         'Chibalete',
            accountStatus:   'active',
        });
        didMutate = true;
        action = 'created';
        log(`User CREADO con id=${SEED_ID_NEW}.`, 'OK');
    }

    if (didMutate) {
        // Backup defensivo si el archivo existe y aún no hay backup hoy.
        if (fs.existsSync(USERS_DB)) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${USERS_DB}.backup-${ts}`;
            try {
                fs.copyFileSync(USERS_DB, backupPath);
                log(`Backup creado: ${path.basename(backupPath)}`);
            } catch (err) {
                log(`No se pudo crear backup (continuamos): ${err?.message}`, 'WARN');
            }
        }
        // Write atómico: escribir a tmp y renombrar.
        const tmpPath = `${USERS_DB}.tmp`;
        try {
            fs.writeFileSync(tmpPath, JSON.stringify(users, null, 4));
            fs.renameSync(tmpPath, USERS_DB);
        } catch (err) {
            log(`Fallo al escribir users_db.json: ${err?.message}`, 'ERROR');
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            process.exit(3);
        }
    }

    log('────────────────────────────────────────────────────────────', 'OK');
    log(`Action: ${action}`, 'OK');
    log(`Email:    ${SEED_EMAIL}`, 'OK');
    log(`Password: ${SEED_PASSWORD}     ⚠️  USO LOCAL EXCLUSIVO`, 'OK');
    log(`Roles:    [${SEED_ROLE}]`, 'OK');
    log(`Path:     ${USERS_DB}`, 'OK');
    log('────────────────────────────────────────────────────────────', 'OK');
    return action;
}

// Entry point — solo si se ejecuta como script (no si se importa para tests).
const isMainScript = import.meta.url === `file://${process.argv[1]}`
                   || import.meta.url.endsWith(path.basename(process.argv[1] || ''));

if (isMainScript) {
    runSeed().catch(err => {
        log(`Error inesperado: ${err?.message}`, 'ERROR');
        process.exit(99);
    });
}

// Export para tests.
export { runSeed, SEED_EMAIL, SEED_PASSWORD, SEED_ROLE, SEED_ID_NEW };
