import React, { useMemo, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, Wallet, Activity } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import ChartTooltip from '../components/ChartTooltip';
import { calcTaxByRegion, IPS_MAX_DEDUCTION } from '../lib/norwegianTax';
import { currentMonthKey } from '../lib/date';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

function formatAxisInt(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
  return val.toString();
}

const ForecastPage: React.FC = () => {
  const { t, totalEquity, salaries, jobs, loan, income, housingMode, homeowner, formatCurrency, region, customTaxRatePct, pension } = useFinance();

  // Find current salary (most recent effectiveDate <= today).
  const currentGross = useMemo(() => {
    const today = currentMonthKey();
    const eligible = salaries.filter(s => s.effectiveDate <= today);
    // Fall back to the legacy monthly `income` annualized (matching
    // grossAnnualIncome elsewhere) rather than a fabricated magic number.
    if (eligible.length === 0) return income * 12;
    return eligible.reduce((a, b) => (a.effectiveDate > b.effectiveDate ? a : b)).grossAnnual;
  }, [salaries, income]);

  // Current job's on-call annual (for OTP base).
  const currentOnCall = useMemo(() => {
    const today = currentMonthKey();
    const eligible = salaries.filter(s => s.effectiveDate <= today);
    if (eligible.length === 0) return 0;
    const latest = eligible.reduce((a, b) => (a.effectiveDate > b.effectiveDate ? a : b));
    const job = jobs.find(j => j.id === latest.jobId);
    return job?.onCallAnnual ?? 0;
  }, [salaries, jobs]);

  // Retirement readiness: years to retirement + projected pension wealth.
  const retirement = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const hasBirthYear = pension.birthYear > 1900;
    const yearsToRetire = hasBirthYear
      ? Math.max(0, pension.retirementAge - (currentYear - pension.birthYear))
      : 0;
    const otpAnnual = (currentGross + currentOnCall) * (pension.otpEmployerPct + pension.otpEmployeePct) / 100;
    const ipsAnnual = Math.min(pension.ipsAnnualContribution, IPS_MAX_DEDUCTION);
    const futureValue = (start: number, contrib: number, rate: number, n: number) => {
      const r = rate / 100;
      if (n <= 0) return start;
      if (Math.abs(r) < 1e-9) return start + contrib * n;
      return start * Math.pow(1 + r, n) + contrib * (Math.pow(1 + r, n) - 1) / r;
    };
    const otpAtRetire = futureValue(pension.otpBalance, otpAnnual, pension.otpGrowthRate, yearsToRetire);
    const ipsAtRetire = futureValue(pension.ipsBalance, ipsAnnual, pension.ipsGrowthRate, yearsToRetire);
    return {
      hasBirthYear,
      yearsToRetire,
      otpAtRetire,
      ipsAtRetire,
      total: otpAtRetire + ipsAtRetire,
      otpAnnual,
      ipsAnnual,
    };
  }, [pension, currentGross, currentOnCall]);

  // Sliders / inputs (all expressed as percentages where applicable)
  const [raisePct, setRaisePct] = useState(4.5);
  const [savingsPct, setSavingsPct] = useState(25);
  const [returnPct, setReturnPct] = useState(5);
  const [inflationPct, setInflationPct] = useState(3);
  const [years, setYears] = useState(15);

  // Select the real mortgage by housing mode, exactly as the context does for
  // net-worth projections: homeowner uses the `homeowner` inputs; first-buyer &
  // transitioning use the `loan` planning inputs. Otherwise a homeowner's tile
  // would forecast a hypothetical first-buyer loan instead of their actual one.
  const isHomeowner = housingMode === 'homeowner';
  const startingMortgage = (isHomeowner ? homeowner.currentMortgageBalance : loan.laanebelop) ?? 0;
  const mortgageRate = ((isHomeowner ? homeowner.rente : loan.rente) ?? 5) / 100;
  const mortgageTermYears = (isHomeowner ? homeowner.nedbetalingstid : loan.nedbetalingstid) ?? 25;
  // Annual mortgage payment = annuitet
  const annualMortgagePayment = useMemo(() => {
    if (!startingMortgage || mortgageTermYears <= 0) return 0;
    const r = mortgageRate;
    const n = mortgageTermYears;
    // A 0% rate has no annuity denominator — pay the principal off linearly.
    if (r <= 0) return startingMortgage / n;
    return (startingMortgage * r) / (1 - Math.pow(1 + r, -n));
  }, [startingMortgage, mortgageRate, mortgageTermYears]);

  // Forecast series
  const projection = useMemo(() => {
    const out: {
      yearIndex: number;
      yearLabel: number;
      gross: number;
      net: number;
      contribution: number;
      netWorth: number;
      netWorthReal: number;
      mortgage: number;
    }[] = [];
    const startYear = new Date().getFullYear();
    let gross = currentGross;
    let netWorth = totalEquity;
    let mortgage = startingMortgage;

    for (let y = 0; y <= years; y++) {
      if (y > 0) {
        gross = gross * (1 + raisePct / 100);
        // Mortgage paydown (interest grows balance, payment reduces it)
        const interestAccrued = mortgage * mortgageRate;
        mortgage = Math.max(0, mortgage + interestAccrued - annualMortgagePayment);
      }
      const tax = calcTaxByRegion(gross, region, customTaxRatePct, pension.ipsAnnualContribution);
      const net = tax.netAnnual;
      const contribution = Math.max(0, net * (savingsPct / 100));
      if (y > 0) {
        netWorth = netWorth * (1 + returnPct / 100) + contribution;
      }
      const realDeflator = Math.pow(1 + inflationPct / 100, y);
      const netWorthReal = netWorth / realDeflator;
      out.push({
        yearIndex: y,
        yearLabel: startYear + y,
        gross: Math.round(gross),
        net: Math.round(net),
        contribution: Math.round(contribution),
        netWorth: Math.round(netWorth),
        netWorthReal: Math.round(netWorthReal),
        mortgage: Math.round(mortgage),
      });
    }
    return out;
  }, [currentGross, totalEquity, startingMortgage, mortgageRate, annualMortgagePayment, raisePct, savingsPct, returnPct, inflationPct, years, region, customTaxRatePct, pension.ipsAnnualContribution]);

  const last = projection[projection.length - 1];
  const first = projection[0];

  void jobs;

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero header */}
      <header data-tour="forecast-hero" className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {t.forecast.heroLabel}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.forecast.heroTitlePre}{' '}
          <em className="font-serif italic" style={{ color: 'var(--brass)' }}>{t.forecast.heroTitleEm}</em>
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {t.forecast.subtitle}
        </p>
      </header>

      {/* Control panel */}
      <div className={`${card} p-5 md:p-7 space-y-5`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Activity size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.forecastPage.assumptions}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <SliderInput label={t.forecast.raiseAssumption} value={raisePct} onChange={setRaisePct} min={0} max={15} step={0.5} suffix="%" />
          <SliderInput label={t.forecast.savingsRateAssumption} value={savingsPct} onChange={setSavingsPct} min={0} max={70} step={5} suffix="%" />
          <SliderInput label={t.forecast.returnAssumption} value={returnPct} onChange={setReturnPct} min={-2} max={12} step={0.5} suffix="%" />
          <SliderInput label={t.forecast.inflationAssumption} value={inflationPct} onChange={setInflationPct} min={0} max={10} step={0.5} suffix="%" />
          <SliderInput label={t.forecast.years} value={years} onChange={setYears} min={1} max={40} step={1} suffix={t.forecastPage.yearSuffix} />
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        <SummaryTile
          label={t.forecast.grossSalary}
          now={formatCurrency(first.gross)}
          then={formatCurrency(last.gross)}
          thenLabel={`${t.forecast.summaryEnd} ${years} ${t.forecastPage.yearSuffix}`}
        />
        <SummaryTile
          label={t.forecast.netTakeHome}
          now={formatCurrency(first.net)}
          then={formatCurrency(last.net)}
          thenLabel={`${t.forecast.summaryEnd} ${years} ${t.forecastPage.yearSuffix}`}
        />
        <SummaryTile
          label={t.forecast.netWorthProjected}
          now={formatCurrency(first.netWorth)}
          then={formatCurrency(last.netWorth)}
          thenLabel={`${t.forecast.summaryEnd} ${years} ${t.forecastPage.yearSuffix}`}
          subThen={`${t.forecast.realGrowth} ${formatCurrency(last.netWorthReal)}`}
          color="var(--accent)"
        />
        <SummaryTile
          label={t.forecast.mortgageRemaining}
          now={formatCurrency(first.mortgage)}
          then={formatCurrency(last.mortgage)}
          thenLabel={`${t.forecast.summaryEnd} ${years} ${t.forecastPage.yearSuffix}`}
          color={last.mortgage === 0 ? 'var(--positive)' : 'var(--text-1)'}
        />
        <SummaryTile
          label={t.pensionAtRetirement}
          now={formatCurrency(pension.otpBalance + pension.ipsBalance)}
          then={retirement.hasBirthYear ? formatCurrency(retirement.total) : '—'}
          thenLabel={retirement.hasBirthYear
            ? `${retirement.yearsToRetire} ${t.yearsToRetirement}`
            : t.setBirthYearHint}
          subThen={retirement.hasBirthYear
            ? `${formatCurrency(retirement.otpAnnual + retirement.ipsAnnual)}/${t.forecastPage.yearSuffix} ${t.forecastPage.in}`
            : undefined}
          color="var(--violet)"
        />
      </div>

      {/* Net worth projection chart */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.forecast.forecastChart}</h3>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.forecast.forecastChartDesc}</p>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projection} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.12} />
                </linearGradient>
                <linearGradient id="forecastRealGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="var(--violet)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
              <XAxis dataKey="yearLabel" tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisInt} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: 'var(--text-3)', strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <ReferenceLine y={first.netWorth} stroke="var(--text-3)" strokeDasharray="2 4" />
              <Area type="monotone" dataKey="netWorth" name={t.forecastPage.nominal} stroke="var(--accent)" strokeWidth={2.5} fill="url(#forecastGradient)" />
              <Area type="monotone" dataKey="netWorthReal" name={t.forecastPage.todaysKroner} stroke="var(--violet)" strokeWidth={2} strokeDasharray="5 3" fill="url(#forecastRealGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{t.forecastPage.nominal}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--violet)' }} />{t.forecastPage.todaysKroner}</div>
        </div>
      </div>

      {/* Salary chart */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Wallet size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <h3 className={sectionLabel}>{t.forecast.salaryChart}</h3>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.forecast.salaryChartDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projection} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262A20" />
              <XAxis dataKey="yearLabel" tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisInt} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="gross" name={t.forecast.grossSalary} stroke="var(--accent)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="net" name={t.forecast.netTakeHome} stroke="var(--positive)" strokeWidth={2.5} dot={false} />
              {startingMortgage > 0 && (
                <Line type="monotone" dataKey="mortgage" name={t.forecast.mortgageRemaining} stroke="var(--negative)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{t.forecast.grossSalary}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--positive)' }} />{t.forecast.netTakeHome}</div>
          {startingMortgage > 0 && <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--negative)' }} />{t.forecast.mortgageRemaining}</div>}
        </div>
      </div>
    </div>
  );
};

