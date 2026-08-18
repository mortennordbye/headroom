// Lifecycle for "buffer builder" savings — the self-removing monthly
// contributions the emergency-fund recommendation creates. Each carries a
// `bufferTargetAmount`: once the buffer account reaches it, the contribution has
// done its job and is removed. Pure + unit-tested so the context effect that
// deletes them holds no money logic.
import type { Saving } from '../context/FinanceContext';

/**
 * Ids of buffer-builder savings whose target the buffer has reached (or passed).
 * A row qualifies only when it feeds the buffer AND carries a positive target, so
 * ordinary buffer contributions (no target) and other destinations are never
 * touched. Empty when nothing has matured.
 */
export function bufferBuilderIdsToRemove(savings: Saving[], bufferBalance: number): string[] {
  return savings
    .filter(
      (s) =>
        s.destinationKind === 'bufferAccount' &&
        typeof s.bufferTargetAmount === 'number' &&
        s.bufferTargetAmount > 0 &&
        bufferBalance >= s.bufferTargetAmount,
    )
    .map((s) => s.id);
}
