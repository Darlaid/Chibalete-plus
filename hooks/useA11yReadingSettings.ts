/**
 * useA11yReadingSettings — preferencias de lectura del Modo accesible.
 *
 * Maneja:
 *   - 5 ejes de configuración (fontFamily, fontSize, spacing, theme, focusRule)
 *   - Persistencia en localStorage por usuario (key: chibalete:a11y:settings)
 *   - Default conservador (system fonts + medium + normal + system theme +
 *     focusRule off) — la "lectura pura" funciona perfecto sin tocar nada
 *   - Resolución de theme='system' → light/dark según prefers-color-scheme
 *   - Lazy load de fuentes web (Lexend) cuando se selecciona
 *   - Pre-cómputo de cssVars listos para `style={cssVars}` en el shell
 *
 * Filosofía:
 *   El hook NO toca el DOM directamente fuera de:
 *   1. localStorage (persistencia)
 *   2. <link> al head (lazy load de Lexend, una sola vez)
 *   3. matchMedia listener (para reaccionar a cambios del OS theme)
 *
 *   Las CSS vars se devuelven como objeto. Quien renderiza el shell aplica
 *   `style={cssVars}` en el div root. Los hijos heredan automáticamente.
 *
 * Memoización del retorno: el objeto API se devuelve dentro de useMemo.
 *   Patrón obligatorio en este proyecto — un hook que retorna {} sin memo
 *   genera nueva ref en cada render y rompe consumers que pongan el objeto
 *   en deps de useEffect (ver sprint del bug de fetch loop).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

// ── Tipos ───────────────────────────────────────────────────────────────────

export type FontFamily = 'system' | 'openDyslexic' | 'lexend' | 'dyslexie' | 'arial' | 'verdana';
export type FontSize   = 'small' | 'medium' | 'large' | 'xl';
export type Spacing    = 'normal' | 'wide' | 'extraWide';
export type Theme      = 'system' | 'light' | 'dark';
/**
 * Idioma de lectura (BCP-47 minúscula). Es preferencia GLOBAL del user
 * — persiste cross-libro. Cada visor evalúa disponibilidad real para el
 * libro actual y hace fallback a 'es' si la traducción no está, sin
 * modificar la preferencia.
 *
 * IDIOMA es ORTOGONAL a los presets visuales: cambiar de idioma NO
 * cambia activePreset, y aplicar un preset NO toca language.
 */
export type ReadingLanguage = 'es' | 'en';

/**
 * Perfiles de lectura. 4 presets nombrados + 'custom' (estado en el que
 * cae el sistema cuando el usuario modifica algún setting individual).
 *
 * - standard:  baseline neutro (Arial, medio, normal, system theme).
 * - dyslexia:  OpenDyslexic + grande + amplio + light theme.
 * - focus:     Lexend + medio + amplio + dark theme + regla focal ON.
 * - lowVision: Verdana + extra grande + extra amplio + dark theme + regla focal ON.
 * - custom:    cualquier configuración que NO matchee ninguno de los 4 presets.
 */
export type ActivePreset = 'standard' | 'dyslexia' | 'focus' | 'lowVision' | 'custom';

/** Subset de ReadingSettings que un preset realmente fija. NO incluye
 *  language (ortogonal) ni activePreset (es la propia clave). */
export interface PresetValues {
    fontFamily: FontFamily;
    fontSize:   FontSize;
    spacing:    Spacing;
    theme:      Theme;
    focusRule:  boolean;
}

/**
 * Mapa canónico de presets. Exportado para que componentes/tests puedan
 * inspeccionarlo. Type narrow por Record<Exclude<ActivePreset,'custom'>,…>:
 * 'custom' nunca aparece como key porque no es un destino seleccionable.
 */
export const A11Y_READING_PRESETS: Record<Exclude<ActivePreset, 'custom'>, PresetValues> = {
    standard:  { fontFamily: 'arial',        fontSize: 'medium', spacing: 'normal',    theme: 'system', focusRule: false },
    dyslexia:  { fontFamily: 'openDyslexic', fontSize: 'large',  spacing: 'wide',      theme: 'light',  focusRule: false },
    focus:     { fontFamily: 'lexend',       fontSize: 'medium', spacing: 'wide',      theme: 'dark',   focusRule: true  },
    lowVision: { fontFamily: 'verdana',      fontSize: 'xl',     spacing: 'extraWide', theme: 'dark',   focusRule: true  },
};

