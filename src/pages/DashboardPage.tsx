import React, { useMemo, useState } from 'react';
import {
  TrendingUp, Wallet, Home, Zap, PiggyBank, BarChart2, Bitcoin, Shield, Receipt,
  ArrowUpRight, BarChart3,
} from 'lucide-react';
import { format, parse, format as fmtDate, subMonths } from 'date-fns';
import { useFinance } from '../context/FinanceContext';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { DeltaChip } from '../components/ui/DeltaChip';
import { calcNetWorthProjectionByBucket } from '../lib/calculations';
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

  // ─── Net worth history (12mo + projection) ───
  // Always produce 12 monthly points so the chart looks meaningful.
  // If <2 real points are stored, synthesize a gentle backward trajectory
  // ending at totalEquity (marked as estimated).
  const { netWorthSeries, isEstimated } = useMemo(() => {
    const real = Object.entries(netWorthHistory)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => ({ monthKey: k, value: v, estimated: false }));

    if (real.length >= 2) return { netWorthSeries: real, isEstimated: false };

    // Synthesize 12 months ending at totalEquity (or the single real point).
    const end = real[0]?.value ?? totalEquity;
    const monthlyGrowth = Math.pow(1.005, 1); // ~6% annual
    const start = end / Math.pow(monthlyGrowth, 11);
    const synth = Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const value = Math.round(start * Math.pow(monthlyGrowth, i));
      return { monthKey, value, estimated: true };
    });
    // Make sure the last point is the real current value
    synth[synth.length - 1] = { ...synth[synth.length - 1], value: end };
    return { netWorthSeries: synth, isEstimated: true };
  }, [netWorthHistory, totalEquity]);

  const annualSavings = Math.max(0, totalResidual * 12);
  const cashStart = assets.savings + assets.bsu + assets.bufferAccount;
  const projectionRates = { stocks: growthReturnRate, crypto: cryptoGrowthRate, cash: cashGrowthRate, house: houseGrowthRate };
  const projectionStart = { stocks: netInvestment, crypto: netCrypto, cash: cashStart, house: houseEquity };
  const projectionForHero = useMemo(
    () => calcNetWorthProjectionByBucket(projectionStart, annualSavings, projectionRates, 1).slice(1).map(p => ({ year: p.year, netWorth: p.total })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [netInvestment, netCrypto, cashStart, houseEquity, annualSavings, growthReturnRate, cryptoGrowthRate, cashGrowthRate, houseGrowthRate]
  );

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
    return calcNetWorthProjectionByBucket(projectionStart, annualSavings, projectionRates, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netInvestment, netCrypto, cashStart, houseEquity, annualSavings, growthReturnRate, cryptoGrowthRate, cashGrowthRate, houseGrowthRate]);

  const projectionEndYear = projection15y[projection15y.length - 1]?.year;
  const projectionEndValue = projection15y[projection15y.length - 1]?.total ?? 0;
  const projectionGrowthPct = totalEquity > 0 ? Math.round((projectionEndValue / totalEquity - 1) * 100) : 0;

  // ─── Burn rate (Can Spend chart) ───
  const burnRate = useMemo(() => {
    const todayIdx = Math.max(0, dailyData.findIndex(d => d.dateStr === todayStr));
    const upToToday = todayIdx >= 0 ? dailyData.slice(0, todayIdx + 1) : dailyData;
    const cumulative: number[] = [];
    let running = 0;
    upToToday.forEach(d => { running += d.spent; cumulative.push(running); });
    return {
      todayIdx: todayIdx >= 0 ? todayIdx : dailyData.length - 1,
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
        <h1 className="text-3xl md:text-5xl font-normal leading-[1.05] tracking-[-0.03em]">
          {lang === 'nb' ? (
            <>Pengene dine har <em className="font-serif italic" style={{ color: 'var(--accent)' }}>headroom</em>.<br className="hidden md:inline" /> Her er status.</>
          ) : (
            <>Your money has <em className="font-serif italic" style={{ color: 'var(--accent)' }}>headroom</em>.<br className="hidden md:inline" /> Here's the state of things.</>
          )}
        </h1>
        <p className="mt-4 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {subtitle}
        </p>
      </header>

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
            className="font-semibold tracking-[-0.04em] leading-none mt-4"
            style={{
              fontSize: 'clamp(40px, 5.5vw, 60px)',
              background: 'linear-gradient(180deg, var(--text-1), color-mix(in srgb, var(--text-1) 70%, var(--accent)))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
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

          {/* Hero chart — proper boxed line chart with today + projection */}
          <div className="mt-6 rounded-[16px] border p-4" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>
              <div className="flex items-center gap-2">
                <span>{lang === 'nb' ? 'Netto egenkapital · siste 12 mnd + projeksjon' : 'Net equity · last 12 months + projection'}</span>
                {isEstimated && (
                  <span
                    className="px-2 py-0.5 rounded-full normal-case tracking-normal text-[10px]"
                    style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
                  >
                    {lang === 'nb' ? 'estimert' : 'estimated'}
                  </span>
                )}
              </div>
              <span style={{ color: 'var(--accent)' }}>{lang === 'nb' ? 'I dag' : 'Today'}</span>
            </div>
            <HeroChart
              history={netWorthSeries.map(p => ({ label: fmtDate(parse(p.monthKey, 'yyyy-MM', new Date()), 'MMM yy'), value: p.value }))}
              projectionValue={projectionForHero[0]?.netWorth ?? null}
              isEstimated={isEstimated}
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
            <DeltaChip tone="accent" size="sm">{formatCurrency(Math.round(recommendedSpending / 30))}/d</DeltaChip>
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
          <div className="mt-4 rounded-[14px] border p-3" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}>
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
            />
            <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
              <span>{lang === 'nb' ? 'Dag 1' : 'Day 1'}</span>
              <span style={{ color: 'var(--accent)' }}>{lang === 'nb' ? `I dag · ${burnRate.todayIdx + 1}` : `Today · ${burnRate.todayIdx + 1}`}</span>
              <span style={{ color: overshoot > 0 ? 'var(--warning)' : 'var(--text-3)' }}>{lang === 'nb' ? `Dag ${burnRate.total}` : `Day ${burnRate.total}`}</span>
            </div>
          </div>
        </Card>

        {/* ─── Should Invest ─── */}
        <Card padding="md" className="md:col-span-5" glow="violet">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel icon={<TrendingUp />}>{t.shouldInvest}</SectionLabel>
            <DeltaChip tone="positive" size="sm">{savingsTargetPercent}% {t.savingsTarget}</DeltaChip>
          </div>
          <div className="font-semibold tracking-[-0.02em] leading-none mt-3 text-[32px]">
            {formatCurrency(recommendedInvestment)}
          </div>
          <div className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>
            {lang === 'nb' ? 'Denne måneden' : 'This month'}
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
            className="mt-5 flex h-3 rounded-full overflow-hidden"
            style={{ background: 'var(--bg-elev)' }}
            aria-label="Budget composition"
          >
            {budgetUsedPct > 0 && <div style={{ width: `${budgetUsedPct}%`, background: 'linear-gradient(90deg, var(--negative), color-mix(in srgb, var(--negative) 70%, var(--pink)))' }} />}
            {spentPct > 0 && <div style={{ width: `${spentPct}%`, background: 'var(--warning)' }} />}
            {availablePct > 0 && <div style={{ width: `${availablePct}%`, background: 'linear-gradient(90deg, var(--positive), var(--emerald, #34D399))' }} />}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
            <LegendItem dot="var(--negative)" name={t.fixedCosts} value={formatCurrency(totalFixedExpenses)} pct={`${budgetUsedPct.toFixed(1)}%`} />
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
            <div className="flex items-center gap-5 mb-4">
              <Donut rows={assetRows} total={totalEquity} mom={incomeDelta} />
              <div className="flex-1 min-w-0 space-y-1.5">
                {assetRows.map((row, i) => {
                  const pct = totalEquity > 0 ? (row.value / totalEquity) * 100 : 0;
                  const isLargest = i === 0;
                  return (
                    <div
                      key={i}
                      className="grid items-center gap-2 text-[12px] px-2 py-1 rounded-lg"
                      style={{
                        gridTemplateColumns: '14px 1fr auto auto',
                        background: isLargest ? `color-mix(in srgb, ${row.color} 8%, transparent)` : 'transparent',
                      }}
                    >
                      <span className="inline-block w-2 h-2 rounded-[3px]" style={{ background: row.color }} />
                      <span className="truncate" style={{ color: 'var(--text-1)' }}>{row.label}</span>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>{pct.toFixed(0)}%</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(Math.round(row.value))}</span>
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
                className="w-9 h-9 rounded-[12px] grid place-items-center mb-3"
                style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
              >
                <ArrowUpRight size={18} />
              </div>
              <SectionLabel>{lang === 'nb' ? 'Månedlig investering' : 'Monthly investment'}</SectionLabel>
              <div className="text-[24px] font-bold tracking-[-0.02em] leading-none mt-2">
                {formatCurrency(recommendedInvestment)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb' ? `April · ${savingsTargetPercent}% mål nådd` : `${savingsTargetPercent}% target hit`}
              </div>
            </div>
            <DeltaChip tone="positive" size="sm">+{savingsTargetPercent}%</DeltaChip>
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
                className="w-9 h-9 rounded-[12px] grid place-items-center mb-3"
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
                    <span className="font-semibold tabular-nums">{Math.round(row.value).toLocaleString('no-NO')}</span>
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
                className="w-9 h-9 rounded-[12px] grid place-items-center mb-3"
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
                      className="w-9 h-9 rounded-[12px] border grid place-items-center text-[13px] font-semibold tabular-nums"
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
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// ─── Inline chart components ───────────────────────────────────
// ─────────────────────────────────────────────────────────────────

function HeroChart({
  history,
  projectionValue,
  isEstimated = false,
  formatCurrency,
}: {
  history: { label: string; value: number }[];
  projectionValue: number | null;
  isEstimated?: boolean;
  formatCurrency: (n: number) => string;
}) {
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

  const historyMax = Math.max(...points.map(p => p.value));
  const max = projectionValue ? Math.max(historyMax, projectionValue) : historyMax;
  const min = Math.min(...points.map(p => p.value));
  const range = (max - min) || 1;

  const xs = points.map((_, i) => padX + (i / (points.length - 1)) * usableW * (projectionValue !== null ? 0.8 : 1));
  const ys = points.map(p => padY + (1 - (p.value - min) / range) * usableH);

  const historyPath = points.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(2)},${ys[i].toFixed(2)}`).join(' ');
  const areaPath = `${historyPath} L${xs[xs.length - 1].toFixed(2)},${H} L${xs[0].toFixed(2)},${H} Z`;

  const projectionX = projectionValue !== null ? W - padX : null;
  const projectionY = projectionValue !== null
    ? padY + (1 - (projectionValue - min) / range) * usableH
    : null;
  const lastHistX = xs[xs.length - 1];
  const lastHistY = ys[ys.length - 1];
  const lastHistValue = points[points.length - 1].value;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[160px]">
      <defs>
        <linearGradient id="heroAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6EE7FF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6EE7FF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines */}
      <g stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4">
        <line x1="0" y1={H * 0.25} x2={W} y2={H * 0.25} />
        <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} />
        <line x1="0" y1={H * 0.75} x2={W} y2={H * 0.75} />
      </g>

      {/* area */}
      <path d={areaPath} fill="url(#heroAreaGrad)" opacity={isEstimated ? 0.5 : 1} />
      {/* history line — dashed if estimated */}
      <path
        d={historyPath}
        fill="none"
        stroke="#6EE7FF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isEstimated ? '4 4' : undefined}
        opacity={isEstimated ? 0.75 : 1}
      />
      {/* data dots on real points */}
      {!isEstimated && points.map((_, i) => i % 2 === 0 && (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="2.5" fill="#08080A" stroke="#6EE7FF" strokeWidth="1.5" />
      ))}

      {/* projection line (dashed violet) */}
      {projectionX !== null && projectionY !== null && (
        <line x1={lastHistX} y1={lastHistY} x2={projectionX} y2={projectionY}
          stroke="#A78BFA" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
      )}

      {/* today vertical guide */}
      <line x1={lastHistX} y1="0" x2={lastHistX} y2={H} stroke="#6EE7FF" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />

      {/* today dot */}
      <circle cx={lastHistX} cy={lastHistY} r="6" fill="#08080A" stroke="#6EE7FF" strokeWidth="2" />
      <circle cx={lastHistX} cy={lastHistY} r="3" fill="#6EE7FF" />

      {/* projection end dot */}
      {projectionX !== null && projectionY !== null && (
        <circle cx={projectionX} cy={projectionY} r="4" fill="#08080A" stroke="#A78BFA" strokeWidth="2" />
      )}

      {/* today callout */}
      <g transform={`translate(${Math.min(lastHistX - 80, W - 100)}, ${Math.max(8, lastHistY - 42)})`}>
        <rect width="100" height="34" rx="8" fill="#1B1B22" stroke="#6EE7FF" strokeOpacity="0.4" />
        <text x="10" y="14" fill="#6E6E78" fontSize="9" fontFamily="Inter" letterSpacing="1">NOW</text>
        <text x="10" y="28" fill="#F4F4F6" fontSize="11" fontFamily="Inter" fontWeight="600">{formatCurrency(lastHistValue).slice(0, 14)}</text>
      </g>
    </svg>
  );
}

function BurnRateChart({
  actual,
  total,
  targetTotal,
  todayIdx,
  overshootValue,
}: {
  actual: number[];
  total: number;
  targetTotal: number;
  todayIdx: number;
  overshootValue: number;
}) {
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[80px]">
      <defs>
        <linearGradient id="spendAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6EE7FF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6EE7FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* grid */}
      <g stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3">
        <line x1="0" y1={H * 0.25} x2={W} y2={H * 0.25} />
        <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} />
        <line x1="0" y1={H * 0.75} x2={W} y2={H * 0.75} />
      </g>
      {/* ideal pace (always drawn) */}
      <line x1="0" y1={H - 4} x2={W} y2={yFor(targetTotal)} stroke="#6E6E78" strokeWidth="1" strokeDasharray="3 3" />
      {/* actual area + line — only visible when there's spending */}
      {lastActual > 0 && <path d={areaStr} fill="url(#spendAreaGrad)" />}
      {lastActual > 0 && (
        <path d={ptStr} fill="none" stroke="#6EE7FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* projection */}
      {projWillOvershoot && (
        <line x1={todayX} y1={todayY} x2={W} y2={projectedFinalY} stroke="#FBBF24" strokeWidth="1.5" strokeDasharray="3 3" />
      )}
      {/* today vertical guide */}
      <line x1={todayX} y1="0" x2={todayX} y2={H} stroke="#6EE7FF" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
      {/* today dot (always visible) */}
      <circle cx={todayX} cy={todayY} r="5" fill="#08080A" stroke="#6EE7FF" strokeWidth="2" />
      <circle cx={todayX} cy={todayY} r="2" fill="#6EE7FF" />
    </svg>
  );
}

function MonthlyInvestmentBars({ bars }: { bars: { key: string; label: string; value: number; projected?: boolean }[] }) {
  if (bars.length === 0) return <div className="h-[80px]" />;
  // If there are fewer than 4 real months, project forward to fill out to ~6 bars
  // so the chart doesn't look anemic.
  const realBars = bars.filter(b => !b.projected);
  const baseVal = realBars[realBars.length - 1]?.value ?? bars[0]?.value ?? 0;
  let display = [...bars];
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[80px] mt-3">
      {/* target gridline */}
      <line x1="0" y1={H - (target / max) * (H - 8)} x2={W} y2={H - (target / max) * (H - 8)}
        stroke="rgba(255,255,255,0.08)" strokeDasharray="2 3" />
      {display.map((b, i) => {
        const h = Math.max(2, (b.value / max) * (H - 8));
        const x = padding + i * (barWidth + padding);
        const y = H - h;
        const isCurrent = i === todayIdx;
        const opacity = b.projected ? 0.35 : Math.min(1, 0.55 + (i / display.length) * 0.45);
        return b.projected ? (
          <rect key={b.key} x={x} y={y} width={barWidth} height={h} rx="2"
            fill="none" stroke="#3ECF8E" strokeWidth="1" strokeDasharray="2 2" opacity={opacity} />
        ) : (
          <rect key={b.key} x={x} y={y} width={barWidth} height={h} rx="2"
            fill="#3ECF8E" opacity={isCurrent ? 1 : opacity}
            style={isCurrent ? { filter: 'drop-shadow(0 0 6px color-mix(in srgb, #3ECF8E 50%, transparent))' } : undefined} />
        );
      })}
    </svg>
  );
}

function ProjectionChart({
  points,
  formatCurrency,
}: {
  points: { year: number; netWorth: number }[];
  formatCurrency: (n: number) => string;
}) {
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[80px] mt-3">
      <defs>
        <linearGradient id="projAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3">
        <line x1="0" y1={H * 0.33} x2={W} y2={H * 0.33} />
        <line x1="0" y1={H * 0.66} x2={W} y2={H * 0.66} />
      </g>
      <path d={area} fill="url(#projAreaGrad)" />
      <path d={line} fill="none" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[0]} cy={ys[0]} r="3" fill="#08080A" stroke="#6EE7FF" strokeWidth="1.5" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="4" fill="#08080A" stroke="#A78BFA" strokeWidth="2" />
      {/* invisible tspan-ish; rely on title for tooltip */}
      <title>{formatCurrency(points[points.length - 1].netWorth)}</title>
    </svg>
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

function Donut({ rows, total, mom }: { rows: { value: number; color: string }[]; total: number; mom: number | null }) {
  if (total <= 0) return null;
  let offset = 0;
  const segments = rows.map(row => {
    const pct = (row.value / total) * 100;
    const filled = Math.max(0, pct - 1.5);
    const seg = { color: row.color, filled, offset: -offset };
    offset += pct;
    return seg;
  });

  return (
    <div className="relative shrink-0" style={{ width: 160, height: 160 }}>
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.915" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="18"
            cy="18"
            r="15.915"
            fill="none"
            stroke={s.color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${s.filled} ${100 - s.filled}`}
            strokeDashoffset={s.offset}
            style={i === 0 ? { filter: `drop-shadow(0 0 4px color-mix(in srgb, ${s.color} 35%, transparent))` } : undefined}
          />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>Total</div>
          <div className="text-[15px] font-bold leading-tight mt-1">{formatTotalCompact(total)}</div>
          {mom !== null && (
            <div className="mt-1">
              <DeltaChip tone={mom >= 0 ? 'positive' : 'negative'} size="sm">
                {mom >= 0 ? '+' : ''}{mom.toFixed(1)}%
              </DeltaChip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 px-3 rounded-full text-[11px] font-medium border transition-colors cursor-pointer"
      style={{
        background: active ? 'var(--text-1)' : 'rgba(255,255,255,0.04)',
        borderColor: active ? 'transparent' : 'var(--border)',
        color: active ? 'var(--bg-page)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}

function formatTotalCompact(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'k';
  return String(Math.round(v));
}

export default DashboardPage;
