/**
 * Catalog + pure helpers for the guided setup. This is a *hub*, not a linear
 * wizard: topics are grouped and the user picks any one in any order. Each topic
 * knows which route to show, which section to highlight, and (for fill topics)
 * which fields to render. The React shell (`OnboardingTour.tsx`) owns the hub UI,
 * navigation and highlighting; everything data-shaped lives here so it can be
 * unit-tested without a DOM.
 *
 * Field `writer` tells the shell how to persist a value; `key` is the argument
 * (an Assets/Pension key, or a sentinel for the special writers).
 */

export type OnboardingWriter = 'lang' | 'region' | 'income' | 'savingsTarget' | 'asset' | 'pension' | 'growthRate';

export type OnboardingGroup = 'essentials' | 'wealth' | 'learn';

/** 'fill' topics collect data in the panel; 'learn' topics just explain a screen. */
export type OnboardingKind = 'fill' | 'learn';

export interface OnboardingFieldOption {
  value: string;
  /** Key under `t.onboarding.options`. */
  labelKey: string;
}

export interface OnboardingField {
  /** Argument for the writer (Assets/Pension key, or a sentinel). */
  key: string;
  writer: OnboardingWriter;
  /** Key under `t.onboarding.fields`. */
  labelKey: string;
  kind: 'number' | 'percent' | 'select';
  /** Allow negative input (e.g. an unrealized loss). Defaults to false. */
  allowNegative?: boolean;
  /** A field that already has a sensible default and rarely needs changing (tax
   *  rates, return assumptions, …). The shell tucks these behind an "advanced"
   *  toggle so the must-fill values stand alone. */
  advanced?: boolean;
  /** Present only for `kind: 'select'`. */
  options?: OnboardingFieldOption[];
}

export interface OnboardingTopic {
  /** Stable id; also the key under `t.onboarding.topics`. */
  id: string;
  group: OnboardingGroup;
  kind: OnboardingKind;
  /** Route to show behind the panel while this topic is open. */
  route: string;
  /** `data-tour` value of the section to highlight, or null for no highlight. */
  target: string | null;
  /** When true, the shell blocks Next until the step is satisfied (the merged
   *  flow forces the core inputs; everything else is skippable). */
  required?: boolean;
  fields: OnboardingField[];
}

const LANG_OPTIONS: OnboardingFieldOption[] = [
  { value: 'nb', labelKey: 'norwegian' },
  { value: 'en', labelKey: 'english' },
];

const REGION_OPTIONS: OnboardingFieldOption[] = [
  { value: 'no', labelKey: 'regionNo' },
  { value: 'generic', labelKey: 'regionGeneric' },
];

/** Display order of the groups in the hub. */
export const ONBOARDING_GROUPS: OnboardingGroup[] = ['essentials', 'wealth', 'learn'];

/**
 * The full topic catalog. "Fill" topics gather scalar inputs; list-shaped areas
 * (fixed expenses, debts) and whole screens are "learn" topics — explained in
 * place, edited on the page itself.
 */
