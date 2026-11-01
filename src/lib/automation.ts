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
import type { CoOwner, FixedExpense } from '../context/FinanceContext';
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
  /** A rule that never posts: a paused paydown expense, or what the expenses
   *  that left a loan had paid (`departedPaydowns`). Its stamp still says which
   *  months' interest it charged, so no other rule charges them again. */
  paused?: boolean;
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
 * `uncoveredMonths` (a declined catch-up, or a payment below the interest). A
 * `paused` rule, in either list, never posts and counts only through its stamp.
 *
 * Each loan steps month by month across every rule paying it in this call: a
 * month's interest is charged once, then each rule's payment for that month,
 * so the order the rules come in never changes the balance. A month an earlier
 * call already charged was charged on a balance without this call's payments
 * from the months before it, so the interest on those is given back. That keeps
 * the balance the same whichever catch-up prompt is answered first.
 */
export function computeAutomationPostings(
  rules: AutomationRule[],
  state: AutomationState,
  currentMonth: string,
  capMonths?: number,
  others: AutomationRule[] = [],
): ResolvedPosting[] {
  // Working copies so two rules pointed at the same savings target stack rather
  // than clobber (each posting's newBalance already includes the earlier ones).
  const savings = { ...state.savings };
  const scalars = { ...state.scalars };
  const loanOf = (r: AutomationRule) =>
    r.targetKind === 'mortgage' ? 'mortgage' : r.targetKind === 'debt' ? `debt:${r.debtId}` : undefined;
  const participants = [...rules, ...others];
  // Every rule on each loan, as stamped before this call.
  const loanRules: Record<string, AutomationRule[]> = {};
  for (const r of participants) {
    const loan = loanOf(r);
    if (loan) (loanRules[loan] ??= []).push(r);
  }
  // How much of a month's interest earlier calls paid: all of it once a rule
  // whose stamp covers the month covered it, else what the rules that fell short put in.
  const paidBefore = (loan: string, m: string) => {
    let paid = 0;
    for (const r of loanRules[loan] ?? []) {
      if (r.lastPostedMonth === undefined || m > r.lastPostedMonth) continue;
      const part = r.uncoveredMonths?.[m];
      if (part === undefined) return Infinity;
      paid += part;
    }
    return paid;
  };

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
  // the co-owners paid its interest, so no rule charges it, whether the
  // 'myShare' rule posts in this call, in a later prompt (`others`), was capped
  // or is already stamped past it. Otherwise the order the prompts are answered
  // in would change the balance. A paused 'myShare' rule counts only up to its stamp.
  const coOwnersPaid = (m: string) => !(debtShareAt(state, m) > 0) && participants.some(r => isMyShare(r)
    && ((r.lastPostedMonth !== undefined && m <= r.lastPostedMonth) || (!r.paused && monthsOf(r).dueMonths.includes(m))));

  // The largest payment to a loan comes first. Stable, so every other rule
  // keeps its order (two rules on one savings target stack in input order).
  const loanPayment = (r: AutomationRule) => (loanOf(r) ? r.amount : 0);
  const ordered = rules.filter(r => !r.paused).sort((a, b) => loanPayment(b) - loanPayment(a));
  const resolved = new Map<AutomationRule, ResolvedPosting>();
  const post = (rule: AutomationRule, monthsDue: number, newBalance: number, extra: Partial<ResolvedPosting> = {}) =>
    resolved.set(rule, {
      rule,
      monthsDue,
      targetKind: rule.targetKind,
      savingsAccountId: rule.savingsAccountId,
      debtId: rule.debtId,
      newBalance,
      newLastPostedMonth: currentMonth,
      infeasible: false,
      ...extra,
    });

  // Balance-growing targets post one rule at a time; loan rules are gathered per loan.
  const byLoan = new Map<string, AutomationRule[]>();
  for (const rule of ordered) {
    const { due, monthsDue, appliedMonths } = monthsOf(rule);
    if (due <= 0) continue;
    const loan = loanOf(rule);
    if (loan) {
      if (rule.targetKind === 'mortgage' && state.housingMode === 'first_buyer') continue; // no mortgage exists in this mode
      if (rule.targetKind === 'debt' && (!rule.debtId || !(rule.debtId in state.debts))) continue;
      byLoan.set(loan, [...(byLoan.get(loan) ?? []), rule]);
      continue;
    }
    // What the target gains over them, each at its own month's amount.
    const added = appliedMonths.reduce((sum, m) => sum + (rule.amountByMonth?.[m] ?? rule.amount), 0);
    let newBalance: number;
    if (rule.targetKind === 'savingsAccount') {
      if (!rule.savingsAccountId || !(rule.savingsAccountId in savings)) continue;
      newBalance = Math.round(savings[rule.savingsAccountId] + added);
      savings[rule.savingsAccountId] = newBalance;
    } else if (isScalarTarget(rule.targetKind)) {
      // A single named scalar (emergency fund, portfolio, BSU, OTP, IPS) — grows
      // like a savings account, no id needed.
      newBalance = Math.round(scalars[rule.targetKind] + added);
      scalars[rule.targetKind] = newBalance;
    } else continue;
    post(rule, monthsDue, newBalance);
  }

  // Each loan, month by month across the rules paying it.
  for (const [loan, due] of byLoan) {
    const debt = loan === 'mortgage' ? undefined : state.debts[due[0].debtId!];
    const balance = debt ? debt.balance : state.mortgage;
    // Nothing owed on a balance at or below 0 (or a broken one), as in applyAmortization.
    const start = balance > 0 ? balance : 0;
    const ratePct = debt ? debt.rate : state.mortgageRate;
    const plans = due.map(rule => {
      // A 'myShare' amount is the user's part of the joint instalment: the loan
      // receives the whole instalment, at the share in force each month. A
      // month the user carries none of the loan moves nothing.
      const myShare = isMyShare(rule);
      const months = monthsOf(rule);
      const paying = new Set(myShare ? months.appliedMonths.filter(m => debtShareAt(state, m) > 0) : months.appliedMonths);
      const pay = (m: string) => (myShare ? rule.amount / debtShareAt(state, m) : rule.amount);
      // Months whose interest this payment couldn't cover → what it put toward it.
      const short: Record<string, number> = {};
      return { rule, ...months, paying, pay, short };
    });
    let bal = start;
    for (const m of [...new Set(plans.flatMap(p => [...p.paying]))].sort()) {
      if (!(bal > 0)) break;
      const free = loan === 'mortgage' && coOwnersPaid(m);
      let paid = free ? Infinity : paidBefore(loan, m);
      // Charged by an earlier call, on a balance this call's payments had not
      // yet reduced: give back the interest on what they moved.
      if (!free && paid === Infinity) bal = Math.max(0, bal - (start - bal) * ratePct / 1200);
      // The largest payment first, so a small extra payment is never judged
      // alone against the month's whole interest.
      const payers = plans.filter(p => p.paying.has(m)).sort((a, b) => b.pay(m) - a.pay(m));
      for (const p of payers) {
        const amount = p.pay(m);
        const res = applyAmortization(bal, ratePct, amount, 1, [paid]);
        if (res.infeasible) { p.short[m] = amount; paid += amount; } else { bal = res.balance; paid = Infinity; }
      }
    }
    const newBalance = Math.round(bal);

    for (const { rule, dueMonths, due: dueCount, monthsDue, paying, short } of plans) {
      // A capped loan catch-up skips its earliest months, and a short payment
      // leaves part of a month's interest. Remember the ones another rule on the
      // loan may still pay, so that payment charges what is left. Months every
      // other active rule's stamp has passed are dropped.
      const monthsShort = Object.keys(short).length;
      let uncoveredMonths: Record<string, number> | undefined;
      if (monthsDue < dueCount || monthsShort > 0) {
        const otherNeeds = (m: string) => (loanRules[loan] ?? []).some(r =>
          r.id !== rule.id && !r.paused && r.lastPostedMonth !== undefined && r.lastPostedMonth < m);
        // A 'myShare' rule's months at a 0 % share are not uncovered: the co-owners paid them.
        const skipped = Object.fromEntries(dueMonths.slice(0, dueCount - monthsDue)
          .filter(m => !isMyShare(rule) || debtShareAt(state, m) > 0).map(m => [m, 0]));
        uncoveredMonths = Object.fromEntries(Object.entries({ ...rule.uncoveredMonths, ...skipped, ...short })
          .filter(([m]) => otherNeeds(m)));
      }
      // A payment that reaches the loan in none of its months still stamps
      // them, or they would pile up into one catch-up later.
      post(rule, monthsDue, paying.size ? newBalance : Math.round(balance), {
        ...(uncoveredMonths ? { uncoveredMonths } : {}),
        infeasible: monthsShort > 0,
        ...(monthsShort > 0 ? { monthsShort } : {}),
        ...(paying.size === 0 ? { noChange: true } : {}),
      });
    }
  }
  return ordered.filter(r => resolved.has(r)).map(r => resolved.get(r)!);
}

