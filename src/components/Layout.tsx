import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Building2,
  LayoutDashboard,
  Settings as SettingsIcon,
  Check,
  LineChart as LineChartIcon,
  Activity,
  Briefcase,
  Menu as MenuIcon,
  X,
} from 'lucide-react';
import { format, subMonths, addMonths, startOfMonth, isSameMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';

/** Routes surfaced inside the "Mer" sheet on mobile (everything past the 4 primary tabs). */
const MORE_ROUTES = ['/forecast', '/pension', '/loan', '/settings'];

const Layout: React.FC = () => {
  const { t, lang, currentMonth, setCurrentMonth } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ROUTES.includes(location.pathname);

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
    <div className="min-h-screen text-[var(--text-1)] font-sans">
      {/* ─── Top nav ─────────────────────────── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 px-5 md:px-8 py-4 backdrop-blur-xl"
        style={{ background: 'color-mix(in srgb, var(--bg-page) 75%, transparent)' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <span
            className="grid place-items-center w-7 h-7 rounded-[8px]"
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--violet))',
              boxShadow: '0 4px 14px color-mix(in srgb, var(--violet) 40%, transparent)',
            }}
            aria-hidden
          >
            <Check size={14} strokeWidth={3} style={{ color: 'var(--bg-page)' }} />
          </span>
          <span className="text-[20px] font-bold tracking-[-0.02em]">{t.title}</span>
        </div>

        {/* Pill tabs — desktop only */}
        <nav
          className="hidden md:flex items-center gap-1.5 p-1 rounded-full border"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}
        >
          <NavButton to="/overview" label={t.nav.dashboard} />
          <NavButton to="/" label={t.nav.budget} />
          <NavButton to="/assets" label={t.nav.assets} />
          <NavButton to="/salary" label={t.nav.salary} />
          <NavButton to="/forecast" label={t.nav.forecast} />
          <NavButton to="/pension" label={t.nav.pension} />
          <NavButton to="/loan" label={t.nav.loan} />
          <NavButton to="/settings" label={t.nav.settings} />
        </nav>

        {/* Right cluster: month picker */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="flex items-center gap-1 rounded-full border p-1 transition-colors"
            style={{
              background: statusBg,
              borderColor: isCurrentMonth ? 'color-mix(in srgb, var(--positive) 35%, transparent)' : 'var(--border)',
            }}
            title={statusLabel}
          >
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              aria-label="Previous month"
              className="grid place-items-center w-7 h-7 rounded-full transition-colors"
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
              className="grid place-items-center w-7 h-7 rounded-full transition-colors"
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
              className="hidden sm:inline-flex items-center px-3 h-8 rounded-full text-[12px] font-semibold transition-colors"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-bg)'; }}
              title={t.today}
            >
              {t.today}
            </button>
          )}
        </div>
      </header>

      {/* ─── Main ────────────────────────────── */}
      <main className="max-w-[1320px] mx-auto px-5 md:px-8 py-6 md:py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12">
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
                aria-label="Close"
                className="grid place-items-center w-8 h-8 rounded-full"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-2)' }}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <SheetItem to="/forecast" icon={<Activity size={20} strokeWidth={1.75} />} label={t.nav.forecast} onNavigate={() => setMoreOpen(false)} />
              <SheetItem to="/pension" icon={<Briefcase size={20} strokeWidth={1.75} />} label={t.nav.pension} onNavigate={() => setMoreOpen(false)} />
              <SheetItem to="/loan" icon={<Building2 size={20} strokeWidth={1.75} />} label={t.nav.loan} onNavigate={() => setMoreOpen(false)} />
              <SheetItem to="/settings" icon={<SettingsIcon size={20} strokeWidth={1.75} />} label={t.nav.settings} onNavigate={() => setMoreOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* ─── Mobile bottom nav ───────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex border-t backdrop-blur-xl pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
        style={{
          background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
          borderColor: 'var(--border)',
        }}
      >
        <MobileNavTab to="/overview" icon={<LayoutDashboard size={20} strokeWidth={1.75} />} label={t.nav.dashboard} />
        <MobileNavTab to="/" icon={<BarChart3 size={20} strokeWidth={1.75} />} label={t.nav.budget} />
        <MobileNavTab to="/assets" icon={<TrendingUp size={20} strokeWidth={1.75} />} label={t.nav.assets} />
        <MobileNavTab to="/salary" icon={<LineChartIcon size={20} strokeWidth={1.75} />} label={t.nav.salary} />
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 min-w-0 flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors"
          style={{ color: moreActive ? 'var(--accent)' : 'var(--text-3)' }}
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
    className="flex items-center gap-3 px-4 py-3.5 rounded-[var(--radius-md)] text-[14px] font-medium transition-colors"
    style={({ isActive }) => ({
      background: isActive ? 'var(--accent-bg)' : 'rgba(255,255,255,0.04)',
      color: isActive ? 'var(--accent)' : 'var(--text-1)',
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
    className={({ isActive }) =>
      `text-[13px] font-medium px-4 py-2 rounded-full transition-colors ${
        isActive ? 'font-semibold' : ''
      }`
    }
    style={({ isActive }) => ({
      background: isActive ? 'var(--text-1)' : 'transparent',
      color: isActive ? 'var(--bg-page)' : 'var(--text-2)',
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
      color: isActive ? 'var(--accent)' : 'var(--text-3)',
    })}
  >
    {icon}
    <span className="truncate max-w-full px-0.5">{label}</span>
  </NavLink>
);

export default Layout;
