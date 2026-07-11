import { describe, it, expect } from 'vitest';
import { IMPORT_SECTIONS, IMPORT_SECTION_KEYS, filterPayloadToSections, sectionKeysPresent } from './importSections';
import { makePayloadRegistry, persistedKeys, type PayloadDefaults } from './payloadRegistry';
import type { ExportPayload } from '../context/FinanceContext';

// The registry is the single source of truth for the persisted-field list; the
// section partition must cover it exactly. Defaults don't affect the key set, so
// an empty cast is enough to enumerate them.
const registryKeys = persistedKeys(makePayloadRegistry({} as PayloadDefaults));
const allSectionKeys = IMPORT_SECTIONS.flatMap(s => IMPORT_SECTION_KEYS[s]);

describe('importSections partition', () => {
  it('covers every persisted key exactly once — exhaustive and disjoint', () => {
    // Exhaustive: same set of keys as the registry (guards a new payload field
    // added without assigning it a restore section).
    expect([...allSectionKeys].sort()).toEqual([...registryKeys].sort());
    // Disjoint: no key appears in two sections.
    expect(new Set(allSectionKeys).size).toBe(allSectionKeys.length);
  });
});

describe('filterPayloadToSections', () => {
  const payload: Partial<ExportPayload> = {
    income: 500_000, jobs: [], dailyTransactions: [], debts: [], lang: 'nb',
  };

  it('keeps only the keys of a single selected section', () => {
    expect(filterPayloadToSections(payload, new Set(['budget']))).toEqual({ dailyTransactions: [] });
  });

  it('keeps keys across several selected sections', () => {
    const out = filterPayloadToSections(payload, new Set(['incomeWork', 'assetsDebt']));
    expect(Object.keys(out).sort()).toEqual(['debts', 'income', 'jobs']);
  });

  it('drops everything when no section is selected', () => {
    expect(filterPayloadToSections(payload, new Set())).toEqual({});
  });
});

describe('sectionKeysPresent', () => {
  it('lists only the section keys the payload actually carries', () => {
    const payload: Partial<ExportPayload> = { income: 1, dailyTransactions: [] };
    expect(sectionKeysPresent(payload, 'incomeWork')).toEqual(['income']);
    expect(sectionKeysPresent(payload, 'budget')).toEqual(['dailyTransactions']);
    expect(sectionKeysPresent(payload, 'assetsDebt')).toEqual([]);
  });
});
