/**
 * utils/groupDiagnosis.mjs — capa narrativa: el sistema explicándose a sí mismo.
 *
 * Sprint visibilidad — sirve de base para Aula Viva explicativa, panel del
 * estudiante y futura integración con el Modo Accesible. Su función es
 * convertir el estado interno de la membresía (que ya es coherente gracias
 * a Sprints 021 Fase 1 y 2) en mensajes interpretables que la UI pueda
 * mostrar tal cual, sin re-interpretar.
 *
 * Reglas de diseño:
 *   - NO re-implementa lógica de membresía. Consume la fuente única
 *     (utils/groupMembership.mjs) vía getGroupMembers / getExplicitGroupMembers
 *     / applyLegacyColegioFallback.
 *   - Output 100% interpretable: cada inconsistency y warning trae
 *     `message`, `cause`, `recommendedAction` ya redactados en español.
 *     El frontend muestra esos campos directamente.
 *   - Sin jerga técnica en los mensajes (ni "memberIds", ni "studentIds",
 *     ni "fallback") — habla de "estudiantes", "grupo", "colegio".
 *   - Tres niveles de salud: OK (todo limpio) / WARNING (notable pero no
 *     bloqueante) / ERROR (datos incoherentes que requieren atención).
 *   - El módulo es puro y no toca disco — corre tanto en Node (endpoint)
 *     como potencialmente en navegador (futuras vistas locales).
 */

import {
    getGroupMembers,
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
} from './groupMembership.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);

/**
 * Construye el diagnóstico interpretable de un grupo.
 *
 * @param {object}   group     — record de un grupo (groups_db).
 * @param {object[]} users     — array completo de users (users_db).
 * @param {object[]} allGroups — array completo de groups (necesario para
 *                                resolver fallback colegio correctamente).
 * @returns {object} Diagnóstico con shape estable. Ver groupDiagnosis.d.ts.
 */
