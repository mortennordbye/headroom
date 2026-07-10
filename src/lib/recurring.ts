// Recurring-transaction detection — spot a merchant that charges a similar
// amount every month and offer to turn it into a fixed expense (an envelope).
//
// Deliberately conservative, like the internal-transfer and envelope-link
// detectors: a group only surfaces when the same normalized merchant appears in
// at least MIN_MONTHS distinct recent months with amounts inside a tight band.
// A false "this is recurring" nudge is more annoying than a missed one, so the
// bar is high and merchants already covered by a fixed-expense match are skipped.
import type { DailyTransaction, FixedExpense } from '../context/FinanceContext';
import { isCategoryKey, type CategoryKey } from './categories';

// How many months back (including monthKey) to consider "recent". Four covers a
// quarter plus the current, partial month without reaching into stale history.
const LOOKBACK_MONTHS = 4;
// Distinct months the merchant must appear in to read as ~monthly cadence.
const MIN_MONTHS = 3;
// Amount spread tolerance: (max - min) / median must stay within this band, so
// exact subscriptions and lightly-varying utility bills pass but noisy
// discretionary spend (groceries swinging 2x) does not.
const AMOUNT_TOLERANCE = 0.35;

export interface RecurringSuggestion {
  /** Normalized merchant key — also the suggested match pattern for the envelope. */
  key: string;
  /** Human label (original casing) for the proposed fixed expense. */
  label: string;
  /** Representative (median) monthly amount, rounded. */
  amount: number;
  /** Distinct recent months the merchant was seen in. */
  months: number;
  /** Most common category among the occurrences, if any (seeds the new expense). */
  category?: CategoryKey;
}

/** Lowercased, whitespace-collapsed merchant key used for grouping and matching. */
function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The set of `yyyy-MM` keys for monthKey and the n-1 months before it. */
function recentMonths(monthKey: string, n: number): Set<string> {
  const [y, m] = monthKey.split('-').map(Number);
  const out = new Set<string>();
  if (!Number.isFinite(y) || !Number.isFinite(m)) return out;
  for (let i = 0; i < n; i++) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    out.add(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  return out;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

function mostCommonCategory(cats: (string | undefined)[]): CategoryKey | undefined {
  const counts = new Map<CategoryKey, number>();
  for (const c of cats) {
    if (isCategoryKey(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: CategoryKey | undefined;
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) { best = cat; bestN = n; }
  }
  return best;
}

/**
 * Merchants that charge a similar amount roughly monthly over the recent window
 * and aren't already tracked as a fixed expense. Sorted biggest-amount first.
 * Empty until there's enough history (a merchant seen in <3 recent months, or
 * with amounts outside the tolerance band, is left alone).
 */
export function detectRecurring(
  transactions: DailyTransaction[],
  fixedExpenses: FixedExpense[],
  monthKey: string,
): RecurringSuggestion[] {
  const window = recentMonths(monthKey, LOOKBACK_MONTHS);
  if (!window.size) return [];
  const existingMatches = fixedExpenses
    .map((e) => (e.match ?? '').trim().toLowerCase())
    .filter(Boolean);

  const groups = new Map<string, { label: string; occ: { month: string; amount: number; category?: string }[] }>();
  for (const tx of transactions) {
    if (tx.kind === 'income') continue;
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) continue;
    const month = tx.date.slice(0, 7);
    if (!window.has(month)) continue;
    const raw = (tx.merchant ?? tx.description ?? '').trim();
    const key = normalizeKey(raw);
    if (!key) continue;
    const g = groups.get(key) ?? { label: raw, occ: [] };
    g.occ.push({ month, amount: tx.amount, category: tx.category });
    groups.set(key, g);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const [key, g] of groups) {
    // Already tracked by a fixed-expense match pattern → nothing to suggest.
    const hay = ` ${key} `;
    if (existingMatches.some((m) => hay.includes(m))) continue;

    const months = new Set(g.occ.map((o) => o.month));
    if (months.size < MIN_MONTHS) continue;

    const amounts = g.occ.map((o) => o.amount).sort((a, b) => a - b);
    const med = median(amounts);
    if (med <= 0) continue;
    const spread = (amounts[amounts.length - 1] - amounts[0]) / med;
    if (spread > AMOUNT_TOLERANCE) continue;

    suggestions.push({
      key,
      label: g.label,
      amount: Math.round(med),
      months: months.size,
      category: mostCommonCategory(g.occ.map((o) => o.category)),
    });
  }

  suggestions.sort((a, b) => b.amount - a.amount);
  return suggestions;
}
