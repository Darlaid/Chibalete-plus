/**
 * LeoMediatorPanel.tsx — V9 F7-C2R-U3C.
 *
 * Leo para quien media: lectura pedagógica de UN lector calculada por el servidor solo con la evidencia fechada del
 * curso compartido (contratos de U3: `GET /api/leo/mediator/student/:id`, `…/content/:contentId` y
 * `GET /api/leo/activation/:id`). Este panel no calcula nada ni completa datos con memoria global o perfiles
 * personales: muestra lo que el servidor declara y, cuando no hay evidencia suficiente, lo explica en vez de pintar
 * ceros. No abre ninguna conversación con Leo.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { describeInstitutionalError, describeAccessWithdrawn } from '../../utils/institutionalErrors';
import { useAuthorizationRevalidation } from '../../hooks/useAuthorizationRevalidation';
import { describeDataState, objectiveLabel, activationLabel, trendLabel } from '../../utils/pedagogicalStates';

interface EvidenceSignal { timestamp: string; contentId: string | null; pedagogicalObjective: string | null; evidenceType: string | null }
interface LeoSummary {
    data_state?: string; reason?: string | null;
    provenance?: { evidence: number; first_ts: string | null; last_ts: string | null; reading_sessions: number } | null;
    icdliHasData?: boolean; icdliLevel?: string | null; icdliComposite?: number | null;
    icdliDominantAlerts?: string[]; icdliDominantStrengths?: string[];
    dominantPedagogicalObjective?: string | null; preferredSupportType?: string | null;
    totalInteractions?: number | null; lastInteractionAt?: string | null;
    recentEvidenceSignals?: EvidenceSignal[]; alerts?: string[] | null; suggestedMediatorAction?: string | null;
}
interface LeoHistory {
    data_state?: string; pedagogicalStage?: string | null; difficultyLevel?: string | null; interactionCount?: number | null;
    lastInterventionAt?: string | null; objectiveDistribution?: Record<string, number>; difficultyTrend?: string | null;
}
interface ActivationOutput { type: string; contentId: string | null; message: string }

type Load =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; summary: LeoSummary; outputs: ActivationOutput[] };

const day = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};
const STAGE: Record<string, string> = { comprehension: 'Comprensión', reflection: 'Reflexión', creation: 'Creación' };

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
    try {
        const r = await fetch(url, { cache: 'no-store' });
        let body: any = null;
        try { body = await r.json(); } catch { /* cuerpo vacío */ }
        return { ok: r.ok, status: r.status, body };
    } catch { return { ok: false, status: 0, body: null }; }
}

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="mt-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{title}</h4>
        {children}
    </div>
);

