/**
 * BackboneModeUsageSection — sección "Uso por modo de lectura".
 *
 * Sprint Data Backbone — Fase 4.
 *
 * Render aditivo en DashboardMediador y DashboardAdminLectura. Lee de la
 * propiedad opcional `backboneMetrics` que el backend agrega a las respuestas
 * de /api/metrics/{course,school,student}. Si el campo no existe (cliente
 * viejo o backend sin Sprint 3) → devuelve null y no se renderiza nada.
 *
 * Reglas:
 *   - `metrics === null/undefined` → no renderizar (zero-impact).
 *   - `totalSessions === 0`        → mostrar "Aún no hay datos suficientes".
 *   - Caso normal                  → 3 tarjetas (text / immersive / a11y).
 *
 * Etiquetas de UI:
 *   text       → "Modo Guiado"        (alineado con utils/readerMode.ts)
 *   immersive  → "Modo Inmersivo"
 *   a11y       → "Modo accesible"
 *
 * No depende de ningún SectionTitle o componente local de los dashboards
 * — usa Tailwind directo para no introducir acoplamiento. Visualmente
 * compatible con el patrón de tarjetas de los dashboards existentes.
 */

import React from 'react';

// ── Tipo BackboneMetrics (espejo del shape del backend) ──────────────────────
//
// Definido aquí para no acoplar el componente a un import compartido. Si el
// backend agrega campos en el futuro, este tipo solo necesita seguir siendo
// un subset de lo que llega — el componente lee con guards.

export interface BackboneMetrics {
    generatedAt?:   number;
    windowDays?:    number | null;
    windowFrom?:    number | null;
    windowTo?:      number | null;
    totalEvents?:   number;
    totalSessions?: number;

    usageByMode?: Record<string, {
        sessionStarts?:  number;
        sessionEnds?:    number;
        heartbeats?:     number;
        activeUsers?:    number;
        activeContents?: number;
        // Sprint 5A — breakdown native/legacy (opcional, backend viejo no lo manda)
        nativeSessions?: number;
        legacySessions?: number;
        totalSessions?:  number;
    }>;

    readingTimeByMode?: Record<string, {
        totalElapsedMs?:        number;
        averageSessionMs?:      number;
        medianSessionMs?:       number;
        completedSessions?:     number;
        openSessionsEstimate?:  number;
        estimatedFromHeartbeat?: boolean;
        // Sprint 5A
        nativeElapsedMs?: number;
        legacyElapsedMs?: number;
    }>;

    progressByMode?: Record<string, {
        averageProgressFraction?: number;
        maxProgressFraction?:     number;
        completedCount?:          number;
    }>;

    errorsByMode?: Record<string, {
        errorCount?:    number;
        errorTypes?:    Record<string, number>;
        affectedUsers?: number;
    }>;

    immersiveAudio?: {
        audioPlayCount?:        number;
        audioPauseCount?:       number;
        audioSessions?:         number;
        averagePlayPauseRatio?: number;
    };

    a11yAdoption?: {
        users?:       number;
        sessions?:    number;
        avgProgress?: number;
        errorRate?:   number;
    };

    heartbeatCoverage?: Record<string, {
        sessionsWithHeartbeat?:    number;
        sessionsWithoutHeartbeat?: number;
        coveragePercent?:          number;
    }>;

    // Sprint 5A — desglose global por origen
    sourceBreakdown?: {
        native?: { totalEvents?: number; totalSessions?: number; totalElapsedMs?: number };
        legacy?: { totalEvents?: number; totalSessions?: number; totalElapsedMs?: number };
    };
}

// ── Modos visibles ───────────────────────────────────────────────────────────
//
// Sprint 4B: pdf y album entraron al backbone. Se agregan a la cuadrícula con
// el resto de modos primarios. Si en el futuro un modo deja de emitir, su card
// muestra el mensaje "Sin actividad en la ventana." y no rompe la layout.

const VISIBLE_MODES = ['text', 'immersive', 'a11y', 'pdf', 'album', 'lu'] as const;
type VisibleMode = typeof VISIBLE_MODES[number];

const MODE_LABELS: Record<VisibleMode, string> = {
    text:      'Modo Guiado',
    immersive: 'Modo Inmersivo',
    a11y:      'Modo accesible',
    pdf:       'Modo Visual (PDF)',
    album:     'Modo Álbum',
    lu:        'Chibalete LU',
};

const MODE_DESCRIPTIONS: Record<VisibleMode, string> = {
    text:      'Lectura con apoyo TTS y herramientas básicas.',
    immersive: 'Audio narrativo sincronizado con bloques.',
    a11y:      'Lector con estructura semántica accesible.',
    pdf:       'Visor PDF con navegación por páginas y zoom.',
    album:     'Libro álbum con láminas guiadas.',
    lu:        'App Android para lectura offline.',
};

