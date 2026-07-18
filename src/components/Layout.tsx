import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  BarChart3,
  TrendingUp,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Menu as MenuIcon,
  X,
  HelpCircle,
  BookOpen,
  Lock,
  Pencil,
  Check,
} from 'lucide-react';
import { format, parse, subMonths, addMonths, startOfMonth, isSameMonth } from 'date-fns';
import { nb, enUS } from 'date-fns/locale';
import { useFinanceSettings } from '../context/FinanceContext';
import { useBalanceHistory } from '../hooks/useBalanceHistory';
import { useFocusTrap } from '../hooks/useFocusTrap';
import OnboardingTour from './onboarding/OnboardingTour';
import HistoryManagerModal from './HistoryManagerModal';
import GlossaryModal from './GlossaryModal';

import { NAV_ITEMS, NAV_GROUPS, MORE_ROUTES, ALWAYS_VISIBLE_NAV, groupForPath, navKeyForPath } from './navItems';
import { SegmentedControl } from './ui/SegmentedControl';

// Pages whose data is scoped to the selected month get the interactive month picker.
const MONTH_SCOPED_ROUTES = ['/', '/budget'];
// Balance pages: the same header picker drives the time machine (steps only
// through recorded snapshot months, read-only) instead of `currentMonth`.
const BALANCE_SCOPED_ROUTES = ['/assets', '/bolig', '/pension'];
// Pages with no time dimension at all hide the time marker entirely.
const HIDE_TIME_MARKER_ROUTES = ['/settings', '/year'];

