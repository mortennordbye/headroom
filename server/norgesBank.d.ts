// Type surface for the CommonJS Norges Bank policy-rate client
// (server/norgesBank.js). Runtime is plain JS.
export interface PolicyRatePoint {
  period: string; // ISO date, e.g. '2026-07-16'
  rate: number; // percent, e.g. 4.25
}

export function fetchPolicyRate(lastN?: number): Promise<PolicyRatePoint[]>;
export function parseSdmxJson(data: unknown): PolicyRatePoint[];
export function buildUrl(lastN: number): string;
