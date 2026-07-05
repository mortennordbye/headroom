/**
 * Parse a Norwegian payslip money amount into a number.
 *
 * Payslips print amounts as "61 666,67", "740 000,00", "-36 994,31", "0,00" —
 * space-grouped thousands (regular space, non-breaking space, or thin space,
 * depending on how the PDF text extractor emits them) with a comma decimal and
 * a leading minus for deductions.
 *
 * This is deliberately separate from `parseLocaleNumber` (validators.ts), which
 * only handles the comma and rejects the thousands spaces.
 *
 * Returns NaN when the string isn't a well-formed amount.
 */
export function parsePayslipAmount(s: string): number {
  const cleaned = s
    // Strip every space-like grouping char. JS's \s covers ASCII space, NBSP,
    // thin space and narrow no-break space — all of which a PDF text extractor
    // may emit as the thousands separator.
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return parseFloat(cleaned);
}
