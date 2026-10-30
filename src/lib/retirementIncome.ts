// Yearly retirement income in today's kroner, shared by the Pension and Forecast
// pages and the MCP pension summary. Folketrygd and AFP are estimated at today's
// G, so they are already in today's kroner. OTP/IPS payouts come from balances
// projected to the retirement year, so they are future kroner and are discounted
// by inflation over the years to retirement before being added to the rest.
import { inTodaysKroner } from './inflation';

export interface RetirementIncomeInput {
  folketrygdAnnual: number;
  afpAnnual: number;
  /** Nominal OTP/IPS payout per year, in kroner of the retirement year. */
  otpAnnualPayout: number;
  ipsAnnualPayout: number;
  yearsToRetire: number;
  inflationPct: number;
}

export interface RetirementIncomeToday {
  folketrygd: number;
  afp: number;
  otp: number;
  ips: number;
  gross: number;
}

export function retirementIncomeInTodaysKroner(p: RetirementIncomeInput): RetirementIncomeToday {
  const otp = inTodaysKroner(p.otpAnnualPayout, p.yearsToRetire, p.inflationPct);
  const ips = inTodaysKroner(p.ipsAnnualPayout, p.yearsToRetire, p.inflationPct);
  return {
    folketrygd: p.folketrygdAnnual,
    afp: p.afpAnnual,
    otp,
    ips,
    gross: p.folketrygdAnnual + p.afpAnnual + otp + ips,
  };
}
