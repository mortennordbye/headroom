import {
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  LineChart as LineChartIcon,
  Activity,
  Briefcase,
  Receipt,
  Building2,
  CalendarRange,
  Settings as SettingsIcon,
} from 'lucide-react';

/** Settings is always shown so there's always a way back to the visibility toggles. */
export const ALWAYS_VISIBLE_NAV = '/settings';

/** Routes surfaced inside the "Mer" sheet on mobile (everything past the 4 primary tabs). */
export const MORE_ROUTES = ['/forecast', '/pension', '/employer-cost', '/year', '/loan', '/settings'];

export interface NavItem {
  path: string;
  /** key into t.nav */
  key: 'dashboard' | 'budget' | 'assets' | 'salary' | 'forecast' | 'pension' | 'employerCost' | 'year' | 'loan' | 'settings';
  icon: React.ReactNode;
}

/** Canonical, ordered nav list — drives the desktop pills and the mobile "Mer" sheet. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', key: 'dashboard', icon: <LayoutDashboard size={20} strokeWidth={1.75} /> },
  { path: '/salary', key: 'salary', icon: <LineChartIcon size={20} strokeWidth={1.75} /> },
  { path: '/budget', key: 'budget', icon: <BarChart3 size={20} strokeWidth={1.75} /> },
  { path: '/assets', key: 'assets', icon: <TrendingUp size={20} strokeWidth={1.75} /> },
  { path: '/loan', key: 'loan', icon: <Building2 size={20} strokeWidth={1.75} /> },
  { path: '/pension', key: 'pension', icon: <Briefcase size={20} strokeWidth={1.75} /> },
  { path: '/forecast', key: 'forecast', icon: <Activity size={20} strokeWidth={1.75} /> },
  { path: '/employer-cost', key: 'employerCost', icon: <Receipt size={20} strokeWidth={1.75} /> },
  { path: '/year', key: 'year', icon: <CalendarRange size={20} strokeWidth={1.75} /> },
  { path: '/settings', key: 'settings', icon: <SettingsIcon size={20} strokeWidth={1.75} /> },
];
