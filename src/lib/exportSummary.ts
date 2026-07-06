import type { ExportPayload } from '../context/FinanceContext';

// A single line in the import/export breakdown.
// - 'count' items are collections (their length is meaningful and comparable
//   between the current data and an incoming import).
// - 'flag' items are singleton config objects that are either included or not
//   (assets, pension, loan, the whole settings bundle).
export type SummaryItemKind = 'count' | 'flag';

export interface SummaryItem {
  /** Translation key under `settings.summary`. */
  key: string;
  kind: SummaryItemKind;
  /** Present for kind === 'count'. */
  count?: number;
  /** Present for kind === 'flag'. */
  present?: boolean;
}

export interface SummarySection {
  /** Translation key under `settings.summary`. */
  key: string;
  items: SummaryItem[];
}

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const keys = (v: unknown): number =>
  v && typeof v === 'object' ? Object.keys(v as object).length : 0;

/**
 * Project an export payload into a human-facing, categorised breakdown of
 * everything it carries. The single source of truth for what the export card
 * and the import preview display, so the two never drift.
 *
 * Counts are derived defensively (missing/absent fields → 0) so the same
 * function can summarise a partial imported blob and the app's own full state.
 */
export function summarizeExport(p: Partial<ExportPayload>): SummarySection[] {
  return [
    {
      key: 'incomeWork',
      items: [
        { key: 'incomeOverrides', kind: 'count', count: keys(p.monthlyIncomes) },
        { key: 'payslips', kind: 'count', count: keys(p.payslips) },
        { key: 'jobs', kind: 'count', count: len(p.jobs) },
        { key: 'salaries', kind: 'count', count: len(p.salaries) },
        { key: 'bonuses', kind: 'count', count: len(p.bonuses) },
        { key: 'overtime', kind: 'count', count: len(p.overtime) },
        { key: 'hoursLogs', kind: 'count', count: len(p.hoursSnapshots) },
      ],
    },
    {
      key: 'budget',
      items: [
        { key: 'fixedExpenses', kind: 'count', count: len(p.fixedExpenses) },
        { key: 'transactions', kind: 'count', count: len(p.dailyTransactions) },
        { key: 'categoryBudgets', kind: 'count', count: keys(p.categoryBudgets) },
        { key: 'recurringTemplates', kind: 'count', count: len(p.recurringTemplates) },
      ],
    },
    {
      key: 'assetsDebt',
      items: [
        { key: 'debts', kind: 'count', count: len(p.debts) },
        { key: 'netWorthMonths', kind: 'count', count: keys(p.netWorthHistory) },
        { key: 'balanceSnapshots', kind: 'count', count: keys(p.balanceSnapshots) },
        { key: 'goals', kind: 'count', count: len(p.goals) },
      ],
    },
    {
      key: 'included',
      items: [
        { key: 'assets', kind: 'flag', present: p.assets != null },
        { key: 'pension', kind: 'flag', present: p.pension != null },
        { key: 'loanHousing', kind: 'flag', present: p.loan != null },
        { key: 'employerCost', kind: 'flag', present: p.employerCostConfig != null || p.billingConfig != null },
        { key: 'preferences', kind: 'flag', present: hasPreferences(p) },
      ],
    },
  ];
}

// The settings bundle is "present" if the payload carries any preference field.
function hasPreferences(p: Partial<ExportPayload>): boolean {
  return (
    p.lang != null ||
    p.region != null ||
    p.displayCurrency != null ||
    p.savingsTargetPercent != null ||
    p.growthReturnRate != null ||
    p.customTaxRatePct != null ||
    Array.isArray(p.hiddenNavItems)
  );
}

/** Total number of individual records carried by a payload (all 'count' items). */
export function totalRecords(p: Partial<ExportPayload>): number {
  return summarizeExport(p)
    .flatMap((s) => s.items)
    .reduce((sum, i) => sum + (i.kind === 'count' ? (i.count ?? 0) : 0), 0);
}
