import { describe, it, expect } from 'vitest';
import { parsePayslipAmount } from './parsePayslipAmount';
import { parseVismaPayslip } from './parseVismaPayslip';
import { parseTripletexPayslip } from './parseTripletexPayslip';
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
  'Fødselsdato 01.01.1990',
  'Fødselsnummer 01019012345',
  'Ola Nordmann',
  'Ansattnummer 1',
  'Storgata 10',
  '0155 Oslo',
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
  'Morten Victor Nordbye 12345678903 67 003,39',
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

// Line layout of a Tripletex payslip as extractPdfText emits it. Every name,
// number and amount is invented; only the structure mirrors a real payslip.
// The first line joins the employee (left column) and employer (right column);
// the tax-base description wraps onto the line after "Skattetrekk".
const TRIPLETEX_LINES: string[] = [
  'Kari Nordmann EKSEMPEL KONSULT AS',
  'Storgata 10 NO 999 999 999 MVA',
  'Kongens gate 1, 0153 OSLO',
  '0155 Oslo',
  'E-post: lonn@eksempel.no',
  'Lønnsslipp for Utbetalingsdato Til utbetaling',
  'Mars 2026 20.03.2026 43 812,40',
  'Lønnsbilag: 3-2026',
  'Fødselsnummer: 01019012345',
  'Lønnsart Beskrivelse Antall Sats Grunnlag Beløp',
  'Fastlønn Mars 2026 Prosent 62 500,00',
  'Bonus Kvartalsbonus Prosent 5 000,00',
  'Skattetrekk Grunnlag prosenttrekk (38,0%): -25 650,00',
  '67 500,00.',
  'Ansattutlegg nummer 12-2026, Kari Nordmann',
  'Gjeld til ansatte Private utlegg 812,40',
  'Ansattutlegg nummer 13-2026, Kari Nordmann',
  'Gjeld til ansatte Private utlegg 1 150,00',
  'Sum (utbetales til konto 1234.56.78903) 43 812,40',
  'Totalt i 2026',
  'Beskrivelse Beløp',
  'Gjeld til ansatte 3 924,80',
  'Fastlønn 187 500,00',
  'Bonus 5 000,00',
  'Grunnlag skatt 192 500,00',
  'Skattetrekk -73 150,00',
  'Grunnlag feriepenger 192 500,00',
  'Feriepenger til gode - opptjent i 2026 23 100,00',
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

describe('parseTripletexPayslip', () => {
  const p = parseTripletexPayslip(TRIPLETEX_LINES)!;

  it('recognises the payslip and reports the provider', () => {
    expect(p).not.toBeNull();
    expect(p.provider).toBe('tripletex');
  });

  it('reads the period and payment date from the header row', () => {
    expect(p.period).toBe('2026-03');
    expect(p.payDate).toBe('2026-03-20');
  });

  it('takes the employer from the right-hand column of the first line', () => {
    expect(p.employer).toBe('EKSEMPEL KONSULT AS');
  });

  it('uses the amount paid out as net, reimbursements included', () => {
    expect(p.net).toBeCloseTo(43812.4, 2);
  });

  it('reads the period figures, not the year-to-date totals', () => {
    expect(p.monthlySalary).toBe(62500);
    expect(p.taxWithheld).toBe(25650);
    expect(p.gross).toBe(67500);
  });

  it('reads the withholding percentage', () => {
    expect(p.taxPercent).toBe(38);
  });

  it('leaves fields the payslip does not print as null', () => {
    expect(p.annualSalary).toBeNull();
    expect(p.positionPct).toBeNull();
    expect(p.jobStartMonth).toBeNull();
    expect(p.holidayPayThisYear).toBeNull();
  });

  it('reads the tax base when the description does not wrap', () => {
    const lines = TRIPLETEX_LINES.flatMap(l =>
      l === '67 500,00.' ? [] :
      l.startsWith('Skattetrekk Grunnlag') ? ['Skattetrekk Grunnlag prosenttrekk (38,0%): 67 500,00. -25 650,00'] :
      [l]);
    const q = parseTripletexPayslip(lines)!;
    expect(q.gross).toBe(67500);
    expect(q.taxWithheld).toBe(25650);
  });

  it('falls back to the whole first line when no employer name is found', () => {
    const lines = ['Kari Nordmann Eksempel Konsult', ...TRIPLETEX_LINES.slice(1)];
    expect(parseTripletexPayslip(lines)!.employer).toBe('Kari Nordmann Eksempel Konsult');
  });

  it('does not claim a Visma payslip, and Visma does not claim it', () => {
    expect(parseTripletexPayslip(VISMA_LINES)).toBeNull();
    expect(parseVismaPayslip(TRIPLETEX_LINES)).toBeNull();
  });
});

describe('parsePayslip (registry)', () => {
  it('routes a Visma payslip to the Visma parser', () => {
    const p = parsePayslip(VISMA_LINES);
    expect(p?.provider).toBe('visma');
    expect(p?.annualSalary).toBe(740000);
  });

  it('routes a Tripletex payslip to the Tripletex parser', () => {
    expect(parsePayslip(TRIPLETEX_LINES)?.provider).toBe('tripletex');
    expect(parsePayslip(TRIPLETEX_LINES, 'visma')).toBeNull();
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
