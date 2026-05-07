/**
 * A11yShell — esqueleto semántico del Modo accesible.
 *
 * Provee la estructura HTML de landmarks que el visor accesible expone al
 * usuario y al lector de pantalla. Es el único punto de la app a11y donde
 * se definen los landmarks raíz (banner / main). El landmark `contentinfo`
 * fue eliminado al consolidar el progreso global dentro del header.
 *
 * FASE 2 (post-G1) — orquesta loading/error/book y delega:
 *   - <A11ySkipLinks/>          → enlaces de salto a destinos REALES
 *   - <A11yTableOfContents/>    → índice del libro
 *   - <A11yDocument/>           → renderiza el libro estructurado
 *   - <A11yLiveRegion/>         → regiones aria-live
 *
 * Decisiones post-auditoría G1:
 *   - Eliminados <aside id="a11y-settings"> y <section id="a11y-audio">.
 *     Eran landmarks anunciados con texto "próximamente" — UX hostil para
 *     usuarios de lector de pantalla. Volverán a aparecer en sus fases
 *     respectivas (Settings → Fase 2 plan ajustado, Audio → Fase 4) con
 *     contenido funcional desde el primer commit visible.
 *   - Eliminados los botones "Ajustes" y "Atajos" del header — no había
 *     destinos reales que justificaran su anuncio en el árbol de accesibilidad.
 *
 * Reglas WCAG 2.2 cumplidas en esta fase:
 *   1.3.1 Info and Relationships — landmarks + jerarquía de headings
 *   1.3.2 Meaningful Sequence    — orden DOM = orden lectura
 *   2.1.1 Keyboard                — focos nativos o tabIndex=-1
 *   2.4.1 Bypass Blocks           — A11ySkipLinks operativos a destinos reales
 *   2.4.3 Focus Order             — Tab linealmente recorre lo focuseable
 *   2.4.4 Link Purpose            — TOC links con texto descriptivo
 *   2.4.6 Headings and Labels     — exactamente una <h1> en cada estado
 *   2.4.7 Focus Visible           — outline garantizado en cada elemento
 *   3.1.1 Language of Page        — heredado de <html lang="es">
 *   4.1.2 Name, Role, Value       — botones nativos, landmarks etiquetados
 *   4.1.3 Status Messages         — loading con aria-busy, error con role="alert"
 */

import React from 'react';
import { ChevronLeft } from 'lucide-react';
import A11ySkipLinks from './A11ySkipLinks';
import A11yLiveRegion from './A11yLiveRegion';
import A11yDocument from './A11yDocument';
import A11ySidebar from './A11ySidebar';
import A11yFocusRuleOverlay from './A11yFocusRuleOverlay';
import A11yDebugSegments, { isA11yDebugEnabled } from './A11yDebugSegments';
import { PixelButton } from './pixel/PixelButton';
import type { A11yBook } from '../../types/a11y';
import type { ReaderNavigationApi } from '../../hooks/useA11yReaderNavigation';
import type { ReadingSettingsApi, ReadingLanguage } from '../../hooks/useA11yReadingSettings';
import type { ReadingSegment } from '../../utils/readingSegments';

/**
 * <style> scoped inyectado una sola vez como nodo del árbol del shell.
 *
 * Las reglas son ESTÁTICAS — los valores variables se inyectan vía
 * `style={cssVars}` en el div root con CSS custom properties. El browser
 * reaplica los estilos al subárbol cuando las vars cambian, sin re-render
 * de React.
 *
 * Selector raíz: `[data-a11y-shell-root]`. Aísla todo el sistema al shell
 * — no contamina el resto de la app aunque se mantenga en memoria.
 *
 * Regla focal (UX-3A): la atenuación per-paragraph (opacity 0.35/0.7/1
 * sobre `.a11y-focus-primary` / `.a11y-focus-secondary`) fue removida.
 * Ahora la herramienta es un viewport-band real implementado en
 * <A11yFocusRuleOverlay/> con dos backdrops fixed semi-transparentes y
 * una ventana central. Ver ese componente para detalles.
 */
