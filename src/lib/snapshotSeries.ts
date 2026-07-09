import type { BalanceSnapshot } from '../context/FinanceContext';

// Per-account savings and pension balance trends over recorded months
// (HISTORY_PLAN §6.5). Derived from snapshots; nothing stored twice. All values
// finite-guarded so a hand-edited balance can't NaN a chart.

const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

export interface SavingsSeries {
  /** One row per recorded month, oldest → newest: `month` (yyyy-MM) plus each
   *  account's balance keyed by id (a numeric-or-string index, the standard
   *  Recharts dynamic-key row shape). */
  rows: Array<Record<string, number | string>>;
  /** The accounts to draw a line for (union across months, latest name wins). */
  accounts: Array<{ id: string; name: string }>;
}

export function savingsSeriesFrom(snapshots: Record<string, BalanceSnapshot>): SavingsSeries {
  const months = Object.keys(snapshots).sort();
  // Union of accounts across all months; a later month's name wins (renames).
  const nameById = new Map<string, string>();
  for (const m of months) {
    for (const a of snapshots[m].assets?.savingsAccounts ?? []) {
      if (a && typeof a.id === 'string') nameById.set(a.id, a.name ?? a.id);
    }
  }
  const accounts = [...nameById].map(([id, name]) => ({ id, name }));

  const rows: Array<Record<string, number | string>> = months.map(m => {
    const byId = new Map((snapshots[m].assets?.savingsAccounts ?? []).map(a => [a.id, finite(a.balance)]));
    const row: Record<string, number | string> = { month: m };
    for (const { id } of accounts) row[id] = byId.get(id) ?? 0;
    return row;
  });

  return { rows, accounts };
}

export interface PensionSeriesRow {
  month: string;
  otp: number;
  ips: number;
}

export function pensionSeriesFrom(snapshots: Record<string, BalanceSnapshot>): PensionSeriesRow[] {
  return Object.keys(snapshots)
    .sort()
    .map(m => ({
      month: m,
      otp: finite(snapshots[m].pension?.otpBalance),
      ips: finite(snapshots[m].pension?.ipsBalance),
    }));
}
