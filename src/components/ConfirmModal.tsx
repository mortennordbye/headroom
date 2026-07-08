import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ModalShell } from './ui/ModalShell';

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
  const messageId = useId();
  return (
    <ModalShell
      title={title}
      onClose={onCancel}
      icon={danger ? <AlertTriangle size={18} className="text-[var(--negative)] shrink-0" /> : undefined}
      describedBy={messageId}
      panelClassName="sm:min-w-[340px] sm:max-w-sm space-y-4"
      footer={
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
      }
    >
      <p id={messageId} className="text-[13px] text-[var(--text-2)] leading-relaxed">{message}</p>
    </ModalShell>
  );
}
