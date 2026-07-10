import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  /** aria-label for the header X button; omit to render no X (e.g. ConfirmModal). */
  closeLabel?: string;
  /** Optional leading icon in the header row. */
  icon?: ReactNode;
  /** Per-modal panel classes: width (sm:min-w/max-w), spacing (space-y-*), scroll (max-h/overflow/flex-col). */
  panelClassName: string;
  /** id of the element that describes the dialog (wired to aria-describedby). */
  describedBy?: string;
  /** Element to focus on open; falls back to the first focusable child. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Optional action row rendered after the body (outside any scrollable child). */
  footer?: ReactNode;
}

/**
 * The one modal scaffold: portal → dimmed overlay (backdrop-click closes) →
 * panel with focus trap, dialog semantics and the shared header row. Bodies
 * and footers stay bespoke per modal; every dialog built on this inherits
 * Escape-to-close, Tab trapping and focus restore from `useFocusTrap`.
 */
export function ModalShell({
  title, onClose, closeLabel, icon, panelClassName, describedBy, initialFocus, children, footer,
}: ModalShellProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose, initialFocus);
  const titleId = useId();

  // Tie the open dialog to a browser-history entry so the hardware/browser Back
  // button (and Android back gesture) dismisses the dialog instead of navigating
  // the app away. Closing by any other means (Save/Cancel/Escape/backdrop)
  // consumes the entry we pushed, unless the user meanwhile navigated the router
  // (then history.state.modal is no longer set and we leave history alone).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    window.history.pushState({ modal: true }, '');
    const onPop = () => onCloseRef.current();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state?.modal) window.history.back();
    };
  }, []);

  const content = (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        className={`w-full sm:w-auto bg-[var(--bg-card)] rounded-t-[8px] sm:rounded-[8px] p-6 border border-[var(--border)] ${panelClassName}`}
      >
        <div className={`flex items-center shrink-0 ${closeLabel ? 'justify-between' : 'gap-3'}`}>
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <h3 id={titleId} className="text-[14px] font-semibold text-[var(--text-1)]">{title}</h3>
          </div>
          {closeLabel && (
            <button
              onClick={onClose}
              aria-label={closeLabel}
              className="p-1 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {children}
        {footer}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
