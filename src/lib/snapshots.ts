import type { BalanceSnapshot, Debt, SavingsAccount } from '../context/FinanceContext';

/**
 * The snapshot to default a backfilled month from: the nearest *older* recorded
 * month if one exists (loan params/assumptions carry forward from before), else
 * the nearest *newer* one. Returns null when there are no snapshots at all.
 *
 * `monthKey` itself is ignored as a source even if present, so "edit an existing
 * month's advanced defaults" still pulls from a neighbour rather than itself.
 */
export function nearestSnapshot(
  snapshots: Record<string, BalanceSnapshot>,
  monthKey: string,
): BalanceSnapshot | null {
  const others = Object.keys(snapshots).filter(k => k !== monthKey).sort();
  if (others.length === 0) return null;
  const older = others.filter(k => k < monthKey).pop();
  if (older) return snapshots[older];
  const newer = others.find(k => k > monthKey);
  return newer ? snapshots[newer] : null;
}

/**
 * Map the single shared month to the balance snapshot a balance page should show.
 * The whole app tracks one freely-picked month; balance pages can't render a month
 * that was never recorded, so:
 *   - current or future month → live (editable current state); `isLive: true`.
 *   - past month → the latest recorded snapshot at or before it, else (nothing
 *     recorded that early) the earliest recorded month, so we never fall back to
 *     live data under a past-month label. `isLive: false`.
 * With no recorded months at all, a past view degrades to the live month key.
 */
export function snapToRecordedMonth(
  recordedKeys: string[],
  viewKey: string,
  nowKey: string,
): { activeKey: string; isLive: boolean } {
  if (viewKey >= nowKey) return { activeKey: nowKey, isLive: true };
  const sorted = [...recordedKeys].sort();
  const atOrBefore = sorted.filter(k => k <= viewKey);
  if (atOrBefore.length) return { activeKey: atOrBefore[atOrBefore.length - 1], isLive: false };
  return { activeKey: sorted[0] ?? nowKey, isLive: false };
}

/** The balances a person can realistically reconstruct for a past month. */
export interface SnapshotBalances {
  savingsAccounts: SavingsAccount[];
  bsu: number;
  bufferAccount: number;
  portfolio: number;
  crypto: number;
  houseValue: number;
  houseDebt: number;
  debts: Debt[];
  otpBalance: number;
  ipsBalance: number;
  assumptions?: { savingsTargetPercent: number; growthReturnRate: number; houseGrowthRate: number };
}

/**
 * Assemble a manual snapshot from a `base` (nearest recorded month, or the live
 * state) with the user-entered balances overlaid. Crucially it re-applies the
 * house three-slice mirror (assets ↔ homeowner ↔ transition) so the stored
 * snapshot can never show a mortgage/house figure that contradicts itself — the
 * same invariant the live `updateAsset`/`updateHomeowner` mirror keeps. Loan
 * params, fixed expenses and category budgets carry over from `base` untouched.
 */
export function buildManualSnapshot(base: BalanceSnapshot, b: SnapshotBalances): BalanceSnapshot {
  return {
    ...base,
    assets: {
      ...base.assets,
      savings: 0,
      savingsAccounts: b.savingsAccounts,
      bsu: b.bsu,
      bufferAccount: b.bufferAccount,
      portfolio: b.portfolio,
      crypto: b.crypto,
      houseValue: b.houseValue,
      houseDebt: b.houseDebt,
    },
    homeowner: { ...base.homeowner, currentMortgageBalance: b.houseDebt },
    transition: { ...base.transition, currentMortgageBalance: b.houseDebt, currentHouseValue: b.houseValue },
    pension: { ...base.pension, otpBalance: b.otpBalance, ipsBalance: b.ipsBalance },
    debts: b.debts,
    assumptions: b.assumptions ?? base.assumptions,
    source: 'manual',
    v: 2,
  };
}

/** A month row for the History manager grid. */
export interface HistoryRow {
  monthKey: string;
  /** 'auto' recorded by the capture effect, 'manual' backfilled, 'missing' none. */
  state: 'auto' | 'manual' | 'missing';
}

/**
 * Every month from the earliest record (or `from`, whichever is earlier) through
 * `nowKey` inclusive, newest first, each tagged recorded-auto / recorded-manual /
 * missing. `monthsBefore` extends the grid that many months before the earliest
 * anchor so the user can backfill further back than any existing record.
 */
export function historyRows(
  snapshots: Record<string, BalanceSnapshot>,
  history: Record<string, number>,
  nowKey: string,
  monthsBefore = 0,
): HistoryRow[] {
  const anchors = [...Object.keys(snapshots), ...Object.keys(history), nowKey].sort();
  const earliest = anchors[0];
  const [ey, em] = earliest.split('-').map(Number);
  const [ny, nm] = nowKey.split('-').map(Number);
  const start = ey * 12 + (em - 1) - monthsBefore;
  const end = ny * 12 + (nm - 1);
  const rows: HistoryRow[] = [];
  for (let m = end; m >= start; m--) {
    const y = Math.floor(m / 12);
    const mo = (m % 12) + 1;
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    const snap = snapshots[key];
    rows.push({
      monthKey: key,
      state: snap ? (snap.source === 'manual' ? 'manual' : 'auto') : 'missing',
    });
  }
  return rows;
}
