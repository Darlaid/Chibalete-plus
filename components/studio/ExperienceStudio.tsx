/**
 * ExperienceStudio.tsx — CHP-MOOK-STUDIO-01.
 *
 * Studio de Experiencias DENTRO de Subir (UX congelada: CHP_MOOK_PRODUCT_UX_01
 * §C1–C13; contrato: docs/adr/CHP_ADR_MOOK.md §17). Consume exclusivamente las
 * rutas admin existentes + las lecturas de autoría de esta unidad. Reutiliza el
 * Runtime real (NodeShell/NodeRow) para la vista previa — sin segundo renderer,
 * sin runs, sin eventos, sin evidencia.
 *
 * Lifecycle habilitado hoy (colapso MVP declarado en ADR §17.3):
 * DRAFT → PUBLISHED → nueva versión DRAFT · DRAFT/PUBLISHED → ARCHIVED.
 */
import React, { useEffect, useRef, useState } from 'react';
import { dataService } from '../../services/dataService';
import {
    NodeShell, NodeRow, ProgressBar, NODE_ICON, NODE_TYPE_LABEL, MODULE_STATE_LABEL,
} from '../../pages/Experiencias';
import type { Content } from '../../types';
import {
    Plus, Pencil, Trash, ArrowUp, ArrowDown, Eye, Search, X, CheckCircle2, Archive, AlertTriangle, BookOpen,
} from 'lucide-react';

const NODE_TYPES = ['READING', 'VIDEO', 'AUDIO', 'LEO', 'ACTIVITY', 'PRODUCTION'] as const;
type NodeType = typeof NODE_TYPES[number];

type StudioNode = { id: string; type: NodeType; title: string; required: boolean; resourceRef: string | null; config: any };
type StudioModule = { id: string; title: string; description?: string; nodes: StudioNode[] };

/** Requisito de terminación por tipo (contractual, se muestra al autor). */
const TERMINACION: Record<NodeType, string> = {
    READING: 'El participante marca «Terminé esta lectura» tras abrir el visor.',
    VIDEO: 'El participante marca «Terminé de verlo/escucharlo».',
    AUDIO: 'El participante marca «Terminé de verlo/escucharlo».',
    LEO: 'Se valida en el servidor al alcanzar el mínimo de intercambios con Leo.',
    ACTIVITY: 'Se completa al enviar respuesta a todas las preguntas.',
    PRODUCTION: 'Se completa al enviar el texto dentro del rango de palabras; pasa a revisión humana.',
};

const ESTADO_EXP: Record<string, { text: string; cls: string }> = {
    draft: { text: 'Borrador', cls: 'bg-amber-100 text-amber-800' },
    published: { text: 'Publicada', cls: 'bg-emerald-100 text-emerald-700' },
    archived: { text: 'Archivada', cls: 'bg-gray-200 text-gray-600' },
};

const rid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const slugify = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'experiencia';
const deepCopy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const swap = <T,>(arr: T[], i: number, j: number): T[] => { const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; };

function defaultNode(type: NodeType): StudioNode {
    const base = { id: rid('node'), type, title: '', required: true, resourceRef: null as string | null, config: {} as any };
    if (type === 'LEO') base.config = { objetivo: '', semilla: '', minIntercambios: 3 };
    if (type === 'ACTIVITY') base.config = { instruccion: '', preguntas: [{ texto: '', tipo: 'text_short' }] };
    if (type === 'PRODUCTION') base.config = { consigna: '', criterioRevision: '', minPalabras: 150, maxPalabras: 300 };
    return base;
}

