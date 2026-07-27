/**
 * shadowScopeEquivalence.test.mjs — CHP-ID-CANON-01B, Fase 3.
 *
 * El comparador shadow (scripts/shadow-scope-compare.mjs) corre DENTRO del
 * contenedor productivo, donde `server/identity/cis.mjs` todavía no existe, así
 * que MODELO B es una réplica de la capa de decisión del CIS. Este test prueba
 * que la réplica y el CIS real coinciden decisión a decisión sobre una matriz de
 * fixtures sintéticas: sin esto, los agregados del shadow no serían evidencia.
 *
 * Fixtures 100% sintéticas en mkdtemp. No toca stores reales.
 *
 *   node scripts/__test__/shadowScopeEquivalence.test.mjs
 */
import '../../server/__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadoweq_'));
const USERS_TMP   = path.join(tmpDir, 'usuarios_colegios_oro.json');
const GROUPS_TMP  = path.join(tmpDir, 'groups_db.json');
const SCHOOLS_TMP = path.join(tmpDir, 'schools_db.json');
process.env.USERS_DB   = USERS_TMP;
process.env.GROUPS_DB  = GROUPS_TMP;
process.env.SCHOOLS_DB = SCHOOLS_TMP;

// Matriz deliberadamente heterogénea: roles en `roles[]`, en `role` y en `rol`;
// mediación por mediatorId / mediatorIds / mediadores; miembros por memberIds,
// studentIds y user.groupIds; escuela mono-grupo (fallback legacy) y
// multi-grupo (sin fallback); usuarios sin rol y roles desconocidos.
const USERS = [
    { id: 'u_admin_arr', roles: ['administrador'] },
    { id: 'u_admin_sing', role: 'admin' },
    { id: 'u_admin_rol',  rol: 'Administrador' },
    { id: 'u_med_arr',   roles: ['mediador'] },
    { id: 'u_med_prof',  role: 'profesor' },
    { id: 'u_med_rol',   rol: 'coordinator' },
    { id: 'u_med_nogrp', roles: ['profesor'] },
    { id: 'u_stu_member',  roles: ['lector'] },
    { id: 'u_stu_student', roles: ['lector'] },
    { id: 'u_stu_bygroup', roles: ['lector'], groupIds: ['g_b'] },
    { id: 'u_fb',        roles: ['lector'], colegio: 'Escuela Mono' },
    { id: 'u_fb_multi',  roles: ['lector'], colegio: 'Escuela Multi' },
    { id: 'u_norole',    nombre_completo: 'Sin rol' },
    { id: 'u_weirdrole', roles: ['bibliotecario_jefe'] },
    { id: 'u_lt1', roles: ['lector'], _loadtest_marker: true },   // sintéticos: marcan g_synth
    { id: 'u_lt2', roles: ['lector'], _loadtest_marker: true },
];
// CHP-ID-GROUPS-RECON-01B: `organizationId` es la autoridad y solo vale si está
// registrado. Se incluyen a propósito grupos ACTIVE_REAL, históricos (sin
// organización o con una no registrada) y sintéticos (miembros loadtest).
const GROUPS = [
    { id: 'g_a',  school: 'Escuela A',     organizationId: 'sch_a',  mediatorIds: ['u_med_arr'], memberIds: ['u_stu_member'], studentIds: ['u_stu_student'] },
    { id: 'g_b',  school: 'Escuela B',     organizationId: 'sch_b',  mediatorId: 'u_med_prof' },
    { id: 'g_c',  school: 'Escuela C',     organizationId: 'sch_c',  mediadores: ['u_med_rol'] },
    { id: 'g_mono', school: 'Escuela Mono', organizationId: 'sch_mono', mediatorIds: ['u_med_arr'] },
    { id: 'g_m1', school: 'Escuela Multi', organizationId: 'sch_multi', mediatorIds: ['u_med_prof'] },
    { id: 'g_m2', school: 'Escuela Multi', organizationId: 'sch_multi', mediatorIds: [] },
    { id: 'g_noschool', mediatorIds: ['u_med_arr'] },                                   // histórico
    { id: 'g_unreg', school: 'Escuela X', organizationId: 'sch_no_registrada', mediatorIds: ['u_med_arr'] },
    { id: 'g_synth', organizationId: 'lt-org', mediatorIds: ['u_med_arr'], memberIds: ['u_lt1', 'u_lt2'] },
];
// `sch_c` y `sch_no_registrada` quedan fuera del registro a propósito.
const SCHOOLS = [
    { id: 'sch_a', name: 'Escuela A' },
    { id: 'sch_b', name: 'Escuela B' },
    { id: 'sch_mono', name: 'Escuela Mono' },
    { id: 'sch_multi', name: 'Escuela Multi' },
];

