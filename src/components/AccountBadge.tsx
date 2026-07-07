import type { DailyTransaction } from '../context/FinanceContext';

// Six categorical chart tokens; a transaction's account maps to a stable one.
const ACCOUNT_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];

function accountToken(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ACCOUNT_TOKENS[Math.abs(hash) % ACCOUNT_TOKENS.length];
}

/**
 * A small chip identifying which connected account a bank-imported row came
 * from. Renders nothing for manual rows (no account/bank). The colored dot is
 * stable per account so the same account reads the same across the ledger.
 */
export function AccountBadge({ tx, size = 'sm' }: { tx: DailyTransaction; size?: 'sm' | 'xs' }) {
  const label = tx.accountName || tx.bank;
  if (!label) return null;
  const token = accountToken(tx.account || label);
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