// ── Selector de contenido (C7) — catálogo canónico único, solo referencia ───
const ContentPicker: React.FC<{
    currentId: string | null;
    onSelect: (c: Content) => void;
    onClose: () => void;
    onCreateContent?: () => void;
}> = ({ currentId, onSelect, onClose, onCreateContent }) => {
    const [catalog, setCatalog] = useState<Content[]>([]);
    const [query, setQuery] = useState('');
    const [tipo, setTipo] = useState('');
    const [loading, setLoading] = useState(true);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const prevFocus = useRef<Element | null>(null);

    useEffect(() => {
        prevFocus.current = document.activeElement;
        // getContenidos es síncrono (catálogo canónico ya cacheado por dataService).
        // Muestra autónomo Y no-autónomo (C7); los más recientes arriba.
        setCatalog([...dataService.getContenidos(['administrador'])].reverse());
        setLoading(false);
        searchRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            (prevFocus.current as HTMLElement | null)?.focus?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const tipos = [...new Set(catalog.map(c => c.tipo))];
    const shown = catalog.filter(c =>
        (!tipo || c.tipo === tipo) &&
        (!query || (c.titulo ?? '').toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 60);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Seleccionar contenido del catálogo">
            <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Bandeja de recursos — catálogo canónico</h3>
                    <button type="button" onClick={onClose} aria-label="Cerrar selector" className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
                </div>
                <div className="p-4 flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
                        <label htmlFor="studio-picker-search" className="sr-only">Buscar por título</label>
                        <input id="studio-picker-search" ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Buscar por título…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                    </div>
                    <label htmlFor="studio-picker-tipo" className="sr-only">Filtrar por tipo</label>
                    <select id="studio-picker-tipo" value={tipo} onChange={e => setTipo(e.target.value)}
                        className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm">
                        <option value="">Todos los tipos</option>
                        {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="overflow-y-auto px-4 pb-2 flex-1">
                    {loading && <p className="text-sm text-gray-500 p-2">Cargando catálogo…</p>}
                    {!loading && shown.length === 0 && <p className="text-sm text-gray-500 p-2">Sin resultados en el catálogo.</p>}
                    <ul className="space-y-2">
                        {shown.map(c => (
                            <li key={c.id}>
                                <button type="button" onClick={() => onSelect(c)}
                                    className={`w-full text-left flex items-center gap-3 rounded-lg border p-3 hover:border-indigo-400 transition-colors ${currentId === c.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                                    {c.portada_url ? <img src={c.portada_url} alt="" className="w-8 h-11 object-cover rounded" /> : <BookOpen size={18} className="text-gray-400" aria-hidden />}
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{c.titulo}</span>
                                        <span className="block text-xs text-gray-500">{c.tipo} · {c.autor}</span>
                                    </span>
                                    {c.standalone === false && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full shrink-0">Para Experiencias</span>}
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${c.status === 'disponible' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                                        {c.status === 'disponible' ? 'Listo' : 'No disponible aún'}
                                    </span>
                                    {currentId === c.id && <CheckCircle2 size={16} className="text-indigo-600 shrink-0" aria-hidden />}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                {onCreateContent && (
                    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                        <button type="button" onClick={onCreateContent} className="text-sm font-bold text-indigo-600 hover:underline">
                            + Crear contenido (abre el flujo de Subir; tu borrador de Experiencia se conserva)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Editor de un nodo (C10) ─────────────────────────────────────────────────
const NodeEditor: React.FC<{
    node: StudioNode;
    errors: Record<string, string>;
    errKey: string;
    catalogById: Map<string, Content>;
    onChange: (n: StudioNode) => void;
    onOpenPicker: () => void;
}> = ({ node, errors, errKey, catalogById, onChange, onOpenPicker }) => {
    const set = (patch: Partial<StudioNode>) => onChange({ ...node, ...patch });
    const setCfg = (patch: any) => onChange({ ...node, config: { ...node.config, ...patch } });
    const res = node.resourceRef ? catalogById.get(node.resourceRef) : null;
    const err = (k: string) => errors[`${errKey}.${k}`];
    const field = (k: string) => err(k) ? { 'aria-invalid': true as const, 'aria-describedby': `${errKey}-${k}-err` } : {};
    const ErrMsg: React.FC<{ k: string }> = ({ k }) => err(k)
        ? <p id={`${errKey}-${k}-err`} className="text-xs text-red-600 mt-1" role="alert">{err(k)}</p>
        : null;

    const needsResource = node.type === 'READING' || node.type === 'VIDEO' || node.type === 'AUDIO';

    return (
        <div className="rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-4 space-y-3">
            <div>
                <label htmlFor={`${errKey}-title`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Título del paso</label>
                <input id={`${errKey}-title`} value={node.title} onChange={e => set({ title: e.target.value })} {...field('title')}
                    className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                <ErrMsg k="title" />
            </div>

            {(needsResource || node.type === 'LEO') && (
                <div>
                    <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                        {needsResource ? 'Contenido canónico (referencia)' : 'Lectura asociada (opcional)'}
                    </span>
                    <div className="flex items-center gap-3 mt-1">
                        {res
                            ? <span className="text-sm text-gray-700 dark:text-gray-200 inline-flex items-center gap-2">
                                {res.portada_url && <img src={res.portada_url} alt="" className="w-6 h-8 object-cover rounded" />}
                                {res.titulo} <span className="text-gray-400">· {res.tipo}</span>
                                {res.standalone === false && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Para Experiencias</span>}
                            </span>
                            : node.resourceRef
                                ? <span className="text-sm text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={14} aria-hidden /> Referencia {node.resourceRef} (no está en el catálogo local)</span>
                                : <span className="text-sm text-gray-400">Sin contenido seleccionado</span>}
                        <button type="button" onClick={onOpenPicker} className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-indigo-300 text-indigo-700 dark:text-indigo-300 text-sm font-bold">
                            {node.resourceRef ? 'Cambiar' : 'Seleccionar'}
                        </button>
                        {node.resourceRef && !needsResource && (
                            <button type="button" onClick={() => set({ resourceRef: null })} className="text-sm text-gray-500 hover:underline">Quitar</button>
                        )}
                    </div>
                    <ErrMsg k="resourceRef" />
                    {res && res.status !== 'disponible' && (
                        <p className="text-xs text-amber-700 mt-1">Este contenido aún no está disponible (estado: {res.status}). El nodo mostrará candado hasta que lo esté.</p>
                    )}
                </div>
            )}

            {(node.type === 'VIDEO' || node.type === 'AUDIO') && (
                <div>
                    <label htmlFor={`${errKey}-transcripcion`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Transcripción / alternativa textual</label>
                    <textarea id={`${errKey}-transcripcion`} value={node.config.transcripcion ?? ''} onChange={e => setCfg({ transcripcion: e.target.value })}
                        rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm"
                        placeholder="Texto alternativo accesible del medio…" />
                    {!(node.config.transcripcion ?? '').trim() && (
                        <p className="text-xs text-amber-700 mt-1">Pendiente — el contrato exige transcripción para aprobar la publicación del piloto.</p>
                    )}
                </div>
            )}

            {node.type !== 'LEO' && node.type !== 'ACTIVITY' && node.type !== 'PRODUCTION' && (
                <div>
                    <label htmlFor={`${errKey}-instruccion`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Instrucciones (opcional)</label>
                    <textarea id={`${errKey}-instruccion`} value={node.config.instruccion ?? ''} onChange={e => setCfg({ instruccion: e.target.value })}
                        rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                </div>
            )}

            {node.type === 'LEO' && (
                <>
                    <div>
                        <label htmlFor={`${errKey}-objetivo`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Objetivo conversacional</label>
                        <input id={`${errKey}-objetivo`} value={node.config.objetivo ?? ''} onChange={e => setCfg({ objetivo: e.target.value })} {...field('objetivo')}
                            className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        <ErrMsg k="objetivo" />
                    </div>
                    <div>
                        <label htmlFor={`${errKey}-semilla`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Semilla / pregunta inicial</label>
                        <input id={`${errKey}-semilla`} value={node.config.semilla ?? ''} onChange={e => setCfg({ semilla: e.target.value })} {...field('semilla')}
                            className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        <ErrMsg k="semilla" />
                    </div>
                    <div>
                        <label htmlFor={`${errKey}-min`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Mínimo de intercambios</label>
                        <input id={`${errKey}-min`} type="number" min={1} max={20} value={node.config.minIntercambios ?? 3}
                            onChange={e => setCfg({ minIntercambios: Math.max(1, Number(e.target.value) || 3) })}
                            className="w-24 mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                    </div>
                    <p className="text-xs text-gray-500 rounded-lg bg-white dark:bg-gray-900 p-2 border border-gray-200 dark:border-gray-700">
                        <b>Aviso de IA (se muestra al participante):</b> Leo es un asistente de inteligencia artificial; conversa con una IA, no con una persona.
                        Leo conoce solo este nodo, no califica ni evalúa, y toda producción la revisa un mediador humano (escalamiento humano garantizado por contrato).
                    </p>
                </>
            )}

            {node.type === 'ACTIVITY' && (
                <>
                    <div>
                        <label htmlFor={`${errKey}-consigna-act`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Consigna</label>
                        <textarea id={`${errKey}-consigna-act`} value={node.config.instruccion ?? ''} onChange={e => setCfg({ instruccion: e.target.value })}
                            rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                    </div>
                    <fieldset>
                        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-200">Preguntas (respuesta corta)</legend>
                        <ErrMsg k="preguntas" />
                        <div className="space-y-2 mt-1">
                            {(node.config.preguntas ?? []).map((p: any, i: number) => (
                                <div key={i} className="flex gap-2 items-start">
                                    <label htmlFor={`${errKey}-preg-${i}`} className="sr-only">Pregunta {i + 1}</label>
                                    <input id={`${errKey}-preg-${i}`} value={p.texto ?? ''} placeholder={`Pregunta ${i + 1}`}
                                        onChange={e => {
                                            const preguntas = [...node.config.preguntas];
                                            preguntas[i] = { ...preguntas[i], texto: e.target.value, tipo: 'text_short' };
                                            setCfg({ preguntas });
                                        }}
                                        className="flex-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                                    <button type="button" aria-label={`Eliminar pregunta ${i + 1}`} disabled={(node.config.preguntas ?? []).length <= 1}
                                        onClick={() => setCfg({ preguntas: node.config.preguntas.filter((_: any, j: number) => j !== i) })}
                                        className="p-2 text-red-500 disabled:opacity-30"><Trash size={14} /></button>
                                </div>
                            ))}
                            <button type="button" onClick={() => setCfg({ preguntas: [...(node.config.preguntas ?? []), { texto: '', tipo: 'text_short' }] })}
                                className="text-sm font-bold text-indigo-600 hover:underline">+ Añadir pregunta</button>
                        </div>
                    </fieldset>
                </>
            )}

            {node.type === 'PRODUCTION' && (
                <>
                    <div>
                        <label htmlFor={`${errKey}-consigna`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Consigna</label>
                        <textarea id={`${errKey}-consigna`} value={node.config.consigna ?? ''} onChange={e => setCfg({ consigna: e.target.value })} {...field('consigna')}
                            rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        <ErrMsg k="consigna" />
                    </div>
                    <div>
                        <label htmlFor={`${errKey}-criterio`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Criterio de revisión (visible para el participante y su mediador)</label>
                        <textarea id={`${errKey}-criterio`} value={node.config.criterioRevision ?? ''} onChange={e => setCfg({ criterioRevision: e.target.value })}
                            rows={2} className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                    </div>
                    <div className="flex gap-4">
                        <div>
                            <label htmlFor={`${errKey}-minp`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Mín. palabras</label>
                            <input id={`${errKey}-minp`} type="number" min={1} value={node.config.minPalabras ?? 150} {...field('palabras')}
                                onChange={e => setCfg({ minPalabras: Number(e.target.value) || 0 })}
                                className="w-24 mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                        <div>
                            <label htmlFor={`${errKey}-maxp`} className="block text-sm font-medium text-gray-700 dark:text-gray-200">Máx. palabras</label>
                            <input id={`${errKey}-maxp`} type="number" min={1} value={node.config.maxPalabras ?? 300}
                                onChange={e => setCfg({ maxPalabras: Number(e.target.value) || 0 })}
                                className="w-24 mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                    </div>
                    <ErrMsg k="palabras" />
                    <p className="text-xs text-gray-500">Tipo de evidencia: <b>texto</b> (único soportado en el MVP). La producción siempre pasa por revisión humana.</p>
                </>
            )}

            <div className="flex items-center gap-2">
                <input type="checkbox" id={`${errKey}-req`} checked={node.required} onChange={e => set({ required: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" />
                <label htmlFor={`${errKey}-req`} className="text-sm text-gray-700 dark:text-gray-300">Paso requerido (cuenta para el progreso; desmarcado = opcional)</label>
            </div>
            <p className="text-xs text-gray-500"><b>Terminación:</b> {TERMINACION[node.type]}</p>
        </div>
    );
};

// ── Vista previa (C11): Runtime real, run virtual, cero efectos ─────────────
function buildPreviewRoute(modules: StudioModule[], catalogById: Map<string, Content>, currentNodeId: string | null) {
    let currentAssigned = false;
    let blocked = false;
    const flatIds = modules.flatMap(m => m.nodes.map(n => n.id));
    const wantedCurrent = currentNodeId && flatIds.includes(currentNodeId) ? currentNodeId : flatIds[0] ?? null;
    const projected = modules.map(m => ({
        id: m.id, title: m.title, state: 'NOT_STARTED',
        nodes: m.nodes.map(n => {
            let state: string;
            if (n.id === wantedCurrent) { state = 'current'; currentAssigned = true; }
            else state = blocked ? 'locked' : 'available';
            if (n.required) blocked = true;
            const c = n.resourceRef ? catalogById.get(n.resourceRef) : null;
            return {
                ...n,
                state,
                resource: c && c.status === 'disponible'
                    ? { id: c.id, titulo: c.titulo, autor: c.autor, tipo: c.tipo, portada_url: c.portada_url }
                    : null,
                evidenceIds: [],
            };
        }),
    }));
    void currentAssigned;
    const totalRequired = modules.flatMap(m => m.nodes).filter(n => n.required).length;
    return {
        runId: 'preview', experienceId: 'preview', status: 'active',
        progress: { completedRequired: 0, totalRequired, completed: false },
        modules: projected, nodes: projected.flatMap(m => m.nodes), evidence: [],
    };
}

// ── Studio ──────────────────────────────────────────────────────────────────
export const ExperienceStudio: React.FC<{ onCreateContent?: () => void }> = ({ onCreateContent }) => {
    const [view, setView] = useState<'list' | 'editor'>('list');
    const [list, setList] = useState<any[]>([]);
    const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
    const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

    // Editor
    const [experienceId, setExperienceId] = useState<string | null>(null);
    const [expStatus, setExpStatus] = useState<'draft' | 'published' | 'archived'>('draft');
    const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
    const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
    const [draftVersionNum, setDraftVersionNum] = useState<number | null>(null);
    const [info, setInfo] = useState({ title: '', description: '', imageUrl: '', durationLabel: '', audience: '' });
    const [objetivo, setObjetivo] = useState('');
    const [modules, setModules] = useState<StudioModule[]>([]);
    const [readOnlyRoute, setReadOnlyRoute] = useState(false);
    const [tab, setTab] = useState<'info' | 'ruta' | 'preview' | 'publicacion'>('info');
    const [dirty, setDirty] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [saveError, setSaveError] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [editingNode, setEditingNode] = useState<{ mi: number; ni: number } | null>(null);
    const [picker, setPicker] = useState<{ mi: number; ni: number } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // key `mod.{mi}` | `node.{mi}.{ni}`
    const [confirmExit, setConfirmExit] = useState(false);
    const [confirmPublish, setConfirmPublish] = useState(false);
    const [catalogById, setCatalogById] = useState<Map<string, Content>>(new Map());
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);

    const markDirty = () => { setDirty(true); setSaveState('idle'); };

    const loadList = async () => {
        setListState('loading');
        const r = await dataService.getStudioExperiences();
        if (r.ok) { setList(r.data ?? []); setListState('ready'); }
        else setListState(r.error?.includes('administrador') ? 'forbidden' : 'error');
    };
    useEffect(() => { loadList(); }, []);
    useEffect(() => {
        const cs = dataService.getContenidos(['administrador']);
        setCatalogById(new Map(cs.map(c => [c.id, c])));
    }, [view]);

    // Prevención de pérdida (patrón mínimo existente: aviso al salir con cambios sin guardar).
    useEffect(() => {
        const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [dirty]);

    const resetEditor = () => {
        setExperienceId(null); setExpStatus('draft'); setDraftVersionId(null); setPublishedVersion(null); setDraftVersionNum(null);
        setInfo({ title: '', description: '', imageUrl: '', durationLabel: '', audience: '' });
        setObjetivo(''); setModules([]); setReadOnlyRoute(false); setDirty(false); setErrors({});
        setSaveState('idle'); setSaveError(null); setEditingNode(null); setConfirmDelete(null); setConfirmExit(false); setConfirmPublish(false);
        setPreviewNodeId(null);
    };

    const openNew = () => { resetEditor(); setTab('info'); setView('editor'); };

    const openExisting = async (id: string, initialTab: 'info' | 'ruta' | 'preview' | 'publicacion' = 'info') => {
        resetEditor();
        const r = await dataService.getStudioExperienceDetail(id);
        if (!r.ok) { setSaveError(r.error ?? 'No se pudo abrir'); return; }
        const d = r.data;
        setExperienceId(d.id); setExpStatus(d.status);
        setInfo({
            title: d.title ?? '', description: d.description ?? '', imageUrl: d.imageUrl ?? '',
            durationLabel: d.durationLabel ?? '', audience: d.audience ?? '',
        });
        const versions = d.versions ?? [];
        const lastDraft = [...versions].reverse().find((v: any) => v.status === 'draft') ?? null;
        const current = versions.find((v: any) => v.id === d.currentVersionId) ?? [...versions].reverse().find((v: any) => v.status === 'published') ?? null;
        const working = lastDraft ?? current;
        setDraftVersionId(lastDraft?.id ?? null);
        setDraftVersionNum(lastDraft?.version ?? null);
        setPublishedVersion(current?.version ?? null);
        setObjetivo(working?.objectives?.[0] ?? '');
        setModules(working ? deepCopy(working.modules ?? []) : []);
        setReadOnlyRoute(!lastDraft && !!current);
        setTab(initialTab); setView('editor');
    };

    // ── Validación (2): clara, por campo, asociada ──
    const validate = (): Record<string, string> => {
        const e: Record<string, string> = {};
        if (!info.title.trim()) e['info.title'] = 'El título es obligatorio.';
        modules.forEach((m, mi) => {
            if (!m.title.trim()) e[`mod.${mi}.title`] = 'El módulo necesita un título.';
            if (m.nodes.length === 0) e[`mod.${mi}.nodes`] = 'El módulo necesita al menos un paso.';
            m.nodes.forEach((n, ni) => {
                const k = `node.${mi}.${ni}`;
                if (!n.title.trim()) e[`${k}.title`] = 'El paso necesita un título.';
                if ((n.type === 'READING' || n.type === 'VIDEO' || n.type === 'AUDIO') && !n.resourceRef) e[`${k}.resourceRef`] = 'Selecciona el contenido canónico.';
                if (n.type === 'LEO') {
                    if (!(n.config.objetivo ?? '').trim()) e[`${k}.objetivo`] = 'Define el objetivo conversacional.';
                    if (!(n.config.semilla ?? '').trim()) e[`${k}.semilla`] = 'Define la pregunta inicial (semilla).';
                }
                if (n.type === 'ACTIVITY' && !(n.config.preguntas ?? []).some((p: any) => (p.texto ?? '').trim())) e[`${k}.preguntas`] = 'Añade al menos una pregunta con texto.';
                if (n.type === 'PRODUCTION') {
                    if (!(n.config.consigna ?? '').trim()) e[`${k}.consigna`] = 'La producción necesita consigna.';
                    if ((n.config.minPalabras ?? 0) >= (n.config.maxPalabras ?? 0)) e[`${k}.palabras`] = 'El mínimo de palabras debe ser menor que el máximo.';
                }
            });
        });
        return e;
    };

    const cleanModules = () => modules.map(m => ({
        id: m.id, title: m.title.trim(), ...(m.description ? { description: m.description } : {}),
        nodes: m.nodes.map(n => ({
            id: n.id, type: n.type, title: n.title.trim(), required: n.required,
            ...(n.resourceRef ? { resourceRef: n.resourceRef } : {}),
            config: { ...n.config, ...((n.type === 'ACTIVITY') ? { preguntas: (n.config.preguntas ?? []).filter((p: any) => (p.texto ?? '').trim()) } : {}) },
        })),
    }));

    // ── Guardado de borrador (info + ruta) ──
    const save = async (): Promise<boolean> => {
        const errs = validate();
        setErrors(errs);
        if (Object.keys(errs).length > 0) {
            setSaveState('error'); setSaveError('Revisa los campos marcados.');
            if (Object.keys(errs).some(k => k.startsWith('info.'))) setTab('info'); else setTab('ruta');
            return false;
        }
        setSaveState('saving'); setSaveError(null);
        const payloadInfo = {
            title: info.title.trim(), description: info.description,
            imageUrl: info.imageUrl.trim() || null, durationLabel: info.durationLabel.trim() || null, audience: info.audience.trim() || null,
        };
        let expId = experienceId;
        if (!expId) {
            let r = await dataService.createStudioExperience({ slug: slugify(info.title), ...payloadInfo, description: info.description } as any);
            if (!r.ok && (r.data?.code === 'DUPLICATE_SLUG')) {
                r = await dataService.createStudioExperience({ slug: `${slugify(info.title)}-${Date.now().toString(36).slice(-4)}`, ...payloadInfo, description: info.description } as any);
            }
            if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'No se pudo crear'); return false; }
            expId = r.data.id; setExperienceId(expId); setExpStatus(r.data.status);
        } else {
            const r = await dataService.updateStudioExperience(expId, payloadInfo);
            if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'No se pudo guardar la información'); return false; }
        }
        // La ruta se versiona solo cuando existe estructura mínima (el store exige ≥1 módulo con nodos).
        const hasRoute = modules.length > 0 && modules.every(m => m.nodes.length > 0);
        if (hasRoute && !readOnlyRoute) {
            const body = { objectives: objetivo.trim() ? [objetivo.trim()] : [], modules: cleanModules() };
            if (draftVersionId) {
                const r = await dataService.updateStudioDraftVersion(draftVersionId, body);
                if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'No se pudo guardar la ruta'); return false; }
            } else {
                const r = await dataService.createStudioDraftVersion(expId!, body);
                if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'No se pudo crear el borrador de la ruta'); return false; }
                setDraftVersionId(r.data.id); setDraftVersionNum(r.data.version);
            }
        }
        setDirty(false); setSaveState('saved');
        loadList();
        return true;
    };

    const publish = async () => {
        if (!draftVersionId) return;
        setSaveState('saving'); setSaveError(null); setConfirmPublish(false);
        const r = await dataService.publishStudioVersion(draftVersionId);
        if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'No se pudo publicar'); return; }
        setSaveState('saved');
        await openExisting(experienceId!, 'publicacion');
        loadList();
    };

    const newVersionFromPublished = async () => {
        if (!experienceId) return;
        setSaveState('saving'); setSaveError(null);
        const body = { objectives: objetivo.trim() ? [objetivo.trim()] : [], modules: cleanModules() };
        const r = await dataService.createStudioDraftVersion(experienceId, body);
        if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'No se pudo crear la nueva versión'); return; }
        setDraftVersionId(r.data.id); setDraftVersionNum(r.data.version);
        setReadOnlyRoute(false); setSaveState('saved'); setTab('ruta');
        loadList();
    };

    const archive = async (id: string) => {
        setConfirmArchiveId(null);
        const r = await dataService.archiveStudioExperience(id);
        if (!r.ok) { setSaveError(r.error ?? 'No se pudo archivar'); setSaveState('error'); return; }
        if (view === 'editor' && experienceId === id) setExpStatus('archived');
        loadList();
    };

    const exitEditor = () => {
        if (dirty && !confirmExit) { setConfirmExit(true); return; }
        setConfirmExit(false); setView('list'); resetEditor(); loadList();
    };

    // ── Mutaciones locales de la ruta ──
    const setModule = (mi: number, patch: Partial<StudioModule>) => { setModules(ms => ms.map((m, i) => i === mi ? { ...m, ...patch } : m)); markDirty(); };
    const setNode = (mi: number, ni: number, n: StudioNode) => { setModules(ms => ms.map((m, i) => i === mi ? { ...m, nodes: m.nodes.map((x, j) => j === ni ? n : x) } : m)); markDirty(); };
    const addModule = () => { setModules(ms => [...ms, { id: rid('m'), title: `Módulo ${ms.length + 1}`, nodes: [] }]); markDirty(); };
    const addNode = (mi: number, type: NodeType) => {
        setModules(ms => ms.map((m, i) => i === mi ? { ...m, nodes: [...m.nodes, defaultNode(type)] } : m));
        setEditingNode({ mi, ni: modules[mi].nodes.length });
        markDirty();
    };
    const removeModule = (mi: number) => { setModules(ms => ms.filter((_, i) => i !== mi)); setEditingNode(null); setConfirmDelete(null); markDirty(); };
    const removeNode = (mi: number, ni: number) => { setModules(ms => ms.map((m, i) => i === mi ? { ...m, nodes: m.nodes.filter((_, j) => j !== ni) } : m)); setEditingNode(null); setConfirmDelete(null); markDirty(); };
    const moveModule = (mi: number, d: -1 | 1) => { setModules(ms => swap(ms, mi, mi + d)); setEditingNode(null); markDirty(); };
    const moveNode = (mi: number, ni: number, d: -1 | 1) => { setModules(ms => ms.map((m, i) => i === mi ? { ...m, nodes: swap(m.nodes, ni, ni + d) } : m)); setEditingNode(null); markDirty(); };

    const infoErr = (k: string) => errors[`info.${k}`];

    // ════════ LISTADO (C2) ════════
    if (view === 'list') {
        return (
            <div className="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4 mb-6">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">Studio de Experiencias</h2>
                    <button type="button" onClick={openNew} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold inline-flex items-center gap-1">
                        <Plus size={16} aria-hidden /> Nueva Experiencia
                    </button>
                </div>
                {listState === 'loading' && <p className="text-sm text-gray-500">Cargando Experiencias…</p>}
                {listState === 'forbidden' && <p className="text-sm text-amber-700">El Studio requiere una sesión con rol administrador.</p>}
                {listState === 'error' && (
                    <p className="text-sm text-red-600">No se pudo cargar el listado. <button type="button" onClick={loadList} className="font-bold underline">Reintentar</button></p>
                )}
                {listState === 'ready' && list.length === 0 && (
                    <p className="text-sm text-gray-500">Aún no hay Experiencias. Crea la primera con «Nueva Experiencia».</p>
                )}
                {listState === 'ready' && list.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase text-xs">
                                <tr>
                                    <th className="p-3 rounded-tl-lg">Título</th>
                                    <th className="p-3">Estado</th>
                                    <th className="p-3">Versión</th>
                                    <th className="p-3">Última edición</th>
                                    <th className="p-3 rounded-tr-lg text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {list.map(e => (
                                    <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="p-3 font-medium text-gray-900 dark:text-gray-100">{e.title}</td>
                                        <td className="p-3">
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${ESTADO_EXP[e.status]?.cls ?? ''}`}>{ESTADO_EXP[e.status]?.text ?? e.status}</span>
                                            {e.status === 'published' && e.draftVersionId && <span className="ml-2 text-xs text-amber-700">+ borrador v{e.draftVersion}</span>}
                                        </td>
                                        <td className="p-3 text-gray-500">
                                            {e.publishedVersion ? `v${e.publishedVersion} publicada` : e.latestVersion > 0 ? `v${e.latestVersion} en borrador` : 'sin ruta'}
                                        </td>
                                        <td className="p-3 text-gray-500">{e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : '—'}</td>
                                        <td className="p-3 text-right whitespace-nowrap">
                                            {confirmArchiveId === e.id ? (
                                                <span className="inline-flex items-center gap-2 text-xs">
                                                    ¿Archivar «{e.title}»? No borra versiones ni progreso.
                                                    <button type="button" onClick={() => archive(e.id)} className="px-2 py-1 rounded bg-red-600 text-white font-bold">Archivar</button>
                                                    <button type="button" onClick={() => setConfirmArchiveId(null)} className="px-2 py-1 rounded border border-gray-300 font-bold">Cancelar</button>
                                                </span>
                                            ) : (
                                                <>
                                                    <button type="button" onClick={() => openExisting(e.id)} className="mr-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-md font-bold inline-flex items-center">
                                                        <Pencil size={14} className="mr-1" aria-hidden /> Editar
                                                    </button>
                                                    <button type="button" onClick={() => openExisting(e.id, 'preview')} className="mr-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-md font-bold inline-flex items-center">
                                                        <Eye size={14} className="mr-1" aria-hidden /> Previsualizar
                                                    </button>
                                                    {e.status !== 'archived' && (
                                                        <button type="button" onClick={() => setConfirmArchiveId(e.id)} className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-md font-bold inline-flex items-center" aria-label={`Archivar ${e.title}`}>
                                                            <Archive size={14} className="mr-1" aria-hidden /> Archivar
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    }

    // ════════ EDITOR (C3–C12) ════════
    const flatNodes = modules.flatMap(m => m.nodes);
    const previewRoute = buildPreviewRoute(modules, catalogById, previewNodeId);
    const previewIdx = previewRoute.nodes.findIndex((n: any) => n.state === 'current');

    return (
        <div className="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 pb-4 mb-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">{experienceId ? `Editar: ${info.title || 'Experiencia'}` : 'Nueva Experiencia'}</h2>
                    <p className="text-xs text-gray-500 mt-1">
                        <span className={`font-bold px-2 py-0.5 rounded-full ${ESTADO_EXP[expStatus]?.cls ?? ''}`}>{ESTADO_EXP[expStatus]?.text}</span>
                        {publishedVersion && <span className="ml-2">v{publishedVersion} publicada</span>}
                        {draftVersionId && <span className="ml-2 text-amber-700">borrador v{draftVersionNum} en edición</span>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span aria-live="polite" className="text-xs text-gray-500">
                        {saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado ✓' : dirty ? 'Cambios sin guardar' : ''}
                    </span>
                    {expStatus !== 'archived' && (
                        <button type="button" onClick={save} disabled={saveState === 'saving'} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">
                            Guardar borrador
                        </button>
                    )}
                    {confirmExit ? (
                        <span className="inline-flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2 py-1">
                            Hay cambios sin guardar.
                            <button type="button" onClick={exitEditor} className="font-bold text-red-600">Descartar y salir</button>
                            <button type="button" onClick={() => setConfirmExit(false)} className="font-bold">Seguir editando</button>
                        </span>
                    ) : (
                        <button type="button" onClick={exitEditor} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-600 dark:text-gray-300">← Listado</button>
                    )}
                </div>
            </div>

            {saveError && <p className="mb-4 text-sm text-red-600" role="alert">{saveError}</p>}
            {expStatus === 'archived' && <p className="mb-4 text-sm text-gray-600 bg-gray-100 dark:bg-gray-700 rounded-lg p-3">Experiencia archivada: ya no se descubre ni admite ediciones. Los participantes con rutas en curso pueden terminarlas.</p>}

            {/* Tabs C3 */}
            <div role="tablist" aria-label="Secciones del editor" className="flex gap-2 mb-6 flex-wrap">
                {([['info', 'Información'], ['ruta', 'Ruta'], ['preview', 'Vista previa'], ['publicacion', 'Publicación']] as const).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                        className={`px-4 py-2 rounded-full text-sm font-medium ${tab === k ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                        {label}
                    </button>
                ))}
            </div>

            {/* ── C4 Información ── */}
            {tab === 'info' && (
                <div className="space-y-4 max-w-2xl" aria-describedby="st-info-scope-note">
                    <p id="st-info-scope-note" role="note" className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
                        Los cambios de esta sección se aplican inmediatamente a la experiencia, incluida la versión publicada. La ruta, los módulos y los nodos sí pertenecen al borrador de versión.
                    </p>
                    <div>
                        <label htmlFor="st-title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Título *</label>
                        <input id="st-title" value={info.title} onChange={e => { setInfo(s => ({ ...s, title: e.target.value })); markDirty(); }}
                            disabled={expStatus === 'archived'}
                            aria-invalid={!!infoErr('title')} aria-describedby={infoErr('title') ? 'st-title-err' : undefined}
                            className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        {infoErr('title') && <p id="st-title-err" className="text-xs text-red-600 mt-1" role="alert">{infoErr('title')}</p>}
                    </div>
                    <div>
                        <label htmlFor="st-desc" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Descripción</label>
                        <textarea id="st-desc" value={info.description} onChange={e => { setInfo(s => ({ ...s, description: e.target.value })); markDirty(); }}
                            disabled={expStatus === 'archived'} rows={3}
                            className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                    </div>
                    <div>
                        <label htmlFor="st-obj" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Objetivo pedagógico (se guarda con la versión de la ruta)</label>
                        <textarea id="st-obj" value={objetivo} onChange={e => { setObjetivo(e.target.value); markDirty(); }}
                            disabled={expStatus === 'archived' || readOnlyRoute} rows={2}
                            className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        {readOnlyRoute && <p className="text-xs text-gray-500 mt-1">La versión publicada es inmutable — crea una nueva versión para cambiar el objetivo.</p>}
                    </div>
                    <div>
                        <label htmlFor="st-img" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Ilustración (URL de una imagen ya subida)</label>
                        <input id="st-img" value={info.imageUrl} onChange={e => { setInfo(s => ({ ...s, imageUrl: e.target.value })); markDirty(); }}
                            disabled={expStatus === 'archived'} placeholder="/uploads/… o https://…"
                            className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="st-dur" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Duración estimada</label>
                            <input id="st-dur" value={info.durationLabel} onChange={e => { setInfo(s => ({ ...s, durationLabel: e.target.value })); markDirty(); }}
                                disabled={expStatus === 'archived'} placeholder="p. ej. 2–3 sesiones"
                                className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                        <div>
                            <label htmlFor="st-aud" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Audiencia</label>
                            <input id="st-aud" value={info.audience} onChange={e => { setInfo(s => ({ ...s, audience: e.target.value })); markDirty(); }}
                                disabled={expStatus === 'archived'} placeholder="p. ej. Docentes y mediadores"
                                className="w-full mt-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 text-sm" />
                        </div>
                    </div>
                </div>
            )}

            {/* ── C5–C10 Ruta ── */}
            {tab === 'ruta' && (
                <div className="space-y-6">
                    {readOnlyRoute && (
                        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 p-4 text-sm text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-3">
                            <span>Versión v{publishedVersion} publicada — <b>inmutable</b>. Para editar la ruta crea una nueva versión (copia editable).</span>
                            {expStatus !== 'archived' && (
                                <button type="button" onClick={newVersionFromPublished} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold">Crear nueva versión</button>
                            )}
                        </div>
                    )}
                    {modules.length === 0 && <p className="text-sm text-gray-500">La ruta está vacía. Añade el primer módulo.</p>}
                    {modules.map((m, mi) => (
                        <section key={m.id} aria-label={`Módulo ${mi + 1}: ${m.title || 'sin título'}`} className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <label htmlFor={`mod-${mi}-title`} className="sr-only">Título del módulo {mi + 1}</label>
                                <input id={`mod-${mi}-title`} value={m.title} disabled={readOnlyRoute || expStatus === 'archived'}
                                    onChange={e => setModule(mi, { title: e.target.value })}
                                    aria-invalid={!!errors[`mod.${mi}.title`]} aria-describedby={errors[`mod.${mi}.title`] ? `mod-${mi}-title-err` : undefined}
                                    className="flex-1 min-w-40 font-bold text-gray-800 dark:text-gray-100 bg-transparent border-b-2 border-dashed border-gray-300 dark:border-gray-600 focus:border-indigo-500 outline-none p-1 text-sm" placeholder={`Módulo ${mi + 1} — título`} />
                                {!readOnlyRoute && expStatus !== 'archived' && (
                                    <span className="flex items-center gap-1">
                                        <button type="button" aria-label={`Subir módulo ${m.title || mi + 1}`} disabled={mi === 0} onClick={() => moveModule(mi, -1)} className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30"><ArrowUp size={14} /></button>
                                        <button type="button" aria-label={`Bajar módulo ${m.title || mi + 1}`} disabled={mi === modules.length - 1} onClick={() => moveModule(mi, 1)} className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30"><ArrowDown size={14} /></button>
                                        {confirmDelete === `mod.${mi}` ? (
                                            <span className="inline-flex items-center gap-1 text-xs ml-1">
                                                ¿Eliminar módulo y sus pasos?
                                                <button type="button" onClick={() => removeModule(mi)} className="px-2 py-1 rounded bg-red-600 text-white font-bold">Sí</button>
                                                <button type="button" onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded border border-gray-300 font-bold">No</button>
                                            </span>
                                        ) : (
                                            <button type="button" aria-label={`Eliminar módulo ${m.title || mi + 1}`} onClick={() => setConfirmDelete(`mod.${mi}`)} className="p-1.5 rounded border border-gray-300 dark:border-gray-600 text-red-500"><Trash size={14} /></button>
                                        )}
                                    </span>
                                )}
                            </div>
                            {errors[`mod.${mi}.title`] && <p id={`mod-${mi}-title-err`} className="text-xs text-red-600 mb-2" role="alert">{errors[`mod.${mi}.title`]}</p>}
                            {errors[`mod.${mi}.nodes`] && <p className="text-xs text-red-600 mb-2" role="alert">{errors[`mod.${mi}.nodes`]}</p>}

                            <ol className="space-y-2">
                                {m.nodes.map((n, ni) => (
                                    <li key={n.id}>
                                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2">
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 inline-flex items-center gap-2 flex-1 min-w-40">
                                                {NODE_ICON[n.type]} {n.title || <span className="text-gray-400 italic">sin título</span>}
                                                <span className="text-xs text-gray-400">· {NODE_TYPE_LABEL[n.type]}</span>
                                            </span>
                                            <span className="text-xs text-gray-500">{n.required ? 'Requerido' : 'Opcional'}</span>
                                            {!readOnlyRoute && expStatus !== 'archived' && (
                                                <span className="flex items-center gap-1">
                                                    <button type="button" aria-label={`Editar paso ${n.title || ni + 1}`} onClick={() => setEditingNode(editingNode?.mi === mi && editingNode?.ni === ni ? null : { mi, ni })}
                                                        aria-expanded={editingNode?.mi === mi && editingNode?.ni === ni}
                                                        className="p-1.5 rounded border border-gray-300 dark:border-gray-600 text-indigo-600"><Pencil size={14} /></button>
                                                    <button type="button" aria-label={`Subir paso ${n.title || ni + 1}`} disabled={ni === 0} onClick={() => moveNode(mi, ni, -1)} className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30"><ArrowUp size={14} /></button>
                                                    <button type="button" aria-label={`Bajar paso ${n.title || ni + 1}`} disabled={ni === m.nodes.length - 1} onClick={() => moveNode(mi, ni, 1)} className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30"><ArrowDown size={14} /></button>
                                                    {confirmDelete === `node.${mi}.${ni}` ? (
                                                        <span className="inline-flex items-center gap-1 text-xs">
                                                            ¿Eliminar paso?
                                                            <button type="button" onClick={() => removeNode(mi, ni)} className="px-2 py-1 rounded bg-red-600 text-white font-bold">Sí</button>
                                                            <button type="button" onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded border border-gray-300 font-bold">No</button>
                                                        </span>
                                                    ) : (
                                                        <button type="button" aria-label={`Eliminar paso ${n.title || ni + 1}`} onClick={() => setConfirmDelete(`node.${mi}.${ni}`)} className="p-1.5 rounded border border-gray-300 dark:border-gray-600 text-red-500"><Trash size={14} /></button>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                        {editingNode?.mi === mi && editingNode?.ni === ni && !readOnlyRoute && expStatus !== 'archived' && (
                                            <div className="mt-2">
                                                <NodeEditor node={n} errors={errors} errKey={`node.${mi}.${ni}`} catalogById={catalogById}
                                                    onChange={x => setNode(mi, ni, x)} onOpenPicker={() => setPicker({ mi, ni })} />
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ol>

                            {!readOnlyRoute && expStatus !== 'archived' && (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-gray-500">+ Añadir paso:</span>
                                    {NODE_TYPES.map(t => (
                                        <button key={t} type="button" onClick={() => addNode(mi, t)}
                                            className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-bold text-gray-600 dark:text-gray-300 inline-flex items-center gap-1 hover:border-indigo-400">
                                            {NODE_ICON[t]} {NODE_TYPE_LABEL[t]}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                    {!readOnlyRoute && expStatus !== 'archived' && (
                        <button type="button" onClick={addModule} className="px-4 py-2 rounded-xl border-2 border-dashed border-indigo-300 text-indigo-600 text-sm font-bold inline-flex items-center gap-1">
                            <Plus size={16} aria-hidden /> Añadir módulo
                        </button>
                    )}
                    <p className="text-xs text-gray-400">Plantilla sugerida por el contrato: Leer → Conversar → Producir (una guía de autoría, no un requisito técnico).</p>
                </div>
            )}

            {/* ── C11 Vista previa ── */}
            {tab === 'preview' && (
                <div>
                    <div role="status" className="sticky top-0 z-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-sm font-bold px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
                        <span>▲ Vista previa — nada de lo que hagas aquí se guarda.</span>
                        {flatNodes.length > 1 && (
                            <span className="inline-flex items-center gap-2 font-normal">
                                Paso:
                                <button type="button" disabled={previewIdx <= 0}
                                    onClick={() => setPreviewNodeId(previewRoute.nodes[previewIdx - 1]?.id ?? null)}
                                    className="px-2 py-1 rounded border border-amber-400 disabled:opacity-30" aria-label="Paso anterior de la vista previa">◄</button>
                                <span>{previewIdx + 1}/{flatNodes.length}</span>
                                <button type="button" disabled={previewIdx >= flatNodes.length - 1}
                                    onClick={() => setPreviewNodeId(previewRoute.nodes[previewIdx + 1]?.id ?? null)}
                                    className="px-2 py-1 rounded border border-amber-400 disabled:opacity-30" aria-label="Paso siguiente de la vista previa">►</button>
                            </span>
                        )}
                    </div>
                    {flatNodes.length === 0 ? (
                        <p className="text-sm text-gray-500">La ruta aún no tiene pasos que previsualizar.</p>
                    ) : (
                        <div className="max-w-4xl">
                            <div className="mb-6">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{info.title || 'Experiencia'}</h3>
                                    <span className="text-sm font-bold text-gray-600 dark:text-gray-300">0/{previewRoute.progress.totalRequired} completados</span>
                                </div>
                                <ProgressBar done={0} total={previewRoute.progress.totalRequired} />
                            </div>
                            <div className="space-y-8">
                                {previewRoute.modules.map((m: any) => (
                                    <section key={m.id} aria-label={`Módulo ${m.title} (vista previa)`}>
                                        <div className="flex items-center gap-3 mb-3">
                                            <h4 className="text-lg font-bold text-gray-800 dark:text-gray-100">{m.title}</h4>
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${MODULE_STATE_LABEL[m.state]?.cls ?? ''}`}>{MODULE_STATE_LABEL[m.state]?.text ?? m.state}</span>
                                        </div>
                                        <div className="space-y-3">
                                            {m.nodes.map((n: any) => n.state === 'current'
                                                ? <NodeShell key={n.id} node={n} moduleTitle={m.title} experienceTitle={info.title || 'Experiencia'} route={previewRoute} refresh={() => { }} preview />
                                                : <NodeRow key={n.id} node={n} />)}
                                        </div>
                                    </section>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── C12 Publicación ── */}
            {tab === 'publicacion' && (
                <div className="space-y-4 max-w-2xl">
                    <dl className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
                        <div><dt className="inline font-bold">Estado: </dt><dd className="inline">{ESTADO_EXP[expStatus]?.text}</dd></div>
                        <div><dt className="inline font-bold">Versión publicada: </dt><dd className="inline">{publishedVersion ? `v${publishedVersion}` : 'ninguna'}</dd></div>
                        <div><dt className="inline font-bold">Borrador en edición: </dt><dd className="inline">{draftVersionId ? `v${draftVersionNum}` : 'ninguno'}</dd></div>
                    </dl>
                    <p className="text-xs text-gray-500">Una versión publicada es inmutable: los participantes en curso terminan la versión que iniciaron; los nuevos entran a la última publicada.</p>

                    {expStatus !== 'archived' && draftVersionId && (
                        dirty ? (
                            <p className="text-sm text-amber-700">Guarda el borrador antes de publicar (hay cambios sin guardar).</p>
                        ) : confirmPublish ? (
                            <div className="rounded-xl border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 p-4 text-sm">
                                <p className="mb-3">Publicar v{draftVersionNum} — los participantes nuevos entrarán a esta versión; quienes están en curso terminan la suya. Después de publicar, la versión no podrá editarse.</p>
                                <div className="flex gap-3">
                                    <button type="button" onClick={publish} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Publicar v{draftVersionNum}</button>
                                    <button type="button" onClick={() => setConfirmPublish(false)} className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-bold">Cancelar</button>
                                </div>
                            </div>
                        ) : (
                            <button type="button" onClick={() => setConfirmPublish(true)} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Publicar v{draftVersionNum}…</button>
                        )
                    )}
                    {expStatus === 'published' && !draftVersionId && (
                        <button type="button" onClick={newVersionFromPublished} className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold">Crear nueva versión (copia editable v{(publishedVersion ?? 0) + 1})</button>
                    )}
                    {expStatus !== 'archived' && experienceId && (
                        confirmArchiveId === experienceId ? (
                            <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm">
                                <p className="mb-3">Archivar «{info.title}»: deja de descubrirse e iniciarse. No borra versiones, rutas en curso, progreso ni evidencia; quienes ya la cursan pueden terminar.</p>
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => archive(experienceId)} className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold">Archivar</button>
                                    <button type="button" onClick={() => setConfirmArchiveId(null)} className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-bold">Cancelar</button>
                                </div>
                            </div>
                        ) : (
                            <div><button type="button" onClick={() => setConfirmArchiveId(experienceId)} className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-sm font-bold inline-flex items-center gap-1"><Archive size={14} aria-hidden /> Archivar Experiencia…</button></div>
                        )
                    )}
                </div>
            )}

            {picker && (
                <ContentPicker
                    currentId={modules[picker.mi]?.nodes[picker.ni]?.resourceRef ?? null}
                    onClose={() => setPicker(null)}
                    onCreateContent={onCreateContent ? () => { setPicker(null); onCreateContent(); } : undefined}
                    onSelect={(c) => {
                        const n = modules[picker.mi].nodes[picker.ni];
                        setNode(picker.mi, picker.ni, { ...n, resourceRef: c.id });
                        setPicker(null);
                    }}
                />
            )}
        </div>
    );
};

export default ExperienceStudio;
