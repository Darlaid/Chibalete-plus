/**
 * Tipos para utils/groupMembership.mjs.
 *
 * El módulo es JavaScript ESM puro y vive en .mjs porque también lo
 * importa el backend Node sin transpilar. Estos tipos lo hacen consumible
 * desde TypeScript (frontend, dataService) sin reimplementar nada.
 */

export const READER_ROLE: 'lector';

export const ERR: Readonly<{
  GROUP_REQUIRED:  'GROUP_REQUIRED';
  USER_NOT_FOUND:  'USER_NOT_FOUND';
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND';
  AMBIGUOUS_GROUP: 'AMBIGUOUS_GROUP';
}>;

/** Forma mínima de un usuario que la lógica de membresía necesita leer. */
export interface MembershipUser {
  id?: string;
  roles?: readonly string[];
  colegio?: string;
  groupIds?: readonly string[];
  [k: string]: unknown;
}

/** Forma mínima de un grupo que la lógica de membresía necesita leer. */
export interface MembershipGroup {
  id?: string;
  school?: string;
  studentIds?: readonly string[];
  memberIds?:  readonly string[];
  [k: string]: unknown;
}

export function userIsLectorLike(user: MembershipUser | null | undefined): boolean;

export function addUserIdToGroup(group: MembershipGroup, userId: string): boolean;
export function removeUserIdFromGroup(group: MembershipGroup, userId: string): boolean;
export function addGroupIdToUser(user: MembershipUser, groupId: string): boolean;
export function removeGroupIdFromUser(user: MembershipUser, groupId: string): boolean;

export function getExplicitGroupMembers(
  group: MembershipGroup,
  users: readonly MembershipUser[],
): Set<string>;

export interface LegacyFallbackResult {
  matched: Set<string>;
  used: boolean;
  reason: string | null;
}
export function applyLegacyColegioFallback(
  group: MembershipGroup,
  users: readonly MembershipUser[],
  allGroups: readonly MembershipGroup[],
): LegacyFallbackResult;

export interface GetGroupMembersOpts {
  allGroups?: readonly MembershipGroup[];
  useLegacyColegioFallback?: boolean;
  warnFn?: (msg: string, meta: object) => void;
}
export function getGroupMembers(
  group: MembershipGroup,
  users: readonly MembershipUser[],
  opts?: GetGroupMembersOpts,
): string[];

export function unionGroupMemberIds(group: MembershipGroup): string[];

export interface ResolveSchoolResult {
  groupId: string | null;
  error:   typeof ERR[keyof typeof ERR] | null;
}
export function resolveSingleGroupForSchool(
  schoolNameOrSlug: string,
  groups: readonly MembershipGroup[],
): ResolveSchoolResult;

export interface IntegrityIssue {
  type:
    | 'orphan_studentId'
    | 'orphan_memberId'
    | 'orphan_userGroupId'
    | 'lector_without_group'
    | 'studentMember_divergence'
    | 'school_with_users_no_group';
  groupId?: string;
  userId?: string;
  school?: string;
  colegio?: string | null;
  lectorCount?: number;
  onlyInStudentIds?: string[];
  onlyInMemberIds?: string[];
}
export interface IntegrityReport {
  issues: IntegrityIssue[];
  counts: Record<string, number>;
}
export function validateMembershipIntegrity(
  users: readonly MembershipUser[],
  groups: readonly MembershipGroup[],
): IntegrityReport;

export interface IdsDelta {
  added:   string[];
  removed: string[];
}
export function diffIds(
  oldIds?: readonly string[] | null,
  newIds?: readonly string[] | null,
): IdsDelta;

export interface ApplyUserGroupsResult {
  addedTo:           string[];
  removedFrom:       string[];
  missingGroupIds:   string[];
  touched:           boolean;
}
export function applyUserGroupsChange(
  groups: MembershipGroup[],
  userId: string,
  addedGroupIds:   readonly string[],
  removedGroupIds: readonly string[],
): ApplyUserGroupsResult;

export interface ApplyGroupMembersResult {
  addedTo:         string[];
  removedFrom:     string[];
  missingUserIds:  string[];
  touched:         boolean;
}
export function applyGroupMembersChange(
  users: MembershipUser[],
  groupId: string,
  addedUserIds:   readonly string[],
  removedUserIds: readonly string[],
): ApplyGroupMembersResult;

export function detachUserFromAllGroups(
  groups: MembershipGroup[],
  userId: string,
): string[];

export function detachGroupFromAllUsers(
  users: MembershipUser[],
  groupId: string,
): string[];
