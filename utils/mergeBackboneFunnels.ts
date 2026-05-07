/**
 * mergeBackboneFunnels — fusiona N respuestas BackboneFunnels en una sola.
 *
 * Sprint Data Backbone — Fase 6A.
 *
 * Caso de uso: DashboardAdminLectura recibe un BackboneFunnels por cada
 * escuela seleccionada y necesita una vista agregada.
 *
 * Reglas de fusión:
 *   - Steps: count y uniqueUsers se SUMAN entre escuelas. uniqueUsers
 *     puede tener overlap (si un mismo userId existe en 2 escuelas), pero
 *     en la práctica esto no ocurre — un usuario está en una escuela. La
 *     suma es indicativa, no exacta, y quedó documentada.
 *   - conversionFromPrevious / conversionFromStart: se RECALCULAN desde
 *     los counts mergeados (no se promedian — eso daría números falsos).
 *   - dropoffs: se RECALCULAN desde los counts.
 *   - summary.completionRate, biggestDropoff: se RECALCULAN.
 *   - errors.total: suma. errors.byType: merge sumando counts.
 *   - immersive.audio: suma de play/pauseSessions, ratio recalculado.
 *
 * Si la lista está vacía → null.
 */

import type {
    BackboneFunnels,
    FunnelStep,
    FunnelDropoff,
    FunnelBase,
    FunnelLu,
    FunnelA11y,
    FunnelImmersive,
    FunnelReading,
} from '../components/BackboneFunnelsSection';

function mergeStepArrays(arrays: FunnelStep[][]): FunnelStep[] {
    if (arrays.length === 0) return [];
    // Asumimos que todas las escuelas comparten los mismos pasos (mismo
    // backend, misma definición). Tomamos los pasos de la primera escuela
    // como template y sumamos counts/uniqueUsers por posición.
    const template = arrays[0];
    const merged: FunnelStep[] = template.map(s => ({
        key: s.key, label: s.label,
        count: 0, uniqueUsers: 0,
        conversionFromPrevious: null,
        conversionFromStart:    0,
    }));
    for (const arr of arrays) {
        arr.forEach((s, i) => {
            if (i >= merged.length) return; // shape inconsistente — saltar
            merged[i].count       += s.count       ?? 0;
            merged[i].uniqueUsers += s.uniqueUsers ?? 0;
        });
    }
    // Recalcular conversiones.
    const startCount = merged[0]?.count ?? 0;
    merged.forEach((s, i) => {
        if (i === 0) {
            s.conversionFromPrevious = null;
            s.conversionFromStart    = s.count > 0 ? 1 : 0;
        } else {
            const prev = merged[i - 1].count;
            s.conversionFromPrevious = prev > 0 ? s.count / prev : 0;
            s.conversionFromStart    = startCount > 0 ? s.count / startCount : 0;
        }
    });
    return merged;
}

function recomputeDropoffs(steps: FunnelStep[]): FunnelDropoff[] {
    const out: FunnelDropoff[] = [];
    for (let i = 1; i < steps.length; i++) {
        const lost        = Math.max(0, steps[i - 1].count - steps[i].count);
        const lostPercent = steps[i - 1].count > 0 ? lost / steps[i - 1].count : 0;
        out.push({ from: steps[i - 1].key, to: steps[i].key, lost, lostPercent });
    }
    return out;
}

function recomputeSummary(steps: FunnelStep[], dropoffs: FunnelDropoff[]): FunnelBase['summary'] {
    const starts      = steps[0]?.count ?? 0;
    const completions = steps[steps.length - 1]?.count ?? 0;
    let biggest: FunnelDropoff | null = null;
    for (const d of dropoffs) {
        if (!biggest || d.lost > biggest.lost) biggest = d;
    }
    return {
        starts,
        completions,
        completionRate: starts > 0 ? completions / starts : 0,
        biggestDropoff: biggest && biggest.lost > 0 ? biggest : null,
    };
}

