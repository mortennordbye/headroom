// User-defined "this destination is one of my own accounts" rules. A rule maps a
// merchant/description match to the meaning: money to this payee is a move
// between the user's own accounts (a card payment, a savings transfer, a debt
// paydown) — NOT new spending.
//
// The app already nets internal transfers when BOTH legs are imported
// (transfers.ts), but a payment to an account the user hasn't connected has no
// counterpart leg to match. These rules cover that gap: any expense row whose
// text matches a rule is added to the internal-transfer set so it drops out of
// spend, the savings rate, and the category charts. Purely additive — an
// unmatched row keeps its current "counts as spend" default. Pure + unit-tested.
import type { DailyTransaction } from '../context/FinanceContext';
import { buildMatchHaystack } from './text';

export interface TransferRule {
  id: string;
  match: string;
}

/** Whether any rule's match is a (case-insensitive) substring of the tx text. */
export function matchesTransferRule(
  tx: Pick<DailyTransaction, 'merchant' | 'description'>,
  rules: TransferRule[],
): boolean {
  if (!rules || !rules.length) return false;
  const hay = buildMatchHaystack(tx.merchant, tx.description);
  for (const r of rules) {
    const m = (r.match || '').trim().toLowerCase();
    if (m && hay.includes(m)) return true;
  }
  return false;
}
