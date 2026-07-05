// Type surface for the CommonJS Enable Banking engine (server/bank.js), so the
// Vitest mapping tests and any TS consumer get types. Runtime is plain JS.
export interface MappedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  kind: 'income' | 'expense';
}

export interface MapOptions {
  includePending?: boolean;
  idPrefix?: string;
}

export const EB_ID_PREFIX: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEBTransaction(tx: any, opts?: MapOptions): MappedTransaction;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEBTransactions(txs: any[], opts?: MapOptions): MappedTransaction[];
export function mergeTransactions(a: MappedTransaction[], b: MappedTransaction[]): MappedTransaction[];

export function startLink(): Promise<{ url: string }>;
export function finishLink(code: string, state: string): Promise<{ accounts: number }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStatus(): Record<string, any>;
export function fetchMappedTransactions(): Promise<MappedTransaction[]>;
export function recordSync(): void;