const Layout: React.FC = () => {
  const { t, lang, currentMonth, setCurrentMonth, dataLoadFailed, saveFailed, justSaved, retrySave, dataReloaded, dismissDataReloaded, hiddenNavItems, demoMode, toggleDemoMode, startOnboarding } = useFinanceSettings();
  const hist = useBalanceHistory();
  const dateLocale = lang === 'nb' ? nb : enUS;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const monthSyncedRef = useRef(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  // Balance-page "edit this month": opens the History manager straight into the
  // viewed month's balances editor (past months are read-only on the page itself).
  const [editMonthOpen, setEditMonthOpen] = useState(false);
  const moreActive = MORE_ROUTES.includes(location.pathname);
  // The group owning the current route drives the active top tab and the sub-tab strip.
  const activeGroup = groupForPath(location.pathname);
  const sheetRef = useFocusTrap<HTMLDivElement>(() => setMoreOpen(false), undefined, moreOpen);

  const isVisible = (path: string) => path === ALWAYS_VISIBLE_NAV || !hiddenNavItems.includes(path);

  // One shared month control. Budget & Dashboard are always month-scoped; balance
  // pages ride the same picker but only once there's recorded history to travel to
  // (else just the static "today" marker). Settings hides it entirely.
  const isMonthScoped = MONTH_SCOPED_ROUTES.includes(location.pathname);
  const isBalanceRoute = BALANCE_SCOPED_ROUTES.includes(location.pathname);
  const showPicker = isMonthScoped || (isBalanceRoute && hist.hasHistory);
  const hideTimeMarker = HIDE_TIME_MARKER_ROUTES.includes(location.pathname);

  const today = new Date();
  const isCurrentMonth = isSameMonth(currentMonth, today);
  const isPast = currentMonth < startOfMonth(today);
  const viewKey = format(currentMonth, 'yyyy-MM');

  // Month ⇄ URL. On first mount, adopt a valid ?m=YYYY-MM so a refresh or shared
  // link lands on that month.
  useEffect(() => {
    const m = searchParams.get('m');
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      const parsed = startOfMonth(parse(m, 'yyyy-MM', new Date()));
      if (!isNaN(parsed.getTime()) && format(parsed, 'yyyy-MM') !== viewKey) {
        setCurrentMonth(parsed);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the selected month into the query string (replace, so month-stepping
  // doesn't spam history) and keep it present across route changes. The first run
  // is skipped so the mount-time read above wins any conflict.
  useEffect(() => {
    if (!monthSyncedRef.current) { monthSyncedRef.current = true; return; }
    if (searchParams.get('m') === viewKey) return;
    const next = new URLSearchParams(searchParams);
    next.set('m', viewKey);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, location.pathname]);
  // Balance pages are read-only for any non-current month, and snap the picked
  // month to the nearest recorded snapshot — surface both cues in the chip.
  const balanceReadOnly = isBalanceRoute && !hist.isLive;
  const snappedToEarlier = balanceReadOnly && hist.activeKey !== viewKey;
  const statusColor = isCurrentMonth
    ? 'var(--positive)'
    : isPast
      ? 'var(--text-3)'
      : 'var(--violet)';
  const statusBg = isCurrentMonth
    ? 'var(--positive-bg)'
    : isPast
      ? 'var(--surface-4)'
      : 'var(--violet-bg)';
  const statusLabel = isCurrentMonth
    ? t.viewingCurrent
    : isPast
      ? t.viewingPast
      : t.viewingFuture;

  return (
    <div className="min-h-[100dvh] text-[var(--text-1)] font-sans">
      {/* Skip link — first focusable element, visually hidden until focused, so a
          keyboard user can jump past the nav straight to the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-[6px] focus:text-[13px] focus:font-semibold"
        style={{ background: 'var(--brass)', color: 'var(--bg)' }}
      >
        {t.skipToContent}
      </a>
      {/* ─── Top nav ─────────────────────────── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 px-5 md:px-8 py-4 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--rule)' }}
      >
        {/* Brand — ceiling/clearance mark (a ring bisected by a hairline) + serif wordmark */}
        <div className="flex items-center gap-2.5 shrink-0 md:flex-1 md:min-w-0">
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

        {/* Underline tabs — desktop only. One tab per group; folds sibling routes into
            a sub-tab strip, so the tab stays lit while a child route is active. */}
        <nav className="hidden md:flex items-center gap-7 shrink-0">
          {NAV_GROUPS.filter(group => isVisible(group.primary)).map(group => (
            <NavButton
              key={group.primary}
              to={group.primary}
              label={t.nav[group.key]}
              active={activeGroup?.primary === group.primary}
            />
          ))}
        </nav>

        {/* Right cluster: month picker (month-scoped pages) or static "as of today" marker */}
        <div className="flex items-center gap-2 shrink-0 md:flex-1 md:min-w-0 md:justify-end">
          {/* Setup guide — desktop header (mobile uses the "More" sheet entry to
              avoid crowding the month picker). Always available so the tour can
              be (re)started with data too. */}
          <button
            onClick={() => startOnboarding('hub')}
            aria-label={t.onboarding.guide}
            title={t.onboarding.guide}
            className="hidden sm:grid place-items-center w-8 h-8 rounded-[6px] border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--brass)'; e.currentTarget.style.borderColor = 'var(--brass-dim)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <HelpCircle size={16} strokeWidth={2} />
          </button>
          {/* Glossary — persistent term lookup, desktop header (mobile: "More" sheet). */}
          <button
            onClick={() => setGlossaryOpen(true)}
            aria-label={t.glossary.open}
            title={t.glossary.open}
            className="hidden sm:grid place-items-center w-8 h-8 rounded-[6px] border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--brass)'; e.currentTarget.style.borderColor = 'var(--brass-dim)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <BookOpen size={16} strokeWidth={2} />
          </button>
          {showPicker ? (
            <>
              <div
                role="group"
                aria-label={t.monthPicker}
                onKeyDown={(e) => {
                  // Left/Right step months when focus is anywhere in the picker
                  // (e.g. on a stepper button), so it's operable without the mouse.
                  if (e.key === 'ArrowLeft') { e.preventDefault(); setCurrentMonth(subMonths(currentMonth, 1)); }
                  else if (e.key === 'ArrowRight') { e.preventDefault(); setCurrentMonth(addMonths(currentMonth, 1)); }
                }}
                className="flex items-center gap-1 rounded-[6px] border p-1 transition-colors"
                style={{
                  background: statusBg,
                  borderColor: isCurrentMonth ? 'color-mix(in srgb, var(--positive) 35%, transparent)' : 'var(--border)',
                }}
                title={balanceReadOnly ? t.timeMachine.readOnly : statusLabel}
              >
                <button
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  aria-label={t.prevMonth}
                  className="grid place-items-center w-7 h-7 rounded-[4px] transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                >
                  <ChevronLeft size={15} strokeWidth={2} />
                </button>
                <div className="flex items-center gap-1.5 px-2 min-w-[104px] justify-center">
                  {balanceReadOnly ? (
                    <Lock size={12} strokeWidth={2} style={{ color: statusColor }} aria-hidden />
                  ) : (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: statusColor }}
                      aria-hidden
                    />
                  )}
                  <span className="text-[13px] font-semibold tabular-nums">
                    {format(currentMonth, 'MMM yyyy', { locale: dateLocale })}
                  </span>
                </div>
                <button
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  aria-label={t.nextMonth}
                  className="grid place-items-center w-7 h-7 rounded-[4px] transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
                >
                  <ChevronRight size={15} strokeWidth={2} />
                </button>
              </div>
              {snappedToEarlier && (
                <span
                  className="hidden sm:inline text-[11px] font-medium tabular-nums whitespace-nowrap"
                  style={{ color: 'var(--text-3)' }}
                  title={t.timeMachine.readOnly}
                >
                  {t.timeMachine.asOf} {format(parse(hist.activeKey, 'yyyy-MM', new Date()), 'MMM yyyy', { locale: dateLocale })}
                </span>
              )}
              {balanceReadOnly && (
                <button
                  onClick={() => setEditMonthOpen(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 h-8 rounded-[6px] text-[12px] font-semibold border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-1)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                  title={t.timeMachine.editMonth}
                >
                  <Pencil size={12} strokeWidth={2} />
                  {t.timeMachine.editMonth}
                </button>
              )}
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
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
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
      <main id="main-content" tabIndex={-1} className="max-w-[1320px] mx-auto px-5 md:px-8 py-6 md:py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12 focus:outline-none">
        {/* Sub-tab strip — sibling routes folded under this group (e.g. Lønn · Lønnskostnad).
            Each sub-tab is its own route, so it keeps its own header picker / time-machine. */}
        {activeGroup && activeGroup.children.length > 1 && (
          <SegmentedControl
            className="mb-6"
            ariaLabel={t.nav[activeGroup.key]}
            items={activeGroup.children.map(path => ({
              value: path,
              to: path,
              label: t.nav[navKeyForPath(path)!],
            }))}
          />
        )}
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
        {dataReloaded && (
          <div
            className="flex items-center justify-between gap-3 mb-5 px-4 py-3 rounded-[var(--radius-md)] border text-[13px]"
            style={{ background: 'var(--warning-bg)', borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)', color: 'var(--warning)' }}
            role="status"
          >
            <span>{t.dataReloadedNotice}</span>
            <button
              onClick={dismissDataReloaded}
              className="shrink-0 px-3 h-8 rounded-[6px] text-[12px] font-semibold"
              style={{ background: 'var(--warning)', color: 'var(--bg-page)' }}
            >
              {t.dismiss}
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
            {/* Setup guide — the mobile trigger for the guided tour */}
            <button
              onClick={() => { setMoreOpen(false); startOnboarding(); }}
              className="mt-2 w-full flex items-center gap-3 px-4 py-3.5 rounded-[var(--radius-md)] text-[14px] font-medium transition-colors border"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--rule)', color: 'var(--text-1)' }}
            >
              <HelpCircle size={18} strokeWidth={1.75} />
              <span>{t.onboarding.guide}</span>
            </button>
            {/* Glossary — the mobile trigger for the term lookup */}
            <button
              onClick={() => { setMoreOpen(false); setGlossaryOpen(true); }}
              className="mt-2 w-full flex items-center gap-3 px-4 py-3.5 rounded-[var(--radius-md)] text-[14px] font-medium transition-colors border"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--rule)', color: 'var(--text-1)' }}
            >
              <BookOpen size={18} strokeWidth={1.75} />
              <span>{t.glossary.open}</span>
            </button>
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
        <MobileNavTab to="/" icon={<LayoutDashboard size={20} strokeWidth={1.75} />} label={t.nav.dashboard} active={activeGroup?.primary === '/'} />
        <MobileNavTab to="/budget" icon={<BarChart3 size={20} strokeWidth={1.75} />} label={t.nav.budget} active={activeGroup?.primary === '/budget'} />
        <MobileNavTab to="/assets" icon={<TrendingUp size={20} strokeWidth={1.75} />} label={t.nav.assets} active={activeGroup?.primary === '/assets'} />
        <MobileNavTab to="/salary" icon={<LineChartIcon size={20} strokeWidth={1.75} />} label={t.nav.salary} active={activeGroup?.primary === '/salary'} />
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

      {/* First-run guided setup (renders only when active; portals to body) */}
      <OnboardingTour />

      {/* Persistent glossary — term lookup reachable any time (header / More sheet) */}
      {glossaryOpen && <GlossaryModal onClose={() => setGlossaryOpen(false)} />}

      {/* Edit the picked (read-only) month straight from a balance page. Uses the
          picked month, not the snapped `activeKey`, so a gap/pre-earliest view
          records the month the user actually selected (pre-filled from the nearest
          snapshot) rather than editing the older month whose data is on screen. */}
      {editMonthOpen && (
        <HistoryManagerModal
          initialMonth={viewKey}
          onClose={() => setEditMonthOpen(false)}
        />
      )}

      {/* Transient "saved" tick — a subtle positive confirmation that an edit
          persisted (saves are otherwise silent; only failures raise a banner). */}
      {justSaved && (
        <div
          role="status"
          className="animate-fade-in fixed right-4 bottom-20 md:bottom-6 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-lg text-[12px] font-medium"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          <Check size={13} style={{ color: 'var(--positive)' }} />
          {t.saved}
        </div>
      )}
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
  /** Active state is driven by the owning group, so the tab stays lit on a child route. */
  active: boolean;
}

const NavButton: React.FC<NavButtonProps> = ({ to, label, active }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className="text-[13px] font-medium pb-1 border-b transition-colors"
    style={{
      borderColor: active ? 'var(--brass)' : 'transparent',
      color: active ? 'var(--text-1)' : 'var(--text-2)',
    }}
  >
    {label}
  </NavLink>
);

interface MobileNavTabProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  /** Group-driven active state, so the tab stays lit on a folded child route. */
  active: boolean;
}

const MobileNavTab: React.FC<MobileNavTabProps> = ({ to, icon, label, active }) => (
  <NavLink
    to={to}
    end={to === '/'}
    className="flex-1 min-w-0 flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors"
    style={{
      color: active ? 'var(--brass)' : 'var(--text-3)',
    }}
  >
    {icon}
    <span className="truncate max-w-full px-0.5">{label}</span>
  </NavLink>
);

export default Layout;
