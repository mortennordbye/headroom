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

export type AutomationTargetKind = 'savingsAccount' | 'mortgage' | 'debt';
export type HousingMode = 'first_buyer' | 'homeowner' | 'transitioning';

// A destination-bearing fixed expense projected to the shape the runner needs.
export interface AutomationRule {
  id: string;                 // the fixed expense's id
  name: string;
  amount: number;             // positive monthly kr (the expense amount)
  targetKind: AutomationTargetKind;
  savingsAccountId?: string;  // set iff targetKind === 'savingsAccount'
  debtId?: string;            // set iff targetKind === 'debt'
  startMonth: string;         // 'yyyy-MM', first eligible month (fallback when never posted)
  lastPostedMonth?: string;   // 'yyyy-MM' last applied; absent = never. Double-apply guard.
}

/** Live balances/rates the runner needs to resolve absolute new values. */
export interface AutomationState {
  savings: Record<string, number>;                       // by savingsAccountId
  mortgage: number;                                      // assets.houseDebt (the mirrored balance)
  mortgageRate: number;                                  // annual %, homeowner.rente | loan.rente by mode
  debts: Record<string, { balance: number; rate: number }>; // by debtId; rate is annual %
  housingMode: HousingMode;
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
}

/**
 * Balance after `months` payments of `payment` at `annualRatePct`, floored at 0.
 * Mirrors the amortize() loop in debt.ts: interest accrues, then the payment
 * applies. When the payment can't even cover the first month's interest the
 * balance can't shrink — reported as `infeasible` and left unchanged (we never
 * grow a debt from an under-funded expense).
 */
export function applyAmortization(
  balance: number, annualRatePct: number, payment: number, months: number,
): { balance: number; infeasible: boolean } {
  if (!(balance > 0)) return { balance: 0, infeasible: false };
  const r = annualRatePct / 1200;
  if (r > 0 && payment <= balance * r) return { balance, infeasible: true };
  let bal = balance;
  for (let i = 0; i < months && bal > 0; i++) {
    const interest = bal * r;
    bal = Math.max(0, bal + interest - Math.min(payment, bal + interest));
  }
  return { balance: bal, infeasible: false };
}

/**
 * Resolve the postings due this month. `capMonths` limits how many months are
 * applied (used for the "decline catch-up → post one month only" path); the
 * stamp still advances to `currentMonth`, so the skipped months don't re-prompt.
 * A rule whose linked target no longer exists is skipped WITHOUT a stamp, so it
 * resumes cleanly if the target reappears.
 */
export function computeAutomationPostings(
  rules: AutomationRule[],
  state: AutomationState,
  currentMonth: string,
  capMonths?: number,
): ResolvedPosting[] {
  // Working copies so two expenses pointed at the same target stack rather than
  // clobber (each posting's newBalance already includes the earlier ones).
  const savings = { ...state.savings };
  const debts: Record<string, { balance: number; rate: number }> =
    Object.fromEntries(Object.entries(state.debts).map(([id, d]) => [id, { ...d }]));
  let mortgage = state.mortgage;

  const out: ResolvedPosting[] = [];
  for (const rule of rules) {
    const fromMonth = rule.lastPostedMonth ? addMonthsKey(rule.lastPostedMonth, 1) : rule.startMonth;
    const due = monthsBetween(fromMonth, currentMonth).length;
    if (due <= 0) continue;
    const monthsDue = capMonths != null ? Math.min(due, capMonths) : due;

    let newBalance: number;
    let infeasible = false;
    if (rule.targetKind === 'savingsAccount') {
      if (!rule.savingsAccountId || !(rule.savingsAccountId in savings)) continue;
      newBalance = Math.round(savings[rule.savingsAccountId] + rule.amount * monthsDue);
      savings[rule.savingsAccountId] = newBalance;
    } else if (rule.targetKind === 'mortgage') {
      if (state.housingMode === 'first_buyer') continue; // no mortgage exists in this mode
      const res = applyAmortization(mortgage, state.mortgageRate, rule.amount, monthsDue);
      newBalance = Math.round(res.balance);
      infeasible = res.infeasible;
      mortgage = newBalance;
    } else {
      if (!rule.debtId || !(rule.debtId in debts)) continue;
      const d = debts[rule.debtId];
      const res = applyAmortization(d.balance, d.rate, rule.amount, monthsDue);
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
    });
  }
  return out;
}
