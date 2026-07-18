// Optional user profile — a small identity block that's mostly extra context for
// the AI assistant. Kept in src/lib (not FinanceContext) so payloadRegistry can
// import DEFAULT_PROFILE without a circular value import.

export interface Profile {
  /** Display name; blank by default. */
  name?: string;
  /** Full date of birth 'YYYY-MM-DD'. Age is derived, never stored; the year is
   *  the single source for the Pension page's birth year. */
  birthDate?: string;
}

export const DEFAULT_PROFILE: Profile = {};

/** Four-digit birth year from a 'YYYY-MM-DD' string, or 0 when absent/invalid. */
export function birthYearFrom(birthDate: string | undefined): number {
  if (!birthDate) return 0;
  const year = Number(birthDate.slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : 0;
}