export const LeoMediatorPanel: React.FC<{
    studentId: string;
    studentName: string;
    /** Título de una obra por su id (la pantalla anfitriona ya lo conoce). */
    titleOf?: (contentId: string) => string | undefined;
}> = ({ studentId, studentName, titleOf }) => {
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const [openWork, setOpenWork] = useState<string | null>(null);
    const [history, setHistory] = useState<Record<string, LeoHistory | 'loading' | 'error'>>({});

    // V9 BI-65C — solo la consulta más reciente pinta: una respuesta anterior que llega tarde no repone lo retirado.
    const seq = useRef(0);
    const shown = useRef(false);
    const refresh = useCallback(async (mode?: unknown) => {
        const silent = mode === 'silent';   // revalidación de una pantalla abierta: sin parpadeo ni anuncio si nada cambió
        const turn = ++seq.current;
        if (!silent) { setLoad({ status: 'loading' }); setOpenWork(null); setHistory({}); shown.current = false; }
        const id = encodeURIComponent(studentId);
        const [s, a] = await Promise.all([getJson(`/api/leo/mediator/student/${id}`), getJson(`/api/leo/activation/${id}`)]);
        if (turn !== seq.current) return;
        if (!s.ok || !s.body?.summary) {
            // Sin respuesta durante una revalidación: no confirma ni desmiente; se conserva lo que había y se reintenta.
            if (silent && s.status === 0) return;
            const withdrawn = silent && shown.current;
            shown.current = false; setOpenWork(null); setHistory({});
            return setLoad({ status: 'error', message: s.status === 0
                ? 'No hubo respuesta del servidor. Revisa la conexión e inténtalo de nuevo.'
                : withdrawn ? describeAccessWithdrawn('reader', s.status) : describeInstitutionalError('reader', s.status, s.body?.error) });
        }
        shown.current = true;
        setLoad({ status: 'ready', summary: s.body.summary, outputs: a.ok && Array.isArray(a.body?.outputs) ? a.body.outputs : [] });
    }, [studentId]);
    useEffect(() => { refresh(); }, [refresh]);
    useAuthorizationRevalidation(() => { refresh('silent'); });

    const toggleWork = async (contentId: string) => {
        if (openWork === contentId) return setOpenWork(null);
        setOpenWork(contentId);
        if (history[contentId] && history[contentId] !== 'error') return;
        setHistory(h => ({ ...h, [contentId]: 'loading' }));
        const r = await getJson(`/api/leo/mediator/student/${encodeURIComponent(studentId)}/content/${encodeURIComponent(contentId)}`);
        // El servidor negó el detalle (401/403): el resumen ya cargado tampoco está vigente; se vuelve a consultar.
        if (r.status === 401 || r.status === 403) { refresh('silent'); return; }
        setHistory(h => ({ ...h, [contentId]: r.ok && r.body?.history ? r.body.history : 'error' }));
    };

    const title = (id: string | null) => (id && titleOf?.(id)) || 'Obra del curso';

    return (
        <section aria-labelledby="leo-mediator-title" data-testid="leo-mediator-panel"
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 border border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 id="leo-mediator-title" className="text-base font-bold flex items-center gap-2">
                        <Sparkles size={16} className="text-indigo-500" aria-hidden="true" /> Leo: lectura pedagógica
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{studentName} · solo con la actividad del curso</p>
                </div>
                <button type="button" onClick={() => refresh()} aria-label="Actualizar la lectura pedagógica de Leo"
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <RefreshCw size={14} aria-hidden="true" />
                </button>
            </div>

            {load.status === 'loading' && <p role="status" className="mt-3 text-sm text-gray-500">Consultando a Leo…</p>}
            {load.status === 'error' && <p role="alert" data-testid="leo-error" className="mt-3 text-sm text-red-700 dark:text-red-300">{load.message}</p>}

            {load.status === 'ready' && (() => {
                const s = load.summary;
                const state = describeDataState(s.data_state ?? 'ok', s.reason, 'leo');
                if (state) {
                    return (
                        <div role="status" data-testid="leo-state" data-state={state.kind}
                            className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{state.title}</p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{state.body}</p>
                        </div>
                    );
                }
                const works: string[] = Array.from(new Set<string>((s.recentEvidenceSignals ?? []).map(e => e.contentId).filter((x): x is string => !!x)));
                const objective = objectiveLabel(s.dominantPedagogicalObjective), support = objectiveLabel(s.preferredSupportType);
                return (
                    <div data-testid="leo-content">
                        <p role="status" data-testid="leo-sufficiency" className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                            Evidencia del curso suficiente: {s.provenance?.evidence ?? 0} {s.provenance?.evidence === 1 ? 'interacción' : 'interacciones'} con Leo
                            y {s.provenance?.reading_sessions ?? 0} {s.provenance?.reading_sessions === 1 ? 'sesión' : 'sesiones'} de lectura
                            {day(s.provenance?.first_ts) && day(s.provenance?.last_ts) ? `, entre el ${day(s.provenance?.first_ts)} y el ${day(s.provenance?.last_ts)}` : ''}.
                        </p>

                        <Block title="Perfil lector (ICDLI)">
                            {s.icdliHasData
                                ? <p className="text-sm" data-testid="leo-icdli"><span className="font-semibold">{s.icdliLevel}</span> · índice {s.icdliComposite} de 100</p>
                                : <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="leo-icdli">Todavía no hay sesiones de lectura del curso suficientes para calcular el índice.</p>}
                        </Block>

                        <Block title="Fortalezas">
                            {(s.icdliDominantStrengths ?? []).length > 0
                                ? <ul className="text-sm list-disc pl-5" data-testid="leo-strengths">{s.icdliDominantStrengths!.map(x => <li key={x}>{x}</li>)}</ul>
                                : <p className="text-sm text-gray-600 dark:text-gray-300">Sin fortalezas identificadas todavía.</p>}
                        </Block>
                        <Block title="Alertas y necesidades de apoyo">
                            {[...(s.icdliDominantAlerts ?? []), ...(s.alerts ?? [])].length > 0
                                ? <ul className="text-sm list-disc pl-5" data-testid="leo-alerts">{[...(s.icdliDominantAlerts ?? []), ...(s.alerts ?? [])].map(x => <li key={x}>{x}</li>)}</ul>
                                : <p className="text-sm text-gray-600 dark:text-gray-300">Sin alertas con la evidencia actual.</p>}
                        </Block>

                        <Block title="Acompañamiento">
                            <dl className="text-sm grid grid-cols-1 gap-1" data-testid="leo-support">
                                <div><dt className="inline text-gray-500">Objetivo dominante: </dt><dd className="inline font-medium">{objective ?? 'aún no se distingue'}</dd></div>
                                <div><dt className="inline text-gray-500">Tipo de apoyo recomendado: </dt><dd className="inline font-medium">{support ?? 'aún no se distingue'}</dd></div>
                            </dl>
                            {s.suggestedMediatorAction && (
                                <p data-testid="leo-action" className="mt-2 text-sm p-2 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100">
                                    <span className="font-semibold">Acción sugerida: </span>{s.suggestedMediatorAction}
                                </p>
                            )}
                        </Block>

                        <Block title="Sesiones y continuidad">
                            <p className="text-sm" data-testid="leo-continuity">
                                {s.totalInteractions ?? 0} {s.totalInteractions === 1 ? 'interacción' : 'interacciones'} con Leo en obras del curso
                                {day(s.lastInteractionAt) ? ` · última el ${day(s.lastInteractionAt)}` : ''}.
                            </p>
                            {works.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {works.map(w => {
                                        const h = history[w], open = openWork === w;
                                        return (
                                            <li key={w} className="border border-gray-100 dark:border-gray-700 rounded-md">
                                                <button type="button" onClick={() => toggleWork(w)} aria-expanded={open} data-testid="leo-work-toggle"
                                                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-md">
                                                    <span>{title(w)}</span>
                                                    {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                                                </button>
                                                {open && (
                                                    <div className="px-3 pb-3 text-sm" data-testid="leo-work-detail">
                                                        {h === 'loading' && <p role="status" className="text-gray-500">Cargando…</p>}
                                                        {h === 'error' && <p role="alert" className="text-red-700 dark:text-red-300">No se pudo consultar el detalle de esta obra. Inténtalo de nuevo.</p>}
                                                        {h && typeof h === 'object' && (describeDataState(h.data_state ?? 'ok', undefined, 'leo')
                                                            ? <p className="text-gray-600 dark:text-gray-300">{describeDataState(h.data_state, undefined, 'leo')!.body}</p>
                                                            : (
                                                                <dl className="grid grid-cols-1 gap-1">
                                                                    <div><dt className="inline text-gray-500">Interacciones con Leo: </dt><dd className="inline">{h.interactionCount ?? 'sin dato'}</dd></div>
                                                                    <div><dt className="inline text-gray-500">Etapa: </dt><dd className="inline">{(h.pedagogicalStage && (STAGE[h.pedagogicalStage] ?? h.pedagogicalStage)) || 'sin dato'}</dd></div>
                                                                    <div><dt className="inline text-gray-500">Dificultad de las preguntas: </dt><dd className="inline">{h.difficultyLevel ?? 'sin dato'}{trendLabel(h.difficultyTrend) ? ` · ${trendLabel(h.difficultyTrend)!.toLowerCase()}` : ''}</dd></div>
                                                                    <div><dt className="inline text-gray-500">Qué trabajó: </dt><dd className="inline">{(Object.entries(h.objectiveDistribution ?? {}) as [string, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${objectiveLabel(k)} (${n})`).join(', ') || 'sin dato'}</dd></div>
                                                                    {day(h.lastInterventionAt) && <div><dt className="inline text-gray-500">Última vez: </dt><dd className="inline">{day(h.lastInterventionAt)}</dd></div>}
                                                                </dl>
                                                            ))}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Block>

                        <Block title="Activación y acompañamiento familiar">
                            {load.outputs.length > 0
                                ? (
                                    <ul className="space-y-2" data-testid="leo-activation">
                                        {load.outputs.map((o, i) => (
                                            <li key={`${o.type}-${i}`} className="text-sm p-2 rounded-md bg-gray-50 dark:bg-gray-900/40">
                                                <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">{activationLabel(o.type)}{o.contentId ? ` · ${title(o.contentId)}` : ''}</span>
                                                {o.message}
                                            </li>
                                        ))}
                                    </ul>
                                )
                                : <p className="text-sm text-gray-600 dark:text-gray-300">Leo no tiene sugerencias de activación con la evidencia actual.</p>}
                        </Block>
                    </div>
                );
            })()}
        </section>
    );
};
