import { useSyncExternalStore } from 'react';
import {
  BarChart, Bar, Cell, LabelList, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot,
} from 'recharts';
import { ResponsiveContainer } from './charts/ResponsiveContainer';
import ChartTooltip from './ChartTooltip';
import { useFinance } from '../context/FinanceContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';
import { niceTicks } from '../lib/format';
import type { HourWaterfall, CurvePoint } from '../lib/companyCost';

const NARROW = '(max-width: 639px)';
const subscribeNarrow = (cb: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
/** True below Tailwind's `sm` breakpoint, where 8 columns do not fit. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}

interface Step {
  label: string;
  hint: string;
  value: number;          // signed kr per hour
  range: [number, number];
  color: string;
  valueLabel: string;
}

/** "Hvor går timeprisen?": one billable hour from list price to the result before bonus and tax. */
export function HourWaterfallChart({ w, salaryHint, realizationPct }: { w: HourWaterfall; salaryHint: string; realizationPct: number }) {
  const { t, lang } = useFinance();
  const c = t.companyModel;
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const nf = (v: number) => Math.round(Math.abs(v)).toLocaleString(locale);
  const signed = (v: number) => `${v < 0 ? '−' : '+'}${nf(v)}`;

  const steps: Step[] = [];
  let run = 0;
  const total = (label: string, hint: string, v: number, color: string, showSign = false) => {
    run = v;
    steps.push({ label, hint, value: v, range: [Math.min(0, v), Math.max(0, v)], color, valueLabel: showSign ? signed(v) : nf(v) });
  };
  const delta = (label: string, hint: string, v: number, color: string) => {
    const next = run + v;
    steps.push({ label, hint, value: v, range: [Math.min(run, next), Math.max(run, next)], color, valueLabel: signed(v) });
    run = next;
  };
  total(c.wfList, c.wfListHint, w.listRate, CHART.brass);
  delta(c.wfRealization, c.wfRealizationHint.replace('{pct}', String(Math.round(realizationPct))), -w.realizationLoss, CHART.rust);
  total(c.wfBilled, c.wfBilledHint, w.billed, CHART.brass);
  delta(c.wfSalary, salaryHint, -w.salary, CHART.text1);
  delta(c.wfOnCosts, c.wfOnCostsHint, -w.onCosts, CHART.teal);
  delta(c.wfSupport, c.wfSupportHint, -w.support, CHART.teal);
  delta(c.wfOther, c.wfOtherHint, -w.other, CHART.teal);
  const resultPct = w.billed > 0 ? Math.round(w.result / w.billed * 100) : 0;
  total(c.wfResult, c.wfResultHint.replace('{pct}', String(resultPct)), w.result, w.result >= 0 ? CHART.forestLight : CHART.rust, true);

  const wfTicks = niceTicks(Math.min(...steps.map((s) => s.range[0])), Math.max(...steps.map((s) => s.range[1])), 4);

  const tooltip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Step }> }) => {
    const s = payload?.[0]?.payload;
    if (!active || !s) return null;
    return (
      <ChartTooltip
        active
        payload={[{ value: s.value }]}
        title={s.label}
        hideNames
        valueFormatter={(v) => `${signed(v)} kr/${t.common.hourUnit}`}
        extra={s.hint}
      />
    );
  };

  if (narrow) {
    return (
      <div style={{ height: steps.length * 34 + 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={steps} layout="vertical" margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
            <XAxis type="number" hide domain={['dataMin', 'dataMax']} />
            <YAxis type="category" dataKey="label" {...AXIS_PROPS} width={112} interval={0} />
            <Tooltip content={tooltip} cursor={{ fill: CHART.surface2 }} />
            <Bar dataKey="range" isAnimationActive={!reduced} radius={3} barSize={14}>
              {steps.map((s) => <Cell key={s.label} fill={s.color} />)}
              <LabelList dataKey="valueLabel" position="right" style={{ fontSize: 11, fill: CHART.text1, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={steps} margin={{ top: 24, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID_PROPS} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} interval={0} tick={{ fontSize: 11, fill: CHART.textSoft }} height={40} />
          <YAxis
            {...AXIS_PROPS_Y} width={48} ticks={wfTicks} domain={[wfTicks[0], wfTicks[wfTicks.length - 1]]}
            tickFormatter={(v: number) => Math.round(v).toLocaleString(locale)}
          />
          <Tooltip content={tooltip} cursor={{ fill: CHART.surface2 }} />
          <ReferenceLine y={0} stroke={CHART.textDim} />
          <Bar dataKey="range" isAnimationActive={!reduced} radius={3} maxBarSize={64}>
            {steps.map((s) => <Cell key={s.label} fill={s.color} />)}
            <LabelList dataKey="valueLabel" position="top" style={{ fontSize: 11, fill: CHART.text1, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** EBIT against the delivery staff's mean billable share, now (with levers) and at the baseline. */
export function UtilizationCurveChart({
  points, nowUtil, nowEbit, baseUtil, baseEbit, breakEven,
}: {
  points: CurvePoint[];
  nowUtil: number;
  nowEbit: number;
  baseUtil: number;
  baseEbit: number;
  breakEven: number | null;
}) {
  const { t, lang, formatCurrencyShort } = useFinance();
  const c = t.companyModel;
  const reduced = useReducedMotion();
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const values = points.flatMap((p) => [p.ebit, p.baselineEbit]);
  const yTicks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = yTicks[0];
  const hi = yTicks[yTicks.length - 1];
  // No-break space, so Recharts does not wrap "−10 mill" onto two lines.
  const millions = (v: number) => c.millions.replace('{v}', (v / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })).replace(/ /g, ' ');
  // Where 0 sits in the area's own range (its values only), to split green / rust.
  const aHi = Math.max(...points.map((p) => p.ebit), 0);
  const aLo = Math.min(...points.map((p) => p.ebit), 0);
  const zeroAt = aHi - aLo > 0 ? aHi / (aHi - aLo) : 1;
  const from = points[0]?.utilizationPct ?? 50;
  const to = points[points.length - 1]?.utilizationPct ?? 95;
  const inRange = (u: number) => u >= from && u <= to;

  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 22, right: 12, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="companyEbitSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={zeroAt} stopColor={CHART.forest} stopOpacity={0.6} />
              <stop offset={zeroAt} stopColor={CHART.rust} stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} vertical={false} />
          <XAxis
            dataKey="utilizationPct" type="number" domain={[from, to]} {...AXIS_PROPS}
            ticks={[50, 60, 70, 80, 90].filter(inRange)} tickFormatter={(v: number) => `${v} %`}
          />
          <YAxis {...AXIS_PROPS_Y} width={60} domain={[lo, hi]} ticks={yTicks} tickFormatter={millions} />
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={(v) => formatCurrencyShort(v)}
                labelFormatter={(l) => c.curveTooltip.replace('{pct}', String(Math.round(Number(l))))}
              />
            }
          />
          <ReferenceLine y={0} stroke={CHART.textDim} />
          <Area
            dataKey="ebit" name={c.curveNow} type="linear" stroke="none" fill="url(#companyEbitSplit)"
            baseValue={0} isAnimationActive={!reduced} tooltipType="none"
          />
          <Line dataKey="baselineEbit" name={c.curveBaseline} type="linear" stroke={CHART.textSoft} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={!reduced} />
          <Line dataKey="ebit" name={c.curveNow} type="linear" stroke={CHART.forestLight} strokeWidth={2} dot={false} isAnimationActive={!reduced} />
          {breakEven != null && inRange(breakEven) && (
            <ReferenceLine
              x={breakEven} stroke={CHART.rust} strokeDasharray="3 3"
              label={{ value: c.curveBreakEven.replace('{pct}', String(Math.round(breakEven))), position: 'insideTopRight', fill: CHART.rust, fontSize: 11 }}
            />
          )}
          {inRange(baseUtil) && <ReferenceDot x={baseUtil} y={baseEbit} r={4} fill={CHART.bgCard} stroke={CHART.textSoft} strokeWidth={1.5} />}
          {inRange(nowUtil) && <ReferenceDot x={nowUtil} y={nowEbit} r={6} fill={CHART.brass} stroke={CHART.bgCard} strokeWidth={2} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
