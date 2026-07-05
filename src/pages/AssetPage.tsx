import React, { useState, useMemo, lazy, Suspense } from 'react';
import {
  BarChart2,
  Percent,
  Home,
  PiggyBank,
  ArrowUpRight,
  Edit2,
  TrendingUp,
  Bitcoin,
  Shield,
  Briefcase,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useFinance, DEFAULT_TAX_RATES, type Assets, type Pension } from '../context/FinanceContext';
import { RestoreDefaultsButton } from '../components/ui/RestoreDefaultsButton';
import { ProvenanceBadge } from '../components/ui/ProvenanceBadge';
import { provenanceOf } from '../lib/provenance';
import EditModal, { type ModalField } from '../components/EditModal';
import DebtSection from '../components/DebtSection';
import ChartTooltip from '../components/ChartTooltip';
import BalanceHistoryBar from '../components/BalanceHistoryBar';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import { computeEquityBreakdown } from '../lib/equity';
import { calcNetWorthProjectionByBucket, calcHouseEquityByYear, calcMortgageBalanceByYear } from '../lib/calculations';
import { parseLocaleNumber } from '../lib/validators';

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
}

const card = 'bg-[var(--bg-card)] rounded-[8px] border border-[var(--border)]';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-2)]';

const NetWorthCompositionChart = lazy(() => import('../components/charts/NetWorthCompositionChart'));
const AllocationDonut = lazy(() => import('../components/charts/AllocationDonut'));
const LiquidLockedBar = lazy(() => import('../components/charts/LiquidLockedBar'));
const DebtPayoffChart = lazy(() => import('../components/charts/DebtPayoffChart'));

