/**
 * Derived figures for homes for sale and sold homes, as shown on the Bolig
 * page's Marked tab. Pure and NaN-safe: a missing input yields null, never NaN.
 */
import type { ComparableSale } from './marketValuation';

export interface MarketListing {
  url: string;
  address?: string | null;
  unit?: string | null;
  postnr?: string | null;
  area?: string | null;
  bra?: number | null;
  bedrooms?: number | null;
  floor?: number | null;
  askingPrice?: number | null;
  fellesgjeld?: number | null;
  felleskost?: number | null;
  status?: string | null;
  /** 'YYYY-MM-DD' */
  firstSeen: string;
  lastSeen: string;
  firstAskingPrice?: number | null;
}

export interface ListingMetrics {
  /** Asking price + fellesgjeld. */
  totalPrice: number | null;
  totalPerSqm: number | null;
  /** Current asking price minus the first one recorded (negative = reduced). */
  priceChange: number | null;
  /** Days between the first and last time the listing was seen. */
  daysListed: number;
}

const positive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 86_400_000) : 0;
}

export function listingMetrics(l: MarketListing): ListingMetrics {
  const totalPrice = positive(l.askingPrice) ? l.askingPrice + (positive(l.fellesgjeld) ? l.fellesgjeld : 0) : null;
  const priceChange =
    positive(l.askingPrice) && positive(l.firstAskingPrice) ? l.askingPrice - l.firstAskingPrice : null;
  return {
    totalPrice,
    totalPerSqm: totalPrice != null && positive(l.bra) ? Math.round(totalPrice / l.bra) : null,
    priceChange,
    daysListed: daysBetween(l.firstSeen, l.lastSeen),
  };
}

/** Total price per m² of a sold home (sold price + fellesgjeld), or null. */
export function saleTotalPerSqm(s: ComparableSale): number | null {
  if (!positive(s.soldPrice) || !positive(s.bra)) return null;
  return Math.round((s.soldPrice + (positive(s.fellesgjeld) ? s.fellesgjeld : 0)) / s.bra);
}

/** Sold over (+) or under (−) asking, in percent with one decimal, or null. */
export function saleOverAskingPct(s: ComparableSale): number | null {
  if (!positive(s.soldPrice) || !positive(s.askingPrice)) return null;
  return Math.round((s.soldPrice / s.askingPrice - 1) * 1000) / 10;
}


export type SortDir = 'asc' | 'desc';

/**
 * Stable sort by one column. Missing values (null/undefined/NaN) always go
 * last, whichever the direction, so a sparse column never buries real rows.
 * Text sorts in Norwegian order with numbers compared as numbers ("3B" < "10A").
 */
export function sortRows<T>(rows: T[], value: (r: T) => number | string | null | undefined, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const missing = (v: unknown) => v == null || (typeof v === 'number' && !Number.isFinite(v));
  return rows
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      const am = missing(a.v);
      const bm = missing(b.v);
      if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
      const c = typeof a.v === 'string' || typeof b.v === 'string'
        ? String(a.v).localeCompare(String(b.v), 'nb', { numeric: true, sensitivity: 'base' })
        : (a.v as number) - (b.v as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * Whether `v` lies within [min, max]; an unset bound is open. With any bound
 * set, a missing value is outside (a row without a size can't match "50–70 m²").
 */
export function inRange(v: number | null | undefined, min?: number | null, max?: number | null): boolean {
  const hasMin = min != null && Number.isFinite(min);
  const hasMax = max != null && Number.isFinite(max);
  if (!hasMin && !hasMax) return true;
  if (v == null || !Number.isFinite(v)) return false;
  return (!hasMin || v >= (min as number)) && (!hasMax || v <= (max as number));
}
