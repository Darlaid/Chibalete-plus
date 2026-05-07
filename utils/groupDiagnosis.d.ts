/**
 * Tipos para utils/groupDiagnosis.mjs.
 *
 * El shape es estable y está diseñado para que el frontend lo consuma sin
 * re-interpretar. Cada inconsistency y warning trae mensajes ya redactados
 * que se muestran tal cual.
 */

import type { MembershipUser, MembershipGroup } from './groupMembership';

export type HealthStatus = 'OK' | 'WARNING' | 'ERROR';
export type DiagnosisTone  = 'ok' | 'warning' | 'error';

/** Tipos de incoherencias detectables en un grupo. */
export type InconsistencyType =
  | 'studentMember_divergence'
  | 'orphan_member_ids'
  | 'member_without_groupId';

/** Tipos de advertencias notables (no son errores). */
export type WarningType =
  | 'group_empty'
  | 'fallback_colegio_active'
  | 'via_user_groupIds_only';

/** Forma común de cada item explicado al usuario. */
export interface DiagnosisItemBase {
  count: number;
  userIds: string[];
  /** Frase corta lista para mostrarse en UI. */
  message: string;
  /** Por qué pasa esto, en lenguaje claro. */
  cause: string;
  /** Qué puede hacer el operador para resolverlo. */
  recommendedAction: string;
}

export interface InconsistencyItem extends DiagnosisItemBase {
  type: InconsistencyType;
}

export interface WarningItem extends DiagnosisItemBase {
  type: WarningType;
}

export interface DiagnosisChannels {
  /** IDs presentes en studentIds o memberIds del grupo. */
  explicit: number;
  /** IDs que pertenecen al grupo solo por user.groupIds (snapshot del grupo desactualizado). */
  viaUserGroupIds: number;
  /** IDs resueltos solo por la convención colegio→escuela (fallback legacy). */
  fallbackColegio: number;
}

export interface DiagnosisSummary {
  /** Frase única de cabecera, lista para mostrarse en UI. */
  headline: string;
  /** Misma idea que healthStatus pero en minúsculas para mapear a clases CSS. */
  tone: DiagnosisTone;
}

export interface GroupDiagnosis {
  groupId:      string;
  groupName:    string | null;
  school:       string | null;
  type:         'course' | 'club';
  totalMembers: number;
  channels:     DiagnosisChannels;
  inconsistencies: InconsistencyItem[];
  warnings:        WarningItem[];
  healthStatus: HealthStatus;
  summary:      DiagnosisSummary;
}

/** Respuesta cuando no se encontró el grupo (devuelta por el helper, NO por el endpoint — el endpoint responde 404 antes). */
export interface GroupDiagnosisNotFound {
  groupId:        null;
  error:          'GROUP_NOT_FOUND';
  healthStatus:   'ERROR';
  inconsistencies: never[];
  warnings:        never[];
  summary:        DiagnosisSummary;
}

export function buildGroupDiagnosis(
  group: MembershipGroup | null | undefined,
  users: readonly MembershipUser[],
  allGroups: readonly MembershipGroup[],
): GroupDiagnosis | GroupDiagnosisNotFound;
