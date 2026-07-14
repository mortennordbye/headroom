import { describe, it, expect } from 'vitest';
// The SSB client lives in the CommonJS server engine (server/ssb.js) so it
// ships in the production image; its pure parts are tested here via Vitest.
import { parseCpiJsonStat2, buildV2Url, withYoy, monthsInRange } from '../../server/ssb.js';

// Minimal json-stat2 shape shared by PxWebApi v1 and v2 for this query:
// VareTjenesteGrp and ContentsCode pinned to one value, Tid the only real dimension.
const jsonStat2 = (index: Record<string, number>, value: (number | null)[]) => ({
  dimension: {
    VareTjenesteGrp: { category: { index: { '00': 0 } } },
    ContentsCode: { category: { index: { KpiIndMnd: 0 } } },
    Tid: { category: { index } },
  },
  value,
});

describe('parseCpiJsonStat2', () => {
  it('maps Tid codes to sorted { month, cpiIndex } points', () => {
    const data = jsonStat2({ '2026M05': 0, '2026M06': 1, '2026M04': 2 }, [138.1, 138.4, 137.9]);
    expect(parseCpiJsonStat2(data, '2026-06')).toEqual([
      { month: '2026-04', cpiIndex: 137.9 },
      { month: '2026-05', cpiIndex: 138.1 },
      { month: '2026-06', cpiIndex: 138.4 },
    ]);
  });

  it('trims months past the requested upper bound', () => {
    const data = jsonStat2({ '2026M06': 0, '2026M07': 1 }, [138.4, 138.6]);
    expect(parseCpiJsonStat2(data, '2026-06')).toEqual([{ month: '2026-06', cpiIndex: 138.4 }]);
  });

  it('skips null values (unpublished months) instead of emitting NaN', () => {
    const data = jsonStat2({ '2026M05': 0, '2026M06': 1 }, [138.1, null]);
    expect(parseCpiJsonStat2(data, '2026-06')).toEqual([{ month: '2026-05', cpiIndex: 138.1 }]);
  });

  it('throws on a response without the Tid dimension', () => {
    expect(() => parseCpiJsonStat2({ dimension: {} }, '2026-06')).toThrow(/Tid/);
  });
});

describe('buildV2Url', () => {
  it('pins all three dimensions and uses top() time selection, unencoded', () => {
    const url = buildV2Url(24);
    expect(url).toBe(
      'https://data.ssb.no/api/pxwebapi/v2/tables/14700/data?lang=no&outputFormat=json-stat2'
      + '&valueCodes[VareTjenesteGrp]=00&valueCodes[ContentsCode]=KpiIndMnd&valueCodes[Tid]=top(24)',
    );
  });
});

describe('withYoy', () => {
  it('computes YoY against the month 12 back, null when missing', () => {
    const points = [
      { month: '2025-06', cpiIndex: 132.0 },
      { month: '2026-06', cpiIndex: 138.6 },
    ];
    const out = withYoy(points);
    expect(out[0].yoyPercent).toBeNull();
    expect(out[1].yoyPercent).toBeCloseTo(5.0, 5);
  });
});

describe('monthsInRange', () => {
  it('spans year boundaries inclusively in SSB code format', () => {
    expect(monthsInRange('2025-11', '2026-02')).toEqual(['2025M11', '2025M12', '2026M01', '2026M02']);
  });
});
