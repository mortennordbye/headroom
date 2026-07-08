import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
  type TooltipContentProps,
} from 'recharts';
import type { FixedExpense } from '../context/FinanceContext';
import { CHART, GRID_PROPS } from '../lib/chartColors';

interface Props {
  data: FixedExpense[];
  totalFixedExpenses: number;
  expenseColor: (type?: FixedExpense['type']) => string;
  formatCurrency: (n: number) => string;
  formatCurrencyShort: (n: number) => string;
  ofFixedCostsLabel: string;
}

/**
 * The fixed-expense distribution bar chart. Split into its own module and
 * lazy-loaded by BudgetPage (the default route) so Recharts (~150 KB gzipped
 * with d3) stays off the first-paint critical path.
 */
export default function BudgetDistributionChart({
  data, totalFixedExpenses, expenseColor, formatCurrency, formatCurrencyShort, ofFixedCostsLabel,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 16, bottom: 4 }}>
        <CartesianGrid {...GRID_PROPS} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          dataKey="name"
          type="category"
          width={88}
          tick={{ fontSize: 11, fill: CHART.textSoft, fontWeight: 500 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: CHART.track }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { name: string; amount: number };
            const pct = totalFixedExpenses > 0 ? (d.amount / totalFixedExpenses) * 100 : 0;
            return (
              <div
                className="rounded-[6px] px-3.5 py-2.5"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)' }}
              >
                <div className="text-[13px] font-semibold text-[var(--text-1)]">{d.name}</div>
                <div className="text-[13px] font-mono text-[var(--text-2)] mt-0.5">{formatCurrency(d.amount)}</div>
                <div className="text-[11px] text-[var(--text-3)] mt-1">
                  {pct.toFixed(1)}% {ofFixedCostsLabel}
                </div>
              </div>
            );
          }}
        />
        <Bar
          dataKey="amount"
          radius={[0, 3, 3, 0]}
          barSize={12}
          background={{ fill: CHART.track, radius: 3 } as unknown as React.ComponentProps<typeof Bar>['background']}
        >
          {data.map((e, i) => (
            <Cell key={`cell-${i}`} fill={expenseColor(e.type)} />
          ))}
          <LabelList
            dataKey="amount"
            position="right"
            offset={10}
            fill={CHART.textSoft}
            fontSize={11}
            fontWeight={600}
            formatter={(v: unknown) => formatCurrencyShort(Number(v ?? 0))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
