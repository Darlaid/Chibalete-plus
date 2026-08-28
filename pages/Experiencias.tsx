/**
 * Experiencias.tsx — CHP-MOOK-RUNTIME-01 (UX congelada en CHP_MOOK_PRODUCT_UX_01).
 *
 * Runtime del participante: Landing (comprender ANTES de iniciar; no crea run)
 * → Ruta por módulos (estados derivados) → NodeShell del nodo actual →
 * Cierre. Reutiliza visores/Leo/preflight existentes — MOOK jamás concede
 * acceso. La pestaña Revisión permanece aquí de forma técnica hasta que
 * REVIEW-01 la reubique en Aula Viva.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { useAccessCheck } from '../hooks/useAccessCheck';
import { BookOpen, MessageCircle, ListChecks, PenLine, CheckCircle2, Lock, Circle, Clock, Users, Download, ChevronLeft, ChevronRight } from 'lucide-react';

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
 * ESTAS-AQUI-02 — utilidades de audio y transcripción.
 *
 * La duración NO se persiste en ninguna parte (ni Experience, ni versión, ni
 * nodo, ni catálogo): se lee del elemento nativo en `loadedmetadata`. Mientras
 * no se conozca, se muestra un estado neutro — jamás una duración inventada.
 */
export const formatAudioDuration = (segundos: number | null | undefined): string | null => {
    if (typeof segundos !== 'number' || !Number.isFinite(segundos) || segundos <= 0) return null;
    const total = Math.round(segundos);
    const min = Math.floor(total / 60);
    const seg = total % 60;
    if (min === 0) return `${seg} s`;
    if (seg === 0) return `${min} min`;
    return `${min} min ${seg} s`;
};

/** Nombre de archivo legible y seguro derivado del título del nodo. */
export const transcriptFilename = (titulo: string): string => {
    const base = String(titulo ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin diacríticos
        .replace(/[^a-zA-Z0-9]+/g, '-')                     // sin separadores de ruta ni espacios
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .toLowerCase();
    return `${base || 'transcripcion'}.txt`;
};

/**
 * Descarga la transcripción TAL CUAL (saltos de línea y marcas de voz
 * incluidos) como .txt UTF-8 generado en el cliente: sin endpoint, sin copia
 * en uploads y sin telemetría. El Object URL se libera tras usarlo.
 */
export const downloadTranscript = (texto: string, titulo: string): void => {
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = transcriptFilename(titulo);
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
};

/**
 * Reproductor del nodo AUDIO/VIDEO — renderer COMPARTIDO por Runtime y preview
 * (ambos montan NodeShell). Controles nativos, cero autoplay, cero playlist:
 * al terminar no se abre nada. La duración sale del elemento; los estados se
 * anuncian por `aria-live` sin repetir ni confundir pausa con final.
 *
 * El acceso lo sigue gobernando el preflight canónico `/api/content/:id/access`:
 * MOOK no concede acceso (ADR §11). Sin permiso no se monta el reproductor y el
 * participante conserva la ruta canónica al visor.
 */
export const NodeMediaPlayer: React.FC<{ node: any; userId?: string }> = ({ node, userId }) => {
    const [duracion, setDuracion] = useState<number | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const ref = useRef<HTMLAudioElement | null>(null);
    const contentId = node.resource?.id;
    const { status } = useAccessCheck(contentId, userId);
    const src = dataService.getContenidoById(contentId)?.url_recurso;

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onMeta = () => setDuracion(el.duration);
        // La pausa solo se anuncia si el participante YA empezó y NO terminó:
        // así la carga inicial, la navegación y el final no dicen «pausa».
        const onPause = () => {
            if (el.ended || el.currentTime <= 0) return;
            setAviso('Puedes continuar después. La pausa también forma parte del recorrido.');
        };
        const onPlay = () => setAviso(null);
        const onEnded = () => setAviso('No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.');
        el.addEventListener('loadedmetadata', onMeta);
        el.addEventListener('pause', onPause);
        el.addEventListener('play', onPlay);
        el.addEventListener('ended', onEnded);
        if (el.readyState >= 1) setDuracion(el.duration); // metadata ya disponible
        return () => {
            // Desmontaje: se retiran los listeners ANTES de que el navegador
            // pause el elemento, para no anunciar una pausa fantasma.
            el.removeEventListener('loadedmetadata', onMeta);
            el.removeEventListener('pause', onPause);
            el.removeEventListener('play', onPlay);
            el.removeEventListener('ended', onEnded);
        };
    }, [src, status]);

    if (!src || status !== 'allowed') return null;
    const legible = formatAudioDuration(duracion);

    return (
        <div className="my-3 rounded-xl bg-gray-50 dark:bg-gray-900 p-3">
            <audio
                ref={ref}
                src={src}
                controls
                preload="metadata"
                className="w-full max-w-full"
                aria-label={`Audio: ${node.title}`}
            />
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
                {legible
                    ? `Este audio dura ${legible}. Si puedes, escucha una sola pieza a la vez.`
                    : 'Preparando la duración… Si puedes, escucha una sola pieza a la vez.'}
            </p>
            <p role="status" aria-live="polite" className="text-xs text-indigo-700 dark:text-indigo-300 mt-1 min-h-[1rem]">
                {aviso}
            </p>
        </div>
    );
};

