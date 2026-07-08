import { ChevronLeft, ChevronRight, History, Lock } from 'lucide-react';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import type { BalanceHistory } from '../hooks/useBalanceHistory';

/**
 * Snapshot-aware stepper shown at the top of the balance pages. Steps only through
 * months that have a recorded snapshot (plus the live month). Hidden entirely until
 * at least one past snapshot exists, so it never clutters a new account.
 */
export default function BalanceHistoryBar({ hist }: { hist: BalanceHistory }) {
  const { t, lang } = useFinance();
  const tm = t.timeMachine;
  const dateLocale = lang === 'nb' ? nb : enUS;

  if (!hist.hasHistory) return null;

  const label = format(parse(hist.activeKey, 'yyyy-MM', new Date()), 'MMMM yyyy', { locale: dateLocale });
  const accent = hist.isLive ? 'var(--positive)' : 'var(--violet)';
  const accentBg = hist.isLive ? 'var(--positive-bg)' : 'var(--violet-bg)';

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 mb-5 px-3 py-2 rounded-[8px] border"
      style={{ background: accentBg, borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` }}
      role="status"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1">
          <button
            onClick={hist.goPrev}
            disabled={!hist.canPrev}
            aria-label={tm.prevSnapshot}
            className="grid place-items-center w-7 h-7 rounded-[6px] transition-colors disabled:opacity-30 disabled:cursor-default"
            style={{ color: 'var(--text-2)' }}
          >
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <button
            onClick={hist.goNext}
            disabled={!hist.canNext}
            aria-label={tm.nextSnapshot}
            className="grid place-items-center w-7 h-7 rounded-[6px] transition-colors disabled:opacity-30 disabled:cursor-default"
            style={{ color: 'var(--text-2)' }}
          >
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold capitalize" style={{ color: accent }}>
          {hist.isLive ? <History size={13} /> : <Lock size={13} />}
          {hist.isLive ? tm.liveLabel : `${tm.viewing} · ${label}`}
        </span>
      </div>

      {!hist.isLive && (
        <div className="flex items-center gap-3 min-w-0">
          <span className="hidden sm:inline text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
            {tm.readOnly}
          </span>
          <button
            onClick={hist.goLive}
            className="shrink-0 inline-flex items-center px-3 h-7 rounded-[6px] text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
          >
            {tm.backToToday}
          </button>
        </div>
      )}
    </div>
  );
}
