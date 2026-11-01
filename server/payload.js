// Minimal shape check so a stray/garbage POST can't overwrite the single data
// row with junk (`[]`, `42`, undefined body from a missing JSON content-type).
// Not a full schema — just enough to reject anything that clearly isn't the
// finance blob. Acts as a corruption firewall.
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMonthKey = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
// 'yyyy-MM' → kr a loan payment put toward a month's interest it did not cover.
const isUncoveredMonths = (v) => isPlainObject(v)
  && Object.entries(v).every(([m, kr]) => isMonthKey(m) && typeof kr === 'number' && Number.isFinite(kr) && kr >= 0);
// By loan ('mortgage' or 'debt:<id>'): the stamp of paydown expenses that left it.
const isDepartedPaydowns = (v) => isPlainObject(v)
  && Object.entries(v).every(([loan, s]) => (loan === 'mortgage' || /^debt:.+$/.test(loan))
    && isPlainObject(s) && isMonthKey(s.lastPostedMonth)
    && (s.uncoveredMonths === undefined || isUncoveredMonths(s.uncoveredMonths)));

function isValidFinancePayload(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  // Expect the core domain keys the client always persists.
  return (
    typeof body.income === 'number' &&
    typeof body.assets === 'object' && body.assets !== null &&
    // Optional; older blobs don't carry it.
    (body.assets.bsuTotalDeposited === undefined || (
      typeof body.assets.bsuTotalDeposited === 'number'
      && Number.isFinite(body.assets.bsuTotalDeposited) && body.assets.bsuTotalDeposited >= 0
    )) &&
    // Optional; older blobs don't carry it.
    (body.assets.departedPaydowns === undefined || isDepartedPaydowns(body.assets.departedPaydowns)) &&
    Array.isArray(body.fixedExpenses) &&
    // Optional per expense; older blobs don't carry it.
    body.fixedExpenses.every((e) => typeof e !== 'object' || e === null || e.uncoveredMonths === undefined
      || isUncoveredMonths(e.uncoveredMonths)) &&
    Array.isArray(body.dailyTransactions) &&
    (body.deletedBankTombstones === undefined || (
      Array.isArray(body.deletedBankTombstones)
      && body.deletedBankTombstones.every((t) => typeof t === 'object' && t !== null && typeof t.id === 'string')
    ))
  );
}

module.exports = { isValidFinancePayload };
