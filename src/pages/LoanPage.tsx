import React, { useState, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Calculator,
  ShieldCheck,
  Building2,
  Clock,
  Edit2,
  ChevronDown,
  ChevronUp,
  Key,
  Home,
  ArrowLeftRight,
  ArrowRight,
  TrendingDown,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  useFinance,
  type LoanData,
  type HomeownerData,
  type TransitionData,
  type HousingMode,
} from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import ChartTooltip from '../components/ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';
import BalanceHistoryBar from '../components/BalanceHistoryBar';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import { computeEquityBreakdown, sumSavings } from '../lib/equity';
import {
  calcAmortizationSchedule,
  calcHomeownerMortgageStatus,
  calcNetSaleProceeds,
  calcBridgeLoanCost,
  calcMonthlyPayment,
  calcBorrowingCapacity,
} from '../lib/calculations';
import { parseLocaleNumber } from '../lib/validators';

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
}

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

const LtvChart = lazy(() => import('../components/charts/LtvChart'));

const LoanPage: React.FC = () => {
  const {
    t, loan: liveLoan, updateLoan,
    housingMode: liveHousingMode, setHousingMode,
    homeowner: liveHomeowner, updateHomeowner,
    transition: liveTransition, updateTransition,
    assets: liveAssets,
    grossAnnualIncome, totalDebt,
    formatCurrency,
  } = useFinance();
  const lp = t.loanPage;

  // Time machine: when viewing a past month, render that month's snapshot (read-only).
  const hist = useBalanceHistory();
  const snap = hist.snapshot;
  const loan = snap?.loan ?? liveLoan;
  const homeowner = snap?.homeowner ?? liveHomeowner;
  const transition = snap?.transition ?? liveTransition;
  const assets = snap?.assets ?? liveAssets;
  const housingMode = snap?.housingMode ?? liveHousingMode;
  const equityBreakdown = computeEquityBreakdown(assets);
  const houseEquity = equityBreakdown.houseEquity;

  // ── Låneevne inputs auto-filled from the app's real data, with a per-field
  // manual override (the Employer-cost pattern). Default to the live derived
  // value; an explicit edit overrides it until reset. When viewing a past month
  // (read-only), fall back to that month's stored loan snapshot instead of the
  // live derived figures.
  const liquidEquity = useMemo(
    () => Math.round(assets.bsu + sumSavings(assets) + assets.bufferAccount + equityBreakdown.netInvestment),
    [assets, equityBreakdown.netInvestment],
  );
  const [arslonnOverride, setArslonnOverride] = useState<number | null>(null);
  const [gjeldOverride, setGjeldOverride] = useState<number | null>(null);
  const [egenkapitalOverride, setEgenkapitalOverride] = useState<number | null>(null);
  const effArslonn = arslonnOverride ?? (hist.isLive ? grossAnnualIncome : loan.arslonn);
  const effGjeld = gjeldOverride ?? (hist.isLive ? totalDebt : loan.eksisterendeGjeld);
  const effEgenkapital = egenkapitalOverride ?? (hist.isLive ? liquidEquity : loan.egenkapital);

  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [showAmortization, setShowAmortization] = useState(false);
  const [showHomeownerAmortization, setShowHomeownerAmortization] = useState(false);

  const openModal = (config: ModalConfig) => setModal(config);
  const closeModal = () => setModal(null);

  const editNum = (label: string, key: keyof LoanData, current: number) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: current.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        // Loan amounts, rates and terms are all non-negative; a negative term in
        // particular breaks the amortization math.
        if (!isNaN(n) && n >= 0) updateLoan(key, n);
        closeModal();
      },
    });
  };

  const editText = (label: string, key: keyof LoanData, current: string) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'text', value: current }],
      onSave: (vals) => {
        if (vals.value) updateLoan(key, vals.value);
        closeModal();
      },
    });
  };

  const editHomeowner = (label: string, key: keyof HomeownerData, current: number) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: current.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) updateHomeowner(key, n);
        closeModal();
      },
    });
  };

  const editTransition = (label: string, key: keyof TransitionData, current: number) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: current.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) updateTransition(key, n);
        closeModal();
      },
    });
  };

  // Edit an auto-filled Låneevne input → sets that field's manual override.
  const editOverride = (label: string, current: number, setOverride: (n: number) => void) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: Math.round(current).toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) setOverride(n);
        closeModal();
      },
    });
  };

  // Small "auto / manual" chip — the row's note names the actual source.
  const sourceBadge = (auto: boolean) => (
    <span
      className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
      style={{
        background: auto ? 'var(--accent-bg)' : 'rgba(255,255,255,0.06)',
        color: auto ? 'var(--accent)' : 'var(--text-3)',
      }}
    >
      {auto ? t.loanPage.autoBadge : t.loanPage.manualBadge}
    </span>
  );

  // First-buyer calculations
  const calc = useMemo(() => {
    const monthlyRate = loan.rente / 100 / 12;
    const n = loan.nedbetalingstid * 12;
    // Shared helper (guards term ≤ 0 → 0, avoiding Infinity/NaN); do not inline
    // the annuity formula here — see calculations.ts:calcMonthlyPayment.
    const monthlyPaymentBase = calcMonthlyPayment(loan.laanebelop, loan.rente, loan.nedbetalingstid);
    const monthlyPaymentWithFee = monthlyPaymentBase + loan.termingebyr;
    const totalInterest = monthlyPaymentBase * n - loan.laanebelop;
    const totalCost = loan.laanebelop + totalInterest + loan.etableringsgebyr + loan.termingebyr * n;
    let balance = loan.laanebelop;
    let yearOneInterest = 0;
    for (let i = 0; i < 12; i++) {
      const interest = balance * monthlyRate;
      yearOneInterest += interest;
      balance -= (monthlyPaymentBase - interest);
    }
    const taxDeduction = yearOneInterest * (loan.skattefradragssats / 100);
    // Real Norwegian lending limits: the affordable price is the lower of the
    // 5× income cap and the 15%-equity (85% LTV) cap, plus a +3pp stress test.
    const capacity = calcBorrowingCapacity(
      effArslonn, effEgenkapital, effGjeld, loan.rente, loan.nedbetalingstid,
    );
    const totalpris = loan.betingetLaan + loan.egenkapital;
    return { monthlyPaymentBase, monthlyPaymentWithFee, totalInterest, totalCost, yearOneInterest, taxDeduction, capacity, totalpris };
  }, [loan, effArslonn, effEgenkapital, effGjeld]);

  const amortizationSchedule = useMemo(
    () => calcAmortizationSchedule(loan.laanebelop, loan.rente, loan.nedbetalingstid),
    [loan.laanebelop, loan.rente, loan.nedbetalingstid]
  );
  const chartData = amortizationSchedule.filter((_, i) => i % Math.ceil(amortizationSchedule.length / 15) === 0 || i === amortizationSchedule.length - 1);

  // Homeowner calculations
  const homeownerStatus = useMemo(
    () => calcHomeownerMortgageStatus(
      homeowner.currentMortgageBalance,
      homeowner.originalLoanAmount,
      homeowner.rente,
      homeowner.nedbetalingstid,
      homeowner.skattefradragssats,
    ),
    [homeowner]
  );

  const homeownerAmortization = useMemo(
    () => calcAmortizationSchedule(homeowner.currentMortgageBalance, homeowner.rente, homeowner.nedbetalingstid),
    [homeowner.currentMortgageBalance, homeowner.rente, homeowner.nedbetalingstid]
  );
  const homeownerChartData = homeownerAmortization.filter((_, i) => i % Math.ceil(homeownerAmortization.length / 15) === 0 || i === homeownerAmortization.length - 1);

  // Transitioning calculations
  const saleProceeds = useMemo(
    () => calcNetSaleProceeds(
      transition.currentHouseValue,
      transition.currentMortgageBalance,
      transition.agentFeePercent,
      transition.documentFee,
      transition.otherSaleCosts,
    ),
    [transition]
  );

  const bridgeCost = useMemo(
    () => calcBridgeLoanCost(transition.currentMortgageBalance, transition.bridgeLoanRate, transition.bridgeMonths),
    [transition.currentMortgageBalance, transition.bridgeLoanRate, transition.bridgeMonths]
  );

  const transitionNewLoan = useMemo(() => {
    const equityFromSale = Math.max(0, saleProceeds.netProceeds);
    const totalEquityNew = equityFromSale + loan.egenkapital;
    const newLoanNeeded = Math.max(0, loan.kjoepesum - totalEquityNew);
    const newMonthlyPayment = calcMonthlyPayment(newLoanNeeded, loan.rente, loan.nedbetalingstid) + loan.termingebyr;
    const totalTransactionCosts = saleProceeds.agentCost + transition.documentFee + transition.otherSaleCosts + bridgeCost;
    return { equityFromSale, totalEquityNew, newLoanNeeded, newMonthlyPayment, totalTransactionCosts };
  }, [saleProceeds, bridgeCost, loan, transition.documentFee, transition.otherSaleCosts]);

  const fmtNum = (n: number) => formatCurrency(Math.round(n));
  const fmtPct = (n: number) => `${n.toFixed(2)}%`;

  const modeOptions: { mode: HousingMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'first_buyer', label: t.housingModeFirstBuyer, icon: <Key size={13} strokeWidth={2} /> },
    { mode: 'homeowner', label: t.housingModeHomeowner, icon: <Home size={13} strokeWidth={2} /> },
    { mode: 'transitioning', label: t.housingModeTransitioning, icon: <ArrowLeftRight size={13} strokeWidth={2} /> },
  ];

  const heroSubtitle = housingMode === 'first_buyer'
    ? t.loanPage.firstBuyerSubtitle
    : housingMode === 'homeowner'
      ? t.loanPage.homeownerSubtitle
      : t.loanPage.transitioningSubtitle;

  return (
    <>
    <BalanceHistoryBar hist={hist} />
    <div
      className={`space-y-6 md:space-y-7 pb-8 ${hist.isLive ? '' : 'pointer-events-none select-none'}`}
      style={{ opacity: hist.isLive ? 1 : 0.92 }}
    >

      {/* Hero header */}
      <header data-tour="loan-hero" className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {t.loanPage.mortgage}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.loanPage.heroTitlePre}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.loanPage.heroTitleEm}</em>{t.loanPage.heroTitlePost}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {heroSubtitle}
        </p>
      </header>

      {/* Mode selector — pill segmented control */}
      <div
        className="inline-flex p-1 rounded-[8px] border flex-wrap gap-1"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}
        role="radiogroup"
      >
        {modeOptions.map(({ mode, label, icon }) => {
          const active = housingMode === mode;
          return (
            <button
              key={mode}
              onClick={() => setHousingMode(mode)}
              role="radio"
              aria-checked={active}
              className="flex items-center gap-2 px-4 h-8 rounded-[6px] text-[12px] font-medium transition-colors"
              style={{
                background: active ? 'var(--text-1)' : 'transparent',
                color: active ? 'var(--bg-page)' : 'var(--text-2)',
                fontWeight: active ? 600 : 500,
              }}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      {/* ── FIRST BUYER ── */}
      {housingMode === 'first_buyer' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Låneevne */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Calculator size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{lp.borrowingPower}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.annualSalary} notes={lp.annualSalaryNote}
                  value={fmtNum(effArslonn)}
                  onEdit={() => editOverride(lp.annualSalary, effArslonn, setArslonnOverride)}
                  badge={sourceBadge(arslonnOverride === null)}
                  onReset={arslonnOverride === null ? undefined : () => setArslonnOverride(null)}
                  resetLabel={lp.resetAuto} />
                <LoanRow label={lp.debtLabel} notes={lp.debtNote}
                  value={fmtNum(effGjeld)}
                  onEdit={() => editOverride(lp.debtLabel, effGjeld, setGjeldOverride)}
                  badge={sourceBadge(gjeldOverride === null)}
                  onReset={gjeldOverride === null ? undefined : () => setGjeldOverride(null)}
                  resetLabel={lp.resetAuto} />
                <LoanRow label={lp.loanSum} notes={lp.loanSumNote}
                  value={fmtNum(loan.laanebelop)}
                  onEdit={() => editNum(lp.loanSum, 'laanebelop', loan.laanebelop)} />
                <LoanRow label={lp.equityLabel} notes={lp.equityAutoNote}
                  value={fmtNum(effEgenkapital)}
                  onEdit={() => editOverride(lp.equityLabel, effEgenkapital, setEgenkapitalOverride)}
                  badge={sourceBadge(egenkapitalOverride === null)}
                  onReset={egenkapitalOverride === null ? undefined : () => setEgenkapitalOverride(null)}
                  resetLabel={lp.resetAuto} />
                <LoanRow label={lp.maxPrice} notes={calc.capacity.ltvBound ? lp.maxPriceLtvNote : lp.maxPriceIncomeNote}
                  value={fmtNum(Math.round(calc.capacity.maxPrice))}
                  highlight />
                <LoanRow label={lp.maxLoan} notes={lp.maxLoanNote}
                  value={fmtNum(Math.round(calc.capacity.debtAtMaxPrice))} />
                <LoanRow label={lp.stressTest} notes={`${lp.stressTestNotePrefix}${fmtPct(calc.capacity.stressRatePct)}`}
                  value={`${fmtNum(Math.round(calc.capacity.stressedMonthlyPayment))}/${t.common.moAbbr}`} />
              </div>
            </div>

            {/* Kostnad på lån */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{lp.loanCost}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.loanAmount} notes={lp.loanAmountNote}
                  value={fmtNum(loan.laanebelop)}
                  onEdit={() => editNum(lp.loanAmount, 'laanebelop', loan.laanebelop)} />
                <LoanRow label={lp.nominalRate} notes={lp.nominalRateNote}
                  value={fmtPct(loan.rente)}
                  onEdit={() => editNum(lp.rateEditTitle, 'rente', loan.rente)} />
                <LoanRow label={lp.repaymentTerm} notes={lp.repaymentTermNote}
                  value={`${loan.nedbetalingstid} ${lp.yearsSuffix}`}
                  onEdit={() => editNum(lp.repaymentTermEditTitle, 'nedbetalingstid', loan.nedbetalingstid)} />
                <LoanRow label={lp.paymentsPerYear} notes={lp.paymentsPerYearNote} value="12" />
                <LoanRow label={lp.setupFee} notes={lp.setupFeeNote}
                  value={fmtNum(loan.etableringsgebyr)}
                  onEdit={() => editNum(lp.setupFee, 'etableringsgebyr', loan.etableringsgebyr)} />
                <LoanRow label={lp.termFee} notes={lp.termFeeNote}
                  value={fmtNum(loan.termingebyr)}
                  onEdit={() => editNum(lp.termFee, 'termingebyr', loan.termingebyr)} />
                <LoanRow label={lp.monthlyExFees} notes={lp.monthlyExFeesNote}
                  value={fmtNum(calc.monthlyPaymentBase)} />
                <LoanRow label={lp.monthlyInclFee} notes={lp.monthlyInclFeeNote}
                  value={fmtNum(calc.monthlyPaymentWithFee)} highlight />
                <LoanRow label={lp.totalInterestLabel} notes={lp.totalInterestNote}
                  value={fmtNum(calc.totalInterest)} />
                <LoanRow label={lp.totalCostLabel} notes={lp.totalCostNote}
                  value={fmtNum(calc.totalCost)} highlight />
              </div>
            </div>

            {/* Skattelettelse */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <ShieldCheck size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{lp.taxReliefTitle}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.yearOneInterest} notes={lp.yearOneInterestNote}
                  value={fmtNum(calc.yearOneInterest)} />
                <LoanRow label={lp.deductionRate} notes={lp.deductionRateNote}
                  value={fmtPct(loan.skattefradragssats)}
                  onEdit={() => editNum(lp.deductionRateEditTitle, 'skattefradragssats', loan.skattefradragssats)} />
                <LoanRow label={lp.annualRelief} notes={lp.annualReliefNote}
                  value={fmtNum(calc.taxDeduction)} highlight highlightColor="green" />
              </div>
            </div>

            {/* Finansieringsbevis */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Building2 size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                  <h2 className={sectionLabel}>{lp.financingProof}</h2>
                </div>
                <button
                  onClick={() => editText(lp.validUntil, 'gyldigTil', loan.gyldigTil)}
                  className="flex items-center gap-1 text-[var(--text-2)] hover:text-[var(--positive)] transition-colors shrink-0 ml-2"
                >
                  <Clock size={11} />
                  <span className="text-[10px] font-medium whitespace-nowrap">{lp.validUntil} {loan.gyldigTil}</span>
                  <Edit2 size={11} />
                </button>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.conditionalLoan} notes={lp.conditionalLoanNote}
                  value={fmtNum(loan.betingetLaan)}
                  onEdit={() => editNum(lp.conditionalLoan, 'betingetLaan', loan.betingetLaan)} />
                <LoanRow label={lp.equityLabel} notes={lp.equityProofNote}
                  value={fmtNum(loan.egenkapital)}
                  onEdit={() => editNum(lp.equityLabel, 'egenkapital', loan.egenkapital)} />
                <LoanRow label={lp.maxPurchase} notes={lp.maxPurchaseNote}
                  value={fmtNum(loan.kjoepesum)}
                  onEdit={() => editNum(lp.maxPurchase, 'kjoepesum', loan.kjoepesum)} />
                <LoanRow label={lp.totalPrice} notes={lp.totalPriceNote}
                  value={fmtNum(calc.totalpris)} highlight />
              </div>
            </div>

          </div>

          <AmortizationAccordion
            show={showAmortization}
            onToggle={() => setShowAmortization(v => !v)}
            schedule={amortizationSchedule}
            chartData={chartData}
            t={t}
            formatCurrency={formatCurrency}
          />
        </>
      )}

      {/* ── HOMEOWNER ── */}
      {housingMode === 'homeowner' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Nåværende lån */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Calculator size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{lp.currentLoanTitle}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={t.currentMortgageBalance}
                  value={fmtNum(homeowner.currentMortgageBalance)}
                  onEdit={() => editHomeowner(t.currentMortgageBalance, 'currentMortgageBalance', homeowner.currentMortgageBalance)} />
                <LoanRow label={t.originalLoanAmount}
                  value={fmtNum(homeowner.originalLoanAmount)}
                  onEdit={() => editHomeowner(t.originalLoanAmount, 'originalLoanAmount', homeowner.originalLoanAmount)} />
                <LoanRow label={lp.nominalRate}
                  value={fmtPct(homeowner.rente)}
                  onEdit={() => editHomeowner(lp.rateEditTitle, 'rente', homeowner.rente)} />
                <LoanRow label={t.yearsRemaining}
                  value={`${homeowner.nedbetalingstid} ${lp.yearsSuffix}`}
                  onEdit={() => editHomeowner(t.yearsRemaining, 'nedbetalingstid', homeowner.nedbetalingstid)} />
                <LoanRow label={lp.termFee}
                  value={fmtNum(homeowner.termingebyr)}
                  onEdit={() => editHomeowner(lp.termFee, 'termingebyr', homeowner.termingebyr)} />
                <LoanRow label={t.monthlyPaymentCalc}
                  value={fmtNum(homeownerStatus.monthlyPaymentCalc + homeowner.termingebyr)}
                  highlight />
                <LoanRow label={lp.ofWhichInterest}
                  value={fmtNum(homeownerStatus.monthlyInterest)} />
                <LoanRow label={lp.ofWhichPrincipal}
                  value={fmtNum(homeownerStatus.monthlyPrincipal)} />
              </div>
            </div>

            {/* Boligegenkapital */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Home size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                  <h2 className={sectionLabel}>{lp.homeEquityTitle}</h2>
                </div>
                <Link
                  to="/assets"
                  className="text-[10px] text-[var(--text-2)] hover:text-[var(--positive)] transition-colors whitespace-nowrap"
                >
                  {t.editInAssets}
                </Link>
              </div>
              <div className="space-y-1">
                <LoanRow label={t.houseValue} value={fmtNum(assets.houseValue)} />
                <LoanRow label={t.houseDebt} value={fmtNum(assets.houseDebt)} />
                <LoanRow label={t.propertyEquity} value={fmtNum(houseEquity)} highlight />
              </div>
              {assets.houseValue > 0 && (
                <div className="pt-2">
                  <div className="flex justify-between text-[11px] text-[var(--text-2)] mb-1.5">
                    <span>{t.equityPercent}</span>
                    <span className="font-mono font-medium text-[var(--text-1)]">
                      {((houseEquity / assets.houseValue) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <ProgressBar pct={(houseEquity / assets.houseValue) * 100} color="var(--positive)" />
                </div>
              )}
              {assets.houseValue > 0 && homeowner.originalLoanAmount > 0 && (
                <div className="pt-2">
                  <div className="flex justify-between text-[11px] text-[var(--text-2)] mb-1.5">
                    <span>{lp.repaidOfOriginal}</span>
                    <span className="font-mono font-medium text-[var(--text-1)]">
                      {homeownerStatus.equityPercent.toFixed(1)}%
                    </span>
                  </div>
                  <ProgressBar pct={homeownerStatus.equityPercent} color="var(--positive)" />
                </div>
              )}
            </div>

            {/* Skattelettelse */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <ShieldCheck size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{lp.taxReliefTitle}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.monthlyInterestLabel}
                  value={fmtNum(homeownerStatus.monthlyInterest)} />
                <LoanRow label={lp.deductionRate}
                  value={fmtPct(homeowner.skattefradragssats)}
                  onEdit={() => editHomeowner(lp.deductionRateEditTitle, 'skattefradragssats', homeowner.skattefradragssats)} />
                <LoanRow label={t.annualTaxBenefit}
                  value={fmtNum(homeownerStatus.annualTaxDeduction)}
                  highlight highlightColor="green" />
              </div>
            </div>

            {/* Sammenlign renten din */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <TrendingDown size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{lp.compareRateTitle}</h2>
              </div>
              <p className="text-[13px] text-[var(--text-2)]">
                {lp.compareRateBody}
              </p>
              <div className="space-y-1">
                <LoanRow label={lp.yourRate} value={fmtPct(homeowner.rente)} />
                <LoanRow label={lp.remainingDebt} value={fmtNum(homeowner.currentMortgageBalance)} />
                <LoanRow label={lp.ltv}
                  value={assets.houseValue > 0
                    ? fmtPct((homeowner.currentMortgageBalance / assets.houseValue) * 100)
                    : '–'}
                  highlight />
              </div>
              <a
                href="https://www.forbrukerradet.no/finansportalen/bank/lan/boliglan"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-[6px] bg-[var(--forest)] text-[var(--text)] text-[13px] font-medium hover:bg-[var(--forest-dim)] transition-colors"
              >
                {lp.compareCta}
                <ExternalLink size={14} strokeWidth={2} />
              </a>
            </div>

          </div>

          <AmortizationAccordion
            show={showHomeownerAmortization}
            onToggle={() => setShowHomeownerAmortization(v => !v)}
            schedule={homeownerAmortization}
            chartData={homeownerChartData}
            t={t}
            formatCurrency={formatCurrency}
          />

          {/* Loan-to-value over time */}
          <div className={`${card} p-5 md:p-7`}>
            <div className="pb-4 mb-2 border-b border-[var(--border)]">
              <h3 className={sectionLabel}>{t.charts.ltvTitle}</h3>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.ltvSub}</p>
            </div>
            <div className="h-[240px] w-full">
              <Suspense fallback={<div className="h-full w-full" />}><LtvChart /></Suspense>
            </div>
          </div>
        </>
      )}

      {/* ── TRANSITIONING ── */}
      {housingMode === 'transitioning' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Salg av nåværende bolig */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Building2 size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{t.saleCard}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={t.currentHouseValue}
                  value={fmtNum(transition.currentHouseValue)}
                  onEdit={() => editTransition(t.currentHouseValue, 'currentHouseValue', transition.currentHouseValue)} />
                <LoanRow label={t.currentMortgageBalance}
                  value={fmtNum(transition.currentMortgageBalance)}
                  onEdit={() => editTransition(t.currentMortgageBalance, 'currentMortgageBalance', transition.currentMortgageBalance)} />
                <LoanRow label={t.agentFeePercent}
                  value={fmtPct(transition.agentFeePercent)}
                  onEdit={() => editTransition(t.agentFeePercent, 'agentFeePercent', transition.agentFeePercent)} />
                <LoanRow label={t.documentFee}
                  value={fmtNum(transition.documentFee)}
                  onEdit={() => editTransition(t.documentFee, 'documentFee', transition.documentFee)} />
                <LoanRow label={t.otherSaleCosts}
                  value={fmtNum(transition.otherSaleCosts)}
                  onEdit={() => editTransition(t.otherSaleCosts, 'otherSaleCosts', transition.otherSaleCosts)} />
                <LoanRow label={t.agentCost} value={fmtNum(saleProceeds.agentCost)} />
                <LoanRow
                  label={t.netSaleProceeds}
                  value={fmtNum(saleProceeds.netProceeds)}
                  highlight
                  highlightColor={saleProceeds.netProceeds < 0 ? 'red' : 'blue'}
                />
              </div>
            </div>

            {/* Mellomfinansieringsperiode */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Clock size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{t.bridgeCard}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={t.bridgeMonths}
                  value={`${transition.bridgeMonths} ${t.common.moAbbr}`}
                  onEdit={() => editTransition(t.bridgeMonths, 'bridgeMonths', transition.bridgeMonths)} />
                <LoanRow label={t.bridgeLoanRate}
                  value={fmtPct(transition.bridgeLoanRate)}
                  onEdit={() => editTransition(t.bridgeLoanRate, 'bridgeLoanRate', transition.bridgeLoanRate)} />
                <LoanRow label={t.bridgeCost}
                  value={fmtNum(bridgeCost)}
                  highlight />
              </div>
            </div>

            {/* Ny bolig – lånekalkulator */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Calculator size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>{t.newHouseCard}</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.purchasePrice}
                  value={fmtNum(loan.kjoepesum)}
                  onEdit={() => editNum(lp.purchasePrice, 'kjoepesum', loan.kjoepesum)} />
                <LoanRow label={lp.nominalRate}
                  value={fmtPct(loan.rente)}
                  onEdit={() => editNum(lp.rateEditTitle, 'rente', loan.rente)} />
                <LoanRow label={lp.repaymentTerm}
                  value={`${loan.nedbetalingstid} ${lp.yearsSuffix}`}
                  onEdit={() => editNum(lp.repaymentTermEditTitle, 'nedbetalingstid', loan.nedbetalingstid)} />
                <LoanRow label={t.additionalEquity}
                  notes={lp.extraEquityNote}
                  value={fmtNum(loan.egenkapital)}
                  onEdit={() => editNum(lp.extraEquityEditTitle, 'egenkapital', loan.egenkapital)} />
                <LoanRow label={t.equityFromSale}
                  value={fmtNum(transitionNewLoan.equityFromSale)} />
                <LoanRow label={t.totalEquityNew}
                  value={fmtNum(transitionNewLoan.totalEquityNew)} />
                <LoanRow label={t.newLoanNeeded}
                  value={fmtNum(transitionNewLoan.newLoanNeeded)}
                  highlight />
                <LoanRow label={t.newMonthlyPayment}
                  value={fmtNum(transitionNewLoan.newMonthlyPayment)}
                  highlight />
              </div>
            </div>

          </div>

          {/* Summary hero card */}
          <div className={`${card} p-5 md:p-7`}>
            <div className="flex items-center gap-2 pb-4 mb-5 border-b border-[var(--border)]">
              <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
              <h2 className={sectionLabel}>{t.summaryCard}</h2>
            </div>

            {/* Flow diagram */}
            <div className="flex items-center gap-2 flex-wrap mb-6">
              <FlowStep label={lp.flowSell} value={fmtNum(transition.currentHouseValue)} color="blue" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label={lp.flowPayLoan} value={fmtNum(transition.currentMortgageBalance)} color="red" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep
                label={lp.flowNetProceeds}
                value={fmtNum(saleProceeds.netProceeds)}
                color={saleProceeds.netProceeds < 0 ? 'red' : 'green'}
              />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label={lp.flowBuy} value={fmtNum(loan.kjoepesum)} color="blue" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label={lp.flowNeedLoan} value={fmtNum(transitionNewLoan.newLoanNeeded)} color="red" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryTile label={t.agentCost} value={fmtNum(saleProceeds.agentCost)} />
              <SummaryTile label={t.bridgeCost} value={fmtNum(bridgeCost)} />
              <SummaryTile label={t.otherSaleCosts} value={fmtNum(transition.documentFee + transition.otherSaleCosts)} />
              <SummaryTile label={t.totalTransactionCosts} value={fmtNum(transitionNewLoan.totalTransactionCosts)} accent />
            </div>
          </div>
        </>
      )}

      {modal && <EditModal {...modal} onCancel={closeModal} />}
    </div>
    </>
  );
};

// ── Amortization accordion (shared between first_buyer and homeowner) ──

interface AmortizationAccordionProps {
  show: boolean;
  onToggle: () => void;
  schedule: ReturnType<typeof calcAmortizationSchedule>;
  chartData: ReturnType<typeof calcAmortizationSchedule>;
  t: ReturnType<typeof import('../context/FinanceContext').useFinance>['t'];
  formatCurrency: (n: number) => string;
}

function AmortizationAccordion({ show, onToggle, schedule, chartData, t, formatCurrency }: AmortizationAccordionProps) {
  return (
    <div className={`${card} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 md:px-7 md:py-5 flex items-center justify-between hover:bg-[var(--bg-raised)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <span className={sectionLabel}>{t.amortizationSchedule}</span>
        </div>
        {show
          ? <ChevronUp size={16} className="text-[var(--text-2)]" />
          : <ChevronDown size={16} className="text-[var(--text-2)]" />}
      </button>

      {show && (
        <div className="border-t border-[var(--border)]">
          <div className="px-5 py-5 md:px-7">
            <div className="h-[200px] md:h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} vertical={false} />
                  <XAxis
                    dataKey="year"
                    {...AXIS_PROPS}
                    tickFormatter={(v) => `${t.loanPage.yearAxisPrefix} ${v}`}
                  />
                  <YAxis
                    tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1_000)}k`}
                    {...AXIS_PROPS_Y}
                    width={48}
                  />
                  <Tooltip
                    content={<ChartTooltip labelFormatter={(v) => `${t.year} ${v}`} />}
                  />
                  <Legend
                    iconType="square"
                    iconSize={8}
                    formatter={(value) => {
                      const labels: Record<string, string> = {
                        principalPaid: t.principalPayment,
                        interestPaid: t.interestPayment,
                      };
                      return <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{labels[value] ?? value}</span>;
                    }}
                  />
                  <Bar dataKey="principalPaid" name={t.principalPayment} stackId="a" fill={CHART.forestLight} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="interestPaid" name={t.interestPayment} stackId="a" fill={CHART.rust} fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[var(--bg-raised)]">
                <tr className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)]">
                  <th className="px-5 md:px-7 py-3">{t.year}</th>
                  <th className="px-5 md:px-7 py-3 text-right">{t.annualPayment}</th>
                  <th className="px-5 md:px-7 py-3 text-right">{t.principalPayment}</th>
                  <th className="px-5 md:px-7 py-3 text-right">{t.interestPayment}</th>
                  <th className="px-5 md:px-7 py-3 text-right">{t.remainingBalance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {schedule.map((row) => (
                  <tr key={row.year} className="hover:bg-[var(--bg-raised)] transition-colors">
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono font-medium text-[var(--text-1)]">{row.year}</td>
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono text-right text-[var(--text-2)]">{formatCurrency(Math.round(row.annualPayment))}</td>
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono text-right text-[var(--positive)]">{formatCurrency(Math.round(row.principalPaid))}</td>
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono text-right text-[var(--negative)]">{formatCurrency(Math.round(row.interestPaid))}</td>
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono text-right font-semibold text-[var(--text-1)]">{formatCurrency(Math.round(row.balance))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small UI components ──

interface LoanRowProps {
  label: string;
  value: string;
  notes?: string;
  onEdit?: () => void;
  highlight?: boolean;
  highlightColor?: 'blue' | 'green' | 'red';
  /** Small chip after the label (e.g. Auto / Overstyrt). */
  badge?: React.ReactNode;
  /** When set, shows a reset-to-auto control that clears a manual override. */
  onReset?: () => void;
  /** Accessible label for the reset-to-auto control. */
  resetLabel?: string;
}

function LoanRow({ label, value, notes, onEdit, highlight, highlightColor = 'blue', badge, onReset, resetLabel }: LoanRowProps) {
  const isCalculated = !onEdit;
  const valueColor = highlight
    ? highlightColor === 'green'
      ? 'text-[var(--positive)]'
      : highlightColor === 'red'
        ? 'text-[var(--negative)]'
        : 'text-[var(--positive)]'
    : isCalculated
      ? 'text-[var(--text-2)]'
      : 'text-[var(--text-1)]';

  const labelColor = highlight ? valueColor : isCalculated ? 'text-[var(--text-2)]' : 'text-[var(--text-1)]';

  return (
    <div
      className={`flex items-center justify-between group py-3.5 border-b border-[var(--border)] last:border-0 ${onEdit ? 'cursor-pointer' : ''}`}
      onClick={onEdit}
    >
      <div className="flex-1 min-w-0 mr-4">
        <div className={`text-[13px] font-medium ${labelColor} flex items-center gap-2`}>
          <span className="truncate">{label}</span>
          {badge}
        </div>
        {notes && <div className="text-[11px] text-[var(--text-2)]/70 hidden lg:block mt-0.5">{notes}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onReset && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            className="text-[var(--text-2)] hover:text-[var(--accent)] transition-colors shrink-0"
            aria-label={resetLabel}
          >
            <RotateCcw size={12} />
          </button>
        )}
        <span className={`text-[13px] font-mono font-medium whitespace-nowrap ${valueColor} ${onEdit ? 'group-hover:opacity-70 transition-opacity' : ''}`}>
          {value}
        </span>
        {onEdit
          ? <Edit2 size={13} className="text-[var(--text-2)] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" />
          : <span className="w-[13px] shrink-0" />}
      </div>
    </div>
  );
}

interface FlowStepProps {
  label: string;
  value: string;
  color: 'blue' | 'green' | 'red';
}

function FlowStep({ label, value, color }: FlowStepProps) {
  const colors = {
    blue: 'bg-[var(--bg-3)] border-[var(--rule)] text-[var(--forest-light)]',
    green: 'bg-[var(--positive-bg)] border-[color-mix(in_srgb,var(--positive)_35%,transparent)] text-[var(--positive)]',
    red: 'bg-[var(--negative-bg)] border-[color-mix(in_srgb,var(--negative)_35%,transparent)] text-[var(--negative)]',
  };
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-[8px] border ${colors[color]} min-w-[100px]`}>
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] opacity-70 mb-0.5">{label}</span>
      <span className="text-[13px] font-mono font-semibold">{value}</span>
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: string;
  accent?: boolean;
}

function SummaryTile({ label, value, accent }: SummaryTileProps) {
  return (
    <div className={`rounded-[8px] p-3 border ${accent ? 'bg-[var(--bg-3)] border-[var(--brass-dim)]' : 'bg-[var(--bg-raised)] border-[var(--border)]'}`}>
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)] mb-1">{label}</div>
      <div className={`text-[14px] font-mono font-semibold ${accent ? 'text-[var(--positive)]' : 'text-[var(--text-1)]'}`}>{value}</div>
    </div>
  );
}

export default LoanPage;
