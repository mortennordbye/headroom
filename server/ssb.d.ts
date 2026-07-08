// Type surface for the CommonJS SSB client (server/ssb.js), so the Vitest
// tests and any TS consumer get types. Runtime is plain JS.
export interface CpiPoint {
  month: string;
  cpiIndex: number;
}

export interface CpiPointWithYoy extends CpiPoint {
  yoyPercent: number | null;
}

export function fetchCpi(fromMonth: string, toMonth: string): Promise<CpiPoint[]>;
export function withYoy(points: CpiPoint[]): CpiPointWithYoy[];
export function monthsInRange(fromMonth: string, toMonth: string): string[];
export function parseCpiJsonStat2(data: unknown, toMonth: string): CpiPoint[];
export function buildV2Url(topCount: number): string;