/** The fixed-expense fields `monthlyPaydownPrincipal` reads. */
export interface PaydownExpense {
  amount: number;
  destinationKind?: 'mortgage' | 'debt';
  debtId?: string;
  mortgagePaymentScope?: 'whole' | 'myShare';
  automationPaused?: boolean;
}

type StampedExpense = Pick<FixedExpense,
  'id' | 'destinationKind' | 'debtId' | 'automationPaused' | 'lastPostedMonth' | 'uncoveredMonths'>;

/** The loan a paydown expense pays ('mortgage' or 'debt:<id>'), as the runner keys it. */
const expenseLoan = (e: Pick<FixedExpense, 'destinationKind' | 'debtId'>) =>
  e.destinationKind === 'mortgage' ? 'mortgage' : e.destinationKind === 'debt' ? `debt:${e.debtId}` : undefined;

/**
 * The `uncoveredMonths` for a paydown expense whose stamp moves to `month`
 * without paying anything: it was just created, resumed from a pause, or
 * pointed at another loan. The new stamp covers every month up to `month`, so
 * each of those it never paid is recorded as 0, and another expense's catch-up
 * on the same loan still charges that month's interest. `prev` is the expense
 * before the change (absent when new); its record carries over only while it
 * stays on the same loan. As in the runner, only months another active expense
 * on the loan has not passed yet are kept. Undefined = nothing to record.
 */
