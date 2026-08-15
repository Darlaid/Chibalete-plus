/**
 * BackbonePersistentAlertsSection — alertas con histórico (Sprint 6C).
 *
 * Render aditivo bajo `BackboneInsightsSection`. A diferencia de la sección
 * de insights actual (snapshot recomputado en cada request), este
 * componente lee `/api/metrics/insights/states` y muestra el estado vivo:
 *   - active        → la alerta sigue ocurriendo.
 *   - acknowledged  → alguien la marcó como vista.
 *   - dismissed     → silenciada hasta `dismissedUntil`.
 *   - resolved      → ya no aparece (no se muestra en la lista por defecto).
 *
 * Acciones disponibles por alerta:
 *   - "Marcar revisada"  → POST /api/metrics/insights/:key/ack
 *   - "Ocultar 7 días"   → POST /api/metrics/insights/:key/dismiss
 *
 * Si `/api/metrics/insights/states` falla o devuelve vacío, mostramos el
 * estado vacío. No rompemos layout ni el resto del dashboard.
 *
 * NOTA: este componente es opcional — se monta solo si en el dashboard
 * se confirma que `persisted.available === true`. Si insights.db nunca
 * recibió un snapshot, no hay states y el componente muestra el estado
 * vacío con el aviso correspondiente.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, AlertTriangle, Info, Eye, EyeOff, RefreshCw } from 'lucide-react';

// ── Tipos espejo del backend ─────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus   = 'active' | 'acknowledged' | 'dismissed' | 'resolved';

export interface PersistentAlertState {
    insightKey:      string;
    scopeLevel:      string;
    scopeId:         string | null;
    type:            string;
    severity:        AlertSeverity;
    title:           string;
    status:          AlertStatus;
    firstSeenAt:     number;
    lastSeenAt:      number;
    lastValue:       number | null;
    previousValue:   number | null;
    deltaValue:      number | null;
    occurrences:     number;
    dismissedUntil:  number | null;
    acknowledgedAt:  number | null;
    acknowledgedBy:  string | null;
    insight:         {
        description?:    string;
        recommendation?: string;
        evidence?:       { sampleSize?: number; threshold?: number; metric?: string };
    } | null;
    updatedAt:       number;
}

interface StatesResponse {
    ok:     boolean;
    states: PersistentAlertState[];
    total:  number;
    error?: string;
}

// ── Estilos por severidad ────────────────────────────────────────────────────

const SEV_STYLES: Record<AlertSeverity, { icon: React.ComponentType<{ size?: number; className?: string }>; iconColor: string; border: string; badge: string; label: string }> = {
    critical: { icon: AlertCircle,    iconColor: 'text-red-600 dark:text-red-400',     border: 'border-red-200 dark:border-red-900/40',     badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',         label: 'Crítica' },
    warning:  { icon: AlertTriangle,  iconColor: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-900/40', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', label: 'Advertencia' },
    info:     { icon: Info,           iconColor: 'text-sky-600 dark:text-sky-400',     border: 'border-sky-200 dark:border-sky-900/40',     badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',         label: 'Informativa' },
};

const STATUS_BADGES: Record<AlertStatus, string> = {
    active:       'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    acknowledged: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    dismissed:    'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
    resolved:     'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
};

const STATUS_LABELS: Record<AlertStatus, string> = {
    active: 'Activa', acknowledged: 'Revisada', dismissed: 'Silenciada', resolved: 'Resuelta',
};

// ── Formateo ─────────────────────────────────────────────────────────────────

function formatRelative(ts: number | null | undefined): string {
    if (!ts || !Number.isFinite(ts)) return '—';
    const diffMs = Date.now() - ts;
    if (diffMs < 60_000)        return 'hace un momento';
    if (diffMs < 3_600_000)     return `hace ${Math.round(diffMs / 60_000)} min`;
    if (diffMs < 86_400_000)    return `hace ${Math.round(diffMs / 3_600_000)} h`;
    return `hace ${Math.round(diffMs / 86_400_000)} d`;
}

function formatValue(v: number | null | undefined, threshold?: number): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    // Heurística ratio: threshold ∈ (0,1] → porcentaje
    const isRatio = threshold !== undefined && threshold > 0 && threshold <= 1;
    if (isRatio) return `${Math.round(v * 100)}%`;
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2);
}

function formatDelta(d: number | null | undefined, threshold?: number): { text: string; sign: 'up' | 'down' | 'neutral' } {
    if (d === null || d === undefined || !Number.isFinite(d) || d === 0) return { text: '0', sign: 'neutral' };
    const isRatio = threshold !== undefined && threshold > 0 && threshold <= 1;
    const formatted = isRatio ? `${(d * 100).toFixed(1)}pp` : d.toFixed(2);
    return {
        text: (d > 0 ? '+' : '') + formatted,
        sign: d > 0 ? 'up' : 'down',
    };
}

// ── Item ─────────────────────────────────────────────────────────────────────

interface AlertItemProps {
    alert:      PersistentAlertState;
    onAck:      (key: string) => Promise<void>;
    onDismiss:  (key: string, days: number) => Promise<void>;
    actionInProgress: boolean;
}

const AlertItem: React.FC<AlertItemProps> = ({ alert, onAck, onDismiss, actionInProgress }) => {
    const sev   = SEV_STYLES[alert.severity];
    const Icon  = sev.icon;
    const ev    = alert.insight?.evidence ?? {};
    const delta = formatDelta(alert.deltaValue, ev.threshold);

    const dismissedUntilText = alert.status === 'dismissed' && alert.dismissedUntil
        ? `silenciada hasta ${new Date(alert.dismissedUntil).toLocaleDateString()}`
        : null;

    return (
        <div className={`bg-white dark:bg-gray-800 border ${sev.border} rounded-lg p-4`}>
            <div className="flex items-start gap-3">
                <Icon size={18} className={`${sev.iconColor} flex-shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{alert.title}</h3>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${sev.badge}`}>{sev.label}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_BADGES[alert.status]}`}>
                            {STATUS_LABELS[alert.status]}
                        </span>
                    </div>
                    {alert.insight?.description && (
                        <p className="text-xs text-gray-600 dark:text-gray-300 mb-2 leading-snug">
                            {alert.insight.description}
                        </p>
                    )}
                    <div className="flex items-baseline gap-3 flex-wrap text-[11px] text-gray-500 dark:text-gray-400 tabular-nums mb-2">
                        <span>valor: <strong className="text-gray-700 dark:text-gray-200">{formatValue(alert.lastValue, ev.threshold)}</strong></span>
                        <span>cambio: <strong className={delta.sign === 'up' ? 'text-amber-600 dark:text-amber-400' : delta.sign === 'down' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}>{delta.text}</strong></span>
                        <span>ocurrencias: <strong className="text-gray-700 dark:text-gray-200">{alert.occurrences}</strong></span>
                        <span>vista por última vez: {formatRelative(alert.lastSeenAt)}</span>
                    </div>
                    {alert.insight?.recommendation && (
                        <p className="text-xs text-gray-700 dark:text-gray-200 italic mb-2">
                            → {alert.insight.recommendation}
                        </p>
                    )}
                    {dismissedUntilText && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                            {dismissedUntilText}
                        </p>
                    )}
                    {alert.status === 'acknowledged' && alert.acknowledgedBy && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                            revisada por {alert.acknowledgedBy} {formatRelative(alert.acknowledgedAt)}
                        </p>
                    )}
                </div>
                {alert.status === 'active' && (
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <button
                            onClick={() => onAck(alert.insightKey)}
                            disabled={actionInProgress}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                            title="Marcar como revisada"
                        >
                            <Eye size={12} /> Marcar revisada
                        </button>
                        <button
                            onClick={() => onDismiss(alert.insightKey, 7)}
                            disabled={actionInProgress}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                            title="Ocultar 7 días"
                        >
                            <EyeOff size={12} /> Ocultar 7 días
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Componente principal ─────────────────────────────────────────────────────

interface BackbonePersistentAlertsSectionProps {
    /** Si false, el componente no se monta (no llama al endpoint). */
    available: boolean;
    /** ID del usuario actual para el header x-user-id en las llamadas. */
    userId?: string;
    /** Filtros opcionales pasados al endpoint. */
    scopeLevel?: string;
    scopeId?:    string;
}