// ── Formateo ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60)        return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)        return `${minutes} min`;
    const hours    = Math.floor(minutes / 60);
    const remainMin = minutes % 60;
    if (hours < 24)          return remainMin > 0 ? `${hours} h ${remainMin} min` : `${hours} h`;
    const days   = Math.floor(hours / 24);
    const remainHr = hours % 24;
    return remainHr > 0 ? `${days} d ${remainHr} h` : `${days} d`;
}

function formatPercent(fraction: number): string {
    if (!Number.isFinite(fraction)) return '—';
    return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

// ── Card por modo ────────────────────────────────────────────────────────────

interface ModeCardProps {
    mode:    VisibleMode;
    metrics: BackboneMetrics;
}

const ModeCard: React.FC<ModeCardProps> = ({ mode, metrics }) => {
    const usage    = metrics.usageByMode?.[mode];
    const time     = metrics.readingTimeByMode?.[mode];
    const progress = metrics.progressByMode?.[mode];
    const errors   = metrics.errorsByMode?.[mode];

    const sessions     = usage?.sessionStarts ?? 0;
    const totalMs      = time?.totalElapsedMs ?? 0;
    const activeUsers  = usage?.activeUsers ?? 0;
    const avgProgress  = progress?.averageProgressFraction ?? 0;
    const errorCount   = errors?.errorCount ?? 0;
    const isEstimated  = time?.estimatedFromHeartbeat ?? false;
    const hasAnyData   = sessions > 0 || totalMs > 0 || activeUsers > 0;

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {MODE_LABELS[mode]}
                </h3>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {mode}
                </span>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-snug">
                {MODE_DESCRIPTIONS[mode]}
            </p>

            {!hasAnyData && (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    Sin actividad en la ventana.
                </p>
            )}

            {hasAnyData && (
                <dl className="space-y-2 text-sm">
                    <Row label="Sesiones"           value={String(sessions)} />
                    <Row label="Tiempo total"       value={formatDuration(totalMs) + (isEstimated ? '*' : '')} />
                    <Row label="Usuarios activos"   value={String(activeUsers)} />
                    <Row label="Progreso promedio" value={formatPercent(avgProgress)} />
                    <Row
                        label="Errores"
                        value={String(errorCount)}
                        emphasize={errorCount > 0}
                    />
                </dl>
            )}

            {hasAnyData && isEstimated && (
                <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 italic">
                    * incluye sesiones estimadas con heartbeat
                </p>
            )}
        </div>
    );
};

const Row: React.FC<{ label: string; value: string; emphasize?: boolean }> = ({ label, value, emphasize }) => (
    <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
        <dd
            className={
                emphasize
                    ? 'text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums'
                    : 'text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums'
            }
        >
            {value}
        </dd>
    </div>
);

// ── Componente principal ─────────────────────────────────────────────────────

interface BackboneModeUsageSectionProps {
    metrics: BackboneMetrics | null | undefined;
}

const BackboneModeUsageSection: React.FC<BackboneModeUsageSectionProps> = ({ metrics }) => {
    if (!metrics) return null;

    const totalSessions  = metrics.totalSessions ?? 0;
    const windowDays     = metrics.windowDays ?? 30;
    const nativeSessions = metrics.sourceBreakdown?.native?.totalSessions ?? 0;
    const hasNativeData  = nativeSessions > 0;

    return (
        <section aria-labelledby="backbone-mode-usage-title">
            <h2
                id="backbone-mode-usage-title"
                className="text-xs font-semibold tracking-wider uppercase text-gray-500 dark:text-gray-400 mb-1"
            >
                Uso por modo de lectura
            </h2>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    Últimos {windowDays} {windowDays === 1 ? 'día' : 'días'}
                    {totalSessions > 0 && ` · ${totalSessions} sesiones totales`}
                </p>
                {hasNativeData && (
                    <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                        title="Las métricas priorizan eventos del nuevo sistema cuando están disponibles."
                    >
                        Datos nativos disponibles
                    </span>
                )}
            </div>

            {totalSessions === 0 ? (
                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                        Aún no hay datos suficientes.
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        La ventana de {windowDays} días no registra sesiones de lectura todavía.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    {VISIBLE_MODES.map(mode => (
                        <ModeCard key={mode} mode={mode} metrics={metrics} />
                    ))}
                </div>
            )}
        </section>
    );
};

export default BackboneModeUsageSection;
