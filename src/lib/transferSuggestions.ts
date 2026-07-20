// Finds spend transactions that look like moves between the user's own accounts
// and proposes a `TransferRule` for each destination. One-legged transfers (the
// counterpart account isn't connected) can't be proven by `transfers.ts`, and
// tagging them one at a time is tedious — this surfaces the handful worth asking
// about, ranked by how much they distort the savings rate.
//
// Deliberately name-free: the signals are structural (an account number, a
// "Til:" prefix, a round amount, recurrence across months), never a list of bank
// or merchant names, so it works for any bank and stays shareable.
//
// Suggestions are proposals only — a payment to a person and a credit-card
// settlement look alike from the outside, so the user confirms each one.
import type { DailyTransaction } from '../context/FinanceContext';
import { buildMatchHaystack } from './text';
import { isSpend } from './monthlyCashflow';
import { findInternalTransferIds } from './transfers';
import { matchesTransferRule, type TransferRule } from './transferRules';

/** Norwegian account number: 4-2-5 digits, dot- or space-separated. */
const ACCOUNT_NUMBER = /\b\d{4}[.\s]\d{2}[.\s]\d{5}\b/;
/** "Til: <destination>" / "To: <destination>" — a transfer, not a card purchase. */
const TO_PREFIX = /\b(?:til|to)\s*:\s*/;
const TO_DESTINATION = /\b(?:til|to)\s*:\s*([\p{L}\p{N} &*.-]{3,32})/u;

/**
 * Below this the noise (splitting a bill, paying a friend back) outweighs the
 * signal. Real own-account moves are large or repeat; small one-offs are not
 * worth asking about.
 */
export const MIN_SUGGESTION_TOTAL = 2000;

export type TransferSignal = 'accountNumber' | 'toPrefix' | 'roundAmount' | 'recurring';

export interface TransferSuggestion {
  /** The substring to store as the rule's `match`. */
  match: string;
  /** Transactions this rule would net out. */
  txCount: number;
  /** Distinct 'yyyy-MM' months they span. */
  months: number;
  /** Total kroner that would stop counting as spend. */
  total: number;
  /** Why it was flagged, strongest first — shown to the user. */
  signals: TransferSignal[];
}

/**
 * The destination a rule should match on: the account number if there is one,
 * else the text after "Til:", else the merchant. Lowercased because
 * `matchesTransferRule` compares case-insensitively.
 */
function destinationKey(tx: DailyTransaction): string | null {
  const hay = buildMatchHaystack(tx.merchant, tx.description).toLowerCase();
  const acct = ACCOUNT_NUMBER.exec(hay);
  if (acct) return acct[0];
  const to = TO_DESTINATION.exec(hay);
  if (to) {
    // Trim trailing noise a statement appends after the payee ("… betalt: 21.05.26").
    const dest = to[1].replace(/\s+(betalt|paid|betaling)\b.*$/, '').trim();
    if (dest.length >= 3) return dest;
  }
  const merchant = (tx.merchant ?? '').trim().toLowerCase();
  return merchant.length >= 3 ? merchant : null;
}

function signalsFor(tx: DailyTransaction): TransferSignal[] {
  const hay = buildMatchHaystack(tx.merchant, tx.description).toLowerCase();
  const out: TransferSignal[] = [];
  if (ACCOUNT_NUMBER.test(hay)) out.push('accountNumber');
  if (TO_PREFIX.test(hay)) out.push('toPrefix');
  if (tx.amount >= 1000 && tx.amount % 1000 === 0) out.push('roundAmount');
  return out;
}

/**
 * Rank the own-account transfers worth proposing a rule for. Skips anything an
 * existing rule already covers, anything already proven internal by a matched
 * two-legged pair, and anything too small to matter.
 */
export function suggestTransferRules(
  txs: DailyTransaction[],
  existingRules: TransferRule[],
  minTotal: number = MIN_SUGGESTION_TOTAL,
): TransferSuggestion[] {
  const alreadyInternal = findInternalTransferIds(txs);
  const groups = new Map<string, { txs: DailyTransaction[]; signals: Set<TransferSignal> }>();

  for (const tx of txs) {
    if (!isSpend(tx)) continue;
    if (alreadyInternal.has(tx.id)) continue;
    if (matchesTransferRule(tx, existingRules)) continue;
    const signals = signalsFor(tx);
    // A structural signal is required: a round amount alone is just a big purchase.
    if (!signals.includes('accountNumber') && !signals.includes('toPrefix')) continue;
    const key = destinationKey(tx);
    if (!key) continue;
    const g = groups.get(key) ?? { txs: [], signals: new Set<TransferSignal>() };
    g.txs.push(tx);
    for (const s of signals) g.signals.add(s);
    groups.set(key, g);
  }

  const out: TransferSuggestion[] = [];
  for (const [match, g] of groups) {
    const total = g.txs.reduce((s, tx) => s + tx.amount, 0);
    const months = new Set(g.txs.map((tx) => tx.date.slice(0, 7))).size;
    if (months > 1) g.signals.add('recurring');
    // Recurring moves earn their place even when each one is modest.
    if (total < minTotal && months < 3) continue;
    const order: TransferSignal[] = ['accountNumber', 'recurring', 'toPrefix', 'roundAmount'];
    out.push({
      match, total, months, txCount: g.txs.length,
      signals: order.filter((s) => g.signals.has(s)),
    });
  }
  // Biggest distortion first — that's the one worth the user's attention.
  return out.sort((a, b) => b.total - a.total);
}