const A11Y_STYLE_BLOCK = `
[data-a11y-shell-root] {
    background-color: var(--a11y-bg);
    color: var(--a11y-text);
    font-family: var(--a11y-font-family);
}
[data-a11y-shell-root] article {
    font-size: var(--a11y-font-size);
    line-height: var(--a11y-line-height);
    letter-spacing: var(--a11y-letter-spacing);
}
[data-a11y-shell-root] article p {
    margin-bottom: var(--a11y-paragraph-spacing);
}

/* UX-3B — prefers-reduced-motion. Honor explícito de la preferencia del SO
   para usuarios con sensibilidad vestibular o cognitiva. Aplica al subárbol
   del visor accesible: anula el fade del overlay de la Regla focal (120ms)
   y los micro-translates / transitions del PixelButton. Si el usuario no
   pidió reducción, todo sigue igual. */
@media (prefers-reduced-motion: reduce) {
    [data-a11y-shell-root],
    [data-a11y-shell-root] *,
    [data-a11y-shell-root] *::before,
    [data-a11y-shell-root] *::after {
        transition-duration: 0ms !important;
        animation-duration: 0ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
    }
}
`;

interface A11yShellProps {
    book: A11yBook | null;
    loading: boolean;
    error: string | null;
    /**
     * Sprint Data Backbone — Fase 1.
     * Callback opcional para registrar cada <p> del documento con el
     * IntersectionObserver del hook useA11yAnalytics. Si está ausente,
     * el documento se renderiza igual pero sin telemetría — útil para
     * quien quiera reusar A11yShell sin analytics (no es el caso por
     * default, pero mantiene la independencia entre capa de UI y de medición).
     */
    observeParagraph?: (el: Element | null, paragraphId: string) => void;
    /**
     * Callback de "Volver a la ficha del libro". Inyectado por VisorAccesible
     * para que la navegación NO dependa del historial del browser
     * (`navigate(-1)` puede llevar a un sitio inesperado). El componente
     * no decide la ruta — solo el evento.
     */
    onBack: () => void;
    /**
     * UX-3B — callback opcional para reintentar la carga del libro cuando
     * el fetch del texto plano falla (red caída, 5xx, parse). Si se provee,
     * la pantalla de error muestra un botón "Reintentar". Si no, sólo el
     * mensaje y "Volver".
     */
    onRetryLoad?: () => void;
    /**
     * API de navegación de lectura del hook useA11yReaderNavigation. Solo se
     * monta el componente si totalParagraphs > 0 (lo decide A11yReaderNavigation).
     */
    navigation: ReaderNavigationApi;
    /**
     * API de preferencias de lectura del hook useA11yReadingSettings.
     * Aplicar `settingsApi.cssVars` en `style={...}` del root reaplica
     * fuente/tamaño/espaciado/tema al subárbol completo sin re-render.
     */
    settingsApi: ReadingSettingsApi;
    /**
     * Idiomas DISPONIBLES para el libro actual (deducidos de los campos
     * texto_*_url del Content). Determina qué radios del dropdown de idioma
     * se renderizan habilitados.
     */
    availableLanguages: ReadonlyArray<ReadingLanguage>;
    /**
     * UX-4B — segmentos calculados (mismas refs que consume `navigation`).
     * Solo se usan para el overlay de diagnóstico `?a11ydebug=1`. En
     * producción normal este array nunca se renderiza directamente: el
     * shell delega su uso a través de `navigation` (currentSegmentIndex,
     * totalSegments). Pasarlo permite que el overlay muestre detalle
     * por-segmento sin que el shell tenga que recalcularlo.
     */
    segments: ReadonlyArray<ReadingSegment>;
}

