import type { BalanceSnapshot } from '../context/FinanceContext';
import { addMonthsKey } from './date';
import { netWorthFromSnapshot } from './netWorth';
import { paydownVsPlan } from './paydown';
import { debtPaydownVsPlan } from './debt';

// Dashboard "history highlights": turns the accumulated snapshots into a few
// glanceable numbers where the user actually looks. Pure + tested; each insight
// is null when there isn't enough recorded history to state it honestly.

export interface EquityChange {
  months: number;
  abs: number;
  /** null when the baseline was 0 (can't express a percentage). */
  pct: number | null;
}

export interface HistoryInsights {
  /** Mortgage ahead(+)/behind(−) the amortization plan, in months. */
  mortgageMonthsAhead: number | null;
  /** Non-mortgage debt ahead(+)/behind(−) the minimums-only plan, in kr. */
  debtAheadBy: number | null;
  /** Net-worth change over the trailing 6 and 12 months. */
  equity6: EquityChange | null;
  equity12: EquityChange | null;
}

/** Net worth recorded for a month: snapshot-derived if present, else the scalar
 *  history, else null (that month has no record). */
function netWorthAt(
  snapshots: Record<string, BalanceSnapshot>,
  history: Record<string, number>,
  monthKey: string,
): number | null {
  const snap = snapshots[monthKey];
  if (snap) return netWorthFromSnapshot(snap);
  if (monthKey in history) return history[monthKey];
  return null;
}

function equityChangeOver(
  snapshots: Record<string, BalanceSnapshot>,
  history: Record<string, number>,
  currentNetWorth: number,
  nowKey: string,
  months: number,
): EquityChange | null {
  const base = netWorthAt(snapshots, history, addMonthsKey(nowKey, -months));
  if (base === null) return null;
  const abs = Math.round(currentNetWorth - base);
  return { months, abs, pct: base !== 0 ? (abs / Math.abs(base)) * 100 : null };
}

export function computeHistoryInsights(
  snapshots: Record<string, BalanceSnapshot>,
  history: Record<string, number>,
  currentNetWorth: number,
  nowKey: string,
): HistoryInsights {
  const mortgage = paydownVsPlan(snapshots);
  const debt = debtPaydownVsPlan(snapshots);
  return {
    mortgageMonthsAhead: mortgage.points.length >= 2 ? mortgage.monthsAhead : null,
    debtAheadBy: debt.points.length >= 2 ? debt.aheadBy : null,
    equity6: equityChangeOver(snapshots, history, currentNetWorth, nowKey, 6),
    equity12: equityChangeOver(snapshots, history, currentNetWorth, nowKey, 12),
  };
}
