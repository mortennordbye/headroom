import { useRef } from 'react';
import type React from 'react';

/**
 * Runs `action` when a finger lifts off the element, and cancels the click iOS
 * would synthesize afterwards. iOS sometimes never sends that click (seen with
 * the tap log on the mobile tab bar), and when the action opens or closes an
 * overlay, a late click lands on whatever is now under the finger. Spread the
 * result onto the element next to its onClick, which stays for mouse and
 * keyboard. A finger that slid more than 10 px is not a tap.
 */
export function useTapAction(action: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!s || !t || Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) return;
      e.preventDefault();
      action();
    },
  };
}
