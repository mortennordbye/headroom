// Norwegian salary has two predictable month-level cash swings that a flat
// "same net every month" projection misses:
//
//  - **June (feriepenger):** holiday pay is paid out, and no ordinary tax is
//    withheld that month ("skattefri juni"). It is the big positive spike.
//  - **December (halv skatt):** only half the ordinary tax is withheld, so
//    take-home is higher than a normal month.
//
// This module reshapes a single flat monthly-net figure into a seasonal series
// **without changing the annual total** — the June and December boosts are
// recovered from the 10 ordinary months, so the year still sums to the same net
// (June and December stay clean spikes rather than clawing back each other). It is a
// deliberate estimate for the cashflow projection, not a payslip: feriepenger is
// approximated as `sats% × current gross` (real feriepenger is based on the
// prior year's earnings) and the accrual is spread evenly. A real imported
// payslip for a month always wins over this estimate (see `monthlyCashflow`).
//
// Pure + unit-tested; keep the arithmetic here, not inline in components.

export interface FeriepengerConfig {
  /** Current gross annual salary — the base for the feriepenger estimate. */
  grossAnnual: number;
  /** Holiday-pay rate as a percent of gross (e.g. 12 for the 5-week rate). */
  feriepengesatsPct: number;
}

/**
 * The seasonally-adjusted net income for `monthKey`, given the flat monthly net
 * the app already computes. Net-neutral over a calendar year by construction.
 * Returns `flatNet` unchanged when there is no salary data to shape from.
 */
export function feriepengerMonthlyNet(
  monthKey: string,
  flatNet: number,
  config: FeriepengerConfig,
): number {
  if (!Number.isFinite(flatNet)) return flatNet;
  const grossAnnual = Math.max(0, config.grossAnnual);
  if (grossAnnual <= 0) return flatNet;

  const month = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return flatNet;

  if (month === 6) {
    // Feriepenger is paid as a June lump, no tax withheld → the big spike.
    const feriepenger = grossAnnual * (Math.max(0, config.feriepengesatsPct) / 100);
    return flatNet + feriepenger;
  }

  // December withholds only half the ordinary tax ("halv skatt"), so take-home
  // is higher by half a month's tax.
  const taxAnnual = Math.max(0, grossAnnual - flatNet * 12);
  const decBoost = taxAnnual / 24;
  if (month === 12) return flatNet + decBoost;

  // The 10 ordinary months carry both boosts back (net-neutral over the year):
  // the feriepenger lump was withheld a little each month, and the December
  // half-trekk is recovered here too.
  const feriepenger = grossAnnual * (Math.max(0, config.feriepengesatsPct) / 100);
  return flatNet - feriepenger / 10 - decBoost / 10;
}

/**
 * Holiday pay above the salary it replaces, for income year `year`: the
 * feriepenger paid in June (sats × last year's salary) minus the feriefratrekk
 * taken from June's salary for the holiday weeks (5 weeks on the 12% rate, 6 on
 * 14.3%, 25 virkedager on the 10.2% minimum). It is taxable income on top of
 * the 12 months of salary, which is why Skatteetaten's trekk tables annualise
 * monthly pay by 12.12 rather than 12. Usually ~2% of salary; negative after a
 * large raise (this year's fratrekk outgrows last year's base).
 *
 * `grossFor(monthKey)` is the gross annual salary active in a month. Without any
 * salary last year (no history entered), last year's base is taken to equal this
 * June's salary. Salary only: bonus and overtime in the feriepengegrunnlag
 * aren't counted. Returns 0 for a non-positive sats.
 */
export function feriepengerSurplus(year: number, grossFor: (monthKey: string) => number, satsPct: number): number {
  if (!Number.isFinite(satsPct) || satsPct <= 0) return 0;
  const sats = Math.min(100, satsPct) / 100;
  const safe = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  let priorTotal = 0;
  for (let m = 1; m <= 12; m++) priorTotal += safe(grossFor(`${year - 1}-${String(m).padStart(2, '0')}`)) / 12;
  const juneGross = safe(grossFor(`${year}-06`));
  const base = priorTotal > 0 ? priorTotal : juneGross;
  const weeks = satsPct >= 14.3 ? 6 : satsPct >= 12 ? 5 : 25 / 6;
  return base * sats - (juneGross * weeks) / 52;
}
