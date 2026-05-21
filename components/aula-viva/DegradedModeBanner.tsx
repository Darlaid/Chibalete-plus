import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { aulaVivaOperationalService } from '../../services/aulaVivaOperationalService';

/**
 * DegradedModeBanner — PASO 5 §17.
 *
 * Banner discreto top que aparece SOLO cuando hay condición real:
 *   - materializer_ready=false (snapshots stale/never)
 *   - replay activo
 *   - jobs failed o stalled en ledger reciente
 *
 * Lee /api/aula-viva/operational/status cada N segundos.
 * Track al backend cuando se renderiza (métrica chibalete_ui_degraded_mode_total).
 */
export const DegradedModeBanner: React.FC<{
    pollIntervalMs?: number;
}> = ({ pollIntervalMs = 30_000 }) => {
    const [status, setStatus] = useState<{ degraded: boolean; reason?: string; ready?: boolean } | null>(null);

    useEffect(() => {
        let alive = true;
        async function refresh() {
            const s = await aulaVivaOperationalService.getOperationalStatus();
            if (!alive) return;
            let reason: string | undefined;
            if (!s.materializer_ready?.ready) {
                reason = s.materializer_ready?.reason || 'materializer_unavailable';
            } else if (s.recent_jobs?.some(j => j.status === 'failed')) {
                reason = 'job_failed_recent';
            } else if (s.recent_jobs?.some(j => j.status === 'stalled')) {
                reason = 'job_stalled';
            }
            setStatus({ degraded: s.degraded, reason, ready: s.materializer_ready?.ready });
            if (s.degraded && reason) aulaVivaOperationalService.trackDegradedMode(reason);
        }
        refresh();
        const t = setInterval(refresh, pollIntervalMs);
        return () => { alive = false; clearInterval(t); };
    }, [pollIntervalMs]);

    if (!status?.degraded) return null;

    const message = status.reason === 'never_materialized'
        ? 'Materialización inicial pendiente — los datos aparecerán en unos minutos.'
        : status.reason === 'stale'
        ? 'Datos atrasados temporalmente — actualizando.'
        : status.reason === 'job_stalled'
        ? 'Un proceso histórico está atrasado — la información reciente puede mostrarse incompleta.'
        : status.reason === 'job_failed_recent'
        ? 'Hubo un error reciente en procesamiento — revisando automáticamente.'
        : 'Procesamiento degradado — algunos datos pueden estar desactualizados.';

    return (
        <div className="bg-amber-50 border-l-4 border-amber-400 px-4 py-2 text-sm text-amber-900 flex items-center gap-2"
             role="status" aria-live="polite">
            <AlertTriangle className="w-4 h-4 shrink-0"/>
            <span className="flex-1">{message}</span>
            <RefreshCw className="w-3 h-3 animate-spin opacity-60" aria-hidden/>
        </div>
    );
};
