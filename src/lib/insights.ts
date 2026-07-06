// A single headline spending insight for the Dashboard banner, e.g. "You spent
// 14% less on groceries this month than the 6-month average." Pure and
// unit-tested; returns a structured result the UI formats via the translations
// table (never a pre-baked sentence, so it stays i18n-clean). Income never
// counts as spend — all totals come from categoryStats.
import type { DailyTransaction } from '../context/FinanceContext';
import { spendByCategory, totalSpend } from './categoryStats';
import { isCategoryKey, type CategoryKey } from './categories';

export interface SpendInsight {
  /** category-delta: a category deviates from its trailing average. total-delta:
   *  overall spend deviates. top-category: neutral fallback (no notable swing). */
  kind: 'category-delta' | 'total-delta' | 'top-category';
  category?: CategoryKey;
  /** Deviation magnitude in %, rounded, always ≥ 0 (direction carries the sign). */
  pct: number;
  direction: 'more' | 'less';
  /** Current-month spend for the subject (a category, or the month total). */
  amount: number;
}

// Below these a swing is noise, not a story: ignore tiny categories and tiny
// absolute moves so we never surface "300% more on a 15 kr category".
const MIN_AVG = 300;   // kr — trailing average must clear this to be worth noting
const MIN_DELTA = 200; // kr — absolute change must clear this too

const avg = (nums: number[]) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0);

/**
 * Pick the single most salient spending insight for `monthKey` against the
 * trailing months in `priorMonths` (typically the 6 months before it). Returns
 * null when there's no spend to talk about.
 */
export function topSpendInsight(
  txs: DailyTransaction[],
  monthKey: string,
  priorMonths: string[],
): SpendInsight | null {
  const currentTotal = totalSpend(txs, monthKey);
  if (currentTotal <= 0 && priorMonths.every((m) => totalSpend(txs, m) <= 0)) return null;

  // Per-category: current spend vs the trailing average.
  const currentByCat = new Map(spendByCategory(txs, monthKey).map((r) => [r.category, r.amount]));
  const priorByCat = priorMonths.map((m) => new Map(spendByCategory(txs, m).map((r) => [r.category, r.amount])));
  const categories = new Set<string>([
    ...currentByCat.keys(),
    ...priorByCat.flatMap((m) => [...m.keys()]),
  ]);

  let best: SpendInsight | null = null;
  for (const cat of categories) {
    if (!isCategoryKey(cat)) continue; // only canonical categories get a headline
    const current = currentByCat.get(cat) ?? 0;
    const average = avg(priorMonths.map((_, i) => priorByCat[i].get(cat) ?? 0));
    if (average < MIN_AVG) continue;
    const delta = current - average;
    if (Math.abs(delta) < MIN_DELTA) continue;
    const pct = Math.round((Math.abs(delta) / average) * 100);
    if (!best || pct > best.pct) {
      best = { kind: 'category-delta', category: cat, pct, direction: delta >= 0 ? 'more' : 'less', amount: current };
    }
  }
  if (best) return best;

  // No single category stands out → talk about the overall total instead.
  const avgTotal = avg(priorMonths.map((m) => totalSpend(txs, m)));
  if (avgTotal >= MIN_AVG && Math.abs(currentTotal - avgTotal) >= MIN_DELTA) {
    const delta = currentTotal - avgTotal;
    return {
      kind: 'total-delta',
      pct: Math.round((Math.abs(delta) / avgTotal) * 100),
      direction: delta >= 0 ? 'more' : 'less',
      amount: currentTotal,
    };
  }

  // Nothing notable moved → neutral "biggest category this month" fallback.
  const top = spendByCategory(txs, monthKey).find((r) => isCategoryKey(r.category));
  if (top && top.amount > 0) {
    return { kind: 'top-category', category: top.category as CategoryKey, pct: 0, direction: 'more', amount: top.amount };
  }
  return null;
}
