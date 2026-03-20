import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  currentRating: number;
  onRatingChange: (newRating: number) => void;
  size?: number;
  readonly?: boolean;
}

const StarRating: React.FC<StarRatingProps> = ({ currentRating, onRatingChange, size = 20, readonly = false }) => {
  const [hoverRating, setHoverRating] = useState(0);

  return (
    <div className="flex items-center space-x-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => !readonly && onRatingChange(star)}
          onMouseEnter={() => !readonly && setHoverRating(star)}
          onMouseLeave={() => !readonly && setHoverRating(0)}
          aria-label={`Calificar con ${star} estrellas`}
          className={`p-0 bg-transparent border-none ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
          disabled={readonly}
        >
          <Star
            size={size}
            className={`transition-colors duration-200 ${
              (hoverRating || currentRating) >= star
                ? 'text-yellow-400 fill-current'
                : 'text-gray-400'
            }`}
          />
        </button>
      ))}
    </div>
  );
};

export default StarRating;