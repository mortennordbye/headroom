import { calcTaxByRegion, type Region } from './norwegianTax';

/**
 * The gross annual income whose `calcTaxByRegion` net equals `netAnnual`, with
 * the same deductions. Inverts the tax calculation by bisection: net never
 * falls as gross rises (no marginal rate reaches 100%), and gross is never
 * below net. Non-positive or non-finite input gives 0.
 */
export function grossFromNetAnnual(
  netAnnual: number,
  region: Region,
  customRatePct: number,
  ipsContribution = 0,
  interestDeduction = 0,
  bsuTaxCredit = 0,
): number {
  if (!Number.isFinite(netAnnual) || netAnnual <= 0) return 0;
  const net = (gross: number) =>
    calcTaxByRegion(gross, region, customRatePct, ipsContribution, interestDeduction, bsuTaxCredit).netAnnual;
  let lo = netAnnual;
  let hi = netAnnual * 2;
  // A flat 100% rate never reaches the target; stop at a finite bound.
  for (let i = 0; i < 40 && net(hi) < netAnnual; i++) hi *= 2;
  for (let i = 0; i < 60 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (net(mid) < netAnnual) lo = mid;
    else hi = mid;
  }
  return Math.round(hi);
}
