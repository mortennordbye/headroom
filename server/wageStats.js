/**
 * SSB wage-statistics client — queries Statistics Norway table 11418
 * (Yrkesfordelt månedslønn) for the national median monthly wage of full-time
 * employees, all occupations and all sectors, both sexes, and returns
 * { year, median } points where `median` is the *annual* figure (monthly × 12).
 *
 * Primary: PxWebApi v2 (GET) —
 *   https://data.ssb.no/api/pxwebapi/v2/tables/11418/data
 * Fallback: the classic PxWebApi v1 (POST) —
 *   https://data.ssb.no/api/v0/no/table/11418/
 * Both return json-stat2, so parsing is shared (and unit-tested).
 *
 * Table 11418 dimensions we pin to a single value each, leaving Tid (year) as
 * the only multi-valued dimension so value[] is ordered by the Tid index:
 *   - MaaleMetode = '01'      Median (statistikkmål)
 *   - Yrke        = '0-9'     Alle yrker (all occupations)
 *   - Sektor      = 'ALLE'    Sum alle sektorer (all sectors)
 *   - Kjonn       = '0'       Begge kjønn (both sexes)
 *   - AvtaltVanlig= '5'       Heltidsansatte (full-time employees)
 *   - ContentsCode= 'Manedslonn'  Månedslønn (kr) — the monthly wage
 *
 * SSB publishes the wage as a *monthly* figure; the app's timeline compares
 * against gross *annual* salary, so we multiply by 12 (SSB's own convention for
 * an årslønn approximation) in the parser and store the annual value.
 *
 * SSB rate limit is 30 queries/min per IP — the caller (server/index.js)
 * throttles upstream attempts so a broken query or an SSB outage can't turn
 * every page load into an SSB hit.
 *
 * Node 18+ ships fetch globally; no external HTTP dep needed.
 */

const SSB_V2_BASE = 'https://data.ssb.no/api/pxwebapi/v2/tables/11418/data';
const SSB_V1_URL = 'https://data.ssb.no/api/v0/no/table/11418/';
const FETCH_TIMEOUT_MS = 10_000;

// Pinned dimension selections (see header). Shared by the v2 URL and the v1 body
// so the two request builders can't drift.
const PINS = {
  MaaleMetode: '01',
  Yrke: '0-9',
  Sektor: 'ALLE',
  Kjonn: '0',
  AvtaltVanlig: '5',
  ContentsCode: 'Manedslonn',
};

/** PxWebApi v2 data URL: GET with valueCodes filters, json-stat2 out. */
function buildV2Url(topCount) {
  // Every pinned value is from a fixed safe alphabet (digits / uppercase
  // codes / the literal 'Manedslonn'), so building the URL literally
  // (brackets/parens unencoded, matching SSB's documented examples) is safe.
  return `${SSB_V2_BASE}?lang=no&outputFormat=json-stat2`
    + `&valueCodes[MaaleMetode]=${PINS.MaaleMetode}`
    + `&valueCodes[Yrke]=${PINS.Yrke}`
    + `&valueCodes[Sektor]=${PINS.Sektor}`
    + `&valueCodes[Kjonn]=${PINS.Kjonn}`
    + `&valueCodes[AvtaltVanlig]=${PINS.AvtaltVanlig}`
    + `&valueCodes[ContentsCode]=${PINS.ContentsCode}`
    + `&valueCodes[Tid]=top(${Math.floor(topCount)})`;
}

/**
 * Parse a json-stat2 11418 response (v1 and v2 share the format) into
 * { year, median } points, sorted ascending by year. Every dimension except Tid
 * is pinned to a single value, so value[] is ordered by the Tid index. `median`
 * is the annual figure (SSB's monthly wage × 12).
 */
