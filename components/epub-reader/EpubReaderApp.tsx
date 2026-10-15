import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Lock, ShieldAlert, ChevronLeft } from 'lucide-react';
import ChibaleteEpubReader, { type EpubOpenInfo, type EpubRelocateState } from './ChibaleteEpubReader';
import { contentDetailHref, readEpubContentId } from '../../utils/epubReaderLink.mjs';

/**
 * CHP-CONTENT-CANONICAL-2026-01 3E.3 — app de la entrada productiva
 * epub-reader.html?contentId=<id>.
 *
 * 1. valida la sesión con el MISMO mecanismo que la SPA (cookie HttpOnly,
 *    GET /api/auth/me same-origin);
 * 2. descarga el EPUB SOLO por GET /api/content/:id/epub (autorizado en
 *    servidor; nunca epub_url);
 * 3. lo abre en ChibaleteEpubReader (foliate solo como motor).
 * Sin Range en v1: descarga completa con progreso por Content-Length.
 */
type Phase =
    | { kind: 'checking' }
    | { kind: 'downloading'; loaded: number; total: number | null }
    | { kind: 'ready'; file: File }
    | { kind: 'error'; code: 'invalid' | 'auth' | 'forbidden' | 'notfound' | 'failed'; message?: string };

type Metrics = { downloadMs?: number; bytes?: number; firstContentMs?: number; navigableMs?: number; heapMB?: number };
const heapMB = () => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : undefined;
};
const debugEnabled = () => new URLSearchParams(window.location.search).get('debug') === '1';

const MESSAGES: Record<string, { title: string; text: string }> = {
    invalid: { title: 'Enlace no válido', text: 'Este enlace no identifica ningún libro.' },
    auth: { title: 'Inicia sesión para leer', text: 'Tu sesión no está activa. Entra de nuevo a Chibalete+ y vuelve a abrir el libro.' },
    forbidden: { title: 'Este libro no está disponible para ti', text: 'Tu cuenta no tiene acceso a esta edición EPUB.' },
    notfound: { title: 'Edición EPUB no disponible', text: 'Este contenido no tiene un EPUB original disponible.' },
    failed: { title: 'No se pudo preparar el libro', text: 'Hubo un problema al descargar la edición EPUB. Inténtalo de nuevo.' },
};

const StatusCard: React.FC<{ icon: React.ReactNode; title: string; children?: React.ReactNode; actions?: React.ReactNode }> = ({ icon, title, children, actions }) => (
    <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-white/5 border border-white/10 p-8 shadow-2xl text-center" role="status" aria-live="polite">
            <div className="flex justify-center mb-4">{icon}</div>
            <h1 className="text-xl font-bold mb-2">{title}</h1>
            {children}
            {actions && <div className="mt-6 flex flex-col gap-3">{actions}</div>}
        </div>
    </main>
);

