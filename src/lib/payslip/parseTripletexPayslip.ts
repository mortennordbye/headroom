import type { ParsedPayslip } from './types';
import { parsePayslipAmount } from './parsePayslipAmount';

/**
 * Parse a Tripletex payslip ("Lønnsslipp for <måned> <år>") into structured values.
 *
 * Input is the text of the PDF, one entry per visual line (see extractPdfText).
 * The page has a period section (pay lines, tax, reimbursements) followed by a
 * "Totalt i <år>" year-to-date section that repeats the same labels, so every
 * period figure is read from the lines before that heading.
 *
 * Returns null when the text doesn't look like a Tripletex payslip, so the
 * provider registry can fall through to another parser.
 */

/**
 * One payslip amount token, e.g. "62 500,00", "-25 650,00". Thousands groups
 * are strictly three digits and the token can't start mid-number, so a column
 * value next to it ("2026 62 500,00") isn't bridged into the amount.
 */
const DIGITS = String.raw`\d{1,3}(?: \d{3})*,\d{2}(?!\d)`;
const AMOUNT = String.raw`(?<![\d,])-?${DIGITS}`;

const MONTHS: Record<string, string> = {
  januar: '01', februar: '02', mars: '03', april: '04', mai: '05', juni: '06',
  juli: '07', august: '08', september: '09', oktober: '10', november: '11', desember: '12',
};

function looksLikeTripletex(lines: string[]): boolean {
  const hay = lines.join('\n');
  return /Lønnsslipp for/.test(hay) && /Lønnsbilag:/.test(hay);
}

/** Parse an amount string, or null when absent/malformed. */
function amount(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = parsePayslipAmount(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Employer name. The first line holds the employee name (left column) and the
 * employer's registered name (right column) joined by a space; Tripletex prints
 * the registered name in capitals, so take the trailing all-caps run ending in
 * a legal-form suffix. Falls back to the whole line (editable in review).
 */
function parseEmployer(line: string): string {
  const m = /((?:[^\s\p{Ll}]+\s+)*(?:AS|ASA|DA|ANS|BA|ENK|NUF|SA))$/u.exec(line);
  return m && m[1].includes(' ') ? m[1] : line;
}

export function parseTripletexPayslip(lines: string[]): ParsedPayslip | null {
  if (!looksLikeTripletex(lines)) return null;

  const ytdStart = lines.findIndex(l => /^Totalt i \d{4}$/.test(l));
  const period = ytdStart === -1 ? lines : lines.slice(0, ytdStart);
  const text = period.join(' ');

  // Header row under "Lønnsslipp for / Utbetalingsdato / Til utbetaling".
  const header = new RegExp(String.raw`^(\p{L}+) (\d{4}) (\d{2})\.(\d{2})\.(\d{4}) (${AMOUNT})$`, 'u');
  const h = period.map(l => header.exec(l)).find(m => m && MONTHS[m[1].toLowerCase()]);

  const fixed = period
    .map(l => new RegExp(String.raw`^Fastlønn\b.*?(${AMOUNT})$`).exec(l))
    .find(Boolean);

  // Tax line: "Skattetrekk Grunnlag prosenttrekk (38,0%): -25 650,00 67 500,00."
  // The description (ending in the base and a full stop) wraps onto the next
  // line when it's long, so match against the joined text in either order.
  const tax = new RegExp(String.raw`Skattetrekk\b.*?(?<![\d,])(-${DIGITS})`).exec(text);
  const base = new RegExp(String.raw`Grunnlag \p{L}*trekk[^:]*:\s*(?:${AMOUNT}\s+)?(${AMOUNT})\.`, 'u').exec(text);
  const pct = /Grunnlag prosenttrekk \((\d+(?:,\d+)?)%\)/.exec(text);

  const taxWithheld = amount(tax?.[1]);

  return {
    provider: 'tripletex',
    period: h ? `${h[2]}-${MONTHS[h[1].toLowerCase()]}` : null,
    payDate: h ? `${h[5]}-${h[4]}-${h[3]}` : null,
    employer: parseEmployer(lines[0] ?? ''),
    jobStartMonth: null,
    annualSalary: null,
    monthlySalary: amount(fixed?.[1]),
    taxPercent: pct ? parseFloat(pct[1].replace(',', '.')) : null,
    positionPct: null,
    // The slip has no gross line; the tax base is the period's taxable pay.
    gross: amount(base?.[1]),
    // What's paid to the account, including any expense reimbursements.
    net: amount(h?.[6]),
    taxWithheld: taxWithheld == null ? null : Math.abs(taxWithheld),
    // Only a year-to-date holiday-pay figure is printed, not the period's.
    holidayPayThisYear: null,
  };
}
