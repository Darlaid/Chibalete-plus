/**
 * leoICDLIBridge.js — ICDLI ↔ Leo Bridge (D3)
 *
 * Connects the ICDLI metrics system to Leo's orchestrator.
 * Builds a compact LeoICDLISnapshot from raw student metrics and derives
 * pedagogical adjustment parameters usable by the handlers.
 *
 * PUBLIC API:
 *   getLeoICDLISnapshot(userId)                                     → LeoICDLISnapshot | null
 *   resolveLeoPedagogicalAdjustment(snapshot, sessionMemory,       → { difficultyLevel,
 *                                    profile)                          preferredSupportType }
 *
 * LeoICDLISnapshot:
 *   { hasData, levelLabel, composite, icdli,
 *     recommendedDifficultyLevel, dominantStrengths, dominantAlerts,
 *     recommendedDose, computedAt }
 *
 * CONSTRAINTS:
 *   - ESM pure, no new dependencies
 *   - No circular dep with server.js
 *   - All file I/O is synchronous (consistent with rest of backend)
 *   - Never throws — errors produce null so Leo always responds
 *   - Results cached in-memory for 30 s to avoid per-message recomputation
 *
 * NOTES:
 *   - Calls metricsService.init() before computeStudentMetrics() on each cache miss.
 *     This is safe: both calls are synchronous with no async gap, same as
 *     server.js loadAndInitMetrics(). Node's single-threaded execution prevents
 *     interleaving between init() and compute().
 *   - pedagogicalStage is NOT adjusted here — session memory owns book-position
 *     stage. ICDLI adjusts difficulty (how hard) and support type (what kind).
 */

import { init as initMetrics, computeStudentMetrics } from './metricsService.js';
import { USERS_DB as _USERS_DB } from './config.js';
import { getAllProgressAsMap } from './progressService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// DB paths — mirrors server.js loadAndInitMetrics, no dependency on server.js
// _USERS_DB comes from ./config.js (canonical, env-overridable)
const _ANALYTICS_DB  = path.resolve(__dirname, '../data/analytics_db.json');
const _LEO_MEMORY_DB = path.resolve(__dirname, '../data/leo_memory_db.json');
const _GROUPS_DB     = path.resolve(__dirname, '../data/groups_db.json');

// In-memory cache — avoids full metrics recomputation on every Leo message
const _CACHE_TTL_MS  = 30_000; // 30 s: fresh enough for a reading session
const _snapshotCache = new Map(); // userId → { snapshot, expiresAt }

