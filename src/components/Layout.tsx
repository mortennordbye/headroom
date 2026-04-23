import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Building2,
  LayoutDashboard,
  HardDriveDownload,
} from 'lucide-react';
import { format, subMonths, addMonths } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import DataModal from './DataModal';

const Layout: React.FC = () => {
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
    isDarkMode,
    setIsDarkMode,
    currentMonth,
    setCurrentMonth
  } = useFinance();

  const [showDataModal, setShowDataModal] = useState(false);
  const [showRateEditor, setShowRateEditor] = useState(false);
  const [usdRateInput, setUsdRateInput] = useState(String(nokToUsd));
  const [customCodeInput, setCustomCodeInput] = useState(customCurrencyCode);
  const [customRateInput, setCustomRateInput] = useState(String(customCurrencyRate));
  const rateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showRateEditor) return;
    const handler = (e: MouseEvent) => {
      if (rateRef.current && !rateRef.current.contains(e.target as Node)) {
        setShowRateEditor(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRateEditor]);

  const cycleCurrency = () => {
    if (displayCurrency === 'NOK') {
      setDisplayCurrency('USD');
    } else if (displayCurrency === 'USD') {
      if (customCurrencyCode) setDisplayCurrency('custom');
      else setDisplayCurrency('NOK');
    } else {
      setDisplayCurrency('NOK');
    }
  };

  const currencyLabel = displayCurrency === 'custom' && customCurrencyCode
    ? customCurrencyCode.toUpperCase()
    : displayCurrency;
  const dateLocale = lang === 'nb' ? nb : enUS;

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#111111] text-[#0a0a0a] dark:text-[#fafafa] transition-colors duration-300 font-sans">
      <div className="max-w-[1200px] mx-auto px-4 py-4 md:px-10 md:py-8 lg:px-16 lg:py-12 space-y-6 md:space-y-10 lg:space-y-14">

        {/* Header */}
        <header className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-[#0a0a0a] dark:text-[#fafafa]">
              {t.title}
            </h1>

            <div className="flex items-center gap-2 md:gap-3 shrink-0">
              <button
                onClick={() => setShowDataModal(true)}
                title={t.importExportTitle}
                className="p-1.5 rounded-lg text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] hover:bg-[#e5e5e5] dark:hover:bg-[#222222] transition-colors"
              >
                <HardDriveDownload size={16} strokeWidth={2} />
              </button>

              {/* Currency toggle */}
              <div className="relative" ref={rateRef}>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={cycleCurrency}
                    className="text-[11px] font-medium text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors px-2 py-1 rounded-lg hover:bg-[#e5e5e5] dark:hover:bg-[#222222]"
                  >
                    {currencyLabel}
                  </button>
                  <button
                    onClick={() => {
                      setUsdRateInput(String(nokToUsd));
                      setCustomCodeInput(customCurrencyCode);
                      setCustomRateInput(String(customCurrencyRate));
                      setShowRateEditor(v => !v);
                    }}
                    className="text-[10px] text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors px-1 py-1 rounded-lg hover:bg-[#e5e5e5] dark:hover:bg-[#222222] font-mono"
                    title="Currency settings"
                  >
                    ⚙
                  </button>
                </div>
                {showRateEditor && (
                  <div className="absolute right-0 top-8 z-50 bg-white dark:bg-[#1a1a1a] border border-[#e5e5e5] dark:border-[#2a2a2a] rounded-xl shadow-lg p-4 min-w-[220px] space-y-4">
                    {/* USD rate */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-[#737373] uppercase tracking-wide">USD</p>
                      <p className="text-[10px] text-[#737373]">1 NOK = ? USD</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={usdRateInput}
                          onChange={e => setUsdRateInput(e.target.value)}
                          className="flex-1 text-[12px] font-mono px-2 py-1 rounded-lg border border-[#e5e5e5] dark:border-[#2a2a2a] bg-transparent text-[#0a0a0a] dark:text-[#fafafa] focus:outline-none focus:border-[#0ea5e9]"
                        />
                        <button
                          onClick={() => {
                            const v = parseFloat(usdRateInput);
                            if (!isNaN(v) && v > 0) setNokToUsd(v);
                          }}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg bg-[#0ea5e9] text-white hover:bg-[#0284c7] transition-colors"
                        >
                          OK
                        </button>
                      </div>
                    </div>

                    {/* Custom currency */}
                    <div className="space-y-1.5 border-t border-[#f0f0f0] dark:border-[#222222] pt-3">
                      <p className="text-[11px] font-semibold text-[#737373] uppercase tracking-wide">
                        {lang === 'nb' ? 'Egendefinert valuta' : 'Custom currency'}
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={5}
                          placeholder="EUR"
                          value={customCodeInput}
                          onChange={e => setCustomCodeInput(e.target.value.toUpperCase())}
                          className="w-16 text-[12px] font-mono px-2 py-1 rounded-lg border border-[#e5e5e5] dark:border-[#2a2a2a] bg-transparent text-[#0a0a0a] dark:text-[#fafafa] focus:outline-none focus:border-[#0ea5e9] uppercase"
                        />
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          placeholder="rate"
                          value={customRateInput}
                          onChange={e => setCustomRateInput(e.target.value)}
                          className="flex-1 text-[12px] font-mono px-2 py-1 rounded-lg border border-[#e5e5e5] dark:border-[#2a2a2a] bg-transparent text-[#0a0a0a] dark:text-[#fafafa] focus:outline-none focus:border-[#0ea5e9]"
                        />
                      </div>
                      <p className="text-[10px] text-[#737373]">1 NOK = rate {customCodeInput || '?'}</p>
                      <button
                        onClick={() => {
                          const code = customCodeInput.trim().toUpperCase();
                          const rate = parseFloat(customRateInput);
                          if (code && !isNaN(rate) && rate > 0) {
                            setCustomCurrencyCode(code);
                            setCustomCurrencyRate(rate);
                            setDisplayCurrency('custom');
                          }
                          setShowRateEditor(false);
                        }}
                        disabled={!customCodeInput.trim() || isNaN(parseFloat(customRateInput)) || parseFloat(customRateInput) <= 0}
                        className="w-full text-[11px] font-medium px-2 py-1.5 rounded-lg bg-[#0ea5e9] text-white hover:bg-[#0284c7] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {lang === 'nb' ? 'Bruk egendefinert' : 'Use custom'}
                      </button>
                    </div>

                    <button
                      onClick={() => setShowRateEditor(false)}
                      className="w-full text-[11px] text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors"
                    >
                      {lang === 'nb' ? 'Lukk' : 'Close'}
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => setLang(lang === 'nb' ? 'en' : 'nb')}
                className="text-[11px] font-medium text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors px-2 py-1 rounded-lg hover:bg-[#e5e5e5] dark:hover:bg-[#222222]"
              >
                <span className="sm:hidden">{lang === 'nb' ? 'EN' : 'NO'}</span>
                <span className="hidden sm:inline">{lang === 'nb' ? 'English' : 'Norsk'}</span>
              </button>

              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-1.5 rounded-lg text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] hover:bg-[#e5e5e5] dark:hover:bg-[#222222] transition-colors"
              >
                {isDarkMode ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
              </button>

              <div className="flex items-center gap-1 md:gap-2 bg-white dark:bg-[#1a1a1a] px-2 md:px-3 py-1.5 rounded-xl border border-[#e5e5e5] dark:border-[#2a2a2a]">
                <button
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors"
                >
                  <ChevronLeft size={15} strokeWidth={2} />
                </button>
                <span className="font-medium text-[11px] md:text-[12px] text-[#0a0a0a] dark:text-[#fafafa] min-w-[64px] md:min-w-[100px] text-center font-mono">
                  {format(currentMonth, 'MMM yyyy', { locale: dateLocale })}
                </span>
                <button
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] transition-colors"
                >
                  <ChevronRight size={15} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            <NavButton to="/overview" label={t.nav.dashboard} />
            <NavButton to="/" label={t.nav.budget} />
            <NavButton to="/assets" label={t.nav.assets} />
            <NavButton to="/loan" label={t.nav.loan} />
          </nav>
        </header>

        <main className="animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>

      {showDataModal && <DataModal onClose={() => setShowDataModal(false)} />}

      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur-xl border-t border-[#e5e5e5] dark:border-[#2a2a2a] flex">
        <MobileNavTab to="/overview" icon={<LayoutDashboard size={20} strokeWidth={1.75} />} label={t.nav.dashboard} />
        <MobileNavTab to="/" icon={<BarChart3 size={20} strokeWidth={1.75} />} label={t.nav.budget} />
        <MobileNavTab to="/assets" icon={<TrendingUp size={20} strokeWidth={1.75} />} label={t.nav.assets} />
        <MobileNavTab to="/loan" icon={<Building2 size={20} strokeWidth={1.75} />} label={t.nav.loan} />
      </nav>
    </div>
  );
};

interface NavButtonProps {
  to: string;
  label: string;
}

const NavButton: React.FC<NavButtonProps> = ({ to, label }) => {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
          isActive
            ? 'text-[#0a0a0a] dark:text-[#fafafa] bg-[#e5e5e5] dark:bg-[#222222]'
            : 'text-[#737373] hover:text-[#0a0a0a] dark:hover:text-[#fafafa] hover:bg-[#f0f0f0] dark:hover:bg-[#1f1f1f]'
        }`
      }
    >
      {label}
    </NavLink>
  );
};

interface MobileNavTabProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const MobileNavTab: React.FC<MobileNavTabProps> = ({ to, icon, label }) => {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center gap-1 py-2.5 pb-3 text-[10px] font-medium transition-colors ${
          isActive
            ? 'text-[#0ea5e9] dark:text-[#38bdf8]'
            : 'text-[#737373]'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
};

export default Layout;
