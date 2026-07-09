import { useMemo } from 'react';
import { TrendingUp, Home, Landmark } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { computeHistoryInsights } from '../lib/historyInsights';
import { currentMonthKey } from '../lib/date';
import { formatSignedPct } from '../lib/format';

/**
 * Dashboard "history highlights": a few glanceable numbers derived from the
 * accumulated snapshots — mortgage/debt ahead-or-behind plan, and net-worth
 * growth over 6/12 months. Each chip appears only when there's enough recorded
 * history to state it honestly; the whole row hides when nothing qualifies.
 */
export default function HistoryInsights() {
  const { t, formatCurrency, formatCurrencyShort, balanceSnapshots, netWorthHistory, netWorth } = useFinance();
  const c = t.charts;

  const insights = useMemo(
    () => computeHistoryInsights(balanceSnapshots, netWorthHistory, netWorth, currentMonthKey()),
    [balanceSnapshots, netWorthHistory, netWorth],
  );

  const chips: { icon: typeof Home; label: string; value: string; color: string }[] = [];

  // Mortgage vs plan (rounded to whole months; small drift reads as "on track").
  if (insights.mortgageMonthsAhead !== null) {
    const m = Math.round(insights.mortgageMonthsAhead);
    chips.push(m === 0
      ? { icon: Home, label: c.insightOnTrack, value: '—', color: 'var(--text-2)' }
      : {
          icon: Home,
          label: m > 0 ? c.insightMortgageAhead : c.insightMortgageBehind,
          value: `${Math.abs(m)} ${c.insightMonthsSuffix}`,
          color: m > 0 ? 'var(--positive)' : 'var(--negative)',
        });
  }

  // Non-mortgage debt vs the minimums-only plan.
  if (insights.debtAheadBy !== null && Math.abs(insights.debtAheadBy) >= 500) {
    const ahead = insights.debtAheadBy > 0;
    chips.push({
      icon: Landmark,
      label: ahead ? c.insightDebtAhead : c.insightDebtBehind,
      value: formatCurrency(Math.abs(insights.debtAheadBy)),
      color: ahead ? 'var(--positive)' : 'var(--negative)',
    });
  }

  // Equity growth over 6 then 12 months (prefer showing both when available).
  for (const eq of [insights.equity6, insights.equity12]) {
    if (!eq) continue;
    chips.push({
      icon: TrendingUp,
      label: `${c.insightEquity} · ${eq.months} ${c.insightMonthsSuffix}`,
      value: `${eq.abs >= 0 ? '+' : ''}${formatCurrencyShort(eq.abs)}${eq.pct !== null ? ` (${formatSignedPct(eq.pct)})` : ''}`,
      color: eq.abs >= 0 ? 'var(--positive)' : 'var(--negative)',
    });
  }

  if (chips.length === 0) return null;

  return (
    <section aria-label={c.insightsTitle} className="flex flex-wrap gap-2">
      {chips.map((chip, i) => {
        const Icon = chip.icon;
        return (
          <div
            key={i}
            className="inline-flex items-center gap-2 rounded-[8px] border px-3 py-2"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <Icon size={14} strokeWidth={2} style={{ color: chip.color }} />
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{chip.label}</span>
            <span className="text-[13px] font-mono font-semibold" style={{ color: chip.color }}>{chip.value}</span>
          </div>
        );
      })}
    </section>
  );
}