const ENDPOINT_STATES        = '/api/metrics/insights/states';
const ENDPOINT_ACK           = (key: string) => `/api/metrics/insights/${encodeURIComponent(key)}/ack`;
const ENDPOINT_DISMISS       = (key: string) => `/api/metrics/insights/${encodeURIComponent(key)}/dismiss`;

const BackbonePersistentAlertsSection: React.FC<BackbonePersistentAlertsSectionProps> = ({
    available, userId, scopeLevel, scopeId,
}) => {
    const [alerts, setAlerts]     = useState<PersistentAlertState[]>([]);
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const [actionKey, setActionKey] = useState<string | null>(null);

    const headers = useCallback((): HeadersInit => {
        // CHP-IDDB-M1-A: autenticación por cookie de sesión (same-origin); sin x-user-id.
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        return h;
    }, [userId]);

    const load = useCallback(async () => {
        if (!available) return;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (scopeLevel) params.set('scopeLevel', scopeLevel);
            if (scopeId)    params.set('scopeId',    scopeId);
            const url = `${ENDPOINT_STATES}${params.toString() ? '?' + params.toString() : ''}`;
            const res = await fetch(url, { headers: headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as StatesResponse;
            // Mostramos solo active + acknowledged + dismissed; resolved se omiten para
            // no contaminar visualmente; pueden consultarse vía API.
            const visible = (data.states ?? []).filter(s => s.status !== 'resolved');
            // Ordenamos: critical → warning → info; dentro: active → acknowledged → dismissed.
            const sevRank: Record<AlertSeverity, number>  = { critical: 0, warning: 1, info: 2 };
            const stRank:  Record<AlertStatus, number>    = { active: 0, acknowledged: 1, dismissed: 2, resolved: 3 };
            visible.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || stRank[a.status] - stRank[b.status]);
            setAlerts(visible);
        } catch (e) {
            setError((e as Error).message);
            setAlerts([]);
        } finally {
            setLoading(false);
        }
    }, [available, scopeLevel, scopeId, headers]);

    useEffect(() => { void load(); }, [load]);

    const handleAck = useCallback(async (key: string) => {
        setActionKey(key);
        try {
            const res = await fetch(ENDPOINT_ACK(key), {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ actorId: userId ?? 'unknown' }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setActionKey(null);
        }
    }, [headers, load, userId]);

    const handleDismiss = useCallback(async (key: string, days: number) => {
        setActionKey(key);
        try {
            const res = await fetch(ENDPOINT_DISMISS(key), {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ actorId: userId ?? 'unknown', days }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setActionKey(null);
        }
    }, [headers, load, userId]);

    if (!available) return null;

    return (
        <section aria-labelledby="backbone-persistent-alerts-title" className="mt-6">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <h2 id="backbone-persistent-alerts-title"
                    className="text-xs font-semibold tracking-wider uppercase text-gray-500 dark:text-gray-400">
                    Alertas con histórico
                </h2>
                <button
                    onClick={() => void load()}
                    disabled={loading}
                    className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
                    title="Refrescar lista"
                >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Cargando…' : 'Refrescar'}
                </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                Estado vivo de cada alerta entre snapshots · ack/dismiss persisten
            </p>

            {error && (
                <p className="text-xs text-amber-600 dark:text-amber-400 italic mb-3">
                    No se pudieron cargar las alertas persistidas: {error}
                </p>
            )}

            {alerts.length === 0 && !loading && !error ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                        Sin alertas persistidas todavía.
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Disparar POST /api/metrics/insights/snapshot para crear el primer histórico.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {alerts.map(a => (
                        <AlertItem
                            key={a.insightKey}
                            alert={a}
                            onAck={handleAck}
                            onDismiss={handleDismiss}
                            actionInProgress={actionKey === a.insightKey}
                        />
                    ))}
                </div>
            )}
        </section>
    );
};

export default BackbonePersistentAlertsSection;