function mergeBaseFunnel(items: (FunnelBase | undefined)[], id: string, label: string): FunnelBase {
    const present = items.filter((x): x is FunnelBase => !!x);
    if (present.length === 0) {
        return { id, label, steps: [], dropoffs: [], summary: { starts: 0, completions: 0, completionRate: 0, biggestDropoff: null } };
    }
    const steps    = mergeStepArrays(present.map(f => f.steps));
    const dropoffs = recomputeDropoffs(steps);
    const summary  = recomputeSummary(steps, dropoffs);
    return { id, label: present[0].label || label, steps, dropoffs, summary };
}

function mergeErrors(items: ({ total: number; byType: Record<string, number> } | undefined)[]) {
    let total = 0;
    const byType: Record<string, number> = {};
    for (const e of items) {
        if (!e) continue;
        total += e.total ?? 0;
        for (const [t, n] of Object.entries(e.byType ?? {})) {
            byType[t] = (byType[t] ?? 0) + (n ?? 0);
        }
    }
    return { total, byType };
}

export function mergeBackboneFunnels(items: BackboneFunnels[]): BackboneFunnels | null {
    if (!Array.isArray(items) || items.length === 0) return null;

    const present = items.filter(x => !!x && !!x.funnels);
    if (present.length === 0) return null;

    // Reading.byMode: unión de modos vistos en cualquiera de las escuelas.
    const allReadingModes = new Set<string>();
    for (const x of present) {
        for (const k of Object.keys(x.funnels?.reading?.byMode ?? {})) {
            allReadingModes.add(k);
        }
    }

    const lu        = mergeBaseFunnel(present.map(x => x.funnels?.lu),        'lu',        'Distribución Chibalete LU') as FunnelLu;
    lu.errors       = mergeErrors(present.map(x => x.funnels?.lu?.errors));

    const reading   = mergeBaseFunnel(present.map(x => x.funnels?.reading),   'reading',   'Lectura general') as FunnelReading;
    reading.byMode  = {};
    for (const mode of allReadingModes) {
        reading.byMode[mode] = mergeBaseFunnel(
            present.map(x => x.funnels?.reading?.byMode?.[mode]),
            `reading.${mode}`,
            `Lectura · ${mode}`,
        );
    }

    const a11y      = mergeBaseFunnel(present.map(x => x.funnels?.a11y),      'a11y',      'Modo Accesible')      as FunnelA11y;
    a11y.errors     = mergeErrors(present.map(x => x.funnels?.a11y?.errors));

    const immersive = mergeBaseFunnel(present.map(x => x.funnels?.immersive), 'immersive', 'Modo Inmersivo')      as FunnelImmersive;
    let playSessions = 0, pauseSessions = 0;
    for (const x of present) {
        playSessions  += x.funnels?.immersive?.audio?.playSessions  ?? 0;
        pauseSessions += x.funnels?.immersive?.audio?.pauseSessions ?? 0;
    }
    const totalActions = playSessions + pauseSessions;
    immersive.audio = {
        playSessions, pauseSessions,
        playPauseRatio: totalActions > 0 ? playSessions / totalActions : 0,
    };

    const pdf   = mergeBaseFunnel(present.map(x => x.funnels?.pdf),   'pdf',   'Modo Visual (PDF)');
    const album = mergeBaseFunnel(present.map(x => x.funnels?.album), 'album', 'Modo Álbum');

    // Window: tomar la primera escuela.
    const first = present[0];

    return {
        generatedAt:            Date.now(),
        windowDays:             first.windowDays ?? null,
        windowFrom:             first.windowFrom ?? null,
        windowTo:               first.windowTo   ?? null,
        sourceFilter:           'native',
        nativeEventCount:       present.reduce((acc, x) => acc + (x.nativeEventCount ?? 0), 0),
        ignoredNonNativeEvents: present.reduce((acc, x) => acc + (x.ignoredNonNativeEvents ?? 0), 0),
        funnels: { lu, reading, a11y, immersive, pdf, album },
    };
}
