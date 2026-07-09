// Debt modeling: single-debt amortization + multi-debt payoff planning
// (avalanche / snowball with a shared extra-payment budget). Pure functions so
// they can be unit-tested and reused by the UI without React.

import type { Debt, DebtType, BalanceSnapshot } from '../context/FinanceContext';

const MAX_MONTHS = 600; // 50 years — anything beyond this counts as "never pays off"
const EPS = 0.005;      // treat sub-øre balances as zero

/** Finite-or-0: keeps a hand-edited undefined/NaN balance out of the money math. */
const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

export interface AmortizationResult {
  months: number;         // months to reach zero (0 if already clear)
  totalInterest: number;  // interest paid over the life of the debt
  feasible: boolean;      // false when the payment can't outrun the interest
  schedule: number[];     // remaining balance after each month (for charting)
}

/** Amortize one debt at a fixed monthly payment. */
export function amortize(balance: number, annualRatePct: number, monthlyPayment: number): AmortizationResult {
  if (balance <= EPS) return { months: 0, totalInterest: 0, feasible: true, schedule: [0] };
  const r = annualRatePct / 1200;
  let bal = balance;
  let totalInterest = 0;
  const schedule: number[] = [];
  // Infeasible if the first month's interest already meets/exceeds the payment
  // (and there is interest at all) — the balance would never shrink.
  if (r > 0 && monthlyPayment <= bal * r) {
    return { months: Infinity, totalInterest: Infinity, feasible: false, schedule: [] };
  }
  let months = 0;
  while (bal > EPS && months < MAX_MONTHS) {
    const interest = bal * r;
    bal += interest;
    totalInterest += interest;
    bal -= Math.min(monthlyPayment, bal);
    months += 1;
    schedule.push(Math.max(0, bal));
  }
  const feasible = bal <= EPS;
  // Mirror planPayoff: hitting the MAX_MONTHS cap without clearing the balance
  // means "never pays off" — report Infinity, not a misleading "600 months".
  if (!feasible) return { months: Infinity, totalInterest: Infinity, feasible, schedule: [] };
  return { months, totalInterest, feasible, schedule };
}

export type PayoffStrategy = 'avalanche' | 'snowball';

export interface PayoffPlan {
  months: number;
  totalInterest: number;
  feasible: boolean;
  perDebt: { id: string; payoffMonth: number; interest: number }[];
  balanceSeries: { month: number; total: number }[]; // total debt remaining per month, incl. month 0
}

/**
 * Simulate paying down several debts with the "rollover" method: every debt gets
 * its minimum each month, and the leftover budget (extra + freed-up minimums from
 * cleared debts) is thrown at the highest-priority debt. Avalanche prioritises the
 * highest rate; snowball the smallest balance.
 */
export function planPayoff(debts: Debt[], extraMonthly: number, strategy: PayoffStrategy): PayoffPlan {
  // Revolving debts (credit cards paid in full each month) never amortize, so
  // they're excluded from the payoff simulation — they'd otherwise show a bogus
  // "paid off in N months" that never happens. They still count in net worth.
  const active = debts.filter(d => d.balance > EPS && !d.revolving);
  const startTotal = active.reduce((s, d) => s + d.balance, 0);
  if (active.length === 0) {
    return { months: 0, totalInterest: 0, feasible: true, perDebt: [], balanceSeries: [{ month: 0, total: 0 }] };
  }

  const bal = active.map(d => d.balance);
  const rate = active.map(d => d.rate / 1200);
  const minP = active.map(d => d.minPayment);
  const interest = active.map(() => 0);
  const payoffMonth = active.map(() => 0);

  const order = active
    .map((_, i) => i)
    .sort((a, b) => (strategy === 'avalanche' ? rate[b] - rate[a] : bal[a] - bal[b]));

  const budget = minP.reduce((s, m) => s + m, 0) + Math.max(0, extraMonthly);
  const balanceSeries: { month: number; total: number }[] = [{ month: 0, total: startTotal }];

  let month = 0;
  while (month < MAX_MONTHS) {
    // Accrue interest.
    let monthInterest = 0;
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] > EPS) {
        const int = bal[i] * rate[i];
        bal[i] += int;
        interest[i] += int;
        monthInterest += int;
      }
    }
    // Infeasible: the whole budget can't even cover this month's interest.
    if (budget <= monthInterest) {
      return { months: Infinity, totalInterest: Infinity, feasible: false, perDebt: [], balanceSeries };
    }

    let pool = budget;
    // Minimums first (capped at remaining balance).
    for (const i of order) {
      if (bal[i] > EPS && pool > 0) {
        const pay = Math.min(minP[i], bal[i], pool);
        bal[i] -= pay;
        pool -= pay;
      }
    }
    // Roll the rest onto the priority debt(s).
    for (const i of order) {
      if (pool <= 0) break;
      if (bal[i] > EPS) {
        const pay = Math.min(bal[i], pool);
        bal[i] -= pay;
        pool -= pay;
      }
    }

    month += 1;
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] <= EPS && payoffMonth[i] === 0) payoffMonth[i] = month;
    }
    const total = bal.reduce((s, b) => s + Math.max(0, b), 0);
    balanceSeries.push({ month, total });
    if (total <= EPS) break;
  }

  const feasible = bal.every(b => b <= EPS);
  return {
    // Hitting the MAX_MONTHS cap without clearing every debt means "never pays
    // off" — report Infinity (like the interest-infeasible path) so callers
    // format it as "aldri/never" rather than a misleading "50 år".
    months: feasible ? month : Infinity,
    totalInterest: interest.reduce((s, i) => s + i, 0),
    feasible,
    // payoffMonth 0 marks "never cleared within the cap" — report Infinity for
    // the same reason as `months` above.
    perDebt: active.map((d, i) => ({ id: d.id, payoffMonth: payoffMonth[i] === 0 ? Infinity : payoffMonth[i], interest: interest[i] })),
    balanceSeries,
  };
}

