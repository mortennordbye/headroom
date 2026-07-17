/**
 * Norges Bank policy-rate client — queries the open-data SDMX REST API for the
 * key policy rate (styringsrente) and returns { period, rate } points.
 *
 *   https://data.norges-bank.no/api/data/IR/B.KPRA.SD.R?format=sdmx-json
 *
 * Dataflow IR (interest rates), series key B.KPRA.SD.R:
 *   FREQ=B (business day) · INSTRUMENT_TYPE=KPRA (key policy rate) ·
 *   TENOR=SD · UNIT_MEASURE=R. No authentication; free to use.
 *
 * SDMX-JSON (not json-stat): a single series lives under
 * data.dataSets[0].series[<key>].observations, keyed by observation index; the
 * period label for each index comes from
 * data.structure.dimensions.observation[TIME_PERIOD].values[index].
 *
 * The caller (server/index.js) caches results and throttles upstream attempts.
 * Node 18+ ships fetch globally; no external HTTP dep needed.
 */

const NB_BASE = 'https://data.norges-bank.no/api/data/IR/B.KPRA.SD.R';
const FETCH_TIMEOUT_MS = 10_000;

function buildUrl(lastN) {
  return `${NB_BASE}?format=sdmx-json&lastNObservations=${Math.floor(lastN)}`;
}

/**
 * Parse a Norges Bank SDMX-JSON response into { period, rate } points, sorted
 * ascending by period (ISO date). Non-numeric / missing observations are dropped.
 */
function parseSdmxJson(data) {
  const dataSet = data?.data?.dataSets?.[0];
  const series = dataSet?.series;
  const first = series && Object.values(series)[0];
  const observations = first?.observations;
  if (!observations) throw new Error('Norges Bank response missing series observations');

  const obsDims = data?.data?.structure?.dimensions?.observation || [];
  const timeDim = obsDims.find((d) => d.id === 'TIME_PERIOD') || obsDims[0];
  const periods = (timeDim?.values || []).map((v) => v.id || v.name);

  const points = [];
  for (const [idx, arr] of Object.entries(observations)) {
    const period = periods[Number(idx)];
    const raw = Array.isArray(arr) ? arr[0] : arr;
    const rate = typeof raw === 'number' ? raw : parseFloat(raw);
    if (period && Number.isFinite(rate)) points.push({ period, rate });
  }
  points.sort((a, b) => a.period.localeCompare(b.period));
  return points;
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Norges Bank returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Fetch the last `lastN` observations of the key policy rate. */
async function fetchPolicyRate(lastN = 10) {
  const data = await fetchJson(buildUrl(lastN), { headers: { Accept: 'application/json' } });
  return parseSdmxJson(data);
}

module.exports = { fetchPolicyRate, parseSdmxJson, buildUrl };
