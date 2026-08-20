/**
 * Experiencias.tsx — CHP-MOOK-RUNTIME-01 (UX congelada en CHP_MOOK_PRODUCT_UX_01).
 *
 * Runtime del participante: Landing (comprender ANTES de iniciar; no crea run)
 * → Ruta por módulos (estados derivados) → NodeShell del nodo actual →
 * Cierre. Reutiliza visores/Leo/preflight existentes — MOOK jamás concede
 * acceso. La pestaña Revisión permanece aquí de forma técnica hasta que
 * REVIEW-01 la reubique en Aula Viva.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { BookOpen, MessageCircle, ListChecks, PenLine, CheckCircle2, Lock, Circle, Clock, Users } from 'lucide-react';

export const NODE_ICON: Record<string, React.ReactNode> = {
    READING: <BookOpen size={16} />, VIDEO: <BookOpen size={16} />, AUDIO: <BookOpen size={16} />,
    LEO: <MessageCircle size={16} />, ACTIVITY: <ListChecks size={16} />, PRODUCTION: <PenLine size={16} />,
};
export const NODE_TYPE_LABEL: Record<string, string> = {
    READING: 'Lectura', VIDEO: 'Video', AUDIO: 'Audio', LEO: 'Conversación con Leo', ACTIVITY: 'Actividad', PRODUCTION: 'Producción',
};
export const MODULE_STATE_LABEL: Record<string, { text: string; cls: string }> = {
    COMPLETED: { text: 'Completado', cls: 'bg-emerald-100 text-emerald-700' },
    IN_PROGRESS: { text: 'En curso', cls: 'bg-indigo-100 text-indigo-700' },
    NOT_STARTED: { text: 'Por iniciar', cls: 'bg-gray-100 text-gray-600' },
};

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Barra de progreso accesible de la Experiencia. */
export const ProgressBar: React.FC<{ done: number; total: number }> = ({ done, total }) => (
    <div role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={`Progreso: ${done} de ${total} pasos completados`}>
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
            <div className="h-2 bg-indigo-600 rounded-full transition-all" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
    </div>
);

/**
 * NodeShell — nodo actual/expandido: contexto, instrucción, contenido, acción.
 * `preview` (STUDIO-01, C11): mismo renderer sin efectos — completar/enviar
 * NO llaman a la API (cero runs, cero evidencia, cero eventos).
 */
