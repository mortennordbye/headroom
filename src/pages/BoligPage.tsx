import React, { useState, useMemo, lazy, Suspense } from 'react';
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
  LineChart,
  Home,
  ArrowLeftRight,
  ArrowRight,
  TrendingDown,
  ExternalLink,
  RotateCcw,
  Trash2,
  Plus,
  Users,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { ResponsiveContainer } from '../components/charts/ResponsiveContainer';
import {
  useFinance,
  type LoanData,
  type HomeownerData,
  type TransitionData,
  type HousingMode,
  type CoOwner,
} from '../context/FinanceContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import EditModal, { type ModalField } from '../components/EditModal';
import ChartTooltip from '../components/ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ChartSkeleton } from '../components/ui/Skeleton';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import { computeEquityBreakdown, sumSavings } from '../lib/equity';
import {
  calcAmortizationSchedule,
  calcHomeownerMortgageStatus,
  calcTransitionNewLoan,
  calcMonthlyPayment,
  calcBorrowingCapacity,
} from '../lib/calculations';
import { parseLocaleNumber } from '../lib/validators';
import type { CapacityOverrides } from '../lib/capacityOverrides';
import { RENTEFRADRAG_RATE_PCT } from '../lib/norwegianTax';
import { extraPaymentSavings, formatMonths } from '../lib/debt';
import { loanTimeline, currentResidence, residenceMetrics } from '../lib/property';
import { activeCoOwners, ownershipShares, myHouseValue, myHouseDebt, validateCoOwners } from '../lib/ownership';
import { makeId } from '../lib/savingsMigration';
import { currentMonthKey } from '../lib/date';
import { currentMortgage } from '../lib/existingMortgage';
import { withNotifiedRate } from '../lib/notifiedRate';
import {
  effectiveRemainingMonths, paymentTermMonths, splitTermMonths, yearsFromParts, formatTerm, isValidTermParts,
} from '../lib/loanTerm';
import { PropertyCard, ResidenceTimeline } from '../components/ResidenceHistory';
import { PropertyValueEstimate } from '../components/PropertyValueEstimate';
import { StatCard } from '../components/ui/StatCard';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import SecondHomePanel from './bolig/SecondHomePanel';
import MarketPanel from './bolig/MarketPanel';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
  error?: string;
  saveLabel?: string;
}

const LtvChart = lazy(() => import('../components/charts/LtvChart'));
const PaydownVsPlanChart = lazy(() => import('../components/charts/PaydownVsPlanChart'));

