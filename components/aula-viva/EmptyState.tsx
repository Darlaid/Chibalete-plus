import React, { useEffect } from 'react';
import { Inbox, Sparkles, Clock, Wifi, WifiOff } from 'lucide-react';
import { aulaVivaOperationalService } from '../../services/aulaVivaOperationalService';

/**
 * EmptyState — PASO 5 §16.
 *
 * REEMPLAZA silencios peligrosos por explicación contextual.
 * Casos canónicos:
 *   - 'no_students'         → grupo recién creado
 *   - 'no_recommendations'  → lectores con patrones estables (buena noticia)
 *   - 'no_signals_yet'      → estudiante nuevo / sin sesiones
 *   - 'snapshots_pending'   → materializer aún no corrió
 *   - 'replay_active'       → datos atrasados temporalmente
 *   - 'offline'             → sin conectividad
 *   - 'custom'              → mensaje libre
 */
export type EmptyKind =
    | 'no_students' | 'no_recommendations' | 'no_signals_yet'
    | 'snapshots_pending' | 'replay_active' | 'offline' | 'custom';

const PRESETS: Record<EmptyKind, { icon: React.ElementType; title: string; body: string; tone: 'neutral'|'positive' }> = {
    no_students:        { icon: Inbox, title: 'Aún no hay estudiantes en este grupo',
                          body: 'Cuando agregues alumnos verás aquí su evolución lectora.',
                          tone: 'neutral' },
    no_recommendations: { icon: Sparkles, title: 'No hay recomendaciones pendientes',
                          body: 'Los lectores en este scope muestran patrones estables. Volveremos a evaluar en próximas corridas.',
                          tone: 'positive' },
    no_signals_yet:     { icon: Clock, title: 'Sin sesiones registradas todavía',
                          body: 'Este lector aún no inicia sesiones. Considera asignarle una primera lectura para empezar a ver evolución.',
                          tone: 'neutral' },
    snapshots_pending:  { icon: Clock, title: 'Materialización inicial pendiente',
                          body: 'Las métricas pedagógicas tardan unos minutos en aparecer tras la primera actividad.',
                          tone: 'neutral' },
    replay_active:      { icon: Clock, title: 'Replay histórico en curso',
                          body: 'Algunos datos pueden estar atrasados unos minutos mientras se procesan eventos anteriores.',
                          tone: 'neutral' },
    offline:            { icon: WifiOff, title: 'Sin conexión',
                          body: 'Mostrando datos cacheados. Las acciones quedarán encoladas y se aplicarán al volver online.',
                          tone: 'neutral' },
    custom:             { icon: Inbox, title: '', body: '', tone: 'neutral' },
};

export const EmptyState: React.FC<{
    kind: EmptyKind;
    title?: string;
    body?: string;
    where?: string;  // identificador del panel para métrica
    children?: React.ReactNode;
}> = ({ kind, title, body, where, children }) => {
    const p = PRESETS[kind];
    const Icon = p.icon;

    useEffect(() => {
        if (where) aulaVivaOperationalService.trackEmptyState(where);
    }, [where]);

    return (
        <div className={`flex flex-col items-center justify-center text-center py-8 px-4 rounded-lg border
                        ${p.tone === 'positive' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
            <Icon className={`w-8 h-8 mb-2 ${p.tone === 'positive' ? 'text-emerald-500' : 'text-gray-400'}`}/>
            <h3 className="font-medium text-gray-900 text-sm">{title || p.title}</h3>
            <p className="mt-1 text-sm text-gray-600 max-w-md">{body || p.body}</p>
            {children && <div className="mt-3">{children}</div>}
        </div>
    );
};
