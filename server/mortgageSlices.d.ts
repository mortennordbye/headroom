// Type surface for the CommonJS twin of the mortgage balance load migration
// (server/mortgageSlices.js), so the Vitest tests in src/lib get types.
type Blob = Record<string, unknown>;

export function isMonthKey(v: unknown): v is string;
export function migrateMortgageBalance(data: Blob, monthKey: string): Blob;