/**
 * ESTAS-AQUI-01 — bitácora privada YA GUARDADA, releíble solo por su autor.
 * El texto llega en `e.answers`, que el backend proyecta ÚNICAMENTE al dueño
 * del run. Sin acciones de compartir: no existen en este MVP.
 */
export const PrivateJournalEntry: React.FC<{ e: any; node: any }> = ({ e, node }) => {
    const preguntas = (node?.config?.preguntas ?? []).map((p: any) => p?.texto);
    return (
        <div className="space-y-2">
            <p className="text-emerald-700 font-medium">Guardada para ti.</p>
            <p className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
                <Lock size={12} aria-hidden /> Privada. Solo tú puedes leerla.
            </p>
            <details className="rounded-lg bg-white dark:bg-gray-800 p-2">
                <summary className="text-sm font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer">Leer lo que escribí</summary>
                <dl className="mt-2 space-y-2">
                    {(e.answers ?? []).map((a: string, i: number) => (
                        <div key={i}>
                            {preguntas[i] && <dt className="text-xs text-gray-500 dark:text-gray-400">{preguntas[i]}</dt>}
                            <dd className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line">{a}</dd>
                        </div>
                    ))}
                </dl>
            </details>
        </div>
    );
};

/**
 * NodeShell — nodo actual/expandido: contexto, instrucción, contenido, acción.
 * `preview` (STUDIO-01, C11): mismo renderer sin efectos — completar/enviar
 * NO llaman a la API (cero runs, cero evidencia, cero eventos).
 */
