import { describe, it, expect } from 'vitest';
// The SSB square-metre-price client lives in the CommonJS server engine
// (server/boligPrices.js) so it ships in the production image; its pure parts
// are tested here via Vitest, mirroring src/lib/ssb.test.ts.
import {
  parseBolig14310JsonStat2,
  buildV2Url,
  dwellingToBoligtype,
} from '../../server/boligPrices.js';

// json-stat2 shape for table 14310 with Region + Boligtype pinned to one value
// and both ContentsCode measures requested. value[] is row-major over the id
// order, so KvPris fills the first N slots and Omsetninger the next N.
const jsonStat2 = (
  tidIndex: Record<string, number>,
  contentIndex: Record<string, number>,
  value: (number | null)[],
) => {
  const nTid = Object.keys(tidIndex).length;
  const nContent = Object.keys(contentIndex).length;
  return {
    id: ['Region', 'Boligtype', 'ContentsCode', 'Tid'],
    size: [1, 1, nContent, nTid],
    dimension: {
      Region: { category: { index: { '0301': 0 } } },
      Boligtype: { category: { index: { '03': 0 } } },
      ContentsCode: { category: { index: contentIndex } },
      Tid: { category: { index: tidIndex } },
    },
    value,
  };
};

describe('parseBolig14310JsonStat2', () => {
  it('splits value[] into sorted price + sales points by quarter', () => {
    const data = jsonStat2(
      { '2025K4': 0, '2026K1': 1, '2026K2': 2 },
      { KvPris: 0, Omsetninger: 1 },
      [99609, 103313, 102372, /* sales: */ 3738, 5136, 5659],
    );
    expect(parseBolig14310JsonStat2(data)).toEqual([
      { quarter: '2025K4', price: 99609, sales: 3738 },
      { quarter: '2026K1', price: 103313, sales: 5136 },
      { quarter: '2026K2', price: 102372, sales: 5659 },
    ]);
  });

  it('sorts out-of-order Tid indices chronologically', () => {
    const data = jsonStat2(
      { '2026K2': 0, '2025K4': 1, '2026K1': 2 },
      { KvPris: 0, Omsetninger: 1 },
      [102372, 99609, 103313, 5659, 3738, 5136],
    );
    expect(parseBolig14310JsonStat2(data).map((p) => p.quarter)).toEqual([
      '2025K4',
      '2026K1',
      '2026K2',
    ]);
  });

  it('respects the ContentsCode order in the response (Omsetninger first)', () => {
    const data = jsonStat2(
      { '2026K1': 0, '2026K2': 1 },
      { Omsetninger: 0, KvPris: 1 },
      [/* sales: */ 5136, 5659, /* price: */ 103313, 102372],
    );
    expect(parseBolig14310JsonStat2(data)).toEqual([
      { quarter: '2026K1', price: 103313, sales: 5136 },
      { quarter: '2026K2', price: 102372, sales: 5659 },
    ]);
  });

  it('maps missing cells (null) to null', () => {
    const data = jsonStat2(
      { '2026K1': 0, '2026K2': 1 },
      { KvPris: 0, Omsetninger: 1 },
      [null, 102372, null, 70],
    );
    expect(parseBolig14310JsonStat2(data)).toEqual([
      { quarter: '2026K1', price: null, sales: null },
      { quarter: '2026K2', price: 102372, sales: 70 },
    ]);
  });

  it('throws when required dimensions are absent', () => {
    expect(() => parseBolig14310JsonStat2({ value: [] })).toThrow(/Tid or ContentsCode/);
  });
});

describe('dwellingToBoligtype', () => {
  it('maps Headroom dwelling types to SSB Boligtype codes', () => {
    expect(dwellingToBoligtype('leilighet')).toBe('03');
    expect(dwellingToBoligtype('enebolig')).toBe('01');
    expect(dwellingToBoligtype('rekkehus')).toBe('02');
    expect(dwellingToBoligtype('tomannsbolig')).toBe('02');
  });

  it('falls back to total (00) for hytte/other/unknown', () => {
    expect(dwellingToBoligtype('hytte')).toBe('00');
    expect(dwellingToBoligtype('other')).toBe('00');
    expect(dwellingToBoligtype('')).toBe('00');
  });
});

describe('buildV2Url', () => {
  it('pins Region + Boligtype and requests both measures with a Tid window', () => {
    const url = buildV2Url('0301', '03', 8);
    expect(url).toContain('tables/14310/data');
    expect(url).toContain('valueCodes[Region]=0301');
    expect(url).toContain('valueCodes[Boligtype]=03');
    expect(url).toContain('valueCodes[ContentsCode]=KvPris,Omsetninger');
    expect(url).toContain('valueCodes[Tid]=top(8)');
  });
});