export const NodeShell: React.FC<{ node: any; moduleTitle: string; experienceTitle: string; route: any; refresh: () => void; preview?: boolean }> = ({ node, moduleTitle, experienceTitle, route, refresh, preview = false }) => {
    const [answers, setAnswers] = useState<string[]>([]);
    const [text, setText] = useState('');
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const myEvidence = (route.evidence || []).filter((e: any) => e.nodeId === node.id);

    const complete = async () => {
        if (preview) { setMsg('Vista previa — nada de lo que hagas aquí se guarda.'); return; }
        setBusy(true); setMsg(null);
        const r = await dataService.completeExperienceNode(route.runId, node.id);
        if (!r.ok) setMsg(r.error ?? 'No se pudo completar');
        setBusy(false); refresh();
    };
    const send = async (payload: { answers?: string[]; text?: string }) => {
        if (preview) { setMsg('Vista previa — nada de lo que hagas aquí se guarda.'); return; }
        setBusy(true); setMsg(null);
        const r = await dataService.submitExperienceEvidence(route.runId, node.id, payload);
        if (!r.ok) setMsg(r.error ?? 'No se pudo enviar');
        setBusy(false); refresh();
    };

    return (
        <div className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-800 p-5 shadow-md">
            <p className="text-xs text-gray-400 mb-1">{experienceTitle} · {moduleTitle}</p>
            <div className="flex items-center justify-between">
                <h4 className="font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center gap-2">{NODE_ICON[node.type]} {node.title}</h4>
                <span className="text-xs font-bold text-indigo-600 inline-flex items-center gap-1"><Circle size={12} /> Estás aquí</span>
            </div>
            {node.config?.instruccion && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{node.config.instruccion}</p>}

            {node.resource && (
                <div className="flex items-center gap-3 my-3 rounded-xl bg-gray-50 dark:bg-gray-900 p-3">
                    {node.resource.portada_url && <img src={node.resource.portada_url} alt="" className="w-10 h-14 object-cover rounded" />}
                    <div className="text-sm text-gray-700 dark:text-gray-200">{node.resource.titulo}<span className="text-gray-400"> · {node.resource.autor}</span></div>
                    <Link to={`/contenido/${node.resource.id}`} className="ml-auto px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold">Abrir {NODE_TYPE_LABEL[node.type]?.toLowerCase() ?? ''}</Link>
                </div>
            )}
            {node.resourceRef && !node.resource && (
                <div className="flex items-center gap-2 my-3 text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                    <Lock size={14} /> Este recurso no está disponible para tu cuenta — pídelo a tu mediador. El nodo no puede completarse sin él.
                </div>
            )}

            {(node.type === 'VIDEO' || node.type === 'AUDIO') && node.config?.transcripcion && (
                // ADR §17.4: la alternativa textual del medio debe ser accesible desde el nodo.
                <details className="my-2 rounded-xl bg-gray-50 dark:bg-gray-900 p-3">
                    <summary className="text-sm font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer">Ver transcripción (alternativa textual)</summary>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-line">{node.config.transcripcion}</p>
                </details>
            )}

            {node.type === 'LEO' && (
                <>
                    <p className="text-sm text-gray-600 dark:text-gray-300 my-2 italic">“{node.config?.semilla}” — conversa con Leo dentro de la lectura (mínimo {node.config?.minIntercambios} intercambios).</p>
                    {/* Aviso de IA — ADR §17.6: visible y comprensible en el nodo LEO. */}
                    <p className="text-xs text-gray-500 dark:text-gray-400 my-2 rounded-lg bg-gray-50 dark:bg-gray-900 p-2 flex items-start gap-1">
                        <MessageCircle size={12} className="mt-0.5 shrink-0" aria-hidden />
                        <span>Leo es un asistente de inteligencia artificial: conversarás con una IA que acompaña tu lectura, no con una persona. Leo no califica ni evalúa; las producciones las revisa siempre tu mediador humano.</span>
                    </p>
                </>
            )}

            {(node.type === 'READING' || node.type === 'VIDEO' || node.type === 'AUDIO' || node.type === 'LEO') && (
                <button onClick={complete} disabled={busy || (node.resourceRef && !node.resource)} className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
                    {node.type === 'LEO' ? 'Ya conversé — validar' : node.type === 'READING' ? 'Terminé esta lectura' : 'Terminé de verlo/escucharlo'}
                </button>
            )}

            {node.type === 'ACTIVITY' && (
                <div className="space-y-3 mt-2">
                    {(node.config?.preguntas ?? []).map((p: any, i: number) => (
                        <div key={i}>
                            <label htmlFor={`act-${node.id}-${i}`} className="text-sm font-medium text-gray-700 dark:text-gray-200">{p.texto}</label>
                            <textarea id={`act-${node.id}-${i}`} value={answers[i] ?? ''} onChange={e => setAnswers(a => { const c = [...a]; c[i] = e.target.value; return c; })}
                                rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                    ))}
                    <p id={`act-${node.id}-note`} role="note" className="text-xs text-gray-500 dark:text-gray-400">Si respondes, tu reflexión se guardará como parte de tu recorrido. No se enviará a revisión.</p>
                    <button onClick={() => send({ answers })} disabled={busy} aria-describedby={`act-${node.id}-note`} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Enviar respuestas</button>
                </div>
            )}

            {node.type === 'PRODUCTION' && (
                <div className="space-y-2 mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{node.config?.consigna}</p>
                    {node.config?.criterioRevision && <p className="text-xs text-gray-500">Criterio de revisión: {node.config.criterioRevision}</p>}
                    <label htmlFor={`prod-${node.id}`} className="sr-only">Tu producción</label>
                    <textarea id={`prod-${node.id}`} value={text} onChange={e => setText(e.target.value)} rows={8}
                        className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" placeholder="Escribe aquí tu texto…" />
                    <div className="flex items-center justify-between">
                        <span className={`text-xs ${wordCount(text) >= (node.config?.minPalabras ?? 150) && wordCount(text) <= (node.config?.maxPalabras ?? 300) ? 'text-emerald-600 font-bold' : 'text-gray-400'}`}>
                            {wordCount(text)} palabras ({node.config?.minPalabras ?? 150}–{node.config?.maxPalabras ?? 300})
                        </span>
                        <button onClick={() => send({ text })} disabled={busy} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Enviar producción</button>
                    </div>
                </div>
            )}

            {myEvidence.map((e: any) => (
                <div key={e.id} className="mt-3 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                    {e.requiresReview
                        ? <ProductionStatus e={e} compact />
                        : <span className="text-emerald-700">Respuestas enviadas.</span>}
                </div>
            ))}
            {msg && <p className="mt-2 text-sm text-red-600" role="alert">{msg}</p>}
        </div>
    );
};

