import { useCallback, useEffect, useState } from 'react';
import type { ComparableSale } from '../lib/marketValuation';
import { batches, type MarketFile } from '../lib/marketImport';
import type { MarketListing } from '../lib/marketListings';

const NO_SALES: ComparableSale[] = [];
const NO_LISTINGS: MarketListing[] = [];

export interface ImportResult {
  salesAdded: number;
  salesSkipped: number;
  listingsAdded: number;
  listingsUpdated: number;
}

/** Thrown when the server rejects an import; `details` are its per-row reasons. */
export class MarketImportError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.details = details;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    // The custom header is required by the server (it blocks cross-site POSTs).
    headers: { 'content-type': 'application/json', 'X-Headroom-Source': 'ui' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new MarketImportError(json.error ?? String(res.status), json.details ?? []);
  return json as T;
}

export interface MarketStatus {
  enabled: boolean;
  listings: number;
  sales: number;
  lastListingSeen: string | null;
  lastSalesImport: string | null;
}

/**
 * The opt-in market-data switch and counts (GET /api/market/status), plus the
 * imported sold homes for one postnummer when the feature is on, and (with
 * `withListings`) the stored homes for sale. Kept out of
 * FinanceContext: this data lives in its own server tables, not the finance
 * blob, so it never rides along in autosave, export or demo state.
 */
export function useMarketData(postnr?: string, { withListings = false } = {}) {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  // Tagged with the postnummer they were fetched for, so a stale list is never
  // shown for another postnummer or after the feature is turned off.
  const [loaded, setLoaded] = useState<{ postnr: string; sales: ComparableSale[] } | null>(null);
  const [error, setError] = useState(false);
  const [loadedListings, setLoadedListings] = useState<MarketListing[] | null>(null);
  // Bumped after an import so status counts and sales are fetched again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/market/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: MarketStatus) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [version]);

  const enabled = !!status?.enabled;
  const validPostnr = postnr && /^\d{4}$/.test(postnr) ? postnr : null;

  useEffect(() => {
    if (!enabled || !validPostnr) return;
    let cancelled = false;
    fetch(`/api/market/sales?postnr=${validPostnr}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { sales: ComparableSale[] }) => { if (!cancelled) setLoaded({ postnr: validPostnr, sales: d.sales }); })
      .catch(() => { if (!cancelled) setLoaded({ postnr: validPostnr, sales: [] }); });
    return () => { cancelled = true; };
  }, [enabled, validPostnr, version]);

  const sales = enabled && loaded && loaded.postnr === validPostnr ? loaded.sales : NO_SALES;

  useEffect(() => {
    if (!enabled || !withListings) return;
    let cancelled = false;
    fetch('/api/market/listings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { listings: MarketListing[] }) => { if (!cancelled) setLoadedListings(d.listings); })
      .catch(() => { if (!cancelled) setLoadedListings([]); });
    return () => { cancelled = true; };
  }, [enabled, withListings, version]);

  const listings = enabled && loadedListings ? loadedListings : NO_LISTINGS;

  /** Turn the feature on or off; `wipe` (off only) deletes every imported row. */
  const setEnabled = useCallback(async (next: boolean, wipe = false) => {
    setStatus(await post<MarketStatus>('/api/market/config', { enabled: next, wipe }));
  }, []);

  /**
   * Import a parsed file, in server-sized batches. Each batch is all-or-nothing
   * on the server; a rejected batch stops the import and throws, and batches
   * before it stay imported (re-importing skips them as duplicates).
   */
  const importFile = useCallback(async (file: MarketFile): Promise<ImportResult> => {
    const r: ImportResult = { salesAdded: 0, salesSkipped: 0, listingsAdded: 0, listingsUpdated: 0 };
    try {
      for (const chunk of batches(file.sales)) {
        const out = await post<{ added: number; duplicates: number }>('/api/market/sales', { sales: chunk });
        r.salesAdded += out.added;
        r.salesSkipped += out.duplicates;
      }
      for (const chunk of batches(file.listings)) {
        const out = await post<{ added: number; updated: number }>('/api/market/listings', { listings: chunk, seenOn: file.seenOn });
        r.listingsAdded += out.added;
        r.listingsUpdated += out.updated;
      }
    } finally {
      setVersion((v) => v + 1);
    }
    return r;
  }, []);

  /** Add one sold home. Resolves to false when it was already stored. */
  const addSale = useCallback(async (sale: Record<string, unknown>): Promise<boolean> => {
    const out = await post<{ added: number }>('/api/market/sales', { sales: [sale] });
    setVersion((v) => v + 1);
    return out.added > 0;
  }, []);

  return { status, sales, listings, error, setEnabled, importFile, addSale };
}
