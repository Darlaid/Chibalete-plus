import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle, Loader2, Search, ShieldAlert } from 'lucide-react';
import { dataService } from '../../services/dataService';
import type { Content, EpubInspection } from '../../types';
import { asEpubUploadFile, isEpubFile } from '../../utils/epubSourceUpload.mjs';
import { epubAttachBlockReason, filterContentsForAttach } from '../../utils/epubAdmin.mjs';
import EpubInspectorCard from './EpubInspectorCard';

/**
 * CHP-CONTENT-CANONICAL-2026-01 3F.1 — «Añadir EPUB a un contenido existente».
 *
 * buscar → seleccionar → ver título/autor/id/PDF/EPUB → elegir EPUB →
 * inspeccionar → confirmar → adjuntar. El EPUB se sube con el /api/upload de
 * siempre BAJO el contentId existente (R4) y se adjunta con
 * POST /api/content/:id/epub-edition, que solo fija epub_url (sin reimportar
 * ni regenerar audio). Si el contenido ya tiene EPUB, se bloquea.
 */
const AttachEpubPanel: React.FC<{ contents: Content[] }> = ({ contents }) => {
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [inspection, setInspection] = useState<EpubInspection | null>(null);
    const [inspectBlock, setInspectBlock] = useState<string | null>(null);
    const [phase, setPhase] = useState<{ kind: 'idle' | 'working' | 'done' | 'error'; message?: string }>({ kind: 'idle' });
    const [attached, setAttached] = useState<Record<string, string>>({});

    const results = useMemo(() => filterContentsForAttach(contents, query), [contents, query]);
    const selected = useMemo(() => {
        const c = contents.find(x => x.id === selectedId) || null;
        return c && attached[c.id] ? { ...c, epub_url: attached[c.id] } : c;
    }, [contents, selectedId, attached]);
    const alreadyBlock = epubAttachBlockReason(selected);

    const choose = (id: string) => { setSelectedId(id); setFile(null); setInspection(null); setInspectBlock(null); setPhase({ kind: 'idle' }); };

    const confirm = async () => {
        if (!selected || !file || alreadyBlock || inspectBlock || !inspection) return;
        setPhase({ kind: 'working', message: 'Subiendo el EPUB…' });
        let uploadedUrl: string | null = null;
        try {
            uploadedUrl = await dataService.uploadFile(asEpubUploadFile(file), selected.id);
            setPhase({ kind: 'working', message: 'Añadiendo la edición EPUB…' });
            const saved = await dataService.attachEpubEdition(selected.id, uploadedUrl);
            setAttached(prev => ({ ...prev, [selected.id]: saved.epub_url as string }));
            setPhase({ kind: 'done' });
        } catch (e) {
            // El archivo subido sin adjuntar es un huérfano: limpieza best-effort
            // (el servidor nunca purga una URL que algún contenido referencia).
            if (uploadedUrl) dataService.purgeOrphanFile(uploadedUrl);
            setPhase({ kind: 'error', message: (e as Error).message });
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 animate-in slide-in-from-bottom-4">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-4 mb-6 flex items-center gap-2">
                <BookOpen className="text-indigo-500" /> Añadir EPUB a un contenido existente
            </h2>

            <label htmlFor="sc-attach-search" className="block text-sm font-medium mb-1">Buscar contenido</label>
            <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-3 text-gray-400" aria-hidden="true" />
                <input
                    id="sc-attach-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                    placeholder="Título, autor o id"
                    className="w-full pl-9 p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg"
                />
            </div>
            <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg mb-6" aria-label="Resultados">
                {results.length === 0 && <li className="p-3 text-sm text-gray-500">Sin resultados</li>}
                {results.map(c => (
                    <li key={c.id}>
                        <button
                            type="button" onClick={() => choose(c.id)} aria-pressed={selectedId === c.id}
                            className={`w-full text-left p-3 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${selectedId === c.id ? 'bg-indigo-50 dark:bg-indigo-900/30 font-semibold' : ''}`}
                        >
                            {c.titulo} <span className="text-gray-500 font-normal">· {c.autor || 'Sin autor'}</span>
                            {c.epub_url && <span className="ml-2 text-[10px] uppercase tracking-wide text-green-700 dark:text-green-400">EPUB</span>}
                        </button>
                    </li>
                ))}
            </ul>

            {selected && (
                <div className="space-y-4">
                    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm rounded-lg bg-gray-50 dark:bg-gray-900/40 p-4">
                        <div><dt className="inline text-gray-500">Título: </dt><dd className="inline font-medium">{selected.titulo}</dd></div>
                        <div><dt className="inline text-gray-500">Autor: </dt><dd className="inline">{selected.autor || '—'}</dd></div>
                        <div><dt className="inline text-gray-500">Id: </dt><dd className="inline font-mono text-xs">{selected.id}</dd></div>
                        <div><dt className="inline text-gray-500">PDF: </dt><dd className="inline">{/\.pdf$/i.test(selected.url_recurso || '') ? 'sí' : 'no'}</dd></div>
                        <div><dt className="inline text-gray-500">EPUB: </dt><dd className="inline">{selected.epub_url ? 'sí' : 'no'}</dd></div>
                    </dl>

                    {alreadyBlock ? (
                        <p className="flex items-start gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400" role="alert">
                            <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {alreadyBlock}
                        </p>
                    ) : (
                        <div>
                            <label htmlFor="sc-attach-epub" className="block text-sm font-medium mb-1">Edición EPUB</label>
                            <input
                                id="sc-attach-epub" type="file" accept=".epub,application/epub+zip"
                                onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f && isEpubFile(f) ? f : null); setPhase({ kind: 'idle' }); }}
                                className="w-full text-sm text-gray-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">Los demás modos del contenido (texto, audio, PDF) no se modifican.</p>
                            <EpubInspectorCard file={file} requiresText={false} onResult={(insp, block) => { setInspection(insp); setInspectBlock(block); }} />
                        </div>
                    )}

                    {phase.kind === 'error' && (
                        <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400" role="alert"><ShieldAlert size={16} className="mt-0.5 shrink-0" /> {phase.message}</p>
                    )}
                    {phase.kind === 'done' && (
                        <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400" role="status">
                            <CheckCircle size={16} /> Edición EPUB añadida. La ficha ya muestra «Ver EPUB original».
                        </p>
                    )}
                    {!alreadyBlock && (
                        <button
                            type="button" onClick={confirm}
                            disabled={!file || !inspection || !!inspectBlock || phase.kind === 'working'}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors"
                        >
                            {phase.kind === 'working' ? <><Loader2 size={18} className="animate-spin" /> {phase.message}</> : 'Añadir edición EPUB'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default AttachEpubPanel;
