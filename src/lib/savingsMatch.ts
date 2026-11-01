// Match each planned saving against the month's imported transactions, the way
// `reconcile` (envelopes.ts) matches fixed expenses. When only the outgoing leg
// of a savings transfer is imported (the savings account isn't connected) and
// the user hasn't marked it as a transfer, that row is the saving itself: it
// must count once, as saved, not again as spending.
//
// Conservative by design (this is money math). A row matches a saving only when
// it is spend in the same month, its amount is within a small tolerance of the
// saving, it isn't already claimed by a fixed-expense envelope, and it carries a
// hint that it is a saving: the saving's name in its text, or a structural
// transfer signal (an account number or a "Til:" prefix, as `transferSuggestions`
// uses). A saving with more than one candidate row, or a row that more than one
// saving could claim, matches nothing.
import type { DailyTransaction, Saving } from '../context/FinanceContext';
import { isSpend } from './spend';
import { buildMatchHaystack, normalizeMatchText } from './text';
import { hasTransferSignal } from './transferSuggestions';

/** How far a row's amount may sit from the saving: 1 %, at least 1 kr. */
export function savingsMatchTolerance(amount: number): number {
  return Math.max(1, amount * 0.01);
}

export interface SavingMatch {
  savingId: string;
  txId: string;
  /** What the matched row actually moved. */
  amount: number;
}

/**
 * The one-to-one matches between `savings` and `monthKey`'s spend rows.
 * `isClaimed` excludes rows another reconciliation already owns (a fixed
 * expense's envelope), so one row never counts toward two plans.
 */
export function matchSavingsToTransactions(
  savings: Saving[],
  transactions: DailyTransaction[],
  monthKey: string,
  isClaimed: (tx: DailyTransaction) => boolean = () => false,
): SavingMatch[] {
  const pool = transactions.filter(
    (tx) => isSpend(tx) && tx.date.startsWith(monthKey) && Number.isFinite(tx.amount) && tx.amount > 0 && !isClaimed(tx),
  );
  const candidates = new Map<string, DailyTransaction[]>();
  const claimants = new Map<string, number>();
  for (const s of savings) {
    if (s.paused || !Number.isFinite(s.amount) || s.amount <= 0) continue;
    const name = normalizeMatchText(s.name);
    const tolerance = savingsMatchTolerance(s.amount);
    const hits = pool.filter((tx) => {
      if (Math.abs(tx.amount - s.amount) > tolerance) return false;
      const named = name.length >= 3 && buildMatchHaystack(tx.merchant, tx.description).includes(name);
      return named || hasTransferSignal(tx);
    });
    candidates.set(s.id, hits);
    for (const tx of hits) claimants.set(tx.id, (claimants.get(tx.id) ?? 0) + 1);
  }
  const matches: SavingMatch[] = [];
  for (const [savingId, hits] of candidates) {
    if (hits.length !== 1 || claimants.get(hits[0].id) !== 1) continue;
    matches.push({ savingId, txId: hits[0].id, amount: hits[0].amount });
  }
  return matches;
}
