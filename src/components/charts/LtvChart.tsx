import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import { calcAmortizationSchedule } from '../../lib/calculations';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

/**
 * Loan-to-value over time for a homeowner: the mortgage shrinks as it amortizes
 * while the property appreciates, so LTV falls year by year. The 85% line is
 * Norway's borrowing cap.
 */
export default function LtvChart() {
  const { t, homeowner, assets, houseGrowthRate } = useFinance();

  const data = useMemo(() => {
    const schedule = homeowner.currentMortgageBalance > 0 && homeowner.nedbetalingstid > 0
      ? calcAmortizationSchedule(homeowner.currentMortgageBalance, homeowner.rente, homeowner.nedbetalingstid)
      : [];
    const years = Math.max(1, Math.round(homeowner.nedbetalingstid));
    const startValue = assets.houseValue || 0;
    return Array.from({ length: years + 1 }, (_, y) => {
      const balance = y === 0 ? homeowner.currentMortgageBalance : (schedule[y - 1]?.balance ?? 0);
      const value = startValue * Math.pow(1 + houseGrowthRate / 100, y);
      const ltv = value > 0 ? (balance / value) * 100 : 0;
      return { year: new Date().getFullYear() + y, ltv: Math.round(ltv * 10) / 10 };
    });
  }, [homeowner, assets.houseValue, houseGrowthRate]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="ltvFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.teal} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART.teal} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="year" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tickFormatter={(v) => `${v}%`} {...AXIS_PROPS_Y} width={40} domain={[0, 'auto']} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} labelFormatter={(l) => String(l)} />} />
        <ReferenceLine y={85} stroke={CHART.rust} strokeDasharray="4 4" label={{ value: t.charts.ltvCap, position: 'insideTopRight', fontSize: 10, fill: CHART.rust }} />
        <Area name={t.charts.ltv} type="monotone" dataKey="ltv" stroke={CHART.teal} strokeWidth={2} fill="url(#ltvFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
