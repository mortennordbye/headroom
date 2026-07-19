import React, { useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, Wallet, Activity, Flame, Scale, GitCompare } from 'lucide-react';
import { useFinance, calcActiveGrossAnnual } from '../context/FinanceContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import ChartTooltip from '../components/ChartTooltip';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../lib/chartColors';
import { calcTaxByRegion, calcPensionIncomeTax, IPS_MAX_DEDUCTION, TAX_YEAR } from '../lib/norwegianTax';
import { projectBeholdning, estimateBeholdning, annualFolketrygdPension } from '../lib/folketrygd';
import { estimateAfpGrunnlag, annualAfp } from '../lib/afp';
import { prepayVsInvest } from '../lib/prepayVsInvest';
import { netWorthBands } from '../lib/scenarioBands';
import { projectForecast, type EffectiveScenario, type ForecastScenario, type ForecastInputs } from '../lib/forecastProjection';
import { calcMonthlyPayment } from '../lib/calculations';
import { pensionFutureValue } from '../lib/pension';
import { sumSavings } from '../lib/equity';
import { currentMonthKey, addMonthsKey } from '../lib/date';
import { formatAxisInt } from '../lib/format';

const ForecastPage: React.FC = () => {
  const {
    t, totalEquity, totalFixedExpenses, salaries, jobs, loan, income, housingMode, homeowner,
    formatCurrency, region, customTaxRatePct, pension,
    recommendedInvestment, growthReturnRate, inflation, annualMortgageInterest,
    assets, houseGrowthRate, netInvestment, netCrypto, totalDebt,
    forecastAssumptions: fa, setForecastAssumptions,
  } = useFinance();
  const reduced = useReducedMotion();

  // Current month in render scope so the memos below recompute if the month
  // rolls over during a long-lived session.
  const today = currentMonthKey();
  // Total current gross = base + on-call across all active jobs — the same
  // figure the Salary and Budget pages use, not just one job's base salary.
  const currentGross = useMemo(() => {
    const active = calcActiveGrossAnnual(salaries, jobs, today);
    return active > 0 ? active : income * 12;
  }, [salaries, jobs, income, today]);

  // Retirement readiness: years to retirement + projected pension wealth.
  const retirement = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const hasBirthYear = pension.birthYear > 1900;
    const yearsToRetire = hasBirthYear
      ? Math.max(0, pension.retirementAge - (currentYear - pension.birthYear))
      : 0;
    const otpAnnual = currentGross * (pension.otpEmployerPct + pension.otpEmployeePct) / 100;
    const ipsAnnual = Math.min(pension.ipsAnnualContribution, IPS_MAX_DEDUCTION);
    const otpAtRetire = pensionFutureValue(pension.otpBalance, otpAnnual, pension.otpGrowthRate, yearsToRetire);
    const ipsAtRetire = pensionFutureValue(pension.ipsBalance, ipsAnnual, pension.ipsGrowthRate, yearsToRetire);

    // Folketrygd (state pension) + net-of-tax drawdown — the honest monthly figure.
    const currentBeholdning = pension.folketrygdBeholdning > 0
      ? pension.folketrygdBeholdning
      : estimateBeholdning({ birthYear: pension.birthYear, currentYear, annualIncome: currentGross });
    const beholdningAtRetire = projectBeholdning(currentBeholdning, currentGross, yearsToRetire, TAX_YEAR);
    const ft = annualFolketrygdPension({
      beholdning: beholdningAtRetire,
      birthYear: pension.birthYear,
      retirementAge: pension.retirementAge,
      single: pension.folketrygdSingle ?? true,
      year: TAX_YEAR,
    });
    const payoutYears = Math.max(1, pension.pensionPayoutYears || 10);
    const afpAnnual = pension.afpEligible
      ? annualAfp({
          grunnlag: estimateAfpGrunnlag({ birthYear: pension.birthYear, annualIncome: currentGross, year: TAX_YEAR }),
          birthYear: pension.birthYear,
          retirementAge: pension.retirementAge,
        })
      : 0;
    const grossPensionAnnual = ft.annual + afpAnnual + otpAtRetire / payoutYears + ipsAtRetire / payoutYears;
    const netPensionAnnual = region === 'no'
      ? calcPensionIncomeTax(grossPensionAnnual, TAX_YEAR).netAnnual
      : calcTaxByRegion(grossPensionAnnual, region, customTaxRatePct).netAnnual;

    return {
      hasBirthYear,
      yearsToRetire,
      otpAtRetire,
      ipsAtRetire,
      total: otpAtRetire + ipsAtRetire,
      otpAnnual,
      ipsAnnual,
      folketrygdAnnual: ft.annual,
      netPensionMonthly: netPensionAnnual / 12,
    };
  }, [pension, currentGross, region, customTaxRatePct]);

  // Seeds from the user's real data — the sliders start from these instead of
  // magic numbers, and follow the data until the user overrides a slider.
  const raiseSeed = useMemo(() => {
    const sorted = [...salaries].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    if (sorted.length < 2) return 4.5;
    const first = sorted[0], last = sorted[sorted.length - 1];
    const [fy, fm] = first.effectiveDate.split('-').map(Number);
    const [ly, lm] = last.effectiveDate.split('-').map(Number);
    const yrs = ((ly - fy) * 12 + (lm - fm)) / 12;
    if (yrs <= 0 || first.grossAnnual <= 0) return 4.5;
    const cagr = (Math.pow(last.grossAnnual / first.grossAnnual, 1 / yrs) - 1) * 100;
    return Number.isFinite(cagr) && cagr > 0 ? Math.round(cagr * 10) / 10 : 4.5;
  }, [salaries]);

  const inflationSeed = useMemo(() => {
    if (inflation.length === 0) return 3;
    let latest = inflation[0];
    for (const p of inflation) if (p.month > latest.month) latest = p;
    const prior = inflation.find(p => p.month === addMonthsKey(latest.month, -12));
    if (!prior || prior.cpiIndex <= 0) return 3;
    const pct = (latest.cpiIndex / prior.cpiIndex - 1) * 100;
    return Number.isFinite(pct) && pct > 0 ? Math.round(pct * 10) / 10 : 3;
  }, [inflation]);

  const savingsSeed = useMemo(() => {
    const net = calcTaxByRegion(currentGross, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest).netAnnual;
    if (net <= 0) return 25;
    const pct = (recommendedInvestment * 12 / net) * 100;
    return Number.isFinite(pct) && pct > 0 ? Math.min(90, Math.round(pct)) : 25;
  }, [currentGross, region, customTaxRatePct, pension.ipsAnnualContribution, annualMortgageInterest, recommendedInvestment]);

  // Assumptions are persisted per scenario (null-until-dragged, so each slider
  // keeps following its live-data seed until the user sets it). Scenario B seeds
  // from A, so "compare" opens as a copy of A that you diverge one lever at a time.
  const compareOn = fa.compareOn;
  const setA = (patch: Partial<ForecastScenario>) => setForecastAssumptions({ ...fa, a: { ...fa.a, ...patch } });
  const setB = (patch: Partial<ForecastScenario>) => setForecastAssumptions({ ...fa, b: { ...fa.b, ...patch } });
  const toggleCompare = () => setForecastAssumptions({ ...fa, compareOn: !fa.compareOn });

  const effA: EffectiveScenario = {
    raisePct: fa.a.raisePct ?? raiseSeed,
    savingsPct: fa.a.savingsPct ?? savingsSeed,
    returnPct: fa.a.returnPct ?? growthReturnRate,
    inflationPct: fa.a.inflationPct ?? inflationSeed,
    years: fa.a.years ?? 15,
    extraMonthly: fa.a.extraMonthly ?? 5000,
  };
  const effB: EffectiveScenario = {
    raisePct: fa.b.raisePct ?? effA.raisePct,
    savingsPct: fa.b.savingsPct ?? effA.savingsPct,
    returnPct: fa.b.returnPct ?? effA.returnPct,
    inflationPct: fa.b.inflationPct ?? effA.inflationPct,
    years: fa.b.years ?? effA.years,
    extraMonthly: fa.b.extraMonthly ?? effA.extraMonthly,
  };
  // Scenario A drives every existing tile/chart/memo below under the original names.
  const { returnPct, years, extraMonthly } = effA;

  // Select the real mortgage by housing mode, exactly as the context does for
  // net-worth projections: homeowner uses the `homeowner` inputs; first-buyer &
  // transitioning use the `loan` planning inputs. Otherwise a homeowner's tile
  // would forecast a hypothetical first-buyer loan instead of their actual one.
  const isHomeowner = housingMode === 'homeowner';
  const startingMortgage = (isHomeowner ? homeowner.currentMortgageBalance : loan.laanebelop) ?? 0;
  const mortgageRatePct = (isHomeowner ? homeowner.rente : loan.rente) ?? 5;
  const mortgageTermYears = (isHomeowner ? homeowner.nedbetalingstid : loan.nedbetalingstid) ?? 25;
  // Annual mortgage payment = 12 × the shared monthly annuity, so the forecast
  // uses the same payment as the Loan page rather than re-deriving it annually.
  const annualMortgagePayment = useMemo(
    () => calcMonthlyPayment(startingMortgage, mortgageRatePct, mortgageTermYears) * 12,
    [startingMortgage, mortgageRatePct, mortgageTermYears],
  );

  // Non-assumption inputs shared by both scenarios (the user's real position).
  const inputs = useMemo<ForecastInputs>(() => ({
    currentGross, totalEquity, startingMortgage, mortgageRatePct,
    annualMortgagePayment, region, customTaxRatePct,
    ipsAnnualContribution: pension.ipsAnnualContribution,
    startYear: new Date().getFullYear(),
    // Composition — used only to estimate the yearly wealth-tax drag.
    startHomeValue: assets.houseValue,
    houseGrowthPct: houseGrowthRate,
    startShares: netInvestment,
    startOtherAssets: netCrypto + sumSavings(assets) + assets.bsu + assets.bufferAccount,
    nonMortgageDebt: totalDebt,
  }), [currentGross, totalEquity, startingMortgage, mortgageRatePct, annualMortgagePayment, region, customTaxRatePct, pension.ipsAnnualContribution, assets, houseGrowthRate, netInvestment, netCrypto, totalDebt]);

  // Forecast series — scenario A always, scenario B only while comparing.
  const projection = useMemo(() => projectForecast(inputs, effA),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs, effA.raisePct, effA.savingsPct, effA.returnPct, effA.inflationPct, effA.years]);
  const projectionB = useMemo(() => (compareOn ? projectForecast(inputs, effB) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareOn, inputs, effB.raisePct, effB.savingsPct, effB.returnPct, effB.inflationPct, effB.years]);

  const last = projection[projection.length - 1];
  const first = projection[0];

  // A vs B final net worth (compare mode) — the delta tile.
  const compare = useMemo(() => {
    if (!projectionB || projectionB.length === 0) return null;
    const aFinal = projection[projection.length - 1].netWorth;
    const bFinal = projectionB[projectionB.length - 1].netWorth;
    return { aFinal, bFinal, delta: aFinal - bFinal };
  }, [projection, projectionB]);

  // Bear/base/bull bands (return ±3pp) so the projection doesn't read as a
  // single certain line. The per-year contribution net of that year's wealth-tax
  // charge is held the same across scenarios (it depends on income/savings/tax,
  // not the return), so the band base still equals the netWorth line and only the
  // growth rate varies.
  const BAND_DELTA_PP = 3;
  const chartData = useMemo(() => {
    const bands = netWorthBands(totalEquity, projection.map(p => p.contribution - p.wealthTax), returnPct, BAND_DELTA_PP, years);
    return projection.map((p, i) => ({
      ...p,
      band: [bands[i]?.bear ?? p.netWorth, bands[i]?.bull ?? p.netWorth] as [number, number],
      netWorthB: projectionB ? (projectionB[i]?.netWorth ?? null) : null,
    }));
  }, [projection, projectionB, totalEquity, returnPct, years]);

  // Financial independence (4% rule): FI number = 25× annual essential spend.
  // The FI year is the first projected year whose real (today's-kroner) net worth
  // clears that number, so it stays comparable to today's expenses. Only shown
  // when there are essential expenses to anchor the target on.
  const fire = useMemo(() => {
    const annualEssential = totalFixedExpenses * 12;
    const fiNumber = 25 * annualEssential;
    if (fiNumber <= 0) return null;
    const progressPct = Math.max(0, Math.min(100, (totalEquity / fiNumber) * 100));
    const hit = projection.find((p) => p.netWorthReal >= fiNumber);
    return {
      annualEssential,
      fiNumber,
      progressPct,
      fiYear: hit ? hit.yearLabel : null,
      yearsToFi: hit ? hit.yearIndex : null,
    };
  }, [totalFixedExpenses, totalEquity, projection]);

  // Prepay mortgage vs invest: the extra krone earns the after-tax mortgage rate
  // if it pays down deductible debt, or the expected return if invested. The
  // deduction rate is 22% (alminnelig inntekt) in Norway, or the user's flat
  // rate in generic mode. Only shown when there's actually a mortgage to prepay.
  const prepay = useMemo(() => {
    if (startingMortgage <= 0) return null;
    const deductionRate = region === 'no' ? 22 : customTaxRatePct;
    return prepayVsInvest(extraMonthly, mortgageRatePct, returnPct, years, deductionRate);
  }, [startingMortgage, region, customTaxRatePct, extraMonthly, mortgageRatePct, returnPct, years]);

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
      <Card padding="none" className="p-5 md:p-7 space-y-5">
        <div className="flex items-center justify-between gap-2 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Activity size={14} strokeWidth={2} className="text-[var(--text-2)]" />
            <SectionLabel>{t.forecastPage.assumptions}</SectionLabel>
          </div>
          <button
            onClick={toggleCompare}
            aria-pressed={compareOn}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] font-medium border transition-colors"
            style={compareOn
              ? { background: 'var(--accent-bg)', borderColor: 'var(--accent)', color: 'var(--accent)' }
              : { borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            <GitCompare size={13} strokeWidth={2} />
            {compareOn ? t.forecast.compareOn : t.forecast.compare}
          </button>
        </div>

        {compareOn && <SectionLabel style={{ color: 'var(--accent)' }}>{t.forecast.scenarioA}</SectionLabel>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <SliderInput label={t.forecast.raiseAssumption} value={effA.raisePct} onChange={(v) => setA({ raisePct: v })} min={0} max={15} step={0.5} suffix="%" />
          <SliderInput label={t.forecast.savingsRateAssumption} value={effA.savingsPct} onChange={(v) => setA({ savingsPct: v })} min={0} max={70} step={5} suffix="%" />
          <SliderInput label={t.forecast.returnAssumption} value={effA.returnPct} onChange={(v) => setA({ returnPct: v })} min={-2} max={12} step={0.5} suffix="%" />
          <SliderInput label={t.forecast.inflationAssumption} value={effA.inflationPct} onChange={(v) => setA({ inflationPct: v })} min={0} max={10} step={0.5} suffix="%" />
          <SliderInput label={t.forecast.years} value={effA.years} onChange={(v) => setA({ years: v })} min={1} max={40} step={1} suffix={t.forecastPage.yearSuffix} />
        </div>

        {compareOn && (
          <>
            <div className="pt-1 border-t border-[var(--border)]" />
            <SectionLabel style={{ color: 'var(--brass)' }}>{t.forecast.scenarioB}</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <SliderInput label={t.forecast.raiseAssumption} value={effB.raisePct} onChange={(v) => setB({ raisePct: v })} min={0} max={15} step={0.5} suffix="%" accent="var(--brass)" />
              <SliderInput label={t.forecast.savingsRateAssumption} value={effB.savingsPct} onChange={(v) => setB({ savingsPct: v })} min={0} max={70} step={5} suffix="%" accent="var(--brass)" />
              <SliderInput label={t.forecast.returnAssumption} value={effB.returnPct} onChange={(v) => setB({ returnPct: v })} min={-2} max={12} step={0.5} suffix="%" accent="var(--brass)" />
              <SliderInput label={t.forecast.inflationAssumption} value={effB.inflationPct} onChange={(v) => setB({ inflationPct: v })} min={0} max={10} step={0.5} suffix="%" accent="var(--brass)" />
              <SliderInput label={t.forecast.years} value={effB.years} onChange={(v) => setB({ years: v })} min={1} max={40} step={1} suffix={t.forecastPage.yearSuffix} accent="var(--brass)" />
            </div>
            {compare && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] p-4 border bg-[var(--bg-raised)] border-[var(--border)]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{t.forecast.compareDelta}</div>
                  <div className="text-[12px] font-mono mt-0.5" style={{ color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--accent)' }}>A</span> {formatCurrency(compare.aFinal)} · <span style={{ color: 'var(--brass)' }}>B</span> {formatCurrency(compare.bFinal)}
                  </div>
                </div>
                <div className="text-[14px] font-mono font-semibold" style={{ color: compare.delta >= 0 ? 'var(--accent)' : 'var(--brass)' }}>
                  {(compare.delta >= 0 ? t.forecast.compareAWins : t.forecast.compareBWins)
                    .replace('{amount}', formatCurrency(Math.abs(compare.delta)))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

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
            ? `${formatCurrency(retirement.netPensionMonthly)}${t.forecastPage.netPerMonthState}`
            : undefined}
          color="var(--violet)"
        />
      </div>

      {/* Financial independence (FIRE) tile */}
      {fire && (
        <Card padding="none" className="p-5 md:p-7 space-y-4">
          <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
            <Flame size={14} strokeWidth={2} className="text-[var(--text-2)]" />
            <SectionLabel>{t.forecast.fireTitle}</SectionLabel>
          </div>
          <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.forecast.fireDesc}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
            <FireStat
              label={t.forecast.fireNumber}
              value={formatCurrency(Math.round(fire.fiNumber))}
              sub={`${formatCurrency(Math.round(fire.annualEssential))} ${t.forecast.fireEssential}`}
            />
            <FireStat
              label={t.forecast.fireProgress}
              value={`${fire.progressPct.toFixed(0)}%`}
              sub={formatCurrency(Math.round(totalEquity))}
              color="var(--accent)"
            />
            <FireStat
              label={t.forecast.fireYear}
              value={fire.fiYear == null
                ? t.forecast.fireBeyond.replace('{years}', String(years))
                : fire.yearsToFi === 0
                  ? t.forecast.fireReached
                  : String(fire.fiYear)}
              sub={fire.fiYear != null && fire.yearsToFi != null && fire.yearsToFi > 0
                ? `${fire.yearsToFi} ${t.forecastPage.yearSuffix}`
                : undefined}
              color="var(--violet)"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px] mb-1.5" style={{ color: 'var(--text-2)' }}>
              <span>{t.forecast.fireProgress}</span>
              <span className="font-mono font-medium text-[var(--text-1)]">{fire.progressPct.toFixed(0)}%</span>
            </div>
            <ProgressBar pct={fire.progressPct} color="var(--accent)" />
          </div>
        </Card>
      )}

      {/* Prepay vs invest */}
      {prepay && (
        <Card padding="none" className="p-5 md:p-7 space-y-4">
          <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
            <Scale size={14} strokeWidth={2} className="text-[var(--text-2)]" />
            <SectionLabel>{t.forecast.prepayTitle}</SectionLabel>
          </div>
          <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.forecast.prepayDesc}</p>
          <div className="max-w-xs">
            <SliderInput label={t.forecast.prepayExtra} value={extraMonthly} onChange={(v) => setA({ extraMonthly: v })} min={0} max={20000} step={500} suffix=" kr" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <FireStat
              label={t.forecast.prepayLegPrepay}
              value={formatCurrency(Math.round(prepay.prepayFutureValue))}
              sub={`${prepay.afterTaxMortgageRatePct.toFixed(1)}% · ${t.forecast.prepayAfterTaxRateSub}`}
              color={prepay.winner === 'prepay' ? 'var(--positive)' : undefined}
            />
            <FireStat
              label={t.forecast.prepayLegInvest}
              value={formatCurrency(Math.round(prepay.investFutureValue))}
              sub={`${returnPct}% · ${t.forecast.prepayReturnSub}`}
              color={prepay.winner === 'invest' ? 'var(--accent)' : undefined}
            />
          </div>
          <div
            className="text-[13px] font-semibold"
            style={{ color: prepay.winner === 'prepay' ? 'var(--positive)' : prepay.winner === 'invest' ? 'var(--accent)' : 'var(--text-2)' }}
          >
            {(prepay.winner === 'prepay' ? t.forecast.prepayWinsPrepay
              : prepay.winner === 'invest' ? t.forecast.prepayWinsInvest
              : t.forecast.prepayTie)
              .replace('{amount}', formatCurrency(Math.round(prepay.advantage)))
              .replace('{years}', String(years))}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{t.forecast.prepayNote}</p>
        </Card>
      )}

      {/* Net worth projection chart */}
      <Card padding="none" className="p-5 md:p-7 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{t.forecast.forecastChart}</SectionLabel>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.forecast.forecastChartDesc}</p>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
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
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="yearLabel" {...AXIS_PROPS} />
              <YAxis tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={52} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: 'var(--text-3)', strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <ReferenceLine y={first.netWorth} stroke="var(--text-3)" strokeDasharray="2 4" />
              {/* Uncertainty band (bear↔bull), drawn first so the lines sit on top. */}
              <Area type="monotone" dataKey="band" name={t.forecastPage.band} stroke="none" fill="var(--accent)" fillOpacity={0.09} isAnimationActive={false} activeDot={false} legendType="none" />
              <Area isAnimationActive={!reduced} type="monotone" dataKey="netWorth" name={compareOn ? t.forecast.scenarioA : t.forecastPage.nominal} stroke="var(--accent)" strokeWidth={2.5} fill="url(#forecastGradient)" />
              <Area isAnimationActive={!reduced} type="monotone" dataKey="netWorthReal" name={t.forecastPage.todaysKroner} stroke="var(--violet)" strokeWidth={2} strokeDasharray="5 3" fill="url(#forecastRealGradient)" />
              {compareOn && (
                <Area isAnimationActive={!reduced} type="monotone" dataKey="netWorthB" name={t.forecast.scenarioB} stroke="var(--brass)" strokeWidth={2} strokeDasharray="6 3" fill="none" connectNulls />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{compareOn ? t.forecast.scenarioA : t.forecastPage.nominal}</div>
          {compareOn && <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--brass)' }} />{t.forecast.scenarioB}</div>}
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--violet)' }} />{t.forecastPage.todaysKroner}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)', opacity: 0.25 }} />{t.forecastPage.band}</div>
        </div>
      </Card>

      {/* Salary chart */}
      <Card padding="none" className="p-5 md:p-7 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
          <Wallet size={14} strokeWidth={2} className="text-[var(--text-2)]" />
          <SectionLabel>{t.forecast.salaryChart}</SectionLabel>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{t.forecast.salaryChartDesc}</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projection} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="yearLabel" {...AXIS_PROPS} />
              <YAxis tickFormatter={formatAxisInt} {...AXIS_PROPS_Y} width={52} />
              <Tooltip content={<ChartTooltip />} />
              <Line isAnimationActive={!reduced} type="monotone" dataKey="gross" name={t.forecast.grossSalary} stroke="var(--accent)" strokeWidth={2.5} dot={false} />
              <Line isAnimationActive={!reduced} type="monotone" dataKey="net" name={t.forecast.netTakeHome} stroke="var(--positive)" strokeWidth={2.5} dot={false} />
              {startingMortgage > 0 && (
                <Line isAnimationActive={!reduced} type="monotone" dataKey="mortgage" name={t.forecast.mortgageRemaining} stroke="var(--negative)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{t.forecast.grossSalary}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--positive)' }} />{t.forecast.netTakeHome}</div>
          {startingMortgage > 0 && <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--negative)' }} />{t.forecast.mortgageRemaining}</div>}
        </div>
      </Card>
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
  accent?: string;
}

const SliderInput: React.FC<SliderInputProps> = ({ label, value, onChange, min, max, step, suffix, accent = 'var(--accent)' }) => (
  <div className="space-y-2">
    <div className="flex items-baseline justify-between gap-2">
      <SectionLabel>{label}</SectionLabel>
      <span className="font-mono text-[13px] font-semibold" style={{ color: accent }}>
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
      className="w-full h-2 rounded-full appearance-none cursor-pointer"
      style={{ accentColor: accent, background: 'color-mix(in srgb, var(--text-3) 18%, transparent)' }}
    />
  </div>
);

const FireStat: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div className="rounded-[8px] p-4 border bg-[var(--bg-raised)] border-[var(--border)]">
    <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-2)] mb-1">{label}</div>
    <div className="text-[18px] md:text-[20px] font-mono font-semibold leading-tight [overflow-wrap:anywhere]" style={{ color: color ?? 'var(--text-1)' }}>{value}</div>
    {sub && <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-3)' }}>{sub}</div>}
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

const SummaryTile: React.FC<SummaryTileProps> = ({ label, now, then, thenLabel, subThen, color }) => {
  const { t } = useFinance();
  return (
    <Card padding="none" className="p-4 md:p-5 space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-[14px] md:text-[24px] leading-tight [overflow-wrap:anywhere] font-semibold font-mono tabular-nums" style={{ color: color ?? 'var(--text-1)' }}>
        {then}
      </div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{thenLabel}</div>
      <div className="text-[11px] font-mono pt-1 border-t" style={{ color: 'var(--text-2)', borderColor: 'var(--border)' }}>
        {t.forecastPage.now} · {now}
      </div>
      {subThen && <div className="text-[10px] font-mono" style={{ color: 'var(--violet)' }}>{subThen}</div>}
    </Card>
  );
};

export default ForecastPage;