export const ONBOARDING_TOPICS: OnboardingTopic[] = [
  // ── Essentials ──────────────────────────────────────────────
  {
    id: 'prefs',
    group: 'essentials',
    kind: 'fill',
    route: '/budget',
    target: null,
    required: true,
    fields: [
      { key: 'lang', writer: 'lang', labelKey: 'language', kind: 'select', options: LANG_OPTIONS },
      { key: 'region', writer: 'region', labelKey: 'region', kind: 'select', options: REGION_OPTIONS },
    ],
  },
  {
    // Required: the current job + yearly gross salary. A "learn"-shaped topic
    // (custom form in JobSalaryAdder) placed before income so the income step
    // shows the net figure derived from this salary. Gated as required in the
    // shell — Next stays disabled until a current job with a salary exists.
    id: 'job',
    group: 'essentials',
    kind: 'learn',
    route: '/salary',
    target: 'salary-overview',
    required: true,
    fields: [],
  },
  {
    id: 'income',
    group: 'essentials',
    kind: 'fill',
    route: '/budget',
    target: 'income',
    required: true,
    fields: [{ key: 'income', writer: 'income', labelKey: 'income', kind: 'number' }],
  },
  {
    // The savings target renders a custom control (percent OR kr) in the shell,
    // so it carries no declarative field — hence "learn"-shaped with no fields.
    id: 'savingsTarget',
    group: 'essentials',
    kind: 'learn',
    route: '/budget',
    target: 'budget-plan',
    required: true,
    fields: [],
  },
  {
    id: 'fixedExpenses',
    group: 'essentials',
    kind: 'learn',
    route: '/budget',
    target: 'fixed-expenses',
    fields: [],
  },

  // ── Wealth ──────────────────────────────────────────────────
  {
    id: 'cash',
    group: 'wealth',
    kind: 'fill',
    route: '/assets',
    target: 'cash-reserves',
    // Savings accounts (a list) are edited by the custom SavingsAccountsAdder in
    // the shell; buffer and BSU are plain scalar asset fields.
    fields: [
      { key: 'bufferAccount', writer: 'asset', labelKey: 'bufferAccount', kind: 'number' },
      { key: 'bsu', writer: 'asset', labelKey: 'bsu', kind: 'number' },
    ],
  },
  {
    id: 'home',
    group: 'wealth',
    kind: 'fill',
    route: '/assets',
    target: 'real-estate',
    fields: [
      { key: 'houseValue', writer: 'asset', labelKey: 'houseValue', kind: 'number' },
      { key: 'houseDebt', writer: 'asset', labelKey: 'houseDebt', kind: 'number' },
    ],
  },
  {
    id: 'stocks',
    group: 'wealth',
    kind: 'fill',
    route: '/assets',
    target: 'market-positions',
    fields: [
      { key: 'portfolio', writer: 'asset', labelKey: 'portfolio', kind: 'number' },
      { key: 'unrealizedGain', writer: 'asset', labelKey: 'unrealizedGain', kind: 'number', allowNegative: true },
      { key: 'taxRate', writer: 'asset', labelKey: 'taxRate', kind: 'percent', advanced: true },
    ],
  },
  {
    id: 'crypto',
    group: 'wealth',
    kind: 'fill',
    route: '/assets',
    target: 'crypto',
    fields: [
      { key: 'crypto', writer: 'asset', labelKey: 'crypto', kind: 'number' },
      { key: 'cryptoUnrealizedGain', writer: 'asset', labelKey: 'cryptoUnrealizedGain', kind: 'number', allowNegative: true },
      { key: 'cryptoTaxRate', writer: 'asset', labelKey: 'cryptoTaxRate', kind: 'percent', advanced: true },
    ],
  },
  {
    id: 'pension',
    group: 'wealth',
    kind: 'fill',
    route: '/assets',
    target: 'pension',
    fields: [
      { key: 'otpBalance', writer: 'pension', labelKey: 'otpBalance', kind: 'number' },
      { key: 'ipsBalance', writer: 'pension', labelKey: 'ipsBalance', kind: 'number' },
      { key: 'ipsAnnualContribution', writer: 'pension', labelKey: 'ipsAnnualContribution', kind: 'number', advanced: true },
      { key: 'otpEmployerPct', writer: 'pension', labelKey: 'otpEmployerPct', kind: 'percent', advanced: true },
      { key: 'otpEmployeePct', writer: 'pension', labelKey: 'otpEmployeePct', kind: 'percent', advanced: true },
      { key: 'otpGrowthRate', writer: 'pension', labelKey: 'otpGrowthRate', kind: 'percent', advanced: true },
      { key: 'ipsGrowthRate', writer: 'pension', labelKey: 'ipsGrowthRate', kind: 'percent', advanced: true },
      { key: 'birthYear', writer: 'pension', labelKey: 'birthYear', kind: 'number', advanced: true },
      { key: 'retirementAge', writer: 'pension', labelKey: 'retirementAge', kind: 'number', advanced: true },
    ],
  },
  {
    id: 'debt',
    group: 'wealth',
    kind: 'learn',
    route: '/assets',
    target: 'debt',
    fields: [],
  },
  {
    id: 'growth',
    group: 'wealth',
    kind: 'fill',
    route: '/assets',
    target: 'growth-projection',
    fields: [
      { key: 'growthReturnRate', writer: 'growthRate', labelKey: 'growthReturnRate', kind: 'percent', advanced: true },
      { key: 'houseGrowthRate', writer: 'growthRate', labelKey: 'houseGrowthRate', kind: 'percent', advanced: true },
      { key: 'cashGrowthRate', writer: 'growthRate', labelKey: 'cashGrowthRate', kind: 'percent', advanced: true },
      { key: 'cryptoGrowthRate', writer: 'growthRate', labelKey: 'cryptoGrowthRate', kind: 'percent', advanced: true },
    ],
  },

  // ── Understand the app ──────────────────────────────────────
  { id: 'dashboard', group: 'learn', kind: 'learn', route: '/', target: 'dashboard-hero', fields: [] },
  { id: 'salary', group: 'learn', kind: 'learn', route: '/salary', target: 'salary-overview', fields: [] },
  { id: 'forecast', group: 'learn', kind: 'learn', route: '/forecast', target: 'forecast-hero', fields: [] },
  { id: 'loan', group: 'learn', kind: 'learn', route: '/loan', target: 'loan-hero', fields: [] },
  { id: 'settings', group: 'learn', kind: 'learn', route: '/settings', target: 'settings-all', fields: [] },
];

export const ONBOARDING_TOPIC_COUNT = ONBOARDING_TOPICS.length;

export function topicsInGroup(group: OnboardingGroup): OnboardingTopic[] {
  return ONBOARDING_TOPICS.filter(topic => topic.group === group);
}

export function topicById(id: string): OnboardingTopic | undefined {
  return ONBOARDING_TOPICS.find(topic => topic.id === id);
}

/** Index of a topic in the flat catalog, or -1. */
export function topicIndex(id: string): number {
  return ONBOARDING_TOPICS.findIndex(topic => topic.id === id);
}

/** The topic after `id` in catalog order, wrapping to null at the end. */
export function nextTopic(id: string): OnboardingTopic | null {
  const i = topicIndex(id);
  if (i < 0 || i >= ONBOARDING_TOPICS.length - 1) return null;
  return ONBOARDING_TOPICS[i + 1];
}