fs.writeFileSync(USERS_TMP,   JSON.stringify(USERS),   'utf8');
fs.writeFileSync(GROUPS_TMP,  JSON.stringify(GROUPS),  'utf8');
fs.writeFileSync(SCHOOLS_TMP, JSON.stringify(SCHOOLS), 'utf8');

const cis = await import('../../server/identity/cis.mjs');
const shadow = await import('../shadow-scope-compare.mjs');
const gm = await import('../../utils/groupMembership.mjs');

const decideB = shadow.makeModelB(USERS, GROUPS, gm, SCHOOLS);

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (pass++)
    : (console.error('  ✗', label, hint), fail++);

console.log('shadowScopeEquivalence — CHP-ID-CANON-01B');

// ── Equivalencia exhaustiva réplica ↔ CIS real ──────────────────────────────
console.log('\n[A] MODELO B ≡ cis.authorizeScope');
{
    const scopeTypes = ['user', 'group', 'club', 'school', 'library', 'all',
                        'intervention', 'risk', 'habit', 'modality', 'trajectory', 'inventado'];
    const targets = [
        ...USERS.map(u => u.id),
        ...GROUPS.map(g => g.id),
        ...[...new Set(GROUPS.map(g => g.schoolId).filter(Boolean))],
        'inexistente', '',
    ];

    let compared = 0, mismatches = 0;
    const sample = [];
    for (const caller of [...USERS.map(u => u.id), 'u_no_existe', '']) {
        for (const type of scopeTypes) {
            for (const target of targets) {
                const real = cis.authorizeScope(caller, type, target);
                const rep  = decideB(caller, type, target);
                const realAllow = real.decision === 'allow';
                compared++;
                if (realAllow !== rep.allow) {
                    mismatches++;
                    if (sample.length < 5) sample.push({ caller, type, target, real: real.decision, rep: rep.allow });
                }
            }
        }
    }
    ok(`réplica y CIS coinciden en las ${compared} decisiones`, mismatches === 0,
        JSON.stringify(sample));
    console.log(`  ✓ ${compared} decisiones comparadas, ${mismatches} divergencias`);
}

// ── MODELO A reproduce la semántica legacy (role singular) ──────────────────
console.log('\n[B] MODELO A reproduce el scopeAccess desplegado');
{
    const decideA = shadow.makeModelA(USERS, GROUPS);
    ok('legacy reconoce admin por `role` singular',
        decideA('u_admin_sing', 'group', 'g_a').allow === true);
    ok('legacy NO reconoce admin declarado solo en `roles[]`',
        decideA('u_admin_arr', 'group', 'g_a').allow === false);
    ok('legacy NO reconoce rol declarado solo en `rol`',
        decideA('u_admin_rol', 'group', 'g_a').allow === false);
    ok('legacy reconoce mediador por `role` singular',
        decideA('u_med_prof', 'group', 'g_b').allow === true);
    ok('legacy resuelve `user` solo por memberIds (sin studentIds)',
        decideA('u_med_arr', 'user', 'u_stu_member').allow === false, 'u_med_arr no tiene role singular');
    ok('legacy: caller ausente del padrón → deny',
        decideA('u_no_existe', 'all', 'all').allow === false);
    ok('legacy: self scope siempre permitido si el caller existe',
        decideA('u_stu_member', 'user', 'u_stu_member').allow === true);
    console.log('  ✓ semántica legacy reproducida');
}

