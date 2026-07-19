// BSU (Boligsparing for ungdom) cap tracking. `assets.bsu` is a bare scalar
// summed into cash; this derives the actionable room against the two statutory
// caps so the account tile can say "you can still put in X this year / Y ever".
// Pure + unit-tested.
//
// "Contributed this year" is derived from the balance change since the start of
// the year (the latest snapshot before January, else the earliest in-year one).
// This treats all growth as contribution — BSU interest is small relative to the
// 27 500 kr cap, so the approximation is close enough for a nudge. The age-34
// eligibility cutoff is not modeled (no birthdate is tied to the account).

/** Finite-or-0 guard against a hand-edited undefined/NaN balance. */
const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

export const BSU_ANNUAL_CAP = 27_500;
export const BSU_LIFETIME_CAP = 300_000;

// BSU income-tax credit: 10% of the year's contribution (capped at the annual
// cap → max 2 750 kr), available through the year you turn 33 and only while you
// don't own a home. The rate was 20% before 2023; it is 10% for 2023 onward.
export const BSU_CREDIT_RATE = 0.10;
export const BSU_MAX_AGE = 33;

/**
 * The BSU tax credit (fradrag i skatt) for a year's contribution. Returns the
 * gross credit; it is non-refundable, so a caller applying it to tax should cap
 * it at the tax actually owed (calcNorwegianTax does this). Zero when the saver
 * owns a home or is past the age limit.
 */
export function calcBsuTaxCredit(
  contribution: number,
  opts: { age: number; ownsHome: boolean },
): number {
  if (opts.ownsHome) return 0;
  if (!Number.isFinite(opts.age) || opts.age < 0 || opts.age > BSU_MAX_AGE) return 0;
  const eligible = Math.min(Math.max(0, finite(contribution)), BSU_ANNUAL_CAP);
  return Math.round(BSU_CREDIT_RATE * eligible);
}

export interface BsuStatus {
  balance: number;
  contributedThisYear: number;
  annualCap: number;
  lifetimeCap: number;
  annualRoomLeft: number;   // clamped ≥ 0
  lifetimeRoomLeft: number; // clamped ≥ 0
  atAnnualCap: boolean;
  atLifetimeCap: boolean;
}

/** BSU balance entering `year`: the latest snapshot before it, else the earliest
 *  one within it, else null (nothing to anchor "contributed this year" on). */
function baselineForYear(
  snapshots: Record<string, { assets: { bsu?: number } }>,
  year: number,
): number | null {
  const keys = Object.keys(snapshots).sort();
  const prior = keys.filter(k => k < `${year}-01`);
  if (prior.length) return finite(snapshots[prior[prior.length - 1]].assets.bsu);
  const inYear = keys.filter(k => k.startsWith(`${year}-`));
  if (inYear.length) return finite(snapshots[inYear[0]].assets.bsu);
  return null;
}

export function bsuStatus(
  currentBalance: number,
  snapshots: Record<string, { assets: { bsu?: number } }>,
  year: number,
): BsuStatus {
  const balance = Math.max(0, finite(currentBalance));
  const baseline = baselineForYear(snapshots, year);
  // No prior data → assume no known contribution rather than overstate it.
  const contributedThisYear = baseline == null ? 0 : Math.max(0, balance - baseline);

  const annualRoomLeft = Math.max(0, BSU_ANNUAL_CAP - contributedThisYear);
  const lifetimeRoomLeft = Math.max(0, BSU_LIFETIME_CAP - balance);

  return {
    balance,
    contributedThisYear,
    annualCap: BSU_ANNUAL_CAP,
    lifetimeCap: BSU_LIFETIME_CAP,
    annualRoomLeft,
    lifetimeRoomLeft,
    atAnnualCap: annualRoomLeft <= 0,
    atLifetimeCap: lifetimeRoomLeft <= 0,
  };
}
