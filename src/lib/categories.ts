// Canonical transaction categories. This is the shared vocabulary the
// auto-categorizer (categorize.ts), the budget charts, and the category
// dashboard all speak. A row's `category` field holds one of these keys for
// auto/known rows; free-text legacy or custom labels are still tolerated
// downstream (rendered with a fallback colour + the raw string).
//
// Colours are concrete hex from the restrained "old-money" palette used across
// the budget charts (Recharts sets these as SVG attributes, which do not
// resolve CSS var()). The palette is deliberately small — identity is carried
// primarily by the icon + label, colour is a secondary accent.
import {
  ShoppingCart, Utensils, Car, HeartPulse, Clapperboard, ShoppingBag,
  Zap, Repeat, Home, ArrowLeftRight, TrendingUp, Circle, type LucideIcon,
} from 'lucide-react';

export type CategoryKey =
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'health'
  | 'entertainment'
  | 'shopping'
  | 'utilities'
  | 'subscriptions'
  | 'housing'
  | 'transfers'
  | 'income'
  | 'other';

export interface CategoryMeta {
  key: CategoryKey;
  color: string;   // concrete hex from the chart palette
  icon: LucideIcon;
}

// Ordered for stable display (dashboards, legends). `other` last.
export const CATEGORIES: CategoryMeta[] = [
  { key: 'groceries',     color: '#1F5A42', icon: ShoppingCart },   // forest
  { key: 'dining',        color: '#B5533A', icon: Utensils },       // rust
  { key: 'transport',     color: '#5B7280', icon: Car },            // slate
  { key: 'health',        color: '#3F7373', icon: HeartPulse },     // teal
  { key: 'entertainment', color: '#7FCBA0', icon: Clapperboard },   // forest-light
  { key: 'shopping',      color: '#B5533A', icon: ShoppingBag },    // rust
  { key: 'utilities',     color: '#5B7280', icon: Zap },            // slate
  { key: 'subscriptions', color: '#3F7373', icon: Repeat },         // teal
  { key: 'housing',       color: '#1F5A42', icon: Home },           // forest
  { key: 'transfers',     color: '#5F6555', icon: ArrowLeftRight }, // text-dim
  { key: 'income',        color: '#7FCBA0', icon: TrendingUp },     // forest-light
  { key: 'other',         color: '#5F6555', icon: Circle },         // text-dim
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function isCategoryKey(value: string | undefined): value is CategoryKey {
  return value != null && BY_KEY.has(value as CategoryKey);
}

/** Metadata for a canonical key, or undefined for legacy/custom free-text. */
export function categoryMeta(key: string | undefined): CategoryMeta | undefined {
  return key == null ? undefined : BY_KEY.get(key as CategoryKey);
}
