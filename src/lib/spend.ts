// The app's single "does this row count as spending?" predicate.
//
// It used to live in monthlyCashflow.ts, but that module imports envelopes.ts, so
// the envelope math could not reuse it without a cycle — and drifted as a result:
// categoryStats excluded income-categorised rows while the envelope/discretionary
// path did not, so one 499 kr row sat inside the "Brukt" headline while being
// absent from the category breakdown it was supposed to add up to. Own module, no
// dependencies, imported by everyone.
import type { DailyTransaction } from '../context/FinanceContext';

/**
 * Whether a transaction counts as spend (money out).
 *
 * Income is excluded on BOTH signals. `kind` is the primary one, but a row can
 * carry kind:'expense' while categorised 'income' — a mis-signed import, or a
 * refund the user recategorised — and counting that as spend both inflates the
 * totals and puts an "Inntekt" bar in the spend breakdown.
 *
 * A missing `kind` is treated as an expense (legacy rows).
 */
export function isSpend(tx: DailyTransaction): boolean {
  return tx.kind !== 'income' && tx.category !== 'income';
}
