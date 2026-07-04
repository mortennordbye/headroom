import React, { useState, useMemo } from 'react';
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
import BalanceHistoryBar from '../components/BalanceHistoryBar';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import { computeEquityBreakdown } from '../lib/equity';
import {
  calcAmortizationSchedule,
  calcHomeownerMortgageStatus,
  calcNetSaleProceeds,
  calcBridgeLoanCost,
  calcMonthlyPayment,
} from '../lib/calculations';
import { parseLocaleNumber } from '../lib/validators';

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
}

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

const LoanPage: React.FC = () => {
  const {
    t, lang, loan: liveLoan, updateLoan,
    housingMode: liveHousingMode, setHousingMode,
    homeowner: liveHomeowner, updateHomeowner,
    transition: liveTransition, updateTransition,
    assets: liveAssets,
    formatCurrency,
  } = useFinance();

  // Time machine: when viewing a past month, render that month's snapshot (read-only).
  const hist = useBalanceHistory();
  const snap = hist.snapshot;
  const loan = snap?.loan ?? liveLoan;
  const homeowner = snap?.homeowner ?? liveHomeowner;
  const transition = snap?.transition ?? liveTransition;
  const assets = snap?.assets ?? liveAssets;
  const housingMode = snap?.housingMode ?? liveHousingMode;
  const houseEquity = computeEquityBreakdown(assets).houseEquity;

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
    const totalLaaneevne = 5 * loan.arslonn + loan.egenkapital - loan.eksisterendeGjeld;
    const totalpris = loan.betingetLaan + loan.egenkapital;
    return { monthlyPaymentBase, monthlyPaymentWithFee, totalInterest, totalCost, yearOneInterest, taxDeduction, totalLaaneevne, totalpris };
  }, [loan]);

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
    ? (lang === 'nb' ? 'Planlegg ditt første boligkjøp. Beregn låneevne, månedlig kostnad og total tilbakebetaling.' : 'Plan your first home purchase. Calculate borrowing capacity, monthly cost, and total payback.')
    : housingMode === 'homeowner'
      ? (lang === 'nb' ? 'Følg med på nåværende boliglån, renter, egenkapital og nedbetaling.' : "Track your current mortgage, rates, equity, and payoff schedule.")
      : (lang === 'nb' ? 'Modellér overgang fra dagens bolig til en ny — netto salgsprovenu, mellomfinansiering og nytt lån.' : 'Model the move from your current home to a new one — net sale proceeds, bridge loan, and new mortgage.');

  return (
    <>
    <BalanceHistoryBar hist={hist} />
    <div
      className={`space-y-6 md:space-y-7 pb-8 ${hist.isLive ? '' : 'pointer-events-none select-none'}`}
      style={{ opacity: hist.isLive ? 1 : 0.92 }}
    >

      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {lang === 'nb' ? 'Boliglån' : 'Mortgage'}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {lang === 'nb' ? (
            <>Et hjem, et <em className="font-serif italic" style={{ color: 'var(--brass)' }}>lån</em>.</>
          ) : (
            <>A home, a <em className="font-serif italic" style={{ color: 'var(--brass)' }}>loan</em>.</>
          )}
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
                <h2 className={sectionLabel}>Låneevne</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label="Årslønn" notes="Bruttoinntekt per år før skatt"
                  value={fmtNum(loan.arslonn)}
                  onEdit={() => editNum('Årslønn', 'arslonn', loan.arslonn)} />
                <LoanRow label="Gjeld" notes="Total eksisterende gjeld"
                  value={fmtNum(loan.eksisterendeGjeld)}
                  onEdit={() => editNum('Gjeld', 'eksisterendeGjeld', loan.eksisterendeGjeld)} />
                <LoanRow label="Lånesum" notes="Beløpet du planlegger å låne"
                  value={fmtNum(loan.laanebelop)}
                  onEdit={() => editNum('Lånesum', 'laanebelop', loan.laanebelop)} />
                <LoanRow label="Egenkapital" notes="Oppspart kapital (BSU, fond, kontoer)"
                  value={fmtNum(loan.egenkapital)}
                  onEdit={() => editNum('Egenkapital', 'egenkapital', loan.egenkapital)} />
                <LoanRow label="Total låneevne" notes="5x inntekt + EK – gjeld"
                  value={fmtNum(calc.totalLaaneevne)}
                  highlight />
              </div>
            </div>

            {/* Kostnad på lån */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>Kostnad på lån</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label="Lånebeløp" notes="Beløpet du søker om å låne"
                  value={fmtNum(loan.laanebelop)}
                  onEdit={() => editNum('Lånebeløp', 'laanebelop', loan.laanebelop)} />
                <LoanRow label="Rente (nominell p.a.)" notes="Årlig nominell rente"
                  value={fmtPct(loan.rente)}
                  onEdit={() => editNum('Rente (%)', 'rente', loan.rente)} />
                <LoanRow label="Nedbetalingstid" notes="Antall år"
                  value={`${loan.nedbetalingstid} år`}
                  onEdit={() => editNum('Nedbetalingstid (år)', 'nedbetalingstid', loan.nedbetalingstid)} />
                <LoanRow label="Terminbetalinger/år" notes="Vanligvis 12" value="12" />
                <LoanRow label="Etableringsgebyr" notes="Engangsgebyr"
                  value={fmtNum(loan.etableringsgebyr)}
                  onEdit={() => editNum('Etableringsgebyr', 'etableringsgebyr', loan.etableringsgebyr)} />
                <LoanRow label="Termingebyr" notes="Fast gebyr per termin"
                  value={fmtNum(loan.termingebyr)}
                  onEdit={() => editNum('Termingebyr', 'termingebyr', loan.termingebyr)} />
                <LoanRow label="Månedlig betaling (uten gebyrer)" notes="Kun rente og avdrag"
                  value={fmtNum(calc.monthlyPaymentBase)} />
                <LoanRow label="Månedlig betaling (inkl. gebyr)" notes="Inkludert termingebyr"
                  value={fmtNum(calc.monthlyPaymentWithFee)} highlight />
                <LoanRow label="Totale rentekostnader" notes="Total rente gjennom løpetiden"
                  value={fmtNum(calc.totalInterest)} />
                <LoanRow label="Totalkostnad" notes="Lån + rente + gebyrer"
                  value={fmtNum(calc.totalCost)} highlight />
              </div>
            </div>

            {/* Skattelettelse */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <ShieldCheck size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>Skattelettelse på boliglån</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label="Betalte renter i året (år 1)" notes="Beregnet fra lånekostnadstabell"
                  value={fmtNum(calc.yearOneInterest)} />
                <LoanRow label="Skattefradragsprosent" notes="Standard fradragssats"
                  value={fmtPct(loan.skattefradragssats)}
                  onEdit={() => editNum('Skattefradragsprosent (%)', 'skattefradragssats', loan.skattefradragssats)} />
                <LoanRow label="Skattelettelse per år" notes="Årlig skattefradrag på rentene"
                  value={fmtNum(calc.taxDeduction)} highlight highlightColor="green" />
              </div>
            </div>

            {/* Finansieringsbevis */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Building2 size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                  <h2 className={sectionLabel}>Finansieringsbevis – Handelsbanken</h2>
                </div>
                <button
                  onClick={() => editText('Gyldig til', 'gyldigTil', loan.gyldigTil)}
                  className="flex items-center gap-1 text-[var(--text-2)] hover:text-[#7FCBA0] transition-colors shrink-0 ml-2"
                >
                  <Clock size={11} />
                  <span className="text-[10px] font-medium whitespace-nowrap">Gyldig til {loan.gyldigTil}</span>
                  <Edit2 size={11} />
                </button>
              </div>
              <div className="space-y-1">
                <LoanRow label="Lån (betinget)" notes="Endelige vilkår fastsettes ved pant"
                  value={fmtNum(loan.betingetLaan)}
                  onEdit={() => editNum('Lån (betinget)', 'betingetLaan', loan.betingetLaan)} />
                <LoanRow label="Egenkapital" notes="Må stilles av deg ved overtakelse"
                  value={fmtNum(loan.egenkapital)}
                  onEdit={() => editNum('Egenkapital', 'egenkapital', loan.egenkapital)} />
                <LoanRow label="Kjøpesum (maks)" notes="Øvre grense for bud/kontrakt"
                  value={fmtNum(loan.kjoepesum)}
                  onEdit={() => editNum('Kjøpesum (maks)', 'kjoepesum', loan.kjoepesum)} />
                <LoanRow label="Totalpris" notes="Betinget lån + egenkapital"
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
            lang={lang}
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
                <h2 className={sectionLabel}>Nåværende lån</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label={t.currentMortgageBalance}
                  value={fmtNum(homeowner.currentMortgageBalance)}
                  onEdit={() => editHomeowner(t.currentMortgageBalance, 'currentMortgageBalance', homeowner.currentMortgageBalance)} />
                <LoanRow label={t.originalLoanAmount}
                  value={fmtNum(homeowner.originalLoanAmount)}
                  onEdit={() => editHomeowner(t.originalLoanAmount, 'originalLoanAmount', homeowner.originalLoanAmount)} />
                <LoanRow label="Rente (nominell p.a.)"
                  value={fmtPct(homeowner.rente)}
                  onEdit={() => editHomeowner('Rente (%)', 'rente', homeowner.rente)} />
                <LoanRow label={t.yearsRemaining}
                  value={`${homeowner.nedbetalingstid} år`}
                  onEdit={() => editHomeowner(t.yearsRemaining, 'nedbetalingstid', homeowner.nedbetalingstid)} />
                <LoanRow label="Termingebyr"
                  value={fmtNum(homeowner.termingebyr)}
                  onEdit={() => editHomeowner('Termingebyr', 'termingebyr', homeowner.termingebyr)} />
                <LoanRow label={t.monthlyPaymentCalc}
                  value={fmtNum(homeownerStatus.monthlyPaymentCalc + homeowner.termingebyr)}
                  highlight />
                <LoanRow label="Herav renter / måned"
                  value={fmtNum(homeownerStatus.monthlyInterest)} />
                <LoanRow label="Herav avdrag / måned"
                  value={fmtNum(homeownerStatus.monthlyPrincipal)} />
              </div>
            </div>

            {/* Boligegenkapital */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Home size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                  <h2 className={sectionLabel}>Boligegenkapital</h2>
                </div>
                <Link
                  to="/assets"
                  className="text-[10px] text-[var(--text-2)] hover:text-[#7FCBA0] transition-colors whitespace-nowrap"
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
                  <div className="h-2 rounded-full bg-[var(--bg-elev)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#7FCBA0] transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, (houseEquity / assets.houseValue) * 100))}%` }}
                    />
                  </div>
                </div>
              )}
              {assets.houseValue > 0 && homeowner.originalLoanAmount > 0 && (
                <div className="pt-2">
                  <div className="flex justify-between text-[11px] text-[var(--text-2)] mb-1.5">
                    <span>Nedbetalt av opprinnelig lån</span>
                    <span className="font-mono font-medium text-[var(--text-1)]">
                      {homeownerStatus.equityPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--bg-elev)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--positive)] transition-all"
                      style={{ width: `${Math.min(100, homeownerStatus.equityPercent)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Skattelettelse */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <ShieldCheck size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>Skattelettelse på boliglån</h2>
              </div>
              <div className="space-y-1">
                <LoanRow label="Månedsrenter"
                  value={fmtNum(homeownerStatus.monthlyInterest)} />
                <LoanRow label="Skattefradragsprosent"
                  value={fmtPct(homeowner.skattefradragssats)}
                  onEdit={() => editHomeowner('Skattefradragsprosent (%)', 'skattefradragssats', homeowner.skattefradragssats)} />
                <LoanRow label={t.annualTaxBenefit}
                  value={fmtNum(homeownerStatus.annualTaxDeduction)}
                  highlight highlightColor="green" />
              </div>
            </div>

            {/* Sammenlign renten din */}
            <div className={`${card} p-5 md:p-7 space-y-5`}>
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <TrendingDown size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h2 className={sectionLabel}>Sammenlign renten din</h2>
              </div>
              <p className="text-[13px] text-[var(--text-2)]">
                En lavere rente i markedet er forhandlingskort mot banken din – be om bedre
                rente, eller vurder å refinansiere. Bruk tallene under på Finansportalen.
              </p>
              <div className="space-y-1">
                <LoanRow label="Din rente (nominell p.a.)" value={fmtPct(homeowner.rente)} />
                <LoanRow label="Restgjeld" value={fmtNum(homeowner.currentMortgageBalance)} />
                <LoanRow label="Belåningsgrad"
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
                Sammenlign på Finansportalen
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
            lang={lang}
            formatCurrency={formatCurrency}
          />
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
                  value={`${transition.bridgeMonths} mnd`}
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
                <LoanRow label="Kjøpesum"
                  value={fmtNum(loan.kjoepesum)}
                  onEdit={() => editNum('Kjøpesum', 'kjoepesum', loan.kjoepesum)} />
                <LoanRow label="Rente (nominell p.a.)"
                  value={fmtPct(loan.rente)}
                  onEdit={() => editNum('Rente (%)', 'rente', loan.rente)} />
                <LoanRow label="Nedbetalingstid"
                  value={`${loan.nedbetalingstid} år`}
                  onEdit={() => editNum('Nedbetalingstid (år)', 'nedbetalingstid', loan.nedbetalingstid)} />
                <LoanRow label={t.additionalEquity}
                  notes="Ekstra egenkapital utover salgsproveny"
                  value={fmtNum(loan.egenkapital)}
                  onEdit={() => editNum('Ekstra egenkapital', 'egenkapital', loan.egenkapital)} />
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
              <FlowStep label="Selger" value={fmtNum(transition.currentHouseValue)} color="blue" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label="Betaler lån" value={fmtNum(transition.currentMortgageBalance)} color="red" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep
                label="Netto proveny"
                value={fmtNum(saleProceeds.netProceeds)}
                color={saleProceeds.netProceeds < 0 ? 'red' : 'green'}
              />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label="Kjøper" value={fmtNum(loan.kjoepesum)} color="blue" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label="Trenger lån" value={fmtNum(transitionNewLoan.newLoanNeeded)} color="red" />
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
  lang: string;
  formatCurrency: (n: number) => string;
}

function AmortizationAccordion({ show, onToggle, schedule, chartData, t, lang, formatCurrency }: AmortizationAccordionProps) {
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={'#262A20'} />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fill: '#5F6555' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${lang === 'nb' ? 'År' : 'Yr'} ${v}`}
                  />
                  <YAxis
                    tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1_000)}k`}
                    tick={{ fontSize: 11, fill: '#5F6555' }}
                    axisLine={false}
                    tickLine={false}
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
                      return <span style={{ fontSize: '11px', color: '#5F6555' }}>{labels[value] ?? value}</span>;
                    }}
                  />
                  <Bar dataKey="principalPaid" name={t.principalPayment} stackId="a" fill="#7FCBA0" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="interestPaid" name={t.interestPayment} stackId="a" fill="#B5533A80" radius={[3, 3, 0, 0]} />
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
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono text-right text-[#7FCBA0]">{formatCurrency(Math.round(row.principalPaid))}</td>
                    <td className="px-5 md:px-7 py-3 text-[12px] font-mono text-right text-[#B5533A]">{formatCurrency(Math.round(row.interestPaid))}</td>
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
}

function LoanRow({ label, value, notes, onEdit, highlight, highlightColor = 'blue' }: LoanRowProps) {
  const isCalculated = !onEdit;
  const valueColor = highlight
    ? highlightColor === 'green'
      ? 'text-[var(--positive)]'
      : highlightColor === 'red'
        ? 'text-[#B5533A]'
        : 'text-[#7FCBA0]'
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
        <div className={`text-[13px] font-medium ${labelColor}`}>{label}</div>
        {notes && <div className="text-[11px] text-[var(--text-2)]/70 hidden lg:block mt-0.5">{notes}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
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
      <div className={`text-[14px] font-mono font-semibold ${accent ? 'text-[#7FCBA0]' : 'text-[var(--text-1)]'}`}>{value}</div>
    </div>
  );
}

export default LoanPage;
