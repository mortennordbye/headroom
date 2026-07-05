import type { ParsedPayslip } from './types';
import { parsePayslipAmount } from './parsePayslipAmount';

/**
 * Parse a Visma Payslip (visma.net) into structured values.
 *
 * Input is the text of the PDF, one entry per visual line, top-to-bottom and
 * left-to-right within a line (see extractPdfText). Pure and deterministic so
 * it can be unit-tested against a fixture of extracted lines.
 *
 * Returns null when the text doesn't look like a Visma payslip, so the provider
 * registry can fall through to another parser.
 */

/** Matches a payslip amount token, e.g. "740 000,00", "-8 095,00", "0,00". */
const AMOUNT = String.raw`-?\d[\d\s]*,\d{2}`;

function looksLikeVisma(lines: string[]): boolean {
  const hay = lines.join('\n');
  return /Lønnsslipp/i.test(hay) && (/Visma/i.test(hay) || /Lønnskjøring/i.test(hay));
}

/** First capture group of the first line matching `re`, or null. */
function firstMatch(lines: string[], re: RegExp): string | null {
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Parse a captured amount string, or null when absent/malformed. */
function amount(raw: string | null): number | null {
  if (raw == null) return null;
  const n = parsePayslipAmount(raw);
  return Number.isNaN(n) ? null : n;
}

/** "DD.MM.YYYY" → "YYYY-MM-DD", or null. */
function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "DD.MM.YYYY" → "YYYY-MM", or null. */
function toMonth(raw: string | null): string | null {
  const iso = toIsoDate(raw);
  return iso ? iso.slice(0, 7) : null;
}

/**
 * Employer name. The header wraps the name across lines with the legal-form
 * suffix ("AS", "ASA", …) on its own line, so take the first line and append a
 * nearby bare suffix token when present.
 */
function parseEmployer(lines: string[]): string {
  const base = (lines[0] ?? '').trim();
  const suffix = lines
    .slice(1, 5)
    .map(l => l.trim())
    .find(l => /^(AS|ASA|DA|ANS|BA|ENK|NUF|SA)$/.test(l));
  return suffix ? `${base} ${suffix}` : base;
}

export function parseVismaPayslip(lines: string[]): ParsedPayslip | null {
  if (!looksLikeVisma(lines)) return null;

  const num = new RegExp(String.raw`(\d+)`);

  return {
    provider: 'visma',
    period: firstMatch(lines, /Lønnskjøring\s+(\d{4}-\d{2})/),
    payDate: toIsoDate(firstMatch(lines, /Utbetalingsdato\s+(\d{2}\.\d{2}\.\d{4})/)),
    employer: parseEmployer(lines),
    jobStartMonth: toMonth(firstMatch(lines, /Startdato stilling\s+(\d{2}\.\d{2}\.\d{4})/)),
    annualSalary: amount(firstMatch(lines, new RegExp(String.raw`Årslønn\s+(${AMOUNT})`))),
    monthlySalary: amount(firstMatch(lines, new RegExp(String.raw`Månedslønn\s+(${AMOUNT})`))),
    taxPercent: (() => {
      const raw = firstMatch(lines, new RegExp(String.raw`Skatteprosent\s+${num.source}`));
      return raw == null ? null : parseInt(raw, 10);
    })(),
    positionPct: amount(firstMatch(lines, new RegExp(String.raw`Stillingsprosent\s+(${AMOUNT})`))),
    gross: amount(firstMatch(lines, new RegExp(String.raw`^Bruttolønn\s+(${AMOUNT})`))),
    net: amount(firstMatch(lines, new RegExp(String.raw`^Nettolønn\s+(${AMOUNT})`))),
    // Tax withheld prints as a negative deduction; store it positive.
    taxWithheld: (() => {
      const n = amount(firstMatch(lines, new RegExp(String.raw`^(?:Forskuddstrekk|Prosenttrekk)\s+(${AMOUNT})`)));
      return n == null ? null : Math.abs(n);
    })(),
    holidayPayThisYear: amount(firstMatch(lines, new RegExp(String.raw`Feriepenger årets\s+(${AMOUNT})`))),
  };
}
