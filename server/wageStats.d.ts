// Type surface for the CommonJS SSB wage-statistics client (server/wageStats.js),
// so the Vitest tests and any TS consumer get types. Runtime is plain JS.
export interface WageStatPoint {
  year: number;
  median: number; // gross annual NOK, national median for full-time employees
}

export function fetchWageStats(topCount?: number): Promise<WageStatPoint[]>;
export function parseWage11418JsonStat2(data: unknown): WageStatPoint[];
export function buildV2Url(topCount: number): string;
