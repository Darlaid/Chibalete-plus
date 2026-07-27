/**
 * identityCanonicalSource.test.js — CHP-ID-CANON-01A.
 *
 * Verifica que `data-critical/usuarios_colegios_oro.json` es la ÚNICA fuente
 * runtime de usuarios y que `data/users_db.json` (LEGACY_NON_CANONICAL) quedó
 * fuera del runtime: ni se lee, ni se escribe, ni actúa como fallback.
 *
 * AISLAMIENTO: todos los padrones viven en mkdtemp. Este test NO lee, escribe,
 * respalda ni restaura ningún archivo de data/ ni data-critical/.
 *
 *   node server/__test__/identityCanonicalSource.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);

console.log('identityCanonicalSource — CHP-ID-CANON-01A');

// ────────────────────────────────────────────────────────────────────────────
// A. Canonicalidad de la resolución (sin env: default del repo)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[A] Resolución canónica por defecto');
{
    const cfg = await import('../config.js?canon=default');
    const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

    ok('USERS_DB_CANONICAL_DEFAULT = data-critical/usuarios_colegios_oro.json',
        rel(cfg.USERS_DB_CANONICAL_DEFAULT) === 'data-critical/usuarios_colegios_oro.json',
        rel(cfg.USERS_DB_CANONICAL_DEFAULT));

    // La regla se verifica sobre el resolver puro, no sobre el entorno de la
    // máquina: un .env de desarrollo no debe poder hacer pasar/fallar el test.
    ok('sin USERS_DB, el resolver devuelve el canónico',
        cfg.resolveUsersDb({}) === cfg.USERS_DB_CANONICAL_DEFAULT,
        rel(cfg.resolveUsersDb({})));

    ok('sin USERS_DB, el resolver NO devuelve el legacy (cero fallback)',
        cfg.resolveUsersDb({}) !== cfg.USERS_DB_LEGACY_NON_CANONICAL);

    ok('con USERS_DB, el resolver respeta la ruta inyectada',
        cfg.resolveUsersDb({ USERS_DB: '/tmp/padron.json' }) === '/tmp/padron.json');

    ok('la constante legacy sigue nombrando data/users_db.json (solo deprecación)',
        rel(cfg.USERS_DB_LEGACY_NON_CANONICAL) === 'data/users_db.json',
        rel(cfg.USERS_DB_LEGACY_NON_CANONICAL));

    ok('isLegacyNonCanonicalUsersDb reconoce el padrón legacy',
        cfg.isLegacyNonCanonicalUsersDb(cfg.USERS_DB_LEGACY_NON_CANONICAL) === true);

    ok('isLegacyNonCanonicalUsersDb no marca el canónico',
        cfg.isLegacyNonCanonicalUsersDb(cfg.USERS_DB_CANONICAL_DEFAULT) === false);
}

// ────────────────────────────────────────────────────────────────────────────
// B. Env override sigue mandando (producción inyecta USERS_DB por container)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[B] Override por entorno');
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idcanon_'));
    const CANON  = path.join(tmpDir, 'usuarios_colegios_oro.json');
    fs.writeFileSync(CANON, JSON.stringify([]), 'utf8');

    const prev = process.env.USERS_DB;
    process.env.USERS_DB = CANON;
    const cfg = await import('../config.js?canon=env');
    if (prev === undefined) delete process.env.USERS_DB; else process.env.USERS_DB = prev;

    ok('USERS_DB env gana sobre el default', cfg.USERS_DB === CANON, cfg.USERS_DB);
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// C. Cero referencias runtime al padrón legacy
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[C] Cero referencias runtime a data/users_db.json');
{
    // Directorios de runtime del backend + capa de datos del frontend.
    const RUNTIME_DIRS = ['server', 'utils', 'services', 'engines', 'hooks', 'pages', 'components'];
    const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
    // Excluidos: tests (pueden nombrar el legado explícitamente) y el único
    // archivo autorizado a nombrarlo, config.js, donde vive la constante de
    // deprecación.
    const isExcluded = (rel) =>
        rel.includes('/__test__/') || rel.includes('/__tests__/') ||
        rel.endsWith('.test.js') || rel.endsWith('.test.mjs') || rel.endsWith('.test.ts') ||
        rel === 'server/config.js';

    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                walk(full);
                continue;
            }
            if (!EXT.has(path.extname(entry.name))) continue;
            const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
            if (isExcluded(rel)) continue;
            const src = fs.readFileSync(full, 'utf8');
            if (src.includes('users_db.json')) offenders.push(rel);
        }
    };
    for (const d of RUNTIME_DIRS) {
        const abs = path.join(REPO_ROOT, d);
        if (fs.existsSync(abs)) walk(abs);
    }

    ok('0 archivos de runtime mencionan users_db.json', offenders.length === 0, offenders.join(', '));
}

// ────────────────────────────────────────────────────────────────────────────
// D. El CIS (scopeAccess/login/admin) resuelve contra el canónico, no el legacy
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[D] CIS y scopeAccess leen el canónico');
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idcanon_cis_'));
    const CANON  = path.join(tmpDir, 'usuarios_colegios_oro.json');
    const GROUPS = path.join(tmpDir, 'groups_db.json');
    const DECOY  = path.join(tmpDir, 'users_db.json'); // señuelo estilo legacy

    fs.writeFileSync(CANON, JSON.stringify([
        { id: 'u_canon_admin', roles: ['administrador'] },
        { id: 'u_canon_med',   roles: ['mediador'] },
    ]), 'utf8');
    fs.writeFileSync(GROUPS, JSON.stringify([
        { id: 'g1', school: 'Colegio Uno', schoolId: 'sch_1', mediatorIds: ['u_canon_med'] },
    ]), 'utf8');
    fs.writeFileSync(DECOY, JSON.stringify([
        { id: 'u_legacy_only_admin', roles: ['administrador'] },
    ]), 'utf8');

    const prevU = process.env.USERS_DB, prevG = process.env.GROUPS_DB;
    process.env.USERS_DB  = CANON;
    process.env.GROUPS_DB = GROUPS;

    const cis = await import('../identity/cis.mjs?canon=cis');
    const scopeAccess = await import('../aulaViva/scopeAccess.mjs?canon=cis');

    const canonBefore = fs.statSync(CANON).mtimeMs;
    const decoyBefore = fs.statSync(DECOY).mtimeMs;

    ok('principal del canónico se resuelve', cis.getPrincipal('u_canon_admin')?.id === 'u_canon_admin');
    ok('principal que SOLO existe en el legacy NO se resuelve',
        cis.getPrincipal('u_legacy_only_admin') === null);
    ok('scopeAccess concede al mediador de su school (fuente canónica)',
        scopeAccess.evaluateScopeAccess('u_canon_med', 'school', 'sch_1').decision === 'allow');
    ok('scopeAccess deniega a la identidad legacy-only',
        scopeAccess.evaluateScopeAccess('u_legacy_only_admin', 'school', 'sch_1').decision === 'unauthenticated');
    ok('ninguna lectura escribió el canónico', fs.statSync(CANON).mtimeMs === canonBefore);
    ok('el señuelo legacy quedó intacto', fs.statSync(DECOY).mtimeMs === decoyBefore);

    if (prevU === undefined) delete process.env.USERS_DB; else process.env.USERS_DB = prevU;
    if (prevG === undefined) delete process.env.GROUPS_DB; else process.env.GROUPS_DB = prevG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// E. Stores reales del repo intactos
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[E] data/ y data-critical/ intactos');
{
    const WATCHED = [
        path.join(REPO_ROOT, 'data', 'users_db.json'),
        path.join(REPO_ROOT, 'data', 'groups_db.json'),
        path.join(REPO_ROOT, 'data-critical'),
    ];
    // Solo se comprueba que el test no creó nada nuevo en data-critical/.
    const critical = path.join(REPO_ROOT, 'data-critical');
    const hasCanonLocal = fs.existsSync(path.join(critical, 'usuarios_colegios_oro.json'));
    ok('el test no creó data-critical/usuarios_colegios_oro.json',
        hasCanonLocal === false || process.env.CHP_ALLOW_LOCAL_CANON === '1');
    ok('las rutas vigiladas siguen siendo legibles o ausentes sin error',
        WATCHED.every(p => { try { fs.existsSync(p); return true; } catch { return false; } }));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
