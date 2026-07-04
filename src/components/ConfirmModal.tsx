import ReactDOM from 'react-dom';
import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export default function ConfirmModal({
  title, message, confirmLabel, cancelLabel, onConfirm, onCancel, danger = true
}: ConfirmModalProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(onCancel);
  const titleId = useId();
  const messageId = useId();
  const content = (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full sm:w-auto sm:min-w-[340px] sm:max-w-sm bg-[var(--bg-card)] rounded-t-[8px] sm:rounded-[8px] p-6 space-y-4 border border-[var(--border)]"
      >
        <div className="flex items-center gap-3">
          {danger && <AlertTriangle size={18} className="text-[#B5533A] shrink-0" />}
          <h3 id={titleId} className="text-[14px] font-semibold text-[var(--text-1)]">{title}</h3>
        </div>
        <p id={messageId} className="text-[13px] text-[var(--text-2)] leading-relaxed">{message}</p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-[6px] text-[13px] font-semibold text-[var(--text)] transition-colors ${
              danger ? 'bg-[var(--rust)] hover:bg-[#9c4632]' : 'bg-[var(--forest)] hover:bg-[var(--forest-dim)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
  return ReactDOM.createPortal(content, document.body);
}
