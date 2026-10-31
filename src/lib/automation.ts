// Fixed-expense automations — the pure monthly runner.
//
// A fixed expense can carry a destination: each month its `amount` grows a
// savings account, or pays down a mortgage/debt by the principal portion
// (amortization-aware). This module decides, given the destinations + current
// balances + the current month, what to post — no I/O, no React, so every case
// (catch-up, floor-at-0, amortization, deleted target) is unit-testable.
// FinanceContext maps fixed expenses to `AutomationRule`s and binds the results
// to its setters.
//
// Because every context setter takes an ABSOLUTE value (not a delta) and both
// floor-at-0 and amortization need the live balance + rate, the runner takes a
// balance/rate snapshot and returns resolved absolute new balances.
import { addMonthsKey, monthsBetween } from './date';
import type { CurrentMortgage } from './existingMortgage';

/**
 * Targets that are one plain scalar balance grown by the monthly amount. They
 * differ only in which state field they read/write, so the runner treats them
 * uniformly via `AutomationState.scalars`.
 *
 * `pensionOtp`/`pensionIps` are the only kinds NOT reachable from a fixed
 * expense: OTP is paid by the employer and IPS is configured as a yearly figure
 * on the Pension page, so neither passes through the budget. FinanceContext
 * synthesizes their rules from pension state instead (see lib/pensionAccrual.ts)
 * and feeds them to this same runner, so they inherit the catch-up prompt, the
 * double-apply guard and the stacking behaviour for free.
 */
export type ScalarTargetKind = 'bufferAccount' | 'portfolio' | 'bsu' | 'pensionOtp' | 'pensionIps';

export const SCALAR_TARGETS: readonly ScalarTargetKind[] =
  ['bufferAccount', 'portfolio', 'bsu', 'pensionOtp', 'pensionIps'] as const;

export type AutomationTargetKind = ScalarTargetKind | 'savingsAccount' | 'mortgage' | 'debt';
export type HousingMode = 'first_buyer' | 'homeowner' | 'transitioning';

const isScalarTarget = (k: AutomationTargetKind): k is ScalarTargetKind =>
  (SCALAR_TARGETS as readonly string[]).includes(k);

// A destination-bearing fixed expense (or a synthesized pension contribution)
// projected to the shape the runner needs.
export interface AutomationRule {
  id: string;                 // the fixed expense's id, or 'pension:otp' / 'pension:ips'
  name: string;
  amount: number;             // positive monthly kr (the expense amount)
  /** 'yyyy-MM' → kr for months that move a different amount (a saving whose
   *  month was adjusted). Balance-growing targets only; paydown ignores it. */
  amountByMonth?: Record<string, number>;
  targetKind: AutomationTargetKind;
  savingsAccountId?: string;  // set iff targetKind === 'savingsAccount'
  debtId?: string;            // set iff targetKind === 'debt'
  /** Mortgage fixed expenses only: 'myShare' = `amount` is the user's share of a
   *  joint instalment, so the loan is paid down by amount ÷ debt share.
   *  Absent = 'whole'. */
  mortgagePaymentScope?: 'whole' | 'myShare';
  startMonth: string;         // 'yyyy-MM', first eligible month (fallback when never posted)
  lastPostedMonth?: string;   // 'yyyy-MM' last applied; absent = never. Double-apply guard.
}

/** Live balances/rates the runner needs to resolve absolute new values. */
export interface AutomationState {
  savings: Record<string, number>;                       // by savingsAccountId
  /** The single-scalar balances, keyed by the target kind that writes them. */
  scalars: Record<ScalarTargetKind, number>;
  mortgage: number;                                      // the whole loan (automationMortgage)
  mortgageRate: number;                                  // annual %, the current loan's (automationMortgage)
  /** The user's share (0..1) of the joint mortgage; absent = 1. */
  mortgageDebtShare?: number;
  debts: Record<string, { balance: number; rate: number }>; // by debtId; rate is annual %
  housingMode: HousingMode;
}

/** The runner's mortgage balance and rate, from the shared resolver: the whole
 *  loan, at the current loan's rate in both owner modes (the planned purchase
 *  loan is never paid). */
export function automationMortgage(m: CurrentMortgage): Pick<AutomationState, 'mortgage' | 'mortgageRate'> {
  return { mortgage: m.fullBalance, mortgageRate: m.ratePct };
}

export interface ResolvedPosting {
  rule: AutomationRule;
  monthsDue: number;             // months actually applied (>= 1; capped when capMonths given)
  targetKind: AutomationTargetKind;
  savingsAccountId?: string;
  debtId?: string;
  newBalance: number;            // absolute value to write (already floored & rounded)
  newLastPostedMonth: string;    // === currentMonth
  /** Paydown whose payment can't cover the monthly interest — balance left
   *  unchanged so the debt never grows; the UI surfaces a warning. */
  infeasible?: boolean;
  /** Nothing moves (a 'myShare' mortgage rule while the user carries none of
   *  the loan); the months are only stamped as posted, never caught up later. */
  noChange?: boolean;
}

