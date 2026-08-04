// How much of a requested CPI window SSB can actually be expected to have.
//
// SSB publishes a month's consumer price index roughly ten days after that
// month ends. A window that runs to "this month" therefore always has one or
// two trailing months that do not exist upstream yet.
//
// /api/inflation used to measure cache completeness against the requested `to`
// month, which those unpublished months made permanently unreachable: the cache
// counted as incomplete forever, so a refresh was always "due", and every
// request landing inside the hourly upstream cooldown reported the data stale.
// The client renders that as "could not reach SSB" — shown constantly, and
// wrong, since the fetch had in fact succeeded and returned everything SSB had.
//
// Measuring against the publication horizon instead makes "stale" mean what the
// client says it means: what we are serving is genuinely deficient.
//
// Pure and dependency-free (no Express, no SQLite) so it is unit-testable
// without booting the app — same split as auth.js and demo.js.

/** How far behind the current month SSB's newest published CPI month sits. */
const SSB_PUBLICATION_LAG_MONTHS = 2;

/** `n` months before a 'YYYY-MM' key (n may be negative to move forward). */
function shiftMonth(month, n) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Months in an inclusive 'YYYY-MM' range; 0 when `to` precedes `from`. */
function monthCount(fromMonth, toMonth) {
  const [fy, fm] = String(fromMonth).split('-').map(Number);
  const [ty, tm] = String(toMonth).split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

/**
 * The newest month SSB could plausibly have published, as of `nowMonth`.
 * Zero-padded 'YYYY-MM' keys compare correctly as strings, so callers can use
 * `<`/`>` on the result directly.
 */
function publishedThrough(nowMonth, lagMonths = SSB_PUBLICATION_LAG_MONTHS) {
  return shiftMonth(nowMonth, lagMonths);
}

/**
 * Whether `months` (the CPI months already cached) covers everything the
 * request needs: every month from `from` through the earlier of `to` and the
 * publication horizon. Months past that horizon are not required — nobody has
 * them. A window lying entirely in the unpublished tail is vacuously complete;
 * there is nothing to fetch and nothing to warn about.
 */
function isWindowComplete(months, from, to, nowMonth, lagMonths = SSB_PUBLICATION_LAG_MONTHS) {
  const horizon = to < publishedThrough(nowMonth, lagMonths) ? to : publishedThrough(nowMonth, lagMonths);
  if (horizon < from) return true;
  const have = new Set();
  for (const m of months) if (m >= from && m <= horizon) have.add(m);
  return have.size >= monthCount(from, horizon);
}

module.exports = {
  SSB_PUBLICATION_LAG_MONTHS,
  shiftMonth,
  monthCount,
  publishedThrough,
  isWindowComplete,
};
