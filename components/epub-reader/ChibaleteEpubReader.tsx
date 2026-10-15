import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ShieldAlert } from 'lucide-react';
import { createFoliateAdapter } from './foliateAdapter.mjs';
import {
    buildFilterCss, buildTextCss, isReflowableLayout, resetFilters, DEFAULT_TEXT,
} from './readerVisualSettings.mjs';
import EpubReaderToolbar from './EpubReaderToolbar';
import EpubReaderDrawer from './EpubReaderDrawer';
import EpubReaderToc, { type EpubTocItem } from './EpubReaderToc';
import EpubReaderSettings, { type EpubFilterState, type EpubTextState } from './EpubReaderSettings';

export interface EpubOpenInfo { title: string | null; layout: string; toc: EpubTocItem[]; sectionCount: number }
export interface EpubRelocateState {
    fraction: number | null; sectionIndex: number | null; sectionCount: number | null;
    tocLabel: string | null; tocHref: string | null; cfi: string | null;
    location: { current: number; next: number; total: number } | null;
}
type Adapter = ReturnType<typeof createFoliateAdapter>;

/**
 * Lector EPUB de Chibalete+. foliate-js es solo el motor (vía foliateAdapter);
 * toda la interfaz visible es de Chibalete+.
 */
const ChibaleteEpubReader: React.FC<{
    file: File;
    fallbackTitle?: string;
    onBack: () => void;
    onOpened?: (info: EpubOpenInfo) => void;
    onFirstRelocate?: () => void;
    onRelocate?: (state: EpubRelocateState) => void;
    onAdapter?: (adapter: Adapter | null) => void;
}> = ({ file, fallbackTitle, onBack, onOpened, onFirstRelocate, onRelocate, onAdapter }) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const adapterRef = useRef<Adapter | null>(null);
    const tocBtn = useRef<HTMLButtonElement>(null);
    const settingsBtn = useRef<HTMLButtonElement>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<EpubOpenInfo | null>(null);
    const [loc, setLoc] = useState<EpubRelocateState | null>(null);
    const [panel, setPanel] = useState<'toc' | 'settings' | null>(null);
    const [filters, setFilters] = useState<EpubFilterState>(resetFilters() as EpubFilterState);
    const [text, setText] = useState<EpubTextState>({ ...DEFAULT_TEXT });

    // Callbacks del padre en refs: abrir el libro depende solo del archivo.
    const cbs = useRef({ onOpened, onFirstRelocate, onRelocate, onAdapter });
    cbs.current = { onOpened, onFirstRelocate, onRelocate, onAdapter };

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let cancelled = false;
        let first = true;
        const adapter = createFoliateAdapter({ host });
        adapterRef.current = adapter;
        const off = adapter.onRelocate((s: EpubRelocateState) => {
            if (cancelled) return;
            if (first) { first = false; cbs.current.onFirstRelocate?.(); }
            setLoc(s);
            cbs.current.onRelocate?.(s);
        });
        setStatus('loading'); setError(null); setInfo(null); setLoc(null);
        adapter.open(file).then((opened: EpubOpenInfo) => {
            if (cancelled) return;
            setInfo(opened);
            setStatus('ready');
            cbs.current.onOpened?.(opened);
            cbs.current.onAdapter?.(adapter);
        }).catch((e: Error & { code?: string; reasons?: string[] }) => {
            if (cancelled) return;
            setStatus('error');
            setError(e?.code === 'EPUB_SCRIPTED_CONTENT'
                ? `${e.message} (${(e.reasons ?? []).slice(0, 3).join('; ')})`
                : `No se pudo abrir el EPUB: ${e?.message ?? e}`);
        });
        return () => {
            cancelled = true;
            off();
            adapter.close();
            adapterRef.current = null;
            cbs.current.onAdapter?.(null);
        };
    }, [file]);

    const reflowable = isReflowableLayout(info?.layout);

    useEffect(() => { if (status === 'ready') adapterRef.current?.setVisualFilter(buildFilterCss(filters)); }, [filters, status]);
    useEffect(() => {
        if (status === 'ready' && reflowable) adapterRef.current?.setTextSettings(buildTextCss(text), text.maxInlineSize);
    }, [text, status, reflowable]);

    const next = useCallback(() => adapterRef.current?.next(), []);
    const prev = useCallback(() => adapterRef.current?.prev(), []);
    const closePanel = useCallback(() => setPanel(null), []);

    // Flechas fuera del iframe (dentro las reenvía el adapter).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (panel || status !== 'ready') return;
            const t = e.target as HTMLElement | null;
            if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [panel, status, next, prev]);

    const navBtn = 'flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white transition-all disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
    const ready = status === 'ready';

    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-gray-900 text-white">
            <EpubReaderToolbar
                title={info?.title || fallbackTitle || 'Libro'}
                chapter={loc?.tocLabel ?? null}
                fraction={loc?.fraction ?? null}
                onBack={onBack}
                onOpenToc={() => setPanel('toc')}
                onOpenSettings={() => setPanel('settings')}
                tocButtonRef={tocBtn}
                settingsButtonRef={settingsBtn}
                disabled={!ready}
            />

            <main className="relative flex-1 min-h-0 flex items-stretch">
                <button type="button" onClick={prev} disabled={!ready} aria-label="Página anterior" className={`hidden md:flex ${navBtn} self-center mx-3 w-12 h-12 shrink-0`}>
                    <ChevronLeft size={22} />
                </button>

                <div className="relative flex-1 min-w-0 my-2 md:my-4 rounded-none md:rounded-2xl overflow-hidden bg-white shadow-[0_0_40px_rgba(79,70,229,0.15)]">
                    <div ref={hostRef} className="absolute inset-0" aria-label="Página del libro" />
                    {status === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 text-gray-300" role="status">
                            <Loader2 className="animate-spin text-indigo-400" size={32} />
                            <span className="text-sm">Abriendo el libro…</span>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 p-6 text-center" role="alert">
                            <ShieldAlert className="text-red-400" size={36} />
                            <p className="max-w-md text-sm text-red-200">{error}</p>
                        </div>
                    )}
                </div>

                <button type="button" onClick={next} disabled={!ready} aria-label="Página siguiente" className={`hidden md:flex ${navBtn} self-center mx-3 w-12 h-12 shrink-0`}>
                    <ChevronRight size={22} />
                </button>
            </main>

            {/* Móvil: navegación compacta abajo */}
            <nav aria-label="Navegación de páginas" className="md:hidden flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10 bg-gray-900/90">
                <button type="button" onClick={prev} disabled={!ready} aria-label="Página anterior" className={`${navBtn} w-12 h-12`}><ChevronLeft size={22} /></button>
                <span className="text-xs font-mono text-amber-300" aria-hidden="true">{loc?.fraction == null ? '' : `${Math.round(loc.fraction * 100)}%`}</span>
                <button type="button" onClick={next} disabled={!ready} aria-label="Página siguiente" className={`${navBtn} w-12 h-12`}><ChevronRight size={22} /></button>
            </nav>

            <EpubReaderDrawer id="epub-toc" title="Contenido" open={panel === 'toc'} onClose={closePanel} returnFocusTo={tocBtn}>
                <EpubReaderToc
                    items={info?.toc ?? []}
                    currentHref={loc?.tocHref ?? null}
                    onSelect={(href) => { adapterRef.current?.goTo(href); setPanel(null); }}
                />
            </EpubReaderDrawer>
            <EpubReaderDrawer id="epub-ajustes" title="Ajustes de lectura" open={panel === 'settings'} onClose={closePanel} returnFocusTo={settingsBtn}>
                <EpubReaderSettings
                    filters={filters}
                    onFiltersChange={setFilters}
                    text={text}
                    onTextChange={setText}
                    reflowable={reflowable}
                    onReset={() => { setFilters(resetFilters() as EpubFilterState); setText({ ...DEFAULT_TEXT }); }}
                />
            </EpubReaderDrawer>
        </div>
    );
};

export default ChibaleteEpubReader;
