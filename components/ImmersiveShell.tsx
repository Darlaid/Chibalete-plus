/**
 * ImmersiveShell — Phase 0 instant render for VisorInmersivo.
 *
 * Pure layout component: renders the teleprompter track immediately with
 * whatever sentences are available (including placeholder text).
 * Has ZERO async dependencies — no manifest, no audio, no access check.
 *
 * All state and orchestration lives in VisorInmersivo. This component
 * is a dumb render surface that accepts data as props.
 */

import React from 'react';

export interface ImmersiveShellProps {
  sentences: string[];
  currentIndex: number;
  isHydrating: boolean;            // true while real data is loading (non-blocking)
  translateY: number;
  containerRef: React.RefObject<HTMLDivElement>;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  theme: 'dark' | 'high-contrast';
  fontSize: 'sm' | 'base' | 'lg' | 'xl';
  lineSpacing: 'normal' | 'relaxed' | 'loose';
  onClickSentence: (idx: number) => void;
  heightCache: React.MutableRefObject<Map<number, number>>;
  lastMeasuredHeight: React.MutableRefObject<number>;
  /** QW-5: velocidad de reproducción del audio; escala la animación del scroll
   *  para que el movimiento visual se sienta acompasado con la lectura. */
  playbackSpeed?: number;
  /** F9: ref al div con transform translateY. El visor lo usa para
   *  revealActiveSentence — aplicar transform directo (sin esperar React
   *  re-render) cuando el validator detecta outside_viewport. */
  transformWrapperRef?: React.RefObject<HTMLDivElement | null>;
  /** M-5.4.6 (Phase 1.b.C Task 1) — tier de fit decidido por el visor a
   *  partir de medición geométrica real (NO por text.length). Valores:
   *  'normal' (base), 'long' (1 step down), 'very-long' (2 steps down +
   *  leading-snug). M-5.4.10 / TASK 2 extiende con 'emergency' (3 steps) y
   *  'scroll-safe' (terminal: clamp de altura + overflow interno → el texto
   *  NUNCA queda detrás de controles). El visor mide rect.bottom vs
   *  controlsTop y baja el tier por la escalera determinista. */
  activeFitTier?: 'normal' | 'long' | 'very-long' | 'emergency' | 'scroll-safe';
  /** M-5.4.10 / TASK 2 — px de banda segura para el clamp scroll-safe.
   *  Cuando activeFitTier==='scroll-safe' y este valor está seteado, el item
   *  activo recibe maxHeight + overflow-y:auto → cero overlap, cero oculto. */
  scrollSafeMaxPx?: number | null;
  /** M-5.4.10 / TASK 1 — cuántas frases SIGUIENTES mostrar como contexto
   *  legible (atenuado, NO destacado) cuando la activa es muy corta. VISUAL
   *  ONLY: NO adelanta playback, NO muta currentSentence. */
  densityContextLookahead?: number;
  /** M-5.4.10 / TASK 1 — modo de densidad ('normal'|'expanded'|'compacted'). */
  densityMode?: 'normal' | 'expanded' | 'compacted';
  /** M-5.4.10 / TASK 4 — duración (ms) de la transición translateY, decidida
   *  por el pacing PURO del visor (suaviza saltos / pasos). */
  scrollDurationMsOverride?: number;
}

