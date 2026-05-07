/**
 * mergeBackboneInsights — fusiona N respuestas BackboneInsights en una sola.
 *
 * Sprint Data Backbone — Fase 6B.
 *
 * Caso de uso: DashboardAdminLectura recibe un BackboneInsights por cada
 * escuela seleccionada. Necesitamos una vista única.
 *
 * Estrategia: dedup por `id`. Cuando el mismo insight (mismo id, ej:
 * `insight.lu.download_dropoff.global`) aparece en N escuelas, mantenemos
 * la severidad MÁS ALTA observada y sumamos `sampleSize`. La descripción y
 * recomendación se quedan con las de la escuela con mayor sampleSize —
 * son textos genéricos por regla, así que el contenido es equivalente.
 *
 * Limitaciones (documentadas):
 *   - No recomputamos las reglas sobre el agregado mergeado. Eso requeriría
 *     portar el módulo backboneInsights a frontend o exponer el agregado
 *     consolidado en backend. Para Sprint 6B preferimos la simplicidad.
 *   - El `value` reportado es el de la escuela con mayor sampleSize, no
 *     un value re-calculado sobre el merge. La señal sigue siendo correcta
 *     a nivel de tendencia, pero no es un cálculo exacto del agregado.
 *   - Si la lista llega vacía o sin insights, devuelve null (componente
 *     no renderiza).
 */

import type {
    BackboneInsights,
    Insight,
    InsightSeverity,
    InsightSeveritySummary,
} from '../components/BackboneInsightsSection';

const SEVERITY_RANK: Record<InsightSeverity, number> = {
    info:     0,
    warning:  1,
    critical: 2,
};

function compareForOrder(a: Insight, b: Insight): number {
    const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sd !== 0) return sd;
    const aSize = a.evidence?.sampleSize ?? 0;
    const bSize = b.evidence?.sampleSize ?? 0;
    return bSize - aSize;
}

function recomputeSummary(list: Insight[]): InsightSeveritySummary {
    const out = { critical: 0, warning: 0, info: 0, total: list.length };
    for (const i of list) {
        if (i.severity === 'critical')      out.critical += 1;
        else if (i.severity === 'warning')  out.warning  += 1;
        else                                out.info     += 1;
    }
    return out;
}

export function mergeBackboneInsights(items: BackboneInsights[]): BackboneInsights | null {
    if (!Array.isArray(items) || items.length === 0) return null;

    const present = items.filter(x => !!x && Array.isArray(x.insights));
    if (present.length === 0) return null;

    const byId = new Map<string, Insight>();
    let windowDays: number | null = null;

    for (const x of present) {
        if (windowDays === null && typeof x.windowDays === 'number') windowDays = x.windowDays;
        for (const ins of x.insights ?? []) {
            const existing = byId.get(ins.id);
            if (!existing) {
                byId.set(ins.id, { ...ins, evidence: { ...ins.evidence } });
                continue;
            }
            // Merge: severidad MAX, sampleSize sumado.
            const newSev = SEVERITY_RANK[ins.severity] > SEVERITY_RANK[existing.severity]
                ? ins.severity
                : existing.severity;
            const existingSize = existing.evidence?.sampleSize ?? 0;
            const newSize      = ins.evidence?.sampleSize ?? 0;
            const summedSize   = existingSize + newSize;

            // Heredamos la descripción y value de la escuela con mayor
            // sampleSize (más representativa).
            const useNewerText = newSize > existingSize;

            byId.set(ins.id, {
                ...existing,
                severity: newSev,
                title:           useNewerText ? ins.title          : existing.title,
                description:     useNewerText ? ins.description    : existing.description,
                recommendation:  useNewerText ? ins.recommendation : existing.recommendation,
                evidence: {
                    ...(useNewerText ? ins.evidence : existing.evidence),
                    sampleSize: summedSize,
                },
            });
        }
    }

    const merged = [...byId.values()].sort(compareForOrder);

    return {
        generatedAt:     Date.now(),
        windowDays:      windowDays ?? 30,
        severitySummary: recomputeSummary(merged),
        insights:        merged,
    };
}
