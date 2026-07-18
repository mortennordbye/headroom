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

/** Routes surfaced inside the "Mer" sheet on mobile (everything past the 4 primary tabs).
 *  The nested routes (/pension, /employer-cost, /year) aren't listed here — they're reached
 *  via their parent's sub-tab strip. */
export const MORE_ROUTES = ['/forecast', '/bolig', '/settings'];

export interface NavItem {
  path: string;
  /** key into t.nav */
  key: 'dashboard' | 'budget' | 'assets' | 'salary' | 'forecast' | 'pension' | 'employerCost' | 'year' | 'loan' | 'settings';
  icon: React.ReactNode;
}

/** Canonical, ordered nav list — the source of truth for every route's icon + label.
 *  The top nav renders one tab per NAV_GROUP (below); NAV_ITEMS still drives the mobile
 *  "Mer" sheet and per-route label lookups. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', key: 'dashboard', icon: <LayoutDashboard size={20} strokeWidth={1.75} /> },
  { path: '/salary', key: 'salary', icon: <LineChartIcon size={20} strokeWidth={1.75} /> },
  { path: '/budget', key: 'budget', icon: <BarChart3 size={20} strokeWidth={1.75} /> },
  { path: '/assets', key: 'assets', icon: <TrendingUp size={20} strokeWidth={1.75} /> },
  { path: '/bolig', key: 'loan', icon: <Building2 size={20} strokeWidth={1.75} /> },
  { path: '/pension', key: 'pension', icon: <Briefcase size={20} strokeWidth={1.75} /> },
  { path: '/forecast', key: 'forecast', icon: <Activity size={20} strokeWidth={1.75} /> },
  { path: '/employer-cost', key: 'employerCost', icon: <Receipt size={20} strokeWidth={1.75} /> },
  { path: '/year', key: 'year', icon: <CalendarRange size={20} strokeWidth={1.75} /> },
  { path: '/settings', key: 'settings', icon: <SettingsIcon size={20} strokeWidth={1.75} /> },
];

/** A top-level nav tab that may fold sibling routes into an in-page sub-tab strip. */
export interface NavGroup {
  /** Route the top-level tab points at (the group's first child). */
  primary: string;
  /** key into t.nav for the top-level tab label. */
  key: NavItem['key'];
  /** Ordered child routes; length 1 = a plain tab with no sub-tab strip. */
  children: string[];
}

/** The 7 top-level tabs. Three small pages fold in as sub-tabs of a related parent. */
export const NAV_GROUPS: NavGroup[] = [
  { primary: '/', key: 'dashboard', children: ['/', '/year'] },
  { primary: '/salary', key: 'salary', children: ['/salary', '/employer-cost'] },
  { primary: '/budget', key: 'budget', children: ['/budget'] },
  { primary: '/assets', key: 'assets', children: ['/assets', '/pension'] },
  { primary: '/bolig', key: 'loan', children: ['/bolig'] },
  { primary: '/forecast', key: 'forecast', children: ['/forecast'] },
  { primary: '/settings', key: 'settings', children: ['/settings'] },
];

/** The group owning a route (matched against child paths), or undefined if none. */
export function groupForPath(pathname: string): NavGroup | undefined {
  return NAV_GROUPS.find(g => g.children.includes(pathname));
}

/** Label lookup for a route path, via NAV_ITEMS. */
export function navKeyForPath(pathname: string): NavItem['key'] | undefined {
  return NAV_ITEMS.find(i => i.path === pathname)?.key;
}