export function unpaidStampMonths(
  prev: StampedExpense | undefined,
  next: Pick<FixedExpense, 'destinationKind' | 'debtId'>,
  month: string,
  expenses: readonly StampedExpense[],
): Record<string, number> | undefined {
  const loan = expenseLoan(next);
  if (!loan) return undefined;
  const sameLoan = prev !== undefined && expenseLoan(prev) === loan;
  // Up to the old stamp on the same loan, the old record still says what was paid.
  const paidThrough = sameLoan ? prev.lastPostedMonth : undefined;
  const stamps = expenses
    .filter(e => e.id !== prev?.id && !e.automationPaused && expenseLoan(e) === loan && e.lastPostedMonth !== undefined)
    .map(e => e.lastPostedMonth!);
  if (!stamps.length) return undefined;
  const earliest = stamps.reduce((a, b) => (b < a ? b : a));
  const from = paidThrough !== undefined && paidThrough > earliest ? paidThrough : earliest;
  const unpaid = Object.fromEntries(monthsBetween(addMonthsKey(from, 1), month).map(m => [m, 0]));
  const kept = Object.entries({ ...(sameLoan ? prev.uncoveredMonths : undefined), ...unpaid })
    .filter(([m]) => stamps.some(s => s < m));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * The stamp a paydown expense carries after the edit dialog saves it. A new
 * destination, or a resume from a pause, restamps it to `month` without paying
 * anything (so the first move is next month and paused months are never
 * back-posted), recording the months it newly covers as unpaid
 * (`unpaidStampMonths`). An unchanged destination keeps the stamp and its
 * record; no destination clears both.
 */
export function paydownStampOnSave(
  prev: StampedExpense | undefined,
  next: Pick<FixedExpense, 'destinationKind' | 'debtId' | 'automationPaused'>,
  month: string,
  expenses: readonly StampedExpense[],
): Pick<FixedExpense, 'lastPostedMonth' | 'uncoveredMonths'> {
  if (!next.destinationKind) return { lastPostedMonth: undefined, uncoveredMonths: undefined };
  const sameDest = prev?.destinationKind === next.destinationKind && prev?.debtId === next.debtId;
  const resumed = !!prev?.automationPaused && !next.automationPaused;
  if (sameDest && !resumed) return { lastPostedMonth: prev?.lastPostedMonth, uncoveredMonths: prev?.uncoveredMonths };
  return { lastPostedMonth: month, uncoveredMonths: unpaidStampMonths(prev, next, month, expenses) };
}

/** What paydown expenses that left a loan had paid on it: their merged stamp. */
export interface PaydownStamp {
  lastPostedMonth: string;
  /** As on a fixed expense: months up to the stamp whose interest was not covered. */
  uncoveredMonths?: Record<string, number>;
}

/**
 * Two stamps on one loan as one: a month counts as charged when either
 * charged it; otherwise what each put toward its interest adds up.
 */
export function mergePaydownStamps(a: PaydownStamp | undefined, b: PaydownStamp): PaydownStamp {
  if (!a) return b;
  const [later, earlier] = a.lastPostedMonth >= b.lastPostedMonth ? [a, b] : [b, a];
  const uncovered = Object.entries(later.uncoveredMonths ?? {}).flatMap(([m, kr]): [string, number][] => {
    if (m > earlier.lastPostedMonth) return [[m, kr]];
    const part = earlier.uncoveredMonths?.[m];
    return part === undefined ? [] : [[m, kr + part]];
  });
  return { lastPostedMonth: later.lastPostedMonth, ...(uncovered.length ? { uncoveredMonths: Object.fromEntries(uncovered) } : {}) };
}

/**
 * `record` (by loan, as the runner keys it) with the stamps of the paydown
 * expenses that left a loan between `prev` and `next`: deleted, pointed at
 * another loan, or with the destination cleared. The months such an expense
 * paid had their interest charged, and without its stamp another expense's
 * catch-up would charge them again. A stamp is kept only while another active
 * expense on the loan is stamped before it, so that catch-up is still to come.
 * Returns `record` itself when nothing that matters left a loan.
 */
export function recordDepartedPaydowns(
  record: Record<string, PaydownStamp> | undefined,
  prev: readonly StampedExpense[],
  next: readonly StampedExpense[],
): Record<string, PaydownStamp> | undefined {
  let out = record;
  for (const e of prev) {
    const loan = expenseLoan(e);
    const stamp = e.lastPostedMonth;
    if (!loan || stamp === undefined) continue;
    const now = next.find(n => n.id === e.id);
    if (now && expenseLoan(now) === loan) continue;
    const behind = next.some(n => n.id !== e.id && !n.automationPaused && expenseLoan(n) === loan
      && n.lastPostedMonth !== undefined && n.lastPostedMonth < stamp);
    if (!behind) continue;
    const left: PaydownStamp = { lastPostedMonth: stamp, ...(e.uncoveredMonths ? { uncoveredMonths: e.uncoveredMonths } : {}) };
    out = { ...out, [loan]: mergePaydownStamps(out?.[loan], left) };
  }
  return out;
}

/** The departed stamps as runner rules that never post but whose stamps count. */
export function departedPaydownRules(record: Record<string, PaydownStamp> | undefined): AutomationRule[] {
  return Object.entries(record ?? {}).map(([loan, stamp]) => ({
    id: `departed:${loan}`,
    name: '',
    amount: 0,
    targetKind: loan === 'mortgage' ? 'mortgage' as const : 'debt' as const,
    ...(loan === 'mortgage' ? {} : { debtId: loan.slice('debt:'.length) }),
    startMonth: stamp.lastPostedMonth,
    lastPostedMonth: stamp.lastPostedMonth,
    ...(stamp.uncoveredMonths ? { uncoveredMonths: stamp.uncoveredMonths } : {}),
    paused: true,
  }));
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
