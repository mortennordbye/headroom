import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parse } from 'date-fns';
import { useFinance } from '../../context/FinanceContext';
import { computeEquityBreakdown } from '../../lib/equity';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';

/**
 * How net-worth composition (stocks / house equity / crypto / cash) has shifted
 * over time, from monthly balance snapshots plus the live current month. Only
 * months with a recorded snapshot appear, so the series is sparse until a few
 * months accumulate.
 */
export default function NetWorthCompositionChart() {
  const { t, balanceSnapshots, assets, currentMonth, formatCurrencyShort } = useFinance();

  const data = useMemo(() => {
    const curKey = format(currentMonth, 'yyyy-MM');
    const keys = Array.from(new Set([...Object.keys(balanceSnapshots), curKey])).sort();
    return keys.map(key => {
      const a = key === curKey ? assets : (balanceSnapshots[key]?.assets ?? assets);
      const eq = computeEquityBreakdown(a);
      return {
        label: format(parse(key, 'yyyy-MM', new Date()), 'MMM yy'),
        stocks: Math.round(eq.netInvestment),
        house: Math.round(eq.houseEquity),
        crypto: Math.round(eq.netCrypto),
        cash: Math.round(eq.savingsTotal + a.bsu + a.bufferAccount),
      };
    });
  }, [balanceSnapshots, assets, currentMonth]);

  if (data.length < 2) {
    return (
      <div className="h-full w-full grid place-items-center text-center text-[12px] px-6" style={{ color: 'var(--text-3)' }}>
        {t.charts.buildsOverTime}
      </div>
    );
  }

  const areas: Array<{ key: 'stocks' | 'house' | 'crypto' | 'cash'; name: string; color: string }> = [
    { key: 'house', name: t.charts.house, color: CHART.forest },
    { key: 'stocks', name: t.charts.stocks, color: CHART.forestLight },
    { key: 'cash', name: t.charts.cash, color: CHART.slate },
    { key: 'crypto', name: t.charts.crypto, color: CHART.brass },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.textSoft }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={formatCurrencyShort} tick={{ fontSize: 10, fill: CHART.textDim }} axisLine={false} tickLine={false} width={44} />
        <Tooltip cursor={{ stroke: CHART.rule }} content={<ChartTooltip />} />
        {areas.map(a => (
          <Area
            key={a.key}
            type="monotone"
            dataKey={a.key}
            name={a.name}
            stackId="1"
            stroke={a.color}
            fill={a.color}
            fillOpacity={0.28}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
