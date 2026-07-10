import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import { calcTaxByRegion } from '../../lib/norwegianTax';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';

/**
 * Where your gross salary goes: take-home vs each tax component (donut). Uses
 * the same tax model as the rest of the app. In generic (flat-rate) mode only
 * take-home vs total tax are meaningful, so it collapses to two slices.
 */
export default function TaxBreakdownChart() {
  const { t, region, grossAnnualIncome, customTaxRatePct, pension, annualMortgageInterest, formatCurrency } = useFinance();

  const { slices, effectiveRatePct } = useMemo(() => {
    const b = calcTaxByRegion(grossAnnualIncome, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest);
    const s = region === 'no'
      ? [
          { name: t.charts.netTakeHome, value: Math.max(0, b.netAnnual), color: CHART.forestLight },
          { name: t.charts.incomeTax, value: b.inntektsskatt, color: CHART.rust },
          { name: t.charts.bracketTax, value: b.trinnskatt, color: CHART.brass },
          { name: t.charts.socialSecurity, value: b.trygdeavgift, color: CHART.slate },
        ]
      : [
          { name: t.charts.netTakeHome, value: Math.max(0, b.netAnnual), color: CHART.forestLight },
          { name: t.charts.tax, value: b.totalTax, color: CHART.rust },
        ];
    return { slices: s.filter(x => x.value > 0), effectiveRatePct: b.effectiveRatePct };
  }, [region, grossAnnualIncome, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest, t]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="none">
          {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
        </Pie>
        <Tooltip content={<ChartTooltip hideLabel valueFormatter={(v) => formatCurrency(v)} />} />
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill={CHART.text1} fontSize="22" fontWeight="600">
          {effectiveRatePct.toFixed(0)}%
        </text>
        <text x="50%" y="59%" textAnchor="middle" dominantBaseline="middle" fill={CHART.textDim} fontSize="10" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {t.charts.effectiveRate}
        </text>
      </PieChart>
    </ResponsiveContainer>
  );
}
