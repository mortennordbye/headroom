import { useMemo, useState } from 'react';
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
  const { balanceSnapshots } = useFinance();
  const nowKey = format(new Date(), 'yyyy-MM');

  const monthKeys = useMemo(() => {
    const keys = new Set(Object.keys(balanceSnapshots));
    keys.add(nowKey); // the live month is always selectable
    return Array.from(keys).sort();
  }, [balanceSnapshots, nowKey]);

  const [activeKey, setActiveKey] = useState(nowKey);

  const rawIdx = monthKeys.indexOf(activeKey);
  const idx = rawIdx === -1 ? monthKeys.length - 1 : rawIdx; // clamp if the key vanished
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
    goPrev: () => setActiveKey(monthKeys[Math.max(0, idx - 1)]),
    goNext: () => setActiveKey(monthKeys[Math.min(monthKeys.length - 1, idx + 1)]),
    goLive: () => setActiveKey(nowKey),
  };
}
