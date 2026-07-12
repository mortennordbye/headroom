// Lifecycle for "buffer builder" fixed expenses — the self-removing monthly
// contributions the emergency-fund recommendation creates. Each carries a
// `bufferTargetAmount`: once the buffer account reaches it, the contribution has
// done its job and is removed. Pure + unit-tested so the context effect that
// deletes them holds no money logic.
import type { FixedExpense } from '../context/FinanceContext';

/**
 * Ids of buffer-builder expenses whose target the buffer has reached (or passed).
 * A row qualifies only when it feeds the buffer AND carries a positive target, so
 * ordinary buffer contributions (no target) and other destinations are never
 * touched. Empty when nothing has matured.
 */
export function bufferBuilderIdsToRemove(expenses: FixedExpense[], bufferBalance: number): string[] {
  return expenses
    .filter(
      (e) =>
        e.destinationKind === 'bufferAccount' &&
        typeof e.bufferTargetAmount === 'number' &&
        e.bufferTargetAmount > 0 &&
        bufferBalance >= e.bufferTargetAmount,
    )
    .map((e) => e.id);
}
