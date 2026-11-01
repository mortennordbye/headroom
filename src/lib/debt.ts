// Debt modeling: single-debt amortization + multi-debt payoff planning
// (avalanche / snowball with a shared extra-payment budget). Pure functions so
// they can be unit-tested and reused by the UI without React.

import type { Debt, DebtType, BalanceSnapshot } from '../context/FinanceContext';

const MAX_MONTHS = 600; // 50 years — anything beyond this counts as "never pays off"
const EPS = 0.005;      // treat sub-øre balances as zero

/** Finite-or-0: keeps a hand-edited undefined/NaN balance out of the money math. */
const finite = (n: number | undefined): number => (Number.isFinite(n) ? (n as number) : 0);

/** 'YYYY-MM' → absolute month index (year*12 + month). */
const monthIndex = (key: string): number => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

/**
 * How many months a debt is still interest-free / payment-deferred, relative to
 * `nowMonthKey`. Lånekassen student loans sit at 0% interest with no payment
 * while studying; during these months the payoff planner carries the balance
 * flat. 0 for debts with no deferment (or once it's in the past / no `nowMonthKey`).
 */
function defermentMonths(debt: Debt, nowMonthKey?: string): number {
  if (!debt.interestFreeUntil || !nowMonthKey) return 0;
  return Math.max(0, monthIndex(debt.interestFreeUntil) - monthIndex(nowMonthKey));
}

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

export interface ExtraPaymentSavings {
  baseMonths: number;      // months to pay off at the scheduled annuity payment
  extraMonths: number;     // months to pay off with the extra added each month
  monthsSaved: number;     // baseMonths − extraMonths (0 when infeasible)
  baseInterest: number;
  extraInterest: number;
  interestSaved: number;   // baseInterest − extraInterest (0 when infeasible)
  feasible: boolean;       // both legs actually amortize
}

/**
 * What one fixed extra monthly payment does to a mortgage: months and interest
 * saved versus paying only the scheduled annuity. Both legs run through
 * `amortize`, so the comparison is internally consistent. `basePayment` is the
 * scheduled annuity (from `calcMonthlyPayment`, passed in to avoid a cross-module
 * import); `extraMonthly` is clamped at 0 since a negative "extra" is meaningless.
 */
