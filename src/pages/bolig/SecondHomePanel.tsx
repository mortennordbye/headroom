import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Home, Hammer, ArrowRight, Info, Layers, AlertTriangle, LineChart } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useFinance } from '../../context/FinanceContext';
import { computeEquityBreakdown, sumSavings } from '../../lib/equity';
import { calcDebtToIncome, calcMonthlyPayment } from '../../lib/calculations';
import { creditFrameBreakdown } from '../../lib/debt';
import { estimatedPropertyValue } from '../../lib/propertyEstimate';
import { StatCard } from '../../components/ui/StatCard';
import { NumberRow } from '../../components/ui/NumberRow';
import { DeltaChip } from '../../components/ui/DeltaChip';
import ChartTooltip from '../../components/ChartTooltip';
import { AXIS_PROPS, AXIS_PROPS_Y, GRID_PROPS } from '../../lib/chartColors';
import {
  DEFAULT_SECOND_HOME_SCENARIO,
  calcPurchaseCosts,
  calcRentalCashflow,
  calcWealthTaxImpact,
  calcPropertyCapitalGains,
  calcBrrr,
  projectValue,
  stressRate,
  calcPortfolio,
  summarizeScenario,
  calcRealBorrowingCapacity,
  type SecondHomeScenario,
  type SecondHomeStrategy,
} from '../../lib/secondHome';

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const SecondHomePanel: React.FC = () => {
  const {
    t, formatCurrency,
    secondHomeScenarios, addSecondHomeScenario, updateSecondHomeScenario, removeSecondHomeScenario,
    boligAssumptions: ba, updateBoligAssumptions,
    grossAnnualIncome, totalDebt, capacityDebt, debts, assets,
    policyRate, houseGrowthRate,
    kvmpris, loadKvmpris,
  } = useFinance();
  const bp = t.boligPage;

  const [selectedId, setSelectedId] = useState<string | null>(secondHomeScenarios[0]?.id ?? null);
  const scenario = secondHomeScenarios.find((s) => s.id === selectedId) ?? secondHomeScenarios[0] ?? null;

  // Real-borrowing-capacity knobs. Household-level stress-test levers, persisted in
  // `boligAssumptions` so they survive a reload. The three overrides fall back to
  // the app's live/auto figure when null: base salary → derived gross income,
  // credit frames → sum of recorded credit limits, liquid → derived liquid assets.
  const { nonFrameDebt, creditFrameTotal } = useMemo(() => creditFrameBreakdown(debts), [debts]);
  const baseSalary = ba.baseSalaryOverride ?? Math.round(grossAnnualIncome);
  const bonus = ba.bonusAnnual;
  const includeBonus = ba.includeBonus;
  const rentFactorPct = ba.rentFactorPct;
  const creditFrames = ba.creditFramesOverride ?? Math.round(creditFrameTotal);

  const pct = (n: number) => `${n.toFixed(1)} %`;

  const addScenario = () => {
    const n = secondHomeScenarios.length + 1;
    const id = addSecondHomeScenario({
      ...DEFAULT_SECOND_HOME_SCENARIO,
      name: `${bp.scenarioDefaultName} ${n}`,
      // Prefill assumptions from the platform's live data.
      mortgageRatePct: policyRate != null ? Math.round((policyRate + 2) * 10) / 10 : DEFAULT_SECOND_HOME_SCENARIO.mortgageRatePct,
      annualAppreciationPct: houseGrowthRate ?? DEFAULT_SECOND_HOME_SCENARIO.annualAppreciationPct,
    });
    setSelectedId(id);
  };

  const set = (patch: Partial<Omit<SecondHomeScenario, 'id'>>) => {
    if (scenario) updateSecondHomeScenario(scenario.id, patch);
  };

  // ── All derived numbers for the selected scenario ──
  const derived = useMemo(() => {
    if (!scenario) return null;
    const s = scenario;
    const purchaseCosts = calcPurchaseCosts(s.purchasePrice, s.dokumentavgiftPct, s.tinglysingsgebyr, s.otherPurchaseCosts);
    const brrr = calcBrrr(s);
    const isBrrr = s.strategy === 'brrr';
    // BRRR holds and rents at the refinanced balance; a plain rental at the initial loan.
    const loanAmount = isBrrr ? brrr.maxRefiLoan : s.purchasePrice * (1 - clamp(s.equityShare, 0, 1));
    const marketValue = isBrrr ? brrr.arv : s.purchasePrice;
    const cashflow = calcRentalCashflow(s, loanAmount);
    // DTI counts ALL debt: the existing home mortgage (assets.houseDebt), other
    // non-mortgage debt, and this new loan — matching the Dashboard's DTI.
    const dti = calcDebtToIncome(assets.houseDebt + totalDebt + loanAmount, grossAnnualIncome);
    const ltv = marketValue > 0 ? (loanAmount / marketValue) * 100 : 0;
    const stressPct = stressRate(s.mortgageRatePct);
    const stressedMonthly = calcMonthlyPayment(loanAmount, stressPct, s.termYears);
    const wealth = calcWealthTaxImpact(marketValue, loanAmount, s.marginalWealthTaxPct);
    const projectedSale = projectValue(marketValue, s.annualAppreciationPct, s.holdYears);
    const improvements = s.documentedImprovements + (isBrrr ? s.renovationCost : 0);
    const gains = calcPropertyCapitalGains(projectedSale, s.purchasePrice, purchaseCosts.total, improvements, s.saleAgentFeePct);
    const interestDeductionValue = cashflow.annualInterest * 0.22;

    // Cash needed up front (equity + purchase costs, plus renovation for BRRR).
    const equity = s.purchasePrice * clamp(s.equityShare, 0, 1);
    const cashNeeded = equity + purchaseCosts.total + (isBrrr ? s.renovationCost : 0);

    // Sensitivity: after-tax monthly cashflow across a rate band.
    const baseRate = s.mortgageRatePct;
    const sensitivity = [-2, -1, 0, 1, 2, 3]
      .map((d) => Math.round((baseRate + d) * 10) / 10)
      .filter((r) => r >= 0)
      .map((r) => ({
        rate: `${r} %`,
        cashflow: Math.round(calcRentalCashflow({ ...s, mortgageRatePct: r }, loanAmount).afterTaxMonthlyCashflow),
      }));

    return { purchaseCosts, brrr, isBrrr, loanAmount, marketValue, cashflow, dti, ltv, stressPct, stressedMonthly, wealth, projectedSale, gains, interestDeductionValue, equity, cashNeeded, sensitivity };
  }, [scenario, totalDebt, grossAnnualIncome, assets.houseDebt]);

  const liquid = useMemo(() => sumSavings(assets) + assets.bufferAccount + computeEquityBreakdown(assets).netInvestment, [assets]);
  const liquidValue = ba.liquidOverride ?? Math.round(liquid);

  // The bank's real 5×-income check for the selected scenario. Existing debt is
  // split so `otherDebt` counts drawn balances and `creditFrames` counts revolving
  // lines at their full granted limit — no double-counting (see creditFrameBreakdown).
  const borrowCap = useMemo(() => {
    if (!scenario || !derived) return null;
    return calcRealBorrowingCapacity({
      baseAnnualSalary: baseSalary,
      bonusAnnual: bonus,
      includeBonus,
      grossAnnualRent: scenario.monthlyRent * 12,
      rentalBankFactor: rentFactorPct / 100,
      existingMortgage: assets.houseDebt,
      otherDebt: nonFrameDebt,
      creditFrames,
      newLoan: derived.loanAmount,
      cashRequired: derived.cashNeeded,
      liquidAssets: liquidValue,
    });
  }, [scenario, derived, baseSalary, bonus, includeBonus, rentFactorPct, creditFrames, assets.houseDebt, nonFrameDebt, liquidValue]);

  // ARV estimator (BRRR): load the kommune's SSB kr/m² when the scenario has a
  // valid 4-digit postcode, and estimate the after-repair value from size × price.
  const arvPostal = scenario?.strategy === 'brrr' ? (scenario.arvPostalCode ?? '') : '';
  useEffect(() => {
    const clean = arvPostal.replace(/\D/g, '');
    if (clean.length === 4) void loadKvmpris(clean, '');
  }, [arvPostal, loadKvmpris]);
  const arvEstimate = useMemo(() => {
    if (!scenario || scenario.strategy !== 'brrr') return null;
    if ((scenario.arvPostalCode ?? '').replace(/\D/g, '').length !== 4) return null;
    return estimatedPropertyValue(scenario.arvSizeSqm, kvmpris?.latestPrice ?? null);
  }, [scenario, kvmpris]);

  // Portfolio aggregate (owning home 2, 3, 4…) + the cross-scenario comparison.
  // Portfolio headroom is a lending check (cumulative debt vs 5× income), so it
  // counts the full credit frame via `capacityDebt`. The detailed real-borrowing
  // build-up above keeps `totalDebt` because it has its own manual `creditFrames` row.
  const portfolio = useMemo(
    () => calcPortfolio(secondHomeScenarios, grossAnnualIncome, capacityDebt),
    [secondHomeScenarios, grossAnnualIncome, capacityDebt],
  );
  const comparison = useMemo(
    () => secondHomeScenarios.map((s) => ({ s, sum: summarizeScenario(s) })),
    [secondHomeScenarios],
  );

  return (
    <div className="space-y-6 md:space-y-7">
      {/* Hero */}
      <header className="max-w-4xl">
        <div className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-3" style={{ color: 'var(--accent)' }}>
          {bp.shEyebrow}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {bp.shTitlePre}<em className="font-serif italic" style={{ color: 'var(--brass)' }}>{bp.shTitleEm}</em>
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {bp.shSubtitle}
        </p>
      </header>

      {/* Scenario selector */}
      <div className="flex flex-wrap items-center gap-2">
        {secondHomeScenarios.map((s) => {
          const active = s.id === scenario?.id;
          return (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className="px-4 h-9 rounded-[8px] text-[13px] font-medium border transition-colors"
              style={{
                background: active ? 'var(--text-1)' : 'var(--bg-card)',
                color: active ? 'var(--bg-page)' : 'var(--text-2)',
                borderColor: active ? 'var(--text-1)' : 'var(--border)',
              }}
            >
              {s.name}
            </button>
          );
        })}
        <button
          onClick={addScenario}
          className="flex items-center gap-1.5 px-4 h-9 rounded-[8px] text-[13px] font-medium border transition-colors"
          style={{ background: 'transparent', color: 'var(--accent)', borderColor: 'var(--border)' }}
        >
          <Plus size={14} /> {bp.addScenario}
        </button>
      </div>

      {/* Portfolio summary — the cumulative picture of the committed properties */}
      {portfolio.committedCount > 0 && (
        <div className={`${card} p-6`} style={{ borderColor: 'var(--brass-dim)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Layers size={14} style={{ color: 'var(--brass)' }} />
            <h2 className={sectionLabel}>{bp.portfolioTitle} · {portfolio.committedCount}</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <PortfolioStat label={bp.portfolioValue} value={formatCurrency(Math.round(portfolio.totalPropertyValue))} />
            <PortfolioStat label={bp.portfolioCumulativeDebt} value={formatCurrency(Math.round(portfolio.cumulativeDebt))} />
            <PortfolioStat
              label={bp.portfolioHeadroom}
              value={formatCurrency(Math.round(portfolio.borrowingHeadroom))}
              sub={`${portfolio.dtiRatio.toFixed(1)}× / 5×`}
              tone={portfolio.borrowingHeadroom <= 0 ? 'negative' : undefined}
            />
            <PortfolioStat
              label={bp.portfolioCashflow}
              value={`${formatCurrency(Math.round(portfolio.combinedMonthlyCashflow))} /${bp.month}`}
              tone={portfolio.combinedMonthlyCashflow >= 0 ? 'positive' : 'negative'}
            />
            <PortfolioStat label={bp.portfolioEquityIn} value={formatCurrency(Math.round(portfolio.totalEquityInvested))} />
          </div>
        </div>
      )}

      {!scenario || !derived ? (
        <div className={`${card} p-8 text-center`}>
          <p className="text-[15px]" style={{ color: 'var(--text-2)' }}>{bp.emptyBody}</p>
        </div>
      ) : (
        <>
          {/* Name + strategy + delete */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] block mb-2" style={{ color: 'var(--text-3)' }}>{bp.nameLabel}</label>
              <input
                value={scenario.name}
                onChange={(e) => set({ name: e.target.value })}
                className="w-full h-10 px-3 rounded-[8px] text-[14px] outline-none border"
                style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
              />
            </div>
            <div className="inline-flex p-1 rounded-[8px] border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }} role="radiogroup" aria-label={bp.strategyLabel}>
              {([
                { id: 'rent' as const, label: bp.strategyRent, icon: <Home size={14} /> },
                { id: 'brrr' as const, label: bp.strategyBrrr, icon: <Hammer size={14} /> },
              ]).map(({ id, label, icon }) => {
                const active = scenario.strategy === id;
                return (
                  <button
                    key={id}
                    onClick={() => set({ strategy: id as SecondHomeStrategy })}
                    role="radio"
                    aria-checked={active}
                    className="flex items-center gap-2 px-4 h-8 rounded-[6px] text-[12px] font-medium transition-colors"
                    style={{ background: active ? 'var(--text-1)' : 'transparent', color: active ? 'var(--bg-page)' : 'var(--text-2)', fontWeight: active ? 600 : 500 }}
                  >
                    {icon}{label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => set({ committed: !scenario.committed })}
              role="switch"
              aria-checked={!!scenario.committed}
              className="flex items-center gap-2 px-3 h-8 rounded-[8px] text-[12px] font-medium border transition-colors"
              style={{
                background: scenario.committed ? 'var(--bg-3)' : 'transparent',
                color: scenario.committed ? 'var(--brass)' : 'var(--text-2)',
                borderColor: scenario.committed ? 'var(--brass-dim)' : 'var(--border)',
              }}
              title={bp.committedHint}
            >
              <Layers size={13} /> {scenario.committed ? bp.committedOn : bp.committedOff}
            </button>
            <button
              onClick={() => { removeSecondHomeScenario(scenario.id); setSelectedId(secondHomeScenarios.find((s) => s.id !== scenario.id)?.id ?? null); }}
              className="flex items-center gap-1.5 px-3 h-8 rounded-[8px] text-[12px] font-medium border transition-colors"
              style={{ color: 'var(--negative)', borderColor: 'var(--border)' }}
              aria-label={bp.deleteScenario}
            >
              <Trash2 size={13} /> {bp.deleteScenario}
            </button>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              title={bp.kpiCashflow}
              value={formatCurrency(Math.round(derived.cashflow.afterTaxMonthlyCashflow))}
              accent
              sublabel={
                <DeltaChip tone={derived.cashflow.afterTaxMonthlyCashflow >= 0 ? 'positive' : 'negative'} size="sm">
                  {derived.cashflow.afterTaxMonthlyCashflow >= 0 ? bp.cashflowPositive : bp.cashflowNegative}
                </DeltaChip>
              }
            />
            <StatCard title={bp.kpiGrossYield} value={pct(derived.cashflow.grossYieldPct)} sublabel={bp.kpiGrossYieldSub} />
            <StatCard title={bp.kpiNetYield} value={pct(derived.cashflow.netYieldPct)} sublabel={bp.kpiNetYieldSub} />
            <StatCard title={bp.kpiLtv} value={pct(derived.ltv)} sublabel={`${bp.kpiCashNeeded}: ${formatCurrency(Math.round(derived.cashNeeded))}`} />
          </div>

          {/* Inputs */}
          <div className={`${card} p-6 space-y-5`}>
            <h2 className={sectionLabel}>{bp.secPurchase}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NumberRow label={bp.inPurchasePrice} value={scenario.purchasePrice} onCommit={(v) => set({ purchasePrice: v })} suffix="kr" />
              <NumberRow label={bp.inDokumentavgift} value={scenario.dokumentavgiftPct} onCommit={(v) => set({ dokumentavgiftPct: v })} suffix="%" />
              <NumberRow label={bp.inTinglysing} value={scenario.tinglysingsgebyr} onCommit={(v) => set({ tinglysingsgebyr: v })} suffix="kr" />
              <NumberRow label={bp.inOtherCosts} value={scenario.otherPurchaseCosts} onCommit={(v) => set({ otherPurchaseCosts: v })} suffix="kr" />
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
              {bp.purchaseCostsTotal}: <span className="font-mono" style={{ color: 'var(--text-2)' }}>{formatCurrency(Math.round(derived.purchaseCosts.total))}</span>
            </div>

            <h2 className={`${sectionLabel} pt-2`}>{bp.secFinancing}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NumberRow label={bp.inEquityShare} value={Math.round(scenario.equityShare * 100)} onCommit={(v) => set({ equityShare: clamp(v / 100, 0, 1) })} suffix="%" />
              <NumberRow label={bp.inMortgageRate} value={scenario.mortgageRatePct} onCommit={(v) => set({ mortgageRatePct: v })} suffix="%" />
              <NumberRow label={bp.inTerm} value={scenario.termYears} onCommit={(v) => set({ termYears: v })} suffix={bp.years} />
            </div>

            {derived.isBrrr && (
              <>
                <h2 className={`${sectionLabel} pt-2`}>{bp.secRenovation}</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <NumberRow label={bp.inRenovation} value={scenario.renovationCost} onCommit={(v) => set({ renovationCost: v })} suffix="kr" />
                  <NumberRow label={bp.inArv} value={scenario.afterRepairValue} onCommit={(v) => set({ afterRepairValue: v })} suffix="kr" />
                  <NumberRow label={bp.inRefinanceLtv} value={scenario.refinanceLtvPct} onCommit={(v) => set({ refinanceLtvPct: v })} suffix="%" />
                </div>

                {/* ARV estimator from SSB square-metre prices */}
                <div className="rounded-[8px] border p-4 space-y-3" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <LineChart size={13} style={{ color: 'var(--text-2)' }} />
                    <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>{bp.arvEstimatorTitle}</h3>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-3)' }}>{bp.arvPostal}</span>
                      <input
                        value={scenario.arvPostalCode ?? ''}
                        onChange={(e) => set({ arvPostalCode: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        inputMode="numeric"
                        placeholder="0000"
                        className="mt-1 w-full h-9 px-3 rounded-[8px] text-[13px] font-mono outline-none border"
                        style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
                      />
                    </label>
                    <NumberRow label={bp.arvSize} value={scenario.arvSizeSqm ?? 0} onCommit={(v) => set({ arvSizeSqm: v })} suffix="m²" />
                  </div>
                  {arvEstimate != null ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: 'var(--text-3)' }}>{bp.arvEstimated}</div>
                        <div className="text-[17px] font-mono font-medium mt-0.5" style={{ color: 'var(--text-1)' }}>{formatCurrency(arvEstimate)}</div>
                        {kvmpris?.latestPrice != null && (
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {formatCurrency(kvmpris.latestPrice)}{bp.arvPerSqmUnit}{kvmpris.poststed ? ` · ${kvmpris.poststed}` : ''}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => set({ afterRepairValue: arvEstimate })}
                        className="px-3 h-8 rounded-[8px] text-[12px] font-medium border transition-colors"
                        style={{ background: 'transparent', color: 'var(--accent)', borderColor: 'var(--border)' }}
                      >
                        {bp.arvApply}
                      </button>
                    </div>
                  ) : (
                    (scenario.arvPostalCode ?? '').replace(/\D/g, '').length === 4 && (scenario.arvSizeSqm ?? 0) > 0 ? (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{bp.arvNoData}</p>
                    ) : null
                  )}
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{bp.arvHint}</p>
                </div>
              </>
            )}

            <h2 className={`${sectionLabel} pt-2`}>{bp.secRental}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NumberRow label={bp.inMonthlyRent} value={scenario.monthlyRent} onCommit={(v) => set({ monthlyRent: v })} suffix="kr" />
              <NumberRow label={bp.inVacancy} value={scenario.vacancyPct} onCommit={(v) => set({ vacancyPct: v })} suffix="%" />
              <NumberRow label={bp.inOperatingCosts} value={scenario.monthlyOperatingCosts} onCommit={(v) => set({ monthlyOperatingCosts: v })} suffix="kr/mnd" />
              <NumberRow label={bp.inDeductibleCosts} value={scenario.deductibleCostsAnnual} onCommit={(v) => set({ deductibleCostsAnnual: v })} suffix="kr/år" />
            </div>

            <h2 className={`${sectionLabel} pt-2`}>{bp.secSale}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NumberRow label={bp.inHoldYears} value={scenario.holdYears} onCommit={(v) => set({ holdYears: v })} suffix={bp.years} />
              <NumberRow label={bp.inAppreciation} value={scenario.annualAppreciationPct} onCommit={(v) => set({ annualAppreciationPct: v })} suffix="%/år" />
              <NumberRow label={bp.inAgentFee} value={scenario.saleAgentFeePct} onCommit={(v) => set({ saleAgentFeePct: v })} suffix="%" />
              <NumberRow label={bp.inImprovements} value={scenario.documentedImprovements} onCommit={(v) => set({ documentedImprovements: v })} suffix="kr" />
              <NumberRow label={bp.inWealthTaxRate} value={scenario.marginalWealthTaxPct} onCommit={(v) => set({ marginalWealthTaxPct: v })} suffix="%" />
            </div>
          </div>

          {/* BRRR flow */}
          {derived.isBrrr && (
            <div className={`${card} p-6 space-y-4`}>
              <h2 className={sectionLabel}>{bp.secBrrr}</h2>
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <FlowBox label={bp.brrrBuy} value={formatCurrency(Math.round(derived.brrr.initialLoan))} sub={bp.brrrInitialLoan} />
                <ArrowRight size={16} style={{ color: 'var(--text-3)' }} />
                <FlowBox label={bp.brrrRenovate} value={formatCurrency(Math.round(derived.brrr.renovation))} sub={bp.brrrArv + ': ' + formatCurrency(Math.round(derived.brrr.arv))} />
                <ArrowRight size={16} style={{ color: 'var(--text-3)' }} />
                <FlowBox label={bp.brrrRefinance} value={formatCurrency(Math.round(derived.brrr.maxRefiLoan))} sub={pct(derived.brrr.postRefiLtvPct)} />
                <ArrowRight size={16} style={{ color: 'var(--text-3)' }} />
                <FlowBox label={bp.brrrCashOut} value={formatCurrency(Math.round(derived.brrr.cashOut))} sub={`${bp.brrrCapitalLeftIn}: ${formatCurrency(Math.round(derived.brrr.capitalLeftIn))}`} accent />
              </div>
            </div>
          )}

          {/* Cashflow + serviceability + tax, two columns */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className={`${card} p-6 space-y-3`}>
              <h2 className={sectionLabel}>{bp.secCashflow}</h2>
              <Row label={bp.rowEffectiveRent} value={formatCurrency(Math.round(derived.cashflow.effectiveRent))} />
              <Row label={bp.rowOperating} value={`− ${formatCurrency(Math.round(derived.cashflow.annualOperatingCosts))}`} />
              <Row label={bp.rowInterest} value={`− ${formatCurrency(Math.round(derived.cashflow.annualInterest))}`} />
              <Row label={bp.rowPrincipal} value={`− ${formatCurrency(Math.round(derived.cashflow.annualPrincipal))}`} />
              <Row label={bp.rowRentalTax} value={`− ${formatCurrency(Math.round(derived.cashflow.rentalIncomeTax))}`} />
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <Row label={bp.rowNetAfterTax} value={formatCurrency(Math.round(derived.cashflow.afterTaxAnnualCashflow))} strong />
                <Row label={bp.rowNetMonthly} value={formatCurrency(Math.round(derived.cashflow.afterTaxMonthlyCashflow))} />
              </div>
            </div>

            <div className="space-y-4">
              <div className={`${card} p-6 space-y-3`}>
                <h2 className={sectionLabel}>{bp.secServiceability}</h2>
                <Row label={`${bp.rowStressPayment} (${pct(derived.stressPct)})`} value={`${formatCurrency(Math.round(derived.stressedMonthly))} /${bp.month}`} />
                <Row
                  label={bp.rowDtiHeadroom}
                  value={derived.dti.borrowingHeadroom > 0 ? formatCurrency(Math.round(derived.dti.borrowingHeadroom)) : '—'}
                />
                <div className="text-[11px] pt-1" style={{ color: 'var(--text-3)' }}>
                  {bp.dtiNote} <span className="font-mono">{derived.dti.ratio.toFixed(1)}×</span> / 5×
                </div>
              </div>

              <div className={`${card} p-6 space-y-3`}>
                <h2 className={sectionLabel}>{bp.secTaxes}</h2>
                <Row label={bp.rowRentalTax} value={`${formatCurrency(Math.round(derived.cashflow.rentalIncomeTax))} /${bp.year}`} />
                <Row label={bp.rowInterestDeduction} value={`${formatCurrency(Math.round(derived.interestDeductionValue))} /${bp.year}`} />
                <Row label={bp.rowWealthTax} value={`${formatCurrency(Math.round(derived.wealth.marginalWealthTax))} /${bp.year}`} />
                <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <Row label={`${bp.rowSaleValue} (${scenario.holdYears} ${bp.years})`} value={formatCurrency(Math.round(derived.projectedSale))} />
                  <Row label={bp.rowGainTax} value={formatCurrency(Math.round(derived.gains.tax))} />
                </div>
              </div>
            </div>
          </div>

          {/* Real borrowing capacity — the full 5×-income check + liquidity */}
          {borrowCap && (
            <div className={`${card} p-6 space-y-5`}>
              <div>
                <h2 className={sectionLabel}>{bp.borrowCap.title}</h2>
                <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{bp.borrowCap.subtitle}</p>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                {/* Income build-up */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>{bp.borrowCap.incomeTitle}</h3>
                    <button
                      onClick={() => updateBoligAssumptions({ includeBonus: !includeBonus })}
                      role="switch"
                      aria-checked={includeBonus}
                      className="px-2.5 h-7 rounded-[6px] text-[11px] font-medium border transition-colors"
                      style={{
                        background: includeBonus ? 'var(--accent-bg)' : 'transparent',
                        color: includeBonus ? 'var(--accent)' : 'var(--text-3)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      {bp.borrowCap.includeBonus}
                    </button>
                  </div>
                  <NumberRow label={bp.borrowCap.baseSalary} value={baseSalary} onCommit={(v) => updateBoligAssumptions({ baseSalaryOverride: v })} suffix="kr" />
                  <NumberRow label={bp.borrowCap.bonus} value={bonus} onCommit={(v) => updateBoligAssumptions({ bonusAnnual: v })} suffix="kr" />
                  <NumberRow label={bp.borrowCap.rentFactor} value={rentFactorPct} onCommit={(v) => updateBoligAssumptions({ rentFactorPct: v })} suffix="%" />
                  <Row label={bp.borrowCap.acceptedRent} value={`+ ${formatCurrency(Math.round(borrowCap.acceptedRentalIncome))}`} />
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                    <Row label={bp.borrowCap.totalIncome} value={formatCurrency(Math.round(borrowCap.totalAcceptedIncome))} strong />
                  </div>
                </div>

                {/* Debt build-up */}
                <div className="space-y-3">
                  <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>{bp.borrowCap.debtTitle}</h3>
                  <Row label={bp.borrowCap.existingMortgage} value={formatCurrency(Math.round(assets.houseDebt))} />
                  <Row label={bp.borrowCap.otherDebt} value={formatCurrency(Math.round(nonFrameDebt))} />
                  <NumberRow label={bp.borrowCap.creditFrames} value={creditFrames} onCommit={(v) => updateBoligAssumptions({ creditFramesOverride: v })} suffix="kr" />
                  <div className="flex items-center justify-between gap-2 -mt-1">
                    <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {ba.creditFramesOverride == null ? bp.borrowCap.creditFramesAuto : ''}
                    </span>
                    {ba.creditFramesOverride != null && (
                      <button
                        onClick={() => updateBoligAssumptions({ creditFramesOverride: null })}
                        className="text-[11px] underline underline-offset-2 hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--accent)' }}
                      >
                        {bp.borrowCap.resetAuto}
                      </button>
                    )}
                  </div>
                  <Row label={bp.borrowCap.newLoan} value={`+ ${formatCurrency(Math.round(derived.loanAmount))}`} />
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                    <Row label={bp.borrowCap.debtAfter} value={formatCurrency(Math.round(borrowCap.totalDebtAfter))} strong />
                  </div>
                </div>
              </div>

              {/* Verdict */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="space-y-1 min-w-[220px] flex-1">
                  <Row label={bp.borrowCap.maxDebt} value={formatCurrency(Math.round(borrowCap.maxTotalDebt))} />
                  <Row
                    label={bp.borrowCap.remaining}
                    value={formatCurrency(Math.round(borrowCap.remainingCapacity))}
                  />
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <DeltaChip tone={borrowCap.loanFits ? 'positive' : 'negative'}>
                    {borrowCap.loanFits ? bp.borrowCap.fits : bp.borrowCap.over}
                  </DeltaChip>
                  <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    {bp.borrowCap.dtiAfter}: <span className="font-mono">{borrowCap.dtiAfterPurchase.toFixed(1)}×</span> / 5×
                  </div>
                </div>
              </div>

              {/* Liquidity check */}
              <div
                className="rounded-[8px] border p-4 space-y-3"
                style={{ background: 'var(--surface-2)', borderColor: borrowCap.hasEnoughCash ? 'var(--border)' : 'var(--negative)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>{bp.borrowCap.liquidityTitle}</h3>
                  <DeltaChip tone={borrowCap.hasEnoughCash ? 'positive' : 'negative'} size="sm">
                    {borrowCap.hasEnoughCash ? bp.borrowCap.enoughCash : bp.borrowCap.insufficient}
                  </DeltaChip>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>{bp.borrowCap.cashRequired}</span>
                  <span
                    className="text-[15px] font-mono font-medium tabular-nums"
                    style={{ color: borrowCap.hasEnoughCash ? 'var(--text-1)' : 'var(--negative)' }}
                  >
                    {formatCurrency(Math.round(derived.cashNeeded))}
                  </span>
                </div>
                <NumberRow label={bp.borrowCap.liquidAssets} value={liquidValue} onCommit={(v) => updateBoligAssumptions({ liquidOverride: v })} suffix="kr" />
                {!borrowCap.hasEnoughCash && (
                  <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--negative)' }}>
                    <AlertTriangle size={13} className="shrink-0" />
                    {bp.borrowCap.insufficient} · {formatCurrency(Math.round(borrowCap.liquidityGap))}
                  </div>
                )}
              </div>

              <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--text-3)' }}>
                {bp.borrowCap.rentCaveat} {bp.borrowCap.note}
              </p>
            </div>
          )}

          {/* Sensitivity chart */}
          <div className={`${card} p-6`}>
            <h2 className={`${sectionLabel} mb-4`}>{bp.secSensitivity}</h2>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={derived.sensitivity} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="rate" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS_Y} tickFormatter={(v) => formatCurrency(v)} width={72} />
                  <Tooltip content={<ChartTooltip hideLabel />} cursor={{ fill: 'var(--surface-3)' }} />
                  <Bar dataKey="cashflow" fill="var(--brass)" radius={[4, 4, 0, 0]} name={bp.rowNetMonthly} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>{bp.sensitivityNote}</p>
          </div>

          {/* Comparison table — rank candidates side by side */}
          {comparison.length >= 2 && (
            <div className={`${card} p-6`}>
              <h2 className={`${sectionLabel} mb-4`}>{bp.compareTitle}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tabular-nums">
                  <thead>
                    <tr style={{ color: 'var(--text-3)' }} className="text-left text-[11px] uppercase tracking-[0.08em]">
                      <th className="font-medium pb-2 pr-3">{bp.colScenario}</th>
                      <th className="font-medium pb-2 px-3 text-right">{bp.colYield}</th>
                      <th className="font-medium pb-2 px-3 text-right">{bp.colCashflow}</th>
                      <th className="font-medium pb-2 px-3 text-right">{bp.colCashNeeded}</th>
                      <th className="font-medium pb-2 pl-3 text-right">{bp.colLtv}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map(({ s, sum }) => (
                      <tr key={s.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            {s.committed && <Layers size={12} style={{ color: 'var(--brass)' }} />}
                            <span style={{ color: 'var(--text-1)' }}>{s.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono" style={{ color: 'var(--text-2)' }}>{pct(sum.grossYieldPct)}</td>
                        <td className="py-2 px-3 text-right font-mono" style={{ color: sum.afterTaxMonthlyCashflow >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                          {formatCurrency(Math.round(sum.afterTaxMonthlyCashflow))}
                        </td>
                        <td className="py-2 px-3 text-right font-mono" style={{ color: 'var(--text-2)' }}>{formatCurrency(Math.round(sum.cashNeeded))}</td>
                        <td className="py-2 pl-3 text-right font-mono" style={{ color: 'var(--text-2)' }}>{pct(sum.ltvPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="flex items-start gap-2 text-[11px] leading-[1.5] max-w-3xl" style={{ color: 'var(--text-3)' }}>
            <Info size={13} className="mt-0.5 shrink-0" />
            <p>{bp.taxDisclaimer} {liquid > 0 ? `${bp.liquidHint}: ${formatCurrency(Math.round(liquid))}.` : ''}</p>
          </div>
        </>
      )}
    </div>
  );
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="text-[13px] font-mono tabular-nums" style={{ color: 'var(--text-1)', fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function PortfolioStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' }) {
  const color = tone === 'positive' ? 'var(--positive)' : tone === 'negative' ? 'var(--negative)' : 'var(--text-1)';
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-[16px] font-mono font-medium mt-1 truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}

function FlowBox({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div
      className="px-4 py-3 rounded-[8px] border min-w-[130px]"
      style={{ background: accent ? 'var(--bg-3)' : 'var(--surface-2)', borderColor: accent ? 'var(--brass-dim)' : 'var(--border)' }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: accent ? 'var(--brass)' : 'var(--text-3)' }}>{label}</div>
      <div className="text-[15px] font-mono font-medium mt-1" style={{ color: 'var(--text-1)' }}>{value}</div>
      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>
    </div>
  );
}

export default SecondHomePanel;
