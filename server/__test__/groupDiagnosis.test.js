/**
 * groupDiagnosis.test.js — Sprint visibilidad.
 *
 * Cubre la helper buildGroupDiagnosis para los 6 escenarios canónicos:
 *   1. Grupo sano (todo explícito, sin huérfanos, sin fallback)
 *   2. Grupo vacío
 *   3. Grupo con divergencia studentIds vs memberIds (ERROR)
 *   4. Grupo con IDs huérfanos (ERROR)
 *   5. Grupo con bidireccionalidad rota: member_without_groupId (ERROR)
 *   6. Grupo dependiente de fallback colegio (WARNING)
 *   7. Grupo con via_user_groupIds_only (WARNING)
 *   8. Grupo no encontrado (sentinel)
 *   9. Combinaciones — múltiples warnings/errors a la vez
 *  10. Forma estable de la respuesta — todos los campos para el frontend
 *
 * Cómo correr:
 *   node server/__test__/groupDiagnosis.test.js
 */

import { buildGroupDiagnosis } from '../../utils/groupDiagnosis.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
const setEq = (a, b) => {
    const A = new Set(a), B = new Set(b);
    if (A.size !== B.size) return false;
    for (const x of A) if (!B.has(x)) return false;
    return true;
};
const hasItem  = (arr, type) => arr.some(i => i.type === type);
const findItem = (arr, type) => arr.find(i => i.type === type);
const notEmpty = (s) => typeof s === 'string' && s.length > 0;

console.log('groupDiagnosis — Sprint visibilidad');

// ────────────────────────────────────────────────────────────────────────────
// 1. GRUPO SANO — OK
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', name: '6A', school: 'Villas', type: 'course',
                    studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] };
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] },
    ];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('SANO: healthStatus=OK',                d.healthStatus === 'OK');
    ok('SANO: tone=ok',                        d.summary.tone === 'ok');
    ok('SANO: totalMembers=2',                 d.totalMembers === 2);
    ok('SANO: channels.explicit=2',            d.channels.explicit === 2);
    ok('SANO: channels.viaUserGroupIds=0',     d.channels.viaUserGroupIds === 0);
    ok('SANO: channels.fallbackColegio=0',     d.channels.fallbackColegio === 0);
    ok('SANO: sin inconsistencias',            d.inconsistencies.length === 0);
    ok('SANO: sin warnings',                   d.warnings.length === 0);
    ok('SANO: headline menciona el conteo',    /2 estudiante/.test(d.summary.headline));
}

// ────────────────────────────────────────────────────────────────────────────
// 2. GRUPO VACÍO — WARNING
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', name: '6A', school: 'Villas', type: 'course',
                    studentIds: [], memberIds: [] };
    const groups = [
        group,
        { id: 'g2', school: 'Villas', studentIds: ['anchor'], memberIds: ['anchor'] }, // multi-grupo desactiva fallback
    ];
    const users = [{ id: 'anchor', roles: ['lector'], colegio: 'Villas', groupIds: ['g2'] }];
    const d = buildGroupDiagnosis(group, users, groups);

    ok('VACÍO: healthStatus=WARNING',          d.healthStatus === 'WARNING');
    ok('VACÍO: tone=warning',                  d.summary.tone === 'warning');
    ok('VACÍO: totalMembers=0',                d.totalMembers === 0);
    ok('VACÍO: warning group_empty presente',  hasItem(d.warnings, 'group_empty'));
    ok('VACÍO: sin inconsistencias',           d.inconsistencies.length === 0);
    ok('VACÍO: headline lo dice claro',
        /no tiene estudiantes/i.test(d.summary.headline));
    const w = findItem(d.warnings, 'group_empty');
    ok('VACÍO: warning trae message',          notEmpty(w.message));
    ok('VACÍO: warning trae cause',            notEmpty(w.cause));
    ok('VACÍO: warning trae recommendedAction', notEmpty(w.recommendedAction));
}

// ────────────────────────────────────────────────────────────────────────────
// 3. DIVERGENCIA studentIds vs memberIds — ERROR
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', school: 'Villas', studentIds: ['u1', 'u2'], memberIds: ['u1'] };
    const users = [
        { id: 'u1', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], groupIds: ['g1'] },
    ];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('DIVERG: healthStatus=ERROR',           d.healthStatus === 'ERROR');
    ok('DIVERG: tone=error',                   d.summary.tone === 'error');
    ok('DIVERG: inconsistency studentMember_divergence',
        hasItem(d.inconsistencies, 'studentMember_divergence'));
    const inc = findItem(d.inconsistencies, 'studentMember_divergence');
    ok('DIVERG: incluye u2 en userIds',        inc.userIds.includes('u2'));
    ok('DIVERG: count > 0',                    inc.count > 0);
    ok('DIVERG: trae cause',                   notEmpty(inc.cause));
    ok('DIVERG: trae recommendedAction',       notEmpty(inc.recommendedAction));
}

