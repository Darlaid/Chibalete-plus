/**
 * cisScopeAccess.test.js — CHP-ID-01 (+ CHP-ID-01-FIX-01 H2/H3/H4).
 *
 * Prueba el CIS (server/identity/cis.mjs) y scopeAccess repuntado.
 * AISLAMIENTO TOTAL (H3): todos los padrones —canónicos Y señuelos— viven en
 * mkdtemp; este test NO lee, escribe, respalda ni restaura NINGÚN archivo del
 * repositorio (data/ intacto). USERS_DB/GROUPS_DB se setean por env ANTES de
 * importar config/CIS (resolución en import-time; sin cache ESM envenenado).
 *
 *   node server/__test__/cisScopeAccess.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Fixtures aislados ANTES de importar config/CIS ──────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cis_'));
const USERS_TMP    = path.join(tmpDir, 'canon_users.json');
const GROUPS_TMP   = path.join(tmpDir, 'canon_groups.json');
const SCHOOLS_TMP  = path.join(tmpDir, 'canon_schools.json');
const OBSOLETE_TMP = path.join(tmpDir, 'obsolete_users_decoy.json'); // señuelo ≠ canónico
// CHP-ID-CANON-01B — NODE_ENV=test es lo único que habilita el override de
// USERS_DB, y solo hacia un fixture dentro de un directorio temporal.
process.env.NODE_ENV   = 'test';
process.env.USERS_DB   = USERS_TMP;
process.env.GROUPS_DB  = GROUPS_TMP;
process.env.SCHOOLS_DB = SCHOOLS_TMP;

const USERS = [
    { id: 'u_admin',   roles: ['administrador'], kind: 'real' },
    { id: 'u_med',     roles: ['profesor'],      kind: 'real' },      // media g_A y g_B (multi-membership)
    { id: 'u_med_ng',  roles: ['profesor'] },                          // rol mediador SIN grupos
    { id: 'u_stu',     rol: 'lector', kind: 'synthetic' },             // member g_A vía memberIds
    { id: 'u_stu2',    role: 'lector', groupIds: ['g_B'] },            // member g_B vía user.groupIds
    { id: 'u_fb',      roles: ['lector'], colegio: 'Escuela Fallback' }, // fallback en g_FB (elegibilidad exige roles array)
    { id: 'u_fb_otro', roles: ['lector'], colegio: 'Otra Escuela' },     // NO fallback en g_FB
    { id: 'u_fb_casi', roles: ['lector'], colegio: 'Escuela  Fallback' },// nombre "parecido" (doble espacio)
    { id: 'u_dd',      roles: ['lector'], colegio: 'Escuela Doble' },    // escuela multi-grupo → sin fallback
    { id: 'u_hm',      roles: ['lector'], colegio: 'Escuela Homónima' }, // dos instituciones mismo nombre
    { id: 'u_hist',    roles: ['lector'] },                              // miembro de un grupo histórico
    { id: 'u_k1',      roles: ['lector'], kind: 'REAL' },                // kind inválido (mayúsculas)
    { id: 'u_k2',      roles: ['lector'], kind: 42 },                    // kind inválido (número)
    { id: 'u_k3',      roles: ['lector'], kind: 'bot' },                 // kind inválido (valor ajeno)
];
// CHP-ID-GROUPS-RECON-01B: la autoridad es `organizationId`, y solo cuenta si
// está REGISTRADO en schools_db. `school` se conserva como etiqueta legacy para
// probar precisamente que ya no concede nada.
const GROUPS = [
    { id: 'g_A',  school: 'Escuela Uno',      organizationId: 'school_1',  mediatorIds: ['u_med'], memberIds: ['u_stu'], studentIds: ['u_stu'] },
    { id: 'g_B',  school: 'Escuela Dos',      organizationId: 'school_2',  mediatorIds: ['u_med'], memberIds: [] },
    { id: 'g_FB', school: 'Escuela Fallback', organizationId: 'school_fb', mediatorIds: ['u_med'] },
    { id: 'g_D1', school: 'Escuela Doble',    organizationId: 'school_d',  mediatorIds: ['u_med'] },
    { id: 'g_D2', school: 'Escuela Doble',    organizationId: 'school_d',  mediatorIds: [] },
    // Homónimos: dos ORGANIZACIONES distintas con el mismo nombre visible.
    { id: 'g_H1', school: 'Escuela Homónima', organizationId: 'inst_HA', mediatorIds: ['u_med'] },
    { id: 'g_H2', school: 'Escuela Homónima', organizationId: 'inst_HB', mediatorIds: [] },
    // Histórico: media un grupo SIN organización registrada → jamás da scope.
    { id: 'g_HIST', school: 'Escuela Uno', mediatorIds: ['u_med'], memberIds: ['u_hist'] },
];
// Registro institucional: `school_fb` y `inst_HB` quedan deliberadamente FUERA
// para probar ORGANIZATION_NOT_REGISTERED.
const SCHOOLS = [
    { id: 'school_1',  name: 'Escuela Uno' },
    { id: 'school_2',  name: 'Escuela Dos' },
    { id: 'school_d',  name: 'Escuela Doble' },
    { id: 'inst_HA',   name: 'Escuela Homónima' },
];
function writeFixtures() {
    fs.writeFileSync(USERS_TMP,   JSON.stringify(USERS),   'utf8');
    fs.writeFileSync(GROUPS_TMP,  JSON.stringify(GROUPS),  'utf8');
    fs.writeFileSync(SCHOOLS_TMP, JSON.stringify(SCHOOLS), 'utf8');
}
writeFixtures();
// Señuelo obsoleto TEMPORAL: un admin que solo existe fuera del canónico.
fs.writeFileSync(OBSOLETE_TMP, JSON.stringify([{ id: 'u_stale_admin', roles: ['administrador'] }]), 'utf8');

// Estado previo de stores reales del repo (solo stat; para probar que NO se tocan).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAL_STORES = [
    path.join(REPO_ROOT, 'data', 'users_db.json'),
    path.join(REPO_ROOT, 'data', 'groups_db.json'),
    path.join(REPO_ROOT, 'data-critical', 'identity.db'),
];
const statOf = (p) => fs.existsSync(p)
    ? { exists: true, size: fs.statSync(p).size, mtimeMs: fs.statSync(p).mtimeMs }
    : { exists: false };
const realBefore = REAL_STORES.map(statOf);

const cis = await import('../identity/cis.mjs');
const scopeAccess = await import('../aulaViva/scopeAccess.mjs');
const config = await import('../config.js');
const { flags } = await import('../lib/flags.js');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++)
                               : (console.error('  ✗', l, h), fail++);

function fakeRes() {
    return {
        statusCode: null, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b)  { this.body = b; return this; },
    };
}
const evaluate = scopeAccess.evaluateScopeAccess;
const throwsUnavailable = (fn) => {
    try { fn(); return false; } catch (e) { return e?.code === 'IDENTITY_UNAVAILABLE'; }
};

try {
    console.log('\n[0] fuente configurada');
    ok('config.USERS_DB apunta al fixture aislado', config.USERS_DB === USERS_TMP);
    ok('config.GROUPS_DB apunta al fixture aislado', config.GROUPS_DB === GROUPS_TMP);

    console.log('\n[1] resolución contra config.USERS_DB (H4-12)');
    {
        const p = cis.getPrincipal('u_med');
        ok('1a) principal del canónico configurado resuelve', !!p && p.id === 'u_med');
        ok('1b) authorize self → allow', evaluate('u_stu', 'user', 'u_stu').decision === 'allow');
        ok('1c) principal no expone credenciales', p && !('password' in p));
    }

    console.log('\n[2] usuario solo en señuelo obsoleto TEMPORAL → sin identidad ni scope (H3/H4-11)');
    {
        // u_stale_admin existe SOLO en OBSOLETE_TMP (jamás referenciado por código productivo).
        ok('2a) admin del señuelo → unauthenticated', evaluate('u_stale_admin', 'all', '').decision === 'unauthenticated');
        ok('2b) y no allow bajo ningún scope',
            evaluate('u_stale_admin', 'school', 'school_1').decision === 'unauthenticated');
        ok('2c) el señuelo sigue existiendo y NO es el canónico',
            fs.existsSync(OBSOLETE_TMP) && config.USERS_DB !== OBSOLETE_TMP);
    }

    console.log('\n[2s] guarda estática: cadena CIS sin paths de stores (H3)');
    {
        const srcCis   = fs.readFileSync(path.join(REPO_ROOT, 'server', 'identity', 'cis.mjs'), 'utf8');
        const srcScope = fs.readFileSync(path.join(REPO_ROOT, 'server', 'aulaViva', 'scopeAccess.mjs'), 'utf8');
        ok('2s-a) cis.mjs sin literal users_db/groups_db', !/users_db|groups_db/.test(srcCis));
        ok('2s-b) scopeAccess.mjs sin literal users_db/groups_db ni fs', !/users_db|groups_db|node:fs/.test(srcScope));
    }

    console.log('\n[3] identidad ausente/inexistente → 401');
    {
        ok('3a) callerId undefined → unauthenticated', evaluate(undefined, 'user', 'u_stu').decision === 'unauthenticated');
        ok('3b) callerId inexistente → unauthenticated', evaluate('u_ghost', 'user', 'u_stu').decision === 'unauthenticated');
        const res = fakeRes();
        const r = scopeAccess.requireScopeAccess('user', 'u_stu', { headers: {} }, res);
        ok('3c) requireScopeAccess → 401', r === false && res.statusCode === 401);
    }

    console.log('\n[4] principal existente fuera de scope → 403');
    {
        ok('4a) lector sobre otro user → forbidden', evaluate('u_stu', 'user', 'u_stu2').decision === 'forbidden');
        const res = fakeRes();
        const r = scopeAccess.requireScopeAccess('group', 'g_A', { headers: { 'x-user-id': 'u_stu' } }, res);
        ok('4b) requireScopeAccess → 403 scope_access_denied',
            r === false && res.statusCode === 403 && res.body?.error === 'scope_access_denied');
    }

    console.log('\n[5-6] canónico indisponible → IDENTITY_UNAVAILABLE → 503; canAccessScope LANZA (H2/H4-1..3)');
    {
        fs.writeFileSync(USERS_TMP, '{corrupt', 'utf8');
        const d1 = evaluate('u_med', 'school', 'school_1');
        ok('5a) USERS_DB corrupto → unavailable (no forbidden)', d1.decision === 'unavailable' && d1.cause === 'corrupt_store');
        const res = fakeRes();
        scopeAccess.requireScopeAccess('school', 'school_1', { headers: { 'x-user-id': 'u_med' } }, res);
        ok('5b) requireScopeAccess → 503 identity_unavailable',
            res.statusCode === 503 && res.body?.error === 'identity_unavailable');
        ok('6a) getMemberships lanza error tipificado, no [] ordinario',
            throwsUnavailable(() => cis.getMemberships('u_med')));
        ok('6b) canAccessScope con USERS_DB corrupto LANZA tipificado, no false (H2)',
            throwsUnavailable(() => scopeAccess.canAccessScope('u_med', 'school', 'school_1')));

        fs.rmSync(USERS_TMP);
        const d2 = evaluate('u_med', 'school', 'school_1');
        ok('5c) USERS_DB ausente → unavailable missing_store', d2.decision === 'unavailable' && d2.cause === 'missing_store');
        ok('6c) canAccessScope con USERS_DB ausente LANZA tipificado (H2)',
            throwsUnavailable(() => scopeAccess.canAccessScope('u_med', 'school', 'school_1')));
        ok('3d) claim ausente con store roto → 401, no 503 enmascarado',
            evaluate(undefined, 'user', 'x').decision === 'unauthenticated');
        writeFixtures();

        fs.writeFileSync(GROUPS_TMP, JSON.stringify({ not: 'an array' }), 'utf8');
        const d3 = evaluate('u_med', 'group', 'g_A');
        ok('5d) GROUPS_DB inconsistente → unavailable', d3.decision === 'unavailable' && d3.cause === 'inconsistent_store');
        fs.writeFileSync(GROUPS_TMP, '{broken', 'utf8');
        const d4 = evaluate('u_med', 'group', 'g_A');
        ok('5e) GROUPS_DB corrupto → unavailable corrupt_store (H4-2)', d4.decision === 'unavailable' && d4.cause === 'corrupt_store');
        ok('6d) canAccessScope con GROUPS_DB corrupto LANZA tipificado (H2/H4-3)',
            throwsUnavailable(() => scopeAccess.canAccessScope('u_med', 'group', 'g_A')));
        fs.rmSync(GROUPS_TMP);
        const d5 = evaluate('u_med', 'group', 'g_A');
        ok('5f) GROUPS_DB ausente → unavailable missing_store (H4-1)', d5.decision === 'unavailable' && d5.cause === 'missing_store');
        ok('6e) canAccessScope con GROUPS_DB ausente LANZA tipificado (H2/H4-3)',
            throwsUnavailable(() => scopeAccess.canAccessScope('u_med', 'group', 'g_A')));
        ok('6f) ningún fallo de infraestructura concede acceso',
            [d1, d2, d3, d4, d5].every(d => d.decision !== 'allow'));
        writeFixtures();
    }

    console.log('\n[7] membership directa estudiante y mediador');
    {
        ok('7a) mediador → su grupo', evaluate('u_med', 'group', 'g_A').decision === 'allow');
        ok('7b) mediador → user miembro (memberIds)', evaluate('u_med', 'user', 'u_stu').decision === 'allow');
        ok('7c) mediador → user miembro (user.groupIds)', evaluate('u_med', 'user', 'u_stu2').decision === 'allow');
        ok('7d) estudiante → self', evaluate('u_stu', 'user', 'u_stu').decision === 'allow');
        const ms = cis.getMemberships('u_stu');
        ok('7e) getMemberships estudiante = [g_A member]',
            ms.length === 1 && ms[0].groupId === 'g_A' && ms[0].role === 'member');
    }

    console.log('\n[8] multi-membership = unión; rol global no amplía');
    {
        const scope = cis.resolveScope('u_med');
        ok('8a) unión de organizaciones por membership',
            scope.organizationIds.includes('school_1') && scope.organizationIds.includes('school_2'));
        ok('8b) ambas schools accesibles',
            evaluate('u_med', 'school', 'school_1').decision === 'allow' &&
            evaluate('u_med', 'school', 'school_2').decision === 'allow');
        ok('8c) mediador sin grupos → school forbidden (rol no amplía)',
            evaluate('u_med_ng', 'school', 'school_1').decision === 'forbidden');
        ok('8d) mediador sin grupos → group forbidden',
            evaluate('u_med_ng', 'group', 'g_A').decision === 'forbidden');
        ok('8e) admin → allow por política declarada',
            evaluate('u_admin', 'school', 'school_1').via === 'policy:platform_admin_full_institutional_read');
        ok('8f) política declarada existe en PLATFORM_POLICIES',
            typeof cis.PLATFORM_POLICIES.platform_admin_full_institutional_read === 'string');
    }

    console.log('\n[9] CHP-ID-GROUPS-RECON-01B: cero autorización basada en texto');
    {
        // El fallback legacy por nombre de colegio ERA autorización textual.
        // Ahora no existe en ninguna decisión de scope.
        ok('9a) el colegio ya NO convierte a nadie en miembro',
            evaluate('u_med', 'user', 'u_fb').decision === 'forbidden');
        ok('9b) getMemberships no emite ninguna vía legacy_colegio_fallback',
            cis.getMemberships('u_fb').every(m => m.via === 'explicit'));
        ok('9c) colegio distinto tampoco entra',
            evaluate('u_med', 'user', 'u_fb_otro').decision === 'forbidden');
        ok('9d) escuela multi-grupo sigue denegando',
            evaluate('u_med', 'user', 'u_dd').decision === 'forbidden');
        ok('9e) identidad ausente no se sustituye por texto',
            evaluate('u_ghost_fb', 'user', 'u_fb').decision === 'unauthenticated');
        ok('9f) instituciones homónimas no comparten scope',
            evaluate('u_med', 'user', 'u_hm').decision === 'forbidden' &&
            cis.getMemberships('u_hm').length === 0);
        ok('9g) nombre solo "parecido" no matchea',
            cis.getMemberships('u_fb_casi').every(m => m.groupId !== 'g_FB') &&
            evaluate('u_med', 'user', 'u_fb_casi').decision === 'forbidden');
        ok('9h) organización NO registrada → ORGANIZATION_NOT_REGISTERED',
            evaluate('u_med', 'school', 'school_fb').cause === 'ORGANIZATION_NOT_REGISTERED');
        ok('9i) grupo cuya organización no está registrada no da scope',
            evaluate('u_med', 'group', 'g_FB').decision === 'forbidden' &&
            evaluate('u_med', 'group', 'g_FB').cause === 'ORGANIZATION_NOT_REGISTERED');
        ok('9j) grupo histórico (sin organizationId) no da scope',
            evaluate('u_med', 'group', 'g_HIST').cause === 'GROUP_HISTORICAL');
        ok('9k) mediar un grupo histórico no da visibilidad sobre sus miembros',
            evaluate('u_med', 'user', 'u_hist').decision === 'forbidden');
        ok('9l) el scope activo excluye los grupos fuera de scope',
            !cis.resolveScope('u_med').mediatorGroupIds.includes('g_FB') &&
            !cis.resolveScope('u_med').mediatorGroupIds.includes('g_HIST'));
        ok('9m) scope_id que es un NOMBRE de colegio nunca autoriza',
            evaluate('u_med', 'school', 'Escuela Uno').cause === 'ORGANIZATION_NOT_REGISTERED');
        ok('9n) alias `organization` se comporta igual que `school`',
            evaluate('u_med', 'organization', 'school_1').decision === 'allow');
    }

    console.log('\n[10] kind: real | synthetic | unknown (H4-7/8)');
    {
        ok('10a) kind ausente → unknown', cis.getPrincipal('u_stu2').kind === 'unknown');
        ok('10b) kind persistido synthetic', cis.getPrincipal('u_stu').kind === 'synthetic');
        ok('10c) kind persistido real', cis.getPrincipal('u_admin').kind === 'real');
        ok('10d) kind "REAL" (case) → unknown', cis.getPrincipal('u_k1').kind === 'unknown');
        ok('10e) kind 42 → unknown', cis.getPrincipal('u_k2').kind === 'unknown');
        ok('10f) kind "bot" → unknown', cis.getPrincipal('u_k3').kind === 'unknown');
    }

    console.log('\n[11] entradas anómalas y errores inesperados → jamás allow (H4-9/10)');
    {
        ok('11a) scope_type numérico → forbidden', evaluate('u_med', 123, 'x').decision === 'forbidden');
        ok('11b) scope_type null → forbidden', evaluate('u_med', null, 'x').decision === 'forbidden');
        ok('11c) principalId objeto → unauthenticated', evaluate({ id: 'u_med' }, 'all', '').decision === 'unauthenticated');
        ok('11d) scope_id objeto raro → no allow', evaluate('u_med', 'group', { evil: 1 }).decision !== 'allow');
        // Error inesperado real: scope_id cuyo toString lanza. Debe PROPAGARSE
        // (no es IDENTITY_UNAVAILABLE) y jamás traducirse en acceso.
        let unexpected = null;
        try { evaluate('u_med', 'group', { toString() { throw new Error('boom'); } }); }
        catch (e) { unexpected = e; }
        ok('11e) error inesperado se propaga sin conceder',
            unexpected instanceof Error && unexpected.code !== 'IDENTITY_UNAVAILABLE');
    }

    console.log('\n[12] flags identity.db intactos, sin escrituras');
    {
        ok('12a) IDENTITY_SQLITE_ENABLED off', flags.identitySqliteEnabled() === false);
        ok('12b) IDENTITY_READ=json', flags.identityReadSource() === 'json');
    }

    console.log('\n[13] stores reales del repo INTACTOS (H3: existencia/tamaño/mtime)');
    {
        const realAfter = REAL_STORES.map(statOf);
        ok('13a) data/users_db.json, data/groups_db.json e identity.db sin cambios',
            JSON.stringify(realAfter) === JSON.stringify(realBefore));
    }

    console.log('\n[14] validación read-only sobre el fixture canónico (evidencia fechada, no invariante)');
    {
        const users = JSON.parse(fs.readFileSync(USERS_TMP, 'utf8'));
        let resolved = 0, denied = 0, errors = 0;
        const kinds = { real: 0, synthetic: 0, unknown: 0 };
        for (const u of users) {
            try {
                const p = cis.getPrincipal(u.id);
                if (p) { resolved++; kinds[p.kind]++; } else denied++;
            } catch { errors++; }
        }
        console.log(`  · corte ${new Date().toISOString()}: total=${users.length} resueltos=${resolved} ` +
                    `denegados=${denied} errores=${errors} kinds=${JSON.stringify(kinds)}`);
        ok('14a) todos los principales del canónico resuelven', resolved === users.length && errors === 0);
        ok('14b) clasificación por atributo, sin constantes poblacionales',
            kinds.real + kinds.synthetic + kinds.unknown === resolved);
    }

    console.log(`\nRESULT: pass=${pass} fail=${fail}`);
    if (fail > 0) process.exitCode = 1;
} finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
