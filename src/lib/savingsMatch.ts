// Match each planned saving against the month's imported transactions, the way
// `reconcile` (envelopes.ts) matches fixed expenses. When only the outgoing leg
// of a savings transfer is imported (the savings account isn't connected) and
// the user hasn't marked it as a transfer, that row is the saving itself: it
// must count once, as saved, not again as spending.
//
// Strict by design: a missed match leaves the old double count, but a false one
// makes a real purchase vanish from the cashflow, which is worse. Every Norwegian
// bill payment (nettgiro, avtalegiro) carries "til:" and an account number, so
// the match is on the payee alone, by equality. A row matches a saving only when
// ALL of these hold:
//   - it is spend in that month, not owned by a fixed-expense envelope;
//   - its amount is within 1 % (at least 1 kr) of the saving;
//   - it carries no bill marker (avtalegiro, faktura, KID, lån, a legal-entity
//     suffix like AS, ...);
//   - its destination (the text after "Til:", or "To:" at the start, with
//     account numbers, dates and a trailing "Betalt: ..." removed) EQUALS the
//     saving's name, or the name with "konto", "sparing" or "sparekonto"
//     before or after it.
// A saving is skipped for the month when a row already netted out as a
// transfer is within tolerance of it (that leg was handled), and in months
// whose savings list is a guess (a past month with no recorded snapshot).
// A saving with more than one candidate row, or a row more than one saving
// could claim, matches nothing.
import type { DailyTransaction, Saving } from '../context/FinanceContext';
import { isSpend } from './spend';
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

/** Lowercased, NFC, whitespace collapsed: both sides of the comparison go through this. */
function normalize(raw: string): string {
  return raw.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Words that mark a bill or a company payment, never a move to the user's own savings. */
const BILL_MARKERS = new Set([
  'avtalegiro', 'efaktura', 'e-faktura', 'kid', 'faktura', 'lån', 'avdrag',
  'as', 'asa', 'ans', 'da', 'ab', 'inc', 'ltd',
]);

/** Tokens split on anything but letters, digits and `-` (so "bil-lån" is one word). */
function tokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
}

function hasBillMarker(text: string): boolean {
  return tokens(text).some((t) => BILL_MARKERS.has(t) || t.split('-').some((part) => BILL_MARKERS.has(part)));
}

// "til:" anywhere at a word edge ("Nettgiro til: …"); English "to:" only at the
// start, so it can't fire inside a longer text.
const TIL_PREFIX = /(?<![\p{L}\p{N}-])til\s*:\s*/u;
const TO_PREFIX = /^to\s*:\s*/;
const ACCOUNT_NUMBER = /\b(?:no\d{2}\s?)?\d{4}[.\s]?\d{2}[.\s]?\d{5}\b/g;
const DATE = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const TRAILER = /\s(?:betalt|paid|betaling)\b.*$/;

/** The payee a transfer text names, cleaned for comparison; null when there is none. */
function destinationOf(field: string | undefined): string | null {
  const text = normalize(field ?? '');
  const prefix = TIL_PREFIX.exec(text) ?? TO_PREFIX.exec(text);
  if (!prefix) return null;
  const dest = text
    .slice(prefix.index + prefix[0].length)
    .replace(TRAILER, '')
    .replace(ACCOUNT_NUMBER, ' ')
    .replace(DATE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return dest || null;
}

const NAME_SUFFIXES = ['konto', 'sparing', 'sparekonto'];

/** Whether `dest` is the saving's name, alone or with an allowed suffix either side. */
function destinationIsSaving(dest: string, name: string): boolean {
  if (dest === name) return true;
  return NAME_SUFFIXES.some((x) => dest === `${name} ${x}` || dest === `${name}${x}` || dest === `${x} ${name}`);
}

/** Whether the row is a transfer to the saving named `name` (already normalised). */
function isTransferToSaving(tx: DailyTransaction, name: string): boolean {
  if (hasBillMarker(normalize(`${tx.merchant ?? ''} ${tx.description ?? ''}`))) return false;
  const dest = destinationOf(tx.description) ?? destinationOf(tx.merchant);
  return dest !== null && destinationIsSaving(dest, name);
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
  const pool = transactions.filter((tx) => inMonth(tx) && isSpend(tx) && !isClaimed(tx));
  const nettedInMonth = netted.filter(inMonth);
  const candidates = new Map<string, DailyTransaction[]>();
  const claimants = new Map<string, number>();
  for (const s of savings) {
    if (s.paused || !Number.isFinite(s.amount) || s.amount <= 0) continue;
    const name = normalize(s.name);
    if (name.length < 3) continue;
    const tolerance = savingsMatchTolerance(s.amount);
    const near = (tx: DailyTransaction) => Math.abs(tx.amount - s.amount) <= tolerance;
    if (nettedInMonth.some(near)) continue; // this saving's leg was already netted
    const hits = pool.filter((tx) => near(tx) && isTransferToSaving(tx, name));
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
