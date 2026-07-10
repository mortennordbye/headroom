import { useEffect, useId, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { parseLocaleNumber } from '../lib/validators';

/**
 * Compact day-of-month "payday" editor. It's the single control for the global
 * `payday` in FinanceContext, which gates the income-reminder nag via
 * `isBeforePayday`. Empty / 0 = unset (never suppresses). Rendered on the Salary
 * (current job) and Budget pages, so it lives here rather than in either page.
 */
export function PaydayField({ className = '' }: { className?: string }) {
  const { payday, setPayday, t } = useFinance();
  const inputId = useId();
  const [draft, setDraft] = useState(payday >= 1 ? String(payday) : '');
  // Re-sync the editable draft when the committed value changes from outside
  // (a JSON import or demo toggle) — same pattern as NumberRow.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(payday >= 1 ? String(payday) : ''); }, [payday]);

  const commit = () => {
    const n = parseLocaleNumber(draft);
    setPayday(Number.isFinite(n) && n >= 1 ? Math.min(31, Math.round(n)) : 0);
  };

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 h-10 rounded-[8px] border ${className}`}
      style={{ background: 'var(--surface-3)', borderColor: 'var(--border)' }}
      title={t.settings.paydayDesc}
    >
      <CalendarClock size={15} style={{ color: 'var(--text-3)' }} className="shrink-0" />
      <label
        htmlFor={inputId}
        className="text-[11px] font-semibold uppercase tracking-[0.12em] shrink-0"
        style={{ color: 'var(--text-3)' }}
      >
        {t.settings.payday}
      </label>
      <input
        id={inputId}
        type="number"
        min={1}
        max={31}
        inputMode="numeric"
        value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="w-10 bg-transparent text-[14px] font-mono outline-none text-right"
        style={{ color: 'var(--text-1)' }}
      />
      <span className="text-[11px] shrink-0" style={{ color: 'var(--text-3)' }}>{t.settings.paydaySuffix}</span>
    </div>
  );
}
