import React, { useMemo, useState } from 'react';
import {
  TrendingUp, Wallet, Home, Zap, PiggyBank, BarChart2, Bitcoin, Shield, Receipt,
  ArrowUpRight, BarChart3, LifeBuoy, Scale, Pencil, AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, parse, format as fmtDate, subMonths } from 'date-fns';
import { useFinance, DEFAULT_GROWTH_RATES, DEFAULT_TAX_RATES } from '../context/FinanceContext';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { DeltaChip } from '../components/ui/DeltaChip';
import NetWorthHistoryModal from '../components/NetWorthHistoryModal';
import {
  calcNetWorthProjectionByBucket, calcHouseEquityByYear,
  calcEmergencyFundStatus, calcDebtToIncome,
} from '../lib/calculations';
import GoalsSection from '../components/GoalsSection';

const DashboardPage: React.FC = () => {
  const {
    t,
    lang,
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
    monthlyIncomes,
    currentMonth,
    totalEquity,
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
  } = useFinance();

  // ─── Derived numbers ───
  const totalSpent = dailyData.reduce((sum, d) => sum + d.spent, 0);
  const monthEndSurplus = dailyData[dailyData.length - 1]?.balance ?? 0;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayEntry = dailyData.find(d => d.dateStr === todayStr);
  const todayBalance = todayEntry?.balance ?? monthEndSurplus;

  const budgetUsedPct = effectiveIncome > 0 ? Math.min(100, (totalFixedExpenses / effectiveIncome) * 100) : 0;
  const spentPct = effectiveIncome > 0 ? Math.min(100 - budgetUsedPct, (totalSpent / effectiveIncome) * 100) : 0;
  const availablePct = Math.max(0, 100 - budgetUsedPct - spentPct);
  const incomeDiffPct = averageIncome > 0 ? ((effectiveIncome - averageIncome) / averageIncome) * 100 : 0;
  const incomeDelta = prevMonthIncome > 0 ? ((effectiveIncome - prevMonthIncome) / prevMonthIncome) * 100 : null;
  const spendingDelta = prevMonthSpending > 0 ? ((totalSpent - prevMonthSpending) / prevMonthSpending) * 100 : null;

  // ─── Financial-resilience metrics ───
  const emergencyFund = calcEmergencyFundStatus(assets.bufferAccount, totalFixedExpenses);
  const debtToIncome = calcDebtToIncome(assets.houseDebt, grossAnnualIncome);

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

    // Known anchor values per grid index (current month = live equity).
    const values: (number | null)[] = monthKeys.map((k, i) => {
      if (i === 11) return netWorthHistory[k] ?? Math.round(totalEquity);
      return netWorthHistory[k] ?? null;
    });
    const anchorIdx = values.flatMap((v, i) => (v !== null ? [i] : []));

    const monthlyGrowth = 1.005; // ~6% annual, for back-projecting leading gaps
    const series = monthKeys.map((monthKey, i) => {
      if (values[i] !== null) return { monthKey, value: values[i] as number, estimated: false };

      const prev = anchorIdx.filter(a => a < i).pop();
      const next = anchorIdx.find(a => a > i);
      let value: number;
      if (prev !== undefined && next !== undefined) {
        // Linear interpolation between the surrounding anchors.
        const t = (i - prev) / (next - prev);
        value = (values[prev] as number) + ((values[next] as number) - (values[prev] as number)) * t;
      } else if (next !== undefined) {
        // Leading gap → gentle back-projection from the first anchor.
        value = (values[next] as number) / Math.pow(monthlyGrowth, next - i);
      } else {
        // Trailing gap (only if no later anchor) → carry the previous value.
        value = values[prev as number] as number;
      }
      return { monthKey, value: Math.round(value), estimated: true };
    });

    return { netWorthSeries: series, isEstimated: series.some(p => p.estimated) };
  }, [netWorthHistory, totalEquity]);

  const annualSavings = Math.max(0, recommendedInvestment * 12);
  const cashStart = assets.savings + assets.bsu + assets.bufferAccount;
  const projectionRates = { stocks: growthReturnRate, crypto: cryptoGrowthRate, cash: cashGrowthRate, house: houseGrowthRate };
  const projectionStart = { stocks: netInvestment, crypto: netCrypto, cash: cashStart, house: houseEquity };
  const houseByYear = calcHouseEquityByYear(assets.houseValue, assets.houseDebt, houseGrowthRate, mortgageRate, mortgageTermYears, 15);

  // ─── Assets ───
  const assetRows = useMemo(() => [
    { label: t.investmentNet, value: Math.max(0, netInvestment), icon: <BarChart2 size={14} />, color: 'var(--chart-1)' },
    { label: t.propertyEquity, value: Math.max(0, houseEquity), icon: <Home size={14} />, color: 'var(--chart-2)' },
    { label: lang === 'nb' ? 'Krypto (netto)' : 'Crypto (net)', value: Math.max(0, netCrypto), icon: <Bitcoin size={14} />, color: 'var(--chart-4)' },
    { label: t.bsu, value: assets.bsu, icon: <Shield size={14} />, color: 'var(--chart-3)' },
    { label: t.savings, value: assets.savings, icon: <PiggyBank size={14} />, color: 'var(--chart-5)' },
    { label: t.bufferAccount, value: assets.bufferAccount, icon: <Wallet size={14} />, color: 'var(--chart-6)' },
  ].filter(r => r.value > 0), [netInvestment, houseEquity, netCrypto, assets, lang, t]);

  // ─── Recent transactions ───
  type FilterMode = 'all' | 'income' | 'expense' | 'fixed';
  const [filter, setFilter] = useState<FilterMode>('all');
  const [historyOpen, setHistoryOpen] = useState(false);
  const recentTransactions = useMemo(() => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    let list = [...dailyTransactions]
      .filter(tx => tx.date.startsWith(monthStr))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (filter === 'income') list = list.filter(tx => (tx.category ?? '').toLowerCase().includes('inntekt'));
    else if (filter === 'expense') list = list.filter(tx => !(tx.category ?? '').toLowerCase().includes('inntekt'));
    return list.slice(0, 7);
  }, [dailyTransactions, currentMonth, filter]);

  // ─── Insight 1: monthly investment bar chart (12 months + 2 projected) ───
  const investmentBars = useMemo(() => {
    const months: { key: string; label: string; value: number; projected?: boolean }[] = [];
    const sorted = Object.keys(monthlyIncomes).sort();
    const last12 = sorted.slice(-12);
    last12.forEach(k => {
      const v = monthlyIncomes[k] * (savingsTargetPercent / 100);
      const d = parse(k, 'yyyy-MM', new Date());
      months.push({ key: k, label: fmtDate(d, 'MMM'), value: Math.round(v) });
    });
    // 2 projected months ahead
    if (last12.length > 0) {
      const lastKey = last12[last12.length - 1];
      const baseVal = monthlyIncomes[lastKey] * (savingsTargetPercent / 100);
      for (let i = 1; i <= 2; i++) {
        const d = parse(lastKey, 'yyyy-MM', new Date());
        d.setMonth(d.getMonth() + i);
        months.push({ key: `proj-${i}`, label: fmtDate(d, 'MMM'), value: Math.round(baseVal * 1.02 ** i), projected: true });
      }
    }
    return months;
  }, [monthlyIncomes, savingsTargetPercent]);

  // ─── Insight 2: top categories MoM ───
  const categoryDeltas = useMemo(() => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    const prevMonthStr = format(subMonths(currentMonth, 1), 'yyyy-MM');
    const groupBy = (predicate: (m: string) => boolean) => {
      const map = new Map<string, number>();
      dailyTransactions
        .filter(tx => predicate(tx.date))
        .forEach(tx => {
          const cat = tx.category || (lang === 'nb' ? 'Annet' : 'Other');
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
  }, [dailyTransactions, currentMonth, lang]);

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
    upToToday.forEach(d => { running += d.spent; cumulative.push(running); });
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
    if (lang === 'nb') {
      const parts: string[] = [];
      if (incomeDelta !== null) {
        parts.push(`Netto egenkapital ${incomeDelta >= 0 ? 'opp' : 'ned'} ${Math.abs(incomeDelta).toFixed(1)}% denne måneden`);
      }
      if (monthlyBudget > 0 && totalSpent > 0) {
        const usagePct = (totalSpent / monthlyBudget) * 100;
        parts.push(`du har brukt ${usagePct.toFixed(0)}% av månedens forbruksbudsjett`);
      }
      return parts.length ? parts.join('. ') + '.' : 'Du er i gang. Legg til transaksjoner for å se trender.';
    }
    const parts: string[] = [];
    if (incomeDelta !== null) {
      parts.push(`Net equity ${incomeDelta >= 0 ? 'up' : 'down'} ${Math.abs(incomeDelta).toFixed(1)}% this month`);
    }
    if (monthlyBudget > 0 && totalSpent > 0) {
      const usagePct = (totalSpent / monthlyBudget) * 100;
      parts.push(`you've used ${usagePct.toFixed(0)}% of this month's spending budget`);
    }
    return parts.length ? parts.join('. ') + '.' : "You're set up. Log some transactions to see trends.";
  }, [incomeDelta, monthlyBudget, totalSpent, lang]);

  // ── Render ──
  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {lang === 'nb' ? 'God dag' : 'Good afternoon'}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {lang === 'nb' ? (
            <>Pengene dine har <em className="italic" style={{ color: 'var(--brass)' }}>headroom</em>.<br className="hidden md:inline" /> Her er status.</>
          ) : (
            <>Your money has <em className="italic" style={{ color: 'var(--brass)' }}>headroom</em>.<br className="hidden md:inline" /> Here's the state of things.</>
          )}
        </h1>
        <p className="mt-4 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {subtitle}
        </p>
      </header>

      {/* Defaults nudge — market assumptions still untuned */}
      {defaultAssumptions > 0 && (
        <Link
          to="/settings"
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius-md)] border text-[13px] transition-opacity hover:opacity-90"
          style={{ background: 'var(--warning-bg)', borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)', color: 'var(--warning)' }}
        >
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="[overflow-wrap:anywhere]">
              {lang === 'nb'
                ? `${defaultAssumptions} av 6 markedsforutsetninger bruker fortsatt standardverdier — juster dem for mer presise prognoser.`
                : `${defaultAssumptions} of 6 market assumptions still use default values — tune them for sharper projections.`}
            </span>
          </span>
          <span className="shrink-0 font-semibold inline-flex items-center gap-1">
            {lang === 'nb' ? 'Innstillinger' : 'Review'}
            <ArrowUpRight size={14} />
          </span>
        </Link>
      )}

      {/* Bento grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 auto-rows-min gap-3 md:gap-4">

        {/* ─── HERO: Net Equity (span 7, row 1) ─── */}
        <Card variant="hero" padding="lg" className="md:col-span-7 md:row-span-2 flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel icon={<TrendingUp />}>{t.totalEquity}</SectionLabel>
            {incomeDelta !== null && (
              <DeltaChip tone={incomeDelta >= 0 ? 'positive' : 'negative'} showArrow>
                {(incomeDelta >= 0 ? '+' : '') + incomeDelta.toFixed(1)}% MoM
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
            {formatCurrency(totalEquity)}
          </div>
          <div className="text-[13px] mt-2" style={{ color: 'var(--text-2)' }}>
            {lang === 'nb' ? 'Etter skatt, alle kontoer og formuesverdier' : 'Post-tax, all accounts & assets'}
          </div>

          {/* Stat row */}
          <div className="mt-5 flex gap-6 flex-wrap">
            <div className="pl-3 border-l-2" style={{ borderColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
              <div className="text-[16px] font-semibold tabular-nums">
                {netWorthSeries.length >= 2
                  ? formatCurrency(netWorthSeries[netWorthSeries.length - 1].value - netWorthSeries[0].value)
                  : '—'}
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] mt-1" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb' ? '12-mnd endring' : '12-month change'}
              </div>
            </div>
            <div className="pl-3 border-l-2" style={{ borderColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
              <div className="text-[16px] font-semibold tabular-nums" style={{ color: 'var(--positive)' }}>
                +{growthReturnRate.toFixed(1)}%
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] mt-1" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb' ? 'Forventet avkastning' : 'Expected return'}
              </div>
            </div>
            <div className="pl-3 border-l-2" style={{ borderColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
              <div className="text-[16px] font-semibold tabular-nums">
                {projectionEndYear ?? '—'}
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] mt-1" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb' ? 'Målår' : 'Target year'}
              </div>
            </div>
          </div>

          {/* Hero chart — clean 12-month actual net-equity trend */}
          <div className="mt-6 rounded-[8px] border p-4" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>
              <div className="flex items-center gap-2">
                <span>{lang === 'nb' ? 'Netto egenkapital · siste 12 mnd' : 'Net equity · last 12 months'}</span>
                {isEstimated && (
                  <span
                    className="px-2 py-0.5 rounded-[4px] normal-case tracking-normal text-[10px]"
                    style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
                  >
                    {lang === 'nb' ? 'estimert' : 'estimated'}
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
                <span style={{ color: 'var(--accent)' }}>{lang === 'nb' ? 'I dag' : 'Today'}</span>
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
            <SectionLabel icon={<Receipt />}>{lang === 'nb' ? 'Restbeløp / mnd' : 'Monthly Residual'}</SectionLabel>
            {incomeDelta !== null && (
              <DeltaChip tone={incomeDelta >= 0 ? 'positive' : 'negative'} size="sm">
                {(incomeDelta >= 0 ? '+' : '') + incomeDelta.toFixed(1)}%
              </DeltaChip>
            )}
          </div>
          <div className="font-semibold tracking-[-0.02em] leading-none mt-3 text-[32px]" style={{ color: totalResidual < 0 ? 'var(--negative)' : 'var(--text-1)' }}>
            {formatCurrency(totalResidual)}
          </div>
          <div className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>
            {lang === 'nb' ? 'Etter faste utgifter' : 'After fixed expenses'}
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
            {lang === 'nb' ? 'Anbefalt forbruk' : 'Recommended spending'}
            {spendingDelta !== null && (
              <span className="ml-2">
                · {(spendingDelta >= 0 ? '+' : '') + spendingDelta.toFixed(1)}% {t.vsLastMonth}
              </span>
            )}
          </div>
          <div className="mt-4 rounded-[8px] border p-3" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-3 text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>
                <span><span className="inline-block w-2 h-0.5 mr-1.5 align-middle" style={{ background: 'var(--accent)' }} /> {lang === 'nb' ? 'Faktisk' : 'Actual'}</span>
                <span><span className="inline-block w-2 h-px mr-1.5 align-middle border-t border-dashed" style={{ borderColor: 'var(--text-3)' }} /> {lang === 'nb' ? 'Ideell takt' : 'Ideal pace'}</span>
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
              formatCurrency={formatCurrency}
              lang={lang}
            />
            <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
              <span>{lang === 'nb' ? 'Dag 1' : 'Day 1'}</span>
              <span style={{ color: 'var(--accent)' }}>{lang === 'nb' ? `I dag · ${burnRate.todayIdx + 1}` : `Today · ${burnRate.todayIdx + 1}`}</span>
              <span style={{ color: overshoot > 0 ? 'var(--warning)' : 'var(--text-3)' }}>{lang === 'nb' ? `Dag ${burnRate.total}` : `Day ${burnRate.total}`}</span>
            </div>
          </div>
        </Card>

        {/* ─── Budget Health (span 7, row 3) ─── */}
        <Card padding="lg" className="md:col-span-7">
          <div className="flex items-center justify-between gap-3 mb-5">
            <SectionLabel icon={<Wallet />}>{t.budgetHealth}</SectionLabel>
            {conservativeMode && <DeltaChip tone="warning" size="sm">{lang === 'nb' ? 'Sparemodus' : 'Conservative'}</DeltaChip>}
          </div>

          <div className="flex items-baseline justify-between pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                {lang === 'nb' ? 'Inntekt denne måneden' : "This month's income"}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {t.avgIncome}: {formatCurrency(averageIncome)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[24px] font-semibold tabular-nums">{formatCurrency(effectiveIncome)}</div>
              <div className="mt-1">
                <DeltaChip tone={incomeDiffPct >= 0 ? 'positive' : 'negative'} size="sm">
                  {incomeDiffPct >= 0 ? '+' : ''}{incomeDiffPct.toFixed(1)}% vs avg
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

          <div className="mt-5 grid grid-cols-3 gap-4">
            <LegendItem dot="var(--teal)" name={t.fixedCosts} value={formatCurrency(totalFixedExpenses)} pct={`${budgetUsedPct.toFixed(1)}%`} />
            <LegendItem dot="var(--warning)" name={t.monthSpent} value={formatCurrency(totalSpent)} pct={`${spentPct.toFixed(1)}%`} />
            <LegendItem
              dot="var(--positive)"
              name={t.remainingBudget}
              value={formatCurrency(monthEndSurplus)}
              pct={`${availablePct.toFixed(1)}%`}
              valueColor={monthEndSurplus >= 0 ? 'var(--positive)' : 'var(--negative)'}
            />
          </div>

          <div className="mt-5 pt-4 border-t flex justify-between items-center" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
              <Zap size={12} />
              {lang === 'nb' ? 'Daglig balanse i dag' : "Today's running balance"}
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
            <DeltaChip tone="muted" size="sm">{assetRows.length} {lang === 'nb' ? 'eiendeler' : 'holdings'}</DeltaChip>
          </div>

          {assetRows.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              {lang === 'nb' ? 'Ingen formuesverdier registrert enda.' : 'No assets recorded yet.'}
            </p>
          ) : (
            <div className="mb-4">
              {/* Horizontal allocation strip — top 4 holdings + "Annet" (replaces the donut) */}
              {(() => {
                const nonZero = assetRows.filter(r => r.value > 0);
                const head = nonZero.slice(0, 4);
                const rest = nonZero.slice(4);
                const strip = rest.length
                  ? [...head, { label: lang === 'nb' ? 'Annet' : 'Other', value: rest.reduce((s, r) => s + r.value, 0), color: 'var(--text-dim)' }]
                  : head;
                const stripTotal = strip.reduce((s, r) => s + r.value, 0);
                return (
                  <div className="flex h-[30px] rounded-[4px] overflow-hidden border border-[var(--rule)]">
                    {strip.map((r, i) => {
                      const pct = stripTotal > 0 ? (r.value / stripTotal) * 100 : 0;
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
                  const pct = totalEquity > 0 ? (row.value / totalEquity) * 100 : 0;
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
            <span className="text-[18px] font-bold tabular-nums">{formatCurrency(Math.round(totalEquity))}</span>
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
              <SectionLabel>{lang === 'nb' ? 'Månedlig investering' : 'Monthly investment'}</SectionLabel>
              <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                {formatCurrency(recommendedInvestment)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb' ? `April · ${Math.round(savingsTargetPercent)}% mål nådd` : `${Math.round(savingsTargetPercent)}% target hit`}
              </div>
            </div>
            <DeltaChip tone="positive" size="sm">+{Math.round(savingsTargetPercent)}%</DeltaChip>
          </div>

          <MonthlyInvestmentBars bars={investmentBars} formatCurrency={formatCurrency} />
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
              <SectionLabel>{lang === 'nb' ? 'Toppkategorier' : 'Top categories'}</SectionLabel>
              <div className="text-[13px] mt-2" style={{ color: 'var(--text-2)' }}>
                {lang === 'nb' ? 'vs forrige måned' : 'vs last month'}
              </div>
            </div>
            <DeltaChip tone="warning" size="sm">{lang === 'nb' ? 'Blandet' : 'Mixed'}</DeltaChip>
          </div>

          {categoryDeltas.length === 0 ? (
            <div className="mt-5 text-[12px] py-6 text-center" style={{ color: 'var(--text-3)' }}>
              {lang === 'nb' ? 'Ingen transaksjoner enda' : 'No transactions yet'}
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
              <SectionLabel>{lang === 'nb' ? '15-års projeksjon' : '15-year projection'}</SectionLabel>
              <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                {formatCurrency(projectionEndValue)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb' ? `i ${projectionEndYear} · blandet vekstrate per aktivaklasse` : `by ${projectionEndYear} · blended per-bucket rates`}
              </div>
            </div>
            <DeltaChip tone="violet" size="sm">+{projectionGrowthPct}%</DeltaChip>
          </div>

          <ProjectionChart points={projection15y.map(p => ({ year: p.year, netWorth: p.total }))} formatCurrency={formatCurrency} />
          <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span>{projection15y[0]?.year ?? ''}</span>
            <span>{projection15y[Math.floor(projection15y.length / 2)]?.year ?? ''}</span>
            <span style={{ color: 'var(--violet)' }}>{projectionEndYear}</span>
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
              <SectionLabel>{lang === 'nb' ? 'Bufferkonto' : 'Emergency fund'}</SectionLabel>
              {totalFixedExpenses <= 0 ? (
                <div className="text-[13px] mt-2" style={{ color: 'var(--text-3)' }}>
                  {lang === 'nb'
                    ? 'Legg inn faste utgifter for å se dekning.'
                    : 'Add fixed expenses to see coverage.'}
                </div>
              ) : (
                <>
                  <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                    {emergencyFund.monthsCovered.toFixed(1)} {lang === 'nb' ? 'mnd' : 'mo'}
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {formatCurrency(assets.bufferAccount)} · {lang === 'nb' ? 'mål' : 'target'} {emergencyFund.minMonths}–{emergencyFund.targetMonths} {lang === 'nb' ? 'mnd' : 'mo'}
                  </div>
                </>
              )}
            </div>
            {totalFixedExpenses > 0 && (
              <DeltaChip
                tone={emergencyFund.status === 'low' ? 'warning' : 'positive'}
                size="sm"
              >
                {emergencyFund.status === 'low'
                  ? (lang === 'nb' ? 'Lav' : 'Low')
                  : emergencyFund.status === 'adequate'
                    ? (lang === 'nb' ? 'OK' : 'OK')
                    : (lang === 'nb' ? 'Solid' : 'Strong')}
              </DeltaChip>
            )}
          </div>

          {totalFixedExpenses > 0 && (
            <>
              <div className="mt-4 relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (emergencyFund.monthsCovered / emergencyFund.targetMonths) * 100)}%`,
                    background: emergencyFund.status === 'low' ? 'var(--warning)' : 'var(--positive)',
                  }}
                />
                {/* recommended-minimum marker */}
                <div
                  className="absolute top-0 h-full w-px"
                  style={{ left: `${(emergencyFund.minMonths / emergencyFund.targetMonths) * 100}%`, background: 'var(--text-3)' }}
                />
              </div>
              <div className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                {emergencyFund.shortfallToMin > 0
                  ? (lang === 'nb'
                      ? `${formatCurrency(emergencyFund.shortfallToMin)} unna ${emergencyFund.minMonths} mnd`
                      : `${formatCurrency(emergencyFund.shortfallToMin)} short of ${emergencyFund.minMonths} mo`)
                  : (lang === 'nb' ? 'Innenfor anbefalt nivå' : 'Within recommended range')}
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
              <SectionLabel>{lang === 'nb' ? 'Gjeldsgrad' : 'Debt-to-income'}</SectionLabel>
              {grossAnnualIncome <= 0 ? (
                <div className="text-[13px] mt-2" style={{ color: 'var(--text-3)' }}>
                  {lang === 'nb'
                    ? 'Legg inn lønn for å se gjeldsgrad.'
                    : 'Add salary to see your ratio.'}
                </div>
              ) : (
                <>
                  <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                    {debtToIncome.ratio.toFixed(1)}× / {debtToIncome.cap}×
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {formatCurrency(assets.houseDebt)} {lang === 'nb' ? 'gjeld' : 'debt'} · {lang === 'nb' ? 'brutto' : 'gross'} {formatCurrency(grossAnnualIncome)}
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
                  ? (lang === 'nb' ? 'Over grense' : 'Over cap')
                  : debtToIncome.status === 'moderate'
                    ? (lang === 'nb' ? 'Moderat' : 'Moderate')
                    : (lang === 'nb' ? 'Sunn' : 'Healthy')}
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
                  ? (lang === 'nb'
                      ? 'Over utlånsforskriftens grense på 5×'
                      : 'Above the 5× lending-rule cap')
                  : (lang === 'nb'
                      ? `${formatCurrency(debtToIncome.borrowingHeadroom)} igjen til ${debtToIncome.cap}×-grensen`
                      : `${formatCurrency(debtToIncome.borrowingHeadroom)} headroom to the ${debtToIncome.cap}× cap`)}
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
                {lang === 'nb' ? 'Alle' : 'All'}
              </FilterPill>
              <FilterPill active={filter === 'income'} onClick={() => setFilter('income')}>
                {lang === 'nb' ? 'Inntekt' : 'Income'}
              </FilterPill>
              <FilterPill active={filter === 'expense'} onClick={() => setFilter('expense')}>
                {lang === 'nb' ? 'Utgift' : 'Expense'}
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
                const isIncome = (tx.category ?? '').toLowerCase().includes('inntekt');
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
                      <div className="text-[14px] font-medium truncate">{tx.description}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {format(date, 'EEEE, dd MMM')}
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

// Catmull-Rom → cubic-Bézier smoothing for a soft, polished line.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function HeroChart({
  history,
  formatCurrency,
}: {
  history: { label: string; value: number; estimated: boolean }[];
  formatCurrency: (n: number) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (history.length < 2) {
    return <div className="h-[160px] grid place-items-center text-[12px]" style={{ color: 'var(--text-3)' }}>—</div>;
  }
  const points = [...history];
  const W = 600;
  const H = 160;
  const padX = 4;
  const padY = 10;
  const usableW = W - padX * 2;
  const usableH = H - padY * 2;

  // Vertical breathing room so the line never glues to the top/bottom edge.
  const yPad = usableH * 0.14;
  const plotH = usableH - yPad * 2;

  const max = Math.max(...points.map(p => p.value));
  const min = Math.min(...points.map(p => p.value));
  const range = (max - min) || 1;
  const yOf = (v: number) => padY + yPad + (1 - (v - min) / range) * plotH;

  const xs = points.map((_, i) => padX + (i / (points.length - 1)) * usableW);
  const ys = points.map(p => yOf(p.value));

  const historyPath = smoothPath(xs.map((x, i) => ({ x, y: ys[i] })));
  const areaPath = `${historyPath} L${xs[xs.length - 1].toFixed(2)},${H} L${xs[0].toFixed(2)},${H} Z`;

  const lastHistX = xs[xs.length - 1];
  const lastHistY = ys[ys.length - 1];
  const lastHistValue = points[points.length - 1].value;
  const lastI = points.length - 1;

  // Clean, rounded value for marker labels (drops a trailing ,00 / .00).
  const fmtNice = (v: number) => formatCurrency(Math.round(v)).replace(/[.,]00(?=\D*$)/, '');
  const niceValue = fmtNice(lastHistValue);

  // Percentage positions for the HTML overlay — round dots and crisp text that
  // the SVG's non-uniform (preserveAspectRatio="none") scaling would distort.
  const leftPct = (x: number) => `${(x / W) * 100}%`;
  const topPct = (y: number) => `${(y / H) * 100}%`;

  return (
    <div className="relative w-full h-[160px]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="heroAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7FCBA0" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#7FCBA0" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* gridlines */}
        <g stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4">
          <line x1="0" y1={H * 0.25} x2={W} y2={H * 0.25} />
          <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} />
          <line x1="0" y1={H * 0.75} x2={W} y2={H * 0.75} />
        </g>

        {/* area */}
        <path d={areaPath} fill="url(#heroAreaGrad)" />
        {/* line — always solid; estimated context is shown by the dots, not the line */}
        <path
          d={historyPath}
          fill="none"
          stroke="#7FCBA0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* vertical guide for the hovered month */}
      {hovered !== null && hovered !== lastI && (
        <span
          className="absolute pointer-events-none"
          style={{
            left: leftPct(xs[hovered]),
            top: 0,
            bottom: 0,
            width: 1,
            background: 'rgba(127,203,160,0.25)',
          }}
        />
      )}

      {/* one dot per month — HTML so they stay perfectly round, each hoverable */}
      {points.map((_, i) => i !== lastI && (
        <span
          key={i}
          className="absolute grid place-items-center cursor-pointer"
          style={{
            left: leftPct(xs[i]),
            top: topPct(ys[i]),
            transform: 'translate(-50%, -50%)',
            width: 22,
            height: 22,
          }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(h => (h === i ? null : h))}
        >
          <span
            className="rounded-full transition-all"
            style={{
              width: hovered === i ? 11 : 7,
              height: hovered === i ? 11 : 7,
              // real months: bright filled · estimated months: hollow + dimmed
              background: hovered === i || !points[i].estimated ? '#7FCBA0' : '#0E100D',
              border: '1.5px solid #7FCBA0',
              opacity: hovered === i ? 1 : (points[i].estimated ? 0.4 : 0.95),
              boxShadow: undefined,
            }}
          />
        </span>
      ))}

      {/* hovered month tooltip — label + total */}
      {hovered !== null && hovered !== lastI && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: leftPct(xs[hovered]),
            top: topPct(ys[hovered]),
            transform: `translate(-50%, ${ys[hovered] < 56 ? '18px' : 'calc(-100% - 14px)'})`,
          }}
        >
          <div
            className="px-2.5 py-1.5 rounded-lg whitespace-nowrap text-center"
            style={{ background: '#191D16', border: '1px solid rgba(127,203,160,0.35)' }}
          >
            <div className="text-[9px] uppercase tracking-wider" style={{ color: '#5F6555' }}>
              {points[hovered].label}
            </div>
            <div className="text-[12px] font-semibold tabular-nums" style={{ color: '#ECE7D8' }}>
              {fmtNice(points[hovered].value)}
            </div>
            {points[hovered].estimated && (
              <div className="text-[9px] mt-0.5" style={{ color: 'var(--warning)' }}>estimert</div>
            )}
          </div>
        </div>
      )}

      {/* NOW dot */}
      <span
        className="absolute rounded-full"
        style={{
          left: leftPct(lastHistX),
          top: topPct(lastHistY),
          transform: 'translate(-50%, -50%)',
          width: 13,
          height: 13,
          background: '#7FCBA0',
          boxShadow: '0 0 0 4px #0E100D',
        }}
      />

      {/* NOW value label — crisp HTML, sits just left of the dot */}
      <div
        className="absolute"
        style={{
          left: `calc(${leftPct(lastHistX)} - 12px)`,
          top: topPct(lastHistY),
          transform: 'translate(-100%, -50%)',
        }}
      >
        <div
          className="px-2.5 py-1 rounded-lg text-[12px] font-semibold tabular-nums whitespace-nowrap"
          style={{ background: '#191D16', border: '1px solid rgba(127,203,160,0.35)', color: '#ECE7D8' }}
        >
          {niceValue}
        </div>
      </div>
    </div>
  );
}

// Shared hover tooltip for the small overlay charts — crisp HTML so it isn't
// distorted by the SVGs' preserveAspectRatio="none" scaling.
function ChartTip({
  left,
  top,
  below,
  title,
  value,
  sub,
  accent = '#7FCBA0',
}: {
  left: string;
  top: string;
  below: boolean;
  title: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="absolute pointer-events-none z-10"
      style={{ left, top, transform: `translate(-50%, ${below ? '12px' : 'calc(-100% - 12px)'})` }}
    >
      <div
        className="px-2.5 py-1.5 rounded-lg whitespace-nowrap text-center"
        style={{ background: '#191D16', border: `1px solid ${accent}59` }}
      >
        <div className="text-[9px] uppercase tracking-wider" style={{ color: '#5F6555' }}>{title}</div>
        <div className="text-[12px] font-semibold tabular-nums" style={{ color: '#ECE7D8' }}>{value}</div>
        {sub && <div className="text-[9px] mt-0.5" style={{ color: 'var(--warning)' }}>{sub}</div>}
      </div>
    </div>
  );
}

function BurnRateChart({
  actual,
  total,
  targetTotal,
  todayIdx,
  overshootValue,
  formatCurrency,
  lang,
}: {
  actual: number[];
  total: number;
  targetTotal: number;
  todayIdx: number;
  overshootValue: number;
  formatCurrency: (n: number) => string;
  lang: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const W = 280;
  const H = 80;
  const safeTotal = Math.max(total, 2);
  const lastActual = actual[actual.length - 1] ?? 0;
  // Ensure a non-zero Y-domain even with empty data so axes don't collapse.
  const maxCum = Math.max(targetTotal, lastActual, 100);
  const yFor = (v: number) => H - 4 - (v / maxCum) * (H - 8);
  const xFor = (i: number) => (i / (safeTotal - 1)) * W;

  // Always include a starting point at (0, baseline) so a line is visible even when actual=[]
  const drawPoints = actual.length === 0 ? [0] : actual;
  const ptStr = drawPoints.map((v, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  const areaStr = `${ptStr} L${xFor(Math.max(0, drawPoints.length - 1)).toFixed(1)},${H} L0,${H} Z`;

  const todayX = xFor(todayIdx);
  const todayY = yFor(lastActual);

  const dailyAvg = todayIdx > 0 ? lastActual / (todayIdx + 1) : 0;
  const projectedFinal = dailyAvg * safeTotal;
  const projectedFinalY = yFor(Math.min(projectedFinal, maxCum));
  const projWillOvershoot = overshootValue > 0 && lastActual > 0;

  const leftPct = (x: number) => `${(x / W) * 100}%`;
  const topPct = (y: number) => `${(y / H) * 100}%`;
  const dayWord = lang === 'nb' ? 'Dag' : 'Day';

  return (
    <div className="relative w-full h-[80px]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="spendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7FCBA0" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#7FCBA0" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {/* grid */}
        <g stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3">
          <line x1="0" y1={H * 0.25} x2={W} y2={H * 0.25} />
          <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} />
          <line x1="0" y1={H * 0.75} x2={W} y2={H * 0.75} />
        </g>
        {/* ideal pace (always drawn) */}
        <line x1="0" y1={H - 4} x2={W} y2={yFor(targetTotal)} stroke="#5F6555" strokeWidth="1" strokeDasharray="3 3" />
        {/* actual area + line — only visible when there's spending */}
        {lastActual > 0 && <path d={areaStr} fill="url(#spendAreaGrad)" />}
        {lastActual > 0 && (
          <path d={ptStr} fill="none" stroke="#7FCBA0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}
        {/* projection */}
        {projWillOvershoot && (
          <line x1={todayX} y1={todayY} x2={W} y2={projectedFinalY} stroke="#C9A24A" strokeWidth="1.5" strokeDasharray="3 3" />
        )}
        {/* hovered day guide */}
        {hovered !== null && (
          <line x1={xFor(hovered)} y1="0" x2={xFor(hovered)} y2={H} stroke="#7FCBA0" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
        )}
        {/* today vertical guide */}
        <line x1={todayX} y1="0" x2={todayX} y2={H} stroke="#7FCBA0" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
      </svg>

      {/* per-day hover zones */}
      {drawPoints.map((_, i) => (
        <span
          key={i}
          className="absolute top-0 bottom-0 cursor-pointer"
          style={{ left: leftPct(xFor(i)), width: `${100 / safeTotal}%`, transform: 'translateX(-50%)' }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(h => (h === i ? null : h))}
        />
      ))}

      {/* hovered dot */}
      {hovered !== null && (
        <span
          className="absolute rounded-full pointer-events-none"
          style={{
            left: leftPct(xFor(hovered)),
            top: topPct(yFor(drawPoints[hovered])),
            transform: 'translate(-50%, -50%)',
            width: 9,
            height: 9,
            background: '#7FCBA0',
            boxShadow: undefined,
          }}
        />
      )}

      {/* today dot — HTML so it stays round */}
      <span
        className="absolute rounded-full pointer-events-none"
        style={{
          left: leftPct(todayX),
          top: topPct(todayY),
          transform: 'translate(-50%, -50%)',
          width: 9,
          height: 9,
          background: '#0E100D',
          border: '2px solid #7FCBA0',
        }}
      />

      {hovered !== null && (
        <ChartTip
          left={leftPct(xFor(hovered))}
          top={topPct(yFor(drawPoints[hovered]))}
          below={yFor(drawPoints[hovered]) < 24}
          title={`${dayWord} ${hovered + 1}`}
          value={formatCurrency(drawPoints[hovered])}
        />
      )}
    </div>
  );
}

function MonthlyInvestmentBars({ bars, formatCurrency }: { bars: { key: string; label: string; value: number; projected?: boolean }[]; formatCurrency: (n: number) => string }) {
  const [hovered, setHovered] = useState<number | null>(null);
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

  const W = 240;
  const H = 80;
  const padding = 4;
  const max = Math.max(...display.map(b => b.value)) || 1;
  const target = max * 0.85;
  const barWidth = (W - padding * (display.length + 1)) / display.length;
  const todayIdx = realBars.length - 1;
  const barX = (i: number) => padding + i * (barWidth + padding);

  return (
    <div className="relative w-full h-[80px] mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        {/* target gridline */}
        <line x1="0" y1={H - (target / max) * (H - 8)} x2={W} y2={H - (target / max) * (H - 8)}
          stroke="rgba(255,255,255,0.08)" strokeDasharray="2 3" />
        {display.map((b, i) => {
          const h = Math.max(2, (b.value / max) * (H - 8));
          const x = barX(i);
          const y = H - h;
          const isActive = i === todayIdx || hovered === i;
          const opacity = b.projected ? 0.35 : Math.min(1, 0.55 + (i / display.length) * 0.45);
          return b.projected ? (
            <rect key={b.key} x={x} y={y} width={barWidth} height={h} rx="2"
              fill="none" stroke="#7FCBA0" strokeWidth="1" strokeDasharray="2 2" opacity={hovered === i ? 0.8 : opacity} />
          ) : (
            <rect key={b.key} x={x} y={y} width={barWidth} height={h} rx="2"
              fill="#7FCBA0" opacity={isActive ? 1 : opacity}
              />
          );
        })}
      </svg>

      {/* per-bar hover zones */}
      {display.map((b, i) => (
        <span
          key={b.key}
          className="absolute top-0 bottom-0 cursor-pointer"
          style={{ left: `${(barX(i) / W) * 100}%`, width: `${(barWidth / W) * 100}%` }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(h => (h === i ? null : h))}
        />
      ))}

      {hovered !== null && (() => {
        const b = display[hovered];
        const h = Math.max(2, (b.value / max) * (H - 8));
        const topY = H - h;
        return (
          <ChartTip
            left={`${((barX(hovered) + barWidth / 2) / W) * 100}%`}
            top={`${(topY / H) * 100}%`}
            below={topY < 24}
            title={b.label || 'Estimert'}
            value={formatCurrency(b.value)}
            sub={b.projected ? 'estimert' : undefined}
            accent="#7FCBA0"
          />
        );
      })()}
    </div>
  );
}

function ProjectionChart({
  points,
  formatCurrency,
}: {
  points: { year: number; netWorth: number }[];
  formatCurrency: (n: number) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (points.length < 2) return <div className="h-[80px]" />;
  const W = 240;
  const H = 80;
  const padX = 4;
  const padY = 6;
  const max = Math.max(...points.map(p => p.netWorth));
  const min = Math.min(...points.map(p => p.netWorth));
  const range = (max - min) || 1;
  const xs = points.map((_, i) => padX + (i / (points.length - 1)) * (W - padX * 2));
  const ys = points.map(p => padY + (1 - (p.netWorth - min) / range) * (H - padY * 2));
  const line = points.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `${line} L${xs[xs.length - 1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`;
  const lastI = points.length - 1;
  const leftPct = (x: number) => `${(x / W) * 100}%`;
  const topPct = (y: number) => `${(y / H) * 100}%`;

  return (
    <div className="relative w-full h-[80px] mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="projAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3F7373" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#3F7373" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <g stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3">
          <line x1="0" y1={H * 0.33} x2={W} y2={H * 0.33} />
          <line x1="0" y1={H * 0.66} x2={W} y2={H * 0.66} />
        </g>
        <path d={area} fill="url(#projAreaGrad)" />
        <path d={line} fill="none" stroke="#3F7373" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {/* hovered year guide */}
        {hovered !== null && (
          <line x1={xs[hovered]} y1="0" x2={xs[hovered]} y2={H} stroke="#3F7373" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
        )}
      </svg>

      {/* dots per year — HTML so they stay round */}
      {points.map((_, i) => {
        const endpoint = i === 0 || i === lastI;
        return (
          <span
            key={i}
            className="absolute rounded-full pointer-events-none transition-all"
            style={{
              left: leftPct(xs[i]),
              top: topPct(ys[i]),
              transform: 'translate(-50%, -50%)',
              width: hovered === i ? 9 : endpoint ? 6 : 4,
              height: hovered === i ? 9 : endpoint ? 6 : 4,
              background: hovered === i ? '#3F7373' : '#0E100D',
              border: `1.5px solid ${i === lastI ? '#3F7373' : '#7FCBA0'}`,
              opacity: hovered === i ? 1 : endpoint ? 1 : 0.5,
              boxShadow: undefined,
            }}
          />
        );
      })}

      {/* per-year hover zones */}
      {points.map((_, i) => (
        <span
          key={i}
          className="absolute top-0 bottom-0 cursor-pointer"
          style={{ left: leftPct(xs[i]), width: `${100 / points.length}%`, transform: 'translateX(-50%)' }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(h => (h === i ? null : h))}
        />
      ))}

      {hovered !== null && (
        <ChartTip
          left={leftPct(xs[hovered])}
          top={topPct(ys[hovered])}
          below={ys[hovered] < 24}
          title={String(points[hovered].year)}
          value={formatCurrency(points[hovered].netWorth)}
          accent="#3F7373"
        />
      )}
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
