/**
 * Tipos para utils/studentStatus.mjs.
 *
 * Shape estable. El frontend muestra `headline`, `message`, `cause` y
 * `recommendedAction` directamente — sin re-interpretación.
 */

import type { MembershipUser } from './groupMembership';

export type StudentState =
  | 'ACTIVE_PROGRESS'
  | 'ACTIVE_NO_PROGRESS'
  | 'ACTIVE_UNVERIFIED_HISTORY'
  | 'NO_COURSE_WORKS'
  | 'REGISTERED_NO_LOGIN'
  | 'NO_GROUP'
  | 'NO_ACCESS'
  | 'TECH_ISSUE';

export type StudentStatusTone = 'ok' | 'warning' | 'error';

export const STUDENT_STATE: Readonly<Record<StudentState, StudentState>>;

export interface StudentStatusMetrics {
  /** ¿Pertenece a algún grupo? — input del decisor para NO_GROUP. */
  inAnyGroup?: boolean;
  /** ¿Tiene contenido habilitado? — input para NO_ACCESS. */
  hasContentAccess?: boolean;
  /** ISO timestamp del último evento de lectura registrado, o null. */
  lastReadingEventAt?: string | null;
  /** Cantidad de libros iniciados. */
  booksStarted?: number;
  /** Cantidad de libros completados. */
  booksCompleted?: number;
  /** Porcentaje agregado de avance (0..100). */
  progressPercentage?: number;
  /** V9 F7-C2R-U3B: obras con lectura registrada cuya pertenencia al curso no puede acreditarse (solo por mediación). */
  unverifiableHistoryCount?: number;
  /** V9 F7-C2R-U3B: ¿los cursos compartidos con quien consulta tienen obras? (solo por mediación). */
  courseHasWorks?: boolean;
}

export interface StudentStatusLogs {
  /** ISO timestamp del último login, o null si nunca ingresó. */
  lastLoginAt?: string | null;
  /** Errores técnicos asociados al user en las últimas 24h. */
  recentErrorsCount?: number;
}

export interface StudentStatusProgress {
  booksStarted: number;
  booksCompleted: number;
  /** 0..100 */
  percentage: number;
  /** V9 F7-C2R-U3B: obras con lectura que NO entra en las cifras anteriores porque no puede atribuirse al curso. */
  unverifiableHistory?: number;
  /** V9 F7-C2R-U3B: false = el curso compartido no tiene obras (no hay lectura del curso que mostrar). */
  courseHasWorks?: boolean;
}

export interface StudentStatus {
  userId: string | null;
  name: string;
  state: StudentState;
  tone: StudentStatusTone;
  /** Frase de cabecera lista para mostrarse. */
  headline: string;
  /** Frase descriptiva del estado. */
  message: string;
  /** Por qué el estudiante está en este estado. */
  cause: string;
  /** Qué puede hacer el mediador. */
  recommendedAction: string;
  lastLoginAt: string | null;
  lastReadingEventAt: string | null;
  progress: StudentStatusProgress;
}

export function buildStudentStatus(
  user: MembershipUser | null | undefined,
  metrics: StudentStatusMetrics,
  logs: StudentStatusLogs,
): StudentStatus;
