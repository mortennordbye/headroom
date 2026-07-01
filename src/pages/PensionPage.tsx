import React, { useMemo, useEffect, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Briefcase, TrendingUp, Lock, Calculator } from 'lucide-react';
import { useFinance, calcActiveGrossAnnual, DEFAULT_PENSION, type Pension } from '../context/FinanceContext';
import { IPS_MAX_DEDUCTION } from '../lib/norwegianTax';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { RestoreDefaultsButton } from '../components/ui/RestoreDefaultsButton';
import { ProvenanceBadge } from '../components/ui/ProvenanceBadge';
import { provenanceOf } from '../lib/provenance';
import BalanceHistoryBar from '../components/BalanceHistoryBar';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import ChartTooltip from '../components/ChartTooltip';

function formatAxisInt(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
  return val.toString();
}

const PensionPage: React.FC = () => {
  const { t, lang, pension: livePension, updatePension, salaries, jobs, formatCurrency, restorePensionAssumptionDefaults } = useFinance();

  // Time machine: when viewing a past month, render that month's pension snapshot (read-only).
  const hist = useBalanceHistory();
  const pension = hist.snapshot?.pension ?? livePension;

  const currentYear = new Date().getFullYear();
  const hasBirthYear = pension.birthYear > 1900;
  const yearsToRetire = hasBirthYear
    ? Math.max(0, pension.retirementAge - (currentYear - pension.birthYear))
    : 0;

  // Pensionable income: latest salary + on-call.
  const pensionableIncome = useMemo(() => {
    const today = new Date().toISOString().slice(0, 7);
    return calcActiveGrossAnnual(salaries, jobs, today);
  }, [salaries, jobs]);

  const otpAnnualContribution = pensionableIncome * (pension.otpEmployerPct + pension.otpEmployeePct) / 100;
  const ipsAnnualContribution = Math.min(pension.ipsAnnualContribution, IPS_MAX_DEDUCTION);
  const ipsTaxSaving = ipsAnnualContribution * 0.22;

  // Year-by-year projection.
  const projection = useMemo(() => {
    const out: { year: number; otp: number; ips: number; total: number }[] = [];
    let otp = pension.otpBalance;
    let ips = pension.ipsBalance;
    const otpRate = pension.otpGrowthRate / 100;
    const ipsRate = pension.ipsGrowthRate / 100;
    for (let y = 0; y <= yearsToRetire; y++) {
      out.push({
        year: currentYear + y,
        otp: Math.round(otp),
        ips: Math.round(ips),
        total: Math.round(otp + ips),
      });
      otp = otp * (1 + otpRate) + otpAnnualContribution;
      ips = ips * (1 + ipsRate) + ipsAnnualContribution;
    }
    return out;
  }, [pension, yearsToRetire, otpAnnualContribution, ipsAnnualContribution, currentYear]);

  const atRetirement = projection.length > 0 ? projection[projection.length - 1] : null;
  const totalNow = pension.otpBalance + pension.ipsBalance;
  const totalAtRetire = atRetirement?.total ?? totalNow;

  // Approximate monthly pension in drawdown (very rough — uniform 20-year withdrawal).
  const drawdownYears = 20;
  const monthlyPensionGross = totalAtRetire / (drawdownYears * 12);

  return (
    <>
    <BalanceHistoryBar hist={hist} />
    <div
      className={`space-y-6 md:space-y-7 ${hist.isLive ? '' : 'pointer-events-none select-none'}`}
      style={{ opacity: hist.isLive ? 1 : 0.92 }}
    >
      {/* Hero header */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {t.pension}
        </div>
        <h1 className="text-3xl md:text-5xl font-normal leading-[1.05] tracking-[-0.03em]">
          {lang === 'nb' ? (
            <>Når kan du <em className="font-serif italic" style={{ color: 'var(--accent)' }}>slutte</em>?</>
          ) : (
            <>When can you <em className="font-serif italic" style={{ color: 'var(--accent)' }}>retire</em>?</>
          )}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {lang === 'nb'
            ? 'Spor OTP, IPS og når pensjonsformuen din rekker for å leve livet etter jobb.'
            : 'Track OTP, IPS, and whether your pension wealth will carry you through post-work life.'}
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
          label={lang === 'nb' ? 'Innskudd/år' : 'Contribution/yr'}
          value={formatCurrency(otpAnnualContribution + ipsAnnualContribution)}
          sub={`OTP ${formatCurrency(otpAnnualContribution)} · IPS ${formatCurrency(ipsAnnualContribution)}`}
        />
        <SummaryTile
          label={lang === 'nb' ? 'Estimert pensjon/mnd' : 'Est. monthly pension'}
          value={hasBirthYear ? formatCurrency(monthlyPensionGross) : '—'}
          sub={hasBirthYear
            ? `${lang === 'nb' ? 'over' : 'over'} ${drawdownYears} ${lang === 'nb' ? 'år' : 'yr'} (brutto)`
            : ''}
          color={hasBirthYear ? 'var(--positive)' : undefined}
        />
      </div>

      {/* Projection chart */}
      <Card padding="lg">
        <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <TrendingUp size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
          <SectionLabel>{lang === 'nb' ? 'Pensjonsformue over tid' : 'Pension wealth over time'}</SectionLabel>
        </div>
        {projection.length < 2 ? (
          <div className="h-[300px] grid place-items-center text-[13px]" style={{ color: 'var(--text-3)' }}>
            {hasBirthYear
              ? (lang === 'nb' ? 'Allerede ved pensjonsalder — fyll inn fødselsår på nytt om dette er feil.' : 'Already at retirement age — check birth year.')
              : t.setBirthYearHint}
          </div>
        ) : (
          <>
            <div className="mt-4 h-[300px] md:h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="otpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.4} />
                    </linearGradient>
                    <linearGradient id="ipsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#737373' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatAxisInt} tick={{ fontSize: 11, fill: '#737373' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="ips" stackId="1" name="IPS" stroke="#a855f7" fill="url(#ipsGrad)" />
                  <Area type="monotone" dataKey="otp" stackId="1" name="OTP" stroke="#0ea5e9" fill="url(#otpGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] mt-3" style={{ color: 'var(--text-2)' }}>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#0ea5e9' }} />OTP</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#a855f7' }} />IPS</div>
            </div>
          </>
        )}
      </Card>

      {/* Settings — OTP */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card padding="lg">
          <div className="flex items-center justify-between gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <Briefcase size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
              <SectionLabel>OTP — {lang === 'nb' ? 'arbeidsgiverpensjon' : 'employer pension'}</SectionLabel>
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
            {lang === 'nb'
              ? `Arbeidsgiver betaler ${pension.otpEmployerPct}% av brutto (inkl. vakt). Innskudd per år: ${formatCurrency(otpAnnualContribution)}.`
              : `Employer contributes ${pension.otpEmployerPct}% of gross (incl. on-call). Annual contribution: ${formatCurrency(otpAnnualContribution)}.`}
          </p>
        </Card>

        {/* Settings — IPS */}
        <Card padding="lg">
          <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <Calculator size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
            <SectionLabel>IPS — {lang === 'nb' ? 'individuell pensjonssparing' : 'individual pension savings'}</SectionLabel>
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <NumberRow label={t.ipsBalance} value={pension.ipsBalance} onCommit={(v) => updatePension('ipsBalance', v)} suffix="kr" />
            <NumberRow
              label={t.ipsAnnualContribution}
              value={pension.ipsAnnualContribution}
              onCommit={(v) => updatePension('ipsAnnualContribution', Math.min(Math.max(0, v), IPS_MAX_DEDUCTION))}
              suffix="kr/år"
            />
            <SliderRow label={t.ipsGrowthRate} value={pension.ipsGrowthRate} onChange={(v) => updatePension('ipsGrowthRate', v)} min={0} max={12} step={0.5} suffix="%" badge={<ProvenanceBadge kind={provenanceOf(pension.ipsGrowthRate, DEFAULT_PENSION.ipsGrowthRate)} />} />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-[12px] p-3" style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}>
            <Calculator size={14} className="mt-0.5 shrink-0" />
            <span className="text-[12px]">
              {lang === 'nb'
                ? `${t.ipsHint} Du sparer ~${formatCurrency(ipsTaxSaving)}/år i skatt.`
                : `${t.ipsHint} You save ~${formatCurrency(ipsTaxSaving)}/yr in tax.`}
            </span>
          </div>
        </Card>
      </div>

      {/* Retirement target */}
      <Card padding="lg">
        <div className="flex items-center gap-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Lock size={14} strokeWidth={2} style={{ color: 'var(--text-2)' }} />
          <SectionLabel>{lang === 'nb' ? 'Mål' : 'Target'}</SectionLabel>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <NumberRow
            label={t.birthYear}
            value={pension.birthYear}
            onCommit={(v) => updatePension('birthYear', v)}
            suffix=""
          />
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
          {lang === 'nb'
            ? 'Pensjon er låst til pensjonsalder og holdes utenfor «Faktisk egenkapital» på Formue-siden. Uttak beskattes som alminnelig inntekt (22%) — beløpene over er brutto.'
            : 'Pension is locked until retirement age and is excluded from the liquid net-equity headline on the Assets page. Withdrawals are taxed as ordinary income (22%) — figures above are pre-tax.'}
        </p>
      </Card>
    </div>
    </>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
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

function NumberRow({
  label,
  value,
  onCommit,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(value.toString());
  // Re-sync the editable draft when the committed value changes from outside.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(value.toString()); }, [value]);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
          {label}
        </label>
        {suffix && <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{suffix}</span>}
      </div>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          onCommit(Number.isFinite(n) ? n : 0);
        }}
        className="w-full h-10 px-3 rounded-[12px] text-[14px] font-mono outline-none border"
        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      />
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  badge,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
            {label}
          </label>
          {badge}
        </div>
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

export default PensionPage;

// Re-export the Pension type so callers can keep using the page barrel.
export type { Pension };
