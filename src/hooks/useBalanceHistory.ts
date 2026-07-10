import { useMemo } from 'react';
import { format } from 'date-fns';
import { useFinance, type BalanceSnapshot } from '../context/FinanceContext';
import { snapToRecordedMonth } from '../lib/snapshots';

export interface BalanceHistory {
  /** The recorded snapshot month being shown ('yyyy-MM'). The freely-picked
   *  header month is snapped to this: the live month when current/future, else
   *  the latest recorded snapshot at or before it. */
  activeKey: string;
  /** True when viewing the current (or a future) month — the page is editable. */
  isLive: boolean;
  /** The snapshot for the active month, or null when live. */
  snapshot: BalanceSnapshot | null;
  /** True when there's at least one recorded snapshot to travel to. */
  hasHistory: boolean;
}

/**
 * Balance-page view of the single shared month (`currentMonth`). The whole app
 * now tracks one month; balance pages can't show data for a month that was never
 * recorded, so they *snap* the picked month to the nearest recorded snapshot at
 * or before it (current/future months are "live" and editable). This keeps the
 * "never render an empty month with misleading live data" contract while the one
 * header picker drives every page.
 */
export function useBalanceHistory(): BalanceHistory {
  const { balanceSnapshots, currentMonth } = useFinance();
  const nowKey = format(new Date(), 'yyyy-MM');
  const viewKey = format(currentMonth, 'yyyy-MM');

  const recordedKeys = useMemo(
    () => Object.keys(balanceSnapshots).sort(),
    [balanceSnapshots],
  );

  const { activeKey, isLive } = useMemo(
    () => snapToRecordedMonth(recordedKeys, viewKey, nowKey),
    [recordedKeys, viewKey, nowKey],
  );

  // "Has history" counts recorded months other than the live one — that's what
  // makes the time machine worth showing.
  const hasHistory = recordedKeys.some(k => k !== nowKey);

  return {
    activeKey,
    isLive,
    snapshot: isLive ? null : balanceSnapshots[activeKey] ?? null,
    hasHistory,
  };
}