/**
 * REVIEW-01 — estado de la producción del PROPIO participante (D4): texto del
 * estado, retroalimentación de mediación, historial de versiones y reenvío
 * cuando el mediador solicitó ajustes. La entrega anterior nunca se pierde.
 */
export const PRODUCTION_STATE_LABEL: Record<string, string> = {
    SUBMITTED: 'Enviado — pendiente de revisión.',
    REVISION_REQUESTED: 'Tu mediador te pidió ajustes — puedes reenviar tu producción.',
    RESUBMITTED: 'Reenviada — pendiente de revisión.',
    REVIEWED: 'Revisada',
};

const ProductionStatus: React.FC<{ e: any; compact?: boolean }> = ({ e, compact }) => {
    const status = e.status ?? e.review?.status;
    const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '');
    return (
        <div className="text-sm space-y-1">
            {status === 'REVIEWED'
                ? <span>Revisada el {fmt(e.review?.reviewedAt)} — <b>{e.review?.decision === 'aprobado' ? 'Aprobada' : 'Con comentarios'}</b>{e.review?.feedback ? <>: <span className="italic">“{e.review.feedback}”</span></> : null}</span>
                : <span className={status === 'REVISION_REQUESTED' ? 'text-orange-700 font-medium' : 'text-amber-700'}>{PRODUCTION_STATE_LABEL[status] ?? status}</span>}
            {!compact && (e.comments ?? []).length > 0 && (
                <ul className="pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-1">
                    {e.comments.map((c: any, i: number) => (
                        <li key={i} className="text-xs text-gray-600 dark:text-gray-300 italic">“{c.comment}” <span className="not-italic text-gray-400">· mediación, {fmt(c.at)}</span></li>
                    ))}
                </ul>
            )}
            {!compact && (e.versions ?? []).length > 1 && (
                <p className="text-xs text-gray-400">Historial: {e.versions.map((v: any, i: number) => `versión ${i + 1} (${fmt(v.submittedAt)})`).join(' · ')} — todas se conservan.</p>
            )}
        </div>
    );
};

