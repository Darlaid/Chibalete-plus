import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Panel lateral (desktop) / hoja inferior (móvil) del lector EPUB.
 * Mismo lenguaje visual que la ficha: vidrio oscuro, bordes white/10,
 * foco visible indigo. Escape cierra; el foco entra al abrir y vuelve al
 * disparador al cerrar.
 */
const EpubReaderDrawer: React.FC<{
    id: string;
    title: string;
    open: boolean;
    onClose: () => void;
    returnFocusTo?: React.RefObject<HTMLElement | null>;
    children: React.ReactNode;
}> = ({ id, title, open, onClose, returnFocusTo, children }) => {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const trigger = returnFocusTo?.current;
        return () => {
            window.removeEventListener('keydown', onKey);
            trigger?.focus();
        };
    }, [open, onClose, returnFocusTo]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[80]" aria-hidden={false}>
            <button type="button" aria-label="Cerrar panel" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50 md:bg-transparent cursor-default" />
            <div
                id={id}
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                tabIndex={-1}
                className="absolute inset-x-0 bottom-0 max-h-[80vh] rounded-t-3xl md:inset-y-0 md:left-auto md:right-0 md:bottom-auto md:h-full md:max-h-none md:w-96 md:rounded-none md:rounded-l-3xl bg-gray-900/95 backdrop-blur-md border-t md:border-t-0 md:border-l border-white/10 text-white shadow-2xl flex flex-col outline-none"
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <h2 id={`${id}-title`} className="text-lg font-bold">{title}</h2>
                    <button type="button" onClick={onClose} aria-label={`Cerrar ${title}`} className="p-2 rounded-full bg-white/10 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                        <X size={18} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            </div>
        </div>
    );
};

export default EpubReaderDrawer;