const SELECTABLE_PRESETS: ReadonlyArray<Exclude<ActivePreset, 'custom'>> =
    ['standard', 'dyslexia', 'focus', 'lowVision'];

export interface ReadingSettings {
    fontFamily:   FontFamily;
    fontSize:     FontSize;
    spacing:      Spacing;
    theme:        Theme;
    focusRule:    boolean;
    language:     ReadingLanguage;
    activePreset: ActivePreset;
}

export interface ReadingSettingsApi {
    settings:        ReadingSettings;
    /** light/dark concreto, ya resuelto desde 'system' si aplica. */
    resolvedTheme:   'light' | 'dark';
    /** CSS vars pre-computadas listas para `style={...}` en el div root. */
    cssVars:         CSSProperties;
    /** Mutadores individuales (cada uno persiste en localStorage).
     *  Estos 5 mueven activePreset a 'custom' si no estaba ya en custom.
     *  setLanguage NO lo mueve (idioma es ortogonal a presets visuales). */
    setFontFamily:   (v: FontFamily)      => void;
    setFontSize:     (v: FontSize)        => void;
    setSpacing:      (v: Spacing)         => void;
    setTheme:        (v: Theme)           => void;
    setFocusRule:    (v: boolean)         => void;
    setLanguage:     (v: ReadingLanguage) => void;
    /** Aplicar un preset nombrado. Reescribe los 5 valores visuales y
     *  setea activePreset al preset elegido. NO toca language. */
    setPreset:       (preset: Exclude<ActivePreset, 'custom'>) => void;
    /** Restaurar defaults: aplica preset 'standard' + language='es'. */
    reset:           () => void;
}

// ── Constantes ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'chibalete:a11y:settings';

// Default = preset 'standard' + language='es' + activePreset='standard'.
// Un user nuevo arranca en 'standard' (Arial / medio / normal / system / focusRule
// off). Cualquier setting individual cambiado moverá activePreset a 'custom'.
const DEFAULT_SETTINGS: ReadingSettings = {
    ...A11Y_READING_PRESETS.standard,
    language:     'es',
    activePreset: 'standard',
};

// Stacks de fuentes con fallbacks honestos.
//
// Notas de licenciamiento:
//   - OpenDyslexic: cargada via CDN en index.html (open source).
//   - Lexend: lazy load via Google Fonts.
//   - Dyslexie: NO se distribuye libremente. Si el usuario la tiene
//     instalada localmente, el browser la usa; si no, fallback a OpenDyslexic.
//   - Arial / Verdana: fuentes del sistema, siempre disponibles en Win/Mac.
//   - system: stack OS-friendly de UI moderna.
const FONT_STACKS: Record<FontFamily, string> = {
    system:       'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    openDyslexic: '"OpenDyslexic", system-ui, sans-serif',
    lexend:       '"Lexend", system-ui, sans-serif',
    dyslexie:     '"Dyslexie", "OpenDyslexic", system-ui, sans-serif',
    arial:        'Arial, "Helvetica Neue", Helvetica, sans-serif',
    verdana:      'Verdana, Geneva, sans-serif',
};

// Tamaños base. Multiplicador con zoom del browser sigue funcionando.
// xl alcanza 23px nativo → con zoom 200% renderiza ~46px (cumple SC 1.4.4).
const FONT_SIZES: Record<FontSize, string> = {
    small:  '14px',
    medium: '17px',
    large:  '20px',
    xl:     '23px',
};

