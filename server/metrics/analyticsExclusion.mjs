/**
 * analyticsExclusion.mjs — CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01.
 *
 * Autoridad central, pura y determinista para excluir la cohorte sintética de
 * carga de las métricas LEGACY, en el BORDE DE SELECCIÓN DE COHORTE (nunca por
 * resta posterior). Diseño congelado en
 * docs/ops/STATS_SYNTHETIC_COHORT_EXCLUSION_00.md.
 *
 * PRINCIPIOS (no negociables):
 *   - Autoridad PRIMARIA = campo `user._loadtest_marker` (presente en el padrón
 *     JSON que el motor legacy ya carga; sin depender de SQLite).
 *   - Autoridad de ATESTACIÓN (guard) = conjunto de hashes h16(id) de
 *     `migration_exclusions(entity='user', SYNTHETIC_LOADTEST_QUARANTINED)`.
 *   - `disabled` NUNCA es clasificador: un lector real puede quedar disabled y
 *     conserva su historia.
 *   - `LEGACY_COMPAT` NUNCA se equipara a `SYNTHETIC_COMPAT`.
 *   - Sin heurística de email/nombre/rango/patrón de PK en runtime.
 *
 * Módulo PURO: sin I/O, sin reloj, sin estado global mutable. `crypto` se usa
 * sólo para el hash determinista h16 (inyectable en tests).
 */

import crypto from 'node:crypto';

// ── Modos del flag ──────────────────────────────────────────────────────────
export const EXCLUSION_MODE = Object.freeze({ OFF: 'off', SHADOW: 'shadow', ON: 'on' });
export const EXCLUSION_FLAG = 'LEGACY_ANALYTICS_COHORT_EXCLUSION';

export class AnalyticsExclusionConfigError extends Error {
    constructor(detail) {
        super(`ANALYTICS_EXCLUSION_CONFIG_ERROR: ${detail}`);
        this.name = 'AnalyticsExclusionConfigError';
        this.code = 'ANALYTICS_EXCLUSION_CONFIG_ERROR';
    }
}

/**
 * Resuelve el modo del flag. Default `off` (ausencia nunca activa nada). Valor
 * no reconocido = error explícito, jamás un default silencioso.
 */
export function resolveExclusionMode(env = process.env) {
    const raw = env?.[EXCLUSION_FLAG];
    if (raw === undefined || raw === null || String(raw).trim() === '') return EXCLUSION_MODE.OFF;
    const v = String(raw).trim().toLowerCase();
    if (v === EXCLUSION_MODE.OFF)    return EXCLUSION_MODE.OFF;
    if (v === EXCLUSION_MODE.SHADOW) return EXCLUSION_MODE.SHADOW;
    if (v === EXCLUSION_MODE.ON)     return EXCLUSION_MODE.ON;
    throw new AnalyticsExclusionConfigError(`${EXCLUSION_FLAG} debe ser off|shadow|on, recibido "${raw}"`);
}

// ── Estados de atestación ───────────────────────────────────────────────────
export const ATTESTATION = Object.freeze({
    OK:               'ATTESTATION_OK',        // marcador == atestación
    DEGRADED:         'ATTESTATION_DEGRADED',  // marcador disponible, atestación ausente
    DRIFT:            'ATTESTATION_DRIFT',     // ambos disponibles, conjuntos difieren
    AUTHORITY_INVALID:'AUTHORITY_INVALID',     // autoridad de marcador malformada/ausente
});

// ── Clasificación de grupos ─────────────────────────────────────────────────
export const GROUP_CLASS = Object.freeze({
    CANONICAL:       'CANONICAL',
    LEGACY_COMPAT:   'LEGACY_COMPAT',
    SYNTHETIC_COMPAT:'SYNTHETIC_COMPAT',
    UNKNOWN:         'UNKNOWN',
});

// ── Clasificación de diferencias (shadow) ───────────────────────────────────
export const DIFF_CLASS = Object.freeze({
    MATCH:                            'MATCH',
    EXPECTED_SYNTHETIC_REMOVAL:       'EXPECTED_SYNTHETIC_REMOVAL',
    EXPECTED_LEGACY_GROUP_NORMALIZATION: 'EXPECTED_LEGACY_GROUP_NORMALIZATION',
    UNEXPECTED_REGRESSION:            'UNEXPECTED_REGRESSION',
    ATTESTATION_DEGRADED:             'ATTESTATION_DEGRADED',
    ATTESTATION_DRIFT:                'ATTESTATION_DRIFT',
});

/** Hash de referencia determinista: primeros 16 hex de SHA-256(id). Sin PII cruda. */
export function h16(id) {
    return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
}

const arr = (x) => (Array.isArray(x) ? x : []);

// ── Clasificador de usuario ─────────────────────────────────────────────────

/** ÚNICO predicado de exclusión de usuario: el marcador sintético del padrón. */
export function isAnalyticsExcludedUser(user) {
    return !!(user && user._loadtest_marker);
}

/**
 * Conjunto de ids excluidos, derivado del marcador. Se construye UNA vez por
 * ciclo de cómputo (no por registro). O(usuarios).
 */
export function getAnalyticsExcludedUserIds(users) {
    const set = new Set();
    for (const u of arr(users)) {
        if (u && u.id != null && isAnalyticsExcludedUser(u)) set.add(String(u.id));
    }
    return set;
}

