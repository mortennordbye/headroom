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
  // Set client-side too (src/lib/segments.ts); carried forward the same way.
  segment?: 'transfer' | 'oneOff';
  // Provisional (not yet booked). Present only when pending import is enabled;
  // a booked twin later evicts it (see evictSupersededPending).
  pending?: boolean;
  // Sync-only: the connection's id prefix, on rows from the first sync after a
  // re-link (see dropRelinkFormatTwins). Stripped before the row is stored.
  relinkPrefix?: string;
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
// A deleted row's fingerprint (DeletedBankTombstone in src/context/FinanceContext.tsx).
export type DeletedRowFingerprint = Pick<MappedTransaction, 'id' | 'date' | 'amount' | 'description'>
  & Partial<Pick<MappedTransaction, 'account' | 'kind' | 'pending'>>;
export function mergeTransactions(a: MappedTransaction[], b: MappedTransaction[], deletedIds?: string[], tombstones?: DeletedRowFingerprint[], knownConnectionPrefixes?: string[]): MappedTransaction[];
export function dropRelinkFormatTwins(existing: MappedTransaction[], incoming: MappedTransaction[]): MappedTransaction[];
export function evictSupersededPending(txs: MappedTransaction[]): MappedTransaction[];
export function dropStaleBareTwins(txs: MappedTransaction[], connectionPrefixes?: string[]): MappedTransaction[];
export function connectionPrefixes(): string[];
// Fetch floors (see the `fetch floors` section of server/bank.js).
export interface FloorAccount { uid: string; key_uid?: string }
export interface FloorConnection { id: string; idPrefix: string; last_sync?: string | null; accounts?: FloorAccount[] }
export interface FloorStore { connections?: FloorConnection[]; removed?: { idPrefix: string }[]; fetchFloors?: Record<string, string> }
export interface TombstoneCutoffs { accounts: Record<string, string>; prefixes: Record<string, string | null> }
export interface SyncedConnection { connectionId: string; sessionId: string; accountKeys: string[]; complete: boolean }
export const FLOOR_MARGIN_DAYS: number;
export function fetchFromDate(c: FloorConnection, acc: FloorAccount, floors?: Record<string, string>, nowMs?: number, days?: number): string;
export function dropRowsBeforeFloor<T extends { id: string; date: string; account?: string }>(rows: T[], existingIds: Set<string>, floors?: Record<string, string>, nowMs?: number): T[];
export function tombstoneCutoffs(store: FloorStore, nowMs?: number): TombstoneCutoffs;
export function futureFloors(store: FloorStore, nowMs?: number): string[];
export function lastSyncAgeMs(nowMs?: number): number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeAccount(a: any): { uid?: string; name?: string; product?: string; currency?: string; iban?: string };
export function carryAccountKeys<T extends { uid?: string; iban?: string; key_uid?: string }>(prevAccounts: T[] | undefined, nextAccounts: T[]): T[];

export function getAspsps(): Promise<{ name: string; country?: string; logo: string | null }[]>;
export function startLink(bankName?: string, connectionId?: string): Promise<{ url: string }>;
export function finishLink(code: string, state: string): Promise<{ accounts: number }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStatus(): Record<string, any>;
export function fetchMappedTransactions(): Promise<{ rows: MappedTransaction[]; synced: SyncedConnection[]; floors: Record<string, string> }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recordSync(outcome?: { ok?: boolean; synced?: SyncedConnection[]; [k: string]: any }): void;
export function removeConnection(id: string): { removed: number };