const A11yShell: React.FC<A11yShellProps> = ({ book, loading, error, observeParagraph, onBack, onRetryLoad, navigation, settingsApi, availableLanguages, segments }) => {
    const debugEnabled = isA11yDebugEnabled();
    const showDocument = !loading && !error && book !== null;
    const showLoading = loading;
    const showError = !loading && error !== null;

    return (
        <div
            data-a11y-shell-root=""
            data-a11y-mode={settingsApi.resolvedTheme}
            data-a11y-focus-rule={settingsApi.settings.focusRule ? 'on' : 'off'}
            style={settingsApi.cssVars}
            className="min-h-screen flex flex-col"
        >
            {/* Block CSS scoped: aplica las CSS vars del root + reglas de la
                regla focal. Estático — no causa re-render. */}
            <style dangerouslySetInnerHTML={{ __html: A11Y_STYLE_BLOCK }} />

            {/* Skip links: primer Tab los revela */}
            <A11ySkipLinks />

            {/* HEADER (banner) — consola de lectura del Modo accesible.
                Tres zonas:
                  · izquierda: botón "Volver" (siempre visible, también en
                    loading/error — el user debe poder salir del visor).
                  · centro: etiqueta "Modo accesible" (eyebrow uppercase) +
                    título del libro cuando ya cargó. NO es <h1>: el único
                    h1 sigue viviendo dentro de <main> para mantener la
                    jerarquía de headings que arman los lectores de pantalla.
                  · derecha: lectura "% leído" tabular.
                Una barra de progreso fina abajo cierra el header como
                "consola" — sustituye al antiguo footer global. */}
            <header
                role="banner"
                aria-label="Modo accesible"
                // Hybrid header (UX-2B): mantenemos banner respirable —
                // NO PixelPanel para no convertirlo en banner pesado. El
                // border-b-2 con la paleta del sistema pixel (gray-300/700,
                // mismos tokens que PixelPanel) crea continuidad visual con
                // los paneles de la sidebar sin encajonar el header.
                //
                // UX-3A — relative z-20: el header debe quedar sobre los
                // backdrops fixed de la Regla focal (z-10), si no se ve
                // veil-cubierto al activar focus rule estando scrolleado al
                // top. La sidebar ya está en z-30, queda sobre todo.
                className="relative z-20 border-b-2 border-gray-300 dark:border-gray-700"
            >
                <div className="w-full max-w-6xl mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        {/* Volver — PixelButton neutral md. Stamp shadow leve
                            + active "se hunde": feedback táctil sin ser gamer.
                            En mobile ocultamos el label visible (el aria-label
                            sigue siendo la fuente del nombre accesible). */}
                        <PixelButton
                            onClick={onBack}
                            tone="neutral"
                            size="md"
                            icon={ChevronLeft}
                            aria-label="Volver a la página del libro"
                            className="shrink-0"
                        >
                            <span className="hidden sm:inline">Volver</span>
                        </PixelButton>

                        <div className="flex-1 min-w-0 text-center">
                            <p className="text-[11px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-gray-600 dark:text-gray-400">
                                Modo accesible
                            </p>
                            {book && (
                                <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {book.title}
                                </p>
                            )}
                        </div>

                        <p
                            className="shrink-0 min-w-[3.25rem] text-right text-xs tabular-nums text-gray-600 dark:text-gray-400"
                            aria-hidden="true"
                        >
                            {navigation.totalParagraphs > 0 ? `${navigation.progressPercent}%` : '—'}
                        </p>
                    </div>

                    <progress
                        max={100}
                        value={navigation.totalParagraphs > 0 ? navigation.progressPercent : 0}
                        aria-label="Progreso de lectura"
                        className="block w-full h-1 mt-3"
                    >
                        {navigation.progressPercent}%
                    </progress>
                </div>
            </header>

            {/* CUERPO PRINCIPAL: main + sidebar derecha sticky (en mobile,
                la sidebar se transforma en barra inferior fija).

                pb-[55vh] md:pb-14 (UX-3B): el padding bottom mobile coincide
                con la altura máxima real de la sidebar mobile (max-h-[50vh]
                + un pelo de holgura). El valor previo pb-40 (160px) era
                MENOR que la sidebar expandida, así que el final del libro
                quedaba tapado y no era scrolleable a la vista. Crítico para
                que el último párrafo siempre se pueda leer.

                La SIDEBAR se monta SIEMPRE (no condicional al showDocument)
                — el panel Lectura debe estar accesible también en estados
                loading y error. La sidebar misma decide qué bloques internos
                mostrar según hay book o no.

                Se aumentaron py-8→py-10 md:py-14 y gap md:gap-8→md:gap-12
                para que el panel acompañe la lectura con más respiración
                visual y no se sienta "pegado" al cuerpo del libro. */}
            <div
                className={[
                    'flex-1 w-full max-w-6xl mx-auto',
                    'px-6 py-10 md:py-14 pb-[55vh] md:pb-14',
                    'flex flex-col md:flex-row md:items-start md:gap-12',
                ].join(' ')}
            >
                {/* MAIN: contenido del libro o estado loading/error.
                    role="main" explícito por defensiva (redundante con <main>). */}
                <main
                    id="a11y-main"
                    role="main"
                    tabIndex={-1}
                    aria-label="Contenido del libro"
                    aria-busy={showLoading || undefined}
                    className="flex-1 min-w-0 max-w-3xl mx-auto md:mx-0 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2"
                >
                    {showLoading && (
                        <>
                            <h1 className="text-2xl font-bold mb-3">
                                Cargando libro accesible…
                            </h1>
                            <p role="status" className="text-gray-700 dark:text-gray-300">
                                Estamos preparando el contenido del libro. Esto puede tardar
                                unos segundos según tu conexión.
                            </p>
                        </>
                    )}

                    {showError && (
                        <div role="alert">
                            <h1 className="text-2xl font-bold mb-3">
                                No se pudo cargar el libro
                            </h1>
                            <p className="text-gray-700 dark:text-gray-300 mb-4">{error}</p>
                            {/* UX-3B — Reintentar: la pantalla de error YA NO termina
                                la sesión. El usuario puede reintentar el fetch sin
                                reload manual. Si onRetryLoad no se provee (uso fuera
                                del visor), se omite el botón. */}
                            {onRetryLoad && (
                                <PixelButton
                                    onClick={onRetryLoad}
                                    tone="neutral"
                                    size="md"
                                >
                                    Reintentar
                                </PixelButton>
                            )}
                        </div>
                    )}

                    {showDocument && (
                        <A11yDocument book={book!} observeParagraph={observeParagraph} />
                    )}
                </main>

                {/* SIDEBAR: controles de lectura siempre visibles.
                    Pasa `book` (puede ser null durante loading/error) y la
                    sidebar gestiona internamente los bloques que requieren
                    contenido cargado (navegación, índice). */}
                <A11ySidebar
                    book={book}
                    navigation={navigation}
                    settingsApi={settingsApi}
                    availableLanguages={availableLanguages}
                />
            </div>

            {/* Footer eliminado: el progreso global ahora vive como barra fina
                en el header. El antiguo <footer role="contentinfo"> sólo
                duplicaba la misma <progress> con la misma data — sin aporte
                semántico distinto. WCAG 2.2 AA no exige contentinfo. */}

            {/* Regla focal (UX-3A): siempre montada — el toggle es opacity
                CSS-driven via [data-a11y-focus-rule="on"]. Tres elementos
                fixed + transición opacity 120ms linear. Ver
                A11yFocusRuleOverlay para arquitectura. */}
            <A11yFocusRuleOverlay />

            {/* Live regions: presentes desde el primer render */}
            <A11yLiveRegion />

            {/* UX-4B — overlay de diagnóstico de segmentación. Solo se monta
                con `?a11ydebug=1` en la URL. En producción normal el costo
                es 1 lectura de window.location.search en cada render del
                shell, sin árbol React detrás. aria-hidden interno: nunca
                contamina el árbol de accesibilidad. */}
            {debugEnabled && (
                <A11yDebugSegments
                    book={book}
                    segments={segments}
                    currentSegmentIndex={navigation.currentSegmentIndex}
                />
            )}
        </div>
    );
};

export default A11yShell;
