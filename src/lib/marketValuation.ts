/**
 * Home value from sold comparables: the price per m² that similar homes nearby
 * actually sold for, times the home's size.
 *
 * 1. Candidates: sales of a similar size (±25 % BRA by default) in the last 24
 *    months, from the same street when there are enough, else the same
 *    postnummer.
 * 2. Room count: when the home's bedroom count is known, sales with a stated,
 *    different count are left out, as long as at least `minComps` remain. A
 *    count of 0 counts as "not stated": listing sites report a missing count
 *    as 0, so it can't rule a sale out (except for a home that has 0 itself).
 * 3. Time adjustment: with a price index (SSB kvadratmeterpris per quarter for
 *    the kommune), each sale's price per m² is moved to the latest quarter's
 *    level, so a sale from last year is compared at today's prices.
 * 4. Weights: newer sales count more (half the weight after `halfLifeMonths`),
 *    and sales closer in size count more (down to half at the size limit).
 *
 * Price per m² uses the total price (sold price + fellesgjeld), so a
 * borettslag unit with a big share of joint debt compares fairly with a
 * selveier one; the home's own fellesgjeld is then taken off to give its sale
 * price. The mid is the weighted median, the range the weighted 25th–75th
 * percentile. Returns null when there are too few comparables (the caller
 * falls back to the SSB kommune average).
 */

export interface ComparableSale {
  address: string;
  unit?: string | null;
  postnr?: string | null;
  bra?: number | null;
  bedrooms?: number | null;
  floor?: number | null;
  askingPrice?: number | null;
  soldPrice: number;
  fellesgjeld?: number | null;
  /** 'YYYY-MM-DD' */
  soldOn: string;
  /** Link to the sale's listing, when the import had one. */
  url?: string | null;
}

export interface HomeForValuation {
  address: string;
  postnr?: string | null;
  sizeSqm?: number | null;
  /** Bedrooms (a 2-roms has 1). Used to keep only sales with the same count. */
  bedrooms?: number | null;
  /** The home's own share of joint debt, taken off the total-price estimate. */
  fellesgjeld?: number | null;
}

/** One point of a price index, e.g. SSB kvadratmeterpris: quarter 'YYYYKn'. */
export interface IndexPoint {
  quarter: string;
  price: number | null;
}

export interface UsedComparable extends ComparableSale {
  /** Total price per m² as sold. */
  totalPerSqm: number;
  /** Total price per m² moved to the index's latest quarter (= totalPerSqm without an index). */
  adjustedPerSqm: number;
  /** Relative weight, 0–1 (the most relevant comparable is 1). */
  weight: number;
}

export interface CompsValuation {
  scope: 'street' | 'postnr';
  low: number;
  mid: number;
  high: number;
  perSqm: { low: number; mid: number; high: number };
  /** How many comparables the range is built from. */
  count: number;
  /** True when sales with a different stated bedroom count were left out. */
  sameRooms: boolean;
  /** True when prices were moved to today's level with the index. */
  timeAdjusted: boolean;
  /** Effective number of sales after weighting ((Σw)² / Σw²), over every comparable used. */
  effectiveCount: number;
  /** 'YYYY-MM-DD' of the newest comparable used. */
  newestSoldOn: string;
  /** The newest comparables used, at most `listLimit`. */
  comps: UsedComparable[];
  /** Median sold price over asking price, in percent; null without asking prices. */
  overAskingPct: number | null;
}

export interface ValuationOptions {
  /** 'YYYY-MM-DD' the estimate is made for. */
  asOf: string;
  monthsBack?: number;
  minComps?: number;
  sizeTolerance?: number;
  listLimit?: number;
  /** Price index for the time adjustment (SSB quarters); omitted = no adjustment. */
  index?: IndexPoint[];
  /** Months after which a sale counts half as much as one made on `asOf`. */
  halfLifeMonths?: number;
}

