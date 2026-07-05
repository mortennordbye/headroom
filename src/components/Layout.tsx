import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  BarChart3,
  TrendingUp,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Menu as MenuIcon,
  X,
} from 'lucide-react';
import { format, subMonths, addMonths, startOfMonth, isSameMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

import { NAV_ITEMS, MORE_ROUTES, ALWAYS_VISIBLE_NAV } from './navItems';

// Pages whose data is scoped to the selected month get the interactive month picker.
const MONTH_SCOPED_ROUTES = ['/', '/overview'];
// Pages with no time dimension at all hide the time marker entirely.
const HIDE_TIME_MARKER_ROUTES = ['/settings'];

const Layout: React.FC = () => {
  const { t, lang, currentMonth, setCurrentMonth, dataLoadFailed, saveFailed, retrySave, hiddenNavItems, demoMode, toggleDemoMode } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ROUTES.includes(location.pathname);
  const sheetRef = useFocusTrap<HTMLDivElement>(() => setMoreOpen(false), undefined, moreOpen);

  const isVisible = (path: string) => path === ALWAYS_VISIBLE_NAV || !hiddenNavItems.includes(path);

  // The month picker only rules month-scoped pages (budget & dashboard).
  // Everywhere else shows a static "as of today" marker, and settings hides it entirely.
  const isMonthScoped = MONTH_SCOPED_ROUTES.includes(location.pathname);
  const hideTimeMarker = HIDE_TIME_MARKER_ROUTES.includes(location.pathname);

  const today = new Date();
  const isCurrentMonth = isSameMonth(currentMonth, today);
  const isPast = currentMonth < startOfMonth(today);
  const statusColor = isCurrentMonth
    ? 'var(--positive)'
    : isPast
      ? 'var(--text-3)'
      : 'var(--violet)';
  const statusBg = isCurrentMonth
    ? 'var(--positive-bg)'
    : isPast
      ? 'rgba(255,255,255,0.05)'
      : 'var(--violet-bg)';
  const statusLabel = isCurrentMonth
    ? t.viewingCurrent
    : isPast
      ? t.viewingPast
      : t.viewingFuture;

  return (
    <div className="min-h-[100dvh] text-[var(--text-1)] font-sans">
      {/* ─── Top nav ─────────────────────────── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 px-5 md:px-8 py-4 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--rule)' }}
      >
        {/* Brand — ceiling/clearance mark (a ring bisected by a hairline) + serif wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className="relative grid place-items-center w-[18px] h-[18px] rounded-full shrink-0"
            style={{ border: '1px solid var(--brass)' }}
            aria-hidden
          >
            <span
              className="absolute left-[4px] right-[4px] top-1/2 h-px -translate-y-1/2"
              style={{ background: 'var(--brass)' }}
            />
          </span>
          <span className="font-serif text-[22px] font-semibold leading-none">{t.title}</span>
        </div>

        {/* Underline tabs — desktop only */}
        <nav className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.filter(item => isVisible(item.path)).map(item => (
            <NavButton key={item.path} to={item.path} label={t.nav[item.key]} />
          ))}
        </nav>

        {/* Right cluster: month picker (month-scoped pages) or static "as of today" marker */}
        <div className="flex items-center gap-2 shrink-0">
          {isMonthScoped ? (
            <>
              <div
                className="flex items-center gap-1 rounded-[6px] border p-1 transition-colors"
                style={{
                  background: statusBg,
                  borderColor: isCurrentMonth ? 'color-mix(in srgb, var(--positive) 35%, transparent)' : 'var(--border)',
                }}
                title={statusLabel}
              >
                <button
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  aria-label="Previous month"
                  className="grid place-items-center w-7 h-7 rounded-[4px] transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                >
                  <ChevronLeft size={15} strokeWidth={2} />
                </button>
                <div className="flex items-center gap-1.5 px-2 min-w-[104px] justify-center">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: statusColor }}
                    aria-hidden
                  />
                  <span className="text-[13px] font-semibold tabular-nums">
                    {format(currentMonth, 'MMM yyyy', { locale: dateLocale })}
                  </span>
                </div>
                <button
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  aria-label="Next month"
                  className="grid place-items-center w-7 h-7 rounded-[4px] transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                >
                  <ChevronRight size={15} strokeWidth={2} />
                </button>
              </div>
              {!isCurrentMonth && (
                <button
                  onClick={() => setCurrentMonth(startOfMonth(today))}
                  className="hidden sm:inline-flex items-center px-3 h-8 rounded-[6px] text-[12px] font-semibold transition-colors"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-bg)'; }}
                  title={t.today}
                >
                  {t.today}
                </button>
              )}
            </>
          ) : hideTimeMarker ? null : (
            <div
              className="flex items-center gap-1.5 rounded-[6px] border px-3 h-9"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}
              title={t.asOfTodayHint}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: 'var(--text-3)' }}
                aria-hidden
              />
              <span className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                {t.asOfToday} · {format(today, 'd. MMM yyyy', { locale: dateLocale })}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ─── Main ────────────────────────────── */}
      <main className="max-w-[1320px] mx-auto px-5 md:px-8 py-6 md:py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12">
        {demoMode && (
          <div
            className="flex items-center justify-between gap-3 mb-5 px-4 py-3 rounded-[var(--radius-md)] border text-[13px]"
            style={{ background: 'var(--violet-bg)', borderColor: 'color-mix(in srgb, var(--violet) 35%, transparent)', color: 'var(--violet)' }}
            role="status"
          >
            <span className="font-medium">{t.settings.demoBanner}</span>
            <button
              onClick={toggleDemoMode}
              className="shrink-0 px-3 h-8 rounded-[6px] text-[12px] font-semibold"
              style={{ background: 'var(--violet)', color: 'var(--bg-page)' }}
            >
              {t.settings.demoExit}
            </button>
          </div>
        )}
        {dataLoadFailed && (
          <div
            className="flex items-center justify-between gap-3 mb-5 px-4 py-3 rounded-[var(--radius-md)] border text-[13px]"
            style={{ background: 'var(--negative-bg)', borderColor: 'color-mix(in srgb, var(--negative) 35%, transparent)', color: 'var(--negative)' }}
            role="alert"
          >
            <span>{t.dataLoadError}</span>
            <button
              onClick={() => window.location.reload()}
              className="shrink-0 px-3 h-8 rounded-[6px] text-[12px] font-semibold"
              style={{ background: 'var(--negative)', color: 'var(--bg-page)' }}
            >
              {t.retry}
            </button>
          </div>
        )}
        {saveFailed && (
          <div
            className="flex items-center justify-between gap-3 mb-5 px-4 py-3 rounded-[var(--radius-md)] border text-[13px]"
            style={{ background: 'var(--negative-bg)', borderColor: 'color-mix(in srgb, var(--negative) 35%, transparent)', color: 'var(--negative)' }}
            role="alert"
          >
            <span>{t.saveError}</span>
            <button
              onClick={retrySave}
              className="shrink-0 px-3 h-8 rounded-[6px] text-[12px] font-semibold"
              style={{ background: 'var(--negative)', color: 'var(--bg-page)' }}
            >
              {t.saveRetry}
            </button>
          </div>
        )}
        <Outlet />
      </main>

      {/* ─── Mobile "Mer" sheet ──────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 animate-fade-in"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            className="absolute bottom-0 left-0 right-0 animate-sheet-rise rounded-t-[var(--radius-xl)] border-t px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between px-2 pb-1">
              <span
                className="mx-auto h-1 w-9 rounded-full"
                style={{ background: 'var(--border-strong)' }}
                aria-hidden
              />
            </div>
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>
                {t.nav.more}
              </span>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label={t.cancel}
                className="grid place-items-center w-8 h-8 rounded-[6px]"
                style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {NAV_ITEMS
                .filter(item => MORE_ROUTES.includes(item.path) && isVisible(item.path))
                .map(item => (
                  <SheetItem key={item.path} to={item.path} icon={item.icon} label={t.nav[item.key]} onNavigate={() => setMoreOpen(false)} />
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Mobile bottom nav ───────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex border-t pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
        style={{
          background: 'var(--bg)',
          borderColor: 'var(--rule)',
        }}
      >
        <MobileNavTab to="/overview" icon={<LayoutDashboard size={20} strokeWidth={1.75} />} label={t.nav.dashboard} />
        <MobileNavTab to="/" icon={<BarChart3 size={20} strokeWidth={1.75} />} label={t.nav.budget} />
        <MobileNavTab to="/assets" icon={<TrendingUp size={20} strokeWidth={1.75} />} label={t.nav.assets} />
        <MobileNavTab to="/salary" icon={<LineChartIcon size={20} strokeWidth={1.75} />} label={t.nav.salary} />
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 min-w-0 flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors"
          style={{ color: moreActive ? 'var(--brass)' : 'var(--text-3)' }}
          aria-label={t.nav.more}
        >
          <MenuIcon size={20} strokeWidth={1.75} />
          <span className="truncate max-w-full px-0.5">{t.nav.more}</span>
        </button>
      </nav>
    </div>
  );
};

interface SheetItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  onNavigate: () => void;
}

const SheetItem: React.FC<SheetItemProps> = ({ to, icon, label, onNavigate }) => (
  <NavLink
    to={to}
    end={to === '/'}
    onClick={onNavigate}
    className="flex items-center gap-3 px-4 py-3.5 rounded-[var(--radius-md)] text-[14px] font-medium transition-colors border"
    style={({ isActive }) => ({
      background: isActive ? 'var(--warning-bg)' : 'var(--bg-2)',
      borderColor: isActive ? 'var(--brass-dim)' : 'var(--rule)',
      color: isActive ? 'var(--brass)' : 'var(--text-1)',
    })}
  >
    {icon}
    <span>{label}</span>
  </NavLink>
);

interface NavButtonProps {
  to: string;
  label: string;
}

const NavButton: React.FC<NavButtonProps> = ({ to, label }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className="text-[13px] font-medium pb-1 border-b transition-colors"
    style={({ isActive }) => ({
      borderColor: isActive ? 'var(--brass)' : 'transparent',
      color: isActive ? 'var(--text-1)' : 'var(--text-2)',
    })}
  >
    {label}
  </NavLink>
);

interface MobileNavTabProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const MobileNavTab: React.FC<MobileNavTabProps> = ({ to, icon, label }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className="flex-1 min-w-0 flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors"
    style={({ isActive }) => ({
      color: isActive ? 'var(--brass)' : 'var(--text-3)',
    })}
  >
    {icon}
    <span className="truncate max-w-full px-0.5">{label}</span>
  </NavLink>
);

export default Layout;
