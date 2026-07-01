import { useState, useEffect, useRef, type Ref } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';

export interface ModalFieldOption {
  value: string;
  label: string;
}

export interface ModalField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  value: string;
  placeholder?: string;
  options?: ModalFieldOption[]; // required when type === 'select'
  suggestions?: string[];       // text fields only — populates a <datalist> for autocomplete
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
  const firstInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const actualCancelLabel = cancelLabel ?? t.cancel;
  const actualSaveLabel = saveLabel ?? t.save;

  useEffect(() => {
    firstInputRef.current?.focus();
    if (firstInputRef.current && firstInputRef.current instanceof HTMLInputElement) {
      firstInputRef.current.select();
    }

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
      className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full sm:w-auto sm:min-w-[360px] sm:max-w-sm bg-[var(--bg-card)] rounded-t-[8px] sm:rounded-[8px] p-6 space-y-5 border border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-[var(--text-1)]">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-elev)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          {fields.map((field, idx) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wide">
                {field.label}
              </label>
              {field.type === 'select' ? (
                <select
                  ref={idx === 0 ? (firstInputRef as Ref<HTMLSelectElement>) : undefined}
                  value={values[field.key]}
                  onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] px-4 py-3 text-[14px] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[#7FCBA0]"
                >
                  {(field.options ?? []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    ref={idx === 0 ? (firstInputRef as Ref<HTMLInputElement>) : undefined}
                    type={field.type}
                    inputMode={field.type === 'number' ? 'decimal' : undefined}
                    value={values[field.key]}
                    placeholder={field.placeholder}
                    autoComplete={field.suggestions ? 'off' : undefined}
                    onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] px-4 py-3 text-[14px] font-mono text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[#7FCBA0] placeholder:text-[var(--text-2)] placeholder:font-sans"
                  />
                  {field.suggestions && field.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {field.suggestions.map(s => {
                        const active = values[field.key].trim() === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setValues(prev => ({ ...prev, [field.key]: s }))}
                            className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors border"
                            style={{
                              background: active ? 'var(--accent-bg)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-2)',
                              borderColor: active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {error && (
            <p className="text-[12px] text-[#B5533A] font-medium">{error}</p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--text-2)] bg-[var(--bg-elev)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            {actualCancelLabel}
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-[6px] text-[13px] font-semibold text-[var(--text)] bg-[var(--forest)] hover:bg-[var(--forest-dim)] transition-opacity"
          >
            {actualSaveLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
