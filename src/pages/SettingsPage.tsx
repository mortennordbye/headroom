import { useRef, useState, useEffect, type ReactNode } from 'react';
import { format } from 'date-fns';
import {
  Languages,
  Coins,
  Sliders,
  Database,
  Info,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Trash2,
  Globe,
  LayoutGrid,
  Eye,
  EyeOff,
  MonitorPlay,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import {
  useFinance,
  type ExportPayload,
  DEFAULT_GROWTH_RATES,
  DEFAULT_TAX_RATES,
} from '../context/FinanceContext';
import { NAV_ITEMS, ALWAYS_VISIBLE_NAV } from '../components/navItems';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Button } from '../components/ui/Button';
import { RestoreDefaultsButton } from '../components/ui/RestoreDefaultsButton';
import { DeltaChip } from '../components/ui/DeltaChip';
import { ProvenanceBadge } from '../components/ui/ProvenanceBadge';
import { provenanceOf } from '../lib/provenance';
import { BankSyncCard } from '../components/BankSyncCard';

type ImportState = 'idle' | 'ready' | 'error' | 'done';

const APP_VERSION = '3.0.0';

export default function SettingsPage() {
  const {
    t,
    lang,
    setLang,
    displayCurrency,
    setDisplayCurrency,
    nokToUsd,
    setNokToUsd,
    customCurrencyCode,
    setCustomCurrencyCode,
    customCurrencyRate,
    setCustomCurrencyRate,
    savingsTargetPercent,
    setSavingsTargetPercent,
    growthReturnRate,
    setGrowthReturnRate,
    houseGrowthRate,
    setHouseGrowthRate,
    cashGrowthRate,
    setCashGrowthRate,
    cryptoGrowthRate,
    setCryptoGrowthRate,
    monthlyIncomes,
    fixedExpenses,
    dailyTransactions,
    currentMonth,
    region,
    setRegion,
    customTaxRatePct,
    setCustomTaxRatePct,
    restoreGrowthRateDefaults,
    restoreCustomTaxRateDefault,
    demoMode,
    toggleDemoMode,
    startOnboarding,
    resetGuide,
    hiddenNavItems,
    toggleNavItem,
    importAll,
    buildPayload,
    resetAll,
  } = useFinance();

  // Currency editor local state (uncommitted text inputs)
  const [usdRateInput, setUsdRateInput] = useState(String(nokToUsd));
  const [customCodeInput, setCustomCodeInput] = useState(customCurrencyCode);
  const [customRateInput, setCustomRateInput] = useState(String(customCurrencyRate));

  // Import state
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importPreview, setImportPreview] = useState<ExportPayload | null>(null);
  const [importError, setImportError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state
  const [resetState, setResetState] = useState<'idle' | 'confirm' | 'done'>('idle');

  const handleReset = () => {
    resetAll();
    setResetState('done');
    setTimeout(() => setResetState('idle'), 2500);
  };

  // ───── Export ─────
  const handleExport = () => {
    const payload: ExportPayload & { _version: number; _exportedAt: string } = {
      _version: 1,
      _exportedAt: new Date().toISOString(),
      ...buildPayload(),
      currentMonth: format(currentMonth, 'yyyy-MM'),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `headroom-export-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ───── Import ─────
  const validateAndPreview = (raw: string) => {
    try {
      const data = JSON.parse(raw);
      if (
        typeof data !== 'object' ||
        typeof data.income !== 'number' ||
        !Array.isArray(data.fixedExpenses) ||
        !Array.isArray(data.dailyTransactions)
      ) {
        setImportError(t.invalidFile);
        setImportState('error');
        return;
      }
      setImportPreview(data as ExportPayload);
      setImportState('ready');
      setImportError('');
    } catch {
      setImportError(t.invalidFile);
      setImportState('error');
    }
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      setImportError(t.invalidFile);
      setImportState('error');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => validateAndPreview(String(e.target?.result ?? ''));
    reader.onerror = () => {
      setImportError(t.invalidFile);
      setImportState('error');
    };
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (!importPreview) return;
    importAll(importPreview);
    setImportState('done');
    setImportPreview(null);
    setTimeout(() => setImportState('idle'), 2500);
  };

  const resetImport = () => {
    setImportState('idle');
    setImportPreview(null);
    setImportError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ───── Render ─────
  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <div
          className="text-[12px] uppercase tracking-[0.16em] font-semibold mb-2"
          style={{ color: 'var(--accent)' }}
        >
          {t.settings.title}
        </div>
        <h1 className="font-serif text-4xl md:text-6xl font-medium leading-[1.05] tracking-[-0.01em]">
          {t.settings.subtitle}
        </h1>
      </header>

      {/* Bento grid */}
      <div data-tour="settings-all" className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* ──── Bank sync (span 12) ──── */}
        <BankSyncCard />

        {/* ──── Currency (span 7) ──── */}
        <Card padding="lg" className="md:col-span-7">
          <SectionLabel icon={<Coins />}>{t.settings.currency}</SectionLabel>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
            {t.settings.currencyDesc}
          </p>

          {/* Segmented control */}
          <div
            className="mt-5 inline-flex p-1 rounded-[8px] border"
            style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)' }}
            role="radiogroup"
            aria-label={t.settings.currency}
          >
            <SegBtn active={displayCurrency === 'NOK'} onClick={() => setDisplayCurrency('NOK')}>
              NOK
            </SegBtn>
            <SegBtn active={displayCurrency === 'USD'} onClick={() => setDisplayCurrency('USD')}>
              USD
            </SegBtn>
            <SegBtn
              active={displayCurrency === 'custom'}
              disabled={!customCurrencyCode}
              onClick={() => customCurrencyCode && setDisplayCurrency('custom')}
            >
              {customCurrencyCode || '— custom —'}
            </SegBtn>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* USD rate */}
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2"
                style={{ color: 'var(--text-3)' }}
              >
                {t.settings.rateNokToUsd}
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={usdRateInput}
                  onChange={e => setUsdRateInput(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-[8px] text-[13px] font-mono outline-none border"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-1)',
                  }}
                />
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    const v = parseFloat(usdRateInput);
                    if (!isNaN(v) && v > 0) setNokToUsd(v);
                  }}
                >
                  OK
                </Button>
              </div>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                1 NOK = {nokToUsd} USD
              </p>
            </div>

            {/* Custom currency */}
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2"
                style={{ color: 'var(--text-3)' }}
              >
                {t.settings.customCurrencyLabel}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={5}
                  placeholder={t.settings.currencyCode}
                  value={customCodeInput}
                  onChange={e => setCustomCodeInput(e.target.value.toUpperCase())}
                  className="w-20 h-10 px-3 rounded-[8px] text-[13px] font-mono uppercase outline-none border"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-1)',
                  }}
                />
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  placeholder={t.settings.currencyRate}
                  value={customRateInput}
                  onChange={e => setCustomRateInput(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-[8px] text-[13px] font-mono outline-none border"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-1)',
                  }}
                />
                <Button
                  variant="secondary"
                  size="md"
                  disabled={
                    !customCodeInput.trim() ||
                    isNaN(parseFloat(customRateInput)) ||
                    parseFloat(customRateInput) <= 0
                  }
                  onClick={() => {
                    const code = customCodeInput.trim().toUpperCase();
                    const rate = parseFloat(customRateInput);
                    if (code && !isNaN(rate) && rate > 0) {
                      setCustomCurrencyCode(code);
                      setCustomCurrencyRate(rate);
                      setDisplayCurrency('custom');
                    }
                  }}
                >
                  OK
                </Button>
              </div>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                {t.settings.customCurrencyHint}
              </p>
            </div>
          </div>
        </Card>

        {/* ──── Language (span 5) ──── */}
        <Card padding="lg" className="md:col-span-5 flex flex-col">
          <SectionLabel icon={<Languages />}>{t.settings.language}</SectionLabel>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
            {t.settings.languageDesc}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <LangCard
              code="en"
              active={lang === 'en'}
              onClick={() => setLang('en')}
              flag="EN"
              label={t.settings.english}
            />
            <LangCard
              code="nb"
              active={lang === 'nb'}
              onClick={() => setLang('nb')}
              flag="NO"
              label={t.settings.norwegian}
            />
          </div>
        </Card>

        {/* ──── Region (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <SectionLabel icon={<Globe />}>{t.settings.region}</SectionLabel>
              <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
                {t.settings.regionDesc}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setRegion('no')}
                className="rounded-[8px] border p-4 text-left transition-colors"
                style={{
                  borderColor: region === 'no' ? 'var(--accent)' : 'var(--border)',
                  background: region === 'no' ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                }}
              >
                <div className="text-[12px] font-mono uppercase tracking-wider" style={{ color: region === 'no' ? 'var(--accent)' : 'var(--text-3)' }}>NO</div>
                <div className="text-[14px] font-semibold mt-1">{t.settings.regionNorway}</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>SSB · trinnskatt</div>
              </button>
              <button
                onClick={() => setRegion('generic')}
                className="rounded-[8px] border p-4 text-left transition-colors"
                style={{
                  borderColor: region === 'generic' ? 'var(--accent)' : 'var(--border)',
                  background: region === 'generic' ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                }}
              >
                <div className="text-[12px] font-mono uppercase tracking-wider" style={{ color: region === 'generic' ? 'var(--accent)' : 'var(--text-3)' }}>—</div>
                <div className="text-[14px] font-semibold mt-1">{t.settings.regionGeneric}</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>{t.common.flatTaxRate}</div>
              </button>
            </div>

            {region === 'generic' && (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>{t.settings.customTaxRate}</div>
                    <ProvenanceBadge kind={provenanceOf(customTaxRatePct, DEFAULT_TAX_RATES.customTaxRatePct)} />
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{t.settings.customTaxRateDesc}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={70}
                    step={1}
                    value={customTaxRatePct}
                    onChange={(e) => setCustomTaxRatePct(parseFloat(e.target.value))}
                    className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
                    style={{ background: 'color-mix(in srgb, var(--text-3) 18%, transparent)' }}
                  />
                  <span className="font-mono text-[14px] font-semibold w-14 text-right" style={{ color: 'var(--accent)' }}>
                    {customTaxRatePct}%
                  </span>
                </div>
                <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restoreCustomTaxRateDefault} className="-ml-3" />
              </div>
            )}
          </div>
        </Card>

        {/* ──── Navigation (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12">
          <SectionLabel icon={<LayoutGrid />}>{t.settings.navVisibility}</SectionLabel>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
            {t.settings.navVisibilityDesc}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {NAV_ITEMS.filter(item => item.path !== ALWAYS_VISIBLE_NAV).map(item => {
              const visible = !hiddenNavItems.includes(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => toggleNavItem(item.path)}
                  aria-pressed={visible}
                  className="inline-flex items-center gap-2 px-4 h-9 rounded-[6px] border text-[13px] font-medium transition-colors"
                  style={{
                    borderColor: visible ? 'var(--accent)' : 'var(--border)',
                    background: visible ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                    color: visible ? 'var(--accent)' : 'var(--text-3)',
                  }}
                >
                  {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  {t.nav[item.key]}
                </button>
              );
            })}
          </div>
        </Card>

        {/* ──── Display preferences (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <SectionLabel icon={<Sliders />}>{t.settings.display}</SectionLabel>
              <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
                {t.settings.displayDesc}
              </p>
            </div>
            <RestoreDefaultsButton label={t.settings.restoreDefaults} onRestore={restoreGrowthRateDefaults} />
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <RangeRow
              label={t.settings.savingsTargetPct}
              value={Math.round(savingsTargetPercent)}
              onChange={setSavingsTargetPercent}
              min={0}
              max={95}
              step={1}
              suffix="%"
            />
            <RangeRow
              label={t.settings.growthReturnRate}
              value={growthReturnRate}
              onChange={setGrowthReturnRate}
              min={0}
              max={30}
              step={0.5}
              suffix="%"
              badge={<ProvenanceBadge kind={provenanceOf(growthReturnRate, DEFAULT_GROWTH_RATES.growthReturnRate)} />}
            />
            <RangeRow
              label={t.settings.houseGrowthRate}
              value={houseGrowthRate}
              onChange={setHouseGrowthRate}
              min={0}
              max={20}
              step={0.5}
              suffix="%"
              badge={<ProvenanceBadge kind={provenanceOf(houseGrowthRate, DEFAULT_GROWTH_RATES.houseGrowthRate)} />}
            />
            <RangeRow
              label={t.settings.cashGrowthRate}
              value={cashGrowthRate}
              onChange={setCashGrowthRate}
              min={0}
              max={15}
              step={0.25}
              suffix="%"
              badge={<ProvenanceBadge kind={provenanceOf(cashGrowthRate, DEFAULT_GROWTH_RATES.cashGrowthRate)} />}
            />
            <RangeRow
              label={t.settings.cryptoGrowthRate}
              value={cryptoGrowthRate}
              onChange={setCryptoGrowthRate}
              min={0}
              max={100}
              step={1}
              suffix="%"
              badge={<ProvenanceBadge kind={provenanceOf(cryptoGrowthRate, DEFAULT_GROWTH_RATES.cryptoGrowthRate)} />}
            />
          </div>
          <p className="mt-4 text-[12px]" style={{ color: 'var(--text-3)' }}>
            {t.settings.growthRatesDesc}
          </p>
        </Card>

        {/* ──── Demo mode (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <SectionLabel icon={<MonitorPlay />}>{t.settings.demoTitle}</SectionLabel>
              <p className="mt-2 text-[13px] max-w-2xl" style={{ color: 'var(--text-2)' }}>
                {t.settings.demoDesc}
              </p>
            </div>
            {demoMode && (
              <span
                className="text-[12px] font-semibold px-3 py-1 rounded-[4px]"
                style={{ background: 'var(--violet-bg)', color: 'var(--violet)' }}
              >
                {t.settings.demoActive}
              </span>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              variant={demoMode ? 'secondary' : 'primary'}
              size="md"
              leadingIcon={<MonitorPlay />}
              onClick={toggleDemoMode}
            >
              {demoMode ? t.settings.demoDeactivate : t.settings.demoActivate}
            </Button>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<Sparkles />}
              onClick={() => startOnboarding('hub')}
            >
              {t.onboarding.replay}
            </Button>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<RotateCcw />}
              onClick={resetGuide}
            >
              {t.onboarding.resetGuide}
            </Button>
          </div>
        </Card>

        {/* ──── Data management (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12" data-tour="settings-data">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <SectionLabel icon={<Database />}>{t.settings.dataManagement}</SectionLabel>
              <p className="mt-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
                {t.settings.dataDesc}
              </p>
            </div>
            <DeltaChip tone="accent">JSON</DeltaChip>
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Export */}
            <div
              className="rounded-[8px] border p-5 flex flex-col"
              style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-[8px] grid place-items-center shrink-0"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                >
                  <Download size={18} />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">{t.exportSection}</div>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--text-3)' }}>
                    {t.exportDesc}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <DataStat label="expenses" value={fixedExpenses.length} />
                <DataStat label="tx" value={dailyTransactions.length} />
                <DataStat label="months" value={Object.keys(monthlyIncomes).length} />
              </div>

              <Button
                variant="primary"
                size="md"
                className="mt-5 self-start"
                leadingIcon={<Download />}
                onClick={handleExport}
              >
                {t.settings.exportData}
              </Button>
            </div>

            {/* Import */}
            <div
              className="rounded-[8px] border p-5 flex flex-col"
              style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-[8px] grid place-items-center shrink-0"
                  style={{ background: 'var(--violet-bg)', color: 'var(--violet)' }}
                >
                  <Upload size={18} />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">{t.importSection}</div>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--text-3)' }}>
                    {t.importDesc}
                  </p>
                </div>
              </div>

              {importState === 'idle' || importState === 'error' ? (
                <>
                  <label
                    onDragOver={e => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (file) processFile(file);
                    }}
                    className="mt-4 rounded-[8px] border-2 border-dashed cursor-pointer transition-colors p-6 grid place-items-center text-center"
                    style={{
                      borderColor: isDragOver ? 'var(--violet)' : 'var(--border-strong)',
                      background: isDragOver ? 'var(--violet-bg)' : 'transparent',
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) processFile(file);
                      }}
                    />
                    <FileJson
                      size={28}
                      style={{ color: isDragOver ? 'var(--violet)' : 'var(--text-3)' }}
                    />
                    <div className="mt-2 text-[13px]" style={{ color: 'var(--text-1)' }}>
                      {t.settings.dropZone}
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      {t.settings.browseFile}
                    </div>
                  </label>

                  {importState === 'error' && (
                    <div
                      role="alert"
                      className="mt-3 flex items-start gap-2 text-[12px] rounded-[8px] p-3"
                      style={{ background: 'var(--negative-bg)', color: 'var(--negative)' }}
                    >
                      <AlertTriangle size={14} className="mt-0.5" />
                      <span>{importError}</span>
                    </div>
                  )}
                </>
              ) : importState === 'ready' && importPreview ? (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                    <CheckCircle2 size={14} />
                    {t.settings.importReady}
                  </div>
                  <div
                    className="rounded-[8px] p-3 grid grid-cols-3 gap-2 text-center"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                  >
                    <DataStat label="expenses" value={importPreview.fixedExpenses.length} />
                    <DataStat label="tx" value={importPreview.dailyTransactions.length} />
                    <DataStat label="inc." value={Object.keys(importPreview.monthlyIncomes ?? {}).length} />
                    <DataStat label="jobs" value={importPreview.jobs?.length ?? 0} />
                    <DataStat label="salaries" value={importPreview.salaries?.length ?? 0} />
                    <DataStat label="bonuses" value={importPreview.bonuses?.length ?? 0} />
                    <DataStat label="overtime" value={importPreview.overtime?.length ?? 0} />
                    <DataStat label="hours" value={importPreview.hoursSnapshots?.length ?? 0} />
                    <DataStat label="goals" value={importPreview.goals?.length ?? 0} />
                  </div>
                  <div
                    className="flex items-start gap-2 text-[12px] rounded-[8px] p-3"
                    style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{t.settings.replaceWarning}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="danger" size="md" leadingIcon={<Trash2 />} onClick={confirmImport}>
                      {t.settings.replaceConfirm}
                    </Button>
                    <Button variant="ghost" size="md" onClick={resetImport}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="mt-4 flex items-center gap-2 text-[13px] font-medium rounded-[8px] p-4"
                  style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
                >
                  <CheckCircle2 size={16} />
                  {t.settings.importDone}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* ──── Danger zone (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <SectionLabel icon={<AlertTriangle />}>{t.settings.resetTitle}</SectionLabel>
              <p className="mt-2 text-[13px] max-w-2xl" style={{ color: 'var(--text-2)' }}>
                {t.settings.resetDesc}
              </p>
            </div>
            <DeltaChip tone="negative">!</DeltaChip>
          </div>

          {resetState === 'idle' && (
            <Button
              variant="danger"
              size="md"
              className="mt-5"
              leadingIcon={<Trash2 />}
              onClick={() => setResetState('confirm')}
            >
              {t.settings.resetButton}
            </Button>
          )}

          {resetState === 'confirm' && (
            <div className="mt-5 flex flex-col gap-3 max-w-2xl">
              <div
                className="flex items-start gap-2 text-[12px] rounded-[8px] p-3"
                style={{ background: 'var(--negative-bg)', color: 'var(--negative)' }}
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{t.settings.resetWarning}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="danger" size="md" leadingIcon={<Trash2 />} onClick={handleReset}>
                  {t.settings.resetConfirm}
                </Button>
                <Button variant="ghost" size="md" onClick={() => setResetState('idle')}>
                  {t.settings.resetCancel}
                </Button>
              </div>
            </div>
          )}

          {resetState === 'done' && (
            <div
              className="mt-5 flex items-center gap-2 text-[13px] font-medium rounded-[8px] p-4 max-w-2xl"
              style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}
            >
              <CheckCircle2 size={16} />
              {t.settings.resetDone}
            </div>
          )}
        </Card>

        {/* ──── About (span 12) ──── */}
        <Card padding="lg" className="md:col-span-12">
          <div className="flex items-start gap-4 flex-wrap justify-between">
            <div>
              <SectionLabel icon={<Info />}>{t.settings.about}</SectionLabel>
              <p className="mt-2 text-[13px] max-w-2xl" style={{ color: 'var(--text-2)' }}>
                {t.settings.aboutDesc}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <DeltaChip tone="muted">{t.settings.version}: {APP_VERSION}</DeltaChip>
              <DeltaChip tone="muted">{t.settings.storage}: SQLite</DeltaChip>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ───────────── small helpers ─────────────

function SegBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className="px-4 h-8 text-[12px] font-semibold rounded-[6px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: active ? 'var(--text-1)' : 'transparent',
        color: active ? 'var(--bg-page)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}

function LangCard({
  active,
  onClick,
  flag,
  label,
}: {
  code: string;
  active: boolean;
  onClick: () => void;
  flag: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex items-center gap-3 px-4 py-3 rounded-[8px] border transition-colors text-left"
      style={{
        background: active ? 'var(--accent-bg)' : 'rgba(255,255,255,0.04)',
        borderColor: active ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'var(--border)',
      }}
    >
      <span
        className="grid place-items-center w-9 h-9 rounded-[8px] font-bold text-[11px] tracking-wider"
        style={{
          background: active ? 'var(--accent)' : 'var(--bg-elev)',
          color: active ? 'var(--bg-page)' : 'var(--text-2)',
        }}
      >
        {flag}
      </span>
      <span style={{ color: 'var(--text-1)' }} className="text-[13px] font-medium">
        {label}
      </span>
    </button>
  );
}

function RangeRow({
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
  badge?: ReactNode;
}) {
  const [draft, setDraft] = useState(value.toString());
  // Re-sync the editable draft when the committed value changes from outside.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(value.toString()); }, [value]);
  const commitDraft = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n >= 0) onChange(n);
    else setDraft(value.toString());
  };
  // Slider clamps to its own range; the number input below it has no upper cap.
  const sliderValue = Math.min(Math.max(value, min), max);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <label
            className="text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: 'var(--text-3)' }}
          >
            {label}
          </label>
          {badge}
        </div>
        <div className="flex items-baseline gap-1">
          <input
            type="number"
            value={draft}
            step={step}
            min={0}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            className="w-20 text-right text-[18px] font-semibold tabular-nums bg-transparent outline-none rounded px-1 hover:bg-[rgba(255,255,255,0.04)] focus:bg-[rgba(255,255,255,0.04)] transition-colors"
            style={{ color: 'var(--text-1)' }}
          />
          <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{suffix}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--accent)' }}
      />
    </div>
  );
}

function DataStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[18px] font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.1em] mt-0.5" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
    </div>
  );
}
