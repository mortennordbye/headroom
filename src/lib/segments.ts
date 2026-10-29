// A per-row override for how a transaction counts, for the odd row the rules
// can't classify. 'transfer' is money moving between the user's own accounts:
// it drops out of spend, the savings rate and the charts, exactly like a matched
// transfer (excludedTransferIds). 'oneOff' is real spending outside the normal
// month (a car, a deposit): it still counts in cashflow and the savings rate,
// but not in budget pacing or the spending analysis. Absent = ordinary spending.
import type { DailyTransaction } from '../context/FinanceContext';
import { isSpend } from './spend';

export type TransactionSegment = 'transfer' | 'oneOff';

export const TRANSACTION_SEGMENTS: readonly TransactionSegment[] = ['transfer', 'oneOff'];

export function isTransactionSegment(v: unknown): v is TransactionSegment {
  return typeof v === 'string' && (TRANSACTION_SEGMENTS as readonly string[]).includes(v);
}

export function isOneOff(tx: Pick<DailyTransaction, 'segment'>): boolean {
  return tx.segment === 'oneOff';
}

/** The rows that make up a normal month's spending (one-offs left out). */
export function withoutOneOffs<T extends Pick<DailyTransaction, 'segment'>>(txs: T[]): T[] {
  return txs.some(isOneOff) ? txs.filter((tx) => !isOneOff(tx)) : txs;
}

/** Total spent on rows marked as one-offs (income rows never count). */
export function oneOffSpend(txs: DailyTransaction[]): number {
  return txs.reduce((sum, tx) => (isOneOff(tx) && isSpend(tx) ? sum + tx.amount : sum), 0);
}
