import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';

export interface ModalField {
  key: string;
  label: string;
  type: 'text' | 'number';
  value: string;
  placeholder?: string;
}

interface EditModalProps {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  onCancel: () => void;
  cancelLabel?: string;
  saveLabel?: string;
  error?: string;
}

export default function EditModal({ title, fields, onSave, onCancel, cancelLabel, saveLabel, error }: EditModalProps) {
  const { t } = useFinance();
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map(f => [f.key, f.value]))
  );
  const firstInputRef = useRef<HTMLInputElement>(null);
  const actualCancelLabel = cancelLabel ?? t.cancel;
  const actualSaveLabel = saveLabel ?? t.save;

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleSave = () => onSave(values);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
  };

  const content = (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full sm:w-auto sm:min-w-[360px] sm:max-w-sm bg-white dark:bg-[#1a1a1a] rounded-t-2xl sm:rounded-2xl p-6 space-y-5 shadow-2xl border border-[#e5e5e5] dark:border-[#2a2a2a]">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] hover:bg-[#f0f0f0] dark:hover:bg-[#222222] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          {fields.map((field, idx) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-[11px] font-medium text-[#737373] uppercase tracking-wide">
                {field.label}
              </label>
              <input
                ref={idx === 0 ? firstInputRef : undefined}
                type={field.type}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={values[field.key]}
                placeholder={field.placeholder}
                onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                onKeyDown={handleKeyDown}
                className="w-full bg-[#fafafa] dark:bg-[#222222] border border-[#e5e5e5] dark:border-[#2a2a2a] rounded-xl px-4 py-3 text-[14px] font-mono text-[#0a0a0a] dark:text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-[#0ea5e9] dark:focus:ring-[#38bdf8] placeholder:text-[#737373] placeholder:font-sans"
              />
            </div>
          ))}
          {error && (
            <p className="text-[12px] text-[#ef4444] font-medium">{error}</p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#737373] bg-[#f0f0f0] dark:bg-[#222222] hover:bg-[#e5e5e5] dark:hover:bg-[#2a2a2a] transition-colors"
          >
            {actualCancelLabel}
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#0ea5e9] dark:bg-[#38bdf8] dark:text-[#111111] hover:opacity-90 transition-opacity"
          >
            {actualSaveLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