/** Panel «Tu producción» bajo la ruta: estado + reenvío tras ajustes (D4). */
const MyProductionPanel: React.FC<{ route: any; refresh: () => void }> = ({ route, refresh }) => {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const productions = (route.evidence || []).filter((e: any) => e.requiresReview);
    if (productions.length === 0) return null;

    const resubmit = async (e: any) => {
        if (busy) return;
        setBusy(true); setMsg(null);
        const r = await dataService.resubmitProduction(e.id, text);
        setBusy(false);
        if (!r.ok) { setMsg(r.error ?? 'No se pudo reenviar'); return; }
        setText('');
        refresh();
    };

    return (
        <section aria-label="Tu producción" className="mt-8 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-3">Tu producción</h3>
            {productions.map((e: any) => {
                const node = (route.nodes || []).find((n: any) => n.id === e.nodeId);
                const min = node?.config?.minPalabras ?? 150;
                const max = node?.config?.maxPalabras ?? 300;
                return (
                    <div key={e.id} className="space-y-3">
                        <ProductionStatus e={e} />
                        {e.canResubmit && (
                            <div className="space-y-2">
                                <label htmlFor={`resubmit-${e.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Nueva versión (la anterior se conserva en el historial)</label>
                                <textarea id={`resubmit-${e.id}`} value={text} onChange={ev => setText(ev.target.value)} rows={8}
                                    placeholder={e.currentText ? 'Puedes partir de tu versión anterior copiándola aquí…' : 'Escribe tu nueva versión…'}
                                    aria-describedby={msg ? `resubmit-err-${e.id}` : undefined}
                                    className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                                <div className="flex items-center justify-between">
                                    <span className={`text-xs ${wordCount(text) >= min && wordCount(text) <= max ? 'text-emerald-600 font-bold' : 'text-gray-400'}`}>
                                        {wordCount(text)} palabras ({min}–{max})
                                    </span>
                                    <button type="button" onClick={() => resubmit(e)} disabled={busy} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
                                        {busy ? 'Enviando…' : 'Reenviar producción'}
                                    </button>
                                </div>
                                {msg && <p id={`resubmit-err-${e.id}`} className="text-sm text-red-600" role="alert">{msg}</p>}
                            </div>
                        )}
                    </div>
                );
            })}
        </section>
    );
};

/** Fila compacta de nodo (no actual). */
export const NodeRow: React.FC<{ node: any }> = ({ node }) => (
    <div className={`flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 ${node.state === 'locked' ? 'opacity-55' : ''}`}>
        {node.state === 'completed' ? <CheckCircle2 size={18} className="text-emerald-600" aria-hidden /> : node.state === 'locked' ? <Lock size={16} className="text-gray-400" aria-hidden /> : <Circle size={16} className="text-gray-400" aria-hidden />}
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">{NODE_ICON[node.type]} {node.title}</span>
        <span className="ml-auto text-xs text-gray-500">
            {node.state === 'completed' ? 'Completado' : node.state === 'locked' ? 'Bloqueado' : node.required ? 'Pendiente' : 'Opcional'}
        </span>
    </div>
);

const Experiencias: React.FC = () => {
    const { user } = useAuth();
    const { experienceId } = useParams<{ experienceId?: string }>();
    const [list, setList] = useState<any[]>([]);
    const [detail, setDetail] = useState<any | null>(null);
    const [route, setRoute] = useState<any | null>(null);
    const [showRouteAfterClose, setShowRouteAfterClose] = useState(false);
    const currentRef = useRef<HTMLDivElement | null>(null);

    // REVIEW-01: la pestaña técnica de revisión se retiró de esta página (D1);
    // la revisión vive en Aula Viva → Producciones con autorización backend.

    useEffect(() => { if (user) dataService.getExperiences().then(setList); }, [user]);
    // Landing: comprender antes de iniciar. NO crea run; si ya hay run activo, entra directo a la ruta (reanudación B7).
    useEffect(() => {
        if (!user || !experienceId) return;
        dataService.getExperienceDetail(experienceId).then((d) => {
            setDetail(d);
            if (d?.myRun && d.myRun.status === 'active') {
                dataService.startExperienceRun(experienceId).then(setRoute);
            }
        });
    }, [user, experienceId]);
    useEffect(() => { currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [route?.progress?.completedRequired]);

    const start = async () => { if (detail) setRoute(await dataService.startExperienceRun(detail.id)); };
    const refresh = async () => { if (route) setRoute(await dataService.startExperienceRun(route.experienceId)); };

    // ── Cierre (Q) ──
    const renderCierre = () => {
        const production = (route.evidence || []).find((e: any) => e.requiresReview);
        return (
            <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-8 shadow-xl mb-8">
                <h2 className="text-3xl font-bold">🎉 Experiencia completada</h2>
                <ul className="mt-4 space-y-1">
                    {route.modules.map((m: any) => (
                        <li key={m.id} className="flex items-center gap-2"><CheckCircle2 size={16} aria-hidden /> {m.title} — {MODULE_STATE_LABEL[m.state]?.text}</li>
                    ))}
                </ul>
                {production && (
                    <div className="mt-4 text-emerald-50">
                        Tu producción: {production.status === 'REVIEWED'
                            ? <>Revisada — <b>{production.review?.decision === 'aprobado' ? 'Aprobada' : 'Con comentarios'}</b>{production.review?.feedback ? <>: <span className="italic">“{production.review.feedback}”</span></> : null}</>
                            : production.status === 'REVISION_REQUESTED'
                                ? 'Tu mediador te pidió ajustes — reenvíala desde «Revisar recorrido».'
                                : production.status === 'RESUBMITTED'
                                    ? 'Reenviada — pendiente de revisión.'
                                    : 'Pendiente de revisión por tu mediador.'}
                    </div>
                )}
                <div className="flex flex-wrap gap-3 mt-6">
                    <Link to="/biblioteca" className="bg-white text-emerald-700 px-5 py-3 rounded-xl font-bold">Volver a Biblioteca</Link>
                    <button onClick={() => setShowRouteAfterClose(s => !s)} className="border border-white/60 px-5 py-3 rounded-xl font-bold">{showRouteAfterClose ? 'Ocultar recorrido' : 'Revisar recorrido'}</button>
                    {list.filter(e => e.id !== route.experienceId).length > 0 && (
                        <Link to="/biblioteca" className="border border-white/60 px-5 py-3 rounded-xl font-bold">Otra Experiencia →</Link>
                    )}
                </div>
            </div>
        );
    };

    // ── Ruta (G/B3) ──
    const renderRoute = () => (
        <div>
            <Link to="/biblioteca" className="text-sm text-indigo-600 mb-4 hover:underline inline-block">← Biblioteca</Link>
            {route.status === 'completed' && renderCierre()}
            {(route.status !== 'completed' || showRouteAfterClose) && (
                <>
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{detail?.title ?? 'Tu ruta'}</h2>
                            <span className="text-sm font-bold text-gray-600 dark:text-gray-300">{route.progress.completedRequired}/{route.progress.totalRequired} completados</span>
                        </div>
                        <ProgressBar done={route.progress.completedRequired} total={route.progress.totalRequired} />
                    </div>
                    <div className="space-y-8">
                        {route.modules.map((m: any) => (
                            <section key={m.id} aria-label={`Módulo ${m.title}, ${MODULE_STATE_LABEL[m.state]?.text}`}>
                                <div className="flex items-center gap-3 mb-3">
                                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{m.title}</h3>
                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${MODULE_STATE_LABEL[m.state]?.cls ?? ''}`}>{MODULE_STATE_LABEL[m.state]?.text ?? m.state}</span>
                                </div>
                                <div className="space-y-3">
                                    {m.nodes.map((n: any) => n.state === 'current'
                                        ? <div key={n.id} ref={currentRef}><NodeShell node={n} moduleTitle={m.title} experienceTitle={detail?.title ?? 'Experiencia'} route={route} refresh={refresh} /></div>
                                        : <NodeRow key={n.id} node={n} />)}
                                </div>
                            </section>
                        ))}
                    </div>
                    <MyProductionPanel route={route} refresh={refresh} />
                </>
            )}
        </div>
    );

    // ── Landing (E/B2) ──
    const renderLanding = () => (
        <div>
            <Link to="/biblioteca" className="text-sm text-indigo-600 mb-4 hover:underline inline-block">← Biblioteca</Link>
            <div className="rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white p-8">
                    <span className="text-xs uppercase tracking-widest text-indigo-200">Experiencia</span>
                    <h2 className="text-3xl font-bold mt-1">{detail.title}</h2>
                    <p className="text-indigo-100 mt-2 max-w-2xl">{detail.description}</p>
                </div>
                <div className="p-8 space-y-4">
                    {detail.objectives?.length > 0 && (
                        <p className="text-gray-700 dark:text-gray-200"><b>Qué propone:</b> {detail.objectives[0]}</p>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300">
                        {detail.audience && <span className="inline-flex items-center gap-1"><Users size={14} aria-hidden /> {detail.audience}</span>}
                        {detail.durationLabel && <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden /> {detail.durationLabel}</span>}
                        <span>{detail.modules.length} módulos · {detail.modules.reduce((a: number, m: any) => a + m.nodeCount, 0)} pasos</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {detail.nodeTypes.map((t: string) => (
                            <span key={t} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-full inline-flex items-center gap-1">{NODE_ICON[t]} {NODE_TYPE_LABEL[t]}</span>
                        ))}
                    </div>
                    {detail.hasProduction && (
                        <p className="text-sm text-gray-500">Incluye una producción que revisará tu mediador.</p>
                    )}
                    <ul className="space-y-1">
                        {detail.modules.map((m: any, i: number) => (
                            <li key={m.id} className="text-sm text-gray-700 dark:text-gray-200">Módulo {i + 1}: <b>{m.title}</b> · {m.nodeCount} pasos</li>
                        ))}
                    </ul>
                    <button onClick={start} className="mt-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold">
                        {detail.myRun ? (detail.myRun.status === 'completed' ? 'Ver recorrido' : 'Continuar experiencia') : 'Iniciar experiencia'}
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="p-4 md:p-8 md:pt-10 max-w-4xl mx-auto">
            {!experienceId && (
                <>
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">Experiencias</h1>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">Listado técnico — la entrada de producto vive en Biblioteca → Experiencias.</p>
                </>
            )}

            {/* REVIEW-01: la revisión vive en Aula Viva → Producciones. */}
            {route ? renderRoute()
                : experienceId && detail ? renderLanding()
                : experienceId ? <p className="text-gray-500 mt-8">Cargando…</p>
                : (
                    <div className="grid gap-4">
                        {list.length === 0 && <p className="text-gray-500">Aún no hay Experiencias publicadas.</p>}
                        {list.map(e => (
                            <Link key={e.id} to={`/experiencias/${e.id}`} className="text-left rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 hover:shadow-md transition-shadow block">
                                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">{e.title}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{e.description}</p>
                                <span className="inline-block mt-3 text-sm font-bold text-indigo-600">{e.myRun ? 'Continuar ruta →' : 'Iniciar ruta →'}</span>
                            </Link>
                        ))}
                    </div>
                )}
        </div>
    );
};

export default Experiencias;
