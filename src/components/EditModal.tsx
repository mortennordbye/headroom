import { useState, useRef, useId, type Ref } from 'react';
import { useFinance } from '../context/FinanceContext';
import { ModalShell } from './ui/ModalShell';

export interface ModalFieldOption {
  value: string;
  label: string;
}

export interface ModalField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  value: string;
  placeholder?: string;
  options?: ModalFieldOption[]; // required when type === 'select'
  suggestions?: string[];       // text fields only — populates a <datalist> for autocomplete
  hint?: string;                // optional helper text rendered under the field
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
  const formId = useId();
  const fieldId = (key: string) => `${formId}-${key}`;
  const actualCancelLabel = cancelLabel ?? t.cancel;
  const actualSaveLabel = saveLabel ?? t.save;

  const handleSave = () => onSave(values);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
  };

  return (
    <ModalShell
      title={title}
      onClose={onCancel}
      closeLabel={t.cancel}
      panelClassName="sm:min-w-[360px] sm:max-w-sm space-y-5"
      initialFocus={firstInputRef}
      footer={
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
      }
    >
        <div className="space-y-3">
          {fields.map((field, idx) => field.type === 'checkbox' ? (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={fieldId(field.key)} className="flex items-center gap-2 cursor-pointer">
                <input
                  id={fieldId(field.key)}
                  type="checkbox"
                  checked={values[field.key] === 'true'}
                  onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.checked ? 'true' : 'false' }))}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-[13px] text-[var(--text-1)]">{field.label}</span>
              </label>
              {field.hint && (
                <p className="text-[11px] leading-snug text-[var(--text-2)] normal-case tracking-normal pl-6">{field.hint}</p>
              )}
            </div>
          ) : (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={fieldId(field.key)} className="text-[11px] font-medium text-[var(--text-2)] uppercase tracking-wide">
                {field.label}
              </label>
              {field.type === 'select' ? (
                <select
                  id={fieldId(field.key)}
                  ref={idx === 0 ? (firstInputRef as Ref<HTMLSelectElement>) : undefined}
                  value={values[field.key]}
                  onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] px-4 py-3 text-[14px] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[var(--positive)]"
                >
                  {(field.options ?? []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    id={fieldId(field.key)}
                    ref={idx === 0 ? (firstInputRef as Ref<HTMLInputElement>) : undefined}
                    type={field.type}
                    inputMode={field.type === 'number' ? 'decimal' : undefined}
                    value={values[field.key]}
                    placeholder={field.placeholder}
                    autoComplete={field.suggestions ? 'off' : undefined}
                    onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] px-4 py-3 text-[14px] font-mono text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[var(--positive)] placeholder:text-[var(--text-2)] placeholder:font-sans"
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
                            className="px-2 py-1 rounded-[4px] text-[11px] font-medium transition-colors border"
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
              {field.hint && (
                <p className="text-[11px] leading-snug text-[var(--text-2)] normal-case tracking-normal">{field.hint}</p>
              )}
            </div>
          ))}
          {error && (
            <p className="text-[12px] text-[var(--negative)] font-medium">{error}</p>
          )}
        </div>
    </ModalShell>
  );
}
