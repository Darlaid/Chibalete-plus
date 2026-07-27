/**
 * organizationScope.test.js — CHP-ID-GROUPS-RECON-01B-R1.
 *
 * Fija el contrato institucional canónico en runtime:
 *
 *   §1  `organizationId` es la única autoridad institucional
 *   §2  `schoolId` no se lee ni se escribe en ninguna parte del runtime
 *   §3  un grupo con organización REGISTRADA concede scope
 *   §4  un grupo sin organizationId no concede scope
 *   §5  un grupo histórico no concede scope
 *   §6  un grupo sintético no concede scope
 *   §7  `lt-org` queda excluido
 *   §8  los nombres (colegio/school) no generan ninguna asociación
 *
 * Fixtures 100% sintéticas en mkdtemp; no toca stores reales.
 *
 *   node server/__test__/organizationScope.test.js
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'orgscope_'));
const USERS_TMP   = path.join(tmpDir, 'usuarios_colegios_oro.json');
const GROUPS_TMP  = path.join(tmpDir, 'groups_db.json');
const SCHOOLS_TMP = path.join(tmpDir, 'schools_db.json');
process.env.USERS_DB   = USERS_TMP;
process.env.GROUPS_DB  = GROUPS_TMP;
process.env.SCHOOLS_DB = SCHOOLS_TMP;

// Reproduce a escala la topología productiva: una institución real registrada,
// una organización declarada pero NO registrada, un grupo histórico sin
// organización, un grupo sintético de carga, y homónimos por nombre.
const USERS = [
    { id: 'u_med',     roles: ['mediador'], colegio: 'Institución Real' },
    { id: 'u_stu',     roles: ['lector'],   colegio: 'Institución Real' },
    { id: 'u_hist',    roles: ['lector'],   colegio: 'Institución Histórica' },
    { id: 'u_lt1',     roles: ['lector'],   _loadtest_marker: true },
    { id: 'u_lt2',     roles: ['lector'],   _loadtest_marker: true },
    // Mismo NOMBRE de colegio que el grupo real, pero sin membresía explícita.
    { id: 'u_por_nombre', roles: ['lector'], colegio: 'Institución Real' },
    { id: 'u_admin',   roles: ['administrador'] },
];
const GROUPS = [
    { id: 'g_real',   school: 'Institución Real',      organizationId: 'org-real',
      mediatorIds: ['u_med'], memberIds: ['u_stu'], studentIds: ['u_stu'] },
    { id: 'g_unreg',  school: 'Institución Sin Registro', organizationId: 'org-no-registrada',
      mediatorIds: ['u_med'], memberIds: [] },
    { id: 'g_hist',   school: 'Institución Histórica', mediatorIds: ['u_med'], memberIds: ['u_hist'] },
    { id: 'g_synth',  organizationId: 'lt-org', mediatorIds: ['u_med'], memberIds: ['u_lt1', 'u_lt2'] },
    // Grupo con el MISMO nombre visible que el real, pero otra organización sin registrar.
    { id: 'g_homon',  school: 'Institución Real', organizationId: 'org-homonima', mediatorIds: ['u_med'] },
];
const SCHOOLS = [{ id: 'org-real', name: 'Institución Real' }];

fs.writeFileSync(USERS_TMP,   JSON.stringify(USERS),   'utf8');
fs.writeFileSync(GROUPS_TMP,  JSON.stringify(GROUPS),  'utf8');
fs.writeFileSync(SCHOOLS_TMP, JSON.stringify(SCHOOLS), 'utf8');

const cis = await import('../identity/cis.mjs');
const orgScope = await import('../identity/organizationScope.mjs');
const scopeAccess = await import('../aulaViva/scopeAccess.mjs');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);
const evaluate = scopeAccess.evaluateScopeAccess;

console.log('organizationScope — CHP-ID-GROUPS-RECON-01B-R1');

// ── §1 ──────────────────────────────────────────────────────────────────────
console.log('\n[1] organizationId es la única autoridad');
{
    const ctx = {
        registeredOrgIds: orgScope.registeredOrganizationIds(SCHOOLS),
        usersById: new Map(USERS.map(u => [u.id, u])),
    };
    ok('un organizationId registrado clasifica ACTIVE_REAL',
        orgScope.classifyGroup(GROUPS[0], ctx).class === orgScope.GROUP_CLASS.ACTIVE_REAL);
    ok('activeOrganizationIdOf devuelve la organización del grupo real',
        orgScope.activeOrganizationIdOf(GROUPS[0], ctx) === 'org-real');
    ok('activeOrganizationIdOf es null fuera de scope',
        orgScope.activeOrganizationIdOf(GROUPS[1], ctx) === null);
    ok('el scope del mediador se expresa en organizationIds',
        JSON.stringify(cis.resolveScope('u_med').organizationIds) === JSON.stringify(['org-real']));
    ok('resolveScope ya no expone schoolIds',
        cis.resolveScope('u_med').schoolIds === undefined);
    const summary = orgScope.summarizeGroups(GROUPS, ctx);
    ok('resumen: 1 activo, 1 sintético, 3 históricos',
        summary.ACTIVE_REAL === 1 && summary.SYNTHETIC_OUT_OF_SCOPE === 1
        && summary.HISTORICAL_OUT_OF_SCOPE === 3, JSON.stringify(summary));
}

// ── §2 ──────────────────────────────────────────────────────────────────────
console.log('\n[2] schoolId no se lee ni se escribe');
{
    const RUNTIME_DIRS = ['server', 'utils', 'services', 'engines', 'hooks', 'pages', 'components'];
    const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
    const offenders = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
            if (!EXT.has(path.extname(e.name))) continue;
            const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
            if (rel.includes('/__test__/') || rel.includes('/__tests__/') || rel.includes('.test.')) continue;
            const src = fs.readFileSync(full, 'utf8');
            // Solo acceso al CAMPO de un grupo: `<algo>.schoolId`, donde <algo>
            // es una variable de grupo. El identificador `schoolId` del dominio
            // de métricas (un slug derivado del NOMBRE del colegio, expuesto por
            // /api/metrics/school/:schoolId) es otra cosa y no se persiste en
            // ningún store, así que no entra aquí.
            const m = src.match(/\b(\w+)\.schoolId\b/g) || [];
            const groupFieldAccess = m.filter(x => /^(g|grp|group|grupo)\d*\.schoolId$/.test(x));
            if (groupFieldAccess.length > 0) offenders.push(`${rel} (${groupFieldAccess.join(',')})`);
        }
    };
    for (const d of RUNTIME_DIRS) {
        const abs = path.join(REPO_ROOT, d);
        if (fs.existsSync(abs)) walk(abs);
    }
    ok('0 accesos runtime al campo group.schoolId', offenders.length === 0, offenders.join(' | '));

    const cisSrc = fs.readFileSync(path.join(REPO_ROOT, 'server', 'identity', 'cis.mjs'), 'utf8');
    ok('el CIS no accede a schoolId', !/\.schoolId\b|schoolId\s*:/.test(cisSrc));
    const cohortSrc = fs.readFileSync(path.join(REPO_ROOT, 'server', 'services', 'cohortBuilder.mjs'), 'utf8');
    ok('cohortBuilder resuelve la cohorte institucional por organizationId',
        /g\.organizationId === scopeId/.test(cohortSrc) && !/g\.schoolId/.test(cohortSrc));
    ok('el CIS lee SCHOOLS_DB desde config', /SCHOOLS_DB/.test(cisSrc));
}

// ── §3 ──────────────────────────────────────────────────────────────────────
console.log('\n[3] grupo con organización registrada concede scope');
{
    ok('mediador → su grupo real', evaluate('u_med', 'group', 'g_real').decision === 'allow');
    ok('mediador → su organización', evaluate('u_med', 'school', 'org-real').decision === 'allow');
    ok('alias organization equivalente', evaluate('u_med', 'organization', 'org-real').decision === 'allow');
    ok('mediador → miembro explícito de su grupo real',
        evaluate('u_med', 'user', 'u_stu').decision === 'allow');
    ok('el estudiante conserva su scope personal',
        evaluate('u_stu', 'user', 'u_stu').decision === 'allow');
}

// ── §4 y §5 ─────────────────────────────────────────────────────────────────
console.log('\n[4/5] grupos sin organización y grupos históricos');
{
    const d = evaluate('u_med', 'group', 'g_hist');
    ok('grupo sin organizationId → forbidden', d.decision === 'forbidden');
    ok('con causa GROUP_HISTORICAL', d.cause === 'GROUP_HISTORICAL', d.cause);
    const u = evaluate('u_med', 'group', 'g_unreg');
    ok('organización no registrada → forbidden', u.decision === 'forbidden');
    ok('con causa ORGANIZATION_NOT_REGISTERED', u.cause === 'ORGANIZATION_NOT_REGISTERED', u.cause);
    ok('scope de organización no registrada → forbidden',
        evaluate('u_med', 'school', 'org-no-registrada').cause === 'ORGANIZATION_NOT_REGISTERED');
    ok('mediar un grupo histórico no da visibilidad sobre sus miembros',
        evaluate('u_med', 'user', 'u_hist').decision === 'forbidden');
    ok('los grupos fuera de scope no entran en mediatorGroupIds',
        !cis.resolveScope('u_med').mediatorGroupIds.includes('g_hist')
        && !cis.resolveScope('u_med').mediatorGroupIds.includes('g_unreg'));
}

// ── §6 y §7 ─────────────────────────────────────────────────────────────────
console.log('\n[6/7] grupos sintéticos y lt-org');
{
    const ctx = {
        registeredOrgIds: orgScope.registeredOrganizationIds(SCHOOLS),
        usersById: new Map(USERS.map(u => [u.id, u])),
    };
    ok('el grupo de carga clasifica SYNTHETIC_OUT_OF_SCOPE',
        orgScope.classifyGroup(GROUPS[3], ctx).class === orgScope.GROUP_CLASS.SYNTHETIC_OUT_OF_SCOPE);
    const d = evaluate('u_med', 'group', 'g_synth');
    ok('grupo sintético → forbidden', d.decision === 'forbidden');
    ok('con causa GROUP_SYNTHETIC', d.cause === 'GROUP_SYNTHETIC', d.cause);
    ok('lt-org no concede scope de organización',
        evaluate('u_med', 'school', 'lt-org').cause === 'ORGANIZATION_NOT_REGISTERED');
    ok('mediar el grupo sintético no da visibilidad sobre sus miembros',
        evaluate('u_med', 'user', 'u_lt1').decision === 'forbidden');
    ok('un grupo vacío NO es sintético (vacuidad rechazada)',
        orgScope.isSyntheticGroup({ id: 'x', memberIds: [] }, ctx.usersById) === false);
    ok('un grupo con un solo miembro real NO es sintético',
        orgScope.isSyntheticGroup({ id: 'x', memberIds: ['u_lt1', 'u_stu'] }, ctx.usersById) === false);
}

// ── §8 ──────────────────────────────────────────────────────────────────────
console.log('\n[8] los nombres nunca generan asociación');
{
    ok('mismo colegio que el grupo real NO convierte en miembro',
        evaluate('u_med', 'user', 'u_por_nombre').decision === 'forbidden');
    ok('getMemberships no devuelve vías por nombre',
        cis.getMemberships('u_por_nombre').every(m => m.via === 'explicit'));
    ok('un grupo homónimo con otra organización no hereda scope',
        evaluate('u_med', 'group', 'g_homon').cause === 'ORGANIZATION_NOT_REGISTERED');
    ok('el nombre del colegio no sirve como scope_id',
        evaluate('u_med', 'school', 'Institución Real').cause === 'ORGANIZATION_NOT_REGISTERED');
    ok('el admin sigue pasando por su política declarada',
        evaluate('u_admin', 'school', 'org-real').via === 'policy:platform_admin_full_institutional_read');
}

// ── Higiene ─────────────────────────────────────────────────────────────────
console.log('\n[9] higiene');
{
    ok('las decisiones no exponen PII',
        ['user', 'group', 'school'].every(t => {
            const s = JSON.stringify(evaluate('u_med', t, 'x'));
            return !s.includes('@') && !s.includes('password') && !s.includes('colegio');
        }));
    ok('organizationScope.mjs es puro (no abre archivos)',
        !/require\(|from 'node:fs'|from "node:fs"/.test(
            fs.readFileSync(path.join(REPO_ROOT, 'server', 'identity', 'organizationScope.mjs'), 'utf8')));
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
