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
 * How the picked month relates to reality:
 *   'live'      — today. Real balances, editable.
 *   'recorded'  — a past month, read back from a captured snapshot.
 *   'projected' — a future month, computed from today's balances plus the
 *                 automation that has not run yet. Never stored, never editable.
 */
export type MonthMode = 'live' | 'recorded' | 'projected';

/**
 * How far ahead a balance page will project. Beyond this the picker stops
 * stepping: the projection holds income at today's figure, so a balance five
 * years out would read as precision it does not have.
 */
export const PROJECTION_HORIZON_MONTHS = 24;

/**
 * Map the single shared month to what a balance page should show.
 * The whole app tracks one freely-picked month, and a balance page can only
 * render a month it can account for:
 *   - future month → 'projected'; the caller computes it from live state.
 *   - current month → 'live' (editable current state).
 *   - past month → the latest recorded snapshot at or before it, else the earliest
 *     recorded month, so we never land on an empty month.
 * The mode is derived from the *resolved* month, not the picked one: if we snapped
 * to the current month (because nothing older exists — e.g. only this month has been
 * captured, the common case), the page is live and editable, never today's data
 * shown read-only under a past label.
 */
export function resolveMonthView(
  recordedKeys: string[],
  viewKey: string,
  nowKey: string,
): { activeKey: string; mode: MonthMode } {
  if (viewKey > nowKey) return { activeKey: viewKey, mode: 'projected' };
  if (viewKey === nowKey) return { activeKey: nowKey, mode: 'live' };
  const sorted = [...recordedKeys].sort();
  const atOrBefore = sorted.filter(k => k <= viewKey);
  const activeKey = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : (sorted[0] ?? nowKey);
  return { activeKey, mode: activeKey === nowKey ? 'live' : 'recorded' };
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
 * Read the balances back out of a snapshot. Used both to seed the manual-backfill
 * editor and as the starting point a forward projection grows from, so the two
 * always agree on which fields count as "a balance".
 */
export function snapshotBalances(
  base: BalanceSnapshot,
  fallbackAssumptions: { savingsTargetPercent: number; growthReturnRate: number; houseGrowthRate: number },
): SnapshotBalances {
  const a = base.assets;
  return {
    savingsAccounts: (a.savingsAccounts ?? []).map(s => ({ ...s })),
    bsu: a.bsu ?? 0,
    bufferAccount: a.bufferAccount ?? 0,
    portfolio: a.portfolio ?? 0,
    crypto: a.crypto ?? 0,
    houseValue: a.houseValue ?? 0,
    houseDebt: a.houseDebt ?? 0,
    debts: (base.debts ?? []).map(d => ({ ...d })),
    otpBalance: base.pension?.otpBalance ?? 0,
    ipsBalance: base.pension?.ipsBalance ?? 0,
    assumptions: base.assumptions ?? fallbackAssumptions,
  };
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
