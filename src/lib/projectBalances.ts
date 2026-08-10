// Growing today's balances forward into a month that has not happened yet.
//
// The balance pages can render any past month from a captured snapshot. A future
// month has nothing to read, so this module *computes* one: it takes the live
// balances and runs the automation that has not fired yet.
//
// It never writes. The projection is assembled in the view layer and thrown away
// on the next render; the three code paths that persist anything — the snapshot
// capture, the automation rule set, and the runner effect — all read the real
// clock via `currentMonthKey()`, so a projected month is invisible to them.
import { computeAutomationPostings, type AutomationRule, type AutomationState } from './automation';
import { monthsBetween } from './date';
import type { SnapshotBalances } from './snapshots';

/**
 * Annual growth percentages, one per bucket that can grow on its own. Supplying
 * these switches the projection from "only the transfers you set up" to "those
 * transfers plus assumed market growth" — the toggle on a projected month.
 */
export interface ProjectionRates {
  /** Investment portfolio. */
  portfolio: number;
  /** Savings accounts, buffer and BSU. */
  cash: number;
  crypto: number;
  house: number;
}

/** Whole months from `fromMonth` to `toMonth`; 0 when `toMonth` is not later. */
export function monthsAhead(fromMonth: string, toMonth: string): number {
  return toMonth > fromMonth ? monthsBetween(fromMonth, toMonth).length - 1 : 0;
}

/** Compound `annualPct` over `months`, as a multiplier. A non-finite or
 *  non-positive rate leaves the balance alone rather than poisoning it. */
function growth(annualPct: number, months: number): number {
  if (!Number.isFinite(annualPct) || annualPct <= 0 || months <= 0) return 1;
  return (1 + annualPct / 100) ** (months / 12);
}

/**
 * Project `base` forward to `targetMonth`.
 *
 * Contributions come from `computeAutomationPostings`, which is already pure and
 * already takes the month as a parameter: handed a future key it reports what
 * each rule will have moved by then, mortgage and debt amortization included.
 * So the arithmetic here is only the folding, plus optional growth.
 *
 * When `rates` is given, growth compounds on the balance held TODAY and the new
 * contributions are added at face value. That understates the result slightly,
 * which is the honest direction to be wrong in, and it keeps the growth figure
 * explainable as "what today's money earns" rather than a blended number nobody
 * can reproduce by hand. Debts never grow here — `applyAmortization` has already
 * charged their interest inside the posting.
 */
export function projectSnapshotBalances(
  base: SnapshotBalances,
  rules: AutomationRule[],
  state: AutomationState,
  targetMonth: string,
  nowMonth: string,
  rates?: ProjectionRates,
): SnapshotBalances {
  const months = monthsAhead(nowMonth, targetMonth);
  // Deep-copy every mutable slice: the caller's `base` is live app state, and a
  // projection that scribbled on it would corrupt the very balances it grew from.
  const out: SnapshotBalances = {
    ...base,
    savingsAccounts: base.savingsAccounts.map(s => ({ ...s })),
    debts: base.debts.map(d => ({ ...d })),
  };
  if (months <= 0) return out;

  for (const p of computeAutomationPostings(rules, state, targetMonth)) {
    if (p.targetKind === 'savingsAccount') {
      const acc = out.savingsAccounts.find(s => s.id === p.savingsAccountId);
      if (acc) acc.balance = p.newBalance;
    } else if (p.targetKind === 'debt') {
      const debt = out.debts.find(d => d.id === p.debtId);
      if (debt) debt.balance = p.newBalance;
    } else if (p.targetKind === 'mortgage') {
      out.houseDebt = p.newBalance;
    } else if (p.targetKind === 'pensionOtp') {
      out.otpBalance = p.newBalance;
    } else if (p.targetKind === 'pensionIps') {
      out.ipsBalance = p.newBalance;
    } else {
      // bufferAccount | portfolio | bsu — same name in both shapes.
      out[p.targetKind] = p.newBalance;
    }
  }

  if (rates) {
    const cash = growth(rates.cash, months);
    // Growth is earned on the opening balance, so it is computed from `base`
    // rather than from the already-contributed figure in `out`.
    out.portfolio += base.portfolio * (growth(rates.portfolio, months) - 1);
    out.crypto += base.crypto * (growth(rates.crypto, months) - 1);
    out.houseValue += base.houseValue * (growth(rates.house, months) - 1);
    out.bufferAccount += base.bufferAccount * (cash - 1);
    out.bsu += base.bsu * (cash - 1);
    out.savingsAccounts.forEach((acc, i) => {
      acc.balance += (base.savingsAccounts[i]?.balance ?? 0) * (cash - 1);
    });
  }

  // Whole kroner throughout, matching what the automation runner would store.
  out.portfolio = Math.round(out.portfolio);
  out.crypto = Math.round(out.crypto);
  out.houseValue = Math.round(out.houseValue);
  out.houseDebt = Math.round(out.houseDebt);
  out.bufferAccount = Math.round(out.bufferAccount);
  out.bsu = Math.round(out.bsu);
  out.otpBalance = Math.round(out.otpBalance);
  out.ipsBalance = Math.round(out.ipsBalance);
  out.savingsAccounts.forEach(acc => { acc.balance = Math.round(acc.balance); });
  out.debts.forEach(d => { d.balance = Math.round(d.balance); });
  return out;
}
