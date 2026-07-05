import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';

interface AllocationDonutProps {
  stocks: number;
  house: number;
  cash: number;
  crypto: number;
  pension: number;
}

/**
 * Where net worth sits *right now* — the current mix of stocks, property equity,
 * cash, crypto and pension as a donut. Complements the composition-over-time and
 * projection charts, which are both time series; this answers "how concentrated
 * am I today" at a glance. Pension is included as a bucket even though it's
 * excluded from liquid net equity elsewhere, because this view is about the
 * whole wealth base.
 */
export default function AllocationDonut({ stocks, house, cash, crypto, pension }: AllocationDonutProps) {
  const { t, formatCurrency, formatCurrencyShort } = useFinance();

  const slices = [
    { name: t.charts.stocks, value: Math.max(0, stocks), color: CHART.forestLight },
    { name: t.charts.house, value: Math.max(0, house), color: CHART.forest },
    { name: t.charts.cash, value: Math.max(0, cash), color: CHART.slate },
    { name: t.charts.crypto, value: Math.max(0, crypto), color: CHART.brass },
    { name: t.charts.pension, value: Math.max(0, pension), color: CHART.teal },
  ].filter(s => s.value > 0);

  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) {
    return (
      <div className="h-full w-full grid place-items-center text-center text-[12px] px-6" style={{ color: 'var(--text-3)' }}>
        {t.charts.buildsOverTime}
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="88%" paddingAngle={2} stroke="none">
              {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip hideLabel valueFormatter={(v) => formatCurrency(v)} />} />
            <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fill={CHART.text1} fontSize="18" fontWeight="600">
              {formatCurrencyShort(total)}
            </text>
            <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fill={CHART.textDim} fontSize="10" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t.charts.allocationCenter}
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="shrink-0 flex flex-wrap gap-x-4 gap-y-1.5 pt-3 text-[11px]" style={{ color: 'var(--text-2)' }}>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-3)' }}>
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
