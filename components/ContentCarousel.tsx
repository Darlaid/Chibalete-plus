
import React from 'react';
import ContentCard from './ContentCard';
import type { Content, ProgresoLectura } from '../types';

interface ContentCarouselProps {
  title: string;
  items: { content: Content; progress?: ProgresoLectura }[];
  onUpdateProgressClick?: (content: Content) => void;
}

const ContentCarousel: React.FC<ContentCarouselProps> = ({ title, items, onUpdateProgressClick }) => {
  if (items.length === 0) return null;

  return (
    <section className="py-6">
      <h2 className="text-2xl font-bold px-4 md:px-8 mb-4 text-gray-800 dark:text-gray-200">{title}</h2>
      <div className="flex overflow-x-auto space-x-4 px-4 md:px-8 pb-4 scrollbar-hide">
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
    </section>
  );
};

export default ContentCarousel;