export function buildGroupDiagnosis(group, users, allGroups) {
    if (!group || typeof group !== 'object') {
        return {
            groupId:        null,
            error:          'GROUP_NOT_FOUND',
            healthStatus:   'ERROR',
            inconsistencies: [],
            warnings:        [],
            summary: {
                headline: 'Grupo no encontrado.',
                tone:     'error',
            },
        };
    }

    const _users  = Array.isArray(users)     ? users     : [];
    const _groups = Array.isArray(allGroups) ? allGroups : [];

    const userById = new Map(_users.map(u => [u?.id, u]).filter(([id]) => id));

    // ── Conteos por canal ──────────────────────────────────────────────────
    //
    // explicitSet — IDs presentes en studentIds o memberIds del grupo.
    // viaUserGroupIds — IDs no listados arriba pero cuyo user.groupIds
    //   apunta a este grupo (drift inverso suave: el user dice que pertenece).
    // fallbackOnly — IDs resueltos solo por la convención `colegio→school`
    //   cuando los canales explícitos están vacíos y la escuela tiene
    //   exactamente un grupo.

    const studentSet  = new Set(arr(group.studentIds));
    const memberSet   = new Set(arr(group.memberIds));
    const explicitSet = new Set([...studentSet, ...memberSet]);

    const viaUserGroupIds = new Set();
    for (const u of _users) {
        if (u && arr(u.groupIds).includes(group.id) && !explicitSet.has(u.id)) {
            viaUserGroupIds.add(u.id);
        }
    }

    // Fuente única — total resuelto, ya incluye fallback si aplica.
    const resolvedAll = new Set(getGroupMembers(group, _users, {
        allGroups: _groups,
        warnFn:    () => {},
    }));

    // El fallback se calcula explícitamente para distinguirlo de los otros canales.
    let fallbackOnly = new Set();
    if (explicitSet.size === 0 && viaUserGroupIds.size === 0) {
        const fb = applyLegacyColegioFallback(group, _users, _groups);
        if (fb.used) fallbackOnly = new Set(fb.matched);
    }

    // ── Inconsistencias (datos incoherentes) ───────────────────────────────

    const inconsistencies = [];

    // I1. studentIds y memberIds difieren — divergencia de listas internas.
    const onlyInStudent = [...studentSet].filter(x => !memberSet.has(x));
    const onlyInMember  = [...memberSet].filter(x => !studentSet.has(x));
    if (onlyInStudent.length || onlyInMember.length) {
        const total = onlyInStudent.length + onlyInMember.length;
        inconsistencies.push({
            type:    'studentMember_divergence',
            count:   total,
            userIds: [...new Set([...onlyInStudent, ...onlyInMember])],
            message:           `${total} estudiante(s) aparecen en una lista interna del grupo pero no en la otra.`,
            cause:             'El grupo mantiene dos listas que deberían coincidir y se desincronizaron.',
            recommendedAction: 'Editar el grupo desde el gestor o ejecutar la migración de membresía para sincronizar las listas.',
        });
    }

    // I2. orphan_member_ids — IDs en el grupo que no resuelven a un user real.
    const orphanIds = [...explicitSet].filter(id => !userById.has(id));
    if (orphanIds.length > 0) {
        inconsistencies.push({
            type:    'orphan_member_ids',
            count:   orphanIds.length,
            userIds: orphanIds,
            message:           `${orphanIds.length} estudiante(s) están listados en el grupo pero ya no existen en el sistema.`,
            cause:             'Los usuarios fueron eliminados sin limpiar la lista de miembros del grupo.',
            recommendedAction: 'Ejecutar la migración de membresía para limpiar las referencias huérfanas.',
        });
    }

    // I3. member_without_groupId — drift inverso: están en el grupo pero
    //     su user.groupIds no lo refleja.
    const memberMissingGroupId = [];
    for (const id of explicitSet) {
        const u = userById.get(id);
        if (u && !arr(u.groupIds).includes(group.id)) memberMissingGroupId.push(id);
    }
    if (memberMissingGroupId.length > 0) {
        inconsistencies.push({
            type:    'member_without_groupId',
            count:   memberMissingGroupId.length,
            userIds: memberMissingGroupId,
            message:           `${memberMissingGroupId.length} estudiante(s) están en este grupo pero su perfil no lo refleja.`,
            cause:             'La lista del grupo y el registro del estudiante se desincronizaron.',
            recommendedAction: 'Ejecutar la migración de membresía para restablecer la bidireccionalidad.',
        });
    }

    // ── Warnings (notables pero no errores) ────────────────────────────────

    const warnings = [];

    // W1. Grupo vacío.
    if (resolvedAll.size === 0) {
        warnings.push({
            type:    'group_empty',
            count:   0,
            userIds: [],
            message:           'Este grupo no tiene estudiantes asignados.',
            cause:             'No existen asignaciones explícitas y no hay datos del colegio que resuelvan miembros.',
            recommendedAction: 'Asignar estudiantes desde el gestor de usuarios o desde la lista de candidatos del grupo.',
        });
    }

    // W2. Fallback colegio activo — los miembros vienen del nombre del
    //     colegio, no de una asignación explícita.
    if (fallbackOnly.size > 0) {
        warnings.push({
            type:    'fallback_colegio_active',
            count:   fallbackOnly.size,
            userIds: [...fallbackOnly],
            message:           `${fallbackOnly.size} estudiante(s) aparecen aquí solo porque pertenecen al mismo colegio.`,
            cause:             'Datos legacy: estos estudiantes fueron registrados con el nombre del colegio antes de que existieran grupos explícitos.',
            recommendedAction: 'Asignarlos explícitamente al grupo desde el gestor de usuarios para fijar la relación.',
        });
    }

    // W3. via_user_groupIds_only — el estudiante declara pertenecer al
    //     grupo pero la lista del grupo no lo incluye.
    if (viaUserGroupIds.size > 0) {
        warnings.push({
            type:    'via_user_groupIds_only',
            count:   viaUserGroupIds.size,
            userIds: [...viaUserGroupIds],
            message:           `${viaUserGroupIds.size} estudiante(s) declaran pertenecer al grupo pero la lista del grupo no los incluye.`,
            cause:             'El grupo no se actualizó al asignar al estudiante; el sistema los reconoce, pero el snapshot del grupo está desactualizado.',
            recommendedAction: 'Editar el grupo o ejecutar la migración de membresía para alinear ambos lados.',
        });
    }

    // ── healthStatus: ERROR > WARNING > OK ─────────────────────────────────

    let healthStatus = 'OK';
    if (inconsistencies.length > 0)      healthStatus = 'ERROR';
    else if (warnings.length > 0)        healthStatus = 'WARNING';

    // ── Headline: el resumen de una sola frase, listo para UI ──────────────

    let headline;
    if (healthStatus === 'ERROR') {
        const total = inconsistencies.reduce((acc, i) => acc + (i.count || 0), 0);
        headline = `El grupo tiene ${inconsistencies.length} incoherencia(s) que afectan a ${total} estudiante(s).`;
    } else if (healthStatus === 'WARNING') {
        // Si está vacío, el headline lo dice directamente; sino reporta el
        // número de estudiantes y la cantidad de advertencias.
        const isEmpty = warnings.some(w => w.type === 'group_empty');
        if (isEmpty) {
            headline = 'Este grupo no tiene estudiantes asignados.';
        } else {
            headline = `El grupo tiene ${resolvedAll.size} estudiante(s) y ${warnings.length} advertencia(s).`;
        }
    } else {
        headline = `El grupo tiene ${resolvedAll.size} estudiante(s) y todo está en orden.`;
    }

    return {
        groupId:      group.id,
        groupName:    group.name   ?? null,
        school:       group.school ?? null,
        type:         group.type   ?? 'course',
        totalMembers: resolvedAll.size,
        channels: {
            explicit:        explicitSet.size,
            viaUserGroupIds: viaUserGroupIds.size,
            fallbackColegio: fallbackOnly.size,
        },
        inconsistencies,
        warnings,
        healthStatus,
        summary: {
            headline,
            tone: healthStatus.toLowerCase(),  // "ok" | "warning" | "error"
        },
    };
}
