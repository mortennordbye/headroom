// Detect internal transfers: money moved between two of the user's own connected
// accounts shows up twice — an expense (out of account A) and an income (into
// account B) — which double-counts and inflates both spending and income. This
// finds those matched pairs so the budget analysis can net them out.
//
// Conservative by design (this is money math): a pair matches only when it's an
// opposite-kind, exactly-equal-amount move between two DIFFERENT connected
// accounts within a few days. Ambiguous matches (more than one candidate income
// for an expense in the window) are skipped rather than guessed — a false net
// is worse than a missed one, and every netted row is still shown (marked) in
// the ledger so the user can see what happened.
//
// Separately, a row whose counterparty account number is one of the user's own
// connected accounts (as stamped by bank sync) is an internal transfer outright,
// whatever the amount or timing: the bank itself says where the money went.
import type { DailyTransaction } from '../context/FinanceContext';

// Max days between the two legs of an internal transfer. Own-account moves
// usually settle same-day or next-day; 3 covers weekend lag without being loose.
const WINDOW_DAYS = 3;

function dayNumber(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00`);
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : NaN;
}

// A row is a transfer candidate only if it came from a connected account (has an
// `account` key) — a manual cash row can't be an internal bank transfer.
function isCandidate(t: DailyTransaction): boolean {
  return typeof t.account === 'string' && t.account.length > 0 && Number.isFinite(t.amount) && t.amount > 0;
}

/**
 * Canonical form of an account number for comparison: whitespace, dots and
 * dashes dropped, upper-cased, and a Norwegian IBAN ("NO" + 2 check digits + the
 * 11-digit BBAN) reduced to its BBAN so the two spellings of one account match.
 * Empty string when there's nothing usable.
 */
export function normalizeAccountNumber(raw: string | undefined): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/[\s.-]/g, '').toUpperCase();
  const no = /^NO\d{2}(\d{11})$/.exec(s);
  return no ? no[1] : s;
}

/**
 * Return the ids of transactions that are legs of a detected internal transfer
 * (both the outgoing and incoming side). Empty when nothing matches.
 */
export function findInternalTransferIds(txs: DailyTransaction[]): Set<string> {
  const matched = new Set<string>();
  const expenses = txs.filter((t) => isCandidate(t) && t.kind !== 'income');
  const incomes = txs.filter((t) => isCandidate(t) && t.kind === 'income');
  const withinWindow = (a: DailyTransaction, b: DailyTransaction) => {
    const da = dayNumber(a.date);
    const db = dayNumber(b.date);
    return Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) <= WINDOW_DAYS;
  };

  // Own-account matching: the user's own account numbers are the ones stamped on
  // their connected rows; a row paying to / receiving from one of those (and not
  // its own account) is a move between the user's accounts.
  const own = new Set<string>();
  for (const t of [...expenses, ...incomes]) {
    const n = normalizeAccountNumber(t.accountNumber);
    if (n) own.add(n);
  }
  const byNumber: DailyTransaction[] = [];
  for (const t of [...expenses, ...incomes]) {
    const cp = normalizeAccountNumber(t.counterpartyAccountNumber);
    if (cp && own.has(cp) && cp !== normalizeAccountNumber(t.accountNumber)) {
      matched.add(t.id);
      byNumber.push(t);
    }
  }

  // Legs already paired, either direction, so no row is claimed twice.
  const usedIncome = new Set<string>();
  const usedExpense = new Set<string>();
  // The other leg of a row matched by account number may carry no counterparty
  // number itself. Look for it on the account the number names: opposite kind,
  // same amount, within the window, and exactly one candidate.
  for (const t of byNumber) {
    const isIncome = t.kind === 'income';
    if ((isIncome ? usedIncome : usedExpense).has(t.id)) continue;
    const cp = normalizeAccountNumber(t.counterpartyAccountNumber);
    const usedPool = isIncome ? usedExpense : usedIncome;
    const partners = (isIncome ? expenses : incomes).filter(
      (p) =>
        !usedPool.has(p.id) &&
        normalizeAccountNumber(p.accountNumber) === cp &&
        p.amount === t.amount &&
        withinWindow(t, p),
    );
    if (partners.length === 1) {
      (isIncome ? usedIncome : usedExpense).add(t.id);
      usedPool.add(partners[0].id);
      matched.add(partners[0].id);
    }
  }

  if (!expenses.length || !incomes.length) return matched;

  for (const e of expenses) {
    if (matched.has(e.id)) continue; // already proven by account number
    const eDay = dayNumber(e.date);
    if (!Number.isFinite(eDay)) continue;
    // Candidate incomes: same amount, a DIFFERENT account, within the window,
    // not already claimed by another expense.
    const candidates = incomes.filter(
      (i) =>
        !usedIncome.has(i.id) &&
        !matched.has(i.id) &&
        i.account !== e.account &&
        i.amount === e.amount &&
        Number.isFinite(dayNumber(i.date)) &&
        Math.abs(dayNumber(i.date) - eDay) <= WINDOW_DAYS,
    );
    // Exactly one unambiguous counterpart → treat as an internal transfer.
    // Zero or several (can't tell which) → leave it in the spend numbers.
    if (candidates.length === 1) {
      const i = candidates[0];
      usedIncome.add(i.id);
      matched.add(e.id);
      matched.add(i.id);
    }
  }
  return matched;
}
