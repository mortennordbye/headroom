import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface UndoToastProps {
  message: string;
  undoLabel: string;
  dismissLabel: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** How long before the deletion is committed and the toast auto-dismisses. */
  duration?: number;
}

/**
 * Transient bottom toast offering to undo a just-completed action. The action is
 * already applied (e.g. the row is removed from state); this only holds the
 * window to reverse it. Auto-dismisses after `duration`, after which the change
 * stands. Presentational — the caller owns the undo/commit logic.
 */
export function UndoToast({ message, undoLabel, dismissLabel, onUndo, onDismiss, duration = 8000 }: UndoToastProps) {
  // Keep onDismiss current without restarting the timer on every parent render.
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; });
  useEffect(() => {
    const id = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(id);
  }, [duration]);

  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full border shadow-lg"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <span className="text-[13px] text-[var(--text-1)]">{message}</span>
      <button
        onClick={onUndo}
        className="text-[12px] font-semibold text-[var(--accent)] hover:opacity-80 transition-opacity"
      >
        {undoLabel}
      </button>
      <button
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="p-0.5 rounded-full text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