// ────────────────────────────────────────────────────────────────────────────
// 4. IDS HUÉRFANOS — ERROR
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', school: 'Villas', studentIds: ['u1', 'ghost'], memberIds: ['u1', 'ghost'] };
    const users = [{ id: 'u1', roles: ['lector'], groupIds: ['g1'] }];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('HUÉRFANOS: healthStatus=ERROR',                d.healthStatus === 'ERROR');
    ok('HUÉRFANOS: inconsistency orphan_member_ids',   hasItem(d.inconsistencies, 'orphan_member_ids'));
    const inc = findItem(d.inconsistencies, 'orphan_member_ids');
    ok('HUÉRFANOS: ghost detectado',                   inc.userIds.includes('ghost'));
    ok('HUÉRFANOS: count = 1',                         inc.count === 1);
    ok('HUÉRFANOS: u1 NO marcado huérfano',            !inc.userIds.includes('u1'));
}

// ────────────────────────────────────────────────────────────────────────────
// 5. MEMBER_WITHOUT_GROUPID — drift inverso — ERROR
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', school: 'Villas', studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] };
    const users = [
        { id: 'u1', roles: ['lector'], groupIds: ['g1'] }, // OK
        { id: 'u2', roles: ['lector'], groupIds: [] },     // drift: en grupo pero su perfil no lo refleja
    ];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('DRIFT-INV: healthStatus=ERROR',                       d.healthStatus === 'ERROR');
    ok('DRIFT-INV: inconsistency member_without_groupId',     hasItem(d.inconsistencies, 'member_without_groupId'));
    const inc = findItem(d.inconsistencies, 'member_without_groupId');
    ok('DRIFT-INV: u2 detectado',                              inc.userIds.includes('u2'));
    ok('DRIFT-INV: u1 NO marcado',                             !inc.userIds.includes('u1'));
}

// ────────────────────────────────────────────────────────────────────────────
// 6. FALLBACK COLEGIO ACTIVO — WARNING
//
// Setup: un solo grupo en la escuela, sin miembros explícitos, lectores con
// `colegio = group.school`. La fuente única los resuelve por fallback.
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', school: 'Villas', studentIds: [], memberIds: [] };
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas' },
        { id: 'u2', roles: ['lector'], colegio: 'Villas' },
    ];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('FALLBACK: healthStatus=WARNING',          d.healthStatus === 'WARNING');
    ok('FALLBACK: totalMembers=2',                d.totalMembers === 2);
    ok('FALLBACK: channels.fallbackColegio=2',    d.channels.fallbackColegio === 2);
    ok('FALLBACK: channels.explicit=0',           d.channels.explicit === 0);
    ok('FALLBACK: warning fallback_colegio_active', hasItem(d.warnings, 'fallback_colegio_active'));
    const w = findItem(d.warnings, 'fallback_colegio_active');
    ok('FALLBACK: cita ambos userIds',            setEq(w.userIds, ['u1', 'u2']));
    ok('FALLBACK: NO dispara group_empty',        !hasItem(d.warnings, 'group_empty'));
    ok('FALLBACK: mensaje habla de "colegio"',    /colegio/i.test(w.message));
}

// ────────────────────────────────────────────────────────────────────────────
// 7. VIA_USER_GROUPIDS_ONLY — WARNING
//
// Setup: el user dice que pertenece al grupo (user.groupIds incluye g1) pero
// el grupo no lo lista en studentIds/memberIds. La fuente única lo resuelve
// como miembro pero el snapshot del grupo está desactualizado.
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u1'] };
    const users = [
        { id: 'u1', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], groupIds: ['g1'] }, // declara pertenecer pero no está en lista
    ];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('VIA-UGI: healthStatus=WARNING',                d.healthStatus === 'WARNING');
    ok('VIA-UGI: totalMembers=2',                      d.totalMembers === 2);
    ok('VIA-UGI: channels.explicit=1',                 d.channels.explicit === 1);
    ok('VIA-UGI: channels.viaUserGroupIds=1',          d.channels.viaUserGroupIds === 1);
    ok('VIA-UGI: warning via_user_groupIds_only',      hasItem(d.warnings, 'via_user_groupIds_only'));
    const w = findItem(d.warnings, 'via_user_groupIds_only');
    ok('VIA-UGI: cita u2',                             w.userIds.includes('u2'));
}

// ────────────────────────────────────────────────────────────────────────────
// 8. GRUPO NO ENCONTRADO — sentinel
// ────────────────────────────────────────────────────────────────────────────
{
    const d = buildGroupDiagnosis(null, [], []);
    ok('NULL: error GROUP_NOT_FOUND',           d.error === 'GROUP_NOT_FOUND');
    ok('NULL: healthStatus=ERROR',              d.healthStatus === 'ERROR');
    ok('NULL: summary.tone=error',              d.summary.tone === 'error');
    ok('NULL: headline interpretable',          /no encontrado/i.test(d.summary.headline));
}

