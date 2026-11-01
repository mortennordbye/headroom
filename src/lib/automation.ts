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
import type { CoOwner } from '../context/FinanceContext';
import { ownershipShares } from './ownership';

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
  /** Loan rules only: 'yyyy-MM' → kr for months up to `lastPostedMonth` whose
   *  interest this rule did not cover: 0 for a month a declined catch-up
   *  skipped, or what it paid toward a month's interest it couldn't cover.
   *  Absent = it covered every month its stamp covers. */
  uncoveredMonths?: Record<string, number>;
}

/** Live balances/rates the runner needs to resolve absolute new values. */
export interface AutomationState {
  savings: Record<string, number>;                       // by savingsAccountId
  /** The single-scalar balances, keyed by the target kind that writes them. */
  scalars: Record<ScalarTargetKind, number>;
  mortgage: number;                                      // the whole loan (automationMortgage)
  mortgageRate: number;                                  // annual %, the current loan's (automationMortgage)
  /** The home's co-owners (`assets.coOwners`). The user's share of the joint
   *  mortgage is read per month from it, so a co-owner's since/until counts in
   *  every month a catch-up or projection applies; absent = the whole loan. */
  coOwners?: CoOwner[];
  /** By debtId; rate is annual %. `revolving` marks a card cleared every month. */
  debts: Record<string, { balance: number; rate: number; revolving?: boolean }>;
  housingMode: HousingMode;
}

/** The user's share (0..1) of the joint mortgage in `month`. */
const debtShareAt = (state: Pick<AutomationState, 'coOwners'>, month: string): number =>
  ownershipShares(state, month).debt;

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
  /** Set when a loan posting skipped months (capped) or couldn't cover a
   *  month's interest: the rule's new `uncoveredMonths`, so another rule's later
   *  catch-up still charges what is left of that interest. Empty = nothing to keep. */
  uncoveredMonths?: Record<string, number>;
  /** Paydown with months whose interest the payment can't cover. Those months
   *  leave the balance unchanged, so the debt never grows; the UI surfaces a warning. */
  infeasible?: boolean;
  /** How many of the applied months the payment couldn't cover. */
  monthsShort?: number;
  /** Nothing moves (a 'myShare' mortgage rule while the user carries none of
   *  the loan); the months are only stamped as posted, never caught up later. */
  noChange?: boolean;
}

/**
 * Balance after `months` payments of `payment` at `annualRatePct`, floored at 0.
 * Mirrors the amortize() loop in debt.ts: interest accrues, then the payment
 * applies. `interestPaid[i]` is how much of month i's interest other payments
 * to the same loan already paid (Infinity = all of it), so only the rest is
 * charged. A month whose remaining interest the payment can't cover leaves the
 * balance unchanged (we never grow a debt from an under-funded expense) and is
 * listed in `shortMonths`; the payment then went toward that interest.
 * `payment` may be one amount per month.
 */
export function applyAmortization(
  balance: number, annualRatePct: number, payment: number | readonly number[], months: number,
  interestPaid: readonly number[] = [],
): { balance: number; infeasible: boolean; shortMonths: number[] } {
  if (!(balance > 0)) return { balance: 0, infeasible: false, shortMonths: [] };
  const r = annualRatePct / 1200;
  const pay = (i: number) => (typeof payment === 'number' ? payment : payment[i] ?? 0);
  let bal = balance;
  const shortMonths: number[] = [];
  for (let i = 0; i < months && bal > 0; i++) {
    const interest = Math.max(0, bal * r - (interestPaid[i] ?? 0));
    if (interest > 0 && pay(i) <= interest) { shortMonths.push(i); continue; }
    bal = Math.max(0, bal + interest - Math.min(pay(i), bal + interest));
  }
  return { balance: bal, infeasible: shortMonths.length > 0, shortMonths };
}

