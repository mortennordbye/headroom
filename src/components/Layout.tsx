import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
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
} from 'lucide-react';
import { format, subMonths, addMonths, startOfMonth, isSameMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinance } from '../context/FinanceContext';

const Layout: React.FC = () => {
  const { t, lang, currentMonth, setCurrentMonth } = useFinance();
  const dateLocale = lang === 'nb' ? nb : enUS;

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
      <main className="max-w-[1320px] mx-auto px-5 md:px-8 py-6 md:py-8 pb-24 md:pb-12">
        <Outlet />
      </main>

      {/* ─── Mobile bottom nav ───────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex overflow-x-auto no-scrollbar border-t backdrop-blur-xl"
        style={{
          background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
          borderColor: 'var(--border)',
        }}
      >
        <MobileNavTab to="/overview" icon={<LayoutDashboard size={18} strokeWidth={1.75} />} label={t.nav.dashboard} />
        <MobileNavTab to="/" icon={<BarChart3 size={18} strokeWidth={1.75} />} label={t.nav.budget} />
        <MobileNavTab to="/assets" icon={<TrendingUp size={18} strokeWidth={1.75} />} label={t.nav.assets} />
        <MobileNavTab to="/salary" icon={<LineChartIcon size={18} strokeWidth={1.75} />} label={t.nav.salary} />
        <MobileNavTab to="/forecast" icon={<Activity size={18} strokeWidth={1.75} />} label={t.nav.forecast} />
        <MobileNavTab to="/pension" icon={<Briefcase size={18} strokeWidth={1.75} />} label={t.nav.pension} />
        <MobileNavTab to="/loan" icon={<Building2 size={18} strokeWidth={1.75} />} label={t.nav.loan} />
        <MobileNavTab to="/settings" icon={<SettingsIcon size={18} strokeWidth={1.75} />} label={t.nav.settings} />
      </nav>
    </div>
  );
};

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
    className="shrink-0 min-w-[68px] flex flex-col items-center gap-1 py-2.5 pb-3 text-[10px] font-medium transition-colors"
    style={({ isActive }) => ({
      color: isActive ? 'var(--accent)' : 'var(--text-3)',
    })}
  >
    {icon}
    <span>{label}</span>
  </NavLink>
);

export default Layout;