function parseWage11418JsonStat2(data) {
  const tidDim = data.dimension?.Tid;
  if (!tidDim) throw new Error('SSB 11418 response missing Tid dimension');

  const indexById = tidDim.category.index; // { '2024': 0, ... }
  const values = data.value || [];

  const points = [];
  for (const [code, idx] of Object.entries(indexById)) {
    const monthly = values[idx];
    if (typeof monthly === 'number') {
      points.push({ year: Number(code), median: Math.round(monthly * 12) });
    }
  }
  points.sort((a, b) => a.year - b.year);
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
 * Fetch the last `topCount` years of national median annual wage.
 * "top" counts from the newest published year, so we never request years that
 * don't exist yet.
 */
async function fetchWageStats(topCount = 12) {
  try {
    const data = await fetchJson(buildV2Url(topCount), { headers: { Accept: 'application/json' } });
    return parseWage11418JsonStat2(data);
  } catch (v2Err) {
    const body = {
      query: [
        { code: 'MaaleMetode', selection: { filter: 'item', values: [PINS.MaaleMetode] } },
        { code: 'Yrke', selection: { filter: 'item', values: [PINS.Yrke] } },
        { code: 'Sektor', selection: { filter: 'item', values: [PINS.Sektor] } },
        { code: 'Kjonn', selection: { filter: 'item', values: [PINS.Kjonn] } },
        { code: 'AvtaltVanlig', selection: { filter: 'item', values: [PINS.AvtaltVanlig] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: [PINS.ContentsCode] } },
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
      return parseWage11418JsonStat2(data);
    } catch (v1Err) {
      throw new Error(`v2: ${v2Err.message}; v1: ${v1Err.message}`, { cause: v1Err });
    }
  }
}

// ── Wage for one IT occupation (STYRK-08), for the market marker on Avansert ──
//
// A separate pinned query on the same table 11418, so the national series
// above stays as it is. Pins (checked against the table metadata):
//   - MaaleMetode = '01', '051', '061'   Median, Nedre kvartil, Øvre kvartil
//   - Yrke        = one code from OCCUPATIONS (STYRK-08)
//   - Sektor      = 'A+B+D+E'            Privat sektor og offentlige eide foretak
//   - Kjonn       = '0'                  Begge kjønn
//   - AvtaltVanlig= '5'                  Heltidsansatte
//   - ContentsCode= 'AvtaltManedslonn'   Avtalt månedslønn (kr): the agreed wage,
//     without bonus, irregular supplements and overtime. It compares with the
//     base salary in the company model, where bonus is its own line.
// SSB's reference month for this table is November.

// The allowlist of Yrke codes, with SSB's labels. 2523 (Nettverksansvarlige) is
// left out: SSB suppresses it (':') for private sector and full time every year.
const OCCUPATIONS = {
  '25': 'IKT-rådgivere',
  '2511': 'Systemanalytikere/-arkitekter',
  '2512': 'Programvareutviklere',
  '2513': 'Nett- og multimediautviklere',
  '2514': 'Applikasjonsprogrammerere',
  '2519': 'Andre programvare- og applikasjonsutviklere',
  '2521': 'Databasedesignere og -administratorer',
  '2522': 'Systemadministratorer',
  '2529': 'Sikkerhetsanalytikere mv.',
};

const PINS_OCC = {
  MaaleMetode: ['01', '051', '061'],
  Sektor: 'A+B+D+E',
  Kjonn: '0',
  AvtaltVanlig: '5',
  ContentsCode: 'AvtaltManedslonn',
};
const OCC_MEASURES = { '01': 'median', '051': 'p25', '061': 'p75' };

function assertOccupation(code) {
  if (!Object.prototype.hasOwnProperty.call(OCCUPATIONS, code)) throw new Error('unknown occupation code');
}

/** PxWebApi v2 data URL for one occupation; `+` in the sector code is encoded. */
function buildOccupationV2Url(code, topCount) {
  assertOccupation(code);
  return `${SSB_V2_BASE}?lang=no&outputFormat=json-stat2`
    + `&valueCodes[MaaleMetode]=${PINS_OCC.MaaleMetode.join(',')}`
    + `&valueCodes[Yrke]=${code}`
    + `&valueCodes[Sektor]=${encodeURIComponent(PINS_OCC.Sektor)}`
    + `&valueCodes[Kjonn]=${PINS_OCC.Kjonn}`
    + `&valueCodes[AvtaltVanlig]=${PINS_OCC.AvtaltVanlig}`
    + `&valueCodes[ContentsCode]=${PINS_OCC.ContentsCode}`
    + `&valueCodes[Tid]=top(${Math.floor(topCount)})`;
}

/**
 * Parse a json-stat2 11418 response for one occupation into
 * { year, median, p25, p75 } points (annual kr: monthly × 12), sorted by year.
 * MaaleMetode and Tid are the multi-valued dimensions, so the flat value[] is
 * read through the row-major strides of `id`/`size`. A year without a finite
 * median is skipped; a missing quartile is null.
 */
function parseOccupationJsonStat2(data) {
  const ids = Array.isArray(data?.id) ? data.id : null;
  const sizes = Array.isArray(data?.size) ? data.size : null;
  const tid = data?.dimension?.Tid?.category?.index;
  const mm = data?.dimension?.MaaleMetode?.category?.index;
  if (!ids || !sizes || ids.length !== sizes.length || !tid || !mm) {
    throw new Error('SSB 11418 response missing dimensions');
  }
  const stride = (dim) => {
    const at = ids.indexOf(dim);
    if (at < 0) throw new Error(`SSB 11418 response missing ${dim}`);
    return sizes.slice(at + 1).reduce((p, n) => p * n, 1);
  };
  const tStride = stride('Tid');
  const mStride = stride('MaaleMetode');
  const values = Array.isArray(data.value) ? data.value : [];
  const annual = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 12) : null);

  const points = [];
  for (const [year, ti] of Object.entries(tid)) {
    const p = { year: Number(year), median: null, p25: null, p75: null };
    for (const [m, key] of Object.entries(OCC_MEASURES)) {
      if (mm[m] === undefined) continue;
      p[key] = annual(values[mm[m] * mStride + ti * tStride]);
    }
    if (Number.isInteger(p.year) && p.median != null) points.push(p);
  }
  points.sort((a, b) => a.year - b.year);
  return points;
}

/** Fetch the last `topCount` years for one allowlisted occupation code. */
async function fetchOccupationWage(code, topCount = 3) {
  assertOccupation(code);
  try {
    const data = await fetchJson(buildOccupationV2Url(code, topCount), { headers: { Accept: 'application/json' } });
    return parseOccupationJsonStat2(data);
  } catch (v2Err) {
    const item = (c, values) => ({ code: c, selection: { filter: 'item', values } });
    const body = {
      query: [
        item('MaaleMetode', PINS_OCC.MaaleMetode),
        item('Yrke', [code]),
        item('Sektor', [PINS_OCC.Sektor]),
        item('Kjonn', [PINS_OCC.Kjonn]),
        item('AvtaltVanlig', [PINS_OCC.AvtaltVanlig]),
        item('ContentsCode', [PINS_OCC.ContentsCode]),
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
      return parseOccupationJsonStat2(data);
    } catch (v1Err) {
      throw new Error(`v2: ${v2Err.message}; v1: ${v1Err.message}`, { cause: v1Err });
    }
  }
}

module.exports = {
  fetchWageStats, parseWage11418JsonStat2, buildV2Url,
  OCCUPATIONS, OCCUPATION_MEASURE: PINS_OCC.ContentsCode,
  fetchOccupationWage, parseOccupationJsonStat2, buildOccupationV2Url,
};
