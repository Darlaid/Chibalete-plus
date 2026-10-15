import React from 'react';
import { RotateCcw } from 'lucide-react';
import {
    FILTER_LIMITS, FILTER_PRESETS, TEXT_LIMITS, applyPreset, normalizeFilters, normalizeText,
} from './readerVisualSettings.mjs';

export interface EpubFilterState { brightness: number; contrast: number; saturation: number; preset: string }
export interface EpubTextState { fontScale: number; lineHeight: number; maxInlineSize: number }

const Slider: React.FC<{
    id: string; label: string; value: number; min: number; max: number; step: number;
    display: string; onChange: (v: number) => void;
}> = ({ id, label, value, min, max, step, display, onChange }) => (
    <div>
        <div className="flex items-center justify-between mb-1">
            <label htmlFor={id} className="text-sm font-semibold text-gray-200">{label}</label>
            <output htmlFor={id} className="text-xs font-mono text-amber-300">{display}</output>
        </div>
        <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-valuetext={display}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        />
    </div>
);

/** «Ajustes de lectura»: filtros visuales (todos los EPUB) + texto (solo reflowable). */
const EpubReaderSettings: React.FC<{
    filters: EpubFilterState;
    onFiltersChange: (f: EpubFilterState) => void;
    text: EpubTextState;
    onTextChange: (t: EpubTextState) => void;
    reflowable: boolean;
    onReset: () => void;
}> = ({ filters, onFiltersChange, text, onTextChange, reflowable, onReset }) => {
    const setFilter = (key: 'brightness' | 'contrast' | 'saturation', v: number) =>
        onFiltersChange(normalizeFilters({ ...filters, [key]: v }) as EpubFilterState);
    const setText = (key: keyof EpubTextState, v: number) =>
        onTextChange(normalizeText({ ...text, [key]: v }) as EpubTextState);

    return (
        <div className="space-y-6">
            <section aria-labelledby="epub-presets-h">
                <h3 id="epub-presets-h" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Modo de color</h3>
                <div role="radiogroup" aria-labelledby="epub-presets-h" className="grid grid-cols-2 gap-2">
                    {Object.entries(FILTER_PRESETS).map(([id, p]) => {
                        const active = filters.preset === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                onClick={() => onFiltersChange(applyPreset(id) as EpubFilterState)}
                                className={`px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${active ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'}`}
                            >
                                {p.label}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section aria-labelledby="epub-filters-h" className="space-y-4">
                <h3 id="epub-filters-h" className="text-xs font-bold uppercase tracking-wider text-gray-400">Imagen de la página</h3>
                <Slider id="epub-brillo" label="Brillo" {...FILTER_LIMITS.brightness} value={filters.brightness} display={`${filters.brightness}%`} onChange={(v) => setFilter('brightness', v)} />
                <Slider id="epub-contraste" label="Contraste" {...FILTER_LIMITS.contrast} value={filters.contrast} display={`${filters.contrast}%`} onChange={(v) => setFilter('contrast', v)} />
                <Slider id="epub-saturacion" label="Saturación" {...FILTER_LIMITS.saturation} value={filters.saturation} display={`${filters.saturation}%`} onChange={(v) => setFilter('saturation', v)} />
            </section>

            {reflowable ? (
                <section aria-labelledby="epub-text-h" className="space-y-4">
                    <h3 id="epub-text-h" className="text-xs font-bold uppercase tracking-wider text-gray-400">Texto</h3>
                    <Slider id="epub-tamano" label="Tamaño de texto" {...TEXT_LIMITS.fontScale} value={text.fontScale} display={`${text.fontScale}%`} onChange={(v) => setText('fontScale', v)} />
                    <Slider id="epub-interlineado" label="Interlineado" min={90} max={TEXT_LIMITS.lineHeight.max} step={TEXT_LIMITS.lineHeight.step} value={text.lineHeight || 90} display={text.lineHeight ? (text.lineHeight / 100).toFixed(1) : 'Del libro'} onChange={(v) => setText('lineHeight', v < TEXT_LIMITS.lineHeight.min ? 0 : v)} />
                    <Slider id="epub-ancho" label="Ancho de columna" {...TEXT_LIMITS.maxInlineSize} value={text.maxInlineSize} display={`${text.maxInlineSize}px`} onChange={(v) => setText('maxInlineSize', v)} />
                </section>
            ) : (
                <p className="text-xs text-gray-400">Este libro tiene maquetación fija: el texto conserva el diseño original.</p>
            )}

            <button
                type="button"
                onClick={onReset}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
                <RotateCcw size={16} /> Restablecer
            </button>
        </div>
    );
};

export default EpubReaderSettings;