const AssetPage: React.FC = () => {
  const {
    t,
    lang,
    assets: liveAssets,
    updateAsset,
    formatCurrency,
    totalDebt,
    growthReturnRate,
    setGrowthReturnRate,
    houseGrowthRate,
    setHouseGrowthRate,
    cashGrowthRate,
    setCashGrowthRate,
    cryptoGrowthRate,
    setCryptoGrowthRate,
    recommendedInvestment,
    pension: livePension,
    updatePension,
    mortgageRate,
    mortgageTermYears,
    restoreAssetTaxDefaults,
    restoreGrowthRateDefaults,
  } = useFinance();

  // Time machine: when viewing a past month, render that month's snapshot (read-only).
  const hist = useBalanceHistory();
  const assets = hist.snapshot?.assets ?? liveAssets;
  const pension = hist.snapshot?.pension ?? livePension;
  const { taxOnGain, netInvestment, houseEquity, cryptoTaxOnGain, netCrypto, totalEquity } = useMemo(
    () => computeEquityBreakdown(assets),
    [assets],
  );
  // True net worth also nets out non-mortgage debts (studielån, forbrukslån, …).
  const netWorth = totalEquity - totalDebt;

    const [modal, setModal] = useState<ModalConfig | null>(null);
    const openModal = (config: ModalConfig) => setModal(config);
    const closeModal = () => setModal(null);

    const openAssetEdit = (label: string, currentVal: number, key: keyof Assets) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: currentVal.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) updateAsset(key, n);
        closeModal();
      },
    });
    };

    const openPensionEdit = (label: string, currentVal: number, key: keyof Pension) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: currentVal.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.value);
        if (!isNaN(n) && n >= 0) updatePension(key, n);
        closeModal();
      },
    });
    };

    const annualSavings = Math.max(0, recommendedInvestment * 12);
  const cashStart = assets.savings + assets.bsu + assets.bufferAccount;
  const houseByYear = useMemo(
    () => calcHouseEquityByYear(assets.houseValue, assets.houseDebt, houseGrowthRate, mortgageRate, mortgageTermYears, 15),
    [assets.houseValue, assets.houseDebt, houseGrowthRate, mortgageRate, mortgageTermYears]
  );
  const projectionData = useMemo(
    () => calcNetWorthProjectionByBucket(
      { stocks: netInvestment, crypto: netCrypto, cash: cashStart, house: houseEquity },
      annualSavings,
      { stocks: growthReturnRate, crypto: cryptoGrowthRate, cash: cashGrowthRate, house: houseGrowthRate },
      15,
      houseByYear,
    ),
    [netInvestment, netCrypto, cashStart, houseEquity, annualSavings, growthReturnRate, cryptoGrowthRate, cashGrowthRate, houseGrowthRate, houseByYear]
  );

  const formatAxisValue = (val: number) => {
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
    return val.toString();
  };

  const editRate = (label: string, current: number, onCommit: (v: number) => void) => {
    openModal({
      title: label,
      fields: [{ key: 'rate', label: t.annualReturn, type: 'number', value: current.toString() }],
      onSave: (vals) => {
        const n = parseLocaleNumber(vals.rate);
        if (!isNaN(n) && n >= 0 && n <= 100) onCommit(n);
        closeModal();
      },
    });
  };

  const cashTotal = assets.bsu + assets.savings + assets.bufferAccount;
  const pensionTotal = pension.otpBalance + pension.ipsBalance;
  // Allocation / liquidity views. Liquid = what you can actually reach today;
  // locked = property equity + pension (tied up / retirement-locked).
  const liquidWealth = netInvestment + netCrypto + cashTotal;
  const lockedWealth = houseEquity + pensionTotal;
  const projectionStartYear = new Date().getFullYear();
  const mortgageBalances = useMemo(
    () => calcMortgageBalanceByYear(assets.houseDebt, mortgageRate, mortgageTermYears, 15),
    [assets.houseDebt, mortgageRate, mortgageTermYears],
  );
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
          {lang === 'nb' ? 'Formue' : 'Net worth'}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {lang === 'nb' ? (
            <>Hva er du verdt — <em className="font-serif italic" style={{ color: 'var(--brass)' }}>egentlig</em>.</>
          ) : (
            <>What you're worth — <em className="font-serif italic" style={{ color: 'var(--brass)' }}>truly</em>.</>
          )}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.55] max-w-2xl" style={{ color: 'var(--text-2)' }}>
          {lang === 'nb'
            ? `Netto egenkapital ${formatCurrency(netWorth)}. Investering ${formatCurrency(netInvestment)}, boligegenkapital ${formatCurrency(houseEquity)}, kontanter ${formatCurrency(cashTotal)}.`
            : `Net equity ${formatCurrency(netWorth)}. Investment ${formatCurrency(netInvestment)}, property equity ${formatCurrency(houseEquity)}, cash ${formatCurrency(cashTotal)}.`}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Left column */}
        <div className="space-y-4 md:space-y-6">
          {/* Market Positions */}
          <div data-tour="market-positions" className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <BarChart2 size={14} strokeWidth={2} className="text-[var(--text-2)]" />
                <h3 className={sectionLabel}>{t.marketPositions}</h3>
              </div>
              <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restoreAssetTaxDefaults} />
            </div>
            <div className="space-y-0">
              <AssetRow
                label={t.portfolio}
                value={assets.portfolio}
                onEdit={() => openAssetEdit(t.portfolio, assets.portfolio, 'portfolio')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.unrealizedGain}
                value={assets.unrealizedGain}
                onEdit={() => openAssetEdit(t.unrealizedGain, assets.unrealizedGain, 'unrealizedGain')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.taxRate}
                value={assets.taxRate}
                suffix="%"
                onEdit={() => openAssetEdit(t.taxRate, assets.taxRate, 'taxRate')}
                formatCurrency={(v) => v.toFixed(2)}
                icon={<Percent size={12} className="text-[var(--text-2)]" />}
                badge={<ProvenanceBadge kind={provenanceOf(assets.taxRate, DEFAULT_TAX_RATES.stockTaxRate)} />}
              />
              <div className="flex justify-between py-3.5 text-[12px] text-[#B5533A] font-medium border-t border-[var(--border)] mt-1">
                <span>{t.liabilityReserve}</span>
                <span className="font-mono">−{formatCurrency(taxOnGain)}</span>
              </div>
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[var(--text-1)]">
                <span>{t.netLiquidity}</span>
                <span className="font-mono text-[#7FCBA0]">{formatCurrency(netInvestment)}</span>
              </div>
            </div>
          </div>

          {/* Real Estate */}
          <div data-tour="real-estate" className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
              <Home size={14} strokeWidth={2} className="text-[var(--text-2)]" />
              <h3 className={sectionLabel}>{t.realEstate}</h3>
            </div>
            <div className="space-y-0">
              <AssetRow
                label={t.houseValue}
                value={assets.houseValue}
                onEdit={() => openAssetEdit(t.houseValue, assets.houseValue, 'houseValue')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.houseDebt}
                value={assets.houseDebt}
                onEdit={() => openAssetEdit(t.houseDebt, assets.houseDebt, 'houseDebt')}
                formatCurrency={formatCurrency}
                isNegative
              />
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[var(--text-1)] border-t border-[var(--border)] mt-1">
                <span>{t.propertyEquity}</span>
                <span className="font-mono text-[#7FCBA0]">{formatCurrency(houseEquity)}</span>
              </div>
            </div>
          </div>

          {/* Pension wealth (locked — not in totalEquity) */}
          <div data-tour="pension" className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
              <Briefcase size={14} strokeWidth={2} className="text-[var(--text-2)]" />
              <h3 className={sectionLabel}>{t.pensionWealth}</h3>
            </div>
            <div className="space-y-0">
              <AssetRow
                label={t.otpBalance}
                value={pension.otpBalance}
                onEdit={() => openPensionEdit(t.otpBalance, pension.otpBalance, 'otpBalance')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.ipsBalance}
                value={pension.ipsBalance}
                onEdit={() => openPensionEdit(t.ipsBalance, pension.ipsBalance, 'ipsBalance')}
                formatCurrency={formatCurrency}
              />
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[var(--text-1)] border-t border-[var(--border)] mt-1">
                <span>{t.pensionWealth}</span>
                <span className="font-mono text-[#7FCBA0]">{formatCurrency(pension.otpBalance + pension.ipsBalance)}</span>
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
                {lang === 'nb'
                  ? 'Låst til pensjonsalder. Holdes utenfor faktisk egenkapital.'
                  : 'Locked until retirement age. Excluded from liquid net equity.'}
              </p>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4 md:space-y-6">
          {/* Cash Reserves */}
          <div data-tour="cash-reserves" className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
              <PiggyBank size={14} strokeWidth={2} className="text-[var(--text-2)]" />
              <h3 className={sectionLabel}>{t.cashReserves}</h3>
            </div>
            <div className="space-y-0">
              <AssetRow
                label={t.bsu}
                value={assets.bsu}
                onEdit={() => openAssetEdit(t.bsu, assets.bsu, 'bsu')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.savings}
                value={assets.savings}
                onEdit={() => openAssetEdit(t.savings, assets.savings, 'savings')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.bufferAccount}
                value={assets.bufferAccount}
                onEdit={() => openAssetEdit(t.bufferAccount, assets.bufferAccount, 'bufferAccount')}
                formatCurrency={formatCurrency}
                icon={<Shield size={12} className="text-[var(--text-2)]" />}
              />
            </div>
          </div>

          {/* Crypto */}
          <div data-tour="crypto" className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[var(--border)]">
              <Bitcoin size={14} strokeWidth={2} className="text-[var(--text-2)]" />
              <h3 className={sectionLabel}>{t.crypto}</h3>
            </div>
            <div className="space-y-0">
              <AssetRow
                label={t.cryptoPortfolio}
                value={assets.crypto}
                onEdit={() => openAssetEdit(t.cryptoPortfolio, assets.crypto, 'crypto')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.cryptoGain}
                value={assets.cryptoUnrealizedGain}
                onEdit={() => openAssetEdit(t.cryptoGain, assets.cryptoUnrealizedGain, 'cryptoUnrealizedGain')}
                formatCurrency={formatCurrency}
              />
              <AssetRow
                label={t.cryptoTaxRate}
                value={assets.cryptoTaxRate}
                suffix="%"
                onEdit={() => openAssetEdit(t.cryptoTaxRate, assets.cryptoTaxRate, 'cryptoTaxRate')}
                formatCurrency={(v) => v.toFixed(2)}
                icon={<Percent size={12} className="text-[var(--text-2)]" />}
              />
              <div className="flex justify-between py-3.5 text-[12px] text-[#B5533A] font-medium border-t border-[var(--border)] mt-1">
                <span>{t.cryptoTaxLabel}</span>
                <span className="font-mono">−{formatCurrency(cryptoTaxOnGain)}</span>
              </div>
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[var(--text-1)]">
                <span>{t.netCrypto}</span>
                <span className="font-mono text-[#7FCBA0]">{formatCurrency(netCrypto)}</span>
              </div>
            </div>
          </div>

          {/* Total Equity Hero — flat panel set apart by a brass hairline */}
          <div
            className="relative p-6 md:p-8 rounded-[8px] border overflow-hidden"
            style={{
              background: 'var(--bg-3)',
              borderColor: 'var(--brass-dim)',
            }}
          >
            <div className="relative z-10 space-y-6 md:space-y-8">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-2)' }}>
                  {t.trueNetEquity}
                </div>
                <div
                  className="font-mono font-medium tracking-[-0.03em] leading-none tabular-nums"
                  style={{
                    fontSize: 'clamp(36px, 5vw, 56px)',
                    color: 'var(--text-1)',
                  }}
                >
                  {formatCurrency(netWorth)}
                </div>
              </div>
              <div className="space-y-3 text-[13px] border-t pt-5 md:pt-6" style={{ borderColor: 'var(--rule)' }}>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-2)' }}>{t.grossAssets}</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {formatCurrency(assets.portfolio + assets.crypto + assets.houseValue + assets.bsu + assets.savings + assets.bufferAccount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-2)' }}>{t.liabilities}</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--negative)' }}>
                    −{formatCurrency(assets.houseDebt + taxOnGain + cryptoTaxOnGain + totalDebt)}
                  </span>
                </div>
              </div>
            </div>
            <ArrowUpRight size={100} className="absolute -top-4 -right-4" style={{ color: 'var(--brass-dim)', opacity: 0.5 }} />
          </div>
        </div>
      </div>

      {/* Allocation snapshot + liquidity split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-stretch">
        <div className={`${card} p-5 md:p-7 flex flex-col`}>
          <div className="pb-4 border-b border-[var(--border)]">
            <h3 className={sectionLabel}>{t.charts.allocationTitle}</h3>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.allocationSub}</p>
          </div>
          <div className="flex-1 min-h-[260px] w-full mt-4">
            <Suspense fallback={<div className="h-full w-full" />}>
              <AllocationDonut stocks={netInvestment} house={houseEquity} cash={cashTotal} crypto={netCrypto} pension={pensionTotal} />
            </Suspense>
          </div>
        </div>
        <div className={`${card} p-5 md:p-7 flex flex-col`}>
          <div className="pb-4 border-b border-[var(--border)]">
            <h3 className={sectionLabel}>{t.charts.liquidLockedTitle}</h3>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.liquidLockedSub}</p>
          </div>
          <div className="flex-1 flex flex-col justify-center mt-6">
            <Suspense fallback={<div className="h-full w-full" />}>
              <LiquidLockedBar liquid={liquidWealth} locked={lockedWealth} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Debt (non-mortgage) */}
      <DebtSection />

      {/* Mortgage payoff over time */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="pb-4 border-b border-[var(--border)]">
          <h3 className={sectionLabel}>{t.charts.debtPayoffTitle}</h3>
          <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.debtPayoffSub}</p>
        </div>
        <div className="h-[300px] md:h-[340px] w-full">
          <Suspense fallback={<div className="h-full w-full" />}>
            <DebtPayoffChart balances={mortgageBalances} startYear={projectionStartYear} nonMortgageDebt={totalDebt} />
          </Suspense>
        </div>
      </div>

      {/* Net-worth composition over time */}
      <div className={`${card} p-5 md:p-7 space-y-4`}>
        <div className="pb-4 border-b border-[var(--border)]">
          <h3 className={sectionLabel}>{t.charts.compositionTitle}</h3>
          <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>{t.charts.compositionSub}</p>
        </div>
        <div className="h-[260px] md:h-[300px] w-full">
          <Suspense fallback={<div className="h-full w-full" />}><NetWorthCompositionChart /></Suspense>
        </div>
      </div>

      {/* Growth Projection */}
      <div data-tour="growth-projection" className={`${card} p-5 md:p-7 space-y-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} strokeWidth={2} className="text-[var(--text-2)]" />
            <h3 className={sectionLabel}>{t.growthProjection}</h3>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono flex-wrap" style={{ color: 'var(--text-2)' }}>
            <RateChip label={t.bucketStocks} value={growthReturnRate} onClick={() => editRate(t.settings.growthReturnRate, growthReturnRate, setGrowthReturnRate)} />
            <RateChip label={t.bucketHouse} value={houseGrowthRate} onClick={() => editRate(t.settings.houseGrowthRate, houseGrowthRate, setHouseGrowthRate)} />
            <RateChip label={t.bucketCash} value={cashGrowthRate} onClick={() => editRate(t.settings.cashGrowthRate, cashGrowthRate, setCashGrowthRate)} />
            <RateChip label={t.bucketCrypto} value={cryptoGrowthRate} onClick={() => editRate(t.settings.cryptoGrowthRate, cryptoGrowthRate, setCryptoGrowthRate)} />
            <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restoreGrowthRateDefaults} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[13px]">
          <div>
            <div className={sectionLabel + ' mb-1'}>{lang === 'nb' ? 'Nå' : 'Now'}</div>
            <div className="font-mono font-semibold text-[var(--text-1)]">{formatCurrency(projectionData[0]?.total ?? totalEquity)}</div>
          </div>
          <div>
            <div className={sectionLabel + ' mb-1'}>{lang === 'nb' ? 'Om 5 år' : 'In 5 years'}</div>
            <div className="font-mono font-semibold text-[#7FCBA0]">
              {formatCurrency(projectionData[5]?.total ?? 0)}
            </div>
          </div>
          <div>
            <div className={sectionLabel + ' mb-1'}>{lang === 'nb' ? 'Om 15 år' : 'In 15 years'}</div>
            <div className="font-mono font-semibold text-[var(--positive)]">
              {formatCurrency(projectionData[15]?.total ?? 0)}
            </div>
          </div>
        </div>

        <div className="h-[260px] md:h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projectionData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              {/* Stacked area fills — flat (no fade), one role hue per bucket:
                  stocks=forest, house=teal, cash=slate, crypto=rust. */}
              <defs>
                <linearGradient id="stocksGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F5A42" stopOpacity={0.92} />
                  <stop offset="100%" stopColor="#1F5A42" stopOpacity={0.92} />
                </linearGradient>
                <linearGradient id="cryptoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#B5533A" stopOpacity={0.85} />
                  <stop offset="100%" stopColor="#B5533A" stopOpacity={0.85} />
                </linearGradient>
                <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5B7280" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#5B7280" stopOpacity={0.8} />
                </linearGradient>
                <linearGradient id="houseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3F7373" stopOpacity={0.85} />
                  <stop offset="100%" stopColor="#3F7373" stopOpacity={0.85} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={'#262A20'} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisValue} tick={{ fontSize: 11, fill: '#5F6555' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="house" stackId="1" name={t.bucketHouse} stroke="#3F7373" fill="url(#houseGrad)" />
              <Area type="monotone" dataKey="cash" stackId="1" name={t.bucketCash} stroke="#5B7280" fill="url(#cashGrad)" />
              <Area type="monotone" dataKey="crypto" stackId="1" name={t.bucketCrypto} stroke="#B5533A" fill="url(#cryptoGrad)" />
              <Area type="monotone" dataKey="stocks" stackId="1" name={t.bucketStocks} stroke="#7FCBA0" fill="url(#stocksGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#1F5A42' }} />{t.bucketStocks}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#B5533A' }} />{t.bucketCrypto}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#5B7280' }} />{t.bucketCash}</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#3F7373' }} />{t.bucketHouse}</div>
        </div>

        <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
          {lang === 'nb'
            ? `Hver aktivaklasse vokser med egen rate. Sparing (${formatCurrency(annualSavings)}/år fra budsjettet) går til aksjer. Endre ratene i Innstillinger.`
            : `Each asset class grows at its own rate. Savings (${formatCurrency(annualSavings)}/yr from your budget) flow into stocks. Adjust the rates in Settings.`}
        </p>
      </div>

      {modal && <EditModal {...modal} onCancel={closeModal} />}
    </div>
    </>
  );
};

interface AssetRowProps {
  label: string;
  value: number;
  suffix?: string;
  onEdit?: () => void;
  formatCurrency: (v: number) => string;
  isNegative?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

function AssetRow({ label, value, suffix, onEdit, formatCurrency, isNegative, icon, badge }: AssetRowProps) {
  return (
    <div
      className={`flex justify-between items-center group py-3.5 border-b border-[var(--border)] last:border-0 ${onEdit ? 'cursor-pointer' : ''}`}
      onClick={onEdit}
    >
      <span className={`text-[13px] font-medium flex items-center gap-1.5 transition-colors ${onEdit ? 'text-[var(--text-1)] group-hover:text-[#7FCBA0]' : 'text-[var(--text-2)]'}`}>
        {icon}
        {label}
        {badge}
      </span>
      <div className="flex items-center gap-2">
        <span className={`text-[13px] font-mono font-medium transition-colors ${isNegative ? 'text-[#B5533A]' : onEdit ? 'text-[var(--text-1)] group-hover:opacity-70' : 'text-[var(--text-2)]'}`}>
          {isNegative ? '−' : ''}{formatCurrency(value)}{suffix}
        </span>
        {onEdit ? (
          <Edit2 size={13} className="text-[var(--text-2)] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
      </div>
    </div>
  );
}

function RateChip({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-[4px] border transition-colors"
      style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent) 35%, transparent)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}%</span>
      <Edit2 size={9} strokeWidth={2.5} />
    </button>
  );
}

export default AssetPage;
