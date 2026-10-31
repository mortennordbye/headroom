/**
 * Client-side shaping of market data the user adds in the app: one sold home
 * typed into a form, or a JSON file with many rows. The server validates every
 * row again (server/market.js), so this only turns input into the import shape
 * and catches the obvious mistakes early with a readable message.
 */
import { parseLocaleNumber } from './validators';
import { normalizeMonthOrDay } from './dateInput';

/** Rows per request; the server's per-import cap. */
export const MARKET_BATCH = 500;

export interface MarketFile {
  sales: Record<string, unknown>[];
  listings: Record<string, unknown>[];
  /** 'YYYY-MM-DD' the listings were seen; the server defaults to today. */
  seenOn?: string;
}

export type SaleFormKey = 'address' | 'unit' | 'postnr' | 'bra' | 'soldPrice' | 'soldOn' | 'askingPrice' | 'fellesgjeld';

/** Parse a kr / m² amount, tolerating thousands spaces ("3 950 000"). */
function amount(s: string | undefined): number | undefined | null {
  const t = (s ?? '').replace(/\s/g, '');
  if (!t) return undefined;
  const n = parseLocaleNumber(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * One sold home from the add-sale form. Returns the import row, or the key of
 * the first field that is missing or invalid.
 */
export function saleFromForm(values: Partial<Record<SaleFormKey, string>>):
  { sale: Record<string, unknown> } | { error: Exclude<SaleFormKey, 'unit'> } {
  const address = (values.address ?? '').trim();
  if (!address) return { error: 'address' };
  const postnr = (values.postnr ?? '').trim();
  if (!/^\d{4}$/.test(postnr)) return { error: 'postnr' };
  const bra = amount(values.bra);
  if (bra == null || bra <= 0) return { error: 'bra' };
  const soldPrice = amount(values.soldPrice);
  if (soldPrice == null || soldPrice <= 0) return { error: 'soldPrice' };
  const soldOn = normalizeMonthOrDay(values.soldOn ?? '', 'day');
  if (!soldOn || !/^\d{4}-\d{2}-\d{2}$/.test(soldOn)) return { error: 'soldOn' };
  const askingPrice = amount(values.askingPrice);
  if (askingPrice === null) return { error: 'askingPrice' };
  const fellesgjeld = amount(values.fellesgjeld);
  if (fellesgjeld === null) return { error: 'fellesgjeld' };
  const unit = (values.unit ?? '').trim();

  const sale: Record<string, unknown> = { address, postnr, bra, soldPrice, soldOn, source: 'manual' };
  if (unit) sale.unit = unit;
  if (askingPrice !== undefined) sale.askingPrice = askingPrice;
  if (fellesgjeld !== undefined) sale.fellesgjeld = fellesgjeld;
  return { sale };
}

/**
 * A market-data file: `{ "sales": [...], "listings": [...], "seenOn": "YYYY-MM-DD" }`,
 * either list optional, with the same fields as the MCP import tools. Returns
 * the rows, or an error message key.
 */
export function parseMarketFile(text: string): MarketFile | { error: 'json' | 'shape' | 'empty' } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'shape' };
  const { sales = [], listings = [], seenOn } = data as Record<string, unknown>;
  const rows = (v: unknown) => Array.isArray(v) && v.every((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!rows(sales) || !rows(listings)) return { error: 'shape' };
  if (seenOn !== undefined && (typeof seenOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(seenOn))) return { error: 'shape' };
  const s = sales as Record<string, unknown>[];
  const l = listings as Record<string, unknown>[];
  if (s.length === 0 && l.length === 0) return { error: 'empty' };
  return { sales: s, listings: l, ...(seenOn ? { seenOn: seenOn as string } : {}) };
}

/** Split rows into request-sized batches. */
export function batches<T>(rows: T[], size = MARKET_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
