import { useEffect, useRef, useState, type Ref } from 'react';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../context/FinanceContext';

interface MonthPickerProps {
  id?: string;
  /** Current value as 'YYYY-MM', or '' when unset. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}

const YM = /^(\d{4})-(\d{2})$/;

/**
 * A month field you can type ('2024-09') or pick from a small calendar popover
 * (year nav + 12-month grid). Stores 'YYYY-MM'; typing passes straight through
 * so the caller's existing validation still runs on save. Styled with the app
 * tokens rather than the native month control (which renders in the browser
 * locale and clashes with the dark theme).
 */
export function MonthPicker({ id, value, onChange, placeholder, inputRef }: MonthPickerProps) {
  const { lang, t } = useFinance();
  const c = t.common;
  const locale = lang === 'nb' ? nb : enUS;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const match = value.match(YM);
  const selYear = match ? Number(match[1]) : null;
  const selMonth = match ? Number(match[2]) - 1 : null; // 0-based

  const [viewYear, setViewYear] = useState<number>(selYear ?? new Date().getFullYear());

  // Toggle the popover, syncing the grid to the typed value's year on open.
  const toggle = () => {
    if (!open && selYear != null) setViewYear(selYear);
    setOpen(o => !o);
  };

  // Close when clicking outside the field+popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Escape closes only the popover. The modal's focus trap listens for Escape
  // with a native bubble listener on the dialog node, which would otherwise fire
  // first and close the whole modal — so intercept in the capture phase and stop
  // propagation before it reaches that listener.
  useEffect(() => {
    if (!open) return;
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('keydown', onKeyCapture, true);
    return () => document.removeEventListener('keydown', onKeyCapture, true);
  }, [open]);

  const months = Array.from({ length: 12 }, (_, m) => format(new Date(2020, m, 1), 'LLL', { locale }));

  const pick = (m: number) => {
    onChange(`${viewYear}-${String(m + 1).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] rounded-[6px] pl-4 pr-11 py-3 text-[14px] font-mono text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-[var(--positive)] placeholder:text-[var(--text-2)] placeholder:font-sans"
        />
        <button
          type="button"
          aria-label={c.monthPickerOpen}
          aria-expanded={open}
          onClick={toggle}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--accent)] hover:bg-[var(--bg-elev)] transition-colors"
        >
          <Calendar size={15} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 z-20 rounded-[8px] border border-[var(--border)] bg-[var(--bg-elev)] p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2.5">
            <button
              type="button"
              aria-label={c.monthPickerPrevYear}
              onClick={() => setViewYear(y => y - 1)}
              className="p-1 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[13px] font-mono font-semibold text-[var(--text-1)] tabular-nums">{viewYear}</span>
            <button
              type="button"
              aria-label={c.monthPickerNextYear}
              onClick={() => setViewYear(y => y + 1)}
              className="p-1 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {months.map((label, m) => {
              const active = selYear === viewYear && selMonth === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(m)}
                  className="py-2 rounded-[6px] text-[12px] font-medium capitalize transition-colors"
                  style={{
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--bg-page)' : 'var(--text-1)',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-raised)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className="mt-2.5 w-full py-1.5 rounded-[6px] text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            {c.monthPickerClear}
          </button>
        </div>
      )}
    </div>
  );
}