// ────────────────────────────────────────────────────────────────────────────
// 9. COMBINACIÓN — divergencia + huérfano + fallback (no debería)
//
// Cuando hay divergencia, los canales explícitos NO están vacíos → el
// fallback NO se activa. Verificamos que el sistema NO reporta fallback
// junto a errores estructurales (los inconsistency types tienen prioridad).
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', school: 'Villas', studentIds: ['u1', 'ghost'], memberIds: ['u1'] };
    const users = [
        { id: 'u1', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], colegio: 'Villas' }, // candidato a fallback pero NO se activa
    ];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('MIX: healthStatus=ERROR',                  d.healthStatus === 'ERROR');
    ok('MIX: divergence detectada',                hasItem(d.inconsistencies, 'studentMember_divergence'));
    ok('MIX: orphan detectada',                    hasItem(d.inconsistencies, 'orphan_member_ids'));
    ok('MIX: fallback NO se activa (canales no vacíos)',
        d.channels.fallbackColegio === 0 && !hasItem(d.warnings, 'fallback_colegio_active'));
    ok('MIX: ERROR > WARNING en healthStatus',     d.healthStatus === 'ERROR');
}

// ────────────────────────────────────────────────────────────────────────────
// 10. FORMA ESTABLE — el frontend recibe siempre estos campos
// ────────────────────────────────────────────────────────────────────────────
{
    const group = { id: 'g1', name: '6A', school: 'Villas', type: 'course',
                    studentIds: ['u1'], memberIds: ['u1'] };
    const users = [{ id: 'u1', roles: ['lector'], groupIds: ['g1'] }];
    const d = buildGroupDiagnosis(group, users, [group]);

    ok('SHAPE: groupId',         d.groupId === 'g1');
    ok('SHAPE: groupName',       d.groupName === '6A');
    ok('SHAPE: school',          d.school === 'Villas');
    ok('SHAPE: type',            d.type === 'course');
    ok('SHAPE: totalMembers',    typeof d.totalMembers === 'number');
    ok('SHAPE: channels.explicit',         typeof d.channels.explicit === 'number');
    ok('SHAPE: channels.viaUserGroupIds',  typeof d.channels.viaUserGroupIds === 'number');
    ok('SHAPE: channels.fallbackColegio',  typeof d.channels.fallbackColegio === 'number');
    ok('SHAPE: inconsistencies array',     Array.isArray(d.inconsistencies));
    ok('SHAPE: warnings array',            Array.isArray(d.warnings));
    ok('SHAPE: healthStatus',              ['OK', 'WARNING', 'ERROR'].includes(d.healthStatus));
    ok('SHAPE: summary.headline string',   typeof d.summary.headline === 'string');
    ok('SHAPE: summary.tone enum',         ['ok', 'warning', 'error'].includes(d.summary.tone));
}

// ────────────────────────────────────────────────────────────────────────────
// 11. MENSAJES — sin jerga técnica (regression guard)
//
// El criterio de éxito dice: "el endpoint NO debe ser técnico". Verificamos
// que los mensajes para UI no mencionen identificadores internos.
// ────────────────────────────────────────────────────────────────────────────
{
    const allMessages = [];

    // Recogemos todos los mensajes posibles ejecutando los escenarios.
    {
        const g = { id: 'g1', studentIds: [], memberIds: [] };
        const d = buildGroupDiagnosis(g, [], [g]);
        for (const w of d.warnings) allMessages.push(w.message, w.cause, w.recommendedAction);
    }
    {
        const g = { id: 'g1', school: 'Villas', studentIds: ['ghost'], memberIds: ['ghost'] };
        const d = buildGroupDiagnosis(g, [], [g]);
        for (const i of d.inconsistencies) allMessages.push(i.message, i.cause, i.recommendedAction);
    }
    {
        const g = { id: 'g1', school: 'Villas', studentIds: [], memberIds: [] };
        const u = [{ id: 'u1', roles: ['lector'], colegio: 'Villas' }];
        const d = buildGroupDiagnosis(g, u, [g]);
        for (const w of d.warnings) allMessages.push(w.message, w.cause, w.recommendedAction);
    }
    {
        const g = { id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u1'] };
        const u = [{ id: 'u1', roles: ['lector'], groupIds: [] }];
        const d = buildGroupDiagnosis(g, u, [g]);
        for (const i of d.inconsistencies) allMessages.push(i.message, i.cause, i.recommendedAction);
    }

    const techJargon = [/memberIds/, /studentIds/, /groupIds/, /\bnull\b/, /\bundefined\b/];
    const offenders = allMessages.filter(m => techJargon.some(rx => rx.test(m)));
    ok('UI: ningún mensaje contiene jerga técnica',
        offenders.length === 0,
        `mensajes con jerga: ${JSON.stringify(offenders)}`);
}

console.log('');
console.log(`groupDiagnosis — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