// ── Subcomponents ──────────────────────────────────────────────────

interface SliderInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

const SliderInput: React.FC<SliderInputProps> = ({ label, value, onChange, min, max, step, suffix }) => (
  <div className="space-y-2">
    <div className="flex items-baseline justify-between gap-2">
      <span className={sectionLabel}>{label}</span>
      <span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
        {value}{suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
      style={{ background: 'color-mix(in srgb, var(--text-3) 18%, transparent)' }}
    />
  </div>
);

interface SummaryTileProps {
  label: string;
  now: string;
  then: string;
  thenLabel: string;
  subThen?: string;
  color?: string;
}

const SummaryTile: React.FC<SummaryTileProps> = ({ label, now, then, thenLabel, subThen, color }) => (
  <div className={`${card} p-4 md:p-5 space-y-1.5`}>
    <div className={sectionLabel}>{label}</div>
    <div className="text-[14px] md:text-[24px] leading-tight [overflow-wrap:anywhere] font-semibold font-mono tabular-nums" style={{ color: color ?? 'var(--text-1)' }}>
      {then}
    </div>
    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{thenLabel}</div>
    <div className="text-[11px] font-mono pt-1 border-t" style={{ color: 'var(--text-2)', borderColor: 'var(--border)' }}>
      Nå · {now}
    </div>
    {subThen && <div className="text-[10px] font-mono" style={{ color: 'var(--violet)' }}>{subThen}</div>}
  </div>
);

export default ForecastPage;
