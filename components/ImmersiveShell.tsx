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
}) => {
  // QW-5: a speeds > 1 acortar proporcionalmente la transición del translateY para que
  // la animación no quede rezagada respecto al audio. Piso de 200ms para preservar easing.
  // Speeds <= 1 mantienen los 500ms originales (no acelerar el silencio visual).
  const scrollDurationMs = playbackSpeed > 1
    ? Math.max(200, Math.round(500 / playbackSpeed))
    : 500;
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
                  className="py-8 w-full"
                  style={{ height: computedHeight }}
                />
              );
            }

            const isActive = idx === currentIndex;

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
                // El validator en VisorInmersivo busca [data-active-sentence="true"]
                // y exige exactamente UNO cuyo data-sentence-index === currentIndex.
                data-sentence-index={idx}
                data-active-sentence={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'true' : undefined}
                className={`
                  py-8 px-8 text-center transition-all duration-500 cursor-pointer
                  ${isActive ? 'opacity-100 scale-105 blur-none' : 'opacity-20 scale-95 blur-[1px]'}
                `}
              >
                <p className={`
                  font-serif mx-auto transition-colors duration-300
                  ${lineSpacing === 'normal' ? 'leading-normal' : lineSpacing === 'relaxed' ? 'leading-relaxed' : 'leading-loose'}
                  ${theme === 'high-contrast'
                    ? (isActive ? 'text-yellow-400 font-bold' : 'text-neutral-600')
                    : (isActive ? 'text-white font-semibold' : 'text-gray-500')}
                  ${fontSize === 'sm' ? (isActive ? 'text-2xl md:text-3xl max-w-2xl' : 'text-lg md:text-xl max-w-2xl') : ''}
                  ${fontSize === 'base' ? (isActive ? 'text-3xl md:text-5xl max-w-3xl' : 'text-xl md:text-3xl max-w-3xl') : ''}
                  ${fontSize === 'lg' ? (isActive ? 'text-4xl md:text-6xl max-w-4xl' : 'text-2xl md:text-4xl max-w-4xl') : ''}
                  ${fontSize === 'xl' ? (isActive ? 'text-5xl md:text-7xl max-w-5xl' : 'text-3xl md:text-5xl max-w-5xl') : ''}
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
