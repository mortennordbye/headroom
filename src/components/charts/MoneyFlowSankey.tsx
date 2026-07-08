import { useMemo } from 'react';
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import { calcTaxByRegion } from '../../lib/norwegianTax';
import ChartTooltip from '../ChartTooltip';
import { CHART } from '../../lib/chartColors';

// Node colour by name (order-independent).
const NODE_COLOR: Record<string, string> = {
  gross: CHART.brass,
  net: CHART.forestLight,
  tax: CHART.rust,
  fixed: CHART.teal,
  savings: CHART.forest,
  discretionary: CHART.slate,
};

interface NodeProps {
  x: number; y: number; width: number; height: number;
  index: number;
  payload: { name: string; label: string; color: string; value: number };
  containerWidth: number;
}

function SankeyNode({ x, y, width, height, index, payload, containerWidth }: NodeProps) {
  const isLeft = x < containerWidth / 2;
  return (
    <Layer key={`node-${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={payload.color} fillOpacity={0.9} radius={2} />
      <text
        x={isLeft ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={isLeft ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={11}
        fill={CHART.textSoft}
      >
        {payload.label}
      </text>
    </Layer>
  );
}

/**
 * Where a month's gross salary flows: gross → tax + net, then net → fixed
 * expenses, savings, and discretionary. Monthly figures from the app's tax
 * model and budget.
 */
export default function MoneyFlowSankey() {
  const {
    t, region, grossAnnualIncome, customTaxRatePct, pension,
    totalFixedExpenses, recommendedInvestment, formatCurrency,
  } = useFinance();

  const data = useMemo(() => {
    const b = calcTaxByRegion(grossAnnualIncome, region, customTaxRatePct, pension.ipsAnnualContribution);
    const grossM = grossAnnualIncome / 12;
    const taxM = b.totalTax / 12;
    const netM = b.netMonthly;
    const fixed = Math.min(totalFixedExpenses, netM);
    const savings = Math.min(recommendedInvestment, Math.max(0, netM - fixed));
    const discretionary = Math.max(0, netM - fixed - savings);

    // Round the remainder bucket LAST so the net node's outflows sum exactly to
    // its inflow, and drop zero links entirely — a genuinely empty bucket must
    // not render as a fabricated 1 kr flow.
    const roundedTax = Math.round(taxM);
    const roundedNet = Math.round(netM);
    const roundedFixed = Math.round(fixed);
    const roundedSavings = Math.round(savings);
    const roundedDiscretionary = discretionary > 0
      ? Math.max(0, roundedNet - roundedFixed - roundedSavings)
      : 0;

    const c = t.charts;
    const allNodes = [
      { name: 'gross', label: c.gross, color: NODE_COLOR.gross },
      { name: 'tax', label: c.tax, color: NODE_COLOR.tax },
      { name: 'net', label: c.netTakeHome, color: NODE_COLOR.net },
      { name: 'fixed', label: c.fixedExpenses, color: NODE_COLOR.fixed },
      { name: 'savings', label: c.savings, color: NODE_COLOR.savings },
      { name: 'discretionary', label: c.discretionary, color: NODE_COLOR.discretionary },
    ];
    const rawLinks = [
      { source: 0, target: 1, value: roundedTax },
      { source: 0, target: 2, value: roundedNet },
      { source: 2, target: 3, value: roundedFixed },
      { source: 2, target: 4, value: roundedSavings },
      { source: 2, target: 5, value: roundedDiscretionary },
    ].filter(l => l.value > 0);
    // Nodes left without any flow are removed, so link indices must be remapped.
    const usedIdx = [...new Set(rawLinks.flatMap(l => [l.source, l.target]))].sort((a, b) => a - b);
    const remap = new Map(usedIdx.map((oldIdx, newIdx) => [oldIdx, newIdx]));
    const nodes = usedIdx.map(i => allNodes[i]);
    const links = rawLinks.map(l => ({ ...l, source: remap.get(l.source)!, target: remap.get(l.target)! }));
    return { nodes, links, grossM };
  }, [region, grossAnnualIncome, customTaxRatePct, pension.ipsAnnualContribution, totalFixedExpenses, recommendedInvestment, t]);

  if (!(data.grossM > 0)) {
    return (
      <div className="h-full w-full grid place-items-center text-[12px]" style={{ color: 'var(--text-3)' }}>
        {t.charts.buildsOverTime}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Sankey
        data={{ nodes: data.nodes, links: data.links }}
        node={<SankeyNode {...({} as NodeProps)} />}
        nodePadding={26}
        nodeWidth={10}
        link={{ stroke: CHART.slate, strokeOpacity: 0.18 }}
        margin={{ top: 10, right: 90, bottom: 10, left: 12 }}
      >
        <Tooltip content={<ChartTooltip hideLabel valueFormatter={(v) => formatCurrency(v)} />} />
      </Sankey>
    </ResponsiveContainer>
  );
}
