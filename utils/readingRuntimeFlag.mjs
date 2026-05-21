/**
 * readingRuntimeFlag.mjs — CRR / resolver de runtime por modo de lectura.
 *
 * Runtime puro JS. Los tipos viven en readingRuntimeFlag.d.ts (split idéntico
 * al de `utils/groupMembership.mjs` + `.d.ts`, que permite tests node-only y
 * a la vez tipado completo en TS consumers).
 *
 * Extiende `immersiveRuntimeFlag.ts` (resolver del visor inmersivo) a todos
 * los modos del CRR: immersive | accessible | guided | pdf | album.
 *
 * ADITIVO Y SEGURO. NO se importa desde el routing productivo todavía. Cada
 * visor decide cuándo cablearlo (default: nunca, sigue el path legacy).
 *
 * Precedencia (idéntica a immersiveRuntimeFlag):
 *   1. killSwitch  → V1 para TODOS los modos (rollback global).
 *   2. localStorage 'READING_RUNTIME__<mode>' = 'v1' | 'v2' → override QA por modo.
 *   3. cohortPct[mode] + userId → FNV-1a determinista, coherente front↔back.
 *   4. default → 'v1' para todos los modos (= comportamiento productivo actual).
 */

/**
 * FNV-1a 32-bit — réplica exacta de utils/immersiveRuntimeFlag.ts y
 * server/lib/flags.js. NO modificar sin actualizar los tres a la vez.
 */
function fnv1a(key) {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h;
}

function readLocalOverride(mode) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        const key = `READING_RUNTIME__${mode}`;
        const v = window.localStorage.getItem(key);
        if (v === 'v1' || v === 'v2') return v;
        return null;
    } catch { return null; }
}

/**
 * @param {string|null|undefined} userId  id estable del usuario (cohorte determinista). null → anon.
 * @param {'immersive'|'accessible'|'guided'|'pdf'|'album'} mode
 * @param {{ killSwitch?: boolean, cohortPct?: Record<string, number> }} [cfg]
 * @returns {{ runtime: 'v1'|'v2', reason: string, bucket: number, override: 'none'|'localstorage'|'killswitch', mode: string }}
 */
export function resolveReadingRuntime(userId, mode, cfg = { killSwitch: false, cohortPct: {} }) {
    if (cfg.killSwitch) {
        return { runtime: 'v1', reason: 'killswitch', bucket: -1, override: 'killswitch', mode };
    }
    const local = readLocalOverride(mode);
    if (local) {
        return { runtime: local, reason: 'localstorage_override', bucket: -1, override: 'localstorage', mode };
    }
    const pctRaw = cfg.cohortPct?.[mode] ?? 0;
    const pct = Math.min(100, Math.max(0, Math.floor(pctRaw)));
    if (pct <= 0) {
        return { runtime: 'v1', reason: `cohort_0_${mode}`, bucket: -1, override: 'none', mode };
    }
    if (pct >= 100) {
        return { runtime: 'v2', reason: `cohort_100_${mode}`, bucket: 0, override: 'none', mode };
    }
    // Bucket determinista por (userId, mode). El sufijo `__${mode}` asegura
    // que dos modos con misma cohorte y mismo userId no asignen idéntico
    // bucket — evita correlaciones espurias entre canaries simultáneos.
    const bucket = fnv1a(`${userId ?? 'anon'}__${mode}`) % 100;
    return bucket < pct
        ? { runtime: 'v2', reason: `cohort_${pct}_${mode}`, bucket, override: 'none', mode }
        : { runtime: 'v1', reason: `cohort_${pct}_${mode}`, bucket, override: 'none', mode };
}

/**
 * Helper de migración: caller que solo conoce el modo inmersivo puede usar
 * este wrapper con la firma original de `resolveImmersiveRuntime` y obtiene
 * la misma decisión vía el resolver extendido.
 *
 * @param {string|null|undefined} userId
 * @param {{ killSwitch?: boolean, cohortPct?: number }} [cfg]
 */
export function resolveImmersiveViaReadingFlag(userId, cfg = { killSwitch: false, cohortPct: 0 }) {
    const decision = resolveReadingRuntime(userId, 'immersive', {
        killSwitch: !!cfg.killSwitch,
        cohortPct: { immersive: cfg.cohortPct ?? 0 },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mode: _unused, ...rest } = decision;
    return rest;
}