// SC 1.4.12 Text Spacing exige line-height ≥1.5 sobre 1em normal. Los 3 niveles
// suben gradualmente line-height + letter-spacing + paragraph spacing.
const SPACINGS: Record<Spacing, { lineHeight: string; letterSpacing: string; paragraphSpacing: string }> = {
    normal:    { lineHeight: '1.6',  letterSpacing: '0',      paragraphSpacing: '1em'   },
    wide:      { lineHeight: '1.85', letterSpacing: '0.04em', paragraphSpacing: '1.5em' },
    extraWide: { lineHeight: '2.1',  letterSpacing: '0.08em', paragraphSpacing: '2em'   },
};

// Paletas. Light = AAA contrast (>= 7:1) con texto plano para lectura larga.
// Dark = inverso suave (no #000 puro para reducir fatiga visual nocturna).
const THEME_PALETTES = {
    light: { bg: '#ffffff', text: '#1a1a1a', muted: '#525252' },
    dark:  { bg: '#0d0d0d', text: '#e8e8e8', muted: '#a3a3a3' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compara los 5 valores visuales contra los 4 presets. Devuelve el nombre
 * del preset que matchea exactamente, o 'custom' si ninguno.
 */
function inferPresetFromValues(v: PresetValues): ActivePreset {
    for (const key of SELECTABLE_PRESETS) {
        const p = A11Y_READING_PRESETS[key];
        if (
            p.fontFamily === v.fontFamily &&
            p.fontSize   === v.fontSize   &&
            p.spacing    === v.spacing    &&
            p.theme      === v.theme      &&
            p.focusRule  === v.focusRule
        ) return key;
    }
    return 'custom';
}

const VALID_ACTIVE_PRESETS: ReadonlyArray<ActivePreset> =
    ['standard', 'dyslexia', 'focus', 'lowVision', 'custom'];

function readSettings(): ReadingSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SETTINGS;
        const parsed = JSON.parse(raw);
        // Merge defensivo — si el shape histórico difiere, defaults rellenan.
        const fontFamily: FontFamily = ['system','openDyslexic','lexend','dyslexie','arial','verdana'].includes(parsed.fontFamily) ? parsed.fontFamily : DEFAULT_SETTINGS.fontFamily;
        const fontSize:   FontSize   = ['small','medium','large','xl'].includes(parsed.fontSize)                                    ? parsed.fontSize   : DEFAULT_SETTINGS.fontSize;
        const spacing:    Spacing    = ['normal','wide','extraWide'].includes(parsed.spacing)                                       ? parsed.spacing    : DEFAULT_SETTINGS.spacing;
        const theme:      Theme      = ['system','light','dark'].includes(parsed.theme)                                             ? parsed.theme      : DEFAULT_SETTINGS.theme;
        const focusRule:  boolean    = typeof parsed.focusRule === 'boolean'                                                        ? parsed.focusRule  : DEFAULT_SETTINGS.focusRule;
        const language:   ReadingLanguage = ['es','en'].includes(parsed.language)                                                   ? parsed.language   : DEFAULT_SETTINGS.language;

        // Migración compatible:
        //   - Si parsed.activePreset existe y es válido → usar.
        //   - Si NO existe (storage anterior al sprint de presets) → INFERIR
        //     comparando los 5 valores contra los 4 presets. Si match → ese
        //     preset; si no → 'custom'. Esto preserva la experiencia del user
        //     que ya tenía settings configurados antes de presets.
        const activePreset: ActivePreset = VALID_ACTIVE_PRESETS.includes(parsed.activePreset)
            ? parsed.activePreset
            : inferPresetFromValues({ fontFamily, fontSize, spacing, theme, focusRule });

        return { fontFamily, fontSize, spacing, theme, focusRule, language, activePreset };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

function writeSettings(settings: ReadingSettings): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // localStorage lleno / modo privado / cookies bloqueadas — fail silencioso.
    }
}

/** Lazy load de Lexend. Solo se inserta al head la primera vez que se selecciona. */
function ensureLexendLoaded(): void {
    if (typeof document === 'undefined') return;
    const id = 'a11y-font-lexend';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id  = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;700&display=swap';
    document.head.appendChild(link);
}

function detectSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useA11yReadingSettings(): ReadingSettingsApi {
    const [settings, setSettings] = useState<ReadingSettings>(() => readSettings());
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => detectSystemTheme());

    // Reaccionar a cambios de prefers-color-scheme en runtime.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
        mq.addEventListener('change', listener);
        return () => mq.removeEventListener('change', listener);
    }, []);

    // Lazy load Lexend cuando se selecciona.
    useEffect(() => {
        if (settings.fontFamily === 'lexend') ensureLexendLoaded();
    }, [settings.fontFamily]);

    // Persistir a localStorage siempre que cambien settings.
    useEffect(() => {
        writeSettings(settings);
    }, [settings]);

    const resolvedTheme: 'light' | 'dark' =
        settings.theme === 'system' ? systemTheme : settings.theme;

    // CSS vars pre-computadas. El shell las aplica con `style={cssVars}` en
    // el div root. Como las vars heredan, todos los hijos pueden usarlas
    // sin saber que existen.
    const cssVars = useMemo<CSSProperties>(() => {
        const palette = THEME_PALETTES[resolvedTheme];
        const sp      = SPACINGS[settings.spacing];
        return {
            // CSS vars custom (TypeScript exige cast a CSSProperties via 'as any'
            // o usar el truco del index signature — usamos el truco abajo).
            ['--a11y-bg' as any]:                palette.bg,
            ['--a11y-text' as any]:              palette.text,
            ['--a11y-muted' as any]:             palette.muted,
            ['--a11y-font-family' as any]:       FONT_STACKS[settings.fontFamily],
            ['--a11y-font-size' as any]:         FONT_SIZES[settings.fontSize],
            ['--a11y-line-height' as any]:       sp.lineHeight,
            ['--a11y-letter-spacing' as any]:    sp.letterSpacing,
            ['--a11y-paragraph-spacing' as any]: sp.paragraphSpacing,
        };
    }, [resolvedTheme, settings.fontFamily, settings.fontSize, settings.spacing]);

    // ── Mutadores ──────────────────────────────────────────────────────────
    // Los 5 setters visuales mueven activePreset → 'custom' si no estaba ya
    // ahí. Si el user ya está en 'custom', queda 'custom' (idempotente).
    // setLanguage NO toca activePreset — idioma es ortogonal a los presets
    // visuales.
    const setFontFamily = useCallback((v: FontFamily) => setSettings(s => ({ ...s, fontFamily: v, activePreset: 'custom' })), []);
    const setFontSize   = useCallback((v: FontSize)   => setSettings(s => ({ ...s, fontSize:   v, activePreset: 'custom' })), []);
    const setSpacing    = useCallback((v: Spacing)    => setSettings(s => ({ ...s, spacing:    v, activePreset: 'custom' })), []);
    const setTheme      = useCallback((v: Theme)      => setSettings(s => ({ ...s, theme:      v, activePreset: 'custom' })), []);
    const setFocusRule  = useCallback((v: boolean)    => setSettings(s => ({ ...s, focusRule:  v, activePreset: 'custom' })), []);
    const setLanguage   = useCallback((v: ReadingLanguage) => setSettings(s => ({ ...s, language: v })), []);

    const setPreset = useCallback((preset: Exclude<ActivePreset, 'custom'>) => {
        const p = A11Y_READING_PRESETS[preset];
        setSettings(s => ({ ...s, ...p, activePreset: preset }));
        // Nota: language se preserva (es ortogonal). cssVars y resolvedTheme
        // se recomputan por el useMemo upstream. Documento NO se re-renderiza
        // porque no recibe settings — solo las CSS vars heredadas cambian.
    }, []);

    // reset = aplicar preset 'standard' + language='es' + activePreset='standard'.
    // Reescribe TODO al baseline. Botón "Restaurar valores por defecto" del
    // dropdown lo invoca.
    const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

    return useMemo<ReadingSettingsApi>(() => ({
        settings,
        resolvedTheme,
        cssVars,
        setFontFamily,
        setFontSize,
        setSpacing,
        setTheme,
        setFocusRule,
        setLanguage,
        setPreset,
        reset,
    }), [settings, resolvedTheme, cssVars, setFontFamily, setFontSize, setSpacing, setTheme, setFocusRule, setLanguage, setPreset, reset]);
}
