import type { ParsedPayslip } from './types';
import { parseVismaPayslip } from './parseVismaPayslip';

export type { ParsedPayslip } from './types';
export { parsePayslipAmount } from './parsePayslipAmount';

/**
 * A payslip parser: given the extracted text lines, returns structured values
 * if it recognises the format, else null.
 */
export type PayslipParser = (lines: string[]) => ParsedPayslip | null;

export interface PayslipProvider {
  id: string;
  /** Display name shown in the import picker. */
  name: string;
  parse: PayslipParser;
}

/**
 * Supported payroll providers. Add a new payroll system here (id + name +
 * parser) and it shows up in the import picker and the auto-detect fallback —
 * no other wiring needed. The user has other employers/providers coming.
 */
export const PROVIDERS: PayslipProvider[] = [
  { id: 'visma', name: 'Visma', parse: parseVismaPayslip },
];

/**
 * Parse a payslip's text lines. When `providerId` is given, only that provider's
 * parser is tried (the user picked it); otherwise every provider is tried in
 * turn and the first that recognises the payslip wins. Returns null if none do.
 */
export function parsePayslip(lines: string[], providerId?: string): ParsedPayslip | null {
  const providers = providerId ? PROVIDERS.filter(p => p.id === providerId) : PROVIDERS;
  for (const provider of providers) {
    const result = provider.parse(lines);
    if (result) return result;
  }
  return null;
}
