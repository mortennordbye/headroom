import ReactDOM from 'react-dom';
import { AlertTriangle } from 'lucide-react';

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
  const content = (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full sm:w-auto sm:min-w-[340px] sm:max-w-sm bg-white dark:bg-[#1a1a1a] rounded-t-2xl sm:rounded-2xl p-6 space-y-4 shadow-2xl border border-[#e5e5e5] dark:border-[#2a2a2a]">
        <div className="flex items-center gap-3">
          {danger && <AlertTriangle size={18} className="text-[#ef4444] shrink-0" />}
          <h3 className="text-[14px] font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{title}</h3>
        </div>
        <p className="text-[13px] text-[#737373] leading-relaxed">{message}</p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#737373] bg-[#f0f0f0] dark:bg-[#222222] hover:bg-[#e5e5e5] dark:hover:bg-[#2a2a2a] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 ${
              danger ? 'bg-[#ef4444]' : 'bg-[#0ea5e9] dark:bg-[#38bdf8] dark:text-[#111111]'
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
