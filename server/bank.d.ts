// Type surface for the CommonJS Enable Banking engine (server/bank.js), so the
// Vitest mapping tests and any TS consumer get types. Runtime is plain JS.
export interface MappedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  kind: 'income' | 'expense';
  merchant?: string;
  mcc?: string;
  // Which account/bank the row came from (display only, for the per-account badge).
  account?: string;
  bank?: string;
  accountName?: string;
  // Categories are assigned client-side; the server only carries them forward
  // across a re-sync (see mergeTransactions).
  category?: string;
  categorySource?: 'auto' | 'manual';
}

export interface MapOptions {
  includePending?: boolean;
  idPrefix?: string;
  account?: string;
  bank?: string;
  accountName?: string;
}

export const EB_ID_PREFIX: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEBTransaction(tx: any, opts?: MapOptions): MappedTransaction;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEBTransactions(txs: any[], opts?: MapOptions): MappedTransaction[];
export function mergeTransactions(a: MappedTransaction[], b: MappedTransaction[], deletedIds?: string[]): MappedTransaction[];

export function getAspsps(): Promise<{ name: string; country?: string; logo: string | null }[]>;
export function startLink(bankName?: string): Promise<{ url: string }>;
export function finishLink(code: string, state: string): Promise<{ accounts: number }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStatus(): Record<string, any>;
export function fetchMappedTransactions(): Promise<MappedTransaction[]>;
export function recordSync(): void;
export function removeConnection(id: string): { removed: number };
