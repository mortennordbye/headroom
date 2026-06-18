import type { ExportPayload } from '../context/FinanceContext';

/**
 * A believable but entirely fictional dataset used by demo mode, so the app can
 * be shown to others without exposing the user's real finances.
 *
 * IMPORTANT: this must set EVERY field that can hold personal data (even to empty
 * values). Demo mode applies it via importAll, which only overwrites fields that
 * are present — any field omitted here would leak the user's real value into the
 * demo view. Display preferences (lang, currency, region, nav visibility) are
 * deliberately NOT set, so the presenter keeps their chosen language/layout.
 */
export function getDemoData(): Partial<ExportPayload> {
  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const dayThisMonth = (day: number) =>
    `${ym(now)}-${String(Math.min(day, now.getDate())).padStart(2, '0')}`;
  const monthsAgo = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
    return ym(d);
  };

  return {
    income: 62000,
    monthlyIncomes: {},
    netWorthHistory: {},
    savingsTargetPercent: 20,

    fixedExpenses: [
      { id: 'demo-fx-1', name: 'Huslån', amount: 16500 },
      { id: 'demo-fx-2', name: 'Felleskostnader', amount: 3400 },
      { id: 'demo-fx-3', name: 'Strøm', amount: 1300 },
      { id: 'demo-fx-4', name: 'Forsikring', amount: 650 },
      { id: 'demo-fx-5', name: 'Mobil/Internett', amount: 800 },
      { id: 'demo-fx-6', name: 'Trening', amount: 500 },
      { id: 'demo-fx-7', name: 'Mat', amount: 6500 },
    ],

    dailyTransactions: [
      { id: 'demo-tx-1', date: dayThisMonth(3), description: 'Rema 1000', amount: 742, category: 'Mat' },
      { id: 'demo-tx-2', date: dayThisMonth(6), description: 'Vinmonopolet', amount: 389, category: 'Annet' },
      { id: 'demo-tx-3', date: dayThisMonth(9), description: 'Ruter månedskort', amount: 850, category: 'Transport' },
      { id: 'demo-tx-4', date: dayThisMonth(12), description: 'Restaurant', amount: 640, category: 'Mat' },
      { id: 'demo-tx-5', date: dayThisMonth(15), description: 'Kino', amount: 220, category: 'Underholdning' },
      { id: 'demo-tx-6', date: dayThisMonth(18), description: 'Apotek', amount: 310, category: 'Helse' },
    ],

    recurringTemplates: [
      { id: 'demo-rt-1', description: 'Kaffe', amount: 49, category: 'Mat' },
      { id: 'demo-rt-2', description: 'Lunsj', amount: 129, category: 'Mat' },
    ],

    assets: {
      portfolio: 285000,
      unrealizedGain: 62000,
      taxRate: 37.84,
      bsu: 33000,
      savings: 95000,
      houseValue: 4200000,
      houseDebt: 2950000,
      crypto: 48000,
      cryptoUnrealizedGain: 15000,
      cryptoTaxRate: 22,
      bufferAccount: 60000,
    },

    housingMode: 'homeowner',
    homeowner: {
      currentMortgageBalance: 2950000,
      originalLoanAmount: 3400000,
      rente: 5.5,
      nedbetalingstid: 25,
      termingebyr: 50,
      skattefradragssats: 22,
    },
    transition: {
      currentHouseValue: 4200000,
      currentMortgageBalance: 2950000,
      agentFeePercent: 3,
      documentFee: 7500,
      otherSaleCosts: 0,
      bridgeMonths: 2,
      bridgeLoanRate: 6.5,
    },
    loan: {
      arslonn: 744000,
      eksisterendeGjeld: 0,
      egenkapital: 500000,
      laanebelop: 3000000,
      rente: 5.5,
      nedbetalingstid: 25,
      termingebyr: 50,
      etableringsgebyr: 0,
      skattefradragssats: 22,
      betingetLaan: 2500000,
      kjoepesum: 3500000,
      gyldigTil: '',
    },

    pension: {
      otpBalance: 210000,
      otpEmployerPct: 5,
      otpEmployeePct: 0,
      otpGrowthRate: 5,
      ipsBalance: 48000,
      ipsAnnualContribution: 15000,
      ipsGrowthRate: 7,
      birthYear: 1990,
      retirementAge: 67,
    },

    jobs: [
      {
        id: 'demo-job-1',
        startDate: monthsAgo(30),
        endDate: null,
        employer: 'Demo Consulting AS',
        role: 'Senior Engineer',
        contractedHoursPerWeek: 37.5,
        onCallAnnual: 24000,
      },
    ],
    salaries: [
      { id: 'demo-sal-1', jobId: 'demo-job-1', effectiveDate: monthsAgo(30), grossAnnual: 690000, changeType: 'initial' },
      { id: 'demo-sal-2', jobId: 'demo-job-1', effectiveDate: monthsAgo(6), grossAnnual: 744000, changeType: 'raise' },
    ],
    bonuses: [
      { id: 'demo-bon-1', date: dayThisMonth(1), amount: 40000, type: 'annual', jobId: 'demo-job-1' },
    ],
    overtime: [],
    hoursSnapshots: [],

    goals: [
      { id: 'demo-goal-1', name: 'Bufferkonto', target: 100000, source: 'bufferAccount' },
      { id: 'demo-goal-2', name: 'Oppussing', target: 150000, source: 'manual', manualCurrent: 40000 },
    ],
  };
}
