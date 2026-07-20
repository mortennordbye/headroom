// Manual overrides for the Låneevne (borrowing-capacity) inputs on the Bolig
// page. Each figure is auto-derived from live data by default; `null` means
// "follow the auto value", any number is the user's explicit override.
//
// These are deliberately NOT the `loan.arslonn` / `loan.eksisterendeGjeld` /
// `loan.egenkapital` fields: those are the fallback used when viewing a PAST
// month, so reusing them would make a live override rewrite history.
//
// Kept in src/lib (not FinanceContext) so payloadRegistry can import the default
// without a circular value import — same reason as profile.ts.

export interface CapacityOverrides {
  /** Gross annual salary override, or null to follow derived income. */
  arslonn: number | null;
  /** Existing-debt override, or null to follow the derived credit frame. */
  gjeld: number | null;
  /** Equity override, or null to follow derived liquid equity. */
  egenkapital: number | null;
}

export const DEFAULT_CAPACITY_OVERRIDES: CapacityOverrides = {
  arslonn: null,
  gjeld: null,
  egenkapital: null,
};
