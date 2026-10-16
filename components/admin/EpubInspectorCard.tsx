import React, { useEffect, useState } from 'react';
import { BookOpen, Loader2, ShieldAlert, CheckCircle } from 'lucide-react';
import { dataService } from '../../services/dataService';
import type { EpubInspection } from '../../types';
import { formatEpubInspection, epubInspectionBlockReason } from '../../utils/epubAdmin.mjs';

/**
 * CHP-CONTENT-CANONICAL-2026-01 3F.1 — «EPUB detectado».
 *
 * Inspecciona el EPUB elegido con el servidor (POST /api/upload/epub-inspect:
 * mismo parser que la importación, sin guardar el archivo) y muestra un
 * resumen editorial. Si no es publicable lo dice; el servidor vuelve a
 * validarlo al subir/publicar.
 */
const EpubInspectorCard: React.FC<{
    file: File | null;
    requiresText?: boolean;
    onResult?: (inspection: EpubInspection | null, blockReason: string | null) => void;
}> = ({ file, requiresText = true, onResult }) => {
    const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; inspection?: EpubInspection; error?: string }>({ status: 'idle' });

    useEffect(() => {
        if (!file) { setState({ status: 'idle' }); onResult?.(null, null); return; }
        let cancelled = false;
        setState({ status: 'loading' });
        onResult?.(null, null);
        dataService.inspectEpub(file).then((inspection) => {
            if (cancelled) return;
            setState({ status: 'ready', inspection });
            onResult?.(inspection, epubInspectionBlockReason(inspection, { requiresText }));
        }).catch((e: Error) => {
            if (cancelled) return;
            setState({ status: 'error', error: e.message });
            onResult?.(null, e.message);
        });
        return () => { cancelled = true; };
        // onResult se lee en cada resultado; inspeccionar depende solo del archivo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, requiresText]);

    if (state.status === 'idle') return null;
    const block = state.inspection ? epubInspectionBlockReason(state.inspection, { requiresText }) : null;

    return (
        <div className="mt-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 p-4" role="status" aria-live="polite">
            <div className="flex items-center gap-2 mb-2 font-semibold text-indigo-700 dark:text-indigo-300">
                <BookOpen size={18} /> EPUB detectado
            </div>
            {state.status === 'loading' && (
                <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><Loader2 size={16} className="animate-spin" /> Revisando el EPUB…</p>
            )}
            {state.status === 'error' && (
                <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"><ShieldAlert size={16} className="mt-0.5 shrink-0" /> {state.error}</p>
            )}
            {state.status === 'ready' && state.inspection && (
                <>
                    <ul className="text-sm text-gray-700 dark:text-gray-200 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                        {formatEpubInspection(state.inspection).map((line: string) => <li key={line}>{line}</li>)}
                    </ul>
                    {block ? (
                        <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-red-600 dark:text-red-400"><ShieldAlert size={16} className="mt-0.5 shrink-0" /> No publicable: {block}</p>
                    ) : (
                        <p className="mt-3 flex items-center gap-2 text-sm text-green-700 dark:text-green-400"><CheckCircle size={16} /> Listo para publicar</p>
                    )}
                </>
            )}
        </div>
    );
};

export default EpubInspectorCard;
