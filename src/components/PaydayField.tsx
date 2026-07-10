import { useEffect, useId, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { parseLocaleNumber } from '../lib/validators';

/**
 * Compact editor for the global `payday` (day-of-month) that gates the income
 * reminder via `isBeforePayday`. Empty / 0 = unset. Lives as a pill in the
 * Salary card header. Reads/writes the single value in context.
 */
export function PaydayField({ className = '' }: { className?: string }) {
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
