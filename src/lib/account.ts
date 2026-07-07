import type { DailyTransaction } from '../context/FinanceContext';

/**
 * The label a transaction's account is shown and grouped under: the user's
 * custom name if set, else the bank-provided account name, else the bank name.
 * Returns null for manual rows (no connected account). Two accounts given the
 * same custom name resolve to the same label — that's how "merging" works.
 */
export function accountGroupLabel(tx: DailyTransaction, accountLabels: Record<string, string>): string | null {
  if (!tx.account) return null;
  return accountLabels[tx.account] || tx.accountName || tx.bank || null;
}

/**
 * The key a transaction groups/filters under. A custom label groups every account
 * that shares it (opt-in "merge"); otherwise each account is its own group keyed
 * by its account id — so filtering scopes to the *specific* account, not to
 * everything that happens to share a bank-provided holder name.
 */
export function accountGroupKey(tx: DailyTransaction, accountLabels: Record<string, string>): string | null {
  if (!tx.account) return null;
  return accountLabels[tx.account] || tx.account;
}
