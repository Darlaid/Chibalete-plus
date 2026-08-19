/**
 * ProduccionesTab.tsx — CHP-MOOK-REVIEW-01 (UX congelada: CHP_MOOK_PRODUCT_UX_01 §D1–D4).
 *
 * Pestaña «Producciones» de Aula Viva: bandeja de producciones de Experiencias
 * y superficie de revisión humana. Mediación, no calificación: sin notas, sin
 * ranking, sin comparación entre participantes.
 *
 * Seguridad (gate M1-B): la autorización vive en el backend — mediadores sin
 * scope demostrable reciben 403 fail-closed y esta UI lo comunica; jamás una
 * cola global. El fallo de consulta se distingue del vacío (nunca «0» falso).
 */
import React, { useEffect, useRef, useState } from 'react';
import { dataService } from '../../services/dataService';
import { ClipboardCheck, RefreshCw, Lock, X, Clock, PenLine } from 'lucide-react';

const ESTADO: Record<string, { text: string; cls: string }> = {
    SUBMITTED: { text: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
    REVISION_REQUESTED: { text: 'Ajustes solicitados', cls: 'bg-orange-100 text-orange-800' },
    RESUBMITTED: { text: 'Reenviada — pendiente', cls: 'bg-amber-100 text-amber-800' },
    REVIEWED: { text: 'Revisada', cls: 'bg-emerald-100 text-emerald-700' },
};

const HISTORY_LABEL: Record<string, string> = {
    submitted: 'Entrega',
    feedback: 'Retroalimentación',
    revision_requested: 'Ajustes solicitados',
    resubmitted: 'Reenvío',
    reviewed: 'Revisión realizada',
};

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');

export const ProduccionesTab: React.FC = () => {
    const [state, setState] = useState<'loading' | 'ready' | 'error' | 'gated'>('loading');
    const [items, setItems] = useState<any[]>([]);
    const [gateMsg, setGateMsg] = useState('');
    const [fExp, setFExp] = useState('');
    const [fEstado, setFEstado] = useState('');
    const [fDesde, setFDesde] = useState('');
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any | null>(null);
    const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmReview, setConfirmReview] = useState(false);
    const [actionDone, setActionDone] = useState<string | null>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);

    const load = async () => {
        setState('loading');
        const r = await dataService.getReviewProductions();
        if (r.ok) { setItems(r.items ?? []); setState('ready'); }
        else if (r.code === 'MEDIATOR_SCOPE_GATED' || r.code === 'REVIEW_FORBIDDEN') { setGateMsg(r.error ?? ''); setState('gated'); }
        else setState('error');
    };
    useEffect(() => { load(); }, []);

    const openDetail = async (id: string, opener: HTMLElement | null) => {
        openerRef.current = opener;
        setDetailId(id); setDetail(null); setDetailState('loading');
        setComment(''); setActionError(null); setConfirmReview(false); setActionDone(null);
        const r = await dataService.getReviewProductionDetail(id);
        if (r.ok) { setDetail(r.data); setDetailState('idle'); }
        else setDetailState('error');
    };
    useEffect(() => {
        if (detailId) dialogRef.current?.focus();
    }, [detailId, detail]);

    const closeDetail = () => {
        setDetailId(null); setDetail(null);
        openerRef.current?.focus?.();
    };

    const refreshAfterAction = async (msg: string) => {
        setActionDone(msg);
        // Cola y detalle se actualizan sin recarga completa.
        const [list, det] = await Promise.all([
            dataService.getReviewProductions(),
            detailId ? dataService.getReviewProductionDetail(detailId) : Promise.resolve(null as any),
        ]);
        if (list.ok) setItems(list.items ?? []);
        if (det?.ok) setDetail(det.data);
    };

    const doFeedback = async () => {
        if (busy) return;
        if (!comment.trim()) { setActionError('Escribe la retroalimentación antes de enviarla.'); return; }
        setBusy(true); setActionError(null);
        const r = await dataService.sendReviewFeedback(detailId!, comment.trim());
        setBusy(false);
        if (!r.ok) { setActionError(r.error ?? 'No se pudo enviar'); return; }
        setComment('');
        await refreshAfterAction('Retroalimentación enviada.');
    };

    const doRequestChanges = async () => {
        if (busy) return;
        if (!comment.trim()) { setActionError('Solicitar ajustes exige explicar qué ajustar (comentario obligatorio).'); return; }
        setBusy(true); setActionError(null);
        const r = await dataService.requestProductionChanges(detailId!, comment.trim());
        setBusy(false);
        if (!r.ok) { setActionError(r.error ?? 'No se pudo solicitar'); return; }
        setComment('');
        await refreshAfterAction('Ajustes solicitados — el participante podrá reenviar su producción.');
    };

    const doMarkReviewed = async (decision: 'aprobado' | 'con_comentarios') => {
        if (busy) return;
        setBusy(true); setActionError(null);
        const ok = await dataService.reviewExperienceEvidence(detailId!, decision, comment.trim());
        setBusy(false); setConfirmReview(false);
        if (!ok) { setActionError('No se pudo marcar como revisada.'); return; }
        setComment('');
        await refreshAfterAction('Revisión confirmada.');
    };

    // ── Filtros (client-side sobre la bandeja autorizada) ──
    const expTitles = [...new Set(items.map(i => i.experience).filter(Boolean))] as string[];
    const shown = items.filter(i =>
        (!fExp || i.experience === fExp) &&
        (!fEstado || i.status === fEstado) &&
        (!fDesde || String(i.submittedAt) >= fDesde)
    );
    const pending = items.filter(i => i.status !== 'REVIEWED').length;

    return (
        <div className="animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-2xl font-bold flex items-center gap-2"><PenLine size={22} aria-hidden /> Producciones</h2>
                {state === 'ready' && (
                    <p className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
                        {items.length === 0 ? 'Sin producciones' : `${items.length} producción${items.length === 1 ? '' : 'es'} · ${pending} pendiente${pending === 1 ? '' : 's'} de revisión`}
                    </p>
                )}
            </div>

            {state === 'loading' && <p className="text-gray-500 py-8">Cargando producciones…</p>}

            {state === 'gated' && (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-amber-300 dark:border-amber-700">
                    <Lock size={40} className="mx-auto text-amber-400 mb-3" aria-hidden />
                    <p className="font-bold text-gray-700 dark:text-gray-200">Acceso aún no habilitado</p>
                    <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">{gateMsg || 'La revisión para mediadores se habilita cuando el sistema pueda garantizar el alcance institucional de tu cola.'}</p>
                </div>
            )}

            {state === 'error' && (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-red-300 dark:border-red-700" role="alert">
                    <p className="font-bold text-gray-700 dark:text-gray-200">No se pudieron cargar las producciones</p>
                    <p className="text-sm text-gray-500 mt-1">El conteo no está disponible (esto no significa que no haya entregas).</p>
                    <button type="button" onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold inline-flex items-center gap-1"><RefreshCw size={14} aria-hidden /> Reintentar</button>
                </div>
            )}

            {state === 'ready' && (
                <>
                    <div className="flex flex-wrap gap-3 mb-5">
                        <div>
                            <label htmlFor="prod-f-exp" className="block text-xs font-medium text-gray-500 mb-1">Experiencia</label>
                            <select id="prod-f-exp" value={fExp} onChange={e => setFExp(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm">
                                <option value="">Todas</option>
                                {expTitles.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="prod-f-estado" className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
                            <select id="prod-f-estado" value={fEstado} onChange={e => setFEstado(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm">
                                <option value="">Todos</option>
                                {Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="prod-f-desde" className="block text-xs font-medium text-gray-500 mb-1">Entregadas desde</label>
                            <input id="prod-f-desde" type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                    </div>

                    {items.length === 0 && (
                        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                            <ClipboardCheck size={40} className="mx-auto text-gray-300 mb-3" aria-hidden />
                            <p className="text-gray-500">No hay producciones pendientes. Las nuevas aparecerán aquí.</p>
                        </div>
                    )}
                    {items.length > 0 && shown.length === 0 && (
                        <p className="text-gray-500 py-8">Ninguna producción coincide con el filtro actual. <button type="button" className="font-bold text-indigo-600 underline" onClick={() => { setFExp(''); setFEstado(''); setFDesde(''); }}>Limpiar filtros</button></p>
                    )}

                    <ul className="space-y-3">
                        {shown.map(i => (
                            <li key={i.id}>
                                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-wrap items-center gap-3">
                                    <div className="flex-1 min-w-52">
                                        <p className="font-bold text-gray-800 dark:text-gray-100">{i.participantName ?? 'Participante'}</p>
                                        <p className="text-sm text-gray-500">{i.experience} · v{i.version}{i.moduleTitle ? ` · ${i.moduleTitle}` : ''} · {i.nodeTitle}</p>
                                        <p className="text-xs text-gray-400 mt-1 inline-flex items-center gap-1"><Clock size={12} aria-hidden /> Entregada {fmt(i.submittedAt)}{i.versionsCount > 1 ? ` · ${i.versionsCount} versiones` : ''}</p>
                                    </div>
                                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${ESTADO[i.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}>{ESTADO[i.status]?.text ?? i.status}</span>
                                    <button type="button" onClick={(e) => openDetail(i.id, e.currentTarget)} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Revisar</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {/* ── Detalle (D3) ── */}
            {detailId && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Detalle de la producción">
                    <div ref={dialogRef} tabIndex={-1} className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full my-6 p-6 shadow-2xl outline-none">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Revisión de producción</h3>
                            <button type="button" onClick={closeDetail} aria-label="Cerrar detalle" className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
                        </div>

                        {detailState === 'loading' && <p className="text-gray-500">Cargando detalle…</p>}
                        {detailState === 'error' && (
                            <p className="text-red-600" role="alert">No se pudo cargar el detalle. <button type="button" className="font-bold underline" onClick={() => openDetail(detailId, openerRef.current)}>Reintentar</button></p>
                        )}

                        {detail && (
                            <div className="space-y-4">
                                <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                                    <p><b>{detail.participantName ?? 'Participante'}</b> · {detail.experience} · v{detail.version}{detail.moduleTitle ? ` · ${detail.moduleTitle}` : ''} · {detail.nodeTitle}</p>
                                    {detail.objectives?.length > 0 && <p><b>Objetivo:</b> {detail.objectives[0]}</p>}
                                    <p><b>Consigna:</b> {detail.consigna}</p>
                                    {detail.criterioRevision && <p><b>Criterio de revisión:</b> {detail.criterioRevision}</p>}
                                    <p><b>Estado:</b> <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ESTADO[detail.status]?.cls ?? ''}`}>{ESTADO[detail.status]?.text ?? detail.status}</span>{detail.runStatus === 'completed' ? ' · recorrido completado' : ' · recorrido en curso'}</p>
                                </div>

                                <section aria-label="Entregas del participante">
                                    <h4 className="font-bold text-sm text-gray-700 dark:text-gray-200 mb-2">Entrega{detail.versions.length > 1 ? `s (${detail.versions.length} versiones — la más reciente al final)` : ''}</h4>
                                    <div className="space-y-3">
                                        {detail.versions.map((vv: any, i: number) => (
                                            <blockquote key={i} className={`border-l-4 pl-3 py-1 text-sm whitespace-pre-wrap ${i === detail.versions.length - 1 ? 'border-indigo-400' : 'border-gray-300 opacity-75'}`}>
                                                <p className="text-xs text-gray-400 mb-1">Versión {i + 1} · {fmt(vv.submittedAt)}{i === detail.versions.length - 1 ? ' · vigente' : ''}</p>
                                                {vv.text}
                                            </blockquote>
                                        ))}
                                    </div>
                                </section>

                                {detail.activityContext?.length > 0 && (
                                    <details className="text-sm">
                                        <summary className="cursor-pointer font-bold text-gray-700 dark:text-gray-200">Contexto: respuestas de actividad del recorrido</summary>
                                        {detail.activityContext.map((a: any, i: number) => (
                                            <div key={i} className="mt-2 pl-3 border-l-2 border-gray-200">
                                                <p className="text-xs text-gray-500 font-bold">{a.nodeTitle}</p>
                                                {a.preguntas.map((p: string, j: number) => (
                                                    <p key={j} className="text-xs text-gray-600 dark:text-gray-300 mt-1"><i>{p}</i><br />{a.answers[j] ?? '—'}</p>
                                                ))}
                                            </div>
                                        ))}
                                    </details>
                                )}

                                <section aria-label="Historial de revisión">
                                    <h4 className="font-bold text-sm text-gray-700 dark:text-gray-200 mb-2">Historial</h4>
                                    <ol className="space-y-1 text-sm">
                                        {detail.history.map((h: any, i: number) => (
                                            <li key={i} className="text-gray-600 dark:text-gray-300">
                                                <span className="font-medium">{HISTORY_LABEL[h.type] ?? h.type}</span>
                                                <span className="text-xs text-gray-400"> · {fmt(h.at)}</span>
                                                {h.comment && <span className="block text-xs italic pl-3">“{h.comment}”</span>}
                                            </li>
                                        ))}
                                    </ol>
                                </section>

                                {detail.status !== 'REVIEWED' ? (
                                    <section aria-label="Acciones de revisión" className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
                                        <div>
                                            <label htmlFor="review-comment" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Comentario de mediación</label>
                                            <textarea id="review-comment" value={comment} onChange={e => setComment(e.target.value)} rows={3}
                                                aria-describedby={actionError ? 'review-action-err' : undefined}
                                                className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm"
                                                placeholder="Retroalimentación para el participante… (obligatorio para solicitar ajustes)" />
                                        </div>
                                        {actionError && <p id="review-action-err" className="text-sm text-red-600" role="alert">{actionError}</p>}
                                        {actionDone && <p className="text-sm text-emerald-700" role="status">{actionDone}</p>}
                                        <div className="flex flex-wrap gap-3">
                                            <button type="button" onClick={doFeedback} disabled={busy} className="px-4 py-2 rounded-xl border border-indigo-300 text-indigo-700 dark:text-indigo-300 text-sm font-bold disabled:opacity-50">Enviar retroalimentación</button>
                                            <button type="button" onClick={doRequestChanges} disabled={busy || detail.status === 'REVISION_REQUESTED'} className="px-4 py-2 rounded-xl border border-orange-300 text-orange-700 text-sm font-bold disabled:opacity-50">
                                                {detail.status === 'REVISION_REQUESTED' ? 'Ajustes ya solicitados' : 'Solicitar ajustes'}
                                            </button>
                                            {confirmReview ? (
                                                <span className="inline-flex flex-wrap items-center gap-2 text-sm bg-indigo-50 dark:bg-indigo-900/20 rounded-xl px-3 py-2">
                                                    Confirmar revisión (cierra la conversación):
                                                    <button type="button" onClick={() => doMarkReviewed('aprobado')} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50">Aprobar</button>
                                                    <button type="button" onClick={() => doMarkReviewed('con_comentarios')} disabled={busy} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold disabled:opacity-50">Con comentarios</button>
                                                    <button type="button" onClick={() => setConfirmReview(false)} className="px-3 py-1.5 rounded-lg border border-gray-300 font-bold">Cancelar</button>
                                                </span>
                                            ) : (
                                                <button type="button" onClick={() => setConfirmReview(true)} disabled={busy} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Marcar como revisada…</button>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400">Revisar = confirmar la mediación humana. No es una calificación ni una evaluación del aprendizaje.</p>
                                    </section>
                                ) : (
                                    <p className="text-sm text-emerald-700 border-t border-gray-200 dark:border-gray-700 pt-4">
                                        Revisada el {fmt(detail.review?.reviewedAt)} — {detail.review?.decision === 'aprobado' ? 'Aprobada' : 'Con comentarios'}{detail.review?.feedback ? <>: <span className="italic">“{detail.review.feedback}”</span></> : null}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProduccionesTab;
