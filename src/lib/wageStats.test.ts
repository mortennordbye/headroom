import { describe, it, expect } from 'vitest';
// The SSB wage-statistics client lives in the CommonJS server engine
// (server/wageStats.js) so it ships in the production image; its pure parts are
// tested here via Vitest, mirroring src/lib/boligPrices.test.ts.
import {
  parseWage11418JsonStat2,
  buildV2Url,
} from '../../server/wageStats.js';

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
