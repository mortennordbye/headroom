import type { DailyTransaction } from '../context/FinanceContext';
import { useFinance } from '../context/FinanceContext';
import { accountToken } from '../lib/accountColor';

/**
 * A small chip identifying which connected account a bank-imported row came
 * from. Prefers the user's friendly name (Settings → Bank sync), falling back
 * to the bank-provided account name, then the bank name. Renders nothing for
 * manual rows (no account/bank). The colored dot is stable per account.
 */
export function AccountBadge({ tx, size = 'sm' }: { tx: DailyTransaction; size?: 'sm' | 'xs' }) {
  const { accountLabels } = useFinance();
  const custom = tx.account ? accountLabels[tx.account] : undefined;
  const label = custom || tx.accountName || tx.bank;
  if (!label) return null;
  // Color by the display label so merged accounts (same name) share one color,
  // matching the Budget page's account-filter pills.
  const token = accountToken(label);
  const dot = size === 'xs' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  const text = size === 'xs' ? 'text-[10px]' : 'text-[11px]';
  return (
    <span
      className={`inline-flex items-center gap-1 ${text} font-medium whitespace-nowrap`}
      style={{ color: 'var(--text-2)' }}
      title={tx.bank ? `${label} · ${tx.bank}` : label}
    >
      <span className={`${dot} rounded-full shrink-0`} style={{ backgroundColor: `var(${token})` }} />
      {label}
    </span>
  );
}