export function extraPaymentSavings(
  balance: number,
  annualRatePct: number,
  basePayment: number,
  extraMonthly: number,
): ExtraPaymentSavings {
  const extra = Math.max(0, extraMonthly);
  const base = amortize(balance, annualRatePct, basePayment);
  const withExtra = amortize(balance, annualRatePct, basePayment + extra);
  const feasible = base.feasible && withExtra.feasible;
  return {
    baseMonths: base.months,
    extraMonths: withExtra.months,
    monthsSaved: feasible ? base.months - withExtra.months : 0,
    baseInterest: base.totalInterest,
    extraInterest: withExtra.totalInterest,
    interestSaved: feasible ? base.totalInterest - withExtra.totalInterest : 0,
    feasible,
  };
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
export function planPayoff(debts: Debt[], extraMonthly: number, strategy: PayoffStrategy, nowMonthKey?: string): PayoffPlan {
  return simulatePayoff(debts, extraMonthly, strategy, nowMonthKey, MAX_MONTHS, true).plan;
}

/**
 * The rollover loop behind `planPayoff` and `calcDebtByYear`. With
 * `stopWhenInfeasible` it gives up (planPayoff's "never") as soon as the budget
 * can't cover a month's interest; without it the loop keeps paying for
 * `maxMonths` and the unpaid interest compounds onto the balance.
 * `paidByMonth[m]` is the cash paid in month m+1 and `chargedBudgetByMonth[m]`
 * the part of that month's budget that is the minimums of the debts `charged`
 * selects (deferred debts excluded).
 */
function simulatePayoff(
  debts: Debt[], extraMonthly: number, strategy: PayoffStrategy, nowMonthKey: string | undefined,
  maxMonths: number, stopWhenInfeasible: boolean, charged: (d: Debt) => boolean = () => true,
): { plan: PayoffPlan; paidByMonth: number[]; chargedBudgetByMonth: number[] } {
  // Revolving debts (credit cards paid in full each month) never amortize, so
  // they're excluded from the payoff simulation — they'd otherwise show a bogus
  // "paid off in N months" that never happens. They still count in net worth.
  const active = debts.filter(d => d.balance > EPS && !d.revolving);
  const startTotal = active.reduce((s, d) => s + d.balance, 0);
  const paidByMonth: number[] = [];
  const chargedBudgetByMonth: number[] = [];
  if (active.length === 0) {
    const plan = { months: 0, totalInterest: 0, feasible: true, perDebt: [], balanceSeries: [{ month: 0, total: 0 }] };
    return { plan, paidByMonth, chargedBudgetByMonth };
  }

  const bal = active.map(d => d.balance);
  const rate = active.map(d => d.rate / 1200);
  const minP = active.map(d => d.minPayment);
  const isCharged = active.map(d => charged(d));
  const interest = active.map(() => 0);
  const payoffMonth = active.map(() => 0);
  // Months each debt is still interest-free / deferred (Lånekassen studielån):
  // while `month < defer[i]` it accrues no interest, takes no payment, and its
  // minimum isn't part of the budget yet — the balance sits flat.
  const defer = active.map(d => defermentMonths(d, nowMonthKey));

  const order = active
    .map((_, i) => i)
    .sort((a, b) => (strategy === 'avalanche' ? rate[b] - rate[a] : bal[a] - bal[b]));

  const extra = Math.max(0, extraMonthly);
  const balanceSeries: { month: number; total: number }[] = [{ month: 0, total: startTotal }];

  let month = 0;
  while (month < maxMonths) {
    // Budget this month: extra + the minimums of debts whose deferment has ended
    // (a deferred student loan isn't being paid yet, so its minimum joins the
    // budget only once repayment starts).
    let budget = extra;
    let chargedBudget = 0;
    for (let i = 0; i < minP.length; i++) {
      if (month >= defer[i]) {
        budget += minP[i];
        if (isCharged[i]) chargedBudget += minP[i];
      }
    }

    // Accrue interest (deferred debts accrue nothing).
    let monthInterest = 0;
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] > EPS && month >= defer[i]) {
        const int = bal[i] * rate[i];
        bal[i] += int;
        interest[i] += int;
        monthInterest += int;
      }
    }
    // Infeasible: the available budget can't even cover this month's interest.
    // Guarded by monthInterest > 0 so an all-deferred month (0 interest, maybe 0
    // budget) doesn't read as infeasible.
    if (stopWhenInfeasible && monthInterest > 0 && budget <= monthInterest) {
      const plan = { months: Infinity, totalInterest: Infinity, feasible: false, perDebt: [], balanceSeries };
      return { plan, paidByMonth, chargedBudgetByMonth };
    }

    let pool = budget;
    // Minimums first (capped at remaining balance; deferred debts are skipped).
    for (const i of order) {
      if (bal[i] > EPS && month >= defer[i] && pool > 0) {
        const pay = Math.min(minP[i], bal[i], pool);
        bal[i] -= pay;
        pool -= pay;
      }
    }
    // Roll the rest onto the priority debt(s) — never onto a still-deferred loan.
    for (const i of order) {
      if (pool <= 0) break;
      if (bal[i] > EPS && month >= defer[i]) {
        const pay = Math.min(bal[i], pool);
        bal[i] -= pay;
        pool -= pay;
      }
    }
    paidByMonth.push(budget - pool);
    chargedBudgetByMonth.push(chargedBudget);

    month += 1;
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] <= EPS && payoffMonth[i] === 0) payoffMonth[i] = month;
    }
    const total = bal.reduce((s, b) => s + Math.max(0, b), 0);
    balanceSeries.push({ month, total });
    if (total <= EPS) break;
  }

  const feasible = bal.every(b => b <= EPS);
  const plan: PayoffPlan = {
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
  return { plan, paidByMonth, chargedBudgetByMonth };
}

/** Non-mortgage debt in a net-worth projection, index 0..years (year 0 = today). */
export interface DebtByYear {
  /** Debt remaining at the end of each year. */
  balance: number[];
  /** Cash paid on the debts during each year, principal + interest, that the
   *  budget doesn't already spend as a fixed expense; `payments[0]` is 0. The
   *  projections take it out of the assets, so a repayment lowers the assets by
   *  the whole payment while the debt falls only by its principal. */
  payments: number[];
}