/**
 * Estado de atestación comparando el conjunto marcador contra los hashes
 * atestados de identity.db. Igualdad estricta (conteo + pertenencia); cualquier
 * discrepancia = DRIFT (mismo invariante que selectCohort del retiro).
 *
 * @param {object[]} users
 * @param {Set<string>} excludedUserIds  ids marcados
 * @param {Set<string>|null} attestedHashes  h16(id) atestados; null => DEGRADED
 * @param {(id:string)=>string} [hashFn]
 */
export function getAnalyticsAttestationState({ users, excludedUserIds, attestedHashes, hashFn = h16 }) {
    if (!Array.isArray(users)) return ATTESTATION.AUTHORITY_INVALID;
    if (!(excludedUserIds instanceof Set)) return ATTESTATION.AUTHORITY_INVALID;
    if (attestedHashes === null || attestedHashes === undefined) return ATTESTATION.DEGRADED;
    if (!(attestedHashes instanceof Set)) return ATTESTATION.AUTHORITY_INVALID;

    const markerHashes = new Set([...excludedUserIds].map((id) => hashFn(String(id))));
    if (markerHashes.size !== attestedHashes.size) return ATTESTATION.DRIFT;
    for (const hh of markerHashes) if (!attestedHashes.has(hh)) return ATTESTATION.DRIFT;
    return ATTESTATION.OK;
}

/** Integridad del marcador probada (requisito para permitir ON en DEGRADED). */
export function isMarkerAuthorityProven({ users, excludedUserIds }) {
    return Array.isArray(users) && excludedUserIds instanceof Set;
}

// ── Clasificador de grupo ───────────────────────────────────────────────────

/**
 * Un grupo es SINTÉTICO para analítica sii tiene ≥1 miembro resoluble y TODOS
 * sus miembros están excluidos (todos con marcador). Esto distingue:
 *   - sintético  = todos los miembros sintéticos,
 *   - legacy/real = tiene ≥1 miembro real (no se excluye la actividad real),
 * usando SÓLO la autoridad de identidad de usuario (no el nombre del grupo).
 */
export function isAnalyticsExcludedGroup(group, excludedUserIds, resolveMembers) {
    const members = arr(typeof resolveMembers === 'function' ? resolveMembers(group) : []);
    if (members.length === 0) return false;
    for (const id of members) if (!excludedUserIds.has(String(id))) return false;
    return true;
}

/**
 * Clasifica un grupo. Si se aportan mapas atestados (h16→disposition), mandan;
 * si no, se deriva del marcador de miembros.
 */
export function classifyAnalyticsGroup(group, {
    excludedUserIds, resolveMembers,
    attestedSyntheticHashes = null, attestedLegacyHashes = null,
    canonicalGroupIds = null, hashFn = h16,
} = {}) {
    const gid = group && group.id != null ? String(group.id) : '';
    if (!gid) return GROUP_CLASS.UNKNOWN;

    if (attestedSyntheticHashes instanceof Set && attestedSyntheticHashes.has(hashFn(gid))) {
        return GROUP_CLASS.SYNTHETIC_COMPAT;
    }
    if (attestedLegacyHashes instanceof Set && attestedLegacyHashes.has(hashFn(gid))) {
        return GROUP_CLASS.LEGACY_COMPAT;
    }
    if (canonicalGroupIds instanceof Set) {
        return canonicalGroupIds.has(gid) ? GROUP_CLASS.CANONICAL : GROUP_CLASS.UNKNOWN;
    }
    // Derivación por marcador (sin atestación): todos-sintéticos => sintético;
    // con ≥1 real => canónico/legacy real (no distinguible sin atestación, pero
    // en ningún caso sintético → su actividad real se conserva).
    if (excludedUserIds instanceof Set &&
        isAnalyticsExcludedGroup(group, excludedUserIds, resolveMembers)) {
        return GROUP_CLASS.SYNTHETIC_COMPAT;
    }
    return GROUP_CLASS.CANONICAL;
}

// ── Filtro de cohorte (borde de selección) ──────────────────────────────────

/** Quita ids excluidos de una lista de miembros. Preserva orden. */
export function filterCanonicalMemberIds(ids, excludedUserIds) {
    if (!(excludedUserIds instanceof Set) || excludedUserIds.size === 0) return arr(ids).slice();
    return arr(ids).filter((id) => !excludedUserIds.has(String(id)));
}

// ── Clasificación de diferencias (shadow diff) ──────────────────────────────

/**
 * Clasifica una diferencia numérica entre el cálculo legacy y el filtrado.
 *   - iguales                      => MATCH
 *   - baja Y se removió sintético  => EXPECTED_SYNTHETIC_REMOVAL
 *   - cambio de dimensión legacy   => EXPECTED_LEGACY_GROUP_NORMALIZATION
 *   - cualquier otra divergencia   => UNEXPECTED_REGRESSION
 * Nunca resta valores: recibe los dos valores ya recomputados desde su cohorte.
 */
export function classifyDifferential(oldVal, newVal, { removedSynthetic = false, legacyNormalized = false } = {}) {
    if (Object.is(oldVal, newVal) || oldVal === newVal) return DIFF_CLASS.MATCH;
    const numeric = typeof oldVal === 'number' && typeof newVal === 'number';
    if (numeric && newVal <= oldVal && removedSynthetic) return DIFF_CLASS.EXPECTED_SYNTHETIC_REMOVAL;
    if (legacyNormalized) return DIFF_CLASS.EXPECTED_LEGACY_GROUP_NORMALIZATION;
    return DIFF_CLASS.UNEXPECTED_REGRESSION;
}
