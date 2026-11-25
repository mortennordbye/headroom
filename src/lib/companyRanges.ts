/**
 * Ranges for the company model's headline numbers, from the quick setup's
 * guesses. Each answer marked "usikker" goes to a low and a high value, one at
 * a time, with the other answers at their middle value ("vet ikke" uses a
 * wider swing). That is 2k + 1 runs for k guesses. The swings of each output
 * are combined by root-sum-square, apart for down and up:
 *
 *   low  = mid − √Σ (largest drop of guess i)²
 *   high = mid + √Σ (largest rise of guess i)²
 *
 * "Hva betyr mest" sorts the guesses by how much they move the fair salary.
 *
 * Mid values come from the stored model (as the page shows them). The swings
 * come from the model built again from the answers, so a hand edit after the
 * setup keeps its numbers in the middle and the swings stay an estimate.
 */

import { calcCompany, youEconomics, type CompanyContext, type CompanyModel } from './companyCost';
import { buildModelFromAnswers, QUICK_GUESS_KEYS, type QuickAnswers, type QuickGuessKey } from './companySetup';

/** The ± swing of one guess: relative (share of the answer) or absolute (percentage points). */
export interface GuessSwing {
  kind: 'rel' | 'abs';
  size: number;
}

/** "usikker" swings per guess. */
export const GUESS_SWINGS: Record<QuickGuessKey, GuessSwing> = {
  salary: { kind: 'rel', size: 0.10 },
  rateAverage: { kind: 'rel', size: 0.05 },
  ownBillablePct: { kind: 'abs', size: 5 },
  typicalBillablePct: { kind: 'abs', size: 5 },
  realizationPct: { kind: 'abs', size: 3 },
  office: { kind: 'rel', size: 0.20 },
};

/** "vet ikke" uses this many times the "usikker" swing. */
export const DONT_KNOW_FACTOR = 2;

/** A swing below this many kr on the fair salary is shown as "påvirker lite". */
export const SMALL_SWING_KR = 5_000;

export interface Range {
  mid: number | null;
  low: number | null;
  high: number | null;
}

export interface RangeDriver {
  key: QuickGuessKey;
  dontKnow: boolean;
  /** Change of the fair salary at the worse end, kr (0 or below). */
  down: number;
  /** Change of the fair salary at the better end, kr (0 or above). */
  up: number;
  /** up − down. */
  width: number;
}

export interface CompanyRanges {
  /** Number of guesses ("usikker" + "vet ikke"). */
  guesses: number;
  keep: Range;
  keepPct: Range;
  fairGross: Range;
  ceilingGross: Range;
  companyPreBonusMarginPct: Range;
  /** The guesses, the one that moves the fair salary most first. */
  drivers: RangeDriver[];
}

type OutputKey = 'keep' | 'keepPct' | 'fairGross' | 'ceilingGross' | 'companyPreBonusMarginPct';
const OUTPUTS: OutputKey[] = ['keep', 'keepPct', 'fairGross', 'ceilingGross', 'companyPreBonusMarginPct'];
type Outputs = Record<OutputKey, number | null>;

const finOrNull = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);

/** One answer moved to its low (dir −1) or high (dir +1) end. The builder clamps the result. */
export function shiftAnswer(a: QuickAnswers, key: QuickGuessKey, dir: -1 | 1, factor = 1): QuickAnswers {
  const s = GUESS_SWINGS[key];
  const d = dir * s.size * factor;
  const move = (v: number) => (s.kind === 'rel' ? v * (1 + d) : v + d);
  switch (key) {
    case 'salary': return { ...a, salaryLow: move(a.salaryLow), salaryHigh: move(a.salaryHigh) };
    case 'office': return a.officeMode === 'rent'
      ? { ...a, annualRent: move(a.annualRent) }
      : { ...a, desks: move(a.desks ?? a.totalFte) };
    default: return { ...a, [key]: move(a[key]) };
  }
}

function outputs(model: CompanyModel, ctx: CompanyContext, gross: number | undefined): Outputs {
  const r = calcCompany(model, ctx);
  const y = youEconomics(model, ctx, r, gross ?? r.you.gross);
  return {
    keep: finOrNull(y.keep),
    keepPct: finOrNull(y.keepPct),
    fairGross: finOrNull(y.fairGross),
    ceilingGross: finOrNull(y.ceilingGross),
    companyPreBonusMarginPct: finOrNull(y.companyPreBonusMarginPct),
  };
}

/**
 * The ranges of the headline numbers, or null when the model has no quick setup.
 * `gross` is the salary to evaluate "keep" at (default: yours). A fair salary or
 * ceiling with no solution at one end counts as 0 there (the salary floor).
 */
export function companyRanges(model: CompanyModel, ctx: CompanyContext, gross?: number): CompanyRanges | null {
  const q = model.quick;
  if (!q) return null;
  const flagged = QUICK_GUESS_KEYS.filter((k) => q.uncertain.includes(k) || q.dontKnow.includes(k));
  const mid = outputs(model, ctx, gross);
  // The swings are measured on the model built from the answers, with the stored levers.
  const build = (a: QuickAnswers) => ({ ...buildModelFromAnswers(a, model, { uncertain: q.uncertain, dontKnow: q.dontKnow }), levers: model.levers });
  const base = flagged.length ? outputs(build(q.answers), ctx, gross) : mid;

  const sq = Object.fromEntries(OUTPUTS.map((o) => [o, { down: 0, up: 0 }])) as Record<OutputKey, { down: number; up: number }>;
  const drivers: RangeDriver[] = [];
  for (const key of flagged) {
    const dontKnow = q.dontKnow.includes(key);
    const factor = dontKnow ? DONT_KNOW_FACTOR : 1;
    const lo = outputs(build(shiftAnswer(q.answers, key, -1, factor)), ctx, gross);
    const hi = outputs(build(shiftAnswer(q.answers, key, 1, factor)), ctx, gross);
    const swing: Record<OutputKey, { down: number; up: number }> = {} as never;
    for (const o of OUTPUTS) {
      const b = base[o];
      if (b == null) { swing[o] = { down: 0, up: 0 }; continue; }
      const da = (lo[o] ?? 0) - b;
      const db = (hi[o] ?? 0) - b;
      const down = Math.min(0, da, db);
      const up = Math.max(0, da, db);
      swing[o] = { down, up };
      sq[o].down += down * down;
      sq[o].up += up * up;
    }
    // Ranked by the fair salary; by keep when there is no fair salary.
    const rank = mid.fairGross != null ? swing.fairGross : swing.keep;
    drivers.push({ key, dontKnow, down: rank.down, up: rank.up, width: rank.up - rank.down });
  }
  drivers.sort((x, y) => y.width - x.width);

  const range = (o: OutputKey): Range => {
    const m = mid[o];
    if (m == null) return { mid: null, low: null, high: null };
    const low = m - Math.sqrt(sq[o].down);
    // A salary is never below 0.
    return { mid: m, low: o === 'fairGross' || o === 'ceilingGross' ? Math.max(0, low) : low, high: m + Math.sqrt(sq[o].up) };
  };
  return {
    guesses: flagged.length,
    keep: range('keep'),
    keepPct: range('keepPct'),
    fairGross: range('fairGross'),
    ceilingGross: range('ceilingGross'),
    companyPreBonusMarginPct: range('companyPreBonusMarginPct'),
    drivers,
  };
}
