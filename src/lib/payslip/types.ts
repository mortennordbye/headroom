/**
 * Structured values extracted from a payslip PDF.
 *
 * The parser fills in every headline field it can find, even though v1 of the
 * importer only *writes* `annualSalary` to the salary tracker. The extra fields
 * (gross, net, tax, holiday pay) are shown read-only in the review UI as a
 * confidence check and are the seam for wiring more writers later — see
 * PayslipImportModal.
 *
 * A field is `null` when the payslip didn't contain it (or it couldn't be
 * parsed). Never NaN — callers can treat null as "not present".
 */
export interface ParsedPayslip {
  provider: 'visma';
  /** Payroll period, 'YYYY-MM' (Visma: "Lønnskjøring"). */
  period: string | null;
  /** Payment date, 'YYYY-MM-DD' (Visma: "Utbetalingsdato"). */
  payDate: string | null;
  /** Employer name — best-effort, editable in the review UI. */
  employer: string;
  /** When the position started, 'YYYY-MM' (Visma: "Startdato stilling"). */
  jobStartMonth: string | null;
  /** Annual gross salary — the only value v1 writes (Visma: "Årslønn"). */
  annualSalary: number | null;
  /** Monthly gross salary (Visma: "Månedslønn"). */
  monthlySalary: number | null;
  /** Withholding-tax percentage (Visma: "Skatteprosent"). */
  taxPercent: number | null;
  /** Position percentage, e.g. 100 (Visma: "Stillingsprosent"). */
  positionPct: number | null;
  /** Gross pay for the period (Visma: "Bruttolønn"). */
  gross: number | null;
  /** Net pay for the period (Visma: "Nettolønn"). */
  net: number | null;
  /** Tax withheld this period, positive NOK (Visma: "Forskuddstrekk"/"Prosenttrekk"). */
  taxWithheld: number | null;
  /** Holiday pay accrued this year, period column (Visma: "Feriepenger årets"). */
  holidayPayThisYear: number | null;
}