const BoligPage: React.FC = () => {
  const {
    t, lang, loan: liveLoan, updateLoan,
    housingMode: liveHousingMode, setHousingMode,
    homeowner: liveHomeowner, updateHomeowner,
    transition: liveTransition, updateTransition,
    assets: liveAssets, setCoOwners, updateAsset,
    residences,
    grossAnnualIncome, capacityDebt,
    formatCurrency,
    policyRate, policyRateAsOf, policyRateStale, refreshPolicyRate,
    capacityOverrides, setCapacityOverride,
  } = useFinance();
  // Hub tab: the mortgage tools ('boliglaan'), the second-home planner
  // ('sekundaerbolig') and the opt-in market data ('marked'). View state only — not persisted.
  const [hubTab, setHubTab] = useState<'boliglaan' | 'sekundaerbolig' | 'marked'>('boliglaan');
  const [refreshingPolicyRate, setRefreshingPolicyRate] = useState(false);
  const handleRefreshPolicyRate = async () => {
    setRefreshingPolicyRate(true);
    try { await refreshPolicyRate(); } finally { setRefreshingPolicyRate(false); }
  };
  const lp = t.loanPage;

  // Time machine: when viewing a past month, render that month's snapshot (read-only).
  const hist = useBalanceHistory();
  const snap = hist.snapshot;
  const loan = snap?.loan ?? liveLoan;
  // A snapshot keeps the slice as entered: read its rate as of that month.
  const homeowner = snap?.homeowner ? withNotifiedRate(snap.homeowner, hist.activeKey) : liveHomeowner;
  const transition = snap?.transition ?? liveTransition;
  const assets = snap?.assets ?? liveAssets;
  const housingMode = snap?.housingMode ?? liveHousingMode;
  // The whole loan on the current home (assets.houseDebt; a past month's
  // snapshot may still hold it in its older homeowner/transition copies).
  const mortgageBalance = currentMortgage(housingMode, assets, homeowner, transition, hist.activeKey).fullBalance;
  const equityBreakdown = useMemo(() => computeEquityBreakdown(assets), [assets]);
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
  const { arslonn: arslonnOverride, gjeld: gjeldOverride, egenkapital: egenkapitalOverride } = capacityOverrides;
  const effArslonn = arslonnOverride ?? (hist.isLive ? grossAnnualIncome : loan.arslonn);
  // Borrowing capacity counts existing debt at the lending-rule figure (full credit
  // frame), so `capacityDebt` — not the drawn `totalDebt` — auto-fills the live value.
  const effGjeld = gjeldOverride ?? (hist.isLive ? capacityDebt : loan.eksisterendeGjeld);
  const effEgenkapital = egenkapitalOverride ?? (hist.isLive ? liquidEquity : loan.egenkapital);

  // Value, loan, payment and LTV are the property's (the bank's view); the user's
  // share is shown beside them when there are co-owners.
  const coOwners = assets.coOwners ?? [];
  const shares = useMemo(() => ownershipShares(assets), [assets]);
  const hasCoOwners = shares.own < 1 || shares.debt < 1;

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

  // Two-field editor (years + months), pre-filled with the remaining term as of
  // today so saving unchanged keeps the same payoff month.
  const editHomeownerTerm = () => {
    const current = splitTermMonths(remainingMonths);
    openModal({
      title: t.yearsRemaining,
      fields: [
        { key: 'years', label: lp.termYearsField, type: 'number', value: String(current.years) },
        { key: 'months', label: lp.termMonthsField, type: 'number', value: String(current.months) },
      ],
      onSave: (vals) => {
        const years = parseLocaleNumber(vals.years || '0');
        const months = parseLocaleNumber(vals.months || '0');
        if (!isValidTermParts(years, months)) {
          setModal(prev => (prev ? { ...prev, error: lp.termInvalid } : prev));
          return;
        }
        updateHomeowner('nedbetalingstid', yearsFromParts(years, months));
        closeModal();
      },
    });
  };

  const editHomeownerText = (label: string, key: keyof HomeownerData, current: string, placeholder?: string) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'text', value: current, placeholder }],
      onSave: (vals) => {
        updateHomeowner(key, vals.value.trim());
        closeModal();
      },
    });
  };

  const editHomeownerMonth = (label: string, key: keyof HomeownerData, current: string) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'monthpicker', pickerMode: 'month', value: current, placeholder: '2022-07' }],
      onSave: (vals) => {
        updateHomeowner(key, vals.value);
        closeModal();
      },
    });
  };

  // ── Co-owners: edited as a whole list so the shares validate together. ──
  const om = t.ownership;
  const saveCoOwners = (next: CoOwner[]): boolean => {
    const v = validateCoOwners(next);
    if (!v.ok) {
      setModal(prev => (prev ? { ...prev, error: om.errors[v.error] } : prev));
      return false;
    }
    setCoOwners(next);
    return true;
  };

  const editCoOwner = (c?: CoOwner) => {
    // New co-owners default to owning since the move-in of the current home.
    const defaultSince = currentResidence(residences)?.moveInDate?.slice(0, 7) || currentMonthKey();
    const pctValue = c?.ownershipPct ?? 50;
    openModal({
      title: c ? c.name : om.add,
      fields: [
        { key: 'name', label: om.name, type: 'text', value: c?.name ?? om.defaultName.replace('{n}', String(coOwners.length + 1)) },
        { key: 'ownershipPct', label: om.ownershipPct, type: 'number', value: String(pctValue) },
        { key: 'debtFollows', label: om.debtFollows, type: 'checkbox', value: c?.debtSharePct === undefined ? 'true' : 'false' },
        {
          key: 'debtSharePct', label: om.debtSharePct, type: 'number',
          value: String(c?.debtSharePct ?? pctValue),
          showWhen: (v) => v.debtFollows !== 'true',
        },
        { key: 'since', label: om.since, type: 'monthpicker', pickerMode: 'month', value: c?.since ?? defaultSince },
        // Only once they have a last month: lets a wrong "sold" be corrected or cleared.
        ...(c?.until ? [{ key: 'until', label: om.lastMonth, type: 'monthpicker' as const, pickerMode: 'month' as const, value: c.until, hint: om.lastMonthHint }] : []),
      ],
      onSave: (vals) => {
        const ownershipPct = parseLocaleNumber(vals.ownershipPct);
        const debtSharePct = vals.debtFollows === 'true' ? undefined : parseLocaleNumber(vals.debtSharePct);
        if (isNaN(ownershipPct) || (debtSharePct !== undefined && isNaN(debtSharePct))) {
          setModal(prev => (prev ? { ...prev, error: om.errors.range } : prev));
          return;
        }
        const row: CoOwner = {
          id: c?.id ?? makeId('coo'),
          name: vals.name.trim() || om.defaultName.replace('{n}', String(coOwners.length + 1)),
          ownershipPct,
          ...(debtSharePct !== undefined ? { debtSharePct } : {}),
          // An emptied "owned from" falls back to the move-in, never to "always".
          since: (vals.since || defaultSince).slice(0, 7),
          ...(vals.until ? { until: vals.until.slice(0, 7) } : {}),
        };
        const next = c ? coOwners.map(x => (x.id === c.id ? row : x)) : [...coOwners, row];
        if (saveCoOwners(next)) closeModal();
      },
    });
  };

  // Two ways out: a row entered by mistake is deleted from all history; a
  // co-owner who sold their share keeps the row with a last month, so history
  // before then keeps the split.
  const removeCoOwner = (c: CoOwner) => {
    openModal({
      title: om.removeTitle.replace('{name}', c.name),
      fields: [
        {
          key: 'reason', label: om.removeReason, type: 'select', value: 'sold',
          options: [
            { value: 'sold', label: om.removeSold },
            { value: 'mistake', label: om.removeMistake },
          ],
        },
        {
          key: 'until', label: om.lastMonth, type: 'monthpicker', pickerMode: 'month',
          value: c.until ?? currentMonthKey(), showWhen: (v) => v.reason === 'sold',
        },
      ],
      saveLabel: om.remove,
      onSave: (vals) => {
        const next = vals.reason === 'mistake'
          ? coOwners.filter(x => x.id !== c.id)
          : coOwners.map(x => (x.id === c.id ? { ...x, until: (vals.until || currentMonthKey()).slice(0, 7) } : x));
        if (saveCoOwners(next)) closeModal();
      },
    });
  };

  const editMortgageBalance = (label: string) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: mortgageBalance.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) updateAsset('houseDebt', n);
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
  const editOverride = (label: string, current: number, key: keyof CapacityOverrides) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: Math.round(current).toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) setCapacityOverride(key, n);
        closeModal();
      },
    });
  };

  // Small "auto / manual" chip — the row's note names the actual source.
  const sourceBadge = (auto: boolean) => (
    <span
      className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide"
      style={{
        background: auto ? 'var(--accent-bg)' : 'var(--surface-5)',
        color: auto ? 'var(--accent)' : 'var(--text-3)',
      }}
    >
      {auto ? t.loanPage.autoBadge : t.loanPage.manualBadge}
    </span>
  );

  const amortizationSchedule = useMemo(
    () => calcAmortizationSchedule(loan.laanebelop, loan.rente, loan.nedbetalingstid),
    [loan.laanebelop, loan.rente, loan.nedbetalingstid]
  );
  const chartData = amortizationSchedule.filter((_, i) => i % Math.ceil(amortizationSchedule.length / 15) === 0 || i === amortizationSchedule.length - 1);

  // First-buyer calculations
  const calc = useMemo(() => {
    const n = loan.nedbetalingstid * 12;
    // Shared helper (guards term ≤ 0 → 0, avoiding Infinity/NaN); do not inline
    // the annuity formula here — see calculations.ts:calcMonthlyPayment.
    const monthlyPaymentBase = calcMonthlyPayment(loan.laanebelop, loan.rente, loan.nedbetalingstid);
    const monthlyPaymentWithFee = monthlyPaymentBase + loan.termingebyr;
    // Interest from the real amortization schedule, not monthlyPayment × n −
    // principal, which goes negative when the term is 0 (allowed by the editor).
    const yearOneInterest = amortizationSchedule[0]?.interestPaid ?? 0;
    const totalInterest = amortizationSchedule.reduce((s, y) => s + y.interestPaid, 0);
    const totalCost = loan.laanebelop + totalInterest + loan.etableringsgebyr + loan.termingebyr * n;
    const taxDeduction = yearOneInterest * (RENTEFRADRAG_RATE_PCT / 100);
    // Real Norwegian lending limits: the affordable price is the lower of the
    // 5× income cap and the 15%-equity (85% LTV) cap, plus a +3pp stress test.
    const capacity = calcBorrowingCapacity(
      effArslonn, effEgenkapital, effGjeld, loan.rente, loan.nedbetalingstid,
    );
    const totalpris = loan.betingetLaan + loan.egenkapital;
    return { monthlyPaymentBase, monthlyPaymentWithFee, totalInterest, totalCost, yearOneInterest, taxDeduction, capacity, totalpris };
  }, [loan, effArslonn, effEgenkapital, effGjeld, amortizationSchedule]);

  // Homeowner calculations. Money uses the term as of the balance's month;
  // the remaining-term row, payoff date and progress count down (loanTerm.ts).
  const paymentTermYears = paymentTermMonths(homeowner) / 12;
  const remainingMonths = effectiveRemainingMonths(homeowner, hist.activeKey);
  const homeownerStatus = useMemo(
    () => calcHomeownerMortgageStatus(
      mortgageBalance,
      homeowner.originalLoanAmount,
      homeowner.rente,
      paymentTermYears,
      RENTEFRADRAG_RATE_PCT,
    ),
    [mortgageBalance, homeowner, paymentTermYears]
  );

  const homeownerAmortization = useMemo(
    () => calcAmortizationSchedule(mortgageBalance, homeowner.rente, paymentTermYears),
    [mortgageBalance, homeowner.rente, paymentTermYears]
  );
  const homeownerChartData = homeownerAmortization.filter((_, i) => i % Math.ceil(homeownerAmortization.length / 15) === 0 || i === homeownerAmortization.length - 1);

  // Transitioning calculations. `mySale` is the user's part of the sale
  // (proceeds split by ownership, loan by debt share).
  const transitionNewLoan = useMemo(() => calcTransitionNewLoan(transition, mortgageBalance, loan, shares), [transition, mortgageBalance, loan, shares]);
  const { saleProceeds, bridgeCost, mySale } = transitionNewLoan;

  const fmtNum = (n: number) => formatCurrency(Math.round(n));
  const fmtPct = (n: number) => `${n.toFixed(2)}%`;
  const fmtMonthKey = (key?: string | null) =>
    key ? format(parse(key.slice(0, 7), 'yyyy-MM', new Date()), 'MMM yyyy', { locale: lang === 'nb' ? nb : enUS }) : '';

  // Payoff date + term elapsed/remaining, derived from the loan's start month.
  const loanTL = loanTimeline(homeowner.startDate, remainingMonths / 12, hist.activeKey);
  const termValue = remainingMonths > 0
    ? formatTerm(remainingMonths, { years: lp.yearsSuffix, months: lp.monthsSuffix })
    : homeowner.nedbetalingstid > 0 ? lp.termExpired : lp.termNotSet;

  // Homeowner KPI tiles: equity, value, debt, LTV + purchase-vs-value metrics.
  const propMetrics = residenceMetrics(currentResidence(residences), assets.houseValue);
  const ltvPct = assets.houseValue > 0 ? (mortgageBalance / assets.houseValue) * 100 : null;
  // Property-level, like LTV: the whole home's equity over its whole value.
  const equityPct = ltvPct != null ? 100 - ltvPct : null;
  const monthlyPaymentFull = homeownerStatus.monthlyPaymentCalc + homeowner.termingebyr;
  const fmtShare = (f: number) => String(Math.round(f * 1000) / 10);
  const activeIds = new Set(activeCoOwners(coOwners).map(c => c.id));
  const sharesText = (o: number, d: number) => om.sharesShort.replace('{own}', fmtShare(o)).replace('{debt}', fmtShare(d));
  const coOwnerNote = (c: CoOwner) => [
    c.since ? om.fromMonth.replace('{month}', fmtMonthKey(c.since)) : '',
    c.until ? om.toMonth.replace('{month}', fmtMonthKey(c.until)) : '',
  ].filter(Boolean).join(' · ') || undefined;

  // "Eierskap og lån": shown in homeowner and transitioning modes.
  const coOwnersCard = (
    <Card padding="none" className="p-5 md:p-7 space-y-5">
      <div className="flex items-center justify-between gap-2 pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 min-w-0">
          <Users size={14} strokeWidth={2} className="text-[var(--text-2)] shrink-0" />
          <SectionLabel>{om.cardTitle}</SectionLabel>
        </div>
        <span className="text-[11px] text-[var(--text-3)] text-right">{om.sharesLegend}</span>
      </div>
      <p className="text-[12px] text-[var(--text-2)]">{om.helper}</p>
      <div className="space-y-1">
        <LoanRow label={om.you} value={sharesText(shares.own, shares.debt)} highlight />
        {coOwners.map(c => (
          <LoanRow key={c.id}
            label={hist.isLive && !activeIds.has(c.id) ? `${c.name} (${om.inactive})` : c.name}
            notes={coOwnerNote(c)}
            value={sharesText(c.ownershipPct / 100, (c.debtSharePct ?? c.ownershipPct) / 100)}
            onEdit={hist.isLive ? () => editCoOwner(c) : undefined}
            onRemove={hist.isLive ? () => removeCoOwner(c) : undefined}
            removeLabel={`${om.remove} ${c.name}`} />
        ))}
      </div>
      {hist.isLive && (
        <button
          type="button"
          onClick={() => editCoOwner()}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:opacity-80 transition-opacity"
        >
          <Plus size={13} /> {om.add}
        </button>
      )}
    </Card>
  );

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

  const hubTabs = [
    { id: 'boliglaan' as const, label: t.boligPage.hubMortgage, icon: <Building2 size={14} strokeWidth={1.75} /> },
    { id: 'sekundaerbolig' as const, label: t.boligPage.hubSecondHome, icon: <Key size={14} strokeWidth={1.75} /> },
    { id: 'marked' as const, label: t.boligPage.hubMarket, icon: <LineChart size={14} strokeWidth={1.75} /> },
  ];

  return (
    <>
    <div className="space-y-6 md:space-y-7 pb-8">

      {/* Bolig hub — switch between the mortgage tools and the second-home planner */}
      <SegmentedControl
        role="tablist"
        ariaLabel={t.boligPage.hubLabel}
        value={hubTab}
        onChange={setHubTab}
        items={hubTabs.map(({ id, label, icon }) => ({ value: id, label, icon }))}
      />

      {hubTab === 'marked' ? (
        <MarketPanel />
      ) : hubTab === 'sekundaerbolig' ? (
        <SecondHomePanel />
      ) : (
      <div
        className={`space-y-6 md:space-y-7 ${hist.isLive ? '' : 'pointer-events-none select-none'}`}
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
      <SegmentedControl
        role="radiogroup"
        value={housingMode}
        onChange={setHousingMode}
        items={modeOptions.map(({ mode, label, icon }) => ({ value: mode, label, icon }))}
      />

      {/* ── FIRST BUYER ── */}
      {housingMode === 'first_buyer' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Låneevne */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Calculator size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{lp.borrowingPower}</SectionLabel>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.annualSalary} notes={lp.annualSalaryNote}
                  value={fmtNum(effArslonn)}
                  onEdit={() => editOverride(lp.annualSalary, effArslonn, 'arslonn')}
                  badge={sourceBadge(arslonnOverride === null)}
                  onReset={arslonnOverride === null ? undefined : () => setCapacityOverride('arslonn', null)}
                  resetLabel={lp.resetAuto} />
                <LoanRow label={lp.debtLabel} notes={lp.debtNote}
                  value={fmtNum(effGjeld)}
                  onEdit={() => editOverride(lp.debtLabel, effGjeld, 'gjeld')}
                  badge={sourceBadge(gjeldOverride === null)}
                  onReset={gjeldOverride === null ? undefined : () => setCapacityOverride('gjeld', null)}
                  resetLabel={lp.resetAuto} />
                <LoanRow label={lp.loanSum} notes={lp.loanSumNote}
                  value={fmtNum(loan.laanebelop)}
                  onEdit={() => editNum(lp.loanSum, 'laanebelop', loan.laanebelop)} />
                <LoanRow label={lp.equityLabel} notes={lp.equityAutoNote}
                  value={fmtNum(effEgenkapital)}
                  onEdit={() => editOverride(lp.equityLabel, effEgenkapital, 'egenkapital')}
                  badge={sourceBadge(egenkapitalOverride === null)}
                  onReset={egenkapitalOverride === null ? undefined : () => setCapacityOverride('egenkapital', null)}
                  resetLabel={lp.resetAuto} />
                <LoanRow label={lp.maxPrice} notes={calc.capacity.ltvBound ? lp.maxPriceLtvNote : lp.maxPriceIncomeNote}
                  value={fmtNum(Math.round(calc.capacity.maxPrice))}
                  highlight highlightColor="brass" />
                <LoanRow label={lp.maxLoan} notes={lp.maxLoanNote}
                  value={fmtNum(Math.round(calc.capacity.debtAtMaxPrice))} />
                <LoanRow label={lp.stressTest} notes={`${lp.stressTestNotePrefix}${fmtPct(calc.capacity.stressRatePct)}`}
                  value={`${fmtNum(Math.round(calc.capacity.stressedMonthlyPayment))}/${t.common.moAbbr}`} />
              </div>
            </Card>

            {/* Kostnad på lån */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{lp.loanCost}</SectionLabel>
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
                  value={fmtNum(calc.totalCost)} highlight highlightColor="brass" />
              </div>
            </Card>

            {/* Skattelettelse */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <ShieldCheck size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{lp.taxReliefTitle}</SectionLabel>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.yearOneInterest} notes={lp.yearOneInterestNote}
                  value={fmtNum(calc.yearOneInterest)} />
                <LoanRow label={lp.deductionRate} notes={lp.deductionRateNote}
                  value={fmtPct(RENTEFRADRAG_RATE_PCT)} />
                <LoanRow label={lp.annualRelief} notes={lp.annualReliefNote}
                  value={fmtNum(calc.taxDeduction)} highlight highlightColor="green" />
              </div>
            </Card>

            {/* Finansieringsbevis */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Building2 size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                  <SectionLabel>{lp.financingProof}</SectionLabel>
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
                  value={fmtNum(calc.totalpris)} highlight highlightColor="brass" />
              </div>
            </Card>

          </div>

          <AmortizationAccordion
            show={showAmortization}
            onToggle={() => setShowAmortization(v => !v)}
            schedule={amortizationSchedule}
            chartData={chartData}
            t={t}
            lang={lang}
            formatCurrency={formatCurrency}
            principal={loan.laanebelop}
            annualRatePct={loan.rente}
            basePayment={calc.monthlyPaymentBase}
          />
        </>
      )}

      {/* ── HOMEOWNER ── */}
      {housingMode === 'homeowner' && (
        <>
          {/* KPI-fliser: egenkapital, verdi, gjeld, belåningsgrad */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
            <StatCard
              accent
              title={lp.homeEquityTitle}
              value={fmtNum(houseEquity)}
              sublabel={equityPct != null
                ? hasCoOwners
                  ? `${om.yourShare} · ${om.wholeHomeEquity.replace('{pct}', equityPct.toFixed(1))}`
                  : `${equityPct.toFixed(1)} % ${lp.kpiOfValue}`
                : undefined}
            />
            <StatCard
              title={lp.propertyCurrentValue}
              value={fmtNum(assets.houseValue)}
              sublabel={propMetrics.gainKr != null || hasCoOwners
                ? <>
                    {propMetrics.gainKr != null && (
                      <span style={{ color: propMetrics.gainKr >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                        {propMetrics.gainKr >= 0 ? '+' : ''}{fmtNum(propMetrics.gainKr)} {lp.kpiSincePurchase}
                      </span>
                    )}
                    {hasCoOwners && <span className="block">{om.yourShare}: {fmtNum(myHouseValue(assets))}</span>}
                  </>
                : undefined}
            />
            <StatCard
              title={t.currentMortgageBalance}
              value={fmtNum(mortgageBalance)}
              sublabel={homeowner.originalLoanAmount > 0 || hasCoOwners
                ? <>
                    {homeowner.originalLoanAmount > 0 && `${lp.kpiOf} ${fmtNum(homeowner.originalLoanAmount)} ${lp.kpiOriginal}`}
                    {hasCoOwners && <span className="block">{om.yourShare}: {fmtNum(myHouseDebt(assets))}</span>}
                  </>
                : undefined}
            />
            <StatCard
              title={lp.ltv}
              value={ltvPct != null ? fmtPct(ltvPct) : '–'}
              sublabel={loanTL.payoffDate ? `${lp.kpiPaidOff} ${fmtMonthKey(loanTL.payoffDate)}` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Nåværende lån */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Calculator size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{lp.currentLoanTitle}</SectionLabel>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.accountLabel}
                  value={homeowner.accountLabel || '–'}
                  onEdit={() => editHomeownerText(lp.accountLabel, 'accountLabel', homeowner.accountLabel ?? '', lp.accountLabelPlaceholder)} />
                <LoanRow label={t.currentMortgageBalance}
                  value={fmtNum(mortgageBalance)}
                  onEdit={() => editMortgageBalance(t.currentMortgageBalance)} />
                <LoanRow label={t.originalLoanAmount}
                  value={fmtNum(homeowner.originalLoanAmount)}
                  onEdit={() => editHomeowner(t.originalLoanAmount, 'originalLoanAmount', homeowner.originalLoanAmount)} />
                <LoanRow label={lp.nominalRate}
                  value={fmtPct(homeowner.rente)}
                  onEdit={() => editHomeowner(lp.rateEditTitle, 'rente', homeowner.rente)} />
                {homeowner.notifiedRate != null && homeowner.notifiedRate > 0 && (
                  <LoanRow label={lp.notifiedRate}
                    notes={homeowner.notifiedRateFrom ? `${lp.notifiedRateFrom} ${fmtMonthKey(homeowner.notifiedRateFrom)}` : undefined}
                    value={fmtPct(homeowner.notifiedRate)} />
                )}
                <LoanRow label={t.yearsRemaining}
                  value={termValue}
                  onEdit={editHomeownerTerm} />
                <LoanRow label={lp.loanStartDate}
                  value={homeowner.startDate ? fmtMonthKey(homeowner.startDate) : '–'}
                  onEdit={() => editHomeownerMonth(lp.loanStartDate, 'startDate', homeowner.startDate ?? '')} />
                {loanTL.payoffDate && (
                  <LoanRow label={lp.payoffDate} value={fmtMonthKey(loanTL.payoffDate)} />
                )}
                <LoanRow label={lp.termFee}
                  value={fmtNum(homeowner.termingebyr)}
                  onEdit={() => editHomeowner(lp.termFee, 'termingebyr', homeowner.termingebyr)} />
                <LoanRow label={t.monthlyPaymentCalc}
                  value={paymentTermYears > 0 ? fmtNum(monthlyPaymentFull) : '–'}
                  highlight />
                {hasCoOwners && paymentTermYears > 0 && (
                  <LoanRow label={om.yourPart} value={fmtNum(monthlyPaymentFull * shares.debt)} />
                )}
                <LoanRow label={lp.ofWhichInterest}
                  value={paymentTermYears > 0 ? fmtNum(homeownerStatus.monthlyInterest) : '–'} />
                <LoanRow label={lp.ofWhichPrincipal}
                  value={paymentTermYears > 0 ? fmtNum(homeownerStatus.monthlyPrincipal) : '–'} />
              </div>
              {loanTL.elapsedPct != null && (
                <div className="pt-1">
                  <div className="flex justify-between text-[11px] text-[var(--text-2)] mb-1.5">
                    <span>{lp.yearsElapsed}</span>
                    <span className="font-mono font-medium text-[var(--text-1)]">{loanTL.elapsedPct.toFixed(0)}%</span>
                  </div>
                  <ProgressBar pct={loanTL.elapsedPct} color="var(--positive)" />
                </div>
              )}
            </Card>

            {coOwnersCard}

            {/* Bolig & kjøp */}
            <PropertyCard currentValue={assets.houseValue} readOnly={!hist.isLive} />

            {/* Estimert markedsverdi (SSB kvadratmeterpris) */}
            <PropertyValueEstimate residence={currentResidence(residences)} currentValue={assets.houseValue} onOpenMarket={() => setHubTab('marked')} />
          </div>

          {/* Bohistorikk — full bredde */}
          <ResidenceTimeline readOnly={!hist.isLive} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Skattelettelse */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <ShieldCheck size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{lp.taxReliefTitle}</SectionLabel>
              </div>
              <div className="space-y-1">
                <LoanRow label={lp.monthlyInterestLabel}
                  value={fmtNum(homeownerStatus.monthlyInterest)} />
                {hasCoOwners && (
                  <LoanRow label={om.yourInterest}
                    value={fmtNum(homeownerStatus.monthlyInterest * shares.debt)} />
                )}
                <LoanRow label={lp.deductionRate}
                  value={fmtPct(RENTEFRADRAG_RATE_PCT)} />
                {/* Rentefradrag follows the user's share of the joint loan. */}
                <LoanRow label={t.annualTaxBenefit}
                  value={fmtNum(homeownerStatus.annualTaxDeduction * shares.debt)}
                  highlight highlightColor="green" />
              </div>
            </Card>

            {/* Sammenlign renten din */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <TrendingDown size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{lp.compareRateTitle}</SectionLabel>
              </div>
              <p className="text-[13px] text-[var(--text-2)]">
                {lp.compareRateBody}
              </p>
              <div className="space-y-1">
                <LoanRow label={lp.yourRate} value={fmtPct(homeowner.rente)} />
                {policyRate != null && (
                  <>
                    <LoanRow label={lp.policyRateLabel} value={fmtPct(policyRate)} />
                    <LoanRow label={lp.rateSpreadLabel}
                      value={`${homeowner.rente - policyRate >= 0 ? '+' : ''}${fmtPct(homeowner.rente - policyRate)}`} />
                  </>
                )}
                <LoanRow label={lp.remainingDebt} value={fmtNum(mortgageBalance)} />
                <LoanRow label={lp.ltv}
                  value={assets.houseValue > 0
                    ? fmtPct((mortgageBalance / assets.houseValue) * 100)
                    : '–'}
                  highlight />
              </div>
              {policyRateStale && (
                <p className="text-[11px] flex items-center gap-2" style={{ color: 'var(--warning)' }}>
                  <span>{lp.policyRateOffline}</span>
                  <button
                    type="button"
                    onClick={handleRefreshPolicyRate}
                    disabled={refreshingPolicyRate}
                    className="underline underline-offset-2 hover:opacity-80 transition-opacity disabled:opacity-60 disabled:no-underline"
                  >
                    {refreshingPolicyRate ? lp.policyRateRefreshing : lp.policyRateRefresh}
                  </button>
                </p>
              )}
              {policyRate != null && policyRateAsOf && (
                <p className="text-[11px] text-[var(--text-3)]">{lp.policyRateSource} {policyRateAsOf}</p>
              )}
              <a
                href="https://www.forbrukerradet.no/finansportalen/bank/lan/boliglan"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-[6px] bg-[var(--forest)] text-[var(--text)] text-[13px] font-medium hover:bg-[var(--forest-dim)] transition-colors"
              >
                {lp.compareCta}
                <ExternalLink size={14} strokeWidth={2} />
              </a>
            </Card>

          </div>

          <AmortizationAccordion
            show={showHomeownerAmortization}
            onToggle={() => setShowHomeownerAmortization(v => !v)}
            schedule={homeownerAmortization}
            chartData={homeownerChartData}
            t={t}
            lang={lang}
            formatCurrency={formatCurrency}
            principal={mortgageBalance}
            annualRatePct={homeowner.rente}
            basePayment={homeownerStatus.monthlyPaymentCalc}
          />

          {/* Loan-to-value over time */}
          <Card padding="none" className="p-5 md:p-7">
            <div className="pb-4 mb-2 border-b border-[var(--border)]">
              <SectionLabel>{t.charts.ltvTitle}</SectionLabel>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.ltvSub}</p>
            </div>
            <div className="h-[240px] w-full">
              <Suspense fallback={<ChartSkeleton />}><LtvChart /></Suspense>
            </div>
          </Card>

          {/* Nedbetaling: plan vs. faktisk (renders only when ≥2 months recorded) */}
          <Suspense fallback={null}><PaydownVsPlanChart /></Suspense>
        </>
      )}

      {/* ── TRANSITIONING ── */}
      {housingMode === 'transitioning' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">

            {/* Salg av nåværende bolig */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Building2 size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{t.saleCard}</SectionLabel>
              </div>
              <div className="space-y-1">
                <LoanRow label={t.currentHouseValue}
                  value={fmtNum(transition.currentHouseValue)}
                  onEdit={() => editTransition(t.currentHouseValue, 'currentHouseValue', transition.currentHouseValue)} />
                <LoanRow label={t.currentMortgageBalance}
                  notes={lp.currentLoanNote}
                  value={fmtNum(mortgageBalance)}
                  onEdit={() => editMortgageBalance(t.currentMortgageBalance)} />
                {/* The current loan's rate, term and balance date (the homeowner
                    slice): projections pay it down until the mode is switched. */}
                <LoanRow label={lp.nominalRate}
                  value={fmtPct(homeowner.rente)}
                  onEdit={() => editHomeowner(lp.rateEditTitle, 'rente', homeowner.rente)} />
                <LoanRow label={t.yearsRemaining}
                  value={termValue}
                  onEdit={editHomeownerTerm} />
                <LoanRow label={lp.balanceAsOf}
                  value={homeowner.currentMortgageBalanceAsOf ? fmtMonthKey(homeowner.currentMortgageBalanceAsOf) : '–'}
                  onEdit={() => editHomeownerMonth(lp.balanceAsOf, 'currentMortgageBalanceAsOf', homeowner.currentMortgageBalanceAsOf ?? '')} />
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
                {hasCoOwners && (
                  <LoanRow label={om.saleShare} value={fmtNum(mySale)} highlight
                    highlightColor={mySale < 0 ? 'red' : 'blue'} />
                )}
              </div>
            </Card>

            {coOwnersCard}

            {/* Mellomfinansieringsperiode */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Clock size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{t.bridgeCard}</SectionLabel>
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
            </Card>

            {/* Ny bolig – lånekalkulator */}
            <Card padding="none" className="p-5 md:p-7 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
                <Calculator size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <SectionLabel>{t.newHouseCard}</SectionLabel>
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
              {hasCoOwners && <p className="text-[11px] text-[var(--text-3)]">{om.newHomeNote}</p>}
            </Card>

          </div>

          {/* Summary hero card */}
          <Card padding="none" className="p-5 md:p-7">
            <div className="flex items-center gap-2 pb-4 mb-5 border-b border-[var(--border)]">
              <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
              <SectionLabel>{t.summaryCard}</SectionLabel>
            </div>

            {/* Flow diagram */}
            <div className="flex items-center gap-2 flex-wrap mb-6">
              <FlowStep label={lp.flowSell} value={fmtNum(transition.currentHouseValue)} color="blue" />
              <ArrowRight size={14} className="text-[var(--text-2)] shrink-0" />
              <FlowStep label={lp.flowPayLoan} value={fmtNum(mortgageBalance)} color="red" />
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
          </Card>

          {/* Din nåværende bolig (den du selger) + bohistorikk. Verdien er
              salgsverdien fra salgskortet over — samme boligen du eier nå. */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
            <PropertyCard currentValue={transition.currentHouseValue} readOnly={!hist.isLive} />
            <ResidenceTimeline readOnly={!hist.isLive} />
          </div>
        </>
      )}

      {modal && <EditModal {...modal} onCancel={closeModal} />}
      </div>
      )}
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
  lang: 'nb' | 'en';
  formatCurrency: (n: number) => string;
  /** Extra-payment what-if inputs: the loan and its scheduled annuity payment. */
  principal: number;
  annualRatePct: number;
  basePayment: number;
}

function AmortizationAccordion({ show, onToggle, schedule, chartData, t, lang, formatCurrency, principal, annualRatePct, basePayment }: AmortizationAccordionProps) {
  const reduced = useReducedMotion();
  const [extra, setExtra] = useState(0);
  const savings = useMemo(
    () => extraPaymentSavings(principal, annualRatePct, basePayment, extra),
    [principal, annualRatePct, basePayment, extra],
  );
  return (
    <Card padding="none" className="overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 md:px-7 md:py-5 flex items-center justify-between hover:bg-[var(--bg-raised)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{t.amortizationSchedule}</SectionLabel>
        </div>
        {show
          ? <ChevronUp size={16} className="text-[var(--text-2)]" />
          : <ChevronDown size={16} className="text-[var(--text-2)]" />}
      </button>

      {show && (
        <div className="border-t border-[var(--border)]">
          {/* Extra-payment what-if: months + interest saved vs the base schedule. */}
          <div className="px-5 py-5 md:px-7 space-y-4 border-b border-[var(--border)]">
            <div>
              <h4 className="text-[12px] font-semibold text-[var(--text-1)]">{t.loanPage.extraPaymentTitle}</h4>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-2)' }}>{t.loanPage.extraPaymentDesc}</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={10000}
                step={500}
                value={extra}
                onChange={(e) => setExtra(Number(e.target.value))}
                aria-label={t.loanPage.extraPaymentLabel}
                className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
                style={{ background: 'color-mix(in srgb, var(--text-3) 18%, transparent)' }}
              />
              <span className="font-mono text-[13px] font-semibold min-w-[96px] text-right" style={{ color: 'var(--accent)' }}>
                +{formatCurrency(extra)}/{t.common.moAbbr}
              </span>
            </div>
            {extra > 0 && savings.feasible ? (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t.loanPage.extraPaymentTimeSaved, value: formatMonths(savings.monthsSaved, lang), pos: true },
                  { label: t.loanPage.extraPaymentInterestSaved, value: formatCurrency(Math.round(savings.interestSaved)), pos: true },
                  { label: t.loanPage.extraPaymentNewPayoff, value: formatMonths(savings.extraMonths, lang), pos: false },
                ].map((s) => (
                  <div key={s.label} className="rounded-[8px] p-3 border bg-[var(--bg-raised)] border-[var(--border)]">
                    <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)] mb-1">{s.label}</div>
                    <div className="text-[14px] font-mono font-semibold" style={{ color: s.pos ? 'var(--positive)' : 'var(--text-1)' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{t.loanPage.extraPaymentNone}</p>
            )}
          </div>
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
                  <Bar isAnimationActive={!reduced} dataKey="principalPaid" name={t.principalPayment} stackId="a" fill={CHART.forestLight} radius={[0, 0, 0, 0]} />
                  <Bar isAnimationActive={!reduced} dataKey="interestPaid" name={t.interestPayment} stackId="a" fill={CHART.rust} fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[var(--bg-raised)]">
                <tr className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-2)]">
                  <th scope="col" className="px-5 md:px-7 py-3">{t.year}</th>
                  <th scope="col" className="px-5 md:px-7 py-3 text-right">{t.annualPayment}</th>
                  <th scope="col" className="px-5 md:px-7 py-3 text-right">{t.principalPayment}</th>
                  <th scope="col" className="px-5 md:px-7 py-3 text-right">{t.interestPayment}</th>
                  <th scope="col" className="px-5 md:px-7 py-3 text-right">{t.remainingBalance}</th>
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
    </Card>
  );
}

// ── Small UI components ──

interface LoanRowProps {
  label: string;
  value: string;
  notes?: string;
  onEdit?: () => void;
  highlight?: boolean;
  highlightColor?: 'blue' | 'green' | 'red' | 'brass';
  /** Small chip after the label (e.g. Auto / Overstyrt). */
  badge?: React.ReactNode;
  /** When set, shows a reset-to-auto control that clears a manual override. */
  onReset?: () => void;
  /** Accessible label for the reset-to-auto control. */
  resetLabel?: string;
  /** When set, shows a remove control after the value. */
  onRemove?: () => void;
  removeLabel?: string;
}

function LoanRow({ label, value, notes, onEdit, highlight, highlightColor = 'blue', badge, onReset, resetLabel, onRemove, removeLabel }: LoanRowProps) {
  const isCalculated = !onEdit;
  const valueColor = highlight
    ? highlightColor === 'brass'
      ? 'text-[var(--brass)]'
      : highlightColor === 'red'
        ? 'text-[var(--negative)]'
        : 'text-[var(--positive)]'
    : isCalculated
      ? 'text-[var(--text-2)]'
      : 'text-[var(--text-1)]';

  const labelColor = highlight ? valueColor : isCalculated ? 'text-[var(--text-2)]' : 'text-[var(--text-1)]';

  return (
    <div
      role="presentation"
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
        {onEdit ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="inline-flex items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg-raised)] px-2.5 py-1.5 group-hover:border-[var(--brass-dim)] group-hover:bg-[var(--bg-elev)] transition-colors"
          >
            <span className={`text-[13px] font-mono font-medium whitespace-nowrap ${valueColor}`}>{value}</span>
            <Edit2 size={12} className="text-[var(--text-3)] shrink-0" />
          </button>
        ) : (
          <span className={`text-[13px] font-mono font-medium whitespace-nowrap ${valueColor}`}>{value}</span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1.5 rounded-md text-[var(--text-2)] hover:text-[var(--negative)] hover:bg-[var(--bg-elev)] transition-colors shrink-0"
            aria-label={removeLabel}
          >
            <Trash2 size={13} />
          </button>
        )}
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

export default BoligPage;
