/**
 * RewardToasts — non-blocking reward feedback overlay.
 *
 * Renders a small stack of ephemeral notifications in the bottom-left corner.
 * Positioned deliberately away from controls (bottom-right) and Leo (right).
 *
 * Design rules:
 *   - Never covers the reading text
 *   - Never requires user interaction to dismiss
 *   - Minimal footprint: pill-shaped, small font, semi-transparent
 *   - Stacks upward so multiple toasts don't overlap
 *   - No entrance animation heavier than a fade + small slide
 */

import React from 'react';
import type { RewardToast } from '../hooks/useRewardFeedback';

// ---------------------------------------------------------------------------
// VARIANT STYLES
// ---------------------------------------------------------------------------

const VARIANT_STYLES: Record<RewardToast['variant'], string> = {
  xp:      'bg-indigo-950/80 border-indigo-500/40 text-indigo-100',
  levelUp: 'bg-yellow-950/90 border-yellow-400/50 text-yellow-100',
  streak:  'bg-orange-950/80 border-orange-500/40 text-orange-100',
};

const VARIANT_ICON: Record<RewardToast['variant'], string> = {
  xp:      '⚡',
  levelUp: '🎯',
  streak:  '🔥',
};

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

interface RewardToastsProps {
  toasts: RewardToast[];
}

const RewardToasts: React.FC<RewardToastsProps> = ({ toasts }) => {
  if (toasts.length === 0) return null;

  return (
    /*
     * Anchored bottom-left, above the floating controls (which sit at bottom-10).
     * z-40: above the teleprompter shell (z-0) and header (z-20),
     *        below Leo companion (z-60) and denial overlay (z-70).
     * pointer-events-none: toasts never intercept taps/clicks on the reader.
     */
    <div
      className="fixed bottom-32 left-6 z-40 flex flex-col-reverse gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{ opacity: toast.dimOpacity ?? 1, transition: 'opacity 0.3s ease' }}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full border backdrop-blur-sm
            text-xs font-bold tracking-wide
            animate-in fade-in slide-in-from-left-3 duration-300
            ${VARIANT_STYLES[toast.variant]}
          `}
        >
          <span className="text-sm leading-none">{VARIANT_ICON[toast.variant]}</span>
          <span>{toast.message}</span>
          {toast.subtext && (
            <span className="opacity-60 font-normal">{toast.subtext}</span>
          )}
        </div>
      ))}
    </div>
  );
};

export default RewardToasts;
