import React from 'react';
import { ChevronLeft, List, SlidersHorizontal } from 'lucide-react';

/** Cabecera discreta: Volver · título · capítulo actual · progreso · paneles. */
const EpubReaderToolbar: React.FC<{
    title: string;
    chapter: string | null;
    fraction: number | null;
    onBack: () => void;
    onOpenToc: () => void;
    onOpenSettings: () => void;
    tocButtonRef: React.RefObject<HTMLButtonElement | null>;
    settingsButtonRef: React.RefObject<HTMLButtonElement | null>;
    disabled?: boolean;
}> = ({ title, chapter, fraction, onBack, onOpenToc, onOpenSettings, tocButtonRef, settingsButtonRef, disabled }) => {
    const pct = fraction == null ? null : Math.round(fraction * 100);
    const iconBtn = 'p-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white transition-all disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
    return (
        <header className="relative z-20 bg-gray-900/90 backdrop-blur-md border-b border-white/10">
            <div className="flex items-center gap-3 px-3 md:px-6 py-2.5">
                <button type="button" onClick={onBack} className="flex items-center gap-1 pl-2 pr-3 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-semibold text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                    <ChevronLeft size={18} /> <span className="hidden sm:inline">Volver</span>
                </button>
                <div className="flex-1 min-w-0 text-center">
                    <h1 className="text-sm md:text-base font-bold text-white truncate">{title}</h1>
                    <p className="text-xs text-indigo-300 truncate" aria-live="polite">{chapter ?? ' '}</p>
                </div>
                <span className="hidden sm:inline text-xs font-mono text-amber-300 w-10 text-right" aria-hidden="true">{pct == null ? '' : `${pct}%`}</span>
                <button type="button" ref={tocButtonRef} onClick={onOpenToc} disabled={disabled} aria-label="Tabla de contenido" aria-controls="epub-toc" className={iconBtn}>
                    <List size={18} />
                </button>
                <button type="button" ref={settingsButtonRef} onClick={onOpenSettings} disabled={disabled} aria-label="Ajustes de lectura" aria-controls="epub-ajustes" className={iconBtn}>
                    <SlidersHorizontal size={18} />
                </button>
            </div>
            <div
                role="progressbar"
                aria-label="Progreso de lectura"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? 0}
                aria-valuetext={pct == null ? 'Sin datos' : `${pct}% leído`}
                className="h-1 bg-white/10"
            >
                <div className="h-full bg-gradient-to-r from-indigo-500 to-amber-400 transition-[width] duration-300" style={{ width: `${pct ?? 0}%` }} />
            </div>
        </header>
    );
};

export default EpubReaderToolbar;
