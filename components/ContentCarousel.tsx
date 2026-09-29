
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ContentCard from './ContentCard';
import type { Content, ProgresoLectura } from '../types';

interface ContentCarouselProps {
  title: string;
  items: { content: Content; progress?: ProgresoLectura }[];
  onUpdateProgressClick?: (content: Content) => void;
}

// Fracción del ancho visible que avanza cada flecha.
const SCROLL_STEP = 0.8;

const ContentCarousel: React.FC<ContentCarouselProps> = ({ title, items, onUpdateProgressClick }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  // CHP-UI-PEDAGOGY-VISIBILITY-01: el scrollbar está oculto, así que en
  // escritorio las flechas son la forma evidente de alcanzar todas las tarjetas.
  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 1);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateArrows) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
      ro?.disconnect();
    };
  }, [updateArrows, items.length]);

  const scrollByStep = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * SCROLL_STEP, behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  const arrowClass = 'hidden md:flex absolute top-1/2 -translate-y-1/2 z-10 items-center justify-center w-10 h-10 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 shadow-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700';

  return (
    <section className="py-6">
      <h2 className="text-2xl font-bold px-4 md:px-8 mb-4 text-gray-800 dark:text-gray-200">{title}</h2>
      <div className="relative">
        {canPrev && (
          <button type="button" onClick={() => scrollByStep(-1)} aria-label="Ver anteriores" className={`${arrowClass} left-2`}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div ref={scrollerRef} className="flex overflow-x-auto space-x-4 px-4 md:px-8 pb-4 scrollbar-hide">
          {items.map(({ content, progress }) => (
            <div key={content.id} className="w-36 md:w-48 flex-shrink-0">
              <ContentCard
                content={content}
                progress={progress?.porcentaje}
                onUpdateProgressClick={onUpdateProgressClick && progress?.porcentaje && progress.porcentaje < 100 ? onUpdateProgressClick : undefined}
              />
            </div>
          ))}
        </div>
        {canNext && (
          <button type="button" onClick={() => scrollByStep(1)} aria-label="Ver más" className={`${arrowClass} right-2`}>
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </section>
  );
};

export default ContentCarousel;
