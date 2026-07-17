// Type surface for the CommonJS SSB square-metre-price client
// (server/boligPrices.js), so the Vitest tests and any TS consumer get types.
// Runtime is plain JS.
export interface KvmprisPoint {
  quarter: string;
  price: number | null;
  sales: number | null;
}

export function fetchKvmpris(
  region: string,
  boligtype: string,
  topCount?: number,
): Promise<KvmprisPoint[]>;
export function parseBolig14310JsonStat2(data: unknown): KvmprisPoint[];
export function buildV2Url(region: string, boligtype: string, topCount: number): string;
export function dwellingToBoligtype(dwellingType: string): string;
export const DWELLING_TO_BOLIGTYPE: Record<string, string>;
