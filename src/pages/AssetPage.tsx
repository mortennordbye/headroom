import React, { useState, useMemo } from 'react';
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
import { useFinance, type Assets } from '../context/FinanceContext';
import EditModal, { type ModalField } from '../components/EditModal';
import { calcNetWorthProjection } from '../lib/calculations';

interface ModalConfig {
  title: string;
  fields: ModalField[];
  onSave: (values: Record<string, string>) => void;
}

const card = 'bg-white dark:bg-[#1a1a1a] rounded-2xl border border-[#e5e5e5] dark:border-[#2a2a2a] shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none';
const sectionLabel = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[#737373]';

const AssetPage: React.FC = () => {
  const {
    t,
    lang,
    assets,
    updateAsset,
    totalEquity,
    taxOnGain,
    netInvestment,
    houseEquity,
    cryptoTaxOnGain,
    netCrypto,
    formatCurrency,
    isDarkMode,
    growthReturnRate,
    setGrowthReturnRate,
    totalResidual,
  } = useFinance();

    const [modal, setModal] = useState<ModalConfig | null>(null);
    const openModal = (config: ModalConfig) => setModal(config);
    const closeModal = () => setModal(null);

    const openAssetEdit = (label: string, currentVal: number, key: keyof Assets) => {
    openModal({
      title: label,
      fields: [{ key: 'value', label, type: 'number', value: currentVal.toString() }],
      onSave: (vals) => {
        const n = parseFloat(vals.value);
        if (!isNaN(n) && n >= 0) updateAsset(key, n);
        closeModal();
      },
    });
    };

    const annualSavings = Math.max(0, totalResidual * 12);
  const projectionData = useMemo(
    () => calcNetWorthProjection(totalEquity, annualSavings, growthReturnRate, 15),
    [totalEquity, annualSavings, growthReturnRate]
  );

  const formatAxisValue = (val: number) => {
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
    return val.toString();
  };

  const editReturnRate = () => {
    openModal({
      title: t.annualReturn,
      fields: [{ key: 'rate', label: t.annualReturn, type: 'number', value: growthReturnRate.toString() }],
      onSave: (vals) => {
        const n = parseFloat(vals.rate);
        if (!isNaN(n) && n >= 0 && n <= 100) setGrowthReturnRate(n);
        closeModal();
      },
    });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Left column */}
        <div className="space-y-4 md:space-y-6">
          {/* Market Positions */}
          <div className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
              <BarChart2 size={14} strokeWidth={2} className="text-[#737373]" />
              <h3 className={sectionLabel}>{t.marketPositions}</h3>
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
                icon={<Percent size={12} className="text-[#737373]" />}
              />
              <div className="flex justify-between py-3.5 text-[12px] text-[#ef4444] font-medium border-t border-[#f0f0f0] dark:border-[#222222] mt-1">
                <span>{t.liabilityReserve}</span>
                <span className="font-mono">−{formatCurrency(taxOnGain)}</span>
              </div>
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[#0a0a0a] dark:text-[#fafafa]">
                <span>{t.netLiquidity}</span>
                <span className="font-mono text-[#0ea5e9] dark:text-[#38bdf8]">{formatCurrency(netInvestment)}</span>
              </div>
            </div>
          </div>

          {/* Real Estate */}
          <div className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
              <Home size={14} strokeWidth={2} className="text-[#737373]" />
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
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[#0a0a0a] dark:text-[#fafafa] border-t border-[#f0f0f0] dark:border-[#222222] mt-1">
                <span>{t.propertyEquity}</span>
                <span className="font-mono text-[#0ea5e9] dark:text-[#38bdf8]">{formatCurrency(houseEquity)}</span>
              </div>
            </div>
          </div>

          {/* Crypto */}
          <div className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
              <Bitcoin size={14} strokeWidth={2} className="text-[#737373]" />
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
                icon={<Percent size={12} className="text-[#737373]" />}
              />
              <div className="flex justify-between py-3.5 text-[12px] text-[#ef4444] font-medium border-t border-[#f0f0f0] dark:border-[#222222] mt-1">
                <span>{t.cryptoTaxLabel}</span>
                <span className="font-mono">−{formatCurrency(cryptoTaxOnGain)}</span>
              </div>
              <div className="flex justify-between py-3 text-[14px] font-semibold text-[#0a0a0a] dark:text-[#fafafa]">
                <span>{t.netCrypto}</span>
                <span className="font-mono text-[#0ea5e9] dark:text-[#38bdf8]">{formatCurrency(netCrypto)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4 md:space-y-6">
          {/* Cash Reserves */}
          <div className={`${card} p-5 md:p-7 space-y-5`}>
            <div className="flex items-center gap-2 pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
              <PiggyBank size={14} strokeWidth={2} className="text-[#737373]" />
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
                icon={<Shield size={12} className="text-[#737373]" />}
              />
            </div>
          </div>

          {/* Total Equity Hero */}
          <div className="relative p-6 md:p-8 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 dark:from-sky-400 dark:to-blue-500 text-white overflow-hidden shadow-lg shadow-sky-500/20">
            <div className="relative z-10 space-y-6 md:space-y-8">
              <div className="space-y-1">
                <div className="text-sky-100/70 text-[11px] font-medium uppercase tracking-[0.1em]">{t.trueNetEquity}</div>
                <div className="text-3xl md:text-5xl font-bold tracking-tight font-mono">{formatCurrency(totalEquity)}</div>
              </div>
              <div className="space-y-3 text-[13px] border-t border-white/20 pt-5 md:pt-6">
                <div className="flex justify-between text-sky-100/80">
                  <span>{t.grossAssets}</span>
                  <span className="font-mono font-semibold text-white">{formatCurrency(assets.portfolio + assets.crypto + assets.houseValue + assets.bsu + assets.savings + assets.bufferAccount)}</span>
                </div>
                <div className="flex justify-between text-sky-100/80">
                  <span>{t.liabilities}</span>
                  <span className="font-mono font-semibold text-white">−{formatCurrency(assets.houseDebt + taxOnGain + cryptoTaxOnGain)}</span>
                </div>
              </div>
            </div>
            <ArrowUpRight size={100} className="absolute -top-4 -right-4 text-white/10" />
          </div>
        </div>
      </div>

      {/* Growth Projection */}
      <div className={`${card} p-5 md:p-7 space-y-5`}>
        <div className="flex items-center justify-between pb-4 border-b border-[#f0f0f0] dark:border-[#222222]">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} strokeWidth={2} className="text-[#737373]" />
            <h3 className={sectionLabel}>{t.growthProjection}</h3>
          </div>
          <button
            onClick={editReturnRate}
            className="flex items-center gap-1 text-[11px] font-medium text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors"
          >
            <span className="font-mono">{growthReturnRate}% p.a.</span>
            <Edit2 size={11} />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[13px]">
          <div>
            <div className={sectionLabel + ' mb-1'}>{lang === 'nb' ? 'Nå' : 'Now'}</div>
            <div className="font-mono font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(totalEquity)}</div>
          </div>
          <div>
            <div className={sectionLabel + ' mb-1'}>{lang === 'nb' ? 'Om 5 år' : 'In 5 years'}</div>
            <div className="font-mono font-semibold text-[#0ea5e9] dark:text-[#38bdf8]">
              {formatCurrency(projectionData[5]?.netWorth ?? 0)}
            </div>
          </div>
          <div>
            <div className={sectionLabel + ' mb-1'}>{lang === 'nb' ? 'Om 15 år' : 'In 15 years'}</div>
            <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(projectionData[15]?.netWorth ?? 0)}
            </div>
          </div>
        </div>

        <div className="h-[220px] md:h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projectionData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#222222' : '#f0f0f0'} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: '#737373' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatAxisValue}
                tick={{ fontSize: 11, fill: '#737373' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value ?? 0)), t.projectedNetWorth]}
                labelFormatter={(label) => `${label}`}
                contentStyle={{
                  borderRadius: '10px',
                  border: `1px solid ${isDarkMode ? '#2a2a2a' : '#e5e5e5'}`,
                  backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff',
                  color: isDarkMode ? '#fafafa' : '#0a0a0a',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                  padding: '10px 14px',
                  fontSize: '13px',
                }}
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke="#0ea5e9"
                strokeWidth={2}
                fill="url(#netWorthGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#0ea5e9' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <p className="text-[11px] text-[#737373]">
          {lang === 'nb'
            ? `Beregnet med ${growthReturnRate}% årlig avkastning og ${formatCurrency(annualSavings)} i årlig sparing fra disponibelt budsjett.`
            : `Projected at ${growthReturnRate}% annual return with ${formatCurrency(annualSavings)} annual savings from discretionary budget.`}
        </p>
      </div>

      {modal && <EditModal {...modal} onCancel={closeModal} />}
    </div>
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
}

function AssetRow({ label, value, suffix, onEdit, formatCurrency, isNegative, icon }: AssetRowProps) {
  return (
    <div
      className={`flex justify-between items-center group py-3.5 border-b border-[#f0f0f0] dark:border-[#222222] last:border-0 ${onEdit ? 'cursor-pointer' : ''}`}
      onClick={onEdit}
    >
      <span className={`text-[13px] font-medium flex items-center gap-1.5 transition-colors ${onEdit ? 'text-[#0a0a0a] dark:text-[#fafafa] group-hover:text-[#0ea5e9] dark:group-hover:text-[#38bdf8]' : 'text-[#737373]'}`}>
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className={`text-[13px] font-mono font-medium transition-colors ${isNegative ? 'text-[#ef4444]' : onEdit ? 'text-[#0a0a0a] dark:text-[#fafafa] group-hover:opacity-70' : 'text-[#737373]'}`}>
          {isNegative ? '−' : ''}{formatCurrency(value)}{suffix}
        </span>
        {onEdit ? (
          <Edit2 size={13} className="text-[#737373] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
      </div>
    </div>
  );
}

export default AssetPage;
