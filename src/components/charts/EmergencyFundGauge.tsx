import { useMemo } from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import { calcEmergencyFundStatus } from '../../lib/calculations';
import { CHART } from '../../lib/chartColors';

const STATUS_COLOR = { low: CHART.rust, adequate: CHART.brass, strong: CHART.forestLight } as const;

/**
 * Emergency-fund runway as a radial gauge: months of essential (fixed) expenses
 * the buffer account covers, against the conventional 3–6 month band.
 */
export default function EmergencyFundGauge() {
  const { t, lang, assets, totalFixedExpenses } = useFinance();

  const ef = useMemo(
    () => calcEmergencyFundStatus(assets.bufferAccount, totalFixedExpenses),
    [assets.bufferAccount, totalFixedExpenses],
  );

  const finite = Number.isFinite(ef.monthsCovered);
  const color = STATUS_COLOR[ef.status];
  const shown = finite ? Math.min(ef.monthsCovered, ef.targetMonths) : ef.targetMonths;
  const data = [{ name: 'covered', value: shown, fill: color }];
  const mo = lang === 'nb' ? 'mnd' : 'mo';

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          startAngle={220}
          endAngle={-40}
          innerRadius="72%"
          outerRadius="100%"
          barSize={12}
        >
          <PolarAngleAxis type="number" domain={[0, ef.targetMonths]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: CHART.track }} angleAxisId={0} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="text-center">
          <div className="text-[24px] font-mono font-semibold leading-none" style={{ color: 'var(--text-1)' }}>
            {finite ? `${ef.monthsCovered.toFixed(1)}` : '∞'}
          </div>
          <div className="text-[10px] uppercase tracking-[0.08em] mt-1" style={{ color: 'var(--text-3)' }}>
            {mo} · {t.charts.covered}
          </div>
        </div>
      </div>
    </div>
  );
}