const ImmersiveShell: React.FC<ImmersiveShellProps> = ({
  sentences,
  currentIndex,
  isHydrating,
  translateY,
  containerRef,
  itemRefs,
  theme,
  fontSize,
  lineSpacing,
  onClickSentence,
  heightCache,
  lastMeasuredHeight,
  playbackSpeed = 1,
  transformWrapperRef,
  activeFitTier = 'normal',  // M-5.4.6 (Phase 1.b.C Task 1)
  scrollSafeMaxPx = null,           // M-5.4.10 / TASK 2
  densityContextLookahead = 0,      // M-5.4.10 / TASK 1
  densityMode = 'normal',           // M-5.4.10 / TASK 1
  scrollDurationMsOverride,         // M-5.4.10 / TASK 4
}) => {
  // M-5.4.10 / TASK 4 — el pacing PURO del visor decide la duración (suaviza
  // saltos grandes y pasos pequeños). Fallback al comportamiento QW-5 previo
  // si no se provee override (back-compat: otros callers / tests).
  const scrollDurationMs = (typeof scrollDurationMsOverride === 'number' && scrollDurationMsOverride > 0)
    ? scrollDurationMsOverride
    : (playbackSpeed > 1
        ? Math.max(200, Math.round(500 / playbackSpeed))
        : 500);
  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center">
      <div ref={containerRef} className="w-full max-w-4xl h-full relative overflow-hidden">

        {/* Top fade gradient */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-neutral-950 to-transparent z-10 pointer-events-none" />
        {/* Bottom fade gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-neutral-950 to-transparent z-10 pointer-events-none" />

        {/* Non-blocking hydration indicator — tiny, never covers content */}
        {isHydrating && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 pointer-events-none">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs text-gray-400 font-mono">preparando audio...</span>
          </div>
        )}

        {/* Moving teleprompter track */}
        {/* FT-4: easing easeOutQuart — arranque más rápido, final gentil. Da sensación de "snap hacia la siguiente oración". */}
        <div
          ref={transformWrapperRef}
          className="w-full transition-transform ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateY(${translateY}px)`, transitionDuration: `${scrollDurationMs}ms` }}
        >
          {sentences.map((txt, idx) => {
            // Virtualization: only render DOM nodes near the reading position
            if (idx < currentIndex - 15 || idx > currentIndex + 15) {
              const computedHeight = heightCache.current.get(idx) ?? lastMeasuredHeight.current;
              return (
                <div
                  key={idx}
                  ref={el => { if (el) itemRefs.current[idx] = el; }}
                  data-sentence-index={idx}
                  data-sentence-item="true"
                  data-sentence-virtualized="true"
                  className="py-8 w-full"
                  style={{ height: computedHeight }}
                />
              );
            }

            const isActive = idx === currentIndex;

            // ────────────────────────────────────────────────────────────────
            // M-5.4.6 (Phase 1.b.C Task 1) — Adaptive geometric fit.
            //
            // El tier ahora viene del PROP `activeFitTier`, decidido por el
            // visor a partir de medición REAL del rect post-render. NO se
            // hereda de text.length (que ignoraba viewport mobile, accessibility
            // zoom, palabras largas, etc.).
            //
            // El visor empieza con 'normal' por defecto. Después del render,
            // mide rect.bottom vs controlsTop. Si overlap, baja por la
            // escalera determinista normal→long→very-long→emergency→
            // scroll-safe (M-5.4.10 / TASK 2). scroll-safe es terminal:
            // clamp de altura + overflow interno → el texto NUNCA queda
            // detrás de controles ni se oculta. Sin clipping ciego, sin
            // transform:scale, sin loops.
            //
            // Inactivos siempre usan el tier 'normal' (no participan del fit).
            // ────────────────────────────────────────────────────────────────
            const _tier = isActive ? activeFitTier : 'normal';

            // M-5.4.10 / TASK 1 — banda de CONTEXTO: cuando la frase activa es
            // muy corta, el visor pide mostrar las N siguientes como contexto
            // legible (atenuado, NO destacado). VISUAL ONLY: el playback NO se
            // adelanta, currentSentence NO cambia, el executor NO se toca.
            const _isContext = !isActive
                && densityMode === 'expanded'
                && idx > currentIndex
                && idx <= currentIndex + densityContextLookahead;

            // M-5.4.10 / TASK 2 — el tier scroll-safe acota la altura a la
            // banda segura (px provistos por el visor) con overflow-y interno.
            // Excepción DELIBERADA a "no maxHeight inline": es justamente la
            // garantía de overflow-zero (texto contenido y legible, jamás
            // detrás de controles). Solo aplica al item activo terminal.
            const _scrollSafeStyle: React.CSSProperties | undefined =
                (isActive && _tier === 'scroll-safe' && typeof scrollSafeMaxPx === 'number' && scrollSafeMaxPx > 0)
                    ? { maxHeight: scrollSafeMaxPx, overflowY: 'auto' }
                    : undefined;

            // Mapa de tamaños por preferencia + tier. Cada tier reduce 1-2
            // escalones de Tailwind respecto al base. emergency/scroll-safe =
            // el escalón más chico (texto siempre cabe / scrollea).
            const _smallestTier = _tier === 'emergency' || _tier === 'scroll-safe';
            const _activeSizeClass = (() => {
                if (fontSize === 'sm') {
                    if (_smallestTier)         return 'text-lg md:text-xl max-w-2xl';
                    if (_tier === 'very-long') return 'text-xl md:text-2xl max-w-2xl';
                    if (_tier === 'long')      return 'text-xl md:text-2xl max-w-2xl';
                    return                            'text-2xl md:text-3xl max-w-2xl';
                }
                if (fontSize === 'base') {
                    if (_smallestTier)         return 'text-lg md:text-xl max-w-3xl';
                    if (_tier === 'very-long') return 'text-xl md:text-2xl max-w-3xl';
                    if (_tier === 'long')      return 'text-2xl md:text-3xl max-w-3xl';
                    return                            'text-3xl md:text-5xl max-w-3xl';
                }
                if (fontSize === 'lg') {
                    if (_smallestTier)         return 'text-xl md:text-2xl max-w-4xl';
                    if (_tier === 'very-long') return 'text-2xl md:text-3xl max-w-4xl';
                    if (_tier === 'long')      return 'text-3xl md:text-4xl max-w-4xl';
                    return                            'text-4xl md:text-6xl max-w-4xl';
                }
                // fontSize === 'xl'
                if (_smallestTier)         return 'text-2xl md:text-3xl max-w-5xl';
                if (_tier === 'very-long') return 'text-3xl md:text-4xl max-w-5xl';
                if (_tier === 'long')      return 'text-4xl md:text-5xl max-w-5xl';
                return                            'text-5xl md:text-7xl max-w-5xl';
            })();
            const _inactiveSizeClass = (() => {
                if (fontSize === 'sm')   return 'text-lg md:text-xl max-w-2xl';
                if (fontSize === 'base') return 'text-xl md:text-3xl max-w-3xl';
                if (fontSize === 'lg')   return 'text-2xl md:text-4xl max-w-4xl';
                return                          'text-3xl md:text-5xl max-w-5xl';  // xl
            })();
            // Tier muy reducido → leading más compacto.
            const _leadingClass = (() => {
                if (isActive && (_tier === 'very-long' || _smallestTier)) return 'leading-snug';
                if (lineSpacing === 'normal')  return 'leading-normal';
                if (lineSpacing === 'relaxed') return 'leading-relaxed';
                return                                 'leading-loose';
            })();
            const _len = txt?.length ?? 0;

            return (
              <div
                key={idx}
                ref={el => {
                  if (el) {
                    itemRefs.current[idx] = el;
                    if (el.clientHeight > 0) {
                      heightCache.current.set(idx, el.clientHeight);
                      lastMeasuredHeight.current = el.clientHeight;
                    }
                  }
                }}
                onClick={() => onClickSentence(idx)}
                // INV-18 active sentence contract — attrs verificables por DOM.
                data-sentence-index={idx}
                data-sentence-item="true"
                data-active-sentence={isActive ? 'true' : 'false'}
                data-sentence-len={_len}
                data-active-size-tier={isActive ? _tier : undefined}
                aria-current={isActive ? 'true' : undefined}
                data-density-context={_isContext ? 'true' : undefined}
                // M-5.4.6 (Task 2) — NO style inline salvo el clamp scroll-safe
                // terminal (M-5.4.10 / TASK 2): única excepción deliberada,
                // garantiza overflow-zero. El resto se reduce por class swap.
                style={_scrollSafeStyle}
                className={`
                  immersive-sentence-item
                  ${isActive ? 'immersive-sentence-active' : ''}
                  py-8 px-8 text-center cursor-pointer
                  ${isActive
                      ? 'transition-none opacity-100 blur-none'
                      : _isContext
                        ? 'transition-all duration-500 opacity-60 blur-none'
                        : 'transition-all duration-500 opacity-20 scale-95 blur-[1px]'}
                `}
              >
                <p className={`
                  font-serif mx-auto transition-colors duration-300
                  ${_leadingClass}
                  ${theme === 'high-contrast'
                    ? (isActive ? 'text-yellow-400 font-bold' : _isContext ? 'text-neutral-400' : 'text-neutral-600')
                    : (isActive ? 'text-white font-semibold' : _isContext ? 'text-gray-400' : 'text-gray-500')}
                  ${isActive ? _activeSizeClass : _inactiveSizeClass}
                `}>
                  {txt}
                </p>
              </div>
            );
          })}

          {/* Bottom padding so last sentence can scroll to center */}
          <div className="h-[50vh]" />
        </div>
      </div>
    </div>
  );
};

export default ImmersiveShell;
