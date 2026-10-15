import React from 'react';

export interface EpubTocItem { label: string; href: string; depth: number }

/** Tabla de contenido del EPUB: lista navegable; marca el capítulo actual. */
const EpubReaderToc: React.FC<{
    items: EpubTocItem[];
    currentHref: string | null;
    onSelect: (href: string) => void;
}> = ({ items, currentHref, onSelect }) => {
    if (!items.length) return <p className="text-sm text-gray-400">Este libro no declara tabla de contenido.</p>;
    return (
        <nav aria-label="Tabla de contenido">
            <ol className="space-y-1">
                {items.map((item, i) => {
                    const current = !!currentHref && item.href === currentHref;
                    return (
                        <li key={`${item.href}-${i}`}>
                            <button
                                type="button"
                                onClick={() => onSelect(item.href)}
                                aria-current={current ? 'location' : undefined}
                                style={{ paddingLeft: `${0.75 + item.depth * 1}rem` }}
                                className={`w-full text-left pr-3 py-2.5 rounded-xl text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${current ? 'bg-indigo-600 text-white font-semibold' : 'text-gray-200 hover:bg-white/10'}`}
                            >
                                {item.label || 'Sin título'}
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

export default EpubReaderToc;
