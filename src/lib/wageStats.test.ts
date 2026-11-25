import { describe, it, expect } from 'vitest';
// The SSB wage-statistics client lives in the CommonJS server engine
// (server/wageStats.js) so it ships in the production image; its pure parts are
// tested here via Vitest, mirroring src/lib/boligPrices.test.ts.
import {
  parseWage11418JsonStat2,
  buildV2Url,
  parseOccupationJsonStat2,
  buildOccupationV2Url,
  OCCUPATIONS,
} from '../../server/wageStats.js';
import { STYRK_CODES } from './marketWage';

// json-stat2 shape for table 11418 with every dimension except Tid pinned to a
// single value, so value[] is ordered by the Tid index.
const jsonStat2 = (tidIndex: Record<string, number>, value: (number | null)[]) => ({
  id: ['MaaleMetode', 'Yrke', 'Sektor', 'Kjonn', 'AvtaltVanlig', 'ContentsCode', 'Tid'],
  size: [1, 1, 1, 1, 1, 1, Object.keys(tidIndex).length],
  dimension: {
    Tid: { category: { index: tidIndex } },
  },
  value,
});

describe('parseWage11418JsonStat2', () => {
  it('converts monthly wage to annual (× 12) and sorts by year', () => {
    // Deliberately unsorted index to prove the parser sorts.
    const data = jsonStat2({ '2024': 1, '2023': 0 }, [52_580, 55_410]);
    expect(parseWage11418JsonStat2(data)).toEqual([
      { year: 2023, median: 630_960 },
      { year: 2024, median: 664_920 },
    ]);
  });

  it('rounds the annual figure to whole kroner', () => {
    const data = jsonStat2({ '2025': 0 }, [57_970.5]);
    // 57970.5 * 12 = 695646 exactly, but Math.round guards fractional inputs.
    expect(parseWage11418JsonStat2(data)).toEqual([{ year: 2025, median: 695_646 }]);
  });

  it('skips years whose value is null (suppressed cells)', () => {
    const data = jsonStat2({ '2023': 0, '2024': 1 }, [52_580, null]);
    expect(parseWage11418JsonStat2(data)).toEqual([{ year: 2023, median: 630_960 }]);
  });

  it('throws when the Tid dimension is missing', () => {
    expect(() => parseWage11418JsonStat2({ dimension: {}, value: [] })).toThrow(/Tid/);
  });
});

describe('buildV2Url', () => {
  it('pins every dimension and requests top(N) years', () => {
    const url = buildV2Url(12);
    expect(url).toContain('/tables/11418/data');
    expect(url).toContain('valueCodes[MaaleMetode]=01'); // Median
    expect(url).toContain('valueCodes[Yrke]=0-9'); // Alle yrker
    expect(url).toContain('valueCodes[Sektor]=ALLE'); // Alle sektorer
    expect(url).toContain('valueCodes[Kjonn]=0'); // Begge kjønn
    expect(url).toContain('valueCodes[AvtaltVanlig]=5'); // Heltidsansatte
    expect(url).toContain('valueCodes[ContentsCode]=Manedslonn');
    expect(url).toContain('valueCodes[Tid]=top(12)');
  });

  it('floors a fractional top count', () => {
    expect(buildV2Url(12.9)).toContain('top(12)');
  });
});

// json-stat2 for one occupation: MaaleMetode (median, lower, upper quartile) and
// Tid are multi-valued, so value[] runs measure-major, year-minor.
const occJsonStat2 = (years: string[], value: (number | null)[], measures = ['01', '051', '061']) => ({
  id: ['MaaleMetode', 'Yrke', 'Sektor', 'Kjonn', 'AvtaltVanlig', 'ContentsCode', 'Tid'],
  size: [measures.length, 1, 1, 1, 1, 1, years.length],
  dimension: {
    MaaleMetode: { category: { index: Object.fromEntries(measures.map((m, i) => [m, i])) } },
    Tid: { category: { index: Object.fromEntries(years.map((y, i) => [y, i])) } },
  },
  value,
});

describe('parseOccupationJsonStat2', () => {
  it('reads median and quartiles per year as annual figures', () => {
    // median 2024, 2025 | p25 2024, 2025 | p75 2024, 2025
    const data = occJsonStat2(['2024', '2025'], [73_000, 76_060, 60_000, 62_660, 88_000, 90_770]);
    expect(parseOccupationJsonStat2(data)).toEqual([
      { year: 2024, median: 876_000, p25: 720_000, p75: 1_056_000 },
      { year: 2025, median: 912_720, p25: 751_920, p75: 1_089_240 },
    ]);
  });

  it('skips a year without a median and keeps a missing quartile as null', () => {
    const data = occJsonStat2(['2024', '2025'], [null, 76_060, 60_000, null, 88_000, 90_770]);
    expect(parseOccupationJsonStat2(data)).toEqual([{ year: 2025, median: 912_720, p25: null, p75: 1_089_240 }]);
  });

  it('treats non-finite and non-positive values as missing', () => {
    expect(parseOccupationJsonStat2(occJsonStat2(['2025'], [Number.NaN, 1, 2]))).toEqual([]);
    const bad = occJsonStat2(['2025'], [76_060, -1, Number.POSITIVE_INFINITY]);
    expect(parseOccupationJsonStat2(bad)).toEqual([{ year: 2025, median: 912_720, p25: null, p75: null }]);
  });

  it('works with the median only', () => {
    const data = occJsonStat2(['2025'], [76_060], ['01']);
    expect(parseOccupationJsonStat2(data)).toEqual([{ year: 2025, median: 912_720, p25: null, p75: null }]);
  });

  it('throws when dimensions are missing', () => {
    expect(() => parseOccupationJsonStat2({ value: [] })).toThrow(/dimensions/);
  });
});

describe('buildOccupationV2Url', () => {
  it('pins private sector, full time, the agreed wage and three measures', () => {
    const url = buildOccupationV2Url('2512', 3);
    expect(url).toContain('valueCodes[MaaleMetode]=01,051,061');
    expect(url).toContain('valueCodes[Yrke]=2512');
    expect(url).toContain('valueCodes[Sektor]=A%2BB%2BD%2BE');
    expect(url).toContain('valueCodes[Kjonn]=0');
    expect(url).toContain('valueCodes[AvtaltVanlig]=5');
    expect(url).toContain('valueCodes[ContentsCode]=AvtaltManedslonn');
    expect(url).toContain('valueCodes[Tid]=top(3)');
  });

  it('refuses a code outside the allowlist', () => {
    expect(() => buildOccupationV2Url('2523', 3)).toThrow(/unknown/);
    expect(() => buildOccupationV2Url('2512&x=1', 3)).toThrow(/unknown/);
  });

  it('allows the same codes as the client picker', () => {
    expect(Object.keys(OCCUPATIONS).sort()).toEqual([...STYRK_CODES].sort());
  });
});
