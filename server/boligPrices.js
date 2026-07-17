/**
 * SSB square-metre price client — queries Statistics Norway table 14310
 * (Gjennomsnittlig kvadratmeterpris og antall omsetninger, etter region,
 * boligtype og kvartal) and returns { quarter, price, sales } points for one
 * kommune + dwelling type.
 *
 * Primary: PxWebApi v2 (GET) —
 *   https://data.ssb.no/api/pxwebapi/v2/tables/14310/data
 * Fallback: the classic PxWebApi v1 (POST) —
 *   https://data.ssb.no/api/v0/no/table/14310/
 * Both return json-stat2, so parsing is shared (and unit-tested).
 *
 * Table 14310 dimensions (id order): Region, Boligtype, ContentsCode, Tid.
 *   - Region = 4-digit kommunenummer (e.g. '0301' Oslo)
 *   - Boligtype = '00' total, '01' eneboliger, '02' småhus/rekkehus,
 *     '03' blokkleiligheter (apartments)
 *   - ContentsCode = 'KvPris' (avg NOK/m² BRA-i) and 'Omsetninger' (number of
 *     sales)
 *   - Tid = quarterly, code 'YYYYKn' (e.g. '2025K3')
 *
 * We pin Region + Boligtype to a single value and request both ContentsCode
 * measures, so Tid and ContentsCode are the only multi-valued dimensions. The
 * parser computes value[] strides from the response `size` array rather than
 * assuming a layout, so it stays correct if SSB reorders dimensions.
 *
 * SSB rate limit is 30 queries/min per IP — the caller (server/index.js)
 * throttles upstream attempts so a broken query or an SSB outage can't turn
 * every page load into an SSB hit.
 *
 * Node 18+ ships fetch globally; no external HTTP dep needed.
 */

const SSB_V2_BASE = 'https://data.ssb.no/api/pxwebapi/v2/tables/14310/data';
const SSB_V1_URL = 'https://data.ssb.no/api/v0/no/table/14310/';
const FETCH_TIMEOUT_MS = 10_000;

// Headroom's DwellingType → SSB Boligtype code. '00' (total) is the safe
// fallback for anything without its own SSB bucket (hytte/other).
const DWELLING_TO_BOLIGTYPE = {
  leilighet: '03', // blokkleiligheter
  enebolig: '01', // eneboliger
  rekkehus: '02', // småhus (rekkehus/tomannsbolig)
  tomannsbolig: '02',
};

function dwellingToBoligtype(dwellingType) {
  return DWELLING_TO_BOLIGTYPE[dwellingType] || '00';
}

/** PxWebApi v2 data URL: GET with valueCodes filters, json-stat2 out. */
function buildV2Url(region, boligtype, topCount) {
  // Region (kommunenr from the postnummer register) and boligtype (from the
  // fixed map above) are both fixed-alphabet digits, so building the URL
  // literally (brackets/parens unencoded, matching SSB's examples) is safe.
  return `${SSB_V2_BASE}?lang=no&outputFormat=json-stat2`
    + `&valueCodes[Region]=${region}`
    + `&valueCodes[Boligtype]=${boligtype}`
    + '&valueCodes[ContentsCode]=KvPris,Omsetninger'
    + `&valueCodes[Tid]=top(${Math.floor(topCount)})`;
}

/**
 * Parse a json-stat2 14310 response (v1 and v2 share the format) into
 * { quarter, price, sales } points, sorted ascending by quarter. Missing
 * cells (null in value[]) become null so the caller can skip them.
 */
function parseBolig14310JsonStat2(data) {
  const tidDim = data.dimension?.Tid;
  const contentDim = data.dimension?.ContentsCode;
  if (!tidDim || !contentDim) {
    throw new Error('SSB 14310 response missing Tid or ContentsCode dimension');
  }

  // Row-major strides from the response's own id/size arrays: the last
  // dimension varies fastest. A cell's flat index is the sum over dimensions of
  // (categoryIndex * stride). Region + Boligtype are pinned singletons (index 0),
  // so they contribute nothing.
  const ids = data.id || [];
  const sizes = data.size || [];
  const stride = {};
  let s = 1;
  for (let i = ids.length - 1; i >= 0; i--) {
    stride[ids[i]] = s;
    s *= sizes[i];
  }

  const tidIndex = tidDim.category.index; // { '2025K3': 0, ... }
  const contentIndex = contentDim.category.index; // { KvPris: 0, Omsetninger: 1 }
  const values = data.value || [];
  const priceBase = contentIndex.KvPris * stride.ContentsCode;
  const salesBase = contentIndex.Omsetninger * stride.ContentsCode;

  const num = (v) => (typeof v === 'number' ? v : null);
  const points = [];
  for (const [quarter, t] of Object.entries(tidIndex)) {
    points.push({
      quarter,
      price: num(values[priceBase + t * stride.Tid]),
      sales: num(values[salesBase + t * stride.Tid]),
    });
  }
  // 'YYYYKn' codes are fixed-width (single-digit quarter), so lexicographic
  // order equals chronological order.
  points.sort((a, b) => a.quarter.localeCompare(b.quarter));
  return points;
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    // Bound the upstream call so a black-holed connection can't hang the
    // request for long — the caller falls back to cached data.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`SSB returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Fetch the last `topCount` quarters of price + sales for one kommune and
 * dwelling type. `region` is a 4-digit kommunenummer, `boligtype` a 2-digit
 * code (see DWELLING_TO_BOLIGTYPE).
 */
async function fetchKvmpris(region, boligtype, topCount = 8) {
  try {
    const data = await fetchJson(buildV2Url(region, boligtype, topCount), {
      headers: { Accept: 'application/json' },
    });
    return parseBolig14310JsonStat2(data);
  } catch (v2Err) {
    const body = {
      query: [
        { code: 'Region', selection: { filter: 'item', values: [region] } },
        { code: 'Boligtype', selection: { filter: 'item', values: [boligtype] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['KvPris', 'Omsetninger'] } },
        { code: 'Tid', selection: { filter: 'top', values: [String(Math.floor(topCount))] } },
      ],
      response: { format: 'json-stat2' },
    };
    try {
      const data = await fetchJson(SSB_V1_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      return parseBolig14310JsonStat2(data);
    } catch (v1Err) {
      throw new Error(`v2: ${v2Err.message}; v1: ${v1Err.message}`);
    }
  }
}

module.exports = {
  fetchKvmpris,
  parseBolig14310JsonStat2,
  buildV2Url,
  dwellingToBoligtype,
  DWELLING_TO_BOLIGTYPE,
};