/**
 * Balance after `months` payments of `payment` at `annualRatePct`, floored at 0.
 * Mirrors the amortize() loop in debt.ts: interest accrues, then the payment
 * applies. When the payment can't even cover the first month's interest the
 * balance can't shrink — reported as `infeasible` and left unchanged (we never
 * grow a debt from an under-funded expense). `interestCharged[i]` marks a month
 * whose interest another payment to the same loan already charged, so that
 * month's payment is all principal.
 */
export function applyAmortization(
  balance: number, annualRatePct: number, payment: number, months: number,
  interestCharged: readonly boolean[] = [],
): { balance: number; infeasible: boolean } {
  if (!(balance > 0)) return { balance: 0, infeasible: false };
  const r = annualRatePct / 1200;
  if (r > 0 && !interestCharged[0] && payment <= balance * r) return { balance, infeasible: true };
  let bal = balance;
  for (let i = 0; i < months && bal > 0; i++) {
    const interest = interestCharged[i] ? 0 : bal * r;
    bal = Math.max(0, bal + interest - Math.min(payment, bal + interest));
  }
  return { balance: bal, infeasible: false };
}

/**
 * Resolve the postings due this month. `capMonths` limits how many months are
 * applied (used for the "decline catch-up → post one month only" path); the
 * stamp still advances to `currentMonth`, so the skipped months don't re-prompt.
 * A rule whose linked target no longer exists is skipped WITHOUT a stamp, so it
 * resumes cleanly if the target reappears. `others` are rules not posted in this
 * call whose stamps still count: a month another rule already paid into the
 * same loan has had its interest charged. (A declined catch-up stamps months it
 * never paid, so those count as charged too.)
 */
export function computeAutomationPostings(
  rules: AutomationRule[],
  state: AutomationState,
  currentMonth: string,
  capMonths?: number,
  others: AutomationRule[] = [],
): ResolvedPosting[] {
  // Working copies so two expenses pointed at the same target stack rather than
  // clobber (each posting's newBalance already includes the earlier ones).
  const savings = { ...state.savings };
  const scalars = { ...state.scalars };
  const debts: Record<string, { balance: number; rate: number }> =
    Object.fromEntries(Object.entries(state.debts).map(([id, d]) => [id, { ...d }]));
  let mortgage = state.mortgage;
  // Months whose interest is already charged, per loan ('mortgage' or a debt
  // id): a second payment to the same loan in the same month is all principal.
  const charged: Record<string, Set<string>> = {};
  const loanOf = (r: AutomationRule) =>
    r.targetKind === 'mortgage' ? 'mortgage' : r.targetKind === 'debt' ? `debt:${r.debtId}` : undefined;
  const postedThrough: Record<string, string> = {};
  for (const r of [...rules, ...others]) {
    const loan = loanOf(r);
    if (loan && r.lastPostedMonth && !(postedThrough[loan] >= r.lastPostedMonth)) postedThrough[loan] = r.lastPostedMonth;
  }
  // The largest payment to a loan goes first, so a small extra payment is never
  // judged alone against the month's whole interest. Stable, so every other
  // rule keeps its order.
  const loanPayment = (r: AutomationRule) => (loanOf(r) ? r.amount : 0);
  const ordered = [...rules].sort((a, b) => loanPayment(b) - loanPayment(a));

  const out: ResolvedPosting[] = [];
  for (const rule of ordered) {
    const fromMonth = rule.lastPostedMonth ? addMonthsKey(rule.lastPostedMonth, 1) : rule.startMonth;
    const dueMonths = monthsBetween(fromMonth, currentMonth);
    const due = dueMonths.length;
    if (due <= 0) continue;
    const monthsDue = capMonths != null ? Math.min(due, capMonths) : due;
    // The months applied — the most recent ones when capped.
    const appliedMonths = dueMonths.slice(due - monthsDue);
    // What a balance-growing target gains over them, each at its own month's amount.
    const added = appliedMonths.reduce((sum, m) => sum + (rule.amountByMonth?.[m] ?? rule.amount), 0);
    const amortize = (loan: string, balance: number, rate: number, payment: number) => {
      const seen = (charged[loan] ??= new Set());
      const through = postedThrough[loan];
      const res = applyAmortization(balance, rate, payment, monthsDue,
        appliedMonths.map(m => seen.has(m) || (through !== undefined && m <= through)));
      if (!res.infeasible) appliedMonths.forEach(m => seen.add(m));
      return res;
    };

    let newBalance: number;
    let infeasible = false;
    let noChange = false;
    if (rule.targetKind === 'savingsAccount') {
      if (!rule.savingsAccountId || !(rule.savingsAccountId in savings)) continue;
      newBalance = Math.round(savings[rule.savingsAccountId] + added);
      savings[rule.savingsAccountId] = newBalance;
    } else if (isScalarTarget(rule.targetKind)) {
      // A single named scalar (emergency fund, portfolio, BSU, OTP, IPS) — grows
      // like a savings account, no id needed.
      newBalance = Math.round(scalars[rule.targetKind] + added);
      scalars[rule.targetKind] = newBalance;
    } else if (rule.targetKind === 'mortgage') {
      if (state.housingMode === 'first_buyer') continue; // no mortgage exists in this mode
      // A 'myShare' amount is the user's part of the joint instalment: the loan
      // receives the whole instalment. A catch-up uses today's share for every
      // month it applies.
      const share = state.mortgageDebtShare ?? 1;
      if (rule.mortgagePaymentScope === 'myShare' && !(share > 0)) {
        // Carries none of the loan, so none of this payment reaches it. Stamp
        // the months anyway, or they would pile up into one catch-up later.
        newBalance = Math.round(mortgage);
        noChange = true;
      } else {
        const payment = rule.mortgagePaymentScope === 'myShare' ? rule.amount / share : rule.amount;
        const res = amortize(loanOf(rule)!, mortgage, state.mortgageRate, payment);
        newBalance = Math.round(res.balance);
        infeasible = res.infeasible;
        mortgage = newBalance;
      }
    } else {
      if (!rule.debtId || !(rule.debtId in debts)) continue;
      const d = debts[rule.debtId];
      const res = amortize(loanOf(rule)!, d.balance, d.rate, rule.amount);
      newBalance = Math.round(res.balance);
      infeasible = res.infeasible;
      d.balance = newBalance;
    }

    out.push({
      rule,
      monthsDue,
      targetKind: rule.targetKind,
      savingsAccountId: rule.savingsAccountId,
      debtId: rule.debtId,
      newBalance,
      newLastPostedMonth: currentMonth,
      infeasible,
      ...(noChange ? { noChange } : {}),
    });
  }
  return out;
}

