/**
 * readerVisualSettings.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.2.
 *
 * Ajustes visuales del lector EPUB de Chibalete+ (sin DOM, probados en Node).
 * Los filtros se aplican al `part="filter"` que expone el motor (la página del
 * libro), nunca a los archivos originales. Los ajustes de texto solo valen
 * para libros reflowable; un fixed-layout conserva su maquetación.
 */

export const FILTER_LIMITS = Object.freeze({
    brightness: { min: 50, max: 150, step: 5 },
    contrast: { min: 50, max: 200, step: 5 },
    saturation: { min: 0, max: 200, step: 5 },
});

export const DEFAULT_FILTERS = Object.freeze({ brightness: 100, contrast: 100, saturation: 100, preset: 'normal' });

/** Presets: cada uno fija valores base y, si aplica, un filtro adicional. */
export const FILTER_PRESETS = Object.freeze({
    normal: { label: 'Normal', brightness: 100, contrast: 100, saturation: 100, extra: '' },
    'alto-contraste': { label: 'Alto contraste', brightness: 100, contrast: 160, saturation: 100, extra: '' },
    grises: { label: 'Escala de grises', brightness: 100, contrast: 100, saturation: 0, extra: '' },
    invertido: { label: 'Invertido', brightness: 100, contrast: 100, saturation: 100, extra: 'invert(1) hue-rotate(180deg)' },
    sepia: { label: 'Sepia', brightness: 100, contrast: 95, saturation: 100, extra: 'sepia(0.6)' },
});

const clamp = (value, { min, max }) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.round(n)));
};

/** Normaliza un estado de filtros (valores fuera de rango → límite; basura → default). */
export function normalizeFilters(input = {}) {
    const preset = Object.hasOwn(FILTER_PRESETS, input.preset) ? input.preset : DEFAULT_FILTERS.preset;
    const out = { preset };
    for (const key of ['brightness', 'contrast', 'saturation']) {
        out[key] = clamp(input[key], FILTER_LIMITS[key]) ?? DEFAULT_FILTERS[key];
    }
    return out;
}

/** Estado que resulta de elegir un preset (sus valores base). */
export function applyPreset(presetId) {
    const p = FILTER_PRESETS[presetId] ?? FILTER_PRESETS.normal;
    return normalizeFilters({ preset: Object.hasOwn(FILTER_PRESETS, presetId) ? presetId : 'normal', brightness: p.brightness, contrast: p.contrast, saturation: p.saturation });
}

/** Valor CSS `filter` para el part del motor. '' = sin filtro (estado neutro). */
export function buildFilterCss(input) {
    const f = normalizeFilters(input);
    const parts = [];
    if (f.brightness !== 100) parts.push(`brightness(${f.brightness / 100})`);
    if (f.contrast !== 100) parts.push(`contrast(${f.contrast / 100})`);
    if (f.saturation !== 100) parts.push(`saturate(${f.saturation / 100})`);
    const extra = FILTER_PRESETS[f.preset].extra;
    if (extra) parts.push(extra);
    return parts.join(' ');
}

export const resetFilters = () => ({ ...DEFAULT_FILTERS });

// ── Ajustes de texto (solo reflowable) ───────────────────────────────────────
export const TEXT_LIMITS = Object.freeze({
    fontScale: { min: 80, max: 200, step: 10 },      // % del tamaño del libro
    lineHeight: { min: 100, max: 220, step: 10 },    // % (1.0–2.2); 0 = el del libro
    maxInlineSize: { min: 480, max: 1200, step: 40 }, // px del ancho de columna
});
export const DEFAULT_TEXT = Object.freeze({ fontScale: 100, lineHeight: 0, maxInlineSize: 720 });

export const isReflowableLayout = (layout) => layout !== 'pre-paginated';

export function normalizeText(input = {}) {
    return {
        fontScale: clamp(input.fontScale, TEXT_LIMITS.fontScale) ?? DEFAULT_TEXT.fontScale,
        lineHeight: Number(input.lineHeight) === 0 ? 0 : (clamp(input.lineHeight, TEXT_LIMITS.lineHeight) ?? DEFAULT_TEXT.lineHeight),
        maxInlineSize: clamp(input.maxInlineSize, TEXT_LIMITS.maxInlineSize) ?? DEFAULT_TEXT.maxInlineSize,
    };
}

/**
 * CSS que el motor inyecta en cada sección (renderer.setStyles). Solo escala
 * lo que el libro declara: no sustituye tipografías ni colores.
 */
export function buildTextCss(input) {
    const t = normalizeText(input);
    const rules = [];
    if (t.fontScale !== 100) rules.push(`html { font-size: ${t.fontScale}% !important; }`);
    if (t.lineHeight) rules.push(`p, li, blockquote, dd { line-height: ${(t.lineHeight / 100).toFixed(2)} !important; }`);
    return rules.join('\n');
}
