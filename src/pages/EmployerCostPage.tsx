import React, { useMemo } from 'react';
import { Calculator, Layers, SlidersHorizontal } from 'lucide-react';
import { useFinance, calcActiveGrossAnnual } from '../context/FinanceContext';
import {
  calcEmployerCost, calcBillingRate, calcBillableHours, calcBilledRate, calcFairGross,
  DEFAULT_EMPLOYER_COST_CONFIG, DEFAULT_BILLING_CONFIG, type SolveFor,
} from '../lib/employerCost';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { RestoreDefaultsButton } from '../components/ui/RestoreDefaultsButton';
import { ProvenanceBadge } from '../components/ui/ProvenanceBadge';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { SummaryTile } from '../components/ui/SummaryTile';
import { FitText } from '../components/ui/FitText';
import { NumberRow } from '../components/ui/NumberRow';
import { SliderRow } from '../components/ui/SliderRow';
import { provenanceOf } from '../lib/provenance';
import { currentMonthKey } from '../lib/date';
import { parseLocaleNumber } from '../lib/validators';

const EmployerCostPage: React.FC = () => {
  const {
    t, lang, region, formatCurrency,
    salaries, jobs, pension,
    employerCostConfig, updateEmployerCostConfig,
    billingConfig, updateBillingConfig,
    restoreEmployerCostDefaults,
    employerSalaryOverride: salaryOverride, setEmployerSalaryOverride: setSalaryOverride,
  } = useFinance();
  const ec = t.employerCost;
  const isNo = region === 'no';

  // Salary auto-filled from the salary system, with manual override. `today`
  // lives in render scope so the value recomputes if the month rolls over during
  // a long-lived session.
  const today = currentMonthKey();
  const derivedGross = useMemo(
    () => calcActiveGrossAnnual(salaries, jobs, today),
    [salaries, jobs, today],
  );
  const storedGross = salaryOverride ?? derivedGross;
  const isAuto = salaryOverride === null;
  const storedRate = billingConfig.billedHourly ?? 0;
  const otpPct = pension.otpEmployerPct;

  const { solveFor } = billingConfig;

  const hours = calcBillableHours(billingConfig);
  const gross = solveFor === 'salary'
    ? calcFairGross(storedRate, hours, otpPct, employerCostConfig, billingConfig.targetMarginPct)
    : storedGross;
  const cost = calcEmployerCost(gross, otpPct, employerCostConfig);
  const billing = calcBillingRate(cost.totalEmployerCost, billingConfig);
  const rate = solveFor === 'rate' ? billing.targetHourly : storedRate;
  const result = calcBilledRate(rate, hours, cost.totalEmployerCost);
  const margin = solveFor === 'margin' ? result.marginPct : billingConfig.targetMarginPct;
  const dailyRate = rate * Math.max(0, billingConfig.hoursPerDay);
  const markupPct = billing.breakEvenHourly > 0 ? (rate / billing.breakEvenHourly - 1) * 100 : 0;
  // From the margin angle, also say what a fair salary would be at the target margin.
  const fairGross = solveFor === 'margin'
    ? calcFairGross(rate, hours, otpPct, employerCostConfig, billingConfig.targetMarginPct)
    : null;

  // Freeze the value that was being solved for into stored state, so switching
  // what to solve for doesn't make the numbers jump (beyond rounding).
  const changeSolveFor = (next: SolveFor) => {
    if (solveFor === 'rate') updateBillingConfig('billedHourly', Math.round(rate));
    if (solveFor === 'salary') setSalaryOverride(Math.round(gross));
    if (solveFor === 'margin') updateBillingConfig('targetMarginPct', Math.min(95, Math.max(0, Math.round(margin * 10) / 10)));
    updateBillingConfig('solveFor', next);
  };

  const feriepengerLabel = isNo ? ec.feriepenger : ec.benefitsLeave;
  const pensionLabel = isNo ? ec.employerPension : ec.employerPensionGeneric;
  const payrollLabel = isNo ? ec.payrollTax : ec.payrollTaxGeneric;

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {ec.heroLabel}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.employerCostPage.heroBefore}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.employerCostPage.heroEmphasis}</em>{t.employerCostPage.heroAfter}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {ec.subtitle}
        </p>
      </header>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <SummaryTile label={ec.grossSalary} value={formatCurrency(cost.gross)} />
        <SummaryTile label={ec.totalCost} value={formatCurrency(cost.totalEmployerCost)} color="var(--violet)" />
        <SummaryTile
          label={ec.loading}
          value={`+${cost.loadingPct.toFixed(1)}%`}
          sub={`${formatCurrency(cost.totalEmployerCost - cost.gross)} ${t.employerCostPage.overSalary}`}
          color="var(--warning)"
        />
        <SummaryTile
          label={ec.billedHourly}
          value={`${formatCurrency(rate)}/t`}
          sub={`${formatCurrency(dailyRate)}/${t.employerCostPage.dayAbbr}`}
          color="var(--positive)"
        />
      </div>

      {/* Calculator: salary ↔ rate ↔ margin */}
      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Calculator size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
            <SectionLabel>{ec.calcTitle}</SectionLabel>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{ec.solveFor}</span>
            <SegmentedControl<SolveFor>
              ariaLabel={ec.solveFor}
              value={solveFor}
              onChange={changeSolveFor}
              items={[
                { value: 'rate', label: ec.solveRate },
                { value: 'salary', label: ec.solveSalary },
                { value: 'margin', label: ec.solveMargin },
              ]}
            />
          </div>
        </div>
        <p className="mt-3 text-[12px]" style={{ color: 'var(--text-3)' }}>{ec.calcSubtitle}</p>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
          {solveFor === 'salary' ? (
            <SolvedField label={ec.grossSalary} value={formatCurrency(gross)} badge={ec.calculated} />
          ) : (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label htmlFor="calc-gross" className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                  {ec.grossSalary}
                </label>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    background: isAuto ? 'var(--accent-bg)' : 'var(--surface-5)',
                    color: isAuto ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  {isAuto ? t.salary.incomeAuto : t.salary.incomeOverride}
                </span>
              </div>
              <input
                id="calc-gross"
                type="number"
                value={storedGross}
                onChange={(e) => {
                  const n = parseLocaleNumber(e.target.value);
                  setSalaryOverride(Number.isFinite(n) ? n : 0);
                }}
                className="w-full h-10 px-3 rounded-[8px] text-[14px] font-mono outline-none border"
                style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              />
              {!isAuto && (
                <button
                  onClick={() => setSalaryOverride(null)}
                  className="mt-2 text-[11px] font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  {t.salary.incomeResetAuto}
                </button>
              )}
            </div>
          )}

          {solveFor === 'rate' ? (
            <SolvedField label={ec.billedHourly} value={`${formatCurrency(rate)}/t`} badge={ec.calculated} />
          ) : (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label htmlFor="calc-rate" className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{ec.billedHourly}</label>
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>kr/{t.common.hourUnit}</span>
              </div>
              <input
                id="calc-rate"
                type="number"
                value={billingConfig.billedHourly ?? ''}
                placeholder={Math.round(billing.targetHourly).toString()}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '') { updateBillingConfig('billedHourly', null); return; }
                  const n = parseLocaleNumber(raw);
                  updateBillingConfig('billedHourly', Number.isFinite(n) && n >= 0 ? n : null);
                }}
                className="w-full h-10 px-3 rounded-[8px] text-[14px] font-mono outline-none border"
                style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              />
            </div>
          )}

          {solveFor === 'margin' ? (
            <SolvedField
              label={ec.employerMargin}
              value={`${margin.toFixed(1)}%`}
              badge={ec.calculated}
              color={margin < 0 ? 'var(--negative)' : undefined}
            />
          ) : (
            <SliderRow label={ec.employerMargin} value={billingConfig.targetMarginPct} onChange={(v) => updateBillingConfig('targetMarginPct', v)} min={0} max={95} step={1} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(billingConfig.targetMarginPct, DEFAULT_BILLING_CONFIG.targetMarginPct)} />} />
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          <StatBlock label={ec.annualRevenue} value={formatCurrency(result.annualRevenue)} />
          <StatBlock
            label={ec.employerProfit}
            value={formatCurrency(result.employerProfit)}
            sub={`${formatCurrency(result.profitPerHour)} ${ec.perHour}`}
            color={result.employerProfit < 0 ? 'var(--negative)' : 'var(--warning)'}
          />
          <StatBlock label={ec.dailyRate} value={`${formatCurrency(dailyRate)}/${t.employerCostPage.dayAbbr}`} />
          <StatBlock label={ec.billableHours} value={`${Math.round(hours).toLocaleString(lang === 'nb' ? 'nb-NO' : 'en-US')} t`} />
          <StatBlock label={ec.breakEven} value={`${formatCurrency(billing.breakEvenHourly)}/t`} />
          <StatBlock label={ec.markupOnCost} value={`${markupPct >= 0 ? '+' : ''}${markupPct.toFixed(0)}%`} />
        </div>

        {fairGross != null && (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-end rounded-[8px] px-4 py-4" style={{ background: 'var(--surface-2)' }}>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>
                {ec.fairSalary} · {ec.fairSalarySub.replace('{margin}', String(billingConfig.targetMarginPct))}
              </div>
              <div className="text-[20px] font-semibold font-mono tabular-nums mt-1" style={{ color: 'var(--positive)' }}>{formatCurrency(fairGross)}</div>
              <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>
                {fairGross - gross >= 0 ? '+' : '−'}{formatCurrency(Math.abs(fairGross - gross))} {ec.vsYourSalary}
              </div>
            </div>
            <SliderRow label={ec.fairMargin} value={billingConfig.targetMarginPct} onChange={(v) => updateBillingConfig('targetMarginPct', v)} min={0} max={95} step={1} suffix="%" />
          </div>
        )}

        <p className="mt-5 text-[11px]" style={{ color: 'var(--text-3)' }}>{ec.fairSalaryHint}</p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Assumptions */}
        <Card padding="lg">
          <div className="flex items-center justify-between gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
              <SectionLabel>{ec.assumptions}</SectionLabel>
            </div>
            <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restoreEmployerCostDefaults} />
          </div>
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <SliderRow label={feriepengerLabel} value={employerCostConfig.feriepengesatsPct} onChange={(v) => updateEmployerCostConfig('feriepengesatsPct', v)} min={0} max={16} step={0.1} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(employerCostConfig.feriepengesatsPct, DEFAULT_EMPLOYER_COST_CONFIG.feriepengesatsPct)} />} />
              <SliderRow label={payrollLabel} value={employerCostConfig.payrollTaxPct} onChange={(v) => updateEmployerCostConfig('payrollTaxPct', v)} min={0} max={20} step={0.1} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(employerCostConfig.payrollTaxPct, DEFAULT_EMPLOYER_COST_CONFIG.payrollTaxPct)} />} />
              <NumberRow label={ec.overheadFlat} value={employerCostConfig.overheadAnnual} onCommit={(v) => updateEmployerCostConfig('overheadAnnual', Math.max(0, v))} suffix={t.common.krPerYear} badge={<ProvenanceBadge kind={provenanceOf(employerCostConfig.overheadAnnual, DEFAULT_EMPLOYER_COST_CONFIG.overheadAnnual)} />} />
              <SliderRow label={ec.overheadPct} value={employerCostConfig.overheadPct} onChange={(v) => updateEmployerCostConfig('overheadPct', v)} min={0} max={50} step={1} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(employerCostConfig.overheadPct, DEFAULT_EMPLOYER_COST_CONFIG.overheadPct)} />} />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ec.overheadHint}</p>

            <div className="flex items-baseline justify-between rounded-[8px] px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{pensionLabel}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{ec.employerPensionHint}</div>
              </div>
              <span className="text-[18px] font-semibold tabular-nums">{otpPct}<span className="text-[12px] ml-1" style={{ color: 'var(--text-3)' }}>%</span></span>
            </div>

            <div className="pt-5 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5" style={{ borderColor: 'var(--border)' }}>
              <NumberRow label={ec.workHoursPerYear} value={billingConfig.workHoursPerYear} onCommit={(v) => updateBillingConfig('workHoursPerYear', Math.max(0, v))} suffix={t.common.hoursPerYearUnit} badge={<ProvenanceBadge kind={provenanceOf(billingConfig.workHoursPerYear, DEFAULT_BILLING_CONFIG.workHoursPerYear)} />} />
              <SliderRow label={ec.utilization} value={billingConfig.utilizationPct} onChange={(v) => updateBillingConfig('utilizationPct', v)} min={0} max={100} step={1} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(billingConfig.utilizationPct, DEFAULT_BILLING_CONFIG.utilizationPct)} />} />
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{ec.billableOverride}</label>
                  <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{t.common.hoursPerYearUnit}</span>
                </div>
                <input
                  type="number"
                  value={billingConfig.billableHoursOverride ?? ''}
                  placeholder={hours ? Math.round(hours).toString() : 'auto'}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') { updateBillingConfig('billableHoursOverride', null); return; }
                    const n = parseLocaleNumber(raw);
                    updateBillingConfig('billableHoursOverride', Number.isFinite(n) && n > 0 ? n : null);
                  }}
                  className="w-full h-10 px-3 rounded-[8px] text-[14px] font-mono outline-none border"
                  style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                />
              </div>
              <NumberRow label={ec.hoursPerDay} value={billingConfig.hoursPerDay} onCommit={(v) => updateBillingConfig('hoursPerDay', Math.max(0, v))} suffix={t.common.hourUnit} badge={<ProvenanceBadge kind={provenanceOf(billingConfig.hoursPerDay, DEFAULT_BILLING_CONFIG.hoursPerDay)} />} />
            </div>
          </div>
        </Card>

        {/* Cost breakdown */}
        <Card padding="lg">
          <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <Layers size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
            <SectionLabel>{ec.costBreakdown}</SectionLabel>
          </div>
          <div className="mt-4">
            <BreakdownRow label={ec.gross} value={formatCurrency(cost.gross)} />
            <BreakdownRow label={feriepengerLabel} value={`+ ${formatCurrency(cost.feriepenger)}`} sub={`${employerCostConfig.feriepengesatsPct}%`} />
            <BreakdownRow label={pensionLabel} value={`+ ${formatCurrency(cost.employerPension)}`} sub={`${otpPct}%`} />
            <BreakdownRow label={ec.payrollTaxBase} value={formatCurrency(cost.payrollTaxBase)} muted />
            <BreakdownRow label={payrollLabel} value={`+ ${formatCurrency(cost.payrollTax)}`} sub={`${employerCostConfig.payrollTaxPct}%`} />
            <BreakdownRow label={ec.overheadFlat.replace(' (kr/år)', '').replace(' (kr/yr)', '')} value={`+ ${formatCurrency(cost.overhead)}`} />
            <BreakdownRow label={ec.total} value={formatCurrency(cost.totalEmployerCost)} emphasis />
          </div>
          <p className="mt-5 text-[11px]" style={{ color: 'var(--text-3)' }}>{ec.caveat}</p>
        </Card>
      </div>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────

function StatBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
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

function SolvedField({ label, value, badge, color }: { label: string; value: string; badge: string; color?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{label}</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{badge}</span>
      </div>
      <div className="h-10 px-3 flex items-center rounded-[8px] border text-[16px] font-semibold font-mono tabular-nums" style={{ borderColor: 'var(--accent)', color: color ?? 'var(--text-1)' }} aria-live="polite">
        {value}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, sub, muted, emphasis }: { label: string; value: string; sub?: string; muted?: boolean; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2.5 border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
      <span className={emphasis ? 'text-[13px] font-semibold' : 'text-[13px]'} style={{ color: muted ? 'var(--text-3)' : 'var(--text-2)' }}>
        {label}
        {sub && <span className="ml-1.5 text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{sub}</span>}
      </span>
      <span
        className={`font-mono tabular-nums ${emphasis ? 'text-[16px] font-semibold' : 'text-[13px]'}`}
        style={{ color: emphasis ? 'var(--text-1)' : muted ? 'var(--text-3)' : 'var(--text-1)' }}
      >
        {value}
      </span>
    </div>
  );
}

export default EmployerCostPage;