const EpubReaderApp: React.FC = () => {
    const contentId = readEpubContentId(window.location.search);
    const [phase, setPhase] = useState<Phase>(contentId ? { kind: 'checking' } : { kind: 'error', code: 'invalid' });
    const metrics = useRef<Metrics>({});
    const t0 = useRef(0);
    const dbg = useRef<Record<string, unknown>>({});
    const adapterRef = useRef<{ auditImages: () => Promise<unknown> } | null>(null);

    const exposeDebug = useCallback((patch: Record<string, unknown>) => {
        if (!debugEnabled()) return;
        dbg.current = { ...dbg.current, ...patch, metrics: metrics.current, runAudit: () => adapterRef.current?.auditImages() };
        (window as unknown as Record<string, unknown>).__chpEpubReader = dbg.current;
    }, []);

    useEffect(() => {
        if (!contentId) return;
        const ctrl = new AbortController();
        (async () => {
            try {
                const me = await fetch('/api/auth/me', { credentials: 'same-origin', signal: ctrl.signal });
                if (!me.ok) { setPhase({ kind: 'error', code: 'auth' }); return; }

                t0.current = performance.now();
                const res = await fetch(`/api/content/${encodeURIComponent(contentId)}/epub`, { credentials: 'same-origin', signal: ctrl.signal });
                if (res.status === 401) { setPhase({ kind: 'error', code: 'auth' }); return; }
                if (res.status === 403) { setPhase({ kind: 'error', code: 'forbidden' }); return; }
                if (res.status === 404) { setPhase({ kind: 'error', code: 'notfound' }); return; }
                if (!res.ok || !res.body) { setPhase({ kind: 'error', code: 'failed', message: `HTTP ${res.status}` }); return; }

                const total = Number(res.headers.get('content-length')) || null;
                const reader = res.body.getReader();
                const chunks: Uint8Array[] = [];
                let loaded = 0;
                let lastPct = -1;
                setPhase({ kind: 'downloading', loaded: 0, total });
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.byteLength;
                    const pct = total ? Math.floor((loaded / total) * 100) : -1;
                    if (pct !== lastPct) { lastPct = pct; setPhase({ kind: 'downloading', loaded, total }); }
                }
                metrics.current = { ...metrics.current, downloadMs: Math.round(performance.now() - t0.current), bytes: loaded };
                const file = new File(chunks as BlobPart[], `${contentId}.epub`, { type: 'application/epub+zip' });
                exposeDebug({ contentId });
                setPhase({ kind: 'ready', file });
            } catch (e) {
                if ((e as Error)?.name === 'AbortError') return;
                setPhase({ kind: 'error', code: 'failed', message: (e as Error)?.message });
            }
        })();
        return () => ctrl.abort();
    }, [contentId, exposeDebug]);

    const back = useCallback(() => {
        window.location.assign(contentId ? contentDetailHref(contentId) : '/');
    }, [contentId]);

    const onOpened = useCallback((info: EpubOpenInfo) => {
        metrics.current = { ...metrics.current, navigableMs: Math.round(performance.now() - t0.current), heapMB: heapMB() };
        exposeDebug({ info });
    }, [exposeDebug]);
    const onFirstRelocate = useCallback(() => {
        metrics.current = { ...metrics.current, firstContentMs: Math.round(performance.now() - t0.current) };
        exposeDebug({});
    }, [exposeDebug]);
    const onRelocate = useCallback((loc: EpubRelocateState) => { exposeDebug({ loc }); }, [exposeDebug]);

    const backButton = (
        <button type="button" onClick={back} className="flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-indigo-600 hover:bg-indigo-500 font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
            <ChevronLeft size={18} /> Volver a la ficha
        </button>
    );

    if (phase.kind === 'ready') {
        return (
            <ChibaleteEpubReader
                file={phase.file}
                onBack={back}
                onOpened={onOpened}
                onFirstRelocate={onFirstRelocate}
                onRelocate={onRelocate}
                onAdapter={(a) => { adapterRef.current = a as never; }}
            />
        );
    }
    if (phase.kind === 'error') {
        const m = MESSAGES[phase.code];
        const icon = phase.code === 'auth' || phase.code === 'forbidden'
            ? <Lock className="text-amber-300" size={40} />
            : <ShieldAlert className="text-red-400" size={40} />;
        return (
            <StatusCard icon={icon} title={m.title} actions={<>
                {backButton}
                {phase.code === 'auth' && <a href="/#/auth" className="text-sm text-gray-300 hover:text-white underline">Iniciar sesión</a>}
            </>}>
                <p className="text-sm text-gray-300">{m.text}</p>
            </StatusCard>
        );
    }
    const pct = phase.kind === 'downloading' && phase.total ? Math.min(100, Math.round((phase.loaded / phase.total) * 100)) : null;
    return (
        <StatusCard icon={phase.kind === 'checking' ? <Loader2 className="animate-spin text-indigo-400" size={40} /> : <BookOpen className="text-indigo-400" size={40} />} title="Preparando edición EPUB…" actions={backButton}>
            {phase.kind === 'downloading' && (
                <div className="mt-2">
                    <div role="progressbar" aria-label="Descarga del libro" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct == null ? 'Descargando' : `${pct}%`} className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div className={`h-full bg-gradient-to-r from-indigo-500 to-amber-400 ${pct == null ? 'w-1/3 animate-pulse' : ''}`} style={pct == null ? undefined : { width: `${pct}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-mono text-amber-300">
                        {pct == null ? `${(phase.loaded / 1048576).toFixed(1)} MB` : `${pct}% · ${(phase.loaded / 1048576).toFixed(1)} de ${((phase.total ?? 0) / 1048576).toFixed(1)} MB`}
                    </p>
                </div>
            )}
        </StatusCard>
    );
};

export default EpubReaderApp;
