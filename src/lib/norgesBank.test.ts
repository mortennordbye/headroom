import { describe, it, expect } from 'vitest';
// The Norges Bank policy-rate client lives in the CommonJS server engine
// (server/norgesBank.js); its pure parts are tested here via Vitest.
import { parseSdmxJson, buildUrl } from '../../server/norgesBank.js';

// Minimal SDMX-JSON shape matching a real Norges Bank IR/B.KPRA.SD.R response:
// one series, observations keyed by index, periods under the TIME_PERIOD
// observation dimension.
const sdmx = (periods: string[], values: (string | number | null)[]) => ({
  data: {
    dataSets: [
      {
        series: {
          '0:0:0:0': {
            observations: Object.fromEntries(values.map((v, i) => [String(i), [v]])),
          },
        },
      },
    ],
    structure: {
      dimensions: {
        observation: [{ id: 'TIME_PERIOD', values: periods.map((p) => ({ id: p })) }],
      },
    },
  },
});

describe('parseSdmxJson', () => {
  it('maps observations to sorted { period, rate } points', () => {
    const data = sdmx(['2026-07-14', '2026-07-15', '2026-07-16'], ['4.25', '4.25', '4.50']);
    expect(parseSdmxJson(data)).toEqual([
      { period: '2026-07-14', rate: 4.25 },
      { period: '2026-07-15', rate: 4.25 },
      { period: '2026-07-16', rate: 4.5 },
    ]);
  });

  it('sorts out-of-order observations by period', () => {
    const data = sdmx(['2026-07-16', '2026-07-14'], ['4.50', '4.25']);
    expect(parseSdmxJson(data).map((p) => p.period)).toEqual(['2026-07-14', '2026-07-16']);
  });

  it('drops non-numeric / missing observations', () => {
    const data = sdmx(['2026-07-14', '2026-07-15'], [null, '4.25']);
    expect(parseSdmxJson(data)).toEqual([{ period: '2026-07-15', rate: 4.25 }]);
  });

  it('throws when the series has no observations', () => {
    expect(() => parseSdmxJson({ data: { dataSets: [{}], structure: {} } })).toThrow(/observations/);
  });
});

describe('buildUrl', () => {
  it('targets the IR/B.KPRA.SD.R series with a lastNObservations window', () => {
    const url = buildUrl(10);
    expect(url).toContain('/api/data/IR/B.KPRA.SD.R');
    expect(url).toContain('format=sdmx-json');
    expect(url).toContain('lastNObservations=10');
  });
});
