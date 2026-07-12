import { useEffect, useRef, useState, type Ref } from 'react';
import { format } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../../context/FinanceContext';

type PickerMode = 'month' | 'day';

interface MonthPickerProps {
  id?: string;
  /** Current value: 'YYYY-MM' (month mode) or 'YYYY-MM-DD' (day mode), or ''. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 'month' → year + 12-month grid; 'day' → full calendar with days. */
  mode?: PickerMode;
  inputRef?: Ref<HTMLInputElement>;
}

const YM = /^(\d{4})-(\d{2})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A date field you can type or pick from a calendar popover, styled with the app
 * tokens instead of the native control. In `month` mode it stores 'YYYY-MM'
 * (year nav + 12-month grid); in `day` mode it stores 'YYYY-MM-DD' (month nav +
 * day grid). Typing passes straight through, so the caller's validation still
 * runs on save.
 */
export function MonthPicker({ id, value, onChange, placeholder, mode = 'month', inputRef }: MonthPickerProps) {
  const { lang, t } = useFinance();
  const c = t.common;
  const locale = lang === 'nb' ? nb : enUS;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Parse the current value (tolerates a month-only value even in day mode).
  const ymd = value.match(YMD);
  const ym = value.match(YM);
  const selYear = ymd ? Number(ymd[1]) : ym ? Number(ym[1]) : null;
  const selMonth = ymd ? Number(ymd[2]) - 1 : ym ? Number(ym[2]) - 1 : null; // 0-based
  const selDay = ymd ? Number(ymd[3]) : null;

  const now = new Date();
  const [viewYear, setViewYear] = useState<number>(selYear ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(selMonth ?? now.getMonth()); // 0-based

  // Sync the grid to the typed value each time the popover opens.
  const toggle = () => {
    if (!open) {
      if (selYear != null) setViewYear(selYear);
      if (selMonth != null) setViewMonth(selMonth);
    }
    setOpen(o => !o);
  };

  // Close when clicking outside the field + popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Escape closes only the popover. The modal's focus trap catches Escape with a
  // native bubble listener on the dialog node, which would otherwise fire first
  // and close the whole modal — intercept in the capture phase and stop it.
  useEffect(() => {
    if (!open) return;
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('keydown', onKeyCapture, true);
    return () => document.removeEventListener('keydown', onKeyCapture, true);
  }, [open]);

  const pickMonth = (m: number) => {
    onChange(`${viewYear}-${pad(m + 1)}`);
    setOpen(false);
  };
  const pickDay = (d: number) => {
    onChange(`${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`);
    setOpen(false);
  };
  const stepMonth = (delta: number) => {
    const total = viewYear * 12 + viewMonth + delta;
    setViewYear(Math.floor(total / 12));
    setViewMonth(((total % 12) + 12) % 12);
  };

  const monthNames = Array.from({ length: 12 }, (_, m) => format(new Date(2020, m, 1), 'LLL', { locale }));

  // Day grid, Monday-first (matches weekdayInitials).
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadBlanks = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const dayCells: (number | null)[] = [
    ...Array<null>(leadBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const btnBase = 'rounded-[6px] text-[12px] font-medium transition-colors';
  const hoverIn = (e: React.MouseEvent<HTMLButtonElement>, active: boolean) => { if (!active) e.currentTarget.style.background = 'var(--bg-raised)'; };
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>, active: boolean) => { if (!active) e.currentTarget.style.background = 'transparent'; };
  const cellStyle = (active: boolean) => ({ background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--bg-page)' : 'var(--text-1)' });

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
          {/* Header: year (month mode) or month + year (day mode), with nav. */}
          <div className="flex items-center justify-between mb-2.5">
            <button
              type="button"
              aria-label={c.monthPickerPrevYear}
              onClick={() => (mode === 'day' ? stepMonth(-1) : setViewYear(y => y - 1))}
              className="p-1 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[13px] font-mono font-semibold text-[var(--text-1)] tabular-nums capitalize">
              {mode === 'day' ? `${format(new Date(viewYear, viewMonth, 1), 'LLLL', { locale })} ${viewYear}` : viewYear}
            </span>
            <button
              type="button"
              aria-label={c.monthPickerNextYear}
              onClick={() => (mode === 'day' ? stepMonth(1) : setViewYear(y => y + 1))}
              className="p-1 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {mode === 'day' ? (
            <>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {c.weekdayInitials.map((w, i) => (
                  <span key={i} className="text-center text-[10px] font-semibold text-[var(--text-3)] py-1">{w}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {dayCells.map((d, i) => d === null ? (
                  <span key={`b${i}`} />
                ) : (
                  (() => {
                    const active = selYear === viewYear && selMonth === viewMonth && selDay === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => pickDay(d)}
                        className={`${btnBase} h-8 tabular-nums`}
                        style={cellStyle(active)}
                        onMouseEnter={(e) => hoverIn(e, active)}
                        onMouseLeave={(e) => hoverOut(e, active)}
                      >
                        {d}
                      </button>
                    );
                  })()
                ))}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {monthNames.map((label, m) => {
                const active = selYear === viewYear && selMonth === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pickMonth(m)}
                    className={`${btnBase} py-2 capitalize`}
                    style={cellStyle(active)}
                    onMouseEnter={(e) => hoverIn(e, active)}
                    onMouseLeave={(e) => hoverOut(e, active)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

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
