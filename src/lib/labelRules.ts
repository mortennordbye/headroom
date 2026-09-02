// User-defined display names for transactions. A rule maps a merchant/text match
// to a friendly label, so a cryptic bank line (e.g. "Til:98765432101") shows as
// "Boliglån" everywhere — and every future matching transaction inherits it.
// Purely a display layer: the original `description` is preserved for matching
// and categorization. Pure + unit-tested.
import type { DailyTransaction } from '../context/FinanceContext';
import { buildMatchHaystack, normalizeMatchText } from './text';

export interface LabelRule {
  id: string;
  match: string;
  label: string;
}

/** The label of the first rule whose match is a substring of the tx, else undefined. */
export function ruleLabelFor(tx: Pick<DailyTransaction, 'merchant' | 'description'>, rules: LabelRule[]): string | undefined {
  if (!rules || !rules.length) return undefined;
  const hay = buildMatchHaystack(tx.merchant, tx.description);
  for (const r of rules) {
    const m = normalizeMatchText(r.match);
    if (m && hay.includes(m)) return r.label;
  }
  return undefined;
}

/** The name to show for a transaction: a matching custom label, else its description. */
export function txDisplayName(tx: Pick<DailyTransaction, 'merchant' | 'description'>, rules: LabelRule[]): string {
  return ruleLabelFor(tx, rules) ?? tx.description;
}