/** The street part of an address: before the first comma and the first digit, lowercased. */
export function streetName(address: string): string {
  const head = address.split(',')[0];
  const m = head.match(/^[^\d]*/);
  return (m ? m[0] : head).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Linear-interpolated percentile of an ascending-sorted, non-empty array. */
function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Weighted percentile: values sorted ascending, each placed at the middle of
 * its share of the total weight, linearly interpolated between neighbours and
 * clamped at the ends. With equal weights the median is the ordinary median.
 */
export function weightedPercentile(points: { value: number; weight: number }[], p: number): number {
  const sorted = [...points].filter((x) => x.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (sorted.length === 0 || !(total > 0)) return NaN;
  let acc = 0;
  const pos = sorted.map((x) => {
    const at = (acc + x.weight / 2) / total;
    acc += x.weight;
    return at;
  });
  if (p <= pos[0]) return sorted[0].value;
  for (let i = 1; i < sorted.length; i++) {
    if (p <= pos[i]) {
      const f = (p - pos[i - 1]) / (pos[i] - pos[i - 1]);
      return sorted[i - 1].value + f * (sorted[i].value - sorted[i - 1].value);
    }
  }
  return sorted[sorted.length - 1].value;
}

function monthsBefore(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, ms / (30.4375 * 86_400_000)) : 0;
}

/**
 * Bedrooms from a Norwegian room count, where the living room counts as a room
 * (a 2-roms has 1 bedroom, a 1-roms none). Null when the count is unknown.
 */
export function bedroomsFromRooms(rooms: number | null | undefined): number | null {
  return Number.isInteger(rooms) && (rooms as number) >= 1 ? (rooms as number) - 1 : null;
}

/** 'YYYY-MM-DD' → 'YYYYKn'. */
export function quarterOf(day: string): string {
  return `${day.slice(0, 4)}K${Math.ceil(Number(day.slice(5, 7)) / 3)}`;
}

// A quarter-on-quarter index can be noisy; never move a price more than this.
const MAX_ADJUST = { min: 0.8, max: 1.25 };

/**
 * Factor that moves a price from `quarter` to the index's latest quarter, or 1
 * when the index can't say (missing, or no point at or before the quarter).
 */
function indexFactor(index: IndexPoint[] | undefined, quarter: string): number {
  const pts = (index ?? []).filter((p): p is { quarter: string; price: number } => positive(p.price))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
  if (pts.length < 2) return 1;
  const latest = pts[pts.length - 1].price;
  const at = [...pts].reverse().find((p) => p.quarter <= quarter);
  if (!at) return 1; // the sale predates the series: leave it as sold
  const f = latest / at.price;
  return Math.min(MAX_ADJUST.max, Math.max(MAX_ADJUST.min, f));
}

const positive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function valuationFromSales(
  home: HomeForValuation,
  sales: ComparableSale[],
  {
    asOf, monthsBack = 24, minComps = 3, sizeTolerance = 0.25, listLimit = 10, index, halfLifeMonths = 12,
  }: ValuationOptions,
): CompsValuation | null {
  const size = home.sizeSqm;
  if (!positive(size)) return null;
  const street = streetName(home.address);
  const since = monthsBefore(asOf, monthsBack);
  const timeAdjusted = (index ?? []).filter((p) => positive(p.price)).length >= 2;

  const usable: UsedComparable[] = [];
  for (const s of sales) {
    if (!positive(s.soldPrice) || !positive(s.bra)) continue;
    if (s.soldOn < since || s.soldOn > asOf) continue;
    const sizeGap = Math.abs(s.bra - size) / (size * sizeTolerance);
    if (sizeGap > 1) continue;
    const total = s.soldPrice + (positive(s.fellesgjeld) ? s.fellesgjeld : 0);
    const totalPerSqm = total / s.bra;
    const recency = 0.5 ** (monthsBetween(s.soldOn, asOf) / halfLifeMonths);
    const closeness = 1 - 0.5 * sizeGap;
    usable.push({
      ...s,
      totalPerSqm,
      adjustedPerSqm: totalPerSqm * (timeAdjusted ? indexFactor(index, quarterOf(s.soldOn)) : 1),
      weight: recency * closeness,
    });
  }

  const samePostnr = (s: ComparableSale) => !!home.postnr && s.postnr === home.postnr;
  // A street name alone is not unique across the country, so a street match
  // must also agree on postnummer when both sides have one.
  const sameStreet = (s: ComparableSale) =>
    street.length > 0 &&
    streetName(s.address) === street &&
    (!home.postnr || !s.postnr || s.postnr === home.postnr);
  const knownRooms = Number.isInteger(home.bedrooms) && (home.bedrooms as number) >= 0;
  const sameRooms = (s: ComparableSale) => {
    const b = s.bedrooms;
    if (home.bedrooms === 0) return b == null || b === 0;
    return b == null || b === 0 || b === home.bedrooms;
  };

  // Narrowest first: same street and room count, then street, then postnummer
  // with and without the room match. The first with enough sales wins.
  const tiers: { scope: 'street' | 'postnr'; rooms: boolean; rows: UsedComparable[] }[] = [];
  const onStreet = usable.filter(sameStreet);
  const inPostnr = usable.filter(samePostnr);
  if (knownRooms) tiers.push({ scope: 'street', rooms: true, rows: onStreet.filter(sameRooms) });
  tiers.push({ scope: 'street', rooms: false, rows: onStreet });
  if (knownRooms) tiers.push({ scope: 'postnr', rooms: true, rows: inPostnr.filter(sameRooms) });
  tiers.push({ scope: 'postnr', rooms: false, rows: inPostnr });
  const tier = tiers.find((t) => t.rows.length >= minComps);
  if (!tier) return null;
  const chosen = tier.rows;
  // Only claim a room match when it actually left something out.
  const roomsFiltered = tier.rooms && chosen.length < (tier.scope === 'street' ? onStreet : inPostnr).length;

  // Normalise weights so the most relevant comparable is 1 (readable in the UI).
  const maxW = Math.max(...chosen.map((c) => c.weight));
  for (const c of chosen) c.weight = maxW > 0 ? c.weight / maxW : 1;

  const pts = chosen.map((c) => ({ value: c.adjustedPerSqm, weight: c.weight }));
  const perSqm = {
    low: weightedPercentile(pts, 0.25),
    mid: weightedPercentile(pts, 0.5),
    high: weightedPercentile(pts, 0.75),
  };
  const own = positive(home.fellesgjeld) ? home.fellesgjeld : 0;
  const value = (p: number) => Math.max(0, Math.round(p * size - own));
  // Fellesgjeld at or above the total value leaves nothing to estimate.
  if (!(value(perSqm.mid) > 0)) return null;

  const sumW = chosen.reduce((a, c) => a + c.weight, 0);
  const sumW2 = chosen.reduce((a, c) => a + c.weight * c.weight, 0);

  const ratios = chosen
    .filter((c) => positive(c.askingPrice))
    .map((c) => c.soldPrice / (c.askingPrice as number) - 1)
    .sort((a, b) => a - b);

  return {
    scope: tier.scope,
    low: value(perSqm.low),
    mid: value(perSqm.mid),
    high: value(perSqm.high),
    perSqm: { low: Math.round(perSqm.low), mid: Math.round(perSqm.mid), high: Math.round(perSqm.high) },
    count: chosen.length,
    sameRooms: roomsFiltered,
    timeAdjusted,
    effectiveCount: sumW2 > 0 ? (sumW * sumW) / sumW2 : 0,
    newestSoldOn: chosen.reduce((m, c) => (c.soldOn > m ? c.soldOn : m), ''),
    comps: [...chosen].sort((a, b) => b.soldOn.localeCompare(a.soldOn)).slice(0, listLimit),
    overAskingPct: ratios.length ? Math.round(percentile(ratios, 0.5) * 1000) / 10 : null,
  };
}

export type ValuationConfidence = 'high' | 'medium' | 'low';

export interface ConfidenceDetail {
  level: ValuationConfidence;
  /** Effective number of sales after weighting ((Σw)² / Σw²). */
  effectiveCount: number;
  /** Months since the newest sale used. */
  newestMonths: number;
  /**
   * Width of the range as a share of its middle, in percent, measured on price
   * per m² so the home's own fellesgjeld doesn't make it look wider.
   */
  spreadPct: number;
}

/**
 * How much to trust an estimate: high needs about eight effective sales, the
 * newest within six months and a range within ±7.5 % (15 % wide); low is
 * fewer than four effective sales, nothing in the last 12 months, or a range
 * wider than 25 %. Everything in between is medium.
 */
export function valuationConfidence(v: CompsValuation, asOf: string): ConfidenceDetail {
  const { effectiveCount } = v;
  const newestMonths = v.newestSoldOn ? monthsBetween(v.newestSoldOn, asOf) : Infinity;
  const spreadPct = v.perSqm.mid > 0 ? ((v.perSqm.high - v.perSqm.low) / v.perSqm.mid) * 100 : Infinity;
  const level: ValuationConfidence =
    effectiveCount < 4 || newestMonths > 12 || spreadPct > 25
      ? 'low'
      : effectiveCount >= 8 && newestMonths <= 6 && spreadPct <= 15
        ? 'high'
        : 'medium';
  return {
    level,
    effectiveCount: Math.round(effectiveCount * 10) / 10,
    newestMonths: Math.round(newestMonths * 10) / 10,
    spreadPct: Math.round(spreadPct * 10) / 10,
  };
}

export interface ValuationPoint {
  /** 'YYYY-MM' */
  month: string;
  low: number;
  mid: number;
  high: number;
  count: number;
}

/** Last day of the month `n` months before `asOf`'s month ('YYYY-MM-DD'). */
function monthEnd(asOf: string, n: number): string {
  const d = new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - n, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * The estimate as it would have read at the end of each of the last `months`
 * months, oldest first, ending with `asOf` itself. Each point sees only the
 * sales made by then and the index quarters that had ended before it (SSB
 * publishes a quarter after it closes), so the line is the same method
 * replayed through time, not a stored log. Months without enough sales are
 * left out.
 */
export function valuationHistory(
  home: HomeForValuation,
  sales: ComparableSale[],
  opts: ValuationOptions & { months?: number },
): ValuationPoint[] {
  const { months = 24, index, ...rest } = opts;
  const out: ValuationPoint[] = [];
  for (let n = months - 1; n >= 0; n--) {
    const day = n === 0 ? opts.asOf : monthEnd(opts.asOf, n);
    const q = quarterOf(day);
    const v = valuationFromSales(home, sales, {
      ...rest,
      asOf: day,
      index: index?.filter((p) => p.quarter < q),
      listLimit: Number.MAX_SAFE_INTEGER,
    });
    if (v) out.push({ month: day.slice(0, 7), low: v.low, mid: v.mid, high: v.high, count: v.count });
  }
  return out;
}