// ICDLI dimension keys → Spanish labels for prompt context
const _DIM_LABELS = {
    comprehension:     'comprensión literal',
    integration:       'integración de información',
    inference:         'inferencia',
    criticalThinking:  'pensamiento crítico',
    contextConnection: 'conexión con el contexto',
    metacognition:     'metacognición',
    ideaProduction:    'producción de ideas',
    oralWriting:       'expresión oral y escrita',
};

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoICDLIBridge] [${level}] ${msg}`);
}

function _readSafe(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        const raw = fs.readFileSync(file, 'utf8');
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function _compositeToLabel(score) {
    if (score >= 75) return 'Avanzado';
    if (score >= 55) return 'En desarrollo';
    if (score >= 30) return 'Básico';
    return 'Inicial';
}

function _labelToDifficulty(label) {
    if (label === 'Avanzado') return 'avanzado';
    if (label === 'Inicial')  return 'inicial';
    return 'medio'; // Básico + En desarrollo
}

function _labelToDose(label) {
    if (label === 'Inicial')   return 'guided';
    if (label === 'Avanzado')  return 'light';
    return 'standard';
}

/**
 * Extracts up to 2 dominant strengths (score ≥ 3) and 2 dominant alerts (score = 1)
 * from the ICDLI dimension map. Returns human-readable Spanish labels.
 */
function _buildStrengthsAlerts(icdli) {
    const entries = Object.entries(icdli).filter(([d]) => _DIM_LABELS[d]);

    const dominantStrengths = entries
        .filter(([, s]) => s >= 3)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([d]) => _DIM_LABELS[d]);

    const dominantAlerts = entries
        .filter(([, s]) => s === 1)
        .slice(0, 2)
        .map(([d]) => _DIM_LABELS[d]);

    return { dominantStrengths, dominantAlerts };
}

/**
 * Maps the most critical ICDLI weakness to a preferredSupportType.
 * Priority: comprehension/integration gaps → vocabulary
 *           inference/critical/context gaps → inferential
 *           metacognition/production gaps   → reflection
 * Returns null if no critical weakness (all dims ≥ 2).
 */
function _alertsToSupportType(icdli) {
    if (icdli.comprehension === 1 || icdli.integration === 1)                           return 'vocabulary';
    if (icdli.inference === 1 || icdli.criticalThinking === 1 || icdli.contextConnection === 1) return 'inferential';
    if (icdli.metacognition === 1 || icdli.ideaProduction === 1 || icdli.oralWriting === 1)     return 'reflection';
    return null;
}

function _getCached(userId) {
    const entry = _snapshotCache.get(userId);
    if (entry && entry.expiresAt > Date.now()) return entry.snapshot;
    return null;
}

function _setCache(userId, snapshot) {
    _snapshotCache.set(userId, { snapshot, expiresAt: Date.now() + _CACHE_TTL_MS });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a compact LeoICDLISnapshot for a user.
 *
 * Returns null  → userId absent.
 * Returns { hasData: false } → user has no reading sessions yet.
 * Returns { hasData: true, ... } → full snapshot with adaptation parameters.
 *
 * Results are cached for 30 s. Never throws.
 *
 * @param {string|null} userId
 * @returns {LeoICDLISnapshot|null}
 */
export function getLeoICDLISnapshot(userId) {
    if (!userId) return null;

    const cached = _getCached(userId);
    if (cached !== null) return cached;

    try {
        // Load all DBs metricsService needs — synchronous, no async gap before compute
        initMetrics({
            events:    _readSafe(_ANALYTICS_DB,  []),
            leoMemory: _readSafe(_LEO_MEMORY_DB, { memoryMap: {} }),
            progress:  getAllProgressAsMap(),
            groups:    _readSafe(_GROUPS_DB,     []),
            users:     _readSafe(_USERS_DB,      []),
        });

        const raw = computeStudentMetrics(userId);

        if (!raw.behavioral || raw.behavioral.totalSessions === 0) {
            // New user — no behavioral data yet. Return no-data snapshot so Leo
            // continues using D2 defaults instead of breaking.
            const noData = {
                hasData:                    false,
                levelLabel:                 'Inicial',
                composite:                  0,
                icdli:                      raw.icdli,
                recommendedDifficultyLevel: 'medio',   // safe default, not 'inicial'
                dominantStrengths:          [],
                dominantAlerts:             [],
                recommendedDose:            'standard',
                computedAt:                 raw.computedAt,
            };
            _setCache(userId, noData);
            return noData;
        }

        const composite  = Math.round(raw.readingLevels.composite);
        const levelLabel = _compositeToLabel(composite);
        const { dominantStrengths, dominantAlerts } = _buildStrengthsAlerts(raw.icdli);

        const snapshot = {
            hasData:                    true,
            levelLabel,
            composite,
            icdli:                      raw.icdli,
            recommendedDifficultyLevel: _labelToDifficulty(levelLabel),
            dominantStrengths,
            dominantAlerts,
            recommendedDose:            _labelToDose(levelLabel),
            computedAt:                 raw.computedAt,
        };

        _setCache(userId, snapshot);
        _log(`snapshot built: userId=${userId} level=${levelLabel} composite=${composite} dose=${snapshot.recommendedDose}`);
        return snapshot;

    } catch (e) {
        _log(`getLeoICDLISnapshot failed userId=${userId}: ${e.message}`, 'WARN');
        return null; // Leo continues with D2 defaults
    }
}

/**
 * Derives effective pedagogical adjustment parameters from an ICDLI snapshot.
 *
 * difficultyLevel:      ICDLI wins when hasData; else D2 session/profile defaults.
 * preferredSupportType: ICDLI alert mapping wins when hasData; else D2 profile value.
 * pedagogicalStage:     NOT touched here — session memory (D2) is authoritative.
 *
 * @param {LeoICDLISnapshot|null} snapshot
 * @param {object} sessionMemory   — merged state from D2 resolveLeoState
 * @param {object} profile         — merged profile from D2 resolveLeoState
 * @returns {{ difficultyLevel: string, preferredSupportType: string|null }}
 */
export function resolveLeoPedagogicalAdjustment(snapshot, sessionMemory, profile) {
    if (!snapshot || !snapshot.hasData) {
        // No ICDLI data — preserve D2 state unchanged
        return {
            difficultyLevel:      sessionMemory?.difficultyLevel     ?? 'medio',
            preferredSupportType: profile?.preferredSupportType      ?? null,
        };
    }

    // ICDLI difficulty: overrides frontend hint AND D2 session memory
    const difficultyLevel = snapshot.recommendedDifficultyLevel;

    // ICDLI alert → support type: dimension-specific weakness overrides D2 counter
    const icdliSupportType    = _alertsToSupportType(snapshot.icdli);
    const preferredSupportType = icdliSupportType ?? profile?.preferredSupportType ?? null;

    return { difficultyLevel, preferredSupportType };
}