/**
 * Resolve the postings due this month. `capMonths` limits how many months are
 * applied (used for the "decline catch-up → post one month only" path); the
 * stamp still advances to `currentMonth`, so the skipped months don't re-prompt.
 * A rule whose linked target no longer exists is skipped WITHOUT a stamp, so it
 * resumes cleanly if the target reappears. `others` are rules not posted in this
 * call whose stamps still count: a month another rule already paid into the
 * same loan has had its interest charged, unless that rule lists the month in
 * `uncoveredMonths` (a declined catch-up, or a payment below the interest).
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
  // Per loan ('mortgage' or a debt id), what this call has paid of each month's
  // interest: Infinity once a payment covered it, so the next is all principal.
  const paidInCall: Record<string, Record<string, number>> = {};
  const loanOf = (r: AutomationRule) =>
    r.targetKind === 'mortgage' ? 'mortgage' : r.targetKind === 'debt' ? `debt:${r.debtId}` : undefined;
  // Every rule on each loan, as stamped before this call.
  const loanRules: Record<string, AutomationRule[]> = {};
  for (const r of [...rules, ...others]) {
    const loan = loanOf(r);
    if (loan) (loanRules[loan] ??= []).push(r);
  }
  // How much of a month's interest is already paid: all of it once a rule whose
  // stamp covers the month covered it, else what the rules that fell short put in.
  const interestPaid = (loan: string, m: string) => {
    let paid = paidInCall[loan]?.[m] ?? 0;
    for (const r of loanRules[loan] ?? []) {
      if (r.lastPostedMonth === undefined || m > r.lastPostedMonth) continue;
      const part = r.uncoveredMonths?.[m];
      if (part === undefined) return Infinity;
      paid += part;
    }
    return paid;
  };
  // The largest payment to a loan goes first, so a small extra payment is never
  // judged alone against the month's whole interest. Stable, so every other
  // rule keeps its order.
  const loanPayment = (r: AutomationRule) => (loanOf(r) ? r.amount : 0);
  const ordered = [...rules].sort((a, b) => loanPayment(b) - loanPayment(a));

  const monthsOf = (rule: AutomationRule) => {
    const fromMonth = rule.lastPostedMonth ? addMonthsKey(rule.lastPostedMonth, 1) : rule.startMonth;
    const dueMonths = monthsBetween(fromMonth, currentMonth);
    const due = dueMonths.length;
    const monthsDue = capMonths != null ? Math.min(due, capMonths) : due;
    // The months applied — the most recent ones when capped.
    return { dueMonths, due, monthsDue, appliedMonths: dueMonths.slice(due - monthsDue) };
  };
  const isMyShare = (r: AutomationRule) => r.targetKind === 'mortgage' && r.mortgagePaymentScope === 'myShare';
  // A month a 'myShare' rule skips because the user carried none of the loan:
  // the co-owners paid its interest. That rule's stamp counts the month as
  // charged in later calls (it is never in uncoveredMonths), so it counts as
  // charged for every other rule in this call too, whatever the order.
  for (const r of rules.filter(isMyShare)) {
    for (const m of monthsOf(r).appliedMonths) if (!(debtShareAt(state, m) > 0)) (paidInCall.mortgage ??= {})[m] = Infinity;
  }

  const out: ResolvedPosting[] = [];
  for (const rule of ordered) {
    const { dueMonths, due, monthsDue, appliedMonths } = monthsOf(rule);
    if (due <= 0) continue;
    // What a balance-growing target gains over them, each at its own month's amount.
    const added = appliedMonths.reduce((sum, m) => sum + (rule.amountByMonth?.[m] ?? rule.amount), 0);
    // Months whose interest this payment couldn't cover → what it put toward it.
    const short: Record<string, number> = {};
    // `months` are the months this payment reaches the loan (a 'myShare' rule
    // leaves out months the user carried none of it), with `payment` one amount
    // or one per month; indices below are into `months`.
    const amortize = (loan: string, balance: number, rate: number, payment: number | number[],
      months: string[] = appliedMonths) => {
      const paid = (paidInCall[loan] ??= {});
      const res = applyAmortization(balance, rate, payment, months.length, months.map(m => interestPaid(loan, m)));
      months.forEach((m, i) => {
        const p = typeof payment === 'number' ? payment : payment[i];
        if (res.shortMonths.includes(i)) { short[m] = p; paid[m] = (paid[m] ?? 0) + p; }
        else paid[m] = Infinity;
      });
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
      // receives the whole instalment, at the share in force each month. A
      // month the user carries none of the loan moves nothing.
      const myShare = isMyShare(rule);
      const paying = myShare ? appliedMonths.filter(m => debtShareAt(state, m) > 0) : appliedMonths;
      if (paying.length === 0) {
        // None of this payment reaches the loan. Stamp the months anyway, or
        // they would pile up into one catch-up later.
        newBalance = Math.round(mortgage);
        noChange = true;
      } else {
        const payment = myShare ? paying.map(m => rule.amount / debtShareAt(state, m)) : rule.amount;
        const res = amortize(loanOf(rule)!, mortgage, state.mortgageRate, payment, paying);
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

    // A capped loan catch-up skips its earliest months, and a short payment
    // leaves part of a month's interest. Remember the ones another rule on the
    // loan may still pay, so that payment charges what is left. Months every
    // other rule's stamp has passed are dropped.
    const loan = loanOf(rule);
    const monthsShort = Object.keys(short).length;
    let uncoveredMonths: Record<string, number> | undefined;
    if (loan && (monthsDue < due || monthsShort > 0)) {
      const otherNeeds = (m: string) => (loanRules[loan] ?? []).some(r =>
        r.id !== rule.id && r.lastPostedMonth !== undefined && r.lastPostedMonth < m);
      const skipped = Object.fromEntries(dueMonths.slice(0, due - monthsDue).map(m => [m, 0]));
      uncoveredMonths = Object.fromEntries(Object.entries({ ...rule.uncoveredMonths, ...skipped, ...short })
        .filter(([m]) => otherNeeds(m)));
    }

    out.push({
      rule,
      monthsDue,
      targetKind: rule.targetKind,
      savingsAccountId: rule.savingsAccountId,
      debtId: rule.debtId,
      newBalance,
      newLastPostedMonth: currentMonth,
      ...(uncoveredMonths ? { uncoveredMonths } : {}),
      infeasible,
      ...(monthsShort > 0 ? { monthsShort } : {}),
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
 * The mortgage counts at the user's debt share in `month`, whatever the payment scope: a
 * 'myShare' payment reaches the loan grossed up by the share, and a 'whole'
 * payment also pays down the co-owners' part, which is not the user's to keep.
 * A paused expense moves nothing, and a payment that can't cover the interest
 * builds nothing. A revolving card is cleared every month and refilled by
 * spending, so paying it keeps nothing either.
 */
export function monthlyPaydownPrincipal(
  expenses: readonly PaydownExpense[],
  state: Pick<AutomationState, 'mortgage' | 'mortgageRate' | 'coOwners' | 'debts' | 'housingMode'>,
  month: string,
): number {
  const prev = addMonthsKey(month, -1);
  const rules: AutomationRule[] = expenses
    .filter(e => e.destinationKind && !e.automationPaused && Number.isFinite(e.amount) && e.amount > 0)
    .filter(e => !(e.destinationKind === 'debt' && e.debtId && state.debts[e.debtId]?.revolving))
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
  const share = debtShareAt(state, month);
  let total = mortgageAfter === undefined ? 0 : Math.max(0, finite(state.mortgage) - mortgageAfter) * share;
  for (const [id, after] of Object.entries(debtAfter)) total += Math.max(0, finite(state.debts[id]?.balance) - after);
  return Math.round(total);
}
