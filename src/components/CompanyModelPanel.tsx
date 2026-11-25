import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BarChart3, Pencil, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import {
  calcCompany, hourWaterfall, breakEvenUtilization, utilizationCurve, applyLevers, NEUTRAL_LEVERS,
  type CompanyModel, type CompanyContext, type CompanyResult, type CompanyGroup, type CompanyCostLine,
  type CompanyLevers, type CostLinePer,
} from '../lib/companyCost';
import { weekdayHolidays, corporateTaxPct } from '../lib/norwegianCalendar';
import { parseLocaleNumber } from '../lib/validators';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';
import { SummaryTile } from './ui/SummaryTile';
import { SliderRow } from './ui/SliderRow';
import { NumberRow } from './ui/NumberRow';
import { Button } from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import { FitText } from './ui/FitText';
import { HourWaterfallChart, UtilizationCurveChart } from './CompanyModelCharts';

const LEVERS: Array<{ key: keyof CompanyLevers; min: number; max: number; unit: string }> = [
  { key: 'utilizationPp', min: -25, max: 12, unit: 'pp' },
  { key: 'ratePct', min: -15, max: 15, unit: '%' },
  { key: 'salaryPct', min: -10, max: 15, unit: '%' },
  { key: 'realizationPp', min: -15, max: 7, unit: 'pp' },
];

/**
 * The employer-cost page's Avansert mode: your salary inside a whole
 * consultancy. All numbers come from src/lib/companyCost.ts; this component
 * only lays them out and edits `companyModel`.
 */