/**
 * The debts a fixed expense already pays (a paydown destination), paused or not:
 * the expense is in the budget, so its money is already out of the saving the
 * projections add, and charging the debt's payment as well would count it twice.
 */
export function debtIdsPaidByExpenses(expenses: readonly { destinationKind?: string; debtId?: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const e of expenses) if (e.destinationKind === 'debt' && e.debtId) ids.add(e.debtId);
  return ids;
}

/**
 * Non-mortgage debt over `years` years for the net-worth projections, mirroring
 * `calcMortgageBalanceByYear` on the mortgage side. Amortizing debts pay down at
 * their minimum payments with the rollover method (freed minimums accelerate the
 * rest, no extra budget); revolving balances never amortize and are carried
 * flat. A debt whose payment can't cover its interest keeps being paid and grows
 * by the interest the payment leaves unpaid.
 *
 * `payments` charges the minimums of the debts not in `paidByExpense` (see
 * `debtIdsPaidByExpenses`): they keep leaving while any debt is left, as the
 * rollover spends them, but never more than was actually paid that month.
 */
export function calcDebtByYear(
  debts: Debt[], years: number, nowMonthKey?: string, paidByExpense: ReadonlySet<string> = new Set(),
): DebtByYear {
  const revolving = debts.reduce((s, d) => (d.revolving ? s + Math.max(0, d.balance) : s), 0);
  const { plan, paidByMonth, chargedBudgetByMonth } = simulatePayoff(
    debts, 0, 'avalanche', nowMonthKey, years * 12, false, d => !paidByExpense.has(d.id),
  );
  const series = plan.balanceSeries;
  const balance: number[] = [];
  const payments: number[] = [];
  for (let y = 0; y <= years; y++) {
    const amortizing = series[Math.min(y * 12, series.length - 1)]?.total ?? 0;
    balance.push(Math.round(amortizing + revolving));
    let paid = 0;
    if (y > 0) {
      for (let m = (y - 1) * 12; m < y * 12 && m < paidByMonth.length; m++) {
        paid += Math.min(chargedBudgetByMonth[m], paidByMonth[m]);
      }
    }
    payments.push(Math.round(paid));
  }
  return { balance, payments };
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
  // Deferment is measured from the plan's anchor month, not "now".
  const series = planPayoff(snapshots[anchorMonth].debts ?? [], 0, strategy, anchorMonth).balanceSeries;
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

/**
 * Total debt as it counts toward Norway's lending rule (gjeldsgrad / 5× income
 * cap). A revolving credit line with a granted `creditLimit` counts at its full
 * frame (innvilget kredittramme), not the drawn balance — so a card with a 100k
 * limit and 20k drawn counts 100k. Every other line, and any card without a
 * recorded limit, counts at its outstanding balance. This is distinct from the
 * net-worth `totalDebt` (which always uses the drawn balance).
 */
export function lendingDebtTotal(debts: Debt[]): number {
  return debts.reduce((s, d) => {
    const bal = Math.max(0, finite(d.balance));
    const frame = Math.max(0, finite(d.creditLimit));
    return s + Math.max(bal, frame);
  }, 0);
}

export interface CreditFrameBreakdown {
  /** Lines counted at their outstanding balance (no granted frame, or frame ≤ balance). */
  nonFrameDebt: number;
  /** Revolving lines counted at their full granted `creditLimit` (frame > balance). */
  creditFrameTotal: number;
}

/**
 * Split debts into the part the lending rule counts at balance vs the revolving
 * lines it counts at their full granted `creditLimit`. `nonFrameDebt +
 * creditFrameTotal === lendingDebtTotal` by construction. Lets the second-home
 * borrowing-capacity check show existing debt and granted credit frames as two
 * separate rows without double-counting a card's drawn balance.
 */
export function creditFrameBreakdown(debts: Debt[]): CreditFrameBreakdown {
  let nonFrameDebt = 0;
  let creditFrameTotal = 0;
  for (const d of debts) {
    const bal = Math.max(0, finite(d.balance));
    const frame = Math.max(0, finite(d.creditLimit));
    if (frame > bal) creditFrameTotal += frame;
    else nonFrameDebt += bal;
  }
  return { nonFrameDebt, creditFrameTotal };
}