/**
 * Total non-mortgage debt remaining at the end of each year, index 0..years
 * (year 0 = today). Amortizing debts pay down at their minimum payments with
 * the rollover method (freed minimums accelerate the rest, no extra budget);
 * revolving balances never amortize and are carried flat. An infeasible plan
 * (minimums can't outrun interest) carries the last simulated total forward
 * rather than growing without bound. Mirrors `calcMortgageBalanceByYear` on
 * the mortgage side, for netting debt out of net-worth projections.
 */
export function calcDebtBalanceByYear(debts: Debt[], years: number): number[] {
  const revolving = debts.reduce((s, d) => (d.revolving ? s + Math.max(0, d.balance) : s), 0);
  const series = planPayoff(debts, 0, 'avalanche').balanceSeries;
  const out: number[] = [];
  for (let y = 0; y <= years; y++) {
    const amortizing = series[Math.min(y * 12, series.length - 1)]?.total ?? 0;
    out.push(Math.round(amortizing + revolving));
  }
  return out;
}

// ── Non-mortgage debt payoff: plan vs actual (HISTORY_PLAN §6.4) ─────────────
// Mirrors the mortgage `paydownVsPlan`, against `planPayoff` instead of an
// amortization schedule. Plan = the minimums-only rollover from the earliest
// recorded debts; actual = the recorded total each month. All from snapshots.

export interface DebtPaydownPoint {
  monthKey: string;
  /** Recorded non-revolving debt total that month. */
  actual: number;
  /** Where the minimums-only payoff plan says the total should be. */
  plan: number;
}

export interface DebtPaydownVsPlan {
  points: DebtPaydownPoint[];
  anchorMonth: string | null;
  /** plan − actual at the latest recorded month. >0 = ahead (less debt than plan). */
  aheadBy: number;
  /** Anchor total − latest actual: how much debt was actually cleared to date. */
  principalPaid: number;
}

const monthIndex = (key: string): number => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

/** That month's non-revolving debt total (revolving cards never amortize, so they
 *  are excluded — matching `planPayoff`). Finite-guarded. */
function activeDebtTotal(debts: Debt[] | undefined): number {
  return (debts ?? []).reduce((s, d) => (d.revolving ? s : s + Math.max(0, finite(d.balance))), 0);
}

export function debtPaydownVsPlan(
  snapshots: Record<string, BalanceSnapshot>,
  strategy: PayoffStrategy = 'avalanche',
): DebtPaydownVsPlan {
  const empty: DebtPaydownVsPlan = { points: [], anchorMonth: null, aheadBy: 0, principalPaid: 0 };
  const months = Object.keys(snapshots).sort();
  const anchorMonth = months.find(m => activeDebtTotal(snapshots[m].debts) > EPS) ?? null;
  if (!anchorMonth) return empty;

  const anchorIdx = monthIndex(anchorMonth);
  const series = planPayoff(snapshots[anchorMonth].debts ?? [], 0, strategy).balanceSeries;
  const planAt = (k: number) => series[Math.min(Math.max(0, k), series.length - 1)]?.total ?? 0;

  const points: DebtPaydownPoint[] = months
    .filter(m => monthIndex(m) >= anchorIdx)
    .map(m => ({
      monthKey: m,
      actual: activeDebtTotal(snapshots[m].debts),
      plan: Math.round(planAt(monthIndex(m) - anchorIdx)),
    }));

  const latest = points[points.length - 1];
  return {
    points,
    anchorMonth,
    aheadBy: latest.plan - latest.actual,
    principalPaid: activeDebtTotal(snapshots[anchorMonth].debts) - latest.actual,
  };
}

/** Human-friendly "X år Y mnd" / "X yr Y mo" for a month count. */
export function formatMonths(months: number, lang: 'nb' | 'en'): string {
  if (!isFinite(months)) return lang === 'nb' ? 'aldri' : 'never';
  if (months <= 0) return lang === 'nb' ? 'nedbetalt' : 'paid off';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const yr = lang === 'nb' ? 'år' : (y === 1 ? 'yr' : 'yrs');
  const mo = lang === 'nb' ? 'mnd' : 'mo';
  if (y === 0) return `${m} ${mo}`;
  if (m === 0) return `${y} ${yr}`;
  return `${y} ${yr} ${m} ${mo}`;
}

export const DEBT_TYPES: DebtType[] = ['student', 'consumer', 'credit_card', 'other'];

/**
 * Sum the outstanding balance of debts of one type. Used to show net worth
 * "excluding student loan" alongside the true figure: studielån is soft debt
 * (low-interest, human-capital) whose real bite is on borrowing capacity, not
 * wealth — so it's worth seeing equity both with and without it.
 */
export function sumDebtByType(debts: Debt[], type: DebtType): number {
  return debts.reduce((s, d) => (d.type === type ? s + Math.max(0, d.balance) : s), 0);
}
