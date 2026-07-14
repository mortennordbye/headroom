/**
 * SSB inflation client — queries Statistics Norway table 14700
 * (Konsumprisindeksen, KPI) and returns { month, cpiIndex, yoyPercent } points.
 * (Table 14700 replaced the discontinued 03013 in February 2026; 03013 is
 * frozen at 2025M12 but still answers queries, so a stale table looks like a
 * "successful" fetch — hence the switch.)
 *
 * Primary: PxWebApi v2 (GET), launched autumn 2025 —
 *   https://data.ssb.no/api/pxwebapi/v2/tables/14700/data
 * Fallback: the classic PxWebApi v1 (POST) while it remains up —
 *   https://data.ssb.no/api/v0/no/table/14700/
 * Both return json-stat2, so parsing is shared (and unit-tested).
 *
 * SSB rate limit is 30 queries/min per IP — the caller (server/index.js)
 * additionally throttles upstream attempts so a broken query or an SSB outage
 * can't turn every page load into an SSB hit.
 *
 * Table 14700 dimensions: VareTjenesteGrp (item), Tid (month), ContentsCode (value)
 *   - VareTjenesteGrp = '00' for the all-items index ("I alt")
 *   - ContentsCode = 'KpiIndMnd' for the monthly index (base 2025=100 — 03013
 *     was 2015=100, so cached values from before the switch must not be mixed
 *     with these; server/index.js purges the old cache once on upgrade)
 *
 * Node 18+ ships fetch globally; no external HTTP dep needed.
 */

const SSB_V2_BASE = 'https://data.ssb.no/api/pxwebapi/v2/tables/14700/data';
const SSB_V1_URL = 'https://data.ssb.no/api/v0/no/table/14700/';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Build the time codes (YYYYMmm) for an inclusive month range.
 * SSB uses 'M' between year and month (e.g. 2023M07).
 */
function monthsInRange(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  const out = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}M${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function ssbCodeToMonth(code) {
  // '2023M07' → '2023-07'
  const [y, m] = code.split('M');
  return `${y}-${m}`;
}

/** PxWebApi v2 data URL: GET with valueCodes filters, json-stat2 out. */
function buildV2Url(topCount) {
  // Pin all three dimensions so Tid is the only non-singleton one — the
  // parser relies on that (value[] is then ordered by the Tid index).
  // Built literally (brackets/parens unencoded) to match SSB's documented
  // examples exactly; every value here is from a fixed safe alphabet.
  return `${SSB_V2_BASE}?lang=no&outputFormat=json-stat2`
    + '&valueCodes[VareTjenesteGrp]=00'
    + '&valueCodes[ContentsCode]=KpiIndMnd'
    + `&valueCodes[Tid]=top(${Math.floor(topCount)})`;
}

/**
 * Parse a json-stat2 KPI response (v1 and v2 share the format) into
 * { month, cpiIndex } points, trimmed to `toMonth`. Assumes Tid is the only
 * dimension with more than one value, so value[] is ordered by the Tid index.
 */
function parseCpiJsonStat2(data, toMonth) {
  const timeDim = data.dimension?.Tid;
  if (!timeDim) throw new Error('SSB response missing Tid dimension');

  const indexById = timeDim.category.index; // { '2023M07': 0, ... }
  const values = data.value || [];

  const points = [];
  for (const [code, idx] of Object.entries(indexById)) {
    const cpi = values[idx];
    if (typeof cpi === 'number') {
      points.push({ month: ssbCodeToMonth(code), cpiIndex: cpi });
    }
  }
  points.sort((a, b) => a.month.localeCompare(b.month));
  // Trim to caller's requested upper bound (lower bound is enforced server-side).
  return points.filter(p => p.month <= toMonth);
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    // Bound the upstream call so a black-holed connection can't hang
    // /api/inflation for long — the caller falls back to cached data.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`SSB returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function fetchCpi(fromMonth, toMonth) {
  // Estimate how many months back we need to cover, plus margin.
  // "top" counts from the newest published month, so we never request months
  // that don't exist yet (which would make a code-list query 400).
  const desired = monthsInRange(fromMonth, toMonth).length;
  const topCount = Math.max(desired + 6, 24);

  try {
    const data = await fetchJson(buildV2Url(topCount), { headers: { Accept: 'application/json' } });
    return parseCpiJsonStat2(data, toMonth);
  } catch (v2Err) {
    // v1 stays up "during a transition period" (SSB) — try it before giving up.
    const body = {
      query: [
        { code: 'VareTjenesteGrp', selection: { filter: 'item', values: ['00'] } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['KpiIndMnd'] } },
        { code: 'Tid', selection: { filter: 'top', values: [String(topCount)] } },
      ],
      response: { format: 'json-stat2' },
    };
    try {
      const data = await fetchJson(SSB_V1_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      return parseCpiJsonStat2(data, toMonth);
    } catch (v1Err) {
      throw new Error(`v2: ${v2Err.message}; v1: ${v1Err.message}`);
    }
  }
}

/**
 * Compute year-over-year % change for each point given a full series
 * (which must include the 12 prior months for the YoY to be defined).
 */
function withYoy(points) {
  const byMonth = new Map(points.map(p => [p.month, p.cpiIndex]));
  return points.map(p => {
    const [y, m] = p.month.split('-').map(Number);
    const priorKey = `${y - 1}-${String(m).padStart(2, '0')}`;
    const prior = byMonth.get(priorKey);
    const yoyPercent = prior ? ((p.cpiIndex / prior) - 1) * 100 : null;
    return { ...p, yoyPercent };
  });
}

module.exports = { fetchCpi, withYoy, monthsInRange, parseCpiJsonStat2, buildV2Url };