export const NodeShell: React.FC<{ node: any; moduleTitle: string; experienceTitle: string; route: any; refresh: () => void; preview?: boolean; onUnsaved?: (h: { save: () => Promise<void> } | null) => void; userId?: string; nav?: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void }; revisiting?: boolean }> = ({ node, moduleTitle, experienceTitle, route, refresh, preview = false, onUnsaved, userId, nav, revisiting = false }) => {
    const [answers, setAnswers] = useState<string[]>([]);
    const [text, setText] = useState('');
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const myEvidence = (route.evidence || []).filter((e: any) => e.nodeId === node.id);

    // ESTAS-AQUI-01 — bitácora privada: el backend es la autoridad
    // (`config.privado` viaja en la versión congelada); aquí solo se ajusta el
    // lenguaje y se protege el texto sin guardar, que no se recupera.
    const privado = node.type === 'ACTIVITY' && node.config?.privado === true;
    const sinGuardar = privado && answers.some((a) => (a ?? '').trim().length > 0);

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
        else if (privado) setAnswers([]); // guardada: el borrador local deja de estar «sin guardar»
        setBusy(false); refresh();
    };

    // Guardado de la bitácora accesible desde el aviso de salida, sin recrear
    // la función en cada render (evita re-suscribir al padre en bucle).
    const answersRef = useRef(answers);
    answersRef.current = answers;
    const saveRef = useRef(async () => { await send({ answers: answersRef.current }); });
    saveRef.current = async () => { await send({ answers: answersRef.current }); };

    useEffect(() => {
        if (!onUnsaved || preview) return;
        onUnsaved(sinGuardar ? { save: () => saveRef.current() } : null);
        return () => onUnsaved(null);
    }, [sinGuardar, onUnsaved, preview]);

    // Cierre de pestaña o recarga con texto privado sin guardar.
    useEffect(() => {
        if (!sinGuardar || preview) return;
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [sinGuardar, preview]);

    return (
        <div className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-800 p-5 shadow-md">
            <p className="text-xs text-gray-400 mb-1">{experienceTitle} · {moduleTitle}</p>
            <div className="flex items-center justify-between">
                <h4 className="font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center gap-2">{NODE_ICON[node.type]} {node.title}</h4>
                {revisiting
                    // Revisar no es estar: mientras se mira hacia atrás, la tarjeta
                    // NO puede decir «Estás aquí» — el punto del recorrido no se movió.
                    ? <span className="text-xs font-bold text-gray-500 inline-flex items-center gap-1"><Clock size={12} aria-hidden /> Revisando</span>
                    : <span className="text-xs font-bold text-indigo-600 inline-flex items-center gap-1"><Circle size={12} /> Estás aquí</span>}
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

            {(node.type === 'VIDEO' || node.type === 'AUDIO') && node.resource && (
                <NodeMediaPlayer node={node} userId={userId} />
            )}

            {(node.type === 'VIDEO' || node.type === 'AUDIO') && node.config?.transcripcion && (
                // ADR §17.4: la alternativa textual del medio debe ser accesible desde el nodo.
                // La descarga vive FUERA del <details> para funcionar también con la
                // transcripción contraída, y reutiliza exactamente `config.transcripcion`.
                <div className="my-2 rounded-xl bg-gray-50 dark:bg-gray-900 p-3">
                    <details>
                        <summary className="text-sm font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer">Ver transcripción</summary>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-line">{node.config.transcripcion}</p>
                    </details>
                    <button
                        type="button"
                        onClick={() => downloadTranscript(node.config.transcripcion, node.title)}
                        className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-indigo-700 dark:text-indigo-300 hover:underline"
                    >
                        <Download size={14} aria-hidden /> Descargar transcripción
                    </button>
                </div>
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

            {/* Al revisar, la tarjeta es de SOLO LECTURA. `completeNode` reescribe
                `completedAt` incluso en un nodo ya completado, así que dejar el
                botón visible convertiría «mirar atrás» en una escritura a un clic. */}
            {!revisiting && (node.type === 'READING' || node.type === 'VIDEO' || node.type === 'AUDIO' || node.type === 'LEO') && (
                <button onClick={complete} disabled={busy || (node.resourceRef && !node.resource)} className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
                    {node.type === 'LEO' ? 'Ya conversé — validar' : node.type === 'READING' ? 'Terminé esta lectura' : 'Terminé de verlo/escucharlo'}
                </button>
            )}

            {node.type === 'ACTIVITY' && privado && (
                <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-900 px-2 py-1 text-xs font-bold text-gray-700 dark:text-gray-200">
                    <Lock size={12} aria-hidden /> Privada. Solo tú puedes leerla.
                </p>
            )}

            {!revisiting && node.type === 'ACTIVITY' && (
                <div className="space-y-3 mt-2">
                    {(node.config?.preguntas ?? []).map((p: any, i: number) => (
                        <div key={i}>
                            <label htmlFor={`act-${node.id}-${i}`} className="text-sm font-medium text-gray-700 dark:text-gray-200">{p.texto}</label>
                            <textarea id={`act-${node.id}-${i}`} value={answers[i] ?? ''} onChange={e => setAnswers(a => { const c = [...a]; c[i] = e.target.value; return c; })}
                                rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                    ))}
                    <p id={`act-${node.id}-note`} role="note" className="text-xs text-gray-500 dark:text-gray-400">
                        {privado
                            ? 'Nada se publicará automáticamente. En esta versión la respuesta no se puede editar, eliminar ni compartir.'
                            : 'Si respondes, tu reflexión se guardará como parte de tu recorrido. No se enviará a revisión.'}
                    </p>
                    <button onClick={() => send({ answers })} disabled={busy} aria-describedby={`act-${node.id}-note`} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
                        {privado ? 'Guardar para mí' : 'Enviar respuestas'}
                    </button>
                </div>
            )}

            {!revisiting && node.type === 'PRODUCTION' && (
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
                        : e.privado
                            ? <PrivateJournalEntry e={e} node={node} />
                            : <span className="text-emerald-700">Respuestas enviadas.</span>}
                </div>
            ))}
            {msg && <p className="mt-2 text-sm text-red-600" role="alert">{msg}</p>}

            {/* CHP-MOOK-RUNTIME-REVISIT-NAV-01 — revisar lo ya alcanzado.
                Va en su propia fila para NO competir con la acción de
                finalización, que conserva su jerarquía primaria. Estilo
                secundario, y `disabled` real en los bordes del recorrido. */}
            {nav && (
                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={nav.onBack} disabled={!nav.canBack}
                        aria-label="Ver el paso anterior"
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        <ChevronLeft size={16} aria-hidden /> Atrás
                    </button>
                    <button type="button" onClick={nav.onForward} disabled={!nav.canForward}
                        aria-label="Volver al paso siguiente ya alcanzado"
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        Adelantar <ChevronRight size={16} aria-hidden />
                    </button>
                </div>
            )}
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

/**
 * Fila compacta de nodo (no actual). Si el nodo es una BITÁCORA PRIVADA ya
 * guardada, el dueño puede releerla aquí: la relectura debe seguir disponible
 * después de completar el paso, no solo mientras es el nodo actual.
 */
export const NodeRow: React.FC<{ node: any; route?: any }> = ({ node, route }) => {
    const bitacoras = (route?.evidence ?? []).filter((e: any) => e.nodeId === node.id && e.privado);
    return (
        <div className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 ${node.state === 'locked' ? 'opacity-55' : ''}`}>
            <div className="flex items-center gap-3">
                {node.state === 'completed' ? <CheckCircle2 size={18} className="text-emerald-600" aria-hidden /> : node.state === 'locked' ? <Lock size={16} className="text-gray-400" aria-hidden /> : <Circle size={16} className="text-gray-400" aria-hidden />}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">{NODE_ICON[node.type]} {node.title}</span>
                <span className="ml-auto text-xs text-gray-500">
                    {node.state === 'completed' ? 'Completado' : node.state === 'locked' ? 'Bloqueado' : node.required ? 'Pendiente' : 'Opcional'}
                </span>
            </div>
            {bitacoras.map((e: any) => (
                <div key={e.id} className="mt-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                    <PrivateJournalEntry e={e} node={node} />
                </div>
            ))}
        </div>
    );
};

const Experiencias: React.FC = () => {
    const { user } = useAuth();
    const { experienceId } = useParams<{ experienceId?: string }>();
    const [list, setList] = useState<any[]>([]);
    const [detail, setDetail] = useState<any | null>(null);
    const [route, setRoute] = useState<any | null>(null);
    const [showRouteAfterClose, setShowRouteAfterClose] = useState(false);
    const currentRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();
    // ESTAS-AQUI-01: bitácora privada con texto sin guardar. El texto no se
    // recupera si se pierde, así que salir de la ruta pide confirmación.
    const [unsaved, setUnsaved] = useState<{ save: () => Promise<void> } | null>(null);
    const [askExit, setAskExit] = useState(false);
    const onUnsaved = useCallback((h: { save: () => Promise<void> } | null) => setUnsaved(h), []);

    // ── CHP-MOOK-RUNTIME-REVISIT-NAV-01 ────────────────────────────────────
    // Dos conceptos distintos, y confundirlos sería el error:
    //   FRONTERA        — el punto del recorrido, lo decide el SERVIDOR
    //                     (`state === 'current'`). Nunca la mueve esta unidad.
    //   ELEMENTO VISIBLE — qué tarjeta está expandida ahora mismo.
    // Revisar hacia atrás cambia SOLO lo segundo. Es estado de pantalla: no se
    // persiste, no toca la URL y al recargar se vuelve al punto canónico.
    const [visibleNodeId, setVisibleNodeId] = useState<string | null>(null);

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
    // La navegación se deriva de lo que YA envía el servidor: `state` por nodo.
    // No se recalcula el desbloqueo en cliente — sería una segunda fuente de
    // verdad, y la autoridad es el backend.
    const flatNodes: any[] = route?.nodes ?? [];
    const frontierIdx = (() => {
        const i = flatNodes.findIndex((n: any) => n.state === 'current');
        if (i !== -1) return i;
        // Run terminado: no hay 'current'. La frontera es el último no bloqueado.
        for (let j = flatNodes.length - 1; j >= 0; j--) if (flatNodes[j].state !== 'locked') return j;
        return -1;
    })();
    const visibleIdx = (() => {
        const i = flatNodes.findIndex((n: any) => n.id === visibleNodeId);
        return i === -1 ? frontierIdx : i;
    })();
    const visibleId: string | null = flatNodes[visibleIdx]?.id ?? null;
    // Solo se navega entre nodos NO bloqueados y nunca más allá de la frontera.
    const prevIdx = (() => { for (let j = visibleIdx - 1; j >= 0; j--) if (flatNodes[j].state !== 'locked') return j; return -1; })();
    const nextIdx = (() => { for (let j = visibleIdx + 1; j <= frontierIdx; j++) if (flatNodes[j].state !== 'locked') return j; return -1; })();

    // Cuando el recorrido avanza de verdad, la revisión se descarta y se vuelve
    // al punto canónico. Es el mismo disparador que ya usaba el scroll.
    useEffect(() => { setVisibleNodeId(null); }, [route?.progress?.completedRequired, route?.runId]);
    useEffect(() => { currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [route?.progress?.completedRequired, visibleNodeId]);

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
            {unsaved
                ? <button type="button" onClick={() => setAskExit(true)} className="text-sm text-indigo-600 mb-4 hover:underline inline-block">← Biblioteca</button>
                : <Link to="/biblioteca" className="text-sm text-indigo-600 mb-4 hover:underline inline-block">← Biblioteca</Link>}

            {askExit && (
                <div role="alertdialog" aria-modal="true" aria-labelledby="salir-sin-guardar-titulo"
                    className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4">
                    <p id="salir-sin-guardar-titulo" className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        Tu respuesta todavía no está guardada. ¿Quieres conservarla o salir sin guardar?
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <button type="button" autoFocus
                            onClick={async () => { await unsaved?.save(); setAskExit(false); }}
                            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Conservar solo para mí</button>
                        <button type="button"
                            onClick={() => { setAskExit(false); setUnsaved(null); navigate('/biblioteca'); }}
                            className="px-4 py-2 rounded-xl border border-amber-400 text-amber-900 dark:text-amber-200 text-sm font-bold">Salir sin guardar</button>
                    </div>
                </div>
            )}

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
                                    {m.nodes.map((n: any) => n.id === visibleId
                                        ? <div key={n.id} ref={currentRef}><NodeShell node={n} moduleTitle={m.title} experienceTitle={detail?.title ?? 'Experiencia'} route={route} refresh={refresh} onUnsaved={onUnsaved} userId={user?.id}
                                            nav={{
                                                canBack: prevIdx !== -1,
                                                canForward: nextIdx !== -1,
                                                onBack: () => { if (prevIdx !== -1) setVisibleNodeId(flatNodes[prevIdx].id); },
                                                onForward: () => { if (nextIdx !== -1) setVisibleNodeId(flatNodes[nextIdx].id); },
                                            }} revisiting={visibleIdx !== frontierIdx} /></div>
                                        : <NodeRow key={n.id} node={n} route={route} />)}
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
