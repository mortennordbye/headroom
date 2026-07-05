import { describe, it, expect } from 'vitest';
import { parsePayslipAmount } from './parsePayslipAmount';
import { parseVismaPayslip } from './parseVismaPayslip';
import { parsePayslip } from './index';

// Text lines extracted from a real Visma payslip (payslip-3.pdf) via pdfjs,
// grouped top-to-bottom / left-to-right. The PDF itself is never stored — this
// fixture is the parser's contract.
const VISMA_LINES: string[] = [
  'Orange Business Digital Norway',
  'Lønnsslipp',
  'AS',
  'Org.nr. 982211743',
  'Lønnskjøring 2026-06',
  'Lørenfaret 1E, 0585 OSLO',
  'Månedslønn',
  'Utbetalingsdato 19.06.2026',
  'Fødselsdato 18.08.2003',
  'Fødselsnummer 18080396569',
  'Morten Victor Nordbye',
  'Ansattnummer 799',
  'Brekkelia 3D',
  '0882 Oslo',
  'Startdato stilling 16.08.2021 Skatteprosent 21 Årslønn 740 000,00',
  'Stillingsprosent 100,00 Månedslønn 61 666,67',
  'Timesats 379,49',
  'Overtidssats 379,49',
  'S Beskrivelse Antall Sats Beløp Hittil i år',
  '1 Fastlønn 61 666,67 61 666,67 370 000,02',
  '1 On-Call support 24/7 108,00 75,90 8 196,98 54 874,24',
  '1 On-Call support 24/7 Public Holiday 24,00 151,80 3 643,10 3 643,10',
  '1 On-Call service 8,50 145,00 1 232,50 70 615,00',
  '1 Feriepenger, fjoråret 37 353,45 37 353,45',
  '1 Trekk i lønn for ferie -36 994,31 -36 994,31',
  '1 Kollektive forsikringer 803,92 4 823,52',
  'Bruttolønn 75 902,31',
  'Prosenttrekk -8 095,00 -42 472,00',
  'Nettolønn 67 003,39',
  'Andre trekk Bankkonto Beløp',
  '0,00',
  'Netto til utbetaling Bankkonto Beløp',
  'Morten Victor Nordbye 90461303489 67 003,39',
  '67 003,39',
  'Beskrivelse Totalt for Akkumulert totalt Beskrivelse Totalt for Akkumulert totalt',
  'perioden perioden',
  'Bruttolønn 75 902,31 522 530,55 Feriepengegrunnlag 37 744,94 480 353,58',
  'Forskuddstrekk -8 095,00 -140 572,00 Feriepenger årets 4 529,39 57 642,43',
  'Balanse negativ lønn 0,00 0,00 Feriepenger, fjoråret -37 353,45 0,00',
  'Fagforeningstrekk 0,00 0,00 Grunnlag tabelltrekk 38 548,86 485 177,10',
  'Grunnlag prosenttrekk 0,00 0,00',
  'Copyright © Visma',
  'Side:1/1',
];

describe('parsePayslipAmount', () => {
  it('parses space-grouped thousands with comma decimal', () => {
    expect(parsePayslipAmount('740 000,00')).toBe(740000);
    expect(parsePayslipAmount('61 666,67')).toBeCloseTo(61666.67, 2);
    expect(parsePayslipAmount('0,00')).toBe(0);
  });

  it('parses non-breaking and thin spaces as separators', () => {
    expect(parsePayslipAmount('740 000,00')).toBe(740000);
    expect(parsePayslipAmount('8 196,98')).toBeCloseTo(8196.98, 2);
  });

  it('keeps the leading minus for deductions', () => {
    expect(parsePayslipAmount('-8 095,00')).toBe(-8095);
    expect(parsePayslipAmount('-36 994,31')).toBeCloseTo(-36994.31, 2);
  });

  it('returns NaN for non-amounts', () => {
    expect(parsePayslipAmount('')).toBeNaN();
    expect(parsePayslipAmount('abc')).toBeNaN();
    expect(parsePayslipAmount('12,3,4')).toBeNaN();
  });
});

describe('parseVismaPayslip', () => {
  const p = parseVismaPayslip(VISMA_LINES)!;

  it('recognises the payslip and reports the provider', () => {
    expect(p).not.toBeNull();
    expect(p.provider).toBe('visma');
  });

  it('extracts the period and payment date', () => {
    expect(p.period).toBe('2026-06');
    expect(p.payDate).toBe('2026-06-19');
  });

  it('reconstructs the employer name across the wrapped header', () => {
    expect(p.employer).toBe('Orange Business Digital Norway AS');
  });

  it('extracts the annual salary — the value v1 imports', () => {
    expect(p.annualSalary).toBe(740000);
  });

  it('extracts the monthly salary, not the standalone header token', () => {
    expect(p.monthlySalary).toBeCloseTo(61666.67, 2);
  });

  it('extracts tax percent and position percent', () => {
    expect(p.taxPercent).toBe(21);
    expect(p.positionPct).toBe(100);
  });

  it('extracts the job start month', () => {
    expect(p.jobStartMonth).toBe('2021-08');
  });

  it('extracts gross and net for the period', () => {
    expect(p.gross).toBeCloseTo(75902.31, 2);
    expect(p.net).toBeCloseTo(67003.39, 2);
  });

  it('stores tax withheld as a positive number', () => {
    expect(p.taxWithheld).toBeCloseTo(8095, 2);
  });

  it('extracts holiday pay accrued this year', () => {
    expect(p.holidayPayThisYear).toBeCloseTo(4529.39, 2);
  });

  it('returns null for non-Visma text', () => {
    expect(parseVismaPayslip(['Some random PDF', 'Invoice #42', 'Total 100,00'])).toBeNull();
  });
});

describe('parsePayslip (registry)', () => {
  it('routes a Visma payslip to the Visma parser', () => {
    const p = parsePayslip(VISMA_LINES);
    expect(p?.provider).toBe('visma');
    expect(p?.annualSalary).toBe(740000);
  });

  it('returns null when no parser recognises the text', () => {
    expect(parsePayslip(['not', 'a', 'payslip'])).toBeNull();
  });

  it('honours an explicit provider id', () => {
    expect(parsePayslip(VISMA_LINES, 'visma')?.annualSalary).toBe(740000);
    // A provider that doesn't exist / doesn't match yields null.
    expect(parsePayslip(VISMA_LINES, 'nonexistent')).toBeNull();
  });
});
