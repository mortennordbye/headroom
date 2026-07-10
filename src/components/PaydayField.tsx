import { useEffect, useId, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { parseLocaleNumber } from '../lib/validators';

/**
 * Editor for the global `payday` (day-of-month) that drives the income reminder
 * via `isBeforePayday`. Empty / 0 = unset. `card` shows a labelled box with the
 * description (Budget page); `inline` is a compact pill for the Salary card
 * header next to the action buttons. Reads/writes the single value in context.
 */
export function PaydayField({ variant = 'card', className = '' }: { variant?: 'card' | 'inline'; className?: string }) {
  const { payday, setPayday, t } = useFinance();
  const inputId = useId();
  const [draft, setDraft] = useState(payday >= 1 ? String(payday) : '');
  // Re-sync the editable draft when the committed value changes from outside.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(payday >= 1 ? String(payday) : ''); }, [payday]);

  const commit = () => {
    const n = parseLocaleNumber(draft);
    setPayday(Number.isFinite(n) && n >= 1 ? Math.min(31, Math.round(n)) : 0);
  };

  if (variant === 'inline') {
    return (
      <div
        className={`inline-flex items-center gap-2 h-8 px-3 rounded-[6px] border border-[var(--border)] ${className}`}
        title={t.settings.paydayDesc}
      >
        <CalendarClock size={14} style={{ color: 'var(--text-3)' }} className="shrink-0" />
        <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-[0.1em] shrink-0" style={{ color: 'var(--text-2)' }}>
          {t.settings.payday}
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="w-9 h-6 text-center rounded-[4px] border border-[var(--border)] bg-[var(--bg-raised)] text-[13px] font-mono text-[var(--text-1)] outline-none focus:ring-2 focus:ring-[var(--positive)] placeholder:text-[var(--text-3)]"
        />
        <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>{t.settings.paydaySuffix}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-[8px] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-2)' }}>
          <CalendarClock size={15} style={{ color: 'var(--text-3)' }} className="shrink-0" />
          {t.settings.payday}
        </label>
        <div className="flex items-center gap-2 shrink-0">
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            value={draft}
            placeholder="—"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="w-14 h-9 text-center rounded-[6px] border border-[var(--border)] bg-[var(--bg-raised)] text-[14px] font-mono text-[var(--text-1)] outline-none focus:ring-2 focus:ring-[var(--positive)] placeholder:text-[var(--text-3)]"
          />
          <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{t.settings.paydaySuffix}</span>
        </div>
      </div>
      <p className="text-[12px] leading-snug" style={{ color: 'var(--text-3)' }}>{t.settings.paydayDesc}</p>
    </div>
  );
}
