import { useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, parse } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../../context/FinanceContext';
import { calcAmortizationSchedule } from '../../lib/calculations';
import ChartTooltip from '../ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';

interface LtvRow {
  label: string;
  actual: number | null;
  projected: number | null;
}

/**
 * Loan-to-value over time. Recorded months are drawn as *actual* LTV (solid,
 * snapshot houseDebt / houseValue); the amortization projection continues from
 * the latest actual point (dashed) instead of always starting at "now". The 85%
 * line is Norway's borrowing cap. Every division guards houseValue 0 → 0, never NaN.
 */
export default function LtvChart() {
  const { t, lang, homeowner, assets, houseGrowthRate, balanceSnapshots } = useFinance();
  const c = t.charts;
  const dateLocale = lang === 'nb' ? nb : enUS;

  const data = useMemo<LtvRow[]>(() => {
    const round1 = (v: number) => Math.round(v * 10) / 10;
    // Finite-or-0: `?? 0` catches undefined but not a NaN from hand-edited data,
    // which would otherwise divide into a NaN LTV point (CLAUDE.md's worst bug class).
    const finite = (n: number | undefined) => (Number.isFinite(n) ? (n as number) : 0);

    // Actual LTV per recorded month.
    const months = Object.keys(balanceSnapshots).sort();
    const actual: LtvRow[] = months.map(mk => {
      const s = balanceSnapshots[mk];
      const hb = finite(s.homeowner?.currentMortgageBalance);
      const debt = hb > 0 ? hb : finite(s.assets?.houseDebt);
      const value = finite(s.assets?.houseValue);
      const ltv = value > 0 ? (debt / value) * 100 : 0;
      return {
        label: format(parse(mk, 'yyyy-MM', new Date()), 'MMM yy', { locale: dateLocale }),
        actual: round1(ltv),
        projected: null,
      };
    });

    // Projection anchored at the latest actual balance/value (or live if none).
    const anchorDebt = homeowner.currentMortgageBalance;
    const anchorValue = assets.houseValue || 0;
    const schedule = anchorDebt > 0 && homeowner.nedbetalingstid > 0
      ? calcAmortizationSchedule(anchorDebt, homeowner.rente, homeowner.nedbetalingstid)
      : [];
    const years = Math.max(1, Math.round(homeowner.nedbetalingstid));
    const projected: LtvRow[] = Array.from({ length: years + 1 }, (_, y) => {
      const balance = y === 0 ? anchorDebt : (schedule[y - 1]?.balance ?? 0);
      const value = anchorValue * Math.pow(1 + houseGrowthRate / 100, y);
      const ltv = value > 0 ? (balance / value) * 100 : 0;
      return {
        label: String(new Date().getFullYear() + y),
        actual: null,
        projected: round1(ltv),
      };
    });

    // Stitch the dashed projection onto the last actual point so the two lines meet.
    if (actual.length > 0) {
      actual[actual.length - 1].projected = actual[actual.length - 1].actual;
      return [...actual, ...projected.slice(1)];
    }
    return projected;
  }, [balanceSnapshots, homeowner, assets.houseValue, houseGrowthRate, dateLocale]);

  return (
    <div role="img" aria-label={c.aria.ltv} className="w-full h-full">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tickFormatter={(v) => `${v}%`} {...AXIS_PROPS_Y} width={40} domain={[0, 'auto']} />
        <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(1)}%`} labelFormatter={(l) => String(l)} />} />
        <ReferenceLine y={85} stroke={CHART.rust} strokeDasharray="4 4" label={{ value: c.ltvCap, position: 'insideTopRight', fontSize: 10, fill: CHART.rust }} />
        <Line name={c.ltvProjected} type="monotone" dataKey="projected" stroke={CHART.teal} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
        <Line name={c.ltvActual} type="monotone" dataKey="actual" stroke={CHART.teal} strokeWidth={2} dot={{ r: 2 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
