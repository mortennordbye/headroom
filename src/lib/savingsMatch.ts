// Match each planned saving against the month's imported transactions, the way
// `reconcile` (envelopes.ts) matches fixed expenses. When only the outgoing leg
// of a savings transfer is imported (the savings account isn't connected) and
// the user hasn't marked it as a transfer, that row is the saving itself: it
// must count once, as saved, not again as spending.
//
// Strict by design: a missed match leaves the old double count, but a false one
// makes a real purchase vanish from the cashflow, which is worse. A row matches
// a saving only when ALL of these hold:
//   - it is spend in that month, not owned by a fixed-expense envelope;
//   - its amount is within 1 % (at least 1 kr) of the saving;
//   - it carries a transfer signal (an account number or a "Til:" prefix, as
//     `transferSuggestions` uses) AND names the saving as a whole word.
// A saving is skipped for the month when a row already netted out as a
// transfer is within tolerance of it (that leg was handled), and in months
// whose savings list is a guess (a past month with no recorded snapshot).
// A saving with more than one candidate row, or a row more than one saving
// could claim, matches nothing.
import type { DailyTransaction, Saving } from '../context/FinanceContext';
import { isSpend } from './spend';
import { buildMatchHaystack, normalizeMatchText } from './text';
import { hasTransferSignal } from './transferSuggestions';
import { savingsForMonth, type MonthSavingsInput } from './savingsRate';

/** How far a row's amount may sit from the saving: 1 %, at least 1 kr. */
export function savingsMatchTolerance(amount: number): number {
  return Math.max(1, amount * 0.01);
}

/** A month's savings, and whether that list is real enough to match rows against. */
export interface MonthSavings {
  savings: Saving[];
  matchable: boolean;
}

/** What `monthlyCashflow` needs to report savings and match their imported legs. */
export interface CashflowSavings {
  forMonth: (month: string) => MonthSavings;
  /** Rows already netted out as internal transfers (not in the cashflow's rows). */
  netted: DailyTransaction[];
}

/**
 * `monthKey`'s savings (`savingsForMonth`), matchable only when the list is the
 * one that applied then: a month with a recorded snapshot, or the current month
 * on. A saving carries no creation date, so a past month without a snapshot
 * would otherwise let today's list claim rows from before the saving existed.
 */
export function cashflowSavingsForMonth(
  data: MonthSavingsInput,
  monthKey: string,
  nowKey: string,
  income: number,
): MonthSavings {
  const recorded = data.balanceSnapshots[monthKey]?.fixedExpenses !== undefined;
  return {
    savings: savingsForMonth(data, monthKey, nowKey, income),
    matchable: monthKey >= nowKey || recorded,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `name` appears in the row's text as a whole word or phrase. */
function namesSaving(tx: DailyTransaction, name: string): boolean {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'u');
  return re.test(buildMatchHaystack(tx.merchant, tx.description));
}

export interface SavingMatch {
  savingId: string;
  txId: string;
  /** What the matched row actually moved. */
  amount: number;
}

export interface SavingsMatchOptions {
  /** Rows already netted out as transfers; a saving with one in tolerance is skipped. */
  netted?: DailyTransaction[];
  /** Rows another reconciliation owns (a fixed expense's envelope). */
  isClaimed?: (tx: DailyTransaction) => boolean;
}

/** The one-to-one matches between `savings` and `monthKey`'s spend rows. */
export function matchSavingsToTransactions(
  savings: Saving[],
  transactions: DailyTransaction[],
  monthKey: string,
  { netted = [], isClaimed = () => false }: SavingsMatchOptions = {},
): SavingMatch[] {
  const inMonth = (tx: DailyTransaction) => tx.date.startsWith(monthKey) && Number.isFinite(tx.amount) && tx.amount > 0;
  const pool = transactions.filter((tx) => inMonth(tx) && isSpend(tx) && !isClaimed(tx) && hasTransferSignal(tx));
  const nettedInMonth = netted.filter(inMonth);
  const candidates = new Map<string, DailyTransaction[]>();
  const claimants = new Map<string, number>();
  for (const s of savings) {
    if (s.paused || !Number.isFinite(s.amount) || s.amount <= 0) continue;
    const name = normalizeMatchText(s.name);
    if (name.length < 3) continue;
    const tolerance = savingsMatchTolerance(s.amount);
    const near = (tx: DailyTransaction) => Math.abs(tx.amount - s.amount) <= tolerance;
    if (nettedInMonth.some(near)) continue; // this saving's leg was already netted
    const hits = pool.filter((tx) => near(tx) && namesSaving(tx, name));
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
