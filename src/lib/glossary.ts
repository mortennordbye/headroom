// The domain terms surfaced in the persistent glossary. The definitions live in
// the i18n table (`t.glossary.terms.<key>`, both locales); this list is only the
// order and the region gate — Norway-specific tax/pension/savings terms
// (`no: true`) are hidden outside the Norwegian region.
export interface GlossaryTerm {
  key: string;
  /** Norway-specific — only shown when region === 'no'. */
  no?: boolean;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  { key: 'headroom' },
  { key: 'netWorth' },
  { key: 'equity' },
  { key: 'ltv' },
  { key: 'savingsRate' },
  { key: 'emergencyFund' },
  { key: 'effectiveRate' },
  { key: 'inflation' },
  { key: 'compoundInterest' },
  { key: 'realReturn' },
  { key: 'liquidity' },
  { key: 'grossNet' },
  { key: 'annuityLoan' },
  { key: 'termPayment' },
  { key: 'amortizationPeriod' },
  { key: 'stressTest' },
  { key: 'feriepenger', no: true },
  { key: 'trinnskatt', no: true },
  { key: 'trygdeavgift', no: true },
  { key: 'minstefradrag', no: true },
  { key: 'marginalskatt', no: true },
  { key: 'restskatt', no: true },
  { key: 'otp', no: true },
  { key: 'ips', no: true },
  { key: 'bsu', no: true },
  { key: 'alminneligInntekt', no: true },
  { key: 'personinntekt', no: true },
  { key: 'gjeldsgrad', no: true },
  { key: 'ask', no: true },
  { key: 'mellomfinansiering', no: true },
];

/** The terms visible for a region, in display order. */
export function glossaryTermsFor(region: 'no' | 'generic'): GlossaryTerm[] {
  return GLOSSARY_TERMS.filter((term) => !term.no || region === 'no');
}
