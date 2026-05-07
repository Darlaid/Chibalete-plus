/**
 * A11yReadingSettings — control de lectura del Modo accesible.
 *
 * Patrón: trigger button + dialog panel. NO menubar/menuitemradio, porque:
 *   - menubar requiere navegación con flechas + Home/End/Tab — más código
 *     custom + más superficie de bugs.
 *   - dialog con <fieldset><legend> y <input type="radio"> es 100% nativo,
 *     funciona en todos los lectores de pantalla, no requiere overrides.
 *
 * Comportamiento:
 *   - Botón "Lectura" abre un panel inline-absolute debajo del trigger.
 *   - El panel es role="dialog" con aria-label="Ajustes de lectura".
 *   - Tab navega entre controles dentro del panel.
 *   - Escape cierra (foco vuelve al trigger).
 *   - Click fuera del panel y del trigger cierra (no se considera "abrir
 *     el dropdown" como mover foco fuera de él hasta que el user actúe).
 *
 * 5 ejes:
 *   - Fuente            (radio group)
 *   - Tamaño de texto   (radio group)
 *   - Espaciado         (radio group)
 *   - Modo (theme)      (radio group)
 *   - Regla focal       (checkbox)
 *
 * Cero animaciones (ticket lo prohíbe + cero motion respeta sensibilidad
 * vestibular sin necesidad de honrar prefers-reduced-motion).
 *
 * No es un overlay sobre el contenido del libro — el panel se ancla al
 * banner del shell. El contenido del libro queda intacto por debajo.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { PixelButton } from './pixel/PixelButton';
import { PIXEL_PANEL_CLASSES } from './pixel/PixelPanel';
import type {
    ReadingSettingsApi,
    FontFamily,
    FontSize,
    Spacing,
    Theme,
    ReadingLanguage,
    ActivePreset,
} from '../../hooks/useA11yReadingSettings';

interface A11yReadingSettingsProps {
    api: ReadingSettingsApi;
    /**
     * Idiomas DISPONIBLES para el libro actual. Determinado por VisorAccesible
     * a partir de la presencia de content.texto_plano_url / texto_ingles_url.
     * El radio de un idioma no disponible se renderiza disabled con hint.
     *
     * Default ['es'] si no se pasa — el flujo conservador.
     */
    availableLanguages?: ReadonlyArray<ReadingLanguage>;
    /**
     * Alineación del panel respecto al trigger (solo aplica con
     * placement='absolute').
     *   - 'left'  (default): se ancla a la izquierda, se extiende a la derecha.
     *   - 'right': se ancla a la derecha, se extiende a la izquierda.
     *
     * En mobile (sm <), ambos modos ocupan todo el ancho del padre.
     */
    align?: 'left' | 'right';
    /**
     * Posicionamiento del panel cuando está abierto.
     *   - 'absolute' (default): position:absolute z-50, flotante sobre
     *     contenido vecino. Útil cuando el trigger está en un banner o área
     *     que no debe expandirse al abrir.
     *   - 'inline': el panel se renderiza en el flujo normal del padre. Sin
     *     position absolute. Pensado para sidebar — el contenedor padre
     *     maneja el scroll global, evita que el panel quede recortado por
     *     overflow del padre.
     */
    placement?: 'absolute' | 'inline';
    /**
     * Modo controlado opcional (use junto con onOpenChange). Si se pasa,
     * el componente delega el state al padre — útil para mutual exclusion
     * con otros desplegables (TOC en sidebar mobile).
     *
     * Si NO se pasa, mantiene state interno (uncontrolled, default actual).
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

// Etiquetas legibles. Mantenerlas localizadas en español por convención
// del producto (CLAUDE.md). Si el día de mañana se internacionaliza, el
// componente acepta un prop `labels` o se conecta a i18n.
// "Personalizado" siempre va disabled — refleja state, NO se selecciona.
// Los otros 4 son seleccionables y disparan setPreset.
const PRESET_OPTIONS: Array<{
    value:    ActivePreset;
    label:    string;
    hint?:    string;
}> = [
    { value: 'standard',  label: 'Estándar',           hint: 'Configuración neutra.' },
    { value: 'dyslexia',  label: 'Dislexia',           hint: 'OpenDyslexic, mayor espaciado.' },
    { value: 'focus',     label: 'Alta concentración', hint: 'Lexend, modo oscuro y regla focal.' },
    { value: 'lowVision', label: 'Baja visión',        hint: 'Texto extra grande y muy espaciado.' },
    { value: 'custom',    label: 'Personalizado',      hint: 'Aparece al cambiar opciones manualmente.' },
];

const FONT_OPTIONS: Array<{ value: FontFamily; label: string; hint?: string }> = [
    { value: 'system',       label: 'Predeterminada',  hint: 'Fuente del sistema' },
    { value: 'openDyslexic', label: 'OpenDyslexic',    hint: 'Optimizada para dislexia' },
    { value: 'lexend',       label: 'Lexend',          hint: 'Optimizada para fluidez' },
    { value: 'dyslexie',     label: 'Dyslexie',        hint: 'Si tienes la fuente instalada' },
    { value: 'arial',        label: 'Arial' },
    { value: 'verdana',      label: 'Verdana' },
];

const SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
    { value: 'small',  label: 'Pequeño' },
    { value: 'medium', label: 'Medio' },
    { value: 'large',  label: 'Grande' },
    { value: 'xl',     label: 'Extra grande' },
];

const SPACING_OPTIONS: Array<{ value: Spacing; label: string }> = [
    { value: 'normal',    label: 'Normal' },
    { value: 'wide',      label: 'Amplio' },
    { value: 'extraWide', label: 'Extra amplio' },
];

const THEME_OPTIONS: Array<{ value: Theme; label: string; hint?: string }> = [
    { value: 'system', label: 'Sistema', hint: 'Sigue tu preferencia del OS' },
    { value: 'light',  label: 'Claro' },
    { value: 'dark',   label: 'Oscuro' },
];

// BTN_BASE eliminado: el trigger Lectura ahora usa PixelButton.

const A11yReadingSettings: React.FC<A11yReadingSettingsProps> = ({
    api,
    availableLanguages = ['es'],
    align = 'left',
    placement = 'absolute',
    open: openProp,
    onOpenChange,
}) => {
    // Modo dual: controlled (si openProp se pasa) o uncontrolled (state local).
    // Cuando es controlled, mantenemos un setState interno para no romper la
    // reactividad de useEffect, pero siempre delegamos al callback del padre
    // para que él decida la fuente de verdad.
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = openProp !== undefined;
    const open = isControlled ? openProp : internalOpen;

    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef   = useRef<HTMLDivElement   | null>(null);
    const panelId    = useId();

    const setOpen = useCallback((next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        onOpenChange?.(next);
    }, [isControlled, onOpenChange]);

    const close = useCallback(() => {
        setOpen(false);
        // Devolver foco al trigger (patrón estándar dialog).
        // Esperamos al próximo frame por si el panel desmonta primero.
        requestAnimationFrame(() => triggerRef.current?.focus());
    }, [setOpen]);

    const toggle = useCallback(() => setOpen(!open), [setOpen, open]);

    // Escape cierra. También Tab fuera del panel cierra (focus management
    // estándar de dialog inline). Solo añadimos Escape — Tab natural permite
    // al user salir del panel sin cerrar; click fuera lo cierra.
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, close]);

    // Click fuera (mousedown para que dispare antes que un focus event
    // dentro del panel pudiera cancelar). Ignora clicks en el trigger
    // porque ya tiene su propio handler.
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (panelRef.current?.contains(target))   return;
            if (triggerRef.current?.contains(target)) return;
            close();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, close]);

    // Al abrir, mover foco al primer focusable dentro del panel. Patrón
    // canónico WAI-ARIA APG para dialog.
    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => {
            const firstInput = panelRef.current?.querySelector<HTMLElement>(
                'input, button, select, [tabindex]:not([tabindex="-1"])'
            );
            firstInput?.focus();
        });
    }, [open]);

    const { settings, setFontFamily, setFontSize, setSpacing, setTheme, setFocusRule, setLanguage, setPreset, reset } = api;

    // Construimos las opciones de preset con disabled real para 'custom'.
    // Solo los 4 presets nombrados son seleccionables; 'custom' refleja
    // estado pero no se puede activar manualmente — el user solo llega ahí
    // cambiando un setting individual.
    const presetOptions = PRESET_OPTIONS.map(opt => ({
        ...opt,
        disabled: opt.value === 'custom',
    }));

    // Wrapper sobre setPreset que respeta el tipo (excluye 'custom').
    // Si por algún edge case llega 'custom' (no debería porque está disabled),
    // se ignora silenciosamente.
    const handlePresetChange = (value: ActivePreset) => {
        if (value === 'custom') return;
        setPreset(value);
    };

    // Las opciones de idioma son fijas ('es' siempre, 'en' opcional). El
    // disabled HTML real saca el radio del orden de Tab y NVDA lo anuncia
    // como "deshabilitado". El hint explica POR QUÉ.
    const languageOptions: Array<{
        value: ReadingLanguage;
        label: string;
        hint?: string;
        disabled: boolean;
    }> = [
        {
            value:    'es',
            label:    'Español',
            disabled: !availableLanguages.includes('es'),
        },
        {
            value:    'en',
            label:    'English',
            hint:     availableLanguages.includes('en')
                ? undefined
                : 'Sin traducción disponible para este libro',
            disabled: !availableLanguages.includes('en'),
        },
    ];

    // El wrapper relative es necesario en placement='absolute' para anclar
    // el panel flotante. En placement='inline' (uso típico en sidebar) lo
    // pasamos a block w-full para que el trigger PixelButton pueda
    // estirarse al ancho del contenedor.
    return (
        <div className={`relative ${placement === 'inline' ? 'block w-full' : 'inline-block'}`}>
            {/* Trigger Lectura — PixelButton neutral md. El stamp shadow
                y el press translate son el feedback táctil.
                w-full sólo en placement='inline'; en absolute mantenemos
                el ancho natural del trigger porque vive en banner/header.

                UX-3B — `aria-haspopup="dialog"` removido: el panel ya no usa
                role="dialog" (no es modal — Tab puede salir, no hay focus
                trap, ni inert background). Como disclosure region, sólo
                aria-expanded + aria-controls (que pasan al <button> nativo
                vía spread de props) bastan. NVDA/VoiceOver dejan de entrar
                en "forms mode" esperando comportamiento modal. */}
            <PixelButton
                ref={triggerRef}
                onClick={toggle}
                aria-expanded={open}
                aria-controls={panelId}
                tone="neutral"
                size="md"
                className={placement === 'inline' ? 'w-full' : ''}
            >
                Lectura
                {open
                    ? <ChevronUp size={20} aria-hidden="true" />
                    : <ChevronDown size={20} aria-hidden="true" />}
            </PixelButton>

            {open && (
                <div
                    ref={panelRef}
                    id={panelId}
                    role="region"
                    aria-label="Ajustes de lectura"
                    // UX-2B — coherencia con el sistema PixelPanel:
                    //
                    // - absolute (header / banner): el dialog flota sobre la
                    //   página. Necesita identidad propia → adopta
                    //   PIXEL_PANEL_CLASSES (border-2 + bg + rounded-md +
                    //   stamp shadow) y suma una elevación extra (shadow-2xl)
                    //   para destacar sobre lo que tape.
                    //
                    // - inline (sidebar): el dialog ya vive DENTRO de un
                    //   PixelPanel padre. Repetir border + bg + shadow sería
                    //   un panel-dentro-de-panel ruidoso. En vez de eso:
                    //   dialog "fundido" con el panel padre, separado del
                    //   trigger sólo con un border-top sutil. Sin bg, sin
                    //   shadow — la jerarquía la da el panel ancestro.
                    className={[
                        placement === 'absolute' ? 'absolute z-50 mt-2' : 'relative mt-3 pt-3',
                        placement === 'absolute' ? 'left-0 right-0' : '',
                        placement === 'absolute'
                            ? (align === 'right'
                                ? 'sm:left-auto sm:right-0 sm:w-96'
                                : 'sm:right-auto sm:left-0 sm:w-96')
                            : 'w-full',
                        // Coherencia visual con el sistema pixel.
                        placement === 'absolute'
                            ? `${PIXEL_PANEL_CLASSES} shadow-2xl`
                            : 'border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100',
                        // Anti-desborde — solo aplica en absolute. En inline
                        // el contenedor padre (sidebar) maneja el scroll
                        // global; evitamos generar un scroll anidado.
                        placement === 'absolute'
                            ? 'max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain'
                            : '',
                    ].filter(Boolean).join(' ')}
                >
                    <div className="flex items-baseline justify-between mb-3">
                        <p className="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                            Ajustes de lectura
                        </p>
                        <button
                            type="button"
                            onClick={close}
                            aria-label="Cerrar ajustes de lectura"
                            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2"
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <RadioGroup
                            legend="Perfil de lectura"
                            name="a11y-preset"
                            value={settings.activePreset}
                            options={presetOptions}
                            onChange={handlePresetChange}
                        />
                        <RadioGroup
                            legend="Idioma de lectura"
                            name="a11y-language"
                            value={settings.language}
                            options={languageOptions}
                            onChange={setLanguage}
                        />
                        <RadioGroup
                            legend="Fuente"
                            name="a11y-font-family"
                            value={settings.fontFamily}
                            options={FONT_OPTIONS}
                            onChange={setFontFamily}
                        />
                        <RadioGroup
                            legend="Tamaño de texto"
                            name="a11y-font-size"
                            value={settings.fontSize}
                            options={SIZE_OPTIONS}
                            onChange={setFontSize}
                        />
                        <RadioGroup
                            legend="Espaciado"
                            name="a11y-spacing"
                            value={settings.spacing}
                            options={SPACING_OPTIONS}
                            onChange={setSpacing}
                        />
                        <RadioGroup
                            legend="Modo"
                            name="a11y-theme"
                            value={settings.theme}
                            options={THEME_OPTIONS}
                            onChange={setTheme}
                        />

                        <fieldset className="border-t border-gray-200 dark:border-gray-700 pt-3">
                            <legend className="sr-only">Regla focal</legend>
                            <label className="flex items-start gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.focusRule}
                                    onChange={(e) => setFocusRule(e.target.checked)}
                                    className="mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2"
                                />
                                <span className="text-sm">
                                    <span className="font-medium block">Regla focal</span>
                                    <span className="text-gray-600 dark:text-gray-400 text-xs">
                                        Crea una ventana central de lectura y atenúa el resto del documento.
                                    </span>
                                </span>
                            </label>
                        </fieldset>

                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <button
                                type="button"
                                onClick={reset}
                                className="text-xs text-gray-600 dark:text-gray-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2 rounded"
                            >
                                Restaurar valores por defecto
                            </button>
                            <button
                                type="button"
                                onClick={close}
                                className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ── RadioGroup interno ──────────────────────────────────────────────────────

interface RadioOption<T extends string> {
    value:     T;
    label:     string;
    hint?:     string;
    /** Si true, el <input> recibe `disabled` HTML real. */
    disabled?: boolean;
}

interface RadioGroupProps<T extends string> {
    legend:   string;
    name:     string;
    value:    T;
    options:  ReadonlyArray<RadioOption<T>>;
    onChange: (v: T) => void;
}

function RadioGroup<T extends string>({ legend, name, value, options, onChange }: RadioGroupProps<T>): React.ReactElement {
    return (
        <fieldset>
            <legend className="text-sm font-medium mb-2">{legend}</legend>
            <div className="grid grid-cols-2 gap-1">
                {options.map(opt => {
                    const isDisabled = opt.disabled === true;
                    return (
                        <label
                            key={opt.value}
                            className={[
                                'flex items-start gap-2 px-2 py-1.5 rounded',
                                isDisabled
                                    ? 'cursor-not-allowed opacity-60'
                                    : 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800',
                            ].join(' ')}
                        >
                            <input
                                type="radio"
                                name={name}
                                value={opt.value}
                                checked={value === opt.value}
                                disabled={isDisabled}
                                onChange={() => onChange(opt.value)}
                                className="mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2"
                            />
                            <span className="text-sm">
                                <span className="block">{opt.label}</span>
                                {opt.hint && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {opt.hint}
                                    </span>
                                )}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}

export default A11yReadingSettings;
