import React, { useMemo, useState, useEffect } from 'react';
import { Receipt, Layers, HandCoins } from 'lucide-react';
import { useFinance, calcActiveGrossAnnual } from '../context/FinanceContext';
import { calcEmployerCost, calcBillingRate } from '../lib/employerCost';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { RestoreDefaultsButton } from '../components/ui/RestoreDefaultsButton';

const EmployerCostPage: React.FC = () => {
  const {
    t, lang, region, formatCurrency,
    salaries, jobs, pension,
    employerCostConfig, updateEmployerCostConfig,
    billingConfig, updateBillingConfig,
    restoreEmployerCostDefaults,
  } = useFinance();
  const ec = t.employerCost;
  const isNo = region === 'no';

  // Salary auto-filled from the salary system, with manual override.
  const derivedGross = useMemo(() => {
    const today = new Date().toISOString().slice(0, 7);
    return calcActiveGrossAnnual(salaries, jobs, today);
  }, [salaries, jobs]);
  const [salaryOverride, setSalaryOverride] = useState<number | null>(null);
  const gross = salaryOverride ?? derivedGross;
  const isAuto = salaryOverride === null;

  const cost = useMemo(
    () => calcEmployerCost(gross, pension.otpEmployerPct, employerCostConfig),
    [gross, pension.otpEmployerPct, employerCostConfig],
  );
  const billing = useMemo(
    () => calcBillingRate(cost.totalEmployerCost, billingConfig),
    [cost.totalEmployerCost, billingConfig],
  );

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
        <h1 className="text-3xl md:text-5xl font-normal leading-[1.05] tracking-[-0.03em]">
          {lang === 'nb' ? (
            <>Hva koster du <em className="font-serif italic" style={{ color: 'var(--accent)' }}>egentlig</em>?</>
          ) : (
            <>What do you <em className="font-serif italic" style={{ color: 'var(--accent)' }}>really</em> cost?</>
          )}
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
          sub={`${formatCurrency(cost.totalEmployerCost - cost.gross)} ${lang === 'nb' ? 'over lønn' : 'over salary'}`}
          color="var(--warning)"
        />
        <SummaryTile
          label={ec.targetRate}
          value={`${formatCurrency(billing.targetHourly)}/t`}
          sub={`${formatCurrency(billing.dailyRate)}/${lang === 'nb' ? 'dag' : 'day'}`}
          color="var(--positive)"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Inputs */}
        <Card padding="lg">
          <div className="flex items-center justify-between gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <Receipt size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
              <SectionLabel>{ec.salaryInput}</SectionLabel>
            </div>
            <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restoreEmployerCostDefaults} />
          </div>
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                  {ec.grossSalary}
                </label>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    background: isAuto ? 'var(--accent-bg)' : 'rgba(255,255,255,0.06)',
                    color: isAuto ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  {isAuto ? t.salary.incomeAuto : t.salary.incomeOverride}
                </span>
              </div>
              <input
                type="number"
                value={gross}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setSalaryOverride(Number.isFinite(n) ? n : 0);
                }}
                className="w-full h-10 px-3 rounded-[12px] text-[14px] font-mono outline-none border"
                style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <SliderRow label={feriepengerLabel} value={employerCostConfig.feriepengesatsPct} onChange={(v) => updateEmployerCostConfig('feriepengesatsPct', v)} min={0} max={16} step={0.1} suffix="%" />
              <SliderRow label={payrollLabel} value={employerCostConfig.payrollTaxPct} onChange={(v) => updateEmployerCostConfig('payrollTaxPct', v)} min={0} max={20} step={0.1} suffix="%" />
              <NumberRow label={ec.overheadFlat} value={employerCostConfig.overheadAnnual} onCommit={(v) => updateEmployerCostConfig('overheadAnnual', Math.max(0, v))} suffix="kr/år" />
              <SliderRow label={ec.overheadPct} value={employerCostConfig.overheadPct} onChange={(v) => updateEmployerCostConfig('overheadPct', v)} min={0} max={50} step={1} suffix="%" />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ec.overheadHint}</p>

            <div className="flex items-baseline justify-between rounded-[12px] px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{pensionLabel}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{ec.employerPensionHint}</div>
              </div>
              <span className="text-[18px] font-semibold tabular-nums">{pension.otpEmployerPct}<span className="text-[12px] ml-1" style={{ color: 'var(--text-3)' }}>%</span></span>
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
            <BreakdownRow label={pensionLabel} value={`+ ${formatCurrency(cost.employerPension)}`} sub={`${pension.otpEmployerPct}%`} />
            <BreakdownRow label={ec.payrollTaxBase} value={formatCurrency(cost.payrollTaxBase)} muted />
            <BreakdownRow label={payrollLabel} value={`+ ${formatCurrency(cost.payrollTax)}`} sub={`${employerCostConfig.payrollTaxPct}%`} />
            <BreakdownRow label={ec.overheadFlat.replace(' (kr/år)', '').replace(' (kr/yr)', '')} value={`+ ${formatCurrency(cost.overhead)}`} />
            <BreakdownRow label={ec.total} value={formatCurrency(cost.totalEmployerCost)} emphasis />
          </div>
        </Card>
      </div>

      {/* Billing rate — secondary, for consultants */}
      <Card padding="lg">
        <div className="flex items-center justify-between gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <HandCoins size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
            <SectionLabel>{ec.billingTitle}</SectionLabel>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ec.billingSubtitle}</span>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          <NumberRow label={ec.workHoursPerYear} value={billingConfig.workHoursPerYear} onCommit={(v) => updateBillingConfig('workHoursPerYear', Math.max(0, v))} suffix="t/år" />
          <SliderRow label={ec.utilization} value={billingConfig.utilizationPct} onChange={(v) => updateBillingConfig('utilizationPct', v)} min={0} max={100} step={1} suffix="%" />
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{ec.billableOverride}</label>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>t/år</span>
            </div>
            <input
              type="number"
              value={billingConfig.billableHoursOverride ?? ''}
              placeholder={billing.billableHoursPerYear ? Math.round(billing.billableHoursPerYear).toString() : 'auto'}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') { updateBillingConfig('billableHoursOverride', null); return; }
                const n = parseFloat(raw);
                updateBillingConfig('billableHoursOverride', Number.isFinite(n) && n > 0 ? n : null);
              }}
              className="w-full h-10 px-3 rounded-[12px] text-[14px] font-mono outline-none border"
              style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
            />
          </div>
          <SliderRow label={ec.targetMargin} value={billingConfig.targetMarginPct} onChange={(v) => updateBillingConfig('targetMarginPct', v)} min={0} max={95} step={1} suffix="%" />
        </div>

        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatBlock label={ec.billableHours} value={`${Math.round(billing.billableHoursPerYear).toLocaleString(lang === 'nb' ? 'nb-NO' : 'en-US')} t`} />
          <StatBlock label={ec.breakEven} value={`${formatCurrency(billing.breakEvenHourly)}/t`} />
          <StatBlock
            label={ec.targetHourly}
            value={`${formatCurrency(billing.targetHourly)}/t`}
            sub={`+${billing.markupOnCostPct.toFixed(0)}% ${ec.markupOnCost}`}
            color="var(--positive)"
          />
          <StatBlock label={ec.dailyRate} value={`${formatCurrency(billing.dailyRate)}/${lang === 'nb' ? 'dag' : 'day'}`} />
          <StatBlock label={ec.annualRevenue} value={formatCurrency(billing.annualRevenueAtTarget)} />
          <StatBlock label={ec.annualProfit} value={formatCurrency(billing.profitAnnual)} color="var(--positive)" />
          <div className="col-span-2 lg:col-span-2 flex items-end">
            <NumberRow label={ec.hoursPerDay} value={billingConfig.hoursPerDay} onCommit={(v) => updateBillingConfig('hoursPerDay', Math.max(0, v))} suffix="t" />
          </div>
        </div>

        <p className="mt-5 text-[11px]" style={{ color: 'var(--text-3)' }}>{ec.caveat}</p>
      </Card>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────

function SummaryTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card padding="md">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-2)' }}>{label}</div>
      <div className="text-[14px] md:text-[24px] leading-tight [overflow-wrap:anywhere] font-semibold font-mono tabular-nums mt-1.5" style={{ color: color ?? 'var(--text-1)' }}>
        {value}
      </div>
      {sub && <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </Card>
  );
}

function StatBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-[12px] px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="text-[10px] font-medium uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-[16px] md:text-[18px] leading-tight font-semibold font-mono tabular-nums mt-1 [overflow-wrap:anywhere]" style={{ color: color ?? 'var(--text-1)' }}>
        {value}
      </div>
      {sub && <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
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

function NumberRow({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string }) {
  const [draft, setDraft] = useState(value.toString());
  // Re-sync the editable draft when the committed value changes from outside.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(value.toString()); }, [value]);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{label}</label>
        {suffix && <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{suffix}</span>}
      </div>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const n = parseFloat(draft); onCommit(Number.isFinite(n) ? n : 0); }}
        className="w-full h-10 px-3 rounded-[12px] text-[14px] font-mono outline-none border"
        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      />
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max, step, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{label}</label>
        <span className="text-[18px] font-semibold tabular-nums">
          {value}
          {suffix && <span className="text-[12px] ml-1" style={{ color: 'var(--text-3)' }}>{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--accent)' }}
      />
    </div>
  );
}

export default EmployerCostPage;
