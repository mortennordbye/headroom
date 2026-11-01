// A bank-notified mortgage rate ("Varslet nominell rente") is stored next to the
// current rate with the month it applies from. Once that month arrives the
// notified rate is the current rate. It is applied when the live slice is read,
// not written into stored data on a timer: a recorded month keeps the rate it
// recorded, and an explicit rate edit (applied over this result) wins.

/** The homeowner fields read here. Loose: imported blobs may lack any of them. */
export interface NotifiedRateFields {
  rente?: number;
  notifiedRate?: number;
  notifiedRateFrom?: string;
}

const isMonthKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}/.test(v);

/**
 * The homeowner slice as of `monthKey`: when a notified rate is due (its month
 * is `monthKey` or earlier) it becomes `rente` and the notified fields are
 * dropped. Otherwise the slice is returned unchanged (same object). A notified
 * rate with no valid month, or a non-positive or non-finite one, never applies.
 */
export function withNotifiedRate<T extends NotifiedRateFields>(h: T, monthKey: string): T;
export function withNotifiedRate<T extends NotifiedRateFields>(h: T | null | undefined, monthKey: string): T | null | undefined;
export function withNotifiedRate<T extends NotifiedRateFields>(h: T | null | undefined, monthKey: string): T | null | undefined {
  if (!h) return h;
  const rate = h.notifiedRate;
  const from = h.notifiedRateFrom;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return h;
  if (!isMonthKey(from) || !isMonthKey(monthKey) || monthKey.slice(0, 7) < from.slice(0, 7)) return h;
  const { notifiedRate: _rate, notifiedRateFrom: _from, ...rest } = h;
  return { ...rest, rente: rate } as T;
}
