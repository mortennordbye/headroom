/**
 * SSB inflation client — queries Statistics Norway table 03013
 * (Konsumprisindeksen, KPI) and returns { month, cpiIndex, yoyPercent } points.
 *
 * Docs: https://data.ssb.no/api/v0/no/table/03013/
 * Table 03013 dimensions: KonsumKoder (item), Tid (month), ContentsCode (value)
 *   - KonsumKoder = 'TOTAL' for the all-items index
 *   - ContentsCode = 'KpiIndMnd' for the monthly index (base 2015=100)
 *
 * Node 18+ ships fetch globally; no external HTTP dep needed.
 */

const SSB_URL = 'https://data.ssb.no/api/v0/no/table/03013/';

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

async function fetchCpi(fromMonth, toMonth) {
  // Estimate how many months back we need to cover, plus margin.
  // Use SSB's "top" filter so we don't request months that haven't been
  // published yet (which would make the entire query 400).
  const desired = monthsInRange(fromMonth, toMonth).length;
  const topCount = Math.max(desired + 6, 24);

  const body = {
    query: [
      {
        code: 'Konsumgrp',
        selection: { filter: 'item', values: ['TOTAL'] },
      },
      {
        code: 'Tid',
        selection: { filter: 'top', values: [String(topCount)] },
      },
    ],
    response: { format: 'json-stat2' },
  };

  const res = await fetch(SSB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`SSB returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  // json-stat2: data.value[] is a flat array; dimensions describe layout.
  // With one item ('TOTAL') and N time codes, value is ordered by Tid index.
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

module.exports = { fetchCpi, withYoy, monthsInRange };
