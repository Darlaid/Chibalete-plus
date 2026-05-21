/**
 * immersiveRuntimeFlag.ts — P1-B resolución de runtime inmersivo (V1|V2).
 *
 * ADITIVO. NO se importa todavía desde la ruta productiva /leer/inmersivo/:id
 * (esa SIGUE montando V1). Esta es la infra de canary lista para cablearse en
 * UN punto, gated, default V1. Espeja la lógica de server/lib/flags.js
 * (mismo FNV-1a) para que la asignación de cohorte sea coherente front↔back.
 *
 * Precedencia (de mayor a menor):
 *   1. killSwitch  → V1 SIEMPRE (rollback global instantáneo).
 *   2. localStorage 'IMMERSIVE_RUNTIME' = 'v1' | 'v2'  → override ops/QA.
 *   3. cohortPct + userId  → asignación estable determinista.
 *   4. default     → V1.
 */

export interface ImmersiveRuntimeConfig {
    killSwitch: boolean;
    cohortPct: number;          // 0..100 (servido por backend o env de build)
}

export interface RuntimeDecision {
    runtime: 'v1' | 'v2';
    reason: string;
    bucket: number;             // -1 si no aplicó cohorte
    override: 'none' | 'localstorage' | 'killswitch';
}

function fnv1a(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h;
}

function readLocalOverride(): 'v1' | 'v2' | null {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        const v = window.localStorage.getItem('IMMERSIVE_RUNTIME');
        if (v === 'v1' || v === 'v2') return v;
        return null;
    } catch { return null; }
}

/**
 * @param userId  id estable del usuario (cohorte determinista). null → anon.
 * @param cfg     killSwitch + cohortPct (default seguro: V1).
 */
export function resolveImmersiveRuntime(
    userId: string | null | undefined,
    cfg: ImmersiveRuntimeConfig = { killSwitch: false, cohortPct: 0 },
): RuntimeDecision {
    if (cfg.killSwitch) {
        return { runtime: 'v1', reason: 'killswitch', bucket: -1, override: 'killswitch' };
    }
    const local = readLocalOverride();
    if (local) {
        return { runtime: local, reason: 'localstorage_override', bucket: -1, override: 'localstorage' };
    }
    const pct = Math.min(100, Math.max(0, Math.floor(cfg.cohortPct || 0)));
    if (pct <= 0)   return { runtime: 'v1', reason: 'cohort_0',   bucket: -1, override: 'none' };
    if (pct >= 100) return { runtime: 'v2', reason: 'cohort_100', bucket: 0,  override: 'none' };
    const bucket = fnv1a(String(userId ?? 'anon')) % 100;
    return bucket < pct
        ? { runtime: 'v2', reason: `cohort_${pct}`, bucket, override: 'none' }
        : { runtime: 'v1', reason: `cohort_${pct}`, bucket, override: 'none' };
}