export function CompanyModelPanel({
  model, setModel, ctx, result,
}: {
  model: CompanyModel;
  setModel: Dispatch<SetStateAction<CompanyModel>>;
  ctx: CompanyContext;
  result: CompanyResult;
}) {
  const { t, lang, formatCurrencyShort } = useFinance();
  const c = t.companyModel;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const nf = (v: number, d = 0) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const kr = formatCurrencyShort;
  const perHour = (v: number) => `${kr(v)}/${t.common.hourUnit}`;
  const r = result;
  const y = r.you;

  const baseline = useMemo(() => calcCompany(model, ctx, NEUTRAL_LEVERS), [model, ctx]);
  const curve = useMemo(() => utilizationCurve(model, ctx), [model, ctx]);
  const breakEven = useMemo(() => breakEvenUtilization(model, ctx), [model, ctx]);
  const waterfall = hourWaterfall(r);

  const update = (patch: Partial<CompanyModel>) => setModel((m) => ({ ...m, ...patch }));
  const setLever = (key: keyof CompanyLevers, v: number) => setModel((m) => ({ ...m, levers: { ...m.levers, [key]: v } }));
  const leversMoved = LEVERS.some((l) => model.levers[l.key] !== 0);

  const delta = (diff: number, fmt: (v: number) => string, goodUp = true) => {
    if (Math.abs(diff) < 0.005) return <span style={{ color: 'var(--text-3)' }}>{c.sameAsBaseline}</span>;
    const good = goodUp ? diff > 0 : diff < 0;
    return (
      <>
        <span style={{ color: good ? 'var(--positive)' : 'var(--negative)' }}>{diff > 0 ? '▲ ' : '▼ '}{fmt(Math.abs(diff))}</span> {c.vsBaseline}
      </>
    );
  };

  const leverLabel: Record<keyof CompanyLevers, string> = {
    utilizationPp: c.leverUtilization, ratePct: c.leverRate, salaryPct: c.leverSalary, realizationPp: c.leverRealization,
  };

  // ② Hours (you)
  const h = r.hours;
  const self = r.groups.find((g) => g.id === model.selfGroupId);
  const bench = Math.max(0, h.available - y.billableHours);
  const free = h.publicHolidayHours + h.holidayHours;
  const hourSegs = [
    { key: 'billed', label: c.segBilled, value: y.billableHours, color: 'var(--forest-light)', hint: c.segBilledHint },
    { key: 'bench', label: c.segBench, value: bench, color: 'var(--rust)', hint: c.segBenchHint },
    { key: 'free', label: c.segFree, value: free, color: 'var(--teal)', hint: c.segFree },
    { key: 'sick', label: c.segSick, value: h.sick, color: 'var(--slate)', hint: `${nf(model.hours.sickPct, 1)} %` },
    { key: 'internal', label: c.segInternal, value: h.internal, color: 'var(--slate)', hint: `${nf(model.hours.internalPct, 1)} %` },
  ];

  // ④ Each 100 of revenue
  const per100 = (v: number) => (r.revenue > 0 ? Math.max(0, v) / r.revenue * 100 : 0);
  const revenueSegs = [
    { key: 'people', label: c.segPeople, value: per100(r.peopleCost), color: 'var(--teal)', hint: c.plPeopleSub },
    { key: 'other', label: c.segOther, value: per100(r.linesTotal), color: 'var(--slate)', hint: c.plOther },
    { key: 'bonus', label: c.segBonus, value: per100(r.bonus), color: 'var(--brass-dim)', hint: c.plBonusSub },
    { key: 'result', label: c.segResult, value: per100(r.ebit), color: 'var(--forest-light)', hint: c.plEbit },
  ];

  const perLabel: Record<CostLinePer, string> = { company: c.perCompany, head: c.perHead, pctOfSalary: c.perPctOfSalary };

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <SummaryTile label={c.tileOwn} value={kr(y.ownCost)} sub={c.tileOwnSub} color="var(--teal)" />
        <SummaryTile label={c.tileShare} value={`${y.share >= 0 ? '+' : '−'}${kr(Math.abs(y.share))}`} sub={c.tileShareSub.replace('{fte}', nf(r.deliveryFte, 1).replace(/[,.]0$/, ''))} />
        <SummaryTile
          label={c.tileReal}
          value={kr(y.realCost)}
          sub={c.tileRealSub.replace('{pct}', nf(y.gross > 0 ? (y.realCost / y.gross - 1) * 100 : 0))}
        />
        <SummaryTile
          label={c.tileBreakEven}
          value={perHour(y.breakEvenRate)}
          sub={c.tileBreakEvenSub.replace('{hours}', nf(y.billableHours))}
          color="var(--teal)"
        />
      </div>

      {/* Waterfall */}
      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <SectionLabel icon={<BarChart3 />}>{c.wfTitle}</SectionLabel>
          <span className="text-[12px] font-mono" style={{ color: 'var(--brass)' }}>{c.wfTag}</span>
        </div>
        <p className="mt-3 mb-4 text-[12px]" style={{ color: 'var(--text-3)' }}>{c.wfIntro}</p>
        <HourWaterfallChart
          w={waterfall}
          realizationPct={y.realizationPct}
          salaryHint={c.wfSalaryHint.replace('{gross}', kr(y.gross)).replace('{hours}', nf(y.billableHours))}
        />
        <p className="mt-2 text-[12px] text-center" style={{ color: 'var(--text-2)' }}>
          {c.wfRealCost.replace('{rate}', kr(y.breakEvenRate))}
        </p>
      </Card>

      {/* Levers + curve */}
      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <SectionLabel icon={<Settings2 />}>{c.leversTitle}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} disabled={!leversMoved} onClick={() => update({ levers: { ...NEUTRAL_LEVERS } })}>
              {c.resetLevers}
            </Button>
            <Button size="sm" variant="primary" disabled={!leversMoved} onClick={() => setModel((m) => applyLevers(m))}>
              {c.saveBaseline}
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-8 gap-y-6">
          <div>
            <p className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>{c.leversIntro}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              {LEVERS.map((l) => (
                <SliderRow
                  key={l.key}
                  label={leverLabel[l.key]}
                  value={model.levers[l.key]}
                  onChange={(v) => setLever(l.key, v)}
                  min={l.min}
                  max={l.max}
                  step={1}
                  suffix={l.unit}
                />
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <SectionLabel>{c.curveTitle}</SectionLabel>
              <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--brass)' }} />{c.curveNow}</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed" style={{ borderColor: 'var(--text-2)' }} />{c.curveBaseline}</span>
              </div>
            </div>
            <UtilizationCurveChart
              points={curve}
              nowUtil={r.meanUtilizationPct}
              nowEbit={r.ebit}
              baseUtil={baseline.meanUtilizationPct}
              baseEbit={baseline.ebit}
              breakEven={breakEven?.utilizationPct ?? null}
            />
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>{c.curveXHint}</p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat
                label={c.statEbit}
                value={kr(r.ebit)}
                color={r.ebit < 0 ? 'var(--negative)' : 'var(--positive)'}
                sub={delta(r.ebit - baseline.ebit, (v) => kr(v))}
              />
              <Stat label={c.statMargin} value={`${nf(r.marginPct, 1)} %`} sub={delta(r.marginPct - baseline.marginPct, (v) => `${nf(v, 1)} pp`)} />
              <Stat label={c.statBreakEven} value={perHour(y.breakEvenRate)} sub={delta(y.breakEvenRate - baseline.you.breakEvenRate, perHour, false)} />
            </div>
          </div>
        </div>
      </Card>

      {/* ①–④ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 items-start">
        <div className="space-y-4 md:space-y-6">
          <Section
            title={`① ${c.peopleTitle}`}
            summary={c.peopleSummary.replace('{heads}', nf(r.heads, 1).replace(/[,.]0$/, '')).replace('{fte}', nf(r.deliveryFte, 1).replace(/[,.]0$/, ''))}
            why={c.peopleWhy}
          >
            <PeopleEditor model={model} setModel={setModel} />
          </Section>

          <Section title={`② ${c.hoursTitle}`} summary={c.hoursSummary.replace('{hours}', nf(y.billableHours))} why={c.hoursWhy.replace('{paid}', nf(h.paid))}>
            <FlexBar segs={hourSegs} fmt={(v) => `${nf(v)} ${t.common.hourUnit}`} />
            <div className="mt-4">
              <Row label={c.rowWeekdays.replace('{year}', String(ctx.year)).replace('{hpd}', nf(ctx.hoursPerDay, 1))} value={`${nf(h.paid, 1)} ${t.common.hourUnit}`} />
              <Row
                label={c.rowFree.replace('{holidays}', String(weekdayHolidays(ctx.year)))}
                sub={<InlineNumber value={model.hours.holidayDays} onCommit={(v) => update({ hours: { ...model.hours, holidayDays: Math.min(366, Math.max(0, v)) } })} suffix={c.rowHolidayDays} ariaLabel={c.rowHolidayDays} />}
                value={`−${nf(free, 1)} ${t.common.hourUnit}`}
              />
              <Row
                label={c.rowSick}
                sub={<InlineNumber value={model.hours.sickPct} onCommit={(v) => update({ hours: { ...model.hours, sickPct: Math.min(100, Math.max(0, v)) } })} suffix="%" ariaLabel={c.segSick} />}
                value={`−${nf(h.sick)} ${t.common.hourUnit}`}
              />
              <Row
                label={c.rowInternal}
                sub={<InlineNumber value={model.hours.internalPct} onCommit={(v) => update({ hours: { ...model.hours, internalPct: Math.min(100, Math.max(0, v)) } })} suffix="%" ariaLabel={c.segInternal} />}
                value={`−${nf(h.internal)} ${t.common.hourUnit}`}
              />
              <Row label={c.rowAvailable} value={`${nf(h.available)} ${t.common.hourUnit}`} muted />
              <Row label={c.rowShare} sub={self ? `${self.billablePct.toLocaleString(locale, { maximumFractionDigits: 1 })} %` : '–'} value="" />
              <Row label={c.rowBillable} value={`${nf(y.billableHours)} ${t.common.hourUnit}`} emphasis />
            </div>
          </Section>
        </div>

        <div className="space-y-4 md:space-y-6">
          <Section title={`③ ${c.costsTitle}`} summary={c.costsSummary.replace('{perHour}', kr(r.overheadPerBillableHour))} why={c.costsWhy}>
            <CostEditor model={model} setModel={setModel} perLabel={perLabel} />
            <Row
              label={c.bonusPool}
              sub={c.bonusPoolSub}
              value={<InlineNumber value={model.bonus.poolPct} onCommit={(v) => update({ bonus: { ...model.bonus, poolPct: Math.min(100, Math.max(0, v)) } })} suffix="%" ariaLabel={c.bonusPool} />}
            />
            <Row label={c.sumYear} sub={c.sumYearSub} value={kr(r.linesTotal)} emphasis />
          </Section>

          <Section title={`④ ${c.resultTitle}`} summary={c.resultSummary.replace('{pct}', nf(r.marginPct, 1))}>
            <Row label={c.plRevenue} sub={c.plRevenueSub} value={kr(r.revenue)} />
            <Row label={c.plPeople} sub={c.plPeopleSub} value={`− ${kr(r.peopleCost)}`} />
            <Row label={c.plOther} value={`− ${kr(r.linesTotal)}`} />
            <Row label={c.plBonus} sub={c.plBonusSub} value={`− ${kr(r.bonus)}`} />
            <Row label={c.plEbit} value={<span style={{ color: r.ebit < 0 ? 'var(--negative)' : 'var(--positive)' }}>{kr(r.ebit)}</span>} emphasis />
            <Row label={c.plTax.replace('{pct}', String(corporateTaxPct(ctx.year)))} value={kr(r.afterTax)} muted />
            <div className="mt-5">
              <SectionLabel className="mb-2">{c.hundredTitle}</SectionLabel>
              <FlexBar segs={revenueSegs} fmt={(v) => `${nf(v, 1)} kr`} legendFmt={(v) => `${nf(v)} kr`} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat label={c.kpiRevenuePerFte} value={kr(r.kpis.revenuePerFte)} />
              <Stat label={c.kpiMargin} value={kr(r.kpis.grossMarginPerFte)} />
              <Stat label={c.kpiDeliveryShare} value={`${nf(r.kpis.deliverySharePct)} %`} />
              <Stat label={c.kpiUtilReal} value={`${nf(r.meanUtilizationPct)} % · ${nf(y.realizationPct)} %`} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── ① People ─────────────────────────────────────────────────────────

function PeopleEditor({ model, setModel }: { model: CompanyModel; setModel: Dispatch<SetStateAction<CompanyModel>> }) {
  const { t, lang } = useFinance();
  const c = t.companyModel;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const nf = (v: number) => Math.round(v).toLocaleString(locale);
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (id: string, p: Partial<CompanyGroup>) =>
    setModel((m) => ({ ...m, groups: m.groups.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  const remove = (id: string) => setModel((m) => {
    const groups = m.groups.filter((g) => g.id !== id);
    const selfGroupId = m.selfGroupId === id ? (groups.find((g) => g.kind === 'delivery')?.id ?? null) : m.selfGroupId;
    return { ...m, groups, selfGroupId };
  });
  const add = () => {
    const id = crypto.randomUUID();
    setModel((m) => ({
      ...m,
      groups: [...m.groups, { id, name: c.newGroup, kind: 'delivery', count: 1, avgGross: 700_000, billablePct: 80, hourlyRate: 1200, realizationPct: 95 }],
      selfGroupId: m.selfGroupId ?? id,
    }));
    setEditing(id);
  };

  return (
    <div className="space-y-2.5">
      {model.groups.map((g) => {
        const isSelf = g.id === model.selfGroupId;
        return (
          <div key={g.id} className="rounded-[8px] px-3.5 py-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--text-1)' }}>{g.name || '–'}</span>
                {isSelf && <Badge tone="brass">{c.you}</Badge>}
                <Badge>{g.kind === 'delivery' ? c.delivery : c.support}</Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[13px] font-mono tabular-nums mr-1" style={{ color: 'var(--text-1)' }}>{g.count.toLocaleString(locale)}</span>
                <IconButton label={editing === g.id ? c.done : c.edit} onClick={() => setEditing(editing === g.id ? null : g.id)}><Pencil /></IconButton>
              </div>
            </div>
            <div className="mt-1 text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
              {c.groupFixed.replace('{gross}', nf(g.avgGross)).replace('{billable}', String(g.billablePct))}
              {g.hourlyRate > 0 && ` · ${c.groupRate.replace('{rate}', nf(g.hourlyRate)).replace('{real}', String(g.realizationPct))}`}
            </div>
            {editing === g.id && (
              <div className="mt-4 pt-4 border-t space-y-4" style={{ borderColor: 'var(--border)' }}>
                <TextRow label={c.fieldName} value={g.name} onCommit={(v) => patch(g.id, { name: v })} />
                <div className="flex flex-wrap items-center gap-3">
                  <SegmentedControl<CompanyGroup['kind']>
                    ariaLabel={c.fieldKind}
                    value={g.kind}
                    onChange={(kind) => patch(g.id, { kind })}
                    items={[{ value: 'delivery', label: c.delivery }, { value: 'support', label: c.support }]}
                  />
                  <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
                    <input type="radio" name="company-self-group" checked={isSelf} onChange={() => setModel((m) => ({ ...m, selfGroupId: g.id }))} style={{ accentColor: 'var(--accent)' }} />
                    {c.isYourGroup}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <NumberRow label={c.fieldCount} value={g.count} onCommit={(v) => patch(g.id, { count: Math.max(0, v) })} />
                  <NumberRow label={c.fieldGross} value={g.avgGross} onCommit={(v) => patch(g.id, { avgGross: Math.max(0, v) })} suffix={t.common.krPerYear} />
                  <NumberRow label={c.fieldBillable} value={g.billablePct} onCommit={(v) => patch(g.id, { billablePct: Math.min(100, Math.max(0, v)) })} suffix="%" />
                  <NumberRow label={c.fieldRate} value={g.hourlyRate} onCommit={(v) => patch(g.id, { hourlyRate: Math.max(0, v) })} suffix={`kr/${t.common.hourUnit}`} />
                  <NumberRow label={c.fieldRealization} value={g.realizationPct} onCommit={(v) => patch(g.id, { realizationPct: Math.min(100, Math.max(0, v)) })} suffix="%" />
                </div>
                <div className="flex justify-between gap-2">
                  <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => { remove(g.id); setEditing(null); }}>{c.remove}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>{c.done}</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <AddButton onClick={add}>{c.addGroup}</AddButton>
    </div>
  );
}

// ─── ③ Cost lines ─────────────────────────────────────────────────────

function CostEditor({
  model, setModel, perLabel,
}: {
  model: CompanyModel;
  setModel: Dispatch<SetStateAction<CompanyModel>>;
  perLabel: Record<CostLinePer, string>;
}) {
  const { t, lang, formatCurrencyShort } = useFinance();
  const c = t.companyModel;
  const locale = lang === 'nb' ? 'nb-NO' : 'en-US';
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (id: string, p: Partial<CompanyCostLine>) =>
    setModel((m) => ({ ...m, costs: m.costs.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  const remove = (id: string) => setModel((m) => ({ ...m, costs: m.costs.filter((l) => l.id !== id) }));
  const add = () => {
    const id = crypto.randomUUID();
    setModel((m) => ({ ...m, costs: [...m.costs, { id, label: c.newCost, amount: 0, per: 'company' }] }));
    setEditing(id);
  };

  return (
    <div>
      {model.costs.map((l) => (
        <div key={l.id}>
          <Row
            label={l.label || '–'}
            sub={perLabel[l.per]}
            value={(
              <span className="inline-flex items-center gap-1">
                {l.per === 'pctOfSalary' ? `${l.amount.toLocaleString(locale, { maximumFractionDigits: 2 })} %` : formatCurrencyShort(l.amount)}
                <IconButton label={editing === l.id ? c.done : c.edit} onClick={() => setEditing(editing === l.id ? null : l.id)}><Pencil /></IconButton>
              </span>
            )}
          />
          {editing === l.id && (
            <div className="mb-3 rounded-[8px] px-3.5 py-3 space-y-4" style={{ background: 'var(--surface-2)' }}>
              <TextRow label={c.fieldLabel} value={l.label} onCommit={(v) => patch(l.id, { label: v })} />
              <div className="flex flex-wrap items-end gap-4">
                <SegmentedControl<CostLinePer>
                  ariaLabel={c.fieldPer}
                  value={l.per}
                  onChange={(per) => patch(l.id, { per })}
                  items={[
                    { value: 'company', label: perLabel.company },
                    { value: 'head', label: perLabel.head },
                    { value: 'pctOfSalary', label: perLabel.pctOfSalary },
                  ]}
                />
              </div>
              <NumberRow
                label={c.fieldAmount}
                value={l.amount}
                onCommit={(v) => patch(l.id, { amount: Math.max(0, v) })}
                suffix={l.per === 'pctOfSalary' ? '%' : 'kr'}
              />
              <div className="flex justify-between gap-2">
                <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => { remove(l.id); setEditing(null); }}>{c.remove}</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>{c.done}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="py-2"><AddButton onClick={add}>{c.addCost}</AddButton></div>
    </div>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────

function Section({ title, summary, why, children }: { title: string; summary: string; why?: string; children: ReactNode }) {
  return (
    <Card padding="lg">
      <details open className="group">
        <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <SectionLabel>
            {title} <span aria-hidden className="inline-block transition-transform group-open:rotate-0 -rotate-90">▾</span>
          </SectionLabel>
          <span className="text-[12px] font-mono" style={{ color: 'var(--brass)' }}>{summary}</span>
        </summary>
        {why && <p className="mt-3 text-[12px]" style={{ color: 'var(--text-3)' }}>{why}</p>}
        <div className="mt-4">{children}</div>
      </details>
    </Card>
  );
}

function Row({ label, sub, value, muted, emphasis }: { label: string; sub?: ReactNode; value: ReactNode; muted?: boolean; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
      <span className={`text-[13px] min-w-0 [overflow-wrap:anywhere] ${emphasis ? 'font-semibold' : ''}`} style={{ color: muted ? 'var(--text-3)' : emphasis ? 'var(--text-1)' : 'var(--text-2)' }}>
        {label}
        {sub != null && <span className="ml-2 text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{sub}</span>}
      </span>
      <span className={`font-mono tabular-nums shrink-0 ${emphasis ? 'text-[15px] font-semibold' : 'text-[13px]'}`} style={{ color: muted ? 'var(--text-3)' : 'var(--text-1)' }}>
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: ReactNode; color?: string }) {
  return (
    <div className="rounded-[8px] px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
      <div className="text-[10px] font-medium uppercase tracking-[0.1em] [overflow-wrap:anywhere]" style={{ color: 'var(--text-3)' }}>{label}</div>
      <FitText className="text-[16px] md:text-[18px] leading-tight font-semibold font-mono tabular-nums mt-1" style={{ color: color ?? 'var(--text-1)' }}>
        {value}
      </FitText>
      {sub && <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}

function FlexBar({
  segs, fmt, legendFmt = fmt,
}: {
  segs: Array<{ key: string; label: string; value: number; color: string; hint: string }>;
  fmt: (v: number) => string;
  legendFmt?: (v: number) => string;
}) {
  const shown = segs.filter((s) => s.value > 0);
  return (
    <div>
      <div className="h-3 rounded-[3px] overflow-hidden flex gap-[2px]" style={{ background: 'var(--bg-elev)' }}>
        {shown.map((s) => (
          <div key={s.key} style={{ flex: s.value, background: s.color }} title={`${s.label}: ${fmt(s.value)} · ${s.hint}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]" style={{ color: 'var(--text-2)' }}>
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: s.color }} />
            {s.label} <span className="tabular-nums font-mono font-medium" style={{ color: 'var(--text-1)' }}>{legendFmt(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: 'brass' }) {
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={tone === 'brass'
        ? { background: 'var(--warning-bg)', color: 'var(--brass)' }
        : { background: 'var(--surface-5)', color: 'var(--text-3)' }}
    >
      {children}
    </span>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-[6px] hover:bg-[var(--bg-2)] [&_svg]:w-3.5 [&_svg]:h-3.5"
      style={{ color: 'var(--text-3)' }}
    >
      {children}
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
      <Plus size={13} strokeWidth={2.5} />
      {children}
    </button>
  );
}

/** Small inline number field with a local draft, committed on blur or Enter. */
function InlineNumber({ value, onCommit, suffix, ariaLabel }: { value: number; onCommit: (v: number) => void; suffix: string; ariaLabel: string }) {
  const [draft, setDraft] = useState(String(value));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => { const n = parseLocaleNumber(draft); if (Number.isFinite(n)) onCommit(n); else setDraft(String(value)); };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        className="w-12 h-6 px-1.5 rounded-[4px] text-[12px] font-mono text-right outline-none border"
        style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      />
      <span>{suffix}</span>
    </span>
  );
}

/** Labelled text field with a local draft, committed on blur. */
function TextRow({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className="block">
      <span className="block mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{label}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft.trim())}
        className="w-full h-10 px-3 rounded-[8px] text-[14px] outline-none border"
        style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      />
    </label>
  );
}