// ── El CIS aporta lo que el legacy no ve ────────────────────────────────────
console.log('\n[C] Diferencias estructurales esperadas');
{
    ok('CIS reconoce admin en `roles[]` (legacy no)',
        cis.authorizeScope('u_admin_arr', 'group', 'g_a').decision === 'allow');
    ok('CIS reconoce mediación por mediatorIds con roles[]',
        cis.authorizeScope('u_med_arr', 'group', 'g_a').decision === 'allow');
    ok('CIS resuelve miembros por studentIds además de memberIds',
        cis.authorizeScope('u_med_arr', 'user', 'u_stu_student').decision === 'allow');
    ok('CIS respeta el aislamiento: mediador no ve grupo ajeno',
        cis.authorizeScope('u_med_arr', 'group', 'g_b').decision === 'forbidden');
    ok('CIS: rol desconocido no concede agregados',
        cis.authorizeScope('u_weirdrole', 'all', 'all').decision === 'forbidden');
    ok('CIS: usuario sin rol no concede agregados',
        cis.authorizeScope('u_norole', 'all', 'all').decision === 'forbidden');
    console.log('  ✓ el CIS no amplía scope fuera de relaciones verificables');
}

// ── Clasificador de deltas ──────────────────────────────────────────────────
console.log('\n[D] Clasificación de deltas');
{
    const c = shadow.classifyDelta;
    ok('idénticas → IDENTICAL',
        c({ a: { allow: true }, b: { allow: true }, ctx: {} }) === 'IDENTICAL');
    ok('deny→allow con mediación verificable → EXPECTED_RESTORE',
        c({ a: { allow: false }, b: { allow: true },
            ctx: { callerInOro: true, callerMediatesTarget: true } }) === 'EXPECTED_RESTORE_LEGITIMATE_ACCESS');
    ok('deny→allow sin relación verificable → HIGH_RISK_ACCESS_EXPANSION',
        c({ a: { allow: false }, b: { allow: true },
            ctx: { callerInOro: true, callerMediatesTarget: false, isSelf: false, callerIsAdminB: false } })
            === 'HIGH_RISK_ACCESS_EXPANSION');
    ok('deny→allow de un caller ausente del canónico → HIGH_RISK_ACCESS_EXPANSION',
        c({ a: { allow: false }, b: { allow: true }, ctx: { callerInOro: false } })
            === 'HIGH_RISK_ACCESS_EXPANSION');
    ok('allow→deny de caller ausente del canónico → EXPECTED_REMOVE',
        c({ a: { allow: true }, b: { allow: false }, ctx: { callerInOro: false } })
            === 'EXPECTED_REMOVE_INCORRECT_ACCESS');
    ok('allow→deny de un mediador legítimo → HIGH_RISK_ACCESS_LOSS',
        c({ a: { allow: true }, b: { allow: false },
            ctx: { callerInOro: true, callerMediatesTarget: true } }) === 'HIGH_RISK_ACCESS_LOSS');
    console.log('  ✓ clasificador coherente');
}

// ── Higiene ─────────────────────────────────────────────────────────────────
console.log('\n[E] Higiene del comparador');
{
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, '..', 'shadow-scope-compare.mjs'), 'utf8');
    ok('el comparador no escribe en disco',
        !/writeFileSync|appendFileSync|createWriteStream|\.writeFile\(/.test(src));
    ok('el comparador no imprime emails ni nombres',
        !/\.email|nombre_completo|password/.test(src));
    console.log('  ✓ read-only y sin PII');
}

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
