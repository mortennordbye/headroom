import React, { useMemo } from 'react';
import { ArrowUpRight, TrendingUp, Wallet, Home, Zap, PiggyBank, BarChart2, Bitcoin, Shield } from 'lucide-react';
import { format } from 'date-fns';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { format as fmtDate, parse } from 'date-fns';
import { useFinance } from '../context/FinanceContext';

const card = 'bg-white dark:bg-[#1a1a1a] rounded-2xl border border-[#e5e5e5] dark:border-[#2a2a2a] shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[#737373]';

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
    conservativeMode,
    totalResidual,
    totalFixedExpenses,
    dailyData,
    dailyTransactions,
    currentMonth,
    totalEquity,
    netInvestment,
    netCrypto,
    houseEquity,
    assets,
    netWorthHistory,
    formatCurrency,
    isDarkMode,
  } = useFinance();

  const totalSpent = dailyData.reduce((sum, d) => sum + d.spent, 0);
  const monthEndSurplus = dailyData[dailyData.length - 1]?.balance ?? 0;

  // Today's running balance
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayEntry = dailyData.find(d => d.dateStr === todayStr);
  const todayBalance = todayEntry?.balance ?? monthEndSurplus;

  const cashTotal = assets.bsu + assets.savings + assets.bufferAccount;

  const assetAllocation = [
    { name: t.investmentNet, value: Math.max(0, netInvestment), color: '#0ea5e9' },
    { name: t.propertyEquityShort, value: Math.max(0, houseEquity), color: '#10b981' },
    { name: lang === 'nb' ? 'Krypto (netto)' : 'Crypto (net)', value: Math.max(0, netCrypto), color: '#f59e0b' },
    { name: t.cashTotal, value: cashTotal, color: '#8b5cf6' },
  ].filter(a => a.value > 0);

  const recentTransactions = useMemo(() => {
    const monthStr = format(currentMonth, 'yyyy-MM');
    return [...dailyTransactions]
      .filter(tx => tx.date.startsWith(monthStr))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);
  }, [dailyTransactions, currentMonth]);

  const budgetUsedPct = effectiveIncome > 0 ? Math.min(100, (totalFixedExpenses / effectiveIncome) * 100) : 0;
  const spentPct = effectiveIncome > 0 ? Math.min(100 - budgetUsedPct, (totalSpent / effectiveIncome) * 100) : 0;
  const availablePct = Math.max(0, 100 - budgetUsedPct - spentPct);

  const incomeDiffPct = averageIncome > 0 ? ((effectiveIncome - averageIncome) / averageIncome) * 100 : 0;

  const incomeDelta = prevMonthIncome > 0 ? ((effectiveIncome - prevMonthIncome) / prevMonthIncome) * 100 : null;
  const spendingDelta = prevMonthSpending > 0 ? ((totalSpent - prevMonthSpending) / prevMonthSpending) * 100 : null;

  const netWorthChartData = useMemo(() => {
    return Object.entries(netWorthHistory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, equity]) => {
        const date = parse(monthKey, 'yyyy-MM', new Date());
        return { month: fmtDate(date, 'MMM yy'), equity };
      });
  }, [netWorthHistory]);

  const assetRows = [
    {
      label: t.investmentNet,
      value: netInvestment,
      icon: <BarChart2 size={13} className="text-sky-500" />,
      color: 'text-sky-600 dark:text-sky-400',
    },
    {
      label: t.propertyEquity,
      value: houseEquity,
      icon: <Home size={13} className="text-emerald-500" />,
      color: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: lang === 'nb' ? 'Krypto (netto)' : 'Crypto (net)',
      value: netCrypto,
      icon: <Bitcoin size={13} className="text-amber-500" />,
      color: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: t.bsu,
      value: assets.bsu,
      icon: <Shield size={13} className="text-violet-500" />,
      color: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: t.savings,
      value: assets.savings,
      icon: <PiggyBank size={13} className="text-violet-400" />,
      color: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: t.bufferAccount,
      value: assets.bufferAccount,
      icon: <Wallet size={13} className="text-violet-300" />,
      color: 'text-violet-600 dark:text-violet-400',
    },
  ].filter(r => r.value > 0);

  return (
    <div className="space-y-4 md:space-y-6">

      {/* Row 1 — Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroCard
          icon={<TrendingUp size={14} className="text-sky-100/70" />}
          title={t.totalEquity}
          value={formatCurrency(totalEquity)}
        />
        <MetricCard
          title={lang === 'nb' ? 'Restbeløp / mnd' : 'Monthly Residual'}
          value={formatCurrency(totalResidual)}
          sub={lang === 'nb' ? 'Etter faste utgifter' : 'After fixed expenses'}
          negative={totalResidual < 0}
          delta={incomeDelta}
          deltaLabel={t.vsLastMonth}
        />
        <MetricCard
          title={t.canSpend}
          value={formatCurrency(recommendedSpending)}
          sub={lang === 'nb' ? 'Anbefalt forbruk' : 'Recommended spending'}
          accent="blue"
          delta={spendingDelta !== null ? -spendingDelta : null}
          deltaLabel={t.vsLastMonth}
        />
        <MetricCard
          title={t.shouldInvest}
          value={formatCurrency(recommendedInvestment)}
          sub={`${t.savingsTarget} ${Math.round(totalResidual > 0 ? (recommendedInvestment / totalResidual) * 100 : 0)}%`}
          accent="green"
        />
      </div>

      {/* Row 2 — Budget Health + Asset Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

        {/* Budget Health */}
        <div className={`${card} p-5 md:p-7 space-y-5`}>
          <div className="flex items-center justify-between pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
            <div className="flex items-center gap-2">
              <Wallet size={14} strokeWidth={2} className="text-[#737373]" />
              <h2 className={sectionLabel}>{t.budgetHealth}</h2>
            </div>
            {conservativeMode && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap">
                {lang === 'nb' ? 'Sparemodus' : 'Conservative'}
              </span>
            )}
          </div>

          {/* Income vs average */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[12px]">
              <span className="text-[#737373]">{lang === 'nb' ? 'Inntekt denne måneden' : 'This month\'s income'}</span>
              <span className="font-mono font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(effectiveIncome)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-[#737373]">{t.avgIncome}</span>
              <span className={`font-mono ${incomeDiffPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#ef4444]'}`}>
                {formatCurrency(averageIncome)}{' '}
                <span className="text-[10px]">({incomeDiffPct >= 0 ? '+' : ''}{incomeDiffPct.toFixed(1)}%)</span>
              </span>
            </div>
          </div>

          {/* Stacked bar */}
          <div className="space-y-3">
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
              {budgetUsedPct > 0 && (
                <div className="h-full bg-[#ef4444] rounded-l-full" style={{ width: `${budgetUsedPct}%` }} />
              )}
              {spentPct > 0 && (
                <div className="h-full bg-[#f59e0b]" style={{ width: `${spentPct}%` }} />
              )}
              {availablePct > 0 && (
                <div className="h-full bg-emerald-500 rounded-r-full" style={{ width: `${availablePct}%` }} />
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-[#ef4444] shrink-0" />
                  <span className="text-[#737373] text-[11px]">{t.fixedCosts}</span>
                </div>
                <div className="font-mono font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(totalFixedExpenses)}</div>
                <div className="text-[11px] text-[#737373]">{budgetUsedPct.toFixed(1)}%</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
                  <span className="text-[#737373] text-[11px]">{t.monthSpent}</span>
                </div>
                <div className="font-mono font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(totalSpent)}</div>
                <div className="text-[11px] text-[#737373]">{spentPct.toFixed(1)}%</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-[#737373] text-[11px]">{t.remainingBudget}</span>
                </div>
                <div className={`font-mono font-semibold ${monthEndSurplus >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#ef4444]'}`}>
                  {formatCurrency(monthEndSurplus)}
                </div>
                <div className="text-[11px] text-[#737373]">{availablePct.toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* Today's pace */}
          <div className="pt-1 border-t border-[#f0f0f0] dark:border-[#222222] flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <Zap size={11} className="text-[#737373]" />
              <span className="text-[11px] text-[#737373]">{lang === 'nb' ? 'Daglig balanse i dag' : 'Today\'s running balance'}</span>
            </div>
            <span className={`text-[12px] font-mono font-semibold ${todayBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#ef4444]'}`}>
              {todayBalance >= 0 ? '+' : ''}{formatCurrency(todayBalance)}
            </span>
          </div>
        </div>

        {/* Asset Allocation */}
        <div className={`${card} p-5 md:p-7 space-y-4`}>
          <div className="flex items-center gap-2 pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
            <Home size={14} strokeWidth={2} className="text-[#737373]" />
            <h2 className={sectionLabel}>{t.assetAllocation}</h2>
          </div>

          {assetAllocation.length === 0 ? (
            <p className="text-[13px] text-[#737373]">
              {lang === 'nb' ? 'Ingen formuesverdier registrert enda.' : 'No assets recorded yet.'}
            </p>
          ) : (
            <div className="flex gap-4 items-center">
              {/* Mini pie */}
              <div className="h-[130px] w-[130px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={assetAllocation}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      innerRadius={36}
                      strokeWidth={0}
                    >
                      {assetAllocation.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [formatCurrency(Number(value ?? 0)), '']}
                      contentStyle={{
                        borderRadius: '10px',
                        border: `1px solid ${isDarkMode ? '#2a2a2a' : '#e5e5e5'}`,
                        backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff',
                        color: isDarkMode ? '#fafafa' : '#0a0a0a',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Breakdown rows */}
              <div className="flex-1 space-y-0 min-w-0">
                {assetRows.map((row, i) => {
                  const pct = totalEquity > 0 ? (row.value / totalEquity) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-[#f0f0f0] dark:border-[#222222] last:border-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {row.icon}
                        <span className="text-[11px] text-[#737373] truncate">{row.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-[#737373]/60 font-mono w-[32px] text-right">{pct.toFixed(0)}%</span>
                        <span className={`text-[12px] font-mono font-semibold ${row.color}`}>
                          {formatCurrency(Math.round(row.value))}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="text-[11px] font-medium text-[#737373]">{t.trueNetEquity}</span>
                  <span className="text-[13px] font-mono font-bold text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(Math.round(totalEquity))}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-5 py-4 md:px-7 md:py-5 border-b border-[#f0f0f0] dark:border-[#222222]">
          <h2 className={sectionLabel}>{t.recentTransactions}</h2>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="px-5 py-8 md:px-7 text-center">
            <p className="text-[13px] text-[#737373]">{t.noTransactions}</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f0] dark:divide-[#222222]">
            {recentTransactions.map(tx => {
              const date = new Date(tx.date + 'T00:00:00');
              return (
                <div key={tx.id} className="px-5 py-3.5 md:px-7 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#fafafa] dark:bg-[#222222] border border-[#e5e5e5] dark:border-[#2a2a2a] flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono font-semibold text-[#737373]">{format(date, 'dd')}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[#0a0a0a] dark:text-[#fafafa] truncate">{tx.description}</div>
                      <div className="text-[11px] text-[#737373]">
                        {tx.category || format(date, 'EEEE')}
                      </div>
                    </div>
                  </div>
                  <span className="text-[13px] font-mono font-semibold text-[#ef4444] shrink-0">
                    −{formatCurrency(tx.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Net Worth History */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
          <TrendingUp size={14} strokeWidth={2} className="text-[#737373]" />
          <h2 className={sectionLabel}>{t.netWorthHistory}</h2>
        </div>

        {netWorthChartData.length < 2 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-[13px] text-[#737373]">{t.buildingHistory}</p>
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netWorthChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#2a2a2a' : '#f0f0f0'} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(v: number) =>
                    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k`
                    : String(v)
                  }
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value ?? 0)), t.totalEquity]}
                  contentStyle={{
                    borderRadius: '10px',
                    border: `1px solid ${isDarkMode ? '#2a2a2a' : '#e5e5e5'}`,
                    backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff',
                    color: isDarkMode ? '#fafafa' : '#0a0a0a',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#equityGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#0ea5e9', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

interface HeroCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
}

function HeroCard({ icon, title, value }: HeroCardProps) {
  return (
    <div className="col-span-2 lg:col-span-1 relative p-4 md:p-6 rounded-2xl overflow-hidden flex flex-col space-y-2 bg-gradient-to-br from-sky-500 to-blue-600 border-transparent shadow-lg shadow-sky-500/20">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] md:text-[11px] font-medium uppercase tracking-[0.1em] text-sky-100/70">{title}</span>
      </div>
      <span className="text-xl md:text-2xl font-bold font-mono tracking-tight text-white">{value}</span>
      <ArrowUpRight size={64} className="absolute -bottom-3 -right-3 text-white/10" />
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  sub?: string;
  negative?: boolean;
  accent?: 'blue' | 'green';
  delta?: number | null;
  deltaLabel?: string;
}

function MetricCard({ title, value, sub, negative, accent, delta, deltaLabel }: MetricCardProps) {
  const valueColor = negative
    ? 'text-[#ef4444]'
    : accent === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'blue'
        ? 'text-[#0ea5e9] dark:text-[#38bdf8]'
        : 'text-[#0a0a0a] dark:text-[#fafafa]';

  return (
    <div className="p-4 md:p-6 rounded-2xl border bg-white dark:bg-[#1a1a1a] border-[#e5e5e5] dark:border-[#2a2a2a] shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none flex flex-col space-y-1.5">
      <span className="text-[10px] md:text-[11px] font-medium uppercase tracking-[0.1em] text-[#737373]">{title}</span>
      <span className={`text-base md:text-xl font-bold font-mono tracking-tight ${valueColor}`}>{value}</span>
      {sub && <span className="text-[11px] text-[#737373] leading-snug">{sub}</span>}
      {delta != null && (
        <span className={`text-[10px] font-medium ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#ef4444]'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}% {deltaLabel}
        </span>
      )}
    </div>
  );
}

export default DashboardPage;
