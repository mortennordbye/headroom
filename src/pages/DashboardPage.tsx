import React, { useMemo, useState, lazy, Suspense } from 'react';
import {
  TrendingUp, Wallet, Home, Zap, PiggyBank, BarChart2, Bitcoin, Shield, Receipt,
  ArrowUpRight, BarChart3, LifeBuoy, Scale, Pencil, AlertTriangle, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, parse, format as fmtDate, subMonths } from 'date-fns';
import { useFinance, DEFAULT_GROWTH_RATES, DEFAULT_TAX_RATES } from '../context/FinanceContext';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { DeltaChip } from '../components/ui/DeltaChip';
import { AccountBadge } from '../components/AccountBadge';
import { txDisplayName } from '../lib/labelRules';
import { EquityCompositionBar } from '../components/EquityCompositionBar';
import NetWorthHistoryModal from '../components/NetWorthHistoryModal';
import {
  calcNetWorthProjectionByBucket, calcHouseEquityByYear,
  calcEmergencyFundStatus, calcDebtToIncome,
} from '../lib/calculations';
import GoalsSection from '../components/GoalsSection';
import InsightBanner from '../components/InsightBanner';
import {
  AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import ChartTooltip from '../components/ChartTooltip';
import { CHART } from '../lib/chartColors';
import { buildNetWorthSeries } from '../lib/netWorth';
import { sumSavings } from '../lib/equity';
import { sumDiscretionarySpent } from '../lib/spentTotals';
import { formatSignedPct } from '../lib/format';

const CashflowChart = lazy(() => import('../components/charts/CashflowChart'));
const EmergencyFundGauge = lazy(() => import('../components/charts/EmergencyFundGauge'));

const DashboardPage: React.FC = () => {
  const {
    t,
    effectiveIncome,
    averageIncome,
    prevMonthIncome,
    prevMonthSpending,
    recommendedSpending,
    recommendedInvestment,
    monthlyBudget,
    conservativeMode,
    totalResidual,
    totalFixedExpenses,
    dailyData,
    dailyTransactions,
    labelRules,
    incomeSeries,
    currentMonth,
    totalEquity,
    totalDebt,
    netWorth,
    netInvestment,
    netCrypto,
    houseEquity,
    assets,
    netWorthHistory,
    savingsTargetPercent,
    growthReturnRate,
    houseGrowthRate,
    cashGrowthRate,
    cryptoGrowthRate,
    formatCurrency,
    formatCurrencyShort,
    dailyBudget,
    mortgageRate,
    mortgageTermYears,
    grossAnnualIncome,
    assumptionsNudgeDismissed,
    dismissAssumptionsNudge,
  } = useFinance();

  // ─── Derived numbers ───
  // Discretionary spend, not raw spend: envelope-covered spend (food, etc.) is
  // already accounted for inside totalFixedExpenses, so the budget-composition
  // bar, burn rate and pacing all measure only what draws down the daily budget —
  // otherwise the enveloped amount would be double-counted here. (The Budget
  // ledger deliberately uses the raw total instead — see src/lib/spentTotals.ts.)
  const totalSpent = sumDiscretionarySpent(dailyData);
  const monthEndSurplus = dailyData[dailyData.length - 1]?.balance ?? 0;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayEntry = dailyData.find(d => d.dateStr === todayStr);
  const todayBalance = todayEntry?.balance ?? monthEndSurplus;

  // Budget Health composition: each legend item pairs a kr value with its share
  // of the SAME denominator (this month's income), unclamped — an overspent
  // month shows spent > its true share and a negative remainder. The bar
  // segments below clamp only for rendering.
  const budgetUsedPctRaw = effectiveIncome > 0 ? (totalFixedExpenses / effectiveIncome) * 100 : 0;
  const spentPctRaw = effectiveIncome > 0 ? (totalSpent / effectiveIncome) * 100 : 0;
  const remainingBudget = effectiveIncome - totalFixedExpenses - totalSpent;
  const remainingPctRaw = effectiveIncome > 0 ? (remainingBudget / effectiveIncome) * 100 : 0;
  const budgetUsedPct = Math.min(100, budgetUsedPctRaw);
  const spentPct = Math.min(100 - budgetUsedPct, spentPctRaw);
  const availablePct = Math.max(0, 100 - budgetUsedPct - spentPct);
  const incomeDiffPct = averageIncome > 0 ? ((effectiveIncome - averageIncome) / averageIncome) * 100 : 0;
  const incomeDelta = prevMonthIncome > 0 ? ((effectiveIncome - prevMonthIncome) / prevMonthIncome) * 100 : null;
  const spendingDelta = prevMonthSpending > 0 ? ((totalSpent - prevMonthSpending) / prevMonthSpending) * 100 : null;

  // ─── Financial-resilience metrics ───
  const emergencyFund = calcEmergencyFundStatus(assets.bufferAccount, totalFixedExpenses);
  const debtToIncome = calcDebtToIncome(assets.houseDebt + totalDebt, grossAnnualIncome);

  // ─── How many market assumptions are still on their default value ───
  // Surfaced as a nudge so the user knows their projections rest on untuned defaults.
  const defaultAssumptions = useMemo(() => [
    growthReturnRate === DEFAULT_GROWTH_RATES.growthReturnRate,
    houseGrowthRate === DEFAULT_GROWTH_RATES.houseGrowthRate,
    cashGrowthRate === DEFAULT_GROWTH_RATES.cashGrowthRate,
    cryptoGrowthRate === DEFAULT_GROWTH_RATES.cryptoGrowthRate,
    assets.taxRate === DEFAULT_TAX_RATES.stockTaxRate,
    assets.cryptoTaxRate === DEFAULT_TAX_RATES.cryptoTaxRate,
  ].filter(Boolean).length,
  [growthReturnRate, houseGrowthRate, cashGrowthRate, cryptoGrowthRate, assets.taxRate, assets.cryptoTaxRate]);

  // ─── Net worth history (last 12 months) ───
  // Always produce exactly 12 monthly points on a fixed last-12-months grid.
  // Months with a recorded snapshot are real; gaps are filled (interpolated
  // between recorded months, gently back-projected before the earliest one) and
  // tagged estimated so the chart can mark them distinctly. The current month is
  // always an anchor at the live totalEquity. Estimated points turn real as
  // monthly snapshots accumulate.
  const { netWorthSeries, isEstimated } = useMemo(() => {
    const monthKeys = Array.from({ length: 12 }, (_, i) =>
      format(subMonths(new Date(), 11 - i), 'yyyy-MM'));
    const series = buildNetWorthSeries(monthKeys, netWorthHistory, totalEquity);
    return { netWorthSeries: series, isEstimated: series.some(p => p.estimated) };
  }, [netWorthHistory, totalEquity]);

  // Month-over-month change in NET EQUITY (from the series above), for the hero
  // card chip and subtitle. Previously these showed income MoM — an honest but
  // wrong figure for a "net equity" label.
  const netEquityDelta = useMemo(() => {
    if (netWorthSeries.length < 2) return null;
    const curr = netWorthSeries[netWorthSeries.length - 1].value;
    const prev = netWorthSeries[netWorthSeries.length - 2].value;
    return prev > 0 ? ((curr - prev) / prev) * 100 : null;
  }, [netWorthSeries]);

  const annualSavings = Math.max(0, recommendedInvestment * 12);
  const cashStart = sumSavings(assets) + assets.bsu + assets.bufferAccount;
  const projectionRates = { stocks: growthReturnRate, crypto: cryptoGrowthRate, cash: cashGrowthRate, house: houseGrowthRate };
  const projectionStart = { stocks: netInvestment, crypto: netCrypto, cash: cashStart, house: houseEquity };
  const houseByYear = calcHouseEquityByYear(assets.houseValue, assets.houseDebt, houseGrowthRate, mortgageRate, mortgageTermYears, 15);

  // ─── Assets ───
  const assetRows = useMemo(() => [
    { label: t.investmentNet, value: Math.max(0, netInvestment), icon: <BarChart2 size={14} />, color: 'var(--chart-1)' },
    { label: t.propertyEquity, value: Math.max(0, houseEquity), icon: <Home size={14} />, color: 'var(--chart-2)' },
    { label: t.dashboardPage.cryptoNet, value: Math.max(0, netCrypto), icon: <Bitcoin size={14} />, color: 'var(--chart-4)' },
    { label: t.bsu, value: assets.bsu, icon: <Shield size={14} />, color: 'var(--chart-3)' },
    { label: t.savings, value: sumSavings(assets), icon: <PiggyBank size={14} />, color: 'var(--chart-5)' },
    { label: t.bufferAccount, value: assets.bufferAccount, icon: <Wallet size={14} />, color: 'var(--chart-6)' },
  ].filter(r => r.value > 0), [netInvestment, houseEquity, netCrypto, assets, t]);
  // Allocation percentages divide by the sum of the CLAMPED rows above — using
  // totalEquity (which nets negative buckets) would let the rows sum past 100%,
  // and the strip and rows must share one denominator.
  const allocationTotal = useMemo(() => assetRows.reduce((s, r) => s + r.value, 0), [assetRows]);

  // ─── Recent transactions ───
  type FilterMode = 'all' | 'income' | 'expense';
  const [filter, setFilter] = useState<FilterMode>('all');
  const [historyOpen, setHistoryOpen] = useState(false);
  const recentTransactions = useMemo(() => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    let list = [...dailyTransactions]
      .filter(tx => tx.date.startsWith(monthStr))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (filter === 'income') list = list.filter(tx => tx.kind === 'income');
    else if (filter === 'expense') list = list.filter(tx => tx.kind !== 'income');
    return list.slice(0, 7);
  }, [dailyTransactions, currentMonth, filter]);

  // ─── Insight 1: monthly investment bar chart (12 months + 2 projected) ───
  // Built on the context's incomeSeries — a fixed last-12-months grid where each
  // month is its manual override or the salary-derived income — so the bars are
  // always contiguous months, not just whichever months happen to have overrides.
  const investmentBars = useMemo(() => {
    // Match the recommendation/projection definition: invest a share of the
    // monthly *residual* (income − fixed expenses), not of gross income. Fixed
    // expenses aren't historized, so the current total is the best proxy.
    const investFrom = (monthlyIncome: number) =>
      Math.max(0, monthlyIncome - totalFixedExpenses) * (savingsTargetPercent / 100);
    const months: { key: string; label: string; value: number; projected?: boolean }[] =
      incomeSeries.map(({ month, value }) => ({
        key: month,
        label: fmtDate(parse(month, 'yyyy-MM', new Date()), 'MMM'),
        value: Math.round(investFrom(value)),
      }));
    // 2 projected months ahead
    const last = incomeSeries[incomeSeries.length - 1];
    if (last) {
      const baseVal = investFrom(last.value);
      for (let i = 1; i <= 2; i++) {
        const d = parse(last.month, 'yyyy-MM', new Date());
        d.setMonth(d.getMonth() + i);
        months.push({ key: `proj-${i}`, label: fmtDate(d, 'MMM'), value: Math.round(baseVal * 1.02 ** i), projected: true });
      }
    }
    return months;
  }, [incomeSeries, savingsTargetPercent, totalFixedExpenses]);

  // ─── Insight 2: top categories MoM ───
  const categoryDeltas = useMemo(() => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    const prevMonthStr = format(subMonths(currentMonth, 1), 'yyyy-MM');
    const groupBy = (predicate: (m: string) => boolean) => {
      const map = new Map<string, number>();
      dailyTransactions
        // Only expenses belong in a spending-by-category breakdown.
        .filter(tx => predicate(tx.date) && tx.kind !== 'income')
        .forEach(tx => {
          const cat = tx.category || t.dashboardPage.other;
          map.set(cat, (map.get(cat) ?? 0) + tx.amount);
        });
      return map;
    };
    const cur = groupBy(d => d.startsWith(monthStr));
    const prev = groupBy(d => d.startsWith(prevMonthStr));
    const rows = Array.from(cur.entries())
      .map(([cat, val]) => {
        const prevVal = prev.get(cat) ?? 0;
        const deltaPct = prevVal > 0 ? ((val - prevVal) / prevVal) * 100 : null;
        return { category: cat, value: val, deltaPct };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    const max = rows[0]?.value ?? 1;
    return rows.map(r => ({ ...r, pctOfMax: (r.value / max) * 100 }));
  }, [dailyTransactions, currentMonth, t]);

  // ─── Insight 3: 15-year projection ───
  const projection15y = useMemo(() => {
    return calcNetWorthProjectionByBucket(projectionStart, annualSavings, projectionRates, 15, houseByYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netInvestment, netCrypto, cashStart, houseEquity, annualSavings, growthReturnRate, cryptoGrowthRate, cashGrowthRate, houseGrowthRate, assets.houseValue, assets.houseDebt, mortgageRate, mortgageTermYears]);

  const projectionEndYear = projection15y[projection15y.length - 1]?.year;
  const projectionEndValue = projection15y[projection15y.length - 1]?.total ?? 0;
  // Denominator is the projection's own year-0 total (not totalEquity computed
  // elsewhere) so the % can't silently drift if either definition changes.
  const projectionStartValue = projection15y[0]?.total ?? 0;
  const projectionGrowthPct = projectionStartValue > 0 ? Math.round((projectionEndValue / projectionStartValue - 1) * 100) : 0;

  // ─── Burn rate (Can Spend chart) ───
  const burnRate = useMemo(() => {
    const rawIdx = dailyData.findIndex(d => d.dateStr === todayStr);
    // When viewing a non-current month, "today" isn't in it — treat the whole
    // month as elapsed rather than collapsing to day 1 (which findIndex=-1 → 0 did).
    const isCurrentMonth = rawIdx >= 0;
    const todayIdx = isCurrentMonth ? rawIdx : dailyData.length - 1;
    const upToToday = dailyData.slice(0, todayIdx + 1);
    const cumulative: number[] = [];
    let running = 0;
    upToToday.forEach(d => { running += d.discretionary; cumulative.push(running); });
    return {
      todayIdx,
      total: dailyData.length,
      actual: cumulative,
      target: recommendedSpending,
      ideal: (recommendedSpending / dailyData.length) * (todayIdx + 1),
    };
  }, [dailyData, todayStr, recommendedSpending]);

  const overshoot = burnRate.actual.length
    ? Math.round((burnRate.actual[burnRate.actual.length - 1] / Math.max(1, burnRate.ideal)) * burnRate.target - burnRate.target)
    : 0;

  // ─── Narrative subtitle (auto-generated insight) ───
  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (netEquityDelta !== null) {
      parts.push(`${t.dashboardPage.netEquity} ${netEquityDelta >= 0 ? t.dashboardPage.up : t.dashboardPage.down} ${Math.abs(netEquityDelta).toFixed(1)}% ${t.dashboardPage.thisMonth}`);
    }
    if (monthlyBudget > 0 && totalSpent > 0) {
      const usagePct = (totalSpent / monthlyBudget) * 100;
      parts.push(`${t.dashboardPage.youveUsed} ${usagePct.toFixed(0)}% ${t.dashboardPage.ofSpendingBudget}`);
    }
    return parts.length ? parts.join('. ') + '.' : t.dashboardPage.setupPrompt;
  }, [netEquityDelta, monthlyBudget, totalSpent, t]);

  // ── Render ──
  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header data-tour="dashboard-hero" className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {t.dashboardPage.goodAfternoon}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          <>{t.dashboardPage.heroA} <em className="italic" style={{ color: 'var(--brass)' }}>headroom</em>.<br className="hidden md:inline" /> {t.dashboardPage.heroB}</>
        </h1>
        <p className="mt-4 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {subtitle}
        </p>
      </header>

      {/* Defaults nudge — market assumptions still untuned. Dismissable for good. */}
      {defaultAssumptions > 0 && !assumptionsNudgeDismissed && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius-md)] border text-[13px]"
          style={{ background: 'var(--warning-bg)', borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)', color: 'var(--warning)' }}
        >
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="[overflow-wrap:anywhere]">
              {defaultAssumptions} {t.dashboardPage.assumptionsNudge}
            </span>
          </span>
          <span className="shrink-0 flex items-center gap-1">
            <Link
              to="/settings"
              className="font-semibold inline-flex items-center gap-1 transition-opacity hover:opacity-90"
            >
              {t.dashboardPage.reviewSettings}
              <ArrowUpRight size={14} />
            </Link>
            <button
              type="button"
              onClick={dismissAssumptionsNudge}
              aria-label={t.dashboardPage.dismissNudge}
              title={t.dashboardPage.dismissNudge}
              className="ml-1 p-1 rounded-[6px] transition-opacity hover:opacity-70"
            >
              <X size={15} />
            </button>
          </span>
        </div>
      )}

      {/* Bento grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 auto-rows-min gap-3 md:gap-4">

        {/* ─── Auto-generated spending headline (hidden when nothing notable) ─── */}
        <InsightBanner />

        {/* ─── HERO: Net Equity (span 7, row 1) ─── */}
        <Card variant="hero" padding="lg" className="md:col-span-7 md:row-span-2 flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel icon={<TrendingUp />}>{t.totalEquity}</SectionLabel>
            {netEquityDelta !== null && (
              <DeltaChip tone={netEquityDelta >= 0 ? 'positive' : 'negative'} showArrow>
                {formatSignedPct(netEquityDelta)} MoM
              </DeltaChip>
            )}
          </div>

          <div
            className="font-mono font-medium tracking-[-0.03em] leading-none mt-4"
            style={{
              fontSize: 'clamp(40px, 5.5vw, 60px)',
              color: 'var(--text-1)',
            }}
          >
            {formatCurrency(netWorth)}
          </div>
          <div className="text-[13px] mt-2" style={{ color: 'var(--text-2)' }}>
            {t.dashboardPage.postTax}
          </div>
          <EquityCompositionBar />

          {/* Stat row */}
          <div className="mt-5 flex gap-6 flex-wrap">
            <div className="pl-3 border-l-2" style={{ borderColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
              <div className="text-[16px] font-semibold tabular-nums">
                {netWorthSeries.length >= 2
                  ? formatCurrency(netWorthSeries[netWorthSeries.length - 1].value - netWorthSeries[0].value)
                  : '—'}
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] mt-1" style={{ color: 'var(--text-3)' }}>
                {t.dashboardPage.change12mo}
              </div>
            </div>
            <div className="pl-3 border-l-2" style={{ borderColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
              <div className="text-[16px] font-semibold tabular-nums" style={{ color: 'var(--positive)' }}>
                +{growthReturnRate.toFixed(1)}%
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] mt-1" style={{ color: 'var(--text-3)' }}>
                {t.dashboardPage.expectedReturn}
              </div>
            </div>
            <div className="pl-3 border-l-2" style={{ borderColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
              <div className="text-[16px] font-semibold tabular-nums">
                {projectionEndYear ?? '—'}
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] mt-1" style={{ color: 'var(--text-3)' }}>
                {t.dashboardPage.targetYear}
              </div>
            </div>
          </div>

          {/* Hero chart — clean 12-month actual net-equity trend */}
          <div className="mt-6 rounded-[8px] border p-4" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>
              <div className="flex items-center gap-2">
                <span>{t.dashboardPage.netEquityLast12}</span>
                {isEstimated && (
                  <span
                    className="px-2 py-0.5 rounded-[4px] normal-case tracking-normal text-[10px]"
                    style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
                  >
                    {t.dashboardPage.estimated}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="inline-flex items-center gap-1 normal-case tracking-normal transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                >
                  <Pencil size={11} strokeWidth={2} />
                  {t.netWorthEditor.edit}
                </button>
                <span style={{ color: 'var(--accent)' }}>{t.today}</span>
              </div>
            </div>
            <HeroChart
              history={netWorthSeries.map(p => ({ label: fmtDate(parse(p.monthKey, 'yyyy-MM', new Date()), 'MMM yy'), value: p.value, estimated: p.estimated }))}
              formatCurrency={formatCurrency}
            />
          </div>
        </Card>

        {/* ─── Monthly Residual ─── */}
        <Card padding="md" className="md:col-span-5 flex flex-col" glow="positive">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel icon={<Receipt />}>{t.dashboardPage.monthlyResidual}</SectionLabel>
            {incomeDelta !== null && (
              <DeltaChip tone={incomeDelta >= 0 ? 'positive' : 'negative'} size="sm">
                {formatSignedPct(incomeDelta)}
              </DeltaChip>
            )}
          </div>
          <div className="font-semibold tracking-[-0.02em] leading-none mt-3 text-[32px]" style={{ color: totalResidual < 0 ? 'var(--negative)' : 'var(--text-1)' }}>
            {formatCurrency(totalResidual)}
          </div>
          <div className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>
            {t.dashboardPage.afterFixedExpenses}
          </div>
        </Card>

        {/* ─── Can Spend with burn-rate chart ─── */}
        <Card padding="md" className="md:col-span-5" glow="accent">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel icon={<Wallet />}>{t.canSpend}</SectionLabel>
            <DeltaChip tone="accent" size="sm">{formatCurrency(Math.round(dailyBudget))}/d</DeltaChip>
          </div>
          <div className="font-semibold tracking-[-0.02em] leading-none mt-3 text-[32px]">
            {formatCurrency(recommendedSpending)}
          </div>
          <div className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>
            {t.dashboardPage.recommendedSpendingLabel}
            {spendingDelta !== null && (
              <span className="ml-2">
                · {formatSignedPct(spendingDelta)} {t.vsLastMonth}
              </span>
            )}
          </div>
          <div className="mt-4 rounded-[8px] border p-3" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-3 text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>
                <span><span className="inline-block w-2 h-0.5 mr-1.5 align-middle" style={{ background: 'var(--accent)' }} /> {t.dashboardPage.actual}</span>
                <span><span className="inline-block w-2 h-px mr-1.5 align-middle border-t border-dashed" style={{ borderColor: 'var(--text-3)' }} /> {t.dashboardPage.idealPace}</span>
              </div>
              {overshoot > 0 && (
                <DeltaChip tone="warning" size="sm">+{formatCurrency(overshoot)}</DeltaChip>
              )}
            </div>
            <BurnRateChart
              actual={burnRate.actual}
              total={burnRate.total}
              targetTotal={burnRate.target}
              todayIdx={burnRate.todayIdx}
              overshootValue={overshoot}
              dayWord={t.dashboardPage.day}
            />
            <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
              <span>{t.dashboardPage.dayOne}</span>
              <span style={{ color: 'var(--accent)' }}>{t.today} · {burnRate.todayIdx + 1}</span>
              <span style={{ color: overshoot > 0 ? 'var(--warning)' : 'var(--text-3)' }}>{t.dashboardPage.day} {burnRate.total}</span>
            </div>
          </div>
        </Card>

        {/* ─── Budget Health (span 7, row 3) ─── */}
        <Card padding="lg" className="md:col-span-7">
          <div className="flex items-center justify-between gap-3 mb-5">
            <SectionLabel icon={<Wallet />}>{t.budgetHealth}</SectionLabel>
            {conservativeMode && <DeltaChip tone="warning" size="sm">{t.dashboardPage.conservative}</DeltaChip>}
          </div>

          <div className="flex items-baseline justify-between pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                {t.dashboardPage.thisMonthsIncome}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {t.avgIncome}: {formatCurrency(averageIncome)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[24px] font-semibold tabular-nums">{formatCurrency(effectiveIncome)}</div>
              <div className="mt-1">
                <DeltaChip tone={incomeDiffPct >= 0 ? 'positive' : 'negative'} size="sm">
                  {formatSignedPct(incomeDiffPct)} vs avg
                </DeltaChip>
              </div>
            </div>
          </div>

          <div
            className="mt-5 flex h-3 rounded-[4px] overflow-hidden"
            style={{ background: 'var(--bg-elev)' }}
            aria-label="Budget composition"
          >
            {budgetUsedPct > 0 && <div style={{ width: `${budgetUsedPct}%`, background: 'var(--teal)' }} />}
            {spentPct > 0 && <div style={{ width: `${spentPct}%`, background: 'var(--warning)' }} />}
            {availablePct > 0 && <div style={{ width: `${availablePct}%`, background: 'var(--positive)' }} />}
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <LegendItem dot="var(--teal)" name={t.fixedCosts} value={formatCurrency(totalFixedExpenses)} pct={`${budgetUsedPctRaw.toFixed(1)}%`} />
            <LegendItem dot="var(--warning)" name={t.monthSpent} value={formatCurrency(totalSpent)} pct={`${spentPctRaw.toFixed(1)}%`} />
            <LegendItem
              dot="var(--positive)"
              name={t.remainingBudget}
              value={formatCurrency(remainingBudget)}
              pct={`${remainingPctRaw.toFixed(1)}%`}
              valueColor={remainingBudget >= 0 ? 'var(--positive)' : 'var(--negative)'}
            />
          </div>

          <div className="mt-5 pt-4 border-t flex justify-between items-center" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
              <Zap size={12} />
              {t.dashboardPage.todaysRunningBalance}
            </div>
            <DeltaChip tone={todayBalance >= 0 ? 'positive' : 'negative'}>
              {todayBalance >= 0 ? '+' : ''}{formatCurrency(todayBalance)}
            </DeltaChip>
          </div>
        </Card>

        {/* ─── Asset Allocation (span 5, row 3) ─── */}
        <Card padding="lg" className="md:col-span-5">
          <div className="flex items-center justify-between gap-3 mb-5">
            <SectionLabel icon={<Home />}>{t.assetAllocation}</SectionLabel>
            <DeltaChip tone="muted" size="sm">{assetRows.length} {t.dashboardPage.holdings}</DeltaChip>
          </div>

          {assetRows.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              {t.dashboardPage.noAssets}
            </p>
          ) : (
            <div className="mb-4">
              {/* Horizontal allocation strip — top 4 holdings + "Annet" (replaces the donut) */}
              {(() => {
                const nonZero = assetRows.filter(r => r.value > 0);
                const head = nonZero.slice(0, 4);
                const rest = nonZero.slice(4);
                const strip = rest.length
                  ? [...head, { label: t.dashboardPage.other, value: rest.reduce((s, r) => s + r.value, 0), color: 'var(--text-dim)' }]
                  : head;
                return (
                  <div className="flex h-[30px] rounded-[4px] overflow-hidden border border-[var(--rule)]">
                    {strip.map((r, i) => {
                      const pct = allocationTotal > 0 ? (r.value / allocationTotal) * 100 : 0;
                      if (pct <= 0) return null;
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-center font-mono text-[10px]"
                          style={{ width: `${pct}%`, background: r.color, color: '#0E1310' }}
                          title={r.label}
                        >
                          {pct >= 10 ? `${pct.toFixed(0)}%` : ''}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <div className="mt-4 space-y-1">
                {assetRows.map((row, i) => {
                  const pct = allocationTotal > 0 ? (row.value / allocationTotal) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="grid items-center gap-2 text-[12px] px-2 py-1"
                      style={{ gridTemplateColumns: '14px 1fr auto auto' }}
                    >
                      <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: row.color }} />
                      <span className="truncate" style={{ color: 'var(--text-1)' }}>{row.label}</span>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>{pct.toFixed(0)}%</span>
                      <span className="font-mono font-medium tabular-nums">{formatCurrency(Math.round(row.value))}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-4 mt-4 border-t flex justify-between items-baseline" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11px] uppercase tracking-[0.1em] font-semibold" style={{ color: 'var(--text-3)' }}>
              {t.trueNetEquity}
            </span>
            <span className="text-[18px] font-bold tabular-nums">{formatCurrency(Math.round(netWorth))}</span>
          </div>
        </Card>

        {/* ─── Insight cards row (4 + 4 + 4) ─── */}

        {/* Insight 1 — Monthly investment bars */}
        <Card padding="md" className="md:col-span-4" glow="positive">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div
                className="w-9 h-9 rounded-[8px] grid place-items-center mb-3"
                style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
              >
                <ArrowUpRight size={18} />
              </div>
              <SectionLabel>{t.dashboardPage.monthlyInvestment}</SectionLabel>
              <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                {formatCurrency(recommendedInvestment)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {format(currentMonth, 'MMM')} · {Math.round(savingsTargetPercent)}% {t.dashboardPage.savingsRate}
              </div>
            </div>
          </div>

          <MonthlyInvestmentBars bars={investmentBars} />
          <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span>{investmentBars[0]?.label ?? ''}</span>
            <span>{investmentBars[Math.floor(investmentBars.length / 2)]?.label ?? ''}</span>
            <span>{investmentBars[investmentBars.length - 1]?.label ?? ''}</span>
          </div>
        </Card>

        {/* Insight 2 — Top categories MoM */}
        <Card padding="md" className="md:col-span-4" glow="warning">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div
                className="w-9 h-9 rounded-[8px] grid place-items-center mb-3"
                style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
              >
                <BarChart3 size={18} />
              </div>
              <SectionLabel>{t.dashboardPage.topCategories}</SectionLabel>
              <div className="text-[13px] mt-2" style={{ color: 'var(--text-2)' }}>
                {t.dashboardPage.vsLastMonth}
              </div>
            </div>
            <DeltaChip tone="warning" size="sm">{t.dashboardPage.mixed}</DeltaChip>
          </div>

          {categoryDeltas.length === 0 ? (
            <div className="mt-5 text-[12px] py-6 text-center" style={{ color: 'var(--text-3)' }}>
              {t.dashboardPage.noTransactionsYet}
            </div>
          ) : (
            <div className="mt-4 space-y-2.5 text-[12px]">
              {categoryDeltas.map((row, i) => {
                const colors = ['var(--warning)', 'var(--accent)', 'var(--pink)', 'var(--positive)', 'var(--text-3)'];
                return (
                  <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: '64px 1fr auto auto' }}>
                    <span className="truncate" style={{ color: 'var(--text-1)' }}>{row.category}</span>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
                      <div style={{ width: `${row.pctOfMax}%`, height: '100%', background: colors[i % colors.length], borderRadius: 999 }} />
                    </div>
                    <span className="font-semibold tabular-nums">{formatCurrencyShort(row.value)}</span>
                    {row.deltaPct === null ? (
                      <DeltaChip tone="muted" size="sm">·</DeltaChip>
                    ) : (
                      <DeltaChip tone={row.deltaPct < 0 ? 'positive' : 'negative'} size="sm">
                        {row.deltaPct > 0 ? '+' : ''}{row.deltaPct.toFixed(0)}%
                      </DeltaChip>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Insight 3 — 15-year projection */}
        <Card padding="md" className="md:col-span-4" glow="violet">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div
                className="w-9 h-9 rounded-[8px] grid place-items-center mb-3"
                style={{ background: 'var(--violet-bg)', color: 'var(--violet)' }}
              >
                <TrendingUp size={18} />
              </div>
              <SectionLabel>{t.dashboardPage.projection15y}</SectionLabel>
              <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                {formatCurrency(projectionEndValue)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {t.dashboardPage.projByPrefix} {projectionEndYear} {t.dashboardPage.projBySuffix}
              </div>
            </div>
            <DeltaChip tone="violet" size="sm">+{projectionGrowthPct}%</DeltaChip>
          </div>

          <ProjectionChart points={projection15y.map(p => ({ year: p.year, netWorth: p.total }))} />
          <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span>{projection15y[0]?.year ?? ''}</span>
            <span>{projection15y[Math.floor(projection15y.length / 2)]?.year ?? ''}</span>
            <span style={{ color: 'var(--violet)' }}>{projectionEndYear}</span>
          </div>
        </Card>

        {/* ─── Monthly cashflow (span 12) ─── */}
        <Card padding="md" className="md:col-span-12">
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionLabel icon={<Receipt />}>{t.charts.cashflowTitle}</SectionLabel>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{t.charts.cashflowSub}</span>
          </div>
          <div className="h-[240px] w-full mt-2">
            <Suspense fallback={<div className="h-full w-full" />}><CashflowChart /></Suspense>
          </div>
        </Card>

        {/* ─── Resilience row: emergency fund + debt-to-income (6 + 6) ─── */}

        {/* Emergency fund adequacy */}
        <Card padding="md" className="md:col-span-6" glow={emergencyFund.status === 'low' ? 'warning' : 'positive'}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className="w-9 h-9 rounded-[8px] grid place-items-center mb-3"
                style={{ background: 'var(--positive-bg, var(--bg-elev))', color: 'var(--positive)' }}
              >
                <LifeBuoy size={18} />
              </div>
              <SectionLabel>{t.dashboardPage.emergencyFund}</SectionLabel>
              {totalFixedExpenses <= 0 ? (
                <div className="text-[13px] mt-2" style={{ color: 'var(--text-3)' }}>
                  {t.dashboardPage.addFixedExpenses}
                </div>
              ) : (
                <div className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
                  {formatCurrency(assets.bufferAccount)} · {t.dashboardPage.target} {emergencyFund.minMonths}–{emergencyFund.targetMonths} {t.common.moAbbr}
                </div>
              )}
            </div>
            {totalFixedExpenses > 0 && (
              <DeltaChip
                tone={emergencyFund.status === 'low' ? 'warning' : 'positive'}
                size="sm"
              >
                {emergencyFund.status === 'low'
                  ? t.dashboardPage.low
                  : emergencyFund.status === 'adequate'
                    ? t.dashboardPage.ok
                    : t.dashboardPage.strong}
              </DeltaChip>
            )}
          </div>

          {totalFixedExpenses > 0 && (
            <>
              <div className="h-[140px] w-full mt-2">
                <Suspense fallback={<div className="h-full w-full" />}><EmergencyFundGauge /></Suspense>
              </div>
              <div className="text-[11px] text-center" style={{ color: 'var(--text-3)' }}>
                {emergencyFund.shortfallToMin > 0
                  ? `${formatCurrency(emergencyFund.shortfallToMin)} ${t.dashboardPage.shortOf} ${emergencyFund.minMonths} ${t.common.moAbbr}`
                  : t.dashboardPage.withinRange}
              </div>
            </>
          )}
        </Card>

        {/* Debt-to-income ratio */}
        <Card
          padding="md"
          className="md:col-span-6"
          glow={debtToIncome.status === 'high' ? 'warning' : 'positive'}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className="w-9 h-9 rounded-[8px] grid place-items-center mb-3"
                style={{ background: 'var(--violet-bg)', color: 'var(--violet)' }}
              >
                <Scale size={18} />
              </div>
              <SectionLabel>{t.dashboardPage.debtToIncome}</SectionLabel>
              {grossAnnualIncome <= 0 ? (
                <div className="text-[13px] mt-2" style={{ color: 'var(--text-3)' }}>
                  {t.dashboardPage.addSalary}
                </div>
              ) : (
                <>
                  <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                    {debtToIncome.ratio.toFixed(1)}× / {debtToIncome.cap}×
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {formatCurrency(assets.houseDebt + totalDebt)} {t.dashboardPage.debtWord} · {t.dashboardPage.gross} {formatCurrency(grossAnnualIncome)}
                  </div>
                </>
              )}
            </div>
            {grossAnnualIncome > 0 && (
              <DeltaChip
                tone={debtToIncome.status === 'high' ? 'negative' : debtToIncome.status === 'moderate' ? 'warning' : 'positive'}
                size="sm"
              >
                {debtToIncome.status === 'high'
                  ? t.dashboardPage.overCap
                  : debtToIncome.status === 'moderate'
                    ? t.dashboardPage.moderate
                    : t.dashboardPage.healthy}
              </DeltaChip>
            )}
          </div>

          {grossAnnualIncome > 0 && (
            <>
              <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (debtToIncome.ratio / debtToIncome.cap) * 100)}%`,
                    background: debtToIncome.status === 'high'
                      ? 'var(--negative)'
                      : debtToIncome.status === 'moderate' ? 'var(--warning)' : 'var(--positive)',
                  }}
                />
              </div>
              <div className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                {debtToIncome.status === 'high'
                  ? t.dashboardPage.aboveCapText
                  : `${formatCurrency(debtToIncome.borrowingHeadroom)} ${t.dashboardPage.headroomPrefix} ${debtToIncome.cap}${t.dashboardPage.capSuffix}`}
              </div>
            </>
          )}
        </Card>

        {/* ─── Goals (span 12) ─── */}
        <div className="md:col-span-12">
          <GoalsSection />
        </div>

        {/* ─── Recent Transactions (span 12) ─── */}
        <Card padding="none" className="md:col-span-12">
          <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3 border-b flex-wrap" style={{ borderColor: 'var(--border)' }}>
            <SectionLabel icon={<Receipt />}>{t.recentTransactions}</SectionLabel>
            <div className="flex gap-1.5">
              <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
                {t.dashboardPage.all}
              </FilterPill>
              <FilterPill active={filter === 'income'} onClick={() => setFilter('income')}>
                {t.dashboardPage.income}
              </FilterPill>
              <FilterPill active={filter === 'expense'} onClick={() => setFilter('expense')}>
                {t.dashboardPage.expense}
              </FilterPill>
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              {t.noTransactions}
            </div>
          ) : (
            <div>
              {recentTransactions.map(tx => {
                const date = new Date(tx.date + 'T00:00:00');
                const isIncome = tx.kind === 'income';
                return (
                  <div
                    key={tx.id}
                    className="px-6 py-3.5 grid items-center gap-3 border-b last:border-0 transition-colors hover:bg-[rgba(255,255,255,0.025)]"
                    style={{
                      gridTemplateColumns: '44px 1fr auto auto',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-[8px] border grid place-items-center text-[13px] font-semibold tabular-nums"
                      style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
                    >
                      {format(date, 'dd')}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium truncate">{txDisplayName(tx, labelRules)}</div>
                      <div className="text-[11px] flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                        {format(date, 'EEEE, dd MMM')}
                        <AccountBadge tx={tx} size="xs" />
                      </div>
                    </div>
                    {tx.category && (
                      <DeltaChip tone={isIncome ? 'positive' : 'muted'} size="sm">
                        {tx.category}
                      </DeltaChip>
                    )}
                    <span className="text-[14px] font-semibold tabular-nums shrink-0" style={{ color: isIncome ? 'var(--positive)' : 'var(--negative)' }}>
                      {isIncome ? '+' : '−'}{formatCurrency(tx.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {historyOpen && (
        <NetWorthHistoryModal
          series={netWorthSeries}
          formatCurrency={formatCurrency}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// ─── Inline chart components ───────────────────────────────────
// ─────────────────────────────────────────────────────────────────

function HeroChart({
  history,
  formatCurrency,
}: {
  history: { label: string; value: number; estimated: boolean }[];
  formatCurrency: (n: number) => string;
}) {
  if (history.length < 2) {
    return <div className="h-[160px] grid place-items-center text-[12px]" style={{ color: 'var(--text-3)' }}>—</div>;
  }
  const values = history.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || 1) * 0.14;
  const lastI = history.length - 1;
  const last = history[lastI];
  // Clean, rounded value for the NOW marker (drops a trailing ,00 / .00).
  const fmtNice = (v: number) => formatCurrency(Math.round(v)).replace(/[.,]00(?=\D*$)/, '');

  return (
    <div className="w-full h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{ top: 12, right: 64, left: 8, bottom: 8 }}>
          <defs>
            <linearGradient id="heroAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.forestLight} stopOpacity={0.1} />
              <stop offset="100%" stopColor={CHART.forestLight} stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={CHART.track} />
          <XAxis dataKey="label" hide />
          <YAxis hide domain={[min - pad, max + pad]} />
          <Tooltip
            cursor={{ stroke: CHART.forestLight, strokeOpacity: 0.25, strokeWidth: 1 }}
            content={<ChartTooltip />}
          />
          <Area
            name=""
            type="monotone"
            dataKey="value"
            stroke={CHART.forestLight}
            strokeWidth={2}
            fill="url(#heroAreaGrad)"
            isAnimationActive={false}
            dot={(props) => {
              const { cx, cy, index, payload } = props as {
                cx: number; cy: number; index: number; payload: { estimated: boolean };
              };
              // The final (NOW) point is drawn by the ReferenceDot below.
              if (index === lastI) return <g key={`d-${index}`} />;
              const est = payload.estimated;
              return (
                <circle
                  key={`d-${index}`}
                  cx={cx} cy={cy} r={3.5}
                  fill={est ? CHART.bgCard : CHART.forestLight}
                  stroke={CHART.forestLight}
                  strokeWidth={1.5}
                  opacity={est ? 0.5 : 0.95}
                />
              );
            }}
            activeDot={{ r: 5, fill: CHART.forestLight, stroke: CHART.bgCard, strokeWidth: 2 }}
          />
          {/* NOW marker — filled dot with a ring + persistent value label */}
          <ReferenceDot
            x={last.label}
            y={last.value}
            r={6}
            fill={CHART.forestLight}
            stroke={CHART.bgCard}
            strokeWidth={4}
            label={{
              value: fmtNice(last.value),
              position: 'right',
              fill: CHART.text1,
              fontSize: 12,
              fontWeight: 600,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BurnRateChart({
  actual,
  total,
  targetTotal,
  todayIdx,
  overshootValue,
  dayWord,
}: {
  actual: number[];
  total: number;
  targetTotal: number;
  todayIdx: number;
  overshootValue: number;
  dayWord: string;
}) {
  const safeTotal = Math.max(total, 2);
  const lastActual = actual[actual.length - 1] ?? 0;
  // Ensure a non-zero Y-domain even with empty data so the axis doesn't collapse.
  const maxCum = Math.max(targetTotal, lastActual, 100);

  // One row per day of the month; cumulative actual only up to today, null after
  // so the line stops at the current day.
  const data = Array.from({ length: safeTotal }, (_, i) => ({
    day: i + 1,
    actual: i < actual.length ? actual[i] : null,
  }));

  const todayDay = todayIdx + 1;
  const dailyAvg = todayIdx > 0 ? lastActual / (todayIdx + 1) : 0;
  const projectedFinal = Math.min(dailyAvg * safeTotal, maxCum);
  const projWillOvershoot = overshootValue > 0 && lastActual > 0;

  return (
    <div className="w-full h-[80px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 2 }}>
          <defs>
            <linearGradient id="spendAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.forestLight} stopOpacity={0.1} />
              <stop offset="100%" stopColor={CHART.forestLight} stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 3" vertical={false} stroke={CHART.track} />
          <XAxis dataKey="day" type="category" hide />
          <YAxis hide domain={[0, maxCum]} />
          <Tooltip
            cursor={{ stroke: CHART.forestLight, strokeDasharray: '2 3', strokeOpacity: 0.6 }}
            content={<ChartTooltip labelFormatter={(d) => `${dayWord} ${d}`} />}
          />
          {/* ideal pace — straight line from day 1 (nothing spent) to the budget */}
          <ReferenceLine
            segment={[{ x: 1, y: 0 }, { x: safeTotal, y: targetTotal }]}
            stroke={CHART.slate}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {/* projected finish if the current pace overshoots */}
          {projWillOvershoot && (
            <ReferenceLine
              segment={[{ x: todayDay, y: lastActual }, { x: safeTotal, y: projectedFinal }]}
              stroke={CHART.brass}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}
          {/* today marker */}
          <ReferenceLine x={todayDay} stroke={CHART.forestLight} strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.5} />
          <Area
            name=""
            type="monotone"
            dataKey="actual"
            connectNulls={false}
            stroke={CHART.forestLight}
            strokeWidth={2}
            fill="url(#spendAreaGrad)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: CHART.forestLight, stroke: CHART.bgCard, strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyInvestmentBars({ bars }: { bars: { key: string; label: string; value: number; projected?: boolean }[] }) {
  if (bars.length === 0) return <div className="h-[80px]" />;
  // If there are fewer than 4 real months, project forward to fill out to ~6 bars
  // so the chart doesn't look anemic.
  const realBars = bars.filter(b => !b.projected);
  const baseVal = realBars[realBars.length - 1]?.value ?? bars[0]?.value ?? 0;
  const display = [...bars];
  if (realBars.length < 4 && baseVal > 0) {
    const projCount = Math.max(0, 6 - bars.length);
    for (let i = 1; i <= projCount; i++) {
      display.push({
        key: `proj-extra-${i}`,
        label: '',
        value: Math.round(baseVal * Math.pow(1.02, i + (bars.length - realBars.length))),
        projected: true,
      });
    }
  }

  const max = Math.max(...display.map(b => b.value)) || 1;
  const target = max * 0.85;
  const todayIdx = realBars.length - 1;

  return (
    <div className="w-full h-[80px] mt-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={display} margin={{ top: 4, right: 2, left: 2, bottom: 2 }} barCategoryGap="20%">
          <XAxis dataKey="label" type="category" hide />
          <YAxis hide domain={[0, max]} />
          <Tooltip cursor={{ fill: CHART.track }} content={<ChartTooltip />} />
          {/* target gridline */}
          <ReferenceLine y={target} stroke={CHART.grid} strokeDasharray="2 3" />
          <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {display.map((b, i) => {
              const active = i === todayIdx;
              const opacity = Math.min(1, 0.55 + (i / display.length) * 0.45);
              return (
                <Cell
                  key={b.key}
                  fill={b.projected ? 'none' : CHART.forestLight}
                  fillOpacity={b.projected ? 0 : (active ? 1 : opacity)}
                  stroke={b.projected ? CHART.forestLight : undefined}
                  strokeWidth={b.projected ? 1 : 0}
                  strokeDasharray={b.projected ? '2 2' : undefined}
                  strokeOpacity={b.projected ? 0.6 : undefined}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProjectionChart({ points }: { points: { year: number; netWorth: number }[] }) {
  if (points.length < 2) return <div className="h-[80px]" />;
  const values = points.map(p => p.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || 1) * 0.08;
  const lastI = points.length - 1;

  return (
    <div className="w-full h-[80px] mt-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 4, left: 4, bottom: 2 }}>
          <defs>
            <linearGradient id="projAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.teal} stopOpacity={0.12} />
              <stop offset="100%" stopColor={CHART.teal} stopOpacity={0.12} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 3" vertical={false} stroke={CHART.track} />
          <XAxis dataKey="year" type="category" hide />
          <YAxis hide domain={[min - pad, max + pad]} />
          <Tooltip
            cursor={{ stroke: CHART.teal, strokeDasharray: '2 3', strokeOpacity: 0.6 }}
            content={<ChartTooltip labelFormatter={(y) => String(y)} />}
          />
          <Area
            name=""
            type="monotone"
            dataKey="netWorth"
            stroke={CHART.teal}
            strokeWidth={1.8}
            fill="url(#projAreaGrad)"
            isAnimationActive={false}
            dot={(props) => {
              const { cx, cy, index } = props as { cx: number; cy: number; index: number };
              const endpoint = index === 0 || index === lastI;
              return (
                <circle
                  key={`d-${index}`}
                  cx={cx} cy={cy}
                  r={endpoint ? 3 : 2}
                  fill={CHART.bgCard}
                  stroke={index === lastI ? CHART.teal : CHART.forestLight}
                  strokeWidth={1.5}
                  opacity={endpoint ? 1 : 0.5}
                />
              );
            }}
            activeDot={{ r: 5, fill: CHART.teal, stroke: CHART.bgCard, strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Small helpers ───
function LegendItem({
  dot,
  name,
  value,
  pct,
  valueColor,
}: {
  dot: string;
  name: string;
  value: string;
  pct: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
        <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{name}</span>
      </div>
      <div className="text-[16px] font-semibold tabular-nums" style={{ color: valueColor ?? 'var(--text-1)' }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{pct}</div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 px-3 rounded-[6px] text-[11px] font-medium border transition-colors cursor-pointer"
      style={{
        background: active ? 'var(--bg-3)' : 'var(--bg-2)',
        borderColor: active ? 'var(--brass-dim)' : 'var(--border)',
        color: active ? 'var(--brass)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}

export default DashboardPage;
