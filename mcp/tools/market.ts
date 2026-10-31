// Housing-market tools: import homes for sale and sold comparables, and value
// the user's current home from them. Only listed while the user has turned
// market data on (Bolig page → Marked; see syncMarketTools); the server enforces the
// same switch, so a stale client can't write while it is off.
//
// Headroom does not fetch market data. Where the rows come from is up to the
// user: typed in, copied from an agent's sales document, or gathered by the AI
// client itself.

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getData, getMarketStatus, importMarketListings, importMarketSales, getMarketSales, getKvmpris,
} from '../client';
import { jsonResult, errorResult } from '../util';
import { currentResidence } from '../../src/lib/property';
import { bedroomsFromRooms, valuationConfidence, valuationFromSales } from '../../src/lib/marketValuation';
import { estimatedPropertyValue } from '../../src/lib/propertyEstimate';

// A real day, not in the future (one day of slack for time zones), as the server requires.
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine((d) => d <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'must not be in the future');
const kr = (max: number) => z.number().min(0).max(max);

// Mirrors the server allowlist in server/market.js. Strict, so a field the
// store would reject (photos, ad text, anything unknown) fails here first.
const common = {
  address: z.string().min(1).max(200).optional().describe('Street address, e.g. "Storgata 12B".'),
  unit: z.string().min(1).max(20).optional().describe('Bolignummer / unit, e.g. "H0201".'),
  postnr: z.string().regex(/^\d{4}$/).optional().describe('4-digit postnummer. Needed for the home valuation to find the sale.'),
  area: z.string().min(1).max(100).optional().describe('Neighbourhood or district name.'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  dwellingType: z.enum(['leilighet', 'enebolig', 'rekkehus', 'tomannsbolig', 'hytte', 'other']).optional(),
  ownership: z.enum(['selveier', 'borettslag', 'aksjeleilighet', 'other']).optional(),
  bra: z.number().min(1).max(5000).optional().describe('Usable area (BRA / BRA-i) in m².'),
  bedrooms: z.number().int().min(0).max(50).optional()
    .describe('Bedrooms (a 2-roms has 1). Leave out when the source does not state it; send 0 only for a real studio, since 0 is read as "not stated" by the valuation.'),
  floor: z.number().int().min(-5).max(200).optional(),
  yearBuilt: z.number().int().min(1500).max(2100).optional(),
  askingPrice: kr(1e10).optional().describe('Prisantydning in kr, excluding fellesgjeld.'),
  fellesgjeld: kr(1e10).optional().describe('Share of joint debt in kr (0 for selveier).'),
  source: z.string().min(1).max(100).optional().describe('Where the row came from, free text.'),
};

const listingSchema = z.object({
  ...common,
  url: z.string().url().max(500).describe('Link to the listing. Identifies it: importing the same URL again updates it and records the price for that day.'),
  felleskost: kr(1e7).optional().describe('Monthly shared costs in kr.'),
  status: z.enum(['active', 'sold', 'withdrawn']).optional(),
}).strict();

const saleSchema = z.object({
  ...common,
  address: z.string().min(1).max(200),
  url: z.string().url().max(500).optional(),
  soldPrice: z.number().min(1).max(1e10).describe('Price it sold for in kr, excluding fellesgjeld.'),
  soldOn: day.describe("Sale date 'YYYY-MM-DD'."),
}).strict();

const write = { readOnlyHint: false, openWorldHint: false } as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerMarketTools(server: McpServer): RegisteredTool[] {
  const importListings = server.registerTool(
    'import_listings',
    {
      title: 'Import homes for sale',
      description:
        'Store homes for sale in Headroom (up to 500 per call). Facts only: price, fellesgjeld, felleskost, size, rooms, floor, year, location and a link. No photos or ad text. A listing is identified by its url; importing it again updates its fields and records its asking price for seenOn, which builds a price history. Returns counts and any asking-price changes since the previous snapshot.',
      inputSchema: {
        listings: z.array(listingSchema).min(1).max(500),
        seenOn: day.optional().describe("The day the listings were seen, 'YYYY-MM-DD'. Defaults to today; set it when importing an older snapshot."),
      },
      annotations: { title: 'Import homes for sale', ...write, destructiveHint: false, idempotentHint: true },
    },
    async ({ listings, seenOn }) => {
      try {
        return jsonResult(await importMarketListings(listings, seenOn));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  const importSales = server.registerTool(
    'import_sales',
    {
      title: 'Import sold homes',
      description:
        'Store sold homes (comparables) in Headroom, up to 500 per call. These drive get_home_valuation, so include postnr and bra. The same sale imported twice is skipped. Returns how many were added and skipped.',
      inputSchema: { sales: z.array(saleSchema).min(1).max(500) },
      annotations: { title: 'Import sold homes', ...write, destructiveHint: false, idempotentHint: true },
    },
    async ({ sales }) => {
      try {
        return jsonResult(await importMarketSales(sales));
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  const valuation = server.registerTool(
    'get_home_valuation',
    {
      title: 'Value of the current home',
      description:
        'Estimated market value of the user\'s current home (from the Bolig page residence: address, postnummer, size, rooms, fellesgjeld). Uses imported sold homes of a similar size (±25 %) from the last 24 months, on the same street or else in the same postnummer, leaving out sales with a different stated bedroom count (0 counts as not stated) when at least 3 remain. Each sale\'s total price per m² is moved to today\'s level with the SSB kommune m² index, and weighted by recency (half weight after 12 months) and closeness in size. low/mid/high are the weighted 25th/50th/75th percentile, minus the home\'s own fellesgjeld. confidence (high/medium/low) rates the estimate by effective sale count, age of the newest sale and range width. Falls back to the SSB kommune average per m² when there are fewer than 3 comparables. Also returns the value the user has entered today.',
      inputSchema: {},
      annotations: { title: 'Value of the current home', readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const { blob } = await getData();
        const home = currentResidence(blob.residences ?? []);
        const currentValueInApp = blob.assets?.houseValue ?? null;
        if (!home) return jsonResult({ method: null, note: 'no current home registered on the Bolig page', currentValueInApp });
        if (!home.postalCode || !home.sizeSqm) {
          return jsonResult({ method: null, note: 'the current home needs a postnummer and size (m²) on the Bolig page', currentValueInApp });
        }
        const sales = await getMarketSales(home.postalCode);
        const ssb = await getKvmpris(home.postalCode, home.dwellingType).catch(() => null);
        const comps = valuationFromSales(
          {
            address: home.address, postnr: home.postalCode, sizeSqm: home.sizeSqm,
            bedrooms: bedroomsFromRooms(home.rooms), fellesgjeld: home.jointDebtShare,
          },
          sales,
          { asOf: today(), index: ssb?.points },
        );
        if (comps) {
          return jsonResult({ method: 'comparables', ...comps, confidence: valuationConfidence(comps, today()), currentValueInApp });
        }
        const estimate = estimatedPropertyValue(home.sizeSqm, ssb?.latestPrice);
        return jsonResult({
          method: estimate == null ? null : 'ssb',
          estimate,
          perSqm: ssb?.latestPrice ?? null,
          quarter: ssb?.latestQuarter ?? null,
          note: `fewer than 3 comparable sales (${sales.length} imported for ${home.postalCode}); import_sales with sold homes nearby gives a sharper range`,
          currentValueInApp,
        });
      } catch (e) {
        return errorResult(String((e as Error).message));
      }
    },
  );

  return [importListings, importSales, valuation];
}

/**
 * Show the market tools only while the user has the feature on. Unreachable
 * app counts as off (deny by default). Enabling or disabling a registered tool
 * notifies a connected client that the tool list changed.
 */
export async function syncMarketTools(tools: RegisteredTool[]): Promise<boolean> {
  const on = await getMarketStatus().then((s) => s.enabled, () => false);
  for (const t of tools) {
    if (on && !t.enabled) t.enable();
    else if (!on && t.enabled) t.disable();
  }
  return on;
}
