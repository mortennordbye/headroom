import { useMemo } from 'react';
import { format } from 'date-fns';
import { useFinance, useFinanceSettings, type BalanceSnapshot } from '../context/FinanceContext';
import {
  resolveMonthView, buildManualSnapshot, snapshotBalances, type MonthMode,
} from '../lib/snapshots';
import { projectSnapshotBalances, type ProjectionRates } from '../lib/projectBalances';

export interface BalanceHistory {
  /** The month being shown ('yyyy-MM'). For a past month the freely-picked header
   *  month is snapped to the latest recorded snapshot at or before it; for the
   *  current or a future month it is the picked month itself. */
  activeKey: string;
  /** How `snapshot` was obtained — recorded fact, live state, or computed. */
  mode: MonthMode;
  /** True when viewing the current month — the page is editable. */
  isLive: boolean;
  /** True when the figures are a forward projection rather than a record. */
  isProjected: boolean;
  /** The snapshot for the active month: recorded, projected, or null when live. */
  snapshot: BalanceSnapshot | null;
  /** True when there's at least one recorded snapshot to travel to. */
  hasHistory: boolean;
}

/**
 * Balance-page view of the single shared month (`currentMonth`). The whole app
 * tracks one month; balance pages resolve it three ways — a recorded snapshot for
 * the past, live state for today, and a computed projection for the future.
 *
 * The projection exists because the alternative was worse: a future month used to
 * resolve to *live* data, so the page showed today's balances under next month's
 * label and left them editable. Now it shows what the automation will have moved
 * by then, read-only.
 *
 * Nothing here writes. The projected snapshot is assembled per render and never
 * reaches `balanceSnapshots`; the capture effect, the automation rule set and the
 * runner all read the real clock, so they cannot see the picked month at all.
 */
export function useBalanceHistory(): BalanceHistory {
  const {
    balanceSnapshots, liveBalanceSnapshot, automationRules, automationState,
  } = useFinance();
  const {
    currentMonth, projectionIncludeGrowth,
    savingsTargetPercent, growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate,
  } = useFinanceSettings();
  const nowKey = format(new Date(), 'yyyy-MM');
  const viewKey = format(currentMonth, 'yyyy-MM');

  const recordedKeys = useMemo(
    () => Object.keys(balanceSnapshots).sort(),
    [balanceSnapshots],
  );

  const { activeKey, mode } = useMemo(
    () => resolveMonthView(recordedKeys, viewKey, nowKey),
    [recordedKeys, viewKey, nowKey],
  );

  const rates: ProjectionRates | undefined = useMemo(
    () => (projectionIncludeGrowth
      ? { portfolio: growthReturnRate, cash: cashGrowthRate, crypto: cryptoGrowthRate, house: houseGrowthRate }
      : undefined),
    [projectionIncludeGrowth, growthReturnRate, cashGrowthRate, cryptoGrowthRate, houseGrowthRate],
  );

  const projected = useMemo(() => {
    if (mode !== 'projected') return null;
    const base = snapshotBalances(liveBalanceSnapshot, {
      savingsTargetPercent, growthReturnRate, houseGrowthRate,
    });
    return buildManualSnapshot(
      liveBalanceSnapshot,
      projectSnapshotBalances(base, automationRules, automationState, activeKey, nowKey, rates),
    );
  }, [mode, liveBalanceSnapshot, automationRules, automationState, activeKey, nowKey, rates,
      savingsTargetPercent, growthReturnRate, houseGrowthRate]);

  // "Has history" counts recorded months other than the live one — that's what
  // makes the time machine worth showing.
  const hasHistory = recordedKeys.some(k => k !== nowKey);

  return {
    activeKey,
    mode,
    isLive: mode === 'live',
    isProjected: mode === 'projected',
    snapshot: mode === 'live' ? null : mode === 'projected' ? projected : balanceSnapshots[activeKey] ?? null,
    hasHistory,
  };
}
