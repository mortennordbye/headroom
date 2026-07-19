import React, { useMemo, lazy, Suspense } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Briefcase, TrendingUp, Lock, Calculator, Landmark } from 'lucide-react';
import { useFinance, calcActiveGrossAnnual, DEFAULT_PENSION, type Pension } from '../context/FinanceContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { IPS_MAX_DEDUCTION, calcPensionIncomeTax, calcTaxByRegion, TAX_YEAR } from '../lib/norwegianTax';
import { projectBeholdning, estimateBeholdning, annualFolketrygdPension } from '../lib/folketrygd';
import { estimateAfpGrunnlag, annualAfp } from '../lib/afp';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { RestoreDefaultsButton } from '../components/ui/RestoreDefaultsButton';
import { ProvenanceBadge } from '../components/ui/ProvenanceBadge';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { SummaryTile } from '../components/ui/SummaryTile';
import { NumberRow } from '../components/ui/NumberRow';
import { SliderRow } from '../components/ui/SliderRow';
import { provenanceOf } from '../lib/provenance';
import { projectPensionWealth } from '../lib/pension';
import { currentMonthKey } from '../lib/date';
import { formatAxisInt } from '../lib/format';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import ChartTooltip from '../components/ChartTooltip';
import { CHART, AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';

const PensionHistoryChart = lazy(() => import('../components/charts/PensionHistoryChart'));

// One row of the "pension income at withdrawal" breakdown.
const LineRow: React.FC<{ label: string; value: string; strong?: boolean; muted?: boolean; accent?: boolean }> = ({ label, value, strong, muted, accent }) => (
  <div className="flex items-center justify-between">
    <span style={{ color: muted ? 'var(--text-3)' : 'var(--text-2)', fontWeight: strong ? 600 : 400 }}>{label}</span>
    <span className="font-mono" style={{ color: accent ? 'var(--positive)' : muted ? 'var(--text-3)' : 'var(--text-1)', fontWeight: strong ? 600 : 400 }}>{value}</span>
  </div>
);

const PensionPage: React.FC = () => {
  const { t, pension: livePension, updatePension, salaries, jobs, formatCurrency, restorePensionAssumptionDefaults, region, customTaxRatePct, profile } = useFinance();
  const reduced = useReducedMotion();

  // Time machine: when viewing a past month, render that month's pension snapshot (read-only).
  const hist = useBalanceHistory();
  const pension = hist.snapshot?.pension ?? livePension;

  const currentYear = new Date().getFullYear();
  const hasBirthYear = pension.birthYear > 1900;
  const yearsToRetire = hasBirthYear
    ? Math.max(0, pension.retirementAge - (currentYear - pension.birthYear))
    : 0;

  // Pensionable income: latest salary + on-call. `today` lives in render scope
  // (not inside the memo) so the value recomputes if the month rolls over during
  // a long-lived session.
  const today = currentMonthKey();
  // In history mode, resolve pensionable income at the *viewed* month from the
  // salary/job timeline (salaries are timelined, so this is the correct historical
  // read), not today's salary — closes the live-salary leak (HISTORY_PLAN §5.3c).
  const asOfMonth = hist.isLive ? today : hist.activeKey;
  const pensionableIncome = useMemo(
    () => calcActiveGrossAnnual(salaries, jobs, asOfMonth),
    [salaries, jobs, asOfMonth],
  );

  const otpAnnualContribution = pensionableIncome * (pension.otpEmployerPct + pension.otpEmployeePct) / 100;
  const ipsAnnualContribution = Math.min(pension.ipsAnnualContribution, IPS_MAX_DEDUCTION);
  // IPS lowers alminnelig inntekt, taxed at 22% in Norway. Under the generic
  // region there's no fixed rate, so the saving is the user's own marginal rate.
  const ipsDeductionRate = region === 'generic' ? (customTaxRatePct ?? 22) / 100 : 0.22;
  const ipsTaxSaving = ipsAnnualContribution * ipsDeductionRate;

  // Year-by-year projection.
  const projection = useMemo(() => projectPensionWealth({
    otpBalance: pension.otpBalance,
    ipsBalance: pension.ipsBalance,
    otpAnnualContribution,
    ipsAnnualContribution,
    otpGrowthRate: pension.otpGrowthRate,
    ipsGrowthRate: pension.ipsGrowthRate,
    yearsToRetire,
    startYear: currentYear,
  }), [pension, yearsToRetire, otpAnnualContribution, ipsAnnualContribution, currentYear]);

  const atRetirement = projection.length > 0 ? projection[projection.length - 1] : null;
  const totalNow = pension.otpBalance + pension.ipsBalance;
  const totalAtRetire = atRetirement?.total ?? totalNow;

  // Folketrygd (state pension) — engine in src/lib/folketrygd.ts. Uses the user's
  // NAV pensjonsbeholdning when entered, else a rough estimate from age + income.
  const currentBeholdning = pension.folketrygdBeholdning > 0
    ? pension.folketrygdBeholdning
    : estimateBeholdning({ birthYear: pension.birthYear, currentYear, annualIncome: pensionableIncome });
  const beholdningAtRetire = projectBeholdning(currentBeholdning, pensionableIncome, yearsToRetire, TAX_YEAR);
  const folketrygd = annualFolketrygdPension({
    beholdning: beholdningAtRetire,
    birthYear: pension.birthYear,
    retirementAge: pension.retirementAge,
    single: pension.folketrygdSingle ?? true,
    year: TAX_YEAR,
  });

  // OTP/IPS balances at retirement, annuitized over the payout years; folketrygd
  // is lifelong (delingstall already encodes that). Net drawdown taxes the whole
  // stream with the pension-income rules.
  const payoutYears = Math.max(1, pension.pensionPayoutYears || DEFAULT_PENSION.pensionPayoutYears);
  const otpAnnualPayout = (atRetirement?.otp ?? pension.otpBalance) / payoutYears;
  const ipsAnnualPayout = (atRetirement?.ips ?? pension.ipsBalance) / payoutYears;
  // AFP (ny privat) — lifelong, only when the user certifies eligibility.
  const afpAnnual = pension.afpEligible
    ? annualAfp({
        grunnlag: estimateAfpGrunnlag({ birthYear: pension.birthYear, annualIncome: pensionableIncome, year: TAX_YEAR }),
        birthYear: pension.birthYear,
        retirementAge: pension.retirementAge,
      })
    : 0;
  const grossPensionAnnual = folketrygd.annual + afpAnnual + otpAnnualPayout + ipsAnnualPayout;
  const pensionTax = region === 'no'
    ? calcPensionIncomeTax(grossPensionAnnual, TAX_YEAR)
    : calcTaxByRegion(grossPensionAnnual, region, customTaxRatePct);
  const netPensionAnnual = pensionTax.netAnnual;
  const netPensionMonthly = netPensionAnnual / 12;

  // Replacement ratio vs current net salary.
  const currentNetAnnual = calcTaxByRegion(pensionableIncome, region, customTaxRatePct, ipsAnnualContribution, 0).netAnnual;
  const replacementPct = currentNetAnnual > 0 ? (netPensionAnnual / currentNetAnnual) * 100 : 0;

  return (
    <>
    <div
      className={`space-y-6 md:space-y-7 ${hist.isLive ? '' : 'pointer-events-none select-none'}`}
      style={{ opacity: hist.isLive ? 1 : 0.92 }}
    >
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {t.pension}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          <>{t.pensionPage.heroBefore}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.pensionPage.heroEm}</em>?</>
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {t.pensionPage.heroSub}
        </p>
      </header>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <SummaryTile
          label={t.pensionWealth}
          value={formatCurrency(totalNow)}
          sub={`OTP ${formatCurrency(pension.otpBalance)} · IPS ${formatCurrency(pension.ipsBalance)}`}
        />
        <SummaryTile
          label={t.pensionAtRetirement}
          value={hasBirthYear ? formatCurrency(totalAtRetire) : '—'}
          sub={hasBirthYear
            ? `${yearsToRetire} ${t.yearsToRetirement}`
            : t.setBirthYearHint}
          color="var(--violet)"
        />
        <SummaryTile
          label={t.pensionPage.contributionPerYear}
          value={formatCurrency(otpAnnualContribution + ipsAnnualContribution)}
          sub={`OTP ${formatCurrency(otpAnnualContribution)} · IPS ${formatCurrency(ipsAnnualContribution)}`}
        />
        <SummaryTile
          label={t.pensionPage.estMonthlyPension}
          value={hasBirthYear ? formatCurrency(netPensionMonthly) : '—'}
          sub={hasBirthYear ? t.pensionPage.netInclState : ''}
          color={hasBirthYear ? 'var(--positive)' : undefined}
        />
      </div>

      {/* Projection chart */}
      <Card padding="lg">
        <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <TrendingUp size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
          <SectionLabel>{t.pensionPage.pensionWealthOverTime}</SectionLabel>
        </div>
        {projection.length < 2 ? (
          <div className="h-[300px] grid place-items-center text-[13px]" style={{ color: 'var(--text-3)' }}>
            {hasBirthYear
              ? t.pensionPage.alreadyAtRetirementAge
              : t.setBirthYearHint}
          </div>
        ) : (
          <>
            <div className="mt-4 h-[300px] md:h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="otpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.forest} stopOpacity={0.92} />
                      <stop offset="100%" stopColor={CHART.forest} stopOpacity={0.92} />
                    </linearGradient>
                    <linearGradient id="ipsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.teal} stopOpacity={0.85} />
                      <stop offset="100%" stopColor={CHART.teal} stopOpacity={0.85} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="year" {...AXIS_PROPS} />
                  <YAxis tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={52} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area isAnimationActive={!reduced} type="monotone" dataKey="ips" stackId="1" name="IPS" stroke={CHART.teal} fill="url(#ipsGrad)" />
                  <Area isAnimationActive={!reduced} type="monotone" dataKey="otp" stackId="1" name="OTP" stroke={CHART.forestLight} fill="url(#otpGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] mt-3" style={{ color: 'var(--text-2)' }}>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART.forestLight }} />OTP</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART.teal }} />IPS</div>
            </div>
          </>
        )}
      </Card>

      {/* Pension income at withdrawal — folketrygd + OTP/IPS, net of drawdown tax */}
      <Card padding="lg">
        <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Landmark size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
          <SectionLabel>{t.pensionPage.incomeAtRetirement}</SectionLabel>
        </div>
        {hasBirthYear ? (
          <>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
              <div className="space-y-2">
                <LineRow label={t.pensionPage.folketrygdLifelong} value={`${formatCurrency(folketrygd.annual)}/${t.pensionPage.yrUnit}`} />
                {pension.afpEligible && (
                  <LineRow label={t.pensionPage.afpLifelong} value={`${formatCurrency(afpAnnual)}/${t.pensionPage.yrUnit}`} />
                )}
                <LineRow label={`OTP · ${payoutYears} ${t.pensionPage.yrUnit}`} value={`${formatCurrency(otpAnnualPayout)}/${t.pensionPage.yrUnit}`} />
                <LineRow label={`IPS · ${payoutYears} ${t.pensionPage.yrUnit}`} value={`${formatCurrency(ipsAnnualPayout)}/${t.pensionPage.yrUnit}`} />
              </div>
              <div className="space-y-2 md:border-l md:pl-8" style={{ borderColor: 'var(--border)' }}>
                <LineRow label={t.pensionPage.grossPerYear} value={formatCurrency(grossPensionAnnual)} strong />
                <LineRow label={t.pensionPage.taxDrawdown} value={`− ${formatCurrency(pensionTax.totalTax)}`} muted />
                <LineRow label={t.pensionPage.netPerYear} value={formatCurrency(netPensionAnnual)} strong accent />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <SummaryTile label={t.pensionPage.netPerMonthLabel} value={formatCurrency(netPensionMonthly)} color="var(--positive)" />
              <SummaryTile label={t.pensionPage.replacementRatio} value={`${Math.round(replacementPct)} %`} />
            </div>
            <p className="mt-4 text-[11px]" style={{ color: 'var(--text-3)' }}>{t.pensionPage.folketrygdNote}</p>
          </>
        ) : (
          <div className="h-[120px] grid place-items-center text-[13px]" style={{ color: 'var(--text-3)' }}>{t.setBirthYearHint}</div>
        )}
      </Card>

      {/* Actual OTP/IPS balance history (renders only when ≥2 months recorded) */}
      <Suspense fallback={null}><PensionHistoryChart /></Suspense>

      {/* Settings — OTP */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card padding="lg">
          <div className="flex items-center justify-between gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <Briefcase size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
              <SectionLabel>OTP — {t.pensionPage.employerPension}</SectionLabel>
            </div>
            <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restorePensionAssumptionDefaults} />
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <NumberRow label={t.otpBalance} value={pension.otpBalance} onCommit={(v) => updatePension('otpBalance', v)} suffix="kr" />
            <SliderRow label={t.otpEmployerPct} value={pension.otpEmployerPct} onChange={(v) => updatePension('otpEmployerPct', v)} min={0} max={10} step={0.5} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(pension.otpEmployerPct, DEFAULT_PENSION.otpEmployerPct)} />} />
            <SliderRow label={t.otpEmployeePct} value={pension.otpEmployeePct} onChange={(v) => updatePension('otpEmployeePct', v)} min={0} max={5} step={0.5} suffix="%" />
            <SliderRow label={t.otpGrowthRate} value={pension.otpGrowthRate} onChange={(v) => updatePension('otpGrowthRate', v)} min={0} max={12} step={0.5} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(pension.otpGrowthRate, DEFAULT_PENSION.otpGrowthRate)} />} />
          </div>
          <p className="mt-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
            {`${t.pensionPage.otpNotePre}${pension.otpEmployerPct}${t.pensionPage.otpNoteMid}${formatCurrency(otpAnnualContribution)}.`}
          </p>
        </Card>

        {/* Settings — IPS */}
        <Card padding="lg">
          <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <Calculator size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
            <SectionLabel>IPS — {t.pensionPage.individualPensionSavings}</SectionLabel>
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <NumberRow label={t.ipsBalance} value={pension.ipsBalance} onCommit={(v) => updatePension('ipsBalance', v)} suffix="kr" />
            <NumberRow
              label={t.ipsAnnualContribution}
              value={pension.ipsAnnualContribution}
              onCommit={(v) => updatePension('ipsAnnualContribution', Math.min(Math.max(0, v), IPS_MAX_DEDUCTION))}
              suffix={t.common.krPerYear}
            />
            <SliderRow label={t.ipsGrowthRate} value={pension.ipsGrowthRate} onChange={(v) => updatePension('ipsGrowthRate', v)} min={0} max={12} step={0.5} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(pension.ipsGrowthRate, DEFAULT_PENSION.ipsGrowthRate)} />} />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-[8px] p-3" style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}>
            <Calculator size={14} className="mt-0.5 shrink-0" />
            <span className="text-[12px]">
              {`${t.ipsHint}${t.pensionPage.ipsSavePre}${formatCurrency(ipsTaxSaving)}${t.pensionPage.ipsSaveSuf}`}
            </span>
          </div>
        </Card>
      </div>

      {/* Settings — Folketrygd (state pension) */}
      <Card padding="lg">
        <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Landmark size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
          <SectionLabel>{t.pensionPage.folketrygdTitle} — {t.pensionPage.stateProvided}</SectionLabel>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <div>
            <NumberRow
              label={t.pensionPage.folketrygdBeholdning}
              value={pension.folketrygdBeholdning}
              onCommit={(v) => updatePension('folketrygdBeholdning', Math.max(0, v))}
              suffix="kr"
            />
            {hasBirthYear && pension.folketrygdBeholdning === 0 && (
              <button
                type="button"
                onClick={() => updatePension('folketrygdBeholdning', estimateBeholdning({ birthYear: pension.birthYear, currentYear, annualIncome: pensionableIncome }))}
                className="mt-2 text-[11px] underline underline-offset-2 hover:opacity-80 transition-opacity"
                style={{ color: 'var(--accent)' }}
              >
                {t.pensionPage.useEstimate}: {formatCurrency(currentBeholdning)}
              </button>
            )}
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{t.pensionPage.folketrygdBeholdningHint}</p>
          </div>
          <div className="space-y-5">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] block mb-2" style={{ color: 'var(--text-3)' }}>{t.pensionPage.civilStatus}</label>
              <SegmentedControl<'single' | 'married'>
                ariaLabel={t.pensionPage.civilStatus}
                value={(pension.folketrygdSingle ?? true) ? 'single' : 'married'}
                onChange={(v) => updatePension('folketrygdSingle', v === 'single')}
                items={[{ value: 'single', label: t.pensionPage.single }, { value: 'married', label: t.pensionPage.married }]}
              />
            </div>
            <SliderRow
              label={t.pensionPage.payoutYears}
              value={pension.pensionPayoutYears}
              onChange={(v) => updatePension('pensionPayoutYears', v)}
              min={5}
              max={30}
              step={1}
              suffix={t.pensionPage.yrUnit}
            />
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] block mb-2" style={{ color: 'var(--text-3)' }}>{t.pensionPage.afpEligibleLabel}</label>
              <SegmentedControl<'yes' | 'no'>
                ariaLabel={t.pensionPage.afpEligibleLabel}
                value={pension.afpEligible ? 'yes' : 'no'}
                onChange={(v) => updatePension('afpEligible', v === 'yes')}
                items={[{ value: 'yes', label: t.pensionPage.afpYes }, { value: 'no', label: t.pensionPage.afpNo }]}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{t.pensionPage.afpHint}</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {hasBirthYear
            ? `${t.pensionPage.folketrygdLifelong}: ${formatCurrency(folketrygd.annual)}/${t.pensionPage.yrUnit} · delingstall ${folketrygd.delingstall.toFixed(1)}`
            : t.pensionPage.payoutYearsHint}
        </p>
      </Card>

      {/* Retirement target */}
      <Card padding="lg">
        <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Lock size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
          <SectionLabel>{t.pensionPage.target}</SectionLabel>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          {profile.birthDate ? (
            <div>
              <div className="flex items-baseline mb-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{t.birthYear}</label>
              </div>
              <div
                className="w-full h-10 px-3 rounded-[8px] text-[14px] font-mono border flex items-center"
                style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
                title={t.pensionPage.birthYearFromProfile}
              >
                {pension.birthYear || '—'}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{t.pensionPage.birthYearFromProfile}</p>
            </div>
          ) : (
            <NumberRow
              label={t.birthYear}
              value={pension.birthYear}
              onCommit={(v) => updatePension('birthYear', v)}
              suffix=""
            />
          )}
          <SliderRow
            label={t.retirementAge}
            value={pension.retirementAge}
            onChange={(v) => updatePension('retirementAge', v)}
            min={62}
            max={75}
            step={1}
            suffix=""
            badge={<ProvenanceBadge kind={provenanceOf(pension.retirementAge, DEFAULT_PENSION.retirementAge)} />}
          />
        </div>
        <p className="mt-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {t.pensionPage.lockedNote}
        </p>
      </Card>
    </div>
    </>
  );
};

export default PensionPage;

// Re-export the Pension type so callers can keep using the page barrel.
export type { Pension };
