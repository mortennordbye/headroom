import { useMemo } from 'react';
import { format } from 'date-fns';
import { useFinance, type BalanceSnapshot } from '../context/FinanceContext';

export interface BalanceHistory {
  /** Sorted 'yyyy-MM' keys the user can step through (recorded snapshots + the live month). */
  monthKeys: string[];
  /** The month currently being viewed. */
  activeKey: string;
  /** True when viewing the live (current) month — the page is editable. */
  isLive: boolean;
  /** The snapshot for the active month, or null when live. */
  snapshot: BalanceSnapshot | null;
  /** True when there's at least one past snapshot to travel to (otherwise hide the bar). */
  hasHistory: boolean;
  canPrev: boolean;
  canNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  goLive: () => void;
}

/**
 * Shared state for the balance-page "time machine". Steps only through months that
 * actually have a recorded snapshot (plus the live month), so the user can never
 * land on an empty month and see misleading data.
 */
export function useBalanceHistory(): BalanceHistory {
  const { balanceSnapshots, historyMonth, setHistoryMonth } = useFinance();
  const nowKey = format(new Date(), 'yyyy-MM');

  const monthKeys = useMemo(() => {
    const keys = new Set(Object.keys(balanceSnapshots));
    keys.add(nowKey); // the live month is always selectable
    return Array.from(keys).sort();
  }, [balanceSnapshots, nowKey]);

  // The active month comes from the shared context slice (null = live), so a
  // month picked on one balance page carries to the others. Clamp a vanished or
  // never-recorded key back to live so we never land on an empty month.
  const rawIdx = historyMonth ? monthKeys.indexOf(historyMonth) : -1;
  const idx = rawIdx === -1 ? monthKeys.length - 1 : rawIdx;
  const key = monthKeys[idx];
  const isLive = key === nowKey;

  return {
    monthKeys,
    activeKey: key,
    isLive,
    snapshot: isLive ? null : balanceSnapshots[key] ?? null,
    hasHistory: monthKeys.length > 1,
    canPrev: idx > 0,
    canNext: idx < monthKeys.length - 1,
    goPrev: () => setHistoryMonth(monthKeys[Math.max(0, idx - 1)]),
    goNext: () => {
      const nextKey = monthKeys[Math.min(monthKeys.length - 1, idx + 1)];
      setHistoryMonth(nextKey === nowKey ? null : nextKey);
    },
    goLive: () => setHistoryMonth(null),
  };
}
