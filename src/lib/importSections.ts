// Selective restore: partition every persisted payload key into the four
// sections the import preview already shows (matching `summarizeExport`), so a
// user can restore just some of them. The partition MUST cover every
// `PersistedKey` exactly once, or a restore would silently drop or duplicate a
// field — `importSections.test.ts` asserts exactly that against the registry.
import type { ExportPayload } from '../context/FinanceContext';
import type { PersistedKey } from './payloadRegistry';

export type ImportSectionKey = 'incomeWork' | 'budget' | 'assetsDebt' | 'included';

/** Section order shown in the UI (mirrors `summarizeExport`). */
export const IMPORT_SECTIONS: ImportSectionKey[] = ['incomeWork', 'budget', 'assetsDebt', 'included'];

// Which persisted keys each section carries. Related keys are grouped together
// (e.g. the ledger's transactions travel with their bank ids / account labels /
// category+label rules) so a partial restore never leaves a half-applied section
// — a relabelling rule without its transactions, or transactions without the
// soft-deletes that keep a re-sync from resurrecting them.
export const IMPORT_SECTION_KEYS: Record<ImportSectionKey, PersistedKey[]> = {
  incomeWork: [
    'income', 'monthlyIncomes', 'payslips',
    'jobs', 'salaries', 'bonuses', 'overtime', 'hoursSnapshots',
  ],
  budget: [
    'fixedExpenses', 'dailyTransactions', 'deletedBankIds', 'accountLabels',
    'categoryRules', 'labelRules', 'categoryBudgets', 'recurringTemplates',
  ],
  assetsDebt: [
    'debts', 'netWorthHistory', 'balanceSnapshots', 'goals',
  ],
  included: [
    'assets', 'pension', 'loan', 'housingMode', 'homeowner', 'transition',
    'employerCostConfig', 'billingConfig',
    'lang', 'savingsTargetPercent', 'growthReturnRate', 'forecastAssumptions', 'houseGrowthRate',
    'cashGrowthRate', 'cryptoGrowthRate', 'displayCurrency', 'nokToUsd',
    'customCurrencyCode', 'customCurrencyRate', 'region', 'customTaxRatePct',
    'hiddenNavItems', 'onboardingCompleted', 'assumptionsNudgeDismissed',
    'incomeReminderDismissedMonth', 'payday',
  ],
};

/**
 * Reduce an import payload to only the keys of the selected sections. Unselected
 * sections' keys are omitted entirely, so `applyPayload` (import mode, which only
 * applies keys that are present) leaves that data untouched.
 */
export function filterPayloadToSections(
  payload: Partial<ExportPayload>,
  selected: Set<ImportSectionKey>,
): Partial<ExportPayload> {
  const keep = new Set<string>();
  for (const section of IMPORT_SECTIONS) {
    if (selected.has(section)) for (const k of IMPORT_SECTION_KEYS[section]) keep.add(k);
  }
  const out: Partial<ExportPayload> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (keep.has(k)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Persisted keys a payload actually carries within a given section (for counts). */
export function sectionKeysPresent(payload: Partial<ExportPayload>, section: ImportSectionKey): PersistedKey[] {
  return IMPORT_SECTION_KEYS[section].filter(k => payload[k] !== undefined);
}
