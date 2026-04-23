import { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Download, Upload, AlertTriangle, CheckCircle2, FileJson } from 'lucide-react';
import { format } from 'date-fns';
import { useFinance, type ExportPayload } from '../context/FinanceContext';

interface DataModalProps {
  onClose: () => void;
}

type ImportState = 'idle' | 'ready' | 'error';

export default function DataModal({ onClose }: DataModalProps) {
  const {
    t,
    lang,
    income,
    fixedExpenses,
    dailyTransactions,
    recurringTemplates,
    assets,
    loan,
    monthlyIncomes,
    netWorthHistory,
    housingMode,
    homeowner,
    transition,
    savingsTargetPercent,
    growthReturnRate,
    displayCurrency,
    nokToUsd,
    customCurrencyCode,
    customCurrencyRate,
    isDarkMode,
    currentMonth,
    importAll,
    formatCurrency,
  } = useFinance();

  const [importState, setImportState] = useState<ImportState>('idle');
  const [importPreview, setImportPreview] = useState<ExportPayload | null>(null);
  const [importError, setImportError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Export ---
  const handleExport = () => {
    const payload: ExportPayload & { _version: number; _exportedAt: string } = {
      _version: 1,
      _exportedAt: new Date().toISOString(),
      income,
      monthlyIncomes,
      netWorthHistory,
      fixedExpenses,
      dailyTransactions,
      recurringTemplates,
      assets,
      loan,
      housingMode,
      homeowner,
      transition,
      savingsTargetPercent,
      growthReturnRate,
      displayCurrency,
      nokToUsd,
      customCurrencyCode,
      customCurrencyRate,
      isDarkMode,
      currentMonth: format(currentMonth, 'yyyy-MM'),
      lang,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `headroom-export-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Import ---
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
    reader.onload = (e) => validateAndPreview(e.target?.result as string);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleImport = () => {
    if (!importPreview) return;
    importAll(importPreview);
    setDone(true);
    setTimeout(onClose, 800);
  };

  const resetImport = () => {
    setImportState('idle');
    setImportPreview(null);
    setImportError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const content = (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:w-[480px] bg-white dark:bg-[#1a1a1a] rounded-t-2xl sm:rounded-2xl shadow-2xl border border-[#e5e5e5] dark:border-[#2a2a2a] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0f0f0] dark:border-[#222222]">
          <h2 className="text-[14px] font-semibold text-[#0a0a0a] dark:text-[#fafafa]">
            {t.importExportTitle}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] hover:bg-[#f0f0f0] dark:hover:bg-[#222222] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="divide-y divide-[#f0f0f0] dark:divide-[#222222]">
          {/* Export section */}
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <Download size={13} className="text-[#737373]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#737373]">
                {t.exportSection}
              </span>
            </div>
            <p className="text-[13px] text-[#737373] leading-relaxed">{t.exportDesc}</p>

            <div className="grid grid-cols-3 gap-2 text-[12px]">
              <Stat label={lang === 'nb' ? 'Utgifter' : 'Expenses'} value={fixedExpenses.length} />
              <Stat label={lang === 'nb' ? 'Transaksjoner' : 'Transactions'} value={dailyTransactions.length} />
              <Stat label={lang === 'nb' ? 'Maler' : 'Templates'} value={recurringTemplates.length} />
              <Stat label={lang === 'nb' ? 'Måneder' : 'Months'} value={Object.keys(monthlyIncomes).length} />
              <Stat label={lang === 'nb' ? 'Formueshistorikk' : 'Net worth history'} value={Object.keys(netWorthHistory).length} />
            </div>

            <div className="text-[12px] text-[#737373]">
              {lang === 'nb' ? 'Inntekt' : 'Income'}: <span className="font-mono font-semibold text-[#0a0a0a] dark:text-[#fafafa]">{formatCurrency(income)}</span>
            </div>

            <button
              onClick={handleExport}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#0ea5e9] dark:bg-[#38bdf8] dark:text-[#111111] hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Download size={14} />
              {t.downloadJSON}
            </button>
          </div>

          {/* Import section */}
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <Upload size={13} className="text-[#737373]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#737373]">
                {t.importSection}
              </span>
            </div>
            <p className="text-[13px] text-[#737373] leading-relaxed">{t.importDesc}</p>

            {done ? (
              <div className="flex items-center gap-2 py-3 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={16} />
                <span className="text-[13px] font-medium">
                  {lang === 'nb' ? 'Data importert!' : 'Data imported!'}
                </span>
              </div>
            ) : importState === 'ready' && importPreview ? (
              <div className="space-y-4">
                <div className="bg-[#fafafa] dark:bg-[#222222] rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <FileJson size={14} className="text-[#0ea5e9]" />
                    <span className="text-[12px] font-semibold text-[#0a0a0a] dark:text-[#fafafa]">
                      {t.importReadyTitle}
                    </span>
                  </div>
                  <PreviewRow
                    label={lang === 'nb' ? 'Inntekt' : 'Income'}
                    value={formatCurrency(importPreview.income)}
                  />
                  <PreviewRow
                    label={lang === 'nb' ? 'Faste utgifter' : 'Fixed expenses'}
                    value={importPreview.fixedExpenses?.length ?? 0}
                  />
                  <PreviewRow
                    label={lang === 'nb' ? 'Transaksjoner' : 'Transactions'}
                    value={importPreview.dailyTransactions?.length ?? 0}
                  />
                  <PreviewRow
                    label={lang === 'nb' ? 'Maler' : 'Templates'}
                    value={importPreview.recurringTemplates?.length ?? 0}
                  />
                  {importPreview.monthlyIncomes && Object.keys(importPreview.monthlyIncomes).length > 0 && (
                    <PreviewRow
                      label={lang === 'nb' ? 'Månedsinntekter (historikk)' : 'Monthly incomes (history)'}
                      value={`${Object.keys(importPreview.monthlyIncomes).length} ${lang === 'nb' ? 'mnd' : 'mo'}`}
                    />
                  )}
                  {importPreview.netWorthHistory && Object.keys(importPreview.netWorthHistory).length > 0 && (
                    <PreviewRow
                      label={lang === 'nb' ? 'Formueshistorikk' : 'Net worth history'}
                      value={`${Object.keys(importPreview.netWorthHistory).length} ${lang === 'nb' ? 'mnd' : 'mo'}`}
                    />
                  )}
                </div>

                <div className="flex items-start gap-2 text-[12px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{t.importWarning}</span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={resetImport}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#737373] bg-[#f0f0f0] dark:bg-[#222222] hover:bg-[#e5e5e5] dark:hover:bg-[#2a2a2a] transition-colors"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={handleImport}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#ef4444] hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                  >
                    <Upload size={14} />
                    {t.replaceData}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {importState === 'error' && (
                  <div className="flex items-center gap-2 text-[12px] text-[#ef4444]">
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  className={`w-full py-8 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center gap-2 cursor-pointer ${
                    isDragOver
                      ? 'border-[#0ea5e9] bg-sky-50 dark:bg-sky-950/20'
                      : 'border-[#e5e5e5] dark:border-[#2a2a2a] hover:border-[#0ea5e9] dark:hover:border-[#38bdf8] hover:bg-[#fafafa] dark:hover:bg-[#222222]'
                  }`}
                >
                  <FileJson size={20} className="text-[#737373]" />
                  <span className="text-[12px] text-[#737373] text-center px-4">{t.chooseFile}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#fafafa] dark:bg-[#222222] rounded-xl p-3 text-center">
      <div className="text-[18px] font-bold font-mono text-[#0a0a0a] dark:text-[#fafafa]">{value}</div>
      <div className="text-[10px] text-[#737373] mt-0.5">{label}</div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-[12px]">
      <span className="text-[#737373]">{label}</span>
      <span className="font-mono font-medium text-[#0a0a0a] dark:text-[#fafafa]">{value}</span>
    </div>
  );
}
