/**
 * Experiencias.tsx — CHP-MOOK-01 (piloto vertical slice).
 *
 * Superficie mínima del contrato CHP-ADR-MOOK: descubrimiento, landing, ruta
 * de 5 nodos con estados, envío de actividad/producción y (para mediadores/
 * administradores) la cola mínima de revisión. Reutiliza visores y Leo
 * existentes navegando al contenido canónico — MOOK jamás concede acceso.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { BookOpen, MessageCircle, ListChecks, PenLine, CheckCircle2, Lock, Circle, ClipboardCheck } from 'lucide-react';

const NODE_ICON: Record<string, React.ReactNode> = {
    READING: <BookOpen size={18} />, VIDEO: <BookOpen size={18} />, AUDIO: <BookOpen size={18} />,
    LEO: <MessageCircle size={18} />, ACTIVITY: <ListChecks size={18} />, PRODUCTION: <PenLine size={18} />,
};

const StateBadge: React.FC<{ state: string; required: boolean }> = ({ state, required }) => {
    if (state === 'completed') return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold"><CheckCircle2 size={14} /> Completado</span>;
    if (state === 'locked') return <span className="inline-flex items-center gap-1 text-gray-400 text-xs"><Lock size={14} /> Bloqueado</span>;
    if (state === 'current') return <span className="inline-flex items-center gap-1 text-indigo-600 text-xs font-bold"><Circle size={14} /> Estás aquí</span>;
    return <span className="text-xs text-gray-500">{required ? 'Disponible' : 'Opcional'}</span>;
};

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

const NodeCard: React.FC<{ node: any; route: any; refresh: () => void }> = ({ node, route, refresh }) => {
    const [answers, setAnswers] = useState<string[]>([]);
    const [text, setText] = useState('');
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const disabled = node.state === 'locked' || busy;
    const myEvidence = (route.evidence || []).filter((e: any) => e.nodeId === node.id);

    const complete = async () => {
        setBusy(true); setMsg(null);
        const r = await dataService.completeExperienceNode(route.runId, node.id);
        if (!r.ok) setMsg(r.error ?? 'No se pudo completar');
        setBusy(false); refresh();
    };
    const send = async (payload: { answers?: string[]; text?: string }) => {
        setBusy(true); setMsg(null);
        const r = await dataService.submitExperienceEvidence(route.runId, node.id, payload);
        if (!r.ok) setMsg(r.error ?? 'No se pudo enviar');
        setBusy(false); refresh();
    };

    return (
        <div className={`rounded-2xl border p-5 bg-white dark:bg-gray-800 ${node.state === 'current' ? 'border-indigo-400 shadow-md' : 'border-gray-200 dark:border-gray-700'} ${node.state === 'locked' ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-bold text-gray-800 dark:text-gray-100">{NODE_ICON[node.type]} {node.title}</div>
                <StateBadge state={node.state} required={node.required} />
            </div>

            {node.resource && (
                <div className="flex items-center gap-3 my-3">
                    {node.resource.portada_url && <img src={node.resource.portada_url} alt="" className="w-10 h-14 object-cover rounded" />}
                    <div className="text-sm text-gray-600 dark:text-gray-300">{node.resource.titulo} · {node.resource.autor}</div>
                    <Link to={`/contenido/${node.resource.id}`} className="ml-auto text-sm font-bold text-indigo-600 hover:underline">Abrir</Link>
                </div>
            )}
            {node.resourceRef && !node.resource && node.state !== 'locked' && (
                <div className="flex items-center gap-2 my-3 text-sm text-amber-700"><Lock size={14} /> Sin acceso a este contenido — pídelo a tu mediador.</div>
            )}

            {node.type === 'LEO' && node.state !== 'completed' && (
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 italic">“{node.config?.semilla}” — conversa con Leo dentro del libro (mínimo {node.config?.minIntercambios} intercambios).</p>
            )}

            {(node.type === 'READING' || node.type === 'VIDEO' || node.type === 'AUDIO' || node.type === 'LEO') && node.state !== 'completed' && node.state !== 'locked' && (
                <button onClick={complete} disabled={disabled} className="mt-1 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
                    {node.type === 'LEO' ? 'Ya conversé — validar' : 'Terminé esta parte'}
                </button>
            )}

            {node.type === 'ACTIVITY' && node.state !== 'completed' && node.state !== 'locked' && (
                <div className="space-y-3 mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{node.config?.instruccion}</p>
                    {(node.config?.preguntas ?? []).map((p: any, i: number) => (
                        <div key={i}>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">{p.texto}</label>
                            <textarea value={answers[i] ?? ''} onChange={e => setAnswers(a => { const c = [...a]; c[i] = e.target.value; return c; })}
                                rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                    ))}
                    <button onClick={() => send({ answers })} disabled={disabled} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Enviar respuestas</button>
                </div>
            )}

            {node.type === 'PRODUCTION' && node.state !== 'completed' && node.state !== 'locked' && (
                <div className="space-y-2 mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{node.config?.consigna}</p>
                    <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
                        className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" placeholder="Escribe aquí tu texto…" />
                    <div className="flex items-center justify-between">
                        <span className={`text-xs ${wordCount(text) >= (node.config?.minPalabras ?? 150) && wordCount(text) <= (node.config?.maxPalabras ?? 300) ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {wordCount(text)} palabras ({node.config?.minPalabras ?? 150}–{node.config?.maxPalabras ?? 300})
                        </span>
                        <button onClick={() => send({ text })} disabled={disabled} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Enviar producción</button>
                    </div>
                </div>
            )}

            {myEvidence.map((e: any) => (
                <div key={e.id} className="mt-3 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 p-3 border border-gray-200 dark:border-gray-700">
                    {e.requiresReview ? (
                        e.review.status === 'REVIEWED'
                            ? <span>Revisado — <b>{e.review.decision === 'aprobado' ? 'Aprobado' : 'Con comentarios'}</b>{e.review.feedback ? <>: <span className="italic">“{e.review.feedback}”</span></> : null}</span>
                            : <span className="text-amber-700">Enviado — en revisión por tu mediador.</span>
                    ) : <span className="text-emerald-700">Respuestas enviadas.</span>}
                </div>
            ))}

            {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
        </div>
    );
};

const Experiencias: React.FC = () => {
    const { user } = useAuth();
    const [list, setList] = useState<any[]>([]);
    const [route, setRoute] = useState<any | null>(null);
    const [tab, setTab] = useState<'rutas' | 'revision'>('rutas');
    const [queue, setQueue] = useState<any[]>([]);
    const [feedback, setFeedback] = useState<Record<string, string>>({});

    const isReviewer = (user?.roles ?? []).some((r: string) => ['administrador', 'mediador', 'profesor', 'teacher', 'librarian', 'coordinator'].includes(r));

    useEffect(() => { if (user) dataService.getExperiences().then(setList); }, [user]);
    useEffect(() => { if (user && tab === 'revision' && isReviewer) dataService.getExperienceReviewQueue().then(setQueue); }, [user, tab]);

    const open = async (id: string) => setRoute(await dataService.startExperienceRun(id));
    const refresh = async () => { if (route) setRoute(await dataService.startExperienceRun(route.experienceId)); };

    const review = async (evidenceId: string, decision: 'aprobado' | 'con_comentarios') => {
        await dataService.reviewExperienceEvidence(evidenceId, decision, feedback[evidenceId] ?? '');
        setQueue(await dataService.getExperienceReviewQueue());
    };

    return (
        <div className="p-4 md:p-8 md:pt-10 max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">Experiencias</h1>
            <p className="text-gray-500 dark:text-gray-400 mb-6">Rutas de lectura, conversación y creación.</p>

            {isReviewer && (
                <div className="flex gap-3 mb-6">
                    <button onClick={() => setTab('rutas')} className={`px-5 py-2 rounded-full text-sm font-medium ${tab === 'rutas' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'}`}>Rutas</button>
                    <button onClick={() => setTab('revision')} className={`px-5 py-2 rounded-full text-sm font-medium inline-flex items-center gap-1 ${tab === 'revision' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'}`}><ClipboardCheck size={16} /> Revisión</button>
                </div>
            )}

            {tab === 'revision' && isReviewer ? (
                <div className="space-y-6">
                    {queue.length === 0 && <p className="text-gray-500">No hay producciones pendientes de revisión.</p>}
                    {queue.map(q => (
                        <div key={q.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
                            <div className="text-sm text-gray-500 mb-1">{q.experience} · v{q.version} · {q.nodeTitle}</div>
                            <div className="text-sm mb-2"><b>Consigna:</b> {q.consigna}</div>
                            <div className="text-sm mb-2"><b>Criterio:</b> {q.criterioRevision}</div>
                            <blockquote className="border-l-4 border-indigo-300 pl-3 my-3 text-sm whitespace-pre-wrap">{q.text}</blockquote>
                            <textarea value={feedback[q.id] ?? ''} onChange={e => setFeedback(f => ({ ...f, [q.id]: e.target.value }))}
                                rows={2} placeholder="Feedback para el estudiante…" className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm mb-2" />
                            <div className="flex gap-3">
                                <button onClick={() => review(q.id, 'aprobado')} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold">Aprobar</button>
                                <button onClick={() => review(q.id, 'con_comentarios')} className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold">Con comentarios</button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : route ? (
                <div>
                    <button onClick={() => setRoute(null)} className="text-sm text-indigo-600 mb-4 hover:underline">← Todas las Experiencias</button>
                    <div className="mb-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tu ruta</h2>
                            <span className="text-sm font-bold text-gray-600 dark:text-gray-300">{route.progress.completedRequired}/{route.progress.totalRequired} completados</span>
                        </div>
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-2">
                            <div className="h-2 bg-indigo-600 rounded-full transition-all" style={{ width: `${(route.progress.completedRequired / Math.max(1, route.progress.totalRequired)) * 100}%` }} />
                        </div>
                        {route.status === 'completed' && <p className="mt-3 text-emerald-600 font-bold">🎉 Experiencia completada.</p>}
                    </div>
                    <div className="space-y-4">
                        {route.nodes.map((n: any) => <NodeCard key={n.id} node={n} route={route} refresh={refresh} />)}
                    </div>
                </div>
            ) : (
                <div className="grid gap-4">
                    {list.length === 0 && <p className="text-gray-500">Aún no hay Experiencias publicadas.</p>}
                    {list.map(e => (
                        <button key={e.id} onClick={() => open(e.id)} className="text-left rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 hover:shadow-md transition-shadow">
                            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">{e.title}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{e.description}</p>
                            <span className="inline-block mt-3 text-sm font-bold text-indigo-600">Comenzar / continuar →</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Experiencias;
