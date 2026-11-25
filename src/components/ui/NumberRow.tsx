import { useEffect, useState, type ReactNode } from 'react';
import { parseLocaleNumber } from '../../lib/validators';

/**
 * Labelled numeric input with a locally-buffered draft that re-syncs when the
 * committed value changes from outside. Optional provenance `badge` next to the
 * label. Shared by the Pension and Employer-cost pages.
 */
export function NumberRow({
  label,
  value,
  onCommit,
  suffix,
  badge,
  onBlank,
  placeholder,
}: {
  label: string;
  /** Null shows an empty field (with the placeholder). */
  value: number | null;
  onCommit: (v: number) => void;
  suffix?: string;
  badge?: ReactNode;
  /** Called instead of committing 0 when the field is left empty. */
  onBlank?: () => void;
  placeholder?: string;
}) {
  const shown = value == null ? '' : value.toString();
  const [draft, setDraft] = useState(shown);
  // Re-sync the editable draft when the committed value changes from outside.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(shown); }, [shown]);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em] min-w-0 [overflow-wrap:anywhere]" style={{ color: 'var(--text-3)' }}>{label}</label>
          {badge}
        </div>
        {suffix && <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{suffix}</span>}
      </div>
      <input
        type="number"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (onBlank && draft.trim() === '') { setDraft(shown); onBlank(); return; }
          const n = parseLocaleNumber(draft);
          onCommit(Number.isFinite(n) ? n : 0);
        }}
        className="w-full h-10 px-3 rounded-[8px] text-[14px] font-mono outline-none border"
        style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      />
    </div>
  );
}