/** The fixed-expense fields `monthlyPaydownPrincipal` reads. */
export interface PaydownExpense {
  amount: number;
  destinationKind?: 'mortgage' | 'debt';
  debtId?: string;
  mortgagePaymentScope?: 'whole' | 'myShare';
  automationPaused?: boolean;
}

/**
 * The principal that one month of the paydown fixed expenses moves off the
 * loans, on the user's share: the part of those payments that builds equity
 * instead of leaving as interest. Runs the same amortisation as the runner
 * (`computeAutomationPostings`) for exactly `month`, from today's balances.
 *
 * The mortgage counts at the user's debt share whatever the payment scope: a
 * 'myShare' payment reaches the loan grossed up by the share, and a 'whole'
 * payment also pays down the co-owners' part, which is not the user's to keep.
 * A paused expense moves nothing, and a payment that can't cover the interest
 * builds nothing.
 */
export function monthlyPaydownPrincipal(
  expenses: readonly PaydownExpense[],
  state: Pick<AutomationState, 'mortgage' | 'mortgageRate' | 'mortgageDebtShare' | 'debts' | 'housingMode'>,
  month: string,
): number {
  const prev = addMonthsKey(month, -1);
  const rules: AutomationRule[] = expenses
    .filter(e => e.destinationKind && !e.automationPaused && Number.isFinite(e.amount) && e.amount > 0)
    .map((e, i) => ({
      id: `paydown:${i}`, name: '', amount: e.amount, targetKind: e.destinationKind!,
      debtId: e.debtId, mortgagePaymentScope: e.mortgagePaymentScope,
      startMonth: month, lastPostedMonth: prev,
    }));
  if (rules.length === 0) return 0;
  const scalars = Object.fromEntries(SCALAR_TARGETS.map(k => [k, 0])) as Record<ScalarTargetKind, number>;
  const postings = computeAutomationPostings(rules, { ...state, savings: {}, scalars }, month, 1);
  // Each loan's balance after the month: postings to one loan stack, so the last wins.
  let mortgageAfter: number | undefined;
  const debtAfter: Record<string, number> = {};
  for (const p of postings) {
    if (p.targetKind === 'mortgage') mortgageAfter = p.newBalance;
    else if (p.targetKind === 'debt' && p.debtId) debtAfter[p.debtId] = p.newBalance;
  }
  const finite = (n: number | undefined) => (Number.isFinite(n) ? (n as number) : 0);
  const share = Number.isFinite(state.mortgageDebtShare) ? Math.min(1, Math.max(0, state.mortgageDebtShare!)) : 1;
  let total = mortgageAfter === undefined ? 0 : Math.max(0, finite(state.mortgage) - mortgageAfter) * share;
  for (const [id, after] of Object.entries(debtAfter)) total += Math.max(0, finite(state.debts[id]?.balance) - after);
  return Math.round(total);
}
